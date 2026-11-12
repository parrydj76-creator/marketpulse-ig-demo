'use strict';
// v170: database concurrency stress + evidence gap assessment. NEVER submits broker orders.
const crypto=require('node:crypto');
const {POLICY,TARGET}=require('./v150-readiness');
const id=()=>crypto.randomUUID();
function assess({v160,v150,v125}){
 const s=v160.status(), base=v150.status();
 const checks={
  historicalPaperAccounting:{passed:false,evidence:'Historical simulated fills require independent price/fee reconciliation'},
  exchangeTimestampAndDelay:{passed:false,evidence:'REST freshness is not exchange-time or zero-delay streaming certification'},
  gbpPipValueAndDealSize:{passed:false,evidence:'IG contract size and independently confirmed GBP/pip missing'},
  netDailyPnlAndFees:{passed:false,evidence:'Broker transaction reconciliation with charges and cashflows missing'},
  brokerStopLifecycle:{passed:false,evidence:'No operator-approved real IG DEMO stop/close lifecycle verified'},
  unknownSubmissionRecovery:{passed:false,evidence:'No actual broker unknown-submit lookup and crash recovery verified'},
  distributedExecutionLock:{passed:false,evidence:'DB rehearsal lock not integrated into broker submit path'}
 };
 return {version:'170.0.0',mode:'READ_ONLY_FAIL_CLOSED',epic:TARGET,policy:POLICY,
  snapshot:base.snapshot,polling:base.polling,database:s.database,
  certification:checks,certificationsPassed:0,certificationsRequired:7,
  brokerOrderAllowed:false,unattendedOrderAllowed:false,readyForUnattendedDemo:false,
  nextSteps:['Verify IG contract value, sizing and GBP FX independently','Reconcile a complete broker day including fees and cashflows','Prove exchange timestamps and delay','Integrate fencing checks with actual broker order path before any execution','Operator-approve controlled IG DEMO order, stop and close verification','Test unknown broker submission and restart reconciliation','Certify historical paper accounting']};
}
function createV170({requireAdmin,v160,v150,v125}={}){
 if(typeof requireAdmin!=='function'||!v160||!v150||!v125)throw Error('V170_DEPENDENCIES_MISSING');
 let busy=false;
 async function concurrencySafe(){
  if(busy)throw Error('REHEARSAL_BUSY');busy=true;
  const owner=id(), others=Array.from({length:8},id);let first=null, second=null;
  try{
   first=await v160.acquire(owner,15000);if(!first.granted)throw Error('LEASE_HELD_BY_ANOTHER_PROCESS');
   const results=await Promise.all(others.map(o=>v160.acquire(o,15000)));
   const allDenied=results.every(r=>r.granted===false);
   const stale=await v160.renew(others[0],first.fence,15000);
   const good=await v160.renew(owner,first.fence,15000);
   const released=await v160.release(owner,first.fence);
   if(!released.released)throw Error('LEASE_RELEASE_FAILED');
   second=await v160.acquire(others[0],15000);
   const advanced=second.granted&&BigInt(second.fence)>BigInt(first.fence);
   const oldOwner=await v160.renew(owner,first.fence,15000);
   const passed=allDenied&&!stale.renewed&&good.renewed&&advanced&&!oldOwner.renewed;
   return {passed,workersAttempted:8,allCompetingWorkersRejected:allDenied,staleOwnerRejected:!stale.renewed,ownerRenewed:good.renewed,monotonicFence:advanced,oldOwnerRejectedAfterTakeover:!oldOwner.renewed,scope:'REHEARSAL_ONLY',integratedIntoBrokerOrderPath:false,brokerOrderAllowed:false};
  }finally{
   if(second?.granted)await v160.release(others[0],second.fence).catch(()=>{});
   if(first?.granted)await v160.release(owner,first.fence).catch(()=>{});
   busy=false;
  }
 }
 function tests(){const report=assess({v160,v150,v125});const t={blocked:!report.brokerOrderAllowed,unattendedBlocked:!report.readyForUnattendedDemo,allCertificationsOpen:Object.values(report.certification).every(x=>x.passed===false),correctEpic:report.epic===TARGET,readOnly:report.mode==='READ_ONLY_FAIL_CLOSED',noUnverifiedRiskCertification:!v160.status().independentContractCertification,lockNotMisrepresented:!v160.status().executionLockIntegrated};return {passed:Object.values(t).every(Boolean),count:Object.keys(t).length,tests:t,brokerOrderAllowed:false};}
 const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req));}catch(e){res.status(503).json({error:String(e.message).slice(0,150),brokerOrderAllowed:false});}};
 function routes(app){app.get('/api/v170/status',requireAdmin,wrap(()=>assess({v160,v150,v125})));app.get('/api/v170/certifications',requireAdmin,wrap(()=>assess({v160,v150,v125}).certification));app.get('/api/v170/fault-tests',requireAdmin,wrap(tests));app.post('/api/v170/lease/concurrency',requireAdmin,wrap(concurrencySafe));app.post('/api/v170/arm',requireAdmin,(_q,r)=>r.status(409).json({error:'BROKER_DEALING_HARD_BLOCKED',brokerOrderAllowed:false}));}
 return {routes,tests,concurrencySafe,status:()=>assess({v160,v150,v125})};
}
module.exports={createV170,assess};
