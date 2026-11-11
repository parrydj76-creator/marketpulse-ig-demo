# MarketPulse AI v81 — Unattended PAPER Simulation Mega Upgrade

This is an **incremental upgrade for a v80-based repository**. It adds a persistent, autonomous, **paper-only** trade lifecycle. It does **not** certify or enable IG DEMO broker order execution.

## Contents
- `v81-simulator.js`: standalone paper engine with 15-second scheduled ticks, bid/ask simulated fills, 12-pip stops, 18-pip targets, simulated £25 risk budget, 3 trades/day, simulated £100 daily-loss limit, position restoration, tamper-evident append-only journal and fail-closed persistence.
- `v81-dashboard.html`: mobile-friendly status screen.
- `v81-integration-snippet.js.txt`: copy the integration block into existing `server.js` immediately before its catch-all route.
- `server.js`: **example v80 baseline with v81 integration already inserted**; do not overwrite a diverged production server.
- `test-v81.js`: isolated mock tests.

## Install
1. Back up GitHub repository and Render persistent storage.
2. Upload `v81-simulator.js` and `v81-dashboard.html` alongside `server.js`.
3. Insert the content of `v81-integration-snippet.js.txt` immediately before the `// Keep the catch-all` line in your existing `server.js`. Only use the supplied full `server.js` if your current server matches the included v80 baseline exactly.
4. Keep `v54-safety`, all earlier modules and persistence settings. **Set `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`; check any other legacy dealing flags remain off.** This v81 module does not override legacy routes.
5. Run `node --check server.js && node --check v81-simulator.js && node test-v81.js`, commit and redeploy.
6. Open `/v81` or run the commands below.

## Render Shell
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v81/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v81/tick" | python3 -m json.tool
```

## Critical boundaries
- The simulator uses an **illustrative assumed £1/pip per simulated unit**, NOT a broker-certified Mini contract pip value or dealing size. Its positions and P&L are synthetic and must never be used to calculate actual broker order sizes or certify the £100 broker daily loss limit.
- Paper fills use observed bid/ask prices at the tick, without guaranteed execution, slippage, financing, commissions or realistic stop gaps. Stops and targets are simulated, not attached at IG.
- The date diagnostic recognises some additional shapes but does not inspect actual IG transaction dates or establish timezone authority. V80 broker ledger certification remains unchanged.
- No order write callback is provided. `/api/v81/arm` always rejects. The existing legacy server may contain broker trading functionality; ensure its execution flags remain off independently.
- Scheduler only runs while the Render service process is alive; sleep, restarts and network interruptions can cause missed simulated exits. The persistent journal restores position state but cannot reconstruct missed prices.
- The simulator intentionally refuses new entries when persistence, feed, spread, quote age, signal quality or simulated risk gates fail. Simulation risk limits are not a broker safety guarantee.
- Local tests use mocks; live IG DEMO validation is still required.
