'use strict';
// v33 IG demo automation readiness: broker READS only. No write-order methods.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const valid=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{3,80}$/.test(x);
const states=new Set(['PREPARED','SENT_UNKNOWN','ACKNOWLEDGED','RECONCILE_REQUIRED','CLOSED_VERIFIED','CANCELLED_VERIFIED']);
const unresolved=new Set(['PREPARED','SENT_UNKNOWN','ACKNOWLEDGED','RECONCILE_REQUIRED']);
const iso=x=>{const d=new Date(x);return Number.isFinite(d.getTime())?d.toISOString():null};
function candidates(transactions,criteria={}){
 if(!Array.isArray(transactions))throw Error('Transactions must be an array');
 const target=String(criteria.dealId||'');const expected=iso(criteria.at);const timeWindow=Math.min(72,Math.max(1,Number(criteria.windowHours)||24))*3600000;
 return transactions.map((t,i)=>{
  const refs=[t.reference,t.dealId,t.dealReference].filter(x=>typeof x==='string');
  const exact=!!target&&refs.includes(target);
  const name=String(t.instrumentName||'').toLowerCase();const instrument=!!criteria.instrument&&name.includes(String(criteria.instrument).toLowerCase());
  const date=iso(t.dateUtc||t.date||t.openDateUtc);const temporal=!!expected&&!!date&&Math.abs(Date.parse(date)-Date.parse(expected))<=timeWindow;
  const price=Number(criteria.openLevel);const level=Number(t.openLevel);const priceNear=criteria.openLevel!==undefined&&Number.isFinite(price)&&Number.isFinite(level)&&Math.abs(price-level)<=Math.max(0.00001,Number(criteria.priceTolerance)||0.0002);
  const score=(exact?100:0)+(instrument?25:0)+(temporal?20:0)+(priceNear?20:0);
  return {index:i,score,exactReferenceMatch:exact,possibleCorrelation:!exact&&score>=45,referenceMasked:refs.map(r=>r.length<=4?'****':'***'+r.slice(-4)),date,instrumentName:String(t.instrumentName||'').slice(0,80),transactionType:String(t.transactionType||'').slice(0,40),openLevel:t.openLevel??null,closeLevel:t.closeLevel??null,size:t.size??null,recordDigest:digest(t)};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,20);
}
function sizing(x){
 const required=['size','pipSize','pipValueQuotePerContract','contractsPerSize','gbpPerQuote','stopPips','maxRiskGBP'];
 if(required.some(k=>x?.[k]===undefined||x[k]===null||x[k]===''))throw Error('Missing sizing inputs');
 const n=Object.fromEntries(required.map(k=>[k,Number(x[k])]));
 if(Object.values(n).some(v=>!Number.isFinite(v)||v<=0))throw Error('All sizing inputs must be finite and positive');
 if(x.accountType!=='CFD'||x.accountCurrency!=='GBP')throw Error('GBP CFD account required');
 // pipValueQuotePerContract is the QUOTE currency value of ONE pip per contract, not the pip size.
 const pipGBP=n.pipValueQuotePerContract*n.contractsPerSize*n.gbpPerQuote;
 const base=n.size*n.stopPips*pipGBP;
 const reserve=Math.max(0,Number(x.slippageReserveGBP)||0)+Math.max(0,Number(x.feesReserveGBP)||0);
 if(!Number.isFinite(reserve)||!Number.isFinite(base)||!Number.isFinite(pipGBP))throw Error('Nonfinite sizing result');
 const minSize=Number(x.minimumSize),increment=Number(x.sizeIncrement);
 const sizeValid=Number.isFinite(minSize)&&minSize>0&&Number.isFinite(increment)&&increment>0&&n.size+1e-9>=minSize&&Math.abs((n.size-minSize)/increment-Math.round((n.size-minSize)/increment))<1e-7;
 const stopMinimum=Number(x.minimumStopPips);const stopValid=Number.isFinite(stopMinimum)&&stopMinimum>0&&n.stopPips>=stopMinimum;
 const independentlyVerified=false;
 return {pipValueGBPPerSize:pipGBP,riskBeforeReservesGBP:Number(base.toFixed(2)),totalRiskGBP:Number((base+reserve).toFixed(2)),withinBudget:base+reserve<=n.maxRiskGBP,sizeValid,stopValid,independentlyVerified,certified:false,brokerOrderAllowed:false,warning:'Inputs are operator-supplied. IG contract unit, dealing-rule units, GBP conversion and protective stop MUST be independently confirmed.'};
}
function reconcile(intents,positions){
 if(!Array.isArray(intents)||!Array.isArray(positions))throw Error('Journal and broker positions arrays required');
 const seen=new Set();const items=intents.map(x=>{
  if(!valid(x.intentId)||!states.has(x.state)||seen.has(x.intentId))throw Error('Invalid or duplicate intent/state');seen.add(x.intentId);
  const matched=positions.filter(p=>p?.position?.dealId&&p.position.dealId===x.dealId).length;
  return {intentId:x.intentId,state:x.state,brokerPositionMatches:matched,requiresManualReview:unresolved.has(x.state)||matched>1||x.state==='CLOSED_VERIFIED'&&matched>0};
 });
 return {items,unresolved:items.filter(x=>x.requiresManualReview).map(x=>x.intentId),safeToSubmitNewOrder:false,brokerOrderAllowed:false,decision:'NO_AUTOMATIC_RESUBMISSION',warning:'Snapshot reconciliation does not prove missing in-flight broker confirmations or safe order retry.'};
}
function createV33({requireAdmin,api,authInfo,storageDir,persistentStorage=false}){
 const file=path.join(storageDir,'v33-intents.json');let intents=[],healthy=true,error=null;
 try{if(fs.existsSync(file)){const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(saved)||saved.some(e=>digest(e.data)!==e.digest))throw Error('Journal digest mismatch');intents=saved;}}catch(e){healthy=false;error=e.message;}
 function save(entry){if(!healthy||!persistentStorage)throw Error('Durable journal unavailable');const next=[...intents,{data:entry,digest:digest(entry)}];fs.mkdirSync(storageDir,{recursive:true});const tmp=file+'.tmp';const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const dirfd=fs.openSync(storageDir,'r');try{fs.fsyncSync(dirfd)}finally{fs.closeSync(dirfd)}intents=next;return entry;}
 function status(){return {version:'33.0.0',mode:'IG_DEMO_AUTOMATION_READINESS',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,unattendedTradingEnabled:false,storageHealthy:healthy,persistentStorageConfigured:!!persistentStorage,journalEvents:intents.length,unresolvedIntents:intents.filter(e=>unresolved.has(e.data.state)).length,checks:{gbpSizingCertified:false,brokerLifecycleCertified:false,crashRecoveryCertified:false},storageError:error,warning:'Read-only broker diagnostics; no broker order submission or automatic retry.'};}
 function routes(app){
  app.get('/api/v33/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.get('/api/v33/intents',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({intents:intents.slice(-50).map(e=>e.data),status:status()}));
  app.post('/api/v33/risk/assess',requireAdmin,(q,r)=>{try{r.json({result:sizing(q.body),status:status()})}catch(e){r.status(400).json({error:e.message})}});
  app.post('/api/v33/journal/prepare',requireAdmin,(q,r)=>{try{const id=q.body?.intentId;if(!valid(id))throw Error('Valid intentId required');if(intents.some(e=>e.data.intentId===id))throw Error('Intent ID already exists');const entry={intentId:id,state:'PREPARED',at:new Date().toISOString(),instrument:String(q.body?.instrument||'').slice(0,80),mode:'NO_BROKER_WRITE',dealId:null};r.json({entry:save(entry),status:status()})}catch(e){r.status(409).json({error:e.message})}});
  app.post('/api/v33/recovery/inspect',requireAdmin,async(_q,r)=>{try{const p=await api('/positions','GET',null,'2');if(!Array.isArray(p?.positions))throw Error('Positions unavailable');const result=reconcile(intents.map(e=>e.data),p.positions);r.set('Cache-Control','no-store').json({result,status:status()})}catch(e){r.status(502).json({error:'Read-only reconciliation unavailable',detail:String(e.message).slice(0,100)})}});
  app.post('/api/v33/history/correlate',requireAdmin,async(q,r)=>{try{const a=await api('/accounts');const selected=(a.accounts||[]).find(x=>x.accountId===authInfo()?.accountId);if(!selected||selected.accountType!=='CFD'||selected.currency!=='GBP')return r.status(409).json({error:'Active GBP CFD account not confirmed'});const now=new Date(),from=new Date(now.getTime()-30*86400000);const query=new URLSearchParams({from:from.toISOString(),to:now.toISOString(),pageSize:'100',pageNumber:'1'});const data=await api('/history/transactions?'+query,'GET',null,'2');if(!Array.isArray(data?.transactions))throw Error('History unavailable');const result=candidates(data.transactions,q.body||{});r.set('Cache-Control','no-store').json({scanned:data.transactions.length,candidates:result,searchLimitedToFirstPage:true,exactMatchFound:result.some(x=>x.exactReferenceMatch),warning:'Correlated candidates are not broker lifecycle proof. Masked references are diagnostic only.',status:status()});}catch(e){r.status(502).json({error:'Read-only history correlation failed',detail:String(e.message).slice(0,100)})}});
  app.get('/v33',(_q,r)=>r.sendFile(path.join(__dirname,'public','v33.html')));
 }
 return {routes,status};
}
module.exports={createV33,candidates,sizing,reconcile};
