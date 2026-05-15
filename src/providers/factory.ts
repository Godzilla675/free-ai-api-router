import { GeminiProvider } from './gemini.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { ProviderAdapter, ProviderConfig } from '../types.js';
import { RouterError } from '../errors.js';

export function createProvider(config: ProviderConfig): ProviderAdapter {
  if (config.type === 'openai-compatible') {
    return new OpenAICompatibleProvider(config);
  }
  if (config.type === 'gemini') {
    return new GeminiProvider(config);
  }
  throw new RouterError(`Unsupported provider type: ${config.type}`, { status: 400, code: 'invalid_config', retryable: false });
}

export function createProviders(configs: ProviderConfig[] = []): ProviderAdapter[] {
  return configs.map(createProvider);
}
