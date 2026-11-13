# MarketPulse AI v205–v208 combined certification evidence upgrade

This upgrade bundles v204 route-order fix with a new **read-only** evidence workbench. It does **not** certify any of the seven broker requirements, does **not** submit orders, and is **not** approved for unattended demo execution.

## Deployment
Back up the existing GitHub repository. Replace files with this ZIP's contents, commit and deploy to Render. Preserve existing secret environment variables. Set `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`.

## Render Shell verification
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
for endpoint in status readiness audit; do
  echo "==== V208 $endpoint ===="
  curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" \
    "$BASE/api/v208/$endpoint" | python3 -m json.tool
done
for endpoint in status readiness audit; do
  echo "==== V203 $endpoint ===="
  curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" \
    "$BASE/api/v203/$endpoint" | python3 -m json.tool
done
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" \
  "$BASE/api/v208/broker/snapshot" | python3 -m json.tool
```

## Example evidence check (no order)
```bash
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"confirm":"EVIDENCE_ONLY_NO_ORDER","transactions":[{"id":"sample-1","netGBP":3}],"brokerNetGBP":3,"openingBalanceGBP":100,"closingBalanceGBP":103,"cashFlowsGBP":0,"paginationComplete":false,"feesComplete":false,"currency":"GBP","sourceRef":"SAMPLE_NOT_CERTIFIED","statementRef":"SAMPLE_NOT_CERTIFIED"}' \
  "$BASE/api/v208/check/ACCOUNTING" | python3 -m json.tool
```
The check records evidence and reports missing conditions. Passing its arithmetic check is not independent certification. For every result, `independentlyCertified` and `brokerOrderAllowed` remain false. Evidence is stored in `mp_v208_cert_evidence` with canonical SHA-256 integrity verification. `GET /api/v208/evidence/:id/verify` checks individual records. The full audit covers only the v208 table, not all prior historical tables.

## Scope and remaining work
- `ACCOUNTING`: arithmetic, pagination, fee and statement evidence inputs (does not fetch full IG transactions itself).
- `TIMESTAMP`: exchange timestamp and latency evidence (broker's clock-only `updateTime` is insufficient).
- `RISK`: existing v203 risk preview; values must be supported by independent contract, FX and fee documentation.
- `LIFECYCLE`: externally obtained IG DEMO order, protective stop, close and statement references.
- `RECOVERY`: external crash, duplicate-order and fencing verification evidence.
- `POST /api/v208/broker/snapshot`: IG GET-only market/positions/accounts evidence.
- `GET /api/v208/readiness`: seven categories remain uncertified. No execution adapter.

**Before any broker-submitting version:** independently validate actual IG contract sizing in GBP, net daily P/L/fees, authenticated quote timestamps, broker stop lifecycle, unknown submission recovery, and distributed fencing on the actual broker submission path. Have an operator supervise initial DEMO orders. No toggle in this release permits broker writes.
