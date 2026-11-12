# MarketPulse AI v96 — IG history repair and diagnostics

## Install
Back up your GitHub repository and persistent Render `DATA_DIR`. Upload the **runtime** `.js` files from this ZIP to the same root directory as your existing `server.js`, replacing matching filenames. Retain all other existing project files (including `v54-safety.js` and dependencies). Commit and redeploy. No installer or renaming required.

**This is a repair release, not unattended trading.** `BROKER_DEMO_EXECUTION=false`, `AUTO_START=false`, and the paper safety hold remain enforced. No broker write calls were added.

## Fixed
- IG `/history/transactions` version 2 now uses the documented query string (`type`, `from`, `to`, `pageSize`, `pageNumber`) rather than the unsupported version-1-style URL.
- Pagination checks `metadata.pageData.pageNumber`, `totalPages`, and `pageSize`; fetches all pages up to a 10-page cap, then explicitly marks larger results incomplete.
- Malformed responses, missing metadata, API errors, invalid dates and incomplete history fail closed.
- The `/api/v96/status` endpoint distinguishes transient feed connectivity and quote validity from independent execution certification.
- All historical journals are preserved. Previous bad paper trades remain quarantined; v95 historical evidence is not edited.

## Render Shell
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v96/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"from":"2026-11-11","to":"2026-11-11"}' "$BASE/api/v95/capture" | python3 -m json.tool
```

## Unresolved and deliberately blocked
History pagination completion **does not** certify net P&L, currency conversion, charges, account-level reconciliation, exchange timestamps, GBP/pip sizing, protective stops, uncertain submissions, or distributed locking. The legacy three false paper trades remain quarantined. An IG transaction-history response with no transactions does not prove that no broker charges occurred. Read-only requests may fail due to IG credentials, API entitlements, date formats, or network conditions; report actual errors before any additional change.

Run `node test-v95.js && node test-v96.js`. Other included tests are from the previous package.
