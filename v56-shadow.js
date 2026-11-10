'use strict';
// Autonomous SHADOW/PAPER cycle only. This module has no IG dealing adapter.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {EPIC,validateProposal}=require('./v54-safety');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const utcDay=()=>new Date().toISOString().slice(0,10);
function assess({proposal,broker,lossGBP,tradesToday,stopped,pending}){
 const reasons=[];
 if(stopped)reasons.push('EMERGENCY_STOP');
 if(pending)reasons.push('PENDING_UNRESOLVED_SHADOW_INTENT');
 if(!broker||broker.currency!=='GBP'||!broker.accountFingerprint||!Array.isArray(broker.positions))reasons.push('BROKER_READBACK_UNAVAILABLE');
 else if(broker.positions.some(p=>p.epic===EPIC))reasons.push('MINI_BROKER_POSITION_PRESENT');
 if(!Number.isFinite(lossGBP)||lossGBP<0)reasons.push('DAILY_LOSS_UNKNOWN');
 else if(lossGBP>=100)reasons.push('DAILY_LOSS_LIMIT');
 if(!Number.isInteger(tradesToday)||tradesToday<0)reasons.push('TRADE_COUNT_UNKNOWN');
 else if(tradesToday>=3)reasons.push('DAILY_TRADE_LIMIT');
 if(!proposal)reasons.push('NO_QUEUED_CANDIDATE');
 return {eligibleForPaperOnly:reasons.length===0,reasons,brokerOrderAllowed:false};
}
function createV56({requireAdmin,storageDir,persistentStorage,readBroker,intervalMs=60000,enableTimer=true}){
 const bootId=crypto.randomUUID(),file=path.join(storageDir,'v56-shadow.jsonl');let rows=[],healthy=!!persistentStorage,lastError=null,busy=false,timer=null;
 try{if(healthy){fs.mkdirSync(storageDir,{recursive:true});if(fs.existsSync(file)){let prev='GENESIS';for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.prev!==prev||r.hash!==sha({prev:r.prev,at:r.at,type:r.type,payload:r.payload}))throw Error('SHADOW_JOURNAL_INTEGRITY_FAILURE');rows.push(r);prev=r.hash}}}}catch(e){healthy=false;lastError=e.message}
 function append(type,payload){if(!healthy)throw Error('SHADOW_JOURNAL_UNAVAILABLE');const r={prev:rows.at(-1)?.hash||'GENESIS',at:new Date().toISOString(),type,payload};r.hash=sha(r);try{fs.appendFileSync(file,JSON.stringify(r)+'\n');rows.push(r)}catch(e){healthy=false;lastError=e.message;throw e}return r}
 const last=t=>[...rows].reverse().find(r=>r.type===t);
 const stopped=()=>{const s=last('EMERGENCY_STOP');const reset=last('RESET_STOP');return !!s&&(!reset||rows.indexOf(s)>rows.indexOf(reset))};
 // Arm never persists across restarts: requires an explicit operator action after every boot.
 let armed=false;
 const dayCounts=()=>{const day=utcDay();const events=rows.filter(r=>r.at.startsWith(day));return {tradesToday:events.filter(r=>r.type==='PAPER_OPEN').length,lossGBP:events.filter(r=>r.type==='PAPER_CLOSE').reduce((a,r)=>a+Math.max(0,-r.payload.pnlGBP),0)}};
 const queued=()=>{const done=new Set(rows.filter(r=>['PAPER_OPEN','CANDIDATE_CANCEL'].includes(r.type)).map(r=>r.payload.clientIntentId));return rows.filter(r=>r.type==='CANDIDATE'&&!done.has(r.payload.clientIntentId))};
 const openPaper=()=>{const opened=rows.filter(r=>r.type==='PAPER_OPEN');const closed=new Set(rows.filter(r=>r.type==='PAPER_CLOSE').map(r=>r.payload.clientIntentId));return opened.filter(r=>!closed.has(r.payload.clientIntentId))};
 function status(){return {version:'56.0.0',mode:'UNATTENDED_SHADOW_PAPER_ONLY',bootId,persistentStorageConfigured:!!persistentStorage,journalHealthy:healthy,journalEvents:rows.length,lastError,shadowArmed:armed,emergencyStop:stopped(),queuedCandidates:queued().length,openPaperPositions:openPaper().length,...dayCounts(),brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,readyForUnattendedDemo:false,certifications:{gbpSizing:false,brokerLifecycle:false,unknownOrderRecovery:false,unattendedAdapter:false},warning:'Shadow decisions are simulations. No broker orders, stops, or closes are submitted.'}}
 function queue(p){if(stopped())throw Error('EMERGENCY_STOP');if(!healthy)throw Error('JOURNAL_UNAVAILABLE');const v=validateProposal(p);if(rows.some(r=>r.payload?.clientIntentId===v.clientIntentId))throw Error('DUPLICATE_INTENT');if(queued().length||openPaper().length)throw Error('PENDING_SHADOW_POSITION_OR_CANDIDATE');append('CANDIDATE',{...v,source:'OPERATOR_SUPPLIED_INDICATIVE',submittedToBroker:false});return {queued:true,indicativeRiskGBP:v.indicativeGBP,brokerOrderAllowed:false}}
 async function cycle(){if(busy)throw Error('CYCLE_BUSY');busy=true;try{if(!healthy)throw Error('JOURNAL_UNAVAILABLE');if(!armed)throw Error('SHADOW_NOT_ARMED');const b=await readBroker();const candidates=queued(),counts=dayCounts();const review=assess({proposal:candidates[0],broker:b,...counts,stopped:stopped(),pending:openPaper().length>0});append('SHADOW_CYCLE',{bootId,accountFingerprint:b?.accountFingerprint||null,review});if(!review.eligibleForPaperOnly)return {paperOpened:false,...review};const p=candidates[0].payload;append('PAPER_OPEN',{clientIntentId:p.clientIntentId,accountFingerprint:b.accountFingerprint,indicativeRiskGBP:p.indicativeGBP,direction:p.direction,size:p.size,stopPips:p.stopPips,submittedToBroker:false});return {paperOpened:true,clientIntentId:p.clientIntentId,submittedToBroker:false,brokerOrderAllowed:false}}finally{busy=false}}
 function closePaper(p){if(!p||typeof p.clientIntentId!=='string'||!Number.isFinite(p.pnlGBP)||Math.abs(p.pnlGBP)>100000)throw Error('PAPER_CLOSE_INPUT_INVALID');if(!openPaper().some(r=>r.payload.clientIntentId===p.clientIntentId))throw Error('NO_OPEN_PAPER_POSITION');append('PAPER_CLOSE',{clientIntentId:p.clientIntentId,pnlGBP:p.pnlGBP,source:'OPERATOR_SUPPLIED_NOT_BROKER_VERIFIED'});return {paperClosed:true,brokerOrderAllowed:false}}
 function arm(){if(!healthy||stopped()||openPaper().length)throw Error('SHADOW_ARM_BLOCKED');armed=true;append('SHADOW_ARM',{bootId});return {shadowArmed:true,brokerOrderAllowed:false,warning:'PAPER ONLY: IG broker writes remain blocked.'}}
 function stop(){armed=false;append('SHADOW_STOP',{bootId});return {shadowArmed:false,brokerOrderAllowed:false}}
 function emergency(){armed=false;append('EMERGENCY_STOP',{bootId});return {emergencyStop:true,brokerOrderAllowed:false,warning:'Does not close broker positions.'}}
 function routes(app){const handler=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req.body||{}))}catch(e){res.status(409).json({error:String(e.message||e).slice(0,160),brokerOrderAllowed:false})}};
 app.get('/api/v56/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
 app.get('/api/v56/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({journalHealthy:healthy,events:rows.slice(-100).map(x=>({at:x.at,type:x.type,hash:x.hash}))}));
 for(const [name,fn] of [['queue-candidate',queue],['arm-shadow',arm],['stop-shadow',stop],['cycle',cycle],['close-paper',closePaper],['emergency-stop',emergency]])app.post('/api/v56/'+name,requireAdmin,handler(fn));
 app.post('/api/v56/arm-unattended',requireAdmin,(_q,r)=>r.status(409).json({error:'IG_DEMO_EXECUTION_NOT_CERTIFIED_SHADOW_ONLY',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false}));
 app.get('/v56',(_q,r)=>r.sendFile(path.join(__dirname,'public','v56.html')));
 }
 if(enableTimer){timer=setInterval(()=>{if(armed&&queued().length)void cycle().catch(e=>{armed=false;lastError=String(e.message||e);try{append('SHADOW_HALTED',{reason:lastError})}catch{}})},intervalMs);timer.unref?.()}
 return {routes,status,queue,cycle,closePaper,arm,stop,emergency,shutdown:()=>timer&&clearInterval(timer)};
}
module.exports={createV56,assess};
