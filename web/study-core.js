import {RU} from './content/ru.js?v=0.3.0';
import {EXPERIMENT} from './config/experiment.js?v=0.3.0';
import {csv,buildCSVExports,SURVEY_FIELDS} from './results.js?v=0.3.0';
export {csv};
export const VERSION='0.3.0';
const encoder=new TextEncoder();
export async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
const iso=()=>new Date().toISOString();
const number=(x,min=0,max=7200000)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function randomInt(max){const limit=Math.floor(2**32/max)*max;let x;do{x=crypto.getRandomValues(new Uint32Array(1))[0];}while(x>=limit);return x%max;}
export function shuffle(items){const a=[...items];for(let i=a.length-1;i>0;i--){const j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
export function demoManifest(){
  const emotions=['Anger','Disgust','Fear','Happiness','Sadness','Surprise'];
  return {version:'synthetic-demo-v1',main:emotions.flatMap(emotion=>['genuine','posed'].flatMap(type=>[1,2,3,4].map(n=>({id:`demo-${emotion.toLowerCase()}-${type}-${n}`,filename:'TECHNICAL_PLACEHOLDER.mp4',type,emotion,duration_ms:1200})))),
    practice:[1,2,3,4].map((n,i)=>({id:'practice-demo-'+n,filename:'TECHNICAL_PLACEHOLDER.mp4',type:i%2?'posed':'genuine',emotion:'Technical',duration_ms:1200}))};
}
function typeLabel(type){return RU.answers[type];}
async function sessionKey(request){const token=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('pe_session='))?.slice(11);return token&&/^[a-f0-9]{64}$/.test(token)?'sessions/'+await hash(token):null;}
async function readSession(request,store){const key=await sessionKey(request);if(!key)return null;const session=await store.get(key+'/session.json');if(!session||session.procedure_version!==VERSION||Date.now()-Date.parse(session.started_at)>12*3600*1000)return null;return {key,session};}
async function readEvents(store,key){const keys=await store.list(key+'/events/');const rows=await Promise.all(keys.map(k=>store.get(k)));return Object.fromEntries(rows.filter(Boolean).map(r=>[r.event_key,r]));}
function publicSession(session,events){return {active:true,session_id:session.session_id,participant_id:session.participant_id,condition:session.condition,status:session.status,is_test:session.is_test===true,
  main:session.main.map(s=>({id:s.id,audio:s.audio===true,duration_ms:s.duration_ms})),practice:session.practice.map(s=>({id:s.id,type:s.type,audio:s.audio===true,duration_ms:s.duration_ms})),events};}
function safeJSON(value,status=200,headers={}){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8',...headers}});}
export async function purgeExpired(store,now=Date.now(),fallbackUntil=null){
  let deleted=0;const keys=await store.list('sessions/');
  for(const key of keys.filter(k=>k.endsWith('/session.json'))){
    const s=await store.get(key),until=s?.retention_until||fallbackUntil;if(!s||!until||now<Date.parse(until))continue;
    const prefix=key.slice(0,-'session.json'.length);await Promise.all((await store.list(prefix)).map(k=>store.delete(k)));
    await store.delete('participant-ids/'+s.participant_id);if(s.invite_key)await store.delete(s.invite_key);deleted++;
  }return deleted;
}
export function validateEvent(key,data,s,events){
  if(!data||typeof data!=='object'||Array.isArray(data))fail(RU.server.message_03);
  const base={event_key:key,participant_id:s.participant_id,session_id:s.session_id,condition:s.condition,study_version:VERSION,manifest_version:s.manifest_version,media_mode:s.media_mode,run_mode:s.run_mode,is_test:s.is_test===true,received_at:iso()};
  if(key==='common_instruction'||key==='role_instruction'){
    if(data.acknowledged!==true||(key==='role_instruction'&&!events.common_instruction))fail(RU.errors.instructionsRequired);
    return {...base,acknowledged:true,instruction_version:VERSION};
  }
  if(key==='role'){
    if(!events.common_instruction||!events.role_instruction)fail(RU.errors.instructionsRequired);
    if(!['anna_A','anna_B'].includes(data.allocation)||!number(data.decision_rt_ms))fail(RU.server.message_04);
    if(s.condition==='no_power'&&(data.allocation!=='anna_A'||data.action!=='acknowledgement'))fail(RU.server.message_05);
    if(s.condition==='high_power'&&data.action!=='binding_decision')fail(RU.server.message_06);
    return {...base,allocation:data.allocation,action:data.action,decision_rt_ms:data.decision_rt_ms};
  }
  if(!events.role)fail(RU.server.message_07);
  if(key==='final_survey'){
    if(s.main.some((_,i)=>!events['main-'+(i+1)]))fail(RU.server.message_08);
    if(Object.keys(data).length!==3||!SURVEY_FIELDS.every(key=>Number.isInteger(data[key])&&data[key]>=1&&data[key]<=7))fail(RU.server.message_09);
    return {...base,...Object.fromEntries(SURVEY_FIELDS.map(key=>[key,data[key]]))};
  }
  const match=/^(practice|main)-(\d{1,2})$/.exec(key);if(!match)fail(RU.server.message_10);
  const phase=match[1],index=Number(match[2])-1,stim=s[phase][index];
  if(!stim||data.stimulus_id!==stim.id||data.phase!==phase||data.trial_number!==index+1)fail(RU.server.message_12);
  if(index>0&&!events[phase+'-'+index])fail(RU.server.message_13);
  if(phase==='main'&&s.practice.some((_,i)=>!events['practice-'+(i+1)]))fail(RU.server.message_14);
  if(!['genuine','posed'].includes(data.response))fail(RU.server.message_15);
  for(const k of ['rt_ms','onset_perf_ms','ended_perf_ms','response_perf_ms','video_end_elapsed_ms','response_video_time_ms','hidden_ms','media_duration_ms'])if(!number(data[k]))fail(RU.server.message_16+k);
  if(data.ended_perf_ms<data.onset_perf_ms||data.response_perf_ms<data.onset_perf_ms)fail(RU.server.message_17);
  if(Math.abs(data.rt_ms-(data.response_perf_ms-data.onset_perf_ms))>1||Math.abs(data.video_end_elapsed_ms-(data.ended_perf_ms-data.onset_perf_ms))>1)fail(RU.server.message_18);
  const before=data.response_perf_ms<data.ended_perf_ms;
  if(before!==data.response_before_end||data.response_phase!==(before?'during_video':'after_video'))fail(RU.server.message_19);
  if(!data.watched_to_end||!['video_frame_callback','playing_event'].includes(data.onset_source))fail(RU.server.message_20);
  if(!Number.isInteger(data.attempt)||data.attempt<1||data.attempt>1000)fail(RU.server.message_21);
  for(const k of ['video_started_at','video_ended_at','answered_at','trial_ended_at'])if(typeof data[k]!=='string'||!Number.isFinite(Date.parse(data[k])))fail(RU.server.message_22);
  const allowed=['rt_ms','response_perf_ms','response_video_time_ms','response_before_end','response_phase','onset_perf_ms','onset_source','ended_perf_ms','video_end_elapsed_ms','response_after_end_ms','video_started_at','video_ended_at','answered_at','trial_ended_at','media_duration_ms','attempt','restarted_after_reload','hidden_ms','media_error_count','screen_width','screen_height','dropped_video_frames','fixation_onset_perf_ms','fixation_offset_perf_ms','fixation_duration_ms','configured_fixation_ms','next_clicked_at','next_elapsed_ms','playback_rate','fullscreen','browser_family','autoplay_blocked'];
  const timing=Object.fromEntries(allowed.map(k=>[k,data[k]??null]));
  const playback_events=Array.isArray(data.playback_events)?data.playback_events.slice(0,120).map(e=>({event:String(e.event).slice(0,40),perf_ms:number(e.perf_ms)?e.perf_ms:null,video_time_ms:number(e.video_time_ms)?e.video_time_ms:null})):[];
  return {...base,...timing,playback_events,phase,trial_number:index+1,stimulus_id:stim.id,stimulus_filename:stim.filename,stimulus_type:stim.type,emotion:stim.emotion,
    subject:stim.subject??null,gender:stim.gender??null,source_row:stim.source_row??null,source_sha256:stim.source_sha256??null,web_sha256:stim.web_sha256??null,
    response:data.response,response_label:typeLabel(data.response),type_label:typeLabel(stim.type),correct:Number(data.response===stim.type),watched_to_end:true,
    quality_flag:data.hidden_ms>0||data.attempt>1||data.media_error_count>0||playback_events.some(e=>['waiting','stalled','window_blur','seek_blocked','rate_change'].includes(e.event))};
}
export async function handle(request,env){
  const url=new URL(request.url);const path=url.pathname;
  const headers={'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'",
    'Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
  let response;
  try{
    if(request.method==='POST'){
      if(request.headers.get('origin')!==url.origin)fail(RU.server.message_23,403);
      if(!(request.headers.get('content-type')||'').startsWith('application/json'))fail(RU.server.message_24,415);
      if(Number(request.headers.get('content-length')||0)>32768)fail(RU.server.message_25,413);
    }
    const body=async()=>{const text=await request.text();if(text.length>32768)fail(RU.server.message_25,413);try{return JSON.parse(text);}catch{fail(RU.server.message_26);}};
    if(path==='/api/config'&&request.method==='GET')response=safeJSON({mode:env.config.mode,media_mode:env.config.media_mode,contact:env.config.contact,retention:env.config.retention,
      storage_description:env.config.storage_description,purpose:env.config.purpose,require_invite:env.config.mode==='production'});
    else if(path==='/api/session'&&request.method==='POST'){
      const data=await body();if(data.consent!==true||data.adult!==true)fail(RU.server.message_27);
      if(env.config.retention_until&&Date.now()>=Date.parse(env.config.retention_until))fail(RU.server.message_28,503);
      const prior=await readSession(request,env.store);if(prior)fail(RU.server.message_29,409);
      if(env.config.mode==='production'){
        if(!env.config.license_reviewed||!env.config.contact||!env.config.retention||!env.config.approval_reference)fail(RU.server.message_30,503);
        if(!data.invite||!env.config.invite_hashes?.includes(await hash(data.invite)))fail(RU.server.message_31,403);
      }
      const participant_id=data.participant_id||'P'+crypto.randomUUID().replaceAll('-','').slice(0,12).toUpperCase();
      if(!/^[A-Za-z0-9_-]{6,32}$/.test(participant_id))fail(RU.server.message_32);
      const idKey='participant-ids/'+participant_id;
      const token=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
      const key='sessions/'+await hash(token), manifest=env.manifest;
      const is_test=data.is_test===true;const forced=is_test&&env.config.mode!=='production'&&['high_power','no_power'].includes(data.test_condition)?data.test_condition:null;
      const session={session_id:crypto.randomUUID(),participant_id,is_test,condition:forced||(randomInt(2)?'high_power':'no_power'),assignment_method:forced?'test_only_forced':'crypto_bernoulli_p_0.5',started_at:iso(),status:'active',
        consent_version:VERSION,procedure_version:VERSION,study_version:VERSION,consent:true,adult:true,purpose:env.config.purpose??null,retention_until:env.config.retention_until??null,manifest_version:manifest.version,main:shuffle(manifest.main),practice:shuffle(manifest.practice),media_mode:env.config.media_mode,run_mode:env.config.mode};
      if(!await env.store.create(idKey,{session_id:session.session_id}))fail(RU.server.message_33,409);
      if(env.config.mode==='production'){
        const inviteKey='invites/'+await hash(data.invite);
        if(!await env.store.create(inviteKey,{session_id:session.session_id})){await env.store.delete(idKey);fail(RU.server.message_34,409);}
        session.invite_key=inviteKey;
      }
      await env.store.put(key+'/session.json',session);
      response=safeJSON(publicSession(session,{}),201,{'Set-Cookie':`pe_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${url.protocol==='https:'?'; Secure':''}`});
    }
    else if(path==='/api/session'&&request.method==='GET'){
      const current=await readSession(request,env.store);response=safeJSON(current?publicSession(current.session,await readEvents(env.store,current.key)):{active:false});
    }
    else if(path.startsWith('/api/')||path.startsWith('/media/')){
      const current=await readSession(request,env.store);if(!current)fail(RU.server.message_35,401);
      const {session:s,key}=current;
      if(path.startsWith('/media/')&&request.method==='GET'){
        const id=/^\/media\/([a-zA-Z0-9_-]+)\.mp4$/.exec(path)?.[1];const stim=[...s.main,...s.practice].find(x=>x.id===id);
        if(!stim)fail(RU.server.message_36,403);
        response=await env.media(stim,request);
      }else if(path==='/api/new-test'&&request.method==='POST'){
        await body();if(env.config.mode==='production')fail(RU.server.message_37,403);
        response=safeJSON({reset:true},200,{'Set-Cookie':'pe_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
      }else if(path==='/api/checkpoint'&&request.method==='POST'){
        const data=await body();const stim=[...s.main,...s.practice].find(item=>item.id===data.stimulus_id);
        if(s.status!=='active'||!stim)fail(RU.errors.invalidMedia,400);
        const allowed=['kind','phase','trial_number','stimulus_id','response','rt_ms','onset_perf_ms','response_perf_ms','ended_perf_ms','video_end_elapsed_ms','response_before_end','response_phase','response_video_time_ms','video_started_at','answered_at','attempt','watched_to_end','next_clicked_at','next_elapsed_ms'];
        const row=Object.fromEntries(allowed.map(k=>[k,data[k]??null]));row.received_at=iso();row.session_id=s.session_id;row.is_test=s.is_test===true;
        await env.store.put(key+'/journal/'+crypto.randomUUID()+'.json',row);response=safeJSON({saved:true},201);
      }else if(path==='/api/event'&&request.method==='POST'){
        if(s.status!=='active')fail(RU.server.message_38,409);
        const data=await body();if(typeof data.key!=='string'||!/^(common_instruction|role_instruction|role|final_survey|practice-[1-4]|main-([1-9]|[1-3][0-9]|4[0-8]))$/.test(data.key))fail(RU.server.message_39);
        const eventPath=key+'/events/'+data.key+'.json';const existing=await env.store.get(eventPath);
        if(existing){if(existing.payload_hash!==await hash(JSON.stringify(data.data)))fail(RU.server.message_40,409);response=safeJSON({saved:true,row:existing});}
        else{const events=await readEvents(env.store,key);const row=validateEvent(data.key,data.data,s,events);row.payload_hash=await hash(JSON.stringify(data.data));
          if(!await env.store.create(eventPath,row)){const committed=await env.store.get(eventPath);if(committed?.payload_hash!==row.payload_hash)fail(RU.server.message_40,409);response=safeJSON({saved:true,row:committed});}
          else response=safeJSON({saved:true,row},201);}
      }else if(path==='/api/complete'&&request.method==='POST'){
        const data=await body();const events=await readEvents(env.store,key);
        if(data.allow_use!==true||!events.role||!events.final_survey||s.main.some((_,i)=>!events['main-'+(i+1)])||s.practice.some((_,i)=>!events['practice-'+(i+1)]))fail(RU.server.message_41);
        if(s.status!=='complete'){const main=Object.values(events).filter(row=>row.phase==='main');const correct=main.reduce((sum,row)=>sum+row.correct,0);s.summary={n_main:main.length,n_correct:correct,accuracy_percent:correct/48*100};s.status='complete';s.completed_at=iso();s.allow_use_after_debrief=true;await env.store.put(key+'/session.json',s);}
        response=safeJSON({saved:true,receipt:RU.complete.receipt,summary:s.summary});
      }else if(path==='/api/withdraw'&&request.method==='POST'){
        await body();const keys=await env.store.list(key+'/');await Promise.all(keys.map(k=>env.store.delete(k)));await env.store.delete('participant-ids/'+s.participant_id);
        response=safeJSON({deleted:true},200,{'Set-Cookie':'pe_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
      }else if(path==='/api/export'&&request.method==='GET'){
        const events=await readEvents(env.store,key);const rows=Object.values(events).filter(row=>!url.searchParams.has('phase')||row.phase===url.searchParams.get('phase')).sort((a,b)=>a.received_at.localeCompare(b.received_at));
        const asCSV=url.searchParams.get('format')==='csv';let exported=null;
        if(asCSV){const journal=await Promise.all((await env.store.list(key+'/journal/')).map(k=>env.store.get(k)));exported=buildCSVExports(s,events,journal).find(file=>file.kind===(url.searchParams.get('kind')==='participant'?'participant':'trials'));}
        response=new Response(asCSV?exported.data:JSON.stringify({session:s,events:rows},null,2),{headers:{'Content-Type':asCSV?'text/csv; charset=utf-8':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="${asCSV?exported.filename:s.participant_id+'.json'}"`}});
      }else fail(RU.server.message_43,404);
    }
    else if(request.method==='GET')response=await env.asset(path,request);
    else fail(RU.server.message_43,404);
  }catch(e){response=safeJSON({error:e.status?e.message:RU.server.message_44},e.status||500);if(!e.status)env.log?.(e);}
  const final=new Response(response.body,response);for(const [k,v] of Object.entries(headers))final.headers.set(k,v);return final;
}
