'use strict';
// Exercises every PgStore method against the REAL database, then deletes its own rows. No broker calls.
//   cd ig-exec && node scripts/pg-smoke.js
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { PgStore } = require('../src/execution/store');
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 8000 });
  const s = new PgStore(pool); const id = 'smoke-' + Date.now(); const ref = 'SMOKE' + Date.now();
  const step = (n) => console.log('PASS ', n);
  try {
    await s.migrate(); step('migrate (idempotent)');
    const o = { idemKey: id, dealReference: ref, epic: 'CS.D.EURUSD.CFD.IP', pair: 'EURUSD', direction: 'BUY', size: 1, stopDistance: 12, limitDistance: 18, status: 'PENDING', signal: { id }, quoteLevel: 1.0975, spreadPips: 0.9, context: { score: 80, rsi: 58 } };
    assert.equal((await s.insertOrder(o)).inserted, true); step('insertOrder');
    const dup = await s.insertOrder(o); assert.equal(dup.inserted, false); assert.equal(dup.row.dealReference, ref); step('duplicate insert rejected, existing row returned');
    await s.updateOrder(ref, { status: 'FILLED', dealId: 'SMOKEDEAL', level: 1.0974, slippagePips: 0.4 });
    const got = await s.getOrder(ref); assert.equal(got.status, 'FILLED'); assert.equal(got.level, 1.0974); assert.equal(got.size, 1); assert.equal(got.signal.id, id); assert.equal(got.quoteLevel, 1.0975); assert.equal(got.spreadPips, 0.9); assert.equal(got.slippagePips, 0.4); assert.equal(got.context.score, 80); step('updateOrder / getOrder (numbers + jsonb + new columns)');
    assert.ok((await s.listOrders(['FILLED'])).some((x) => x.dealReference === ref)); step('listOrders');
    await s.upsertPosition({ dealId: 'SMOKEDEAL', dealReference: ref, epic: o.epic, pair: 'EURUSD', direction: 'BUY', size: 1, openLevel: 1.0974, stopLevel: 1.0962, limitLevel: 1.0992, status: 'OPEN', source: 'BOT', openedAt: new Date() }); step('upsertPosition insert');
    await s.upsertPosition({ dealId: 'SMOKEDEAL', stopLevel: 1.0965 }); assert.equal((await s.getPosition('SMOKEDEAL')).stopLevel, 1.0965); step('upsertPosition partial update');
    assert.equal((await s.listPositions('OPEN')).some((x) => x.dealId === 'SMOKEDEAL'), true); step('listPositions OPEN');
    await s.upsertPosition({ dealId: 'SMOKEDEAL', status: 'CLOSED', closedAt: new Date(), closeLevel: 1.0970, closeReason: 'SMOKE', pnlGbp: -1.5, pnlEstimated: true, pnlEstimateGbp: -1.5 });
    assert.equal((await s.getPosition('SMOKEDEAL')).status, 'CLOSED'); step('close via partial update');
    assert.ok((await s.listClosed(50)).some((x) => x.dealId === 'SMOKEDEAL')); step('listClosed');
    assert.ok((await s.listAllOrders(50)).some((x) => x.dealReference === ref)); step('listAllOrders');
    assert.ok((await s.listEstimatedClosed(50)).some((x) => x.dealId === 'SMOKEDEAL')); step('listEstimatedClosed');
    await s.upsertPosition({ dealId: 'SMOKEDEAL', pnlGbp: -2.25, pnlEstimated: false });
    const ex = await s.getPosition('SMOKEDEAL'); assert.equal(ex.pnlGbp, -2.25); assert.equal(ex.pnlEstimateGbp, -1.5); assert.equal(ex.pnlEstimated, false); step('exact P&L update keeps the original estimate');
    assert.ok(!(await s.listEstimatedClosed(50)).some((x) => x.dealId === 'SMOKEDEAL')); step('confirmed trades leave the estimated list');
    assert.ok((await s.realisedPnlSince(new Date(Date.now() - 60000))) <= -2.25); step('realisedPnlSince (uses exact figure)');
    assert.ok((await s.countOrdersSince(new Date(Date.now() - 60000))) >= 1); step('countOrdersSince');
    assert.ok(await s.lastOrderAt(o.epic)); step('lastOrderAt');
    await s.setState('smoke', { a: 1 }); assert.deepEqual(await s.getState('smoke'), { a: 1 }); step('setState / getState (jsonb)');
    await s.audit('SMOKE', { id }); step('audit');
    const { buildReport } = require('../src/execution/report'); const rr = buildReport({ positions: await s.listClosed(50), orders: await s.listAllOrders(50) }); assert.ok(rr.overall.n >= 1); step('report builds from real rows');
    const r = await s.recent(); assert.ok(r.orders.length && r.closed.length); step('recent (history endpoint)');
    console.log('\nPG SMOKE TEST PASSED');
  } catch (e) { console.error('\nFAIL:', e.message); process.exitCode = 1; }
  finally {
    await pool.query("DELETE FROM ig_orders WHERE idem_key LIKE 'smoke-%'").catch(() => {});
    await pool.query("DELETE FROM ig_positions WHERE deal_id='SMOKEDEAL'").catch(() => {});
    await pool.query("DELETE FROM bot_state WHERE key='smoke'").catch(() => {});
    await pool.query("DELETE FROM audit_log WHERE event='SMOKE'").catch(() => {});
    await pool.end();
  }
})();
