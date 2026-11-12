 'use strict';
// v111-v115: broker read-only refresh, independent evidence gates, durable lease workbench.
// No dealing calls, no auto-arm, no automatic certification.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const good=x=>typeof x==='number'&&Number.isFinite(x);
const age=(at,max,now=Date.now())=>{const t=Date.parse(at||'');const ms=now-t;return {fresh:Number.isFinite(ms)&&ms>=0&&ms<=max,ageMs:Number.isFinite(ms)?ms:null,maxAgeMs:max};};
const LIMITS=Object.freeze({snapshotMs:60000,quoteMs:15000,riskGBP:25,dailyLossGBP:100,maxTrades:3,maxPositions:1});
function riskEvidence(x={}){
 const issues=[];
 for(const k of ['gbpPerPipPerUnit','minSize','sizeStep','size','stopPips'])if(!good(x[k])||x[k]<=0)issues.push('MISSING_'+k.toUpperCase());
 if(x.independentContractVerified!==true)issues.push('CONTRACT_UNVERIFIED');
 if(x.fxVerified!==true)issues.push('FX_UNVERIFIED');
 if(x.sizeUnitVerified!==true)issues.push('SIZE_UNIT_UNVERIFIED');
 let riskGBP=null;
 if(['gbpPerPipPerUnit','minSize','sizeStep','size','stopPips'].every(k=>good(x[k])&&x[k]>0)){
  riskGBP=Number((x.gbpPerPipPerUnit*x.size*x.stopPips).toFixed(2));
  if(x.size<x.minSize||Math.abs((x.size-x.minSize)/x.sizeStep-Math.round((x.size-x.minSize)/x.sizeStep))>1e-7)issues.push('SIZE_INCREMENT_MISMATCH');
  if(riskGBP>LIMITS.riskGBP)issues.push('TRADE_RISK_EXCEEDED');
 }
 return {riskGBP,issues,eligibleForIndependentReview:issues.length===0,certified:false};
}
function pnlEvidence(x={}){
 const issues=[];
 if(x.historyComplete!==true)issues.push('HISTORY_INCOMPLETE');
 if(x.feesVerified!==true)issues.push('FEES_UNVERIFIED');
 if(x.dayBoundaryVerified!==true)issues.push('UK_DAY_BOUNDARY_UNVERIFIED');
 if(x.accountCurrency!=='GBP')issues.push('GBP_ACCOUNT_UNVERIFIED');
 if(x.accountIdentityVerified!==true)issues.push('ACCOUNT_IDENTITY_UNVERIFIED');
 for(const k of ['openingBalance','closingBalance','cashFlows','realisedNetPnl'])if(!good(x[k]))issues.push('MISSING_'+k.toUpperCase());
 let difference=null;
 if(['openingBalance','closingBalance','cashFlows','realisedNetPnl'].every(k=>good(x[k]))){difference=Number((x.closingBalance-x.openingBalance-x.cashFlows-x.realisedNetPnl).toFixed(2));if(Math.abs(difference)>0.01)issues.push('BALANCE_NOT_RECONCILED');if(x.realisedNetPnl<=-LIMITS.dailyLossGBP)issues.push('DAILY_LOSS_LIMIT');}
 return {differenceGBP:difference,issues,eligibleForIndependentReview:issues.length===0,certified:false};
}
function faultTests(){const tests={stale:!age('2020-01-01T00:00:00Z',60000).fresh,future:!age('2099-01-01T00:00:00Z',60000).fresh,missing:!age(null,60000).fresh,missingRisk:!riskEvidence({}).eligibleForIndependentReview,overRisk:riskEvidence({gbpPerPipPerUnit:10,minSize:.1,sizeStep:.1,size:1,stopPips:12}).issues.includes('TRADE_RISK_EXCEEDED'),badIncrement:riskEvidence({gbpPerPipPerUnit:1,minSize:.1,sizeStep:.1,size:.15,stopPips:12}).issues.includes('SIZE_INCREMENT_MISMATCH'),missingFees:pnlEvidence({}).issues.includes('FEES_UNVERIFIED'),badBalance:pnlEvidence({openingBalance:100,closingBalance:200,cashFlows:0,realisedNetPnl:0}).issues.includes('BALANCE_NOT_RECONCILED'),noCertification:!riskEvidence({}).certified&&!pnlEvidence({}).certified,brokerBlocked:true};return {passed:Object.values(tests).every(Boolean),count:Object.keys(tests).length,tests,brokerOrderAllowed:false};}
// PostgreSQL advisory locks are session scoped; this workbench acquires/releases
// a dedicated connection and tests coordination, NOT certified broker execution.
function createLeaseWorkbench({pool,lockKey=115001}={}){
 if(!Number.isSafeInteger(lockKey))throw Error('INVALID_LOCK_KEY');
 let held=null;
 async function acquire(){if(!pool) return {acquired:false,reason:'POSTGRES_NOT_CONFIGURED'};if(held)return {acquired:false,reason:'ALREADY_HELD'};
  const client=await pool.connect();try{const q=await client.query('SELECT pg_try_advisory_lock($1) AS acquired',[lockKey]);if(q.rows?.[0]?.acquired!==true){client.release();return {acquired:false,reason:'LEASE_HELD_ELSEWHERE'};}held=client;return {acquired:true,scope:'WORKBENCH_ONLY'};}catch(e){client.release();throw e;}}
 async function release(){if(!held)return {released:false};const c=held;held=null;try{const q=await c.query('SELECT pg_advisory_unlock($1) AS released',[lockKey]);return {released:q.rows?.[0]?.released===true};}finally{c.release();}}
 function status(){return {backend:pool?'POSTGRES_ADVISORY_LOCK':'NOT_CONFIGURED',heldByThisProcess:!!held,executionCertified:false,scope:'WORKBENCH_ONLY',brokerOrderAllowed:false};}
 return {acquire,release,status};
}
function createV115({requireAdmin,storageDir,v86,v95,v110,pool=null}){
 if(typeof requireAdmin!=='function'||!storageDir||!v86||!v95||!v110)throw Error('DEPENDENCY_MISSING');
 const file=path.join(storageDir,'v115-certification-evidence.jsonl');let prev='GENESIS',records=0,healthy=true,ledgerError=null,last=null,busy=false,lastRefresh=null;
 try{if(fs.existsSync(file)){const raw=fs.readFileSync(file,'utf8');if(raw&&!raw.endsWith('\n'))throw Error('PARTIAL_TAIL');for(const line of raw.split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.previous!==prev||r.hash!==sha({previous:r.previous,payload:r.payload}))throw Error('CHAIN_BROKEN');prev=r.hash;last=r.payload;records++;}}}catch(e){healthy=false;ledgerError=String(e.message).slice(0,90);}
 const lease=createLeaseWorkbench({pool});
 function diagnostics(){const b=v86.status(),s=v95.status(),lastBroker=s.lastEvidence,checks=lastBroker?.checks||{},f=age(lastBroker?.at,LIMITS.snapshotMs);const problems=[];
 if(!f.fresh)problems.push('BROKER_SNAPSHOT_STALE');if(checks.market?.ok!==true||checks.positions?.ok!==true||checks.accounts?.ok!==true)problems.push('BROKER_SNAPSHOT_INCOMPLETE');
 if(checks.history?.historyComplete!==true)problems.push('HISTORY_INCOMPLETE');if(b.paperPaused!==true||b.paperSchedulerRunning===true)problems.push('PAPER_SAFETY_HOLD');if(!healthy||s.ledgerHealthy!==true||v110.status().ledgerHealthy!==true)problems.push('LEDGER_UNHEALTHY');
 return {at:new Date().toISOString(),snapshot:{at:lastBroker?.at||null,...f,market:checks.market||null,positions:checks.positions||null,accounts:checks.accounts||null,history:checks.history||null},risk:riskEvidence(),accounting:pnlEvidence({historyComplete:checks.history?.historyComplete===true}),lease:lease.status(),feed:{exchangeTimestampCertified:false,zeroDelayCertified:false},brokerLifecycle:{protectiveStopCertified:false,unknownSubmitRecoveryCertified:false},issues:problems,tests:faultTests(),brokerOrderAllowed:false,readyForUnattendedDemo:false};}
 function status(){const b=v86.status(),d=diagnostics();return {version:'115.0.0',releases:['v111_REFRESH','v112_RISK_EVIDENCE','v113_PNL_RECONCILIATION','v114_POSTGRES_LEASE_WORKBENCH','v115_CERTIFICATION_GATE'],mode:'READ_ONLY_FAIL_CLOSED',ledgerHealthy:healthy,ledgerError,evidenceRecords:records,lastEvidence:last,lastRefresh,paperPaused:b.paperPaused===true,paperSchedulerRunning:b.paperSchedulerRunning===true,brokerSnapshotFresh:d.snapshot.fresh,testsPassed:d.tests.passed,testsCount:d.tests.count,lease:d.lease,issues:d.issues,certified:false,brokerOrderAllowed:false,unattendedOrderAllowed:false,readyForUnattendedDemo:false};}
 function append(payload){if(!healthy)throw Error('LEDGER_UNHEALTHY');fs.mkdirSync(storageDir,{recursive:true});const row={previous:prev,payload,hash:sha({previous:prev,payload})};const fd=fs.openSync(file,'a',0o600);try{fs.writeSync(fd,JSON.stringify(row)+'\n');fs.fsyncSync(fd);}catch(e){healthy=false;ledgerError='WRITE_FAILED';throw e;}finally{fs.closeSync(fd);}prev=row.hash;last=payload;records++;return {recorded:true,records,evidenceHash:prev,brokerOrderAllowed:false};}
 async function refresh(){if(busy)throw Error('REFRESH_BUSY');busy=true;try{if(!healthy||v86.status().paperPaused!==true)throw Error('SAFETY_HOLD');const result=await v95.capture({includeHistory:true});lastRefresh={at:new Date().toISOString(),recorded:result.recorded===true,marketOk:result.checks?.market?.ok===true,positionsOk:result.checks?.positions?.ok===true,accountsOk:result.checks?.accounts?.ok===true,historyComplete:result.checks?.history?.historyComplete===true};return {refresh:lastRefresh,diagnostics:diagnostics(),brokerOrderAllowed:false};}finally{busy=false;}}
 function routes(app){const wrap=fn=>async(_req,res)=>{try{res.set('Cache-Control','no-store').json(await fn());}catch(e){res.status(503).json({error:String(e.message).slice(0,120),brokerOrderAllowed:false});}};
 for(const [p,fn] of [['status',status],['diagnostics',diagnostics],['fault-tests',faultTests],['lease',lease.status]])app.get('/api/v115/'+p,requireAdmin,wrap(fn));
 app.post('/api/v115/refresh',requireAdmin,wrap(refresh));app.post('/api/v115/evidence/capture',requireAdmin,wrap(()=>append(diagnostics())));
 app.post('/api/v115/lease/test',requireAdmin,wrap(async()=>{const a=await lease.acquire();if(!a.acquired)return {...a,brokerOrderAllowed:false};const b=await lease.release();return {acquired:a.acquired,released:b.released,scope:'WORKBENCH_ONLY',brokerOrderAllowed:false};}));
 app.post('/api/v115/arm',requireAdmin,(_q,r)=>r.status(409).json({error:'IG_DEALING_HARD_BLOCKED',brokerOrderAllowed:false}));}
 return {routes,status,diagnostics,refresh,lease};
}
module.exports={createV115,createLeaseWorkbench,riskEvidence,pnlEvidence,faultTests,age,LIMITS};
