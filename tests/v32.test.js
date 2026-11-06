'use strict';const test=require('node:test'),assert=require('node:assert/strict');const {riskWorksheet,lifecycle,recoveryDecision}=require('../v32-verification');
test('risk math illustrative not certified',()=>{const r=riskWorksheet({instrumentType:'CFD',currency:'GBP',size:1,pipValuePerUnitGBP:7.7,stopPips:10,maxRiskGBP:100});assert.equal(r.illustrativeRiskGBP,77);assert.equal(r.certified,false)});
test('risk invalid input rejected',()=>assert.throws(()=>riskWorksheet({instrumentType:'CFD',currency:'GBP',size:0,pipValuePerUnitGBP:7,stopPips:10,maxRiskGBP:100})));
test('risk non GBP rejected',()=>assert.throws(()=>riskWorksheet({instrumentType:'CFD',currency:'USD',size:1,pipValuePerUnitGBP:7,stopPips:10,maxRiskGBP:100})));
test('lifecycle positive observation is still uncertified',()=>{const r=lifecycle({open:{dealStatus:'ACCEPTED',dealId:'abc',stopLevel:1.2},close:{dealStatus:'ACCEPTED',dealId:'abc'},dealId:'abc',positions:[]});assert.equal(r.observationsComplete,true);assert.equal(r.certified,false)});
test('lifecycle missing stop fails',()=>assert.equal(lifecycle({open:{dealStatus:'ACCEPTED',dealId:'abc'},close:{dealStatus:'ACCEPTED',dealId:'abc'},dealId:'abc',positions:[]}).observationsComplete,false));
test('pending unknown order requires manual reconciliation',()=>assert.equal(recoveryDecision([{intentId:'order1',state:'SENT_UNKNOWN'}],[]).decision,'MANUAL_RECONCILIATION_REQUIRED'));
test('no pending still disallows auto order',()=>assert.equal(recoveryDecision([],[]).safeToSubmitNewOrder,false));
test('duplicate intents rejected',()=>assert.throws(()=>recoveryDecision([{intentId:'order1',state:'PREPARED'},{intentId:'order1',state:'SENT_UNKNOWN'}],[])));
