'use strict';
// v242-v250 foundation: broker GET only. No IG write capability or operator arming.
const crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const CERTS=['historicalPaperAccounting','exchangeTimestampAndDelay','gbpPipValueAndDealSize','netDailyPnlAndFees','brokerStopLifecycle','unknownSubmissionRecovery','distributedExecutionLock'];
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const number=x=>typeof x==='number'&&Number.isFinite(x);
function evaluate({market,positions,accounts,request}={}){
 const errors=[];const m=market||{},s=m.snapshot||{},i=m.instrument||{},r=m.dealingRules||{};
 if(!m.instrument||i.epic!==EPIC)errors.push('BROKER_EPIC_NOT_CONFIRMED');
 if(s.marketStatus!=='TRADEABLE')errors.push('MARKET_NOT_TRADEABLE');
 if(!positive(s.bid)||!positive(s.offer)||s.offer<=s.bid)errors.push('BROKER_QUOTE_INVALID');
 if(!Array.isArray(positions?.positions))errors.push('POSITIONS_UNAVAILABLE');
 else if(positions.positions.length!==0)errors.push('ACCOUNT_HAS_OPEN_POSITIONS');
 if(!Array.isArray(accounts?.accounts)||!accounts.accounts.some(a=>a.currency==='GBP'&&a.accountType==='CFD'))errors.push('GBP_CFD_ACCOUNT_UNVERIFIED');
 if(request?.epic!==EPIC)errors.push('REQUEST_EPIC_MISMATCH');
 if(!['BUY','SELL'].includes(request?.side))errors.push('INVALID_SIDE');
 if(!positive(request?.size))errors.push('INVALID_SIZE');
 if(!positive(request?.stopPips)||request.stopPips<12)errors.push('INVALID_STOP');
 if(!positive(request?.targetPips))errors.push('INVALID_TARGET');
 const min=r.minDealSize?.value;
 if(!positive(min)||!r.minDealSize?.unit)errors.push('MIN_DEAL_RULES_INCOMPLETE');
 else if(positive(request?.size)&&request.size<min)errors.push('BELOW_BROKER_MIN_SIZE');
 if(!positive(r.minNormalStopOrLimitDistance?.value)||!r.minNormalStopOrLimitDistance?.unit)errors.push('STOP_RULES_INCOMPLETE');
 // No implicit assumption that IG's dealing rule distance is measured in pips.
 if(!number(request?.maxRiskGBP)||request.maxRiskGBP>25||request.maxRiskGBP<=0)errors.push('RISK_BUDGET_INVALID');
 // The following values require independent, non-client-supplied certification.
 errors.push('INDEPENDENT_GBP_PIP_VALUE_UNVERIFIED','FEES_AND_SLIPPAGE_UNVERIFIED','AUTHENTICATED_TIMESTAMP_AND_DELAY_UNVERIFIED','DAILY_ACCOUNTING_UNVERIFIED','BROKER_STOP_LIFECYCLE_UNVERIFIED','UNKNOWN_OUTCOME_RECOVERY_UNVERIFIED','BROKER_INTEGRATED_FENCING_UNVERIFIED');
 return {epic:EPIC,marketStatus:s.marketStatus||null,brokerMinSize:positive(min)?min:null,brokerMinSizeUnit:r.minDealSize?.unit||null,brokerStopRule:r.minNormalStopOrLimitDistance||null,quote:s.bid&&s.offer?{bid:s.bid,offer:s.offer,rawUpdateTime:s.updateTime||null}:null,errors:[...new Set(errors)],preflightChecksPassed:false,estimatedWorstCaseGBP:null,brokerOrderAllowed:false,independentlyCertified:false};
}
function createV242({pool,requireAdmin,readIG}={}){
 if(!pool||typeof requireAdmin!=='function'||typeof readIG!=='function')throw Error('V242_DEPENDENCIES_MISSING');
 let initialized=false;
 async function init(){await pool.query(`CREATE TABLE IF NOT EXISTS mp_v242_intents(id UUID PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), state TEXT NOT NULL CHECK(state IN ('REJECTED_PREFLIGHT','QUARANTINED')), payload JSONB NOT NULL, digest TEXT NOT NULL); CREATE TABLE IF NOT EXISTS mp_v242_events(id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), kind TEXT NOT NULL, payload JSONB NOT NULL, digest TEXT NOT NULL); CREATE TABLE IF NOT EXISTS mp_v242_fencing(singleton INTEGER PRIMARY KEY CHECK(singleton=1),epoch BIGINT NOT NULL DEFAULT 0); INSERT INTO mp_v242_fencing(singleton,epoch) VALUES(1,0) ON CONFLICT DO NOTHING;`);initialized=true;}
 async function ensure(){if(!initialized)await init();}
 const canonical=x=>JSON.stringify(sortDeep(x));
 const sortDeep=x=>Array.isArray(x)?x.map(sortDeep):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sortDeep(x[k])])):x;
 // Payload is deliberately flat to make JSONB digest deterministic.
 const hash=x=>crypto.createHash('sha256').update(canonical(x)).digest('hex');
 async function record(kind,fields){await ensure();const id=crypto.randomUUID();const payload={kind,at:new Date().toISOString(),...fields,brokerOrderAllowed:false};await pool.query('INSERT INTO mp_v242_events(id,kind,payload,digest) VALUES($1,$2,$3::jsonb,$4)',[id,kind,JSON.stringify(payload),hash(payload)]);return {id,...payload};}
 async function brokerFacts(){const results={};for(const [name,route,version] of [['market','/markets/'+encodeURIComponent(EPIC),'3'],['positions','/positions','2'],['accounts','/accounts','1']]){try{results[name]=await readIG(route,version);}catch(e){results[name]={error:String(e.message).slice(0,160)};}}return results;}
 async function snapshot(){const x=await brokerFacts();const summary={marketOk:!!x.market?.instrument,positionsOk:Array.isArray(x.positions?.positions),accountsOk:Array.isArray(x.accounts?.accounts),epic:x.market?.instrument?.epic||null,marketStatus:x.market?.snapshot?.marketStatus||null,positionsCount:x.positions?.positions?.length??null,gbpCfdAccounts:x.accounts?.accounts?.filter(a=>a.currency==='GBP'&&a.accountType==='CFD').length??null,brokerOrderAllowed:false};return record('AUTHENTICATED_BROKER_READ',summary);}
 async function prepare(b){if(b?.confirm!=='PREPARE_ONLY_NO_ORDER')throw Error('CONFIRM_PREPARE_ONLY');if(typeof b.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{12,80}$/.test(b.idempotencyKey))throw Error('IDEMPOTENCY_KEY_REQUIRED');await ensure();const existing=await pool.query('SELECT id,state,payload FROM mp_v242_intents WHERE idempotency_key=$1',[b.idempotencyKey]);if(existing.rowCount)return {id:existing.rows[0].id,state:existing.rows[0].state,duplicate:true,brokerOrderAllowed:false};const facts=await brokerFacts();const checks=evaluate({...facts,request:b});const id=crypto.randomUUID();const payload={idempotencyKey:b.idempotencyKey,epic:EPIC,side:b.side||null,size:number(b.size)?b.size:null,checks,brokerOrderAllowed:false};try{await pool.query('INSERT INTO mp_v242_intents(id,idempotency_key,state,payload,digest) VALUES($1,$2,$3,$4::jsonb,$5)',[id,b.idempotencyKey,'REJECTED_PREFLIGHT',JSON.stringify(payload),hash(payload)]);}catch(e){if(e.code==='23505'){const x=await pool.query('SELECT id,state FROM mp_v242_intents WHERE idempotency_key=$1',[b.idempotencyKey]);return {id:x.rows[0]?.id,state:x.rows[0]?.state,duplicate:true,brokerOrderAllowed:false};}throw e;}return {id,state:'REJECTED_PREFLIGHT',duplicate:false,...checks};}
 async function quarantine(b){if(b?.confirm!=='QUARANTINE_NO_ORDER'||!/^[-a-f0-9]{36}$/i.test(b?.intentId||''))throw Error('QUARANTINE_CONFIRMATION_REQUIRED');await ensure();const q=await pool.query("UPDATE mp_v242_intents SET state='QUARANTINED' WHERE id=$1 RETURNING id",[b.intentId]);if(!q.rowCount)throw Error('INTENT_NOT_FOUND');return record('QUARANTINED_FOR_REVIEW',{intentId:b.intentId,doNotResubmit:true});}
 async function fencingDrill(){await ensure();const c=await pool.connect();try{await c.query('BEGIN');const r=await c.query('UPDATE mp_v242_fencing SET epoch=epoch+1 WHERE singleton=1 RETURNING epoch');await c.query('COMMIT');return {epoch:String(r.rows[0].epoch),brokerIntegrated:false,brokerOrderAllowed:false};}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async function audit(){await ensure();const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const events=await c.query('SELECT id,payload,digest FROM mp_v242_events ORDER BY created_at,id');const intents=await c.query('SELECT id,payload,digest FROM mp_v242_intents ORDER BY created_at,id');const failures=[...events.rows,...intents.rows].filter(x=>hash(x.payload)!==x.digest).map(x=>x.id);await c.query('COMMIT');return {verified:failures.length===0,eventsChecked:events.rowCount,intentsChecked:intents.rowCount,failures,scope:'mp_v242_ONLY',brokerOrderAllowed:false};}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async function readiness(){const a=await audit();const q=await pool.query("SELECT state,count(*)::int AS n FROM mp_v242_intents GROUP BY state");return {version:'250.0.0-foundation',audit:a,intentStates:Object.fromEntries(q.rows.map(x=>[x.state,x.n])),certifications:Object.fromEntries(CERTS.map(x=>[x,{independentlyCertified:false}])),certificationsPassed:0,certificationsRequired:7,brokerWriteIntegration:false,readyForControlledDemo:false,readyForUnattendedDemo:false,brokerOrderAllowed:false};}
 const status=()=>({version:'250.0.0-foundation',mode:'AUTHENTICATED_GET_ONLY_EXECUTION_FOUNDATION',databaseInitialized:initialized,epic:EPIC,brokerWriteIntegration:false,brokerOrderAllowed:false,readyForUnattendedDemo:false});
 const wrap=fn=>(req,res)=>Promise.resolve().then(()=>fn(req.body||{},req)).then(x=>res.set('Cache-Control','no-store').json(x)).catch(e=>res.status(409).json({error:String(e.message).slice(0,180),brokerOrderAllowed:false}));
 function routes(app){for(const [name,fn] of [['status',status],['readiness',readiness],['audit',audit]])app.get('/api/v250/'+name,requireAdmin,wrap(fn));app.post('/api/v250/broker/snapshot',requireAdmin,wrap(snapshot));app.post('/api/v250/order/prepare',requireAdmin,wrap(prepare));app.post('/api/v250/recovery/quarantine',requireAdmin,wrap(quarantine));app.post('/api/v250/fencing/drill',requireAdmin,wrap(fencingDrill));for(const route of ['order/submit','order/approve','trading/arm','trading/auto-start'])app.post('/api/v250/'+route,requireAdmin,(_q,r)=>r.status(409).json({error:'BROKER_WRITE_NOT_IMPLEMENTED_OR_CERTIFIED',brokerOrderAllowed:false}));}
 return {init,routes,status,readiness,audit};
}
module.exports={createV242,evaluate};
