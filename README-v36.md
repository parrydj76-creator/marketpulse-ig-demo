# MarketPulse AI v36 — Durable paper position simulator

Adds `/v36`, `/api/v36/status`, `/api/v36/trades`, and POST `/api/v36/paper/{cycle,start,stop}`. All API endpoints require the existing admin token except the dashboard HTML.

This is a **separate paper ledger**, not a broker execution module. Entries use ask for longs and bid for shorts; exits use bid for longs and ask for shorts. Stops and targets are evaluated against fresh, undelayed, tradeable quotes. P&L uses an **illustrative £1 per pip per paper size**, not independently certified IG GBP sizing. Stops can slip on gap moves; the simulator marks at observed price. No commission, financing, spread slippage beyond the observed quote, or broker fill model.

Engine disarms on every restart, while journal and open paper positions are restored from durable disk. Paper positions are NOT IG broker positions. Risk caps: 3 paper entries per UTC day, £100 daily realized-loss threshold, £25 illustrative entry risk, 12-pip stop, 18-pip target, maximum 3-pip spread. The simulator does not force-close a position when market feed becomes stale. No broker write requests.

Deployment: back up repository and persistent data; upload ZIP contents to repository root, commit and redeploy. Ensure Render persistent disk and broker order environment flags remain disabled. Test with `npm test` and `node --check server.js`. Check `/api/v36/status` before starting paper evaluations.

Limitations: no validated broker execution, IG pip conversion, commission, fills, crash recovery certification, or historical strategy performance. Legacy routes should be audited separately before enabling any broker orders.
