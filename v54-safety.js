 'use strict';
// This module intentionally has NO order submission implementation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{6,80}$/.test(x);
function allowIGRequest(method,url){
 const m=String(method||'GET').toUpperCase(),p=String(url||'').split('?')[0];
 // Only login is permitted to POST; all other broker mutations are prohibited.
 return m==='GET'||(m==='POST'&&p==='/session');
}
function validateProposal(p){
 if(!p||typeof p!=='object'||Array.isArray(p))throw Error('INVALID_PROPOSAL');
 if(p.epic!==EPIC||!['BUY','SELL'].includes(p.direction))throw Error('MINI_EPIC_OR_DIRECTION_INVALID');
 if(!validId(p.clientIntentId))throw Error('CLIENT_INTENT_ID_REQUIRED');
 const size=Number(p.size),stopPips=Number(p.stopPips),fx=Number(p.usdToGbp),pipUsd=Number(p.pipUsdPerFullSize);
 if(!Number.isFinite(size)||size<=0||!Number.isFinite(stopPips)||stopPips<=0)throw Error('SIZE_OR_STOP_INVALID');
 if(!Number.isFinite(fx)||fx<=0||fx>2||!Number.isFinite(pipUsd)||pipUsd<=0)throw Error('FX_AND_PIP_VALUE_REQUIRED');
 // Indicative only; IG's deal-size and stop-point semantics still require independent validation.
 const indicativeGBP=Math.round(size*stopPips*fx*pipUsd*100)/100;
 if(indicativeGBP>25)throw Error('INDICATIVE_RISK_ABOVE_25_GBP');
 return {clientIntentId:p.clientIntentId,epic:EPIC,direction:p.direction,size,stopPips,usdToGbp:fx,pipUsdPerFullSize:pipUsd,indicativeGBP};
}
function createV54({requireAdmin,storageDir,persistentStorage,readBroker}){
 const bootId=crypto.randomUUID(),file=path.join(storageDir,'v54-safety.jsonl');let healthy=!!persistentStorage,error=null,rows=[];
 try{if(healthy){fs.mkdirSync(storageDir,{recursive:true});if(fs.existsSync(file)){let prev='GENESIS';for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.prev!==prev||r.hash!==digest({prev:r.prev,at:r.at,type:r.type,payload:r.payload}))throw Error('JOURNAL_INTEGRITY_FAILED');rows.push(r);prev=r.hash}}}}catch(e){healthy=false;error=e.message}
 function append(type,payload){if(!healthy)throw Error('PERSISTENT_JOURNAL_UNAVAILABLE');const r={prev:rows.at(-1)?.hash||'GENESIS',at:new Date().toISOString(),type,payload};r.hash=digest(r);try{fs.appendFileSync(file,JSON.stringify(r)+'\n',{flag:'a'});rows.push(r)}catch(e){healthy=false;error=e.message;throw e}return r}
 const latest=t=>[...rows].reverse().find(r=>r.type===t);
 const stopped=()=>!!latest('EMERGENCY_STOP')&&(latest('EMERGENCY_STOP').at>=(latest('RESET_MONITOR')?.at||''));
 function status(){return {version:'54.0.0',mode:'PRE_EXECUTION_SAFETY_HARNESS',epic:EPIC,bootId,persistentStorageConfigured:!!persistentStorage,journalHealthy:healthy,journalEvents:rows.length,lastError:error,emergencyStop:stopped(),proposalCount:rows.filter(r=>r.type==='PROPOSAL').length,unresolvedIntents:rows.filter(r=>r.type==='PROPOSAL').length,certifications:{gbpSizing:false,brokerLifecycle:false,unknownOrderRecovery:false,unattendedAdapter:false},brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,readyForUnattendedDemo:false}}
 async function propose(p){if(stopped())throw Error('EMERGENCY_STOP_ACTIVE');if(!healthy)throw Error('PERSISTENT_JOURNAL_UNAVAILABLE');const v=validateProposal(p);if(rows.some(r=>r.type==='PROPOSAL'&&r.payload.clientIntentId===v.clientIntentId))throw Error('DUPLICATE_INTENT');const broker=await readBroker();if(broker.currency!=='GBP'||!broker.accountFingerprint)throw Error('ACCOUNT_MISMATCH');if(broker.positions.some(x=>x.epic===EPIC))throw Error('EXISTING_MINI_POSITION');const existing=rows.filter(r=>r.type==='PROPOSAL'&&r.payload.accountFingerprint===broker.accountFingerprint);if(existing.length)throw Error('UNRESOLVED_PRIOR_INTENT_REQUIRES_OPERATOR_REVIEW');append('PROPOSAL',{...v,accountFingerprint:broker.accountFingerprint,bootId,execution:'NEVER_SUBMITTED'});return {acceptedForReview:true,submittedToBroker:false,indicativeRiskGBP:v.indicativeGBP,certified:false,brokerOrderAllowed:false}}
 async function reconcile(){const broker=await readBroker();if(broker.currency!=='GBP'||!broker.accountFingerprint)throw Error('ACCOUNT_MISMATCH');const mini=broker.positions.filter(p=>p.epic===EPIC);const unsafe=mini.filter(p=>p.stopLevel==null||p.limitLevel==null);append('BROKER_READBACK',{bootId,accountFingerprint:broker.accountFingerprint,positions:mini,unprotectedCount:unsafe.length});return {miniPositions:mini.length,unprotectedDealIds:unsafe.map(x=>x.dealId),historicalProposalCount:rows.filter(r=>r.type==='PROPOSAL').length,unknownOrderOutcomesCertified:false,brokerOrderAllowed:false,warning:'Readback does not prove an in-flight submission was not accepted.'}}
 function routes(app){const fail=(r,e)=>r.status(409).json({error:String(e.message||e).slice(0,160),brokerOrderAllowed:false});app.get('/api/v54/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v54/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({journalHealthy:healthy,events:rows.slice(-100).map(x=>({at:x.at,type:x.type,hash:x.hash}))}));
 app.post('/api/v54/propose',requireAdmin,async(q,r)=>{try{r.json(await propose(q.body))}catch(e){fail(r,e)}});
 app.post('/api/v54/reconcile',requireAdmin,async(_q,r)=>{try{r.json(await reconcile())}catch(e){fail(r,e)}});
 app.post('/api/v54/emergency-stop',requireAdmin,(_q,r)=>{try{append('EMERGENCY_STOP',{bootId});r.json({emergencyStop:true,brokerOrderAllowed:false,warning:'Does not close existing broker positions.'})}catch(e){fail(r,e)}});
 app.post('/api/v54/arm-unattended',requireAdmin,(_q,r)=>r.status(409).json({error:'CERTIFICATION_AND_BROKER_WRITE_ADAPTER_NOT_COMPLETE',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false}));
 app.get('/v54',(_q,r)=>r.sendFile(path.join(__dirname,'public','v54.html')))}
 return {routes,status,propose,reconcile};
}
module.exports={allowIGRequest,validateProposal,createV54,EPIC};
