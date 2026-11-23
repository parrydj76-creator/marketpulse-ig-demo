 'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readJournal,tradeLedger,stressTest,createWorkbench}=require('../marketpulse-v84-workbench');
test('risk formula synthetic cases pass',()=>assert.ok(stressTest().every(x=>x.passed)));
test('pairs open and close retained events',()=>{const a=tradeLedger([{kind:'CLOSED',epic:'EUR',at:'2026-01-01T00:02:00Z',pnlPips:2,reason:'SIM_TARGET'},{kind:'OPENED',epic:'EUR',at:'2026-01-01T00:00:00Z',direction:'SHORT',score:72,entry:1.2}]);assert.equal(a.rows.length,1);assert.equal(a.rows[0].netSimulatedPips,2)});
test('journal read fails closed when missing',()=>assert.equal(readJournal('/nonexistent/v80-shadow-journal.json').ok,false));
test('report keeps broker execution disabled',()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'mp84-'));try{const r=createWorkbench({dataDir:d,getShadow:()=>({active:[],restoreStatus:'NEW'}),getReadiness:()=>({markets:[]}),getMemory:()=>433,getStorage:()=>({configured:true,healthy:true})}).report();assert.equal(r.certifications.brokerOrdersAllowed,false);assert.ok(r.blockers.includes('BROKER_EXECUTION_HARD_BLOCKED'));}finally{fs.rmSync(d,{recursive:true,force:true})}});
