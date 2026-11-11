'use strict';
// Read-only integration diagnostics. No broker dealing API is provided.
const fs=require('node:fs');
const path=require('node:path');
function createV83({requireAdmin,v81,v82,v68,v71,storageDir,persistentStorage}){
 const safe=(fn)=>{try{return {ok:true,data:fn()}}catch(e){return {ok:false,error:String(e.message).slice(0,120)}}};
 function status(){
  const paper=safe(()=>v81.status()), supervisor=safe(()=>v82.current()), feed=safe(()=>v68.status()), research=safe(()=>v71.status());
  const blockers=[];
  if(!persistentStorage)blockers.push('PERSISTENT_STORAGE_UNVERIFIED');
  if(!paper.ok||paper.data.journalHealthy!==true)blockers.push('PAPER_JOURNAL_NOT_HEALTHY');
  if(!paper.ok||paper.data.scheduled!==true)blockers.push('PAPER_SCHEDULER_NOT_RUNNING');
  if(!supervisor.ok||supervisor.data.supervisorJournalHealthy!==true)blockers.push('SUPERVISOR_JOURNAL_NOT_HEALTHY');
  if(!feed.ok||feed.data.streamState!=='CONNECTED')blockers.push('FEED_NOT_CONNECTED');
  if(!feed.ok||feed.data.quote?.delay!==0||feed.data.quote?.exchangeTimestampCertified!==true)blockers.push('FEED_DELAY_UNCERTIFIED');
  blockers.push('BROKER_GBP_PNL_UNCERTIFIED','GBP_PIP_SIZING_UNCERTIFIED','PROTECTIVE_STOP_LIFECYCLE_UNCERTIFIED','UNKNOWN_SUBMIT_RECOVERY_UNCERTIFIED');
  return {version:'83.0.0',mode:'READ_ONLY_AND_PAPER_ONLY',at:new Date().toISOString(),integrations:{v81:paper.ok,v82:supervisor.ok,v68:feed.ok,v71:research.ok},paper:paper.ok?{journalHealthy:paper.data.journalHealthy,scheduled:paper.data.scheduled,lastTickAt:paper.data.lastTickAt,closedTrades:paper.data.closedTrades}:paper,supervisor:supervisor.ok?{journalHealthy:supervisor.data.supervisorJournalHealthy,records:supervisor.data.supervisorRecords,blockers:supervisor.data.blockers}:supervisor,feed:feed.ok?{state:feed.data.streamState,quoteAgeMs:feed.data.quote?.ageMs??null}:feed,research:research.ok?{direction:research.data.signal?.direction??'WAIT',score:research.data.signal?.score??0}:research,persistentStorage:!!persistentStorage,blockers:[...new Set(blockers)],certified:false,brokerOrderAllowed:false,unattendedOrderAllowed:false};
 }
 function routes(app){
  app.get('/api/v83/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.post('/api/v83/diagnose',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.post('/api/v83/arm',requireAdmin,(_q,r)=>r.status(409).json({error:'BROKER_EXECUTION_HARD_BLOCKED',brokerOrderAllowed:false}));
  app.get('/v83',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'v83-dashboard.html')));
 }
 return {status,routes};
}
module.exports={createV83};
