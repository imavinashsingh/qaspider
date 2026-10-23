# QASpider local open-source beta — release preparation

Prepared locally; no repository, package or release has been published. Version remains private 0.0.0 until a separate release decision. Apache-2.0 source installation requires Node 24.x, npm, native better-sqlite3 support and Chromium.

Included: persistent safe navigation and AI-free replay; role/tenant/build scopes; story revisions and reviewed deterministic test plans; verified Codex planning isolation; artifact retention/quotas; evidence-backed governed navigation learning and rollback; React dashboard; scoped MCP SDK v2 stdio tools; owner CLI; local benchmark; repeatable browser benchmarks and CI.

Provider status: Codex is the required beta provider with actual CLI isolation receipts and prior real-planning evidence. FakeProvider is explicitly synthetic test infrastructure. Claude Code and Gemini CLI are deferred, unverified and unavailable in this validation environment. The owner explicitly made them optional for M5; no additional provider was installed or authenticated.

All previous migrations are preserved. Back up private workspace directories before updating. Changes from future schemas cannot be read by older binaries. Review scoped approvals and secret references after onboarding. Keep viewer bearer URLs private and never expose local services through a proxy/tunnel.

Limits: Chromium/Linux validation only; fixed typed assertions/actions; no automatic MFA/tenant switching; no automatic crash reconciliation; developer evidence outside workspace quota; conservative graph-diff impact matching; MCP stdio only; no optional provider adapters. No claim of production readiness, autonomous requirement correction or multi-provider compatibility.

Before public release: establish maintainers/private reporting, run the workflow on GitHub, re-audit dependencies and patched runtime, review licenses and screenshots, choose a version/distribution policy and rerun local Codex isolation. Publication requires separate approval.

Recommended M6 acceptance: explicit crash recovery for jobs/active artifacts/fixtures with fault-injection tests; larger multi-role benchmark baselines and repeatability bounds; install matrix on supported operating systems; maintained runtime/provider compatibility matrix and repeatable isolated Codex setup; evidence redaction tests; privately configured security disclosure; hosted CI pass on proposed release commit. Optional providers require separate authorization and demonstrated fail-closed isolation.
