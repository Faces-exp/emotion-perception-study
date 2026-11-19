export class VideoClock {
  constructor(){this.onset=null;this.end=null;this.response=null;this.source=null;}
  start(time,source){if(this.onset===null){this.onset=time;this.source=source;}}
  answer(type,time,position){
    if(this.onset===null||this.response!==null||time<this.onset)return false;
    this.response={response:type,rt_ms:time-this.onset,response_perf_ms:time,
      response_video_time_ms:position*1000,response_before_end:this.end===null,
      response_phase:this.end===null?'during_video':'after_video'};return true;
  }
  ended(time){if(this.end===null)this.end=time;}
  get complete(){return this.end!==null&&this.response!==null;}
  data(){return {...this.response,onset_perf_ms:this.onset,onset_source:this.source,
    ended_perf_ms:this.end,video_end_elapsed_ms:this.end===null?null:this.end-this.onset,
    response_after_end_ms:this.response&&this.end!==null?Math.max(0,this.response.response_perf_ms-this.end):null};}
}
