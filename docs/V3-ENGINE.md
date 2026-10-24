# V3 engine behavior and API

The engine is the single owner of project services and durable state. [Deployment](../deploy/README.md) covers process/container setup and credentials. V3 clients are MCP and optional Studio; the existing V2 CLI is not a V3 product interface.

## Durable ticket workflow

API v1 project resources live below `/api/v1/projects/{projectId}/`. Credentials authorize named projects/actions. Browser administrator sessions can use the same resources with cookie login, same-origin checks and CSRF protection. Agent principals cannot approve plans, reusable permissions, review or final signoff, even if an operator incorrectly lists those actions on an agent credential.

| Resource | Method | Behavior |
| --- | --- | --- |
| `tasks` | POST/GET | Submit `commandKey` and `tickets` containing markdown, sourceRef, context, optional strategy and existing prerequisite IDs; list durable tickets. |
| `task?id=…` | GET | Ticket, linked jobs, blockers and action requests. |
| `task-jobs`, `task-job?id=…` | GET | Durable scheduler jobs, lease/fence state and result references. |
| `task-events?id=…&after=…` | GET | Up to 1,000 ordered versioned job events after a sequence. Delivery may repeat; deduplicate by event ID and continue from last sequence. |
| `task-control` | POST | Idempotent pause/resume/cancel. Completed/uncertain external work is not blindly replayed on resume. |
| `task-requests?id=…` | GET | Missing requirements, test-data guidance, plan-review and other blockers. |
| `task-clarify` | POST | Idempotently answer a request; optional reuseKey and environment credential-reference names save scoped guidance. Replanning is queued; this does not grant access or change business authority. |
| `task-access`, `task-approve` | POST | Human-only lifecycle configuration and exact plan-hash/requirement/access approval. Changed configuration creates a new revision requiring review. |
| `task-reconcile` | POST | Human-only evidence/cleanup reconciliation; releases uncertain resource locks only after known safe outcomes. A new execution remains explicit. |
| `task-execute` | POST | Idempotently queue the exact approved ticket plan. |
| `threads`, `messages`, `thread`, `thread-search` | GET/POST as applicable | Persist, search, rename and archive project threads/messages. First message creates a thread. There is no destructive conversation-deletion endpoint. |
| `data-memory` | GET | Review saved user-provided nonsecret setup guidance and credential-reference names. |
| `permission-memory`, `permission-revoke` | GET/POST as applicable | Human-only creation/revocation of exact scoped authorization memory with actor/reason/history. |

MCP tools mirror task creation, inspection, execution, events, controls, clarification and conversation operations. The bridge never grants its own authority. Existing approved-workflow MCP operations remain available. Studio's existing engine-owned QA services also submit planning/execution to this scheduler; the new conversational UI is Phase 5.

Incomplete source requirements create Needs Clarification rather than speculative executable assertions. Ticket markdown accepts the existing `# Title`, `## Acceptance Criteria`, `- AC-1: …` format. Guidance from a clarification is separate from authoritative business expectations. For missing criteria, supply the complete source-backed ticket text as the answer. For missing data, supply safe setup guidance and credential reference names, never secret values. Store secret values through the operator's environment/secret manager; chat is not a credential input channel. The engine rejects recognizable inline secrets and redacts known environment secrets on intake, but cannot establish that arbitrary free text is nonsensitive; follow the typed-reference contract.

## Scheduling, authorization and recovery

Default worker pool is three globally and two per project, configured by `QASPIDER_WORKERS` and `QASPIDER_PROJECT_WORKERS`. Each worker holds a durable lease, heartbeat and fencing token. Stale workers cannot publish a completion. Existing task dependencies wait for explicit human-reviewed prerequisites. Execution currently locks an environment/tenant conservatively; unproven data isolation serializes work rather than assuming separate sessions make shared data safe. Planning and independent project jobs can progress while another task waits.

State transitions and their events are committed together in the engine SQLite database. Source stories/plans remain in each project's existing checksummed database. Cross-database transitions are reconciled through durable references: source import uses a ticket-specific source reference so interrupted retries retrieve the created revision instead of generating a second ticket. Engine commands provide idempotent submission, not exactly-once external browser actions.

Before execution, record the operation journal and then its run reference before any browser action. Lease expiry blocks uncertain work and retains its resource lock. A persisted complete run can reconcile without repeating external actions. Uncertain writes never automatically retry. Existing scoped QA interruption cleanup/review remains required for uncertain fixtures; unresolved work stays blocked/inconclusive. Graceful engine shutdown requests cancellation/checkpointing before closing project databases.

Reusable allow decisions initially cover exact low-risk read endpoints only, last at most 24 hours, and match the full story scope. Denials can cover the same exact operation identity for other supported operation kinds. Current explicit plan decisions take precedence over reusable memory; revoking remembered authority prevents its future use but does not revoke an independently approved one-time plan decision. Every execution still checks current scope/policy and permissions at the browser/network gate. Consequential operations require explicit plan-bound authority. This conservative first policy avoids inferring authority from learned application behavior.

The initial provisioning policy is configured accounts and approved setup/cleanup endpoints. If data cannot be safely prepared, only the affected ticket asks for input. User-provided reusable setup guidance is scoped to project and exact application/environment/build/roles/tenant/flags; credential values and OTPs are excluded. Phase 3 retrieval supplies compatible guidance to later planning, without granting privileges.

## Knowledge, adaptation and investigation

Phase 3 adds a project/scope-filtered SQL/graph/FTS5 knowledge index. Retrieved context is bounded, carries source/evidence references, distinguishes approved requirements from observations/guidance and marks stale items. It passes through the existing final context sanitizer and runtime provider isolation gate. Setup guidance supplied in an earlier answer is available to later compatible tickets. No vector database is required.

A ticket whose specified criteria exactly match an approved plan in the same complete context may reuse that plan only when all criteria were approved and a full successful execution still has available evidence. The requested story and reused plan remain separately linked. Changed criteria, scope, unavailable evidence, superseded plans or newer setup guidance prevent this shortcut. The engine invokes no provider for the known-regression path; execution still verifies live navigation and authorization.

Set `explore: true` on intake only when the principal has `explore` authority. Safe revalidation is bounded to configured origins/controls, up to 30 states, 100 actions, 500 requests and 30 seconds per role. Deep mode increases navigation depth within the same limits. Build metadata is optional at intake (development is the default identity); an observed mismatch can trigger checking within the existing scope. The engine independently replay-verifies safe transitions before recording an operational-policy promotion. Existing memory approval/rollback history remains intact.

Verified navigation-target revisions retain original target IDs, new IDs, evidence and revision references. Runtime adaptation is restricted to uniquely matching normalized URL/headings/dialogs and verified navigation; it never edits approved scenario assertions, expected values or grants. Arbitrary form-locator repairs, passwordless/OTP channel discovery and general unfamiliar-app provisioning are not assumed safe: unresolved access becomes an explicit scoped request. Observed workflow changes retain unknown business intent until human classification, even when downstream testing passes.

Known tests run in severity order without changing their assertion set. Execution/investigation has a configurable `QASPIDER_JOB_TIMEOUT_MS` (default 120,000; maximum 3,600,000). Original failures and all attempts remain persisted. Additional investigation repeats at most three read-only scenarios once; state-changing scenarios receive only their approved retry budget. Findings distinguish suspected application defects, automation issues, environment issues, data issues, flaky behavior and uncertainty. A later passing observation does not overwrite the original failure.

`knowledge?id={taskId}`, `changes?id={taskId}` and `investigations?id={taskId}` expose scoped context and observations. MCP provides corresponding inspection tools and `revalidate_task`. Human-only `revalidation-config` enables a persisted idle schedule for a selected task, at intervals of one hour to seven days. No schedule exists or runs by default. Checks use the shared queue/locks and wait for foreground work to drain; incomplete revalidation stays visibly blocked rather than passing.

## Canonical reports and human review

`ticket-report?id={taskId}` is the source for client report views. It separates current authoritative coverage, scenario counts, unapproved AI hypotheses/assumptions, original execution, suspected findings, incidental changes, investigations, evidence references, linked retests and review history. Changed source/plan revisions cannot inherit an old run's PASS. Unknown/incomplete work stays visible. `handoff` summarizes project tickets, pending requests, risks, gaps and operational knowledge gained.

`report-export?id=…&format=json|markdown|html|junit&layer=summary|investigation|technical` returns a structured export envelope with content and MIME type. HTML/XML escape untrusted text; non-passing inconclusive/blocked/flaky/unexecuted JUnit cases are skipped with their original status, not counted as passing. JUnit also includes human review state and report hash. Evidence links require project authentication; raw traces remain restricted. PDF export is deferred.

Human-only `review-finding` accepts scoped finding classifications (confirmed defect, rejected false positive, inconclusive, resolved after retest) and change classifications (expected, unexpected, unknown, inconclusive). Expected changes require an authority reference. Decisions append history and link the superseded decision; they never overwrite the original test result or observation. Rejected false positives can become scoped diagnostic guidance for subsequent planning, not authoritative expected behavior. A finding is resolved after retest only when a linked fresh run passes that scenario.

`task-retest` queues a compatible approved plan and links the old run to the new job/run. Old reports, attempts, failed assertions and evidence remain accessible. `task-replan` requests additional coverage or planning against a revised source; active work must be paused first. Ordinary clarification answers cannot approve a plan. Authenticated human plan/access approval remains a separate operation, available through the existing Studio plan review and engine APIs.

`qa-signoff` explicitly approves or withholds QA against the exact report hash. Only authenticated human principals or protected local administrator sessions can use it. Approval requires current source/plan execution, passing applicable coverage, no active work, available evidence and resolved findings/classified changes. Agent completion is separate. A new execution, plan/source revision, review correction or evidence availability change makes prior signoff stale. Signoffs and review decisions are append-only.

`revise-expectation` requires a current source revision, one specified criterion, new text, an explicitly confirmed authoritative source and rationale. It creates a new immutable story revision and an audited expectation revision; other criteria and old runs remain unchanged. `rollback-expectation` creates another source revision restoring the immediately linked prior criterion. These operations require stopped/reconciled work and fresh plan review/execution. They cannot silently modify assertions to pass a failed test.

MCP exposes canonical reports, exports, handoffs, linked retesting and replanning. It cannot self-approve or impersonate a human reviewer. The same human review HTTP operations are available to protected Studio sessions and administrative clients. Phase 5 will add the new chat-first review cards and conversation UI; Phase 4 does not claim those screens are implemented.

## Validation boundaries

Tests use owned local benchmark applications and clearly labeled synthetic planning/storage fixtures, with actual Chromium, MCP protocol and Docker execution. Provider isolation uses the real installed Codex executable against a synthetic local model endpoint. No V3 real-model ticket batch, new provider integration or optional container credential mount is claimed verified. The five-ticket product acceptance and productivity measurement remain Phase 6.

The initial execution capability set is typed fills/clicks and text/visibility/HTTP assertions. Unsupported actions, arbitrary form repairs, unfamiliar authentication channels and unconfigured data provisioning stay blocked for explicit input or a future typed capability extension. Environment/tenant execution remains conservatively serialized; the implementation does not claim arbitrary unfamiliar applications can already be tested without operator setup.

Engine-backed Studio shows forwarding-bridge setup in its MCP pane and suppresses the legacy standalone QA command panel. It never restores or starts legacy database-owning MCP processes, including when migrating an old enabled preference. V2 Studio behavior is retained only in legacy mode. Approvals made through existing Studio plan review are reconciled into V3 ticket/request state; no duplicate permission prompt is required after an actual approval. The proxy serves built assets both when imported from source and when deployed as compiled code.

MCP `get_evidence` reads authenticated project/run-bound screenshots or sanitized event artifacts from both QA and navigation runs. The bridge and engine enforce an 8 MiB delivery limit; raw traces remain restricted. Report links use the same authorization checks and never carry bearer credentials.

User-supplied setup answers remain provisional guidance until independently checked; remembering an answer does not certify it as an observed fact or grant permission. Protected human diagnostic review corrections retain their own verified provenance.
