'use strict';
// Unattended DEMO readiness rehearsal. No broker order endpoints, imports or writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function validate(rows){if(!Array.isArray(rows))throw Error('INVALID_JOURNAL');let prev='GENESIS';for(const r of rows){if(r.previous!==prev||r.hash!==sha({previous:r.previous,event:r.event}))throw Error('JOURNAL_TAMPERED');prev=r.hash}return prev}
function assess({paper,life,protocol,evidence,observer,now=Date.now()}){
 const blockers=[];
 if(paper?.enabled!==true||paper?.journal?.valid!==true)blockers.push('PAPER_NOT_HEALTHY');
 if(life?.lifecycle?.heartbeat?.healthy!==true||life?.lifecycle?.feedVerified!==true)blockers.push('HEARTBEAT_OR_FEED_UNHEALTHY');
 if(protocol?.journalHealthy!==true||protocol?.protocol?.unresolvedCount!==0)blockers.push('PROTOCOL_UNRESOLVED_OR_UNHEALTHY');
 if(evidence?.journalHealthy!==true||!evidence?.persistentStorageConfigured)blockers.push('EVIDENCE_STORAGE_UNHEALTHY');
 const obs=evidence?.lastObservation;
 if(!obs||!Number.isFinite(Date.parse(obs.observedAt))||now-Date.parse(obs.observedAt)>60000||now<Date.parse(obs.observedAt)-5000)blockers.push('BROKER_EVIDENCE_STALE');
 if(obs?.observationHealthy!==true||obs?.brokerPositionCount!==0||obs?.unresolvedProtocolIntents!==0)blockers.push('BROKER_EXPOSURE_OR_RECONCILIATION');
 if(observer?.observationHealthy!==true||observer?.observationFresh!==true)blockers.push('OBSERVER_NOT_FRESH');
 return {rehearsalEligible:blockers.length===0,blockers,brokerOrderAllowed:false,brokerCertified:false};
}
function createV43({requireAdmin,storageDir,persistentStorage,v36Status,v39Status,v40Status,v41Status,v42Status}){
 const file=path.join(storageDir,'v43-unattended-rehearsal.json');let rows=[],healthy=true,error=null,armed=false,busy=false,lastCycle=null,cycles=0;
 try{if(fs.existsSync(file)){rows=JSON.parse(fs.readFileSync(file,'utf8'));validate(rows)}}catch(e){healthy=false;error=e.message}
 const dependencies=()=>assess({paper:v36Status(),life:v39Status(),protocol:v40Status(),observer:v41Status(),evidence:v42Status()});
 function append(event){if(!healthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_REQUIRED');const previous=rows.at(-1)?.hash||'GENESIS';const next=[...rows,{previous,event,hash:sha({previous,event})}];const tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const dir=fs.openSync(storageDir,'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}validate(next);rows=next}catch(e){healthy=false;error=e.message;armed=false;throw e}}
 function status(){let readiness;try{readiness=dependencies()}catch(e){readiness={rehearsalEligible:false,blockers:['DEPENDENCY_EXCEPTION'],brokerOrderAllowed:false}}return {version:'43.0.0',mode:'UNATTENDED_IG_DEMO_SAFETY_REHEARSAL_ONLY',armed,armedAfterRestart:false,cycleCount:cycles,lastCycle,journalHealthy:healthy,persistentStorageConfigured:!!persistentStorage,journalEvents:rows.length,journalHead:healthy?validate(rows):null,readiness,error,certifications:{gbpSizing:false,brokerLifecycle:false,crashRecovery:false},readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,warning:'Rehearsal cannot place IG orders. Every process restart disarms rehearsal.'}}
 function arm(note){if(!healthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_REQUIRED');if(typeof note!=='string'||note.trim().length<16)throw Error('OPERATOR_NOTE_REQUIRED');const r=dependencies();if(!r.rehearsalEligible)throw Error('READINESS_BLOCKED:'+r.blockers.join(','));append({id:crypto.randomUUID(),kind:'ARM_REHEARSAL',at:new Date().toISOString(),note:note.slice(0,200)});armed=true;return status()}
 function disarm(reason='OPERATOR_STOP'){armed=false;if(healthy&&persistentStorage)append({id:crypto.randomUUID(),kind:'DISARM',at:new Date().toISOString(),reason:String(reason).slice(0,160)});return status()}
 function cycle(){if(busy)throw Error('CYCLE_BUSY');busy=true;try{const r=dependencies();cycles++;lastCycle=new Date().toISOString();if(!armed)return {action:'NOT_ARMED',...status()};if(!r.rehearsalEligible){armed=false;append({id:crypto.randomUUID(),kind:'AUTO_DISARM',at:lastCycle,blockers:r.blockers});return {action:'AUTO_DISARM',...status()}}append({id:crypto.randomUUID(),kind:'SAFE_REHEARSAL_TICK',at:lastCycle,checksPassed:true,simulationOnly:true});return {action:'SIMULATED_CHECK_ONLY',...status()}}finally{busy=false}}
 // 30-second independent safety watchdog; never auto-arm, never send broker orders.
 const timer=setInterval(()=>{if(armed){try{cycle()}catch(e){armed=false;error=String(e.message).slice(0,160)}}},30000);timer.unref?.();
 function routes(app){const fail=(r,e)=>r.status(409).set('Cache-Control','no-store').json({error:String(e.message||e),brokerOrderAllowed:false});app.get('/api/v43/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v43/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:rows.map((x,i)=>({index:i+1,kind:x.event.kind,at:x.event.at,hash:x.hash})),brokerOrderAllowed:false}));app.post('/api/v43/arm-rehearsal',requireAdmin,(q,r)=>{try{r.json(arm(q.body?.operatorNote))}catch(e){fail(r,e)}});app.post('/api/v43/disarm',requireAdmin,(_q,r)=>{try{r.json(disarm())}catch(e){fail(r,e)}});app.post('/api/v43/cycle',requireAdmin,(_q,r)=>{try{r.json(cycle())}catch(e){fail(r,e)}});app.get('/v43',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v43.html')))}
 return {routes,status,arm,disarm,cycle};
}
module.exports={createV43,assess,validate};
