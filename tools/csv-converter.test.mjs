import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const html=await fs.readFile(new URL('../csv-converter.html',import.meta.url),'utf8');
const source=html.match(/<script id="csv-core">([\s\S]*?)<\/script>/)[1];
const core=vm.runInNewContext(source+';CSVFlat',{TextEncoder,TextDecoder,Uint8Array,DataView});
const table=(result,name)=>result.tables.find(t=>t.name===name)?.rows||[];
function input(name,rows,delimiter=','){return {name,text:core.toCSV(rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value!==null&&typeof value==='object'?JSON.stringify(value):value]))),delimiter)};}
function fixture(sid='session-1',id='PART_01',condition='high_power'){
 const base={participant_id:id,session_id:sid,condition,is_test:false,study_version:'0.3.0'};
 const trial=(phase,n)=>({...base,phase,trial_number:n,stimulus_id:phase+'-'+n,stimulus_filename:'clip_'+n+'.avi',emotion:'Happiness',stimulus_type:n%2?'genuine':'posed',response:'genuine',correct:n%2,media_duration_ms:2300,rt_ms:'1234.5678901234567',response_before_end:true,response_after_end_ms:0,watched_to_end:true,quality_flag:false,playback_events:[{event:'playing',perf_ms:100},{event:'response',perf_ms:1334.5678901234567}]});
 const main=[1,2,3].map(n=>trial('main',n)),practice=[1,2].map(n=>trial('practice',n));
 const participant={...base,status:'complete',perceived_social_power:6,emotion_recognition_ease:4,role_consideration:3,accuracy_percent:'66.66666666666667',n_correct:2,main_order:main.map(r=>r.stimulus_id),practice_order:practice.map(r=>r.stimulus_id),instruction_log:[{event_key:'role_instruction',acknowledged:true}],practice_trials:practice,technical_journal:[{kind:'navigation',phase:'main',trial_number:1,next_clicked_at:'2026-11-27T10:00:00Z'},{kind:'response',phase:'practice',trial_number:2,rt_ms:1234.5678901234567}]};
 return {main,participant,files:[input('trials_'+id+'.csv',main),input('participant_'+id+'.csv',[participant])]};
}
test('CSV parsing handles BOM, quoted commas, quotes, embedded CRLF and three delimiters',()=>{
 for(const delimiter of [',',';','\t']){const row={code:'ID_1',text:'Анна, "эксперт"\r\nМихаил',number:'-12.50'};const text=core.toCSV([row],delimiter);const parsed=core.parseCSV(text);assert.equal(parsed.delimiter,delimiter);assert.equal(parsed.rows[0].text,row.text);assert.equal(parsed.rows[0].number,row.number);}
 assert.equal(core.parseCSV('sep=;\r\ncode;value\r\nx;3').rows[0].value,'3');
});
test('Malformed CSV and damaged nested JSON fail explicitly instead of silently dropping data',()=>{
 assert.throws(()=>core.parseCSV('a,b\n"unfinished'));
 assert.throws(()=>core.parseCSV('a,b\n1,2,3'));
 assert.throws(()=>core.parseCSV('a,a\n1,2'));
 assert.throws(()=>core.convertFiles([input('bad.csv',[{participant_id:'P',status:'complete',practice_trials:'[{broken]'}]) ]));
});
test('Participant and trial CSVs join on session and expand independent lists without a Cartesian product',()=>{
 const f=fixture(),r=core.convertFiles(f.files);
 assert.equal(table(r,'analysis').length,3);assert.equal(table(r,'trials_full').length,3);assert.equal(table(r,'participants').length,1);assert.equal(table(r,'practice').length,2);assert.equal(table(r,'playback_events').length,10);assert.equal(table(r,'technical_journal').length,2);assert.equal(table(r,'orders').length,5);assert.equal(table(r,'instructions').length,1);
 const a=table(r,'analysis')[0];assert.equal(a.perceived_social_power,'6');assert.equal(a.emotion_recognition_ease,'4');assert.equal(a.role_consideration,'3');assert.equal(a.reaction_time_ms,'1234.5678901234567');assert.equal(a.correct,'1');assert.equal(a.condition,'high_power');assert.equal(a.video_filename,'clip_1.avi');
 for(const t of r.tables)for(const row of t.rows)for(const value of Object.values(row))assert.ok(value===null||typeof value!=='object',t.name);
 const parentIDs=new Set(r.tables.flatMap(t=>t.rows.map(row=>row._record_id)));for(const row of table(r,'playback_events'))assert.ok(parentIDs.has(row._parent_record_id));
});
test('A participant file alone never fabricates main answers from main_order',()=>{
 const f=fixture(),r=core.convertFiles([f.files[1]]);assert.equal(table(r,'analysis').length,0);assert.equal(table(r,'practice').length,2);assert.ok(r.notes.some(s=>s.includes('trials_')));
});
test('A trials file alone retains every main trial and explains missing final ratings',()=>{
 const f=fixture(),r=core.convertFiles([f.files[0]]);assert.equal(table(r,'analysis').length,3);assert.equal(table(r,'analysis')[0].perceived_social_power,'');assert.ok(r.notes.length);assert.equal(r.counts.sessions,1);
});
test('Multiple participants with the same participant_id but different session_id stay separate',()=>{
 const a=fixture('s1','SAME_ID','high_power'),b=fixture('s2','SAME_ID','no_power');b.participant.perceived_social_power=1;b.files[1]=input('participant_b.csv',[b.participant]);
 const r=core.convertFiles([...a.files,...b.files]);assert.equal(table(r,'analysis').length,6);for(const row of table(r,'analysis'))assert.equal(row.perceived_social_power,row.session_id==='s1'?'6':'1');
});
test('Identical repeated files are deduplicated while conflicting trial versions are rejected',()=>{
 const f=fixture(),r=core.convertFiles([...f.files,...f.files]);assert.equal(table(r,'analysis').length,3);assert.equal(table(r,'practice').length,2);assert.ok(r.notes.some(s=>s.includes('копии')));
 const changed={...f.main[0],rt_ms:99};assert.throws(()=>core.convertFiles([...f.files,input('different.csv',[changed])]));
});
test('Unrecognized nested objects and arrays become flat linked extra tables',()=>{
 const r=core.convertFiles([input('generic.csv',[{name:'x',object:{first:7,deeper:{last:'a,b'}},list:[{x:1,children:['a','b']},{x:2,children:[]}]}])]);
 assert.equal(table(r,'records')[0]['object.deeper.last'],'a,b');assert.equal(table(r,'extra_list').length,2);assert.equal(table(r,'extra_children').length,2);for(const t of r.tables)for(const row of t.rows)for(const v of Object.values(row))assert.notEqual(typeof v,'object');
});
test('Test and withdrawn records are retained, and no scores or conditions are recalculated',()=>{
 const f=fixture();f.participant.is_test=true;f.participant.status='withdrawn';const rows=f.main.map(r=>({...r,is_test:true}));const r=core.convertFiles([input('trials.csv',rows),input('participant.csv',[f.participant])]);
 assert.equal(table(r,'analysis').length,3);assert.equal(table(r,'analysis')[0].status,'withdrawn');assert.equal(table(r,'analysis')[0].accuracy_percent,'66.66666666666667');assert.ok(r.notes.some(s=>s.includes('тестовые')));
});
test('UTF-8 and UTF-16 input decoding works and spreadsheet formulas are guarded without changing negative numbers',()=>{
 const text='код,ответ\r\nА,Б';assert.equal(core.decodeBytes(new TextEncoder().encode(text)).text,text);
 const u16=new Uint8Array(2+text.length*2);u16.set([255,254]);for(let i=0;i<text.length;i++){u16[2+i*2]=text.charCodeAt(i)&255;u16[3+i*2]=text.charCodeAt(i)>>>8;}assert.equal(core.decodeBytes(u16).text,text);
 const rows=core.parseCSV(core.toCSV([{formula:'=1+2',number:-5,html:'<img src=x onerror=alert(1)>'}])).rows;assert.equal(rows[0].formula,"'=1+2");assert.equal(rows[0].number,'-5');assert.equal(rows[0].html,'<img src=x onerror=alert(1)>');
});
test('The ZIP archive can be read and CRC-checked independently by Python zipfile',async()=>{
 const r=core.convertFiles(fixture().files),files=r.tables.map(t=>({name:t.filename,text:core.toCSV(t.rows)})),dir=await fs.mkdtemp(path.join(os.tmpdir(),'csv-converter-')),file=path.join(dir,'out.zip');
 await fs.writeFile(file,core.zipStore(files));const output=execFileSync('python3',['-c','import zipfile,sys,csv,io; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; rows=list(csv.DictReader(io.StringIO(z.read("analysis.csv").decode("utf-8-sig")))); assert len(rows)==3; print(len(z.namelist()))',file],{encoding:'utf8'});assert.equal(Number(output.trim()),files.length);
 await fs.rm(dir,{recursive:true});
});
