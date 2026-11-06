'use strict';const assert=require('node:assert/strict');const {test}=require('node:test');const {createV16}=require('../v16-safety');
test('v16 module exposes no broker execution method',()=>{const x=createV16({requireAdmin:(_q,_r,next)=>next()});assert.equal(typeof x.executeBrokerOrder,'undefined');assert.equal(typeof x.negativeRiskTests,'function')});
test('negative virtual risk cases fail closed',()=>{const r=createV16({requireAdmin:(_q,_r,next)=>next()}).negativeRiskTests();assert.equal(r.pass,true);assert.equal(r.results.length,5);assert.equal(r.brokerOrdersSent,0)});
