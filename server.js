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
const configEpics=String(process.env.IG_EPICS||'').split(',').map(x=>x.trim()).filter(x=>/^[A-Z0-9.]{8,55}$/.test(x));
const markets=new Map(),quotes=new Map(),candles=new Map(),current=new Map(),signals=new Map(),events=[];
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
function addMarket(m){const epic=String(m.epic||'').trim();if(!/^[A-Z0-9.]{8,55}$/.test(epic))return;
 const name=String(m.instrumentName||m.name||epic).slice(0,100);markets.set(epic,{epic,name,streaming:false});}
async function discover(){
 lastDiscovery=new Date().toISOString();discoverError='';const selected=new Map();
 // IG demo may return 404 for navigation browsing. Use the documented market search endpoint.
 // Do not subscribe to guessed EPICs unless explicitly configured as a fallback.
 if(process.env.AUTO_DISCOVER_FOREX!=='false'){
  const terms=['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'];
  let successful=0;
  for(const term of terms){
   try{
    const result=await api('/markets?searchTerm='+encodeURIComponent(term));successful++;
    for(const m of result.markets||[]){
     const epic=String(m.epic||'').trim(),name=String(m.instrumentName||m.name||epic);
     // Only forex-looking instruments, and only real EPICs returned by IG.
     if(/^[A-Z0-9.]{8,55}$/.test(epic)&&(/forex|currency|\bfx\b|[A-Z]{3}\s*\/?\s*[A-Z]{3}/i.test(name)||/CS\.D\.[A-Z]{6}\./.test(epic)))
      selected.set(epic,{epic,name});
     if(selected.size>=MAX_DISCOVERY_MARKETS)break;
    }
    if(selected.size>=MAX_DISCOVERY_MARKETS)break;
   }catch(e){log('Market search '+term+': '+e.message)}
  }
  if(!successful)discoverError='All IG market searches failed; check Render logs and IG market-search permissions';
 }
 // Optional IG_EPICS fallback. Set this only to EPICs verified in the IG demo account.
 if(!selected.size)for(const epic of configEpics)selected.set(epic,{epic,name:epic});
 markets.clear();for(const m of selected.values())addMarket(m);
 log(`Market discovery: ${markets.size} candidates; stream cap ${MAX}`);
 return markets.size;
}
function candleFromQuote(epic,mid,at){const bucket=Math.floor(at/FIVE)*FIVE;let c=current.get(epic);
 if(c&&bucket<c.bucket)return;
 if(c&&bucket>c.bucket){if(c.ticks>=2){const list=candles.get(epic)||[];list.push({time:new Date(c.bucket).toISOString(),open:c.open,high:c.high,low:c.low,close:c.close,ticks:c.ticks});candles.set(epic,list.slice(-150));}current.delete(epic);c=null;}
 if(!c){c={bucket,open:mid,high:mid,low:mid,close:mid,ticks:0};current.set(epic,c)}
 c.high=Math.max(c.high,mid);c.low=Math.min(c.low,mid);c.close=mid;c.ticks++;
}
function ema(arr,period){let x=arr[0];for(const v of arr.slice(1))x=x+(v-x)*2/(period+1);return x}
function rsi(arr,period=14){if(arr.length<period+1)return null;let up=0,down=0;for(let i=arr.length-period;i<arr.length;i++){const delta=arr[i]-arr[i-1];up+=Math.max(0,delta);down+=Math.max(0,-delta)}return down===0?100:100-100/(1+up/down)}
function analyse(epic){const bars=candles.get(epic)||[],q=quotes.get(epic),fresh=q&&Date.now()-q.at<20000;
 if(!fresh)return {epic,direction:'STALE',score:0,bars:bars.length,reason:'No recent streaming price'};
 if(bars.length<30)return {epic,direction:'WARMING',score:0,bars:bars.length,reason:`${bars.length}/30 completed 5-minute candles; no historical REST requests`};
 const a=bars.map(x=>x.close),e9=ema(a,9),e21=ema(a,21),r=rsi(a),last=a.at(-1);
 const direction=e9>e21&&r>=52&&r<=68?'LONG':e9<e21&&r>=32&&r<=48?'SHORT':'WAIT';
 const score=direction==='WAIT'?0:Math.min(90,Math.round(55+Math.min(20,Math.abs(e9-e21)/last*10000*2)+Math.max(0,15-Math.abs(r-(direction==='LONG'?60:40)))));
 return {epic,direction,score,bars:bars.length,rsi:r,ema9:e9,ema21:e21,reason:'Experimental closed-candle heuristic, not a win probability'};
}
function closeStream(){if(client){try{if(sub)for(const item of sub)client.unsubscribe(item);client.disconnect()}catch{} }client=null;sub=null;for(const m of markets.values())m.streaming=false;}
function startStream(){
 if(!auth?.streamUrl||!auth.accountId)throw Error('IG login did not supply streaming endpoint/account');
 closeStream();streamStatus='connecting';streamError='';
 // Use IG's endpoint returned by /session. The adapter set is the server default.
 const ls=new LightstreamerClient(auth.streamUrl,null);
 ls.connectionDetails.setUser(auth.accountId);
 ls.connectionDetails.setPassword(`CST-${auth.cst}|XST-${auth.xst}`);
 const epics=[...markets.keys()].slice(0,MAX);if(!epics.length)throw Error('No forex markets discovered');
 // IG replaced deprecated MARKET:{epic} with PRICE:{accountId}:{epic} in 2026.
 // Subscribe individually so an unsupported instrument does not block all others.
 const subscriptions=[];
 for(const epic of epics){
  const item='PRICE:'+auth.accountId+':'+epic;
  const subscription=new Subscription('MERGE',item,['BIDPRICE1','ASKPRICE1','DLG_FLAG','TIMESTAMP','DELAY']);
  subscription.setRequestedSnapshot('yes');
  subscription.addListener({
   onSubscription(){log('Price subscription accepted: '+epic)},
   onSubscriptionError(code,message){streamError=`${epic}: subscription ${code}: ${message}`;log(streamError)},
   onItemUpdate(update){
    const old=quotes.get(epic)||{};
    const bid=n(update.getValue('BIDPRICE1'))??old.bid;
    const ask=n(update.getValue('ASKPRICE1'))??old.ask;
    if(bid==null||ask==null||bid<=0||ask<=bid)return;
    const state=update.getValue('DLG_FLAG')||old.marketState||'UNKNOWN';
    const delayed=update.getValue('DELAY')??old.delayed??null;
    const now=Date.now();quotes.set(epic,{bid,ask,spread:ask-bid,at:now,marketState:state,delayed});
    markets.get(epic).streaming=true;
    if(state==='DEAL'&&String(delayed)!=='1')candleFromQuote(epic,(bid+ask)/2,now);
    signals.set(epic,analyse(epic));
   }
  });
  subscriptions.push(subscription);
 }
 ls.addListener({onStatusChange(status){streamStatus=status;if(String(status).startsWith('CONNECTED'))lastConnected=new Date().toISOString()},onServerError(code,message){streamError=`Server ${code}: ${message}`;log(streamError)}});
 client=ls;sub=subscriptions;ls.connect();for(const subscription of subscriptions)ls.subscribe(subscription);
 log(`Connecting IG PRICE stream for ${epics.length} forex markets`);
}
async function refreshAccount(){const a=await api('/accounts');const ac=(a.accounts||[]).find(x=>x.accountId===auth.accountId)||(a.accounts||[]).find(x=>x.accountType==='CFD');
 if(ac)account={accountId:ac.accountId,currency:ac.currency,balance:ac.balance?.balance,equity:ac.balance?.balance+ac.balance?.profitLoss};
 const p=await api('/positions','GET',null,'2');positions=(p.positions||[]).map(x=>({epic:x.market?.epic,direction:x.position?.direction,size:x.position?.size,dealId:x.position?.dealId}));lastAccountRefresh=new Date().toISOString();}
async function init(){if(starting)return;starting=true;try{await login();await discover();await refreshAccount();startStream()}catch(e){streamStatus='error';streamError=e.message;log('Startup: '+e.message)}finally{starting=false}}
function requireAdmin(req,res,next){const token=process.env.ADMIN_TOKEN;if(!token)return res.status(503).json({error:'Set ADMIN_TOKEN in Render'});if(req.get('X-Admin-Token')!==token)return res.status(403).json({error:'Invalid admin token'});next()}
app.get('/api/health',(req,res)=>res.json({ok:true,version:'3.4.0',mode:'DEMO_MONITOR_ONLY',streamStatus,marketCount:markets.size}));
app.get('/api/state',(req,res)=>{const now=Date.now(),list=[...markets.values()].map(m=>{const q=quotes.get(m.epic),s=analyse(m.epic);return {...m,...s,bid:q?.bid??null,ask:q?.ask??null,spread:q?.spread??null,marketState:q?.marketState||'UNKNOWN',lastTick:q?new Date(q.at).toISOString():null,ageSeconds:q?Math.round((now-q.at)/1000):null}});
 res.json({version:'3.4.0',mode:'DEMO_MONITOR_ONLY',auto:false,orderExecutionEnabled:false,streamStatus,streamError,lastConnected,account,positions,lastAccountRefresh,lastDiscovery,discoverError,marketCount:markets.size,subscribedCount:list.filter(x=>x.streaming).length,streamCap:MAX,markets:list,activity:events.slice(0,30),note:'Read-only demo monitor. No order submission endpoints.'})});
app.get('/api/ig/test',async(req,res)=>{try{const a=await api('/accounts');res.json({ok:true,accountsReturned:a.accounts?.length||0,note:'No orders placed. Restart stream using admin reconnect if necessary.'})}catch(e){res.status(502).json({error:e.message})}});
app.post('/api/admin/reconnect',requireAdmin,async(req,res)=>{await init();res.json({ok:true,streamStatus,streamError})});
app.post('/api/admin/refresh',requireAdmin,async(req,res)=>{try{await refreshAccount();res.json({ok:true,account,positions})}catch(e){res.status(502).json({error:e.message})}});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const port=Number(process.env.PORT)||3000;app.listen(port,()=>{log('V3.4 DEMO monitoring-only started; orders permanently disabled');init()});
setInterval(()=>{refreshAccount().catch(e=>log('Account refresh: '+e.message))},120000);
setInterval(()=>{if(!starting&&(!client||streamStatus==='error'||streamStatus==='disconnected'||String(streamStatus).startsWith('DISCONNECTED'))&&Date.now()>reconnectAt){reconnectAt=Date.now()+60000;init()}},30000);
