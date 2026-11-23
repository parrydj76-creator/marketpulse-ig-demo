 'use strict';const {test}=require('node:test'),assert=require('node:assert/strict');const b=require('../marketpulse-v110-boundary');
test('IG login remains permitted',()=>assert.equal(b.allowIGRequest('POST','/session'),true));
test('read-only broker positions allowed',()=>assert.equal(b.allowIGRequest('GET','/positions'),true));
test('all known dealing write paths blocked',()=>{for(const p of ['/positions/otc','/positions/otc/123','/workingorders/otc','/orders/otc'])for(const m of ['POST','PUT','DELETE'])assert.equal(b.allowIGRequest(m,p),false)});
test('direct write guard throws',()=>assert.throws(()=>b.assertNoBrokerWrite('POST','/positions/otc'),/BLOCKED/));
test('missing disk latch fails closed',()=>{const d=b.diskLatch('/nonexistent-dir-for-test');assert.equal(d.readable,false)});
test('even healthy model cannot authorize orders',()=>{const s=b.evaluate({disk:{readable:true,engaged:true,revision:1},durable:{active:true,persisted:true,revision:1},legacy:{active:true,persisted:true},memoryMB:400,storageHealthy:true,freshFeeds:7});assert.equal(s.brokerExecutionAllowed,false);assert.equal(s.failClosed,true)});
test('seven recovery models are not broker certified',()=>assert.equal(b.model().filter(x=>x.brokerTested).length,0));
