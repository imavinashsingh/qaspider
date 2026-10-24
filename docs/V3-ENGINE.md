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
