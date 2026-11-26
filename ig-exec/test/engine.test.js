'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockIg } = require('./mockIg');
const { IgClient } = require('../src/ig/igClient');
const { MemStore } = require('../src/execution/store');
const { ExecutionEngine } = require('../src/execution/engine');
const { assertDemoConfig } = require('../src/ig/guard');

const EPICS = { 'GBP/USD': 'CS.D.GBPUSD.MINI.IP', 'EUR/USD': 'CS.D.EURUSD.MINI.IP' };
const sig = (id, pair = 'GBP/USD', extra = {}) => ({ id, pair, direction: 'BUY', stopPips: 20, targetPips: 40, size: 1, ...extra });

async function setup(store = new MemStore(), mock) {
  mock = mock || (await createMockIg().start());
  const ig = new IgClient({ baseUrl: mock.url, apiKey: 'k', identifier: 'u', password: 'p', accountId: 'DEMO1', minGapMs: 0, timeoutMs: 2000 });
  const engine = new ExecutionEngine({ ig, store, epicMap: EPICS, armed: true, confirmDelayMs: 5, logger: { error() {} } });
  await engine.init(); await engine.resume();
  return { mock, ig, store, engine };
}

test('live-account guard: non-demo host and wrong account are refused', async () => {
  assert.throws(() => new IgClient({ baseUrl: 'https://api.ig.com/gateway/deal' }), /LIVE-ACCOUNT GUARD/);
  assert.throws(() => assertDemoConfig({ IG_ENV: 'LIVE', IG_DEMO_ACCOUNT_ID: 'x' }), /LIVE-ACCOUNT GUARD/);
  const mock = await createMockIg({ accountId: 'LIVE9' }).start();
  const ig = new IgClient({ baseUrl: mock.url, apiKey: 'k', identifier: 'u', password: 'p', accountId: 'DEMO1' });
  await assert.rejects(ig.login(), /LIVE-ACCOUNT GUARD/);
  await mock.stop();
});

test('places order with broker-side stop+limit, confirms, persists', async () => {
  const { mock, engine, store } = await setup();
  const r = await engine.executeSignal(sig('s1'));
  assert.equal(r.ok, true);
  assert.ok(r.position.stopLevel && r.position.limitLevel);
  assert.equal((await store.listPositions('OPEN')).length, 1);
  assert.equal(mock.createCalls, 1);
  await mock.stop();
});

test('duplicate prevention: same signal twice and same epic twice', async () => {
  const { mock, engine, store } = await setup();
  await store.setState('risk', { maxOpenPositions: 5, maxTotalSize: 5, cooldownMinutes: 0 });
  await engine.executeSignal(sig('s1'));
  assert.equal((await engine.executeSignal(sig('s1'))).reason, 'DUPLICATE_SIGNAL');
  assert.equal((await engine.executeSignal(sig('s2'))).reason, 'MAX_PER_EPIC');
  const [a, b] = await Promise.all([engine.executeSignal(sig('s3', 'EUR/USD')), engine.executeSignal(sig('s3', 'EUR/USD'))]);
  assert.equal([a, b].filter((x) => x.ok).length, 1);
  assert.equal(mock.createCalls, 2);
  await mock.stop();
});

test('dropped response after IG accepted: no resubmission, resolved via confirm', async () => {
  const { mock, engine, store } = await setup();
  mock.dropNextCreateResponse = true;
  const r = await engine.executeSignal(sig('s1'));
  assert.equal(r.ok, true);
  assert.equal(mock.createCalls, 1);
  assert.equal((await store.listPositions('OPEN')).length, 1);
  await mock.stop();
});

test('restart recovery: new engine, same DB — no duplicate, position still managed', async () => {
  const { mock, store } = await setup();
  const e1 = (await setup(store, mock)).engine; await e1.executeSignal(sig('s1'));
  const e2 = (await setup(store, mock)).engine;
  assert.equal((await e2.executeSignal(sig('s1'))).reason, 'DUPLICATE_SIGNAL');
  assert.equal((await store.listPositions('OPEN')).length, 1);
  const open = (await store.listPositions('OPEN'))[0];
  assert.equal((await e2.closePosition(open.dealId, 'TEST')).ok, true);
  assert.equal(mock.positions.size, 0);
  await mock.stop();
});

test('crash between persist and send: SUBMITTING order is resolved on restart', async () => {
  const { mock, store, engine } = await setup();
  await engine.executeSignal(sig('s1'));                      // order reached IG
  const o = (await store.listOrders(['FILLED']))[0];
  await store.updateOrder(o.dealReference, { status: 'SUBMITTING' });   // pretend we crashed before recording the result
  await store.upsertPosition({ dealId: o.dealId, status: 'CLOSED' });
  const e2 = (await setup(store, mock)).engine;
  assert.equal((await store.getOrder(o.dealReference)).status, 'FILLED');
  assert.equal(mock.createCalls, 1);
  await mock.stop();
});

test('broker-side stop/limit exit is reconciled', async () => {
  const { mock, engine, store } = await setup();
  const r = await engine.executeSignal(sig('s1'));
  mock.brokerClose(r.dealId);
  await engine.reconcile();
  const p = await store.getPosition(r.dealId);
  assert.equal(p.status, 'CLOSED'); assert.equal(p.closeReason, 'BROKER_EXIT');
  await mock.stop();
});

test('positions opened outside the bot are adopted', async () => {
  const { mock, engine, store } = await setup();
  mock.positions.set('DIMANUAL', { position: { dealId: 'DIMANUAL', direction: 'SELL', size: 1, level: 1.25, stopLevel: 1.26 }, market: { epic: EPICS['EUR/USD'] } });
  await engine.reconcile();
  assert.equal((await store.getPosition('DIMANUAL')).source, 'ADOPTED');
  await mock.stop();
});

test('risk limits reject', async () => {
  const { mock, engine, store } = await setup();
  await store.setState('risk', { maxOpenPositions: 1, cooldownMinutes: 0 });
  await engine.executeSignal(sig('s1'));
  assert.equal((await engine.executeSignal(sig('s2', 'EUR/USD'))).reason, 'MAX_OPEN_POSITIONS');
  assert.equal((await engine.executeSignal(sig('s3', 'EUR/USD', { stopPips: 0 }))).reason, 'STOP_REQUIRED');
  await mock.stop();
});

test('kill switch: closes all, blocks orders, persists across restart', async () => {
  const { mock, engine, store } = await setup();
  await engine.executeSignal(sig('s1'));
  const k = await engine.kill({ closeAll: true, reason: 'test' });
  assert.equal(k.closed.length, 1); assert.equal(mock.positions.size, 0);
  assert.equal((await engine.executeSignal(sig('s2', 'EUR/USD'))).reason, 'KILL_SWITCH');
  const e2 = new ExecutionEngine({ ig: engine.ig, store, epicMap: EPICS, armed: true, logger: { error() {} } });
  await e2.init();
  assert.equal(e2.killed, true);
  assert.equal((await e2.executeSignal(sig('s9', 'EUR/USD'))).reason, 'KILL_SWITCH');
  await mock.stop();
});

test('disarmed by default: EXECUTION_ENABLED must be true', async () => {
  const { mock, ig, store } = await setup();
  const e = new ExecutionEngine({ ig, store, epicMap: EPICS, armed: false, logger: { error() {} } });
  assert.equal((await e.executeSignal(sig('x'))).reason, 'EXECUTION_DISABLED');
  await mock.stop();
});

const { toSignal } = require('../src/adapter');
const CFD = 'CS.D.EURUSD.CFD.IP';

test('only allow-listed epics can trade; epic-based signals work', async () => {
  const mock = await createMockIg().start();
  const ig = new IgClient({ baseUrl: mock.url, apiKey: 'k', identifier: 'u', password: 'p', accountId: 'DEMO1', minGapMs: 0 });
  const engine = new ExecutionEngine({ ig, store: new MemStore(), allowedEpics: [CFD], armed: true, confirmDelayMs: 5, logger: { error() {} } });
  await engine.init(); await engine.resume();
  assert.equal((await engine.executeSignal({ id: 'a', epic: 'CS.D.USDJPY.CFD.IP', direction: 'BUY', stopPips: 12, targetPips: 18, size: 0.5 })).reason, 'EPIC_NOT_ALLOWED');
  assert.equal((await engine.executeSignal({ id: 'b', epic: 'CS.D.EURUSD.TODAY.IP', direction: 'BUY', stopPips: 12, targetPips: 18, size: 0.5 })).reason, 'EPIC_NOT_ALLOWED');
  const ok = await engine.executeSignal({ id: 'c', epic: CFD, direction: 'SELL', stopPips: 12, targetPips: 18, size: 0.5 });
  assert.equal(ok.ok, true); assert.equal(ok.position.pair, 'EURUSD');
  assert.equal(mock.createCalls, 1);
  await mock.stop();
});

test('first run with no stored state is KILLED until explicitly resumed', async () => {
  const mock = await createMockIg().start();
  const ig = new IgClient({ baseUrl: mock.url, apiKey: 'k', identifier: 'u', password: 'p', accountId: 'DEMO1', minGapMs: 0 });
  const engine = new ExecutionEngine({ ig, store: new MemStore(), allowedEpics: [CFD], armed: true, logger: { error() {} } });
  await engine.init();
  assert.equal(engine.killed, true);
  assert.equal((await engine.executeSignal({ id: 'a', epic: CFD, direction: 'BUY', stopPips: 12, size: 0.5 })).reason, 'KILL_SWITCH');
  await mock.stop();
});

test('max-hold time exit closes the position at the broker', async () => {
  const { mock, engine, store } = await setup();
  await store.setState('risk', { maxHoldMinutes: 0.001, cooldownMinutes: 0 });
  await engine.executeSignal(sig('s1'));
  await new Promise((r) => setTimeout(r, 150));
  await engine.reconcile();
  assert.equal(mock.positions.size, 0);
  assert.equal((await store.listPositions('CLOSED'))[0].closeReason, 'MAX_HOLD');
  await mock.stop();
});

test('daily order cap', async () => {
  const { mock, engine, store } = await setup();
  await store.setState('risk', { maxOrdersPerDay: 1, cooldownMinutes: 0, maxOpenPositions: 5, maxTotalSize: 5 });
  await engine.executeSignal(sig('s1'));
  assert.equal((await engine.executeSignal(sig('s2', 'EUR/USD'))).reason, 'DAILY_ORDER_CAP');
  await mock.stop();
});

test('adapter maps v2000 plan to a stable signal; refuses without explicit size', () => {
  const plan = { epic: CFD, bar: '2026-11-26T10:00:00.000Z', direction: 'LONG', size: 0.37 };
  assert.equal(toSignal(plan, {}), null);                                   // IG_EXEC_SIZE unset → no trade
  const s = toSignal(plan, { IG_EXEC_SIZE: '0.5' });
  assert.deepEqual([s.id, s.direction, s.size, s.stopPips, s.targetPips], [`${CFD}:${plan.bar}`, 'BUY', 0.5, 12, 18]);
  assert.equal(toSignal({ ...plan, direction: 'SHORT' }, { IG_EXEC_SIZE: '1' }).direction, 'SELL');
  assert.equal(toSignal({ ...plan, direction: 'WAIT' }, { IG_EXEC_SIZE: '1' }), null);
});
