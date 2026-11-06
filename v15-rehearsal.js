'use strict';
// Offline broker-lifecycle rehearsal. No IG API client or broker execution functions are imported.
const crypto=require('node:crypto');
const path=require('node:path');
const {intentId,transition}=require('./v14-lifecycle');
const RISK=Object.freeze({riskFraction:0.0025,dailyLossFraction:0.01,maxNewTradesPerDay:2});
function riskAudit({equityGBP=10000,plannedRiskGBP=25,dailyLossGBP=0,newTradesToday=0}={}){
 const nums=[equityGBP,plannedRiskGBP,dailyLossGBP,newTradesToday].map(Number);
 if(nums.some(n=>!Number.isFinite(n))||nums[0]<=0||nums[1]<=0||nums[2]<0||!Number.isInteger(nums[3])||nums[3]<0)throw Error('Invalid numeric risk inputs');
 const [equity,risk,loss,opens]=nums;
 const checks={riskWithinQuarterPercent:risk<=equity*RISK.riskFraction+1e-8,dailyRealizedLossWithinLimit:loss<equity*RISK.dailyLossFraction,dailyEntriesAvailable:opens<RISK.maxNewTradesPerDay,combinedBudgetWithinLimit:loss+risk<=equity*RISK.dailyLossFraction+1e-8};
 return {checks,pass:Object.values(checks).every(Boolean),maxRiskGBP:equity*RISK.riskFraction,maxDailyLossGBP:equity*RISK.dailyLossFraction,brokerExecutable:false,limits:RISK,note:'Illustrative virtual accounting; does not include slippage, gaps, floating losses or actual IG contract sizing.'};
}
function planScenario(type){
 const steps={ACK:['SUBMIT','ACK'],REJECT:['SUBMIT','REJECT'],TIMEOUT_FOUND:['SUBMIT','TIMEOUT','RECONCILE_FOUND'],TIMEOUT_ABSENT:['SUBMIT','TIMEOUT','RECONCILE_ABSENT']};
 if(!Object.hasOwn(steps,type))throw Error('Unsupported rehearsal scenario');
 let state='PREPARED';const history=[state];for(const step of steps[type]){state=transition(state,step);history.push(state)}
 return {type,steps:steps[type],history,finalState:state};
}
function createV15({requireAdmin}){
 let pool=null,ready=false,reason='Initialising';
 const db=()=>{if(!ready)throw Error(reason);return pool};
 async function init(){try{if(!process.env.DATABASE_URL)throw Error('DATABASE_URL missing');pool=new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,max:4,connectionTimeoutMillis:5000});
 await pool.query(`CREATE TABLE IF NOT EXISTS mp_v15_rehearsals (id TEXT PRIMARY KEY, scenario TEXT NOT NULL, state TEXT NOT NULL, history JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 await pool.query(`CREATE TABLE IF NOT EXISTS mp_v15_control (id INTEGER PRIMARY KEY CHECK(id=1), halted BOOLEAN NOT NULL DEFAULT TRUE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 await pool.query(`INSERT INTO mp_v15_control(id,halted) VALUES(1,TRUE) ON CONFLICT(id) DO NOTHING`);
 ready=true;reason=null;}catch(e){ready=false;reason=e.message;console.error('[V15]',e.message)}}
 async function control(){const r=await db().query('SELECT halted,updated_at FROM mp_v15_control WHERE id=1');return r.rows[0]}
 async function halt(){const r=await db().query('UPDATE mp_v15_control SET halted=TRUE,updated_at=NOW() WHERE id=1 RETURNING halted');return {halted:r.rows[0].halted,note:'v15 rehearsal halt only; no broker controls changed'}}
 async function rehearse({scenario,bar,direction='SHORT',risk={}}){
 const assessment=riskAudit(risk);if(!assessment.pass)throw Error('Virtual risk gate failed: '+Object.entries(assessment.checks).filter(([,v])=>!v).map(([k])=>k).join(', '));
 const plan=planScenario(scenario);const id=intentId({bar,direction,strategy:'v15-'+scenario});
 const c=await db().connect();try{await c.query('BEGIN');const lock=await c.query('SELECT halted FROM mp_v15_control WHERE id=1 FOR UPDATE');if(!lock.rows[0]?.halted)throw Error('Invalid control state');
 // Deliberately do NOT unhalt: a manually requested rehearsal is permitted while automated scheduling stays halted.
 const inserted=await c.query(`INSERT INTO mp_v15_rehearsals(id,scenario,state,history) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id`,[id,scenario,plan.finalState,JSON.stringify(plan.history)]);
 const record=await c.query('SELECT id,scenario,state,history,created_at FROM mp_v15_rehearsals WHERE id=$1',[id]);await c.query('COMMIT');return {created:inserted.rowCount===1,duplicate:inserted.rowCount===0,record:record.rows[0],risk:assessment,brokerOrdersSent:0};
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
 async function concurrencyProbe(){const bar=new Date(Date.now()+crypto.randomInt(1,1000000000)).toISOString();const scenario='TIMEOUT_FOUND';const attempts=await Promise.all(Array.from({length:8},()=>rehearse({scenario,bar,direction:'LONG'})));const created=attempts.filter(x=>x.created).length;return {pass:created===1,attempts:8,created,duplicates:attempts.filter(x=>x.duplicate).length,scope:'Single Node process, PostgreSQL unique index; not a multi-worker or crash test',brokerOrdersSent:0}}
 async function snapshot(){const [c,r]=await Promise.all([control(),db().query('SELECT id,scenario,state,history,created_at FROM mp_v15_rehearsals ORDER BY created_at DESC LIMIT 30')]);return {ready,halted:c.halted,brokerExecution:'HARD_BLOCKED',brokerOrdersSent:0,automatedSignalExecution:false,rehearsals:r.rows,verification:{contractSizing:false,brokerOrderLifecycle:false,crashRecovery:false,multiWorkerConcurrency:false},riskLimits:RISK}}
 function routes(app){app.get('/v15',(_q,r)=>r.sendFile(path.join(__dirname,'public','v15.html')));
 app.get('/api/v15/status',requireAdmin,async(_q,r)=>{try{r.set('Cache-Control','no-store').json(await snapshot())}catch(e){r.status(503).json({error:e.message})}});
 app.post('/api/admin/v15/rehearse',requireAdmin,async(q,r)=>{try{if(q.body?.confirm!=='SIMULATE_ONLY')return r.status(400).json({error:'SIMULATE_ONLY required'});r.json(await rehearse(q.body))}catch(e){r.status(409).json({error:e.message})}});
 app.post('/api/admin/v15/concurrency-probe',requireAdmin,async(q,r)=>{try{if(q.body?.confirm!=='SIMULATE_ONLY')return r.status(400).json({error:'SIMULATE_ONLY required'});r.json(await concurrencyProbe())}catch(e){r.status(409).json({error:e.message})}});
 app.post('/api/admin/v15/halt',requireAdmin,async(q,r)=>{try{if(q.body?.confirm!=='HALT_V15')return r.status(400).json({error:'HALT_V15 required'});r.json(await halt())}catch(e){r.status(503).json({error:e.message})}});
 app.post('/api/admin/v15/risk-audit',requireAdmin,(q,r)=>{try{r.json(riskAudit(q.body))}catch(e){r.status(400).json({error:e.message})}});
 }
 return {init,routes,rehearse,snapshot,concurrencyProbe};
}
module.exports={createV15,riskAudit,planScenario,RISK};
