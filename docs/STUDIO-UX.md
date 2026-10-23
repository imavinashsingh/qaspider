# Studio workflows (M5.2)

Run `npm ci` and `npm run start` with Node 24. Open the printed local Studio URL (default http://127.0.0.1:4319/), complete administrator setup, then log in. Use `npm run start:demo` when you also want the isolated development benchmark. Restart the running Studio after building an update; browser refresh alone does not replace its backend.

## Find your work

The sidebar stays consistent across project and global pages. The header shows the selected project and **New Test**. On small screens the sidebar becomes a horizontally scrollable navigation strip; the header retains project selection, New Test and Logout. Keyboard users can skip to content and tab through labeled controls.

A **project** is a local workspace and its evidence. An **application** is the product under test. An **environment** declares a permitted deployment and its exact origins. A **role** identifies an isolated test identity within that environment. Changing projects remounts project views; requests and background jobs remain pinned to their explicit project ID.

Projects supports Create, Open and Import. Create needs a project name, application URL and environment display name. The application origin is derived from that URL; credentials in URLs are rejected. A private directory is generated below the startup-approved projects root. Override the directory and credential-reference names under Advanced Settings when necessary. No IDs or passwords are required in basic onboarding. Authenticated discovery still needs explicit login locators, readiness assertions and external credential variables. The default discovery role is guest.

CLI-created workspaces appear after Refresh projects. Imports retain the original SQLite database, approvals and evidence. Open an imported project to land on Overview. Rename/archive live under Manage project; archive retains workspace files. Studio-created projects work with the same CLI (`doctor --workspace /absolute/workspace`).

## Discover and test

1. Select **Discover Application** from Overview or the project creation confirmation. Applications shows existing configuration and bounded discovery. Choose the role and build. Advanced Settings contains authentication/safe controls; undeclared origins and unknown forms remain blocked. Separate CDN/resource allowlists are not currently implemented.
2. In **Navigation Graph**, review state evidence and verified transitions. Select explicit transitions and approve the navigation batch. This does not approve business or security expectations.
3. Select **New Test**. Choose the discovered application/environment/build/tenant context and relevant roles. Enter Markdown acceptance criteria and save the story revision.
4. Review endpoint/fixture permissions under Advanced Settings. Generate a proposal with Codex only when you intend to share sanitized context. Settings → AI Providers controls executable availability, explicit context permission and synthetic isolation validation. The runtime gate still runs before context sharing. No synthetic provider is offered as a real AI alternative.
5. Review scenario titles, assertions, locators, requirement provenance and permissions. Edit titles directly; full proposal editing is available under Advanced Settings. Save edits as a new immutable revision, explicitly approve requirements and the displayed revision, then execute. Unsaved proposal changes disable approval and execution.
6. Progress, assertions, all six outcome classifications and local evidence come from actual persisted execution. **Open persisted test report** opens Test Runs. Overview lists recent reports and approved plans; its counts are queried from SQLite.

**Run Existing Test** selects an approved deterministic plan, shows its exact assertions and permissions, and executes without planning or provider access. It has no story/planning controls. This is also available from the approved-tests list on Overview. Full traces stay in the private artifact store; Studio exposes only the existing restricted evidence views.

## CLI & MCP

The dedicated page has separate **CLI commands** and **MCP integration** tabs. Search the 37-command reference and copy a snippet with the actual Node executable, built CLI entry and selected workspace. `node dist/packages/cli/src/main.js --help` uses the same reference. Automated checks compare documented flags against the strict CLI parsers. Examples containing `$VARIABLE` names or configuration filenames require your own scoped values/files. Built-in benchmark URL/role/build examples must be adapted for other applications; copied approval commands always require explicit review.

MCP documentation derives tools and configuration from the actual server. An external stdio client starts its own QASpider process and does not require the Studio toggle. The optional Studio-managed process has per-project lifecycle and real ping status; it is not a network endpoint. Empty authorization initialization grants no application access. See [Studio operator guide](STUDIO.md) for authorization, provider settings and local recovery.

## Verification and limits

The M5.2 Chromium acceptance test creates a workspace without IDs, discovers actual benchmark navigation, explicitly approves transitions, plans through an explicitly synthetic dependency supplied only by the test harness, edits/approves a revision, executes in Chromium, opens the persisted report and replays with a planner-call canary. It does not claim a new real-model planning verification. The production server keeps the existing verified Codex adapter; actual Codex synthetic isolation receipts are retained separately.

Desktop (1440px) and mobile (390px) screenshots cover authentication, Projects, Applications, Graph, New Test review, Run Existing, Test Runs, Overview, Memory, CLI/MCP and all Settings tabs. Screenshots, browser traces, SQLite databases and provider wire receipts remain ignored/private; tracked reports contain metadata and hashes. The graph canvas intentionally scrolls inside its container. Complex authentication, endpoint grants and detailed assertion edits still require advanced configuration. Studio remains a single-administrator local beta, with no proxy, remote hosting, multi-user service or M6 features added.
