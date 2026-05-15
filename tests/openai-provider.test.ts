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
});
