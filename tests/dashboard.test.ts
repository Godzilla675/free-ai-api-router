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

  it('handles strings containing ANSI escape codes correctly', () => {
    const redHello = '\x1b[31mHello\x1b[0m';
    const output = formatTuiLine(redHello, 20);
    // The visual output should be padded correctly based on length without ANSI codes (5 characters)
    // The returned string should contain the original ANSI escape codes
    expect(output.startsWith(redHello)).toBe(true);
    // Visual length: 5 (Hello) + 15 spaces = 20. Actual length: 5 + 7 (red) + 4 (reset) + 15 spaces = 31.
    const stripped = output.replace(/\x1b\[[0-9;]*m/g, '');
    expect(stripped.length).toBe(20);
    expect(stripped).toBe('Hello               ');
  });
});


