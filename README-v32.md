# MarketPulse AI v32 — integrated verification workbench

This upgrade retains v31 and adds GBP risk worksheets, read-only IG confirmation inspection, and an offline restart-recovery rehearsal. **None of these constitute independent certification.** The broker order hard block remains. Never deploy with live IG credentials. No new orders are submitted by the v32 routes.

## Deployment
Back up your current GitHub repository. Replace project files with this ZIP's contents, retain your Render environment variables and persistent disk, redeploy, and open `/v32`. Run `npm test` and `node --check server.js` before deploying.

## Authenticated endpoints
All commands below run in Render Shell and use the existing `ADMIN_TOKEN` without printing it.

Status: `curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v32/status"`

Risk worksheet (example **hypothetical values, not verified IG contract sizing**):
```
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"instrumentType":"CFD","currency":"GBP","size":1,"pipValuePerUnitGBP":7.7,"stopPips":10,"maxRiskGBP":100}' "http://127.0.0.1:${PORT:-10000}/api/v32/risk/worksheet"
```

Read-only lifecycle inspection (requires genuine **IG API** opening and closing `dealReference` values, NOT just a position `dealId`):
```
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"openDealReference":"OPEN_REFERENCE","closeDealReference":"CLOSE_REFERENCE","dealId":"POSITION_DEAL_ID"}' "http://127.0.0.1:${PORT:-10000}/api/v32/lifecycle/inspect"
```
IG may no longer provide older confirmation references. Missing data is not a passing result.

Offline crash-recovery rehearsal (never places or retries an order):
```
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"journal":[{"intentId":"test001","state":"SENT_UNKNOWN"}],"positions":[]}' "http://127.0.0.1:${PORT:-10000}/api/v32/recovery/rehearse"
```

Records: `GET /api/v32/records`. Requires durable storage; Render's ephemeral filesystem is insufficient. Even with persistent storage, the v32 rehearsal is NOT a broker crash-recovery certification.

## Remaining independent verification
1. Establish real GBP-per-pip value from IG's contract specification, quantity units, minimum size, GBP/USD conversion, spread/slippage, and stop units; compare with a controlled demo fill.
2. Capture actual IG DEMO opening/closing deal references, broker confirmations, protective stops, and reconcile positions, including rejected and timed-out orders.
3. Test broker-side unknown-outcome orders, process crash/restart, idempotent recovery, journal durability and reconciliation under controlled operator supervision. No blind retries.
4. Require a separate safety review and explicit operator approval before any demo order submission is enabled. **Live-money trading must remain disabled.**
