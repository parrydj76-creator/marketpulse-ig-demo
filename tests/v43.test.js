'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createV43,assess,validate}=require('../v43-unattended');
function deps(){return {paper:{enabled:true,journal:{valid:true}},life:{lifecycle:{heartbeat:{healthy:true},feedVerified:true}},protocol:{journalHealthy:true,protocol:{unresolvedCount:0}},evidence:{journalHealthy:true,persistentStorageConfigured:true,lastObservation:{observedAt:new Date().toISOString(),observationHealthy:true,brokerPositionCount:0,unresolvedProtocolIntents:0}},observer:{observationHealthy:true,observationFresh:true}}}
function make(dir,d){return createV43({requireAdmin:()=>{},storageDir:dir,persistentStorage:true,v36Status:()=>d.paper,v39Status:()=>d.life,v40Status:()=>d.protocol,v41Status:()=>d.observer,v42Status:()=>d.evidence})}
test('eligible requires all read-only evidence',()=>assert.equal(assess(deps()).rehearsalEligible,true));
test('reject stale broker evidence',()=>{const d=deps();d.evidence.lastObservation.observedAt='2020-01-01T00:00:00Z';assert.ok(assess(d).blockers.includes('BROKER_EVIDENCE_STALE'))});
test('reject broker exposure',()=>{const d=deps();d.evidence.lastObservation.brokerPositionCount=1;assert.equal(assess(d).rehearsalEligible,false)});
test('reject unresolved intents',()=>{const d=deps();d.protocol.protocol.unresolvedCount=1;assert.equal(assess(d).rehearsalEligible,false)});
test('reject stale observer',()=>{const d=deps();d.observer.observationFresh=false;assert.equal(assess(d).rehearsalEligible,false)});
test('arm requires operator note and remains broker blocked',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v43-'));const x=make(dir,deps());assert.throws(()=>x.arm('short'));const s=x.arm('I authorise rehearsal only');assert.equal(s.armed,true);assert.equal(s.brokerOrderAllowed,false)});
test('cycle creates persisted safety tick',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v43-'));const x=make(dir,deps());x.arm('I authorise rehearsal only');assert.equal(x.cycle().action,'SIMULATED_CHECK_ONLY');assert.equal(x.status().journalEvents,2)});
test('auto-disarm when broker position appears',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v43-'));const d=deps(),x=make(dir,d);x.arm('I authorise rehearsal only');d.evidence.lastObservation.brokerPositionCount=1;assert.equal(x.cycle().action,'AUTO_DISARM');assert.equal(x.status().armed,false)});
test('restart restores evidence but never arm',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v43-'));const d=deps();make(dir,d).arm('I authorise rehearsal only');const y=make(dir,d);assert.equal(y.status().armed,false);assert.equal(y.status().journalEvents,1)});
test('journal tampering detected',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v43-'));make(dir,deps()).arm('I authorise rehearsal only');const file=path.join(dir,'v43-unattended-rehearsal.json');const rows=JSON.parse(fs.readFileSync(file));rows[0].event.note='tampered';fs.writeFileSync(file,JSON.stringify(rows));assert.equal(make(dir,deps()).status().journalHealthy,false)});
test('validate empty genesis',()=>assert.equal(validate([]),'GENESIS'));
