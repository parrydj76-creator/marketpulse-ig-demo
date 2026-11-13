 'use strict';
// v209-v213: evidence and supervised rehearsal only. No broker write adapter is accepted.
const crypto=require('node:crypto');
const {digest}=require('./v195-readiness-gate');
const EPIC='CS.D.EURUSD.MINI.IP';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUIRED=['historicalPaperAccounting','exchangeTimestampAndDelay','gbpPipValueAndDealSize','netDailyPnlAndFees','brokerStopLifecycle','unknownSubmissionRecovery','distributedExecutionLock'];
const DDL=`CREATE TABLE IF NOT EXISTS mp_v213_evidence(id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), kind TEXT NOT NULL, payload JSONB NOT NULL, digest TEXT NOT NULL); CREATE INDEX IF NOT EXISTS mp_v213_evidence_at ON mp_v213_evidence(created_at,id);`;
function assessRisk(x={}){
 const failures=[];
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
 for(const k of ['size','gbpPerPipPerUnit','stopPips','spreadPips','slippagePips','estimatedFeesGBP','dailyLossGBP','todayNetLossGBP'])if(!finite(x[k]))failures.push('MISSING_OR_INVALID_'+k);
 if(x.contractSourceVerified!==true||!x.contractDocumentRef)failures.push('UNVERIFIED_CONTRACT');
 if(x.feeScheduleVerified!==true||!x.feeDocumentRef)failures.push('UNVERIFIED_FEES');
 if(x.currency!=='GBP')failures.push('NOT_GBP');
 if(x.epic!==EPIC)failures.push('WRONG_EPIC');
 if(!failures.length){
  if(x.size<=0||x.gbpPerPipPerUnit<=0||x.stopPips<=0||x.spreadPips<0||x.slippagePips<0||x.estimatedFeesGBP<0)failures.push('INVALID_RISK_INPUT');
 }
 const risk=failures.length?null:(x.stopPips+x.spreadPips+x.slippagePips)*x.gbpPerPipPerUnit*x.size+x.estimatedFeesGBP;
 if(risk!==null&&risk>25)failures.push('EXCEEDS_25_GBP_TRADE_RISK');
 if(risk!==null&&x.todayNetLossGBP+risk>100)failures.push('EXCEEDS_100_GBP_DAILY_LOSS');
 if(x.minimumDealSizeVerified!==true||x.sizeIncrementVerified!==true)failures.push('DEAL_SIZE_RULES_UNVERIFIED');
 return {candidateValid:failures.length===0,estimatedWorstCaseLossGBP:risk===null?null:Number(risk.toFixed(2)),failures,independentlyCertified:false,brokerOrderAllowed:false};
}
function assessLifecycle(x={}){
 const failures=[];
 for(const k of ['operatorId','approvalRef','dealReference','dealId','openConfirmationRef','stopConfirmationRef','closeConfirmationRef','statementRef'])if(typeof x[k]!=='string'||x[k].length<4)failures.push('MISSING_'+k);
 for(const k of ['demoAccountConfirmed','stopPresentAtBroker','closedAtBroker','feesReconciled','noUnprotectedIntervalVerified'])if(x[k]!==true)failures.push('NOT_VERIFIED_'+k);
 if(x.epic!==EPIC)failures.push('WRONG_EPIC');
 return {candidateValid:failures.length===0,failures,independentlyCertified:false,brokerOrderAllowed:false};
}
function assessRecovery(x={}){
 const failures=[];
 for(const k of ['restartObserved','pendingIntentReconciled','unknownOutcomeManuallyResolved','duplicatePreventionProven','fenceCheckedAtBrokerSubmission','stopProtectionConfirmedAfterRestart'])if(x[k]!==true)failures.push('NOT_VERIFIED_'+k);
 for(const k of ['restartLogRef','brokerHistoryRef','fencingTestRef'])if(typeof x[k]!=='string'||x[k].length<4)failures.push('MISSING_'+k);
 return {candidateValid:failures.length===0,failures,independentlyCertified:false,brokerOrderAllowed:false};
}
function createV213({pool,requireAdmin,readIG,v208}={}){
 if(!pool||typeof requireAdmin!=='function'||typeof readIG!=='function'||!v208)throw Error('V213_DEPENDENCIES_MISSING');
 let initialized=false;
 async function init(){await pool.query(DDL);initialized=true;}
 async function ensure(){if(!initialized)await init();}
 async function save(kind,payload){await ensure();const id=crypto.randomUUID();const data={...payload,kind,createdAt:new Date().toISOString(),brokerOrderAllowed:false,independentlyCertified:false};const hash=digest(data);await pool.query('INSERT INTO mp_v213_evidence(id,kind,payload,digest) VALUES($1,$2,$3::jsonb,$4)',[id,kind,JSON.stringify(data),hash]);return {id,digest:hash,...data};}
 async function verify(id){await ensure();if(!UUID.test(id))return {found:false,verified:false,error:'INVALID_ID'};const r=await pool.query('SELECT payload,digest FROM mp_v213_evidence WHERE id=$1',[id]);return {found:r.rowCount===1,verified:r.rowCount===1&&digest(r.rows[0].payload)===r.rows[0].digest,brokerOrderAllowed:false};}
 async function audit(){await ensure();const client=await pool.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const count=Number((await client.query('SELECT count(*)::bigint AS n FROM mp_v213_evidence')).rows[0].n);if(!Number.isSafeInteger(count)||count>100000){await client.query('ROLLBACK');return {verified:false,fullHistory:false,count,reason:'AUDIT_LIMIT_EXCEEDED'};}const r=await client.query('SELECT id,payload,digest FROM mp_v213_evidence ORDER BY created_at,id');const failures=r.rows.filter(x=>digest(x.payload)!==x.digest).map(x=>x.id);await client.query('COMMIT');return {verified:failures.length===0,fullHistory:true,checked:r.rowCount,failures,scope:'mp_v213_evidence_ONLY',brokerOrderAllowed:false};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}
 async function snapshot(){const checks={};for(const [k,path,version] of [['market','/markets/'+encodeURIComponent(EPIC),'3'],['positions','/positions','2'],['accounts','/accounts','1']]){try{const d=await readIG(path,version);checks[k]={ok:k==='market'?!!d?.snapshot:k==='positions'?Array.isArray(d?.positions):Array.isArray(d?.accounts)};if(k==='positions')checks[k].miniPositions=(d.positions||[]).filter(p=>p.market?.epic===EPIC).length;if(k==='accounts')checks[k].gbpAccounts=(d.accounts||[]).filter(a=>a.currency==='GBP').length;}catch(e){checks[k]={ok:false,error:String(e.message).slice(0,120)};}}return save('IG_READ_ONLY_SNAPSHOT',{epic:EPIC,checks,complete:Object.values(checks).every(x=>x.ok)});}
 async function check(kind,body){if(body?.confirm!=='EVIDENCE_ONLY_NO_ORDER')throw Error('EVIDENCE_ONLY_CONFIRMATION_REQUIRED');const fn={RISK:assessRisk,LIFECYCLE:assessLifecycle,RECOVERY:assessRecovery}[kind];if(!fn)throw Error('UNKNOWN_CHECK');return save('CHECK_'+kind,{input:body,result:fn(body)});}
 async function challenge(){return save('RESTART_CHALLENGE',{challenge:crypto.randomUUID(),note:'Verify by ID after actual Render restart'});}
 async function readiness(){const [own,prior]=await Promise.all([audit(),v208.readiness()]);const count=await pool.query('SELECT kind,count(*)::int AS n FROM mp_v213_evidence GROUP BY kind');return {version:'213.0.0',mode:'CONTROLLED_DEMO_CERTIFICATION_PREPARATION',audit:own,priorAudit:prior.audit,evidenceCounts:Object.fromEntries(count.rows.map(x=>[x.kind,x.n])),certifications:Object.fromEntries(REQUIRED.map(x=>[x,{independentlyCertified:false}])),certificationsPassed:0,certificationsRequired:7,blockers:['BROKER_WRITE_ADAPTER_NOT_IMPLEMENTED','REAL_BROKER_STOP_LIFECYCLE_NOT_CERTIFIED','INDEPENDENT_GBP_RISK_AND_FEE_EVIDENCE_REQUIRED','BROKER_INTEGRATED_FENCING_NOT_CERTIFIED','UNKNOWN_SUBMISSION_RECOVERY_NOT_CERTIFIED','UNATTENDED_DEMO_NOT_APPROVED',...(!own.verified?['V213_EVIDENCE_INTEGRITY_FAILURE']:[])],brokerOrderAllowed:false,readyForControlledDemo:false,readyForUnattendedDemo:false};}
 const status=()=>({version:'213.0.0',versionsIncluded:['209','210','211','212','213'],databaseInitialized:initialized,mode:'EVIDENCE_ONLY_AND_SUPERVISED_CHECKLIST',epic:EPIC,brokerWriteIntegration:false,brokerOrderAllowed:false,readyForControlledDemo:false,readyForUnattendedDemo:false});
 const wrap=fn=>(req,res)=>Promise.resolve().then(()=>fn(req.body||{},req)).then(data=>res.json(data)).catch(e=>res.status(400).json({error:String(e.message).slice(0,180),brokerOrderAllowed:false}));
 function routes(app){app.get('/api/v213/status',requireAdmin,wrap(status));app.get('/api/v213/readiness',requireAdmin,wrap(readiness));app.get('/api/v213/audit',requireAdmin,wrap(audit));app.post('/api/v213/broker/snapshot',requireAdmin,wrap(snapshot));app.post('/api/v213/check/:kind',requireAdmin,wrap((b,r)=>check(r.params.kind,b)));app.post('/api/v213/restart/challenge',requireAdmin,wrap(challenge));app.get('/api/v213/evidence/:id/verify',requireAdmin,wrap((b,r)=>verify(r.params.id)));app.post('/api/v213/order/submit',requireAdmin,(req,res)=>res.status(409).json({error:'BROKER_EXECUTION_NOT_CERTIFIED',brokerOrderAllowed:false}));app.post('/api/v213/trading/arm',requireAdmin,(req,res)=>res.status(409).json({error:'CONTROLLED_AND_UNATTENDED_TRADING_DISABLED',brokerOrderAllowed:false}));}
 return {init,routes,status,readiness,audit,verify};
}
module.exports={createV213,assessRisk,assessLifecycle,assessRecovery};
