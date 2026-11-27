import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const html=await fs.readFile(new URL('../csv-converter.html',import.meta.url),'utf8');
const core=vm.runInNewContext(html.match(/<script id="csv-core">([\s\S]*?)<\/script>/)[1]+';CSVFlat',{TextEncoder,TextDecoder,Uint8Array,DataView});
function input(name,rows,delimiter=','){return {name,text:core.toCSV(rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value!==null&&typeof value==='object'?JSON.stringify(value):value]))),delimiter)};}
function fixture(sid='session-1',id='PART_01',condition='high_power'){
 const base={participant_id:id,session_id:sid,condition,is_test:false,study_version:'0.3.0'};
 const trial=(phase,n)=>({...base,phase,trial_number:n,stimulus_id:phase+'-'+n,stimulus_filename:'clip_'+n+'.avi',emotion:'Happiness',stimulus_type:n%2?'genuine':'posed',response:'genuine',correct:n%2,media_duration_ms:2300,rt_ms:'1234.5678901234567',response_before_end:true,response_after_end_ms:0,watched_to_end:true,quality_flag:false,playback_events:[{event:'playing',perf_ms:100},{event:'response',perf_ms:1334.5678901234567}]});
 const main=[1,2,3].map(n=>trial('main',n)),practice=[1,2].map(n=>trial('practice',n));
 const participant={...base,consent:true,adult:true,status:'complete',perceived_social_power:6,emotion_recognition_ease:4,role_consideration:3,accuracy_percent:'66.66666666666667',n_correct:2,main_order:main.map(r=>r.stimulus_id),practice_order:practice.map(r=>r.stimulus_id),instruction_log:[{event_key:'role_instruction',acknowledged:true}],practice_trials:practice,technical_journal:[{kind:'navigation',phase:'main',trial_number:1,next_clicked_at:'2026-11-27T10:00:00Z'},{kind:'response',phase:'practice',trial_number:2,rt_ms:1234.5678901234567}]};
 return {main,practice,participant,files:[input('trials_'+id+'.csv',main),input('participant_'+id+'.csv',[participant])]};
}
test('CSV parsing handles BOM, quoted commas, quotes, embedded CRLF and all supported delimiters',()=>{
 for(const delimiter of [',',';','\t']){const row={code:'ID_1',text:'Анна, "эксперт"\r\nМихаил',number:'-12.50'};const parsed=core.parseCSV(core.toCSV([row],delimiter));assert.equal(parsed.delimiter,delimiter);assert.equal(parsed.rows[0].text,row.text);assert.equal(parsed.rows[0].number,row.number);}
 assert.equal(core.parseCSV('sep=;\r\ncode;value\r\nx;3').rows[0].value,'3');
});
test('Malformed CSV or damaged nested data fails explicitly',()=>{
 for(const text of ['a,b\n"unfinished','a,b\n1,2,3','a,a\n1,2'])assert.throws(()=>core.parseCSV(text));
 assert.throws(()=>core.convertFiles([input('bad.csv',[{participant_id:'P',status:'complete',practice_trials:'[{broken]'}])]));
});
test('One participant gets one CSV with repeated metadata and practice before main trials',()=>{
 const f=fixture(),result=core.convertFiles(f.files);assert.equal(result.sessions.length,1);const s=result.sessions[0];assert.equal(s.rows.length,5);assert.equal(s.main,3);assert.equal(s.practice,2);
 assert.equal(s.rows.map(r=>r.phase).join(','),'practice,practice,main,main,main');
 for(const row of s.rows){assert.equal(row.consent,'true');assert.equal(row.adult,'true');assert.equal(row.perceived_social_power,'6');assert.equal(row.emotion_recognition_ease,'4');assert.equal(row.role_consideration,'3');assert.equal(row.reaction_time_ms,'1234.5678901234567');assert.equal(row['instruction_log.1.acknowledged'],true);assert.equal(row['main_order.3'],'main-3');assert.equal(row['playback_events.1.event'],'playing');assert.equal(row['playback_events.count'],2);for(const v of Object.values(row))assert.ok(v===null||typeof v!=='object');}
 assert.equal(s.rows[0].phase_label,'Тренировка');assert.equal(s.rows[2].phase_label,'Основная проба');
 assert.equal(s.rows[2]['technical_journal.1.original_index'],1);assert.equal(s.rows[2]['technical_journal.1.data.kind'],'navigation');assert.equal(s.rows[1]['technical_journal.1.data.kind'],'response');assert.equal(s.rows[0]['technical_journal.1.data.kind'],'');
 assert.ok(s.columns.indexOf('reaction_time_ms')<s.columns.indexOf('playback_events.1.event'));
});
test('Twelve input files produce six isolated participant CSVs, each with identical headers',()=>{
 const fixtures=Array.from({length:6},(_,i)=>fixture('s'+i,'P'+i,i%2?'no_power':'high_power'));
 fixtures[1].main[0].playback_events.push({event:'ended',perf_ms:2400});fixtures[1].files[0]=input('trials_P1.csv',fixtures[1].main);
 const r=core.convertFiles(fixtures.flatMap(f=>f.files));assert.equal(r.sessions.length,6);assert.equal(r.counts.files,12);assert.equal(r.counts.main,18);
 assert.equal(new Set(r.sessions.map(s=>s.filename)).size,6);
 for(const s of r.sessions){assert.equal(s.rows.length,5);for(const row of s.rows){assert.equal(row.participant_id,s.participant_id);assert.equal(row.session_id,s.session_id);}assert.equal(Object.keys(s.rows[0]).join('\n'),r.columns.join('\n'));assert.equal(s.rows[0]['playback_events.3.event'],'');}
 assert.equal(r.sessions[1].rows[2]['playback_events.3.event'],'ended');
});
test('Participant-only input keeps practice data and never fabricates main answers from main_order',()=>{
 const r=core.convertFiles([fixture().files[1]]);assert.equal(r.sessions.length,1);assert.equal(r.sessions[0].rows.length,2);assert.equal(r.counts.main,0);assert.ok(r.sessions[0].notes.some(s=>s.includes('trials_')));
});
test('Trials-only input retains all trials without inventing consent or final ratings',()=>{
 const r=core.convertFiles([fixture().files[0]]);assert.equal(r.sessions[0].rows.length,3);assert.equal(r.counts.sessions,1);assert.ok(r.sessions[0].notes.some(s=>s.includes('participant_')));assert.equal(r.sessions[0].rows[0].consent,undefined);
});
test('Repeated participant IDs with different session IDs receive different files',()=>{
 const a=fixture('s1','SAME_ID'),b=fixture('s2','SAME_ID','no_power');b.participant.perceived_social_power=1;b.files[1]=input('participant_b.csv',[b.participant]);const r=core.convertFiles([...a.files,...b.files]);assert.equal(r.sessions.length,2);for(const s of r.sessions)for(const row of s.rows)assert.equal(row.perceived_social_power,s.session_id==='s1'?'6':'1');assert.notEqual(r.sessions[0].filename,r.sessions[1].filename);
});
test('Identical repeated inputs are deduplicated but conflicting trial versions are rejected',()=>{
 const f=fixture(),r=core.convertFiles([...f.files,...f.files]);assert.equal(r.sessions.length,1);assert.equal(r.sessions[0].rows.length,5);assert.ok(r.notes.length);
 assert.throws(()=>core.convertFiles([...f.files,input('changed.csv',[{...f.main[0],rt_ms:99}])]));
});
test('Every nested object and array is expanded into scalar cells within the same participant file',()=>{
 const f=fixture();f.participant.additional={nested:{value:'a,b'},list:[{name:'x',values:[10,20]},{name:'y',values:[]}]};f.files[1]=input('participant.csv',[f.participant]);const r=core.convertFiles(f.files),row=r.sessions[0].rows[0];assert.equal(row['additional.nested.value'],'a,b');assert.equal(row['additional.list.1.values.2'],20);assert.equal(row['additional.list.2.values.count'],0);for(const row of r.sessions[0].rows)for(const v of Object.values(row))assert.notEqual(typeof v,'object');
});
test('Unmatched technical journal entries remain in columns in the same CSV',()=>{
 const f=fixture();f.participant.technical_journal.push({kind:'page_hidden',recorded_at:'2026-11-27T10:00:00Z'},{kind:'response',phase:'main',trial_number:99,rt_ms:30});f.files[1]=input('participant.csv',[f.participant]);const r=core.convertFiles(f.files);for(const row of r.sessions[0].rows){assert.equal(row['session_technical_journal.1.original_index'],3);assert.equal(row['session_technical_journal.1.data.kind'],'page_hidden');assert.equal(row['session_technical_journal.2.data.trial_number'],99);assert.equal(row.technical_journal_total_count,4);}
});
test('No answers, scores, RT values, statuses or test markers are recalculated or filtered',()=>{
 const f=fixture();f.participant.is_test=true;f.participant.status='withdrawn';f.files=[input('trials.csv',f.main.map(r=>({...r,is_test:true}))),input('participant.csv',[{...f.participant,practice_trials:f.practice.map(r=>({...r,is_test:true}))}])];const r=core.convertFiles(f.files);assert.equal(r.sessions[0].rows.length,5);for(const row of r.sessions[0].rows){assert.equal(row.status,'withdrawn');assert.equal(String(row.is_test),'true');assert.equal(row.accuracy_percent,'66.66666666666667');}for(const original of f.main){const row=r.sessions[0].rows.find(r=>r.phase==='main'&&String(r.trial_number)===String(original.trial_number));for(const [k,v] of Object.entries(original))if(k!=='playback_events'&&k!=='is_test')assert.equal(String(row[k]),String(v),k);}
});
test('Shared-field conflicts preserve both original values rather than overwriting either',()=>{
 const f=fixture();f.participant.received_at='participant-time';f.files[1]=input('participant.csv',[f.participant]);f.files[0]=input('trials.csv',f.main.map(r=>({...r,received_at:'trial-time'})));const r=core.convertFiles(f.files);const row=r.sessions[0].rows.find(r=>r.phase==='main');assert.equal(row.received_at,'trial-time');assert.equal(row['participant.received_at'],'participant-time');
});
test('A trial from another session or condition cannot be silently merged',()=>{
 const f=fixture();assert.throws(()=>core.convertFiles([input('trials.csv',f.main.map(r=>({...r,condition:'no_power'}))),f.files[1]]));f.participant.practice_trials[0].session_id='another';assert.throws(()=>core.convertFiles([f.files[0],input('participant.csv',[f.participant])]));
});
test('UTF-8, UTF-16 and spreadsheet-safe exports preserve negative numbers and literal text',()=>{
 const text='код,ответ\r\nА,Б';assert.equal(core.decodeBytes(new TextEncoder().encode(text)).text,text);const u16=new Uint8Array(2+text.length*2);u16.set([255,254]);for(let i=0;i<text.length;i++){u16[2+i*2]=text.charCodeAt(i)&255;u16[3+i*2]=text.charCodeAt(i)>>>8;}assert.equal(core.decodeBytes(u16).text,text);
 const row=core.parseCSV(core.toCSV([{formula:'=1+2',number:-5,html:'<img src=x onerror=alert(1)>'}])).rows[0];assert.equal(row.formula,"'=1+2");assert.equal(row.number,'-5');assert.equal(row.html,'<img src=x onerror=alert(1)>');
});
test('ZIP contains exactly one CSV per participant, independently readable by Python',async()=>{
 const a=fixture(),b=fixture('s2','P2'),r=core.convertFiles([...a.files,...b.files]),dir=await fs.mkdtemp(path.join(os.tmpdir(),'csv-participants-')),file=path.join(dir,'out.zip');
 try{await fs.writeFile(file,core.zipStore(r.sessions.map(s=>({name:s.filename,text:core.toCSV(s.rows,';')}))));const output=execFileSync('python3',['-c','import zipfile,sys,csv,io; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert len(z.namelist())==2; ids=set(); headers=[]\nfor name in z.namelist():\n rows=list(csv.DictReader(io.StringIO(z.read(name).decode("utf-8-sig")),delimiter=";")); assert len(rows)==5; assert len({r["participant_id"] for r in rows})==1; ids.add(rows[0]["participant_id"]); headers.append(list(rows[0])); assert all(None not in r for r in rows)\nassert len(ids)==2; assert headers[0]==headers[1]; print("ok")',file],{encoding:'utf8'});assert.equal(output.trim(),'ok');}finally{await fs.rm(dir,{recursive:true});}
});
