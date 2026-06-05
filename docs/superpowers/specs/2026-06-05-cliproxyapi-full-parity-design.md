# CLIProxyAPI Full-Parity Port Design (TypeScript)

**Date:** 2026-06-05  
**Repository:** `Godzilla675/free-ai-api-router`  
**Goal:** Clone the full functional surface of `router-for-me/CLIProxyAPI` into this repository.  
**Owner directive:** Repository owner explicitly approved overriding the current "no session scraping/no account pooling" boundary for this project direction.

## 1. Scope and parity target

This design targets functional parity (not line-by-line parity) for:

1. Multi-provider auth and execution for Gemini, AI Studio Build, Codex/OpenAI, Claude, Grok/xAI, Kimi, Antigravity-like channels, and OpenAI-compatible upstreams.
2. OAuth/device-login and file-backed credential lifecycle (login, refresh, cooldown, disable/enable, metadata).
3. Multi-account scheduling and load balancing with round-robin/fill-first/session-affinity/cooldown-aware selection.
4. OpenAI-compatible `/v1` endpoints (chat, responses, models, images where supported), streaming and websocket paths where applicable.
5. Provider/channel translators between OpenAI/Claude/Gemini/Codex request-response formats.
6. Management APIs for credential and runtime administration.

Parity is defined as equivalent operator behavior and API outputs for supported scenarios in test coverage.

## 2. Architectural strategy

Current router architecture is compact and provider-adapter based. Full parity requires splitting responsibilities into modules similar to CLIProxyAPI:

1. **Auth domain:** credential models, OAuth flows, file persistence, refresh workers.
2. **Execution domain:** provider executors (HTTP and websocket relay transport), retries, cooldown handling.
3. **Translation domain:** request/response mapping across protocol families.
4. **Scheduling domain:** account selection and model-scoped availability.
5. **API domain:** public `/v1` routes + management routes.
6. **State domain:** usage, health, quota windows, session-affinity cache.

Implementation remains TypeScript ESM, but moves from "single router core" to a modular runtime.

## 3. Planned module map (new/expanded files)

### 3.1 Auth and credential lifecycle

- `src/auth/types.ts`: `AuthRecord`, quota state, model state, credential metadata.
- `src/auth/store.ts`: filesystem persistence for auth records.
- `src/auth/providers/*.ts`: provider-specific auth clients (Codex OAuth, Gemini OAuth/API-key, Claude OAuth, etc.).
- `src/auth/manager.ts`: lifecycle manager (load, validate, refresh schedule, update status).
- `src/auth/session-cache.ts`: session-affinity binding cache with TTL/eviction.

### 3.2 Scheduler and selection

- `src/scheduler/selector.ts`: round-robin and fill-first selectors.
- `src/scheduler/session-affinity.ts`: session extraction and sticky binding logic.
- `src/scheduler/scheduler.ts`: model+provider shard scheduling with cooldown/pinned-auth behavior.

### 3.3 Executors and transports

- `src/executors/base.ts`: executor interface.
- `src/executors/openai.ts`, `codex.ts`, `gemini.ts`, `aistudio.ts`, `claude.ts`, etc.
- `src/executors/ws-relay.ts`: websocket-backed request relay for channels that require it.
- `src/executors/retry.ts`: bounded retry and fallback orchestration.

### 3.4 Translators

- `src/translators/openai/*`, `src/translators/claude/*`, `src/translators/gemini/*`, `src/translators/codex/*`.
- Stateless mapping functions for request/response conversion in both stream and non-stream paths.

### 3.5 API and management

- Expand `src/server.ts` into route modules:
  - `src/api/v1/*.ts` for models/chat/responses/images/ws.
  - `src/api/management/*.ts` for auth/config/admin operations.

### 3.6 Config and compatibility

- Expand `src/types.ts`/`src/config.ts` to include parity config schema:
  - OAuth/auth blocks per provider.
  - Routing strategy and session-affinity options.
  - Retry/cooldown knobs.
  - Per-auth proxy/header/model alias/exclusion controls.

## 4. Data flow design

### 4.1 Request path

1. API route parses request and identifies protocol shape.
2. Translator normalizes to executor-native request.
3. Scheduler selects eligible auth for provider+model.
4. Executor sends request via HTTP or websocket relay.
5. On response/error:
   - usage and health are recorded,
   - auth/model cooldown state updated,
   - retries/fallback applied when retryable.
6. Translator maps response back to requested downstream protocol.

### 4.2 Auth lifecycle path

1. On startup: load auth records from configured auth directory.
2. Validate and normalize records, compute stable IDs.
3. Start refresh workers for expiring OAuth credentials.
4. Persist status transitions (available, cooling, disabled, quota-exceeded).
5. Expose operations via management API for inspection and maintenance.

## 5. Error handling and reliability model

1. Retain explicit retryable vs non-retryable classification.
2. Track cooldown at both auth-level and auth+model-level.
3. Honor `Retry-After` for cooldown scheduling when present.
4. Keep detailed last-error metadata for management visibility.
5. Ensure streaming pathways stop fallback after bytes are emitted.
6. Keep secret redaction in all upstream error surfaces and logs.

## 6. Security and policy delta

To satisfy owner-requested parity, this project intentionally changes prior boundary:

1. Allow OAuth/session-backed auth integrations where needed for parity.
2. Allow multi-account pools and account-level load balancing.
3. Preserve minimum safeguards:
   - no committed secrets,
   - strict token redaction,
   - localhost gating for sensitive management endpoints by default,
   - explicit feature flags for high-risk channels.

`README.md`, `SECURITY.md`, and contributor guidance must be updated to reflect this policy change.

## 7. Delivery phases (implementation order)

## Phase 1 — Scheduler and config foundation

1. Add routing strategies: `round-robin`, `fill-first`, `session-affinity`.
2. Add session-affinity extraction and TTL cache.
3. Add per-deployment cooldown improvements using retry-after.
4. Extend tests for deterministic selection and cooldown behavior.

## Phase 2 — Auth core and management skeleton

1. Introduce auth record types and store.
2. Implement auth manager load/update/persist loop.
3. Add management endpoints for listing/updating auth state.
4. Add regression tests for auth persistence and state transitions.

## Phase 3 — OpenAI/Codex parity surface

1. Add dedicated Codex executor path and OpenAI Responses parity.
2. Add codex-specific model aliasing and request metadata handling.
3. Add streaming and websocket behavior required for codex clients.
4. Add tests for responses/chunking/error translation.

## Phase 4 — Gemini and AI Studio Build channels

1. Add Gemini OAuth/API-key auth lifecycle parity.
2. Add AI Studio executor path (including websocket relay integration).
3. Add model alias and exclusion controls.
4. Add tests for non-stream and stream pathways.

## Phase 5 — Remaining provider families and translator parity

1. Claude/Grok/Kimi/Antigravity channel executors and translators.
2. OpenAI-compat provider pool behavior parity.
3. Cross-protocol translation tests and compatibility tests.

## Phase 6 — Operational hardening and docs

1. Usage/health/admin observability parity.
2. Full docs update for config, auth flows, and management API.
3. CI updates for larger test matrix and smoke scenarios.

## 8. Test strategy (TDD-first)

For each phase:

1. Add failing tests for target behavior before implementation.
2. Implement minimal passing code.
3. Refactor while staying green.

Test suites:

- `tests/router-fallback.test.ts` and new scheduler tests.
- provider/executor tests per channel.
- management API tests.
- security regression tests for auth and token redaction.
- end-to-end smoke tests covering auth selection and fallback.

## 9. Risks and mitigations

1. **Complexity jump:** mitigated by phased modularization and strict interfaces.
2. **Behavior drift from upstream:** mitigated by parity test vectors and fixture-based comparisons.
3. **Security regressions from expanded auth surface:** mitigated by redaction tests, explicit endpoint guards, and config validation.
4. **Long-running delivery:** mitigated by milestone-based slices that are independently runnable.

## 10. Definition of done

1. Config supports full targeted provider/auth/routing options.
2. Multi-account scheduler and session-affinity behavior match parity expectations.
3. Codex and AI Studio pathways are operational.
4. Management and observability endpoints cover auth and runtime state.
5. Documentation and examples reflect new policy and usage.
6. Build, typecheck, tests, smoke, and audit pass in CI.
