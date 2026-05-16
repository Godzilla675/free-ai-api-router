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
  it('follows model list pagination', async () => {
    const seenUrls: string[] = [];
    const baseUrl = await fakeServer((request, response) => {
      seenUrls.push(request.url ?? '');
      response.setHeader('content-type', 'application/json');
      if (request.url === '/v1beta/models') {
        response.end(JSON.stringify({ models: [{ name: 'models/page-one', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'next' }));
        return;
      }
      response.end(JSON.stringify({ models: [{ name: 'models/page-two', supportedGenerationMethods: ['generateContent'] }] }));
    });
    const provider = new GeminiProvider({ id: 'gemini', type: 'gemini', baseUrl, apiKey: 'secret-key' });

    const models = await provider.listModels();

    expect(seenUrls).toEqual(['/v1beta/models', '/v1beta/models?pageToken=next']);
    expect(models.map((model) => model.id)).toEqual(['models/page-one', 'models/page-two']);
  });

  it('uses tuned model resource names without adding a models prefix', async () => {
    let seenUrl = '';
    const baseUrl = await fakeServer((request, response) => {
      seenUrl = request.url ?? '';
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }]
      }));
    });
    const provider = new GeminiProvider({ id: 'gemini', type: 'gemini', baseUrl, apiKey: 'secret-key' });

    await provider.chat({ model: 'tunedModels/custom-model', messages: [{ role: 'user', content: 'hi' }] });

    expect(seenUrl).toBe('/v1beta/tunedModels/custom-model:generateContent');
  });

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

  it('preserves upstream retry-after details on rate limits', async () => {
    const baseUrl = await fakeServer((_request, response) => {
      response.statusCode = 429;
      response.setHeader('retry-after', '3');
      response.end('rate limit exceeded');
    });
    const provider = new GeminiProvider({ id: 'gemini', type: 'gemini', baseUrl, apiKey: 'secret-key' });

    await expect(provider.chat({ model: 'gemini-test', messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      status: 429,
      details: { retryAfterMs: 3000 }
    });
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

  it('does not advertise image input support for the text-only adapter', async () => {
    const baseUrl = await fakeServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ models: [{ name: 'models/gemini-test', supportedGenerationMethods: ['generateContent'] }] }));
    });
    const provider = new GeminiProvider({ id: 'gemini', type: 'gemini', baseUrl, apiKey: 'secret-key' });

    await expect(provider.listModels()).resolves.toMatchObject([{ id: 'models/gemini-test', inputModalities: ['text'] }]);
  });
});
