'use strict';
require('dotenv').config();
const express=require('express'), path=require('path'), fs=require('fs');
const {LightstreamerClient,Subscription}=require('lightstreamer-client-node');
const {PaperEngine}=require('./paper-engine');
const {summarizeFeed,feedFresh}=require('./feed-health');
const APP_VERSION='7.5.0';
const {PaperArchiver}=require('./paper-archiver');
const {getPaperEvents}=require('./paper-store');
const {inspectPaperRecovery}=require('./paper-recovery');
const {createRiskStore}=require('./risk-store');
const {createPushAlerts}=require('./push-alerts');
const {createV9Paper}=require('./v9-paper');
if(process.env.IG_ACCOUNT_TYPE!=='DEMO')throw Error('Refusing to start: IG_ACCOUNT_TYPE must equal DEMO');
const app=express();app.use(express.json({limit:'12kb'}));app.use(express.static(path.join(__dirname,'public')));
const HOST='https://demo-api.ig.com/gateway/deal';
// Fixed allowlist: no IG market search calls at startup.
const MAJOR_FOREX = Object.freeze([
 ['EURUSD','EUR/USD'],['GBPUSD','GBP/USD'],['USDJPY','USD/JPY'],
 ['USDCHF','USD/CHF'],['USDCAD','USD/CAD'],['AUDUSD','AUD/USD'],['NZDUSD','NZD/USD']
].map(([pair,name])=>({epic:`CS.D.${pair}.CFD.IP`,name})));
const MAJOR_EPICS=new Set(MAJOR_FOREX.map(x=>x.epic));

const FIVE=300000, MAX=Math.min(7,Math.max(1,Number(process.env.MAX_STREAM_MARKETS)||7));
const MAX_DISCOVERY_NODES=Math.min(100,Math.max(1,Number(process.env.DISCOVERY_NODE_LIMIT)||45));
const MAX_DISCOVERY_MARKETS=Math.min(500,Math.max(1,Number(process.env.DISCOVERY_MARKET_LIMIT)||150));
const configEpics=MAJOR_FOREX.map(x=>x.epic); // IG_EPICS cannot override the major-pair allowlist
const MULTI_MODE=process.env.MP_MULTI_MODE==='true';
const TEST_ONE=MULTI_MODE?false:process.env.TEST_ONE_FOREX!=='false';
const PROBE_MINI=false; // No MINI instruments in major-only mode
const PROBE_ACCOUNT=process.env.PROBE_ACCOUNT_STREAM!=='false';
const REST_POLL_SECONDS=Math.min(600,Math.max(120,Number(process.env.REST_POLL_SECONDS)||300));
const REST_MAX_MARKETS=Math.min(2,Math.max(1,Number(process.env.REST_MAX_MARKETS)||1));
const REST_STALE_MS=REST_POLL_SECONDS*2500;
// Explicit operator opt-in: defaults to monitor-only even when a user arms the UI.
const BROKER_DEMO_EXECUTION=process.env.MP_V65_DEMO_EXECUTION==='true' && process.env.ENABLE_IG_DEMO_ORDERS==='true' && process.env.IG_ACCOUNT_TYPE==='DEMO'; // IG DEMO only; multi-engine gates still apply
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
function acquireLocalLock(){if(!PERSISTENT_STORAGE)return;fs.mkdirSync(DATA_DIR,{recursive:true});try{fs.mkdirSync(LOCK_DIR);lockHeld=true;fs.writeFileSync(path.join(LOCK_DIR,'pid'),String(process.pid))}catch(e){throw Error('Another MarketPulse instance may be running, or a stale lock exists. Inspect '+LOCK_DIR+' before manually removing it: '+e.message)}}
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
const paperArchiver=new PaperArchiver();
const {durablePaperTick,restorePaperEngine}=require('./paper-durable');
// Fail closed until archived paper trading state has been checked.
let paperRecoveryReady=false;
let paperRecoveryStatus={state:'NOT_CHECKED'};

async function recoverPaperOnStartup(){
  paperRecoveryReady=false;
  paperRecoveryStatus={state:'CHECKING'};

  try{
    const result=await inspectPaperRecovery();

    paperRecoveryStatus={
      state:result.safeToResume?'INSPECTED':'BLOCKED',
      ...result
    };

    // Restore counters only for inspection. No automatic trading authorization.
    if(result.safeToResume)restorePaperEngine(paper,result);
    paperRecoveryReady=false;

    log('Paper recovery: '+paperRecoveryStatus.state+
        ', archived events='+result.archivedEvents);

  }catch(e){
    paperRecoveryReady=false;
    paperRecoveryStatus={
      state:'ERROR',
      error:e.message
    };
    log('Paper recovery failed: '+e.message);
  }
}
const paper=new PaperEngine({epic:'CS.D.EURUSD.CFD.IP',dailyCap:2,stopPips:12,targetPips:18,maxSpreadPips:2,holdMinutes:180,cooldownMinutes:30,minScore:70});
let accepted=new Set(),diagnostics=new Map();
let probeStartedAt=null,restSnapshot=null,restSnapshotError="",restSnapshotAt=null;
let auth=null,client=null,sub=null,streamStatus='disconnected',streamError='',lastConnected=null,account=null,positions=[],lastAccountRefresh=null,lastDiscovery=null,discoverError='',reconnectAt=0,starting=false;
function log(msg){events.unshift({time:new Date().toISOString(),message:String(msg).slice(0,300)});events.length=Math.min(events.length,100);console.log('[MarketPulse]',msg)}
function n(v){if(v===null||v===undefined||v==='')return null;const x=Number(String(v).replace(/,/g,''));return Number.isFinite(x)?x:null}
async function request(url,method='GET',body=null,version='1'){
 const headers={'X-IG-API-KEY':process.env.IG_API_KEY||'',VERSION:version,Accept:'application/json'};
 if(auth){headers.CST=auth.cst;headers['X-SECURITY-TOKEN']=auth.xst}
 if(body!==null)headers['Content-Type']='application/json';
 const res=await fetch(HOST+url,{method,headers,body:body===null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
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
    if(d){d.subscribed=false;d.errors.push({code,message:String(message).slice(0,150)});}
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
   onSubscriptionError(code,message){accepted.delete(key);const d=diagnostics.get(key);d.subscribed=false;d.errors.push({code,message:String(message).slice(0,150)});log('Account probe error '+code+': '+message)},
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
async function openDemo(direction,{manualTest=false}={}){throw Error('Monetary risk verification incomplete: IG DEMO order blocked');if(!BROKER_DEMO_EXECUTION)throw Error('Broker demo orders disabled by ENABLE_IG_DEMO_ORDERS');if(manualTest){if(!manualDemoQuoteReady())throw Error('Manual demo test requires a fresh undelayed IG streaming quote and tradeable market');}else if(!streamTradeReady())throw Error('Live streaming readiness lost; order blocked');const payload={currencyCode:'USD',direction:direction==='LONG'?'BUY':'SELL',epic:TRADE_EPIC,expiry:'-',forceOpen:true,guaranteedStop:false,orderType:'MARKET',size:TRADE_SIZE,stopDistance:TRADE_STOP_DISTANCE,limitDistance:TRADE_LIMIT_DISTANCE};
 // Instrument currencyCode is not always USD; explicitly restrict to EUR/USD CFD until validated.
 if(TRADE_EPIC!=='CS.D.EURUSD.CFD.IP')throw Error('Automatic execution currently restricted to EUR/USD CFD');
 trade.pendingOrder={kind:'OPEN',epic:TRADE_EPIC,direction:payload.direction,createdAt:new Date().toISOString(),status:'SUBMISSION_UNKNOWN'};saveTrade();if(!persistenceHealthy)throw Error('Durable trade-state write failed');const response=await api('/positions/otc','POST',payload,'2');const conf=await confirmDeal(response.dealReference);if(!conf.dealId)throw Error('Accepted but no dealId; reconcile manually');trade.tracked={dealId:conf.dealId,epic:TRADE_EPIC,direction:payload.direction,size:TRADE_SIZE,openedAt:new Date().toISOString()};trade.dailyOpens++;recordTrade('OPEN_CONFIRMED',{dealId:conf.dealId,direction:payload.direction,size:TRADE_SIZE});if(!persistenceHealthy)throw Error('Cannot persist confirmed open');trade.pendingOrder=null;saveTrade();return conf}
async function closeDemo(reason){if(!trade.tracked)return;const pos=trade.tracked;const payload={dealId:pos.dealId,direction:pos.direction==='BUY'?'SELL':'BUY',orderType:'MARKET',size:pos.size};
 // IG documented close route uses POST + _method: DELETE header, VERSION:1.
 const headers={'X-IG-API-KEY':process.env.IG_API_KEY||'',CST:auth.cst,'X-SECURITY-TOKEN':auth.xst,VERSION:'1','Content-Type':'application/json',Accept:'application/json','_method':'DELETE'};
 trade.pendingOrder={kind:'CLOSE',dealId:pos.dealId,createdAt:new Date().toISOString(),status:'SUBMISSION_UNKNOWN'};saveTrade();if(!persistenceHealthy)throw Error('Durable trade-state write failed');const response=await fetch(HOST+'/positions/otc',{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});const raw=await response.text();let data;try{data=JSON.parse(raw)}catch{data={}}if(!response.ok||data.errorCode)throw Error('IG close failed: '+response.status+' '+(data.errorCode||raw.slice(0,100)));
 const conf=await confirmDeal(data.dealReference);recordTrade('CLOSE_CONFIRMED',{dealId:pos.dealId,reason,confirmation:conf.dealStatus});trade.tracked=null;trade.lastClosedAt=Date.now();saveTrade();if(!persistenceHealthy)throw Error('Cannot persist confirmed close');trade.pendingOrder=null;saveTrade();return conf}

// Manual broker lifecycle tests do not need EMA/RSI warm-up. Automatic trading still does.
// Reject REST snapshots, stale quotes, unknown market status, and delayed quotes.
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

async function tradingCycle(){if(trade.pendingOrder)return;if(!BROKER_DEMO_EXECUTION||!trade.armed||!trade.executionEnabled||trade.busy||starting||!brokerReconciled||!persistenceHealthy)return;trade.busy=true;
 try{if(!tradingConfigValid())throw Error('Missing or invalid demo risk configuration');if(!auth||!auth.accountId||!account||account.accountId!==auth.accountId)throw Error('Demo account not verified');
 const today=new Date().toISOString().slice(0,10);if(today!==trade.day){trade.day=today;trade.dailyOpens=0;saveTrade()}
 const all=await reconcilePositions();if(!brokerReconciled)throw Error('Broker reconciliation incomplete');const q=quotes.get(TRADE_EPIC),s=analyse(TRADE_EPIC);
 const fresh=q&&Date.now()-q.at<15000&&q.marketState==='DEAL'&&q.source==='STREAM'&&(q.delayed===null||String(q.delayed)==='0');
 const spread=q?q.ask-q.bid:Infinity;
 trade.lastDecision={at:new Date().toISOString(),direction:s.direction,score:s.score,bars:s.bars,priceSource:q?.source||null,spread,reason:s.reason};
 if(trade.tracked){const owned=all.find(x=>x.dealId===trade.tracked.dealId);if(!owned){disarm('Tracked position missing; reconcile manually');return}
  const age=Date.now()-Date.parse(trade.tracked.openedAt);
  const opposite=(trade.tracked.direction==='BUY'&&s.direction==='SHORT')||(trade.tracked.direction==='SELL'&&s.direction==='LONG');
  if(age>=TRADE_MAX_HOLD_MINUTES*60000||opposite){if(!fresh){disarm('Cannot close automatically: price stale; check IG demo manually');return}await closeDemo(age>=TRADE_MAX_HOLD_MINUTES*60000?'MAX_HOLD':'REVERSAL')}
  return;
 }
 if(all.length){trade.lastDecision.reason='Existing account positions detected; no new orders';return}
 if(trade.dailyOpens>=TRADE_DAILY_CAP)return;
 if(Date.now()-trade.lastClosedAt<TRADE_COOLDOWN_MINUTES*60000)return;
 if(!fresh||spread>TRADE_MAX_SPREAD||!Number.isFinite(spread))return;
 if(!['LONG','SHORT'].includes(s.direction)||s.score<TRADE_MIN_SCORE)return;
 if(!streamTradeReady())return;
 const completed=candles.get(TRADE_EPIC)||[];
 const signalBar=completed.at(-1)?.time;
 if(!signalBar||trade.lastSignalBar===signalBar)return;
 trade.lastSignalBar=signalBar;saveTrade();
 if(!trade.armed)return; // persistence failure disarms
 await openDemo(s.direction);
 }catch(e){trade.lastError=String(e.message).slice(0,250);trade.operatorStop=true;saveTrade();disarm('Trading error; manual review required');log('Demo trading stopped: '+trade.lastError)}finally{trade.busy=false}}

async function init(){if(starting)return;starting=true;brokerReconciled=false;disarm('Reconnect requires re-arming');try{closeStream();await login();await discover();await refreshAccount();const brokerPositions=await reconcilePositions();brokerReconciled=true;if(brokerPositions.length||trade.tracked)log('Broker reconciliation: '+brokerPositions.length+' open position(s), bot tracked='+Boolean(trade.tracked));await checkRestSnapshot();startStream();startRestPolling()}catch(e){streamStatus='error';streamError=e.message;log('Startup: '+e.message)}finally{starting=false}}
function requireAdmin(req,res,next){const token=process.env.ADMIN_TOKEN;if(!token)return res.status(503).json({error:'Set ADMIN_TOKEN in Render'});const supplied=req.get('X-Admin-Token')||'';const crypto=require('crypto');const a=Buffer.from(supplied),b=Buffer.from(token);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(403).json({error:'Invalid admin token'});next()}
app.get('/api/paper/analytics',async(_req,res)=>{
 try{
  const {calculatePaperAnalytics}=require('./paper-analytics');
  const snapshot=paper.snapshot();
  const history=await getPaperEvents(10000);
  res.json({
   version:APP_VERSION,
   simulationOnly:true,
   ephemeral:false,
   warning:'Historical simulated events are stored in PostgreSQL. Open positions and pending writes are not yet restart-safe. P/L is simulated pips, not GBP.',
   startedAt:snapshot.startedAt,
   analytics:calculatePaperAnalytics(history)
  });
 }catch(e){
  log('Paper analytics database error: '+e.message);
  res.status(503).json({
   error:'Historical paper analytics temporarily unavailable',
   simulationOnly:true,
   storage:'PostgreSQL'
  });
 }
});
app.get('/api/paper/recovery',(_req,res)=>{
 res.json({
  version:APP_VERSION,
  simulationOnly:true,
  tradingReady:paperRecoveryReady,
  recovery:paperRecoveryStatus,
  note:'Paper trading remains paused until recovery is verified. IG broker orders remain blocked.'
 });
});
app.get('/api/feed/health',(_req,res)=>{
 const epic='CS.D.EURUSD.CFD.IP';
 const q=quotes.get(epic);
 const diag=diagnostics.get(epic+'|pricing');
 res.set('Cache-Control','no-store');
 res.json({version:APP_VERSION,simulationOnly:true,epic,streamStatus,hasStreamError:Boolean(streamError),lastConnected,
  ...summarizeFeed({quote:q,diagnostic:diag,now:Date.now(),streamStatus,restState,restSnapshotError}),
  note:'Diagnostics only. A fresh quote does not authorise paper or broker trading.'});
});
app.get('/api/paper',(_req,res)=>res.json({version:APP_VERSION,mode:'IG_DEMO_RENDER_FREE_EXPERIMENTAL',...paper.snapshot()}));
app.post('/api/admin/paper/reset',requireAdmin,(_req,res)=>{
  return res.status(409).json({
    ok:false,
    simulationOnly:true,
    error:'Paper reset disabled until durable recovery and reset reconciliation are implemented'
  });
});
app.get('/api/health',(req,res)=>res.json({ok:true,version:APP_VERSION,mode:'IG_DEMO_RENDER_FREE_EXPERIMENTAL',streamStatus,marketCount:markets.size,brokerDemoExecutionEnabled:BROKER_DEMO_EXECUTION}));
app.get('/api/state',(req,res)=>{const now=Date.now(),list=[...markets.values()].map(m=>{const q=quotes.get(m.epic),s=analyse(m.epic);return {...m,...s,lastBarTime:(candles.get(m.epic)||[]).at(-1)?.time||null,streaming:Boolean(q&&now-q.at<(q.source==='REST'?REST_STALE_MS:20000)),bid:q?.bid??null,ask:q?.ask??null,spread:q?.spread??null,marketState:q?.marketState||'UNKNOWN',lastTick:q?new Date(q.at).toISOString():null,ageSeconds:q?Math.round((now-q.at)/1000):null,priceSource:q?.source==='REST'?'REST_POLLING':q?.source||null,igUpdateTime:q?.igUpdateTime||null}});
 res.set('Cache-Control','no-store');res.json({version:APP_VERSION,feedHealth:summarizeFeed({quote:quotes.get('CS.D.EURUSD.CFD.IP'),diagnostic:diagnostics.get('CS.D.EURUSD.CFD.IP|pricing'),now,streamStatus,restState,restSnapshotError}),mode:'IG_DEMO_RENDER_FREE_EXPERIMENTAL',auto:trade.armed,brokerDemoExecutionEnabled:BROKER_DEMO_EXECUTION,paper:paper.snapshot(),storage:{persistentConfirmed:PERSISTENT_STORAGE,ephemeral:!PERSISTENT_STORAGE,ephemeralDemoOptIn:EPHEMERAL_DEMO,oracleVm:false,healthy:persistenceHealthy,brokerReconciled,dir:DATA_DIR},orderExecutionEnabled:trade.executionEnabled,executionReadiness:{manualTestQuoteReady:manualDemoQuoteReady(),demoLifecycleVerified:DEMO_EXECUTION_TESTED,brokerEnabled:BROKER_DEMO_EXECUTION,storageConfirmed:PERSISTENT_STORAGE,ephemeralDemoOptIn:EPHEMERAL_DEMO,persistenceHealthy,brokerReconciled,configValid:tradingConfigValid(),pendingOrder:!!trade.pendingOrder,operatorStop:trade.operatorStop,streamReady:streamTradeReady()},trading:tradePublic(),streamStatus,streamError,lastConnected,account:null,positions:[],lastAccountRefresh,lastDiscovery,discoverError,marketCount:markets.size,subscribedCount:[...accepted].filter(x=>!x.startsWith('ACCOUNT|')).length,priceReceivingCount:list.filter(x=>x.priceSource==='STREAM'&&x.lastTick&&x.ageSeconds<20).length,restReceivingCount:list.filter(x=>x.priceSource==='REST_POLLING'&&x.ageSeconds<REST_STALE_MS/1000).length,restFallback:restState,diagnostics:Object.fromEntries([...diagnostics].map(([k,v])=>[k,{...v,item:v.item?.replace(/PRICE:[^:]+:/,'PRICE:[REDACTED]:')}])),probeStartedAt,restSnapshot,restSnapshotError,restSnapshotAt,testOneForex:TEST_ONE,streamCap:MAX,markets:list,activity:events.slice(0,30),note:'IG DEMO ONLY. Ephemeral mode is best effort; restart can erase trade history and daily caps. Requires verified dealing rules, broker reconciliation, live stream and operator enablement.'})});
app.get('/api/ig/test',requireAdmin,async(req,res)=>{try{const a=await api('/accounts');res.json({ok:true,accountsReturned:a.accounts?.length||0,note:'No orders placed. Restart stream using admin reconnect if necessary.'})}catch(e){res.status(502).json({error:e.message})}});
app.post('/api/admin/reconnect',requireAdmin,async(req,res)=>{await init();res.json({ok:true,streamStatus,streamError})});
app.post('/api/admin/refresh',requireAdmin,async(req,res)=>{try{await refreshAccount();res.json({ok:true,account,positions})}catch(e){res.status(502).json({error:e.message})}});

app.post('/api/admin/trading/arm',requireAdmin,async(req,res)=>{if(MULTI_MODE)return res.status(409).json({error:'Legacy single-market arm disabled in multi mode; check /api/multi/status'});if(!BROKER_DEMO_EXECUTION)return res.status(409).json({error:'IG demo broker execution is disabled'});if(!DEMO_EXECUTION_TESTED)return res.status(409).json({error:'IG demo order lifecycle and recovery tests must be verified before unattended arming'});if(!STORAGE_ALLOWED||!persistenceHealthy||!brokerReconciled)return res.status(409).json({error:'Storage opt-in, healthy writes and broker reconciliation required before arming'});if(!streamTradeReady())return res.status(409).json({error:'Live IG PRICE feed and 30 consecutive genuine streaming bars required; REST fallback is not eligible'});if(trade.busy)return res.status(409).json({error:'Trading cycle running'});if(!tradingConfigValid())return res.status(400).json({error:'Verify IG minimum size and stop units; configure valid size, stop, limit and spread first'});if(TRADE_EPIC!=='CS.D.EURUSD.CFD.IP')return res.status(400).json({error:'Only EUR/USD CFD auto-execution supported'});if(req.body?.confirm!=='ARM_DEMO_ONLY')return res.status(400).json({error:'Send JSON {"confirm":"ARM_DEMO_ONLY"}'});try{const marketInfo=await api('/markets/'+encodeURIComponent(TRADE_EPIC));if(marketInfo.snapshot?.marketStatus!=='TRADEABLE')return res.status(409).json({error:'Market not tradeable'});const minDist=Number(marketInfo.dealingRules?.minNormalStopOrLimitDistance?.value);const igMinSize=Number(marketInfo.dealingRules?.minDealSize?.value);if(Number.isFinite(igMinSize)&&igMinSize>0&&TRADE_SIZE<igMinSize)return res.status(400).json({error:'Trade size below IG reported minimum',igMinSize});if(Number.isFinite(minDist)&&TRADE_STOP_DISTANCE<minDist)return res.status(400).json({error:'Stop distance below IG reported minimum',minDist});if(!VERIFIED_STOP_UNITS||VERIFIED_MIN_SIZE<=0)return res.status(409).json({error:'Verify IG stop distance units and minimum size first'});const all=await reconcilePositions();if(all.length||trade.tracked)return res.status(409).json({error:'Existing demo position or tracked deal; review and close manually before arming',positions:all});if(!account||account.accountId!==auth.accountId||!Number.isFinite(account.balance)||account.balance<=0)return res.status(409).json({error:'Account mismatch'});trade.operatorStop=false;saveTrade();trade.armed=true;trade.executionEnabled=true;trade.haltReason=null;trade.lastError=null;log('DEMO automation explicitly armed by admin');res.json({ok:true,trading:tradePublic()})}catch(e){res.status(502).json({error:e.message})}});
app.post('/api/admin/trading/stop',requireAdmin,(req,res)=>{trade.operatorStop=true;saveTrade();disarm('Emergency stop requested by admin. Existing positions remain open with broker stops.');res.json({ok:true,trading:tradePublic()})});
app.post('/api/admin/trading/close',requireAdmin,async(req,res)=>{if(MULTI_MODE)return res.status(409).json({error:'Legacy close disabled in multi mode; close in IG Demo and reconcile'});if(trade.busy)return res.status(409).json({error:'Trading cycle running'});disarm('Admin requested close');trade.busy=true;try{if(!trade.tracked)return res.status(409).json({error:'No bot-tracked position. Check IG manually.'});const all=await reconcilePositions();if(!all.some(x=>x.dealId===trade.tracked?.dealId))return res.status(409).json({error:'Tracked position not found'});await closeDemo('ADMIN_CLOSE');res.json({ok:true,trading:tradePublic()})}catch(e){trade.lastError=e.message;res.status(502).json({error:e.message,warning:'Check IG demo account for actual position status before retrying'})}finally{trade.busy=false}});


// V4.0: Configurable demo controls. Updates disarm automation and do not arm on restart.
const RISK_SETTINGS_PATH=process.env.RISK_SETTINGS_PATH||RISK_STATE_PATH;
function riskValues(){return {size:TRADE_SIZE,stopDistance:TRADE_STOP_DISTANCE,limitDistance:TRADE_LIMIT_DISTANCE,maxSpread:TRADE_MAX_SPREAD,minScore:TRADE_MIN_SCORE,maxHoldMinutes:TRADE_MAX_HOLD_MINUTES,cooldownMinutes:TRADE_COOLDOWN_MINUTES,dailyCap:TRADE_DAILY_CAP}}
function restoreRisk(){try{const x=JSON.parse(fs.readFileSync(RISK_SETTINGS_PATH,'utf8'));if(x&&typeof x==='object')applyRisk(x)}catch(e){if(e.code!=='ENOENT')log('Risk settings restore failed: '+e.message)}}
function riskErrors(x){
 const errors=[];
 const keys=['size','stopDistance','limitDistance','maxSpread','minScore','maxHoldMinutes','cooldownMinutes','dailyCap'];
 if(!x||typeof x!=='object')return ['Missing risk configuration'];
 for(const k of keys)if(typeof x[k]!=='number'||!Number.isFinite(x[k]))errors.push(k+': enter a finite number');
 if(errors.length)return errors;
 if(!(VERIFIED_MIN_SIZE>0))errors.push('Server: IG_VERIFIED_MIN_SIZE is not configured (verify minimum deal size first)');
 else if(x.size<VERIFIED_MIN_SIZE)errors.push('Deal size below verified minimum '+VERIFIED_MIN_SIZE);
 if(x.size>1)errors.push('Deal size exceeds bot maximum of 1');
 if(!VERIFIED_STOP_UNITS)errors.push('Server: IG_VERIFIED_STOP_UNITS is not enabled; verify API distance mapping first');
 if(x.stopDistance<=0)errors.push('Stop distance must be greater than zero');
 if(x.limitDistance<=0)errors.push('Limit distance must be greater than zero');
 if(x.maxSpread<=0||x.maxSpread>0.01)errors.push('Maximum spread must be above zero and no more than 0.01 price units');
 if(x.minScore<65||x.minScore>90)errors.push('Minimum score must be between 65 and 90');
 if(x.maxHoldMinutes<15||x.maxHoldMinutes>1440)errors.push('Maximum hold must be 15–1440 minutes');
 if(x.cooldownMinutes<5||x.cooldownMinutes>1440)errors.push('Cooldown must be 5–1440 minutes');
 if(!Number.isInteger(x.dailyCap)||x.dailyCap<1||x.dailyCap>3)errors.push('Daily open cap must be an integer from 1 to 3');
 return errors;
}
function validateRisk(x){const errors=riskErrors(x);if(errors.length){const e=new Error('Risk settings rejected: '+errors.join('; '));e.validationErrors=errors;throw e;}}
function applyRisk(x){validateRisk(x);TRADE_SIZE=x.size;TRADE_STOP_DISTANCE=x.stopDistance;TRADE_LIMIT_DISTANCE=x.limitDistance;TRADE_MAX_SPREAD=x.maxSpread;TRADE_MIN_SCORE=x.minScore;TRADE_MAX_HOLD_MINUTES=x.maxHoldMinutes;TRADE_COOLDOWN_MINUTES=x.cooldownMinutes;TRADE_DAILY_CAP=x.dailyCap;}
function saveRisk(){fs.mkdirSync(path.dirname(RISK_SETTINGS_PATH),{recursive:true});const tmp=RISK_SETTINGS_PATH+'.tmp';fs.writeFileSync(tmp,JSON.stringify(riskValues()));fs.renameSync(tmp,RISK_SETTINGS_PATH)}
app.get('/control',(req,res)=>res.sendFile(path.join(__dirname,'public','control.html')));
app.get('/api/admin/trading/status',requireAdmin,(req,res)=>res.json({ok:true,trading:tradePublic(),risk:riskValues(),account,positions}));
app.post('/api/admin/trading/config',requireAdmin,(req,res)=>{if(trade.busy||trade.tracked)return res.status(409).json({error:'Cannot change risk settings while bot is busy or tracking a position'});try{validateRisk(req.body);const old=riskValues();disarm('Risk settings changed; explicit re-arm required');applyRisk(req.body);try{saveRisk()}catch(e){applyRisk(old);throw e}res.json({ok:true,risk:riskValues(),trading:tradePublic(),note:'Changes disarm automation. AUTO_START may re-arm only after validated checks and no operator stop.'})}catch(e){res.status(400).json({error:e.message,validationErrors:e.validationErrors||[]})}});
app.post('/api/admin/trading/preview',requireAdmin,async(req,res)=>{try{const market=await api('/markets/'+encodeURIComponent(TRADE_EPIC));const q=quotes.get(TRADE_EPIC);const all=await reconcilePositions();res.json({ok:true,validConfig:tradingConfigValid(),validationErrors:riskErrors(riskValues()),risk:riskValues(),marketStatus:market.snapshot?.marketStatus||'UNKNOWN',dealingRules:market.dealingRules||null,existingPositions:all.length,botTracked:!!trade.tracked,price:q?{bid:q.bid,ask:q.ask,source:q.source,ageSeconds:Math.round((Date.now()-q.at)/1000)}:null,note:'PREVIEW ONLY: no order submitted. Check IG dealing rules and contract value.'})}catch(e){res.status(502).json({error:e.message})}});
app.post('/api/admin/trading/manual-test',requireAdmin,async(req,res)=>{if(MULTI_MODE)return res.status(409).json({error:'Legacy single-market manual test disabled in multi mode; use IG Demo platform for controlled tests'});if(!BROKER_DEMO_EXECUTION||!STORAGE_ALLOWED||!persistenceHealthy||!brokerReconciled)return res.status(409).json({error:'Demo execution, storage opt-in and reconciliation must be enabled'});if(!manualDemoQuoteReady())return res.status(409).json({error:'Manual demo test needs a fresh, explicitly non-delayed IG streaming quote (DELAY=0), not REST data. No 30-bar warm-up required.'});if(trade.busy||trade.armed)return res.status(409).json({error:'Disarm automation and wait for active cycle'});if(req.body?.confirm!=='PLACE_IG_DEMO_ORDER'||!['BUY','SELL'].includes(req.body?.direction))return res.status(400).json({error:'Explicit confirmation PLACE_IG_DEMO_ORDER and direction BUY or SELL required'});if(!tradingConfigValid())return res.status(400).json({error:'Invalid risk settings'});trade.busy=true;try{if(trade.tracked)throw Error('Bot already tracks a position');const all=await reconcilePositions();if(all.length)throw Error('Account already has positions');const market=await api('/markets/'+encodeURIComponent(TRADE_EPIC));if(market.snapshot?.marketStatus!=='TRADEABLE')throw Error('Market is not tradeable');const rule=market.dealingRules?.minNormalStopOrLimitDistance;
 if(rule?.unit!=='POINTS'||!Number.isFinite(Number(rule.value)))throw Error('IG stop/limit distance units not verified as POINTS');
 const min=Number(rule.value);
 if(TRADE_STOP_DISTANCE<min||TRADE_LIMIT_DISTANCE<min)throw Error('Stop or limit distance below IG minimum');
 if(!VERIFIED_STOP_UNITS||VERIFIED_MIN_SIZE<=0)throw Error('IG contract settings not verified');
 const igSize=market.dealingRules?.minDealSize;
 if(!igSize||!Number.isFinite(Number(igSize.value))||TRADE_SIZE<Number(igSize.value))throw Error('Deal size below IG minimum or dealing rule missing');
 if(trade.pendingOrder)throw Error('Unresolved prior order; reconcile with IG before another test');const q=quotes.get(TRADE_EPIC);if(!q||q.source!=='STREAM'||Date.now()-q.at>15000||q.marketState!=='DEAL'||(q.delayed!==null&&String(q.delayed)!=='0'))throw Error('No recent undelayed streaming quote');if(q.ask-q.bid>TRADE_MAX_SPREAD)throw Error('Spread exceeds configured maximum');if(trade.dailyOpens>=TRADE_DAILY_CAP)throw Error('Daily trade limit reached');const conf=await openDemo(req.body.direction==='BUY'?'LONG':'SHORT',{manualTest:true});disarm('Manual demo test order submitted; automation remains disarmed');res.json({ok:true,dealId:conf.dealId,trading:tradePublic(),warning:'Verify the open position and attached stops in IG Demo'})}catch(e){trade.lastError=e.message;disarm('Manual order attempt requires review');res.status(409).json({error:e.message,warning:'Check IG Demo for a possible order before retrying'})}finally{trade.busy=false}});

const multiRiskStore=createRiskStore();
const multi=MULTI_MODE?require('./multi-engine').createMultiEngine({
 api,quotes,candles,analyse,confirmDeal,host:HOST,discoveredMarkets:markets,
 authInfo:()=>auth,accountReady:()=>!!account&&account.accountId===auth?.accountId&&account.balance>0,
 brokerEnabled:()=>BROKER_DEMO_EXECUTION,storageAllowed:()=>STORAGE_ALLOWED,
 storageHealthy:()=>persistenceHealthy,brokerReady:()=>brokerReconciled,
 legacyBusy:()=>trade.busy||!!trade.pendingOrder||!!trade.tracked,log,riskStore:multiRiskStore
}):null;
// V6.5: Authenticated, read-only IG DEMO market specifications.
app.get('/api/admin/market/specifications',requireAdmin,async(_req,res)=>{
 try{
  const epic='CS.D.EURUSD.CFD.IP';
  const data=await api('/markets/'+encodeURIComponent(epic),'GET',null,'3');
  const i=data.instrument||{};
  const r=data.dealingRules||{};
  const q=data.snapshot||{};
  res.set('Cache-Control','no-store').json({
   epic,
   contractSize:i.contractSize??null,
   lotSize:i.lotSize??null,
   unit:i.unit??null,
   valueOfOnePip:i.valueOfOnePip??null,
   onePipMeans:i.onePipMeans??null,
   minimumDealSize:r.minDealSize??null,
   minimumStopDistance:r.minNormalStopOrLimitDistance??null,
   marketStatus:q.marketStatus??null,
   bid:q.bid??null,
   offer:q.offer??null,
   retrievedAt:new Date().toISOString(),
   monetaryRiskVerified:false,
   approved:false,
   previewOnly:true,
   warning:'IG-reported market data only. GBP contract exposure and currency conversion remain unverified. Broker execution blocked.'
  });
 }catch(e){
  res.set('Cache-Control','no-store').status(502).json({
   approved:false,
   monetaryRiskVerified:false,
   error:'IG market specifications unavailable'
  });
 }
});

app.get('/risk',(_req,res)=>res.sendFile(path.join(__dirname,'public','risk.html')));
app.get('/api/admin/multi/risk',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(multiRiskStore.snapshot()));
app.post('/api/admin/multi/risk/validate',requireAdmin,(req,res)=>res.json(multiRiskStore.validate(req.body?.pairs)));
app.put('/api/admin/multi/risk',requireAdmin,(req,res)=>{try{res.json(multiRiskStore.save(req.body?.pairs,req.body?.revision))}catch(e){res.status(e.status||500).json({error:e.message,validation:e.validation||null})}});

// V6.5: Hypothetical GBP monetary-risk preview only.
// Never treat caller-supplied values as broker verification.
app.post('/api/admin/multi/risk/monetary-preview',requireAdmin,(req,res)=>{
 try{
  const {calculateRisk}=require('./monetary-risk');
  const x=req.body||{};
  const equity=Number(x.equity);
  const riskBudget=Number.isFinite(equity)&&equity>0?equity*0.005:null;
  const result=calculateRisk({
   equity:x.equity,
   size:x.size,
   entry:x.entry,
   stop:x.stop,
   direction:x.direction,
   valuePerPriceUnit:x.valuePerPriceUnit,
   contractVerified:false,
   currencyConversionVerified:false
  });
  res.set('Cache-Control','no-store').json({
   ...result,
   riskBudget,
   approved:false,
   previewOnly:true,
   monetaryRiskVerified:false,
   verificationStatus:'BLOCKED_UNTIL_BROKER_DATA_VERIFIED',
   warning:'Hypothetical calculation only. Contract units, GBP conversion, fees and slippage remain unverified. No order submitted.'
  });
 }catch(e){
  res.status(400).json({
   approved:false,
   previewOnly:true,
   monetaryRiskVerified:false,
   error:e.message
  });
 }
});

app.get('/multi',(_req,res)=>res.sendFile(path.join(__dirname,'public','multi.html')));
app.get('/api/multi/status',(_req,res)=>res.json(multi?multi.status():{enabled:false,note:'Set MP_MULTI_MODE=true'}));
app.post('/api/admin/multi/initialize',requireAdmin,async(req,res)=>{try{if(!multi)throw Error('Multi mode disabled');res.json(await multi.initialize(req.body?.confirm))}catch(e){res.status(409).json({error:e.message})}});
app.post('/api/admin/multi/arm',requireAdmin,async(req,res)=>{try{if(!multi)throw Error('Multi mode disabled');res.json(await multi.arm(req.body?.confirm))}catch(e){res.status(409).json({error:e.message})}});
app.post('/api/admin/multi/stop',requireAdmin,(_req,res)=>res.json(multi?multi.stop():{error:'Multi mode disabled'}));
app.post('/api/admin/multi/reset-stop',requireAdmin,async(req,res)=>{if(!multi)return res.status(409).json({error:'Multi mode disabled'});try{res.json(await multi.resetOperatorStop(req.body?.confirm))}catch(e){res.status(409).json({error:e.message})}});
app.post('/api/admin/multi/reconcile',requireAdmin,async(_req,res)=>{if(!multi)return res.status(409).json({error:'Multi mode disabled'});try{res.json({positions:await multi.reconcile(),status:multi.status()})}catch(e){res.status(502).json({error:e.message})}});
setInterval(()=>{if(multi)multi.tick().catch(e=>log('V6 tick error: '+e.message))},30000);
app.get('/analytics',(_req,res)=>res.sendFile(path.join(__dirname,'public','analytics.html')));
// V8: Register the background-push API before the dashboard fallback.
const pushAlerts=createPushAlerts();
pushAlerts.routes(app);
void pushAlerts.init().catch(e=>console.error('[MarketPulse] Push init failed:',e.message));
// V9 independent simulated engine. Routes must precede dashboard fallback.
const v9Paper=createV9Paper(event=>pushAlerts.sendPaperEvent(event));
app.get('/v9',(_req,res)=>res.sendFile(path.join(__dirname,'public','v9.html')));
v9Paper.routes(app,requireAdmin);
void v9Paper.init().catch(e=>console.error('[V9 paper] startup:',e.message));
// V10 read-only broker readiness and simulation risk audit. No IG dealing endpoints.
require('./v10-readiness').registerV10(app,requireAdmin,{v9Paper,api,accountSnapshot:()=>account});
// V11 execution engineering laboratory: GET-only IG audit, PostgreSQL paper journal, no broker orders.
const v11Lab=require('./v11-execution-lab').createExecutionLab({api,v9Paper,requireAdmin});
v11Lab.routes(app);
void v11Lab.init().catch(e=>console.error('[V11 lab] startup:',e.message));
// V12: authenticated read-only broker evidence and paper lifecycle audits; no broker order operations.
const v12Validation=require('./v12-validation').createV12({api,v9Paper,requireAdmin});
v12Validation.routes(app);
void v12Validation.init().catch(e=>console.error('[V12]',e.message));
// V13: additive safety lab. Read-only IG calls and persistent preview journal; no broker POST.
const v13Safety=require('./v13-safety').createV13({api,v9Paper,requireAdmin});
v13Safety.routes(app);
void v13Safety.init().catch(e=>console.error('[V13]',e.message));
// V14 routes must be registered before the legacy dashboard catch-all.
const v14Lab=require('./v14-lifecycle').createV14({requireAdmin});
v14Lab.routes(app);
void v14Lab.init().catch(e=>console.error('[V14]',e.message));
// V15: isolated simulated lifecycle rehearsal; no IG API access or broker submissions.
const v15Lab=require('./v15-rehearsal').createV15({requireAdmin});
v15Lab.routes(app);
void v15Lab.init().catch(e=>console.error('[V15]',e.message));
const v16Lab=require('./v16-safety').createV16({requireAdmin});
v16Lab.routes(app);
void v16Lab.init().catch(e=>console.error('[V16]',e.message));
// V17: simulation-only signal rehearsal and risk readiness. Registered before legacy catch-all.
const v17Lab=require('./v17-readiness').createV17({requireAdmin,signalSnapshot:()=>{
 const epic='CS.D.EURUSD.CFD.IP',q=quotes.get(epic),a=analyse(epic),bars=candles.get(epic)||[];
 return {epic,direction:a.direction,score:a.score,reason:a.reason,bar:bars.at(-1)?.time||null,
  quoteAgeMs:q?Date.now()-q.at:null,quoteSource:q?.source||null,marketState:q?.marketState||null,
  bid:q?.bid??null,ask:q?.ask??null};
}});
v17Lab.routes(app);
void v17Lab.init().catch(e=>console.error('[V17]',e.message));
setInterval(()=>{void v17Lab.tick().catch(e=>console.error('[V17 tick]',e.message))},30000);
// V18 read-only broker readiness; never authorizes or sends IG orders.
const v18Lab=require('./v18-demo-readiness').createV18({requireAdmin,v17Lab,signalSnapshot:()=>{
 const epic='CS.D.EURUSD.CFD.IP',q=quotes.get(epic),a=analyse(epic),bars=candles.get(epic)||[];
 return {epic,direction:a.direction,score:a.score,reason:a.reason,bar:bars.at(-1)?.time||null,quoteAgeMs:q?Date.now()-q.at:null,quoteSource:q?.source||null,marketState:q?.marketState||null,bid:q?.bid??null,ask:q?.ask??null};
}});
v18Lab.routes(app);
// V19: read-only IG DEMO bridge. Does not bypass the broker order hard-block.
const v19Bridge=require('./v19-demo-bridge').createV19({requireAdmin,api,v17Lab,signalSnapshot:()=>{
 const epic='CS.D.EURUSD.CFD.IP',q=quotes.get(epic),a=analyse(epic);
 return {epic,direction:a.direction,score:a.score,reason:a.reason,quoteSource:q?.source||null,quoteAgeMs:q?Date.now()-q.at:null};
}});
v19Bridge.routes(app);
// V20: fail-closed monetary and broker readiness checks. No broker write requests.
require('./v20-execution-gates').createV20({requireAdmin,api,signalSnapshot:()=>{
 const epic='CS.D.EURUSD.CFD.IP',q=quotes.get(epic),a=analyse(epic);
 return {direction:a.direction,score:a.score,quoteSource:q?.source||null,quoteAgeMs:q?Date.now()-q.at:null};
}}).routes(app);
// V21: fail-closed read-only IG diagnostics and durable simulation journal.
const v21Engine=require('./v21-engine').createV21({requireAdmin,api,signalSnapshot:()=>{
 const epic='CS.D.EURUSD.CFD.IP',q=quotes.get(epic),a=analyse(epic),bars=candles.get(epic)||[];
 return {direction:a.direction,score:a.score,bar:bars.at(-1)?.time||null,quoteAgeMs:q?Date.now()-q.at:null,quoteSource:q?.source||null};
}});
v21Engine.routes(app);
void v21Engine.init().catch(e=>console.error('[V21]',e.message));
// V22: persistent simulation lifecycle, read-only reconciliation and restart markers.
const v22Engine=require('./v22-engine').createV22({requireAdmin,api});
v22Engine.routes(app);
void v22Engine.init().catch(e=>console.error('[V22]',e.message));
const v23Engine=require('./v23-engine').createV23({requireAdmin,api});
v23Engine.routes(app);
void v23Engine.init().catch(e=>console.error('[V23]',e.message));
// V24 read-only evidence and synthetic recovery laboratory. No broker writes.
const v24Engine=require('./v24-engine').createV24({requireAdmin,api});
v24Engine.routes(app);
void v24Engine.init().catch(e=>console.error('[V24]',e.message));
// V25 autonomous simulation: NO broker write calls or order authorization.
const v25Autonomy=require('./v25-autonomy').createV25({requireAdmin,signalSnapshot:()=>{
 const epic='CS.D.EURUSD.CFD.IP',q=quotes.get(epic),s=analyse(epic),bars=candles.get(epic)||[];
 return {epic,direction:s.direction,score:s.score,bar:bars.at(-1)?.time||null,
  quoteSource:q?.source||null,quoteAgeMs:q?Date.now()-q.at:null,marketState:q?.marketState||null,
  delayed:q?.delayed==null?null:String(q.delayed)==='0'?false:true,bid:q?.bid??null,ask:q?.ask??null};
}});
v25Autonomy.routes(app);
setInterval(()=>{v25Autonomy.tick((()=>{const epic='CS.D.EURUSD.CFD.IP',q=quotes.get(epic),s=analyse(epic),bars=candles.get(epic)||[];return {epic,direction:s.direction,score:s.score,bar:bars.at(-1)?.time||null,quoteSource:q?.source||null,quoteAgeMs:q?Date.now()-q.at:null,marketState:q?.marketState||null,delayed:q?.delayed==null?null:String(q.delayed)==='0'?false:true,bid:q?.bid??null,ask:q?.ask??null}})())},15000);
// V26 integrated diagnostics; broker execution remains hard-blocked in this module.
const v26Readiness=require('./v26-readiness').createV26({requireAdmin,
 simulation:()=>v25Autonomy.status(),
 feed:()=>{const q=quotes.get('CS.D.EURUSD.CFD.IP');return {streamStatus,source:q?.source||null,ageMs:q?Date.now()-q.at:null,marketState:q?.marketState||null,delayed:q?.delayed==null?null:String(q.delayed)==='0'?false:true};},
 broker:()=>({brokerReconciled,persistenceHealthy,pendingOrder:!!trade.pendingOrder})
});
v26Readiness.routes(app);
// V27 offline evidence and synthetic failure-injection tests. No broker write paths.
const v27Lab=require('./v27-execution-lab').createV27({requireAdmin,readiness:()=>v26Readiness.report(),storageDir:DATA_DIR});
v27Lab.routes(app);
// V28 independent-verification preparation: read-only IG evidence, risk math and recovery triage.
// No IG write API or broker authorization in this module.
const v28Verification=require('./v28-verification').createV28({requireAdmin,api,
 readLocal:()=>({pendingOrder:trade.pendingOrder,tracked:trade.tracked,persistenceHealthy,brokerReconciled}),
 appendEvidence:(type,details)=>v27Lab.append(type,details)});
v28Verification.routes(app);
// V29: observe operator-executed IG demo order lifecycle; never submits orders.
require('./v29-lifecycle').createV29({requireAdmin,api,appendEvidence:(type,details)=>v27Lab.append(type,details)}).routes(app);
// V30: historical IG DEMO evidence; read-only, broker orders still hard blocked.
require('./v30-history').createV30({requireAdmin,api,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,appendEvidence:(type,details)=>v27Lab.append(type,details)}).routes(app);
require('./v31-readiness').createV31({requireAdmin,api,authInfo:()=>auth,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,appendEvidence:(type,details)=>v27Lab.append(type,details)}).routes(app);
// V32 independent-verification workbench: no broker writes or arming.
require('./v32-verification').createV32({requireAdmin,api,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE}).routes(app);
const v33Automation=require('./v33-automation').createV33({requireAdmin,api,authInfo:()=>auth,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE});
v33Automation.routes(app);
// V34: restart-disarmed, persistent PAPER signal automation and read-only broker observation.
const v34Orchestrator=require('./v34-orchestrator').createV34({requireAdmin,api,authInfo:()=>auth,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,
 signalSnapshot:()=>{const epic='CS.D.EURUSD.CFD.IP',q=quotes.get(epic),s=analyse(epic),bars=candles.get(epic)||[];return {epic,signal:{direction:s.direction,score:s.score,bar:bars.at(-1)?.time||null},feed:{marketState:q?.marketState||null,delayed:q?.delayed==null?null:String(q.delayed)==='0'?false:true,ageMs:q?Date.now()-q.at:null,bid:q?.bid??null,ask:q?.ask??null},unresolvedIntents:(()=>{try{const j=v33Automation.status();return j.storageHealthy===true&&j.persistentStorageConfigured===true&&Number.isSafeInteger(j.unresolvedIntents)&&j.unresolvedIntents>=0?j.unresolvedIntents:null}catch{return null}})()};}});
v34Orchestrator.routes(app);
// V35: read-only integrated safety dashboard. Broker writes are not exposed.
require('./v35-diagnostics').createV35({requireAdmin,v33Status:()=>v33Automation.status(),v34Status:()=>v34Orchestrator.status(),signalSnapshot:()=>{const epic='CS.D.EURUSD.CFD.IP',q=quotes.get(epic),s=analyse(epic);return {epic,direction:s.direction,score:s.score,marketState:q?.marketState??null,quoteAgeMs:q?Date.now()-q.at:null,delayed:q?.delayed==null?null:String(q.delayed)==='0'?false:true}}}).routes(app);
// V37: REST market status is distinct from streaming DLG_FLAG. Fail closed if stale/unknown.
const {verifiedRestMarketState}=require('./v37-readiness');
// V36: independent persistent paper positions, no IG order writes.
const v36Paper=require('./v36-paper').createV36({requireAdmin,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,v33Status:()=>v33Automation.status(),signalSnapshot:()=>{const epic='CS.D.EURUSD.CFD.IP',q=quotes.get(epic),a=analyse(epic),bars=candles.get(epic)||[];return {epic,signal:{direction:a.direction,score:a.score,bar:bars.at(-1)?.time||null},feed:{marketState:verifiedRestMarketState(restSnapshot,restSnapshotAt,q),delayed:q?.delayed==null?null:String(q.delayed)==='0'?false:true,ageMs:q?Date.now()-q.at:null,bid:q?.bid??null,ask:q?.ask??null}}}});
v36Paper.routes(app);
// V37: independent diagnostics and durable rejected-evaluation audit; no broker order routes.
const v37Readiness=require('./v37-readiness').createV37({requireAdmin,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,v36Status:()=>v36Paper.status(),v33Status:()=>v33Automation.status(),snapshot:()=>{const epic='CS.D.EURUSD.CFD.IP',q=quotes.get(epic),a=analyse(epic),bars=candles.get(epic)||[];return {epic,signal:{direction:a.direction,score:a.score,reason:a.reason,bars:a.bars,rsi:a.rsi,ema9:a.ema9,ema21:a.ema21,bar:bars.at(-1)?.time||null},feed:{bid:q?.bid??null,ask:q?.ask??null,ageMs:q?Date.now()-q.at:null,source:q?.source??null,dealingFlag:q?.marketState??null,delayed:q?.delayed==null?null:String(q.delayed)==='0'?false:true,restMarketStatus:restSnapshot?.marketStatus??null,restAgeMs:restSnapshotAt?Date.now()-Date.parse(restSnapshotAt):null,verifiedMarketStatus:verifiedRestMarketState(restSnapshot,restSnapshotAt,q)}}}});
v37Readiness.routes(app);
// V38: isolated, read-only-by-default verification workbench; no IG broker write calls.
const v38Workbench=require('./v38-verification').createV38({requireAdmin,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,v36Status:()=>v36Paper.status(),v37Status:()=>v37Readiness.status(),v33Status:()=>v33Automation.status(),legacyExecutionEnabled:BROKER_DEMO_EXECUTION});
v38Workbench.routes(app);

const v39Lifecycle=require('./v39-lifecycle').createV39({requireAdmin,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,v36Status:()=>v36Paper.status(),v37Status:()=>v37Readiness.status(),v38Status:()=>v38Workbench.status()});
v39Lifecycle.routes(app);
// V40: offline protocol rehearsal, no broker order transport.
const v40Protocol=require('./v40-protocol').createV40({requireAdmin,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,v36Status:()=>v36Paper.status(),v37Status:()=>v37Readiness.status(),v38Status:()=>v38Workbench.status(),v39Status:()=>v39Lifecycle.status()});
v40Protocol.routes(app);
// V41 read-only broker verification: GET endpoints only, no broker write methods.
const v41Observer=require('./v41-broker-observer').createV41({
 requireAdmin,
 readBroker:async()=>{
  const [positionResponse,marketResponse,accountResponse]=await Promise.all([
   api('/positions','GET',null,'2'),
   api('/markets/'+encodeURIComponent('CS.D.EURUSD.CFD.IP'),'GET'),
   api('/accounts','GET')
  ]);
  const matching=(accountResponse.accounts||[]).find(a=>a.accountId===auth?.accountId);
  return {positions:positionResponse.positions,market:marketResponse,account:matching?{accountId:matching.accountId}:null};
 },
 v36Status:()=>v36Paper.status(),v40Status:()=>v40Protocol.status()
});
v41Observer.routes(app);

// V42 independent read-only evidence workbench. Broker execution remains disabled.
const v42Workbench=require('./v42-verification').createV42({
 requireAdmin,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,
 readBroker:async()=>{
  const [positionResponse,accountResponse]=await Promise.all([
   api('/positions','GET',null,'2'),api('/accounts','GET')
  ]);
  const matching=(accountResponse.accounts||[]).find(a=>a.accountId===auth?.accountId);
  return {positions:positionResponse.positions,account:matching?{accountId:matching.accountId}:null};
 },
 v36Status:()=>v36Paper.status(),v40Status:()=>v40Protocol.status()
});
v42Workbench.routes(app);

// V43 independent unattended-readiness rehearsal. Never imports IG order writes.
const v43Rehearsal=require('./v43-unattended').createV43({
 requireAdmin,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,
 v36Status:()=>v36Paper.status(),v39Status:()=>v39Lifecycle.status(),
 v40Status:()=>v40Protocol.status(),v41Status:()=>v41Observer.status(),
 v42Status:()=>v42Workbench.status()
});
v43Rehearsal.routes(app);

// V44 automated read-only observation soak; never imports IG order submission.
const v44Soak=require('./v44-soak').createV44({
 requireAdmin,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,
 v36Status:()=>v36Paper.status(),v39Status:()=>v39Lifecycle.status(),
 v40Status:()=>v40Protocol.status(),v41Status:()=>v41Observer.status(),
 v42Status:()=>v42Workbench.status(),
 refresh41:()=>v41Observer.refresh(),refresh42:()=>v42Workbench.observe()
});
v44Soak.routes(app);

// V45 sequential read-only observation soak with per-cycle diagnostics and evidence.
const v45Soak=require('./v45-soak').createV45({
 requireAdmin,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,
 v36Status:()=>v36Paper.status(),v39Status:()=>v39Lifecycle.status(),
 v40Status:()=>v40Protocol.status(),v41Status:()=>v41Observer.status(),
 v42Status:()=>v42Workbench.status(),v44Status:()=>v44Soak.status(),
 refresh41:()=>v41Observer.refresh(),refresh42:()=>v42Workbench.observe()
});
v45Soak.routes(app);

// V46 rate-limit-aware, read-only broker soak. Legacy monitors must remain disarmed.
const v46Soak=require('./v46-soak').createV46({
 requireAdmin,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,
 v36Status:()=>v36Paper.status(),v39Status:()=>v39Lifecycle.status(),
 v40Status:()=>v40Protocol.status(),v41Status:()=>v41Observer.status(),
 v42Status:()=>v42Workbench.status(),v44Status:()=>v44Soak.status(),
 v45Status:()=>v45Soak.status(),
 refresh41:()=>v41Observer.refresh(),refresh42:()=>v42Workbench.observe()
});
v46Soak.routes(app);

// V47 read-only certification evidence. No broker order write functions are supplied.
const v47Certification=require('./v47-certification').createV47({
 requireAdmin,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,
 v46Status:()=>v46Soak.status(),
 readBroker:async()=>{
  const [positions,market,accounts]=await Promise.all([
   api('/positions','GET',null,'2'),
   api('/markets/'+encodeURIComponent('CS.D.EURUSD.CFD.IP'),'GET'),
   api('/accounts','GET')
  ]);
  const matching=(accounts.accounts||[]).find(a=>a.accountId===auth?.accountId);
  return {positions:positions.positions,market,account:matching?{accountId:matching.accountId}:null};
 }
});
v47Certification.routes(app);

// V48 Mini readiness: authenticated IG DEMO market reads only. No broker write adapter.
const v48Mini=require('./v48-mini').createV48({
 requireAdmin,api,v47Status:()=>v47Certification.status()
});
v48Mini.routes(app);

// V49 read-only Mini certification and unattended execution simulation. Never pass broker write access.
const v49Certification=require('./v49-certification').createV49({
 requireAdmin,api,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,
 v47Status:()=>v47Certification.status(),v48Status:()=>v48Mini.status(),
 readBroker:async()=>{
  const [p,a]=await Promise.all([api('/positions','GET',null,'2'),api('/accounts','GET')]);
  if(!Array.isArray(p.positions)||!Array.isArray(a.accounts))throw Error('IG_BROKER_READBACK_INVALID');
  const current=a.accounts.find(x=>x.accountId===auth?.accountId);
  if(!current)throw Error('IG_ACCOUNT_MISMATCH');
  const fingerprint=require('node:crypto').createHash('sha256').update(current.accountId).digest('hex').slice(0,20);
  return {accountFingerprint:fingerprint,positions:p.positions.map(x=>({dealId:x.position?.dealId||null,epic:x.market?.epic||null,direction:x.position?.direction||null,size:x.position?.size??null,stopLevel:x.position?.stopLevel??null,limitLevel:x.position?.limitLevel??null}))};
 }
});
v49Certification.routes(app);

// V50: instrument-specific evidence, restart observations and fail-closed simulation.
// IMPORTANT: never supply any IG order-write adapter to this module.
const v50Workbench=require('./v50-workbench').createV50({
 requireAdmin,api,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,
 v49Status:()=>v49Certification.status(),
 readBroker:async()=>{
  const [p,a]=await Promise.all([api('/positions','GET',null,'2'),api('/accounts','GET')]);
  if(!Array.isArray(p.positions)||!Array.isArray(a.accounts))throw Error('IG_READBACK_INVALID');
  const current=a.accounts.find(x=>x.accountId===auth?.accountId);
  if(!current)throw Error('IG_ACCOUNT_MISMATCH');
  const fingerprint=require('node:crypto').createHash('sha256').update(current.accountId).digest('hex').slice(0,20);
  return {accountFingerprint:fingerprint,accountCurrency:current.currency||null,
   positions:p.positions.map(x=>({dealId:x.position?.dealId||null,epic:x.market?.epic||null,
    direction:x.position?.direction||null,size:x.position?.size??null,
    stopLevel:x.position?.stopLevel??null,limitLevel:x.position?.limitLevel??null}))};
 }
});
v50Workbench.routes(app);

// V51: read-only Mini broker evidence and cross-boot reconciliation. No order-write adapter.
const v51Evidence=require('./v51-evidence').createV51({
 requireAdmin,api,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,
 readBroker:async()=>{
  const [p,a]=await Promise.all([api('/positions','GET',null,'2'),api('/accounts','GET')]);
  if(!Array.isArray(p.positions)||!Array.isArray(a.accounts))throw Error('IG_READBACK_INVALID');
  const current=a.accounts.find(x=>x.accountId===auth?.accountId);
  if(!current)throw Error('IG_ACCOUNT_MISMATCH');
  const accountFingerprint=require('node:crypto').createHash('sha256').update(current.accountId).digest('hex').slice(0,20);
  return {accountFingerprint,accountCurrency:current.currency||null,positions:p.positions.map(x=>({
   dealId:x.position?.dealId||null,epic:x.market?.epic||null,direction:x.position?.direction||null,
   size:x.position?.size??null,stopLevel:x.position?.stopLevel??null,limitLevel:x.position?.limitLevel??null
  }))};
 }
});
v51Evidence.routes(app);

// V52: read-only IG history patch.
const v52Evidence=require('./v52-evidence').createV52({
 requireAdmin,api,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,
 readBroker:async()=>{
  const [p,a]=await Promise.all([api('/positions','GET',null,'2'),api('/accounts','GET')]);
  if(!Array.isArray(p.positions)||!Array.isArray(a.accounts))throw Error('IG_READBACK_INVALID');
  const current=a.accounts.find(x=>x.accountId===auth?.accountId);
  if(!current)throw Error('IG_ACCOUNT_MISMATCH');
  const accountFingerprint=require('node:crypto').createHash('sha256').update(current.accountId).digest('hex').slice(0,20);
  return {accountFingerprint,accountCurrency:current.currency||null,positions:p.positions.map(x=>({
   dealId:x.position?.dealId||null,epic:x.market?.epic||null,direction:x.position?.direction||null,
   size:x.position?.size??null,stopLevel:x.position?.stopLevel??null,limitLevel:x.position?.limitLevel??null
  }))};
 }
});
v52Evidence.routes(app);

// V53: read-only broker evidence matching; no broker order-write capability.
const v53Evidence=require('./v53-evidence').createV53({
 requireAdmin,api,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,
 readBroker:async()=>{
  const [p,a]=await Promise.all([api('/positions','GET',null,'2'),api('/accounts','GET')]);
  if(!Array.isArray(p.positions)||!Array.isArray(a.accounts))throw Error('IG_READBACK_INVALID');
  const current=a.accounts.find(x=>x.accountId===auth?.accountId);
  if(!current)throw Error('IG_ACCOUNT_MISMATCH');
  const accountFingerprint=require('node:crypto').createHash('sha256').update(current.accountId).digest('hex').slice(0,20);
  return {accountFingerprint,accountCurrency:current.currency||null,positions:p.positions.map(x=>({
   dealId:x.position?.dealId||null,epic:x.market?.epic||null,direction:x.position?.direction||null,
   size:x.position?.size??null,stopLevel:x.position?.stopLevel??null,limitLevel:x.position?.limitLevel??null
  }))};
 }
});
v53Evidence.routes(app);

// Keep the catch-all after every versioned dashboard and API route.
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

const port=Number(process.env.PORT)||3000;acquireLocalLock();app.listen(port,'0.0.0.0',()=>{restoreTrade();restoreRisk();restoreCandles();try{fs.mkdirSync(DATA_DIR,{recursive:true});const probe=path.join(DATA_DIR,'.write-test');fs.writeFileSync(probe,'ok');fs.unlinkSync(probe)}catch(e){persistenceHealthy=false;log('Storage health failed: '+e.message)}log('V5.9 Render Free IG DEMO experimental started; execution '+(BROKER_DEMO_EXECUTION?'enabled by configuration':'disabled'));void recoverPaperOnStartup().catch(e=>log('Paper recovery startup error: '+e.message));init()});
// Evaluate signals independently of REST polling. Never overlap trading cycles.
// V9 paper-only evaluation; independent of legacy paper recovery and broker execution.
setInterval(()=>{
  const epic='CS.D.EURUSD.CFD.IP';
  v9Paper.tick(quotes.get(epic),analyse(epic),candles.get(epic)||[]).catch(e=>log('V9 paper tick: '+e.message));
},15000);

let paperCycleBusy=false;
setInterval(async()=>{
  if(!paperRecoveryReady || paperCycleBusy)return;
  paperCycleBusy=true;
  try{
    const q=quotes.get('CS.D.EURUSD.CFD.IP');
    const s=analyse('CS.D.EURUSD.CFD.IP');
    await durablePaperTick(paper,q,s,Date.now());
  }catch(e){
    paperRecoveryReady=false;
    paper.enabled=false;
    paperRecoveryStatus={...paperRecoveryStatus,state:'ERROR',error:'Paper cycle halted: '+e.message};
    log('Paper cycle halted: '+e.message);
  }finally{paperCycleBusy=false;}
},15000);

let autoStartChecking=false;
async function tryAutoStart(){
 if(MULTI_MODE||autoStartChecking||!AUTO_START||!BROKER_DEMO_EXECUTION||trade.armed||trade.busy||starting||trade.operatorStop||trade.pendingOrder||!STORAGE_ALLOWED||!persistenceHealthy||!brokerReconciled||!streamTradeReady()||!tradingConfigValid()||!DEMO_EXECUTION_TESTED)return;
 autoStartChecking=true;
 try{
  const info=await api('/markets/'+encodeURIComponent(TRADE_EPIC));
  if(info.snapshot?.marketStatus!=='TRADEABLE')return;
  const min=Number(info.dealingRules?.minNormalStopOrLimitDistance?.value);
  if(!Number.isFinite(min)||TRADE_STOP_DISTANCE<min)return;
  if(!account||account.accountId!==auth?.accountId||!Number.isFinite(account.balance)||account.balance<=0)return;
  const all=await reconcilePositions();
  if(all.length||trade.tracked||trade.pendingOrder)return;
  trade.armed=true;trade.executionEnabled=true;trade.haltReason=null;
  log('Automatic IG DEMO trading armed after safety validation');
 }catch(e){log('Auto-start check: '+e.message)}finally{autoStartChecking=false}
}
setInterval(()=>tryAutoStart().catch(e=>log('Auto-start failure: '+e.message)),30000);

setInterval(()=>{if(MULTI_MODE)return;tradingCycle().catch(e=>{disarm('Unexpected trading-cycle error');log(e.message)})},15000);
setInterval(()=>{refreshAccount().catch(e=>log('Account refresh: '+e.message))},120000);
setInterval(()=>{checkRestSnapshot().catch(e=>log('REST snapshot check: '+e.message))},300000);
setInterval(()=>{if(!starting&&(!client||streamStatus==='error'||streamStatus==='disconnected'||String(streamStatus).startsWith('DISCONNECTED'))&&Date.now()>reconnectAt){reconnectAt=Date.now()+60000;init()}},30000);

setInterval(()=>{if(probeStartedAt&&accepted.size>0&&[...diagnostics.values()].every(x=>x.updates===0)){log('Diagnostic watchdog: accepted subscriptions but no onItemUpdate callbacks yet');}},300000);