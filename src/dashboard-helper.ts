import type { RouterConfig } from './types.js';

export function validateDashboardConfig(config: RouterConfig): void {
  if (!config || typeof config !== 'object') {
    throw new Error('Invalid configuration object');
  }
}

export function formatTuiLine(text: string, width: number): string {
  // Strip ANSI codes to calculate actual character width
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, '');
  const padding = Math.max(0, width - stripped.length);
  return text + ' '.repeat(padding);
}

export function updateSettingField(config: any, path: string, value: any): void {
  const parts = path.split('.');
  let current = config;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!(part in current)) {
      if (value === undefined) {
        return;
      }
      current[part] = {};
    }
    current = current[part];
  }
  const lastKey = parts[parts.length - 1]!;
  if (value === undefined) {
    delete current[lastKey];
  } else {
    current[lastKey] = value;
  }
}

export function getSettingField(config: any, path: string): any {
  const parts = path.split('.');
  let current = config;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

export function deleteProviderFromConfig(config: any, id: string): void {
  if (Array.isArray(config.providers)) {
    config.providers = config.providers.filter((p: any) => p.id !== id);
  }
}
export function buildGoogleOAuthUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/generative-language',
    access_type: 'offline',
    prompt: 'consent'
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function parseRecentLogs(data: any): string[] {
  return (data.usage ?? []).map((log: any) => {
    const time = log.timestamp ? log.timestamp.split('T')[1]?.slice(0, 8) || log.timestamp : 'unknown';
    const statusStr = log.status === 'success' ? 'success' : 'error';
    const errStr = log.error ? ` - Error: ${log.error}` : '';
    const routeInfo = log.modelGroup ? ` [${log.modelGroup} -> ${log.providerId || log.deploymentId || 'unknown'}]` : '';
    return `[${time}]${routeInfo} ${statusStr} (${log.latencyMs}ms)${errStr}`;
  });
}

