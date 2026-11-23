MarketPulse AI v12.0 — combined broker verification and memory audit

INSTALL (GitHub browser; no terminal):
1. Back up existing server.js and public/operations.html.
2. Replace server.js and public/operations.html.
3. Add marketpulse-v120-verification.js in repository root.
4. Keep ALL prior v8.x-v11.0 modules, tests and persistent data.
5. Commit, wait for Render deployment and open /operations.html.
6. Inspect v11.1-v12.0 Broker Verification & Memory Audit.

This is READ-ONLY. Broker orders remain hard-blocked.
The new tests are LOCAL MODEL tests, not IG broker tests.
Risk examples use synthetic GBP/pip values, not certified IG contract exposure.
No additional background polling or timers.

IMPORTANT: This package does NOT remove legacy modules, guarantee 512 MB stability,
certify broker order lifecycle or authorize unattended trading.
