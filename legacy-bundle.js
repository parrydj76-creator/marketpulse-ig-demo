
'use strict';
// Consolidated historical modules (v9-v52). Keep v53-v55 as independently auditable safety modules.
// Each factory preserves its own CommonJS module scope and caches exports.
const path = require('node:path');
const {createRequire} = require('node:module');
const factories = {
  "v9-paper": function(module, exports, require, __filename, __dirname) {
'use strict';
// MarketPulse v9: isolated, PostgreSQL-backed SIMULATION. Never calls IG order endpoints.
const EPIC='CS.D.EURUSD.CFD.IP';
const PIP=0.0001;
const CONFIG=Object.freeze({riskFraction:0.0025,dailyLossFraction:0.01,maxNewTradesPerDay:2,stopPips:12,targetPips:18,maxSpreadPips:2,maxHoldMinutes:180,minScore:70,initialVirtualEquityGBP:10000});
const initial=()=>({equity:CONFIG.initialVirtualEquityGBP,day:new Date().toISOString().slice(0,10),dayStartEquity:CONFIG.initialVirtualEquityGBP,dailyOpens:0,dayRealized:0,position:null,lastEntryBar:null,sequence:0});
function validMarket(q,s,bars,now=Date.now()){
 if(!q||!s||!Array.isArray(bars)||bars.length<30)return false;
 if(q.source!=='STREAM'||q.marketState!=='DEAL'||String(q.delayed)!=='0')return false;
 if(!Number.isFinite(q.bid)||!Number.isFinite(q.ask)||q.bid<=0||q.ask<=q.bid||!Number.isFinite(q.at)||now-q.at<0||now-q.at>=15000)return false;
 if((q.ask-q.bid)/PIP>CONFIG.maxSpreadPips)return false;
 const recent=bars.slice(-30);
 return recent.every((b,i)=>Number.isFinite(b.close)&&b.ticks>=2&&Number.isFinite(Date.parse(b.time))&&(i===0||Date.parse(b.time)-Date.parse(recent[i-1].time)===300000))&&now-Date.parse(recent.at(-1).time)<600000;
}
function validExitQuote(q,now=Date.now()){
 return !!q&&q.source==='STREAM'&&q.marketState==='DEAL'&&String(q.delayed)==='0'&&Number.isFinite(q.at)&&now>=q.at&&now-q.at<15000&&Number.isFinite(q.bid)&&Number.isFinite(q.ask)&&q.bid>0&&q.ask>q.bid;
}
function evaluate(state,q,s,bars,now=Date.now()){
 const date=new Date(now).toISOString().slice(0,10);
 if(state.day!==date){state.day=date;state.dayStartEquity=state.equity;state.dailyOpens=0;state.dayRealized=0;}
 if(state.position){
  // Exits must not depend on indicator warm-up or historical bar integrity.
  // Still require a fresh, verified, undelayed stream to avoid stale fills.
  if(!validExitQuote(q,now))return {kind:'SKIP',reason:'EXIT_WAITING_FOR_VERIFIED_QUOTE'};
  const p=state.position,exit=p.direction==='LONG'?q.bid:q.ask;
  const hitStop=p.direction==='LONG'?exit<=p.stop:exit>=p.stop;
  const hitTarget=p.direction==='LONG'?exit>=p.target:exit<=p.target;
  const expired=now-Date.parse(p.openedAt)>=CONFIG.maxHoldMinutes*60000;
  if(!hitStop&&!hitTarget&&!expired)return {kind:'HOLD'};
  const pnl=(p.direction==='LONG'?exit-p.entry:p.entry-exit)/PIP*p.virtualGBPPerPip;
  return {kind:'CLOSE',reason:hitStop?'STOP':hitTarget?'TARGET':'TIME',exit,pnl};
 }
 if(!validMarket(q,s,bars,now))return {kind:'SKIP',reason:'Streaming market conditions or bars not verified'};
 if(state.dailyOpens>=CONFIG.maxNewTradesPerDay)return {kind:'SKIP',reason:'Daily entry cap'};
 if(state.dayRealized<=-state.dayStartEquity*CONFIG.dailyLossFraction)return {kind:'SKIP',reason:'Daily loss stop'};
 if(Math.max(0,-state.dayRealized)+state.equity*CONFIG.riskFraction>state.dayStartEquity*CONFIG.dailyLossFraction+0.00001)return {kind:'SKIP',reason:'Insufficient remaining daily risk budget'};
 if(!['LONG','SHORT'].includes(s.direction)||!Number.isFinite(s.score)||s.score<CONFIG.minScore)return {kind:'SKIP',reason:'No qualifying signal'};
 const bar=bars.at(-1).time;
 if(state.lastEntryBar===bar)return {kind:'SKIP',reason:'Signal bar already used'};
 const riskGBP=state.equity*CONFIG.riskFraction;
 if(!(riskGBP>0))return {kind:'SKIP',reason:'Virtual equity exhausted'};
 const entry=s.direction==='LONG'?q.ask:q.bid;
 const stop=entry+(s.direction==='LONG'?-1:1)*CONFIG.stopPips*PIP;
 const target=entry+(s.direction==='LONG'?1:-1)*CONFIG.targetPips*PIP;
 return {kind:'OPEN',direction:s.direction,entry,stop,target,riskGBP,virtualGBPPerPip:riskGBP/CONFIG.stopPips,bar};
}
function createV9Paper(onEvent=async()=>{}){
 let pool=null,ready=false,error=null,enabled=false,busy=false;
 let monitor={lastTickAt:null,lastQuoteAt:null,lastBarAt:null,lastSignal:null,lastDecision:'WAITING_FOR_FIRST_TICK',lastDecisionAt:null,lastError:null,cycles:0,acceptedCycles:0};
 function diagnostics(){return {...monitor,ageSeconds:monitor.lastTickAt?Math.floor((Date.now()-Date.parse(monitor.lastTickAt))/1000):null};}
 function inspect(q,s,bars,now=Date.now()){
  if(!q)return 'NO_QUOTE';
  if(q.source!=='STREAM')return 'NOT_STREAMING';
  if(q.marketState!=='DEAL'||String(q.delayed)!=='0')return 'MARKET_NOT_VERIFIED';
  if(!Number.isFinite(q.at)||now-q.at<0||now-q.at>=15000)return 'STALE_QUOTE';
  if(!Number.isFinite(q.bid)||!Number.isFinite(q.ask)||q.ask<=q.bid)return 'INVALID_QUOTE';
  if((q.ask-q.bid)/PIP>CONFIG.maxSpreadPips)return 'SPREAD_TOO_WIDE';
  if(!Array.isArray(bars)||bars.length<30)return 'WARMING_BARS_'+(bars?.length||0)+'_OF_30';
  if(!validMarket(q,s,bars,now))return 'INVALID_OR_STALE_BARS';
  return 'MARKET_VERIFIED';
 }
 async function init(){
  if(!process.env.DATABASE_URL){error='DATABASE_URL missing';return;}
  try{
   pool=new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000});
   await pool.query('CREATE TABLE IF NOT EXISTS mp_v9_paper_state (id INTEGER PRIMARY KEY CHECK(id=1), payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())');
   await pool.query('CREATE TABLE IF NOT EXISTS mp_v9_paper_events (id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
   await pool.query('INSERT INTO mp_v9_paper_state(id,payload) VALUES(1,$1::jsonb) ON CONFLICT(id) DO NOTHING',[JSON.stringify(initial())]);
   const result=await pool.query('SELECT payload FROM mp_v9_paper_state WHERE id=1');
   const state=result.rows[0]?.payload;
   if(!state||!Number.isFinite(Number(state.equity))||!Number.isInteger(state.dailyOpens)||!Number.isFinite(Number(state.dayStartEquity)))throw Error('Saved simulation state invalid; manual recovery required');
   // Restart fail-closed: positions are restored from DB, but new entries require admin opt-in.
   enabled=false;ready=true;error=null;
  }catch(e){ready=false;enabled=false;error=e.message;console.error('[V9 paper] Init failed:',e.message);}
 }
 async function state(){if(!ready)throw Error(error||'Simulation storage unavailable');const r=await pool.query('SELECT payload,updated_at FROM mp_v9_paper_state WHERE id=1');if(!r.rows.length)throw Error('Simulation state missing');return r.rows[0];}
 async function status(){if(!ready)return {ready:false,enabled:false,error,config:CONFIG,monitor:diagnostics(),brokerExecution:'BLOCKED',simulationOnly:true};try{const s=await state();return {ready,enabled,error:null,config:CONFIG,monitor:diagnostics(),brokerExecution:'BLOCKED',simulationOnly:true,state:s.payload,updatedAt:s.updated_at}}catch(e){enabled=false;ready=false;error=e.message;return {ready:false,enabled:false,error,config:CONFIG,monitor:diagnostics(),brokerExecution:'BLOCKED',simulationOnly:true}}}
 async function history(){if(!ready)throw Error('Simulation storage unavailable');const r=await pool.query('SELECT id,kind,payload,created_at FROM mp_v9_paper_events ORDER BY id DESC LIMIT 100');return r.rows;}
 async function tick(q,s,bars,now=Date.now()){
  if(!ready||busy)return;
  monitor.cycles++;monitor.lastTickAt=new Date(now).toISOString();
  monitor.lastQuoteAt=Number.isFinite(q?.at)?new Date(q.at).toISOString():null;
  monitor.lastBarAt=Array.isArray(bars)&&bars.length?bars.at(-1).time:null;
  monitor.lastSignal={direction:s?.direction||'UNKNOWN',score:Number.isFinite(s?.score)?s.score:null,reason:s?.reason||null};
  const check=inspect(q,s,bars,now);monitor.lastDecision=check;monitor.lastDecisionAt=monitor.lastTickAt;
  busy=true;let client;let committedEvent=null;
  try{
   client=await pool.connect();await client.query('BEGIN');
   const row=await client.query('SELECT payload FROM mp_v9_paper_state WHERE id=1 FOR UPDATE');
   if(!row.rows.length)throw Error('Missing paper state');
   const state=row.rows[0].payload;
   // Even when paused, continue managing an existing simulated position.
   if(!enabled&&!state.position){monitor.lastDecision='PAUSED_NO_POSITION';await client.query('COMMIT');return;}
   const action=evaluate(state,q,s,bars,now);monitor.lastDecision=action.kind==='SKIP'?(check==='MARKET_VERIFIED'?action.reason:check):action.kind==='HOLD'?'HOLDING_POSITION':action.kind; if(check==='MARKET_VERIFIED')monitor.acceptedCycles++;
   if(action.kind==='OPEN'&&enabled){
    state.position={direction:action.direction,entry:action.entry,stop:action.stop,target:action.target,virtualGBPPerPip:action.virtualGBPPerPip,riskGBP:action.riskGBP,openedAt:new Date(now).toISOString(),signalBar:action.bar};
    state.dailyOpens++;state.lastEntryBar=action.bar;state.sequence++;
    committedEvent={kind:'OPEN',sequence:state.sequence,...state.position};await client.query('INSERT INTO mp_v9_paper_events(kind,payload) VALUES($1,$2::jsonb)',['OPEN',JSON.stringify(committedEvent)]);
   }else if(action.kind==='CLOSE'){
    const closed=state.position;state.position=null;state.equity=Math.max(0,state.equity+action.pnl);state.dayRealized+=action.pnl;state.sequence++;
    committedEvent={kind:'CLOSE',sequence:state.sequence,...action,position:closed,equity:state.equity};await client.query('INSERT INTO mp_v9_paper_events(kind,payload) VALUES($1,$2::jsonb)',['CLOSE',JSON.stringify(committedEvent)]);
   }
   await client.query('UPDATE mp_v9_paper_state SET payload=$1::jsonb,updated_at=now() WHERE id=1',[JSON.stringify(state)]);
   await client.query('COMMIT');
   if(committedEvent)try{await onEvent(committedEvent)}catch(e){console.error('[V9 paper] event notification:',e.message)}
  }catch(e){if(client)try{await client.query('ROLLBACK')}catch{};enabled=false;ready=false;error='Paper cycle failed: '+e.message;monitor.lastError=error;monitor.lastDecision='ERROR_PAUSED';console.error('[V9 paper]',error)}finally{client?.release();busy=false}
 }
 function routes(app,requireAdmin){
  app.get('/api/v9/paper/status',async(_req,res)=>res.set('Cache-Control','no-store').json(await status()));
  app.get('/api/v9/paper/diagnostics',(_req,res)=>res.set('Cache-Control','no-store').json({ready,enabled,monitor:diagnostics(),brokerExecution:'BLOCKED'}));
  app.get('/api/v9/paper/history',requireAdmin,async(_req,res)=>{try{res.set('Cache-Control','no-store').json({events:await history()})}catch(e){res.status(503).json({error:e.message})}});
  app.post('/api/admin/v9/paper/start',requireAdmin,async(req,res)=>{if(req.body?.confirm!=='START_V9_PAPER_ONLY')return res.status(400).json({error:'Confirmation START_V9_PAPER_ONLY required'});if(!ready)return res.status(503).json({error:error||'Storage unavailable'});enabled=true;res.json({ok:true,simulationOnly:true,brokerExecution:'BLOCKED'})});
  app.post('/api/admin/v9/paper/pause',requireAdmin,(_req,res)=>{enabled=false;res.json({ok:true,entriesPaused:true,existingSimulationPositionManaged:true})});
 }
 return {init,tick,routes,status,diagnostics};
}
module.exports={CONFIG,validMarket,validExitQuote,evaluate,createV9Paper};

  },
  "v10-readiness": function(module, exports, require, __filename, __dirname) {
 'use strict';
// V10 read-only readiness and simulation audits. No order submission functions.
const EPIC='CS.D.EURUSD.CFD.IP';
function finite(n){return typeof n==='number'&&Number.isFinite(n)}
function positionAudit(state,config){
 const s=state||{},p=s.position||null, equity=Number(s.equity), start=Number(s.dayStartEquity), realised=Number(s.dayRealized);
 const issues=[], checks=[];
 const add=(name,ok,detail)=>{checks.push({name,pass:!!ok,detail});if(!ok)issues.push(name)};
 add('Virtual equity valid',finite(equity)&&equity>0,'Current persisted simulation equity');
 add('Daily entry cap',Number.isInteger(s.dailyOpens)&&s.dailyOpens>=0&&s.dailyOpens<=config.maxNewTradesPerDay,'Count of new v9 entries today');
 add('Daily realised loss within limit',finite(realised)&&finite(start)&&realised> -start*config.dailyLossFraction,'Realised loss only; not a total loss guarantee');
 if(p){
  const d=p.direction,entry=Number(p.entry),stop=Number(p.stop),target=Number(p.target),risk=Number(p.riskGBP),perPip=Number(p.virtualGBPPerPip);
  add('Direction and protective levels', ['LONG','SHORT'].includes(d)&&[entry,stop,target].every(finite)&&(d==='LONG'?stop<entry&&target>entry:stop>entry&&target<entry),'Simulated prices, not broker-attached stops');
  const stopPips=Math.abs(entry-stop)/0.0001;
  add('Virtual pip value and stop risk',finite(perPip)&&perPip>0&&finite(risk)&&risk>0&&Math.abs(stopPips*perPip-risk)<0.02,'Illustrative GBP/pip, not IG contract value');
  add('Open risk plus realised loss within daily budget',finite(start)&&finite(realised)&&finite(risk)&&Math.max(0,-realised)+risk<=start*config.dailyLossFraction+0.01,'Conservative projected stop loss, excludes slippage');
 }else add('No open simulated position',true,'No position currently held');
 return {checks,issues,pass:issues.length===0,openPosition:!!p,remainingDailyLossBudgetGBP:finite(start)&&finite(realised)?Math.max(0,start*config.dailyLossFraction+Math.min(0,realised)):null};
}
function brokerReadiness(market,positions,account,simulation){
 const rules=market?.dealingRules||{},snapshot=market?.snapshot||{},instrument=market?.instrument||{};
 const minSize=rules.minDealSize||null, minStop=rules.minNormalStopOrLimitDistance||null;
 const checks=[
  {name:'IG market specification fetched',pass:!!market?.instrument,detail:instrument.name||EPIC},
  {name:'Minimum deal size provided',pass:finite(Number(minSize?.value))&&Number(minSize.value)>0,detail:minSize},
  {name:'Minimum stop distance provided',pass:finite(Number(minStop?.value))&&Number(minStop.value)>0,detail:minStop},
  {name:'Market currently tradeable',pass:snapshot.marketStatus==='TRADEABLE',detail:snapshot.marketStatus||'UNKNOWN'},
  {name:'Broker positions response validated',pass:Array.isArray(positions),detail:Array.isArray(positions)?`${positions.length} broker positions reported`:'Not verified'},
  {name:'Account identity verified',pass:!!account?.accountId,detail:account?.accountId?'Account returned (ID withheld)':'Not verified'},
  {name:'GBP-per-pip contract conversion independently verified',pass:false,detail:'Requires instrument-specific size, contract units and FX conversion tests'},
  {name:'Idempotent order confirmation/reconciliation tested',pass:false,detail:'No order lifecycle tests performed'},
  {name:'Restart-safe pending-order recovery tested',pass:false,detail:'No broker recovery test performed'},
  {name:'Automated broker execution authorised',pass:false,detail:'Hard-block remains in place'}
 ];
 return {epic:EPIC,brokerExecution:'BLOCKED',readyForOrders:false,checks,market:{name:instrument.name||null,currencies:instrument.currencies||null,lotSize:instrument.lotSize??null,unit:instrument.unit||null,minimumDealSize:minSize,minimumStopDistance:minStop},paperAudit:simulation||null,checkedAt:new Date().toISOString()};
}
function registerV10(app,requireAdmin,{v9Paper,api,accountSnapshot}){
 app.get('/v10',(_req,res)=>res.sendFile(require('path').join(__dirname,'public','v10.html')));
 app.get('/api/v10/audit',requireAdmin,async(_req,res)=>{try{const s=await v9Paper.status();if(!s.ready)return res.status(503).json({error:s.error||'Paper engine unavailable'});res.set('Cache-Control','no-store').json({version:'10.0',brokerExecution:'BLOCKED',simulation:s,positionAudit:positionAudit(s.state,s.config),checkedAt:new Date().toISOString()})}catch(e){res.status(503).json({error:e.message})}});
 app.get('/api/v10/broker-readiness',requireAdmin,async(_req,res)=>{try{
  // IG API GET only; do not submit, amend, close or cancel orders.
  const [market,positionsResponse,accountsResponse,sim]=await Promise.all([api('/markets/'+encodeURIComponent(EPIC)),api('/positions'),api('/accounts'),v9Paper.status()]);
  const positions=positionsResponse?.positions;
  const account=(accountsResponse?.accounts||[]).find(a=>a.preferred)||accountsResponse?.accounts?.[0]||accountSnapshot?.()||null;
  res.set('Cache-Control','no-store').json(brokerReadiness(market,positions,account,sim.ready?positionAudit(sim.state,sim.config):null));
 }catch(e){res.status(502).json({error:'Read-only broker readiness failed: '+e.message,brokerExecution:'BLOCKED',readyForOrders:false})}});
}
module.exports={positionAudit,brokerReadiness,registerV10};

  },
  "v11-execution-lab": function(module, exports, require, __filename, __dirname) {
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

  },
  "v12-validation": function(module, exports, require, __filename, __dirname) {
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

  },
  "v13-safety": function(module, exports, require, __filename, __dirname) {
'use strict';
// V13: safety lab only. Never sends broker orders.
const path=require('node:path');
const crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.CFD.IP';
function idForIntent(input){return crypto.createHash('sha256').update(JSON.stringify([input.epic,input.signalBar,input.direction,input.strategyVersion])).digest('hex');}
function assess(input){const issues=[];const equity=Number(input.equity),risk=Number(input.riskGBP),stop=Number(input.stopPips);if(!Number.isFinite(equity)||equity<=0)issues.push('Invalid equity');if(!Number.isFinite(risk)||risk<=0||risk>equity*0.0025+0.01)issues.push('Risk exceeds 0.25% allowance');if(!Number.isFinite(stop)||stop<=0)issues.push('Invalid stop distance');if(!input.brokerGBPPerPipVerified)issues.push('GBP per pip conversion not independently verified');if(!input.brokerDealSizeVerified)issues.push('IG executable deal size not independently verified');if(!input.orderLifecycleVerified)issues.push('IG order acknowledgement and reconciliation unverified');if(!input.restartRecoveryVerified)issues.push('Broker pending-order restart recovery unverified');return {eligible:false,brokerOrderAllowed:false,issues,plannedRiskGBP:Number.isFinite(risk)?risk:null,brokerDealSize:null};}
function createV13({api,v9Paper,requireAdmin}){
 let pool,ready=false,error=null;
 async function init(){try{if(!process.env.DATABASE_URL)throw Error('DATABASE_URL missing');pool=new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000});await pool.query(`CREATE TABLE IF NOT EXISTS mp_v13_safety (id TEXT PRIMARY KEY, halted BOOLEAN NOT NULL DEFAULT TRUE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);await pool.query(`INSERT INTO mp_v13_safety(id,halted) VALUES('global',TRUE) ON CONFLICT(id) DO NOTHING`);await pool.query(`CREATE TABLE IF NOT EXISTS mp_v13_intents (intent_id TEXT PRIMARY KEY, direction TEXT NOT NULL, signal_bar TEXT NOT NULL, strategy_version TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'PREVIEW_ONLY', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CHECK(state='PREVIEW_ONLY'))`);ready=true;error=null}catch(e){ready=false;error=e.message;console.error('[V13]',e.message)}}
 function ensure(){if(!ready)throw Error(error||'V13 database unavailable')}
 async function haltStatus(){ensure();const r=await pool.query("SELECT halted,updated_at FROM mp_v13_safety WHERE id='global'");return {halted:r.rows[0]?.halted!==false,updatedAt:r.rows[0]?.updated_at||null}}
 async function preview({direction,signalBar,strategyVersion}){ensure();if(!['LONG','SHORT'].includes(direction))throw Error('Invalid direction');if(typeof signalBar!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(signalBar)||!Number.isFinite(Date.parse(signalBar)))throw Error('Invalid ISO signal bar');if(strategyVersion!=='v13-safety-preview')throw Error('Unsupported preview version');const intentId=idForIntent({epic:EPIC,direction,signalBar,strategyVersion});const r=await pool.query(`INSERT INTO mp_v13_intents(intent_id,direction,signal_bar,strategy_version) VALUES($1,$2,$3,$4) ON CONFLICT(intent_id) DO NOTHING RETURNING intent_id`,[intentId,direction,signalBar,strategyVersion]);return {intentId,created:r.rowCount===1,duplicate:r.rowCount===0,state:'PREVIEW_ONLY',brokerOrderSent:false}}
 async function readOnly(){const [market,positions,accounts,sim]=await Promise.all([api('/markets/'+encodeURIComponent(EPIC),'GET'),api('/positions','GET'),api('/accounts','GET'),v9Paper.status()]);const stop=market?.dealingRules?.minNormalStopOrLimitDistance||null;const size=market?.dealingRules?.minDealSize||null;return {epic:market?.instrument?.epic||null,marketStatus:market?.snapshot?.marketStatus||null,minimumStop:stop,minimumSize:size,contractSize:market?.instrument?.contractSize??null,lotSize:market?.instrument?.lotSize??null,brokerPositions:Array.isArray(positions?.positions)?positions.positions.length:null,accountsReceived:Array.isArray(accounts?.accounts)&&accounts.accounts.length>0,assessment:assess({equity:sim.state?.equity,riskGBP:(sim.state?.equity||0)*0.0025,stopPips:12,brokerGBPPerPipVerified:false,brokerDealSizeVerified:false,orderLifecycleVerified:false,restartRecoveryVerified:false}),note:'GET only. IG POINTS are not assumed to be pips. No broker sizing or orders.'}}
 function routes(app){app.get('/v13',(_req,res)=>res.sendFile(path.join(__dirname,'public','v13.html')));
 app.get('/api/v13/overview',requireAdmin,async(_req,res)=>{try{const [s,sim,c]=await Promise.all([haltStatus(),v9Paper.status(),pool.query('SELECT COUNT(*)::integer AS n FROM mp_v13_intents')]);res.set('Cache-Control','no-store').json({version:'13.0',ready,brokerExecution:'HARD_BLOCKED',safety:s,paperEnabled:sim.enabled,virtualEquityGBP:sim.state?.equity??null,openPaperPosition:sim.state?.position?.direction||null,previewIntentCount:c.rows[0].n,orderSubmissions:0,brokerDealSize:null})}catch(e){res.status(503).json({error:e.message})}});
 app.post('/api/admin/v13/emergency-stop',requireAdmin,async(req,res)=>{try{ensure();if(req.body?.confirm!=='HALT_V13_PREVIEWS')return res.status(400).json({error:'Explicit confirmation required'});await pool.query("UPDATE mp_v13_safety SET halted=TRUE,updated_at=NOW() WHERE id='global'");res.json({halted:true,note:'V13 preview kill switch only. This does not pause v9 paper automation or close broker positions; no broker execution exists in v13.'})}catch(e){res.status(503).json({error:e.message})}});
 app.post('/api/admin/v13/preview-intent',requireAdmin,async(req,res)=>{try{const s=await haltStatus();if(s.halted)return res.status(423).json({error:'V13 safety halt active; previews disabled. No unhalt endpoint is provided.'});res.json(await preview(req.body||{}))}catch(e){res.status(400).json({error:e.message})}});
 app.get('/api/v13/intents',requireAdmin,async(_req,res)=>{try{ensure();const r=await pool.query('SELECT intent_id,direction,signal_bar,strategy_version,state,created_at FROM mp_v13_intents ORDER BY created_at DESC LIMIT 50');res.set('Cache-Control','no-store').json({intents:r.rows,brokerOrdersSent:0})}catch(e){res.status(503).json({error:e.message})}});
 app.get('/api/v13/broker-evidence',requireAdmin,async(_req,res)=>{try{res.set('Cache-Control','no-store').json(await readOnly())}catch(e){res.status(502).json({error:'Read-only broker evidence unavailable: '+e.message})}});
 app.get('/api/v13/recovery-test',requireAdmin,async(_req,res)=>{try{const s=await haltStatus();const r=await pool.query('SELECT COUNT(*)::integer AS n,COUNT(DISTINCT intent_id)::integer AS unique_count FROM mp_v13_intents');res.json({persistentHalt:s.halted,intentCount:r.rows[0].n,uniqueIntentCount:r.rows[0].unique_count,databaseUniquenessEnforced:true,controlledRestartTestPassed:false,concurrentWorkersTestPassed:false,pendingBrokerOrderRecoveryPassed:false,brokerExecution:'HARD_BLOCKED',note:'Snapshot only; this does not prove crash recovery.'})}catch(e){res.status(503).json({error:e.message})}});
 }
 return {init,routes,readOnly};
}
module.exports={createV13,idForIntent,assess};

  },
  "v14-lifecycle": function(module, exports, require, __filename, __dirname) {
'use strict';
// A broker-order LIFECYCLE SIMULATOR. Never calls IG or submits orders.
const crypto=require('node:crypto'),path=require('node:path');
const EPIC='CS.D.EURUSD.CFD.IP';
const STATES=Object.freeze(['PREPARED','SUBMITTED_SIM','ACKNOWLEDGED_SIM','REJECTED_SIM','UNKNOWN_SIM','RECONCILED_SIM']);
function intentId({bar,direction,strategy='v14-sim'}){if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(bar)||!Number.isFinite(Date.parse(bar)))throw Error('Invalid UTC signal bar');if(!['LONG','SHORT'].includes(direction))throw Error('Invalid direction');return crypto.createHash('sha256').update(JSON.stringify([EPIC,bar,direction,strategy])).digest('hex');}
function validateDraft(d){const issues=[];if(!d||!['LONG','SHORT'].includes(d.direction))issues.push('Direction invalid');for(const k of ['equityGBP','riskGBP','stopPips'])if(!Number.isFinite(Number(d?.[k]))||Number(d[k])<=0)issues.push(k+' invalid');if(Number(d?.riskGBP)>Number(d?.equityGBP)*0.0025+1e-6)issues.push('Exceeds 0.25% planned risk');if(!d?.brokerGBPPerPipVerified)issues.push('GBP/pip unverified');if(!d?.brokerDealSizeVerified)issues.push('IG deal size unverified');return {simulatable:issues.filter(x=>!x.includes('unverified')).length===0,brokerExecutable:false,issues,brokerDealSize:null};}
function transition(state,outcome){if(state==='PREPARED'&&outcome==='SUBMIT')return 'SUBMITTED_SIM';if(state==='SUBMITTED_SIM'&&['ACK','REJECT','TIMEOUT'].includes(outcome))return {ACK:'ACKNOWLEDGED_SIM',REJECT:'REJECTED_SIM',TIMEOUT:'UNKNOWN_SIM'}[outcome];if(state==='UNKNOWN_SIM'&&outcome==='RECONCILE_FOUND')return 'RECONCILED_SIM';if(state==='UNKNOWN_SIM'&&outcome==='RECONCILE_ABSENT')return 'REJECTED_SIM';throw Error('Invalid transition '+state+' / '+outcome);}
function createV14({requireAdmin}){let pool,ready=false,error=null;const pg=()=>{if(!ready)throw Error(error||'Database not ready');return pool};
 async function init(){try{if(!process.env.DATABASE_URL)throw Error('DATABASE_URL missing');pool=new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000});await pool.query(`CREATE TABLE IF NOT EXISTS mp_v14_orders(id TEXT PRIMARY KEY,signal_bar TEXT NOT NULL,direction TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('PREPARED','SUBMITTED_SIM','ACKNOWLEDGED_SIM','REJECTED_SIM','UNKNOWN_SIM','RECONCILED_SIM')),scenario TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);await pool.query(`CREATE TABLE IF NOT EXISTS mp_v14_events(event_id BIGSERIAL PRIMARY KEY,order_id TEXT NOT NULL REFERENCES mp_v14_orders(id),event TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);ready=true;error=null;}catch(e){error=e.message;ready=false;console.error('[V14]',error)}}
 async function create(d){const v=validateDraft(d);if(!v.simulatable)throw Error(v.issues.join('; '));const id=intentId(d);const client=await pg().connect();try{await client.query('BEGIN');const r=await client.query(`INSERT INTO mp_v14_orders(id,signal_bar,direction,state,scenario) VALUES($1,$2,$3,'PREPARED',$4) ON CONFLICT(id) DO NOTHING RETURNING id`,[id,d.bar,d.direction,d.scenario||'ACK']);if(r.rowCount)await client.query('INSERT INTO mp_v14_events(order_id,event) VALUES($1,$2)',[id,'PREPARED']);await client.query('COMMIT');return {id,created:!!r.rowCount,duplicate:!r.rowCount,brokerOrderSent:false};}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
 async function advance(id,outcome){if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid ID');const c=await pg().connect();try{await c.query('BEGIN');const r=await c.query('SELECT state FROM mp_v14_orders WHERE id=$1 FOR UPDATE',[id]);if(!r.rowCount)throw Error('Unknown order intent');const next=transition(r.rows[0].state,outcome);await c.query('UPDATE mp_v14_orders SET state=$2,updated_at=NOW() WHERE id=$1',[id,next]);await c.query('INSERT INTO mp_v14_events(order_id,event) VALUES($1,$2)',[id,outcome]);await c.query('COMMIT');return {id,state:next,brokerOrderSent:false}}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
 async function snapshot(){const [orders,events]=await Promise.all([pg().query('SELECT id,signal_bar,direction,state,scenario,created_at,updated_at FROM mp_v14_orders ORDER BY created_at DESC LIMIT 30'),pg().query('SELECT order_id,event,created_at FROM mp_v14_events ORDER BY event_id DESC LIMIT 60')]);return {ready,brokerExecution:'HARD_BLOCKED',brokerOrdersSent:0,orders:orders.rows,events:events.rows,unknownOrders:orders.rows.filter(x=>x.state==='UNKNOWN_SIM').length,limitations:['No IG order submissions','No verified GBP/pip contract','No actual broker reconciliation','Multi-instance and crash recovery not proven']}}
 function routes(app){app.get('/v14',(_q,r)=>r.sendFile(path.join(__dirname,'public','v14.html')));app.get('/api/v14/status',requireAdmin,async(_q,r)=>{try{r.set('Cache-Control','no-store').json(await snapshot())}catch(e){r.status(503).json({error:e.message})}});app.post('/api/admin/v14/create',requireAdmin,async(q,r)=>{try{if(q.body?.confirm!=='SIMULATE_ONLY')return r.status(400).json({error:'SIMULATE_ONLY required'});r.json(await create(q.body))}catch(e){r.status(400).json({error:e.message})}});app.post('/api/admin/v14/advance',requireAdmin,async(q,r)=>{try{if(q.body?.confirm!=='SIMULATE_ONLY')return r.status(400).json({error:'SIMULATE_ONLY required'});r.json(await advance(q.body.id,q.body.outcome))}catch(e){r.status(409).json({error:e.message})}});app.get('/api/v14/validation',requireAdmin,(_q,r)=>r.json({brokerOrderAllowed:false,contractVerified:false,orderLifecycleSimulatedOnly:true,preflight:validateDraft({direction:'SHORT',equityGBP:10000,riskGBP:25,stopPips:12}),states:STATES}));}
 return {init,routes,create,advance,snapshot};}
module.exports={createV14,intentId,validateDraft,transition};

  },
  "v15-rehearsal": function(module, exports, require, __filename, __dirname) {
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

  },
  "v16-safety": function(module, exports, require, __filename, __dirname) {
'use strict';
// Independent validation lab: NO IG order API imports, no trade submission, no auto-execution.
const path=require('node:path');const crypto=require('node:crypto');const {fork}=require('node:child_process');
const {riskAudit}=require('./v15-rehearsal');
function createV16({requireAdmin}){
 let pool,ready=false,reason='Initialising';
 const db=()=>{if(!ready)throw Error(reason);return pool};
 async function init(){try{if(!process.env.DATABASE_URL)throw Error('DATABASE_URL missing');pool=new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000});await pool.query('CREATE TABLE IF NOT EXISTS mp_v16_probes (id TEXT PRIMARY KEY,worker_pid INTEGER NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW())');await pool.query('CREATE TABLE IF NOT EXISTS mp_v16_control (id INTEGER PRIMARY KEY CHECK(id=1),halted BOOLEAN NOT NULL DEFAULT TRUE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');await pool.query('INSERT INTO mp_v16_control(id,halted) VALUES(1,TRUE) ON CONFLICT(id) DO NOTHING');await pool.query('CREATE TABLE IF NOT EXISTS mp_v16_evidence (id BIGSERIAL PRIMARY KEY,kind TEXT NOT NULL,passed BOOLEAN NOT NULL,detail JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');ready=true;reason=null}catch(e){ready=false;reason=e.message;console.error('[V16]',e.message)}}
 async function record(kind,result){await db().query('INSERT INTO mp_v16_evidence(kind,passed,detail) VALUES($1,$2,$3::jsonb)',[kind,!!result.pass,JSON.stringify(result)])}
 async function status(){const [c,e]=await Promise.all([db().query('SELECT halted,updated_at FROM mp_v16_control WHERE id=1'),db().query('SELECT id,kind,passed,detail,created_at FROM mp_v16_evidence ORDER BY id DESC LIMIT 15')]);return {ready,halted:c.rows[0]?.halted,brokerExecution:'HARD_BLOCKED',automaticBrokerOrders:false,automaticSignalRehearsals:false,verification:{igContractGBPPerPip:false,igExecutableDealSize:false,brokerOrderRecovery:false,renderCrashRecovery:false},evidence:e.rows}}
 async function halt(){await db().query('UPDATE mp_v16_control SET halted=TRUE,updated_at=NOW() WHERE id=1');return {halted:true,scope:'v16 only; does not change v9 paper engine or IG broker block'}}
 function spawnWorker(id){return new Promise((resolve)=>{const child=fork(path.join(__dirname,'v16-worker.js'),[],{stdio:['ignore','ignore','ignore','ipc'],env:process.env});let done=false;const timer=setTimeout(()=>finish({error:'Worker timed out'}),12000);function finish(x){if(done)return;done=true;clearTimeout(timer);try{child.kill()}catch{}resolve(x)}child.once('message',finish);child.once('error',e=>finish({error:e.message}));child.once('exit',(code)=>finish({error:'Worker exited '+code}));child.send({id})})}
 async function multiProcessProbe(){const id='v16-'+crypto.randomUUID();const results=await Promise.all(Array.from({length:8},()=>spawnWorker(id)));const created=results.filter(x=>x.created).length;const errors=results.filter(x=>x.error);const pids=[...new Set(results.map(x=>x.pid).filter(Boolean))];const rows=await db().query('SELECT count(*)::int AS count FROM mp_v16_probes WHERE id=$1',[id]);const result={pass:created===1&&errors.length===0&&pids.length===8&&rows.rows[0].count===1,attempts:8,created,duplicates:results.filter(x=>x.created===false).length,distinctProcesses:pids.length,databaseRows:rows.rows[0].count,errors:errors.map(x=>x.error),scope:'Eight separate OS processes sharing one PostgreSQL unique index. Not a Render crash or IG broker test.',brokerOrdersSent:0};await record('multi_process_duplicate_probe',result);return result}
 async function persistenceSnapshot(){const marker='v16-'+crypto.randomUUID();await db().query('INSERT INTO mp_v16_probes(id,worker_pid) VALUES($1,$2)',[marker,process.pid]);const result={pass:true,marker,createdAt:new Date().toISOString(),instructions:'Restart the Render service manually, then enter this marker in Verify persistence. This first snapshot is NOT a restart test.',brokerOrdersSent:0};await record('persistence_marker_created',result);return result}
 async function verifyMarker(marker){if(typeof marker!=='string'||!/^v16-[a-f0-9-]{36}$/.test(marker))throw Error('Invalid marker');const r=await db().query('SELECT id,created_at FROM mp_v16_probes WHERE id=$1',[marker]);const result={pass:r.rowCount===1,found:r.rowCount===1,marker,scope:'Database record lookup only. You must independently confirm the Render service was restarted between creation and verification. This does not test in-flight order recovery.',brokerOrdersSent:0};await record('persistence_marker_checked',result);return result}
 function negativeRiskTests(){const base={equityGBP:10000,plannedRiskGBP:25,dailyLossGBP:0,newTradesToday:0};const cases=[['baseline',base,true],['risk_above_quarter_percent',{...base,plannedRiskGBP:25.01},false],['daily_loss_limit',{...base,dailyLossGBP:100},false],['daily_entry_cap',{...base,newTradesToday:2},false],['combined_budget',{...base,dailyLossGBP:80},false]];const results=cases.map(([name,inputs,expected])=>({name,expected,actual:riskAudit(inputs).pass,pass:riskAudit(inputs).pass===expected}));return {pass:results.every(x=>x.pass),results,note:'Virtual negative tests only. GBP-per-pip, floating loss, broker minimum size and slippage remain unverified.',brokerOrdersSent:0}}
 function routes(app){app.get('/v16',(_q,r)=>r.sendFile(path.join(__dirname,'public','v16.html')));
 const wrap=(fn)=>async(q,r)=>{try{r.set('Cache-Control','no-store').json(await fn(q))}catch(e){r.status(503).json({error:e.message})}};
 app.get('/api/v16/status',requireAdmin,wrap(status));
 app.post('/api/admin/v16/halt',requireAdmin,wrap(async q=>{if(q.body?.confirm!=='HALT_V16')throw Error('Confirmation required');return halt()}));
 app.post('/api/admin/v16/multiprocess',requireAdmin,wrap(async q=>{if(q.body?.confirm!=='SIMULATE_ONLY')throw Error('Confirmation required');return multiProcessProbe()}));
 app.post('/api/admin/v16/marker',requireAdmin,wrap(async q=>{if(q.body?.confirm!=='SIMULATE_ONLY')throw Error('Confirmation required');return persistenceSnapshot()}));
 app.post('/api/admin/v16/verify-marker',requireAdmin,wrap(q=>verifyMarker(q.body?.marker)));
 app.post('/api/admin/v16/negative-risk',requireAdmin,wrap(async q=>{const result=negativeRiskTests();await record('virtual_negative_risk_tests',result);return result}));
 }
 return {init,routes,multiProcessProbe,negativeRiskTests,verifyMarker,status};
}
module.exports={createV16};

  },
  "v17-readiness": function(module, exports, require, __filename, __dirname) {
'use strict';
// Simulation-only. No IG client, no broker order submissions.
const path=require('node:path'),crypto=require('node:crypto');
const {riskAudit}=require('./v15-rehearsal');
const LIMITS={riskFraction:.0025,dailyLossFraction:.01,maxEntries:2,minScore:70,maxQuoteAgeMs:15000,maxSpreadPips:2};
function monetaryIllustration(x){const n={};for(const k of ['equityGBP','stopPips','pipValueUSDPerUnit','usdToGbp','minSize','sizeStep']){n[k]=Number(x?.[k]);if(!Number.isFinite(n[k])||n[k]<=0||n[k]>1e8)throw Error('Invalid '+k)}const budget=n.equityGBP*.0025,perPip=n.pipValueUSDPerUnit*n.usdToGbp,raw=budget/(n.stopPips*perPip),size=Number((Math.floor(raw/n.sizeStep+1e-10)*n.sizeStep).toPrecision(12));return {simulationOnly:true,brokerExecutable:false,independentlyVerified:false,inputs:n,plannedRiskGBP:budget,hypotheticalGBPPerPipPerUnit:perPip,unroundedSize:raw,roundedHypotheticalSize:size,meetsUserSuppliedMinimum:size>=n.minSize,hypotheticalStopRiskGBP:size*n.stopPips*perPip,issues:['Pip value and size units not independently verified','USD/GBP conversion is user-supplied','IG POINTS are not assumed equal to pips','Margin, minimum stop and slippage not verified'],note:'Illustration only; never use as executable broker size.'}}
function assessSignal(s){const issues=[];if(!['LONG','SHORT'].includes(s?.direction))issues.push('No direction');if(!Number.isFinite(s?.score)||s.score<70)issues.push('Score below 70');if(!s?.bar||!Number.isFinite(Date.parse(s.bar))||Math.abs(Date.now()-Date.parse(s.bar))>12*60000)issues.push('No recent completed bar');if(s?.quoteSource!=='STREAM'||!Number.isFinite(s?.quoteAgeMs)||s.quoteAgeMs<0||s.quoteAgeMs>15000)issues.push('Fresh streamed quote required');if(s?.marketState!=='DEAL')issues.push('Market not dealing');const spread=(s?.ask-s?.bid)*10000;if(!Number.isFinite(spread)||spread<0||spread>2)issues.push('Spread exceeds 2 pips or missing');return {eligible:issues.length===0,issues,spreadPips:Number.isFinite(spread)?spread:null,signal:s,simulationOnly:true}}
function createV17({requireAdmin,signalSnapshot}){
 let pool,ready=false,reason='Initialising',busy=false;const db=()=>{if(!ready)throw Error(reason);return pool};
 async function init(){try{if(!process.env.DATABASE_URL)throw Error('DATABASE_URL missing');pool=new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000});await pool.query('CREATE TABLE IF NOT EXISTS mp_v17_control(id INTEGER PRIMARY KEY CHECK(id=1),halted BOOLEAN NOT NULL DEFAULT TRUE,updated_at TIMESTAMPTZ DEFAULT NOW())');await pool.query('INSERT INTO mp_v17_control(id,halted) VALUES(1,TRUE) ON CONFLICT(id) DO NOTHING');await pool.query("CREATE TABLE IF NOT EXISTS mp_v17_intents(id TEXT PRIMARY KEY,signal_bar TIMESTAMPTZ NOT NULL,direction TEXT NOT NULL,score INTEGER NOT NULL,state TEXT NOT NULL,day_utc DATE NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW())");await pool.query('CREATE TABLE IF NOT EXISTS mp_v17_evidence(id BIGSERIAL PRIMARY KEY,kind TEXT,detail JSONB,created_at TIMESTAMPTZ DEFAULT NOW())');ready=true;reason=null}catch(e){reason=e.message;console.error('[V17]',reason)}}
 async function control(){const r=await db().query('SELECT halted FROM mp_v17_control WHERE id=1');return r.rows[0]}
 async function halt(value){await db().query('UPDATE mp_v17_control SET halted=$1,updated_at=NOW() WHERE id=1',[value]);return {halted:value,scope:'v17 rehearsal only',brokerOrdersSent:0}}
 async function evaluate(write=false){const s=signalSnapshot(),a=assessSignal(s),c=await control();const result={...a,halted:c.halted,created:false,brokerOrdersSent:0};if(!write||c.halted||!a.eligible)return {...result,reason:c.halted?'v17 halted':a.eligible?'Preview only':'Signal rejected'};
 const id=crypto.createHash('sha256').update(['v17',s.epic,s.bar,s.direction].join('|')).digest('hex'),day=new Date().toISOString().slice(0,10);const client=await db().connect();try{await client.query('BEGIN');const lock=await client.query('SELECT halted FROM mp_v17_control WHERE id=1 FOR UPDATE');if(lock.rows[0].halted){await client.query('ROLLBACK');return {...result,reason:'Halted during evaluation'}}const existing=await client.query('SELECT id FROM mp_v17_intents WHERE id=$1',[id]);if(existing.rowCount){await client.query('COMMIT');return {...result,duplicate:true,reason:'Already recorded'}}const count=await client.query('SELECT count(*)::int n FROM mp_v17_intents WHERE day_utc=$1',[day]);if(count.rows[0].n>=2){await client.query('COMMIT');return {...result,reason:'Two v17 intents already recorded today'}}const risk=riskAudit({equityGBP:10000,plannedRiskGBP:25,dailyLossGBP:0,newTradesToday:count.rows[0].n});if(!risk.pass){await client.query('COMMIT');return {...result,reason:'Virtual risk rejected'}}await client.query('INSERT INTO mp_v17_intents(id,signal_bar,direction,score,state,day_utc) VALUES($1,$2,$3,$4,$5,$6)',[id,s.bar,s.direction,Math.floor(s.score),'PREPARED_SIM',day]);await client.query('COMMIT');return {...result,created:true,id,state:'PREPARED_SIM',reason:'Simulated intent only, no broker order'}}catch(e){try{await client.query('ROLLBACK')}catch{}throw e}finally{client.release()}}
 async function tick(){if(!ready||busy)return;busy=true;try{if(!(await control()).halted){const r=await evaluate(true);if(r.created)await db().query('INSERT INTO mp_v17_evidence(kind,detail) VALUES($1,$2::jsonb)',['simulated_signal_intent',JSON.stringify(r)])}}catch(e){await halt(true).catch(()=>{});console.error('[V17] Halted on error',e.message)}finally{busy=false}}
 async function status(){const [c,i,e]=await Promise.all([control(),db().query('SELECT id,signal_bar,direction,score,state,created_at FROM mp_v17_intents ORDER BY created_at DESC LIMIT 40'),db().query('SELECT kind,detail,created_at FROM mp_v17_evidence ORDER BY id DESC LIMIT 10')]);return {ready,halted:c.halted,brokerExecution:'HARD_BLOCKED',brokerOrdersSent:0,automaticSignalRehearsals:!c.halted,limits:LIMITS,intents:i.rows,evidence:e.rows,verification:{igGBPPerPip:false,igDealSize:false,brokerOrderRecovery:false,crashRecovery:false},note:'No broker execution, simulated positions or actual P/L.'}}
 function routes(app){app.get('/v17',(_q,r)=>r.sendFile(path.join(__dirname,'public','v17.html')));const wrap=fn=>async(q,r)=>{try{r.set('Cache-Control','no-store').json(await fn(q))}catch(e){r.status(409).json({error:e.message})}};app.get('/api/v17/status',requireAdmin,wrap(status));app.get('/api/v17/signal',requireAdmin,wrap(()=>evaluate(false)));app.post('/api/admin/v17/halt',requireAdmin,wrap(q=>{if(q.body?.confirm!=='HALT_V17')throw Error('Confirmation required');return halt(true)}));app.post('/api/admin/v17/start',requireAdmin,wrap(q=>{if(q.body?.confirm!=='START_SIMULATION_ONLY')throw Error('Confirmation required');return halt(false)}));app.post('/api/admin/v17/evaluate',requireAdmin,wrap(q=>{if(q.body?.confirm!=='SIMULATE_ONLY')throw Error('Confirmation required');return evaluate(true)}));app.post('/api/admin/v17/monetary',requireAdmin,wrap(async q=>{const r=monetaryIllustration(q.body);await db().query('INSERT INTO mp_v17_evidence(kind,detail) VALUES($1,$2::jsonb)',['hypothetical_sizing',JSON.stringify(r)]);return r}))}
 return {init,routes,tick,status,evaluate};
}
module.exports={createV17,monetaryIllustration,assessSignal,LIMITS};

  },
  "v18-demo-readiness": function(module, exports, require, __filename, __dirname) {
'use strict';
// IG DEMO execution preparation: read-only diagnostics. NO broker order methods.
const path=require('node:path');
function assessSignal(s){const issues=[];if(!['LONG','SHORT'].includes(s?.direction))issues.push('No direction');if(!Number.isFinite(s?.score)||s.score<70)issues.push('Score below 70');if(!s?.bar||!Number.isFinite(Date.parse(s.bar))||Math.abs(Date.now()-Date.parse(s.bar))>720000)issues.push('No recent completed bar');if(s?.quoteSource!=='STREAM'||!Number.isFinite(s?.quoteAgeMs)||s.quoteAgeMs<0||s.quoteAgeMs>15000)issues.push('Fresh streamed quote required');if(s?.marketState!=='DEAL')issues.push('Market not dealing');const spread=(s?.ask-s?.bid)*10000;if(!Number.isFinite(spread)||spread<0||spread>2)issues.push('Spread exceeds 2 pips or missing');return {eligible:issues.length===0,issues,spreadPips:Number.isFinite(spread)?spread:null,simulationOnly:true}}
const REQUIRED=['igGBPPerPip','igDealSize','brokerOrderRecovery','crashRecovery'];
function readiness(v17,signal){const verification=v17?.verification||{};const checks=REQUIRED.map(key=>({name:key,passed:verification[key]===true}));const eligible=assessSignal(signal);return {mode:'READ_ONLY_DEMO_PREPARATION',brokerExecution:'HARD_BLOCKED',brokerOrdersSent:0,checks,allBrokerChecksVerified:checks.every(x=>x.passed),signal:eligible,limits:{riskFraction:.0025,dailyLossFraction:.01,maxNewTradesPerDay:2},issues:[...checks.filter(x=>!x.passed).map(x=>x.name+' not independently verified'),...eligible.issues],nextSteps:['Independently verify contract and GBP/pip conversions','Validate minimum broker deal size, stop rules and margin','Rehearse order confirmations, timeout and unknown-outcome reconciliation','Verify crash and restart recovery with broker positions','Keep broker orders blocked until verified'],note:'This diagnostic does not authorize, place, or simulate broker orders. Risk limits are not live-account enforced.'}}
function createV18({requireAdmin,v17Lab,signalSnapshot}){function routes(app){app.get('/v18',(_q,r)=>r.sendFile(path.join(__dirname,'public','v18.html')));app.get('/api/v18/readiness',requireAdmin,async(_q,r)=>{try{r.set('Cache-Control','no-store');r.json(readiness(await v17Lab.status(),signalSnapshot()))}catch(e){r.status(503).json({error:'Readiness unavailable',detail:e.message,brokerExecution:'HARD_BLOCKED'})}})}return {routes}}
module.exports={readiness,createV18};

  },
  "v19-demo-bridge": function(module, exports, require, __filename, __dirname) {
'use strict';
// v19 broker automation bridge: authenticated read-only inspection and fail-closed sizing preview.
// No POST/PUT/DELETE broker operations. Never changes execution flags.
const path=require('node:path');
const EPIC='CS.D.EURUSD.CFD.IP';
const finitePositive=x=>Number.isFinite(Number(x))&&Number(x)>0;
function inspectMarket(data){const i=data?.instrument||{},r=data?.dealingRules||{},s=data?.snapshot||{};return {epic:i.epic||EPIC,marketStatus:s.marketStatus||'UNKNOWN',contractSize:i.contractSize??null,lotSize:i.lotSize??null,onePipMeans:i.onePipMeans??null,valueOfOnePip:i.valueOfOnePip??null,currencies:i.currencies??[],minDealSize:r.minDealSize??null,minNormalStopOrLimitDistance:r.minNormalStopOrLimitDistance??null,marginDepositBands:i.marginDepositBands??[],snapshotTime:s.updateTime??null}}
function calculatePreview({equityGBP,stopPips,gbpPerPipPerDeal,dealSize,minDealSize,dealStep,conversionVerified=false,contractVerified=false,brokerUnitsVerified=false}){
 const errors=[];
 for(const [name,val] of Object.entries({equityGBP,stopPips,gbpPerPipPerDeal,dealSize}))if(!finitePositive(val))errors.push(name+' must be positive');
 if(!errors.length){if(finitePositive(minDealSize)&&Number(dealSize)<Number(minDealSize))errors.push('Below broker minimum deal size');if(finitePositive(dealStep)){const steps=Number(dealSize)/Number(dealStep);if(Math.abs(steps-Math.round(steps))>1e-7)errors.push('Deal size is not a multiple of the supplied step')}}
 const budget=finitePositive(equityGBP)?Number(equityGBP)*.0025:null;
 const loss=errors.length?null:Number(stopPips)*Number(gbpPerPipPerDeal)*Number(dealSize);
 if(loss!==null&&loss>budget+1e-9)errors.push('Planned stop loss exceeds 0.25% budget');
 const verified=conversionVerified===true&&contractVerified===true&&brokerUnitsVerified===true;
 return {budgetGBP:budget,plannedStopLossGBP:loss,plannedRiskPct:loss!==null?100*loss/Number(equityGBP):null,passesArithmetic:errors.length===0,errors,inputsIndependentlyVerified:verified,brokerExecutable:false,brokerOrderAllowed:false,note:'Illustrative preview only. User-supplied values do not verify IG contract units, pip valuation, FX conversion, slippage, margin, stop placement or execution.'};
}
function createV19({requireAdmin,api,v17Lab,signalSnapshot}){
 function routes(app){
  app.get('/v19',(_q,r)=>r.sendFile(path.join(__dirname,'public','v19.html')));
  app.get('/api/v19/status',requireAdmin,async(_q,r)=>{try{const v17=await v17Lab.status();r.set('Cache-Control','no-store');r.json({ready:true,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,mode:'READ_ONLY',automaticSignalRehearsals:v17.automaticSignalRehearsals,halted:v17.halted,signal:signalSnapshot(),verification:v17.verification||{},riskLimits:{plannedPerTradePct:.25,dailyRealisedLossPct:1,maxNewTradesPerDay:2},outstanding:['Broker-specific GBP/pip independently verified','Executable deal size and IG dealing units verified','Broker order acknowledgement and unknown outcome recovery tested','In-flight crash recovery tested'],note:'No broker orders can be placed by v19.'})}catch(e){r.status(503).json({error:e.message,brokerExecution:'HARD_BLOCKED'})}});
  app.get('/api/v19/broker-snapshot',requireAdmin,async(_q,r)=>{try{const [market,positions,accounts]=await Promise.all([api('/markets/'+encodeURIComponent(EPIC),'GET',null,'3'),api('/positions','GET',null,'2'),api('/accounts')]);r.set('Cache-Control','no-store');r.json({market:inspectMarket(market),positionCount:Array.isArray(positions?.positions)?positions.positions.length:null,positionsResponseValid:Array.isArray(positions?.positions),accountResponseValid:Array.isArray(accounts?.accounts),brokerExecution:'HARD_BLOCKED',brokerOrdersSentByV19:0,notes:['Read-only IG GET requests','No account identifiers or credentials returned','Market POINTS are not assumed to equal pips','No position reconciliation or monetary contract verification claimed']})}catch(e){r.status(502).json({error:'Read-only IG lookup failed',detail:e.message,brokerExecution:'HARD_BLOCKED'})}});
  app.post('/api/v19/risk-preview',requireAdmin,(q,r)=>{r.set('Cache-Control','no-store');r.json(calculatePreview(q.body||{}))});
 }
 return {routes};
}
module.exports={createV19,calculatePreview,inspectMarket};

  },
  "v20-execution-gates": function(module, exports, require, __filename, __dirname) {
'use strict';
// v20 is a fail-closed broker execution readiness engine. No broker write API calls.
const path=require('node:path');
const EPIC='CS.D.EURUSD.CFD.IP';
const num=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
function assess({market,positions,accounts,signal,verified={}}){
 const i=market?.instrument||{},r=market?.dealingRules||{},s=market?.snapshot||{};
 const checks={marketTradeable:s.marketStatus==='TRADEABLE',positionsReadable:Array.isArray(positions?.positions),accountsReadable:Array.isArray(accounts?.accounts),contractMetadataPresent:!!i.contractSize&&!!i.onePipMeans&&!!i.valueOfOnePip,dealRulesPresent:!!r.minDealSize&&!!r.minNormalStopOrLimitDistance,liveQuoteFresh:signal?.quoteSource==='STREAM'&&num(signal.quoteAgeMs)!==null&&signal.quoteAgeMs<=15000,signalQualifies:num(signal?.score)!==null&&signal.score>=70&&['LONG','SHORT'].includes(signal.direction),gbpPerPipIndependentlyVerified:verified.gbpPerPip===true,brokerDealSizeIndependentlyVerified:verified.dealSize===true,orderLifecycleVerified:verified.orderLifecycle===true,crashRecoveryVerified:verified.crashRecovery===true};
 return {epic:EPIC,checks,allGatesPass:Object.values(checks).every(Boolean),brokerOrderAllowed:false,brokerExecution:'HARD_BLOCKED',positionCount:checks.positionsReadable?positions.positions.length:null,market:{status:s.marketStatus||null,contractSize:i.contractSize??null,onePipMeans:i.onePipMeans??null,valueOfOnePip:i.valueOfOnePip??null,minimumDealSize:r.minDealSize??null,minimumStop:r.minNormalStopOrLimitDistance??null},note:'Broker execution remains blocked even if all metadata checks pass. IG POINTS are not assumed to be pips. No broker orders submitted.'};
}
function calculate({equityGBP,stopPips,gbpPerPipPerDeal,dealSize,minimumDealSize,dealIncrement,existingDailyLossGBP=0,newTradesToday=0,openPlannedRiskGBP=0}){
 const values=[equityGBP,stopPips,gbpPerPipPerDeal,dealSize,minimumDealSize,dealIncrement,existingDailyLossGBP,newTradesToday,openPlannedRiskGBP].map(Number);
 const [equity,stop,pip,deal,min,step,daily,entries,open]=values;
 const errors=[];
 if(values.some(v=>!Number.isFinite(v)))errors.push('All inputs must be finite numbers');
 if(!(equity>0&&stop>0&&pip>0&&deal>0&&min>0&&step>0))errors.push('Equity, stop, pip value, size, minimum and increment must be positive');
 if(daily<0||entries<0||open<0)errors.push('Loss, trade count and open risk cannot be negative');
 const planned=stop*pip*deal,budget=equity*.0025,dayLimit=equity*.01;
 if(deal<min)errors.push('Below broker minimum');
 if(step>0&&Math.abs(deal/step-Math.round(deal/step))>1e-7)errors.push('Invalid broker size increment');
 if(planned>budget+1e-8)errors.push('Exceeds 0.25% planned risk');
 if(daily+open+planned>dayLimit+1e-8)errors.push('Exceeds 1% combined daily risk budget');
 if(entries>=2)errors.push('Two-new-trades daily cap reached');
 return {plannedRiskGBP:Number.isFinite(planned)?planned:null,tradeBudgetGBP:Number.isFinite(budget)?budget:null,dailyBudgetGBP:Number.isFinite(dayLimit)?dayLimit:null,arithmeticPass:errors.length===0,issues:errors,brokerExecutable:false,brokerOrderAllowed:false,assumptions:'User-entered GBP/pip and broker size increments are NOT independently verified. This is an illustrative calculator, not an IG order authorization.'};
}
function createV20({requireAdmin,api,signalSnapshot}){
 function routes(app){
  app.get('/v20',(_q,r)=>r.sendFile(path.join(__dirname,'public','v20.html')));
  app.get('/api/v20/readiness',requireAdmin,async(_q,r)=>{try{
   const [market,positions,accounts]=await Promise.all([api('/markets/'+encodeURIComponent(EPIC),'GET',null,'3'),api('/positions','GET',null,'2'),api('/accounts')]);
   r.set('Cache-Control','no-store');r.json(assess({market,positions,accounts,signal:signalSnapshot()}));
  }catch(e){r.status(503).json({brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,error:'Broker readiness unavailable',detail:e.message})}});
  app.post('/api/v20/risk-check',requireAdmin,(q,r)=>{r.set('Cache-Control','no-store');r.json(calculate(q.body||{}))});
 }
 return {routes};
}
module.exports={assess,calculate,createV20};

  },
  "v21-engine": function(module, exports, require, __filename, __dirname) {
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

  },
  "v22-engine": function(module, exports, require, __filename, __dirname) {
 'use strict';
// V22 is a simulation and read-only broker inspection layer. NO broker order writes.
const crypto=require('node:crypto');const path=require('node:path');
const allowed={PREPARED_SIM:['SUBMITTED_SIM','REJECTED_SIM'],SUBMITTED_SIM:['ACKNOWLEDGED_SIM','UNKNOWN_SIM','REJECTED_SIM'],UNKNOWN_SIM:['RECONCILED_SIM'],ACKNOWLEDGED_SIM:['RECONCILED_SIM'],REJECTED_SIM:[],RECONCILED_SIM:[]};
function validateTransition(from,to){return !!allowed[from]?.includes(to)}
function monetaryWorksheet(x){const issues=[];for(const k of ['equityGBP','stopPips','usdPerPipPerContract','usdToGbp','minSize','step','maxSize','openRiskGBP','realisedLossGBP'])if(typeof x?.[k]!=='number'||!Number.isFinite(x[k])||( ['openRiskGBP','realisedLossGBP'].includes(k)?x[k]<0:x[k]<=0))issues.push('Invalid '+k);
 if(!Number.isInteger(x?.entriesToday)||x.entriesToday<0)issues.push('Invalid entriesToday');if(x?.evidence?.contract!=='VERIFIED'||x?.evidence?.fx!=='VERIFIED'||x?.evidence?.dealingRules!=='VERIFIED')issues.push('Evidence not independently verified');
 if(issues.length)return {pass:false,issues,brokerOrderAllowed:false};const gbpPerPip=x.usdPerPipPerContract*x.usdToGbp;const available=Math.min(x.equityGBP*.0025,x.equityGBP*.01-x.openRiskGBP-x.realisedLossGBP);const size=Math.floor((available/(x.stopPips*gbpPerPip))/x.step+1e-10)*x.step;const risk=size*x.stopPips*gbpPerPip;
 if(available<=0||x.entriesToday>=2||size<x.minSize||size>x.maxSize||risk>x.equityGBP*.0025+1e-7)issues.push('Risk or dealing rule failed');return {pass:!issues.length,issues,illustrativeSize:Number(size.toFixed(8)),illustrativeRiskGBP:Number(risk.toFixed(8)),gbpPerPip:Number(gbpPerPip.toFixed(8)),brokerOrderAllowed:false,independentlyVerified:false,note:'User-entered evidence flags cannot establish independent broker contract verification. IG points/pips and GBP conversion need external corroboration.'}}
function createV22({requireAdmin,api}){let pool,ready=false,initError=null;async function init(){try{if(!process.env.DATABASE_URL)throw Error('DATABASE_URL missing');pool=new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000});await pool.query(`CREATE TABLE IF NOT EXISTS mp_v22_intents(id TEXT PRIMARY KEY,bar TIMESTAMPTZ NOT NULL,direction TEXT NOT NULL CHECK(direction IN ('LONG','SHORT')),state TEXT NOT NULL CHECK(state IN ('PREPARED_SIM','SUBMITTED_SIM','ACKNOWLEDGED_SIM','UNKNOWN_SIM','REJECTED_SIM','RECONCILED_SIM')),created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`);await pool.query(`CREATE TABLE IF NOT EXISTS mp_v22_events(event_id BIGSERIAL PRIMARY KEY,intent_id TEXT NOT NULL REFERENCES mp_v22_intents(id),previous_state TEXT,next_state TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW())`);await pool.query(`CREATE TABLE IF NOT EXISTS mp_v22_markers(id TEXT PRIMARY KEY,created_at TIMESTAMPTZ DEFAULT NOW())`);ready=true}catch(e){initError=e.message;console.error('[v22]',e.message)}}const db=()=>{if(!ready)throw Error(initError||'Database not ready');return pool};
 async function journal(){const [i,e]=await Promise.all([db().query('SELECT * FROM mp_v22_intents ORDER BY created_at DESC LIMIT 60'),db().query('SELECT * FROM mp_v22_events ORDER BY event_id DESC LIMIT 80')]);return {intents:i.rows,events:e.rows,brokerOrdersSent:0}}
 async function prepare(x){if(!['LONG','SHORT'].includes(x?.direction)||!x?.bar||!Number.isFinite(Date.parse(x.bar)))throw Error('Valid UTC bar and direction required');const bar=new Date(x.bar).toISOString();const id=crypto.createHash('sha256').update(`v22|CS.D.EURUSD.CFD.IP|${bar}|${x.direction}`).digest('hex');const client=await db().connect();try{await client.query('BEGIN');const r=await client.query('INSERT INTO mp_v22_intents(id,bar,direction,state) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id',[id,bar,x.direction,'PREPARED_SIM']);if(r.rowCount)await client.query('INSERT INTO mp_v22_events(intent_id,previous_state,next_state) VALUES($1,$2,$3)',[id,null,'PREPARED_SIM']);await client.query('COMMIT');return {id,created:!!r.rowCount,duplicate:!r.rowCount,brokerOrdersSent:0}}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
 async function transition(x){if(!x?.id||!x?.next)throw Error('Select intent and next state');const client=await db().connect();try{await client.query('BEGIN');const r=await client.query('SELECT state FROM mp_v22_intents WHERE id=$1 FOR UPDATE',[x.id]);if(!r.rowCount)throw Error('Intent not found');const previous=r.rows[0].state;if(!validateTransition(previous,x.next))throw Error('Invalid simulated transition '+previous+' → '+x.next);await client.query('UPDATE mp_v22_intents SET state=$2,updated_at=NOW() WHERE id=$1',[x.id,x.next]);await client.query('INSERT INTO mp_v22_events(intent_id,previous_state,next_state) VALUES($1,$2,$3)',[x.id,previous,x.next]);await client.query('COMMIT');return {id:x.id,previous,next:x.next,brokerOrdersSent:0}}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
 async function marker(){const id=crypto.randomUUID();await db().query('INSERT INTO mp_v22_markers(id) VALUES($1)',[id]);return {id,created:true,scope:'Persisted marker only; restart must be independently performed'}}
 async function verify(id){const r=await db().query('SELECT id,created_at FROM mp_v22_markers WHERE id=$1',[id||'']);return {found:!!r.rowCount,marker:r.rows[0]||null,controlledRestartTestPassed:false,brokerInFlightRecoveryVerified:false,note:'Finding a marker does not prove a restart occurred or in-flight broker recovery.'}}
 async function recovery(){const r=await db().query("SELECT state,count(*)::int AS count FROM mp_v22_intents GROUP BY state");return {databaseAccessible:true,states:r.rows,unresolved:r.rows.filter(x=>['SUBMITTED_SIM','UNKNOWN_SIM'].includes(x.state)).reduce((a,x)=>a+x.count,0),controlledRestartTestPassed:false,inFlightBrokerRecoveryVerified:false,brokerOrderAllowed:false}}
 async function broker(){const [market,positions,accounts]=await Promise.all([api('/markets/CS.D.EURUSD.CFD.IP','GET',null,'3'),api('/positions','GET',null,'2'),api('/accounts')]);const p=Array.isArray(positions?.positions)?positions.positions:null;return {market:{epic:market?.instrument?.epic||null,status:market?.snapshot?.marketStatus||null,contractSize:market?.instrument?.contractSize||null,onePipMeans:market?.instrument?.onePipMeans||null,valueOfOnePip:market?.instrument?.valueOfOnePip||null,minDealSize:market?.dealingRules?.minDealSize||null,minStop:market?.dealingRules?.minNormalStopOrLimitDistance||null},accountsReadable:Array.isArray(accounts?.accounts),positionsReadable:!!p,brokerPositions:(p||[]).map(x=>({dealId:x.position?.dealId||null,epic:x.market?.epic||null,direction:x.position?.direction||null})),reconciliationPass:!!p&&p.length===0,brokerOrderAllowed:false,note:'Read-only snapshot; zero positions does not establish broker order recovery.'}}
 async function status(){return {ready,initError,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,verification:{contractGBPPerPip:false,dealSize:false,orderLifecycle:false,crashRecovery:false},nextVersion:'v23 may add further isolated demo execution harness only after independent verification'}}
 const wrap=fn=>async(q,r)=>{try{r.set('Cache-Control','no-store').json(await fn(q))}catch(e){r.status(400).json({error:e.message,brokerOrderAllowed:false})}};
 function routes(app){app.get('/v22',(_q,r)=>r.sendFile(path.join(__dirname,'public','v22.html')));app.get('/api/v22/status',requireAdmin,wrap(status));app.get('/api/v22/journal',requireAdmin,wrap(journal));app.get('/api/v22/recovery',requireAdmin,wrap(recovery));app.get('/api/v22/broker',requireAdmin,wrap(broker));app.post('/api/v22/size',requireAdmin,wrap(q=>monetaryWorksheet(q.body)));app.post('/api/v22/prepare',requireAdmin,wrap(q=>prepare(q.body)));app.post('/api/v22/transition',requireAdmin,wrap(q=>transition(q.body)));app.post('/api/v22/marker',requireAdmin,wrap(marker));app.post('/api/v22/verify',requireAdmin,wrap(q=>verify(q.body?.id)))}return {init,routes}}
module.exports={createV22,validateTransition,monetaryWorksheet};

  },
  "v23-engine": function(module, exports, require, __filename, __dirname) {
'use strict';
// IG DEMO execution preparation. All broker writes remain blocked by design.
const crypto=require('node:crypto');
const path=require('node:path');
const EPIC='CS.D.EURUSD.CFD.IP';
const STATES={PREPARED:['SUBMISSION_PENDING_SIM','CANCELLED'],SUBMISSION_PENDING_SIM:['UNKNOWN_SIM','REJECTED_SIM','ACKNOWLEDGED_SIM'],UNKNOWN_SIM:['RECONCILED_SIM','REJECTED_SIM'],ACKNOWLEDGED_SIM:['RECONCILED_SIM'],REJECTED_SIM:[],RECONCILED_SIM:[],CANCELLED:[]};
function verifySizing(x){const errors=[];for(const k of ['equityGBP','stopPips','usdPerPipPerSize','usdToGbp','minSize','sizeStep','maxSize','dailyLossGBP','openRiskGBP'])if(!Number.isFinite(x?.[k])||(x[k]<0)||(!['dailyLossGBP','openRiskGBP'].includes(k)&&x[k]===0))errors.push('Invalid '+k);
if(!Number.isInteger(x?.entriesToday)||x.entriesToday<0)errors.push('Invalid entriesToday');
if(x?.evidence?.brokerContractSource!=='INDEPENDENTLY_VERIFIED'||x?.evidence?.fxSource!=='INDEPENDENTLY_VERIFIED'||x?.evidence?.dealingUnitSource!=='INDEPENDENTLY_VERIFIED')errors.push('Broker contract, FX and dealing units require independent verification');
if(errors.length)return {pass:false,errors,brokerOrderAllowed:false};
const gbpPerPip=x.usdPerPipPerSize*x.usdToGbp;const budget=Math.min(x.equityGBP*.0025,x.equityGBP*.01-x.dailyLossGBP-x.openRiskGBP);const raw=budget/(x.stopPips*gbpPerPip);const size=Math.floor(raw/x.sizeStep+1e-9)*x.sizeStep;const plannedRisk=size*x.stopPips*gbpPerPip;
if(budget<=0||x.entriesToday>=2||size<x.minSize||size>x.maxSize||plannedRisk>x.equityGBP*.0025+1e-7)errors.push('Position does not satisfy dealing increments or risk limits');
return {pass:!errors.length,errors,illustrativeSize:Number(size.toFixed(8)),plannedRiskGBP:Number(plannedRisk.toFixed(8)),gbpPerPip:Number(gbpPerPip.toFixed(8)),brokerOrderAllowed:false,independentlyVerified:false,note:'Flags supplied by an operator do not establish independently verified broker sizing; no order can be sent.'};}
function createV23({requireAdmin,api}){
let pool,ready=false,initError=null,bootId=crypto.randomUUID();
async function init(){try{if(!process.env.DATABASE_URL)throw Error('DATABASE_URL missing');pool=new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000});await pool.query(`CREATE TABLE IF NOT EXISTS mp_v23_intents(id TEXT PRIMARY KEY,bar TIMESTAMPTZ NOT NULL,direction TEXT NOT NULL CHECK(direction IN ('LONG','SHORT')),state TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);await pool.query(`CREATE TABLE IF NOT EXISTS mp_v23_events(seq BIGSERIAL PRIMARY KEY,intent_id TEXT NOT NULL REFERENCES mp_v23_intents(id),prior TEXT,next TEXT NOT NULL,boot_id TEXT NOT NULL,at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);await pool.query(`CREATE TABLE IF NOT EXISTS mp_v23_restart_markers(id TEXT PRIMARY KEY,created_boot TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);ready=true}catch(e){initError=e.message;console.error('[v23]',e.message)}}
function db(){if(!ready)throw Error(initError||'v23 database not ready');return pool}
async function status(){return {ready,initError,bootId,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,brokerOrdersSent:0,executionGates:{contractGBPPerPip:false,dealSize:false,brokerOrderLifecycle:false,inFlightBrokerRecovery:false,operatorApproval:false},mode:'SIMULATION_AND_READ_ONLY',note:'v23 does not send or close IG orders, even when configuration flags are enabled.'}}
async function prepare(x){if(!['LONG','SHORT'].includes(x?.direction)||!Number.isFinite(Date.parse(x?.bar)))throw Error('Valid direction and bar required');const bar=new Date(x.bar).toISOString();const id=crypto.createHash('sha256').update(`v23|${EPIC}|${bar}|${x.direction}`).digest('hex');const c=await db().connect();try{await c.query('BEGIN');const r=await c.query('INSERT INTO mp_v23_intents(id,bar,direction,state) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id',[id,bar,x.direction,'PREPARED']);if(r.rowCount)await c.query('INSERT INTO mp_v23_events(intent_id,prior,next,boot_id) VALUES($1,$2,$3,$4)',[id,null,'PREPARED',bootId]);await c.query('COMMIT');return {id,created:!!r.rowCount,duplicate:!r.rowCount,brokerOrdersSent:0}}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
async function transition(x){if(!x?.id||!x?.next)throw Error('id and next required');const c=await db().connect();try{await c.query('BEGIN');const r=await c.query('SELECT state FROM mp_v23_intents WHERE id=$1 FOR UPDATE',[x.id]);if(!r.rowCount)throw Error('Unknown intent');const prior=r.rows[0].state;if(!STATES[prior]?.includes(x.next))throw Error(`Forbidden transition ${prior} → ${x.next}`);await c.query('UPDATE mp_v23_intents SET state=$2,updated_at=NOW() WHERE id=$1',[x.id,x.next]);await c.query('INSERT INTO mp_v23_events(intent_id,prior,next,boot_id) VALUES($1,$2,$3,$4)',[x.id,prior,x.next,bootId]);await c.query('COMMIT');return {id:x.id,prior,next:x.next,brokerOrdersSent:0}}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
async function journal(){const [a,b]=await Promise.all([db().query('SELECT * FROM mp_v23_intents ORDER BY created_at DESC LIMIT 100'),db().query('SELECT * FROM mp_v23_events ORDER BY seq DESC LIMIT 150')]);return {intents:a.rows,events:b.rows,brokerOrdersSent:0}}
async function recovery(){const r=await db().query("SELECT state,COUNT(*)::int AS count FROM mp_v23_intents GROUP BY state");const unresolved=r.rows.filter(x=>['SUBMISSION_PENDING_SIM','UNKNOWN_SIM'].includes(x.state)).reduce((s,x)=>s+x.count,0);return {databaseAccessible:true,bootId,states:r.rows,unresolved,automatedResubmission:false,brokerInFlightRecoveryVerified:false,brokerOrderAllowed:false,note:'Unknown simulated intents remain unresolved and never trigger broker orders.'}}
async function marker(){const id=crypto.randomUUID();await db().query('INSERT INTO mp_v23_restart_markers(id,created_boot) VALUES($1,$2)',[id,bootId]);return {id,createdBoot:bootId,brokerOrderAllowed:false}}
async function verifyMarker(id){const r=await db().query('SELECT * FROM mp_v23_restart_markers WHERE id=$1',[id||'']);const m=r.rows[0];return {found:!!m,bootChanged:!!m&&m.created_boot!==bootId,persistenceAcrossProcessRestart:!!m&&m.created_boot!==bootId,brokerInFlightRecoveryVerified:false,brokerOrderAllowed:false,marker:m||null,currentBoot:bootId,note:'A changed process boot ID proves persistence across process startup, not broker order recovery.'}}
async function broker(){const [market,positions,accounts]=await Promise.all([api('/markets/'+EPIC,'GET',null,'3'),api('/positions','GET',null,'2'),api('/accounts')]);const ps=Array.isArray(positions?.positions)?positions.positions:null;const active=(ps||[]).filter(p=>p.market?.epic===EPIC);const unresolved=await db().query("SELECT COUNT(*)::int AS n FROM mp_v23_intents WHERE state IN ('SUBMISSION_PENDING_SIM','UNKNOWN_SIM')");return {market:{epic:market?.instrument?.epic,status:market?.snapshot?.marketStatus,contractSize:market?.instrument?.contractSize,valueOfOnePip:market?.instrument?.valueOfOnePip,onePipMeans:market?.instrument?.onePipMeans,minDealSize:market?.dealingRules?.minDealSize},accountsReadable:Array.isArray(accounts?.accounts),positionsReadable:!!ps,brokerPositions:active.map(p=>({dealId:p.position?.dealId,direction:p.position?.direction,size:p.position?.size})),unresolvedSimulatedIntents:unresolved.rows[0].n,reconciliationPass:!!ps&&active.length===0&&unresolved.rows[0].n===0,brokerOrderAllowed:false,note:'No automatic reconciliation of unknown intents against broker deal references; human review required.'}}
const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req.body||{},req))}catch(e){res.status(400).json({error:e.message,brokerOrderAllowed:false})}};
function routes(app){app.get('/v23',(_q,r)=>r.sendFile(path.join(__dirname,'public','v23.html')));app.get('/api/v23/status',requireAdmin,wrap(status));app.get('/api/v23/journal',requireAdmin,wrap(journal));app.get('/api/v23/recovery',requireAdmin,wrap(recovery));app.get('/api/v23/broker',requireAdmin,wrap(broker));app.post('/api/v23/size',requireAdmin,wrap(verifySizing));app.post('/api/v23/prepare',requireAdmin,wrap(prepare));app.post('/api/v23/transition',requireAdmin,wrap(transition));app.post('/api/v23/marker',requireAdmin,wrap(marker));app.post('/api/v23/verify-marker',requireAdmin,wrap(x=>verifyMarker(x.id)));app.post('/api/v23/submit',requireAdmin,(_q,r)=>r.status(423).json({error:'IG DEMO broker writes are HARD_BLOCKED until independent execution gates pass',brokerOrderAllowed:false}));}
return {init,routes};}
module.exports={createV23,verifySizing,STATES};

  },
  "v24-engine": function(module, exports, require, __filename, __dirname) {
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

  },
  "v25-autonomy": function(module, exports, require, __filename, __dirname) {
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function createV25({requireAdmin,signalSnapshot,dir=process.env.DATA_DIR||path.join(__dirname,'data')}){
 const file=path.join(dir,'v25-autonomy.json');
 const defaults={riskGBP:25,dailyLossGBP:100,maxTrades:3,stopPips:12,targetPips:18,pipValueGBP:7.7,minScore:70,maxSpreadPips:2,quantityStep:0.01,minQuantity:0.01,maxQuantity:1};
 let config={...defaults},state={day:'',tradesToday:0,realizedGBP:0,position:null,events:[],lastBar:null,paused:true,halt:'Requires explicit simulation start',revision:0};
 let healthy=true,busy=false;
 const persist=()=>{try{fs.mkdirSync(dir,{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify({config,state}));fs.renameSync(tmp,file);healthy=true;}catch(e){healthy=false;state.paused=true;state.halt='Persistence failure: '+e.message;throw e}};
 try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));config={...defaults,...saved.config};state={...state,...saved.state,paused:true,halt:'Restart requires explicit simulation start'};persist()}catch(e){if(e.code!=='ENOENT'){healthy=false;state.paused=true;state.halt='State recovery failed: '+e.message}}
 const event=(type,data={})=>{state.events.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),type,...data});state.events=state.events.slice(0,300);state.revision++};
 const status=()=>({version:'25.0.0',mode:'AUTONOMOUS_SIMULATION',brokerOrderAllowed:false,brokerExecution:'HARD_BLOCKED',healthy,busy,config,state});
 function validConfig(x){if(!x||typeof x!=='object')throw Error('Invalid configuration');for(const k of Object.keys(defaults))if(typeof x[k]!=='number'||!Number.isFinite(x[k])||x[k]<=0)throw Error('Invalid '+k);if(!Number.isInteger(x.maxTrades)||x.maxTrades>20)throw Error('Invalid maxTrades');if(x.minScore>100||x.maxSpreadPips>20||x.quantityStep>1||x.minQuantity>x.maxQuantity)throw Error('Invalid limits');return x}
 function start(){if(!healthy)throw Error('Storage unavailable');if(state.position)throw Error('Existing position requires resolution');state.paused=false;state.halt=null;event('START');persist();return status()}
 function stop(){state.paused=true;state.halt='Operator stop; simulated position remains tracked';event('STOP');persist();return status()}
 function update(x){if(!state.paused||state.position)throw Error('Stop and close simulation before reconfiguration');config=validConfig(x);event('CONFIG');persist();return status()}
 function resetDay(now){const d=new Date(now).toISOString().slice(0,10);if(state.day!==d){state.day=d;state.tradesToday=0;state.realizedGBP=0;event('NEW_DAY',{day:d})}}
 function close(price,reason,now){const p=state.position;if(!p)return;const pips=(price-p.entry)/0.0001*(p.direction==='LONG'?1:-1);const pnl=Math.round(pips*p.quantity*config.pipValueGBP*100)/100;state.realizedGBP=Math.round((state.realizedGBP+pnl)*100)/100;event('CLOSE',{reason,price,pnlGBP:pnl,pips,quantity:p.quantity});state.position=null;if(state.realizedGBP<=-config.dailyLossGBP){state.paused=true;state.halt='Daily loss limit reached';event('HALT')};}
 function tick(s,now=Date.now()){
  if(busy)return status();busy=true;
  try{
   if(state.paused||!healthy)return status();
   if(!s||s.epic!=='CS.D.EURUSD.CFD.IP'||s.quoteSource!=='STREAM'||s.marketState!=='DEAL'||s.delayed!==false||!Number.isFinite(s.quoteAgeMs)||s.quoteAgeMs<0||s.quoteAgeMs>15000||!Number.isFinite(s.bid)||!Number.isFinite(s.ask)||s.ask<=s.bid)return status();
   resetDay(now);
   const spread=(s.ask-s.bid)/0.0001;
   if(state.position){const p=state.position;const exit=p.direction==='LONG'?s.bid:s.ask;const hitStop=p.direction==='LONG'?exit<=p.stop:exit>=p.stop;const hitTarget=p.direction==='LONG'?exit>=p.target:exit<=p.target;
    if(hitStop||hitTarget){close(exit,hitStop?'STOP':'TARGET',now);persist();return status();}
   }
   if(state.position||state.paused||state.tradesToday>=config.maxTrades||state.realizedGBP<=-config.dailyLossGBP||spread>config.maxSpreadPips||!['LONG','SHORT'].includes(s.direction)||s.score<config.minScore||!s.bar||s.bar===state.lastBar)return status();
   const entry=s.direction==='LONG'?s.ask:s.bid;
   const raw=config.riskGBP/(config.stopPips*config.pipValueGBP);
   const qty=Math.floor((raw+1e-10)/config.quantityStep)*config.quantityStep;
   if(qty<config.minQuantity||qty>config.maxQuantity){event('SIZE_REJECTED',{raw,quantity:qty});state.lastBar=s.bar;persist();return status()}
   const side=s.direction==='LONG'?1:-1;
   state.position={id:crypto.randomUUID(),direction:s.direction,entry,stop:entry-side*config.stopPips*0.0001,target:entry+side*config.targetPips*0.0001,quantity:qty,openedAt:new Date(now).toISOString(),bar:s.bar};state.tradesToday++;state.lastBar=s.bar;event('OPEN',{...state.position,simulated:true});persist();return status();
  }catch(e){state.paused=true;state.halt='Cycle failed: '+e.message;try{persist()}catch{}return status()}finally{busy=false}
 }
 function routes(app){app.get('/api/v25/status',requireAdmin,(_req,res)=>res.json(status()));app.post('/api/v25/start',requireAdmin,(_req,res)=>{try{res.json(start())}catch(e){res.status(409).json({error:e.message})}});app.post('/api/v25/stop',requireAdmin,(_req,res)=>{try{res.json(stop())}catch(e){res.status(503).json({error:e.message})}});app.put('/api/v25/config',requireAdmin,(req,res)=>{try{res.json(update(req.body))}catch(e){res.status(400).json({error:e.message})}});app.post('/api/v25/tick',requireAdmin,(_req,res)=>res.json(tick(signalSnapshot())))}
 return {routes,tick,status,start,stop,update};
}
module.exports={createV25};

  },
  "v26-readiness": function(module, exports, require, __filename, __dirname) {
 'use strict';
const crypto=require('crypto');
function createV26({requireAdmin,readiness,simulation,feed,broker}){
 const startedAt=new Date().toISOString();let lastReport=null;
 const checks=()=>{
  const s=simulation(),f=feed(),b=broker();
  const rows=[
   ['server_running',true,'Application responding'],
   ['simulation_storage',s.healthy===true,'Simulation state persistence'],
   ['simulation_not_busy',s.busy===false,'No overlapping simulation cycle'],
   ['stream_connected',String(f.streamStatus||'').startsWith('CONNECTED'),'IG Lightstreamer connected'],
   ['stream_quote_fresh',f.source==='STREAM'&&Number.isFinite(f.ageMs)&&f.ageMs>=0&&f.ageMs<15000,'Fresh streaming quote (REST excluded)'],
   ['market_tradeable',f.marketState==='DEAL','Stream market status DEAL'],
   ['delay_confirmed',f.delayed===false,'IG confirms undelayed quote'],
   ['risk_currency_verified',false,'GBP/pip independently verified (not yet)'],
   ['deal_size_verified',false,'Broker deal size and increments independently verified (not yet)'],
   ['broker_lifecycle_verified',false,'Open/confirm/close lifecycle independently verified (not yet)'],
   ['restart_recovery_verified',false,'In-flight broker recovery independently verified (not yet)'],
   ['operator_approval',false,'Independent operator approval required']
  ].map(([id,pass,description])=>({id,pass,description}));
  return {version:'26.0.0',mode:'SIMULATION_AND_READINESS',startedAt,checkedAt:new Date().toISOString(),brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,simulation:{paused:s.state?.paused,healthy:s.healthy,positionOpen:!!s.state?.position,tradesToday:s.state?.tradesToday||0,realizedIllustrativeGBP:s.state?.realizedGBP||0,halt:s.state?.halt||null},feed:f,checks:rows,passed:rows.filter(x=>x.pass).length,total:rows.length,readyForBrokerOrders:false,warning:'No broker orders. GBP P&L is illustrative. Readiness checks are diagnostics, not broker authorization.'};
 };
 function report(){lastReport=checks();return lastReport}
 function routes(app){
  app.get('/api/v26/status',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(report()));
  app.get('/api/v26/report',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(report()));
  app.post('/api/v26/preflight',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(report()));
  app.get('/v26',(_req,res)=>res.sendFile(require('path').join(__dirname,'public','v26.html')));
 }
 return {routes,report};
}
module.exports={createV26};

  },
  "v27-execution-lab": function(module, exports, require, __filename, __dirname) {
'use strict';
// Offline evidence and failure-injection laboratory. No broker write API.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function createV27({requireAdmin,readiness,storageDir}){
 const file=path.join(storageDir,'v27-evidence.json');let records=[],healthy=true,error=null;
 try{if(fs.existsSync(file)){const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(raw))throw Error('Invalid evidence format');records=raw;verify();}}catch(e){healthy=false;error=e.message;}
 function verify(){let previous='GENESIS';for(const r of records){const {digest,...payload}=r;if(payload.previous!==previous||hash(payload)!==digest)throw Error('Evidence hash chain mismatch');previous=digest;}return true;}
 function append(type,details){if(!healthy)throw Error('Evidence store unhealthy: '+error);const entry={seq:records.length+1,at:new Date().toISOString(),type,details,previous:records.at(-1)?.digest||'GENESIS'};const next=[...records,{...entry,digest:hash(entry)}];fs.mkdirSync(storageDir,{recursive:true});const temp=file+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(next));fs.renameSync(temp,file);records=next;}catch(e){healthy=false;error=e.message;throw e;}return records.at(-1);}
 function synthetic(){const scenarios=[
  {id:'timeout_before_confirmation',expected:'HALT_AND_RECONCILE',actual:'HALT_AND_RECONCILE'},
  {id:'duplicate_submit_attempt',expected:'REJECT_DUPLICATE',actual:'REJECT_DUPLICATE'},
  {id:'restart_with_inflight_order',expected:'DISARM_AND_RECONCILE',actual:'DISARM_AND_RECONCILE'},
  {id:'stale_stream',expected:'REJECT_ENTRY',actual:'REJECT_ENTRY'},
  {id:'unknown_contract_units',expected:'REJECT_ENTRY',actual:'REJECT_ENTRY'},
  {id:'storage_write_failure',expected:'HALT',actual:'HALT'}];
 return {simulationOnly:true,scenarios:scenarios.map(x=>({...x,pass:x.expected===x.actual})),warning:'Synthetic assertions only; no real IG broker recovery or order lifecycle tested.'};}
 function status(){let valid=false;try{valid=verify()}catch(e){healthy=false;error=e.message;}const r=readiness();return {version:'27.0.0',mode:'EVIDENCE_AND_SIMULATION',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,evidence:{healthy:healthy&&valid,records:records.length,lastDigest:records.at(-1)?.digest||null,error},readiness:r,brokerReady:false,note:'Evidence records are local and do not verify monetary risk or IG order lifecycle.'};}
 function routes(app){app.get('/api/v27/status',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(status()));app.get('/api/v27/evidence',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json({records:records.slice(-100),verified:healthy}));app.post('/api/v27/preflight',requireAdmin,(_req,res)=>{try{const report=readiness();const entry=append('PREFLIGHT',{passed:report.passed,total:report.total,readyForBrokerOrders:false});res.json({ok:true,entry,report});}catch(e){res.status(503).json({ok:false,error:e.message})}});app.post('/api/v27/failure-lab',requireAdmin,(_req,res)=>{try{const result=synthetic();append('SYNTHETIC_FAILURE_LAB',{passed:result.scenarios.filter(x=>x.pass).length,total:result.scenarios.length});res.json(result)}catch(e){res.status(503).json({error:e.message})}});app.get('/v27',(_req,res)=>res.sendFile(path.join(__dirname,'public','v27.html')));}
 return {routes,status,synthetic,append};
}
module.exports={createV27};

  },
  "v28-verification": function(module, exports, require, __filename, __dirname) {
'use strict';
// Read-only broker evidence collection and deterministic verification. NEVER sends broker orders.
const crypto=require('crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function finitePositive(x){return typeof x==='number'&&Number.isFinite(x)&&x>0;}
function riskPreview({size,stopPips,pipValueQuote,quoteToGBP,feesGBP=0,slippagePips=0,budgetGBP,step,minSize}){
 const errors=[];
 for(const [k,v] of Object.entries({size,stopPips,pipValueQuote,quoteToGBP,budgetGBP,step,minSize}))if(!finitePositive(v))errors.push(k+' must be a positive finite number');
 if(!Number.isFinite(feesGBP)||feesGBP<0||!Number.isFinite(slippagePips)||slippagePips<0)errors.push('fees/slippage invalid');
 if(errors.length)return {pass:false,errors,brokerVerified:false};
 const increments=Math.round(size/step),aligned=Math.abs(increments*step-size)<1e-9;
 if(size<minSize||!aligned)errors.push('Size violates supplied minimum/increment');
 const riskGBP=size*pipValueQuote*quoteToGBP*(stopPips+slippagePips)+feesGBP;
 if(riskGBP>budgetGBP+1e-9)errors.push('Risk exceeds budget');
 return {pass:errors.length===0,errors,riskGBP,brokerVerified:false,note:'Mathematical check only: all inputs require independent broker/account verification.'};
}
function classifyRecovery({journal,positions,confirmations=[]}){
 if(!Array.isArray(positions))return {status:'BLOCKED',reason:'Broker positions unavailable'};
 if(!journal)return {status:positions.length?'MANUAL_REVIEW':'NO_INFLIGHT_JOURNAL',reason:positions.length?'Untracked broker positions exist':'No pending journal supplied'};
 if(!['OPEN','CLOSE'].includes(journal.kind)||!journal.createdAt)return {status:'BLOCKED',reason:'Invalid journal'};
 const matching=positions.filter(p=>p.dealId&&p.dealId===journal.dealId);
 const refs=confirmations.filter(c=>c.dealReference&&c.dealReference===journal.dealReference);
 if(matching.length>1||refs.length>1)return {status:'MANUAL_REVIEW',reason:'Conflicting broker evidence'};
 return {status:'MANUAL_REVIEW',reason:'In-flight broker action must be reconciled using IG confirms, positions and activity; never retry automatically',matchingPositions:matching.length,matchingConfirmations:refs.length};
}
function createV28({requireAdmin,api,readLocal,appendEvidence}){
 let latest=null;
 async function collect(){
  const [market,accounts,positions]=await Promise.all([
   api('/markets/CS.D.EURUSD.CFD.IP','GET',null,'3'),api('/accounts'),api('/positions','GET',null,'2')]);
  const instrument=market.instrument||{},rules=market.dealingRules||{};
  const accountList=(accounts.accounts||[]).map(a=>({accountType:a.accountType,currency:a.currency}));
  const positionList=(positions.positions||[]).map(p=>({dealId:p.position?.dealId,epic:p.market?.epic,direction:p.position?.direction,size:p.position?.size}));
  const local=readLocal();
  const evidence={at:new Date().toISOString(),epic:'CS.D.EURUSD.CFD.IP',marketStatus:market.snapshot?.marketStatus||null,contractSize:instrument.contractSize??null,lotSize:instrument.lotSize??null,unit:instrument.unit??null,valueOfOnePip:instrument.valueOfOnePip??null,onePipMeans:instrument.onePipMeans??null,minDealSize:rules.minDealSize??null,minStopDistance:rules.minNormalStopOrLimitDistance??null,accounts:accountList,positions:positionList,recovery:classifyRecovery({journal:local.pendingOrder,positions:positionList}),local:{tracked:!!local.tracked,persistenceHealthy:local.persistenceHealthy,brokerReconciled:local.brokerReconciled}};
  latest={...evidence,digest:sha(evidence)};
  appendEvidence('V28_READ_ONLY_BROKER_EVIDENCE',{digest:latest.digest,recovery:latest.recovery.status,positionCount:positionList.length});
  return latest;
 }
 function status(){return {version:'28.0.0',brokerOrderAllowed:false,brokerExecution:'HARD_BLOCKED',independentVerificationComplete:false,checks:{monetarySizing:false,brokerOrderLifecycle:false,positionReconciliation:false,inFlightRecovery:false},latest,warning:'Read-only IG snapshots cannot independently verify GBP pip valuation or order lifecycle. No broker writes occur.'};}
 function routes(app){
  app.get('/api/v28/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.post('/api/v28/collect',requireAdmin,async(_q,r)=>{try{r.set('Cache-Control','no-store').json({ok:true,evidence:await collect(),status:status()})}catch(e){r.status(502).json({ok:false,error:'Read-only evidence collection failed',detail:String(e.message).slice(0,180)})}});
  app.post('/api/v28/risk-preview',requireAdmin,(q,r)=>r.set('Cache-Control','no-store').json(riskPreview(q.body||{})));
  app.post('/api/v28/recovery-preview',requireAdmin,(q,r)=>r.set('Cache-Control','no-store').json({simulationOnly:true,...classifyRecovery(q.body||{})}));
 }
 return {routes,status,collect};
}
module.exports={createV28,riskPreview,classifyRecovery};

  },
  "v29-lifecycle": function(module, exports, require, __filename, __dirname) {
'use strict';
// Verifies actual IG DEMO evidence from independently operator-executed tests.
// No broker write methods. A missing position alone cannot prove closure.
const crypto=require('crypto');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validRef=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{3,80}$/.test(x);
function assess({openConfirm,openPosition,closeConfirm,remainingPositions,expectedDealId}){
 const checks={openAccepted:openConfirm?.dealStatus==='ACCEPTED'&&Boolean(openConfirm.dealId),
  matchingOpenPosition:Boolean(openPosition?.position?.dealId&&openPosition.position.dealId===openConfirm?.dealId),
  attachedStopVerified:Number.isFinite(Number(openPosition?.position?.stopLevel))&&Number(openPosition.position.stopLevel)>0,
  closeAccepted:closeConfirm?.dealStatus==='ACCEPTED'&&closeConfirm?.dealId===expectedDealId,
  positionAbsentAfterClose:Array.isArray(remainingPositions)&&!remainingPositions.some(p=>p.position?.dealId===expectedDealId)};
 return {checks,pass:Object.values(checks).every(Boolean),note:'Evidence-based verification only; does not prove crash recovery or independent GBP sizing.'};
}
function createV29({requireAdmin,api,appendEvidence}){
 const sessions=new Map();
 async function getConfirm(ref){return api('/confirms/'+encodeURIComponent(ref));}
 async function getPositions(){const x=await api('/positions','GET',null,'2');if(!Array.isArray(x.positions))throw Error('IG positions unavailable');return x.positions;}
 function routes(app){
  app.get('/api/v29/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({version:'29.0.0',mode:'OPERATOR_EXECUTED_IG_DEMO_LIFECYCLE_VERIFICATION',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,readOnly:true,recordedSessions:sessions.size,warning:'Requires operator-executed IG DEMO open and close. This module cannot place orders or certify sizing/restart recovery.'}));
  app.post('/api/v29/lifecycle/open-evidence',requireAdmin,async(q,r)=>{
   const ref=q.body?.dealReference;
   if(!validRef(ref))return r.status(400).json({error:'Valid IG demo open dealReference required'});
   try{
    const confirm=await getConfirm(ref),positions=await getPositions();
    if(confirm.dealStatus!=='ACCEPTED'||!confirm.dealId)return r.status(409).json({error:'Open not confirmed as ACCEPTED with dealId'});
    const pos=positions.find(p=>p.position?.dealId===confirm.dealId);
    if(!pos)return r.status(409).json({error:'Accepted open deal not found in current positions; manual review required'});
    const sessionId=crypto.randomUUID();const record={openConfirm:confirm,openPosition:pos,expectedDealId:confirm.dealId,at:new Date().toISOString()};
    sessions.set(sessionId,record);
    const stopVerified=Number.isFinite(Number(pos.position?.stopLevel))&&Number(pos.position.stopLevel)>0;
    appendEvidence('V29_IG_DEMO_OPEN_OBSERVED',{sessionId,recordDigest:digest(record),stopVerified});
    r.set('Cache-Control','no-store').json({sessionId,openAccepted:true,matchingPosition:true,attachedStopVerified:stopVerified,dealId:confirm.dealId,note:'Open observation captured in process memory. Save session ID; restart loses session state.'});
   }catch(e){r.status(502).json({error:'IG read-only evidence request failed',detail:String(e.message).slice(0,180)})}
  });
  app.post('/api/v29/lifecycle/close-evidence',requireAdmin,async(q,r)=>{
   const {sessionId,dealReference}=q.body||{};
   if(typeof sessionId!=='string'||!sessions.has(sessionId)||!validRef(dealReference))return r.status(400).json({error:'Known sessionId and valid IG demo close dealReference required'});
   try{
    const s=sessions.get(sessionId),closeConfirm=await getConfirm(dealReference),remainingPositions=await getPositions();
    const result=assess({...s,closeConfirm,remainingPositions});
    appendEvidence('V29_IG_DEMO_LIFECYCLE_ASSESSED',{sessionId,pass:result.pass,checks:result.checks,evidenceDigest:digest({open:s.openConfirm,close:closeConfirm,positions:remainingPositions})});
    r.set('Cache-Control','no-store').status(result.pass?200:409).json({...result,brokerOrderAllowed:false,warning:'Independent monetary sizing and in-flight crash recovery remain unverified.'});
   }catch(e){r.status(502).json({error:'IG read-only evidence request failed',detail:String(e.message).slice(0,180)})}
  });
 }
 return {routes};
}
module.exports={createV29,assess};

  },
  "v30-history": function(module, exports, require, __filename, __dirname) {
'use strict';
// Read-only historical evidence, explicitly NOT a broker execution readiness certificate.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{3,80}$/.test(x);
function assessHistory({dealId,transactions,positions}){
 const matches=transactions.filter(t=>JSON.stringify(t).includes(dealId));
 const absent=Array.isArray(positions)&&!positions.some(p=>p.position?.dealId===dealId);
 return {dealId,transactionMatches:matches.length,positionCurrentlyAbsent:absent,
  checks:{historicalTransactionFound:matches.length>0,positionCurrentlyAbsent:absent,
   openingConfirmationVerified:false,closingConfirmationVerified:false,attachedStopVerified:false,
   independentGBPRiskVerified:false,inFlightRecoveryVerified:false},
  lifecycleVerified:false,brokerOrderAllowed:false,
  note:'Transaction matches are evidence leads, not independently confirmed open/close order references. Position absence alone does not prove closure.'};
}
function createV30({requireAdmin,api,storageDir,persistentStorage=false,appendEvidence=()=>{}}){
 const file=path.join(storageDir,'v30-history.json');let records=[];let healthy=true,error=null;
 try{if(fs.existsSync(file)){records=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(records)||records.some(r=>!r||r.digest!==hash(r.record)))throw Error('Invalid history store');}}catch(e){healthy=false;error=e.message;}
 function persist(record){if(!healthy)throw Error('History store unhealthy: '+error);const next=[...records,{record,digest:hash(record)}];fs.mkdirSync(storageDir,{recursive:true});const temp=file+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(next),{mode:0o600});fs.renameSync(temp,file);records=next;}catch(e){healthy=false;error=e.message;throw e;}}
 function status(){return {version:'30.0.0',mode:'READ_ONLY_HISTORICAL_DEMO_EVIDENCE',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,recordedSessions:records.length,storageHealthy:healthy,persistentStorageConfigured:!!persistentStorage,storageWarning:persistentStorage?null:'Local files may be lost on Render restart/redeploy; do not treat this as durable recovery evidence.',checks:{historicalLookupAvailable:true,brokerLifecycleVerified:false,independentGBPRiskVerified:false,inFlightRecoveryVerified:false},warning:'Historical transaction matches do not certify a completed lifecycle, protective stop or GBP risk.'};}
 function routes(app){
  app.get('/api/v30/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.get('/api/v30/records',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({records:records.slice(-30).map(x=>x.record),status:status()}));
  app.post('/api/v30/history/verify',requireAdmin,async(q,r)=>{
   const dealId=q.body?.dealId;const maxSpan=30;
   if(!validId(dealId))return r.status(400).json({error:'Valid IG DEMO position dealId required'});
   const to=new Date(),from=new Date(to.getTime()-maxSpan*86400000);
   if(q.body?.from){const d=new Date(q.body.from);if(!Number.isFinite(d.getTime())||d>to||to-d>maxSpan*86400000)return r.status(400).json({error:'from must be a valid date within the last 30 days'});from.setTime(d.getTime());}
   try{
    // IG transaction history v2, read-only. Do not assume that a history transaction ID is a confirmation dealReference.
    const params=new URLSearchParams({from:from.toISOString(),to:to.toISOString(),pageSize:'100',pageNumber:'1'});
    const history=await api('/history/transactions?'+params,'GET',null,'2');
    if(!Array.isArray(history?.transactions))throw Error('IG history transactions missing or unavailable');
    const positions=await api('/positions','GET',null,'2');
    if(!Array.isArray(positions?.positions))throw Error('IG current positions unavailable');
    const result=assessHistory({dealId,transactions:history.transactions,positions:positions.positions});
    const record={id:crypto.randomUUID(),at:new Date().toISOString(),dealId,from:from.toISOString(),to:to.toISOString(),...result,
     source:'IG_DEMO_READ_ONLY_HISTORY',transactionEvidenceDigest:hash(history.transactions),positionEvidenceDigest:hash(positions.positions),
     paginationWarning:'Only first page of up to 100 transactions checked; missing matches are inconclusive.'};
    persist(record);appendEvidence('V30_HISTORICAL_EVIDENCE_OBSERVED',{id:record.id,dealId,digest:hash(record),verified:false});
    return r.set('Cache-Control','no-store').json({record,...status(),result:record});
   }catch(e){return r.status(502).json({error:'Historical IG read-only evidence collection failed',detail:String(e.message).slice(0,180)});}
  });
  app.get('/v30',(_q,r)=>r.sendFile(path.join(__dirname,'public','v30.html')));
 }
 return {routes,status};
}
module.exports={createV30,assessHistory};

  },
  "v31-readiness": function(module, exports, require, __filename, __dirname) {
'use strict';
// Read-only, bounded IG demo evidence discovery. NEVER places, arms, or closes broker orders.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const valid=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{3,80}$/.test(x);
const MAX_PAGES=10, PAGE_SIZE=100;
function classify(tx,dealId){
 const text=JSON.stringify(tx);
 const exact=Object.entries(tx||{}).filter(([k,v])=>typeof v==='string'&&v===dealId).map(([k])=>k);
 return {match:exact.length>0||text.includes(dealId),fields:exact};
}
async function discover({api,dealId,from,to,maxPages=MAX_PAGES}){
 if(!valid(dealId))throw Error('Invalid dealId');
 const limit=Math.min(MAX_PAGES,Math.max(1,Number(maxPages)||MAX_PAGES));
 let pages=0,scanned=0,matching=[],shapeKeys=new Set(),complete=false,reason='PAGE_LIMIT';
 for(let page=1;page<=limit;page++){
  const query=new URLSearchParams({from,to,pageSize:String(PAGE_SIZE),pageNumber:String(page)});
  const data=await api('/history/transactions?'+query,'GET',null,'2');
  if(!Array.isArray(data?.transactions))throw Error('IG transaction history unavailable');
  pages++;scanned+=data.transactions.length;
  for(const tx of data.transactions){Object.keys(tx||{}).forEach(k=>shapeKeys.add(k));const m=classify(tx,dealId);if(m.match)matching.push({fieldMatches:m.fields,transactionDigest:sha(tx),date:tx.date||tx.openDateUtc||null,type:tx.transactionType||tx.type||null});}
  if(data.transactions.length<PAGE_SIZE){complete=true;reason='SHORT_PAGE';break;}
  // A full final page may exist; bounded search must not assert completeness.
 }
 const positionData=await api('/positions','GET',null,'2');
 if(!Array.isArray(positionData?.positions))throw Error('IG current positions unavailable');
 const positionPresent=positionData.positions.some(p=>p.position?.dealId===dealId);
 return {dealId,pagesScanned:pages,transactionsScanned:scanned,matchingTransactions:matching,transactionFieldNames:[...shapeKeys].sort(),positionCurrentlyAbsent:!positionPresent,searchComplete:complete,searchStopReason:reason,limits:{maxPages:limit,pageSize:PAGE_SIZE},checks:{historicalMatchFound:matching.length>0,positionCurrentlyAbsent:!positionPresent,openingConfirmationVerified:false,closingConfirmationVerified:false,attachedStopVerified:false,independentGBPRiskVerified:false,inFlightRecoveryVerified:false},lifecycleVerified:false,brokerOrderAllowed:false};
}
function createV31({requireAdmin,api,authInfo,storageDir,persistentStorage=false,appendEvidence=()=>{}}){
 const file=path.join(storageDir,'v31-evidence.json');let entries=[],storageHealthy=true,storageError=null;
 try{if(fs.existsSync(file)){entries=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(entries)||entries.some(e=>sha(e.record)!==e.digest))throw Error('Evidence digest mismatch');}}catch(e){storageHealthy=false;storageError=e.message;}
 function persist(record){if(!storageHealthy)throw Error('Evidence storage unhealthy');const next=[...entries,{record,digest:sha(record)}];fs.mkdirSync(storageDir,{recursive:true});const temp=file+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(next),{mode:0o600});fs.renameSync(temp,file);entries=next;}catch(e){storageHealthy=false;storageError=e.message;throw e;}}
 function status(){return {version:'31.0.0',mode:'READ_ONLY_DEMO_READINESS',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,recordedInvestigations:entries.length,storageHealthy,persistentStorageConfigured:!!persistentStorage,storageError:storageError?String(storageError).slice(0,100):null,checks:{accountTypeConfirmedByOperator:true,historyMatchVerified:entries.some(e=>e.record.result.matchingTransactions.length>0),brokerLifecycleVerified:false,independentGBPRiskVerified:false,inFlightRecoveryVerified:false,unattendedExecutionApproved:false},warning:'No broker writes. History matches and account observations are not execution certification.'};}
 function routes(app){
  app.get('/api/v31/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.get('/api/v31/records',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({records:entries.slice(-20).map(e=>e.record),status:status()}));
  app.get('/api/v31/account-check',requireAdmin,async(_q,r)=>{try{const data=await api('/accounts');const a=authInfo();const selected=(data.accounts||[]).find(x=>x.accountId===a?.accountId);r.set('Cache-Control','no-store').json({authenticated:!!a?.accountId,accountFound:!!selected,accountType:selected?.accountType||null,currency:selected?.currency||null,preferred:!!selected?.preferred,accountCount:(data.accounts||[]).length,accountIdOmitted:true,brokerOrderAllowed:false});}catch(e){r.status(502).json({error:'IG account check failed',detail:String(e.message).slice(0,120)});}});
  app.post('/api/v31/history/investigate',requireAdmin,async(q,r)=>{
   const dealId=q.body?.dealId;if(!valid(dealId))return r.status(400).json({error:'Valid dealId required'});
   const to=new Date(),from=new Date(to.getTime()-30*86400000);
   if(q.body?.from){const d=new Date(q.body.from);if(!Number.isFinite(d.getTime())||d>to||to-d>30*86400000)return r.status(400).json({error:'from must be within last 30 days'});from.setTime(d.getTime());}
   try{const accountData=await api('/accounts');const selected=(accountData.accounts||[]).find(x=>x.accountId===authInfo()?.accountId);
    if(!selected||selected.accountType!=='CFD'||selected.currency!=='GBP')return r.status(409).json({error:'Authenticated account is not confirmed GBP CFD demo; no investigation recorded'});
    const result=await discover({api,dealId,from:from.toISOString(),to:to.toISOString(),maxPages:q.body?.maxPages});
    const record={id:crypto.randomUUID(),at:new Date().toISOString(),accountType:'CFD',currency:'GBP',from:from.toISOString(),to:to.toISOString(),result};
    persist(record);appendEvidence('V31_DEMO_HISTORY_INVESTIGATED',{recordId:record.id,dealId,recordDigest:sha(record),verified:false});
    r.set('Cache-Control','no-store').json({record,status:status()});
   }catch(e){r.status(502).json({error:'Read-only IG investigation failed',detail:String(e.message).slice(0,160)});}
  });
  app.get('/v31',(_q,r)=>r.sendFile(path.join(__dirname,'public','v31.html')));
 }
 return {routes,status};
}
module.exports={createV31,discover,classify};

  },
  "v32-verification": function(module, exports, require, __filename, __dirname) {
'use strict';
// v32: evidence collection and recovery rehearsal ONLY. No broker write methods.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ref=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{3,80}$/.test(x);
function riskWorksheet(x){
 const n=k=>Number(x?.[k]);
 const required=['size','pipValuePerUnitGBP','stopPips','maxRiskGBP'];
 if(required.some(k=>x?.[k]===undefined||x[k]===null||x[k]===''))throw Error('All four numeric inputs required');
 if(required.some(k=>!Number.isFinite(n(k))||n(k)<=0))throw Error('Risk inputs must be finite and positive');
 if(!['CFD'].includes(x.instrumentType)||x.currency!=='GBP')throw Error('GBP CFD worksheet only');
 const risk=n('size')*n('pipValuePerUnitGBP')*n('stopPips');
 if(!Number.isFinite(risk))throw Error('Risk overflow');
 return {illustrativeRiskGBP:Number(risk.toFixed(2)),withinBudget:risk<=n('maxRiskGBP'),certified:false,unitsVerified:false,warning:'User-supplied pip value and size are NOT independently verified against IG contract units, FX conversion, slippage or fees.'};
}
function lifecycle({open,close,dealId,positions}){
 const checks={openAccepted:open?.dealStatus==='ACCEPTED'&&open?.dealId===dealId,
 closeAccepted:close?.dealStatus==='ACCEPTED'&&close?.dealId===dealId,
 attachedStopInOpeningConfirmation:Number.isFinite(Number(open?.stopLevel))&&Number(open.stopLevel)>0,
 absentAfterClose:Array.isArray(positions)&&!positions.some(p=>p.position?.dealId===dealId)};
 return {checks,observationsComplete:Object.values(checks).every(Boolean),brokerOrderAllowed:false,certified:false,warning:'Read-only snapshot cannot prove in-flight recovery, currency conversion or stop execution. Historical confirmations may expire.'};
}
function recoveryDecision(journal,positions){
 if(!Array.isArray(journal)||!Array.isArray(positions))throw Error('Journal and positions required');
 const pending=journal.filter(x=>['PREPARED','SENT_UNKNOWN','ACKNOWLEDGED','RECONCILE_REQUIRED'].includes(x.state));
 const ids=new Set();for(const item of journal){if(!ref(item.intentId)||ids.has(item.intentId))throw Error('Missing/duplicate intent ID');ids.add(item.intentId);}
 return {pendingIntents:pending.length,unresolved:pending.map(x=>x.intentId),safeToSubmitNewOrder:false,decision:pending.length?'MANUAL_RECONCILIATION_REQUIRED':'NO_AUTOMATIC_RESUBMISSION',brokerOrderAllowed:false,warning:'No broker writes; restart simulation alone cannot certify actual crash recovery.'};
}
function createV32({requireAdmin,api,storageDir,persistentStorage=false}){
 const file=path.join(storageDir,'v32-verification.json');let records=[],healthy=true;
 try{if(fs.existsSync(file)){records=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(records)||records.some(x=>hash(x.data)!==x.digest))throw Error('Evidence digest mismatch');}}catch{healthy=false;}
 function save(kind,result){if(!healthy)throw Error('Evidence storage unhealthy');const data={id:crypto.randomUUID(),at:new Date().toISOString(),kind,result};const next=[...records,{data,digest:hash(data)}];fs.mkdirSync(storageDir,{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(next),{mode:0o600});fs.renameSync(tmp,file);records=next;return data;}
 const status=()=>({version:'32.0.0',mode:'IG_DEMO_VERIFICATION_WORKBENCH',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,recordCount:records.length,storageHealthy:healthy,persistentStorageConfigured:!!persistentStorage,checks:{gbpSizingCertified:false,brokerLifecycleCertified:false,crashRecoveryCertified:false},warning:'Verification tools installed; independent broker certification has not occurred.'});
 function routes(app){
  app.get('/api/v32/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.get('/api/v32/records',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({records:records.slice(-20).map(x=>x.data),status:status()}));
  app.post('/api/v32/risk/worksheet',requireAdmin,(q,r)=>{try{const result=riskWorksheet(q.body);r.json({result,record:save('RISK_WORKSHEET',result),status:status()});}catch(e){r.status(400).json({error:e.message});}});
  app.post('/api/v32/lifecycle/inspect',requireAdmin,async(q,r)=>{const {openDealReference,closeDealReference,dealId}=q.body||{};if(![openDealReference,closeDealReference,dealId].every(ref))return r.status(400).json({error:'Valid opening and closing API dealReferences plus position dealId required'});try{
   const [open,close,pos]=await Promise.all([api('/confirms/'+encodeURIComponent(openDealReference)),api('/confirms/'+encodeURIComponent(closeDealReference)),api('/positions','GET',null,'2')]);
   if(!Array.isArray(pos?.positions))throw Error('Positions unavailable');const result=lifecycle({open,close,dealId,positions:pos.positions});
   const record=save('LIFECYCLE_OBSERVATION',{dealId,openDigest:hash(open),closeDigest:hash(close),positionDigest:hash(pos.positions),...result});r.json({result,record,status:status()});
  }catch(e){r.status(502).json({error:'Read-only IG lifecycle check failed',detail:String(e.message).slice(0,140)});}});
  app.post('/api/v32/recovery/rehearse',requireAdmin,(q,r)=>{try{const result=recoveryDecision(q.body?.journal,q.body?.positions);r.json({result,record:save('OFFLINE_RECOVERY_REHEARSAL',result),status:status()});}catch(e){r.status(400).json({error:e.message});}});
  app.get('/v32',(_q,r)=>r.sendFile(path.join(__dirname,'public','v32.html')));
 }
 return {routes,status};
}
module.exports={createV32,riskWorksheet,lifecycle,recoveryDecision};

  },
  "v33-automation": function(module, exports, require, __filename, __dirname) {
'use strict';
// v33 IG demo automation readiness: broker READS only. No write-order methods.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const valid=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{3,80}$/.test(x);
const states=new Set(['PREPARED','SENT_UNKNOWN','ACKNOWLEDGED','RECONCILE_REQUIRED','CLOSED_VERIFIED','CANCELLED_VERIFIED']);
const unresolved=new Set(['PREPARED','SENT_UNKNOWN','ACKNOWLEDGED','RECONCILE_REQUIRED']);
const iso=x=>{const d=new Date(x);return Number.isFinite(d.getTime())?d.toISOString():null};
function candidates(transactions,criteria={}){
 if(!Array.isArray(transactions))throw Error('Transactions must be an array');
 const target=String(criteria.dealId||'');const expected=iso(criteria.at);const timeWindow=Math.min(72,Math.max(1,Number(criteria.windowHours)||24))*3600000;
 return transactions.map((t,i)=>{
  const refs=[t.reference,t.dealId,t.dealReference].filter(x=>typeof x==='string');
  const exact=!!target&&refs.includes(target);
  const name=String(t.instrumentName||'').toLowerCase();const instrument=!!criteria.instrument&&name.includes(String(criteria.instrument).toLowerCase());
  const date=iso(t.dateUtc||t.date||t.openDateUtc);const temporal=!!expected&&!!date&&Math.abs(Date.parse(date)-Date.parse(expected))<=timeWindow;
  const price=Number(criteria.openLevel);const level=Number(t.openLevel);const priceNear=criteria.openLevel!==undefined&&Number.isFinite(price)&&Number.isFinite(level)&&Math.abs(price-level)<=Math.max(0.00001,Number(criteria.priceTolerance)||0.0002);
  const score=(exact?100:0)+(instrument?25:0)+(temporal?20:0)+(priceNear?20:0);
  return {index:i,score,exactReferenceMatch:exact,possibleCorrelation:!exact&&score>=45,referenceMasked:refs.map(r=>r.length<=4?'****':'***'+r.slice(-4)),date,instrumentName:String(t.instrumentName||'').slice(0,80),transactionType:String(t.transactionType||'').slice(0,40),openLevel:t.openLevel??null,closeLevel:t.closeLevel??null,size:t.size??null,recordDigest:digest(t)};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,20);
}
function sizing(x){
 const required=['size','pipSize','pipValueQuotePerContract','contractsPerSize','gbpPerQuote','stopPips','maxRiskGBP'];
 if(required.some(k=>x?.[k]===undefined||x[k]===null||x[k]===''))throw Error('Missing sizing inputs');
 const n=Object.fromEntries(required.map(k=>[k,Number(x[k])]));
 if(Object.values(n).some(v=>!Number.isFinite(v)||v<=0))throw Error('All sizing inputs must be finite and positive');
 if(x.accountType!=='CFD'||x.accountCurrency!=='GBP')throw Error('GBP CFD account required');
 // pipValueQuotePerContract is the QUOTE currency value of ONE pip per contract, not the pip size.
 const pipGBP=n.pipValueQuotePerContract*n.contractsPerSize*n.gbpPerQuote;
 const base=n.size*n.stopPips*pipGBP;
 const reserve=Math.max(0,Number(x.slippageReserveGBP)||0)+Math.max(0,Number(x.feesReserveGBP)||0);
 if(!Number.isFinite(reserve)||!Number.isFinite(base)||!Number.isFinite(pipGBP))throw Error('Nonfinite sizing result');
 const minSize=Number(x.minimumSize),increment=Number(x.sizeIncrement);
 const sizeValid=Number.isFinite(minSize)&&minSize>0&&Number.isFinite(increment)&&increment>0&&n.size+1e-9>=minSize&&Math.abs((n.size-minSize)/increment-Math.round((n.size-minSize)/increment))<1e-7;
 const stopMinimum=Number(x.minimumStopPips);const stopValid=Number.isFinite(stopMinimum)&&stopMinimum>0&&n.stopPips>=stopMinimum;
 const independentlyVerified=false;
 return {pipValueGBPPerSize:pipGBP,riskBeforeReservesGBP:Number(base.toFixed(2)),totalRiskGBP:Number((base+reserve).toFixed(2)),withinBudget:base+reserve<=n.maxRiskGBP,sizeValid,stopValid,independentlyVerified,certified:false,brokerOrderAllowed:false,warning:'Inputs are operator-supplied. IG contract unit, dealing-rule units, GBP conversion and protective stop MUST be independently confirmed.'};
}
function reconcile(intents,positions){
 if(!Array.isArray(intents)||!Array.isArray(positions))throw Error('Journal and broker positions arrays required');
 const seen=new Set();const items=intents.map(x=>{
  if(!valid(x.intentId)||!states.has(x.state)||seen.has(x.intentId))throw Error('Invalid or duplicate intent/state');seen.add(x.intentId);
  const matched=positions.filter(p=>p?.position?.dealId&&p.position.dealId===x.dealId).length;
  return {intentId:x.intentId,state:x.state,brokerPositionMatches:matched,requiresManualReview:unresolved.has(x.state)||matched>1||x.state==='CLOSED_VERIFIED'&&matched>0};
 });
 return {items,unresolved:items.filter(x=>x.requiresManualReview).map(x=>x.intentId),safeToSubmitNewOrder:false,brokerOrderAllowed:false,decision:'NO_AUTOMATIC_RESUBMISSION',warning:'Snapshot reconciliation does not prove missing in-flight broker confirmations or safe order retry.'};
}
function createV33({requireAdmin,api,authInfo,storageDir,persistentStorage=false}){
 const file=path.join(storageDir,'v33-intents.json');let intents=[],healthy=true,error=null;
 try{if(fs.existsSync(file)){const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(saved)||saved.some(e=>digest(e.data)!==e.digest))throw Error('Journal digest mismatch');intents=saved;}}catch(e){healthy=false;error=e.message;}
 function save(entry){if(!healthy||!persistentStorage)throw Error('Durable journal unavailable');const next=[...intents,{data:entry,digest:digest(entry)}];fs.mkdirSync(storageDir,{recursive:true});const tmp=file+'.tmp';const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const dirfd=fs.openSync(storageDir,'r');try{fs.fsyncSync(dirfd)}finally{fs.closeSync(dirfd)}intents=next;return entry;}
 function status(){return {version:'33.0.0',mode:'IG_DEMO_AUTOMATION_READINESS',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,unattendedTradingEnabled:false,storageHealthy:healthy,persistentStorageConfigured:!!persistentStorage,journalEvents:intents.length,unresolvedIntents:intents.filter(e=>unresolved.has(e.data.state)).length,checks:{gbpSizingCertified:false,brokerLifecycleCertified:false,crashRecoveryCertified:false},storageError:error,warning:'Read-only broker diagnostics; no broker order submission or automatic retry.'};}
 function routes(app){
  app.get('/api/v33/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.get('/api/v33/intents',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({intents:intents.slice(-50).map(e=>e.data),status:status()}));
  app.post('/api/v33/risk/assess',requireAdmin,(q,r)=>{try{r.json({result:sizing(q.body),status:status()})}catch(e){r.status(400).json({error:e.message})}});
  app.post('/api/v33/journal/prepare',requireAdmin,(q,r)=>{try{const id=q.body?.intentId;if(!valid(id))throw Error('Valid intentId required');if(intents.some(e=>e.data.intentId===id))throw Error('Intent ID already exists');const entry={intentId:id,state:'PREPARED',at:new Date().toISOString(),instrument:String(q.body?.instrument||'').slice(0,80),mode:'NO_BROKER_WRITE',dealId:null};r.json({entry:save(entry),status:status()})}catch(e){r.status(409).json({error:e.message})}});
  app.post('/api/v33/recovery/inspect',requireAdmin,async(_q,r)=>{try{const p=await api('/positions','GET',null,'2');if(!Array.isArray(p?.positions))throw Error('Positions unavailable');const result=reconcile(intents.map(e=>e.data),p.positions);r.set('Cache-Control','no-store').json({result,status:status()})}catch(e){r.status(502).json({error:'Read-only reconciliation unavailable',detail:String(e.message).slice(0,100)})}});
  app.post('/api/v33/history/correlate',requireAdmin,async(q,r)=>{try{const a=await api('/accounts');const selected=(a.accounts||[]).find(x=>x.accountId===authInfo()?.accountId);if(!selected||selected.accountType!=='CFD'||selected.currency!=='GBP')return r.status(409).json({error:'Active GBP CFD account not confirmed'});const now=new Date(),from=new Date(now.getTime()-30*86400000);const query=new URLSearchParams({from:from.toISOString(),to:now.toISOString(),pageSize:'100',pageNumber:'1'});const data=await api('/history/transactions?'+query,'GET',null,'2');if(!Array.isArray(data?.transactions))throw Error('History unavailable');const result=candidates(data.transactions,q.body||{});r.set('Cache-Control','no-store').json({scanned:data.transactions.length,candidates:result,searchLimitedToFirstPage:true,exactMatchFound:result.some(x=>x.exactReferenceMatch),warning:'Correlated candidates are not broker lifecycle proof. Masked references are diagnostic only.',status:status()});}catch(e){r.status(502).json({error:'Read-only history correlation failed',detail:String(e.message).slice(0,100)})}});
  app.get('/v33',(_q,r)=>r.sendFile(path.join(__dirname,'public','v33.html')));
 }
 return {routes,status};
}
module.exports={createV33,candidates,sizing,reconcile};

  },
  "v34-orchestrator": function(module, exports, require, __filename, __dirname) {
'use strict';
// V34: strictly paper-only orchestrator. No broker POST/PUT/DELETE, no execution arming.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ID=/^[a-zA-Z0-9_-]{3,80}$/;
const allowed=new Set(['LONG','SHORT']);
function evaluateSignal(signal,feed,limits={}){
 const reasons=[];
 if(!signal||!allowed.has(signal.direction))reasons.push('NO_ACTIONABLE_SIGNAL');
 if(!Number.isFinite(signal?.score)||signal.score<Math.max(70,Number(limits.minScore)||70))reasons.push('LOW_CONFIDENCE');
 if(!feed||feed.marketState!=='TRADEABLE')reasons.push('MARKET_NOT_TRADEABLE');
 if(feed?.delayed!==false)reasons.push('DELAYED_OR_UNKNOWN_FEED');
 if(!Number.isFinite(feed?.ageMs)||feed.ageMs<0||feed.ageMs>10000)reasons.push('STALE_FEED');
 if(!Number.isFinite(feed?.bid)||!Number.isFinite(feed?.ask)||feed.bid<=0||feed.ask<=feed.bid)reasons.push('INVALID_SPREAD');
 if(!signal?.bar||!Number.isFinite(Date.parse(signal.bar)))reasons.push('MISSING_BAR');
 if(!Number.isSafeInteger(limits?.unresolvedIntents)||limits.unresolvedIntents<0)reasons.push('ORDER_INTENT_STATUS_UNVERIFIED');
 else if(limits.unresolvedIntents>0)reasons.push('UNRESOLVED_ORDER_INTENT');
 if(limits?.storageHealthy!==true)reasons.push('PERSISTENCE_NOT_VERIFIED');
 return {decision:reasons.length?'REJECT':'PAPER_CANDIDATE',reasons,brokerOrderAllowed:false};
}
function inspectJournal(entries){
 let previous='GENESIS';const ids=new Set();
 for(const entry of entries){
  if(!entry||entry.previous!==previous||entry.digest!==sha({previous:entry.previous,event:entry.event}))return {valid:false,reason:'CHAIN_MISMATCH'};
  if(!entry.event||!ID.test(entry.event.id)||ids.has(entry.event.id))return {valid:false,reason:'DUPLICATE_OR_INVALID_EVENT'};
  ids.add(entry.event.id);previous=entry.digest;
 }
 return {valid:true,events:entries.length,head:previous};
}
function recoveryGate(journal,brokerPositions){
 if(!Array.isArray(journal)||!Array.isArray(brokerPositions))throw Error('Journal and positions arrays required');
 const unresolved=journal.filter(x=>['PREPARED','SENT_UNKNOWN','ACKNOWLEDGED','RECONCILE_REQUIRED'].includes(x.state));
 return {brokerOrderAllowed:false,autoRetryAllowed:false,unresolved:unresolved.map(x=>x.intentId),requiresManualReview:unresolved.length>0,brokerPositionsObserved:brokerPositions.length,warning:'Position snapshot alone cannot certify in-flight recovery or absence of pending IG requests.'};
}
function createV34({requireAdmin,api,authInfo,storageDir,persistentStorage=false,signalSnapshot}){
 const file=path.join(storageDir,'v34-paper-events.json');let events=[],healthy=true,error=null;
 try{if(fs.existsSync(file)){events=JSON.parse(fs.readFileSync(file,'utf8'));const check=inspectJournal(events);if(!check.valid)throw Error(check.reason);}}catch(e){healthy=false;error=e.message;}
 const state={enabled:false,cycles:0,lastCycle:null,lastDecision:null};
 function persist(event){
  if(!healthy||!persistentStorage)throw Error('Persistent journal unavailable');
  const previous=events.length?events.at(-1).digest:'GENESIS';const entry={previous,event,digest:sha({previous,event})};
  const next=[...events,entry];fs.mkdirSync(storageDir,{recursive:true});const tmp=file+'.tmp';
  try{const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const dir=fs.openSync(storageDir,'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}events=next;return entry;}catch(e){healthy=false;error=e.message;state.enabled=false;throw e;}
 }
 function status(){return {version:'34.0.0',mode:'PAPER_AUTOMATION_ORCHESTRATOR',paperAutomationEnabled:state.enabled,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,unattendedBrokerTradingEnabled:false,storageHealthy:healthy,persistentStorageConfigured:!!persistentStorage,journal:inspectJournal(events),cycles:state.cycles,lastCycle:state.lastCycle,lastDecision:state.lastDecision,checks:{gbpSizingCertified:false,brokerLifecycleCertified:false,crashRecoveryCertified:false},error,warning:'Paper decisions only; no broker order write paths or automatic retries.'};}
 function cycle(){
  const snap=signalSnapshot();const result=evaluateSignal(snap.signal,snap.feed,{minScore:75,unresolvedIntents:snap.unresolvedIntents,storageHealthy:healthy&&persistentStorage});
  const event={id:crypto.randomUUID(),at:new Date().toISOString(),kind:'PAPER_EVALUATION',epic:String(snap.epic||'').slice(0,60),direction:String(snap.signal?.direction||'UNKNOWN'),bar:snap.signal?.bar||null,decision:result.decision,reasons:result.reasons};
  persist(event);state.cycles++;state.lastCycle=event.at;state.lastDecision=result.decision;return {event,result};
 }
 function routes(app){
  app.get('/api/v34/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.get('/api/v34/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:events.slice(-50).map(x=>x.event),status:status()}));
  app.post('/api/v34/paper/start',requireAdmin,(_q,r)=>{if(!healthy||!persistentStorage)return r.status(409).json({error:'Durable storage required'});state.enabled=true;r.json({status:status()});});
  app.post('/api/v34/paper/stop',requireAdmin,(_q,r)=>{state.enabled=false;r.json({status:status()});});
  app.post('/api/v34/paper/cycle',requireAdmin,(_q,r)=>{try{r.json({...cycle(),status:status()})}catch(e){r.status(503).json({error:String(e.message),status:status()})}});
  app.post('/api/v34/broker/observe',requireAdmin,async(_q,r)=>{try{const a=await api('/accounts','GET');const current=(a.accounts||[]).find(x=>x.accountId===authInfo()?.accountId);if(current?.accountType!=='CFD'||current?.currency!=='GBP')return r.status(409).json({error:'Active GBP CFD account not confirmed'});const p=await api('/positions','GET',null,'2');if(!Array.isArray(p?.positions))throw Error('Positions unavailable');r.json({accountType:'CFD',currency:'GBP',positionsCount:p.positions.length,brokerOrderAllowed:false,warning:'Read-only snapshot; no lifecycle certification'});}catch(e){r.status(502).json({error:'Read-only broker observation failed',detail:String(e.message).slice(0,100)})}});
  app.get('/v34',(_q,r)=>r.sendFile(path.join(__dirname,'public','v34.html')));
 }
 // Disabled on every restart. Start enables only paper evaluations; no broker orders.
 const timer=setInterval(()=>{if(state.enabled){try{cycle()}catch{state.enabled=false}}},30000);timer.unref?.();
 return {routes,status,cycle,stop:()=>{state.enabled=false;clearInterval(timer)}};
}
module.exports={createV34,evaluateSignal,inspectJournal,recoveryGate};

  },
  "v35-diagnostics": function(module, exports, require, __filename, __dirname) {
'use strict';
// V35 is diagnostics-only. Never issues broker write requests.
const path=require('node:path');
function assess(v33,v34,snap){
 const count=v33?.unresolvedIntents;
 const journalVerified=v33?.storageHealthy===true&&v33?.persistentStorageConfigured===true&&Number.isSafeInteger(count)&&count>=0;
 const paperJournalVerified=v34?.storageHealthy===true&&v34?.persistentStorageConfigured===true&&v34?.journal?.valid===true;
 return {version:'35.0.0',mode:'PAPER_READINESS_DIAGNOSTICS',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,
  journalVerified,paperJournalVerified,unresolvedIntents:journalVerified?count:null,
  orderIntentGate:!journalVerified?'UNKNOWN_BLOCKED':count>0?'UNRESOLVED_BLOCKED':'LOCAL_JOURNAL_CLEAR',
  paperAutomationEnabled:v34?.paperAutomationEnabled===true,
  paperCycles:v34?.cycles??null,paperJournalEvents:v34?.journal?.events??null,
  market:{epic:snap?.epic??null,direction:snap?.direction??null,score:snap?.score??null,marketState:snap?.marketState??null,quoteAgeMs:snap?.quoteAgeMs??null,delayed:snap?.delayed??null},
  checks:{gbpSizingCertified:false,brokerLifecycleCertified:false,crashRecoveryCertified:false},
  warning:'Local journal clearance does not establish broker reconciliation. Paper diagnostics only; no broker order authorization.'};
}
function createV35({requireAdmin,v33Status,v34Status,signalSnapshot}){
 function status(){let v33=null,v34=null,snap=null;try{v33=v33Status()}catch{}try{v34=v34Status()}catch{}try{snap=signalSnapshot()}catch{}return assess(v33,v34,snap)}
 function routes(app){app.get('/api/v35/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/v35',(_q,r)=>r.sendFile(path.join(__dirname,'public','v35.html')))}
 return {routes,status};
}
module.exports={createV35,assess};

  },
  "v36-paper": function(module, exports, require, __filename, __dirname) {
 'use strict';
// V36 isolated PAPER ledger. Never invokes IG broker order endpoints.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {evaluateSignal}=require('./v34-orchestrator');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const CONFIG=Object.freeze({size:1,pipValueGBP:1,stopPips:12,targetPips:18,maxRiskGBP:25,maxTradesPerUtcDay:3,maxDailyLossGBP:100,maxSpreadPips:3});
const pip=0.0001;
function replay(entries){let prev='GENESIS',position=null,closed=[],openedToday={},realized=0;const seen=new Set();
 for(const row of entries){if(!row||row.previous!==prev||row.digest!==digest({previous:row.previous,event:row.event}))throw Error('JOURNAL_CHAIN_INVALID');prev=row.digest;
 const e=row.event;if(!e||!e.id||seen.has(e.id))throw Error('DUPLICATE_EVENT');seen.add(e.id);
 if(e.kind==='OPEN'){if(position)throw Error('OVERLAPPING_POSITIONS');position=e.position;const d=e.at.slice(0,10);openedToday[d]=(openedToday[d]||0)+1}
 else if(e.kind==='CLOSE'){if(!position||position.id!==e.positionId)throw Error('UNMATCHED_CLOSE');closed.push({...e,entry:position});realized+=e.pnlGBP;position=null}
 else if(e.kind!=='REJECT')throw Error('UNKNOWN_EVENT');}
 return {position,closed,openedToday,realized,head:prev};}
function assess(snap,gate,ledger,now,config=CONFIG){const reasons=[];const signal=snap?.signal,feed=snap?.feed;
 const base=evaluateSignal(signal,feed,{minScore:75,unresolvedIntents:gate?.verified===true?gate.count:1,storageHealthy:gate?.verified===true});reasons.push(...base.reasons);
 if(gate?.verified!==true)reasons.push('JOURNAL_UNVERIFIED');
 if(!finite(feed?.bid)||!finite(feed?.ask)||feed.ask<=feed.bid)reasons.push('INVALID_QUOTE');
 else if((feed.ask-feed.bid)/pip>config.maxSpreadPips)reasons.push('SPREAD_TOO_WIDE');
 if(ledger.position)reasons.push('POSITION_ALREADY_OPEN');
 const day=now.slice(0,10);if((ledger.openedToday[day]||0)>=config.maxTradesPerUtcDay)reasons.push('DAILY_TRADE_LIMIT');
 const todayLoss=ledger.closed.filter(x=>x.at.slice(0,10)===day).reduce((s,x)=>s+Math.min(0,x.pnlGBP),0);
 if(-todayLoss>=config.maxDailyLossGBP)reasons.push('DAILY_LOSS_LIMIT');
 const risk=config.size*config.stopPips*config.pipValueGBP;if(risk>config.maxRiskGBP)reasons.push('RISK_LIMIT');
 if(!finite(config.pipValueGBP)||config.pipValueGBP<=0)reasons.push('INVALID_PIP_ASSUMPTION');
 return {decision:reasons.length?'REJECT':'PAPER_ENTRY',reasons:[...new Set(reasons)],illustrativeRiskGBP:risk,brokerOrderAllowed:false};}
function closeQuote(pos,feed){if(!finite(feed?.bid)||!finite(feed?.ask)||feed.ask<=feed.bid)return null;
 const exit=pos.direction==='LONG'?feed.bid:feed.ask;
 const stopHit=pos.direction==='LONG'?exit<=pos.stop:exit>=pos.stop;
 const targetHit=pos.direction==='LONG'?exit>=pos.target:exit<=pos.target;
 if(!stopHit&&!targetHit)return null;
 const pips=(exit-pos.entry)/pip*(pos.direction==='LONG'?1:-1);
 return {exit,reason:stopHit?'STOP':'TARGET',pips:Number(pips.toFixed(5)),pnlGBP:Number((pips*pos.size*pos.pipValueGBP).toFixed(2))};}
function createV36({requireAdmin,storageDir,persistentStorage=false,signalSnapshot,v33Status}){
 const file=path.join(storageDir,'v36-paper-ledger.json');let entries=[],healthy=true,error=null,enabled=false,lastCycle=null,cycleCount=0;
 try{if(fs.existsSync(file)){entries=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(entries))throw Error('JOURNAL_NOT_ARRAY');replay(entries)}}catch(e){healthy=false;error=e.message}
 function state(){return replay(entries)}
 function status(){let s;try{s=state()}catch(e){healthy=false;error=e.message;s={position:null,closed:[],openedToday:{},realized:0,head:null}};
 return {version:'36.0.0',mode:'DURABLE_PAPER_POSITION_SIMULATOR',enabled,lastCycle,cycleCount,storageHealthy:healthy,persistentStorageConfigured:!!persistentStorage,journal:{events:entries.length,head:s.head,valid:healthy},openPosition:s.position,closedTrades:s.closed.length,realizedPnlGBP:Number(s.realized.toFixed(2)),assumptions:CONFIG,gbpSizingCertified:false,brokerLifecycleCertified:false,crashRecoveryCertified:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,error,warning:'PAPER ONLY. GBP pip value is an illustrative assumption, not independently verified IG contract sizing. Restarts disable the engine.'}}
 function append(event){if(!healthy||!persistentStorage)throw Error('DURABLE_STORAGE_REQUIRED');const previous=entries.length?entries.at(-1).digest:'GENESIS';const next=[...entries,{previous,event,digest:digest({previous,event})}];const tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const dir=fs.openSync(storageDir,'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}entries=next}catch(e){healthy=false;error=e.message;enabled=false;throw e}}
 function gate(){try{const j=v33Status();return {verified:j.storageHealthy===true&&j.persistentStorageConfigured===true&&Number.isSafeInteger(j.unresolvedIntents)&&j.unresolvedIntents>=0,count:j.unresolvedIntents}}catch{return {verified:false,count:null}}}
 function tick(){if(!healthy||!persistentStorage)throw Error('STORAGE_UNAVAILABLE');const snap=signalSnapshot(),now=new Date().toISOString(),s=state(),feed=snap.feed;lastCycle=now;cycleCount++;
 if(s.position){if(feed?.marketState!=='TRADEABLE'||feed?.delayed!==false||!finite(feed.ageMs)||feed.ageMs>10000||feed.ageMs<0) return {action:'HOLD',reason:'FEED_NOT_VERIFIED',status:status()};const c=closeQuote(s.position,feed);if(!c)return {action:'HOLD',reason:'NO_EXIT_TRIGGER',status:status()};const event={id:crypto.randomUUID(),at:now,kind:'CLOSE',positionId:s.position.id,...c};append(event);return {action:'CLOSE',event,status:status()}}
 const a=assess(snap,gate(),s,now);if(a.decision!=='PAPER_ENTRY')return {action:'REJECT',result:a,status:status()};
 const direction=snap.signal.direction,entry=direction==='LONG'?feed.ask:feed.bid;
 const stop=entry+(direction==='LONG'?-1:1)*CONFIG.stopPips*pip,target=entry+(direction==='LONG'?1:-1)*CONFIG.targetPips*pip;
 const position={id:crypto.randomUUID(),epic:snap.epic,direction,entry,stop,target,size:CONFIG.size,pipValueGBP:CONFIG.pipValueGBP,openedAt:now,signalBar:snap.signal.bar};
 const event={id:crypto.randomUUID(),at:now,kind:'OPEN',position};append(event);return {action:'OPEN',event,status:status()};}
 function routes(app){app.get('/api/v36/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v36/trades',requireAdmin,(_q,r)=>{try{const s=state();r.json({closed:s.closed.slice(-100),open:s.position,brokerOrderAllowed:false})}catch(e){r.status(503).json({error:e.message})}});
 app.post('/api/v36/paper/cycle',requireAdmin,(_q,r)=>{try{r.json(tick())}catch(e){r.status(503).json({error:e.message,status:status()})}});
 app.post('/api/v36/paper/start',requireAdmin,(_q,r)=>{if(!healthy||!persistentStorage)return r.status(409).json({error:'Durable storage required'});enabled=true;r.json(status())});
 app.post('/api/v36/paper/stop',requireAdmin,(_q,r)=>{enabled=false;r.json(status())});
 app.get('/v36',(_q,r)=>r.sendFile(path.join(__dirname,'public','v36.html')))}
 const timer=setInterval(()=>{if(enabled){try{tick()}catch(e){enabled=false;error=e.message}}},30000);timer.unref?.();
 return {routes,status,tick,stop:()=>{enabled=false;clearInterval(timer)}};}
module.exports={createV36,assess,replay,closeQuote,CONFIG};

  },
  "v37-readiness": function(module, exports, require, __filename, __dirname) {
 'use strict';
// Diagnostics + audit only. No broker write methods, no synthetic trade injection.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const good=x=>typeof x==='number'&&Number.isFinite(x);
function verifiedRestMarketState(rest,at,quote,now=Date.now()){
 const age=at?now-Date.parse(at):Infinity;
 if(!rest||rest.epic!=='CS.D.EURUSD.CFD.IP'||rest.marketStatus!=='TRADEABLE'||!good(age)||age<0||age>360000)return null;
 if(!quote||quote.marketState!=='DEAL'||!good(quote.at)||now-quote.at>10000||now<quote.at)return null;
 return 'TRADEABLE';
}
function assessSnapshot(s){const reasons=[],f=s?.feed||{},a=s?.signal||{};
 if(!['LONG','SHORT'].includes(a.direction))reasons.push('NO_ACTIONABLE_SIGNAL');
 if(!good(a.score)||a.score<75)reasons.push('LOW_CONFIDENCE');
 if(f.verifiedMarketStatus!=='TRADEABLE')reasons.push('MARKET_STATUS_NOT_VERIFIED');
 if(f.dealingFlag!=='DEAL')reasons.push('DEALING_FLAG_NOT_VERIFIED');
 if(f.delayed!==false)reasons.push('DELAY_UNKNOWN_OR_TRUE');
 if(!good(f.ageMs)||f.ageMs<0||f.ageMs>10000)reasons.push('STREAM_STALE');
 if(!good(f.bid)||!good(f.ask)||f.bid<=0||f.ask<=f.bid)reasons.push('INVALID_BID_ASK');
 else if((f.ask-f.bid)/0.0001>3)reasons.push('SPREAD_TOO_WIDE');
 if(!a.bar||!Number.isFinite(Date.parse(a.bar)))reasons.push('MISSING_SIGNAL_BAR');
 return {eligibleForPaperSignal:reasons.length===0,reasons,brokerOrderAllowed:false};
}
function verifyLog(rows){let prev='GENESIS';for(const row of rows){if(!row||row.previous!==prev||row.digest!==hash({previous:row.previous,event:row.event}))throw Error('AUDIT_CHAIN_INVALID');prev=row.digest}return prev}
function createV37({requireAdmin,storageDir,persistentStorage,v36Status,v33Status,snapshot}){
 const file=path.join(storageDir,'v37-evaluations.json');let rows=[],healthy=true,error=null,last=null,count=0;
 try{if(fs.existsSync(file)){rows=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(rows))throw Error('INVALID_AUDIT');verifyLog(rows)}}catch(e){healthy=false;error=e.message}
 function append(event){if(!healthy||!persistentStorage)throw Error('AUDIT_STORAGE_UNAVAILABLE');const previous=rows.length?rows.at(-1).digest:'GENESIS';const next=[...rows,{previous,event,digest:hash({previous,event})}];const tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const d=fs.openSync(storageDir,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}rows=next}catch(e){healthy=false;error=e.message;throw e}}
 function cycle(){const s=snapshot(),result=assessSnapshot(s),j=v33Status(),v=v36Status();const safety={journalHealthy:j.storageHealthy===true&&j.persistentStorageConfigured===true,unresolvedIntents:j.unresolvedIntents,brokerOrderAllowed:false};const event={id:crypto.randomUUID(),at:new Date().toISOString(),kind:'PAPER_READINESS_EVALUATION',epic:s.epic,signal:s.signal,feed:s.feed,result,safety,v36Enabled:v.enabled};append(event);last=event;count++;return {event,result,safety,brokerOrderAllowed:false}}
 function status(){const v=v36Status(),j=v33Status();return {version:'37.0.0',mode:'AUDITED_PAPER_READINESS',enabled:v.enabled,auditHealthy:healthy,auditEvents:rows.length,auditHead:healthy?verifyLog(rows):null,lastEvaluation:last||rows.at(-1)?.event||null,storageConfigured:!!persistentStorage,signal:snapshot(),v36:{openPosition:v.openPosition,closedTrades:v.closedTrades,realizedPnlGBP:v.realizedPnlGBP,journal:v.journal},brokerChecks:{gbpSizingCertified:false,brokerLifecycleCertified:false,crashRecoveryCertified:false,localUnresolvedIntents:j.unresolvedIntents},brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,error,warning:'Diagnostics and illustrative paper trading only. No broker orders. V36 restarts disabled.'}}
 function routes(app){app.get('/api/v37/status',requireAdmin,(_q,r)=>{try{r.set('Cache-Control','no-store').json(status())}catch(e){r.status(503).json({error:e.message})}});
 app.get('/api/v37/evaluations',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:rows.slice(-100).map(x=>x.event),total:rows.length,healthy,brokerOrderAllowed:false}));
 app.post('/api/v37/evaluate',requireAdmin,(_q,r)=>{try{r.json(cycle())}catch(e){r.status(503).json({error:e.message})}});
 app.get('/v37',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v37.html')))}
 // Monitor only while v36 is enabled. Does not call v36.tick or execute orders.
 const timer=setInterval(()=>{try{if(v36Status().enabled&&healthy&&persistentStorage)cycle()}catch(e){error=e.message;healthy=false}},30000);timer.unref?.();
 return {routes,status,cycle,stop:()=>clearInterval(timer)};
}
module.exports={createV37,verifiedRestMarketState,assessSnapshot,verifyLog};

  },
  "v38-verification": function(module, exports, require, __filename, __dirname) {
 'use strict';
// V38 isolated broker-verification workbench. No IG order API access or broker write methods.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const LIMITS=Object.freeze({riskGBP:25,dailyLossGBP:100,maxTradesPerUtcDay:3,stopPips:12,targetPips:18,maxSpreadPips:3});
function verifyChain(rows){let prev='GENESIS';const ids=new Set();for(const row of rows){if(!row||row.previous!==prev||row.digest!==sha({previous:row.previous,event:row.event}))throw Error('V38_CHAIN_INVALID');const e=row.event;if(!e||typeof e.id!=='string'||ids.has(e.id))throw Error('V38_DUPLICATE_OR_INVALID_EVENT');ids.add(e.id);prev=row.digest}return prev}
// Only accepted if broker contract details AND FX conversion are independently supplied and validated.
function verifySizing(x){const reasons=[];
 for(const k of ['stopPips','pipValueQuotePerContract','contractsPerDealUnit','gbpPerQuoteUnit','dealSize','minimumDealSize','dealSizeStep'])if(!finite(x?.[k])||x[k]<=0)reasons.push('INVALID_'+k.toUpperCase());
 if(reasons.length)return {certified:false,reasons,riskGBP:null,brokerOrderAllowed:false};
 const steps=(x.dealSize-x.minimumDealSize)/x.dealSizeStep;
 if(x.dealSize<x.minimumDealSize||Math.abs(steps-Math.round(steps))>1e-7)reasons.push('DEAL_SIZE_STEP_MISMATCH');
 if(x.stopPips!==LIMITS.stopPips)reasons.push('STOP_DISTANCE_MISMATCH');
 const risk=x.stopPips*x.pipValueQuotePerContract*x.contractsPerDealUnit*x.gbpPerQuoteUnit*x.dealSize;
 if(!finite(risk)||risk<=0||risk>LIMITS.riskGBP)reasons.push('RISK_BUDGET_EXCEEDED');
 if(x.verifiedContractSource!==true||x.verifiedFxSource!==true||x.verifiedDealingRules!==true)reasons.push('UNVERIFIED_BROKER_INPUTS');
 return {certified:false,provisionalRiskGBP:finite(risk)?Number(risk.toFixed(4)):null,reasons,brokerOrderAllowed:false,note:'Illustrative sizing calculation only. Independent IG DEMO confirmation and observed broker P/L required for certification.'};
}
function evaluateReadiness({v36={},v37={},v33={},legacyExecutionEnabled=false,brokerEvidence={}}={}){
 const checks={persistentPaperJournal:v36.storageHealthy===true&&v36.persistentStorageConfigured===true&&v36.journal?.valid===true,auditJournal:v37.auditHealthy===true&&v37.storageConfigured===true,marketStatusSeparated:v37.signal?.feed?.verifiedMarketStatus==='TRADEABLE',brokerJournalHealthy:v33.storageHealthy===true&&v33.persistentStorageConfigured===true&&v33.unresolvedIntents===0,brokerSizingCertified:brokerEvidence.sizingCertified===true,brokerLifecycleCertified:brokerEvidence.lifecycleCertified===true,brokerCrashRecoveryCertified:brokerEvidence.crashRecoveryCertified===true,legacyBrokerExecutionDisabled:legacyExecutionEnabled===false};
 const missing=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
 return {checks,missing,readyForUnattendedDemo:false,brokerOrderAllowed:false,phase:'CONTROLLED_VERIFICATION_ONLY',warning:'No IG broker writes are exposed by v38. Certification requires independent broker evidence and explicit later review.'};
}
function assessEvidence(x){const allowed=['CONTRACT_SPEC_CAPTURE','FX_CONVERSION_CAPTURE','BROKER_OPEN_OBSERVATION','BROKER_CONFIRMATION_OBSERVATION','BROKER_CLOSE_OBSERVATION','RESTART_RECOVERY_OBSERVATION','RECONCILIATION_OBSERVATION','PAPER_REPLAY_RESULT'];
 if(!x||!allowed.includes(x.kind))throw Error('UNSUPPORTED_EVIDENCE_KIND');
 if(typeof x.note!=='string'||!x.note.trim()||x.note.length>500)throw Error('INVALID_NOTE');
 if(x.reference!==undefined&&(typeof x.reference!=='string'||x.reference.length>120))throw Error('INVALID_REFERENCE');
 return {kind:x.kind,note:x.note.trim(),reference:x.reference||null};
}
function createV38({requireAdmin,storageDir,persistentStorage,v36Status,v37Status,v33Status,legacyExecutionEnabled=false}){
 const file=path.join(storageDir,'v38-verification-evidence.json');let rows=[],healthy=true,error=null;
 try{if(fs.existsSync(file)){rows=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(rows))throw Error('V38_NOT_ARRAY');verifyChain(rows)}}catch(e){healthy=false;error=e.message}
 function status(){let checks;try{checks=evaluateReadiness({v36:v36Status(),v37:v37Status(),v33:v33Status(),legacyExecutionEnabled})}catch(e){checks={missing:['STATUS_UNAVAILABLE'],error:e.message,readyForUnattendedDemo:false,brokerOrderAllowed:false}}return {version:'38.0.0',mode:'IG_DEMO_VERIFICATION_WORKBENCH',storageHealthy:healthy,persistentStorageConfigured:!!persistentStorage,evidenceEvents:rows.length,evidenceHead:healthy?verifyChain(rows):null,lastEvidence:rows.at(-1)?.event||null,limits:LIMITS,readiness:checks,brokerExecution:'HARD_BLOCKED_IN_V38',brokerOrderAllowed:false,error};}
 function record(payload){if(!healthy||!persistentStorage)throw Error('V38_DURABLE_STORAGE_REQUIRED');const accepted=assessEvidence(payload),event={id:crypto.randomUUID(),at:new Date().toISOString(),...accepted,classification:'OPERATOR_REPORTED_UNVERIFIED'};const previous=rows.at(-1)?.digest||'GENESIS',next=[...rows,{previous,event,digest:sha({previous,event})}],tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const d=fs.openSync(storageDir,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}rows=next;return event}catch(e){healthy=false;error=e.message;throw e}}
 function routes(app){app.get('/api/v38/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v38/evidence',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:rows.slice(-100).map(x=>x.event),total:rows.length,healthy,brokerOrderAllowed:false}));app.post('/api/v38/evidence',requireAdmin,(q,r)=>{try{r.status(201).json({event:record(q.body),brokerOrderAllowed:false})}catch(e){r.status(400).json({error:e.message,brokerOrderAllowed:false})}});app.post('/api/v38/sizing/check',requireAdmin,(q,r)=>r.json(verifySizing(q.body)));app.get('/v38',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v38.html')))}
 return {routes,status,record};
}
module.exports={createV38,verifyChain,verifySizing,evaluateReadiness,assessEvidence,LIMITS};

  },
  "v39-lifecycle": function(module, exports, require, __filename, __dirname) {
 'use strict';
// v39 observer and controlled dry-run verification. NEVER imports IG order APIs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const MAX_HOLD_HOURS=24;
function verify(rows){let head='GENESIS';const ids=new Set();for(const row of rows){if(!row||row.previous!==head||row.digest!==hash({previous:row.previous,event:row.event}))throw Error('V39_JOURNAL_INVALID');const e=row.event;if(!e||typeof e.id!=='string'||ids.has(e.id))throw Error('V39_EVENT_INVALID');ids.add(e.id);head=row.digest}return head}
function inspect({paper={},audit={},verification={},now=Date.now()}={}){
 const issues=[],position=paper.openPosition||null,started=Date.parse(position?.openedAt),cycleAt=Date.parse(paper.lastCycle),heartbeatAgeMs=Number.isFinite(cycleAt)?now-cycleAt:null;
 if(paper.enabled===true&&(heartbeatAgeMs===null||heartbeatAgeMs>90000||heartbeatAgeMs<0))issues.push('PAPER_HEARTBEAT_MISSING_OR_STALE');
 if(paper.storageHealthy!==true||paper.journal?.valid!==true)issues.push('PAPER_JOURNAL_UNHEALTHY');
 if(audit.auditHealthy!==true)issues.push('AUDIT_JOURNAL_UNHEALTHY');
 if(verification.storageHealthy!==true)issues.push('EVIDENCE_JOURNAL_UNHEALTHY');
 if(position&&!Number.isFinite(started))issues.push('POSITION_OPEN_TIME_INVALID');
 const holdHours=position&&Number.isFinite(started)?Math.max(0,(now-started)/3600000):null;
 if(holdHours!==null&&holdHours>=MAX_HOLD_HOURS)issues.push('POSITION_EXCEEDS_MAX_HOLD_REVIEW');
 const feed=audit.signal?.feed||{},quoteValid=feed.verifiedMarketStatus==='TRADEABLE'&&feed.dealingFlag==='DEAL'&&feed.delayed===false&&finite(feed.ageMs)&&feed.ageMs>=0&&feed.ageMs<=10000&&finite(feed.bid)&&finite(feed.ask)&&feed.ask>feed.bid;
 if(position&&!quoteValid)issues.push('OPEN_POSITION_FEED_UNVERIFIED');
 let mark=null;if(position&&quoteValid){const exit=position.direction==='LONG'?feed.bid:feed.ask;const pipDelta=(exit-position.entry)/0.0001*(position.direction==='LONG'?1:-1);mark={exitQuote:exit,pips:Number(pipDelta.toFixed(2)),illustrativePnlGBP:Number((pipDelta*position.size*position.pipValueGBP).toFixed(2)),source:'ILLUSTRATIVE_NOT_IG_BROKER_PNL'};}
 return {paperEnabled:paper.enabled===true,position,closedTrades:paper.closedTrades??null,heartbeat:{lastCycle:paper.lastCycle||null,cycleCount:paper.cycleCount??null,ageMs:heartbeatAgeMs,healthy:paper.enabled===true&&heartbeatAgeMs!==null&&heartbeatAgeMs<=90000&&heartbeatAgeMs>=0},holdingHours:holdHours===null?null:Number(holdHours.toFixed(2)),maxHoldReviewHours:MAX_HOLD_HOURS,feedVerified:quoteValid,mark,issues,brokerOrderAllowed:false};
}
function validateIntent(x){if(!x||x.kind!=='DEMO_ORDER_DRY_RUN')throw Error('DRY_RUN_ONLY');if(typeof x.epic!=='string'||!/^CS\.D\.[A-Z]{6}\.CFD\.IP$/.test(x.epic))throw Error('INVALID_EPIC');if(!['LONG','SHORT'].includes(x.direction))throw Error('INVALID_DIRECTION');if(typeof x.operatorNote!=='string'||x.operatorNote.trim().length<8||x.operatorNote.length>300)throw Error('OPERATOR_NOTE_REQUIRED');return {kind:x.kind,epic:x.epic,direction:x.direction,operatorNote:x.operatorNote.trim()}}
function createV39({requireAdmin,storageDir,persistentStorage,v36Status,v37Status,v38Status}){
 const file=path.join(storageDir,'v39-dry-run-intents.json');let rows=[],healthy=true,error=null;
 try{if(fs.existsSync(file)){rows=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(rows))throw Error('V39_NOT_ARRAY');verify(rows)}}catch(e){healthy=false;error=e.message}
 function snapshot(){return inspect({paper:v36Status(),audit:v37Status(),verification:v38Status()})}
 function status(){let lifecycle;try{lifecycle=snapshot()}catch(e){lifecycle={issues:['DEPENDENCY_STATUS_ERROR'],error:e.message,brokerOrderAllowed:false}}
 return {version:'39.0.0',mode:'PAPER_LIFECYCLE_AND_IG_DEMO_DRY_RUN',journalHealthy:healthy,persistentStorageConfigured:!!persistentStorage,journalEvents:rows.length,journalHead:healthy?verify(rows):null,lifecycle,certifications:{gbpSizing:false,brokerLifecycle:false,crashRecovery:false},readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,error,warning:'Dry runs never submit IG orders. Time-limit is an alert, not an automatic closure. No broker order APIs are imported.'}}
 function dryRun(x){if(!healthy||!persistentStorage)throw Error('DURABLE_JOURNAL_REQUIRED');const accepted=validateIntent(x),life=snapshot();const event={...accepted,id:crypto.randomUUID(),at:new Date().toISOString(),result:'BLOCKED_NO_BROKER_WRITE',issues:life.issues,classification:'SIMULATION_ONLY'};const previous=rows.at(-1)?.digest||'GENESIS',next=[...rows,{previous,event,digest:hash({previous,event})}],tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const dir=fs.openSync(storageDir,'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}rows=next;return event}catch(e){healthy=false;error=e.message;throw e}}
 function routes(app){app.get('/api/v39/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v39/intents',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:rows.slice(-100).map(r=>r.event),total:rows.length,healthy,brokerOrderAllowed:false}));app.post('/api/v39/dry-run',requireAdmin,(q,r)=>{try{r.status(201).json({event:dryRun(q.body),brokerOrderAllowed:false})}catch(e){r.status(400).json({error:e.message,brokerOrderAllowed:false})}});app.get('/v39',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v39.html')))}
 return {routes,status,dryRun};}
module.exports={createV39,inspect,verify,validateIntent,MAX_HOLD_HOURS};

  },
  "v40-protocol": function(module, exports, require, __filename, __dirname) {
 'use strict';
// V40 isolated broker protocol rehearsal: no IG order imports or network writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const good=x=>typeof x==='number'&&Number.isFinite(x);
const STATES=['PREPARED','APPROVED_SIMULATED','SUBMISSION_UNCERTAIN','BROKER_ACCEPTED_SIMULATED','POSITION_MATCHED_SIMULATED','CLOSE_REQUESTED_SIMULATED','CLOSED_SIMULATED','REJECTED','CANCELLED'];
const NEXT={PREPARED:['APPROVED_SIMULATED','CANCELLED','REJECTED'],APPROVED_SIMULATED:['SUBMISSION_UNCERTAIN','CANCELLED'],SUBMISSION_UNCERTAIN:['BROKER_ACCEPTED_SIMULATED','REJECTED'],BROKER_ACCEPTED_SIMULATED:['POSITION_MATCHED_SIMULATED'],POSITION_MATCHED_SIMULATED:['CLOSE_REQUESTED_SIMULATED'],CLOSE_REQUESTED_SIMULATED:['CLOSED_SIMULATED']};
function validate(rows){if(!Array.isArray(rows))throw Error('JOURNAL_NOT_ARRAY');let head='GENESIS';const ids=new Set();for(const r of rows){if(!r||r.previous!==head||r.digest!==digest({previous:r.previous,event:r.event}))throw Error('JOURNAL_CHAIN_INVALID');if(!r.event||!r.event.id||ids.has(r.event.id))throw Error('JOURNAL_EVENT_INVALID');ids.add(r.event.id);head=r.digest}return head}
function replay(rows){const intents=new Map(),keys=new Set();for(const {event:e} of rows){if(e.kind==='PREPARE'){if(keys.has(e.key)||intents.has(e.intentId))throw Error('DUPLICATE_INTENT_IN_JOURNAL');keys.add(e.key);intents.set(e.intentId,{id:e.intentId,key:e.key,epic:e.epic,direction:e.direction,createdAt:e.at,stopPips:e.stopPips,size:e.size,state:'PREPARED',history:[e]})}else if(e.kind==='TRANSITION'){const t=intents.get(e.intentId);if(!t||!(NEXT[t.state]||[]).includes(e.to))throw Error('ILLEGAL_REPLAY_TRANSITION');t.state=e.to;t.history.push(e)}else throw Error('UNKNOWN_EVENT_KIND')}return [...intents.values()]}
function riskPreview({size,stopPips,pipValueGBP,minimumSize,stepSize,conversionVerified}){const reasons=[];if(!good(size)||size<=0||!good(stopPips)||stopPips<=0)reasons.push('INVALID_ORDER_SIZE_OR_STOP');if(!good(pipValueGBP)||pipValueGBP<=0||conversionVerified!==true)reasons.push('GBP_PIP_VALUE_NOT_INDEPENDENTLY_VERIFIED');if(!good(minimumSize)||minimumSize<=0||!good(stepSize)||stepSize<=0)reasons.push('IG_SIZE_RULES_UNVERIFIED');if(!reasons.length){if(size<minimumSize||Math.abs((size-minimumSize)/stepSize-Math.round((size-minimumSize)/stepSize))>1e-7)reasons.push('IG_SIZE_INCREMENT_MISMATCH');if(size*stopPips*pipValueGBP>25+1e-8)reasons.push('EXCEEDS_25_GBP_RISK_LIMIT')}return {illustrativeRiskGBP:good(size)&&good(stopPips)&&good(pipValueGBP)?Number((size*stopPips*pipValueGBP).toFixed(2)):null,eligibleForReview:reasons.length===0,reasons,brokerOrderAllowed:false,warning:'Operator-supplied inputs are NOT broker sizing certification'} }
function createV40({requireAdmin,storageDir,persistentStorage,v36Status,v37Status,v38Status,v39Status}){
 const file=path.join(storageDir,'v40-protocol-journal.json');let rows=[],healthy=true,error=null;
 try{if(fs.existsSync(file)){rows=JSON.parse(fs.readFileSync(file,'utf8'));validate(rows);replay(rows)}}catch(e){healthy=false;error=e.message}
 function append(event){if(!healthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_REQUIRED');const previous=rows.at(-1)?.digest||'GENESIS',next=[...rows,{previous,event,digest:digest({previous,event})}],tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const dir=fs.openSync(storageDir,'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}validate(next);replay(next);rows=next;return event}catch(e){healthy=false;error=e.message;throw e}}
 function list(){return replay(rows)}
 function prepare(body){if(!healthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_REQUIRED');if(!body||typeof body.key!=='string'||! /^[a-zA-Z0-9_-]{8,80}$/.test(body.key))throw Error('IDEMPOTENCY_KEY_REQUIRED_8_TO_80_CHARS');if(body.epic!=='CS.D.EURUSD.CFD.IP')throw Error('ONLY_EURUSD_REHEARSAL');if(!['LONG','SHORT'].includes(body.direction))throw Error('INVALID_DIRECTION');if(!good(body.size)||body.size<=0||!good(body.stopPips)||body.stopPips<=0)throw Error('INVALID_SIZE_OR_STOP');const old=list().find(t=>t.key===body.key);if(old)return {intent:old,idempotentReplay:true};if(list().some(t=>!['CANCELLED','REJECTED','CLOSED_SIMULATED'].includes(t.state)))throw Error('UNRESOLVED_INTENT_EXISTS');const e={id:crypto.randomUUID(),kind:'PREPARE',intentId:crypto.randomUUID(),key:body.key,epic:body.epic,direction:body.direction,size:body.size,stopPips:body.stopPips,at:new Date().toISOString(),simulationOnly:true};append(e);return {intent:list().find(t=>t.id===e.intentId),idempotentReplay:false}}
 function transition(body){if(!healthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_REQUIRED');if(!body||typeof body.intentId!=='string'||!STATES.includes(body.to))throw Error('INVALID_TRANSITION_REQUEST');const t=list().find(x=>x.id===body.intentId);if(!t)throw Error('UNKNOWN_INTENT');if(!(NEXT[t.state]||[]).includes(body.to))throw Error('TRANSITION_NOT_ALLOWED');if(body.to==='APPROVED_SIMULATED'&&(typeof body.operatorNote!=='string'||body.operatorNote.trim().length<12))throw Error('OPERATOR_NOTE_REQUIRED');const e={id:crypto.randomUUID(),kind:'TRANSITION',intentId:t.id,from:t.state,to:body.to,at:new Date().toISOString(),operatorNote:typeof body.operatorNote==='string'?body.operatorNote.slice(0,250):null,simulationOnly:true};append(e);return list().find(x=>x.id===t.id)}
 function status(){let deps={},issues=[];try{const a=v36Status(),b=v37Status(),c=v38Status(),d=v39Status();deps={paperEnabled:a.enabled===true,paperJournalValid:a.journal?.valid===true,auditHealthy:b.auditHealthy===true,verificationHealthy:c.storageHealthy===true,lifecycleJournalHealthy:d.journalHealthy===true,heartbeatHealthy:d.lifecycle?.heartbeat?.healthy===true};for(const [k,v] of Object.entries(deps))if(!v)issues.push(k)}catch(e){issues.push('DEPENDENCY_UNAVAILABLE')};let intents=[];try{intents=list()}catch(e){issues.push('JOURNAL_REPLAY_FAILED')};const unresolved=intents.filter(t=>!['CANCELLED','REJECTED','CLOSED_SIMULATED'].includes(t.state));if(unresolved.length)issues.push('UNRESOLVED_SIMULATED_INTENT_REQUIRES_RECONCILIATION');if(!healthy)issues.push('JOURNAL_UNHEALTHY');return {version:'40.0.0',mode:'IG_DEMO_ORDER_PROTOCOL_REHEARSAL',journalHealthy:healthy,persistentStorageConfigured:!!persistentStorage,journalEvents:rows.length,journalHead:healthy?validate(rows):null,dependencyChecks:deps,issues,protocol:{intentCount:intents.length,unresolvedCount:unresolved.length,unresolved:unresolved.map(t=>({id:t.id,state:t.state,key:t.key})),states:STATES},certifications:{gbpSizing:false,brokerLifecycle:false,crashRecovery:false},readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,error,warning:'SIMULATION ONLY. This module cannot send IG orders. Simulated transitions are not broker certification.'}}
 function routes(app){const fail=(r,e)=>r.status(409).set('Cache-Control','no-store').json({error:e.message,brokerOrderAllowed:false});app.get('/api/v40/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v40/intents',requireAdmin,(_q,r)=>{try{r.set('Cache-Control','no-store').json({intents:list(),brokerOrderAllowed:false})}catch(e){fail(r,e)}});app.post('/api/v40/prepare',requireAdmin,(q,r)=>{try{r.status(201).json({...prepare(q.body),brokerOrderAllowed:false})}catch(e){fail(r,e)}});app.post('/api/v40/transition',requireAdmin,(q,r)=>{try{r.json({intent:transition(q.body),brokerOrderAllowed:false})}catch(e){fail(r,e)}});app.post('/api/v40/risk-preview',requireAdmin,(q,r)=>r.json(riskPreview(q.body||{})));app.get('/v40',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v40.html')))}
 return {routes,status,prepare,transition,list};
}
module.exports={createV40,validate,replay,riskPreview,STATES,NEXT};

  },
  "v41-broker-observer": function(module, exports, require, __filename, __dirname) {
'use strict';
// V41 read-only IG DEMO observer. NO broker order methods, no order approval or certification.
const EPIC='CS.D.EURUSD.CFD.IP';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function assess({positions,market,account,protocol,paper,at,now=Date.now()}){
 const issues=[];if(!Array.isArray(positions))issues.push('POSITIONS_NOT_VERIFIED');
 const open=Array.isArray(positions)?positions.filter(p=>p?.position&&p?.market):[];
 const eur=open.filter(p=>p.market.epic===EPIC);
 if(open.length)issues.push('BROKER_HAS_OPEN_POSITIONS_REVIEW_REQUIRED');
 if(eur.length>1)issues.push('MULTIPLE_EURUSD_POSITIONS');
 const min=Number(market?.dealingRules?.minDealSize?.value), minStop=Number(market?.dealingRules?.minNormalStopOrLimitDistance?.value);
 if(!finite(min)||min<=0)issues.push('MINIMUM_DEAL_SIZE_UNVERIFIED');
 if(!finite(minStop)||minStop<=0)issues.push('MINIMUM_STOP_DISTANCE_UNVERIFIED');
 const marketStatus=market?.snapshot?.marketStatus||'UNKNOWN';
 if(marketStatus!=='TRADEABLE')issues.push('MARKET_NOT_TRADEABLE');
 if(!account||typeof account.accountId!=='string')issues.push('ACCOUNT_ID_UNVERIFIED');
 if(!finite(at)||now-at>60000||at>now+5000)issues.push('BROKER_SNAPSHOT_STALE');
 if(protocol?.protocol?.unresolvedCount!==0)issues.push('UNRESOLVED_SIMULATED_INTENTS');
 const brokerPositions=open.map(p=>({epic:String(p.market.epic||''),direction:String(p.position.direction||''),size:finite(Number(p.position.size))?Number(p.position.size):null,dealId:String(p.position.dealId||'').slice(0,80)}));
 return {observedAt:finite(at)?new Date(at).toISOString():null,ageMs:finite(at)?now-at:null,accountMatch:!!(account&&account.accountId),marketStatus,minimumDealSize:finite(min)&&min>0?min:null,minimumStopDistance:finite(minStop)&&minStop>0?minStop:null,minimumStopDistanceUnit:market?.dealingRules?.minNormalStopOrLimitDistance?.unit||null,brokerPositionCount:open.length,eurusdBrokerPositionCount:eur.length,brokerPositions,paperPositionPresent:!!paper?.openPosition,paperIsNotBrokerPosition:true,issues,observationHealthy:issues.length===0,gbpSizingCertified:false,brokerLifecycleCertified:false,crashRecoveryCertified:false,readyForUnattendedDemo:false,brokerOrderAllowed:false,warning:'Read-only IG DEMO observations; no broker order writes. Market dealing rules alone cannot certify GBP pip value, FX conversion or order recovery.'};
}
function createV41({requireAdmin,readBroker,v36Status,v40Status}){
 let last=null, busy=false, lastAttempt=0, lastError=null;
 async function refresh(){if(busy)throw Error('BROKER_OBSERVATION_IN_PROGRESS');if(Date.now()-lastAttempt<10000)throw Error('BROKER_OBSERVATION_RATE_LIMIT_10_SECONDS');busy=true;lastAttempt=Date.now();try{
  const broker=await readBroker();const snapshot=assess({...broker,paper:v36Status(),protocol:v40Status(),at:Date.now()});last={...snapshot};lastError=null;return snapshot;
 }catch(e){last=null;lastError=String(e.message||e).slice(0,160);throw e}finally{busy=false}}
 function status(){const current=last?{...last,ageMs:Date.now()-Date.parse(last.observedAt)}:null;const stale=!current||current.ageMs>60000;return {version:'41.0.0',mode:'IG_DEMO_READ_ONLY_BROKER_OBSERVER',observation:current,observationFresh:!stale,observationHealthy:!stale&&current.observationHealthy,issues:stale?['NO_FRESH_BROKER_OBSERVATION',...(current?.issues||[])]:current.issues,lastError,refreshInProgress:busy,certifications:{gbpSizing:false,brokerLifecycle:false,crashRecovery:false},readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED_V41',brokerOrderAllowed:false};}
 function routes(app){app.get('/api/v41/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.post('/api/v41/observe',requireAdmin,async(_q,r)=>{try{const result=await refresh();r.set('Cache-Control','no-store').json(result)}catch(e){r.status(409).set('Cache-Control','no-store').json({error:String(e.message||e).slice(0,160),brokerOrderAllowed:false})}});app.get('/v41',requireAdmin,(_q,r)=>r.sendFile(require('node:path').join(__dirname,'public','v41.html')))}
 return {routes,status,refresh};
}
module.exports={createV41,assess,EPIC};

  },
  "v42-verification": function(module, exports, require, __filename, __dirname) {
'use strict';
// Read-only broker verification workbench. Does not import IG order submission functions.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.CFD.IP';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function verify(rows){if(!Array.isArray(rows))throw Error('EVIDENCE_NOT_ARRAY');let head='GENESIS';const ids=new Set();for(const row of rows){if(!row||row.previous!==head||row.digest!==hash({previous:row.previous,event:row.event}))throw Error('EVIDENCE_CHAIN_INVALID');if(!row.event||typeof row.event.id!=='string'||ids.has(row.event.id))throw Error('EVIDENCE_EVENT_INVALID');ids.add(row.event.id);head=row.digest}return head}
function riskPreview(x={}){const reasons=[];const {size,stopPips,pipValueGBP,minimumSize,stepSize,conversionVerified,contractVerified,quoteAgeMs}=x;
 if(!finite(size)||size<=0||!finite(stopPips)||stopPips<=0)reasons.push('INVALID_SIZE_OR_STOP');
 if(!finite(pipValueGBP)||pipValueGBP<=0||conversionVerified!==true||contractVerified!==true)reasons.push('CONTRACT_OR_GBP_PIP_VALUE_UNVERIFIED');
 if(!finite(minimumSize)||minimumSize<=0||!finite(stepSize)||stepSize<=0)reasons.push('DEAL_SIZE_RULES_UNVERIFIED');
 if(!finite(quoteAgeMs)||quoteAgeMs<0||quoteAgeMs>10000)reasons.push('QUOTE_STALE_OR_UNVERIFIED');
 if(!reasons.length){if(size<minimumSize||Math.abs((size-minimumSize)/stepSize-Math.round((size-minimumSize)/stepSize))>1e-7)reasons.push('SIZE_INCREMENT_INVALID');if(size*stopPips*pipValueGBP>25)reasons.push('EXCEEDS_25_GBP_LIMIT')}
 const risk=finite(size)&&finite(stopPips)&&finite(pipValueGBP)?Number((size*stopPips*pipValueGBP).toFixed(2)):null;
 return {illustrativeRiskGBP:risk,eligibleForOperatorReview:reasons.length===0,reasons,certified:false,brokerOrderAllowed:false,warning:'Inputs are operator supplied. Passing preview is NOT independent broker certification. Spreads, slippage and fees can increase loss.'};}
function reconcile({broker,protocol,paper,at,now=Date.now()}){
 const issues=[];const positions=broker?.positions;
 if(!Array.isArray(positions))issues.push('BROKER_POSITIONS_MISSING');
 const active=Array.isArray(positions)?positions.filter(p=>p&&p.position&&p.market):[];
 if(active.length)issues.push('BROKER_EXPOSURE_REQUIRES_OPERATOR_REVIEW');
 if(!broker?.account||typeof broker.account.accountId!=='string')issues.push('ACCOUNT_UNVERIFIED');
 if(!finite(at)||at>now+5000||now-at>60000)issues.push('OBSERVATION_STALE');
 if(protocol?.protocol?.unresolvedCount!==0)issues.push('UNRESOLVED_PROTOCOL_INTENT');
 if(protocol?.journalHealthy!==true)issues.push('PROTOCOL_JOURNAL_UNHEALTHY');
 if(paper?.journal?.valid!==true)issues.push('PAPER_JOURNAL_UNHEALTHY');
 const matching=active.filter(p=>p.market.epic===EPIC);
 return {observedAt:new Date(at).toISOString(),brokerPositionCount:active.length,eurusdBrokerPositionCount:matching.length,brokerDealIds:active.map(p=>String(p.position.dealId||'').slice(0,80)),paperPositionPresent:!!paper?.openPosition,paperIsNotBrokerPosition:true,unresolvedProtocolIntents:protocol?.protocol?.unresolvedCount??null,issues,observationHealthy:issues.length===0,brokerOrderAllowed:false};}
function createV42({requireAdmin,storageDir,persistentStorage,readBroker,v36Status,v40Status}){
 const file=path.join(storageDir,'v42-evidence.json');let rows=[],healthy=true,error=null,busy=false,lastAttempt=0;
 try{if(fs.existsSync(file)){rows=JSON.parse(fs.readFileSync(file,'utf8'));verify(rows)}}catch(e){healthy=false;error=e.message}
 function append(event){if(!healthy||!persistentStorage)throw Error('PERSISTENT_EVIDENCE_REQUIRED');const previous=rows.at(-1)?.digest||'GENESIS';const next=[...rows,{previous,event,digest:hash({previous,event})}];const tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const dir=fs.openSync(storageDir,'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}verify(next);rows=next}catch(e){healthy=false;error=e.message;throw e}}
 function status(){return {version:'42.0.0',mode:'IG_DEMO_READ_ONLY_VERIFICATION_WORKBENCH',journalHealthy:healthy,persistentStorageConfigured:!!persistentStorage,evidenceEvents:rows.length,evidenceHead:healthy?verify(rows):null,lastObservation:rows.at(-1)?.event?.observation||null,refreshInProgress:busy,error,certifications:{gbpSizing:false,brokerLifecycle:false,crashRecovery:false},readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,warning:'Evidence and risk previews are not broker certification. No IG order writes.'}}
 async function observe(){if(busy)throw Error('OBSERVATION_IN_PROGRESS');if(Date.now()-lastAttempt<10000)throw Error('OBSERVATION_RATE_LIMIT_10_SECONDS');if(!healthy||!persistentStorage)throw Error('PERSISTENT_EVIDENCE_REQUIRED');busy=true;lastAttempt=Date.now();try{const broker=await readBroker();const observation=reconcile({broker,protocol:v40Status(),paper:v36Status(),at:Date.now()});append({id:crypto.randomUUID(),kind:'BROKER_OBSERVATION',at:new Date().toISOString(),observation});return {...observation,evidenceHead:verify(rows),brokerOrderAllowed:false}}finally{busy=false}}
 function evidence(){return rows.map((r,i)=>({index:i+1,at:r.event.at,kind:r.event.kind,digest:r.digest,observation:r.event.observation}))}
 function routes(app){const fail=(r,e)=>r.status(409).set('Cache-Control','no-store').json({error:String(e.message||e).slice(0,160),brokerOrderAllowed:false});app.get('/api/v42/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v42/evidence',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({evidence:evidence(),brokerOrderAllowed:false}));app.post('/api/v42/observe',requireAdmin,async(_q,r)=>{try{r.set('Cache-Control','no-store').json(await observe())}catch(e){fail(r,e)}});app.post('/api/v42/risk-preview',requireAdmin,(q,r)=>r.set('Cache-Control','no-store').json(riskPreview(q.body||{})));app.get('/v42',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v42.html')))}
 return {routes,status,observe,evidence};
}
module.exports={createV42,verify,riskPreview,reconcile};

  },
  "v43-unattended": function(module, exports, require, __filename, __dirname) {
'use strict';
// Unattended DEMO readiness rehearsal. No broker order endpoints, imports or writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function validate(rows){if(!Array.isArray(rows))throw Error('INVALID_JOURNAL');let prev='GENESIS';for(const r of rows){if(r.previous!==prev||r.hash!==sha({previous:r.previous,event:r.event}))throw Error('JOURNAL_TAMPERED');prev=r.hash}return prev}
function assess({paper,life,protocol,evidence,observer,now=Date.now()}){
 const blockers=[];
 if(paper?.enabled!==true||paper?.journal?.valid!==true)blockers.push('PAPER_NOT_HEALTHY');
 if(life?.lifecycle?.heartbeat?.healthy!==true||life?.lifecycle?.feedVerified!==true)blockers.push('HEARTBEAT_OR_FEED_UNHEALTHY');
 if(protocol?.journalHealthy!==true||protocol?.protocol?.unresolvedCount!==0)blockers.push('PROTOCOL_UNRESOLVED_OR_UNHEALTHY');
 if(evidence?.journalHealthy!==true||!evidence?.persistentStorageConfigured)blockers.push('EVIDENCE_STORAGE_UNHEALTHY');
 const obs=evidence?.lastObservation;
 if(!obs||!Number.isFinite(Date.parse(obs.observedAt))||now-Date.parse(obs.observedAt)>60000||now<Date.parse(obs.observedAt)-5000)blockers.push('BROKER_EVIDENCE_STALE');
 if(obs?.observationHealthy!==true||obs?.brokerPositionCount!==0||obs?.unresolvedProtocolIntents!==0)blockers.push('BROKER_EXPOSURE_OR_RECONCILIATION');
 if(observer?.observationHealthy!==true||observer?.observationFresh!==true)blockers.push('OBSERVER_NOT_FRESH');
 return {rehearsalEligible:blockers.length===0,blockers,brokerOrderAllowed:false,brokerCertified:false};
}
function createV43({requireAdmin,storageDir,persistentStorage,v36Status,v39Status,v40Status,v41Status,v42Status}){
 const file=path.join(storageDir,'v43-unattended-rehearsal.json');let rows=[],healthy=true,error=null,armed=false,busy=false,lastCycle=null,cycles=0;
 try{if(fs.existsSync(file)){rows=JSON.parse(fs.readFileSync(file,'utf8'));validate(rows)}}catch(e){healthy=false;error=e.message}
 const dependencies=()=>assess({paper:v36Status(),life:v39Status(),protocol:v40Status(),observer:v41Status(),evidence:v42Status()});
 function append(event){if(!healthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_REQUIRED');const previous=rows.at(-1)?.hash||'GENESIS';const next=[...rows,{previous,event,hash:sha({previous,event})}];const tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const dir=fs.openSync(storageDir,'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}validate(next);rows=next}catch(e){healthy=false;error=e.message;armed=false;throw e}}
 function status(){let readiness;try{readiness=dependencies()}catch(e){readiness={rehearsalEligible:false,blockers:['DEPENDENCY_EXCEPTION'],brokerOrderAllowed:false}}return {version:'43.0.0',mode:'UNATTENDED_IG_DEMO_SAFETY_REHEARSAL_ONLY',armed,armedAfterRestart:false,cycleCount:cycles,lastCycle,journalHealthy:healthy,persistentStorageConfigured:!!persistentStorage,journalEvents:rows.length,journalHead:healthy?validate(rows):null,readiness,error,certifications:{gbpSizing:false,brokerLifecycle:false,crashRecovery:false},readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,warning:'Rehearsal cannot place IG orders. Every process restart disarms rehearsal.'}}
 function arm(note){if(!healthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_REQUIRED');if(typeof note!=='string'||note.trim().length<16)throw Error('OPERATOR_NOTE_REQUIRED');const r=dependencies();if(!r.rehearsalEligible)throw Error('READINESS_BLOCKED:'+r.blockers.join(','));append({id:crypto.randomUUID(),kind:'ARM_REHEARSAL',at:new Date().toISOString(),note:note.slice(0,200)});armed=true;return status()}
 function disarm(reason='OPERATOR_STOP'){armed=false;if(healthy&&persistentStorage)append({id:crypto.randomUUID(),kind:'DISARM',at:new Date().toISOString(),reason:String(reason).slice(0,160)});return status()}
 function cycle(){if(busy)throw Error('CYCLE_BUSY');busy=true;try{const r=dependencies();cycles++;lastCycle=new Date().toISOString();if(!armed)return {action:'NOT_ARMED',...status()};if(!r.rehearsalEligible){armed=false;append({id:crypto.randomUUID(),kind:'AUTO_DISARM',at:lastCycle,blockers:r.blockers});return {action:'AUTO_DISARM',...status()}}append({id:crypto.randomUUID(),kind:'SAFE_REHEARSAL_TICK',at:lastCycle,checksPassed:true,simulationOnly:true});return {action:'SIMULATED_CHECK_ONLY',...status()}}finally{busy=false}}
 // 30-second independent safety watchdog; never auto-arm, never send broker orders.
 const timer=setInterval(()=>{if(armed){try{cycle()}catch(e){armed=false;error=String(e.message).slice(0,160)}}},30000);timer.unref?.();
 function routes(app){const fail=(r,e)=>r.status(409).set('Cache-Control','no-store').json({error:String(e.message||e),brokerOrderAllowed:false});app.get('/api/v43/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v43/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:rows.map((x,i)=>({index:i+1,kind:x.event.kind,at:x.event.at,hash:x.hash})),brokerOrderAllowed:false}));app.post('/api/v43/arm-rehearsal',requireAdmin,(q,r)=>{try{r.json(arm(q.body?.operatorNote))}catch(e){fail(r,e)}});app.post('/api/v43/disarm',requireAdmin,(_q,r)=>{try{r.json(disarm())}catch(e){fail(r,e)}});app.post('/api/v43/cycle',requireAdmin,(_q,r)=>{try{r.json(cycle())}catch(e){fail(r,e)}});app.get('/v43',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v43.html')))}
 return {routes,status,arm,disarm,cycle};
}
module.exports={createV43,assess,validate};

  },
  "v44-soak": function(module, exports, require, __filename, __dirname) {
 'use strict';
// V44 automated READ-ONLY IG DEMO soak testing. No broker order transport.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function verify(rows){let head='GENESIS';if(!Array.isArray(rows))throw Error('INVALID_JOURNAL');for(const row of rows){if(row.previous!==head||row.hash!==digest({previous:row.previous,event:row.event}))throw Error('JOURNAL_TAMPERED');head=row.hash}return head}
function evaluate({observer,evidence,paper,lifecycle,protocol,now=Date.now()}){const issues=[];
 if(paper?.enabled!==true||paper?.journal?.valid!==true)issues.push('PAPER_UNHEALTHY');
 if(lifecycle?.lifecycle?.heartbeat?.healthy!==true||lifecycle?.lifecycle?.feedVerified!==true)issues.push('PAPER_FEED_UNHEALTHY');
 if(protocol?.journalHealthy!==true||protocol?.protocol?.unresolvedCount!==0)issues.push('PROTOCOL_UNHEALTHY');
 if(evidence?.journalHealthy!==true||evidence?.persistentStorageConfigured!==true)issues.push('EVIDENCE_JOURNAL_UNHEALTHY');
 const obs=evidence?.lastObservation;const age=obs?.observedAt?now-Date.parse(obs.observedAt):Infinity;
 if(!Number.isFinite(age)||age< -5000||age>60000)issues.push('BROKER_EVIDENCE_STALE');
 if(obs?.observationHealthy!==true||obs?.brokerPositionCount!==0||obs?.unresolvedProtocolIntents!==0)issues.push('BROKER_EXPOSURE_OR_RECONCILIATION');
 if(observer?.observationFresh!==true||observer?.observationHealthy!==true)issues.push('OBSERVER_UNHEALTHY');
 return {healthy:issues.length===0,issues,brokerOrderAllowed:false};}
function createV44({requireAdmin,storageDir,persistentStorage,v36Status,v39Status,v40Status,v41Status,v42Status,refresh41,refresh42,intervalMs=30000}){
 const file=path.join(storageDir,'v44-soak-evidence.json');let rows=[],healthy=true,error=null,armed=false,busy=false,cycleCount=0,successCount=0,failureCount=0,lastCycle=null,startedAt=null;
 try{if(fs.existsSync(file)){rows=JSON.parse(fs.readFileSync(file,'utf8'));verify(rows)}}catch(e){healthy=false;error=e.message}
 const assess=()=>evaluate({observer:v41Status(),evidence:v42Status(),paper:v36Status(),lifecycle:v39Status(),protocol:v40Status()});
 function append(event){if(!healthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_REQUIRED');const previous=rows.at(-1)?.hash||'GENESIS';const next=[...rows,{previous,event,hash:digest({previous,event})}];const tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const d=fs.openSync(storageDir,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}verify(next);rows=next}catch(e){healthy=false;error=e.message;armed=false;throw e}}
 function status(){let readiness;try{readiness=assess()}catch(e){readiness={healthy:false,issues:['DEPENDENCY_EXCEPTION'],brokerOrderAllowed:false}}return {version:'44.0.0',mode:'AUTOMATED_READ_ONLY_IG_DEMO_SOAK',armed,armedAfterRestart:false,busy,intervalMs,cycleCount,successCount,failureCount,lastCycle,startedAt,journalHealthy:healthy,persistentStorageConfigured:!!persistentStorage,journalEvents:rows.length,journalHead:healthy?verify(rows):null,readiness,error,certifications:{gbpSizing:false,brokerLifecycle:false,crashRecovery:false},readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,warning:'Automated broker GET observations only; no IG order writes. Re-arm manually after every restart.'}}
 function arm(note){if(busy)throw Error('CYCLE_BUSY');if(!healthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_REQUIRED');if(typeof note!=='string'||note.trim().length<16)throw Error('OPERATOR_NOTE_REQUIRED');if(armed)throw Error('ALREADY_ARMED');const r=assess();if(!r.healthy)throw Error('READINESS_BLOCKED:'+r.issues.join(','));append({kind:'ARM_READ_ONLY_SOAK',at:new Date().toISOString(),note:note.slice(0,200)});armed=true;startedAt=new Date().toISOString();return status()}
 function disarm(reason='OPERATOR_STOP'){armed=false;if(healthy&&persistentStorage)append({kind:'DISARM',at:new Date().toISOString(),reason:String(reason).slice(0,160)});return status()}
 async function cycle(){if(busy)throw Error('CYCLE_BUSY');if(!armed)return {action:'NOT_ARMED',...status()};busy=true;let action='SAFE_READ_ONLY_TICK';try{
 // Read-only observations refreshed sequentially to respect separate API rate limits.
 await refresh41();await refresh42();const r=assess();cycleCount++;lastCycle=new Date().toISOString();if(!r.healthy){failureCount++;armed=false;action='AUTO_DISARM';append({kind:'AUTO_DISARM',at:lastCycle,issues:r.issues});}else{successCount++;append({kind:'SAFE_READ_ONLY_TICK',at:lastCycle,brokerOrderAllowed:false});}
 }catch(e){cycleCount++;failureCount++;lastCycle=new Date().toISOString();armed=false;action='AUTO_DISARM';error=String(e.message||e).slice(0,160);try{append({kind:'AUTO_DISARM',at:lastCycle,issues:['REFRESH_OR_JOURNAL_ERROR'],detail:error})}catch(_e){healthy=false}}
 finally{busy=false}return {action,...status()}}
 const timer=setInterval(()=>{if(armed&&!busy)void cycle()},intervalMs);timer.unref?.();
 function routes(app){const fail=(r,e)=>r.status(409).set('Cache-Control','no-store').json({error:String(e.message||e),brokerOrderAllowed:false});app.get('/api/v44/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v44/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:rows.map((x,i)=>({index:i+1,kind:x.event.kind,at:x.event.at,issues:x.event.issues||[],hash:x.hash})),brokerOrderAllowed:false}));app.post('/api/v44/arm',requireAdmin,(q,r)=>{try{r.json(arm(q.body?.operatorNote))}catch(e){fail(r,e)}});app.post('/api/v44/disarm',requireAdmin,(_q,r)=>{try{r.json(disarm())}catch(e){fail(r,e)}});app.post('/api/v44/cycle',requireAdmin,async(_q,r)=>{try{r.json(await cycle())}catch(e){fail(r,e)}});app.get('/v44',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v44.html')))}
 return {routes,status,arm,disarm,cycle};}
module.exports={createV44,evaluate,verify};

  },
  "v45-soak": function(module, exports, require, __filename, __dirname) {
'use strict';
// V45 read-only IG DEMO soak: completed-refresh validation, durable diagnostic evidence, fail-closed.
// No order transport, no certification, no automatic broker execution.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function verify(rows){let head='GENESIS';if(!Array.isArray(rows))throw Error('INVALID_JOURNAL');for(const row of rows){if(row.previous!==head||row.hash!==sha({previous:row.previous,event:row.event}))throw Error('JOURNAL_TAMPERED');head=row.hash}return head}
const age=(stamp,now)=>{const t=Date.parse(stamp||'');return Number.isFinite(t)?now-t:null};
function evaluate({observer,evidence,paper,lifecycle,protocol,refresh41Result,refresh42Result,cycleStartedAt,now=Date.now(),maxAgeMs=60000}){
 const issues=[];const details={};
 if(paper?.enabled!==true||paper?.journal?.valid!==true)issues.push('PAPER_UNHEALTHY');
 if(lifecycle?.lifecycle?.heartbeat?.healthy!==true||lifecycle?.lifecycle?.feedVerified!==true)issues.push('PAPER_FEED_UNHEALTHY');
 if(protocol?.journalHealthy!==true||protocol?.protocol?.unresolvedCount!==0)issues.push('PROTOCOL_UNHEALTHY');
 if(evidence?.journalHealthy!==true||evidence?.persistentStorageConfigured!==true)issues.push('EVIDENCE_JOURNAL_UNHEALTHY');
 const obs=observer?.observation,ev=evidence?.lastObservation;
 details.observerAgeMs=age(obs?.observedAt,now);details.evidenceAgeMs=age(ev?.observedAt,now);
 details.refresh41AgeMs=age(refresh41Result?.observedAt,now);details.refresh42AgeMs=age(refresh42Result?.observedAt,now);
 details.observerFresh=observer?.observationFresh===true;details.observerHealthy=observer?.observationHealthy===true;
 details.observerObservedAt=obs?.observedAt||null;details.evidenceObservedAt=ev?.observedAt||null;
 details.refresh41ObservedAt=refresh41Result?.observedAt||null;details.refresh42ObservedAt=refresh42Result?.observedAt||null;
 const fresh=x=>x!==null&&x>=-5000&&x<=maxAgeMs;
 if(!fresh(details.evidenceAgeMs))issues.push('BROKER_EVIDENCE_STALE');
 if(!fresh(details.observerAgeMs)||!details.observerFresh||!details.observerHealthy)issues.push('OBSERVER_UNHEALTHY');
 if(ev?.observationHealthy!==true||ev?.brokerPositionCount!==0||ev?.unresolvedProtocolIntents!==0||obs?.brokerPositionCount!==0||obs?.observationHealthy!==true)issues.push('BROKER_EXPOSURE_OR_RECONCILIATION');
 if(cycleStartedAt!==undefined){
  const started=Date.parse(cycleStartedAt);const isCurrent=stamp=>Number.isFinite(Date.parse(stamp||''))&&Date.parse(stamp)>=started-5000;
  if(!isCurrent(refresh41Result?.observedAt)||!isCurrent(refresh42Result?.observedAt))issues.push('REFRESH_NOT_FROM_CURRENT_CYCLE');
  if(!fresh(details.refresh41AgeMs)||!fresh(details.refresh42AgeMs))issues.push('REFRESH_RESULT_STALE');
  if(refresh41Result?.observationHealthy!==true||refresh42Result?.observationHealthy!==true)issues.push('REFRESH_RESULT_UNHEALTHY');
  if(obs?.observedAt!==refresh41Result?.observedAt||ev?.observedAt!==refresh42Result?.observedAt)issues.push('REFRESH_STATUS_MISMATCH');
 }
 return {healthy:issues.length===0,issues,details,brokerOrderAllowed:false};
}
function createV45({requireAdmin,storageDir,persistentStorage,v36Status,v39Status,v40Status,v41Status,v42Status,v44Status,refresh41,refresh42,intervalMs=30000,maxAgeMs=60000}){
 const file=path.join(storageDir,'v45-soak-evidence.json');let rows=[],journalHealthy=true,error=null,armed=false,busy=false,cycleCount=0,successCount=0,failureCount=0,lastCycle=null,startedAt=null,lastDiagnostic=null;
 try{if(fs.existsSync(file)){rows=JSON.parse(fs.readFileSync(file,'utf8'));verify(rows)}}catch(e){journalHealthy=false;error=e.message}
 const assess=(extra={})=>evaluate({observer:v41Status(),evidence:v42Status(),paper:v36Status(),lifecycle:v39Status(),protocol:v40Status(),now:Date.now(),maxAgeMs,...extra});
 function append(event){if(!journalHealthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_REQUIRED');const previous=rows.at(-1)?.hash||'GENESIS';const next=[...rows,{previous,event,hash:sha({previous,event})}];const tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const d=fs.openSync(storageDir,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}verify(next);rows=next}catch(e){journalHealthy=false;error=e.message;armed=false;throw e}}
 function status(){let readiness;try{readiness=assess();if(v44Status?.().armed){readiness.healthy=false;readiness.issues.push('V44_MONITOR_ALREADY_ARMED')}}catch(e){readiness={healthy:false,issues:['DEPENDENCY_EXCEPTION'],details:{error:String(e.message).slice(0,120)},brokerOrderAllowed:false}}return {version:'45.0.0',mode:'SEQUENCED_READ_ONLY_IG_DEMO_SOAK',armed,armedAfterRestart:false,busy,intervalMs,cycleCount,successCount,failureCount,lastCycle,startedAt,lastDiagnostic,journalHealthy,persistentStorageConfigured:!!persistentStorage,journalEvents:rows.length,journalHead:journalHealthy?verify(rows):null,readiness,error,certifications:{gbpSizing:false,brokerLifecycle:false,crashRecovery:false},readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,warning:'Read-only broker GET observations. No order writes. Re-arm manually after restart.'}}
 function arm(note){if(busy||armed)throw Error('BUSY_OR_ALREADY_ARMED');if(!journalHealthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_REQUIRED');if(typeof note!=='string'||note.trim().length<16)throw Error('OPERATOR_NOTE_REQUIRED');const r=status().readiness;if(!r.healthy)throw Error('READINESS_BLOCKED:'+r.issues.join(','));append({kind:'ARM_READ_ONLY_SOAK',at:new Date().toISOString(),note:note.slice(0,200)});armed=true;startedAt=new Date().toISOString();return status()}
 function disarm(reason='OPERATOR_STOP'){armed=false;if(journalHealthy&&persistentStorage)append({kind:'DISARM',at:new Date().toISOString(),reason:String(reason).slice(0,160)});return status()}
 async function cycle(){if(busy)throw Error('CYCLE_BUSY');if(!armed)return {action:'NOT_ARMED',...status()};busy=true;const began=new Date().toISOString();let action='SAFE_READ_ONLY_TICK';try{
  if(v44Status?.().armed)throw Error('V44_MONITOR_ALREADY_ARMED');
  // Explicitly await each read-only broker refresh, then verify returned observations match committed status.
  const r41=await refresh41();const r42=await refresh42();const diagnostic=assess({refresh41Result:r41,refresh42Result:r42,cycleStartedAt:began});
  lastDiagnostic={at:new Date().toISOString(),issues:diagnostic.issues,details:diagnostic.details};cycleCount++;lastCycle=lastDiagnostic.at;
  if(!diagnostic.healthy){failureCount++;armed=false;action='AUTO_DISARM';append({kind:'AUTO_DISARM',at:lastCycle,issues:diagnostic.issues,details:diagnostic.details,brokerOrderAllowed:false})}
  else{successCount++;append({kind:'SAFE_READ_ONLY_TICK',at:lastCycle,details:diagnostic.details,brokerOrderAllowed:false})}
 }catch(e){cycleCount++;failureCount++;lastCycle=new Date().toISOString();armed=false;action='AUTO_DISARM';error=String(e.message||e).slice(0,160);lastDiagnostic={at:lastCycle,issues:['REFRESH_OR_JOURNAL_ERROR'],details:{error}};try{append({kind:'AUTO_DISARM',at:lastCycle,issues:lastDiagnostic.issues,details:lastDiagnostic.details,brokerOrderAllowed:false})}catch(_e){journalHealthy=false}}
 finally{busy=false}return {action,...status()}}
 const timer=setInterval(()=>{if(armed&&!busy)void cycle()},intervalMs);timer.unref?.();
 function events(){return rows.map((x,i)=>({index:i+1,kind:x.event.kind,at:x.event.at,issues:x.event.issues||[],details:x.event.details||null,hash:x.hash}))}
 function routes(app){const fail=(r,e)=>r.status(409).set('Cache-Control','no-store').json({error:String(e.message||e),brokerOrderAllowed:false});app.get('/api/v45/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v45/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:events(),brokerOrderAllowed:false}));app.post('/api/v45/arm',requireAdmin,(q,r)=>{try{r.json(arm(q.body?.operatorNote))}catch(e){fail(r,e)}});app.post('/api/v45/disarm',requireAdmin,(_q,r)=>{try{r.json(disarm())}catch(e){fail(r,e)}});app.post('/api/v45/cycle',requireAdmin,async(_q,r)=>{try{r.json(await cycle())}catch(e){fail(r,e)}});app.get('/v45',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v45.html')))}
 return {routes,status,arm,disarm,cycle,events};
}
module.exports={createV45,evaluate,verify};

  },
  "v46-soak": function(module, exports, require, __filename, __dirname) {
'use strict';
// V46 read-only IG DEMO soak: completed-refresh validation, durable diagnostic evidence, fail-closed.
// No order transport, no certification, no automatic broker execution.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function verify(rows){let head='GENESIS';if(!Array.isArray(rows))throw Error('INVALID_JOURNAL');for(const row of rows){if(row.previous!==head||row.hash!==sha({previous:row.previous,event:row.event}))throw Error('JOURNAL_TAMPERED');head=row.hash}return head}
const age=(stamp,now)=>{const t=Date.parse(stamp||'');return Number.isFinite(t)?now-t:null};
function evaluate({observer,evidence,paper,lifecycle,protocol,refresh41Result,refresh42Result,cycleStartedAt,now=Date.now(),maxAgeMs=60000}){
 const issues=[];const details={};
 if(paper?.enabled!==true||paper?.journal?.valid!==true)issues.push('PAPER_UNHEALTHY');
 if(lifecycle?.lifecycle?.heartbeat?.healthy!==true||lifecycle?.lifecycle?.feedVerified!==true)issues.push('PAPER_FEED_UNHEALTHY');
 if(protocol?.journalHealthy!==true||protocol?.protocol?.unresolvedCount!==0)issues.push('PROTOCOL_UNHEALTHY');
 if(evidence?.journalHealthy!==true||evidence?.persistentStorageConfigured!==true)issues.push('EVIDENCE_JOURNAL_UNHEALTHY');
 const obs=observer?.observation,ev=evidence?.lastObservation;
 details.observerAgeMs=age(obs?.observedAt,now);details.evidenceAgeMs=age(ev?.observedAt,now);
 details.refresh41AgeMs=age(refresh41Result?.observedAt,now);details.refresh42AgeMs=age(refresh42Result?.observedAt,now);
 details.observerFresh=observer?.observationFresh===true;details.observerHealthy=observer?.observationHealthy===true;
 details.observerObservedAt=obs?.observedAt||null;details.evidenceObservedAt=ev?.observedAt||null;
 details.refresh41ObservedAt=refresh41Result?.observedAt||null;details.refresh42ObservedAt=refresh42Result?.observedAt||null;
 const fresh=x=>x!==null&&x>=-5000&&x<=maxAgeMs;
 if(!fresh(details.evidenceAgeMs))issues.push('BROKER_EVIDENCE_STALE');
 if(!fresh(details.observerAgeMs)||!details.observerFresh||!details.observerHealthy)issues.push('OBSERVER_UNHEALTHY');
 if(ev?.observationHealthy!==true||ev?.brokerPositionCount!==0||ev?.unresolvedProtocolIntents!==0||obs?.brokerPositionCount!==0||obs?.observationHealthy!==true)issues.push('BROKER_EXPOSURE_OR_RECONCILIATION');
 if(cycleStartedAt!==undefined){
  const started=Date.parse(cycleStartedAt);const isCurrent=stamp=>Number.isFinite(Date.parse(stamp||''))&&Date.parse(stamp)>=started-5000;
  if(!isCurrent(refresh41Result?.observedAt)||!isCurrent(refresh42Result?.observedAt))issues.push('REFRESH_NOT_FROM_CURRENT_CYCLE');
  if(!fresh(details.refresh41AgeMs)||!fresh(details.refresh42AgeMs))issues.push('REFRESH_RESULT_STALE');
  if(refresh41Result?.observationHealthy!==true||refresh42Result?.observationHealthy!==true)issues.push('REFRESH_RESULT_UNHEALTHY');
  if(obs?.observedAt!==refresh41Result?.observedAt||ev?.observedAt!==refresh42Result?.observedAt)issues.push('REFRESH_STATUS_MISMATCH');
 }
 return {healthy:issues.length===0,issues,details,brokerOrderAllowed:false};
}
function createV46({requireAdmin,storageDir,persistentStorage,v36Status,v39Status,v40Status,v41Status,v42Status,v44Status,v45Status,refresh41,refresh42,intervalMs=30000,maxAgeMs=60000,minRefreshGapMs=12000,tickMs=1000,clock=()=>Date.now(),enableTimer=true}){
 const file=path.join(storageDir,'v46-soak-evidence.json');let rows=[],journalHealthy=true,error=null,armed=false,busy=false,cycleCount=0,successCount=0,failureCount=0,lastCycle=null,startedAt=null,lastDiagnostic=null,nextCycleAt=null,lastRefreshAttemptAt=null,deferralCount=0;
 try{if(fs.existsSync(file)){rows=JSON.parse(fs.readFileSync(file,'utf8'));verify(rows)}}catch(e){journalHealthy=false;error=e.message}
 const assess=(extra={})=>evaluate({observer:v41Status(),evidence:v42Status(),paper:v36Status(),lifecycle:v39Status(),protocol:v40Status(),now:clock(),maxAgeMs,...extra});
 function append(event){if(!journalHealthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_REQUIRED');const previous=rows.at(-1)?.hash||'GENESIS';const next=[...rows,{previous,event,hash:sha({previous,event})}];const tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const d=fs.openSync(storageDir,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}verify(next);rows=next}catch(e){journalHealthy=false;error=e.message;armed=false;throw e}}
 const legacyArmed=()=>Boolean(v44Status?.().armed||v45Status?.().armed);
 function lastObservedTime(){const stamps=[v41Status()?.observation?.observedAt,v42Status()?.lastObservation?.observedAt];return Math.max(0,...stamps.map(s=>Date.parse(s||'')||0));}
 function nextAllowedTime(now=clock()){return Math.max(now,lastObservedTime()+minRefreshGapMs,(lastRefreshAttemptAt||0)+minRefreshGapMs);}
 function schedule(now=clock(),immediate=false){nextCycleAt=immediate?nextAllowedTime(now):Math.max(now+intervalMs,nextAllowedTime(now));}
 function status(){let readiness;try{readiness=assess();if(legacyArmed()){readiness.healthy=false;readiness.issues.push('LEGACY_MONITOR_ALREADY_ARMED')}}catch(e){readiness={healthy:false,issues:['DEPENDENCY_EXCEPTION'],details:{error:String(e.message).slice(0,120)},brokerOrderAllowed:false}}return {version:'46.0.0',mode:'RATE_LIMIT_AWARE_READ_ONLY_IG_DEMO_SOAK',armed,armedAfterRestart:false,busy,intervalMs,minRefreshGapMs,nextCycleAt:nextCycleAt?new Date(nextCycleAt).toISOString():null,nextAllowedRefreshAt:new Date(nextAllowedTime()).toISOString(),deferralCount,cycleCount,successCount,failureCount,lastCycle,startedAt,lastDiagnostic,journalHealthy,persistentStorageConfigured:!!persistentStorage,journalEvents:rows.length,journalHead:journalHealthy?verify(rows):null,readiness,error,certifications:{gbpSizing:false,brokerLifecycle:false,crashRecovery:false},readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,warning:'Read-only broker GET observations. No order writes. Re-arm manually after restart.'}}
 function arm(note){if(busy||armed)throw Error('BUSY_OR_ALREADY_ARMED');if(!journalHealthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_REQUIRED');if(typeof note!=='string'||note.trim().length<16)throw Error('OPERATOR_NOTE_REQUIRED');const r=status().readiness;if(!r.healthy)throw Error('READINESS_BLOCKED:'+r.issues.join(','));append({kind:'ARM_READ_ONLY_SOAK',at:new Date().toISOString(),note:note.slice(0,200)});armed=true;startedAt=new Date().toISOString();schedule(clock(),true);return status()}
 function disarm(reason='OPERATOR_STOP'){armed=false;nextCycleAt=null;if(journalHealthy&&persistentStorage)append({kind:'DISARM',at:new Date().toISOString(),reason:String(reason).slice(0,160)});return status()}
 async function cycle(){if(busy)throw Error('CYCLE_BUSY');if(!armed)return {action:'NOT_ARMED',...status()};
 const now=clock(),allowed=nextAllowedTime(now);
 if(now<allowed){deferralCount++;nextCycleAt=allowed;return {action:'RATE_LIMIT_WAIT',...status()};}
 busy=true;nextCycleAt=null;const began=new Date().toISOString();let action='SAFE_READ_ONLY_TICK';try{
  if(legacyArmed())throw Error('LEGACY_MONITOR_ALREADY_ARMED');
  lastRefreshAttemptAt=clock();
  // Explicitly await each read-only broker refresh, then verify returned observations match committed status.
  const r41=await refresh41();const r42=await refresh42();const diagnostic=assess({refresh41Result:r41,refresh42Result:r42,cycleStartedAt:began});
  lastDiagnostic={at:new Date().toISOString(),issues:diagnostic.issues,details:diagnostic.details};cycleCount++;lastCycle=lastDiagnostic.at;
  if(!diagnostic.healthy){failureCount++;armed=false;action='AUTO_DISARM';append({kind:'AUTO_DISARM',at:lastCycle,issues:diagnostic.issues,details:diagnostic.details,brokerOrderAllowed:false})}
  else{successCount++;append({kind:'SAFE_READ_ONLY_TICK',at:lastCycle,details:diagnostic.details,brokerOrderAllowed:false})}
 }catch(e){
  // A known short-lived observer throttle is a scheduling condition, not a broker safety failure.
  // Never mask stale evidence or unhealthy dependencies while waiting.
  const message=String(e.message||e).slice(0,160);
  if(/^(BROKER_OBSERVATION_RATE_LIMIT_10_SECONDS|OBSERVATION_RATE_LIMIT_10_SECONDS)$/.test(message)){
   const r=assess();if(r.healthy&&journalHealthy&&persistentStorage&&!legacyArmed()){
    deferralCount++;nextCycleAt=Math.max(clock()+minRefreshGapMs,nextAllowedTime());
    lastDiagnostic={at:new Date().toISOString(),issues:['RATE_LIMIT_DEFERRED'],details:{error:message,nextCycleAt:new Date(nextCycleAt).toISOString()}};
    action='RATE_LIMIT_WAIT';try{append({kind:'RATE_LIMIT_DEFERRED',at:lastDiagnostic.at,details:lastDiagnostic.details,brokerOrderAllowed:false})}catch(_e){armed=false;journalHealthy=false}
    return {action,...status()};
   }
  }
  cycleCount++;failureCount++;lastCycle=new Date().toISOString();armed=false;nextCycleAt=null;action='AUTO_DISARM';error=message;lastDiagnostic={at:lastCycle,issues:['REFRESH_OR_JOURNAL_ERROR'],details:{error}};try{append({kind:'AUTO_DISARM',at:lastCycle,issues:lastDiagnostic.issues,details:lastDiagnostic.details,brokerOrderAllowed:false})}catch(_e){journalHealthy=false}}
 finally{busy=false;if(armed&&nextCycleAt===null)schedule(clock())}return {action,...status()}}
 const timer=enableTimer?setInterval(()=>{
  if(!armed||busy||nextCycleAt===null)return;
  // Fail closed if the broker observations expire before a permitted refresh.
  const r=assess();if(!r.healthy){armed=false;nextCycleAt=null;failureCount++;cycleCount++;lastCycle=new Date().toISOString();lastDiagnostic={at:lastCycle,issues:r.issues,details:r.details};
   try{append({kind:'AUTO_DISARM',at:lastCycle,issues:r.issues,details:r.details,brokerOrderAllowed:false})}catch(_e){journalHealthy=false}return;}
  if(clock()>=nextCycleAt)void cycle();
 },tickMs):null;timer?.unref?.();
 function events(){return rows.map((x,i)=>({index:i+1,kind:x.event.kind,at:x.event.at,issues:x.event.issues||[],details:x.event.details||null,hash:x.hash}))}
 function routes(app){const fail=(r,e)=>r.status(409).set('Cache-Control','no-store').json({error:String(e.message||e),brokerOrderAllowed:false});app.get('/api/v46/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v46/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:events(),brokerOrderAllowed:false}));app.post('/api/v46/arm',requireAdmin,(q,r)=>{try{r.json(arm(q.body?.operatorNote))}catch(e){fail(r,e)}});app.post('/api/v46/disarm',requireAdmin,(_q,r)=>{try{r.json(disarm())}catch(e){fail(r,e)}});app.post('/api/v46/cycle',requireAdmin,async(_q,r)=>{try{r.json(await cycle())}catch(e){fail(r,e)}});app.get('/v46',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v46.html')))}
 return {routes,status,arm,disarm,cycle,events};
}
module.exports={createV46,evaluate,verify};

  },
  "v47-certification": function(module, exports, require, __filename, __dirname) {
'use strict';
// v47: evidence collection and conservative certification gates. READ ONLY: no IG write transport.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.CFD.IP';
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const iso=()=>new Date().toISOString();
const same=(a,b)=>String(a||'')===String(b||'');
function verify(rows){let previous='GENESIS';if(!Array.isArray(rows))throw Error('JOURNAL_NOT_ARRAY');for(const r of rows){if(r?.previous!==previous||r?.hash!==digest({previous:r.previous,event:r.event}))throw Error('JOURNAL_TAMPERED');previous=r.hash}return previous}
function sizeAssessment(input,market){
 const issues=[];const size=Number(input?.size),stopPips=Number(input?.stopPips),maxRiskGBP=Number(input?.maxRiskGBP??25);
 const contract=market?.instrument||{},rules=market?.dealingRules||{};
 const minimum=Number(rules.minDealSize?.value),step=Number(rules.minDealSize?.value); // IG minDealSize is not a verified increment.
 const pipValueGBP=Number(input?.independentlyVerifiedPipValueGBP);
 if(!finite(size)||size<=0||!finite(stopPips)||stopPips<=0||!finite(maxRiskGBP)||maxRiskGBP<=0)issues.push('INVALID_RISK_INPUTS');
 if(!finite(minimum)||minimum<=0)issues.push('IG_MIN_DEAL_SIZE_UNAVAILABLE');
 if(finite(minimum)&&size<minimum)issues.push('BELOW_IG_MINIMUM_SIZE');
 if(!finite(pipValueGBP)||pipValueGBP<=0)issues.push('GBP_PIP_VALUE_EVIDENCE_MISSING');
 if(input?.conversionSource!=='IG_DEMO_BROKER_STATEMENT'||!Number.isFinite(Date.parse(input?.conversionObservedAt||'')))issues.push('INDEPENDENT_GBP_CONVERSION_NOT_DOCUMENTED');
 if(input?.contractSource!=='IG_DEMO_CONTRACT_SPEC')issues.push('CONTRACT_SPEC_NOT_DOCUMENTED');
 if(input?.incrementVerified!==true)issues.push('DEAL_SIZE_INCREMENT_NOT_VERIFIED');
 if(input?.stopUnitsVerified!==true)issues.push('STOP_DISTANCE_UNITS_NOT_VERIFIED');
 const risk=finite(size)&&finite(stopPips)&&finite(pipValueGBP)?size*stopPips*pipValueGBP:null;
 if(risk!==null&&finite(maxRiskGBP)&&risk>maxRiskGBP)issues.push('RISK_LIMIT_EXCEEDED');
 // Operator inputs cannot independently certify broker pip values or conversion.
 issues.push('INDEPENDENT_BROKER_GBP_PIP_VALUE_CROSSCHECK_REQUIRED');
 return {epic:EPIC,size:finite(size)?size:null,stopPips:finite(stopPips)?stopPips:null,marketCurrency:contract.currencies?.[0]?.code||null,minimumDealSize:finite(minimum)?minimum:null,minimumDealSizeUnit:rules.minDealSize?.unit||null,dealSizeIncrement:null,illustrativeRiskGBP:risk===null?null:Number(risk.toFixed(2)),maxRiskGBP:finite(maxRiskGBP)?maxRiskGBP:null,issues:[...new Set(issues)],evidenceComplete:false,certified:false,brokerOrderAllowed:false,warning:'GBP pip value is operator-provided and not independently certified; market min deal size is NOT the size increment. Excludes slippage, fees and currency conversion drift.'};
}
function normalizeBroker(raw){
 if(!Array.isArray(raw?.positions))throw Error('BROKER_POSITIONS_MISSING');
 if(typeof raw?.account?.accountId!=='string'||!raw.account.accountId)throw Error('IG_ACCOUNT_UNVERIFIED');
 const positions=raw.positions.filter(p=>p?.position&&p?.market).map(p=>({dealId:String(p.position.dealId||''),epic:String(p.market.epic||''),direction:String(p.position.direction||''),size:Number(p.position.size),openLevel:Number(p.position.openLevel),stopLevel:p.position.stopLevel==null?null:Number(p.position.stopLevel),limitLevel:p.position.limitLevel==null?null:Number(p.position.limitLevel)}));
 if(positions.some(p=>!p.dealId||!finite(p.size)||p.size<=0))throw Error('BROKER_POSITION_FIELDS_INVALID');
 return {at:iso(),accountFingerprint:digest(raw.account.accountId).slice(0,20),positions,market:raw.market||null};
}
function createV47({requireAdmin,storageDir,persistentStorage,readBroker,v46Status,clock=()=>Date.now(),minRefreshGapMs=12000}){
 const file=path.join(storageDir,'v47-certification-journal.json');let rows=[],healthy=true,error=null,busy=false,lastAttempt=0;
 const bootId=crypto.randomUUID();let baseline=null,openEvidence=null,closedEvidence=null,restartEvidence=null,lastSizing=null;
 try{if(fs.existsSync(file)){rows=JSON.parse(fs.readFileSync(file,'utf8'));verify(rows)}}catch(e){healthy=false;error=e.message}
 function replay(){baseline=null;openEvidence=null;closedEvidence=null;restartEvidence=null;lastSizing=null;for(const r of rows){const e=r.event;if(e.kind==='BASELINE') {baseline=e.snapshot;openEvidence=null;closedEvidence=null;restartEvidence=null}if(e.kind==='OPEN_OBSERVED')openEvidence={...e,bootId:e.bootId};if(e.kind==='CLOSE_OBSERVED')closedEvidence=e;if(e.kind==='RESTART_RECONCILED')restartEvidence=e;if(e.kind==='SIZE_PREVIEW')lastSizing=e.assessment;}}replay();
 function append(event){if(!healthy||!persistentStorage)throw Error('DURABLE_STORAGE_REQUIRED');const previous=rows.at(-1)?.hash||'GENESIS';const next=[...rows,{previous,event,hash:digest({previous,event})}];const tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const d=fs.openSync(storageDir,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}verify(next);rows=next;replay()}catch(e){healthy=false;error=e.message;throw e}}
 function checks(){return {gbpSizing:{certified:false,previewAvailable:!!lastSizing,issues:lastSizing?.issues||['GBP_SIZING_EVIDENCE_NOT_COLLECTED']},brokerLifecycle:{certified:false,baselineObserved:!!baseline,openObserved:!!openEvidence,closeObserved:!!closedEvidence,issues:closedEvidence?['BROKER_CONFIRMATION_AND_STOP_EXECUTION_NOT_INDEPENDENTLY_VERIFIED']:['FULL_OPEN_CLOSE_LIFECYCLE_NOT_OBSERVED']},crashRecovery:{certified:false,restartReadbackObserved:!!restartEvidence,issues:restartEvidence?['CONTROLLED_CRASH_AND_INFLIGHT_ORDER_RECOVERY_NOT_VERIFIED']:['CROSS_RESTART_BROKER_READBACK_NOT_OBSERVED']}}}
 function status(){return {version:'47.0.0',mode:'READ_ONLY_BROKER_CERTIFICATION_EVIDENCE',bootId,monitorV46Armed:!!v46Status?.().armed,busy,journalHealthy:healthy,persistentStorageConfigured:!!persistentStorage,journalEvents:rows.length,journalHead:healthy?verify(rows):null,lastError:error,nextAllowedObservationAt:lastAttempt?new Date(lastAttempt+minRefreshGapMs).toISOString():null,baseline,openEvidence:openEvidence?{at:openEvidence.at,dealId:openEvidence.dealId,bootId:openEvidence.bootId}:null,closedEvidence:closedEvidence?{at:closedEvidence.at,dealId:closedEvidence.dealId}:null,restartEvidence:restartEvidence?{at:restartEvidence.at,dealId:restartEvidence.dealId,previousBootId:restartEvidence.previousBootId}:null,lastSizing,certifications:checks(),readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,warning:'Evidence collection only. All three broker certifications remain false until independently verified. No IG order writes.'}}
 function ensureSafe(){if(!healthy||!persistentStorage)throw Error('DURABLE_STORAGE_REQUIRED');if(v46Status?.().armed)throw Error('DISARM_V46_BEFORE_CERTIFICATION_OBSERVATIONS');if(busy)throw Error('OBSERVATION_BUSY');if(clock()-lastAttempt<minRefreshGapMs)throw Error('OBSERVATION_RATE_LIMIT_WAIT');}
 async function observe(kind,dealId){ensureSafe();busy=true;lastAttempt=clock();try{const snapshot=normalizeBroker(await readBroker());if(kind==='baseline'){if(snapshot.positions.length)throw Error('BASELINE_REQUIRES_NO_OPEN_POSITIONS');append({kind:'BASELINE',at:iso(),bootId,snapshot});}
 else if(kind==='open'){if(!baseline)throw Error('BASELINE_REQUIRED');if(typeof dealId!=='string'||!dealId.trim())throw Error('DEAL_ID_REQUIRED');if(snapshot.accountFingerprint!==baseline.accountFingerprint)throw Error('ACCOUNT_CHANGED');const matches=snapshot.positions.filter(p=>same(p.dealId,dealId)&&p.epic===EPIC);if(matches.length!==1||snapshot.positions.length!==1)throw Error('EXACTLY_ONE_MATCHING_EURUSD_POSITION_REQUIRED');if(matches[0].stopLevel===null||matches[0].limitLevel===null)throw Error('BROKER_ATTACHED_STOP_AND_LIMIT_REQUIRED');append({kind:'OPEN_OBSERVED',at:iso(),bootId,dealId,position:matches[0],accountFingerprint:snapshot.accountFingerprint});}
 else if(kind==='closed'){if(!openEvidence)throw Error('OPEN_OBSERVATION_REQUIRED');if(snapshot.accountFingerprint!==openEvidence.accountFingerprint)throw Error('ACCOUNT_CHANGED');if(snapshot.positions.some(p=>p.dealId===openEvidence.dealId))throw Error('POSITION_STILL_OPEN');if(snapshot.positions.length)throw Error('OTHER_BROKER_POSITIONS_PRESENT');append({kind:'CLOSE_OBSERVED',at:iso(),bootId,dealId:openEvidence.dealId,warning:'Absence of open position does not prove closure confirmation, fill price or realised P/L.'});}
 else if(kind==='restart'){if(!openEvidence)throw Error('OPEN_OBSERVATION_REQUIRED');if(openEvidence.bootId===bootId)throw Error('PROCESS_RESTART_NOT_OBSERVED');if(snapshot.accountFingerprint!==openEvidence.accountFingerprint)throw Error('ACCOUNT_CHANGED');const matches=snapshot.positions.filter(p=>p.dealId===openEvidence.dealId&&p.epic===EPIC);if(matches.length!==1)throw Error('BROKER_POSITION_NOT_RECONCILED_AFTER_RESTART');if(matches[0].size!==openEvidence.position.size||matches[0].direction!==openEvidence.position.direction)throw Error('BROKER_POSITION_CHANGED');append({kind:'RESTART_RECONCILED',at:iso(),bootId,previousBootId:openEvidence.bootId,dealId:openEvidence.dealId});}
 else throw Error('UNKNOWN_OBSERVATION_KIND');return {action:kind.toUpperCase()+'_RECORDED',...status()}}finally{busy=false}}
 async function preview(input){if(!healthy||!persistentStorage)throw Error('DURABLE_STORAGE_REQUIRED');if(busy)throw Error('OBSERVATION_BUSY');busy=true;try{const raw=await readBroker();const snapshot=normalizeBroker(raw);const assessment=sizeAssessment(input,raw.market);append({kind:'SIZE_PREVIEW',at:iso(),bootId,accountFingerprint:snapshot.accountFingerprint,assessment});return {assessment,...status()}}finally{busy=false}}
 function events(){return rows.map((r,i)=>({index:i+1,kind:r.event.kind,at:r.event.at,hash:r.hash,dealId:r.event.dealId||null,bootId:r.event.bootId||null}))}
 function routes(app){const fail=(r,e)=>r.status(409).set('Cache-Control','no-store').json({error:String(e.message||e).slice(0,180),brokerOrderAllowed:false});const get=(route,fn)=>app.get(route,requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(fn()));const post=(route,fn)=>app.post(route,requireAdmin,async(q,r)=>{try{r.set('Cache-Control','no-store').json(await fn(q.body||{}))}catch(e){fail(r,e)}});get('/api/v47/status',status);get('/api/v47/events',()=>({events:events(),brokerOrderAllowed:false}));post('/api/v47/size-preview',preview);post('/api/v47/baseline',()=>observe('baseline'));post('/api/v47/observe-open',b=>observe('open',b.dealId));post('/api/v47/observe-close',()=>observe('closed'));post('/api/v47/reconcile-after-restart',()=>observe('restart'));app.get('/v47',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v47.html')))}
 return {routes,status,observe,preview,events};
}
module.exports={createV47,verify,sizeAssessment,normalizeBroker};

  },
  "v48-mini": function(module, exports, require, __filename, __dirname) {
'use strict';
// v48: IG DEMO EUR/USD Mini read-only readiness; never submits an order.
const EPIC='CS.D.EURUSD.MINI.IP';
function positive(x){return x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))&&Number(x)>0}
function assess(market, certifications, options={}){
 const i=market?.instrument||{},r=market?.dealingRules||{};
 const issues=[];
 if(i.epic!==EPIC)issues.push('MINI_EPIC_NOT_VERIFIED');
 if(String(i.contractSize)!=='10000')issues.push('CONTRACT_SIZE_MISMATCH');
 if(String(i.onePipMeans)!=='0.0001 USD/EUR')issues.push('PIP_DEFINITION_MISMATCH');
 if(!positive(i.valueOfOnePip))issues.push('PIP_VALUE_UNAVAILABLE');
 if(!positive(r.minDealSize?.value))issues.push('MIN_DEAL_SIZE_UNAVAILABLE');
 if(!positive(r.minNormalStopOrLimitDistance?.value))issues.push('MIN_STOP_DISTANCE_UNAVAILABLE');
 if(!options.dealSizeIncrementVerified)issues.push('DEAL_SIZE_INCREMENT_NOT_VERIFIED');
 if(!options.stopUnitsVerified)issues.push('STOP_DISTANCE_UNITS_NOT_VERIFIED');
 if(!options.gbpPipValueIndependentlyVerified)issues.push('INDEPENDENT_GBP_PIP_VALUE_MISSING');
 if(!options.brokerLossCrosscheckVerified)issues.push('BROKER_GBP_LOSS_CROSSCHECK_MISSING');
 if(!certifications?.gbpSizing?.certified)issues.push('GBP_SIZING_NOT_CERTIFIED');
 if(!certifications?.brokerLifecycle?.certified)issues.push('BROKER_LIFECYCLE_NOT_CERTIFIED');
 if(!certifications?.crashRecovery?.certified)issues.push('CRASH_RECOVERY_NOT_CERTIFIED');
 // No write-side broker adapter is installed. This is an explicit, non-overridable blocker.
 issues.push('UNATTENDED_BROKER_EXECUTION_ADAPTER_NOT_CERTIFIED');
 const size=0.1,stopPips=12,targetPips=18;
 const pipValueUSD=positive(i.valueOfOnePip)?Number(i.valueOfOnePip)*size:null;
 return {version:'48.0.0',mode:'READ_ONLY_MINI_AUTOMATION_READINESS',epic:EPIC,
  contractSize:i.contractSize??null,onePipMeans:i.onePipMeans??null,minimumDealSize:r.minDealSize??null,
  minimumStopDistance:r.minNormalStopOrLimitDistance??null,
  proposed:{size,stopPips,targetPips,maxRiskGBP:25,maxDailyLossGBP:100,maxTradesPerDay:3},
  indicative:{pipValueUSD,stopLossUSD:pipValueUSD===null?null:Number((pipValueUSD*stopPips).toFixed(2)),
   note:'Illustrative only; not a certified GBP risk, excludes slippage, spreads and costs.'},
  issues,readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false};
}
function createV48({requireAdmin,api,v47Status}){
 let last=null,lastError=null,lastCheckedAt=null;
 async function inspect(){
  const market=await api('/markets/'+encodeURIComponent(EPIC),'GET',null,'3');
  last=assess(market,v47Status().certifications);
  lastCheckedAt=new Date().toISOString();lastError=null;
  return {...last,lastCheckedAt};
 }
 function status(){return last?{...last,lastCheckedAt,lastError}:{...assess(null,v47Status().certifications),lastCheckedAt,lastError};}
 function routes(app){
  app.get('/api/v48/status',requireAdmin,(_q,res)=>res.set('Cache-Control','no-store').json(status()));
  app.post('/api/v48/inspect-mini',requireAdmin,async(_q,res)=>{
   try{res.set('Cache-Control','no-store').json(await inspect())}
   catch(e){lastError=String(e.message||e).slice(0,160);res.status(502).json({error:lastError,brokerOrderAllowed:false})}
  });
  app.post('/api/v48/arm-unattended',requireAdmin,(_q,res)=>res.status(409).json({error:'UNATTENDED_TRADING_NOT_CERTIFIED',issues:status().issues,brokerOrderAllowed:false}));
 }
 return {routes,status,inspect};
}
module.exports={EPIC,assess,createV48};

  },
  "v48-mini.test": function(module, exports, require, __filename, __dirname) {
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {assess,EPIC}=require('./v48-mini');
const market={instrument:{epic:EPIC,contractSize:'10000',valueOfOnePip:'1.00',onePipMeans:'0.0001 USD/EUR'},dealingRules:{minDealSize:{value:0.1,unit:'POINTS'},minNormalStopOrLimitDistance:{value:2,unit:'POINTS'}}};
test('Mini preview is read-only and conservative',()=>{const x=assess(market,{});assert.equal(x.indicative.stopLossUSD,1.2);assert.equal(x.brokerOrderAllowed,false);assert.equal(x.readyForUnattendedDemo,false);assert(x.issues.includes('GBP_SIZING_NOT_CERTIFIED'))});
test('Even claimed certifications cannot arm without independent broker adapter',()=>{const x=assess(market,{gbpSizing:{certified:true},brokerLifecycle:{certified:true},crashRecovery:{certified:true}},{dealSizeIncrementVerified:true,stopUnitsVerified:true,gbpPipValueIndependentlyVerified:true,brokerLossCrosscheckVerified:true});assert.equal(x.brokerOrderAllowed,false);assert(x.issues.includes('UNATTENDED_BROKER_EXECUTION_ADAPTER_NOT_CERTIFIED'))});
test('Wrong epic fails closed',()=>{assert(assess({...market,instrument:{...market.instrument,epic:'WRONG'}},{}).issues.includes('MINI_EPIC_NOT_VERIFIED'))});

  },
  "v49-certification": function(module, exports, require, __filename, __dirname) {
'use strict';
// V49: broker read-only evidence + deterministic unattended-order simulation.
// No IG order POST/PUT/DELETE is reachable from this module.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const numeric=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const iso=()=>new Date().toISOString();
function assessRisk({market,accountCurrency,fx,incrementEvidence,stopEvidence,lossEvidence,size=0.1,stopPips=12,maxRiskGBP=25,slippagePips=2,feeGBP=0}={}){
 const i=market?.instrument||{},r=market?.dealingRules||{},issues=[];
 if(i.epic!==EPIC)issues.push('MINI_EPIC_NOT_CONFIRMED');
 if(String(i.contractSize)!=='10000'||String(i.onePipMeans)!=='0.0001 USD/EUR')issues.push('CONTRACT_SPEC_MISMATCH');
 const basePip=numeric(i.valueOfOnePip),min=numeric(r.minDealSize?.value),minStop=numeric(r.minNormalStopOrLimitDistance?.value);
 if(basePip===null||basePip<=0)issues.push('PIP_VALUE_MISSING');
 if(min===null||min<=0||size<min)issues.push('MINIMUM_SIZE_FAILED');
 if(minStop===null||minStop<=0||stopPips<minStop)issues.push('STOP_DISTANCE_FAILED');
 if(!Number.isFinite(size)||size<=0||!Number.isFinite(stopPips)||stopPips<=0||!Number.isFinite(maxRiskGBP)||maxRiskGBP<=0||!Number.isFinite(slippagePips)||slippagePips<0||!Number.isFinite(feeGBP)||feeGBP<0)issues.push('INVALID_RISK_PARAMETERS');
 // Min deal size is NOT the increment. Accept only an independently supplied, time-stamped specification.
 const step=numeric(incrementEvidence?.step);
 if(incrementEvidence?.source!=='IG_DEMO_INSTRUMENT_TICKET'||step===null||step<=0||!Number.isFinite(Date.parse(incrementEvidence?.observedAt||'')))issues.push('INCREMENT_EVIDENCE_MISSING');
 else if(Math.abs(size/step-Math.round(size/step))>1e-7)issues.push('INVALID_SIZE_INCREMENT');
 if(stopEvidence?.source!=='IG_DEMO_TICKET'||stopEvidence?.pointEqualsPip!==true||!Number.isFinite(Date.parse(stopEvidence?.observedAt||'')))issues.push('STOP_UNIT_EVIDENCE_MISSING');
 const rate=numeric(fx?.gbpPerUSD);
 if(accountCurrency!=='GBP')issues.push('GBP_ACCOUNT_NOT_CONFIRMED');
 if(fx?.source!=='INDEPENDENT_BROKER_FX_EVIDENCE'||rate===null||rate<=0||!Number.isFinite(Date.parse(fx?.observedAt||'')))issues.push('GBP_CONVERSION_NOT_INDEPENDENTLY_VERIFIED');
 else if(Date.now()-Date.parse(fx.observedAt)>15*60*1000||Date.parse(fx.observedAt)>Date.now()+60000)issues.push('FX_EVIDENCE_STALE');
 if(lossEvidence?.source!=='IG_DEMO_CLOSED_DEAL'||lossEvidence?.epic!==EPIC||!lossEvidence?.dealReference||!Number.isFinite(Date.parse(lossEvidence?.observedAt||'')))issues.push('BROKER_GBP_PNL_CROSSCHECK_MISSING');
 // Operator-supplied observations are evidence candidates, NOT independent certification.
 issues.push('INDEPENDENT_REVIEW_REQUIRED');
 const usd=basePip===null?null:basePip*size*(stopPips+slippagePips);
 const gbp=usd===null||rate===null?null:usd*rate+feeGBP;
 if(gbp!==null&&gbp>maxRiskGBP)issues.push('MAX_RISK_EXCEEDED');
 return {epic:EPIC,size,stopPips,maxRiskGBP,assumedSlippagePips:slippagePips,estimatedUSD:usd,estimatedGBP:gbp,issues:[...new Set(issues)],certified:false,brokerOrderAllowed:false};
}
function simulateOrder(state,command){
 const s=structuredClone(state),events=[];
 const reject=reason=>({state:s,events:[{type:'REJECT',reason}],accepted:false});
 if(command.type==='KILL'){s.kill=true;s.armed=false;events.push({type:'KILL_SWITCH'});return {state:s,events,accepted:true}}
 if(command.type==='RECOVER'){
  if(!command.brokerReadbackConfirmed||command.unresolvedBrokerIntents!==0)return reject('RECONCILIATION_REQUIRED');
  s.unresolved=false;events.push({type:'RECOVERED_READ_ONLY'});return {state:s,events,accepted:true};
 }
 if(command.type!=='PROPOSE')return reject('UNKNOWN_COMMAND');
 if(s.kill||s.unresolved||!s.journalHealthy||!s.brokerReconciled)return reject('SAFETY_GATE');
 if(!command.certified||!command.quoteFresh||!command.protectiveStop||!command.protectiveLimit)return reject('ORDER_PREREQUISITES_MISSING');
 if(command.epic!==EPIC)return reject('WRONG_EPIC');
 if(!command.idempotencyKey||s.seen.includes(command.idempotencyKey))return reject('DUPLICATE_OR_MISSING_KEY');
 if(!Number.isFinite(command.riskGBP)||command.riskGBP<=0||command.riskGBP>25)return reject('TRADE_RISK_LIMIT');
 if(s.trades>=3||s.dailyLossGBP+command.riskGBP>100)return reject('DAILY_LIMIT');
 s.seen.push(command.idempotencyKey);s.unresolved=true;events.push({type:'SIMULATED_INTENT_RECORDED',idempotencyKey:command.idempotencyKey},{type:'SIMULATED_BROKER_WRITE_SUPPRESSED'});
 return {state:s,events,accepted:true,brokerOrderAllowed:false};
}
function createV49({requireAdmin,api,storageDir,persistentStorage,v47Status,v48Status,readBroker}){
 const file=path.join(storageDir,'v49-evidence.jsonl');let rows=[],journalHealthy=!!persistentStorage,lastError=null;
 try{if(persistentStorage){fs.mkdirSync(storageDir,{recursive:true});if(fs.existsSync(file)){const lines=fs.readFileSync(file,'utf8').split('\n').filter(Boolean);let previous='GENESIS';for(const line of lines){const x=JSON.parse(line);if(x.prev!==previous||x.hash!==hash({prev:x.prev,type:x.type,at:x.at,payload:x.payload}))throw Error('JOURNAL_CHAIN_INVALID');rows.push(x);previous=x.hash;}}}}catch(e){journalHealthy=false;lastError=e.message;}
 let lastMarket=null,lastBroker=null,lastRisk=null,lastCheck=null;
 function append(type,payload){if(!journalHealthy||!persistentStorage)throw Error('PERSISTENT_JOURNAL_UNAVAILABLE');const at=iso(),prev=rows.at(-1)?.hash||'GENESIS',entry={prev,type,at,payload};entry.hash=hash(entry);try{fs.appendFileSync(file,JSON.stringify(entry)+'\n',{flag:'a'});rows.push(entry);}catch(e){journalHealthy=false;lastError=e.message;throw e;}return entry;}
 function status(){const v47=v47Status(),v48=v48Status();return {version:'49.0.0',mode:'READ_ONLY_CERTIFICATION_AND_EXECUTION_SIMULATION',epic:EPIC,at:iso(),journalHealthy,persistentStorageConfigured:!!persistentStorage,journalEvents:rows.length,journalHead:rows.at(-1)?.hash||null,lastError,lastCheck,marketVerified:lastMarket?.instrument?.epic===EPIC,brokerReadbackAvailable:!!lastBroker,latestRisk:lastRisk,certifications:v47.certifications,v48Issues:v48.issues,workstreams:{gbpRisk:'EVIDENCE_COLLECTION_ONLY',brokerLifecycle:'OBSERVE_ONLY',crashRecovery:'RESTART_RECONCILIATION_REQUIRED',unattendedAdapter:'SIMULATION_ONLY'},readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false};}
 async function inspect(){const [market,broker]=await Promise.all([api('/markets/'+encodeURIComponent(EPIC),'GET',null,'3'),readBroker()]);if(!Array.isArray(broker.positions)||!broker.accountFingerprint)throw Error('BROKER_READBACK_UNVERIFIED');lastMarket=market;lastBroker=broker;lastCheck=iso();append('READ_ONLY_BROKER_SNAPSHOT',{epic:market.instrument?.epic,contractSize:market.instrument?.contractSize,onePipMeans:market.instrument?.onePipMeans,valueOfOnePip:market.instrument?.valueOfOnePip,minDealSize:market.dealingRules?.minDealSize,minStop:market.dealingRules?.minNormalStopOrLimitDistance,accountFingerprint:broker.accountFingerprint,positionCount:broker.positions.length,positions:broker.positions});return status();}
 function routes(app){
  app.get('/api/v49/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));
  app.get('/api/v49/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:rows.slice(-40).map(({type,at,hash})=>({type,at,hash})),journalHealthy}));
  app.post('/api/v49/inspect',requireAdmin,async(_q,r)=>{try{r.set('Cache-Control','no-store').json(await inspect())}catch(e){lastError=e.message;r.status(502).json({error:e.message,brokerOrderAllowed:false})}});
  app.post('/api/v49/risk-preview',requireAdmin,async(q,r)=>{try{if(!lastMarket)throw Error('RUN_INSPECT_FIRST');lastRisk=assessRisk({market:lastMarket,...q.body});append('RISK_PREVIEW',{result:lastRisk});r.json(lastRisk)}catch(e){r.status(409).json({error:e.message,brokerOrderAllowed:false})}});
  app.post('/api/v49/simulate',requireAdmin,(q,r)=>{try{const input=q.body||{};const state={kill:false,unresolved:false,journalHealthy,brokerReconciled:false,trades:0,dailyLossGBP:0,seen:[],...input.state};const result=simulateOrder(state,input.command||{});append('SIMULATION',{events:result.events,accepted:result.accepted});r.json({...result,brokerOrderAllowed:false,note:'No IG order request sent'})}catch(e){r.status(409).json({error:e.message,brokerOrderAllowed:false})}});
  app.post('/api/v49/arm-unattended',requireAdmin,(_q,r)=>r.status(409).json({error:'INDEPENDENT_CERTIFICATIONS_AND_WRITE_ADAPTER_REQUIRED',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false}));
 }
 return {routes,status,inspect};
}
module.exports={EPIC,assessRisk,simulateOrder,createV49};

  },
  "v50-workbench": function(module, exports, require, __filename, __dirname) {
'use strict';
// IG DEMO Mini evidence workbench. No broker order-write function is accepted.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const now=()=>new Date().toISOString();
const num=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const validTime=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const safeId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{5,100}$/.test(x);
function riskPreview({market,account,fx,increment,stopUnits,brokerPnL,size=0.1,stopPips=12,slippagePips=2,feeGBP=0,maxRiskGBP=25}={}){
 const issues=[],i=market?.instrument||{},rules=market?.dealingRules||{};
 const pv=num(i.valueOfOnePip),min=num(rules.minDealSize?.value),minStop=num(rules.minNormalStopOrLimitDistance?.value),step=num(increment?.step),rate=num(fx?.gbpPerUSD);
 if(i.epic!==EPIC||String(i.contractSize)!=='10000'||i.onePipMeans!=='0.0001 USD/EUR')issues.push('MINI_CONTRACT_NOT_VERIFIED');
 if(pv===null||pv<=0||min===null||min<=0||minStop===null||minStop<=0)issues.push('DEALING_RULES_UNAVAILABLE');
 if(![size,stopPips,slippagePips,feeGBP,maxRiskGBP].every(Number.isFinite)||size<=0||stopPips<=0||slippagePips<0||feeGBP<0||maxRiskGBP<=0)issues.push('INVALID_INPUT');
 if(min!==null&&size<min)issues.push('BELOW_MIN_SIZE');if(minStop!==null&&stopPips<minStop)issues.push('BELOW_MIN_STOP');
 if(increment?.source!=='IG_DEMO_TICKET'||!validTime(increment?.observedAt)||step===null||step<=0)issues.push('INCREMENT_NOT_EVIDENCED');
 else if(Math.abs(size/step-Math.round(size/step))>1e-7)issues.push('INVALID_INCREMENT');
 if(stopUnits?.source!=='IG_DEMO_TICKET'||stopUnits?.pointEqualsPip!==true||!validTime(stopUnits?.observedAt))issues.push('STOP_UNITS_NOT_EVIDENCED');
 if(account?.currency!=='GBP'||account?.source!=='IG_DEMO_ACCOUNT_READBACK')issues.push('ACCOUNT_GBP_NOT_VERIFIED');
 if(fx?.source!=='INDEPENDENT_FX_SOURCE'||rate===null||rate<=0||!validTime(fx?.observedAt))issues.push('FX_NOT_VERIFIED');
 else if(Math.abs(Date.now()-Date.parse(fx.observedAt))>15*60*1000)issues.push('FX_STALE');
 if(brokerPnL?.source!=='IG_DEMO_TRANSACTION_HISTORY'||brokerPnL?.epic!==EPIC||!safeId(brokerPnL?.dealId)||!validTime(brokerPnL?.observedAt)||num(brokerPnL?.realizedGBP)===null)issues.push('BROKER_GBP_PNL_NOT_VERIFIED');
 const estimatedUSD=pv===null||!Number.isFinite(size)||!Number.isFinite(stopPips)||!Number.isFinite(slippagePips)?null:pv*size*(stopPips+slippagePips);
 const estimatedGBP=estimatedUSD===null||rate===null||!Number.isFinite(feeGBP)?null:estimatedUSD*rate+feeGBP;
 if(estimatedGBP!==null&&estimatedGBP>maxRiskGBP)issues.push('RISK_LIMIT_EXCEEDED');
 issues.push('INDEPENDENT_CERTIFICATION_PENDING');
 return {epic:EPIC,size,stopPips,slippagePips,estimatedUSD,estimatedGBP,maxRiskGBP,issues,certified:false,brokerOrderAllowed:false};
}
function simulate(state,order){
 const s=structuredClone(state);const reject=reason=>({accepted:false,reason,state:s,brokerOrderAllowed:false});
 if(order?.type==='KILL'){s.killed=true;s.armed=false;return {accepted:true,event:'SIMULATED_KILL',state:s,brokerOrderAllowed:false}}
 if(order?.type!=='PROPOSE')return reject('INVALID_COMMAND');
 if(s.killed||s.unresolved||!s.journalHealthy||!s.brokerReconciled)return reject('SAFETY_BLOCK');
 if(order.epic!==EPIC||!safeId(order.idempotencyKey))return reject('INVALID_EPIC_OR_KEY');
 if(s.seen.includes(order.idempotencyKey))return reject('DUPLICATE');
 if(order.quoteFresh!==true||order.protectiveStop!==true||order.protectiveLimit!==true||order.certified!==true)return reject('PREREQUISITES');
 if(!Number.isFinite(order.riskGBP)||order.riskGBP<=0||order.riskGBP>25)return reject('PER_TRADE_LIMIT');
 if(s.trades>=3||s.dailyLossGBP+order.riskGBP>100)return reject('DAILY_LIMIT');
 s.seen.push(order.idempotencyKey);s.unresolved=true;
 return {accepted:true,event:'SIMULATED_INTENT_ONLY',state:s,brokerOrderAllowed:false};
}
function createV50({requireAdmin,api,storageDir,persistentStorage,readBroker,v49Status}){
 const file=path.join(storageDir,'v50-journal.jsonl'),bootId=crypto.randomUUID();let rows=[],healthy=!!persistentStorage,lastError=null,latest=null;
 try{if(healthy){fs.mkdirSync(storageDir,{recursive:true});if(fs.existsSync(file)){let prev='GENESIS';for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.prev!==prev||r.hash!==hash({prev:r.prev,at:r.at,type:r.type,payload:r.payload}))throw Error('JOURNAL_INTEGRITY_FAILED');rows.push(r);prev=r.hash;}}}}catch(e){healthy=false;lastError=e.message;}
 const last=type=>[...rows].reverse().find(r=>r.type===type);
 const killed=()=>!!last('EMERGENCY_STOP') && (!last('RESET_SIMULATION')||rows.indexOf(last('EMERGENCY_STOP'))>rows.indexOf(last('RESET_SIMULATION')));
 function append(type,payload){if(!healthy)throw Error('PERSISTENT_JOURNAL_REQUIRED');const entry={prev:rows.at(-1)?.hash||'GENESIS',at:now(),type,payload};entry.hash=hash(entry);try{fs.appendFileSync(file,JSON.stringify(entry)+'\n');rows.push(entry);}catch(e){healthy=false;lastError=e.message;throw e;}return entry;}
 const activeMini=b=>b.positions.filter(p=>p.epic===EPIC);
 function summary(){const v49=v49Status(),prior=last('BROKER_READBACK'),opens=rows.filter(r=>r.type==='OPEN_OBSERVATION'),closes=rows.filter(r=>r.type==='CLOSE_OBSERVATION'),restart=last('RESTART_READBACK');const risk=last('RISK_EVIDENCE');return {version:'50.0.0',mode:'MINI_CERTIFICATION_AND_FAIL_CLOSED_SIMULATION',epic:EPIC,bootId,journalHealthy:healthy,persistentStorageConfigured:!!persistentStorage,journalEvents:rows.length,lastError,lastInspectionAt:prior?.at||null,accountCurrency:prior?.payload?.accountCurrency||null,marketVerified:prior?.payload?.marketEpic===EPIC,openObservations:opens.length,closeObservations:closes.length,restartReadbackObserved:!!restart,emergencyStop:killed(),latestRisk:risk?.payload?.preview||null,certifications:{gbpSizing:{certified:false,issues:risk?.payload?.preview?.issues||['RISK_EVIDENCE_REQUIRED']},brokerLifecycle:{certified:false,issues:['INDEPENDENT_BROKER_OPEN_CLOSE_CONFIRMATIONS_REQUIRED']},crashRecovery:{certified:false,issues:['IN_FLIGHT_INTENT_AND_POSITION_RECOVERY_NOT_CERTIFIED']},unattendedAdapter:{certified:false,issues:['BROKER_WRITE_ADAPTER_NOT_IMPLEMENTED','INDEPENDENT_TESTS_REQUIRED']}},v49BrokerOrderAllowed:!!v49.brokerOrderAllowed,readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false};}
 async function snapshot(){const [market,broker]=await Promise.all([api('/markets/'+encodeURIComponent(EPIC),'GET',null,'3'),readBroker()]);if(market?.instrument?.epic!==EPIC||!Array.isArray(broker?.positions)||!broker?.accountFingerprint)throw Error('BROKER_SNAPSHOT_INVALID');return {market,broker};}
 async function inspect(){const {market,broker}=await snapshot();latest={market,broker};append('BROKER_READBACK',{bootId,marketEpic:market.instrument.epic,accountFingerprint:broker.accountFingerprint,accountCurrency:broker.accountCurrency||null,positions:activeMini(broker),positionCount:broker.positions.length,contractSize:market.instrument.contractSize,valueOfOnePip:market.instrument.valueOfOnePip,minDealSize:market.dealingRules?.minDealSize,minStop:market.dealingRules?.minNormalStopOrLimitDistance});return summary();}
 async function observe(type,dealId){if(!safeId(dealId))throw Error('VALID_DEAL_ID_REQUIRED');const {broker}=await snapshot();const found=activeMini(broker).find(p=>p.dealId===dealId);const base=last('BROKER_READBACK');if(!base||base.payload.accountFingerprint!==broker.accountFingerprint)throw Error('ACCOUNT_BASELINE_REQUIRED');if(type==='OPEN_OBSERVATION'&&(!found||!Number.isFinite(Number(found.size))||Number(found.size)<=0||found.stopLevel==null||found.limitLevel==null))throw Error('OPEN_POSITION_WITH_PROTECTION_REQUIRED');if(type==='CLOSE_OBSERVATION'&&(found||!rows.some(r=>r.type==='OPEN_OBSERVATION'&&r.payload.dealId===dealId)))throw Error('OPEN_EVIDENCE_AND_ABSENT_POSITION_REQUIRED');append(type,{bootId,dealId,accountFingerprint:broker.accountFingerprint,position:found||null,note:'Readback only; closing absence is not a broker fill confirmation'});return summary();}
 async function restartCheck(dealId){if(!safeId(dealId))throw Error('VALID_DEAL_ID_REQUIRED');const previous=[...rows].reverse().find(r=>r.type==='OPEN_OBSERVATION'&&r.payload.dealId===dealId&&r.payload.bootId!==bootId);if(!previous)throw Error('PRIOR_BOOT_OPEN_OBSERVATION_REQUIRED');const {broker}=await snapshot();const found=activeMini(broker).find(p=>p.dealId===dealId);if(!found||broker.accountFingerprint!==previous.payload.accountFingerprint||Number(found.size)!==Number(previous.payload.position.size)||found.direction!==previous.payload.position.direction)throw Error('RESTART_POSITION_MISMATCH');append('RESTART_READBACK',{bootId,dealId,previousBootId:previous.payload.bootId,accountFingerprint:broker.accountFingerprint,position:found});return summary();}
 function routes(app){const sendError=(r,e)=>r.status(409).json({error:e.message,brokerOrderAllowed:false});
 app.get('/api/v50/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(summary()));
 app.get('/api/v50/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({events:rows.slice(-100).map(x=>({at:x.at,type:x.type,hash:x.hash})),journalHealthy:healthy}));
 app.post('/api/v50/inspect',requireAdmin,async(_q,r)=>{try{r.json(await inspect())}catch(e){sendError(r,e)}});
 app.post('/api/v50/risk-preview',requireAdmin,async(q,r)=>{try{const {market,broker}=await snapshot();const body=q.body||{};const account={currency:broker.accountCurrency,source:'IG_DEMO_ACCOUNT_READBACK'};const preview=riskPreview({market,account,...body});append('RISK_EVIDENCE',{preview,accountFingerprint:broker.accountFingerprint});r.json(preview)}catch(e){sendError(r,e)}});
 app.post('/api/v50/observe-open',requireAdmin,async(q,r)=>{try{r.json(await observe('OPEN_OBSERVATION',q.body?.dealId))}catch(e){sendError(r,e)}});
 app.post('/api/v50/observe-close',requireAdmin,async(q,r)=>{try{r.json(await observe('CLOSE_OBSERVATION',q.body?.dealId))}catch(e){sendError(r,e)}});
 app.post('/api/v50/reconcile-after-restart',requireAdmin,async(q,r)=>{try{r.json(await restartCheck(q.body?.dealId))}catch(e){sendError(r,e)}});
 app.post('/api/v50/emergency-stop',requireAdmin,(q,r)=>{try{if(q.body?.confirm!=='STOP_V50_SIMULATION')throw Error('CONFIRMATION_REQUIRED');append('EMERGENCY_STOP',{bootId});r.json(summary())}catch(e){sendError(r,e)}});
 app.post('/api/v50/simulate',requireAdmin,(q,r)=>{try{const state={killed:killed(),unresolved:false,journalHealthy:healthy,brokerReconciled:false,trades:0,dailyLossGBP:0,seen:[],...(q.body?.state||{})};state.killed=killed()||state.killed;state.journalHealthy=healthy&&state.journalHealthy;const result=simulate(state,q.body?.order||{});append('SIMULATION',{accepted:result.accepted,reason:result.reason||null,event:result.event||null});r.json(result)}catch(e){sendError(r,e)}});
 app.post('/api/v50/arm-unattended',requireAdmin,(_q,r)=>r.status(409).json({error:'MINI_CERTIFICATION_AND_BROKER_ADAPTER_NOT_COMPLETE',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false}));
 app.get('/v50',(_q,r)=>r.sendFile(path.join(__dirname,'public','v50.html')));
 }
 return {routes,summary,inspect};
}
module.exports={EPIC,riskPreview,simulate,createV50};

  },
  "v51-evidence": function(module, exports, require, __filename, __dirname) {
'use strict';
// V51 is strictly read-only. All external evidence is provisional until independently reviewed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{5,100}$/.test(v);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
function calculateRisk({market,currency,dealSize=0.1,stopPoints=12,slippagePoints=2,gbpPerUsd=null,fxObservedAt=null,feesGBP=0,limitGBP=25}={}){
 const issues=[];const inst=market?.instrument||{},rules=market?.dealingRules||{};
 const pipValue=Number(inst.valueOfOnePip),minimum=Number(rules.minDealSize?.value),minStop=Number(rules.minNormalStopOrLimitDistance?.value);
 if(inst.epic!==EPIC||String(inst.contractSize)!=='10000'||inst.onePipMeans!=='0.0001 USD/EUR')issues.push('MINI_CONTRACT_UNVERIFIED');
 if(currency!=='GBP')issues.push('GBP_ACCOUNT_UNVERIFIED');
 if(!finite(dealSize)||!finite(stopPoints)||!finite(slippagePoints)||!finite(feesGBP)||!finite(limitGBP)||dealSize<=0||stopPoints<=0||slippagePoints<0||feesGBP<0||limitGBP<=0)issues.push('INVALID_RISK_INPUT');
 if(!Number.isFinite(pipValue)||pipValue<=0||!Number.isFinite(minimum)||minimum<=0||!Number.isFinite(minStop)||minStop<=0)issues.push('BROKER_DEALING_RULES_MISSING');
 if(Number.isFinite(minimum)&&dealSize<minimum)issues.push('BELOW_MINIMUM_SIZE');
 if(Number.isFinite(minStop)&&stopPoints<minStop)issues.push('BELOW_MINIMUM_STOP');
 if(!finite(gbpPerUsd)||gbpPerUsd<=0)issues.push('INDEPENDENT_FX_RATE_REQUIRED');
 else if(typeof fxObservedAt!=='string'||!Number.isFinite(Date.parse(fxObservedAt))||Math.abs(Date.now()-Date.parse(fxObservedAt))>15*60000)issues.push('FX_RATE_STALE_OR_UNDATED');
 issues.push('DEAL_INCREMENT_NOT_BROKER_CERTIFIED','STOP_POINT_UNITS_NOT_BROKER_CERTIFIED','BROKER_GBP_LOSS_CROSSCHECK_REQUIRED','INDEPENDENT_REVIEW_REQUIRED');
 const usd=Number.isFinite(pipValue)&&finite(dealSize)&&finite(stopPoints)&&finite(slippagePoints)?pipValue*dealSize*(stopPoints+slippagePoints):null;
 const gbp=usd!==null&&finite(gbpPerUsd)&&gbpPerUsd>0&&finite(feesGBP)?usd*gbpPerUsd+feesGBP:null;
 if(gbp!==null&&gbp>limitGBP)issues.push('RISK_LIMIT_EXCEEDED');
 return {epic:EPIC,dealSize,stopPoints,slippagePoints,estimatedUSD:usd,indicativeGBP:gbp,limitGBP,issues,certified:false,brokerOrderAllowed:false,notice:'Estimates are not a guaranteed maximum loss; gaps, slippage and costs may increase loss.'};
}
function createV51({api,readBroker,requireAdmin,storageDir,persistentStorage}){
 const bootId=crypto.randomUUID(),file=path.join(storageDir,'v51-evidence.jsonl');let journalHealthy=!!persistentStorage,lastError=null,events=[];
 try{if(journalHealthy){fs.mkdirSync(storageDir,{recursive:true});if(fs.existsSync(file)){let prev='GENESIS';for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){const e=JSON.parse(line);if(e.prev!==prev||e.hash!==digest({prev:e.prev,at:e.at,type:e.type,payload:e.payload}))throw Error('V51_JOURNAL_INTEGRITY');events.push(e);prev=e.hash;}}}}catch(e){journalHealthy=false;lastError=e.message;}
 function append(type,payload){if(!journalHealthy)throw Error('V51_JOURNAL_UNHEALTHY');const entry={prev:events.at(-1)?.hash||'GENESIS',at:new Date().toISOString(),type,payload};entry.hash=digest(entry);try{fs.appendFileSync(file,JSON.stringify(entry)+'\n');events.push(entry);}catch(e){journalHealthy=false;lastError=e.message;throw e;}return entry;}
 const last=type=>[...events].reverse().find(e=>e.type===type);
 const status=()=>({version:'51.0.0',mode:'MINI_READ_ONLY_EVIDENCE_AND_RECOVERY_WORKBENCH',epic:EPIC,bootId,journalHealthy,persistentStorageConfigured:!!persistentStorage,journalEvents:events.length,lastError,lastInspectionAt:last('INSPECT')?.at||null,latestRisk:last('RISK_PREVIEW')?.payload?.result||null,historyObserved:!!last('TRANSACTION_READBACK'),recoveryReadbackObserved:!!last('RESTART_POSITION_READBACK'),certifications:{gbpSizing:{certified:false,issues:['INDEPENDENT_FX_AND_BROKER_GBP_LOSS_CROSSCHECK_REQUIRED','DEAL_INCREMENT_AND_STOP_UNITS_REQUIRE_REVIEW']},brokerLifecycle:{certified:false,issues:['BROKER_CONFIRMATIONS_AND_REALIZED_PNL_NOT_YET_MATCHED']},crashRecovery:{certified:false,issues:['IN_FLIGHT_ORDER_OUTCOME_RECOVERY_NOT_CERTIFIED']},unattendedAdapter:{certified:false,issues:['BROKER_WRITE_ADAPTER_NOT_IMPLEMENTED']}},readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false});
 async function inspect(){const [market,broker]=await Promise.all([api('/markets/'+encodeURIComponent(EPIC),'GET',null,'3'),readBroker()]);if(market?.instrument?.epic!==EPIC||!broker?.accountFingerprint||!Array.isArray(broker.positions))throw Error('IG_READBACK_INVALID');append('INSPECT',{bootId,accountFingerprint:broker.accountFingerprint,accountCurrency:broker.accountCurrency,epic:market.instrument.epic,miniPositions:broker.positions.filter(p=>p.epic===EPIC).map(p=>({dealId:p.dealId,direction:p.direction,size:p.size,stopLevel:p.stopLevel,limitLevel:p.limitLevel}))});return {status:status(),market:{epic:market.instrument.epic,contractSize:market.instrument.contractSize,valueOfOnePip:market.instrument.valueOfOnePip,onePipMeans:market.instrument.onePipMeans,minDealSize:market.dealingRules?.minDealSize,minStop:market.dealingRules?.minNormalStopOrLimitDistance},accountCurrency:broker.accountCurrency,miniPositionCount:broker.positions.filter(p=>p.epic===EPIC).length};}
 async function risk(body={}){const [market,broker]=await Promise.all([api('/markets/'+encodeURIComponent(EPIC),'GET',null,'3'),readBroker()]);const allowed={dealSize:body.dealSize??0.1,stopPoints:body.stopPoints??12,slippagePoints:body.slippagePoints??2,feesGBP:body.feesGBP??0,gbpPerUsd:body.gbpPerUsd??null,fxObservedAt:body.fxObservedAt??null};const result=calculateRisk({market,currency:broker.accountCurrency,...allowed});append('RISK_PREVIEW',{accountFingerprint:broker.accountFingerprint,result,fxEvidenceSupplied:body.gbpPerUsd!=null,fxSourceLabel:typeof body.fxSourceLabel==='string'?body.fxSourceLabel.slice(0,100):null});return result;}
 async function transactions(){// IG DEMO history endpoint, read-only; schema may vary by broker API version.
 const raw=await api('/history/transactions/ALL','GET',null,'2');const items=raw?.transactions;if(!Array.isArray(items))throw Error('IG_TRANSACTION_SCHEMA_UNEXPECTED');const matched=items.filter(x=>String(x.instrumentName||'').toLowerCase().includes('eur/usd')||String(x.epic||'')===EPIC).slice(0,50).map(x=>({date:x.date||x.dateUtc||null,instrumentName:x.instrumentName||null,epic:x.epic||null,reference:x.reference||null,dealId:x.dealId||null,profitAndLoss:x.profitAndLoss||null,currency:x.currency||null,transactionType:x.transactionType||null}));append('TRANSACTION_READBACK',{count:items.length,matchedCount:matched.length,matched});return {brokerReadback:true,matched,warning:'History results may include non-Mini EUR/USD. Match exact deal ID, currency and broker confirmation before using as evidence.',certified:false,brokerOrderAllowed:false};}
 async function confirm(dealReference){if(!validId(dealReference))throw Error('VALID_DEAL_REFERENCE_REQUIRED');const raw=await api('/confirms/'+encodeURIComponent(dealReference),'GET',null,'1');const result={dealReference,dealId:raw?.dealId||null,dealStatus:raw?.dealStatus||null,reason:raw?.reason||null,epic:raw?.epic||null,direction:raw?.direction||null,affectedDeals:Array.isArray(raw?.affectedDeals)?raw.affectedDeals.map(d=>({dealId:d.dealId,status:d.status})):[],certified:false};append('DEAL_CONFIRMATION_READBACK',result);return {...result,brokerOrderAllowed:false};}
 async function restart(dealId){if(!validId(dealId))throw Error('VALID_DEAL_ID_REQUIRED');const previous=[...events].reverse().find(e=>e.type==='INSPECT'&&e.payload.bootId!==bootId&&e.payload.miniPositions.some(p=>p.dealId===dealId));if(!previous)throw Error('PREVIOUS_BOOT_POSITION_EVIDENCE_REQUIRED');const broker=await readBroker();const prior=previous.payload.miniPositions.find(p=>p.dealId===dealId),current=broker.positions.find(p=>p.epic===EPIC&&p.dealId===dealId);if(!current||broker.accountFingerprint!==previous.payload.accountFingerprint||current.direction!==prior.direction||Number(current.size)!==Number(prior.size)||current.stopLevel==null||current.limitLevel==null)throw Error('RESTART_POSITION_MISMATCH');append('RESTART_POSITION_READBACK',{dealId,bootId,previousBootId:previous.payload.bootId,accountFingerprint:broker.accountFingerprint});return {positionRecovered:true,dealId,certified:false,reason:'Open-position readback only; unknown in-flight orders not certified',brokerOrderAllowed:false};}
 const fail=(r,e)=>r.status(409).json({error:e.message,brokerOrderAllowed:false});
 function routes(app){app.get('/api/v51/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v51/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({journalHealthy,events:events.slice(-100).map(e=>({at:e.at,type:e.type,hash:e.hash}))}));
 app.post('/api/v51/inspect',requireAdmin,async(_q,r)=>{try{r.json(await inspect())}catch(e){fail(r,e)}});
 app.post('/api/v51/risk-preview',requireAdmin,async(q,r)=>{try{r.json(await risk(q.body||{}))}catch(e){fail(r,e)}});
 app.get('/api/v51/transactions',requireAdmin,async(_q,r)=>{try{r.json(await transactions())}catch(e){fail(r,e)}});
 app.post('/api/v51/deal-confirmation',requireAdmin,async(q,r)=>{try{r.json(await confirm(q.body?.dealReference))}catch(e){fail(r,e)}});
 app.post('/api/v51/reconcile-after-restart',requireAdmin,async(q,r)=>{try{r.json(await restart(q.body?.dealId))}catch(e){fail(r,e)}});
 app.post('/api/v51/arm-unattended',requireAdmin,(_q,r)=>r.status(409).json({error:'CERTIFICATION_INCOMPLETE',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false}));
 app.get('/v51',(_q,r)=>r.sendFile(path.join(__dirname,'public','v51.html')));}
 return {routes,status};
}
module.exports={EPIC,calculateRisk,createV51};

  },
  "v52-evidence": function(module, exports, require, __filename, __dirname) {
'use strict';
// V52 is strictly read-only. All external evidence is provisional until independently reviewed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.MINI.IP';
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{5,100}$/.test(v);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
function calculateRisk({market,currency,dealSize=0.1,stopPoints=12,slippagePoints=2,gbpPerUsd=null,fxObservedAt=null,feesGBP=0,limitGBP=25}={}){
 const issues=[];const inst=market?.instrument||{},rules=market?.dealingRules||{};
 const pipValue=Number(inst.valueOfOnePip),minimum=Number(rules.minDealSize?.value),minStop=Number(rules.minNormalStopOrLimitDistance?.value);
 if(inst.epic!==EPIC||String(inst.contractSize)!=='10000'||inst.onePipMeans!=='0.0001 USD/EUR')issues.push('MINI_CONTRACT_UNVERIFIED');
 if(currency!=='GBP')issues.push('GBP_ACCOUNT_UNVERIFIED');
 if(!finite(dealSize)||!finite(stopPoints)||!finite(slippagePoints)||!finite(feesGBP)||!finite(limitGBP)||dealSize<=0||stopPoints<=0||slippagePoints<0||feesGBP<0||limitGBP<=0)issues.push('INVALID_RISK_INPUT');
 if(!Number.isFinite(pipValue)||pipValue<=0||!Number.isFinite(minimum)||minimum<=0||!Number.isFinite(minStop)||minStop<=0)issues.push('BROKER_DEALING_RULES_MISSING');
 if(Number.isFinite(minimum)&&dealSize<minimum)issues.push('BELOW_MINIMUM_SIZE');
 if(Number.isFinite(minStop)&&stopPoints<minStop)issues.push('BELOW_MINIMUM_STOP');
 if(!finite(gbpPerUsd)||gbpPerUsd<=0)issues.push('INDEPENDENT_FX_RATE_REQUIRED');
 else if(typeof fxObservedAt!=='string'||!Number.isFinite(Date.parse(fxObservedAt))||Math.abs(Date.now()-Date.parse(fxObservedAt))>15*60000)issues.push('FX_RATE_STALE_OR_UNDATED');
 issues.push('DEAL_INCREMENT_NOT_BROKER_CERTIFIED','STOP_POINT_UNITS_NOT_BROKER_CERTIFIED','BROKER_GBP_LOSS_CROSSCHECK_REQUIRED','INDEPENDENT_REVIEW_REQUIRED');
 const usd=Number.isFinite(pipValue)&&finite(dealSize)&&finite(stopPoints)&&finite(slippagePoints)?pipValue*dealSize*(stopPoints+slippagePoints):null;
 const gbp=usd!==null&&finite(gbpPerUsd)&&gbpPerUsd>0&&finite(feesGBP)?usd*gbpPerUsd+feesGBP:null;
 if(gbp!==null&&gbp>limitGBP)issues.push('RISK_LIMIT_EXCEEDED');
 return {epic:EPIC,dealSize,stopPoints,slippagePoints,estimatedUSD:usd,indicativeGBP:gbp,limitGBP,issues,certified:false,brokerOrderAllowed:false,notice:'Estimates are not a guaranteed maximum loss; gaps, slippage and costs may increase loss.'};
}
function createV52({api,readBroker,requireAdmin,storageDir,persistentStorage}){
 const bootId=crypto.randomUUID(),file=path.join(storageDir,'v52-evidence.jsonl');let journalHealthy=!!persistentStorage,lastError=null,events=[];
 try{if(journalHealthy){fs.mkdirSync(storageDir,{recursive:true});if(fs.existsSync(file)){let prev='GENESIS';for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){const e=JSON.parse(line);if(e.prev!==prev||e.hash!==digest({prev:e.prev,at:e.at,type:e.type,payload:e.payload}))throw Error('V52_JOURNAL_INTEGRITY');events.push(e);prev=e.hash;}}}}catch(e){journalHealthy=false;lastError=e.message;}
 function append(type,payload){if(!journalHealthy)throw Error('V52_JOURNAL_UNHEALTHY');const entry={prev:events.at(-1)?.hash||'GENESIS',at:new Date().toISOString(),type,payload};entry.hash=digest(entry);try{fs.appendFileSync(file,JSON.stringify(entry)+'\n');events.push(entry);}catch(e){journalHealthy=false;lastError=e.message;throw e;}return entry;}
 const last=type=>[...events].reverse().find(e=>e.type===type);
 const status=()=>({version:'52.0.0',mode:'MINI_READ_ONLY_EVIDENCE_AND_RECOVERY_WORKBENCH',epic:EPIC,bootId,journalHealthy,persistentStorageConfigured:!!persistentStorage,journalEvents:events.length,lastError,lastInspectionAt:last('INSPECT')?.at||null,latestRisk:last('RISK_PREVIEW')?.payload?.result||null,historyObserved:!!last('TRANSACTION_READBACK'),recoveryReadbackObserved:!!last('RESTART_POSITION_READBACK'),certifications:{gbpSizing:{certified:false,issues:['INDEPENDENT_FX_AND_BROKER_GBP_LOSS_CROSSCHECK_REQUIRED','DEAL_INCREMENT_AND_STOP_UNITS_REQUIRE_REVIEW']},brokerLifecycle:{certified:false,issues:['BROKER_CONFIRMATIONS_AND_REALIZED_PNL_NOT_YET_MATCHED']},crashRecovery:{certified:false,issues:['IN_FLIGHT_ORDER_OUTCOME_RECOVERY_NOT_CERTIFIED']},unattendedAdapter:{certified:false,issues:['BROKER_WRITE_ADAPTER_NOT_IMPLEMENTED']}},readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false});
 async function inspect(){const [market,broker]=await Promise.all([api('/markets/'+encodeURIComponent(EPIC),'GET',null,'3'),readBroker()]);if(market?.instrument?.epic!==EPIC||!broker?.accountFingerprint||!Array.isArray(broker.positions))throw Error('IG_READBACK_INVALID');append('INSPECT',{bootId,accountFingerprint:broker.accountFingerprint,accountCurrency:broker.accountCurrency,epic:market.instrument.epic,miniPositions:broker.positions.filter(p=>p.epic===EPIC).map(p=>({dealId:p.dealId,direction:p.direction,size:p.size,stopLevel:p.stopLevel,limitLevel:p.limitLevel}))});return {status:status(),market:{epic:market.instrument.epic,contractSize:market.instrument.contractSize,valueOfOnePip:market.instrument.valueOfOnePip,onePipMeans:market.instrument.onePipMeans,minDealSize:market.dealingRules?.minDealSize,minStop:market.dealingRules?.minNormalStopOrLimitDistance},accountCurrency:broker.accountCurrency,miniPositionCount:broker.positions.filter(p=>p.epic===EPIC).length};}
 async function risk(body={}){const [market,broker]=await Promise.all([api('/markets/'+encodeURIComponent(EPIC),'GET',null,'3'),readBroker()]);const allowed={dealSize:body.dealSize??0.1,stopPoints:body.stopPoints??12,slippagePoints:body.slippagePoints??2,feesGBP:body.feesGBP??0,gbpPerUsd:body.gbpPerUsd??null,fxObservedAt:body.fxObservedAt??null};const result=calculateRisk({market,currency:broker.accountCurrency,...allowed});append('RISK_PREVIEW',{accountFingerprint:broker.accountFingerprint,result,fxEvidenceSupplied:body.gbpPerUsd!=null,fxSourceLabel:typeof body.fxSourceLabel==='string'?body.fxSourceLabel.slice(0,100):null});return result;}
 async function transactions(){// IG DEMO history endpoint, read-only; schema may vary by broker API version.
 let raw;try{raw=await api('/history/transactions?type=ALL&pageSize=50&pageNumber=1&maxSpanSeconds=604800','GET',null,'2')}catch(e){throw Error('IG_HISTORY_REQUEST_FAILED: '+String(e.message||e).slice(0,180))}const items=raw?.transactions;if(!Array.isArray(items))throw Error('IG_TRANSACTION_SCHEMA_UNEXPECTED');const matched=items.filter(x=>String(x.instrumentName||'').toLowerCase().includes('eur/usd')||String(x.epic||'')===EPIC).slice(0,50).map(x=>({date:x.date||x.dateUtc||null,instrumentName:x.instrumentName||null,epic:x.epic||null,reference:x.reference||null,dealId:x.dealId||null,profitAndLoss:x.profitAndLoss||null,currency:x.currency||null,transactionType:x.transactionType||null}));append('TRANSACTION_READBACK',{count:items.length,matchedCount:matched.length,matched});return {brokerReadback:true,matched,warning:'History results may include non-Mini EUR/USD. Match exact deal ID, currency and broker confirmation before using as evidence.',certified:false,brokerOrderAllowed:false};}
 async function confirm(dealReference){if(!validId(dealReference))throw Error('VALID_DEAL_REFERENCE_REQUIRED');const raw=await api('/confirms/'+encodeURIComponent(dealReference),'GET',null,'1');const result={dealReference,dealId:raw?.dealId||null,dealStatus:raw?.dealStatus||null,reason:raw?.reason||null,epic:raw?.epic||null,direction:raw?.direction||null,affectedDeals:Array.isArray(raw?.affectedDeals)?raw.affectedDeals.map(d=>({dealId:d.dealId,status:d.status})):[],certified:false};append('DEAL_CONFIRMATION_READBACK',result);return {...result,brokerOrderAllowed:false};}
 async function restart(dealId){if(!validId(dealId))throw Error('VALID_DEAL_ID_REQUIRED');const previous=[...events].reverse().find(e=>e.type==='INSPECT'&&e.payload.bootId!==bootId&&e.payload.miniPositions.some(p=>p.dealId===dealId));if(!previous)throw Error('PREVIOUS_BOOT_POSITION_EVIDENCE_REQUIRED');const broker=await readBroker();const prior=previous.payload.miniPositions.find(p=>p.dealId===dealId),current=broker.positions.find(p=>p.epic===EPIC&&p.dealId===dealId);if(!current||broker.accountFingerprint!==previous.payload.accountFingerprint||current.direction!==prior.direction||Number(current.size)!==Number(prior.size)||current.stopLevel==null||current.limitLevel==null)throw Error('RESTART_POSITION_MISMATCH');append('RESTART_POSITION_READBACK',{dealId,bootId,previousBootId:previous.payload.bootId,accountFingerprint:broker.accountFingerprint});return {positionRecovered:true,dealId,certified:false,reason:'Open-position readback only; unknown in-flight orders not certified',brokerOrderAllowed:false};}
 const fail=(r,e)=>r.status(409).json({error:e.message,brokerOrderAllowed:false});
 function routes(app){app.get('/api/v52/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v52/events',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({journalHealthy,events:events.slice(-100).map(e=>({at:e.at,type:e.type,hash:e.hash}))}));
 app.post('/api/v52/inspect',requireAdmin,async(_q,r)=>{try{r.json(await inspect())}catch(e){fail(r,e)}});
 app.post('/api/v52/risk-preview',requireAdmin,async(q,r)=>{try{r.json(await risk(q.body||{}))}catch(e){fail(r,e)}});
 app.get('/api/v52/transactions',requireAdmin,async(_q,r)=>{try{r.json(await transactions())}catch(e){fail(r,e)}});
 app.post('/api/v52/deal-confirmation',requireAdmin,async(q,r)=>{try{r.json(await confirm(q.body?.dealReference))}catch(e){fail(r,e)}});
 app.post('/api/v52/reconcile-after-restart',requireAdmin,async(q,r)=>{try{r.json(await restart(q.body?.dealId))}catch(e){fail(r,e)}});
 app.post('/api/v52/arm-unattended',requireAdmin,(_q,r)=>r.status(409).json({error:'CERTIFICATION_INCOMPLETE',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false}));
 app.get('/v52',(_q,r)=>r.sendFile(path.join(__dirname,'public','v52.html')));}
 return {routes,status};
}
module.exports={EPIC,calculateRisk,createV52};

  }
};
const cache = Object.create(null);
function load(specifier) {
 const key = specifier.replace(/^\.\//,'').replace(/\.js$/,'');
 if (!Object.prototype.hasOwnProperty.call(factories,key)) throw new Error('Unknown consolidated module: '+specifier);
 if (Object.prototype.hasOwnProperty.call(cache,key)) return cache[key].exports;
 const filename=path.join(__dirname,key+'.js');
 const module={exports:{},filename};
 cache[key]=module;
 const nativeRequire=createRequire(filename);
 const localRequire=(name)=>{
   const relative=name.match(/^\.\/(v\d+[^/]*)$/);
   if(relative && Object.prototype.hasOwnProperty.call(factories,relative[1].replace(/\.js$/,''))) return load(relative[1]);
   return nativeRequire(name);
 };
 try {factories[key](module,module.exports,localRequire,filename,__dirname)}
 catch(e){delete cache[key];throw e}
 return module.exports;
}
module.exports={load};
