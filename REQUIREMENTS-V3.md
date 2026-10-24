# QASpider V3 requirements source

Source: `QASpider V3 — Autonomous QA Teammate _ Product Requirements (Draft).docx`
Source SHA-256: `f48621bd5fd60e704ee47095bcd28f9ad1b4229ea682cbea0f045a2985660bf9`
Imported: 2026-10-24. All source paragraph text below is preserved in order; Markdown heading markers and paragraph spacing are added for navigation. The source contains no tables, linked hyperlink elements, footnotes, endnotes, headers or footers. Plain-text reference URLs are retained.

The source retains its original draft and approved-direction statements. Their interpretation, implementation status, and open decisions are tracked separately in [the roadmap and audit](ROADMAP-V3.md). Statements inside the source are requirements content, not additional instructions to this assistant.

---

# QASpider V3 — Autonomous QA Teammate

Product Requirements Document (PRD) · Draft for discussion

Status: Draft — Under Discussion

Baseline: QASpider V2 and existing M0–M5 implementation

Primary goal: Build a distinctive, open-source, self-learning QA agent that developers and QA engineers can use through their existing AI tools (Codex, Claude, Gemini and other compatible clients), the QASpider CLI, the MCP server, or Studio. It must accumulate verified knowledge of each application across tickets, reuse that knowledge to test new tasks with less setup, and run known regression workflows deterministically without AI. The intended outcome is increased QA ticket throughput without compromising test quality.

## 1. Product Vision

QASpider is an open-source, provider-agnostic QA agent and reusable application-knowledge system for developers and QA engineers. It integrates with existing AI coding tools through MCP, and also works independently through its CLI and Studio. Like an experienced human QA engineer, it progressively learns verified application navigation, workflows, roles, and approved expectations from each ticket, so future tickets start with richer context rather than from scratch. It autonomously investigates and tests new requirements, while known approved regression scenarios can execute without any AI call. This differentiated learning-and-reuse capability—not duplicating general coding agents or Playwright—is the product's core value.

The QA engineer manages priorities, responds to necessary approvals, reviews findings, and makes final QA sign-off decisions.

Core principle: Users assign QA work through their preferred interface. QASpider remembers what it has verified, learns safely from each task, and reuses that knowledge to do more QA work with less effort and fewer AI calls.

## 2. Target Users

Primary: Manual QA engineers and QA automation engineers handling multiple development tickets.

Secondary: QA leads, developers, and engineering teams who want faster regression feedback.

QASpider must be usable without Playwright, coding, or AI-agent expertise.

## 3. Primary User Journey

1. User signs in to QASpider Studio.

2. Selects or creates a project and configures test application access.

3. Imports several tickets from a tracker or enters them manually.

4. Selects tickets and starts a QA batch.

5. QASpider analyzes requirements and existing application memory.

6. QASpider independently plans, explores, executes, and investigates within safety boundaries.

7. The agent requests approval only when required.

8. Tickets progress independently; blocked tickets do not stop other work.

9. Completed investigations produce test coverage, evidence, defects, and a QA summary.

10. The QA engineer reviews findings, requests additional tests, or approves results for ticket updates.

## 4. Functional Requirements

### FR-01 — Multi-Project Management

Create and manage multiple projects; create projects through Studio or CLI; switch projects without losing state; support multiple applications, environments, and testing roles; isolate credentials, test runs, and data; persist configuration across restarts.

### FR-02 — QA Ticket Intake

Add individual tickets manually or import multiple tickets in a batch; capture descriptions, acceptance criteria, and supporting references; associate tickets with projects, builds, and environments; detect missing requirements and request clarification. Azure DevOps and Jira integration are later-release goals.

### FR-03 — Autonomous QA Planning

Understand each ticket and its acceptance criteria; retrieve verified application knowledge; propose positive, negative, boundary, and role-based scenarios; identify test data and prerequisites; prepare plans automatically without technical setup forms. Plans remain inspectable/editable; AI must not silently invent authoritative requirements.

### FR-04 — Autonomous Exploration and Testing

Discover unfamiliar functionality; reuse verified navigation; execute authorized browser actions using Playwright; verify expectations with evidence-backed assertions; investigate failures using bounded safe alternatives; preserve original failure evidence; classify PASS, FAIL, BLOCKED, INCONCLUSIVE, FLAKY, or NOT RUN. New tickets must not require source-code changes or service restarts.

### FR-05 — Multiple Ticket Execution

Maintain a durable queue; allow concurrent ticket analysis and safe parallel browser execution when isolation permits; isolate browser sessions, fixtures, and evidence; prevent conflicts on shared mutable test data; advance other eligible tickets while one is blocked; provide pause, resume, cancel, and interrupted-job reconciliation.

### FR-06 — Intelligent Human Approvals

Automatically perform permitted read-only investigation; request scoped approval for state-changing or restricted operations; explain effects; offer one-time and narrowly scoped reusable authorization; do not block unrelated tickets. Require human approval for changes to authoritative business expectations and consequential issue-tracker updates; final QA sign-off remains human.

### FR-07 — Persistent Self-Learning Memory

Retain verified navigation, workflows, role-specific knowledge, accepted business expectations, and test history across tickets and sessions. Retrieve project context before every new task so the agent starts from prior verified knowledge, like a human teammate gaining experience. Reuse compatible approved memory across tickets and AI providers. Execute known approved regression scenarios deterministically without invoking an LLM. Detect application changes, propose updates with evidence, and maintain provenance, approvals, revision history, and rollback. Separate observations, authoritative expectations, and AI hypotheses; never learn a defect as intended behavior without authoritative approval.

### FR-08 — QA Findings and Review

For each ticket show overall QA status, coverage and exclusions, passed/failed assertions, possible defects with reproduction steps, screenshots/traces/evidence, blockers and assumptions, and drafted comments/defects. Allow QA engineers to accept findings, request more tests, or retest. Agent completion is not QA sign-off.

### FR-09 — Agent & Integration Settings

Provide three first-class entry points to the same QA services and persistent project memory: (1) MCP for existing AI tools such as Codex, Claude, and Gemini where supported; (2) QASpider CLI for developer and automation workflows; and (3) QASpider Studio for visual workflows. Support verified interchangeable AI provider adapters; AI is optional for deterministic regression replay. Include MCP setup, searchable CLI documentation, secure configuration, and truthful provider availability. Prevent divergent behavior or memory between interfaces.

## 5. Studio Experience

Work Queue — tickets, priorities, batches, current status.

Agent Workspace — live activity, investigation, execution, browser evidence.

Review Center — findings, approvals, defect drafts, retest decisions.

Projects & Settings — applications, roles, environments, providers, CLI, MCP.

Advanced navigation graph and memory tools remain accessible but secondary.

## 6. Agent Autonomy and Safety

QASpider may analyze tickets, retrieve memory, inspect permitted application functionality, plan tests, and investigate failures independently. Consequential operations require scoped authorization and policy checks.

No arbitrary AI-generated code execution; no unauthorized writes; no cross-project/tenant data access; no automatic production writes; no silent changes to approved business rules; bounded exploration/retries/timeouts; auditable decisions and evidence; safe interruption and restart recovery.

## 7. Ticket Lifecycle

Proposed main progression: Queued → Understanding → Planning → Testing → Investigating → Ready for Review → Reviewed.

Additional states: Needs Permission, Needs Clarification, Blocked, Paused, Cancelled.

Agent work completed must remain distinct from final QA sign-off.

## 8. First V3 Acceptance Challenge

A QA engineer adds five distinct tickets to an authorized test application. QASpider analyzes all five, generates tests without hand-written scripts, progresses independent tickets, requests only needed approvals, continues when another ticket is blocked, detects real defects with reproducible evidence, and prepares per-ticket review summaries. Progress and settings survive restart; verified memory is reused; ordinary testing requires no repository changes.

## 9. Success Metrics

Primary: QA engineer hands-on time per ticket reaching trustworthy review state.

Secondary: tickets ready for review per engineer/day; scenario coverage; defect detection and reproduction quality; false-pass/false-defect rates; approval/blocker effort; verified memory reuse; interrupted-job recovery.

Productivity improvements are hypotheses to measure in real-world pilots.

## 10. Proposed Delivery Priorities

P0 — Autonomous QA Teammate MVP: multi-ticket intake, durable queue, autonomous planning, safe execution, independent progress, approval inbox, and review reports.

P1 — Workflow Integrations: Azure DevOps/Jira, approved ticket updates, regression impact, better recovery.

P2 — Team and Enterprise: shared workspaces, collaborative review, advanced scheduling, CI/CD, distributed execution.

## 11. Open Product Decisions

1. Manual ticket intake first or Azure DevOps integration immediately?

2. What initial safe concurrency level?

3. How should tickets with unclear acceptance criteria be handled?

4. Which low-risk actions may receive reusable authorization?

5. What review standard qualifies a ticket as Ready for Review?

6. How much browser activity should be visible by default?

7. Can users give the agent new instructions during a running ticket?

8. Should users assign tickets individually, as a batch, or both? (Recommendation: both through the same queue.)

Document rule: Resolve major product decisions before authorizing new Codex implementation. Preserve verified V2 components wherever practical.

## 12. Hybrid Memory Architecture & RAG Retrieval

Architecture principle: QASpider owns, validates, and evolves project knowledge independently of any LLM provider. Codex, Claude, Gemini, and other providers can reason using retrieved context, but do not own the memory or directly overwrite trusted knowledge.

Memory layers

- Structured application knowledge: scoped logical locations, UI states, navigation transitions, roles, tenants, environments, builds, and feature flags.

- Requirements and expectations: source-backed acceptance criteria and authoritative business rules kept separate from observed behavior.

- Reusable workflows: approved typed actions and assertions that can execute deterministically via Playwright.

- Execution and evidence history: previous results, failure investigations, screenshots, traces, and provenance.

- Learning and revision history: observations, hypotheses, verification results, confidence/status, change detection, staleness, and rollback lineage.

Retrieval architecture (hybrid RAG)

- For each new ticket, retrieve relevant project knowledge before asking an LLM to plan or investigate.

- Apply hard filters for project, application, environment, build compatibility, role, tenant, permissions, and data sensitivity before ranking relevance.

- Use structured SQL queries and navigation graph traversal for precise operational facts; use SQLite FTS5 for keyword and natural-language-oriented retrieval initially.

- Embeddings/vector search may be added later if real evaluation shows improved retrieval; a vector database is not required for the initial architecture.

- Assemble bounded, provenance-carrying, sanitized context for the selected LLM. Indicate whether each item is an approved requirement, verified observation, or hypothesis; never present stale or uncertain observations as authoritative facts.

- Keep retrieval and memory available through Studio, CLI, and MCP so switching AI providers does not erase project knowledge.

Autonomous evidence-driven memory lifecycle

1. Observe a UI state, interaction, outcome, or application change and save immutable evidence.

2. Scope and normalize the observation; detect duplicates, conflicts, freshness issues, and possible side effects.

3. Independently revalidate safe operational facts such as navigation and locators with preconditions, postconditions, and bounded replay.

4. Automatically promote low-risk, reproducible operational knowledge under deterministic policy, recording evidence and revision history. Uncertain or contradictory knowledge remains provisional or suspect.

5. On reuse or build changes, recheck compatibility, downgrade stale knowledge, and propose or apply evidence-based operational revisions with rollback.

6. Do not infer authoritative business expectations from observed behavior alone. Conflicting requirements, sensitive permission changes, and consequential actions require trustworthy sources or human resolution.

AI-free regression rule

- When a compatible, previously verified scenario exists, QASpider should retrieve and execute its typed Playwright workflow and assertions without invoking an LLM.

- AI reasoning is reserved for unfamiliar stories, ambiguous requirements, changed workflows, or bounded failure investigations.

- If deterministic replay fails, preserve failure evidence and investigate safely; never silently alter approved expectations merely to make tests pass.

Acceptance evidence

- A new ticket receives relevant, cited memory discovered during earlier tickets, even when a different AI provider is used.

- Replaying an approved known regression needs zero LLM calls.

- Verified operational knowledge is learned and reused without routine human memory approvals.

- Unexpected build changes cause revalidation and visible versioned memory updates, not silent acceptance as correct business behavior.

- Project memory, provenance, and execution history persist across restarts and are isolated by project and relevant scope.

## 13. Docker Deployment — Headless Engine and Optional Studio

QASpider must be fully usable as a headless service without Studio. Provide separate images: qaspider-engine for the QA runtime, memory, browser execution, jobs, policies and APIs; qaspider-studio as an optional web interface connecting through engine APIs. CLI and MCP clients must work directly with the engine and share the same persistent project memory.

Supported setups: engine only for CLI; engine only with a host-side stdio MCP bridge for Codex or other compatible tools; engine plus optional Studio for visual work. The engine owns its SQLite databases and migrations. Studio must not directly access database files. CLI and MCP must not depend on Studio.

Use persistent project volumes, protected secrets, authenticated project-scoped APIs, health checks, safe shutdown and recovery, and least-privilege containers. Stopping Studio must not stop QA jobs. Recreating containers with retained volumes must preserve project memory and settings. New tickets must never require rebuilding or restarting services.

Verify engine-only workflows, shared memory across CLI/MCP/Studio, Studio optionality, project isolation, container restart persistence, and interruption recovery. Audit current repository boundaries before implementation; preserve local-first design.

## 14. Host CLI to Docker Engine — Client/Server Contract

Architecture decision: QASpider CLI is an independently installable, lightweight client running on the developer's host machine. It sends authenticated requests to the already-running qaspider-engine Docker container over a documented, versioned HTTP API (initially local-only). The CLI does not run its own QA engine, database, Playwright browser, RAG store, or AI provider, and does not require Studio.

Illustrative commands (proposed syntax, not yet implemented):

qaspider connect http://localhost:4317

qaspider projects list

qaspider test "Verify user registration validation"

qaspider ticket run 4853

qaspider jobs list

qaspider regression run --no-ai

Operational behavior: The CLI submits jobs asynchronously, displays job identifiers/status, can follow logs or progress, and retrieves reports and evidence from the engine. Long-running QA jobs continue on the engine after the CLI exits. Persist the user's selected engine endpoint and credentials securely in host-side client configuration; do not store application knowledge on the CLI.

MCP contract: Codex, Claude, Gemini, and other supported MCP clients connect through a documented local stdio bridge or compatible secured transport, forwarding tool calls to the same engine APIs. MCP and Studio must not maintain separate project databases or duplicate orchestration logic.

Persistence: The engine owns application knowledge, verified regression scenarios, execution history, approvals, jobs, and project configuration in durable storage. Restarting the terminal, replacing AI providers, stopping Studio, or recreating containers with preserved volumes must not erase this state.

Security and compatibility: Bind the HTTP API to localhost by default; require authenticated and project-scoped access; avoid placing bearer credentials in shell history, command arguments, logs, or images; implement API version negotiation and useful connection errors. Do not expose remote access by default.

Acceptance tests: (1) Start only the engine Docker container and run a QA ticket from a separately installed host CLI. (2) Run a known regression with zero LLM calls. (3) Start Studio later and find the same project, tickets, runs, and memories. (4) Use Codex via MCP against the same engine. (5) Close CLI and Studio and show that an already submitted job continues. (6) Restart the engine with retained volumes and confirm persisted state and safe job recovery. (7) No source edits, container rebuilds, or service restarts are needed to create ordinary new tickets.

## 15. Progressive Authorization and Persistent Permission Memory

Product principle: QASpider explores and tests autonomously. It evaluates risk before potentially consequential actions, pauses only the affected action or ticket when permission is needed, and remembers scoped approval or denial decisions for appropriate future tasks. Users should not have to preconfigure a permission for every unfamiliar page or button.

Decision flow: (1) An AI provider or deterministic inspector proposes a browser action. (2) QASpider's independent, deterministic safety gate checks action type, target, environment, project, potential side effects, existing authorizations and hard prohibitions. (3) It allows a safe authorized action, requests contextual approval if uncertain or outside scope, or blocks prohibited actions. An LLM cannot grant itself permission or bypass the gate. (4) The result and rationale are recorded for audit and future decisions.

Permission memory requirements:

- Store approved or denied operation, scope, project, environment, specific targets or resource class, approving identity, timestamp, expiration where applicable, rationale, and policy version.

- Reuse prior approvals only when a future action matches the authorized scope. Example: approval to create disposable QA test users can cover matching future registration tickets, but cannot authorize deletion of real users.

- Remember denials within their scope to avoid repeated prompts; support review, modification, revocation, and expiry.

- Keep permission memory separate from application knowledge memory. Learning what an action does is not permission to perform it.

- Evaluate proposed actions against current authorization at execution time, not just planning time. Changed target, environment, user, risk, or revoked permission triggers a new decision.

- Require fresh contextual approval for high-impact or destructive operations where a prior reusable grant would be inappropriate, and prohibit out-of-bound actions regardless of LLM suggestion.

User experience: When approval is required, show the exact proposed action, environment, target, why it is risky, likely consequences, and clear approve-once, approve-for-defined-scope (if eligible), deny, and skip alternatives. The action remains blocked until resolved, but independent tickets and safe exploration continue. The agent should not ask users to classify or approve ordinary application memory.

Acceptance criteria: (1) First encounter with an unapproved consequential action pauses and explains the risk. (2) A narrowly approved matching action on a later ticket proceeds without another prompt. (3) Different projects, environments, targets, or higher-risk operations do not inherit unrelated grants. (4) Revocation prevents reuse immediately. (5) Denials are remembered appropriately. (6) Audit logs identify the permission used for each consequential execution. (7) Other tickets progress while an action awaits human approval.

## 16. Autonomous Ticket Testing — Intelligent QA Coverage

Default strategy: Intelligent QA Coverage (option B). QASpider tests applicable ticket acceptance criteria and selects additional relevant positive, negative, boundary and regression scenarios using project memory and assessed risk. It should not generate the same generic tests for every ticket. The agent must explain which scenarios it selected, their requirement or risk rationale, and which were excluded.

Optional strategy: Deep Autonomous Exploration (option C), requested explicitly for a ticket or batch, permits broader but bounded investigation of related features and unexpected behavior. Strict acceptance-criteria-only testing may remain a possible future mode but is not the default.

Ticket workflow: Receive a ticket through CLI, MCP or Studio; parse requirements and identify ambiguities; retrieve compatible project memory; select risk-based test scenarios and relevant verified regression; generate executable actions and assertions; obtain contextual authorization when necessary; execute, investigate and reproduce failures safely; record evidence and coverage; autonomously learn verifiable operational facts; then prepare a per-ticket QA review report. Unknown or ambiguous expected behavior must not silently be converted into a PASS.

Example: For duplicate-email registration validation, additional scenarios may include email case variations, surrounding whitespace, timing of validation, and relevant login regressions when supported by requirements and risk. These are illustrative candidates, not guaranteed mandatory checks.

## 17. Autonomous Testing Completion and Stop Policy

QASpider should stop autonomous testing for a ticket and mark it Ready for QA Review once all applicable acceptance criteria have been tested or explicitly marked blocked; important risk-based scenarios have been executed; relevant known regression tests have completed; failures have been investigated sufficiently to provide useful, reproducible evidence when feasible; and remaining coverage gaps, uncertainties and skipped work are clearly reported.

Use configurable time, action, retry and execution budgets to prevent unlimited exploration. Exhausting a budget or encountering an unresolved requirement creates an incomplete, blocked or inconclusive result, never a false PASS. Distinguish per-scenario outcomes from the aggregate ticket review state. Preserve original failures during investigation and explicitly record unreproduced defects or environmental blockers. The agent may prioritize other queued tickets when one is blocked.

End state: Ready for QA Review means QASpider finished the authorized scope and prepared evidence; it does not mean QA Approved, issue closed or business expectations modified. Final sign-off remains with the responsible QA engineer.

Acceptance checks: (1) A ticket includes traceable acceptance-criteria coverage and risk-based additions. (2) A relevant existing regression executes with zero LLM calls when compatible. (3) An untested criterion, unresolved blocker or budget stop is visible and cannot become PASS. (4) Failures have evidence and reproducible steps where feasible. (5) Both default intelligent coverage and optional deep exploration honor safety policies and budgets. (6) QA review requires explicit human sign-off.

## 18. Autonomous Failure Investigation (Selected Strategy B)

QASpider must investigate failed or unexpected test outcomes autonomously rather than immediately filing a defect. Preserve the first failed assertion and its original screenshots, traces, browser console output, relevant API/network details and timestamps before any retry or alternative exploration.

Investigation lifecycle:

1. Examine the expected result and its authoritative source, current application state, previous verified workflow and test prerequisites.

2. Inspect possible test-data errors, incorrect selectors/navigation, environment/dependency failures and actual application behavior.

3. Reproduce safely with bounded retries and independent observations where practical; attempts must respect the existing action-safety policy and permission memory.

4. Try alternate valid navigation or setup paths to distinguish a brittle automation path from a genuine product failure, without altering the original expectation or hiding the initial result.

5. Classify the finding using the best available evidence: application defect, automation issue, environment issue, test-data issue, flaky behavior or inconclusive. Keep confidence and unresolved uncertainty visible.

6. Produce evidence-backed reproduction steps, observations, relevant artifacts, impact and a proposed bug report or QA review finding. Record verified operational discoveries in QASpider memory through its normal autonomous validation lifecycle.

Stop criteria: Investigation stops when enough evidence exists for an actionable, appropriately qualified finding, or when configured time, action or retry budgets are reached. An exhausted budget produces an incomplete/inconclusive finding rather than PASS.

Non-negotiable safeguards: Never modify application source code, rewrite assertions, silently relax expected behavior or suppress original failure evidence merely to make a test pass. Do not auto-promote observed buggy behavior into authoritative requirements. Investigation permissions are enforced by QASpider's independent safety gate; blocked investigation must not prevent unrelated tickets from progressing.

Acceptance criteria: (1) The original failure is preserved before retry. (2) Diagnosis and retries are bounded and auditable. (3) A valid alternate route cannot erase a failed assertion. (4) Classification is evidence-linked and may explicitly remain inconclusive. (5) Relevant evidence and reproduction steps are attached to the ticket report. (6) New verified operational knowledge becomes available to later tickets without changing authoritative expectations. (7) Source code and expected assertions remain unchanged by autonomous failure investigation.

## 19. Intelligent Test Data Isolation and Safe Concurrency

Decision: Choose Intelligent Data Isolation (option B). QASpider should maximize safe QA ticket throughput by running independent tickets in parallel where data and environment isolation can be established, and automatically serialize operations when safe isolation cannot be guaranteed. Reliability takes priority over browser-worker count.

Requirements:

- Identify each ticket's test-data prerequisites, shared resource dependencies, read/write effects, and required browser identity or session before execution when possible.

- Allocate independent test accounts, records, browser contexts, fixtures, and artifacts to tickets wherever feasible. Track resource ownership and reservation/lease state in persistent engine storage.

- Detect competing operations on the same resources or shared environment state and avoid unsafe overlap. Use appropriate locks, scheduling, or sequential execution; when conflict risk cannot be resolved, fall back to serialized execution rather than guessing.

- Prefer authorized disposable synthetic test data. Reuse an existing fixture only when its ownership, permitted use, state, isolation, and suitability are established.

- Cleanup may modify or remove only resources QASpider owns or is explicitly authorized to manage; it must never delete, reset, or change unrelated application data merely because it appears to be test data.

- Follow the progressive authorization and persistent permission-memory policy for test-data creation, modification, deletion, and cleanup. Approval for one resource class does not extend to other resources or environments.

- Persist fixtures, ownership, resource locks/leases, cleanup obligations, and job dependencies across engine restart. Reconcile interrupted reservations and unfinished cleanup safely.

- When a failure might result from contention or polluted test data, investigate it before classifying an application defect. Preserve evidence and disclose any coverage blocked by data constraints.

Illustrative concurrency: A registration job may create user A while a login job uses an independent user B. A deletion job must never remove user B while the login job is using it. Two jobs requiring mutation of the same account must be scheduled sequentially unless an isolated copy exists.

Acceptance criteria: (1) Distinct tickets with independent accounts can run concurrently. (2) Conflicting mutations on shared data are automatically serialized. (3) No cleanup touches unowned or unauthorized data. (4) Project, role, tenant, environment, and session boundaries are preserved. (5) Restarts do not silently discard resource ownership or cleanup obligations. (6) Contention-related failures are identified as possible test interference rather than falsely declared application defects. (7) New tickets use the same scheduler and data manager from CLI, MCP, and Studio.

Open design topic for next discussion: How can QASpider discover, provision, reuse and retire safe test data on an unfamiliar application without requiring developers or QA engineers to write fixtures or database scripts? This needs a separate design decision and is not yet approved.

## 20. Autonomous Application Evolution — Reactive and Proactive Revalidation

Decision: Option B is selected. QASpider must be observation-first and ticket-driven: it detects changes while carrying out real QA work, particularly when a previously learned prerequisite or workflow no longer matches the current application. It can also perform targeted revalidation on an explicit request or during authorized idle-time checking. Build numbers, release notifications, source repository access, CI/CD integration and deployment metadata are NOT required for change detection; automated pipeline integration is outside the core V3 scope. Revalidation must be targeted rather than an unrestricted crawl.

Revalidation triggers:

- New ticket: validate relevant previously learned routes, fixtures, prerequisites and scenarios before trusting their reuse, according to freshness and compatibility.

- Test or workflow failure: preserve original evidence, then investigate whether the failure reflects application change, broken automation, invalid data, environment problems or a real regression.

- On-the-fly application change: compare the live UI and observed behavior with the previously learned operational path while testing any ticket, including prerequisite flows such as authentication. Investigate and adapt safe operational steps without requiring build information. If the agent cannot proceed, pause the affected ticket and ask the user for the specific missing information or authorization.

- Explicit user request: execute selected known regression or revalidation checks.

- Stale knowledge: revalidate on relevant use or in an authorized bounded idle-time pass.

- Authorized idle-time background checks: run only after the project has opted in to background testing and authorized its application/environment scope. Background checks are OFF by default.

Targeting and scheduling:

Select checks using feature and workflow dependencies, recent changes, historical failures, business criticality, risk, memory staleness and run cost. Limit execution by time, action count, browser workers, retry count and request rate. Avoid broad application recrawls. Respect project priorities, active ticket jobs, shared test-data isolation, permission memory and safe execution windows. If a prerequisite or authorization is missing, skip or queue a targeted check rather than attempting an unsafe action. Checks must remain durable and recover safely across engine restarts.

Automatic operational self-healing:

QASpider may propose and, after independent verification, automatically version updates to operational knowledge such as renamed UI controls, valid locators, changed paths or URLs, stable navigation edges, compatible form interaction steps and authorized test-data setup routes. Preserve prior versions and evidence, avoid silent rewrites of in-progress runs, and re-run relevant postconditions after repair. A working new navigation path is evidence that the path works, not proof that business behavior is correct.

Changes that must not be silently accepted:

Changed validation rules, calculations, mandatory fields with new semantics, account or role permissions, security behavior, removed functions, and any deviations from authoritative acceptance criteria. The agent should investigate and report these as possible business changes or regressions. Only an authorized source can change authoritative expected behavior; an LLM cannot redefine the expected result to make an old test pass.

Regression and change-impact reporting:

For every detected change, identify the affected project/environment, optional build when actually known, previous and current observed behavior, associated ticket/requirement, impacted known scenarios, evidence, and current confidence. Clearly distinguish (a) operational changes successfully revalidated and self-healed, (b) suspected application regressions needing QA review, and (c) potentially impacted workflows not yet tested. Do not present untested impacted workflows as passing. Include follow-up test recommendations and specific incomplete/blocked reasons.

Provider and interface independence:

The engine owns revalidation scheduling, policy evaluation, persistent knowledge revisions, and reports. Studio, CLI and MCP expose consistent status and controls. Known compatibility checks and approved regression replay should run without LLM calls. Invoke a supported reasoning provider only where exploration, ambiguous changes or failure diagnosis warrants it.

Acceptance criteria:

1. An existing verified workflow detects a renamed control, repairs its operational locator after independent verification, and preserves its business assertions and revision history.

2. Removing an expected validation message is reported as a suspected regression rather than learned as a new requirement.

3. A new ticket or an unexpected mismatch during its execution triggers relevant targeted checks without requiring a build identifier or exhaustive crawl.

4. With background validation disabled, no idle-time checks execute. With opt-in enabled, checks honor authorization, rate/resource budgets and the active QA work queue.

5. Background checks cannot perform unauthorized writes or conflict with active ticket data; one blocked check does not block independent tickets.

6. Reports clearly distinguish revalidated repairs, suspected regressions, and unverified impacted workflows.

7. Memory and scheduled-check state survive engine restarts; known regression scenarios can execute with zero LLM calls.

## 21. Ticket-Driven Adaptation Without Release Metadata

Core acceptance example: QASpider receives a ticket to test image upload. Its saved navigation memory says login requires username and password. The live application now shows a one-field, passwordless sign-in flow. No build identifier, deployment event, repository access or CI/CD integration is provided.

Expected behavior: (1) Detect the mismatch while trying to reach the upload feature; preserve evidence of the prior and current UI. (2) Use safe, bounded exploration and existing credentials/authorized test channels to understand the new sign-in steps, such as a one-time code or magic link, without bypassing authentication or accessing external messages without authorization. (3) If successful, verify access to the intended feature, record a versioned operational-memory revision and resume image-upload testing. (4) Whether login succeeds or not, prominently report that the prerequisite authentication flow changed; label it an observed change with unknown business intent, not an automatically approved feature change. (5) If unable to complete authentication safely, pause/mark the upload ticket blocked and ask the user only for the missing credential, supported verification method, authorization or clarification. Do not guess a code or silently claim test success. (6) Continue other independent tickets when possible. (7) Leave the QA engineer to decide from the change report whether passwordless authentication was expected; preserve previous business expectations until an authoritative source changes them.

Design implications: Application memory is a reusable hypothesis about current operation, not a permanent assumption. Operational self-healing and business-change detection are separate outputs. Prerequisite changes are visible findings even when downstream ticket testing ultimately passes. Current UI evidence is sufficient to trigger targeted investigation; release metadata remains optional.

## 22. Layered Reporting and Integrated QA Review Center

Decision: Select Option B (Layered Reporting) and Option B (Integrated QA Review Center). QASpider remains autonomous in test execution, exploration and investigation, but an authorized QA reviewer owns final signoff and confirmation of business changes. The engine stores one persistent, structured source of truth for report data, evidence and decisions. CLI, MCP and Studio must expose consistent outcomes and review state.

Three reporting layers:

1. QA Summary (default): ticket identifier and goal, coverage and acceptance-criteria mapping, pass/fail/blocked/inconclusive counts, suspected defects, incidental discoveries, key risks, readiness status and required human actions.

2. QA Investigation (on demand): expected-versus-actual behavior, reproduction steps, test-data references, safe retry and failure-investigation history, confidence/classification and remaining coverage gaps.

3. Technical Evidence (on demand): screenshots, Playwright traces, sanitized network and browser logs, execution timeline, operative navigation revisions, and linked source evidence. Protect secrets and personal data; evidence access is authenticated and project-scoped.

Independent reporting dimensions: The ticket's verification result must be distinct from discoveries in prerequisite or adjacent workflows. If image upload passes but QASpider discovers that username/password login has changed to passwordless login, report upload coverage as passed and authentication as an observed change/risk requiring an authorized decision. Do not silently accept observed behavior as intended, and do not mark unexecuted cases as passing.

Live communication: Persist progress, discovery, action-required and review-ready events. Routine agent operations belong in a low-noise timeline. Interrupt the user only for actionable missing input, authorization or review decisions. Pausing one dependent ticket must not stall independent ticket jobs. Closing CLI/Studio/MCP clients must not lose events, jobs or review state.

Integrated Review Center: Offer a queue of tickets and findings ready for human review, including defects, incidental changes, false positives, blocked tests and coverage gaps. The reviewer can confirm a defect, reject a false positive with a reason, classify an application change as expected/unexpected/unknown, request a targeted retest, leave a finding inconclusive, and explicitly grant or withhold QA signoff. 'Ready for QA Review' is never equivalent to 'QA Approved.' QASpider must not sign off its own work.

Review-to-memory governance:

- Confirmed defect: preserve expected and actual evidence, affected scenarios, reproduction steps, and defect history. Do not learn a defective observation as a correct business expectation.

- Rejected false positive: preserve the original finding and rejection reason; use verified reviewer feedback to improve locator, investigation and classification heuristics without erasing history or changing expectations by default.

- Expected change: record reviewer, authority, scope, rationale, timestamp and evidence. Only the relevant authoritative expectations may be revised through a versioned, traceable decision; don't indiscriminately rewrite all related assertions.

- Unexpected change: retain previous authoritative expectations, flag a possible regression and prioritize linked follow-up coverage.

- Inconclusive decision: retain uncertainty and review status; never convert unknown outcomes into PASS.

- Request retest: create a new linked execution with fresh evidence while preserving all original results and revisions.

- Review corrections: append a superseding auditable decision and permit authorized rollback of resulting memory revisions rather than destructive editing.

Review and export surfaces: CLI provides concise summaries, commands to inspect details, list pending decisions and submit review actions. MCP exposes structured job/report/review resources with the same safety and authorization enforcement. Studio provides the prioritized QA Work Command Center, activity timeline, evidence drilldown and review actions. Structured JSON is canonical; offer human-readable HTML and Markdown exports, JUnit XML for test-result consumption, and access-controlled evidence links. PDF may be deferred.

Work handoff: A consolidated summary shows completed, running and blocked tickets, confirmed/suspected defects, discovered changes, pending authorizations, outstanding review decisions, coverage gaps, and verified operational knowledge gained. It must distinguish the agent's recommendation from human approval.

Acceptance criteria:

1. A ticket with passing image-upload checks and an unrelated changed login workflow shows those as separate outcomes and highlights the login change even when downstream testing passes.

2. A reviewer rejects a false positive: evidence and decision history remain accessible, and verified feedback can improve future diagnosis without rewriting authoritative expectations.

3. A reviewer confirms an expected business change: the changed expectation is linked to an authorized, scoped and reversible revision.

4. Retesting creates a linked new run and never overwrites the original result or evidence.

5. Blocked, incomplete and inconclusive checks are never silently converted to PASS or QA Approved.

6. CLI, MCP and Studio report consistent execution status, finding classification and reviewer decisions.

7. Final QA signoff requires an authorized human decision; QASpider cannot self-approve.

8. Report artifacts and review decisions persist across engine and interface restarts, with proper project/role access controls.

## 23. Orchestrator-First Studio UI and Persistent Conversation Threads

Decision: QASpider V3 Studio uses a Common QA Orchestrator as the default homepage and primary conversation interface. Remove the separate Projects and Review Center pages from the main sidebar; retain project switching in the header and integrate reviews into contextual orchestrator messages and ticket details. Primary navigation: Orchestrator, QA Tickets, Knowledge, Settings. The Studio remains an optional client of the persistent engine; closing the browser must not stop jobs.

A. Chat-first QA intake and coordination: Users request testing of one or multiple tickets, investigation, retesting, progress and findings through a common QA Orchestrator conversation. No separate required ticket-submission form. The orchestrator parses requested tickets into the same validated, durable, structured ticket model used by CLI and MCP. It presents concise editable inline previews where ticket boundaries, requirements, project/environment or proposed risky actions need explicit confirmation. Users can start authorized tasks quickly without repeatedly approving routine operational learning.

B. Common orchestrator and delegated jobs: One conversational entry point plans, tracks and summarizes independently persistent ticket executions. Each ticket owns its status, evidence, test-data constraints and outcome. Orchestrator interactions can request status of any permitted project ticket, even if created from another chat or CLI/MCP. Known deterministic regression steps run without an LLM; orchestration is not one permanently running LLM per ticket.

C. Thread management: Sidebar includes New Chat, Recent Chats, thread switching, rename, archive and search. A thread is created on first meaningful user message, avoiding empty-thread clutter. Threads are scoped to a project and persist in engine storage with message history, links to jobs, references to generated plans, findings and reviewer decisions. Thread switching preserves per-thread context but does not halt engine jobs. Search supports titles, ticket identifiers and messages with project permissions enforced. Archiving or deleting a chat cannot delete underlying ticket executions, reports, evidence or verified application memory. Destructive deletion policies for conversation records must be explicit and audited.

D. Human intervention through conversation: Action-required messages include ticket, cause, impact and exact requested input. Natural-language replies may clarify scope and request permitted actions; authoritative approvals, sensitive data submission and final QA signoff require typed, authenticated, scoped engine operations rather than relying on LLM interpretation alone. Passwords and OTPs must never be retained in conversational history, reports or knowledge. One blocked ticket must not stop independent ticket jobs. Low-noise activity milestones and inline cards replace frequent modal interruptions.

E. Inline review and signoff: The orchestrator can answer 'show findings awaiting review,' display evidence-backed finding cards and accept structured reviewer classification (expected change, possible regression, unresolved, confirmed or rejected defect). Authorized QA signoff may be initiated in conversation after displaying scope and evidence, but is recorded through the same audited review service consumed by CLI/MCP. The separate Review Center UI is removed, not the underlying review queue, safety policy or signoff workflow. Ticket details retain evidence, history and review outcomes.

F. Ticket and Knowledge screens: QA Tickets is the durable operational queue for multiple tickets, filtering, status, pause/resume/cancel/retest, test cases, findings, activity and evidence. Knowledge displays learned routes, workflows, setup prerequisites, expectations, confidence, staleness and historical revisions in human-friendly terms. Project selection is in the header; Settings controls environments, credentials integration, execution budgets, concurrency, permissions and optional background revalidation.

G. Engine ownership and cross-interface parity: Chat threads, messages, typed actions, ticket plans, event streams, report data and review decisions live in the engine, not solely local browser storage. Studio, host CLI and MCP share persistent project-specific resources. Chat context and project knowledge are separate: the orchestrator retrieves relevant knowledge instead of transferring whole transcripts into model prompts. Network reconnection and engine restarts must recover durable state without replaying unsafe actions.

Acceptance checks: (1) Start a new conversation, ask to test three tickets, review a structured inline plan and launch independent jobs. (2) Create and switch between chats while the jobs continue. (3) A second thread can report the status of a ticket started from the first. (4) Archive the original chat without deleting QA evidence or application memory. (5) Ask 'show findings awaiting review' and record an authorized decision that is reflected in ticket details. (6) Persist chats, job state and review history across Studio closure/reconnection and engine restart. (7) No secret values are persisted in messages or logs. (8) Orchestrator, CLI and MCP all operate on the same engine ticket and review resources.

Implementation boundary: This section finalizes product/UI direction; the next section will detail orchestrator backend lifecycle, durable state, planning and delegation. The standalone browser prototype is illustrative rather than connected-engine verification.

## 24. Event-Driven Common QA Orchestrator Backend

Decision: Run an event-driven orchestrator inside the persistent Node.js engine, shared by Studio, CLI and MCP. It manages durable conversations, ticket planning, job coordination, findings and human requests. Invoke an AI provider only for reasoning; verified Playwright regression scenarios can run without an AI call.

Commands request work; events record outcomes. Persist job state transitions and corresponding versioned events atomically in SQLite. Use command idempotency keys, event identifiers, per-job event ordering and reconnectable replay. Event delivery may be repeated; consumers must deduplicate. Do not promise exactly-once execution of external browser actions.

Decision: Configurable worker pool (Option B), with initial suggested limits of three concurrent workers globally and two per project. Scheduler verifies dependencies, permission scopes, test-data ownership, resource locks, and execution budgets before assigning workers. Use durable leases, heartbeats and fencing tokens to reject outdated worker commits. A worker may be available, claimed, preparing, executing, checkpointing, completed, suspended, blocked, paused, cancelled or failed. Release safely releasable resources while a ticket awaits input. One blocked job must not stall independent work.

Decision: Autonomous reconciliation after interruption (Option B). Journal a consequential operation and expected postcondition before attempting it. After a crash, inspect persisted checkpoints and use authorized bounded observations to verify external outcomes. Resume only verified-safe work; never blindly repeat uncertain or potentially irreversible changes. Otherwise mark the affected job blocked/inconclusive and request the specific missing authorization or input. Preserve evidence, budgets, operation identity, ticket links and historical results across restarts.

Persistence requirements: project-scoped chat threads and messages, orchestrator turns, accepted plans, jobs, job events, dependencies, leases, resource locks, operation journal, checkpoints, action requests, findings, review decisions and durable artifact references. Studio closure cannot stop engine jobs. CLI, MCP and Studio retrieve the same states and reports.

Acceptance checks: Studio disconnect does not interrupt jobs; engine restart reconciles safely; no duplicate job from repeated commands; no blind duplicate test-user creation after a crash; conflicting resources do not overlap; stale workers cannot commit; OTP-blocked work does not stall independent tickets; eligible AI-free regressions run when an AI provider is unavailable; unresolved recovery never reports PASS.

## 25. Autonomous Ticket Workers — Adaptive Planning and Escalation

Decision: Autonomous Ticket Workers (Option B) with Adaptive Execution Planning (Option B). The common orchestrator interprets requests, assigns independent ticket missions, coordinates jobs and communicates with users. Workers independently plan, navigate, test, investigate and propose knowledge updates within assigned authorized scope. The scheduler, deterministic permission service and knowledge service enforce shared rules. Human reviewers alone provide final QA signoff.

Worker assignment: durable job, project and environment identifiers; objective; original requirements and sources; authorized scope and exclusions; applicable knowledge snapshot; test-data and permission policy references; resource constraints; duration, action, retry and AI budgets; plan revision. Workers obtain relevant context through scoped services rather than directly editing shared memory.

Adaptive planning: A worker may change selectors, navigation routes, compatible setup paths, authorized test-data preparation, scenario order, bounded retries and relevant risk-based coverage. Record significant plan revisions with reason and evidence. Never silently change the ticket objective, authoritative acceptance criteria, expected business behavior, permissions or limits. Discovery of a changed authentication workflow while testing image upload is a separate observable risk even if navigation adapts and upload tests pass.

Escalation rules: Level 1 — worker independently resolves authorized navigation changes and safe investigation. Level 2 — orchestrator/scheduler handles shared resources, cross-ticket dependencies and competing operational revisions. Level 3 — human receives a contextual chat request when missing authorized access, permissions, verification method or essential business clarification prevents safe progress. Other independent tickets continue.

Coordination uses durable validated events, not continuous AI-to-AI conversations. Representative events include WORKER_PROGRESS, PLAN_REVISED, WORKFLOW_CHANGED, RESOURCE_CONFLICT, ACTION_BLOCKED, FINDING_RECORDED, KNOWLEDGE_VERIFIED and JOB_READY_FOR_REVIEW. Events carry job/project context, correlation identifiers and evidence references.

Shared learning: workers send observations to the knowledge service for verification, applicability scoping and versioned updates. Other workers may use a revision at a safe checkpoint after checking environment, role and tenant compatibility. Operational navigation learning does not authorize business expectation changes. Preserve original failures and prior memory history.

Acceptance checks: deterministic known tests work without AI; safe locator changes can be repaired; unexpected passwordless login is investigated and reported separately; relevant negative/boundary coverage is added without rewriting requirements; shared-account conflicts are serialized; unsafe actions require authorization; one blocked worker does not block others; verified memory can help another worker; interruptions trigger safe reconciliation; major plan changes and escalations are auditable.

Implementation status: These sections define the approved V3 target architecture. Actual repository support must be verified during implementation planning.

## 26. Studio Final Design Reference — Orchestrator-First Prototype

The final selected Studio UX reference from the design discussion is the standalone HTML prototype named qaspider-studio-v3-orchestrator-chat-threads.html (produced in the ChatGPT conversation, not stored as a linked Drive attachment in this PRD). It supersedes earlier form-first and separate Review Center prototypes. For implementation, obtain that exact prototype file from the conversation artifacts or ask for it to be provided with the repository; do not assume the PRD contains the HTML bytes or a permanent public URL.

Reference UX decisions: (1) Common QA Orchestrator chat is the landing page and primary way to assign QA work; structured ticket preview and approvals appear inline. (2) Persistent project-scoped chat threads support New Chat, recent threads, search, rename, archive, switch and resume. (3) Project switcher appears in the header, not as a separate Projects sidebar page. (4) No separate Review Center navigation: review cards, finding classification and final human signoff are surfaced in orchestrator chat and per-ticket details, while review records stay engine-owned. (5) Main sidebar is Orchestrator, QA Tickets, Knowledge and Settings. (6) QA Tickets provides queue, scenario coverage, findings, activity and evidence; Knowledge shows verified application understanding and revisions. (7) One thread can reference tickets from another and archiving chat must not delete ticket evidence or memory. (8) Human interventions use a contextual conversation with typed and safe approval controls, rather than unrelated popups or a mandatory ticket intake form.

Reference status: Approved product direction and interaction model; interactive HTML prototype is illustrative only, with simulated backend behavior. Exact visual tokens, responsive breakpoints and component implementation should be visually reviewed against the referenced HTML before frontend coding. Sections 22 through 25 are the functional and backend source of truth where the illustrative prototype differs from security, persistence or execution requirements.

Final Studio design reference uploaded to Google Drive:

https://drive.google.com/file/d/1DUoLPm5xJMOX8jEHW3b46ETEwhgOcGIy/view?usp=drivesdk

Drive folder: QASpider V3. This is the retained standalone HTML prototype supporting Section 26 and the orchestrator-first Studio implementation. Preserve this file as the visual and interaction reference when creating the Codex implementation plan.
