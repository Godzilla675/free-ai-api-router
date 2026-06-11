import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import * as http from 'node:http';
import { validateDashboardConfig, formatTuiLine, updateSettingField, getSettingField, buildGoogleOAuthUrl, parseRecentLogs } from '../src/dashboard-helper.js';

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

  it('truncates plain text lines longer than width', () => {
    const output = formatTuiLine('Hello World', 5);
    expect(output).toBe('Hello\x1b[0m');
  });

  it('truncates lines with ANSI escape sequences and appends reset code', () => {
    const greenText = '\x1b[32mHello World\x1b[0m';
    const output = formatTuiLine(greenText, 5);
    // Visual length: 5 (Hello)
    // The escape code \x1b[32m should be preserved, and \x1b[0m appended at the end
    expect(output).toBe('\x1b[32mHello\x1b[0m');
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
    expect(getSettingField(config, 'server.host')).toBe(undefined);
    expect(getSettingField(config, 'nonexistent.field')).toBe(undefined);
  });
});

describe('buildGoogleOAuthUrl', () => {
  it('constructs correct google authorization url', () => {
    const url = buildGoogleOAuthUrl('client-123', 'http://localhost:52342/');
    expect(url).toContain('client_id=client-123');
    expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A52342%2F');
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

import { deleteProviderFromConfig } from '../src/dashboard-helper.js';

describe('deleteProviderFromConfig', () => {
  it('removes provider from configs', () => {
    const config = { providers: [{ id: 'openai-1', type: 'openai-compatible' }] };
    deleteProviderFromConfig(config, 'openai-1');
    expect(config.providers.length).toBe(0);
  });
});

describe('DashboardTui provider management', () => {
  const tempConfigPath = 'temp-config-providers-test.json';
  const tempAuthDir = 'temp-auth-providers-test';

  beforeEach(() => {
    fs.writeFileSync(
      tempConfigPath,
      JSON.stringify({
        auth: { authDir: tempAuthDir },
        providers: [
          { id: 'openai-test', type: 'openai-compatible', apiKey: 'sk-123456789abc' },
          { id: 'gemini-env-test', type: 'gemini', apiKeyEnv: 'GEMINI_API_KEY', disabled: true }
        ]
      }),
      'utf8'
    );
    if (!fs.existsSync(tempAuthDir)) {
      fs.mkdirSync(tempAuthDir, { recursive: true });
    }
    // Create an auth record
    fs.writeFileSync(
      join(tempAuthDir, 'oauth-record.json'),
      JSON.stringify({
        id: 'oauth-record',
        provider: 'gemini-oauth',
        status: 'available',
        disabled: false,
        createdAt: '2026-06-05T00:00:00.000Z',
        updatedAt: '2026-06-05T00:00:00.000Z',
        metadata: { expiresAt: '2026-06-05T01:00:00.000Z' }
      }),
      'utf8'
    );
  });

  afterEach(() => {
    if (fs.existsSync(tempConfigPath)) {
      fs.unlinkSync(tempConfigPath);
    }
    if (fs.existsSync(tempAuthDir)) {
      fs.rmSync(tempAuthDir, { recursive: true, force: true });
    }
  });

  it('correctly loads unified accounts list', () => {
    const tui = new DashboardTui(tempConfigPath);
    const accounts = (tui as any).getUnifiedAccounts();

    expect(accounts.length).toBe(3);

    const openai = accounts.find((a: any) => a.id === 'openai-test');
    expect(openai).toBeDefined();
    expect(openai.source).toBe('config');
    expect(openai.preview).toBe('sk-1...9abc');
    expect(openai.disabled).toBe(false);

    const geminiEnv = accounts.find((a: any) => a.id === 'gemini-env-test');
    expect(geminiEnv).toBeDefined();
    expect(geminiEnv.source).toBe('config');
    expect(geminiEnv.preview).toBe('Env: GEMINI_API_KEY');
    expect(geminiEnv.disabled).toBe(true);

    const oauth = accounts.find((a: any) => a.id === 'oauth-record');
    expect(oauth).toBeDefined();
    expect(oauth.source).toBe('auth');
    expect(oauth.preview).toBe('Expires: 2026-06-05T01:00:00.000Z');
    expect(oauth.disabled).toBe(false);
  });

  it('toggles disabled status with key d', () => {
    const tui = new DashboardTui(tempConfigPath);
    const state = (tui as any).state;
    state.activeTab = 'providers';
    state.selectedIndex = 0; // openai-test

    // Toggle disabled
    (tui as any).handleKey('d');
    let accounts = (tui as any).getUnifiedAccounts();
    let openai = accounts.find((a: any) => a.id === 'openai-test');
    expect(openai.disabled).toBe(true);

    // Verify it is saved in config
    const savedConfig = JSON.parse(fs.readFileSync(tempConfigPath, 'utf8'));
    expect(savedConfig.providers.find((p: any) => p.id === 'openai-test').disabled).toBe(true);

    // Toggle disabled on auth record
    state.selectedIndex = 2; // oauth-record
    (tui as any).handleKey('d');
    accounts = (tui as any).getUnifiedAccounts();
    const oauth = accounts.find((a: any) => a.id === 'oauth-record');
    expect(oauth.disabled).toBe(true);

    // Verify written to auth file
    const savedAuth = JSON.parse(fs.readFileSync(join(tempAuthDir, 'oauth-record.json'), 'utf8'));
    expect(savedAuth.disabled).toBe(true);
  });

  it('removes accounts with delete key', () => {
    const tui = new DashboardTui(tempConfigPath);
    const state = (tui as any).state;
    state.activeTab = 'providers';
    state.selectedIndex = 0; // openai-test

    // Delete openai-test
    (tui as any).handleKey('delete');
    let accounts = (tui as any).getUnifiedAccounts();
    expect(accounts.length).toBe(2);
    expect(accounts.find((a: any) => a.id === 'openai-test')).toBeUndefined();

    // Verify removed from config.json
    const savedConfig = JSON.parse(fs.readFileSync(tempConfigPath, 'utf8'));
    expect(savedConfig.providers.length).toBe(1);

    // Delete oauth-record (index is now 1 because openai-test was removed)
    state.selectedIndex = 1; // oauth-record
    (tui as any).handleKey('delete');
    accounts = (tui as any).getUnifiedAccounts();
    expect(accounts.length).toBe(1);
    expect(accounts.find((a: any) => a.id === 'oauth-record')).toBeUndefined();

    // Verify deleted from disk
    expect(fs.existsSync(join(tempAuthDir, 'oauth-record.json'))).toBe(false);
  });

  it('runs addition wizard correctly', () => {
    const tui = new DashboardTui(tempConfigPath);
    const state = (tui as any).state;
    state.activeTab = 'providers';

    // Start wizard
    (tui as any).handleKey('a');
    expect((tui as any).wizard.step).toBe('id');

    // Type id
    (tui as any).handleKeypress('n', { name: 'n' });
    (tui as any).handleKeypress('e', { name: 'e' });
    (tui as any).handleKeypress('w', { name: 'w' });
    expect((tui as any).wizard.id).toBe('new');

    // Advance to type selection
    (tui as any).handleKeypress('', { name: 'enter' });
    expect((tui as any).wizard.step).toBe('type');
    expect((tui as any).wizard.type).toBe('openai-compatible');

    // Select type 'gemini' (up/down)
    (tui as any).handleKeypress('', { name: 'down' });
    expect((tui as any).wizard.type).toBe('gemini');

    // Advance to baseUrl
    (tui as any).handleKeypress('', { name: 'enter' });
    expect((tui as any).wizard.step).toBe('baseUrl');
    expect((tui as any).wizard.baseUrl).toBe('https://generativelanguage.googleapis.com');

    // Advance to apiKey
    (tui as any).handleKeypress('', { name: 'enter' });
    expect((tui as any).wizard.step).toBe('apiKey');

    // Type API key
    (tui as any).handleKeypress('a', { name: 'a' });
    (tui as any).handleKeypress('b', { name: 'b' });
    (tui as any).handleKeypress('c', { name: 'c' });
    expect((tui as any).wizard.apiKey).toBe('abc');

    // Advance to priority
    (tui as any).handleKeypress('', { name: 'enter' });
    expect((tui as any).wizard.step).toBe('priority');

    // Type priority
    (tui as any).handleKeypress('3', { name: '3' });
    expect((tui as any).wizard.priority).toBe('3');

    // Advance to weight
    (tui as any).handleKeypress('', { name: 'enter' });
    expect((tui as any).wizard.step).toBe('weight');

    // Type weight
    (tui as any).handleKeypress('2', { name: '2' });
    expect((tui as any).wizard.weight).toBe('2');

    // Advance (finish)
    (tui as any).handleKeypress('', { name: 'enter' });
    expect((tui as any).wizard.step).toBe('none');

    // Verify it is saved in config
    const savedConfig = JSON.parse(fs.readFileSync(tempConfigPath, 'utf8'));
    const added = savedConfig.providers.find((p: any) => p.id === 'new');
    expect(added).toBeDefined();
    expect(added.type).toBe('gemini');
    expect(added.baseUrl).toBe('https://generativelanguage.googleapis.com');
    expect(added.apiKey).toBe('abc');
    expect(added.priority).toBe(3);
    expect(added.weight).toBe(2);
  });

  it('wizard exits and discards duplicate provider id', () => {
    const tui = new DashboardTui(tempConfigPath);
    const state = (tui as any).state;
    state.activeTab = 'providers';

    // Start wizard
    (tui as any).handleKey('a');
    expect((tui as any).wizard.step).toBe('id');

    // Type duplicate id: 'openai-test'
    for (const c of 'openai-test') {
      (tui as any).handleKeypress(c, { name: c });
    }
    expect((tui as any).wizard.id).toBe('openai-test');

    // Attempt to advance (should detect duplicate and exit wizard)
    (tui as any).handleKeypress('', { name: 'enter' });
    expect((tui as any).wizard.step).toBe('none');
  });

  it('wizard exits and discards invalid priority or weight', () => {
    const tui = new DashboardTui(tempConfigPath);
    const state = (tui as any).state;
    state.activeTab = 'providers';

    // 1. Test invalid priority
    (tui as any).handleKey('a');
    (tui as any).handleKeypress('u', { name: 'u' }); // ID
    (tui as any).handleKeypress('', { name: 'enter' }); // to type
    (tui as any).handleKeypress('', { name: 'enter' }); // to baseUrl
    (tui as any).handleKeypress('', { name: 'enter' }); // to apiKey
    (tui as any).handleKeypress('', { name: 'enter' }); // to priority
    (tui as any).handleKeypress('a', { name: 'a' }); // invalid priority
    (tui as any).handleKeypress('', { name: 'enter' }); // to weight
    (tui as any).handleKeypress('', { name: 'enter' }); // to finish -> should discard
    expect((tui as any).wizard.step).toBe('none');

    // Check config (no provider 'u' should be added)
    let savedConfig = JSON.parse(fs.readFileSync(tempConfigPath, 'utf8'));
    expect(savedConfig.providers.find((p: any) => p.id === 'u')).toBeUndefined();

    // 2. Test invalid weight
    (tui as any).handleKey('a');
    (tui as any).handleKeypress('v', { name: 'v' }); // ID
    (tui as any).handleKeypress('', { name: 'enter' }); // to type
    (tui as any).handleKeypress('', { name: 'enter' }); // to baseUrl
    (tui as any).handleKeypress('', { name: 'enter' }); // to apiKey
    (tui as any).handleKeypress('', { name: 'enter' }); // to priority (keep prefilled '1')
    (tui as any).handleKeypress('', { name: 'enter' }); // to weight
    (tui as any).handleKeypress('-', { name: '-' });
    (tui as any).handleKeypress('5', { name: '5' }); // invalid weight '-5'
    (tui as any).handleKeypress('', { name: 'enter' }); // to finish -> should discard
    expect((tui as any).wizard.step).toBe('none');

    // Check config (no provider 'v' should be added)
    savedConfig = JSON.parse(fs.readFileSync(tempConfigPath, 'utf8'));
    expect(savedConfig.providers.find((p: any) => p.id === 'v')).toBeUndefined();
  });

  it('wizard preserves intentional 0 for priority and weight', () => {
    const tui = new DashboardTui(tempConfigPath);
    const state = (tui as any).state;
    state.activeTab = 'providers';

    (tui as any).handleKey('a');
    (tui as any).handleKeypress('z', { name: 'z' }); // ID
    (tui as any).handleKeypress('', { name: 'enter' }); // to type
    (tui as any).handleKeypress('', { name: 'enter' }); // to baseUrl
    (tui as any).handleKeypress('', { name: 'enter' }); // to apiKey
    (tui as any).handleKeypress('', { name: 'enter' }); // to priority
    (tui as any).handleKeypress('0', { name: '0' }); // priority = 0
    (tui as any).handleKeypress('', { name: 'enter' }); // to weight
    (tui as any).handleKeypress('0', { name: '0' }); // weight = 0
    (tui as any).handleKeypress('', { name: 'enter' }); // to finish
    expect((tui as any).wizard.step).toBe('none');

    // Check config (provider 'z' should have priority 0 and weight 0)
    const savedConfig = JSON.parse(fs.readFileSync(tempConfigPath, 'utf8'));
    const added = savedConfig.providers.find((p: any) => p.id === 'z');
    expect(added).toBeDefined();
    expect(added.priority).toBe(0);
    expect(added.weight).toBe(0);
  });

  it('runs OAuth login wizard and saves record on callback', async () => {
    const tui = new DashboardTui(tempConfigPath);
    const state = (tui as any).state;
    state.activeTab = 'providers';

    // Start OAuth login wizard
    (tui as any).handleKey('l');
    expect((tui as any).wizard.step).toBe('oauth_id');

    // Type ID suffix
    (tui as any).handleKeypress('m', { name: 'm' });
    (tui as any).handleKeypress('y', { name: 'y' });
    expect((tui as any).wizard.id).toBe('my');

    // Advance to clientId (keep default)
    (tui as any).handleKeypress('', { name: 'enter' });
    expect((tui as any).wizard.step).toBe('oauth_clientId');
    expect((tui as any).wizard.clientId).toBe('default-google-client-id');

    // Advance to clientSecret (keep default)
    (tui as any).handleKeypress('', { name: 'enter' });
    expect((tui as any).wizard.step).toBe('oauth_clientSecret');
    expect((tui as any).wizard.clientSecret).toBe('default-google-client-secret');

    // Advance to port (keep default)
    (tui as any).handleKeypress('', { name: 'enter' });
    expect((tui as any).wizard.step).toBe('oauth_port');
    expect((tui as any).wizard.port).toBe('52342');

    // Advance to waiting. This starts the callback server.
    const testPort = 52345;
    (tui as any).wizard.port = String(testPort);
    
    // Mock fetch
    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn().mockImplementation(async (url, options) => {
      return {
        ok: true,
        json: async () => ({
          access_token: 'fake-access-123',
          refresh_token: 'fake-refresh-456',
          expires_in: 3600
        })
      } as any;
    });
    globalThis.fetch = mockFetch;

    try {
      (tui as any).handleKeypress('', { name: 'enter' });
      expect((tui as any).wizard.step).toBe('oauth_waiting');

      // Trigger redirect callback HTTP request to our server
      const callbackRes = await new Promise<string>((resolve, reject) => {
        const req = http.request(`http://127.0.0.1:${testPort}/?code=mock-oauth-code-789`, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.end();
      });

      expect(callbackRes).toContain('Authentication Successful');

      // Let callback finish async exchange
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      expect((tui as any).wizard.step).toBe('none');
      expect((tui as any).oauthServer).toBeNull();

      const recordPath = join(tempAuthDir, 'gemini-my.json');
      expect(fs.existsSync(recordPath)).toBe(true);

      const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
      expect(record.id).toBe('gemini-my');
      expect(record.provider).toBe('gemini-oauth');
      expect(record.secrets.accessToken).toBe('fake-access-123');
      expect(record.secrets.refreshToken).toBe('fake-refresh-456');
    } finally {
      globalThis.fetch = originalFetch;
      if ((tui as any).oauthServer) {
        (tui as any).oauthServer.close();
      }
    }
  });
});

describe('parseRecentLogs', () => {
  it('formats operations logs data', () => {
    const rawData = { usage: [{ timestamp: '2026-06-10T12:00:00Z', status: 'success', latencyMs: 55 }] };
    const formatted = parseRecentLogs(rawData);
    expect(formatted[0]).toContain('success');
    expect(formatted[0]).toContain('55ms');
  });
});

describe('DashboardTui operations and stats update', () => {
  const tempConfigPath = 'temp-config-ops-test.json';

  beforeEach(() => {
    fs.writeFileSync(tempConfigPath, JSON.stringify({ server: { port: 8080 } }), 'utf8');
  });

  afterEach(() => {
    if (fs.existsSync(tempConfigPath)) {
      fs.unlinkSync(tempConfigPath);
    }
  });

  it('periodic updates fetch operations stats and marks online/offline status', async () => {
    const tui = new DashboardTui(tempConfigPath);
    expect((tui as any).isServerOnline).toBe(false);

    (tui as any).state.config = {
      server: {
        port: 52349,
        adminToken: 'test-admin-token'
      }
    };

    // Mock response from operations and providers
    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/admin/operations')) {
        return {
          ok: true,
          json: async () => ({
            routing: { strategy: 'priority' },
            health: {},
            usage: [{ timestamp: '2026-06-10T12:00:00Z', status: 'success', latencyMs: 55 }]
          })
        } as any;
      }
      if (url.includes('/admin/providers')) {
        return {
          ok: true,
          json: async () => ({
            providers: [{ id: 'groq', type: 'openai-compatible' }],
            health: {}
          })
        } as any;
      }
      return { ok: false } as any;
    });
    globalThis.fetch = mockFetch;

    try {
      await (tui as any).fetchStats();
      expect((tui as any).isServerOnline).toBe(true);
      expect((tui as any).operationsData.routing.strategy).toBe('priority');
      expect((tui as any).providersData.providers[0].id).toBe('groq');

      // Test offline fallback
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      await (tui as any).fetchStats();
      expect((tui as any).isServerOnline).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});







