# QASpider — M0 foundation

Local-first QA foundation following the approved QASpider V2 architecture. **Only M0 is implemented.** There is no navigation mapper, story executor, dashboard, real AI adapter, or MCP server yet. The fake provider returns explicitly synthetic proposals for tests; it does not test applications.

## Requirements and commands

Use Node **24.x** and npm. From this directory:

```sh
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:smoke
```

On a minimal Linux host, Chromium may need OS dependencies (`npx playwright install-deps chromium`). Install them through your normal system administration process. To use a custom browser cache, set the same `PLAYWRIGHT_BROWSERS_PATH` during installation and smoke execution. The implementation validation used `/tmp/qaspider-playwright`.

```sh
node dist/packages/cli/src/main.js init --workspace /tmp/my-qa-workspace
node dist/packages/cli/src/main.js doctor --workspace /tmp/my-qa-workspace
```

`npm run cli -- init` runs the source CLI. After installation and build, `node_modules/.bin/qaspider` is the workspace CLI. `init` supports `--workspace`, `--name`, and an exact `--origin` (default `http://127.0.0.1:4317`). Repeating identical initialization preserves configuration. `doctor` reports schema, settings, quota metadata, and missing credential-reference **names**, never their values. Unset credentials are warnings because M0 never executes authentication against an application. Neither command calls an AI provider or an external application.

Initialization creates `.qaspider/memory.db` and `.qaspider/artifacts/`. Three role profiles reference guest access or `QASPIDER_ADMIN_EMAIL`, `QASPIDER_ADMIN_PASSWORD`, `QASPIDER_USER_EMAIL`, and `QASPIDER_USER_PASSWORD`. Do not put credentials into source files or SQLite. Configure actual permitted test credentials outside version control when future execution features are available.

## Modules

| Module | M0 responsibility |
| --- | --- |
| `packages/core` | Strict runtime schemas, scoped approval contracts, policy, provider boundary, fake provider, repository/storage interfaces |
| `packages/storage` | Checksummed SQL migration, SQLite repositories/transactions, private artifact files and lifecycle |
| `packages/cli` | Initialization and diagnostics |
| `apps/benchmark` | Loopback fixture application with registration, login, role authorization, setup/reset/cleanup |

The root TypeScript build emits `dist/` and copies migrations alongside compiled storage. Workspace package entry points require this build. SQLite starts with applications, environments, role profiles, settings, artifact metadata, and migration history only. Navigation/scenario/run/learning tables and FTS are deferred.

## Local benchmark

```sh
BENCHMARK_FIXTURE_TOKEN=local-test-only-token npm run benchmark
```

Open `http://127.0.0.1:4317`. Seed users are `admin@example.test` and `user@example.test`, both with the **benchmark-only** password `benchmark-password`. New registrations always get the user role. Accounts and sessions are in memory and reset on process restart; QASpider workspace configuration is persisted separately in SQLite.

Fixture endpoints require `x-fixture-token` and accept POST only:

- `/__fixtures/reset`: reset seeds and sessions; no body required.
- `/__fixtures/setup`: JSON `{ "email": "fixture@example.test", "role": "user" }`; uses the benchmark password.
- `/__fixtures/cleanup`: JSON `{ "email": "fixture@example.test" }`; idempotent for missing fixtures and refuses seed deletion.

Without an explicit token the process generates an unreported token, making fixture HTTP calls unavailable to the user. The benchmark binds only `127.0.0.1`, checks Host/Origin, and never connects to external services. It is an isolated test target, not a production authentication service. Do not use real credentials or expose it through a proxy/tunnel.

## Safety and artifact behavior

- HTTP(S) origins must be declared exactly; credentials in URLs and unknown actions are rejected. State-changing action permissions bind to action kind and origin. Production writes remain locked off in M0 even if a caller supplies an enable flag.
- Navigation batch and individual business-rule/security approval schemas are contracts only. M3 must check each candidate's replay, safety, scope, authoritative source, and approval before promotion.
- Provider results are strict, bounded proposal data with validated provenance. No returned text is executed. The fake provider is always synthetic. There is no Codex invocation; M2 must prove tool/config/MCP/hook isolation on synthetic data before admitting application data.
- Managed artifact defaults: **14 days**, **1 GiB per run**, **10 GiB globally**, full local traces enabled. Configure through the typed `SettingsRepository.setSettings` API; no settings UI is implemented. Retention changes apply to newly created artifacts.
- `ArtifactStore.put` prunes expired **inactive** artifacts before quota allocation. Call `finishRun` after a run is complete; active artifacts are never automatically pruned. `prune` can also be called explicitly. Quota exhaustion fails the write and does not evict unexpired evidence. Deletion/expiry preserve metadata tombstones.
- Files use mode `0600`, directories `0700`; symlink paths and traversal are rejected. SQLite IMMEDIATE transactions serialize allocation. Physical orphan files left by an abrupt crash count toward global quota and require operator reconciliation; they are not silently deleted. An interrupted active run needs explicit lifecycle reconciliation before expiry cleanup.
- Raw traces may contain cookies, page content, and request data. They stay local, are excluded from provider contexts, and must not be committed. M0 defines no MCP evidence export. Playwright's development smoke traces live separately in ignored `test-results/` and are not managed workspace artifacts.
- Smoke tests start their own compiled benchmark, use separate guest/admin/user contexts, assert backend denial, clean fixtures, and retain local traces. No existing server is reused.

## Remaining milestones

M1: bounded mapping and persistent navigation with corresponding UI. M2: story planning/execution, isolated real Codex adapter, Test Studio and reports. M3: governed learning, scoped batch navigation approval, individual expectation approval, Memory Center. M4: **MCP TypeScript SDK v2**, interoperability/release hardening, Overview and remaining configuration UI. No MCP package is installed in M0.

Licensed under Apache-2.0; see `LICENSE`.
