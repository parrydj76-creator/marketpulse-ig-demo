'use strict';
const assert=require('node:assert/strict');
const {evaluate}=require('./v242-execution-foundation');
const base={market:{instrument:{epic:'CS.D.EURUSD.MINI.IP'},snapshot:{marketStatus:'TRADEABLE',bid:1.12,offer:1.1201},dealingRules:{minDealSize:{value:1,unit:'POINTS'},minNormalStopOrLimitDistance:{value:5,unit:'POINTS'}}},positions:{positions:[]},accounts:{accounts:[{currency:'GBP',accountType:'CFD'}]},request:{epic:'CS.D.EURUSD.MINI.IP',side:'BUY',size:1,stopPips:12,targetPips:18,maxRiskGBP:25}};
const a=evaluate(base);assert.equal(a.brokerOrderAllowed,false);assert.equal(a.preflightChecksPassed,false);assert.equal(a.estimatedWorstCaseGBP,null);assert.ok(a.errors.includes('INDEPENDENT_GBP_PIP_VALUE_UNVERIFIED'));
assert.ok(evaluate({...base,positions:{positions:[{}]}}).errors.includes('ACCOUNT_HAS_OPEN_POSITIONS'));
assert.ok(evaluate({...base,request:{...base.request,size:0.1}}).errors.includes('BELOW_BROKER_MIN_SIZE'));
assert.ok(evaluate({...base,market:{...base.market,snapshot:{...base.market.snapshot,marketStatus:'CLOSED'}}}).errors.includes('MARKET_NOT_TRADEABLE'));
console.log('PASS: broker writes blocked, risk unknown, positions guard, size guard, closed market guard');
