// Local development server + in-memory mock of the Supabase endpoints the app uses.
// Usage:  node tools/dev-server.mjs [port]          (default 8787)
// LOCAL TESTING ONLY. The mock mirrors the production RLS rules (owner-only state,
// admin-only companies/roles) and the save_app_state() conflict logic.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 8787);
const fixtures = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'mock-fixtures.json'), 'utf8'));

const XSS = {
  img: '<img src=x onerror="window.__xss=(window.__xss||0)+1">',
  js: "x');window.__xss=(window.__xss||0)+1;//",
  svg: '"><svg onload="window.__xss=(window.__xss||0)+1">',
  attr: '" onmouseover="window.__xss=1" x="'
};
function seedState(uid, label){
  const now = Date.now(), day = 86400000, iso = d => new Date(d).toISOString().slice(0,10);
  return {
    companies:[{id:1,name:'سكاي',price:45},{id:2,name:'ليان',price:50}],
    sims:[
      {id:101,phone:'0590000001',companyId:1,wholesale:45,salePrice:60,status:'sold',customerName:label+' '+XSS.img,customerPhone:'0599000001',nextRenewal:iso(now+2*day),notes:'',history:[{type:'بيع',price:60,wholesale:45,date:new Date(now-3*day).toISOString(),customerName:label+' '+XSS.img,customerPhone:'0599000001',paid:20}]},
      {id:102,phone:"0590000002'"+XSS.js,companyId:2,wholesale:50,salePrice:70,status:'available',notes:'',history:[]},
      {id:103,phone:'0590000003',companyId:1,wholesale:45,salePrice:65,status:'sold',customerName:XSS.js,customerPhone:XSS.attr,nextRenewal:iso(now+1*day),history:[{type:'تجديد',price:65,wholesale:45,date:new Date(now-day).toISOString(),customerName:XSS.js,customerPhone:XSS.attr,paid:65}]}
    ],
    customerPayments:[{id:9001,customerName:label+' '+XSS.img,customerPhone:'0599000001',amount:10,date:new Date(now-day).toISOString(),operator:XSS.svg,note:''}],
    customerProfiles:{}, users:[{id:1,name:'رامز',role:'مدير'}], currentUserId:1,
    settings:{storeName:label+' store',storeWhatsApp:'',pin:'1234',autoLock:0,darkMode:false},
    expenses:[], activity:[{id:1,date:new Date().toISOString(),user:XSS.svg,type:'عام',text:XSS.img}], invoiceSeq:5, skyRenewals:[],
    renewalImports:[{phone:'0597000001',customerName:XSS.svg,endDate:iso(now+day),packageName:XSS.img,carrier:'Sky',companyId:1},{phone:'0597000002',customerName:'بدون تاريخ',endDate:'',companyId:1}],
    debtLedger:{customers:[{id:'local_1',name:label+' '+XSS.svg,gsm:XSS.attr,section:'زبائن'}],transactions:[{id:'local_t1',cus_id:'local_1',direction:1,amount:100,date_:iso(now),now_:'10:00',remarks:XSS.img,curr_id:0}],currencies:[{id:0,name:'شيكل'},{id:1,name:'دولار'},{id:2,name:'سعودي'}],imported:true}
  };
}

// ---------------- in-memory "database" ----------------
const db = {
  users: new Map(fixtures.users.map(u => [u.id, {...u}])),
  profiles: new Map(fixtures.users.map(u => [u.id, {id:u.id,email:u.email,full_name:u.full_name,role:u.role,created_at:new Date().toISOString()}])),
  state: new Map(),
  companies: new Map([[1,{id:1,name:'سكاي',wholesale_price:45,logo:''}],[2,{id:2,name:'ليان',wholesale_price:50,logo:'x" onerror="window.__xss=1'}]]),
  tokens: new Map(), refresh: new Map(), recover: [], offline: false, requests: []
};
const [A, B] = fixtures.users;
db.state.set(A.id, {owner_id:A.id, state:seedState(A.id,'زبون أ'), revision:1, updated_at:new Date().toISOString()});
db.state.set(B.id, {owner_id:B.id, state:seedState(B.id,'زبون ب'), revision:1, updated_at:new Date().toISOString()});

function issue(uid){
  const access = crypto.randomBytes(24).toString('hex'), refresh = crypto.randomBytes(24).toString('hex');
  db.tokens.set(access, {uid, exp: Date.now() + 3600e3}); db.refresh.set(refresh, uid);
  const u = db.users.get(uid);
  return {access_token:access, token_type:'bearer', expires_in:3600, expires_at:Math.floor(Date.now()/1000)+3600, refresh_token:refresh, user:{id:u.id, email:u.email}};
}
function authUid(req){
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const t = m && db.tokens.get(m[1]);
  return t && t.exp > Date.now() ? t.uid : null;
}
const isAdmin = uid => db.profiles.get(uid)?.role === 'admin';
const SAFE_LOGO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

function send(res, code, body){
  const s = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(code, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(s);
}
const eqFilter = (q, col) => { const v = q.get(col); return v && v.startsWith('eq.') ? decodeURIComponent(v.slice(3)) : null; };
function pick(row, select){ if(!select || select==='*') return row; const o={}; select.split(',').forEach(k=>o[k]=row[k]); return o; }

async function api(req, res, url, body){
  const q = url.searchParams, p = url.pathname, uid = authUid(req);
  const entry = {method:req.method, path:p, grant:q.get('grant_type')||undefined, auth:!!uid, bytes:body.length, at:Date.now()};
  db.requests.push(entry);
  res.on('finish', () => { entry.status = res.statusCode; });
  if(!req.headers.apikey) return send(res,401,{message:'No API key found in request'});
  let json = null; try{ json = body ? JSON.parse(body) : null; }catch(e){ return send(res,400,{message:'bad json'}); }

  // ---- auth ----
  if(p === '/auth/v1/token' && q.get('grant_type') === 'password'){
    const u = [...db.users.values()].find(x => x.email === json?.email);
    if(!u || u.password !== json?.password) return send(res,400,{error:'invalid_grant',error_description:'Invalid login credentials'});
    return send(res,200,issue(u.id));
  }
  if(p === '/auth/v1/token' && q.get('grant_type') === 'refresh_token'){
    const r = db.refresh.get(json?.refresh_token); if(!r) return send(res,400,{error:'invalid_grant',error_description:'Invalid Refresh Token'});
    db.refresh.delete(json.refresh_token); const s = issue(r); delete s.user; return send(res,200,s);
  }
  if(p === '/auth/v1/recover'){ db.recover.push({email:json?.email, redirect_to:q.get('redirect_to')}); return send(res,200,{}); }
  if(p === '/auth/v1/user' && req.method === 'GET'){ if(!uid) return send(res,401,{message:'invalid JWT'}); const u=db.users.get(uid); return send(res,200,{id:u.id,email:u.email}); }
  if(p === '/auth/v1/user' && req.method === 'PUT'){ if(!uid) return send(res,401,{message:'invalid JWT'}); if(String(json?.password||'').length<6) return send(res,422,{msg:'Password should be at least 6 characters'}); db.users.get(uid).password=json.password; return send(res,200,{id:uid}); }
  if(p === '/auth/v1/logout'){ const m=/^Bearer (.+)$/.exec(req.headers.authorization||''); if(m) db.tokens.delete(m[1]); res.writeHead(204); return res.end(); }

  if(!uid) return send(res,401,{code:'42501',message:'permission denied (anon)'});

  // ---- tables (RLS emulation) ----
  if(p === '/rest/v1/profiles' && req.method === 'GET'){
    let rows = [...db.profiles.values()].filter(r => r.id === uid || isAdmin(uid));
    const id = eqFilter(q,'id'); if(id) rows = rows.filter(r => r.id === id);
    return send(res,200,rows.map(r=>pick(r,q.get('select'))));
  }
  if(p === '/rest/v1/profiles') return send(res,403,{code:'42501',message:'permission denied for table profiles'});
  if(p === '/rest/v1/user_app_state' && req.method === 'GET'){
    let rows = [...db.state.values()].filter(r => r.owner_id === uid);                 // RLS: owner only
    const o = eqFilter(q,'owner_id'); if(o) rows = rows.filter(r => r.owner_id === o);
    return send(res,200,rows.map(r=>pick(r,q.get('select'))));
  }
  if(p === '/rest/v1/user_app_state') return send(res,403,{code:'42501',message:'permission denied for table user_app_state'});
  if(p === '/rest/v1/companies'){
    if(req.method === 'GET') return send(res,200,[...db.companies.values()].sort((a,b)=>a.id-b.id));
    if(!isAdmin(uid)) return send(res,403,{code:'42501',message:'new row violates row-level security policy'});
    if(json && 'logo' in json && json.logo && !SAFE_LOGO.test(json.logo)) return send(res,400,{code:'23514',message:'violates check constraint companies_logo_safe'});
    if(req.method === 'POST'){ db.companies.set(Number(json.id), {...json}); return send(res,201,[json]); }
    if(req.method === 'PATCH'){ const id=Number(eqFilter(q,'id')); const c=db.companies.get(id); if(!c) return send(res,200,[]); Object.assign(c,json); return send(res,200,[c]); }
  }
  // ---- RPC ----
  if(p === '/rest/v1/rpc/save_app_state'){
    if(!json || typeof json.p_state !== 'object' || Array.isArray(json.p_state)) return send(res,400,{message:'state must be a JSON object'});
    const base = Number(json.p_base_revision || 0), row = db.state.get(uid);
    if(row && row.revision === base){ row.state=json.p_state; row.revision++; row.updated_at=new Date().toISOString(); return send(res,200,{status:'ok',revision:row.revision,updated_at:row.updated_at}); }
    if(!row && base === 0){ const r={owner_id:uid,state:json.p_state,revision:1,updated_at:new Date().toISOString()}; db.state.set(uid,r); return send(res,200,{status:'ok',revision:1,updated_at:r.updated_at}); }
    return send(res,200,{status:'conflict',revision:row?row.revision:0,updated_at:row?.updated_at||null});
  }
  if(p === '/rest/v1/rpc/admin_set_user_role'){
    if(!isAdmin(uid)) return send(res,400,{code:'42501',message:'not authorized'});
    if(!['employee','manager','admin'].includes(json?.new_role)) return send(res,400,{code:'22023',message:'invalid role'});
    const pr=db.profiles.get(json.target_user_id); if(!pr) return send(res,400,{code:'P0002',message:'user not found'});
    pr.role=json.new_role; res.writeHead(204); return res.end();
  }
  return send(res,404,{code:'PGRST205',message:'not found in mock: '+p});
}

// ---- test-only control endpoints ----
function control(req, res, url, body){
  const p = url.pathname;
  if(p === '/__mock/offline'){ db.offline = JSON.parse(body||'{}').on === true; return send(res,200,{offline:db.offline}); }
  if(p === '/__mock/state'){ const r=db.state.get(url.searchParams.get('uid')); return send(res,200,r?{revision:r.revision,keys:Object.keys(r.state),sims:r.state.sims?.length,tx:r.state.debtLedger?.transactions?.length,settings:r.state.settings}:null); }
  if(p === '/__mock/bump'){ const r=db.state.get(url.searchParams.get('uid')); r.state={...r.state,activity:[{id:Date.now(),date:new Date().toISOString(),user:'other device',type:'عام',text:'تعديل من جهاز آخر'},...(r.state.activity||[])]}; r.revision++; r.updated_at=new Date().toISOString(); return send(res,200,{revision:r.revision}); }
  if(p === '/__mock/requests'){ const since=Number(url.searchParams.get('since')||0); return send(res,200,db.requests.filter(r=>r.at>=since)); }
  if(p === '/__mock/recover'){ return send(res,200,db.recover); }
  if(p === '/__mock/fixtures'){ return send(res,200,fixtures.users.map(u=>({email:u.email,role:u.role,id:u.id}))); }
  return send(res,404,{});
}

const TYPES = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.otf':'font/otf','.wasm':'application/wasm','.csv':'text/csv; charset=utf-8','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.db':'application/octet-stream'};
http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', async () => {
    const url = new URL(req.url, 'http://localhost:'+PORT);
    try{
      if(url.pathname.startsWith('/__mock/')) return control(req, res, url, body);
      if(url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/rest/v1/')){
        if(db.offline){ db.requests.push({method:req.method,path:url.pathname,offline:true,at:Date.now()}); req.socket.destroy(); return; }   // simulate "no internet"
        return await api(req, res, url, body);
      }
      if(url.pathname === '/js/config.js'){
        res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
        return res.end(`'use strict';\nwindow.APP_CONFIG=Object.freeze({supabaseUrl:location.origin,supabaseKey:'sb_publishable_LOCAL_MOCK'});\n`);
      }
      let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
      if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); return res.end('not found'); }
      res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
      fs.createReadStream(file).pipe(res);
    }catch(e){ console.error(e); send(res,500,{message:String(e)}); }
  });
}).listen(PORT, () => console.log('dev server + Supabase mock on http://localhost:'+PORT));
