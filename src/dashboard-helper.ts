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

