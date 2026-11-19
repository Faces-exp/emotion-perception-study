import {RU} from './content/ru.js';
export const $=selector=>document.querySelector(selector);
export const root=()=>$('#experiment');
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function show(html,mode='information'){document.body.dataset.screen=mode;root().innerHTML=html;window.scrollTo(0,0);}
export function button(label,attrs=''){return `<button type="button" ${attrs}>${escapeHTML(label)}</button>`;}
export function screen(title,body,action=RU.buttons.continue){return new Promise(resolve=>{show(`<h1>${escapeHTML(title)}</h1>${body}<div class="actions">${button(action,'id="screen-next"')}</div>`);$('#screen-next').onclick=()=>resolve({});});}
export const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
export function browserFamily(){const ua=navigator.userAgent;return /Chrome|Chromium|CriOS/.test(ua)?'Chrome':/Safari/.test(ua)?'Safari':/Firefox/.test(ua)?'Firefox':'Other';}
