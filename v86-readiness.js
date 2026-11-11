'use strict';
// Diagnostic-only gate matrix. Never sends broker requests or authorizes orders.
const fs=require('node:fs');
const path=require('node:path');
const {audit,control}=require('./v85-integrity');
function createV86({requireAdmin,storageDir,persistentStorage,v81,v68}){
 function status(){
  const integrity=audit(storageDir),ctl=control(storageDir),sim=v81.status();
  let feed={};try{feed=v68.status()||{}}catch(_e){}
  const quote=feed.quote||{};
  const priceValid=typeof quote.bid==='number'&&typeof quote.ask==='number'&&quote.bid>0.5&&quote.bid<2&&quote.ask>quote.bid&&quote.ask<2;
  const quoteFresh=typeof quote.ageMs==='number'&&quote.ageMs>=0&&quote.ageMs<=15000;
  const spreadValid=typeof quote.spreadPips==='number'&&quote.spreadPips>=0&&quote.spreadPips<=2.5;
  const checks={
   persistentStorage:{passed:!!persistentStorage,detail:'Durable journal storage confirmed'},
   journalIntegrity:{passed:integrity.journalHealthy===true,detail:'Hash-linked paper journal intact'},
   historicalPaperAccounting:{passed:integrity.quarantinedTrades===0,detail:`${integrity.quarantinedTrades??'unknown'} historical paper trades quarantined; legacy raw totals must not be used`},
   paperSafetyHold:{passed:ctl.paused===true,detail:'Paper simulator remains paused'},
   schedulerDisabled:{passed:sim.scheduled===false,detail:'No unattended paper timer registered'},
   feedConnected:{passed:feed.streamState==='CONNECTED',detail:'Connectivity alone does not certify exchange timestamps'},
   quoteValid:{passed:priceValid&&quoteFresh&&spreadValid,detail:'Quote plausibility, local freshness and spread only'},
   exchangeTimestampAndDelayCertified:{passed:false,detail:'Requires independent evidence of exchange time and undelayed IG feed'},
   gbpPipValueAndDealSizeCertified:{passed:false,detail:'Requires verified IG Mini contract GBP/pip, conversion and minimum size'},
   brokerNetDailyPnlCertified:{passed:false,detail:'Requires independently reconciled broker P&L including charges'},
   brokerStopAndOrderLifecycleCertified:{passed:false,detail:'Requires protective stop and order confirmation tests'},
   unknownSubmitAndRestartRecoveryCertified:{passed:false,detail:'Requires crash-safe broker recovery and reconciliation tests'},
   singleInstanceAndConcurrencyCertified:{passed:false,detail:'Requires independently tested single-writer enforcement'}
  };
  const blockers=Object.entries(checks).filter(([,v])=>!v.passed).map(([k])=>k);
  return {version:'86.0.0',mode:'READ_ONLY_DEMO_AUTOMATION_READINESS',brokerOrderAllowed:false,unattendedOrderAllowed:false,autoStartAllowed:false,paperPaused:ctl.paused,paperSchedulerRunning:sim.scheduled,journalRecords:integrity.journalRecords??null,quarantinedTrades:integrity.quarantinedTrades??null,validatedSimulatedPnlGBP:integrity.validSimulatedPnlGBP??null,checks,blockers,readyForUnattendedDemo:false,warning:'No IG dealing routes added. Passing diagnostics cannot enable broker execution.'};
 }
 function routes(app){app.get('/api/v86/status',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(status()));app.get('/api/v86/readiness',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(status()));app.post('/api/v86/arm',requireAdmin,(_req,res)=>res.status(409).json({error:'BROKER_ORDER_HARD_BLOCKED',brokerOrderAllowed:false}));}
 return {status,routes};
}
module.exports={createV86};
