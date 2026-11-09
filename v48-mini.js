'use strict';
// v48: IG DEMO EUR/USD Mini read-only readiness; never submits an order.
const EPIC='CS.D.EURUSD.MINI.IP';
function positive(x){return x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))&&Number(x)>0}
function assess(market, certifications, options={}){
 const i=market?.instrument||{},r=market?.dealingRules||{};
 const issues=[];
 if(i.epic!==EPIC)issues.push('MINI_EPIC_NOT_VERIFIED');
 if(String(i.contractSize)!=='10000')issues.push('CONTRACT_SIZE_MISMATCH');
 if(String(i.onePipMeans)!=='0.0001 USD/EUR')issues.push('PIP_DEFINITION_MISMATCH');
 if(!positive(i.valueOfOnePip))issues.push('PIP_VALUE_UNAVAILABLE');
 if(!positive(r.minDealSize?.value))issues.push('MIN_DEAL_SIZE_UNAVAILABLE');
 if(!positive(r.minNormalStopOrLimitDistance?.value))issues.push('MIN_STOP_DISTANCE_UNAVAILABLE');
 if(!options.dealSizeIncrementVerified)issues.push('DEAL_SIZE_INCREMENT_NOT_VERIFIED');
 if(!options.stopUnitsVerified)issues.push('STOP_DISTANCE_UNITS_NOT_VERIFIED');
 if(!options.gbpPipValueIndependentlyVerified)issues.push('INDEPENDENT_GBP_PIP_VALUE_MISSING');
 if(!options.brokerLossCrosscheckVerified)issues.push('BROKER_GBP_LOSS_CROSSCHECK_MISSING');
 if(!certifications?.gbpSizing?.certified)issues.push('GBP_SIZING_NOT_CERTIFIED');
 if(!certifications?.brokerLifecycle?.certified)issues.push('BROKER_LIFECYCLE_NOT_CERTIFIED');
 if(!certifications?.crashRecovery?.certified)issues.push('CRASH_RECOVERY_NOT_CERTIFIED');
 // No write-side broker adapter is installed. This is an explicit, non-overridable blocker.
 issues.push('UNATTENDED_BROKER_EXECUTION_ADAPTER_NOT_CERTIFIED');
 const size=0.1,stopPips=12,targetPips=18;
 const pipValueUSD=positive(i.valueOfOnePip)?Number(i.valueOfOnePip)*size:null;
 return {version:'48.0.0',mode:'READ_ONLY_MINI_AUTOMATION_READINESS',epic:EPIC,
  contractSize:i.contractSize??null,onePipMeans:i.onePipMeans??null,minimumDealSize:r.minDealSize??null,
  minimumStopDistance:r.minNormalStopOrLimitDistance??null,
  proposed:{size,stopPips,targetPips,maxRiskGBP:25,maxDailyLossGBP:100,maxTradesPerDay:3},
  indicative:{pipValueUSD,stopLossUSD:pipValueUSD===null?null:Number((pipValueUSD*stopPips).toFixed(2)),
   note:'Illustrative only; not a certified GBP risk, excludes slippage, spreads and costs.'},
  issues,readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false};
}
function createV48({requireAdmin,api,v47Status}){
 let last=null,lastError=null,lastCheckedAt=null;
 async function inspect(){
  const market=await api('/markets/'+encodeURIComponent(EPIC),'GET',null,'3');
  last=assess(market,v47Status().certifications);
  lastCheckedAt=new Date().toISOString();lastError=null;
  return {...last,lastCheckedAt};
 }
 function status(){return last?{...last,lastCheckedAt,lastError}:{...assess(null,v47Status().certifications),lastCheckedAt,lastError};}
 function routes(app){
  app.get('/api/v48/status',requireAdmin,(_q,res)=>res.set('Cache-Control','no-store').json(status()));
  app.post('/api/v48/inspect-mini',requireAdmin,async(_q,res)=>{
   try{res.set('Cache-Control','no-store').json(await inspect())}
   catch(e){lastError=String(e.message||e).slice(0,160);res.status(502).json({error:lastError,brokerOrderAllowed:false})}
  });
  app.post('/api/v48/arm-unattended',requireAdmin,(_q,res)=>res.status(409).json({error:'UNATTENDED_TRADING_NOT_CERTIFIED',issues:status().issues,brokerOrderAllowed:false}));
 }
 return {routes,status,inspect};
}
module.exports={EPIC,assess,createV48};
