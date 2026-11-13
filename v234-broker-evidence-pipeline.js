 'use strict';
// v228-v234: broker GET-only evidence acquisition and hard-blocked execution readiness.
// No broker-write callback exists in this module. Every API is admin-authenticated.
const crypto=require('node:crypto');
const {digest}=require('./v195-readiness-gate');
const {assessPlan}=require('./v227-execution-certification');
const EPIC='CS.D.EURUSD.MINI.IP';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CERTS=['historicalPaperAccounting','exchangeTimestampAndDelay','gbpPipValueAndDealSize','netDailyPnlAndFees','brokerStopLifecycle','unknownSubmissionRecovery','distributedExecutionLock'];
const DDL=`CREATE TABLE IF NOT EXISTS mp_v234_evidence(id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),kind TEXT NOT NULL,payload JSONB NOT NULL,digest TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS mp_v234_evidence_created ON mp_v234_evidence(created_at,id);
CREATE TABLE IF NOT EXISTS mp_v234_incidents(id UUID PRIMARY KEY,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),state TEXT NOT NULL CHECK(state IN ('QUARANTINED','REVIEWED')),reason TEXT NOT NULL,evidence_id UUID NOT NULL REFERENCES mp_v234_evidence(id));`;
function checkHistory(pages){
 const issues=[];let total=0;const seen=new Set();
 for(let i=0;i<pages.length;i++){
  const p=pages[i],tx=p?.transactions;
  if(!Array.isArray(tx)){issues.push('INVALID_PAGE_'+(i+1));continue;}
  for(const t of tx){const key=JSON.stringify([t?.dateUtc||t?.date,t?.reference,t?.transactionType,t?.instrumentName,t?.size,t?.profitAndLoss]);if(seen.has(key))issues.push('DUPLICATE_TRANSACTION');seen.add(key);total++;}
 }
 return {pages:pages.length,transactions:total,uniqueTransactions:seen.size,issues:[...new Set(issues)],completeForAccounting:false,independentlyCertified:false};
}
function createV234({pool,requireAdmin,readIG,v227}={}){
 if(!pool||typeof requireAdmin!=='function'||typeof readIG!=='function'||!v227)throw Error('V234_DEPENDENCIES_MISSING');
 let initialized=false;
 async function init(){await pool.query(DDL);initialized=true;}
 async function ensure(){if(!initialized)await init();}
 async function store(kind,fields){await ensure();const id=crypto.randomUUID();const payload={kind,at:new Date().toISOString(),...fields,brokerOrderAllowed:false};const hash=digest(payload);await pool.query('INSERT INTO mp_v234_evidence(id,kind,payload,digest) VALUES($1,$2,$3::jsonb,$4)',[id,kind,JSON.stringify(payload),hash]);return {id,digest:hash,...payload};}
 async function audit(){await ensure();const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const count=Number((await c.query('SELECT count(*)::bigint n FROM mp_v234_evidence')).rows[0].n);if(!Number.isSafeInteger(count)||count>100000){await c.query('ROLLBACK');return {verified:false,fullHistory:false,reason:'AUDIT_LIMIT_EXCEEDED',brokerOrderAllowed:false};}const q=await c.query('SELECT id,payload,digest FROM mp_v234_evidence ORDER BY created_at,id');const failures=q.rows.filter(r=>digest(r.payload)!==r.digest).map(r=>r.id);await c.query('COMMIT');return {verified:!failures.length,fullHistory:true,checked:q.rowCount,failures,scope:'mp_v234_evidence_ONLY',brokerOrderAllowed:false};}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async function verify(id){await ensure();if(!UUID.test(id))return {found:false,verified:false,brokerOrderAllowed:false};const q=await pool.query('SELECT payload,digest FROM mp_v234_evidence WHERE id=$1',[id]);return {found:q.rowCount===1,verified:q.rowCount===1&&digest(q.rows[0].payload)===q.rows[0].digest,brokerOrderAllowed:false};}
 async function brokerFacts(){const checks={};for(const [name,path,version] of [['market','/markets/'+encodeURIComponent(EPIC),'3'],['positions','/positions','2'],['accounts','/accounts','1']]){try{const r=await readIG(path,version);if(name==='market')checks.market={ok:!!r?.snapshot,marketStatus:r?.snapshot?.marketStatus||null,rawBrokerTime:r?.snapshot?.updateTime||null,exchangeTimestampCertified:false,contractDetailsIndependentlyVerified:false};if(name==='positions'){const a=r?.positions;checks.positions={ok:Array.isArray(a),miniPositions:Array.isArray(a)?a.filter(x=>x.market?.epic===EPIC).length:null};}if(name==='accounts'){const a=r?.accounts;checks.accounts={ok:Array.isArray(a),gbpAccounts:Array.isArray(a)?a.filter(x=>x.currency==='GBP').length:null};}}catch(e){checks[name]={ok:false,error:String(e.message).slice(0,120)};}}return checks;}
 async function snapshot(){const checks=await brokerFacts();return store('BROKER_FACTS',{checks,complete:Object.values(checks).every(x=>x.ok),independentlyCertified:false});}
 async function history(b){
  if(b.confirm!=='READ_ONLY_HISTORY')throw Error('READ_ONLY_CONFIRMATION_REQUIRED');
  const date=/^\d{4}-\d{2}-\d{2}$/;
  if(!date.test(b.from||'')||!date.test(b.to||'')||b.from>b.to)throw Error('INVALID_DATE_RANGE');
  const days=(Date.parse(b.to+'T00:00:00Z')-Date.parse(b.from+'T00:00:00Z'))/86400000;
  if(!Number.isFinite(days)||days>7)throw Error('MAX_SEVEN_DAY_WINDOW');
  const pages=[];let reportedPages=null;let apiPaginationComplete=false;let error=null;
  for(let n=1;n<=10;n++){
   const path='/history/transactions?type=ALL&from='+b.from+'&to='+b.to+'&pageSize=100&pageNumber='+n;
   let r;try{r=await readIG(path,'2');}catch(e){error='IG_HISTORY_FETCH_FAILED: '+String(e.message).slice(0,100);break;}
   if(!Array.isArray(r?.transactions)){error='UNEXPECTED_HISTORY_SCHEMA';break;}
   pages.push({transactions:r.transactions});
   const meta=r.metadata?.pageData||{};
   if(Number.isInteger(meta.totalPages)&&meta.totalPages>=0)reportedPages=meta.totalPages;
   if(reportedPages!==null&&n>=Math.max(1,reportedPages)){apiPaginationComplete=true;break;}
   if(r.transactions.length===0){apiPaginationComplete=true;break;}
   // A short page alone is not enough to prove completeness when metadata is missing.
  }
  if(!apiPaginationComplete&&!error)error='PAGINATION_CAP_OR_UNPROVEN_END';
  const checked=checkHistory(pages);
  const result={from:b.from,to:b.to,checked,apiPaginationComplete,error,historyCompleteForAccounting:false,feesReconciled:false,independentlyCertified:false};
  // Preserve evidence of page counts and checks, not potentially sensitive transaction rows.
  return store('IG_HISTORY_DIAGNOSTIC',result);
 }
 async function risk(b){if(b.confirm!=='PREVIEW_ONLY_NO_ORDER')throw Error('PREVIEW_CONFIRMATION_REQUIRED');const result=assessPlan(b);return store('GBP_RISK_UNCERTIFIED_PREVIEW',{result,brokerContractGBPPerPipVerified:false,feesVerified:false});}
 async function quarantine(b){if(b.confirm!=='QUARANTINE_NO_ORDER'||typeof b.reason!=='string'||b.reason.trim().length<8)throw Error('QUARANTINE_CONFIRMATION_REQUIRED');const ev=await store('UNKNOWN_SUBMISSION_QUARANTINE',{reason:b.reason.slice(0,300),doNotResubmit:true,actualBrokerUnknownSubmissionTested:false});const id=crypto.randomUUID();await pool.query("INSERT INTO mp_v234_incidents(id,state,reason,evidence_id) VALUES($1,'QUARANTINED',$2,$3)",[id,b.reason.slice(0,300),ev.id]);return {id,evidenceId:ev.id,state:'QUARANTINED',doNotResubmit:true,brokerOrderAllowed:false};}
 async function incidents(){await ensure();const q=await pool.query('SELECT id,created_at,state,reason,evidence_id FROM mp_v234_incidents ORDER BY created_at DESC LIMIT 100');return {incidents:q.rows,brokerOrderAllowed:false};}
 async function readiness(){const [own,prior,inc]=await Promise.all([audit(),v227.readiness(),pool.query("SELECT count(*)::int n FROM mp_v234_incidents WHERE state='QUARANTINED'")]);return {version:'234.0.0',mode:'BROKER_READ_ONLY_CERTIFICATION_PIPELINE',audit:own,priorAudit:prior.audit,quarantinedIncidents:inc.rows[0].n,certifications:Object.fromEntries(CERTS.map(x=>[x,{independentlyCertified:false}])),certificationsPassed:0,certificationsRequired:7,blockers:['GBP_PIP_VALUE_AND_FEES_UNVERIFIED','COMPLETE_TRANSACTION_ACCOUNTING_NOT_CERTIFIED','EXCHANGE_TIMESTAMP_UNVERIFIED','ACTUAL_STOP_LIFECYCLE_UNTESTED','UNKNOWN_BROKER_SUBMISSION_RECOVERY_UNTESTED','BROKER_INTEGRATED_FENCING_UNTESTED','NO_CERTIFIED_BROKER_WRITE_ADAPTER',...(!own.verified?['EVIDENCE_INTEGRITY_FAILURE']:[]),...(inc.rows[0].n?['QUARANTINED_INCIDENTS']:[])],brokerWriteIntegration:false,brokerOrderAllowed:false,readyForControlledDemo:false,readyForUnattendedDemo:false};}
 const status=()=>({version:'234.0.0',versionsIncluded:['228','229','230','231','232','233','234'],databaseInitialized:initialized,mode:'GET_ONLY_BROKER_EVIDENCE_PIPELINE',epic:EPIC,brokerWriteIntegration:false,brokerOrderAllowed:false,readyForUnattendedDemo:false});
 const wrap=fn=>(req,res)=>Promise.resolve().then(()=>fn(req.body||{},req)).then(v=>res.set('Cache-Control','no-store').json(v)).catch(e=>res.status(409).json({error:String(e.message).slice(0,180),brokerOrderAllowed:false}));
 function routes(app){app.get('/api/v234/status',requireAdmin,wrap(status));app.get('/api/v234/readiness',requireAdmin,wrap(readiness));app.get('/api/v234/audit',requireAdmin,wrap(audit));app.get('/api/v234/evidence/:id/verify',requireAdmin,wrap((_b,req)=>verify(req.params.id)));app.get('/api/v234/incidents',requireAdmin,wrap(incidents));app.post('/api/v234/broker/snapshot',requireAdmin,wrap(snapshot));app.post('/api/v234/history/diagnostic',requireAdmin,wrap(history));app.post('/api/v234/risk/preview',requireAdmin,wrap(risk));app.post('/api/v234/recovery/quarantine',requireAdmin,wrap(quarantine));for(const p of ['/api/v234/order/submit','/api/v234/trading/arm','/api/v234/trading/auto-start'])app.post(p,requireAdmin,(_req,res)=>res.status(409).json({error:'BROKER_WRITE_HARD_BLOCKED_UNCERTIFIED',brokerOrderAllowed:false}));}
 return {init,routes,status,readiness,audit,verify,history,risk};
}
module.exports={createV234,checkHistory};
