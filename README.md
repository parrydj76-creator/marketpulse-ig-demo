# MarketPulse AI v77 — Broker Certification Workbench

Incremental v76 → v77 upgrade. **READ-ONLY. No IG broker order writes.**

## Contents
- `server.js`: v76 baseline plus v77 integration (use only if unchanged since v76; otherwise merge the `// V77 read-only` block).
- `v77-certification.js`: read-only v1 transaction history; UK date and provisional gross P&L parser; fee and pagination fail-closed diagnostics; Mini pip-value research; Lightstreamer timestamp research; supervised lifecycle evidence checklist; durable hash-linked journal; scheduled 60-second audits; permanently blocked arm endpoint.
- `v77-dashboard.html`: authenticated mobile-readable status page.
- `test-v77.js`: mock unit, restart and corruption tests.

## Installation
1. Back up your GitHub repo and persistent Render disk. Do not delete existing journal files.
2. Upload `v77-certification.js` and `v77-dashboard.html` beside `server.js`.
3. Replace `server.js` **only if** your GitHub file matches the v76 package. Otherwise merge only the `// V77 read-only broker certification` block before the catch-all route.
4. Keep all prior v54 safety and v68/v71/v73/v74/v76 modules. Never enable legacy execution flags.
5. Run `node --check server.js && node --check v77-certification.js && node test-v77.js`.
6. Commit to GitHub, deploy via Render. Shell edits alone will not persist.

## Render tests
```
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v77/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v77/audit" | python3 -m json.tool
```
`GET /api/v77/evidence` and authenticated `/v77` are also available. `POST /api/v77/arm` always returns 409.

## Safety limitations and interpretation
- IG v1 `/history/transactions/ALL/604800000` is the observed working endpoint. v77 uses it as a bounded read-only query, not as a certified complete ledger.
- Transaction dates without explicit UTC offset are rejected for daily accounting. This is intentional: IG's observed `date` format is not yet established, so the reported observed gross P&L may be zero even if records exist. Do **not** interpret zero as no losses.
- `observedTodayGrossPnlGBP` is provisional, not net daily P&L. Fees, financing, missing pages, adjustments, deposits, withdrawals and account-balance reconciliation remain uncertified. `netDailyPnlGBP` and `brokerDailyPnlGBP` stay null; daily loss enforcement remains false.
- GBP pip value and permissible deal-size increments cannot be independently certified using market metadata alone. `illustrativeMaximumGBPPerPip` is a mathematical bound, not a validated deal size.
- Receipt versus IG timestamp is diagnostic only. Delay `null` is not proof of zero delay or an authoritative exchange timestamp.
- No supervised DEMO open/stop/close orders are sent. Unknown-submit recovery is not certified by simulated journal tests. The lifecycle checklist names the remaining tests requiring explicit operator approval and separate safeguards.
- All new module endpoints are admin-protected. The pre-existing legacy server contains broker execution paths; do not change its v54 hard block or execution configuration. This package does not audit all historical execution code.
- Tested locally with mock data, not yet against the live IG DEMO broker or Render deployment.
