'use strict';
const express = require('express');
const crypto = require('crypto');

function adminAuth(req, res, next) {
  const tok = process.env.ADMIN_TOKEN || '';
  const got = req.get('x-admin-token') || '';
  const a = Buffer.from(tok), b = Buffer.from(got);
  if (!tok || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'unauthorised' });
  next();
}

module.exports = function routes(engine, extras = {}) {
  const r = express.Router();
  r.use(express.json(), adminAuth);
  const h = (fn) => (req, res) => fn(req).then((d) => res.json(d)).catch((e) => res.status(500).json({ error: e.message }));
  r.get('/status', h(() => engine.status()));
  r.get('/report', h(() => extras.report()));
  r.get('/trades.csv', (_q, res) => extras.csv().then((t) => res.type('text/csv').set('Content-Disposition', 'attachment; filename="ig-trades.csv"').send(t)).catch((e) => res.status(500).json({ error: e.message })));
  r.post('/pnl-sync', h(() => engine.syncPnl()));
  r.get('/alerts/status', h(() => extras.notifier.status()));
  r.post('/alerts/test', h(() => extras.notifier.send('TEST', {})));
  r.get('/history', h(() => engine.store.recent()));
  r.post('/kill', h((q) => engine.kill({ closeAll: q.body.closeAll !== false, reason: q.body.reason || 'api' })));
  r.post('/resume', h(() => engine.resume()));
  r.post('/reconcile', h(() => engine.reconcile()));
  r.post('/close/:dealId', h((q) => engine.closePosition(q.params.dealId, 'MANUAL')));
  r.put('/risk', h(async (q) => { await engine.store.setState('risk', q.body); return engine._cfg(); }));
  return r;
};
