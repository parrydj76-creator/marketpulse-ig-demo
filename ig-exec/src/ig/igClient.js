'use strict';
const { assertDemoUrl } = require('./guard');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class IgError extends Error {
  constructor(msg, { status, code, ambiguous = false, body } = {}) {
    super(msg); this.name = 'IgError';
    Object.assign(this, { status, code, ambiguous, body });
  }
}

class IgClient {
  constructor(o) {
    this.baseUrl = o.baseUrl.replace(/\/$/, '');
    assertDemoUrl(this.baseUrl);
    this.apiKey = o.apiKey; this.identifier = o.identifier; this.password = o.password;
    this.expectedAccountId = o.accountId;
    this.fetch = o.fetchImpl || fetch;
    this.minGapMs = o.minGapMs ?? 250;       // stay well inside IG rate limits
    this.timeoutMs = o.timeoutMs ?? 10000;
    this.cst = null; this.xst = null; this.accountId = null; this.lsEndpoint = null;
    this._queue = Promise.resolve(); this._last = 0;
  }

  async _raw(method, path, { version = 1, body, auth = true, del = false } = {}) {
    const url = this.baseUrl + path;
    assertDemoUrl(url); // checked on every single request
    const headers = {
      'Content-Type': 'application/json; charset=UTF-8', Accept: 'application/json; charset=UTF-8',
      'X-IG-API-KEY': this.apiKey, Version: String(version),
    };
    if (auth) { headers.CST = this.cst; headers['X-SECURITY-TOKEN'] = this.xst; }
    if (del) headers._method = 'DELETE';
    let res, text;
    try {
      res = await this.fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(this.timeoutMs) });
      text = await res.text();
    } catch (e) {
      // Request may or may not have reached IG: caller MUST reconcile, never blindly retry.
      throw new IgError(`network: ${e.message}`, { ambiguous: true });
    }
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!res.ok) throw new IgError(`IG ${res.status} ${json?.errorCode || ''}`, { status: res.status, code: json?.errorCode, ambiguous: res.status >= 500, body: json });
    return { json, headers: res.headers };
  }

  async login() {
    const { json, headers } = await this._raw('POST', '/session', { version: 2, auth: false, body: { identifier: this.identifier, password: this.password } });
    // Layer 2: the session itself must be the whitelisted DEMO account.
    if (json.currentAccountId !== this.expectedAccountId) {
      throw new Error(`LIVE-ACCOUNT GUARD: session account ${json.currentAccountId} != IG_DEMO_ACCOUNT_ID`);
    }
    if (json.lightstreamerEndpoint && !/demo/i.test(json.lightstreamerEndpoint)) {
      throw new Error(`LIVE-ACCOUNT GUARD: non-demo Lightstreamer endpoint ${json.lightstreamerEndpoint}`);
    }
    this.cst = headers.get('cst'); this.xst = headers.get('x-security-token');
    this.accountId = json.currentAccountId; this.lsEndpoint = json.lightstreamerEndpoint;
    return json;
  }

  // Serialised + rate-limited + one automatic re-login on token expiry.
  request(method, path, opts) {
    const run = async () => {
      const wait = this._last + this.minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        if (!this.cst) await this.login();
        try { return (await this._raw(method, path, opts)).json; }
        catch (e) { if (e.status === 401) { await this.login(); return (await this._raw(method, path, opts)).json; } throw e; }
      } finally { this._last = Date.now(); }
    };
    const p = this._queue.then(run, run);
    this._queue = p.catch(() => {});
    return p;
  }

  openPosition(b) { return this.request('POST', '/positions/otc', { version: 2, body: b }); }
  closePosition(b) { return this.request('POST', '/positions/otc', { version: 1, body: b, del: true }); }
  editPosition(id, b) { return this.request('PUT', `/positions/otc/${id}`, { version: 2, body: b }); }
  confirm(ref) { return this.request('GET', `/confirms/${ref}`, { version: 1 }); }
  async positions() { return (await this.request('GET', '/positions', { version: 2 })).positions || []; }
  async transactions(from, to) {   // v2 history; dates are naive UTC 'YYYY-MM-DDTHH:mm:ss'
    const out = [];
    for (let page = 1; page <= 5; page++) {
      const r = await this.request('GET', `/history/transactions?type=ALL_DEAL&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&pageSize=100&pageNumber=${page}`, { version: 2 });
      out.push(...(r.transactions || []));
      if (page >= (r.metadata?.pageData?.totalPages || 1)) break;
    }
    return out;
  }
  market(epic) { return this.request('GET', `/markets/${epic}`, { version: 3 }); }
}
module.exports = { IgClient, IgError };
