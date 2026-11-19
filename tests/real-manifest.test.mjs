import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {hash} from '../server/core.mjs';
const manifestURL=new URL('../private/manifest.json',import.meta.url);
let manifest;try{manifest=JSON.parse(await fs.readFile(manifestURL,'utf8'));}catch{}
test('real PEDFE selection: all 52 MP4s match manifest hashes, cell and actor balance',{skip:!manifest},async()=>{
  assert.equal(manifest.main.length,48);assert.equal(manifest.practice.length,4);
  const all=[...manifest.main,...manifest.practice];assert.equal(new Set(all.map(s=>s.id)).size,52);
  assert.equal(new Set(manifest.main.map(s=>s.subject)).size,24);
  const cells={};for(const s of manifest.main){const k=[s.emotion,s.type,s.gender].join('/');cells[k]=(cells[k]||0)+1;}
  assert.equal(Object.keys(cells).length,24);assert.ok(Object.values(cells).every(n=>n===2));
  const actors=new Set(manifest.main.map(s=>s.subject));assert.ok(manifest.practice.every(s=>!actors.has(s.subject)));
  for(const s of all){const bytes=await fs.readFile(new URL('../private/media/'+s.web_filename,import.meta.url));
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
    assert.equal(digest,s.web_sha256);assert.ok(s.duration_ms>0);assert.ok(s.frames>0);
  }
});
