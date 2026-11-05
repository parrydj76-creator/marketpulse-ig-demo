'use strict';
const STREAM_MAX_AGE_MS=20000;
function feedFresh(quote,now=Date.now()){
 return Boolean(quote&&quote.source==='STREAM'&&Number.isFinite(quote.at)&&now>=quote.at&&now-quote.at<STREAM_MAX_AGE_MS&&Number.isFinite(quote.bid)&&Number.isFinite(quote.ask)&&quote.bid>0&&quote.ask>quote.bid);
}
function summarizeFeed({quote,diagnostic,now=Date.now(),streamStatus,restState,restSnapshotError}={}){
 const ageSeconds=quote&&Number.isFinite(quote.at)?Math.max(0,Math.floor((now-quote.at)/1000)):null;
 const freshStream=feedFresh(quote,now);
 const accepted=Boolean(diagnostic?.subscribed);
 const updates=Number(diagnostic?.updates)||0;
 const validQuotes=Number(diagnostic?.validQuotes)||0;
 let reason='No price received';
 if(quote?.source==='REST')reason='REST snapshot only; not a live stream';
 else if(quote&&!freshStream)reason='Streaming quote stale or invalid';
 else if(freshStream)reason='Recent streaming quote received';
 else if(diagnostic?.errors?.length)reason='IG subscription rejected; inspect Render logs';
 else if(accepted&&updates===0)reason='Subscribed; waiting for first update';
 else if(updates>0&&validQuotes===0)reason='Updates received but no valid bid/ask pair';
 else if(streamStatus==='error')reason='Streaming connection error; inspect Render logs';
 return {freshStream,quoteSource:quote?.source||null,quoteAgeSeconds:ageSeconds,quoteLastReceivedAt:quote?.at?new Date(quote.at).toISOString():null,marketState:quote?.marketState||'UNKNOWN',delayStatus:quote?.delayed??null,subscriptionAccepted:accepted,subscriptionUpdates:updates,validStreamQuotes:validQuotes,lastSubscriptionEventAt:diagnostic?.lastEvent||null,subscriptionErrorCount:diagnostic?.errors?.length||0,restLastPoll:restState?.lastPoll||null,restHasError:Boolean(restState?.lastError||restSnapshotError),reason};
}
module.exports={feedFresh,summarizeFeed,STREAM_MAX_AGE_MS};
