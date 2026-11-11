'use strict';
// v89-91: read-only broker evidence, contract rules, reconciliation diagnostics and recovery drills.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const clean=x=>String(x||'').slice(0,80).replace(/[^a-zA-Z0-9_.:-]/g,'_');
function analyseMarket(data){
 const ins=data?.instrument||{},rules=data?.dealingRules||{},snap=data?.snapshot||{};
 const min=rules.minDealSize||{},stop=rules.minNormalStopOrLimitDistance||{};
 const size=finite(min.value)&&min.value>0?min.value:null;
 const stopDistance=finite(stop.value)&&stop.value>0?stop.value:null;
 const currency=typeof ins.currencies?.[0]?.code==='string'?ins.currencies[0].code:null;
 return {epic:ins.epic||null,marketStatus:snap.marketStatus||null,contractSize:finite(ins.contractSize)?ins.contractSize:null,lotSize:finite(ins.lotSize)?ins.lotSize:null,minimumDealSize:size,minimumDealSizeUnit:min.unit||null,minimumStopDistance:stopDistance,minimumStopDistanceUnit:stop.unit||null,quoteCurrency:currency,decimalPlaces:finite(snap.decimalPlacesFactor)?snap.decimalPlacesFactor:null,ruleDataPresent:!!(size&&stopDistance),gbpPipValueCertified:false,dealSizeCertified:false,reason:'IG dealing rules observed, but currency conversion, point value and size units are not independently certified'};
}
function analysePositions(data){const rows=data?.positions;if(!Array.isArray(rows))throw Error('POSITIONS_RESPONSE_INVALID');if(rows.length>200)throw Error('POSITIONS_LIMIT');return {total:rows.length,miniCount:rows.filter(x=>x?.market?.epic===EPIC).length,unexpectedExposure:rows.length>0,positionDetailsOmitted:true,certified:false};}
function analyseAccounts(data){const rows=data?.accounts;if(!Array.isArray(rows))throw Error('ACCOUNTS_RESPONSE_INVALID');return {accountsReturned:rows.length,gbpAccounts:rows.filter(x=>x.currency==='GBP').length,accountIdentifiersOmitted:true,netDailyPnlCertified:false};}
function analyseTransactions(data){const rows=data?.transactions;if(!Array.isArray(rows))throw Error('TRANSACTIONS_RESPONSE_INVALID');return {transactionsReturned:rows.length,completeUkDayCertified:false,feesCertified:false,netDailyPnlCertified:false,reason:'Broker statement completeness, charges and day boundaries require reconciliation'};}
function createV91({requireAdmin,storageDir,readIG,v86,v88}){
 if(typeof readIG!=='function')throw Error('READ_ONLY_IG_READER_REQUIRED');
 const file=path.join(storageDir,'v91-observations.jsonl');let previous='GENESIS',records=0,healthy=true,error=null,last=null,busy=false;
 try{if(fs.existsSync(file)){const raw=fs.readFileSync(file,'utf8');if(raw&&!raw.endsWith('\n'))throw Error('PARTIAL_TAIL');for(const line of raw.split('\n').filter(Boolean)){const e=JSON.parse(line);if(e.previous!==previous||e.hash!==hash({previous:e.previous,payload:e.payload}))throw Error('CHAIN_MISMATCH');previous=e.hash;records++;last=e.payload;}}}catch(e){healthy=false;error=clean(e.message)}
 function status(){const b=v86.status(),a=v88.status();return {version:'91.0.0',releases:['v89_IG_READ_ONLY','v90_CONTRACT_AND_ACCOUNT_OBSERVATIONS','v91_RECOVERY_READINESS'],mode:'READ_ONLY_IG_DEMO_OBSERVATION',ledgerHealthy:healthy,ledgerError:error,records,lastObservation:last,previousAuditHealthy:a.ledgerHealthy===true,paperPaused:b.paperPaused===true,brokerOrderAllowed:false,unattendedOrderAllowed:false,readyForUnattendedDemo:false,certified:false,blockers:b.blockers||[],singleWriterCertified:false,unknownSubmitRecoveryCertified:false,warning:'IG GET observations do not certify execution. No broker write requests or dealing routes in this module.'}}
 function append(payload){if(!healthy)throw Error('LEDGER_UNHEALTHY');const e={previous,payload,hash:hash({previous,payload})};fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(file,'a',0o600);try{fs.writeSync(fd,JSON.stringify(e)+'\n');fs.fsyncSync(fd)}catch(_){healthy=false;error='WRITE_FAILED';throw Error('LEDGER_WRITE_FAILED')}finally{fs.closeSync(fd)}previous=e.hash;records++;last=payload;return e.hash}
 async function capture(){if(busy)throw Error('CAPTURE_IN_PROGRESS');if(!healthy)throw Error('LEDGER_UNHEALTHY');if(v86.status().paperPaused!==true)throw Error('PAPER_NOT_PAUSED');busy=true;
 try{const checks={};const endpoints=[['market','/markets/'+encodeURIComponent(EPIC),'3',analyseMarket],['positions','/positions','2',analysePositions],['accounts','/accounts','1',analyseAccounts]];
 for(const [key,url,version,fn] of endpoints){try{const data=await readIG(url,version);checks[key]={ok:true,observation:fn(data)}}catch(e){checks[key]={ok:false,error:clean(e.message)}}}
 // No transaction fetch by default: IG history endpoints vary by version, paging and date semantics.
 checks.transactions={ok:false,error:'HISTORY_PAGINATION_AND_DATE_RANGE_NOT_CONFIGURED'};
 const payload={at:new Date().toISOString(),checks,brokerOrderAllowed:false,certified:false};const evidenceHash=append(payload);return {recorded:true,evidenceHash,records,checks,brokerOrderAllowed:false,certified:false};
 }finally{busy=false}}
 function routes(app){app.get('/api/v91/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.post('/api/v91/capture',requireAdmin,async(_q,r)=>{try{const result=await capture();r.set('Cache-Control','no-store').json(result)}catch(e){r.status(/CAPTURE_IN_PROGRESS|PAPER_NOT_PAUSED/.test(e.message)?409:503).json({error:clean(e.message),brokerOrderAllowed:false})}});app.get('/api/v91/recovery',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({journalHealthy:healthy,records,localLockNotDistributed:true,brokerSubmitRecoveryCertified:false,singleWriterCertified:false,brokerOrderAllowed:false}));app.post('/api/v91/arm',requireAdmin,(_q,r)=>r.status(409).json({error:'IG_DEMO_EXECUTION_HARD_BLOCKED',brokerOrderAllowed:false}));}
 return {status,capture,routes};
}
module.exports={createV91,analyseMarket,analysePositions,analyseAccounts,analyseTransactions};
