import { describe, expect, it } from 'vitest';
import { validateDashboardConfig, formatTuiLine, updateSettingField, getSettingField } from '../src/dashboard-helper.js';

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

describe('updateSettingField', () => {
  it('correctly updates nested configuration values', () => {
    const config = { server: { port: 8080 } };
    updateSettingField(config, 'server.port', 9090);
    expect(config.server.port).toBe(9090);
  });

  it('correctly deletes nested configuration values when value is undefined', () => {
    const config: any = { server: { port: 8080, host: 'localhost' } };
    updateSettingField(config, 'server.port', undefined);
    expect(config.server.port).toBeUndefined();
    expect('port' in config.server).toBe(false);
    expect(config.server.host).toBe('localhost');

    // Test early return for non-existent paths when value is undefined
    updateSettingField(config, 'limits.global.rpm', undefined);
    expect(config.limits).toBeUndefined();
  });
});

describe('getSettingField', () => {
  it('correctly retrieves nested configuration values', () => {
    const config = { server: { port: 8080 } };
    expect(getSettingField(config, 'server.port')).toBe(8080);
    expect(getSettingField(config, 'server.host')).toBeUndefined();
    expect(getSettingField(config, 'nonexistent.field')).toBeUndefined();
  });
});

import { DashboardTui } from '../src/dashboard.js';
import * as fs from 'node:fs';

describe('DashboardTui settings editing and validation', () => {
  const tempConfigPath = 'temp-config-test.json';

  beforeEach(() => {
    fs.writeFileSync(tempConfigPath, JSON.stringify({ server: { port: 8080 } }), 'utf8');
  });

  afterEach(() => {
    if (fs.existsSync(tempConfigPath)) {
      fs.unlinkSync(tempConfigPath);
    }
  });

  it('validates and saves number, select, boolean and clears them when empty', () => {
    const tui = new DashboardTui(tempConfigPath);
    const state = (tui as any).state;
    
    // Test editing server.port (type: number)
    state.activeTab = 'settings';
    state.selectedIndex = 1; // server.port
    state.isEditing = true;
    state.editValue = ' 9090 '; // with spaces
    (tui as any).saveEdit();
    expect(state.config.server.port).toBe(9090);
    expect(JSON.parse(fs.readFileSync(tempConfigPath, 'utf8')).server.port).toBe(9090);

    // Test editing server.port with invalid number (should discard)
    state.isEditing = true;
    state.editValue = 'invalid';
    (tui as any).saveEdit();
    expect(state.config.server.port).toBe(9090); // unchanged

    // Test clearing server.port (should delete key)
    state.isEditing = true;
    state.editValue = '';
    (tui as any).saveEdit();
    expect(state.config.server.port).toBeUndefined();
    expect('port' in state.config.server).toBe(false);

    // Test routing.strategy (type: select)
    state.selectedIndex = 4; // routing.strategy
    state.isEditing = true;
    state.editValue = 'weighted';
    (tui as any).saveEdit();
    expect(state.config.routing.strategy).toBe('weighted');

    // Test routing.strategy with invalid option (should discard)
    state.isEditing = true;
    state.editValue = 'invalid-strategy';
    (tui as any).saveEdit();
    expect(state.config.routing.strategy).toBe('weighted'); // unchanged

    // Test routing.sessionAffinity (type: boolean)
    state.selectedIndex = 5; // routing.sessionAffinity
    state.isEditing = true;
    state.editValue = 'true';
    (tui as any).saveEdit();
    expect(state.config.routing.sessionAffinity).toBe(true);

    // Test routing.sessionAffinity with invalid boolean (should discard)
    state.isEditing = true;
    state.editValue = 'yes';
    (tui as any).saveEdit();
    expect(state.config.routing.sessionAffinity).toBe(true); // unchanged
  });
});





