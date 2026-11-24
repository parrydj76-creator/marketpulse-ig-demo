'use strict';
// v13: on-demand, read-only readiness evidence. No IG write calls or background work.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {diskLatch}=require('./marketpulse-v110-boundary');
const WRITE_VERBS=/\b(?:POST|PUT|PATCH|DELETE)\b/i;
const DEALING_PATH=/\/(?:positions|workingorders|orders)(?:\/|\b)/i;
function inventory(root,limit=300){
 const files=[];const queue=[root];let truncated=false;
 while(queue.length){const dir=queue.shift();let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true})}catch{continue}
 for(const e of entries){if(e.name==='node_modules'||e.name==='.git'||e.name==='data'||e.name==='persistent')continue;
 const p=path.join(dir,e.name);if(e.isDirectory()){if(queue.length<30)queue.push(p);continue}
 if(!e.isFile()||!e.name.endsWith('.js'))continue;
 if(files.length>=limit){truncated=true;break}
 try{const stat=fs.statSync(p);if(stat.size>1024*1024){files.push({file:path.relative(root,p),skipped:'OVER_1MB'});continue}
 const src=fs.readFileSync(p,'utf8');const lines=src.split('\n');const hits=[];
 lines.forEach((line,i)=>{if(DEALING_PATH.test(line)&&(/fetch\s*\(|\bapi\s*\(|\brequest\s*\(/.test(line)||WRITE_VERBS.test(line))){if(hits.length<12)hits.push({line:i+1,kind:'POTENTIAL_DEALING_REFERENCE'})}});
 if(hits.length)files.push({file:path.relative(root,p),sha256:crypto.createHash('sha256').update(src).digest('hex'),hits});
 }catch{files.push({file:path.relative(root,p),skipped:'READ_ERROR'})}
 }if(truncated)break;
 }
 return {scannedToLimit:limit,truncated,files,certifiedComplete:false,note:'Heuristic inventory; dynamic routes and bundled dependencies may be missed. No broker writes authorised.'};
}
function evaluate({dataDir,root,legacy,durable,memoryMB,storageHealthy,readiness,brokerBlocked,bootAt}){
 const disk=diskLatch(dataDir),latch=durable?.latch||{},old=legacy?.killSwitch||{};
 const fresh=(readiness?.markets||[]).filter(m=>m.streamFresh).length;
 const barriers=[];
 if(!disk.readable||!disk.engaged||latch.active!==true||latch.persisted!==true||disk.revision!==latch.revision)barriers.push('DURABLE_LATCH_NOT_VERIFIED');
 if(!storageHealthy)barriers.push('STORAGE_NOT_HEALTHY');
 if(memoryMB>=450)barriers.push('SHADOW_MEMORY_GATE_CLOSED');
 if(fresh!==7)barriers.push('STREAMS_NOT_READY');
 if(!brokerBlocked)barriers.push('BROKER_WRITE_BLOCK_NOT_CONFIRMED');
 barriers.push('GBP_PIP_AND_DEAL_UNITS_NOT_CERTIFIED','IG_STOP_POINT_MAPPING_NOT_CERTIFIED','BROKER_LIFECYCLE_NOT_CERTIFIED','BROKER_CRASH_RECOVERY_NOT_CERTIFIED','BROKER_CONNECTED_KILL_SWITCH_NOT_CERTIFIED');
 const inv=inventory(root);
 if(inv.truncated)barriers.push('CODE_INVENTORY_TRUNCATED');
 return {version:'13.0.0',at:new Date().toISOString(),bootAt,mode:'PRE_UNATTENDED_READ_ONLY_AUDIT',brokerOrdersAllowed:false,brokerBlocked,latched:{engaged:disk.engaged,readable:disk.readable,revision:disk.revision,matchesMemory:disk.revision===latch.revision&&latch.persisted===true,legacyNonAuthoritative:true,legacyPersisted:old.persisted===true},memory:{rssMB:memoryMB,headroomMB:512-memoryMB,shadowGateOpen:memoryMB<450},storageHealthy,freshFeeds:fresh,barriers,inventory:inv,certification:{risk:false,stopUnits:false,lifecycle:false,crashRecovery:false,killSwitch:false},notice:'This report cannot authorize IG orders. Static inventory is heuristic, not a proof of complete broker write coverage.'};
}
function recoveryCases(){return [
 ['TIMEOUT_AFTER_SEND','UNKNOWN','BLOCK_RECONCILE'],['RESTART_WITH_OPEN_POSITION','UNKNOWN','BLOCK_RECONCILE'],['DISK_WRITE_FAILURE','HALT','BLOCK_NEW_ENTRIES'],['LATCH_ENGAGED','HALT','BLOCK_NEW_ENTRIES'],['DUPLICATE_INTENT','UNKNOWN','BLOCK_RECONCILE']].map(([scenario,state,action])=>({scenario,state,expectedAction:action,modelOnly:true,brokerTested:false}));}
module.exports={inventory,evaluate,recoveryCases};
