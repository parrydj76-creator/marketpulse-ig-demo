'use strict';
// V46 read-only IG DEMO soak: completed-refresh validation, durable diagnostic evidence, fail-closed.
// No order transport, no certification, no automatic broker execution.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function verify(rows){let head='GENESIS';if(!Array.isArray(rows))throw Error('INVALID_JOURNAL');for(const row of rows){if(row.previous!==head||row.hash!==sha({previous:row.previous,event:row.event}))throw Error('JOURNAL_TAMPERED');head=row.hash}return head}
const age=(stamp,now)=>{const t=Date.parse(stamp||'');return Number.isFinite(t)?now-t:null};
function evaluate({observer,evidence,paper,lifecycle,protocol,refresh41Result,refresh42Result,cycleStartedAt,now=Date.now(),maxAgeMs=60000}){
 const issues=[];const details={};
 if(paper?.enabled!==true||paper?.journal?.valid!==true)issues.push('PAPER_UNHEALTHY');
 if(lifecycle?.lifecycle?.heartbeat?.healthy!==true||lifecycle?.lifecycle?.feedVerified!==true)issues.push('PAPER_FEED_UNHEALTHY');
 if(protocol?.journalHealthy!==true||protocol?.protocol?.unresolvedCount!==0)issues.push('PROTOCOL_UNHEALTHY');
 if(evidence?.journalHealthy!==true||evidence?.persistentStorageConfigured!==true)issues.push('EVIDENCE_JOURNAL_UNHEALTHY');
 const obs=observer?.observation,ev=evidence?.lastObservation;
 details.observerAgeMs=age(obs?.observedAt,now);details.evidenceAgeMs=age(ev?.observedAt,now);
 details.refresh41AgeMs=age(refresh41Result?.observedAt,now);details.refresh42AgeMs=age(refresh42Result?.observedAt,now);
 details.observerFresh=observer?.observationFresh===true;details.observerHealthy=observer?.observationHealthy===true;
 details.observerObservedAt=obs?.observedAt||null;details.evidenceObservedAt=ev?.observedAt||null;
 details.refresh41ObservedAt=refresh41Result?.observedAt||null;details.refresh42ObservedAt=refresh42Result?.observedAt||null;
 const fresh=x=>x!==null&&x>=-5000&&x<=maxAgeMs;
 if(!fresh(details.evidenceAgeMs))issues.push('BROKER_EVIDENCE_STALE');
 if(!fresh(details.observerAgeMs)||!details.observerFresh||!details.observerHealthy)issues.push('OBSERVER_UNHEALTHY');
 if(ev?.observationHealthy!==true||ev?.brokerPositionCount!==0||ev?.unresolvedProtocolIntents!==0||obs?.brokerPositionCount!==0||obs?.observationHealthy!==true)issues.push('BROKER_EXPOSURE_OR_RECONCILIATION');
 if(cycleStartedAt!==undefined){
  const started=Date.parse(cycleStartedAt);const isCurrent=stamp=>Number.isFinite(Date.parse(stamp||''))&&Date.parse(stamp)>=started-5000;
  if(!isCurrent(refresh41Result?.observedAt)||!isCurrent(refresh42Result?.observedAt))issues.push('REFRESH_NOT_FROM_CURRENT_CYCLE');
  if(!fresh(details.refresh41AgeMs)||!fresh(details.refresh42AgeMs))issues.push('REFRESH_RESULT_STALE');
  if(refresh41Result?.observationHealthy!==true||refresh42Result?.observationHealthy!==true)issues.push('REFRESH_RESULT_UNHEALTHY');
  if(obs?.observedAt!==refresh41Result?.observedAt||ev?.observedAt!==refresh42Result?.observedAt)issues.push('REFRESH_STATUS_MISMATCH');
 }
 return {healthy:issues.length===0,issues,details,brokerOrderAllowed:false};
}
function createV46({requireAdmin,storageDir,persistentStorage,v36Status,v39Status,v40Status,v41Status,v42Status,v44Status,v45Status,refresh41,refresh42,intervalMs=30000,maxAgeMs=60000,minRefreshGapMs=12000,tickMs=1000,clock=()=>Date.now(),enableTimer=true}){
 const file=path.join(storageDir,'v46-soak-evidence.json');let rows=[],journalHealthy=true,error=null,armed=false,busy=false,cycleCount=0,successCount=0,failureCount=0,lastCycle=null,startedAt=null,lastDiagnostic=null,nextCycleAt=null,lastRefreshAttemptAt=null,deferralCount=0;
 try{if(fs.existsSync(file)){rows=JSON.parse(fs.readFileSync(file,'utf8'));verify(rows)}}catch(e){journalHealthy=false;error=e.message}
 const assess=(extra={})=>evaluate({observer:v41Status(),evidence:v42Status(),paper:v36Status(),lifecycle:v39Status(),protocol:v40Status(),now:clock(),maxAgeMs,...extra});
 function append(event){if(!journalHealthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_REQUIRED');const previous=rows.at(-1)?.hash||'GENESIS';const next=[...rows,{previous,event,hash:sha({previous,event})}];const tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const d=fs.openSync(storageDir,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}verify(next);rows=next}catch(e){journalHealthy=false;error=e.message;armed=false;throw e}}
 const legacyArmed=()=>Boolean(v44Status?.().armed||v45Status?.().armed);
 function lastObservedTime(){const stamps=[v41Status()?.observation?.observedAt,v42Status()?.lastObservation?.observedAt];return Math.max(0,...stamps.map(s=>Date.parse(s||'')||0));}
 function nextAllowedTime(now=clock()){return Math.max(now,lastObservedTime()+minRefreshGapMs,(lastRefreshAttemptAt||0)+minRefreshGapMs);}
 function schedule(now=clock(),immediate=false){nextCycleAt=immediate?nextAllowedTime(now):Math.max(now+intervalMs,nextAllowedTime(now));}
 function status(){let readiness;try{readiness=assess();if(legacyArmed()){readiness.healthy=false;readiness.issues.push('LEGACY_MONITOR_ALREADY_ARMED')}}catch(e){readiness={healthy:false,issues:['DEPENDENCY_EXCEPTION'],details:{error:String(e.message).slice(0,120)},brokerOrderAllowed:false}}return {version:'46.0.0',mode:'RATE_LIMIT_AWARE_READ_ONLY_IG_DEMO_SOAK',armed,armedAfterRestart:false,busy,intervalMs,minRefreshGapMs,nextCycleAt:nextCycleAt?new Date(nextCycleAt).toISOString():null,nextAllowedRefreshAt:new Date(nextAllowedTime()).toISOString(),deferralCount,cycleCount,successCount,failureCount,lastCycle,startedAt,lastDiagnostic,journalHealthy,persistentStorageConfigured:!!persistentStorage,journalEvents:rows.length,journalHead:journalHealthy?verify(rows):null,readiness,error,certifications:{gbpSizing:false,brokerLifecycle:false,crashRecovery:false},readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,warning:'Read-only broker GET observations. No order writes. Re-arm manually after restart.'}}
 function arm(note){if(busy||armed)throw Error('BUSY_OR_ALREADY_ARMED');if(!journalHealthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_REQUIRED');if(typeof note!=='string'||note.trim().length<16)throw Error('OPERATOR_NOTE_REQUIRED');const r=status().readiness;if(!r.healthy)throw Error('READINESS_BLOCKED:'+r.issues.join(','));append({kind:'ARM_READ_ONLY_SOAK',at:new Date().toISOString(),note:note.slice(0,200)});armed=true;startedAt=new Date().toISOString();schedule(clock(),true);return status()}
 function disarm(reason='OPERATOR_STOP'){armed=false;nextCycleAt=null;if(journalHealthy&&persistentStorage)append({kind:'DISARM',at:new Date().toISOString(),reason:String(reason).slice(0,160)});return status()}
 async function cycle(){if(busy)throw Error('CYCLE_BUSY');if(!armed)return {action:'NOT_ARMED',...status()};
 const now=clock(),allowed=nextAllowedTime(now);
 if(now<allowed){deferralCount++;nextCycleAt=allowed;return {action:'RATE_LIMIT_WAIT',...status()};}
 busy=true;nextCycleAt=null;const began=new Date().toISOString();let action='SAFE_READ_ONLY_TICK';try{
  if(legacyArmed())throw Error('LEGACY_MONITOR_ALREADY_ARMED');
  lastRefreshAttemptAt=clock();
  // Explicitly await each read-only broker refresh, then verify returned observations match committed status.
  const r41=await refresh41();const r42=await refresh42();const diagnostic=assess({refresh41Result:r41,refresh42Result:r42,cycleStartedAt:began});
  lastDiagnostic={at:new Date().toISOString(),issues:diagnostic.issues,details:diagnostic.details};cycleCount++;lastCycle=lastDiagnostic.at;
  if(!diagnostic.healthy){failureCount++;armed=false;action='AUTO_DISARM';append({kind:'AUTO_DISARM',at:lastCycle,issues:diagnostic.issues,details:diagnostic.details,brokerOrderAllowed:false})}
  else{successCount++;append({kind:'SAFE_READ_ONLY_TICK',at:lastCycle,details:diagnostic.details,brokerOrderAllowed:false})}
 }catch(e){
  // A known short-lived observer throttle is a scheduling condition, not a broker safety failure.
  // Never mask stale evidence or unhealthy dependencies while waiting.
  const message=String(e.message||e).slice(0,160);
  if(/^(BROKER_OBSERVATION_RATE_LIMIT_10_SECONDS|OBSERVATION_RATE_LIMIT_10_SECONDS)$/.test(message)){
   const r=assess();if(r.healthy&&journalHealthy&&persistentStorage&&!legacyArmed()){
    deferralCount++;nextCycleAt=Math.max(clock()+minRefreshGapMs,nextAllowedTime());
    lastDiagnostic={at:new Date().toISOString(),issues:['RATE_LIMIT_DEFERRED'],details:{error:message,nextCycleAt:new Date(nextCycleAt).toISOString()}};
    action='RATE_LIMIT_WAIT';try{append({kind:'RATE_LIMIT_DEFERRED',at:lastDiagnostic.at,details:lastDiagnostic.details,brokerOrderAllowed:false})}catch(_e){armed=false;journalHealthy=false}
    return {action,...status()};
   }
  }
  cycleCount++;failureCount++;lastCycle=new Date().toISOString();armed=false;nextCycleAt=null;action='AUTO_DISARM';error=message;lastDiagnostic={at:lastCycle,issues:['REFRESH_OR_JOURNAL_ERROR'],details:{error}};try{append({kind:'AUTO_DISARM',at:lastCycle,issues:lastDiagnostic.issues,details:lastDiagnostic.details,brokerOrderAllowed:false})}catch(_e){journalHealthy=false}}
 finally{busy=false;if(armed&&nextCycleAt===null)schedule(clock())}return {action,...status()}}
 const timer=enableTimer?setInterval(()=>{
  if(!armed||busy||nextCycleAt===null)return;
  // Fail closed if the broker observations expire before a permitted refresh.
  const r=assess();if(!r.healthy){armed=false;nextCycleAt=null;failureCount++;cycleCount++;lastCycle=new Date().toISOString();lastDiagnostic={at:lastCycle,issues:r.issues,details:r.details};
   try{append({kind:'AUTO_DISARM',at:lastCycle,issues:r.issues,details:r.details,brokerOrderAllowed:false})}catch(_e){journalHealthy=false}return;}
  if(clock()>=nextCycleAt)void cycle();
 },tickMs):null;timer?.unref?.();
 function events(){return rows.map((x,i)=>({index:i+1,kind:x.event.kind,at:x.event.at,issues:x.event.issues||[],details:x.event.details||null,hash:x.hash}))}
 function routes(app){const fail=(r,e)=>r.status(409).set('Cache-Control','no-store').json({error:String(e.message||e),brokerOrderAllowed:false});app.get('/api/v46/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v46/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:events(),brokerOrderAllowed:false}));app.post('/api/v46/arm',requireAdmin,(q,r)=>{try{r.json(arm(q.body?.operatorNote))}catch(e){fail(r,e)}});app.post('/api/v46/disarm',requireAdmin,(_q,r)=>{try{r.json(disarm())}catch(e){fail(r,e)}});app.post('/api/v46/cycle',requireAdmin,async(_q,r)=>{try{r.json(await cycle())}catch(e){fail(r,e)}});app.get('/v46',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v46.html')))}
 return {routes,status,arm,disarm,cycle,events};
}
module.exports={createV46,evaluate,verify};
