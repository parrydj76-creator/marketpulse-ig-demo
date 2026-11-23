MarketPulse AI v76 read-only mega diagnostic upgrade

Upload BOTH server.js and marketpulse-v76-readiness.js to the ROOT of the same GitHub repository, then commit and deploy. Do not delete other files.

New endpoints:
GET /api/v76/readiness - public readiness summary (no account identifiers)
GET /api/v76/metrics - admin-token protected bounded historical metrics and state transitions

This upgrade preserves existing endpoints and IG DEMO broker execution HARD_BLOCKED. It does not turn on paper trading or IG order placement. It adds seven-pair feed/candle readiness, memory RSS/heap monitoring, bounded diagnostics, persisted readiness transitions and safety blockers.

Do not set IG broker execution flags or enable unattended broker trading. Render Free can sleep; use always-on hosting and independently verify recovery and risk sizing before considering broker execution.
