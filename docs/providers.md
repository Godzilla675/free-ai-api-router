# Provider Notes

## Recommended MVP Providers

- Groq: OpenAI-compatible, strong free developer tier, published rate limits, good latency.
- Cerebras: OpenAI-compatible, fast inference, useful free limits for selected models.
- OpenRouter: OpenAI-compatible aggregator with `:free` models; availability and limits vary.
- NVIDIA NIM: OpenAI-compatible hosted development APIs for many catalog models; quotas vary by account/model.
- Gemini API: Official API key path with dynamic `models` discovery and strong multimodal support.
- OpenCode server or Zen-compatible endpoint: useful when local OpenCode exposes `/v1` endpoints.

## Optional Providers

- iFlow: keep optional because iFlow CLI/API availability has changed. Verify endpoint, account, and terms before relying on it.
- Hugging Face router, GitHub Models, DeepInfra, Together, Fireworks, and SambaNova: supported by the OpenAI-compatible configuration pattern when their endpoint exposes `/v1/models` and `/v1/chat/completions`; they are not preconfigured in `config.example.json`.
- Cloudflare Workers AI: usually needs a custom adapter or a Worker that exposes OpenAI-compatible endpoints.
- CLIProxyAPI, LiteLLM, 9Router, OmniRoute: configure as upstream OpenAI-compatible local relays with `allowLocal: true`. This router can sit in front of them for additional policy, health, and aliases.

## Known Endpoint Patterns

| Provider | Base URL Pattern | Auth | Notes |
| --- | --- | --- | --- |
| Groq | `https://api.groq.com/openai/v1` | Bearer API key | Clear free-tier rate limits; good first provider. |
| Cerebras | `https://api.cerebras.ai/v1` | Bearer API key | Fast inference; free limits vary by model/account. |
| OpenRouter | `https://openrouter.ai/api/v1` | Bearer API key | Use `modelFilter: "free"`; free model availability changes. |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | Bearer API key | Hosted dev APIs; model catalog/quotas vary. |
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

If the provider returns paid and free models together, set `modelFilter` to `free` or another substring. There is no separate `freeOnly` enforcement flag; filtering is intentionally explicit and string-based because provider metadata is inconsistent.
