'use strict';
// v141-v150: read-only contract comparison + durable rehearsal verification.
// No IG dealing callbacks, no order submission, no certification by assertion.
const crypto=require('node:crypto');
const EPICS=Object.freeze(['CS.D.EURUSD.MINI.IP','CS.D.EURUSD.CFD.IP']);
const TARGET=EPICS[0];
const POLICY=Object.freeze({epic:TARGET,riskGBP:25,dailyLossGBP:100,maxTradesPerDay:3,maxOpenPositions:1,stopPips:12,targetPips:18,maxSpreadPips:2.5,maxQuoteAgeMs:15000,minSignalScore:70});
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function parseContract(raw,requestedEpic){
 const i=raw?.instrument||{},r=raw?.dealingRules||{},s=raw?.snapshot||{};
 const issues=[];
 if(!EPICS.includes(requestedEpic)||i.epic!==requestedEpic)issues.push('BROKER_EPIC_MISMATCH');
 const minimumDealSize=r.minDealSize?.value;
 if(!finite(minimumDealSize)||minimumDealSize<=0)issues.push('MIN_DEAL_SIZE_MISSING');
 if(r.minDealSize?.unit!=='POINTS')issues.push('DEAL_SIZE_UNIT_UNEXPECTED');
 if(!finite(i.contractSize)||i.contractSize<=0)issues.push('CONTRACT_SIZE_NOT_PROVIDED');
 if(!finite(r.minNormalStopOrLimitDistance?.value))issues.push('STOP_RULE_MISSING');
 return {requestedEpic,observedEpic:i.epic||null,marketStatus:s.marketStatus||null,minimumDealSize:finite(minimumDealSize)?minimumDealSize:null,minimumDealSizeUnit:r.minDealSize?.unit||null,minimumNormalStopDistance:r.minNormalStopOrLimitDistance?.value??null,minimumNormalStopUnit:r.minNormalStopOrLimitDistance?.unit||null,contractSize:finite(i.contractSize)?i.contractSize:null,lotSize:finite(i.lotSize)?i.lotSize:null,quoteCurrency:i.currencies?.[0]?.code||null,issues,gbpPipValueCertified:false,dealSizeCertified:false,brokerOrderAllowed:false};
}
function instrumentGuard({signalEpic,contractEpic,positionEpic,policyEpic=TARGET}={}){
 const issues=[];
 if(policyEpic!==TARGET)issues.push('POLICY_EPIC_MISMATCH');
 if(signalEpic!==TARGET)issues.push('SIGNAL_EPIC_MISMATCH');
 if(contractEpic!==TARGET)issues.push('CONTRACT_EPIC_MISMATCH');
 if(positionEpic!==undefined&&positionEpic!==TARGET)issues.push('POSITION_EPIC_MISMATCH');
 return {targetEpic:TARGET,issues,matched:issues.length===0,brokerOrderAllowed:false};
}
function riskPreview(x={}){
 const issues=[];
 if(x.epic!==TARGET)issues.push('EPIC_MISMATCH');
 if(x.contractEpic!==TARGET)issues.push('CONTRACT_EPIC_MISMATCH');
 if(!finite(x.gbpPerPipPerUnit)||x.gbpPerPipPerUnit<=0)issues.push('GBP_PIP_VALUE_MISSING');
 if(!finite(x.size)||x.size<=0)issues.push('SIZE_MISSING');
 if(!finite(x.minSize)||x.minSize<=0||!finite(x.sizeStep)||x.sizeStep<=0)issues.push('SIZE_RULES_MISSING');
 if(x.contractIndependentlyVerified!==true||x.fxIndependentlyVerified!==true)issues.push('INDEPENDENT_VERIFICATION_MISSING');
 if(!finite(x.stopPips)||x.stopPips<=0)issues.push('STOP_MISSING');
 if(!finite(x.spreadPips)||x.spreadPips<0||x.spreadPips>POLICY.maxSpreadPips)issues.push('SPREAD_EXCEEDED');
 if(!finite(x.signalScore)||x.signalScore<POLICY.minSignalScore)issues.push('SIGNAL_SCORE_LOW');
 if(!Number.isSafeInteger(x.tradesToday)||x.tradesToday<0||x.tradesToday>=POLICY.maxTradesPerDay)issues.push('DAILY_TRADE_CAP');
 if(!finite(x.dailyLossGBP)||x.dailyLossGBP<0||x.dailyLossGBP>=POLICY.dailyLossGBP)issues.push('DAILY_LOSS_LIMIT');
 if(!Number.isSafeInteger(x.openPositions)||x.openPositions!==0)issues.push('EXISTING_OR_UNKNOWN_EXPOSURE');
 if(finite(x.size)&&finite(x.minSize)&&finite(x.sizeStep)&&x.sizeStep>0){
  if(x.size+1e-9<x.minSize)issues.push('BELOW_MINIMUM_SIZE');
  const steps=(x.size-x.minSize)/x.sizeStep;
  if(!Number.isFinite(steps)||Math.abs(steps-Math.round(steps))>1e-7)issues.push('SIZE_STEP_MISMATCH');
 }
 const risk=finite(x.size)&&finite(x.stopPips)&&finite(x.gbpPerPipPerUnit)?x.size*x.stopPips*x.gbpPerPipPerUnit:null;
 if(risk===null||risk<=0||risk>POLICY.riskGBP)issues.push('RISK_BUDGET_EXCEEDED_OR_UNKNOWN');
 if(risk!==null&&finite(x.dailyLossGBP)&&risk+x.dailyLossGBP>POLICY.dailyLossGBP)issues.push('AGGREGATE_DAILY_RISK_EXCEEDED');
 return {issues:[...new Set(issues)],estimatedRiskGBP:risk,eligibleForHumanReview:issues.length===0,certified:false,brokerOrderAllowed:false};
}
function chainCheck(intent,events){
 const issues=[];let prev='GENESIS',state=null;
 if(!events.length)issues.push('MISSING_EVENTS');
 for(const [index,e] of events.entries()){
  if(e.previous_hash!==prev)issues.push('BROKEN_PREVIOUS_HASH_'+index);
  const old=index===0?null:state;
  if(e.old_state!==old)issues.push('OLD_STATE_MISMATCH_'+index);
  const expected=sha({id:intent.id,old,next:e.new_state,note:e.note,previous:e.previous_hash});
  if(expected!==e.event_hash)issues.push('EVENT_HASH_MISMATCH_'+index);
  if(index===0&&(e.new_state!=='PREPARED'||e.note!=='REHEARSAL_ONLY'))issues.push('BAD_GENESIS_EVENT');
  prev=e.event_hash;state=e.new_state;
 }
 if(state!==intent.state)issues.push('FINAL_STATE_MISMATCH');
 return {id:intent.id,state:intent.state,eventCount:events.length,issues,verified:issues.length===0,scope:'REHEARSAL_ONLY',brokerOrderAllowed:false};
}
function createV150({requireAdmin,pool,v125,v140,readMarket}={}){
 if(typeof requireAdmin!=='function'||!v125||!v140||typeof readMarket!=='function')throw Error('V150_DEPENDENCY_MISSING');
 async function compare(){
  const contracts=[];
  for(const epic of EPICS){try{contracts.push(parseContract(await readMarket(epic),epic));}
   catch(e){contracts.push({requestedEpic:epic,issues:['IG_READ_FAILED'],error:String(e.message).slice(0,100),brokerOrderAllowed:false});}}
  return {targetEpic:TARGET,contracts,policy:POLICY,legacyPolicyConflict:'LEGACY_PREVIEW_DAILY_CAP_2_VS_V150_POLICY_3',certified:false,brokerOrderAllowed:false};
 }
 async function verifyIntent(id){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw Error('INVALID_INTENT_ID');
  if(!pool)throw Error('DATABASE_NOT_CONFIGURED');
  const c=await pool.connect();try{
   const a=await c.query('SELECT id,state,fingerprint,evidence_hash,details FROM mp_rehearsal_intents WHERE id=$1',[id]);
   if(!a.rows.length)throw Error('INTENT_NOT_FOUND');
   const b=await c.query('SELECT old_state,new_state,note,previous_hash,event_hash FROM mp_rehearsal_events WHERE intent_id=$1 ORDER BY seq',[id]);
   return chainCheck(a.rows[0],b.rows);
  }finally{c.release();}
 }
 async function rehearsal(){
  if(!pool||v125.diagnostics().database.initialized!==true)throw Error('REHEARSAL_DB_NOT_READY');
  const nonce=crypto.randomUUID(),fingerprint=sha({nonce,scope:'REHEARSAL_ONLY',epic:TARGET});
  const evidenceHash=sha({nonce,version:150,brokerWrite:false});
  const first=await v125.store.create({fingerprint,evidenceHash,details:{kind:'V150_RECOVERY_REHEARSAL',epic:TARGET,nonce}});
  if(!first.created)throw Error('REHEARSAL_CREATE_FAILED');
  const duplicate=await v125.store.create({fingerprint,evidenceHash,details:{kind:'V150_RECOVERY_REHEARSAL',epic:TARGET,nonce}});
  if(duplicate.created||duplicate.reason!=='DUPLICATE_FINGERPRINT')throw Error('DEDUPLICATION_FAILED');
  const before=await verifyIntent(first.id);
  if(!before.verified)throw Error('GENESIS_HASH_VERIFICATION_FAILED');
  await v125.store.transition(first.id,'CANCELLED','V150_SAFE_REHEARSAL_CANCELLED');
  const after=await verifyIntent(first.id);
  if(!after.verified)throw Error('EVENT_CHAIN_VERIFICATION_FAILED');
  return {id:first.id,created:true,duplicateRejected:true,state:'CANCELLED',eventCount:after.eventCount,chainVerified:true,restartVerification:'RECHECK_ID_AFTER_RENDER_RESTART',scope:'REHEARSAL_ONLY',brokerOrderAllowed:false};
 }
 function status(){const d=v125.diagnostics(),r=v140.report();return {version:'150.0.0',mode:'READ_ONLY_FAIL_CLOSED',policy:POLICY,instrumentGuard:instrumentGuard({signalEpic:TARGET,contractEpic:TARGET}),snapshot:d.snapshot,polling:d.polling,database:d.database,remainingCertifications:r.outstanding,certificationsPassed:0,certified:false,brokerOrderAllowed:false,unattendedOrderAllowed:false,readyForUnattendedDemo:false};}
 function tests(){const fakeId='12345678-1234-4234-8234-123456789012';const note='REHEARSAL_ONLY';const h=sha({id:fakeId,old:null,next:'PREPARED',note,previous:'GENESIS'});
  const t={wrongEpic:instrumentGuard({signalEpic:EPICS[1],contractEpic:TARGET}).issues.includes('SIGNAL_EPIC_MISMATCH'),missingContract:parseContract({instrument:{epic:TARGET},dealingRules:{}},TARGET).issues.includes('CONTRACT_SIZE_NOT_PROVIDED'),overRisk:riskPreview({epic:TARGET,contractEpic:TARGET,size:1,stopPips:12,gbpPerPipPerUnit:3}).issues.includes('RISK_BUDGET_EXCEEDED_OR_UNKNOWN'),zeroRisk:riskPreview({}).issues.includes('RISK_BUDGET_EXCEEDED_OR_UNKNOWN'),dailyCap:riskPreview({tradesToday:3}).issues.includes('DAILY_TRADE_CAP'),dailyLoss:riskPreview({dailyLossGBP:100}).issues.includes('DAILY_LOSS_LIMIT'),existingExposure:riskPreview({openPositions:1}).issues.includes('EXISTING_OR_UNKNOWN_EXPOSURE'),badStep:riskPreview({size:0.15,minSize:0.1,sizeStep:0.1}).issues.includes('SIZE_STEP_MISMATCH'),unverified:riskPreview({}).issues.includes('INDEPENDENT_VERIFICATION_MISSING'),goodChain:chainCheck({id:fakeId,state:'PREPARED'},[{old_state:null,new_state:'PREPARED',note,previous_hash:'GENESIS',event_hash:h}]).verified,tamperedChain:!chainCheck({id:fakeId,state:'PREPARED'},[{old_state:null,new_state:'PREPARED',note,previous_hash:'GENESIS',event_hash:'0'.repeat(64)}]).verified,noBrokerWrites:!status().brokerOrderAllowed,noUnattended:!status().readyForUnattendedDemo};
  return {passed:Object.values(t).every(Boolean),count:Object.keys(t).length,tests:t,brokerOrderAllowed:false};
 }
 function routes(app){const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req));}catch(e){res.status(503).json({error:String(e.message).slice(0,120),brokerOrderAllowed:false});}};
  app.get('/api/v150/status',requireAdmin,wrap(status));
  app.get('/api/v150/contracts/compare',requireAdmin,wrap(compare));
  app.post('/api/v150/risk/preview',requireAdmin,wrap(req=>riskPreview(req.body||{})));
  app.get('/api/v150/fault-tests',requireAdmin,wrap(tests));
  app.post('/api/v150/rehearsal/run',requireAdmin,wrap(rehearsal));
  app.get('/api/v150/rehearsal/verify/:id',requireAdmin,wrap(req=>verifyIntent(req.params.id)));
  app.post('/api/v150/arm',requireAdmin,(_req,res)=>res.status(409).json({error:'BROKER_DEALING_HARD_BLOCKED',brokerOrderAllowed:false}));
 }
 return {routes,status,compare,rehearsal,verifyIntent,tests};
}
module.exports={createV150,parseContract,instrumentGuard,riskPreview,chainCheck,POLICY,EPICS,TARGET};
