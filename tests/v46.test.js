'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createV46,verify}=require('../v46-soak');
function fixture(overrides={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v46-'));let now=Date.now();const stamp=()=>new Date(now).toISOString();
 const g={obs:{observedAt:stamp(),observationHealthy:true,brokerPositionCount:0},ev:{observedAt:stamp(),observationHealthy:true,brokerPositionCount:0,unresolvedProtocolIntents:0}};
 const options={requireAdmin:(_q,_r,next)=>next(),storageDir:dir,persistentStorage:true,clock:()=>now,enableTimer:false,
  v36Status:()=>({enabled:true,journal:{valid:true}}),v39Status:()=>({lifecycle:{heartbeat:{healthy:true},feedVerified:true}}),v40Status:()=>({journalHealthy:true,protocol:{unresolvedCount:0}}),
  v41Status:()=>({observation:g.obs,observationFresh:true,observationHealthy:true}),v42Status:()=>({lastObservation:g.ev,journalHealthy:true,persistentStorageConfigured:true}),
  v44Status:()=>({armed:false}),v45Status:()=>({armed:false}),
  refresh41:async()=>{g.obs={...g.obs,observedAt:stamp()};return g.obs},refresh42:async()=>{g.ev={...g.ev,observedAt:stamp()};return g.ev},...overrides};
 const x=createV46(options);return {x,g,advance:ms=>{now+=ms},close:()=>fs.rmSync(dir,{recursive:true,force:true}),options};
}
test('initial arming schedules beyond ten-second limiter',()=>{const f=fixture();try{const s=f.x.arm('Operator approves read-only monitoring');assert.equal(s.armed,true);assert.ok(Date.parse(s.nextCycleAt)-Date.now()>=11000)}finally{f.close()}});
test('early manual cycle defers without failure',async()=>{const f=fixture();try{f.x.arm('Operator approves read-only monitoring');const r=await f.x.cycle();assert.equal(r.action,'RATE_LIMIT_WAIT');assert.equal(r.failureCount,0);assert.equal(r.cycleCount,0);assert.equal(r.armed,true)}finally{f.close()}});
test('first cycle after gap succeeds, schedules next interval',async()=>{const f=fixture();try{f.x.arm('Operator approves read-only monitoring');f.advance(13000);const r=await f.x.cycle();assert.equal(r.action,'SAFE_READ_ONLY_TICK');assert.equal(r.successCount,1);assert.equal(r.failureCount,0);assert.ok(Date.parse(r.nextCycleAt)>Date.parse(r.lastCycle))}finally{f.close()}});
test('repeated cycles after spacing work',async()=>{const f=fixture();try{f.x.arm('Operator approves read-only monitoring');for(let i=0;i<5;i++){f.advance(31000);const r=await f.x.cycle();assert.equal(r.action,'SAFE_READ_ONLY_TICK')}assert.equal(f.x.status().successCount,5)}finally{f.close()}});
test('transient broker rate limit defers without recording failure',async()=>{const f=fixture({refresh41:async()=>{throw Error('BROKER_OBSERVATION_RATE_LIMIT_10_SECONDS')}});try{f.x.arm('Operator approves read-only monitoring');f.advance(13000);const r=await f.x.cycle();assert.equal(r.action,'RATE_LIMIT_WAIT');assert.equal(r.armed,true);assert.equal(r.failureCount,0);assert.equal(f.x.events().at(-1).kind,'RATE_LIMIT_DEFERRED')}finally{f.close()}});
test('other broker errors fail closed',async()=>{const f=fixture({refresh41:async()=>{throw Error('IG_UNAVAILABLE')}});try{f.x.arm('Operator approves read-only monitoring');f.advance(13000);const r=await f.x.cycle();assert.equal(r.action,'AUTO_DISARM');assert.equal(r.failureCount,1);assert.equal(r.armed,false)}finally{f.close()}});
test('legacy v45 armed blocks v46',()=>{const f=fixture({v45Status:()=>({armed:true})});try{assert.throws(()=>f.x.arm('Operator approves read-only monitoring'),/LEGACY_MONITOR_ALREADY_ARMED/)}finally{f.close()}});
test('journal survives restart, never auto-arms',async()=>{const f=fixture();try{f.x.arm('Operator approves read-only monitoring');f.advance(13000);await f.x.cycle();const restarted=createV46(f.options);assert.equal(restarted.status().armed,false);assert.equal(restarted.status().journalEvents,2)}finally{f.close()}});
test('tampered journal fails closed',()=>assert.throws(()=>verify([{previous:'GENESIS',event:{},hash:'BAD'}])));
