MarketPulse AI v8.0 — Durable Shadow Mega Upgrade

INSTALL WITHOUT MAC TERMINAL
1. Back up your current GitHub server.js and public/operations.html.
2. Upload server.js to the repository root, replacing the existing file.
3. Upload marketpulse-v80-shadow.js to the repository root (new file).
4. Upload public/operations.html to the public folder, replacing the existing file.
5. Commit changes. Allow Render to deploy, then visit:
   https://marketpulse-ig-demo.onrender.com/operations.html
6. Enter your existing ADMIN_TOKEN in the browser dashboard. Never share the token in chat.
7. Verify /api/health reports version 8.0.0 and that the dashboard connects.

NEW AUTHENTICATED READ-ONLY ROUTES
GET /api/admin/v80/operations — readiness + shadow simulator status
GET /api/admin/v80/shadow — shadow simulator journal and status

DESIGN
- Seven streaming markets and historical endpoints are preserved.
- Shadow simulator operates every 30 seconds and only after 30 consecutive completed 5-minute bars.
- Entries require a fresh explicitly non-delayed tradeable streaming quote, direction LONG/SHORT, score >=70, and a new bar.
- Simulated long entries use ask; simulated short entries use bid. Exit uses the opposite side.
- Simulated stop 12 pips, target 18 pips, time limit 180 minutes; no monetary P/L claims.
- New shadow activity pauses at RSS >=450MB, on unhealthy storage, or without confirmed persistent storage.
- Journal is bounded to 120 events, written atomically to DATA_DIR/v80-shadow-journal.json.
- A corrupt journal disables shadow activity until investigated; never erase it blindly.
- No broker API or order callbacks are passed to the shadow engine. Existing broker execution hard-block remains.

LIMITATIONS
- The source still initialises many historical modules; this version does not remove them blindly.
- Render Free memory remains a significant constraint; this upgrade is not a proven memory reduction.
- Shadow simulator is not broker execution, not a reliable performance backtest, and does not verify real-world fills.
- A confirmed durable DATA_DIR is required to activate shadow entries. On Render Free without persistent disk, observation-only is expected.
- Static syntax tests and isolated module unit tests do not certify integration or unattended trading.
- Before enabling any IG DEMO orders, separately verify GBP risk, stop/limit units, order lifecycle, crash recovery, reconciliation and kill switch on reliable hosting.

ROLLBACK
Restore previous server.js and public/operations.html; leave v80 module unused.
