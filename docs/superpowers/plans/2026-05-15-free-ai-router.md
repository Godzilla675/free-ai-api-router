# Free AI Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-ready local OpenAI-compatible router for free/developer-tier AI providers with dynamic model discovery, rate limiting, health tracking, and fallback.

**Architecture:** Implement a TypeScript Node HTTP service. Provider adapters normalize OpenAI-compatible and Gemini APIs. The model registry dynamically discovers upstream models and overlays configured aliases/routes so equivalent model requests can fallback across providers.

**Tech Stack:** Node 24, TypeScript, Vitest, built-in `fetch`, built-in `http`, JSON configuration, JSONL usage logs.

---

## File Structure

- `src/types.ts`: shared config, provider, request, response, and usage event types.
- `src/errors.ts`: normalized router errors and retryability classification.
- `src/config.ts`: load and validate JSON config, resolve environment-backed secrets.
- `src/providers/provider.ts`: provider adapter interface.
- `src/providers/openai-compatible.ts`: generic OpenAI-compatible provider with dynamic `/models` fetching and chat forwarding.
- `src/providers/gemini.ts`: native Gemini API adapter with dynamic model listing and OpenAI chat transform.
- `src/providers/factory.ts`: build provider adapters from config.
- `src/model-registry.ts`: dynamic model discovery, exact-name grouping, aliases, route overlays, TTL cache.
- `src/rate-limit.ts`: hierarchical fixed-window limits and concurrency gates.
- `src/health.ts`: passive deployment health, cooldowns, and recovery.
- `src/usage.ts`: JSONL usage recorder.
- `src/router.ts`: route chat requests, fallback, streaming guardrails, usage events.
- `src/server.ts`: OpenAI-compatible HTTP endpoints and admin endpoints.
- `src/index.ts`: CLI entrypoint.
- `tests/*.test.ts`: TDD coverage for registry, rate limiting, provider adapter, router fallback, and HTTP endpoints.

## Tasks

### Task 1: Project Skeleton And Failing Tests

**Files:** `package.json`, `tsconfig.json`, `vitest.config.ts`, `tests/model-registry.test.ts`, `tests/rate-limit.test.ts`, `tests/openai-provider.test.ts`, `tests/router-fallback.test.ts`, `tests/server.test.ts`

- [x] Create package and TypeScript config.
- [x] Write tests that import the intended public APIs and describe behavior.
- [ ] Run `npm install`.
- [ ] Run `npm test` and verify tests fail because `src` modules are missing.

### Task 2: Core Types, Errors, Config

**Files:** `src/types.ts`, `src/errors.ts`, `src/config.ts`

- [ ] Define config objects for server, providers, routes, routing, storage, and limits.
- [ ] Define normalized chat request/response and provider interfaces.
- [ ] Implement config loading with clear validation errors.
- [ ] Run `npm test -- tests/model-registry.test.ts` and expect missing registry errors until Task 3.

### Task 3: Model Registry

**Files:** `src/model-registry.ts`, `src/types.ts`

- [ ] Implement dynamic provider model discovery.
- [ ] Group exact matching model IDs across providers.
- [ ] Overlay configured model groups and aliases.
- [ ] Keep stale model snapshots when refresh fails.
- [ ] Run `npm test -- tests/model-registry.test.ts` and expect pass.

### Task 4: Rate Limits And Health

**Files:** `src/rate-limit.ts`, `src/health.ts`

- [ ] Implement fixed-window RPM and TPM checks for global, user, provider, model, and deployment scopes.
- [ ] Implement max parallel reservations and release.
- [ ] Implement health cooldown after consecutive retryable failures.
- [ ] Run `npm test -- tests/rate-limit.test.ts` and expect pass.

### Task 5: Providers

**Files:** `src/providers/provider.ts`, `src/providers/openai-compatible.ts`, `src/providers/gemini.ts`, `src/providers/factory.ts`

- [ ] Implement generic OpenAI-compatible model discovery and chat completion forwarding.
- [ ] Implement Gemini model discovery and non-streaming chat transform.
- [ ] Preserve upstream streaming responses for OpenAI-compatible providers.
- [ ] Run `npm test -- tests/openai-provider.test.ts` and expect pass.

### Task 6: Router Fallback

**Files:** `src/router.ts`, `src/usage.ts`, `src/errors.ts`

- [ ] Implement candidate filtering by health and rate limits.
- [ ] Implement safe fallback on retryable provider errors.
- [ ] Do not fallback after streaming output starts.
- [ ] Record one usage event per attempted deployment.
- [ ] Run `npm test -- tests/router-fallback.test.ts` and expect pass.

### Task 7: HTTP Server

**Files:** `src/server.ts`, `src/index.ts`

- [ ] Implement bearer-token auth for `/v1` endpoints.
- [ ] Implement `/v1/models`, `/v1/chat/completions`, `/v1/responses`, `/health`, `/admin/providers`, and `/admin/usage`.
- [ ] Return OpenAI-style errors and router debug headers.
- [ ] Run `npm test -- tests/server.test.ts` and expect pass.

### Task 8: Docs And Release Hygiene

**Files:** `README.md`, `.env.example`, `Dockerfile`, `docs/providers.md`

- [ ] Document quick start, dynamic model discovery, provider setup, compliance boundaries, and examples.
- [ ] Add Dockerfile for repeatable deployment.
- [ ] Run `npm run build`, `npm run lint`, and `npm test`.
- [ ] Initialize git if needed, commit, and push with `gh` if authenticated.

## Self-Review

The plan covers the requested provider research, OpenAI-compatible endpoint, dynamic model fetching, fallback across equivalent models, rate limiting, failsafes, tests, docs, and GitHub push attempt. There are no unresolved placeholders. Type names are intentionally introduced in `src/types.ts` before later tasks use them.
