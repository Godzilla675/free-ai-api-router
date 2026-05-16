# Provider Notes

## Recommended MVP Providers

- Groq: OpenAI-compatible, strong free developer tier, published rate limits, good latency.
- Cerebras: OpenAI-compatible, fast inference, useful free limits for selected models.
- OpenRouter: OpenAI-compatible aggregator with `:free` models; availability and limits vary.
- NVIDIA NIM: OpenAI-compatible hosted development APIs for many catalog models; quotas vary by account/model.
- Gemini API: Official API key path with dynamic `models` discovery and strong multimodal support.
- Hugging Face Inference Providers: OpenAI-compatible router with monthly free credits on Hugging Face accounts.
- GitHub Models: OpenAI-compatible inference with free public-preview usage and rate limits.
- SambaNova Cloud: OpenAI-compatible API with documented free and developer tiers.
- Cloudflare Workers AI: OpenAI-compatible chat endpoint with a daily free Workers AI allocation; requires an account-specific base URL.
- OpenCode server or Zen-compatible endpoint: useful when local OpenCode exposes `/v1` endpoints.

## Optional Providers

- iFlow: keep optional because iFlow CLI/API availability has changed. Verify endpoint, account, and terms before relying on it.
- DeepInfra, Together, Fireworks, Mistral, and similar paid/developer-credit providers: supported by the OpenAI-compatible configuration pattern when their endpoint exposes model discovery and chat completions.
- Cloudflare AI Gateway: can be configured as an OpenAI-compatible relay when you prefer gateway routing over direct Workers AI.
- CLIProxyAPI, LiteLLM, 9Router, OmniRoute: configure as upstream OpenAI-compatible local relays with `allowLocal: true`. This router can sit in front of them for additional policy, health, and aliases.

## Known Endpoint Patterns

| Provider | Base URL Pattern | Auth | Notes |
| --- | --- | --- | --- |
| Groq | `https://api.groq.com/openai/v1` | Bearer API key | Clear free-tier rate limits; good first provider. |
| Cerebras | `https://api.cerebras.ai/v1` | Bearer API key | Fast inference; free limits vary by model/account. |
| OpenRouter | `https://openrouter.ai/api/v1` | Bearer API key | Use `modelFilter: "free"`; free model availability changes. |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | Bearer API key | Hosted dev APIs; model catalog/quotas vary. |
| Hugging Face Inference Providers | `https://router.huggingface.co/v1` | Bearer `HF_TOKEN` | Monthly free credits are account-level; do not use `modelFilter: "free"`. |
| GitHub Models | `https://models.github.ai` | Bearer GitHub token | Use `/catalog/models` for model discovery and `/inference/chat/completions` for chat; API is public preview and rate-limited. |
| SambaNova Cloud | `https://api.sambanova.ai/v1` | Bearer API key | Free/developer tiers are account-level; model IDs may differ from aggregator aliases. |
| Cloudflare Workers AI | `https://api.cloudflare.com/client/v4/accounts/<account_id>/ai` | Bearer API token | Set via `CLOUDFLARE_WORKERS_AI_BASE_URL`; uses `/models/search?format=openrouter` for discovery and `/v1/chat/completions` for chat. |
| OpenCode server | `http://127.0.0.1:4096/v1` | Local password/bearer if configured | Set `allowLocal: true`; start OpenCode server separately. |
| Gemini API | `https://generativelanguage.googleapis.com/v1beta` | `x-goog-api-key` header | Native adapter; OpenAI tool/image parity is intentionally limited in this release. |

## CLI/OAuth Tools

Gemini CLI, Codex CLI, Claude Code, and Antigravity may have useful local/headless modes, but proxying subscription OAuth credentials to third-party clients can violate provider terms. This project does not scrape credential stores by default. If you wrap a CLI, prefer a documented local server/API mode or explicit command execution under your own account.

## Adding A New OpenAI-Compatible Provider

Add a provider entry:

```json
{
  "id": "my-provider",
  "type": "openai-compatible",
  "baseUrl": "https://example.com/v1",
  "apiKeyEnv": "MY_PROVIDER_API_KEY",
  "modelsPath": "/models",
  "chatPath": "/chat/completions",
  "priority": 80
}
```

Use `baseUrlEnv` instead of `baseUrl` when the endpoint contains account-specific identifiers:

```json
{
  "id": "cloudflare-workers-ai",
  "type": "openai-compatible",
  "baseUrlEnv": "CLOUDFLARE_WORKERS_AI_BASE_URL",
  "apiKeyEnv": "CLOUDFLARE_API_TOKEN",
  "modelsPath": "/models/search?format=openrouter",
  "chatPath": "/v1/chat/completions",
  "optional": true
}
```

If the provider returns paid and free models together, set `modelFilter` to `free` or another substring. Prefer provider-specific pricing metadata when available, such as OpenRouter `pricing.prompt` and `pricing.completion`; for account-level free allocations such as Hugging Face credits, GitHub Models preview usage, SambaNova tiers, or Cloudflare Workers AI neurons, omit `modelFilter` unless model IDs themselves encode a useful subset.
