#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createModelRegistry } from './model-registry.js';
import { createProviders } from './providers/factory.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const configPath = getArg('--config') ?? process.env.FREE_AI_ROUTER_CONFIG ?? 'config.json';
  const config = await loadConfig(configPath);
  const providers = createProviders(config.providers ?? []);
  const registry = createModelRegistry(providers, config);
  await registry.refresh();
  const server = createServer({ providers, registry, config });
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
