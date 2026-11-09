 'use strict';
// v39 observer and controlled dry-run verification. NEVER imports IG order APIs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const MAX_HOLD_HOURS=24;
function verify(rows){let head='GENESIS';const ids=new Set();for(const row of rows){if(!row||row.previous!==head||row.digest!==hash({previous:row.previous,event:row.event}))throw Error('V39_JOURNAL_INVALID');const e=row.event;if(!e||typeof e.id!=='string'||ids.has(e.id))throw Error('V39_EVENT_INVALID');ids.add(e.id);head=row.digest}return head}
function inspect({paper={},audit={},verification={},now=Date.now()}={}){
 const issues=[],position=paper.openPosition||null,started=Date.parse(position?.openedAt),cycleAt=Date.parse(paper.lastCycle),heartbeatAgeMs=Number.isFinite(cycleAt)?now-cycleAt:null;
 if(paper.enabled===true&&(heartbeatAgeMs===null||heartbeatAgeMs>90000||heartbeatAgeMs<0))issues.push('PAPER_HEARTBEAT_MISSING_OR_STALE');
 if(paper.storageHealthy!==true||paper.journal?.valid!==true)issues.push('PAPER_JOURNAL_UNHEALTHY');
 if(audit.auditHealthy!==true)issues.push('AUDIT_JOURNAL_UNHEALTHY');
 if(verification.storageHealthy!==true)issues.push('EVIDENCE_JOURNAL_UNHEALTHY');
 if(position&&!Number.isFinite(started))issues.push('POSITION_OPEN_TIME_INVALID');
 const holdHours=position&&Number.isFinite(started)?Math.max(0,(now-started)/3600000):null;
 if(holdHours!==null&&holdHours>=MAX_HOLD_HOURS)issues.push('POSITION_EXCEEDS_MAX_HOLD_REVIEW');
 const feed=audit.signal?.feed||{},quoteValid=feed.verifiedMarketStatus==='TRADEABLE'&&feed.dealingFlag==='DEAL'&&feed.delayed===false&&finite(feed.ageMs)&&feed.ageMs>=0&&feed.ageMs<=10000&&finite(feed.bid)&&finite(feed.ask)&&feed.ask>feed.bid;
 if(position&&!quoteValid)issues.push('OPEN_POSITION_FEED_UNVERIFIED');
 let mark=null;if(position&&quoteValid){const exit=position.direction==='LONG'?feed.bid:feed.ask;const pipDelta=(exit-position.entry)/0.0001*(position.direction==='LONG'?1:-1);mark={exitQuote:exit,pips:Number(pipDelta.toFixed(2)),illustrativePnlGBP:Number((pipDelta*position.size*position.pipValueGBP).toFixed(2)),source:'ILLUSTRATIVE_NOT_IG_BROKER_PNL'};}
 return {paperEnabled:paper.enabled===true,position,closedTrades:paper.closedTrades??null,heartbeat:{lastCycle:paper.lastCycle||null,cycleCount:paper.cycleCount??null,ageMs:heartbeatAgeMs,healthy:paper.enabled===true&&heartbeatAgeMs!==null&&heartbeatAgeMs<=90000&&heartbeatAgeMs>=0},holdingHours:holdHours===null?null:Number(holdHours.toFixed(2)),maxHoldReviewHours:MAX_HOLD_HOURS,feedVerified:quoteValid,mark,issues,brokerOrderAllowed:false};
}
function validateIntent(x){if(!x||x.kind!=='DEMO_ORDER_DRY_RUN')throw Error('DRY_RUN_ONLY');if(typeof x.epic!=='string'||!/^CS\.D\.[A-Z]{6}\.CFD\.IP$/.test(x.epic))throw Error('INVALID_EPIC');if(!['LONG','SHORT'].includes(x.direction))throw Error('INVALID_DIRECTION');if(typeof x.operatorNote!=='string'||x.operatorNote.trim().length<8||x.operatorNote.length>300)throw Error('OPERATOR_NOTE_REQUIRED');return {kind:x.kind,epic:x.epic,direction:x.direction,operatorNote:x.operatorNote.trim()}}
function createV39({requireAdmin,storageDir,persistentStorage,v36Status,v37Status,v38Status}){
 const file=path.join(storageDir,'v39-dry-run-intents.json');let rows=[],healthy=true,error=null;
 try{if(fs.existsSync(file)){rows=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(rows))throw Error('V39_NOT_ARRAY');verify(rows)}}catch(e){healthy=false;error=e.message}
 function snapshot(){return inspect({paper:v36Status(),audit:v37Status(),verification:v38Status()})}
 function status(){let lifecycle;try{lifecycle=snapshot()}catch(e){lifecycle={issues:['DEPENDENCY_STATUS_ERROR'],error:e.message,brokerOrderAllowed:false}}
 return {version:'39.0.0',mode:'PAPER_LIFECYCLE_AND_IG_DEMO_DRY_RUN',journalHealthy:healthy,persistentStorageConfigured:!!persistentStorage,journalEvents:rows.length,journalHead:healthy?verify(rows):null,lifecycle,certifications:{gbpSizing:false,brokerLifecycle:false,crashRecovery:false},readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,error,warning:'Dry runs never submit IG orders. Time-limit is an alert, not an automatic closure. No broker order APIs are imported.'}}
 function dryRun(x){if(!healthy||!persistentStorage)throw Error('DURABLE_JOURNAL_REQUIRED');const accepted=validateIntent(x),life=snapshot();const event={...accepted,id:crypto.randomUUID(),at:new Date().toISOString(),result:'BLOCKED_NO_BROKER_WRITE',issues:life.issues,classification:'SIMULATION_ONLY'};const previous=rows.at(-1)?.digest||'GENESIS',next=[...rows,{previous,event,digest:hash({previous,event})}],tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const dir=fs.openSync(storageDir,'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}rows=next;return event}catch(e){healthy=false;error=e.message;throw e}}
 function routes(app){app.get('/api/v39/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v39/intents',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:rows.slice(-100).map(r=>r.event),total:rows.length,healthy,brokerOrderAllowed:false}));app.post('/api/v39/dry-run',requireAdmin,(q,r)=>{try{r.status(201).json({event:dryRun(q.body),brokerOrderAllowed:false})}catch(e){r.status(400).json({error:e.message,brokerOrderAllowed:false})}});app.get('/v39',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v39.html')))}
 return {routes,status,dryRun};}
module.exports={createV39,inspect,verify,validateIntent,MAX_HOLD_HOURS};
