'use strict';
const HOST='https://demo-api.ig.com/gateway/deal';
function validate(method,route,body){
 if(typeof route!=='string'||!/^\/[A-Za-z0-9._~%/?=&+,:-]+$/.test(route)||/%(?:2f|5c|2e|00|0a|0d)/i.test(route)||route.includes('//')||route.split('?')[0].split('/').some(x=>x==='.'||x==='..'))throw Error('IG_ROUTE_INVALID');
 if(method==='GET'&&body===null)return HOST+route;
 if(method==='POST'&&route==='/session'&&body&&typeof body.identifier==='string'&&typeof body.password==='string'&&Object.keys(body).every(k=>['identifier','password'].includes(k)))return HOST+route;
 throw Error('IG_WRITE_HARD_BLOCKED');
}
async function transport(method,route,body,headers,fetcher=globalThis.fetch){const url=validate(method,route,body);return fetcher(url,{method,headers,body:body===null?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});}
module.exports={validate,transport};
