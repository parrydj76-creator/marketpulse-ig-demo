# MarketPulse AI v74 — Major Read-Only Operations Upgrade

**Status: DEVELOPMENT BUILD.** Does not certify broker P&L, quote delay, GBP pip value, stops, deal lifecycle, or unattended dealing. The legacy broker execution constant in the included server.js is **false**, and `v54-safety.js` must remain in place. The v74 module contains no broker-write API callback.

## Install (GitHub -> Render)

1. Back up your existing GitHub repository and durable journal storage. **Do not delete any earlier v67–v73 modules, public directory, package files, or journal files.**
2. Upload these **four** files from the ZIP to the repository root, replacing `server.js` and `v73-recovery.js`: `server.js`, `v73-recovery.js`, `v74-operations.js`, `v74-dashboard.html`. `test-v74.js` is optional but recommended.
3. Confirm `BROKER_DEMO_EXECUTION=false` in `server.js` and retain the v54 global broker write guard. Do not enable legacy broker automation switches.
4. Deploy the GitHub commit on Render. Changes made only inside Render Shell do not persist across redeploys.
5. The v74 journal requires the same **real durable disk** as earlier versions and `PERSISTENT_STORAGE_CONFIRMED=true` only when actually verified. Without it, v74 audit writes fail closed.

## Features

- **v73 diagnostic fix included:** safe transaction error codes and response-shape diagnostics in `/api/v73/audit`.
- **v74 two-step transaction discovery:** read-only v2 `/history/transactions/ALL` then v2 `/history/transactions/ALL/604800000` (7-day window) if first fails or returns unrecognised shape. Neither is guaranteed to be supported; actual IG HTTP codes are reported without credentials.
- **No financial data leakage:** transaction output includes row count, field names, type counts and currency names only, not raw trade records or account IDs.
- **Read-only account, positions, Mini market, streaming quote, signal and limits monitoring.**
- **Fail-closed readiness matrix** with blockers for unknown feed delay, uncertified GBP pip value, missing P&L, stops, and broker lifecycle/recovery.
- **Risk-limit specification** (£25/trade, £100/day, max 3/day, max 1 open, 12 pip stop, 18 pip target, 2.5 pip max spread, 15s quote age, score 70). These are **displayed policy limits, not independently enforced broker limits**.
- **Append-only fsync hash-chain audit/incident journal**, restart reconstruction, tamper detection, scheduled 60-second audit.
- **New responsive admin dashboard** `/v74`, with status and manual read-only audit.
- **Operator incident log** for data quality, broker API, restart, position mismatch and risk concerns.
- **No broker order endpoint:** `/api/v74/arm` always rejects.

## Render Shell test

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v74/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v74/audit" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v74/transactions" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v74/evidence" | python3 -m json.tool
```

**Important:** The dashboard uses the app's `requireAdmin` middleware. If admin authentication requires an `X-Admin-Token` header rather than a browser session, direct browser navigation to `/v74` may be denied. Use the authenticated JSON endpoints in that case; don't put admin tokens into URL query strings or public frontend code.

## Development tests

`node --check server.js && node --check v73-recovery.js && node --check v74-operations.js && node test-v73.js && node test-v74.js`

## Limitations and next verification gates

- A successful transaction endpoint request does **not** prove complete pagination, realised GBP P&L, fees, rollover charges, currency conversion, or account-wide daily loss. An empty list is not a certified £0 loss.
- The fallback endpoint may be rejected by IG; preserve the diagnostic and investigate official IG endpoint/version support before changing it.
- `quote.delay=null` is not proof of zero delay. Research sampled observations are not certified exchange ticks.
- No verified deal sizing, stops, supervised order lifecycle, or real unknown-submit crash recovery. All broker writes must remain blocked.
- Tests are offline mocks. They do not verify real IG API behaviour or Render durability.
