'use strict';
// Pure functions: turn closed trades + orders + paper events into honest performance statistics.
const pipSize = (pair) => (/JPY/i.test(pair || '') ? 0.01 : 0.0001);
const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

function wilson(wins, n, z = 1.96) {            // 95% confidence interval for a win rate
  if (!n) return [0, 1];
  const p = wins / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

function exitClass(p) {
  const r = String(p.closeReason || '');
  if (['BROKER_STOP', 'BROKER_LIMIT', 'MAX_HOLD', 'KILL_SWITCH', 'MANUAL', 'NO_BROKER_STOP'].includes(r)) return r;
  return r.startsWith('CLOSED_AT_BROKER') || r === 'BROKER_EXIT' ? 'BROKER_EXIT' : r || 'UNKNOWN';
}

function enrich(p, orderByRef) {
  const pip = pipSize(p.pair), o = orderByRef.get(p.dealReference) || null;
  const dir = p.direction === 'BUY' ? 1 : -1;
  const pips = p.closeLevel != null && p.openLevel != null ? ((p.closeLevel - p.openLevel) / pip) * dir : null;
  const openMs = p.openedAt ? new Date(p.openedAt).getTime() : null, closeMs = p.closedAt ? new Date(p.closedAt).getTime() : null;
  return { ...p, pips, order: o, exit: exitClass(p), hourUtc: openMs != null ? new Date(openMs).getUTCHours() : null,
    holdMin: openMs != null && closeMs != null ? (closeMs - openMs) / 60000 : null,
    exact: p.pnlEstimated === false };
}

function stats(trades) {
  const t = trades.filter((x) => x.pnlGbp != null), n = t.length;
  const wins = t.filter((x) => x.pnlGbp > 0), losses = t.filter((x) => x.pnlGbp < 0);
  const avgWin = mean(wins.map((x) => x.pnlGbp)), avgLoss = losses.length ? -mean(losses.map((x) => x.pnlGbp)) : null;
  const gw = sum(wins.map((x) => x.pnlGbp)), gl = -sum(losses.map((x) => x.pnlGbp));
  const [lo, hi] = wilson(wins.length, n);
  return { n, wins: wins.length, losses: losses.length, winRate: n ? wins.length / n : null, winRateCI95: [lo, hi],
    avgWinGbp: r2(avgWin), avgLossGbp: r2(avgLoss), profitFactor: gl > 0 ? r2(gw / gl) : null,
    expectancyGbp: r2(n ? sum(t.map((x) => x.pnlGbp)) / n : null), totalPnlGbp: r2(sum(t.map((x) => x.pnlGbp))),
    breakEvenWinRate: avgWin && avgLoss ? avgLoss / (avgWin + avgLoss) : null };
}

function verdict(s) {
  if (s.n < 30) return `Only ${s.n} closed trade(s). Nothing can be concluded yet; results this small are mostly luck.`;
  const be = s.breakEvenWinRate;
  if (be == null) return 'Not enough wins and losses yet to compute a break-even win rate.';
  const [lo, hi] = s.winRateCI95, tail = ` (win rate ${(s.winRate * 100).toFixed(0)}%, 95% range ${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%, break-even ${(be * 100).toFixed(0)}%)`;
  if (s.n < 100) return 'Early data (under 100 trades): treat as indicative only' + tail + '.';
  if (hi < be) return 'Win rate is significantly BELOW break-even after costs' + tail + '. The strategy is losing at these settings.';
  if (lo > be && s.expectancyGbp > 0) return 'Win rate is above break-even with statistical confidence' + tail + '. Still demo results; fills on a live account can differ.';
  return 'Inconclusive: the win-rate range straddles break-even' + tail + '. Keep collecting trades.';
}

function buildReport({ positions = [], orders = [], paperEvents = [], pipValueGbp = 1, now = Date.now() }) {
  const orderByRef = new Map(orders.map((o) => [o.dealReference, o]));
  const closed = positions.filter((p) => p.status === 'CLOSED').map((p) => enrich(p, orderByRef));
  const overall = stats(closed);
  const group = (keyFn) => {
    const g = {}; for (const t of closed) { if (t.pnlGbp == null) continue; const k = keyFn(t); if (k == null) continue; (g[k] ||= []).push(t); }
    return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, { n: v.length, wins: v.filter((x) => x.pnlGbp > 0).length, pnlGbp: r2(sum(v.map((x) => x.pnlGbp))), avgPnlGbp: r2(mean(v.map((x) => x.pnlGbp))) }]));
  };
  const exactTrades = closed.filter((t) => t.exact && t.pips != null && Math.abs(t.pips) >= 2 && t.size);
  const withEst = closed.filter((t) => t.exact && t.pnlEstimateGbp != null);
  const spreads = orders.map((o) => o.spreadPips).filter((x) => x != null), slips = orders.map((o) => o.slippagePips).filter((x) => x != null);
  const implied = median(exactTrades.map((t) => t.pnlGbp / (t.pips * t.size)));
  const pv = implied || pipValueGbp;

  // paper vs broker: same signal id = `${epic}:${bar}`
  const paperByKey = new Map(paperEvents.map((e) => [`${e.epic}:${e.bar}`, e]));
  const pairs = closed.filter((t) => t.order && t.pips != null && paperByKey.has(t.order.idemKey))
    .map((t) => { const e = paperByKey.get(t.order.idemKey); return { key: t.order.idemKey, paperPips: e.pips, brokerPips: t.pips, gapPips: t.pips - e.pips, paperReason: e.reason, brokerExit: t.exit }; });
  const firstOrderMs = orders.length ? Math.min(...orders.map((o) => new Date(o.createdAt).getTime())) : null;
  const executedKeys = new Set(orders.map((o) => o.idemKey));
  const paperSince = firstOrderMs == null ? [] : paperEvents.filter((e) => e.closedAt >= firstOrderMs);

  const sentLatencies = orders.map((o) => (o.context && o.context.signalAt ? new Date(o.createdAt).getTime() - o.context.signalAt : null)).filter((x) => x != null && x >= 0);
  return {
    generatedAt: new Date(now).toISOString(), verdict: verdict(overall), overall,
    pnlQuality: { closedTrades: closed.length, exactFromIG: closed.filter((t) => t.exact).length, estimatedOnly: closed.filter((t) => !t.exact).length },
    costs: { avgSpreadPips: r2(mean(spreads)), avgSlippagePips: r2(mean(slips)), estSpreadCostGbp: r2(sum(orders.filter((o) => o.spreadPips != null && o.status === 'FILLED').map((o) => o.spreadPips * o.size * pv))),
      avgSignalToOrderSeconds: r2(mean(sentLatencies) / 1000), avgHoldMinutes: r2(mean(closed.map((t) => t.holdMin).filter((x) => x != null))) },
    byExit: group((t) => t.exit), byHourUtc: group((t) => t.hourUtc), byDirection: group((t) => t.direction),
    calibration: { impliedPipValueGbp: r2(implied), tradesUsed: exactTrades.length, avgEstimateErrorGbp: r2(mean(withEst.map((t) => t.pnlGbp - t.pnlEstimateGbp))) },
    paperVsBroker: { matchedTrades: pairs.length, avgPaperPips: r2(mean(pairs.map((x) => x.paperPips))), avgBrokerPips: r2(mean(pairs.map((x) => x.brokerPips))),
      avgGapPips: r2(mean(pairs.map((x) => x.gapPips))), paperTradesNotExecuted: paperSince.filter((e) => !executedKeys.has(`${e.epic}:${e.bar}`)).length, pairs: pairs.slice(-30) },
  };
}

function tradesCsv(positions, orders) {
  const orderByRef = new Map(orders.map((o) => [o.dealReference, o]));
  const cols = ['dealId', 'epic', 'direction', 'size', 'openedAt', 'closedAt', 'openLevel', 'closeLevel', 'stopLevel', 'limitLevel', 'pips', 'pnlGbp', 'pnlExactFromIG', 'closeReason', 'spreadPips', 'slippagePips', 'score', 'rsi', 'ema9', 'ema21', 'source'];
  const esc = (v) => { if (v == null) return ''; const s = v instanceof Date ? v.toISOString() : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = positions.filter((p) => p.status === 'CLOSED').map((p) => {
    const t = enrich(p, orderByRef), o = t.order || {}, c = o.context || {};
    return [p.dealId, p.epic, p.direction, p.size, p.openedAt, p.closedAt, p.openLevel, p.closeLevel, p.stopLevel, p.limitLevel, t.pips == null ? '' : t.pips.toFixed(1), p.pnlGbp, t.exact, p.closeReason, o.spreadPips, o.slippagePips, c.score, c.rsi, c.ema9, c.ema21, p.source].map(esc).join(',');
  });
  return [cols.join(','), ...rows].join('\n') + '\n';
}
module.exports = { buildReport, tradesCsv, wilson, verdict };
