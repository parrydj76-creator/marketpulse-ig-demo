'use strict';
// Push alerts for execution events. Reuses the app's existing subscription table (mp_push_subscriptions).
// Alerts can NEVER affect trading: every failure is swallowed and logged.
const money = (x) => (x == null || !Number.isFinite(Number(x)) ? '?' : (Number(x) < 0 ? '-£' : '+£') + Math.abs(Number(x)).toFixed(2));
const lvl = (x) => (x == null ? '?' : Number(x).toFixed(5).replace(/0+$/, '').replace(/\.$/, ''));
const pairLabel = (p) => String(p || '').replace(/^(.{3})(.{3})$/, '$1/$2');
const CRITICAL = new Set(['ADOPTED', 'KILL', 'DEGRADED', 'ORDER_FAILED', 'TEST']);
const URL_EXEC = '/ig-exec.html';

const FORMATS = {
  FILLED: ({ pos, order, slippagePips }) => ({ title: `IG DEMO · ${pos.direction} ${pairLabel(pos.pair)} opened`, tag: 'ig-fill',
    body: `${pos.size} @ ${lvl(pos.openLevel)} · stop ${lvl(pos.stopLevel)} · target ${lvl(pos.limitLevel)} · spread ${order.spreadPips ?? '?'}p · slippage ${slippagePips ?? '?'}p` }),
  CLOSED: ({ pos, level, reason, pnl }) => ({ title: `IG DEMO · ${pairLabel(pos.pair)} closed (${reason})`, tag: 'ig-close',
    body: `${pos.direction} ${lvl(pos.openLevel)} → ${lvl(level)} · P&L ${money(pnl)} (estimate; exact figure confirmed later)` }),
  SIGNAL_SKIPPED: ({ sig, reason }) => ({ title: `IG DEMO · signal skipped`, tag: 'ig-skip', body: `${sig.direction} ${pairLabel((sig.epic || '').split('.')[2])}: ${reason}` }),
  REJECTED: ({ reason, order }) => ({ title: 'IG DEMO · order REJECTED by IG', tag: 'ig-reject', body: `${order?.direction || ''} ${pairLabel(order?.pair)}: ${reason}` }),
  KILL: ({ reason, closed, errors }) => ({ title: 'IG DEMO · KILL SWITCH ON', tag: 'ig-kill', body: `Reason: ${reason}. Closed ${closed.length} position(s)${errors.length ? `, ${errors.length} FAILED to close: check IG now` : ''}. Trading stopped.` }),
  RESUMED: () => ({ title: 'IG DEMO · trading resumed', tag: 'ig-kill', body: 'Kill switch released. Automated trading is live on DEMO.' }),
  ADOPTED: ({ dealId, epic, direction, size, stopLevel }) => ({ title: 'IG DEMO · UNEXPECTED position found', tag: 'ig-adopt', body: `${direction} ${size} ${pairLabel((epic || '').split('.')[2])} (${dealId}) was not opened by the bot. Stop: ${stopLevel ?? 'NONE'}. Check IG.` }),
  DEGRADED: ({ error }) => ({ title: 'IG DEMO · engine DEGRADED', tag: 'ig-health', body: `Cannot reconcile with IG (${String(error).slice(0, 80)}). New orders are blocked until it recovers.` }),
  RECOVERED: () => ({ title: 'IG DEMO · engine recovered', tag: 'ig-health', body: 'Reconciliation with IG is working again.' }),
  ORDER_FAILED: ({ ref, reason }) => ({ title: 'IG DEMO · order outcome unknown', tag: 'ig-fail', body: `Order ${ref} could not be found at IG (${reason}). Check the IG platform.` }),
  STARTED: ({ killed }) => ({ title: 'IG DEMO · engine started', tag: 'ig-health', body: killed ? 'Started in KILLED state: not trading until you press Resume.' : 'Started and trading on DEMO.' }),
  SUMMARY: ({ text }) => ({ title: 'IG DEMO · daily summary', tag: 'ig-summary', body: text }),
  TEST: () => ({ title: 'IG DEMO · test alert', tag: 'ig-test', body: 'Execution alerts are working.' }),
};

function createNotifier({ pool, env = process.env, logger = console, webpush = null, maxPerHour = 30 } = {}) {
  const configured = Boolean(pool && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  let wp = webpush, ready = false, stamps = [];
  async function init() {
    if (ready || !configured) return ready;
    wp = wp || require('web-push');
    wp.setVapidDetails(env.VAPID_SUBJECT || 'mailto:admin@example.com', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    await pool.query('CREATE TABLE IF NOT EXISTS mp_push_subscriptions (endpoint_hash TEXT PRIMARY KEY, subscription JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    return (ready = true);
  }
  async function send(type, data = {}) {
    try {
      const fmt = FORMATS[type]; if (!fmt) return { accepted: 0, reason: 'unknown type' };
      if (!(await init())) return { accepted: 0, reason: 'not configured' };
      const now = Date.now(); stamps = stamps.filter((t) => now - t < 3600e3);
      if (!CRITICAL.has(type) && stamps.length >= maxPerHour) { logger.error('[alerts] hourly cap reached, dropped ' + type); return { accepted: 0, reason: 'rate capped' }; }
      stamps.push(now);
      const m = fmt(data), payload = JSON.stringify({ title: m.title, body: m.body, tag: m.tag, url: URL_EXEC });
      const subs = (await pool.query('SELECT endpoint_hash, subscription FROM mp_push_subscriptions LIMIT 100')).rows;
      let accepted = 0, failed = 0;
      for (const s of subs) {
        try { await wp.sendNotification(s.subscription, payload, { TTL: 3600, urgency: CRITICAL.has(type) ? 'high' : 'normal' }); accepted++; }
        catch (e) { failed++; if (e.statusCode === 404 || e.statusCode === 410) await pool.query('DELETE FROM mp_push_subscriptions WHERE endpoint_hash=$1', [s.endpoint_hash]); else logger.error('[alerts] delivery failed', e.statusCode || e.message); }
      }
      return { accepted, failed, subscriptions: subs.length };
    } catch (e) { logger.error('[alerts] send failed', e.message); return { accepted: 0, reason: e.message }; }
  }
  async function status() {
    let subscriptions = null;
    try { if (configured && (await init())) subscriptions = Number((await pool.query('SELECT COUNT(*) c FROM mp_push_subscriptions')).rows[0].c); } catch { /* ignore */ }
    return { configured, subscriptions, needs: configured ? null : 'Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (and PUSH_PAIRING_TOKEN for subscribing a device)' };
  }
  return { send, status, configured };
}

// ---- daily summary (weekdays, once per UTC day, after hourUtc) ----
async function buildSummary({ store, engine, now = Date.now() }) {
  const dayStart = new Date(new Date(now).setUTCHours(0, 0, 0, 0)).getTime();
  const closed = await store.listClosed(500);
  const mine = (from) => closed.filter((p) => p.closedAt && new Date(p.closedAt).getTime() >= from && p.pnlGbp != null);
  const today = mine(dayStart), week = mine(now - 7 * 86400e3);
  const open = await store.listPositions('OPEN');
  const state = engine.killed ? 'KILLED' : engine.degraded ? 'DEGRADED' : 'RUNNING';
  const sumP = (a) => a.reduce((s, p) => s + p.pnlGbp, 0);
  const est = today.filter((p) => p.pnlEstimated !== false).length;
  const t = today.length ? `Today: ${today.length} trade(s), ${today.filter((p) => p.pnlGbp > 0).length} win(s), ${money(sumP(today))}${est ? ` (${est} estimated)` : ''}` : 'Today: no trades';
  return { text: `${t} · open: ${open.length} · ${state} · 7 days: ${money(sumP(week))} (${week.length} trades)` };
}

async function maybeSendSummary({ store, engine, send, hourUtc = 21, now = Date.now() }) {
  const d = new Date(now), day = d.toISOString().slice(0, 10), dow = d.getUTCDay();
  if (dow === 0 || dow === 6 || d.getUTCHours() < hourUtc) return false;
  const last = await store.getState('summary_last');
  if (last && last.day === day) return false;
  await store.setState('summary_last', { day });                 // mark first: a crash must not cause repeats
  await send('SUMMARY', await buildSummary({ store, engine, now }));
  return true;
}
function startDailySummary(opts) {
  const t = setInterval(() => maybeSendSummary(opts).catch((e) => (opts.logger || console).error('[alerts] summary failed', e.message)), 60000);
  t.unref?.(); return t;
}
module.exports = { createNotifier, buildSummary, maybeSendSummary, startDailySummary, FORMATS };
