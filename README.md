# MarketPulse AI V6.3 — Seven major forex pairs (IG DEMO ONLY)

Full deployment package based on V6.2.1, including `server.js`, `multi-engine.js`, `paper-engine.js`, and dashboard assets.

## Improvements
- Only EUR/USD, GBP/USD, USD/JPY, USD/CHF, USD/CAD, AUD/USD, NZD/USD (standard CFD contracts).
- Pair-specific risk values stored durably as Render environment variables (`MP_<PAIR>_*`).
- Per-pair IG dealing-rule check before any broker order; reject mismatched verified minimum size.
- One-at-a-time order submission, pending-order journal, pre-order reconciliation, global position/daily caps.
- Execution journal includes pending orders, confirmed tracked positions and daily counts.
- More explicit fail-closed restart policy: automatic execution requires both `PERSISTENT_STORAGE_CONFIRMED=true` and `MP_DURABLE_JOURNAL_VERIFIED=true`, plus a successfully restored journal, verified per-pair lifecycle, current prices and warmed-up signals.
- Existing open positions prevent automatic re-arming because automated close/recovery is NOT implemented.

## Deploy on Render Free
Upload all files to GitHub, preserving folder structure and your existing `public/control.html`.
Set `ENABLE_IG_DEMO_ORDERS=false`, `MP_AUTO_RESUME=false`, `PERSISTENT_STORAGE_CONFIRMED=false`, `MP_DURABLE_JOURNAL_VERIFIED=false`.
Deploy and check `/api/state` and `/api/multi/status`. Expect seven streaming markets after reconnect and 30 sampled five-minute bars per pair before signals are eligible.

## Persistent storage (requires a plan supporting persistent disks)
Provision and mount a disk, configure `MP_JOURNAL_PATH` on that disk, and verify it survives a restart. Never set durable-journal verification flags merely to bypass a safety check. A new or missing journal is not automatically trusted. Test recovery and broker reconciliation with IG Demo first.

## Important limitations
This release is **not** a finished unattended trading system: it does not implement automatic closing, robust cross-process atomic transactions, completed-order history recovery from IG, or broker-side risk-budget conversion across currencies. Render Free is ephemeral and can sleep. **Keep automatic resume and broker orders disabled until independently validated.** No live-money trading.

Risk settings are supplied via Render environment variables, not an in-app save button. Broker `currencyCode`, min deal size, point units, and stop/limit distances must be verified separately for each pair.
