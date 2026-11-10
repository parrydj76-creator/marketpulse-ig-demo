# MarketPulse AI v66 — consolidated supervised IG DEMO adapter

This package preserves the existing v65 compact project structure and adds **one** `v66-dealing.js` module. It includes a dedicated IG DEMO broker-write adapter, persistent append-and-fsync journal, operator prepare/approve/submit workflow, reconciliation, explicit close approval, emergency halt and an unattended-controller endpoint that refuses activation.

## Important limits

**Actual broker dealing is NOT activated or certified.** The adapter contains IG DEMO POST `/positions/otc`, GET `/confirms/{dealReference}`, and supervised close logic, but it deliberately refuses submission while GBP pip exposure and a fresh undelayed EUR/USD Mini quote remain unverified. All four execution certifications remain false. Do **not** change source guards or turn on write flags to bypass these blockers. A manual pip-value assertion is not independent GBP sizing certification.

The legacy broker path remains globally disabled. The v66 emergency halt only affects v66; it does not close IG positions. Any ambiguous open/close response is journaled for operator reconciliation and must never be automatically retried. If the Render disk is ephemeral, v66 cannot write broker orders. IG DEMO only; never use LIVE credentials.

## Deployment

1. Back up GitHub and Render persistent disk.
2. Upload the ZIP contents to your existing GitHub repository root and redeploy.
3. Keep `IG_ACCOUNT_TYPE=DEMO`, persistent storage mounted, and legacy execution disabled. **Do not enable `V66_ENABLE_SUPERVISED_IG_DEMO` or `V66_OPERATOR_RISK_VERIFIED` yet.**
4. Run read-only checks in Render Shell:

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v66/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v66/preflight" | python3 -m json.tool
```

Expected: `journalHealthy: true`, `unattendedOrderAllowed: false`, `brokerOrderAllowed: false`, and blockers for pending independent GBP risk and Mini quote certification.

## v66 endpoints (all admin-protected)

- `GET /api/v66/status` and `/api/v66/intents`
- `POST /api/v66/preflight`
- `POST /api/v66/prepare` with `id`, `direction`, `size`, `stopPips`, `targetPips`, `verifiedPipGBP` (operator assertion only)
- `POST /api/v66/approve` with `id`, `confirm: APPROVE_IG_DEMO_<id>`
- `POST /api/v66/execute` with `id`, `confirm: SUBMIT_IG_DEMO_<id>` — **currently refuses broker submission**
- `POST /api/v66/close` with `id`, `confirm: CLOSE_IG_DEMO_<id>` — for future supervised broker test only
- `POST /api/v66/reconcile` — read-only broker readback plus journal event
- `POST /api/v66/cancel` — only before submission
- `POST /api/v66/emergency-halt` with `confirm: HALT_V66` — persistent, no reset endpoint
- `POST /api/v66/arm-unattended` — always refuses

## Required next certification work

Verify actual IG EUR/USD Mini order size units and GBP pip exposure independently, and implement a fresh undelayed Mini quote gate. Then test one operator-approved IG DEMO open with attached stop and broker readback, close and reconcile it, and inject network interruption/restart faults. Only after those supervised tests should unattended certification begin.
