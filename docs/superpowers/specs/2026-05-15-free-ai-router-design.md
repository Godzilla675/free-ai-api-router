# Free AI API Router Design

## Goal

Build a local OpenAI-compatible AI API router that discovers available free/developer-tier models dynamically, routes requests across configured providers, rate-limits usage, and safely falls back when a selected model is available from more than one provider.

## Research Summary

The stable MVP providers are OpenAI-compatible or documented API-key services: Groq, Cerebras, OpenRouter free models, NVIDIA NIM, Hugging Face router-compatible endpoints, GitHub Models, Cloudflare Workers AI, OpenCode server or Zen-compatible endpoints, and optional iFlow if the account endpoint still works. Gemini should use the official Gemini API key or Vertex-compatible path, not reused Code Assist OAuth tokens. CLI/OAuth wrappers for Gemini CLI, Codex CLI, Claude Code, and Antigravity are high-risk when used as third-party subscription proxies, so the router treats them as opt-in upstreams through official local CLI/API surfaces only.

## Architecture

The app is a TypeScript Node service with no runtime framework dependency. It exposes `/v1/models`, `/v1/chat/completions`, `/v1/responses`, `/health`, and admin inspection endpoints. A provider adapter layer hides upstream differences, while the router only deals with normalized model metadata, normalized chat requests, normalized chat responses, retryability, and health state.

The model registry is dynamic. It calls each enabled provider's model-list endpoint, builds exact-name groups automatically, and overlays configured aliases/routes for equivalent models. A request for `gemini-3.1-pro`, for example, can resolve to multiple deployments if more than one provider reports that model ID or if config maps provider-specific IDs into the same user-facing model group.

## Provider Strategy

The first production path is the generic OpenAI-compatible adapter. It covers Groq, Cerebras, OpenRouter, NVIDIA, OpenCode server, iFlow, LiteLLM, CLIProxyAPI, 9Router, and other compatible relays. The Gemini adapter uses the official Generative Language API. Local CLI/OAuth tools can be integrated by running their own server or an explicit command adapter later, but they are not silently reverse-engineered.

## Routing And Fallback

The router supports priority and weighted routing. It filters candidates by requested model, API key/user limits, provider limits, deployment limits, current health, quota cooldown, and concurrency. It retries/falls back only for network errors, timeouts before body emission, HTTP `408`, `409`, `425`, `429`, `500`, `502`, `503`, and `504`, or provider-classified transient errors. It does not fallback for authentication failures, validation errors, safety blocks, or after a streaming response has emitted tokens.

## Rate Limiting

The service uses hierarchical fixed-window limits for global, user, provider, model, and deployment scopes. It estimates tokens from request text before dispatch and records actual upstream usage when available. `429` responses include `retry-after` and standard router limit headers. The design keeps counters in memory for one-node local deployments and writes usage events to JSONL for audits.

## Observability And Failsafes

Every attempted deployment produces a usage event with request ID, API key hash, model group, provider, deployment, status, fallback count, latency, token usage, and error classification. Consecutive retryable failures trigger health cooldown so later requests skip unhealthy deployments temporarily. Dynamic model discovery has a TTL and keeps the previous successful snapshot if a provider's model-list endpoint fails.

## Testing

The core behavior is tested with fake providers and local fake HTTP upstreams. Tests cover dynamic model grouping, configured aliases, fallback on retryable errors, no fallback on non-retryable errors, provider model discovery, chat forwarding, hierarchical rate limiting, and HTTP API compatibility.

## Compliance Boundary

The router ships examples for API-key and officially exposed local/server endpoints. It documents CLI/OAuth subscription proxying as experimental and user-owned only. The default config avoids token cache scraping and avoids multi-account pooling designed to bypass provider quotas.
