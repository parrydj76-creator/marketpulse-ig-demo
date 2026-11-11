'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validateTrade,audit,control,setControl}=require('./v85-integrity');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp-v85-'));
try{
 assert.equal(control(dir).paused,true);
 const bad={id:'bad',side:'SELL',entry:1.10915,exit:0,stop:1.11035,target:1.10735,units:2,pnlGBP:22183,exitReason:'TARGET',openedAt:'2026-11-11T15:15:19Z',exitAt:'2026-11-11T15:22:59Z'};
 assert.equal(validateTrade(bad).valid,false);
 const good={...bad,id:'good',exit:1.10735,pnlGBP:36};assert.equal(validateTrade(good).valid,true);
 assert.equal(audit(dir).validSimulatedPnlGBP,0);
 assert.equal(setControl(dir,false,'TEST').paused,false);
 assert.equal(control(dir).paused,false);
 assert.equal(setControl(dir,true,'TEST').paused,true);
 console.log('PASS: invalid exit quarantined; valid exit accepted; default persistent pause and resume work');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
