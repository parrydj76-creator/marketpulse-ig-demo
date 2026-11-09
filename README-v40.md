# MarketPulse AI v40 — Controlled protocol rehearsal

This release adds an **offline, durable, simulated order-intent state machine**, recovery replay, duplicate-intent prevention, tamper-evident journaling, sizing preview, readiness API and dashboard. It DOES NOT submit IG orders, certify sizing, or enable unattended trading.

## Install
Replace matching repository files with this package, preserve Render environment variables and persistent disk, and keep `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`. Run `npm test`, deploy, then check `GET /api/v40/status` with `X-Admin-Token`. The `/v40` page uses existing admin authentication.

## APIs
- `GET /api/v40/status`: dependency health, journal and unresolved intents.
- `GET /api/v40/intents`: simulated intent history.
- `POST /api/v40/prepare`: JSON `{"key":"unique_order_001","epic":"CS.D.EURUSD.CFD.IP","direction":"LONG","size":1,"stopPips":12}`. No broker call. Repeating the key returns same intent.
- `POST /api/v40/transition`: JSON `{"intentId":"<id>","to":"APPROVED_SIMULATED","operatorNote":"I approve this offline rehearsal"}`. All states are simulated.
- `POST /api/v40/risk-preview`: JSON `{"size":1,"stopPips":12,"pipValueGBP":1,"minimumSize":1,"stepSize":1,"conversionVerified":false}`. This is not IG certification.

## Safety
The state machine refuses a second unresolved simulated intent. It refuses illegal state jumps and rejects corrupted journals at startup. It does not import or invoke IG API clients. Any `SUBMISSION_UNCERTAIN` state remains unresolved after restart until operator reconciliation. No automatic retry.

## Outstanding steps before actual IG demo execution
Independently verify IG DEMO market contract units, GBP conversion and size increments; implement a separate, tightly scoped operator-approved broker adapter with live read-only reconciliation, confirmation matching and idempotent crash recovery. Do not change `BROKER_DEMO_EXECUTION` or `AUTO_START` based solely on these simulated tests.
