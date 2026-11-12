 'use strict';
// v116-v125: evidence refresh + PostgreSQL-backed REHEARSAL intents only.
// No IG dealing callback is accepted. No path can arm legacy execution.
const crypto=require('node:crypto');
const LIMITS=Object.freeze({quoteMs:15000,snapshotMs:60000,riskGBP:25,dailyLossGBP:100,maxTrades:3,maxPositions:1});
const STATES=Object.freeze(['PREPARED','UNKNOWN','RECONCILED_NO_ORDER','RECONCILED_ORDER_EXISTS','REJECTED','CANCELLED']);
const sha=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const validDate=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
function freshness(timestamp,maxMs=LIMITS.snapshotMs,now=Date.now()){
 const t=validDate(timestamp)?Date.parse(timestamp):NaN,age=now-t;
 return {fresh:Number.isFinite(age)&&age>=0&&age<=maxMs,ageMs:Number.isFinite(age)?age:null,maxAgeMs:maxMs};
}
function evaluate({broker,previousLedgersHealthy=false,paperPaused=false,leaseBackend=false}={}){
 const issues=[],c=broker?.checks||{},f=freshness(broker?.at);
 if(!f.fresh)issues.push('STALE_OR_MISSING_SNAPSHOT');
 for(const n of ['market','positions','accounts'])if(c[n]?.ok!==true)issues.push('MISSING_'+n.toUpperCase());
 if(c.history?.historyComplete!==true)issues.push('INCOMPLETE_HISTORY');
 if(c.positions?.count!==0)issues.push('POSITION_EXPOSURE_OR_UNKNOWN');
 if(!previousLedgersHealthy)issues.push('UNHEALTHY_PRIOR_LEDGER');
 if(!paperPaused)issues.push('PAPER_NOT_PAUSED');
 if(!leaseBackend)issues.push('PERSISTENT_DATABASE_NOT_CONFIGURED');
 return {snapshot:f,issues,observedMarket:c.market?.marketStatus||null,observedPositions:c.positions?.count??null,
  contractCertified:false,accountingCertified:false,exchangeDelayCertified:false,protectiveStopsCertified:false,
  unknownSubmissionRecoveryCertified:false,distributedExecutionCertified:false,brokerOrderAllowed:false,
  readyForUnattendedDemo:false};
}
function faultTests(){
 const base={at:new Date().toISOString(),checks:{market:{ok:true,marketStatus:'TRADEABLE'},positions:{ok:true,count:0},accounts:{ok:true},history:{historyComplete:true}}};
 const d=(b,extra={})=>evaluate({broker:b,previousLedgersHealthy:true,paperPaused:true,leaseBackend:true,...extra});
 const tests={stale:!freshness('2020-01-01T00:00:00Z').fresh,future:!freshness('2099-01-01T00:00:00Z').fresh,
 missing:!freshness(null).fresh,missingMarket:d({...base,checks:{...base.checks,market:{ok:false}}}).issues.includes('MISSING_MARKET'),
 missingPositions:d({...base,checks:{...base.checks,positions:{ok:false}}}).issues.includes('MISSING_POSITIONS'),
 unexpectedExposure:d({...base,checks:{...base.checks,positions:{ok:true,count:1}}}).issues.includes('POSITION_EXPOSURE_OR_UNKNOWN'),
 historyIncomplete:d({...base,checks:{...base.checks,history:{historyComplete:false}}}).issues.includes('INCOMPLETE_HISTORY'),
 paperRunning:d(base,{paperPaused:false}).issues.includes('PAPER_NOT_PAUSED'),
 ledgerCorrupt:d(base,{previousLedgersHealthy:false}).issues.includes('UNHEALTHY_PRIOR_LEDGER'),
 noDatabase:d(base,{leaseBackend:false}).issues.includes('PERSISTENT_DATABASE_NOT_CONFIGURED'),
 noAutoCertification:!d(base).readyForUnattendedDemo,neverBrokerWrites:!d(base).brokerOrderAllowed,
 unknownNoRetry:!STATES.includes('SUBMITTING'),immutableRisk:Object.isFrozen(LIMITS)};
 return {passed:Object.values(tests).every(Boolean),count:Object.keys(tests).length,tests,brokerOrderAllowed:false};
}
// Dedicated schema: separate from existing paper and IG journals. Never modifies historical journals.
const SCHEMA=`CREATE TABLE IF NOT EXISTS mp_rehearsal_intents (
 id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 state TEXT NOT NULL CHECK (state IN ('PREPARED','UNKNOWN','RECONCILED_NO_ORDER','RECONCILED_ORDER_EXISTS','REJECTED','CANCELLED')),
 fingerprint TEXT NOT NULL UNIQUE, evidence_hash TEXT NOT NULL, details JSONB NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mp_rehearsal_events (
 seq BIGSERIAL PRIMARY KEY, intent_id UUID NOT NULL REFERENCES mp_rehearsal_intents(id),
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(), old_state TEXT, new_state TEXT NOT NULL,
 note TEXT NOT NULL, previous_hash TEXT NOT NULL, event_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mp_rehearsal_events_intent ON mp_rehearsal_events(intent_id,seq);`;
function createRehearsalStore(pool){
 async function transact(fn){if(!pool)throw Error('DATABASE_NOT_CONFIGURED');const c=await pool.connect();try{
  await c.query('BEGIN');const lock=await c.query('SELECT pg_try_advisory_xact_lock($1) AS locked',[125001]);
  if(lock.rows[0]?.locked!==true)throw Error('REHEARSAL_LOCK_BUSY');
  const result=await fn(c);await c.query('COMMIT');return result;
 }catch(e){try{await c.query('ROLLBACK')}catch{}throw e;}finally{c.release();}}
 async function initialize(){if(!pool)return {configured:false,initialized:false};const c=await pool.connect();try{await c.query(SCHEMA);return {configured:true,initialized:true};}finally{c.release();}}
 async function create({fingerprint,evidenceHash,details={}}){
  if(!/^[a-f0-9]{64}$/.test(fingerprint)||!/^[a-f0-9]{64}$/.test(evidenceHash))throw Error('INVALID_EVIDENCE_HASH');
  return transact(async c=>{
   const id=crypto.randomUUID();const r=await c.query(`INSERT INTO mp_rehearsal_intents(id,state,fingerprint,evidence_hash,details) VALUES($1,'PREPARED',$2,$3,$4) ON CONFLICT(fingerprint) DO NOTHING RETURNING id`,[id,fingerprint,evidenceHash,JSON.stringify(details)]);
   if(!r.rows.length)return {created:false,reason:'DUPLICATE_FINGERPRINT',brokerOrderAllowed:false};
   const h=sha({id,old:null,next:'PREPARED',note:'REHEARSAL_ONLY',previous:'GENESIS'});
   await c.query(`INSERT INTO mp_rehearsal_events(intent_id,old_state,new_state,note,previous_hash,event_hash) VALUES($1,NULL,'PREPARED','REHEARSAL_ONLY','GENESIS',$2)`,[id,h]);
   return {created:true,id,state:'PREPARED',brokerOrderAllowed:false};
  });
 }
 async function transition(id,next,note){
  if(!/^[0-9a-f-]{36}$/i.test(id)||!STATES.includes(next)||typeof note!=='string'||note.length<5||note.length>200)throw Error('INVALID_TRANSITION_INPUT');
  return transact(async c=>{
   const q=await c.query('SELECT state FROM mp_rehearsal_intents WHERE id=$1 FOR UPDATE',[id]);if(!q.rows.length)throw Error('UNKNOWN_INTENT');
   const old=q.rows[0].state;
   const allowed={PREPARED:['UNKNOWN','REJECTED','CANCELLED'],UNKNOWN:['RECONCILED_NO_ORDER','RECONCILED_ORDER_EXISTS'],RECONCILED_NO_ORDER:[],RECONCILED_ORDER_EXISTS:[],REJECTED:[],CANCELLED:[]};
   if(!allowed[old].includes(next))throw Error('INVALID_STATE_TRANSITION');
   const p=await c.query('SELECT event_hash FROM mp_rehearsal_events WHERE intent_id=$1 ORDER BY seq DESC LIMIT 1',[id]);const previous=p.rows[0]?.event_hash||'GENESIS';
   const hash=sha({id,old,next,note,previous});
   await c.query('UPDATE mp_rehearsal_intents SET state=$2,updated_at=now() WHERE id=$1',[id,next]);
   await c.query('INSERT INTO mp_rehearsal_events(intent_id,old_state,new_state,note,previous_hash,event_hash) VALUES($1,$2,$3,$4,$5,$6)',[id,old,next,note,previous,hash]);
   return {id,previousState:old,state:next,eventHash:hash,autoRetry:false,brokerOrderAllowed:false};
  });
 }
 async function summary(){if(!pool)return {configured:false,initialized:false};const c=await pool.connect();try{
  const q=await c.query(`SELECT state,COUNT(*)::integer AS count FROM mp_rehearsal_intents GROUP BY state`);
  return {configured:true,counts:q.rows,brokerOrderAllowed:false};
 }finally{c.release();}}
 return {initialize,create,transition,summary,configured:!!pool};
}
function createV125({requireAdmin,v86,v95,v115,pool=null,refreshIntervalMs=0}={}){
 if(typeof requireAdmin!=='function'||!v86||!v95||!v115)throw Error('MISSING_DEPENDENCY');
 const store=createRehearsalStore(pool);let lastPoll=null,busy=false,timer=null,initialized=false,initError=null;
 const interval=Number(refreshIntervalMs);const pollingEnabled=Number.isSafeInteger(interval)&&interval>=60000&&interval<=3600000;
 async function initialize(){if(pool){try{await store.initialize();initialized=true;}catch(e){initError=String(e.message).slice(0,100);}}}
 function diagnostics(){const s=v95.status(),b=v86.status();return {version:'125.0.0',mode:'READ_ONLY_FAIL_CLOSED',
  ...evaluate({broker:s.lastEvidence,previousLedgersHealthy:s.ledgerHealthy===true&&v115.status().ledgerHealthy===true,paperPaused:b.paperPaused===true&&b.paperSchedulerRunning!==true,leaseBackend:!!pool&&initialized}),
  database:{configured:!!pool,initialized,initError,scope:'REHEARSAL_ONLY'},polling:{enabled:pollingEnabled,running:!!timer,busy,lastPoll,intervalMs:pollingEnabled?interval:null},
  tests:faultTests(),remainingCertifications:['HISTORICAL_PAPER_ACCOUNTING','EXCHANGE_TIMESTAMP_AND_DELAY','GBP_PIP_VALUE_AND_DEAL_SIZE','NET_DAILY_PNL_AND_FEES','BROKER_STOP_LIFECYCLE','UNKNOWN_SUBMISSION_RECOVERY','DISTRIBUTED_EXECUTION_LOCK'],
  brokerOrderAllowed:false,unattendedOrderAllowed:false,readyForUnattendedDemo:false};}
 async function refresh(){if(busy)throw Error('REFRESH_BUSY');busy=true;try{
  const r=await v115.refresh();lastPoll={at:new Date().toISOString(),ok:r.refresh?.recorded===true,marketOk:r.refresh?.marketOk===true,positionsOk:r.refresh?.positionsOk===true,accountsOk:r.refresh?.accountsOk===true,historyComplete:r.refresh?.historyComplete===true};
  return {refresh:lastPoll,diagnostics:diagnostics(),brokerOrderAllowed:false};
 }catch(e){lastPoll={at:new Date().toISOString(),ok:false,error:String(e.message).slice(0,100)};throw e;}finally{busy=false;}}
 function start(){if(!pollingEnabled||timer)return false;timer=setInterval(()=>{refresh().catch(()=>{});},interval);timer.unref?.();return true;}
 function stop(){if(timer){clearInterval(timer);timer=null;}}
 function routes(app){const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req));}catch(e){res.status(503).json({error:String(e.message).slice(0,120),brokerOrderAllowed:false});}};
 app.get('/api/v125/status',requireAdmin,wrap(()=>diagnostics()));app.get('/api/v125/diagnostics',requireAdmin,wrap(()=>diagnostics()));
 app.get('/api/v125/fault-tests',requireAdmin,wrap(()=>faultTests()));
 app.get('/api/v125/rehearsal/summary',requireAdmin,wrap(()=>store.summary()));
 app.post('/api/v125/refresh',requireAdmin,wrap(()=>refresh()));
 // Explicit rehearsal-only intents: no trading symbol, direction, size or order fields accepted.
 app.post('/api/v125/rehearsal/create',requireAdmin,wrap(async req=>{
  if(!initialized)throw Error('REHEARSAL_DATABASE_NOT_READY');
  const b=req.body||{};if(Object.keys(b).some(k=>!['fingerprint','evidenceHash','note'].includes(k)))throw Error('UNSUPPORTED_FIELDS');
  return store.create({fingerprint:b.fingerprint,evidenceHash:b.evidenceHash,details:{note:String(b.note||'').slice(0,200),kind:'NO_BROKER_ORDER'}});
 }));
 app.post('/api/v125/rehearsal/transition',requireAdmin,wrap(async req=>{
  if(!initialized)throw Error('REHEARSAL_DATABASE_NOT_READY');const b=req.body||{};
  if(Object.keys(b).some(k=>!['id','state','note'].includes(k)))throw Error('UNSUPPORTED_FIELDS');
  return store.transition(b.id,b.state,b.note);
 }));
 app.post('/api/v125/arm',requireAdmin,(_q,r)=>r.status(409).json({error:'IG_DEALING_HARD_BLOCKED',brokerOrderAllowed:false}));
 }
 return {initialize,start,stop,refresh,diagnostics,routes,store};
}
module.exports={createV125,createRehearsalStore,evaluate,freshness,faultTests,STATES,LIMITS,SCHEMA};
