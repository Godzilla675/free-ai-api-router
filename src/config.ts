import { readFile } from 'node:fs/promises';
import type { ProviderConfig, RouterConfig } from './types.js';
import { RouterError } from './errors.js';

export async function loadConfig(path: string): Promise<RouterConfig> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as RouterConfig;
  return normalizeConfig(parsed);
}

export function normalizeConfig(config: RouterConfig): RouterConfig {
  const allProviderIds = new Set((config.providers ?? []).map((provider) => provider.id));
  const providers = (config.providers ?? [])
    .map(resolveProviderSecrets)
    .filter((provider) => provider.apiKey || provider.type === 'fake' || provider.allowLocal || false);
  const activeProviderIds = new Set(providers.map((provider) => provider.id));
  const models = (config.models ?? []).map((model) => ({
    ...model,
    routes: model.routes.filter((route) => activeProviderIds.has(route.provider))
  })).filter((model) => model.routes.length > 0);

  for (const model of config.models ?? []) {
    for (const route of model.routes) {
      if (!allProviderIds.has(route.provider)) {
        throw new RouterError(`Configured model ${model.name} references unknown provider ${route.provider}`, {
          status: 400,
          code: 'invalid_config',
          retryable: false
        });
      }
    }
  }

  const normalized: RouterConfig = {
    ...config,
    server: {
      host: '127.0.0.1',
      port: 8080,
      requestTimeoutMs: 120_000,
      maxBodyBytes: 1_048_576,
      ...(config.server ?? {})
    },
    routing: {
      strategy: 'priority',
      maxFallbacks: 3,
      healthCooldownMs: 30_000,
      debugHeaders: false,
      modelRefreshTtlMs: 300_000,
      ...(config.routing ?? {})
    },
    limits: config.limits ?? {},
    storage: config.storage ?? {},
    providers,
    models
  };

  validateConfig(normalized);
  return normalized;
}

function resolveProviderSecrets(provider: ProviderConfig): ProviderConfig {
  const apiKey = provider.apiKey ?? (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined);
  return apiKey ? { ...provider, apiKey } : { ...provider };
}

function validateConfig(config: RouterConfig): void {
  const authTokens = config.server?.authTokens ?? [];
  if (authTokens.length === 0 || authTokens.some((token) => token.trim().length === 0)) {
    throw new RouterError('server.authTokens must contain at least one non-empty token', { status: 400, code: 'invalid_config', retryable: false });
  }
  if (!config.server?.adminToken?.trim()) {
    throw new RouterError('server.adminToken must be configured', { status: 400, code: 'invalid_config', retryable: false });
  }

  const providerIds = new Set<string>();
  for (const provider of config.providers ?? []) {
    if (!provider.id) {
      throw new RouterError('Provider id is required', { status: 400, code: 'invalid_config', retryable: false });
    }
    if (providerIds.has(provider.id)) {
      throw new RouterError(`Duplicate provider id: ${provider.id}`, { status: 400, code: 'invalid_config', retryable: false });
    }
    providerIds.add(provider.id);
    if (provider.type !== 'fake' && !provider.baseUrl) {
      throw new RouterError(`Provider ${provider.id} requires baseUrl`, { status: 400, code: 'invalid_config', retryable: false });
    }
    validateProviderUrl(provider);
  }

  for (const model of config.models ?? []) {
    if (!model.name) {
      throw new RouterError('Configured model name is required', { status: 400, code: 'invalid_config', retryable: false });
    }
    for (const route of model.routes) {
      if (!providerIds.has(route.provider)) {
        throw new RouterError(`Configured model ${model.name} references unknown provider ${route.provider}`, {
          status: 400,
          code: 'invalid_config',
          retryable: false
        });
      }
    }
  }
}

function validateProviderUrl(provider: ProviderConfig): void {
  if (!provider.baseUrl || provider.type === 'fake') {
    return;
  }
  let url: URL;
  try {
    url = new URL(provider.baseUrl);
  } catch {
    throw new RouterError(`Provider ${provider.id} has an invalid baseUrl`, { status: 400, code: 'invalid_config', retryable: false });
  }
  const local = isLocalAddress(url.hostname);
  if (url.protocol !== 'https:') {
    if (provider.allowLocal && local) {
      return;
    }
    throw new RouterError(`Provider ${provider.id} must use https unless allowLocal is true for a local or private address`, {
      status: 400,
      code: 'invalid_config',
      retryable: false
    });
  }
  if (local && !provider.allowLocal) {
    throw new RouterError(`Provider ${provider.id} points to a local or private address; set allowLocal true if intentional`, {
      status: 400,
      code: 'invalid_config',
      retryable: false
    });
  }
}

function isLocalAddress(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host.startsWith('127.')) {
    return true;
  }
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
}
