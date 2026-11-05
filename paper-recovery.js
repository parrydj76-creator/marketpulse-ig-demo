'use strict';

const {getPaperEvents}=require('./paper-store');

async function inspectPaperRecovery(){
  const events=await getPaperEvents(10000);
  const chronological=[...events].reverse();

  let open=null;
  let dailyOpens=0;
  let lastCloseAt=0;
  let realizedPips=0;

  const today=new Date().toISOString().slice(0,10);

  for(const event of chronological){
    if(!event || !['OPEN','CLOSE'].includes(event.kind)){
      continue;
    }

    const timestamp=Date.parse(event.at);
    if(!Number.isFinite(timestamp)){
      throw Error('Invalid archived event timestamp');
    }

    if(event.kind==='OPEN'){
      if(open){
        throw Error('Multiple unresolved paper OPEN events');
      }

      open=event;

      if(event.at.slice(0,10)===today){
        dailyOpens++;
      }
    }

    if(event.kind==='CLOSE'){
      if(!open){
        throw Error('Paper CLOSE without matching OPEN');
      }

      open=null;
      lastCloseAt=timestamp;
      realizedPips+=Number(event.pnlPips)||0;
    }
  }

  return {
    inspected:true,
    archivedEvents:events.length,
    day:today,
    dailyOpens,
    lastCloseAt,
    realizedPips:Number(realizedPips.toFixed(2)),
    unresolvedPosition:open,
    safeToResume:open===null,
    warning:open
      ? 'Unresolved archived paper position: manual review required'
      : null
  };
}

module.exports={inspectPaperRecovery};
