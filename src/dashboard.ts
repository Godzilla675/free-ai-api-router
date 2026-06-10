import * as readline from 'node:readline';
import { validateDashboardConfig, formatTuiLine } from './dashboard-helper.js';

type Tab = 'overview' | 'providers' | 'settings' | 'logs';

interface TuiState {
  activeTab: Tab;
  selectedIndex: number;
  configPath: string;
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
  private state: TuiState = { activeTab: 'overview', selectedIndex: 0, configPath: 'config.json' };

  constructor(configPath: string) {
    this.state.configPath = configPath;
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
      if (key && key.name) {
        this.handleKey(key.name);
      }
    });

    process.stdout.on('resize', () => {
      this.render();
    });
  }

  private exit() {
    process.stdout.write(`${ESC}[?25h`); // Show cursor
    process.stdout.write(`${ESC}[2J${ESC}[H`);
    process.exit(0);
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
      this.state.selectedIndex = Math.max(0, this.state.selectedIndex - 1);
      this.render();
    } else if (keyName === 'down') {
      this.state.selectedIndex = this.state.selectedIndex + 1;
      this.render();
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

    for (let r = 0; r < bodyHeight; r++) {
      let left = '';
      if (r === 1) left = `${this.state.activeTab === 'overview' ? COLORS.accent : COLORS.text}  ⚙ Overview            ${RESET}`;
      else if (r === 2) left = `${this.state.activeTab === 'providers' ? COLORS.accent : COLORS.text}  🔑 Providers & Auth   ${RESET}`;
      else if (r === 3) left = `${this.state.activeTab === 'settings' ? COLORS.accent : COLORS.text}  🛠 Settings Editor    ${RESET}`;
      else if (r === 4) left = `${this.state.activeTab === 'logs' ? COLORS.accent : COLORS.text}  📋 Operations Logs    ${RESET}`;
      else left = COLORS.text + ' '.repeat(sidebarWidth) + RESET;

      const right = COLORS.text + formatTuiLine(` Active Tab: ${this.state.activeTab.toUpperCase()} | Selection Row: ${this.state.selectedIndex}`, detailWidth) + RESET;
      buffer.push(COLORS.sidebarBg + left + COLORS.bg + '│' + right);
    }

    buffer.push(COLORS.blue + formatTuiLine(` ⌨ Arrow Keys: Navigate | [q] Quit`, cols) + RESET);

    // Write buffer in one go
    process.stdout.write(`${ESC}[H` + buffer.join('\n'));
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
