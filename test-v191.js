'use strict';
const assert=require('node:assert/strict');
const {createV190}=require('./v190-broker-evidence');
(async()=>{
 const calls=[],saved=[];
 const readIG=async(route,version)=>{
  calls.push([route,version]);
  if(route.startsWith('/history/transactions?'))throw Error('404: upstream HTML');
  if(route.startsWith('/markets/'))return {instrument:{epic:'CS.D.EURUSD.MINI.IP'},dealingRules:{},snapshot:{}};
  if(route==='/positions')return {positions:[]};
  if(route==='/accounts')return {accounts:[]};
  throw Error('Unexpected route');
 };
 const pool={query:async(sql,args)=>{if(sql.startsWith('INSERT'))saved.push(JSON.parse(args[3]));return {rows:[]}}};
 const v=createV190({requireAdmin:(q,r,n)=>n(),pool,readIG});
 assert.equal(v.status().brokerOrderAllowed,false);
 assert.equal(v.status().version,'191.0.0');
 const r=await v.collect();
 assert.equal(r.collected,true);assert.equal(r.partial,true);assert.equal(r.checks.transactions.code,'404');
 assert.equal(r.coreComplete,true);assert.equal(r.historyComplete,false);assert.equal(saved.length,1);
 assert.equal(saved[0].historyAvailable,false);assert.equal(saved[0].historyComplete,false);
 assert.match(calls[3][0],/^\/history\/transactions\?type=ALL&from=/);
 assert.equal(calls[3][1],'2');
 console.log('v191 partial-collection and history-path assertions passed');
})().catch(e=>{console.error(e);process.exitCode=1});
