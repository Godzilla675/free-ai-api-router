import { RouterError } from '../errors.js';
import type { ChatRequest, ModelInfo, ProviderAdapter, ProviderChatResult, ProviderConfig } from '../types.js';
import { chatToResponsesRequest, responsesToChatResponse, type OpenAIResponsesResponse } from '../translators/responses.js';

export class OpenAIResponsesProvider implements ProviderAdapter {
  readonly id: string;
  readonly type = 'openai-responses';
  readonly priority: number;
  readonly weight: number;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
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
    const models: ModelInfo[] = [];
    for (const model of data.data ?? []) {
      if (typeof model.id === 'string') {
        models.push({ id: model.id, name: model.id, raw: model });
      }
    }
    return models;
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
        const text = await response.text();
        throw new RouterError(redactSecrets(text), { status: response.status, code: 'upstream_error' });
      }
      return response;
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

function redactSecrets(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/key=([^&\s]+)/gi, 'key=[REDACTED]')
    .replace(/api[_-]?key[=:]\s*[^\s,&}]+/gi, 'api_key=[REDACTED]');
}
