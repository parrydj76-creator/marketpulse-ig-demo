'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const {createV83}=require('./v83-readiness');
const routes={};const app={get:(p,...f)=>routes[p]=f.at(-1),post:(p,...f)=>routes[p]=f.at(-1)};
const v=createV83({requireAdmin:(_q,_r,n)=>n(),persistentStorage:true,v81:{status:()=>({journalHealthy:true,scheduled:true,lastTickAt:new Date().toISOString(),closedTrades:0})},v82:{current:()=>({supervisorJournalHealthy:true,supervisorRecords:3,blockers:[]})},v68:{status:()=>({streamState:'CONNECTED',quote:{ageMs:50,delay:null,exchangeTimestampCertified:false}})},v71:{status:()=>({signal:{direction:'WAIT',score:0}})}});
v.routes(app);assert.equal(v.status().brokerOrderAllowed,false);assert.equal(v.status().integrations.v82,true);assert.equal(v.status().blockers.includes('FEED_DELAY_UNCERTIFIED'),true);
assert.equal(typeof routes['/api/v82/status'],'undefined');assert.equal(typeof routes['/api/v83/status'],'function');
const response={status(n){this.code=n;return this},json(d){this.body=d;return this}};routes['/api/v83/arm']({},response);assert.equal(response.code,409);assert.equal(response.body.brokerOrderAllowed,false);
const server=fs.readFileSync('server.v83.js','utf8');assert(server.indexOf('v82Supervisor.routes(app)')<server.indexOf("app.get('*'"));assert(server.indexOf('v83Readiness.routes(app)')<server.indexOf("app.get('*'"));
console.log('v83 mock integration and broker-lock tests passed');
