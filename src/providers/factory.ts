import { GeminiProvider } from './gemini.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { OpenAIResponsesProvider } from './openai-responses.js';
import { CodexProvider } from './codex.js';
import { AIStudioProvider } from './aistudio.js';
import { ClaudeProvider } from './claude.js';
import { XAIProvider } from './xai.js';
import { KimiProvider } from './kimi.js';
import type { ProviderAdapter, ProviderConfig } from '../types.js';
import { RouterError } from '../errors.js';

export function createProvider(config: ProviderConfig): ProviderAdapter {
  if (config.type === 'openai-compatible') {
    return new OpenAICompatibleProvider(config);
  }
  if (config.type === 'gemini') {
    return new GeminiProvider(config);
  }
  if (config.type === 'openai-responses') {
    return new OpenAIResponsesProvider(config);
  }
  if (config.type === 'codex') {
    return new CodexProvider(config);
  }
  if (config.type === 'aistudio') {
    return new AIStudioProvider(config);
  }
  if (config.type === 'claude') {
    return new ClaudeProvider(config);
  }
  if (config.type === 'xai') {
    return new XAIProvider(config);
  }
  if (config.type === 'kimi') {
    return new KimiProvider(config);
  }
  throw new RouterError(`Unsupported provider type: ${config.type}`, { status: 400, code: 'invalid_config', retryable: false });
}

export function createProviders(configs: ProviderConfig[] = []): ProviderAdapter[] {
  return configs.map(createProvider);
}
