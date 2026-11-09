 'use strict';
// V38 isolated broker-verification workbench. No IG order API access or broker write methods.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const LIMITS=Object.freeze({riskGBP:25,dailyLossGBP:100,maxTradesPerUtcDay:3,stopPips:12,targetPips:18,maxSpreadPips:3});
function verifyChain(rows){let prev='GENESIS';const ids=new Set();for(const row of rows){if(!row||row.previous!==prev||row.digest!==sha({previous:row.previous,event:row.event}))throw Error('V38_CHAIN_INVALID');const e=row.event;if(!e||typeof e.id!=='string'||ids.has(e.id))throw Error('V38_DUPLICATE_OR_INVALID_EVENT');ids.add(e.id);prev=row.digest}return prev}
// Only accepted if broker contract details AND FX conversion are independently supplied and validated.
function verifySizing(x){const reasons=[];
 for(const k of ['stopPips','pipValueQuotePerContract','contractsPerDealUnit','gbpPerQuoteUnit','dealSize','minimumDealSize','dealSizeStep'])if(!finite(x?.[k])||x[k]<=0)reasons.push('INVALID_'+k.toUpperCase());
 if(reasons.length)return {certified:false,reasons,riskGBP:null,brokerOrderAllowed:false};
 const steps=(x.dealSize-x.minimumDealSize)/x.dealSizeStep;
 if(x.dealSize<x.minimumDealSize||Math.abs(steps-Math.round(steps))>1e-7)reasons.push('DEAL_SIZE_STEP_MISMATCH');
 if(x.stopPips!==LIMITS.stopPips)reasons.push('STOP_DISTANCE_MISMATCH');
 const risk=x.stopPips*x.pipValueQuotePerContract*x.contractsPerDealUnit*x.gbpPerQuoteUnit*x.dealSize;
 if(!finite(risk)||risk<=0||risk>LIMITS.riskGBP)reasons.push('RISK_BUDGET_EXCEEDED');
 if(x.verifiedContractSource!==true||x.verifiedFxSource!==true||x.verifiedDealingRules!==true)reasons.push('UNVERIFIED_BROKER_INPUTS');
 return {certified:false,provisionalRiskGBP:finite(risk)?Number(risk.toFixed(4)):null,reasons,brokerOrderAllowed:false,note:'Illustrative sizing calculation only. Independent IG DEMO confirmation and observed broker P/L required for certification.'};
}
function evaluateReadiness({v36={},v37={},v33={},legacyExecutionEnabled=false,brokerEvidence={}}={}){
 const checks={persistentPaperJournal:v36.storageHealthy===true&&v36.persistentStorageConfigured===true&&v36.journal?.valid===true,auditJournal:v37.auditHealthy===true&&v37.storageConfigured===true,marketStatusSeparated:v37.signal?.feed?.verifiedMarketStatus==='TRADEABLE',brokerJournalHealthy:v33.storageHealthy===true&&v33.persistentStorageConfigured===true&&v33.unresolvedIntents===0,brokerSizingCertified:brokerEvidence.sizingCertified===true,brokerLifecycleCertified:brokerEvidence.lifecycleCertified===true,brokerCrashRecoveryCertified:brokerEvidence.crashRecoveryCertified===true,legacyBrokerExecutionDisabled:legacyExecutionEnabled===false};
 const missing=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
 return {checks,missing,readyForUnattendedDemo:false,brokerOrderAllowed:false,phase:'CONTROLLED_VERIFICATION_ONLY',warning:'No IG broker writes are exposed by v38. Certification requires independent broker evidence and explicit later review.'};
}
function assessEvidence(x){const allowed=['CONTRACT_SPEC_CAPTURE','FX_CONVERSION_CAPTURE','BROKER_OPEN_OBSERVATION','BROKER_CONFIRMATION_OBSERVATION','BROKER_CLOSE_OBSERVATION','RESTART_RECOVERY_OBSERVATION','RECONCILIATION_OBSERVATION','PAPER_REPLAY_RESULT'];
 if(!x||!allowed.includes(x.kind))throw Error('UNSUPPORTED_EVIDENCE_KIND');
 if(typeof x.note!=='string'||!x.note.trim()||x.note.length>500)throw Error('INVALID_NOTE');
 if(x.reference!==undefined&&(typeof x.reference!=='string'||x.reference.length>120))throw Error('INVALID_REFERENCE');
 return {kind:x.kind,note:x.note.trim(),reference:x.reference||null};
}
function createV38({requireAdmin,storageDir,persistentStorage,v36Status,v37Status,v33Status,legacyExecutionEnabled=false}){
 const file=path.join(storageDir,'v38-verification-evidence.json');let rows=[],healthy=true,error=null;
 try{if(fs.existsSync(file)){rows=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(rows))throw Error('V38_NOT_ARRAY');verifyChain(rows)}}catch(e){healthy=false;error=e.message}
 function status(){let checks;try{checks=evaluateReadiness({v36:v36Status(),v37:v37Status(),v33:v33Status(),legacyExecutionEnabled})}catch(e){checks={missing:['STATUS_UNAVAILABLE'],error:e.message,readyForUnattendedDemo:false,brokerOrderAllowed:false}}return {version:'38.0.0',mode:'IG_DEMO_VERIFICATION_WORKBENCH',storageHealthy:healthy,persistentStorageConfigured:!!persistentStorage,evidenceEvents:rows.length,evidenceHead:healthy?verifyChain(rows):null,lastEvidence:rows.at(-1)?.event||null,limits:LIMITS,readiness:checks,brokerExecution:'HARD_BLOCKED_IN_V38',brokerOrderAllowed:false,error};}
 function record(payload){if(!healthy||!persistentStorage)throw Error('V38_DURABLE_STORAGE_REQUIRED');const accepted=assessEvidence(payload),event={id:crypto.randomUUID(),at:new Date().toISOString(),...accepted,classification:'OPERATOR_REPORTED_UNVERIFIED'};const previous=rows.at(-1)?.digest||'GENESIS',next=[...rows,{previous,event,digest:sha({previous,event})}],tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const d=fs.openSync(storageDir,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}rows=next;return event}catch(e){healthy=false;error=e.message;throw e}}
 function routes(app){app.get('/api/v38/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v38/evidence',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:rows.slice(-100).map(x=>x.event),total:rows.length,healthy,brokerOrderAllowed:false}));app.post('/api/v38/evidence',requireAdmin,(q,r)=>{try{r.status(201).json({event:record(q.body),brokerOrderAllowed:false})}catch(e){r.status(400).json({error:e.message,brokerOrderAllowed:false})}});app.post('/api/v38/sizing/check',requireAdmin,(q,r)=>r.json(verifySizing(q.body)));app.get('/v38',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v38.html')))}
 return {routes,status,record};
}
module.exports={createV38,verifyChain,verifySizing,evaluateReadiness,assessEvidence,LIMITS};
