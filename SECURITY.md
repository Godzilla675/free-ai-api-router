# Security Policy

## Supported Versions

Security fixes target the `main` branch until tagged releases exist.

## Reporting A Vulnerability

Use GitHub private vulnerability reporting if available, or contact the repository owner privately. Do not open a public issue for vulnerabilities involving authentication bypass, provider credentials, request smuggling, SSRF, token leakage, or dependency compromise.

Do not include real API keys, OAuth tokens, account IDs, or sensitive prompts in reports. Use redacted logs and synthetic examples.

## Security Boundaries

This project is intended to use official provider API keys or documented local/server endpoints. It does not support scraping OAuth token caches or pooling subscription accounts to bypass provider limits.
