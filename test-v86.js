'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createV81}=require('./v81-simulator');
const {createV86}=require('./v86-readiness');
const {audit}=require('./v85-integrity');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'marketpulse-v86-'));
const requireAdmin=(_q,_r,next)=>next();
let quote={bid:1.1095,ask:1.1096,ageMs:100,spreadPips:1};
const v68={status:()=>({streamState:'CONNECTED',quote})};
const v71={status:()=>({signal:{direction:'SELL',score:90}})};
try{
 const sim=createV81({requireAdmin,storageDir:dir,persistentStorage:true,v68,v71});
 assert.equal(sim.status().paused,true);
 assert.equal(sim.status().scheduled,false);
 assert.throws(()=>sim.tick(),/V85_PAPER_SAFETY_HOLD/);
 assert.equal(audit(dir).journalRecords,0);
 const v86=createV86({requireAdmin,storageDir:dir,persistentStorage:true,v81:sim,v68});
 assert.equal(v86.status().readyForUnattendedDemo,false);
 assert.equal(v86.status().checks.schedulerDisabled.passed,true);
 assert.equal(v86.status().checks.exchangeTimestampAndDelayCertified.passed,false);
 assert.equal(v86.status().brokerOrderAllowed,false);
 assert.equal(sim.status().journalEntries,0);
 const src=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
 assert.match(src,/v86Readiness\.routes\(app\)/);
 assert.doesNotMatch(src,/v81Simulator\.routes\(app\);v81Simulator\.start\(\)/);
 assert.match(src,/const BROKER_DEMO_EXECUTION=false/);
 console.log('PASS: fail-closed pause, no journal writes, no scheduler, broker hard-block, readiness and server wiring');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
