 'use strict';
// Read-only IG DEMO certification laboratory. No broker write methods or order routes.
const EPICS=['CS.D.EURUSD.CFD.IP','CS.D.GBPUSD.CFD.IP','CS.D.USDJPY.CFD.IP','CS.D.USDCHF.CFD.IP','CS.D.USDCAD.CFD.IP','CS.D.AUDUSD.CFD.IP','CS.D.NZDUSD.CFD.IP'];
const n=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
function instrumentAudit(epic,data){const i=data?.instrument||{},r=data?.dealingRules||{},s=data?.snapshot||{};
 const stop=r.minNormalStopOrLimitDistance||{},min=r.minDealSize||{},max=r.maxStopOrLimitDistance||{};
 const checks={epicMatches:i.epic===epic,contractSizePresent:n(i.contractSize)!==null,lotSizePresent:n(i.lotSize)!==null,pipValuePresent:!!i.valueOfOnePip,onePipMeansPresent:!!i.onePipMeans,stopRulePresent:n(stop.value)!==null,stopRuleUnitsKnown:['POINTS','PERCENTAGE'].includes(stop.unit),minimumDealSizePresent:n(min.value)!==null,priceDelayExplicitlyZero:n(s.delayTime)===0};
 const blockers=[];for(const [k,v] of Object.entries(checks))if(!v)blockers.push(k.toUpperCase()+'_UNVERIFIED');
 blockers.push('GBP_PER_PIP_NOT_CERTIFIED','BROKER_STOP_DISTANCE_CONVERSION_NOT_CERTIFIED');
 return {epic,instrument:{name:i.name||null,contractSize:i.contractSize||null,lotSize:n(i.lotSize),onePipMeans:i.onePipMeans||null,valueOfOnePip:i.valueOfOnePip||null,unit:i.unit||null,quoteCurrencies:(i.currencies||[]).map(c=>({code:c.code,exchangeRate:n(c.exchangeRate),isDefault:!!c.isDefault})).slice(0,5)},dealingRules:{minNormalStopOrLimitDistance:{value:n(stop.value),unit:stop.unit||null},maxStopOrLimitDistance:{value:n(max.value),unit:max.unit||null},minDealSize:{value:n(min.value),unit:min.unit||null},stopsLimitsAllowed:i.stopsLimitsAllowed??null},snapshot:{marketStatus:s.marketStatus||null,delayTime:n(s.delayTime)},checks,blockers,verifiedGBPPerPip:false};}
function lifecycleModel(){const scenarios=[
 ['duplicate_reference',['PENDING','TIMEOUT','RECONCILE','BLOCKED'],'BLOCKED'],
 ['timeout_after_submit',['PENDING','TIMEOUT','RECONCILE','BLOCKED'],'BLOCKED'],
 ['restart_unknown_position',['PENDING','RESTART','RECONCILE','BLOCKED'],'BLOCKED'],
 ['disk_failure',['READY','DISK_FAILURE','BLOCKED'],'BLOCKED'],
 ['kill_switch',['READY','KILL','BLOCKED'],'BLOCKED']];
 return scenarios.map(([name,events,expected])=>({name,events,expected,observed:events.at(-1),pass:events.at(-1)===expected,brokerTested:false}));}
function killSwitchModel(){const scenarios=[{name:'kill_prevents_new_orders',killed:true,request:'NEW_ENTRY',allowed:false},{name:'kill_does_not_claim_close',killed:true,request:'RECONCILE',allowed:true},{name:'default_is_blocked',killed:false,request:'BROKER_ORDER',allowed:false}];return {simulatedOnly:true,scenarios,passed:scenarios.every(x=>x.allowed=== (x.request==='RECONCILE')),brokerKillSwitchCertified:false};}
function createLab({readIG,getReadiness,getShadow}){let latest=null, busy=false;
 async function scan(){if(busy)throw Object.assign(new Error('Scan already running'),{status:409});busy=true;try{const markets=[];for(const epic of EPICS){try{const response=await readIG('/markets/'+encodeURIComponent(epic),'3');markets.push(instrumentAudit(epic,response));}catch(e){markets.push({epic,error:String(e.message||e).slice(0,160),blockers:['IG_MARKET_READ_FAILED'],verifiedGBPPerPip:false});}}
 latest={at:new Date().toISOString(),source:'IG_DEMO_REST_GET_MARKETS_V3',markets};return report();}finally{busy=false;}}
 function report(){const ready=getReadiness(),shadow=getShadow();return {version:'9.0.0',mode:'READ_ONLY_IG_DEMO_CERTIFICATION_LAB',at:new Date().toISOString(),scanInProgress:busy,lastScan:latest,feedStatus:{fresh:(ready.markets||[]).filter(m=>m.streamFresh).length,total:(ready.markets||[]).length},shadowJournal:shadow.restoreStatus||null,lifecycle:lifecycleModel(),killSwitch:killSwitchModel(),certification:{igMarketSpecificationsObserved:!!latest&&latest.markets.some(m=>!m.error),gbpPerPipCertified:false,stopUnitConversionCertified:false,brokerOrderLifecycleCertified:false,crashRecoveryCertified:false,killSwitchCertified:false,brokerOrdersAllowed:false},blockers:['GBP_PER_PIP_NOT_CERTIFIED','STOP_UNIT_CONVERSION_NOT_CERTIFIED','BROKER_LIFECYCLE_NOT_TESTED','BROKER_CRASH_RECOVERY_NOT_TESTED','KILL_SWITCH_NOT_BROKER_TESTED','BROKER_EXECUTION_HARD_BLOCKED'],warning:'Market specifications are read from IG DEMO on operator request. No actual GBP-per-pip, stop-unit conversion or broker lifecycle certification. No broker writes.'};}
 return {scan,report};}
module.exports={EPICS,instrumentAudit,lifecycleModel,killSwitchModel,createLab};
