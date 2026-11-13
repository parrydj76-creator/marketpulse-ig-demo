# MarketPulse AI v195 — Integrity and Recovery Readiness Mega Upgrade

This bundle includes the v194 canonical SHA-256 integrity hotfix, original v194 legacy-record verification and a new v195 persistent audit/readiness gate. It preserves the existing v193/v194 read-only capabilities. **No broker orders can be placed by v195.**

## Install
Back up the repository. Copy the contents of this ZIP into the repository root, commit and redeploy Render. The new v195 module is registered in server.js. Do not enable broker execution; keep `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`. No environment secrets are bundled.

## Render Shell

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v194/audit" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v195/status" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v195/readiness" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v195/audit/run" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v195/audit/integrity" | python3 -m json.tool
```

To verify a specific persisted audit across a Render restart: `GET /api/v195/audit/verify/<id>` with admin token.

## Important distinctions

- `verified: false` on `/api/v195/audit/run` means the readiness gate is **blocked**, not that the SHA-256 hash is invalid. Check `/api/v195/audit/integrity` or `/api/v195/audit/verify/<id>` for cryptographic integrity.
- Existing v194 records are not modified. Canonical v194 digests are verified directly; legacy digests are verified against known legacy field ordering only. Inspect `legacyVerified` and `failures` in `/api/v194/audit`.
- Audits cover bounded samples, not all historical rows. The readiness gate therefore remains blocked.
- Broker execution certification remains **0/7**. No actual stop, unknown submission, or distributed broker write-path certification has been performed.
- The old server.js contains separate legacy routes. Its broker execution is hardcoded off. Do not change this or assume v195 protects an independently modified legacy execution path.

## Local tests

`node test-v194.js && node test-v195.js` (mocked tests; requires actual PostgreSQL and IG DEMO smoke tests before operational claims).
