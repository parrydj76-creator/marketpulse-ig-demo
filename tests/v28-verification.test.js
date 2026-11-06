'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {riskPreview,classifyRecovery}=require('../v28-verification');
test('rejects unverified or missing values',()=>assert.equal(riskPreview({}).pass,false));
test('calculates illustrative GBP risk',()=>{const r=riskPreview({size:.1,stopPips:12,pipValueQuote:10,quoteToGBP:.77,budgetGBP:25,step:.01,minSize:.01});assert.equal(r.pass,true);assert.equal(r.brokerVerified,false);assert.ok(Math.abs(r.riskGBP-9.24)<1e-8)});
test('rejects oversize and misaligned increments',()=>{const x={size:.015,stopPips:12,pipValueQuote:10,quoteToGBP:.77,budgetGBP:1,step:.01,minSize:.01};assert.equal(riskPreview(x).pass,false)});
test('inflight open always requires manual reconciliation',()=>assert.equal(classifyRecovery({journal:{kind:'OPEN',createdAt:'2026-01-01'},positions:[]}).status,'MANUAL_REVIEW'));
test('missing broker positions blocks',()=>assert.equal(classifyRecovery({journal:null}).status,'BLOCKED'));
test('untracked positions require review',()=>assert.equal(classifyRecovery({journal:null,positions:[{dealId:'x'}]}).status,'MANUAL_REVIEW'));
