# IG DEMO autonomous execution — runbook

## What was added (nothing existing was rewritten)
- `ig-exec/` — IG REST client, execution engine, risk manager, Postgres store, kill-switch routes. 16 tests.
- `server.js` — 6 added lines before `const sim2000=`, plus one call inside `tick2000`. When the v2000 paper engine
  enters a trade, the same signal is sent to the broker engine. The legacy `BROKER_DEMO_EXECUTION=false` and every old gate are untouched.
- `public/ig-exec.html` — phone-friendly status / **KILL SWITCH** / resume page (`/ig-exec.html`, needs ADMIN_TOKEN).
- New tables are created automatically on first start: `ig_orders`, `ig_positions`, `bot_state`, `audit_log`.

## How a trade flows
paper engine `PAPER_ENTRY` → adapter (signal id = `epic:bar`, size = `IG_EXEC_SIZE`) → risk checks → order saved to DB →
IG market order with broker-side stop + limit → confirmation → position stored → reconciled with IG every 15s →
exits by broker stop / limit, 3-hour time exit, or kill switch.
Paper and broker run side by side; the broker engine is authoritative for real DEMO positions.

## Step 0 — prove it against real IG DEMO (on your own computer, ~5 minutes)
```
cd ig-exec
IG_API_KEY=... IG_USERNAME=... IG_PASSWORD=... IG_DEMO_ACCOUNT_ID=... \
IG_EXEC_EPICS=CS.D.EURUSD.CFD.IP IG_EXEC_SIZE=0.5 node scripts/demo-acceptance.js
```
Needs 14/14 PASS. Pay most attention to check 3 (stop distance in pips matches what we asked) and the printed
INSTRUMENT FACTS: use them to set a safe `IG_EXEC_SIZE` and `IG_PIP_VALUE_GBP`. If anything FAILs, send me the output.
Run it while the FX market is open (not weekends).

## Step 1 — deploy
Render env vars (secrets stay in Render): see `render.env.example`. Minimum:
`IG_EXEC_ENABLED=true  IG_DEMO_ACCOUNT_ID  IG_EXEC_EPICS=CS.D.EURUSD.CFD.IP  IG_EXEC_SIZE`  (plus your existing IG_* and ADMIN_TOKEN, DATABASE_URL).
Keep `numInstances: 1` and a paid always-on plan (free tier sleeps = not unattended).
First start is **KILLED by design**. Open `/ig-exec.html`, enter ADMIN_TOKEN, press **Resume** once.
After that it survives restarts and redeploys unattended (the kill state is remembered either way).
Also start the paper simulation in the existing dashboard (`/api/admin/v2000/start`) — the broker engine only trades on its signals.

## Phase plan
1. **Week 1:** one pair, minimum size. Check daily: orders = IG demo platform, no stuck/UNKNOWN orders, `/history`.
2. **Weeks 2–4:** add pairs one at a time via `IG_EXEC_EPICS`. Defaults: 1 open position, 3 orders/day, 180-min max hold, daily loss limit £50 (estimated P&L).
3. Change risk without redeploy: `PUT /api/admin/ig-exec/risk` (fields in `ig-exec/src/execution/risk.js`).

## Safety summary
Demo host only + session account must equal `IG_DEMO_ACCOUNT_ID` + demo Lightstreamer endpoint (all checked on login and on every request);
7 major CFD epics only; disarmed unless `IG_EXEC_ENABLED=true`; killed until first Resume; same signal can never trade twice; ambiguous network failures
are never resent (resolved via IG confirms); broker stop mandatory (attached or position closed); 5 consecutive reconcile failures block new orders.

## Not verified (could not test from here)
- Anything against real IG — Step 0 is the proof. The mock follows IG's documented API, not IG.
- Postgres store (tested via an in-memory twin of the same interface).
- Realised P&L is estimated from price levels × `IG_PIP_VALUE_GBP`; use IG's transaction history for true figures.
- Market orders can slip; the strategy's 12/18 pip stop/target vs up to 2 pips of spread is thin, so expect demo results to differ from paper.
- A separate login is used for execution (the existing app session is not shared). If IG ever limits concurrent sessions on your key, tell me.
- One existing repo test (`v23.test.js` "server hard block is preserved") already failed before my changes: it looks for an `openDemo` function that no longer exists.

## Real money — not enabled, deliberately
This build refuses anything but DEMO in three places, and the repo's own `IG_ACCOUNT_TYPE=DEMO` check still applies. Suggested gate before a live trial:
Step 0 passes; ≥4 weeks and ≥100 broker-side demo trades; zero unreconciled/UNKNOWN orders and zero manual interventions; results measured **after** spread
and slippage still positive (not just paper P&L); kill switch tested on a phone. Even then, the demo only proves the plumbing works, not that the strategy makes money
(a simple 5-min RSI/EMA rule; the repo has no evidence of an edge), and IG's own risk warning says most retail CFD accounts lose money. If you get there, start with a
size you'd be happy to lose entirely. I can then add a separate hardened live profile (own account allow-list, tiny size cap, tighter loss limit, second explicit switch).
