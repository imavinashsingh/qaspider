# M5.1 Studio operator and developer guide

## Start and first-run setup

Use Node 24.x and build first. The default registry is ~/.local/share/qaspider/studio/studio.db, separate from every workspace database. Override it with QASPIDER_STUDIO_HOME or --home for Studio/projects/recovery commands. Use the same environment for init, Studio and MCP processes.

```sh
npm ci
npm run build
mkdir -p /tmp/my-qa-projects
npm run cli -- studio --projects-root /tmp/my-qa-projects --port 4319
```

Open the plain local URL. Create the single administrator with a new 12–128 character password, then log in. There is no default password. No setup/login credentials are supplied through URL/CLI arguments. Stop older viewer processes first; running pre-M5.1 code cannot gain new authentication without restart. An occupied port fails closed; select a free port.

Studio uses Node/OpenSSL scrypt with a random 32-byte salt, N=32768, r=8, p=3 and a 64-byte output. Sessions use random 256-bit opaque cookies, hashed session identifiers in private SQLite, synchronizer CSRF tokens held only in browser memory, absolute eight-hour expiry, rotation on login and revocation on logout/recovery. Anonymous CSRF sessions expire after fifteen minutes. Five failed/login attempts per fifteen-minute window trigger a persisted limit. Cookies are HttpOnly, SameSite=Strict, Path=/, with Secure when the request socket is TLS. The supported listener is loopback HTTP; TLS/proxy deployment is not provided or authorized. Host/Origin checks do not authorize proxy/tunnel exposure.

Static login assets are public; all project/global data APIs require a session. Mutations additionally require exact Origin, JSON and session-bound CSRF headers. Studio passwords and sessions are separate from target authentication and never enter graph/provider context. The local OS account, its private files and environment are the trust boundary.

## Projects and CLI interoperability

```sh
npm run cli -- init --workspace /tmp/my-qa-projects/project-a --name 'Project A' --origin http://127.0.0.1:4317
npm run cli -- projects list
npm run cli -- view --workspace /tmp/my-qa-projects/project-a --projects-root /tmp/my-qa-projects --port 4319
```

Normal CLI init registers the canonical workspace in the user registry. Embedded runCli callers may pass an empty environment to suppress global user state. Studio refreshes Projects to see new CLI registrations. Browser create/import operations accept paths only below the startup-approved project root, reject traversal and symlinks, and never scan the filesystem. To import elsewhere, explicitly register the path from the local owner CLI or restart Studio with the appropriate approved root.

Create Project collects name, workspace directory, exact application origin, environment display name and optional role secret-reference names. The initial application/environment IDs remain benchmark/development for CLI compatibility; application display name and origin identify your target. Default guest/admin/user roles use the standard QASPIDER_* environment references. Optional references must be uppercase variable names, never credential values. New workspace creation requires a nonexistent directory; failed initialization removes only the new directory it created. Existing imports validate migrations and retain records/evidence. Backup before updates.

A stable project UUID identifies a canonical workspace. Rename changes registry display metadata, not historical application records. Archive/unregister hides it without deleting any workspace files; explicit registration restores its original UUID. Last-opened and last-selected project persist. Each project request includes its explicit ID, so switching/remounting clears client data without redirecting existing operations or canceling work in other projects. Archived/unknown IDs cannot open project APIs. Local owner CLI and explicitly authorized MCP remain separate access channels, not browser session APIs.

## Recovery

Recovery is local operator-only, has no HTTP endpoint, and requires --confirm-local-recovery. Stop Studio first for operational clarity. Read a new password without echo in bash and pipe it through stdin; do not put it into command arguments/history or tracked files:

```sh
read -r -s -p 'New Studio password: ' STUDIO_NEW_PASSWORD
printf '%s\n' "$STUDIO_NEW_PASSWORD" | node dist/packages/cli/src/main.js studio recover --confirm-local-recovery
unset STUDIO_NEW_PASSWORD
```

Use --home if you started Studio with a custom home (or the same QASPIDER_STUDIO_HOME). Recovery replaces the password hash, clears the login limiter and revokes every existing session. It does not change target credentials, provider authentication or project data.

## MCP and AI settings

Settings → MCP shows actual build/authorization-file diagnostics and the selected project. The generated config includes an absolute CLI entry, canonical --workspace, explicit .qaspider/mcp-authorization.json and registry home. Create that authorization file locally with strictly reviewed scopes/actions; no grants are generated automatically. Test MCP stdio connection uses the actual SDK client to initialize/list tools, without requesting application data. It does not introspect an existing external client. A separate external MCP process stays pinned to its startup workspace even when Studio switches.

Codex uses a [mcp_servers table in config.toml](https://developers.openai.com/codex/mcp); Studio provides a matching copyable snippet and JSON for compatible clients using mcpServers. This client connection is independent from QASpider's tool-free Codex planning subprocess.

Settings → AI Providers supports global defaults, explicit project overrides and return to inheritance. Only Codex and Disabled are enabled choices. Claude/Gemini executable presence can be reported, but their adapters remain deferred/unverified. Approve the Codex executable through an absolute QASPIDER_CODEX_BIN or PATH at Studio startup; browser input cannot launch an arbitrary executable. To change the binary, stop/restart Studio with the intended operator environment. Model IDs are bounded and validated; planning timeout is 1–120 seconds. Credentials remain in existing Codex authentication and CODEX_HOME references, never in Studio JSON.

Context sharing defaults off for registered projects. Explicit permission is required for sanitized story/navigation planning; AI-free execution remains available. Verification is synthetic-only, keeps private receipts under the Studio home, and reports only a non-secret summary. Saved verification binds to settings and binary hash. Every actual planning adapter still performs its runtime isolation check. Settings changes apply to newly started planning jobs; jobs retain the adapter/configuration they started with. CLI/MCP use the same registered project defaults/overrides without changing process-global environment values. Unregistered legacy CLI workspaces keep the existing explicitly invoked Codex behavior.

## Schema, validation and limits

packages/studio/migrations/001_studio.sql is a separate checksummed global migration: studio_values, sessions, projects, provider_settings, plus studio_migrations tracking. Project migrations 001–005 remain unchanged. Registry directories use 0700; database/WAL/SHM files use 0600. Project schemas and artifact policies retain their existing safeguards.

Run typecheck, build, npm test, npm run test:smoke and npm run verify:provider with the documented browser/provider executable environment. The Studio E2E performs actual browser mapping/execution, isolated project reads, background work, restart, login/logout, actual MCP diagnostics and conditional actual Codex verification when installed; CI without Codex explicitly tests unavailable status instead. A separate mandatory local provider gate retains sanitizer/tool/timeout/cancellation receipts.

Single administrator only; no remote hosting/OAuth, multi-user access control, automatic MFA, crash recovery or optional provider support. CSRF tokens live in browser memory; no credentials/session tokens are placed in localStorage/sessionStorage. Raw artifacts remain private. A complete report and sanitized screenshot/evidence references are in validation/m5-1-report.json. No publication or M6 work is included.
