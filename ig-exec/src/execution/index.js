'use strict';
const { assertDemoConfig } = require('../ig/guard');
const { IgClient } = require('../ig/igClient');
const { PgStore } = require('./store');
const { ExecutionEngine } = require('./engine');
const routes = require('./routes');
const { createNotifier, startDailySummary } = require('../notify');
const { buildReport, tradesCsv } = require('./report');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Same seven majors the app already streams. Nothing else can ever be traded.
const MAJOR_EPICS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD'].map((p) => `CS.D.${p}.CFD.IP`);

// Synchronous config errors throw (caller keeps running paper-only). Broker login is retried in the background.
function bootExecution({ pool, logger = console, env = process.env, paperEvents = () => [] } = {}) {
  assertDemoConfig(env);
  const want = (env.IG_EXEC_EPICS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const bad = want.filter((e) => !MAJOR_EPICS.includes(e));
  if (bad.length) throw new Error('IG_EXEC_EPICS contains non-approved epics: ' + bad.join(','));
  if (!pool) { const { Pool } = require('pg'); pool = new Pool({ connectionString: env.DATABASE_URL, max: 3, connectionTimeoutMillis: 8000, statement_timeout: 10000 }); }
  const ig = new IgClient({ baseUrl: 'https://demo-api.ig.com/gateway/deal', apiKey: env.IG_API_KEY, identifier: env.IG_USERNAME,
    password: env.IG_PASSWORD, accountId: env.IG_DEMO_ACCOUNT_ID });
  const store = new PgStore(pool);
  const notifier = createNotifier({ pool, env, logger });
  const pipValueGbp = Number(env.IG_PIP_VALUE_GBP) || 1;
  const engine = new ExecutionEngine({ ig, store, allowedEpics: want, pipValueGbp, armed: env.IG_EXEC_ENABLED === 'true', logger,
    notify: (type, data) => notifier.send(type, data) });
  const report = async () => buildReport({ positions: await store.listClosed(1000), orders: await store.listAllOrders(2000), paperEvents: paperEvents(), pipValueGbp });
  const csv = async () => tradesCsv(await store.listClosed(5000), await store.listAllOrders(5000));
  const handle = { engine, notifier, router: routes(engine, { report, csv, notifier }), ready: false, error: null };
  (async () => {
    for (let n = 0; ; n++) {
      try { await store.migrate(); await engine.init(); engine.start(); startDailySummary({ store, engine, send: (t, d) => notifier.send(t, d), hourUtc: Number(env.IG_EXEC_SUMMARY_HOUR_UTC) || 21, logger }); handle.ready = true; handle.error = null; logger.log('[ig-exec] ready, killed=' + engine.killed); return; }
      catch (e) {
        handle.error = e.message; logger.error('[ig-exec] init failed: ' + e.message);
        if (/LIVE-ACCOUNT GUARD/.test(e.message)) return;          // never retry a guard failure
        await sleep(Math.min(300000, 5000 * 2 ** n));
      }
    }
  })();
  return handle;
}
module.exports = { bootExecution, MAJOR_EPICS };
