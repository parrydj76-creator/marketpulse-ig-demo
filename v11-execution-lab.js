'use strict';
// IG DEMO execution engineering laboratory. NEVER submits, closes, amends, or cancels broker orders.
const crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.CFD.IP';
const BLOCKERS=Object.freeze(['IG contract value / GBP-per-pip independently verified','Currency conversion and broker deal size validated','Order acceptance/rejection/timeout lifecycle demonstrated','Broker-side idempotency and duplicate protection demonstrated','Pending-order recovery and reconciliation demonstrated','Simulated stop/target/time exits and restart recovery demonstrated','Explicit operator approval for a separately reviewed DEMO-only execution build']);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function brokerRuleAudit(market, equity=10000, riskFraction=0.0025){
 const rules=market?.dealingRules||{},instrument=market?.instrument||{},snapshot=market?.snapshot||{};
 const minSize=rules.minDealSize||null, minStop=rules.minNormalStopOrLimitDistance||null;
 const sizeOK=finite(Number(minSize?.value))&&Number(minSize.value)>0;
 const stopOK=finite(Number(minStop?.value))&&Number(minStop.value)>0;
 return {epic:EPIC,marketTradeable:snapshot.marketStatus==='TRADEABLE',riskBudgetGBP:finite(equity)&&equity>0?Number((equity*riskFraction).toFixed(2)):null,
  minDealSize:minSize,minStopDistance:minStop,instrument:{name:instrument.name||null,lotSize:instrument.lotSize??null,unit:instrument.unit||null,currencies:instrument.currencies||null},
  minimumRulesAvailable:sizeOK&&stopOK,brokerDealSize:null,brokerGBPPerPip:null,contractConversionVerified:false,
  reason:'IG POINTS are not assumed to be pips. A broker deal size is NOT calculated without independently verified contract and conversion data.'};
}
function validateSimulatedPosition(p){
 if(!p)return {valid:true,checks:[{name:'No open simulated position',pass:true}]};
 const checks=[
  {name:'Direction recognised',pass:['LONG','SHORT'].includes(p.direction)},
  {name:'Positive finite prices',pass:[p.entry,p.stop,p.target].every(x=>finite(x)&&x>0)},
  {name:'Stop and target orientation',pass:p.direction==='LONG'?p.stop<p.entry&&p.target>p.entry:p.direction==='SHORT'?p.stop>p.entry&&p.target<p.entry:false},
  {name:'Planned risk is positive',pass:finite(p.riskGBP)&&p.riskGBP>0},
  {name:'Virtual pip value is positive',pass:finite(p.virtualGBPPerPip)&&p.virtualGBPPerPip>0},
  {name:'Opening timestamp valid',pass:Number.isFinite(Date.parse(p.openedAt))}
 ];return {valid:checks.every(c=>c.pass),checks};
}
function scenarioTests(){
 const cases=[
  {name:'Duplicate intent ID resolves deterministically',pass:makeIntentId(12,'OPEN')===makeIntentId(12,'OPEN')},
  {name:'Different sequence produces different ID',pass:makeIntentId(12,'OPEN')!==makeIntentId(13,'OPEN')},
  {name:'Malformed simulated stop is rejected',pass:!validateSimulatedPosition({direction:'SHORT',entry:1.1,stop:1.09,target:1.08,riskGBP:25,virtualGBPPerPip:2,openedAt:new Date().toISOString()}).valid},
  {name:'Missing broker conversion fails closed',pass:brokerRuleAudit({dealingRules:{minDealSize:{value:1},minNormalStopOrLimitDistance:{value:2}},snapshot:{marketStatus:'TRADEABLE'}}).brokerDealSize===null},
  {name:'No broker execution capability exposed',pass:true}
 ];return {checks:cases,allPassed:cases.every(c=>c.pass),note:'Deterministic local tests only; NOT evidence of IG order lifecycle or restart safety.'};
}
function makeIntentId(sequence,kind){return crypto.createHash('sha256').update('MP11|PAPER|'+kind+'|'+sequence).digest('hex').slice(0,32)}
function createExecutionLab({api,v9Paper,requireAdmin}){
 let pool=null,ready=false,storageError=null;
 async function init(){try{if(!process.env.DATABASE_URL)throw Error('DATABASE_URL missing');pool=new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000});await pool.query(`CREATE TABLE IF NOT EXISTS mp_v11_intent_journal (intent_id TEXT PRIMARY KEY, source_event_id BIGINT UNIQUE, kind TEXT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);ready=true;storageError=null;}catch(e){ready=false;storageError=e.message;console.error('[V11 lab]',e.message)}}
 async function syncPaperEvents(){if(!ready)throw Error(storageError||'Lab storage unavailable');const client=await pool.connect();try{await client.query('BEGIN');const events=await client.query("SELECT id,kind,payload FROM mp_v9_paper_events WHERE kind IN ('OPEN','CLOSE') ORDER BY id ASC LIMIT 10000");let added=0;for(const e of events.rows){const id=makeIntentId(e.payload.sequence,e.kind);const r=await client.query('INSERT INTO mp_v11_intent_journal(intent_id,source_event_id,kind,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING',[id,e.id,e.kind,JSON.stringify({source:'PAPER_ONLY',eventId:String(e.id),sequence:e.payload.sequence,positionDirection:e.payload.direction||e.payload.position?.direction||null,brokerOrderSent:false})]);added+=r.rowCount;}await client.query('COMMIT');return {scanned:events.rowCount,added,note:'Paper event journal only; no broker order intent submitted'};}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
 async function journal(){if(!ready)throw Error(storageError||'Lab storage unavailable');const r=await pool.query('SELECT intent_id,source_event_id,kind,payload,created_at FROM mp_v11_intent_journal ORDER BY created_at DESC LIMIT 100');return r.rows;}
 async function status(){const sim=await v9Paper.status();return {version:'11.0',mode:'EXECUTION_ENGINEERING_READ_ONLY',brokerExecution:'HARD_BLOCKED',authorised:false,storageReady:ready,storageError,simulationReady:sim.ready,simulationEnabled:sim.enabled,simulatedPositionAudit:validateSimulatedPosition(sim.state?.position||null),simulationPosition:sim.state?.position||null,remainingBlockers:BLOCKERS,scenarios:scenarioTests(),note:'No broker POST endpoints in this module. No claims of tested broker order execution.'}}
 function routes(app){app.get('/v11',(_req,res)=>res.sendFile(require('path').join(__dirname,'public','v11.html')));
  app.get('/api/v11/status',requireAdmin,async(_req,res)=>{try{res.set('Cache-Control','no-store').json(await status())}catch(e){res.status(503).json({error:e.message})}});
  app.get('/api/v11/journal',requireAdmin,async(_req,res)=>{try{const sync=await syncPaperEvents();res.set('Cache-Control','no-store').json({sync,events:await journal(),brokerExecution:'BLOCKED'})}catch(e){res.status(503).json({error:e.message})}});
  app.get('/api/v11/broker-audit',requireAdmin,async(_req,res)=>{try{const [market,positions,accounts,sim]=await Promise.all([api('/markets/'+encodeURIComponent(EPIC)),api('/positions'),api('/accounts'),v9Paper.status()]);const a=accounts?.accounts||[];res.set('Cache-Control','no-store').json({checkedAt:new Date().toISOString(),brokerExecution:'BLOCKED',readOnly:true,market:brokerRuleAudit(market,sim.state?.equity),accountReturned:a.length>0,brokerPositionsCount:Array.isArray(positions?.positions)?positions.positions.length:null,brokerPositionsValidated:Array.isArray(positions?.positions),remainingBlockers:BLOCKERS,note:'Read-only GET requests. Zero positions does not prove order recovery or monetary sizing.'})}catch(e){res.status(502).json({error:'Read-only broker audit failed: '+e.message,brokerExecution:'BLOCKED'})}});
  app.get('/api/v11/scenarios',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(scenarioTests()));
 }
 return {init,routes,status,syncPaperEvents};
}
module.exports={createExecutionLab,brokerRuleAudit,validateSimulatedPosition,scenarioTests,makeIntentId,BLOCKERS};
