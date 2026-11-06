'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {discover,classify}=require('../v31-readiness');
test('matches position identifier in transactions',()=>{assert.equal(classify({reference:'S7PAP8BB'},'S7PAP8BB').match,true)});
test('does not treat position absence as lifecycle verification',async()=>{const api=async url=>url.startsWith('/positions')?{positions:[]}:{transactions:[{reference:'S7PAP8BB'}]};const r=await discover({api,dealId:'S7PAP8BB',from:'2026-11-01',to:'2026-11-06'});assert.equal(r.checks.historicalMatchFound,true);assert.equal(r.lifecycleVerified,false);assert.equal(r.brokerOrderAllowed,false)});
test('paginates full pages and stops at short page',async()=>{let n=0;const api=async url=>url.startsWith('/positions')?{positions:[]}:{transactions:++n===1?Array.from({length:100},()=>({reference:'other'})):[{reference:'S7PAP8BB'}]};const r=await discover({api,dealId:'S7PAP8BB',from:'2026-11-01',to:'2026-11-06'});assert.equal(r.pagesScanned,2);assert.equal(r.transactionsScanned,101);assert.equal(r.searchComplete,true)});
test('enforces pagination cap',async()=>{const api=async url=>url.startsWith('/positions')?{positions:[]}:{transactions:Array.from({length:100},()=>({reference:'other'}))};const r=await discover({api,dealId:'S7PAP8BB',from:'2026-11-01',to:'2026-11-06',maxPages:999});assert.equal(r.pagesScanned,10);assert.equal(r.searchComplete,false)});
test('rejects invalid deal ID',async()=>{await assert.rejects(()=>discover({api:async()=>{},dealId:'bad id'}),/Invalid/)});
