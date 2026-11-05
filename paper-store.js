'use strict';
const {Pool}=require('pg');
const crypto=require('crypto');

const pool=new Pool({
  connectionString:process.env.DATABASE_URL,
  max:3,
  connectionTimeoutMillis:10000
});

async function savePaperEvent(event){
  if(!event || !['OPEN','CLOSE','INTERRUPTED'].includes(event.kind)){
    throw Error('Invalid paper trading event');
  }

  if(event.kind==='INTERRUPTED'){
    if(
      typeof event.openEventId!=='string' ||
      !/^[a-f0-9]{64}$/.test(event.openEventId) ||
      typeof event.at!=='string' ||
      !Number.isFinite(Date.parse(event.at)) ||
      !['LONG','SHORT'].includes(event.direction) ||
      event.exit!=null ||
      event.pnlPips!=null
    ){
      throw Error('Invalid paper interruption record');
    }
  }

  const id=crypto.createHash('sha256')
    .update(
      event.kind==='INTERRUPTED'
        ? 'PAPER_INTERRUPTED:'+event.openEventId
        : JSON.stringify(event)
    )
    .digest('hex');

  const result=await pool.query(
    `INSERT INTO paper_trade_events
     (id,event_type,event_time,direction,entry_price,exit_price,pnl_pips,details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      event.kind,
      event.at,
      event.direction,
      event.entry??null,
      event.exit??null,
      event.pnlPips??null,
      JSON.stringify(event)
    ]
  );

  return {id,inserted:result.rowCount===1};
}

async function getPaperEvents(limit=1000){
  const result=await pool.query(
    'SELECT id, details FROM paper_trade_events ORDER BY event_time DESC, created_at DESC, id DESC LIMIT $1',
    [Math.min(10000,Math.max(1,limit))]
  );
  return result.rows.map(row=>({
    ...row.details,
    archiveEventId:row.id
  }));
}

module.exports={savePaperEvent,getPaperEvents};
