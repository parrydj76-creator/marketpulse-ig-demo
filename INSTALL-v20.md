# MarketPulse AI v20 — fail-closed IG DEMO readiness

This is an integrated repository update, not live or DEMO broker order automation. It preserves the existing unconditional `openDemo` broker safety throw. No broker POST requests are introduced.

1. Back up your current GitHub repository and Render configuration.
2. Upload the extracted contents of `marketpulse-ig-demo-main/` to the repository root (not as a nested folder).
3. Do not change IG credentials, push keys, ADMIN_TOKEN, or broker execution flags.
4. Deploy to Render and visit `/v20`.
5. Enter ADMIN_TOKEN only into your own deployed app, then run the read-only readiness check and illustrative risk calculation.
6. Do not interpret passing metadata checks as permission to enable execution. Independently verify GBP/pip, broker deal size, order acknowledgements, timeout reconciliation and in-flight crash recovery before a separate controlled DEMO order test.

The v20 calculator accepts hypothetical user-entered GBP-per-pip and minimum/increment inputs. It is NOT a broker sizing engine, does not account for slippage or gap risk, and does not reconcile actual broker positions. v17 automation remains simulation only.
