import { AuthStore } from './store.js';
import type { AuthRecord, RedactedAuthRecord } from './types.js';
import { redactAuthRecord } from './types.js';
import type { AuthProviderHandler } from './providers/provider.js';
import { GeminiOAuthHandler } from './providers/gemini-oauth.js';

export interface AuthManagerConfig {
  authDir: string;
}

export class AuthManager {
  private readonly records = new Map<string, AuthRecord>();
  private readonly handlers = new Map<string, AuthProviderHandler>();

  private constructor(private readonly store: AuthStore) {}

  static async create(config: AuthManagerConfig): Promise<AuthManager> {
    const manager = new AuthManager(new AuthStore(config.authDir));
    manager.registerProviderHandler('gemini-oauth', new GeminiOAuthHandler());
    for (const record of await manager.store.loadAll()) {
      manager.records.set(record.id, record);
    }
    return manager;
  }

  listRedacted(): RedactedAuthRecord[] {
    return [...this.records.values()].sort((a, b) => a.id.localeCompare(b.id)).map(redactAuthRecord);
  }

  get(id: string): AuthRecord | undefined {
    return this.records.get(id);
  }

  async upsert(record: AuthRecord): Promise<void> {
    const next = { ...record, updatedAt: new Date().toISOString() };
    this.records.set(next.id, next);
    await this.store.save(next);
  }

  async setDisabled(id: string, disabled: boolean): Promise<AuthRecord> {
    const current = this.records.get(id);
    if (!current) {
      throw new Error(`Auth record not found: ${id}`);
    }
    const next: AuthRecord = {
      ...current,
      disabled,
      status: disabled ? 'disabled' : 'available',
      updatedAt: new Date().toISOString()
    };
    this.records.set(id, next);
    await this.store.save(next);
    return next;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
    await this.store.delete(id);
  }

  registerProviderHandler(provider: string, handler: AuthProviderHandler): void {
    this.handlers.set(provider, handler);
  }

  async refreshDue(now = new Date()): Promise<void> {
    for (const record of this.records.values()) {
      if (record.disabled) continue;
      if (record.status !== 'expired' && (!record.nextRefreshAfter || Date.parse(record.nextRefreshAfter) > now.getTime())) continue;
      const handler = this.handlers.get(record.provider);
      if (!handler?.refresh) continue;
      const refreshed = await handler.refresh(record);
      await this.upsert(refreshed);
    }
  }
}
