'use strict';
// V195 fail-closed evidence and recovery workbench. No broker writes.
const crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const CATEGORIES=['historicalPaperAccounting','exchangeTimestampAndDelay','gbpPipValueAndDealSize','netDailyPnlAndFees','brokerStopLifecycle','unknownSubmissionRecovery','distributedExecutionLock'];
function normalize(x){if(Array.isArray(x))return x.map(normalize);if(x&&typeof x==='object'){if(x instanceof Date)return x.toISOString();return Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,normalize(x[k])]));}return x;}
const canonical=x=>JSON.stringify(normalize(x));
const digest=x=>crypto.createHash('sha256').update(canonical(x)).digest('hex');
function createV195({pool,requireAdmin,v194,v193}={}){
 if(!pool||typeof requireAdmin!=='function'||!v194||typeof v194.audit!=='function')throw Error('V195_DEPENDENCIES_MISSING');
 let ready=false;
 async function init(){await pool.query(`CREATE TABLE IF NOT EXISTS mp_v195_audit_runs (id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), payload JSONB NOT NULL, digest TEXT NOT NULL, hash_version TEXT NOT NULL DEFAULT 'CANONICAL_JSON_V2'); CREATE INDEX IF NOT EXISTS mp_v195_audit_runs_created_idx ON mp_v195_audit_runs(created_at DESC);`);ready=true;}
 async function ensure(){if(!ready)await init();}
 async function report(){await ensure();const a=await v194.audit();const p=v193&&typeof v193.integrity==='function'?await v193.integrity():{verified:false,reason:'V193_INTEGRITY_UNAVAILABLE'};const history=await pool.query('SELECT count(*)::int AS total FROM mp_v195_audit_runs');const problems=[];
 if(!a.verified)problems.push('V194_INTEGRITY_FAILED');
 if(!p.verified)problems.push('EARLIER_EVIDENCE_INTEGRITY_FAILED');
 if(a.unresolved>0)problems.push('UNRESOLVED_REHEARSAL_INTENTS');
 if(a.allHistoricalRowsAudited!==true||p.allHistoricalRowsAudited!==true)problems.push('AUDIT_SAMPLE_NOT_FULL_HISTORY');
 problems.push('SEVEN_INDEPENDENT_CERTIFICATIONS_OUTSTANDING');
 return {version:'195.0.0',mode:'FAIL_CLOSED_EVIDENCE_GATE',epic:EPIC,at:new Date().toISOString(),evidence:{v194:a,prior:p,priorV195AuditRuns:history.rows[0].total},blockers:problems,certifications:Object.fromEntries(CATEGORIES.map(k=>[k,{passed:false}])),certificationsPassed:0,certificationsRequired:7,brokerWriteIntegration:false,brokerOrderAllowed:false,readyForUnattendedDemo:false};}
 async function runAudit(){await ensure();const r=await report();const payload={at:r.at,epic:EPIC,blockers:r.blockers,evidence:{v194:r.evidence.v194,prior:r.evidence.prior},certificationsPassed:0,brokerOrderAllowed:false};const id=crypto.randomUUID(),hash=digest(payload);await pool.query('INSERT INTO mp_v195_audit_runs(id,payload,digest) VALUES($1,$2::jsonb,$3)',[id,JSON.stringify(payload),hash]);return {id,digest:hash,hashVersion:'CANONICAL_JSON_V2',...payload,verified:r.blockers.length===0,brokerOrderAllowed:false};}
 async function verify(id){await ensure();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw Error('INVALID_ID');const q=await pool.query('SELECT payload,digest,hash_version FROM mp_v195_audit_runs WHERE id=$1',[id]);if(!q.rows.length)return {found:false,verified:false,brokerOrderAllowed:false};const row=q.rows[0];return {found:true,verified:row.hash_version==='CANONICAL_JSON_V2'&&digest(row.payload)===row.digest,hashVersion:row.hash_version,brokerOrderAllowed:false};}
 async function list(){await ensure();const q=await pool.query('SELECT id,created_at,digest,hash_version FROM mp_v195_audit_runs ORDER BY created_at DESC LIMIT 50');return {records:q.rows,brokerOrderAllowed:false};}
 async function checkAll(){await ensure();const q=await pool.query('SELECT id,payload,digest,hash_version FROM mp_v195_audit_runs ORDER BY created_at DESC LIMIT 500');const failures=q.rows.filter(x=>x.hash_version!=='CANONICAL_JSON_V2'||digest(x.payload)!==x.digest).map(x=>x.id);return {verified:failures.length===0,checked:q.rows.length,failures,allHistoricalRowsAudited:false,brokerOrderAllowed:false};}
 function status(){return {version:'195.0.0',mode:'FAIL_CLOSED_EVIDENCE_GATE',epic:EPIC,databaseInitialized:ready,features:['V194_CANONICAL_HASH_HOTFIX_BUNDLED','LEGACY_V194_DIGEST_COMPATIBILITY','CROSS_VERSION_READINESS_GATE','PERSISTENT_AUDIT_SNAPSHOTS','RESTART_SAFE_HASH_VERIFICATION','FAIL_CLOSED_EXECUTION_BLOCK'],certificationsPassed:0,certificationsRequired:7,brokerWriteIntegration:false,brokerOrderAllowed:false,readyForUnattendedDemo:false};}
 const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req.params?.id));}catch(e){res.status(409).json({error:String(e.message).slice(0,140),brokerOrderAllowed:false});}};
 function routes(app){app.get('/api/v195/status',requireAdmin,wrap(status));app.get('/api/v195/readiness',requireAdmin,wrap(report));app.post('/api/v195/audit/run',requireAdmin,wrap(runAudit));app.get('/api/v195/audit/verify/:id',requireAdmin,wrap(verify));app.get('/api/v195/audit/list',requireAdmin,wrap(list));app.get('/api/v195/audit/integrity',requireAdmin,wrap(checkAll));app.post('/api/v195/order/submit',requireAdmin,(_req,res)=>res.status(409).json({error:'V195_BROKER_ORDER_HARD_BLOCKED',brokerOrderAllowed:false}));}
 return {init,routes,status,report,runAudit,verify,list,checkAll};
}
module.exports={createV195,normalize,canonical,digest,CATEGORIES};
