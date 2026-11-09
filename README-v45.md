# MarketPulse AI v45 — sequenced read-only IG DEMO soak

This is **not** an order execution release. IG DEMO order writes remain HARD_BLOCKED. No GBP sizing, actual broker lifecycle or crash recovery certifications are granted.

## What changed

- Each 30-second cycle awaits v41's read-only broker observation and then v42's read-only broker evidence write.
- The cycle validates both returned timestamps and ensures the committed observer/evidence status matches the returned results.
- The status API includes diagnostic observation ages; the events API contains per-cycle success/failure evidence, rather than falling through to the old dashboard.
- On refresh error, mismatch, stale observations, broker exposure, paper/feed failure or unresolved simulated intents, the soak disarms and records the failure.
- The v45 monitor will not arm while the v44 monitor is armed. All monitors are disarmed after a Render restart. Keep v44 disarmed while testing v45.
- V41 and V42 independently impose 10-second rate limits. Avoid manually refreshing them while the v45 monitor is armed.

## Deploy

Replace repository files with the contents of this integrated ZIP. Preserve existing Render persistent disk and DATA_DIR. Keep `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`.

## Render Shell verification

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v45/status" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v36/paper/start" | python3 -m json.tool
```

Wait about 60 seconds for a healthy paper heartbeat, then refresh observations and arm promptly:

```bash
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v41/observe" | python3 -m json.tool
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v42/observe" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"operatorNote":"Operator authorises v45 read-only soak test"}' "$BASE/api/v45/arm" | python3 -m json.tool
```

After 3 minutes:

```bash
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v45/status" | python3 -m json.tool
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v45/events" | python3 -m json.tool
```

If disarmed, inspect `lastDiagnostic` and `/api/v45/events` **before** any re-arm. For manual stop:

```bash
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v45/disarm" | python3 -m json.tool
```

**Limitations:** This is a read-only monitoring soak. A successful soak does not establish real broker execution safety. Persistent journals require a mounted persistent disk; no real IG order placement is permitted.
