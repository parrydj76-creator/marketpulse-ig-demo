'use strict';
// REAL IG DEMO acceptance run. Prints PASS/FAIL evidence you can keep.
//   cd ig-exec && IG_API_KEY=.. IG_USERNAME=.. IG_PASSWORD=.. IG_DEMO_ACCOUNT_ID=.. \
//   IG_EXEC_EPICS=CS.D.EURUSD.CFD.IP IG_EXEC_SIZE=0.5 node scripts/demo-acceptance.js
// Memory store only: touches no database. Places 2 tiny DEMO trades and closes both.
const { assertDemoConfig } = require('../src/ig/guard');
const { IgClient } = require('../src/ig/igClient');
const { MemStore } = require('../src/execution/store');
const { ExecutionEngine } = require('../src/execution/engine');

const EPIC = (process.env.IG_EXEC_EPICS || 'CS.D.EURUSD.CFD.IP').split(',')[0];
const SIZE = Number(process.env.IG_EXEC_SIZE || 0.5), STOP = Number(process.env.IG_EXEC_STOP_PIPS || 12), LIMIT = Number(process.env.IG_EXEC_LIMIT_PIPS || 18);
const PIP = /JPY/.test(EPIC) ? 0.01 : 0.0001;
const results = []; const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`); };

(async () => {
  assertDemoConfig(process.env);
  const ig = new IgClient({ baseUrl: (process.env.NODE_ENV === 'test' && process.env.IG_TEST_BASE_URL) || 'https://demo-api.ig.com/gateway/deal', apiKey: process.env.IG_API_KEY, identifier: process.env.IG_USERNAME, password: process.env.IG_PASSWORD, accountId: process.env.IG_DEMO_ACCOUNT_ID });
  const store = new MemStore();
  const mk = () => new ExecutionEngine({ ig, store, allowedEpics: [EPIC], armed: true, pipValueGbp: Number(process.env.IG_PIP_VALUE_GBP) || 1 });
  let engine = mk();
  await engine.init(); await engine.resume();
  check('Logged in to DEMO, account matches whitelist', ig.accountId === process.env.IG_DEMO_ACCOUNT_ID, { account: ig.accountId, lightstreamer: ig.lsEndpoint });

  const m = await ig.market(EPIC);
  console.log('\nINSTRUMENT FACTS (use these to calibrate IG_EXEC_SIZE and IG_PIP_VALUE_GBP):');
  console.log(JSON.stringify({ epic: EPIC, marketStatus: m.snapshot?.marketStatus, bid: m.snapshot?.bid, offer: m.snapshot?.offer, scalingFactor: m.snapshot?.scalingFactor,
    contractSize: m.instrument?.contractSize, lotSize: m.instrument?.lotSize, onePipMeans: m.instrument?.onePipMeans, valueOfOnePip: m.instrument?.valueOfOnePip,
    currencies: m.instrument?.currencies, minDealSize: m.dealingRules?.minDealSize, minNormalStopOrLimitDistance: m.dealingRules?.minNormalStopOrLimitDistance,
    minStepDistance: m.dealingRules?.minStepDistance }, null, 2));
  check('Market is tradeable', m.snapshot?.marketStatus === 'TRADEABLE', m.snapshot?.marketStatus);
  check('Size >= broker minDealSize', SIZE >= Number(m.dealingRules?.minDealSize?.value || 0), { SIZE, min: m.dealingRules?.minDealSize?.value });
  await store.setState('risk', { cooldownMinutes: 0, maxOrdersPerDay: 10, maxOrdersPerHour: 10, maxSizePerTrade: SIZE, minSize: 0.01, maxTotalSize: SIZE * 2, maxOpenPositions: 2 });

  // ---- Lifecycle 1: open -> verify -> duplicate -> restart -> normal close
  const sig = { id: 'acc-1-' + Date.now(), epic: EPIC, direction: 'BUY', stopPips: STOP, targetPips: LIMIT, size: SIZE };
  const open = await engine.executeSignal(sig);
  check('1. Order opened and CONFIRMED by IG', open.ok === true, open.ok ? { dealId: open.dealId, level: open.position.openLevel } : open);
  if (!open.ok) throw new Error('cannot continue: ' + JSON.stringify(open));
  const p = open.position;
  check('2. Broker-side stop AND limit attached', p.stopLevel != null && p.limitLevel != null, { stop: p.stopLevel, limit: p.limitLevel });
  const stopPips = Math.abs(p.openLevel - p.stopLevel) / PIP, limPips = Math.abs(p.limitLevel - p.openLevel) / PIP;
  check('3. UNITS: IG stop/limit distance == requested pips', Math.abs(stopPips - STOP) < 0.51 && Math.abs(limPips - LIMIT) < 0.51, { requested: [STOP, LIMIT], actualPips: [+stopPips.toFixed(2), +limPips.toFixed(2)] });
  check('4. Same signal replayed is rejected as duplicate', (await engine.executeSignal(sig)).reason === 'DUPLICATE_SIGNAL');
  const live = await ig.positions();
  check('5. Broker position visible and matches DB', live.some((x) => x.position.dealId === p.dealId) && (await store.listPositions('OPEN')).length === 1);
  engine.stop(); engine = mk(); await engine.init();            // simulated process restart: same store, fresh engine
  check('6. Restart recovery: position still tracked, no duplicate', (await store.listPositions('OPEN')).length === 1 && (await ig.positions()).length === live.length);
  check('7. Replay after restart still rejected', (await engine.executeSignal(sig)).reason === 'DUPLICATE_SIGNAL');
  const c1 = await engine.closePosition(p.dealId, 'ACCEPTANCE');
  check('8. Position closed via API and confirmed', c1.ok === true && !(await ig.positions()).some((x) => x.position.dealId === p.dealId), c1);

  // ---- Lifecycle 2: open -> kill switch closes it
  await engine.resume();
  const o2 = await engine.executeSignal({ ...sig, id: 'acc-2-' + Date.now(), direction: 'SELL' });
  check('9. Second order (SELL) opened and confirmed', o2.ok === true, o2.ok ? { dealId: o2.dealId } : o2);
  const k = await engine.kill({ closeAll: true, reason: 'acceptance' });
  check('10. KILL SWITCH closed the open position at broker', k.errors.length === 0 && (await ig.positions()).every((x) => x.position.dealId !== o2.dealId), k);
  check('11. Orders blocked while killed', (await engine.executeSignal({ ...sig, id: 'acc-3-' + Date.now() })).reason === 'KILL_SWITCH');
  engine.stop();

  console.log('\nCLOSED TRADE RECORDS:', JSON.stringify(await store.listPositions('CLOSED'), null, 2));
  console.log('AUDIT:', JSON.stringify(store.auditLog.map((a) => [a.event, a.data])));
  const failed = results.filter((x) => !x).length;
  console.log(`\n${failed === 0 ? 'ACCEPTANCE PASSED' : 'ACCEPTANCE FAILED'} (${results.length - failed}/${results.length})`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ABORTED:', e.message); process.exit(1); });
