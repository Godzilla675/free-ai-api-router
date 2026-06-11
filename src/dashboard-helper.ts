import type { RouterConfig } from './types.js';

export function validateDashboardConfig(config: RouterConfig): void {
  if (!config || typeof config !== 'object') {
    throw new Error('Invalid configuration object');
  }
}

export function formatTuiLine(text: string, width: number): string {
  let visibleCount = 0;
  let result = '';
  let i = 0;
  let truncated = false;
  
  while (i < text.length) {
    if (text[i] === '\x1b') {
      let j = i + 1;
      if (text[j] === '[') {
        j++;
        while (j < text.length && !/[a-zA-Z]/.test(text[j]!)) {
          j++;
        }
        if (j < text.length) {
          j++;
        }
      }
      result += text.slice(i, j);
      i = j;
    } else {
      if (visibleCount < width) {
        result += text[i];
        visibleCount++;
        i++;
      } else {
        truncated = true;
        break;
      }
    }
  }

  if (visibleCount < width) {
    result += ' '.repeat(width - visibleCount);
  } else if (truncated) {
    result += '\x1b[0m';
  }
  return result;
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

