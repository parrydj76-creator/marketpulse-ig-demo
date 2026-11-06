# MarketPulse AI v16.0 — Safety Validation Lab

## Contents
- `server.js`: v15 server with v16 routes registered BEFORE the index.html catch-all.
- `v16-safety.js`: isolated v16 validation API, PostgreSQL journal and safety halt.
- `v16-worker.js`: child process used only for database uniqueness probes.
- `public/v16.html`: mobile-friendly v16 dashboard.
- `tests/v16-safety.test.js`: offline safety tests.

## Deploy
1. Back up your working GitHub repository and Render environment settings.
2. Replace root `server.js` and ADD root `v16-safety.js`, `v16-worker.js`.
3. ADD `public/v16.html` and optionally `tests/v16-safety.test.js`.
4. Keep ALL existing v9-v15 JS modules and public pages. Do not remove push files or service worker.
5. Keep your existing `pg` dependency, `DATABASE_URL`, `ADMIN_TOKEN` and IG DEMO environment settings unchanged.
6. Commit to GitHub, wait for Render Live, open `https://marketpulse-ig-demo.onrender.com/v16`.
7. Enter ADMIN_TOKEN only in the deployed app, not in chat.

## Tests
- `node --test tests/v16-safety.test.js` (requires existing v15 and v14 modules in your repository).
- On v16 run Refresh status, Run 8-process probe, Run negative risk tests.
- To check persistence: Create marker, save marker privately, restart Render service manually, reopen /v16, enter marker, Verify marker. A record found is not evidence of in-flight order recovery.

## Safety and limitations
- The eight-process probe uses separate local OS processes and a shared PostgreSQL unique key; it is NOT a multi-Render-instance test.
- No automatic signal-to-intent generation in this release; that requires a reviewed connection to your actual v9 strategy and a persistent, deduplicated scheduler.
- No broker contract-value verification is claimed. IG POINTS are not assumed to be pips; executable deal size remains unverified.
- No broker order is sent; existing hard-block must remain.
- v16 halt controls v16 lab only. It does not pause the v9 paper engine or IG connection. Use v9 controls to pause paper entries.
- The v16 persistence marker survives in PostgreSQL, but it does not test crash timing, outstanding broker submissions, or recovery of in-flight intents.
- No new push integration is wired; existing push notification functionality is left unchanged.
