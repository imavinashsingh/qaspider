# Contributing to QASpider

Use Node 24.x, npm and Chromium. Read README.md, AGENTS.md and docs/DEVELOPMENT.md first. Keep changes local to the requested milestone and preserve role, tenant, build and origin isolation.

1. Install with `npm ci`, then `npx playwright install chromium`.
2. Add a failing behavioral test for a new feature or bug; implement the smallest fix.
3. Run `npm run typecheck`, `npm run build`, `npm test`, and `npm run test:smoke`.
4. Run `npm audit --audit-level=high` and `node scripts/check-release.mjs`.
5. For provider/process/context changes, run `npm run verify:provider` before and after the change. Preserve private receipts and review the tracked hash manifest. Do not substitute fake results for provider verification.
6. Review `git diff --check`, the staged diff and ignored files. Never stage databases, traces, credentials, tokens or storage-state files. Do not edit migrations 001–005; add a new migration and persistence tests.

Describe the concrete problem, behavior, tests and limitations in your PR. Screenshots must have cleared token fragments and contain no credentials or account information. Keep dependency additions justified. The project uses Apache-2.0; contributions must be compatible with that license.

GitHub CI runs without provider credentials. It tests provider-independent synthetic contracts and deterministic browser execution. A maintainer must separately run actual Codex synthetic isolation before approving a release or adapter change. No push or package publication is part of the local verification workflow.

For Studio changes, include negative authentication/CSRF/project-path tests and tests for independent project reads/jobs. Use a temporary QASPIDER_STUDIO_HOME in tests so CLI registration never mutates a real user registry. Do not weaken the operator executable allowlist or replace explicit project IDs with a mutable global browser selection. See docs/STUDIO.md.
