'use strict';
// V6.0 multi-market IG DEMO engine. Broker orders remain fail-closed without a
// durable execution journal; environment variables persist configuration only.
const fs=require('fs'),path=require('path');
const MAJOR_PAIRS=new Set(['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD']);
const num=(v,def=NaN)=>v===undefined||v===''?def:Number(v);
function createMultiEngine(ctx){
 const {api,quotes,candles,analyse,accountReady,brokerEnabled,storageAllowed,storageHealthy,brokerReady,legacyBusy,log,confirmDeal,host,authInfo,discoveredMarkets}=ctx;
 const env=process.env;
 const configs={};
 function refreshMarkets(){
  for(const [epic] of discoveredMarkets){
   const match=/^CS\.D\.([A-Z]{6})\.CFD\.IP$/.exec(epic);
   if(!match||!MAJOR_PAIRS.has(match[1]))continue;
   const key=match[1];if(configs[key])continue;
   const enabled=env[`MP_${key}_ENABLED`]==='true';
   configs[key]={key,epic,enabled,size:num(env[`MP_${key}_SIZE`]),stopDistance:num(env[`MP_${key}_STOP_POINTS`]),limitDistance:num(env[`MP_${key}_LIMIT_POINTS`]),maxSpread:num(env[`MP_${key}_MAX_SPREAD_PRICE`]),minScore:num(env[`MP_${key}_MIN_SCORE`],70),minSizeVerified:num(env[`MP_${key}_VERIFIED_MIN_SIZE`]),unitsVerified:env[`MP_${key}_POINT_UNITS_VERIFIED`]==='true',lifecycleVerified:env[`MP_${key}_LIFECYCLE_VERIFIED`]==='true',currencyCode:env[`MP_${key}_CURRENCY_CODE`]||''};
  }
  return Object.keys(configs).sort();
 }
 const globalCap=num(env.MP_GLOBAL_DAILY_CAP,2),maxOpen=num(env.MP_GLOBAL_MAX_OPEN,1),auto=env.MP_AUTO_RESUME==='true';
 const journalPath=env.MP_JOURNAL_PATH||path.join(env.DATA_DIR||path.join(__dirname,'data'),'multi-journal.json');
 const persistent=env.PERSISTENT_STORAGE_CONFIRMED==='true';
 const state={armed:false,haltReason:'Waiting for checks',busy:false,operatorStop:false,pending:null,positions:{},dailyOpens:0,day:new Date().toISOString().slice(0,10),lastBar:{},lastClose:{},events:[],ledgerRestored:false,ledgerHealthy:true,brokerHistoryVerified:false,validatedRules:{},lastError:null};
 function halt(reason){state.armed=false;state.haltReason=reason;log('V6 multi: '+reason)}
 function record(event,details={}){state.events.unshift({at:new Date().toISOString(),event,...details});state.events.length=Math.min(60,state.events.length);save()}
 function save(){try{fs.mkdirSync(path.dirname(journalPath),{recursive:true});const t=journalPath+'.tmp';fs.writeFileSync(t,JSON.stringify({pending:state.pending,positions:state.positions,dailyOpens:state.dailyOpens,day:state.day,lastBar:state.lastBar,lastClose:state.lastClose,events:state.events,operatorStop:state.operatorStop}));fs.renameSync(t,journalPath)}catch(e){state.ledgerHealthy=false;halt('Execution journal write failed: '+e.message)}}
 function restore(){try{const j=JSON.parse(fs.readFileSync(journalPath,'utf8'));for(const k of ['pending','positions','dailyOpens','day','lastBar','lastClose','events','operatorStop'])if(j[k]!==undefined)state[k]=j[k];state.ledgerRestored=true}catch(e){if(e.code!=='ENOENT'){state.ledgerHealthy=false;state.operatorStop=true;halt('Execution journal unreadable')}}}
 restore();
 function configErrors(c){let e=[];if(!Number.isFinite(c.size)||c.size<=0||c.size>1)e.push('size invalid or above 1');if(!Number.isFinite(c.minSizeVerified)||c.minSizeVerified<=0||c.size<c.minSizeVerified)e.push('minimum size not verified');if(!c.unitsVerified)e.push('point units not verified');if(!/^[A-Z]{3}$/.test(c.currencyCode))e.push('broker currencyCode not verified');if(!Number.isFinite(c.stopDistance)||c.stopDistance<=0)e.push('stop distance invalid');if(!Number.isFinite(c.limitDistance)||c.limitDistance<=0)e.push('limit distance invalid');if(!Number.isFinite(c.maxSpread)||c.maxSpread<=0)e.push('spread invalid');if(c.minScore<65||c.minScore>90)e.push('score outside 65-90');return e}
 function streamReady(c){const q=quotes.get(c.epic),s=analyse(c.epic),bars=candles.get(c.epic)||[];if(!q||q.source!=='STREAM'||q.marketState!=='DEAL'||q.delayed!==null&&String(q.delayed)!=='0'||Date.now()-q.at>15000)return false;if(bars.length<30||s.direction==='WARMING'||s.direction==='STALE')return false;const last=bars.slice(-30);return last.every((b,i)=>b.ticks>=2&&(i===0||Date.parse(b.time)-Date.parse(last[i-1].time)===300000))&&Date.now()-Date.parse(last.at(-1).time)<600000}
 async function rules(c){const m=await api('/markets/'+encodeURIComponent(c.epic));const currencies=(m.instrument?.currencies||[]).map(x=>x.code||x.currencyCode);if(!currencies.includes(c.currencyCode))throw Error(c.key+' configured currencyCode not present in IG instrument currencies');const d=m.dealingRules||{},minimum=d.minNormalStopOrLimitDistance,size=d.minDealSize;if(m.snapshot?.marketStatus!=='TRADEABLE')throw Error(c.key+' market not tradeable');if(minimum?.unit!=='POINTS'||!Number.isFinite(Number(minimum.value)))throw Error(c.key+' point stop rule unavailable');if(size?.unit!=='POINTS'||!Number.isFinite(Number(size.value)))throw Error(c.key+' size rule unavailable');if(c.stopDistance<Number(minimum.value)||c.limitDistance<Number(minimum.value)||c.size<Number(size.value))throw Error(c.key+' below IG minimum');state.validatedRules[c.key]={at:new Date().toISOString(),minStop:Number(minimum.value),minSize:Number(size.value)};return m}
 async function positions(){const p=await api('/positions','GET',null,'2');return (p.positions||[]).map(x=>({epic:x.market?.epic,dealId:x.position?.dealId,size:Number(x.position?.size),direction:x.position?.direction,stopLevel:x.position?.stopLevel,limitLevel:x.position?.limitLevel}))}
 // A restart cannot safely reconstruct today's completed orders from an ephemeral local file.
 // Never claim broker reconciliation proves the daily trade cap after an ephemeral reset.
 function ledgerReady(){return persistent&&state.ledgerHealthy&&state.ledgerRestored&&!state.pending}
 function status(){const keys=refreshMarkets();return {version:'6.2.0',demoOnly:true,autoResumeRequested:auto,armed:state.armed,haltReason:state.haltReason,brokerEnabled:brokerEnabled(),brokerReconciled:brokerReady(),journal:{persistent,restored:state.ledgerRestored,healthy:state.ledgerHealthy,pending:state.pending,brokerHistoryVerified:state.brokerHistoryVerified,automaticResumeSafe:ledgerReady()},global:{dailyCap:globalCap,dailyOpens:state.dailyOpens,maxOpen,tracked:state.positions},discoveredCount:keys.length,streamCapacity:Math.min(7,Number(env.MAX_STREAM_MARKETS||7)),markets:keys.map(k=>{const c=configs[k],q=quotes.get(c.epic),s=analyse(c.epic);return {key:k,epic:c.epic,enabled:c.enabled,configuration:{size:c.size,stopDistance:c.stopDistance,limitDistance:c.limitDistance,maxSpread:c.maxSpread,minScore:c.minScore},validationErrors:configErrors(c),lifecycleVerified:c.lifecycleVerified,streamReady:streamReady(c),bars:s.bars||0,direction:s.direction,score:s.score,quoteSource:q?.source||null,ruleCheck:state.validatedRules[k]||null}}),events:state.events.slice(0,15),lastError:state.lastError}}
 async function reconcile(){const all=await positions();if(state.pending){halt('Unresolved order journal; inspect IG before retrying');return all}for(const [id,p] of Object.entries(state.positions)){const found=all.find(x=>x.dealId===id);if(!found){state.operatorStop=true;halt('Previously tracked deal missing: '+id);return all}if(!Number.isFinite(found.stopLevel)||!Number.isFinite(found.limitLevel)){state.operatorStop=true;halt('Attached broker protection unverified for '+id);return all}}
 // Unrecognized positions require manual review, never silently adopt ownership.
 if(all.some(x=>!state.positions[x.dealId]))halt('Untracked broker position detected; inspect IG before resuming');return all}
 async function place(c,direction){if(!MAJOR_PAIRS.has(c.key))throw Error('Pair not approved for demo execution');if(state.pending)throw Error('Pending order unresolved');const payload={currencyCode:c.currencyCode,direction,epic:c.epic,expiry:'-',forceOpen:true,guaranteedStop:false,orderType:'MARKET',size:c.size,stopDistance:c.stopDistance,limitDistance:c.limitDistance};
 state.pending={kind:'OPEN',epic:c.epic,at:new Date().toISOString(),direction};save();if(!state.ledgerHealthy)throw Error('Cannot journal order');
 // POST is intentionally sent once. Network failure leaves pending journal and halts.
 const response=await api('/positions/otc','POST',payload,'2');const conf=await confirmDeal(response.dealReference);if(conf.dealStatus!=='ACCEPTED'||!conf.dealId)throw Error('IG order unconfirmed');const all=await positions();const pos=all.find(x=>x.dealId===conf.dealId);if(!pos||!Number.isFinite(pos.stopLevel)||!Number.isFinite(pos.limitLevel))throw Error('Accepted order: broker stop/limit not verified. Manual review required');state.positions[conf.dealId]={epic:c.epic,direction,size:c.size,openedAt:new Date().toISOString()};state.dailyOpens++;state.pending=null;record('OPEN_CONFIRMED',{epic:c.epic,dealId:conf.dealId,direction});return conf}
 async function tick(){const keys=refreshMarkets();if(state.busy||!auto||!brokerEnabled()||!storageAllowed()||!storageHealthy()||!brokerReady()||legacyBusy()||!accountReady()||state.operatorStop||!Number.isInteger(globalCap)||globalCap<1||globalCap>3||!Number.isInteger(maxOpen)||maxOpen<1||maxOpen>3)return;
 state.busy=true;try{
 if(!ledgerReady()){halt('Automatic resume blocked: durable execution journal required to preserve daily cap and pending orders');return}
 if(state.day!==new Date().toISOString().slice(0,10)){state.day=new Date().toISOString().slice(0,10);state.dailyOpens=0;save()}
 const all=await reconcile();if(state.pending||all.some(x=>!state.positions[x.dealId]))return;
 const active=keys.map(k=>configs[k]).filter(c=>c.enabled);if(!active.length){halt('No enabled markets');return}
 for(const c of active){const errors=configErrors(c);if(errors.length||!c.lifecycleVerified){halt(c.key+': '+(errors.join(', ')||'demo lifecycle not verified'));return}if(!streamReady(c)){halt(c.key+': waiting for 30 streamed bars');return}await rules(c)}
 state.armed=true;state.haltReason=null;
 if(state.dailyOpens>=globalCap||all.length>=maxOpen)return;
 for(const c of active){if(all.some(x=>x.epic===c.epic))continue;const q=quotes.get(c.epic),s=analyse(c.epic),bars=candles.get(c.epic)||[],bar=bars.at(-1)?.time;if(!bar||state.lastBar[c.key]===bar||!['LONG','SHORT'].includes(s.direction)||s.score<c.minScore||q.ask-q.bid>c.maxSpread)continue;
 state.lastBar[c.key]=bar;save();if(!state.ledgerHealthy)return;
 // Reconcile immediately before the sole order submission.
 const latest=await reconcile();if(latest.length>=maxOpen||latest.some(x=>x.epic===c.epic))return;
 await place(c,s.direction==='LONG'?'BUY':'SELL');break;
 }
 }catch(e){state.lastError=e.message;state.operatorStop=true;save();halt('Multi-market execution halted: '+e.message)}finally{state.busy=false}}
 function stop(){state.operatorStop=true;save();halt('Operator emergency stop');return status()}
 function resetOperatorStop(){if(state.pending)throw Error('Pending order unresolved');state.operatorStop=false;save();return status()}
 return {status,tick,stop,resetOperatorStop,reconcile,configs};
}
module.exports={createMultiEngine,EPICS:Object.freeze([
  'CS.D.EURUSD.CFD.IP','CS.D.GBPUSD.CFD.IP','CS.D.USDJPY.CFD.IP',
  'CS.D.USDCHF.CFD.IP','CS.D.USDCAD.CFD.IP','CS.D.AUDUSD.CFD.IP',
  'CS.D.NZDUSD.CFD.IP'
])};
