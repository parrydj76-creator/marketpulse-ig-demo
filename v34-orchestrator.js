'use strict';
// V34: strictly paper-only orchestrator. No broker POST/PUT/DELETE, no execution arming.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ID=/^[a-zA-Z0-9_-]{3,80}$/;
const allowed=new Set(['LONG','SHORT']);
function evaluateSignal(signal,feed,limits={}){
 const reasons=[];
 if(!signal||!allowed.has(signal.direction))reasons.push('NO_ACTIONABLE_SIGNAL');
 if(!Number.isFinite(signal?.score)||signal.score<Math.max(70,Number(limits.minScore)||70))reasons.push('LOW_CONFIDENCE');
 if(!feed||feed.marketState!=='TRADEABLE')reasons.push('MARKET_NOT_TRADEABLE');
 if(feed?.delayed!==false)reasons.push('DELAYED_OR_UNKNOWN_FEED');
 if(!Number.isFinite(feed?.ageMs)||feed.ageMs<0||feed.ageMs>10000)reasons.push('STALE_FEED');
 if(!Number.isFinite(feed?.bid)||!Number.isFinite(feed?.ask)||feed.bid<=0||feed.ask<=feed.bid)reasons.push('INVALID_SPREAD');
 if(!signal?.bar||!Number.isFinite(Date.parse(signal.bar)))reasons.push('MISSING_BAR');
 if(!Number.isSafeInteger(limits?.unresolvedIntents)||limits.unresolvedIntents<0)reasons.push('ORDER_INTENT_STATUS_UNVERIFIED');
 else if(limits.unresolvedIntents>0)reasons.push('UNRESOLVED_ORDER_INTENT');
 if(limits?.storageHealthy!==true)reasons.push('PERSISTENCE_NOT_VERIFIED');
 return {decision:reasons.length?'REJECT':'PAPER_CANDIDATE',reasons,brokerOrderAllowed:false};
}
function inspectJournal(entries){
 let previous='GENESIS';const ids=new Set();
 for(const entry of entries){
  if(!entry||entry.previous!==previous||entry.digest!==sha({previous:entry.previous,event:entry.event}))return {valid:false,reason:'CHAIN_MISMATCH'};
  if(!entry.event||!ID.test(entry.event.id)||ids.has(entry.event.id))return {valid:false,reason:'DUPLICATE_OR_INVALID_EVENT'};
  ids.add(entry.event.id);previous=entry.digest;
 }
 return {valid:true,events:entries.length,head:previous};
}
function recoveryGate(journal,brokerPositions){
 if(!Array.isArray(journal)||!Array.isArray(brokerPositions))throw Error('Journal and positions arrays required');
 const unresolved=journal.filter(x=>['PREPARED','SENT_UNKNOWN','ACKNOWLEDGED','RECONCILE_REQUIRED'].includes(x.state));
 return {brokerOrderAllowed:false,autoRetryAllowed:false,unresolved:unresolved.map(x=>x.intentId),requiresManualReview:unresolved.length>0,brokerPositionsObserved:brokerPositions.length,warning:'Position snapshot alone cannot certify in-flight recovery or absence of pending IG requests.'};
}
function createV34({requireAdmin,api,authInfo,storageDir,persistentStorage=false,signalSnapshot}){
 const file=path.join(storageDir,'v34-paper-events.json');let events=[],healthy=true,error=null;
 try{if(fs.existsSync(file)){events=JSON.parse(fs.readFileSync(file,'utf8'));const check=inspectJournal(events);if(!check.valid)throw Error(check.reason);}}catch(e){healthy=false;error=e.message;}
 const state={enabled:false,cycles:0,lastCycle:null,lastDecision:null};
 function persist(event){
  if(!healthy||!persistentStorage)throw Error('Persistent journal unavailable');
  const previous=events.length?events.at(-1).digest:'GENESIS';const entry={previous,event,digest:sha({previous,event})};
  const next=[...events,entry];fs.mkdirSync(storageDir,{recursive:true});const tmp=file+'.tmp';
  try{const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const dir=fs.openSync(storageDir,'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}events=next;return entry;}catch(e){healthy=false;error=e.message;state.enabled=false;throw e;}
 }
 function status(){return {version:'34.0.0',mode:'PAPER_AUTOMATION_ORCHESTRATOR',paperAutomationEnabled:state.enabled,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,unattendedBrokerTradingEnabled:false,storageHealthy:healthy,persistentStorageConfigured:!!persistentStorage,journal:inspectJournal(events),cycles:state.cycles,lastCycle:state.lastCycle,lastDecision:state.lastDecision,checks:{gbpSizingCertified:false,brokerLifecycleCertified:false,crashRecoveryCertified:false},error,warning:'Paper decisions only; no broker order write paths or automatic retries.'};}
 function cycle(){
  const snap=signalSnapshot();const result=evaluateSignal(snap.signal,snap.feed,{minScore:75,unresolvedIntents:snap.unresolvedIntents,storageHealthy:healthy&&persistentStorage});
  const event={id:crypto.randomUUID(),at:new Date().toISOString(),kind:'PAPER_EVALUATION',epic:String(snap.epic||'').slice(0,60),direction:String(snap.signal?.direction||'UNKNOWN'),bar:snap.signal?.bar||null,decision:result.decision,reasons:result.reasons};
  persist(event);state.cycles++;state.lastCycle=event.at;state.lastDecision=result.decision;return {event,result};
 }
 function routes(app){
  app.get('/api/v34/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.get('/api/v34/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:events.slice(-50).map(x=>x.event),status:status()}));
  app.post('/api/v34/paper/start',requireAdmin,(_q,r)=>{if(!healthy||!persistentStorage)return r.status(409).json({error:'Durable storage required'});state.enabled=true;r.json({status:status()});});
  app.post('/api/v34/paper/stop',requireAdmin,(_q,r)=>{state.enabled=false;r.json({status:status()});});
  app.post('/api/v34/paper/cycle',requireAdmin,(_q,r)=>{try{r.json({...cycle(),status:status()})}catch(e){r.status(503).json({error:String(e.message),status:status()})}});
  app.post('/api/v34/broker/observe',requireAdmin,async(_q,r)=>{try{const a=await api('/accounts','GET');const current=(a.accounts||[]).find(x=>x.accountId===authInfo()?.accountId);if(current?.accountType!=='CFD'||current?.currency!=='GBP')return r.status(409).json({error:'Active GBP CFD account not confirmed'});const p=await api('/positions','GET',null,'2');if(!Array.isArray(p?.positions))throw Error('Positions unavailable');r.json({accountType:'CFD',currency:'GBP',positionsCount:p.positions.length,brokerOrderAllowed:false,warning:'Read-only snapshot; no lifecycle certification'});}catch(e){r.status(502).json({error:'Read-only broker observation failed',detail:String(e.message).slice(0,100)})}});
  app.get('/v34',(_q,r)=>r.sendFile(path.join(__dirname,'public','v34.html')));
 }
 // Disabled on every restart. Start enables only paper evaluations; no broker orders.
 const timer=setInterval(()=>{if(state.enabled){try{cycle()}catch{state.enabled=false}}},30000);timer.unref?.();
 return {routes,status,cycle,stop:()=>{state.enabled=false;clearInterval(timer)}};
}
module.exports={createV34,evaluateSignal,inspectJournal,recoveryGate};
