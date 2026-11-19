import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {BrowserStore} from '../web/storage/pages.js';
import {EXPERIMENT} from '../web/config/experiment.js';
const manifest=JSON.parse(await fs.readFile(new URL('../web/stimuli/manifest.json',import.meta.url),'utf8'));
function fixture(results=[{ok:true,status:201,body:{message:'Success'}}]){
  const memory=new Map(),writes=[],staged=[],closed=[];let calls=0;
  const storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
  const pipe={createSession(){return {record:r=>staged.push(r),close:async options=>closed.push(options)};},async saveData(options){writes.push(options);return results[Math.min(calls++,results.length-1)];}};
  globalThis.location={href:'https://example.github.io/study/?test=1&condition=no_power'};
  EXPERIMENT.datapipe.test_experiment_id='TEST_UNIT';EXPERIMENT.datapipe.experiment_id='PRODUCTION_UNIT';
  const store=new BrowserStore({storage,pipe,fetcher:async()=>new Response(JSON.stringify(manifest))});
  return {store,writes,staged,closed,storage};
}
async function completeTrials(store){
  const s=await store.call('session',{consent:true,adult:true});
  await store.call('event',{key:'role',data:{allocation:'anna_A',action:'acknowledgement',decision_rt_ms:1}});
  const answers={q1:2,q2:2,q3:2};await store.call('event',{key:'check_pre',data:answers});
  for(const phase of ['practice','main'])for(let i=0;i<s[phase].length;i++){
    const row={phase,trial_number:i+1,stimulus_id:s[phase][i].id,response:'genuine',rt_ms:200,onset_perf_ms:100,ended_perf_ms:1300,response_perf_ms:300,video_end_elapsed_ms:1200,response_video_time_ms:200,response_before_end:true,response_phase:'during_video',watched_to_end:true,onset_source:'video_frame_callback',attempt:1,hidden_ms:0,media_duration_ms:1200,video_started_at:new Date().toISOString(),video_ended_at:new Date().toISOString(),answered_at:new Date().toISOString(),trial_ended_at:new Date().toISOString(),fixation_duration_ms:604,configured_fixation_ms:600};
    await store.call('event',{key:phase+'-'+(i+1),data:row});
  }
  await store.call('event',{key:'check_post',data:answers});return s;
}
test('Pages persists one randomized test session and final JSON with all 48 trial rows and score',async()=>{
  const f=fixture(),s=await completeTrials(f.store);assert.equal(s.condition,'no_power');assert.equal(s.is_test,true);
  const result=await f.store.call('complete',{allow_use:true});assert.equal(result.saved,true);assert.equal(f.writes.length,1);
  const payload=JSON.parse(f.writes[0].data);assert.equal(payload.events.filter(e=>e.phase==='main').length,48);assert.equal(payload.events.filter(e=>e.phase==='practice').length,4);
  assert.equal(payload.summary.n_correct,24);assert.equal(payload.summary.accuracy_percent,50);assert.equal(payload.is_test,true);assert.match(f.writes[0].filename,/^TEST_/);assert.equal(payload.status,'complete');assert.ok(f.staged.length>=55);
  const restored=new BrowserStore({storage:f.storage,pipe:{},fetcher:()=>{}});assert.equal((await restored.call('session')).status,'complete');assert.equal(restored.session.session_id,s.session_id);
});
test('Pages retains an immutable final payload after a network failure and retries without changing RTs',async()=>{
  const f=fixture([{ok:false,status:0,body:{error:'NETWORK_ERROR'}},{ok:true,status:201,body:{message:'Success'}}]);await completeTrials(f.store);
  await assert.rejects(f.store.call('complete',{allow_use:true}));assert.equal(f.store.session.status,'submitting');
  await f.store.call('complete',{allow_use:true});assert.equal(f.writes.length,2);assert.equal(f.writes[0].filename,f.writes[1].filename);assert.equal(f.writes[0].data,f.writes[1].data);assert.equal(f.store.session.status,'complete');
});
test('Pages recognizes an accepted queued upload without creating an extra file',async()=>{
  const f=fixture([{ok:true,status:202,body:{error:null,message:'Queued'}}]);await completeTrials(f.store);await f.store.call('complete',{allow_use:true});assert.equal(f.store.session.delivery.queued,true);assert.equal(f.writes.length,1);assert.deepEqual(f.closed,[{submitted:true}]);
});
test('Pages withdrawals contain no answers and use a separate withdrawal filename',async()=>{
  const f=fixture();await f.store.call('session',{consent:true,adult:true});await f.store.call('withdraw',{});const payload=JSON.parse(f.writes[0].data);assert.equal(payload.status,'withdrawn');assert.deepEqual(payload.events,[]);assert.match(f.writes[0].filename,/^withdrawal_/);
});
