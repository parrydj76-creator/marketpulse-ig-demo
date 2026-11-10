'use strict';
// V59: IG DEMO read-only certification workbench. NO dealing POST/PUT/DELETE.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function assess({account,positions,market,v58,legacyExecutionEnabled=false}){
 const reasons=[];
 if(legacyExecutionEnabled)reasons.push('LEGACY_EXECUTION_CONFIG_ENABLED_DISABLE_IT');
 if(!account||account.currency!=='GBP'||!account.accountFingerprint)reasons.push('GBP_ACCOUNT_UNVERIFIED');
 if(!Array.isArray(positions))reasons.push('BROKER_POSITIONS_UNAVAILABLE');
 else if(positions.some(p=>p.epic===EPIC))reasons.push('EXISTING_MINI_BROKER_POSITION');
 if(!v58||v58.journalHealthy!==true)reasons.push('PAPER_JOURNAL_UNHEALTHY');
 if(v58&&(v58.monitorArmed||v58.entryArmed))reasons.push('PAPER_ENGINE_ARMED');
 if(!market||market.instrument?.epic!==EPIC)reasons.push('MINI_MARKET_METADATA_UNVERIFIED');
 const contractSize=Number(market?.instrument?.contractSize);
 const pipValue=market?.instrument?.valueOfOnePip;
 const minDeal=market?.dealingRules?.minDealSize;
 const stopRule=market?.dealingRules?.minNormalStopOrLimitDistance;
 const marketMetadata={epic:market?.instrument?.epic||null,contractSize:Number.isFinite(contractSize)?contractSize:null,valueOfOnePip:pipValue??null,minDealSize:minDeal??null,minNormalStopOrLimitDistance:stopRule??null,marketStatus:market?.snapshot?.marketStatus??null};
 if(!Number.isFinite(contractSize)||contractSize<=0||!pipValue||!minDeal||!stopRule)reasons.push('DEALING_RULES_INCOMPLETE');
 // Metadata is evidence, not proof of monetary risk or executable stop sizing.
 return {eligibleForSupervisedCertification:reasons.length===0,blockers:reasons,marketMetadata,certifications:{gbpSizing:false,brokerLifecycle:false,unknownOrderRecovery:false,unattendedAdapter:false},brokerOrderAllowed:false,readyForUnattendedDemo:false};
}
function createV59({requireAdmin,storageDir,persistentStorage,readBroker,readMarket,v58Status,legacyExecutionEnabled=false}){
 const file=path.join(storageDir,'v59-certification.jsonl');let rows=[],healthy=!!persistentStorage,error=null;
 try{if(healthy){fs.mkdirSync(storageDir,{recursive:true});let prev='GENESIS';if(fs.existsSync(file))for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.prev!==prev||r.hash!==sha({prev:r.prev,at:r.at,type:r.type,payload:r.payload}))throw Error('V59_JOURNAL_TAMPERED');rows.push(r);prev=r.hash}}}catch(e){healthy=false;error=e.message}
 function append(type,payload){if(!healthy)throw Error('V59_STORAGE_UNHEALTHY');const r={prev:rows.at(-1)?.hash||'GENESIS',at:new Date().toISOString(),type,payload};r.hash=sha(r);try{fs.appendFileSync(file,JSON.stringify(r)+'\n');rows.push(r)}catch(e){healthy=false;error=e.message;throw e}return r}
 function status(){return {version:'59.0.0',mode:'IG_DEMO_READ_ONLY_CERTIFICATION',journalHealthy:healthy,lastError:error,checksRecorded:rows.length,lastCheck:rows.at(-1)?.payload||null,legacyExecutionEnabled,brokerExecution:'HARD_BLOCKED_IN_V59',brokerOrderAllowed:false,readyForUnattendedDemo:false,certifications:{gbpSizing:false,brokerLifecycle:false,unknownOrderRecovery:false,unattendedAdapter:false},next:'Supervised broker lifecycle evidence and verified GBP risk are required before any unattended IG DEMO dealing.'}}
 async function inspect(){if(!healthy)throw Error('V59_STORAGE_UNHEALTHY');const [broker,market]=await Promise.all([readBroker(),readMarket()]);const result=assess({account:broker,positions:broker.positions,market,v58:v58Status(),legacyExecutionEnabled});const payload={at:new Date().toISOString(),...result,accountCurrency:broker.currency||null,accountFingerprint:broker.accountFingerprint||null,positionCount:broker.positions?.length??null};append('READ_ONLY_CHECK',payload);return {...payload,mode:'READ_ONLY',brokerOrderAllowed:false}}
 function routes(app){app.get('/api/v59/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v59/evidence',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({journalHealthy:healthy,checks:rows.slice(-50).map(x=>({at:x.at,type:x.type,payload:x.payload}))}));app.post('/api/v59/check',requireAdmin,async(_q,r)=>{try{r.set('Cache-Control','no-store').json(await inspect())}catch(e){r.status(409).json({error:String(e.message||e).slice(0,160),brokerOrderAllowed:false})}});for(const route of ['arm','execute','place-order','arm-unattended','certify'])app.post('/api/v59/'+route,requireAdmin,(_q,r)=>r.status(409).json({error:'V59_READ_ONLY_BROKER_EXECUTION_NOT_CERTIFIED',brokerOrderAllowed:false}));app.get('/v59',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v59.html')))}
 return {routes,status,inspect};
}
module.exports={createV59,assess};
