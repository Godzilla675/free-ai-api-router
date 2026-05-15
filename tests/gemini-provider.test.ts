import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { GeminiProvider } from '../src/providers/gemini.js';

const servers: http.Server[] = [];

async function fakeServer(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('invalid address');
  return `http://127.0.0.1:${address.port}/v1beta`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))));
});

describe('Gemini provider', () => {
  it('redacts upstream error bodies before throwing', async () => {
    const baseUrl = await fakeServer((request, response) => {
      expect(request.headers['x-goog-api-key']).toBe('secret-key');
      response.statusCode = 500;
      response.end('bad key=secret-key Bearer abc123');
    });
    const provider = new GeminiProvider({ id: 'gemini', type: 'gemini', baseUrl, apiKey: 'secret-key' });

    await expect(provider.chat({ model: 'gemini-test', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/\[REDACTED\]/);
    await expect(provider.chat({ model: 'gemini-test', messages: [{ role: 'user', content: 'hi' }] })).rejects.not.toThrow(/secret-key|abc123/);
  });

  it('treats malformed success JSON as retryable bad upstream response', async () => {
    const baseUrl = await fakeServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end('{not json');
    });
    const provider = new GeminiProvider({ id: 'gemini', type: 'gemini', baseUrl, apiKey: 'secret-key' });

    await expect(provider.chat({ model: 'gemini-test', messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({ status: 502 });
  });

  it('does not return empty success when Gemini returns no candidates', async () => {
    const baseUrl = await fakeServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }));
    });
    const provider = new GeminiProvider({ id: 'gemini', type: 'gemini', baseUrl, apiKey: 'secret-key' });

    await expect(provider.chat({ model: 'gemini-test', messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({ status: 400, retryable: false });
  });
});
