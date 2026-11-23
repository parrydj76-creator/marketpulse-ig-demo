 'use strict';const test=require('node:test'),assert=require('node:assert/strict');const v=require('../marketpulse-v120-verification');
test('valid risk formula is illustrative, not certified',()=>{const x=v.riskExample(7.7,12,.1,25);assert.equal(x.estimatedRiskGBP,9.24);assert.equal(x.certified,false)});
test('risk cap rejects oversized example',()=>assert.equal(v.riskExample(7.7,12,1,25).withinCap,false));
test('invalid risk input fails closed',()=>assert.equal(v.riskExample(NaN,12,1,25).ok,false));
test('unknown order outcome cannot be retried',()=>assert.equal(v.transition('PREPARED','SUBMIT_UNKNOWN').state,'SUBMISSION_UNKNOWN'));
test('unknown outcome requires reconciliation',()=>assert.equal(v.transition('SUBMISSION_UNKNOWN','RECONCILE').state,'RECONCILING'));
test('invalid state transition halts',()=>assert.equal(v.transition('NEW','FOUND').state,'HALTED'));
test('model scenarios pass',()=>assert.ok(v.scenarios().every(x=>x.passed&&x.brokerTested===false)));
test('missing disk latch fails closed',()=>{const d=v.report({dataDir:'/not-a-real-path',bootAt:'now',legacy:{},durable:{},memoryMB:450,storageHealthy:false,freshFeeds:0,brokerBlocked:true});assert.equal(d.brokerExecutionAllowed,false);assert.ok(d.findings.includes('DURABLE_LATCH_UNVERIFIED_FAIL_CLOSED'))});
