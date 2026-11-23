'use strict';
// Read-only candle integrity analysis. Never repairs, fabricates, or backfills bars.
const FIVE=300000;
function inspectMarket({epic,bars=[],quote=null,now=Date.now(),signal=null,memoryMB=null}){
 const recent=bars.slice(-30),issues=[];let firstGap=null,invalid=null;
 if(recent.length<30)issues.push('INSUFFICIENT_BARS');
 for(let i=0;i<recent.length;i++){
  const b=recent[i],t=Date.parse(b?.time);
  if(!Number.isFinite(t)||!Number.isFinite(b?.close)||!Number.isFinite(b?.ticks)||b.ticks<2){invalid={index:i,time:b?.time??null};issues.push('INVALID_BAR');break;}
  if(i>0){const prev=Date.parse(recent[i-1]?.time),delta=t-prev;
   if(delta!==FIVE&&!firstGap){firstGap={index:i,previous:recent[i-1]?.time??null,next:b.time,deltaMinutes:Number.isFinite(delta)?delta/60000:null,missingIntervals:Number.isFinite(delta)&&delta>FIVE?Math.round(delta/FIVE)-1:null};issues.push('NON_CONSECUTIVE_BARS');}
  }
 }
 const latest=recent.at(-1)?.time??null,latestAgeSeconds=latest===null?null:Math.round((now-Date.parse(latest))/1000);
 if(latestAgeSeconds!==null&&(!Number.isFinite(latestAgeSeconds)||latestAgeSeconds>900||latestAgeSeconds<0))issues.push('LAST_BAR_STALE_OR_INVALID');
 const quoteAgeSeconds=quote?.at===undefined?null:Math.round((now-quote.at)/1000);
 if(!quote||quote.source!=='STREAM'||quoteAgeSeconds===null||quoteAgeSeconds<0||quoteAgeSeconds>=15)issues.push('NO_FRESH_STREAM_QUOTE');
 if(quote?.marketState!=='DEAL')issues.push('MARKET_NOT_DEAL');
 if(quote?.delayed===null||quote?.delayed===undefined||String(quote.delayed)!=='0')issues.push('DELAY_NOT_EXPLICITLY_ZERO');
 if(memoryMB!==null&&memoryMB>=450)issues.push('MEMORY_GATE_450MB');
 const consecutive30=recent.length===30&&!firstGap&&!invalid;
 const signalWarming=signal?.direction==='WARMING';
 if(signalWarming&&!issues.includes('INSUFFICIENT_BARS')&&!issues.includes('NON_CONSECUTIVE_BARS')&&!issues.includes('LAST_BAR_STALE_OR_INVALID'))issues.push('SIGNAL_WARMING_OTHER_REASON');
 return {epic,totalBars:bars.length,windowBars:recent.length,consecutive30,firstGap,invalidBar:invalid,oldestBar:recent[0]?.time??null,latestBar:latest,latestAgeSeconds,quoteAgeSeconds,quoteSource:quote?.source??null,marketState:quote?.marketState??null,delay:quote?.delayed??null,signalDirection:signal?.direction??null,signalReason:signal?.reason??null,issues:[...new Set(issues)],diagnosticOnly:true};
}
function inspectAll({markets,now=Date.now(),memoryMB=null}){return {version:'8.1.0',at:new Date(now).toISOString(),mode:'READ_ONLY_CANDLE_INTEGRITY',markets:markets.map(m=>inspectMarket({...m,now,memoryMB})),safety:{brokerOrdersAllowed:false,brokerExecutionHardBlocked:true},note:'No bar synthesis, backfill, order submission, or readiness bypass. A full 30-bar window must pass original signal checks.'};}
module.exports={inspectMarket,inspectAll};
