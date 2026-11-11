'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createV76,errorInfo,classify,riskPreview}=require('./v76-workbench');
(async()=>{
 assert.equal(errorInfo(Error('500: IG server failed')).httpStatus,500);
 assert.equal(classify({transactions:[]}).ok,true);
 assert.equal(classify({foo:1}).ok,false);
 assert.equal(riskPreview({quote:{},signal:{},positionsCount:0,accountCurrency:'GBP'}).brokerOrderAllowed,false);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp-v76-'));
 const deps={requireAdmin:(_q,_r,next)=>next(),storageDir:dir,persistentStorage:true,v68:{status:()=>({streamState:'CONNECTED',quote:{epic:'CS.D.EURUSD.MINI.IP',source:'LIGHTSTREAMER',ageMs:100,marketFlag:'DEAL',spreadPips:1,delay:null,exchangeTimestampCertified:false}})},v71:{status:()=>({signal:{direction:'WAIT',score:0,qualifiedBars:30}})},v74:{status:()=>({})},readPositions:async()=>[],readAccount:async()=>({currency:'GBP',accountType:'CFD'}),readMarket:async()=>({instrument:{epic:'CS.D.EURUSD.MINI.IP'},snapshot:{marketStatus:'TRADEABLE'}}),readTransactions:async()=>({transactions:[]})};
 const a=createV76(deps);const audit=await a.audit();assert.equal(audit.transactions.retrieved,true);assert.equal(audit.brokerOrderAllowed,false);assert.equal(audit.dailyLossLimitEnforceable,false);
 const sim=a.simulate();assert.equal(sim.brokerSubmitted,false);assert.equal(sim.simulatedCandidate,false);
 const b=createV76(deps);assert.equal(b.status().journalHealthy,true);assert.equal(b.status().records,2);
 fs.appendFileSync(path.join(dir,'v76-workbench.jsonl'),'BROKEN\n');const c=createV76(deps);assert.equal(c.status().journalHealthy,false);
 fs.rmSync(dir,{recursive:true,force:true});console.log('PASS: v76 error classification, fail-closed risk, audit, simulation, restart, corrupt journal');
})().catch(e=>{console.error(e);process.exitCode=1});
