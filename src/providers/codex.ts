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
