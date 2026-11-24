'use strict';
require('dotenv').config();
const express=require('express'), path=require('path'), fs=require('fs');
const {LightstreamerClient,Subscription}=require('lightstreamer-client-node');
const {summarizeFeed,feedFresh}=require('./feed-health');
// Startup memory diagnostics (no broker execution changes).
const startupMemoryTimer = setInterval(() => {
  const m = process.memoryUsage();
  console.log('[MEMORY_SAMPLE]', JSON.stringify({rssMB:Math.round(m.rss/1048576),heapUsedMB:Math.round(m.heapUsed/1048576),heapTotalMB:Math.round(m.heapTotal/1048576),externalMB:Math.round(m.external/1048576),arrayBuffersMB:Math.round((m.arrayBuffers||0)/1048576),uptimeSeconds:Math.round(process.uptime())}));
}, 60000);
startupMemoryTimer.unref();
const APP_VERSION='30.0.0';
const v150Transport=require('./marketpulse-v150-transport');
const LEGACY_MINI_BACKGROUND=false;
const LEGACY_PAPER_BACKGROUND=process.env.MP_LEGACY_PAPER_BACKGROUND==='true';
const v200=require('./marketpulse-v200-core');
if(process.env.IG_ACCOUNT_TYPE!=='DEMO')throw Error('Refusing to start: IG_ACCOUNT_TYPE must equal DEMO');
const app=express();app.use(express.json({limit:'12kb'}));app.use(express.static(path.join(__dirname,'public')));
const HOST='https://demo-api.ig.com/gateway/deal';
// Fixed allowlist: no IG market search calls at startup.
const MAJOR_FOREX = Object.freeze([
 ['EURUSD','EUR/USD'],['GBPUSD','GBP/USD'],['USDJPY','USD/JPY'],
 ['USDCHF','USD/CHF'],['USDCAD','USD/CAD'],['AUDUSD','AUD/USD'],['NZDUSD','NZD/USD']
].map(([pair,name])=>({epic:`CS.D.${pair}.CFD.IP`,name})));
const MAJOR_EPICS=new Set(MAJOR_FOREX.map(x=>x.epic));

const FIVE=300000, MAX=7;
const MAX_DISCOVERY_NODES=Math.min(100,Math.max(1,Number(process.env.DISCOVERY_NODE_LIMIT)||45));
const MAX_DISCOVERY_MARKETS=Math.min(500,Math.max(1,Number(process.env.DISCOVERY_MARKET_LIMIT)||150));
const configEpics=MAJOR_FOREX.map(x=>x.epic); // IG_EPICS cannot override the major-pair allowlist
const MULTI_MODE=false;
const TEST_ONE=false;
const PROBE_MINI=false; // No MINI instruments in major-only mode
const PROBE_ACCOUNT=process.env.PROBE_ACCOUNT_STREAM!=='false';
const REST_POLL_SECONDS=Math.min(600,Math.max(120,Number(process.env.REST_POLL_SECONDS)||300));
const REST_MAX_MARKETS=Math.min(2,Math.max(1,Number(process.env.REST_MAX_MARKETS)||1));
const REST_STALE_MS=REST_POLL_SECONDS*2500;
// Explicit operator opt-in: defaults to monitor-only even when a user arms the UI.
const BROKER_DEMO_EXECUTION=false; // v61 GLOBAL fail-closed: broker writes remain disabled irrespective of env settings; // IG DEMO only; multi-engine gates still apply
const AUTO_START=false; // no legacy auto-start
const DEMO_EXECUTION_TESTED=process.env.IG_DEMO_ORDER_LIFECYCLE_VERIFIED==='true'; // Set only after observed IG demo open, attached stops, close, restart recovery
const VERIFIED_MIN_SIZE=Number(process.env.IG_VERIFIED_MIN_SIZE||0); // Must be confirmed against IG /markets dealingRules
const VERIFIED_STOP_UNITS=process.env.IG_VERIFIED_STOP_UNITS==='true';
// V4.0: hard DEMO-only, armed only via authenticated admin endpoint; never auto-arm on boot.
const TRADE_EPIC=process.env.TRADE_EPIC||'CS.D.EURUSD.CFD.IP';
if(!MAJOR_EPICS.has(TRADE_EPIC))throw Error('TRADE_EPIC must be an approved major forex CFD');
let TRADE_SIZE=Number(process.env.DEMO_TRADE_SIZE||0);
let TRADE_STOP_DISTANCE=Number(process.env.DEMO_STOP_DISTANCE||0);
let TRADE_LIMIT_DISTANCE=Number(process.env.DEMO_LIMIT_DISTANCE||0);
let TRADE_MIN_SCORE=Math.max(65,Math.min(90,Number(process.env.DEMO_MIN_SCORE)||70));
let TRADE_MAX_SPREAD=Number(process.env.DEMO_MAX_SPREAD||0);
let TRADE_MAX_HOLD_MINUTES=Math.max(15,Math.min(1440,Number(process.env.DEMO_MAX_HOLD_MINUTES)||180));
let TRADE_COOLDOWN_MINUTES=Math.max(5,Math.min(1440,Number(process.env.DEMO_COOLDOWN_MINUTES)||30));
let TRADE_DAILY_CAP=Math.max(1,Math.min(3,Number(process.env.DEMO_DAILY_CAP)||2));
const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'data');
const TRADE_STATE_PATH=process.env.TRADE_STATE_PATH||path.join(DATA_DIR,'trade-state.json');
const CANDLE_STATE_PATH=path.join(DATA_DIR,'stream-candles.json');
const RISK_STATE_PATH=path.join(DATA_DIR,'risk.json');
const PERSISTENT_STORAGE=process.env.PERSISTENT_STORAGE_CONFIRMED==='true';
// Render Free experimental mode: broker-side reconciliation required on every startup.
const EPHEMERAL_DEMO=process.env.ALLOW_EPHEMERAL_IG_DEMO==='true' && process.env.IG_ACCOUNT_TYPE==='DEMO' && !PERSISTENT_STORAGE;
const STORAGE_ALLOWED=PERSISTENT_STORAGE||EPHEMERAL_DEMO;
let persistenceHealthy=true,brokerReconciled=false,storageContinuityVerified=false;
// Fail closed on unsupported hosting, including Render Free.
if(BROKER_DEMO_EXECUTION && !STORAGE_ALLOWED) throw Error('Enable durable storage or explicitly opt in to ALLOW_EPHEMERAL_IG_DEMO=true (IG DEMO only).');
if(BROKER_DEMO_EXECUTION && process.env.RENDER==='true' && !process.env.RENDER_DISK_MOUNT_PATH && !EPHEMERAL_DEMO) throw Error('Render broker execution requires a persistent disk or explicit IG DEMO ephemeral opt-in.');
// Atomic single-instance directory lock; held until process exit.
const LOCK_DIR=path.join(DATA_DIR,'.marketpulse-instance-lock');
let lockHeld=false;
function acquireLocalLock(){
 if(!PERSISTENT_STORAGE)return;
 fs.mkdirSync(DATA_DIR,{recursive:true});
 function createLock(){
  fs.mkdirSync(LOCK_DIR); // Atomic creation: only one process can succeed.
  lockHeld=true;
  try{fs.writeFileSync(path.join(LOCK_DIR,'pid'),String(process.pid),{flag:'wx'});}
  catch(e){releaseLocalLock();throw e;}
 }
 try{createLock();return;}catch(e){if(e.code!=='EEXIST')throw e;}
 // Fail closed unless we can prove the old PID no longer exists.
 let previousPid;
 try{
  const raw=fs.readFileSync(path.join(LOCK_DIR,'pid'),'utf8').trim();
  if(!/^[1-9]\d*$/.test(raw))throw Error('invalid lock PID');
  previousPid=Number(raw);
  if(!Number.isSafeInteger(previousPid))throw Error('invalid lock PID');
 }catch(e){throw Error('Instance lock exists but cannot be safely verified: '+e.message);}
 try{
  process.kill(previousPid,0);
  throw Error('Instance lock belongs to a running process (PID '+previousPid+'); refusing duplicate startup');
 }catch(e){
  if(e.code!=='ESRCH')throw e; // EPERM and other unknown outcomes are unsafe.
 }
 // Only recover a lock whose recorded process is confirmed absent.
 // Persistent disks must not be shared across hosts; PID checks are host-local.
 if(process.env.RENDER_DISK_MOUNT_PATH && !LOCK_DIR.startsWith(process.env.RENDER_DISK_MOUNT_PATH+path.sep)){
  throw Error('Lock path is outside the configured persistent disk; refusing automatic recovery');
 }
 const stalePath=LOCK_DIR+'.stale-'+process.pid;
 try{
  fs.renameSync(LOCK_DIR,stalePath);
  fs.rmSync(stalePath,{recursive:true,force:true});
  console.log('[STARTUP_LOCK] Recovered stale lock for exited PID '+previousPid);
  createLock();
 }catch(e){throw Error('Stale lock recovery failed; refusing startup: '+e.message);}
}
function releaseLocalLock(){if(lockHeld){try{fs.rmSync(LOCK_DIR,{recursive:true,force:true})}catch{}lockHeld=false}}
process.once('exit',releaseLocalLock);
process.once('SIGINT',()=>{releaseLocalLock();process.exit(0)});
process.once('SIGTERM',()=>{releaseLocalLock();process.exit(0)});
const trade={armed:false,executionEnabled:false,busy:false,haltReason:'Disarmed on startup',lastAction:null,lastError:null,tracked:null,lastClosedAt:0,day:new Date().toISOString().slice(0,10),dailyOpens:0,lastSignalBar:null,history:[],lastDecision:null,pendingOrder:null,operatorStop:false};
function tradingConfigValid(){return /^CS\.D\.[A-Z]{6}\.CFD\.IP$/.test(TRADE_EPIC)&&Number.isFinite(TRADE_SIZE)&&VERIFIED_MIN_SIZE>0&&TRADE_SIZE>=VERIFIED_MIN_SIZE&&TRADE_SIZE<=1&&VERIFIED_STOP_UNITS&&Number.isFinite(TRADE_STOP_DISTANCE)&&TRADE_STOP_DISTANCE>0&&Number.isFinite(TRADE_LIMIT_DISTANCE)&&TRADE_LIMIT_DISTANCE>0&&Number.isFinite(TRADE_MAX_SPREAD)&&TRADE_MAX_SPREAD>0;}
function tradePublic(){return {armed:trade.armed,executionEnabled:trade.executionEnabled,busy:trade.busy,haltReason:trade.haltReason,lastAction:trade.lastAction,lastError:trade.lastError,tracked:trade.tracked,day:trade.day,dailyOpens:trade.dailyOpens,dailyCap:TRADE_DAILY_CAP,lastDecision:trade.lastDecision,history:trade.history.slice(0,15),config:{epic:TRADE_EPIC,size:TRADE_SIZE,stopDistance:TRADE_STOP_DISTANCE,limitDistance:TRADE_LIMIT_DISTANCE,minScore:TRADE_MIN_SCORE,maxSpread:TRADE_MAX_SPREAD,maxHoldMinutes:TRADE_MAX_HOLD_MINUTES,cooldownMinutes:TRADE_COOLDOWN_MINUTES,valid:tradingConfigValid()}}}
function saveTrade(){try{fs.mkdirSync(path.dirname(TRADE_STATE_PATH),{recursive:true});const tmp=TRADE_STATE_PATH+'.tmp';fs.writeFileSync(tmp,JSON.stringify({tracked:trade.tracked,lastClosedAt:trade.lastClosedAt,day:trade.day,dailyOpens:trade.dailyOpens,lastSignalBar:trade.lastSignalBar,history:trade.history.slice(0,50),pendingOrder:trade.pendingOrder,operatorStop:trade.operatorStop}));fs.renameSync(tmp,TRADE_STATE_PATH)}catch(e){persistenceHealthy=false;trade.lastError='Persistence failed: '+e.message;trade.armed=false;trade.executionEnabled=false;log(trade.lastError)}}
function restoreTrade(){try{const v=JSON.parse(fs.readFileSync(TRADE_STATE_PATH,'utf8'));trade.tracked=v.tracked||null;trade.lastClosedAt=v.lastClosedAt||0;trade.day=v.day||trade.day;trade.dailyOpens=v.dailyOpens||0;trade.lastSignalBar=v.lastSignalBar||null;trade.history=Array.isArray(v.history)?v.history.slice(0,50):[];trade.pendingOrder=v.pendingOrder||null;trade.operatorStop=Boolean(v.operatorStop)}catch(e){if(e.code!=='ENOENT'){persistenceHealthy=false;trade.operatorStop=true;log('Trade state could not be restored: '+e.message)}}trade.armed=false;trade.executionEnabled=false;}
function recordTrade(kind,details){trade.lastAction={time:new Date().toISOString(),kind,...details};trade.history.unshift(trade.lastAction);trade.history=trade.history.slice(0,50);saveTrade();log('Demo trade '+kind+': '+JSON.stringify(details).slice(0,180))}

const restState={enabled:true,intervalSeconds:REST_POLL_SECONDS,requestedMarkets:REST_MAX_MARKETS,lastPoll:null,nextPoll:null,lastError:'',rateLimitedUntil:null,attempted:0,succeeded:0,failed:0,marketResults:{}};
let restPolling=false,restTimer=null,restBackoffUntil=0;
const markets=new Map(),quotes=new Map(),candles=new Map(),current=new Map(),signals=new Map(),events=[];
let accepted=new Set(),diagnostics=new Map();
let probeStartedAt=null,restSnapshot=null,restSnapshotError="",restSnapshotAt=null;
let auth=null,client=null,sub=null,streamStatus='disconnected',streamError='',lastConnected=null,account=null,positions=[],lastAccountRefresh=null,lastDiscovery=null,discoverError='',reconnectAt=0,starting=false;
function log(msg){events.unshift({time:new Date().toISOString(),message:String(msg).slice(0,300)});events.length=Math.min(events.length,100);console.log('[MarketPulse]',msg)}
function n(v){if(v===null||v===undefined||v==='')return null;const x=Number(String(v).replace(/,/g,''));return Number.isFinite(x)?x:null}
async function request(url,method='GET',body=null,version='1'){
 if(method!=='GET'&&!(method==='POST'&&url==='/session'))throw Error('V250_BROKER_WRITE_BLOCKED');
 if(!require('./marketpulse-v110-boundary').allowIGRequest(method,url))throw Error('V110_IG_DEALING_TRANSPORT_BLOCKED');
 if(!require('./v54-safety').allowIGRequest(method,url))throw Error('V54_BROKER_WRITE_HARD_BLOCKED');
 const headers={'X-IG-API-KEY':process.env.IG_API_KEY||'',VERSION:version,Accept:'application/json'};
 if(auth){headers.CST=auth.cst;headers['X-SECURITY-TOKEN']=auth.xst}
 if(body!==null)headers['Content-Type']='application/json';
 const res=await v150Transport.transport(method,url,body,headers);
 const raw=await res.text();let data;try{data=JSON.parse(raw)}catch{data={raw:raw.slice(0,120)}}
 if(!res.ok||data.errorCode)throw Error(`${res.status}: ${data.errorCode||data.raw||'IG request failed'}`);
 return {data,headers:res.headers};
}
async function login(){if(!process.env.IG_API_KEY||!process.env.IG_USERNAME||!process.env.IG_PASSWORD)throw Error('Missing IG DEMO environment variables');
 auth=null;const r=await request('/session','POST',{identifier:process.env.IG_USERNAME,password:process.env.IG_PASSWORD},'2');
 const cst=r.headers.get('cst'),xst=r.headers.get('x-security-token');if(!cst||!xst)throw Error('IG login did not return session tokens');
 auth={cst,xst,streamUrl:r.data.lightstreamerEndpoint,accountId:r.data.currentAccountId,created:Date.now()};return r.data;
}
async function api(url,method='GET',body=null,version='1'){
 if(!auth)await login();try{return (await request(url,method,body,version)).data}catch(e){if(method==='GET' && /401|client-token-invalid|security-token-invalid/i.test(e.message)){await login();return (await request(url,method,body,version)).data}throw e}
}
function isForex(m){return MAJOR_EPICS.has(String(m?.epic||'').trim())}
function addMarket(m){
 if(!isForex(m))return;
 const epic=String(m.epic).trim();
 markets.set(epic,{epic,name:MAJOR_FOREX.find(x=>x.epic===epic).name,streaming:false});
}
async function discover(){
 lastDiscovery=new Date().toISOString();discoverError='';
 markets.clear();
 for(const market of MAJOR_FOREX)addMarket(market);
 log(`Major forex allowlist loaded: ${markets.size} CFD pairs; zero market search requests`);
 return markets.size;
}

function candleFromQuote(epic,mid,at){const bucket=Math.floor(at/FIVE)*FIVE;let c=current.get(epic);
 if(c&&bucket<c.bucket)return;
 if(c&&bucket>c.bucket){if(c.ticks>=2 && at-c.lastAt<=FIVE*2){const list=candles.get(epic)||[];list.push({time:new Date(c.bucket).toISOString(),open:c.open,high:c.high,low:c.low,close:c.close,ticks:c.ticks});candles.set(epic,list.slice(-150));saveCandles();}current.delete(epic);c=null;}
 if(!c){c={bucket,open:mid,high:mid,low:mid,close:mid,ticks:0};current.set(epic,c)}
 c.high=Math.max(c.high,mid);c.low=Math.min(c.low,mid);c.close=mid;c.ticks++;c.lastAt=at;
}
function saveCandles(){try{const file=CANDLE_STATE_PATH;fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(Object.fromEntries(candles)));fs.renameSync(tmp,file)}catch(e){persistenceHealthy=false;disarm('Candle persistence failed');log('Candle persistence unavailable: '+e.message)}}
function restoreCandles(){try{const obj=JSON.parse(fs.readFileSync(CANDLE_STATE_PATH,'utf8'));for(const [epic,bars] of Object.entries(obj))if(Array.isArray(bars)){const valid=bars.filter(x=>x&&Number.isFinite(x.close)&&Number.isFinite(x.ticks)&&x.ticks>=2&&Date.now()-Date.parse(x.time)<48*3600000).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));let tail=[];for(const b of valid){if(tail.length&&Date.parse(b.time)-Date.parse(tail.at(-1).time)!==FIVE)tail=[];tail.push(b)}candles.set(epic,tail.slice(-150))}}catch(e){if(e.code!=='ENOENT')log('Candle restore: '+e.message)}}
function ema(arr,period){let x=arr[0];for(const v of arr.slice(1))x=x+(v-x)*2/(period+1);return x}
function rsi(arr,period=14){if(arr.length<period+1)return null;let up=0,down=0;for(let i=arr.length-period;i<arr.length;i++){const delta=arr[i]-arr[i-1];up+=Math.max(0,delta);down+=Math.max(0,-delta)}return down===0?100:100-100/(1+up/down)}
function analyse(epic){const bars=candles.get(epic)||[],q=quotes.get(epic),fresh=q&&Date.now()-q.at<(q.source==='REST'?REST_STALE_MS:20000);
 if(!fresh)return {epic,direction:'STALE',score:0,bars:bars.length,reason:'No recent market price'};
 if(bars.length<30)return {epic,direction:'WARMING',score:0,bars:bars.length,reason:`${bars.length}/30 sampled 5-minute bars; ${q.source} observations, no historical REST requests`};
 const recent=bars.slice(-30);if(recent.some((b,i)=>i>0&&Date.parse(b.time)-Date.parse(recent[i-1].time)>FIVE*1.1)||Date.now()-Date.parse(recent.at(-1).time)>FIVE*3)return {epic,direction:'WARMING',score:0,bars:bars.length,reason:'Need 30 recent consecutive sampled bars'};
 const a=bars.map(x=>x.close),e9=ema(a,9),e21=ema(a,21),r=rsi(a),last=a.at(-1);
 const direction=e9>e21&&r>=52&&r<=68?'LONG':e9<e21&&r>=32&&r<=48?'SHORT':'WAIT';
 const score=direction==='WAIT'?0:Math.min(90,Math.round(55+Math.min(20,Math.abs(e9-e21)/last*10000*2)+Math.max(0,15-Math.abs(r-(direction==='LONG'?60:40)))));
 return {epic,direction,score,bars:bars.length,rsi:r,ema9:e9,ema21:e21,reason:'Experimental heuristic from sampled quotes; not a win probability or tick-quality signal'};
}
function closeStream(){
 accepted.clear();diagnostics.clear();probeStartedAt=null;
 if(client){try{if(sub)for(const item of sub)client.unsubscribe(item);client.disconnect()}catch(e){log('Stream cleanup: '+e.message)}}
 client=null;sub=null;for(const m of markets.values())m.streaming=false;
}
function startStream(){
 if(!auth?.streamUrl||!auth.accountId)throw Error('IG login did not supply streaming endpoint/account');
 closeStream();streamStatus='connecting';streamError='';
 const ls=new LightstreamerClient(auth.streamUrl,null);
 ls.connectionDetails.setUser(auth.accountId);
 ls.connectionDetails.setPassword(`CST-${auth.cst}|XST-${auth.xst}`);
 const ordered=[...markets.keys()].sort((a,b)=>Number(b==='CS.D.EURUSD.CFD.IP')-Number(a==='CS.D.EURUSD.CFD.IP'));
 const epics=MULTI_MODE?ordered.filter(x=>/\.CFD\.IP$/.test(x)).sort((a,b)=>Number(process.env['MP_'+b.split('.')[2]+'_ENABLED']==='true')-Number(process.env['MP_'+a.split('.')[2]+'_ENABLED']==='true')).slice(0,MAX):ordered.slice(0,TEST_ONE?1:MAX);
 if(!epics.length)throw Error('No approved major forex markets configured');
 // Two independent diagnostic subscriptions on EUR/USD CFD: standard IG price fields
 // IG PRICE adapter supports BIDPRICE1/ASKPRICE1, DLG_FLAG and DELAY.
 // A single subscription per EPIC avoids competing field schemas.
 const probes=epics.map(epic=>({epic,kind:'pricing',fields:['BIDPRICE1','ASKPRICE1','DLG_FLAG','TIMESTAMP','DELAY']}));
 const subscriptions=[];
 probeStartedAt=new Date().toISOString();
 for(const {epic,kind,fields} of probes){
  const key=epic+'|'+kind;
  const item=kind==='no-account'?'PRICE:'+epic:'PRICE:'+auth.accountId+':'+epic;
  const subscription=new Subscription('MERGE',item,fields);
  subscription.setDataAdapter('Pricing');
  subscription.setRequestedSnapshot('yes');
  diagnostics.set(key,{epic,kind,item,fields,subscribed:false,updates:0,validQuotes:0,errors:[],lastEvent:null,lastFields:null});
  subscription.addListener({
   onSubscription(){
    accepted.add(key);
    const d=diagnostics.get(key);if(d)d.subscribed=true;
    log('Probe accepted: '+key);
   },
   onSubscriptionError(code,message){
    accepted.delete(key);const d=diagnostics.get(key);
    if(d){d.subscribed=false;d.errors.push({code,message:String(message).slice(0,150)});if(d.errors.length>20)d.errors.shift();}
    streamError=`${key}: subscription ${code}: ${message}`;log(streamError);
   },
   onItemLostUpdates(itemName,lostUpdates){log(`Probe lost updates ${key}: ${lostUpdates}`)},
   onItemUpdate(update){
    const d=diagnostics.get(key);if(!d)return;
    d.updates++;d.lastEvent=new Date().toISOString();
    const values={};
    for(const field of fields){try{values[field]=update.getValue(field)}catch(e){values[field]='FIELD_ERROR'}}
    d.lastFields=values;
    if(d.updates<=3)log('Raw price event '+key+' '+JSON.stringify(values));
    const old=quotes.get(epic)||{};
    const bid=n(values.BID??values.BIDPRICE1)??old.bid;
    const ask=n(values.OFFER??values.ASKPRICE1)??old.ask;
    if(bid==null||ask==null||bid<=0||ask<=bid){
     if(d.updates<=3)log('Quote not yet valid '+key);
     return;
    }
    d.validQuotes++;
    const state=String(values.DLG_FLAG??old.marketState??'UNKNOWN').trim().toUpperCase();
    const delayed=values.DELAY??old.delayed??null; // null means IG has not confirmed the delay status
    const now=Date.now();quotes.set(epic,{bid,ask,spread:ask-bid,at:now,marketState:state,delayed,source:'STREAM'});
    const market=markets.get(epic);if(market)market.streaming=true;
    // Only build candles for non-delayed quotes, avoiding closed/suspended markets.
    if(state==='DEAL' && (delayed===null || String(delayed)==='0'))candleFromQuote(epic,(bid+ask)/2,now);
    signals.set(epic,analyse(epic));
   }
  });
  subscriptions.push(subscription);
 }
 // ACCOUNT subscription checks whether the authenticated streaming session can deliver
 // any account events. A quiet account stream is not proof of failure.
 if(PROBE_ACCOUNT){
  const key='ACCOUNT|control';
  const fields=['AVAILABLE_CASH','PNL','DEPOSIT','FUNDS','MARGIN'];
  const subscription=new Subscription('MERGE','ACCOUNT:'+auth.accountId,fields);
  subscription.setRequestedSnapshot('yes');
  diagnostics.set(key,{epic:null,kind:'account-control',fields,subscribed:false,updates:0,validQuotes:0,errors:[],lastEvent:null,lastFields:null});
  subscription.addListener({
   onSubscription(){accepted.add(key);diagnostics.get(key).subscribed=true;log('Probe accepted: '+key)},
   onSubscriptionError(code,message){accepted.delete(key);const d=diagnostics.get(key);d.subscribed=false;d.errors.push({code,message:String(message).slice(0,150)});if(d.errors.length>20)d.errors.shift();log('Account probe error '+code+': '+message)},
   onItemUpdate(update){const d=diagnostics.get(key);d.updates++;d.lastEvent=new Date().toISOString();d.lastFields=Object.fromEntries(fields.map(f=>[f,update.getValue(f)]));if(d.updates<=2)log('Account probe update received')}
  });
  subscriptions.push(subscription);
 }
 ls.addListener({
  onStatusChange(status){streamStatus=status;if(String(status).startsWith('CONNECTED'))lastConnected=new Date().toISOString();log('Lightstreamer status: '+status)},
  onServerError(code,message){streamError=`Server ${code}: ${message}`;log(streamError)}
 });
 client=ls;sub=subscriptions;ls.connect();
 for(const subscription of subscriptions)ls.subscribe(subscription);
 log(`V5.0 streaming compatibility diagnostics started: ${probes.length} probes across ${new Set(probes.map(x=>x.epic)).size} forex markets`);
}
async function checkRestSnapshot(){
 try{const data=await api('/markets/CS.D.EURUSD.CFD.IP');const snap=data.snapshot||{};restSnapshot={epic:data.instrument?.epic||'CS.D.EURUSD.CFD.IP',bid:snap.bid??null,offer:snap.offer??null,marketStatus:snap.marketStatus??null,updateTime:snap.updateTime??null};restSnapshotError='';}
 catch(e){restSnapshotError=e.message;restSnapshot=null;}restSnapshotAt=new Date().toISOString();log('REST market snapshot: '+(restSnapshotError||JSON.stringify(restSnapshot)));
}
// REST fallback: rate-limited snapshots, not streaming ticks or historical candles.
// Prefer live stream if one eventually starts working; never overwrite a recent stream quote.
const REST_PREFERRED=['CS.D.EURUSD.CFD.IP','CS.D.GBPUSD.CFD.IP','CS.D.USDJPY.CFD.IP'];
function restEpics(){return REST_PREFERRED.filter(epic=>markets.has(epic)).slice(0,REST_MAX_MARKETS)}
function updateRestQuote(epic,data){
 const snap=data?.snapshot||{};
 const bid=n(snap.bid),ask=n(snap.offer),status=String(snap.marketStatus||'UNKNOWN').toUpperCase();
 if(bid===null||ask===null||bid<=0||ask<=bid)throw Error('Missing/invalid bid and offer');
 const now=Date.now(),prior=quotes.get(epic);
 if(prior?.source==='STREAM'&&now-prior.at<20000)return {skipped:'stream is fresher'};
 const delayed=snap.delayTime??data?.instrument?.delayTime??null;
 quotes.set(epic,{bid,ask,spread:ask-bid,at:now,marketState:status,delayed,source:'REST',igUpdateTime:snap.updateTime||null});
 // Sampling a REST quote is not a tick. Require tradeable status and no reported delay.
 // Never create a bar from repeated, unchanged IG updateTime values.
 const previousUpdate=prior?.source==='REST'?prior.igUpdateTime:null;
 const changed=(!previousUpdate||!snap.updateTime||previousUpdate!==snap.updateTime);
 // REST snapshots are for dashboard display only; never feed execution candles.
 signals.set(epic,analyse(epic));
 return {bid,ask,status,source:'REST',igUpdateTime:snap.updateTime||null,observedAt:new Date(now).toISOString(),sampleAccepted:status==='TRADEABLE'&&changed};
}
async function pollRest(){
 if(restPolling||!auth||Date.now()<restBackoffUntil)return;
 restPolling=true;restState.lastPoll=new Date().toISOString();
 const epics=restEpics();
 try{
  for(const epic of epics){
   restState.attempted++;
   try{
    const data=await api('/markets/'+encodeURIComponent(epic));
    restState.marketResults[epic]=updateRestQuote(epic,data);
    restState.succeeded++;
    restState.lastError='';
   }catch(e){
    restState.failed++;
    restState.lastError=`${epic}: ${String(e.message).slice(0,180)}`;
    restState.marketResults[epic]={error:String(e.message).slice(0,180),observedAt:new Date().toISOString()};
    log('REST fallback '+restState.lastError);
    if(/\b429\b|allowance|rate.limit|too.many.requests|exceeded/i.test(e.message)){
     restBackoffUntil=Date.now()+15*60*1000;
     restState.rateLimitedUntil=new Date(restBackoffUntil).toISOString();
     log('REST fallback paused for 15 minutes after rate-limit response');
     break;
    }
   }
  }
 }finally{restPolling=false;await tradingCycle();restState.nextPoll=new Date(Math.max(Date.now()+REST_POLL_SECONDS*1000,restBackoffUntil)).toISOString()}
}
function startRestPolling(){
 if(restTimer)clearInterval(restTimer);
 restTimer=setInterval(()=>pollRest().catch(e=>log('REST poll unexpected error: '+e.message)),REST_POLL_SECONDS*1000);
 pollRest().catch(e=>log('Initial REST poll: '+e.message));
 log(`V5.0 REST fallback enabled: ${REST_POLL_SECONDS}s interval, ${REST_MAX_MARKETS} markets`);
}
async function refreshAccount(){
 account=null;
 const a=await api('/accounts');
 const ac=(a.accounts||[]).find(x=>x.accountId===auth?.accountId);
 if(!ac||ac.accountType!=='CFD'||ac.currency!=='GBP'){
  throw Error('IG Demo account verification failed: GBP CFD account required');
 }
 const rawBalance=ac.balance?.balance;
 const rawProfitLoss=ac.balance?.profitLoss;
 if(rawBalance===null||rawBalance===undefined||
    rawProfitLoss===null||rawProfitLoss===undefined||
    typeof rawBalance==='boolean'||typeof rawProfitLoss==='boolean'||
    String(rawBalance).trim()===''||String(rawProfitLoss).trim()===''){
  throw Error('IG Demo account verification failed: missing financial values');
 }
 const balance=Number(rawBalance);
 const profitLoss=Number(rawProfitLoss);
 const equity=balance+profitLoss;
 if(!Number.isFinite(balance)||balance<=0||
    !Number.isFinite(profitLoss)||
    !Number.isFinite(equity)||equity<=0){
  throw Error('IG Demo account verification failed: invalid balance or equity');
 }
 const p=await api('/positions','GET',null,'2');
 positions=(p.positions||[]).map(x=>({
  epic:x.market?.epic,
  direction:x.position?.direction,
  size:x.position?.size,
  dealId:x.position?.dealId
 }));
 account={accountId:ac.accountId,currency:'GBP',balance,equity};
 lastAccountRefresh=new Date().toISOString();
}

// DEMO order execution: IG OTC v2 open, v1 close with _method DELETE; confirm every action.
// Never retry an ambiguous order, and never send orders unless armed explicitly after boot.
async function confirmDeal(ref){if(!ref)throw Error('IG did not return dealReference; action ambiguous. Disarmed.');for(let i=0;i<5;i++){await new Promise(r=>setTimeout(r,1000));try{const c=await api('/confirms/'+encodeURIComponent(ref));if(c.dealStatus==='ACCEPTED')return c;if(c.dealStatus==='REJECTED')throw Error('IG rejected: '+(c.reason||'unknown'));}catch(e){if(/rejected/i.test(e.message))throw e;if(i===4)throw e}}throw Error('Confirmation unavailable; manual reconciliation required')}
function disarm(reason){trade.armed=false;trade.executionEnabled=false;trade.haltReason=reason;log('Demo automation disarmed: '+reason)}
async function reconcilePositions(){const p=await api('/positions','GET',null,'2');const all=(p.positions||[]).map(x=>({epic:x.market?.epic,direction:x.position?.direction,size:Number(x.position?.size),dealId:x.position?.dealId,createdDate:x.position?.createdDate}));positions=all;lastAccountRefresh=new Date().toISOString();if(trade.pendingOrder){disarm('Unresolved order journal; manual reconciliation required')}if(trade.tracked&&!all.some(x=>x.dealId===trade.tracked.dealId)){trade.operatorStop=true;disarm('Tracked broker position missing: investigate broker history before clearing local state');saveTrade()}return all}
function manualDemoQuoteReady(){
 const q=quotes.get(TRADE_EPIC);
 return Boolean(q&&q.source==='STREAM'&&q.marketState==='DEAL'&&
  q.delayed!==null&&String(q.delayed)==='0'&&
  Number.isFinite(q.bid)&&Number.isFinite(q.ask)&&q.ask>q.bid&&
  Date.now()-q.at>=0&&Date.now()-q.at<15000);
}
function streamTradeReady(){
 const q=quotes.get(TRADE_EPIC), s=analyse(TRADE_EPIC), bars=candles.get(TRADE_EPIC)||[];
 if(!q||q.source!=='STREAM'||q.marketState!=='DEAL'||(q.delayed!==null&&String(q.delayed)!=='0')||Date.now()-q.at>15000)return false;
 if(bars.length<30||s.direction==='WARMING'||s.direction==='STALE')return false;
 const recent=bars.slice(-30);
 return recent.every((b,i)=>Number.isFinite(b.close)&&b.ticks>=2&&(i===0||Date.parse(b.time)-Date.parse(recent[i-1].time)===FIVE))&&Date.now()-Date.parse(recent.at(-1).time)<FIVE*2;
}

async function init(){if(starting)return;starting=true;brokerReconciled=false;disarm('Reconnect requires re-arming');try{closeStream();await login();await discover();await refreshAccount();const brokerPositions=await reconcilePositions();brokerReconciled=true;if(brokerPositions.length||trade.tracked)log('Broker reconciliation: '+brokerPositions.length+' open position(s), bot tracked='+Boolean(trade.tracked));await checkRestSnapshot();startStream();startRestPolling()}catch(e){streamStatus='error';streamError=e.message;log('Startup: '+e.message)}finally{starting=false}}
function requireAdmin(req,res,next){const token=process.env.ADMIN_TOKEN;if(!token)return res.status(503).json({error:'Set ADMIN_TOKEN in Render'});const supplied=req.get('X-Admin-Token')||'';const crypto=require('crypto');const a=Buffer.from(supplied),b=Buffer.from(token);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(403).json({error:'Invalid admin token'});next()}
const v79History=[];
function v79Sample(){
 const m=process.memoryUsage(),mb=x=>Math.round(x/1048576);
 const snap={at:new Date().toISOString(),uptimeSeconds:Math.round(process.uptime()),rssMB:mb(m.rss),heapUsedMB:mb(m.heapUsed),externalMB:mb(m.external)};
 v79History.push(snap);if(v79History.length>180)v79History.shift();return snap;
}
v79Sample();const v79Timer=setInterval(v79Sample,60000);v79Timer.unref();
function v79Readiness(){
 const now=Date.now();
 const pairs=MAJOR_FOREX.map(m=>{
  const q=quotes.get(m.epic),b=candles.get(m.epic)||[],sig=analyse(m.epic);
  const age=q?Math.round((now-q.at)/1000):null;
  const recent=b.slice(-30);
  const consecutive=recent.length===30&&recent.every((bar,i)=>i===0||Date.parse(bar.time)-Date.parse(recent[i-1].time)===FIVE);
  const fresh=!!q&&q.source==='STREAM'&&age>=0&&age<20;
  return {epic:m.epic,name:m.name,streamFresh:fresh,ageSeconds:age,bars:b.length,missingBars:Math.max(0,30-b.length),consecutive30:consecutive,direction:sig.direction,score:sig.score,shadowReady:fresh&&consecutive&&sig.direction!=='WARMING'&&sig.direction!=='STALE'};
 });
 const m=process.memoryUsage();const mem={at:new Date().toISOString(),rssMB:Math.round(m.rss/1048576),heapUsedMB:Math.round(m.heapUsed/1048576)};
 const blockers=[];
 if(!pairs.every(p=>p.streamFresh))blockers.push('STREAM_NOT_FRESH');
 if(!pairs.every(p=>p.consecutive30))blockers.push('CANDLE_HISTORY_NOT_READY');
 if(mem.rssMB>=450)blockers.push('MEMORY_PRESSURE');
 if(!persistenceHealthy)blockers.push('PERSISTENCE_UNHEALTHY');
 if(!PERSISTENT_STORAGE)blockers.push('DURABLE_STORAGE_NOT_CONFIRMED');
 if(!brokerReconciled)blockers.push('BROKER_RECONCILIATION_NOT_READY');
 blockers.push('GBP_RISK_CERTIFICATION_REQUIRED','BROKER_ORDER_LIFECYCLE_CERTIFICATION_REQUIRED','CRASH_RECOVERY_CERTIFICATION_REQUIRED','KILL_SWITCH_CERTIFICATION_REQUIRED','BROKER_EXECUTION_HARD_BLOCKED');
 return {version:'7.9.0',at:new Date().toISOString(),mode:'READ_ONLY_UNATTENDED_READINESS',node:process.version,uptimeSeconds:Math.round(process.uptime()),streamStatus,marketCount:markets.size,markets:pairs,blockers,shadowEligibleCount:pairs.filter(p=>p.shadowReady).length,memory:{...mem,headroomTo512MB:512-mem.rssMB,history:v79History.slice(-120)},recovery:{persistenceHealthy,persistentConfigured:PERSISTENT_STORAGE,brokerReconciled,candleFileExists:fs.existsSync(CANDLE_STATE_PATH)},safety:{brokerOrdersAllowed:false,brokerExecutionHardBlocked:true,autoArmAllowed:false,unattendedExecutionCertified:false},note:'Read-only monitoring. No simulated performance guarantee; IG broker writes remain hard-blocked.'};
}
app.get('/api/admin/v79/readiness',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(v79Readiness()));
app.get('/api/admin/v79/health',requireAdmin,(_req,res)=>{const x=v79Readiness();res.set('Cache-Control','no-store').json({version:x.version,at:x.at,streamStatus:x.streamStatus,marketCount:x.marketCount,memory:x.memory,recovery:x.recovery,safety:x.safety,blockers:x.blockers});});

// V8.0 isolated, durable shadow-only lifecycle. No IG broker callbacks are passed.
const v80Shadow=require('./marketpulse-v80-shadow').createShadow80({
 dataDir:DATA_DIR,epics:MAJOR_FOREX.map(x=>x.epic),storageConfirmed:PERSISTENT_STORAGE,
 getSnapshot:()=>({memoryMB:Math.round(process.memoryUsage().rss/1048576),persistenceHealthy,
  markets:MAJOR_FOREX.map(m=>{const q=quotes.get(m.epic),bars=candles.get(m.epic)||[],s=analyse(m.epic),last=bars.at(-1)?.time||null;
   const recent=bars.slice(-30),consecutive30=recent.length===30&&recent.every((b,i)=>i===0||Date.parse(b.time)-Date.parse(recent[i-1].time)===FIVE);
   return {epic:m.epic,bid:q?.bid,ask:q?.ask,lastBar:last,consecutive30,streamFresh:!!q&&q.source==='STREAM'&&q.marketState==='DEAL'&&String(q.delayed)==='0'&&Date.now()-q.at<15000,direction:s.direction,score:s.score};})})
});
const v80Timer=setInterval(()=>{try{v80Shadow.tick()}catch(e){log('V80 shadow tick: '+String(e.message).slice(0,120))}},30000);v80Timer.unref();
app.get('/api/admin/v80/shadow',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(v80Shadow.status()));
app.get('/api/admin/v80/operations',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json({version:APP_VERSION,readiness:v79Readiness(),shadow:v80Shadow.status()}));
const v95Lab=require('./marketpulse-v95-safety').createLab({dataDir:DATA_DIR,readIG:(route,version)=>api(route,'GET',null,version),getReadiness:()=>v79Readiness(),getMemory:()=>Math.round(process.memoryUsage().rss/1048576),getStorage:()=>({configured:PERSISTENT_STORAGE,healthy:persistenceHealthy})});
app.get('/api/admin/v95/lab',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(v95Lab.report()));
app.post('/api/admin/v95/inspect',requireAdmin,async(_req,res)=>{try{res.set('Cache-Control','no-store').json(await v95Lab.inspect())}catch(e){res.status(e.status||502).json({error:String(e.message||e)})}});
app.post('/api/admin/v95/engage',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(v95Lab.engage()));
// v10: on-demand consolidated evidence only; zero IG write calls and no background timers.
app.post('/api/admin/v200/recovery-test',requireAdmin,(_req,res)=>{try{res.set('Cache-Control','no-store').json(v200.recoveryTest(DATA_DIR))}catch(e){res.status(503).json({error:'LOCAL_RECOVERY_TEST_FAILED'})}});

const lab25=require('./marketpulse-v250-lab');
app.get('/api/health',(_req,res)=>res.json({ok:true,version:APP_VERSION,streamStatus,marketCount:markets.size,brokerDemoExecutionEnabled:false}));
app.get('/api/admin/v250/status',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json({version:APP_VERSION,readiness:v79Readiness(),shadow:v80Shadow.status(),safety:v200.gate(DATA_DIR),legacyBundleLoaded:Object.keys(require.cache).some(x=>x.endsWith('/legacy-bundle.js')),loadedModules:Object.keys(require.cache).length,brokerOrdersAllowed:false}));
app.get('/api/admin/v250/contracts',requireAdmin,async(_req,res)=>{try{const rows=[];for(const epic of MAJOR_EPICS){rows.push({epic,...lab25.inspectContract(await api('/markets/'+epic,'GET',null,'3'))})}res.set('Cache-Control','no-store').json({rows,certified:false})}catch{res.status(502).json({error:'CONTRACT_SCAN_FAILED'})}});
app.post('/api/admin/v250/recovery',requireAdmin,(_req,res)=>{try{if(process.memoryUsage().rss>=400*1048576)return res.status(409).json({error:'INSUFFICIENT_MEMORY_FOR_CHILD_TEST'});res.json(lab25.crashTest(DATA_DIR))}catch(e){res.status(503).json({error:'LOCAL_CRASH_TEST_FAILED'})}});
const lab30=require('./marketpulse-v300-lab').create({dir:DATA_DIR,readIG:(route,version)=>api(route,'GET',null,version),epics:MAJOR_EPICS,gate:()=>v200.gate(DATA_DIR),storage:()=>({configured:PERSISTENT_STORAGE,healthy:persistenceHealthy})});
for(const [method,route,fn] of [['get','status',()=>lab30.status()],['post','snapshot',()=>lab30.snapshot()],['post','risk',req=>lab30.risk(req.body||{})]])app[method]('/api/admin/v300/'+route,requireAdmin,async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req))}catch(e){res.status(409).json({error:String(e.message).slice(0,120)})}});
app.get('/',(_req,res)=>res.redirect('/operations.html'));
const port=Number(process.env.PORT)||3000;acquireLocalLock();app.listen(port,'0.0.0.0',()=>{restoreTrade();restoreCandles();try{fs.mkdirSync(DATA_DIR,{recursive:true});const probe=path.join(DATA_DIR,'.write-test');fs.writeFileSync(probe,'ok');fs.unlinkSync(probe)}catch{persistenceHealthy=false}void init()});
setInterval(()=>{if(!starting)refreshAccount().catch(e=>log('Account refresh: '+e.message))},120000);
setInterval(()=>{if(!starting&&(!client||streamStatus==='error'||streamStatus==='disconnected'||String(streamStatus).startsWith('DISCONNECTED'))&&Date.now()>reconnectAt){reconnectAt=Date.now()+60000;void init()}},30000);
