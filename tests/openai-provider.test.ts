import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible.js';
import type { OpenAIChatResponse } from '../src/types.js';

const servers: http.Server[] = [];

async function fakeServer(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('invalid fake server address');
  }
  return `http://127.0.0.1:${address.port}/v1`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))));
});

describe('OpenAI-compatible provider', () => {
  it('dynamically lists upstream models', async () => {
    const baseUrl = await fakeServer((request, response) => {
      expect(request.headers.authorization).toBe('Bearer test-key');
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'qwen/qwen3-32b', owned_by: 'fake' }] }));
    });
    const provider = new OpenAICompatibleProvider({ id: 'fake', type: 'openai-compatible', baseUrl, apiKey: 'test-key' });

    await expect(provider.listModels()).resolves.toMatchObject([{ id: 'qwen/qwen3-32b', name: 'qwen/qwen3-32b' }]);
  });

  it('supports top-level array model catalogs', async () => {
    const baseUrl = await fakeServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([{
        id: 'openai/gpt-4.1-mini',
        name: 'GPT 4.1 Mini',
        supported_input_modalities: ['text'],
        supported_output_modalities: ['text'],
        limits: { max_input_tokens: 8000 }
      }]));
    });
    const provider = new OpenAICompatibleProvider({ id: 'github-models', type: 'openai-compatible', baseUrl, apiKey: 'test-key' });

    await expect(provider.listModels()).resolves.toMatchObject([{
      id: 'openai/gpt-4.1-mini',
      name: 'GPT 4.1 Mini',
      inputModalities: ['text'],
      outputModalities: ['text'],
      contextWindow: 8000
    }]);
  });

  it('keeps provider-tier models without pricing metadata when filtering for free models', async () => {
    const baseUrl = await fakeServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'llama-3.1-8b-instant', object: 'model', active: true, context_window: 131072 }] }));
    });
    const provider = new OpenAICompatibleProvider({ id: 'groq', type: 'openai-compatible', baseUrl, apiKey: 'test-key', modelFilter: 'free' });

    await expect(provider.listModels()).resolves.toMatchObject([{ id: 'llama-3.1-8b-instant', contextWindow: 131072 }]);
  });

  it('uses provider pricing metadata for free model filtering', async () => {
    const baseUrl = await fakeServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        data: [
          {
            id: 'google/gemini-flash:free',
            pricing: { prompt: '0', completion: '0' },
            context_length: 1048576,
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }
          },
          { id: 'paid-with-zero-prompt', pricing: { prompt: '0', completion: '0.2' } },
          { id: 'paid-named-free:free', pricing: { prompt: '0.1', completion: '0.2' } },
          { id: 'paid-with-unrelated-zero', metadata: { tier: '0' } }
        ]
      }));
    });
    const provider = new OpenAICompatibleProvider({ id: 'openrouter', type: 'openai-compatible', baseUrl, apiKey: 'test-key', modelFilter: 'free' });

    await expect(provider.listModels()).resolves.toMatchObject([
      {
        id: 'google/gemini-flash:free',
        contextWindow: 1048576,
        inputModalities: ['text', 'image'],
        outputModalities: ['text']
      }
    ]);
  });

  it('normalizes malformed model list JSON as an upstream response error', async () => {
    const baseUrl = await fakeServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end('{not json');
    });
    const provider = new OpenAICompatibleProvider({ id: 'fake', type: 'openai-compatible', baseUrl, apiKey: 'test-key' });

    await expect(provider.listModels()).rejects.toMatchObject({ status: 502, code: 'invalid_upstream_response' });
  });

  it('forwards chat completions and returns normalized content', async () => {
    let body = '';
    const baseUrl = await fakeServer((request, response) => {
      request.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({
          id: 'chatcmpl_fake',
          object: 'chat.completion',
          created: 1,
          model: 'qwen/qwen3-32b',
          choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
        }));
      });
    });
    const provider = new OpenAICompatibleProvider({ id: 'fake', type: 'openai-compatible', baseUrl, apiKey: 'test-key' });

    const result = await provider.chat({ model: 'qwen/qwen3-32b', messages: [{ role: 'user', content: 'hi' }] });

    expect(JSON.parse(body).model).toBe('qwen/qwen3-32b');
    expect((result.response as OpenAIChatResponse).choices[0]?.message.content).toBe('hello');
    expect(result.usage?.totalTokens).toBe(5);
  });

  it('preserves upstream retry-after details on rate limits', async () => {
    const baseUrl = await fakeServer((_request, response) => {
      response.statusCode = 429;
      response.setHeader('content-type', 'application/json');
      response.setHeader('retry-after', '2');
      response.end(JSON.stringify({ error: { message: 'rate limit exceeded' } }));
    });
    const provider = new OpenAICompatibleProvider({ id: 'fake', type: 'openai-compatible', baseUrl, apiKey: 'test-key' });

    await expect(provider.chat({ model: 'qwen/qwen3-32b', messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      status: 429,
      details: { retryAfterMs: 2000 }
    });
  });
});
