# Free AI API Router

[![CI](https://github.com/Godzilla675/free-ai-api-router/actions/workflows/ci.yml/badge.svg)](https://github.com/Godzilla675/free-ai-api-router/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Godzilla675/free-ai-api-router/actions/workflows/codeql.yml/badge.svg)](https://github.com/Godzilla675/free-ai-api-router/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Local OpenAI-compatible router for free and developer-tier AI providers. It discovers upstream models dynamically, groups equivalent deployments, applies hierarchical rate limits, records usage, and falls back safely when a selected model exists on multiple providers.

## What It Supports

- OpenAI-compatible `/v1/models`, `/v1/chat/completions`, and basic non-streaming `/v1/responses` endpoints.
- Dynamic model discovery from provider `/models` endpoints instead of hardcoded model lists.
- OpenAI-compatible providers: Groq, Cerebras, OpenRouter, NVIDIA NIM, Hugging Face Inference Providers, GitHub Models, SambaNova, Cloudflare Workers AI, OpenCode server, iFlow, LiteLLM, CLIProxyAPI, 9Router, and similar relays.
- Native Gemini API adapter using `GEMINI_API_KEY`.
- Priority, weighted, round-robin, fill-first, and session-affinity routing strategies.
- Fallback across provider deployments for the same dynamic model ID or configured aliases.
- Hierarchical limits for global, user/API key, provider, model, and deployment scopes.
- Passive health cooldown after retryable failures.
- JSONL usage audit log.

## Quick Start

```bash
npm install
cp config.example.json config.json
cp .env.example .env
npm run build
node --env-file=.env dist/index.js --config config.json
```

Node reads provider keys from the real environment. On PowerShell you can set them for the current session like this:

```powershell
$env:GROQ_API_KEY = "your_key"
$env:CEREBRAS_API_KEY = "your_key"
$env:OPENROUTER_API_KEY = "your_key"
$env:NVIDIA_API_KEY = "your_key"
$env:GEMINI_API_KEY = "your_key"
$env:OPENCODE_SERVER_PASSWORD = "your_local_opencode_server_password"
$env:HF_TOKEN = "your_huggingface_token"
$env:GITHUB_TOKEN = "your_github_token_with_models_read"
$env:SAMBANOVA_API_KEY = "your_key"
$env:CLOUDFLARE_API_TOKEN = "your_cloudflare_token"
$env:CLOUDFLARE_WORKERS_AI_BASE_URL = "https://api.cloudflare.com/client/v4/accounts/your_account_id/ai"
$env:IFLOW_API_KEY = "your_key"
```

Replace `dev-token-change-me` and `dev-admin-change-me` in `config.json` before binding to anything except `127.0.0.1`.

Call it with any OpenAI SDK/client:

```bash
curl http://127.0.0.1:8080/v1/chat/completions \
  -H "Authorization: Bearer dev-token-change-me" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"free-coding\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hi\"}]}"
```

## Dynamic Models And Aliases

Provider model lists are refreshed when `/v1/models` is requested and at startup. Exact upstream IDs are grouped automatically. For example, if both Groq and OpenRouter expose `qwen/qwen3-32b`, the router exposes one `qwen/qwen3-32b` model backed by both deployments.

Use `models` in `config.json` when providers use different IDs for the same user-facing model:

```json
{
  "name": "gemini-3.1-pro",
  "aliases": ["gemini-pro"],
  "routes": [
    { "provider": "gemini", "model": "models/gemini-3.1-pro" },
    { "provider": "openrouter", "model": "google/gemini-3.1-pro:free" }
  ]
}
```

## Provider Setup

Edit `config.json` and keep only providers you actually use. Providers without available API keys are skipped, and configured alias routes referencing skipped providers are ignored. Local HTTP providers such as OpenCode must set `allowLocal: true` to make SSRF-sensitive local access explicit.

Common free/developer-tier candidates:

- `GROQ_API_KEY`: OpenAI-compatible, fast free-tier models, clear rate limits.
- `CEREBRAS_API_KEY`: OpenAI-compatible, fast `gpt-oss` and Llama-family access where available.
- `OPENROUTER_API_KEY`: OpenAI-compatible aggregator; use `modelFilter: "free"` for free models.
- `NVIDIA_API_KEY`: NVIDIA NIM hosted serverless dev APIs through `https://integrate.api.nvidia.com/v1`.
- `GEMINI_API_KEY`: Official Gemini API key path.
- `OPENCODE_SERVER_PASSWORD`: Local OpenCode server or Zen-compatible endpoint if exposed as `/v1`.
- `HF_TOKEN`: Hugging Face Inference Providers router through `https://router.huggingface.co/v1`; free monthly credits are account-level.
- `GITHUB_TOKEN`: GitHub Models free public-preview API usage; token needs models access.
- `SAMBANOVA_API_KEY`: SambaNova Cloud OpenAI-compatible API with documented free/developer tiers.
- `CLOUDFLARE_API_TOKEN` plus `CLOUDFLARE_WORKERS_AI_BASE_URL`: Cloudflare Workers AI account API base, for example `https://api.cloudflare.com/client/v4/accounts/<account_id>/ai`; Workers AI has a daily free allocation.
- `IFLOW_API_KEY`: Optional because iFlow CLI/API availability has changed; verify your account endpoint first.

## Fallback Rules

The router falls back only for retryable failures:

- Network errors or timeouts before any body is returned.
- HTTP `408`, `409`, `425`, `429`, `500`, `502`, `503`, `504`.
- Provider-classified transient failures.

It does not fall back for invalid requests, authentication failures, authorization failures, safety blocks, or after a streaming request starts emitting tokens.

## Rate Limits

Configure fixed-window request and token limits:

```json
{
  "limits": {
    "global": { "rpm": 120, "tpm": 500000, "maxParallel": 20 },
    "users": { "default": { "rpm": 60, "tpm": 200000, "maxParallel": 5 } },
    "providers": { "groq": { "rpm": 30, "tpm": 100000 } },
    "models": { "free-coding": { "rpm": 20, "tpm": 50000 } },
    "deployments": { "groq:qwen/qwen3-32b": { "rpm": 10, "tpm": 20000 } }
  }
}
```

The router estimates prompt tokens before dispatch and records upstream usage when available.

## Admin Endpoints

- `GET /health`: basic process status.
- `GET /admin/providers`: provider list, health cooldown state, active routing strategies, and deployment cursors/error metrics. Requires admin bearer token.
- `GET /admin/usage?limit=100`: recent usage events from the configured recorder. Requires admin bearer token.
- `GET /admin/auth`: lists redacted auth records.
- `PATCH /admin/auth/:id`: toggles `disabled`.
- `DELETE /admin/auth/:id`: removes an auth record.

## Auth State

Plan B introduces file-backed auth records under `auth.authDir` (default `router-state/auth`). Auth JSON files may contain provider tokens or API keys and must never be committed. Admin APIs always redact `secrets`.

## Docker

Build and run with a mounted config and env file:

```bash
docker build -t free-ai-api-router .
docker volume create free-ai-router-state
docker run --rm -p 8080:8080 --env-file .env -v "$(pwd)/config.json:/app/config.json:ro" -v free-ai-router-state:/app/router-state free-ai-api-router
```

For containers, set `server.host` to `0.0.0.0` in `config.json`; the default `127.0.0.1` is safer for local non-container use.

PowerShell bind-mount variant:

```powershell
docker volume create free-ai-router-state
docker run --rm -p 8080:8080 --env-file .env -v "${PWD}/config.json:/app/config.json:ro" -v free-ai-router-state:/app/router-state free-ai-api-router
```

Keep the container listening on port `8080` unless you also update the Docker healthcheck.

## Operations

Persist `router-state/` if you want usage logs to survive restarts. Rotate `router-state/usage.jsonl` with your normal log rotation tooling; `/admin/usage` is capped to 1000 recent entries. Keep admin endpoints on localhost or behind trusted network controls. Dynamic model discovery keeps the last successful snapshot if every provider refresh fails.

## Compliance Boundary

Default examples use API keys and officially exposed HTTP/server endpoints, but the project supports operator-authorized token/credential files (e.g. for CLIProxyAPI parity integrations). Multi-account scheduling and pooling are supported, provided they are explicitly configured by the operator and avoid implicit scanning of unrelated system directories or browser storage. If you use Gemini CLI, Codex CLI, Claude Code, Antigravity, CLIProxyAPI, OpenCode, or similar tools as upstreams, keep that local, user-owned, and compliant with each provider's terms.

## Development

```bash
npm run build
npm run typecheck
npm test
npm run smoke
npm audit --audit-level=moderate
```

The test suite uses fake local providers for deterministic router, provider, rate-limit, and HTTP endpoint behavior. `npm run smoke` starts the built server with a temporary local config and verifies `/health`, auth rejection, and `/v1/models`.

## CI

GitHub Actions runs on pull requests, pushes to `main`, and manual dispatch:

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run smoke
npm audit --audit-level=moderate
```

CodeQL runs on PRs, pushes to `main`, a weekly schedule, and manual dispatch. Dependabot checks npm and GitHub Actions weekly.
