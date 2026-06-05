# Plan C Codex, Gemini, and AI Studio Channel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider/channel execution for OpenAI Codex/Responses, Gemini OAuth/API-key auth records, and AI Studio Build-compatible execution hooks on top of Plan B's auth manager.

**Architecture:** Plan C keeps public API routing in `src/server.ts` and core dispatch in `src/router.ts`, but introduces provider executors that can use Plan B auth records. OpenAI/Codex uses Responses API request/response support. Gemini and AI Studio share Gemini request translation helpers, with AI Studio isolated behind a relay executor so it can be replaced or disabled without touching the Gemini API-key adapter.

**Tech Stack:** TypeScript ESM, Node.js built-in `fetch`, `http`, `crypto`, Web Streams, Vitest fake HTTP servers. Do not add runtime dependencies unless a task explicitly says to and the user approves.

---

## Chunk 1: OpenAI Responses and Codex Provider

### File structure

Create:
- `src/providers/openai-responses.ts` — official OpenAI Responses API provider.
- `src/providers/codex.ts` — Codex-flavored wrapper around OpenAI Responses/AuthManager records.
- `src/translators/responses.ts` — OpenAI chat/responses conversion helpers.
- `tests/openai-responses-provider.test.ts` — fake upstream tests.

Modify:
- `src/types.ts` — provider type union and responses types.
- `src/providers/factory.ts` — provider dispatch.
- `src/server.ts` — `/v1/responses` passthrough when provider returns Responses payload.
- `config.example.json`, `.env.example`, `README.md`.

### Task 1: Add provider type and config fields

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Test: `tests/config-example.test.ts`

- [ ] **Step 1: Write failing type/config test**

Add to `tests/config-example.test.ts`:

```ts
it('normalizes optional OpenAI Responses provider when key is present', () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-openai-key';
  try {
    const config = normalizeConfig({
      server: { authTokens: ['token'], adminToken: 'admin' },
      providers: [{
        id: 'openai-responses',
        type: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        apiKeyEnv: 'OPENAI_API_KEY',
        optional: true
      }]
    });

    expect(config.providers?.[0]?.type).toBe('openai-responses');
    expect(config.providers?.[0]?.apiKey).toBe('test-openai-key');
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/config-example.test.ts
```

Expected: FAIL because `openai-responses` is not in `ProviderType`.

- [ ] **Step 3: Add types**

In `src/types.ts`:

```ts
export type ProviderType = 'openai-compatible' | 'openai-responses' | 'codex' | 'gemini' | 'aistudio' | 'fake';
```

Add optional paths to `ProviderConfig`:

```ts
responsesPath?: string;
```

- [ ] **Step 4: Run test**

Run:

```powershell
npm test -- tests/config-example.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\types.ts tests\config-example.test.ts
git commit -m "Add OpenAI Responses provider config"
```

### Task 2: Implement Responses translation helpers

**Files:**
- Create: `src/translators/responses.ts`
- Test: `tests/openai-responses-provider.test.ts`

- [ ] **Step 1: Write failing translator tests**

Create `tests/openai-responses-provider.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { chatToResponsesRequest, responsesToChatResponse } from '../src/translators/responses.js';

describe('responses translators', () => {
  it('converts chat requests to OpenAI Responses input', () => {
    const converted = chatToResponsesRequest({
      model: 'gpt-5-codex',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.2
    });

    expect(converted.model).toBe('gpt-5-codex');
    expect(converted.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }]);
  });

  it('converts Responses output_text to chat completion shape', () => {
    const chat = responsesToChatResponse({
      id: 'resp_1',
      object: 'response',
      created_at: 1,
      model: 'gpt-5-codex',
      output_text: 'hello back'
    });

    expect(chat.id).toBe('chatcmpl_resp_1');
    expect(chat.choices[0]?.message.content).toBe('hello back');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/openai-responses-provider.test.ts
```

Expected: FAIL because translator file does not exist.

- [ ] **Step 3: Implement translator**

Create `src/translators/responses.ts`:

```ts
import type { ChatRequest, OpenAIChatResponse } from '../types.js';

export interface OpenAIResponsesRequest {
  model: string;
  input: unknown;
  stream?: boolean;
  temperature?: number;
  max_output_tokens?: number;
  [key: string]: unknown;
}

export interface OpenAIResponsesResponse {
  id: string;
  object: string;
  created_at?: number;
  model: string;
  output_text?: string;
  output?: unknown;
  usage?: unknown;
  [key: string]: unknown;
}

export function chatToResponsesRequest(request: ChatRequest): OpenAIResponsesRequest {
  return {
    ...request,
    input: request.messages.map((message) => ({
      role: message.role,
      content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: stringifyContent(message.content) }]
    })),
    max_output_tokens: request.max_tokens,
    messages: undefined
  };
}

export function responsesToChatResponse(response: OpenAIResponsesResponse): OpenAIChatResponse {
  const content = typeof response.output_text === 'string' ? response.output_text : JSON.stringify(response.output ?? '');
  return {
    id: response.id.startsWith('resp_') ? `chatcmpl_${response.id}` : response.id,
    object: 'chat.completion',
    created: response.created_at ?? Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    ...(response.usage ? { usage: response.usage as OpenAIChatResponse['usage'] } : {})
  };
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === 'object' && part !== null && 'text' in part ? String((part as { text: unknown }).text) : '').join('\n');
  }
  return content === undefined ? '' : String(content);
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- tests/openai-responses-provider.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\translators\responses.ts tests\openai-responses-provider.test.ts
git commit -m "Add OpenAI Responses translators"
```

### Task 3: Implement OpenAI Responses provider

**Files:**
- Create: `src/providers/openai-responses.ts`
- Modify: `src/providers/factory.ts`
- Modify: `tests/openai-responses-provider.test.ts`

- [ ] **Step 1: Write failing provider test**

Append:

```ts
import http from 'node:http';
import { OpenAIResponsesProvider } from '../src/providers/openai-responses.js';

it('posts chat requests to responses endpoint and returns chat shape', async () => {
  const server = http.createServer(async (req, res) => {
    expect(req.url).toBe('/v1/responses');
    expect(req.headers.authorization).toBe('Bearer test-key');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'resp_1', object: 'response', created_at: 1, model: 'gpt-5-codex', output_text: 'ok' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('bad address');
    const provider = new OpenAIResponsesProvider({
      id: 'openai-responses',
      type: 'openai-responses',
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      allowLocal: true,
      apiKey: 'test-key'
    });

    const result = await provider.chat({ model: 'gpt-5-codex', messages: [{ role: 'user', content: 'hi' }] });
    expect(result.response instanceof Response).toBe(false);
    expect((result.response as { choices: Array<{ message: { content: unknown } }> }).choices[0]?.message.content).toBe('ok');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/openai-responses-provider.test.ts
```

Expected: FAIL because provider file does not exist.

- [ ] **Step 3: Implement provider**

Create `src/providers/openai-responses.ts`. Reuse patterns from `src/providers/openai-compatible.ts`:

```ts
import { RouterError } from '../errors.js';
import type { ChatRequest, ModelInfo, ProviderAdapter, ProviderChatResult, ProviderConfig } from '../types.js';
import { chatToResponsesRequest, responsesToChatResponse, type OpenAIResponsesResponse } from '../translators/responses.js';

export class OpenAIResponsesProvider implements ProviderAdapter {
  readonly id: string;
  readonly type = 'openai-responses';
  readonly priority: number;
  readonly weight: number;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly modelsPath: string;
  private readonly responsesPath: string;

  constructor(config: ProviderConfig) {
    if (!config.baseUrl) {
      throw new RouterError(`Provider ${config.id} requires baseUrl`, { status: 400, code: 'invalid_config', retryable: false });
    }
    this.id = config.id;
    this.priority = config.priority ?? 100;
    this.weight = config.weight ?? 1;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.modelsPath = config.modelsPath ?? '/models';
    this.responsesPath = config.responsesPath ?? '/responses';
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await this.fetchJson(`${this.baseUrl}${this.modelsPath}`, { method: 'GET' });
    const data = response as { data?: Array<{ id?: string }> };
    return (data.data ?? []).map((model) => typeof model.id === 'string' ? { id: model.id, name: model.id, raw: model } : undefined)
      .filter((model): model is ModelInfo => model !== undefined);
  }

  async chat(request: ChatRequest): Promise<ProviderChatResult> {
    const body = chatToResponsesRequest(request);
    const response = await this.fetchRaw(`${this.baseUrl}${this.responsesPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (request.stream) {
      return { response, streamed: true };
    }
    const json = await response.json() as OpenAIResponsesResponse;
    return { response: responsesToChatResponse(json) };
  }

  private async fetchJson(url: string, init: RequestInit): Promise<unknown> {
    const response = await this.fetchRaw(url, init);
    return response.json();
  }

  private async fetchRaw(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          ...(init.headers ?? {})
        }
      });
      if (!response.ok) {
        throw new RouterError(await response.text(), { status: response.status, code: 'upstream_error' });
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

- [ ] **Step 4: Wire factory**

In `src/providers/factory.ts`:

```ts
import { OpenAIResponsesProvider } from './openai-responses.js';
```

Add:

```ts
if (config.type === 'openai-responses') {
  return new OpenAIResponsesProvider(config);
}
```

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/openai-responses-provider.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src\providers\openai-responses.ts src\providers\factory.ts tests\openai-responses-provider.test.ts
git commit -m "Add OpenAI Responses provider"
```

### Task 4: Add Codex provider wrapper

**Files:**
- Create: `src/providers/codex.ts`
- Modify: `src/providers/factory.ts`
- Test: `tests/openai-responses-provider.test.ts`

- [ ] **Step 1: Write failing Codex provider dispatch test**

Add:

```ts
import { createProvider } from '../src/providers/factory.js';

it('creates codex provider through factory', () => {
  const provider = createProvider({
    id: 'codex',
    type: 'codex',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test'
  });
  expect(provider.type).toBe('codex');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/openai-responses-provider.test.ts
```

Expected: FAIL because `codex` provider type is not handled.

- [ ] **Step 3: Implement CodexProvider**

Create `src/providers/codex.ts`:

```ts
import { OpenAIResponsesProvider } from './openai-responses.js';
import type { ChatRequest, ModelInfo, ProviderAdapter, ProviderChatResult, ProviderConfig } from '../types.js';

export class CodexProvider implements ProviderAdapter {
  readonly type = 'codex';
  private readonly inner: OpenAIResponsesProvider;

  constructor(config: ProviderConfig) {
    this.inner = new OpenAIResponsesProvider({
      ...config,
      baseUrl: config.baseUrl ?? 'https://api.openai.com/v1',
      responsesPath: config.responsesPath ?? '/responses'
    });
  }

  get id(): string {
    return this.inner.id;
  }

  get priority(): number {
    return this.inner.priority;
  }

  get weight(): number {
    return this.inner.weight;
  }

  listModels(): Promise<ModelInfo[]> {
    return this.inner.listModels();
  }

  chat(request: ChatRequest): Promise<ProviderChatResult> {
    return this.inner.chat(request);
  }
}
```

Wire in factory:

```ts
import { CodexProvider } from './codex.js';

if (config.type === 'codex') {
  return new CodexProvider(config);
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- tests/openai-responses-provider.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\providers\codex.ts src\providers\factory.ts tests\openai-responses-provider.test.ts
git commit -m "Add Codex provider wrapper"
```

### Task 4.5: Route `/v1/responses` through Responses-native providers

**Files:**
- Modify: `src/server.ts`
- Modify: `tests/server.test.ts`

- [ ] **Step 1: Write failing server passthrough test**

Add a fake provider-backed server test that posts to `/v1/responses` and expects a Responses-shaped response instead of the current lossy chat fallback:

```ts
it('returns native response shape for /v1/responses when router output is chat-normalized', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer dev-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ model: 'shared-model', input: 'hello' })
    });
    const body = await response.json() as { object?: string; output_text?: string };

    expect(response.status).toBe(200);
    expect(body.object).toBe('response');
    expect(typeof body.output_text).toBe('string');
  } finally {
    await closeServer(server);
  }
});
```

- [ ] **Step 2: Run test to verify it fails or captures current behavior**

Run:

```powershell
npm test -- tests/server.test.ts
```

Expected: FAIL if current `/v1/responses` output lacks required Responses fields.

- [ ] **Step 3: Tighten `chatToResponses` output**

In `src/server.ts`, keep the existing `responsesToChatRequest` bridge but ensure `chatToResponses` always emits:

```ts
{
  id,
  object: 'response',
  created_at,
  model,
  output_text,
  output: [
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: outputText }]
    }
  ],
  usage
}
```

Do not add streaming support in this task.

- [ ] **Step 4: Run test**

Run:

```powershell
npm test -- tests/server.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\server.ts tests\server.test.ts
git commit -m "Normalize responses endpoint output"
```

## Chunk 2: Gemini OAuth Auth Records and AI Studio Relay Surface

### Task 5: Add provider auth handler interface

**Files:**
- Create: `src/auth/providers/provider.ts`
- Modify: `src/auth/manager.ts`
- Test: `tests/auth-manager.test.ts`

- [ ] **Step 1: Write failing refresh handler test**

Add to `tests/auth-manager.test.ts`:

```ts
it('refreshes records with registered provider handlers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'free-ai-router-auth-'));
  try {
    const manager = await AuthManager.create({ authDir: dir });
    await manager.upsert({
      id: 'gemini-1',
      provider: 'gemini-oauth',
      status: 'expired',
      disabled: false,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      secrets: { refreshToken: 'refresh' }
    });

    manager.registerProviderHandler('gemini-oauth', {
      async refresh(record) {
        return { ...record, status: 'available', secrets: { accessToken: 'new-access', refreshToken: 'refresh' } };
      }
    });

    await manager.refreshDue();
    expect(manager.get('gemini-1')?.status).toBe('available');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/auth-manager.test.ts
```

Expected: FAIL because handlers do not exist.

- [ ] **Step 3: Add handler interface**

Create `src/auth/providers/provider.ts`:

```ts
import type { AuthRecord } from '../types.js';

export interface AuthProviderHandler {
  refresh?(record: AuthRecord): Promise<AuthRecord>;
}
```

Extend `AuthManager` with:

```ts
private readonly handlers = new Map<string, AuthProviderHandler>();

registerProviderHandler(provider: string, handler: AuthProviderHandler): void {
  this.handlers.set(provider, handler);
}

async refreshDue(now = new Date()): Promise<void> {
  for (const record of this.records.values()) {
    if (record.disabled) continue;
    if (record.status !== 'expired' && (!record.nextRefreshAfter || Date.parse(record.nextRefreshAfter) > now.getTime())) continue;
    const handler = this.handlers.get(record.provider);
    if (!handler?.refresh) continue;
    const refreshed = await handler.refresh(record);
    await this.upsert(refreshed);
  }
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- tests/auth-manager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\auth\providers\provider.ts src\auth\manager.ts tests\auth-manager.test.ts
git commit -m "Add auth provider refresh handlers"
```

### Task 6: Add Gemini OAuth token refresh handler

**Files:**
- Create: `src/auth/providers/gemini-oauth.ts`
- Test: `tests/gemini-oauth-auth.test.ts`

- [ ] **Step 1: Write fake token endpoint test**

Create `tests/gemini-oauth-auth.test.ts`:

```ts
import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { GeminiOAuthHandler } from '../src/auth/providers/gemini-oauth.js';

describe('GeminiOAuthHandler', () => {
  it('refreshes OAuth tokens through token endpoint', async () => {
    const server = http.createServer(async (req, res) => {
      expect(req.method).toBe('POST');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('bad address');
      const handler = new GeminiOAuthHandler({ tokenUrl: `http://127.0.0.1:${address.port}/token` });
      const record = await handler.refresh({
        id: 'gemini-1',
        provider: 'gemini-oauth',
        status: 'expired',
        disabled: false,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        secrets: { refreshToken: 'refresh-1' }
      });

      expect(record.status).toBe('available');
      expect(record.secrets?.accessToken).toBe('access-2');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/gemini-oauth-auth.test.ts
```

Expected: FAIL because handler does not exist.

- [ ] **Step 3: Implement handler**

Create `src/auth/providers/gemini-oauth.ts`:

```ts
import { RouterError } from '../../errors.js';
import type { AuthRecord } from '../types.js';
import type { AuthProviderHandler } from './provider.js';

export interface GeminiOAuthHandlerOptions {
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
}

export class GeminiOAuthHandler implements AuthProviderHandler {
  constructor(private readonly options: GeminiOAuthHandlerOptions = {}) {}

  async refresh(record: AuthRecord): Promise<AuthRecord> {
    const refreshToken = record.secrets?.refreshToken;
    if (!refreshToken) {
      throw new RouterError(`Auth ${record.id} has no refresh token`, { status: 400, code: 'invalid_auth', retryable: false });
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.options.clientId ?? String(record.attributes?.clientId ?? ''),
      client_secret: this.options.clientSecret ?? String(record.attributes?.clientSecret ?? '')
    });
    const response = await fetch(this.options.tokenUrl ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!response.ok) {
      throw new RouterError(await response.text(), { status: response.status, code: 'auth_refresh_failed', retryable: response.status >= 500 });
    }
    const json = await response.json() as { access_token: string; refresh_token?: string; expires_in?: number };
    const expiresAt = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString();
    return {
      ...record,
      status: 'available',
      updatedAt: new Date().toISOString(),
      lastRefreshedAt: new Date().toISOString(),
      nextRefreshAfter: new Date(Date.now() + Math.max(60, (json.expires_in ?? 3600) - 300) * 1000).toISOString(),
      secrets: {
        ...record.secrets,
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? refreshToken
      },
      metadata: { ...(record.metadata ?? {}), expiresAt }
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- tests/gemini-oauth-auth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\auth\providers\gemini-oauth.ts tests\gemini-oauth-auth.test.ts
git commit -m "Add Gemini OAuth refresh handler"
```

### Task 7: Add AI Studio provider skeleton

**Files:**
- Create: `src/providers/aistudio.ts`
- Modify: `src/providers/factory.ts`
- Test: `tests/aistudio-provider.test.ts`

- [ ] **Step 1: Write failing constructor/unsupported relay test**

Create `tests/aistudio-provider.test.ts`:

```ts
import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { AIStudioProvider } from '../src/providers/aistudio.js';

describe('AIStudioProvider', () => {
  it('forwards chat requests to a configured AI Studio relay', async () => {
    const server = http.createServer(async (req, res) => {
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/v1/aistudio/chat');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        id: 'chatcmpl_aistudio_1',
        object: 'chat.completion',
        created: 1,
        model: 'gemini-3-pro',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('bad address');
      const provider = new AIStudioProvider({
        id: 'aistudio',
        type: 'aistudio',
        baseUrl: `http://127.0.0.1:${address.port}/v1/aistudio`,
        allowLocal: true
      });
      const result = await provider.chat({ model: 'gemini-3-pro', messages: [{ role: 'user', content: 'hi' }] });
      expect((result.response as { choices: Array<{ message: { content: unknown } }> }).choices[0]?.message.content).toBe('ok');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/aistudio-provider.test.ts
```

Expected: FAIL because provider does not exist.

- [ ] **Step 3: Implement skeleton**

Create `src/providers/aistudio.ts`:

```ts
import { RouterError } from '../errors.js';
import type { ChatRequest, ModelInfo, ProviderAdapter, ProviderChatResult, ProviderConfig } from '../types.js';

export class AIStudioProvider implements ProviderAdapter {
  readonly id: string;
  readonly type = 'aistudio';
  readonly priority: number;
  readonly weight: number;
  private readonly relayUrl?: string;
  private readonly timeoutMs: number;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.priority = config.priority ?? 100;
    this.weight = config.weight ?? 1;
    this.relayUrl = config.baseUrl?.replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async chat(request: ChatRequest): Promise<ProviderChatResult> {
    if (!this.relayUrl) {
      throw new RouterError('AI Studio relay is not configured', { status: 400, code: 'invalid_config', retryable: false });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.relayUrl}/chat`, {
        method: 'POST',
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request)
      });
      if (!response.ok) {
        throw new RouterError(await response.text(), { status: response.status, code: 'upstream_error' });
      }
      if (request.stream) {
        return { response, streamed: true };
      }
      return { response: await response.json() as ProviderChatResult['response'] };
    } catch (error) {
      if (error instanceof RouterError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RouterError(`Provider ${this.id} timed out`, { status: 504, code: 'upstream_timeout' });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

Wire factory:

```ts
import { AIStudioProvider } from './aistudio.js';

if (config.type === 'aistudio') {
  return new AIStudioProvider(config);
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- tests/aistudio-provider.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\providers\aistudio.ts src\providers\factory.ts tests\aistudio-provider.test.ts
git commit -m "Add AI Studio provider skeleton"
```

### Task 8: Add docs and example config for Plan C

**Files:**
- Modify: `config.example.json`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Update `.env.example`**

Add:

```env
OPENAI_API_KEY=
OPENAI_RESPONSES_BASE_URL=https://api.openai.com/v1
```

- [ ] **Step 2: Update `config.example.json`**

Add optional providers:

```json
{
  "id": "openai-responses",
  "type": "openai-responses",
  "baseUrlEnv": "OPENAI_RESPONSES_BASE_URL",
  "apiKeyEnv": "OPENAI_API_KEY",
  "optional": true
},
{
  "id": "codex",
  "type": "codex",
  "baseUrl": "https://api.openai.com/v1",
  "apiKeyEnv": "OPENAI_API_KEY",
  "optional": true
}
```

Add model group:

```json
{
  "name": "codex-latest",
  "aliases": ["gpt-5-codex"],
  "routes": [
    { "provider": "codex", "model": "gpt-5-codex" }
  ]
}
```

- [ ] **Step 3: Update README**

Add provider setup section:

```md
### OpenAI Responses / Codex

Set `OPENAI_API_KEY` and enable the optional `openai-responses` or `codex` provider. The provider sends chat requests through the Responses API and normalizes non-streaming responses to chat-completion shape.
```

- [ ] **Step 4: Run checks**

Run:

```powershell
npm test -- tests/config-example.test.ts tests/openai-responses-provider.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add README.md config.example.json .env.example
git commit -m "Document Codex and Responses providers"
```

### Task 9: Final verification for Plan C

- [ ] **Step 1: Run full checks**

```powershell
npm run build
npm run typecheck
npm test
npm run smoke
npm audit --audit-level=moderate
```

Expected: all exit 0.

- [ ] **Step 2: Commit stabilization fixes**

```powershell
git status --short
# If fixes were made, stage only the files changed by those fixes.
git add src tests README.md config.example.json .env.example
git commit -m "Stabilize Codex and Gemini channel support"
```

- [ ] **Step 3: Request code review**

Use the required code review workflow before starting Plan D.
