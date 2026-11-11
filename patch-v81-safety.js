'use strict';
// Targeted v81 source patch; outputs new file and refuses unexpected source layouts.
const fs=require('node:fs'),path=require('node:path');
const input=path.resolve(process.argv[2]||'v81-simulator.js'),output=path.resolve(process.argv[3]||'v81-simulator.patched.js');
if(input===output)throw Error('Input and output must differ');
let s=fs.readFileSync(input,'utf8');
const before='if(next.position&&Number.isFinite(q.bid)&&Number.isFinite(q.ask)){';
const after="if(next.position&&Number.isFinite(q.bid)&&Number.isFinite(q.ask)&&q.bid>0&&q.ask>q.bid&&!d.reasons.some(r=>['FEED_DISCONNECTED','INVALID_QUOTE','STALE_QUOTE','SPREAD_LIMIT'].includes(r))){";
if(s.split(before).length!==2)throw Error('Expected unique v81 exit guard not found; refuse patch');
s=s.replace(before,after);
// Correct the paper daily entry cap: count openedAt/ukDay, not only exit date.
const old="const day=ukDay(now),closed=state.closed.filter(t=>t.ukDay===day),realised=closed.reduce((s,t)=>s+t.pnlGBP,0),trades=closed.length+(state.position?.ukDay===day?1:0);";
const replacement="const day=ukDay(now),closed=state.closed.filter(t=>t.ukDay===day),realised=closed.reduce((s,t)=>s+t.pnlGBP,0),trades=state.closed.filter(t=>(t.openedAt&&ukDay(new Date(t.openedAt))===day)||(!t.openedAt&&t.ukDay===day)).length+(state.position?.ukDay===day?1:0);";
if(s.split(old).length!==2)throw Error('Expected unique v81 daily-count line not found; refuse patch');
s=s.replace(old,replacement);
fs.writeFileSync(output,s,{flag:'wx'});
console.log('Created '+output+'; run test-v81-safety.js and inspect diff before replacing original in GitHub');
