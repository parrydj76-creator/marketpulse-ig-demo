'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createV67}=require('./v67-autonomy');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp-v67-'));
const market={instrument:{epic:'CS.D.EURUSD.MINI.IP',contractSize:'10000',valueOfOnePip:'1.00'},snapshot:{bid:1.11536,offer:1.11542,marketStatus:'TRADEABLE',delayTime:0,updateTime:'16:16:03'}};
const make=(storageDir=dir,readMarket=async()=>market)=>createV67({requireAdmin:(_q,_r,next)=>next(),storageDir,persistentStorage:true,legacyBlocked:()=>true,readMarket,readBroker:async()=>({currency:'GBP',accountType:'CFD'}),readPositions:async()=>[],readPaper:()=>({entryArmed:false,monitorArmed:false,openPaperPositions:0})});
(async()=>{
 const app=make();assert.equal(app.state().brokerOrderAllowed,false);
 const q=app.quoteAssessment(market);assert.equal(q.spreadPips,0.6);assert(q.issues.includes('QUOTE_TIMESTAMP_NOT_VERIFIED'));
 const risk=app.riskPreview({size:0.1,stopPips:12,targetPips:18,usdPerPipPerSize:10,usdToGbp:0.75});assert.equal(risk.indicativeRiskWith25PercentBufferGBP,11.25);assert.equal(risk.gbpSizingCertified,false);
 const e=await app.evaluate({direction:'BUY',score:80,size:0.1,usdPerPipPerSize:10,usdToGbp:0.75});assert.equal(e.signalEligible,true);assert.equal(e.decision,'NO_BROKER_ORDER');assert(e.blockers.includes('UNATTENDED_EXECUTION_LOCKED'));
 for(const scenario of ['staleQuote','missingFX','duplicateIntent','unknownSubmission','restartWithOpenPosition','dailyLossLimit','journalCorruption']){const d=await app.drill({scenario});assert.equal(d.simulated,true);assert.equal(d.brokerRequests,0)}
 const count=app.state().journalRecords;assert.equal(make().state().journalRecords,count);
 const corrupt=fs.mkdtempSync(path.join(os.tmpdir(),'mp-v67-corrupt-'));fs.writeFileSync(path.join(corrupt,'v67-autonomy.jsonl'),'{"bad":true}\n');assert.equal(make(corrupt).state().journalHealthy,false);
 const failed=make(fs.mkdtempSync(path.join(os.tmpdir(),'mp-v67-fail-')),async()=>{throw Error('BROKER_DOWN')});const f=await failed.evaluate({direction:'BUY',score:75});assert(f.blockers.includes('MARKET_READ_FAILED'));assert.equal(f.brokerOrderAllowed,false);
 console.log('PASS: status, quote age, spread, indicative GBP risk, signal rehearsal, 7 fault scenarios, journal restart, journal corruption, broker read failure (16 checks).');
})().catch(e=>{console.error(e);process.exitCode=1});
