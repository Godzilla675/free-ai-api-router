import { describe, expect, it } from 'vitest';
import { createProvider } from '../src/providers/factory.js';

describe('channel provider factory', () => {
  it.each(['claude', 'xai', 'kimi'] as const)('creates %s provider skeleton', (type) => {
    const provider = createProvider({
      id: type,
      type,
      baseUrl: 'https://example.com',
      apiKey: 'test'
    });

    expect(provider.type).toBe(type);
  });

  it.each(['claude', 'xai', 'kimi'] as const)('%s provider returns explicit 501 execution error', async (type) => {
    const provider = createProvider({
      id: type,
      type,
      baseUrl: 'https://example.com',
      apiKey: 'test'
    });

    await expect(provider.chat({ model: 'test-model', messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toMatchObject({ status: 501, code: 'not_implemented' });
  });
});
