 'use strict';
// MarketPulse v77: passive shadow signal evidence, memory trends and candle recovery checks.
// Never invokes IG APIs, places broker orders, opens simulated positions or changes safety gates.
const fs=require('fs');
const path=require('path');
const MB=1048576,MAX_EVENTS=100,MAX_SAMPLES=120,FIVE=300000;
function createV77({app,requireAdmin,dataDir,persistentStorage,getState}){
 const file=path.join(dataDir,'v77-shadow-evidence.json');
 const startedAt=new Date().toISOString();
 let restored=false,restoreError=null,lastPersistAt=null,lastPersistError=null,lastTickAt=null;
 let lastCandleFingerprint=null,writeCount=0;
 const events=[],samples=[],lastSignals=new Map();
 const safePush=(arr,item,max)=>{arr.push(item);if(arr.length>max)arr.splice(0,arr.length-max);};
 function restore(){
  if(!persistentStorage)return;
  try{
   const obj=JSON.parse(fs.readFileSync(file,'utf8'));
   if(obj.schema!==1||!Array.isArray(obj.events))throw Error('Invalid evidence schema');
   for(const e of obj.events.slice(-MAX_EVENTS))if(e&&typeof e.at==='string'&&typeof e.epic==='string'&&typeof e.direction==='string')safePush(events,e,MAX_EVENTS);
   restored=true;
  }catch(e){if(e.code!=='ENOENT')restoreError=e.message;}
 }
 function persist(){
  if(!persistentStorage)return;
  const tmp=file+'.'+process.pid+'.tmp';
  try{
   fs.mkdirSync(dataDir,{recursive:true});
   fs.writeFileSync(tmp,JSON.stringify({schema:1,events}),{mode:0o600});
   fs.renameSync(tmp,file);lastPersistAt=new Date().toISOString();lastPersistError=null;writeCount++;
  }catch(e){lastPersistError=e.message;try{fs.rmSync(tmp,{force:true})}catch{}}
 }
 function marketStatus(m,now){
  const bars=Array.isArray(m.bars)?m.bars:[];
  const tail=bars.slice(-30);
  const consecutive=tail.length===30&&tail.every((b,i)=>b&&Number.isFinite(b.close)&&Number.isFinite(b.ticks)&&b.ticks>=2&&Number.isFinite(Date.parse(b.time))&&(i===0||Date.parse(b.time)-Date.parse(tail[i-1].time)===FIVE));
  const recent=consecutive&&now-Date.parse(tail.at(-1).time)<600000;
  const age=m.quote&&Number.isFinite(m.quote.at)?Math.max(0,Math.round((now-m.quote.at)/1000)):null;
  const fresh=m.quote?.source==='STREAM'&&m.quote?.marketState==='DEAL'&&age!==null&&age<15;
  const signal=m.signal||{};
  const direction=['LONG','SHORT','WAIT','WARMING','STALE'].includes(signal.direction)?signal.direction:'UNKNOWN';
  const score=Number.isFinite(signal.score)?signal.score:0;
  return {epic:m.epic,bars:bars.length,missingBars:Math.max(0,30-bars.length),consecutive30:!!recent,streamFresh:!!fresh,ageSeconds:age,direction,score,shadowEligible:!!(fresh&&recent&&['LONG','SHORT'].includes(direction)&&score>=70),lastCompletedBar:bars.at(-1)?.time||null};
 }
 function candleDisk(s){
  try{
   const st=fs.statSync(s.candleFile);
   return {exists:true,bytes:st.size,lastModifiedAt:st.mtime.toISOString(),ageSeconds:Math.round((Date.now()-st.mtimeMs)/1000)};
  }catch(e){return {exists:false,error:e.code||e.message};}
 }
 function assess(){
  const now=Date.now(),s=getState(),mem=process.memoryUsage();
  const markets=s.markets.map(m=>marketStatus(m,now));
  const blockers=[];
  if(!persistentStorage)blockers.push('NO_CONFIRMED_PERSISTENT_STORAGE');
  if(!s.persistenceHealthy)blockers.push('STORAGE_UNHEALTHY');
  if(!s.brokerReconciled)blockers.push('BROKER_NOT_RECONCILED');
  if(markets.some(m=>!m.consecutive30))blockers.push('CANDLES_NOT_READY');
  if(markets.some(m=>!m.streamFresh))blockers.push('STREAM_STALE');
  if(Math.round(mem.rss/MB)>=400)blockers.push('MEMORY_WARNING');
  if(restoreError||lastPersistError)blockers.push('SHADOW_EVIDENCE_STORAGE_ERROR');
  return {version:'7.7.0',at:new Date(now).toISOString(),mode:'PASSIVE_SHADOW_EVIDENCE',brokerOrdersAllowed:false,brokerExecutionHardBlocked:!s.brokerExecutionEnabled,shadowSignalsOnly:true,markets,shadowEligibleCount:markets.filter(m=>m.shadowEligible).length,blockers,memory:{rssMB:Math.round(mem.rss/MB),heapUsedMB:Math.round(mem.heapUsed/MB),heapTotalMB:Math.round(mem.heapTotal/MB),externalMB:Math.round(mem.external/MB),arrayBuffersMB:Math.round((mem.arrayBuffers||0)/MB),headroomTo512MB:512-Math.round(mem.rss/MB)},recovery:{persistentConfigured:persistentStorage,storageHealthy:s.persistenceHealthy,evidenceJournalRestored:restored,restoreError,lastPersistAt,lastPersistError,writeCount,candleFile:candleDisk(s)},lastTickAt};
 }
 function tick(){
  const status=assess();lastTickAt=status.at;
  safePush(samples,{at:status.at,rssMB:status.memory.rssMB,heapUsedMB:status.memory.heapUsedMB,shadowEligibleCount:status.shadowEligibleCount,streamFreshCount:status.markets.filter(m=>m.streamFresh).length},MAX_SAMPLES);
  let changed=false;
  for(const m of status.markets){
   const key=m.direction+'|'+m.score+'|'+m.shadowEligible;
   if(lastSignals.get(m.epic)!==key){
    lastSignals.set(m.epic,key);
    // Record only actionable signal transitions; no orders or paper positions.
    if(m.shadowEligible){safePush(events,{at:status.at,epic:m.epic,direction:m.direction,score:m.score,lastCompletedBar:m.lastCompletedBar,kind:'SHADOW_SIGNAL_ONLY'},MAX_EVENTS);changed=true;}
   }
  }
  if(changed)persist();
 }
 restore();
 app.get('/api/v77/readiness',(req,res)=>{res.set('Cache-Control','no-store');res.json(assess());});
 app.get('/api/v77/diagnostics',requireAdmin,(req,res)=>{res.set('Cache-Control','no-store');res.json({version:'7.7.0',startedAt,samples,events,lastTickAt,restoreError,lastPersistError,notes:'Signals are observational only. No broker or paper orders.'});});
 const timer=setInterval(()=>{try{tick()}catch(e){console.error('[V77] passive monitor:',e.message)}},30000);timer.unref();
 return {assess,tick};
}
module.exports={createV77};
