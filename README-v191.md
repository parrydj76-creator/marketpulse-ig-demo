# MarketPulse AI v191 — IG DEMO History Repair

This is a full project archive, based on v190. Deploy the contents at the repository root, not the enclosing folder.

## Changes
- IG REST v2 transaction history now uses `/history/transactions?type=ALL&from=YYYY-MM-DD&to=YYYY-MM-DD&pageSize=100&pageNumber=1`.
- All four IG GET calls are diagnosed individually. Failed calls do not block storing successful read-only observations.
- Partial results are explicitly marked; first-page history is NEVER certified complete.
- Existing v190 routes remain; new `/api/v191/status`, POST `/api/v191/collect`, GET `/api/v191/observations`, GET `/api/v191/observations/verify/:id` are aliases using the same PostgreSQL table.
- No broker write integration, no auto-trading, no certifications asserted.

## Render Shell tests
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v191/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v191/collect" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v191/observations" | python3 -m json.tool
```

Keep `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`. Read-only observations and unverified risk previews are NOT authorization to place an IG order.
