# MarketPulse AI v43 — Unattended safety rehearsal

This release **does not submit orders to IG DEMO**. It rehearses an independent 30-second unattended safety watchdog, requiring healthy paper trading, heartbeat, fresh read-only broker observation and durable journals. A failed check auto-disarms. Every Render restart disarms the rehearsal; the tamper-evident event journal persists.

## Deployment
Keep `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`. Retain existing Render disk and `DATA_DIR`. Deploy all files. The v43 module is not a broker execution approval or broker crash-recovery certification.

## Shell verification

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v43/status" | python3 -m json.tool
# After restarting paper engine, run fresh v41 and v42 observations:
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v41/observe" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v42/observe" | python3 -m json.tool
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v43/status" | python3 -m json.tool
```

If `readiness.rehearsalEligible` is true, operator can optionally arm **simulation only**:

```bash
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"operatorNote":"Operator authorises safety rehearsal only"}' "$BASE/api/v43/arm-rehearsal" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v43/cycle" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v43/disarm" | python3 -m json.tool
```

The 60-second broker evidence freshness rule means manual v41/v42 observations must be refreshed to keep the rehearsal armed; there is no unattended broker polling in v43. Never use this as proof of broker order safety. Before any real IG DEMO order test, independently verify GBP risk, contract rules, lifecycle and crash recovery with an operator-approved procedure.
