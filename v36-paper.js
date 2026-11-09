 'use strict';
// V36 isolated PAPER ledger. Never invokes IG broker order endpoints.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {evaluateSignal}=require('./v34-orchestrator');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const CONFIG=Object.freeze({size:1,pipValueGBP:1,stopPips:12,targetPips:18,maxRiskGBP:25,maxTradesPerUtcDay:3,maxDailyLossGBP:100,maxSpreadPips:3});
const pip=0.0001;
function replay(entries){let prev='GENESIS',position=null,closed=[],openedToday={},realized=0;const seen=new Set();
 for(const row of entries){if(!row||row.previous!==prev||row.digest!==digest({previous:row.previous,event:row.event}))throw Error('JOURNAL_CHAIN_INVALID');prev=row.digest;
 const e=row.event;if(!e||!e.id||seen.has(e.id))throw Error('DUPLICATE_EVENT');seen.add(e.id);
 if(e.kind==='OPEN'){if(position)throw Error('OVERLAPPING_POSITIONS');position=e.position;const d=e.at.slice(0,10);openedToday[d]=(openedToday[d]||0)+1}
 else if(e.kind==='CLOSE'){if(!position||position.id!==e.positionId)throw Error('UNMATCHED_CLOSE');closed.push({...e,entry:position});realized+=e.pnlGBP;position=null}
 else if(e.kind!=='REJECT')throw Error('UNKNOWN_EVENT');}
 return {position,closed,openedToday,realized,head:prev};}
function assess(snap,gate,ledger,now,config=CONFIG){const reasons=[];const signal=snap?.signal,feed=snap?.feed;
 const base=evaluateSignal(signal,feed,{minScore:75,unresolvedIntents:gate?.verified===true?gate.count:1,storageHealthy:gate?.verified===true});reasons.push(...base.reasons);
 if(gate?.verified!==true)reasons.push('JOURNAL_UNVERIFIED');
 if(!finite(feed?.bid)||!finite(feed?.ask)||feed.ask<=feed.bid)reasons.push('INVALID_QUOTE');
 else if((feed.ask-feed.bid)/pip>config.maxSpreadPips)reasons.push('SPREAD_TOO_WIDE');
 if(ledger.position)reasons.push('POSITION_ALREADY_OPEN');
 const day=now.slice(0,10);if((ledger.openedToday[day]||0)>=config.maxTradesPerUtcDay)reasons.push('DAILY_TRADE_LIMIT');
 const todayLoss=ledger.closed.filter(x=>x.at.slice(0,10)===day).reduce((s,x)=>s+Math.min(0,x.pnlGBP),0);
 if(-todayLoss>=config.maxDailyLossGBP)reasons.push('DAILY_LOSS_LIMIT');
 const risk=config.size*config.stopPips*config.pipValueGBP;if(risk>config.maxRiskGBP)reasons.push('RISK_LIMIT');
 if(!finite(config.pipValueGBP)||config.pipValueGBP<=0)reasons.push('INVALID_PIP_ASSUMPTION');
 return {decision:reasons.length?'REJECT':'PAPER_ENTRY',reasons:[...new Set(reasons)],illustrativeRiskGBP:risk,brokerOrderAllowed:false};}
function closeQuote(pos,feed){if(!finite(feed?.bid)||!finite(feed?.ask)||feed.ask<=feed.bid)return null;
 const exit=pos.direction==='LONG'?feed.bid:feed.ask;
 const stopHit=pos.direction==='LONG'?exit<=pos.stop:exit>=pos.stop;
 const targetHit=pos.direction==='LONG'?exit>=pos.target:exit<=pos.target;
 if(!stopHit&&!targetHit)return null;
 const pips=(exit-pos.entry)/pip*(pos.direction==='LONG'?1:-1);
 return {exit,reason:stopHit?'STOP':'TARGET',pips:Number(pips.toFixed(5)),pnlGBP:Number((pips*pos.size*pos.pipValueGBP).toFixed(2))};}
function createV36({requireAdmin,storageDir,persistentStorage=false,signalSnapshot,v33Status}){
 const file=path.join(storageDir,'v36-paper-ledger.json');let entries=[],healthy=true,error=null,enabled=false;
 try{if(fs.existsSync(file)){entries=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(entries))throw Error('JOURNAL_NOT_ARRAY');replay(entries)}}catch(e){healthy=false;error=e.message}
 function state(){return replay(entries)}
 function status(){let s;try{s=state()}catch(e){healthy=false;error=e.message;s={position:null,closed:[],openedToday:{},realized:0,head:null}};
 return {version:'36.0.0',mode:'DURABLE_PAPER_POSITION_SIMULATOR',enabled,storageHealthy:healthy,persistentStorageConfigured:!!persistentStorage,journal:{events:entries.length,head:s.head,valid:healthy},openPosition:s.position,closedTrades:s.closed.length,realizedPnlGBP:Number(s.realized.toFixed(2)),assumptions:CONFIG,gbpSizingCertified:false,brokerLifecycleCertified:false,crashRecoveryCertified:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,error,warning:'PAPER ONLY. GBP pip value is an illustrative assumption, not independently verified IG contract sizing. Restarts disable the engine.'}}
 function append(event){if(!healthy||!persistentStorage)throw Error('DURABLE_STORAGE_REQUIRED');const previous=entries.length?entries.at(-1).digest:'GENESIS';const next=[...entries,{previous,event,digest:digest({previous,event})}];const tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const dir=fs.openSync(storageDir,'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}entries=next}catch(e){healthy=false;error=e.message;enabled=false;throw e}}
 function gate(){try{const j=v33Status();return {verified:j.storageHealthy===true&&j.persistentStorageConfigured===true&&Number.isSafeInteger(j.unresolvedIntents)&&j.unresolvedIntents>=0,count:j.unresolvedIntents}}catch{return {verified:false,count:null}}}
 function tick(){if(!healthy||!persistentStorage)throw Error('STORAGE_UNAVAILABLE');const snap=signalSnapshot(),now=new Date().toISOString(),s=state(),feed=snap.feed;
 if(s.position){if(feed?.marketState!=='TRADEABLE'||feed?.delayed!==false||!finite(feed.ageMs)||feed.ageMs>10000||feed.ageMs<0) return {action:'HOLD',reason:'FEED_NOT_VERIFIED',status:status()};const c=closeQuote(s.position,feed);if(!c)return {action:'HOLD',reason:'NO_EXIT_TRIGGER',status:status()};const event={id:crypto.randomUUID(),at:now,kind:'CLOSE',positionId:s.position.id,...c};append(event);return {action:'CLOSE',event,status:status()}}
 const a=assess(snap,gate(),s,now);if(a.decision!=='PAPER_ENTRY')return {action:'REJECT',result:a,status:status()};
 const direction=snap.signal.direction,entry=direction==='LONG'?feed.ask:feed.bid;
 const stop=entry+(direction==='LONG'?-1:1)*CONFIG.stopPips*pip,target=entry+(direction==='LONG'?1:-1)*CONFIG.targetPips*pip;
 const position={id:crypto.randomUUID(),epic:snap.epic,direction,entry,stop,target,size:CONFIG.size,pipValueGBP:CONFIG.pipValueGBP,openedAt:now,signalBar:snap.signal.bar};
 const event={id:crypto.randomUUID(),at:now,kind:'OPEN',position};append(event);return {action:'OPEN',event,status:status()};}
 function routes(app){app.get('/api/v36/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v36/trades',requireAdmin,(_q,r)=>{try{const s=state();r.json({closed:s.closed.slice(-100),open:s.position,brokerOrderAllowed:false})}catch(e){r.status(503).json({error:e.message})}});
 app.post('/api/v36/paper/cycle',requireAdmin,(_q,r)=>{try{r.json(tick())}catch(e){r.status(503).json({error:e.message,status:status()})}});
 app.post('/api/v36/paper/start',requireAdmin,(_q,r)=>{if(!healthy||!persistentStorage)return r.status(409).json({error:'Durable storage required'});enabled=true;r.json(status())});
 app.post('/api/v36/paper/stop',requireAdmin,(_q,r)=>{enabled=false;r.json(status())});
 app.get('/v36',(_q,r)=>r.sendFile(path.join(__dirname,'public','v36.html')))}
 const timer=setInterval(()=>{if(enabled){try{tick()}catch(e){enabled=false;error=e.message}}},30000);timer.unref?.();
 return {routes,status,tick,stop:()=>{enabled=false;clearInterval(timer)}};}
module.exports={createV36,assess,replay,closeQuote,CONFIG};
