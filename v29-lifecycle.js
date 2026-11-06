'use strict';
// Verifies actual IG DEMO evidence from independently operator-executed tests.
// No broker write methods. A missing position alone cannot prove closure.
const crypto=require('crypto');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validRef=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{3,80}$/.test(x);
function assess({openConfirm,openPosition,closeConfirm,remainingPositions,expectedDealId}){
 const checks={openAccepted:openConfirm?.dealStatus==='ACCEPTED'&&Boolean(openConfirm.dealId),
  matchingOpenPosition:Boolean(openPosition?.position?.dealId&&openPosition.position.dealId===openConfirm?.dealId),
  attachedStopVerified:Number.isFinite(Number(openPosition?.position?.stopLevel))&&Number(openPosition.position.stopLevel)>0,
  closeAccepted:closeConfirm?.dealStatus==='ACCEPTED'&&closeConfirm?.dealId===expectedDealId,
  positionAbsentAfterClose:Array.isArray(remainingPositions)&&!remainingPositions.some(p=>p.position?.dealId===expectedDealId)};
 return {checks,pass:Object.values(checks).every(Boolean),note:'Evidence-based verification only; does not prove crash recovery or independent GBP sizing.'};
}
function createV29({requireAdmin,api,appendEvidence}){
 const sessions=new Map();
 async function getConfirm(ref){return api('/confirms/'+encodeURIComponent(ref));}
 async function getPositions(){const x=await api('/positions','GET',null,'2');if(!Array.isArray(x.positions))throw Error('IG positions unavailable');return x.positions;}
 function routes(app){
  app.get('/api/v29/status',requireAdmin,(_q,r)=>r.set('Cache-Control','no-store').json({version:'29.0.0',mode:'OPERATOR_EXECUTED_IG_DEMO_LIFECYCLE_VERIFICATION',brokerExecution:'HARD_BLOCKED',brokerOrderAllowed:false,readOnly:true,recordedSessions:sessions.size,warning:'Requires operator-executed IG DEMO open and close. This module cannot place orders or certify sizing/restart recovery.'}));
  app.post('/api/v29/lifecycle/open-evidence',requireAdmin,async(q,r)=>{
   const ref=q.body?.dealReference;
   if(!validRef(ref))return r.status(400).json({error:'Valid IG demo open dealReference required'});
   try{
    const confirm=await getConfirm(ref),positions=await getPositions();
    if(confirm.dealStatus!=='ACCEPTED'||!confirm.dealId)return r.status(409).json({error:'Open not confirmed as ACCEPTED with dealId'});
    const pos=positions.find(p=>p.position?.dealId===confirm.dealId);
    if(!pos)return r.status(409).json({error:'Accepted open deal not found in current positions; manual review required'});
    const sessionId=crypto.randomUUID();const record={openConfirm:confirm,openPosition:pos,expectedDealId:confirm.dealId,at:new Date().toISOString()};
    sessions.set(sessionId,record);
    const stopVerified=Number.isFinite(Number(pos.position?.stopLevel))&&Number(pos.position.stopLevel)>0;
    appendEvidence('V29_IG_DEMO_OPEN_OBSERVED',{sessionId,recordDigest:digest(record),stopVerified});
    r.set('Cache-Control','no-store').json({sessionId,openAccepted:true,matchingPosition:true,attachedStopVerified:stopVerified,dealId:confirm.dealId,note:'Open observation captured in process memory. Save session ID; restart loses session state.'});
   }catch(e){r.status(502).json({error:'IG read-only evidence request failed',detail:String(e.message).slice(0,180)})}
  });
  app.post('/api/v29/lifecycle/close-evidence',requireAdmin,async(q,r)=>{
   const {sessionId,dealReference}=q.body||{};
   if(typeof sessionId!=='string'||!sessions.has(sessionId)||!validRef(dealReference))return r.status(400).json({error:'Known sessionId and valid IG demo close dealReference required'});
   try{
    const s=sessions.get(sessionId),closeConfirm=await getConfirm(dealReference),remainingPositions=await getPositions();
    const result=assess({...s,closeConfirm,remainingPositions});
    appendEvidence('V29_IG_DEMO_LIFECYCLE_ASSESSED',{sessionId,pass:result.pass,checks:result.checks,evidenceDigest:digest({open:s.openConfirm,close:closeConfirm,positions:remainingPositions})});
    r.set('Cache-Control','no-store').status(result.pass?200:409).json({...result,brokerOrderAllowed:false,warning:'Independent monetary sizing and in-flight crash recovery remain unverified.'});
   }catch(e){r.status(502).json({error:'IG read-only evidence request failed',detail:String(e.message).slice(0,180)})}
  });
 }
 return {routes};
}
module.exports={createV29,assess};
