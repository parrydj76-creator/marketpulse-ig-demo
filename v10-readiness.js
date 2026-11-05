 'use strict';
// V10 read-only readiness and simulation audits. No order submission functions.
const EPIC='CS.D.EURUSD.CFD.IP';
function finite(n){return typeof n==='number'&&Number.isFinite(n)}
function positionAudit(state,config){
 const s=state||{},p=s.position||null, equity=Number(s.equity), start=Number(s.dayStartEquity), realised=Number(s.dayRealized);
 const issues=[], checks=[];
 const add=(name,ok,detail)=>{checks.push({name,pass:!!ok,detail});if(!ok)issues.push(name)};
 add('Virtual equity valid',finite(equity)&&equity>0,'Current persisted simulation equity');
 add('Daily entry cap',Number.isInteger(s.dailyOpens)&&s.dailyOpens>=0&&s.dailyOpens<=config.maxNewTradesPerDay,'Count of new v9 entries today');
 add('Daily realised loss within limit',finite(realised)&&finite(start)&&realised> -start*config.dailyLossFraction,'Realised loss only; not a total loss guarantee');
 if(p){
  const d=p.direction,entry=Number(p.entry),stop=Number(p.stop),target=Number(p.target),risk=Number(p.riskGBP),perPip=Number(p.virtualGBPPerPip);
  add('Direction and protective levels', ['LONG','SHORT'].includes(d)&&[entry,stop,target].every(finite)&&(d==='LONG'?stop<entry&&target>entry:stop>entry&&target<entry),'Simulated prices, not broker-attached stops');
  const stopPips=Math.abs(entry-stop)/0.0001;
  add('Virtual pip value and stop risk',finite(perPip)&&perPip>0&&finite(risk)&&risk>0&&Math.abs(stopPips*perPip-risk)<0.02,'Illustrative GBP/pip, not IG contract value');
  add('Open risk plus realised loss within daily budget',finite(start)&&finite(realised)&&finite(risk)&&Math.max(0,-realised)+risk<=start*config.dailyLossFraction+0.01,'Conservative projected stop loss, excludes slippage');
 }else add('No open simulated position',true,'No position currently held');
 return {checks,issues,pass:issues.length===0,openPosition:!!p,remainingDailyLossBudgetGBP:finite(start)&&finite(realised)?Math.max(0,start*config.dailyLossFraction+Math.min(0,realised)):null};
}
function brokerReadiness(market,positions,account,simulation){
 const rules=market?.dealingRules||{},snapshot=market?.snapshot||{},instrument=market?.instrument||{};
 const minSize=rules.minDealSize||null, minStop=rules.minNormalStopOrLimitDistance||null;
 const checks=[
  {name:'IG market specification fetched',pass:!!market?.instrument,detail:instrument.name||EPIC},
  {name:'Minimum deal size provided',pass:finite(Number(minSize?.value))&&Number(minSize.value)>0,detail:minSize},
  {name:'Minimum stop distance provided',pass:finite(Number(minStop?.value))&&Number(minStop.value)>0,detail:minStop},
  {name:'Market currently tradeable',pass:snapshot.marketStatus==='TRADEABLE',detail:snapshot.marketStatus||'UNKNOWN'},
  {name:'Broker positions response validated',pass:Array.isArray(positions),detail:Array.isArray(positions)?`${positions.length} broker positions reported`:'Not verified'},
  {name:'Account identity verified',pass:!!account?.accountId,detail:account?.accountId?'Account returned (ID withheld)':'Not verified'},
  {name:'GBP-per-pip contract conversion independently verified',pass:false,detail:'Requires instrument-specific size, contract units and FX conversion tests'},
  {name:'Idempotent order confirmation/reconciliation tested',pass:false,detail:'No order lifecycle tests performed'},
  {name:'Restart-safe pending-order recovery tested',pass:false,detail:'No broker recovery test performed'},
  {name:'Automated broker execution authorised',pass:false,detail:'Hard-block remains in place'}
 ];
 return {epic:EPIC,brokerExecution:'BLOCKED',readyForOrders:false,checks,market:{name:instrument.name||null,currencies:instrument.currencies||null,lotSize:instrument.lotSize??null,unit:instrument.unit||null,minimumDealSize:minSize,minimumStopDistance:minStop},paperAudit:simulation||null,checkedAt:new Date().toISOString()};
}
function registerV10(app,requireAdmin,{v9Paper,api,accountSnapshot}){
 app.get('/v10',(_req,res)=>res.sendFile(require('path').join(__dirname,'public','v10.html')));
 app.get('/api/v10/audit',requireAdmin,async(_req,res)=>{try{const s=await v9Paper.status();if(!s.ready)return res.status(503).json({error:s.error||'Paper engine unavailable'});res.set('Cache-Control','no-store').json({version:'10.0',brokerExecution:'BLOCKED',simulation:s,positionAudit:positionAudit(s.state,s.config),checkedAt:new Date().toISOString()})}catch(e){res.status(503).json({error:e.message})}});
 app.get('/api/v10/broker-readiness',requireAdmin,async(_req,res)=>{try{
  // IG API GET only; do not submit, amend, close or cancel orders.
  const [market,positionsResponse,accountsResponse,sim]=await Promise.all([api('/markets/'+encodeURIComponent(EPIC)),api('/positions'),api('/accounts'),v9Paper.status()]);
  const positions=positionsResponse?.positions;
  const account=(accountsResponse?.accounts||[]).find(a=>a.preferred)||accountsResponse?.accounts?.[0]||accountSnapshot?.()||null;
  res.set('Cache-Control','no-store').json(brokerReadiness(market,positions,account,sim.ready?positionAudit(sim.state,sim.config):null));
 }catch(e){res.status(502).json({error:'Read-only broker readiness failed: '+e.message,brokerExecution:'BLOCKED',readyForOrders:false})}});
}
module.exports={positionAudit,brokerReadiness,registerV10};
