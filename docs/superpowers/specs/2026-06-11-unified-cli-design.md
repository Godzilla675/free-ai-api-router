# Unified CLI Entrypoint Design Spec

**Goal:** Create a single, unified command-line dispatcher `free-ai-router` supporting subcommands to run either the API router server or the control panel TUI dashboard, while maintaining backward compatibility for existing commands.

## Architecture & Command Routing

We will create a new entrypoint file `src/cli.ts` (compiling to `dist/cli.js`). 

### Command Mapping
*   `free-ai-router dashboard`: Starts the TUI control panel.
*   `free-ai-router start`: Starts the API Router server.
*   `free-ai-router`: Starts the API Router server by default (backward compatible).
*   `free-ai-router help` / `--help` / `-h`: Displays a colorized help manual.

### Flag Forwarding
Any additional flags (such as `--config <path>`) will be stripped of the subcommand verb and forwarded directly to the respective boot functions.

## Proposed Changes

### Refactoring [src/index.ts](file:///C:/Users/Ahmed/Desktop/free%20models%20api/src/index.ts)
Rename `main()` to `export async function startServer(configPath?: string): Promise<void>`.
Add execution guard for direct node calls:
```typescript
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

### Refactoring [src/dashboard.ts](file:///C:/Users/Ahmed/Desktop/free%20models%20api/src/dashboard.ts)
Export a programmatic startup function `export function startDashboard(configPath?: string): void`.
Add execution guard for direct node calls.

### New CLI File `src/cli.ts`
Implement argument parsing and routing.
```typescript
#!/usr/bin/env node
import { startServer } from './index.js';
import { startDashboard } from './dashboard.js';

// dispatcher logic ...
```

### Package.json Configuration
Set the bin command to the new dispatcher:
```json
  "bin": {
    "free-ai-router": "dist/cli.js"
  }
```

## Testing & Verification
*   Create `tests/cli.test.ts` to test command routing using mock arguments and spies/mocks.
