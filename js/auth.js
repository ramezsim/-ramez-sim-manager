'use strict';
/* Authentication: login, password reset/invite links, profile, logout, idle logout.
   Public sign-up is closed: accounts are invited by the admin from the Supabase
   dashboard (Authentication -> Users -> Invite user), then the role is set in-app. */

const Auth = { user:null, profile:null };
const LOGOUT_REASON_KEY = 'ramez_logout_reason';

function cloudGate(show=true){
  const locked=!!show;
  document.body.classList.toggle('cloud-authenticated', !locked);
  document.body.classList.toggle('cloud-locked', locked);
  const g=document.getElementById('cloudAuthGate');
  if(g){g.style.setProperty('display', locked ? 'flex' : 'none', 'important');g.setAttribute('aria-hidden', locked ? 'false' : 'true');}
}
function setMsg(id,msg){const e=document.getElementById(id);if(e){e.textContent=msg||'';e.style.display=msg?'block':'none';}}
function cloudAuthMessage(msg){setMsg('cloudAuthError',msg);}

function showAuthView(name){
  ['cloudLoginView','cloudForgotView','cloudResetView'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.style.display=(id===name)?'block':'none';
  });
  ['cloudAuthError','cloudForgotError','cloudForgotInfo','cloudResetError'].forEach(id=>setMsg(id,''));
  const focus={cloudLoginView:'cloudAuthEmail',cloudForgotView:'cloudForgotEmail',cloudResetView:'cloudNewPassword'}[name];
  setTimeout(()=>document.getElementById(focus)?.focus(),60);
}
function showLoginView(){showAuthView('cloudLoginView');}
function showForgotView(){
  const email=(document.getElementById('cloudAuthEmail')?.value||'').trim();
  showAuthView('cloudForgotView');
  const f=document.getElementById('cloudForgotEmail'); if(f && email) f.value=email;
}

function friendlyAuthError(e){
  const m=String(e?.message||e||'');
  if(e?.network) return 'لا يوجد اتصال بالإنترنت.';
  if(/invalid login credentials|invalid_credentials/i.test(m)) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  if(/email not confirmed/i.test(m)) return 'يجب تأكيد البريد الإلكتروني من الرسالة المرسلة أولًا.';
  if(/rate limit|too many/i.test(m)) return 'محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.';
  if(/weak|password should|at least/i.test(m)) return 'كلمة المرور ضعيفة. استخدم 8 أحرف على الأقل مع أرقام وحروف.';
  if(/same.*password|different from the old/i.test(m)) return 'اختر كلمة مرور مختلفة عن السابقة.';
  return m;
}

async function cloudSignIn(){
  cloudAuthMessage('');
  if(!Cloud.configured()){cloudAuthMessage('الربط السحابي غير مفعّل.');return;}
  const emailEl=document.getElementById('cloudAuthEmail'), passEl=document.getElementById('cloudAuthPassword');
  const email=(emailEl?.value||'').trim();
  const password=passEl?.value||'';
  const remember=!!document.getElementById('rememberLogin')?.checked;
  if(!email||!password){cloudAuthMessage('اكتب البريد الإلكتروني وكلمة المرور.');return;}
  const btn=document.getElementById('cloudLoginBtn');
  const label=btn?.innerHTML;
  if(btn){btn.disabled=true;btn.textContent='⏳ جاري تسجيل الدخول...';}
  try{
    await Cloud.signIn(email,password,remember);
    if(passEl) passEl.value='';
    await enterApp();
  }catch(error){
    Cloud.clearSession();
    cloudAuthMessage('تعذر تسجيل الدخول: '+friendlyAuthError(error));
    cloudGate(true);
  }finally{if(btn){btn.disabled=false;btn.innerHTML=label;}}
}

async function sendPasswordReset(){
  setMsg('cloudForgotError',''); setMsg('cloudForgotInfo','');
  const email=(document.getElementById('cloudForgotEmail')?.value||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){setMsg('cloudForgotError','اكتب بريدًا إلكترونيًا صحيحًا.');return;}
  const btn=document.getElementById('cloudForgotBtn'); const label=btn?.innerHTML;
  if(btn){btn.disabled=true;btn.textContent='⏳ جاري الإرسال...';}
  try{
    await Cloud.recover(email, location.origin+location.pathname);
    // Same message whether the account exists or not (no account enumeration).
    setMsg('cloudForgotInfo','إذا كان هذا البريد مسجلًا لدينا فستصلك رسالة خلال دقائق تحتوي رابطًا لتعيين كلمة مرور جديدة. افتح الرابط من نفس الجهاز.');
  }catch(e){
    setMsg('cloudForgotError','تعذر إرسال الرابط: '+friendlyAuthError(e));
  }finally{if(btn){btn.disabled=false;btn.innerHTML=label;}}
}

let resetLinkType='recovery';
function showResetView(type){
  resetLinkType=type||'recovery';
  const t=document.getElementById('cloudResetTitle');
  if(t) t.textContent = resetLinkType==='invite' ? 'تفعيل حسابك' : 'تعيين كلمة مرور جديدة';
  cloudGate(true);
  showAuthView('cloudResetView');
}
async function submitNewPassword(){
  setMsg('cloudResetError','');
  const p1=document.getElementById('cloudNewPassword')?.value||'';
  const p2=document.getElementById('cloudNewPasswordConfirm')?.value||'';
  if(p1.length<8){setMsg('cloudResetError','كلمة المرور يجب أن تكون 8 أحرف على الأقل.');return;}
  if(!/[A-Za-z؀-ۿ]/.test(p1)||!/\d/.test(p1)){setMsg('cloudResetError','استخدم حروفًا وأرقامًا معًا في كلمة المرور.');return;}
  if(p1!==p2){setMsg('cloudResetError','تأكيد كلمة المرور غير مطابق.');return;}
  const btn=document.getElementById('cloudResetBtn'); const label=btn?.innerHTML;
  if(btn){btn.disabled=true;btn.textContent='⏳ جاري الحفظ...';}
  try{
    await Cloud.updatePassword(p1);
    document.getElementById('cloudNewPassword').value='';
    document.getElementById('cloudNewPasswordConfirm').value='';
    notify('🔐 تم حفظ كلمة المرور الجديدة');
    await enterApp();
  }catch(e){
    setMsg('cloudResetError','تعذر حفظ كلمة المرور: '+friendlyAuthError(e));
  }finally{if(btn){btn.disabled=false;btn.innerHTML=label;}}
}

async function cloudLoadProfile(){
  Auth.profile=null;
  if(!Auth.user)return null;
  try{
    const rows=await Cloud.select('profiles','select=id,email,full_name,role&id=eq.'+encodeURIComponent(Auth.user.id)+'&limit=1');
    Auth.profile=Array.isArray(rows)?(rows[0]||null):null;
  }catch(e){console.error('Cloud profile load failed',e);}
  renderCloudProfileUI();
  return Auth.profile;
}
function renderCloudProfileUI(){
  const badge=document.getElementById('currentUserBadge');
  if(badge&&Auth.user){const name=(Auth.profile?.full_name||Auth.profile?.email||Auth.user.email||'مستخدم');badge.textContent='👤 '+name+(Auth.profile?.role?' · '+cloudRoleLabel(Auth.profile.role):'');}
  const panel=document.getElementById('cloudAdminPanel');if(panel)panel.classList.toggle('hidden',!cloudIsAdmin());
  applyRolePermissions();if(cloudIsAdmin())cloudLoadProfiles();
}
async function cloudLoadProfiles(){
  if(!cloudIsAdmin())return;
  const list=document.getElementById('cloudAdminList');if(!list)return;list.innerHTML='<div class="small">جاري تحميل المستخدمين...</div>';
  try{
    const rows=await Cloud.select('profiles','select=id,email,full_name,role,created_at&order=created_at.asc');
    list.innerHTML=(rows||[]).map(u=>`<div class="cloud-user-row"><div class="cloud-user-meta"><b>${esc(u.full_name||'بدون اسم')} ${u.id===Auth.user.id?'(أنت)':''}</b><span>${esc(u.email||'')} · ${esc(cloudRoleLabel(u.role))}</span></div><div style="display:flex;align-items:center;gap:7px"><select class="cloud-role-select" data-role-for="${esc(u.id)}"><option value="employee" ${u.role==='employee'?'selected':''}>موظف</option><option value="manager" ${u.role==='manager'?'selected':''}>مدير</option><option value="admin" ${u.role==='admin'?'selected':''}>مدير عام</option></select><button class="btn primary" style="padding:7px 10px" data-action="setUserRole" data-user-id="${esc(u.id)}">حفظ</button></div></div>`).join('')||'<div class="small">لا يوجد مستخدمون.</div>';
  }catch(e){list.innerHTML='<div class="cloud-auth-error" style="display:block">تعذر تحميل المستخدمين: '+esc(e.message)+'</div>';}
}
async function cloudSetUserRole(userId){
  if(!cloudIsAdmin())return alert('هذه العملية متاحة للمدير العام فقط.');
  const sel=[...document.querySelectorAll('select[data-role-for]')].find(s=>s.dataset.roleFor===userId);
  const role=sel?.value;if(!role)return;
  if(userId===Auth.user.id&&role!=='admin')return alert('لا يمكن تخفيض صلاحية حسابك من داخل الحساب نفسه.');
  try{await Cloud.rpc('admin_set_user_role',JSON.stringify({target_user_id:userId,new_role:role}));notify('👑 تم تحديث صلاحية المستخدم');await cloudLoadProfiles();}
  catch(e){alert('تعذر تحديث الصلاحية: '+e.message);}
}

// ---- legacy local copies written by older versions (plain localStorage) ----
function canonicalJson(v){
  if(Array.isArray(v)) return '['+v.map(canonicalJson).join(',')+']';
  if(v && typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(v[k])).join(',')+'}';
  return JSON.stringify(v);
}
function legacyHasBusinessData(s){
  return !!s && ((s.sims||[]).length || (s.customerPayments||[]).length || (s.renewalImports||[]).length || (s.debtLedger?.transactions||[]).length);
}
let legacyPendingKeys=[];
function checkLegacyLocalCopies(uid, serverStateJson){
  legacyPendingKeys=[];
  for(const k of [KEY+'__user__'+uid, KEY]){
    let raw=null; try{raw=localStorage.getItem(k);}catch(e){}
    if(raw===null) continue;
    let parsed=null; try{parsed=JSON.parse(raw);}catch(e){}
    let same=false;
    if(parsed && serverStateJson){
      // compare after the same normalization the app applies to loaded data
      const current=data; try{ data=JSON.parse(raw); normalize(); same=canonicalJson(data)===serverStateJson; }catch(e){} finally{ data=current; }
    }
    if(!legacyHasBusinessData(parsed) || same){ try{localStorage.removeItem(k);}catch(e){} continue; }
    legacyPendingKeys.push(k);
  }
  renderLegacyBanner();
}
function renderLegacyBanner(){
  const el=document.getElementById('legacyBanner'); if(!el) return;
  if(!legacyPendingKeys.length){el.classList.add('hidden');el.innerHTML='';return;}
  el.classList.remove('hidden');
  el.innerHTML='📦 <b>توجد على هذا الجهاز نسخة محلية قديمة من البيانات</b> (من الإصدار السابق) تختلف عن نسختك في السحابة. نزّلها كملف للاحتفاظ بها، ثم احذفها من الجهاز.<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn light" data-action="legacyDownload">⬇️ تنزيلها كملف</button><button class="btn danger" data-action="legacyDelete">🗑️ حذفها من الجهاز</button></div>';
}
function legacyDownload(){
  legacyPendingKeys.forEach((k,i)=>{
    let raw=''; try{raw=localStorage.getItem(k)||'';}catch(e){}
    const blob=new Blob([raw],{type:'application/json'}),a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download='ramez-sim-old-local-copy'+(i?'-'+i:'')+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  });
}
function legacyDelete(){
  if(!confirm('حذف النسخة المحلية القديمة من هذا الجهاز؟ تأكد أنك نزّلتها إذا كنت تحتاجها.'))return;
  legacyPendingKeys.forEach(k=>{try{localStorage.removeItem(k);}catch(e){}});
  legacyPendingKeys=[]; renderLegacyBanner(); notify('🗑️ تم حذف النسخة المحلية القديمة');
}

// ---- enter / leave the app ----
async function enterApp(){
  Auth.user=Cloud.user;
  if(!Auth.user){cloudGate(true);showLoginView();return;}
  await cloudLoadProfile();
  let mode;
  try{
    mode=await Sync.start(Auth.user.id, !!Cloud.session?.remember);
  }catch(e){
    console.error('state load failed',e);
    cloudGate(true); showLoginView();
    cloudAuthMessage('تعذر تحميل بياناتك: '+(e?.message||e));
    return;
  }
  cloudGate(false);
  if(mode==='server') checkLegacyLocalCopies(Auth.user.id, canonicalJson(data));
  await cloudLoadSharedCompanies();
  applyTheme();
  goHome();
  applyRolePermissions();
  Idle.start();
}

// Removes everything this app stored locally for the account.
async function clearLocalUserData(uid){
  try{
    Object.keys(localStorage).filter(k=>k.startsWith(KEY)||k==='ramez_sim_last_unlock').forEach(k=>localStorage.removeItem(k));
  }catch(e){}
  try{ sessionStorage.clear(); }catch(e){}
  if(uid) await Sync.clearCache(uid);
}

async function cloudSignOut(opts={}){
  const uid=Auth.user?.id;
  if(!opts.force && Sync.hasUnsynced()){
    const ok=await Sync.flushNow();
    if(!ok && !confirm('توجد تغييرات لم تُرفع إلى السحابة بعد (لا يوجد اتصال أو يوجد تعارض) وستضيع عند تسجيل الخروج.\nهل تريد تسجيل الخروج على أي حال؟')) return;
  }
  if(!opts.force && legacyPendingKeys.length && !confirm('النسخة المحلية القديمة على هذا الجهاز لم يتم تنزيلها وسيتم حذفها. متابعة؟')) return;
  Sync.stop(); Idle.stop();
  try{ if(Cloud.session) await Cloud.signOutRemote(); }catch(e){}
  Cloud.clearSession();
  await clearLocalUserData(uid);
  try{ if(opts.reason) sessionStorage.setItem(LOGOUT_REASON_KEY, opts.reason); }catch(e){}
  // Full reload: wipes in-memory data, rendered customer data and every timer.
  location.replace(location.pathname);
}

// ---- automatic logout after inactivity (setting "autoLock" in minutes) ----
const Idle = {
  last: Date.now(), timer: null,
  bump(){ Idle.last = Date.now(); },
  start(){
    Idle.stop(); Idle.bump();
    ['pointerdown','keydown','touchstart'].forEach(ev=>window.addEventListener(ev, Idle.bump, {passive:true}));
    Idle.timer = setInterval(Idle.check, 30000);
    document.addEventListener('visibilitychange', Idle.check);
  },
  stop(){
    clearInterval(Idle.timer); Idle.timer=null;
    ['pointerdown','keydown','touchstart'].forEach(ev=>window.removeEventListener(ev, Idle.bump));
    document.removeEventListener('visibilitychange', Idle.check);
  },
  async check(){
    const mins = Number(data?.settings?.autoLock || 0);
    if(!mins || !Auth.user) return;
    if(Date.now() - Idle.last < mins * 60000) return;
    // Never lose work: only log out once everything is saved in the cloud.
    if(Sync.hasUnsynced() && !(await Sync.flushNow())) return;
    cloudSignOut({force:true, reason:'idle'});
  }
};

// Logging out (or an expired session) in one tab closes the app in every other
// tab of the same browser that uses the remembered session.
window.addEventListener('storage', async (e) => {
  if(e.key !== 'ramez_supabase_session_v1' || e.newValue !== null || !Auth.user || !Cloud.session?.remember) return;
  try{ if(Sync.hasUnsynced()) await Sync.flushNow(); }catch(_){}
  Sync.stop(); Idle.stop();
  location.replace(location.pathname);
});

// Reads tokens from an email link (#access_token=...&type=recovery|invite|signup|magiclink).
function consumeAuthLinkFromUrl(){
  const h=location.hash.replace(/^#/,'');
  if(!h) return null;
  const p=new URLSearchParams(h);
  if(!p.has('access_token') && !p.has('error') && !p.has('error_code')) return null;
  history.replaceState(null,'',location.pathname+location.search);   // never keep tokens in the URL
  if(p.has('error')||p.has('error_code')) return {error: p.get('error_description')||p.get('error')||'invalid link'};
  return {
    type: p.get('type')||'',
    session: {access_token:p.get('access_token'), refresh_token:p.get('refresh_token')||'', expires_in:Number(p.get('expires_in')||3600), expires_at:Number(p.get('expires_at'))||undefined}
  };
}

async function initAuth(){
  if(!Cloud.configured()){cloudGate(true);showLoginView();cloudAuthMessage('الربط السحابي غير مفعّل.');return;}
  let reason=null; try{reason=sessionStorage.getItem(LOGOUT_REASON_KEY);sessionStorage.removeItem(LOGOUT_REASON_KEY);}catch(e){}

  const link=consumeAuthLinkFromUrl();
  if(link?.error){cloudGate(true);showLoginView();cloudAuthMessage('رابط البريد غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا من «نسيت كلمة المرور؟».');return;}
  if(link?.session?.access_token){
    Cloud.setSession(link.session,false);          // link sessions are never "remembered"
    try{ Cloud.setUser(await Cloud.getUser()); }
    catch(e){ Cloud.clearSession(); cloudGate(true); showLoginView(); cloudAuthMessage('تعذر التحقق من الرابط: '+friendlyAuthError(e)); return; }
    if(link.type==='recovery'||link.type==='invite'){ showResetView(link.type); return; }
    await enterApp(); return;
  }

  const stored=Cloud.loadStored();
  if(!stored){cloudGate(true);showLoginView();if(reason==='idle')cloudAuthMessage('تم تسجيل خروجك تلقائيًا بسبب عدم النشاط.');return;}
  try{
    Cloud.setUser(await Cloud.getUser());
    await enterApp();
  }catch(e){
    if(e.network && stored.user){ await enterApp(); return; }   // offline: open the local copy (if remembered)
    const uid=stored.user?.id;
    Cloud.clearSession(); await clearLocalUserData(uid);
    cloudGate(true); showLoginView(); cloudAuthMessage('انتهت الجلسة. سجّل الدخول مرة أخرى.');
  }
}
