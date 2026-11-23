MarketPulse AI v8.4 — Unattended Readiness Workbench (READ ONLY)

GitHub-only installation (no Mac Terminal):
1. Back up your existing server.js and public/operations.html.
2. Replace root server.js and public/operations.html with the two files in this ZIP.
3. Add marketpulse-v84-workbench.js to the repository root.
4. KEEP every existing v8.0, v8.1, v8.2, v8.3 module and persistent data.
5. Commit and wait for Render to deploy; visit /operations.html and connect with your existing admin token.
6. Review v8.4 workbench and compare journal, simulated ledger and blockers.

Endpoint: GET /api/admin/v84/workbench, authenticated with X-Admin-Token.
No broker orders; no new timers; no auto-arm. Synthetic formula checks DO NOT certify IG GBP/pip values.
A retained 120-event journal may omit older trade openings. SHA-256 is for journal identity, not a tamper-proof audit chain.
Do not share your admin token. Do not restart while a simulated position is open solely to test recovery.
