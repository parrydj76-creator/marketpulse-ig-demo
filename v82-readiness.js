'use strict';
// v82: broker-write-free supervisor, simulation validation and certification gate.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const POLICY=Object.freeze({riskGBP:25,dailyLossGBP:100,maxTradesPerDay:3,maxOpenPositions:1,stopPips:12,targetPips:18,maxSpreadPips:2.5,maxQuoteAgeMs:15000,minScore:70});
const sha=o=>crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function evaluate({stream={},research={},paper={},audit={},now=Date.now()}={}){
 const q=stream.quote||{},s=research.signal||{},p=paper.position||null,issues=[];
 if(stream.streamState!=='CONNECTED')issues.push('FEED_DISCONNECTED');
 if(!finite(q.bid)||!finite(q.ask)||q.bid<=0||q.ask<=q.bid)issues.push('INVALID_BID_ASK');
 if(!finite(q.ageMs)||q.ageMs<0||q.ageMs>POLICY.maxQuoteAgeMs)issues.push('QUOTE_STALE');
 if(!finite(q.spreadPips)||q.spreadPips<0||q.spreadPips>POLICY.maxSpreadPips)issues.push('SPREAD_UNACCEPTABLE');
 if(q.exchangeTimestampCertified!==true||q.delay!==0)issues.push('FEED_ENTITLEMENT_UNCERTIFIED');
 if(!paper.journalHealthy)issues.push('PAPER_JOURNAL_UNHEALTHY');
 if(!paper.scheduled)issues.push('PAPER_SCHEDULER_STOPPED');
 if(!paper.lastTickAt||!Number.isFinite(Date.parse(paper.lastTickAt))||now-Date.parse(paper.lastTickAt)>45000||now<Date.parse(paper.lastTickAt)-5000)issues.push('PAPER_WATCHDOG_STALE');
 if(!['BUY','SELL','LONG','SHORT'].includes(s.direction)||!finite(s.score)||s.score<POLICY.minScore)issues.push('NO_QUALIFIED_SIGNAL');
 if(p&&p.mode!=='PAPER_ONLY')issues.push('UNEXPECTED_POSITION_MODE');
 if(p&&(!finite(p.stop)||!finite(p.target)||!finite(p.entry)||!finite(p.units)||p.units<=0))issues.push('INVALID_PAPER_POSITION');
 if(paper.assumptionCertified!==true)issues.push('GBP_PIP_VALUE_UNCERTIFIED');
 if(audit.ledger?.certified!==true)issues.push('BROKER_NET_PNL_UNCERTIFIED');
 if(audit.lifecycle?.supervisedOpenStopCloseCertified!==true)issues.push('SUPERVISED_LIFECYCLE_UNCERTIFIED');
 if(audit.lifecycle?.unknownSubmitRecoveryCertified!==true)issues.push('UNKNOWN_SUBMIT_RECOVERY_UNCERTIFIED');
 return {at:new Date(now).toISOString(),mode:'READ_ONLY_CERTIFICATION_AND_PAPER_VALIDATION',paperOperational:!!paper.journalHealthy&&!!paper.scheduled&&!issues.includes('PAPER_WATCHDOG_STALE'),quote:{bid:q.bid??null,ask:q.ask??null,ageMs:q.ageMs??null,spreadPips:q.spreadPips??null},signal:{direction:s.direction??'WAIT',score:s.score??0},paper:{open:!!p,closedTrades:paper.closedTrades??0,journalHealthy:!!paper.journalHealthy,scheduled:!!paper.scheduled,lastTickAt:paper.lastTickAt??null},blockers:issues,certified:false,brokerOrderAllowed:false,unattendedOrderAllowed:false};
}
function replay(quotes,config={}){
 if(!Array.isArray(quotes)||quotes.length>100000)throw Error('REPLAY_LENGTH_INVALID');
 const {side='BUY',entryIndex=0,stopPips=POLICY.stopPips,targetPips=POLICY.targetPips,units=1,assumedGBPPerPip=1}=config;
 if(!['BUY','SELL'].includes(side)||!Number.isInteger(entryIndex)||entryIndex<0||entryIndex>=quotes.length||!finite(units)||units<=0||!finite(assumedGBPPerPip)||assumedGBPPerPip<=0||!finite(stopPips)||stopPips<=0||!finite(targetPips)||targetPips<=0)throw Error('REPLAY_CONFIG_INVALID');
 let prev=-Infinity;for(const q of quotes){if(!q||!finite(q.bid)||!finite(q.ask)||q.bid<=0||q.ask<=q.bid||!finite(q.ts)||q.ts<=prev)throw Error('REPLAY_QUOTE_INVALID_OR_UNORDERED');prev=q.ts}
 const initial=quotes[entryIndex],entry=side==='BUY'?initial.ask:initial.bid,stop=entry+(side==='BUY'?-1:1)*stopPips/10000,target=entry+(side==='BUY'?1:-1)*targetPips/10000;
 let exit=null;for(let i=entryIndex+1;i<quotes.length;i++){const q=quotes[i],px=side==='BUY'?q.bid:q.ask;const stopHit=side==='BUY'?px<=stop:px>=stop,targetHit=side==='BUY'?px>=target:px<=target;if(stopHit||targetHit){exit={index:i,ts:q.ts,price:px,reason:stopHit?'STOP':'TARGET'};break}}
 const pnlPips=exit?(exit.price-entry)*10000*(side==='BUY'?1:-1):null;
 return {mode:'OFFLINE_REPLAY_NO_BROKER',side,entry,stop,target,exit,pnlPips:pnlPips===null?null:Math.round(pnlPips*1000)/1000,illustrativePnlGBP:pnlPips===null?null:Math.round(pnlPips*units*assumedGBPPerPip*100)/100,assumptionCertified:false,warning:'Sampled quote replay, not a broker fill or certified GBP risk result.',brokerOrderAllowed:false};
}
function createV82({requireAdmin,storageDir,persistentStorage,v68,v71,v81,v80}){
 let history=[],healthy=!!persistentStorage,problem=null,prev='GENESIS';const file=path.join(storageDir,'v82-supervisor.jsonl');
 try{if(!healthy)throw Error('PERSISTENT_STORAGE_REQUIRED');fs.mkdirSync(storageDir,{recursive:true});if(fs.existsSync(file)){const raw=fs.readFileSync(file,'utf8');if(raw&&!raw.endsWith('\n'))throw Error('PARTIAL_JOURNAL_TAIL');for(const line of raw.split('\n').filter(Boolean)){const x=JSON.parse(line);if(x.prev!==prev||x.hash!==sha({prev:x.prev,data:x.data}))throw Error('JOURNAL_INTEGRITY_FAILED');prev=x.hash;history.push(x.data)}}}catch(e){healthy=false;problem=e.message}
 function current(){const paper=v81.status(),stream=v68.status(),research=v71.status();return {...evaluate({paper,stream,research}),version:'82.0.0',supervisorJournalHealthy:healthy,supervisorJournalError:problem,supervisorRecords:history.length,readiness:'NOT_CERTIFIED'};}
 function audit(){if(!healthy)throw Error('SUPERVISOR_JOURNAL_UNHEALTHY');const result=current(),data={at:result.at,blockers:result.blockers,paperOperational:result.paperOperational};const item={prev,data,hash:sha({prev,data})};const fd=fs.openSync(file,'a');try{fs.writeSync(fd,JSON.stringify(item)+'\n');fs.fsyncSync(fd)}catch(e){healthy=false;problem='JOURNAL_WRITE_FAILED';throw e}finally{fs.closeSync(fd)}prev=item.hash;history.push(data);return {...result,supervisorRecords:history.length}}
 function routes(app){app.get('/api/v82/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(current()));app.post('/api/v82/audit',requireAdmin,(_q,r)=>{try{r.set('Cache-Control','no-store').json(audit())}catch(e){r.status(503).json({error:String(e.message).slice(0,100),brokerOrderAllowed:false})}});app.post('/api/v82/arm',requireAdmin,(_q,r)=>r.status(409).json({error:'IG_BROKER_EXECUTION_HARD_BLOCKED',brokerOrderAllowed:false}));app.get('/v82',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'v82-dashboard.html')))}
 let timer=null;function start(){if(timer)return;timer=setInterval(()=>{try{audit()}catch(_e){}},60000);timer.unref?.()}
 return {current,audit,routes,start};
}
module.exports={createV82,evaluate,replay,POLICY};
