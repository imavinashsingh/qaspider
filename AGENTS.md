# QASpider verification gates

Keep work within the milestone authorized by the user. M2 completion does not authorize M3.

Before changing provider adapters, isolation settings/process handling, or provider context construction, run `npm run verify:provider` to establish a current baseline. Run it again after the change, together with `npm run typecheck` and `npm test`. Set `QASPIDER_CODEX_BIN` to the installed absolute Codex CLI path when needed. This verification uses only synthetic data and a loopback mock model endpoint; it must not send application context to a real model.

Retain the private wire requests, process-exit/timeout/cancellation receipts and synthetic context-sanitization receipt emitted under `.qaspider/provider-validation/`. Keep the tracked hash manifest in `validation/m2-isolation-recheck.json`. Do not overwrite the original real-planning validation record or treat saved receipts as permission to bypass the runtime isolation gate. If capability checks fail, fail closed before sharing application context.

Dashboard bootstrap URLs contain a bearer token. Never put reusable tokens in public links, tracked files, logs intended for sharing, or screenshots. After exposure, restart the viewer, verify the previous token returns 401, and keep the replacement bootstrap URL in a private ignored file. The browser must clear the token fragment before screenshot capture. Preserve existing staged and working-tree changes.
