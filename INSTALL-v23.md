# MarketPulse AI v23 — DEMO Automation Lab

This package is based on the complete v22 project and preserves all previous routes.

## Deployment
1. Extract the ZIP and upload **the contents** of `marketpulse-ig-demo-main/` into the root of your existing GitHub repository.
2. Commit and allow Render to deploy. Keep existing environment variables and PostgreSQL database.
3. Open `https://marketpulse-ig-demo.onrender.com/v23`, enter your existing ADMIN_TOKEN and refresh.
4. Use the simulation journal, create a restart marker, restart Render, and verify the marker with the same ID.

## Execution status
- IG broker writes are **HARD_BLOCKED**, including the pre-existing `openDemo` implementation.
- The new `/api/v23/submit` endpoint always returns HTTP 423 and sends no orders.
- No real or demo positions are opened, amended or closed by v23.
- Monetary sizing is illustrative, not independently verified; operator-supplied flags do not establish verification.
- Simulated UNKNOWN order outcomes are not resubmitted.
- A restart marker verifies process-level persistence, **not** in-flight broker order recovery.
- `/api/v23/broker` is read-only. No automated association between simulated intents and IG deal references is claimed.

## Before unattended IG DEMO automation
Independently establish GBP-per-pip and size increment for the specific IG instrument and account currency; verify stop-distance units and dealing constraints; test submission/confirmation/rejection/timeouts with an isolated DEMO harness; implement idempotent broker reconciliation and crash recovery; verify risk gates and operator approval. Only then consider a separately reviewed opt-in demo execution release. Live-money execution is out of scope.
