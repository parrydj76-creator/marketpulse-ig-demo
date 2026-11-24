'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {failClosedState,durableWrite}=require('./marketpulse-v95-safety');
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
function risk({pipValue,conversion,size,stopPips,cap,pointSize,pipSize,minPoints}){
 if(![pipValue,conversion,size,stopPips,cap,pointSize,pipSize,minPoints].every(positive))throw Error('INVALID_OR_UNVERIFIED_INPUT');
 const stopPoints=stopPips*pipSize/pointSize,gbp=pipValue*conversion*size*stopPips;
 if(!positive(gbp)||!positive(stopPoints))throw Error('INVALID_RESULT');
 return {gbp,stopPoints,withinCap:gbp<=cap,minimumMet:stopPoints>=minPoints,certified:false};
}
function gate(dir){const s=failClosedState(path.join(dir,'v95-kill-latch.json'));return {engaged:true,persisted:s.persisted,revision:s.revision,brokerOrdersAllowed:false,reason:'HARD_BLOCKED'};}
function journal(dir){const file=path.join(dir,'v200-local-recovery.json');
 function read(){if(!fs.existsSync(file))return {active:true,revision:0,events:[]};const s=JSON.parse(fs.readFileSync(file,'utf8'));if(s.active!==true||!Number.isSafeInteger(s.revision)||!Array.isArray(s.events)||s.events.length>64)throw Error('INVALID_JOURNAL');return s;}
 function append(id,state){const s=read();if(typeof id!=='string'||! /^[a-zA-Z0-9-]{1,64}$/.test(id))throw Error('INVALID_ID');const prior=s.events.filter(e=>e.id===id).at(-1)?.state;const allowed={NONE:['INTENT'],INTENT:['UNKNOWN'],UNKNOWN:['RECONCILED']};if(!allowed[prior||'NONE']?.includes(state))throw Error('INVALID_TRANSITION_OR_DUPLICATE');if(s.events.length>=64)throw Error('JOURNAL_FULL');const next={active:true,revision:s.revision+1,events:[...s.events,{id,state,at:new Date().toISOString()}]};durableWrite(file,next);return read();}
 return {read,append};}
function recoveryTest(dir){const tmp=fs.mkdtempSync(path.join(dir,'v200-test-'));try{const id=crypto.randomUUID();journal(tmp).append(id,'INTENT');journal(tmp).append(id,'UNKNOWN');const restored=journal(tmp).read();let duplicateBlocked=false;try{journal(tmp).append(id,'INTENT')}catch{duplicateBlocked=true}journal(tmp).append(id,'RECONCILED');return {restoredUnknown:restored.events.at(-1).state==='UNKNOWN',duplicateBlocked,finalState:journal(tmp).read().events.at(-1).state,brokerTested:false};}finally{fs.rmSync(tmp,{recursive:true,force:true});}}
module.exports={risk,gate,journal,recoveryTest};
