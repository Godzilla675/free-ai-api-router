import { RouterError } from '../errors.js';
import type { ChatRequest, ModelInfo, ProviderAdapter, ProviderChatResult, ProviderConfig } from '../types.js';

export class XAIProvider implements ProviderAdapter {
  readonly id: string;
  readonly type = 'xai';
  readonly priority: number;
  readonly weight: number;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.priority = config.priority ?? 100;
    this.weight = config.weight ?? 1;
  }

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async chat(_request: ChatRequest): Promise<ProviderChatResult> {
    throw new RouterError('xAI provider execution is not implemented yet', { status: 501, code: 'not_implemented', retryable: false });
  }
}
