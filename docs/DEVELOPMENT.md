# Development and reproducible validation

## Architecture

Core owns strict Zod contracts and policy. Storage owns SQLite repositories, immutable history and filesystem artifacts. Navigation owns safe Playwright observation/replay. QA owns requirements, approved plans and deterministic execution. Learning proposes scoped changes for owner review. Application coordinates jobs/onboarding. CLI, React viewer and MCP share these services. Providers return structured proposals only. No learning agent rewrites accepted requirements.

Migrations 001–005 remain immutable and checksummed. Build emits dist/ and copies SQL and viewer assets. Package entry points depend on that build. npm workspace packages and the root remain private: this beta is source-installable, not an npm release.

## Clean installation

Use a fresh checkout/copy containing tracked project files, never copy node_modules, dist, .qaspider, test-results or .env. Run from qaspider/:

```sh
npm ci
npm run typecheck
npm run build
npm test
npx playwright install chromium
npm run test:smoke
node dist/packages/cli/src/main.js init --workspace /tmp/qaspider-new-workspace
node dist/packages/cli/src/main.js doctor --workspace /tmp/qaspider-new-workspace
node dist/packages/cli/src/main.js onboard --workspace /tmp/qaspider-new-workspace --file examples/m4/onboarding.json
```

Doctor warnings for unset credential reference names are expected until authenticated mapping is configured. Values belong in an operator secret manager/environment, never JSON. On minimal Linux, install Chromium OS dependencies through system administration. Install/run with the same PLAYWRIGHT_BROWSERS_PATH. A preexisting service on 4317 causes smoke startup to fail; stop only your own benchmark. A viewer port conflict currently returns a generic navigation error: choose another --port.

## Reproducible measurements

```sh
npm run build
npx playwright test tests/smoke/readiness.spec.ts
npx playwright test tests/smoke/learning.spec.ts
```

readiness.spec.ts creates three independent workspaces, discovers depth-one guest navigation, explicitly approves verified edges, then starts a new CLI process with an unavailable provider to replay the Registration destination. It records durations, browser actions and requests in test-results/**/m5-benchmark.json. Every replay checks live preconditions and destination fingerprints. Discovery uses the harness browser; replay includes CLI/browser startup. Compare action/request reduction, not a universal latency speedup. Three local samples are not a scalability claim.

learning.spec.ts records discovery/change-review/promotion/replay/rollback timings and verifies a new consent dialog, persistence, unchanged requirements and the duplicate-email negative control. The negative control intentionally FAILs one assertion; the E2E test passes only if it detects it. Raw evidence remains ignored. Timing varies with CPU, Chromium, traces and filesystem.

The all-six replay gate uses the existing approved real-Codex M2 plan after reopening its private workspace in a new CLI process with Codex unavailable. It must run all six, not a selected subset. Synthetic CI plans are explicitly labeled and do not prove live model quality.

## CI and release

The workflow lives at repository-root .github/workflows/qaspider.yml, with qaspider as working-directory. Node 24, read-only permissions, pinned action commits, no persisted checkout credentials, no raw artifact upload or provider credentials. It runs install/typecheck/build/unit/integration/Chromium/audit/release-file checks. Validate YAML with actionlint; run the same commands locally. Hosted CI has not run until the repository owner explicitly pushes/enables it. Codex isolation remains an additional local gate because hosted runners have no installed/authenticated Codex assumption.

Run npm run verify:provider with QASPIDER_CODEX_BIN set to an absolute installed executable. It exercises the actual CLI against a synthetic local model endpoint and saves private tool/config/timeout/cancellation/context receipts. It does not call a real AI service. The runtime repeats its isolation gate before application context. Original M2 live planning evidence remains distinct.

No Claude or Gemini adapter is enabled. ProviderAdapter, FakeProvider and boundary contract tests remain available for future implementations. Future providers need their own synthetic CLI isolation evidence and strict output validation before receiving application data.

Run the explicit historical six-scenario gate only when its original benchmark workspace/approved plan exists and port 4317 is free:

```sh
node scripts/verify-approved-replay.mjs --workspace .qaspider/m1-reconciliation --plan a85052bb-fef6-4ffa-8151-36df0b2b303a
```

It starts its own local benchmark, passes a fresh fixture token privately, executes all six in a new process, verifies unchanged requirements/plan hash and a provider-invocation canary, then stops the benchmark. Public clean checkouts do not contain that private historical database; use the Chromium suite for a reproducible synthetic-plan equivalent. `node scripts/verify-clean-install.mjs` copies only Git-listed project sources to /tmp, installs fresh dependencies with a separate cache, verifies build/tests/init/doctor/onboarding and removes the temporary copy. These verification scripts use no real model calls.

M5.1 adds packages/studio with a separate global registry/auth/settings database; see STUDIO.md. Public view/studio commands use cookie login. Legacy bearer-only project HTTP servers remain private internal backends and regression harnesses; their tokens are never exposed by Studio.
