'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockIg } = require('./mockIg');
const { IgClient } = require('../src/ig/igClient');
const { MemStore } = require('../src/execution/store');
const { ExecutionEngine } = require('../src/execution/engine');
const { buildReport, tradesCsv, wilson } = require('../src/execution/report');
const { matchTx, parseMoney, toMs } = require('../src/execution/pnlsync');
const { createNotifier, maybeSendSummary, FORMATS } = require('../src/notify');
const { toSignal } = require('../src/adapter');

const CFD = 'CS.D.EURUSD.CFD.IP';
const sig = (id, extra = {}) => ({ id, epic: CFD, direction: 'BUY', stopPips: 12, targetPips: 18, size: 1, context: { score: 82, rsi: 58.1, ema9: 1.1, ema21: 1.09, signalAt: Date.now() - 4000 }, ...extra });

async function setup(opts = {}) {
  const mock = await createMockIg().start(), store = new MemStore(), events = [];
  const ig = new IgClient({ baseUrl: mock.url, apiKey: 'k', identifier: 'u', password: 'p', accountId: 'DEMO1', minGapMs: 0 });
  const engine = new ExecutionEngine({ ig, store, allowedEpics: [CFD], armed: true, confirmDelayMs: 5, logger: { error() {}, log() {} }, pnlSyncMinAgeMs: 0,
    notify: (t, d) => events.push([t, d]), ...opts });
  await engine.init(); await engine.resume();
  await store.setState('risk', { cooldownMinutes: 0, maxOrdersPerDay: 20, maxOrdersPerHour: 20, maxOpenPositions: 3, maxTotalSize: 5, maxSizePerTrade: 1 });
  return { mock, store, engine, events };
}
const types = (events) => events.map((e) => e[0]);

test('alerts fire for started, filled, closed, kill, resumed', async () => {
  const { mock, engine, events } = await setup();
  const r = await engine.executeSignal(sig('a1'));
  assert.equal(r.ok, true);
  await engine.kill({ closeAll: true, reason: 'test' });
  await engine.resume();
  assert.deepEqual(types(events), ['STARTED', 'RESUMED', 'FILLED', 'CLOSED', 'KILL', 'RESUMED']);
  assert.equal(events.find((e) => e[0] === 'CLOSED')[1].reason, 'KILL_SWITCH');
  await mock.stop();
});

test('alert for unexpected position, skipped signal, and IG-side problems; a throwing notifier never breaks trading', async () => {
  const { mock, engine, events } = await setup();
  mock.positions.set('DIFOREIGN', { position: { dealId: 'DIFOREIGN', direction: 'SELL', size: 1, level: 1.25, stopLevel: 1.26 }, market: { epic: 'CS.D.USDJPY.CFD.IP' } });
  await engine.reconcile();
  assert.ok(types(events).includes('ADOPTED'));
  await engine.store.setState('risk', { maxOpenPositions: 1 });
  const r = await engine.executeSignal(sig('b1'));
  assert.equal(r.ok, false);
  assert.ok(events.some((e) => e[0] === 'SIGNAL_SKIPPED' && e[1].reason === 'MAX_OPEN_POSITIONS'));
  engine.notify = () => { throw new Error('push provider down'); };
  await engine.store.setState('risk', { cooldownMinutes: 0, maxOpenPositions: 5, maxTotalSize: 5 });
  assert.equal((await engine.executeSignal(sig('b2'))).ok, true);          // still trades
  await mock.stop();
});

test('degraded / recovered alerts fire once per transition', async () => {
  const { mock, engine, events } = await setup({ pollMs: 15 });
  const real = engine.reconcile.bind(engine); let fail = true;
  engine.reconcile = async () => { if (fail) throw new Error('IG down'); return real(); };
  engine.start();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(engine.degraded, true);
  fail = false; await new Promise((r) => setTimeout(r, 100)); engine.stop();
  assert.equal(types(events).filter((t) => t === 'DEGRADED').length, 1);
  assert.equal(types(events).filter((t) => t === 'RECOVERED').length, 1);
  await mock.stop();
});

test('spread, slippage and signal context are captured on the order', async () => {
  const { mock, store, engine } = await setup();
  mock.slip = 0.5;                                              // fill 0.5 pip worse than the quote
  const r = await engine.executeSignal(sig('c1'));
  const o = (await store.listAllOrders())[0];
  assert.equal(o.spreadPips, 2);                                // mock quote 1.25/1.2502
  assert.equal(o.quoteLevel, 1.2502);
  assert.equal(o.slippagePips, 0.5);
  assert.equal(o.context.score, 82);
  assert.ok(r.position.openLevel > 1.2502);
  await mock.stop();
});

test('exact P&L from IG replaces the estimate (API close) and classifies broker stop exits', async () => {
  const { mock, store, engine } = await setup({ pipValueGbp: 1 });              // deliberately wrong pip value
  const a = await engine.executeSignal(sig('d1'));
  await engine.closePosition(a.dealId, 'TEST');
  const closedA = await store.getPosition(a.dealId);
  assert.equal(closedA.pnlEstimated, true);
  const b = await engine.executeSignal(sig('d2', { direction: 'SELL' }));
  mock.brokerClose(b.dealId);                                                    // stop hit at IG
  await engine.reconcile();
  assert.equal((await store.getPosition(b.dealId)).closeReason, 'BROKER_EXIT');
  const res = await engine.syncPnl();
  assert.equal(res.matched, 2);
  const A = await store.getPosition(a.dealId), B = await store.getPosition(b.dealId);
  assert.equal(A.pnlEstimated, false); assert.equal(B.pnlEstimated, false);
  assert.equal(B.closeReason, 'BROKER_STOP');
  assert.ok(Math.abs(B.pnlGbp - (-12 * 7.6)) < 0.5, 'stop-out is about -12 pips x 7.6');
  assert.notEqual(A.pnlGbp, A.pnlEstimateGbp);                                   // estimate preserved for calibration
  assert.equal((await engine.syncPnl()).matched, 0);                             // idempotent
  await mock.stop();
});

test('P&L matching helpers: money parsing, naive UTC, no cross-matching', () => {
  assert.equal(parseMoney('£-91.20'), -91.2); assert.equal(parseMoney('-£91.20'), -91.2); assert.equal(parseMoney('£1,234.50'), 1234.5); assert.ok(Number.isNaN(parseMoney('n/a')));
  assert.equal(toMs('2026-11-27T01:11:17'), Date.parse('2026-11-27T01:11:17Z'));
  const pos = { pair: 'EURUSD', size: 1, openLevel: 1.09658, openedAt: '2026-11-27T01:11:18Z' };
  const tx = (o = {}) => ({ instrumentName: 'EUR/USD', size: '1', openLevel: '1.09658', openDateUtc: '2026-11-27T01:11:17', transactionType: 'DEAL', ...o });
  const t1 = tx(), used = new Set();
  assert.equal(matchTx(pos, [t1], used), t1);
  assert.equal(matchTx(pos, [tx({ size: '2' })], used), null);
  assert.equal(matchTx(pos, [tx({ openLevel: '1.0980' })], used), null);
  assert.equal(matchTx(pos, [tx({ openDateUtc: '2026-11-27T05:00:00' })], used), null);
  used.add(t1); assert.equal(matchTx(pos, [t1], used), null);
});

test('report maths: win rate, break-even, Wilson interval, hour buckets, paper join', () => {
  assert.ok(wilson(5, 10)[0] < 0.5 && wilson(5, 10)[1] > 0.5);
  const mk = (i, pnl, over = {}) => ({ dealId: 'D' + i, dealReference: 'R' + i, epic: CFD, pair: 'EURUSD', direction: 'BUY', size: 1, status: 'CLOSED', openLevel: 1.1, closeLevel: 1.1 + (pnl / 7.6) * 1e-4,
    openedAt: new Date(Date.UTC(2026, 10, 27, 1 + (i % 2), 0)), closedAt: new Date(Date.UTC(2026, 10, 27, 2 + (i % 2), 0)), closeReason: pnl > 0 ? 'BROKER_LIMIT' : 'BROKER_STOP', pnlGbp: pnl, pnlEstimated: false, pnlEstimateGbp: pnl - 1, ...over });
  const positions = [mk(0, 135), mk(1, -91), mk(2, -91), mk(3, 135), mk(4, -91)];
  const orders = positions.map((p, i) => ({ dealReference: p.dealReference, idemKey: `${CFD}:bar${i}`, status: 'FILLED', size: 1, spreadPips: 0.8, slippagePips: 0.1, createdAt: p.openedAt, context: null }));
  const paperEvents = [{ epic: CFD, bar: 'bar0', pips: 17, closedAt: Date.UTC(2026, 10, 27, 3), reason: 'TARGET' }, { epic: CFD, bar: 'zzz', pips: -12, closedAt: Date.UTC(2026, 10, 27, 3), reason: 'STOP' }];
  const R = buildReport({ positions, orders, paperEvents, pipValueGbp: 7.6, now: Date.UTC(2026, 10, 28) });
  assert.equal(R.overall.n, 5); assert.equal(R.overall.wins, 2);
  assert.equal(R.overall.winRate, 0.4);
  assert.equal(R.overall.avgWinGbp, 135); assert.equal(R.overall.avgLossGbp, 91);
  assert.ok(Math.abs(R.overall.breakEvenWinRate - 91 / 226) < 1e-9);
  assert.equal(R.overall.totalPnlGbp, -3); assert.equal(R.overall.profitFactor, 0.99);
  assert.match(R.verdict, /Only 5 closed trade/);
  assert.equal(R.pnlQuality.exactFromIG, 5);
  assert.equal(R.byExit.BROKER_STOP.n, 3); assert.equal(R.byExit.BROKER_LIMIT.n, 2);
  assert.deepEqual(Object.keys(R.byHourUtc).sort(), ['1', '2']);
  assert.equal(R.paperVsBroker.matchedTrades, 1); assert.equal(R.paperVsBroker.paperTradesNotExecuted, 1);
  assert.equal(R.costs.avgSpreadPips, 0.8); assert.equal(R.calibration.avgEstimateErrorGbp, 1);
  assert.ok(Math.abs(R.calibration.impliedPipValueGbp - 7.6) < 0.01);
  const csv = tradesCsv(positions, orders).trim().split('\n');
  assert.equal(csv.length, 6); assert.match(csv[0], /^dealId,epic,direction/);
  // 120 trades at a clearly bad win rate -> flagged
  const bad = Array.from({ length: 120 }, (_, i) => mk(i, i < 30 ? 135 : -91));
  assert.match(buildReport({ positions: bad, orders: [], paperEvents: [] }).verdict, /BELOW break-even/);
});

test('notifier: formats, sends to every subscription, drops dead ones, caps non-critical, no-ops when unconfigured', async () => {
  const sent = [], deleted = [];
  const subs = [{ endpoint_hash: 'good', subscription: { endpoint: 'g' } }, { endpoint_hash: 'dead', subscription: { endpoint: 'd' } }];
  const pool = { query: async (sql, args) => { if (/DELETE/.test(sql)) { deleted.push(args[0]); return {}; } if (/SELECT endpoint_hash/.test(sql)) return { rows: subs }; return { rows: [{ c: 2 }] }; } };
  const webpush = { setVapidDetails() {}, sendNotification: async (s, payload) => { if (s.endpoint === 'd') throw Object.assign(new Error('gone'), { statusCode: 410 }); sent.push(JSON.parse(payload)); } };
  const env = { VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'y' };
  const n = createNotifier({ pool, env, webpush, logger: { error() {} }, maxPerHour: 2 });
  const r = await n.send('FILLED', { pos: { direction: 'SELL', pair: 'EURUSD', size: 1, openLevel: 1.09658, stopLevel: 1.09778, limitLevel: 1.09478 }, order: { spreadPips: 0.9 }, slippagePips: 0.1 });
  assert.equal(r.accepted, 1); assert.deepEqual(deleted, ['dead']);
  assert.match(sent[0].title, /SELL EUR\/USD opened/); assert.match(sent[0].body, /1\.09658/); assert.equal(sent[0].tag, 'ig-fill');
  await n.send('SIGNAL_SKIPPED', { sig: { direction: 'BUY', epic: CFD }, reason: 'COOLDOWN' });
  assert.equal((await n.send('SIGNAL_SKIPPED', { sig: { direction: 'BUY', epic: CFD }, reason: 'COOLDOWN' })).reason, 'rate capped');
  assert.equal((await n.send('KILL', { reason: 'x', closed: [], errors: [] })).accepted, 1);       // critical bypasses the cap
  assert.equal((await createNotifier({ pool, env: {}, logger: { error() {} } }).send('TEST')).reason, 'not configured');
  assert.match(FORMATS.CLOSED({ pos: { pair: 'EURUSD', direction: 'SELL', openLevel: 1.1 }, level: 1.101, reason: 'BROKER_STOP', pnl: -91.2 }).body, /-£91\.20/);
});

test('daily summary: once per weekday after the hour, never at weekends or before', async () => {
  const store = new MemStore(), engine = { killed: false, degraded: false }, sent = [];
  const send = async (t, d) => sent.push([t, d.text]);
  await store.upsertPosition({ dealId: 'D1', epic: CFD, direction: 'BUY', size: 1, status: 'CLOSED', closedAt: new Date(Date.UTC(2026, 10, 27, 5)), pnlGbp: -91.2, pnlEstimated: false });
  const fri = (h) => Date.UTC(2026, 10, 27, h, 5);                                  // Friday 27 Nov 2026
  assert.equal(await maybeSendSummary({ store, engine, send, now: fri(20) }), false);
  assert.equal(await maybeSendSummary({ store, engine, send, now: fri(21) }), true);
  assert.equal(await maybeSendSummary({ store, engine, send, now: fri(22) }), false);
  assert.equal(await maybeSendSummary({ store, engine, send, now: Date.UTC(2026, 10, 28, 22) }), false);   // Saturday
  assert.match(sent[0][1], /Today: 1 trade\(s\), 0 win\(s\), -£91\.20 · open: 0 · RUNNING/);
});

test('adapter passes indicator context through, with non-finite values nulled', () => {
  const s = toSignal({ epic: CFD, bar: 'b', direction: 'LONG', score: 80, rsi: 58, ema9: 1.1, ema21: NaN, entry: 1.1, spreadPips: 0.9, risk: 24, at: 123 }, { IG_EXEC_SIZE: '1' });
  assert.deepEqual([s.context.score, s.context.rsi, s.context.ema21, s.context.paperSpreadPips, s.context.signalAt], [80, 58, null, 0.9, 123]);
});

test('real IG transaction format (captured from the live DEMO account): signed size, "converted at" name', () => {
  const rows = [
    { dateUtc: '2026-11-27T09:37:03', openDateUtc: '2026-11-27T09:37:02', instrumentName: 'EUR/USD converted at 0.767980690771392', profitAndLoss: '£-7.68', transactionType: 'DEAL', openLevel: '1.09616', closeLevel: '1.09626', size: '-1', currency: '£' },
    { dateUtc: '2026-11-27T09:37:00', openDateUtc: '2026-11-27T09:36:57', instrumentName: 'EUR/USD converted at 0.767980690771392', profitAndLoss: '£-5.38', transactionType: 'DEAL', openLevel: '1.09626', closeLevel: '1.09619', size: '+1', currency: '£' },
  ];
  const buy = { pair: 'EURUSD', direction: 'BUY', size: 1, openLevel: 1.09626, openedAt: '2026-11-27T09:36:58.522Z' };
  const sell = { pair: 'EURUSD', direction: 'SELL', size: 1, openLevel: 1.09616, openedAt: '2026-11-27T09:37:03.046Z' };
  const used = new Set();
  assert.equal(matchTx(buy, rows, used), rows[1]); used.add(rows[1]);
  assert.equal(matchTx(sell, rows, used), rows[0]);
  assert.equal(parseMoney(rows[1].profitAndLoss), -5.38);
  assert.equal(matchTx({ ...buy, direction: 'SELL' }, [rows[1]], new Set()), null);       // sign contradicts direction -> never matched
  assert.equal(matchTx({ ...sell, openLevel: 1.09626 }, [rows[0]], new Set()), null);     // wrong open level
});
