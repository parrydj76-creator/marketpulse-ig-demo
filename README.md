# MarketPulse AI v72 — Read-only Broker Certification Workbench

## Scope
A substantial, additive, **broker-write-free** upgrade on v71. It provides a durable certification journal, automatic one-minute independent readback audits of broker positions, account currency and Mini market identity, quote diagnostics, research-readiness reporting, and an illustrative risk-sizing scenario calculator. It does **not** independently certify pip value, feed delay, broker order lifecycle, DEMO account environment, or crash recovery. No new IG order write path exists. `/api/v72/arm-unattended` rejects with HTTP 409.

## Install
1. Back up your GitHub repository, Render environment variables and persistent disk data.
2. Upload **server.js** and **v72-certification.js** to the repository root (beside existing v68–v71 modules). Do not remove existing modules or change environment variables.
3. Optionally upload `test-v72.js` for local tests (`node test-v72.js`).
4. Redeploy on Render. Ensure `DATA_DIR` is on an actual persistent disk and `PERSISTENT_STORAGE_CONFIRMED=true` only when independently confirmed. A healthy journal alone does not prove durable hosting.
5. Test in Render Shell (admin token must already be available):

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v72/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v72/audit" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v72/evidence" | python3 -m json.tool
```

## Illustrative sizing scenario (NOT a certified contract value)
Only supply a GBP/pip/contract value after independently establishing the IG Mini contract denomination and currency conversion. This endpoint **never certifies or places orders**.

```bash
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"riskGBP":25,"stopPips":12,"gbpPerPipPerContract":1,"minDealSize":0.1,"dealSizeIncrement":0.1}' "$BASE/api/v72/sizing-scenario" | python3 -m json.tool
```

The example GBP/pip and deal-size parameters are **hypothetical**, not verified IG market specifications. The stop-only formula excludes slippage, gaps, spread, fees, guaranteed-stop premiums and currency conversion changes. Never use its result to submit an order.

## Certification still required
- IG DEMO environment verification; independently established GBP pip value and minimum/increment deal size
- Confirmed non-delayed Mini market data
- Operator-approved broker DEMO open/stop/close lifecycle with actual broker readback
- Broker unknown-submit, idempotency, restart and crash recovery verification
- Real broker realized/unrealized daily GBP P&L and trade count reconciliation
- Explicit safe architecture review of any existing legacy broker-write routes and environment flags

**Important:** v72's new endpoints are read-only, but the existing application may contain older broker-write routes controlled by separate environment flags. Do not infer that installing v72 disables those legacy routes. Keep existing broker execution environment switches OFF and review them before further changes.
