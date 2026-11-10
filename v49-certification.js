'use strict';
// V49: broker read-only evidence + deterministic unattended-order simulation.
// No IG order POST/PUT/DELETE is reachable from this module.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const numeric=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const iso=()=>new Date().toISOString();
function assessRisk({market,accountCurrency,fx,incrementEvidence,stopEvidence,lossEvidence,size=0.1,stopPips=12,maxRiskGBP=25,slippagePips=2,feeGBP=0}={}){
 const i=market?.instrument||{},r=market?.dealingRules||{},issues=[];
 if(i.epic!==EPIC)issues.push('MINI_EPIC_NOT_CONFIRMED');
 if(String(i.contractSize)!=='10000'||String(i.onePipMeans)!=='0.0001 USD/EUR')issues.push('CONTRACT_SPEC_MISMATCH');
 const basePip=numeric(i.valueOfOnePip),min=numeric(r.minDealSize?.value),minStop=numeric(r.minNormalStopOrLimitDistance?.value);
 if(basePip===null||basePip<=0)issues.push('PIP_VALUE_MISSING');
 if(min===null||min<=0||size<min)issues.push('MINIMUM_SIZE_FAILED');
 if(minStop===null||minStop<=0||stopPips<minStop)issues.push('STOP_DISTANCE_FAILED');
 if(!Number.isFinite(size)||size<=0||!Number.isFinite(stopPips)||stopPips<=0||!Number.isFinite(maxRiskGBP)||maxRiskGBP<=0||!Number.isFinite(slippagePips)||slippagePips<0||!Number.isFinite(feeGBP)||feeGBP<0)issues.push('INVALID_RISK_PARAMETERS');
 // Min deal size is NOT the increment. Accept only an independently supplied, time-stamped specification.
 const step=numeric(incrementEvidence?.step);
 if(incrementEvidence?.source!=='IG_DEMO_INSTRUMENT_TICKET'||step===null||step<=0||!Number.isFinite(Date.parse(incrementEvidence?.observedAt||'')))issues.push('INCREMENT_EVIDENCE_MISSING');
 else if(Math.abs(size/step-Math.round(size/step))>1e-7)issues.push('INVALID_SIZE_INCREMENT');
 if(stopEvidence?.source!=='IG_DEMO_TICKET'||stopEvidence?.pointEqualsPip!==true||!Number.isFinite(Date.parse(stopEvidence?.observedAt||'')))issues.push('STOP_UNIT_EVIDENCE_MISSING');
 const rate=numeric(fx?.gbpPerUSD);
 if(accountCurrency!=='GBP')issues.push('GBP_ACCOUNT_NOT_CONFIRMED');
 if(fx?.source!=='INDEPENDENT_BROKER_FX_EVIDENCE'||rate===null||rate<=0||!Number.isFinite(Date.parse(fx?.observedAt||'')))issues.push('GBP_CONVERSION_NOT_INDEPENDENTLY_VERIFIED');
 else if(Date.now()-Date.parse(fx.observedAt)>15*60*1000||Date.parse(fx.observedAt)>Date.now()+60000)issues.push('FX_EVIDENCE_STALE');
 if(lossEvidence?.source!=='IG_DEMO_CLOSED_DEAL'||lossEvidence?.epic!==EPIC||!lossEvidence?.dealReference||!Number.isFinite(Date.parse(lossEvidence?.observedAt||'')))issues.push('BROKER_GBP_PNL_CROSSCHECK_MISSING');
 // Operator-supplied observations are evidence candidates, NOT independent certification.
 issues.push('INDEPENDENT_REVIEW_REQUIRED');
 const usd=basePip===null?null:basePip*size*(stopPips+slippagePips);
 const gbp=usd===null||rate===null?null:usd*rate+feeGBP;
 if(gbp!==null&&gbp>maxRiskGBP)issues.push('MAX_RISK_EXCEEDED');
 return {epic:EPIC,size,stopPips,maxRiskGBP,assumedSlippagePips:slippagePips,estimatedUSD:usd,estimatedGBP:gbp,issues:[...new Set(issues)],certified:false,brokerOrderAllowed:false};
}
function simulateOrder(state,command){
 const s=structuredClone(state),events=[];
 const reject=reason=>({state:s,events:[{type:'REJECT',reason}],accepted:false});
 if(command.type==='KILL'){s.kill=true;s.armed=false;events.push({type:'KILL_SWITCH'});return {state:s,events,accepted:true}}
 if(command.type==='RECOVER'){
  if(!command.brokerReadbackConfirmed||command.unresolvedBrokerIntents!==0)return reject('RECONCILIATION_REQUIRED');
  s.unresolved=false;events.push({type:'RECOVERED_READ_ONLY'});return {state:s,events,accepted:true};
 }
 if(command.type!=='PROPOSE')return reject('UNKNOWN_COMMAND');
 if(s.kill||s.unresolved||!s.journalHealthy||!s.brokerReconciled)return reject('SAFETY_GATE');
 if(!command.certified||!command.quoteFresh||!command.protectiveStop||!command.protectiveLimit)return reject('ORDER_PREREQUISITES_MISSING');
 if(command.epic!==EPIC)return reject('WRONG_EPIC');
 if(!command.idempotencyKey||s.seen.includes(command.idempotencyKey))return reject('DUPLICATE_OR_MISSING_KEY');
 if(!Number.isFinite(command.riskGBP)||command.riskGBP<=0||command.riskGBP>25)return reject('TRADE_RISK_LIMIT');
 if(s.trades>=3||s.dailyLossGBP+command.riskGBP>100)return reject('DAILY_LIMIT');
 s.seen.push(command.idempotencyKey);s.unresolved=true;events.push({type:'SIMULATED_INTENT_RECORDED',idempotencyKey:command.idempotencyKey},{type:'SIMULATED_BROKER_WRITE_SUPPRESSED'});
 return {state:s,events,accepted:true,brokerOrderAllowed:false};
}
function createV49({requireAdmin,api,storageDir,persistentStorage,v47Status,v48Status,readBroker}){
 const file=path.join(storageDir,'v49-evidence.jsonl');let rows=[],journalHealthy=!!persistentStorage,lastError=null;
 try{if(persistentStorage){fs.mkdirSync(storageDir,{recursive:true});if(fs.existsSync(file)){const lines=fs.readFileSync(file,'utf8').split('\n').filter(Boolean);let previous='GENESIS';for(const line of lines){const x=JSON.parse(line);if(x.prev!==previous||x.hash!==hash({prev:x.prev,type:x.type,at:x.at,payload:x.payload}))throw Error('JOURNAL_CHAIN_INVALID');rows.push(x);previous=x.hash;}}}}catch(e){journalHealthy=false;lastError=e.message;}
 let lastMarket=null,lastBroker=null,lastRisk=null,lastCheck=null;
 function append(type,payload){if(!journalHealthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_UNAVAILABLE');const at=iso(),prev=rows.at(-1)?.hash||'GENESIS',entry={prev,type,at,payload};entry.hash=hash(entry);try{fs.appendFileSync(file,JSON.stringify(entry)+'\n',{flag:'a'});rows.push(entry);}catch(e){journalHealthy=false;lastError=e.message;throw e;}return entry;}
 function status(){const v47=v47Status(),v48=v48Status();return {version:'49.0.0',mode:'READ_ONLY_CERTIFICATION_AND_EXECUTION_SIMULATION',epic:EPIC,at:iso(),journalHealthy,persistentStorageConfigured:!!persistentStorage,journalEvents:rows.length,journalHead:rows.at(-1)?.hash||null,lastError,lastCheck,marketVerified:lastMarket?.instrument?.epic===EPIC,brokerReadbackAvailable:!!lastBroker,latestRisk:lastRisk,certifications:v47.certifications,v48Issues:v48.issues,workstreams:{gbpRisk:'EVIDENCE_COLLECTION_ONLY',brokerLifecycle:'OBSERVE_ONLY',crashRecovery:'RESTART_RECONCILIATION_REQUIRED',unattendedAdapter:'SIMULATION_ONLY'},readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false};}
 async function inspect(){const [market,broker]=await Promise.all([api('/markets/'+encodeURIComponent(EPIC),'GET',null,'3'),readBroker()]);if(!Array.isArray(broker.positions)||!broker.accountFingerprint)throw Error('BROKER_READBACK_UNVERIFIED');lastMarket=market;lastBroker=broker;lastCheck=iso();append('READ_ONLY_BROKER_SNAPSHOT',{epic:market.instrument?.epic,contractSize:market.instrument?.contractSize,onePipMeans:market.instrument?.onePipMeans,valueOfOnePip:market.instrument?.valueOfOnePip,minDealSize:market.dealingRules?.minDealSize,minStop:market.dealingRules?.minNormalStopOrLimitDistance,accountFingerprint:broker.accountFingerprint,positionCount:broker.positions.length,positions:broker.positions});return status();}
 function routes(app){
  app.get('/api/v49/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.get('/api/v49/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:rows.slice(-40).map(({type,at,hash})=>({type,at,hash})),journalHealthy}));
  app.post('/api/v49/inspect',requireAdmin,async(_q,r)=>{try{r.set('Cache-Control','no-store').json(await inspect())}catch(e){lastError=e.message;r.status(502).json({error:e.message,brokerOrderAllowed:false})}});
  app.post('/api/v49/risk-preview',requireAdmin,async(q,r)=>{try{if(!lastMarket)throw Error('RUN_INSPECT_FIRST');lastRisk=assessRisk({market:lastMarket,...q.body});append('RISK_PREVIEW',{result:lastRisk});r.json(lastRisk)}catch(e){r.status(409).json({error:e.message,brokerOrderAllowed:false})}});
  app.post('/api/v49/simulate',requireAdmin,(q,r)=>{try{const input=q.body||{};const state={kill:false,unresolved:false,journalHealthy,brokerReconciled:false,trades:0,dailyLossGBP:0,seen:[],...input.state};const result=simulateOrder(state,input.command||{});append('SIMULATION',{events:result.events,accepted:result.accepted});r.json({...result,brokerOrderAllowed:false,note:'No IG order request sent'})}catch(e){r.status(409).json({error:e.message,brokerOrderAllowed:false})}});
  app.post('/api/v49/arm-unattended',requireAdmin,(_q,r)=>r.status(409).json({error:'INDEPENDENT_CERTIFICATIONS_AND_WRITE_ADAPTER_REQUIRED',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false}));
 }
 return {routes,status,inspect};
}
module.exports={EPIC,assessRisk,simulateOrder,createV49};
