'use strict';
// v151-v160: REHEARSAL ONLY. No IG dealing functions are accepted or called.
const crypto=require('node:crypto');
const {POLICY,TARGET}=require('./v150-readiness');
const uuid=()=>crypto.randomUUID();
const isUUID=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const num=n=>typeof n==='number'&&Number.isFinite(n);
const leaseName='IG_DEMO_EURUSD_MINI_REHEARSAL';
const DDL=`CREATE TABLE IF NOT EXISTS mp_v160_rehearsal_leases (
 lease_key TEXT PRIMARY KEY, owner_id UUID NOT NULL, fence BIGINT NOT NULL CHECK(fence>0),
 expires_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
)`;
function evaluateEvidence(x={}){
 const issues=[];
 if(x.epic!==TARGET)issues.push('EPIC_MISMATCH');
 if(x.brokerEpic!==TARGET)issues.push('BROKER_EPIC_MISMATCH');
 if(x.accountCurrency!=='GBP')issues.push('ACCOUNT_CURRENCY_NOT_GBP');
 if(x.quoteCurrency!=='USD')issues.push('QUOTE_CURRENCY_MISMATCH');
 if(!num(x.size)||x.size<=0)issues.push('INVALID_SIZE');
 if(!num(x.minimumSize)||x.minimumSize<=0||!num(x.sizeStep)||x.sizeStep<=0)issues.push('SIZE_RULES_UNVERIFIED');
 if(num(x.size)&&num(x.minimumSize)&&num(x.sizeStep)&&x.sizeStep>0){
  if(x.size+1e-8<x.minimumSize)issues.push('BELOW_MIN_SIZE');
  const steps=(x.size-x.minimumSize)/x.sizeStep;
  if(!Number.isFinite(steps)||Math.abs(steps-Math.round(steps))>1e-7)issues.push('INVALID_SIZE_STEP');
 }
 if(!num(x.usdPerPipPerUnit)||x.usdPerPipPerUnit<=0)issues.push('PIP_DENOMINATION_UNVERIFIED');
 if(!num(x.gbpPerUsd)||x.gbpPerUsd<=0)issues.push('FX_RATE_UNVERIFIED');
 if(x.contractEvidenceReviewed!==true||!x.contractEvidenceRef||!x.contractEvidenceTimestamp)issues.push('CONTRACT_EVIDENCE_NOT_REVIEWED');
 if(x.fxEvidenceReviewed!==true||!x.fxEvidenceRef||!x.fxEvidenceTimestamp)issues.push('FX_EVIDENCE_NOT_REVIEWED');
 if(!num(x.stopPips)||x.stopPips!==POLICY.stopPips)issues.push('STOP_POLICY_MISMATCH');
 if(!num(x.spreadPips)||x.spreadPips<0||x.spreadPips>POLICY.maxSpreadPips)issues.push('SPREAD_INVALID');
 if(!num(x.signalScore)||x.signalScore<POLICY.minSignalScore)issues.push('SCORE_TOO_LOW');
 if(!Number.isSafeInteger(x.tradesToday)||x.tradesToday<0||x.tradesToday>=POLICY.maxTradesPerDay)issues.push('TRADE_CAP');
 if(!num(x.dailyLossGBP)||x.dailyLossGBP<0||x.dailyLossGBP>=POLICY.dailyLossGBP)issues.push('DAILY_LOSS_CAP');
 if(x.openPositions!==0)issues.push('EXPOSURE_UNKNOWN');
 const gbpPerPipPerUnit=num(x.usdPerPipPerUnit)&&num(x.gbpPerUsd)?x.usdPerPipPerUnit*x.gbpPerUsd:null;
 const grossRisk=num(x.size)&&num(x.stopPips)&&gbpPerPipPerUnit!==null?x.size*x.stopPips*gbpPerPipPerUnit:null;
 const spreadRisk=num(x.size)&&num(x.spreadPips)&&gbpPerPipPerUnit!==null?x.size*x.spreadPips*gbpPerPipPerUnit:null;
 if(!num(x.estimatedFeesGBP)||x.estimatedFeesGBP<0)issues.push('FEES_UNKNOWN');
 const conservativeRisk=grossRisk!==null&&spreadRisk!==null&&num(x.estimatedFeesGBP)?grossRisk+spreadRisk+x.estimatedFeesGBP:null;
 if(conservativeRisk===null||conservativeRisk>POLICY.riskGBP||conservativeRisk<=0)issues.push('TRADE_RISK_UNVERIFIED_OR_EXCEEDED');
 if(conservativeRisk===null||!num(x.dailyLossGBP)||conservativeRisk+x.dailyLossGBP>POLICY.dailyLossGBP)issues.push('DAILY_RISK_UNVERIFIED_OR_EXCEEDED');
 // Human supplied evidence flags are NOT independent validation or broker certification.
 return {epic:TARGET,issues:[...new Set(issues)],candidateGBPPerPipPerUnit:gbpPerPipPerUnit,candidateStopRiskGBP:grossRisk,candidateConservativeRiskGBP:conservativeRisk,requiresIndependentBrokerVerification:true,eligibleForOperatorReview:issues.length===0,certified:false,brokerOrderAllowed:false};
}
function lifecycleScenario(x={}){
 const events=Array.isArray(x.events)?x.events:[];
 const issues=[];
 if(x.epic!==TARGET)issues.push('EPIC_MISMATCH');
 if(!events.includes('INTENT_PERSISTED'))issues.push('INTENT_NOT_PERSISTED');
 if(!events.includes('BROKER_ACCEPTED'))issues.push('BROKER_CONFIRMATION_MISSING');
 if(!events.includes('STOP_CONFIRMED'))issues.push('STOP_CONFIRMATION_MISSING');
 if(!events.includes('POSITION_RECONCILED'))issues.push('POSITION_RECONCILIATION_MISSING');
 if(!events.includes('CLOSED_AND_RECONCILED'))issues.push('CLOSE_RECONCILIATION_MISSING');
 if(events.includes('SUBMISSION_UNKNOWN')&&!events.includes('HALT_AND_BROKER_LOOKUP'))issues.push('UNKNOWN_SUBMISSION_NOT_HALTED');
 if(events.includes('AUTO_RETRY'))issues.push('UNSAFE_AUTO_RETRY');
 if(events.includes('STOP_MISSING')&&!events.includes('HALT_AND_BROKER_LOOKUP'))issues.push('MISSING_STOP_NOT_HALTED');
 return {issues,scenarioComplete:issues.length===0,simulationOnly:true,brokerOrderAttempted:false,brokerOrderAllowed:false,certified:false};
}
function createV160({requireAdmin,pool,v125,v150}={}){
 if(typeof requireAdmin!=='function'||!v125||!v150)throw Error('V160_DEPENDENCIES_MISSING');
 let initialized=false,initError=null;
 async function init(){if(!pool)throw Error('DATABASE_NOT_CONFIGURED');await pool.query(DDL);initialized=true;initError=null;return true;}
 async function ensure(){if(!initialized)await init();}
 async function acquire(owner,ttlMs=15000){
  if(!isUUID(owner)||!Number.isSafeInteger(ttlMs)||ttlMs<2000||ttlMs>60000)throw Error('INVALID_LEASE_ARGUMENTS');
  await ensure();const c=await pool.connect();try{
   await c.query('BEGIN');
   // Insert if absent; existing row is locked for atomic takeover/fencing.
   await c.query(`INSERT INTO mp_v160_rehearsal_leases(lease_key,owner_id,fence,expires_at)
     VALUES($1,$2,1,clock_timestamp()+($3::integer*interval '1 millisecond')) ON CONFLICT DO NOTHING`,[leaseName,owner,ttlMs]);
   const r=await c.query('SELECT owner_id,fence,expires_at,expires_at<=clock_timestamp() AS expired FROM mp_v160_rehearsal_leases WHERE lease_key=$1 FOR UPDATE',[leaseName]);
   const row=r.rows[0];let granted=false,reason='HELD_BY_ANOTHER_WORKER',fence=null;
   if(row.owner_id===owner){granted=true;reason='OWNED';fence=String(row.fence);}
   else if(row.expired){const u=await c.query(`UPDATE mp_v160_rehearsal_leases SET owner_id=$2,fence=fence+1,
     expires_at=clock_timestamp()+($3::integer*interval '1 millisecond'),updated_at=clock_timestamp()
     WHERE lease_key=$1 RETURNING fence`,[leaseName,owner,ttlMs]);granted=true;reason='EXPIRED_TAKEOVER';fence=String(u.rows[0].fence);}
   if(granted&&reason==='OWNED')await c.query(`UPDATE mp_v160_rehearsal_leases SET expires_at=clock_timestamp()+($3::integer*interval '1 millisecond'),updated_at=clock_timestamp() WHERE lease_key=$1 AND owner_id=$2`,[leaseName,owner,ttlMs]);
   await c.query('COMMIT');return {granted,reason,fence,scope:'REHEARSAL_ONLY',brokerOrderAllowed:false};
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
 }
 async function renew(owner,fence,ttlMs=15000){
  if(!isUUID(owner)||!/^\d+$/.test(String(fence))||!Number.isSafeInteger(ttlMs)||ttlMs<2000||ttlMs>60000)throw Error('INVALID_LEASE_ARGUMENTS');
  await ensure();const r=await pool.query(`UPDATE mp_v160_rehearsal_leases SET expires_at=clock_timestamp()+($4::integer*interval '1 millisecond'),updated_at=clock_timestamp()
   WHERE lease_key=$1 AND owner_id=$2 AND fence=$3::bigint AND expires_at>clock_timestamp() RETURNING fence`,[leaseName,owner,String(fence),ttlMs]);
  return {renewed:r.rowCount===1,brokerOrderAllowed:false};
 }
 async function release(owner,fence){
  if(!isUUID(owner)||!/^\d+$/.test(String(fence)))throw Error('INVALID_LEASE_ARGUMENTS');
  await ensure();const r=await pool.query(`UPDATE mp_v160_rehearsal_leases SET expires_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE lease_key=$1 AND owner_id=$2 AND fence=$3::bigint AND expires_at>clock_timestamp() RETURNING fence`,[leaseName,owner,String(fence)]);
  return {released:r.rowCount===1,brokerOrderAllowed:false};
 }
 async function leaseRehearsal(){
  const a=uuid(),b=uuid();const first=await acquire(a);if(!first.granted)throw Error('LEASE_BUSY_RETRY_LATER');
  try{
   const denied=await acquire(b);
   const wrongRenew=await renew(b,first.fence);
   const ownerRenew=await renew(a,first.fence);
   if(denied.granted||wrongRenew.renewed||!ownerRenew.renewed)throw Error('LEASE_EXCLUSIVITY_TEST_FAILED');
   const rel=await release(a,first.fence);if(!rel.released)throw Error('LEASE_RELEASE_FAILED');
   const takeover=await acquire(b);if(!takeover.granted||BigInt(takeover.fence)<=BigInt(first.fence))throw Error('FENCE_MONOTONICITY_FAILED');
   const staleRenew=await renew(a,first.fence);
   if(staleRenew.renewed)throw Error('STALE_FENCE_ACCEPTED');
   await release(b,takeover.fence);
   return {passed:true,competingWorkerRejected:true,staleFenceRejected:true,monotonicFencing:true,firstFence:first.fence,nextFence:takeover.fence,scope:'REHEARSAL_ONLY',integratedIntoBrokerOrderPath:false,brokerOrderAllowed:false};
  }finally{await release(a,first.fence).catch(()=>{});}
 }
 function status(){const s=v150.status();return {version:'160.0.0',mode:'READ_ONLY_FAIL_CLOSED',policy:POLICY,database:{configured:!!pool,leaseSchemaInitialized:initialized,initError},snapshot:s.snapshot,polling:s.polling,capabilities:['POSTGRES_REHEARSAL_LEASE','MONOTONIC_FENCE','COMPETING_WORKER_REHEARSAL','OPERATOR_RISK_CANDIDATE','LIFECYCLE_SCENARIO_SIMULATOR'],independentContractCertification:false,brokerStopLifecycleCertified:false,brokerRecoveryCertified:false,executionLockIntegrated:false,certificationsPassed:0,brokerOrderAllowed:false,unattendedOrderAllowed:false,readyForUnattendedDemo:false};}
 function tests(){const x={epic:TARGET,brokerEpic:TARGET,accountCurrency:'GBP',quoteCurrency:'USD',size:0.1,minimumSize:0.1,sizeStep:0.1,usdPerPipPerUnit:1,gbpPerUsd:0.8,stopPips:12,spreadPips:1,signalScore:80,tradesToday:0,dailyLossGBP:0,openPositions:0,estimatedFeesGBP:0,contractEvidenceReviewed:true,contractEvidenceRef:'sample',contractEvidenceTimestamp:'2026-01-01',fxEvidenceReviewed:true,fxEvidenceRef:'sample',fxEvidenceTimestamp:'2026-01-01'};
  const all=['INTENT_PERSISTED','BROKER_ACCEPTED','STOP_CONFIRMED','POSITION_RECONCILED','CLOSED_AND_RECONCILED'];
  const t={missingEvidence:evaluateEvidence({}).issues.includes('CONTRACT_EVIDENCE_NOT_REVIEWED'),wrongEpic:evaluateEvidence({...x,epic:'CS.D.EURUSD.CFD.IP'}).issues.includes('EPIC_MISMATCH'),overRisk:evaluateEvidence({...x,size:10}).issues.includes('TRADE_RISK_UNVERIFIED_OR_EXCEEDED'),dailyRisk:evaluateEvidence({...x,dailyLossGBP:99}).issues.includes('DAILY_RISK_UNVERIFIED_OR_EXCEEDED'),badStep:evaluateEvidence({...x,size:0.15}).issues.includes('INVALID_SIZE_STEP'),candidateNeverCertified:!evaluateEvidence(x).certified,missingStop:lifecycleScenario({epic:TARGET,events:all.filter(y=>y!=='STOP_CONFIRMED')}).issues.includes('STOP_CONFIRMATION_MISSING'),unknownHalts:lifecycleScenario({epic:TARGET,events:[...all,'SUBMISSION_UNKNOWN']}).issues.includes('UNKNOWN_SUBMISSION_NOT_HALTED'),noAutoRetry:lifecycleScenario({epic:TARGET,events:[...all,'AUTO_RETRY']}).issues.includes('UNSAFE_AUTO_RETRY'),scenarioNotCertified:!lifecycleScenario({epic:TARGET,events:all}).certified,noBrokerWrites:!status().brokerOrderAllowed,noUnattended:!status().readyForUnattendedDemo};
  return {passed:Object.values(t).every(Boolean),count:Object.keys(t).length,tests:t,brokerOrderAllowed:false};}
 function routes(app){const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req));}catch(e){res.status(503).json({error:String(e.message).slice(0,160),brokerOrderAllowed:false});}};
  app.get('/api/v160/status',requireAdmin,wrap(status));
  app.get('/api/v160/fault-tests',requireAdmin,wrap(tests));
  app.post('/api/v160/risk/evidence-review',requireAdmin,wrap(req=>evaluateEvidence(req.body||{})));
  app.post('/api/v160/lifecycle/scenario',requireAdmin,wrap(req=>lifecycleScenario(req.body||{})));
  app.post('/api/v160/lease/rehearsal',requireAdmin,wrap(leaseRehearsal));
  app.post('/api/v160/arm',requireAdmin,(_req,res)=>res.status(409).json({error:'BROKER_DEALING_HARD_BLOCKED',brokerOrderAllowed:false}));
 }
 return {routes,status,tests,init,leaseRehearsal,acquire,renew,release};
}
module.exports={createV160,evaluateEvidence,lifecycleScenario,DDL,leaseName};
