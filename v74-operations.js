'use strict';
// Read-only IG DEMO operational workbench. No dealing callback or write-capable IG client.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const LIMITS=Object.freeze({riskGBP:25,dailyLossGBP:100,maxTradesPerDay:3,maxOpenPositions:1,stopPips:12,targetPips:18,maxSpreadPips:2.5,maxQuoteAgeMs:15000,minSignalScore:70});
const digest=o=>crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
function safeHttpError(e){const m=String(e?.message||'').match(/^(\d{3}):\s*([a-zA-Z0-9._-]+)/);return {kind:m?'HTTP_ERROR':'REQUEST_OR_NETWORK_ERROR',httpStatus:m?Number(m[1]):null,igErrorCode:m?m[2]:null};}
function classifyTransactionResponse(value){if(value&&typeof value==='object'&&!Array.isArray(value)&&Array.isArray(value.transactions))return {ok:true,rows:value.transactions,shape:'transactions-array',keys:Object.keys(value).slice(0,12)};return {ok:false,rows:[],shape:Array.isArray(value)?'top-level-array':value===null?'null':typeof value,keys:value&&typeof value==='object'?Object.keys(value).slice(0,12):[]};}
function summarizeTransactionRows(rows){const types={},currencies=new Set(),dateFields=new Set(),moneyFields=new Set();for(const r of rows.slice(0,100)){if(!r||typeof r!=='object')continue;const type=String(r.transactionType??r.type??'UNSPECIFIED').slice(0,45);types[type]=(types[type]||0)+1;const c=r.currency??r.currencyCode;if(typeof c==='string')currencies.add(c.slice(0,10));for(const k of Object.keys(r)){if(/date|time/i.test(k))dateFields.add(k);if(/profit|loss|amount|cost|cash|balance|pnl/i.test(k))moneyFields.add(k)}}return {rows:rows.length,typesSample:types,currenciesSample:[...currencies],dateFields:[...dateFields],moneyFields:[...moneyFields],completePaginationVerified:false,brokerPnlReconciled:false};}
function readiness({v68,v71,v72,v73,positions,account,transaction,market,journalHealthy}){
 const quote=v68.status().quote||{},stream=v68.status().streamState,signal=v71.status().signal||{},b=[];
 if(!journalHealthy)b.push('V74_JOURNAL_UNHEALTHY');
 if(stream!=='CONNECTED'||quote.epic!==EPIC||quote.source!=='LIGHTSTREAMER'||!(Number.isFinite(quote.ageMs)&&quote.ageMs<=LIMITS.maxQuoteAgeMs))b.push('STREAM_NOT_VERIFIED_FRESH');
 if(String(quote.delay)!=='0'||quote.exchangeTimestampCertified!==true)b.push('UNDELAYED_EXCHANGE_TIME_NOT_CERTIFIED');
 if(quote.marketFlag!=='DEAL')b.push('MARKET_FLAG_NOT_DEAL');
 if(!Number.isFinite(quote.spreadPips)||quote.spreadPips>LIMITS.maxSpreadPips)b.push('SPREAD_OUT_OF_LIMITS_OR_UNKNOWN');
 if(signal.qualifiedBars<30||signal.executionCertified!==true)b.push('RESEARCH_NOT_EXECUTION_CERTIFIED');
 if(!Array.isArray(positions))b.push('BROKER_POSITIONS_NOT_RECONCILED');else if(positions.length)b.push('EXISTING_BROKER_POSITIONS_REQUIRE_REVIEW');
 if(account?.currency!=='GBP'||account?.accountType!=='CFD')b.push('GBP_CFD_ACCOUNT_NOT_VERIFIED');
 if(!market||market.instrument?.epic!==EPIC)b.push('MINI_MARKET_METADATA_NOT_VERIFIED');
 if(!transaction?.ok)b.push('TRANSACTION_HISTORY_NOT_VERIFIED');
 b.push('BROKER_DAILY_PNL_NOT_RECONCILED','GBP_PIP_VALUE_NOT_INDEPENDENTLY_CERTIFIED','DEAL_SIZE_INCREMENT_NOT_CERTIFIED','STOP_PROTECTION_NOT_VERIFIED','REAL_UNKNOWN_SUBMIT_RECOVERY_NOT_TESTED','SUPERVISED_DEMO_LIFECYCLE_NOT_TESTED');
 try{b.push(...v72.prerequisites())}catch{b.push('V72_READINESS_UNAVAILABLE')}
 try{b.push(...v73.status().blockers)}catch{b.push('V73_READINESS_UNAVAILABLE')}
 return [...new Set(b)];
}
function createV74({requireAdmin,storageDir,persistentStorage,v68,v71,v72,v73,readPositions,readAccount,readMarket,readTransactions}){
 const file=path.join(storageDir,'v74-operations.jsonl');let events=[],journalHealthy=!!persistentStorage,journalError=null,lastAudit=null,lastIncident=null,busy=false,timer=null;
 try{if(!journalHealthy)throw Error('PERSISTENT_STORAGE_REQUIRED');fs.mkdirSync(storageDir,{recursive:true});if(fs.existsSync(file)){const raw=fs.readFileSync(file,'utf8');if(raw&&!raw.endsWith('\n'))throw Error('INCOMPLETE_JOURNAL_TAIL');let prev='GENESIS';for(const line of raw.split('\n').filter(Boolean)){const e=JSON.parse(line);if(e.prev!==prev||e.hash!==digest({prev:e.prev,type:e.type,data:e.data}))throw Error('JOURNAL_CHAIN_INVALID');events.push(e);prev=e.hash}}lastAudit=[...events].reverse().find(x=>x.type==='AUDIT')?.data||null;lastIncident=[...events].reverse().find(x=>x.type==='INCIDENT')?.data||null}catch(e){journalHealthy=false;journalError=String(e.message).slice(0,80)}
 function append(type,data){if(!journalHealthy)throw Error('V74_JOURNAL_UNHEALTHY');const prev=events.at(-1)?.hash||'GENESIS',e={prev,type,data,hash:digest({prev,type,data})};try{const fd=fs.openSync(file,'a');try{fs.writeSync(fd,JSON.stringify(e)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}events.push(e)}catch(ex){journalHealthy=false;journalError='JOURNAL_WRITE_FAILED';throw ex}return e}
 async function transactionProbe(){const attempts=[{name:'configured-v73',url:'/history/transactions/ALL',version:'2'},{name:'v2-all-with-window',url:'/history/transactions/ALL/604800000',version:'2'}];const results=[];let accepted=null;
  for(const a of attempts){try{const data=await readTransactions(a.url,a.version);const c=classifyTransactionResponse(data);const result={attempt:a.name,version:a.version,ok:c.ok,responseShape:c.shape,topLevelKeys:c.keys,rows:c.ok?c.rows.length:null};results.push(result);if(c.ok){accepted={ok:true,attempt:a.name,summary:summarizeTransactionRows(c.rows)};break}}catch(e){results.push({attempt:a.name,version:a.version,ok:false,...safeHttpError(e)})}}
  return {ok:!!accepted,attempts:results,accepted,financialLedgerCertified:false,note:'Read-only endpoint probing. A valid response is not proof of complete transaction pagination or GBP P&L.'};
 }
 async function audit(){if(busy)return {skipped:'AUDIT_IN_PROGRESS',brokerOrderAllowed:false};busy=true;try{const failures=[];let positions=null,account=null,market=null,transactions=null;
  try{positions=await readPositions();if(!Array.isArray(positions))throw Error('POSITIONS_SHAPE')}catch(e){failures.push('POSITIONS_READ_FAILED')}
  try{account=await readAccount()}catch(e){failures.push('ACCOUNT_READ_FAILED')}
  try{market=await readMarket()}catch(e){failures.push('MARKET_READ_FAILED')}
  try{transactions=await transactionProbe();if(!transactions.ok)failures.push('TRANSACTIONS_NOT_RETRIEVED')}catch(e){transactions={ok:false,attempts:[],error:safeHttpError(e),financialLedgerCertified:false};failures.push('TRANSACTIONS_PROBE_FAILED')}
  const quote=v68.status().quote||{},signal=v71.status().signal||{};
  const blockers=readiness({v68,v71,v72,v73,positions,account,transaction:transactions,market,journalHealthy});
  const data={version:'74.0.0',at:new Date().toISOString(),epic:EPIC,account:{currency:account?.currency??null,type:account?.accountType??null,balanceAvailable:account?.balance!=null},positions:{readSucceeded:Array.isArray(positions),count:Array.isArray(positions)?positions.length:null},market:{epic:market?.instrument?.epic??null,marketStatus:market?.snapshot?.marketStatus??null,contractSize:market?.instrument?.contractSize??null,valueOfOnePip:market?.instrument?.valueOfOnePip??null,minDealSize:market?.dealingRules?.minDealSize??null},transactions,feed:{state:v68.status().streamState,source:quote.source??null,ageMs:quote.ageMs??null,delay:quote.delay??null,exchangeTimestampCertified:quote.exchangeTimestampCertified===true,spreadPips:quote.spreadPips??null},research:{direction:signal.direction??'WAIT',qualifiedBars:signal.qualifiedBars??0,score:signal.score??null},limits:LIMITS,failures,blockers,brokerDailyPnlGBP:null,dailyLossLimitEnforceable:false,certified:false,brokerOrderAllowed:false,unattendedOrderAllowed:false};
  append('AUDIT',data);lastAudit=data;return data;
 }finally{busy=false}}
 function incident(input){const category=String(input?.category||'').toUpperCase();if(!['DATA_QUALITY','BROKER_API','RESTART','POSITION_MISMATCH','RISK','OTHER'].includes(category))throw Error('INVALID_INCIDENT_CATEGORY');const note=String(input?.note||'').trim().slice(0,240);if(!note)throw Error('INCIDENT_NOTE_REQUIRED');const data={id:crypto.randomUUID(),at:new Date().toISOString(),category,note,operatorRecorded:true,brokerOrderAllowed:false};append('INCIDENT',data);lastIncident=data;return data}
 function status(){const blockers=lastAudit?.blockers||['AUDIT_NOT_RUN'];return {version:'74.0.0',mode:'READ_ONLY_OPERATIONS_CENTRE',journalHealthy,journalError,journalRecords:events.length,auditScheduled:!!timer,lastAuditAt:lastAudit?.at||null,lastIncident,transactionHistoryVerified:!!lastAudit?.transactions?.ok,brokerDailyPnlReconciled:false,limits:LIMITS,blockers,brokerOrderAllowed:false,unattendedOrderAllowed:false}}
 function evidence(){return {version:'74.0.0',journalHealthy,journalError,records:events.length,chainTip:events.at(-1)?.hash||'GENESIS',lastAudit,lastIncident,certification:{transactionApiReachable:!!lastAudit?.transactions?.ok,completeTransactionHistory:false,dailyGbpPnl:false,brokerPositionReconciliation:false,gbpPipSizing:false,streamUndelayed:false,unknownSubmitRecovery:false,supervisedLifecycle:false},brokerOrderAllowed:false}}
 function start(){if(timer)return;timer=setInterval(()=>audit().catch(()=>{}),60000);timer.unref?.()}
 function routes(app){const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req.body||{}))}catch(e){res.status(409).json({error:String(e.message).slice(0,120),brokerOrderAllowed:false})}};
  app.get('/api/v74/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.post('/api/v74/audit',requireAdmin,wrap(audit));
  app.get('/api/v74/evidence',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(evidence()));
  app.post('/api/v74/incident',requireAdmin,wrap(incident));
  app.get('/api/v74/transactions',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(lastAudit?.transactions||{ok:false,reason:'AUDIT_NOT_RUN',brokerOrderAllowed:false}));
  app.post('/api/v74/arm',requireAdmin,(_q,r)=>r.status(409).json({error:'UNATTENDED_IG_BROKER_EXECUTION_HARD_BLOCKED',blockers:status().blockers,brokerOrderAllowed:false}));
  app.get('/v74',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'v74-dashboard.html')));
 }
 return {start,routes,status,audit,evidence,incident,transactionProbe};
}
module.exports={createV74,classifyTransactionResponse,safeHttpError,summarizeTransactionRows,readiness,LIMITS};
