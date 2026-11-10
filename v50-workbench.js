'use strict';
// IG DEMO Mini evidence workbench. No broker order-write function is accepted.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const now=()=>new Date().toISOString();
const num=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const validTime=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const safeId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{5,100}$/.test(x);
function riskPreview({market,account,fx,increment,stopUnits,brokerPnL,size=0.1,stopPips=12,slippagePips=2,feeGBP=0,maxRiskGBP=25}={}){
 const issues=[],i=market?.instrument||{},rules=market?.dealingRules||{};
 const pv=num(i.valueOfOnePip),min=num(rules.minDealSize?.value),minStop=num(rules.minNormalStopOrLimitDistance?.value),step=num(increment?.step),rate=num(fx?.gbpPerUSD);
 if(i.epic!==EPIC||String(i.contractSize)!=='10000'||i.onePipMeans!=='0.0001 USD/EUR')issues.push('MINI_CONTRACT_NOT_VERIFIED');
 if(pv===null||pv<=0||min===null||min<=0||minStop===null||minStop<=0)issues.push('DEALING_RULES_UNAVAILABLE');
 if(![size,stopPips,slippagePips,feeGBP,maxRiskGBP].every(Number.isFinite)||size<=0||stopPips<=0||slippagePips<0||feeGBP<0||maxRiskGBP<=0)issues.push('INVALID_INPUT');
 if(min!==null&&size<min)issues.push('BELOW_MIN_SIZE');if(minStop!==null&&stopPips<minStop)issues.push('BELOW_MIN_STOP');
 if(increment?.source!=='IG_DEMO_TICKET'||!validTime(increment?.observedAt)||step===null||step<=0)issues.push('INCREMENT_NOT_EVIDENCED');
 else if(Math.abs(size/step-Math.round(size/step))>1e-7)issues.push('INVALID_INCREMENT');
 if(stopUnits?.source!=='IG_DEMO_TICKET'||stopUnits?.pointEqualsPip!==true||!validTime(stopUnits?.observedAt))issues.push('STOP_UNITS_NOT_EVIDENCED');
 if(account?.currency!=='GBP'||account?.source!=='IG_DEMO_ACCOUNT_READBACK')issues.push('ACCOUNT_GBP_NOT_VERIFIED');
 if(fx?.source!=='INDEPENDENT_FX_SOURCE'||rate===null||rate<=0||!validTime(fx?.observedAt))issues.push('FX_NOT_VERIFIED');
 else if(Math.abs(Date.now()-Date.parse(fx.observedAt))>15*60*1000)issues.push('FX_STALE');
 if(brokerPnL?.source!=='IG_DEMO_TRANSACTION_HISTORY'||brokerPnL?.epic!==EPIC||!safeId(brokerPnL?.dealId)||!validTime(brokerPnL?.observedAt)||num(brokerPnL?.realizedGBP)===null)issues.push('BROKER_GBP_PNL_NOT_VERIFIED');
 const estimatedUSD=pv===null||!Number.isFinite(size)||!Number.isFinite(stopPips)||!Number.isFinite(slippagePips)?null:pv*size*(stopPips+slippagePips);
 const estimatedGBP=estimatedUSD===null||rate===null||!Number.isFinite(feeGBP)?null:estimatedUSD*rate+feeGBP;
 if(estimatedGBP!==null&&estimatedGBP>maxRiskGBP)issues.push('RISK_LIMIT_EXCEEDED');
 issues.push('INDEPENDENT_CERTIFICATION_PENDING');
 return {epic:EPIC,size,stopPips,slippagePips,estimatedUSD,estimatedGBP,maxRiskGBP,issues,certified:false,brokerOrderAllowed:false};
}
function simulate(state,order){
 const s=structuredClone(state);const reject=reason=>({accepted:false,reason,state:s,brokerOrderAllowed:false});
 if(order?.type==='KILL'){s.killed=true;s.armed=false;return {accepted:true,event:'SIMULATED_KILL',state:s,brokerOrderAllowed:false}}
 if(order?.type!=='PROPOSE')return reject('INVALID_COMMAND');
 if(s.killed||s.unresolved||!s.journalHealthy||!s.brokerReconciled)return reject('SAFETY_BLOCK');
 if(order.epic!==EPIC||!safeId(order.idempotencyKey))return reject('INVALID_EPIC_OR_KEY');
 if(s.seen.includes(order.idempotencyKey))return reject('DUPLICATE');
 if(order.quoteFresh!==true||order.protectiveStop!==true||order.protectiveLimit!==true||order.certified!==true)return reject('PREREQUISITES');
 if(!Number.isFinite(order.riskGBP)||order.riskGBP<=0||order.riskGBP>25)return reject('PER_TRADE_LIMIT');
 if(s.trades>=3||s.dailyLossGBP+order.riskGBP>100)return reject('DAILY_LIMIT');
 s.seen.push(order.idempotencyKey);s.unresolved=true;
 return {accepted:true,event:'SIMULATED_INTENT_ONLY',state:s,brokerOrderAllowed:false};
}
function createV50({requireAdmin,api,storageDir,persistentStorage,readBroker,v49Status}){
 const file=path.join(storageDir,'v50-journal.jsonl'),bootId=crypto.randomUUID();let rows=[],healthy=!!persistentStorage,lastError=null,latest=null;
 try{if(healthy){fs.mkdirSync(storageDir,{recursive:true});if(fs.existsSync(file)){let prev='GENESIS';for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.prev!==prev||r.hash!==hash({prev:r.prev,at:r.at,type:r.type,payload:r.payload}))throw Error('JOURNAL_INTEGRITY_FAILED');rows.push(r);prev=r.hash;}}}}catch(e){healthy=false;lastError=e.message;}
 const last=type=>[...rows].reverse().find(r=>r.type===type);
 const killed=()=>!!last('EMERGENCY_STOP') && (!last('RESET_SIMULATION')||rows.indexOf(last('EMERGENCY_STOP'))>rows.indexOf(last('RESET_SIMULATION')));
 function append(type,payload){if(!healthy)throw Error('PERSISTENT_JOURNAL_REQUIRED');const entry={prev:rows.at(-1)?.hash||'GENESIS',at:now(),type,payload};entry.hash=hash(entry);try{fs.appendFileSync(file,JSON.stringify(entry)+'\n');rows.push(entry);}catch(e){healthy=false;lastError=e.message;throw e;}return entry;}
 const activeMini=b=>b.positions.filter(p=>p.epic===EPIC);
 function summary(){const v49=v49Status(),prior=last('BROKER_READBACK'),opens=rows.filter(r=>r.type==='OPEN_OBSERVATION'),closes=rows.filter(r=>r.type==='CLOSE_OBSERVATION'),restart=last('RESTART_READBACK');const risk=last('RISK_EVIDENCE');return {version:'50.0.0',mode:'MINI_CERTIFICATION_AND_FAIL_CLOSED_SIMULATION',epic:EPIC,bootId,journalHealthy:healthy,persistentStorageConfigured:!!persistentStorage,journalEvents:rows.length,lastError,lastInspectionAt:prior?.at||null,accountCurrency:prior?.payload?.accountCurrency||null,marketVerified:prior?.payload?.marketEpic===EPIC,openObservations:opens.length,closeObservations:closes.length,restartReadbackObserved:!!restart,emergencyStop:killed(),latestRisk:risk?.payload?.preview||null,certifications:{gbpSizing:{certified:false,issues:risk?.payload?.preview?.issues||['RISK_EVIDENCE_REQUIRED']},brokerLifecycle:{certified:false,issues:['INDEPENDENT_BROKER_OPEN_CLOSE_CONFIRMATIONS_REQUIRED']},crashRecovery:{certified:false,issues:['IN_FLIGHT_INTENT_AND_POSITION_RECOVERY_NOT_CERTIFIED']},unattendedAdapter:{certified:false,issues:['BROKER_WRITE_ADAPTER_NOT_IMPLEMENTED','INDEPENDENT_TESTS_REQUIRED']}},v49BrokerOrderAllowed:!!v49.brokerOrderAllowed,readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false};}
 async function snapshot(){const [market,broker]=await Promise.all([api('/markets/'+encodeURIComponent(EPIC),'GET',null,'3'),readBroker()]);if(market?.instrument?.epic!==EPIC||!Array.isArray(broker?.positions)||!broker?.accountFingerprint)throw Error('BROKER_SNAPSHOT_INVALID');return {market,broker};}
 async function inspect(){const {market,broker}=await snapshot();latest={market,broker};append('BROKER_READBACK',{bootId,marketEpic:market.instrument.epic,accountFingerprint:broker.accountFingerprint,accountCurrency:broker.accountCurrency||null,positions:activeMini(broker),positionCount:broker.positions.length,contractSize:market.instrument.contractSize,valueOfOnePip:market.instrument.valueOfOnePip,minDealSize:market.dealingRules?.minDealSize,minStop:market.dealingRules?.minNormalStopOrLimitDistance});return summary();}
 async function observe(type,dealId){if(!safeId(dealId))throw Error('VALID_DEAL_ID_REQUIRED');const {broker}=await snapshot();const found=activeMini(broker).find(p=>p.dealId===dealId);const base=last('BROKER_READBACK');if(!base||base.payload.accountFingerprint!==broker.accountFingerprint)throw Error('ACCOUNT_BASELINE_REQUIRED');if(type==='OPEN_OBSERVATION'&&(!found||!Number.isFinite(Number(found.size))||Number(found.size)<=0||found.stopLevel==null||found.limitLevel==null))throw Error('OPEN_POSITION_WITH_PROTECTION_REQUIRED');if(type==='CLOSE_OBSERVATION'&&(found||!rows.some(r=>r.type==='OPEN_OBSERVATION'&&r.payload.dealId===dealId)))throw Error('OPEN_EVIDENCE_AND_ABSENT_POSITION_REQUIRED');append(type,{bootId,dealId,accountFingerprint:broker.accountFingerprint,position:found||null,note:'Readback only; closing absence is not a broker fill confirmation'});return summary();}
 async function restartCheck(dealId){if(!safeId(dealId))throw Error('VALID_DEAL_ID_REQUIRED');const previous=[...rows].reverse().find(r=>r.type==='OPEN_OBSERVATION'&&r.payload.dealId===dealId&&r.payload.bootId!==bootId);if(!previous)throw Error('PRIOR_BOOT_OPEN_OBSERVATION_REQUIRED');const {broker}=await snapshot();const found=activeMini(broker).find(p=>p.dealId===dealId);if(!found||broker.accountFingerprint!==previous.payload.accountFingerprint||Number(found.size)!==Number(previous.payload.position.size)||found.direction!==previous.payload.position.direction)throw Error('RESTART_POSITION_MISMATCH');append('RESTART_READBACK',{bootId,dealId,previousBootId:previous.payload.bootId,accountFingerprint:broker.accountFingerprint,position:found});return summary();}
 function routes(app){const sendError=(r,e)=>r.status(409).json({error:e.message,brokerOrderAllowed:false});
 app.get('/api/v50/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(summary()));
 app.get('/api/v50/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:rows.slice(-100).map(x=>({at:x.at,type:x.type,hash:x.hash})),journalHealthy:healthy}));
 app.post('/api/v50/inspect',requireAdmin,async(_q,r)=>{try{r.json(await inspect())}catch(e){sendError(r,e)}});
 app.post('/api/v50/risk-preview',requireAdmin,async(q,r)=>{try{const {market,broker}=await snapshot();const body=q.body||{};const account={currency:broker.accountCurrency,source:'IG_DEMO_ACCOUNT_READBACK'};const preview=riskPreview({market,account,...body});append('RISK_EVIDENCE',{preview,accountFingerprint:broker.accountFingerprint});r.json(preview)}catch(e){sendError(r,e)}});
 app.post('/api/v50/observe-open',requireAdmin,async(q,r)=>{try{r.json(await observe('OPEN_OBSERVATION',q.body?.dealId))}catch(e){sendError(r,e)}});
 app.post('/api/v50/observe-close',requireAdmin,async(q,r)=>{try{r.json(await observe('CLOSE_OBSERVATION',q.body?.dealId))}catch(e){sendError(r,e)}});
 app.post('/api/v50/reconcile-after-restart',requireAdmin,async(q,r)=>{try{r.json(await restartCheck(q.body?.dealId))}catch(e){sendError(r,e)}});
 app.post('/api/v50/emergency-stop',requireAdmin,(q,r)=>{try{if(q.body?.confirm!=='STOP_V50_SIMULATION')throw Error('CONFIRMATION_REQUIRED');append('EMERGENCY_STOP',{bootId});r.json(summary())}catch(e){sendError(r,e)}});
 app.post('/api/v50/simulate',requireAdmin,(q,r)=>{try{const state={killed:killed(),unresolved:false,journalHealthy:healthy,brokerReconciled:false,trades:0,dailyLossGBP:0,seen:[],...(q.body?.state||{})};state.killed=killed()||state.killed;state.journalHealthy=healthy&&state.journalHealthy;const result=simulate(state,q.body?.order||{});append('SIMULATION',{accepted:result.accepted,reason:result.reason||null,event:result.event||null});r.json(result)}catch(e){sendError(r,e)}});
 app.post('/api/v50/arm-unattended',requireAdmin,(_q,r)=>r.status(409).json({error:'MINI_CERTIFICATION_AND_BROKER_ADAPTER_NOT_COMPLETE',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false}));
 app.get('/v50',(_q,r)=>r.sendFile(path.join(__dirname,'public','v50.html')));
 }
 return {routes,summary,inspect};
}
module.exports={EPIC,riskPreview,simulate,createV50};
