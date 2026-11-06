'use strict';
// Read-only historical evidence, explicitly NOT a broker execution readiness certificate.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{3,80}$/.test(x);
function assessHistory({dealId,transactions,positions}){
 const matches=transactions.filter(t=>JSON.stringify(t).includes(dealId));
 const absent=Array.isArray(positions)&&!positions.some(p=>p.position?.dealId===dealId);
 return {dealId,transactionMatches:matches.length,positionCurrentlyAbsent:absent,
  checks:{historicalTransactionFound:matches.length>0,positionCurrentlyAbsent:absent,
   openingConfirmationVerified:false,closingConfirmationVerified:false,attachedStopVerified:false,
   independentGBPRiskVerified:false,inFlightRecoveryVerified:false},
  lifecycleVerified:false,brokerOrderAllowed:false,
  note:'Transaction matches are evidence leads, not independently confirmed open/close order references. Position absence alone does not prove closure.'};
}
function createV30({requireAdmin,api,storageDir,persistentStorage=false,appendEvidence=()=>{}}){
 const file=path.join(storageDir,'v30-history.json');let records=[];let healthy=true,error=null;
 try{if(fs.existsSync(file)){records=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(records)||records.some(r=>!r||r.digest!==hash(r.record)))throw Error('Invalid history store');}}catch(e){healthy=false;error=e.message;}
 function persist(record){if(!healthy)throw Error('History store unhealthy: '+error);const next=[...records,{record,digest:hash(record)}];fs.mkdirSync(storageDir,{recursive:true});const temp=file+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(next),{mode:0o600});fs.renameSync(temp,file);records=next;}catch(e){healthy=false;error=e.message;throw e;}}
 function status(){return {version:'30.0.0',mode:'READ_ONLY_HISTORICAL_DEMO_EVIDENCE',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,recordedSessions:records.length,storageHealthy:healthy,persistentStorageConfigured:!!persistentStorage,storageWarning:persistentStorage?null:'Local files may be lost on Render restart/redeploy; do not treat this as durable recovery evidence.',checks:{historicalLookupAvailable:true,brokerLifecycleVerified:false,independentGBPRiskVerified:false,inFlightRecoveryVerified:false},warning:'Historical transaction matches do not certify a completed lifecycle, protective stop or GBP risk.'};}
 function routes(app){
  app.get('/api/v30/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.get('/api/v30/records',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({records:records.slice(-30).map(x=>x.record),status:status()}));
  app.post('/api/v30/history/verify',requireAdmin,async(q,r)=>{
   const dealId=q.body?.dealId;const maxSpan=30;
   if(!validId(dealId))return r.status(400).json({error:'Valid IG DEMO position dealId required'});
   const to=new Date(),from=new Date(to.getTime()-maxSpan*86400000);
   if(q.body?.from){const d=new Date(q.body.from);if(!Number.isFinite(d.getTime())||d>to||to-d>maxSpan*86400000)return r.status(400).json({error:'from must be a valid date within the last 30 days'});from.setTime(d.getTime());}
   try{
    // IG transaction history v2, read-only. Do not assume that a history transaction ID is a confirmation dealReference.
    const params=new URLSearchParams({from:from.toISOString(),to:to.toISOString(),pageSize:'100',pageNumber:'1'});
    const history=await api('/history/transactions?'+params,'GET',null,'2');
    if(!Array.isArray(history?.transactions))throw Error('IG history transactions missing or unavailable');
    const positions=await api('/positions','GET',null,'2');
    if(!Array.isArray(positions?.positions))throw Error('IG current positions unavailable');
    const result=assessHistory({dealId,transactions:history.transactions,positions:positions.positions});
    const record={id:crypto.randomUUID(),at:new Date().toISOString(),dealId,from:from.toISOString(),to:to.toISOString(),...result,
     source:'IG_DEMO_READ_ONLY_HISTORY',transactionEvidenceDigest:hash(history.transactions),positionEvidenceDigest:hash(positions.positions),
     paginationWarning:'Only first page of up to 100 transactions checked; missing matches are inconclusive.'};
    persist(record);appendEvidence('V30_HISTORICAL_EVIDENCE_OBSERVED',{id:record.id,dealId,digest:hash(record),verified:false});
    return r.set('Cache-Control','no-store').json({record,...status(),result:record});
   }catch(e){return r.status(502).json({error:'Historical IG read-only evidence collection failed',detail:String(e.message).slice(0,180)});}
  });
  app.get('/v30',(_q,r)=>r.sendFile(path.join(__dirname,'public','v30.html')));
 }
 return {routes,status};
}
module.exports={createV30,assessHistory};
