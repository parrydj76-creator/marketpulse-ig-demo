 'use strict';
// IG DEMO read-only risk and broker-state inspection. No order write functions.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const EPICS=require('./marketpulse-v90-lab').EPICS;
const num=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
const round=(v,n=6)=>Number(v.toFixed(n));
function conversionToGBP(currency,fx){if(currency==='GBP')return {factor:1,route:'GBP',verified:false};
 if(currency==='USD'&&fx.GBPUSD&&fx.GBPUSD.bid>0&&fx.GBPUSD.offer>0)return {factor:round(1/fx.GBPUSD.bid,8),route:'USD→GBP using GBPUSD bid (conservative indicative)',verified:false};
 return {factor:null,route:'UNAVAILABLE',verified:false};}
function riskAudit(market,fx){const i=market?.instrument||{},r=market?.dealingRules||{};const epic=market.epic;const quote=epic?.split('.')[2]?.slice(3)||null;const pip=num(i.valueOfOnePip);const c=conversionToGBP(quote,fx);const assumedSize=1;const estimate=pip!==null&&c.factor!==null?round(pip*c.factor*assumedSize):null;
 const min=r.minNormalStopOrLimitDistance||{};const stopUnit=min.unit||null;
 return {epic,quoteCurrency:quote,brokerValueOfOnePip:pip,brokerOnePipMeans:i.onePipMeans||null,contractSize:i.contractSize||null,conversion:c,indicativeGBPPerPipAtSize1:estimate,minimumStop:{value:num(min.value),unit:stopUnit},pointToPipCertified:false,stopDistancePips:null,actualDealSizeUnitsCertified:false,gbpRiskCertified:false,blockers:[...(estimate===null?['GBP_CONVERSION_UNAVAILABLE']:[]),'BROKER_DEAL_SIZE_UNITS_UNVERIFIED','IG_POINT_TO_PIP_UNVERIFIED','GBP_RISK_NOT_CERTIFIED']};}
function positionSummary(data){if(!Array.isArray(data?.positions))throw Error('INVALID_IG_POSITIONS_RESPONSE');return {count:data.positions.length,positions:data.positions.slice(0,100).map(p=>({epic:p.market?.epic||p.position?.epic||null,dealId:p.position?.dealId||null,direction:p.position?.direction||null,size:num(p.position?.size),stopLevel:num(p.position?.stopLevel),limitLevel:num(p.position?.limitLevel),status:p.market?.marketStatus||null})),truncated:data.positions.length>100};}
function writeAtomic(filename,obj){const temp=filename+'.tmp-'+process.pid;fs.writeFileSync(temp,JSON.stringify(obj),{encoding:'utf8',mode:0o600,flag:'wx'});try{fs.renameSync(temp,filename)}finally{try{fs.unlinkSync(temp)}catch{}}}
function createLab({readIG,dataDir,getReadiness}){const filename=path.join(dataDir,'v91-operator-kill.json');let kill={active:true,at:null,reason:'DEFAULT_FAIL_CLOSED',revision:0},loadError=null;
 try{if(fs.existsSync(filename)){const v=JSON.parse(fs.readFileSync(filename,'utf8'));if(v&&v.active===true&&Number.isSafeInteger(v.revision))kill=v;else loadError='INVALID_KILL_STATE';}}catch(e){loadError='KILL_RESTORE_FAILED';}
 let latest=null,positions=null,busy=false;
 async function inspect(){if(busy)throw Object.assign(Error('Already inspecting'),{status:409});busy=true;try{
  const fx={};try{const x=await readIG('/markets/CS.D.GBPUSD.CFD.IP','3');fx.GBPUSD={bid:num(x.snapshot?.bid),offer:num(x.snapshot?.offer),delayTime:num(x.snapshot?.delayTime)};}catch(e){fx.error=String(e.message||e).slice(0,120)}
  const markets=[];for(const epic of EPICS){try{const raw=await readIG('/markets/'+encodeURIComponent(epic),'3');markets.push(riskAudit({...raw,epic},fx));}catch(e){markets.push({epic,error:String(e.message||e).slice(0,120),gbpRiskCertified:false})}}
  let brokerPositions;try{brokerPositions=positionSummary(await readIG('/positions','2'));positions={at:new Date().toISOString(),...brokerPositions};}catch(e){positions={at:new Date().toISOString(),error:String(e.message||e).slice(0,120),count:null}}
  latest={at:new Date().toISOString(),fx,markets};return report();
 }finally{busy=false}}
 function engage(reason){const next={active:true,at:new Date().toISOString(),reason:String(reason||'OPERATOR').slice(0,80),revision:kill.revision+1};try{writeAtomic(filename,next);kill=next;loadError=null;}catch(e){loadError='KILL_PERSIST_FAILED';kill={...next,reason:'KILL_PERSIST_FAILED'};}return report()}
 function report(){const r=getReadiness();return {version:'9.1.0',mode:'IG_DEMO_READ_ONLY_RISK_AND_RECONCILIATION',at:new Date().toISOString(),busy,lastInspection:latest,brokerPositions:positions,killSwitch:{...kill,persisted:!loadError&&fs.existsSync(filename),loadError,scope:'THIS_LAB_ONLY; broker execution is independently hard-blocked',brokerCertified:false,canDisarm:false},readiness:{fresh:(r.markets||[]).filter(x=>x.streamFresh).length,total:(r.markets||[]).length},certification:{gbpPerPipCertified:false,stopPointConversionCertified:false,brokerOrderLifecycleCertified:false,crashRecoveryCertified:false,brokerKillSwitchCertified:false,brokerOrdersAllowed:false},blockers:['GBP_RISK_UNCERTIFIED','STOP_POINT_TO_PIP_UNCERTIFIED','BROKER_ORDER_LIFECYCLE_UNTESTED','BROKER_CRASH_RECOVERY_UNTESTED','BROKER_KILL_SWITCH_UNTESTED','BROKER_EXECUTION_HARD_BLOCKED'],note:'GET-only IG DEMO inspection. Conversion estimates are indicative, not executable sizing. No order submission, cancellation, closing, or broker-connected kill-switch certification.'}}
 return {inspect,engage,report};}
module.exports={conversionToGBP,riskAudit,positionSummary,createLab};
