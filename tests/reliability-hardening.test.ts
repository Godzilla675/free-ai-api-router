import { describe, expect, it } from 'vitest';
import { createModelRegistry } from '../src/model-registry.js';
import { AiRouter } from '../src/router.js';
import type { ChatRequest, ProviderAdapter, RouterConfig } from '../src/types.js';

describe('reliability hardening', () => {
  it('preserves dynamic models when all provider refreshes fail and config groups exist', async () => {
    let fail = false;
    const provider: ProviderAdapter = {
      id: 'groq',
      type: 'fake',
      priority: 0,
      async listModels() {
        if (fail) throw new Error('outage');
        return [{ id: 'dynamic-only' }];
      },
      async chat() { throw new Error('not used'); }
    };
    const config = { models: [{ name: 'configured', routes: [{ provider: 'groq', model: 'configured-upstream' }] }] } as RouterConfig;
    const registry = createModelRegistry([provider], config);

    await registry.refresh();
    fail = true;
    await registry.refresh();

    expect(registry.resolve('dynamic-only')).toHaveLength(1);
    expect(registry.resolve('configured')).toHaveLength(1);
  });

  it('charges user rpm once for a fallback chain', async () => {
    const calls: string[] = [];
    const first = fakeProvider('a', async () => {
      calls.push('a');
      const error = new Error('rate limited') as Error & { status?: number };
      error.status = 429;
      throw error;
    });
    const second = fakeProvider('b', async (request) => {
      calls.push('b');
      return {
        response: {
          id: 'chatcmpl_b',
          object: 'chat.completion',
          created: 1,
          model: request.model,
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
        }
      };
    });
    const config = { limits: { users: { default: { rpm: 1, tpm: 1000 } } }, routing: { strategy: 'priority', maxFallbacks: 2 } } as RouterConfig;
    const registry = createModelRegistry([first, second], config);
    await registry.refresh();
    const router = new AiRouter({ providers: [first, second], registry, config });

    await expect(router.chat({ model: 'shared', messages: [{ role: 'user', content: 'hi' }] }, { userId: 'alice' })).resolves.toBeDefined();
    await expect(router.chat({ model: 'shared', messages: [{ role: 'user', content: 'hi again' }] }, { userId: 'alice' })).rejects.toThrow(/Rate limit exceeded/);
    expect(calls).toEqual(['a', 'b']);
  });

  it('falls back for streaming errors that happen before an upstream stream is returned', async () => {
    const first = fakeProvider('a', async () => {
      const error = new Error('upstream busy') as Error & { status?: number };
      error.status = 503;
      throw error;
    });
    const second = fakeProvider('b', async () => ({
      response: new Response('data: {"ok":true}\n\n', { headers: { 'content-type': 'text/event-stream' } }),
      streamed: true
    }));
    const config = { routing: { strategy: 'priority', maxFallbacks: 2 } } as RouterConfig;
    const registry = createModelRegistry([first, second], config);
    await registry.refresh();
    const router = new AiRouter({ providers: [first, second], registry, config });

    const result = await router.chat({ model: 'shared', stream: true, messages: [{ role: 'user', content: 'hi' }] }, { userId: 'alice' });

    expect(result.deployment.providerId).toBe('b');
    expect(result.response).toBeInstanceOf(Response);
  });

  it('retries model registry refresh after a TTL refresh failure', async () => {
    let refreshes = 0;
    const provider = fakeProvider('a', async (request) => ({
      response: {
        id: 'chatcmpl_a',
        object: 'chat.completion',
        created: 1,
        model: request.model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
      }
    }));
    const registry = {
      async refresh() {
        refreshes += 1;
        if (refreshes === 1) throw new Error('refresh failed');
        return [];
      },
      list() { return []; },
      resolve() {
        return [{ id: 'a:shared', providerId: 'a', providerType: 'fake', upstreamModel: 'shared', modelGroup: 'shared', priority: 0, weight: 1 }];
      }
    };
    const router = new AiRouter({ providers: [provider], registry, config: { routing: { modelRefreshTtlMs: 1 } } as RouterConfig });

    await expect(router.chat({ model: 'shared', messages: [{ role: 'user', content: 'hi' }] }, { userId: 'alice' })).rejects.toThrow('refresh failed');
    await expect(router.chat({ model: 'shared', messages: [{ role: 'user', content: 'hi' }] }, { userId: 'alice' })).resolves.toBeDefined();
    expect(refreshes).toBe(2);
  });
});

function fakeProvider(id: string, chat: ProviderAdapter['chat']): ProviderAdapter {
  return {
    id,
    type: 'fake',
    priority: id === 'a' ? 0 : 1,
    async listModels() { return [{ id: 'shared' }]; },
    chat
  };
}
