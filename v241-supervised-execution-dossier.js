 'use strict';
// v235-v241: fail-closed certification dossier and supervised order dry-run. NEVER writes to IG.
const crypto=require('node:crypto');
const {digest}=require('./v195-readiness-gate');
const EPIC='CS.D.EURUSD.MINI.IP';
const CERTS=['historicalPaperAccounting','exchangeTimestampAndDelay','gbpPipValueAndDealSize','netDailyPnlAndFees','brokerStopLifecycle','unknownSubmissionRecovery','distributedExecutionLock'];
const DDL=`CREATE TABLE IF NOT EXISTS mp_v241_evidence (id UUID PRIMARY KEY,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),kind TEXT NOT NULL,payload JSONB NOT NULL,digest TEXT NOT NULL); CREATE INDEX IF NOT EXISTS mp_v241_evidence_order ON mp_v241_evidence(created_at,id); CREATE TABLE IF NOT EXISTS mp_v241_intents (id UUID PRIMARY KEY,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),state TEXT NOT NULL CHECK(state IN ('PREPARED','QUARANTINED')),payload JSONB NOT NULL,digest TEXT NOT NULL);`;
const safeNumber=x=>typeof x==='number'&&Number.isFinite(x);
function preflight(b){
 const errors=[];
 if(b.epic!==EPIC)errors.push('EPIC_MISMATCH');
 if(b.side!=='BUY'&&b.side!=='SELL')errors.push('INVALID_SIDE');
 if(!safeNumber(b.size)||b.size<=0)errors.push('INVALID_SIZE');
 if(!safeNumber(b.stopPips)||b.stopPips<12)errors.push('STOP_DISTANCE_INVALID');
 if(!safeNumber(b.targetPips)||b.targetPips<=0)errors.push('TARGET_INVALID');
 if(!safeNumber(b.pipValueGBP)||b.pipValueGBP<=0)errors.push('GBP_PIP_VALUE_MISSING');
 if(!safeNumber(b.feesGBP)||b.feesGBP<0)errors.push('FEES_MISSING');
 if(!safeNumber(b.slippageGBP)||b.slippageGBP<0)errors.push('SLIPPAGE_MISSING');
 if(!safeNumber(b.spreadPips)||b.spreadPips<0||b.spreadPips>2.5)errors.push('SPREAD_LIMIT');
 if(!safeNumber(b.quoteAgeSeconds)||b.quoteAgeSeconds<0||b.quoteAgeSeconds>15)errors.push('QUOTE_STALE');
 if(!safeNumber(b.dailyLossGBP)||b.dailyLossGBP<0||b.dailyLossGBP>=100)errors.push('DAILY_LOSS_LIMIT');
 if(!Number.isInteger(b.tradesToday)||b.tradesToday<0||b.tradesToday>=3)errors.push('TRADE_COUNT_LIMIT');
 if(b.openPositions!==0)errors.push('POSITION_ALREADY_OPEN_OR_UNKNOWN');
 if(b.contractEvidenceVerified!==true)errors.push('CONTRACT_NOT_INDEPENDENTLY_VERIFIED');
 if(b.feeEvidenceVerified!==true)errors.push('FEES_NOT_INDEPENDENTLY_VERIFIED');
 if(b.stopRulesVerified!==true)errors.push('STOP_RULES_NOT_VERIFIED');
 const risk=safeNumber(b.size)&&safeNumber(b.stopPips)&&safeNumber(b.pipValueGBP)&&safeNumber(b.feesGBP)&&safeNumber(b.slippageGBP)?b.size*b.stopPips*b.pipValueGBP+b.feesGBP+b.slippageGBP:null;
 if(risk===null||risk>25)errors.push('RISK_LIMIT');
 if(risk!==null&&safeNumber(b.dailyLossGBP)&&b.dailyLossGBP+risk>100)errors.push('DAILY_LOSS_WITH_RISK');
 // Client-supplied evidence booleans and amounts are NOT trusted broker verification.
 errors.push('INDEPENDENT_BROKER_EVIDENCE_NOT_ATTESTED');
 return {epic:EPIC,estimatedWorstCaseGBP:risk,preflightChecksPassed:errors.length===1,errors:[...new Set(errors)],brokerOrderAllowed:false,independentlyCertified:false};
}
function createV241({pool,requireAdmin,readIG,v234}={}){
 if(!pool||typeof requireAdmin!=='function'||typeof readIG!=='function'||!v234)throw Error('V241_DEPENDENCIES_MISSING');
 let initialized=false;
 async function init(){await pool.query(DDL);initialized=true;}
 async function ensure(){if(!initialized)await init();}
 async function store(kind,fields){await ensure();const id=crypto.randomUUID();const payload={kind,createdAt:new Date().toISOString(),...fields,brokerOrderAllowed:false};const hash=digest(payload);await pool.query('INSERT INTO mp_v241_evidence(id,kind,payload,digest) VALUES($1,$2,$3::jsonb,$4)',[id,kind,JSON.stringify(payload),hash]);return {id,digest:hash,...payload};}
 async function audit(){await ensure();const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const n=Number((await c.query('SELECT count(*)::bigint n FROM mp_v241_evidence')).rows[0].n);if(!Number.isSafeInteger(n)||n>100000){await c.query('ROLLBACK');return {verified:false,fullHistory:false,reason:'AUDIT_CAP',brokerOrderAllowed:false};}const q=await c.query('SELECT id,payload,digest FROM mp_v241_evidence ORDER BY created_at,id');const failures=q.rows.filter(x=>digest(x.payload)!==x.digest).map(x=>x.id);const intents=await c.query('SELECT id,payload,digest FROM mp_v241_intents');for(const x of intents.rows)if(digest(x.payload)!==x.digest)failures.push(x.id);await c.query('COMMIT');return {verified:failures.length===0,fullHistory:true,checked:q.rowCount,intentsChecked:intents.rowCount,failures,scope:'mp_v241_evidence_AND_intents_ONLY',brokerOrderAllowed:false};}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async function snapshot(){const checks={};for(const [key,route,v] of [['market','/markets/'+encodeURIComponent(EPIC),'3'],['positions','/positions','2'],['accounts','/accounts','1']]){try{const r=await readIG(route,v);if(key==='market')checks[key]={ok:!!r?.snapshot,status:r?.snapshot?.marketStatus||null,exchangeTimestampVerified:false};if(key==='positions')checks[key]={ok:Array.isArray(r?.positions),miniPositions:Array.isArray(r?.positions)?r.positions.filter(x=>x.market?.epic===EPIC).length:null};if(key==='accounts')checks[key]={ok:Array.isArray(r?.accounts),gbpAccounts:Array.isArray(r?.accounts)?r.accounts.filter(x=>x.currency==='GBP').length:null};}catch(e){checks[key]={ok:false,error:String(e.message).slice(0,100)};}}return store('BROKER_READ_ONLY_FACTS',{checks,independentlyCertified:false});}
 async function prepare(b){if(b.confirm!=='PREPARE_ONLY_NO_ORDER')throw Error('CONFIRM_PREPARE_ONLY');const result=preflight(b);const ev=await store('SUPERVISED_DRY_RUN',{preflight:result,approval:'NOT_GRANTED',orderSubmitted:false});const id=crypto.randomUUID();const payload={evidenceId:ev.id,preflight:result,brokerOrderAllowed:false,doNotSubmit:true};await pool.query('INSERT INTO mp_v241_intents(id,state,payload,digest) VALUES($1,$2,$3::jsonb,$4)',[id,'PREPARED',JSON.stringify(payload),digest(payload)]);return {id,evidenceId:ev.id,...result,state:'PREPARED',brokerOrderAllowed:false};}
 async function quarantine(b){if(b.confirm!=='QUARANTINE_NO_ORDER'||!b.intentId||!/^[a-f0-9-]{36}$/i.test(b.intentId))throw Error('INVALID_QUARANTINE');await ensure();const q=await pool.query("UPDATE mp_v241_intents SET state='QUARANTINED' WHERE id=$1 RETURNING id",[b.intentId]);if(!q.rowCount)throw Error('INTENT_NOT_FOUND');return store('INTENT_QUARANTINED',{intentId:b.intentId,doNotResubmit:true,actualBrokerRecoveryCertified:false});}
 async function review(b){if(b.confirm!=='RECORD_REVIEW_NO_CERTIFICATION'||!CERTS.includes(b.category)||typeof b.reference!=='string'||b.reference.length<8||b.reference.length>300)throw Error('INVALID_REVIEW');return store('OPERATOR_EVIDENCE_REFERENCE',{category:b.category,reference:b.reference,operatorReviewOnly:true,independentlyCertified:false});}
 async function readiness(){const [a,p,q]=await Promise.all([audit(),v234.readiness(),pool.query("SELECT count(*)::int n FROM mp_v241_intents WHERE state='QUARANTINED'")]);return {version:'241.0.0',audit:a,priorAudit:p.audit,quarantinedIntents:q.rows[0].n,certifications:Object.fromEntries(CERTS.map(k=>[k,{independentlyCertified:false}])),certificationsPassed:0,certificationsRequired:7,blockers:['INDEPENDENT_GBP_CONTRACT_AND_FEES','COMPLETE_ACCOUNTING','AUTHENTICATED_MARKET_TIMESTAMPS','REAL_BROKER_PROTECTIVE_STOP','ACTUAL_UNKNOWN_SUBMISSION_RECOVERY','BROKER_INTEGRATED_FENCING','NO_CERTIFIED_WRITE_ADAPTER',...(!a.verified?['INTEGRITY_FAILURE']:[]),...(q.rows[0].n?['QUARANTINED_INTENTS']:[])],brokerWriteIntegration:false,brokerOrderAllowed:false,readyForControlledDemo:false,readyForUnattendedDemo:false};}
 const status=()=>({version:'241.0.0',versionsIncluded:['235','236','237','238','239','240','241'],databaseInitialized:initialized,mode:'SUPERVISED_DRY_RUN_AND_CERTIFICATION_DOSSIER',epic:EPIC,brokerWriteIntegration:false,brokerOrderAllowed:false,readyForUnattendedDemo:false});
 const wrap=fn=>(req,res)=>Promise.resolve().then(()=>fn(req.body||{},req)).then(x=>res.set('Cache-Control','no-store').json(x)).catch(e=>res.status(409).json({error:String(e.message).slice(0,160),brokerOrderAllowed:false}));
 function routes(app){for(const [p,fn] of [['status',status],['readiness',readiness],['audit',audit]])app.get('/api/v241/'+p,requireAdmin,wrap(fn));app.post('/api/v241/broker/snapshot',requireAdmin,wrap(snapshot));app.post('/api/v241/order/prepare',requireAdmin,wrap(prepare));app.post('/api/v241/recovery/quarantine',requireAdmin,wrap(quarantine));app.post('/api/v241/certification/evidence-reference',requireAdmin,wrap(review));for(const p of ['order/submit','trading/arm','trading/auto-start','certification/approve'])app.post('/api/v241/'+p,requireAdmin,(_req,res)=>res.status(409).json({error:'UNCERTIFIED_BROKER_WRITE_HARD_BLOCKED',brokerOrderAllowed:false}));}
 return {init,routes,status,readiness,audit,preflight};
}
module.exports={createV241,preflight};
