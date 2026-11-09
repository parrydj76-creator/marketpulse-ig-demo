# MarketPulse AI v46 — rate-limit-aware read-only IG DEMO monitoring

## Safety boundary

v46 performs **read-only** broker observations. It never submits, amends, or closes an IG order. `brokerOrderAllowed` remains false. Existing GBP sizing, broker lifecycle and crash-recovery certifications remain false. Paper positions are not IG positions.

## Changes from v45

- First monitoring cycle is deferred until at least 12 seconds after the latest v41/v42 observation (their underlying rate limit is 10 seconds).
- Later cycles run at approximately 30-second intervals, subject to observation rate limits.
- v41 and v42 refreshes are awaited sequentially and their timestamps checked against the committed status.
- A known short-lived rate limit results in a bounded scheduling deferral, recorded as `RATE_LIMIT_DEFERRED`, **only while readiness remains healthy**. Stale observations or any other broker error fail closed.
- A 1-second scheduler checks readiness and can disarm on stale or unhealthy evidence. v44/v45 must be disarmed.
- The journal is durable, hash chained, and checked at startup. Restart always disarms v46.
- Exposes `nextCycleAt`, `nextAllowedRefreshAt`, `deferralCount`, `lastDiagnostic`, `cycleCount`, `successCount`, `failureCount`.

## Deploy

Back up the working repository and persistent disk. Replace project files from the ZIP and redeploy to Render. Preserve existing environment variables and persistent storage. Ensure `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`. Never arm v44 or v45 simultaneously.

## Render Shell

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v46/status" | python3 -m json.tool
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v36/paper/start" | python3 -m json.tool
# Wait for healthy paper/feed status, then refresh:
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v41/observe" | python3 -m json.tool
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v42/observe" | python3 -m json.tool
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"operatorNote":"Authorised v46 read-only soak test"}' "$BASE/api/v46/arm" | python3 -m json.tool
# Wait 3 minutes; no manual refreshes while armed:
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v46/status" | python3 -m json.tool
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v46/events" | python3 -m json.tool
# To stop:
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v46/disarm" | python3 -m json.tool
```

## Expected first run

At arm time, `armed:true`, `cycleCount:0`, `nextCycleAt` ~12 seconds after the last observation. After three minutes, expect several successful cycles and zero failures. Investigate any auto-disarm rather than repeatedly re-arming.

## Limitations

This version is not a live-trading system. It does not certify actual broker order sizing, conversion into GBP, lifecycle reconciliation or crash recovery. Read-only soak tests cannot establish broker order safety.
