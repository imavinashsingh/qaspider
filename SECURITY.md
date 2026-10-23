# Security policy

This is a local beta for explicitly authorized development/QA targets. The current beta line is the only maintained line. There is no hosted service or remote MCP endpoint.

Do not report vulnerabilities through public issues or attach browser traces, workspace databases, credentials, bearer URLs, cookies or storage-state files. For a repository with private vulnerability reporting enabled, use its Security → Report a vulnerability channel. If unavailable, contact its maintainer through an existing private channel and request a secure transfer method first. No public disclosure mailbox or response SLA is established for this unpublished checkout. Enabling private reporting and naming maintainers is a prerequisite to public release.

Provide a minimal synthetic reproduction, commit, environment, affected scope, expected boundary and sanitized impact. Preserve evidence privately; rotate exposed credentials and restart viewers to rotate tokens. Reproduce against the included benchmark, never against someone else's application.

Boundaries: loopback-only services; exact origin declarations; default-deny writes; explicit endpoint grants; role/environment/tenant/build isolation; reviewed immutable plan revisions; scoped memory approvals; private artifact modes/quotas/retention; no arbitrary provider code; no raw evidence in provider context or MCP exports. MCP grants are operator-controlled and default to none. Local operating-system users who can read the workspace or process environment are inside the trust boundary.

Known beta limits: active artifacts and orphaned files need operator reconciliation after crashes; developer test-results are outside managed retention; raw traces can contain session secrets; host checks do not make proxy/tunnel exposure safe; dependency audits do not prove absence of vulnerabilities. Do not use production credentials. Use a supported patched Node 24 release and keep Chromium patched. No optional AI provider is verified by its mere installation.
