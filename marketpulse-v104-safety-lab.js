 'use strict';
// v10.1-v10.4: on-demand evidence only. NO broker write path or permission grants.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fileName='v95-kill-latch.json';
function diskState(dir){
 try{const p=path.join(dir,fileName),b=fs.readFileSync(p);if(b.length>16384)throw Error('OVERSIZED_LATCH_FILE');
 const s=JSON.parse(b.toString('utf8'));return {readable:true,active:s.active===true,revision:Number.isSafeInteger(s.revision)?s.revision:null,sha256:crypto.createHash('sha256').update(b).digest('hex'),bytes:b.length};}
 catch(e){return {readable:false,active:false,revision:null,error:e.code==='ENOENT'?'LATCH_FILE_MISSING':'LATCH_FILE_UNREADABLE'}}
}
function decide({disk,legacy,durable,storageHealthy,memoryMB,freshFeeds}){
 const failures=[];if(!disk.readable||!disk.active)failures.push('DURABLE_LATCH_MISSING_OR_INACTIVE');
 if(!durable.active||durable.persisted!==true||disk.revision!==durable.revision)failures.push('DURABLE_LATCH_REVISION_UNVERIFIED');
 if(!legacy.active||legacy.persisted!==true)failures.push('LEGACY_LATCH_NOT_VERIFIED');
 if(!storageHealthy)failures.push('STORAGE_NOT_HEALTHY');
 if(!Number.isFinite(memoryMB)||memoryMB>=450)failures.push('SHADOW_MEMORY_GATE_CLOSED');
 if(freshFeeds!==7)failures.push('MARKET_FEEDS_NOT_ALL_FRESH');
 return {failClosed:failures.length>0,failures,brokerOrdersAllowed:false};
}
function modelScenarios(){
 const scenarios=[
  ['DUPLICATE_INTENT','BLOCK_AND_RECONCILE',true],
  ['NETWORK_TIMEOUT_AFTER_SEND','DO_NOT_RETRY_UNTIL_BROKER_RECONCILED',true],
  ['RESTART_WITH_UNKNOWN_BROKER_STATE','BLOCK_NEW_ENTRIES',true],
  ['STORAGE_WRITE_FAILURE','BLOCK_NEW_ENTRIES',true],
  ['EMERGENCY_LATCH_ENGAGED','BLOCK_NEW_ENTRIES',true],
  ['BROKER_POSITION_MISMATCH','BLOCK_NEW_ENTRIES',true]
 ];return scenarios.map(([name,expected,modelOnly])=>({name,expected,modelOnly,brokerTested:false}));
}
function createLab({dataDir,getLegacy,getDurable,getMemory,getStorage,getReadiness,bootAt}){
 return {report(){const disk=diskState(dataDir),legacy=getLegacy()?.killSwitch||{},durable=getDurable()?.latch||{};
 const memoryMB=getMemory(),storageHealthy=getStorage()?.healthy===true,freshFeeds=(getReadiness()?.markets||[]).filter(x=>x.streamFresh).length;
 const decision=decide({disk,legacy,durable,storageHealthy,memoryMB,freshFeeds});
 return {version:'10.4.0',mode:'READ_ONLY_COMBINED_SAFETY_EVIDENCE',at:new Date().toISOString(),bootAt,
 disk,legacy:{engaged:legacy.active===true,persisted:legacy.persisted===true},durable:{engaged:durable.active===true,persisted:durable.persisted===true,revision:durable.revision??null},
 memoryMB,storageHealthy,freshFeeds,decision,scenarios:modelScenarios(),certification:{gbpRisk:false,igStopUnits:false,brokerLifecycle:false,crashRecovery:false,brokerKillSwitch:false},
 brokerExecutionHardBlocked:true,brokerOrdersAllowed:false,note:'This report does not enforce an order gate, authorize broker execution, or certify broker-connected recovery.'};}};
}
module.exports={diskState,decide,modelScenarios,createLab};
