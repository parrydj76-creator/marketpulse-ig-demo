'use strict';
// Replaces estimated P&L with IG's own booked figure, matched from IG transaction history.
// Matching is by instrument + size + open level + open time (IG's transaction "reference" format is not relied on).
const pipSize = (pair) => (/JPY/i.test(pair || '') ? 0.01 : 0.0001);
const slashed = (pair) => (String(pair).includes('/') ? String(pair) : String(pair).replace(/^(.{3})(.{3})$/, '$1/$2'));

const toMs = (s) => {                       // IG v2 *Utc fields have no zone suffix: treat as UTC
  if (!s) return NaN;
  const str = String(s).replace(' ', 'T');
  return Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(str) ? str : str + 'Z');
};
function parseMoney(s) {                    // "£-91.20", "-£91.20", "£1,234.50"
  if (s == null) return NaN;
  const str = String(s), num = parseFloat(str.replace(/[^0-9.]/g, ''));
  return Number.isFinite(num) ? (/-/.test(str) ? -num : num) : NaN;
}
const isGbp = (t) => t.currency === '£' || t.currency === 'GBP' || /£/.test(String(t.profitAndLoss));

function matchTx(pos, txs, used) {
  const pip = pipSize(pos.pair), tol = pip * 0.2, name = slashed(pos.pair).toUpperCase();
  const posOpen = new Date(pos.openedAt).getTime();
  let best = null;
  for (const t of txs) {
    if (used.has(t)) continue;
    if (t.transactionType && !/DEAL/i.test(t.transactionType)) continue;
    if (!String(t.instrumentName || '').replace(/\s/g, '').toUpperCase().includes(name)) continue;
    const sz = String(t.size).trim();                      // IG: "+1" = BUY position, "-1" = SELL position
    if (Math.abs(Math.abs(Number(sz)) - Number(pos.size)) > 1e-9) continue;
    if (/^[+-]/.test(sz) && (sz[0] === '+') !== (pos.direction === 'BUY')) continue;
    if (Math.abs(Number(t.openLevel) - Number(pos.openLevel)) > tol) continue;
    let dt; const openMs = toMs(t.openDateUtc);
    if (Number.isFinite(openMs)) { dt = Math.abs(openMs - posOpen); if (dt > 180000) continue; }
    else { dt = Math.abs(toMs(t.dateUtc) - new Date(pos.closedAt).getTime()); if (!(dt <= 600000)) continue; }
    if (!best || dt < best.dt) best = { t, dt };
  }
  return best ? best.t : null;
}

function classifyBrokerExit(pos, closeLevel) {   // was it the stop, the limit, or something else (gap / manual)?
  const pip = pipSize(pos.pair), near = (a) => a != null && Math.abs(closeLevel - a) <= 3 * pip;
  if (near(pos.stopLevel)) return 'BROKER_STOP';
  if (near(pos.limitLevel)) return 'BROKER_LIMIT';
  return 'BROKER_EXIT';
}

async function syncExactPnl(engine) {
  const store = engine.store, minAge = engine.pnlSyncMinAgeMs ?? 60000;
  const rows = (await store.listEstimatedClosed(50)).filter((p) => Date.now() - new Date(p.closedAt).getTime() >= minAge);
  if (!rows.length) return { matched: 0, pending: 0 };
  const iso = (ms) => new Date(ms).toISOString().slice(0, 19);
  const oldest = Math.min(...rows.map((p) => new Date(p.openedAt || p.closedAt).getTime())) - 6 * 3600e3;
  const txs = await engine.ig.transactions(iso(oldest), iso(Date.now() + 6 * 3600e3));
  const used = new Set(); let matched = 0;
  for (const p of rows) {
    const t = matchTx(p, txs, used); if (!t) continue;
    const pnl = parseMoney(t.profitAndLoss); if (!Number.isFinite(pnl) || !isGbp(t)) continue;
    used.add(t);
    const patch = { dealId: p.dealId, pnlGbp: pnl, pnlEstimated: false, pnlEstimateGbp: p.pnlEstimateGbp ?? p.pnlGbp ?? null };
    const cl = Number(t.closeLevel);
    if (Number.isFinite(cl)) { patch.closeLevel = cl; if (p.closeReason === 'BROKER_EXIT') patch.closeReason = classifyBrokerExit(p, cl); }
    await store.upsertPosition(patch); matched++;
    await store.audit('PNL_CONFIRMED', { dealId: p.dealId, pnl, estimate: patch.pnlEstimateGbp });
  }
  return { matched, pending: rows.length - matched };
}
module.exports = { syncExactPnl, matchTx, parseMoney, toMs, classifyBrokerExit };
