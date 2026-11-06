# MarketPulse AI v11.0 — Execution Engineering Lab

## Important
**IG DEMO broker orders remain HARD BLOCKED.** This is a substantial read-only engineering upgrade, not an execution authorisation. It is designed to preserve the existing v9 paper database and push alerts. The new v11 journal contains PAPER events only. Never treat it as evidence of actual IG order lifecycle testing.

## Upgrade instructions (GitHub + Render)
1. Back up your current GitHub repo and Render environment configuration. Do NOT reset or delete your PostgreSQL database.
2. Upload/replace **server.js** in the repo root, **v9-paper.js** in the repo root, and add **v11-execution-lab.js** in the repo root.
3. Add **public/v11.html**. Keep existing **public/v10.html** (including your recent risk-audit display fix), **public/v9.html**, **push-alerts.js**, **public/sw.js**, and all other working files UNCHANGED.
4. Optionally upload `tests/v11-execution-lab.test.js`. Commit to main and deploy Render.
5. Open `https://marketpulse-ig-demo.onrender.com/v11` and enter your existing `ADMIN_TOKEN` only inside the app.
6. Press **Run safety overview**, **Sync paper journal**, and **Run read-only IG audit**. Send screenshots of results (hide any credentials).
7. Render restarts will pause new paper entries. Check any restored open position before re-enabling paper automation on `/v9` or `/v10`.

## What is new
- v11 iPhone-friendly dashboard and fail-closed readiness gates.
- PostgreSQL paper-event journal with stable event identifiers and deduplicating backfill from the existing v9 paper event table. No broker orders are created.
- Read-only IG market, accounts, and positions inspection; reports original units, never guesses GBP-per-pip or broker deal size.
- Local deterministic scenarios and a simulated position structural audit.
- **Important v9 fix:** open simulated positions can now close against a fresh verified IG streaming quote even if indicator history or 30-bar warm-up is temporarily unavailable. Entry signals still require verified historical bars.
- **Important v9 fix:** new simulated entries are rejected when planned open risk plus realised daily losses exceeds the daily risk budget.

## What is NOT complete
- A genuine broker order-intent lifecycle, broker-confirmed idempotency, broker restart recovery, and GBP-per-pip conversion remain unverified.
- Simulated fills exclude slippage and other execution costs. Stop orders are not guaranteed.
- No real broker orders are submitted, including IG DEMO. No order enable button or API endpoint is introduced.
- Existing v9 paper logic assumes a single active Render worker. Multiple replicas and crash-during-transaction scenarios require separate integration tests.
- The paper journal backfills up to 10,000 paper events; if you have more, extend the backfill with pagination before relying on completeness.
- The paper simulator's risk cap is based on its virtual accounting; not an IG account monetary guarantee.

## Local checks
`node --check server.js`
`node --check v9-paper.js`
`node --check v11-execution-lab.js`
`node --test tests/v9-paper.test.js tests/v10-readiness.test.js tests/v11-execution-lab.test.js`

## Rollback
Restore the previous `server.js` and `v9-paper.js`, then redeploy. The new journal table is additive and can remain unused. Never delete existing v9 tables.
