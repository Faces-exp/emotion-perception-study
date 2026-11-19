// Stable analysis fields. Participant wording remains in content/ru.js.
export const SURVEY_FIELDS=['perceived_social_power','emotion_recognition_ease','role_consideration'];
export function csv(rows){
  const keys=[...new Set(rows.flatMap(Object.keys))];
  const cell=x=>{let v=x==null?'':typeof x==='object'?JSON.stringify(x):String(x);if(/^[=+@\-\t\r]/.test(v))v="'"+v;return '"'+v.replaceAll('"','""')+'"';};
  return '\uFEFF'+[keys.map(cell).join(','),...rows.map(row=>keys.map(k=>cell(row[k])).join(','))].join('\r\n');
}
export function resultFilenames(session){
  const suffix=session.participant_id+'_'+session.session_id+'.csv',prefix=session.is_test?'TEST_':'';
  return {trials:prefix+'trials_'+suffix,participant:prefix+'participant_'+suffix};
}
export function resultRows(session,events,journal=[]){
  const all=Object.values(events),main=all.filter(r=>r.phase==='main').sort((a,b)=>a.trial_number-b.trial_number),practice=all.filter(r=>r.phase==='practice').sort((a,b)=>a.trial_number-b.trial_number);
  const role=events.role||{},survey=events.final_survey||{},correct=main.reduce((sum,r)=>sum+r.correct,0);
  const filenames=resultFilenames(session);
  const trials=main.map(r=>{
    const nav=journal.findLast(n=>n.kind==='navigation'&&n.phase==='main'&&n.trial_number===r.trial_number)||{};
    return {participant_id:r.participant_id,condition:r.condition,trial_number:r.trial_number,video_filename:r.stimulus_filename,emotion:r.emotion,authenticity:r.stimulus_type,response:r.response,correct:r.correct,video_duration_ms:r.media_duration_ms,reaction_time_ms:r.rt_ms,response_during_video:r.response_before_end,response_after_end_ms:r.response_after_end_ms,trial_completed_correctly:r.watched_to_end&&!r.quality_flag,
      ...r,next_clicked_at:nav.next_clicked_at||r.next_clicked_at,next_elapsed_ms:nav.next_elapsed_ms??r.next_elapsed_ms,session_status:session.status,participant_filename:filenames.participant};
  });
  const scalarSession=Object.fromEntries(Object.entries(session).filter(([key,value])=>!['events','journal','pending_trial','submission','submissions','submission_receipts','submission_attempts','delivery'].includes(key)&&(value==null||typeof value!=='object')));
  const participant={participant_id:session.participant_id,condition:session.condition,session_id:session.session_id,allocation:role.allocation,allocation_action:role.action,anna_set:role.allocation==='anna_B'?'B':'A',anna_video_count:role.allocation==='anna_B'?16:8,mikhail_set:role.allocation==='anna_B'?'A':'B',mikhail_video_count:role.allocation==='anna_B'?8:16,allocation_rt_ms:role.decision_rt_ms,
    ...Object.fromEntries(SURVEY_FIELDS.map(key=>[key,survey[key]??null])),status:session.status,is_test:session.is_test===true,n_main:main.length,n_correct:correct,accuracy_percent:main.length===48?correct/48*100:null,...scalarSession,
    trials_filename:filenames.trials,participant_filename:filenames.participant,practice_count:practice.length,main_order:session.main.map(r=>r.id),practice_order:session.practice.map(r=>r.id),instruction_log:[events.common_instruction,events.role_instruction],final_survey_recorded_at:survey.received_at,practice_trials:practice,technical_journal:journal};
  return {trials,participant:[participant]};
}
export function buildCSVExports(session,events,journal=[]){
  const names=resultFilenames(session),rows=resultRows(session,events,journal);
  return ['trials','participant'].map(kind=>({kind,filename:names[kind],data:csv(rows[kind])}));
}
