import {RU} from '../content/ru.js?v=0.3.0';
import {EXPERIMENT} from '../config/experiment.js?v=0.3.0';
import {VERSION,shuffle,validateEvent,hash} from '../study-core.js?v=0.3.0';
import {buildCSVExports,csv,resultFilenames} from '../results.js?v=0.3.0';
const KEY='pedfe-session-v3';
export class BrowserStore {
  constructor({storage=globalThis.localStorage,pipe=globalThis.DataPipe,fetcher=globalThis.fetch}={}){
    this.provider='datapipe';this.storage=storage;this.pipe=pipe;this.fetcher=fetcher.bind(globalThis);this.stream=null;
    try{this.session=JSON.parse(storage.getItem(KEY)||'null');}catch{throw Error(RU.errors.storage);}
    this.test=new URL(globalThis.location?.href||'http://localhost').searchParams.get('test')==='1';
  }
  persist(){try{this.storage.setItem(KEY,JSON.stringify(this.session));}catch{throw Error(RU.errors.storage);}}
  experimentID(){return this.session?.is_test?EXPERIMENT.datapipe.test_experiment_id:EXPERIMENT.datapipe.experiment_id;}
  startStream(){
    if(this.stream||!this.session||!['active','submitting'].includes(this.session.status)||!EXPERIMENT.datapipe.streaming||!this.experimentID()||!this.pipe)return;
    this.stream=this.pipe.createSession({experiment_id:this.experimentID(),filename:this.session.filename});
    const activeStream=this.stream;Promise.resolve(activeStream.ready?.()).then(()=>{if(this.stream===activeStream){this.session.streaming_enabled=activeStream.enabled===true;this.persist();}}).catch(()=>{});
    // On a resumed page, replay the local journal into this new staging session.
    for(const row of Object.values(this.session.events||{}))this.stream.record(row);
    this.stream.record({kind:'session',session_id:this.session.session_id,participant_id:this.session.participant_id,condition:this.session.condition,is_test:this.session.is_test,status:'active',study_version:VERSION});
  }
  async manifest(){
    if(this.manifestData)return this.manifestData;
    const res=await this.fetcher(new URL('../stimuli/manifest.json',import.meta.url));if(!res.ok)throw Error(RU.errors.manifest);
    const m=await res.json();if(m.main.length!==48||m.practice.length!==4||new Set([...m.main,...m.practice].map(x=>x.id)).size!==52)throw Error(RU.errors.manifest);
    this.manifestData=m;return m;
  }
  async call(path,data){
    if(path==='config')return {mode:'production',media_mode:'pedfe',require_invite:false};
    if(path==='session'&&data===undefined){if(!this.session||this.session.status==='withdrawn')return {active:false};this.startStream();return this.publicSession();}
    if(path==='session'){
      if(!data?.consent||!data.adult)throw Error(RU.server.message_27);
      if(Date.now()>=Date.parse(EXPERIMENT.retention_until))throw Error(RU.errors.expired);
      if(!this.pipe||!((this.test?EXPERIMENT.datapipe.test_experiment_id:EXPERIMENT.datapipe.experiment_id)))throw Error(RU.saving.notConfigured);
      const id=data.participant_id||'P'+crypto.randomUUID().replaceAll('-','').slice(0,12).toUpperCase();if(!/^[A-Za-z0-9_-]{6,32}$/.test(id))throw Error(RU.errors.invalidId);
      const m=await this.manifest(),sid=crypto.randomUUID();
      const forced=this.test?new URL(location.href).searchParams.get('condition'):null;
      const condition=['high_power','no_power'].includes(forced)?forced:(crypto.getRandomValues(new Uint8Array(1))[0]<128?'high_power':'no_power');
      this.session={session_id:sid,participant_id:id,condition,assignment_method:forced?'test_only_forced':'crypto_bernoulli_p_0.5',started_at:new Date().toISOString(),status:'active',consent:true,adult:true,consent_version:VERSION,study_version:VERSION,procedure_version:VERSION,
        retention_until:EXPERIMENT.retention_until,purpose:'educational',manifest_version:m.version,main:shuffle(m.main),practice:shuffle(m.practice),events:{},journal:[],is_test:this.test,media_mode:'pedfe',run_mode:this.test?'test':'production'};
      this.session.filename=resultFilenames(this.session).trials;
      this.persist();this.startStream();return this.publicSession();
    }
    if(!this.session)throw Error(RU.errors.sessionExpired);
    if(path==='event'){
      if(this.session.status!=='active')throw Error(RU.server.message_38);
      const digest=await hash(JSON.stringify(data.data));const existing=this.session.events[data.key];
      if(existing){if(existing.payload_hash!==digest)throw Error(RU.server.message_40);return {saved:true,row:existing};}
      const row=validateEvent(data.key,data.data,this.session,this.session.events);row.payload_hash=digest;row.is_test=this.session.is_test;
      this.session.events[data.key]=row;this.persist();this.startStream();this.stream?.record(row);return {saved:true,row};
    }
    if(path==='complete'){
      if(data.allow_use!==true||!this.session.events.role||!this.session.events.final_survey||['main','practice'].some(phase=>this.session[phase].some((_,i)=>!this.session.events[phase+'-'+(i+1)])))throw Error(RU.server.message_41);
      if(!this.session.submissions){
        const rows=Object.values(this.session.events),main=rows.filter(r=>r.phase==='main');const correct=main.reduce((sum,r)=>sum+r.correct,0);
        this.session.summary={n_main:main.length,n_correct:correct,accuracy_percent:correct/48*100};
        this.session.completed_at=new Date().toISOString();this.session.allow_use_after_debrief=true;this.session.status='submitting';
        this.session.submissions=buildCSVExports({...this.session,status:'complete'},this.session.events,this.session.journal);this.session.submission_receipts={};this.persist();
      }
      // The participant CSV is the completion marker and is sent only after trials.
      // Persist each receipt so retrying a failed second file never resends the first.
      this.startStream();
      for(const submission of this.session.submissions){
        if(this.session.submission_receipts[submission.filename])continue;
        this.session.submission_receipts[submission.filename]=await this.submit(submission,{final:submission.kind==='participant'});this.persist();
      }
      await this.stream?.close({submitted:true});this.stream=null;
      const result={confirmed:true,queued:Object.values(this.session.submission_receipts).some(r=>r.queued),files:this.session.submission_receipts};
      this.session.status='complete';this.session.delivery=result;this.persist();return {saved:true,receipt:result.queued?RU.saving.queued:RU.complete.receipt,summary:this.session.summary};
    }
    if(path==='withdraw'){
      const payload={study_version:VERSION,session_id:this.session.session_id,participant_id:this.session.participant_id,is_test:this.session.is_test,status:'withdrawn',allow_use_after_debrief:false,withdrawn_at:new Date().toISOString()};
      await this.submit({filename:(this.session.is_test?'TEST_':'')+'withdrawal_'+this.session.session_id+'.csv',data:csv([payload])},{final:true});
      await this.stream?.close({submitted:true});this.stream=null;
      this.session.status='withdrawn';this.session.events={};this.session.journal=[];this.session.submissions=null;this.persist();return {deleted:false,withdrawn:true};
    }
    if(path==='new-test'){if(!this.session.is_test)throw Error(RU.server.message_37);this.storage.removeItem(KEY);this.session=null;return {reset:true};}
    throw Error(RU.errors.generic);
  }
  publicSession(){return {...this.session,active:true};}
  mediaURL(stim){return new URL('../stimuli/'+stim.web_filename,import.meta.url).href;}
  async partial(row){if(!this.session||this.session.status!=='active')return;this.session.pending_trial=row;this.session.journal.push({...row,recorded_at:new Date().toISOString()});this.persist();this.startStream();this.stream?.record({...row,kind:'technical_checkpoint',is_test:this.session.is_test,session_id:this.session.session_id});}
  exportURL(kind){const submission=(this.session.submissions||buildCSVExports(this.session,this.session.events,this.session.journal)).find(file=>file.kind===kind);return URL.createObjectURL(new Blob([submission.data],{type:'text/csv;charset=utf-8'}));}
  async submit(submission,{final=false}={}){
    this.session.submission_attempts??={};const priorAttempt=this.session.submission_attempts[submission.filename]===true;this.session.submission_attempts[submission.filename]=true;this.persist();
    const result=await this.pipe.saveData({experiment_id:this.experimentID(),filename:submission.filename,data:submission.data,session:final?this.stream:undefined});
    // A stable UUID filename and immutable payload make a retry safe. A duplicate
    // after an ambiguous network failure is handled explicitly, never overwritten.
    if(!result.ok){
      const duplicate=['FILE_EXISTS','OSF_FILE_EXISTS'].includes(result.body?.error);
      if(!(duplicate&&priorAttempt))throw Error(RU.errors.generic+' '+(result.body?.error||'HTTP '+result.status));
    }
    return {confirmed:true,queued:result.status===202,duplicate:!result.ok,filename:submission.filename,status:result.status};
  }
}
