# Local benchmark demo

Use two terminals, Node 24 and a built project. Everything below targets the included loopback fixture app.

Terminal 1:

```sh
BENCHMARK_FIXTURE_TOKEN=local-test-only-token npm run benchmark
```

Terminal 2:

```sh
npm run build
node dist/packages/cli/src/main.js init --workspace /tmp/qaspider-demo
node dist/packages/cli/src/main.js doctor --workspace /tmp/qaspider-demo
node dist/packages/cli/src/main.js settings --workspace /tmp/qaspider-demo --file examples/beta/artifact-settings.json
node dist/packages/cli/src/main.js map http://127.0.0.1:4317/ --workspace /tmp/qaspider-demo --role guest --build demo-1 --config examples/navigation-guest.json --depth 1 --interval 0
BENCHMARK_FIXTURE_TOKEN=local-test-only-token node dist/packages/cli/src/main.js view --workspace /tmp/qaspider-demo --port 4319
```

Open the plain local URL printed in Terminal 2, complete first-run administrator setup, log in, and select the demo project. Review the guest graph, scope and verification evidence. Select verified transitions and explicitly approve the reviewed batch. In Test Studio use the registration Markdown from examples/m2/registration.md, select guest/build demo-1 and save a story revision. Use local benchmark permissions only for this included fixture app. The viewer command above supplies the benchmark-only fixture token to its process.

For actual Codex planning, stop the viewer and relaunch it with your installed absolute QASPIDER_CODEX_BIN and existing local Codex authentication. Run npm run verify:provider first. The CLI must pass isolation; unsupported versions fail closed. No additional AI provider installation is required. In Settings → AI Providers select the operator-approved executable and explicitly allow sanitized context sharing. Generate a plan, inspect scenario data/actions/assertions and inferred expectations, edit if needed, select the authoritative requirements and approve the exact revision. Execute without AI and inspect Test Runs for assertions and screenshots. Raw traces remain local and are not served through the dashboard.

The workflow requires human review; do not automatically approve provider output. To demonstrate all flows without any AI account, stop the manual benchmark, then run npm run test:smoke. It starts an isolated benchmark and executes explicitly labeled synthetic plans, role isolation, negative defect detection, consent learning, promotion, rollback and MCP replay. See tests/smoke/learning.spec.ts and workspace.spec.ts for executable examples.

MCP read-only example: serve --mcp --workspace /tmp/qaspider-demo --authorization examples/m4/mcp-authorization.json using the compiled CLI. This is a stdio process for a compatible client, not a browser URL; the example grants read only for benchmark/development/guest/demo-1/public. Expand grants only after owner review. Actual SDK client/server round trips are covered by npm test.

Close the viewer and benchmark with Ctrl-C when finished. Keep /tmp/qaspider-demo private or remove it deliberately after inspection. Never include credentials, private workspaces or raw evidence in screenshots/issues.
