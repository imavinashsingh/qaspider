# M5.4 defect inventory

Recorded before fixes. Audit uses actual headed Chromium. Disposable Studio at port 4330; benchmark at 4337. Existing Docuverus data is retained and external application changes are forbidden. Only previously authorized read-only Super Admin routes may be exercised.

## M54-001 — Persisted menuitem navigation cannot be read

- Feature: project Overview / Navigation Graph, existing Docuverus workspace.
- Reproduction: register existing Docuverus workspace, open Overview; inspect persisted native-anchor navigation actions with locator role `menuitem`.
- Expected: existing approved actions remain readable and replayable within scope.
- Actual: current strict locator schema excludes `menuitem`; snapshot parsing rejects existing records and generic HTTP errors hide the cause.
- Severity: high, existing workspace blocked.
- Root cause: schema and discovery only recognize implicit link roles, and manual accessible-name snapshots omit image alt names.
- Fix: strict menuitem locator support and Playwright accessible names for native anchors, retaining live anchor/origin/action checks. No arbitrary menu controls.
- Regression: `tests/smoke/menuitem.spec.ts`; persisted close/reopen replay passes; destructive links and arbitrary menu actions remain rejected.
- Verification: all three actual Docuverus engine replays complete, with persistent evidence IDs and graph history; fixture Chromium regression passes. Private screenshots and receipts under `.qaspider/m5-4`. Status: fixed.

## M54-002 — Abandoned jobs remain running after owner process exits

- Feature: job/run recovery.
- Reproduction: start a persisted job in a child process, terminate its owner, reopen its workspace.
- Expected: interrupted status, uncertain side effects retained, no automatic write replay.
- Actual: repositories persist running jobs without process ownership or restart reconciliation.
- Severity: high reliability/data-integrity gap.
- Root cause: job state is durable but process liveness is not represented.
- Fix: migration 007 atomically records PID/start identity. Service startup reconciles only exited owners, preserves uncertain fixtures/evidence and leaves live peer workers alone. Migration 008 records immutable explicit reviews.
- Regression/verification: child-process exit regression in `tests/integration/runtime-recovery.test.ts` passes, including idempotent cleanup against an actual synthetic HTTP server and close/reopen persistence. No automatic submission or cleanup. Status: fixed.

## M54-003 — Active job UI state is lost on refresh/navigation

- Feature: Applications and Test Studio progress.
- Reproduction: start a job, refresh/navigate away and return.
- Expected: persisted job can be found and monitored without knowing its internal ID.
- Actual: job selection exists only in React state; QA API exposes GET by ID but no job list, and initial screen load never resumes active progress.
- Severity: medium.
- Root cause: runtime APIs persist jobs but UI restoration is incomplete.
- Fix: QA jobs list API, persisted activity chooser, running execution/plan restoration and Applications map-job restoration.
- Regression/verification: `tests/smoke/runtime-refresh.spec.ts` refreshes an actual pending planning job, reopens execution results, replays without another planner call and verifies draft reset. All pass. Status: fixed.

## Investigations — no defect assumed

- Runtime stories/plans/scenarios are already SQLite data executed by generic services. New stories do not require TypeScript or Playwright source files. Developer acceptance scripts and build-time upgrades must be distinguished from user operations; same-process three-story proof passes: PID 242598, 205 unchanged source/build files, zero runtime builds or restarts.
- Provider settings, administrator, projects and workspace records already use durable SQLite. An empty Studio on port 4319 was observed; no data-loss defect was reproduced. An isolated same-registry full restart preserved all ten snapshot categories exactly. Documentation now identifies the printed registry path, approved project roots and required operator environment. The unrelated 4319 instance was left untouched; its earlier empty project view is not attributed to a guessed cause.
- Optional Claude/Gemini providers remain deferred, not verified.

## M54-004 — Local fixture shortcut is offered to remote legacy-ID applications

- Feature: permission-review Advanced Settings.
- Reproduction: use a remote application initialized with legacy ID `benchmark` (Docuverus uses that ID).
- Expected: local benchmark fixture presets must not imply support on a remote target.
- Actual: helper visibility was based only on application ID.
- Severity: medium, misleading endpoint configuration; explicit approval was still required by the backend.
- Root cause: compatibility identifiers were treated as capability detection.
- Fix: shortcut is restricted by parsed loopback target hostname, with credentials and lookalike hostnames rejected. No grants are created by the shortcut.
- Regression: `tests/unit/fixture-target.test.ts`.
- Verification: local-only target classifier passes; external Docuverus is excluded. Status: fixed.

## M54-005 — New-story selection retains previous text/report

- Feature: saved-story selection.
- Reproduction: open a stored story, then select New story.
- Expected: blank new-story draft, without a previous run presented as its result.
- Actual: only the selected ID was reset; old Markdown and run selection remained.
- Severity: medium, confusing story ownership and results.
- Root cause: incomplete React draft reset.
- Fix: clear Markdown/source and run evidence selection on New story; new story save clears prior report evidence.
- Regression/verification: `tests/smoke/runtime-refresh.spec.ts` proves stored-to-new selection clears Markdown/source and previous report; headed New Test also used for all three runtime stories. Status: fixed.

## M54-006 — Unavailable startup provider looks like erased configuration

- Feature: AI provider settings.
- Reproduction: save an executable, restart without that executable in the operator-approved startup environment.
- Expected: retained saved path is shown as unavailable, without silently approving a different binary.
- Actual: saved value had no matching selectable option, appearing unconfigured; SQLite still retained it.
- Severity: low usability, security remained fail-closed.
- Fix: show a disabled saved-unavailable option; executable approval restrictions remain unchanged.
- Regression/verification: integration test persists settings with startup approval unavailable and rejects adapter use. Actual full process restart with Codex absent retained model, 90-second timeout, sharing consent and saved path; UI displays the disabled saved-unavailable option. All 16 scenarios replayed without AI. Status: fixed.

## M54-007 — An edited revision can bypass interruption reconciliation

- Feature: execution retry safety.
- Reproduction: interrupt a write scenario, edit its plan while retaining the same scoped write, approve that revision, check reconciliation before execution.
- Expected: changing a plan revision cannot erase uncertain effects from the previous run; explicit reconciliation is still required for the overlapping scoped write.
- Actual: the initial M5.4 guard searches only the exact plan revision ID.
- Severity: high safety gap discovered during review of the new recovery implementation.
- Root cause: interruption matching used a revision identity rather than shared execution scope and side-effect capability.
- Fix: match interrupted side effects by application/environment/build/tenant/role and normalized feature flags across plan revisions. Read-only scenarios remain available. Original plan hash and cleanup permission bind each review.
- Regression/verification: cross-revision test failed before the guard fix and passes afterward; all 71 unit/integration and 16 Chromium cases pass. Runtime source proof was completed before this one-time upgrade. Status: fixed.

## Audit input and harness corrections (not product defects)

- The original authentication audit story used malformed email while expecting credential validation and expected 403 for anonymous API access. Actual FAIL results were correct and are retained, including AI-free replay. A human-reviewed source revision uses the benchmark authentication contract (anonymous 401, user 403, admin 200). A reviewed plan uses an owned reserved nonexistent address, which does not create an account; literal real-looking email inputs remain rejected by the existing schema. Original assertions and evidence are not rewritten.
- Generated navigation proposed redundant clicks after destination replay; human plan editing removed the extra clicks and preserved every destination/visibility assertion. Planning remains a proposal requiring review.
- The initial new refresh regression used a Studio-only New Test control in the legacy project viewer. Correcting the harness to use its actual Test Studio control produced a passing test; no product workaround or weakened assertion was used.
- Exploratory locator timeouts from exact matching of composite labels and reading React state before fetch completion were corrected in the audit driver, not recorded as product defects.
- Automatic approval review initially rejected the login data edit on concern that unique-email creates an account. Executor inspection demonstrated that only duplicate-email calls setup; the narrower draft edit was approved after that evidence. No rejected action was bypassed.
- Release-file verification initially encountered sandbox Git subprocess EPERM; it passed with authorized host execution. No unresolved environment blocker remains.
