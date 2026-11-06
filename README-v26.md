# MarketPulse AI v26 — Integrated readiness release

This release builds on the complete uploaded repository. It adds a consolidated authenticated preflight API, mobile-friendly readiness dashboard and automated safety tests. **It does not enable broker execution.**

## Install
1. Back up your current GitHub repository and Render environment settings.
2. Upload the contents of this archive to the repository root, keeping existing Render environment variables. Do not upload `.env` or secrets.
3. Run `npm install`, `npm run check`, `npm test` locally or in CI before deploying.
4. Deploy to Render, then visit `/v26` and enter your existing admin token to run preflight. The token is used in the request header and not stored by the page.
5. Alternatively in Render Shell: `curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v26/status"`

## What is new
- `/v26` mobile-friendly preflight screen
- `GET /api/v26/status`, `GET /api/v26/report`, `POST /api/v26/preflight` (admin authenticated)
- 12 consolidated readiness checks; explicit unverified broker requirements
- Unit tests for hard-blocked execution and stale-feed rejection

## What is NOT claimed
- No full demo order lifecycle, crash recovery, GBP pip conversion or deal-size verification has been established.
- This release retains the existing v25 simulation; it does not add autonomous IG order placement.
- Simulated GBP P&L relies on illustrative configuration values.
- No broker write endpoints are introduced by v26. Existing legacy code should remain independently audited before any future execution approval.
