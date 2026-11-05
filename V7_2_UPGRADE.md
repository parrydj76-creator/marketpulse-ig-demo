# MarketPulse AI v7.2 — Feed diagnostics and dashboard

## Changes
- Adds read-only `/api/feed/health` with quote age, source, stream status, subscription acceptance, update counts and non-secret error summary.
- `/api/state` includes `feedHealth`; the paper dashboard displays the diagnosis and checks current quote freshness before showing a signal.
- Unifies `/api/state`, `/api/health`, `/api/paper`, `/api/paper/recovery` and analytics version labels to 7.2.0; updates paper dashboard title.
- Adds automated tests for fresh/stale/REST/invalid quotes and subscription diagnostics.

## Installation
Back up your repository. Upload all files from the project directory to the repository root (not the containing folder). Deploy on Render. Run `npm test` and `node --check server.js`.

## Verification
Open `/api/feed/health` and `/api/state`. Check `streamStatus`, `subscriptionAccepted`, `subscriptionUpdates`, `validStreamQuotes`, `quoteAgeSeconds`, `quoteSource`, and `reason`. If the stream remains stale, inspect Render logs for IG login and subscription errors; do not assume credentials or market hours are the cause. The diagnostic does not change IG subscriptions or credentials.

## Safety
Paper trading remains paused (`paperRecoveryReady=false`); IG order functions retain unconditional broker blocks. This is an observability upgrade, not a verified fix for the underlying IG streaming problem. Never share IG keys, admin tokens, CST or XST values in screenshots or logs.
