# MarketPulse AI v180 — durable evidence workbench (NO BROKER EXECUTION)

This release builds on v170. It adds a PostgreSQL-backed, append-only evidence intake and SHA-256 integrity verification for all seven certification categories. Evidence is operator supplied and **never automatically certified**. It does not make IG orders, integrate fencing into the dealing path, or turn on unattended trading. The current readiness remains 0/7.

## Deploy
Back up your existing repository. Upload the complete ZIP contents, preserving existing dependencies, Render environment and PostgreSQL. Inspect server.js diff before replacing. Maintain `BROKER_DEMO_EXECUTION=false`, `AUTO_START=false`, `V125_READONLY_POLL_MS=60000`. Do not enable broker dealing via legacy routes.

## Render tests
```sh
BASE="http://127.0.0.1:${PORT:-10000}"
for route in status fault-tests evidence/list; do
 curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v180/$route" | python3 -m json.tool
done
```

## Review an evidence record without storing it
```sh
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"category":"gbpPipValueAndDealSize","epic":"CS.D.EURUSD.MINI.IP","source":"INDEPENDENT_CONTRACT_DOCUMENT","sourceRef":"document:contract-2026","observedAt":"2026-11-12T12:00:00Z","payload":{"epic":"CS.D.EURUSD.MINI.IP"}}' \
  "$BASE/api/v180/evidence/review" | python3 -m json.tool
```
The review reports missing fields; it does NOT certify values. Avoid submitting real evidence until source material has been reviewed and sensitive identifiers removed. Evidence records are append-only; corrections must be new records. Source references are operator assertions, not authenticated broker provenance. A valid record is not a certification.

## Evidence intake API
`POST /api/v180/evidence/submit` accepts a reviewed record (same shape as above), writes it to PostgreSQL, and returns an `evidenceId`. `GET /api/v180/evidence/verify/:id` verifies the stored JSON payload digest. `GET /api/v180/evidence/list` shows metadata for 100 recent records. No delete or update endpoints are provided. Note: this is payload hash integrity, not a signed, externally anchored tamper-evident audit chain; DB administrators can alter both payload and hash.

## Safety and certification
- 7/7 broker certifications remain OPEN. `brokerOrderAllowed=false`, `readyForUnattendedDemo=false`.
- The lease in v170 is rehearsal-only, not connected to the broker submit path.
- Never place a broker test order until independent contract GBP sizing, loss/fees, protective stop, and recovery controls have been reviewed and operator approval obtained.
- This release does not implement automatic execution. Further work requires the actual IG integration source and independently sourced broker evidence.
