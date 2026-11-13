# MarketPulse AI v221–v227 — execution certification lab

This is a flat GitHub upload, built on v220. It is **not** an unattended execution release. No IG write adapter is supplied to the new module, and all v227 submit/arm/auto-start endpoints return HTTP 409.

## What's new
- v221: GBP risk policy candidate assessment (source strings are claims, **not** independent evidence)
- v222: IG GET-only market, positions and accounts snapshot
- v223: PostgreSQL canonical-digest evidence ledger and full-scope audit (100,000 row fail-closed limit)
- v224: durable non-executable trade plans, explicit review state
- v225: PostgreSQL monotonic fencing epoch drill (not connected to IG submissions)
- v226: read-only unknown-outcome recovery drill (does not prove real submission recovery)
- v227: seven-certification readiness gate, all certifications false until independently established

## Deployment
Back up the repository. Upload ZIP contents to repository root and commit. Redeploy Render. Preserve `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`. Verify legacy broker write paths remain disabled too. No actual trade is authorized by this package.

## Render shell checks
```sh
BASE="http://127.0.0.1:${PORT:-10000}"
for e in status readiness audit; do
 curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v227/$e" | python3 -m json.tool
done
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v227/broker/snapshot" | python3 -m json.tool
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"confirm":"SIMULATE_FENCING_NO_ORDER"}' "$BASE/api/v227/fencing/drill" | python3 -m json.tool
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"confirm":"RECONCILE_ONLY_NO_ORDER"}' "$BASE/api/v227/recovery/drill" | python3 -m json.tool
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v227/audit" | python3 -m json.tool
```

## Critical path to unattended IG DEMO
1. Independently corroborate GBP/pip per unit, minimum size, stop rules, all charges, FX conversions and total-loss calculation using IG account-specific evidence.
2. Validate actual exchange timestamps and end-to-end feed freshness, not only REST updateTime.
3. Reconcile a complete trading day including fills, commissions, overnight funding, cashflows and position P/L.
4. Develop a **separate** operator-approved broker write adapter with protective-stop confirmation, durable request identifiers and strict order-uncertainty handling; review it before any test order.
5. Test a minimum-size operator-approved IG DEMO open/stop/close lifecycle, recovery after an ambiguous response, and fencing integrated with broker submissions. Simulations do not certify these.
6. Independent certification of all seven categories and a separate operator decision before enabling any unattended DEMO execution.

## Notes
The `mp_v227_evidence` audit only covers its own table. `brokerOrderAllowed:false` in v227 does not replace review of legacy trading routes. Do not set BROKER_DEMO_EXECUTION=true based on these tests.
