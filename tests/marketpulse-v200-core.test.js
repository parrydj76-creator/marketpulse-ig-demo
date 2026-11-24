const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');const c=require('../marketpulse-v200-core');
const fixture={pipValue:10,conversion:.77,size:.1,stopPips:12,cap:25,pointSize:.0001,pipSize:.0001,minPoints:2};
test('indicative risk',()=>{const r=c.risk(fixture);assert.ok(Math.abs(r.gbp-9.24)<1e-9);assert.equal(r.certified,false);assert.equal(r.minimumMet,true)});
test('invalid inputs',()=>assert.throws(()=>c.risk({...fixture,conversion:0})));
test('cap and stop',()=>{const r=c.risk({...fixture,size:10,minPoints:20});assert.equal(r.withinCap,false);assert.equal(r.minimumMet,false)});
test('missing latch fails closed',()=>{assert.equal(c.gate('/nonexistent').brokerOrdersAllowed,false)});
test('durable local recovery',()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'mp20-'));try{assert.deepEqual(c.recoveryTest(d),{restoredUnknown:true,duplicateBlocked:true,finalState:'RECONCILED',brokerTested:false})}finally{fs.rmSync(d,{recursive:true,force:true})}});
