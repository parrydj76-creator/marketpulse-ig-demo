'use strict';
// Simulated trades only. A proposed transition is committed to PostgreSQL
// before it becomes visible in the in-memory engine.
const {PaperEngine}=require('./paper-engine');
const STATE_FIELDS=['day','dailyOpens','position','history','lastSignalBar','lastCloseAt','lastDecision','realizedPips'];
function restorePaperEngine(engine,recovery){
  if(!recovery || !recovery.inspected || !recovery.safeToResume || recovery.unresolvedPositions.length){
    throw Error('Cannot restore paper engine: archive requires manual reconciliation');
  }
  if(!Number.isInteger(recovery.dailyOpens)||recovery.dailyOpens<0||!Number.isFinite(recovery.realizedPips))throw Error('Invalid recovery counters');
  engine.day=recovery.day;
  engine.dailyOpens=recovery.dailyOpens;
  engine.position=null;
  engine.history=[]; // Historical events are served from PostgreSQL, not recreated.
  engine.lastCloseAt=recovery.lastCloseAt;
  engine.realizedPips=recovery.realizedPips;
  engine.lastSignalBar=recovery.lastSignalBar??null;
  engine.lastDecision=null;
  engine.enabled=false; // Restoration is not authorization to trade.
  return engine.snapshot();
}
async function durablePaperTick(engine,quote,signal,now=Date.now(),save){
  if(engine.enabled!==true)throw Error('Paper engine is paused');
  if(!save)save=require('./paper-store').savePaperEvent;
  const proposal=new PaperEngine(engine.cfg);
  for(const field of STATE_FIELDS)proposal[field]=structuredClone(engine[field]);
  proposal.enabled=true;
  const previous=proposal.history[0];
  proposal.tick(quote,signal,now);
  const event=proposal.history[0]!==previous?proposal.history[0]:null;
  if(event){
    // Reject ambiguous writes. An ON CONFLICT duplicate must not mutate state.
    const saved=await save(event);
    if(!saved||saved.inserted!==true)throw Error('Paper event was not newly committed');
  }
  for(const field of STATE_FIELDS)engine[field]=proposal[field];
  return {committed:!!event,event:event||null};
}
module.exports={durablePaperTick,restorePaperEngine};
