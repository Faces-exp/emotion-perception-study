import {RU,text} from './content/ru.js';
import {EXPERIMENT} from './config/experiment.js';
import {VideoClock} from './timing.js';
import {$,show,button,escapeHTML,wait,frame,browserFamily} from './ui.js';

export async function runVideoTrial({stim,index,phase,session,store,saveEvent,isStopped}){
  const video=document.createElement('video');video.playsInline=true;video.preload='auto';video.autoplay=false;
  video.muted=stim.audio!==true;video.controls=false;video.disablePictureInPicture=true;video.disableRemotePlayback=true;video.playbackRate=1;
  video.setAttribute('controlslist','nodownload nofullscreen noremoteplayback');
  const clock=new VideoClock(),events=[];let finished=false,committing=false,readyToResume=false,frameHandle,lastStableTime=0,correctingSeek=false;
  let startedISO=null,endedISO=null,answeredISO=null,hiddenStart=null,hiddenMs=0,mediaErrors=0,autoplayBlocked=false;
  const attemptKey=`pedfe-attempt-${session.session_id}-${phase}-${index}`;
  let attempt=1;try{attempt=Number(sessionStorage.getItem(attemptKey)||0)+1;sessionStorage.setItem(attemptKey,String(attempt));}catch{}
  const log=(event,extra={})=>{if(events.length<160)events.push({event,perf_ms:performance.now(),video_time_ms:video.currentTime*1000,...extra});};
  show(`<p class="loading">${escapeHTML(RU.trial.loading)}</p>`,'loading');
  // Load the complete clip before fixation. Network waiting is never counted as RT.
  let loading=true;
  while(loading&&!isStopped()){
    try{
      const res=await fetch(store.mediaURL(stim),{credentials:'same-origin',signal:AbortSignal.timeout(30000)});
      if(!res.ok)throw Error(RU.errors.invalidMedia);
      const blob=await res.blob();video.src=URL.createObjectURL(blob);
      await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error(RU.trial.loadError)),15000);video.addEventListener('loadeddata',()=>{clearTimeout(timeout);resolve();},{once:true});video.addEventListener('error',()=>{clearTimeout(timeout);reject(Error(RU.trial.loadError));},{once:true});video.load();});
      loading=false;
    }catch{mediaErrors++;await screenRetry(RU.trial.loadError,RU.buttons.retryVideo);}
  }
  if(isStopped())return {};
  show(`<div class="fixation" role="img" aria-label="${escapeHTML(RU.trial.fixationLabel)}">+</div>`,'fixation');
  await frame();const fixationOnset=performance.now();await wait(EXPERIMENT.fixation_ms);await frame();const fixationOffset=performance.now();
  show(`<section class="trial" aria-label="${escapeHTML(RU.trial.question)}"><div class="video-stage" id="video-stage"></div><p class="trial-question">${escapeHTML(RU.trial.question)}</p><div class="responses">${button(RU.answers.genuine,'data-answer="genuine" disabled')}${button(RU.answers.posed,'data-answer="posed" disabled')}</div><div class="trial-bottom"><p class="trial-status" role="status" aria-live="polite"></p>${button(RU.buttons.next,'id="trial-next" disabled')}</div><p id="practice-feedback" class="practice-feedback" hidden></p><button type="button" id="video-recovery" hidden></button><button type="button" class="trial-exit" id="trial-exit" aria-label="${escapeHTML(RU.withdraw.button)}">×</button></section>`,'trial');
  $('#video-stage').append(video);$('#trial-exit').onclick=()=>$('#withdraw').click();
  const status=$('.trial-status'),next=$('#trial-next'),recovery=$('#video-recovery'),buttons=[...document.querySelectorAll('[data-answer]')];
  return new Promise(resolve=>{
    let savedRow=null;
    const cleanup=()=>{finished=true;document.removeEventListener('visibilitychange',visibility);window.removeEventListener('blur',blur);video.pause();if(frameHandle!==undefined&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(frameHandle);URL.revokeObjectURL(video.src);};
    const rowData=()=>({...clock.data(),phase,trial_number:index+1,stimulus_id:stim.id,video_started_at:startedISO,video_ended_at:endedISO,answered_at:answeredISO,trial_ended_at:new Date().toISOString(),media_duration_ms:video.duration*1000,watched_to_end:true,attempt,restarted_after_reload:attempt>1,hidden_ms:hiddenMs,playback_events:events,media_error_count:mediaErrors,screen_width:innerWidth,screen_height:innerHeight,dropped_video_frames:video.getVideoPlaybackQuality?.().droppedVideoFrames??null,fixation_onset_perf_ms:fixationOnset,fixation_offset_perf_ms:fixationOffset,fixation_duration_ms:fixationOffset-fixationOnset,configured_fixation_ms:EXPERIMENT.fixation_ms,playback_rate:video.playbackRate,fullscreen:!!document.fullscreenElement,browser_family:browserFamily(),autoplay_blocked:autoplayBlocked});
    async function commit(){
      if(!clock.complete||committing||finished)return;committing=true;status.textContent=RU.trial.saving;
      savedRow=await saveEvent(`${phase}-${index+1}`,rowData());
      if(isStopped())return;
      if(phase==='practice'){const feedback=$('#practice-feedback');feedback.hidden=false;feedback.innerHTML=text(RU.trial.practiceFeedback,{response:escapeHTML(RU.answers[savedRow.response]),truth:escapeHTML(RU.answers[savedRow.stimulus_type])});}
      status.textContent=RU.trial.saved;next.disabled=false;
    }
    function onset(time,source){if(clock.onset!==null||finished||video.paused)return;clock.start(time,source);startedISO=new Date(performance.timeOrigin+time).toISOString();buttons.forEach(b=>b.disabled=false);status.textContent=RU.trial.answerHint;log('onset');}
    function armFrame(){if(video.requestVideoFrameCallback&&clock.onset===null)frameHandle=video.requestVideoFrameCallback((now,metadata)=>{if(!video.paused)onset(Math.min(metadata.expectedDisplayTime,performance.now()),'video_frame_callback');else if(!finished)armFrame();});}
    async function play(){
      if(video.ended||clock.end!==null)return;
      recovery.hidden=true;
      try{if(frameHandle!==undefined&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(frameHandle);armFrame();await video.play();}
      catch{autoplayBlocked=true;log('autoplay_blocked');status.textContent=RU.trial.blocked;recovery.textContent=RU.buttons.allowPlayback;recovery.hidden=false;}
    }
    recovery.onclick=()=>play();
    next.onclick=()=>{if(!savedRow||!clock.complete||finished)return;const at=performance.now();next.disabled=true;const nav={kind:'navigation',phase,trial_number:index+1,stimulus_id:stim.id,next_clicked_at:new Date().toISOString(),next_elapsed_ms:at-clock.response.response_perf_ms,rt_ms:clock.response.rt_ms};store.partial(nav);cleanup();resolve({...savedRow,...nav});};
    buttons.forEach(b=>b.onclick=()=>{
      const now=performance.now();if(!clock.answer(b.dataset.answer,now,video.currentTime))return;
      answeredISO=new Date(performance.timeOrigin+now).toISOString();buttons.forEach(x=>{x.disabled=true;x.classList.toggle('selected',x===b);});status.textContent=clock.end===null?RU.trial.early:RU.trial.saving;log('response');
      store.partial({kind:'response',phase,trial_number:index+1,stimulus_id:stim.id,...clock.data(),video_started_at:startedISO,answered_at:answeredISO,watched_to_end:false,attempt});commit();
    });
    video.addEventListener('playing',()=>{log('playing');if(!video.requestVideoFrameCallback)onset(performance.now(),'playing_event');});
    video.addEventListener('ended',()=>{if(clock.onset===null){status.textContent=RU.trial.timingError;return;}clock.ended(performance.now());endedISO=new Date().toISOString();log('ended');recovery.hidden=true;status.textContent=clock.response?RU.trial.saving:RU.trial.ended;commit();});
    video.addEventListener('pause',()=>{if(!finished&&!video.ended&&clock.end===null){log('pause');if(!document.hidden){status.textContent=RU.trial.paused;recovery.textContent=RU.buttons.resume;recovery.hidden=false;}}});
    video.addEventListener('waiting',()=>log(clock.onset===null?'initial_decode_wait':'waiting'));video.addEventListener('stalled',()=>log('stalled'));
    video.addEventListener('error',()=>{mediaErrors++;log('media_error');status.textContent=RU.trial.loadError;store.partial({kind:'media_error',phase,trial_number:index+1,stimulus_id:stim.id,attempt});});
    video.addEventListener('ratechange',()=>{if(video.playbackRate!==1){log('rate_change');video.playbackRate=1;}});
    video.addEventListener('timeupdate',()=>{if(!video.seeking)lastStableTime=video.currentTime;});
    video.addEventListener('seeking',()=>{if(!finished&&!correctingSeek){correctingSeek=true;log('seek_blocked');video.currentTime=lastStableTime;}});
    video.addEventListener('seeked',()=>{correctingSeek=false;});
    video.addEventListener('contextmenu',e=>e.preventDefault());
    const blur=()=>log('window_blur');window.addEventListener('blur',blur);
    function visibility(){
      if(document.hidden){hiddenStart=performance.now();log('hidden');buttons.forEach(b=>b.disabled=true);if(!video.paused&&!video.ended){readyToResume=true;video.pause();}}
      else{if(hiddenStart!==null){hiddenMs+=performance.now()-hiddenStart;hiddenStart=null;}log('visible');if(readyToResume){readyToResume=false;play();}if(clock.onset!==null&&!clock.response)buttons.forEach(b=>b.disabled=false);}
    }
    document.addEventListener('visibilitychange',visibility);
    play();
  });
}
async function screenRetry(message,label){return new Promise(resolve=>{show(`<p class="error">${escapeHTML(message)}</p>${button(label,'id="load-retry"')}`,'loading');$('#load-retry').onclick=resolve;});}
