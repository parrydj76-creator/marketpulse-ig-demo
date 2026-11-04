'use strict';

// MarketPulse V6.5 standalone monetary-risk calculator.
// No broker calls or order execution.

const RISK_FRACTION = 0.005;

function positive(value, name) {
  if (typeof value !== 'number' ||
      !Number.isFinite(value) || value <= 0) {
    throw Error(name + ' must be positive and finite');
  }
  return value;
}

function calculateRisk(input) {
  if (!input || typeof input !== 'object') {
    throw Error('Risk inputs required');
  }

  const equity = positive(input.equity, 'equity');
  const size = positive(input.size, 'size');
  const entry = positive(input.entry, 'entry');
  const stop = positive(input.stop, 'stop');

  if (!['BUY', 'SELL'].includes(input.direction)) {
    throw Error('Invalid trade direction');
  }

  if (input.direction === 'BUY' && stop >= entry) {
    throw Error('BUY stop must be below entry');
  }

  if (input.direction === 'SELL' && stop <= entry) {
    throw Error('SELL stop must be above entry');
  }

  if (input.contractVerified !== true ||
      input.currencyConversionVerified !== true) {
    throw Error('Contract or currency conversion unverified');
  }

  const valuePerPriceUnit = positive(
    input.valuePerPriceUnit,
    'valuePerPriceUnit'
  );

  const distance = Math.abs(entry - stop);
  const plannedLoss = distance * size * valuePerPriceUnit;
  const riskBudget = equity * RISK_FRACTION;

  if (!Number.isFinite(plannedLoss) || plannedLoss <= 0) {
    throw Error('Invalid monetary risk');
  }

  return {
    riskBudget,
    plannedLoss,
    riskPercentage: plannedLoss / equity * 100,
    withinLimit: plannedLoss <= riskBudget,
    approved: false,
    verificationStatus: 'BLOCKED_UNTIL_BROKER_DATA_VERIFIED',
    note: 'Excludes fees, slippage and market gaps'
  };
}

module.exports = { calculateRisk, RISK_FRACTION };
