'use strict';
// Combined v62/v63: durable broker readback, risk evidence, recovery drills, certification gates.
// No IG dealing write methods. Never mistake operator assertions for broker verification.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{8,80}$/.test(x);
const numeric=x=>typeof x==='number'&&Number.isFinite(x);
function evaluateRisk({size,stopPips,usdToGbp,pipValueUSD=1,maxRiskGBP=25}){
 const blockers=[];
 if(!numeric(size)||size<=0||size>1)blockers.push('INVALID_SIZE');
 if(!numeric(stopPips)||stopPips<2||stopPips>100)blockers.push('INVALID_STOP_PIPS');
 if(!numeric(usdToGbp)||usdToGbp<=0||usdToGbp>=2)blockers.push('VERIFIED_USDGBP_REQUIRED');
 if(!numeric(pipValueUSD)||pipValueUSD<=0)blockers.push('PIP_VALUE_UNVERIFIED');
 const indicativeRiskGBP=blockers.length?null:Number((size*stopPips*pipValueUSD*usdToGbp).toFixed(4));
 if(indicativeRiskGBP!==null&&indicativeRiskGBP>maxRiskGBP)blockers.push('RISK_LIMIT_EXCEEDED');
 return {blockers,indicativeRiskGBP,certified:false,note:'Arithmetic is indicative only; broker-confirmed contract value, currency conversion, slippage and actual stop attachment still require verification.'};
}
function createCombined({requireAdmin,storageDir,persistentStorage,readBroker,readMarket,v58Status,v59Status,v60Status,v61Status,legacyExecutionEnabled=false}){
 const file=path.join(storageDir,'v62-63-combined.jsonl');const bootId=crypto.randomUUID();let rows=[],healthy=!!persistentStorage,lastError=null;
 try{if(healthy){fs.mkdirSync(storageDir,{recursive:true});let prev='GENESIS';if(fs.existsSync(file))for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.prev!==prev||r.hash!==sha({prev:r.prev,at:r.at,type:r.type,payload:r.payload}))throw Error('JOURNAL_INTEGRITY_FAILURE');rows.push(r);prev=r.hash;}}}catch(e){healthy=false;lastError=e.message;}
 function append(type,payload){if(!healthy)throw Error('JOURNAL_UNHEALTHY');const r={prev:rows.at(-1)?.hash||'GENESIS',at:new Date().toISOString(),type,payload};r.hash=sha(r);try{fs.appendFileSync(file,JSON.stringify(r)+'\n',{flag:'a'});rows.push(r);}catch(e){healthy=false;lastError=e.message;throw e;}return r;}
 const halted=()=>[...rows].reverse().find(x=>x.type==='HALT_SET'||x.type==='HALT_CLEAR')?.type==='HALT_SET';
 const latest=(type)=>[...rows].reverse().find(x=>x.type===type)?.payload||null;
 const drills=()=>rows.filter(x=>x.type==='RECOVERY_DRILL');
 function status(){return {version:'62.63.0',mode:'COMBINED_SUPERVISED_CERTIFICATION_READ_ONLY',bootId,journalHealthy:healthy,lastError,events:rows.length,emergencyHalt:halted(),lastAudit:latest('READINESS_AUDIT'),lastBrokerSnapshot:latest('BROKER_SNAPSHOT'),recoveryDrills:drills().length,legacyExecutionBlocked:!legacyExecutionEnabled,brokerOrderAllowed:false,readyForUnattendedDemo:false,certifications:{gbpSizing:false,brokerLifecycle:false,unknownOrderRecovery:false,unattendedAdapter:false},next:'Broker write adapter remains excluded until supervised IG DEMO lifecycle, monetary risk, and ambiguous-response recovery are independently certified.'};}
 async function snapshot(){if(halted())throw Error('EMERGENCY_HALT_ACTIVE');const [b,m]=await Promise.all([readBroker(),readMarket()]);if(!b||b.currency!=='GBP'||!b.accountFingerprint||!Array.isArray(b.positions))throw Error('GBP_BROKER_READBACK_INVALID');if(m?.instrument?.epic!==EPIC)throw Error('MINI_MARKET_READBACK_INVALID');const payload={at:new Date().toISOString(),accountFingerprint:b.accountFingerprint,currency:b.currency,positions:b.positions.map(p=>({epic:p.epic||null})),market:{epic:m.instrument.epic,contractSize:m.instrument.contractSize??null,valueOfOnePip:m.instrument.valueOfOnePip??null,minDealSize:m.dealingRules?.minDealSize??null,minimumStop:m.dealingRules?.minNormalStopOrLimitDistance??null,marketStatus:m.snapshot?.marketStatus??null},brokerOrderAllowed:false};append('BROKER_SNAPSHOT',payload);return payload;}
 async function audit(){const blockers=[];let b=null,m=null;try{[b,m]=await Promise.all([readBroker(),readMarket()]);}catch(e){blockers.push('BROKER_OR_MARKET_READBACK_FAILED');}
 if(!healthy)blockers.push('JOURNAL_UNHEALTHY');if(halted())blockers.push('EMERGENCY_HALT');if(legacyExecutionEnabled)blockers.push('LEGACY_EXECUTION_NOT_BLOCKED');
 if(!b||b.currency!=='GBP'||!b.accountFingerprint||!Array.isArray(b.positions))blockers.push('GBP_ACCOUNT_UNVERIFIED');else if(b.positions.length)blockers.push('BROKER_POSITIONS_PRESENT');
 if(m?.instrument?.epic!==EPIC||!m?.dealingRules?.minDealSize||!m?.dealingRules?.minNormalStopOrLimitDistance)blockers.push('MINI_DEALING_RULES_UNVERIFIED');
 const p=v58Status(),c=v59Status(),s=v60Status(),r=v61Status();
 if(!p?.journalHealthy||p.monitorArmed||p.entryArmed||p.openPaperPositions!==0)blockers.push('PAPER_ENGINE_NOT_IDLE');
 if(!c?.journalHealthy||!s?.journalHealthy||!r?.journalHealthy)blockers.push('PRIOR_JOURNAL_UNHEALTHY');
 if(s?.unresolvedIntents!==0||r?.unresolvedRehearsals!==0)blockers.push('UNRESOLVED_PRIOR_INTENTS');
 const payload={at:new Date().toISOString(),eligibleForSupervisedCertification:blockers.length===0,blockers,brokerPositions:b?.positions?.length??null,accountFingerprint:b?.accountFingerprint||null,brokerOrderAllowed:false,readyForUnattendedDemo:false,certifications:{gbpSizing:false,brokerLifecycle:false,unknownOrderRecovery:false,unattendedAdapter:false}};
 if(healthy)append('READINESS_AUDIT',payload);return payload;}
 async function recoveryDrill(input){if(!validId(input?.drillId))throw Error('INVALID_DRILL_ID');if(drills().some(x=>x.payload.drillId===input.drillId))throw Error('DUPLICATE_DRILL_ID');const b=await readBroker();if(!b||b.currency!=='GBP'||!Array.isArray(b.positions))throw Error('BROKER_READBACK_FAILED');const payload={drillId:input.drillId,bootId,at:new Date().toISOString(),scenario:'AMBIGUOUS_SUBMISSION_TIMEOUT',brokerPositions:b.positions.length,automaticRetry:false,operatorReviewRequired:true,brokerWriteAttempted:false,passedReadOnlyDrill:true,certifiesActualOrderRecovery:false};append('RECOVERY_DRILL',payload);return payload;}
 function setHalt(input){if(input?.confirmation!=='HALT_DEMO_EXECUTION')throw Error('HALT_CONFIRMATION_REQUIRED');append('HALT_SET',{bootId,at:new Date().toISOString()});return {emergencyHalt:true,brokerOrderAllowed:false,note:'This halts the combined module. The global broker-write block remains independently active.'};}
 function clearHalt(input){if(input?.confirmation!=='CLEAR_HALT_READ_ONLY')throw Error('CLEAR_CONFIRMATION_REQUIRED');append('HALT_CLEAR',{bootId,at:new Date().toISOString()});return {emergencyHalt:false,brokerOrderAllowed:false};}
 function routes(app){const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req.body||{}));}catch(e){res.status(409).json({error:String(e.message||e).slice(0,180),brokerOrderAllowed:false});}};
 app.get('/api/v63/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
 app.get('/api/v63/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({journalHealthy:healthy,events:rows.slice(-100).map(({at,type,payload})=>({at,type,payload}))}));
 app.post('/api/v63/audit',requireAdmin,wrap(audit));app.post('/api/v63/broker-snapshot',requireAdmin,wrap(snapshot));
 app.post('/api/v63/recovery-drill',requireAdmin,wrap(recoveryDrill));app.post('/api/v63/emergency-halt',requireAdmin,wrap(setHalt));app.post('/api/v63/clear-halt',requireAdmin,wrap(clearHalt));
 app.post('/api/v63/risk-preview',requireAdmin,wrap(async p=>evaluateRisk(p)));
 for(const route of ['execute','submit','close','arm','arm-unattended','certify','place-order'])app.post('/api/v63/'+route,requireAdmin,(_q,r)=>r.status(409).json({error:'BROKER_DEALING_ADAPTER_NOT_CERTIFIED',brokerOrderAllowed:false}));
 }
 return {routes,status,audit,snapshot,recoveryDrill};
}
module.exports={createCombined,evaluateRisk};
