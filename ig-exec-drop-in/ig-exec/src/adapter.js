'use strict';
// Converts a v2000 paper-engine entry plan into an execution signal.
// Broker size is NOT the paper size (paper assumes an unverified 100k contract); it is the explicit IG_EXEC_SIZE.
const num = (x) => (Number.isFinite(x) ? x : null);
function toSignal(p, env = process.env) {
  const size = Number(env.IG_EXEC_SIZE);
  if (!(size > 0)) return null;
  if (!p || !p.epic || !p.bar || !['LONG', 'SHORT'].includes(p.direction)) return null;
  return {
    id: `${p.epic}:${p.bar}`,                       // stable → same bar can never trade twice
    epic: p.epic,
    direction: p.direction === 'LONG' ? 'BUY' : 'SELL',
    stopPips: Number(env.IG_EXEC_STOP_PIPS || 12),
    targetPips: Number(env.IG_EXEC_LIMIT_PIPS || 18),
    size, source: 'v2000',
    context: { score: num(p.score), rsi: num(p.rsi), ema9: num(p.ema9), ema21: num(p.ema21), paperEntry: num(p.entry), paperSpreadPips: num(p.spreadPips),
      paperRisk: num(p.risk), signalBar: p.bar, signalAt: num(p.at) },
  };
}
module.exports = { toSignal };
