'use strict';
const assert=require('node:assert/strict');
const {createV193,riskCheck,historyURL,digest}=require('./v193-readiness');
(async()=>{
 assert.match(historyURL('2026-11-12','2026-11-13',1,100),/pageNumber=1/);
 assert.equal(riskCheck({}).brokerOrderAllowed,false);
 assert.equal(riskCheck({epic:'WRONG'}).withinEstimatedBudget,false);
 const records=[];
 const pool={query:async(sql,args=[])=>{
  if(sql.startsWith('INSERT INTO mp_v193_audit')){records.push({id:args[0],kind:args[1],payload:JSON.parse(args[2]),digest:args[3]});return {rows:[]};}
  if(sql.includes('SELECT payload,digest FROM mp_v193_audit WHERE'))return {rows:records.filter(r=>r.id===args[0])};
  if(sql.includes('SELECT id,kind,created_at,digest FROM mp_v193_audit'))return {rows:records};
  if(sql.includes('SELECT kind,count(*)'))return {rows:[]};
  if(sql.includes('SELECT id,payload,digest FROM mp_v193_audit'))return {rows:records};
  if(sql.includes('SELECT id,payload,digest FROM'))return {rows:[]};
  return {rows:[]};}};
 const calls=[];const readIG=async(url,v)=>{calls.push([url,v]);if(url.startsWith('/history/transactions?'))return {transactions:[]};if(url.startsWith('/markets/'))return {instrument:{epic:'CS.D.EURUSD.MINI.IP',contractSize:'10000'},snapshot:{updateTime:'10:31:04'}};if(url==='/positions')return {positions:[]};if(url==='/accounts')return {accounts:[{currency:'GBP'}]};throw Error('unexpected');};
 const x=createV193({pool,requireAdmin:()=>{},readIG});await x.init();const h=await x.history({from:'2026-11-12',to:'2026-11-13'});assert.equal(h.apiPaginationComplete,true);assert.equal(h.financialLedgerCertified,false);assert.equal(h.transactionCount,0);
 const snap=await x.snapshot();assert.equal(snap.complete,true);assert.equal(snap.brokerTimestampCertified,false);assert.equal(snap.checks.positions.miniPositionCount,0);
 assert.equal((await x.verify(h.id)).verified,true);assert.equal((await x.integrity()).verified,true);assert.equal((await x.report()).certificationsPassed,0);
 const routes={};x.routes({get:(p,...a)=>routes[p]=a.at(-1),post:(p,...a)=>routes[p]=a.at(-1)});let code=200;const response={status(n){code=n;return this;},json(o){this.body=o;return this;}};routes['/api/v193/order/submit']({},response);assert.equal(code,409);assert.equal(response.body.brokerOrderAllowed,false);
 assert.equal(digest({a:1,b:2}),digest({b:2,a:1}));
 console.log('v193: 13 assertions passed; mocked IG only, no live broker certification');
})().catch(e=>{console.error(e);process.exitCode=1});
