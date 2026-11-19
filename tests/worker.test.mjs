import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {workerSource} from '../scripts/worker-bundle.mjs';
test('hosted Worker stores and retrieves through private R2 binding',async()=>{
  const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(await workerSource()).toString('base64'));
  const objects=new Map();const BUCKET={
    async get(key){return objects.has(key)?{json:async()=>JSON.parse(objects.get(key))}:null;},
    async put(key,value,opts){if(opts?.onlyIf?.get('If-None-Match')==='*'&&objects.has(key))return null;objects.set(key,value);return {key};},
    async delete(key){objects.delete(key);},
    async list({prefix}){return {objects:[...objects.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key})),truncated:false};}
  };
  const origin='https://private.example';const headers={Origin:origin,'Content-Type':'application/json'};
  const r=await worker.fetch(new Request(origin+'/api/session',{method:'POST',headers,body:JSON.stringify({consent:true,adult:true})}),{BUCKET});
  assert.equal(r.status,201);assert.match(r.headers.get('set-cookie'),/Secure/);const cookie=r.headers.get('set-cookie').split(';')[0];
  const session=await (await worker.fetch(new Request(origin+'/api/session',{headers:{Cookie:cookie}}),{BUCKET})).json();
  assert.equal(session.main.length,48);assert.equal(session.practice.length,4);assert.equal(objects.size,2);
  const config=await (await worker.fetch(new Request(origin+'/api/config'),{BUCKET})).json();assert.equal(config.media_mode,'demo');assert.match(config.contact,/@lovbls/);
});
