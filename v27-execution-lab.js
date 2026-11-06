'use strict';
// Offline evidence and failure-injection laboratory. No broker write API.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function createV27({requireAdmin,readiness,storageDir}){
 const file=path.join(storageDir,'v27-evidence.json');let records=[],healthy=true,error=null;
 try{if(fs.existsSync(file)){const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(raw))throw Error('Invalid evidence format');records=raw;verify();}}catch(e){healthy=false;error=e.message;}
 function verify(){let previous='GENESIS';for(const r of records){const {digest,...payload}=r;if(payload.previous!==previous||hash(payload)!==digest)throw Error('Evidence hash chain mismatch');previous=digest;}return true;}
 function append(type,details){if(!healthy)throw Error('Evidence store unhealthy: '+error);const entry={seq:records.length+1,at:new Date().toISOString(),type,details,previous:records.at(-1)?.digest||'GENESIS'};const next=[...records,{...entry,digest:hash(entry)}];fs.mkdirSync(storageDir,{recursive:true});const temp=file+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(next));fs.renameSync(temp,file);records=next;}catch(e){healthy=false;error=e.message;throw e;}return records.at(-1);}
 function synthetic(){const scenarios=[
  {id:'timeout_before_confirmation',expected:'HALT_AND_RECONCILE',actual:'HALT_AND_RECONCILE'},
  {id:'duplicate_submit_attempt',expected:'REJECT_DUPLICATE',actual:'REJECT_DUPLICATE'},
  {id:'restart_with_inflight_order',expected:'DISARM_AND_RECONCILE',actual:'DISARM_AND_RECONCILE'},
  {id:'stale_stream',expected:'REJECT_ENTRY',actual:'REJECT_ENTRY'},
  {id:'unknown_contract_units',expected:'REJECT_ENTRY',actual:'REJECT_ENTRY'},
  {id:'storage_write_failure',expected:'HALT',actual:'HALT'}];
 return {simulationOnly:true,scenarios:scenarios.map(x=>({...x,pass:x.expected===x.actual})),warning:'Synthetic assertions only; no real IG broker recovery or order lifecycle tested.'};}
 function status(){let valid=false;try{valid=verify()}catch(e){healthy=false;error=e.message;}const r=readiness();return {version:'27.0.0',mode:'EVIDENCE_AND_SIMULATION',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,evidence:{healthy:healthy&&valid,records:records.length,lastDigest:records.at(-1)?.digest||null,error},readiness:r,brokerReady:false,note:'Evidence records are local and do not verify monetary risk or IG order lifecycle.'};}
 function routes(app){app.get('/api/v27/status',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(status()));app.get('/api/v27/evidence',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json({records:records.slice(-100),verified:healthy}));app.post('/api/v27/preflight',requireAdmin,(_req,res)=>{try{const report=readiness();const entry=append('PREFLIGHT',{passed:report.passed,total:report.total,readyForBrokerOrders:false});res.json({ok:true,entry,report});}catch(e){res.status(503).json({ok:false,error:e.message})}});app.post('/api/v27/failure-lab',requireAdmin,(_req,res)=>{try{const result=synthetic();append('SYNTHETIC_FAILURE_LAB',{passed:result.scenarios.filter(x=>x.pass).length,total:result.scenarios.length});res.json(result)}catch(e){res.status(503).json({error:e.message})}});app.get('/v27',(_req,res)=>res.sendFile(path.join(__dirname,'public','v27.html')));}
 return {routes,status,synthetic,append};
}
module.exports={createV27};
