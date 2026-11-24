'use strict';
// Evidence assessment only. Never authorizes broker dealing.
function report({paper,broker,confirmations,safety,storage,now=Date.now()}) {
 const age=paper.lastTick?now-Date.parse(paper.lastTick):NaN;
 const exits=(paper.events||[]).filter(e=>e.type==='CLOSED'&&Number.isFinite(e.pips)&&['STOP','TARGET','TIME'].includes(e.reason));
 const records=broker.records||[], confirms=confirmations.records||[];
 const retained=records.filter(r=>r.restart&&r.difference?.retained?.length>0);
 const matched=confirms.filter(r=>r.confirmation?.status==='ACCEPTED'&&r.confirmation.reference===r.confirmation.returnedReference&&r.matchingPositions?.length>0);
 const latest=records.at(-1);
 return {version:'350.0.0',brokerOrdersAllowed:false,certified:false,heartbeatHealthy:Number.isFinite(age)&&age>=0&&age<20000,monitor:paper.monitor??null,checks:[
 {name:'Deployed paper exit',status:exits.length?'OBSERVED':'AWAITING_EVIDENCE',evidence:exits.slice(-10)},
 {name:'GBP risk and stop units',status:'AWAITING_EVIDENCE',required:'Independent IG deal-size, stop-distance and GBP P&L comparison'},
 {name:'Broker lifecycle',status:matched.length?'PARTIAL_EVIDENCE':'AWAITING_EVIDENCE',matchedOpenConfirmations:matched.length,required:'Matched opening and closing confirmations and transaction history'},
 {name:'Broker restart recovery',status:retained.length?'PARTIAL_EVIDENCE':'AWAITING_EVIDENCE',retainedRestartSnapshots:retained.length},
 {name:'Emergency safety',status:safety.engaged===true&&safety.persisted===true&&safety.brokerOrdersAllowed===false?'LOCAL_LATCH_OBSERVED':'FAIL',required:'Independent broker-connected safety test'}],storage,latestBrokerSnapshot:latest?{at:latest.at,positions:latest.rows.length,historyPageOnly:latest.historyPageOnly}:null};
}
module.exports={report};
