const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');const m=require('../marketpulse-v300-lab');
const fx={bid:1.25,ask:1.26,delay:0,received:Date.now()};
test('indicative risk',()=>{const r=m.estimate({valueOfOnePip:10},'USD',fx,1,12,25);a.equal(r.indicativeRiskGBP,96);a.equal(r.executable,false)});
test('reject invalid size',()=>a.throws(()=>m.estimate({valueOfOnePip:10},'USD',fx,0,12,25)));
test('reject delayed quote',()=>a.throws(()=>m.estimate({valueOfOnePip:10},'USD',{...fx,delay:1},1,12,25)));
test('reject stale quote',()=>a.throws(()=>m.estimate({valueOfOnePip:10},'USD',{...fx,received:0},1,12,25)));
test('reject malformed positions',()=>a.throws(()=>m.normalize({positions:[{}]})));
test('snapshot differences',()=>a.equal(m.compare([{id:'a'}],[{id:'b'}]).disappeared.length,1));
test('durable snapshot across lab restart',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp30-'));try{const opts={dir,readIG:async()=>({positions:[]}),gate:()=>({brokerOrdersAllowed:false}),storage:()=>({configured:true,healthy:true})};const x=m.create(opts);a.equal((await x.snapshot()).readbackVerified,true);const y=m.create(opts);a.equal((await y.snapshot()).record.previousBoot,x.status().boot);a.equal(y.status().brokerOrdersAllowed,false)}finally{fs.rmSync(dir,{recursive:true,force:true})}});
