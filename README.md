# QASpider — Story-driven QA

Local-first QA following the approved QASpider V2 architecture. **M0, M1 and M2 are implemented.** QASpider maps safe navigation into SQLite, verifies candidate transitions by replay, accepts explicit batch approval, and replays approved paths without AI. The React Navigation Graph displays actual persisted records. M2 adds reviewed story plans, an isolated Codex CLI planning adapter, deterministic scenario execution, Test Studio and persisted Test Runs. MCP and learning agents remain deferred.

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

Open the viewer URL printed by `view`. Its fragment carries a local access token that the browser moves into session storage and removes from the address bar. Treat the full bootstrap URL as private. Never distribute reusable access tokens in public links or shared screenshots. If a bootstrap URL was exposed, stop/restart the viewer to rotate its token and verify the old token is rejected. The browser removes the fragment after loading. For the local demo, the replacement URL is saved only in the ignored `0600` file `.qaspider/dashboard-access.json`. The server binds loopback, checks Host/Origin, requires the token for API requests, and provides no unrestricted filesystem or raw-trace access.

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
| `packages/qa` | Scoped planning context, approved scenario execution, owned fixtures, jobs and protected reports API |
| `packages/providers` | Real Codex planning adapter and synthetic isolation gate |
| `packages/cli` | Workspace/navigation commands, stories, plan review/approval, test execution/replay, reports and provider diagnostics |
| `apps/viewer` | React/Vite Navigation Graph, Test Studio and Test Runs backed by actual SQLite records |
| `apps/benchmark` | Loopback navigation/authentication fixture with controlled test-only endpoints |

The build emits `dist/`, copies SQL migrations and bundles the viewer. Initialization creates `.qaspider/memory.db` and private artifact storage. Migration **001** is unchanged. Migration **002** adds scopes, logical locations, states, actions, transitions, navigation runs, verification attempts and navigation approval audit records. M0 databases upgrade without replacing existing configuration. Migration **003** adds immutable story/requirement and plan revisions, explicit approvals, scenario results/attempts/assertions, fixture reservations and durable job status. Approved proposals contain the exact scenario definitions; each run pins a plan revision and its content hash. Migrations 001/002 remain unchanged. Learning and FTS are deferred.

Managed artifacts default to **14-day retention**, **1 GiB/run**, **10 GiB/workspace** and local trace capture. Configure via `SettingsRepository.setSettings`. Navigation records sanitized semantic observations, masked screenshots, explicit replay proof and local traces. The viewer displays JSON evidence and conditions; screenshots are retained as referenced artifacts. Raw trace downloads are denied by the viewer because traces can contain cookies/request data. They remain local private artifacts, never provider context or Git content.

`ArtifactStore.put` prunes expired inactive artifacts before allocation. Navigation completes artifact lifecycle automatically on normal completion, failure, budget stop and cancellation. Metadata tombstones survive expiry/deletion. Active artifacts from abrupt process termination and physical orphan files require operator reconciliation; no automatic interrupted-run resumption is implemented. Quota exhaustion fails evidence collection rather than evicting unexpired history. Development smoke traces/workspaces under ignored `test-results/` are separate from managed workspace retention.

Files use `0600`, private directories `0700`; symlink/traversal checks and SQLite IMMEDIATE transactions protect artifact allocation. `doctor` reports missing credential-reference names, never values. Environment variables or storage-state files remain outside graph memory. Redaction relies on declared private areas, known credentials/session values and semantic extraction; inspect application-specific privacy needs before recording data.

## Benchmark fixtures and validation

Fixture endpoints require `x-fixture-token`, accept POST only and exist only in the local benchmark:

- `/__fixtures/reset`: reset accounts, sessions, counters and navigation variation.
- `/__fixtures/setup`: `{ "email": "fixture@example.test", "role": "user" }`; creates a fixture with the benchmark password.
- `/__fixtures/cleanup`: `{ "email": "fixture@example.test" }`; idempotent and refuses seed deletion.
- `/__fixtures/stats`: inspect registration/destructive-visit counters.
- `/__fixtures/change`: `{ "aboutTitle": "Changed destination" }` or `{ "duplicateEmailDefect": true }`; inject a controlled navigation or duplicate-email defect. Reset restores correct behavior; the duplicate defect never overwrites seed accounts.

Without an explicit fixture token, the benchmark generates an unreported token. Smoke tests start their own server and never reuse an existing application. Acceptance covers independent guest/admin/user discovery, volatile query deduplication, actual process restart, AI-free CLI replay, batch approval through the viewer, live destination mismatch, scoped evidence, limits/cancellation, backend role denial and storage-state secret isolation. Test outputs include SQLite memory, proof JSON, a graph UI screenshot and Chromium traces.

Historical M0 validation is in `validation/m0-report.json`. M1 validation and its exact file inventory are in `validation/m1-report.json`.

## Story planning, review and execution (M2)

Use the same workspace/build/tenant/roles as your approved M1 map. `examples/m2/context.json` uses the acceptance workspace's `m1-smoke` build; adjust it to your mapped build before starting a new demo. `examples/m2/registration.md` is an explicit six-criterion benchmark story, and `examples/m2/policy.json` declares the permitted registration/read endpoints and owned fixture lifecycle. Review these files for your target. Do not put credentials in stories, plans or policy files.

The existing signed-in **Codex CLI** is used for planning only. Set `QASPIDER_CODEX_BIN` to its absolute executable path if it is absent from PATH. `QASPIDER_CODEX_MODEL` defaults to `gpt-6.1-sol`. The installed CLI must support the required flags/features; unsupported versions fail closed. Sign in through your normal Codex CLI workflow. QASpider copies only its authentication file into a fresh private temporary Codex home and removes that worker afterwards. No direct API-key setup or app credentials are passed to the child.

```sh
node_modules/.bin/qaspider provider validate
node_modules/.bin/qaspider story import --file examples/m2/registration.md --context examples/m2/context.json
node_modules/.bin/qaspider story list
node_modules/.bin/qaspider plan generate --story STORY_REVISION_ID --policy examples/m2/policy.json
node_modules/.bin/qaspider plan show --plan PLAN_REVISION_ID
```

The ID labels are placeholders. Planning validates the real executable against a synthetic loopback Responses endpoint first. The check verifies ignored user/project configuration, disabled MCP/tools/hooks, structured output, a controlled worker directory, process timeout and cancellation. The captured model request must expose **zero tools** and no configuration canary. Each adapter instance validates before receiving application context and checks the executable hash before its planning call. Before future adapter, isolation or context-construction changes, run `npm run verify:provider` both before and after editing. This rebuilds and exercises the actual CLI against a synthetic loopback endpoint, retains private request/process receipts under `.qaspider/provider-validation/`, verifies process exit after timeout/cancellation, and captures synthetic credential/raw-artifact redaction evidence. `validation/m2-isolation-recheck.json` contains hashes and receipt references; the original real-planning validation record remains unchanged. These verification receipts are developer evidence, separate from managed run artifacts; retain them privately and do not publish raw requests or replace runtime validation with a saved result. The acceptance validation record is in `validation/m2-provider-validation.json`; it is evidence, not a reusable bypass token. Current supported CLI flags are documented in [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference) and [noninteractive use](https://learn.chatgpt.com/docs/non-interactive-mode); installed capability checks govern execution.

The provider receives bounded, sanitized requirement and navigation summaries, relevant state IDs, declared locator/endpoint permissions and approved-path availability. Raw artifacts, cookies, storage-state files and application credential values are excluded. Stories and page content are untrusted data. The adapter cannot execute returned text; only strict typed proposals reach review. Synthetic test providers are explicitly labeled in plans/reports and are never the dashboard's default provider.

If a relevant feature is unknown and the reviewed policy enables `discovery`, planning can invoke targeted safe exploration: depth 2, at most 12 states, 60 actions, 200 requests and 30 seconds. It filters eligible navigation by story-title keywords and preserves the full M1 origin/authentication rules. New edges remain unapproved; review them in Navigation Graph before execution. Missing scopes require explicit initial mapping. Retrieval uses scoped keyword matching rather than embeddings or AI-driven exploration.

Review/edit the proposal in Test Studio or save an edited **proposal object** to a JSON file:

```sh
node_modules/.bin/qaspider plan edit --plan PLAN_REVISION_ID --file reviewed-proposal.json
node_modules/.bin/qaspider plan approve --plan PLAN_REVISION_ID --reviewer your-name --requirements REQUIREMENT_ID_1,REQUIREMENT_ID_2
node_modules/.bin/qaspider test run --plan PLAN_REVISION_ID
node_modules/.bin/qaspider report --run RUN_ID
node_modules/.bin/qaspider test replay --plan PLAN_REVISION_ID --scenarios SCENARIO_ID --no-ai
```

Every edit creates an immutable revision; approval pins the latest displayed revision and hash. Each cited requirement needs explicit approval, including any AI-inferred expectation. Source Markdown, line references and earlier revisions remain intact. A new story revision never changes earlier approved runs. The executor never calls a provider; `test run` and `test replay` are both deterministic. CLI execution returns nonzero for FAIL/BLOCKED/INCONCLUSIVE while preserving the full report.

Execution reuses approved M1 paths and checks live entry/transition/destination conditions. Each attempt starts a fresh role session; production is blocked. Only approved typed fills/clicks and text/visibility/HTTP-status assertions are supported. POST permission is limited to an exact declared endpoint during its approved submit action; read assertions require exact scoped GET grants and reject redirects. Unknown form submissions are blocked. Inputs use unique reserved fixture emails and generated passwords; cleanup always runs, including on failure/cancellation. Only owned fixture reservations can be cleaned. Cleanup errors leave an `orphan` reservation and classify the attempt BLOCKED for operator reconciliation.

Reports retain PASS, FAIL, BLOCKED, INCONCLUSIVE, FLAKY and NOT RUN. A missing prerequisite or policy denial is BLOCKED; an automation/evidence uncertainty is INCONCLUSIVE; contradictory explicit behavior is FAIL. An approved optional retry can identify FLAKY when completed attempts disagree. Unselected/cancelled scenarios remain NOT RUN. PASS requires every approved assertion, its exact expected value and retained evidence. Screenshots mask inputs/email; full local traces remain private and are referenced in reports, never exported by the viewer. Test artifacts use M0 quotas/retention, with child navigation artifacts charged to the parent test-run budget; a quota/evidence failure cannot become PASS.

Start `qaspider view`, open its full token URL, and use **Test Studio** to enter a story, select scoped roles, review permissions, generate a plan, edit scenarios and approve requirements/the exact plan. **Test Runs** shows persisted progress, assertions, fixtures, screenshots and trace references. No metrics/results are simulated. The fixture token and authentication reference values must be set in the viewer's environment before starting execution. Progress polling and cancellation apply to jobs started by that viewer process.

The earlier `--scenarios registration-valid` replay intentionally selected one scenario; the other five were correctly NOT RUN, not failures. A later fresh CLI process replayed **all six approved scenarios** without `--scenarios`: all six passed, with a configured provider canary proving no Codex invocation. See `validation/m2-full-suite-replay.json`.

`validation/m2-demo-evidence.json` records the actual Codex acceptance run: six PASS on the correct benchmark, five PASS/one FAIL with the duplicate defect, and a PASS/remaining NOT RUN on an AI-free replay after reopening SQLite. `validation/m2-defect-report.json` retains the complete defect report, `m2-generated-plan.json` the original draft, and `m2-plan-review.json` the explicit review decision. Private SQLite/screenshots/traces are under the workspace named in the evidence file. The negative M1 guest probe was reverified and reapproved while preserving its failed attempt and evidence; see `validation/m2-preflight.json`.

Limitations: typed browser actions and explicitly declared HTTP status checks are the M2 execution vocabulary; no arbitrary JS, shell, database assertions, MFA automation or general fixture adapters are included. Fixture endpoints follow the benchmark setup/cleanup contract and must be explicitly configured for another authorized target. Abrupt process termination needs operator reconciliation of running jobs/runs, active artifacts and reservations; automatic crash resumption is deferred. Privacy masking still depends on declared private areas and known secrets, and full traces require local care. Requirements are not automatically changed when a product fails.

## Deferred

M3: learning agents, build-change analysis and governed memory promotion/revision workflows. M4: **MCP TypeScript SDK v2**, remaining dashboard screens and release hardening. No M3/M4 implementation or MCP dependency is included.

Licensed under Apache-2.0; see `LICENSE`.
