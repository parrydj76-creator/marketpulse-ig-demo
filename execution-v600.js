'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
function risk(x,now=Date.now()){
 const {pip,pipValue,gbpPerQuote,quoteAt,fxAt,entry,stop,target,direction,minSize,sizeStep,minStopPips,budget,dailyRemaining,exposureRemaining,precision}=x;
 if(![pip,pipValue,gbpPerQuote,entry,stop,target,minSize,sizeStep,minStopPips,budget,dailyRemaining,exposureRemaining].every(positive))throw Error('INVALID_OR_MISSING_INPUT');
 if(![quoteAt,fxAt].every(t=>Number.isFinite(t)&&now-t>=0&&now-t<=15000))throw Error('STALE_INPUT');
 if(!['BUY','SELL'].includes(direction)||!Number.isInteger(precision)||precision<0||precision>8)throw Error('INVALID_DIRECTION_OR_PRECISION');
 if(![entry,stop,target].every(v=>Math.abs(v*10**precision-Math.round(v*10**precision))<1e-6))throw Error('PRICE_PRECISION');
 const sign=direction==='BUY'?1:-1,stopPips=sign*(entry-stop)/pip,targetPips=sign*(target-entry)/pip;
 if(stopPips+1e-8<minStopPips||targetPips+1e-8<minStopPips)throw Error('STOP_OR_TARGET_DISTANCE');
 const cap=Math.min(budget,dailyRemaining,exposureRemaining),perContract=stopPips*pipValue*gbpPerQuote;
 const size=Math.floor(cap/perContract/sizeStep)*sizeStep;
 if(!positive(size)||size<minSize||size*perContract>cap)throw Error('RISK_CAP_OR_MIN_SIZE');
 return {size,stopPips,targetPips,estimatedGBP:size*perContract,cap,certified:false,scope:'simulation; excludes gaps, slippage and fees',brokerOrdersAllowed:false};
}
function journal(dir){const file=path.join(dir,'simulation-journal.json');function read(){try{const s=JSON.parse(fs.readFileSync(file,'utf8'));if(s.schema!==1||!Array.isArray(s.rows)||s.rows.some(r=>!['UNKNOWN','CONFIRMED','REJECTED'].includes(r.state)))throw Error('JOURNAL_INVALID');return s}catch(e){if(e.code==='ENOENT')return {schema:1,rows:[]};throw e}}
 function save(s){const tmp=file+'.'+crypto.randomUUID();try{const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(s));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const d=fs.openSync(dir,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}}finally{try{fs.unlinkSync(tmp)}catch{}}}
 function begin(id){const s=read();if(s.rows.some(r=>r.id===id||r.state==='UNKNOWN'))throw Error('DUPLICATE_OR_UNRESOLVED');if(s.rows.length>=1000)throw Error('JOURNAL_LIMIT');s.rows.push({id,state:'UNKNOWN'});save(s)}
 function resolve(id,evidence){const s=read(),r=s.rows.find(r=>r.id===id);if(!r||r.state!=='UNKNOWN'||evidence?.id!==id||!['CONFIRMED','REJECTED'].includes(evidence.state))throw Error('UNVERIFIED_SIMULATION_OUTCOME');r.state=evidence.state;save(s)}return {read,begin,resolve};}
function recoveryTest(dir){const d=fs.mkdtempSync(path.join(dir,'v600-sim-'));try{const j=journal(d);j.begin('fixture-1');const restored=journal(d);let duplicateBlocked=false;try{restored.begin('fixture-2')}catch{duplicateBlocked=true}restored.resolve('fixture-1',{id:'fixture-1',state:'CONFIRMED'});let replayBlocked=false;try{restored.begin('fixture-1')}catch{replayBlocked=true}return {unknownRestored:true,duplicateBlocked,replayBlocked,resolved:restored.read().rows[0].state,scope:'isolated file reopen, not process crash or broker recovery',brokerOrdersAllowed:false}}finally{fs.rmSync(d,{recursive:true,force:true})}}
function stopEvidence(p,c){const pos=p.position||{},i=c.instrument||{},r=c.dealingRules||{},pip=Number(String(i.onePipMeans||'').split(' ')[0]),entry=Number(pos.level),stop=Number(pos.stopLevel),size=Number(pos.size),distance=(pos.direction==='BUY'?1:pos.direction==='SELL'?-1:0)*(entry-stop)/pip;return {epic:p.market?.epic,dealId:pos.dealId,entry,stop:pos.stopLevel??null,size,stopPips:Number.isFinite(distance)&&pos.stopLevel!=null?distance:null,minimum:r.minNormalStopOrLimitDistance,observed:positive(stop)&&positive(entry)&&positive(size)&&positive(pip)&&distance>0,certified:false,scope:'read-only stop observation; broker distance units not certified'}}
module.exports={risk,journal,recoveryTest,stopEvidence};
