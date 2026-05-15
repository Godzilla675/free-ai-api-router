import { describe, expect, it } from 'vitest';
import { createModelRegistry } from '../src/model-registry.js';
import type { ModelInfo, ProviderAdapter, RouterConfig } from '../src/types.js';

function fakeProvider(id: string, models: ModelInfo[]): ProviderAdapter {
  return {
    id,
    type: 'fake',
    priority: 0,
    async listModels() {
      return models;
    },
    async chat() {
      throw new Error('not used');
    }
  };
}

describe('model registry', () => {
  it('groups exact dynamic model matches across providers', async () => {
    const registry = createModelRegistry(
      [
        fakeProvider('groq', [{ id: 'qwen/qwen3-32b', name: 'Qwen 3 32B' }]),
        fakeProvider('openrouter', [{ id: 'qwen/qwen3-32b', name: 'Qwen 3 32B Free' }])
      ],
      { models: [] } as unknown as RouterConfig
    );

    const models = await registry.refresh();
    const group = models.find((model) => model.id === 'qwen/qwen3-32b');

    expect(group?.deployments.map((deployment) => deployment.providerId)).toEqual(['groq', 'openrouter']);
  });

  it('overlays configured aliases and provider-specific routes', async () => {
    const registry = createModelRegistry(
      [
        fakeProvider('gemini', [{ id: 'models/gemini-3.1-pro', name: 'Gemini 3.1 Pro' }]),
        fakeProvider('openrouter', [{ id: 'google/gemini-3.1-pro:free', name: 'Gemini 3.1 Pro Free' }])
      ],
      {
        models: [
          {
            name: 'gemini-3.1-pro',
            aliases: ['gemini-pro'],
            routes: [
              { provider: 'gemini', model: 'models/gemini-3.1-pro' },
              { provider: 'openrouter', model: 'google/gemini-3.1-pro:free' }
            ]
          }
        ]
      } as unknown as RouterConfig
    );

    await registry.refresh();

    expect(registry.resolve('gemini-pro').map((deployment) => deployment.providerId)).toEqual(['gemini', 'openrouter']);
    expect(registry.resolve('gemini-3.1-pro').map((deployment) => deployment.upstreamModel)).toEqual([
      'models/gemini-3.1-pro',
      'google/gemini-3.1-pro:free'
    ]);
  });

  it('keeps the last successful snapshot when a refresh fails', async () => {
    let shouldFail = false;
    const provider: ProviderAdapter = {
      id: 'groq',
      type: 'fake',
      priority: 0,
      async listModels() {
        if (shouldFail) {
          throw new Error('upstream unavailable');
        }
        return [{ id: 'llama-3.1-8b-instant' }];
      },
      async chat() {
        throw new Error('not used');
      }
    };

    const registry = createModelRegistry([provider], { models: [] } as unknown as RouterConfig);

    await registry.refresh();
    shouldFail = true;
    await registry.refresh();

    expect(registry.resolve('llama-3.1-8b-instant')).toHaveLength(1);
  });
});
