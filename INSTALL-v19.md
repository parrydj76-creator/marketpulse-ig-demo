# MarketPulse AI v19 — IG DEMO Automation Bridge

This ZIP is the complete repository snapshot with the v19 changes integrated. Back up your GitHub repository before applying changes. Copy the repository contents into the matching root locations (do not nest the top-level folder), commit and deploy to Render. Keep existing Render environment secrets and PostgreSQL database unchanged.

Visit https://marketpulse-ig-demo.onrender.com/v19 . Enter ADMIN_TOKEN directly in the deployed page. Run Refresh status and Read-only IG snapshot. The risk laboratory accepts independently verified inputs but ALWAYS returns brokerOrderAllowed=false.

v19 adds no order submission capability. Existing `openDemo()` remains unconditionally hard-blocked. Do not remove that block. Real IG DEMO automation requires verified contract units/GBP-per-pip conversion, executable deal size, order acknowledgement/unknown-outcome reconciliation, and crash recovery tests. No credentials should be shared in chat.

Existing v17 rehearsals and push notifications are unchanged. This release does not introduce automatic IG DEMO order execution or claim that the 1% daily loss threshold is broker enforced.
