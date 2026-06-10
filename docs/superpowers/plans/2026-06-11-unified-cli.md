# Unified CLI Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a single global `free-ai-router` command that supports routing to either the API server (`start`) or the control panel (`dashboard`), as well as displaying a helper screen.

**Architecture:** A new entrypoint dispatcher `src/cli.ts` parses the subcommand verb. It programmatically imports and boots the respective module (`src/index.ts` or `src/dashboard.ts`), forwarding any additional flags (e.g. `--config`).

**Tech Stack:** TypeScript, Node.js.

---

### Task 1: Expose Programmatic Server Startup

**Files:**
- Modify: [src/index.ts](file:///C:/Users/Ahmed/Desktop/free%20models%20api/src/index.ts)

- [ ] **Step 1: Refactor `main()` to `startServer()`**
Modify `src/index.ts` to export a named async function `startServer` that takes an optional `configPath` override. If `configPath` is omitted, fall back to parsing arguments or env.
```typescript
export async function startServer(configPath?: string): Promise<void> {
  const resolvedConfigPath = configPath ?? getArg('--config') ?? process.env.FREE_AI_ROUTER_CONFIG ?? 'config.json';
  const config = await loadConfig(resolvedConfigPath);
  const providers = createProviders(config.providers ?? []);
  const registry = createModelRegistry(providers, config);
  await registry.refresh();
  const authManager = await AuthManager.create({ authDir: config.auth?.authDir ?? 'router-state/auth' });
  
  // Start background auth refresh loop
  const refreshIntervalMs = config.auth?.refreshIntervalMs ?? 60_000;
  authManager.refreshDue().catch((err) => {
    logger.error('Failed to run initial auth refresh check', err);
  });
  const refreshTimer = setInterval(() => {
    authManager.refreshDue().catch((err) => {
      logger.error('Failed to refresh credentials in background', err);
    });
  }, refreshIntervalMs);
  refreshTimer.unref();

  const server = createServer({ providers, registry, config, authManager });
  const host = config.server?.host ?? '127.0.0.1';
  const port = config.server?.port ?? 8080;
  server.listen(port, host, () => {
    logger.info(`Free AI API Router listening on http://${host}:${port}`);
  });
}
```

- [ ] **Step 2: Add direct run execution guard**
At the bottom of `src/index.ts`, run `startServer` if the file is executed directly (preserving backward compatibility):
```typescript
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  startServer().catch((err) => {
    logger.error('Server failed to start', err);
    process.exit(1);
  });
}
```

- [ ] **Step 3: Run typescript compilation to verify**
Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Commit**
```bash
git add src/index.ts
git commit -m "refactor: export startServer and add direct run guard to index.ts"
```

---

### Task 2: Expose Programmatic Dashboard Startup

**Files:**
- Modify: [src/dashboard.ts](file:///C:/Users/Ahmed/Desktop/free%20models%20api/src/dashboard.ts)

- [ ] **Step 1: Wrap startup in `startDashboard()`**
Find the direct execution block in `src/dashboard.ts` (around line 900) and extract it into an exported function:
```typescript
export function startDashboard(configPath?: string): void {
  const tui = new DashboardTui(configPath ?? 'config.json');
  tui.start();
}
```

- [ ] **Step 2: Add direct run execution guard**
Add execution guard at the bottom of `src/dashboard.ts`:
```typescript
if (process.argv[1]?.endsWith('dashboard.ts') || process.argv[1]?.endsWith('dashboard.js')) {
  const args = process.argv.slice(2);
  const configIdx = args.indexOf('--config');
  const configPath = configIdx !== -1 ? args[configIdx + 1] ?? 'config.json' : 'config.json';
  startDashboard(configPath);
}
```

- [ ] **Step 3: Run TypeScript compilation to verify**
Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Commit**
```bash
git add src/dashboard.ts
git commit -m "refactor: export startDashboard and add direct run guard to dashboard.ts"
```

---

### Task 3: Create CLI Dispatcher Entrypoint

**Files:**
- Create: `src/cli.ts`

- [ ] **Step 1: Write CLI Dispatcher Implementation**
Create `src/cli.ts` to route requests:
```typescript
#!/usr/bin/env node
import { startServer } from './index.js';
import { startDashboard } from './dashboard.js';

const ESC = '\x1b';
const RGB = (r: number, g: number, b: number) => `${ESC}[38;2;${r};${g};${b}m`;
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;

const COLORS = {
  blue: RGB(137, 180, 250),
  green: RGB(166, 227, 161),
  gray: RGB(127, 132, 156),
  text: RGB(205, 214, 244)
};

function showHelp(): void {
  console.log(`
${COLORS.blue}${BOLD}⚡ FREE AI API ROUTER CLI${RESET}

${BOLD}Usage:${RESET}
  ${COLORS.green}free-ai-router${RESET} <command> [options]

${BOLD}Commands:${RESET}
  ${COLORS.green}start${RESET}          Run the API Router server (Default command)
  ${COLORS.green}dashboard${RESET}      Open the TUI control panel dashboard
  ${COLORS.green}help${RESET}           Show this help information

${BOLD}Options:${RESET}
  ${COLORS.green}--config${RESET} <path>  Specify a custom configuration JSON file (Default: config.json)

${BOLD}Examples:${RESET}
  free-ai-router start --config custom.json
  free-ai-router dashboard
`);
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    showHelp();
    process.exit(0);
  }

  if (subcommand === 'dashboard') {
    // Strip subcommand and pass config path if specified
    const configIdx = args.indexOf('--config');
    const configPath = configIdx !== -1 ? args[configIdx + 1] : undefined;
    startDashboard(configPath);
    return;
  }

  // Treat 'start' or anything else (or empty) as API server startup
  let configPath: string | undefined;
  const configIdx = args.indexOf('--config');
  if (configIdx !== -1) {
    configPath = args[configIdx + 1];
  }

  startServer(configPath).catch((err) => {
    console.error('Server failed to start:', err);
    process.exit(1);
  });
}

runCli();
```

- [ ] **Step 2: Verify compilation**
Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**
```bash
git add src/cli.ts
git commit -m "feat: implement unified cli dispatcher entrypoint src/cli.ts"
```

---

### Task 4: Update package.json CLI Bin Configuration

**Files:**
- Modify: [package.json](file:///C:/Users/Ahmed/Desktop/free%20models%20api/package.json)

- [ ] **Step 1: Update bin field**
Change `"free-ai-router"` bin mapping to run `dist/cli.js`:
```diff
   "bin": {
-    "free-ai-router": "dist/index.js"
+    "free-ai-router": "dist/cli.js"
   },
```

- [ ] **Step 2: Update scripts**
Update `"start"` and `"dashboard"` scripts to use the new CLI dispatcher:
```diff
   "scripts": {
     "clean": "node -e \"fs.rmSync('dist',{recursive:true,force:true})\"",
     "build": "npm run clean && tsc -p tsconfig.build.json",
     "dev": "tsx src/index.ts --config config.example.json",
-    "dashboard": "tsx src/dashboard.ts --config config.json",
-    "start": "node dist/index.js --config config.json",
+    "dashboard": "tsx src/cli.ts dashboard --config config.json",
+    "start": "node dist/cli.js start --config config.json",
```

- [ ] **Step 3: Commit changes**
```bash
git add package.json
git commit -m "config: update bin and script commands to use unified cli dispatcher"
```

---

### Task 5: Write CLI Unit Tests

**Files:**
- Create: `tests/cli.test.ts`

- [ ] **Step 1: Write test cases routing check**
Create `tests/cli.test.ts` using Vitest to mock arguments and spy on mock boot runners:
```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Stub out original execution in modules by mocking them
vi.mock('../src/index.js', () => ({
  startServer: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../src/dashboard.js', () => ({
  startDashboard: vi.fn()
}));

import { startServer } from '../src/index.js';
import { startDashboard } from '../src/dashboard.js';

describe('cli arguments routing dispatcher', () => {
  const originalArgv = process.argv;
  const originalExit = process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    exitCode = undefined;
    (process as any).exit = (code?: number) => {
      exitCode = code;
    };
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
  });

  it('routes to dashboard command', async () => {
    process.argv = ['node', 'cli.js', 'dashboard', '--config', 'custom.json'];
    // Re-import cli to run script body
    await import(`../src/cli.ts?t=${Date.now()}`);
    expect(startDashboard).toHaveBeenCalledWith('custom.json');
  });

  it('routes to start server command', async () => {
    process.argv = ['node', 'cli.js', 'start', '--config', 'server-config.json'];
    await import(`../src/cli.ts?t=${Date.now()}`);
    expect(startServer).toHaveBeenCalledWith('server-config.json');
  });

  it('routes to start server by default if no subcommand is passed', async () => {
    process.argv = ['node', 'cli.js', '--config', 'default-config.json'];
    await import(`../src/cli.ts?t=${Date.now()}`);
    expect(startServer).toHaveBeenCalledWith('default-config.json');
  });

  it('routes to help output and exits', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.argv = ['node', 'cli.js', 'help'];
    await import(`../src/cli.ts?t=${Date.now()}`);
    expect(exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test suite**
Run: `npx vitest run tests/cli.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**
```bash
git add tests/cli.test.ts
git commit -m "test: add cli dispatcher routing unit tests"
```

---

### Task 6: Final CI Verification

- [ ] **Step 1: Run complete CI checks**
Run:
```powershell
npm run build
npm run typecheck
npm test
npm run smoke
npm audit --audit-level=moderate
```
Expected: All tests pass successfully and 0 vulnerabilities are found.

- [ ] **Step 2: Commit plan checklist completion**
Commit any documentation or final plan state.
