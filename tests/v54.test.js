'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {allowIGRequest,validateProposal,EPIC}=require('../v54-safety');
test('only GET and login POST reach IG',()=>{assert.equal(allowIGRequest('GET','/positions'),true);assert.equal(allowIGRequest('POST','/session'),true);for(const m of ['POST','PUT','DELETE','PATCH'])assert.equal(allowIGRequest(m,'/positions/otc'),false)});
test('block legacy broker dealing paths',()=>{for(const p of ['/positions/otc','/workingorders/otc','/positions/otc/ABC'])assert.equal(allowIGRequest('POST',p),false)});
test('valid proposal is indicative only',()=>{const x=validateProposal({clientIntentId:'INTENT123',epic:EPIC,direction:'BUY',size:.1,stopPips:12,usdToGbp:.75,pipUsdPerFullSize:1});assert.equal(x.indicativeGBP,.9)});
test('reject non-mini and excessive risk',()=>{const x={clientIntentId:'INTENT123',epic:EPIC,direction:'BUY',size:5,stopPips:12,usdToGbp:.75,pipUsdPerFullSize:1};assert.throws(()=>validateProposal(x),/ABOVE_25/);assert.throws(()=>validateProposal({...x,epic:'OTHER'}),/MINI_EPIC/)});
