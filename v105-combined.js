'use strict';
// MarketPulse v101-v105. Read-only, fail-closed. Never creates IG orders.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const policy=Object.freeze({riskGBP:25,dailyLossGBP:100,maxTradesPerDay:3,maxOpenPositions:1,stopPips:12,targetPips:18,maxSpreadPips:2.5,maxQuoteAgeMs:15000,minSignalScore:70});
function quoteGate(q,connected){const issues=[];
 if(connected!==true)issues.push('FEED_NOT_CONNECTED');
 if(!finite(q?.bid)||!finite(q?.ask)||q.bid<=0||q.ask<=q.bid)issues.push('INVALID_BID_ASK');
 if(!finite(q?.spreadPips)||q.spreadPips<0||q.spreadPips>policy.maxSpreadPips)issues.push('SPREAD_UNVERIFIED_OR_EXCESSIVE');
 if(!finite(q?.ageMs)||q.ageMs<0||q.ageMs>policy.maxQuoteAgeMs)issues.push('QUOTE_AGE_UNVERIFIED_OR_STALE');
 // Local quote age cannot establish exchange timestamp or feed delay.
 issues.push('EXCHANGE_TIME_AND_DELAY_NOT_CERTIFIED');
 return {localChecksPassed:issues.length===1,certified:false,issues};}
function riskGate(input={}){const issues=[];
 const fields=['gbpPerPipPerSize','minSize','sizeStep','stopPips','proposedSize'];
 if(!fields.every(k=>finite(input[k])&&input[k]>0))issues.push('MISSING_VERIFIED_CONTRACT_INPUTS');
 if(input.independentlyVerified!==true)issues.push('CONTRACT_EVIDENCE_NOT_CERTIFIED');
 let estimatedRiskGBP=null,aligned=false;
 if(!issues.includes('MISSING_VERIFIED_CONTRACT_INPUTS')){
  const steps=(input.proposedSize-input.minSize)/input.sizeStep;
  aligned=input.proposedSize>=input.minSize&&Math.abs(steps-Math.round(steps))<1e-8;
  if(!aligned)issues.push('SIZE_NOT_ALIGNED');
  estimatedRiskGBP=Math.round(input.gbpPerPipPerSize*input.stopPips*input.proposedSize*100)/100;
  if(estimatedRiskGBP>policy.riskGBP)issues.push('RISK_LIMIT_EXCEEDED');
 }
 // Even operator-verified inputs cannot establish independent certification.
 return {estimatedRiskGBP,aligned,withinBudget:estimatedRiskGBP!==null&&estimatedRiskGBP<=policy.riskGBP,certified:false,issues};}
function accountingGate(data={}){const issues=[];
 if(data.historyComplete!==true)issues.push('HISTORY_INCOMPLETE');
 if(data.chargesReconciled!==true)issues.push('CHARGES_NOT_RECONCILED');
 if(data.accountCurrencyVerified!==true)issues.push('ACCOUNT_CURRENCY_UNVERIFIED');
 if(data.openingBalanceReconciled!==true)issues.push('OPENING_BALANCE_UNRECONCILED');
 if(!finite(data.netDailyPnlGBP))issues.push('BROKER_NET_PNL_UNKNOWN');
 if(finite(data.netDailyPnlGBP)&&data.netDailyPnlGBP<=-policy.dailyLossGBP)issues.push('DAILY_LOSS_LIMIT');
 return {certified:false,netDailyPnlGBP:finite(data.netDailyPnlGBP)?data.netDailyPnlGBP:null,issues};}
function positionGate({brokerPositions,expectedPositions}={}){
 const issues=[];if(!Array.isArray(brokerPositions)||!Array.isArray(expectedPositions))issues.push('POSITIONS_NOT_RECONCILED');
 else {if(brokerPositions.length>policy.maxOpenPositions)issues.push('POSITION_LIMIT');
  const keys=a=>a.map(x=>String(x?.dealId||'')).sort();
  if(keys(brokerPositions).some(x=>!x)||keys(expectedPositions).some(x=>!x))issues.push('POSITION_IDENTIFIERS_MISSING');
  else if(JSON.stringify(keys(brokerPositions))!==JSON.stringify(keys(expectedPositions)))issues.push('BROKER_LOCAL_POSITION_MISMATCH');}
 return {matched:issues.length===0,certified:false,issues};}
function recoveryGate(state){const actions={PREPARED:'NO_SUBMISSION',SUBMITTING:'HALT_RECONCILE',UNKNOWN:'HALT_RECONCILE',CONFIRMED:'VERIFY_POSITION_AND_STOP',REJECTED:'DO_NOT_RETRY_AUTOMATICALLY'};
 return {state:String(state||'UNKNOWN'),action:actions[state]||'HALT_RECONCILE',autoRetry:false,certified:false};}
function faultSuite(){const tests={
 zeroAsk:quoteGate({bid:1.1,ask:0,spreadPips:1,ageMs:100},true).issues.includes('INVALID_BID_ASK'),
 staleQuote:quoteGate({bid:1.1,ask:1.1001,spreadPips:1,ageMs:30000},true).issues.includes('QUOTE_AGE_UNVERIFIED_OR_STALE'),
 disconnected:quoteGate({bid:1.1,ask:1.1001,spreadPips:1,ageMs:100},false).issues.includes('FEED_NOT_CONNECTED'),
 missingContract:!riskGate().withinBudget,
 overRisk:riskGate({gbpPerPipPerSize:10,minSize:0.1,sizeStep:0.1,stopPips:12,proposedSize:1,independentlyVerified:false}).issues.includes('RISK_LIMIT_EXCEEDED'),
 missingAccounting:accountingGate({historyComplete:true}).issues.includes('BROKER_NET_PNL_UNKNOWN'),
 unknownNoRetry:recoveryGate('UNKNOWN').autoRetry===false,
 positionMismatch:positionGate({brokerPositions:[{dealId:'A'}],expectedPositions:[]}).issues.includes('BROKER_LOCAL_POSITION_MISMATCH')};
 return {passed:Object.values(tests).every(Boolean),tests,brokerOrderAllowed:false};}
function createV105({requireAdmin,storageDir,v86,v95,v100}){
 if(typeof requireAdmin!=='function'||!storageDir||!v86||!v95||!v100)throw Error('DEPENDENCY_MISSING');
 const file=path.join(storageDir,'v105-verification.jsonl');let healthy=true,error=null,prev='GENESIS',records=0,last=null,busy=false;
 try{if(fs.existsSync(file)){const content=fs.readFileSync(file,'utf8');if(content&&!content.endsWith('\n'))throw Error('PARTIAL_LEDGER_TAIL');for(const line of content.split('\n').filter(Boolean)){const row=JSON.parse(line);if(row.previous!==prev||row.hash!==hash({previous:row.previous,payload:row.payload}))throw Error('LEDGER_HASH_MISMATCH');prev=row.hash;last=row.payload;records++;}}}catch(e){healthy=false;error=String(e.message).slice(0,90);}
 function gate(){const b=v86.status(),v=v95.status(),w=v100.status();const reasons=[];
  if(!healthy||v.ledgerHealthy!==true||w.v100LedgerHealthy!==true)reasons.push('LEDGER_UNHEALTHY');
  if(b.paperPaused!==true||b.paperSchedulerRunning===true)reasons.push('PAPER_SAFETY_HOLD_NOT_CONFIRMED');
  const blockers=Array.isArray(w.blockers)?w.blockers:[];
  return {version:'105.0.0',releases:['v101_DATA_VALIDATION','v102_RISK_AND_ACCOUNTING_GATES','v103_POSITION_RECONCILIATION','v104_RECOVERY_FAULT_TESTS','v105_EVIDENCE_READINESS'],mode:'READ_ONLY_FAIL_CLOSED',ledgerHealthy:healthy,ledgerError:error,evidenceRecords:records,lastEvidence:last,previousLedgersHealthy:v.ledgerHealthy===true&&w.v100LedgerHealthy===true,paperPaused:b.paperPaused===true,paperSchedulerRunning:b.paperSchedulerRunning===true,blockers:[...new Set([...blockers,...reasons])],brokerOrderAllowed:false,unattendedOrderAllowed:false,readyForUnattendedDemo:false,certified:false,singleWriterCertified:false,brokerLifecycleCertified:false,warning:'No IG dealing routes. Fault simulation and read-only evidence do not certify unattended execution.'};}
 function diagnostics(){const v=v95.status(),c=v.lastEvidence?.checks||{};return {at:new Date().toISOString(),sourceEvidenceAt:v.lastEvidence?.at||null,history:{ok:c.history?.ok===true,complete:c.history?.historyComplete===true,observedTransactions:c.history?.transactionsObserved??null},contract:{minimumDealSize:c.contractRisk?.minimumDealSize??null,unit:c.contractRisk?.minimumDealSizeUnit??null,gbpPerPipCertified:false},positions:{observedCount:c.positions?.count??null,certified:false},risk:riskGate(),accounting:accountingGate({historyComplete:c.history?.historyComplete===true}),recovery:recoveryGate('UNKNOWN'),faultTests:faultSuite(),brokerOrderAllowed:false};}
 function append(payload){if(!healthy)throw Error('LEDGER_UNHEALTHY');const s=gate();if(!s.paperPaused||s.paperSchedulerRunning||!s.previousLedgersHealthy)throw Error('SAFETY_GATE_NOT_SATISFIED');
  fs.mkdirSync(storageDir,{recursive:true});const row={previous:prev,payload,hash:hash({previous:prev,payload})};const fd=fs.openSync(file,'a',0o600);try{fs.writeSync(fd,JSON.stringify(row)+'\n');fs.fsyncSync(fd);}catch(e){healthy=false;error='WRITE_FAILED';throw e;}finally{fs.closeSync(fd);}prev=row.hash;records++;last=payload;return {recorded:true,records,evidenceHash:prev,brokerOrderAllowed:false};}
 function routes(app){app.get('/api/v105/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(gate()));app.get('/api/v105/diagnostics',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(diagnostics()));app.get('/api/v105/fault-tests',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(faultSuite()));app.get('/api/v105/recovery',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({ledgerHealthy:healthy,records,recovery:recoveryGate('UNKNOWN'),distributedSingleWriterCertified:false,brokerOrderAllowed:false}));app.post('/api/v105/evidence/capture',requireAdmin,(_q,r)=>{if(busy)return r.status(409).json({error:'BUSY'});busy=true;try{r.set('Cache-Control','no-store').json(append(diagnostics()));}catch(e){r.status(409).json({error:String(e.message).slice(0,90),brokerOrderAllowed:false});}finally{busy=false;}});app.post('/api/v105/arm',requireAdmin,(_q,r)=>r.status(409).json({error:'BROKER_EXECUTION_HARD_BLOCKED',brokerOrderAllowed:false}));}
 return {status:gate,diagnostics,routes};}
module.exports={createV105,quoteGate,riskGate,accountingGate,positionGate,recoveryGate,faultSuite,policy};
