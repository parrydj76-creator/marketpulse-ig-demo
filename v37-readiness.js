 'use strict';
// Diagnostics + audit only. No broker write methods, no synthetic trade injection.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const good=x=>typeof x==='number'&&Number.isFinite(x);
function verifiedRestMarketState(rest,at,quote,now=Date.now()){
 const age=at?now-Date.parse(at):Infinity;
 if(!rest||rest.epic!=='CS.D.EURUSD.CFD.IP'||rest.marketStatus!=='TRADEABLE'||!good(age)||age<0||age>360000)return null;
 if(!quote||quote.marketState!=='DEAL'||!good(quote.at)||now-quote.at>10000||now<quote.at)return null;
 return 'TRADEABLE';
}
function assessSnapshot(s){const reasons=[],f=s?.feed||{},a=s?.signal||{};
 if(!['LONG','SHORT'].includes(a.direction))reasons.push('NO_ACTIONABLE_SIGNAL');
 if(!good(a.score)||a.score<75)reasons.push('LOW_CONFIDENCE');
 if(f.verifiedMarketStatus!=='TRADEABLE')reasons.push('MARKET_STATUS_NOT_VERIFIED');
 if(f.dealingFlag!=='DEAL')reasons.push('DEALING_FLAG_NOT_VERIFIED');
 if(f.delayed!==false)reasons.push('DELAY_UNKNOWN_OR_TRUE');
 if(!good(f.ageMs)||f.ageMs<0||f.ageMs>10000)reasons.push('STREAM_STALE');
 if(!good(f.bid)||!good(f.ask)||f.bid<=0||f.ask<=f.bid)reasons.push('INVALID_BID_ASK');
 else if((f.ask-f.bid)/0.0001>3)reasons.push('SPREAD_TOO_WIDE');
 if(!a.bar||!Number.isFinite(Date.parse(a.bar)))reasons.push('MISSING_SIGNAL_BAR');
 return {eligibleForPaperSignal:reasons.length===0,reasons,brokerOrderAllowed:false};
}
function verifyLog(rows){let prev='GENESIS';for(const row of rows){if(!row||row.previous!==prev||row.digest!==hash({previous:row.previous,event:row.event}))throw Error('AUDIT_CHAIN_INVALID');prev=row.digest}return prev}
function createV37({requireAdmin,storageDir,persistentStorage,v36Status,v33Status,snapshot}){
 const file=path.join(storageDir,'v37-evaluations.json');let rows=[],healthy=true,error=null,last=null,count=0;
 try{if(fs.existsSync(file)){rows=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(rows))throw Error('INVALID_AUDIT');verifyLog(rows)}}catch(e){healthy=false;error=e.message}
 function append(event){if(!healthy||!persistentStorage)throw Error('AUDIT_STORAGE_UNAVAILABLE');const previous=rows.length?rows.at(-1).digest:'GENESIS';const next=[...rows,{previous,event,digest:hash({previous,event})}];const tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const d=fs.openSync(storageDir,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}rows=next}catch(e){healthy=false;error=e.message;throw e}}
 function cycle(){const s=snapshot(),result=assessSnapshot(s),j=v33Status(),v=v36Status();const safety={journalHealthy:j.storageHealthy===true&&j.persistentStorageConfigured===true,unresolvedIntents:j.unresolvedIntents,brokerOrderAllowed:false};const event={id:crypto.randomUUID(),at:new Date().toISOString(),kind:'PAPER_READINESS_EVALUATION',epic:s.epic,signal:s.signal,feed:s.feed,result,safety,v36Enabled:v.enabled};append(event);last=event;count++;return {event,result,safety,brokerOrderAllowed:false}}
 function status(){const v=v36Status(),j=v33Status();return {version:'37.0.0',mode:'AUDITED_PAPER_READINESS',enabled:v.enabled,auditHealthy:healthy,auditEvents:rows.length,auditHead:healthy?verifyLog(rows):null,lastEvaluation:last||rows.at(-1)?.event||null,storageConfigured:!!persistentStorage,signal:snapshot(),v36:{openPosition:v.openPosition,closedTrades:v.closedTrades,realizedPnlGBP:v.realizedPnlGBP,journal:v.journal},brokerChecks:{gbpSizingCertified:false,brokerLifecycleCertified:false,crashRecoveryCertified:false,localUnresolvedIntents:j.unresolvedIntents},brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,error,warning:'Diagnostics and illustrative paper trading only. No broker orders. V36 restarts disabled.'}}
 function routes(app){app.get('/api/v37/status',requireAdmin,(_q,r)=>{try{r.set('Cache-Control','no-store').json(status())}catch(e){r.status(503).json({error:e.message})}});
 app.get('/api/v37/evaluations',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:rows.slice(-100).map(x=>x.event),total:rows.length,healthy,brokerOrderAllowed:false}));
 app.post('/api/v37/evaluate',requireAdmin,(_q,r)=>{try{r.json(cycle())}catch(e){r.status(503).json({error:e.message})}});
 app.get('/v37',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v37.html')))}
 // Monitor only while v36 is enabled. Does not call v36.tick or execute orders.
 const timer=setInterval(()=>{try{if(v36Status().enabled&&healthy&&persistentStorage)cycle()}catch(e){error=e.message;healthy=false}},30000);timer.unref?.();
 return {routes,status,cycle,stop:()=>clearInterval(timer)};
}
module.exports={createV37,verifiedRestMarketState,assessSnapshot,verifyLog};
