'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createV91,analyseMarket,analysePositions}=require('./v91-combined');
assert.equal(analyseMarket({instrument:{epic:'CS.D.EURUSD.MINI.IP'},dealingRules:{minDealSize:{value:1,unit:'POINTS'},minNormalStopOrLimitDistance:{value:5,unit:'POINTS'}}}).gbpPipValueCertified,false);
assert.throws(()=>analysePositions({positions:null}));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v91-'));
const responses={'/markets/CS.D.EURUSD.MINI.IP':{instrument:{epic:'CS.D.EURUSD.MINI.IP'},dealingRules:{}},'/positions':{positions:[]},'/accounts':{accounts:[{currency:'GBP'}]}};
const make=(paused=true)=>createV91({requireAdmin:(q,r,n)=>n(),storageDir:dir,readIG:async(url)=>{assert.ok(url in responses);return responses[url]},v86:{status:()=>({paperPaused:paused,blockers:['exchangeTimestampAndDelayCertified']})},v88:{status:()=>({ledgerHealthy:true})}});
(async()=>{let x=make();assert.equal(x.status().brokerOrderAllowed,false);const y=await x.capture();assert.equal(y.records,1);assert.equal(y.checks.positions.observation.total,0);assert.equal(make().status().records,1);await assert.rejects(()=>make(false).capture(),/PAPER_NOT_PAUSED/);const app={post(p,...a){this[p]=a.at(-1)},get(p,...a){this[p]=a.at(-1)}};x.routes(app);const res={status(c){this.code=c;return this},json(x){this.data=x;return this}};app['/api/v91/arm']({},res);assert.equal(res.code,409);fs.appendFileSync(path.join(dir,'v91-observations.jsonl'),'broken\n');assert.equal(make().status().ledgerHealthy,false);fs.rmSync(dir,{recursive:true,force:true});console.log('v91 read-only capture, recovery, pause, and arm-block tests passed')})().catch(e=>{console.error(e);process.exitCode=1});
