'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createShadow80}=require('../marketpulse-v80-shadow');
const epic='CS.D.EURUSD.CFD.IP';
function setup(storageConfirmed=true){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp-v80-'));let state={memoryMB:390,persistenceHealthy:true,markets:[{epic,bid:1.1,ask:1.1001,lastBar:'2026-11-23T10:00:00.000Z',consecutive30:true,streamFresh:true,direction:'LONG',score:75}]};return {dir,state,make:()=>createShadow80({dataDir:dir,epics:[epic],storageConfirmed,getSnapshot:()=>state})};}
test('opens one shadow entry per bar and restores journal',()=>{const s=setup();const e=s.make();e.tick();e.tick();assert.equal(e.status().active.length,1);assert.equal(e.status().events.length,1);const restored=s.make();assert.equal(restored.status().restoreStatus,'RESTORED');assert.equal(restored.status().active.length,1);fs.rmSync(s.dir,{recursive:true,force:true});});
test('no shadow entries under memory pressure',()=>{const s=setup();s.state.memoryMB=465;const e=s.make();e.tick();assert.equal(e.status().active.length,0);fs.rmSync(s.dir,{recursive:true,force:true});});
test('no simulation without confirmed durable storage',()=>{const s=setup(false);const e=s.make();e.tick();assert.equal(e.status().enabled,false);assert.equal(e.status().active.length,0);fs.rmSync(s.dir,{recursive:true,force:true});});
test('invalid journal fails closed',()=>{const s=setup();fs.writeFileSync(path.join(s.dir,'v80-shadow-journal.json'),'{bad');const e=s.make();e.tick();assert.equal(e.status().healthy,false);assert.equal(e.status().restoreStatus,'FAILED');fs.rmSync(s.dir,{recursive:true,force:true});});
