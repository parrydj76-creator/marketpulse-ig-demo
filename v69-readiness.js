'use strict';
// v69 is strictly observational: no order submission, approval or execution callback.
const crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const MAX_AGE=15000, MAX_SKEW=5000;
function evaluateQuote(q,now=Date.now()){
 const failures=[];
 if(!q||q.source!=='LIGHTSTREAMER'||q.epic!==EPIC)failures.push('MINI_STREAM_QUOTE_MISSING');
 const flag=String(q?.marketFlag??'').trim().toUpperCase();
 if(flag!=='DEAL')failures.push('MARKET_NOT_DEAL');
 const received=q?.receivedAt?Date.parse(q.receivedAt):NaN;
 const receiptAge=now-received;
 if(!Number.isFinite(receiptAge)||receiptAge<0||receiptAge>MAX_AGE)failures.push('RECEIPT_AGE_INVALID');
 const stamp=String(q?.igTimestamp??'').trim();
 const originMs=/^\d{13}$/.test(stamp)?Number(stamp):NaN;
 const originAge=now-originMs;
 if(!Number.isFinite(originAge)||originAge< -MAX_SKEW||originAge>MAX_AGE)failures.push('IG_TIMESTAMP_NOT_PLAUSIBLE');
 if(Number.isFinite(originMs)&&Number.isFinite(received)&&originMs>received+MAX_SKEW)failures.push('IG_TIMESTAMP_FUTURE_OF_RECEIPT');
 if(q?.delay===null||q?.delay===undefined||q?.delay==='')failures.push('STREAM_DELAY_FIELD_ABSENT');
 else if(Number(q.delay)!==0)failures.push('STREAM_DELAY_NOT_ZERO');
 const spread=Number(q?.spreadPips);
 if(!Number.isFinite(spread)||spread<0||spread>2.5)failures.push('SPREAD_INVALID');
 if(!(Number(q?.ask)>Number(q?.bid)&&Number(q?.bid)>0))failures.push('BID_ASK_INVALID');
 return {flag,receiptAgeMs:Number.isFinite(receiptAge)?receiptAge:null,igTimestampAgeMs:Number.isFinite(originAge)?originAge:null,delayRaw:q?.delay??null,spreadPips:q?.spreadPips??null,observedAt:new Date(now).toISOString(),passesObservableChecks:failures.length===0,exchangeOriginCertified:false,delayCertified:q?.delay!==null&&q?.delay!==undefined&&q?.delay!==''&&Number(q.delay)===0,failures};
}
function readiness(v68){const state=v68.status(),q=evaluateQuote(state.quote),paper=state.paper||{},reasons=[];
 if(!state.journalHealthy)reasons.push('JOURNAL_UNHEALTHY');
 if(state.emergencyHalt)reasons.push('EMERGENCY_HALT');
 if(!state.cycleScheduled)reasons.push('CYCLE_NOT_SCHEDULED');
 if(state.streamState!=='CONNECTED')reasons.push('STREAM_NOT_CONNECTED');
 if(!q.passesObservableChecks)reasons.push(...q.failures);
 if(!state.gbpSizingCertified)reasons.push('GBP_RISK_UNCERTIFIED');
 if(!state.brokerLifecycleCertified)reasons.push('REAL_BROKER_LIFECYCLE_UNTESTED');
 if(!state.crashRecoveryCertified)reasons.push('REAL_BROKER_CRASH_RECOVERY_UNTESTED');
 if(state.unresolvedBrokerIntents?.length)reasons.push('UNRESOLVED_BROKER_INTENTS');
 if(Number(paper.realizedTodayGBP)<=-100)reasons.push('DAILY_LOSS_LIMIT');
 if(Number(paper.tradesToday)>=3)reasons.push('DAILY_TRADE_LIMIT');
 return {version:'69.0.0',mode:'READ_ONLY_AUTONOMY_READINESS',at:new Date().toISOString(),stream:state.streamState,signal:state.signal,quoteDiagnostics:q,journalHealthy:state.journalHealthy,journalRecords:state.journalRecords,scheduledCycle:state.cycleScheduled,limits:state.limits,paper,certifications:{streamReceiptChecks:q.passesObservableChecks,exchangeOrigin:false,gbpSizing:false,supervisedOpenStopClose:false,brokerCrashRecovery:false,unattendedExecution:false},blockers:[...new Set(reasons)],brokerOrderAllowed:false,unattendedOrderAllowed:false};}
function createV69({v68,requireAdmin}){
 function routes(app){
  app.get('/api/v69/status',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(readiness(v68)));
  app.get('/api/v69/quote-diagnostics',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(evaluateQuote(v68.status().quote)));
  app.get('/api/v69/certification-matrix',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json({epic:EPIC,account:'IG DEMO ONLY',checks:[
   {id:'mini-stream',required:'confirmed non-delayed Mini stream with plausible source timestamp',status:'NOT_CERTIFIED'},
   {id:'gbp-risk',required:'independent per-size GBP pip-value and conversion proof',status:'NOT_CERTIFIED'},
   {id:'broker-lifecycle',required:'operator-approved DEMO open, protective stop and verified close',status:'NOT_CERTIFIED'},
   {id:'crash-recovery',required:'real broker unknown-submit restart and no duplicate order proof',status:'NOT_CERTIFIED'},
   {id:'unattended',required:'risk controls and independent supervised certification',status:'LOCKED'}],brokerOrderAllowed:false,unattendedOrderAllowed:false}));
  app.post('/api/v69/arm-unattended',requireAdmin,(_req,res)=>res.status(409).json({error:'UNATTENDED_EXECUTION_NOT_CERTIFIED',brokerOrderAllowed:false}));
 }
 return {routes,readiness:()=>readiness(v68)};
}
module.exports={createV69,evaluateQuote,readiness};
