# MarketPulse AI v88 — Read-only Broker Audit Mega Upgrade

## Safety
- IG DEMO dealing remains **hard-blocked**. No trading or broker write endpoints are added.
- Does **not** certify IG contract size, feed delay, broker accounting or readiness for unattended demo execution.
- All supplied values are **operator-supplied and unverified**. The v88 calculations are diagnostics, not independent broker evidence.
- Preserves the existing v81/v85/v87 ledgers; adds a separate `v88-audit-ledger.jsonl` hash chain in DATA_DIR.
- Records only computed audit diagnostics; not raw statements or credentials. Do not submit account IDs or secrets.

## Deploy
1. Back up current GitHub source and Render persistent DATA_DIR.
2. Upload all included runtime `.js` files to the same directory as your existing server.js, overwriting matching names. Other existing files must remain in place.
3. Commit and deploy. Keep `BROKER_DEMO_EXECUTION=false`, `AUTO_START=false`, v85 pause active.
4. Run `node test-v88.js` in a safe environment; test does not connect to IG.
5. Verify `/api/v88/status` using the existing `X-Admin-Token` header.

## Endpoints
- `GET /api/v88/status`: ledger health, readiness blockers, safety flags.
- `POST /api/v88/audit/risk`: hypothetical contract-risk calculation. Requires `epic`, `side`, `entry`, `stop`, `dealSize`, `gbpPerPipPerDealSizeUnit`, `minimumDealSize`, `dealSizeIncrement`, `expectedFeesGBP`, `conversionAsOf` (UTC ISO). Numeric inputs must be JSON numbers. The result always has `contractCertified:false`.
- `POST /api/v88/audit/reconciliation`: manually supplied *redacted* broker/local positions, transactions, opening/closing balances and transfers. Transactions require `id`, `at`, `realisedPnlGBP`, `feesGBP`, `financingGBP`, `otherChargesGBP`. Position records require `dealId`, `epic`, `side`, `size`. Result always has `brokerDataCertified:false`.
- `POST /api/v88/arm`: always HTTP 409, hard blocked.

## Important limitations
- No automatic IG API import or read-only IG API integration in this release.
- GBP/pip value is **not inferred** from IG market price; it must be verified against the broker contract and FX conversion.
- Balance reconciliation assumes the provided transactions cover the same interval as the balances. It cannot prove a complete UK trading day.
- Fees, financing, conversions, transaction dates and balance definitions vary by broker; supplied fields require independent checking.
- Local file lock and journal hash chains alone do not certify distributed single-writer or crash-safe broker submission recovery.
- Never turn on broker execution based on a green v88 calculation.

## Quick verification
```
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v88/status" | python3 -m json.tool
```

## Files
`server.js`, `v81-simulator.js`, `v85-integrity.js`, `v86-readiness.js`, `v87-verification.js`, `v88-broker-audit.js`, existing tests and `test-v88.js`.
