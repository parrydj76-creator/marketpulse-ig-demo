const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {diskState,decide,modelScenarios,createLab}=require('../marketpulse-v104-safety-lab');
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v104-'));fs.writeFileSync(path.join(dir,'v95-kill-latch.json'),JSON.stringify({active:true,revision:3}));return dir}
function inputs(d){return {disk:diskState(d),legacy:{active:true,persisted:true},durable:{active:true,persisted:true,revision:3},storageHealthy:true,memoryMB:420,freshFeeds:7}}
test('valid disk latch is read but never authorizes orders',()=>{const d=fixture();try{const r=decide(inputs(d));assert.equal(r.failClosed,false);assert.equal(r.brokerOrdersAllowed,false)}finally{fs.rmSync(d,{recursive:true,force:true})}});
test('missing disk latch fails closed',()=>{const d=fixture();try{fs.unlinkSync(path.join(d,'v95-kill-latch.json'));assert.equal(decide(inputs(d)).failClosed,true)}finally{fs.rmSync(d,{recursive:true,force:true})}});
test('mismatched revision fails closed',()=>{const d=fixture();try{assert.ok(decide({...inputs(d),durable:{active:true,persisted:true,revision:4}}).failures.includes('DURABLE_LATCH_REVISION_UNVERIFIED'))}finally{fs.rmSync(d,{recursive:true,force:true})}});
test('legacy persistence conflict fails closed',()=>{const d=fixture();try{assert.ok(decide({...inputs(d),legacy:{active:true,persisted:false}}).failClosed)}finally{fs.rmSync(d,{recursive:true,force:true})}});
test('memory threshold and storage failure fail closed',()=>{const d=fixture();try{assert.ok(decide({...inputs(d),memoryMB:450}).failClosed);assert.ok(decide({...inputs(d),storageHealthy:false}).failClosed)}finally{fs.rmSync(d,{recursive:true,force:true})}});
test('all failure response scenarios explicitly untested at broker',()=>{const a=modelScenarios();assert.equal(a.length,6);assert.ok(a.every(x=>x.brokerTested===false))});
