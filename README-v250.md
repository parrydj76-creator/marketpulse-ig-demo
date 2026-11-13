# MarketPulse AI v242–v250 execution foundation (not a certified trading adapter)

This is a **source-specific overlay**, built using the supplied `server(7).js` and `v241-supervised-execution-dossier.js`. It does not include the many existing dependency modules; apply to the existing repository rather than starting a new repository.

## Install
1. Back up the current GitHub repository and Render environment.
2. Replace the existing root `server.js` with the packaged `server.js` and add `v242-execution-foundation.js` at the repository root. Optionally add `test-v250-foundation.js` and this README.
3. Do not delete existing modules or change `v241-supervised-execution-dossier.js`.
4. Preserve `IG_ACCOUNT_TYPE=DEMO`, `BROKER_DEMO_EXECUTION=false`, `AUTO_START=false`. The server also hard-codes broker execution off.
5. Run `node --check server.js && node --check v242-execution-foundation.js && node test-v250-foundation.js` before committing.
6. Deploy on Render and test endpoints with the existing `X-Admin-Token`.

## Render Shell checks
```sh
BASE="http://127.0.0.1:${PORT:-10000}"
for e in status readiness audit; do curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v250/$e" | python3 -m json.tool; done
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v250/broker/snapshot" | python3 -m json.tool
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"confirm":"PREPARE_ONLY_NO_ORDER","idempotencyKey":"v250-example-00001","epic":"CS.D.EURUSD.MINI.IP","side":"BUY","size":1,"stopPips":12,"targetPips":18,"maxRiskGBP":25}' "$BASE/api/v250/order/prepare" | python3 -m json.tool
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v250/audit" | python3 -m json.tool
curl -sS -i -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v250/order/submit"
```

## What is implemented
- Authenticated IG DEMO GET-based instrument, dealing rules, account and position checks.
- Broker-derived minimum deal-size screening. No conversion between dealing-rule units and pips is assumed.
- PostgreSQL durable rejected intents with unique idempotency keys, auditable SHA-256 digests, manual quarantine and isolated fencing-epoch drill.
- Broker order submission and operator approval endpoints return HTTP 409.
- Seven independent certifications remain false. This release does not claim to meet them.

## Outstanding prerequisites for actual IG DEMO execution
Independent broker specification and GBP-per-pip verification; authenticated market timestamps and delay assessment; complete broker fees and daily accounting; independently verified protective-stop lifecycle; safe crash/restart reconciliation of actual ambiguous submissions; broker-integrated fencing and atomic order-intent workflow; and separate review of the existing global `v54-safety` write block. **Do not enable or bypass that block based on this release.**

The source provided did not include `v54-safety.js`, the existing PostgreSQL migration framework, package-lock, or the other dependency modules. This package has syntax and focused unit checks, but not an end-to-end Render integration test. Real broker write implementation is intentionally excluded pending complete dependency review and broker-specific independent validation.
