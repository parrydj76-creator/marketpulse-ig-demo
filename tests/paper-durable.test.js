'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {PaperEngine}=require('../paper-engine');
const {durablePaperTick,restorePaperEngine}=require('../paper-durable');
const now=Date.parse('2026-11-05T12:00:00Z');
const quote={source:'STREAM',at:now,marketState:'DEAL',delayed:'0',bid:1.1,ask:1.1001};
const signal={direction:'LONG',score:80,bars:40};
test('DB failure leaves position, daily cap and history unchanged',async()=>{
 const engine=new PaperEngine();const before=engine.snapshot();
 await assert.rejects(durablePaperTick(engine,quote,signal,now,async()=>{throw Error('database unavailable')}),/database unavailable/);
 assert.deepEqual(engine.snapshot(),before);
});
test('successful open and close use same trade ID and commit before mutation',async()=>{
 const engine=new PaperEngine();const saved=[];
 const save=async e=>{assert.equal(engine.history.length,saved.length);saved.push(e);return {inserted:true}};
 await durablePaperTick(engine,quote,signal,now,save);
 assert.equal(engine.dailyOpens,1);assert.equal(engine.position.tradeId,saved[0].tradeId);
 const later=now+60000;
 await durablePaperTick(engine,{...quote,at:later,bid:1.102,ask:1.1021},signal,later,save);
 assert.equal(engine.position,null);assert.equal(saved[1].tradeId,saved[0].tradeId);
});
test('duplicate insert fails closed without mutation',async()=>{
 const engine=new PaperEngine();
 await assert.rejects(durablePaperTick(engine,quote,signal,now,async()=>({inserted:false})),/not newly committed/);
 assert.equal(engine.position,null);
});
test('restoration preserves counters but remains paused',()=>{
 const engine=new PaperEngine();restorePaperEngine(engine,{inspected:true,safeToResume:true,unresolvedPositions:[],day:'2026-11-05',dailyOpens:2,lastCloseAt:now,realizedPips:20,lastSignalBar:123});
 assert.equal(engine.enabled,false);assert.equal(engine.dailyOpens,2);assert.equal(engine.realizedPips,20);
});
test('unresolved position refuses restoration',()=>{
 assert.throws(()=>restorePaperEngine(new PaperEngine(),{inspected:true,safeToResume:false,unresolvedPositions:[{}]}),/manual reconciliation/);
});
