import {handle,demoManifest,purgeExpired} from './core.mjs';
// The build supplies ASSETS. This entry intentionally has no PEDFE upload path.
export default {async fetch(request,env){
  const store={
    async get(key){const object=await env.BUCKET.get(key);return object?object.json():null;},
    async put(key,value){await env.BUCKET.put(key,JSON.stringify(value),{httpMetadata:{contentType:'application/json'}});},
    async create(key,value){return !!await env.BUCKET.put(key,JSON.stringify(value),{onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:'application/json'}});},
    async delete(key){await env.BUCKET.delete(key);},
    async list(prefix){let cursor,keys=[];do{const page=await env.BUCKET.list({prefix,cursor,limit:1000});keys.push(...page.objects.map(o=>o.key));cursor=page.truncated?page.cursor:undefined;}while(cursor);return keys;}
  };
  const config={mode:'demo',media_mode:'demo',contact:'@Not_4ever_Sour, @lovbls, @shrpnvsk',retention:'до 20 декабря 2026 года включительно',retention_until:'2026-12-20T21:00:00.000Z',purpose:'использование в учебных целях',storage_description:'закрытое хранилище R2 этого демонстрационного сайта'};
  if(Date.now()>=Date.parse(config.retention_until))await purgeExpired(store,Date.now(),config.retention_until);
  const getAsset=path=>{const a=ASSETS[path];if(!a)return new Response('Не найдено',{status:404});return new Response(Uint8Array.from(atob(a.base64),c=>c.charCodeAt(0)),{headers:{'Content-Type':a.type,'Content-Length':String(a.size)}});};
  return handle(request,{config,manifest:demoManifest(),store,asset:getAsset,media:()=>getAsset('/demo.mp4')});
}};
