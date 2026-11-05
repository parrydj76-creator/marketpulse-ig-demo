'use strict';
const crypto=require('crypto');
const {interpret,alertKey}=require('./public/signal-view');
const WEB_PUSH_CONFIGURED=Boolean(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY&&process.env.PUSH_PAIRING_TOKEN&&process.env.DATABASE_URL);
function validSubscription(s){return s&&typeof s.endpoint==='string'&&s.endpoint.startsWith('https://')&&s.endpoint.length<2048&&s.keys&&typeof s.keys.p256dh==='string'&&s.keys.p256dh.length<512&&typeof s.keys.auth==='string'&&s.keys.auth.length<512}
function safeToken(a,b){if(!a||!b)return false;const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)}
function createPushAlerts(){
 let pool=null,webpush=null,ready=false,busy=false,lastError=null;
 async function init(){if(!WEB_PUSH_CONFIGURED){lastError='Set DATABASE_URL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and PUSH_PAIRING_TOKEN';return}
  try{webpush=require('web-push');webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@example.com',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
   pool=new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000});
   await pool.query('CREATE TABLE IF NOT EXISTS mp_push_subscriptions (endpoint_hash TEXT PRIMARY KEY, subscription JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
   await pool.query('CREATE TABLE IF NOT EXISTS mp_signal_events (signal_key TEXT PRIMARY KEY, direction TEXT NOT NULL, score INTEGER NOT NULL, bar_time TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
   ready=true;lastError=null;
  }catch(e){ready=false;lastError=e.message;console.error('Push setup unavailable:',e.message)}
 }
 const auth=(req,res,next)=>{if(!safeToken(req.get('X-Push-Pairing-Token'),process.env.PUSH_PAIRING_TOKEN))return res.status(403).json({error:'Invalid pairing token'});next()};
 function routes(app){
  app.get('/api/push/status',(_req,res)=>res.json({ready,configured:WEB_PUSH_CONFIGURED,requiresHomeScreen:true,error:ready?null:lastError}));
  app.get('/api/push/key',(_req,res)=>res.json({publicKey:ready?process.env.VAPID_PUBLIC_KEY:null}));
  app.post('/api/push/subscribe',auth,async(req,res)=>{if(!ready)return res.status(503).json({error:'Push service unavailable'});if(!validSubscription(req.body))return res.status(400).json({error:'Invalid subscription'});try{const hash=crypto.createHash('sha256').update(req.body.endpoint).digest('hex');await pool.query('INSERT INTO mp_push_subscriptions(endpoint_hash,subscription) VALUES($1,$2) ON CONFLICT(endpoint_hash) DO UPDATE SET subscription=excluded.subscription',[hash,JSON.stringify(req.body)]);res.json({ok:true})}catch(e){res.status(503).json({error:'Subscription storage unavailable'})}});
  app.post('/api/push/unsubscribe',auth,async(req,res)=>{if(!ready)return res.status(503).json({error:'Push service unavailable'});const endpoint=req.body?.endpoint;if(typeof endpoint!=='string')return res.status(400).json({error:'Endpoint required'});try{await pool.query('DELETE FROM mp_push_subscriptions WHERE endpoint_hash=$1',[crypto.createHash('sha256').update(endpoint).digest('hex')]);res.json({ok:true})}catch(e){res.status(503).json({error:'Storage unavailable'})}});
  app.get('/api/push/history',auth,async(_req,res)=>{if(!ready)return res.status(503).json({error:'Push service unavailable'});try{const x=await pool.query('SELECT direction,score,bar_time,created_at FROM mp_signal_events ORDER BY created_at DESC LIMIT 50');res.set('Cache-Control','no-store').json({events:x.rows})}catch(e){res.status(503).json({error:'History unavailable'})}});
 }
 async function tick(data){if(!ready||busy)return;busy=true;try{const view=interpret(data),key=alertKey(view);if(!key)return;
  const event=await pool.query('INSERT INTO mp_signal_events(signal_key,direction,score,bar_time) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING signal_key',[key,view.direction,view.score,view.barTime]);if(!event.rowCount)return;
  const subs=await pool.query('SELECT endpoint_hash,subscription FROM mp_push_subscriptions LIMIT 100');
  for(const sub of subs.rows){try{await webpush.sendNotification(sub.subscription,JSON.stringify({title:'MarketPulse AI · '+view.direction,body:'EUR/USD experimental signal · score '+view.score+' · not a trade instruction',url:'/'}),{TTL:180,urgency:'normal'})}catch(e){if(e.statusCode===404||e.statusCode===410)await pool.query('DELETE FROM mp_push_subscriptions WHERE endpoint_hash=$1',[sub.endpoint_hash]);else console.error('Push delivery failed:',e.statusCode||e.message)}}
 }catch(e){console.error('Push monitor error:',e.message)}finally{busy=false}}
 return {init,routes,tick};
}
module.exports={createPushAlerts,validSubscription,safeToken};
