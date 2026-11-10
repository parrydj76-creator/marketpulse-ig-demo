'use strict';
// V55 is deliberately read-only against IG. No order submission or arming code exists.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validateProposal,EPIC}=require('./v54-safety');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{6,80}$/.test(x);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function riskReview(p){const v=validateProposal(p);const issues=['BROKER_DEAL_SIZE_INCREMENT_UNVERIFIED','STOP_POINT_UNITS_UNVERIFIED','INDEPENDENT_FX_AND_BROKER_PNL_CROSSCHECK_REQUIRED'];return {...v,issues,certified:false,brokerOrderAllowed:false}}
function exposureGuard({positions,unresolved,emergencyStop,lossGBP,tradeCount,day}){
 const issues=[];
 if(emergencyStop)issues.push('EMERGENCY_STOP');
 if(!Array.isArray(positions))issues.push('POSITIONS_NOT_READ');
 else if(positions.some(p=>p.epic===EPIC))issues.push('MINI_POSITION_EXISTS');
 if(unresolved>0)issues.push('UNRESOLVED_INTENT');
 if(!finite(lossGBP)||lossGBP<0)issues.push('DAILY_LOSS_NOT_VERIFIED');
 else if(lossGBP>=100)issues.push('DAILY_LOSS_LIMIT');
 if(!Number.isInteger(tradeCount)||tradeCount<0)issues.push('TRADE_COUNT_NOT_VERIFIED');
 else if(tradeCount>=3)issues.push('DAILY_TRADE_CAP');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day||''))issues.push('DAY_INVALID');
 return {reviewEligible:issues.length===0,issues,brokerOrderAllowed:false};
}
function createV55({requireAdmin,storageDir,persistentStorage,readBroker}){
 const bootId=crypto.randomUUID(),file=path.join(storageDir,'v55-supervised.jsonl');let healthy=!!persistentStorage,lastError=null,rows=[];
 try{if(healthy){fs.mkdirSync(storageDir,{recursive:true});if(fs.existsSync(file)){let prev='GENESIS';for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.prev!==prev||r.hash!==hash({prev:r.prev,at:r.at,type:r.type,payload:r.payload}))throw Error('V55_JOURNAL_INTEGRITY_FAILED');rows.push(r);prev=r.hash;}}}}catch(e){healthy=false;lastError=e.message}
 function append(type,payload){if(!healthy)throw Error('PERSISTENT_JOURNAL_UNAVAILABLE');const r={prev:rows.at(-1)?.hash||'GENESIS',at:new Date().toISOString(),type,payload};r.hash=hash(r);try{fs.appendFileSync(file,JSON.stringify(r)+'\n');rows.push(r)}catch(e){healthy=false;lastError=e.message;throw e}return r}
 const last=t=>[...rows].reverse().find(r=>r.type===t);
 const stopped=()=>{const s=last('STOP');return !!s&&(!last('RESET')||rows.indexOf(s)>rows.indexOf(last('RESET')))};
 const pending=()=>{const resolved=new Set(rows.filter(r=>r.type==='OPERATOR_REVIEW').map(r=>r.payload.clientIntentId));return rows.filter(r=>r.type==='INTENT'&&!resolved.has(r.payload.clientIntentId))};
 function status(){return {version:'55.0.0',mode:'SUPERVISED_DEMO_EXECUTION_VERIFICATION',bootId,epic:EPIC,persistentStorageConfigured:!!persistentStorage,journalHealthy:healthy,journalEvents:rows.length,lastError,emergencyStop:stopped(),pendingReviewIntents:pending().length,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,readyForUnattendedDemo:false,certifications:{gbpSizing:false,brokerLifecycle:false,unknownOrderRecovery:false,unattendedAdapter:false},warning:'No IG broker write adapter; no real broker lifecycle certification.'}}
 async function inspect(){const b=await readBroker();if(b.currency!=='GBP'||!b.accountFingerprint||!Array.isArray(b.positions))throw Error('BROKER_ACCOUNT_READBACK_INVALID');const mini=b.positions.filter(p=>p.epic===EPIC);append('READBACK',{bootId,accountFingerprint:b.accountFingerprint,positions:mini});return {miniPositions:mini.length,unprotectedDealIds:mini.filter(p=>p.stopLevel==null||p.limitLevel==null).map(p=>p.dealId),pendingReviewIntents:pending().length,brokerOrderAllowed:false,unknownOrderOutcomesCertified:false}}
 async function propose(p){if(stopped())throw Error('EMERGENCY_STOP_ACTIVE');if(pending().length)throw Error('PENDING_OPERATOR_REVIEW');const v=riskReview(p);if(rows.some(r=>r.type==='INTENT'&&r.payload.clientIntentId===v.clientIntentId))throw Error('DUPLICATE_CLIENT_INTENT_ID');const b=await readBroker();if(b.currency!=='GBP'||!b.accountFingerprint||!Array.isArray(b.positions))throw Error('BROKER_ACCOUNT_READBACK_INVALID');if(b.positions.some(x=>x.epic===EPIC))throw Error('MINI_POSITION_EXISTS');append('INTENT',{...v,accountFingerprint:b.accountFingerprint,bootId,execution:'NEVER_SUBMITTED'});return {acceptedForOperatorReview:true,submittedToBroker:false,indicativeRiskGBP:v.indicativeGBP,issues:v.issues,brokerOrderAllowed:false}}
 function operatorReview(p){if(!id(p?.clientIntentId))throw Error('CLIENT_INTENT_ID_REQUIRED');const original=rows.find(r=>r.type==='INTENT'&&r.payload.clientIntentId===p.clientIntentId);if(!original)throw Error('UNKNOWN_INTENT');if(rows.some(r=>r.type==='OPERATOR_REVIEW'&&r.payload.clientIntentId===p.clientIntentId))throw Error('ALREADY_REVIEWED');if(p.disposition!=='CANCELLED_NEVER_SUBMITTED')throw Error('ONLY_NEVER_SUBMITTED_CANCELLATION_SUPPORTED');append('OPERATOR_REVIEW',{clientIntentId:p.clientIntentId,disposition:p.disposition,bootId});return {reviewRecorded:true,certified:false,brokerOrderAllowed:false}}
 function reviewLimits(p){const day=new Date().toISOString().slice(0,10);if(p?.day!==day)throw Error('CURRENT_UTC_DAY_REQUIRED');const result=exposureGuard({positions:p.positions,unresolved:pending().length,emergencyStop:stopped(),lossGBP:p.lossGBP,tradeCount:p.tradeCount,day:p.day});return {...result,certified:false,warning:'Operator-provided P/L and count are NOT independent broker certification.'}}
 function routes(app){const fail=(r,e)=>r.status(409).json({error:String(e.message||e).slice(0,180),brokerOrderAllowed:false});const handler=fn=>async(q,r)=>{try{r.set('Cache-Control','no-store').json(await fn(q.body||{}))}catch(e){fail(r,e)}};
 app.get('/api/v55/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
 app.get('/api/v55/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({journalHealthy:healthy,events:rows.slice(-100).map(x=>({at:x.at,type:x.type,hash:x.hash}))}));
 app.post('/api/v55/inspect',requireAdmin,handler(inspect));app.post('/api/v55/propose',requireAdmin,handler(propose));app.post('/api/v55/review-intent',requireAdmin,handler(operatorReview));app.post('/api/v55/review-limits',requireAdmin,handler(reviewLimits));
 app.post('/api/v55/emergency-stop',requireAdmin,handler(()=>{append('STOP',{bootId});return {emergencyStop:true,brokerOrderAllowed:false,warning:'Does not close broker positions'}}));
 app.post('/api/v55/reset-stop',requireAdmin,(_q,r)=>r.status(409).json({error:'RESET_REQUIRES_OFFLINE_OPERATOR_REVIEW',brokerOrderAllowed:false}));
 app.post('/api/v55/arm-unattended',requireAdmin,(_q,r)=>r.status(409).json({error:'UNATTENDED_EXECUTION_NOT_CERTIFIED',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false}));
 app.get('/v55',(_q,r)=>r.sendFile(path.join(__dirname,'public','v55.html')));
 }
 return {routes,status,inspect,propose,operatorReview};
}
module.exports={createV55,riskReview,exposureGuard};
