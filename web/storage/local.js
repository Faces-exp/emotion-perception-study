import {RU} from '../content/ru.js';
export class LocalStore {
  constructor(){this.provider='local';}
  async call(path,data){
    const res=await fetch(new URL('../../api/'+path,import.meta.url),{method:data===undefined?'GET':'POST',credentials:'same-origin',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(18000)});
    const value=await res.json();if(!res.ok)throw Error(value.error||RU.errors.generic);return value;
  }
  mediaURL(stim){return new URL('../../media/'+stim.id+'.mp4',import.meta.url).href;}
  async partial(row){try{await this.call('checkpoint',row);}catch{};}
  exportURL(format){return new URL('../../api/export'+(format==='csv'?'?format=csv&phase=main':''),import.meta.url).href;}
}
