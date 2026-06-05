import { RouterError } from '../errors.js';
import type { ChatRequest, ModelInfo, ProviderAdapter, ProviderChatResult, ProviderConfig } from '../types.js';

export class AIStudioProvider implements ProviderAdapter {
  readonly id: string;
  readonly type = 'aistudio';
  readonly priority: number;
  readonly weight: number;
  private readonly relayUrl: string | undefined;
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
        const text = await response.text();
        throw new RouterError(redactSecrets(text), { status: response.status, code: 'upstream_error' });
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

function redactSecrets(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/key=([^&\s]+)/gi, 'key=[REDACTED]')
    .replace(/api[_-]?key[=:]\s*[^\s,&}]+/gi, 'api_key=[REDACTED]');
}
