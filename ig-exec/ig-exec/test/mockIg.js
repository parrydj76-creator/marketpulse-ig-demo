'use strict';
const http = require('http');

function createMockIg({ accountId = 'DEMO1' } = {}) {
  const s = { positions: new Map(), confirms: new Map(), createCalls: 0, closeCalls: 0, dropNextCreateResponse: false, seq: 0, bid: 1.25, offer: 1.2502, accountId };
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const send = (code, obj, hdr = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...hdr }); res.end(JSON.stringify(obj)); };
      if (req.method === 'POST' && req.url === '/session') return send(200, { currentAccountId: s.accountId, lightstreamerEndpoint: 'https://demo-apd.marketdatasystems.com' }, { CST: 'cst1', 'X-SECURITY-TOKEN': 'xst1' });
      if (req.headers.cst !== 'cst1') return send(401, { errorCode: 'error.security.client-token-invalid' });
      if (req.method === 'GET' && req.url === '/positions') return send(200, { positions: [...s.positions.values()] });
      if (req.method === 'GET' && req.url.startsWith('/confirms/')) {
        const c = s.confirms.get(req.url.split('/')[2]);
        return c ? send(200, c) : send(404, { errorCode: 'error.confirms.deal-not-found' });
      }
      if (req.method === 'GET' && req.url.startsWith('/markets/')) return send(200, { snapshot: { bid: s.bid, offer: s.offer, marketStatus: 'TRADEABLE' }, dealingRules: { minDealSize: { value: 0.5 } } });
      if (req.method === 'PUT' && req.url.startsWith('/positions/otc/')) {
        const p = s.positions.get(req.url.split('/')[3]); Object.assign(p.position, { stopLevel: body.stopLevel, limitLevel: body.limitLevel });
        return send(200, { dealReference: 'EDIT' + ++s.seq });
      }
      if (req.method === 'POST' && req.url === '/positions/otc') {
        if (req.headers._method === 'DELETE') {
          s.closeCalls++;
          const p = s.positions.get(body.dealId); if (!p) return send(404, { errorCode: 'error.position.notfound' });
          s.positions.delete(body.dealId);
          const ref = 'CLOSE' + ++s.seq; const level = p.position.direction === 'BUY' ? s.bid : s.offer;
          s.confirms.set(ref, { dealStatus: 'ACCEPTED', reason: 'SUCCESS', dealId: body.dealId, level, direction: body.direction, size: body.size });
          return send(200, { dealReference: ref });
        }
        s.createCalls++;
        if (s.confirms.has(body.dealReference)) return send(400, { errorCode: 'error.public-api.duplicate-deal-reference' });
        const buy = body.direction === 'BUY'; const level = buy ? s.offer : s.bid; const dealId = 'DIAAA' + ++s.seq;
        const stopLevel = +(buy ? level - body.stopDistance * 1e-4 : level + body.stopDistance * 1e-4).toFixed(5);
        const limitLevel = body.limitDistance ? +(buy ? level + body.limitDistance * 1e-4 : level - body.limitDistance * 1e-4).toFixed(5) : null;
        s.positions.set(dealId, { position: { dealId, dealReference: body.dealReference, direction: body.direction, size: body.size, level, stopLevel, limitLevel, createdDateUTC: new Date().toISOString() }, market: { epic: body.epic } });
        s.confirms.set(body.dealReference, { dealStatus: 'ACCEPTED', reason: 'SUCCESS', dealId, level, direction: body.direction, size: body.size, stopLevel, limitLevel, epic: body.epic });
        if (s.dropNextCreateResponse) { s.dropNextCreateResponse = false; return req.socket.destroy(); }
        return send(200, { dealReference: body.dealReference });
      }
      send(404, { errorCode: 'mock.unhandled' });
    });
  });
  s.brokerClose = (dealId) => s.positions.delete(dealId);   // simulates a stop/limit being hit
  s.start = () => new Promise((r) => server.listen(0, '127.0.0.1', () => { s.url = `http://127.0.0.1:${server.address().port}`; r(s); }));
  s.stop = () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  return s;
}
module.exports = { createMockIg };
