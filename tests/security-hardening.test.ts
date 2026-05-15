import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeConfig } from '../src/config.js';
import { RouterError } from '../src/errors.js';
import { createModelRegistry } from '../src/model-registry.js';
import { createServer } from '../src/server.js';
import type { ProviderAdapter, RouterConfig } from '../src/types.js';

const servers: http.Server[] = [];

async function listen(server: http.Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('invalid address');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))));
});

describe('security hardening', () => {
  it('fails closed when auth tokens are missing', () => {
    expect(() => normalizeConfig({ providers: [], server: { adminToken: 'admin' } })).toThrow(RouterError);
    expect(() => normalizeConfig({ providers: [], server: { authTokens: ['token'] } })).toThrow(RouterError);
  });

  it('rejects oversized JSON bodies', async () => {
    const provider: ProviderAdapter = {
      id: 'fake',
      type: 'fake',
      priority: 0,
      async listModels() { return [{ id: 'free-model' }]; },
      async chat() { throw new Error('should not be called'); }
    };
    const config = normalizeConfig({
      server: { authTokens: ['secret'], adminToken: 'admin', maxBodyBytes: 20 },
      providers: [],
      models: []
    });
    const registry = createModelRegistry([provider], config);
    await registry.refresh();
    const baseUrl = await listen(createServer({ providers: [provider], registry, config }));

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'free-model', messages: [{ role: 'user', content: 'too large' }] })
    });

    expect(response.status).toBe(413);
  });

  it('blocks non-https provider URLs unless explicitly allowed local', () => {
    expect(() => normalizeConfig({
      server: { authTokens: ['token'], adminToken: 'admin' },
      providers: [{ id: 'bad', type: 'openai-compatible', baseUrl: 'http://169.254.169.254/v1', apiKey: 'x' }]
    })).toThrow(/must use https/);

    expect(() => normalizeConfig({
      server: { authTokens: ['token'], adminToken: 'admin' },
      providers: [{ id: 'local', type: 'openai-compatible', baseUrl: 'http://127.0.0.1:4096/v1', optional: true, allowLocal: true }]
    })).not.toThrow();
  });

  it('requires explicit local permission for private network provider URLs', () => {
    expect(() => normalizeConfig({
      server: { authTokens: ['token'], adminToken: 'admin' },
      providers: [{ id: 'lan', type: 'openai-compatible', baseUrl: 'https://192.168.1.10/v1', apiKey: 'x' }]
    })).toThrow(/local or private address/);

    expect(() => normalizeConfig({
      server: { authTokens: ['token'], adminToken: 'admin' },
      providers: [{ id: 'lan', type: 'openai-compatible', baseUrl: 'https://192.168.1.10/v1', apiKey: 'x', allowLocal: true }]
    })).not.toThrow();
  });
});
