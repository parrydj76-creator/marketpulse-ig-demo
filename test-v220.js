'use strict';
const assert=require('node:assert/strict');
const {preflight,createV220}=require('./v220-execution-preflight');
const base={epic:'CS.D.EURUSD.MINI.IP',currency:'GBP',direction:'BUY',size:0.1,gbpPerPipPerUnit:1,stopPips:12,spreadPips:1,slippagePips:2,roundTripFeesGBP:1,todayNetLossGBP:0,contractIndependentlyVerified:true,contractEvidenceRef:'ref',feesIndependentlyVerified:true,feeEvidenceRef:'ref',dealSizeIndependentlyVerified:true,dealSizeEvidenceRef:'ref',quoteAgeMs:100,exchangeTimestampVerified:true,exchangeTimestampEvidenceRef:'ref',activePositions:0,tradesToday:0};
const checks=[
 [preflight(base).candidateValid===true,'candidate maths'],
 [preflight(base).brokerOrderAllowed===false,'valid candidate still blocked'],
 [preflight({...base,contractIndependentlyVerified:false}).candidateValid===false,'contract fail closed'],
 [preflight({...base,quoteAgeMs:15001}).candidateValid===false,'stale quote fail closed'],
 [preflight({...base,spreadPips:3}).candidateValid===false,'spread fail closed'],
 [preflight({...base,size:5}).candidateValid===false,'trade risk fail closed'],
 [preflight({...base,todayNetLossGBP:99}).candidateValid===false,'daily loss fail closed'],
 [preflight({...base,tradesToday:3}).candidateValid===false,'trade count fail closed'],
 [preflight({...base,activePositions:1}).candidateValid===false,'position count fail closed'],
 [preflight({...base,stopPips:10}).candidateValid===false,'stop rule fail closed'],
 [preflight({...base,roundTripFeesGBP:-1}).candidateValid===false,'fee fail closed'],
 [preflight({...base,gbpPerPipPerUnit:'1'}).candidateValid===false,'type fail closed'],
];
for(const [ok,label] of checks)assert.ok(ok,label);
assert.throws(()=>createV220({}),/DEPENDENCIES_MISSING/);
console.log(`PASS: ${checks.length+1} v220 assertions; no broker orders`);
