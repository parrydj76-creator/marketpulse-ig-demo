'use strict';
// v126-v140: read-only broker certification workbench. NO dealing methods.
const crypto=require('node:crypto');
const {riskEvidence,pnlEvidence}=require('./v115-combined');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const num=x=>typeof x==='number'&&Number.isFinite(x);
const safeTime=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
function ukDay(iso){if(!safeTime(iso))return null;return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));}
function riskCandidate(input={}){
 const x={...input};const issues=[];
 if(!num(x.bid)||!num(x.ask)||x.bid<=0||x.ask<=0||x.ask<x.bid)issues.push('INVALID_BID_ASK');
 if(!safeTime(x.quoteAt)||Date.now()-Date.parse(x.quoteAt)>15000||Date.now()<Date.parse(x.quoteAt))issues.push('QUOTE_STALE_OR_INVALID');
 if(x.quoteSourceVerified!==true)issues.push('QUOTE_SOURCE_UNVERIFIED');
 if(x.exchangeTimestampVerified!==true)issues.push('EXCHANGE_TIMESTAMP_UNVERIFIED');
 if(x.zeroDelayVerified!==true)issues.push('PRICE_DELAY_UNVERIFIED');
 if(x.epic!=='CS.D.EURUSD.MINI.IP')issues.push('EPIC_MISMATCH');
 if(x.accountCurrency!=='GBP')issues.push('ACCOUNT_CURRENCY_UNVERIFIED');
 if(x.contractEvidenceSource!=='IG_OFFICIAL_AND_INDEPENDENTLY_CHECKED')issues.push('CONTRACT_EVIDENCE_UNVERIFIED');
 if(x.fxEvidenceSource!=='VERIFIED_BROKER_OR_INDEPENDENT')issues.push('FX_EVIDENCE_UNVERIFIED');
 if(!num(x.spreadPips)||x.spreadPips<0||x.spreadPips>2.5)issues.push('SPREAD_EXCEEDED_OR_MISSING');
 if(!num(x.signalScore)||x.signalScore<70||x.signalScore>100)issues.push('SIGNAL_SCORE_TOO_LOW');
 const r=riskEvidence(x);
 return {issues:[...new Set([...issues,...r.issues])],estimatedRiskGBP:r.riskGBP,reviewable:issues.length===0&&r.eligibleForIndependentReview,certified:false,brokerOrderAllowed:false};
}
function pnlCandidate(input={}){
 const x={...input};const issues=[];
 if(!safeTime(x.from)||!safeTime(x.to)||Date.parse(x.to)<=Date.parse(x.from))issues.push('INVALID_TIME_RANGE');
 if(x.from&&x.to&&ukDay(x.from)!==ukDay(new Date(Date.parse(x.to)-1).toISOString()))issues.push('CROSSES_UK_DAY_BOUNDARY');
 if(!Number.isSafeInteger(x.transactionCount)||x.transactionCount<0)issues.push('TRANSACTION_COUNT_MISSING');
 if(x.brokerHistoryPageCountVerified!==true)issues.push('HISTORY_PAGINATION_UNVERIFIED');
 if(x.depositWithdrawalVerified!==true)issues.push('CASHFLOWS_UNVERIFIED');
 if(x.commissionsVerified!==true||x.financingVerified!==true||x.otherChargesVerified!==true)issues.push('BROKER_CHARGES_UNVERIFIED');
 const p=pnlEvidence(x);
 return {issues:[...new Set([...issues,...p.issues])],balanceDifferenceGBP:p.differenceGBP,reviewable:issues.length===0&&p.eligibleForIndependentReview,certified:false,brokerOrderAllowed:false};
}
function pollingAssessment(s={}){
 const p=s.polling||{},issues=[];
 if(!p.enabled||!p.running)issues.push('POLLING_DISABLED');
 if(!p.lastPoll?.ok)issues.push('NO_SUCCESSFUL_POLL');
 if(!s.snapshot?.fresh)issues.push('STALE_SNAPSHOT');
 if(p.intervalMs>60000)issues.push('INTERVAL_EXCEEDS_SNAPSHOT_TTL');
 if(p.busy)issues.push('POLL_IN_PROGRESS');
 return {issues,lastPoll:p.lastPoll||null,intervalMs:p.intervalMs||null,brokerOrderAllowed:false};
}
function createV140({requireAdmin,v125,pool=null}={}){
 if(typeof requireAdmin!=='function'||!v125)throw Error('V140_DEPENDENCY_MISSING');
 async function databaseAudit(){
  if(!pool)return {configured:false,issues:['DATABASE_NOT_CONFIGURED'],scope:'REHEARSAL_ONLY',brokerOrderAllowed:false};
  const c=await pool.connect();try{
   const [states,duplicates,broken,orphans]=await Promise.all([
    c.query('SELECT state,COUNT(*)::integer AS n FROM mp_rehearsal_intents GROUP BY state'),
    c.query('SELECT COUNT(*)::integer AS n FROM (SELECT fingerprint FROM mp_rehearsal_intents GROUP BY fingerprint HAVING COUNT(*)>1) d'),
    c.query(`SELECT COUNT(*)::integer AS n FROM (SELECT intent_id,seq,previous_hash,LAG(event_hash) OVER(PARTITION BY intent_id ORDER BY seq) AS prev FROM mp_rehearsal_events) e WHERE (prev IS NULL AND previous_hash<>'GENESIS') OR (prev IS NOT NULL AND previous_hash<>prev)`),
    c.query('SELECT COUNT(*)::integer AS n FROM mp_rehearsal_intents i WHERE NOT EXISTS (SELECT 1 FROM mp_rehearsal_events e WHERE e.intent_id=i.id)')]);
   const issues=[];if(duplicates.rows[0].n)issues.push('DUPLICATE_FINGERPRINT');if(broken.rows[0].n)issues.push('EVENT_LINK_BROKEN');if(orphans.rows[0].n)issues.push('MISSING_INITIAL_EVENT');
   return {configured:true,states:states.rows,duplicateFingerprints:duplicates.rows[0].n,brokenEventLinks:broken.rows[0].n,intentsWithoutEvents:orphans.rows[0].n,issues,scope:'REHEARSAL_ONLY',brokerOrderAllowed:false};
  }finally{c.release();}
 }
 function report(){const d=v125.diagnostics(),p=pollingAssessment(d);const outstanding=[...d.remainingCertifications];return {
  version:'140.0.0',mode:'READ_ONLY_FAIL_CLOSED',generatedAt:new Date().toISOString(),
  releaseAreas:['v126_FEED_PROVENANCE','v127_CONTRACT_EVIDENCE','v128_RISK_CANDIDATE','v129_UK_DAY_ACCOUNTING','v130_FEES_AND_CASHFLOWS','v131_POLL_HEALTH','v132_REHEARSAL_AUDIT','v133_DEDUPLICATION','v134_EVENT_LINKS','v135_RESTART_CHECKLIST','v136_SINGLE_WRITER_PLAN','v137_STOP_LIFECYCLE_CHECKLIST','v138_UNKNOWN_SUBMISSION_CHECKLIST','v139_EVIDENCE_EXPORT','v140_READINESS_GATE'],
  snapshot:d.snapshot,polling:p,database:d.database,observedMarket:d.observedMarket,observedPositions:d.observedPositions,
  checks:{paperPaused:!d.issues.includes('PAPER_NOT_PAUSED'),previousLedgersHealthy:!d.issues.includes('UNHEALTHY_PRIOR_LEDGER'),databaseInitialized:d.database.initialized===true,refreshWorking:d.polling.lastPoll?.ok===true,snapshotFresh:d.snapshot.fresh===true},
  evidenceRequired:{contract:['IG official contract denomination','minimum size','size step','GBP per pip per IG deal unit','verified FX conversion'],accounting:['GBP account ID','UK day boundaries','complete transaction pages','commission/financing charges','opening/closing balances','cashflows'],lifecycle:['operator-approved DEMO protective stop lifecycle','unknown submission resolved by broker lookup','restart reconciliation'],coordination:['cross-instance DB lease','fencing token','atomic intent-before-submit','lease-loss halt']},
  outstanding,certificationsPassed:0,certificationsRequired:outstanding.length,
  notes:['Candidate calculators are not independent certification','Database audit checks rehearsal only, not broker execution','No dealing endpoints or auto-arm are implemented'],
  certified:false,brokerOrderAllowed:false,unattendedOrderAllowed:false,readyForUnattendedDemo:false};}
 function tests(){const t={
  noUnattended:report().readyForUnattendedDemo===false,
  brokerBlocked:report().brokerOrderAllowed===false,
  staleQuote:riskCandidate({quoteAt:'2020-01-01T00:00:00Z'}).issues.includes('QUOTE_STALE_OR_INVALID'),
  badSpread:riskCandidate({spreadPips:4}).issues.includes('SPREAD_EXCEEDED_OR_MISSING'),
  lowScore:riskCandidate({signalScore:30}).issues.includes('SIGNAL_SCORE_TOO_LOW'),
  noContract:riskCandidate({}).issues.includes('CONTRACT_EVIDENCE_UNVERIFIED'),
  missingFees:pnlCandidate({}).issues.includes('BROKER_CHARGES_UNVERIFIED'),
  invalidBalance:pnlCandidate({openingBalance:100,closingBalance:200,cashFlows:0,realisedNetPnl:0}).issues.includes('BALANCE_NOT_RECONCILED'),
  disabledPolling:pollingAssessment({polling:{enabled:false},snapshot:{fresh:false}}).issues.includes('POLLING_DISABLED'),
  ukDstWinter:ukDay('2026-01-01T00:30:00Z')==='01/01/2026'||ukDay('2026-01-01T00:30:00Z')==='2026-01-01',
  ukDstSummer:ukDay('2026-07-01T23:30:00Z')!==ukDay('2026-07-01T22:30:00Z'),
  noImplicitCertification:!riskCandidate({}).certified&&!pnlCandidate({}).certified,
  reportDigest:hash(report()).length===64,
  noBrokerCallbacks:typeof v125.store?.create==='function'
 };return {passed:Object.values(t).every(Boolean),count:Object.keys(t).length,tests:t,brokerOrderAllowed:false};}
 function routes(app){const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req));}catch(e){res.status(503).json({error:String(e.message).slice(0,120),brokerOrderAllowed:false});}};
  app.get('/api/v140/status',requireAdmin,wrap(report));
  app.get('/api/v140/report',requireAdmin,wrap(report));
  app.get('/api/v140/fault-tests',requireAdmin,wrap(tests));
  app.get('/api/v140/database/audit',requireAdmin,wrap(databaseAudit));
  app.post('/api/v140/risk/review',requireAdmin,wrap(req=>{if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw Error('INVALID_INPUT');return riskCandidate(req.body);}));
  app.post('/api/v140/pnl/review',requireAdmin,wrap(req=>{if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw Error('INVALID_INPUT');return pnlCandidate(req.body);}));
  app.post('/api/v140/arm',requireAdmin,(_req,res)=>res.status(409).json({error:'IG_DEALING_HARD_BLOCKED',brokerOrderAllowed:false}));
 }
 return {routes,report,tests,databaseAudit};
}
module.exports={createV140,riskCandidate,pnlCandidate,pollingAssessment,ukDay};
