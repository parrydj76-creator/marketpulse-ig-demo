 'use strict';
// v12: read-only evidence and executable model tests. Never submits an IG order.
const fs=require('node:fs'),path=require('node:path');
const {diskLatch}=require('./marketpulse-v110-boundary');
function riskExample(pipGBP,stopPips,size,capGBP){
 const a=[pipGBP,stopPips,size,capGBP];
 if(a.some(v=>!Number.isFinite(v)||v<=0))return {ok:false,reason:'INVALID_OR_UNVERIFIED_INPUT'};
 const risk=pipGBP*stopPips*size;
 return {ok:true,estimatedRiskGBP:Math.round(risk*100)/100,withinCap:risk<=capGBP,certified:false};
}
function transition(state,event){
 const allowed={NEW:['PREPARE'],PREPARED:['SUBMIT_UNKNOWN','CANCEL'],SUBMISSION_UNKNOWN:['RECONCILE'],RECONCILING:['FOUND','NOT_FOUND','ERROR'],OPEN:['CLOSE_UNKNOWN'],CLOSE_UNKNOWN:['RECONCILE'],CLOSED:[],HALTED:[]};
 if(!allowed[state]?.includes(event))return {state:'HALTED',reason:'INVALID_TRANSITION_FAIL_CLOSED'};
 const next={PREPARE:'PREPARED',SUBMIT_UNKNOWN:'SUBMISSION_UNKNOWN',CANCEL:'HALTED',RECONCILE:'RECONCILING',FOUND:'OPEN',NOT_FOUND:'HALTED',ERROR:'HALTED',CLOSE_UNKNOWN:'CLOSE_UNKNOWN'}[event];
 return {state:next,reason:next==='SUBMISSION_UNKNOWN'?'BROKER_OUTCOME_UNKNOWN_DO_NOT_RETRY':null};
}
function scenarios(){return [
 {name:'DUPLICATE_INTENT',passed:transition('PREPARED','PREPARE').state==='HALTED'},
 {name:'SUBMISSION_TIMEOUT',passed:transition('PREPARED','SUBMIT_UNKNOWN').state==='SUBMISSION_UNKNOWN'},
 {name:'UNKNOWN_OUTCOME_RECONCILE',passed:transition('SUBMISSION_UNKNOWN','RECONCILE').state==='RECONCILING'},
 {name:'RECONCILIATION_ERROR',passed:transition('RECONCILING','ERROR').state==='HALTED'},
 {name:'UNEXPECTED_TRANSITION',passed:transition('NEW','FOUND').state==='HALTED'},
 {name:'RISK_CAP',passed:riskExample(7.7,12,1,25).withinCap===false},
 {name:'INVALID_RISK_INPUT',passed:riskExample(NaN,12,1,25).ok===false}
 ].map(x=>({...x,modelOnly:true,brokerTested:false}));}
function report({dataDir,bootAt,legacy,durable,memoryMB,storageHealthy,freshFeeds,brokerBlocked}){
 const disk=diskLatch(dataDir),now=durable?.latch||{},old=legacy?.killSwitch||{};
 const findings=[];
 if(!disk.readable||!disk.engaged||!now.active||!now.persisted||disk.revision!==now.revision)findings.push('DURABLE_LATCH_UNVERIFIED_FAIL_CLOSED');
 if(!old.persisted)findings.push('LEGACY_LATCH_UNVERIFIED_NON_AUTHORITATIVE');
 if(!storageHealthy)findings.push('STORAGE_UNHEALTHY');
 if(memoryMB>=450)findings.push('SHADOW_MEMORY_GATE_CLOSED');
 if(freshFeeds!==7)findings.push('MARKET_FEEDS_NOT_ALL_FRESH');
 if(!brokerBlocked)findings.push('BROKER_WRITE_BLOCK_NOT_CONFIRMED');
 const s=scenarios();
 return {version:'12.0.0',at:new Date().toISOString(),bootAt,brokerExecutionAllowed:false,mode:'READ_ONLY_VERIFICATION',memory:{rssMB:memoryMB,shadowGateOpen:memoryMB<450,headroomMB:512-memoryMB,warning:memoryMB>=430},storageHealthy,freshFeeds,authoritativeLatch:{engaged:disk.engaged,readable:disk.readable,revision:disk.revision,matchesInMemory:disk.revision===now.revision&&now.persisted===true},legacy:{engaged:old.active===true,persisted:old.persisted===true,authoritative:false},findings,scenarios:s,scenarioPassCount:s.filter(x=>x.passed).length,scenarioTotal:s.length,exampleRisk:[riskExample(7.7,12,.1,25),riskExample(7.7,12,1,25)],certifications:{igDealSize:false,gbpPerPip:false,stopUnitMapping:false,brokerLifecycle:false,crashRecovery:false,brokerKillSwitch:false},note:'Local model checks only; no broker writes, no certified GBP risk or broker-connected kill switch.'};
}
module.exports={riskExample,transition,scenarios,report};
