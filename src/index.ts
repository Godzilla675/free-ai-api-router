#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createModelRegistry } from './model-registry.js';
import { createProviders } from './providers/factory.js';
import { createServer } from './server.js';
import { AuthManager } from './auth/manager.js';
import { logger } from './logger.js';


export async function startServer(configPath?: string): Promise<{ server: http.Server; refreshTimer: NodeJS.Timeout }> {
  const resolvedConfigPath = configPath ?? getArg('--config') ?? process.env.FREE_AI_ROUTER_CONFIG ?? 'config.json';
  const config = await loadConfig(resolvedConfigPath);
  const providers = createProviders(config.providers ?? []);
  const registry = createModelRegistry(providers, config);
  await registry.refresh();
  const authManager = await AuthManager.create({ authDir: config.auth?.authDir ?? 'router-state/auth' });
  
  // Start background auth refresh loop
  const refreshIntervalMs = config.auth?.refreshIntervalMs ?? 60_000;
  authManager.refreshDue().catch((err) => {
    logger.error('Failed to run initial auth refresh check', err);
  });
  const refreshTimer = setInterval(() => {
    authManager.refreshDue().catch((err) => {
      logger.error('Failed to refresh credentials in background', err);
    });
  }, refreshIntervalMs);
  refreshTimer.unref();

  const server = createServer({ providers, registry, config, authManager });
  const host = config.server?.host ?? '127.0.0.1';
  const port = config.server?.port ?? 8080;
  server.listen(port, host, () => {
    logger.info(`Free AI API Router listening on http://${host}:${port}`);
  });

  return { server, refreshTimer };
}

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]).toLowerCase() : '';
const modulePath = path.resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (entryPath === modulePath) {
  startServer().catch((err) => {
    logger.error('Server failed to start', err);
    process.exit(1);
  });
}
