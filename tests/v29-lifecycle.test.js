'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assess}=require('../v29-lifecycle');
const good={openConfirm:{dealStatus:'ACCEPTED',dealId:'D1'},openPosition:{position:{dealId:'D1',stopLevel:1.08}},closeConfirm:{dealStatus:'ACCEPTED',dealId:'D1'},expectedDealId:'D1',remainingPositions:[]};
test('accepts observed demo lifecycle evidence',()=>assert.equal(assess(good).pass,true));
test('rejects absent attached stop',()=>assert.equal(assess({...good,openPosition:{position:{dealId:'D1'}}}).pass,false));
test('rejects unconfirmed close',()=>assert.equal(assess({...good,closeConfirm:{dealStatus:'REJECTED',dealId:'D1'}}).pass,false));
test('rejects still-open position',()=>assert.equal(assess({...good,remainingPositions:[{position:{dealId:'D1'}}]}).pass,false));
