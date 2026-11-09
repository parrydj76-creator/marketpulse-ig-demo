 'use strict';
// V44 automated READ-ONLY IG DEMO soak testing. No broker order transport.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function verify(rows){let head='GENESIS';if(!Array.isArray(rows))throw Error('INVALID_JOURNAL');for(const row of rows){if(row.previous!==head||row.hash!==digest({previous:row.previous,event:row.event}))throw Error('JOURNAL_TAMPERED');head=row.hash}return head}
function evaluate({observer,evidence,paper,lifecycle,protocol,now=Date.now()}){const issues=[];
 if(paper?.enabled!==true||paper?.journal?.valid!==true)issues.push('PAPER_UNHEALTHY');
 if(lifecycle?.lifecycle?.heartbeat?.healthy!==true||lifecycle?.lifecycle?.feedVerified!==true)issues.push('PAPER_FEED_UNHEALTHY');
 if(protocol?.journalHealthy!==true||protocol?.protocol?.unresolvedCount!==0)issues.push('PROTOCOL_UNHEALTHY');
 if(evidence?.journalHealthy!==true||evidence?.persistentStorageConfigured!==true)issues.push('EVIDENCE_JOURNAL_UNHEALTHY');
 const obs=evidence?.lastObservation;const age=obs?.observedAt?now-Date.parse(obs.observedAt):Infinity;
 if(!Number.isFinite(age)||age< -5000||age>60000)issues.push('BROKER_EVIDENCE_STALE');
 if(obs?.observationHealthy!==true||obs?.brokerPositionCount!==0||obs?.unresolvedProtocolIntents!==0)issues.push('BROKER_EXPOSURE_OR_RECONCILIATION');
 if(observer?.observationFresh!==true||observer?.observationHealthy!==true)issues.push('OBSERVER_UNHEALTHY');
 return {healthy:issues.length===0,issues,brokerOrderAllowed:false};}
function createV44({requireAdmin,storageDir,persistentStorage,v36Status,v39Status,v40Status,v41Status,v42Status,refresh41,refresh42,intervalMs=30000}){
 const file=path.join(storageDir,'v44-soak-evidence.json');let rows=[],healthy=true,error=null,armed=false,busy=false,cycleCount=0,successCount=0,failureCount=0,lastCycle=null,startedAt=null;
 try{if(fs.existsSync(file)){rows=JSON.parse(fs.readFileSync(file,'utf8'));verify(rows)}}catch(e){healthy=false;error=e.message}
 const assess=()=>evaluate({observer:v41Status(),evidence:v42Status(),paper:v36Status(),lifecycle:v39Status(),protocol:v40Status()});
 function append(event){if(!healthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_REQUIRED');const previous=rows.at(-1)?.hash||'GENESIS';const next=[...rows,{previous,event,hash:digest({previous,event})}];const tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const d=fs.openSync(storageDir,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}verify(next);rows=next}catch(e){healthy=false;error=e.message;armed=false;throw e}}
 function status(){let readiness;try{readiness=assess()}catch(e){readiness={healthy:false,issues:['DEPENDENCY_EXCEPTION'],brokerOrderAllowed:false}}return {version:'44.0.0',mode:'AUTOMATED_READ_ONLY_IG_DEMO_SOAK',armed,armedAfterRestart:false,busy,intervalMs,cycleCount,successCount,failureCount,lastCycle,startedAt,journalHealthy:healthy,persistentStorageConfigured:!!persistentStorage,journalEvents:rows.length,journalHead:healthy?verify(rows):null,readiness,error,certifications:{gbpSizing:false,brokerLifecycle:false,crashRecovery:false},readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,warning:'Automated broker GET observations only; no IG order writes. Re-arm manually after every restart.'}}
 function arm(note){if(busy)throw Error('CYCLE_BUSY');if(!healthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_REQUIRED');if(typeof note!=='string'||note.trim().length<16)throw Error('OPERATOR_NOTE_REQUIRED');if(armed)throw Error('ALREADY_ARMED');const r=assess();if(!r.healthy)throw Error('READINESS_BLOCKED:'+r.issues.join(','));append({kind:'ARM_READ_ONLY_SOAK',at:new Date().toISOString(),note:note.slice(0,200)});armed=true;startedAt=new Date().toISOString();return status()}
 function disarm(reason='OPERATOR_STOP'){armed=false;if(healthy&&persistentStorage)append({kind:'DISARM',at:new Date().toISOString(),reason:String(reason).slice(0,160)});return status()}
 async function cycle(){if(busy)throw Error('CYCLE_BUSY');if(!armed)return {action:'NOT_ARMED',...status()};busy=true;let action='SAFE_READ_ONLY_TICK';try{
 // Read-only observations refreshed sequentially to respect separate API rate limits.
 await refresh41();await refresh42();const r=assess();cycleCount++;lastCycle=new Date().toISOString();if(!r.healthy){failureCount++;armed=false;action='AUTO_DISARM';append({kind:'AUTO_DISARM',at:lastCycle,issues:r.issues});}else{successCount++;append({kind:'SAFE_READ_ONLY_TICK',at:lastCycle,brokerOrderAllowed:false});}
 }catch(e){cycleCount++;failureCount++;lastCycle=new Date().toISOString();armed=false;action='AUTO_DISARM';error=String(e.message||e).slice(0,160);try{append({kind:'AUTO_DISARM',at:lastCycle,issues:['REFRESH_OR_JOURNAL_ERROR'],detail:error})}catch(_e){healthy=false}}
 finally{busy=false}return {action,...status()}}
 const timer=setInterval(()=>{if(armed&&!busy)void cycle()},intervalMs);timer.unref?.();
 function routes(app){const fail=(r,e)=>r.status(409).set('Cache-Control','no-store').json({error:String(e.message||e),brokerOrderAllowed:false});app.get('/api/v44/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v44/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:rows.map((x,i)=>({index:i+1,kind:x.event.kind,at:x.event.at,issues:x.event.issues||[],hash:x.hash})),brokerOrderAllowed:false}));app.post('/api/v44/arm',requireAdmin,(q,r)=>{try{r.json(arm(q.body?.operatorNote))}catch(e){fail(r,e)}});app.post('/api/v44/disarm',requireAdmin,(_q,r)=>{try{r.json(disarm())}catch(e){fail(r,e)}});app.post('/api/v44/cycle',requireAdmin,async(_q,r)=>{try{r.json(await cycle())}catch(e){fail(r,e)}});app.get('/v44',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v44.html')))}
 return {routes,status,arm,disarm,cycle};}
module.exports={createV44,evaluate,verify};
