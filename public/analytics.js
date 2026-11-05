'use strict';
const $ = id => document.getElementById(id);
const fmt = (v,d=2) => v === null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d);
function showStats(a) {
 $('trades').textContent = a.totalTrades ?? '—';
 $('winrate').textContent = a.winRate === null ? '—' : fmt(a.winRate,1)+'%';
 $('net').textContent = fmt(a.netPips,1)+' pips';
 $('factor').textContent = fmt(a.profitFactor,2);
 $('drawdown').textContent = fmt(a.maxDrawdownPips,1)+' pips';
 $('record').textContent = (a.wins ?? 0)+' / '+(a.losses ?? 0);
 $('net').className = 'value '+(a.netPips>0?'green':a.netPips<0?'red':'');
}
function drawChart(curve) {
 const svg = $('chart');
 svg.replaceChildren();
 const data = (Array.isArray(curve)?curve:[])
  .filter(p=>Number.isFinite(p.pips));
 if (!data.length) return;
 const values=data.map(p=>p.pips);
 const low=Math.min(0,...values);
 const high=Math.max(0,...values);
 const range=Math.max(high-low,1);
 const x=i=>40+i*620/Math.max(data.length-1,1);
 const y=v=>190-(v-low)*155/range;
 const ns='http://www.w3.org/2000/svg';
 const line=document.createElementNS(ns,'polyline');
 line.setAttribute('fill','none');
 line.setAttribute('stroke','#77e2b1');
 line.setAttribute('stroke-width','3');
 line.setAttribute('stroke-linejoin','round');
 line.setAttribute('points',data.map((p,i)=>x(i)+','+y(p.pips)).join(' '));
 svg.append(line);
}
async function loadAnalytics() {
 try {
  const response=await fetch('/api/paper/analytics',{cache:'no-store'});
  if (!response.ok) throw Error('HTTP '+response.status);
  const data=await response.json();
  if (data.simulationOnly!==true || !data.analytics) throw Error('Invalid analytics response');
  showStats(data.analytics);
  drawChart(data.analytics.equityCurve);
  $('status').textContent='Updated '+new Date().toLocaleTimeString()+' · Simulated pips · Available history only';
 } catch(error) {
  $('status').textContent='Analytics unavailable: '+error.message;
 }
}
loadAnalytics();
setInterval(loadAnalytics,15000);
