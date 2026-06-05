# Security Policy

## Supported Versions

Security fixes target the `main` branch until tagged releases exist.

## Reporting A Vulnerability

Use GitHub private vulnerability reporting if available, or contact the repository owner privately. Do not open a public issue for vulnerabilities involving authentication bypass, provider credentials, request smuggling, SSRF, token leakage, or dependency compromise.

Do not include real API keys, OAuth tokens, account IDs, or sensitive prompts in reports. Use redacted logs and synthetic examples.

## Security Boundaries

This project supports official provider API keys, documented local/server endpoints, and operator-authorized token/credential files (e.g. for CLIProxyAPI parity integrations). While interactive OAuth device login or multi-account scheduling/pooling may be configured, the repository strictly forbids scanning unrelated home/profile directories or extracting credentials from unrelated applications without explicit operator action. All credentials must be managed securely through operator-owned configuration.
