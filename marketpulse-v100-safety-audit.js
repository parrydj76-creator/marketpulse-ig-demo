 'use strict';
// V10 safety consolidation is observational, never an IG execution authorization.
const fs=require('node:fs'),path=require('node:path');
function readJson(p){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return null}}
function assess({dataDir,oldLab,newLab,readiness,memory,storage,brokerExecutionEnabled=false,bootAt}){
 const old=oldLab||{},newer=newLab||{},v91=old.killSwitch||{},v95=newer.latch||{};
 const disk=readJson(path.join(dataDir,'v95-kill-latch.json'));
 const diskActive=disk?.active===true&&Number.isSafeInteger(disk?.revision);
 const diskMatches=diskActive&&disk.revision===v95.revision&&v95.persisted===true;
 const failClosed=!diskMatches||v91.active!==true||v91.persisted!==true||!storage.healthy||memory>=450;
 const issues=[];
 if(!diskMatches)issues.push('V95_DURABLE_LATCH_NOT_VERIFIED');
 if(v91.active!==true||v91.persisted!==true)issues.push('LEGACY_V91_LATCH_UNVERIFIED');
 if(v91.persisted!==v95.persisted)issues.push('LATCH_STATUS_CONFLICT');
 if(!storage.healthy)issues.push('STORAGE_UNHEALTHY');
 if(memory>=450)issues.push('SHADOW_MEMORY_GATE_CLOSED');
 const fresh=(readiness.markets||[]).filter(x=>x.streamFresh).length;
 if(fresh!==7)issues.push('STREAMS_NOT_ALL_FRESH');
 const evidence={v91:{engaged:v91.active===true,persisted:v91.persisted===true},v95:{engaged:v95.active===true,persisted:v95.persisted===true,revision:v95.revision},disk:{active:diskActive,revision:disk?.revision??null,revisionMatches:!!diskMatches},storageHealthy:!!storage.healthy,memoryMB:memory,freshFeeds:fresh};
 return {version:'10.0.0',mode:'READ_ONLY_SAFETY_CONSOLIDATION',bootAt,at:new Date().toISOString(),evidence,failClosed,issues,certification:{gbpRisk:false,stopUnits:false,brokerLifecycle:false,crashRecovery:false,brokerKillSwitch:false},brokerExecutionHardBlocked:!brokerExecutionEnabled,brokerOrdersAllowed:false,operatorAction:'KEEP_BROKER_EXECUTION_DISABLED',note:'This endpoint does not enforce a shared execution gate. Existing broker writes remain separately hard-blocked. v9.1 and v9.5 latches are NOT unified.'};
}
module.exports={assess};
