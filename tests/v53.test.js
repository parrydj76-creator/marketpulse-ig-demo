'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {amount,matchTransaction}=require('../v53-evidence');
test('parse GBP profit and loss',()=>{assert.equal(amount('£20.03'),20.03);assert.equal(amount('£-18.03'),-18.03);assert.equal(amount('garbage'),null)});
test('do not match by instrument text',()=>assert.equal(matchTransaction({instrumentName:'EUR/USD Mini'},'DEAL123','REF123').candidate,false));
test('exact reference yields provisional candidate only',()=>assert.deepEqual(matchTransaction({reference:'REF123'},null,'REF123'),{candidate:true,matchType:'EXACT_REFERENCE',certified:false}));
test('exact deal ID yields provisional candidate only',()=>assert.deepEqual(matchTransaction({dealId:'DEAL123'},'DEAL123',null),{candidate:true,matchType:'EXACT_DEAL_ID',certified:false}));
