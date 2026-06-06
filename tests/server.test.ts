import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createModelRegistry } from '../src/model-registry.js';
import { createServer } from '../src/server.js';
import type { ProviderAdapter, RouterConfig } from '../src/types.js';
import { AuthManager } from '../src/auth/manager.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


const servers: http.Server[] = [];

async function listen(server: http.Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('invalid server address');
  }
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))));
});

describe('HTTP server', () => {
  it('exposes dynamic OpenAI-compatible models and chat completions', async () => {
    const provider: ProviderAdapter = {
      id: 'fake',
      type: 'fake',
      priority: 0,
      async listModels() {
        return [{ id: 'free-model' }];
      },
      async chat(request) {
        return {
          response: {
            id: 'chatcmpl_fake',
            object: 'chat.completion',
            created: 1,
            model: request.model,
            choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
          }
        };
      }
    };
    const config = { server: { authTokens: ['secret'], adminToken: 'admin' }, models: [], routing: { strategy: 'priority' } } as unknown as RouterConfig;
    const registry = createModelRegistry([provider], config);
    await registry.refresh();
    const baseUrl = await listen(createServer({ providers: [provider], registry, config }));

    const modelsResponse = await fetch(`${baseUrl}/v1/models`, { headers: { authorization: 'Bearer secret' } });
    const models = await modelsResponse.json() as { data: Array<{ id: string }> };
    expect(models.data.map((model) => model.id)).toContain('free-model');

    const chatResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'free-model', messages: [{ role: 'user', content: 'hi' }] })
    });
    const chat = await chatResponse.json() as { choices: Array<{ message: { content: string } }> };

    expect(chatResponse.status).toBe(200);
    expect(chat.choices[0]?.message.content).toBe('ok');
  });

  it('rejects unauthenticated v1 requests', async () => {
    const config = { server: { authTokens: ['secret'], adminToken: 'admin' }, models: [], routing: { strategy: 'priority' } } as unknown as RouterConfig;
    const registry = createModelRegistry([], config);
    const baseUrl = await listen(createServer({ providers: [], registry, config }));

    const response = await fetch(`${baseUrl}/v1/models`);

    expect(response.status).toBe(401);
  });

  it('returns Retry-After for rate-limited requests', async () => {
    const provider: ProviderAdapter = {
      id: 'fake',
      type: 'fake',
      priority: 0,
      async listModels() { return [{ id: 'free-model' }]; },
      async chat(request) {
        return {
          response: {
            id: 'chatcmpl_fake',
            object: 'chat.completion',
            created: 1,
            model: request.model,
            choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
          }
        };
      }
    };
    const config = { server: { authTokens: ['secret'], adminToken: 'admin' }, limits: { users: { default: { rpm: 1, tpm: 1000 } } }, models: [], routing: { strategy: 'priority' } } as unknown as RouterConfig;
    const registry = createModelRegistry([provider], config);
    await registry.refresh();
    const baseUrl = await listen(createServer({ providers: [provider], registry, config }));

    const body = JSON.stringify({ model: 'free-model', messages: [{ role: 'user', content: 'hi' }] });
    await fetch(`${baseUrl}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }, body });
    const limited = await fetch(`${baseUrl}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }, body });

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('rejects malformed chat messages before provider dispatch', async () => {
    const provider: ProviderAdapter = {
      id: 'fake',
      type: 'fake',
      priority: 0,
      async listModels() { return [{ id: 'free-model' }]; },
      async chat() { throw new Error('should not dispatch malformed request'); }
    };
    const config = { server: { authTokens: ['secret'], adminToken: 'admin' }, models: [], routing: { strategy: 'priority' } } as unknown as RouterConfig;
    const registry = createModelRegistry([provider], config);
    await registry.refresh();
    const baseUrl = await listen(createServer({ providers: [provider], registry, config }));

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'free-model', messages: ['bad'] })
    });

    expect(response.status).toBe(400);
  });

  it('planA-admin-001: GET /admin/providers returns enriched diagnostics', async () => {
    const provider: ProviderAdapter = {
      id: 'fake',
      type: 'fake',
      priority: 0,
      async listModels() { return [{ id: 'free-model' }]; },
      async chat(request) {
        return {
          response: {
            id: 'chatcmpl_fake',
            object: 'chat.completion',
            created: 1,
            model: request.model,
            choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
          }
        };
      }
    };
    const config = {
      server: { authTokens: ['secret'], adminToken: 'admin' },
      models: [],
      routing: {
        strategy: 'round-robin',
        sessionAffinity: true,
        sessionAffinityTtlMs: 3600000
      }
    } as unknown as RouterConfig;
    const registry = createModelRegistry([provider], config);
    await registry.refresh();
    const baseUrl = await listen(createServer({ providers: [provider], registry, config }));

    // Request admin/providers
    const response = await fetch(`${baseUrl}/admin/providers`, {
      headers: { authorization: 'Bearer admin' }
    });

    expect(response.status).toBe(200);
    const body = await response.json() as any;

    // Verify added fields from §4.3
    expect(body.routing).toBeDefined();
    expect(body.routing.strategy).toBe('round-robin');
    expect(body.routing.sessionAffinity).toBe(true);
    expect(body.routing.sessionAffinityTtlMs).toBe(3600000);

    expect(body.deployments).toBeDefined();
    expect(body.deployments.length).toBeGreaterThan(0);
    const d = body.deployments[0];
    expect(d.id).toBe('fake:free-model');
    expect(d.cooldownUntil).toBe(0);
    expect(d.selectionCursor).toBeDefined(); // Since strategy is round-robin
  });

  it('lists redacted auth records through admin API', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'free-ai-router-auth-'));
    try {
      const authManager = await AuthManager.create({ authDir: dir });
      await authManager.upsert({
        id: 'auth-1',
        provider: 'codex',
        status: 'available',
        disabled: false,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        secrets: { accessToken: 'secret' }
      });

      const config = { server: { authTokens: ['secret'], adminToken: 'admin-token' }, models: [] } as unknown as RouterConfig;
      const registry = createModelRegistry([], config);
      const server = createServer({ providers: [], registry, config, authManager });
      const baseUrl = await listen(server);

      const response = await fetch(`${baseUrl}/admin/auth`, {
        headers: { authorization: 'Bearer admin-token' }
      });
      const body = await response.json() as { data: Array<{ id: string; secrets?: Record<string, string> }> };

      expect(response.status).toBe(200);
      expect(body.data[0]?.id).toBe('auth-1');
      expect(body.data[0]?.secrets?.accessToken).toBe('[REDACTED]');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('disables and deletes auth records through admin API', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'free-ai-router-auth-'));
    try {
      const authManager = await AuthManager.create({ authDir: dir });
      await authManager.upsert({
        id: 'auth-1',
        provider: 'codex',
        status: 'available',
        disabled: false,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      });

      const config = { server: { authTokens: ['secret'], adminToken: 'admin-token' }, models: [] } as unknown as RouterConfig;
      const registry = createModelRegistry([], config);
      const server = createServer({ providers: [], registry, config, authManager });
      const baseUrl = await listen(server);

      const patch = await fetch(`${baseUrl}/admin/auth/auth-1`, {
        method: 'PATCH',
        headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' },
        body: JSON.stringify({ disabled: true })
      });
      expect(patch.status).toBe(200);

      const del = await fetch(`${baseUrl}/admin/auth/auth-1`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer admin-token' }
      });
      expect(del.status).toBe(204);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns native response shape for /v1/responses when router output is chat-normalized', async () => {
    const provider: ProviderAdapter = {
      id: 'fake',
      type: 'fake',
      priority: 0,
      async listModels() { return [{ id: 'shared-model' }]; },
      async chat(request) {
        return {
          response: {
            id: 'chatcmpl_fake',
            object: 'chat.completion',
            created: 1,
            model: request.model,
            choices: [{ index: 0, message: { role: 'assistant', content: 'hello from responses' }, finish_reason: 'stop' }]
          }
        };
      }
    };
    const config = { server: { authTokens: ['dev-token'], adminToken: 'admin' }, models: [], routing: { strategy: 'priority' } } as unknown as RouterConfig;
    const registry = createModelRegistry([provider], config);
    await registry.refresh();
    const baseUrl = await listen(createServer({ providers: [provider], registry, config }));

    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer dev-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ model: 'shared-model', input: 'hello' })
    });
    const body = await response.json() as { object?: string; output_text?: string };

    expect(response.status).toBe(200);
    expect(body.object).toBe('response');
    expect(typeof body.output_text).toBe('string');
  });

  it('returns 501 for websocket endpoint when websocket support is enabled without executor', async () => {
    const config = {
      server: { authTokens: ['dev-token'], adminToken: 'admin', websocketEnabled: true },
      models: [],
      routing: { strategy: 'priority' }
    } as unknown as RouterConfig;
    const registry = createModelRegistry([], config);
    const baseUrl = await listen(createServer({ providers: [], registry, config }));

    const response = await fetch(`${baseUrl}/v1/ws`, {
      headers: { authorization: 'Bearer dev-token' }
    });
    expect(response.status).toBe(501);
  });

  it('returns 404 for websocket endpoint when websocket support is disabled', async () => {
    const config = {
      server: { authTokens: ['dev-token'], adminToken: 'admin', websocketEnabled: false },
      models: [],
      routing: { strategy: 'priority' }
    } as unknown as RouterConfig;
    const registry = createModelRegistry([], config);
    const baseUrl = await listen(createServer({ providers: [], registry, config }));

    const response = await fetch(`${baseUrl}/v1/ws`, {
      headers: { authorization: 'Bearer dev-token' }
    });
    expect(response.status).toBe(404);
  });

  it('returns operations snapshot from admin API', async () => {
    const config = {
      server: { authTokens: ['dev-token'], adminToken: 'admin-token' },
      models: [],
      routing: { strategy: 'priority' }
    } as unknown as RouterConfig;
    const registry = createModelRegistry([], config);
    const baseUrl = await listen(createServer({ providers: [], registry, config }));

    const response = await fetch(`${baseUrl}/admin/operations`, {
      headers: { authorization: 'Bearer admin-token' }
    });
    const body = await response.json() as { routing: unknown; health: unknown; usage: unknown };

    expect(response.status).toBe(200);
    expect(body.routing).toBeDefined();
    expect(body.health).toBeDefined();
    expect(body.usage).toBeDefined();
  });

  it('exposes image generation proxy endpoint and forwards requests', async () => {
    const provider: ProviderAdapter = {
      id: 'fake-image',
      type: 'fake',
      priority: 0,
      async listModels() {
        return [{ id: 'image-model' }];
      },
      async chat() {
        throw new Error('not implemented');
      },
      async imageGenerate(request) {
        expect(request.prompt).toBe('a beautiful white cat');
        expect(request.model).toBe('image-model');
        return {
          response: new Response(JSON.stringify({
            created: 12345,
            data: [{ url: 'https://example.com/cat.png' }]
          }), { status: 200, headers: { 'content-type': 'application/json' } })
        };
      }
    };
    const config = { server: { authTokens: ['secret'], adminToken: 'admin' }, models: [], routing: { strategy: 'priority' } } as unknown as RouterConfig;
    const registry = createModelRegistry([provider], config);
    await registry.refresh();
    const baseUrl = await listen(createServer({ providers: [provider], registry, config }));

    const response = await fetch(`${baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'image-model', prompt: 'a beautiful white cat' })
    });
    const data = await response.json() as { created: number; data: Array<{ url: string }> };

    expect(response.status).toBe(200);
    expect(data.created).toBe(12345);
    expect(data.data[0]?.url).toBe('https://example.com/cat.png');
  });

  it('rejects image requests when model does not support images or has bad params', async () => {
    const provider: ProviderAdapter = {
      id: 'fake-chat-only',
      type: 'fake',
      priority: 0,
      async listModels() {
        return [{ id: 'chat-only-model' }];
      },
      async chat() {
        return { response: {} as any };
      }
    };
    const config = { server: { authTokens: ['secret'], adminToken: 'admin' }, models: [], routing: { strategy: 'priority' } } as unknown as RouterConfig;
    const registry = createModelRegistry([provider], config);
    await registry.refresh();
    const baseUrl = await listen(createServer({ providers: [provider], registry, config }));

    // Request with missing prompt
    const badReq = await fetch(`${baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'chat-only-model' })
    });
    expect(badReq.status).toBe(400);

    // Request with valid prompt but model doesn't support imageGenerate (not_implemented)
    const unsupported = await fetch(`${baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'chat-only-model', prompt: 'cat' })
    });
    expect(unsupported.status).toBe(501);
  });
});
