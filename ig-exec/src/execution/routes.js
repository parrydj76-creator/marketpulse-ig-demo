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

module.exports = function routes(engine) {
  const r = express.Router();
  r.use(express.json(), adminAuth);
  const h = (fn) => (req, res) => fn(req).then((d) => res.json(d)).catch((e) => res.status(500).json({ error: e.message }));
  r.get('/status', h(() => engine.status()));
  r.get('/history', h(() => engine.store.recent()));
  r.post('/kill', h((q) => engine.kill({ closeAll: q.body.closeAll !== false, reason: q.body.reason || 'api' })));
  r.post('/resume', h(() => engine.resume()));
  r.post('/reconcile', h(() => engine.reconcile()));
  r.post('/close/:dealId', h((q) => engine.closePosition(q.params.dealId, 'MANUAL')));
  r.put('/risk', h(async (q) => { await engine.store.setState('risk', q.body); return engine._cfg(); }));
  return r;
};
