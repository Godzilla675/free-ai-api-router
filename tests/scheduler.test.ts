import { describe, expect, it } from 'vitest';
import { createModelRegistry } from '../src/model-registry.js';
import { AiRouter } from '../src/router.js';
import { RouterError } from '../src/errors.js';
import type { ChatRequest, ProviderAdapter, RouterConfig } from '../src/types.js';

function provider(id: string, priority = 10): ProviderAdapter & { calls: number } {
  return {
    id,
    type: 'fake',
    priority,
    calls: 0,
    async listModels() {
      return [{ id: 'shared-model' }];
    },
    async chat(request: ChatRequest) {
      this.calls += 1;
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

describe('Scheduler and routing strategies', () => {
  // planA-rr-001
  it('planA-rr-001: 3 deployments same model, round-robin strategy rotates deterministically', async () => {
    const p1 = provider('a', 10);
    const p2 = provider('b', 10);
    const p3 = provider('c', 10);
    const registry = createModelRegistry([p1, p2, p3], { models: [] } as unknown as RouterConfig);
    await registry.refresh();

    const router = new AiRouter({
      providers: [p1, p2, p3],
      registry,
      config: {
        routing: { strategy: 'round-robin', maxFallbacks: 3 }
      } as RouterConfig
    });

    const runChat = () => router.chat({ model: 'shared-model', messages: [{ role: 'user', content: 'hi' }] }, { userId: 'user-1' });

    // Request 1
    const res1 = await runChat();
    expect(res1.deployment.providerId).toBe('a');

    // Request 2
    const res2 = await runChat();
    expect(res2.deployment.providerId).toBe('b');

    // Request 3
    const res3 = await runChat();
    expect(res3.deployment.providerId).toBe('c');

    // Request 4 (wraps around)
    const res4 = await runChat();
    expect(res4.deployment.providerId).toBe('a');
  });

  // planA-ff-001
  it('planA-ff-001: 3 deployments same model, fill-first strategy always selects first healthy deployment', async () => {
    const p1 = provider('a', 10);
    const p2 = provider('b', 10);
    const p3 = provider('c', 10);
    const registry = createModelRegistry([p1, p2, p3], { models: [] } as unknown as RouterConfig);
    await registry.refresh();

    const router = new AiRouter({
      providers: [p1, p2, p3],
      registry,
      config: {
        routing: { strategy: 'fill-first', maxFallbacks: 3 }
      } as RouterConfig
    });

    const runChat = () => router.chat({ model: 'shared-model', messages: [{ role: 'user', content: 'hi' }] }, { userId: 'user-1' });

    const res1 = await runChat();
    expect(res1.deployment.providerId).toBe('a');

    const res2 = await runChat();
    expect(res2.deployment.providerId).toBe('a');
  });

  // planA-sa-001
  it('planA-sa-001: repeated requests with same session key keeps affinity', async () => {
    const p1 = provider('a', 10);
    const p2 = provider('b', 10);
    const registry = createModelRegistry([p1, p2], { models: [] } as unknown as RouterConfig);
    await registry.refresh();

    const router = new AiRouter({
      providers: [p1, p2],
      registry,
      config: {
        routing: { strategy: 'round-robin', sessionAffinity: true }
      } as RouterConfig
    });

    // Request with headers session key
    const res1 = await router.chat(
      { model: 'shared-model', messages: [{ role: 'user', content: 'hi' }] },
      { userId: 'user-1', headers: { 'X-Session-ID': 'session-123' } }
    );
    const firstSelected = res1.deployment.providerId;

    // Request 2 with same session key
    const res2 = await router.chat(
      { model: 'shared-model', messages: [{ role: 'user', content: 'hello' }] },
      { userId: 'user-1', headers: { 'X-Session-ID': 'session-123' } }
    );
    expect(res2.deployment.providerId).toBe(firstSelected);

    // Request 3 with different session key should cycle or select differently
    const res3 = await router.chat(
      { model: 'shared-model', messages: [{ role: 'user', content: 'yo' }] },
      { userId: 'user-1', headers: { 'X-Session-ID': 'session-456' } }
    );
    expect(res3.deployment.providerId).not.toBe(firstSelected);
  });

  // planA-sa-002
  it('planA-sa-002: bound deployment enters cooldown -> affinity rebinds to next eligible deployment', async () => {
    const p1 = provider('a', 10);
    const p2 = provider('b', 10);
    const registry = createModelRegistry([p1, p2], { models: [] } as unknown as RouterConfig);
    await registry.refresh();

    const router = new AiRouter({
      providers: [p1, p2],
      registry,
      config: {
        routing: { strategy: 'priority', sessionAffinity: true, healthCooldownMs: 1000 }
      } as RouterConfig
    });

    // Request 1: binds session-1 to 'a'
    const res1 = await router.chat(
      { model: 'shared-model', messages: [{ role: 'user', content: 'hi' }] },
      { userId: 'user-1', headers: { 'X-Session-ID': 'session-1' } }
    );
    expect(res1.deployment.providerId).toBe('a');

    // Force failure on 'a' to enter cooldown
    p1.chat = async () => {
      const err = new Error('rate limited') as Error & { status?: number };
      err.status = 429;
      throw err;
    };

    // Request 2: 'a' fails, falls back to 'b', and binds session-1 to 'b'
    const res2 = await router.chat(
      { model: 'shared-model', messages: [{ role: 'user', content: 'hi' }] },
      { userId: 'user-1', headers: { 'X-Session-ID': 'session-1' } }
    );
    expect(res2.deployment.providerId).toBe('b');

    // Request 3: even if 'a' becomes healthy again, session-1 is now bound to 'b'
    p1.chat = async (req) => {
      return {
        response: {
          id: `chatcmpl_a`,
          object: 'chat.completion',
          created: 1,
          model: req.model,
          choices: [{ index: 0, message: { role: 'assistant', content: 'from a' }, finish_reason: 'stop' }]
        }
      };
    };

    const res3 = await router.chat(
      { model: 'shared-model', messages: [{ role: 'user', content: 'hi' }] },
      { userId: 'user-1', headers: { 'X-Session-ID': 'session-1' } }
    );
    expect(res3.deployment.providerId).toBe('b');
  });

  // planA-ra-001
  it('planA-ra-001: retryable failure with Retry-After header uses custom cooldown', async () => {
    const p1 = provider('a', 10);
    const p2 = provider('b', 10);
    const registry = createModelRegistry([p1, p2], { models: [] } as unknown as RouterConfig);
    await registry.refresh();

    const router = new AiRouter({
      providers: [p1, p2],
      registry,
      config: {
        routing: { strategy: 'priority', healthCooldownMs: 10000 }
      } as RouterConfig
    });

    // Mock first provider failure with Retry-After: 5 seconds (5000ms)
    p1.chat = async () => {
      throw new RouterError('Too Many Requests', {
        status: 429,
        details: { retryAfterMs: 5000 }
      });
    };

    const startTime = Date.now();

    // Call chat: 'a' fails and is cooldown scheduled for 5s. falls back to 'b'.
    const res1 = await router.chat({ model: 'shared-model', messages: [{ role: 'user', content: 'hi' }] }, { userId: 'user-1' });
    expect(res1.deployment.providerId).toBe('b');

    // Check health status details: cooldown should be around 5s
    const snapshot = router.healthSnapshot() as Record<string, any>;
    const entry = snapshot['a:shared-model'];
    expect(entry).toBeDefined();
    expect(entry.cooldownUntil).toBeGreaterThanOrEqual(startTime + 4900);
    expect(entry.cooldownUntil).toBeLessThanOrEqual(startTime + 5500);
  });
});
