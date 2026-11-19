import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {handle,demoManifest,purgeExpired} from './core.mjs';
import {RU} from '../web/content/ru.js';
import {EXPERIMENT} from '../web/config/experiment.js';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PORT=Number(process.env.PORT||8787),HOST=process.env.HOST||'127.0.0.1';
let custom={};try{custom=JSON.parse(await fs.readFile(path.join(ROOT,'private/config.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const config={mode:'pilot',media_mode:process.env.DEMO==='1'?'demo':'pedfe',contact:EXPERIMENT.contacts.join(', '),retention:RU.welcome.retention,retention_until:EXPERIMENT.retention_until,purpose:RU.welcome.purpose,storage_description:RU.welcome.storageLocal,...custom};
if(HOST!=='127.0.0.1'&&HOST!=='localhost'&&config.mode!=='production')throw Error('External access requires reviewed production config. Local pilot binds to loopback only.');
if(config.mode==='production'&&!process.env.PUBLIC_ORIGIN?.startsWith('https://'))throw Error('Set PUBLIC_ORIGIN to your HTTPS origin before production.');
const manifest=config.media_mode==='demo'?demoManifest():JSON.parse(await fs.readFile(path.join(ROOT,'private/manifest.json'),'utf8'));
await fs.mkdir(path.join(ROOT,'results'),{recursive:true,mode:0o700});
const db=new DatabaseSync(process.env.RESULTS_DB||path.join(ROOT,'results/study.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
const store={
  async get(key){const row=db.prepare('SELECT value FROM records WHERE key=?').get(key);return row?JSON.parse(row.value):null;},
  async put(key,value){db.prepare('INSERT INTO records(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));},
  async create(key,value){return db.prepare('INSERT OR IGNORE INTO records(key,value) VALUES(?,?)').run(key,JSON.stringify(value)).changes===1;},
  async delete(key){db.prepare('DELETE FROM records WHERE key=?').run(key);},
  async list(prefix){return db.prepare('SELECT key FROM records WHERE key LIKE ? ORDER BY key').all(prefix+'%').map(r=>r.key);}
};
await purgeExpired(store,Date.now(),config.retention_until);
const cleanupTimer=setInterval(()=>purgeExpired(store,Date.now(),config.retention_until).catch(e=>console.error('Retention cleanup failed:',e.message)),60000);cleanupTimer.unref();
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mp4':'video/mp4'};
async function fileResponse(file,request){
  const bytes=await fs.readFile(file);const headers={'Content-Type':types[path.extname(file)]||'application/octet-stream','Accept-Ranges':'bytes'};
  const range=request.headers.get('range');
  if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);let start=m?.[1]?Number(m[1]):0,end=m?.[2]?Number(m[2]):bytes.length-1;if(m&&!m[1]&&m[2]){start=Math.max(0,bytes.length-Number(m[2]));end=bytes.length-1;}
    if(!m||start>=bytes.length||start>end)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+bytes.length}});
    end=Math.min(end,bytes.length-1);return new Response(bytes.subarray(start,end+1),{status:206,headers:{...headers,'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':String(end-start+1)}});
  }
  return new Response(bytes,{headers:{...headers,'Content-Length':String(bytes.length)}});
}
const paths={'/':'web/index.html','/style.css':'web/style.css','/app.js':'web/app.js','/timing.js':'web/timing.js','/vendor/jspsych.js':'web/vendor/jspsych.js','/vendor/LICENSE-jsPsych.txt':'web/vendor/LICENSE-jsPsych.txt'};
const env={config,manifest,store,log:e=>console.error(e.name,e.message),
  async media(stim,request){return fileResponse(path.join(ROOT,config.media_mode==='demo'?'web/demo.mp4':'private/media/'+stim.web_filename),request);},
  async asset(url,request){
    if(paths[url])return fileResponse(path.join(ROOT,paths[url]),request);
    const target=path.resolve(ROOT,'web','.'+url),base=path.join(ROOT,'web')+path.sep;
    if(!target.startsWith(base)||!['.js','.css','.txt'].includes(path.extname(target)))return new Response(RU.errors.generic,{status:404});
    try{return await fileResponse(target,request);}catch{return new Response(RU.errors.generic,{status:404});}
  }};
const server=http.createServer(async(req,res)=>{
  try{
    let size=0;const chunks=[];for await(const part of req){size+=part.length;if(size>32768){res.writeHead(413);res.end();return;}chunks.push(part);}
    const origin=process.env.PUBLIC_ORIGIN||`http://${req.headers.host}`;
    const request=new Request(new URL(req.url,origin),{method:req.method,headers:req.headers,body:chunks.length?Buffer.concat(chunks):undefined});
    const response=await handle(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){console.error(e.name,e.message);res.writeHead(500,{'Content-Type':'text/plain'});res.end(RU.errors.server);}
});
server.listen(PORT,HOST,()=>console.log(`Study: http://${HOST}:${PORT} (${config.mode}, ${config.media_mode}). Ctrl+C stops the server.`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{clearInterval(cleanupTimer);server.close(()=>{db.close();process.exit(0);});});
