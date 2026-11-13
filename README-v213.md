# MarketPulse AI v209–v213 — Controlled DEMO Readiness Package

**This package does not enable IG DEMO broker order submission.** The current server has a global hard-coded broker write block. Real certifications cannot be completed offline, and passing evidence assertions does not prove a live broker lifecycle. No environment variable overrides this restriction.

## Included milestones
- **v209**: GBP-denominated worst-case risk preview, incorporating stop distance, spread, slippage and fees. Inputs require independently verified contract/fee references; calculations are not broker certification.
- **v210**: Operator-supervised IG DEMO lifecycle evidence checklist, including open confirmation, broker-protective stop, close and statement references. It records evidence only and does not place orders.
- **v211**: Durable restart challenge and evidence verification; manual crash/unknown submission and fencing evidence checklist.
- **v212**: GET-only broker snapshot, integrity verification and explicit operator safety gate. No IG write adapter is wired.
- **v213**: Consolidated readiness API, seven independent certification blockers and explicit fail-closed arm/submit endpoints.

## Install
Backup existing GitHub files, replace with ZIP contents (files are inside the project folder), commit and deploy to Render. Keep `BROKER_DEMO_EXECUTION=false`, `AUTO_START=false`, and do not change broker write blocks. Preserve secret env vars, never paste tokens into chat.

## Render Shell
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
for endpoint in status readiness audit; do
  echo "=== $endpoint ==="
  curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v213/$endpoint" | python3 -m json.tool
done
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v213/broker/snapshot" | python3 -m json.tool
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v213/restart/challenge" | python3 -m json.tool
```
Save challenge `id`; restart Render service; then:
```bash
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v213/evidence/REPLACE_WITH_CHALLENGE_ID/verify" | python3 -m json.tool
```
After creating evidence, `/api/v213/audit` should check >0 rows and verify true.

## Evidence-only risk example (NOT a certified GBP/pip value)
```bash
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' \
 -d '{"confirm":"EVIDENCE_ONLY_NO_ORDER","epic":"CS.D.EURUSD.MINI.IP","currency":"GBP","size":0.1,"gbpPerPipPerUnit":1,"stopPips":12,"spreadPips":1,"slippagePips":2,"estimatedFeesGBP":1,"dailyLossGBP":100,"todayNetLossGBP":0,"contractSourceVerified":false,"feeScheduleVerified":false,"minimumDealSizeVerified":false,"sizeIncrementVerified":false}' \
 "$BASE/api/v213/check/RISK" | python3 -m json.tool
```
This illustrative input MUST fail independent verification. Do not interpret `gbpPerPipPerUnit:1` as actual IG Mini contract value.

## Supervised DEMO order procedure (manual, via IG platform only)
Before any real order, independently establish contract size, currency conversion, deal increments, fees, market timestamp provenance and risk. With a human present and only if suitable, place a minimal IG DEMO order manually through IG's own interface, verify a protective stop at the broker, close and reconcile its fees/statement. Do not manufacture order references or mark checks certified without actual evidence. Record any crash/recovery results with real broker history and restart logs. Unknown outcomes require operator investigation, never blind retries.

## Release gate
All seven certifications remain FALSE and no broker write adapter is provided. The next phase requires source-verified IG documentation, transaction and statement evidence, an independently reviewed execution design, broker-backed stop and crash tests, and staged human approval. Do not enable unattended demo trading on this release.
