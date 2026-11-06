'use strict';const test=require('node:test'),assert=require('node:assert/strict');const {validateExit,pairTrades,brokerEvidence}=require('../v12-validation');
const open={id:1,kind:'OPEN',payload:{direction:'SHORT',entry:1.12178,virtualGBPPerPip:25/12,openedAt:'2026-11-05T21:00:00Z'}};
const close={id:2,kind:'CLOSE',created_at:'2026-11-05T21:30:00Z',payload:{exit:1.11998,pnl:37.5,reason:'TARGET',position:open.payload}};
test('short target P/L matches virtual accounting',()=>assert.equal(validateExit(open,close).pass,true));
test('incorrect P/L fails closed',()=>assert.equal(validateExit(open,{...close,payload:{...close.payload,pnl:100}}).pass,false));
test('unmatched CLOSE fails',()=>assert.equal(pairTrades([close]).allPassed,false));
test('matched OPEN and CLOSE passes',()=>assert.equal(pairTrades([open,close]).passed,1));
test('broker evidence never manufactures size',()=>{const r=brokerEvidence({instrument:{epic:'CS.D.EURUSD.CFD.IP'},snapshot:{marketStatus:'TRADEABLE'},dealingRules:{minDealSize:{unit:'POINTS',value:1},minNormalStopOrLimitDistance:{unit:'POINTS',value:2}}},{positions:[]},{accounts:[{}]},{state:{equity:10000}});assert.equal(r.brokerDealSize,null);assert.equal(r.checks.at(-1).pass,false)});
