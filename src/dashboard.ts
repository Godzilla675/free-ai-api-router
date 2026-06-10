import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { validateDashboardConfig, formatTuiLine, updateSettingField, getSettingField } from './dashboard-helper.js';

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
  }

  private saveConfig() {
    try {
      fs.writeFileSync(this.state.configPath, JSON.stringify(this.state.config, null, 2), 'utf8');
    } catch (err) {
      // Ignore
    }
  }

  start() {
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    readline.emitKeypressEvents(process.stdin);
    process.stdin.resume();
    process.stdout.write(`${ESC}[?25l`); // Hide cursor

    this.render();

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
      if (field.type === 'number') {
        if (trimmed === '') {
          value = undefined;
        } else {
          value = Number(trimmed);
          if (isNaN(value)) {
            value = undefined;
          }
        }
      } else if (field.type === 'boolean') {
        value = trimmed.toLowerCase() === 'true';
      } else {
        value = trimmed;
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
    } else if (keyName === 'right') {
      const idx = TABS.indexOf(this.state.activeTab);
      this.state.activeTab = TABS[(idx + 1) % TABS.length]!;
      this.state.selectedIndex = 0;
      this.render();
    } else if (keyName === 'up') {
      if (this.state.activeTab === 'settings') {
        this.state.selectedIndex = Math.max(0, this.state.selectedIndex - 1);
      } else {
        this.state.selectedIndex = Math.max(0, this.state.selectedIndex - 1);
      }
      this.render();
    } else if (keyName === 'down') {
      if (this.state.activeTab === 'settings') {
        this.state.selectedIndex = Math.min(SETTINGS_FIELDS.length - 1, this.state.selectedIndex + 1);
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
    }
  }

  private render() {
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;

    // Build frame buffer
    const buffer: string[] = [];
    buffer.push(COLORS.blue + formatTuiLine(`⚡ FREE AI ROUTER CONTROL PANEL`, cols) + RESET);

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
    } else {
      detailLines.push(formatTuiLine(` Active Tab: ${this.state.activeTab.toUpperCase()}`, detailWidth));
      detailLines.push(formatTuiLine(` Selection Row: ${this.state.selectedIndex}`, detailWidth));
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
