#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createModelRegistry } from './model-registry.js';
import { createProviders } from './providers/factory.js';
import { createServer } from './server.js';
import { AuthManager } from './auth/manager.js';


async function main(): Promise<void> {
  const configPath = getArg('--config') ?? process.env.FREE_AI_ROUTER_CONFIG ?? 'config.json';
  const config = await loadConfig(configPath);
  const providers = createProviders(config.providers ?? []);
  const registry = createModelRegistry(providers, config);
  await registry.refresh();
  const authManager = await AuthManager.create({ authDir: config.auth?.authDir ?? 'router-state/auth' });
  
  // Start background auth refresh loop
  const refreshIntervalMs = config.auth?.refreshIntervalMs ?? 60_000;
  authManager.refreshDue().catch((err) => {
    console.error('Failed to run initial auth refresh check:', err instanceof Error ? err.message : err);
  });
  const refreshTimer = setInterval(() => {
    authManager.refreshDue().catch((err) => {
      console.error('Failed to refresh credentials in background:', err instanceof Error ? err.message : err);
    });
  }, refreshIntervalMs);
  refreshTimer.unref();

  const server = createServer({ providers, registry, config, authManager });
  const host = config.server?.host ?? '127.0.0.1';
  const port = config.server?.port ?? 8080;
  server.listen(port, host, () => {
    console.log(`Free AI API Router listening on http://${host}:${port}`);
  });
}

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
