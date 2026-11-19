import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await fs.readFile(path.join(root,'private/manifest.json'),'utf8'));
const out=path.join(root,'web/stimuli');await fs.mkdir(out,{recursive:true});
async function prepare(stim){
  const bytes=await fs.readFile(path.join(root,'private/media',stim.web_filename));
  if(createHash('sha256').update(bytes).digest('hex')!==stim.web_sha256)throw Error('Video integrity check failed: '+stim.id);
  const web_filename=stim.id+'.mp4';await fs.writeFile(path.join(out,web_filename),bytes);
  const allowed=['id','filename','type','emotion','subject','gender','source_row','source_sha256','web_sha256','duration_ms','frames','width','height','audio'];
  return {...Object.fromEntries(allowed.map(key=>[key,stim[key]])),web_filename};
}
const main=[];for(const s of manifest.main)main.push(await prepare(s));const practice=[];for(const s of manifest.practice)practice.push(await prepare(s));
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({version:manifest.version,seed:manifest.seed,source_project:'https://osf.io/cynsx/',license:'CC0-1.0',main,practice},null,2));
let index=await fs.readFile(path.join(root,'web/index.html'),'utf8');index=index.replace('data-transport="local"','data-transport="pages"').replace('<head>','<head><base href="./web/">');
await fs.writeFile(path.join(root,'index.html'),index);await fs.writeFile(path.join(root,'.nojekyll'),'');
console.log('Prepared the existing 48 main and 4 practice clips for GitHub Pages. No results or private configuration copied.');
