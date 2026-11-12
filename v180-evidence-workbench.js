'use strict';
// v180: durable, immutable, operator-submitted evidence intake. READ ONLY; no IG dealing calls.
const crypto=require('node:crypto');
const {TARGET}=require('./v150-readiness');
const TYPES=Object.freeze(['historicalPaperAccounting','exchangeTimestampAndDelay','gbpPipValueAndDealSize','netDailyPnlAndFees','brokerStopLifecycle','unknownSubmissionRecovery','distributedExecutionLock']);
const DDL=`CREATE TABLE IF NOT EXISTS mp_v180_evidence (
 seq BIGSERIAL PRIMARY KEY, evidence_id UUID NOT NULL UNIQUE, category TEXT NOT NULL,
 epic TEXT NOT NULL, source TEXT NOT NULL, source_ref TEXT NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL,
 payload_sha256 TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT mp_v180_payload_sha_len CHECK (length(payload_sha256)=64)
)`;
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function stable(x){if(Array.isArray(x))return '['+x.map(stable).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';return JSON.stringify(x);}
function validate(x,now=Date.now()){
 const issues=[];
 if(!x||typeof x!=='object'||Array.isArray(x))return ['INVALID_BODY'];
 if(!TYPES.includes(x.category))issues.push('UNKNOWN_CATEGORY');
 if(x.epic!==TARGET)issues.push('WRONG_EPIC');
 if(!['IG_DEMO_API','IG_DEMO_STATEMENT','INDEPENDENT_CONTRACT_DOCUMENT','OPERATOR_TEST','HISTORICAL_DATA'].includes(x.source))issues.push('UNSUPPORTED_SOURCE');
 if(typeof x.sourceRef!=='string'||x.sourceRef.length<8||x.sourceRef.length>256)issues.push('SOURCE_REFERENCE_REQUIRED');
 const t=Date.parse(x.observedAt);if(!Number.isFinite(t)||t>now+60000||t<now-366*86400000)issues.push('INVALID_OBSERVATION_TIME');
 if(!x.payload||typeof x.payload!=='object'||Array.isArray(x.payload))issues.push('INVALID_PAYLOAD');
 else if(Buffer.byteLength(stable(x.payload),'utf8')>24000)issues.push('PAYLOAD_TOO_LARGE');
 // No credentials or full account identifiers in stored evidence.
 const sensitive=/(api.?key|password|secret|token|authorization|cookie|account.?id|session|cst|x.security.token)/i;
 function scan(o,depth=0){if(depth>8){issues.push('PAYLOAD_NESTING_TOO_DEEP');return;}if(o&&typeof o==='object')for(const [k,v] of Object.entries(o)){if(sensitive.test(k))issues.push('SENSITIVE_FIELD_REJECTED');if(typeof v==='object')scan(v,depth+1);}}
 scan(x.payload);
 if(x.payload&&x.payload.epic&&x.payload.epic!==TARGET)issues.push('PAYLOAD_EPIC_MISMATCH');
 return [...new Set(issues)];
}
function reviewEvidence(x){const issues=validate(x);const p=x?.payload||{};const gaps=[];
 if(x?.category==='gbpPipValueAndDealSize'){
  for(const k of ['contractCurrency','quoteCurrency','minimumDealSize','dealSizeStep','pipSize','usdPerPipPerDealUnit','gbpPerUsd','fxObservedAt','contractDocumentRef'])if(p[k]===undefined||p[k]===null||p[k]==='')gaps.push(k);
  for(const k of ['minimumDealSize','dealSizeStep','pipSize','usdPerPipPerDealUnit','gbpPerUsd'])if(p[k]!==undefined&&(!Number.isFinite(p[k])||p[k]<=0))issues.push('INVALID_'+k);
 }
 if(x?.category==='brokerStopLifecycle')for(const k of ['dealReference','dealId','stopConfirmed','positionReconciled','closedAndReconciled'])if(p[k]===undefined)gaps.push(k);
 if(x?.category==='unknownSubmissionRecovery')for(const k of ['intentId','lookupResult','restartReconciled','autoRetryCount'])if(p[k]===undefined)gaps.push(k);
 if(x?.category==='netDailyPnlAndFees')for(const k of ['statementDate','openingBalanceGBP','closingBalanceGBP','netTradingPnlGBP','feesGBP','cashflowsGBP'])if(p[k]===undefined)gaps.push(k);
 if(x?.category==='exchangeTimestampAndDelay')for(const k of ['exchangeTimestamp','receivedTimestamp','feedDelayStatus'])if(p[k]===undefined)gaps.push(k);
 if(x?.category==='historicalPaperAccounting')for(const k of ['dataSource','fillReconciliationRef','feeModelRef','reconciliationDifferenceGBP'])if(p[k]===undefined)gaps.push(k);
 if(x?.category==='distributedExecutionLock')for(const k of ['orderPathCommitRef','fencingEnforcedAtSubmit','staleSubmitRejected','restartTestRef'])if(p[k]===undefined)gaps.push(k);
 return {valid:issues.length===0,issues:[...new Set(issues)],missingEvidenceFields:gaps,completeCandidate:issues.length===0&&gaps.length===0,independentlyCertified:false,brokerOrderAllowed:false};
}
function createV180({requireAdmin,pool,v170}={}){
 if(typeof requireAdmin!=='function'||!v170)throw Error('V180_DEPENDENCIES_MISSING');
 let initialized=false,initError=null;
 async function init(){if(!pool)throw Error('DATABASE_NOT_CONFIGURED');try{await pool.query(DDL);initialized=true;initError=null;}catch(e){initError=e.message;throw e;}}
 async function ensure(){if(!initialized)await init();}
 async function submit(x){const review=reviewEvidence(x);if(!review.valid) return {accepted:false,...review};await ensure();
  const evidenceId=crypto.randomUUID();const canonical=stable(x.payload);const digest=sha(canonical);
  const r=await pool.query(`INSERT INTO mp_v180_evidence(evidence_id,category,epic,source,source_ref,observed_at,payload,payload_sha256) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING seq,created_at`,[evidenceId,x.category,TARGET,x.source,x.sourceRef,x.observedAt,canonical,digest]);
  return {accepted:true,evidenceId,sequence:String(r.rows[0].seq),createdAt:r.rows[0].created_at,payloadSha256:digest,...review};
 }
 async function list(){await ensure();const r=await pool.query(`SELECT evidence_id,seq,category,source,source_ref,observed_at,payload_sha256,created_at FROM mp_v180_evidence ORDER BY seq DESC LIMIT 100`);return {records:r.rows.map(x=>({...x,seq:String(x.seq)})),limit:100,certified:false,brokerOrderAllowed:false};}
 async function verify(evidenceId){if(!/^[a-f\d-]{36}$/i.test(String(evidenceId)))throw Error('INVALID_EVIDENCE_ID');await ensure();const r=await pool.query('SELECT * FROM mp_v180_evidence WHERE evidence_id=$1',[evidenceId]);if(!r.rowCount)return {found:false,verified:false};const x=r.rows[0];const calculated=sha(stable(x.payload));return {found:true,evidenceId,category:x.category,hashMatches:calculated===x.payload_sha256,verified:calculated===x.payload_sha256,sourceRef:x.source_ref,independentlyCertified:false,brokerOrderAllowed:false};}
 function status(){const s=v170.status();return {version:'180.0.0',mode:'READ_ONLY_FAIL_CLOSED',epic:TARGET,policy:s.policy,database:{configured:!!pool,evidenceSchemaInitialized:initialized,initError},capabilities:['DURABLE_EVIDENCE_INTAKE','SHA256_PAYLOAD_INTEGRITY','CATEGORY_GAP_CHECKS','RESTART_EVIDENCE_VERIFICATION','NO_BROKER_WRITES'],certificationsPassed:0,certificationsRequired:7,certification:s.certification,brokerOrderAllowed:false,unattendedOrderAllowed:false,readyForUnattendedDemo:false};}
 function tests(){const base={category:'gbpPipValueAndDealSize',epic:TARGET,source:'INDEPENDENT_CONTRACT_DOCUMENT',sourceRef:'document:contract-2026',observedAt:new Date().toISOString(),payload:{epic:TARGET}};const t={rejectWrongEpic:!reviewEvidence({...base,epic:'WRONG'}).valid,rejectSecrets:!reviewEvidence({...base,payload:{apiKey:'secret'}}).valid,rejectFuture:!reviewEvidence({...base,observedAt:'2099-01-01T00:00:00Z'}).valid,contractGaps:reviewEvidence(base).missingEvidenceFields.includes('usdPerPipPerDealUnit'),candidateNotCertification:!reviewEvidence(base).independentlyCertified,neverBrokerOrder:!status().brokerOrderAllowed,unattendedBlocked:!status().readyForUnattendedDemo,stableHash:sha(stable({b:2,a:1}))===sha(stable({a:1,b:2}))};return {passed:Object.values(t).every(Boolean),count:Object.keys(t).length,tests:t,brokerOrderAllowed:false};}
 const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req));}catch(e){res.status(503).json({error:String(e.message).slice(0,160),brokerOrderAllowed:false});}};
 function routes(app){app.get('/api/v180/status',requireAdmin,wrap(status));app.get('/api/v180/fault-tests',requireAdmin,wrap(tests));app.post('/api/v180/evidence/review',requireAdmin,wrap(req=>reviewEvidence(req.body||{})));app.post('/api/v180/evidence/submit',requireAdmin,wrap(req=>submit(req.body||{})));app.get('/api/v180/evidence/list',requireAdmin,wrap(list));app.get('/api/v180/evidence/verify/:id',requireAdmin,wrap(req=>verify(req.params.id)));app.post('/api/v180/arm',requireAdmin,(_q,res)=>res.status(409).json({error:'BROKER_DEALING_HARD_BLOCKED',brokerOrderAllowed:false}));}
 return {routes,init,status,tests,submit,list,verify};
}
module.exports={createV180,validate,reviewEvidence,stable,sha,DDL,TYPES};
