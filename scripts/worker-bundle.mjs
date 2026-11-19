import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url);
export async function workerSource(assets={}){
  const ru=await fs.readFile(new URL('web/content/ru.js',root),'utf8');
  const settings=await fs.readFile(new URL('web/config/experiment.js',root),'utf8');
  const results=await fs.readFile(new URL('web/results.js',root),'utf8');
  const core=(await fs.readFile(new URL('web/study-core.js',root),'utf8')).replace(/^import .*;\n/gm,'').replace('export {csv};','');
  const entry=(await fs.readFile(new URL('server/worker.mjs',root),'utf8')).replace(/^import .*;\n/gm,'');
  return 'const ASSETS='+JSON.stringify(assets)+';\n'+ru+'\n'+settings+'\n'+results+'\n'+core+'\n'+entry;
}
