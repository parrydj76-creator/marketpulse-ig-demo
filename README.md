# MarketPulse AI v70 — Autonomous Observation and Broker-Safety Evidence

This upgrade **does not place unattended IG DEMO orders**. It adds an automatic, durable, read-only research engine while the v69 certification matrix is unresolved. It is a substantial infrastructure step toward unattended DEMO dealing, not an execution unlock.

## Installation

1. Back up the current deployed repository and **persistent DATA_DIR**.
2. Upload `server.js` and new `v70-shadow.js` to the same repository root as your existing v68 and v69 modules. The ZIP includes matching copies of `v68-controller.js`, `v69-readiness.js`, `v67-autonomy.js` for reproducibility; only replace them if your deployed versions match these originals.
3. Keep `IG_ACCOUNT_TYPE=DEMO`, `BROKER_DEMO_EXECUTION=false`, `V66_ENABLE_SUPERVISED_IG_DEMO=false`, and all other dealing write switches off. Keep `PERSISTENT_STORAGE_CONFIRMED=true` **only if DATA_DIR really is on durable Render disk**.
4. Commit and redeploy on Render. This module does not require new dependencies.

## Render Shell verification

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v70/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}' "$BASE/api/v70/cycle" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v70/bars" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v69/quote-diagnostics" | python3 -m json.tool
```

## What is new

- Automatic 60-second read-only cycle with account, EUR/USD Mini market-contract, and broker-position reconciliation.
- Durable, hash-chained, fsynced append-only observations and cycle results; startup checks reject truncation/tampering.
- Samples live Mini quotes even while `DELAY` is missing, but **only as explicitly uncertified research data**. No broker or simulated orders are placed from this data.
- Reconstructs five-minute research candles from persisted samples after restarts; reports progress toward 30 consecutive sufficiently sampled bars.
- Independent read-only EMA/RSI heuristic, with no claimed predictive accuracy or order eligibility.
- Exposes broker safety blockers and fixed read-only execution state.
- No order-submit, close, modify, approve, arm or broker-write callback is provided to v70.

## Unresolved safety gates

- IG stream `DELAY` field is absent. A plausible timestamp alone does not certify an undelayed feed.
- IG Mini per-size GBP/pip and currency conversion are not independently certified.
- Supervised DEMO open -> protective stop -> verified close has not been executed.
- Broker-side ambiguous-submission recovery has not been verified; journal integrity is not equivalent to broker crash recovery.
- Broker daily realised/unrealised P&L and total trades/day across all strategies are not independently reconciled. The read-only module therefore never authorises orders.
- The new research engine does not backtest or place paper trades. The 30-bar heuristic is a diagnostic, not a profit guarantee.
- The journal is append-only and can grow; plan retention and backups before extended operation. Multi-instance disk coordination is not certified.

## Local tests

```bash
node --check server.js
node --check v70-shadow.js
node test-v70.js
```

Tests use stubbed broker reads; they **do not** connect to IG or certify any broker lifecycle. Next engineering milestone: inspect IG streaming field definitions and account entitlements, independent GBP sizing evidence, then supervised DEMO open-stop-close and fault-injection verification with explicit operator approval.
