'use strict';
// Isolated, bounded shadow simulator. Never imports IG APIs or receives broker callbacks.
const fs=require('fs'),path=require('path');
function createShadow80({dataDir,epics,getSnapshot,storageConfirmed}){
 const file=path.join(dataDir,'v80-shadow-journal.json');
 const states=new Map(),events=[];let healthy=true,restoreStatus='NEW',lastError=null,lastWrite=null;
 const maxEvents=120;
 function event(kind,epic,detail={}){events.unshift({at:new Date().toISOString(),kind,epic,...detail});if(events.length>maxEvents)events.length=maxEvents;}
 function restore(){
  try{const obj=JSON.parse(fs.readFileSync(file,'utf8'));
   if(obj.schema!==1||!Array.isArray(obj.states)||!Array.isArray(obj.events))throw Error('Unexpected journal schema');
   for(const [epic,value] of obj.states){if(epics.includes(epic)&&value&&typeof value==='object')states.set(epic,value)}
   events.push(...obj.events.slice(0,maxEvents));restoreStatus='RESTORED';
  }catch(e){if(e.code==='ENOENT'){restoreStatus='NEW';return;}healthy=false;restoreStatus='FAILED';lastError=e.message;}
 }
 function persist(){if(!storageConfirmed)return false;
  try{fs.mkdirSync(dataDir,{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify({schema:1,at:new Date().toISOString(),states:[...states],events}));fs.renameSync(tmp,file);lastWrite=new Date().toISOString();return true;}
  catch(e){healthy=false;lastError=e.message;return false;}
 }
 function pipSize(epic){return epic.includes('JPY')?0.01:0.0001;}
 function tick(){
  if(!storageConfirmed||!healthy)return;
  const snap=getSnapshot();const now=Date.now();
  if(snap.memoryMB>=450||!snap.persistenceHealthy)return;
  for(const p of snap.markets){
   if(!epics.includes(p.epic))continue;
   const old=states.get(p.epic)||{lastBar:null,position:null,closed:0};
   if(!p.streamFresh||!p.consecutive30||!p.lastBar||!Number.isFinite(p.bid)||!Number.isFinite(p.ask)||p.ask<=p.bid)continue;
   if(old.position){
    const pos=old.position,unit=pipSize(p.epic);
    const exit=pos.direction==='LONG'?p.bid:p.ask;
    const pnlPips=(pos.direction==='LONG'?exit-pos.entry:pos.entry-exit)/unit;
    const age=now-Date.parse(pos.openedAt);
    const reason=pnlPips<=-12?'SIM_STOP':pnlPips>=18?'SIM_TARGET':age>=180*60000?'SIM_TIME':null;
    if(reason){old.position=null;old.closed=(old.closed||0)+1;event('CLOSED',p.epic,{reason,pnlPips:Math.round(pnlPips*100)/100});states.set(p.epic,old);persist();}
    continue;
   }
   if(p.lastBar===old.lastBar)continue;
   old.lastBar=p.lastBar;states.set(p.epic,old);
   if(!['LONG','SHORT'].includes(p.direction)||p.score<70){persist();continue;}
   // Simulated spread-aware fill, no broker request and no monetary P/L assertion.
   old.position={direction:p.direction,entry:p.direction==='LONG'?p.ask:p.bid,openedAt:new Date().toISOString(),bar:p.lastBar,score:p.score};
   event('OPENED',p.epic,{direction:p.direction,score:p.score,entry:old.position.entry});
   if(!persist()){old.position=null;event('HALTED',p.epic,{reason:'JOURNAL_WRITE_FAILED'});break;}
  }
 }
 restore();
 return {tick,status(){return {version:'8.0.0',mode:'SIMULATED_ONLY',enabled:storageConfirmed&&healthy,storageConfirmed,healthy,restoreStatus,lastError,lastWrite,active:[...states].filter(([,v])=>v.position).map(([epic,v])=>({epic,...v.position})),closedCount:[...states.values()].reduce((n,v)=>n+(v.closed||0),0),events:events.slice(0,40),safety:{brokerOrdersAllowed:false,brokerExecutionHardBlocked:true},note:'Simulated quote-based fills, not historical backtest or guaranteed executable prices. Pips only; no GBP P/L.'};}};
}
module.exports={createShadow80};
