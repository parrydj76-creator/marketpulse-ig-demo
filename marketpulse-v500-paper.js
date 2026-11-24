'use strict';
const fs=require('fs'),path=require('path');
function create({dir, snapshot, clock=Date.now}){
 const file=path.join(dir,'v500-paper.json');let error=null, state={enabled:false,position:null,events:[],seen:{},day:'',opens:0,netPips:0};
 try{const x=JSON.parse(fs.readFileSync(file,'utf8'));if(x.schema!==1||!Array.isArray(x.events)||!x.seen||typeof x.enabled!=='boolean'||!Number.isFinite(x.netPips)||!Number.isInteger(x.opens))throw Error('Invalid journal');state=x}catch(e){if(e.code!=='ENOENT')error='Journal restore failed'}
 function commit(next){if(error)throw Error(error);const tmp=file+'.tmp';try{fs.mkdirSync(dir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify({...next,schema:1}));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const d=fs.openSync(dir,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}state=next}catch(e){error='Journal write failed';throw Error(error)}}
 function status(){return {...state,error,mode:'PAPER_ONLY',brokerOrdersAllowed:false,limits:{maxPositions:1,maxEntriesPerUtcDay:3,stopPips:12,targetPips:18,minScore:70,maxSpreadPips:2},note:'Sampled bid/ask simulation; no GBP P&L or broker fills. Pause blocks entries; exits continue when quotes are valid.'}}
 function enable(on){if(typeof on!=='boolean')throw Error('Invalid setting');if(!snapshot().storage)throw Error('Durable storage unavailable');commit({...state,enabled:on});return status()}
 function tick(){if(error)return;const s=snapshot(),now=clock();if(!s.storage)return;const day=new Date(now).toISOString().slice(0,10),n=structuredClone(state);if(n.day!==day){n.day=day;n.opens=0}const valid=m=>m&&m.fresh&&Number.isFinite(m.bid)&&Number.isFinite(m.ask)&&m.bid>0&&m.ask>=m.bid;const pip=e=>e.includes('JPY')?.01:.0001;const event=(type,p,extra={})=>{n.events.push({at:new Date(now).toISOString(),type,...p,...extra});n.events=n.events.slice(-200)};
 if(n.position){const p=n.position,m=s.markets.find(x=>x.epic===p.epic);if(!valid(m))return;const exit=p.direction==='LONG'?m.bid:m.ask, pnl=(exit-p.entry)/pip(p.epic)*(p.direction==='LONG'?1:-1);if(pnl<=-12||pnl>=18||now-p.at>=10800000){n.netPips+=pnl;event('CLOSED',p,{exit,pips:pnl,reason:pnl<=-12?'STOP':pnl>=18?'TARGET':'TIME'});n.position=null;commit(n)}return}
 if(!n.enabled||n.opens>=3||s.memory>=400)return;
 const m=s.markets.filter(m=>valid(m)&&m.ready&&['LONG','SHORT'].includes(m.direction)&&m.score>=70&&typeof m.bar==='string'&&Number.isFinite(Date.parse(m.bar))&&now-Date.parse(m.bar)>=0&&now-Date.parse(m.bar)<600000&&n.seen[m.epic]!==m.bar&&(m.ask-m.bid)/pip(m.epic)<=2).sort((a,b)=>b.score-a.score)[0];if(!m)return;
 const p={epic:m.epic,direction:m.direction,entry:m.direction==='LONG'?m.ask:m.bid,at:now,bar:m.bar,score:m.score};n.position=p;n.seen[m.epic]=m.bar;n.opens++;event('OPENED',p);commit(n)
 }
 return {status,enable,tick};
}
module.exports={create};
