'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {assess,EPIC}=require('./v48-mini');
const market={instrument:{epic:EPIC,contractSize:'10000',valueOfOnePip:'1.00',onePipMeans:'0.0001 USD/EUR'},dealingRules:{minDealSize:{value:0.1,unit:'POINTS'},minNormalStopOrLimitDistance:{value:2,unit:'POINTS'}}};
test('Mini preview is read-only and conservative',()=>{const x=assess(market,{});assert.equal(x.indicative.stopLossUSD,1.2);assert.equal(x.brokerOrderAllowed,false);assert.equal(x.readyForUnattendedDemo,false);assert(x.issues.includes('GBP_SIZING_NOT_CERTIFIED'))});
test('Even claimed certifications cannot arm without independent broker adapter',()=>{const x=assess(market,{gbpSizing:{certified:true},brokerLifecycle:{certified:true},crashRecovery:{certified:true}},{dealSizeIncrementVerified:true,stopUnitsVerified:true,gbpPipValueIndependentlyVerified:true,brokerLossCrosscheckVerified:true});assert.equal(x.brokerOrderAllowed,false);assert(x.issues.includes('UNATTENDED_BROKER_EXECUTION_ADAPTER_NOT_CERTIFIED'))});
test('Wrong epic fails closed',()=>{assert(assess({...market,instrument:{...market.instrument,epic:'WRONG'}},{}).issues.includes('MINI_EPIC_NOT_VERIFIED'))});
