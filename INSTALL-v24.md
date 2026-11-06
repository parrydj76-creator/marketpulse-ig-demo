# MarketPulse AI v24 — IG DEMO Evidence Lab

Upload the **contents** of this repository folder to the root of your existing GitHub repository, keeping the folder structure. Deploy the updated commit on Render. Open `/v24` on your existing Render domain. Use the existing ADMIN_TOKEN; never paste credentials into chats.

## Test sequence
1. Readiness: expect `ready:true` and `brokerOrderAllowed:false`.
2. Capture IG snapshot: stores redacted, read-only market/account-type/position evidence in PostgreSQL.
3. Evidence journal: confirm the snapshot persists.
4. Create synthetic fault: record its UUID and boot ID. Restart Render.
5. Check recovery: verify the same UUID remains unresolved and `bootChanged:true`. Synthetic recovery is **not** broker in-flight recovery.
6. Run illustrative sizing; it cannot authorise orders.

## Safety
No broker write calls in v24. The unconditional `openDemo` block in server.js is unchanged. Do not change `ENABLE_IG_DEMO_ORDERS` or verification flags to try to bypass safety checks. Actual IG DEMO order submission needs independent contract/FX/deal-size verification, a separately audited broker lifecycle implementation, recovery against IG deal references, and explicit operator approval. No live-money trading.
