'use strict';
// V24 evidence laboratory. No IG broker write methods are exposed.
const crypto=require('node:crypto');
const path=require('node:path');
const EPIC='CS.D.EURUSD.CFD.IP';
const LIMIT=100;
function calculateExposure(x){
 const fields=['equityGBP','stopPips','usdPerPipPerSize','usdToGbp','minSize','sizeStep','maxSize','dailyLossGBP','openRiskGBP'];
 const errors=fields.filter(k=>!Number.isFinite(x?.[k])||x[k]<0||(!['dailyLossGBP','openRiskGBP'].includes(k)&&x[k]===0)).map(k=>'Invalid '+k);
 if(!Number.isInteger(x?.entriesToday)||x.entriesToday<0)errors.push('Invalid entriesToday');
 if(errors.length)return {pass:false,errors,brokerOrderAllowed:false};
 const gbpPerPip=x.usdPerPipPerSize*x.usdToGbp;
 const budget=Math.min(x.equityGBP*.0025,x.equityGBP*.01-x.dailyLossGBP-x.openRiskGBP);
 const raw=budget>0?budget/(x.stopPips*gbpPerPip):0;
 const size=Math.floor(raw/x.sizeStep+1e-10)*x.sizeStep;
 const plannedRiskGBP=size*x.stopPips*gbpPerPip;
 if(!(budget>0))errors.push('Daily or per-trade risk budget exhausted');
 if(x.entriesToday>=2)errors.push('Two-trade daily cap reached');
 if(size<x.minSize||size>x.maxSize)errors.push('No valid broker-size increment fits budget');
 if(plannedRiskGBP>x.equityGBP*.0025+1e-8)errors.push('Risk limit exceeded');
 return {pass:errors.length===0,errors,illustrativeSize:Number(size.toFixed(8)),plannedRiskGBP:Number(plannedRiskGBP.toFixed(8)),gbpPerPip:Number(gbpPerPip.toFixed(8)),budgetGBP:Number(budget.toFixed(8)),brokerOrderAllowed:false,verified:false,note:'Illustrative only. Supplied values do not prove IG contract units, FX conversion or deal-size rules.'};
}
function createV24({requireAdmin,api}){
 let pool,ready=false,initError=null;const bootId=crypto.randomUUID();
 async function init(){try{if(!process.env.DATABASE_URL)throw Error('DATABASE_URL missing');pool=new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000});await pool.query(`CREATE TABLE IF NOT EXISTS mp_v24_evidence(id UUID PRIMARY KEY, kind TEXT NOT NULL, captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), boot_id TEXT NOT NULL, payload JSONB NOT NULL)`);await pool.query(`CREATE TABLE IF NOT EXISTS mp_v24_faults(id UUID PRIMARY KEY, state TEXT NOT NULL, created_boot TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ)`);ready=true;}catch(e){initError=e.message;console.error('[v24]',e.message)}}
 function db(){if(!ready)throw Error(initError||'v24 database unavailable');return pool}
 const status=()=>({ready,initError,bootId,mode:'READ_ONLY_AND_SIMULATION',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,verification:{contractGBPPerPip:false,dealSize:false,brokerOrderLifecycle:false,inFlightBrokerRecovery:false,operatorApproval:false},note:'Neither v24 nor v23 is authorised to submit IG broker orders.'});
 async function snapshot(){const [m,p,a]=await Promise.all([api('/markets/'+EPIC,'GET',null,'3'),api('/positions','GET',null,'2'),api('/accounts')]);const instrument=m?.instrument||{},rules=m?.dealingRules||{},positions=p?.positions;
 if(!Array.isArray(positions)||!Array.isArray(a?.accounts))throw Error('Broker account or position response malformed');
 const accountList=a.accounts.map(z=>({accountType:z.accountType,currency:z.currency}));
 const data={epic:EPIC,marketStatus:m?.snapshot?.marketStatus??null,contractSize:instrument.contractSize??null,lotSize:instrument.lotSize??null,unit:instrument.unit??null,onePipMeans:instrument.onePipMeans??null,valueOfOnePip:instrument.valueOfOnePip??null,minDealSize:rules.minDealSize??null,minNormalStopOrLimitDistance:rules.minNormalStopOrLimitDistance??null,accounts:accountList,positions:positions.filter(z=>z.market?.epic===EPIC).map(z=>({dealId:z.position?.dealId,direction:z.position?.direction,size:z.position?.size})),verification:'UNVERIFIED',brokerOrderAllowed:false};
 const id=crypto.randomUUID();await db().query('INSERT INTO mp_v24_evidence(id,kind,boot_id,payload) VALUES($1,$2,$3,$4)',[id,'BROKER_READ_ONLY',bootId,JSON.stringify(data)]);return {id,...data,note:'Saved broker snapshot; IG fields are not independently verified monetary sizing evidence.'};}
 async function evidence(){const r=await db().query('SELECT id,kind,captured_at,boot_id,payload FROM mp_v24_evidence ORDER BY captured_at DESC LIMIT $1',[LIMIT]);return {items:r.rows,brokerOrderAllowed:false}}
 async function createFault(){const id=crypto.randomUUID();await db().query('INSERT INTO mp_v24_faults(id,state,created_boot) VALUES($1,$2,$3)',[id,'UNKNOWN_SIM',bootId]);return {id,state:'UNKNOWN_SIM',createdBoot:bootId,brokerOrderAllowed:false,note:'Synthetic unknown outcome. No IG order sent.'}}
 async function recovery(){const r=await db().query('SELECT id,state,created_boot,created_at FROM mp_v24_faults WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT $1',[LIMIT]);return {bootId,unresolved:r.rows.length,items:r.rows.map(x=>({...x,bootChanged:x.created_boot!==bootId})),automatedResubmission:false,brokerInFlightRecoveryVerified:false,brokerOrderAllowed:false}}
 async function resolveFault(x){if(typeof x?.id!=='string'||! /^[0-9a-f-]{36}$/i.test(x.id)||x?.confirm!=='SIMULATION_ONLY_RESOLVE')throw Error('Valid ID and SIMULATION_ONLY_RESOLVE confirmation required');const r=await db().query("UPDATE mp_v24_faults SET state='RESOLVED_SIM',resolved_at=NOW() WHERE id=$1 AND resolved_at IS NULL RETURNING id",[x.id]);if(!r.rowCount)throw Error('Fault not found or already resolved');return {resolved:true,brokerOrderAllowed:false,note:'Simulation resolved manually; not evidence of broker reconciliation'}}
 const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req.body||{}))}catch(e){res.status(400).json({error:e.message,brokerOrderAllowed:false})}};
 function routes(app){app.get('/v24',(_q,r)=>r.sendFile(path.join(__dirname,'public','v24.html')));app.get('/api/v24/status',requireAdmin,wrap(status));app.get('/api/v24/snapshot',requireAdmin,wrap(snapshot));app.get('/api/v24/evidence',requireAdmin,wrap(evidence));app.get('/api/v24/recovery',requireAdmin,wrap(recovery));app.post('/api/v24/fault',requireAdmin,wrap(createFault));app.post('/api/v24/resolve',requireAdmin,wrap(resolveFault));app.post('/api/v24/size',requireAdmin,wrap(calculateExposure));app.post('/api/v24/submit',requireAdmin,(_q,r)=>r.status(423).json({error:'Broker execution remains HARD_BLOCKED',brokerOrderAllowed:false}));}
 return {init,routes};
}
module.exports={createV24,calculateExposure};
