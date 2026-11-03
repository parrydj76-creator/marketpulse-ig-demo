 'use strict';
// PAPER ONLY: this module never calls IG trading APIs or submits broker orders.
class PaperEngine {
 constructor(opts={}){this.cfg={epic:opts.epic||'CS.D.EURUSD.CFD.IP',dailyCap:opts.dailyCap||2,stopPips:opts.stopPips||12,targetPips:opts.targetPips||18,maxSpreadPips:opts.maxSpreadPips||2,holdMinutes:opts.holdMinutes||180,cooldownMinutes:opts.cooldownMinutes||30,minScore:opts.minScore||70};this.reset()}
 reset(){this.day=new Date().toISOString().slice(0,10);this.dailyOpens=0;this.position=null;this.history=[];this.lastSignalBar=null;this.lastCloseAt=0;this.lastDecision=null;this.realizedPips=0;this.enabled=true;this.startedAt=new Date().toISOString()}
 snapshot(){return {enabled:this.enabled,simulationOnly:true,ephemeral:true,warning:'All paper trades and P/L are simulated and reset when Render Free restarts; not IG broker positions or account P/L.',config:this.cfg,day:this.day,dailyOpens:this.dailyOpens,position:this.position,realizedPips:Number(this.realizedPips.toFixed(2)),lastDecision:this.lastDecision,history:this.history.slice(0,30),startedAt:this.startedAt}}
 tick(q,s,now=Date.now()){
  const day=new Date(now).toISOString().slice(0,10);if(day!==this.day){this.day=day;this.dailyOpens=0}
  const fresh=!!q&&q.source==='STREAM'&&now-q.at<15000&&q.marketState==='DEAL'&&String(q.delayed)==='0'&&Number.isFinite(q.bid)&&Number.isFinite(q.ask)&&q.ask>q.bid;
  const spread=fresh?(q.ask-q.bid)/0.0001:Infinity;
  this.lastDecision={at:new Date(now).toISOString(),direction:s?.direction||'WAIT',score:s?.score||0,bars:s?.bars||0,freshStream:fresh,spreadPips:Number.isFinite(spread)?Number(spread.toFixed(2)):null};
  if(!fresh)return;
  if(this.position){const p=this.position;const exitPrice=p.direction==='LONG'?q.bid:q.ask;const move=(exitPrice-p.entry)*(p.direction==='LONG'?1:-1)/0.0001;
   let reason=null;if(move<=-this.cfg.stopPips)reason='STOP';else if(move>=this.cfg.targetPips)reason='TARGET';else if(now-p.openedMs>=this.cfg.holdMinutes*60000)reason='MAX_HOLD';else if((p.direction==='LONG'&&s.direction==='SHORT')||(p.direction==='SHORT'&&s.direction==='LONG'))reason='REVERSAL';
   if(reason){const pnl=Number(move.toFixed(2));this.realizedPips+=pnl;this.history.unshift({kind:'CLOSE',at:new Date(now).toISOString(),direction:p.direction,entry:p.entry,exit:exitPrice,pnlPips:pnl,reason});this.position=null;this.lastCloseAt=now}return;
  }
  if(spread>this.cfg.maxSpreadPips||this.dailyOpens>=this.cfg.dailyCap||now-this.lastCloseAt<this.cfg.cooldownMinutes*60000)return;
  if(!s||!['LONG','SHORT'].includes(s.direction)||s.score<this.cfg.minScore||s.bars<30)return;
  // One entry per completed 5-minute signal bar; avoid repeated signals on every 15s cycle.
  const bar=Math.floor(now/300000);if(this.lastSignalBar===bar)return;this.lastSignalBar=bar;
  const entry=s.direction==='LONG'?q.ask:q.bid;
  this.position={direction:s.direction,entry,openedAt:new Date(now).toISOString(),openedMs:now,signalScore:s.score,spreadPips:Number(spread.toFixed(2))};this.dailyOpens++;
  this.history.unshift({kind:'OPEN',at:new Date(now).toISOString(),direction:s.direction,entry,score:s.score,spreadPips:Number(spread.toFixed(2))});this.history=this.history.slice(0,100);
 }
}
module.exports={PaperEngine};
