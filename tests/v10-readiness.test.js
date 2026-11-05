 'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {positionAudit,brokerReadiness}=require('../v10-readiness');
const config={riskFraction:.0025,dailyLossFraction:.01,maxNewTradesPerDay:2};
const state=()=>({equity:10000,dayStartEquity:10000,dayRealized:0,dailyOpens:1,position:{direction:'SHORT',entry:1.12178,stop:1.12298,target:1.11998,riskGBP:25,virtualGBPPerPip:25/12}});
test('v9 SHORT sample risk audit passes',()=>assert.equal(positionAudit(state(),config).pass,true));
test('rejects malformed stop orientation',()=>{const s=state();s.position.stop=1.12;assert.equal(positionAudit(s,config).pass,false)});
test('flags open risk beyond remaining daily loss budget',()=>{const s=state();s.dayRealized=-90;assert.equal(positionAudit(s,config).pass,false)});
test('flags excessive daily opens',()=>{const s=state();s.dailyOpens=3;assert.equal(positionAudit(s,config).pass,false)});
test('broker readiness always blocked even with rules',()=>{const r=brokerReadiness({instrument:{name:'EUR/USD'},snapshot:{marketStatus:'TRADEABLE'},dealingRules:{minDealSize:{value:1},minNormalStopOrLimitDistance:{value:5}}},[],{accountId:'test'});assert.equal(r.readyForOrders,false);assert.equal(r.brokerExecution,'BLOCKED');assert.ok(r.checks.some(c=>!c.pass))});
