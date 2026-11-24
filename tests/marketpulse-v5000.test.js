const {test}=require('node:test'),a=require('node:assert/strict'),m=require('../marketpulse-v5000');
test('contract arithmetic does not certify units',()=>{const r=m.compare({pipMeaning:'0.0001 USD/EUR',contractSize:100000,pipValue:10});a.equal(r.arithmeticMatch,true);a.equal(r.stopUnitsVerified,false)});
test('bounded pagination',async()=>{let n=0;const r=await m.history(async()=>({transactions:[{reference:'x'}],metadata:{pageData:{pageNumber:++n,totalPages:1}}}));a.equal(r.complete,true);a.equal(n,1)});
test('missing pagination metadata is not complete',async()=>a.equal((await m.history(async()=>({transactions:[]}))).complete,false));
test('isolated fault models',()=>a.ok(m.faultTests().every(x=>x.passed)));
