# Plan D Remaining Channels, Translators, and Operational Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining CLIProxyAPI parity surface by adding remaining channel adapters, translator framework, stream/websocket hardening hooks, and operational docs/checks.

**Architecture:** Plan D adds a protocol translation layer and keeps provider execution isolated behind adapter classes. Channel-specific behavior lives under `src/translators/<source>/<target>.ts` and `src/providers/<channel>.ts`, while server routes remain OpenAI-compatible. Operational hardening adds metrics-like admin views and tighter redaction/security regression tests.

**Tech Stack:** TypeScript ESM, Node.js built-ins, Vitest, existing HTTP server. No runtime dependencies unless approved.

---

## Chunk 1: Translator Framework and Remaining Channel Skeletons

### File structure

Create:
- `src/translators/types.ts` — common protocol format and translation interfaces.
- `src/translators/openai-to-claude.ts`
- `src/translators/claude-to-openai.ts`
- `src/translators/openai-to-gemini.ts`
- `src/translators/gemini-to-openai.ts`
- `src/providers/claude.ts`
- `src/providers/xai.ts`
- `src/providers/kimi.ts`
- `tests/translators.test.ts`
- `tests/channel-provider-factory.test.ts`

Modify:
- `src/types.ts`
- `src/providers/factory.ts`
- `README.md`
- `config.example.json`

### Task 1: Add translator interface

**Files:**
- Create: `src/translators/types.ts`
- Test: `tests/translators.test.ts`

- [ ] **Step 1: Write failing interface smoke test**

Create `tests/translators.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeProtocolFormat } from '../src/translators/types.js';

describe('translator framework', () => {
  it('normalizes known protocol format names', () => {
    expect(normalizeProtocolFormat('OpenAI')).toBe('openai');
    expect(normalizeProtocolFormat('claude')).toBe('claude');
    expect(normalizeProtocolFormat('gemini')).toBe('gemini');
  });

  it('rejects unknown protocol format names', () => {
    expect(() => normalizeProtocolFormat('wat')).toThrow('Unknown protocol format');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/translators.test.ts
```

Expected: FAIL because translator types file does not exist.

- [ ] **Step 3: Implement translator types**

Create `src/translators/types.ts`:

```ts
export type ProtocolFormat = 'openai' | 'claude' | 'gemini' | 'codex';

export interface TranslationContext {
  model: string;
  stream: boolean;
}

export interface Translator {
  readonly from: ProtocolFormat;
  readonly to: ProtocolFormat;
  translateRequest(input: unknown, context: TranslationContext): unknown;
  translateResponse(input: unknown, context: TranslationContext): unknown;
}

export function normalizeProtocolFormat(value: string): ProtocolFormat {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'claude' || normalized === 'gemini' || normalized === 'codex') {
    return normalized;
  }
  throw new Error(`Unknown protocol format: ${value}`);
}
```

- [ ] **Step 4: Run test**

Run:

```powershell
npm test -- tests/translators.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\translators\types.ts tests\translators.test.ts
git commit -m "Add translator framework types"
```

### Task 2: Add OpenAI ↔ Claude translators

**Files:**
- Create: `src/translators/openai-to-claude.ts`
- Create: `src/translators/claude-to-openai.ts`
- Modify: `tests/translators.test.ts`

- [ ] **Step 1: Write failing translator tests**

Append:

```ts
import { openAIToClaudeRequest } from '../src/translators/openai-to-claude.js';
import { claudeToOpenAIResponse } from '../src/translators/claude-to-openai.js';

it('translates OpenAI chat request to Claude messages request', () => {
  const result = openAIToClaudeRequest({
    model: 'claude-sonnet',
    messages: [
      { role: 'system', content: 'be concise' },
      { role: 'user', content: 'hello' }
    ],
    max_tokens: 100
  });

  expect(result).toEqual({
    model: 'claude-sonnet',
    system: 'be concise',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 100
  });
});

it('translates Claude text response to OpenAI chat response', () => {
  const result = claudeToOpenAIResponse({
    id: 'msg_1',
    model: 'claude-sonnet',
    content: [{ type: 'text', text: 'hi' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 2 }
  });

  expect(result.id).toBe('chatcmpl_msg_1');
  expect(result.choices[0]?.message.content).toBe('hi');
  expect(result.usage?.prompt_tokens).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
npm test -- tests/translators.test.ts
```

Expected: FAIL because files do not exist.

- [ ] **Step 3: Implement translators**

Create `src/translators/openai-to-claude.ts`:

```ts
import type { ChatRequest } from '../types.js';

export function openAIToClaudeRequest(request: ChatRequest): Record<string, unknown> {
  const system = request.messages.filter((m) => m.role === 'system').map((m) => text(m.content)).join('\n');
  const messages = request.messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: text(m.content)
  }));
  return {
    model: request.model,
    ...(system ? { system } : {}),
    messages,
    max_tokens: request.max_tokens ?? 4096,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {})
  };
}

function text(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => typeof part === 'object' && part !== null && 'text' in part ? String((part as { text: unknown }).text) : '').join('\n');
  return content === undefined ? '' : String(content);
}
```

Create `src/translators/claude-to-openai.ts`:

```ts
import type { OpenAIChatResponse } from '../types.js';

export function claudeToOpenAIResponse(response: {
  id: string;
  model: string;
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}): OpenAIChatResponse {
  const content = (response.content ?? []).filter((part) => part.type === 'text' || part.text).map((part) => part.text ?? '').join('');
  return {
    id: response.id.startsWith('msg_') ? `chatcmpl_${response.id}` : response.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: response.stop_reason ?? 'stop' }],
    usage: {
      prompt_tokens: response.usage?.input_tokens,
      completion_tokens: response.usage?.output_tokens,
      total_tokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)
    }
  };
}
```

- [ ] **Step 4: Run tests**

```powershell
npm test -- tests/translators.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\translators\openai-to-claude.ts src\translators\claude-to-openai.ts tests\translators.test.ts
git commit -m "Add OpenAI Claude translators"
```

### Task 2.5: Add OpenAI ↔ Gemini translators

**Files:**
- Create: `src/translators/openai-to-gemini.ts`
- Create: `src/translators/gemini-to-openai.ts`
- Modify: `tests/translators.test.ts`

- [ ] **Step 1: Write failing Gemini translator tests**

Append:

```ts
import { openAIToGeminiRequest } from '../src/translators/openai-to-gemini.js';
import { geminiToOpenAIResponse } from '../src/translators/gemini-to-openai.js';

it('translates OpenAI chat request to Gemini generateContent request', () => {
  const result = openAIToGeminiRequest({
    model: 'gemini-3-pro',
    messages: [
      { role: 'system', content: 'be concise' },
      { role: 'user', content: 'hello' }
    ],
    max_tokens: 100
  });

  expect(result).toEqual({
    contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    systemInstruction: { parts: [{ text: 'be concise' }] },
    generationConfig: { maxOutputTokens: 100 }
  });
});

it('translates Gemini text response to OpenAI chat response', () => {
  const result = geminiToOpenAIResponse({
    candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 }
  }, 'gemini-3-pro');

  expect(result.model).toBe('gemini-3-pro');
  expect(result.choices[0]?.message.content).toBe('hi');
  expect(result.usage?.total_tokens).toBe(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
npm test -- tests/translators.test.ts
```

Expected: FAIL because Gemini translator files do not exist.

- [ ] **Step 3: Implement OpenAI to Gemini translator**

Create `src/translators/openai-to-gemini.ts`:

```ts
import type { ChatMessage, ChatRequest } from '../types.js';

export function openAIToGeminiRequest(request: ChatRequest): Record<string, unknown> {
  const systemMessages = request.messages.filter((message) => message.role === 'system');
  const conversationMessages = request.messages.filter((message) => message.role !== 'system');
  return {
    contents: conversationMessages.map(toGeminiContent),
    ...(systemMessages.length > 0 ? { systemInstruction: { parts: systemMessages.map((message) => ({ text: text(message.content) })) } } : {}),
    generationConfig: {
      ...(request.max_tokens !== undefined ? { maxOutputTokens: request.max_tokens } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.top_p !== undefined ? { topP: request.top_p } : {})
    }
  };
}

function toGeminiContent(message: ChatMessage): Record<string, unknown> {
  return {
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: text(message.content) }]
  };
}

function text(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === 'object' && part !== null && 'text' in part ? String((part as { text: unknown }).text) : '').join('\n');
  }
  return content === undefined ? '' : String(content);
}
```

- [ ] **Step 4: Implement Gemini to OpenAI translator**

Create `src/translators/gemini-to-openai.ts`:

```ts
import type { OpenAIChatResponse } from '../types.js';

export function geminiToOpenAIResponse(response: {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}, model: string): OpenAIChatResponse {
  const candidate = response.candidates?.[0];
  const content = candidate?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  return {
    id: `chatcmpl_gemini_${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: candidate?.finishReason?.toLowerCase() ?? 'stop' }],
    usage: {
      prompt_tokens: response.usageMetadata?.promptTokenCount,
      completion_tokens: response.usageMetadata?.candidatesTokenCount,
      total_tokens: response.usageMetadata?.totalTokenCount
    }
  };
}
```

- [ ] **Step 5: Run tests**

```powershell
npm test -- tests/translators.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src\translators\openai-to-gemini.ts src\translators\gemini-to-openai.ts tests\translators.test.ts
git commit -m "Add OpenAI Gemini translators"
```

### Task 3: Add channel provider skeletons

**Files:**
- Create: `src/providers/claude.ts`
- Create: `src/providers/xai.ts`
- Create: `src/providers/kimi.ts`
- Modify: `src/types.ts`
- Modify: `src/providers/factory.ts`
- Test: `tests/channel-provider-factory.test.ts`

- [ ] **Step 1: Write failing factory tests**

Create `tests/channel-provider-factory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createProvider } from '../src/providers/factory.js';

describe('channel provider factory', () => {
  it.each(['claude', 'xai', 'kimi'] as const)('creates %s provider skeleton', (type) => {
    const provider = createProvider({
      id: type,
      type,
      baseUrl: 'https://example.com',
      apiKey: 'test'
    });

    expect(provider.type).toBe(type);
  });

  it.each(['claude', 'xai', 'kimi'] as const)('%s provider returns explicit 501 execution error', async (type) => {
    const provider = createProvider({
      id: type,
      type,
      baseUrl: 'https://example.com',
      apiKey: 'test'
    });

    await expect(provider.chat({ model: 'test-model', messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toMatchObject({ status: 501, code: 'not_implemented' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
npm test -- tests/channel-provider-factory.test.ts
```

Expected: FAIL because provider types are not supported.

- [ ] **Step 3: Update provider type union**

In `src/types.ts`:

```ts
export type ProviderType = 'openai-compatible' | 'openai-responses' | 'codex' | 'gemini' | 'aistudio' | 'claude' | 'xai' | 'kimi' | 'fake';
```

- [ ] **Step 4: Implement skeleton providers**

Create `src/providers/claude.ts`, `xai.ts`, and `kimi.ts` with this pattern, changing class/type names:

```ts
import { RouterError } from '../errors.js';
import type { ChatRequest, ModelInfo, ProviderAdapter, ProviderChatResult, ProviderConfig } from '../types.js';

export class ClaudeProvider implements ProviderAdapter {
  readonly id: string;
  readonly type = 'claude';
  readonly priority: number;
  readonly weight: number;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.priority = config.priority ?? 100;
    this.weight = config.weight ?? 1;
  }

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async chat(_request: ChatRequest): Promise<ProviderChatResult> {
    throw new RouterError('Claude provider execution is not implemented yet', { status: 501, code: 'not_implemented', retryable: false });
  }
}
```

Use `XAIProvider` with `type = 'xai'`, and `KimiProvider` with `type = 'kimi'`.

- [ ] **Step 5: Wire factory**

In `src/providers/factory.ts`, import and add branches for all three.

- [ ] **Step 6: Run tests**

```powershell
npm test -- tests/channel-provider-factory.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src\types.ts src\providers\factory.ts src\providers\claude.ts src\providers\xai.ts src\providers\kimi.ts tests\channel-provider-factory.test.ts
git commit -m "Add remaining channel provider skeletons"
```

## Chunk 2: Streaming, WebSocket Guardrails, and Operations

### Task 4: Add stream error normalization helper

**Files:**
- Create: `src/streaming/errors.ts`
- Test: `tests/streaming.test.ts`

- [ ] **Step 1: Write failing streaming error test**

Create `tests/streaming.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toSseErrorEvent } from '../src/streaming/errors.js';

describe('streaming error helpers', () => {
  it('normalizes errors to SSE error event bytes', () => {
    const event = toSseErrorEvent(new Error('boom'));
    expect(event).toContain('event: error');
    expect(event).toContain('"message":"boom"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
npm test -- tests/streaming.test.ts
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement helper**

Create `src/streaming/errors.ts`:

```ts
export function toSseErrorEvent(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `event: error\ndata: ${JSON.stringify({ error: { message, type: 'server_error', code: 'stream_error' } })}\n\n`;
}
```

- [ ] **Step 4: Run tests**

```powershell
npm test -- tests/streaming.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\streaming\errors.ts tests\streaming.test.ts
git commit -m "Add streaming error normalization"
```

### Task 5: Add websocket route guard with explicit disabled default

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/server.ts`
- Test: `tests/server.test.ts`

- [ ] **Step 1: Write failing websocket enabled-placeholder test**

Add to `tests/server.test.ts`:

```ts
it('returns 501 for websocket endpoint when websocket support is enabled without executor', async () => {
  const { server, baseUrl } = await startTestServer({
    configOverride: { server: { websocketEnabled: true } }
  });
  try {
    const response = await fetch(`${baseUrl}/v1/ws`, {
      headers: { authorization: 'Bearer dev-token' }
    });
    expect(response.status).toBe(501);
  } finally {
    await closeServer(server);
  }
});
```

- [ ] **Step 2: Run test**

```powershell
npm test -- tests/server.test.ts
```

Expected: FAIL because `/v1/ws` currently returns 404 even when websocket support is enabled.

- [ ] **Step 3: Add config**

In `src/types.ts` `ServerConfig`:

```ts
websocketEnabled?: boolean;
```

In `normalizeConfig` server defaults:

```ts
websocketEnabled: false,
```

- [ ] **Step 4: Add route**

In `src/server.ts`, inside `/v1/` block:

```ts
if (url.pathname === '/v1/ws') {
  if (!options.config.server?.websocketEnabled) {
    return sendJson(response, 404, toOpenAIError(new Error('Not found'), 404).body);
  }
  return sendJson(response, 501, toOpenAIError(new RouterError('WebSocket execution is not implemented yet', { status: 501, code: 'not_implemented', retryable: false })).body);
}
```

- [ ] **Step 5: Run tests**

```powershell
npm test -- tests/server.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src\types.ts src\config.ts src\server.ts tests\server.test.ts
git commit -m "Add disabled websocket route guard"
```

### Task 6: Add admin operations snapshot

**Files:**
- Modify: `src/server.ts`
- Modify: `src/router.ts`
- Test: `tests/server.test.ts`

- [ ] **Step 1: Write failing admin operations test**

Add:

```ts
it('returns operations snapshot from admin API', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/admin/operations`, {
      headers: { authorization: 'Bearer admin-token' }
    });
    const body = await response.json() as { routing: unknown; health: unknown; usage: unknown };

    expect(response.status).toBe(200);
    expect(body.routing).toBeDefined();
    expect(body.health).toBeDefined();
    expect(body.usage).toBeDefined();
  } finally {
    await closeServer(server);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
npm test -- tests/server.test.ts
```

Expected: FAIL because route does not exist.

- [ ] **Step 3: Implement route**

In `src/server.ts` admin block:

```ts
if (request.method === 'GET' && url.pathname === '/admin/operations') {
  return sendJson(response, 200, {
    routing: options.config.routing ?? {},
    health: router.healthSnapshot(),
    usage: await router.recentUsage(20)
  });
}
```

- [ ] **Step 4: Run tests**

```powershell
npm test -- tests/server.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\server.ts tests\server.test.ts
git commit -m "Add operations admin snapshot"
```

### Task 7: Add redaction regression tests

**Files:**
- Modify: `tests/security-hardening.test.ts`
- Modify: `src/errors.ts`

- [ ] **Step 1: Write failing redaction test**

Add to `tests/security-hardening.test.ts`:

```ts
import { RouterError, toOpenAIError } from '../src/errors.js';

it('redacts token-like secrets from normalized errors', () => {
  const error = toOpenAIError(new RouterError(
    'Bearer abc.def refresh_token=refresh-secret access_token=access-secret api_key=key-secret',
    { status: 401, code: 'auth_refresh_failed', retryable: false }
  ));
  const serialized = JSON.stringify(error.body);

  expect(serialized).not.toContain('abc.def');
  expect(serialized).not.toContain('refresh-secret');
  expect(serialized).not.toContain('access-secret');
  expect(serialized).not.toContain('key-secret');
  expect(serialized).toContain('[REDACTED]');
});
```

- [ ] **Step 2: Run test**

```powershell
npm test -- tests/security-hardening.test.ts
```

Expected: FAIL until `toOpenAIError` redacts token-like strings.

- [ ] **Step 3: Add central redaction**

In `src/errors.ts`, add:

```ts
function redactErrorMessage(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/refresh[_-]?token[=:]\s*[^\s,&}]+/gi, 'refresh_token=[REDACTED]')
    .replace(/access[_-]?token[=:]\s*[^\s,&}]+/gi, 'access_token=[REDACTED]')
    .replace(/api[_-]?key[=:]\s*[^\s,&}]+/gi, 'api_key=[REDACTED]');
}
```

Change the `message` line in `toOpenAIError` to:

```ts
const message = redactErrorMessage(error instanceof Error ? error.message : String(error));
```

- [ ] **Step 4: Run tests**

```powershell
npm test -- tests/security-hardening.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\errors.ts tests\security-hardening.test.ts
git commit -m "Harden auth secret redaction"
```

### Task 8: Update docs for Plan D

**Files:**
- Modify: `README.md`
- Modify: `config.example.json`
- Modify: `.env.example`
- Modify: `SECURITY.md`

- [ ] **Step 1: Document translator/channel status**

Add README section:

```md
## Channel Compatibility

The router includes a translator framework for OpenAI, Claude, Gemini, and Codex-shaped payloads. Channel provider skeletons expose explicit `501 not_implemented` errors until a channel executor is completed.
```

- [ ] **Step 2: Document websocket default**

Add:

```md
`server.websocketEnabled` defaults to `false`. When enabled before a concrete websocket executor is configured, `/v1/ws` returns `501 not_implemented`.
```

- [ ] **Step 3: Update `config.example.json`**

Add to the `server` object:

```json
"websocketEnabled": false
```

Add optional provider examples:

```json
{
  "id": "claude",
  "type": "claude",
  "baseUrl": "https://api.anthropic.com",
  "apiKeyEnv": "ANTHROPIC_API_KEY",
  "optional": true
},
{
  "id": "xai",
  "type": "xai",
  "baseUrl": "https://api.x.ai/v1",
  "apiKeyEnv": "XAI_API_KEY",
  "optional": true
},
{
  "id": "kimi",
  "type": "kimi",
  "baseUrl": "https://api.moonshot.ai/v1",
  "apiKeyEnv": "KIMI_API_KEY",
  "optional": true
}
```

- [ ] **Step 4: Update `.env.example`**

Add:

```env
ANTHROPIC_API_KEY=
XAI_API_KEY=
KIMI_API_KEY=
```

- [ ] **Step 5: Update SECURITY**

Document:

```md
Auth records may contain OAuth tokens or API keys under `auth.authDir`; never commit this directory. Admin routes redact secrets but should remain localhost-only or behind trusted network controls.
```

- [ ] **Step 6: Run docs-adjacent checks**

```powershell
npm test -- tests/config-example.test.ts tests/security-hardening.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add README.md SECURITY.md config.example.json .env.example
git commit -m "Document channel and operations parity"
```

### Task 9: Final verification for Plan D

- [ ] **Step 1: Run complete CI-equivalent checks**

```powershell
npm run build
npm run typecheck
npm test
npm run smoke
npm audit --audit-level=moderate
```

Expected: all commands exit 0.

- [ ] **Step 2: Commit any fixes**

```powershell
git status --short
# If fixes were made, stage only the files changed by those fixes.
git add README.md SECURITY.md config.example.json .env.example src tests
git commit -m "Stabilize channel translator hardening"
```

- [ ] **Step 3: Request final code review**

Use the required code review workflow. The reviewer should specifically inspect:

1. No secret leaks in API errors/log-visible messages.
2. Provider skeletons return explicit errors instead of silent success.
3. Translator tests cover basic request and response shape.
4. Websocket route remains disabled by default.
