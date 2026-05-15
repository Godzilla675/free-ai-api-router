# CI Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CI/manual GitHub Actions, smoke testing, and public repo production-readiness metadata.

**Architecture:** Use GitHub Actions for automated verification and a Node smoke script for local/CI runtime checks. Keep workflows deterministic and independent of external AI provider credentials.

**Tech Stack:** GitHub Actions, Node 24, npm, TypeScript, Vitest, built-in Node HTTP/fetch APIs.

---

## File Structure

- `.github/workflows/ci.yml`: PR, push, and manual CI.
- `.github/workflows/codeql.yml`: CodeQL security analysis.
- `.github/dependabot.yml`: dependency update automation.
- `.github/ISSUE_TEMPLATE/*.md`: public issue templates.
- `.github/pull_request_template.md`: PR checklist.
- `scripts/smoke-test.mjs`: built-server smoke test with temporary config.
- `package.json`: add `smoke` script and repository metadata.
- `README.md`: add badges and CI/smoke instructions.
- `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`: public repo hygiene.

## Tasks

### Task 1: Smoke Test

- [ ] Write a failing smoke command by adding `npm run smoke` to scripts before the script exists.
- [ ] Run `npm run smoke` and verify it fails because `scripts/smoke-test.mjs` is missing.
- [ ] Implement `scripts/smoke-test.mjs` to build a temp config, start `dist/index.js`, call `/health` and `/v1/models`, then cleanly stop the server.
- [ ] Run `npm run build && npm run smoke` and verify both pass.

### Task 2: GitHub Actions

- [ ] Add `.github/workflows/ci.yml` with `pull_request`, `push`, and `workflow_dispatch` triggers.
- [ ] Add `.github/workflows/codeql.yml` with PR, push, scheduled, and manual triggers.
- [ ] Add `.github/dependabot.yml` for npm and GitHub Actions weekly updates.
- [ ] Run local YAML/file sanity checks by reading the generated files and running the same npm commands used in CI.

### Task 3: Public Repo Hygiene

- [ ] Add MIT license, security policy, contribution guide, issue templates, and PR template.
- [ ] Update README with badges and CI/smoke instructions.
- [ ] Add package repository, bugs, and homepage metadata.
- [ ] Run `npm run build`, `npm run typecheck`, `npm test`, `npm run smoke`, and `npm audit --audit-level=moderate`.

### Task 4: Commit And Push

- [ ] Check `git status --short` and review changed files.
- [ ] Commit with message `Add CI and production readiness`.
- [ ] Push to `origin/main`.
- [ ] Verify remote branch and provide the repo Actions URL.

## Self-Review

The plan covers PR/manual Actions, production-readiness final touches, local verification, commit, and push. It avoids external provider calls in CI and does not add publishing/release automation beyond the requested readiness baseline.
