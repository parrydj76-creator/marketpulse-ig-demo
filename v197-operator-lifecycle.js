 'use strict';
// v197: persistent, operator-reviewed demo lifecycle PREPARATION. No broker writes, no auto execution.
const crypto=require('node:crypto');
const {digest}=require('./v195-readiness-gate');
const EPIC='CS.D.EURUSD.MINI.IP';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES=['PREPARED','UNKNOWN','RECONCILIATION_REQUIRED','REVIEWED','CANCELLED'];
const TERMINAL=new Set(['REVIEWED','CANCELLED']);
const DDL=`CREATE TABLE IF NOT EXISTS mp_v197_intents(
 id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 epic TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('PREPARED','UNKNOWN','RECONCILIATION_REQUIRED','REVIEWED','CANCELLED')),
 fingerprint TEXT NOT NULL UNIQUE, fence BIGINT NOT NULL, details JSONB NOT NULL, digest TEXT NOT NULL);
 CREATE SEQUENCE IF NOT EXISTS mp_v197_fence_seq;
 CREATE TABLE IF NOT EXISTS mp_v197_events(
 id UUID PRIMARY KEY, intent_id UUID NOT NULL REFERENCES mp_v197_intents(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 event_type TEXT NOT NULL, payload JSONB NOT NULL, digest TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS mp_v197_events_intent ON mp_v197_events(intent_id,created_at);`;
function validUuid(x){return typeof x==='string'&&UUID.test(x);}
function sanitize(x){if(!x||typeof x!=='object'||Array.isArray(x))throw Error('INVALID_REQUEST');
 if(x.epic!==EPIC)throw Error('WRONG_EPIC');if(!['BUY','SELL'].includes(x.direction))throw Error('INVALID_DIRECTION');
 if(typeof x.operatorNonce!=='string'||x.operatorNonce.length<16||x.operatorNonce.length>128)throw Error('OPERATOR_NONCE_REQUIRED_16_TO_128');
 if(typeof x.note!=='string'||x.note.trim().length<8||x.note.length>500)throw Error('OPERATOR_NOTE_REQUIRED');
 return {epic:EPIC,direction:x.direction,operatorNonce:x.operatorNonce,note:x.note.trim(),createdAt:new Date().toISOString(),brokerSubmission:false};}
function decideTransition(from,to){const allowed={PREPARED:['CANCELLED','UNKNOWN','RECONCILIATION_REQUIRED'],UNKNOWN:['RECONCILIATION_REQUIRED'],RECONCILIATION_REQUIRED:['REVIEWED'],REVIEWED:[],CANCELLED:[]};return Boolean(allowed[from]?.includes(to));}
function createV197({pool,requireAdmin,readIG,v196}={}){
 if(!pool||typeof requireAdmin!=='function'||typeof readIG!=='function'||!v196)throw Error('V197_DEPENDENCIES_MISSING');
 let initialized=false;async function init(){await pool.query(DDL);initialized=true;}
 async function ensure(){if(!initialized)await init();}
 async function txn(fn){await ensure();const c=await pool.connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async function event(c,id,type,payload){const body={intentId:id,type,at:new Date().toISOString(),...payload};await c.query('INSERT INTO mp_v197_events(id,intent_id,event_type,payload,digest) VALUES($1,$2,$3,$4::jsonb,$5)',[crypto.randomUUID(),id,type,JSON.stringify(body),digest(body)]);}
 async function prepare(x){const details=sanitize(x);if(x.confirm!=='PREPARE_ONLY_NO_ORDER')throw Error('EXPLICIT_PREPARE_ONLY_CONFIRMATION_REQUIRED');
 // No sizing or order submission is accepted here; preparation does not certify any risk or broker state.
 return txn(async c=>{const lk=await c.query('SELECT pg_try_advisory_xact_lock($1) AS ok',[197001]);if(!lk.rows[0].ok)throw Error('PREPARATION_LOCK_BUSY');
 const open=await c.query("SELECT id,state FROM mp_v197_intents WHERE state NOT IN ('CANCELLED','REVIEWED') LIMIT 1");if(open.rowCount)throw Error('UNRESOLVED_INTENT_EXISTS');
 const fingerprint=digest({epic:EPIC,direction:details.direction,operatorNonce:details.operatorNonce});const id=crypto.randomUUID();
 const seq=await c.query("SELECT nextval('mp_v197_fence_seq') AS fence");const fence=String(seq.rows[0].fence);
 await c.query("INSERT INTO mp_v197_intents(id,epic,state,fingerprint,fence,details,digest) VALUES($1,$2,'PREPARED',$3,$4,$5::jsonb,$6)",[id,EPIC,fingerprint,fence,JSON.stringify(details),digest(details)]);
 await event(c,id,'PREPARED',{fence});return {id,state:'PREPARED',fence,brokerSubmission:false,brokerOrderAllowed:false};});}
 async function transition(id,target,confirm){if(!validUuid(id))throw Error('INVALID_ID');if(!STATES.includes(target)||!['CANCELLED','UNKNOWN','RECONCILIATION_REQUIRED','REVIEWED'].includes(target))throw Error('INVALID_TRANSITION');
 if(confirm!=='OPERATOR_REVIEW_NO_ORDER')throw Error('OPERATOR_CONFIRMATION_REQUIRED');return txn(async c=>{const lk=await c.query('SELECT pg_try_advisory_xact_lock($1) AS ok',[197001]);if(!lk.rows[0].ok)throw Error('TRANSITION_LOCK_BUSY');
 const r=await c.query('SELECT state FROM mp_v197_intents WHERE id=$1 FOR UPDATE',[id]);if(!r.rowCount)throw Error('INTENT_NOT_FOUND');const previous=r.rows[0].state;
 if(!decideTransition(previous,target))throw Error('INVALID_STATE_TRANSITION');await c.query('UPDATE mp_v197_intents SET state=$2,updated_at=now() WHERE id=$1',[id,target]);await event(c,id,'STATE_TRANSITION',{from:previous,to:target});return {id,previous,state:target,brokerOrderAllowed:false};});}
 async function reconcile(id){if(!validUuid(id))throw Error('INVALID_ID');await ensure();const r=await pool.query('SELECT id,state FROM mp_v197_intents WHERE id=$1',[id]);if(!r.rowCount)throw Error('INTENT_NOT_FOUND');
 // READ ONLY. No assertion that a missing position means an unknown order never reached IG.
 const [p,a]=await Promise.allSettled([readIG('/positions','2'),readIG('/accounts','1')]);
 const positions=p.status==='fulfilled'&&Array.isArray(p.value?.positions)?p.value.positions.filter(x=>x.market?.epic===EPIC).map(x=>({dealId:x.position?.dealId||null,direction:x.position?.direction||null,size:x.position?.size??null,stopLevel:x.position?.stopLevel??null})):null;
 const accountRead=a.status==='fulfilled'&&Array.isArray(a.value?.accounts);
 return {id,state:r.rows[0].state,positionReadOk:positions!==null,accountReadOk:accountRead,positions,absenceProvesNoSubmission:false,brokerOutcomeCertified:false,operatorReviewRequired:true,brokerOrderAllowed:false};}
 async function audit(){await ensure();const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const counts=await c.query('SELECT (SELECT count(*)::bigint FROM mp_v197_intents) AS intents,(SELECT count(*)::bigint FROM mp_v197_events) AS events');const n=Number(counts.rows[0].intents)+Number(counts.rows[0].events);
 if(n>100000){await c.query('ROLLBACK');return {verified:false,fullHistory:false,blockers:['ROW_CEILING_EXCEEDED'],brokerOrderAllowed:false};}
 const failures=[];let checked=0;for(const [table,col] of [['mp_v197_intents','details'],['mp_v197_events','payload']]){const q=await c.query(`SELECT id,${col} AS payload,digest FROM ${table}`);for(const r of q.rows){checked++;if(digest(r.payload)!==r.digest)failures.push({table,id:r.id,reason:'HASH_MISMATCH'});}}
 const unresolved=await c.query("SELECT id,state FROM mp_v197_intents WHERE state NOT IN ('CANCELLED','REVIEWED') ORDER BY created_at LIMIT 30");await c.query('COMMIT');return {verified:failures.length===0,fullHistory:true,checked,failures,unresolvedCount:unresolved.rowCount,unresolved:unresolved.rows,brokerOrderAllowed:false};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async function readiness(){const [a,prior]=await Promise.all([audit(),v196.readiness()]);const blockers=[...new Set([...prior.blockers.filter(x=>x!=='AUDIT_SAMPLE_NOT_FULL_HISTORY'),...(a.verified?[]:['V197_INTEGRITY_FAILED']),...(a.unresolvedCount?['UNRESOLVED_V197_INTENTS']:[]),'REAL_BROKER_STOP_AND_RECOVERY_TESTS_REQUIRED','NO_EXECUTION_ADAPTER'])];return {version:'197.0.0',audit:a,priorAudit:prior.audit,blockers,certificationsPassed:0,certificationsRequired:7,brokerWriteIntegration:false,brokerOrderAllowed:false,readyForUnattendedDemo:false};}
 function status(){return {version:'197.0.0',mode:'OPERATOR_REVIEW_ONLY_NO_BROKER_WRITES',databaseInitialized:initialized,epic:EPIC,features:['DURABLE_OPERATOR_INTENTS','TRANSACTION_FENCING','UNKNOWN_OUTCOME_NO_RETRY','READ_ONLY_IG_RECONCILIATION','FULL_V197_INTEGRITY','READINESS_GATE'],brokerWriteIntegration:false,brokerOrderAllowed:false,readyForUnattendedDemo:false};}
 const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req));}catch(e){res.status(409).json({error:String(e.message).slice(0,160),brokerOrderAllowed:false});}};
 function routes(app){app.get('/api/v197/status',requireAdmin,wrap(status));app.get('/api/v197/readiness',requireAdmin,wrap(readiness));app.get('/api/v197/audit',requireAdmin,wrap(audit));app.post('/api/v197/intent/prepare',requireAdmin,wrap(req=>prepare(req.body)));app.post('/api/v197/intent/:id/transition',requireAdmin,wrap(req=>transition(req.params.id,req.body?.state,req.body?.confirm)));app.get('/api/v197/intent/:id/reconcile',requireAdmin,wrap(req=>reconcile(req.params.id)));app.post('/api/v197/order/submit',requireAdmin,(_req,res)=>res.status(409).json({error:'BROKER_WRITE_HARD_BLOCKED_V197',brokerOrderAllowed:false}));}
 return {init,routes,status,audit,readiness,prepare,transition,reconcile};}
 module.exports={createV197,sanitize,decideTransition,STATES};
