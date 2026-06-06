import { RouterError } from '../errors.js';
import type { ChatRequest, ImageRequest, ModelInfo, OpenAIChatResponse, ProviderAdapter, ProviderChatResult, ProviderConfig, ProviderImageResult } from '../types.js';

export class OpenAICompatibleProvider implements ProviderAdapter {
  readonly id: string;
  readonly type = 'openai-compatible';
  readonly priority: number;
  readonly weight: number;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly modelsPath: string;
  private readonly chatPath: string;
  private readonly imagesPath: string;
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
    this.imagesPath = config.imagesPath ?? '/images/generations';
    this.headers = config.headers ?? {};
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.modelFilter = config.modelFilter;
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await this.fetchJson(`${this.baseUrl}${this.modelsPath}`, { method: 'GET' });
    const data = response as { data?: unknown[]; models?: unknown[] };
    const models = Array.isArray(response) ? response : Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
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

  async imageGenerate(request: ImageRequest): Promise<ProviderImageResult> {
    const response = await this.fetchRaw(`${this.baseUrl}${this.imagesPath}`, {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { 'content-type': 'application/json' }
    });
    return { response };
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
      ...modelMetadata(record),
      raw: model
    };
  }

  private matchesFilter(model: ModelInfo): boolean {
    if (this.modelFilter === 'free') {
      const raw = model.raw;
      if (typeof raw === 'object' && raw !== null && 'pricing' in raw) {
        const pricing = (raw as { pricing?: unknown }).pricing;
        if (typeof pricing !== 'object' || pricing === null) {
          return this.id !== 'openrouter';
        }
        const prompt = (pricing as { prompt?: unknown }).prompt;
        const completion = (pricing as { completion?: unknown }).completion;
        return isZeroPrice(prompt) && isZeroPrice(completion);
      }
      if (model.id.includes(':free') || /(^|[:/-])free($|[:/-])/i.test(model.id)) {
        return true;
      }
      if (typeof raw !== 'object' || raw === null || !('pricing' in raw)) {
        return this.id !== 'openrouter';
      }
    }
    return model.id.includes(this.modelFilter ?? '');
  }

  private async fetchJson(url: string, init: RequestInit): Promise<unknown> {
    const response = await this.fetchRaw(url, init);
    try {
      return await response.json();
    } catch {
      throw new RouterError(`Invalid upstream JSON from ${this.id}`, { status: 502, code: 'invalid_upstream_response' });
    }
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
        throw new RouterError(await errorMessage(response), { status: response.status, code: 'upstream_error', details: retryAfterDetails(response) });
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

function modelMetadata(record: Record<string, unknown>): Pick<ModelInfo, 'contextWindow' | 'inputModalities' | 'outputModalities'> {
  const architecture = typeof record.architecture === 'object' && record.architecture !== null ? record.architecture as Record<string, unknown> : undefined;
  return {
    ...numberField(record.context_window ?? record.context_length ?? limitValue(record.limits, 'max_input_tokens'), 'contextWindow'),
    ...stringArrayField(architecture?.input_modalities ?? record.supported_input_modalities, 'inputModalities'),
    ...stringArrayField(architecture?.output_modalities ?? record.supported_output_modalities, 'outputModalities')
  };
}

function limitValue(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function numberField(value: unknown, key: 'contextWindow'): Pick<ModelInfo, 'contextWindow'> {
  return typeof value === 'number' && Number.isFinite(value) ? { [key]: value } : {};
}

function stringArrayField(value: unknown, key: 'inputModalities' | 'outputModalities'): Pick<ModelInfo, 'inputModalities' | 'outputModalities'> {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? { [key]: value } : {};
}

function isZeroPrice(value: unknown): boolean {
  if (typeof value === 'number') {
    return value === 0;
  }
  if (typeof value === 'string') {
    return Number(value) === 0;
  }
  return false;
}

function retryAfterDetails(response: Response): { retryAfterMs: number } | undefined {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) {
    return undefined;
  }
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) {
    return { retryAfterMs: Math.max(0, seconds * 1000) };
  }
  const date = Date.parse(retryAfter);
  if (Number.isFinite(date)) {
    return { retryAfterMs: Math.max(0, date - Date.now()) };
  }
  return undefined;
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
