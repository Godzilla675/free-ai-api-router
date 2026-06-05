import type { Deployment } from './types.js';

export interface HealthError {
  message: string;
  status?: number | undefined;
  retryable: boolean;
  updatedAt: string;
}

export interface HealthEntry {
  consecutiveFailures: number;
  cooldownUntil: number;
  lastError?: HealthError | undefined;
}

export class HealthTracker {
  private readonly entries = new Map<string, HealthEntry>();

  constructor(private readonly options: { cooldownMs?: number; failureThreshold?: number } = {}) {}

  isAvailable(deployment: Deployment, now = Date.now()): boolean {
    const entry = this.entries.get(deployment.id);
    return !entry || entry.cooldownUntil <= now;
  }

  markSuccess(deployment: Deployment): void {
    this.entries.set(deployment.id, { consecutiveFailures: 0, cooldownUntil: 0 });
  }

  markFailure(
    deployment: Deployment,
    error: string,
    retryable: boolean,
    options?: { statusCode?: number | undefined; retryAfterMs?: number | undefined; now?: number | undefined }
  ): void {
    if (!retryable) {
      return;
    }
    const previous = this.entries.get(deployment.id) ?? { consecutiveFailures: 0, cooldownUntil: 0 };
    const failures = previous.consecutiveFailures + 1;
    const threshold = this.options.failureThreshold ?? 1;
    const now = options?.now ?? Date.now();
    const cooldownMs = options?.retryAfterMs !== undefined && options.retryAfterMs > 0
      ? options.retryAfterMs
      : (this.options.cooldownMs ?? 30_000);

    this.entries.set(deployment.id, {
      consecutiveFailures: failures,
      cooldownUntil: failures >= threshold ? now + cooldownMs : 0,
      lastError: {
        message: error,
        status: options?.statusCode,
        retryable,
        updatedAt: new Date(now).toISOString()
      }
    });
  }

  snapshot(): Record<string, HealthEntry> {
    return Object.fromEntries(this.entries.entries());
  }
}
