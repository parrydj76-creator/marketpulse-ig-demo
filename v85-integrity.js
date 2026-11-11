'use strict';
// Paper-only integrity monitor. No IG dealing callbacks.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function validateTrade(t){
 const issues=[];const finite=(x)=>typeof x==='number'&&Number.isFinite(x);
 for(const k of ['entry','exit','stop','target','units','pnlGBP'])if(!finite(t?.[k]))issues.push('INVALID_'+k.toUpperCase());
 if(!['BUY','SELL'].includes(t?.side))issues.push('INVALID_SIDE');
 if(!finite(t?.entry)||t.entry<0.5||t.entry>2.0||!finite(t?.exit)||t.exit<0.5||t.exit>2.0)issues.push('IMPLAUSIBLE_EURUSD_PRICE');
 if(finite(t?.entry)&&finite(t?.exit)&&Math.abs(t.exit-t.entry)*10000>1000)issues.push('EXCESSIVE_EXIT_GAP');
 if(finite(t?.units)&&t.units<=0)issues.push('INVALID_UNITS');
 if(!['STOP','TARGET'].includes(t?.exitReason))issues.push('INVALID_EXIT_REASON');
 if(finite(t?.entry)&&finite(t?.exit)&&finite(t?.units)&&finite(t?.pnlGBP)&&['BUY','SELL'].includes(t?.side)){
  const expected=Math.round((t.exit-t.entry)*10000*(t.side==='BUY'?1:-1)*t.units*100)/100;
  if(Math.abs(expected-t.pnlGBP)>0.02)issues.push('PNL_MISMATCH');
 }
 if(!Number.isFinite(Date.parse(t?.openedAt))||!Number.isFinite(Date.parse(t?.exitAt)))issues.push('INVALID_TIMESTAMPS');
 if(finite(t?.entry)&&finite(t?.stop)&&finite(t?.target)&&['BUY','SELL'].includes(t?.side)){
  if(t.side==='BUY'&&!(t.stop<t.entry&&t.target>t.entry))issues.push('INVALID_PROTECTION');
  if(t.side==='SELL'&&!(t.stop>t.entry&&t.target<t.entry))issues.push('INVALID_PROTECTION');
 }
 return {valid:issues.length===0,issues};
}
function readLedger(storageDir){
 const file=path.join(storageDir,'v81-paper-journal.jsonl');let prev='GENESIS',records=0,last=null;
 if(!fs.existsSync(file))return {healthy:true,records:0,state:{position:null,closed:[]}};
 const raw=fs.readFileSync(file,'utf8');if(raw&&!raw.endsWith('\n'))throw Error('PARTIAL_JOURNAL_TAIL');
 for(const line of raw.split('\n').filter(Boolean)){
  const e=JSON.parse(line);if(e.prev!==prev||e.hash!==hash({prev:e.prev,kind:e.kind,data:e.data}))throw Error('JOURNAL_HASH_CHAIN_FAILED');
  prev=e.hash;records++;if(e.kind==='STATE')last=e.data;
 }
 return {healthy:true,records,state:last||{position:null,closed:[]}};
}
function audit(storageDir){
 try{
  const ledger=readLedger(storageDir),trades=ledger.state.closed||[];const accepted=[],quarantined=[];
  for(const t of trades){const result=validateTrade(t);(result.valid?accepted:quarantined).push({id:t.id||null,pnlGBP:t.pnlGBP,issues:result.issues});}
  const validPnlGBP=Math.round(accepted.reduce((s,t)=>s+t.pnlGBP,0)*100)/100;
  return {version:'85.0.0',mode:'PAPER_INTEGRITY_ONLY',journalHealthy:true,journalRecords:ledger.records,closedTrades:trades.length,validTrades:accepted.length,quarantinedTrades:quarantined.length,quarantined,validSimulatedPnlGBP:validPnlGBP,assumptionCertified:false,brokerOrderAllowed:false,unattendedOrderAllowed:false,warning:'Historical invalid trades remain in the immutable journal; figures are paper-only, exclude costs/slippage and use an uncertified GBP pip assumption.'};
 }catch(e){return {version:'85.0.0',journalHealthy:false,error:String(e.message).slice(0,100),brokerOrderAllowed:false,unattendedOrderAllowed:false};}
}
function controlPath(storageDir){return path.join(storageDir,'v85-paper-control.json')}
function control(storageDir){try{const c=JSON.parse(fs.readFileSync(controlPath(storageDir),'utf8'));return {paused:c.paused!==false,changedAt:c.changedAt||null,reason:c.reason||null}}catch(_){return {paused:true,changedAt:null,reason:'DEFAULT_FAIL_CLOSED'}}}
function setControl(storageDir,paused,reason){fs.mkdirSync(storageDir,{recursive:true});const dest=controlPath(storageDir),tmp=dest+'.'+process.pid+'.tmp';const obj={paused,changedAt:new Date().toISOString(),reason};const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeSync(fd,JSON.stringify(obj)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,dest);return control(storageDir)}
function createV85({requireAdmin,storageDir,persistentStorage,v81,v68}){
 function status(){const integrity=audit(storageDir),ctl=control(storageDir),sim=v81.status();return {...integrity,control:ctl,simulatorScheduled:sim.scheduled,simulatorPositionOpen:!!sim.position,simulatorLastTickAt:sim.lastTickAt,feedConnected:v68.status()?.streamState==='CONNECTED',brokerOrderAllowed:false,unattendedOrderAllowed:false}}
 function routes(app){
  app.get('/api/v85/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.post('/api/v85/audit',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.post('/api/v85/pause',requireAdmin,(q,r)=>{try{r.set('Cache-Control','no-store').json({...setControl(storageDir,true,'ADMIN_SAFETY_HOLD'),brokerOrderAllowed:false})}catch(e){r.status(503).json({error:'PAUSE_PERSISTENCE_FAILED',detail:String(e.message).slice(0,100)})}});
  app.post('/api/v85/resume',requireAdmin,(q,r)=>{
   if(q.body?.confirm!=='RESUME_PAPER_ONLY')return r.status(409).json({error:'CONFIRM_RESUME_PAPER_ONLY_REQUIRED',brokerOrderAllowed:false});
   const a=audit(storageDir),s=v68.status(),z=s?.quote||{};
   if(!persistentStorage||!a.journalHealthy||!v81.status().journalHealthy||s?.streamState!=='CONNECTED'||!(Number.isFinite(z.bid)&&z.bid>0.5&&z.bid<2&&Number.isFinite(z.ask)&&z.ask>z.bid&&z.ask<2&&Number.isFinite(z.ageMs)&&z.ageMs>=0&&z.ageMs<=15000&&Number.isFinite(z.spreadPips)&&z.spreadPips>=0&&z.spreadPips<=2.5))return r.status(409).json({error:'PAPER_RESUME_SAFETY_CHECK_FAILED',brokerOrderAllowed:false});
   try{r.set('Cache-Control','no-store').json({...setControl(storageDir,false,'ADMIN_PAPER_ONLY_RESUME'),brokerOrderAllowed:false})}catch(e){r.status(503).json({error:'RESUME_PERSISTENCE_FAILED',detail:String(e.message).slice(0,100)})}
  });
  app.post('/api/v85/arm',requireAdmin,(_q,r)=>r.status(409).json({error:'BROKER_ORDERS_HARD_BLOCKED',brokerOrderAllowed:false}));
 }
 return {routes,status};
}
module.exports={validateTrade,readLedger,audit,control,setControl,createV85};
