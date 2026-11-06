'use strict';
// v20 is a fail-closed broker execution readiness engine. No broker write API calls.
const path=require('node:path');
const EPIC='CS.D.EURUSD.CFD.IP';
const num=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
function assess({market,positions,accounts,signal,verified={}}){
 const i=market?.instrument||{},r=market?.dealingRules||{},s=market?.snapshot||{};
 const checks={marketTradeable:s.marketStatus==='TRADEABLE',positionsReadable:Array.isArray(positions?.positions),accountsReadable:Array.isArray(accounts?.accounts),contractMetadataPresent:!!i.contractSize&&!!i.onePipMeans&&!!i.valueOfOnePip,dealRulesPresent:!!r.minDealSize&&!!r.minNormalStopOrLimitDistance,liveQuoteFresh:signal?.quoteSource==='STREAM'&&num(signal.quoteAgeMs)!==null&&signal.quoteAgeMs<=15000,signalQualifies:num(signal?.score)!==null&&signal.score>=70&&['LONG','SHORT'].includes(signal.direction),gbpPerPipIndependentlyVerified:verified.gbpPerPip===true,brokerDealSizeIndependentlyVerified:verified.dealSize===true,orderLifecycleVerified:verified.orderLifecycle===true,crashRecoveryVerified:verified.crashRecovery===true};
 return {epic:EPIC,checks,allGatesPass:Object.values(checks).every(Boolean),brokerOrderAllowed:false,brokerExecution:'HARD_BLOCKED',positionCount:checks.positionsReadable?positions.positions.length:null,market:{status:s.marketStatus||null,contractSize:i.contractSize??null,onePipMeans:i.onePipMeans??null,valueOfOnePip:i.valueOfOnePip??null,minimumDealSize:r.minDealSize??null,minimumStop:r.minNormalStopOrLimitDistance??null},note:'Broker execution remains blocked even if all metadata checks pass. IG POINTS are not assumed to be pips. No broker orders submitted.'};
}
function calculate({equityGBP,stopPips,gbpPerPipPerDeal,dealSize,minimumDealSize,dealIncrement,existingDailyLossGBP=0,newTradesToday=0,openPlannedRiskGBP=0}){
 const values=[equityGBP,stopPips,gbpPerPipPerDeal,dealSize,minimumDealSize,dealIncrement,existingDailyLossGBP,newTradesToday,openPlannedRiskGBP].map(Number);
 const [equity,stop,pip,deal,min,step,daily,entries,open]=values;
 const errors=[];
 if(values.some(v=>!Number.isFinite(v)))errors.push('All inputs must be finite numbers');
 if(!(equity>0&&stop>0&&pip>0&&deal>0&&min>0&&step>0))errors.push('Equity, stop, pip value, size, minimum and increment must be positive');
 if(daily<0||entries<0||open<0)errors.push('Loss, trade count and open risk cannot be negative');
 const planned=stop*pip*deal,budget=equity*.0025,dayLimit=equity*.01;
 if(deal<min)errors.push('Below broker minimum');
 if(step>0&&Math.abs(deal/step-Math.round(deal/step))>1e-7)errors.push('Invalid broker size increment');
 if(planned>budget+1e-8)errors.push('Exceeds 0.25% planned risk');
 if(daily+open+planned>dayLimit+1e-8)errors.push('Exceeds 1% combined daily risk budget');
 if(entries>=2)errors.push('Two-new-trades daily cap reached');
 return {plannedRiskGBP:Number.isFinite(planned)?planned:null,tradeBudgetGBP:Number.isFinite(budget)?budget:null,dailyBudgetGBP:Number.isFinite(dayLimit)?dayLimit:null,arithmeticPass:errors.length===0,issues:errors,brokerExecutable:false,brokerOrderAllowed:false,assumptions:'User-entered GBP/pip and broker size increments are NOT independently verified. This is an illustrative calculator, not an IG order authorization.'};
}
function createV20({requireAdmin,api,signalSnapshot}){
 function routes(app){
  app.get('/v20',(_q,r)=>r.sendFile(path.join(__dirname,'public','v20.html')));
  app.get('/api/v20/readiness',requireAdmin,async(_q,r)=>{try{
   const [market,positions,accounts]=await Promise.all([api('/markets/'+encodeURIComponent(EPIC),'GET',null,'3'),api('/positions','GET',null,'2'),api('/accounts')]);
   r.set('Cache-Control','no-store');r.json(assess({market,positions,accounts,signal:signalSnapshot()}));
  }catch(e){r.status(503).json({brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,error:'Broker readiness unavailable',detail:e.message})}});
  app.post('/api/v20/risk-check',requireAdmin,(q,r)=>{r.set('Cache-Control','no-store');r.json(calculate(q.body||{}))});
 }
 return {routes};
}
module.exports={assess,calculate,createV20};
