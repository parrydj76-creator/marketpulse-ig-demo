'use strict';
// V35 is diagnostics-only. Never issues broker write requests.
const path=require('node:path');
function assess(v33,v34,snap){
 const count=v33?.unresolvedIntents;
 const journalVerified=v33?.storageHealthy===true&&v33?.persistentStorageConfigured===true&&Number.isSafeInteger(count)&&count>=0;
 const paperJournalVerified=v34?.storageHealthy===true&&v34?.persistentStorageConfigured===true&&v34?.journal?.valid===true;
 return {version:'35.0.0',mode:'PAPER_READINESS_DIAGNOSTICS',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,
  journalVerified,paperJournalVerified,unresolvedIntents:journalVerified?count:null,
  orderIntentGate:!journalVerified?'UNKNOWN_BLOCKED':count>0?'UNRESOLVED_BLOCKED':'LOCAL_JOURNAL_CLEAR',
  paperAutomationEnabled:v34?.paperAutomationEnabled===true,
  paperCycles:v34?.cycles??null,paperJournalEvents:v34?.journal?.events??null,
  market:{epic:snap?.epic??null,direction:snap?.direction??null,score:snap?.score??null,marketState:snap?.marketState??null,quoteAgeMs:snap?.quoteAgeMs??null,delayed:snap?.delayed??null},
  checks:{gbpSizingCertified:false,brokerLifecycleCertified:false,crashRecoveryCertified:false},
  warning:'Local journal clearance does not establish broker reconciliation. Paper diagnostics only; no broker order authorization.'};
}
function createV35({requireAdmin,v33Status,v34Status,signalSnapshot}){
 function status(){let v33=null,v34=null,snap=null;try{v33=v33Status()}catch{}try{v34=v34Status()}catch{}try{snap=signalSnapshot()}catch{}return assess(v33,v34,snap)}
 function routes(app){app.get('/api/v35/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/v35',(_q,r)=>r.sendFile(path.join(__dirname,'public','v35.html')))}
 return {routes,status};
}
module.exports={createV35,assess};
