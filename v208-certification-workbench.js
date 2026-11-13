'use strict';
// v205-v208: evidence collection, deterministic checks, human review. IG GET only.
const crypto=require('node:crypto');
const {digest,CATEGORIES}=require('./v195-readiness-gate');
const {riskPreview,EPIC}=require('./v203-combined-readiness');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX=100000;
const DDL=`CREATE TABLE IF NOT EXISTS mp_v208_cert_evidence(id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), kind TEXT NOT NULL, category TEXT, payload JSONB NOT NULL, digest TEXT NOT NULL, hash_version TEXT NOT NULL DEFAULT 'CANONICAL_JSON_V2'); CREATE INDEX IF NOT EXISTS mp_v208_cert_evidence_created_idx ON mp_v208_cert_evidence(created_at DESC);`;
function validNumber(n){return typeof n==='number'&&Number.isFinite(n)}
function accountingCheck(x={}){
 const failures=[];
 if(!Array.isArray(x.transactions)||!x.transactions.length)failures.push('NO_TRANSACTIONS');
 if(!validNumber(x.brokerNetGBP))failures.push('BROKER_NET_MISSING');
 if(!validNumber(x.openingBalanceGBP)||!validNumber(x.closingBalanceGBP))failures.push('BALANCE_EVIDENCE_MISSING');
 if(!validNumber(x.cashFlowsGBP))failures.push('CASH_FLOW_EVIDENCE_MISSING');
 let sum=null,delta=null;
 if(Array.isArray(x.transactions)&&x.transactions.length&&x.transactions.every(t=>validNumber(t.netGBP)&&typeof t.id==='string'&&t.id.length>0)){
  const ids=x.transactions.map(t=>t.id);
  if(new Set(ids).size!==ids.length)failures.push('DUPLICATE_TRANSACTION_IDS');
  sum=Number(x.transactions.reduce((a,t)=>a+t.netGBP,0).toFixed(2));
 }else failures.push('INVALID_TRANSACTION_ROWS');
 if(sum!==null&&validNumber(x.brokerNetGBP)&&Math.abs(sum-x.brokerNetGBP)>0.01)failures.push('NET_MISMATCH');
 if([x.openingBalanceGBP,x.closingBalanceGBP,x.cashFlowsGBP].every(validNumber)){
  delta=Number((x.closingBalanceGBP-x.openingBalanceGBP-x.cashFlowsGBP).toFixed(2));
  if(validNumber(x.brokerNetGBP)&&Math.abs(delta-x.brokerNetGBP)>0.01)failures.push('BALANCE_MISMATCH');
 }
 if(x.paginationComplete!==true)failures.push('PAGINATION_NOT_PROVEN');
 if(x.feesComplete!==true)failures.push('FEES_NOT_PROVEN');
 if(x.currency!=='GBP')failures.push('CURRENCY_NOT_GBP');
 if(!x.sourceRef||!x.statementRef)failures.push('INDEPENDENT_STATEMENT_REQUIRED');
 return {arithmeticConsistent:failures.length===0,failures,transactionNetGBP:sum,balanceNetGBP:delta,independentlyCertified:false,brokerOrderAllowed:false};
}
function timestampCheck(x={}){
 const failures=[];
 if(!x.exchangeTimestamp||!Number.isFinite(Date.parse(x.exchangeTimestamp)))failures.push('EXCHANGE_TIMESTAMP_MISSING');
 if(!x.receivedAt||!Number.isFinite(Date.parse(x.receivedAt)))failures.push('RECEIVE_TIMESTAMP_MISSING');
 let ageMs=null;
 if(!failures.length){ageMs=Date.parse(x.receivedAt)-Date.parse(x.exchangeTimestamp);if(ageMs<0||ageMs>15000)failures.push('QUOTE_DELAY_OUT_OF_RANGE');}
 if(x.exchangeTimestampAuthenticated!==true)failures.push('UNAUTHENTICATED_EXCHANGE_TIMESTAMP');
 if(x.streamSequenceVerified!==true)failures.push('STREAM_SEQUENCE_NOT_VERIFIED');
 if(!x.sourceRef)failures.push('SOURCE_EVIDENCE_REQUIRED');
 return {candidateValid:failures.length===0,failures,ageMs,independentlyCertified:false,brokerOrderAllowed:false};
}
function lifecycleCheck(x={}){
 const failures=[];
 for(const k of ['dealReference','dealId','openingConfirmationRef','stopConfirmationRef','closingConfirmationRef','brokerStatementRef'])if(typeof x[k]!=='string'||x[k].length<4)failures.push('MISSING_'+k);
 if(x.accountType!=='DEMO')failures.push('DEMO_ONLY');
 if(x.epic!==EPIC)failures.push('WRONG_EPIC');
 if(x.stopVerifiedAtBroker!==true)failures.push('STOP_NOT_VERIFIED');
 if(x.closedAndReconciled!==true)failures.push('CLOSE_NOT_RECONCILED');
 if(x.operatorApproved!==true)failures.push('OPERATOR_APPROVAL_REQUIRED');
 return {candidateValid:failures.length===0,failures,independentlyCertified:false,brokerOrderAllowed:false};
}
function recoveryCheck(x={}){
 const failures=[];
 if(x.crashAfterSendTested!==true)failures.push('CRASH_AFTER_SEND_NOT_TESTED');
 if(x.unknownOutcomeResolvedAgainstBroker!==true)failures.push('UNKNOWN_OUTCOME_NOT_RECONCILED');
 if(x.noDuplicateOrderProven!==true)failures.push('DUPLICATE_ORDER_PROOF_MISSING');
 if(x.postRestartReconciliationVerified!==true)failures.push('RESTART_RECONCILIATION_MISSING');
 if(x.fencingEnforcedAtBrokerSubmit!==true)failures.push('BROKER_SUBMISSION_FENCING_NOT_PROVEN');
 if(!x.testReportRef||!x.brokerEvidenceRef)failures.push('EVIDENCE_REQUIRED');
 return {candidateValid:failures.length===0,failures,independentlyCertified:false,brokerOrderAllowed:false};
}
function createV208({pool,requireAdmin,readIG,v203}={}){
 if(!pool||typeof requireAdmin!=='function'||typeof readIG!=='function'||!v203)throw Error('V208_DEPENDENCIES_MISSING');
 let initialized=false;
 async function init(){await pool.query(DDL);initialized=true;}
 async function ensure(){if(!initialized)await init();}
 async function save(kind,category,payload){await ensure();const id=crypto.randomUUID(),hash=digest(payload);await pool.query('INSERT INTO mp_v208_cert_evidence(id,kind,category,payload,digest) VALUES($1,$2,$3,$4::jsonb,$5)',[id,kind,category,JSON.stringify(payload),hash]);return {id,kind,category,digest:hash,...payload};}
 async function verify(id){await ensure();if(!UUID.test(id||''))throw Error('INVALID_UUID');const q=await pool.query('SELECT payload,digest,hash_version FROM mp_v208_cert_evidence WHERE id=$1',[id]);if(!q.rowCount)return {found:false,verified:false,brokerOrderAllowed:false};const r=q.rows[0];return {found:true,verified:r.hash_version==='CANONICAL_JSON_V2'&&digest(r.payload)===r.digest,brokerOrderAllowed:false};}
 async function audit(){await ensure();const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const q=await c.query('SELECT count(*)::bigint AS n FROM mp_v208_cert_evidence');const count=Number(q.rows[0].n);if(!Number.isSafeInteger(count)||count>MAX){await c.query('ROLLBACK');return {verified:false,fullHistory:false,reason:'ROW_LIMIT_EXCEEDED',count,brokerOrderAllowed:false};}const rows=await c.query('SELECT id,payload,digest,hash_version FROM mp_v208_cert_evidence ORDER BY created_at,id');const failures=rows.rows.filter(r=>r.hash_version!=='CANONICAL_JSON_V2'||digest(r.payload)!==r.digest).map(r=>r.id);await c.query('COMMIT');return {verified:failures.length===0,fullHistory:true,checked:rows.rowCount,failures,scope:'mp_v208_cert_evidence_ONLY',brokerOrderAllowed:false};}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async function check(kind,x){const map={ACCOUNTING:accountingCheck,TIMESTAMP:timestampCheck,RISK:riskPreview,LIFECYCLE:lifecycleCheck,RECOVERY:recoveryCheck};if(!map[kind])throw Error('UNKNOWN_CHECK');if(x?.confirm!=='EVIDENCE_ONLY_NO_ORDER')throw Error('CONFIRM_EVIDENCE_ONLY');const result=map[kind](x);const category={ACCOUNTING:'netDailyPnlAndFees',TIMESTAMP:'exchangeTimestampAndDelay',RISK:'gbpPipValueAndDealSize',LIFECYCLE:'brokerStopLifecycle',RECOVERY:'unknownSubmissionRecovery'}[kind];return save('CHECK_'+kind,category,{at:new Date().toISOString(),input:x,result,independentlyCertified:false,brokerOrderAllowed:false});}
 async function brokerEvidence(){const endpoints=[['market','/markets/'+encodeURIComponent(EPIC),'3'],['positions','/positions','2'],['accounts','/accounts','1']];const checks={};for(const [name,route,version] of endpoints){try{const d=await readIG(route,version);checks[name]={ok:name==='market'?!!d?.snapshot:name==='positions'?Array.isArray(d?.positions):Array.isArray(d?.accounts)};if(name==='market')checks[name].brokerTime=d?.snapshot?.updateTime||null;if(name==='positions')checks[name].miniPositions=(d?.positions||[]).filter(p=>p?.market?.epic===EPIC).length;if(name==='accounts')checks[name].currencies=(d?.accounts||[]).map(a=>a.currency);}catch(e){checks[name]={ok:false,error:String(e.message).slice(0,120)};}}return save('BROKER_GET_SNAPSHOT',null,{at:new Date().toISOString(),epic:EPIC,checks,complete:Object.values(checks).every(c=>c.ok),independentlyCertified:false,brokerOrderAllowed:false});}
 async function readiness(){const [own,prior]=await Promise.all([audit(),v203.readiness()]);const q=await pool.query('SELECT kind,category,payload,created_at FROM mp_v208_cert_evidence ORDER BY created_at DESC LIMIT 200');const latest=Object.fromEntries(CATEGORIES.map(k=>[k,{independentlyCertified:false,evidenceChecks:q.rows.filter(r=>r.category===k).length,latestCheck:q.rows.find(r=>r.category===k)?.kind||null}]));return {version:'208.0.0',mode:'EVIDENCE_AND_CERTIFICATION_WORKBENCH',audit:own,priorAudit:prior.audit,certifications:latest,certificationsPassed:0,certificationsRequired:7,blockers:[...new Set([...(prior.blockers||[]),...(!own.verified?['V208_EVIDENCE_INTEGRITY_FAILED']:[]),'INDEPENDENT_BROKER_CERTIFICATION_REQUIRED','NO_CERTIFIED_BROKER_EXECUTION_ADAPTER'])],brokerWriteIntegration:false,brokerOrderAllowed:false,readyForUnattendedDemo:false};}
 function status(){return {version:'208.0.0',versionsIncluded:['205','206','207','208'],mode:'GET_ONLY_CERTIFICATION_WORKBENCH',databaseInitialized:initialized,epic:EPIC,features:['GBP_RISK_PREVIEW','ACCOUNTING_RECONCILIATION_CHECK','EXCHANGE_TIMESTAMP_CHECK','BROKER_STOP_LIFECYCLE_EVIDENCE_CHECK','UNKNOWN_SUBMISSION_RECOVERY_EVIDENCE_CHECK','PERSISTENT_CANONICAL_EVIDENCE_AUDIT','READ_ONLY_IG_SNAPSHOT'],certificationsPassed:0,certificationsRequired:7,brokerWriteIntegration:false,brokerOrderAllowed:false,readyForUnattendedDemo:false};}
 const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req.body||{},req));}catch(e){res.status(409).json({error:String(e.message).slice(0,180),brokerOrderAllowed:false});}};
 function routes(app){app.get('/api/v208/status',requireAdmin,wrap(status));app.get('/api/v208/readiness',requireAdmin,wrap(readiness));app.get('/api/v208/audit',requireAdmin,wrap(audit));app.get('/api/v208/evidence/:id/verify',requireAdmin,wrap((_x,req)=>verify(req.params.id)));app.post('/api/v208/check/:kind',requireAdmin,wrap((x,req)=>check(req.params.kind,x)));app.post('/api/v208/broker/snapshot',requireAdmin,wrap(brokerEvidence));app.post('/api/v208/order/submit',requireAdmin,(_req,res)=>res.status(409).json({error:'V208_BROKER_ORDER_HARD_BLOCKED',brokerOrderAllowed:false}));}
 return {init,routes,status,readiness,audit,verify,check,brokerEvidence};
}
module.exports={createV208,accountingCheck,timestampCheck,lifecycleCheck,recoveryCheck};
