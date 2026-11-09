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
