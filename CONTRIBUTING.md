# Contributing

## Development Setup

```bash
npm ci
npm run build
npm test
npm run smoke
```

## Pull Requests

Before opening a PR, run:

```bash
npm run build
npm run typecheck
npm test
npm run smoke
npm audit --audit-level=moderate
```

## Provider Contributions

Provider integrations should prefer official API keys or documented local/server endpoints. Do not add OAuth credential scraping, hidden token cache reads, or multi-account pooling designed to bypass provider terms or quotas.

## Secrets

Never commit `.env`, provider API keys, bearer tokens, OAuth tokens, real request payloads containing sensitive data, or local account files.
