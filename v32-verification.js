'use strict';
// v32: evidence collection and recovery rehearsal ONLY. No broker write methods.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ref=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{3,80}$/.test(x);
function riskWorksheet(x){
 const n=k=>Number(x?.[k]);
 const required=['size','pipValuePerUnitGBP','stopPips','maxRiskGBP'];
 if(required.some(k=>x?.[k]===undefined||x[k]===null||x[k]===''))throw Error('All four numeric inputs required');
 if(required.some(k=>!Number.isFinite(n(k))||n(k)<=0))throw Error('Risk inputs must be finite and positive');
 if(!['CFD'].includes(x.instrumentType)||x.currency!=='GBP')throw Error('GBP CFD worksheet only');
 const risk=n('size')*n('pipValuePerUnitGBP')*n('stopPips');
 if(!Number.isFinite(risk))throw Error('Risk overflow');
 return {illustrativeRiskGBP:Number(risk.toFixed(2)),withinBudget:risk<=n('maxRiskGBP'),certified:false,unitsVerified:false,warning:'User-supplied pip value and size are NOT independently verified against IG contract units, FX conversion, slippage or fees.'};
}
function lifecycle({open,close,dealId,positions}){
 const checks={openAccepted:open?.dealStatus==='ACCEPTED'&&open?.dealId===dealId,
 closeAccepted:close?.dealStatus==='ACCEPTED'&&close?.dealId===dealId,
 attachedStopInOpeningConfirmation:Number.isFinite(Number(open?.stopLevel))&&Number(open.stopLevel)>0,
 absentAfterClose:Array.isArray(positions)&&!positions.some(p=>p.position?.dealId===dealId)};
 return {checks,observationsComplete:Object.values(checks).every(Boolean),brokerOrderAllowed:false,certified:false,warning:'Read-only snapshot cannot prove in-flight recovery, currency conversion or stop execution. Historical confirmations may expire.'};
}
function recoveryDecision(journal,positions){
 if(!Array.isArray(journal)||!Array.isArray(positions))throw Error('Journal and positions required');
 const pending=journal.filter(x=>['PREPARED','SENT_UNKNOWN','ACKNOWLEDGED','RECONCILE_REQUIRED'].includes(x.state));
 const ids=new Set();for(const item of journal){if(!ref(item.intentId)||ids.has(item.intentId))throw Error('Missing/duplicate intent ID');ids.add(item.intentId);}
 return {pendingIntents:pending.length,unresolved:pending.map(x=>x.intentId),safeToSubmitNewOrder:false,decision:pending.length?'MANUAL_RECONCILIATION_REQUIRED':'NO_AUTOMATIC_RESUBMISSION',brokerOrderAllowed:false,warning:'No broker writes; restart simulation alone cannot certify actual crash recovery.'};
}
function createV32({requireAdmin,api,storageDir,persistentStorage=false}){
 const file=path.join(storageDir,'v32-verification.json');let records=[],healthy=true;
 try{if(fs.existsSync(file)){records=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(records)||records.some(x=>hash(x.data)!==x.digest))throw Error('Evidence digest mismatch');}}catch{healthy=false;}
 function save(kind,result){if(!healthy)throw Error('Evidence storage unhealthy');const data={id:crypto.randomUUID(),at:new Date().toISOString(),kind,result};const next=[...records,{data,digest:hash(data)}];fs.mkdirSync(storageDir,{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(next),{mode:0o600});fs.renameSync(tmp,file);records=next;return data;}
 const status=()=>({version:'32.0.0',mode:'IG_DEMO_VERIFICATION_WORKBENCH',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,recordCount:records.length,storageHealthy:healthy,persistentStorageConfigured:!!persistentStorage,checks:{gbpSizingCertified:false,brokerLifecycleCertified:false,crashRecoveryCertified:false},warning:'Verification tools installed; independent broker certification has not occurred.'});
 function routes(app){
  app.get('/api/v32/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.get('/api/v32/records',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({records:records.slice(-20).map(x=>x.data),status:status()}));
  app.post('/api/v32/risk/worksheet',requireAdmin,(q,r)=>{try{const result=riskWorksheet(q.body);r.json({result,record:save('RISK_WORKSHEET',result),status:status()});}catch(e){r.status(400).json({error:e.message});}});
  app.post('/api/v32/lifecycle/inspect',requireAdmin,async(q,r)=>{const {openDealReference,closeDealReference,dealId}=q.body||{};if(![openDealReference,closeDealReference,dealId].every(ref))return r.status(400).json({error:'Valid opening and closing API dealReferences plus position dealId required'});try{
   const [open,close,pos]=await Promise.all([api('/confirms/'+encodeURIComponent(openDealReference)),api('/confirms/'+encodeURIComponent(closeDealReference)),api('/positions','GET',null,'2')]);
   if(!Array.isArray(pos?.positions))throw Error('Positions unavailable');const result=lifecycle({open,close,dealId,positions:pos.positions});
   const record=save('LIFECYCLE_OBSERVATION',{dealId,openDigest:hash(open),closeDigest:hash(close),positionDigest:hash(pos.positions),...result});r.json({result,record,status:status()});
  }catch(e){r.status(502).json({error:'Read-only IG lifecycle check failed',detail:String(e.message).slice(0,140)});}});
  app.post('/api/v32/recovery/rehearse',requireAdmin,(q,r)=>{try{const result=recoveryDecision(q.body?.journal,q.body?.positions);r.json({result,record:save('OFFLINE_RECOVERY_REHEARSAL',result),status:status()});}catch(e){r.status(400).json({error:e.message});}});
  app.get('/v32',(_q,r)=>r.sendFile(path.join(__dirname,'public','v32.html')));
 }
 return {routes,status};
}
module.exports={createV32,riskWorksheet,lifecycle,recoveryDecision};
