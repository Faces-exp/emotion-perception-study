import test from 'node:test';
import assert from 'node:assert/strict';
import {handle,demoManifest,csv,hash,purgeExpired} from '../server/core.mjs';
import {VideoClock} from '../web/timing.js';
const origin='http://localhost:8787';
function fixture(){const data=new Map();return {data,config:{mode:'demo',media_mode:'demo',retention:'test'},manifest:demoManifest(),
  store:{async get(k){return structuredClone(data.get(k)??null);},async put(k,v){data.set(k,structuredClone(v));},async create(k,v){if(data.has(k))return false;data.set(k,structuredClone(v));return true;},async delete(k){data.delete(k);},async list(p){return [...data.keys()].filter(k=>k.startsWith(p));}},
  async asset(){return new Response('page');},async media(){return new Response('video');}};}
async function request(env,path,body,cookie,customHeaders={}){return handle(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...customHeaders},body:body===undefined?undefined:JSON.stringify(body)}),env);}
async function start(env,condition){const r=await request(env,'/api/session',{consent:true,adult:true});assert.equal(r.status,201);const cookie=r.headers.get('set-cookie').split(';')[0];const s=await r.json();if(condition){const p=[...env.data.keys()].find(k=>k.endsWith('/session.json'));env.data.get(p).condition=condition;s.condition=condition;}return {s,cookie};}
async function event(env,cookie,key,data){const r=await request(env,'/api/event',{key,data},cookie);assert.ok(r.ok,await r.clone().text());return r.json();}
const scale={q1:1,q2:4,q3:7};
function trial(s,phase,index,early=true){return {phase,trial_number:index+1,stimulus_id:s[phase][index].id,response:'genuine',rt_ms:early?200:1500,onset_perf_ms:100,ended_perf_ms:1300,response_perf_ms:early?300:1600,
  video_end_elapsed_ms:1200,response_video_time_ms:early?200:1200,response_before_end:early,response_phase:early?'during_video':'after_video',watched_to_end:true,onset_source:'video_frame_callback',attempt:1,hidden_ms:0,media_duration_ms:1200,
  video_started_at:new Date().toISOString(),video_ended_at:new Date().toISOString(),answered_at:new Date().toISOString(),trial_ended_at:new Date().toISOString()};}
test('video clock: first frame is origin, early response waits for ended and cannot be changed',()=>{const c=new VideoClock();assert.equal(c.answer('posed',20,0),false);c.start(1000,'video_frame_callback');assert.equal(c.answer('genuine',1250,.25),true);assert.equal(c.answer('posed',1300,.3),false);assert.equal(c.complete,false);c.ended(2200);assert.equal(c.complete,true);assert.equal(c.data().rt_ms,250);assert.equal(c.data().response_before_end,true);});
test('video clock: response after end is measured from onset',()=>{const c=new VideoClock();c.start(1000,'playing_event');c.ended(2200);assert.equal(c.complete,false);c.answer('posed',2500,1.2);assert.equal(c.complete,true);assert.equal(c.data().rt_ms,1500);assert.equal(c.data().response_after_end_ms,300);assert.equal(c.data().response_phase,'after_video');});
test('manifest has identical balanced 48-stimulus set and disjoint practice',()=>{const m=demoManifest();assert.equal(m.main.length,48);assert.equal(m.practice.length,4);assert.equal(new Set(m.main.map(s=>s.id)).size,48);const cells={};m.main.forEach(s=>cells[s.emotion+'/'+s.type]=(cells[s.emotion+'/'+s.type]||0)+1);assert.equal(Object.keys(cells).length,12);assert.ok(Object.values(cells).every(n=>n===4));});
for(const condition of ['high_power','no_power'])test(`complete ${condition} session: 4 practice + 48 trials, checks, export and idempotency`,async()=>{
  const env=fixture(),{s,cookie}=await start(env,condition);
  await event(env,cookie,'role',{allocation:'anna_A',action:condition==='high_power'?'binding_decision':'acknowledgement',decision_rt_ms:1000});
  await event(env,cookie,'check_pre',scale);
  let first;
  for(const phase of ['practice','main'])for(let i=0;i<s[phase].length;i++){const payload=trial(s,phase,i,i%2===0);if(phase==='main'&&i===0)first=payload;await event(env,cookie,phase+'-'+(i+1),payload);}
  const repeat=await event(env,cookie,'main-1',first);assert.equal(repeat.row.correct,Number(repeat.row.stimulus_type==='genuine'));
  await event(env,cookie,'check_post',scale);
  const completed=await request(env,'/api/complete',{allow_use:true},cookie);assert.equal(completed.status,200);
  const exported=await (await request(env,'/api/export',undefined,cookie)).json();assert.equal(exported.events.filter(r=>r.phase==='main').length,48);assert.equal(exported.session.condition,condition);assert.ok(exported.session.allow_use_after_debrief);
  const resume=await (await request(env,'/api/session',undefined,cookie)).json();assert.equal(resume.status,'complete');assert.equal(Object.keys(resume.events).length,55);
});
test('consent, CSRF, media authorization, sequence, input checks and withdrawal',async()=>{
  const env=fixture();assert.equal((await request(env,'/media/demo.mp4')).status,401);
  assert.equal((await request(env,'/api/session',{consent:false,adult:true})).status,400);
  assert.equal((await request(env,'/api/session',{consent:true,adult:true},null,{Origin:'https://evil.example'})).status,403);
  const {s,cookie}=await start(env,'no_power');assert.match(cookie,/pe_session=/);
  assert.equal((await request(env,'/api/event',{key:'role',data:{allocation:'anna_B',action:'binding_decision',decision_rt_ms:1}},cookie)).status,400);
  assert.equal((await request(env,'/api/complete',{allow_use:true},cookie)).status,400);
  assert.equal((await request(env,'/media/no-such-id.mp4',undefined,cookie)).status,403);
  assert.equal((await request(env,'/media/'+s.main[0].id+'.mp4',undefined,cookie)).status,200);
  await event(env,cookie,'role',{allocation:'anna_A',action:'acknowledgement',decision_rt_ms:1});
  assert.equal((await request(env,'/api/event',{key:'main-1',data:trial(s,'main',0)},cookie)).status,400);
  await event(env,cookie,'check_pre',scale);
  const bad=trial(s,'practice',0);bad.rt_ms=-1;assert.equal((await request(env,'/api/event',{key:'practice-1',data:bad},cookie)).status,400);
  assert.equal((await request(env,'/api/withdraw',{},cookie)).status,200);assert.equal(env.data.size,0);assert.equal((await request(env,'/api/export',undefined,cookie)).status,401);
});
test('csv neutralizes spreadsheet formulas',()=>assert.match(csv([{code:'=HYPERLINK("bad")'}]),/"'=HYPERLINK/));
test('production blocks incomplete configuration and wrong invite',async()=>{const env=fixture();env.config.mode='production';assert.equal((await request(env,'/api/session',{consent:true,adult:true,invite:'x'})).status,503);env.config={...env.config,license_reviewed:true,contact:'test@example.com',approval_reference:'approved pilot',invite_hashes:[await hash('secret-invite')]};assert.equal((await request(env,'/api/session',{consent:true,adult:true,invite:'wrong'})).status,403);assert.equal((await request(env,'/api/session',{consent:true,adult:true,invite:'secret-invite'})).status,201);});
test('parallel session creation cannot reuse a participant ID',async()=>{const env=fixture();const body={consent:true,adult:true,participant_id:'QA_DUPLICATE'};const results=await Promise.all([request(env,'/api/session',body),request(env,'/api/session',body)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);});
test('production invite is single-use',async()=>{const env=fixture();env.config={mode:'production',media_mode:'demo',license_reviewed:true,contact:'test@example.com',retention:'test',approval_reference:'test',invite_hashes:[await hash('one-time')]};const body={consent:true,adult:true,invite:'one-time'};assert.equal((await request(env,'/api/session',body)).status,201);assert.equal((await request(env,'/api/session',body)).status,409);});
test('new test clears browser session without deleting recorded results',async()=>{const env=fixture(),{cookie}=await start(env);const count=env.data.size;const r=await request(env,'/api/new-test',{},cookie);assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/Max-Age=0/);assert.equal(env.data.size,count);});
test('retention removes sessions and access indexes after the stated date',async()=>{const env=fixture();env.config.retention_until='2026-12-20T21:00:00.000Z';await start(env);assert.equal(await purgeExpired(env.store,Date.parse('2026-12-20T20:59:59Z')),0);assert.equal(await purgeExpired(env.store,Date.parse('2026-12-20T21:00:01Z')),1);assert.equal(env.data.size,0);});
