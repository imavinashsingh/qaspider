# VNext implementation report — Project Main Agent checkpoint

Date: 26 October 2026 (India). **The Main Agent checkpoint is implemented and ready for review. The complete VNext initiative remains unfinished.** The previously accepted project-foundation checkpoint is preserved below as historical context. No commit, push, release or publication was performed; the accepted staged changes were preserved.

## Current checkpoint outcome

Desktop now has a **Main Agent** view for an existing project conversation. It uses a real four-node LangGraph, the existing isolated Codex CLI, bounded sanitized project/chat context, strict structured tool decisions, project-scoped read-only QA/report/FTS tools, validated source references and durable conversation/thread history. Loading, unavailable-provider and invalid-output states are explicit. The existing Conversations plan/review/execution flow and legacy route are retained. Chat cannot execute browser actions, edit/approve plans, change settings or create Testing Subagents.

The SQLite compatibility gate is resolved by the official SqliteSaver 1.1.0 plus a narrow driver adapter for the existing built-in node:sqlite API. The official saver still owns checkpoint SQL/serialization/pending writes. Node and actual Electron both pass persistence/thread probes. New unit coverage includes pending writes, interrupt/resume, history, deletion, privacy modes and restart reconciliation. Native-addon rebuilding and an external system-Node worker were evaluated and avoided. See [the full decision, graph, tool contracts and file/function guide](vnext-main-agent.md).

## Verification for final source

| Gate | Observed result |
| --- | --- |
| Desktop unit tests | PASS — 120 tests, including 9 new Main Agent/checkpointer tests |
| Desktop browser/Electron suite | PASS — 55 tests, final full run 2.7 minutes |
| Root unit tests | PASS — 76 tests |
| Desktop and root typechecks | PASS |
| Desktop and root builds | PASS |
| Existing provider isolation before and after context changes | PASS — synthetic only, tools disabled, timeout/cancellation processes exited and sanitized context verified |
| Native saver reproduction | Node PASS; Electron FAIL with ABI 137 versus 150 |
| Adopted built-in driver / official saver | Node PASS and Electron PASS |
| Real signed-in provider through actual Desktop | PASS — project isolation, stored tools, exact history/thread persistence and unchanged approval hash |
| Concurrent inference/browser capture/status | PASS — synthetic inference transport with a real held browser navigation and independent IPC reads |
| Missing provider, wrong-project scope, unsupported tools, invalid citations, credential shapes | Rejected or honest unavailable/error states; no invented success |
| External tracing environment | Fails closed before provider inference; the upstream local-only override alone proved insufficient |
| Root browser smoke | Not run for this checkpoint; historical M8 root-browser limitations remain historical |

The new Electron test creates real saved browser evidence via the existing owned controlled runner, then verifies the Main Agent reads it. Its model responses are explicitly synthetic. It holds model inference and a real browser capture simultaneously and confirms read-only status/settings retrieval stays responsive, settings mutations are blocked during a reply, and neither lane releases the other's resources. The existing browser mutation serialization remains intact.

## Real-model demonstration

The final real CLI run completed in **63.18 seconds** from desktop launch through five replies and restart, excluding setup of the pre-existing-runner report. It made **7 structured inference calls**, with **78,443 CLI-reported total tokens**. These are reported token counts for this demonstration, not a cost/performance benchmark. Synthetic-provider token values are not included.

- Project A summarized its saved code and receptionist/clinician notes with project/note citations.
- Project B returned only its own saved code and accurately reported that no clinician roles were recorded; Project A's code/context was absent.
- The Main Agent listed actual QA plans, read a saved report and searched project-scoped registration knowledge. Source IDs match the stored report and verified workflow revision.
- The underlying report came from actual owned-browser execution by the existing runner: two passing scenarios, six executed assertions and twelve evidence references. Its fixture-reviewed expectations were synthetic; this was not new AI test planning or Main Agent browser execution.
- Electron restart preserved the exact chat history and supervisor thread. A fresh post-restart model reply used the correct project context. A forged cross-project conversation request was rejected. The approved plan's hash remained unchanged.

The report explanations remain model output; saved deterministic runner verdicts and the actual QA-status panel remain authoritative. No public site login was attempted.

## Changes and persistence

New implementation files: `electron/agent-checkpoints.mjs`, `agent-context.mjs`, `agent-store.mjs`, `main-agent.mjs`, `src/AgentChat.tsx`; fixed typed IPC additions in main/preload/chat types; narrow normal-shell navigation and profile-text updates. Test/demo helpers live under tests/scripts and are not production website mappings.

Two additive tables, `desktop_agent_threads` and `desktop_agent_turns`, associate existing message IDs with stable conversation/supervisor identities, idempotent request IDs, inference states, citations and metrics. A private pre-migration snapshot is integrity-checked. Checkpoints use a separate private SQLite file and contain only turn IDs/phases. Restart marks incomplete turns INTERRUPTED; it never silently resumes inference or browser actions. No plan hashes, approvals, report/evidence identities or existing M6 tables were rewritten.

Direct dependencies added and pinned: `@langchain/langgraph` 1.5.2, `@langchain/core` 1.3.0, `@langchain/langgraph-checkpoint-sqlite` 1.1.0 and `langsmith` 0.11.1, all MIT. The explicit LangSmith dependency is used only to supply a local tracing context; external tracing is not enabled. Added transitive package versions/licenses and the observed zero-vulnerability npm audit are listed in `validation/vnext-main-agent-persistence.json`. The official saver still declares better-sqlite3 transitively, but Desktop never constructs that driver. No new database server, native rebuild, browser engine or API-key dependency was introduced.

## Evidence and reproduction

Sanitized retained evidence is under `validation/vnext-main-agent-evidence/`: real-provider and synthetic receipts, real-model screenshots and a synthetic concurrency UI screenshot. `validation/vnext-main-agent.json` summarizes commands, metrics and artifact hashes; `validation/vnext-main-agent-persistence.json` reproduces native failure versus adopted-driver success. Private SQLite stores, raw CLI receipts and isolation wire requests remain ignored. The existing tracked provider-isolation manifest was refreshed, without replacing historical real-planning receipts.

```sh
npm run typecheck --workspace @qaspider/desktop
npm run desktop:test
npm run desktop:smoke
npm run typecheck
npm test
npm run verify:provider
node apps/desktop/scripts/verify-langgraph-runtime.mjs --builtin
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron apps/desktop/scripts/verify-langgraph-runtime.mjs --builtin
# Explicit real signed-in CLI demonstration; uses a dedicated ignored private data directory:
node apps/desktop/scripts/verify-main-agent-live.mjs
```

To try it, run `npm run desktop`, select a project/conversation, then choose **Main Agent**. Save optional project context in **Conversations → Project profile**. Ask about the project, saved QA reports or known workflows. Use the existing Conversations controls for plan preparation/review/execution.

## Remaining limitations and review boundary

The model can produce an inaccurate explanation despite valid citations; it cannot turn that prose into a saved QA verdict. Retrieval is bounded: latest 50 displayed turns, up to 6 completed context turns, up to 10 short project notes, 10 plans/2 recent reports each, and 8 workflow revisions. Report tools expose counts/status/references, not raw page text or screenshots. Text sanitization detects known credential shapes and URL state but is not a comprehensive secret-recognition system. Local data are private files, not encrypted. External tracing-enabled environments deliberately make the Main Agent unavailable.

One inference reply runs at a time; there is no chat streaming, task queue or user-facing chat cancellation control. Shutdown cancellation and interrupted-turn recovery are supported. Chat does not automatically extract durable facts from prose, modify project roles/environments or prepare plans. Role/environment metadata in retrieved workflows are informative; future reuse must still enforce executor compatibility and separate action authorization. Existing diagnostic global-list APIs are not reused as agent tools and remain outside a multi-user security model.

Testing Subagents, document ingestion, task scheduling/leases, Software Graph implementation, broader supervisor tools and the complete VNext acceptance suite remain pending and were not started. **Stop here for Main Agent checkpoint review.**

---

## Historical accepted project-foundation checkpoint


Date: 26 October 2026 (India). **The complete VNext initiative is unfinished.** This is a recoverable architecture/project-foundation checkpoint, as allowed by the assignment. No commit, push, release or publication was performed.

## Delivered

Repository inspection and a written implementation plan preceded code modifications. The audit distinguishes already implemented M8 consolidation from new VNext work. Six architecture documents now explain service reuse, data ownership, agent lifecycles, Software Graph design, security and this checkpoint.

Desktop now supports optional project descriptions, rename, reversible archive/restore, a persistent unique supervisor identity, explicit user-sourced context notes and progressive optional questions with durable skips. The project profile appears in the existing conversation workspace. Conversation/task planning remains the existing M8 path. Unsent request text clears when switching project/conversation. No LLM process is started just because a project exists.

Three additive companion tables preserve initial/subsequent profile history and user-note provenance. Existing M8 stores get a private, integrity-checked snapshot before the new migration. Backup failure aborts opening. Existing project IDs, conversations, approvals, report IDs, M6 workflows and legacy fallback remain intact.

This implements a **subset of Phase 1**, alongside Phase 0 audit/documentation and an initial dependency feasibility assessment. Free-form notes use explicit topics; natural-language onboarding, authoritative structured roles/environments, knowledge extraction and full project configuration are not implemented. Phase 0 adoption feasibility remains open until the Electron checkpointer packaging gate is resolved.

## Dependency and compatibility evidence

No repository dependency or lockfile changed. An isolated npm installation evaluated LangGraph 1.5.2, core 1.3.0 and SQLite saver 1.1.0, each declaring MIT. The registry exposes compatible Node/Zod peer ranges. Full transitive dependency/license and vulnerability review remains required before adoption.

The reproducible `apps/desktop/scripts/verify-langgraph-runtime.mjs` probe passed graph invocation, SQLite close/reopen continuation and distinct threads in Node 24.11.1. The same install failed under Electron 45.0.0: better-sqlite3 was built for ABI 137, while Electron requires ABI 150. See `validation/vnext-langgraph-feasibility.json` for exact observed results. This is a packaging gate, not a conclusion that LangGraph is unsuitable. No alternative framework, new browser engine or custom checkpointer was introduced.

Next evaluate a reproducible Electron-native build or a supported isolated Node worker, then test packaged startup/restart and synthetic structured provider decisions. Do not rebuild the root shared native module opportunistically. The existing isolated CLI supports text JSON inference without native tool calls; graph service dispatch compatibility is a design proposal until tested.

## Verification

| Gate | Result |
| --- | --- |
| Desktop unit tests | PASS: 111 tests, including 7 new project-foundation tests |
| Desktop typecheck | PASS: final source |
| Desktop build | PASS |
| Root typecheck | PASS |
| Root unit tests | PASS: 76 tests |
| Root build | PASS through provider verification |
| Provider isolation | PASS: tools disabled, timeout/cancellation exited, context sanitization verified; synthetic only |
| Full desktop browser/Electron suite | PASS: 54 tests in the final full run (2.3 minutes) |
| Isolated LangGraph Node persistence | PASS; no inference |
| Isolated LangGraph Electron SQLite | FAIL; native ABI mismatch, no repository adoption |
| New real-provider VNext workflow | NOT RUN; no Main Agent implementation |
| Root browser smoke | NOT RUN in this checkpoint; historical M8 results are not new validation |

The first focused UI attempt exposed a collapsed profile after a version-key remount. The implementation now preserves the details component across profile revisions and refreshes form fields explicitly. The corrected real Electron regression passed in both a focused run and the final complete suite. The restart check also led to explicit textarea label associations; a test race reading the selected project before creation completed was fixed by waiting for the actual selected option. Existing pre-consolidation migration fixture setup was extended to remove new companion tables when constructing its historical database; its preservation assertions remain intact.

## Required scenario assessment

| Scenario | Checkpoint evidence / pending work |
| --- | --- |
| A: onboarding | Actual UI profile, user role note, optional prompts, identity/conversation restart and isolation regression; formal roles/environments and model-backed onboarding pending |
| B: file intake | Pending; no parsers or upload UI installed |
| C: complete execution | Existing M8 synthetic inference + real Electron/browser regression retained; no Testing Agent delegation implemented |
| D: multiple tasks | Pending; no task registry, queue or independent chat during execution |
| E: Software Graph | Existing M6 reuse regression retained; graph learning and changed-UI graph validation pending |
| F: recovery | Project/conversation/profile restart covered; task lease/checkpoint/uncertain-action recovery pending |
| G: safety | Existing approval, origin, unsupported-action and evidence regressions retained; new graph/task security tests pending |
| H: public demo | Not assessed in this checkpoint; existing selected-site submission prohibition remains. No public login PASS claimed |

The historical M8 real-provider demonstration is documented in `apps/desktop/MILESTONE-8.md`; it is not a VNext real-agent receipt. New screenshots/receipts concern actual project UI and the retained synthetic-model controlled workflow only.

## Acceptance criteria still unfinished

Persistent LangGraph Main Agent and Testing Task graphs; validated agent tools; structured provider dispatch; bounded project memory retrieval; document intake and exact source extraction; source-aware requirement analysis; new context references bound to approval; task registry/events; assignment identities; durable leases/priority/queue; controlled pause/cancellation; responsive model chat during execution; uncertain-action reconciliation; Software Graph revisions/promotion/divergence and navigation retrieval; task/graph dashboards; protected test-data references and project-scoped configuration. All model/task/graph end-to-end acceptance and realistic scenarios B/D/E/F/H need new evidence.

Existing grounded planning, human review, separate action authorization, deterministic assertions and M6 reuse are reused capabilities, not newly completed VNext phases. Unsupported tests remain blockers under existing execution policies.

## Metrics and receipts

New profile onboarding uses zero model calls and zero browser executions. The isolated graph probe performs zero model calls. Planning/discovery/execution durations and reuse metrics for the retained controlled workflow are emitted by `test-results/desktop-live/consolidation/receipt.json` when its regression runs; its synthetic token values must not be described as production usage. Aggregate actual planning/grounding tokens remain unavailable in existing IPC contracts. New graph entries: zero, because graph learning is unimplemented.

Retained public checkpoint evidence: `validation/vnext-project-foundation-evidence/receipt.json`, its two screenshots, `validation/vnext-langgraph-feasibility.json`, and `validation/vnext-project-foundation.json`. Private databases and raw provider wire receipts remain ignored. The refreshed tracked provider-isolation manifest is `validation/m2-isolation-recheck.json`.

## Resume and rollback

Follow `vnext-architecture.md` in phase order. Resolve dependency packaging and finish Phase 1's structured project context before exposing a model-backed supervisor. Run provider isolation before/after changing provider context. Keep approval and permission authorities outside graph state. Introduce one durable browser owner before relaxing the mutation lock. Finish source-aware planning and task recovery before graph learning or final UI acceptance.

For normal use run `npm run desktop`, open Project profile and save optional context. Existing New conversation → Prepare test plan remains usable. Settings retains the legacy workspace route. For binary rollback retain the complete current private data directory and use a copy of a pre-migration snapshot; no tables are deleted by the application.

Final validation: all 111 desktop unit tests, all 54 desktop browser/Electron tests, all 76 root unit tests, both typechecks, both builds and synthetic provider isolation passed. The native Electron SQLite feasibility probe remains a recorded failure; it is not part of the adopted application runtime.
