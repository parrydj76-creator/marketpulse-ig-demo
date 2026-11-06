# MarketPulse AI v21 — Complete GitHub repository

This ZIP retains the v20 folder structure and adds `v21-engine.js`, `public/v21.html`, `tests/v21-engine.test.js`, and v21 route registration in `server.js`.

1. Back up your GitHub repository and Render environment settings.
2. Unzip and upload **contents of `marketpulse-ig-demo-main`** to the **root** of your existing GitHub repository, replacing matching files. Do not upload an extra nested folder.
3. Keep `DATABASE_URL`, `ADMIN_TOKEN`, existing IG DEMO credentials and your Render Start Command `npm start`. Never paste credentials into chat.
4. Deploy on Render and wait for Live. Open `https://marketpulse-ig-demo.onrender.com/v21`.
5. Enter ADMIN_TOKEN in the deployed dashboard, press Refresh dashboard, Read-only IG reconciliation, and Restart readiness. Test dry-run duplicate prevention using the same bar and direction twice.
6. For local verification: `npm install`, `npm test`, `node --check server.js`.

## Safety boundary
- v21 makes read-only IG GET calls only; **no broker order placement, modification or cancellation**.
- All broker execution gates remain hard-blocked even if a worksheet returns `pass:true`.
- The monetary worksheet uses manually entered evidence and cannot independently certify broker contract conversion or minimum sizing.
- Recovery checks report PostgreSQL state; they do not prove crash-safe in-flight order recovery.
- A pre-existing legacy broker path in server.js is outside this v21 module. Preserve existing hard blocks and keep any legacy broker execution configuration disabled.
- Do not run multiple Render workers until coordination and reconciliation are independently tested.
