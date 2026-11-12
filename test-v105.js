'use strict';
const assert=require('node:assert/strict');const m=require('./v105-combined');
assert.equal(m.faultSuite().passed,true);
assert.equal(m.quoteGate({bid:1.2,ask:0,spreadPips:0,ageMs:1},true).localChecksPassed,false);
assert.equal(m.riskGate({gbpPerPipPerSize:1,minSize:.1,sizeStep:.1,stopPips:12,proposedSize:.15}).aligned,false);
assert.equal(m.accountingGate({historyComplete:true,netDailyPnlGBP:-110}).issues.includes('DAILY_LOSS_LIMIT'),true);
assert.equal(m.recoveryGate('UNKNOWN').autoRetry,false);
assert.equal(m.positionGate({brokerPositions:[{dealId:'A'}],expectedPositions:[{dealId:'B'}]}).matched,false);
console.log('v105 safety tests passed');
