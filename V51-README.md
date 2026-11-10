# MarketPulse AI v51 — GBP Risk and Broker Evidence Workbench

This is a complete GitHub-ready upgrade based on v50. It adds a read-only Mini risk and broker-evidence workbench while preserving v50 routes. The v51 module cannot submit orders. Existing legacy execution routes are **not** certified by v51 and must remain disabled through the existing deployment configuration.

## Routes (admin token required except dashboard)
- `GET /v51` — dashboard
- `GET /api/v51/status` — status
- `POST /api/v51/inspect` — read-only Mini market/account/position inspection
- `POST /api/v51/risk-preview` — indicative USD and optionally GBP calculation. Optional `gbpPerUsd`, `fxObservedAt`, `fxSourceLabel` are *user-supplied*, not independently validated; never count as certification.
- `GET /api/v51/transactions` — IG DEMO history transaction readback. Response is not automatically restricted to Mini; confirm exact deal IDs and currency.
- `POST /api/v51/deal-confirmation` — `{ "dealReference":"ACTUAL_IG_DEMO_REFERENCE" }` GET-only IG confirmation retrieval; confirmations may expire.
- `POST /api/v51/reconcile-after-restart` — `{ "dealId":"ACTUAL_DEAL_ID" }` requires a prior-boot position readback; no order execution.
- `GET /api/v51/events` — evidence journal metadata
- `POST /api/v51/arm-unattended` — always blocked.

## Deploy and verify
1. Upload extracted ZIP contents to your existing GitHub repo, preserving directories; do not upload credentials or `.env`.
2. Deploy to Render with existing persistent disk and DEMO-only credentials. Keep all broker execution flags disabled.
3. Run `npm test` locally if desired.
4. In Render Shell:

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v51/status" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v51/inspect" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"dealSize":0.1,"stopPoints":12}' "$BASE/api/v51/risk-preview" | python3 -m json.tool
```

## Certification limitations
- The IG min deal size is not proof of size increment.
- The stop rule POINTS is not independently proven equivalent to pip distance.
- User-supplied FX data is *not* independently authenticated; do not use it to certify risk.
- History and confirmation retrieval are observational; matching open/close broker fills and realized GBP P/L remains manual and unverified.
- Cross-boot position reconciliation does not solve unknown in-flight orders.
- No unattended execution adapter has been implemented or enabled.
- Broker stop losses are not guaranteed maximum losses due to gaps/slippage.
