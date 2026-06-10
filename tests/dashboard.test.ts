import { describe, expect, it } from 'vitest';
import { validateDashboardConfig, formatTuiLine } from '../src/dashboard-helper.js';

describe('validateDashboardConfig', () => {
  it('identifies invalid configurations', () => {
    // @ts-expect-error test invalid input
    expect(() => validateDashboardConfig(null)).toThrow();
  });
});

describe('formatTuiLine', () => {
  it('pads line correctly to terminal width', () => {
    const output = formatTuiLine('Hello', 20);
    expect(output).toBe('Hello               ');
    expect(output.length).toBe(20);
  });
});

