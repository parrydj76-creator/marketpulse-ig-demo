# MarketPulse AI v89–v91 Combined Mega Upgrade

This package builds on v88 and adds **v89 authenticated IG GET-only observation**, **v90 contract/account/position diagnostics**, and **v91 immutable evidence and recovery readiness**. No IG dealing requests are added.

## Install
1. Back up GitHub files and the Render persistent DATA_DIR.
2. Upload the runtime JavaScript files at repository root, replacing matching names; retain all other existing project files.
3. Keep `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`.
4. Deploy. Check `GET /api/v91/status` with `X-Admin-Token`.
5. Capture with `POST /api/v91/capture` with `X-Admin-Token`; this makes three authenticated **GET** requests to IG DEMO: `/markets/CS.D.EURUSD.MINI.IP`, `/positions`, `/accounts`. Do not include credentials in requests.
6. Inspect `GET /api/v91/recovery`.

## Limits
- This is not unattended trading. No automatic arming, broker write or dealing endpoints were added.
- The IG account reader uses existing session auth; the existing IG app may still use its legacy endpoints and polling independently.
- Market dealing rules are displayed as observations only. GBP/pip, conversion, units, charges and stop rules are **not certified**.
- Transactions are **not fetched** in this release because IG history requires correct paging and date-range handling; daily broker P&L remains unverified.
- The observation ledger persists sanitized results; no account identifiers, tokens or raw broker payloads are saved.
- The local `busy` guard does not provide a distributed lock. No crash-safe unknown-submission recovery is certified.
- Capture is disabled unless v86 reports the paper simulator paused.
- No changes are made to the 205-record v81 journal or previous evidence ledgers.

## Tests
Run `node test-v91.js`, `node test-v88.js`, `node test-v87.js`, `node test-v86.js` in a Node environment. These tests use mocked data.
