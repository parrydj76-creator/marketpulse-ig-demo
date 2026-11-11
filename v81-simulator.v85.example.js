'use strict';
// V81 is an isolated PAPER simulator. No IG dealing callback, no execution endpoint.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const v85Integrity=require('./v85-integrity');
const EPIC='CS.D.EURUSD.MINI.IP';
const POLICY=Object.freeze({riskGBP:25,dailyLossGBP:100,maxTradesPerDay:3,maxOpenPositions:1,stopPips:12,targetPips:18,maxSpreadPips:2.5,maxQuoteAgeMs:15000,minSignalScore:70});
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ukDay=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
function classifyDate(v){if(typeof v!=='string')return 'NONSTRING';const s=v.trim();if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(s))return 'ISO_OFFSET';if(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s))return 'LOCAL_TIME_NO_ZONE';if(/^\d{2}-[A-Za-z]{3}-\d{2,4}(?:\s.*)?$/.test(s))return 'DD_MMM_YYYY_NO_ZONE';if(/^\d{4}\/\d{2}\/\d{2}/.test(s))return 'YYYY_SLASH_MM_SLASH_DD';if(/^\d{2}\/\d{2}\/\d{4}/.test(s))return 'SLASH_DAY_MONTH_AMBIGUOUS';if(/^\d{4}-\d{2}-\d{2}$/.test(s))return 'DATE_ONLY';return 'UNKNOWN'}
function createV81({requireAdmin,storageDir,persistentStorage,v68,v71}){
 const file=path.join(storageDir,'v81-paper-journal.jsonl');let entries=[],healthy=!!persistentStorage,error=null,timer=null,busy=false;
 let state={position:null,closed:[],lastDecision:null,lastTickAt:null,blocked:'NOT_STARTED'};
 try{if(!healthy)throw Error('PERSISTENT_STORAGE_REQUIRED');fs.mkdirSync(storageDir,{recursive:true});if(fs.existsSync(file)){const contents=fs.readFileSync(file,'utf8');if(contents&&!contents.endsWith('\n'))throw Error('PARTIAL_JOURNAL_TAIL');let prev='GENESIS';for(const line of contents.split('\n').filter(Boolean)){const e=JSON.parse(line);if(e.prev!==prev||e.hash!==hash({prev:e.prev,kind:e.kind,data:e.data}))throw Error('JOURNAL_CORRUPT');prev=e.hash;entries.push(e);if(e.kind==='STATE')state=e.data;}}}catch(e){healthy=false;error=String(e.message).slice(0,100)}
 function save(next){if(!healthy)throw Error('PERSISTENCE_UNAVAILABLE');const prev=entries.at(-1)?.hash||'GENESIS';const e={prev,kind:'STATE',data:next,hash:hash({prev,kind:'STATE',data:next})};try{const fd=fs.openSync(file,'a');try{fs.writeSync(fd,JSON.stringify(e)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}entries.push(e);state=next}catch(_e){healthy=false;error='JOURNAL_WRITE_FAILED';throw Error(error)}}
 function decision(now=new Date()){
  const stream=v68.status(),research=v71.status(),q=stream?.quote||{},sig=research?.signal||{},reasons=[];
  const bid=Number(q.bid),ask=Number(q.ask),spread=Number(q.spreadPips),age=Number(q.ageMs),dir=String(sig.direction||'WAIT').toUpperCase(),score=Number(sig.score);
  if(!healthy)reasons.push('PERSISTENCE_UNHEALTHY');if(stream?.streamState!=='CONNECTED')reasons.push('FEED_DISCONNECTED');
  if(!Number.isFinite(bid)||!Number.isFinite(ask)||bid<=0.5||bid>=2||ask<=bid||ask>=2)reasons.push('INVALID_QUOTE');
  if(q.ageMs==null||!Number.isFinite(age)||age<0||age>POLICY.maxQuoteAgeMs)reasons.push('STALE_QUOTE');
  if(q.spreadPips==null||!Number.isFinite(spread)||spread<0||spread>POLICY.maxSpreadPips)reasons.push('SPREAD_LIMIT');
  if(!['BUY','SELL','LONG','SHORT'].includes(dir)||!Number.isFinite(score)||score<POLICY.minSignalScore)reasons.push('NO_QUALIFIED_SIGNAL');
  const day=ukDay(now),closed=state.closed.filter(t=>t.ukDay===day&&v85Integrity.validateTrade(t).valid),realised=closed.reduce((s,t)=>s+t.pnlGBP,0),trades=state.closed.filter(t=>(t.openedAt&&ukDay(new Date(t.openedAt))===day)||(!t.openedAt&&t.ukDay===day)).length+(state.position?.ukDay===day?1:0);
  if(trades>=POLICY.maxTradesPerDay)reasons.push('DAILY_TRADE_LIMIT');if(realised<=-POLICY.dailyLossGBP)reasons.push('SIMULATED_DAILY_LOSS_LIMIT');
  if(state.position)reasons.push('SIMULATED_POSITION_OPEN');
  return {at:now.toISOString(),ukDay:day,quote:{bid,ask,spreadPips:spread,ageMs:age},signal:{direction:dir,score},reasons,simulatedDailyPnlGBP:Math.round(realised*100)/100,simulatedTradesToday:trades,brokerOrderAllowed:false,unattendedOrderAllowed:false};
 }
 function tick(now=new Date()){
  if(v85Integrity.control(storageDir).paused)throw Error('V85_PAPER_SAFETY_HOLD');
  if(busy)return {skipped:'BUSY',brokerOrderAllowed:false};busy=true;
  try{
   const d=decision(now),q=d.quote;let next={...state,lastDecision:d,lastTickAt:d.at,blocked:d.reasons.join(',')||null};
   // Simulated fills only. Assumed pip value is £1 per one simulated unit, NOT broker-certified.
   const assumedGBPPerPipPerUnit=1;
   if(next.position&&Number.isFinite(q.bid)&&Number.isFinite(q.ask)&&q.bid>0.5&&q.bid<2&&q.ask>q.bid&&q.ask<2&&!d.reasons.some(r=>['FEED_DISCONNECTED','INVALID_QUOTE','STALE_QUOTE','SPREAD_LIMIT'].includes(r))){
    const p=next.position,exit=p.side==='BUY'?q.bid:q.ask;
    const stopHit=p.side==='BUY'?exit<=p.stop:exit>=p.stop;
    const targetHit=p.side==='BUY'?exit>=p.target:exit<=p.target;
    if(stopHit||targetHit){const pips=(exit-p.entry)*10000*(p.side==='BUY'?1:-1);const pnlGBP=Math.round(pips*p.units*assumedGBPPerPipPerUnit*100)/100;
     next={...next,position:null,closed:[...next.closed,{...p,exit,exitAt:d.at,exitReason:stopHit?'STOP':'TARGET',pnlGBP,ukDay:ukDay(now)}].slice(-500)};
    }
   }
   // Never enter a new position on the same tick as an exit.
   if(!state.position&&!next.position&&d.reasons.length===0){const side=['BUY','LONG'].includes(d.signal.direction)?'BUY':'SELL';
    const entry=side==='BUY'?q.ask:q.bid,stop=entry+(side==='BUY'?-1:1)*POLICY.stopPips/10000,target=entry+(side==='BUY'?1:-1)*POLICY.targetPips/10000;
    const units=Math.floor((POLICY.riskGBP/POLICY.stopPips/assumedGBPPerPipPerUnit)*10)/10;
    if(units>0)next={...next,position:{id:hash({at:d.at,entry,side}).slice(0,16),epic:EPIC,side,entry,stop,target,units,openedAt:d.at,ukDay:d.ukDay,assumedGBPPerPipPerUnit,mode:'PAPER_ONLY'}};
   }
   save(next);return status();
  }finally{busy=false}
 }
 function status(){const integrity=v85Integrity.audit(storageDir);return {version:'81.0.0',mode:'UNATTENDED_PAPER_SIMULATION_ONLY',journalHealthy:healthy,journalError:error,journalEntries:entries.length,scheduled:!!timer,paused:v85Integrity.control(storageDir).paused,integrity:{validTrades:integrity.validTrades,quarantinedTrades:integrity.quarantinedTrades,validSimulatedPnlGBP:integrity.validSimulatedPnlGBP},lastTickAt:state.lastTickAt,lastDecision:state.lastDecision,position:state.position,closedTrades:state.closed.length,latestClosed:state.closed.slice(-5),assumedGBPPerPipPerUnit:1,assumptionCertified:false,brokerOrderAllowed:false,unattendedOrderAllowed:false}}
 function diagnostics(){return {dateExamples:['11-Nov-2026','11-Nov-26','2026/11/11','2026-11-11T14:30:00Z'].map(s=>({format:classifyDate(s),timezoneVerified:classifyDate(s)==='ISO_OFFSET'})),warning:'These are examples, NOT actual IG transaction dates; no broker accounting certification.',brokerOrderAllowed:false}}
 function routes(app){app.get('/api/v81/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v81/diagnostics',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(diagnostics()));app.post('/api/v81/tick',requireAdmin,(_q,r)=>{try{r.set('Cache-Control','no-store').json(tick())}catch(e){r.status(409).json({error:'SIMULATION_TICK_FAILED',detail:String(e.message).slice(0,90),brokerOrderAllowed:false})}});app.post('/api/v81/arm',requireAdmin,(_q,r)=>r.status(409).json({error:'BROKER_ORDER_HARD_BLOCKED',brokerOrderAllowed:false}));app.get('/v81',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'v81-dashboard.html')))}
 function start(){if(timer)return;timer=setInterval(()=>{try{tick()}catch(_e){}},15000);timer.unref?.()}
 return {tick,status,diagnostics,routes,start};
}
module.exports={createV81,classifyDate,POLICY,ukDay};
