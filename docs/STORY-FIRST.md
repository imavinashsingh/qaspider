# Story-first planning and execution (M5.3)

Start with `npm start`, open http://127.0.0.1:4319/, log in and select a project. Restart an older Studio process to load the new build. Existing graphs, requirements and evidence are preserved.

1. **Describe:** select a saved navigation context, or an application/environment without navigation memory. Choose the roles, enter Markdown acceptance criteria and select **Generate Test Plan**. No execution permissions are needed. Settings → AI Providers separately controls provider configuration and consent to sharing sanitized context.
2. **Review Plan:** inspect the scenarios, role/environment, target precondition, steps, expected outcomes, generated data and cleanup. AI-inferred assumptions remain unapproved. Edit titles directly; expand Advanced Settings for other scenario edits, or ask Codex to revise. Save edits before approving the exact plan and explicitly cited requirements.
3. **Approve Access:** each card describes the endpoint, impact, role, relevant scenarios, risk and cleanup. Choose Allow or Deny for individual operations and save decisions. No blanket authorization is inferred from AI output or plan approval. Missing fixture endpoints appear as unsupported; configure them in Advanced Settings, save a new revision, then review its plan and permissions again.
4. **Execute:** execution uses the approved revision without AI. Pending, denied or unsupported permissions block affected scenarios before fixture setup or browser interaction. Independent authorized scenarios continue. Cancellation applies to the active job; owned fixture cleanup remains limited to its explicit cleanup permission.
5. **Results:** inspect persisted classifications, assertion evidence, fixture lifecycle and local screenshot/trace references. Duplicate-email failures do not rewrite approved requirements. Run Existing Test reuses saved plans and decisions without another model call.

Navigation discovery is now a separate, explicit Applications/Graph operation. Planning only reads stored scoped memory; it cannot browse even when a legacy input policy says `discovery: true`. Unknown states or unapproved paths block execution, while the proposed plan can still explain missing information. Endpoint knowledge is not guessed into executable privileges: the user must review exact requested endpoints. An unknown form endpoint requires editing the plan once independently identified.

## Authorization persistence

Migration **006_execution_permissions.sql** adds workflow markers and append-only decision history. Migrations 001–005 are unchanged. Each decision records its workspace-local revision ID, content hash, complete application/environment/tenant/build/role context, exact request, reviewer and timestamp. The Studio project API selects the workspace database before resolving any revision. There is no cross-project permission fallback.

Permission requirements are derived from submission steps, HTTP assertions and owned fixture data. Unused `allowedActions`/policy entries do not generate requests. The backend compiles allowed requests into a minimum typed execution policy for each scenario; provider `allowedActions` never create those grants. Runtime authorization is rechecked before fixture setup, input operations, reads and at the intercepted POST request immediately before it is released. The network gate permits one exact POST per approved interaction. Origins, production-write protections, authentication, approved navigation and fixture ownership remain enforced independently.

A plan edit, Codex revision or lifecycle configuration change creates a new draft with no copied decisions. Superseded managed revisions cannot execute new scenarios; historical runs/evidence remain readable. Cleanup of already reserved records still requires the original explicit cleanup decision. If revoked, cleanup stops and records an orphan for reconciliation.

Historical M2 explicit-policy plans retain their existing reviewed policy contract. The local owner CLI's explicit `--policy` mode is also retained for compatibility; it constitutes operator-supplied endpoint policy, not model-issued permission. Browser and MCP planning always use the new proposal-only workflow, even if a caller submits a policy. Editing a legacy plan adopts separate permissions. M5.3 does not silently revoke historical approvals or infer a new one.

## CLI

```sh
npm run cli -- plan generate --workspace /path/to/project --story STORY_REVISION
npm run cli -- plan permissions --workspace /path/to/project --plan PLAN_REVISION
npm run cli -- plan authorize --workspace /path/to/project --plan PLAN_REVISION --hash PLAN_HASH --reviewer local-owner --file decisions.json
```

`decisions.json` contains only reviewed IDs and decisions, for example:

```json
[{"permissionId":"COPY_EXACT_ID_FROM_PLAN_PERMISSIONS","decision":"deny"}]
```

Use `plan configure-access --workspace ... --plan ... --file lifecycle.json` for missing fixture configuration. This creates a new draft; it grants nothing. The lifecycle file uses the existing typed policy schema and contains secret-reference **names** only. Never paste credential values.

## Reproducible verification

`npm test` includes permission derivation, boundary validation, append-only decisions and scope/revision isolation. `npm run test:smoke` uses the loopback benchmark to verify denial sends no submissions, independent read-only scenarios continue, approved cases execute, the duplicate-email defect is detected, requirements are preserved and a reopened database supports AI-free replay. Synthetic planners in automated tests are labeled explicitly.

After building, `npm run verify:story-first` uses the installed, already authenticated Codex CLI and a separately owned ephemeral loopback benchmark. It sends only benchmark requirements and sanitized memory. It validates isolation, generates without permissions, checks the proposed three registration cases, explicitly authorizes benchmark operations, injects the fixture defect, executes and reopens SQLite for full AI-free replay. No external target is accessed. It fails rather than substituting a fake planner if Codex is unavailable. Receipts, databases and raw artifacts stay private under `.qaspider/m5-3/real-benchmark`; a sanitized hash-backed result is written to `validation/m5-3-benchmark.json`.

Run `npm run verify:provider` before and after adapter/context changes. Its synthetic wire/process/sanitization evidence remains separate from the real-model benchmark. Neither saved result bypasses the runtime isolation gate. Claude and Gemini remain optional, deferred and unverified.
