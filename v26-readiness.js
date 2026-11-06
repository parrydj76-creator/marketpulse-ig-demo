 'use strict';
const crypto=require('crypto');
function createV26({requireAdmin,readiness,simulation,feed,broker}){
 const startedAt=new Date().toISOString();let lastReport=null;
 const checks=()=>{
  const s=simulation(),f=feed(),b=broker();
  const rows=[
   ['server_running',true,'Application responding'],
   ['simulation_storage',s.healthy===true,'Simulation state persistence'],
   ['simulation_not_busy',s.busy===false,'No overlapping simulation cycle'],
   ['stream_connected',String(f.streamStatus||'').startsWith('CONNECTED'),'IG Lightstreamer connected'],
   ['stream_quote_fresh',f.source==='STREAM'&&Number.isFinite(f.ageMs)&&f.ageMs>=0&&f.ageMs<15000,'Fresh streaming quote (REST excluded)'],
   ['market_tradeable',f.marketState==='DEAL','Stream market status DEAL'],
   ['delay_confirmed',f.delayed===false,'IG confirms undelayed quote'],
   ['risk_currency_verified',false,'GBP/pip independently verified (not yet)'],
   ['deal_size_verified',false,'Broker deal size and increments independently verified (not yet)'],
   ['broker_lifecycle_verified',false,'Open/confirm/close lifecycle independently verified (not yet)'],
   ['restart_recovery_verified',false,'In-flight broker recovery independently verified (not yet)'],
   ['operator_approval',false,'Independent operator approval required']
  ].map(([id,pass,description])=>({id,pass,description}));
  return {version:'26.0.0',mode:'SIMULATION_AND_READINESS',startedAt,checkedAt:new Date().toISOString(),brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,simulation:{paused:s.state?.paused,healthy:s.healthy,positionOpen:!!s.state?.position,tradesToday:s.state?.tradesToday||0,realizedIllustrativeGBP:s.state?.realizedGBP||0,halt:s.state?.halt||null},feed:f,checks:rows,passed:rows.filter(x=>x.pass).length,total:rows.length,readyForBrokerOrders:false,warning:'No broker orders. GBP P&L is illustrative. Readiness checks are diagnostics, not broker authorization.'};
 };
 function report(){lastReport=checks();return lastReport}
 function routes(app){
  app.get('/api/v26/status',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(report()));
  app.get('/api/v26/report',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(report()));
  app.post('/api/v26/preflight',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(report()));
  app.get('/v26',(_req,res)=>res.sendFile(require('path').join(__dirname,'public','v26.html')));
 }
 return {routes,report};
}
module.exports={createV26};
