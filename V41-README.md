# MarketPulse AI v41 — IG DEMO Read-Only Observer

Integrated upgrade from v40. Existing durable paper and simulated order protocol journals remain unchanged. Keep Render persistent disk mounted at the same DATA_DIR.

## Deploy
Upload the **contents** of this ZIP as your existing repository (preserve the project root and package-lock.json), commit and deploy through Render. Use Node 20+. Preserve existing IG DEMO environment variables and admin authentication. Keep `BROKER_DEMO_EXECUTION=false`, `AUTO_START=false`; do not enable legacy execution flags. No new secrets needed.

## Test (Render Shell)

    curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v41/status" | python3 -m json.tool
    curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v41/observe" | python3 -m json.tool

Dashboard: `/v41` (requires existing admin authentication). Observation refresh limited to once every 10 seconds; snapshot expires after 60 seconds. The new observer calls only IG DEMO GET `/positions`, GET `/markets/{epic}`, GET `/accounts` and exposes no order writes. No raw broker account balances, tokens or account IDs are returned in observer JSON.

A broker position reported by IG is deliberately flagged for operator review, not silently treated as an error-free account. Existing paper position is explicitly *not* a broker position. IG minimum deal size and minimum stop distance are only **observed**; stop units, pip value, currency conversion, GBP risk and actual broker lifecycle remain uncertified. `brokerOrderAllowed` is always false.

## Important limits
This is not unattended trading. The legacy server contains separate broker-order endpoints, which must remain disabled using environment flags. Do not set broker certification flags based on the observer. v41's `observationHealthy` means the limited read-only snapshot checks passed; it is not a certification or permission to trade. For actual broker reconciliation, verify all account positions, working orders, transactions, deal references and pending requests, and test crash recovery under controlled supervision.
