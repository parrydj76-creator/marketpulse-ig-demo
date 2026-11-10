'use strict';
// V61: fail-closed unattended readiness and crash rehearsal. NO broker write capability.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const idOk=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{8,80}$/.test(x);
const EPIC='CS.D.EURUSD.MINI.IP';
function createV61({requireAdmin,storageDir,persistentStorage,readBroker,v58Status,v59Status,v60Status,legacyExecutionEnabled=false}){
 const file=path.join(storageDir,'v61-rehearsal.jsonl'),bootId=crypto.randomUUID();let rows=[],healthy=!!persistentStorage,lastError=null;
 try{if(healthy){fs.mkdirSync(storageDir,{recursive:true});let prev='GENESIS';if(fs.existsSync(file))for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.prev!==prev||r.hash!==sha({prev:r.prev,at:r.at,type:r.type,payload:r.payload}))throw Error('JOURNAL_HASH_CHAIN_INVALID');rows.push(r);prev=r.hash;}}}catch(e){healthy=false;lastError=e.message;}
 function append(type,payload){if(!healthy)throw Error('V61_JOURNAL_UNHEALTHY');const r={prev:rows.at(-1)?.hash||'GENESIS',at:new Date().toISOString(),type,payload};r.hash=sha(r);try{fs.appendFileSync(file,JSON.stringify(r)+'\n');rows.push(r);}catch(e){healthy=false;lastError=e.message;throw e;}return r;}
 const rehearsals=()=>rows.filter(r=>r.type==='REHEARSAL_PREPARED');
 const outcomes=()=>rows.filter(r=>r.type==='REHEARSAL_RESOLVED');
 const unresolved=()=>rehearsals().filter(r=>!outcomes().some(x=>x.payload.intentId===r.payload.intentId));
 function status(){const v60=v60Status();return {version:'61.0.0',mode:'UNATTENDED_READINESS_REHEARSAL_READ_ONLY',bootId,journalHealthy:healthy,lastError,journalEvents:rows.length,preparedRehearsals:rehearsals().length,unresolvedRehearsals:unresolved().length,legacyExecutionEnabled,legacyExecutionBlocked:!legacyExecutionEnabled,supervisedIntentsUnresolved:v60?.unresolvedIntents??null,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,readyForUnattendedDemo:false,certifications:{gbpSizing:false,brokerLifecycle:false,unknownOrderRecovery:false,unattendedAdapter:false},note:'Rehearsals do not submit orders; recovery cannot be certified without real IG DEMO lifecycle evidence.'};}
 async function audit(){const blockers=[];let b=null;try{b=await readBroker();}catch(e){blockers.push('BROKER_READBACK_FAILED');}
 if(!healthy)blockers.push('JOURNAL_UNHEALTHY');if(legacyExecutionEnabled)blockers.push('LEGACY_EXECUTION_ENABLED');
 if(!b||b.currency!=='GBP'||!b.accountFingerprint||!Array.isArray(b.positions))blockers.push('GBP_ACCOUNT_READBACK_INVALID');
 else if(b.positions.length)blockers.push('BROKER_POSITIONS_PRESENT');
 const p=v58Status(),c=v59Status(),s=v60Status();
 if(!p||!p.journalHealthy||p.monitorArmed||p.entryArmed||p.openPaperPositions!==0)blockers.push('PAPER_ENGINE_NOT_IDLE');
 if(!c||!c.journalHealthy)blockers.push('CERTIFICATION_JOURNAL_UNHEALTHY');
 if(!s||!s.journalHealthy)blockers.push('SUPERVISED_JOURNAL_UNHEALTHY');
 if(s?.unresolvedIntents!==0)blockers.push('UNRESOLVED_SUPERVISED_INTENTS');
 if(unresolved().length)blockers.push('UNRESOLVED_REHEARSALS');
 const result={at:new Date().toISOString(),eligibleForRehearsal:blockers.length===0,blockers,accountFingerprint:b?.accountFingerprint||null,brokerPositions:b?.positions?.length??null,brokerOrderAllowed:false,readyForUnattendedDemo:false};if(healthy)append('AUDIT',result);return result;}
 async function prepare(p){if(!p||!idOk(p.intentId)||p.epic!==EPIC||!['BUY','SELL'].includes(p.direction))throw Error('INVALID_REHEARSAL_INTENT');if(!Number.isFinite(p.size)||p.size<=0||!Number.isFinite(p.stopPips)||p.stopPips<=0)throw Error('INVALID_SIZE_OR_STOP');if(rehearsals().some(r=>r.payload.intentId===p.intentId))throw Error('DUPLICATE_INTENT');const a=await audit();if(!a.eligibleForRehearsal)throw Error('AUDIT_BLOCKED:'+a.blockers.join(','));const payload={intentId:p.intentId,epic:EPIC,direction:p.direction,size:p.size,stopPips:p.stopPips,accountFingerprint:a.accountFingerprint,bootId,brokerSubmissionAttempted:false,createdAt:new Date().toISOString()};append('REHEARSAL_PREPARED',payload);return {rehearsal:payload,brokerOrderAllowed:false};}
 async function recover(){const b=await readBroker();if(!b||b.currency!=='GBP'||!b.accountFingerprint||!Array.isArray(b.positions))throw Error('BROKER_READBACK_INVALID');const pending=unresolved().map(r=>({intentId:r.payload.intentId,accountMatch:r.payload.accountFingerprint===b.accountFingerprint,brokerPositions:b.positions.length,state:'UNKNOWN_REQUIRES_OPERATOR_REVIEW',retryAllowed:false}));append('RECOVERY_INSPECTION',{count:pending.length,brokerPositions:b.positions.length,bootId});return {pending,brokerOrderAllowed:false,automaticRetry:false};}
 function resolve(id,confirmation){if(!idOk(id)||confirmation!=='CONFIRM_REHEARSAL_ONLY')throw Error('EXPLICIT_REHEARSAL_CONFIRMATION_REQUIRED');const r=unresolved().find(x=>x.payload.intentId===id);if(!r)throw Error('UNKNOWN_OR_RESOLVED_REHEARSAL');append('REHEARSAL_RESOLVED',{intentId:id,reason:'NO_BROKER_WRITE_BY_V61',bootId});return {intentId:id,resolved:true,brokerOrderAllowed:false};}
 function routes(app){const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req));}catch(e){res.status(409).json({error:String(e.message||e).slice(0,200),brokerOrderAllowed:false});}};
 app.get('/api/v61/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
 app.get('/api/v61/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({journalHealthy:healthy,events:rows.slice(-100).map(({at,type,payload})=>({at,type,payload}))}));
 app.post('/api/v61/audit',requireAdmin,wrap(()=>audit()));app.post('/api/v61/prepare-rehearsal',requireAdmin,wrap(req=>prepare(req.body)));app.post('/api/v61/recover',requireAdmin,wrap(()=>recover()));app.post('/api/v61/resolve-rehearsal',requireAdmin,wrap(req=>resolve(req.body?.intentId,req.body?.confirmation)));
 for(const route of ['execute','submit','close','arm','arm-unattended','enable-broker'])app.post('/api/v61/'+route,requireAdmin,(_q,r)=>r.status(409).json({error:'V61_BROKER_DEALING_NOT_CERTIFIED',brokerOrderAllowed:false}));
 app.get('/v61',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v61.html')));
 }
 return {routes,status,audit,prepare,recover,resolve};
}
module.exports={createV61};
