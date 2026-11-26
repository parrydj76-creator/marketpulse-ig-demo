'use strict';
const DEFAULT_RISK = {
  maxOpenPositions: 1, maxPerEpic: 1, maxSizePerTrade: 1, minSize: 0.01, maxTotalSize: 1, maxOrdersPerDay: 3, maxHoldMinutes: 180,
  maxDailyLossGbp: 50, maxOrdersPerHour: 6, cooldownMinutes: 15,
  minStopPips: 5, maxStopPips: 100, minRewardRisk: 1, requireBrokerStop: true,
  allowedPairs: null, // e.g. ["GBP/USD","EUR/USD"]; null = all mapped pairs
};

// Pure function: returns { ok, reason?, size? }
function check({ sig, cfg, open, pendingCount, epic, dailyPnl, ordersLastHour, ordersToday, lastOrderAt, now }) {
  const rej = (reason) => ({ ok: false, reason });
  if (!['BUY', 'SELL'].includes(sig.direction)) return rej('BAD_DIRECTION');
  if (cfg.allowedPairs && !cfg.allowedPairs.includes(sig.pair)) return rej('PAIR_NOT_ALLOWED');
  if (!(sig.stopPips > 0)) return rej('STOP_REQUIRED');
  if (sig.stopPips < cfg.minStopPips || sig.stopPips > cfg.maxStopPips) return rej('STOP_OUT_OF_RANGE');
  if (sig.targetPips && sig.targetPips / sig.stopPips < cfg.minRewardRisk) return rej('REWARD_RISK_TOO_LOW');
  if (open.filter((p) => p.epic === epic).length + 0 >= cfg.maxPerEpic) return rej('MAX_PER_EPIC');
  if (open.length + pendingCount >= cfg.maxOpenPositions) return rej('MAX_OPEN_POSITIONS');
  if (dailyPnl <= -Math.abs(cfg.maxDailyLossGbp)) return rej('DAILY_LOSS_LIMIT');
  if (ordersLastHour >= cfg.maxOrdersPerHour) return rej('ORDER_RATE_LIMIT');
  if (ordersToday >= cfg.maxOrdersPerDay) return rej('DAILY_ORDER_CAP');
  if (lastOrderAt && now - new Date(lastOrderAt).getTime() < cfg.cooldownMinutes * 60000) return rej('COOLDOWN');
  const size = Math.min(Number(sig.size), cfg.maxSizePerTrade);
  if (!(size >= cfg.minSize)) return rej('SIZE_BELOW_MIN');
  const total = open.reduce((s, p) => s + Number(p.size), 0) + size;
  if (total > cfg.maxTotalSize) return rej('MAX_TOTAL_SIZE');
  return { ok: true, size: Math.round(size * 100) / 100 };
}
module.exports = { DEFAULT_RISK, check };
