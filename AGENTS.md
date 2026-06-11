# Agent Instructions

This file is the first stop for agents working in this repository. Use it to avoid rediscovering project structure, commands, and safety rules.

## Project Snapshot

- **Name:** `free-ai-api-router`
- **Purpose:** Local OpenAI-compatible router for free and developer-tier AI providers.
- **Runtime:** Node.js `>=22`; CI uses Node `24`.
- **Language:** TypeScript ESM with `module`/`moduleResolution` set to `NodeNext`.
- **Runtime dependencies:** None.
- **Dev tools:** TypeScript, tsx, Vitest.
- **Core behavior:** Dynamic model discovery, model grouping and aliases, provider fallback, hierarchical rate limits, health cooldowns, JSONL usage recording, and OpenAI-compatible `/v1` endpoints.

## Start Here

1. Work from the repo root: `C:\Users\Ahmed\Desktop\free models api`.
2. Check `git --no-pager status --short --branch` before editing.
3. Read this file, then only read the files relevant to the task from the source map below.
4. Prefer the smallest safe change that fully satisfies the request.
5. Do not modify `dist/`, `node_modules/`, real `.env` files, local `config.json`, or `router-state/` artifacts.

## Important Commands

Run commands from the repository root.

```powershell
Set-Location 'C:\Users\Ahmed\Desktop\free models api'
npm ci
npm run build
npm run typecheck
npm test
npm run smoke
npm audit --audit-level=moderate
```

Common development commands:

```powershell
npm run dev       # tsx src/index.ts --config config.example.json
npm run build     # clean dist and compile production output
npm run start     # node dist/cli.js start --config config.json
npm test          # vitest run
npm run lint      # alias for typecheck
```

Before PR-quality completion, run the same checks as CI:

```powershell
npm run build
npm run typecheck
npm test
npm run smoke
npm audit --audit-level=moderate
```

## Repository Map

### Root files

- `package.json`: scripts, package metadata, Node engine, dependency policy.
- `tsconfig.json`: strict development typecheck config, includes `src/**/*.ts`, `tests/**/*.ts`, and `vitest.config.ts`.
- `tsconfig.build.json`: production build config.
- `vitest.config.ts`: Node test environment, excludes `dist/**`, 10 second timeout.
- `config.example.json`: documented example config. Keep this valid when changing config or providers.
- `.env.example`: documented environment variables only. Never add real secrets.
- `README.md`: user-facing setup, provider setup, routing, operations, and CI docs.
- `CONTRIBUTING.md`: PR checks and provider contribution rules.
- `SECURITY.md`: vulnerability reporting and security boundaries.
- `.github/workflows/ci.yml`: CI runs `npm ci`, build, typecheck, tests, smoke, and audit on Node 24.

### Source files

- `src/index.ts`: CLI entrypoint. Loads config, creates providers and registry, refreshes models, starts HTTP server.
- `src/config.ts`: loads and normalizes config, resolves env-based secrets, filters inactive optional providers, validates auth and provider URLs.
- `src/types.ts`: central type definitions for config, providers, models, requests, routing results, attempts, and usage events.
- `src/server.ts`: HTTP server, auth, JSON body parsing, request validation, OpenAI-compatible endpoints, admin endpoints, streaming response piping.
- `src/router.ts`: core routing engine. Handles registry refresh TTL, deployment selection, fallback, rate-limit reservations, health marking, and usage recording.
- `src/model-registry.ts`: dynamic model discovery, grouping, aliases, configured model routes, deployment sorting.
- `src/rate-limit.ts`: fixed-window limits for global, user, provider, model, and deployment scopes.
- `src/health.ts`: passive health cooldown tracking after retryable provider failures.
- `src/usage.ts`: in-memory and JSONL usage recorders.
- `src/errors.ts`: `RouterError`, retryability, status mapping, OpenAI error normalization.
- `src/providers/provider.ts`: provider interface exports.
- `src/providers/factory.ts`: provider type dispatch. Update this when adding a provider type.
- `src/providers/openai-compatible.ts`: generic OpenAI-compatible provider adapter, model parsing/filtering, timeout handling, retry-after parsing, secret redaction.
- `src/providers/gemini.ts`: native Gemini adapter, Gemini request/response conversion, unsupported tool/streaming handling, secret redaction.

### Test files

- `tests/config-example.test.ts`: validates documented optional providers and env-driven config.
- `tests/gemini-provider.test.ts`: Gemini adapter behavior.
- `tests/model-registry.test.ts`: model grouping, aliases, and registry behavior.
- `tests/openai-provider.test.ts`: OpenAI-compatible provider behavior.
- `tests/rate-limit.test.ts`: limiter behavior.
- `tests/reliability-hardening.test.ts`: timeout/failure resilience.
- `tests/router-fallback.test.ts`: retryable fallback and non-retryable stop behavior.
- `tests/security-hardening.test.ts`: auth fail-closed behavior, body limits, SSRF/local URL protections, env secret resolution.
- `tests/server.test.ts`: HTTP endpoint behavior.

## Architecture

The request path is:

1. `src/index.ts` loads `config.json` or the provided `--config` path through `loadConfig`.
2. `src/config.ts` normalizes defaults, resolves `baseUrlEnv` and `apiKeyEnv`, filters unavailable optional providers, and validates security-sensitive config.
3. `src/providers/factory.ts` builds provider adapters.
4. `src/model-registry.ts` asks providers for model lists and groups equivalent deployments by upstream model ID or configured aliases.
5. `src/server.ts` accepts OpenAI-compatible HTTP requests and delegates chat work to `AiRouter`.
6. `src/router.ts` selects deployments, enforces limits, calls providers, falls back only for retryable failures, marks health, and records usage.
7. `src/server.ts` returns OpenAI-compatible JSON or streams an upstream `Response`.

Keep these boundaries intact. Provider-specific HTTP details belong in provider adapters. Cross-provider routing decisions belong in `AiRouter`. Public HTTP shape and auth belong in `server.ts`. Config defaults and validation belong in `config.ts`.

## Coding Rules

- Keep TypeScript strict. The project enables `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.
- Use ESM imports with `.js` extensions for local TypeScript imports, matching existing files.
- Avoid `any` and avoid broad casts. Prefer proper types, type guards, and `unknown` narrowing.
- Do not add runtime dependencies unless the task genuinely needs them.
- Use `RouterError` for expected config, request, and upstream failures. Set meaningful `status`, `code`, and `retryable` values.
- Do not silently swallow errors. The only intentional snapshot fallback is in `model-registry.ts` when every provider refresh fails and a previous successful snapshot exists.
- Preserve OpenAI-compatible response shapes for `/v1/models`, `/v1/chat/completions`, and basic non-streaming `/v1/responses`.
- Preserve fail-closed auth. Empty auth token lists must not authorize requests.
- Preserve safe defaults: localhost binding by default, admin endpoints requiring admin token, debug headers disabled by default, and request body limits enforced.
- Do not expand streaming support casually. OpenAI-compatible streaming can proxy upstream `Response` objects; Gemini streaming and `/v1/responses` streaming are intentionally unsupported right now.
- When changing public behavior, update tests and user-facing docs.

## Provider Integration Rules

Provider changes usually touch:

1. `src/types.ts` if a new provider type or config field is needed.
2. `src/providers/<provider>.ts` for adapter implementation.
3. `src/providers/factory.ts` to construct the provider.
4. `config.example.json` for an optional documented example.
5. `.env.example` for environment variable names only.
6. `README.md` provider setup and compliance notes.
7. Tests under `tests/`, preferably with fake/local HTTP providers and no real external API calls.

Provider adapters must:

- Use official API keys or documented local/server endpoints only.
- Never scrape OAuth token caches, local account stores, browser profiles, CLI credential files, or subscription sessions.
- Never add multi-account pooling or quota-bypass behavior.
- Read secrets from environment variables or explicit local config, never from committed files.
- Redact tokens and API keys from upstream error messages before exposing them.
- Use timeouts and convert timeouts to retryable upstream errors.
- Respect upstream `Retry-After` where applicable.
- Use `redirect: 'manual'` for upstream fetches unless there is a clear reason not to.
- Treat authentication, authorization, invalid requests, safety blocks, and unsupported features as non-retryable.
- Treat network errors, timeouts, `408`, `409`, `425`, `429`, `500`, `502`, `503`, and `504` as retryable unless provider semantics require otherwise.

## Security Rules

- Never commit `.env`, real `config.json`, provider API keys, bearer tokens, OAuth tokens, real request payloads containing sensitive data, local account files, or usage logs.
- Keep `.env.example` and `config.example.json` synthetic.
- Local or private provider URLs must require `allowLocal: true`; do not weaken `validateProviderUrl`.
- Non-local provider URLs should use HTTPS.
- Keep admin endpoints protected by `server.adminToken`.
- Use constant-time token comparison for bearer token checks.
- Do not expose raw upstream errors that might contain secrets.
- Do not add SSRF-sensitive functionality without explicit validation and tests.
- If a task involves auth bypass, token leakage, SSRF, request smuggling, dependency compromise, or credential handling, update or add security-focused tests.

## Testing Guidance

- Prefer deterministic tests with fake providers or local `http.Server` instances.
- Do not call real upstream providers in tests.
- Add or update the narrowest test file that owns the behavior:
  - Config/schema/security validation: `tests/security-hardening.test.ts` or `tests/config-example.test.ts`
  - Routing and fallback: `tests/router-fallback.test.ts`
  - Rate limits: `tests/rate-limit.test.ts`
  - Model grouping/aliases: `tests/model-registry.test.ts`
  - OpenAI-compatible adapter: `tests/openai-provider.test.ts`
  - Gemini adapter: `tests/gemini-provider.test.ts`
  - HTTP endpoints: `tests/server.test.ts`
- Restore modified environment variables in `finally` blocks. Existing tests use small helpers for this.
- Close local test servers in `afterEach` to avoid port leaks.
- For bug fixes, write a failing test that reproduces the bug before changing implementation when practical.

## Common Task Playbooks

### Add a new OpenAI-compatible provider entry

1. Check whether `OpenAICompatibleProvider` already supports the provider with config only.
2. Add an optional provider object to `config.example.json`.
3. Add environment variable names to `.env.example`.
4. Update `README.md` provider setup and compliance notes.
5. Update `tests/config-example.test.ts` to prove the provider normalizes correctly when env vars are present.
6. Run `npm run typecheck` and `npm test`.

Do not add a new adapter if `baseUrl`, `modelsPath`, `chatPath`, headers, and `modelFilter` are enough.

### Add a new provider adapter type

1. Add the provider type to `ProviderType` in `src/types.ts`.
2. Create `src/providers/<name>.ts`.
3. Implement `ProviderAdapter` with `listModels()` and `chat()`.
4. Add construction in `src/providers/factory.ts`.
5. Add adapter tests with fake HTTP responses.
6. Update config examples and README.
7. Run build, typecheck, tests, smoke, and audit.

### Change config behavior

1. Update `src/types.ts` first if the schema changes.
2. Update defaults and validation in `src/config.ts`.
3. Update `config.example.json`, `.env.example`, and README if user-visible.
4. Add tests for defaults, invalid config, and env resolution.
5. Keep optional provider filtering behavior intact unless the task explicitly changes it.

### Change routing or fallback behavior

1. Read `src/router.ts`, `src/errors.ts`, `src/health.ts`, and relevant tests.
2. Add tests in `tests/router-fallback.test.ts` or `tests/reliability-hardening.test.ts`.
3. Preserve the rule: fallback only for retryable failures.
4. Preserve rate-limit reservation release in `finally` blocks.
5. Preserve usage recording for attempts.

### Change HTTP API behavior

1. Read `src/server.ts` and `tests/server.test.ts`.
2. Keep request validation explicit and error responses OpenAI-compatible.
3. Keep auth checks before `/v1` and `/admin` behavior.
4. Add tests for status code, response body shape, and auth behavior.
5. Update README if the public API changes.

### Change security-sensitive behavior

1. Read `SECURITY.md`, `CONTRIBUTING.md`, `src/config.ts`, `src/server.ts`, and `tests/security-hardening.test.ts`.
2. Add regression tests before implementation.
3. Keep secrets redacted and auth fail-closed.
4. Do not weaken URL validation, body limits, or token checks.
5. Run the full CI command set.

## Documentation Expectations

Update docs when behavior changes:

- `README.md`: setup, provider list, public API, routing, operations, compliance boundary.
- `CONTRIBUTING.md`: contributor workflow or provider contribution rules.
- `SECURITY.md`: reporting or security boundary changes.
- `.github/pull_request_template.md`: only if verification requirements change.
- `config.example.json` and `.env.example`: whenever documented config or env vars change.

## Token-Saving Rules for Agents

- Do not scan the whole repo. Use the source map above.
- Do not read `dist/` or `node_modules/`.
- Do not run broad recursive searches from `C:\Users\Ahmed`; stay in this repo.
- Do not inspect every test file. Pick the test file matching the subsystem.
- Do not re-derive architecture from scratch unless this file is stale.
- Do not change unrelated files while fixing a focused issue.
- Do not add new abstractions unless at least two current call sites need them.
- Do not add compatibility layers for hypothetical providers or clients.
- Prefer existing helpers and patterns over new utilities.
- If this file conflicts with a direct user instruction, follow the user instruction and keep the change scoped.
