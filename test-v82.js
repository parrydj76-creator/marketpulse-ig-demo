'use strict';const assert=require('node:assert/strict');const {evaluate,replay}=require('./v82-readiness');
const now=Date.parse('2026-11-11T15:00:00Z');const base={now,stream:{streamState:'CONNECTED',quote:{bid:1.1,ask:1.1001,ageMs:100,spreadPips:1,delay:null,exchangeTimestampCertified:false}},research:{signal:{direction:'BUY',score:80}},paper:{journalHealthy:true,scheduled:true,lastTickAt:new Date(now-1000).toISOString(),assumptionCertified:false},audit:{}};
const r=evaluate(base);assert.equal(r.brokerOrderAllowed,false);assert(r.blockers.includes('BROKER_NET_PNL_UNCERTIFIED'));assert(r.blockers.includes('FEED_ENTITLEMENT_UNCERTIFIED'));
const q=[{ts:1,bid:1.1,ask:1.1001},{ts:2,bid:1.0988,ask:1.0989}];const x=replay(q,{side:'BUY'});assert.equal(x.exit.reason,'STOP');assert(x.illustrativePnlGBP<0);assert.equal(x.brokerOrderAllowed,false);
const y=replay([{ts:1,bid:1.1,ask:1.1001},{ts:2,bid:1.102,ask:1.1021}],{side:'BUY'});assert.equal(y.exit.reason,'TARGET');
assert.throws(()=>replay([{ts:2,bid:1.1,ask:1.2},{ts:1,bid:1.1,ask:1.2}]),/UNORDERED/);
assert(evaluate({...base,paper:{...base.paper,lastTickAt:new Date(now-60000).toISOString()}}).blockers.includes('PAPER_WATCHDOG_STALE'));
console.log('v82 offline tests passed');
