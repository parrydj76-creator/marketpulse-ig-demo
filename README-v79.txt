MarketPulse AI v7.9 — Unattended Readiness MEGA upgrade (READ ONLY)

INSTALL WITHOUT TERMINAL
1. Back up your GitHub server.js.
2. Replace GitHub root server.js with the one in this ZIP.
3. Upload public/operations.html to the repository public folder (create folder only if missing).
4. Keep package.json and every other existing file unchanged; v7.8 package.json already pins Node 22.x.
5. Commit and wait for Render deploy. Visit /api/health and confirm version 7.9.0.
6. Visit https://YOUR-RENDER-URL/operations.html, paste ADMIN_TOKEN in the password field and click Connect.
7. Never share your admin token in chat, screenshots, or GitHub. The browser page stores it in JS memory only; closing/reloading clears it.

NEW
- /operations.html: responsive, authenticated browser operations cockpit, 15s polling.
- /api/admin/v79/readiness: bounded 180-sample memory history, stream/candle/shadow-readiness status, explicit blockers.
- /api/admin/v79/health: shorter read-only operational diagnostics.
- v7.9 main health version.

SAFETY
No broker execution, no broker orders, no auto-arm. Existing global BROKER_DEMO_EXECUTION=false and hard throw in openDemo are unchanged.
The shadow readiness flag is NOT proof of strategy profitability or order execution certification.
All memory readings are in-process and reset on restart. Render Free may sleep or restart; not suitable for unattended broker execution.

VALIDATION
Static syntax checks for server.js and dashboard script; archive integrity. Live IG and Render tests cannot be performed here.
Rollback: restore previous server.js and delete operations.html.
