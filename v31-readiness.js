'use strict';
// Read-only, bounded IG demo evidence discovery. NEVER places, arms, or closes broker orders.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const valid=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{3,80}$/.test(x);
const MAX_PAGES=10, PAGE_SIZE=100;
function classify(tx,dealId){
 const text=JSON.stringify(tx);
 const exact=Object.entries(tx||{}).filter(([k,v])=>typeof v==='string'&&v===dealId).map(([k])=>k);
 return {match:exact.length>0||text.includes(dealId),fields:exact};
}
async function discover({api,dealId,from,to,maxPages=MAX_PAGES}){
 if(!valid(dealId))throw Error('Invalid dealId');
 const limit=Math.min(MAX_PAGES,Math.max(1,Number(maxPages)||MAX_PAGES));
 let pages=0,scanned=0,matching=[],shapeKeys=new Set(),complete=false,reason='PAGE_LIMIT';
 for(let page=1;page<=limit;page++){
  const query=new URLSearchParams({from,to,pageSize:String(PAGE_SIZE),pageNumber:String(page)});
  const data=await api('/history/transactions?'+query,'GET',null,'2');
  if(!Array.isArray(data?.transactions))throw Error('IG transaction history unavailable');
  pages++;scanned+=data.transactions.length;
  for(const tx of data.transactions){Object.keys(tx||{}).forEach(k=>shapeKeys.add(k));const m=classify(tx,dealId);if(m.match)matching.push({fieldMatches:m.fields,transactionDigest:sha(tx),date:tx.date||tx.openDateUtc||null,type:tx.transactionType||tx.type||null});}
  if(data.transactions.length<PAGE_SIZE){complete=true;reason='SHORT_PAGE';break;}
  // A full final page may exist; bounded search must not assert completeness.
 }
 const positionData=await api('/positions','GET',null,'2');
 if(!Array.isArray(positionData?.positions))throw Error('IG current positions unavailable');
 const positionPresent=positionData.positions.some(p=>p.position?.dealId===dealId);
 return {dealId,pagesScanned:pages,transactionsScanned:scanned,matchingTransactions:matching,transactionFieldNames:[...shapeKeys].sort(),positionCurrentlyAbsent:!positionPresent,searchComplete:complete,searchStopReason:reason,limits:{maxPages:limit,pageSize:PAGE_SIZE},checks:{historicalMatchFound:matching.length>0,positionCurrentlyAbsent:!positionPresent,openingConfirmationVerified:false,closingConfirmationVerified:false,attachedStopVerified:false,independentGBPRiskVerified:false,inFlightRecoveryVerified:false},lifecycleVerified:false,brokerOrderAllowed:false};
}
function createV31({requireAdmin,api,authInfo,storageDir,persistentStorage=false,appendEvidence=()=>{}}){
 const file=path.join(storageDir,'v31-evidence.json');let entries=[],storageHealthy=true,storageError=null;
 try{if(fs.existsSync(file)){entries=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(entries)||entries.some(e=>sha(e.record)!==e.digest))throw Error('Evidence digest mismatch');}}catch(e){storageHealthy=false;storageError=e.message;}
 function persist(record){if(!storageHealthy)throw Error('Evidence storage unhealthy');const next=[...entries,{record,digest:sha(record)}];fs.mkdirSync(storageDir,{recursive:true});const temp=file+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(next),{mode:0o600});fs.renameSync(temp,file);entries=next;}catch(e){storageHealthy=false;storageError=e.message;throw e;}}
 function status(){return {version:'31.0.0',mode:'READ_ONLY_DEMO_READINESS',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,recordedInvestigations:entries.length,storageHealthy,persistentStorageConfigured:!!persistentStorage,storageError:storageError?String(storageError).slice(0,100):null,checks:{accountTypeConfirmedByOperator:true,historyMatchVerified:entries.some(e=>e.record.result.matchingTransactions.length>0),brokerLifecycleVerified:false,independentGBPRiskVerified:false,inFlightRecoveryVerified:false,unattendedExecutionApproved:false},warning:'No broker writes. History matches and account observations are not execution certification.'};}
 function routes(app){
  app.get('/api/v31/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.get('/api/v31/records',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({records:entries.slice(-20).map(e=>e.record),status:status()}));
  app.get('/api/v31/account-check',requireAdmin,async(_q,r)=>{try{const data=await api('/accounts');const a=authInfo();const selected=(data.accounts||[]).find(x=>x.accountId===a?.accountId);r.set('Cache-Control','no-store').json({authenticated:!!a?.accountId,accountFound:!!selected,accountType:selected?.accountType||null,currency:selected?.currency||null,preferred:!!selected?.preferred,accountCount:(data.accounts||[]).length,accountIdOmitted:true,brokerOrderAllowed:false});}catch(e){r.status(502).json({error:'IG account check failed',detail:String(e.message).slice(0,120)});}});
  app.post('/api/v31/history/investigate',requireAdmin,async(q,r)=>{
   const dealId=q.body?.dealId;if(!valid(dealId))return r.status(400).json({error:'Valid dealId required'});
   const to=new Date(),from=new Date(to.getTime()-30*86400000);
   if(q.body?.from){const d=new Date(q.body.from);if(!Number.isFinite(d.getTime())||d>to||to-d>30*86400000)return r.status(400).json({error:'from must be within last 30 days'});from.setTime(d.getTime());}
   try{const accountData=await api('/accounts');const selected=(accountData.accounts||[]).find(x=>x.accountId===authInfo()?.accountId);
    if(!selected||selected.accountType!=='CFD'||selected.currency!=='GBP')return r.status(409).json({error:'Authenticated account is not confirmed GBP CFD demo; no investigation recorded'});
    const result=await discover({api,dealId,from:from.toISOString(),to:to.toISOString(),maxPages:q.body?.maxPages});
    const record={id:crypto.randomUUID(),at:new Date().toISOString(),accountType:'CFD',currency:'GBP',from:from.toISOString(),to:to.toISOString(),result};
    persist(record);appendEvidence('V31_DEMO_HISTORY_INVESTIGATED',{recordId:record.id,dealId,recordDigest:sha(record),verified:false});
    r.set('Cache-Control','no-store').json({record,status:status()});
   }catch(e){r.status(502).json({error:'Read-only IG investigation failed',detail:String(e.message).slice(0,160)});}
  });
  app.get('/v31',(_q,r)=>r.sendFile(path.join(__dirname,'public','v31.html')));
 }
 return {routes,status};
}
module.exports={createV31,discover,classify};
