'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const target=path.resolve(process.argv[2]||'./v81-simulator.patched.js');
const {createV81}=require(target);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v81-safe-'));
let quote={bid:1.1092,ask:1.10929,ageMs:20,spreadPips:0.9},streamState='CONNECTED',signal={direction:'SELL',score:70};
const deps={requireAdmin:(_q,_r,n)=>n(),storageDir:dir,persistentStorage:true,v68:{status:()=>({streamState,quote})},v71:{status:()=>({signal})}};
try{
 let bot=createV81(deps);let st=bot.tick();assert.equal(st.position?.side,'SELL');const id=st.position.id;
 streamState='DISCONNECTED';quote={bid:0,ask:0,ageMs:0,spreadPips:0};st=bot.tick();assert.equal(st.position?.id,id,'invalid quote must not close existing paper position');assert.equal(st.closedTrades,0);
 streamState='CONNECTED';quote={bid:1.1104,ask:1.1105,ageMs:20,spreadPips:1};st=bot.tick();assert.equal(st.position,null,'valid ask beyond SELL stop should close paper position');assert.equal(st.closedTrades,1);assert.equal(st.latestClosed[0].exitReason,'STOP');
 bot=createV81(deps);assert.equal(bot.status().closedTrades,1,'restart must recover closed position');assert.equal(bot.status().journalHealthy,true);
 console.log('PASS v81 patch: no zero-price false exit; valid SELL stop; durable restart recovery');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
