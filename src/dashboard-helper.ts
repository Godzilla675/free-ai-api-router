import type { RouterConfig } from './types.js';

export function validateDashboardConfig(config: RouterConfig): void {
  if (!config || typeof config !== 'object') {
    throw new Error('Invalid configuration object');
  }
}
