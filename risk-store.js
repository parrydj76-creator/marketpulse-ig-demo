 'use strict';
const fs=require('fs'),path=require('path');
const PAIRS=['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD'];
const FIELDS=['size','stopDistance','limitDistance','maxSpread','minScore','minSizeVerified'];
const DEFAULT=()=>Object.fromEntries(PAIRS.map(k=>[k,{enabled:false,size:null,stopDistance:null,limitDistance:null,maxSpread:null,minScore:70,minSizeVerified:null,unitsVerified:false,lifecycleVerified:false,currencyCode:''}]));
function createRiskStore(opts={}){
 const filename=opts.filename||process.env.MP_RISK_SETTINGS_PATH||path.join(process.env.DATA_DIR||path.join(__dirname,'data'),'multi-risk.json');
 const disk=process.env.RENDER_DISK_MOUNT_PATH||'';
 const durable=process.env.PERSISTENT_STORAGE_CONFIRMED==='true' && process.env.MP_DURABLE_RISK_STORAGE_VERIFIED==='true' && (!process.env.RENDER || !!disk) && (!disk || path.resolve(filename).startsWith(path.resolve(disk)+path.sep));
 let state=DEFAULT(),revision=0,lastSaved=null,loadError=null;
 function validate(all){const errors={};if(!all||typeof all!=='object'||Array.isArray(all)||Object.keys(all).some(k=>!PAIRS.includes(k))||PAIRS.some(k=>!Object.hasOwn(all,k)))return {global:['Exactly seven major currency pairs required'],pairs:{}};
 for(const k of PAIRS){const x=all[k],err=[];if(!x||typeof x!=='object'||Array.isArray(x)){errors[k]=['Missing configuration'];continue}
 const allowed=[...FIELDS,'enabled','unitsVerified','lifecycleVerified','currencyCode'];if(Object.keys(x).some(z=>!allowed.includes(z)))err.push('Unknown configuration field');
 for(const key of ['enabled','unitsVerified','lifecycleVerified'])if(typeof x[key]!=='boolean')err.push(key+' must be true/false');
 for(const key of FIELDS){const v=x[key];if(v!==null&&(typeof v!=='number'||!Number.isFinite(v)))err.push(key+' must be a finite number or blank')}
 if(x.size!==null&&(x.size<=0||x.size>1))err.push('Size must be >0 and <=1');
 if(x.minSizeVerified!==null&&(x.minSizeVerified<=0||x.minSizeVerified>1))err.push('Verified minimum size must be >0 and <=1');
 if(x.size!==null&&x.minSizeVerified!==null&&x.size<x.minSizeVerified)err.push('Size below verified minimum');
 for(const key of ['stopDistance','limitDistance'])if(x[key]!==null&&(x[key]<=0||x[key]>100000))err.push(key+' out of bounds');
 if(x.maxSpread!==null&&(x.maxSpread<=0||x.maxSpread>100))err.push('Max spread out of bounds (raw price units)');
 if(!Number.isInteger(x.minScore)||x.minScore<65||x.minScore>90)err.push('Min score must be 65–90');
 if(typeof x.currencyCode!=='string'||(x.currencyCode!==''&&!/^[A-Z]{3}$/.test(x.currencyCode)))err.push('Currency code must be blank or three uppercase letters');
 if(x.enabled){for(const key of ['size','stopDistance','limitDistance','maxSpread','minSizeVerified'])if(x[key]===null)err.push(key+' required when enabled');if(!x.unitsVerified)err.push('IG point units must be verified');if(!x.lifecycleVerified)err.push('Demo lifecycle must be verified');if(!/^[A-Z]{3}$/.test(x.currencyCode))err.push('IG currency code required')}
 if(err.length)errors[k]=err;
 }return {global:[],pairs:errors}}
 function load(){try{const x=JSON.parse(fs.readFileSync(filename,'utf8'));if(x.schema!==1||!Number.isInteger(x.revision)||x.revision<0||Object.keys(validate(x.pairs).pairs).length||validate(x.pairs).global.length)throw Error('Invalid risk file schema');state=x.pairs;revision=x.revision;lastSaved=x.savedAt||null}catch(e){if(e.code!=='ENOENT')loadError=e.message}}
 load();
 function snapshot(){return {pairs:structuredClone(state),revision,lastSaved,durable,storageMode:durable?'verified-durable':'non-durable',loadError,brokerOrdersEnabled:false}}
 function save(next,expected){if(!durable)throw Object.assign(new Error('Durable storage not verified. Export your JSON backup or provision a persistent disk; server save is disabled.'),{status:409});if(expected!==revision)throw Object.assign(new Error('Settings changed elsewhere. Reload before saving.'),{status:409});const validation=validate(next);if(validation.global.length||Object.keys(validation.pairs).length)throw Object.assign(new Error('Risk settings validation failed'),{status:400,validation});const payload={schema:1,revision:revision+1,savedAt:new Date().toISOString(),pairs:next};fs.mkdirSync(path.dirname(filename),{recursive:true});const tmp=filename+'.'+process.pid+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(payload,null,2),{flag:'wx',mode:0o600});fs.renameSync(tmp,filename)}catch(e){try{fs.unlinkSync(tmp)}catch{}throw e}state=structuredClone(next);revision++;lastSaved=payload.savedAt;return snapshot()}
 return {snapshot,save,validate,PAIRS};
}
module.exports={createRiskStore,PAIRS};
