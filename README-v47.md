# MarketPulse AI v47 — Broker Certification Evidence Workbench

## Critical safety boundary

This release adds three certification **evidence workflows**, not three completed certifications. All certification flags remain `false`. No IG order-write function is imported into the v47 module, and `brokerOrderAllowed` is always false. v46 unattended read-only monitoring is preserved. Do not enable any existing broker-order execution flags.

## Evidence workflows

1. **GBP pip value and position sizing:** `/api/v47/size-preview` retrieves IG DEMO EUR/USD market rules and produces an illustrative GBP risk calculation from operator-provided inputs. It explicitly does **not** confuse IG minimum deal size with deal-size increment, and does not certify conversion or broker P/L. Independent IG contract and currency conversion evidence is still required.
2. **Broker lifecycle:** after stopping v46, record `/api/v47/baseline` with no broker positions. If the operator separately chooses to open an actual IG DEMO trade *using IG's own platform*, capture `/api/v47/observe-open` with the broker deal ID. Requires exactly one matching EUR/USD position with attached stop and limit. Once the operator closes the position in IG, `/api/v47/observe-close` verifies its absence. This does not independently prove order acknowledgement, attached stop execution, realised P/L, or a complete order lifecycle.
3. **Restart reconciliation:** with a broker position already observed, restart Render, then call `/api/v47/reconcile-after-restart`. Requires a changed process boot ID and identical deal ID, size, direction and account fingerprint. This verifies read-only reconciliation across restart, **not** in-flight order recovery.

Evidence is stored in a durable SHA-256 hash-chained journal, checked at startup. A failed integrity check blocks evidence writes. All endpoints require the existing admin token. The new workbench refuses broker observation operations while v46 monitoring is armed, because v46 intentionally disarms if real broker exposure appears. Observe the 12-second gap between manual broker observations.

## Installation

Back up the GitHub repository and Render persistent disk. Upload the project contents and redeploy. Preserve `DATA_DIR`, credentials and disk. Keep `MP_V65_DEMO_EXECUTION=false`, `ENABLE_IG_DEMO_ORDERS=false`, `BROKER_DEMO_EXECUTION=false`, and `AUTO_START=false`. The project has an unconditional broker order block in its existing `openDemo` function; do not remove it.

## First Render checks (safe; no IG orders)

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v47/status" | python3 -m json.tool
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v46/status" | python3 -m json.tool
```

For a sizing preview (does not certify):

```bash
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"size":1,"stopPips":12,"maxRiskGBP":25}' "$BASE/api/v47/size-preview" | python3 -m json.tool
```

**Do not place a real or demo broker order as part of deployment verification.** Broker lifecycle testing is a separate, explicitly operator-controlled step; it may incur demo losses and requires a prepared risk plan. Do not assume broker positions can be left unattended through restarts.
