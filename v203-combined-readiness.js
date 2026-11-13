 'use strict';
// v199-v203 consolidated certification evidence and shadow-trade workbench.
// IG GET ONLY. No broker POST/PUT/DELETE. Never auto-certifies external evidence.
const crypto=require('node:crypto');
const {digest,CATEGORIES}=require('./v195-readiness-gate');
const EPIC='CS.D.EURUSD.MINI.IP';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX=100000;
const DDL=`CREATE TABLE IF NOT EXISTS mp_v203_evidence (id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), kind TEXT NOT NULL CHECK(kind IN ('SHADOW_PLAN','BROKER_RECONCILIATION','CERTIFICATION_REVIEW','RESTART_CHALLENGE')), payload JSONB NOT NULL, digest TEXT NOT NULL, hash_version TEXT NOT NULL DEFAULT 'CANONICAL_JSON_V2'); CREATE INDEX IF NOT EXISTS mp_v203_evidence_created_idx ON mp_v203_evidence(created_at DESC);`;
const round=(v,n=5)=>Number(v.toFixed(n));
function finite(x){return typeof x==='number'&&Number.isFinite(x)}
function riskPreview(x={}){
 const reasons=[];
 if(x.epic!==EPIC)reasons.push('WRONG_EPIC');
 for(const k of ['dealSize','gbpPerPipPerDealUnit','stopPips','spreadPips','slippagePips','feesGBP','accountBalanceGBP'])if(!finite(x[k]))reasons.push('INVALID_'+k);
 for(const k of ['dealSize','gbpPerPipPerDealUnit','stopPips','accountBalanceGBP'])if(finite(x[k])&&x[k]<=0)reasons.push('NONPOSITIVE_'+k);
 for(const k of ['spreadPips','slippagePips','feesGBP'])if(finite(x[k])&&x[k]<0)reasons.push('NEGATIVE_'+k);
 if(x.stopPips!==12)reasons.push('STOP_POLICY_MISMATCH');
 if(x.openPositions!==0)reasons.push('OPEN_POSITION_COUNT_NOT_ZERO');
 if(!Number.isInteger(x.tradesToday)||x.tradesToday<0||x.tradesToday>=3)reasons.push('DAILY_TRADE_LIMIT');
 if(!finite(x.realizedDailyLossGBP)||x.realizedDailyLossGBP<0)reasons.push('INVALID_DAILY_LOSS');
 if(finite(x.realizedDailyLossGBP)&&x.realizedDailyLossGBP>=100)reasons.push('DAILY_LOSS_LIMIT');
 if(finite(x.spreadPips)&&x.spreadPips>2.5)reasons.push('SPREAD_LIMIT');
 if(!x.contractEvidenceRef||!x.fxEvidenceRef||!x.feeEvidenceRef)reasons.push('INDEPENDENT_CONTRACT_FX_FEE_EVIDENCE_REQUIRED');
 if(!x.fxObservedAt||!Number.isFinite(Date.parse(x.fxObservedAt))||Math.abs(Date.now()-Date.parse(x.fxObservedAt))>60000)reasons.push('FX_EVIDENCE_NOT_FRESH');
 let nominalStopGBP=null,stressLossGBP=null;
 if(['dealSize','gbpPerPipPerDealUnit','stopPips','spreadPips','slippagePips','feesGBP'].every(k=>finite(x[k]))){
  nominalStopGBP=round(x.dealSize*x.gbpPerPipPerDealUnit*x.stopPips,4);
  stressLossGBP=round(x.dealSize*x.gbpPerPipPerDealUnit*(x.stopPips+x.spreadPips+x.slippagePips)+x.feesGBP,4);
  if(stressLossGBP>25)reasons.push('RISK_ABOVE_25_GBP');
  if(finite(x.realizedDailyLossGBP)&&x.realizedDailyLossGBP+stressLossGBP>100)reasons.push('DAILY_LOSS_WITH_PROPOSED_RISK');
 }
 return {candidateValid:reasons.length===0,reasons,nominalStopGBP,stressLossGBP,gbpPipValueIndependentlyCertified:false,brokerOrderAllowed:false};
}
function createV203({pool,requireAdmin,readIG,v198}={}){
 if(!pool||typeof requireAdmin!=='function'||typeof readIG!=='function'||!v198)throw Error('V203_DEPENDENCIES_MISSING');
 let initialized=false;
 async function init(){await pool.query(DDL);initialized=true;}
 async function ensure(){if(!initialized)await init();}
 async function save(kind,payload){await ensure();const id=crypto.randomUUID(),hash=digest(payload);await pool.query('INSERT INTO mp_v203_evidence(id,kind,payload,digest) VALUES($1,$2,$3::jsonb,$4)',[id,kind,JSON.stringify(payload),hash]);return {id,digest:hash,kind,brokerOrderAllowed:false};}
 async function verify(id){await ensure();if(!UUID.test(id||''))throw Error('INVALID_UUID');const q=await pool.query('SELECT payload,digest,kind,hash_version FROM mp_v203_evidence WHERE id=$1',[id]);if(!q.rowCount)return {found:false,verified:false,brokerOrderAllowed:false};const r=q.rows[0];return {found:true,kind:r.kind,verified:r.hash_version==='CANONICAL_JSON_V2'&&digest(r.payload)===r.digest,brokerOrderAllowed:false};}
 async function audit(){await ensure();const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const n=await c.query('SELECT count(*)::bigint AS n FROM mp_v203_evidence');const count=Number(n.rows[0].n);if(!Number.isSafeInteger(count)||count>MAX){await c.query('ROLLBACK');return {verified:false,fullHistory:false,reason:'ROW_LIMIT_EXCEEDED',count,brokerOrderAllowed:false};}const r=await c.query('SELECT id,payload,digest,hash_version FROM mp_v203_evidence ORDER BY created_at,id');const failures=r.rows.filter(x=>x.hash_version!=='CANONICAL_JSON_V2'||digest(x.payload)!==x.digest).map(x=>x.id);await c.query('COMMIT');return {verified:!failures.length,fullHistory:true,checked:r.rowCount,failures,brokerOrderAllowed:false};}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async function shadow(x){if(x?.confirm!=='SHADOW_ONLY_NO_ORDER'||!['BUY','SELL'].includes(x?.direction))throw Error('SHADOW_CONFIRMATION_REQUIRED');const risk=riskPreview(x);const payload={kind:'SHADOW_PLAN',at:new Date().toISOString(),epic:EPIC,direction:x.direction,risk,simulated:true,brokerSubmissionAttempted:false,brokerOrderAllowed:false};return {...await save('SHADOW_PLAN',payload),...payload};}
 async function reconcile(){const endpoints=[['market','/markets/'+encodeURIComponent(EPIC),'3'],['positions','/positions','2'],['accounts','/accounts','1']];const responses=await Promise.allSettled(endpoints.map(([,p,v])=>readIG(p,v)));const checks={};let miniPositions=null;
 for(let i=0;i<endpoints.length;i++){const name=endpoints[i][0],r=responses[i];if(r.status==='rejected'){checks[name]={ok:false,error:String(r.reason?.message||r.reason).slice(0,100)};continue;}const val=r.value;const ok=name==='market'?!!(val?.instrument&&val?.snapshot):name==='positions'?Array.isArray(val?.positions):Array.isArray(val?.accounts);checks[name]={ok};if(name==='market'&&ok){checks[name].status=val.snapshot.marketStatus||null;checks[name].rawBrokerTime=val.snapshot.updateTime||null;}if(name==='positions'&&ok){miniPositions=val.positions.filter(p=>p.market?.epic===EPIC).map(p=>({dealId:p.position?.dealId||null,direction:p.position?.direction||null,size:p.position?.size??null,stopLevel:p.position?.stopLevel??null}));checks[name].miniPositions=miniPositions.length;}if(name==='accounts'&&ok)checks[name].currencies=val.accounts.map(a=>a.currency||null);}
 const payload={kind:'BROKER_RECONCILIATION',at:new Date().toISOString(),epic:EPIC,checks,miniPositions,complete:Object.values(checks).every(x=>x.ok),independentlyCertified:false,brokerOrderAllowed:false};return {...await save('BROKER_RECONCILIATION',payload),...payload};}
 async function review(x){if(!CATEGORIES.includes(x?.category)||!['PENDING','EVIDENCE_SUBMITTED','REJECTED'].includes(x?.status)||typeof x?.evidenceRef!=='string'||x.evidenceRef.length<8||x.evidenceRef.length>300||typeof x?.notes!=='string'||x.notes.length>1000)throw Error('INVALID_REVIEW');const payload={kind:'CERTIFICATION_REVIEW',at:new Date().toISOString(),category:x.category,status:x.status,evidenceRef:x.evidenceRef,notes:x.notes,passed:false,requiresIndependentVerification:true,brokerOrderAllowed:false};return {...await save('CERTIFICATION_REVIEW',payload),...payload};}
 async function restart(){const payload={kind:'RESTART_CHALLENGE',at:new Date().toISOString(),challenge:crypto.randomUUID(),brokerOrderAllowed:false};return {...await save('RESTART_CHALLENGE',payload),challenge:payload.challenge};}
 async function readiness(){const [own,prior]=await Promise.all([audit(),v198.readiness()]);const q=await pool.query("SELECT payload FROM mp_v203_evidence WHERE kind='CERTIFICATION_REVIEW' ORDER BY created_at DESC LIMIT 100");const reviews=Object.fromEntries(CATEGORIES.map(k=>[k,{passed:false,latestReview:q.rows.find(r=>r.payload.category===k)?.payload.status||'NOT_SUBMITTED'}]));const blockers=[...new Set([...(prior.blockers||[]),...(!own.verified?['V203_INTEGRITY_FAILURE']:[]),'SEVEN_INDEPENDENT_CERTIFICATIONS_OUTSTANDING','NO_CERTIFIED_BROKER_WRITE_ADAPTER'])];return {version:'203.0.0',audit:own,certifications:reviews,certificationsPassed:0,certificationsRequired:7,blockers,brokerWriteIntegration:false,brokerOrderAllowed:false,readyForUnattendedDemo:false};}
 function status(){return {version:'203.0.0',mode:'COMBINED_SHADOW_AND_CERTIFICATION_WORKBENCH',epic:EPIC,databaseInitialized:initialized,features:['CANONICAL_FULL_TABLE_INTEGRITY','PERSISTENT_SHADOW_PLANS','GBP_STRESS_RISK_PREVIEW','GET_ONLY_BROKER_RECONCILIATION','INDEPENDENT_CERTIFICATION_EVIDENCE_QUEUE','RESTART_CHALLENGE','HARD_BLOCKED_ORDER_SUBMISSION'],certificationsPassed:0,certificationsRequired:7,brokerWriteIntegration:false,brokerOrderAllowed:false,readyForUnattendedDemo:false};}
 const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req.body||{},req));}catch(e){res.status(409).json({error:String(e.message).slice(0,180),brokerOrderAllowed:false});}};
 function routes(app){app.get('/api/v203/status',requireAdmin,wrap(status));app.get('/api/v203/readiness',requireAdmin,wrap(readiness));app.get('/api/v203/audit',requireAdmin,wrap(audit));app.post('/api/v203/shadow/plan',requireAdmin,wrap(shadow));app.post('/api/v203/broker/reconcile',requireAdmin,wrap(reconcile));app.post('/api/v203/certification/review',requireAdmin,wrap(review));app.post('/api/v203/restart/challenge',requireAdmin,wrap(restart));app.get('/api/v203/evidence/:id/verify',requireAdmin,wrap((_x,req)=>verify(req.params.id)));app.post('/api/v203/risk/preview',requireAdmin,wrap(riskPreview));app.post('/api/v203/order/submit',requireAdmin,(_req,res)=>res.status(409).json({error:'V203_BROKER_ORDER_HARD_BLOCKED_UNCERTIFIED',brokerOrderAllowed:false}));}
 return {init,routes,status,readiness,audit,shadow,reconcile,review,verify,restart};
}
module.exports={createV203,riskPreview,EPIC};
