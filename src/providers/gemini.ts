import { RouterError } from '../errors.js';
import type { ChatMessage, ChatRequest, ModelInfo, OpenAIChatResponse, ProviderAdapter, ProviderChatResult, ProviderConfig } from '../types.js';

export class GeminiProvider implements ProviderAdapter {
  readonly id: string;
  readonly type = 'gemini';
  readonly priority: number;
  readonly weight: number;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

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
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await this.fetchJson(`${this.baseUrl}/models`, { method: 'GET' });
    const models = (response as { models?: Array<Record<string, unknown>> }).models ?? [];
    return models
      .filter((model) => Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods.includes('generateContent') : true)
      .map((model) => ({
        id: String(model.name ?? ''),
        name: typeof model.displayName === 'string' ? model.displayName : String(model.name ?? ''),
        inputModalities: ['text', 'image'],
        raw: model
      }))
      .filter((model) => model.id.length > 0);
  }

  async chat(request: ChatRequest): Promise<ProviderChatResult> {
    if (request.stream) {
      throw new RouterError('Gemini streaming is not enabled in this adapter yet', { status: 400, code: 'streaming_unsupported', retryable: false });
    }
    validateGeminiRequest(request);
    const geminiModel = request.model.startsWith('models/') ? request.model : `models/${request.model}`;
    const body = toGeminiRequest(request);
    const response = await this.fetchJson(`${this.baseUrl}/${geminiModel}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const normalized = fromGeminiResponse(response, request.model);
    return {
      response: normalized,
      usage: usageTokens(normalized.usage?.prompt_tokens, normalized.usage?.completion_tokens, normalized.usage?.total_tokens)
    };
  }

  private async fetchJson(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          ...(this.apiKey ? { 'x-goog-api-key': this.apiKey } : {}),
          ...(init.headers ?? {})
        }
      });
      if (!response.ok) {
        throw new RouterError(redactSecrets(await response.text()), { status: response.status, code: 'upstream_error' });
      }
      try {
        return await response.json();
      } catch {
        throw new RouterError(`Invalid upstream JSON from ${this.id}`, { status: 502, code: 'invalid_upstream_response' });
      }
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
}

function validateGeminiRequest(request: ChatRequest): void {
  if (request.tools || request.tool_choice) {
    throw new RouterError('Gemini adapter does not yet support OpenAI tool calls', { status: 400, code: 'unsupported_request', retryable: false });
  }
  for (const message of request.messages) {
    if (message.role === 'tool' || message.tool_calls) {
      throw new RouterError('Gemini adapter does not yet support tool messages', { status: 400, code: 'unsupported_request', retryable: false });
    }
    if (Array.isArray(message.content) && message.content.some((part) => typeof part !== 'object' || part === null || !('text' in part))) {
      throw new RouterError('Gemini adapter only supports text content parts in this release', { status: 400, code: 'unsupported_request', retryable: false });
    }
  }
}

function toGeminiRequest(request: ChatRequest): Record<string, unknown> {
  const systemMessages = request.messages.filter((message) => message.role === 'system');
  const conversationMessages = request.messages.filter((message) => message.role !== 'system');
  return {
    contents: conversationMessages.map(toGeminiContent),
    systemInstruction: systemMessages.length > 0 ? { parts: systemMessages.map((message) => ({ text: textContent(message.content) })) } : undefined,
    generationConfig: {
      temperature: request.temperature,
      maxOutputTokens: request.max_tokens,
      topP: request.top_p
    }
  };
}

function toGeminiContent(message: ChatMessage): Record<string, unknown> {
  return {
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: textContent(message.content) }]
  };
}

function textContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'object' && part !== null && 'text' in part ? String((part as { text: unknown }).text) : '')).join('\n');
  }
  return content === undefined ? '' : String(content);
}

function fromGeminiResponse(response: unknown, model: string): OpenAIChatResponse {
  const record = response as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  };
  const candidate = record.candidates?.[0];
  if (!candidate) {
    throw new RouterError(`Gemini returned no candidates${record.promptFeedback?.blockReason ? `: ${record.promptFeedback.blockReason}` : ''}`, {
      status: 400,
      code: 'upstream_blocked',
      retryable: false
    });
  }
  const content = candidate?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  if (content.length === 0) {
    throw new RouterError('Gemini returned an empty candidate', { status: 502, code: 'invalid_upstream_response' });
  }
  return {
    id: `chatcmpl_gemini_${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: candidate?.finishReason?.toLowerCase() ?? 'stop' }],
    usage: compactOpenAIUsage(record.usageMetadata?.promptTokenCount, record.usageMetadata?.candidatesTokenCount, record.usageMetadata?.totalTokenCount)
  };
}

function redactSecrets(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/key=([^&\s]+)/gi, 'key=[REDACTED]')
    .replace(/api[_-]?key[=:]\s*[^\s,&}]+/gi, 'api_key=[REDACTED]');
}

function usageTokens(promptTokens?: number, completionTokens?: number, totalTokens?: number) {
  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {})
  };
}

function compactOpenAIUsage(promptTokens?: number, completionTokens?: number, totalTokens?: number) {
  return {
    ...(promptTokens !== undefined ? { prompt_tokens: promptTokens } : {}),
    ...(completionTokens !== undefined ? { completion_tokens: completionTokens } : {}),
    ...(totalTokens !== undefined ? { total_tokens: totalTokens } : {})
  };
}
