# VNext security boundaries and limitations

## Enforced at this checkpoint

The existing sandboxed Electron renderer/preload, fixed IPC handlers and sender-frame/URL checks remain. New profile channels accept bounded strict schemas. Agent IDs and USER_STATEMENT authority are generated in the main process; renderer input cannot choose them. Profile changes use optimistic versions and immediate transactions. Topic notes are selected with project-scoped SQL, and unsent task text clears when switching project/conversation.

Existing immutable originals/approved revisions, exact approval hashes, grounded schemas, separate prepared-origin authorization, one-use preparation, fresh scenario sessions, origin/control restrictions and independent assertions continue to govern execution. The new profile layer cannot approve, execute or change a plan. Environment notes do not become a browser capability. Archive is organizational and does not claim to cancel a running task or revoke existing authorization.

Migration snapshots precede VNext schema changes in existing M8 stores, use private modes and independently checked integrity, and fail closed on backup failure. Original evidence identities and old approval records are preserved.

## Data authority

| Material | Authority and handling |
| --- | --- |
| Project note/description | User context, awaiting validation; no automatic requirement promotion |
| Existing approved ticket | Human-approved business expectations, immutable revision |
| Browser observation | Untrusted page material; no security authority |
| Saved assertion/report | Deterministic measured result with original evidence |
| Verified M6 workflow | Operational eligibility within exact compatibility scope |
| Future document extraction | Untrusted source text with citations; not instructions to tools |
| Agent graph checkpoint | Turn/phase references; never approval or browser authorization |

## Current limitations

Read-only model-backed project chat is now available with strict ownership predicates, bounded context, source validation and an external-tracing fail-closed gate; see [Main Agent security and limits](vnext-main-agent.md). Independent browser/chat/status lanes were tested together. Document ingestion, protected credential references, formal environment/role administration, durable task leases, controlled browser cancellation and Software Graph promotion are pending. Notes are plain local text; this checkpoint does not add comprehensive secret detection, encryption or automatic redaction of arbitrary prose. The UI asks users to leave credentials out. A bounded sanitized selection of project notes is now passed to the configured provider when the user sends a Main Agent message. Credential-shaped input is rejected and retrieved known secret shapes/URL state are redacted; this does not guarantee detection of arbitrary secrets in prose.

Existing screenshot masking covers form controls, not sensitive text elsewhere on a page. Origin filtering is not comprehensive browser network isolation. Public-site form submission remains prohibited. No public login execution is claimed. The existing read-only global knowledge-list handler is renderer-filtered; it is not reused by Main Agent tools. The Main Agent has separate project-predicated backend queries; the old diagnostic handler is still not a multi-user access-control boundary. The trusted desktop user can manage multiple projects; current IPC is not a multi-user access control system.

## Pending implementation requirements

Future agent tools must retain project ownership checks on every plan/report/evidence/reference lookup and scoped memory query. The Main Agent's three read-only tools already enforce these predicates. Allowlist structured decisions and validate inputs and outputs; document text cannot select privileged policies. Keep model checkpoints small, reference-only and credential-free. Configuration suggestions require validated explicit human decisions when security-sensitive. Reuse existing isolated provider preparation; do not enable native CLI tools for graph routing.

Browser scheduling must establish one durable owner, fresh authorization and action identity before allowing concurrent browser mutations. The independent read-only chat lane does not own browser resources or relax browser serialization. Future task recovery must expire leases and mark uncertain actions INTERRUPTED; do not automatically retry consequential operations. Browser cancellation must preserve partial evidence and close browser/provider resources. These remain gates for the Testing Agent checkpoint.

## Rollback

For an immediate presentation rollback use Settings → Developer tools and migration fallback → Open legacy workspace, or `QASPIDER_DESKTOP_LEGACY_UI=1 npm run desktop`. Data is retained. For binary rollback, close Desktop and copy the complete current private data directory somewhere safe. Run an older binary only with a copy of an appropriate pre-migration snapshot; never overwrite the current store or delete companion tables. Keep current data for returning to this version. There is no automatic down-migration.
