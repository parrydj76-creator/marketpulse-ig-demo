'use strict';
// v64: observe actual IG DEMO position lifecycle without transmitting broker orders.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const EPIC='CS.D.EURUSD.MINI.IP';
function createV64({requireAdmin,storageDir,persistentStorage,readPositions,readAccount,legacyBlocked}){
 const file=path.join(storageDir,'v64-broker-observer.jsonl');let events=[],healthy=!!persistentStorage,error=null;
 try{if(healthy){fs.mkdirSync(storageDir,{recursive:true});let prev='GENESIS';if(fs.existsSync(file))for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.prev!==prev||r.hash!==hash({prev:r.prev,type:r.type,payload:r.payload}))throw Error('JOURNAL_INTEGRITY_FAILURE');events.push(r);prev=r.hash;}}}catch(e){healthy=false;error=e.message;}
 function append(type,payload){if(!healthy)throw Error('JOURNAL_UNHEALTHY');const r={prev:events.at(-1)?.hash||'GENESIS',type,payload};r.hash=hash(r);try{fs.appendFileSync(file,JSON.stringify(r)+'\n');events.push(r)}catch(e){healthy=false;error=e.message;throw e}return r}
 const latest=t=>[...events].reverse().find(e=>e.type===t)?.payload||null;
 const halted=()=>[...events].reverse().find(e=>e.type==='HALT'||e.type==='CLEAR')?.type==='HALT';
 function status(){return {version:'64.0.0',mode:'SUPERVISED_BROKER_OBSERVATION',journalHealthy:healthy,lastError:error,emergencyHalt:halted(),legacyExecutionBlocked:legacyBlocked(),lastObservation:latest('OBSERVE'),observations:events.filter(e=>e.type==='OBSERVE').length,brokerOrderAllowed:false,readyForUnattendedDemo:false,certifications:{gbpSizing:false,brokerLifecycle:false,unknownOrderRecovery:false,unattendedAdapter:false}}}
 async function observe(){if(!healthy||!legacyBlocked())throw Error('SAFETY_PREREQUISITES_FAILED');const [account,positions]=await Promise.all([readAccount(),readPositions()]);if(account.currency!=='GBP'||!Array.isArray(positions))throw Error('BROKER_READBACK_INVALID');const relevant=positions.filter(p=>p.market?.epic===EPIC).map(p=>({dealId:p.position?.dealId||null,direction:p.position?.direction||null,size:Number(p.position?.size),stopLevel:p.position?.stopLevel??null,limitLevel:p.position?.limitLevel??null,openLevel:p.position?.openLevel??null,epic:p.market.epic}));const previous=latest('OBSERVE');const previousIds=new Set((previous?.positions||[]).map(x=>x.dealId));const currentIds=new Set(relevant.map(x=>x.dealId));const payload={at:new Date().toISOString(),accountCurrency:account.currency,positions:relevant,openedIds:relevant.filter(x=>!previousIds.has(x.dealId)).map(x=>x.dealId),disappearedIds:(previous?.positions||[]).filter(x=>!currentIds.has(x.dealId)).map(x=>x.dealId),unprotectedPositions:relevant.filter(x=>x.stopLevel===null).map(x=>x.dealId),manualReconciliationRequired:!!previous?.positions?.some(x=>!currentIds.has(x.dealId)),note:'Readback alone cannot certify fill price, realised P/L, attached-stop execution, or safe order recovery. No broker writes.'};append('OBSERVE',payload);return payload}
 function routes(app){const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req.body||{}))}catch(e){res.status(409).json({error:e.message,brokerOrderAllowed:false})}};
 app.get('/api/v64/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
 app.post('/api/v64/observe',requireAdmin,wrap(observe));
 app.post('/api/v64/emergency-halt',requireAdmin,wrap(async p=>{if(p.confirm!=='HALT_V64')throw Error('CONFIRMATION_REQUIRED');append('HALT',{at:new Date().toISOString()});return status()}));
 for(const action of ['submit','execute','close','arm','unattended'])app.post('/api/v64/'+action,requireAdmin,(_q,r)=>r.status(409).json({error:'BROKER_WRITE_ADAPTER_NOT_CERTIFIED',brokerOrderAllowed:false}));
 }
 return {routes,status,observe};
}
module.exports={createV64};
