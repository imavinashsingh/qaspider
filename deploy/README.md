# Engine and optional Studio deployment

Build with `npm ci && npm run build`. Node 24 is required. The engine owns the existing registry, provider settings, workspace databases, browser execution and artifacts. Studio is an optional HTTP client. The MCP bridge forwards structured requests over API v1 and contains no project database or QA runtime.

## Local migration and credentials

Stop legacy Studio, MCP and CLI writers before transferring a workspace to engine ownership. Back up the entire Studio home and each workspace including artifacts while stopped. Start the engine with the same home (`QASPIDER_ENGINE_HOME`) and approved project roots (`QASPIDER_PROJECTS_ROOT`); the existing registry/settings and checksummed workspace migrations are reused. No automatic moving of workspace paths occurs. Restore the full stopped backup to roll back; newer schemas must not be opened by older binaries. Legacy CLI is retained for V2 only and must not write engine-managed projects.

Create projects and configure application access using the existing Studio UI. The engine still provides engine-owned administrator login/setup APIs; the separate Studio process serves the existing UI and forwards same-origin cookie/CSRF requests. It has no project volume. New chat UI is Phase 5.

The operator supplies a private mode-0600 JSON `QASPIDER_ENGINE_AUTH_FILE` containing an array of principals:

```json
[{"id":"qa-tool","kind":"agent","tokenHash":"<SHA-256 hex of a randomly generated token>","projects":["<registered-project-UUID>"],"actions":["read","plan","execute"]}]
```

For a fresh installation with no project UUID yet, start with a valid principal whose `projects` is an empty array and `actions` is `["read"]`; it grants no project access. Use the engine-owned administrator setup through optional Studio (or its cookie/CSRF admin APIs) to create a project, then explicitly add its UUID/actions to the authorization file and restart the engine to load those grants. No QA jobs need to run during this initial setup.

Generate a cryptographically random token of at least 32 characters using a local secret manager; never put it in a command argument, URL, checked-in file or log. Store only its SHA-256 in the engine auth file and its plaintext in the bridge's private connection file. No grants are inferred. Project UUIDs come from the engine-owned Studio registry/API. Edit credentials offline and restart the engine to reload principal configuration. Agent principals cannot gain `manage` or `review` authority by listing those actions. Human operations require `kind: human` issued by the operator.

For the host bridge, `QASPIDER_ENGINE_CONNECTION_FILE` points to private JSON:

```json
{"endpoint":"http://127.0.0.1:4318","projectId":"<registered-project-UUID>","token":"<private token>"}
```

Configure the MCP client to start `node /absolute/install/dist/packages/bridge/src/main.js` with that environment variable. This is the bridge process launcher, not a standalone QASpider QA CLI. The bridge requires Node and the MCP SDK/Zod dependencies only. After building, run `node scripts/package-bridge.mjs` to prepare `dist/mcp-bridge`; install that local package on the host with `npm install /absolute/path/dist/mcp-bridge` and configure the `qaspider-mcp` launcher. No QA CLI package is delivered. API errors never include credentials. HTTP v1 rejects incompatible versions; loopback is the default deployment boundary.

Run the engine with `npm run start:engine` and optionally Studio with `npm run start:studio-client`; create the approved project-root directory first. `QASPIDER_ENGINE_HOME`, `QASPIDER_PROJECTS_ROOT` and `QASPIDER_ENGINE_AUTH_FILE` must resolve to the intended retained paths. `QASPIDER_ENGINE_URL` selects the engine for Studio. Provider availability is truthful: deterministic replay works without a provider, while Codex planning still needs explicit consent, an operator-approved executable and successful runtime isolation.

## Containers

From the project root, `docker compose -f deploy/compose.yaml up --build engine` starts only the engine; add `--profile studio` before `up` to include Studio. Both published ports bind host loopback. The engine data volume retains the registry, projects and evidence; Studio has no data volume. Stop Studio independently without stopping the engine. Avoid `down -v` when retaining data.

The auth-file bind mount must be readable by container UID 1000 while remaining mode 0600. Existing workspace imports must be copied into the persistent volume under approved roots while stopped, with registry paths mapped explicitly; a host registry referring to host-only absolute paths is not automatically portable. Do not mount unrelated directories or provider credentials. Codex provisioning inside the engine image is not assumed: a container must independently satisfy the existing operator setup/consent/isolation gate before real planning. Docker build installs the lockfile's Chromium version; provider-free execution is independently usable.

Engine and Studio run as non-root with dropped capabilities. Engine health uses the read-only unauthenticated `/healthz` route; versioned QA APIs require credentials. No remote ingress is enabled by default. Container builds and volume recreation must be verified in a Docker-capable environment before claiming container acceptance.

## Optional existing Codex provider

The engine image intentionally contains no personal login. To reuse an operator-approved, already authenticated Linux Codex installation, review `deploy/compose.codex.yaml` and set `QASPIDER_CODEX_EXECUTABLE_FILE` and `QASPIDER_CODEX_AUTH_FILE` to the exact host executable/auth-file paths. Combine both Compose files (`-f deploy/compose.yaml -f deploy/compose.codex.yaml`). Only that auth file is mounted read-only; no whole home/configuration directory is shared. Its ownership/mode must allow engine UID 1000 to read it privately. The executable must be compatible with the container OS/architecture and support the existing isolation flags. No credential is baked into an image or printed.

The operator must explicitly enable sanitized context sharing in the engine-owned provider settings. Before sharing any application context, the actual executable still has to pass the synthetic runtime isolation gate inside that container; an unavailable/incompatible provider blocks planning. These optional mounts are supplied for configuration and were not activated during container acceptance, which verifies AI-free execution only.

For headless administrative clients, the engine also retains the cookie/CSRF setup, login and project-management HTTP operations under the historical `/api/studio/` namespace. They are engine-owned and usable without running the optional Studio process. The normal visual setup path uses Studio as their client. MCP agent credentials cannot perform administrator bootstrap or impersonate the local administrator.

In engine mode, existing Studio MCP enable/restore controls are replaced by host-bridge setup. Legacy enabled preferences do not launch a second database-owning process. The setup pane deliberately uses host-path placeholders, because paths inside an engine container are not host installation paths.
