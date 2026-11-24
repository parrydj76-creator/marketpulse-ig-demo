const {test}=require('node:test'),assert=require('node:assert/strict'),{report}=require('../marketpulse-v3500');
const base=()=>({paper:{events:[],lastTick:new Date().toISOString()},broker:{records:[]},confirmations:{records:[]},safety:{engaged:true,persisted:true,brokerOrdersAllowed:false},storage:{healthy:true}});
test('empty evidence never certifies',()=>{const r=report(base());assert.equal(r.certified,false);assert.equal(r.brokerOrdersAllowed,false);assert.equal(r.checks[2].status,'AWAITING_EVIDENCE')});
test('exit observed, restart only partial',()=>{const x=base();x.paper.events=[{type:'CLOSED',pips:18,reason:'TARGET'}];x.broker.records=[{restart:true,difference:{retained:['id']},rows:[{}]}];const r=report(x);assert.equal(r.checks[0].status,'OBSERVED');assert.equal(r.checks[3].status,'PARTIAL_EVIDENCE');assert.equal(r.certified,false)});
test('unpersisted latch fails',()=>{const x=base();x.safety.persisted=false;assert.equal(report(x).checks[4].status,'FAIL')});
