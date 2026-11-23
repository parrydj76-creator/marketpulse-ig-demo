'use strict';
// MarketPulse v76: bounded, read-only, fail-closed unattended readiness monitor.
// This module NEVER calls IG and NEVER places or simulates broker orders.
const fs=require('fs');
const path=require('path');
const MB=1048576;
const LIMIT=120;
function createV76({app,requireAdmin,getState,dataDir,persistentStorage}){
  const startedAt=Date.now();
  const samples=[];
  const journal=[];
  const stateFile=path.join(dataDir,'v76-readiness.json');
  let lastError=null, restored=false, lastPersistAt=null, lastTickAt=null;
  function boundedPush(a,x,max){a.push(x);if(a.length>max)a.splice(0,a.length-max);}
  function restore(){
    if(!persistentStorage)return;
    try{
      const v=JSON.parse(fs.readFileSync(stateFile,'utf8'));
      if(v&&Array.isArray(v.journal))for(const item of v.journal.slice(-LIMIT)){
        if(item&&typeof item.at==='string'&&typeof item.state==='string')boundedPush(journal,item,LIMIT);
      }
      restored=true;
    }catch(e){if(e.code!=='ENOENT')lastError='Readiness journal restore failed: '+e.message;}
  }
  function atomicPersist(){
    if(!persistentStorage)return;
    const tmp=stateFile+'.'+process.pid+'.tmp';
    try{
      fs.mkdirSync(dataDir,{recursive:true});
      fs.writeFileSync(tmp,JSON.stringify({schema:1,journal:journal.slice(-LIMIT)}),{flag:'w',mode:0o600});
      fs.renameSync(tmp,stateFile);
      lastPersistAt=new Date().toISOString();
    }catch(e){lastError='Readiness journal persistence failed: '+e.message;try{fs.rmSync(tmp,{force:true})}catch{}}
  }
  function assess(){
    const now=Date.now();
    const s=getState();
    const blockers=[];
    const add=(code,detail)=>blockers.push({code,detail});
    const memory=process.memoryUsage();
    const rssMB=Math.round(memory.rss/MB),heapUsedMB=Math.round(memory.heapUsed/MB),heapLimitMB=Math.round(memory.heapTotal/MB);
    const marketData=[];
    for(const m of s.markets){
      const q=m.quote;
      const age=q&&Number.isFinite(q.at)?Math.max(0,Math.round((now-q.at)/1000)):null;
      const bars=m.bars||[];
      const recent=bars.slice(-30);
      const consecutive=recent.length===30&&recent.every((b,i)=>Number.isFinite(b.close)&&b.ticks>=2&&Number.isFinite(Date.parse(b.time))&&(i===0||Date.parse(b.time)-Date.parse(recent[i-1].time)===300000));
      const fresh=!!q&&q.source==='STREAM'&&q.marketState==='DEAL'&&age!==null&&age<15;
      const current=consecutive&&now-Date.parse(recent.at(-1).time)<600000;
      marketData.push({epic:m.epic,source:q?.source||null,ageSeconds:age,streamFresh:fresh,consecutive30:consecutive&&current,bars:bars.length,missingBars:Math.max(0,30-bars.length),direction:m.signal?.direction||'UNKNOWN',score:Number(m.signal?.score)||0,readyForShadow:fresh&&consecutive&&current});
    }
    const freshCount=marketData.filter(x=>x.streamFresh).length;
    const shadowCount=marketData.filter(x=>x.readyForShadow).length;
    if(!s.persistenceHealthy)add('STORAGE_UNHEALTHY','Persistent writes are not healthy');
    if(!persistentStorage)add('NO_DURABLE_STORAGE','Persistent storage has not been confirmed');
    if(!s.brokerReconciled)add('BROKER_NOT_RECONCILED','IG DEMO positions have not been reconciled');
    if(freshCount!==marketData.length||!marketData.length)add('STREAM_NOT_FRESH','Not all configured markets have fresh streaming quotes');
    if(shadowCount!==marketData.length)add('CANDLES_NOT_READY','Not all configured markets have 30 consecutive recent five-minute bars');
    if(!s.tradingConfigValid)add('RISK_CONFIG_INVALID','Verified broker dealing size, stops, and spreads are missing');
    if(!s.demoLifecycleVerified)add('DEMO_LIFECYCLE_UNVERIFIED','Broker order lifecycle and recovery have not been independently verified');
    if(!s.brokerExecutionEnabled)add('BROKER_EXECUTION_HARD_BLOCKED','IG broker order execution is intentionally hard-blocked');
    if(s.pendingOrder)add('PENDING_ORDER','A pending broker order needs reconciliation');
    if(s.operatorStop)add('OPERATOR_STOP','Operator stop is set');
    if(lastError)add('MONITOR_PERSISTENCE_ERROR',lastError);
    const maxRssMB=Number(process.env.MP_V76_RSS_WARNING_MB)||400;
    if(rssMB>=maxRssMB)add('MEMORY_WARNING',`RSS ${rssMB} MB exceeds diagnostic warning threshold ${maxRssMB} MB`);
    return {version:'7.6.0',at:new Date(now).toISOString(),uptimeSeconds:Math.round((now-startedAt)/1000),mode:'READ_ONLY_UNATTENDED_READINESS',brokerOrdersAllowed:false,brokerExecutionHardBlocked:!s.brokerExecutionEnabled,unattendedBrokerReady:false,shadowMarketCount:shadowCount,streamFreshCount:freshCount,marketCount:marketData.length,markets:marketData,blockers,memory:{rssMB,heapUsedMB,heapTotalMB:heapLimitMB,externalMB:Math.round(memory.external/MB),rssWarningMB:maxRssMB},storage:{persistentConfigured:persistentStorage,healthy:s.persistenceHealthy,journalRestored:restored,lastPersistAt,lastError},lastTickAt};
  }
  function tick(){
    const snapshot=assess();lastTickAt=snapshot.at;
    boundedPush(samples,{at:snapshot.at,rssMB:snapshot.memory.rssMB,heapUsedMB:snapshot.memory.heapUsedMB,streamFreshCount:snapshot.streamFreshCount,shadowMarketCount:snapshot.shadowMarketCount,blockerCodes:snapshot.blockers.map(b=>b.code)},LIMIT);
    const state=snapshot.blockers.map(b=>b.code).join('|')||'NO_BLOCKERS';
    if(!journal.length||journal.at(-1).state!==state){boundedPush(journal,{at:snapshot.at,state},LIMIT);atomicPersist();}
  }
  restore();
  app.get('/api/v76/readiness',(req,res)=>{res.set('Cache-Control','no-store');res.json(assess());});
  app.get('/api/v76/metrics',requireAdmin,(req,res)=>{res.set('Cache-Control','no-store');res.json({version:'7.6.0',samples,journal,lastTickAt,notes:'Read-only observations; no simulated or IG broker trades are placed by v76.'});});
  const timer=setInterval(()=>{try{tick()}catch(e){lastError='Readiness tick failed: '+e.message;console.error('[V76]',lastError)}},30000);
  timer.unref();
  return {assess,tick};
}
module.exports={createV76};
