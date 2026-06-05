import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { chatToResponsesRequest, responsesToChatResponse } from '../src/translators/responses.js';
import { OpenAIResponsesProvider } from '../src/providers/openai-responses.js';
import { createProvider } from '../src/providers/factory.js';

describe('responses translators', () => {
  it('converts chat requests to OpenAI Responses input', () => {
    const converted = chatToResponsesRequest({
      model: 'gpt-5-codex',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.2
    });

    expect(converted.model).toBe('gpt-5-codex');
    expect(converted.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }]);
  });

  it('converts Responses output_text to chat completion shape', () => {
    const chat = responsesToChatResponse({
      id: 'resp_1',
      object: 'response',
      created_at: 1,
      model: 'gpt-5-codex',
      output_text: 'hello back'
    });

    expect(chat.id).toBe('chatcmpl_resp_1');
    expect(chat.choices[0]?.message.content).toBe('hello back');
  });
});

describe('OpenAIResponsesProvider', () => {
  it('posts chat requests to responses endpoint and returns chat shape', async () => {
    const server = http.createServer(async (req, res) => {
      expect(req.url).toBe('/v1/responses');
      expect(req.headers.authorization).toBe('Bearer test-key');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'resp_1', object: 'response', created_at: 1, model: 'gpt-5-codex', output_text: 'ok' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('bad address');
      const provider = new OpenAIResponsesProvider({
        id: 'openai-responses',
        type: 'openai-responses',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        allowLocal: true,
        apiKey: 'test-key'
      });

      const result = await provider.chat({ model: 'gpt-5-codex', messages: [{ role: 'user', content: 'hi' }] });
      expect(result.response instanceof Response).toBe(false);
      expect((result.response as { choices: Array<{ message: { content: unknown } }> }).choices[0]?.message.content).toBe('ok');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('CodexProvider', () => {
  it('creates codex provider through factory', () => {
    const provider = createProvider({
      id: 'codex',
      type: 'codex',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test'
    });
    expect(provider.type).toBe('codex');
  });
});
