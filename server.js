
import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

const KEY = process.env.IG_API_KEY || '';
const USER = process.env.IG_USERNAME || '';
const PASS = process.env.IG_PASSWORD || '';

const TYPE = (process.env.IG_ACCOUNT_TYPE || 'DEMO').toUpperCase();

if (!['DEMO', 'LIVE'].includes(TYPE)) {
  throw new Error('IG_ACCOUNT_TYPE must be DEMO or LIVE.');
}

const BASE =
  TYPE === 'DEMO'
    ? 'https://demo-api.ig.com/gateway/deal'
    : 'https://api.ig.com/gateway/deal';

const POLL = Math.max(60, Number(process.env.POLL_SECONDS || 60));

const EPICS = (process.env.IG_EPICS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const dir = path.dirname(fileURLToPath(import.meta.url));

app.use(express.static(path.join(dir, 'public')));
app.use(express.json());

let session = null;
let lastError = null;
let scanning = false;

const latest = new Map();
const events = [];
const lastEvent = new Map();

const configured = () => Boolean(KEY && USER && PASS);

// --------------------------------------------------
// IG AUTHENTICATION
// --------------------------------------------------

async function login() {
  if (!configured()) {
    throw new Error(
      'Add IG_API_KEY, IG_USERNAME and IG_PASSWORD in Render environment settings.'
    );
  }

  const response = await fetch(`${BASE}/session`, {
    method: 'POST',
    headers: {
      'X-IG-API-KEY': KEY,
      'Content-Type': 'application/json; charset=UTF-8',
      Accept: 'application/json',
      Version: '2'
    },
    body: JSON.stringify({
      identifier: USER,
      password: PASS
    }),
    signal: AbortSignal.timeout(15000)
  });

  const body = await response.text();

  let data = {};

  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data.errorCode || `IG login failed (${response.status})`
    );
  }

  const cst = response.headers.get('CST');
  const securityToken = response.headers.get('X-SECURITY-TOKEN');

  if (!cst || !securityToken) {
    throw new Error('IG login response did not include session tokens.');
  }

  session = {
    cst,
    sec: securityToken,
    expires: Date.now() + 4 * 60 * 60 * 1000
  };

  return data;
}

// --------------------------------------------------
// IG API REQUEST
// --------------------------------------------------

async function request(endpoint, version = '1') {
  if (!session || Date.now() > session.expires - 60000) {
    await login();
  }

  const response = await fetch(`${BASE}${endpoint}`, {
    headers: {
      'X-IG-API-KEY': KEY,
      CST: session.cst,
      'X-SECURITY-TOKEN': session.sec,
      Version: version,
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(15000)
  });

  const body = await response.text();

  let data = {};

  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data.errorCode || `IG API HTTP ${response.status}`
    );
  }

  return data;
}

// --------------------------------------------------
// TECHNICAL INDICATORS
// --------------------------------------------------

function ema(values, period) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);

  let result =
    values.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (const value of values.slice(period)) {
    result =
      value * multiplier +
      result * (1 - multiplier);
  }

  return result;
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = values.length - period; i < values.length; i++) {
    const difference = values[i] - values[i - 1];

    if (difference > 0) {
      gains += difference;
    } else {
      losses -= difference;
    }
  }

  if (losses === 0) return 100;

  const averageGain = gains / period;
  const averageLoss = losses / period;

  const relativeStrength = averageGain / averageLoss;

  return 100 - 100 / (1 + relativeStrength);
}

// --------------------------------------------------
// MARKET ANALYSIS
// --------------------------------------------------

function analyse(epic, data) {
  const rows = (data.prices || [])
    .map(price => {
      const bid = price.closePrice?.bid;
      const ask = price.closePrice?.ask;

      const close =
        Number.isFinite(bid) && Number.isFinite(ask)
          ? (bid + ask) / 2
          : Number.isFinite(bid)
            ? bid
            : ask;

      return {
        time: price.snapshotTimeUTC || price.snapshotTime || '',
        bid,
        ask,
        close,
        high: price.highPrice?.bid ?? price.highPrice?.ask,
        low: price.lowPrice?.bid ?? price.lowPrice?.ask
      };
    })
    .filter(price => Number.isFinite(price.close));

  const closes = rows.map(row => row.close);
  const last = rows.at(-1);

  const fast = ema(closes, 9);
  const slow = ema(closes, 21);
  const strength = rsi(closes, 14);

  const name =
    data.instrument?.name ||
    data.instrument?.epic ||
    epic;

  if (
    !last ||
    fast === null ||
    slow === null ||
    strength === null
  ) {
    return {
      epic,
      name,
      direction: 'WAIT',
      reason: 'Waiting for sufficient historical candles',
      candlesReceived: rows.length,
      updatedAt: new Date().toISOString()
    };
  }

  let direction = 'WAIT';
  let reason = 'No qualifying setup';

  if (fast > slow && strength >= 52 && strength <= 68) {
    direction = 'LONG';
    reason = 'EMA 9 above EMA 21 and RSI in momentum band';
  } else if (fast < slow && strength <= 48 && strength >= 32) {
    direction = 'SHORT';
    reason = 'EMA 9 below EMA 21 and RSI in momentum band';
  }

  const recent = rows.slice(-15);

  const highs = recent
    .map(row => row.high)
    .filter(Number.isFinite);

  const lows = recent
    .map(row => row.low)
    .filter(Number.isFinite);

  const range =
    highs.length && lows.length
      ? (Math.max(...highs) - Math.min(...lows)) * 0.5
      : 0;

  const distance = Math.max(
    range,
    last.close * 0.0005
  );

  const entry =
    direction === 'LONG'
      ? last.ask
      : direction === 'SHORT'
        ? last.bid
        : null;

  const stop =
    direction === 'LONG' && Number.isFinite(entry)
      ? entry - distance
      : direction === 'SHORT' && Number.isFinite(entry)
        ? entry + distance
        : null;

  const target =
    direction === 'LONG' && Number.isFinite(entry)
      ? entry + distance * 1.5
      : direction === 'SHORT' && Number.isFinite(entry)
        ? entry - distance * 1.5
        : null;

  return {
    epic,
    name,
    direction,
    reason,
    bid: last.bid,
    ask: last.ask,
    price: last.close,
    spread:
      Number.isFinite(last.ask) && Number.isFinite(last.bid)
        ? last.ask - last.bid
        : null,
    rsi: strength,
    ema9: fast,
    ema21: slow,
    candleTime: last.time,
    candlesReceived: rows.length,
    entry,
    stop,
    target,
    updatedAt: new Date().toISOString()
  };
}

// --------------------------------------------------
// MARKET SCANNER
// --------------------------------------------------

async function scan() {
  if (scanning || !configured() || !EPICS.length) return;

  scanning = true;

  try {
    for (const epic of EPICS) {
      try {
        // Historical prices by number of points.
        // IG requires API Version 2 for this endpoint.
        const data = await request(
          `/prices/${encodeURIComponent(epic)}/MINUTE_5/100`,
          '2'
        );

        const signal = analyse(epic, data);

        signal.status = 'ok';

        latest.set(epic, signal);

        if (signal.direction !== 'WAIT') {
          const eventKey = `${signal.direction}:${signal.candleTime}`;

          if (lastEvent.get(epic) !== eventKey) {
            lastEvent.set(epic, eventKey);

            events.unshift({
              ...signal,
              id: epic + eventKey
            });

            if (events.length > 100) {
              events.pop();
            }
          }
        }
      } catch (error) {
        latest.set(epic, {
          epic,
          direction: 'UNAVAILABLE',
          status: 'error',
          reason: error.message,
          updatedAt: new Date().toISOString()
        });

        lastError = error.message;
      }
    }
  } finally {
    scanning = false;
  }
}

// --------------------------------------------------
// DASHBOARD API ROUTES
// --------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    configured: configured(),
    accountType: TYPE,
    paperMode: TYPE === 'DEMO',
    liveOrdersEnabled: false,
    epics: EPICS.length,
    pollSeconds: POLL,
    lastError
  });
});

app.get('/api/state', (_req, res) => {
  res.json({
    configured: configured(),
    accountType: TYPE,
    paperMode: TYPE === 'DEMO',
    liveOrdersEnabled: false,
    epics: EPICS,

    signals: EPICS.map(epic =>
      latest.get(epic) || {
        epic,
        direction: 'LOADING',
        reason: 'Waiting for scan'
      }
    ),

    events: events.slice(0, 30),
    lastError
  });
});

// --------------------------------------------------
// IG CONNECTION TEST
// --------------------------------------------------

app.get('/api/ig/test', async (_req, res) => {
  try {
    await login();

    const accounts = await request('/accounts', '1');

    res.json({
      ok: true,
      authenticated: true,
      accountsReturned: (accounts.accounts || []).length,
      note: 'No orders placed.'
    });
  } catch (error) {
    lastError = error.message;

    res.status(502).json({
      ok: false,
      error: error.message
    });
  }
});

// --------------------------------------------------
// IG MARKET SEARCH
// --------------------------------------------------

app.get('/api/ig/search', async (req, res) => {
  try {
    const term = String(req.query.term || 'EUR/USD').slice(0, 60);

    const data = await request(
      `/markets?searchTerm=${encodeURIComponent(term)}`,
      '1'
    );

    res.json({
      ok: true,

      markets: (data.markets || [])
        .slice(0, 30)
        .map(market => ({
          epic: market.epic,
          name: market.instrumentName,
          type: market.instrumentType,
          expiry: market.expiry,
          status: market.marketStatus
        }))
    });
  } catch (error) {
    lastError = error.message;

    res.status(502).json({
      ok: false,
      error: error.message
    });
  }
});

// --------------------------------------------------
// MANUAL SCAN
// --------------------------------------------------

app.post('/api/scan', async (_req, res) => {
  await scan();

  res.json({
    ok: true,
    note: 'Scan requested; no orders placed.'
  });
});

// --------------------------------------------------
// DASHBOARD PAGE
// --------------------------------------------------

app.get('*', (_req, res) => {
  res.sendFile(
    path.join(dir, 'public', 'index.html')
  );
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(PORT, async () => {
  console.log(
    `MarketPulse IG ${TYPE} started on port ${PORT}.`
  );

  console.log('Automatic order execution is not enabled.');

  await scan();

  setInterval(scan, POLL * 1000);
});
import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
dotenv.config();
const app=express(), PORT=Number(process.env.PORT||3000);
const KEY=process.env.IG_API_KEY||'', USER=process.env.IG_USERNAME||'', PASS=process.env.IG_PASSWORD||'';
const TYPE=(process.env.IG_ACCOUNT_TYPE||'DEMO').toUpperCase();
const BASE=TYPE==='DEMO'?'https://demo-api.ig.com/gateway/deal':'https://api.ig.com/gateway/deal';
const POLL=Math.max(60,Number(process.env.POLL_SECONDS||60));
const EPICS=(process.env.IG_EPICS||'').split(',').map(s=>s.trim()).filter(Boolean);
const dir=path.dirname(fileURLToPath(import.meta.url)); app.use(express.static(path.join(dir,'public'))); app.use(express.json());
let session=null,lastError=null,scanning=false; const latest=new Map(), events=[], lastEvent=new Map();
const configured=()=>Boolean(KEY&&USER&&PASS);
async function login(){if(!configured())throw Error('Add IG_API_KEY, IG_USERNAME and IG_PASSWORD in Render environment settings.');const r=await fetch(`${BASE}/session`,{method:'POST',headers:{'X-IG-API-KEY':KEY,'Content-Type':'application/json; charset=UTF-8','Accept':'application/json','Version':'2'},body:JSON.stringify({identifier:USER,password:PASS}),signal:AbortSignal.timeout(15000)});const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{}if(!r.ok)throw Error(d.errorCode||`IG login failed (${r.status})`);const cst=r.headers.get('CST'),sec=r.headers.get('X-SECURITY-TOKEN');if(!cst||!sec)throw Error('IG login response did not include expected session tokens.');session={cst,sec,expires:Date.now()+4*60*60*1000};return d;}
async function request(endpoint,version='1'){if(!session||Date.now()>session.expires-60000)await login();const r=await fetch(BASE+endpoint,{headers:{'X-IG-API-KEY':KEY,'CST':session.cst,'X-SECURITY-TOKEN':session.sec,'Version':version,'Accept':'application/json'},signal:AbortSignal.timeout(15000)});const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{}if(!r.ok)throw Error(d.errorCode||`IG API HTTP ${r.status}`);return d;}
const ema=(v,n)=>{if(v.length<n)return null;const k=2/(n+1);let x=v.slice(0,n).reduce((a,b)=>a+b,0)/n;for(const a of v.slice(n))x=a*k+x*(1-k);return x;};
function rsi(v,n=14){if(v.length<n+1)return null;let g=0,l=0;for(let i=v.length-n;i<v.length;i++){const d=v[i]-v[i-1];if(d>0)g+=d;else l-=d;}if(!l)return 100;return 100-100/(1+(g/n)/(l/n));}
function analyse(epic,d){const rows=(d.prices||[]).map(p=>{const bid=p.closePrice?.bid,ask=p.closePrice?.ask;return {time:p.snapshotTimeUTC||p.snapshotTime||'',bid,ask,close:Number.isFinite(bid)&&Number.isFinite(ask)?(bid+ask)/2:(bid??ask),high:p.highPrice?.bid??p.highPrice?.ask,low:p.lowPrice?.bid??p.lowPrice?.ask};}).filter(p=>Number.isFinite(p.close));const c=rows.map(x=>x.close),last=rows.at(-1),fast=ema(c,9),slow=ema(c,21),strength=rsi(c);const name=d.instrument?.name||d.instrument?.epic||epic;if(!last||fast===null||slow===null||strength===null)return {epic,name,direction:'WAIT',reason:'Waiting for sufficient historical candles',updatedAt:new Date().toISOString()};let direction='WAIT',reason='No qualifying setup';if(fast>slow&&strength>=52&&strength<=68){direction='LONG';reason='EMA 9 above EMA 21 and RSI in momentum band';}else if(fast<slow&&strength<=48&&strength>=32){direction='SHORT';reason='EMA 9 below EMA 21 and RSI in momentum band';}const recent=rows.slice(-15),hi=recent.map(x=>x.high).filter(Number.isFinite),lo=recent.map(x=>x.low).filter(Number.isFinite),dist=Math.max(hi.length&&lo.length?(Math.max(...hi)-Math.min(...lo))*.5:0,last.close*.0005);return {epic,name,direction,reason,bid:last.bid,ask:last.ask,price:last.close,spread:last.ask!=null&&last.bid!=null?last.ask-last.bid:null,rsi:strength,ema9:fast,ema21:slow,candleTime:last.time,entry:direction==='LONG'?last.ask:direction==='SHORT'?last.bid:null,stop:direction==='LONG'?last.ask-dist:direction==='SHORT'?last.bid+dist:null,target:direction==='LONG'?last.ask+dist*1.5:direction==='SHORT'?last.bid-dist*1.5:null,updatedAt:new Date().toISOString()};}
async function scan(){if(scanning||!configured()||!EPICS.length)return;scanning=true;try{for(const epic of EPICS){try{const d=await request(`/prices/${encodeURIComponent(epic)}/MINUTE_5/100`,'3'),s=analyse(epic,d);s.status='ok';latest.set(epic,s);if(s.direction!=='WAIT'){const k=`${s.direction}:${s.candleTime}`;if(lastEvent.get(epic)!==k){lastEvent.set(epic,k);events.unshift({...s,id:epic+k});if(events.length>100)events.pop();}}}catch(e){latest.set(epic,{epic,direction:'UNAVAILABLE',status:'error',reason:e.message});lastError=e.message;}}}finally{scanning=false;}}
app.get('/api/health',(_q,res)=>res.json({ok:true,configured:configured(),accountType:TYPE,paperMode:true,liveOrdersEnabled:false,epics:EPICS.length,pollSeconds:POLL,lastError}));
app.get('/api/state',(_q,res)=>res.json({configured:configured(),accountType:TYPE,paperMode:true,liveOrdersEnabled:false,epics:EPICS,signals:EPICS.map(e=>latest.get(e)||({epic:e,direction:'LOADING',reason:'Waiting for scan'})),events:events.slice(0,30),lastError}));
app.get('/api/ig/test',async(_q,res)=>{try{await login();const a=await request('/accounts','1');res.json({ok:true,authenticated:true,accountsReturned:(a.accounts||[]).length,note:'No orders placed.'});}catch(e){lastError=e.message;res.status(502).json({ok:false,error:e.message});}});
app.get('/api/ig/search',async(req,res)=>{try{const term=String(req.query.term||'EUR/USD').slice(0,60),d=await request(`/markets?searchTerm=${encodeURIComponent(term)}`,'1');res.json({ok:true,markets:(d.markets||[]).slice(0,30).map(m=>({epic:m.epic,name:m.instrumentName,type:m.instrumentType,expiry:m.expiry,status:m.marketStatus}))});}catch(e){lastError=e.message;res.status(502).json({ok:false,error:e.message});}});
app.post('/api/scan',async(_q,res)=>{await scan();res.json({ok:true,note:'Scan requested; no orders placed.'});});app.get('*',(_q,res)=>res.sendFile(path.join(dir,'public','index.html')));
app.listen(PORT,async()=>{console.log(`MarketPulse IG Demo on ${PORT}; no order endpoints enabled`);await scan();setInterval(scan,POLL*1000);});
