import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import * as http from 'node:http';
import { validateDashboardConfig, formatTuiLine, updateSettingField, getSettingField, deleteProviderFromConfig, buildGoogleOAuthUrl, parseRecentLogs } from './dashboard-helper.js';

type Tab = 'overview' | 'providers' | 'settings' | 'logs';

interface SettingField {
  path: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  options?: string[];
}

const SETTINGS_FIELDS: SettingField[] = [
  { path: 'server.host', label: 'Server Host', type: 'string' },
  { path: 'server.port', label: 'Server Port', type: 'number' },
  { path: 'server.requestTimeoutMs', label: 'Request Timeout (ms)', type: 'number' },
  { path: 'server.maxBodyBytes', label: 'Max Body Bytes', type: 'number' },
  { path: 'routing.strategy', label: 'Routing Strategy', type: 'select', options: ['priority', 'weighted', 'round-robin', 'fill-first', 'session-affinity'] },
  { path: 'routing.sessionAffinity', label: 'Session Affinity', type: 'boolean' },
  { path: 'routing.healthCooldownMs', label: 'Health Cooldown (ms)', type: 'number' },
  { path: 'limits.global.rpm', label: 'Global RPM Limit', type: 'number' },
  { path: 'limits.global.tpm', label: 'Global TPM Limit', type: 'number' },
  { path: 'limits.global.maxParallel', label: 'Global Max Parallel Limit', type: 'number' }
];

interface TuiState {
  activeTab: Tab;
  selectedIndex: number;
  configPath: string;
  config: any;
  isEditing: boolean;
  editValue: string;
}

const TABS: Tab[] = ['overview', 'providers', 'settings', 'logs'];

const PROVIDER_TYPES = [
  'openai-compatible',
  'gemini',
  'openai-responses',
  'codex',
  'aistudio',
  'claude',
  'xai',
  'kimi',
  'fake'
];

interface UnifiedAccount {
  source: 'config' | 'auth';
  id: string;
  type: string;
  preview: string;
  disabled: boolean;
  raw: any;
}

function formatKeyPreview(key: string): string {
  if (!key) return '[None]';
  if (key.length <= 8) return '...';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

const ESC = '\x1b';
const RGB = (r: number, g: number, b: number) => `${ESC}[38;2;${r};${g};${b}m`;
const BG_RGB = (r: number, g: number, b: number) => `${ESC}[48;2;${r};${g};${b}m`;
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;

const COLORS = {
  bg: BG_RGB(30, 30, 46),
  sidebarBg: BG_RGB(24, 24, 37),
  text: RGB(205, 214, 244),
  blue: RGB(137, 180, 250),
  green: RGB(166, 227, 161),
  red: RGB(243, 139, 168),
  gray: RGB(127, 132, 156),
  accent: BG_RGB(49, 50, 68) + RGB(137, 180, 250) + BOLD
};

export class DashboardTui {
  private state: TuiState = {
    activeTab: 'overview',
    selectedIndex: 0,
    configPath: 'config.json',
    config: {},
    isEditing: false,
    editValue: ''
  };

  private authRecords: any[] = [];
  private oauthServer: http.Server | null = null;
  private isServerOnline = false;
  private operationsData: any = null;
  private providersData: any = null;
  private updateInterval: any = null;
  private wizard = {
    step: 'none' as 'id' | 'type' | 'baseUrl' | 'apiKey' | 'priority' | 'weight' | 'none' | 'oauth_id' | 'oauth_clientId' | 'oauth_clientSecret' | 'oauth_port' | 'oauth_waiting',
    id: '',
    type: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    priority: '1',
    weight: '1',
    isFirstKey: false,
    clientId: 'default-google-client-id',
    clientSecret: 'default-google-client-secret',
    port: '52342',
    oauthStatus: ''
  };

  constructor(configPath: string) {
    this.state.configPath = configPath;
    this.loadConfig();
  }

  private loadConfig() {
    try {
      if (fs.existsSync(this.state.configPath)) {
        const raw = fs.readFileSync(this.state.configPath, 'utf8');
        this.state.config = JSON.parse(raw);
        validateDashboardConfig(this.state.config);
      } else {
        this.state.config = {};
      }
    } catch (err) {
      this.state.config = {};
    }
    this.loadAuthRecords();
  }

  private loadAuthRecords() {
    try {
      const authDir = this.state.config.auth?.authDir || 'router-state/auth';
      if (fs.existsSync(authDir)) {
        const files = fs.readdirSync(authDir);
        this.authRecords = [];
        for (const file of files.filter((f) => f.endsWith('.json')).sort()) {
          const raw = fs.readFileSync(path.join(authDir, file), 'utf8');
          this.authRecords.push(JSON.parse(raw));
        }
      } else {
        this.authRecords = [];
      }
    } catch (err) {
      this.authRecords = [];
    }
  }

  private getUnifiedAccounts(): UnifiedAccount[] {
    const list: UnifiedAccount[] = [];
    if (Array.isArray(this.state.config.providers)) {
      for (const p of this.state.config.providers) {
        let preview = '[None]';
        if (p.apiKey) {
          preview = formatKeyPreview(p.apiKey);
        } else if (p.apiKeyEnv) {
          preview = `Env: ${p.apiKeyEnv}`;
        } else if (p.allowLocal) {
          preview = '[Local Only]';
        }
        list.push({
          source: 'config',
          id: p.id,
          type: p.type,
          preview,
          disabled: !!p.disabled,
          raw: p
        });
      }
    }
    for (const r of this.authRecords) {
      let preview = '[REDACTED]';
      if (r.metadata?.expiresAt) {
        preview = `Expires: ${r.metadata.expiresAt}`;
      } else if (r.secrets) {
        const firstSecret = Object.values(r.secrets)[0];
        if (typeof firstSecret === 'string') {
          preview = formatKeyPreview(firstSecret);
        }
      }
      list.push({
        source: 'auth',
        id: r.id,
        type: r.provider,
        preview,
        disabled: !!r.disabled,
        raw: r
      });
    }
    return list;
  }

  private advanceWizard() {
    const step = this.wizard.step;
    if (step === 'id') {
      const id = this.wizard.id.trim();
      if (!id) return;
      const accounts = this.getUnifiedAccounts();
      if (accounts.some((acc) => acc.id === id)) {
        this.wizard.step = 'none';
        this.render();
        return;
      }
      this.wizard.step = 'type';
      this.wizard.isFirstKey = true;
    } else if (step === 'type') {
      const type = this.wizard.type;
      if (type === 'openai-compatible') this.wizard.baseUrl = 'https://api.openai.com/v1';
      else if (type === 'gemini' || type === 'aistudio') this.wizard.baseUrl = 'https://generativelanguage.googleapis.com';
      else if (type === 'claude') this.wizard.baseUrl = 'https://api.anthropic.com';
      else if (type === 'xai') this.wizard.baseUrl = 'https://api.x.ai';
      else if (type === 'fake') this.wizard.baseUrl = 'http://localhost:8080';
      else this.wizard.baseUrl = '';
      this.wizard.step = 'baseUrl';
      this.wizard.isFirstKey = true;
    } else if (step === 'baseUrl') {
      this.wizard.step = 'apiKey';
      this.wizard.isFirstKey = true;
    } else if (step === 'apiKey') {
      this.wizard.priority = '1';
      this.wizard.step = 'priority';
      this.wizard.isFirstKey = true;
    } else if (step === 'priority') {
      this.wizard.weight = '1';
      this.wizard.step = 'weight';
      this.wizard.isFirstKey = true;
    } else if (step === 'weight') {
      const priorityStr = this.wizard.priority.trim();
      const weightStr = this.wizard.weight.trim();

      let priority = 1;
      if (priorityStr !== '') {
        if (!/^\d+$/.test(priorityStr)) {
          this.wizard.step = 'none';
          this.render();
          return;
        }
        priority = Number(priorityStr);
      }

      let weight = 1;
      if (weightStr !== '') {
        if (!/^\d+$/.test(weightStr)) {
          this.wizard.step = 'none';
          this.render();
          return;
        }
        weight = Number(weightStr);
      }

      const newProvider: any = {
        id: this.wizard.id.trim(),
        type: this.wizard.type,
        baseUrl: this.wizard.baseUrl.trim() || undefined,
        apiKey: this.wizard.apiKey.trim() || undefined,
        priority,
        weight
      };
      if (!this.state.config.providers) {
        this.state.config.providers = [];
      }
      this.state.config.providers.push(newProvider);
      this.saveConfig();
      this.loadConfig();
      this.wizard.step = 'none';
    } else if (step === 'oauth_id') {
      const id = this.wizard.id.trim();
      if (!id) return;
      const accounts = this.getUnifiedAccounts();
      if (accounts.some((acc) => acc.id === `gemini-${id}`)) {
        this.wizard.step = 'none';
        this.render();
        return;
      }
      this.wizard.step = 'oauth_clientId';
      this.wizard.isFirstKey = true;
    } else if (step === 'oauth_clientId') {
      this.wizard.step = 'oauth_clientSecret';
      this.wizard.isFirstKey = true;
    } else if (step === 'oauth_clientSecret') {
      this.wizard.step = 'oauth_port';
      this.wizard.isFirstKey = true;
    } else if (step === 'oauth_port') {
      this.wizard.step = 'oauth_waiting';
      this.startOAuthCallbackServer();
    }
    this.render();
  }

  private startOAuthCallbackServer() {
    const portNum = Number(this.wizard.port) || 52342;
    const redirectUri = `http://localhost:${portNum}/`;
    this.wizard.oauthStatus = 'Starting local callback server...';
    
    if (this.oauthServer) {
      this.oauthServer.close();
      this.oauthServer = null;
    }

    try {
      this.oauthServer = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);
        const code = url.searchParams.get('code');
        if (code) {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('<h1>Authentication Successful!</h1><p>You can close this window now and return to the terminal.</p>');
          
          this.wizard.oauthStatus = 'Code received. Exchanging for tokens...';
          this.render();

          if (this.oauthServer) {
            this.oauthServer.close();
            this.oauthServer = null;
          }

          try {
            const tokenUrl = process.env.GEMINI_TOKEN_URL || 'https://oauth2.googleapis.com/token';
            const tokenRes = await fetch(tokenUrl, {
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                code,
                client_id: this.wizard.clientId,
                client_secret: this.wizard.clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
              })
            });

            if (!tokenRes.ok) {
              throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
            }

            const tokens = await tokenRes.json() as any;
            const now = new Date();
            const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
            
            const authRecord = {
              id: `gemini-${this.wizard.id.trim()}`,
              provider: 'gemini-oauth',
              status: 'available',
              disabled: false,
              createdAt: now.toISOString(),
              updatedAt: now.toISOString(),
              lastRefreshedAt: now.toISOString(),
              nextRefreshAfter: new Date(Date.now() + Math.max(60, (tokens.expires_in ?? 3600) - 300) * 1000).toISOString(),
              attributes: {
                clientId: this.wizard.clientId,
                clientSecret: this.wizard.clientSecret
              },
              secrets: {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token || ''
              },
              metadata: {
                expiresAt
              }
            };

            const authDir = this.state.config.auth?.authDir || 'router-state/auth';
            if (!fs.existsSync(authDir)) {
              fs.mkdirSync(authDir, { recursive: true });
            }
            const recordPath = path.join(authDir, `${authRecord.id}.json`);
            fs.writeFileSync(recordPath, JSON.stringify(authRecord, null, 2) + '\n', 'utf8');

            this.loadConfig();
            this.wizard.step = 'none';
            this.render();
          } catch (exchangeErr: any) {
            this.wizard.oauthStatus = `Error: ${exchangeErr.message || exchangeErr}`;
            this.render();
          }
        } else {
          res.writeHead(400);
          res.end('Missing code parameter');
        }
      });

      this.oauthServer.listen(portNum, '127.0.0.1', () => {
        this.wizard.oauthStatus = `Listening on http://localhost:${portNum}/ for redirect...`;
        this.render();
      });

      this.oauthServer.on('error', (err: any) => {
        this.wizard.oauthStatus = `Server error: ${err.message || err}`;
        this.render();
      });
    } catch (serverErr: any) {
      this.wizard.oauthStatus = `Failed to start server: ${serverErr.message || serverErr}`;
      this.render();
    }
  }

  private backspaceWizard() {
    this.wizard.isFirstKey = false;
    const step = this.wizard.step;
    if (step === 'id' || step === 'oauth_id') this.wizard.id = this.wizard.id.slice(0, -1);
    else if (step === 'baseUrl') this.wizard.baseUrl = this.wizard.baseUrl.slice(0, -1);
    else if (step === 'apiKey') this.wizard.apiKey = this.wizard.apiKey.slice(0, -1);
    else if (step === 'priority') this.wizard.priority = this.wizard.priority.slice(0, -1);
    else if (step === 'weight') this.wizard.weight = this.wizard.weight.slice(0, -1);
    else if (step === 'oauth_clientId') this.wizard.clientId = this.wizard.clientId.slice(0, -1);
    else if (step === 'oauth_clientSecret') this.wizard.clientSecret = this.wizard.clientSecret.slice(0, -1);
    else if (step === 'oauth_port') this.wizard.port = this.wizard.port.slice(0, -1);
    this.render();
  }

  private typeWizard(str: string) {
    const step = this.wizard.step;
    if (this.wizard.isFirstKey) {
      this.wizard.isFirstKey = false;
      if (step === 'id' || step === 'oauth_id') this.wizard.id = str;
      else if (step === 'baseUrl') this.wizard.baseUrl = str;
      else if (step === 'apiKey') this.wizard.apiKey = str;
      else if (step === 'priority') this.wizard.priority = str;
      else if (step === 'weight') this.wizard.weight = str;
      else if (step === 'oauth_clientId') this.wizard.clientId = str;
      else if (step === 'oauth_clientSecret') this.wizard.clientSecret = str;
      else if (step === 'oauth_port') this.wizard.port = str;
    } else {
      if (step === 'id' || step === 'oauth_id') this.wizard.id += str;
      else if (step === 'baseUrl') this.wizard.baseUrl += str;
      else if (step === 'apiKey') this.wizard.apiKey += str;
      else if (step === 'priority') this.wizard.priority += str;
      else if (step === 'weight') this.wizard.weight += str;
      else if (step === 'oauth_clientId') this.wizard.clientId += str;
      else if (step === 'oauth_clientSecret') this.wizard.clientSecret += str;
      else if (step === 'oauth_port') this.wizard.port += str;
    }
    this.render();
  }

  private saveConfig() {
    try {
      fs.writeFileSync(this.state.configPath, JSON.stringify(this.state.config, null, 2), 'utf8');
    } catch (err) {
      // Ignore
    }
  }

  private async fetchStats() {
    const port = this.state.config?.server?.port || 8080;
    const adminToken = this.state.config?.server?.adminToken || '';
    const headers: Record<string, string> = {};
    if (adminToken) {
      headers['Authorization'] = `Bearer ${adminToken}`;
    }

    try {
      const [opsRes, provsRes] = await Promise.all([
        fetch(`http://localhost:${port}/admin/operations`, { headers }),
        fetch(`http://localhost:${port}/admin/providers`, { headers })
      ]);

      if (opsRes.ok && provsRes.ok) {
        this.operationsData = await opsRes.json();
        this.providersData = await provsRes.json();
        this.isServerOnline = true;
      } else {
        this.isServerOnline = false;
      }
    } catch (err) {
      this.isServerOnline = false;
    }

    if (this.state.activeTab === 'overview' || this.state.activeTab === 'logs') {
      this.render();
    }
  }

  private startPeriodicUpdate() {
    this.fetchStats();
    this.updateInterval = setInterval(() => {
      this.fetchStats();
    }, 1000);
  }

  start() {
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    readline.emitKeypressEvents(process.stdin);
    process.stdin.resume();
    process.stdout.write(`${ESC}[?25l`); // Hide cursor

    this.render();
    this.startPeriodicUpdate();

    process.stdin.on('keypress', (str, key) => {
      if (key && key.ctrl && key.name === 'c') {
        this.exit();
      }
      this.handleKeypress(str, key);
    });

    process.stdout.on('resize', () => {
      this.render();
    });
  }

  private exit() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    process.stdout.write(`${ESC}[?25h`); // Show cursor
    process.stdout.write(`${ESC}[2J${ESC}[H`);
    process.exit(0);
  }

  private handleKeypress(str: string, key: any) {
    if (this.state.activeTab === 'settings' && this.state.isEditing) {
      if (key && key.name === 'escape') {
        this.state.isEditing = false;
        this.render();
      } else if (key && (key.name === 'enter' || key.name === 'return')) {
        this.saveEdit();
      } else if (key && key.name === 'backspace') {
        this.state.editValue = this.state.editValue.slice(0, -1);
        this.render();
      } else if (str && str.length === 1 && str.charCodeAt(0) >= 32) {
        if (!key || (!key.ctrl && !key.meta)) {
          this.state.editValue += str;
          this.render();
        }
      }
    } else if (this.state.activeTab === 'providers' && this.wizard.step !== 'none') {
      if (key && key.name === 'escape') {
        if (this.oauthServer) {
          this.oauthServer.close();
          this.oauthServer = null;
        }
        this.wizard.step = 'none';
        this.render();
      } else if (key && (key.name === 'enter' || key.name === 'return')) {
        this.advanceWizard();
      } else if (key && key.name === 'backspace') {
        this.backspaceWizard();
      } else if (key && (key.name === 'up' || key.name === 'down')) {
        if (this.wizard.step === 'type') {
          const idx = PROVIDER_TYPES.indexOf(this.wizard.type);
          if (key.name === 'up') {
            this.wizard.type = PROVIDER_TYPES[(idx - 1 + PROVIDER_TYPES.length) % PROVIDER_TYPES.length]!;
          } else {
            this.wizard.type = PROVIDER_TYPES[(idx + 1) % PROVIDER_TYPES.length]!;
          }
          this.render();
        }
      } else if (str && str.length === 1 && str.charCodeAt(0) >= 32) {
        if (!key || (!key.ctrl && !key.meta)) {
          this.typeWizard(str);
        }
      }
    } else {
      if (key && key.name) {
        this.handleKey(key.name);
      }
    }
  }

  private saveEdit() {
    const field = SETTINGS_FIELDS[this.state.selectedIndex];
    if (field) {
      const trimmed = this.state.editValue.trim();
      let value: any;

      if (trimmed === '') {
        value = undefined;
      } else {
        if (field.type === 'number') {
          value = Number(trimmed);
          if (isNaN(value)) {
            this.state.isEditing = false;
            this.render();
            return;
          }
        } else if (field.type === 'boolean') {
          const lower = trimmed.toLowerCase();
          if (lower === 'true') {
            value = true;
          } else if (lower === 'false') {
            value = false;
          } else {
            this.state.isEditing = false;
            this.render();
            return;
          }
        } else if (field.type === 'select') {
          if (field.options && !field.options.includes(trimmed)) {
            this.state.isEditing = false;
            this.render();
            return;
          }
          value = trimmed;
        } else {
          value = trimmed;
        }
      }

      updateSettingField(this.state.config, field.path, value);
      this.saveConfig();
    }
    this.state.isEditing = false;
    this.render();
  }

  private handleKey(keyName: string) {
    if (keyName === 'q') {
      this.exit();
    } else if (keyName === 'left') {
      const idx = TABS.indexOf(this.state.activeTab);
      this.state.activeTab = TABS[(idx - 1 + TABS.length) % TABS.length]!;
      this.state.selectedIndex = 0;
      this.render();
      if (this.state.activeTab === 'overview' || this.state.activeTab === 'logs') {
        this.fetchStats();
      }
    } else if (keyName === 'right') {
      const idx = TABS.indexOf(this.state.activeTab);
      this.state.activeTab = TABS[(idx + 1) % TABS.length]!;
      this.state.selectedIndex = 0;
      this.render();
      if (this.state.activeTab === 'overview' || this.state.activeTab === 'logs') {
        this.fetchStats();
      }
    } else if (keyName === 'up') {
      if (this.state.activeTab === 'settings') {
        this.state.selectedIndex = Math.max(0, this.state.selectedIndex - 1);
      } else if (this.state.activeTab === 'providers') {
        this.state.selectedIndex = Math.max(0, this.state.selectedIndex - 1);
      } else {
        this.state.selectedIndex = Math.max(0, this.state.selectedIndex - 1);
      }
      this.render();
    } else if (keyName === 'down') {
      if (this.state.activeTab === 'settings') {
        this.state.selectedIndex = Math.min(SETTINGS_FIELDS.length - 1, this.state.selectedIndex + 1);
      } else if (this.state.activeTab === 'providers') {
        const len = this.getUnifiedAccounts().length;
        this.state.selectedIndex = Math.min(Math.max(0, len - 1), this.state.selectedIndex + 1);
      } else {
        this.state.selectedIndex = this.state.selectedIndex + 1;
      }
      this.render();
    } else if (keyName === 'enter' || keyName === 'return') {
      if (this.state.activeTab === 'settings') {
        const field = SETTINGS_FIELDS[this.state.selectedIndex];
        if (field) {
          this.state.isEditing = true;
          const val = getSettingField(this.state.config, field.path);
          this.state.editValue = val === undefined ? '' : String(val);
          this.render();
        }
      }
    } else if (keyName === 'd') {
      if (this.state.activeTab === 'providers' && this.wizard.step === 'none') {
        const accounts = this.getUnifiedAccounts();
        const selected = accounts[this.state.selectedIndex];
        if (selected) {
          if (selected.source === 'config') {
            selected.raw.disabled = !selected.raw.disabled;
            this.saveConfig();
            this.loadConfig();
          } else if (selected.source === 'auth') {
            selected.raw.disabled = !selected.raw.disabled;
            const authDir = this.state.config.auth?.authDir || 'router-state/auth';
            if (!fs.existsSync(authDir)) {
              fs.mkdirSync(authDir, { recursive: true });
            }
            const filePath = path.join(authDir, `${selected.id}.json`);
            fs.writeFileSync(filePath, JSON.stringify(selected.raw, null, 2) + '\n', 'utf8');
            this.loadConfig();
          }
        }
      }
    } else if (keyName === 'delete') {
      if (this.state.activeTab === 'providers' && this.wizard.step === 'none') {
        const accounts = this.getUnifiedAccounts();
        const selected = accounts[this.state.selectedIndex];
        if (selected) {
          if (selected.source === 'config') {
            deleteProviderFromConfig(this.state.config, selected.id);
            this.saveConfig();
            this.loadConfig();
            this.state.selectedIndex = Math.max(0, this.state.selectedIndex - 1);
          } else if (selected.source === 'auth') {
            const authDir = this.state.config.auth?.authDir || 'router-state/auth';
            const filePath = path.join(authDir, `${selected.id}.json`);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
            this.loadConfig();
            this.state.selectedIndex = Math.max(0, this.state.selectedIndex - 1);
          }
        }
      }
    } else if (keyName === 'a') {
      if (this.state.activeTab === 'providers' && this.wizard.step === 'none') {
        this.wizard = {
          step: 'id',
          id: '',
          type: 'openai-compatible',
          baseUrl: '',
          apiKey: '',
          priority: '1',
          weight: '1',
          isFirstKey: true,
          clientId: 'default-google-client-id',
          clientSecret: 'default-google-client-secret',
          port: '52342',
          oauthStatus: ''
        };
        this.render();
      }
    } else if (keyName === 'l') {
      if (this.state.activeTab === 'providers' && this.wizard.step === 'none') {
        this.wizard = {
          step: 'oauth_id',
          id: '',
          type: 'gemini-oauth',
          baseUrl: '',
          apiKey: '',
          priority: '1',
          weight: '1',
          isFirstKey: true,
          clientId: 'default-google-client-id',
          clientSecret: 'default-google-client-secret',
          port: '52342',
          oauthStatus: ''
        };
        this.render();
      }
    }
  }

  private render() {
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;

    // Build frame buffer
    const buffer: string[] = [];
    const statusText = this.isServerOnline
      ? `${COLORS.green}${BOLD}● ONLINE${RESET}${COLORS.blue}`
      : `${COLORS.red}${BOLD}○ OFFLINE${RESET}${COLORS.blue}`;
    buffer.push(COLORS.blue + formatTuiLine(`⚡ FREE AI ROUTER CONTROL PANEL  |  Server: ${statusText}`, cols) + RESET);

    // Sidebar vs details split
    const bodyHeight = rows - 3;
    const sidebarWidth = 24;
    const detailWidth = cols - sidebarWidth - 1;

    const DETAIL_DEFAULT = RESET + COLORS.bg + COLORS.text;
    const detailLines: string[] = [];
    if (this.state.activeTab === 'settings') {
      detailLines.push(`${COLORS.blue}${BOLD}🛠 Settings Editor${DETAIL_DEFAULT}`);
      detailLines.push(`${COLORS.gray}Use Up/Down to navigate, Enter to edit, Left/Right to change tabs${DETAIL_DEFAULT}`);
      detailLines.push('');

      for (let i = 0; i < SETTINGS_FIELDS.length; i++) {
        const field = SETTINGS_FIELDS[i]!;
        const isSelected = i === this.state.selectedIndex;
        const value = getSettingField(this.state.config, field.path);
        
        let displayValue = value === undefined ? '(not set)' : String(value);
        if (field.type === 'boolean' && value !== undefined) {
          displayValue = value ? 'true' : 'false';
        }

        const prefix = isSelected ? `${COLORS.blue}➔ ` : '  ';
        let line = '';
        if (isSelected && this.state.isEditing) {
          line = `${prefix}${COLORS.green}${field.label} (${field.path}): [${this.state.editValue}_]${DETAIL_DEFAULT}`;
          if (field.type === 'select') {
            line += ` ${COLORS.gray}(Options: ${field.options?.join(', ')})${DETAIL_DEFAULT}`;
          } else if (field.type === 'boolean') {
            line += ` ${COLORS.gray}(true/false)${DETAIL_DEFAULT}`;
          }
        } else {
          const valColor = value === undefined ? COLORS.gray : COLORS.text;
          line = `${prefix}${COLORS.text}${field.label} (${field.path}): ${valColor}${displayValue}${DETAIL_DEFAULT}`;
        }
        detailLines.push(line);
      }
    } else if (this.state.activeTab === 'providers') {
      if (this.wizard.step !== 'none') {
        const isOauth = this.wizard.step.startsWith('oauth_');
        if (isOauth) {
          detailLines.push(`${COLORS.blue}${BOLD}🔑 Gemini OAuth Login Setup${DETAIL_DEFAULT}`);
          detailLines.push(`${COLORS.gray}Configure Google OAuth credentials. [Enter] to advance, [Esc] to cancel${DETAIL_DEFAULT}`);
          detailLines.push('');

          if (this.wizard.step === 'oauth_waiting') {
            detailLines.push(`  ${COLORS.text}Local Redirect URI: ${COLORS.blue}http://localhost:${this.wizard.port}/${DETAIL_DEFAULT}`);
            detailLines.push(`  ${COLORS.text}Authorize URL (Copy & Open in browser):${DETAIL_DEFAULT}`);
            const portNum = Number(this.wizard.port) || 52342;
            const redirectUri = `http://localhost:${portNum}/`;
            const authUrl = buildGoogleOAuthUrl(this.wizard.clientId, redirectUri);
            detailLines.push(`  ${COLORS.blue}${BOLD}${authUrl}${DETAIL_DEFAULT}`);
            detailLines.push('');
            detailLines.push(`  ${COLORS.green}${BOLD}Status: ${this.wizard.oauthStatus}${DETAIL_DEFAULT}`);
          } else {
            const oauthSteps = [
              { key: 'oauth_id', label: 'Account ID suffix', value: this.wizard.id, desc: "(e.g., 'personal' for id gemini-personal)" },
              { key: 'oauth_clientId', label: 'Google Client ID', value: this.wizard.clientId, desc: '(Press Enter for default)' },
              { key: 'oauth_clientSecret', label: 'Google Client Secret', value: '*'.repeat(this.wizard.clientSecret.length), desc: '(Press Enter for default)' },
              { key: 'oauth_port', label: 'Local Redirect Port', value: this.wizard.port, desc: '(e.g., 52342)' }
            ];

            for (const s of oauthSteps) {
              const isActive = this.wizard.step === s.key;
              const prefix = isActive ? `${COLORS.blue}➔ ` : '  ';
              const labelColor = isActive ? COLORS.green : COLORS.text;
              const valColor = isActive ? COLORS.green + BOLD : COLORS.text;
              
              let line = `${prefix}${labelColor}${s.label}: ${valColor}${s.value || ''}${DETAIL_DEFAULT}`;
              if (isActive) {
                line += ` [${COLORS.blue}_${DETAIL_DEFAULT}] ${COLORS.gray}${s.desc}${DETAIL_DEFAULT}`;
              }
              detailLines.push(line);
            }
          }
        } else {
          detailLines.push(`${COLORS.blue}${BOLD}➕ Add New API Key Provider${DETAIL_DEFAULT}`);
          detailLines.push(`${COLORS.gray}Enter configuration values. [Enter] to advance, [Esc] to cancel${DETAIL_DEFAULT}`);
          detailLines.push('');

          const steps = [
            { key: 'id', label: 'Provider ID', value: this.wizard.id, desc: '(e.g., openai-1, gemini-personal)' },
            { key: 'type', label: 'Provider Type', value: this.wizard.type, desc: '(Use Up/Down keys to change type)' },
            { key: 'baseUrl', label: 'Base URL', value: this.wizard.baseUrl, desc: '(e.g., https://api.openai.com/v1)' },
            { key: 'apiKey', label: 'API Key', value: '*'.repeat(this.wizard.apiKey.length), desc: '(hidden for security)' },
            { key: 'priority', label: 'Priority', value: this.wizard.priority, desc: '(Higher priority checked first)' },
            { key: 'weight', label: 'Weight', value: this.wizard.weight, desc: '(For load balancing)' }
          ];

          for (const s of steps) {
            const isActive = this.wizard.step === s.key;
            const prefix = isActive ? `${COLORS.blue}➔ ` : '  ';
            const labelColor = isActive ? COLORS.green : COLORS.text;
            const valColor = isActive ? COLORS.green + BOLD : COLORS.text;
            
            let line = `${prefix}${labelColor}${s.label}: ${valColor}${s.value || ''}${DETAIL_DEFAULT}`;
            if (isActive) {
              line += ` [${COLORS.blue}_${DETAIL_DEFAULT}] ${COLORS.gray}${s.desc}${DETAIL_DEFAULT}`;
            }
            detailLines.push(line);
          }
        }
      } else {
        detailLines.push(`${COLORS.blue}${BOLD}🔑 Provider Accounts${DETAIL_DEFAULT}`);
        detailLines.push(`${COLORS.gray}Use Up/Down to navigate, [D] Toggle Active, [Delete] Remove, [A] Add Key, [L] OAuth Login${DETAIL_DEFAULT}`);
        detailLines.push('');

        const accounts = this.getUnifiedAccounts();
        if (accounts.length === 0) {
          detailLines.push(`  ${COLORS.gray}(No provider accounts found)${DETAIL_DEFAULT}`);
        } else {
          detailLines.push(`  ${BOLD}${COLORS.text}${'ID'.padEnd(20)} ${'Type'.padEnd(20)} ${'Key/OAuth Preview'.padEnd(20)} Status${DETAIL_DEFAULT}`);
          detailLines.push(`  ${COLORS.gray}-------------------------------------------------------------------------${DETAIL_DEFAULT}`);
          
          for (let i = 0; i < accounts.length; i++) {
            const acc = accounts[i]!;
            const isSelected = i === this.state.selectedIndex;
            const prefix = isSelected ? `${COLORS.blue}➔ ` : '  ';
            
            const idCol = acc.id.padEnd(20).slice(0, 20);
            const typeCol = acc.type.padEnd(20).slice(0, 20);
            const previewCol = acc.preview.padEnd(20).slice(0, 20);
            const statusCol = acc.disabled 
              ? `${COLORS.red}○ Disabled${DETAIL_DEFAULT}` 
              : `${COLORS.green}● Active${DETAIL_DEFAULT}`;

            const rowColor = isSelected ? COLORS.blue : COLORS.text;
            const line = `${prefix}${rowColor}${idCol} ${typeCol} ${previewCol} ${statusCol}`;
            detailLines.push(line);
          }
        }
      }
    } else if (this.state.activeTab === 'overview') {
      detailLines.push(`${COLORS.blue}${BOLD}⚙ Router Overview${DETAIL_DEFAULT}`);
      detailLines.push(`${COLORS.gray}Live router status and health metrics${DETAIL_DEFAULT}`);
      detailLines.push('');

      if (!this.isServerOnline) {
        detailLines.push(`  Status: ${COLORS.red}${BOLD}Offline${DETAIL_DEFAULT}`);
        detailLines.push(`  Endpoint: ${COLORS.gray}http://localhost:${this.state.config?.server?.port || 8080}${DETAIL_DEFAULT}`);
        detailLines.push('');
        detailLines.push(`  ${COLORS.gray}The router server is currently unreachable.${DETAIL_DEFAULT}`);
        detailLines.push(`  ${COLORS.gray}Please start it using:${DETAIL_DEFAULT}`);
        detailLines.push(`    ${COLORS.blue}npm run dev${DETAIL_DEFAULT}  or  ${COLORS.blue}npm run start${DETAIL_DEFAULT}`);
      } else {
        const port = this.state.config?.server?.port || 8080;
        detailLines.push(`  Server Status: ${COLORS.green}${BOLD}● ONLINE${DETAIL_DEFAULT}  |  Port: ${COLORS.blue}${port}${DETAIL_DEFAULT}`);
        
        const strategy = this.operationsData?.routing?.strategy || 'priority';
        const sessionAffinity = this.operationsData?.routing?.sessionAffinity ? 'enabled' : 'disabled';
        detailLines.push(`  Routing Strategy: ${COLORS.blue}${strategy}${DETAIL_DEFAULT} (session affinity: ${sessionAffinity})`);
        detailLines.push('');

        detailLines.push(`  ${BOLD}${COLORS.text}Provider Health:${DETAIL_DEFAULT}`);
        const providers = this.providersData?.providers || [];
        const health = this.providersData?.health || {};
        if (providers.length === 0) {
          detailLines.push(`    ${COLORS.gray}No providers configured.${DETAIL_DEFAULT}`);
        } else {
          for (const p of providers) {
            const h = health[p.id];
            const cooldown = h?.cooldownUntil || 0;
            const consecutiveFailures = h?.consecutiveFailures || 0;
            const isCooldown = cooldown > Date.now();
            let healthStr = `${COLORS.green}● Healthy${DETAIL_DEFAULT}`;
            if (isCooldown) {
              const remaining = Math.ceil((cooldown - Date.now()) / 1000);
              healthStr = `${COLORS.red}○ Cooldown (${remaining}s remaining)${DETAIL_DEFAULT}`;
            } else if (consecutiveFailures > 0) {
              healthStr = `${COLORS.gray}● Failures (${consecutiveFailures})${DETAIL_DEFAULT}`;
            }
            detailLines.push(`    - ${COLORS.blue}${p.id.padEnd(20)}${DETAIL_DEFAULT}: ${healthStr}`);
          }
        }
        detailLines.push('');

        const usage = this.operationsData?.usage || [];
        detailLines.push(`  ${BOLD}${COLORS.text}Traffic Statistics (last ${usage.length} requests):${DETAIL_DEFAULT}`);
        if (usage.length === 0) {
          detailLines.push(`    ${COLORS.gray}No traffic recorded yet.${DETAIL_DEFAULT}`);
        } else {
          const total = usage.length;
          const errors = usage.filter((u: any) => u.status === 'error').length;
          const avgLatency = Math.round(usage.reduce((sum: number, u: any) => sum + (u.latencyMs || 0), 0) / total);
          const errorRate = Math.round((errors / total) * 100);

          detailLines.push(`    - Total Requests: ${COLORS.blue}${total}${DETAIL_DEFAULT}`);
          detailLines.push(`    - Success Rate  : ${errorRate > 0 ? COLORS.red : COLORS.green}${100 - errorRate}%${DETAIL_DEFAULT}`);
          detailLines.push(`    - Avg Latency   : ${COLORS.blue}${avgLatency}ms${DETAIL_DEFAULT}`);
        }
      }
    } else if (this.state.activeTab === 'logs') {
      detailLines.push(`${COLORS.blue}${BOLD}📋 Operations Logs${DETAIL_DEFAULT}`);
      detailLines.push(`${COLORS.gray}Real-time operations log from the API router${DETAIL_DEFAULT}`);
      detailLines.push('');

      if (!this.isServerOnline) {
        detailLines.push(`  Status: ${COLORS.red}${BOLD}Offline${DETAIL_DEFAULT}`);
        detailLines.push('');
        detailLines.push(`  ${COLORS.gray}Logs are only available when the server is online.${DETAIL_DEFAULT}`);
      } else {
        const logs = parseRecentLogs(this.operationsData || {});
        if (logs.length === 0) {
          detailLines.push(`  ${COLORS.gray}No logs recorded yet. Send requests to the router to see them live.${DETAIL_DEFAULT}`);
        } else {
          const maxLogs = bodyHeight - 4;
          const visibleLogs = logs.slice(0, maxLogs);
          for (const logLine of visibleLogs) {
            let coloredLine = logLine;
            if (coloredLine.includes('success')) {
              coloredLine = coloredLine.replace('success', `${COLORS.green}success${COLORS.text}`);
            } else if (coloredLine.includes('error')) {
              coloredLine = coloredLine.replace('error', `${COLORS.red}error${COLORS.text}`);
            }
            detailLines.push(`  ${coloredLine}`);
          }
        }
      }
    }

    for (let r = 0; r < bodyHeight; r++) {
      let left = '';
      if (r === 1) left = `${this.state.activeTab === 'overview' ? COLORS.accent : COLORS.text}  ⚙ Overview            ${RESET}`;
      else if (r === 2) left = `${this.state.activeTab === 'providers' ? COLORS.accent : COLORS.text}  🔑 Providers & Auth   ${RESET}`;
      else if (r === 3) left = `${this.state.activeTab === 'settings' ? COLORS.accent : COLORS.text}  🛠 Settings Editor    ${RESET}`;
      else if (r === 4) left = `${this.state.activeTab === 'logs' ? COLORS.accent : COLORS.text}  📋 Operations Logs    ${RESET}`;
      else left = COLORS.text + ' '.repeat(sidebarWidth) + RESET;

      const detailContent = detailLines[r] !== undefined ? detailLines[r]! : '';
      const right = COLORS.bg + COLORS.text + formatTuiLine(detailContent, detailWidth) + RESET;
      buffer.push(COLORS.sidebarBg + left + COLORS.bg + '│' + right);
    }

    let footerText = ' ⌨ Arrow Keys: Navigate | [q] Quit';
    if (this.state.activeTab === 'settings') {
      if (this.state.isEditing) {
        footerText = ' ⌨ [Enter]: Save | [Esc]: Cancel | [Backspace]: Delete';
      } else {
        footerText = ' ⌨ Up/Down: Select | [Enter]: Edit | Left/Right: Tabs | [q] Quit';
      }
    } else if (this.state.activeTab === 'providers') {
      if (this.wizard.step !== 'none') {
        if (this.wizard.step === 'oauth_waiting') {
          footerText = ' ⌨ [Esc]: Cancel / Exit OAuth setup';
        } else {
          footerText = ' ⌨ [Enter]: Next/Save | [Esc]: Cancel | [Backspace]: Backspace';
        }
      } else {
        footerText = ' ⌨ Up/Down: Select | [D]: Toggle Active | [Delete]: Remove | [A]: Add Key | [L]: OAuth Login | Left/Right: Tabs | [q] Quit';
      }
    }
    buffer.push(COLORS.blue + formatTuiLine(footerText, cols) + RESET);

    // Write buffer in one go with screen clear to avoid resize garbage
    process.stdout.write(`${ESC}[2J${ESC}[H` + buffer.join('\n'));
  }

}

// Start CLI if directly run
if (process.argv[1]?.endsWith('dashboard.ts') || process.argv[1]?.endsWith('dashboard.js')) {
  const args = process.argv.slice(2);
  const configIdx = args.indexOf('--config');
  const configPath = configIdx !== -1 ? args[configIdx + 1] ?? 'config.json' : 'config.json';
  const tui = new DashboardTui(configPath);
  tui.start();
}
