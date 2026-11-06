'use strict';
// v21: independent evidence worksheet, durable dry-run intent ledger, read-only broker reconciliation.
// NO IG order creation, amendment or cancellation APIs are reachable from this module.
const path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.CFD.IP';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const money=n=>Math.round(n*1e8)/1e8;
function sizeWorksheet(x){
 const issues=[],required=['equityGBP','stopPips','usdPerPipPerContract','usdToGbp','minDealSize','dealStep','maxDealSize'];
 for(const k of required)if(!finite(x?.[k])||x[k]<=0)issues.push('Missing or invalid '+k);
 if(!x||x.contractSource!=='INDEPENDENTLY_CHECKED'||x.fxSource!=='INDEPENDENTLY_CHECKED'||x.dealRulesSource!=='INDEPENDENTLY_CHECKED')issues.push('Independent contract, FX and dealing-rule evidence not supplied');
 if(issues.length)return {pass:false,issues,brokerExecutable:false,brokerOrderAllowed:false};
 const pip=x.usdPerPipPerContract*x.usdToGbp,tradeBudget=x.equityGBP*.0025,dailyBudget=x.equityGBP*.01;
 const openRisk=finite(x.openRiskGBP)?x.openRiskGBP:NaN,realized=finite(x.dailyRealizedLossGBP)?x.dailyRealizedLossGBP:NaN,entries=x.entriesToday;
 if(!finite(openRisk)||openRisk<0||!finite(realized)||realized<0||!Number.isInteger(entries)||entries<0)issues.push('Daily loss, open risk and entry count must be supplied');
 const available=Math.min(tradeBudget,dailyBudget-openRisk-realized),raw=available/(x.stopPips*pip);
 const size=money(Math.floor(raw/x.dealStep+1e-10)*x.dealStep),risk=money(size*x.stopPips*pip);
 if(!(available>0))issues.push('Risk budget exhausted');
 if(entries>=2)issues.push('Daily entry limit reached');
 if(size<x.minDealSize)issues.push('Risk budget cannot accommodate broker minimum size');
 if(size>x.maxDealSize)issues.push('Calculated size exceeds stated maximum');
 if(risk>tradeBudget+1e-7||risk+openRisk+realized>dailyBudget+1e-7)issues.push('Risk budget breached');
 return {pass:issues.length===0,issues,illustrativeSize:size,plannedRiskGBP:risk,gbpPerPipPerContract:money(pip),tradeBudgetGBP:money(tradeBudget),dailyBudgetGBP:money(dailyBudget),brokerExecutable:false,brokerOrderAllowed:false,note:'Worksheet only. User-provided evidence flags are not independent validation. IG points/pips, contract denomination, minimum sizes, margin and slippage must be externally corroborated.'};
}
function reconcile(positions,ledger){
 if(!Array.isArray(positions?.positions))return {pass:false,issues:['IG positions unavailable'],brokerExecution:'HARD_BLOCKED'};
 const broker=positions.positions.map(p=>({dealId:p.position?.dealId||null,epic:p.market?.epic||p.position?.epic||null,direction:p.position?.direction||null}));
 const issues=[];if(broker.length)issues.push('Broker has '+broker.length+' position(s); human reconciliation required');
 const unknown=ledger.filter(x=>['UNKNOWN_SIM','SUBMITTED_SIM'].includes(x.state));if(unknown.length)issues.push(unknown.length+' unresolved simulated intent(s)');
 return {pass:issues.length===0,issues,brokerPositions:broker,unresolvedSimulatedIntents:unknown.length,brokerExecution:'HARD_BLOCKED',note:'Read-only snapshot, not a proven broker-order lifecycle or restart recovery test.'};
}
function createV21({requireAdmin,api,signalSnapshot}){
 let pool,ready=false,reason='Database not initialised';
 async function init(){try{if(!process.env.DATABASE_URL)throw Error('DATABASE_URL missing');pool=new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000});await pool.query(`CREATE TABLE IF NOT EXISTS mp_v21_dryrun(id TEXT PRIMARY KEY, signal_bar TIMESTAMPTZ NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('LONG','SHORT')), state TEXT NOT NULL DEFAULT 'PREPARED_SIM', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);await pool.query(`CREATE TABLE IF NOT EXISTS mp_v21_audit(id BIGSERIAL PRIMARY KEY, event_type TEXT NOT NULL, detail JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);ready=true;reason=null}catch(e){reason=e.message;console.error('[V21]',reason)}}
 const db=()=>{if(!ready)throw Error(reason);return pool};
 async function journal(){return (await db().query('SELECT id,signal_bar,direction,state,created_at FROM mp_v21_dryrun ORDER BY created_at DESC LIMIT 50')).rows}
 async function audit(type,data){await db().query('INSERT INTO mp_v21_audit(event_type,detail) VALUES($1,$2::jsonb)',[type,JSON.stringify(data)])}
 async function status(){return {ready,reason:ready?null:reason,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,verified:{contractGBPPerPip:false,dealSize:false,orderLifecycle:false,crashRecovery:false},journal:ready?await journal():[],signal:signalSnapshot(),note:'Read-only IG and simulation-only journal. No broker order writes.'}}
 async function prepare(body){const bar=body?.bar,direction=body?.direction;if(!['LONG','SHORT'].includes(direction)||!bar||!Number.isFinite(Date.parse(bar)))throw Error('Valid bar and direction required');const iso=new Date(bar).toISOString();const id=crypto.createHash('sha256').update(['v21',EPIC,iso,direction].join('|')).digest('hex');const result=await db().query('INSERT INTO mp_v21_dryrun(id,signal_bar,direction) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING RETURNING id',[id,iso,direction]);await audit('dryrun_prepared',{id,created:result.rowCount===1});return {id,created:result.rowCount===1,duplicate:result.rowCount===0,state:'PREPARED_SIM',brokerOrdersSent:0}}
 async function brokerSnapshot(){const [market,positions,accounts]=await Promise.all([api('/markets/'+encodeURIComponent(EPIC),'GET',null,'3'),api('/positions','GET',null,'2'),api('/accounts')]);const ledger=await journal();return {market:{epic:market?.instrument?.epic||EPIC,status:market?.snapshot?.marketStatus||null,contractSize:market?.instrument?.contractSize||null,onePipMeans:market?.instrument?.onePipMeans||null,valueOfOnePip:market?.instrument?.valueOfOnePip||null,minDealSize:market?.dealingRules?.minDealSize||null,minStop:market?.dealingRules?.minNormalStopOrLimitDistance||null},accountsReadable:Array.isArray(accounts?.accounts),reconciliation:reconcile(positions,ledger),brokerOrderAllowed:false}}
 async function recovery(){const [j,a]=await Promise.all([journal(),db().query('SELECT event_type,created_at FROM mp_v21_audit ORDER BY id DESC LIMIT 20')]);return {databaseAccessible:true,journalCount:j.length,unresolved:j.filter(x=>['UNKNOWN_SIM','SUBMITTED_SIM'].includes(x.state)).length,recentAudit:a.rows,controlledRestartTestPassed:false,inFlightBrokerRecoveryVerified:false,brokerOrderAllowed:false,note:'Persistence snapshot only; restart and in-flight broker recovery remain unverified.'}}
 function routes(app){app.get('/v21',(_q,r)=>r.sendFile(path.join(__dirname,'public','v21.html')));const wrap=fn=>async(q,r)=>{try{r.set('Cache-Control','no-store').json(await fn(q))}catch(e){r.status(503).json({error:e.message,brokerOrderAllowed:false})}};app.get('/api/v21/status',requireAdmin,wrap(status));app.get('/api/v21/broker',requireAdmin,wrap(brokerSnapshot));app.get('/api/v21/recovery',requireAdmin,wrap(recovery));app.post('/api/v21/size',requireAdmin,wrap(async q=>{const result=sizeWorksheet(q.body||{});await audit('sizing_worksheet',{pass:result.pass,issues:result.issues});return result}));app.post('/api/v21/prepare',requireAdmin,wrap(q=>prepare(q.body||{})))}
 return {init,routes,status};
}
module.exports={createV21,sizeWorksheet,reconcile};
