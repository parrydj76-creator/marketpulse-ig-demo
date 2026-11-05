'use strict';

// Analytics for simulated paper trades only.
// Pips are not GBP profits. No broker execution is performed.
function calculatePaperAnalytics(history = []) {
  const closes = (Array.isArray(history) ? history : [])
    .filter(t => t.kind === 'CLOSE' && typeof t.pnlPips === 'number' && Number.isFinite(t.pnlPips))
    .slice()
    .reverse();

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;

  const equityCurve = [{ trade: 0, pips: 0 }];

  closes.forEach((trade, index) => {
    const pnl = trade.pnlPips;

    equity += pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);

    if (pnl > 0) {
      wins++;
      grossProfit += pnl;
    } else if (pnl < 0) {
      losses++;
      grossLoss += Math.abs(pnl);
    }

    equityCurve.push({
      trade: index + 1,
      at: trade.at,
      pips: Number(equity.toFixed(2))
    });
  });

  const total = closes.length;
  const round = n => Number(n.toFixed(2));

  return {
    simulationOnly: true,
    unit: 'pips',
    scope: 'availableHistory',
    totalTrades: total,
    wins,
    losses,
    breakeven: total - wins - losses,
    winRate: total ? round(wins / total * 100) : null,
    netPips: round(equity),
    grossProfitPips: round(grossProfit),
    grossLossPips: round(grossLoss),
    averageWinPips: wins ? round(grossProfit / wins) : null,
    averageLossPips: losses ? round(grossLoss / losses) : null,
    profitFactor: grossLoss ? round(grossProfit / grossLoss) : null,
    maxDrawdownPips: round(maxDrawdown),
    equityCurve
  };
}

module.exports = { calculatePaperAnalytics };
