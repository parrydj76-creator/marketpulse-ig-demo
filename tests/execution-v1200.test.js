const {test}=require('node:test'),a=require('node:assert/strict'),f=require('../execution-v1200');const now=1795597476404;const q={source:'STREAM',marketState:'DEAL',bid:1.3,ask:1.31,at:now,sourceTimestamp:String(now),delayed:null};const m={delay:0,status:'TRADEABLE',at:now};
test('REST zero is not stream certification',()=>{const r=f.assess(q,m,now);a.equal(r.fresh,false);a.equal(r.restZero,true);a.equal(r.delayEvidence,'REST_ZERO_ONLY')});
test('explicit stream zero and timestamp accepted',()=>a.equal(f.assess({...q,delayed:'0'},m,now).fresh,true));
test('stale timestamp rejected',()=>a.equal(f.assess({...q,delayed:0,sourceTimestamp:String(now-16000)},m,now).fresh,false));
test('REST conflict rejected',()=>a.equal(f.assess({...q,delayed:0},{...m,delay:15},now).fresh,false));
test('missing timestamp rejected',()=>a.equal(f.assess({...q,delayed:0,sourceTimestamp:null},m,now).fresh,false));
test('stale REST cannot corroborate',()=>a.equal(f.assess(q,{...m,at:now-16000},now).restZero,false));
test('missing contract set blocks',()=>a.ok(f.blockers([],[],true).blockers.includes('CONTRACT_SET_INCOMPLETE')));
