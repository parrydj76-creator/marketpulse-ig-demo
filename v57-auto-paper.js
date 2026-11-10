 'use strict';
// Signal-driven PAPER simulator. No broker dealing endpoints or write adapter.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {EPIC}=require('./v54-safety');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const day=()=>new Date().toISOString().slice(0,10);
const num=x=>typeof x==='number'&&Number.isFinite(x);
const config=Object.freeze({size:0.1,stopPips:12,targetPips:18,minScore:70,maxSpreadPips:2.5,maxAgeMs:15000,cycleMs:60000,pipUSD:1,maxDailyLossGBP:100,maxDailyTrades:3});
function evaluate(s,now=Date.now()){
 const reasons=[];if(!s||typeof s!=='object')return {valid:false,reasons:['SNAPSHOT_UNAVAILABLE']};
 if(s.epic!=='CS.D.EURUSD.CFD.IP')reasons.push('SIGNAL_SOURCE_MISMATCH');
 if(!['LONG','SHORT','WAIT'].includes(s.direction))reasons.push('NO_QUALIFIED_SIGNAL');
 if(!num(s.score)||s.score<config.minScore)reasons.push('SCORE_BELOW_THRESHOLD');
 if(!Number.isInteger(s.bars)||s.bars<30)reasons.push('INSUFFICIENT_BARS');
 if(typeof s.bar!=='string'||!Number.isFinite(Date.parse(s.bar))||Date.parse(s.bar)>now||now-Date.parse(s.bar)>20*60000)reasons.push('BAR_UNAVAILABLE_OR_STALE');
 if(s.source!=='STREAM'||!num(s.ageMs)||s.ageMs<0||s.ageMs>config.maxAgeMs)reasons.push('STREAM_NOT_FRESH');
 if(s.delayed!==false)reasons.push('DELAY_STATUS_NOT_VERIFIED');
 if(s.marketState!=='DEAL')reasons.push('MARKET_NOT_DEALABLE');
 if(!num(s.bid)||!num(s.ask)||s.bid<=0||s.ask<=s.bid)reasons.push('INVALID_BID_ASK');
 else if((s.ask-s.bid)/0.0001>config.maxSpreadPips)reasons.push('SPREAD_TOO_WIDE');
 return {valid:reasons.length===0,reasons};
}
function createV57({requireAdmin,storageDir,persistentStorage,readBroker,signalSnapshot,intervalMs=config.cycleMs,enableTimer=true}){
 const bootId=crypto.randomUUID(),file=path.join(storageDir,'v57-auto-paper.jsonl');let rows=[],healthy=!!persistentStorage,lastError=null,armed=false,busy=false,timer=null,lastReview=null;
 try{if(healthy){fs.mkdirSync(storageDir,{recursive:true});if(fs.existsSync(file)){let prev='GENESIS';for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.prev!==prev||r.hash!==hash({prev:r.prev,at:r.at,type:r.type,payload:r.payload}))throw Error('V57_JOURNAL_INTEGRITY_FAILURE');rows.push(r);prev=r.hash}}}}catch(e){healthy=false;lastError=e.message}
 function append(type,payload){if(!healthy)throw Error('V57_JOURNAL_UNAVAILABLE');const r={prev:rows.at(-1)?.hash||'GENESIS',at:new Date().toISOString(),type,payload};r.hash=hash(r);try{fs.appendFileSync(file,JSON.stringify(r)+'\n',{flag:'a'});rows.push(r)}catch(e){healthy=false;lastError=e.message;armed=false;throw e}return r}
 const last=t=>[...rows].reverse().find(r=>r.type===t);
 const stopped=()=>{const s=last('EMERGENCY_STOP');return !!s}; // permanent for this journal; operator must explicitly archive and reset offline
 const open=()=>{const opens=rows.filter(r=>r.type==='PAPER_OPEN');const closed=new Set(rows.filter(r=>r.type==='PAPER_CLOSE').map(r=>r.payload.id));return opens.filter(r=>!closed.has(r.payload.id))};
 const counts=()=>{const d=day(),today=rows.filter(r=>r.at.startsWith(d));return {tradesToday:today.filter(r=>r.type==='PAPER_OPEN').length,lossGBP:Math.round(today.filter(r=>r.type==='PAPER_CLOSE').reduce((a,r)=>a+Math.max(0,-r.payload.pnlGBP),0)*100)/100}};
 function status(){return {version:'57.0.0',mode:'AUTOMATIC_SIGNAL_PAPER_ONLY',bootId,persistentStorageConfigured:!!persistentStorage,journalHealthy:healthy,journalEvents:rows.length,lastError,autoPaperArmed:armed,emergencyStop:stopped(),openPaperPositions:open().length,openPaper:open().map(r=>r.payload),...counts(),lastReview,config,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,readyForUnattendedDemo:false,certifications:{gbpSizing:false,brokerLifecycle:false,unknownOrderRecovery:false,unattendedAdapter:false},warning:'CFD quotes are a proxy for EUR/USD Mini; P/L is hypothetical, not executable or broker verified. No IG orders submitted.'}}
 function quoteClose(position,s){const side=position.direction==='BUY'?'SELL':'BUY',price=side==='SELL'?s.bid:s.ask;if(!num(price)||price<=0)return null;const crossed=position.direction==='BUY'?(price<=position.stop?'STOP':price>=position.target?'TARGET':null):(price>=position.stop?'STOP':price<=position.target?'TARGET':null);if(!crossed)return null;const exitPrice=price;const pipDelta=(position.direction==='BUY'?exitPrice-position.entry:position.entry-exitPrice)/0.0001;const pnlGBP=Math.round(pipDelta*position.size*config.pipUSD*position.usdToGbp*100)/100;return {id:position.id,reason:crossed,exitPrice,pnlGBP,source:'CFD_QUOTE_PROXY_PAPER_ONLY',submittedToBroker:false}}
 async function cycle(){if(busy)throw Error('V57_CYCLE_BUSY');busy=true;try{if(!healthy||!armed||stopped())throw Error('V57_DISARMED_OR_UNHEALTHY');const s=signalSnapshot(),validation=evaluate(s),positions=open(),c=counts();const reasons=[...validation.reasons];if(c.tradesToday>=config.maxDailyTrades)reasons.push('DAILY_TRADE_CAP');if(c.lossGBP>=config.maxDailyLossGBP)reasons.push('DAILY_LOSS_CAP');
 // Never open/close a paper trade when source quote cannot be trusted.
 if(!validation.valid){lastReview={at:new Date().toISOString(),action:'SKIP',reasons};return {action:'SKIP',reasons,brokerOrderAllowed:false}}
 const b=await readBroker();if(!b||b.currency!=='GBP'||!b.accountFingerprint||!Array.isArray(b.positions))reasons.push('BROKER_READBACK_UNAVAILABLE');else if(b.positions.some(p=>p.epic===EPIC))reasons.push('MINI_BROKER_POSITION_PRESENT');
 if(reasons.some(x=>['BROKER_READBACK_UNAVAILABLE','MINI_BROKER_POSITION_PRESENT'].includes(x))){lastReview={at:new Date().toISOString(),action:'SKIP',reasons};return {action:'SKIP',reasons,brokerOrderAllowed:false}}
 if(positions.length){const p=positions[0].payload;const result=quoteClose(p,s);if(!result){lastReview={at:new Date().toISOString(),action:'HOLD',id:p.id};return {action:'HOLD',id:p.id,brokerOrderAllowed:false}}append('PAPER_CLOSE',result);lastReview={at:new Date().toISOString(),action:'CLOSE',reason:result.reason,id:p.id};return {action:'CLOSE',...result,brokerOrderAllowed:false}}
 if(reasons.length){lastReview={at:new Date().toISOString(),action:'SKIP',reasons};return {action:'SKIP',reasons,brokerOrderAllowed:false}}
 if(!['LONG','SHORT'].includes(s.direction)){lastReview={at:new Date().toISOString(),action:'WAIT'};return {action:'WAIT',brokerOrderAllowed:false}}
 const id='v57-'+hash({bar:s.bar,direction:s.direction}).slice(0,24);if(rows.some(r=>r.type==='PAPER_OPEN'&&r.payload.id===id))return {action:'SKIP',reasons:['DUPLICATE_SIGNAL_BAR'],brokerOrderAllowed:false};
 // No hard-coded FX conversion: verified GBP conversion is required for indicative paper sizing.
 if(!num(s.usdToGbp)||s.usdToGbp<=0||s.usdToGbp>2)return {action:'SKIP',reasons:['GBP_CONVERSION_UNAVAILABLE'],brokerOrderAllowed:false};
 const indicativeRiskGBP=Math.round(config.size*config.stopPips*config.pipUSD*s.usdToGbp*100)/100;if(indicativeRiskGBP>25)return {action:'SKIP',reasons:['RISK_OVER_25_GBP'],brokerOrderAllowed:false};
 const direction=s.direction==='LONG'?'BUY':'SELL',entry=direction==='BUY'?s.ask:s.bid,sign=direction==='BUY'?1:-1;
 const payload={id,epic:EPIC,sourceEpic:s.epic,source:'CFD_STREAM_PROXY',bar:s.bar,score:s.score,direction,size:config.size,entry,stop:entry-sign*config.stopPips*0.0001,target:entry+sign*config.targetPips*0.0001,usdToGbp:s.usdToGbp,indicativeRiskGBP,accountFingerprint:b.accountFingerprint,submittedToBroker:false};append('PAPER_OPEN',payload);lastReview={at:new Date().toISOString(),action:'OPEN',id};return {action:'OPEN',paper:payload,brokerOrderAllowed:false}
 }finally{busy=false}}
 function arm(){if(!healthy||stopped()||open().length)throw Error('V57_ARM_BLOCKED');armed=true;append('ARM',{bootId});return {autoPaperArmed:true,brokerOrderAllowed:false}}
 function disarm(){armed=false;append('DISARM',{bootId});return {autoPaperArmed:false,brokerOrderAllowed:false}}
 function emergency(){armed=false;append('EMERGENCY_STOP',{bootId});return {emergencyStop:true,brokerOrderAllowed:false}}
 function routes(app){const handler=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn())}catch(e){res.status(409).json({error:String(e.message||e).slice(0,160),brokerOrderAllowed:false})}};
 app.get('/api/v57/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
 app.get('/api/v57/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({journalHealthy:healthy,events:rows.slice(-100).map(r=>({at:r.at,type:r.type,payload:r.payload}))}));
 for(const [name,fn] of [['arm-paper',arm],['stop-paper',disarm],['cycle',cycle],['emergency-stop',emergency]])app.post('/api/v57/'+name,requireAdmin,handler(fn));
 app.post('/api/v57/arm-unattended',requireAdmin,(_q,r)=>r.status(409).json({error:'BROKER_EXECUTION_NOT_CERTIFIED',brokerOrderAllowed:false}));
 app.get('/v57',(_q,r)=>r.sendFile(path.join(__dirname,'public','v57.html')));
 }
 if(enableTimer){timer=setInterval(()=>{if(armed)void cycle().catch(e=>{armed=false;lastError=String(e.message||e);try{append('HALTED',{reason:lastError})}catch{}})},intervalMs);timer.unref?.()}
 return {routes,status,cycle,arm,disarm,emergency,shutdown:()=>timer&&clearInterval(timer)};
}
module.exports={createV57,evaluate};
