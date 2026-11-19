import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {workerSource} from './worker-bundle.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assets={};
// Explicit allowlist: private/, results/, the metadata and real clips never enter the build.
for(const [route,file,type] of [['/','index.html','text/html; charset=utf-8'],['/style.css','style.css','text/css; charset=utf-8'],['/app.js','app.js','text/javascript; charset=utf-8'],['/timing.js','timing.js','text/javascript; charset=utf-8'],['/vendor/jspsych.js','vendor/jspsych.js','text/javascript; charset=utf-8'],['/vendor/LICENSE-jsPsych.txt','vendor/LICENSE-jsPsych.txt','text/plain; charset=utf-8'],['/demo.mp4','demo.mp4','video/mp4']]){
  const data=await fs.readFile(path.join(root,'web',file));assets[route]={base64:data.toString('base64'),type,size:data.length};
}
const worker=await workerSource(assets);
await fs.mkdir(path.join(root,'dist/server'),{recursive:true});await fs.mkdir(path.join(root,'dist/.openai'),{recursive:true});
await fs.writeFile(path.join(root,'dist/server/index.js'),worker);
await fs.copyFile(path.join(root,'.openai/hosting.json'),path.join(root,'dist/.openai/hosting.json'));
const module=await import('data:text/javascript;base64,'+Buffer.from(worker).toString('base64'));
if(typeof module.default.fetch!=='function')throw Error('Missing worker entry');
console.log('Demo-only Worker built. No participant records or PEDFE media included.');
