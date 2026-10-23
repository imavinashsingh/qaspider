# QASpider — Persistent Navigation Memory

Local-first QA following the approved QASpider V2 architecture. **M0 and M1 are implemented.** QASpider maps safe navigation into SQLite, verifies candidate transitions by replay, accepts explicit batch approval, and replays approved paths without AI. The React Navigation Graph displays actual persisted records. Story testing, real AI providers, MCP and learning agents remain deferred.

## Install and verify

Use Node **24.x** and npm:

```sh
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:smoke
```

On minimal Linux systems, Chromium may need OS dependencies (`npx playwright install-deps chromium`) installed through your normal system administration process. Set the same `PLAYWRIGHT_BROWSERS_PATH` for installation and execution when using a custom cache; implementation validation used `/tmp/qaspider-playwright`. Build before smoke tests: the harness starts the compiled benchmark and serves the built viewer.

## Map the local benchmark

Start the fixture application in a separate terminal:

```sh
BENCHMARK_FIXTURE_TOKEN=local-test-only-token npm run benchmark
```

Open `http://127.0.0.1:4317`. Seed accounts are `admin@example.test` and `user@example.test`, both with the **benchmark-only** password `benchmark-password`. Accounts/sessions are in memory; QASpider's navigation memory is separately persisted on disk. Never use real credentials in this benchmark or expose it through a proxy/tunnel.

From the project root:

```sh
node_modules/.bin/qaspider init
node_modules/.bin/qaspider doctor
node_modules/.bin/qaspider map http://127.0.0.1:4317/ --role guest --build demo-1 --config examples/navigation-guest.json --depth 2 --actions 800
```

For authenticated mapping, configure the referenced environment variables in your terminal or secret manager. These values are for the benchmark only:

```sh
export QASPIDER_ADMIN_EMAIL=admin@example.test
export QASPIDER_ADMIN_PASSWORD=benchmark-password
export QASPIDER_USER_EMAIL=user@example.test
export QASPIDER_USER_PASSWORD=benchmark-password
node_modules/.bin/qaspider map http://127.0.0.1:4317/ --role admin --build demo-1 --config examples/navigation-admin.json --depth 2 --actions 800
node_modules/.bin/qaspider map http://127.0.0.1:4317/ --role user --build demo-1 --config examples/navigation-user.json --depth 2 --actions 800
node_modules/.bin/qaspider view
```

Open the viewer URL printed by `view`. Its fragment carries a local access token that the browser moves into session storage and removes from the address bar. Treat the full bootstrap URL as private. The server binds loopback, checks Host/Origin, requires the token for API requests, and provides no unrestricted filesystem or raw-trace access.

Each mapping command gets a fresh browser context. Authentication requires explicit URL, exact permitted POST endpoint, field/submit locators, and an authenticated-ready assertion. Only that endpoint may receive a POST during bootstrap; discovery cannot submit forms. Imported `storage-state` roles resolve their file via an environment-variable reference, check stored origins, and require a ready assertion. No cookies, storage-state files, input values or credential values are stored in the graph. For a non-public tenant, an explicit `tenantReady` locator assertion is mandatory; it must identify the intended account/tenant. Tenant switching itself is not implemented.

For another permitted QA application, use `init --name "Application" --origin http://localhost:3000 --workspace /path/to/workspace` and supply explicit application-specific navigation/authentication configuration. Existing repository interfaces can configure additional environments and roles. `init` retains the internal application ID `benchmark`; the supplied name/origin identify your application. Do not point discovery at an application you have not authorized.

## Inspect, approve and replay

```sh
node_modules/.bin/qaspider graph
node_modules/.bin/qaspider graph --role guest --build demo-1
```

`graph` without a role lists known scopes. With a role it returns logical locations, semantic states, actions/transition conditions, verification status, scoped run history and approval history. Use state and transition IDs from this output or the viewer:

```sh
node_modules/.bin/qaspider approve --role guest --build demo-1 --transitions TRANSITION_ID_1,TRANSITION_ID_2 --reviewer your-name
node_modules/.bin/qaspider path --role guest --build demo-1 --from SOURCE_STATE_ID --to DESTINATION_STATE_ID
node_modules/.bin/qaspider replay --role guest --build demo-1 --from SOURCE_STATE_ID --to DESTINATION_STATE_ID --no-ai
```

These are ID placeholders, not commands to run literally. The viewer also supports selecting verified transitions and approving a reviewed batch. Every batch is atomic: every item must belong to the exact scope, be safe, have successful replay verification, and retain available supporting evidence. One invalid item rejects the entire batch. Business/security expectation changes cannot be approved through navigation tools.

Replay uses approved edges only, checks live normalized URL, visible headings and semantic state before/after every action, and records proof for each step. A mismatch fails the replay and makes the edge suspect; it does not change requirements or silently repair the path. Weighted path selection penalizes past failures and older verification. Source states away from the seed require an approved entry path too. No provider is instantiated by navigation commands; `--no-ai` documents the unconditional behavior.

## Scope, normalization and budgets

All graph data is partitioned by **Application × Environment × Role × Tenant × Build × Feature flags**. Commands accept `--workspace`, `--environment` (default `development`), `--role`, `--tenant` (default `public`), `--build` (default `development`), and optional JSON `--flags`. A scope's seed/normalization/auth-navigation configuration is immutable; use a new build for changed configuration.

Semantic fingerprints contain normalized URL, visible headings/dialogs, and named controls including expanded/selected/disabled/checked state. Input values and arbitrary body text are excluded. Email addresses, known session/credential values, ISO UTC timestamps and UUIDs are masked. Query parameters are omitted unless listed in `relevantQueryKeys`; known volatile keys can be followed without becoming state identity. Sensitive query keys and URLs containing credentials are rejected. Configure `volatileSelectors` for app-specific changing UI and `privateSelectors` for content that must be excluded/masked. Hashes aid retrieval; live semantic cues and action eligibility still need verification. Normalization cannot establish business correctness.

Discovery follows eligible HTTP(S) links and explicitly configured `safeControls` only. Ambiguous locators, unknown form controls, download/new-window links, destructive labels/routes and unauthorized origins are refused. Prefer stable test IDs, then exact accessible roles/names. The live element and target are rechecked before clicking. Service workers and WebSockets are blocked; browser HTTP requests are origin/method restricted, including redirects. Safe classification cannot prove that an application's GET endpoint is side-effect-free; use only authorized development/QA targets. Production mapping/replay is blocked.

Default limits: depth **3**, **100 states**, **300 actions**, **3,000 HTTP requests**, **10 minutes**, **10-second action timeout**, and **1 second between actions**. Override with `--depth`, `--states`, `--actions`, `--requests`, `--timeout` (milliseconds), `--action-timeout`, or `--interval`. Restoring source paths, authentication actions and verification replays consume budget. Richer benchmark maps use the explicit 800-action limit above. A budget stop retains partial knowledge and reports `budget-exhausted`; Ctrl-C reports `cancelled`. Neither is a successful completed map. Unknown/ambiguous attempts retain evidence; a completed exploration job does not mean every control was explored or establish product test PASS results.

## Storage and evidence

| Module | Responsibility |
| --- | --- |
| `packages/core` | Validated scopes, policy, providers/fake provider, semantic normalization, graph contracts/pathfinding |
| `packages/storage` | Checksummed migrations, scoped SQLite repositories, artifact lifecycle and quota enforcement |
| `packages/navigation` | Bounded Chromium discovery, live replay, authentication bootstrap, protected viewer server |
| `packages/cli` | Initialization, diagnostics, mapping, graph/path inspection, batch approval, replay and viewer |
| `apps/viewer` | React/Vite Navigation Graph with real scope filters, state details, transitions, approval and evidence |
| `apps/benchmark` | Loopback navigation/authentication fixture with controlled test-only endpoints |

The build emits `dist/`, copies SQL migrations and bundles the viewer. Initialization creates `.qaspider/memory.db` and private artifact storage. Migration **001** is unchanged. Migration **002** adds scopes, logical locations, states, actions, transitions, navigation runs, verification attempts and navigation approval audit records. M0 databases upgrade without replacing existing configuration. No story/scenario/learning/FTS tables are introduced.

Managed artifacts default to **14-day retention**, **1 GiB/run**, **10 GiB/workspace** and local trace capture. Configure via `SettingsRepository.setSettings`. Navigation records sanitized semantic observations, masked screenshots, explicit replay proof and local traces. The viewer displays JSON evidence and conditions; screenshots are retained as referenced artifacts. Raw trace downloads are denied by the viewer because traces can contain cookies/request data. They remain local private artifacts, never provider context or Git content.

`ArtifactStore.put` prunes expired inactive artifacts before allocation. Navigation completes artifact lifecycle automatically on normal completion, failure, budget stop and cancellation. Metadata tombstones survive expiry/deletion. Active artifacts from abrupt process termination and physical orphan files require operator reconciliation; no automatic interrupted-run resumption is implemented. Quota exhaustion fails evidence collection rather than evicting unexpired history. Development smoke traces/workspaces under ignored `test-results/` are separate from managed workspace retention.

Files use `0600`, private directories `0700`; symlink/traversal checks and SQLite IMMEDIATE transactions protect artifact allocation. `doctor` reports missing credential-reference names, never values. Environment variables or storage-state files remain outside graph memory. Redaction relies on declared private areas, known credentials/session values and semantic extraction; inspect application-specific privacy needs before recording data.

## Benchmark fixtures and validation

Fixture endpoints require `x-fixture-token`, accept POST only and exist only in the local benchmark:

- `/__fixtures/reset`: reset accounts, sessions, counters and navigation variation.
- `/__fixtures/setup`: `{ "email": "fixture@example.test", "role": "user" }`; creates a fixture with the benchmark password.
- `/__fixtures/cleanup`: `{ "email": "fixture@example.test" }`; idempotent and refuses seed deletion.
- `/__fixtures/stats`: inspect registration/destructive-visit counters.
- `/__fixtures/change`: `{ "aboutTitle": "Changed destination" }`; test live replay rejection without changing the URL.

Without an explicit fixture token, the benchmark generates an unreported token. Smoke tests start their own server and never reuse an existing application. Acceptance covers independent guest/admin/user discovery, volatile query deduplication, actual process restart, AI-free CLI replay, batch approval through the viewer, live destination mismatch, scoped evidence, limits/cancellation, backend role denial and storage-state secret isolation. Test outputs include SQLite memory, proof JSON, a graph UI screenshot and Chromium traces.

Historical M0 validation is in `validation/m0-report.json`. M1 validation and its exact file inventory are in `validation/m1-report.json`.

## Deferred

M2: story planning/execution, Test Studio/reports and a real Codex adapter after synthetic isolation-capability validation. M3: learning agents, build-change analysis and broader governed memory revision workflows. M4: **MCP TypeScript SDK v2**, remaining dashboard screens and release hardening. No M2–M4 implementation or MCP dependency is included.

Licensed under Apache-2.0; see `LICENSE`.
