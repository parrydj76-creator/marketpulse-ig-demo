'use strict';
// v256-v270: unattended SHADOW execution readiness. IG GET only. NO broker writes.
const crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const CERTS=['historicalPaperAccounting','exchangeTimestampAndDelay','gbpPipValueAndDealSize','netDailyPnlAndFees','brokerStopLifecycle','unknownSubmissionRecovery','distributedExecutionLock'];
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const num=x=>typeof x==='number'&&Number.isFinite(x);
const id=()=>crypto.randomUUID();
function assessMarket(m,now=Date.now()){
 const s=m?.snapshot||{},i=m?.instrument||{},d=m?.dealingRules||{};
 const spread=num(s.bid)&&num(s.offer)&&s.offer>=s.bid?Math.round((s.offer-s.bid)/0.0001*10000)/10000:null;
 const utc=s.updateTimeUTC;
 const validUTC=typeof utc==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(utc);
 const parsed=validUTC?Date.parse(utc):NaN;
 const age=Number.isFinite(parsed)?(now-parsed)/1000:null;
 const reasons=[];
 if(i.epic!==EPIC)reasons.push('EPIC_MISMATCH');
 if(s.marketStatus!=='TRADEABLE')reasons.push('MARKET_NOT_TRADEABLE');
 if(spread===null||spread>2.5)reasons.push('SPREAD_UNAVAILABLE_OR_TOO_WIDE');
 if(age===null||age<0||age>15)reasons.push('UNAMBIGUOUS_UTC_FRESHNESS_MISSING');
 if(!num(s.delayTime)||s.delayTime!==0)reasons.push('BROKER_DELAY_UNVERIFIED');
 if(!num(d.minDealSize?.value)||!d.minDealSize?.unit)reasons.push('MIN_DEAL_RULE_MISSING');
 if(!d.dealSizeIncrement)reasons.push('DEAL_INCREMENT_UNVERIFIED');
 reasons.push('GBP_PIP_VALUE_UNCERTIFIED','STOP_FILL_AND_GAP_RISK_UNBOUNDED');
 return {epic:i.epic||null,spreadPips:spread,ageSeconds:age,delayTime:s.delayTime??null,quoteUTC:utc||null,marketStatus:s.marketStatus||null,minimumDealSize:d.minDealSize||null,dealSizeIncrement:d.dealSizeIncrement||null,readOnlyChecksPass:reasons.length===2,readyForBrokerOrders:false,reasons};
}
function riskStress(b){
 const errors=[];
 for(const k of ['size','stopPips','pipValueGBPPerPipPerSize','spreadPips','commissionGBP','slippageGBP','conversionBufferGBP','dailyLossGBP'])if(!num(b?.[k])||b[k]<0)errors.push('INVALID_'+k);
 if(!num(b?.size)||b.size<=0)errors.push('INVALID_SIZE');
 if(!num(b?.stopPips)||b.stopPips<12)errors.push('STOP_BELOW_POLICY');
 if(!Number.isInteger(b?.tradesToday)||b.tradesToday<0||b.tradesToday>=3)errors.push('TRADE_COUNT_POLICY');
 if(!Number.isInteger(b?.openPositions)||b.openPositions!==0)errors.push('OPEN_POSITION_POLICY');
 const base=errors.length?null:b.size*b.pipValueGBPPerPipPerSize*(b.stopPips+b.spreadPips)+b.commissionGBP+b.slippageGBP+b.conversionBufferGBP;
 const scenarios=base===null?null:[0,2,5,10,25].map(extraGapPips=>({extraGapPips,illustrativeLossGBP:Number((base+b.size*b.pipValueGBPPerPipPerSize*extraGapPips).toFixed(4)),within25GBP:base+b.size*b.pipValueGBPPerPipPerSize*extraGapPips<=25,within100DailyGBP:b.dailyLossGBP+base+b.size*b.pipValueGBPPerPipPerSize*extraGapPips<=100}));
 return {baseIllustrativeGBP:base,stressScenarios:scenarios,errors:[...errors,'CALLER_SUPPLIED_VALUES_NOT_CERTIFIED','UNBOUNDED_GAP_LOSS_POSSIBLE'],brokerOrderAllowed:false,certified:false};
}
function createV270({pool,requireAdmin,readIG}){
 if(!pool||typeof requireAdmin!=='function'||typeof readIG!=='function')throw Error('V270_DEPENDENCIES_MISSING');
 let initialized=false;
 async function init(){await pool.query(`
 CREATE TABLE IF NOT EXISTS mp_v270_events(id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), kind TEXT NOT NULL, payload JSONB NOT NULL, digest TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS mp_v270_shadow(id UUID PRIMARY KEY, key TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), state TEXT NOT NULL CHECK(state IN ('QUARANTINED','REJECTED','CLOSED_PAPER')), payload JSONB NOT NULL, digest TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS mp_v270_fence(singleton INT PRIMARY KEY CHECK(singleton=1), epoch BIGINT NOT NULL DEFAULT 0, holder TEXT, lease_until TIMESTAMPTZ);
 INSERT INTO mp_v270_fence(singleton,epoch) VALUES(1,0) ON CONFLICT DO NOTHING;
 `);initialized=true;}
 async function ensure(){if(!initialized)await init();}
 async function event(kind,payload){await ensure();const entry={kind,at:new Date().toISOString(),...payload,brokerOrderAllowed:false};const eventId=id();await pool.query('INSERT INTO mp_v270_events(id,kind,payload,digest) VALUES($1,$2,$3::jsonb,$4)',[eventId,kind,JSON.stringify(entry),digest(entry)]);return {id:eventId,...entry};}
 async function status(){await ensure();const q=await pool.query('SELECT epoch,holder,lease_until FROM mp_v270_fence WHERE singleton=1');return {version:'270.0.0-shadow-readiness',mode:'UNATTENDED_SHADOW_ONLY',databaseInitialized:true,lease:{epoch:String(q.rows[0].epoch),holder:q.rows[0].holder,leaseUntil:q.rows[0].lease_until},brokerWriteIntegration:false,brokerOrderAllowed:false,autoBrokerTrading:false};}
 async function market(){const m=await readIG('/markets/'+encodeURIComponent(EPIC),'3');return event('MARKET_READINESS',{market:assessMarket(m)});}
 async function stress(b){if(b?.confirm!=='SHADOW_STRESS_NO_ORDER')throw Error('CONFIRM_SHADOW_STRESS');return event('SHADOW_RISK_STRESS',{risk:riskStress(b)});}
 async function shadowPrepare(b){if(b?.confirm!=='SHADOW_ONLY_NO_ORDER'||typeof b.key!=='string'||!/^[a-zA-Z0-9_-]{12,80}$/.test(b.key))throw Error('INVALID_SHADOW_REQUEST');
  if(!['BUY','SELL'].includes(b.side)||!num(b.size)||b.size<=0)throw Error('INVALID_SIDE_OR_SIZE');
  await ensure();const m=await readIG('/markets/'+encodeURIComponent(EPIC),'3');const checks=assessMarket(m);
  const entry={epic:EPIC,key:b.key,side:b.side,size:b.size,checks,createdAt:new Date().toISOString(),brokerOrderAllowed:false};const shadowId=id();
  try{await pool.query('INSERT INTO mp_v270_shadow(id,key,state,payload,digest) VALUES($1,$2,$3,$4::jsonb,$5)',[shadowId,b.key,'QUARANTINED',JSON.stringify(entry),digest(entry)]);return {id:shadowId,state:'QUARANTINED',duplicate:false,checks,brokerOrderAllowed:false};}
  catch(e){if(e.code!=='23505')throw e;const q=await pool.query('SELECT id,state FROM mp_v270_shadow WHERE key=$1',[b.key]);return {id:q.rows[0].id,state:q.rows[0].state,duplicate:true,brokerOrderAllowed:false};}
 }
 async function rejectShadow(b){if(b?.confirm!=='REJECT_SHADOW_NO_ORDER'||!isUUID(b.id))throw Error('INVALID_SHADOW_REJECTION');await ensure();const c=await pool.connect();try{await c.query('BEGIN');const q=await c.query('SELECT state,payload,digest FROM mp_v270_shadow WHERE id=$1 FOR UPDATE',[b.id]);if(!q.rowCount)throw Error('SHADOW_NOT_FOUND');const row=q.rows[0];if(digest(row.payload)!==row.digest)throw Error('SHADOW_INTEGRITY_FAILED');if(row.state!=='QUARANTINED')throw Error('SHADOW_ALREADY_FINAL');const payload={...row.payload,rejectedAt:new Date().toISOString(),reason:'OPERATOR_REJECTED_NO_ORDER'};await c.query("UPDATE mp_v270_shadow SET state='REJECTED',payload=$2::jsonb,digest=$3,updated_at=now() WHERE id=$1",[b.id,JSON.stringify(payload),digest(payload)]);await c.query('COMMIT');return {id:b.id,state:'REJECTED',brokerOrderAllowed:false};}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 const isUUID=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
 async function fenceDrill(b){if(b?.confirm!=='DB_LEASE_DRILL_NO_ORDER')throw Error('CONFIRM_DB_LEASE_DRILL');await ensure();const worker='drill-'+id();const c=await pool.connect();try{await c.query('BEGIN');const q=await c.query("UPDATE mp_v270_fence SET epoch=epoch+1,holder=$1,lease_until=now()+interval '5 seconds' WHERE singleton=1 AND (holder IS NULL OR lease_until<now()) RETURNING epoch",[worker]);await c.query('COMMIT');if(!q.rowCount)return event('LEASE_DRILL_CONTENTION',{acquired:false,brokerFenceCertified:false});const epoch=String(q.rows[0].epoch);
 // Stale-worker rejection is tested against DB epoch, never broker API.
 const stale=await pool.query('SELECT 1 FROM mp_v270_fence WHERE singleton=1 AND epoch=$1 AND holder=$2 AND lease_until>now()',[Number(epoch)-1,worker]);
 const release=await pool.query('UPDATE mp_v270_fence SET holder=NULL,lease_until=NULL WHERE singleton=1 AND epoch=$1 AND holder=$2 RETURNING epoch',[epoch,worker]);
 return event('LEASE_DRILL',{acquired:true,epoch,staleEpochRejected:stale.rowCount===0,released:release.rowCount===1,brokerFenceCertified:false});
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async function unknownDrill(b){if(b?.confirm!=='UNKNOWN_OUTCOME_SHADOW_ONLY')throw Error('CONFIRM_UNKNOWN_SHADOW');return event('UNKNOWN_OUTCOME_QUARANTINE_DRILL',{brokerRequestSent:false,quarantined:true,brokerReconciliationCertified:false});}
 async function audit(){await ensure();const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const a=await c.query('SELECT id,payload,digest FROM mp_v270_events ORDER BY created_at,id');const b=await c.query('SELECT id,payload,digest,state FROM mp_v270_shadow ORDER BY created_at,id');const failures=[...a.rows,...b.rows].filter(x=>digest(x.payload)!==x.digest).map(x=>x.id);await c.query('COMMIT');return {verified:failures.length===0,eventsChecked:a.rowCount,shadowIntentsChecked:b.rowCount,failures,scope:'mp_v270_ONLY',brokerOrderAllowed:false};}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async function readiness(){const a=await audit();return {version:'270.0.0-shadow-readiness',audit:a,certifications:Object.fromEntries(CERTS.map(k=>[k,{independentlyCertified:false}])),certificationsPassed:0,certificationsRequired:7,readyForUnattendedShadow:a.verified,readyForControlledBrokerDemo:false,readyForUnattendedBrokerDemo:false,brokerOrderAllowed:false,blockers:['INDEPENDENT_GBP_PIP_VALUE','IG_TIMESTAMP_AND_DELAY','NET_ACCOUNTING','HISTORICAL_PAPER_ACCOUNTING','BROKER_STOP_LIFECYCLE','BROKER_FENCING','REAL_UNKNOWN_OUTCOME_RECOVERY']};}
 const wrap=fn=>(req,res)=>Promise.resolve().then(()=>fn(req.body||{},req)).then(v=>res.set('Cache-Control','no-store').json(v)).catch(e=>res.status(409).json({error:String(e.message).slice(0,180),brokerOrderAllowed:false}));
 function routes(app){for(const [route,fn] of [['status',status],['readiness',readiness],['audit',audit]])app.get('/api/v270/'+route,requireAdmin,wrap(fn));for(const [route,fn] of [['market/check',market],['risk/stress',stress],['shadow/prepare',shadowPrepare],['shadow/reject',rejectShadow],['fencing/lease-drill',fenceDrill],['recovery/unknown-drill',unknownDrill]])app.post('/api/v270/'+route,requireAdmin,wrap(fn));for(const route of ['order/submit','order/approve','trading/arm','trading/auto-start'])app.post('/api/v270/'+route,requireAdmin,(_req,res)=>res.status(409).json({error:'BROKER_WRITE_NOT_IMPLEMENTED_OR_CERTIFIED',brokerOrderAllowed:false}));}
 return {init,routes,status,readiness,audit};
}
module.exports={createV270,assessMarket,riskStress};
