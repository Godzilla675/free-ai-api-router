import { describe, expect, it } from 'vitest';
import { createModelRegistry } from '../src/model-registry.js';
import { AiRouter } from '../src/router.js';
import type { ChatRequest, OpenAIChatResponse, ProviderAdapter, RouterConfig } from '../src/types.js';

function provider(id: string, behavior: 'retryable-error' | 'auth-error' | 'success'): ProviderAdapter & { calls: number } {
  return {
    id,
    type: 'fake',
    priority: id === 'a' ? 0 : 10,
    calls: 0,
    async listModels() {
      return [{ id: 'shared-model' }];
    },
    async chat(request: ChatRequest) {
      this.calls += 1;
      if (behavior === 'retryable-error') {
        const error = new Error('rate limited') as Error & { status?: number };
        error.status = 429;
        throw error;
      }
      if (behavior === 'auth-error') {
        const error = new Error('bad key') as Error & { status?: number };
        error.status = 401;
        throw error;
      }
      return {
        response: {
          id: `chatcmpl_${id}`,
          object: 'chat.completion',
          created: 1,
          model: request.model,
          choices: [{ index: 0, message: { role: 'assistant', content: `from ${id}` }, finish_reason: 'stop' }]
        },
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
      };
    }
  };
}

describe('AI router fallback', () => {
  it('falls back to the next deployment on retryable provider errors', async () => {
    const first = provider('a', 'retryable-error');
    const second = provider('b', 'success');
    const registry = createModelRegistry([first, second], { models: [] } as unknown as RouterConfig);
    await registry.refresh();
    const router = new AiRouter({ providers: [first, second], registry, config: { routing: { strategy: 'priority', maxFallbacks: 2 } } as RouterConfig });

    const result = await router.chat({ model: 'shared-model', messages: [{ role: 'user', content: 'hi' }] }, { userId: 'test-user' });

    expect(first.calls).toBe(1);
    expect(second.calls).toBe(1);
    expect((result.response as OpenAIChatResponse).choices[0]?.message.content).toBe('from b');
    expect(result.attempts.map((attempt) => attempt.providerId)).toEqual(['a', 'b']);
  });

  it('does not fallback on authentication errors', async () => {
    const first = provider('a', 'auth-error');
    const second = provider('b', 'success');
    const registry = createModelRegistry([first, second], { models: [] } as unknown as RouterConfig);
    await registry.refresh();
    const router = new AiRouter({ providers: [first, second], registry, config: { routing: { strategy: 'priority', maxFallbacks: 2 } } as RouterConfig });

    await expect(router.chat({ model: 'shared-model', messages: [{ role: 'user', content: 'hi' }] }, { userId: 'test-user' })).rejects.toThrow('bad key');
    expect(second.calls).toBe(0);
  });
});
