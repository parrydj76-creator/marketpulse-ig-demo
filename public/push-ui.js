'use strict';
(()=>{
 const $=id=>document.getElementById(id);const status=$('pushstatus');
 const key=()=> $('pairing').value.trim();
 const auth=()=>({'Content-Type':'application/json','X-Push-Pairing-Token':key()});
 const base64ToBytes=s=>{const padded=s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=');return Uint8Array.from(atob(padded),c=>c.charCodeAt(0))};
 async function request(url,options){const r=await fetch(url,{cache:'no-store',...options});const d=await r.json();if(!r.ok)throw Error(d.error||'HTTP '+r.status);return d}
 $('pushon').addEventListener('click',async()=>{try{
  if(!key())throw Error('Enter your push pairing token');
  if(!('serviceWorker' in navigator)||!('PushManager' in window))throw Error('Push unavailable. On iPhone, open the installed Home Screen app (iOS 16.4+).');
  const info=await request('/api/push/key');if(!info.publicKey)throw Error('Push server not configured');
  const reg=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;
  if(Notification.permission!=='granted'){const result=await Notification.requestPermission();if(result!=='granted')throw Error('Notification permission denied')}
  const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64ToBytes(info.publicKey)});
  try{await request('/api/push/subscribe',{method:'POST',headers:auth(),body:JSON.stringify(sub)})}catch(e){await sub.unsubscribe();throw e}
  status.textContent='Background push subscription saved. Delivery awaits a new qualifying signal.';
 }catch(e){status.textContent='Push setup: '+e.message}});
 $('pushoff').addEventListener('click',async()=>{try{if(!key())throw Error('Enter your push pairing token');const reg=await navigator.serviceWorker.getRegistration('/sw.js');const sub=await reg?.pushManager.getSubscription();if(sub){await request('/api/push/unsubscribe',{method:'POST',headers:auth(),body:JSON.stringify({endpoint:sub.endpoint})});await sub.unsubscribe()}status.textContent='Push disabled on this device.'}catch(e){status.textContent='Push disable: '+e.message}});
 $('showhistory').addEventListener('click',async()=>{try{if(!key())throw Error('Enter your push pairing token');const d=await request('/api/push/history',{headers:auth()});const target=$('signalhistory');target.replaceChildren();if(!d.events.length){target.textContent='No qualifying signals recorded yet.';return}for(const e of d.events){const p=document.createElement('p');p.textContent=new Date(e.bar_time).toLocaleString()+' · '+e.direction+' · heuristic score '+e.score;target.append(p)}}catch(e){$('signalhistory').textContent='History: '+e.message}});
 request('/api/push/status').then(d=>{status.textContent=d.ready?'Push server ready. Enter pairing token to enable.':'Push not configured: '+(d.error||'check Render settings')}).catch(()=>{status.textContent='Push server unavailable'});
})();
