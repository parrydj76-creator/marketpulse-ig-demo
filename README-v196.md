# MarketPulse AI v196 — Full History & Fault Safety Mega Upgrade

Includes full v195 project, v194 legacy digest compatibility, and v196 safety lab. **No IG broker write path is added.**

## New routes (X-Admin-Token required)
- `GET /api/v196/status`
- `GET /api/v196/audit/full`: repeatable-read complete scan of four evidence tables, up to 100,000 rows; fails closed above limit; v194 legacy evidence only accepted when fully covered by v194 verifier.
- `GET /api/v196/audit/integrity`: newest 500 v196 rehearsal records (sample only).
- `GET /api/v196/readiness`: fail-closed readiness gate.
- `GET /api/v196/fault/scenarios`: nine deterministic simulated failure modes.
- `POST /api/v196/fault/rehearse` JSON `{"scenario":"TIMEOUT_AFTER_SEND"}`: persist simulated event, canonical digest.
- `POST /api/v196/risk/preview`: conservative numerical study, **not certification**.
- `POST /api/v196/order/submit`: always HTTP 409.

## Deploy
Back up repo. Upload all files into the GitHub repo root, commit, and deploy on Render. Keep `BROKER_DEMO_EXECUTION=false`, `AUTO_START=false`.

## Verify
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v196/status" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v196/audit/full" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v196/fault/scenarios" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"scenario":"TIMEOUT_AFTER_SEND"}' "$BASE/api/v196/fault/rehearse" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v196/audit/integrity" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v196/readiness" | python3 -m json.tool
```

## Important limitations
No real broker orders, exchange-time certification, GBP Mini contract certification, full financial accounting, protective stop certification, or unknown-submission recovery certification. Full-history scan covers v194 broker reads/events, v195 audits and v196 rehearsals; it does not cover all historical tables from v140–v193. v194 legacy verifier has its own 500-row limit and causes fail-closed if older rows are not fully covered. The audit is an integrity check, **not proof of immutability or tamper resistance**.
