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

Provider integrations should prefer official API keys, documented local/server endpoints, or operator-authorized token/credential files (e.g. for CLIProxyAPI parity integrations). Multi-account scheduling and pooling are supported, provided they are explicitly configured by the operator and avoid implicit scanning of unrelated system directories or browser storage.

## Secrets

Never commit `.env`, provider API keys, bearer tokens, OAuth tokens, real request payloads containing sensitive data, or local account files.
