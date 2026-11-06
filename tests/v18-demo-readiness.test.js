const test=require('node:test'),assert=require('node:assert/strict');
const {readiness}=require('../v18-demo-readiness');
test('unverified gates block readiness',()=>{const x=readiness({verification:{}},{});assert.equal(x.brokerExecution,'HARD_BLOCKED');assert.equal(x.allBrokerChecksVerified,false);assert.equal(x.checks.length,4)});
test('even verified flags never authorize broker execution',()=>{const verification={igGBPPerPip:true,igDealSize:true,brokerOrderRecovery:true,crashRecovery:true};const x=readiness({verification},{});assert.equal(x.allBrokerChecksVerified,true);assert.equal(x.brokerExecution,'HARD_BLOCKED');assert.equal(x.brokerOrdersSent,0)});
