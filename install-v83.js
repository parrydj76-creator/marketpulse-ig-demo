'use strict';
// Run locally against the exact server.js you intend to deploy. Does not modify it in place.
const fs=require('node:fs'),path=require('node:path');
const target=path.resolve(process.argv[2]||'server.js');
const output=path.resolve(process.argv[3]||'server.v83.js');
if(target===output)throw Error('Output must differ from input; backup required');
const source=fs.readFileSync(target,'utf8');
const anchor="app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));";
const v81='v81Simulator.routes(app);v81Simulator.start();';
if(!source.includes(anchor)||source.split(anchor).length!==2)throw Error('Expected unique catch-all route not found. Stop; manual review required.');
if(!source.includes(v81)||source.indexOf(v81)>source.indexOf(anchor))throw Error('Expected v81 baseline missing or misplaced. Stop; manual review required.');
if(source.includes("'/api/v83/status'")||source.includes('v83Readiness.routes(app)'))throw Error('v83 already installed; refusing duplicate installation');
const v82Present=source.includes('v82Supervisor.routes(app)');
if(v82Present&&source.indexOf('v82Supervisor.routes(app)')>source.indexOf(anchor))throw Error('Existing v82 route is after catch-all; review manually');
const v82Block=v82Present?'':`// V82 broker-write-free supervisor. Routes must precede catch-all.
const v82Supervisor=require('./v82-readiness').createV82({
 requireAdmin,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,
 v68:v68Controller,v71:v71Engine,v81:v81Simulator
});
v82Supervisor.routes(app);v82Supervisor.start();

`;
const block=`// V83 read-only integration diagnostics. No IG dealing callback.
const v83Readiness=require('./v83-readiness').createV83({
 requireAdmin,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,
 v68:v68Controller,v71:v71Engine,v81:v81Simulator,v82:v82Supervisor
});
v83Readiness.routes(app);

`;
const updated=source.replace(anchor,v82Block+block+anchor);
if(updated===source||!updated.includes('v83Readiness.routes(app)'))throw Error('Integration failed');
fs.writeFileSync(output,updated,{flag:'wx'});
console.log('Created '+output+'; review diff and deploy as server.js only after validation.');
