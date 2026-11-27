'use strict';
// Same interface, two backends. MemStore is for tests; PgStore for production.
const ORDER_COLS = ['dealReference','epic','pair','direction','size','stopDistance','limitDistance','status','dealId','reason','level','signal','quoteLevel','spreadPips','slippagePips','context'];
const POS_COLS = ['dealId','dealReference','epic','pair','direction','size','openLevel','stopLevel','limitLevel','status','source','openedAt','closedAt','closeLevel','closeReason','pnlGbp','pnlEstimated','pnlEstimateGbp'];
const NUMERIC = ['size','stopDistance','limitDistance','level','openLevel','stopLevel','limitLevel','closeLevel','pnlGbp','quoteLevel','spreadPips','slippagePips','pnlEstimateGbp'];
const snake = (s) => s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const out = (r) => r && Object.fromEntries(Object.entries(r).map(([k, v]) => { const c = camel(k); return [c, v !== null && NUMERIC.includes(c) ? Number(v) : v]; }));

class MemStore {
  async migrate() {}
  async listClosed(limit = 1000) { return [...this.positions.values()].filter((p) => p.status === 'CLOSED').slice(-limit).map((p) => ({ ...p })); }
  async listAllOrders(limit = 2000) { return this.orders.slice(-limit).map((o) => ({ ...o })); }
  async listEstimatedClosed(limit = 50) { return [...this.positions.values()].filter((p) => p.status === 'CLOSED' && p.pnlEstimated !== false).slice(-limit).map((p) => ({ ...p })); }
  async recent() { return { orders: this.orders.slice(-50).reverse(), closed: [...this.positions.values()].filter((p) => p.status === 'CLOSED').slice(-50).reverse() }; }
  constructor() { this.orders = []; this.positions = new Map(); this.state = new Map(); this.auditLog = []; }
  async insertOrder(o) {
    const ex = this.orders.find((x) => x.idemKey === o.idemKey || x.dealReference === o.dealReference);
    if (ex) return { inserted: false, row: { ...ex } };
    const row = { ...o, createdAt: new Date(), updatedAt: new Date() }; this.orders.push(row); return { inserted: true, row: { ...row } };
  }
  async getOrder(ref) { const o = this.orders.find((x) => x.dealReference === ref); return o && { ...o }; }
  async updateOrder(ref, patch) { Object.assign(this.orders.find((x) => x.dealReference === ref), patch, { updatedAt: new Date() }); }
  async listOrders(statuses) { return this.orders.filter((o) => statuses.includes(o.status)).map((o) => ({ ...o })); }
  async upsertPosition(p) { this.positions.set(p.dealId, { ...(this.positions.get(p.dealId) || {}), ...p }); }
  async getPosition(id) { const p = this.positions.get(id); return p && { ...p }; }
  async listPositions(status) { return [...this.positions.values()].filter((p) => p.status === status).map((p) => ({ ...p })); }
  async getState(k) { return this.state.get(k) ?? null; }
  async setState(k, v) { this.state.set(k, v); }
  async audit(event, data) { this.auditLog.push({ ts: new Date(), event, data }); }
  async realisedPnlSince(ts) { return [...this.positions.values()].filter((p) => p.status === 'CLOSED' && p.closedAt >= ts).reduce((s, p) => s + (p.pnlGbp || 0), 0); }
  async countOrdersSince(ts) { return this.orders.filter((o) => o.createdAt >= ts && ['FILLED', 'SUBMITTING', 'UNKNOWN'].includes(o.status)).length; }
  async lastOrderAt(epic) { const l = this.orders.filter((o) => o.epic === epic && o.status === 'FILLED').map((o) => o.createdAt); return l.length ? new Date(Math.max(...l)) : null; }
}

class PgStore {
  constructor(pool) { this.db = pool; }
  async migrate() {
    const fs = require('fs'), path = require('path'), dir = path.join(__dirname, '../../migrations');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await this.db.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  async listClosed(limit = 1000) { return (await this.db.query("SELECT * FROM ig_positions WHERE status='CLOSED' ORDER BY closed_at DESC LIMIT $1", [limit])).rows.map(out); }
  async listAllOrders(limit = 2000) { return (await this.db.query('SELECT * FROM ig_orders ORDER BY id DESC LIMIT $1', [limit])).rows.map(out); }
  async listEstimatedClosed(limit = 50) { return (await this.db.query("SELECT * FROM ig_positions WHERE status='CLOSED' AND pnl_estimated IS NOT FALSE AND closed_at > now() - interval '30 days' ORDER BY closed_at DESC LIMIT $1", [limit])).rows.map(out); }
  async recent() {
    return { orders: (await this.db.query('SELECT * FROM ig_orders ORDER BY id DESC LIMIT 50')).rows.map(out),
      closed: (await this.db.query("SELECT * FROM ig_positions WHERE status='CLOSED' ORDER BY closed_at DESC LIMIT 50")).rows.map(out) };
  }
  async insertOrder(o) {
    const r = await this.db.query(
      `INSERT INTO ig_orders (idem_key,deal_reference,epic,pair,direction,size,stop_distance,limit_distance,status,signal,quote_level,spread_pips,context)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING RETURNING *`,
      [o.idemKey, o.dealReference, o.epic, o.pair, o.direction, o.size, o.stopDistance, o.limitDistance, o.status, JSON.stringify(o.signal || null),
        o.quoteLevel ?? null, o.spreadPips ?? null, JSON.stringify(o.context ?? null)]);
    if (r.rows[0]) return { inserted: true, row: out(r.rows[0]) };
    const ex = await this.db.query('SELECT * FROM ig_orders WHERE idem_key=$1 OR deal_reference=$2', [o.idemKey, o.dealReference]);
    return { inserted: false, row: out(ex.rows[0]) };
  }
  async getOrder(ref) { return out((await this.db.query('SELECT * FROM ig_orders WHERE deal_reference=$1', [ref])).rows[0]); }
  async updateOrder(ref, patch) {
    const keys = Object.keys(patch).filter((k) => ORDER_COLS.includes(k));
    const sets = keys.map((k, i) => `${snake(k)}=$${i + 2}`).concat('updated_at=now()');
    await this.db.query(`UPDATE ig_orders SET ${sets.join(',')} WHERE deal_reference=$1`, [ref, ...keys.map((k) => (k === 'signal' || k === 'context' ? JSON.stringify(patch[k]) : patch[k]))]);
  }
  async listOrders(statuses) { return (await this.db.query('SELECT * FROM ig_orders WHERE status = ANY($1)', [statuses])).rows.map(out); }
  // UPDATE first: Postgres checks NOT NULL on an INSERT's proposed row before conflict handling,
  // so a partial ON CONFLICT upsert (e.g. just status/closedAt) would fail on an existing position.
  async upsertPosition(p) {
    const keys = Object.keys(p).filter((k) => POS_COLS.includes(k) && k !== 'dealId');
    if (keys.length) {
      const r = await this.db.query(`UPDATE ig_positions SET ${keys.map((k, i) => `${snake(k)}=$${i + 2}`)} WHERE deal_id=$1`, [p.dealId, ...keys.map((k) => p[k])]);
      if (r.rowCount > 0) return;
    }
    const all = ['dealId', ...keys];
    await this.db.query(`INSERT INTO ig_positions (${all.map(snake)}) VALUES (${all.map((_, i) => `$${i + 1}`)})`, all.map((k) => p[k]));
  }
  async getPosition(id) { return out((await this.db.query('SELECT * FROM ig_positions WHERE deal_id=$1', [id])).rows[0]); }
  async listPositions(status) { return (await this.db.query('SELECT * FROM ig_positions WHERE status=$1', [status])).rows.map(out); }
  async getState(k) { return (await this.db.query('SELECT value FROM bot_state WHERE key=$1', [k])).rows[0]?.value ?? null; }
  async setState(k, v) { await this.db.query('INSERT INTO bot_state(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2', [k, JSON.stringify(v)]); }
  async audit(event, data) { await this.db.query('INSERT INTO audit_log(event,data) VALUES($1,$2)', [event, JSON.stringify(data || {})]); }
  async realisedPnlSince(ts) { return Number((await this.db.query("SELECT COALESCE(SUM(pnl_gbp),0) s FROM ig_positions WHERE status='CLOSED' AND closed_at>=$1", [ts])).rows[0].s); }
  async countOrdersSince(ts) { return Number((await this.db.query("SELECT COUNT(*) c FROM ig_orders WHERE created_at>=$1 AND status IN ('FILLED','SUBMITTING','UNKNOWN')", [ts])).rows[0].c); }
  async lastOrderAt(epic) { return (await this.db.query("SELECT MAX(created_at) m FROM ig_orders WHERE epic=$1 AND status='FILLED'", [epic])).rows[0].m; }
}
module.exports = { MemStore, PgStore };
