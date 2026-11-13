# MarketPulse AI v190 — IG DEMO Evidence Collector & Fenced Preparation

## Scope
This release adds **authenticated IG DEMO GET-only collection** of EUR/USD Mini market rules, market timestamps, positions, account-currency/balance summaries, and a bounded sample of transaction history. It stores snapshots in PostgreSQL with SHA-256 integrity checks. It also adds a candidate GBP risk calculator and durable operator intent preparation with advisory locking and increasing fence tokens.

**Not delivered:** independently verified GBP pip value, exhaustive transaction-day reconciliation, exchange timestamp certification, IG broker dealing integration, protective-stop order placement, unknown-submit recovery, or unattended execution. The `POST /api/v190/order/submit` endpoint always rejects. The prepared intents are not connected to any IG order path. Do not enable legacy trading routes.

## Deployment
Back up v180; upload the files and redeploy. Retain `BROKER_DEMO_EXECUTION=false`, `AUTO_START=false`, `V125_READONLY_POLL_MS=60000`. Ensure `HOST` points to IG DEMO (the existing server configuration) and IG credentials are configured. The collector uses the existing IG login and GET API client. PostgreSQL tables initialize on startup.

## Shell checks
```
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v190/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v190/collect" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v190/observations" | python3 -m json.tool
```
A collector failure is fail-closed and does not indicate permission to trade. IG may return incomplete transaction history or different endpoint schemas. Treat `historyTruncated` as incomplete history. Verify observations after restart with `/api/v190/observations/verify/:id`.

## Risk preview
`POST /api/v190/risk/preview` accepts a JSON body with `epic`, `dealSize`, `minimumDealSize`, `dealSizeStep`, `pipSize`, `usdPerPipPerDealUnit`, `gbpPerUsd`, `stopPips`, `contractDocumentRef`, `fxSourceRef`, `fxObservedAt`. **Values must come from independent evidence, not guessed defaults.** The preview excludes commissions, slippage and financing; a valid candidate is **not certification**. Fenced intent preparation is also non-dealing and not a broker safety certification.

## Cautions
The collector stores account balances and transaction summaries, which are sensitive financial data; limit admin access and database retention. `dealId` in position snapshots is an opaque broker identifier. Avoid sending raw secrets or full account identifiers. The transaction capture is capped at 200 and does not paginate; it is not sufficient to certify net daily P&L. A persisted hash is an integrity check, not proof of IG origin.
