import { describe, expect, it } from 'vitest';
import { redactAuthRecord } from '../src/auth/types.js';

describe('auth records', () => {
  it('redacts secret material from auth records', () => {
    const redacted = redactAuthRecord({
      id: 'auth-1',
      provider: 'codex',
      label: 'main',
      status: 'available',
      disabled: false,
      createdAt: '2026-06-05T00:00:00.000Z',
      updatedAt: '2026-06-05T00:00:00.000Z',
      attributes: { account: 'user@example.com' },
      secrets: { accessToken: 'secret-access', refreshToken: 'secret-refresh' },
      metadata: { plan: 'plus' }
    });

    expect(redacted.secrets).toEqual({ accessToken: '[REDACTED]', refreshToken: '[REDACTED]' });
    expect(redacted.attributes).toEqual({ account: 'user@example.com' });
  });
});
