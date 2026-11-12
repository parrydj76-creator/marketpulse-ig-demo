'use strict';
function createV96({requireAdmin,v86,v95}){
 function status(){const readiness=v86.status(),base=v95.status(),h=base.lastEvidence?.checks?.history||null;
 const operational=Object.fromEntries(['feedConnected','quoteValid'].map(k=>[k,{currentlyPassed:readiness.checks?.[k]?.passed===true,certifiedForExecution:false}]));
 return {version:'96.0.0',mode:'READ_ONLY_HISTORY_REPAIR',historyEndpoint:'/history/transactions',historyVersion:'2',
 historyLastCapture:h?{ok:h.ok,historyComplete:h.historyComplete,paginationMetadataValid:h.paginationMetadataValid,pagesFetched:h.pagesFetched,reportedTotalPages:h.reportedTotalPages,error:h.error}:null,
 operational,ledgerHealthy:base.ledgerHealthy,previousLedgerHealthy:base.previousLedgerHealthy,paperPaused:base.paperPaused,
 outstandingBlockers:readiness.blockers,brokerOrderAllowed:false,unattendedOrderAllowed:false,readyForUnattendedDemo:false,
 warning:'Read-only history repair. No certification or IG order submission.'};}
 function routes(app){app.get('/api/v96/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.post('/api/v96/arm',requireAdmin,(_q,r)=>r.status(409).json({error:'BROKER_ORDER_HARD_BLOCKED',brokerOrderAllowed:false}));}
 return {status,routes};
}
module.exports={createV96};
