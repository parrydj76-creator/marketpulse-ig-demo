const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createV25}=require('../v25-autonomy');
function setup(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp25-'));return createV25({requireAdmin:(_a,_b,next)=>next(),signalSnapshot:()=>({}),dir})}
const quote=(bar,bid=1.1,ask=1.1001)=>({epic:'CS.D.EURUSD.CFD.IP',quoteSource:'STREAM',marketState:'DEAL',delayed:false,quoteAgeMs:100,bid,ask,direction:'LONG',score:80,bar});
test('defaults disarmed and broker blocked',()=>{const e=setup();assert.equal(e.status().state.paused,true);assert.equal(e.status().brokerOrderAllowed,false)});
test('opens one simulated position per bar and respects daily cap',()=>{const e=setup();e.start();e.tick(quote('a'));assert.equal(e.status().state.tradesToday,1);e.tick(quote('a'));assert.equal(e.status().state.tradesToday,1);assert.equal(e.status().state.position.direction,'LONG')});
test('rejects REST prices and stale data',()=>{const e=setup();e.start();e.tick({...quote('a'),quoteSource:'REST'});e.tick({...quote('b'),quoteAgeMs:20000});assert.equal(e.status().state.tradesToday,0)});
test('restart disarms persisted simulation',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp25-'));const opts={requireAdmin:(_a,_b,n)=>n(),signalSnapshot:()=>({}),dir};const e=createV25(opts);e.start();e.tick(quote('a'));const restarted=createV25(opts);assert.equal(restarted.status().state.paused,true);assert.ok(restarted.status().state.position)});
