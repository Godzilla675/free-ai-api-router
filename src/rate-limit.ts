import type { LimitConfig, LimitRule } from './types.js';

export interface ReservationInput {
  userId: string;
  modelId: string;
  providerId: string;
  deploymentId: string;
  estimatedTokens: number;
  now?: number;
  scopeTypes?: Array<'global' | 'user' | 'model' | 'provider' | 'deployment'>;
}

export interface RateLimitReservation {
  allowed: boolean;
  scope?: string;
  retryAfterMs?: number;
  release(): void;
}

interface Counter {
  windowStart: number;
  requests: number;
  tokens: number;
}

export class RateLimiter {
  private readonly counters = new Map<string, Counter>();
  private readonly parallel = new Map<string, number>();

  constructor(private readonly limits: LimitConfig = {}) {}

  reserve(input: ReservationInput): RateLimitReservation {
    const now = input.now ?? Date.now();
    const scopes = this.scopes(input);

    for (const [scope, rule] of scopes) {
      const parallelResult = this.checkParallel(scope, rule);
      if (!parallelResult.allowed) {
        return parallelResult;
      }
      const fixedWindowResult = this.checkFixedWindow(scope, rule, input.estimatedTokens, now);
      if (!fixedWindowResult.allowed) {
        return fixedWindowResult;
      }
    }

    const releaseScopes: string[] = [];
    for (const [scope, rule] of scopes) {
      this.incrementFixedWindow(scope, input.estimatedTokens, now);
      if (rule.maxParallel !== undefined) {
        this.parallel.set(scope, (this.parallel.get(scope) ?? 0) + 1);
        releaseScopes.push(scope);
      }
    }

    let released = false;
    return {
      allowed: true,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        for (const scope of releaseScopes) {
          this.parallel.set(scope, Math.max(0, (this.parallel.get(scope) ?? 1) - 1));
        }
      }
    };
  }

  private scopes(input: ReservationInput): Array<[string, LimitRule]> {
    const limits: Array<[string, LimitRule | undefined]> = [
      ['global', this.limits.global],
      [`user:${input.userId}`, this.limits.users?.[input.userId] ?? this.limits.users?.default],
      [`model:${input.modelId}`, this.limits.models?.[input.modelId]],
      [`provider:${input.providerId}`, this.limits.providers?.[input.providerId]],
      [`deployment:${input.deploymentId}`, this.limits.deployments?.[input.deploymentId]]
    ];
    const allowed = new Set(input.scopeTypes ?? ['global', 'user', 'model', 'provider', 'deployment']);
    const typed: Array<['global' | 'user' | 'model' | 'provider' | 'deployment', string, LimitRule | undefined]> = [
      ['global', 'global', this.limits.global],
      ['user', `user:${input.userId}`, this.limits.users?.[input.userId] ?? this.limits.users?.default],
      ['model', `model:${input.modelId}`, this.limits.models?.[input.modelId]],
      ['provider', `provider:${input.providerId}`, this.limits.providers?.[input.providerId]],
      ['deployment', `deployment:${input.deploymentId}`, this.limits.deployments?.[input.deploymentId]]
    ];
    return typed.filter((scope): scope is ['global' | 'user' | 'model' | 'provider' | 'deployment', string, LimitRule] => allowed.has(scope[0]) && scope[2] !== undefined).map(([, scope, rule]) => [scope, rule]);
  }

  private checkParallel(scope: string, rule: LimitRule): RateLimitReservation {
    if (rule.maxParallel === undefined) {
      return allowReservation;
    }
    const inFlight = this.parallel.get(scope) ?? 0;
    if (inFlight >= rule.maxParallel) {
      return { allowed: false, scope: `parallel:${scope}`, retryAfterMs: 1_000, release() {} };
    }
    return allowReservation;
  }

  private checkFixedWindow(scope: string, rule: LimitRule, tokens: number, now: number): RateLimitReservation {
    const counter = this.getCounter(scope, now);
    if (rule.rpm !== undefined && counter.requests >= rule.rpm) {
      return { allowed: false, scope, retryAfterMs: counter.windowStart + 60_000 - now, release() {} };
    }
    if (rule.tpm !== undefined && counter.tokens + tokens > rule.tpm) {
      return { allowed: false, scope, retryAfterMs: counter.windowStart + 60_000 - now, release() {} };
    }
    return allowReservation;
  }

  private incrementFixedWindow(scope: string, tokens: number, now: number): void {
    const counter = this.getCounter(scope, now);
    counter.requests += 1;
    counter.tokens += tokens;
  }

  private getCounter(scope: string, now: number): Counter {
    const windowStart = Math.floor(now / 60_000) * 60_000;
    const existing = this.counters.get(scope);
    if (existing && existing.windowStart === windowStart) {
      return existing;
    }
    const counter = { windowStart, requests: 0, tokens: 0 };
    this.counters.set(scope, counter);
    return counter;
  }
}

const allowReservation: RateLimitReservation = { allowed: true, release() {} };
