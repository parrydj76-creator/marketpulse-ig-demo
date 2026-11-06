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
