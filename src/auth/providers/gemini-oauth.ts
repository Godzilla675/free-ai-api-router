import { RouterError } from '../../errors.js';
import type { AuthRecord } from '../types.js';
import type { AuthProviderHandler } from './provider.js';

export interface GeminiOAuthHandlerOptions {
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
}

export class GeminiOAuthHandler implements AuthProviderHandler {
  constructor(private readonly options: GeminiOAuthHandlerOptions = {}) {}

  async refresh(record: AuthRecord): Promise<AuthRecord> {
    const refreshToken = record.secrets?.refreshToken;
    if (!refreshToken) {
      throw new RouterError(`Auth ${record.id} has no refresh token`, { status: 400, code: 'invalid_auth', retryable: false });
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.options.clientId ?? String(record.attributes?.clientId ?? ''),
      client_secret: this.options.clientSecret ?? String(record.attributes?.clientSecret ?? '')
    });
    const response = await fetch(this.options.tokenUrl ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!response.ok) {
      throw new RouterError(await response.text(), { status: response.status, code: 'auth_refresh_failed', retryable: response.status >= 500 });
    }
    const json = await response.json() as { access_token: string; refresh_token?: string; expires_in?: number };
    const expiresAt = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString();
    return {
      ...record,
      status: 'available',
      updatedAt: new Date().toISOString(),
      lastRefreshedAt: new Date().toISOString(),
      nextRefreshAfter: new Date(Date.now() + Math.max(60, (json.expires_in ?? 3600) - 300) * 1000).toISOString(),
      secrets: {
        ...record.secrets,
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? refreshToken
      },
      metadata: { ...(record.metadata ?? {}), expiresAt }
    };
  }
}
