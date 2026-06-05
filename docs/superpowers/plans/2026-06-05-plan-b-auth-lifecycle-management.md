# Plan B Auth Lifecycle and Management API Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add file-backed auth records, credential lifecycle state, refresh scheduling hooks, and management API endpoints that later provider plans can use.

**Architecture:** Plan B introduces an auth domain that is intentionally provider-agnostic. It stores explicit auth records under a configured `authDir`, exposes safe CRUD/status APIs under `/admin/auth`, and provides a small `AuthManager` interface for later Codex/Gemini/AI Studio provider integrations. No provider-specific OAuth flow is implemented in Plan B; use fake provider handlers in tests.

**Tech Stack:** TypeScript ESM, Node.js built-in `fs/promises`, `crypto`, existing `http` server, Vitest.

---

## Chunk 1: Auth Core, Store, and Management API

### File structure

Create:
- `src/auth/types.ts` — auth record types, statuses, error shape, redaction helpers.
- `src/auth/store.ts` — JSON file persistence for auth records.
- `src/auth/manager.ts` — in-memory manager backed by `AuthStore`.
- `tests/auth-manager.test.ts` — unit tests for store and manager.

Modify:
- `src/types.ts` — add `auth?: AuthConfig` to `RouterConfig`.
- `src/config.ts` — normalize and validate `auth.authDir`, defaulting to `router-state/auth`.
- `src/server.ts` — add `/admin/auth` management routes.
- `src/index.ts` — create `AuthManager` and pass it into `createServer`.
- `tests/server.test.ts` — management endpoint tests.
- `README.md`, `.env.example`, `config.example.json` — document Plan B config.

### Task 1: Add auth config shape

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Test: `tests/security-hardening.test.ts`

- [ ] **Step 1: Write the failing config normalization test**

Add to `tests/security-hardening.test.ts`:

```ts
import { normalizeConfig } from '../src/config.js';

it('defaults authDir to router-state/auth', () => {
  const config = normalizeConfig({
    server: { authTokens: ['token'], adminToken: 'admin' },
    providers: []
  });

  expect(config.auth?.authDir).toBe('router-state/auth');
});

it('rejects empty authDir when auth config is present', () => {
  expect(() => normalizeConfig({
    server: { authTokens: ['token'], adminToken: 'admin' },
    auth: { authDir: '   ' },
    providers: []
  })).toThrow('auth.authDir must be a non-empty string');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/security-hardening.test.ts
```

Expected: FAIL because `RouterConfig.auth` does not exist/default yet.

- [ ] **Step 3: Add types**

In `src/types.ts`, add:

```ts
export interface AuthConfig {
  authDir?: string;
  refreshIntervalMs?: number;
  refreshJitterMs?: number;
}
```

Then add to `RouterConfig`:

```ts
auth?: AuthConfig;
```

- [ ] **Step 4: Add normalization and validation**

In `src/config.ts`, include in normalized config:

```ts
auth: {
  authDir: 'router-state/auth',
  refreshIntervalMs: 60_000,
  refreshJitterMs: 5_000,
  ...(config.auth ?? {})
},
```

In `validateConfig`, add:

```ts
if (config.auth?.authDir !== undefined && config.auth.authDir.trim().length === 0) {
  throw new RouterError('auth.authDir must be a non-empty string', {
    status: 400,
    code: 'invalid_config',
    retryable: false
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```powershell
npm test -- tests/security-hardening.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src\types.ts src\config.ts tests\security-hardening.test.ts
git commit -m "Add auth config defaults"
```

### Task 2: Create auth record types

**Files:**
- Create: `src/auth/types.ts`
- Test: `tests/auth-manager.test.ts`

- [ ] **Step 1: Write the failing type/redaction test**

Create `tests/auth-manager.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { redactAuthRecord } from '../src/auth/types.js';

describe('auth records', () => {
  it('redacts secret material from auth records', () => {
    const redacted = redactAuthRecord({
      id: 'auth-1',
      provider: 'codex',
      label: 'main',
      status: 'available',
      disabled: false,
      createdAt: '2026-06-05T00:00:00.000Z',
      updatedAt: '2026-06-05T00:00:00.000Z',
      attributes: { account: 'user@example.com' },
      secrets: { accessToken: 'secret-access', refreshToken: 'secret-refresh' },
      metadata: { plan: 'plus' }
    });

    expect(redacted.secrets).toEqual({ accessToken: '[REDACTED]', refreshToken: '[REDACTED]' });
    expect(redacted.attributes).toEqual({ account: 'user@example.com' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/auth-manager.test.ts
```

Expected: FAIL because `src/auth/types.ts` does not exist.

- [ ] **Step 3: Implement auth types**

Create `src/auth/types.ts`:

```ts
export type AuthStatus = 'available' | 'cooldown' | 'disabled' | 'expired' | 'error';

export interface AuthQuotaState {
  exceeded?: boolean;
  reason?: string;
  nextRecoverAt?: string;
  backoffLevel?: number;
}

export interface AuthModelState {
  status: AuthStatus;
  unavailable?: boolean;
  nextRetryAfter?: string;
  lastError?: AuthErrorInfo;
  quota?: AuthQuotaState;
  updatedAt: string;
}

export interface AuthErrorInfo {
  code: string;
  message: string;
  retryable: boolean;
  status?: number;
  updatedAt: string;
}

export interface AuthRecord {
  id: string;
  provider: string;
  label?: string;
  prefix?: string;
  status: AuthStatus;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRefreshedAt?: string;
  nextRefreshAfter?: string;
  nextRetryAfter?: string;
  attributes?: Record<string, string>;
  metadata?: Record<string, unknown>;
  secrets?: Record<string, string>;
  quota?: AuthQuotaState;
  modelStates?: Record<string, AuthModelState>;
}

export type RedactedAuthRecord = Omit<AuthRecord, 'secrets'> & {
  secrets?: Record<string, '[REDACTED]'>;
};

export function redactAuthRecord(record: AuthRecord): RedactedAuthRecord {
  const secrets = record.secrets
    ? Object.fromEntries(Object.keys(record.secrets).map((key) => [key, '[REDACTED]' as const]))
    : undefined;

  return {
    ...record,
    ...(secrets ? { secrets } : {})
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm test -- tests/auth-manager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\auth\types.ts tests\auth-manager.test.ts
git commit -m "Add auth record types"
```

### Task 3: Implement JSON auth store

**Files:**
- Create: `src/auth/store.ts`
- Modify: `tests/auth-manager.test.ts`

- [ ] **Step 1: Write failing store tests**

Append to `tests/auth-manager.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore } from '../src/auth/store.js';

describe('AuthStore', () => {
  it('persists and reloads auth records as individual JSON files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'free-ai-router-auth-'));
    try {
      const store = new AuthStore(dir);
      await store.save({
        id: 'auth-1',
        provider: 'codex',
        status: 'available',
        disabled: false,
        createdAt: '2026-06-05T00:00:00.000Z',
        updatedAt: '2026-06-05T00:00:00.000Z',
        secrets: { accessToken: 'secret' }
      });

      const reloaded = await new AuthStore(dir).loadAll();
      expect(reloaded).toHaveLength(1);
      expect(reloaded[0]?.id).toBe('auth-1');
      expect(reloaded[0]?.secrets?.accessToken).toBe('secret');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/auth-manager.test.ts
```

Expected: FAIL because `AuthStore` does not exist.

- [ ] **Step 3: Implement AuthStore**

Create `src/auth/store.ts`:

```ts
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuthRecord } from './types.js';

export class AuthStore {
  constructor(private readonly authDir: string) {}

  async loadAll(): Promise<AuthRecord[]> {
    await mkdir(this.authDir, { recursive: true });
    const files = await readdir(this.authDir);
    const records: AuthRecord[] = [];
    for (const file of files.filter((name) => name.endsWith('.json')).sort()) {
      const raw = await readFile(join(this.authDir, file), 'utf8');
      records.push(JSON.parse(raw) as AuthRecord);
    }
    return records;
  }

  async save(record: AuthRecord): Promise<void> {
    await mkdir(this.authDir, { recursive: true });
    await writeFile(this.pathFor(record.id), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  }

  async delete(id: string): Promise<void> {
    await rm(this.pathFor(id), { force: true });
  }

  private pathFor(id: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) {
      throw new Error(`Invalid auth id: ${id}`);
    }
    return join(this.authDir, `${id}.json`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm test -- tests/auth-manager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\auth\store.ts tests\auth-manager.test.ts
git commit -m "Add file-backed auth store"
```

### Task 4: Implement AuthManager

**Files:**
- Create: `src/auth/manager.ts`
- Modify: `tests/auth-manager.test.ts`

- [ ] **Step 1: Write failing manager tests**

Append:

```ts
import { AuthManager } from '../src/auth/manager.js';

describe('AuthManager', () => {
  it('lists redacted auth records and persists status changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'free-ai-router-auth-'));
    try {
      const manager = await AuthManager.create({ authDir: dir });
      await manager.upsert({
        id: 'codex-main',
        provider: 'codex',
        status: 'available',
        disabled: false,
        createdAt: '2026-06-05T00:00:00.000Z',
        updatedAt: '2026-06-05T00:00:00.000Z',
        secrets: { accessToken: 'secret' }
      });

      await manager.setDisabled('codex-main', true);

      const records = manager.listRedacted();
      expect(records[0]?.disabled).toBe(true);
      expect(records[0]?.secrets?.accessToken).toBe('[REDACTED]');

      const reloaded = await AuthManager.create({ authDir: dir });
      expect(reloaded.listRedacted()[0]?.disabled).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/auth-manager.test.ts
```

Expected: FAIL because `AuthManager` does not exist.

- [ ] **Step 3: Implement AuthManager**

Create `src/auth/manager.ts`:

```ts
import { AuthStore } from './store.js';
import type { AuthRecord, RedactedAuthRecord } from './types.js';
import { redactAuthRecord } from './types.js';

export interface AuthManagerConfig {
  authDir: string;
}

export class AuthManager {
  private readonly records = new Map<string, AuthRecord>();

  private constructor(private readonly store: AuthStore) {}

  static async create(config: AuthManagerConfig): Promise<AuthManager> {
    const manager = new AuthManager(new AuthStore(config.authDir));
    for (const record of await manager.store.loadAll()) {
      manager.records.set(record.id, record);
    }
    return manager;
  }

  listRedacted(): RedactedAuthRecord[] {
    return [...this.records.values()].sort((a, b) => a.id.localeCompare(b.id)).map(redactAuthRecord);
  }

  get(id: string): AuthRecord | undefined {
    return this.records.get(id);
  }

  async upsert(record: AuthRecord): Promise<void> {
    const next = { ...record, updatedAt: new Date().toISOString() };
    this.records.set(next.id, next);
    await this.store.save(next);
  }

  async setDisabled(id: string, disabled: boolean): Promise<AuthRecord> {
    const current = this.records.get(id);
    if (!current) {
      throw new Error(`Auth record not found: ${id}`);
    }
    const next: AuthRecord = {
      ...current,
      disabled,
      status: disabled ? 'disabled' : 'available',
      updatedAt: new Date().toISOString()
    };
    this.records.set(id, next);
    await this.store.save(next);
    return next;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
    await this.store.delete(id);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm test -- tests/auth-manager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\auth\manager.ts tests\auth-manager.test.ts
git commit -m "Add auth manager"
```

### Task 5: Wire AuthManager into server options

**Files:**
- Modify: `src/server.ts`
- Modify: `src/index.ts`
- Test: `tests/server.test.ts`

- [ ] **Step 1: Write failing server route test**

Add to `tests/server.test.ts`:

```ts
import { AuthManager } from '../src/auth/manager.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('lists redacted auth records through admin API', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'free-ai-router-auth-'));
  try {
    const authManager = await AuthManager.create({ authDir: dir });
    await authManager.upsert({
      id: 'auth-1',
      provider: 'codex',
      status: 'available',
      disabled: false,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      secrets: { accessToken: 'secret' }
    });

    const { server, baseUrl } = await startTestServer({ authManager });
    try {
      const response = await fetch(`${baseUrl}/admin/auth`, {
        headers: { authorization: 'Bearer admin-token' }
      });
      const body = await response.json() as { data: Array<{ id: string; secrets?: Record<string, string> }> };

      expect(response.status).toBe(200);
      expect(body.data[0]?.id).toBe('auth-1');
      expect(body.data[0]?.secrets?.accessToken).toBe('[REDACTED]');
    } finally {
      await closeServer(server);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

If existing helpers differ, adapt only helper calls, not the expected route behavior.

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/server.test.ts
```

Expected: FAIL because `ServerOptions.authManager` and `/admin/auth` do not exist.

- [ ] **Step 3: Extend server options and route**

In `src/server.ts`:

```ts
import type { AuthManager } from './auth/manager.js';
```

Add to `ServerOptions`:

```ts
authManager?: AuthManager;
```

Inside `/admin/` handling, before `/admin/providers`:

```ts
if (request.method === 'GET' && url.pathname === '/admin/auth') {
  return sendJson(response, 200, { data: options.authManager?.listRedacted() ?? [] });
}
```

- [ ] **Step 4: Wire index**

In `src/index.ts`:

```ts
import { AuthManager } from './auth/manager.js';
```

After loading config:

```ts
const authManager = await AuthManager.create({ authDir: config.auth?.authDir ?? 'router-state/auth' });
```

Pass it:

```ts
const server = createServer({ providers, registry, config, authManager });
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```powershell
npm test -- tests/server.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src\server.ts src\index.ts tests\server.test.ts
git commit -m "Add auth management listing endpoint"
```

### Task 6: Add admin auth mutation endpoints

**Files:**
- Modify: `src/server.ts`
- Modify: `tests/server.test.ts`

- [ ] **Step 1: Write failing disable/delete tests**

Add:

```ts
it('disables and deletes auth records through admin API', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'free-ai-router-auth-'));
  try {
    const authManager = await AuthManager.create({ authDir: dir });
    await authManager.upsert({
      id: 'auth-1',
      provider: 'codex',
      status: 'available',
      disabled: false,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    });

    const { server, baseUrl } = await startTestServer({ authManager });
    try {
      const patch = await fetch(`${baseUrl}/admin/auth/auth-1`, {
        method: 'PATCH',
        headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' },
        body: JSON.stringify({ disabled: true })
      });
      expect(patch.status).toBe(200);

      const del = await fetch(`${baseUrl}/admin/auth/auth-1`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer admin-token' }
      });
      expect(del.status).toBe(204);
    } finally {
      await closeServer(server);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/server.test.ts
```

Expected: FAIL because mutation routes do not exist.

- [ ] **Step 3: Implement routes**

In `/admin/` block:

```ts
const authMatch = /^\/admin\/auth\/([^/]+)$/.exec(url.pathname);
if (authMatch && request.method === 'PATCH') {
  if (!options.authManager) return sendJson(response, 404, toOpenAIError(new Error('Not found'), 404).body);
  const body = await readJson<{ disabled?: unknown }>(request, maxBodyBytes);
  if (typeof body.disabled !== 'boolean') {
    throw new RouterError('disabled must be boolean', { status: 400, code: 'invalid_request', retryable: false });
  }
  const updated = await options.authManager.setDisabled(decodeURIComponent(authMatch[1]!), body.disabled);
  return sendJson(response, 200, { data: redactAuthRecord(updated) });
}

if (authMatch && request.method === 'DELETE') {
  if (!options.authManager) return sendJson(response, 404, toOpenAIError(new Error('Not found'), 404).body);
  await options.authManager.delete(decodeURIComponent(authMatch[1]!));
  response.statusCode = 204;
  response.end();
  return;
}
```

Also import `redactAuthRecord`.

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- tests/server.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\server.ts tests\server.test.ts
git commit -m "Add auth management mutation endpoints"
```

### Task 7: Add docs and example config

**Files:**
- Modify: `README.md`
- Modify: `config.example.json`
- Modify: `.env.example`

- [ ] **Step 1: Update `config.example.json`**

Add top-level:

```json
"auth": {
  "authDir": "router-state/auth",
  "refreshIntervalMs": 60000,
  "refreshJitterMs": 5000
}
```

- [ ] **Step 2: Update README**

Add under Admin Endpoints:

```md
- `GET /admin/auth`: lists redacted auth records.
- `PATCH /admin/auth/:id`: toggles `disabled`.
- `DELETE /admin/auth/:id`: removes an auth record.
```

Add an Auth State section:

```md
## Auth State

Plan B introduces file-backed auth records under `auth.authDir` (default `router-state/auth`). Auth JSON files may contain provider tokens or API keys and must never be committed. Admin APIs always redact `secrets`.
```

- [ ] **Step 3: Run config/docs-adjacent tests**

Run:

```powershell
npm test -- tests/config-example.test.ts tests/security-hardening.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add README.md config.example.json .env.example tests\config-example.test.ts
git commit -m "Document auth lifecycle configuration"
```

### Task 8: Final verification for Plan B

- [ ] **Step 1: Run full checks**

Run:

```powershell
npm run build
npm run typecheck
npm test
npm run smoke
npm audit --audit-level=moderate
```

Expected: all commands exit 0.

- [ ] **Step 2: Commit any fixes**

If verification required fixes:

```powershell
git status --short
# If fixes were made, stage only the files changed by those fixes.
git add src tests README.md config.example.json .env.example
git commit -m "Stabilize auth lifecycle management"
```

- [ ] **Step 3: Request code review**

Use the code review agent or skill required by the environment before starting Plan C.
