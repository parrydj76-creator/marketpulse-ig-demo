'use strict';
// Fail-closed installer: never overwrites active files, refuses unknown layouts.
const fs=require('node:fs'),path=require('node:path');
const srcServer=path.resolve(process.argv[2]||'server.js');
const srcSim=path.resolve(process.argv[3]||'v81-simulator.js');
const outServer=path.resolve(process.argv[4]||'server.v85.js');
const outSim=path.resolve(process.argv[5]||'v81-simulator.v85.js');
if(new Set([srcServer,srcSim,outServer,outSim]).size!==4)throw Error('Source and destination files must be distinct');
if(fs.existsSync(outServer)||fs.existsSync(outSim))throw Error('Output exists; refusing overwrite');
let s=fs.readFileSync(srcSim,'utf8'),server=fs.readFileSync(srcServer,'utf8');
function once(source,old,replacement,label){if(source.split(old).length!==2)throw Error('Unexpected source layout for '+label+'; no output written');return source.replace(old,replacement)}
if(s.includes("require('./v85-integrity')"))throw Error('v81 already patched');
if(!s.includes("function createV81({requireAdmin,storageDir,persistentStorage,v68,v71})"))throw Error('Unknown simulator version');
const oldExit='if(next.position&&Number.isFinite(q.bid)&&Number.isFinite(q.ask)){';
const safeExit="if(next.position&&Number.isFinite(q.bid)&&Number.isFinite(q.ask)&&q.bid>0.5&&q.bid<2&&q.ask>q.bid&&q.ask<2&&!d.reasons.some(r=>['FEED_DISCONNECTED','INVALID_QUOTE','STALE_QUOTE','SPREAD_LIMIT'].includes(r))){";
const patchedExit="if(next.position&&Number.isFinite(q.bid)&&Number.isFinite(q.ask)&&q.bid>0&&q.ask>q.bid&&!d.reasons.some(r=>['FEED_DISCONNECTED','INVALID_QUOTE','STALE_QUOTE','SPREAD_LIMIT'].includes(r))){";
if(s.includes(oldExit))s=once(s,oldExit,safeExit,'unpatched exit guard');
else s=once(s,patchedExit,safeExit,'v84 exit guard');
const oldDaily="const day=ukDay(now),closed=state.closed.filter(t=>t.ukDay===day),realised=closed.reduce((s,t)=>s+t.pnlGBP,0),trades=closed.length+(state.position?.ukDay===day?1:0);";
const patchedDaily="const day=ukDay(now),closed=state.closed.filter(t=>t.ukDay===day),realised=closed.reduce((s,t)=>s+t.pnlGBP,0),trades=state.closed.filter(t=>(t.openedAt&&ukDay(new Date(t.openedAt))===day)||(!t.openedAt&&t.ukDay===day)).length+(state.position?.ukDay===day?1:0);";
if(s.includes(oldDaily))s=once(s,oldDaily,patchedDaily,'daily count');
else if(!s.includes(patchedDaily))throw Error('Unknown daily count logic');
s=once(s,"const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');","const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');\nconst v85Integrity=require('./v85-integrity');",'module imports');
s=once(s,' function tick(now=new Date()){'," function tick(now=new Date()){\n  if(v85Integrity.control(storageDir).paused)throw Error('V85_PAPER_SAFETY_HOLD');",'tick gate');
s=once(s,'const bid=Number(q.bid),ask=Number(q.ask),spread=Number(q.spreadPips),age=Number(q.ageMs)', 'const bid=Number(q.bid),ask=Number(q.ask),spread=Number(q.spreadPips),age=Number(q.ageMs)', 'quote anchor');
s=once(s,'bid<=0||ask<=bid','bid<=0.5||bid>=2||ask<=bid||ask>=2','quote sanity');
s=once(s,'const day=ukDay(now),closed=state.closed.filter(t=>t.ukDay===day),realised=closed.reduce((s,t)=>s+t.pnlGBP,0),trades=', 'const day=ukDay(now),closed=state.closed.filter(t=>t.ukDay===day&&v85Integrity.validateTrade(t).valid),realised=closed.reduce((s,t)=>s+t.pnlGBP,0),trades=', 'quarantine daily pnl');
// Correct the user-facing v81 status to avoid presenting invalid historical P&L as valid.
s=once(s," function status(){return {version:'81.0.0'", " function status(){const integrity=v85Integrity.audit(storageDir);return {version:'81.0.0'", 'status signature');
s=once(s,'journalEntries:entries.length,scheduled:!!timer,','journalEntries:entries.length,scheduled:!!timer,paused:v85Integrity.control(storageDir).paused,integrity:{validTrades:integrity.validTrades,quarantinedTrades:integrity.quarantinedTrades,validSimulatedPnlGBP:integrity.validSimulatedPnlGBP},','status integrity');
s=once(s,"function start(){if(timer)return;timer=setInterval", "function start(){if(timer)return;timer=setInterval",'scheduler anchor');
// Existing timer may run, but no ticks may change the journal while persistent pause is active.
if(!server.includes("v84Guardian")&&!server.includes('v84-guardian'))throw Error('v84 server integration missing');
server=once(server,"require('./v81-simulator').createV81", "require('./v81-simulator').createV81",'simulator server anchor');
if(server.includes("require('./v85-integrity')"))throw Error('v85 already integrated');
const catchall="app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));";
const integration="// V85 paper-only integrity audit and persistent safety hold. No IG dealing callback.\nconst v85IntegrityController=require('./v85-integrity').createV85({requireAdmin,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,v81:v81Simulator,v68:v68Controller});\nv85IntegrityController.routes(app);\n\n";
server=once(server,catchall,integration+catchall,'catch-all placement');
// Default persistent pause is enforced in v81 tick itself, including manual endpoint.
fs.writeFileSync(outSim,s,{flag:'wx'});
try{fs.writeFileSync(outServer,server,{flag:'wx'})}catch(e){fs.unlinkSync(outSim);throw e}
console.log('Created '+outSim+' and '+outServer+'; no active source files modified.');
