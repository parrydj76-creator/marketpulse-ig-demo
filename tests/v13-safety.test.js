'use strict';const test=require('node:test'),assert=require('node:assert/strict');const {idForIntent,assess}=require('../v13-safety');
const base={epic:'CS.D.EURUSD.CFD.IP',direction:'SHORT',signalBar:'2026-11-06T09:00:00Z',strategyVersion:'v13-safety-preview'};
test('same intent deterministic',()=>assert.equal(idForIntent(base),idForIntent({...base})));
test('different bar has distinct ID',()=>assert.notEqual(idForIntent(base),idForIntent({...base,signalBar:'2026-11-06T09:05:00Z'})));
test('different direction has distinct ID',()=>assert.notEqual(idForIntent(base),idForIntent({...base,direction:'LONG'})));
test('unverified broker conversion fails closed',()=>{const a=assess({equity:10000,riskGBP:25,stopPips:12});assert.equal(a.brokerOrderAllowed,false);assert.equal(a.brokerDealSize,null);assert.ok(a.issues.some(s=>s.includes('conversion')))});
test('over-budget risk rejected',()=>assert.ok(assess({equity:10000,riskGBP:26,stopPips:12}).issues.some(s=>s.includes('0.25%'))));
test('even marked verifications do not enable execution',()=>assert.equal(assess({equity:10000,riskGBP:25,stopPips:12,brokerGBPPerPipVerified:true,brokerDealSizeVerified:true,orderLifecycleVerified:true,restartRecoveryVerified:true}).brokerOrderAllowed,false));
