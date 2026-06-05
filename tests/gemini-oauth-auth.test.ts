import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { GeminiOAuthHandler } from '../src/auth/providers/gemini-oauth.js';

describe('GeminiOAuthHandler', () => {
  it('refreshes OAuth tokens through token endpoint', async () => {
    const server = http.createServer(async (req, res) => {
      expect(req.method).toBe('POST');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('bad address');
      const handler = new GeminiOAuthHandler({ tokenUrl: `http://127.0.0.1:${address.port}/token` });
      const record = await handler.refresh({
        id: 'gemini-1',
        provider: 'gemini-oauth',
        status: 'expired',
        disabled: false,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        secrets: { refreshToken: 'refresh-1' }
      });

      expect(record.status).toBe('available');
      expect(record.secrets?.accessToken).toBe('access-2');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
