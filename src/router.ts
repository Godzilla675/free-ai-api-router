import { randomUUID } from 'node:crypto';
import { getErrorStatus, getRetryAfterMs, isRetryableError, RouterError } from './errors.js';
import type { HealthEntry } from './health.js';
import { HealthTracker } from './health.js';
import type { ModelRegistry } from './model-registry.js';
import { RateLimiter } from './rate-limit.js';
import { MemoryUsageRecorder, type UsageRecorder } from './usage.js';
import type { AttemptRecord, ChatContext, ChatRequest, Deployment, ProviderAdapter, RoutedChatResult, RouterConfig, UsageTokens } from './types.js';
import { SessionAffinityTracker, extractSessionKey } from './scheduler/session-affinity.js';
import { RoundRobinSelector } from './scheduler/selector.js';

export interface AiRouterOptions {
  providers: ProviderAdapter[];
  registry: ModelRegistry;
  config: RouterConfig;
  rateLimiter?: RateLimiter;
  health?: HealthTracker;
  usage?: UsageRecorder;
}

export class AiRouter {
  private readonly providers: Map<string, ProviderAdapter>;
  private readonly rateLimiter: RateLimiter;
  private readonly health: HealthTracker;
  private readonly usage: UsageRecorder;
  private lastRegistryRefresh = 0;
  private readonly sessionAffinity: SessionAffinityTracker;
  private readonly roundRobinSelector: RoundRobinSelector;

  constructor(private readonly options: AiRouterOptions) {
    this.providers = new Map(options.providers.map((provider) => [provider.id, provider]));
    this.rateLimiter = options.rateLimiter ?? new RateLimiter(options.config.limits ?? {});
    this.health = options.health ?? new HealthTracker(options.config.routing?.healthCooldownMs !== undefined ? { cooldownMs: options.config.routing.healthCooldownMs } : {});
    this.usage = options.usage ?? new MemoryUsageRecorder();
    this.sessionAffinity = new SessionAffinityTracker(
      options.config.routing?.sessionAffinityTtlMs,
      options.config.routing?.sessionAffinityMaxEntries
    );
    this.roundRobinSelector = new RoundRobinSelector();
  }

  getSelectionCursor(deployment: Deployment): number | undefined {
    if (this.options.config.routing?.strategy === 'round-robin') {
      return this.roundRobinSelector.getCursor(deployment.modelGroup);
    }
    return undefined;
  }

  async chat(request: ChatRequest, context: ChatContext): Promise<RoutedChatResult> {
    await this.refreshRegistryIfStale();
    const requestId = context.requestId ?? randomUUID();
    const deployments = this.selectCandidates(request, context);
    if (deployments.length === 0) {
      throw new RouterError(`No deployment available for model ${request.model}`, { status: 404, code: 'model_not_found', retryable: false });
    }

    const attempts: AttemptRecord[] = [];
    const maxAttempts = Math.max(1, Math.min(deployments.length, (this.options.config.routing?.maxFallbacks ?? 3) + 1));
    let lastError: unknown;
    const estimatedTokens = estimateTokens(request);
    const clientReservation = this.rateLimiter.reserve({
      userId: context.userId,
      modelId: deployments[0]?.modelGroup ?? request.model,
      providerId: 'client',
      deploymentId: 'client',
      estimatedTokens,
      scopeTypes: ['global', 'user', 'model']
    });
    if (!clientReservation.allowed) {
      throw new RouterError(`Rate limit exceeded for ${clientReservation.scope}`, {
        status: 429,
        code: 'rate_limit_exceeded',
        retryable: true,
        details: { retryAfterMs: clientReservation.retryAfterMs }
      });
    }

    try {
      for (const deployment of deployments.slice(0, maxAttempts)) {
        const provider = this.providers.get(deployment.providerId);
        if (!provider || !this.health.isAvailable(deployment)) {
          continue;
        }

        const reservation = this.rateLimiter.reserve({
          userId: context.userId,
          modelId: deployment.modelGroup,
          providerId: deployment.providerId,
          deploymentId: deployment.id,
          estimatedTokens,
          scopeTypes: ['provider', 'deployment']
        });
        if (!reservation.allowed) {
          lastError = new RouterError(`Rate limit exceeded for ${reservation.scope}`, {
            status: 429,
            code: 'rate_limit_exceeded',
            retryable: true,
            details: { retryAfterMs: reservation.retryAfterMs }
          });
          continue;
        }

        const start = Date.now();
        const upstreamRequest = { ...request, model: deployment.upstreamModel };
        try {
          const result = await provider.chat(upstreamRequest, deployment);
          const latencyMs = Date.now() - start;
          const usage = result.usage;
          const attempt = this.attempt({ requestId, deployment, status: 'success', retryable: false, latencyMs, ...(usage ? { usage } : {}) });
          attempts.push(attempt);
          this.health.markSuccess(deployment);

          const sessionKey = this.options.config.routing?.sessionAffinity
            ? extractSessionKey(context.headers ?? {}, request)
            : undefined;
          if (sessionKey) {
            this.sessionAffinity.set(sessionKey, deployment.id);
          }

          await this.recordUsage({ attempt, context, request, deployment, fallbackIndex: attempts.length - 1 });
          return { response: result.response, attempts, deployment };
        } catch (error) {
          const latencyMs = Date.now() - start;
          const retryable = isRetryableError(error);
          const statusCode = getErrorStatus(error);
          const retryAfterMs = getRetryAfterMs(error);
          const attempt = this.attempt({
            requestId,
            deployment,
            status: 'error',
            retryable,
            latencyMs,
            error: error instanceof Error ? error.message : String(error),
            ...(statusCode !== undefined ? { statusCode } : {})
          });
          attempts.push(attempt);
          this.health.markFailure(deployment, attempt.error ?? 'unknown error', retryable, { statusCode, retryAfterMs });
          await this.recordUsage({ attempt, context, request, deployment, fallbackIndex: attempts.length - 1 });
          lastError = error;
          if (!retryable) {
            throw error;
          }
        } finally {
          reservation.release();
        }
      }

      if (lastError) {
        throw lastError;
      }
      throw new RouterError(`No healthy deployment available for model ${request.model}`, { status: 503, code: 'no_healthy_deployment' });
    } finally {
      clientReservation.release();
    }
  }

  healthSnapshot(): Record<string, HealthEntry> {
    return this.health.snapshot();
  }

  recentUsage(limit?: number) {
    return this.usage.recent(limit);
  }

  private selectCandidates(request: ChatRequest, context: ChatContext): Deployment[] {
    let deployments = this.options.registry.resolve(request.model).filter((deployment) => this.providers.has(deployment.providerId));

    const sessionKey = this.options.config.routing?.sessionAffinity
      ? extractSessionKey(context.headers ?? {}, request)
      : undefined;

    let boundDeploymentId: string | undefined = undefined;
    if (sessionKey) {
      boundDeploymentId = this.sessionAffinity.get(sessionKey);
    }

    if (boundDeploymentId) {
      const boundIdx = deployments.findIndex((d) => d.id === boundDeploymentId);
      if (boundIdx !== -1 && this.health.isAvailable(deployments[boundIdx]!)) {
        const boundDeployment = deployments[boundIdx]!;
        deployments.splice(boundIdx, 1);
        deployments.unshift(boundDeployment);
        return deployments;
      }
    }

    const strategy = this.options.config.routing?.strategy;
    if (strategy === 'weighted') {
      deployments = weightedSort(deployments);
    } else if (strategy === 'round-robin') {
      deployments = this.roundRobinSelector.select(deployments);
    } else {
      // priority or fill-first or default
    }

    // Session affinity binding happens on success in chat(), not here.

    return deployments;
  }

  private async refreshRegistryIfStale(): Promise<void> {
    const ttl = this.options.config.routing?.modelRefreshTtlMs;
    if (!ttl || ttl <= 0) {
      return;
    }
    const now = Date.now();
    if (now - this.lastRegistryRefresh < ttl) {
      return;
    }
    try {
      await this.options.registry.refresh();
      this.lastRegistryRefresh = now;
    } catch (error) {
      this.lastRegistryRefresh = 0;
      throw error;
    }
  }

  private attempt(input: {
    requestId: string;
    deployment: Deployment;
    status: 'success' | 'error';
    retryable: boolean;
    latencyMs: number;
    error?: string;
    statusCode?: number;
    usage?: UsageTokens;
  }): AttemptRecord {
    return compactAttempt({
      requestId: input.requestId,
      providerId: input.deployment.providerId,
      deploymentId: input.deployment.id,
      upstreamModel: input.deployment.upstreamModel,
      status: input.status,
      retryable: input.retryable,
      latencyMs: input.latencyMs,
      ...(input.error !== undefined ? { error: input.error } : {}),
      ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
      ...(input.usage !== undefined ? { usage: input.usage } : {})
    });
  }

  private async recordUsage(input: {
    attempt: AttemptRecord;
    context: ChatContext;
    request: ChatRequest;
    deployment: Deployment;
    fallbackIndex: number;
  }): Promise<void> {
    await this.usage.record({
      ...input.attempt,
      userId: input.context.userId,
      requestedModel: input.request.model,
      modelGroup: input.deployment.modelGroup,
      timestamp: new Date().toISOString(),
      fallbackIndex: input.fallbackIndex
    });
  }
}

function compactAttempt(attempt: {
  requestId: string;
  providerId: string;
  deploymentId: string;
  upstreamModel: string;
  status: 'success' | 'error';
  retryable: boolean;
  latencyMs: number;
  error?: string;
  statusCode?: number;
  usage?: UsageTokens;
}): AttemptRecord {
  return {
    requestId: attempt.requestId,
    providerId: attempt.providerId,
    deploymentId: attempt.deploymentId,
    upstreamModel: attempt.upstreamModel,
    status: attempt.status,
    retryable: attempt.retryable,
    latencyMs: attempt.latencyMs,
    ...(attempt.error !== undefined ? { error: attempt.error } : {}),
    ...(attempt.statusCode !== undefined ? { statusCode: attempt.statusCode } : {}),
    ...(attempt.usage !== undefined ? { usage: attempt.usage } : {})
  };
}

function estimateTokens(request: ChatRequest): number {
  const text = JSON.stringify(request.messages ?? []);
  const outputReserve = typeof request.max_tokens === 'number' ? request.max_tokens : 0;
  return Math.max(1, Math.ceil(text.length / 4) + outputReserve);
}

function weightedSort(deployments: Deployment[]): Deployment[] {
  return [...deployments].sort((a, b) => score(b) - score(a));
}

function score(deployment: Deployment): number {
  return Math.random() * Math.max(1, deployment.weight) - deployment.priority / 10_000;
}
