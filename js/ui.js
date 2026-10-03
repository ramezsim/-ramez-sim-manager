'use strict';
/* Navigation, theme, global render, the single event dispatcher (replaces every
   inline onclick/oninput/onchange), sync banner / conflict dialog, and boot. */

function navScrollToSection(el){
 if(!el)return;
 const header=document.querySelector('.top');
 const tabs=document.querySelector('.tabs');
 const offset=(header?.offsetHeight||70)+(tabs?.offsetHeight||60)+10;
 const y=Math.max(0,el.getBoundingClientRect().top+window.scrollY-offset);
 window.scrollTo({top:y,behavior:'smooth'});
}
function goHome(){
 document.querySelectorAll('main section').forEach(x=>x.classList.add('hidden'));
 const home=document.getElementById('dashboard');
 if(home)home.classList.remove('hidden');
 document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
 const first=document.querySelector('.tab');
 if(first)first.classList.add('active');
 window.scrollTo({top:0,behavior:'smooth'});
 renderAll();
}
function tab(id,b){
 if(!guardTabPermission(id)){alert('هذه الصفحة غير متاحة لصلاحيتك.');return;}
 const target=document.getElementById(id);
 if(!target)return;
 document.querySelectorAll('main section').forEach(x=>x.classList.add('hidden'));
 target.classList.remove('hidden');
 document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
 if(b){b.classList.add('active');b.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});}
 renderAll();
 requestAnimationFrame(()=>navScrollToSection(target));
}
// Opens a tab by id and highlights its own tab button (no hard-coded indexes).
function openTab(id){ tab(id, document.querySelector(`.tabs .tab[data-tab="${CSS.escape(id)}"]`)); }
function setPeriod(p,b){period=p;document.querySelectorAll('.period button').forEach(x=>x.classList.remove('active'));b?.classList.add('active');document.getElementById('customDate').classList.toggle('hidden',p!=='custom');renderAll()}

function applyTheme(){
  let saved=null; try{saved=localStorage.getItem('ramez_dark_mode');}catch(e){}
  if(data){
    data.settings=data.settings||{};
    if(saved!==null) data.settings.darkMode=saved==='1';
  }
  const dark=!!(data?.settings?.darkMode);
  document.body.classList.toggle('dark-mode',dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#0b1220':'#17366f');
  const b=document.getElementById('themeToggleBtn');
  if(b){b.textContent=dark?'☀️':'🌙';b.title=dark?'الوضع النهاري':'الوضع الليلي';}
}
function toggleDarkMode(){
  data.settings=data.settings||{};
  data.settings.darkMode=!data.settings.darkMode;
  try{localStorage.setItem('ramez_dark_mode', data.settings.darkMode ? '1' : '0');}catch(e){}
  applyTheme(); save();
  notify(data.settings.darkMode?'🌙 تم تفعيل الوضع الليلي':'☀️ تم تفعيل الوضع النهاري');
}

function renderAll(){
  if(!Auth.user) return;
  populateCompanies();populateRenewalCompanySelects();normalizeRenewalImports();renderDashboard();renderSims();renderReport();renderCompanies();renderRenewals();renderGlobalSearch();renderRenewalImports();renderRenewalAlerts();loadSettings();renderDaily();renderSmartCenter();
  if(document.getElementById('customers'))renderCustomers();
  if(document.getElementById('debtsTab'))renderDebtSection();
}

// ---- sync status banner + conflict dialog ----
function renderSyncBanner(status,msg,remember){
  const el=document.getElementById('syncBanner'); if(!el) return;
  let html='';
  if(status==='offline') html='📴 <b>لا يوجد اتصال.</b> '+(remember?'التغييرات محفوظة على هذا الجهاز وسيتم رفعها تلقائيًا عند عودة الاتصال.':'التغييرات محفوظة مؤقتًا في هذه الصفحة فقط — لا تغلقها قبل عودة الاتصال.');
  else if(status==='error') html='⚠️ <b>تعذر الحفظ في السحابة:</b> '+esc(msg||'')+' — ستتم إعادة المحاولة تلقائيًا. <button class="btn light" style="padding:6px 10px;margin-inline-start:6px" data-action="cloudSyncNow">إعادة المحاولة الآن</button>';
  else if(status==='conflict') html='⚠️ <b>يوجد تعارض:</b> تم حفظ نسخة أحدث من جهاز آخر. لن يُستبدل أي شيء تلقائيًا. <button class="btn light" style="padding:6px 10px;margin-inline-start:6px" data-action="openSyncConflict">عرض الخيارات</button>';
  el.innerHTML=html;
  el.classList.toggle('hidden',!html);
}
function showSyncConflict(c){
  document.getElementById('syncConflictOverlay')?.remove();
  const ov=document.createElement('div');
  ov.id='syncConflictOverlay'; ov.className='pin-overlay'; ov.style.background='rgba(13,30,55,.55)';
  const when=c?.updatedAt?new Date(c.updatedAt).toLocaleString('ar'):'';
  ov.innerHTML=`<div class="pin-box" style="text-align:right"><h2 style="margin-top:0">⚠️ تعارض في البيانات</h2>
    <p class="small" style="line-height:1.9">تم حفظ نسخة أحدث من حسابك على جهاز أو نافذة أخرى${when?' بتاريخ '+esc(when):''}، وعلى هذا الجهاز تغييرات لم تُرفع بعد.<br>لن يتم استبدال أي نسخة تلقائيًا. اختر ما تريد:</p>
    <div style="display:grid;gap:8px;margin-top:12px">
      <button class="btn light" data-action="syncDownloadLocal">⬇️ تنزيل نسخة هذا الجهاز كملف (احتياطي)</button>
      <button class="btn primary" data-action="syncUseServer">☁️ اعتماد النسخة الأحدث من السحابة</button>
      <button class="btn danger" data-action="syncUseLocal">⚠️ استبدال نسخة السحابة بنسخة هذا الجهاز</button>
      <button class="btn light" data-action="closeSyncConflict">لاحقًا</button>
    </div></div>`;
  document.body.appendChild(ov);
}

// ---- the single event dispatcher ----
function installDispatcher(){
  document.addEventListener('click',e=>{
    const el=e.target.closest('[data-action]'); if(!el) return;
    const fn=ACTIONS[el.dataset.action]; if(!fn) return;
    if(el.tagName==='BUTTON'||el.tagName==='A') e.preventDefault();
    try{ fn(el,e); }catch(err){ console.error(err); alert('حدث خطأ: '+(err?.message||err)); }
  });
  document.addEventListener('keydown',e=>{
    if(e.key!=='Enter'&&e.key!==' ') return;
    const el=e.target.closest?.('[role="button"][data-action]'); if(!el) return;
    e.preventDefault(); ACTIONS[el.dataset.action]?.(el,e);
  });
  document.addEventListener('input',e=>{
    const el=e.target.closest?.('[data-input]'); if(!el) return;
    ACTIONS[el.dataset.input]?.(el,e);
  });
  document.addEventListener('change',e=>{
    const el=e.target.closest?.('[data-change]'); if(!el) return;
    ACTIONS[el.dataset.change]?.(el,e);
  });
  document.getElementById('cloudLoginForm')?.addEventListener('submit',e=>{e.preventDefault();cloudSignIn();});
  document.getElementById('cloudForgotForm')?.addEventListener('submit',e=>{e.preventDefault();sendPasswordReset();});
  document.getElementById('cloudResetForm')?.addEventListener('submit',e=>{e.preventDefault();submitNewPassword();});
}

registerActions({
  noop:()=>{},
  goHome:()=>goHome(),
  tab:(el)=>openTab(el.dataset.tab),
  setPeriod:(el)=>setPeriod(el.dataset.period,el),
  renderAll:()=>renderAll(),
  toggleDarkMode:()=>toggleDarkMode(),
  clickInput:(el)=>document.getElementById(el.dataset.target)?.click(),
  scrollTo:(el)=>document.getElementById(el.dataset.target)?.scrollIntoView({behavior:'smooth'}),
  copyText:(el)=>navigator.clipboard?.writeText(el.dataset.text||'').then(()=>notify('📋 تم النسخ')).catch(()=>{}),
  signOut:()=>cloudSignOut(),
  showForgotView:()=>showForgotView(),
  showLoginView:()=>showLoginView(),
  setUserRole:(el)=>cloudSetUserRole(el.dataset.userId),
  loadProfiles:()=>cloudLoadProfiles(),
  legacyDownload:()=>legacyDownload(),
  legacyDelete:()=>legacyDelete(),
  openSyncConflict:()=>showSyncConflict(Sync.conflict),
  closeSyncConflict:()=>document.getElementById('syncConflictOverlay')?.remove(),
  syncDownloadLocal:()=>exportData(),
  syncUseServer:async()=>{
    if(!confirm('سيتم تجاهل تغييرات هذا الجهاز غير المرفوعة واعتماد نسخة السحابة.\nهل نزّلت نسخة احتياطية من هذا الجهاز أولًا؟'))return;
    try{await Sync.resolveUseServer();document.getElementById('syncConflictOverlay')?.remove();}catch(e){alert('تعذر تحميل نسخة السحابة: '+(e?.message||e));}
  },
  syncUseLocal:async()=>{
    if(!confirm('تحذير: سيتم استبدال النسخة الأحدث في السحابة (من الجهاز الآخر) بنسخة هذا الجهاز، وستضيع التغييرات التي تمت هناك.\nهل أنت متأكد؟'))return;
    try{await Sync.resolveUseLocal();document.getElementById('syncConflictOverlay')?.remove();}catch(e){alert('تعذر الحفظ: '+(e?.message||e));}
  }
});

// ---- boot ----
(function boot(){
  // Clickjacking guard for hosts that cannot send frame-ancestors/X-Frame-Options
  // (GitHub Pages). Real protection comes from the _headers file on Cloudflare Pages.
  if(window.top!==window.self){ document.documentElement.innerHTML=''; return; }
  installDispatcher();
  applyTheme();
  initAuth().catch(e=>{console.error(e);cloudGate(true);showLoginView();cloudAuthMessage('حدث خطأ غير متوقع: '+(e?.message||e));});
})();
