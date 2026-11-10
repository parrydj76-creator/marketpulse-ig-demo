# MarketPulse AI v52 — IG DEMO transaction-history path patch

Based on the full v51 GitHub-ready project.

## Changes
- Adds read-only `/api/v52/transactions` using IG REST API v2 `GET /history/transactions?type=ALL&pageSize=50&pageNumber=1&maxSpanSeconds=604800` instead of the v51 invalid `/history/transactions/ALL` path.
- Preserves the v51 routes and journal; v52 has a separate evidence journal and dashboard at `/v52`.
- Keeps `brokerOrderAllowed:false`, with no new broker order-write functionality.
- Records successful broker history reads; failed requests do not claim certification.

## Render test
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v52/status" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v52/transactions" | python3 -m json.tool
```

**Important:** The new endpoint is unverified against your live IG DEMO environment. A 404 after redeployment may indicate IG API version, gateway routing, or query-parameter incompatibility. History matching is broad and is not certification of a Mini deal. Keep legacy broker-write paths disabled.
