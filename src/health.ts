import type { Deployment } from './types.js';

interface HealthEntry {
  consecutiveFailures: number;
  cooldownUntil: number;
  lastError?: string;
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

  markFailure(deployment: Deployment, error: string, retryable: boolean, now = Date.now()): void {
    if (!retryable) {
      return;
    }
    const previous = this.entries.get(deployment.id) ?? { consecutiveFailures: 0, cooldownUntil: 0 };
    const failures = previous.consecutiveFailures + 1;
    const threshold = this.options.failureThreshold ?? 1;
    const cooldownMs = this.options.cooldownMs ?? 30_000;
    this.entries.set(deployment.id, {
      consecutiveFailures: failures,
      cooldownUntil: failures >= threshold ? now + cooldownMs : 0,
      lastError: error
    });
  }

  snapshot(): Record<string, HealthEntry> {
    return Object.fromEntries(this.entries.entries());
  }
}
