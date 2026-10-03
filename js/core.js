'use strict';
/* Core: shared state, helpers and the action registry used by every module.
   All user/imported text must go through esc() before reaching innerHTML,
   and dynamic values reach handlers through data-* attributes only. */

const VENDOR = Object.freeze({
  jspdf: { src: 'vendor/jspdf.umd.min.js', integrity: 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk' },
  sqljs: { src: 'vendor/sql-wasm.js', integrity: 'sha384-DJiKBv+LC78e5InEB+MvFIAH079ynMK/ERTtFUCpDzXhH1Bht7aVfpg3yOVsuYl9' },
  sqlWasm: 'vendor/sql-wasm.wasm'
});

// Legacy localStorage keys used by older versions (cleaned up on login/logout).
const KEY = 'ramez_sim_manager_v2';

function defaultState(){
  return {
    companies:[{id:1,name:'سكاي',price:45},{id:2,name:'ليان',price:50},{id:3,name:'أرين',price:40},{id:4,name:'الوها',price:45}],
    sims:[], customerPayments:[], customerProfiles:{}, users:[{id:1,name:'رامز',role:'مدير'}], currentUserId:1,
    settings:{storeName:'إدارة مبيعات الشرائح',storeWhatsApp:'',autoLock:0,darkMode:false,waRenewTpl:'',waStatementTpl:'',waWelcomeTpl:''},
    expenses:[], activity:[], invoiceSeq:1, skyRenewals:[],
    debtLedger:{customers:[],transactions:[],currencies:[{id:0,name:'شيكل'},{id:1,name:'دولار'},{id:2,name:'سعودي'}],imported:false}
  };
}

let period = 'all';
// In-memory state of the signed-in employee. Loaded from Supabase after login.
let data = defaultState();

function normalize(){
  if(!data || typeof data!=='object' || Array.isArray(data)) data = defaultState();
  data.companies ||= [];
  data.sims ||= [];
  data.customerPayments ||= []; data.customerProfiles ||= {}; data.users ||= [{id:1,name:'رامز',role:'مدير'}]; data.currentUserId ||= 1;
  data.settings ||= {storeName:'إدارة مبيعات الشرائح',storeWhatsApp:'',autoLock:0,darkMode:false,waRenewTpl:'',waStatementTpl:'',waWelcomeTpl:''};
  // The old PIN was stored in plain text and synced to the cloud: remove it.
  if('pin' in data.settings) delete data.settings.pin;
  data.expenses ||= []; data.activity ||= []; data.invoiceSeq ||= 1; data.skyRenewals ||= [];
  data.debtLedger ||= {customers:[],transactions:[],currencies:[{id:0,name:'شيكل'},{id:1,name:'دولار'},{id:2,name:'سعودي'}],imported:false};
  data.sims.forEach(s=>{
    s.wholesale=Number(s.wholesale||0); s.salePrice=Number(s.salePrice||0); s.companyId=Number(s.companyId||0); s.notes=s.notes||''; s.nextRenewal=s.nextRenewal||''; s.status=s.status||'available'; s.history=Array.isArray(s.history)?s.history:[];
    s.phone=String(s.phone??'');
    if(!s.history.length && s.status==='sold' && s.soldAt) s.history.push({type:'بيع',price:s.salePrice,wholesale:s.wholesale,date:s.soldAt});
  });
}

// Every mutation goes through save(): mark the change for sync and re-render.
function save(){
  if(typeof Sync!=='undefined') Sync.markChanged();
  applyTheme();
  renderAll();
}

function money(n){return '₪'+Number(n||0).toLocaleString('he-IL',{minimumFractionDigits:2,maximumFractionDigits:2})}
function companyName(id){return data.companies.find(c=>c.id==id)?.name||'-'}
// HTML-escape for text and double-quoted attribute contexts.
function esc(s){return String(s??'').replace(/[&<>"'`]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;','`':'&#096;'}[m]))}
function nowDate(){return new Date().toISOString()}

// Only raster data URLs produced by the logo resizer, or the bundled logos.
function safeImageSrc(src){
  const s=String(src||'');
  if(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s)) return s;
  if(/^logos\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(s)) return s;
  return '';
}

// JSON that is safe to embed inside a <script type="application/json"> block.
function jsonForScript(v){
  return JSON.stringify(v).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
}

function appUrl(path){ return new URL(path, document.baseURI).href; }

const _scriptLoads = new Map();
function loadVendorScript(spec){
  if(_scriptLoads.has(spec.src)) return _scriptLoads.get(spec.src);
  const p=new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src=spec.src; s.async=true;
    if(spec.integrity) s.integrity=spec.integrity;
    s.onload=()=>resolve();
    s.onerror=()=>{_scriptLoads.delete(spec.src);reject(new Error('تعذر تحميل '+spec.src));};
    document.head.appendChild(s);
  });
  _scriptLoads.set(spec.src,p);
  return p;
}

function inPeriod(date){
 if(!date)return false; let d=new Date(date), now=new Date();
 if(period==='all')return true;
 if(period==='today')return d.toDateString()===now.toDateString();
 if(period==='month')return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth();
 let f=document.getElementById('fromDate')?.value,t=document.getElementById('toDate')?.value;
 if(f&&d<new Date(f+'T00:00:00'))return false;
 if(t&&d>new Date(t+'T23:59:59'))return false;
 return true;
}
function allOps(){
 let a=[];data.sims.forEach(s=>(s.history||[]).forEach((h,i)=>a.push({...h,simId:s.id,phone:s.phone,companyId:s.companyId,opIndex:i})));return a;
}
function ops(){return allOps().filter(o=>inPeriod(o.date))}
function opNet(o){return Math.max(0,Number(o.price||0)-Number(o.discount||0))}
function opProfit(o){return opNet(o)-Number(o.wholesale||0)-Number(o.expense||0)}

// Operator name = the signed-in account (no more local "users" switching).
function currentUser(){
  if(typeof Auth!=='undefined' && Auth.user){
    return {name: Auth.profile?.full_name || Auth.profile?.email || Auth.user.email || 'مستخدم', role: Auth.profile?.role || 'employee'};
  }
  return (data.users||[]).find(u=>u.id==data.currentUserId)||(data.users||[])[0]||{name:'رامز',role:'مدير'};
}
function logActivity(text,type='عام'){data.activity=data.activity||[];data.activity.unshift({id:Date.now()+Math.random(),date:nowDate(),user:currentUser().name,type,text});data.activity=data.activity.slice(0,200)}

function notify(msg){let t=document.getElementById('toast');if(!t)return;t.textContent=msg;t.style.display='block';clearTimeout(notify._t);notify._t=setTimeout(()=>t.style.display='none',2500)}

// ---- action registry (filled by modules, dispatched in ui.js) ----
const ACTIONS = Object.create(null);
function registerActions(map){ for(const k of Object.keys(map)) ACTIONS[k]=map[k]; }
