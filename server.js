'use strict';
require('dotenv').config();
const express=require('express'), path=require('path');
const {LightstreamerClient,Subscription}=require('lightstreamer-client-node');
if(process.env.IG_ACCOUNT_TYPE!=='DEMO')throw Error('Refusing to start: IG_ACCOUNT_TYPE must equal DEMO');
const app=express();app.use(express.json({limit:'12kb'}));app.use(express.static(path.join(__dirname,'public')));
const HOST='https://demo-api.ig.com/gateway/deal';
const FIVE=300000, MAX=Math.min(40,Math.max(1,Number(process.env.MAX_STREAM_MARKETS)||20));
const MAX_DISCOVERY_NODES=Math.min(100,Math.max(1,Number(process.env.DISCOVERY_NODE_LIMIT)||45));
const MAX_DISCOVERY_MARKETS=Math.min(500,Math.max(1,Number(process.env.DISCOVERY_MARKET_LIMIT)||150));
const configEpics=String(process.env.IG_EPICS||'').split(',').map(x=>x.trim()).filter(x=>/^CS\.D\.[A-Z]{6}\.(?:CFD|MINI)\.IP$/.test(x));
const TEST_ONE=process.env.TEST_ONE_FOREX!=='false';
const PROBE_MINI=process.env.PROBE_EURUSD_MINI!=='false';
const PROBE_ACCOUNT=process.env.PROBE_ACCOUNT_STREAM!=='false';
const REST_POLL_SECONDS=Math.min(300,Math.max(60,Number(process.env.REST_POLL_SECONDS)||60));
const REST_MAX_MARKETS=Math.min(5,Math.max(1,Number(process.env.REST_MAX_MARKETS)||3));
const REST_STALE_MS=REST_POLL_SECONDS*2500;
const restState={enabled:true,intervalSeconds:REST_POLL_SECONDS,requestedMarkets:REST_MAX_MARKETS,lastPoll:null,nextPoll:null,lastError:'',rateLimitedUntil:null,attempted:0,succeeded:0,failed:0,marketResults:{}};
let restPolling=false,restTimer=null,restBackoffUntil=0;
const markets=new Map(),quotes=new Map(),candles=new Map(),current=new Map(),signals=new Map(),events=[];
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
 if(!auth)await login();try{return (await request(url,method,body,version)).data}catch(e){if(/401|client-token-invalid|security-token-invalid/i.test(e.message)){await login();return (await request(url,method,body,version)).data}throw e}
}
function isForex(m){
 const epic=String(m.epic||'').trim();
 const name=String(m.instrumentName||m.name||'').trim();
 return /^CS\.D\.[A-Z]{6}\.(CFD|MINI)\.IP$/.test(epic) &&
   (/^[A-Z]{3}\/[A-Z]{3}(?:\s+Mini)?$/i.test(name) || /^CS\.D\.[A-Z]{6}\./.test(epic));
}
function addMarket(m){
 if(!isForex(m))return;
 const epic=String(m.epic).trim();
 markets.set(epic,{epic,name:String(m.instrumentName||m.name||epic).slice(0,100),streaming:false});
}
async function discover(){
 lastDiscovery=new Date().toISOString();discoverError='';
 const selected=new Map();
 const terms=['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'];
 let successful=0;
 if(process.env.AUTO_DISCOVER_FOREX!=='false'){
  for(const term of terms){
   try{
    const result=await api('/markets?searchTerm='+encodeURIComponent(term));successful++;
    for(const m of result.markets||[]){
     if(isForex(m))selected.set(m.epic,m);
     if(selected.size>=MAX_DISCOVERY_MARKETS)break;
    }
   }catch(e){log('Market search '+term+': '+e.message)}
   if(selected.size>=MAX_DISCOVERY_MARKETS)break;
  }
  if(!successful)discoverError='All IG market searches failed';
 }
 for(const epic of configEpics)if(!selected.has(epic))selected.set(epic,{epic,name:epic});
 markets.clear();for(const m of selected.values())addMarket(m);
 log(`Forex-only discovery: ${markets.size} CFDs; test-one=${TEST_ONE}`);
 return markets.size;
}

function candleFromQuote(epic,mid,at){const bucket=Math.floor(at/FIVE)*FIVE;let c=current.get(epic);
 if(c&&bucket<c.bucket)return;
 if(c&&bucket>c.bucket){if(c.ticks>=2 && at-c.lastAt<=FIVE*2){const list=candles.get(epic)||[];list.push({time:new Date(c.bucket).toISOString(),open:c.open,high:c.high,low:c.low,close:c.close,ticks:c.ticks});candles.set(epic,list.slice(-150));}current.delete(epic);c=null;}
 if(!c){c={bucket,open:mid,high:mid,low:mid,close:mid,ticks:0};current.set(epic,c)}
 c.high=Math.max(c.high,mid);c.low=Math.min(c.low,mid);c.close=mid;c.ticks++;c.lastAt=at;
}
function ema(arr,period){let x=arr[0];for(const v of arr.slice(1))x=x+(v-x)*2/(period+1);return x}
function rsi(arr,period=14){if(arr.length<period+1)return null;let up=0,down=0;for(let i=arr.length-period;i<arr.length;i++){const delta=arr[i]-arr[i-1];up+=Math.max(0,delta);down+=Math.max(0,-delta)}return down===0?100:100-100/(1+up/down)}
function analyse(epic){const bars=candles.get(epic)||[],q=quotes.get(epic),fresh=q&&Date.now()-q.at<(q.source==='REST'?REST_STALE_MS:20000);
 if(!fresh)return {epic,direction:'STALE',score:0,bars:bars.length,reason:'No recent market price'};
 if(bars.length<30)return {epic,direction:'WARMING',score:0,bars:bars.length,reason:`${bars.length}/30 sampled 5-minute bars; ${q.source} observations, no historical REST requests`};
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
 const epics=ordered.slice(0,TEST_ONE?1:MAX);
 if(!epics.length)throw Error('No forex markets discovered');
 // Two independent diagnostic subscriptions on EUR/USD CFD: standard IG price fields
 // and the legacy field set from V3.5. A MINI standard-fields probe is optional.
 const probes=[];
 for(const epic of epics){
  probes.push({epic,kind:'standard',fields:['BID','OFFER','UPDATE_TIME','MARKET_STATE']});
  // No-account PRICE item was rejected by IG in V3.7 (error 21); do not retry it.
  if(TEST_ONE&&epic==='CS.D.EURUSD.CFD.IP'){
   probes.push({epic,kind:'legacy',fields:['BIDPRICE1','ASKPRICE1','DLG_FLAG','TIMESTAMP','DELAY']});
  }
 }
 if(TEST_ONE&&PROBE_MINI&&markets.has('CS.D.EURUSD.MINI.IP')){
  probes.push({epic:'CS.D.EURUSD.MINI.IP',kind:'mini-standard',fields:['BID','OFFER','UPDATE_TIME','MARKET_STATE']});
 }
 const subscriptions=[];
 probeStartedAt=new Date().toISOString();
 for(const {epic,kind,fields} of probes){
  const key=epic+'|'+kind;
  const item=kind==='no-account'?'PRICE:'+epic:'PRICE:'+auth.accountId+':'+epic;
  const subscription=new Subscription('MERGE',item,fields);
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
    const state=values.MARKET_STATE??values.DLG_FLAG??old.marketState??'UNKNOWN';
    const delayed=values.DELAY??old.delayed??null;
    const now=Date.now();quotes.set(epic,{bid,ask,spread:ask-bid,at:now,marketState:state,delayed,source:'STREAM'});
    const market=markets.get(epic);if(market)market.streaming=true;
    // Only build candles for non-delayed quotes, avoiding closed/suspended markets.
    if(String(delayed)!=='1'&&!['CLOSED','SUSPENDED','OFFLINE'].includes(String(state).toUpperCase()))candleFromQuote(epic,(bid+ask)/2,now);
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
 log(`V3.8 streaming compatibility diagnostics started: ${probes.length} probes across ${new Set(probes.map(x=>x.epic)).size} forex markets`);
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
 if(status==='TRADEABLE'&&(delayed===null||Number(delayed)===0)&&changed)candleFromQuote(epic,(bid+ask)/2,now);
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
 }finally{restPolling=false;restState.nextPoll=new Date(Math.max(Date.now()+REST_POLL_SECONDS*1000,restBackoffUntil)).toISOString()}
}
function startRestPolling(){
 if(restTimer)clearInterval(restTimer);
 restTimer=setInterval(()=>pollRest().catch(e=>log('REST poll unexpected error: '+e.message)),REST_POLL_SECONDS*1000);
 pollRest().catch(e=>log('Initial REST poll: '+e.message));
 log(`V3.8 REST fallback enabled: ${REST_POLL_SECONDS}s interval, ${REST_MAX_MARKETS} markets`);
}
async function refreshAccount(){const a=await api('/accounts');const ac=(a.accounts||[]).find(x=>x.accountId===auth.accountId)||(a.accounts||[]).find(x=>x.accountType==='CFD');
 if(ac)account={accountId:ac.accountId,currency:ac.currency,balance:ac.balance?.balance,equity:ac.balance?.balance+ac.balance?.profitLoss};
 const p=await api('/positions','GET',null,'2');positions=(p.positions||[]).map(x=>({epic:x.market?.epic,direction:x.position?.direction,size:x.position?.size,dealId:x.position?.dealId}));lastAccountRefresh=new Date().toISOString();}
async function init(){if(starting)return;starting=true;try{closeStream();await login();await discover();await refreshAccount();await checkRestSnapshot();startStream();startRestPolling()}catch(e){streamStatus='error';streamError=e.message;log('Startup: '+e.message)}finally{starting=false}}
function requireAdmin(req,res,next){const token=process.env.ADMIN_TOKEN;if(!token)return res.status(503).json({error:'Set ADMIN_TOKEN in Render'});if(req.get('X-Admin-Token')!==token)return res.status(403).json({error:'Invalid admin token'});next()}
app.get('/api/health',(req,res)=>res.json({ok:true,version:'3.8.0',mode:'DEMO_MONITOR_ONLY',streamStatus,marketCount:markets.size}));
app.get('/api/state',(req,res)=>{const now=Date.now(),list=[...markets.values()].map(m=>{const q=quotes.get(m.epic),s=analyse(m.epic);return {...m,...s,streaming:Boolean(q&&now-q.at<(q.source==='REST'?REST_STALE_MS:20000)),bid:q?.bid??null,ask:q?.ask??null,spread:q?.spread??null,marketState:q?.marketState||'UNKNOWN',lastTick:q?new Date(q.at).toISOString():null,ageSeconds:q?Math.round((now-q.at)/1000):null,priceSource:q?.source||null,igUpdateTime:q?.igUpdateTime||null}});
 res.json({version:'3.8.0',mode:'DEMO_MONITOR_ONLY',auto:false,orderExecutionEnabled:false,streamStatus,streamError,lastConnected,account,positions,lastAccountRefresh,lastDiscovery,discoverError,marketCount:markets.size,subscribedCount:[...accepted].filter(x=>!x.startsWith('ACCOUNT|')).length,priceReceivingCount:list.filter(x=>x.lastTick&&x.ageSeconds<(x.priceSource==='REST'?REST_STALE_MS/1000:20)).length,restReceivingCount:list.filter(x=>x.priceSource==='REST'&&x.ageSeconds<REST_STALE_MS/1000).length,restFallback:restState,diagnostics:Object.fromEntries(diagnostics),probeStartedAt,restSnapshot,restSnapshotError,restSnapshotAt,testOneForex:TEST_ONE,streamCap:MAX,markets:list,activity:events.slice(0,30),note:'Read-only demo monitor. No order submission endpoints.'})});
app.get('/api/ig/test',requireAdmin,async(req,res)=>{try{const a=await api('/accounts');res.json({ok:true,accountsReturned:a.accounts?.length||0,note:'No orders placed. Restart stream using admin reconnect if necessary.'})}catch(e){res.status(502).json({error:e.message})}});
app.post('/api/admin/reconnect',requireAdmin,async(req,res)=>{await init();res.json({ok:true,streamStatus,streamError})});
app.post('/api/admin/refresh',requireAdmin,async(req,res)=>{try{await refreshAccount();res.json({ok:true,account,positions})}catch(e){res.status(502).json({error:e.message})}});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const port=Number(process.env.PORT)||3000;app.listen(port,()=>{log('V3.8 DEMO monitoring-only started; orders permanently disabled');init()});
setInterval(()=>{refreshAccount().catch(e=>log('Account refresh: '+e.message))},120000);
setInterval(()=>{checkRestSnapshot().catch(e=>log('REST snapshot check: '+e.message))},300000);
setInterval(()=>{if(!starting&&(!client||streamStatus==='error'||streamStatus==='disconnected'||String(streamStatus).startsWith('DISCONNECTED'))&&Date.now()>reconnectAt){reconnectAt=Date.now()+60000;init()}},30000);

setInterval(()=>{if(probeStartedAt&&accepted.size>0&&[...diagnostics.values()].every(x=>x.updates===0)){log('Diagnostic watchdog: accepted subscriptions but no onItemUpdate callbacks yet');}},300000);
