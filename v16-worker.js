'use strict';
// Separate OS process; no broker modules or network calls except PostgreSQL.
const {Pool}=require('pg');
process.on('message',async msg=>{
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
 try{const r=await pool.query('INSERT INTO mp_v16_probes(id,worker_pid) VALUES($1,$2) ON CONFLICT(id) DO NOTHING RETURNING id',[msg.id,process.pid]);process.send?.({created:r.rowCount===1,pid:process.pid});}
 catch(e){process.send?.({error:e.message,pid:process.pid});}
 finally{await pool.end();process.exit(0)}
});
