# CI And Production Readiness Design

## Goal

Add public-repository production readiness for Free AI API Router by making tests run automatically on pull requests, pushes to `main`, and manual dispatch, then adding security and maintenance metadata expected for a public project.

## Scope

This pass adds repository automation and hygiene, not new router provider behavior. It keeps runtime dependencies unchanged and avoids release publishing until the project has explicit release requirements.

## CI Design

The main CI workflow runs on `pull_request`, `push` to `main`, and `workflow_dispatch`. It uses Node 24, installs dependencies with `npm ci`, runs `npm run build`, `npm run typecheck`, `npm test`, `npm audit --audit-level=moderate`, and a smoke test against the built HTTP server. The smoke test uses a generated local config with no real provider keys and exercises `/health` plus authenticated `/v1/models` so CI does not depend on external AI APIs.

## Security Automation

CodeQL runs on pull requests, pushes to `main`, weekly schedule, and manual dispatch. Dependabot checks npm and GitHub Actions weekly. `SECURITY.md` documents responsible disclosure and warns users not to file secrets in public issues.

## Public Repo Hygiene

Add MIT `LICENSE`, `CONTRIBUTING.md`, issue templates, a PR template, badges in `README.md`, and package metadata. These files make the public repository easier to contribute to and safer to operate without changing runtime behavior.

## Verification

Local verification requires `npm run build`, `npm run typecheck`, `npm test`, `npm run smoke`, and `npm audit --audit-level=moderate`. After push, the GitHub Actions workflow should be visible under the repository Actions tab and can also be run manually.
