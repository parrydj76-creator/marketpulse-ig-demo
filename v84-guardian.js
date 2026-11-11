'use strict';
// V84: no IG dealing methods, no arm capability. Read-only monitor + deterministic paper test suite.
const path=require('node:path');
const fs=require('node:fs');
const crypto=require('node:crypto');
const hash=o=>crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const validQuote=(q,s)=>s?.streamState==='CONNECTED'&&q&&Number.isFinite(q.bid)&&Number.isFinite(q.ask)&&q.bid>0&&q.ask>q.bid&&Number.isFinite(q.ageMs)&&q.ageMs>=0&&q.ageMs<=15000&&Number.isFinite(q.spreadPips)&&q.spreadPips>=0&&q.spreadPips<=2.5;
const isValidDate=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
function snapshot({paper,stream,research,supervisor,now=Date.now()}){
 const q=stream?.quote||{},p=paper?.position||null,issues=[];
 if(!paper?.journalHealthy)issues.push('PAPER_JOURNAL_UNHEALTHY');
 if(!paper?.scheduled)issues.push('PAPER_SCHEDULER_STOPPED');
 if(!isValidDate(paper?.lastTickAt)||Math.abs(now-Date.parse(paper.lastTickAt))>45000)issues.push('PAPER_WATCHDOG_STALE');
 if(!validQuote(q,stream))issues.push('INVALID_OR_STALE_STREAM_QUOTE');
 if(p&&(!Number.isFinite(p.entry)||!Number.isFinite(p.stop)||!Number.isFinite(p.target)||!Number.isFinite(p.units)||p.units<=0||p.mode!=='PAPER_ONLY'))issues.push('INVALID_PAPER_POSITION');
 if(p&&paper?.lastDecision?.reasons?.includes('INVALID_QUOTE'))issues.push('PAPER_LAST_TICK_INVALID_QUOTE');
 if(supervisor?.supervisorJournalHealthy!==true)issues.push('SUPERVISOR_JOURNAL_UNHEALTHY');
 const certified=['FEED_DELAY_UNCERTIFIED','GBP_PIP_VALUE_UNCERTIFIED','BROKER_DAILY_NET_PNL_UNCERTIFIED','BROKER_STOP_LIFECYCLE_UNCERTIFIED','UNKNOWN_SUBMIT_RECOVERY_UNCERTIFIED'];
 return {version:'84.0.0',mode:'READ_ONLY_PAPER_GUARDIAN',at:new Date(now).toISOString(),paperOperational:issues.length===0,paper:{journalHealthy:paper?.journalHealthy===true,scheduled:paper?.scheduled===true,open:!!p,positionId:p?.id??null,closedTrades:paper?.closedTrades??null,lastTickAt:paper?.lastTickAt??null},feed:{connected:stream?.streamState==='CONNECTED',validQuote:validQuote(q,stream),ageMs:Number.isFinite(q.ageMs)?q.ageMs:null,spreadPips:Number.isFinite(q.spreadPips)?q.spreadPips:null},research:{direction:research?.signal?.direction??'WAIT',score:research?.signal?.score??0},paperIssues:issues,brokerCertificationBlockers:certified,brokerOrderAllowed:false,unattendedOrderAllowed:false,certified:false};
}
function replay({quotes,side='SELL',stopPips=12,targetPips=18,units=2,pipValueGBP=1}){
 if(!Array.isArray(quotes)||quotes.length<2||quotes.length>10000||!['BUY','SELL'].includes(side)||![stopPips,targetPips,units,pipValueGBP].every(x=>Number.isFinite(x)&&x>0))throw Error('INVALID_REPLAY_INPUT');
 let last=-Infinity;for(const q of quotes){if(!Number.isFinite(q.ts)||q.ts<=last||!Number.isFinite(q.bid)||!Number.isFinite(q.ask)||q.bid<=0||q.ask<=q.bid)throw Error('INVALID_REPLAY_QUOTE');last=q.ts}
 const entry=side==='SELL'?quotes[0].bid:quotes[0].ask,stop=entry+(side==='SELL'?1:-1)*stopPips/10000,target=entry+(side==='SELL'?-1:1)*targetPips/10000;
 let exit=null;for(const q of quotes.slice(1)){const px=side==='SELL'?q.ask:q.bid,stopHit=side==='SELL'?px>=stop:px<=stop,targetHit=side==='SELL'?px<=target:px>=target;if(stopHit||targetHit){exit={ts:q.ts,price:px,reason:stopHit?'STOP':'TARGET'};break}}
 const pips=exit?(exit.price-entry)*10000*(side==='SELL'?-1:1):null;
 return {mode:'OFFLINE_PAPER_REPLAY',entry,stop,target,exit,pnlPips:pips,illustrativePnlGBP:pips===null?null:Math.round(pips*units*pipValueGBP*100)/100,assumptionCertified:false,brokerOrderAllowed:false};
}
function createV84({requireAdmin,v81,v82,v68,v71,storageDir,persistentStorage}){
 let healthy=!!persistentStorage,error=null,prev='GENESIS',records=0;
 const file=path.join(storageDir,'v84-guardian-journal.jsonl');
 try{if(!healthy)throw Error('PERSISTENT_STORAGE_REQUIRED');fs.mkdirSync(storageDir,{recursive:true});if(fs.existsSync(file)){const raw=fs.readFileSync(file,'utf8');if(raw&&!raw.endsWith('\n'))throw Error('PARTIAL_JOURNAL');for(const line of raw.split('\n').filter(Boolean)){const e=JSON.parse(line);if(e.prev!==prev||e.hash!==hash({prev:e.prev,data:e.data}))throw Error('JOURNAL_HASH_MISMATCH');prev=e.hash;records++}}}catch(e){healthy=false;error=String(e.message).slice(0,100)}
 function status(){let p,s,r,v;try{p=v81.status();s=v68.status();r=v71.status();v=v82.current()}catch(e){return {version:'84.0.0',error:'DEPENDENCY_UNAVAILABLE',detail:String(e.message).slice(0,100),brokerOrderAllowed:false,unattendedOrderAllowed:false}}return {...snapshot({paper:p,stream:s,research:r,supervisor:v}),guardianJournalHealthy:healthy,guardianJournalError:error,guardianRecords:records,brokerOrderAllowed:false,unattendedOrderAllowed:false}}
 function audit(){if(!healthy)throw Error('GUARDIAN_JOURNAL_UNHEALTHY');const st=status(),data={at:st.at,paperIssues:st.paperIssues||[],paperOperational:st.paperOperational===true};const item={prev,data,hash:hash({prev,data})};const fd=fs.openSync(file,'a');try{fs.writeSync(fd,JSON.stringify(item)+'\n');fs.fsyncSync(fd)}catch(e){healthy=false;error='JOURNAL_WRITE_FAILED';throw e}finally{fs.closeSync(fd)}prev=item.hash;records++;return {...st,guardianRecords:records}}
 function routes(app){app.get('/api/v84/status',requireAdmin,(_q,res)=>res.set('Cache-Control','no-store').json(status()));app.post('/api/v84/audit',requireAdmin,(_q,res)=>{try{res.set('Cache-Control','no-store').json(audit())}catch(e){res.status(503).json({error:String(e.message),brokerOrderAllowed:false})}});app.post('/api/v84/arm',requireAdmin,(_q,res)=>res.status(409).json({error:'BROKER_EXECUTION_HARD_BLOCKED',brokerOrderAllowed:false}));app.get('/v84',requireAdmin,(_q,res)=>res.sendFile(path.join(__dirname,'v84-dashboard.html')))}
 let timer;function start(){if(timer)return;timer=setInterval(()=>{try{audit()}catch(_e){}},60000);timer.unref?.()}
 return {status,audit,routes,start};
}
module.exports={createV84,snapshot,replay,validQuote};
