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
const APP_VERSION='2000.0.0';
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
const markets=new Map(),quotes=new Map(),streamQuotes=new Map(),candles=new Map(),current=new Map(),signals=new Map(),events=[];
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
 streamQuotes.clear();accepted.clear();diagnostics.clear();probeStartedAt=null;
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
 const probes=[...new Set([...epics,'CS.D.EURUSD.MINI.IP'])].map(epic=>({epic,kind:'pricing',fields:['BIDPRICE1','ASKPRICE1','DLG_FLAG','TIMESTAMP','DELAY']}));
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
    streamQuotes.delete(epic);accepted.delete(key);const d=diagnostics.get(key);
    if(d){d.subscribed=false;d.errors.push({code,message:String(message).slice(0,150)});if(d.errors.length>20)d.errors.shift();}
    streamError=`${key}: subscription ${code}: ${message}`;log(streamError);
   },
   onItemLostUpdates(itemName,lostUpdates){log(`Probe lost updates ${key}: ${lostUpdates}`)},
   onItemUpdate(update){
    if(client!==ls)return;
    const d=diagnostics.get(key);if(!d)return;
    d.updates++;d.lastEvent=new Date().toISOString();
    const values={};
    for(const field of fields){try{values[field]=update.getValue(field)}catch(e){values[field]='FIELD_ERROR'}}
    d.lastFields=values;
    if(d.updates<=3)log('Raw price event '+key+' '+JSON.stringify(values));
    const old=streamQuotes.get(epic)||{};
    const bid=n(values.BID??values.BIDPRICE1)??old.bid;
    const ask=n(values.OFFER??values.ASKPRICE1)??old.ask;
    if(bid==null||ask==null||bid<=0||ask<=bid){
     if(d.updates<=3)log('Quote not yet valid '+key);
     return;
    }
    d.validQuotes++;
    const state=String(values.DLG_FLAG??old.marketState??'UNKNOWN').trim().toUpperCase();
    const delayed=values.DELAY??old.delayed??null; // null means IG has not confirmed the delay status
    const now=Date.now();const streamQuote={bid,ask,spread:ask-bid,at:now,marketState:state,delayed,sourceTimestamp:values.TIMESTAMP??null,source:'STREAM'};quotes.set(epic,streamQuote);streamQuotes.set(epic,streamQuote);
    const market=markets.get(epic);if(market)market.streaming=true;
    // Only build candles for non-delayed quotes, avoiding closed/suspended markets.
    if(epics.includes(epic)&&feed1200.assess(streamQuote,null,now).fresh)candleFromQuote(epic,(bid+ask)/2,now);
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
  onStatusChange(status){if(client!==ls)return;if(!String(status).startsWith('CONNECTED'))streamQuotes.clear();streamStatus=status;if(String(status).startsWith('CONNECTED'))lastConnected=new Date().toISOString();log('Lightstreamer status: '+status)},
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
 if(!q||q.source!=='STREAM'||q.marketState!=='DEAL'||String(q.delayed)!=='0'||Date.now()-q.at>15000)return false;
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
const lab35=require('./marketpulse-v350-lab').create({lab30,readIG:(route,version)=>api(route,'GET',null,version)});
app.get('/api/admin/v350/status',requireAdmin,(_req,res)=>{try{res.set('Cache-Control','no-store').json(lab35.report())}catch{res.status(409).json({error:'EVIDENCE_UNAVAILABLE'})}});
app.post('/api/admin/v350/confirmation',requireAdmin,async(req,res)=>{try{res.set('Cache-Control','no-store').json(await lab35.confirmation(req.body?.reference))}catch{res.status(409).json({error:'CONFIRMATION_UNAVAILABLE_OR_INVALID'})}});
app.get('/',(_req,res)=>res.redirect('/operations.html'));
const lab40=require('./marketpulse-v400-lab').create({dir:DATA_DIR,lab30,lab35});
app.get('/api/admin/v400/status',requireAdmin,(_req,res)=>{try{res.set('Cache-Control','no-store').json(lab40.report())}catch{res.status(409).json({error:'EVIDENCE_UNAVAILABLE'})}});
app.post('/api/admin/v400/confirmation',requireAdmin,async(req,res)=>{try{res.set('Cache-Control','no-store').json(await lab40.capture(req.body?.reference))}catch{res.status(409).json({error:'CONFIRMATION_OR_STORAGE_UNAVAILABLE'})}});
const paper50=require('./marketpulse-v500-paper').create({dir:DATA_DIR,snapshot:()=>({storage:PERSISTENT_STORAGE&&persistenceHealthy&&lockHeld,memory:process.memoryUsage().rss/1048576,markets:MAJOR_FOREX.map(m=>{const q=streamQuotes.get(m.epic),b=(candles.get(m.epic)||[]).slice(-30),a=analyse(m.epic);return {epic:m.epic,bid:q?.bid,ask:q?.ask,fresh:feed1200.assess(q,null,Date.now()).fresh,ready:b.length===30&&b.every((x,i)=>Number.isFinite(x.close)&&x.ticks>=2&&(i===0||Date.parse(x.time)-Date.parse(b[i-1].time)===FIVE)),quoteAt:q?.at,bar:b.at(-1)?.time,direction:a.direction,score:a.score}})})});
app.get('/api/admin/v500/status',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(paper50.status()));
app.post('/api/admin/v500/control',requireAdmin,(req,res)=>{try{res.json(paper50.enable(req.body?.enabled))}catch(e){res.status(409).json({error:e.message})}});
// Legacy paper ledger retained read-only; v2000 runs independently.
const lab90=require('./marketpulse-v900-lab').create({dir:DATA_DIR,readIG:(route,version)=>api(route,'GET',null,version),epics:MAJOR_EPICS,storage:()=>({configured:PERSISTENT_STORAGE,healthy:persistenceHealthy&&lockHeld}),gate:()=>v200.gate(DATA_DIR),normalize:require('./marketpulse-v300-lab').normalize});
for(const [method,route,fn] of [['get','status',()=>lab90.status()],['post','capture',()=>lab90.capture()],['post','contract',req=>lab90.contract(req.body?.epic)]])app[method]('/api/admin/v900/'+route,requireAdmin,async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req))}catch(e){res.status(409).json({error:'V90_INSPECTION_FAILED',detail:String(e.message).slice(0,160)})}});
const readiness150=require('./marketpulse-v1500');
app.get('/api/admin/v1500/status',requireAdmin,(_req,res)=>{try{res.set('Cache-Control','no-store').json(readiness150.report({paper:paper50.status(),safety:v200.gate(DATA_DIR),storage:{configured:PERSISTENT_STORAGE,healthy:persistenceHealthy&&lockHeld},broker:lab90.status()}))}catch(e){res.status(409).json({error:'READINESS_UNAVAILABLE'})}});
const v2500=require('./marketpulse-v2500');
const evidence250=v2500.create({dir:DATA_DIR,readIG:(route,version)=>api(route,'GET',null,version),storage:()=>({configured:PERSISTENT_STORAGE,healthy:persistenceHealthy&&lockHeld}),gate:()=>v200.gate(DATA_DIR),normalize:require('./marketpulse-v300-lab').normalize});
app.get('/api/admin/v2500/status',requireAdmin,(_req,res)=>{try{res.set('Cache-Control','no-store').json({...v2500.report({paper:paper50.status(),broker:lab90.status(),safety:v200.gate(DATA_DIR)}),confirmations:evidence250.status()})}catch(e){res.status(409).json({error:'EVIDENCE_UNAVAILABLE'})}});
app.post('/api/admin/v2500/capture',requireAdmin,async(req,res)=>{try{res.set('Cache-Control','no-store').json(await evidence250.capture(req.body?.reference))}catch(e){res.status(409).json({error:'CAPTURE_FAILED',detail:String(e.message).slice(0,120)})}});
const suite500=require('./marketpulse-v5000').create({dir:DATA_DIR,readIG:(route,version)=>api(route,'GET',null,version),contract:epic=>lab90.contract(epic),inputs:()=>({paper:paper50.status(),broker:lab90.status(),confirmations:evidence250.status(),safety:v200.gate(DATA_DIR),storage:{configured:PERSISTENT_STORAGE,healthy:persistenceHealthy&&lockHeld}})});
for(const [method,route,fn] of [['get','status',()=>suite500.status()],['post','history',()=>suite500.capture()],['post','contract',req=>suite500.contract(req.body?.epic)]])app[method]('/api/admin/v5000/'+route,requireAdmin,async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req))}catch(e){res.status(409).json({error:'V500_EVIDENCE_UNAVAILABLE'})}});
app.get('/api/admin/v3500/status',requireAdmin,(_req,res)=>{try{res.set('Cache-Control','no-store').json(require('./marketpulse-v3500').report({paper:paper50.status(),broker:lab90.status(),confirmations:evidence250.status(),safety:v200.gate(DATA_DIR),storage:{configured:PERSISTENT_STORAGE,healthy:persistenceHealthy&&lockHeld}}))}catch{res.status(409).json({error:'VERIFICATION_UNAVAILABLE'})}});
const brokerEvidence=require('./broker-evidence-runner').create({dir:DATA_DIR,readIG:(route,version)=>api(route,'GET',null,version),accountId:()=>auth?.accountId,storage:()=>PERSISTENT_STORAGE&&persistenceHealthy&&lockHeld,paper:()=>paper50.status(),epics:MAJOR_EPICS});
const lifecycle=require('./broker-lifecycle').create({dir:DATA_DIR,readIG:(route,version)=>api(route,'GET',null,version),accountId:()=>auth?.accountId,storage:()=>PERSISTENT_STORAGE&&persistenceHealthy&&lockHeld,evidence:()=>brokerEvidence.status(),paper:()=>paper50.status()});
app.post('/api/admin/lifecycle/run',requireAdmin,async(_req,res)=>{try{res.set('Cache-Control','no-store').json(await lifecycle.run())}catch(e){res.status(409).json({error:'LIFECYCLE_CAPTURE_FAILED',detail:String(e.message).replace(/[^A-Z_]/g,'').slice(0,80)})}});
app.get('/api/admin/lifecycle/status',requireAdmin,(_req,res)=>{try{res.set('Cache-Control','no-store').json(lifecycle.status())}catch{res.status(409).json({error:'LIFECYCLE_STORAGE_UNAVAILABLE'})}});
app.post('/api/admin/broker-evidence/run',requireAdmin,async(_req,res)=>{try{res.set('Cache-Control','no-store').json(await brokerEvidence.run())}catch{res.status(409).json({error:'BROKER_EVIDENCE_RUN_FAILED'})}});
app.get('/api/admin/broker-evidence/status',requireAdmin,(_req,res)=>{try{res.set('Cache-Control','no-store').json(brokerEvidence.status())}catch{res.status(409).json({error:'EVIDENCE_UNAVAILABLE'})}});
app.get('/api/admin/evidence-mega/status',requireAdmin,(_req,res)=>{try{const m=require('./evidence-mega'),key=require('node:crypto').createHash('sha256').update(auth.accountId).digest('hex'),runs=brokerEvidence.status().runs.filter(r=>r.accountKey===key),captures=lifecycle.status().captures.filter(r=>r.accountKey===key),c=captures.at(-1),p=paper50.status();res.set('Cache-Control','no-store').json({version:APP_VERSION,captureAt:c?.at||null,matches:c?m.reconcile(runs,c.activities,c.transactions).map(x=>({...x,monetary:m.monetary(x,c.contracts)})):[],paper:m.analytics(p.events),paperHeartbeatAgeMs:p.lastTick?Date.now()-Date.parse(p.lastTick):null,monitoringGaps:p.monitoringGaps,storageHealthy:PERSISTENT_STORAGE&&persistenceHealthy&&lockHeld,safety:v200.gate(DATA_DIR),brokerOrdersAllowed:false,certified:false})}catch{res.status(409).json({error:'MEGA_EVIDENCE_UNAVAILABLE'})}});
const execution600=require('./execution-v600');
let busy600=false;
app.post('/api/admin/v600/check',requireAdmin,async(_req,res)=>{if(busy600)return res.status(409).json({error:'BUSY'});busy600=true;try{const id=auth?.accountId;if(!id||!PERSISTENT_STORAGE||!persistenceHealthy||!lockHeld)throw Error('ACCOUNT_OR_STORAGE');const raw=await api('/positions','GET',null,'2');if(!Array.isArray(raw.positions)||raw.positions.length>20)throw Error('POSITION_SCHEMA');const stops=[];for(const p of raw.positions){const epic=p.market?.epic;if(!/^CS\.D\.[A-Z]{6}\.(CFD|MINI)\.IP$/.test(epic||''))continue;const c=await api('/markets/'+epic,'GET',null,'3');stops.push(execution600.stopEvidence(p,c))}if(auth?.accountId!==id||!persistenceHealthy||!lockHeld)throw Error('ACCOUNT_OR_STORAGE_CHANGED');const now=Date.now(),fixture=execution600.risk({pip:.0001,pipValue:1,gbpPerQuote:.7688881023717599,quoteAt:now,fxAt:now,entry:1.09656,stop:1.09776,target:1.09476,direction:'SELL',minSize:.1,sizeStep:.1,minStopPips:2,budget:25,dailyRemaining:100,exposureRemaining:25,precision:5},now);res.set('Cache-Control','no-store').json({version:APP_VERSION,riskFixture:fixture,riskFixtureScope:'historical Mini conversion with synthetic fresh timestamps and assumed size step; not live sizing',stops,recovery:execution600.recoveryTest(DATA_DIR),hosting:{uptimeSeconds:process.uptime(),storageConfigured:PERSISTENT_STORAGE,storageHealthy:persistenceHealthy&&lockHeld,alwaysOnVerified:false,streamStatus},safety:v200.gate(DATA_DIR),brokerOrdersAllowed:false,certified:false})}catch(e){res.status(409).json({error:'V600_CHECK_FAILED',detail:/^[A-Z_]+$/.test(e.message)?e.message:'BROKER_OR_STORAGE_REQUEST_FAILED'})}finally{busy600=false}});
const v1000=require('./execution-v1000'),v1100=require('./execution-v1100'),feed1200=require('./execution-v1200');
const boot1000=require('node:crypto').randomUUID();let busy1000=false,health1000=null;
setInterval(()=>{try{if(PERSISTENT_STORAGE&&persistenceHealthy&&lockHeld)health1000=v1000.health(DATA_DIR,Date.now(),boot1000)}catch{health1000=null}},60000).unref();
app.post('/api/admin/v1000/check',requireAdmin,async(_req,res)=>{if(busy1000)return res.status(409).json({error:'BUSY'});busy1000=true;try{const id=auth?.accountId;if(!id||!PERSISTENT_STORAGE||!persistenceHealthy||!lockHeld)throw Error('ACCOUNT_OR_STORAGE');const contracts=[],stops=[],errors=[],rawContracts=new Map(),delayMeta=new Map();const raw=await api('/positions','GET',null,'2');if(!Array.isArray(raw.positions)||raw.positions.length>20)throw Error('POSITION_SCHEMA');const epics=new Set([...MAJOR_EPICS,'CS.D.EURUSD.MINI.IP',...raw.positions.map(p=>p.market?.epic).filter(e=>/^CS\.D\.[A-Z]{6}\.(CFD|MINI)\.IP$/.test(e||''))]);for(const epic of epics){try{const c=await api('/markets/'+epic,'GET',null,'3');for(const p of raw.positions.filter(p=>p.market?.epic===epic))stops.push(execution600.stopEvidence(p,c));rawContracts.set(epic,c);delayMeta.set(epic,feed1200.metadata(c,Date.now()))}catch(e){errors.push({epic,error:/^[A-Z_]+$/.test(e.message)?e.message:'BROKER_REQUEST_FAILED'})}}const checkAt=Date.now();for(const [epic,c] of rawContracts)contracts.push(feed1200.inspect(epic,c,String(streamStatus).startsWith('CONNECTED')?streamQuotes:new Map(),checkAt,delayMeta));if(auth?.accountId!==id||!persistenceHealthy||!lockHeld)throw Error('ACCOUNT_OR_STORAGE_CHANGED');const recovery=process.memoryUsage().rss<300*1048576?await v1000.crashTest(DATA_DIR):{skipped:'MEMORY_GUARD'};res.set('Cache-Control','no-store').json({version:APP_VERSION,contracts,stops,errors,recovery,hosting:health1000,uptimeSeconds:process.uptime(),paper:require('./evidence-mega').analytics(paper50.status().events),safety:v200.gate(DATA_DIR),...feed1200.blockers(contracts,stops,String(streamStatus).startsWith('CONNECTED')),streamStatus,fxDiagnostics:[...MAJOR_EPICS].map(epic=>({epic,...feed1200.assess(streamQuotes.get(epic),delayMeta.get(epic),Date.now())})),brokerOrdersAllowed:false,certified:false})}catch(e){res.status(409).json({error:'V1000_CHECK_FAILED',detail:/^[A-Z_]+$/.test(e.message)?e.message:'REQUEST_FAILED'})}finally{busy1000=false}});
const v1500new=require('./execution-v1500');
// ---- IG DEMO autonomous execution (ig-exec). Independent of the legacy BROKER_DEMO_EXECUTION flag (left false).
// Starts only if IG_EXEC_ENABLED=true; any config problem leaves the app running paper-only.
// Push subscription routes (/api/push/*, pairing-token protected). Execution alerts reuse their subscriptions.
try{const pa=require('./push-alerts').createPushAlerts();pa.init().catch(e=>log('push init: '+e.message));pa.routes(app)}catch(e){log('push routes not mounted: '+e.message)}
let igExec=null,igExecWhy='IG_EXEC_ENABLED is not set to true';
try{if(process.env.IG_EXEC_ENABLED==='true'){igExec=require('./ig-exec').bootExecution({logger:console,paperEvents:()=>(status2000&&status2000.s&&status2000.s.events)||[]});app.use('/api/admin/ig-exec',igExec.router);igExecWhy=null}}catch(e){igExec=null;igExecWhy=String(e.message).slice(0,200);log('IG exec NOT started: '+igExecWhy)}
// Always answer (as JSON, admin-only) so the dashboard can say WHY execution is not running.
if(!igExec)app.use('/api/admin/ig-exec',requireAdmin,(_req,res)=>res.status(503).json({running:false,killed:true,reason:igExecWhy}));
function igOnDecision2000(result){try{if(!igExec||result.decision!=='PAPER_ENTRY')return;const sig=require('./ig-exec/src/adapter').toSignal(result.s.position);if(!sig){log('IG_EXEC skipped: IG_EXEC_SIZE not set or bad plan');return}igExec.engine.executeSignal(sig).then(r=>log('IG_EXEC '+sig.id+' '+JSON.stringify({ok:r.ok,reason:r.reason,dealId:r.dealId,ig:r.confirm}))).catch(e=>log('IG_EXEC error: '+e.message))}catch(e){log('IG_EXEC hook: '+e.message)}}
const sim2000=require('./execution-v2000');
const bars2000=new Map();let status2000={decision:'NOT_STARTED'},busy2000=false,pool2000;
function snapshot2000(now){const qs=new Map([...streamQuotes].map(([e,q])=>[e,sim2000.sample(q,now)]));const get=p=>qs.get('CS.D.'+p+'.CFD.IP');const g=get('GBPUSD');return MAJOR_FOREX.map(m=>{const e=m.epic,q=qs.get(e),pair=e.split('.')[2],cc=pair.slice(3),pip=cc==='JPY'?.01:.0001;let gbp=null;const cross=get('USD'+cc);if(g&&(cc==='USD'||cross))gbp=100000*pip/g.bid/(cc==='USD'?1:cross.bid);let b=bars2000.get(e)||[];if(q){const bucket=Math.floor(q.at/FIVE)*FIVE,last=b.at(-1);if(!last||bucket>last.bucket){b.push({bucket,close:(q.bid+q.ask)/2,ticks:1,at:q.at});b=b.slice(-31)}else if(bucket===last.bucket&&q.at>last.at){last.close=(q.bid+q.ask)/2;last.ticks++;last.at=q.at}bars2000.set(e,b)}const closed=b.slice(0,-1),ready=closed.length===30&&closed.every((x,i)=>x.ticks>=2&&(!i||x.bucket-closed[i-1].bucket===FIVE));const a=closed.map(x=>x.close),r=rsi(a),e9=ema(a,9),e21=ema(a,21),direction=e9>e21&&r>=52&&r<=68?'LONG':e9<e21&&r>=32&&r<=48?'SHORT':'WAIT',score=direction==='WAIT'?0:Math.min(90,Math.round(55+Math.min(20,Math.abs(e9-e21)/a.at(-1)*20000)+Math.max(0,15-Math.abs(r-(direction==='LONG'?60:40)))));return {epic:e,quote:q,pip,gbp,ready,bar:closed.length?new Date(closed.at(-1).bucket).toISOString():null,direction,score,rsi:r,ema9:e9,ema21:e21,bars:closed.length}})}
async function tick2000(control){if(busy2000)throw Error('BUSY');busy2000=true;try{if(!auth?.accountId||!process.env.DATABASE_URL)throw Error('ACCOUNT_OR_DATABASE_UNAVAILABLE');const key=require('node:crypto').createHash('sha256').update(auth.accountId).digest('hex');if(!pool2000)pool2000=new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:5000,idleTimeoutMillis:10000});const now=Date.now(),ms=snapshot2000(now);const result=await sim2000.transaction(pool2000,key,s=>typeof control==='boolean'?{s:{...s,enabled:control},decision:control?'ENABLED':'PAUSED'}:sim2000.advance(s,ms,now));status2000={...result,at:new Date(now).toISOString(),markets:ms,mode:'EXPERIMENTAL_PAPER_ONLY',brokerOrdersAllowed:false,certified:false};igOnDecision2000(result);return status2000}catch(e){status2000={decision:'DATABASE_OR_INPUT_ERROR',brokerOrdersAllowed:false};throw e}finally{busy2000=false}}
setInterval(()=>{if(!busy2000&&auth?.accountId)tick2000().catch(()=>{})},5000).unref();
app.get('/api/admin/v2000/status',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(status2000));
for(const [route,on] of [['start',true],['pause',false]])app.post('/api/admin/v2000/'+route,requireAdmin,async(_req,res)=>{try{res.json(await tick2000(on))}catch{res.status(409).json({error:'SIMULATION_UNAVAILABLE'})}});

let report1500=null,busy1500=false,pool1500=null;
async function collect1500(){if(busy1500||!auth?.accountId)return;busy1500=true;const id=auth.accountId;try{const raw=await api('/positions','GET',null,'2');if(!Array.isArray(raw.positions))throw Error('POSITION_SCHEMA');const cs=new Map(),qs=new Map(),meta=new Map(),errors=[];for(const epic of [...MAJOR_EPICS,'CS.D.EURUSD.MINI.IP']){try{const c=await api('/markets/'+epic,'GET',null,'3'),at=Date.now();cs.set(epic,{c,at});meta.set(epic,feed1200.metadata(c,at))}catch{errors.push(epic)}}const now=Date.now();for(const [epic,{c,at}] of cs)qs.set(epic,v1500new.restQuote(c,at,now));const rows=[...cs].map(([epic,{c}])=>{const row=feed1200.inspect(epic,c,streamQuotes,now,meta);return {...row,restQuote:qs.get(epic),restRisk:v1500new.restRisk(row,qs)}});const stops=raw.positions.filter(p=>cs.has(p.market?.epic)).map(p=>execution600.stopEvidence(p,cs.get(p.market.epic).c));if(auth?.accountId!==id)throw Error('ACCOUNT_CHANGED');report1500={version:APP_VERSION,at:new Date(now).toISOString(),rows,errors,stops,positionCount:raw.positions.length,rawFeed:[...diagnostics.values()].filter(d=>d.kind==='pricing').map(d=>({epic:d.epic,subscribed:d.subscribed,updates:d.updates,delay:v1500new.rawDelay(d.lastFields?.DELAY),timestamp:d.lastFields?.TIMESTAMP??null,errors:d.errors})),...feed1200.blockers(rows,stops,String(streamStatus).startsWith('CONNECTED')),hosting:health1000,storageHealthy:PERSISTENT_STORAGE&&persistenceHealthy&&lockHeld,safety:v200.gate(DATA_DIR),brokerOrdersAllowed:false,certified:false};}catch{report1500={version:APP_VERSION,error:'COLLECTION_FAILED',brokerOrdersAllowed:false,certified:false}}finally{busy1500=false}}
setInterval(()=>{void collect1500()},300000).unref();
app.get('/api/admin/v1500/consolidated',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json({report:report1500,busy:busy1500,brokerOrdersAllowed:false}));
app.post('/api/admin/v1500/consolidated',requireAdmin,async(_req,res)=>{if(busy1500)return res.status(409).json({error:'BUSY'});await collect1500();res.set('Cache-Control','no-store').json(report1500||{error:'NOT_AUTHENTICATED',brokerOrdersAllowed:false})});
let dbBusy1500=false;
app.post('/api/admin/v1500/database',requireAdmin,async(_req,res)=>{if(dbBusy1500)return res.status(409).json({error:'BUSY'});if(!process.env.DATABASE_URL)return res.json({configured:false,brokerOrdersAllowed:false});dbBusy1500=true;try{if(!pool1500)pool1500=new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:5000,idleTimeoutMillis:10000});res.json({...await v1500new.journalProbe(pool1500),brokerOrdersAllowed:false})}catch{res.status(409).json({error:'DATABASE_PROBE_FAILED',brokerOrdersAllowed:false})}finally{dbBusy1500=false}});
const port=Number(process.env.PORT)||3000;acquireLocalLock();app.listen(port,'0.0.0.0',()=>{restoreTrade();restoreCandles();try{fs.mkdirSync(DATA_DIR,{recursive:true});const probe=path.join(DATA_DIR,'.write-test');fs.writeFileSync(probe,'ok');fs.unlinkSync(probe)}catch{persistenceHealthy=false}void init()});
setInterval(()=>{if(!starting)refreshAccount().catch(e=>log('Account refresh: '+e.message))},120000);
setInterval(()=>{if(!starting&&(!client||streamStatus==='error'||streamStatus==='disconnected'||String(streamStatus).startsWith('DISCONNECTED'))&&Date.now()>reconnectAt){reconnectAt=Date.now()+60000;void init()}},30000);
