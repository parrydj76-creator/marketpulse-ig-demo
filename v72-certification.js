'use strict';
// Independent, read-only certification workbench. No order endpoints or dealing callbacks.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const num=x=>typeof x==='number'&&Number.isFinite(x);
const round=(x,n=6)=>Number(x.toFixed(n));
function sizeScenario(input){
 const stopPips=Number(input?.stopPips),riskGBP=Number(input?.riskGBP),gbpPerPipPerContract=Number(input?.gbpPerPipPerContract),minDealSize=Number(input?.minDealSize),dealSizeIncrement=Number(input?.dealSizeIncrement);
 const issues=[];
 if(!num(stopPips)||stopPips<=0||stopPips>1000)issues.push('STOP_PIPS_INVALID');
 if(!num(riskGBP)||riskGBP<=0||riskGBP>25)issues.push('RISK_GBP_EXCEEDS_25_OR_INVALID');
 if(!num(gbpPerPipPerContract)||gbpPerPipPerContract<=0)issues.push('GBP_PER_PIP_NOT_INDEPENDENTLY_ESTABLISHED');
 if(!num(minDealSize)||minDealSize<=0)issues.push('MIN_DEAL_SIZE_MISSING');
 if(!num(dealSizeIncrement)||dealSizeIncrement<=0)issues.push('DEAL_SIZE_INCREMENT_MISSING');
 if(issues.length)return {eligible:false,issues,executionCertified:false};
 const theoretical=riskGBP/(stopPips*gbpPerPipPerContract);
 const steps=Math.floor((theoretical-minDealSize)/dealSizeIncrement+1e-10);
 const units=steps<0?0:round(minDealSize+steps*dealSizeIncrement,8);
 const stopOnlyRiskGBP=round(units*stopPips*gbpPerPipPerContract,4);
 if(!units)issues.push('BELOW_MINIMUM_DEAL_SIZE');
 if(stopOnlyRiskGBP>riskGBP+0.00001)issues.push('STOP_RISK_EXCEEDS_BUDGET');
 issues.push('EXCLUDES_SPREAD_SLIPPAGE_FEES_AND_GAPS','PIP_VALUE_INPUT_UNVERIFIED');
 return {eligible:false,issues,theoreticalSize:round(theoretical,8),roundedDealSize:units,stopOnlyRiskGBP,stopPips,riskGBP,gbpPerPipPerContract,executionCertified:false};
}
function createV72({requireAdmin,storageDir,persistentStorage,v68,v69,v71,readPositions,readAccount,readMarket}){
 const file=path.join(storageDir,'v72-certification.jsonl');let events=[],healthy=!!persistentStorage,error=null,busy=false,timer=null,lastAudit=null;
 try{if(healthy){fs.mkdirSync(storageDir,{recursive:true});if(fs.existsSync(file)){const raw=fs.readFileSync(file,'utf8');if(raw&&!raw.endsWith('\n'))throw Error('INCOMPLETE_JOURNAL');let prev='GENESIS';for(const line of raw.split('\n').filter(Boolean)){const e=JSON.parse(line);if(e.prev!==prev||e.hash!==sha({prev:e.prev,type:e.type,data:e.data}))throw Error('JOURNAL_HASH_MISMATCH');events.push(e);prev=e.hash}}}}catch(e){healthy=false;error=e.message}
 function append(type,data){if(!healthy)throw Error('JOURNAL_UNHEALTHY');const prev=events.at(-1)?.hash||'GENESIS';const e={prev,type,data,hash:sha({prev,type,data})};try{const fd=fs.openSync(file,'a');try{fs.writeSync(fd,JSON.stringify(e)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}events.push(e)}catch(ex){healthy=false;error=ex.message;throw ex}}
 function quoteEvidence(){const s=v68.status(),q=s.quote||{},r=v69.readiness(),diag=r.quoteDiagnostics||{};return {streamConnected:s.streamState==='CONNECTED',epic:q.epic||null,source:q.source||null,marketFlag:q.marketFlag||null,spreadPips:q.spreadPips??null,receiptAgeMs:q.ageMs??null,exchangeTimestampAgeMs:diag.igTimestampAgeMs??null,delayRaw:q.delay??null,delayCertified:false,executionEligible:false};}
 function prerequisites(){const q=quoteEvidence(),v=v71.status(),blockers=[];if(!healthy)blockers.push('V72_JOURNAL_UNHEALTHY');if(!persistentStorage)blockers.push('PERSISTENT_STORAGE_UNCONFIRMED');if(!v.journalHealthy)blockers.push('V71_JOURNAL_UNHEALTHY');if(!q.streamConnected)blockers.push('MINI_STREAM_DISCONNECTED');if(q.epic!==EPIC)blockers.push('WRONG_MARKET');if(q.marketFlag!=='DEAL')blockers.push('MARKET_NOT_DEAL');if(!num(q.receiptAgeMs)||q.receiptAgeMs>15000||q.receiptAgeMs<0)blockers.push('QUOTE_STALE');if(!num(q.spreadPips)||q.spreadPips>2.5||q.spreadPips<0)blockers.push('SPREAD_INVALID');if(!v.quality?.signalEligible)blockers.push('RESEARCH_WARMUP_INCOMPLETE');blockers.push('MINI_DELAY_NOT_INDEPENDENTLY_CERTIFIED','GBP_PIP_VALUE_NOT_INDEPENDENTLY_CERTIFIED','SUPERVISED_OPEN_STOP_CLOSE_NOT_CERTIFIED','BROKER_UNKNOWN_SUBMIT_RECOVERY_NOT_CERTIFIED','BROKER_DAILY_PNL_RECONCILIATION_NOT_CERTIFIED');return [...new Set(blockers)]}
 async function audit(){if(busy)return {skipped:'AUDIT_IN_PROGRESS',brokerOrderAllowed:false};busy=true;try{let positions=null,account=null,market=null;const issues=prerequisites();try{positions=await readPositions();if(!Array.isArray(positions))throw Error('POSITIONS_INVALID');if(positions.length>0)issues.push('BROKER_POSITIONS_PRESENT')}catch{issues.push('BROKER_POSITIONS_UNAVAILABLE')}
 try{account=await readAccount();if(account?.currency!=='GBP')issues.push('ACCOUNT_CURRENCY_NOT_GBP');issues.push('IG_DEMO_ENVIRONMENT_NOT_INDEPENDENTLY_CERTIFIED')}catch{issues.push('BROKER_ACCOUNT_UNAVAILABLE')}
 try{market=await readMarket();if(market?.instrument?.epic!==EPIC)issues.push('MINI_MARKET_METADATA_MISMATCH')}catch{issues.push('MINI_MARKET_METADATA_UNAVAILABLE')}
 const result={at:new Date().toISOString(),epic:EPIC,accountCurrency:account?.currency??null,accountType:account?.accountType??null,brokerPositions:Array.isArray(positions)?positions.length:null,miniMarketVerified:market?.instrument?.epic===EPIC,quote:quoteEvidence(),research:{qualifiedBars:v71.status().signal?.qualifiedBars??0,signal:v71.status().signal?.direction??'WAIT'},blockers:[...new Set(issues)],certifications:{streamDelay:false,gbpSizing:false,supervisedLifecycle:false,unknownSubmitRecovery:false,dailyPnl:false},brokerOrderAllowed:false,unattendedOrderAllowed:false};lastAudit=result;if(healthy)append('AUDIT',result);return result}finally{busy=false}}
 function status(){return {version:'72.0.0',mode:'CERTIFICATION_WORKBENCH_READ_ONLY',auditScheduled:!!timer,journalHealthy:healthy,journalError:error,journalRecords:events.length,lastAudit:lastAudit||[...events].reverse().find(e=>e.type==='AUDIT')?.data||null,prerequisites:prerequisites(),brokerOrderAllowed:false,unattendedOrderAllowed:false}}
 function evidence(){return {version:'72.0.0',market:EPIC,quote:quoteEvidence(),research:v71.status().quality,limits:{maxRiskGBP:25,maxDailyLossGBP:100,maxTradesPerDay:3,maxOpenPositions:1,stopPips:12,targetPips:18,maxSpreadPips:2.5},sizing:{formula:'GBP stop-only risk = size * stop pips * verified GBP/pip/size; requires independent IG Mini contract evidence and GBP conversion',contractGBPPerPipVerified:false,dealSizeIncrementVerified:false},brokerOrderAllowed:false}}
 function start(){if(timer)return;timer=setInterval(()=>{void audit().catch(e=>{error=e.message})},60000);timer.unref?.()}
 function routes(app){const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req))}catch(e){res.status(409).json({error:e.message,brokerOrderAllowed:false})}};
 app.get('/api/v72/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
 app.get('/api/v72/evidence',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(evidence()));
 app.post('/api/v72/audit',requireAdmin,wrap(audit));
 app.post('/api/v72/sizing-scenario',requireAdmin,wrap(req=>sizeScenario(req.body||{})));
 app.get('/api/v72/journal-summary',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({journalHealthy:healthy,journalError:error,records:events.length,firstAt:events[0]?.data?.at||null,lastAt:events.at(-1)?.data?.at||null,brokerOrderAllowed:false}));
 app.post('/api/v72/arm-unattended',requireAdmin,(_q,r)=>r.status(409).json({error:'INDEPENDENT_BROKER_CERTIFICATION_REQUIRED',blockers:prerequisites(),brokerOrderAllowed:false}));
 }
 return {start,routes,status,audit,evidence,prerequisites,sizeScenario};
}
module.exports={createV72,sizeScenario};
