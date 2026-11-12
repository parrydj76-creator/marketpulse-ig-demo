'use strict';
// v97-v100: diagnostics only. No dealing functions, credentials or automatic approvals.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const num=x=>typeof x==='number'&&Number.isFinite(x);
function accounting(transactions){
 if(!Array.isArray(transactions))return {valid:false,reason:'TRANSACTIONS_NOT_ARRAY',certified:false};
 const types={};let invalid=0,amounts=[];
 for(const t of transactions){const type=String(t?.transactionType||t?.type||'UNKNOWN').slice(0,40);types[type]=(types[type]||0)+1;
  const v=t?.profitAndLoss;if(num(v))amounts.push(v);else invalid++;
 }
 return {valid:invalid===0,transactionCount:transactions.length,types,numberOfNumericPnL:amounts.length,invalidPnL:invalid,
  observedNumericPnlTotal:invalid===0?Math.round(amounts.reduce((a,b)=>a+b,0)*100)/100:null,
  chargesIncluded:false,accountCurrencyVerified:false,openingBalanceReconciled:false,certified:false,
  warning:'Transaction P&L is not daily net P&L: charges, currency, types, timestamps and opening balance unverified'};
}
function risk({gbpPerPip,stopPips=12,targetRiskGBP=25,minSize,sizeStep,proposedSize}={}){
 const valid=[gbpPerPip,stopPips,targetRiskGBP,minSize,sizeStep,proposedSize].every(x=>num(x)&&x>0);
 if(!valid)return {valid:false,certified:false,reason:'VERIFIED_CONTRACT_VALUES_MISSING'};
 const steps=Math.round((proposedSize-minSize)/sizeStep),aligned=proposedSize>=minSize&&Math.abs(minSize+steps*sizeStep-proposedSize)<1e-8;
 const exposure=gbpPerPip*stopPips*proposedSize;
 return {valid:aligned,estimatedRiskGBP:Math.round(exposure*100)/100,withinBudget:aligned&&exposure<=targetRiskGBP,
  certified:false,reason:'INPUT_VALUES_NOT_INDEPENDENTLY_CERTIFIED'};
}
function reconcile(observed,expected=[]){
 if(!Array.isArray(observed)||!Array.isArray(expected))return {valid:false,certified:false};
 const unexpected=observed.length>0&&expected.length===0;
 return {valid:true,brokerPositions:observed.length,expectedPositions:expected.length,unexpectedExposure:unexpected,
  mismatch:observed.length!==expected.length,certified:false};
}
function recoverySimulation(){
 const states=['PREPARED','SUBMITTING','UNKNOWN','CONFIRMED','REJECTED'];
 return {states,unknownSubmissionAction:'HALT_AND_RECONCILE_WITH_BROKER',resubmitUnknown:false,
  localLockDistributed:false,brokerLifecycleTested:false,certified:false};
}
function createV100({requireAdmin,storageDir,v86,v95,v91}){
 const file=path.join(storageDir,'v100-diagnostics.jsonl');let previous='GENESIS',count=0,last=null,healthy=true,ledgerError=null;
 try{if(fs.existsSync(file)){const data=fs.readFileSync(file,'utf8');if(data&&!data.endsWith('\n'))throw Error('PARTIAL_TAIL');for(const line of data.split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.previous!==previous||r.hash!==sha({previous:r.previous,payload:r.payload}))throw Error('HASH_MISMATCH');previous=r.hash;last=r.payload;count++;}}}catch(e){healthy=false;ledgerError=String(e.message).slice(0,80)}
 function status(){const v=v95.status(),base=v86.status(),h=v.lastEvidence?.checks?.history||null;
  return {version:'100.0.0',releases:['v97_CAPTURE_REPORTING','v98_ACCOUNTING_DIAGNOSTICS','v99_RISK_AND_POSITION_CHECKS','v100_RECOVERY_SIMULATION'],
   mode:'READ_ONLY_IG_DEMO_VERIFICATION',lastHistoryCapture:h?{ok:h.ok,historyComplete:h.historyComplete,transactionsObserved:h.transactionsObserved,pagesFetched:h.pagesFetched,error:h.error}:null,
   v95LedgerHealthy:v.ledgerHealthy,v91LedgerHealthy:v91.status().ledgerHealthy,v100LedgerHealthy:healthy,v100LedgerError:ledgerError,
   v100Records:count,lastDiagnostic:last,paperPaused:base.paperPaused===true,paperSchedulerRunning:base.paperSchedulerRunning===true,
   brokerOrderAllowed:false,unattendedOrderAllowed:false,readyForUnattendedDemo:false,certified:false,
   blockers:base.blockers||[],riskCertified:false,brokerNetDailyPnlCertified:false,unknownSubmitRecoveryCertified:false,singleWriterCertified:false,
   warning:'No IG dealing calls or auto-approval. Operator inputs and read-only observations are not certification.'};}
 function record(payload){if(!healthy)throw Error('LEDGER_UNHEALTHY');if(v86.status().paperPaused!==true)throw Error('PAPER_NOT_PAUSED');
  fs.mkdirSync(storageDir,{recursive:true});const row={previous,payload,hash:sha({previous,payload})};const fd=fs.openSync(file,'a',0o600);
  try{fs.writeSync(fd,JSON.stringify(row)+'\n');fs.fsyncSync(fd);}catch(e){healthy=false;ledgerError='WRITE_FAILED';throw e}finally{fs.closeSync(fd)}
  previous=row.hash;last=payload;count++;return {recorded:true,records:count,evidenceHash:row.hash,brokerOrderAllowed:false};}
 function diagnostics(){const v=v95.status(),checks=v.lastEvidence?.checks||{};
  return {at:new Date().toISOString(),history:checks.history?{ok:checks.history.ok,complete:checks.history.historyComplete,pagesFetched:checks.history.pagesFetched,transactionsObserved:checks.history.transactionsObserved,netDailyPnlCertified:false}:null,
   contractRisk:checks.contractRisk||null,positions:checks.positions||null,
   accounting:accounting([]),risk:risk(),positionReconciliation:reconcile(Array(checks.positions?.count||0).fill({})),recovery:recoverySimulation(),
   brokerOrderAllowed:false,certified:false};}
 function routes(app){
  app.get('/api/v100/status',requireAdmin,(_q,res)=>res.set('Cache-Control','no-store').json(status()));
  app.get('/api/v100/diagnostics',requireAdmin,(_q,res)=>res.set('Cache-Control','no-store').json(diagnostics()));
  app.post('/api/v100/evidence/capture',requireAdmin,(_q,res)=>{try{res.set('Cache-Control','no-store').json(record(diagnostics()))}catch(e){res.status(409).json({error:String(e.message),brokerOrderAllowed:false})}});
  app.get('/api/v100/recovery',requireAdmin,(_q,res)=>res.set('Cache-Control','no-store').json({ledgerHealthy:healthy,records:count,recovery:recoverySimulation(),brokerOrderAllowed:false}));
  app.post('/api/v100/arm',requireAdmin,(_q,res)=>res.status(409).json({error:'BROKER_EXECUTION_HARD_BLOCKED',brokerOrderAllowed:false}));
 }
 return {status,diagnostics,routes};
}
module.exports={createV100,accounting,risk,reconcile,recoverySimulation};
