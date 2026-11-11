'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createV72,sizeScenario}=require('./v72-certification');
(async()=>{
 const s=sizeScenario({riskGBP:25,stopPips:12,gbpPerPipPerContract:1,minDealSize:0.1,dealSizeIncrement:0.1});
 assert.equal(s.roundedDealSize,2);assert.equal(s.stopOnlyRiskGBP,24);assert.equal(s.executionCertified,false);
 assert.equal(sizeScenario({riskGBP:26,stopPips:12,gbpPerPipPerContract:1,minDealSize:0.1,dealSizeIncrement:0.1}).eligible,false);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v72-'));
 const deps={requireAdmin:(_q,_r,next)=>next(),storageDir:dir,persistentStorage:true,v68:{status:()=>({streamState:'CONNECTED',quote:{epic:'CS.D.EURUSD.MINI.IP',source:'LIGHTSTREAMER',marketFlag:'DEAL',ageMs:10,spreadPips:0.7,delay:null}})},v69:{readiness:()=>({quoteDiagnostics:{igTimestampAgeMs:10}})},v71:{status:()=>({journalHealthy:true,quality:{signalEligible:true},signal:{qualifiedBars:30,direction:'BUY'}})},readPositions:async()=>[],readAccount:async()=>({currency:'GBP',accountType:'CFD'}),readMarket:async()=>({instrument:{epic:'CS.D.EURUSD.MINI.IP'}})};
 const a=createV72(deps),r=await a.audit();assert.equal(r.brokerPositions,0);assert.equal(r.unattendedOrderAllowed,false);assert.ok(r.blockers.includes('GBP_PIP_VALUE_NOT_INDEPENDENTLY_CERTIFIED'));assert.equal(a.status().journalHealthy,true);
 const b=createV72(deps);assert.equal(b.status().journalRecords,1);assert.equal(b.status().journalHealthy,true);
 fs.appendFileSync(path.join(dir,'v72-certification.jsonl'),'BROKEN\n');const c=createV72(deps);assert.equal(c.status().journalHealthy,false);
 let arm;const app={get(){},post(route,_auth,fn){if(route==='/api/v72/arm-unattended')arm=fn}};a.routes(app);let code,body;arm({}, {status(x){code=x;return this},json(x){body=x}});assert.equal(code,409);assert.equal(body.brokerOrderAllowed,false);
 fs.rmSync(dir,{recursive:true,force:true});console.log('v72 tests passed: sizing, risk ceiling, read-only audit, persistence, tamper detection, arming denied');
})().catch(e=>{console.error(e);process.exitCode=1});
