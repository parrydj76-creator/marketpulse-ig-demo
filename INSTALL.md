# MarketPulse AI v14.0 — Order Lifecycle Simulator

## Install
1. Back up your current GitHub repository and Render environment. Do not delete PostgreSQL data.
2. Replace root `server.js` with the supplied version, based on the v13 release.
3. Add root `v14-lifecycle.js` and `public/v14.html`.
4. Optionally add `tests/v14-lifecycle.test.js`.
5. Preserve v9-v13 modules, all push notification files, and existing databases. Commit and deploy.
6. Open `https://marketpulse-ig-demo.onrender.com/v14` and enter ADMIN_TOKEN only in your deployed app.

## Test workflow
1. Refresh journal and run Broker safety report.
2. Create a simulated intent for a UTC five-minute signal bar. Repeating it with the same direction should report a duplicate and retain one row.
3. Select the intent, simulate SUBMIT, then ACK or REJECT or TIMEOUT.
4. After TIMEOUT, test RECONCILE_FOUND or RECONCILE_ABSENT. These are **simulated** outcomes, not IG lookups.
5. Refresh the dashboard after redeploy to confirm persisted records remain; this is NOT proof of crash-safe broker order recovery.

## Safety and limitations
- No IG broker POST orders, no executable deal size, no live or demo position placement.
- v14 database records are SIMULATION ONLY; the module does not call the IG API.
- The preflight simulator allows drafts with *unverified broker conversion* solely to exercise the lifecycle, and always reports `brokerExecutable:false`.
- It does not verify contract monetary exposure, margin, actual order acknowledgements, real broker reconciliation, multiple-instance safety or crash recovery.
- The v13 persistent safety halt and v9 paper engine are separate and unchanged.
- `openDemo` in `server.js` remains hard-blocked. Do not enable broker execution flags.
- Keep one Render instance for the existing paper engine until concurrency has been independently tested.
- Never share ADMIN_TOKEN, API keys, account IDs or secrets in screenshots.

## Tests
`node --check server.js && node --check v14-lifecycle.js && node --test tests/v14-lifecycle.test.js`

## Rollback
Restore the prior v13 `server.js`. v14 tables may remain unused.
