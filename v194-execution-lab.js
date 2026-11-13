'use strict';
// V194: durable IG DEMO execution lifecycle rehearsal. No broker write capability.
const crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const STATES=['PREPARED','SUBMITTING','UNKNOWN','CONFIRMED','PROTECTED','CLOSED','RECONCILED','CANCELLED'];
const NEXT={PREPARED:['CANCELLED','SUBMITTING'],SUBMITTING:['UNKNOWN','CONFIRMED'],UNKNOWN:['CONFIRMED'],CONFIRMED:['PROTECTED','UNKNOWN'],PROTECTED:['CLOSED','UNKNOWN'],CLOSED:['RECONCILED','UNKNOWN'],RECONCILED:[],CANCELLED:[]};
// Versioned, recursive canonical JSON: invariant to PostgreSQL JSONB key ordering.
const canonical=x=>JSON.stringify(normalize(x));
function normalize(x){
 if(Array.isArray(x))return x.map(normalize);
 if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,normalize(x[k])]));
 return x;
}
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const digest=x=>sha(canonical(x));
// v194 originally hashed insertion-ordered JSON before PostgreSQL JSONB reordered keys.
// Reconstruct ONLY the known original schemas for read-only legacy verification.
const legacyRead=x=>({at:x.at,epic:x.epic,checks:Object.fromEntries(['market','positions','accounts','confirmation'].filter(k=>Object.prototype.hasOwnProperty.call(x.checks||{},k)).map(k=>[k,legacyCheck(k,x.checks[k])])),brokerStateCertified:x.brokerStateCertified,unknownSubmissionRecovered:x.unknownSubmissionRecovered});
function legacyCheck(k,x){
 if(!x||x.ok===false&&Object.prototype.hasOwnProperty.call(x,'error'))return {ok:false,error:x?.error};
 if(k==='market')return {ok:x.ok,marketStatus:x.marketStatus,brokerTime:x.brokerTime};
 if(k==='positions')return {ok:x.ok,miniPositions:(x.miniPositions||[]).map(p=>({dealId:p.dealId,stopPresent:p.stopPresent,size:p.size}))};
 if(k==='accounts')return {ok:x.ok,currencies:x.currencies};
 return {ok:x.ok,dealStatus:x.dealStatus,dealId:x.dealId,epic:x.epic};
}
function legacyEvent(x){
 return {intentId:x.intentId,from:x.from,to:x.to,fence:x.fence,detail:x.detail?.mode==='REHEARSAL_ONLY'?{mode:x.detail.mode,noBrokerOrder:x.detail.noBrokerOrder}:{reason:x.detail?.reason}};
}
const legacyDigest=x=>sha(JSON.stringify(x));
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const safeErr=e=>String(e?.message||e).replace(/(?:CST|XST|token|password|secret)[^ ,;]*/gi,'[REDACTED]').slice(0,100);
function createV194({pool,readIG,requireAdmin}){
 if(!pool||typeof readIG!=='function'||typeof requireAdmin!=='function')throw Error('V194_MISSING_DEPENDENCIES');
 let ready=false;
 async function init(){await pool.query(`CREATE TABLE IF NOT EXISTS mp_v194_intents(id UUID PRIMARY KEY, epic TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('BUY','SELL')), state TEXT NOT NULL, fence BIGINT NOT NULL, fingerprint TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), detail JSONB NOT NULL DEFAULT '{}'::jsonb);
 CREATE SEQUENCE IF NOT EXISTS mp_v194_fence_seq;
 CREATE TABLE IF NOT EXISTS mp_v194_events(seq BIGSERIAL PRIMARY KEY, intent_id UUID NOT NULL REFERENCES mp_v194_intents(id), at TIMESTAMPTZ NOT NULL DEFAULT now(), from_state TEXT, to_state TEXT NOT NULL, detail JSONB NOT NULL, digest TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS mp_v194_broker_reads(id UUID PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), intent_id UUID REFERENCES mp_v194_intents(id), payload JSONB NOT NULL, digest TEXT NOT NULL);`);ready=true;}
 async function ensure(){if(!ready)await init();}
 async function prepare(x){await ensure();if(x?.confirm!=='PREPARE_REHEARSAL_ONLY'||x.epic!==EPIC||!['BUY','SELL'].includes(x.direction)||!uuid(x.operatorNonce))throw Error('INVALID_REHEARSAL_REQUEST');
  const client=await pool.connect();try{await client.query('BEGIN');const lock=await client.query('SELECT pg_try_advisory_xact_lock($1) AS ok',[194001]);if(!lock.rows[0]?.ok)throw Error('REHEARSAL_LOCK_BUSY');
   const active=await client.query("SELECT id FROM mp_v194_intents WHERE state NOT IN ('CANCELLED','RECONCILED') LIMIT 1");if(active.rows.length)throw Error('UNRESOLVED_INTENT_EXISTS');
   const fence=String((await client.query("SELECT nextval('mp_v194_fence_seq') AS n")).rows[0].n),id=crypto.randomUUID(),fingerprint=digest({epic:EPIC,direction:x.direction,operatorNonce:x.operatorNonce});
   const detail={mode:'REHEARSAL_ONLY',noBrokerOrder:true};await client.query('INSERT INTO mp_v194_intents(id,epic,direction,state,fence,fingerprint,detail) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[id,EPIC,x.direction,'PREPARED',fence,fingerprint,JSON.stringify(detail)]);
   const evt={intentId:id,from:null,to:'PREPARED',fence,detail};await client.query('INSERT INTO mp_v194_events(intent_id,from_state,to_state,detail,digest) VALUES($1,$2,$3,$4::jsonb,$5)',[id,null,'PREPARED',JSON.stringify(evt),digest(evt)]);
   await client.query('COMMIT');return {prepared:true,id,fence,state:'PREPARED',rehearsalOnly:true,brokerOrderAllowed:false};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}
 async function transition(x){await ensure();if(!uuid(x?.id)||!STATES.includes(x?.to)||x?.confirm!=='RECORD_REHEARSAL_TRANSITION')throw Error('INVALID_TRANSITION');
  // Deliberately cannot represent a successful broker state without broker evidence. No writes to IG.
  if(['SUBMITTING','CONFIRMED','PROTECTED','CLOSED','RECONCILED'].includes(x.to))throw Error('BROKER_STATE_REQUIRES_VERIFIED_EXECUTION_ADAPTER');
  const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query('SELECT * FROM mp_v194_intents WHERE id=$1 FOR UPDATE',[x.id]);if(!r.rows.length)throw Error('INTENT_NOT_FOUND');const prev=r.rows[0];if(String(prev.fence)!==String(x.fence))throw Error('STALE_FENCE');if(!NEXT[prev.state]?.includes(x.to))throw Error('INVALID_STATE_EDGE');
   const evt={intentId:x.id,from:prev.state,to:x.to,fence:String(prev.fence),detail:{reason:'REHEARSAL_OPERATOR_ACTION'}};
   await client.query('UPDATE mp_v194_intents SET state=$2,updated_at=now() WHERE id=$1',[x.id,x.to]);await client.query('INSERT INTO mp_v194_events(intent_id,from_state,to_state,detail,digest) VALUES($1,$2,$3,$4::jsonb,$5)',[x.id,prev.state,x.to,JSON.stringify(evt),digest(evt)]);await client.query('COMMIT');return {id:x.id,state:x.to,brokerOrderAllowed:false};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}
 async function brokerRead(x={}){await ensure();if(x.intentId&&!uuid(x.intentId))throw Error('INVALID_INTENT_ID');const paths=[['market','/markets/'+encodeURIComponent(EPIC),'3'],['positions','/positions','2'],['accounts','/accounts','1']];if(x.dealReference){if(!/^[a-zA-Z0-9_-]{4,80}$/.test(x.dealReference))throw Error('INVALID_REFERENCE');paths.push(['confirmation','/confirms/'+encodeURIComponent(x.dealReference),'1']);}
  const checks={};for(const [key,path,version] of paths){try{const data=await readIG(path,version);if(key==='market')checks[key]={ok:data?.instrument?.epic===EPIC,marketStatus:data?.snapshot?.marketStatus??null,brokerTime:data?.snapshot?.updateTime??null};else if(key==='positions')checks[key]={ok:Array.isArray(data?.positions),miniPositions:(data?.positions||[]).filter(p=>p.market?.epic===EPIC).map(p=>({dealId:p.position?.dealId||null,stopPresent:p.position?.stopLevel!=null,size:p.position?.size??null}))};else if(key==='accounts')checks[key]={ok:Array.isArray(data?.accounts),currencies:(data?.accounts||[]).map(a=>a.currency)};else checks[key]={ok:!!data,dealStatus:data?.dealStatus??null,dealId:data?.dealId??null,epic:data?.epic??null};}catch(e){checks[key]={ok:false,error:safeErr(e)};}}
  const payload={at:new Date().toISOString(),epic:EPIC,checks,brokerStateCertified:false,unknownSubmissionRecovered:false};const id=crypto.randomUUID(),hash=digest(payload);await pool.query('INSERT INTO mp_v194_broker_reads(id,intent_id,payload,digest) VALUES($1,$2,$3::jsonb,$4)',[id,x.intentId||null,JSON.stringify(payload),hash]);return {id,...payload,digest:hash,brokerOrderAllowed:false};}
 async function audit(){await ensure();const rows=await pool.query('SELECT id,state,fence,created_at FROM mp_v194_intents ORDER BY created_at DESC LIMIT 100');const reads=await pool.query('SELECT id,payload,digest FROM mp_v194_broker_reads ORDER BY at DESC LIMIT 500');const events=await pool.query('SELECT intent_id,detail,digest FROM mp_v194_events ORDER BY seq DESC LIMIT 500');const failures=[];let canonicalVerified=0,legacyVerified=0;
 for(const r of reads.rows){
  if(digest(r.payload)===r.digest){canonicalVerified++;continue;}
  if(legacyDigest(legacyRead(r.payload))===r.digest){legacyVerified++;continue;}
  failures.push({type:'BROKER_READ_HASH',id:r.id});
 }
 for(const e of events.rows){
  if(digest(e.detail)===e.digest){canonicalVerified++;continue;}
  if(legacyDigest(legacyEvent(e.detail))===e.digest){legacyVerified++;continue;}
  failures.push({type:'EVENT_HASH',id:e.intent_id});
 }const unresolved=rows.rows.filter(r=>!['CANCELLED','RECONCILED'].includes(r.state));return {verified:failures.length===0,hashAlgorithm:'CANONICAL_JSON_V2_WITH_LEGACY_V194_VERIFICATION',canonicalVerified,legacyVerified,failures,checkedReads:reads.rows.length,checkedEvents:events.rows.length,unresolved:unresolved.length,unresolvedIntents:unresolved.map(r=>({id:r.id,state:r.state,fence:String(r.fence)})),allHistoricalRowsAudited:false,brokerOrderAllowed:false};}
 function status(){return {version:'194.0.0',epic:EPIC,mode:'READ_ONLY_EXECUTION_LAB',databaseInitialized:ready,capabilities:['DURABLE_REHEARSAL_INTENTS','POSTGRES_TRANSACTION_LOCK_AND_FENCE','STALE_FENCE_REJECTION','GET_ONLY_BROKER_RECONCILIATION','CONFIRMATION_LOOKUP_READ_ONLY','IMMUTABLE_EVENT_DIGESTS','UNRESOLVED_INTENT_AUDIT'],certificationsPassed:0,certificationsRequired:7,brokerWriteIntegration:false,brokerOrderAllowed:false,readyForUnattendedDemo:false};}
 const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req.body||{},req.params||{}));}catch(e){res.status(409).json({error:safeErr(e),brokerOrderAllowed:false});}};
 function routes(app){app.get('/api/v194/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.post('/api/v194/intent/prepare',requireAdmin,wrap(prepare));app.post('/api/v194/intent/transition',requireAdmin,wrap(transition));app.post('/api/v194/broker/read',requireAdmin,wrap(brokerRead));app.get('/api/v194/audit',requireAdmin,wrap(audit));app.post('/api/v194/order/submit',requireAdmin,(_q,r)=>r.status(409).json({error:'BROKER_EXECUTION_NOT_CERTIFIED',brokerOrderAllowed:false}));}
 return {init,routes,status,prepare,transition,brokerRead,audit};
}
module.exports={createV194,EPIC,STATES,NEXT};
