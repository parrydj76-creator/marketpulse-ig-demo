# MarketPulse AI V6.5 — Seven Major Forex IG Demo AutoTrader

This is a **staged DEMO-only automation package**. It is NOT ready for unattended execution without independent end-to-end testing. It will not automatically arm itself on restart.

## Supported pairs
EUR/USD, GBP/USD, USD/JPY, USD/CHF, USD/CAD, AUD/USD, NZD/USD.
All seven stream prices. Each pair has an independently enabled risk configuration in `/risk`.
Only validated, enabled pairs are eligible for automated demo orders.

## What the engine does
- Waits for 30 consecutive five-minute streaming candles per enabled pair before arming.
- Evaluates signals on newly sampled bars, spread and score thresholds.
- Checks IG market status, account currency, minimum deal size, minimum stop/limit distance and unit.
- Journals pending submissions before POST, confirms accepted orders and broker-side stop/limit levels.
- Refuses new entries when ANY broker position is open (maximum one at a time in this release).
- Reconciles tracked broker positions; unexpected positions, pending submissions or missing protection stop new entries.
- Persists journal to disk, requires verified mounted persistent storage and explicit operator arming.
- Emergency stop blocks new entries; it does NOT close positions.

## Known limitations (important)
- Broker-attached stops and limits are the only automatic exits; time-based close is NOT implemented.
- Portfolio-level loss caps, FX conversion of monetary risk, correlated exposure limits and broker completed-trade history recovery are NOT implemented.
- The journal's daily entry count is reset at UTC midnight; verify independently that no unresolved prior-day order exists.
- `MP_GLOBAL_MAX_OPEN` should remain 1. Any open position prevents new entries regardless of this value.
- Per-pair deal size maximum is currently 1; IG contract minimum and correct sizing must be verified.
- Live strategy performance has not been backtested or validated. A signal is not a guarantee of profit.
- Do not enable real-money execution.

## Installation
1. Back up GitHub repository. Upload entire ZIP to repository root, preserving `/public`, `risk-store.js`, `multi-engine.js`, `server.js`.
2. On paid Render, attach a persistent disk mounted at `/var/data`; run **one instance**.
3. Configure `DATA_DIR=/var/data/marketpulse`, `MP_JOURNAL_PATH=/var/data/marketpulse/multi-journal.json`, `MP_RISK_SETTINGS_PATH=/var/data/marketpulse/multi-risk.json`, and `RENDER_DISK_MOUNT_PATH=/var/data` (after confirming actual mount).
4. Keep all execution gates false initially: `ENABLE_IG_DEMO_ORDERS=false`, `MP_V65_DEMO_EXECUTION=false`, `MP_V65_LIFECYCLE_TESTED=false`, `MP_SINGLE_INSTANCE_VERIFIED=false`, `MP_AUTO_RESUME=false`.
5. Check `/api/state` and `/api/multi/status`. Confirm all seven live streams.
6. Test disk durability by saving settings in `/risk`, restarting Render and confirming settings persist.
7. Verify IG Demo dealing rules and full order lifecycle for EACH pair separately, including order confirmation, attached protection, manual close and reconciliation. Do not set lifecycleVerified for a pair until tested.
8. Confirm all journal safeguards, account matching, pending-order recovery, and operator emergency stop.
9. Only after independent testing, enable execution gates and use authenticated `POST /api/admin/multi/arm` with JSON `{"confirm":"ARM_IG_DEMO_SEVEN_PAIRS"}`. `ADMIN_TOKEN` authentication is required. Do not arm from a public or shared computer.
10. Monitor demo account and logs. Restart leaves the engine disarmed; manually reconcile and re-arm.

## Risk controls
Start with one pair enabled, `MP_GLOBAL_MAX_OPEN=1`, `MP_GLOBAL_DAILY_CAP=2`.
The Risk Centre's `enabled` flag controls each pair. Do not enable all seven until each has individually passed IG Demo dealing-rule and lifecycle verification.

## Security
Keep IG credentials and ADMIN_TOKEN in Render environment secrets. Never commit them to GitHub. Use HTTPS, rotate secrets after exposure, restrict admin access, and keep demo execution off during deployment.
