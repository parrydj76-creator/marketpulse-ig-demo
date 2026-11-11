'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createV81}=require('./v81-simulator');
const {setControl,audit}=require('./v85-integrity');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp85-int-'));
let feed='CONNECTED',bid=1.1094,ask=1.1095;
const v68={status:()=>({streamState:feed,quote:{bid,ask,ageMs:100,spreadPips:1}})};
const v71={status:()=>({signal:{direction:'SELL',score:70}})};
try{
 const sim=createV81({requireAdmin:(_q,_r,n)=>n(),storageDir:dir,persistentStorage:true,v68,v71});
 assert.equal(sim.status().paused,true);assert.throws(()=>sim.tick(),/V85_PAPER_SAFETY_HOLD/);
 assert.equal(sim.status().journalEntries,0);
 setControl(dir,false,'TEST_RESUME');sim.tick();assert.equal(sim.status().position.side,'SELL');
 feed='DISCONNECTED';bid=0;ask=0;sim.tick();assert.equal(sim.status().position.side,'SELL');assert.equal(sim.status().closedTrades,0);
 feed='CONNECTED';bid=1.1106;ask=1.1107;sim.tick();assert.equal(sim.status().position,null);assert.equal(sim.status().closedTrades,1);
 assert.equal(sim.status().latestClosed[0].exitReason,'STOP');assert.equal(audit(dir).quarantinedTrades,0);
 setControl(dir,true,'TEST_PAUSE');assert.throws(()=>sim.tick(),/V85_PAPER_SAFETY_HOLD/);
 const restarted=createV81({requireAdmin:(_q,_r,n)=>n(),storageDir:dir,persistentStorage:true,v68,v71});
 assert.equal(restarted.status().closedTrades,1);assert.equal(restarted.status().paused,true);
 console.log('PASS: default hold, no manual bypass, SELL entry, zero/disconnected quote ignored, valid stop, restart recovery');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
