# MarketPulse AI v44 — unattended read-only IG DEMO soak

No real or demo IG order submission. Broker execution remains HARD_BLOCKED. v44 automatically refreshes v41 and v42 read-only observations every 30 seconds *only while manually armed*. A failed refresh, unhealthy heartbeat, unexpected broker exposure, unresolved intent or unhealthy journal automatically disarms. All transitions are persisted to a hash-chained journal. Restarts always disarm.

## Deploy
Replace project files in GitHub and redeploy existing Render service, preserving disk and environment. Keep `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`.

## Render Shell
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v44/status" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v36/paper/start" | python3 -m json.tool
# Wait 60 seconds for paper heartbeat, then refresh both read-only observers:
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v41/observe" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v42/observe" | python3 -m json.tool
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v44/status" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"operatorNote":"Authorise unattended read-only soak only"}' "$BASE/api/v44/arm" | python3 -m json.tool
# Wait 90 seconds, then:
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v44/status" | python3 -m json.tool
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v44/events" | python3 -m json.tool
# Stop manually:
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v44/disarm" | python3 -m json.tool
```

Note: v41 and v42 each enforce a 10-second observation rate limit. Wait at least 10 seconds after manually refreshing them before arming or running a manual cycle. v44's first scheduled cycle is 30 seconds after arming (subject to server timer scheduling). v44 counters are process-local; persistent journal events and hash survive restarts. Read-only API requests still use broker rate limits. This version does not certify GBP sizing, broker order lifecycle or real broker crash recovery.
