# MarketPulse AI v49 — certification and simulation workbench

v49 adds a **read-only** EUR/USD Mini evidence journal, GBP risk preview, and deterministic simulation of order safety gates. It **does not** enable unattended IG DEMO trading and cannot place broker orders. Do not disable existing execution safeguards.

## Routes (X-Admin-Token required)
- `GET /api/v49/status` — health, unresolved certifications, evidence status
- `POST /api/v49/inspect` — IG DEMO GET market, positions and accounts; appends sanitized journal snapshot
- `POST /api/v49/risk-preview` — inspect first; accepts `size`, `stopPips`, `maxRiskGBP`, `slippagePips`, `feeGBP`, `accountCurrency`, `fx`, `incrementEvidence`, `stopEvidence`, `lossEvidence`; calculations are NOT certified
- `POST /api/v49/simulate` — simulate safety gates, duplicate prevention, kill switch and recovery, never places an order
- `GET /api/v49/events` — latest sanitized journal event metadata
- `POST /api/v49/arm-unattended` — ALWAYS returns HTTP 409

## Example shell checks
```
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v49/status" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v49/inspect" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"size":0.1,"stopPips":12,"maxRiskGBP":25}' "$BASE/api/v49/risk-preview" | python3 -m json.tool
```

## Outstanding certifications
1. Independently confirm GBP account conversion and broker P/L using actual IG DEMO records; operator inputs are evidence candidates only.
2. Observe open and close confirmations, deal references, attached stops and actual realized GBP P/L. The existing v47 evidence workbench remains separate and hardcoded to standard EUR/USD; do not claim its results certify Mini.
3. Independently verify restart recovery with a real broker position and durable unresolved-order intent tracking.
4. Implement and independently test an actual broker execution adapter in a later version, with server-enforced risk, protective orders, idempotency, reconciliation, rate limits and emergency stop. No write adapter is supplied in v49.

**Important:** This package retains all legacy server modules and configuration. If a legacy trading mode is enabled through environment variables, v49's read-only module does not override that mode. Keep `BROKER_DEMO_EXECUTION` disabled and verify all other trading-mode flags before deployment. Back up your repository and persistent data first.
