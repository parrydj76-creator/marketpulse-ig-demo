MarketPulse AI v10.0 — Consolidated Safety & Restart Audit

INSTALL USING GITHUB (NO TERMINAL):
1. Back up your existing GitHub server.js and public/operations.html.
2. Replace server.js and public/operations.html with package versions.
3. Upload marketpulse-v100-safety-audit.js into repository root.
4. KEEP ALL existing v8.x and v9.x modules and your durable data intact.
5. Commit and wait for Render deployment. Open /operations.html and connect.

Adds authenticated GET /api/admin/v100/safety, a read-only report comparing legacy v9.1 latch, v9.5 latch, and on-disk v9.5 revision. Highlights conflicts, missing persistence, memory >=450 MB, and feed freshness. Does NOT change execution authorization or certify IG risk. Existing IG execution is hard-blocked by server.js. This does NOT unify latches into an enforcement gate or test broker orders.

IMPORTANT: A reported fail-closed state is an audit verdict, not proof that all historical broker order paths consult this audit. Do not turn on IG execution. Render Free 512 MB is not suitable for reliable unattended execution.
