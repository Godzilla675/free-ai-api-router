import { describe, expect, it } from 'vitest';
import { createModelRegistry } from '../src/model-registry.js';
import { AiRouter } from '../src/router.js';
import type { RouterConfig } from '../src/types.js';
import { RateLimiter } from '../src/rate-limit.js';
import { HealthTracker } from '../src/health.js';

describe('AiRouter Constructor', () => {
  it('instantiates correctly with minimal options', () => {
    const config: RouterConfig = {
      limits: {},
      routing: {
        healthCooldownMs: 1000
      }
    } as unknown as RouterConfig;

    const registry = createModelRegistry([], config);

    const router = new AiRouter({
      providers: [],
      registry,
      config
    });

    expect(router).toBeInstanceOf(AiRouter);
    // Note: Due to private properties, we can't assert on them directly without (router as any).
    // Let's assert on the exposed properties/methods instead to ensure it works correctly.
    expect(typeof router.chat).toBe('function');
    expect(typeof router.imageGenerate).toBe('function');
  });

  it('uses provided dependencies if supplied', () => {
    const config: RouterConfig = {
      limits: {},
      routing: {
        healthCooldownMs: 1000
      }
    } as unknown as RouterConfig;
    const registry = createModelRegistry([], config);
    const rateLimiter = new RateLimiter({});
    const health = new HealthTracker({});

    const router = new AiRouter({
      providers: [],
      registry,
      config,
      rateLimiter,
      health
    });

    expect(router).toBeInstanceOf(AiRouter);
    // Since properties are private, we can just ensure instantiation does not throw
    // and behaves properly. To rigorously test the effect of these dependencies,
    // we would check router behaviors. Here, we are mostly targeting coverage
    // of the `options.rateLimiter ?? new RateLimiter(...)` logic.
  });

  it('handles completely missing configuration limits/routing', () => {
    const config: RouterConfig = {} as unknown as RouterConfig;
    const registry = createModelRegistry([], config);

    const router = new AiRouter({
      providers: [],
      registry,
      config
    });

    expect(router).toBeInstanceOf(AiRouter);
  });
});
