'use strict';
// v196: full-history verification, fault-model rehearsals and risk analysis. NO BROKER WRITES.
const crypto=require('node:crypto');
const {digest,canonical}=require('./v195-readiness-gate');
const EPIC='CS.D.EURUSD.MINI.IP';
const uuid=()=>crypto.randomUUID();
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const MODES=['NORMAL','TIMEOUT_BEFORE_SEND','TIMEOUT_AFTER_SEND','DUPLICATE_WORKER','CRASH_AFTER_PREPARE','STALE_FENCE','BROKER_REJECT','STOP_MISSING','RESTART_UNKNOWN'];
const POLICY=Object.freeze({riskGBP:25,dailyLossGBP:100,maxTrades:3,maxOpenPositions:1,stopPips:12,targetPips:18,maxSpreadPips:2.5,maxQuoteAgeSeconds:15,minScore:70});
const uuidRe=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function risk(x={}){
 const errors=[];const n=k=>{const v=x[k];if(typeof v!=='number'||!Number.isFinite(v)||(k==='feesGBP'||k==='spreadPips'||k==='slippagePips'||k==='quoteAgeSeconds'?v<0:v<=0)){errors.push('INVALID_'+k);return null;}return v;};
 const deal=n('dealSize'),pip=n('gbpPerPipPerDealUnit'),stop=n('stopPips'),spread=n('spreadPips'),slip=n('slippagePips'),fees=n('feesGBP'),min=n('minimumDealSize'),step=n('dealSizeStep'),age=n('quoteAgeSeconds');
 if(x.epic!==EPIC)errors.push('WRONG_EPIC');
 if(x.contractEvidenceVerified!==true||x.fxEvidenceVerified!==true||x.feeEvidenceVerified!==true)errors.push('INDEPENDENT_EVIDENCE_MISSING');
 if(x.exchangeTimeVerified!==true)errors.push('EXCHANGE_TIMESTAMP_UNVERIFIED');
 if(stop!==null&&stop!==POLICY.stopPips)errors.push('STOP_POLICY_MISMATCH');
 if(spread!==null&&spread>POLICY.maxSpreadPips)errors.push('SPREAD_EXCEEDS_LIMIT');
 if(age!==null&&age>POLICY.maxQuoteAgeSeconds)errors.push('STALE_QUOTE');
 if(deal!==null&&min!==null&&step!==null){if(deal<min-1e-9)errors.push('BELOW_MINIMUM');if(Math.abs((deal-min)/step-Math.round((deal-min)/step))>1e-7)errors.push('INVALID_DEAL_INCREMENT');}
 const worstCaseGBP=[deal,pip,stop,spread,slip,fees].every(v=>v!==null)?Number((deal*pip*(stop+spread+slip)+fees).toFixed(4)):null;
 if(worstCaseGBP!==null&&worstCaseGBP>POLICY.riskGBP)errors.push('RISK_LIMIT_EXCEEDED');
 if(x.dailyRealizedLossGBP===undefined||x.tradesToday===undefined||x.openPositions===undefined)errors.push('ACCOUNT_STATE_MISSING');
 else{for(const k of ['dailyRealizedLossGBP','tradesToday','openPositions'])if(!Number.isFinite(x[k])||x[k]<0)errors.push('INVALID_'+k);
 if(x.dailyRealizedLossGBP+(worstCaseGBP||Infinity)>POLICY.dailyLossGBP)errors.push('DAILY_LOSS_BUDGET_EXCEEDED');
 if(x.tradesToday>=POLICY.maxTrades)errors.push('TRADE_COUNT_EXCEEDED');if(x.openPositions>=POLICY.maxOpenPositions)errors.push('POSITION_LIMIT_EXCEEDED');}
 if(!Number.isFinite(x.signalScore)||x.signalScore<POLICY.minScore)errors.push('SIGNAL_BELOW_THRESHOLD');
 return {validCandidate:errors.length===0,worstCaseGBP,errors,policy:POLICY,independentlyCertified:false,brokerOrderAllowed:false};
}
function simulate(mode){if(!MODES.includes(mode))throw Error('INVALID_SCENARIO');
 const events=['PREPARED'];let state='PREPARED',submissionAttempted=false,submissionAllowed=false,requiresOperatorReview=false;
 switch(mode){
 case 'NORMAL':events.push('SIMULATED_SUBMISSION','SIMULATED_CONFIRMATION','SIMULATED_STOP','SIMULATED_CLOSE','SIMULATED_RECONCILIATION');state='RECONCILED';break;
 case 'TIMEOUT_BEFORE_SEND':events.push('CANCELLED_BEFORE_NETWORK');state='CANCELLED';break;
 case 'DUPLICATE_WORKER':events.push('SECOND_WORKER_REJECTED_BY_FENCE','SIMULATED_CANCEL');state='CANCELLED';break;
 case 'CRASH_AFTER_PREPARE':events.push('RESTART_RECONCILIATION_REQUIRED');state='UNKNOWN';requiresOperatorReview=true;break;
 case 'STALE_FENCE':events.push('STALE_FENCE_REJECTED');state='CANCELLED';break;
 case 'BROKER_REJECT':events.push('SIMULATED_REJECTION','CANCELLED');state='CANCELLED';break;
 case 'STOP_MISSING':events.push('SIMULATED_CONFIRMATION','STOP_NOT_VERIFIED','HALT');state='UNKNOWN';requiresOperatorReview=true;break;
 default:events.push('UNKNOWN_BROKER_OUTCOME','NO_AUTOMATIC_RETRY');state='UNKNOWN';requiresOperatorReview=true;
 }
 return {scenario:mode,state,events,submissionAttempted,submissionAllowed,requiresOperatorReview,automatedRetryAllowed:false,simulated:true,brokerOrderAllowed:false};
}
function createV196({pool,requireAdmin,v195,v194}={}){
 if(!pool||typeof requireAdmin!=='function'||!v195||!v194)throw Error('V196_DEPENDENCIES_MISSING');let initialized=false;
 async function init(){await pool.query(`CREATE TABLE IF NOT EXISTS mp_v196_rehearsals(id UUID PRIMARY KEY,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),payload JSONB NOT NULL,digest TEXT NOT NULL,hash_version TEXT NOT NULL DEFAULT 'CANONICAL_JSON_V2');CREATE INDEX IF NOT EXISTS mp_v196_rehearsals_created_idx ON mp_v196_rehearsals(created_at DESC);`);initialized=true;}
 async function ensure(){if(!initialized)await init();}
 async function rehearsal(mode){await ensure();const result=simulate(mode);const payload={at:new Date().toISOString(),epic:EPIC,...result};const id=uuid(),hash=digest(payload);await pool.query('INSERT INTO mp_v196_rehearsals(id,payload,digest) VALUES($1,$2::jsonb,$3)',[id,JSON.stringify(payload),hash]);return {id,digest:hash,...payload};}
 async function scenarios(){const results=MODES.map(simulate);return {scenarios:results,allFailClosed:results.every(r=>!r.submissionAllowed&&!r.submissionAttempted&&!r.automatedRetryAllowed),brokerOrderAllowed:false};}
 async function fullAudit(){await ensure();
 // Scan all rows in a REPEATABLE READ transaction, with a hard safety ceiling. Never silently call a partial audit 'full'.
 const client=await pool.connect();let begun=false;
 try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;
 const tables=[['mp_v194_broker_reads','id','payload','digest'],['mp_v194_events','seq','detail','digest'],['mp_v195_audit_runs','id','payload','digest'],['mp_v196_rehearsals','id','payload','digest']];
 const counts={},failures=[];let total=0;for(const [table] of tables){const r=await client.query('SELECT count(*)::bigint AS n FROM '+table);const n=Number(r.rows[0].n);counts[table]=n;total+=n;}
 if(total>100000){await client.query('ROLLBACK');begun=false;return {verified:false,fullHistory:false,checked:0,counts,blockers:['AUDIT_EXCEEDS_100000_ROW_LIMIT'],brokerOrderAllowed:false};}
 let checked=0,legacy=0;for(const [table,idCol,payloadCol,digestCol] of tables){let last=null;while(true){const sql=`SELECT ${idCol} AS id, ${payloadCol} AS payload, ${digestCol} AS digest FROM ${table} ${last===null?'':`WHERE ${idCol} > $1`} ORDER BY ${idCol} ASC LIMIT 250`;const rows=(await client.query(sql,last===null?[]:[last])).rows;if(!rows.length)break;
 for(const r of rows){checked++;if(digest(r.payload)!==r.digest){
 // v194 legacy format is audited by its existing compatibility verifier, not guessed or silently accepted here.
 if(table.startsWith('mp_v194_')){legacy++;continue;}failures.push({table,id:String(r.id),reason:'HASH_MISMATCH'});}}
 last=rows[rows.length-1].id;if(rows.length<250)break;}}
 await client.query('COMMIT');begun=false;
 const legacyAudit=await v194.audit(); // v194's own legacy validator is sampled; never claim full legacy validation from it.
 const legacyComplete=counts.mp_v194_broker_reads<=legacyAudit.checkedReads&&counts.mp_v194_events<=legacyAudit.checkedEvents;
 if(legacy>0&&(!legacyComplete||!legacyAudit.verified))failures.push({table:'mp_v194_*',reason:'LEGACY_ROWS_NOT_FULLY_VERIFIED'});
 return {verified:failures.length===0&&legacyComplete,fullHistory:failures.length===0&&legacyComplete,checked,counts,legacyRowsDelegated:legacy,legacyComplete,failures,brokerOrderAllowed:false};
 }catch(e){if(begun)await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}
 async function integrity(){await ensure();const q=await pool.query('SELECT id,payload,digest FROM mp_v196_rehearsals ORDER BY created_at DESC LIMIT 500');const failures=q.rows.filter(r=>digest(r.payload)!==r.digest).map(r=>r.id);return {verified:failures.length===0,checked:q.rows.length,failures,fullHistory:false,brokerOrderAllowed:false};}
 async function readiness(){const [audit,prior]=await Promise.all([fullAudit(),v195.report()]);const blockers=[...prior.blockers];if(!audit.verified)blockers.push('FULL_HISTORY_INTEGRITY_UNVERIFIED');blockers.push('BROKER_LIFECYCLE_NOT_INTEGRATED','GBP_CONTRACT_AND_FEES_NOT_INDEPENDENTLY_CERTIFIED','UNATTENDED_EXECUTION_DISABLED');return {version:'196.0.0',at:new Date().toISOString(),audit,priorCertifications:prior.certifications,blockers:[...new Set(blockers)],certificationsPassed:0,certificationsRequired:7,brokerWriteIntegration:false,brokerOrderAllowed:false,readyForUnattendedDemo:false};}
 function status(){return {version:'196.0.0',mode:'READ_ONLY_FAULT_AND_EVIDENCE_LAB',epic:EPIC,databaseInitialized:initialized,features:['FULL_HISTORY_AUDIT_WITH_100K_FAIL_CLOSED_CEILING','REPEATABLE_READ_EVIDENCE_SCAN','NINE_FAULT_SCENARIOS','PERSISTED_CANONICAL_HASHED_REHEARSALS','CONSERVATIVE_RISK_PREVIEW','V195_GATE_INTEGRATION'],certificationsPassed:0,certificationsRequired:7,brokerWriteIntegration:false,brokerOrderAllowed:false,readyForUnattendedDemo:false};}
 const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req));}catch(e){res.status(409).json({error:String(e.message).slice(0,150),brokerOrderAllowed:false});}};
 function routes(app){app.get('/api/v196/status',requireAdmin,wrap(status));app.get('/api/v196/audit/full',requireAdmin,wrap(fullAudit));app.get('/api/v196/audit/integrity',requireAdmin,wrap(integrity));app.get('/api/v196/readiness',requireAdmin,wrap(readiness));app.get('/api/v196/fault/scenarios',requireAdmin,wrap(scenarios));app.post('/api/v196/fault/rehearse',requireAdmin,wrap(req=>rehearsal(req.body?.scenario)));app.post('/api/v196/risk/preview',requireAdmin,wrap(req=>risk(req.body)));app.post('/api/v196/order/submit',requireAdmin,(_req,res)=>res.status(409).json({error:'BROKER_WRITE_HARD_BLOCKED_V196',brokerOrderAllowed:false}));}
 return {init,routes,status,fullAudit,integrity,readiness,rehearsal,scenarios};
}
module.exports={createV196,risk,simulate,MODES,POLICY};
