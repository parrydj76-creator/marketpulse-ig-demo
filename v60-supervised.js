'use strict';
// V60 is a supervised execution DESIGN HARNESS. No broker dealing methods exist.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{8,80}$/.test(x);
function assessProposal(p){
 const errors=[];
 if(!p||typeof p!=='object'||Array.isArray(p))return ['INVALID_PROPOSAL'];
 if(!validId(p.intentId))errors.push('INVALID_INTENT_ID');
 if(p.epic!==EPIC)errors.push('EPIC_MISMATCH');
 if(!['BUY','SELL'].includes(p.direction))errors.push('INVALID_DIRECTION');
 if(!Number.isFinite(p.size)||p.size<=0)errors.push('INVALID_SIZE');
 if(!Number.isFinite(p.stopPips)||p.stopPips<=0)errors.push('INVALID_STOP');
 if(!Number.isFinite(p.targetPips)||p.targetPips<=0)errors.push('INVALID_TARGET');
 if(!Number.isFinite(p.indicativeRiskGBP)||p.indicativeRiskGBP<=0||p.indicativeRiskGBP>25)errors.push('INDICATIVE_RISK_INVALID');
 return errors;
}
function createV60({requireAdmin,storageDir,persistentStorage,readBroker,v58Status,v59Status,legacyExecutionEnabled=false}){
 const file=path.join(storageDir,'v60-intents.jsonl'),bootId=crypto.randomUUID();let rows=[],healthy=!!persistentStorage,lastError=null;
 try{if(healthy){fs.mkdirSync(storageDir,{recursive:true});let prev='GENESIS';if(fs.existsSync(file))for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.prev!==prev||r.hash!==digest({prev:r.prev,at:r.at,type:r.type,payload:r.payload}))throw Error('V60_JOURNAL_INTEGRITY_FAILURE');rows.push(r);prev=r.hash}}}catch(e){healthy=false;lastError=e.message}
 function append(type,payload){if(!healthy)throw Error('V60_JOURNAL_UNHEALTHY');const r={prev:rows.at(-1)?.hash||'GENESIS',at:new Date().toISOString(),type,payload};r.hash=digest(r);try{fs.appendFileSync(file,JSON.stringify(r)+'\n',{flag:'a'});rows.push(r)}catch(e){healthy=false;lastError=e.message;throw e}return r}
 const intentRows=()=>rows.filter(r=>r.type==='INTENT_PREPARED');
 const intent=(id)=>intentRows().find(r=>r.payload.intentId===id)?.payload;
 const approval=(id)=>[...rows].reverse().find(r=>r.type==='OPERATOR_APPROVED'&&r.payload.intentId===id);
 const state=()=>({version:'60.0.0',mode:'SUPERVISED_EXECUTION_DESIGN_READ_ONLY',bootId,journalHealthy:healthy,lastError,preparedIntents:intentRows().length,approvedIntents:rows.filter(r=>r.type==='OPERATOR_APPROVED').length,unresolvedIntents:intentRows().filter(r=>!rows.some(x=>x.type==='RECONCILED'&&x.payload.intentId===r.payload.intentId)).length,legacyExecutionEnabled,brokerExecution:'HARD_BLOCKED_IN_V60',brokerOrderAllowed:false,readyForUnattendedDemo:false,certifications:{gbpSizing:false,brokerLifecycle:false,unknownOrderRecovery:false,unattendedAdapter:false},note:'Approval is evidence only; no broker order can be submitted by v60.'});
 async function preflight(){if(!healthy)throw Error('V60_JOURNAL_UNHEALTHY');const [b,paper,cert]=await Promise.all([readBroker(),Promise.resolve(v58Status()),Promise.resolve(v59Status())]);const blockers=[];
 if(legacyExecutionEnabled)blockers.push('LEGACY_EXECUTION_ENABLED');
 if(!b||b.currency!=='GBP'||!b.accountFingerprint||!Array.isArray(b.positions))blockers.push('BROKER_READBACK_INVALID');
 else if(b.positions.some(x=>x.epic===EPIC))blockers.push('BROKER_MINI_POSITION_EXISTS');
 if(!paper||paper.journalHealthy!==true||paper.monitorArmed||paper.entryArmed||paper.openPaperPositions>0)blockers.push('PAPER_ENGINE_NOT_IDLE');
 if(!cert||cert.journalHealthy!==true)blockers.push('V59_CERTIFICATION_JOURNAL_UNHEALTHY');
 const result={at:new Date().toISOString(),eligibleForSupervisedDesign:blockers.length===0,blockers,accountFingerprint:b?.accountFingerprint||null,brokerOrderAllowed:false};append('PREFLIGHT',result);return result;
 }
 async function prepare(p){const errors=assessProposal(p);if(errors.length)throw Error(errors.join(','));if(intent(p.intentId))throw Error('DUPLICATE_INTENT_ID');const check=await preflight();if(!check.eligibleForSupervisedDesign)throw Error('PREFLIGHT_BLOCKED:'+check.blockers.join(','));const payload={...p,accountFingerprint:check.accountFingerprint,preparedAt:new Date().toISOString(),submittedToBroker:false};append('INTENT_PREPARED',payload);return {intent:payload,brokerOrderAllowed:false};}
 function approve(id){const p=intent(id);if(!p)throw Error('UNKNOWN_INTENT');if(approval(id))throw Error('ALREADY_APPROVED');append('OPERATOR_APPROVED',{intentId:id,bootId,at:new Date().toISOString(),brokerOrderAllowed:false});return {intentId:id,approvedFor:'FUTURE_SUPERVISED_TEST_ONLY',brokerOrderAllowed:false};}
 async function reconcile(){const b=await readBroker();if(!b||b.currency!=='GBP'||!b.accountFingerprint||!Array.isArray(b.positions))throw Error('BROKER_READBACK_INVALID');const unresolved=intentRows().filter(r=>!rows.some(x=>x.type==='RECONCILED'&&x.payload.intentId===r.payload.intentId));const report=unresolved.map(r=>({intentId:r.payload.intentId,accountMatch:b.accountFingerprint===r.payload.accountFingerprint,approved:!!approval(r.payload.intentId),status:'NOT_SUBMITTED_BY_V60',requiresHumanReview:true}));append('READ_ONLY_RECONCILIATION',{count:report.length,accountFingerprint:b.accountFingerprint});return {unresolved:report,brokerPositions:b.positions.length,brokerOrderAllowed:false};}
 function routes(app){const handler=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req))}catch(e){res.status(409).json({error:String(e.message||e).slice(0,200),brokerOrderAllowed:false})}};
 app.get('/api/v60/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(state()));
 app.get('/api/v60/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({journalHealthy:healthy,events:rows.slice(-100).map(x=>({at:x.at,type:x.type,payload:x.payload}))}));
 app.post('/api/v60/preflight',requireAdmin,handler(()=>preflight()));
 app.post('/api/v60/prepare',requireAdmin,handler(req=>prepare(req.body)));
 app.post('/api/v60/approve',requireAdmin,handler(req=>approve(req.body?.intentId)));
 app.post('/api/v60/reconcile',requireAdmin,handler(()=>reconcile()));
 for(const route of ['execute','place-order','close-order','arm-unattended','enable-broker'])app.post('/api/v60/'+route,requireAdmin,(_q,r)=>r.status(409).json({error:'V60_BROKER_DEALING_NOT_CERTIFIED',brokerOrderAllowed:false}));
 app.get('/v60',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v60.html')));
 }
 return {routes,state,preflight,prepare,approve,reconcile};
}
module.exports={createV60,assessProposal};
