'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function createV25({requireAdmin,signalSnapshot,dir=process.env.DATA_DIR||path.join(__dirname,'data')}){
 const file=path.join(dir,'v25-autonomy.json');
 const defaults={riskGBP:25,dailyLossGBP:100,maxTrades:3,stopPips:12,targetPips:18,pipValueGBP:7.7,minScore:70,maxSpreadPips:2,quantityStep:0.01,minQuantity:0.01,maxQuantity:1};
 let config={...defaults},state={day:'',tradesToday:0,realizedGBP:0,position:null,events:[],lastBar:null,paused:true,halt:'Requires explicit simulation start',revision:0};
 let healthy=true,busy=false;
 const persist=()=>{try{fs.mkdirSync(dir,{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify({config,state}));fs.renameSync(tmp,file);healthy=true;}catch(e){healthy=false;state.paused=true;state.halt='Persistence failure: '+e.message;throw e}};
 try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));config={...defaults,...saved.config};state={...state,...saved.state,paused:true,halt:'Restart requires explicit simulation start'};persist()}catch(e){if(e.code!=='ENOENT'){healthy=false;state.paused=true;state.halt='State recovery failed: '+e.message}}
 const event=(type,data={})=>{state.events.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),type,...data});state.events=state.events.slice(0,300);state.revision++};
 const status=()=>({version:'25.0.0',mode:'AUTONOMOUS_SIMULATION',brokerOrderAllowed:false,brokerExecution:'HARD_BLOCKED',healthy,busy,config,state});
 function validConfig(x){if(!x||typeof x!=='object')throw Error('Invalid configuration');for(const k of Object.keys(defaults))if(typeof x[k]!=='number'||!Number.isFinite(x[k])||x[k]<=0)throw Error('Invalid '+k);if(!Number.isInteger(x.maxTrades)||x.maxTrades>20)throw Error('Invalid maxTrades');if(x.minScore>100||x.maxSpreadPips>20||x.quantityStep>1||x.minQuantity>x.maxQuantity)throw Error('Invalid limits');return x}
 function start(){if(!healthy)throw Error('Storage unavailable');if(state.position)throw Error('Existing position requires resolution');state.paused=false;state.halt=null;event('START');persist();return status()}
 function stop(){state.paused=true;state.halt='Operator stop; simulated position remains tracked';event('STOP');persist();return status()}
 function update(x){if(!state.paused||state.position)throw Error('Stop and close simulation before reconfiguration');config=validConfig(x);event('CONFIG');persist();return status()}
 function resetDay(now){const d=new Date(now).toISOString().slice(0,10);if(state.day!==d){state.day=d;state.tradesToday=0;state.realizedGBP=0;event('NEW_DAY',{day:d})}}
 function close(price,reason,now){const p=state.position;if(!p)return;const pips=(price-p.entry)/0.0001*(p.direction==='LONG'?1:-1);const pnl=Math.round(pips*p.quantity*config.pipValueGBP*100)/100;state.realizedGBP=Math.round((state.realizedGBP+pnl)*100)/100;event('CLOSE',{reason,price,pnlGBP:pnl,pips,quantity:p.quantity});state.position=null;if(state.realizedGBP<=-config.dailyLossGBP){state.paused=true;state.halt='Daily loss limit reached';event('HALT')};}
 function tick(s,now=Date.now()){
  if(busy)return status();busy=true;
  try{
   if(state.paused||!healthy)return status();
   if(!s||s.epic!=='CS.D.EURUSD.CFD.IP'||s.quoteSource!=='STREAM'||s.marketState!=='DEAL'||s.delayed!==false||!Number.isFinite(s.quoteAgeMs)||s.quoteAgeMs<0||s.quoteAgeMs>15000||!Number.isFinite(s.bid)||!Number.isFinite(s.ask)||s.ask<=s.bid)return status();
   resetDay(now);
   const spread=(s.ask-s.bid)/0.0001;
   if(state.position){const p=state.position;const exit=p.direction==='LONG'?s.bid:s.ask;const hitStop=p.direction==='LONG'?exit<=p.stop:exit>=p.stop;const hitTarget=p.direction==='LONG'?exit>=p.target:exit<=p.target;
    if(hitStop||hitTarget){close(exit,hitStop?'STOP':'TARGET',now);persist();return status();}
   }
   if(state.position||state.paused||state.tradesToday>=config.maxTrades||state.realizedGBP<=-config.dailyLossGBP||spread>config.maxSpreadPips||!['LONG','SHORT'].includes(s.direction)||s.score<config.minScore||!s.bar||s.bar===state.lastBar)return status();
   const entry=s.direction==='LONG'?s.ask:s.bid;
   const raw=config.riskGBP/(config.stopPips*config.pipValueGBP);
   const qty=Math.floor((raw+1e-10)/config.quantityStep)*config.quantityStep;
   if(qty<config.minQuantity||qty>config.maxQuantity){event('SIZE_REJECTED',{raw,quantity:qty});state.lastBar=s.bar;persist();return status()}
   const side=s.direction==='LONG'?1:-1;
   state.position={id:crypto.randomUUID(),direction:s.direction,entry,stop:entry-side*config.stopPips*0.0001,target:entry+side*config.targetPips*0.0001,quantity:qty,openedAt:new Date(now).toISOString(),bar:s.bar};state.tradesToday++;state.lastBar=s.bar;event('OPEN',{...state.position,simulated:true});persist();return status();
  }catch(e){state.paused=true;state.halt='Cycle failed: '+e.message;try{persist()}catch{}return status()}finally{busy=false}
 }
 function routes(app){app.get('/api/v25/status',requireAdmin,(_req,res)=>res.json(status()));app.post('/api/v25/start',requireAdmin,(_req,res)=>{try{res.json(start())}catch(e){res.status(409).json({error:e.message})}});app.post('/api/v25/stop',requireAdmin,(_req,res)=>{try{res.json(stop())}catch(e){res.status(503).json({error:e.message})}});app.put('/api/v25/config',requireAdmin,(req,res)=>{try{res.json(update(req.body))}catch(e){res.status(400).json({error:e.message})}});app.post('/api/v25/tick',requireAdmin,(_req,res)=>res.json(tick(signalSnapshot())))}
 return {routes,tick,status,start,stop,update};
}
module.exports={createV25};
