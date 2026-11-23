 'use strict';
// v8.4: Read-only evidence workbench. No network, IG broker client or order submission.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const MAX_BYTES=2*1024*1024;
function readJournal(file){
 try {const stat=fs.statSync(file);if(stat.size>MAX_BYTES)return {ok:false,reason:'JOURNAL_OVERSIZE',bytes:stat.size};
 const raw=fs.readFileSync(file);const data=JSON.parse(raw.toString('utf8'));
 if(data.schema!==1||!Array.isArray(data.events)||!Array.isArray(data.states))return {ok:false,reason:'INVALID_SCHEMA'};
 return {ok:true,data,bytes:stat.size,sha256:crypto.createHash('sha256').update(raw).digest('hex')};
 }catch(e){return {ok:false,reason:e.code==='ENOENT'?'JOURNAL_MISSING':'JOURNAL_UNREADABLE'};}
}
function tradeLedger(events){
 const chronological=events.filter(e=>e&&['OPENED','CLOSED'].includes(e.kind)).slice().reverse();
 const pending=new Map(),rows=[],anomalies=[];
 for(const e of chronological){const epic=String(e.epic||'');
  if(e.kind==='OPENED'){
   if(pending.has(epic))anomalies.push({code:'OVERLAPPING_OPEN',epic,at:e.at});
   pending.set(epic,e);
  }else{
   const open=pending.get(epic);
   if(!open){anomalies.push({code:'CLOSE_WITHOUT_RETAINED_OPEN',epic,at:e.at});continue;}
   const pnl=Number.isFinite(e.pnlPips)?e.pnlPips:null;
   rows.push({epic,direction:open.direction||null,openedAt:open.at,closedAt:e.at,entry:Number.isFinite(open.entry)?open.entry:null,entryScore:Number.isFinite(open.score)?open.score:null,exitReason:e.reason||null,netSimulatedPips:pnl,elapsedSeconds:Math.max(0,Math.round((Date.parse(e.at)-Date.parse(open.at))/1000))||null});
   pending.delete(epic);
  }
 }
 return {rows:rows.slice(-40).reverse(),unmatchedOpens:[...pending].map(([epic,e])=>({epic,openedAt:e.at})),anomalies,partialHistory:true};
}
function stressTest(){
 // Synthetic, deterministic tests of pure monetary exposure formula; not certification of IG contract units.
 const cases=[{pipGBP:1,stopPips:12,size:1,expected:12},{pipGBP:7.7,stopPips:12,size:0.1,expected:9.24},{pipGBP:7.7,stopPips:12,size:1,expected:92.4}];
 return cases.map(x=>({...x,calculated:Math.round(x.pipGBP*x.stopPips*x.size*100)/100,passed:Math.abs(x.pipGBP*x.stopPips*x.size-x.expected)<1e-8}));
}
function createWorkbench({dataDir,getShadow,getReadiness,getMemory,getStorage}){
 const file=path.join(dataDir,'v80-shadow-journal.json');
 function report(){const journal=readJournal(file),shadow=getShadow(),ready=getReadiness(),mem=getMemory(),storage=getStorage();
 const ledger=journal.ok?tradeLedger(journal.data.events):{rows:[],unmatchedOpens:[],anomalies:[],partialHistory:true};
 const openDisk=journal.ok?journal.data.states.filter(s=>Array.isArray(s)&&s[1]?.position).map(s=>s[0]).sort():[];
 const openLive=(shadow.active||[]).map(s=>s.epic).sort();const match=journal.ok&&JSON.stringify(openDisk)===JSON.stringify(openLive);
 const risks=['IG_GBP_PER_PIP_NOT_VERIFIED','IG_STOP_UNITS_NOT_VERIFIED','BROKER_LIFECYCLE_NOT_VERIFIED','CRASH_RECOVERY_NOT_VERIFIED','KILL_SWITCH_NOT_VERIFIED','BROKER_EXECUTION_HARD_BLOCKED'];
 if(mem>=450)risks.unshift('SHADOW_MEMORY_GATE_CLOSED');if(!storage.healthy||!storage.configured)risks.unshift('DURABLE_STORAGE_UNHEALTHY');
 if(!match)risks.unshift('SHADOW_DISK_MEMORY_MISMATCH');
 const markets=ready.markets||[];
 const continuity=markets.map(m=>({epic:m.epic,streamFresh:!!m.streamFresh,consecutive30:!!m.consecutive30,shadowReady:!!m.shadowReady,direction:m.direction,score:m.score}));
 return {version:'8.4.0',at:new Date().toISOString(),mode:'READ_ONLY_CERTIFICATION_WORKBENCH',memoryMB:mem,
  journal:{ok:journal.ok,reason:journal.reason||null,bytes:journal.bytes||null,sha256:journal.sha256||null,restoreStatus:shadow.restoreStatus,openDisk,openLive,positionMatch:match,retainedEvents:journal.ok?journal.data.events.length:0},
  ledger,markets:continuity,simulatedRiskFormulaTests:stressTest(),
  certifications:{shadowRestoreObserved:shadow.restoreStatus==='RESTORED'&&match,storageConfigured:!!storage.configured,storageHealthy:!!storage.healthy,gbpPipValueVerified:false,brokerLifecycleVerified:false,crashRecoveryVerified:false,killSwitchVerified:false,brokerOrdersAllowed:false},
  blockers:risks,warning:'Read-only evidence. Formula tests use synthetic inputs, NOT verified IG contract GBP pip value. Retained events may omit earlier openings. No broker orders or GBP P/L.'};
 }
 return {report};
}
module.exports={createWorkbench,readJournal,tradeLedger,stressTest};
