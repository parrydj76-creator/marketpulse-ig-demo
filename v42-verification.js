'use strict';
// Read-only broker verification workbench. Does not import IG order submission functions.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EPIC='CS.D.EURUSD.CFD.IP';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function verify(rows){if(!Array.isArray(rows))throw Error('EVIDENCE_NOT_ARRAY');let head='GENESIS';const ids=new Set();for(const row of rows){if(!row||row.previous!==head||row.digest!==hash({previous:row.previous,event:row.event}))throw Error('EVIDENCE_CHAIN_INVALID');if(!row.event||typeof row.event.id!=='string'||ids.has(row.event.id))throw Error('EVIDENCE_EVENT_INVALID');ids.add(row.event.id);head=row.digest}return head}
function riskPreview(x={}){const reasons=[];const {size,stopPips,pipValueGBP,minimumSize,stepSize,conversionVerified,contractVerified,quoteAgeMs}=x;
 if(!finite(size)||size<=0||!finite(stopPips)||stopPips<=0)reasons.push('INVALID_SIZE_OR_STOP');
 if(!finite(pipValueGBP)||pipValueGBP<=0||conversionVerified!==true||contractVerified!==true)reasons.push('CONTRACT_OR_GBP_PIP_VALUE_UNVERIFIED');
 if(!finite(minimumSize)||minimumSize<=0||!finite(stepSize)||stepSize<=0)reasons.push('DEAL_SIZE_RULES_UNVERIFIED');
 if(!finite(quoteAgeMs)||quoteAgeMs<0||quoteAgeMs>10000)reasons.push('QUOTE_STALE_OR_UNVERIFIED');
 if(!reasons.length){if(size<minimumSize||Math.abs((size-minimumSize)/stepSize-Math.round((size-minimumSize)/stepSize))>1e-7)reasons.push('SIZE_INCREMENT_INVALID');if(size*stopPips*pipValueGBP>25)reasons.push('EXCEEDS_25_GBP_LIMIT')}
 const risk=finite(size)&&finite(stopPips)&&finite(pipValueGBP)?Number((size*stopPips*pipValueGBP).toFixed(2)):null;
 return {illustrativeRiskGBP:risk,eligibleForOperatorReview:reasons.length===0,reasons,certified:false,brokerOrderAllowed:false,warning:'Inputs are operator supplied. Passing preview is NOT independent broker certification. Spreads, slippage and fees can increase loss.'};}
function reconcile({broker,protocol,paper,at,now=Date.now()}){
 const issues=[];const positions=broker?.positions;
 if(!Array.isArray(positions))issues.push('BROKER_POSITIONS_MISSING');
 const active=Array.isArray(positions)?positions.filter(p=>p&&p.position&&p.market):[];
 if(active.length)issues.push('BROKER_EXPOSURE_REQUIRES_OPERATOR_REVIEW');
 if(!broker?.account||typeof broker.account.accountId!=='string')issues.push('ACCOUNT_UNVERIFIED');
 if(!finite(at)||at>now+5000||now-at>60000)issues.push('OBSERVATION_STALE');
 if(protocol?.protocol?.unresolvedCount!==0)issues.push('UNRESOLVED_PROTOCOL_INTENT');
 if(protocol?.journalHealthy!==true)issues.push('PROTOCOL_JOURNAL_UNHEALTHY');
 if(paper?.journal?.valid!==true)issues.push('PAPER_JOURNAL_UNHEALTHY');
 const matching=active.filter(p=>p.market.epic===EPIC);
 return {observedAt:new Date(at).toISOString(),brokerPositionCount:active.length,eurusdBrokerPositionCount:matching.length,brokerDealIds:active.map(p=>String(p.position.dealId||'').slice(0,80)),paperPositionPresent:!!paper?.openPosition,paperIsNotBrokerPosition:true,unresolvedProtocolIntents:protocol?.protocol?.unresolvedCount??null,issues,observationHealthy:issues.length===0,brokerOrderAllowed:false};}
function createV42({requireAdmin,storageDir,persistentStorage,readBroker,v36Status,v40Status}){
 const file=path.join(storageDir,'v42-evidence.json');let rows=[],healthy=true,error=null,busy=false,lastAttempt=0;
 try{if(fs.existsSync(file)){rows=JSON.parse(fs.readFileSync(file,'utf8'));verify(rows)}}catch(e){healthy=false;error=e.message}
 function append(event){if(!healthy||!persistentStorage)throw Error('PERSISTENT_EVIDENCE_REQUIRED');const previous=rows.at(-1)?.digest||'GENESIS';const next=[...rows,{previous,event,digest:hash({previous,event})}];const tmp=file+'.tmp';try{fs.mkdirSync(storageDir,{recursive:true});const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const dir=fs.openSync(storageDir,'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}verify(next);rows=next}catch(e){healthy=false;error=e.message;throw e}}
 function status(){return {version:'42.0.0',mode:'IG_DEMO_READ_ONLY_VERIFICATION_WORKBENCH',journalHealthy:healthy,persistentStorageConfigured:!!persistentStorage,evidenceEvents:rows.length,evidenceHead:healthy?verify(rows):null,lastObservation:rows.at(-1)?.event?.observation||null,refreshInProgress:busy,error,certifications:{gbpSizing:false,brokerLifecycle:false,crashRecovery:false},readyForUnattendedDemo:false,brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,warning:'Evidence and risk previews are not broker certification. No IG order writes.'}}
 async function observe(){if(busy)throw Error('OBSERVATION_IN_PROGRESS');if(Date.now()-lastAttempt<10000)throw Error('OBSERVATION_RATE_LIMIT_10_SECONDS');if(!healthy||!persistentStorage)throw Error('PERSISTENT_EVIDENCE_REQUIRED');busy=true;lastAttempt=Date.now();try{const broker=await readBroker();const observation=reconcile({broker,protocol:v40Status(),paper:v36Status(),at:Date.now()});append({id:crypto.randomUUID(),kind:'BROKER_OBSERVATION',at:new Date().toISOString(),observation});return {...observation,evidenceHead:verify(rows),brokerOrderAllowed:false}}finally{busy=false}}
 function evidence(){return rows.map((r,i)=>({index:i+1,at:r.event.at,kind:r.event.kind,digest:r.digest,observation:r.event.observation}))}
 function routes(app){const fail=(r,e)=>r.status(409).set('Cache-Control','no-store').json({error:String(e.message||e).slice(0,160),brokerOrderAllowed:false});app.get('/api/v42/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json(status()));app.get('/api/v42/evidence',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({evidence:evidence(),brokerOrderAllowed:false}));app.post('/api/v42/observe',requireAdmin,async(_q,r)=>{try{r.set('Cache-Control','no-store').json(await observe())}catch(e){fail(r,e)}});app.post('/api/v42/risk-preview',requireAdmin,(q,r)=>r.set('Cache-Control','no-store').json(riskPreview(q.body||{})));app.get('/v42',requireAdmin,(_q,r)=>r.sendFile(path.join(__dirname,'public','v42.html')))}
 return {routes,status,observe,evidence};
}
module.exports={createV42,verify,riskPreview,reconcile};
