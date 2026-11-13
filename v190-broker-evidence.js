'use strict';
// v190: IG DEMO read-only evidence capture + fenced operator-intent preparation.
// Deliberately has no broker POST/PUT/DELETE capability.
const crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const stable=x=>Array.isArray(x)?'['+x.map(stable).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}':JSON.stringify(x);
const hash=x=>crypto.createHash('sha256').update(stable(x)).digest('hex');
const DDL=`CREATE TABLE IF NOT EXISTS mp_v190_observations (id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), observed_at TIMESTAMPTZ NOT NULL, epic TEXT NOT NULL, payload JSONB NOT NULL, digest TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mp_v190_intents (id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), epic TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('PREPARED','CANCELLED','UNKNOWN')), fingerprint TEXT NOT NULL UNIQUE, details JSONB NOT NULL, fence BIGINT NOT NULL);`;
const redactAccount=a=>({currency:a?.currency||null,accountType:a?.accountType||null,balance:a?.balance?{balance:a.balance.balance,deposit:a.balance.deposit,profitLoss:a.balance.profitLoss,available:a.balance.available}:null});
function riskPreview(x={}){
 const reasons=[];
 if(x.epic!==EPIC)reasons.push('WRONG_EPIC');
 for(const k of ['dealSize','minimumDealSize','dealSizeStep','pipSize','usdPerPipPerDealUnit','gbpPerUsd','stopPips'])if(typeof x[k]!=='number'||!Number.isFinite(x[k])||x[k]<=0)reasons.push('INVALID_'+k);
 if(!reasons.length){
  if(x.stopPips!==12)reasons.push('POLICY_STOP_MISMATCH');
  if(x.dealSize<x.minimumDealSize-1e-9)reasons.push('BELOW_MINIMUM');
  const steps=(x.dealSize-x.minimumDealSize)/x.dealSizeStep;
  if(Math.abs(steps-Math.round(steps))>1e-7)reasons.push('INVALID_SIZE_STEP');
 }
 const perPipGBP=reasons.length?null:x.dealSize*x.usdPerPipPerDealUnit*x.gbpPerUsd;
 const stopRiskGBP=perPipGBP===null?null:perPipGBP*x.stopPips;
 if(stopRiskGBP!==null&&stopRiskGBP>25)reasons.push('RISK_ABOVE_25_GBP');
 if(!x.contractDocumentRef||!x.fxSourceRef||!x.fxObservedAt)reasons.push('MISSING_INDEPENDENT_EVIDENCE');
 if(x.fxObservedAt&&(!Number.isFinite(Date.parse(x.fxObservedAt))||Math.abs(Date.now()-Date.parse(x.fxObservedAt))>60000))reasons.push('STALE_FX');
 return {validCandidate:reasons.length===0,reasons,perPipGBP,stopRiskGBP,feesAndSlippageIncluded:false,independentlyCertified:false,brokerOrderAllowed:false};
}
function createV190({requireAdmin,pool,readIG}={}){
 if(!pool||typeof readIG!=='function'||typeof requireAdmin!=='function')throw Error('V190_DEPENDENCIES_MISSING');
 let initialized=false,busy=false;
 async function init(){await pool.query(DDL);initialized=true;}
 async function ensure(){if(!initialized)await init();}
 // v191: read-only, independently diagnosed GET calls; transaction failures never masquerade as complete history.
 const safeError=e=>{const m=String(e?.message||e||'ERROR');const status=m.match(/\b(400|401|403|404|408|409|429|500|502|503|504)\b/);return {code:status?status[1]:'UPSTREAM_FAILURE'};};
 function historyPath(){
  const now=new Date();const to=now.toISOString().slice(0,10);
  const from=new Date(now.getTime()-86400000).toISOString().slice(0,10);
  return '/history/transactions?'+new URLSearchParams({type:'ALL',from,to,pageSize:'100',pageNumber:'1'}).toString();
 }
 async function collect(){await ensure();if(busy)throw Error('COLLECTOR_BUSY');busy=true;
  try{
   const endpoints=[['market','/markets/'+encodeURIComponent(EPIC),'3'],['positions','/positions','2'],['accounts','/accounts','1'],['transactions',historyPath(),'2']];
   const settled=await Promise.allSettled(endpoints.map(([,route,version])=>readIG(route,version)));
   const data={},checks={};
   settled.forEach((r,i)=>{const name=endpoints[i][0];if(r.status==='fulfilled'){data[name]=r.value;checks[name]={ok:true};}else{checks[name]={ok:false,...safeError(r.reason)};}});
   const market=data.market,positions=data.positions,accounts=data.accounts,transactions=data.transactions;
   if(checks.market.ok&&(!market?.instrument||market.instrument.epic!==EPIC)){checks.market={ok:false,code:'MARKET_SCHEMA_OR_EPIC'};}
   if(checks.positions.ok&&!Array.isArray(positions?.positions)){checks.positions={ok:false,code:'POSITIONS_SCHEMA'};}
   if(checks.accounts.ok&&!Array.isArray(accounts?.accounts)){checks.accounts={ok:false,code:'ACCOUNTS_SCHEMA'};}
   if(checks.transactions.ok&&!Array.isArray(transactions?.transactions)){checks.transactions={ok:false,code:'TRANSACTIONS_SCHEMA'};}
   const coreComplete=checks.market.ok&&checks.positions.ok&&checks.accounts.ok;
   const historyAvailable=checks.transactions.ok;
   if(!Object.values(checks).some(x=>x.ok))return {collected:false,reason:'ALL_IG_READS_FAILED',checks,brokerOrderAllowed:false};
   const rows=historyAvailable?transactions.transactions:[];
   const observation={epic:EPIC,observedAt:new Date().toISOString(),checks,coreComplete,historyAvailable,historyComplete:false,historyReason:historyAvailable?'FIRST_PAGE_ONLY_NOT_RECONCILED':'HISTORY_UNAVAILABLE',
    market:checks.market.ok?{instrument:{epic:market.instrument.epic,currencies:market.instrument.currencies,lotSize:market.instrument.lotSize,contractSize:market.instrument.contractSize,valueOfOnePip:market.instrument.valueOfOnePip,onePipMeans:market.instrument.onePipMeans},dealingRules:market.dealingRules,snapshot:{marketStatus:market.snapshot?.marketStatus,updateTime:market.snapshot?.updateTime,delayTime:market.snapshot?.delayTime,bid:market.snapshot?.bid,offer:market.snapshot?.offer}}:null,
    positions:checks.positions.ok?positions.positions.filter(p=>p.market?.epic===EPIC).map(p=>({market:{epic:p.market?.epic},position:{dealId:p.position?.dealId,direction:p.position?.direction,size:p.position?.size,stopLevel:p.position?.stopLevel,createdDate:p.position?.createdDate}})):null,
    accountCurrencies:checks.accounts.ok?accounts.accounts.map(a=>a.currency):null,accounts:checks.accounts.ok?accounts.accounts.map(redactAccount):null,
    transactionCount:historyAvailable?rows.length:null,transactions:historyAvailable?rows.slice(0,100).map(t=>({date:t.date,dateUtc:t.dateUtc,transactionType:t.transactionType,profitAndLoss:t.profitAndLoss,cashTransaction:t.cashTransaction,openLevel:t.openLevel,closeLevel:t.closeLevel,instrumentName:t.instrumentName,currency:t.currency})):null,
    historyTruncated:historyAvailable?(rows.length>=100):null};
   const id=crypto.randomUUID(),digest=hash(observation);
   await pool.query('INSERT INTO mp_v190_observations(id,observed_at,epic,payload,digest) VALUES($1,$2,$3,$4::jsonb,$5)',[id,observation.observedAt,EPIC,JSON.stringify(observation),digest]);
   return {collected:true,partial:!coreComplete||!historyAvailable,id,observedAt:observation.observedAt,digest,checks,coreComplete,historyAvailable,historyComplete:false,positionCount:observation.positions?.length??null,transactionCount:observation.transactionCount,historyTruncated:observation.historyTruncated,exchangeDelayCertified:false,gbpRiskCertified:false,accountingCertified:false,brokerOrderAllowed:false};
  }finally{busy=false;}
 }
 async function list(){await ensure();const r=await pool.query('SELECT id,created_at,observed_at,digest FROM mp_v190_observations ORDER BY created_at DESC LIMIT 30');return {records:r.rows,brokerOrderAllowed:false};}
 async function verify(id){await ensure();if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('INVALID_ID');const r=await pool.query('SELECT payload,digest FROM mp_v190_observations WHERE id=$1',[id]);if(!r.rows.length)return {found:false,verified:false};const {payload,digest}=r.rows[0];return {found:true,verified:hash(payload)===digest,brokerOrderAllowed:false};}
 // Durable operator intent preparation only: NO DEALING. DB transaction and advisory lock serialize preparation.
 async function prepare(x){await ensure();if(x?.confirm!=='PREPARE_NO_ORDER'||x?.epic!==EPIC||!['BUY','SELL'].includes(x.direction))throw Error('INVALID_OPERATOR_CONFIRMATION');
  const risk=riskPreview(x);if(!risk.validCandidate) return {prepared:false,risk,brokerOrderAllowed:false};
  const c=await pool.connect();try{await c.query('BEGIN');const lock=await c.query('SELECT pg_try_advisory_xact_lock($1) AS ok',[190001]);if(!lock.rows[0]?.ok)throw Error('PREPARATION_LOCK_BUSY');
   const active=await c.query("SELECT count(*)::int AS n FROM mp_v190_intents WHERE state IN ('PREPARED','UNKNOWN')");if(active.rows[0].n)throw Error('UNRESOLVED_INTENT_EXISTS');
   // Explicit sequence for monotonic fences, separate from UUID observation keys.
   await c.query('CREATE SEQUENCE IF NOT EXISTS mp_v190_fence_seq');const seq=await c.query('SELECT nextval(\'mp_v190_fence_seq\') AS n');
   const id=crypto.randomUUID(),fingerprint=hash({epic:EPIC,direction:x.direction,dealSize:x.dealSize,source:x.contractDocumentRef,fx:x.fxSourceRef,operatorNonce:x.operatorNonce||null});
   await c.query("INSERT INTO mp_v190_intents(id,epic,state,fingerprint,details,fence) VALUES($1,$2,'PREPARED',$3,$4::jsonb,$5)",[id,EPIC,fingerprint,JSON.stringify({direction:x.direction,risk,operatorNonce:x.operatorNonce||null}),seq.rows[0].n]);await c.query('COMMIT');return {prepared:true,id,fence:String(seq.rows[0].n),state:'PREPARED',submissionIntegrated:false,brokerOrderAllowed:false};
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async function cancel(id){await ensure();if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('INVALID_ID');const r=await pool.query("UPDATE mp_v190_intents SET state='CANCELLED' WHERE id=$1 AND state='PREPARED' RETURNING id",[id]);return {cancelled:r.rowCount===1,brokerOrderAllowed:false};}
 function status(){return {version:'191.0.0',mode:'READ_ONLY_FAIL_CLOSED',epic:EPIC,databaseInitialized:initialized,features:['IG_DEMO_GET_ONLY_CAPTURE','POSTGRES_OBSERVATION_STORAGE','OBSERVATION_HASH_VERIFICATION','RISK_CANDIDATE','FENCED_PREPARATION_ONLY','V191_HISTORY_V2_QUERY','V191_PARTIAL_OBSERVATIONS','V191_ENDPOINT_DIAGNOSTICS'],brokerWriteIntegration:false,brokerStopLifecycleCertified:false,unknownSubmissionRecoveryCertified:false,certificationsPassed:0,certificationsRequired:7,brokerOrderAllowed:false,readyForUnattendedDemo:false};}
 const wrap=f=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await f(req));}catch(e){res.status(409).json({error:String(e.message).slice(0,160),brokerOrderAllowed:false});}};
 function routes(app){app.get('/api/v191/status',requireAdmin,wrap(status));app.post('/api/v191/collect',requireAdmin,wrap(collect));app.get('/api/v191/observations',requireAdmin,wrap(list));app.get('/api/v191/observations/verify/:id',requireAdmin,wrap(req=>verify(req.params.id)));app.post('/api/v191/order/submit',requireAdmin,(_req,res)=>res.status(409).json({error:'BROKER_ORDER_HARD_BLOCKED_UNCERTIFIED',brokerOrderAllowed:false}));app.get('/api/v190/status',requireAdmin,wrap(status));app.post('/api/v190/collect',requireAdmin,wrap(collect));app.get('/api/v190/observations',requireAdmin,wrap(list));app.get('/api/v190/observations/verify/:id',requireAdmin,wrap(req=>verify(req.params.id)));app.post('/api/v190/risk/preview',requireAdmin,wrap(req=>riskPreview(req.body)));app.post('/api/v190/intent/prepare',requireAdmin,wrap(req=>prepare(req.body)));app.post('/api/v190/intent/cancel/:id',requireAdmin,wrap(req=>cancel(req.params.id)));app.post('/api/v190/order/submit',requireAdmin,(_req,res)=>res.status(409).json({error:'BROKER_ORDER_HARD_BLOCKED_UNCERTIFIED',brokerOrderAllowed:false}));}
 return {init,routes,status,collect,verify,prepare,cancel};
}
module.exports={createV190,riskPreview,EPIC};
