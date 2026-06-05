import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AiRouter } from './router.js';
import { getRetryAfterMs, RouterError, toOpenAIError } from './errors.js';
import type { ChatRequest, ProviderAdapter, RouterConfig } from './types.js';
import type { ModelRegistry } from './model-registry.js';
import { JsonlUsageRecorder } from './usage.js';
import type { AuthManager } from './auth/manager.js';
import { redactAuthRecord } from './auth/types.js';

export interface ServerOptions {
  providers: ProviderAdapter[];
  registry: ModelRegistry;
  config: RouterConfig;
  router?: AiRouter;
  authManager?: AuthManager;
}

export function createServer(options: ServerOptions): http.Server {
  const maxBodyBytes = options.config.server?.maxBodyBytes ?? 1_048_576;
  const router = options.router ?? new AiRouter({
    providers: options.providers,
    registry: options.registry,
    config: options.config,
    usage: new JsonlUsageRecorder(options.config.storage?.usageLogPath)
  });

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

      if (request.method === 'GET' && url.pathname === '/health') {
        return sendJson(response, 200, { status: 'ok' });
      }

      if (url.pathname.startsWith('/admin/')) {
        if (!authorized(request, [options.config.server?.adminToken].filter(Boolean) as string[])) {
          return sendJson(response, 401, toOpenAIError(new Error('Unauthorized'), 401).body);
        }
        if (request.method === 'GET' && url.pathname === '/admin/auth') {
          return sendJson(response, 200, { data: options.authManager?.listRedacted() ?? [] });
        }
        const authMatch = /^\/admin\/auth\/([^/]+)$/.exec(url.pathname);
        if (authMatch && request.method === 'PATCH') {
          if (!options.authManager) return sendJson(response, 404, toOpenAIError(new Error('Not found'), 404).body);
          const body = await readJson<{ disabled?: unknown }>(request, maxBodyBytes);
          if (typeof body.disabled !== 'boolean') {
            throw new RouterError('disabled must be boolean', { status: 400, code: 'invalid_request', retryable: false });
          }
          const updated = await options.authManager.setDisabled(decodeURIComponent(authMatch[1]!), body.disabled);
          return sendJson(response, 200, { data: redactAuthRecord(updated) });
        }
        if (authMatch && request.method === 'DELETE') {
          if (!options.authManager) return sendJson(response, 404, toOpenAIError(new Error('Not found'), 404).body);
          await options.authManager.delete(decodeURIComponent(authMatch[1]!));
          response.statusCode = 204;
          response.end();
          return;
        }
        if (request.method === 'GET' && url.pathname === '/admin/providers') {
          const seen = new Set<string>();
          const allDeployments = options.registry.list()
            .flatMap((group) => group.deployments)
            .filter((d) => {
              if (seen.has(d.id)) return false;
              seen.add(d.id);
              return true;
            });
          const healthSnapshot = router.healthSnapshot();
          const deployments = allDeployments.map((d) => {
            const healthEntry = healthSnapshot[d.id];
            const cursor = router.getSelectionCursor(d);
            return {
              id: d.id,
              cooldownUntil: healthEntry?.cooldownUntil ?? 0,
              ...(healthEntry?.lastError ? { lastError: healthEntry.lastError } : {}),
              ...(cursor !== undefined ? { selectionCursor: cursor } : {})
            };
          });

          return sendJson(response, 200, {
            providers: options.providers.map((provider) => ({ id: provider.id, type: provider.type, priority: provider.priority })),
            health: healthSnapshot,
            routing: {
              strategy: options.config.routing?.strategy,
              sessionAffinity: options.config.routing?.sessionAffinity,
              sessionAffinityTtlMs: options.config.routing?.sessionAffinityTtlMs
            },
            deployments
          });
        }
        if (request.method === 'GET' && url.pathname === '/admin/usage') {
          return sendJson(response, 200, { data: await router.recentUsage(parseUsageLimit(url.searchParams.get('limit'))) });
        }
      }

      if (url.pathname.startsWith('/v1/')) {
        if (!authorized(request, options.config.server?.authTokens ?? [])) {
          return sendJson(response, 401, toOpenAIError(new Error('Unauthorized'), 401).body);
        }

        if (url.pathname === '/v1/ws') {
          if (!options.config.server?.websocketEnabled) {
            return sendJson(response, 404, toOpenAIError(new Error('Not found'), 404).body);
          }
          return sendJson(response, 501, toOpenAIError(new RouterError('WebSocket execution is not implemented yet', { status: 501, code: 'not_implemented', retryable: false })).body);
        }

        if (request.method === 'GET' && url.pathname === '/v1/models') {
          await options.registry.refresh();
          return sendJson(response, 200, {
            object: 'list',
            data: options.registry.list().map((model) => ({ id: model.id, object: 'model', owned_by: 'free-ai-router', aliases: model.aliases }))
          });
        }

        if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
          const body = await readJson<ChatRequest>(request, maxBodyBytes);
          validateChatRequest(body);
          const result = await router.chat(body, { userId: apiKeyHash(request), apiKeyHash: apiKeyHash(request), headers: request.headers });
          if (result.response instanceof Response) {
            setDebugHeaders(response, options.config, result);
            response.statusCode = result.response.status;
            copyHeaders(result.response.headers, response);
            await pipeWebResponse(result.response, response, request);
            return;
          }
          setDebugHeaders(response, options.config, result);
          return sendJson(response, 200, result.response);
        }

        if (request.method === 'POST' && url.pathname === '/v1/responses') {
          const body = await readJson<Record<string, unknown>>(request, maxBodyBytes);
          if (body.stream === true) {
            return sendJson(response, 400, toOpenAIError(new RouterError('/v1/responses streaming is not implemented yet', { status: 400, code: 'unsupported_request', retryable: false })).body);
          }
          const chatRequest = responsesToChatRequest(body);
          validateChatRequest(chatRequest);
          const result = await router.chat(chatRequest, { userId: apiKeyHash(request), apiKeyHash: apiKeyHash(request), headers: request.headers });
          if (result.response instanceof Response) {
            setDebugHeaders(response, options.config, result);
            response.statusCode = result.response.status;
            copyHeaders(result.response.headers, response);
            await pipeWebResponse(result.response, response, request);
            return;
          }
          setDebugHeaders(response, options.config, result);
          return sendJson(response, 200, chatToResponses(result.response));
        }
      }

      return sendJson(response, 404, toOpenAIError(new Error('Not found'), 404).body);
    } catch (error) {
      const normalized = toOpenAIError(error);
      const retryAfterMs = getRetryAfterMs(error);
      if (retryAfterMs !== undefined) {
        response.setHeader('retry-after', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      }
      return sendJson(response, normalized.status, normalized.body);
    }
  });
  server.requestTimeout = options.config.server?.requestTimeoutMs ?? 120_000;
  server.headersTimeout = Math.min(server.requestTimeout, 60_000);
  server.maxHeadersCount = 100;
  return server;
}

function authorized(request: http.IncomingMessage, tokens: string[]): boolean {
  if (tokens.length === 0) {
    return false;
  }
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  if (!token) {
    return false;
  }
  return tokens.some((expected) => safeEqual(token, expected));
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function apiKeyHash(request: http.IncomingMessage): string {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? 'anonymous';
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

async function readJson<T>(request: http.IncomingMessage, bodyLimit: number): Promise<T> {
  const contentType = request.headers['content-type'];
  if (contentType && !String(contentType).toLowerCase().includes('application/json')) {
    throw new RouterError('Content-Type must be application/json', { status: 415, code: 'unsupported_media_type', retryable: false });
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > bodyLimit) {
      throw new RouterError(`Request body exceeds ${bodyLimit} bytes`, { status: 413, code: 'request_too_large', retryable: false });
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    throw new RouterError('Invalid JSON request body', { status: 400, code: 'invalid_json', retryable: false });
  }
}

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

function setDebugHeaders(response: http.ServerResponse, config: RouterConfig, result: { deployment: { providerId: string; id: string; modelGroup: string }; attempts: unknown[] }): void {
  if (!config.routing?.debugHeaders) {
    return;
  }
  response.setHeader('x-router-provider', result.deployment.providerId);
  response.setHeader('x-router-deployment', result.deployment.id);
  response.setHeader('x-router-model-group', result.deployment.modelGroup);
  response.setHeader('x-router-fallback-count', Math.max(0, result.attempts.length - 1));
}

function copyHeaders(headers: Headers, response: http.ServerResponse): void {
  const allowed = new Set(['content-type', 'cache-control', 'date', 'x-request-id']);
  headers.forEach((value, key) => {
    if (allowed.has(key.toLowerCase())) {
      response.setHeader(key, value);
    }
  });
}

async function pipeWebResponse(webResponse: Response, nodeResponse: http.ServerResponse, nodeRequest: http.IncomingMessage): Promise<void> {
  if (!webResponse.body) {
    nodeResponse.end();
    return;
  }
  const reader = webResponse.body.getReader();
  let closed = false;
  const cancel = () => {
    closed = true;
    void reader.cancel();
  };
  nodeRequest.on('aborted', cancel);
  nodeResponse.on('close', cancel);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || closed) {
        break;
      }
      nodeResponse.write(Buffer.from(value));
    }
    if (!nodeResponse.closed) {
      nodeResponse.end();
    }
  } finally {
    reader.releaseLock();
  }
}

function validateChatRequest(body: ChatRequest): void {
  if (!body || typeof body !== 'object') {
    throw new RouterError('Request body must be a JSON object', { status: 400, code: 'invalid_request', retryable: false });
  }
  if (typeof body.model !== 'string' || body.model.trim().length === 0) {
    throw new RouterError('model must be a non-empty string', { status: 400, code: 'invalid_request', retryable: false });
  }
  if (!Array.isArray(body.messages)) {
    throw new RouterError('messages must be an array', { status: 400, code: 'invalid_request', retryable: false });
  }
  for (const [index, message] of body.messages.entries()) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new RouterError(`messages[${index}] must be an object`, { status: 400, code: 'invalid_request', retryable: false });
    }
    if (typeof message.role !== 'string' || message.role.trim().length === 0) {
      throw new RouterError(`messages[${index}].role must be a non-empty string`, { status: 400, code: 'invalid_request', retryable: false });
    }
    if (message.content !== undefined && typeof message.content !== 'string' && !Array.isArray(message.content)) {
      throw new RouterError(`messages[${index}].content must be a string or content part array`, { status: 400, code: 'invalid_request', retryable: false });
    }
  }
  for (const field of ['temperature', 'top_p', 'max_tokens'] as const) {
    const value = body[field];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new RouterError(`${field} must be a finite number`, { status: 400, code: 'invalid_request', retryable: false });
    }
  }
}

function parseUsageLimit(raw: string | null): number {
  const parsed = Number(raw ?? 100);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 100;
  }
  return Math.min(Math.floor(parsed), 1_000);
}

function responsesToChatRequest(body: Record<string, unknown>): ChatRequest {
  const input = body.input;
  const content = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  return {
    ...body,
    model: String(body.model ?? 'auto'),
    messages: [{ role: 'user', content }]
  };
}

function chatToResponses(chat: { id: string; model: string; choices: Array<{ message: { content: unknown } }>; usage?: unknown }): Record<string, unknown> {
  const content = chat.choices[0]?.message.content ?? '';
  return {
    id: chat.id.replace(/^chatcmpl_/, 'resp_'),
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model: chat.model,
    output_text: typeof content === 'string' ? content : JSON.stringify(content),
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: typeof content === 'string' ? content : JSON.stringify(content) }] }],
    usage: chat.usage
  };
}
