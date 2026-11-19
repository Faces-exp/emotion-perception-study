import {ENVIRONMENT} from '../config/environment.js';
export async function createStore(){
  if(ENVIRONMENT==='pages'){const {BrowserStore}=await import('./pages.js');return new BrowserStore();}
  const {LocalStore}=await import('./local.js');return new LocalStore();
}
