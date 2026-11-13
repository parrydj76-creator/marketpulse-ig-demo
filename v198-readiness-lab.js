 'use strict';
// v198: durable, read-only IG DEMO readiness and restart verification. No broker writes.
const crypto=require('node:crypto');
const {digest}=require('./v195-readiness-gate');
const EPIC='CS.D.EURUSD.MINI.IP';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DDL=`CREATE TABLE IF NOT EXISTS mp_v198_evidence (
 id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 kind TEXT NOT NULL CHECK (kind IN ('BROKER_SNAPSHOT','RESTART_PROBE','FAULT_REHEARSAL')),
 payload JSONB NOT NULL, digest TEXT NOT NULL, hash_version TEXT NOT NULL DEFAULT 'CANONICAL_JSON_V2');
 CREATE INDEX IF NOT EXISTS mp_v198_evidence_kind_time ON mp_v198_evidence(kind,created_at DESC);`;
const faults=Object.freeze({
 BEFORE_SEND:{state:'CANCELLED',retry:false,review:false},
 AFTER_SEND_TIMEOUT:{state:'UNKNOWN',retry:false,review:true},
 DUPLICATE_WORKER:{state:'BLOCKED',retry:false,review:true},
 CRASH_AFTER_PREPARE:{state:'RECONCILIATION_REQUIRED',retry:false,review:true},
 STALE_FENCE:{state:'BLOCKED',retry:false,review:true},
 BROKER_REJECT:{state:'CANCELLED',retry:false,review:true},
 MISSING_STOP:{state:'HALTED',retry:false,review:true},
 PARTIAL_FILL:{state:'HALTED',retry:false,review:true},
 RESTART_UNKNOWN:{state:'UNKNOWN',retry:false,review:true},
 DB_UNAVAILABLE:{state:'HALTED',retry:false,review:true},
 STALE_MARKET:{state:'HALTED',retry:false,review:true},
 ACCOUNT_MISMATCH:{state:'HALTED',retry:false,review:true}
});
function createV198({pool,requireAdmin,readIG,v197,v196}={}){
 if(!pool||typeof requireAdmin!=='function'||typeof readIG!=='function'||!v197||!v196)throw Error('V198_DEPENDENCIES_MISSING');
 let initialized=false;
 async function init(){await pool.query(DDL);initialized=true;}
 async function ensure(){if(!initialized)await init();}
 async function store(kind,payload){await ensure();const id=crypto.randomUUID(),hash=digest(payload);await pool.query('INSERT INTO mp_v198_evidence(id,kind,payload,digest) VALUES($1,$2,$3::jsonb,$4)',[id,kind,JSON.stringify(payload),hash]);return {id,kind,digest:hash,brokerOrderAllowed:false};}
 async function verify(id){await ensure();if(!UUID.test(id||''))throw Error('INVALID_ID');const r=await pool.query('SELECT id,kind,payload,digest,hash_version,created_at FROM mp_v198_evidence WHERE id=$1',[id]);if(!r.rowCount)return {found:false,verified:false,brokerOrderAllowed:false};const x=r.rows[0];return {found:true,id:x.id,kind:x.kind,hashVersion:x.hash_version,createdAt:x.created_at,verified:digest(x.payload)===x.digest,brokerOrderAllowed:false};}
 async function audit(){await ensure();const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const n=await c.query('SELECT count(*)::bigint AS n FROM mp_v198_evidence');const count=Number(n.rows[0].n);if(!Number.isSafeInteger(count)||count>100000){await c.query('ROLLBACK');return {verified:false,fullHistory:false,checked:0,reason:'ROW_CEILING_EXCEEDED',brokerOrderAllowed:false};}const r=await c.query('SELECT id,kind,payload,digest FROM mp_v198_evidence ORDER BY created_at,id');const failures=r.rows.filter(x=>digest(x.payload)!==x.digest).map(x=>({id:x.id,kind:x.kind,reason:'HASH_MISMATCH'}));await c.query('COMMIT');return {verified:failures.length===0,fullHistory:true,checked:r.rowCount,failures,brokerOrderAllowed:false};}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async function restartProbe(){const payload={kind:'RESTART_PROBE',epic:EPIC,createdAt:new Date().toISOString(),challenge:crypto.randomUUID(),note:'Verify by ID after a Render restart; no broker activity'};return {...await store('RESTART_PROBE',payload),challenge:payload.challenge};}
 async function brokerSnapshot(){const routes=[['market','/markets/'+encodeURIComponent(EPIC),'3'],['positions','/positions','2'],['accounts','/accounts','1']];const settled=await Promise.allSettled(routes.map(([,route,v])=>readIG(route,v)));const checks={};for(let i=0;i<routes.length;i++){const name=routes[i][0],r=settled[i];if(r.status==='rejected'){checks[name]={ok:false,error:String(r.reason?.message||r.reason).slice(0,120)};continue;}const v=r.value;checks[name]={ok:name==='market'?Boolean(v?.instrument&&v?.snapshot):name==='positions'?Array.isArray(v?.positions):Array.isArray(v?.accounts)};if(name==='market'&&checks[name].ok){checks[name].marketStatus=v.snapshot.marketStatus||null;checks[name].brokerTime=v.snapshot.updateTime||null;checks[name].delayMinutes=v.snapshot.delayTime??null;}if(name==='positions'&&checks[name].ok)checks[name].miniPositionCount=v.positions.filter(p=>p.market?.epic===EPIC).length;if(name==='accounts'&&checks[name].ok)checks[name].currencies=v.accounts.map(a=>a.currency||null);}
 const payload={kind:'BROKER_SNAPSHOT',epic:EPIC,observedAt:new Date().toISOString(),checks,complete:Object.values(checks).every(c=>c.ok),exchangeTimeCertified:false,gbpSizingCertified:false,brokerOrderAllowed:false};return {...await store('BROKER_SNAPSHOT',payload),...payload};}
 async function rehearse(x){if(x?.confirm!=='SIMULATION_ONLY_NO_ORDER'||!Object.hasOwn(faults,x?.scenario))throw Error('INVALID_SIMULATION_CONFIRMATION_OR_SCENARIO');const result=faults[x.scenario];const payload={kind:'FAULT_REHEARSAL',epic:EPIC,at:new Date().toISOString(),scenario:x.scenario,...result,simulated:true,submissionAttempted:false,brokerOrderAllowed:false};return {...await store('FAULT_REHEARSAL',payload),...payload};}
 async function readiness(){const [own,previous,history]=await Promise.all([audit(),v197.readiness(),v196.fullAudit? v196.fullAudit():Promise.resolve(null)]);const blockers=[...new Set([...(previous.blockers||[]),...(!own.verified?['V198_EVIDENCE_INTEGRITY_FAILED']:[]),'SEVEN_INDEPENDENT_CERTIFICATIONS_OUTSTANDING','NO_BROKER_WRITE_ADAPTER','REAL_IG_STOP_AND_CRASH_RECOVERY_UNTESTED'])];return {version:'198.0.0',audit:own,prior:previous.audit,priorFullHistory:history,blockers,certificationsPassed:0,certificationsRequired:7,brokerWriteIntegration:false,brokerOrderAllowed:false,readyForUnattendedDemo:false};}
 function status(){return {version:'198.0.0',epic:EPIC,mode:'READ_ONLY_RESTART_AND_FAULT_LAB',databaseInitialized:initialized,features:['DURABLE_RESTART_CHALLENGE','CANONICAL_HASH_ROUND_TRIP','FULL_V198_EVIDENCE_AUDIT','TWELVE_FAIL_CLOSED_FAULT_REHEARSALS','GET_ONLY_IG_SNAPSHOT','V197_READINESS_GATE'],certificationsPassed:0,certificationsRequired:7,brokerWriteIntegration:false,brokerOrderAllowed:false,readyForUnattendedDemo:false};}
 const wrap=f=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await f(req));}catch(e){res.status(409).json({error:String(e.message).slice(0,160),brokerOrderAllowed:false});}};
 function routes(app){app.get('/api/v198/status',requireAdmin,wrap(status));app.get('/api/v198/readiness',requireAdmin,wrap(readiness));app.get('/api/v198/audit',requireAdmin,wrap(audit));app.post('/api/v198/restart/probe',requireAdmin,wrap(restartProbe));app.get('/api/v198/evidence/:id/verify',requireAdmin,wrap(req=>verify(req.params.id)));app.post('/api/v198/broker/snapshot',requireAdmin,wrap(brokerSnapshot));app.get('/api/v198/fault/scenarios',requireAdmin,wrap(()=>({scenarios:Object.entries(faults).map(([scenario,v])=>({scenario,...v,simulated:true,brokerOrderAllowed:false})),brokerOrderAllowed:false})));app.post('/api/v198/fault/rehearse',requireAdmin,wrap(req=>rehearse(req.body)));app.post('/api/v198/order/submit',requireAdmin,(_req,res)=>res.status(409).json({error:'BROKER_ORDER_HARD_BLOCKED_V198',brokerOrderAllowed:false}));}
 return {init,routes,status,audit,readiness,verify,restartProbe,brokerSnapshot,rehearse};
}
module.exports={createV198,faults};
