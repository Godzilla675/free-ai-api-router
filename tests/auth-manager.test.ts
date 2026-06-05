import { describe, expect, it } from 'vitest';
import { redactAuthRecord } from '../src/auth/types.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore } from '../src/auth/store.js';
import { AuthManager } from '../src/auth/manager.js';

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

describe('AuthStore', () => {
  it('persists and reloads auth records as individual JSON files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'free-ai-router-auth-'));
    try {
      const store = new AuthStore(dir);
      await store.save({
        id: 'auth-1',
        provider: 'codex',
        status: 'available',
        disabled: false,
        createdAt: '2026-06-05T00:00:00.000Z',
        updatedAt: '2026-06-05T00:00:00.000Z',
        secrets: { accessToken: 'secret' }
      });

      const reloaded = await new AuthStore(dir).loadAll();
      expect(reloaded).toHaveLength(1);
      expect(reloaded[0]?.id).toBe('auth-1');
      expect(reloaded[0]?.secrets?.accessToken).toBe('secret');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('AuthManager', () => {
  it('lists redacted auth records and persists status changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'free-ai-router-auth-'));
    try {
      const manager = await AuthManager.create({ authDir: dir });
      await manager.upsert({
        id: 'codex-main',
        provider: 'codex',
        status: 'available',
        disabled: false,
        createdAt: '2026-06-05T00:00:00.000Z',
        updatedAt: '2026-06-05T00:00:00.000Z',
        secrets: { accessToken: 'secret' }
      });

      await manager.setDisabled('codex-main', true);

      const records = manager.listRedacted();
      expect(records[0]?.disabled).toBe(true);
      expect(records[0]?.secrets?.accessToken).toBe('[REDACTED]');

      const reloaded = await AuthManager.create({ authDir: dir });
      expect(reloaded.listRedacted()[0]?.disabled).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refreshes records with registered provider handlers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'free-ai-router-auth-'));
    try {
      const manager = await AuthManager.create({ authDir: dir });
      await manager.upsert({
        id: 'gemini-1',
        provider: 'gemini-oauth',
        status: 'expired',
        disabled: false,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        secrets: { refreshToken: 'refresh' }
      });

      manager.registerProviderHandler('gemini-oauth', {
        async refresh(record) {
          return { ...record, status: 'available', secrets: { accessToken: 'new-access', refreshToken: 'refresh' } };
        }
      });

      await manager.refreshDue();
      expect(manager.get('gemini-1')?.status).toBe('available');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('registers gemini-oauth provider handler by default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'free-ai-router-auth-'));
    try {
      const manager = await AuthManager.create({ authDir: dir });
      const handlers = (manager as any).handlers as Map<string, any>;
      expect(handlers.has('gemini-oauth')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
