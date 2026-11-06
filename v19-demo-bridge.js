'use strict';
// v19 broker automation bridge: authenticated read-only inspection and fail-closed sizing preview.
// No POST/PUT/DELETE broker operations. Never changes execution flags.
const path=require('node:path');
const EPIC='CS.D.EURUSD.CFD.IP';
const finitePositive=x=>Number.isFinite(Number(x))&&Number(x)>0;
function inspectMarket(data){const i=data?.instrument||{},r=data?.dealingRules||{},s=data?.snapshot||{};return {epic:i.epic||EPIC,marketStatus:s.marketStatus||'UNKNOWN',contractSize:i.contractSize??null,lotSize:i.lotSize??null,onePipMeans:i.onePipMeans??null,valueOfOnePip:i.valueOfOnePip??null,currencies:i.currencies??[],minDealSize:r.minDealSize??null,minNormalStopOrLimitDistance:r.minNormalStopOrLimitDistance??null,marginDepositBands:i.marginDepositBands??[],snapshotTime:s.updateTime??null}}
function calculatePreview({equityGBP,stopPips,gbpPerPipPerDeal,dealSize,minDealSize,dealStep,conversionVerified=false,contractVerified=false,brokerUnitsVerified=false}){
 const errors=[];
 for(const [name,val] of Object.entries({equityGBP,stopPips,gbpPerPipPerDeal,dealSize}))if(!finitePositive(val))errors.push(name+' must be positive');
 if(!errors.length){if(finitePositive(minDealSize)&&Number(dealSize)<Number(minDealSize))errors.push('Below broker minimum deal size');if(finitePositive(dealStep)){const steps=Number(dealSize)/Number(dealStep);if(Math.abs(steps-Math.round(steps))>1e-7)errors.push('Deal size is not a multiple of the supplied step')}}
 const budget=finitePositive(equityGBP)?Number(equityGBP)*.0025:null;
 const loss=errors.length?null:Number(stopPips)*Number(gbpPerPipPerDeal)*Number(dealSize);
 if(loss!==null&&loss>budget+1e-9)errors.push('Planned stop loss exceeds 0.25% budget');
 const verified=conversionVerified===true&&contractVerified===true&&brokerUnitsVerified===true;
 return {budgetGBP:budget,plannedStopLossGBP:loss,plannedRiskPct:loss!==null?100*loss/Number(equityGBP):null,passesArithmetic:errors.length===0,errors,inputsIndependentlyVerified:verified,brokerExecutable:false,brokerOrderAllowed:false,note:'Illustrative preview only. User-supplied values do not verify IG contract units, pip valuation, FX conversion, slippage, margin, stop placement or execution.'};
}
function createV19({requireAdmin,api,v17Lab,signalSnapshot}){
 function routes(app){
  app.get('/v19',(_q,r)=>r.sendFile(path.join(__dirname,'public','v19.html')));
  app.get('/api/v19/status',requireAdmin,async(_q,r)=>{try{const v17=await v17Lab.status();r.set('Cache-Control','no-store');r.json({ready:true,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,mode:'READ_ONLY',automaticSignalRehearsals:v17.automaticSignalRehearsals,halted:v17.halted,signal:signalSnapshot(),verification:v17.verification||{},riskLimits:{plannedPerTradePct:.25,dailyRealisedLossPct:1,maxNewTradesPerDay:2},outstanding:['Broker-specific GBP/pip independently verified','Executable deal size and IG dealing units verified','Broker order acknowledgement and unknown outcome recovery tested','In-flight crash recovery tested'],note:'No broker orders can be placed by v19.'})}catch(e){r.status(503).json({error:e.message,brokerExecution:'HARD_BLOCKED'})}});
  app.get('/api/v19/broker-snapshot',requireAdmin,async(_q,r)=>{try{const [market,positions,accounts]=await Promise.all([api('/markets/'+encodeURIComponent(EPIC),'GET',null,'3'),api('/positions','GET',null,'2'),api('/accounts')]);r.set('Cache-Control','no-store');r.json({market:inspectMarket(market),positionCount:Array.isArray(positions?.positions)?positions.positions.length:null,positionsResponseValid:Array.isArray(positions?.positions),accountResponseValid:Array.isArray(accounts?.accounts),brokerExecution:'HARD_BLOCKED',brokerOrdersSentByV19:0,notes:['Read-only IG GET requests','No account identifiers or credentials returned','Market POINTS are not assumed to equal pips','No position reconciliation or monetary contract verification claimed']})}catch(e){r.status(502).json({error:'Read-only IG lookup failed',detail:e.message,brokerExecution:'HARD_BLOCKED'})}});
  app.post('/api/v19/risk-preview',requireAdmin,(q,r)=>{r.set('Cache-Control','no-store');r.json(calculatePreview(q.body||{}))});
 }
 return {routes};
}
module.exports={createV19,calculatePreview,inspectMarket};
