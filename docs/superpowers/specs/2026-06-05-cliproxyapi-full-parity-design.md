# CLIProxyAPI Parity Program — Plan A Implementation Spec (TypeScript)

**Date:** 2026-06-05  
**Repository:** `Godzilla675/free-ai-api-router`  
**Goal:** Clone the full functional surface of `router-for-me/CLIProxyAPI` into this repository.  
**Owner directive:** Repository owner explicitly approved overriding the current "no session scraping/no account pooling" boundary for this project direction.

## 1. Scope and parity target

Program target is full functional parity (not line-by-line parity) for:

1. Multi-provider auth and execution for Gemini, AI Studio Build, Codex/OpenAI, Claude, Grok/xAI, Kimi, Antigravity-like channels, and OpenAI-compatible upstreams.
2. OAuth/device-login and file-backed credential lifecycle (login, refresh, cooldown, disable/enable, metadata).
3. Multi-account scheduling and load balancing with round-robin/fill-first/session-affinity/cooldown-aware selection.
4. OpenAI-compatible `/v1` endpoints (chat, responses, models, images where supported), streaming and websocket paths where applicable.
5. Provider/channel translators between OpenAI/Claude/Gemini/Codex request-response formats.
6. Management APIs for credential and runtime administration.

### 1.1 Parity matrix (program target + Plan A target)

| Area | Program parity target | Plan A parity target (this spec) |
| --- | --- | --- |
| Public API | `/v1/models`, `/v1/chat/completions`, `/v1/responses`, streaming chat/responses, websocket routes where needed | keep existing `/v1` behavior stable; no new streaming/ws API yet |
| Routing | priority, weighted, round-robin, fill-first, session-affinity, cooldown-aware fallback | implement round-robin, fill-first, session-affinity, retry-after cooldown |
| Credentials | file-backed auth records, per-auth metadata/proxy/header overrides, enable/disable, refresh scheduling | config schema foundation only (types/validation hooks) |
| Providers/channels | OpenAI/Codex, Gemini, AI Studio Build, Claude, Grok/xAI, Kimi, OpenAI-compatible pools | no new provider executors in Plan A |
| Management | auth listing/update endpoints, health/usage/provider status | extend `/admin/providers` diagnostics for scheduler/cooldown visibility |

Program parity is achieved only when all plan specs (A-D) pass their fixture catalog and endpoint acceptance tests.

### 1.2 Program decomposition (scope control)

This document is a **single executable implementation spec for Plan A only**.

Program decomposition:

1. Plan A: Scheduler + config + reliability baseline.
2. Plan B: Auth lifecycle + management API.
3. Plan C: Codex/OpenAI and Gemini/AI Studio channel parity.
4. Plan D: Remaining channel translators + operational hardening.

Only Plan A is in scope for immediate implementation planning and execution.

## 2. Architectural strategy

Current router architecture is compact and provider-adapter based. Full parity requires splitting responsibilities into modules similar to CLIProxyAPI:

1. **Auth domain:** credential models, OAuth flows, file persistence, refresh workers.
2. **Execution domain:** provider executors (HTTP and websocket relay transport), retries, cooldown handling.
3. **Translation domain:** request/response mapping across protocol families.
4. **Scheduling domain:** account selection and model-scoped availability.
5. **API domain:** public `/v1` routes + management routes.
6. **State domain:** usage, health, quota windows, session-affinity cache.

Implementation remains TypeScript ESM, but moves from "single router core" to a modular runtime.

## 3. Plan A module map (new/expanded files only)

### 3.1 Scheduler and selection

- `src/scheduler/selector.ts`: deterministic round-robin and fill-first selectors.
- `src/scheduler/session-affinity.ts`: session key extraction, sticky binding table, TTL eviction.
- `src/scheduler/types.ts`: scheduler state types and config types.

### 3.2 Router and health integration

- `src/router.ts`: route candidate selection wired to scheduler strategies.
- `src/health.ts`: cooldown supports retry-after override timestamps.
- `src/errors.ts`: retain/propagate retry-after metadata consistently.

### 3.3 Config and API diagnostics

- `src/types.ts`/`src/config.ts`: add Plan A routing fields.
- `src/server.ts`: enrich `/admin/providers` output with scheduler/cooldown diagnostics.

## 4. Interface contracts (Plan A boundaries)

### 4.1 Scheduler contract

- Input: `AuthSnapshot[]`, provider key, model key, request metadata.
- Output: `SelectionResult { deploymentId, providerId, reason, retryAfterMs? }`.
- Guarantees:
  - deterministic selection for round-robin/fill-first/session-affinity,
  - never returns disabled auth,
  - can return cooldown/unavailable terminal errors with retry hints.

### 4.2 Session-affinity contract (exact)

- Config fields:
  - `routing.sessionAffinity: boolean` (default `false`)
  - `routing.sessionAffinityTtlMs: number` (default `3_600_000`)
  - `routing.sessionAffinityMaxEntries: number` (default `10_000`)
- Session key precedence (first non-empty wins):
  1. `X-Session-ID`
  2. `Session-Id`
  3. `Session_id`
  4. body `conversation_id`
  5. hash of first 3 user/assistant message contents
- Eviction algorithm:
  - strict TTL expiry on read/write,
  - if size exceeds `maxEntries`, evict least-recently-used entry.

### 4.3 Management API contract (Plan A concrete)

- `GET /admin/providers` (admin token required) response adds:
  - `routing.strategy`
  - `routing.sessionAffinity` and `routing.sessionAffinityTtlMs`
  - `deployments[].cooldownUntil`
  - `deployments[].lastError`
  - `deployments[].selectionCursor` (when applicable)
- Error responses:
  - `401 unauthorized` for missing/invalid admin bearer
  - `500 upstream_error` for internal state failures

Response shape (added fields only):

```json
{
  "routing": {
    "strategy": "round-robin",
    "sessionAffinity": true,
    "sessionAffinityTtlMs": 3600000
  },
  "deployments": [
    {
      "id": "openrouter:moonshotai/kimi-k2",
      "cooldownUntil": 0,
      "lastError": {
        "message": "rate limited",
        "status": 429,
        "retryable": true,
        "updatedAt": "2026-06-05T13:00:00.000Z"
      },
      "selectionCursor": 3
    }
  ]
}
```

Field semantics:

- `cooldownUntil`: unix epoch milliseconds; `0` means eligible now.
- `lastError`: omitted when no recorded error for deployment in current process lifetime.
- `selectionCursor`: integer cursor for deterministic strategies; omitted for strategies that do not track cursors.

## 5. Data flow design (Plan A)

### 5.1 Request path

1. API route parses request and identifies protocol shape.
2. Translator normalizes to executor-native request.
3. Scheduler selects eligible auth for provider+model.
4. Executor sends request via HTTP or websocket relay.
5. On response/error:
   - usage and health are recorded,
   - auth/model cooldown state updated,
   - retries/fallback applied when retryable.
6. Translator maps response back to requested downstream protocol.

## 6. Error handling and reliability model

1. Retain explicit retryable vs non-retryable classification.
2. Track cooldown at both auth-level and auth+model-level.
3. Honor `Retry-After` for cooldown scheduling when present.
4. Keep detailed last-error metadata for management visibility.
5. Ensure streaming pathways stop fallback after bytes are emitted.
6. Keep secret redaction in all upstream error surfaces and logs.

### 6.1 Retry/fallback stage rules (explicit)

1. **Pre-dispatch failures** (auth unavailable, local validation error): no upstream retry; fallback to next eligible auth only when error is retryable.
2. **Pre-first-byte upstream failures** (timeout/network/HTTP retryable): may retry same auth or fallback to next auth per policy.
3. **Post-first-byte stream failures:** no fallback to a different auth in same request; terminate stream with translated terminal error event.
4. **Auth failures (`401/403/invalid_grant`)**: mark non-retryable for that auth until refreshed/re-enabled.

Note: websocket-specific fallback rules are deferred to Plan C and intentionally not implemented in Plan A.

## 7. Security and policy delta

To satisfy owner-requested parity, this project intentionally changes prior boundary:

1. Allow OAuth/session-backed auth integrations where needed for parity.
2. Allow multi-account pools and account-level load balancing.
3. Preserve minimum safeguards:
   - no committed secrets,
   - strict token redaction,
   - localhost gating for sensitive management endpoints by default,
   - explicit feature flags for high-risk channels.

### 7.1 Credential-source guardrails (explicit)

1. Accepted credential sources:
   - interactive OAuth/device login performed by this service,
   - operator-provided token files in configured auth directory,
   - explicit API keys in config/env.
2. Rejected sources:
   - scanning unrelated home/profile directories by default,
   - importing browser storage without explicit operator action,
   - implicit token extraction from unrelated applications.
3. All imported credentials must be represented as explicit auth records with audit metadata (`source`, `createdAt`, `updatedAt`).

`README.md`, `SECURITY.md`, and contributor guidance must be updated to reflect this policy change.

## 8. Plan A scope

### 8.1 Plan A work packages (implementation order)

1. Add routing strategies: `round-robin`, `fill-first`, `session-affinity`.
2. Add session-affinity extraction and TTL cache with bounded size and deterministic eviction.
3. Add per-deployment cooldown improvements using retry-after precedence.
4. Extend `/admin/providers` with scheduler/cooldown diagnostics defined in §4.5.
5. Extend tests for deterministic selection and cooldown behavior.

### 8.2 Plan A out-of-scope

1. New OAuth login flows.
2. New provider executors/translators.
3. New websocket endpoints.
4. Management auth CRUD endpoints.

## 9. Test strategy (Plan A, TDD-first)

For each phase:

1. Add failing tests for target behavior before implementation.
2. Implement minimal passing code.
3. Refactor while staying green.

Test suites:

- `tests/router-fallback.test.ts` and new scheduler tests.
- `tests/server.test.ts` for `/admin/providers` diagnostics.
- `tests/reliability-hardening.test.ts` for retry-after cooldown behavior.

### 9.1 Plan A fixture catalog (required)

| Fixture ID | Scenario | Expected result |
| --- | --- | --- |
| `planA-rr-001` | 3 deployments same model, round-robin strategy | call order rotates deterministically |
| `planA-ff-001` | 3 deployments same model, fill-first strategy | first healthy deployment always selected |
| `planA-sa-001` | repeated requests with same session key | same deployment selected until unavailable |
| `planA-sa-002` | bound deployment enters cooldown | affinity rebinds to next eligible deployment |
| `planA-ra-001` | retryable failure with Retry-After header | cooldown uses retry-after window over default cooldown |
| `planA-admin-001` | `/admin/providers` after strategy/cooldown activity | diagnostics fields from §4.3 are present |

## 10. Risks and mitigations (Plan A)

1. **Complexity jump:** mitigated by phased modularization and strict interfaces.
2. **Non-deterministic scheduler bugs:** mitigated by deterministic fixture tests in §9.1.
3. **Cache growth/regressions:** mitigated by max-entry + LRU+TTL tests.
4. **Long-running delivery:** mitigated by limiting this spec strictly to Plan A.

## 11. Definition of done (Plan A)

1. Config supports Plan A routing fields and validation defaults.
2. Round-robin/fill-first/session-affinity selection pass all §9.1 fixtures.
3. Retry-after cooldown precedence works for retryable failures.
4. `/admin/providers` returns Plan A diagnostics in §4.3.
5. Documentation reflects new Plan A routing controls.
6. Build, typecheck, tests, smoke, and audit pass in CI.
