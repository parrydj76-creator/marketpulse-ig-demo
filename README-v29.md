# MarketPulse AI v29 — Real IG demo lifecycle evidence verification

This module adds **read-only verification** of orders placed manually by the operator in the IG **DEMO** platform. It does NOT place, modify or close orders. The unconditional `openDemo` hard block remains intact. No real-money or unattended broker execution is authorized.

## Operator workflow

1. Confirm your IG account is DEMO. Independently verify contract size, GBP pip conversion, minimum size, stop distance, slippage and maximum risk **before** considering a manual demo trade. If any item is uncertain, do not place an order.
2. Use the IG DEMO platform to open a small position with a protective stop and capture its actual **open dealReference**. Avoid disclosing account credentials.
3. In Render Shell, execute (replace `OPEN_REF`):

   curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"dealReference":"OPEN_REF"}' "http://127.0.0.1:${PORT:-10000}/api/v29/lifecycle/open-evidence"

4. Record returned `sessionId`. The endpoint checks IG's actual confirmation and open positions, including an attached stop level. **Do not close before the open evidence is collected.**
5. Manually close that position in the IG DEMO platform, record its actual **close dealReference** and call:

   curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"sessionId":"SESSION_ID","dealReference":"CLOSE_REF"}' "http://127.0.0.1:${PORT:-10000}/api/v29/lifecycle/close-evidence"

6. Confirm `pass:true` and all checks true. Otherwise inspect the position in IG DEMO manually. **Never blindly repeat an uncertain order.**

Status: GET `/api/v29/status` with `X-Admin-Token` header.

## Limitations

- This verifies observed broker open/close evidence, not an automated execution lifecycle.
- Session details are held in process memory and are lost on restart. The v27 evidence log records digests/results, not a fully durable lifecycle state. Do not use this as proof of restart safety.
- It does not independently verify monetary risk sizing, attached stop suitability, partial fills, fees, trade ownership, or broker recovery following a network timeout.
- No API write call is added. Unattended demo orders remain blocked until independent verification of monetary sizing, durable journal, reconciliation and in-flight recovery.
