'use strict';
// Idempotent-ish guarded installer: never edits original file. Always review generated diff.
const fs=require('node:fs'),path=require('node:path');
const input=path.resolve(process.argv[2]||'server.js'),output=path.resolve(process.argv[3]||'server.v84.js');
if(input===output)throw Error('Output must differ from input');
let src=fs.readFileSync(input,'utf8');
const anchor="app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));";
if(src.split(anchor).length!==2)throw Error('Expected unique catch-all not found');
for(const marker of ['v81Simulator.routes(app)','v82Supervisor.routes(app)','v83Readiness.routes(app)'])if(!src.includes(marker)||src.indexOf(marker)>src.indexOf(anchor))throw Error('Missing or misplaced '+marker);
if(src.includes('v84Guardian.routes(app)'))throw Error('v84 already installed');
const block=`// V84 read-only guardian: no IG broker dealing callback.\nconst v84Guardian=require('./v84-guardian').createV84({\n requireAdmin,storageDir:DATA_DIR,persistentStorage:PERSISTENT_STORAGE,\n v81:v81Simulator,v82:v82Supervisor,v68:v68Controller,v71:v71Engine\n});\nv84Guardian.routes(app);v84Guardian.start();\n\n`;
src=src.replace(anchor,block+anchor);
fs.writeFileSync(output,src,{flag:'wx'});
console.log('Generated '+output+'; REVIEW DIFF, then commit as server.js.');
