'use strict';
// Read-only, bounded certification evidence; no trading or network functions.
const fs=require('fs');
const path=require('path');
function createCertification({dataDir,getShadow,getReadiness,getMemory}){
 const journal=path.join(dataDir,'v80-shadow-journal.json');
 function report(){
  const shadow=getShadow(),readiness=getReadiness(),mem=getMemory();
  const issues=[];let disk=null,stat=null;
  try {stat=fs.statSync(journal);if(stat.size>2*1024*1024)throw Error('JOURNAL_TOO_LARGE');disk=JSON.parse(fs.readFileSync(journal,'utf8'));if(disk.schema!==1||!Array.isArray(disk.events)||!Array.isArray(disk.states))throw Error('INVALID_SCHEMA');}
  catch(e){issues.push(e.code==='ENOENT'?'JOURNAL_NOT_WRITTEN':`JOURNAL_READ_ERROR:${String(e.message).slice(0,80)}`);}
  const events=disk?.events||[];let opens=0,closes=0,stops=0,targets=0,timeExits=0;const pnl=[];
  for(const e of events){if(!e||typeof e!=='object')continue;if(e.kind==='OPENED')opens++;if(e.kind==='CLOSED'){closes++;if(e.reason==='SIM_STOP')stops++;if(e.reason==='SIM_TARGET')targets++;if(e.reason==='SIM_TIME')timeExits++;if(Number.isFinite(e.pnlPips))pnl.push(e.pnlPips);}}
  const openPositions=(disk?.states||[]).filter(x=>Array.isArray(x)&&x[1]?.position).length;
  const livePositions=(shadow.active||[]).length;
  if(disk&&openPositions!==livePositions)issues.push('JOURNAL_MEMORY_POSITION_MISMATCH');
  if(shadow.restoreStatus!=='RESTORED')issues.push('RESTART_RESTORE_NOT_YET_OBSERVED');
  if(!shadow.healthy)issues.push('SHADOW_JOURNAL_UNHEALTHY');
  if(!shadow.storageConfirmed)issues.push('DURABLE_STORAGE_UNCONFIRMED');
  if(mem>=450)issues.push('MEMORY_GATE_PAUSED');
  if((readiness.markets||[]).some(m=>!m.consecutive30))issues.push('SOME_MARKETS_NOT_READY');
  issues.push('GBP_RISK_UNCERTIFIED','BROKER_LIFECYCLE_UNCERTIFIED','CRASH_RECOVERY_UNCERTIFIED','KILL_SWITCH_UNCERTIFIED','BROKER_EXECUTION_HARD_BLOCKED');
  const sum=pnl.reduce((a,b)=>a+b,0);
  return {version:'8.3.0',at:new Date().toISOString(),mode:'READ_ONLY_SHADOW_CERTIFICATION',memoryMB:mem,
   journal:{exists:!!disk,bytes:stat?.size??null,restoreStatus:shadow.restoreStatus,lastWrite:shadow.lastWrite,eventsRetained:events.length,openPositions,livePositions,matched:!!disk&&openPositions===livePositions},
   simulation:{opensRetained:opens,closesRetained:closes,targetsRetained:targets,stopsRetained:stops,timeExitsRetained:timeExits,closedWithPipResults:pnl.length,netSimulatedPips:Math.round(sum*100)/100,averageSimulatedPips:pnl.length?Math.round(sum/pnl.length*100)/100:null,warning:'Retained journal window only, not lifetime performance. No GBP profit, fill or strategy profitability certification.'},
   gates:{streamsFresh:(readiness.markets||[]).filter(x=>x.streamFresh).length,markets:(readiness.markets||[]).length,consecutive30:(readiness.markets||[]).filter(x=>x.consecutive30).length,memoryBelow450:mem<450,storageConfirmed:!!shadow.storageConfirmed},
   issues,safety:{brokerOrdersAllowed:false,brokerExecutionHardBlocked:true}};
 }
 return {report};
}
module.exports={createCertification};
