# MarketPulse AI v199–v203 combined upgrade

This consolidates five development milestones into **one deployment**. It is a certification and shadow-execution workbench, **not** a broker execution release. No broker write callback is passed to v203.

## What it adds
- v199: canonical PostgreSQL evidence audit with a fail-closed 100,000-row limit.
- v200: independent contract/FX/fees evidence queue and conservative GBP risk preview.
- v201: GET-only IG DEMO market/positions/accounts reconciliation.
- v202: persisted shadow plans and restart challenges, with SHA-256 verification.
- v203: consolidated seven-certification report and hard-blocked order endpoint.

## Non-negotiable limitations
No IG DEMO orders are sent. A valid risk *candidate* is not independently certified. Evidence submission is never treated as certification. Neither PostgreSQL digests nor the shadow scenarios prove broker lifecycle, authenticated exchange timestamps, exactly-once delivery or stop protection. The legacy `server.js` contains other trading logic: keep `BROKER_DEMO_EXECUTION=false`, `AUTO_START=false` and verify that no older execution endpoints can bypass those settings. Never deploy with live-account credentials.

## Deploy
Back up the GitHub repo and Render env. Upload all project files to the repo root, commit, redeploy. No additional npm dependency is required.

## Render tests
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
HEADER="X-Admin-Token: $ADMIN_TOKEN"
curl -sS --fail-with-body -H "$HEADER" "$BASE/api/v203/status" | python3 -m json.tool
curl -sS --fail-with-body -H "$HEADER" "$BASE/api/v203/readiness" | python3 -m json.tool
curl -sS --fail-with-body -H "$HEADER" "$BASE/api/v203/audit" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "$HEADER" "$BASE/api/v203/broker/reconcile" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "$HEADER" "$BASE/api/v203/restart/challenge" | python3 -m json.tool
# Save challenge ID; restart Render; then:
curl -sS --fail-with-body -H "$HEADER" "$BASE/api/v203/evidence/REPLACE_ID/verify" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "$HEADER" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v203/risk/preview" | python3 -m json.tool
curl -sS -X POST -H "$HEADER" "$BASE/api/v203/order/submit" | python3 -m json.tool
```

## Before *any* broker-backed demo test
Independent contract/pip-size/GBP conversion documentation, full fee and transaction reconciliation, broker time-source verification, operator-approved protective-stop lifecycle, unknown-outcome reconciliation, and broker-path distributed fencing are outstanding. A real operator-approved DEMO order test must be designed and reviewed separately. Do not enable unattended demo trading based on this package.
