'use strict';
// V77: read-only certification evidence. NEVER supplies a dealing callback.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP', DAY_MS=86400000;
const digest=o=>crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const ukDay=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(d).split('/').join('-');
function parseMoney(v){if(typeof v==='number'&&Number.isFinite(v))return v;if(typeof v!=='string')return null;let s=v.trim();if(!s||!/^[+\-]?[£$€]?\s*[\d,]+(?:\.\d+)?\s*(?:GBP|USD|EUR|£|\$|€)?$/i.test(s))return null;s=s.replace(/GBP|USD|EUR|[£$€,\s]/gi,'');const n=Number(s);return Number.isFinite(n)?n:null;}
function classifyLedger(rows,now=new Date()){
 const today=ukDay(now),issues=[],samples=[],seen=new Set();let gross=0,parsed=0,invalid=0,duplicates=0,unassigned=0;
 for(const r of rows){if(!r||typeof r!=='object'){invalid++;continue}const ref=String(r.reference||'').trim();if(ref){if(seen.has(ref)){duplicates++;continue}seen.add(ref)}
 const currency=String(r.currency||'').trim().toUpperCase();if(!['£','GBP'].includes(currency)){unassigned++;issues.push('NON_GBP_OR_MISSING_CURRENCY');continue}
 const rawDate=r.date;let dt=null;
 if(typeof rawDate==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:?\d\d)$/.test(rawDate))dt=new Date(rawDate);
 else {issues.push('TRANSACTION_DATE_TIMEZONE_UNVERIFIED');invalid++;continue}
 if(!Number.isFinite(dt.getTime())){invalid++;continue}
 const pnl=parseMoney(r.profitAndLoss);if(pnl===null){invalid++;issues.push('P_AND_L_UNPARSEABLE');continue}
 if(ukDay(dt)===today){gross+=pnl;parsed++;samples.push({referenceHash:ref?crypto.createHash('sha256').update(ref).digest('hex').slice(0,12):null,pnlGBP:pnl,type:String(r.transactionType||'').slice(0,30)})}
 }
 if(duplicates)issues.push('DUPLICATE_REFERENCES');if(invalid)issues.push('UNVERIFIED_ROWS');if(unassigned)issues.push('UNASSIGNED_CURRENCY');issues.push('FEES_AND_FINANCING_NOT_RECONCILED','HISTORY_COMPLETENESS_NOT_CERTIFIED','BROKER_ACCOUNT_BALANCE_NOT_RECONCILED');
 return {ukDay:today,rowsReceived:rows.length,todayParsed:parsed,invalidRows:invalid,duplicateReferences:duplicates,unassignedCurrencyRows:unassigned,observedTodayGrossPnlGBP:Math.round(gross*100)/100,netDailyPnlGBP:null,certified:false,issues:[...new Set(issues)],sample:samples.slice(0,8)};
}
function pipStudy(market){const i=market?.instrument||{},rules=market?.dealingRules||{},size=rules.minDealSize;return {epic:i.epic||null,contractSize:i.contractSize??null,onePipMeans:i.onePipMeans??null,valueOfOnePip:i.valueOfOnePip??null,minimumDealSize:size??null,stopDistance:rules.minNormalStopOrLimitDistance??null,proposedRiskGBP:25,stopPips:12,illustrativeMaximumGBPPerPip:25/12,certifiedGBPPerPip:null,certifiedDealSize:null,certified:false,blockers:['GBP_CONVERSION_NOT_VERIFIED','DEAL_SIZE_UNIT_AND_INCREMENT_NOT_VERIFIED','BROKER_FILL_PNL_CROSSCHECK_REQUIRED']};}
function feedStudy(state,now=Date.now()){const q=state?.quote||{},received=Date.parse(q.receivedAt||''),ig=Number(q.igTimestamp);const diff=Number.isFinite(ig)&&Number.isFinite(received)?received-ig:null;return {state:state?.streamState||null,quoteAgeMs:q.ageMs??null,receiptMinusIgTimestampMs:diff,igTimestampPresent:Number.isFinite(ig),marketFlag:q.marketFlag??null,delay:q.delay??null,exchangeTimestampCertified:q.exchangeTimestampCertified===true,undelayedCertified:false,blockers:[...new Set([...(q.delay===null||q.delay===undefined?['DELAY_FIELD_UNKNOWN']:[]),...(q.exchangeTimestampCertified!==true?['EXCHANGE_TIMESTAMP_NOT_CERTIFIED']:[]),'INDEPENDENT_FEED_ENTITLEMENT_VERIFICATION_REQUIRED'])]};}
function lifecycleStudy(positions){return {positionsRead:Array.isArray(positions),openPositions:Array.isArray(positions)?positions.length:null,supervisedOpenStopCloseCertified:false,stopAttachedCertified:false,unknownSubmitRecoveryCertified:false,brokerWriteAccess:false,requiredEvidence:['SUPERVISED_DEMO_OPEN_CONFIRMATION','BROKER_ACKNOWLEDGED_PROTECTIVE_STOP','SUPERVISED_DEMO_CLOSE_CONFIRMATION','UNKNOWN_SUBMIT_RESTART_RECONCILIATION','DUPLICATE_PREVENTION_TEST']};}
function createV77({requireAdmin,storageDir,persistentStorage,v68,v71,v76,readPositions,readAccount,readMarket,readTransactions}){
 const file=path.join(storageDir,'v77-certification.jsonl');let records=[],healthy=!!persistentStorage,storageError=null,last=null,timer=null,busy=false;
 try{if(!healthy)throw Error('PERSISTENT_STORAGE_REQUIRED');fs.mkdirSync(storageDir,{recursive:true});if(fs.existsSync(file)){const raw=fs.readFileSync(file,'utf8');if(raw&&!raw.endsWith('\n'))throw Error('INCOMPLETE_JOURNAL_TAIL');let prev='GENESIS';for(const line of raw.split('\n').filter(Boolean)){const e=JSON.parse(line);if(e.prev!==prev||e.hash!==digest({prev:e.prev,type:e.type,data:e.data}))throw Error('JOURNAL_CHAIN_INVALID');records.push(e);prev=e.hash}}last=[...records].reverse().find(x=>x.type==='AUDIT')?.data||null;}catch(e){healthy=false;storageError=String(e.message).slice(0,80)}
 function append(type,data){if(!healthy)throw Error('JOURNAL_UNHEALTHY');const prev=records.at(-1)?.hash||'GENESIS',e={prev,type,data,hash:digest({prev,type,data})};try{const fd=fs.openSync(file,'a');try{fs.writeSync(fd,JSON.stringify(e)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}records.push(e)}catch(err){healthy=false;storageError='JOURNAL_WRITE_FAILED';throw err}}
 async function audit(){if(busy)return {skipped:'AUDIT_BUSY',brokerOrderAllowed:false};busy=true;try{const errors=[];let positions=null,account=null,market=null,rows=null;
 try{positions=await readPositions();if(!Array.isArray(positions))throw Error('POSITIONS_SHAPE_INVALID')}catch(e){errors.push('POSITIONS_READ_FAILED')}
 try{account=await readAccount()}catch(e){errors.push('ACCOUNT_READ_FAILED')}
 try{market=await readMarket()}catch(e){errors.push('MARKET_READ_FAILED')}
 try{const data=await readTransactions('/history/transactions/ALL/604800000','1');if(!Array.isArray(data?.transactions))throw Error('TRANSACTION_SHAPE_INVALID');rows=data.transactions}catch(e){errors.push('V1_TRANSACTIONS_READ_FAILED')}
 const ledger=rows?classifyLedger(rows):{certified:false,netDailyPnlGBP:null,issues:['TRANSACTION_HISTORY_UNAVAILABLE']};const pip=pipStudy(market),feed=feedStudy(v68.status()),lifecycle=lifecycleStudy(positions),signal=v71.status().signal||{};
 const blockers=[...new Set([...errors,...ledger.issues,...pip.blockers,...feed.blockers,...lifecycle.requiredEvidence,...(!healthy?['JOURNAL_UNHEALTHY']:[]),'DAILY_LOSS_LIMIT_NOT_ENFORCEABLE'])];
 const result={version:'77.0.0',at:new Date().toISOString(),mode:'READ_ONLY_BROKER_CERTIFICATION',account:{currency:account?.currency??null,type:account?.accountType??null},marketEpic:market?.instrument?.epic??null,ledger,pip,feed,lifecycle,research:{direction:signal.direction??'WAIT',score:signal.score??null,qualifiedBars:signal.qualifiedBars??0},errors,blockers,brokerDailyPnlGBP:null,dailyLossLimitEnforceable:false,certified:false,brokerOrderAllowed:false,unattendedOrderAllowed:false};append('AUDIT',result);last=result;return result;
 }finally{busy=false}}
 function status(){return {version:'77.0.0',journalHealthy:healthy,storageError,records:records.length,scheduled:!!timer,lastAuditAt:last?.at||null,blockers:last?.blockers||['AUDIT_NOT_RUN'],brokerOrderAllowed:false,unattendedOrderAllowed:false}}
 function evidence(){return {version:'77.0.0',journalHealthy:healthy,storageError,records:records.length,chainTip:records.at(-1)?.hash||'GENESIS',lastAudit:last,brokerOrderAllowed:false}}
 function routes(app){const wrap=fn=>async(_q,r)=>{try{r.set('Cache-Control','no-store').json(await fn())}catch(e){r.status(409).json({error:'V77_AUDIT_FAILED',brokerOrderAllowed:false})}};app.get('/api/v77/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.post('/api/v77/audit',requireAdmin,wrap(audit));app.get('/api/v77/evidence',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(evidence()));app.post('/api/v77/arm',requireAdmin,(_q,r)=>r.status(409).json({error:'BROKER_EXECUTION_HARD_BLOCKED',brokerOrderAllowed:false}));app.get('/v77',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'v77-dashboard.html')))}
 function start(){if(timer)return;timer=setInterval(()=>audit().catch(()=>{}),60000);timer.unref?.()}
 return {audit,status,evidence,routes,start};
}
module.exports={createV77,parseMoney,ukDay,classifyLedger,pipStudy,feedStudy,lifecycleStudy};
