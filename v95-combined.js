'use strict';
// v92-v95: read-only IG history, conservative risk observations, reconciliation and recovery diagnostics.
// No broker write operations. No certification inferred from API connectivity.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const safe=e=>String(e?.message||e||'ERROR').replace(/[^a-zA-Z0-9_ .:-]/g,'_').slice(0,120);
const numeric=x=>typeof x==='number'&&Number.isFinite(x);
const dayUK=(d=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
function datePart(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw Error('INVALID_DATE');return s;}
function transactionPath(from,to,page,size){
 datePart(from);datePart(to);
 if(from>to||!Number.isInteger(page)||page<1||page>10||!Number.isInteger(size)||size<1||size>100)throw Error('INVALID_HISTORY_REQUEST');
 // IG REST API v2 transaction history endpoint; compatibility must be checked against the connected account.
 return `/history/transactions/ALL/${from}/${to}/pageSize/${size}/pageNumber/${page}`;
}
function analyseHistory(pages,from,to){
 const counts=pages.map(p=>Array.isArray(p?.transactions)?p.transactions.length:-1);
 const malformed=counts.some(n=>n<0);
 const rows=pages.flatMap(p=>Array.isArray(p?.transactions)?p.transactions:[]);
 const continuation=pages.length>0&&counts[counts.length-1]===100;
 const amounts=rows.map(r=>r?.profitAndLoss);
 const numericPnl=amounts.every(n=>numeric(n));
 return {from,to,pagesFetched:pages.length,transactionsObserved:rows.length,responseShapeValid:!malformed,
  historyComplete:false,historyPossiblyTruncated:continuation,allPnlNumeric:numericPnl,
  netDailyPnlCertified:false,chargesCertified:false,reason:'History pages are observations only: timezone, pagination metadata, transaction classification, charges and opening balance must be independently reconciled'};
}
function analyseRisk(market,positions){
 const i=market?.instrument||{},r=market?.dealingRules||{},p=positions?.positions;
 const minimum=r.minDealSize?.value;
 const stop=r.minNormalStopOrLimitDistance?.value;
 const currency=i.currencies?.[0]?.code||null;
 return {epic:i.epic||null,minimumDealSize:numeric(minimum)?minimum:null,minimumDealSizeUnit:r.minDealSize?.unit||null,
  minimumStopDistance:numeric(stop)?stop:null,minimumStopDistanceUnit:r.minNormalStopOrLimitDistance?.unit||null,
  contractSize:numeric(i.contractSize)?i.contractSize:null,quoteCurrency:currency,
  positionsObserved:Array.isArray(p)?p.length:null,unexpectedExposure:Array.isArray(p)?p.length>0:null,
  targetRiskGBP:25,stopPips:12,targetPips:18,verifiedGBPPerPip:null,verifiedSize:null,
  dealSizeCertified:false,gbpRiskCertified:false,reason:'Do not derive GBP pip value or tradable size from unspecified POINTS units or unverified FX conversion'};
}
function createV95({requireAdmin,storageDir,readIG,v86,v91}){
 if(typeof readIG!=='function'||typeof requireAdmin!=='function')throw Error('REQUIRED_DEPENDENCY_MISSING');
 const file=path.join(storageDir,'v95-broker-evidence.jsonl');
 let previous='GENESIS',records=0,healthy=true,error=null,last=null,busy=false;
 try{if(fs.existsSync(file)){const data=fs.readFileSync(file,'utf8');if(data&&!data.endsWith('\n'))throw Error('PARTIAL_TAIL');for(const line of data.split('\n').filter(Boolean)){const row=JSON.parse(line);if(row.previous!==previous||row.hash!==digest({previous:row.previous,payload:row.payload}))throw Error('HASH_CHAIN_MISMATCH');previous=row.hash;records++;last=row.payload;}}}catch(e){healthy=false;error=safe(e);}
 function status(){const base=v86.status();return {version:'95.0.0',releases:['v92_HISTORY_READ_ONLY','v93_CONTRACT_RISK_DIAGNOSTICS','v94_POSITION_RECONCILIATION','v95_RECOVERY_AND_READINESS'],mode:'READ_ONLY_IG_DEMO_EVIDENCE',ledgerHealthy:healthy,ledgerError:error,evidenceRecords:records,lastEvidence:last,paperPaused:base.paperPaused===true,previousLedgerHealthy:v91.status().ledgerHealthy===true,brokerOrderAllowed:false,unattendedOrderAllowed:false,readyForUnattendedDemo:false,certified:false,blockers:base.blockers||[],singleWriterCertified:false,unknownSubmitRecoveryCertified:false,warning:'Broker transactions and contract observations are not independent certifications; IG dealing is hard-blocked.'};}
 function append(payload){if(!healthy)throw Error('LEDGER_UNHEALTHY');fs.mkdirSync(storageDir,{recursive:true});const row={previous,payload,hash:digest({previous,payload})};const fd=fs.openSync(file,'a',0o600);try{fs.writeSync(fd,JSON.stringify(row)+'\n');fs.fsyncSync(fd);}catch(e){healthy=false;error='LEDGER_WRITE_FAILED';throw e;}finally{fs.closeSync(fd);}previous=row.hash;records++;last=payload;return row.hash;}
 async function capture({from,to,includeHistory=true}={}){
  if(busy)throw Error('CAPTURE_BUSY');if(!healthy||v91.status().ledgerHealthy!==true)throw Error('LEDGER_UNHEALTHY');if(v86.status().paperPaused!==true)throw Error('PAPER_NOT_PAUSED');
  const today=dayUK();from=datePart(from||today);to=datePart(to||today);
  const span=(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000;
  if(span<0||span>7)throw Error('DATE_RANGE_EXCEEDS_7_DAYS');
  busy=true;
  try{
   const checks={};let market=null,positions=null;
   for(const [name,url,version] of [['market','/markets/'+encodeURIComponent(EPIC),'3'],['positions','/positions','2'],['accounts','/accounts','1']]){
    try{const raw=await readIG(url,version);if(name==='market')market=raw;if(name==='positions')positions=raw;
     if(name==='accounts'){if(!Array.isArray(raw?.accounts))throw Error('INVALID_ACCOUNTS');checks.accounts={ok:true,count:raw.accounts.length,identifiersOmitted:true};}
     else if(name==='positions'){if(!Array.isArray(raw?.positions))throw Error('INVALID_POSITIONS');checks.positions={ok:true,count:raw.positions.length,unexpectedExposure:raw.positions.length>0,identifiersOmitted:true};}
     else checks.market={ok:true,epic:raw?.instrument?.epic||null,marketStatus:raw?.snapshot?.marketStatus||null};
    }catch(e){checks[name]={ok:false,error:safe(e)};}
   }
   checks.contractRisk=market&&positions?analyseRisk(market,positions):{gbpRiskCertified:false,reason:'Market or positions unavailable'};
   if(includeHistory){
    const pages=[];let historyError=null;const size=100;
    for(let page=1;page<=10;page++){
     try{const raw=await readIG(transactionPath(from,to,page,size),'2');if(!Array.isArray(raw?.transactions))throw Error('INVALID_TRANSACTIONS_RESPONSE');pages.push(raw);
      // Stop only on short page; full final page remains ambiguous at max page cap.
      if(raw.transactions.length<size)break;
     }catch(e){historyError=safe(e);break;}
    }
    checks.history={ok:!historyError,error:historyError,...analyseHistory(pages,from,to)};
    if(pages.length===10&&pages[9]?.transactions?.length===100)checks.history.historyPossiblyTruncated=true;
   }else checks.history={ok:false,error:'HISTORY_CAPTURE_NOT_REQUESTED'};
   const payload={at:new Date().toISOString(),checks,brokerOrderAllowed:false,certified:false};
   const evidenceHash=append(payload);return {recorded:true,evidenceHash,records,checks,brokerOrderAllowed:false,certified:false};
  }finally{busy=false;}
 }
 function routes(app){
  app.get('/api/v95/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.post('/api/v95/capture',requireAdmin,async(req,res)=>{try{const b=req.body||{};const result=await capture({from:b.from,to:b.to,includeHistory:b.includeHistory!==false});res.set('Cache-Control','no-store').json(result);}catch(e){res.status(/CAPTURE_BUSY|PAPER_NOT_PAUSED/.test(e.message)?409:503).json({error:safe(e),brokerOrderAllowed:false});}});
  app.get('/api/v95/recovery',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({journalHealthy:healthy,records,previousLedgerHealthy:v91.status().ledgerHealthy===true,distributedLockCertified:false,unknownSubmitRecoveryCertified:false,brokerOrderAllowed:false}));
  app.post('/api/v95/arm',requireAdmin,(_q,r)=>r.status(409).json({error:'IG_DEMO_EXECUTION_HARD_BLOCKED',brokerOrderAllowed:false}));
 }
 return {status,capture,routes};
}
module.exports={createV95,transactionPath,analyseHistory,analyseRisk,dayUK};
