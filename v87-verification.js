'use strict';
// Read-only verification workbench. Never grants broker execution permission.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function evaluateFeed(feed,now=Date.now()){
 const q=feed?.quote||{};const reasons=[];
 if(feed?.streamState!=='CONNECTED')reasons.push('STREAM_NOT_CONNECTED');
 if(!finite(q.bid)||!finite(q.ask)||q.bid<=0||q.ask<=q.bid)reasons.push('INVALID_BID_ASK');
 if(!finite(q.spreadPips)||q.spreadPips<0||q.spreadPips>2.5)reasons.push('SPREAD_UNACCEPTABLE');
 if(!finite(q.ageMs)||q.ageMs<0||q.ageMs>15000)reasons.push('QUOTE_NOT_LOCALLY_FRESH');
 // Exchange timestamps and delay are NOT inferred from local arrival times.
 const delay= q.delay??q.delayed??feed?.delay??null;
 const exchangeTime=q.exchangeTimestamp??feed?.exchangeTimestamp??null;
 const timestampParse=typeof exchangeTime==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(exchangeTime)?Date.parse(exchangeTime):NaN;
 const exchangeTimestampObserved=Number.isFinite(timestampParse)&&timestampParse<=now&&now-timestampParse<=15000;
 const delayExplicitlyZero=delay===0||delay==='0';
 if(!exchangeTimestampObserved)reasons.push('EXCHANGE_TIMESTAMP_UNVERIFIED');
 if(!delayExplicitlyZero)reasons.push('DELAY_NOT_EXPLICITLY_ZERO');
 return {connected:feed?.streamState==='CONNECTED',localQuoteChecksPassed:reasons.every(x=>!['STREAM_NOT_CONNECTED','INVALID_BID_ASK','SPREAD_UNACCEPTABLE','QUOTE_NOT_LOCALLY_FRESH'].includes(x)),exchangeTimestampObserved,delayExplicitlyZero,certified:false,reasons,quote:{bid:finite(q.bid)?q.bid:null,ask:finite(q.ask)?q.ask:null,spreadPips:finite(q.spreadPips)?q.spreadPips:null,ageMs:finite(q.ageMs)?q.ageMs:null},note:'Observed fields are diagnostic evidence, not independent IG feed certification.'};
}
function createV87({requireAdmin,storageDir,v68,v85,v86}){
 const ledger=path.join(storageDir,'v87-evidence.jsonl');let healthy=true,previous='GENESIS',count=0,last=null,issue=null;
 try{if(fs.existsSync(ledger)){const raw=fs.readFileSync(ledger,'utf8');if(raw&&!raw.endsWith('\n'))throw Error('PARTIAL_EVIDENCE_TAIL');for(const line of raw.split('\n').filter(Boolean)){const e=JSON.parse(line);if(e.previous!==previous||e.hash!==sha({previous:e.previous,payload:e.payload}))throw Error('EVIDENCE_CHAIN_MISMATCH');previous=e.hash;count++;last=e.payload;}}}catch(e){healthy=false;issue=String(e.message).slice(0,100)}
 function status(){let feed={},readiness={},integrity={};try{feed=v68.status()||{}}catch(e){feed={error:String(e.message)}}try{readiness=v86.status()||{}}catch(e){readiness={error:String(e.message)}}try{integrity=v85.status()||{}}catch(e){integrity={error:String(e.message)}}const feedEvidence=evaluateFeed(feed);return {version:'87.0.0',mode:'READ_ONLY_VERIFICATION_WORKBENCH',brokerOrderAllowed:false,unattendedOrderAllowed:false,readyForUnattendedDemo:false,evidenceLedgerHealthy:healthy,evidenceLedgerError:issue,evidenceRecords:count,lastEvidence:last,feedEvidence,readinessBlockers:readiness.blockers||[],paperPaused:integrity.control?.paused===true,quarantinedTrades:integrity.quarantinedTrades??null,contractRisk:{certified:false,reason:'IG Mini GBP/pip, size, fees and FX conversion require independent verification'},brokerDailyNetPnl:{certified:false,reason:'No broker transactions, charges and daily balance reconciliation certified'},orderLifecycle:{certified:false,reason:'Stops, confirmations, unknown submissions and restart reconciliation unverified'},singleWriter:{certified:false,reason:'Multi-instance lock not independently certified'},warning:'Evidence capture is diagnostic only; it cannot enable broker orders.'}}
 function capture(){if(!healthy)throw Error('EVIDENCE_LEDGER_UNHEALTHY');const s=status();const payload={at:new Date().toISOString(),feed:s.feedEvidence,readinessBlockers:s.readinessBlockers,paperPaused:s.paperPaused,quarantinedTrades:s.quarantinedTrades,brokerOrderAllowed:false};const e={previous,payload,hash:sha({previous,payload})};fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(ledger,'a',0o600);try{fs.writeSync(fd,JSON.stringify(e)+'\n');fs.fsyncSync(fd)}catch(err){healthy=false;issue='EVIDENCE_WRITE_FAILED';throw err}finally{fs.closeSync(fd)}previous=e.hash;count++;last=payload;return {recorded:true,evidenceRecords:count,evidenceHash:e.hash,brokerOrderAllowed:false}}
 function routes(app){app.get('/api/v87/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v87/feed',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status().feedEvidence));app.post('/api/v87/evidence/capture',requireAdmin,(_q,r)=>{try{r.set('Cache-Control','no-store').json(capture())}catch(e){r.status(503).json({error:'EVIDENCE_CAPTURE_FAILED',brokerOrderAllowed:false})}});app.post('/api/v87/arm',requireAdmin,(_q,r)=>r.status(409).json({error:'BROKER_ORDER_HARD_BLOCKED',brokerOrderAllowed:false}));}
 return {status,capture,routes};
}
module.exports={createV87,evaluateFeed};
