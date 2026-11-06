# MarketPulse AI v33 — IG DEMO automation-readiness upgrade

v33 integrates the complete v32 repository and adds a read-only automation-readiness module and mobile dashboard at `/v33`.

## Included
- Read-only IG history correlation (first 100 records within last 30 days), showing masked references, transaction metadata, and candidate confidence signals. Correlation is **not** an IG confirmation.
- GBP CFD risk worksheet with explicit quote-currency pip value, contract-to-size multiplier, GBP conversion, size increment, minimum stop and reserves. Inputs are **operator-supplied and unverified**; certification always false.
- Crash-conscious, append-only PREPARED-intent journal, hashed record integrity, file fsync + atomic rename + directory fsync, and persistent-storage requirement. This is a **non-executing** journal; it does not record actual IG orders. Do not infer real crash recovery certification.
- Read-only reconciliation of journal intentions against IG positions; unknown outcomes always block new orders. Never auto-retries.
- Dashboard `/v33`, with admin token kept only in page memory.
- All previous v25–v32 functionality retained.

## API (admin token required)
- GET `/api/v33/status`
- GET `/api/v33/intents`
- POST `/api/v33/history/correlate` `{ "dealId":"S7PAP8BB", "instrument":"EUR/USD", "openLevel":1.11545 }`
- POST `/api/v33/risk/assess` (see tests/v33.test.js for full schema)
- POST `/api/v33/journal/prepare` `{ "intentId":"test-prepared-001", "instrument":"EUR/USD" }` — creates **offline intent only**, not a broker order.
- POST `/api/v33/recovery/inspect` `{}` — read-only IG positions and journal inspection.

## Deployment
Back up your repository; replace matching project files with the contents of this ZIP, commit, redeploy to Render. Keep existing Render secrets and persistent disk. Run `npm test`, then visit `/v33`.

## Mandatory blockers before ANY real IG demo execution
1. Independent GBP/quote currency conversion, IG contract unit and size increment verification, stop distance and protective-stop enforcement.
2. Broker-confirmed open/close dealReference lifecycle, dealId reconciliation, stop placement, rejected order handling.
3. Actual restart/timeout/duplicate suppression tests using real broker-side observations and a durable journal tied to actual orders.
4. Explicit operator approval, kill switch, max loss, rate limits, account/demo verification, one-position policy, no live account access.

**No new broker POST/PUT/DELETE calls. `brokerExecution=HARD_BLOCKED`; `brokerOrderAllowed=false`.**
