'use strict';
// Independent, read-only readiness gate. NEVER passes IG write capabilities.
const crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const normalize=x=>Array.isArray(x)?x.map(normalize):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,normalize(x[k])])):x;
const canonical=x=>JSON.stringify(normalize(x));
const digest=x=>crypto.createHash('sha256').update(canonical(x)).digest('hex');
const CERTS=['historicalPaperAccounting','exchangeTimestampAndDelay','gbpPipValueAndDealSize','netDailyPnlAndFees','brokerStopLifecycle','unknownSubmissionRecovery','distributedExecutionLock'];
function createV195({pool,requireAdmin,v194}={}){
 if(!pool||typeof requireAdmin!=='function'||!v194||typeof v194.audit!=='function')throw Error('V195_MISSING_DEPENDENCIES');
 let ready=false;
 async function init(){await pool.query(`CREATE TABLE IF NOT EXISTS mp_v195_gate_runs (id UUID PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), payload JSONB NOT NULL, digest TEXT NOT NULL, algorithm TEXT NOT NULL DEFAULT 'CANONICAL_JSON_V2');`);ready=true;}
 async function ensure(){if(!ready)await init();}
 async function assess(){await ensure();const a=await v194.audit();const blockers=[];
 if(!a.verified)blockers.push('V194_INTEGRITY_FAILURE');
 if(a.unresolved!==0)blockers.push('UNRESOLVED_V194_REHEARSAL_INTENTS');
 if(a.allHistoricalRowsAudited!==true)blockers.push('INCOMPLETE_HISTORICAL_INTEGRITY_SCOPE');
 if(a.checkedReads===0)blockers.push('NO_BROKER_READ_EVIDENCE');
 // Important: neither rehearsal nor API responses certify broker execution.
 blockers.push('SEVEN_INDEPENDENT_CERTIFICATIONS_OUTSTANDING','BROKER_WRITE_ADAPTER_NOT_CERTIFIED');
 return {version:'195.0.0',epic:EPIC,mode:'READ_ONLY_FAIL_CLOSED',at:new Date().toISOString(),integrity:{verified:a.verified,checkedReads:a.checkedReads,checkedEvents:a.checkedEvents,legacyVerified:a.legacyVerified||0,canonicalVerified:a.canonicalVerified||0,failures:a.failures,unresolved:a.unresolved,allHistoricalRowsAudited:a.allHistoricalRowsAudited},certifications:Object.fromEntries(CERTS.map(k=>[k,{passed:false,requiresIndependentEvidence:true}])),certificationsPassed:0,certificationsRequired:7,blockers,brokerWriteIntegration:false,brokerOrderAllowed:false,readyForUnattendedDemo:false};}
 async function capture(){const payload=await assess();const id=crypto.randomUUID(),hash=digest(payload);await pool.query('INSERT INTO mp_v195_gate_runs(id,payload,digest) VALUES($1,$2::jsonb,$3)',[id,JSON.stringify(payload),hash]);const r=await pool.query('SELECT payload,digest FROM mp_v195_gate_runs WHERE id=$1',[id]);if(r.rows.length!==1||digest(r.rows[0].payload)!==r.rows[0].digest)throw Error('POSTGRES_JSONB_ROUNDTRIP_INTEGRITY_FAILED');return {id,digest:hash,roundTripVerified:true,...payload};}
 async function audit(){await ensure();let cursor=null,checked=0,failures=[],pages=0;const PAGE=200,MAX_PAGES=100;
 while(pages<MAX_PAGES){const r=await pool.query('SELECT id,payload,digest FROM mp_v195_gate_runs WHERE ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT $2',[cursor,PAGE]);pages++;
  for(const x of r.rows){checked++;if(digest(x.payload)!==x.digest)failures.push({id:x.id,reason:'DIGEST_MISMATCH'});}
  if(r.rows.length<PAGE)return {verified:failures.length===0,checked,failures,complete:true,pages,brokerOrderAllowed:false};
  cursor=r.rows[r.rows.length-1].id;
 }
 return {verified:false,checked,failures,complete:false,pages,reason:'AUDIT_PAGE_LIMIT_REACHED',brokerOrderAllowed:false};}
 const wrap=f=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await f());}catch(e){res.status(409).json({error:String(e.message).slice(0,150),brokerOrderAllowed:false});}};
 function routes(app){app.get('/api/v195/status',requireAdmin,wrap(assess));app.post('/api/v195/gate/capture',requireAdmin,wrap(capture));app.get('/api/v195/gate/audit',requireAdmin,wrap(audit));app.post('/api/v195/order/submit',requireAdmin,(_q,r)=>r.status(409).json({error:'V195_BROKER_EXECUTION_HARD_BLOCKED',brokerOrderAllowed:false}));}
 return {init,routes,assess,capture,audit};
}
module.exports={createV195,digest,canonical,CERTS};
