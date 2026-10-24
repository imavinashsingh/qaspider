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
