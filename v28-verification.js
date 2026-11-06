'use strict';
// Read-only broker evidence collection and deterministic verification. NEVER sends broker orders.
const crypto=require('crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function finitePositive(x){return typeof x==='number'&&Number.isFinite(x)&&x>0;}
function riskPreview({size,stopPips,pipValueQuote,quoteToGBP,feesGBP=0,slippagePips=0,budgetGBP,step,minSize}){
 const errors=[];
 for(const [k,v] of Object.entries({size,stopPips,pipValueQuote,quoteToGBP,budgetGBP,step,minSize}))if(!finitePositive(v))errors.push(k+' must be a positive finite number');
 if(!Number.isFinite(feesGBP)||feesGBP<0||!Number.isFinite(slippagePips)||slippagePips<0)errors.push('fees/slippage invalid');
 if(errors.length)return {pass:false,errors,brokerVerified:false};
 const increments=Math.round(size/step),aligned=Math.abs(increments*step-size)<1e-9;
 if(size<minSize||!aligned)errors.push('Size violates supplied minimum/increment');
 const riskGBP=size*pipValueQuote*quoteToGBP*(stopPips+slippagePips)+feesGBP;
 if(riskGBP>budgetGBP+1e-9)errors.push('Risk exceeds budget');
 return {pass:errors.length===0,errors,riskGBP,brokerVerified:false,note:'Mathematical check only: all inputs require independent broker/account verification.'};
}
function classifyRecovery({journal,positions,confirmations=[]}){
 if(!Array.isArray(positions))return {status:'BLOCKED',reason:'Broker positions unavailable'};
 if(!journal)return {status:positions.length?'MANUAL_REVIEW':'NO_INFLIGHT_JOURNAL',reason:positions.length?'Untracked broker positions exist':'No pending journal supplied'};
 if(!['OPEN','CLOSE'].includes(journal.kind)||!journal.createdAt)return {status:'BLOCKED',reason:'Invalid journal'};
 const matching=positions.filter(p=>p.dealId&&p.dealId===journal.dealId);
 const refs=confirmations.filter(c=>c.dealReference&&c.dealReference===journal.dealReference);
 if(matching.length>1||refs.length>1)return {status:'MANUAL_REVIEW',reason:'Conflicting broker evidence'};
 return {status:'MANUAL_REVIEW',reason:'In-flight broker action must be reconciled using IG confirms, positions and activity; never retry automatically',matchingPositions:matching.length,matchingConfirmations:refs.length};
}
function createV28({requireAdmin,api,readLocal,appendEvidence}){
 let latest=null;
 async function collect(){
  const [market,accounts,positions]=await Promise.all([
   api('/markets/CS.D.EURUSD.CFD.IP','GET',null,'3'),api('/accounts'),api('/positions','GET',null,'2')]);
  const instrument=market.instrument||{},rules=market.dealingRules||{};
  const accountList=(accounts.accounts||[]).map(a=>({accountType:a.accountType,currency:a.currency}));
  const positionList=(positions.positions||[]).map(p=>({dealId:p.position?.dealId,epic:p.market?.epic,direction:p.position?.direction,size:p.position?.size}));
  const local=readLocal();
  const evidence={at:new Date().toISOString(),epic:'CS.D.EURUSD.CFD.IP',marketStatus:market.snapshot?.marketStatus||null,contractSize:instrument.contractSize??null,lotSize:instrument.lotSize??null,unit:instrument.unit??null,valueOfOnePip:instrument.valueOfOnePip??null,onePipMeans:instrument.onePipMeans??null,minDealSize:rules.minDealSize??null,minStopDistance:rules.minNormalStopOrLimitDistance??null,accounts:accountList,positions:positionList,recovery:classifyRecovery({journal:local.pendingOrder,positions:positionList}),local:{tracked:!!local.tracked,persistenceHealthy:local.persistenceHealthy,brokerReconciled:local.brokerReconciled}};
  latest={...evidence,digest:sha(evidence)};
  appendEvidence('V28_READ_ONLY_BROKER_EVIDENCE',{digest:latest.digest,recovery:latest.recovery.status,positionCount:positionList.length});
  return latest;
 }
 function status(){return {version:'28.0.0',brokerOrderAllowed:false,brokerExecution:'HARD_BLOCKED',independentVerificationComplete:false,checks:{monetarySizing:false,brokerOrderLifecycle:false,positionReconciliation:false,inFlightRecovery:false},latest,warning:'Read-only IG snapshots cannot independently verify GBP pip valuation or order lifecycle. No broker writes occur.'};}
 function routes(app){
  app.get('/api/v28/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.post('/api/v28/collect',requireAdmin,async(_q,r)=>{try{r.set('Cache-Control','no-store').json({ok:true,evidence:await collect(),status:status()})}catch(e){r.status(502).json({ok:false,error:'Read-only evidence collection failed',detail:String(e.message).slice(0,180)})}});
  app.post('/api/v28/risk-preview',requireAdmin,(q,r)=>r.set('Cache-Control','no-store').json(riskPreview(q.body||{})));
  app.post('/api/v28/recovery-preview',requireAdmin,(q,r)=>r.set('Cache-Control','no-store').json({simulationOnly:true,...classifyRecovery(q.body||{})}));
 }
 return {routes,status,collect};
}
module.exports={createV28,riskPreview,classifyRecovery};
