 'use strict';
const assert=require('node:assert/strict');const v=require('./v115-combined');
assert.equal(v.faultTests().passed,true);assert.equal(v.faultTests().count,10);
assert.equal(v.age(null,60000).fresh,false);
assert.equal(v.riskEvidence({gbpPerPipPerUnit:10,minSize:.1,sizeStep:.1,size:1,stopPips:12}).issues.includes('TRADE_RISK_EXCEEDED'),true);
assert.equal(v.pnlEvidence({}).certified,false);
(async()=>{let active=false;const pool={connect:async()=>({query:async sql=>{if(sql.includes('try_advisory')){const acquired=!active;active=true;return {rows:[{acquired}]};}active=false;return {rows:[{released:true}]};},release(){}})};const a=v.createLeaseWorkbench({pool});assert.equal((await a.acquire()).acquired,true);assert.equal((await a.acquire()).acquired,false);assert.equal((await a.release()).released,true);console.log('v115: 10 safety scenarios + lease workbench passed');})().catch(e=>{console.error(e);process.exitCode=1});
