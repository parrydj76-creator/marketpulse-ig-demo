# MarketPulse AI v13.0 — Broker Safety & Recovery Lab

## Installation
1. Back up the GitHub repository and Render environment configuration. **Do not delete or reset PostgreSQL.**
2. Replace the root `server.js` with the included version (based on the v12 build). Add `v13-safety.js` to the repository root.
3. Add `public/v13.html` to the `public` folder. Optionally add `tests/v13-safety.test.js`.
4. Preserve all existing `v9-paper.js`, `v10-readiness.js`, `v11-execution-lab.js`, `v12-validation.js`, `push-alerts.js`, `public/sw.js`, dashboards, and database.
5. Commit to GitHub and deploy on Render. Open `https://marketpulse-ig-demo.onrender.com/v13`.
6. Enter ADMIN_TOKEN **only in your deployed app**, then run Overview, Read-only IG checks, Recovery diagnostics, and View preview journal.

## Safety limitations
- `openDemo` in server.js retains its unconditional throw; no IG order POST calls are added by v13.
- V13 creates two PostgreSQL tables, one for a **halted-by-default** preview safety flag and one for deterministic, unique PREVIEW_ONLY intents. It does **not** create executable orders.
- The V13 safety halt applies **only to V13 previews**. It does not pause the separate v9 paper-trading engine or close any IG position. Use v9's own Pause control for paper entries.
- No unhalt endpoint exists. There is no way to start V13 preview submission through the UI.
- Read-only IG market data is insufficient to prove actual contract value, GBP-per-pip conversion, margin or executable size. No broker size is computed.
- The recovery diagnostic checks database state but **does not prove** restart recovery, concurrent workers or broker order acknowledgement.
- A future execution build must separately implement and test a global broker kill switch, idempotent reconciliation, monetary verification, and explicit approval.
- Do not share ADMIN_TOKEN, IG keys, or raw account identifiers.

## Local validation
`node --check server.js && node --check v13-safety.js && node --test tests/v13-safety.test.js`

## Rollback
Restore the previous v12 `server.js`. The v13 tables can remain unused; no existing data is modified.
