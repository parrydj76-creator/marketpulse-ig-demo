const {test}=require('node:test'),assert=require('node:assert/strict');const {create,summarize}=require('../marketpulse-v350-lab');
const p={id:'a',epic:'e',size:1,direction:'BUY',stop:null,limit:null};
test('empty restart',()=>assert.deepEqual(summarize([{boot:'a',rows:[]},{boot:'b',rows:[]}]).map(x=>[x.restart,x.retainedAcrossRestart]),[[true,0]]));
test('position retained',()=>assert.equal(summarize([{boot:'a',rows:[p]},{boot:'b',rows:[p]}])[0].retainedAcrossRestart,1));
test('position removed',()=>assert.equal(summarize([{boot:'a',rows:[p]},{boot:'a',rows:[]}])[0].removed,1));
test('reference validation',async()=>{const l=create({readIG:()=>{throw Error('unexpected')}});await assert.rejects(l.confirmation('../x'),/INVALID_REFERENCE/)});
test('confirmation mismatch',async()=>{const l=create({readIG:async()=>({dealReference:'other'})});await assert.rejects(l.confirmation('abc'),/REFERENCE_MISMATCH/)});
test('matching confirmation',async()=>{const l=create({readIG:async r=>r.startsWith('/confirms/')?{dealReference:'abc',dealId:'a',epic:'e',size:1,direction:'BUY'}:{positions:[{position:{dealId:'a',size:1,direction:'BUY'},market:{epic:'e'}}]}});const x=await l.confirmation('abc');assert.equal(x.positionMatch,true);assert.equal(x.certified,false)});
