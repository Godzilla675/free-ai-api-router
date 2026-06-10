import { describe, expect, it } from 'vitest';
import { validateDashboardConfig } from '../src/dashboard-helper.js';

describe('validateDashboardConfig', () => {
  it('identifies invalid configurations', () => {
    // @ts-expect-error test invalid input
    expect(() => validateDashboardConfig(null)).toThrow();
  });
});
