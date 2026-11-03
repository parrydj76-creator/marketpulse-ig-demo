# MarketPulse AI V5.8 — IG DEMO order safety candidate

Built from the user-supplied V5.7 server.js, preserving IG Lightstreamer pricing, strategy, REST fallback, dashboard, paper engine, and admin endpoints. **Not a verified ready-to-run unattended bot.**

## Changes
- IG POST order submissions are **never automatically retried** after authentication errors; GET reads may refresh auth.
- Pending OPEN/CLOSE journal is written before broker submission and retained until confirmation and state persistence.
- Corrupt local trade-state fails closed. A missing tracked broker position disarms rather than erasing the record.
- Startup process lock acquired before listening.
- Public diagnostics redact the account ID embedded in stream item names.
- Auto-start and arming require `IG_DEMO_ORDER_LIFECYCLE_VERIFIED=true`, an explicit operator assertion **only after actual supervised demo tests**.
- `/api/state` includes `executionReadiness` diagnostics.
- Broker execution remains blocked without durable storage.

## Install
1. Back up the current GitHub repository. Replace server.js and supporting package files while preserving the `public` directory.
2. Keep existing IG credentials and ADMIN_TOKEN in Render Environment, never in GitHub.
3. On Render Free use `ENABLE_IG_DEMO_ORDERS=false`, `PERSISTENT_STORAGE_CONFIRMED=false`, and `IG_DEMO_ORDER_LIFECYCLE_VERIFIED=false`. You can monitor prices and test paper trading.
4. For IG demo orders, move to an always-on instance with an actually mounted persistent disk, test persistence after restart, and confirm the IG market's minimum deal size, stop units, and currency. Set `IG_VERIFIED_MIN_SIZE`, `IG_VERIFIED_STOP_UNITS`, and positive DEMO trade size, stop, limit, max spread only after validation.
5. Supervise one demo open, verify broker-side stops, close, and recovery after restart. Only then set `IG_DEMO_ORDER_LIFECYCLE_VERIFIED=true`. Use admin endpoints to review risk and arm, or explicitly enable auto-start after validation.
6. Inspect `/api/state` for version `5.8.0` and `executionReadiness`.

## Important limitations
- **Render Free is not suitable for unattended broker execution**; this build deliberately refuses broker execution without persistent storage.
- A directory lock is not a distributed lock. Avoid running more than one service instance.
- A pending ambiguous order intentionally blocks further trading until manual broker reconciliation.
- Code syntax checks do not validate IG contract details or API execution.
- This is experimental trading software. Demo profits do not predict live results.
