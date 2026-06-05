import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { AIStudioProvider } from '../src/providers/aistudio.js';

describe('AIStudioProvider', () => {
  it('forwards chat requests to a configured AI Studio relay', async () => {
    const server = http.createServer(async (req, res) => {
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/v1/aistudio/chat');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        id: 'chatcmpl_aistudio_1',
        object: 'chat.completion',
        created: 1,
        model: 'gemini-3-pro',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('bad address');
      const provider = new AIStudioProvider({
        id: 'aistudio',
        type: 'aistudio',
        baseUrl: `http://127.0.0.1:${address.port}/v1/aistudio`,
        allowLocal: true
      });
      const result = await provider.chat({ model: 'gemini-3-pro', messages: [{ role: 'user', content: 'hi' }] });
      expect((result.response as { choices: Array<{ message: { content: unknown } }> }).choices[0]?.message.content).toBe('ok');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
