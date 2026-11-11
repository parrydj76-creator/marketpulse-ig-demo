'use strict';
// v88: offline, read-only broker evidence analysis. NO IG HTTP clients, dealing, or automatic certification.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const numeric=x=>typeof x==='number'&&Number.isFinite(x);
const round=x=>Math.round(x*100)/100;
const id=x=>typeof x==='string'&&x.length>0&&x.length<=100&&/^[A-Za-z0-9._:-]+$/.test(x);
const iso=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(x)&&Number.isFinite(Date.parse(x));
const unique=xs=>new Set(xs).size===xs.length;
function evaluateRisk(input){
 const issues=[];
 if(!input||typeof input!=='object'||Array.isArray(input))return {passed:false,issues:['INVALID_INPUT'],brokerOrderAllowed:false};
 const {epic,side,entry,stop,dealSize,gbpPerPipPerDealSizeUnit,minimumDealSize,dealSizeIncrement,expectedFeesGBP=0,conversionAsOf}=input;
 if(epic!==EPIC)issues.push('EPIC_MISMATCH');
 if(!['BUY','SELL'].includes(side))issues.push('INVALID_SIDE');
 if(!numeric(entry)||entry<=0||!numeric(stop)||stop<=0)issues.push('INVALID_PRICES');
 if(numeric(entry)&&numeric(stop)&&((side==='BUY'&&stop>=entry)||(side==='SELL'&&stop<=entry)))issues.push('STOP_WRONG_SIDE');
 if(!numeric(dealSize)||dealSize<=0)issues.push('INVALID_DEAL_SIZE');
 if(!numeric(gbpPerPipPerDealSizeUnit)||gbpPerPipPerDealSizeUnit<=0)issues.push('PIP_VALUE_UNVERIFIED');
 if(!numeric(minimumDealSize)||minimumDealSize<=0||!numeric(dealSizeIncrement)||dealSizeIncrement<=0)issues.push('SIZE_RULES_UNVERIFIED');
 if(!numeric(expectedFeesGBP)||expectedFeesGBP<0)issues.push('INVALID_FEES');
 if(!iso(conversionAsOf))issues.push('CONVERSION_TIMESTAMP_MISSING');
 if(!issues.length){
  if(dealSize+1e-9<minimumDealSize)issues.push('BELOW_MINIMUM_DEAL_SIZE');
  const steps=(dealSize-minimumDealSize)/dealSizeIncrement;
  if(Math.abs(steps-Math.round(steps))>1e-6)issues.push('INVALID_SIZE_INCREMENT');
  const stopPips=Math.abs(entry-stop)*10000;
  const estimatedLossGBP=round(stopPips*dealSize*gbpPerPipPerDealSizeUnit+expectedFeesGBP);
  if(stopPips<11.999||stopPips>12.001)issues.push('STOP_DISTANCE_NOT_12_PIPS');
  if(estimatedLossGBP>25)issues.push('TRADE_RISK_EXCEEDS_25_GBP');
  return {passed:issues.length===0,issues,stopPips:round(stopPips),estimatedLossGBP,contractCertified:false,source:'OPERATOR_SUPPLIED_UNVERIFIED',brokerOrderAllowed:false};
 }
 return {passed:false,issues,contractCertified:false,brokerOrderAllowed:false};
}
function evaluateReconciliation(input){
 const issues=[];
 if(!input||typeof input!=='object'||Array.isArray(input))return {passed:false,issues:['INVALID_INPUT'],brokerOrderAllowed:false};
 const {asOf,epic,brokerPositions,localPositions,transactions,openingBalanceGBP,closingBalanceGBP,netTransfersGBP=0,unrealisedPnlGBP=0}=input;
 if(!iso(asOf))issues.push('INVALID_AS_OF');
 if(epic!==EPIC)issues.push('EPIC_MISMATCH');
 if(!Array.isArray(brokerPositions)||brokerPositions.length>100||!Array.isArray(localPositions)||localPositions.length>100)issues.push('INVALID_POSITIONS');
 if(!Array.isArray(transactions)||transactions.length>2000)issues.push('INVALID_TRANSACTIONS');
 if(!numeric(openingBalanceGBP)||!numeric(closingBalanceGBP)||!numeric(netTransfersGBP)||!numeric(unrealisedPnlGBP))issues.push('INVALID_BALANCES');
 if(issues.length)return {passed:false,issues,brokerOrderAllowed:false};
 const positionOk=p=>p&&id(p.dealId)&&p.epic===EPIC&&['BUY','SELL'].includes(p.side)&&numeric(p.size)&&p.size>0;
 if(!brokerPositions.every(positionOk)||!localPositions.every(positionOk))issues.push('INVALID_POSITION_RECORD');
 const txOk=t=>t&&id(t.id)&&iso(t.at)&&numeric(t.realisedPnlGBP)&&numeric(t.feesGBP)&&t.feesGBP>=0&&numeric(t.financingGBP)&&numeric(t.otherChargesGBP)&&t.otherChargesGBP>=0;
 if(!transactions.every(txOk))issues.push('INVALID_TRANSACTION_RECORD');
 if(!unique(brokerPositions.map(x=>x.dealId))||!unique(localPositions.map(x=>x.dealId)))issues.push('DUPLICATE_POSITION_ID');
 if(!unique(transactions.map(x=>x.id)))issues.push('DUPLICATE_TRANSACTION_ID');
 if(issues.length)return {passed:false,issues,brokerOrderAllowed:false};
 const broker=new Map(brokerPositions.map(x=>[x.dealId,x]));
 const local=new Map(localPositions.map(x=>[x.dealId,x]));
 const unexpectedBrokerPositions=[],missingBrokerPositions=[],mismatchedPositions=[];
 for(const [dealId,p] of broker){const l=local.get(dealId);if(!l)unexpectedBrokerPositions.push(dealId);else if(l.side!==p.side||Math.abs(l.size-p.size)>1e-8)mismatchedPositions.push(dealId)}
 for(const dealId of local.keys())if(!broker.has(dealId))missingBrokerPositions.push(dealId);
 if(unexpectedBrokerPositions.length)issues.push('UNEXPECTED_BROKER_EXPOSURE');
 if(missingBrokerPositions.length)issues.push('LOCAL_POSITION_MISSING_AT_BROKER');
 if(mismatchedPositions.length)issues.push('POSITION_MISMATCH');
 const netRealisedGBP=round(transactions.reduce((s,t)=>s+t.realisedPnlGBP-t.feesGBP-t.financingGBP-t.otherChargesGBP,0));
 const observedBalanceDeltaGBP=round(closingBalanceGBP-openingBalanceGBP-netTransfersGBP);
 const accountingDifferenceGBP=round(observedBalanceDeltaGBP-netRealisedGBP);
 if(Math.abs(accountingDifferenceGBP)>0.01)issues.push('BROKER_BALANCE_NOT_RECONCILED');
 if(netRealisedGBP<=-100)issues.push('DAILY_LOSS_LIMIT_REACHED');
 // This comparison is diagnostic: no guarantee the supplied transactions span a complete UK trading day.
 return {passed:issues.length===0,issues,netRealisedGBP,unrealisedPnlGBP,observedBalanceDeltaGBP,accountingDifferenceGBP,unexpectedBrokerPositions,missingBrokerPositions,mismatchedPositions,brokerDataCertified:false,source:'OPERATOR_SUPPLIED_UNVERIFIED',brokerOrderAllowed:false};
}
function createV88({requireAdmin,storageDir,v86,v87}){
 const file=path.join(storageDir,'v88-audit-ledger.jsonl');let healthy=true,issue=null,previous='GENESIS',count=0,last=null;
 try{if(fs.existsSync(file)){const raw=fs.readFileSync(file,'utf8');if(raw&&!raw.endsWith('\n'))throw Error('PARTIAL_LEDGER_TAIL');for(const line of raw.split('\n').filter(Boolean)){const e=JSON.parse(line);if(e.previous!==previous||e.hash!==sha({previous:e.previous,payload:e.payload}))throw Error('AUDIT_CHAIN_MISMATCH');previous=e.hash;count++;last=e.payload;}}}catch(e){healthy=false;issue=String(e.message).slice(0,120)}
 function status(){const readiness=v86.status();const verification=v87.status();return {version:'88.0.0',mode:'READ_ONLY_BROKER_AUDIT',ledgerHealthy:healthy,ledgerError:issue,evidenceRecords:count,lastAudit:last,readinessBlockers:readiness.blockers||[],v87EvidenceHealthy:verification.evidenceLedgerHealthy===true,paperPaused:verification.paperPaused===true,brokerOrderAllowed:false,unattendedOrderAllowed:false,readyForUnattendedDemo:false,certified:false,warning:'Operator-supplied data is not independently certified. No broker dealing or automatic approval.'}}
 function record(type,result){if(!healthy)throw Error('AUDIT_LEDGER_UNHEALTHY');const payload={at:new Date().toISOString(),type,result};const entry={previous,payload,hash:sha({previous,payload})};fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(file,'a',0o600);try{fs.writeSync(fd,JSON.stringify(entry)+'\n');fs.fsyncSync(fd)}catch(e){healthy=false;issue='AUDIT_WRITE_FAILED';throw e}finally{fs.closeSync(fd)}previous=entry.hash;count++;last=payload;return {recorded:true,evidenceRecords:count,evidenceHash:entry.hash,...result,brokerOrderAllowed:false}}
 function routes(app){
  app.get('/api/v88/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  // No raw account statements or credentials are stored: only computed, redacted diagnostics.
  for(const [url,type,fn] of [['/api/v88/audit/risk','RISK',evaluateRisk],['/api/v88/audit/reconciliation','RECONCILIATION',evaluateReconciliation]]){
   app.post(url,requireAdmin,(req,res)=>{res.set('Cache-Control','no-store');if(!req.is('application/json'))return res.status(415).json({error:'JSON_REQUIRED',brokerOrderAllowed:false});if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))return res.status(400).json({error:'INVALID_BODY',brokerOrderAllowed:false});try{const result=fn(req.body);return res.status(result.issues?.some(x=>x.startsWith('INVALID_'))?422:200).json(record(type,result))}catch(_e){return res.status(503).json({error:'AUDIT_UNAVAILABLE',brokerOrderAllowed:false})}});
  }
  app.post('/api/v88/arm',requireAdmin,(_q,r)=>r.status(409).json({error:'BROKER_ORDER_HARD_BLOCKED',brokerOrderAllowed:false}));
 }
 return {status,routes};
}
module.exports={createV88,evaluateRisk,evaluateReconciliation};
