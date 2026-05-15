import { RouterError } from '../errors.js';
import type { ChatRequest, ModelInfo, OpenAIChatResponse, ProviderAdapter, ProviderChatResult, ProviderConfig } from '../types.js';

export class OpenAICompatibleProvider implements ProviderAdapter {
  readonly id: string;
  readonly type = 'openai-compatible';
  readonly priority: number;
  readonly weight: number;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly modelsPath: string;
  private readonly chatPath: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly modelFilter: string | undefined;

  constructor(config: ProviderConfig) {
    if (!config.baseUrl) {
      throw new RouterError(`Provider ${config.id} requires baseUrl`, { status: 400, code: 'invalid_config', retryable: false });
    }
    this.id = config.id;
    this.priority = config.priority ?? 100;
    this.weight = config.weight ?? 1;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.modelsPath = config.modelsPath ?? '/models';
    this.chatPath = config.chatPath ?? '/chat/completions';
    this.headers = config.headers ?? {};
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.modelFilter = config.modelFilter;
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await this.fetchJson(`${this.baseUrl}${this.modelsPath}`, { method: 'GET' });
    const data = response as { data?: unknown[]; models?: unknown[] };
    const models = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
    return models
      .map((model) => this.parseModel(model))
      .filter((model): model is ModelInfo => model !== undefined)
      .filter((model) => !this.modelFilter || this.matchesFilter(model));
  }

  async chat(request: ChatRequest): Promise<ProviderChatResult> {
    const response = await this.fetchRaw(`${this.baseUrl}${this.chatPath}`, {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { 'content-type': 'application/json' }
    });

    if (request.stream) {
      return { response, streamed: true };
    }

    let json: OpenAIChatResponse;
    try {
      json = (await response.json()) as OpenAIChatResponse;
    } catch {
      throw new RouterError(`Invalid upstream JSON from ${this.id}`, { status: 502, code: 'invalid_upstream_response' });
    }
    return {
      response: json,
      usage: usageTokens(json.usage?.prompt_tokens, json.usage?.completion_tokens, json.usage?.total_tokens)
    };
  }

  private parseModel(model: unknown): ModelInfo | undefined {
    if (typeof model === 'string') {
      return { id: model, name: model };
    }
    if (typeof model !== 'object' || model === null) {
      return undefined;
    }
    const record = model as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : typeof record.name === 'string' ? record.name : undefined;
    if (!id) {
      return undefined;
    }
    return {
      id,
      name: typeof record.name === 'string' ? record.name : id,
      raw: model
    };
  }

  private matchesFilter(model: ModelInfo): boolean {
    if (this.modelFilter === 'free') {
      return /(^|[:/-])free($|[:/-])|free/i.test(model.id) || JSON.stringify(model.raw ?? {}).includes('"0"');
    }
    return model.id.includes(this.modelFilter ?? '');
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
          ...this.authHeaders(),
          ...this.headers,
          ...(init.headers ?? {})
        }
      });
      if (!response.ok) {
        throw new RouterError(await errorMessage(response), { status: response.status, code: 'upstream_error' });
      }
      return response;
    } catch (error) {
      if (error instanceof RouterError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RouterError(`Provider ${this.id} timed out`, { status: 504, code: 'upstream_timeout' });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private authHeaders(): Record<string, string> {
    return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
  }
}

function usageTokens(promptTokens?: number, completionTokens?: number, totalTokens?: number) {
  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {})
  };
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return `Upstream returned HTTP ${response.status}`;
  }
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
    return redactSecrets(parsed.error?.message ?? parsed.message ?? text);
  } catch {
    return redactSecrets(text);
  }
}

function redactSecrets(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/key=([^&\s]+)/gi, 'key=[REDACTED]')
    .replace(/api[_-]?key[=:]\s*[^\s,&}]+/gi, 'api_key=[REDACTED]');
}
