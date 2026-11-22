import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {BrowserStore} from '../web/storage/pages.js';
import {EXPERIMENT} from '../web/config/experiment.js';
import {parseCSV} from './csv-helper.mjs';
const manifest=JSON.parse(await fs.readFile(new URL('../web/stimuli/manifest.json',import.meta.url),'utf8'));
const accepted={ok:true,status:201,body:{message:'Success'}};
function fixture(results=[accepted],condition='no_power',isTest=true){
  const memory=new Map(),writes=[],staged=[],closed=[];let calls=0;
  const storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
  const pipe={createSession(){return {record:r=>staged.push(r),close:async options=>closed.push(options)};},async saveData(options){writes.push(options);return results[Math.min(calls++,results.length-1)];}};
  globalThis.location={href:'https://example.github.io/study/?'+(isTest?'test=1&':'')+'condition='+condition};
  const store=new BrowserStore({storage,pipe,fetcher:async()=>new Response(JSON.stringify(manifest))});
  return {store,writes,staged,closed,storage,pipe};
}
async function completeTrials(store){
  const s=await store.call('session',{consent:true,adult:true,participant_id:'QA_UNIT_CSV'});
  for(const key of ['common_instruction','role_instruction'])await store.call('event',{key,data:{acknowledged:true}});
  await store.call('event',{key:'role',data:{allocation:s.condition==='high_power'?'anna_B':'anna_A',action:s.condition==='high_power'?'binding_decision':'acknowledgement',decision_rt_ms:1}});
  for(const phase of ['practice','main'])for(let i=0;i<s[phase].length;i++){
    const row={phase,trial_number:i+1,stimulus_id:s[phase][i].id,response:'genuine',rt_ms:200,onset_perf_ms:100,ended_perf_ms:1300,response_perf_ms:300,video_end_elapsed_ms:1200,response_video_time_ms:200,response_before_end:true,response_phase:'during_video',watched_to_end:true,onset_source:'video_frame_callback',attempt:1,hidden_ms:0,media_duration_ms:1200,video_started_at:new Date().toISOString(),video_ended_at:new Date().toISOString(),answered_at:new Date().toISOString(),trial_ended_at:new Date().toISOString(),fixation_duration_ms:604,configured_fixation_ms:600};
    await store.call('event',{key:phase+'-'+(i+1),data:row});
    await store.partial({kind:'navigation',phase,trial_number:i+1,next_clicked_at:'2026-11-19T18:00:00Z',next_elapsed_ms:2000,rt_ms:200});
  }
  await store.call('event',{key:'final_survey',data:{perceived_social_power:2,emotion_recognition_ease:5,role_consideration:7}});return s;
}
test('Pages binds browser fetch to its window context',async()=>{
  const {storage}=fixture();
  const store=new BrowserStore({storage,pipe:{},fetcher:async function(){assert.equal(this,globalThis);return new Response(JSON.stringify(manifest));}});
  assert.equal((await store.manifest()).main.length,48);
});
for(const condition of ['high_power','no_power'])test('Pages '+condition+': two CSV files, correct survey and unchanged 48-trial score',async()=>{
  const f=fixture([accepted],condition),s=await completeTrials(f.store);assert.equal(s.condition,condition);assert.equal(s.is_test,true);
  const result=await f.store.call('complete',{allow_use:true});assert.equal(result.saved,true);assert.equal(f.writes.length,2);
  const trials=parseCSV(f.writes[0].data),[p]=parseCSV(f.writes[1].data);assert.equal(trials.length,48);assert.equal(p.practice_count,'4');
  assert.equal(p.n_correct,'24');assert.equal(p.accuracy_percent,'50');assert.equal(p.is_test,'true');assert.match(f.writes[0].filename,/^TEST_trials_.*[.]csv$/);assert.match(f.writes[1].filename,/^TEST_participant_.*[.]csv$/);
  assert.equal(p.status,'complete');assert.equal(p.perceived_social_power,'2');assert.equal(p.emotion_recognition_ease,'5');assert.equal(p.role_consideration,'7');assert.equal(p.power_mean,undefined);
  assert.equal(p.allocation,condition==='high_power'?'anna_B':'anna_A');assert.equal(JSON.parse(p.practice_trials).length,4);assert.equal(JSON.parse(p.technical_journal).length,52);
  for(const key of ['participant_id','condition','trial_number','video_filename','emotion','authenticity','response','correct','video_duration_ms','reaction_time_ms','response_during_video','response_after_end_ms'])assert.ok(key in trials[0],key);
  assert.equal(trials[47].reaction_time_ms,'200');assert.equal(trials[47].next_elapsed_ms,'2000');assert.equal(f.writes[0].session,undefined);assert.ok(f.writes[1].session);
  assert.deepEqual(f.closed,[{submitted:true}]);
  const restored=new BrowserStore({storage:f.storage,pipe:{},fetcher:()=>{}});assert.equal((await restored.call('session')).status,'complete');assert.equal(restored.session.session_id,s.session_id);
});
test('Pages retries immutable first CSV after failure without changing RT',async()=>{
  const f=fixture([{ok:false,status:0,body:{error:'NETWORK_ERROR'}},accepted]);await completeTrials(f.store);
  await assert.rejects(f.store.call('complete',{allow_use:true}));assert.equal(f.store.session.status,'submitting');
  await f.store.call('complete',{allow_use:true});assert.equal(f.writes.length,3);assert.equal(f.writes[0].filename,f.writes[1].filename);assert.equal(f.writes[0].data,f.writes[1].data);assert.equal(f.store.session.status,'complete');
});
test('Pages resumes failed second CSV after reload, without sending trials again or reporting false success',async()=>{
  const f=fixture([accepted,{ok:false,status:0,body:{error:'NETWORK_ERROR'}}]);await completeTrials(f.store);
  await assert.rejects(f.store.call('complete',{allow_use:true}));assert.equal(f.store.session.status,'submitting');assert.equal(f.closed.length,0);
  const retried=[];const restored=new BrowserStore({storage:f.storage,pipe:{...f.pipe,saveData:async o=>{retried.push(o);return accepted;}},fetcher:()=>{}});
  await restored.call('complete',{allow_use:true});assert.equal(retried.length,1);assert.equal(retried[0].filename,f.writes[1].filename);assert.equal(retried[0].data,f.writes[1].data);assert.equal(restored.session.status,'complete');
});
test('Pages keeps a queued CSV receipt and does not resend it',async()=>{
  const f=fixture([{ok:true,status:202,body:{message:'Queued'}},accepted]);await completeTrials(f.store);await f.store.call('complete',{allow_use:true});assert.equal(f.store.session.delivery.queued,true);assert.equal(f.writes.length,2);assert.deepEqual(f.closed,[{submitted:true}]);
});
test('Pages CSV withdrawal contains no answers and cannot overwrite another session',async()=>{
  const f=fixture();await f.store.call('session',{consent:true,adult:true});await f.store.call('withdraw',{});const [p]=parseCSV(f.writes[0].data);assert.equal(p.status,'withdrawn');assert.equal(p.response,undefined);assert.match(f.writes[0].filename,/^TEST_withdrawal_.*[.]csv$/);
});
test('Survey rejects an early response, old scales, missing fields and extra questions',async()=>{
  const f=fixture();await f.store.call('session',{consent:true,adult:true});
  await assert.rejects(f.store.call('event',{key:'role',data:{allocation:'anna_A',action:'acknowledgement',decision_rt_ms:1}}));
  await completeTrials(f.store);delete f.store.session.events.final_survey;
  for(const data of [{q1:2,q2:5,q3:7},{perceived_social_power:8,emotion_recognition_ease:5,role_consideration:7},{perceived_social_power:2,emotion_recognition_ease:5,role_consideration:7,extra:1}])await assert.rejects(f.store.call('event',{key:'final_survey',data}));
  await assert.rejects(f.store.call('event',{key:'check_pre',data:{q1:1,q2:2,q3:3}}));
  delete f.store.session.events['main-48'];await assert.rejects(f.store.call('event',{key:'final_survey',data:{perceived_social_power:2,emotion_recognition_ease:5,role_consideration:7}}));
});
for(const condition of ['high_power','no_power'])test('Production link '+condition+' fixes the role and sends both CSV files to the main experiment',async()=>{
  const f=fixture([accepted],condition,false),s=await completeTrials(f.store);
  assert.equal(s.condition,condition);assert.equal(s.is_test,false);assert.equal(s.run_mode,'production');assert.equal(s.assignment_method,'link_fixed');
  await f.store.call('complete',{allow_use:true});assert.equal(f.writes.length,2);
  for(const file of f.writes){assert.equal(file.experiment_id,EXPERIMENT.datapipe.experiment_id);assert.doesNotMatch(file.filename,/^TEST_/);for(const r of parseCSV(file.data)){assert.equal(r.condition,condition);assert.equal(r.is_test,'false');}}
});
test('Production links never import a saved legacy TEST session and withdrawals use the main destination',async()=>{
  const f=fixture();await f.store.call('session',{consent:true,adult:true});const legacy=JSON.stringify(f.store.session);f.storage.setItem('pedfe-session-v3',legacy);
  globalThis.location={href:'https://example.github.io/study/?condition=high_power'};
  const real=new BrowserStore({storage:f.storage,pipe:f.pipe,fetcher:async()=>new Response(JSON.stringify(manifest))});
  assert.equal((await real.call('session')).active,false);const s=await real.call('session',{consent:true,adult:true});assert.equal(s.condition,'high_power');assert.equal(s.is_test,false);assert.notEqual(s.session_id,f.store.session.session_id);
  await real.call('withdraw',{});const write=f.writes.at(-1);assert.equal(write.experiment_id,EXPERIMENT.datapipe.experiment_id);assert.doesNotMatch(write.filename,/^TEST_/);assert.equal(parseCSV(write.data)[0].is_test,'false');assert.equal(f.storage.getItem('pedfe-session-v3'),legacy);
});
test('The two production link sessions resume independently and keep the assigned condition',async()=>{
  const f=fixture([accepted],'high_power',false),high=await f.store.call('session',{consent:true,adult:true});
  globalThis.location={href:'https://example.github.io/study/?condition=no_power'};
  const lowStore=new BrowserStore({storage:f.storage,pipe:f.pipe,fetcher:async()=>new Response(JSON.stringify(manifest))});assert.equal((await lowStore.call('session')).active,false);const low=await lowStore.call('session',{consent:true,adult:true});assert.equal(low.condition,'no_power');assert.notEqual(high.session_id,low.session_id);
  globalThis.location={href:'https://example.github.io/study/?condition=high_power'};
  const resumed=new BrowserStore({storage:f.storage,pipe:f.pipe,fetcher:()=>{}});const s=await resumed.call('session');assert.equal(s.session_id,high.session_id);assert.equal(s.condition,'high_power');assert.equal(s.started_at,high.started_at);
});
test('Legacy production progress is preserved when resuming a matching working link',async()=>{
  const f=fixture([accepted],'no_power',false),s=await f.store.call('session',{consent:true,adult:true});const json=JSON.stringify(f.store.session);f.storage.setItem('pedfe-session-v3',json);f.storage.removeItem(f.store.storageKey);
  const resumed=new BrowserStore({storage:f.storage,pipe:f.pipe,fetcher:()=>{}});assert.equal((await resumed.call('session')).session_id,s.session_id);assert.equal(f.storage.getItem('pedfe-session-v3'),json);
});
