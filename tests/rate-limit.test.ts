import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/rate-limit.js';
import type { LimitConfig } from '../src/types.js';

describe('rate limiter', () => {
  it('blocks requests after an rpm window is exhausted', () => {
    const limiter = new RateLimiter({ users: { default: { rpm: 2, tpm: 100 } } } as LimitConfig);
    const first = limiter.reserve({ userId: 'alice', modelId: 'qwen', providerId: 'groq', deploymentId: 'groq:qwen', estimatedTokens: 1, now: 0 });
    const second = limiter.reserve({ userId: 'alice', modelId: 'qwen', providerId: 'groq', deploymentId: 'groq:qwen', estimatedTokens: 1, now: 1_000 });
    const third = limiter.reserve({ userId: 'alice', modelId: 'qwen', providerId: 'groq', deploymentId: 'groq:qwen', estimatedTokens: 1, now: 2_000 });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBe(58_000);
  });

  it('applies provider and deployment limits in addition to user limits', () => {
    const limiter = new RateLimiter({
      users: { default: { rpm: 100, tpm: 1000 } },
      providers: { groq: { rpm: 1, tpm: 1000 } },
      deployments: { 'groq:qwen': { rpm: 5, tpm: 1000 } }
    } as LimitConfig);

    expect(limiter.reserve({ userId: 'alice', modelId: 'qwen', providerId: 'groq', deploymentId: 'groq:qwen', estimatedTokens: 1, now: 0 }).allowed).toBe(true);
    const blocked = limiter.reserve({ userId: 'bob', modelId: 'qwen', providerId: 'groq', deploymentId: 'groq:qwen', estimatedTokens: 1, now: 10 });

    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe('provider:groq');
  });

  it('releases max parallel reservations', () => {
    const limiter = new RateLimiter({ users: { default: { rpm: 100, tpm: 1000, maxParallel: 1 } } } as LimitConfig);
    const first = limiter.reserve({ userId: 'alice', modelId: 'qwen', providerId: 'groq', deploymentId: 'groq:qwen', estimatedTokens: 1, now: 0 });
    const second = limiter.reserve({ userId: 'alice', modelId: 'qwen', providerId: 'groq', deploymentId: 'groq:qwen', estimatedTokens: 1, now: 1 });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.scope).toBe('parallel:user:alice');

    first.release();

    expect(limiter.reserve({ userId: 'alice', modelId: 'qwen', providerId: 'groq', deploymentId: 'groq:qwen', estimatedTokens: 1, now: 2 }).allowed).toBe(true);
  });
});
