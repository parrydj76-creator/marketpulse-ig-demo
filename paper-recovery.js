'use strict';

const {getPaperEvents} = require('./paper-store');

async function inspectPaperRecovery() {
  const events = await getPaperEvents(10000);

  // Fail closed when the archive reaches its retrieval limit.
  if (events.length >= 10000) {
    throw Error('Recovery archive limit reached: manual review required');
  }

  const chronological = [...events].reverse();
  const today = new Date().toISOString().slice(0, 10);

  const unresolved = new Map();
  const interrupted = new Set();
  const seenTradeIds = new Set();

  let dailyOpens = 0;
  let lastCloseAt = 0;
  let realizedPips = 0;
  let completedTrades = 0;
  let lastSignalBar = null;
  let lastEventAt = -Infinity;

  for (const event of chronological) {
    if (!event || !['OPEN', 'CLOSE', 'INTERRUPTED'].includes(event.kind)) {
      throw Error('Unknown archived paper event');
    }

    const timestamp = Date.parse(event.at);

    if (!Number.isFinite(timestamp)) {
      throw Error('Invalid archived event timestamp');
    }

    if (timestamp < lastEventAt) throw Error('Archived paper events are out of chronological order');
    lastEventAt = timestamp;

    if (event.kind === 'OPEN') {
      const id = event.archiveEventId;

      if(typeof id!=='string' || !/^[a-f0-9]{64}$/.test(id)){
        throw Error('Archived OPEN missing original PostgreSQL ID');
      }

      if (unresolved.has(id) || interrupted.has(id)) {
        throw Error('Duplicate paper OPEN event');
      }

      if (event.tradeId != null) {
        if (typeof event.tradeId !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.tradeId)) {
          throw Error('Invalid OPEN trade ID');
        }

        if (seenTradeIds.has(event.tradeId)) {
          throw Error('Duplicate OPEN trade ID in archive');
        }

        seenTradeIds.add(event.tradeId);
      }

      if (!['LONG','SHORT'].includes(event.direction) || !Number.isFinite(event.entry)) throw Error('Invalid archived OPEN');
      unresolved.set(id, event);
      if(event.at.slice(0,10)===today)lastSignalBar=Math.floor(timestamp/300000);

      if (event.at.slice(0, 10) === today) {
        dailyOpens++;
      }
    }

    if (event.kind === 'CLOSE') {
      // New CLOSE events must match their OPEN by tradeId.
      // Legacy CLOSE events are accepted only when exactly one
      // unresolved OPEN exists and neither event has a tradeId.
      let match;

      if (event.tradeId != null) {
        if (typeof event.tradeId !== 'string' || !event.tradeId) {
          throw Error('Invalid CLOSE trade ID');
        }

        const matches = [...unresolved.entries()].filter(
          ([, open]) => open.tradeId === event.tradeId
        );

        if (matches.length !== 1) {
          throw Error('CLOSE trade ID has no unique matching OPEN');
        }

        match = matches[0];
      } else {
        if (unresolved.size !== 1) {
          throw Error('Ambiguous legacy CLOSE: trade linkage required');
        }

        match = unresolved.entries().next().value;

        if (match[1].tradeId != null) {
          throw Error('New OPEN cannot be closed by legacy CLOSE');
        }
      }

      const [id, open] = match;

      if (open.direction !== event.direction) {
        throw Error('Paper CLOSE direction mismatch');
      }

      if (!Number.isFinite(event.pnlPips)) {
        throw Error('Invalid paper CLOSE P/L');
      }

      unresolved.delete(id);
      lastCloseAt = timestamp;
      realizedPips += event.pnlPips;
      completedTrades++;
    }

    if (event.kind === 'INTERRUPTED') {
      const id = event.openEventId;

      if (interrupted.has(id)) {
        throw Error('Duplicate paper interruption');
      }

      const open = unresolved.get(id);

      if (!open) {
        throw Error('Interruption without matching unresolved OPEN');
      }

      if (open.direction !== event.direction) {
        throw Error('Interruption direction mismatch');
      }

      if (event.exit != null || event.pnlPips != null) {
        throw Error('Interruption must not contain realised P/L');
      }

      if (timestamp < Date.parse(open.at)) {
        throw Error('Interruption predates original OPEN');
      }

      unresolved.delete(id);
      interrupted.add(id);
    }
  }

  return {
    inspected: true,
    archivedEvents: events.length,
    day: today,
    dailyOpens,
    lastCloseAt,
    realizedPips: Number(realizedPips.toFixed(2)),
    completedTrades,
    lastSignalBar,
    interruptedTrades: interrupted.size,
    unresolvedPositions: [...unresolved.entries()].map(([id, event]) => ({
      openEventId: id,
      ...event
    })),
    safeToResume: unresolved.size === 0,
    warning: unresolved.size
      ? 'Unresolved simulated positions require manual reconciliation'
      : null
  };
}

module.exports = {inspectPaperRecovery};
