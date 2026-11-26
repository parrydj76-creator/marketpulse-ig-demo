'use strict';
const crypto = require('crypto');
const { DEFAULT_RISK, check } = require('./risk');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pipSizeOf = (pair) => (/JPY/i.test(pair || '') ? 0.01 : 0.0001);
const pairOf = (epic) => String(epic).split('.')[2] || epic;
const opposite = (d) => (d === 'BUY' ? 'SELL' : 'BUY');
const dealRef = (id) => 'MP' + crypto.createHash('sha1').update(String(id)).digest('hex').slice(0, 24); // deterministic, <=30 chars

class ExecutionEngine {
  constructor({ ig, store, epicMap = {}, allowedEpics, pipValueGbp = 1, armed = false, pollMs = 15000, confirmRetries = 8, confirmDelayMs = 500, unresolvedGraceMs = 120000, logger = console }) {
    Object.assign(this, { ig, store, epicMap, pipValueGbp, armed, pollMs, confirmRetries, confirmDelayMs, unresolvedGraceMs, log: logger });
    this.allowedEpics = new Set(allowedEpics || Object.values(epicMap));
    this.killed = true;        // fail-safe until state is loaded
    this.degraded = false; this.failures = 0; this._chain = Promise.resolve(); this._timer = null;
  }

  // ---------- lifecycle ----------
  async init() {
    try { const k = await this.store.getState('kill'); this.killed = !k || !!k.on; } catch { this.killed = true; }  // never-resumed = killed
    await this.ig.login();
    await this.reconcile();             // restart recovery
  }
  start() {
    this._timer = setInterval(async () => {
      try { await this.reconcile(); this.failures = 0; this.degraded = false; }
      catch (e) { this.log.error('[exec] reconcile failed', e.message); if (++this.failures >= 5) this.degraded = true; }
    }, this.pollMs);
    this._timer.unref?.();
  }
  stop() { clearInterval(this._timer); }
  _lock(fn) { const run = this._chain.then(fn, fn); this._chain = run.catch(() => {}); return run; }
  async _cfg() { return { ...DEFAULT_RISK, ...((await this.store.getState('risk')) || {}) }; }
  async status() {
    return { armed: this.armed, killed: this.killed, allowedEpics: [...this.allowedEpics], degraded: this.degraded, account: this.ig.accountId,
      risk: await this._cfg(), openPositions: await this.store.listPositions('OPEN') };
  }

  // IG dealing rules (min size, min stop/limit distance, market status), cached 10 min. Unknown rules = no trade.
  async _rules(epic) {
    this._rc = this._rc || new Map();
    const c = this._rc.get(epic);
    if (c && Date.now() - c.at < 600000) return c.rules;
    const m = await this.ig.market(epic);
    // IG only accepts a currency from the market's own list. Prefer GBP if offered, else the default, else the first.
    const cur = m.instrument?.currencies || [];
    const currency = cur.find((x) => x.code === 'GBP')?.code || cur.find((x) => x.isDefault)?.code || cur[0]?.code || 'GBP';
    const rules = { currency, status: m.snapshot?.marketStatus, minSize: Number(m.dealingRules?.minDealSize?.value || 0),
      minDist: Number(m.dealingRules?.minNormalStopOrLimitDistance?.value || 0) };
    this._rc.set(epic, { at: Date.now(), rules });
    return rules;
  }

  // ---------- opening ----------
  async executeSignal(sig) {
    if (!this.armed) return this._reject(sig, 'EXECUTION_DISABLED');
    if (this.killed) return this._reject(sig, 'KILL_SWITCH');
    if (this.degraded) return this._reject(sig, 'DEGRADED_RECONCILE_FAILING');
    const epic = sig.epic || this.epicMap[sig.pair];
    if (!epic || !this.allowedEpics.has(epic)) return this._reject(sig, 'EPIC_NOT_ALLOWED');
    return this._lock(() => this._execute(sig, epic));
  }

  async _execute(sig, epic) {
    if (this.killed) return this._reject(sig, 'KILL_SWITCH');
    const ref = dealRef(sig.id);
    const prior = await this.store.getOrder(ref);   // replayed signal: report as duplicate before anything else
    if (prior) return { ok: false, reason: 'DUPLICATE_SIGNAL', order: prior };
    const cfg = await this._cfg();
    const open = await this.store.listPositions('OPEN');
    const pending = await this.store.listOrders(['PENDING', 'SUBMITTING', 'UNKNOWN']);
    const now = Date.now(), dayStart = new Date(new Date().setUTCHours(0, 0, 0, 0));
    const v = check({ sig, cfg, open, pendingCount: pending.length, epic, now,
      dailyPnl: await this.store.realisedPnlSince(dayStart),
      ordersLastHour: await this.store.countOrdersSince(new Date(now - 3600000)),
      ordersToday: await this.store.countOrdersSince(dayStart),
      lastOrderAt: await this.store.lastOrderAt(epic) });
    if (!v.ok) return this._reject(sig, v.reason);
    let rules;
    try { rules = await this._rules(epic); } catch { return this._reject(sig, 'BROKER_RULES_UNAVAILABLE'); }
    if (rules.status && rules.status !== 'TRADEABLE') return this._reject(sig, 'MARKET_NOT_TRADEABLE');
    if (v.size < rules.minSize) return this._reject(sig, `SIZE_BELOW_BROKER_MIN(${rules.minSize})`);
    if (sig.stopPips < rules.minDist || (sig.targetPips && sig.targetPips < rules.minDist)) return this._reject(sig, `DISTANCE_BELOW_BROKER_MIN(${rules.minDist})`);

    // Duplicate prevention #1: idempotency key unique in DB (same signal can never create two orders).
    const ins = await this.store.insertOrder({ idemKey: String(sig.id), dealReference: ref, epic, pair: sig.pair || pairOf(epic), direction: sig.direction,
      size: v.size, stopDistance: sig.stopPips, limitDistance: sig.targetPips || null, status: 'PENDING', signal: sig });
    if (!ins.inserted) return { ok: false, reason: 'DUPLICATE_SIGNAL', order: ins.row };

    // Duplicate prevention #2: broker truth, not just local state.
    const live = await this.ig.positions();
    if (live.some((x) => x.market.epic === epic)) {
      await this.store.updateOrder(ref, { status: 'REJECTED', reason: 'BROKER_POSITION_EXISTS' });
      return { ok: false, reason: 'BROKER_POSITION_EXISTS' };
    }

    await this.store.updateOrder(ref, { status: 'SUBMITTING' }); // persisted BEFORE the network call
    try {
      await this.ig.openPosition({ epic, expiry: '-', direction: sig.direction, size: v.size, orderType: 'MARKET', currencyCode: rules.currency,
        forceOpen: true, guaranteedStop: false, stopDistance: sig.stopPips,
        ...(sig.targetPips ? { limitDistance: sig.targetPips } : {}), dealReference: ref });
    } catch (e) {
      if (!e.ambiguous) { await this.store.updateOrder(ref, { status: 'REJECTED', reason: e.code || e.message }); return { ok: false, reason: e.code || e.message }; }
      await this.store.updateOrder(ref, { status: 'UNKNOWN', reason: e.message });   // NEVER resend; resolve by reference
    }
    return this._resolveOrder(ref, this.confirmRetries);
  }

  async _confirmLoop(ref, retries) {
    for (let i = 0; i < retries; i++) {
      try { return await this.ig.confirm(ref); }
      catch (e) { if (!(e.status === 404 || e.ambiguous || /not-found/.test(e.code || ''))) throw e; if (i < retries - 1) await sleep(this.confirmDelayMs); }
    }
    return null;
  }

  async _resolveOrder(ref, retries) {
    const order = await this.store.getOrder(ref);
    if (['FILLED', 'REJECTED', 'FAILED'].includes(order.status)) return { ok: order.status === 'FILLED', order };
    const c = await this._confirmLoop(ref, retries);
    if (!c) return { ok: false, pending: true, reason: 'UNRESOLVED', order };
    if (c.dealStatus !== 'ACCEPTED') { await this.store.updateOrder(ref, { status: 'REJECTED', reason: c.reason }); await this.store.audit('IG_REJECTED', c); return { ok: false, reason: c.reason, confirm: c }; }
    const pos = { dealId: c.dealId, dealReference: ref, epic: order.epic, pair: order.pair, direction: c.direction, size: c.size,
      openLevel: c.level, stopLevel: c.stopLevel ?? null, limitLevel: c.limitLevel ?? null, status: 'OPEN', source: 'BOT', openedAt: new Date() };
    await this.store.upsertPosition(pos);
    await this.store.updateOrder(ref, { status: 'FILLED', dealId: c.dealId, level: c.level });
    await this.store.audit('FILLED', { ref, dealId: c.dealId });
    const cfg = await this._cfg();
    if (cfg.requireBrokerStop && pos.stopLevel == null) await this._protect(pos, order);
    return { ok: true, dealId: c.dealId, position: await this.store.getPosition(c.dealId) };
  }

  async _protect(pos, order) {   // broker did not report a stop: attach one or flatten immediately
    try {
      const d = (order.stopDistance || 10) * pipSizeOf(pos.pair);
      const stopLevel = +(pos.direction === 'BUY' ? pos.openLevel - d : pos.openLevel + d).toFixed(5);
      await this.ig.editPosition(pos.dealId, { stopLevel, limitLevel: pos.limitLevel, trailingStop: false });
      await this.store.upsertPosition({ dealId: pos.dealId, stopLevel });
    } catch { await this._close(pos.dealId, 'NO_BROKER_STOP'); }
  }

  // ---------- closing ----------
  closePosition(dealId, reason = 'MANUAL') { return this._lock(() => this._close(dealId, reason)); }

  async _close(dealId, reason) {
    const pos = await this.store.getPosition(dealId);
    if (!pos || pos.status !== 'OPEN') return { ok: false, reason: 'NOT_OPEN' };
    let r;
    try { r = await this.ig.closePosition({ dealId, direction: opposite(pos.direction), size: pos.size, orderType: 'MARKET' }); }
    catch (e) {
      const live = await this.ig.positions();       // did it actually close anyway?
      if (live.some((x) => x.position.dealId === dealId)) throw e;
      await this._markClosed(pos, null, 'CLOSED_AT_BROKER_' + reason); return { ok: true, reason: 'ALREADY_CLOSED' };
    }
    const c = await this._confirmLoop(r.dealReference, this.confirmRetries);
    await this._markClosed(pos, c?.level ?? null, reason, !c);
    return { ok: true, level: c?.level ?? null };
  }

  async _markClosed(pos, level, reason, estimated = true) {
    let pnl = null;
    if (level != null) pnl = +(((pos.direction === 'BUY' ? level - pos.openLevel : pos.openLevel - level) / pipSizeOf(pos.pair)) * pos.size * this.pipValueGbp).toFixed(2);
    await this.store.upsertPosition({ dealId: pos.dealId, status: 'CLOSED', closedAt: new Date(), closeLevel: level, closeReason: reason, pnlGbp: pnl, pnlEstimated: true });
    await this.store.audit('CLOSED', { dealId: pos.dealId, reason, level, pnl });
  }

  // ---------- kill switch ----------
  async kill({ closeAll = true, reason = 'manual' } = {}) {
    this.killed = true;                                   // immediate, in-memory
    await this.store.setState('kill', { on: true, reason, ts: new Date().toISOString() }); // survives restart
    const closed = [], errors = [];
    if (closeAll) await this._lock(async () => {
      for (const p of await this.store.listPositions('OPEN')) {
        try { await this._close(p.dealId, 'KILL_SWITCH'); closed.push(p.dealId); } catch (e) { errors.push({ dealId: p.dealId, error: e.message }); }
      }
    });
    return { killed: true, closed, errors };
  }
  async resume() { await this.store.setState('kill', { on: false, ts: new Date().toISOString() }); this.killed = false; return { killed: false }; }

  // ---------- reconciliation / restart recovery ----------
  reconcile() { return this._lock(() => this._reconcile()); }

  async _reconcile() {
    // 1. resolve orders whose outcome we do not know (crash / timeout)
    for (const o of await this.store.listOrders(['SUBMITTING', 'UNKNOWN'])) {
      const r = await this._resolveOrder(o.dealReference, 1);
      if (r.pending && Date.now() - new Date(o.createdAt).getTime() > this.unresolvedGraceMs) {
        await this.store.updateOrder(o.dealReference, { status: 'FAILED', reason: 'NOT_FOUND_AT_BROKER' });
      }
    }
    for (const o of await this.store.listOrders(['PENDING'])) {
      if (Date.now() - new Date(o.createdAt).getTime() > 60000) await this.store.updateOrder(o.dealReference, { status: 'REJECTED', reason: 'ABANDONED' });
    }
    // 2. compare broker truth with local state
    const live = await this.ig.positions();
    const liveMap = new Map(live.map((x) => [x.position.dealId, x]));
    const local = await this.store.listPositions('OPEN');
    const cfg = await this._cfg();
    for (const l of local) {
      const lv = liveMap.get(l.dealId);
      if (!lv) { await this._brokerExit(l); continue; }
      await this.store.upsertPosition({ dealId: l.dealId, stopLevel: lv.position.stopLevel ?? null, limitLevel: lv.position.limitLevel ?? null });
      if (cfg.requireBrokerStop && lv.position.stopLevel == null) await this._close(l.dealId, 'NO_BROKER_STOP');
    }
    if (cfg.maxHoldMinutes > 0) {   // strategy time-exit, enforced by the broker-aware engine
      for (const l of await this.store.listPositions('OPEN')) {
        if (l.openedAt && Date.now() - new Date(l.openedAt).getTime() > cfg.maxHoldMinutes * 60000) {
          try { await this._close(l.dealId, 'MAX_HOLD'); } catch (e) { this.log.error('[exec] max-hold close failed', e.message); }
        }
      }
    }
    const known = new Set(local.map((l) => l.dealId));
    for (const [dealId, x] of liveMap) {
      if (known.has(dealId) || (await this.store.getPosition(dealId))) continue;
      const p = x.position;
      await this.store.upsertPosition({ dealId, dealReference: p.dealReference, epic: x.market.epic, pair: pairOf(x.market.epic),
        direction: p.direction, size: p.size, openLevel: p.level, stopLevel: p.stopLevel ?? null, limitLevel: p.limitLevel ?? null, status: 'OPEN', source: 'ADOPTED', openedAt: new Date(p.createdDateUTC || Date.now()) });
      await this.store.audit('ADOPTED', { dealId });
      if (cfg.requireBrokerStop && p.stopLevel == null) await this._close(dealId, 'NO_BROKER_STOP');
    }
    return { live: live.length, local: (await this.store.listPositions('OPEN')).length };
  }

  async _brokerExit(l) {   // broker closed it (stop / limit / manual on platform)
    let level = null;
    try {
      const m = await this.ig.market(l.epic); const px = l.direction === 'BUY' ? m.snapshot.bid : m.snapshot.offer;
      const cands = [l.stopLevel, l.limitLevel].filter((v) => v != null);
      if (cands.length) level = cands.reduce((a, b) => (Math.abs(a - px) < Math.abs(b - px) ? a : b));
    } catch { /* leave null */ }
    await this._markClosed(l, level, 'BROKER_EXIT');
  }

  // Lightstreamer TRADE:<accountId> (CONFIRMS/OPU) updates → prompt reconciliation instead of waiting for the poll.
  handleTradeUpdate() { clearTimeout(this._deb); this._deb = setTimeout(() => this.reconcile().catch((e) => this.log.error(e.message)), 500); }

  _reject(sig, reason) { this.store.audit('REJECTED', { signal: sig.id, reason }).catch(() => {}); return { ok: false, reason }; }
}
module.exports = { ExecutionEngine, dealRef };
