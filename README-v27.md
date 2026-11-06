# MarketPulse AI v27 — Integrated evidence and failure lab

This is an additive upgrade over v26. It does NOT enable IG broker orders. Includes authenticated `/v27` dashboard, `/api/v27/status`, `/api/v27/evidence`, POST `/api/v27/preflight`, and POST `/api/v27/failure-lab`. The failure lab is SYNTHETIC only.

## Deployment
Upload archive contents to GitHub repository root; keep existing environment settings and secret values in Render, not GitHub. Run `npm install && npm run check && npm test`. Deploy, then visit `/v27`. In Render Shell: `curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v27/status"`.

## Storage and safety
Evidence is an append-only hash chain in `DATA_DIR/v27-evidence.json` with atomic replacement, not an independently durable database or tamper-proof audit log. Render ephemeral storage can lose records on restart/redeploy. Corruption fails closed for new evidence writes. Synthetic failure scenarios do not test the IG API. The original legacy demo order endpoints remain in the project but `openDemo` is hard-blocked; do not remove this guard or enable any other execution path. Before unattended IG demo execution, independently verify GBP pip values, dealing units, stops, broker order lifecycle, idempotency, persistent recovery, and operator authorization.
