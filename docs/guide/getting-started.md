# Getting Started with QASpider

Welcome to **QASpider**, the autonomous story-driven web QA engine and testing studio. This guide walks you through installation, initializing your first workspace, and launching the Studio and Engine.

---

## Prerequisites

- **Node.js**: `v24.x` (enforced via `.nvmrc` and `package.json engines`)
- **npm**: `v10+`
- **Operating System**: Linux, macOS, or Windows (WSL recommended)
- **Browser**: Chromium (installed via Playwright)

---

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/imavinashsingh/qaspider.git
cd qaspider

# Install dependencies cleanly
npm ci

# Typecheck and build all workspace packages
npm run typecheck
npm run build

# Install Chromium browser binaries for Playwright
npx playwright install chromium
```

---

## Verifying the Installation

Run the test suite to ensure your environment is fully functional:

```bash
# Run unit & integration tests
npm test

# Run Playwright smoke tests
npm run test:smoke
```

---

## Workspace Setup & CLI Tour

QASpider keeps its state (graphs, stories, executions, SQLite database) in an isolated workspace folder.

### 1. Initialize a Workspace

```bash
node dist/packages/cli/src/main.js init --workspace /tmp/qaspider-workspace
```

### 2. Verify Health (Doctor)

Check that prerequisites, browsers, and directory structures are sound:

```bash
node dist/packages/cli/src/main.js doctor --workspace /tmp/qaspider-workspace
```

### 3. Onboard a Project

Seed the workspace with onboarding targets and baseline test stories:

```bash
node dist/packages/cli/src/main.js onboard \
  --workspace /tmp/qaspider-workspace \
  --file examples/m4/onboarding.json
```

---

## Launching QASpider Studio

QASpider comes with a headed React-based Studio for visually observing executions, managing story journeys, and inspecting test step artifacts:

```bash
npm run start:studio
```

The Studio will launch and open your default browser to view the active test run, graph visualizer, and execution logs.

---

## Running the V3 Engine & MCP Bridge

QASpider V3 provides a persistent background Engine and a Model Context Protocol (MCP) server so coding assistants (Codex, Claude, etc.) can run autonomous QA loops:

```bash
# Start the persistent QA engine daemon
npm run start:engine

# Start the MCP bridge server (connects IDE / Agent to the Engine)
npm run start:bridge
```

---

## Next Steps

- Explore [Story-First Planning](/STORY-FIRST) to understand how user journeys translate to deterministic tests.
- Learn about [Studio UX and workflows](/STUDIO).
- Read the [V3 Engine Architecture](/V3-ENGINE) to see how MCP and autonomous QA loops operate.
