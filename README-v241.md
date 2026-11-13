# MarketPulse AI v235–v241 — Broker certification dossier and supervised dry-run

This release retains previous modules, routes, and dashboard. It **does not enable IG broker writes**, certify the seven independent requirements, or allow unattended demo trading. The existing legacy trading code may still have a write path if environment switches are enabled; **keep both switches false**.

## Modules
- v235 independent contract/fee evidence checklist and no-assumption GBP risk preflight
- v236 historical accounting and transaction completeness evidence references
- v237 timestamp provenance evidence references
- v238 broker stop lifecycle and operator-review evidence references
- v239 durable intent preparation and quarantine (no order submitted)
- v240 recovery and fencing certification dossier (no real broker submission)
- v241 full-scope audit for its own evidence and intent tables; consolidated readiness gate

## Environment
`BROKER_DEMO_EXECUTION=false` and `AUTO_START=false` must remain false. Do not add credentials to files.

## Render Shell tests
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
for ep in status readiness audit; do curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v241/$ep" | python3 -m json.tool; done
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v241/broker/snapshot" | python3 -m json.tool
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"confirm":"PREPARE_ONLY_NO_ORDER","epic":"CS.D.EURUSD.MINI.IP","side":"BUY","size":0.1,"stopPips":12,"targetPips":18,"spreadPips":1,"quoteAgeSeconds":2,"dailyLossGBP":0,"tradesToday":0,"openPositions":0}' "$BASE/api/v241/order/prepare" | python3 -m json.tool
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v241/audit" | python3 -m json.tool
```
The dry-run should report missing GBP pip/fees/slippage evidence and never allow submission. Values sent by clients, even when marked verified, do not constitute independent broker certification.

## Actual certifications still required
Seven broker certifications remain false until independent broker data, supervised broker lifecycle evidence, fee and P/L accounting, real crash recovery and broker-integrated fencing have been validated. **This package does not provide a broker-write adapter.** Do not enable unattended trading on the strength of this package or its local tests.
