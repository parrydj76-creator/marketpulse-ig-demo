const test=require('node:test'),assert=require('node:assert/strict'),m=require('../marketpulse-v1500');
test('local scenarios',()=>assert.ok(m.tests().every(x=>x.passed)));
test('report never enables broker',()=>assert.equal(m.report({paper:{},safety:{},storage:{},broker:{records:[]}}).brokerOrdersAllowed,false));
