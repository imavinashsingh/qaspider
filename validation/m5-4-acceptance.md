# M5.4 acceptance audit

Status: complete. Actual headed Chromium exercised an isolated Studio on port 4330 and an owned benchmark on port 4337. The existing Studio on 4319 was left untouched. No M6 work, push or publication occurred.

## Actual dynamic story workflow

All stories were entered through Studio, generated with the real Codex adapter, reviewed/edited as runtime data, explicitly approved, executed, inspected and replayed. Synthetic regression planners are separate and clearly labeled in their tests.

| Story | Selected final revision | Initial execution | AI-free repeat | Full restart, Codex absent |
| --- | --- | --- | --- | --- |
| Registration | `e554521c-2d03-4b0a-93b9-14df4ae61050` | 3 PASS | 3 PASS | 3 PASS |
| Login and Dashboard access | `217f4de9-a139-4bb4-9026-f79d444df085` | 6 PASS | 6 PASS | 6 PASS |
| Navigation/role visibility | `9fd6d61b-17fe-4961-9f82-98018fce0c20` | 7 PASS | 7 PASS | 7 PASS |

The complete selected scenario suites ran each time; none was silently reduced to one case. Intermediate saved revisions remain historical and may lack endpoint permissions. They are not represented as the three executable final revisions above. All owned fixtures were cleaned.

The original authentication audit inputs produced four PASS and two FAIL results, reproduced on AI-free replay and retained. The benchmark rejects malformed email before checking credentials and returns 401 for anonymous admin-API access. An explicit source revision corrected those audit expectations against the benchmark contract. Human review used an owned reserved nonexistent address for invalid login; valid-looking literal addresses remain rejected. The original requirements, approved plan and failed evidence were not overwritten. Navigation review removed redundant clicks after approved destination replay without removing or changing assertions.

## No source changes or restarts for new tests

The three-story phase used Studio PID **242598** throughout. Before/after hashes and modification times for **205 product/build files** were identical: zero source changes, zero builds and zero unplanned restarts. Four real planning jobs covered three distinct stories plus the explicit authentication revision. Adding stories required no repository Playwright scripts. The private operator browser driver and regression-test fixtures are audit tooling, not a prerequisite for creating tests through Studio.

Initial one-time upgrades used PIDs 237764, 238997 and 242598. After the proof, the final generic cross-revision interruption fix was applied and Studio intentionally restarted as PID **283704**, with Codex unavailable. All 16 scenarios passed without AI and the persisted planning-job count remained **four**. Studio was then deliberately restored with its approved executable as PID **288219**. Upgrade/restart tests are not counted as new-story runtime restarts.

## Durable state and interruption matrix

Ten before/after snapshot categories were identical: selected project, projects, provider settings, artifact settings, application/environment/role configuration, stories, plans/permissions, QA jobs, runs and navigation/memory scopes. The snapshot retained two projects, four story revisions, nine plan revisions, eight historical runs and five scopes. Full-suite replay added three runs afterward. All **200 original run-evidence references** remained available; an original screenshot was reopened through Studio after restart.

| Case | Verification |
| --- | --- |
| First setup, administrator, login/logout | Headed UI and Chromium Studio E2E |
| CLI registration, browser create/import, project isolation | Actual Chromium Studio E2E, independent SQLite workspaces |
| Save/refresh, logout/login, switch and return | Expanded Studio E2E assertions |
| Full process restart | Actual separate PIDs and persisted snapshot comparison |
| Saved provider executable unavailable | UI retains saved-unavailable option, model, 90-second timeout and consent; adapter stays unavailable |
| Artifact configuration | 9-day retention retained; quotas/full local traces preserved |
| Plan and permissions | Exact hashes and scoped decisions retained |
| Pending work after browser refresh | New Chromium regression holds real planning activity, refreshes, resumes and opens/replays persisted execution |
| Exited owner after restart | Actual child-process exit integration regression; live peer jobs remain running |
| Uncertain writes | Preserved orphan reservations; explicit derived-address cleanup/review; cross-revision retries blocked before review |
| MCP lifecycle | Actual stdio connection; desired enable state restored with a new process; empty authorization grants |

Saved records/settings are durable. Current route, unsaved form drafts, checkbox choices and displayed evidence image are intentionally temporary. Sessions remain valid only within their existing expiry and are revoked on logout. Keep the same registry, project roots and operator environment on restart. The earlier empty view on unrelated port 4319 did not establish data loss; no cause was invented or user registry changed.

## Docuverus visible example

The three previously approved Super Admin routes were exercised directly in headed Chromium with read-only request enforcement: Dashboard, Manage Users and Log report. Eighteen read requests completed; six writes were blocked and none completed. Further networking in that demonstration tab was then paused.

QASpider's own navigation engine also replayed all three approved paths successfully in the headed browser, using its saved session and original approvals:

| Route | Persisted replay ID | Result |
| --- | --- | --- |
| Dashboard | `bc839b73-a1f4-4f1c-bd5c-e4422ecc0713` | complete |
| Manage Users | `533ed31f-afab-457c-ac18-0b0949c2761b` | complete |
| Log report | `0c5bce7e-051e-45b5-8ac4-cc72638d0833` | complete |

Each run has two retained evidence references. Studio displays the real four-state, three-approved-transition graph and replay history. This verifies navigation/session/destination states, not business-data correctness or POST-backed searches. No tenant switching, unknown forms, application writes or Docuverus context sharing with Codex occurred.

## Memory Center and evidence

An owned benchmark consent-screen change was explored through Studio. The comparison identified one new state, two missing states and sixteen changed transitions. A candidate with four verified transitions/four evidence references was explicitly approved, then rolled back through the UI with append-only history. Requirements remained unchanged. The benchmark toggle was restored and guest baseline paths rediscovered/reviewed before final replay.

Actual screenshots remain private under `.qaspider/m5-4/exploratory/`, including story review, permissions, PASS/FAIL reports, mobile view, memory approval/rollback, provider settings after restart, three restarted replays, old evidence reopening and the persisted Docuverus graph. Raw traces, session state, credentials and databases are ignored and uncommitted.

## Final validation

- `npm run typecheck`: passed.
- `npm run build`: passed; post-change `verify:provider` also rebuilds production assets.
- `npm test`: **71 passed**, 30 files; includes CLI/MCP stdio, auth/project boundaries, artifact quota/retention and recovery.
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/qaspider-playwright npm run test:smoke`: **16 passed**, actual Chromium.
- `QASPIDER_CODEX_BIN=<installed absolute executable> npm run verify:provider`: passed before/after changes. Final evidence ID `198415ce-e16c-409f-b09a-479f280e2dba`; zero tools, process timeout/cancellation exit and sanitized-context receipts retained. Runtime isolation was not bypassed.
- `npm audit --audit-level=high --json`: zero vulnerabilities.
- `node scripts/check-release.mjs`: passed. No private paths, dashboard tokens or private keys in distributable files; immutable migration hashes retained. Migrations 001–006 have no diff.
- Compiled CLI `doctor` against the audit workspace: exit zero.
- `git diff --check`: passed.

Established CI build/typecheck/test/smoke/audit/release checks passed locally. Hosted GitHub Actions was not triggered. No dependency or provider installation was required. Early red regressions, audit-input failures, harness locator corrections and the sandbox subprocess retry are recorded in the defect inventory; they are not concealed as successful first attempts.

## Fix commits and limits

- `d812793`: runtime ownership, explicit interruption reconciliation and cross-revision retry safety.
- `1f8f3fa`: safe accessible native menuitem navigation and regression/isolation evidence.
- `bc5e93e`: persisted Studio activity, draft reset, unavailable-provider display and persistence tests/documentation.
- The commit containing this acceptance record and `m5-4-report.json` records the final evidence.

Claude/Gemini remain deferred/unverified. Human review is necessary for generated proposals. Legacy jobs predating migration 007 have no reliable owner identity and are not automatically declared abandoned. Interrupted active artifacts require explicit lifecycle reconciliation. Linux PID/start identity has the strongest recovery evidence; unverifiable ownership remains fail-closed. Single-administrator loopback deployment remains the supported trust boundary. Existing non-failing build/color warnings remain documented. No unresolved critical functional/security finding remains in the audited scope.
