'use strict';
// Read-only IG DEMO validation and paper accounting. Never calls IG POST/PUT/DELETE.
const path=require('node:path');
const EPIC='CS.D.EURUSD.CFD.IP';
const num=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
function validateExit(open,close){
 const errors=[];
 if(!open||!close)return {pass:false,errors:['Missing OPEN or CLOSE']};
 const p=open.payload||{},c=close.payload||{},pos=c.position||{};
 const direction=pos.direction||p.direction, entry=num(pos.entry??p.entry), exit=num(c.exit), pipValue=num(pos.virtualGBPPerPip??p.virtualGBPPerPip), pnl=num(c.pnl);
 if(!['LONG','SHORT'].includes(direction))errors.push('Unknown direction');
 if(entry===null||entry<=0||exit===null||exit<=0)errors.push('Missing/invalid prices');
 if(pipValue===null||pipValue<=0)errors.push('Invalid virtual pip value');
 if(pnl===null)errors.push('Invalid realised P/L');
 const expected=errors.length?null:(exit-entry)*10000*(direction==='LONG'?1:-1)*pipValue;
 if(expected!==null&&Math.abs(expected-pnl)>0.03)errors.push('Realised P/L does not match virtual fill arithmetic');
 if(pos.openedAt&&close.created_at&&Date.parse(close.created_at)<Date.parse(pos.openedAt))errors.push('Exit precedes entry');
 return {pass:errors.length===0,errors,direction,entry,exit,reportedPnlGBP:pnl,expectedPnlGBP:expected===null?null:Number(expected.toFixed(2)),reason:c.reason||null,note:'Arithmetic only: simulated prices, no slippage, fees or verified broker contract.'};
}
function pairTrades(events){const ordered=[...events].sort((a,b)=>Number(a.id)-Number(b.id));const pending=[];const results=[];for(const e of ordered){if(e.kind==='OPEN')pending.push(e);else if(e.kind==='CLOSE'){const pos=e.payload?.position;let idx=pending.findIndex(o=>o.payload?.openedAt===pos?.openedAt);if(idx<0&&pending.length===1)idx=0;if(idx<0)results.push({pass:false,errors:['CLOSE has no matching OPEN'],closeEventId:String(e.id)});else{const o=pending.splice(idx,1)[0];results.push({openEventId:String(o.id),closeEventId:String(e.id),...validateExit(o,e)});}}}return {completed:results,unmatchedOpenEvents:pending.map(e=>String(e.id)),checked:results.length,passed:results.filter(x=>x.pass).length,allPassed:results.every(x=>x.pass),limitedHistory:false};}
function brokerEvidence(market,positions,accounts,sim){const rules=market?.dealingRules||{},inst=market?.instrument||{},snapshot=market?.snapshot||{};const minSize=rules.minDealSize??null,minStop=rules.minNormalStopOrLimitDistance??null;const checks=[
 {name:'EUR/USD market response',pass:!!inst.epic&&inst.epic===EPIC,detail:inst.epic||'Missing instrument EPIC'},
 {name:'Market tradeable',pass:snapshot.marketStatus==='TRADEABLE',detail:snapshot.marketStatus||'Unknown'},
 {name:'Dealing-rule units present',pass:!!minSize?.unit&&!!minStop?.unit,detail:'Deal size '+JSON.stringify(minSize)+'; stop '+JSON.stringify(minStop)},
 {name:'Broker positions response',pass:Array.isArray(positions?.positions),detail:Array.isArray(positions?.positions)?positions.positions.length+' position(s)':'Invalid response'},
 {name:'Broker account response',pass:Array.isArray(accounts?.accounts)&&accounts.accounts.length>0,detail:'Account identity redacted'},
 {name:'Verified broker GBP-per-pip',pass:false,detail:'Instrument-specific contract and currency conversion independently unverified'},
 {name:'Verified executable IG deal size',pass:false,detail:'No executable broker size computed; POINTS are not presumed pips'},
 {name:'Broker order acknowledgement and recovery',pass:false,detail:'No broker order lifecycle test performed'}];return {checkedAt:new Date().toISOString(),readOnly:true,brokerExecution:'HARD_BLOCKED',checks,marketRules:{minSize,minStop,lotSize:inst.lotSize??null,unit:inst.unit??null,contractSize:inst.contractSize??null,currencies:inst.currencies??null},paperRiskBudgetGBP:sim?.state?.equity>0?Number((sim.state.equity*0.0025).toFixed(2)):null,brokerDealSize:null,verifiedGBPPerPip:null,accountCount:accounts?.accounts?.length??null,brokerPositionCount:positions?.positions?.length??null};}
function createV12({api,v9Paper,requireAdmin}){
 let pool,ready=false,error=null;
 async function init(){try{if(!process.env.DATABASE_URL)throw Error('DATABASE_URL missing');pool=new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000});await pool.query('SELECT 1');ready=true;error=null}catch(e){ready=false;error=e.message;console.error('[v12 validation]',e.message)}}
 async function events(){if(!ready)throw Error(error||'Database unavailable');const count=await pool.query("SELECT COUNT(*)::integer AS n FROM mp_v9_paper_events WHERE kind IN ('OPEN','CLOSE')");const r=await pool.query("SELECT id,kind,payload,created_at FROM mp_v9_paper_events WHERE kind IN ('OPEN','CLOSE') ORDER BY id ASC LIMIT 1000");return {events:r.rows,total:count.rows[0].n,truncated:count.rows[0].n>r.rows.length};}
 async function exitAudit(){const d=await events(),r=pairTrades(d.events);return {...r,limitedHistory:d.truncated,allPassed:r.allPassed&&!d.truncated,note:'Paper exit arithmetic only. If history is truncated, results are incomplete. No broker orders.'}}
 async function recoveryAudit(){const sim=await v9Paper.status();const d=await events();const p=sim.state?.position||null;const last=d.events.at(-1)||null;const checks=[{name:'PostgreSQL accessible',pass:ready,detail:'Read-only SELECT successful'}, {name:'Paper state accessible',pass:!!sim.ready&&!!sim.state,detail:sim.error||'Persisted paper state returned'}, {name:'Open position and journal consistency',pass:!d.truncated&&((p&&last?.kind==='OPEN')||(!p&&(!last||last.kind==='CLOSE'))),detail:'Last event '+(last?.kind||'NONE')+'; current position '+(p?.direction||'NONE')}, {name:'Restart-safe pending broker order recovery',pass:false,detail:'Requires controlled restart and order-lifecycle integration tests'}, {name:'Multiple-worker concurrency proven',pass:false,detail:'Not verified; use one Render instance'}];return {checks,brokerExecution:'HARD_BLOCKED',paperEnabled:sim.enabled,openPaperPosition:p?.direction||null,historyTruncated:d.truncated,note:'Snapshot comparison is NOT proof of crash recovery.'};}
 function routes(app){app.get('/v12',(_req,res)=>res.sendFile(path.join(__dirname,'public','v12.html')));
 app.get('/api/v12/status',requireAdmin,async(_req,res)=>{try{const sim=await v9Paper.status();res.set('Cache-Control','no-store').json({version:'12.0',ready,storageError:error,brokerExecution:'HARD_BLOCKED',paperEnabled:sim.enabled,virtualEquityGBP:sim.state?.equity??null,openPaperPosition:sim.state?.position||null,limits:{riskPerTradeFraction:0.0025,dailyLossFraction:0.01,maxNewTradesPerDay:2},nextGate:'Broker monetary conversion and lifecycle verification'})}catch(e){res.status(503).json({error:e.message})}});
 app.get('/api/v12/exit-audit',requireAdmin,async(_req,res)=>{try{res.set('Cache-Control','no-store').json(await exitAudit())}catch(e){res.status(503).json({error:e.message})}});
 app.get('/api/v12/recovery-audit',requireAdmin,async(_req,res)=>{try{res.set('Cache-Control','no-store').json(await recoveryAudit())}catch(e){res.status(503).json({error:e.message})}});
 app.get('/api/v12/ig-evidence',requireAdmin,async(_req,res)=>{try{const [market,positions,accounts,sim]=await Promise.all([api('/markets/'+encodeURIComponent(EPIC),'GET'),api('/positions','GET'),api('/accounts','GET'),v9Paper.status()]);res.set('Cache-Control','no-store').json(brokerEvidence(market,positions,accounts,sim))}catch(e){res.status(502).json({error:'Read-only IG validation failed: '+e.message})}});
 }
 return {init,routes,exitAudit,recoveryAudit};
}
module.exports={createV12,validateExit,pairTrades,brokerEvidence};
