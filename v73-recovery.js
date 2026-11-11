'use strict';
// v73 is strictly read-only with respect to IG. No broker-write dependency exists.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const safeError=e=>String(e?.message||e).slice(0,160);
function createV73({requireAdmin,storageDir,persistentStorage,v68,v71,v72,readPositions,readAccount,readMarket,readTransactions}){
 const file=path.join(storageDir,'v73-recovery.jsonl');let events=[],healthy=!!persistentStorage,error=null,timer=null,busy=false,lastAudit=null;
 try{if(!healthy)throw Error('PERSISTENT_STORAGE_REQUIRED');fs.mkdirSync(storageDir,{recursive:true});if(fs.existsSync(file)){const raw=fs.readFileSync(file,'utf8');if(raw&&!raw.endsWith('\n'))throw Error('PARTIAL_JOURNAL_TAIL');let prev='GENESIS';for(const line of raw.split('\n').filter(Boolean)){const e=JSON.parse(line);if(e.prev!==prev||e.hash!==hash({prev:e.prev,type:e.type,data:e.data}))throw Error('HASH_CHAIN_INVALID');events.push(e);prev=e.hash}}}catch(e){healthy=false;error=safeError(e)}
 function append(type,data){if(!healthy)throw Error('JOURNAL_UNHEALTHY');const prev=events.at(-1)?.hash||'GENESIS';const e={prev,type,data,hash:hash({prev,type,data})};try{const fd=fs.openSync(file,'a');try{fs.writeSync(fd,JSON.stringify(e)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}events.push(e);return e}catch(ex){healthy=false;error=safeError(ex);throw ex}}
 function unresolved(){const intents=new Map();for(const e of events){if(e.type==='DRY_RUN_INTENT')intents.set(e.data.id,e.data);if(e.type==='DRY_RUN_RESOLVED')intents.delete(e.data.id)}return [...intents.values()]}
 function blockers(){const b=[...v72.prerequisites()];if(!healthy)b.push('V73_JOURNAL_UNHEALTHY');if(unresolved().length)b.push('UNRESOLVED_SIMULATED_INTENT');b.push('IG_DEMO_ACCOUNT_NOT_INDEPENDENTLY_PROVEN','BROKER_PNL_NOT_RECONCILED','REAL_BROKER_UNKNOWN_SUBMIT_RECOVERY_NOT_TESTED','SUPERVISED_DEMO_LIFECYCLE_NOT_TESTED');return [...new Set(b)]}
 async function audit(){if(busy)return {skipped:'AUDIT_BUSY',brokerOrderAllowed:false};busy=true;try{
 const failures=[];let positions=null,account=null,market=null,transactions=null;
 try{positions=await readPositions();if(!Array.isArray(positions))throw Error('INVALID_POSITIONS')}catch(e){failures.push('POSITIONS_READ_FAILED');}
 try{account=await readAccount();if(account?.currency!=='GBP')failures.push('ACCOUNT_NOT_GBP')}catch(e){failures.push('ACCOUNT_READ_FAILED')}
 try{market=await readMarket();if(market?.instrument?.epic!==EPIC)failures.push('MARKET_EPIC_MISMATCH')}catch(e){failures.push('MARKET_READ_FAILED')}
 try{transactions=await readTransactions();if(!transactions||!Array.isArray(transactions.transactions))throw Error('TRANSACTIONS_SHAPE_UNEXPECTED')}catch(e){failures.push('TRANSACTIONS_UNAVAILABLE_OR_UNRECOGNISED')}
 const instrument=market?.instrument||{},rules=market?.dealingRules||{};
 const metadata={epic:instrument.epic??null,contractSize:instrument.contractSize??null,lotSize:instrument.lotSize??null,currencies:instrument.currencies??null,onePipMeans:instrument.onePipMeans??null,valueOfOnePip:instrument.valueOfOnePip??null,minDealSize:rules.minDealSize??null,minNormalStopOrLimitDistance:rules.minNormalStopOrLimitDistance??null,marketStatus:market?.snapshot?.marketStatus??null};
 const q=v68.status().quote||{};const research=v71.status();const data={at:new Date().toISOString(),accountCurrency:account?.currency??null,accountType:account?.accountType??null,positionsCount:Array.isArray(positions)?positions.length:null,positionsPresent:Array.isArray(positions)?positions.length>0:null,transactionRows:Array.isArray(transactions?.transactions)?transactions.transactions.length:null,transactionsReturned:!!transactions,metadata,quote:{streamState:v68.status().streamState,epic:q.epic??null,ageMs:q.ageMs??null,delay:q.delay??null},research:{qualifiedBars:research.signal?.qualifiedBars??0,signal:research.signal?.direction??'WAIT'},unresolvedSimulatedIntents:unresolved().length,failures,blockers:[...new Set([...blockers(),...failures,...(Array.isArray(positions)&&positions.length?['EXISTING_BROKER_POSITION']:[])])],brokerOrderAllowed:false,unattendedOrderAllowed:false,certified:false};lastAudit=data;append('AUDIT',data);return data
 }finally{busy=false}}
 function createIntent(input){if(!healthy)throw Error('JOURNAL_UNHEALTHY');if(unresolved().length)throw Error('UNRESOLVED_INTENT_REQUIRES_REVIEW');if(!['BUY','SELL'].includes(input?.direction))throw Error('DIRECTION_MUST_BE_BUY_OR_SELL');if(input?.confirm!=='DRY_RUN_NO_BROKER_ORDER')throw Error('EXPLICIT_DRY_RUN_CONFIRMATION_REQUIRED');const id=crypto.randomUUID();const data={id,at:new Date().toISOString(),epic:EPIC,direction:input.direction,state:'SIMULATED_UNRESOLVED',brokerSubmitted:false,dealReference:null};append('DRY_RUN_INTENT',data);return {intent:data,brokerOrderAllowed:false,note:'No IG order was submitted. This exercises local durable intent tracking only.'}}
 function resolveIntent(input){if(input?.confirm!=='RESOLVE_DRY_RUN_ONLY')throw Error('EXPLICIT_RESOLUTION_REQUIRED');const item=unresolved().find(x=>x.id===input?.id);if(!item)throw Error('UNKNOWN_INTENT');const data={id:item.id,at:new Date().toISOString(),reason:'OPERATOR_CLOSED_SIMULATION_ONLY',brokerReconciliationCertified:false};append('DRY_RUN_RESOLVED',data);return {resolved:data,brokerOrderAllowed:false}}
 function status(){return {version:'73.0.0',mode:'BROKER_RECOVERY_WORKBENCH_READ_ONLY',auditScheduled:!!timer,journalHealthy:healthy,journalError:error,journalRecords:events.length,unresolvedSimulatedIntents:unresolved(),lastAudit:lastAudit||[...events].reverse().find(e=>e.type==='AUDIT')?.data||null,blockers:blockers(),certifications:{contractGbpPipValue:false,dealSizeIncrement:false,streamDelay:false,igDemoEnvironment:false,brokerDailyPnl:false,supervisedLifecycle:false,realUnknownSubmitRecovery:false},brokerOrderAllowed:false,unattendedOrderAllowed:false}}
 function start(){if(timer)return;timer=setInterval(()=>{audit().catch(e=>{error=safeError(e)})},60000);timer.unref?.()}
 function routes(app){const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req.body||{}))}catch(e){res.status(409).json({error:safeError(e),brokerOrderAllowed:false})}};
 app.get('/api/v73/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
 app.post('/api/v73/audit',requireAdmin,wrap(audit));
 app.post('/api/v73/dry-run-intent',requireAdmin,wrap(createIntent));
 app.post('/api/v73/resolve-dry-run',requireAdmin,wrap(resolveIntent));
 app.get('/api/v73/recovery',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({journalHealthy:healthy,unresolvedSimulatedIntents:unresolved(),brokerUnknownSubmitRecoveryCertified:false,brokerOrderAllowed:false}));
 app.post('/api/v73/arm-unattended',requireAdmin,(_q,r)=>r.status(409).json({error:'UNATTENDED_BROKER_EXECUTION_HARD_BLOCKED',blockers:blockers(),brokerOrderAllowed:false}));
 }
 return {start,routes,status,audit,createIntent,resolveIntent};
}
module.exports={createV73};
