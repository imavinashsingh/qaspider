# M5 measurements

Measured on this local Linux host with Node 24.11.1 and installed Playwright Chromium; source baseline M4 32c53be plus M5 validation tests. Three fresh workspaces, guest, depth 1, same benchmark and Registration destination. Full local traces enabled. See validation/m5-benchmarks.json for every raw numeric sample and IDs.

| Work | Median wall time | Browser actions | Requests |
| --- | ---: | ---: | ---: |
| Fresh discovery | 991.50 ms | 18 | 40 |
| Persisted approved replay | 672.45 ms | 2 | 5 |

Replay reduced actions 88.89% and requests 87.5%. Discovery uses the harness browser; replay starts a separate CLI/browser process. These are different workloads (explore all safe depth-one links versus retrieve one approved path). The comparison demonstrates saved discovery work for a known destination, not equivalent exploration coverage or a general speed guarantee. All 3/3 samples verified the destination and ran with Codex unavailable.

One actual learning acceptance sample: baseline discovery including workspace setup 1251.40 ms; targeted consent exploration 1762.29 ms (31 actions, 66 requests); fresh-process approved replay 708.12 ms; UI rollback acknowledgment 60.49 ms. Promotion is explicitly reviewed, duplicate defect remains detected, old requirements remain unchanged, and a reopened workspace rejects the rolled-back path. This is one functional sample, not a statistical learning-performance baseline. See validation/m5-learning-benchmark.json.

The original six-scenario approved real-Codex M2 plan was replayed in 2887 ms in a new process: 6 PASS, 0 FAIL/BLOCKED/INCONCLUSIVE/FLAKY/NOT RUN, provider canary untouched, plan hash and requirements unchanged. That private historical plan is not distributed; see validation/m5-full-suite-replay.json and docs/DEVELOPMENT.md.

No model planning latency, paid-provider cost, concurrency capacity or cross-platform performance was measured in M5. Repeat the commands in docs/DEVELOPMENT.md to obtain new results; do not treat these samples as production SLAs.
