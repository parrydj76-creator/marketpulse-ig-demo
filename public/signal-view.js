'use strict';
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.MarketPulseSignalView=api;
})(typeof window!=='undefined'?window:null,function(){
 function interpret(data){
  const market=(data?.markets||[]).find(x=>x.epic==='CS.D.EURUSD.CFD.IP')||{};
  const health=data?.feedHealth||{};
  const fresh=health.freshStream===true && market.streaming===true && market.priceSource==='STREAM' && Number.isFinite(market.ageSeconds) && market.ageSeconds>=0 && market.ageSeconds<20;
  if(!fresh)return {direction:'NO DATA',fresh:false,reason:health.reason||'Fresh IG streaming prices unavailable',alertable:false,bars:market.bars??0};
  const dir=market.direction;
  const bars=Number.isFinite(market.bars)?market.bars:0;
  if(dir==='WARMING'||bars<30)return {direction:'WARMING',fresh:true,reason:market.reason||`${bars}/30 completed 5-minute bars; initial warm-up can take at least 150 minutes`,alertable:false,bars};
  if(!['LONG','SHORT','WAIT'].includes(dir))return {direction:'WAIT',fresh:true,reason:'No qualified analysis decision available',alertable:false,bars};
  const alertable=(dir==='LONG'||dir==='SHORT') && Number.isFinite(market.score) && market.score>=70;
  const barTime=market.lastBarTime||null;
  return {direction:dir,fresh:true,reason:market.reason||'Experimental technical heuristic; not a win probability',score:market.score,bars,alertable,barTime};
 }
 function alertKey(s){return s.alertable && s.barTime ? `EURUSD:${s.direction}:${s.barTime}` : null}
 return {interpret,alertKey};
});
