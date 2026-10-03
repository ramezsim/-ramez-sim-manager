'use strict';
/* Customer debt ledger (دفتر الديون) of the signed-in employee.
   No customer data is embedded in the frontend any more: the ledger lives only in
   the employee's own Supabase state (or is imported from a .db file by the user). */

function debtNormalize(){
  data.debtLedger ||= {customers:[],transactions:[],currencies:[{id:0,name:'شيكل'},{id:1,name:'دولار'},{id:2,name:'سعودي'}],imported:false};
  data.debtLedger.customers ||= [];
  data.debtLedger.transactions ||= [];
  data.debtLedger.currencies ||= [{id:0,name:'شيكل'},{id:1,name:'دولار'},{id:2,name:'سعودي'}];
}
function debtCurrencyName(id){
  const c=(data.debtLedger.currencies||[]).find(x=>Number(x.id)===Number(id));
  return c?.name||'شيكل';
}
function debtMoney(n,currId=0){
  const v=Number(n||0);
  const name=debtCurrencyName(currId);
  const symbol=name==='دولار'?'$':name==='سعودي'?'ر.س':'₪';
  return symbol+Math.abs(v).toLocaleString('he-IL',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function debtDateValue(s){
  if(!s)return 0;
  const x=String(s).trim();
  let m=x.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if(m)return new Date(Number(m[3]),Number(m[2])-1,Number(m[1])).getTime();
  const d=new Date(x); return isNaN(d)?0:d.getTime();
}
function debtCustomerTransactions(cusId,currId){
  return data.debtLedger.transactions.filter(t=>String(t.cus_id)===String(cusId) && (currId==null || Number(t.curr_id)===Number(currId)));
}
function debtBalance(cusId,currId=0){
  return debtCustomerTransactions(cusId,currId).reduce((sum,t)=>{
    const amount=Number(t.amount||0);
    return sum+(Number(t.direction)>0?amount:-amount);
  },0);
}
function debtStats(){
  const byCurr={};
  (data.debtLedger.currencies||[]).forEach(c=>byCurr[c.id]={debt:0,paid:0,credit:0});
  data.debtLedger.transactions.forEach(t=>{
    const id=Number(t.curr_id||0), a=Math.abs(Number(t.amount||0));
    byCurr[id] ||= {debt:0,paid:0,credit:0};
    if(Number(t.direction)>0) byCurr[id].debt+=a; else byCurr[id].paid+=a;
  });
  let totalDebt=0,totalPaid=0,totalCredit=0;
  Object.keys(byCurr).forEach(id=>{
    const x=byCurr[id];
    const bal=x.debt-x.paid;
    if(Number(id)===0){
      totalDebt+=Math.max(0,bal); totalCredit+=Math.max(0,-bal);
      totalPaid+=x.paid;
    }
  });
  const debtCustomers=data.debtLedger.customers.filter(c=>debtBalance(c.id,0)>0).length;
  return {totalDebt,totalPaid,totalCredit,debtCustomers,byCurr};
}
function renderDebtDashboard(){
  debtNormalize();
  const s=debtStats();
  const a=document.getElementById('debtTotal'); if(a)a.textContent=debtMoney(s.totalDebt,0);
  const b=document.getElementById('debtCustomers'); if(b)b.textContent=s.debtCustomers;
  const c=document.getElementById('debtPaid'); if(c)c.textContent=debtMoney(s.totalPaid,0);
  const d=document.getElementById('debtCredit'); if(d)d.textContent=debtMoney(s.totalCredit,0);
}
function debtSectionNames(){return ['الوكلاء','زبائن','حسابات خارجية'];}
function debtMigrateSections(){
  debtNormalize();
  data.debtLedger.customers.forEach(c=>{
    const old=String(c.section||'').trim();
    if(old==='الوكلاء') c.section='الوكلاء';
    else if(old==='زبائن') c.section='زبائن';
    else if(old==='حسابات خارجية') c.section='حسابات خارجية';
    else c.section='حسابات خارجية';
  });
}
function debtEnsureSections(){debtMigrateSections();}

// Saves the ledger change locally (memory/cache) and syncs it to the cloud.
// Offline changes are kept and uploaded later; conflicts open the conflict dialog.
async function debtPersistMutation(message){
  Sync.markChanged();
  const r=await Sync.flush();
  if(message) notify(r==='offline'?message+' · محفوظ على هذا الجهاز وسيُرفع عند عودة الاتصال':message);
  return true;
}

async function moveDebtCustomer(cusId,section){
  debtEnsureSections();
  const c=data.debtLedger.customers.find(x=>String(x.id)===String(cusId));
  if(!c||!debtSectionNames().includes(section))return false;
  const previous=c.section||'حسابات خارجية';
  if(previous===section)return true;
  c.section=section;
  renderDebtCustomers();
  await debtPersistMutation('↔️ تم نقل '+(c.name||'العميل')+' إلى قسم '+section);
  return true;
}
let debtActiveSection='all';
function setDebtSectionFilter(section){const next=section||'all';debtActiveSection=debtSectionNames().includes(next)?next:'all';renderDebtCustomers();}
function renderDebtCustomers(){
  debtEnsureSections();
  const box=document.getElementById('debtCustomerList'); if(!box)return;
  const q=(document.getElementById('debtSearch')?.value||'').trim().toLowerCase();
  const sections=debtSectionNames();
  const rows=data.debtLedger.customers.map(c=>({c,bal:debtBalance(c.id,0),txCount:debtCustomerTransactions(c.id,0).length}))
    .filter(x=>!q||((x.c.name||'')+' '+(x.c.gsm||'')).toLowerCase().includes(q));
  const visible=debtActiveSection==='all'?rows:rows.filter(x=>x.c.section===debtActiveSection);
  const tabs=document.getElementById('debtSectionTabs');
  if(!sections.includes(debtActiveSection) && debtActiveSection!=='all') debtActiveSection='all';
  if(tabs)tabs.innerHTML=`<button type="button" class="debt-tab-v2 debt-section-tab ${debtActiveSection==='all'?'active':''}" data-section="all"><span>كل الحسابات</span><small>${rows.length}</small><em>${debtMoney(rows.reduce((a,x)=>a+x.bal,0),0)}</em></button>`+
    sections.map(sec=>{const subset=rows.filter(x=>x.c.section===sec);const bal=subset.reduce((a,x)=>a+x.bal,0);return `<button type="button" class="debt-tab-v2 debt-section-tab ${debtActiveSection===sec?'active':''}" data-section="${esc(sec)}" data-debt-section="${esc(sec)}"><span>${esc(sec)}</span><small>${subset.length}</small><em>${debtMoney(bal,0)}</em></button>`}).join('');
  if(!visible.length){box.innerHTML=`<div class="debt-empty-v2"><div class="debt-empty-icon">📒</div><b>لا يوجد حسابات في هذا القسم</b><span>${q?'جرّب تغيير البحث.':'ابدأ بإضافة دين أو دفعة، أو استورد ملف DB.'}</span></div>`;return;}
  box.innerHTML=visible.sort((a,b)=>b.bal-a.bal).map(({c,bal,txCount})=>{
    const balanceClass=bal>0?'debt-positive':bal<0?'debt-credit':'debt-paid';
    const last=debtCustomerTransactions(c.id,0).slice().sort((a,b)=>debtDateValue(b.date_)-debtDateValue(a.date_))[0];
    const id=esc(String(c.id));
    return `<article class="debt-customer-card-v2">
      <div class="debt-customer-main debt-customer-open" data-cus-id="${id}" role="button" tabindex="0" style="cursor:pointer">
        <div class="debt-customer-identity"><div class="debt-customer-name">${esc(c.name||'بدون اسم')}</div><div class="debt-customer-meta"><span>${esc(c.gsm||'لا يوجد رقم')}</span><b>${esc(c.section||'حسابات خارجية')}</b></div></div>
        <div class="debt-balance-v2"><b class="${balanceClass}">${bal>0?'عليه ':bal<0?'له ':''}${debtMoney(bal,0)}</b><small>${txCount} حركة</small></div>
      </div>
      ${last?`<div class="debt-last-row"><span>آخر حركة</span><b>${esc(last.remarks|| (Number(last.direction)>0?'دين':'دفعة'))}</b><small>${esc(last.date_||'')}</small></div>`:''}
      <div class="debt-card-actions-v2">
        <button type="button" class="btn light debt-action-btn" data-debt-action="statement" data-cus-id="${id}">📄 كشف الحساب</button>
        <button type="button" class="btn success debt-action-btn" data-debt-action="payment" data-cus-id="${id}">💳 تسجيل دفعة</button>
        <button type="button" class="btn primary debt-action-btn" data-debt-action="debt" data-cus-id="${id}">＋ إضافة دين</button>
        <button type="button" class="btn danger debt-action-btn debt-delete-one" data-debt-action="delete" data-cus-id="${id}">🗑️ حذف العميل</button>
      </div>
      <select class="debt-card-move debt-move-select" aria-label="نقل الحساب" data-cus-id="${id}">${sections.map(sec=>`<option value="${esc(sec)}" ${c.section===sec?'selected':''}>نقل إلى: ${esc(sec)}</option>`).join('')}</select>
    </article>`;
  }).join('');
}

// Delegated events for the debt cards (no inline handlers).
(function installDebtCardEvents(){
  if(window.__debtCardEventsInstalled)return;
  window.__debtCardEventsInstalled=true;
  document.addEventListener('click',function(e){
    const btn=e.target.closest?.('.debt-action-btn');
    if(btn){
      e.preventDefault(); e.stopPropagation();
      const id=btn.getAttribute('data-cus-id')||'';
      const action=btn.getAttribute('data-debt-action')||'';
      if(action==='statement') return showDebtStatement(id);
      if(action==='payment') return openDebtEntry('payment',id);
      if(action==='debt') return openDebtEntry('debt',id);
      if(action==='delete') return deleteDebtCustomer(id);
    }
    const tab=e.target.closest?.('.debt-section-tab');
    if(tab){
      e.preventDefault(); e.stopPropagation();
      debtActiveSection=tab.getAttribute('data-debt-section')||tab.getAttribute('data-section')||'all';
      renderDebtCustomers();
      requestAnimationFrame(()=>document.getElementById('debtCustomerList')?.scrollIntoView({behavior:'smooth',block:'start'}));
      return;
    }
    const st=e.target.closest?.('.debt-statement-action');
    if(st){
      e.preventDefault(); e.stopPropagation();
      const id=st.getAttribute('data-cus-id')||'';
      const action=st.getAttribute('data-statement-action')||'';
      if(action==='payment') return openDebtEntry('payment',id);
      if(action==='whatsapp-pdf') return shareDebtStatementPDF(id);
      if(action==='print') return printDebtStatement(id);
      if(action==='close'){ document.getElementById('debtStatementBox')?.classList.add('hidden'); return; }
    }
    const main=e.target.closest?.('.debt-customer-open');
    if(main && !e.target.closest?.('button,select,input,a')){
      e.preventDefault();
      return showDebtStatement(main.getAttribute('data-cus-id')||'');
    }
  },true);
  document.addEventListener('keydown',function(e){
    if((e.key==='Enter'||e.key===' ') && e.target.closest?.('.debt-section-tab')){
      e.preventDefault();
      const tab=e.target.closest('.debt-section-tab');
      debtActiveSection=tab.getAttribute('data-debt-section')||tab.getAttribute('data-section')||'all';
      renderDebtCustomers();
      requestAnimationFrame(()=>document.getElementById('debtCustomerList')?.scrollIntoView({behavior:'smooth',block:'start'}));
      return;
    }
    if((e.key==='Enter'||e.key===' ') && e.target.closest?.('.debt-customer-open')){
      e.preventDefault();
      return showDebtStatement(e.target.closest('.debt-customer-open').getAttribute('data-cus-id')||'');
    }
  },true);
  document.addEventListener('change',function(e){
    const sel=e.target.closest?.('.debt-move-select');
    if(sel){
      e.preventDefault(); e.stopPropagation();
      return moveDebtCustomer(sel.getAttribute('data-cus-id')||'', sel.value||'');
    }
  },true);
})();

async function deleteDebtCustomer(cusId){
  debtNormalize(); const c=data.debtLedger.customers.find(x=>String(x.id)===String(cusId)); if(!c)return;
  const count=debtCustomerTransactions(c.id,null).length;
  if(!confirm(`حذف ${c.name||'العميل'} مع ${count} حركة؟`))return;
  data.debtLedger.customers=data.debtLedger.customers.filter(x=>String(x.id)!==String(cusId));
  data.debtLedger.transactions=data.debtLedger.transactions.filter(t=>String(t.cus_id)!==String(cusId));
  document.getElementById('debtStatementBox')?.classList.add('hidden');
  renderDebtSection();
  await debtPersistMutation('🗑️ تم حذف العميل وحركاته');
}
async function deleteAllDebtCustomers(){
  debtNormalize();const count=data.debtLedger.customers.length,tx=data.debtLedger.transactions.length;if(!count)return alert('دفتر الديون فارغ.');
  if(!confirm(`سيتم حذف ${count} عميل و${tx} حركة من دفتر الديون فقط.\n\nهل أنت متأكد؟`))return;
  data.debtLedger.customers=[];data.debtLedger.transactions=[];data.debtLedger.imported=false;
  document.getElementById('debtStatementBox')?.classList.add('hidden');
  renderDebtSection();
  await debtPersistMutation('🗑️ تم حذف دفتر الديون بالكامل');
}
function openDebtEntry(type,cusId){
  debtNormalize();
  const isPayment=type==='payment';
  const existing=cusId?data.debtLedger.customers.find(x=>String(x.id)===String(cusId)):null;
  document.getElementById('debtEntryOverlay')?.remove();
  const ov=document.createElement('div');
  ov.id='debtEntryOverlay';
  ov.className='debt-entry-overlay-v2';
  ov.innerHTML=`<div class="debt-entry-card-v2" dir="rtl">
    <div class="debt-entry-head"><div><small>${isPayment?'دفتر الحسابات':'حركة جديدة'}</small><h3>${isPayment?'💳 تسجيل دفعة':'＋ إضافة دين'}</h3></div><button type="button" class="btn light" id="debtEntryCloseBtn">✕</button></div>
    <label>العميل</label><input id="debtEntryCustomer" class="search" list="debtCustomersDatalist" value="${esc(existing?.name||'')}" placeholder="اكتب اسم العميل أو اختره" autocomplete="off" maxlength="120">
    <datalist id="debtCustomersDatalist">${data.debtLedger.customers.map(c=>`<option value="${esc(c.name)}">${esc(c.gsm||'')}</option>`).join('')}</datalist>
    <label>المبلغ بالشيكل</label><input id="debtEntryAmount" class="search" type="number" step=".01" min="0" inputmode="decimal" placeholder="0.00">
    <label>التاريخ</label><input id="debtEntryDate" class="search" type="date" value="${new Date().toISOString().slice(0,10)}">
    <label>البيان</label><input id="debtEntryRemarks" class="search" value="${isPayment?'دفعة':'دين'}" placeholder="مثال: شحنة / تجديد / دفعة" maxlength="200">
    <button type="button" id="debtSaveEntryBtn" class="btn ${isPayment?'success':'primary'} debt-save-entry-v2">${isPayment?'💳 حفظ الدفعة':'＋ حفظ الدين'}</button>
    <div id="debtEntryStatus" class="small" style="text-align:center;margin-top:10px;min-height:20px"></div>
  </div>`;
  document.body.appendChild(ov);
  document.getElementById('debtEntryCloseBtn')?.addEventListener('click',()=>ov.remove());
  document.getElementById('debtSaveEntryBtn')?.addEventListener('click',()=>{
    const btn=document.getElementById('debtSaveEntryBtn');
    btn.disabled=true;btn.style.opacity='.7';
    const ok=saveDebtEntry(type,cusId||'');
    if(!ok){btn.disabled=false;btn.style.opacity='1';}
  });
  setTimeout(()=>document.getElementById('debtEntryCustomer')?.focus(),80);
}
function saveDebtEntry(type,existingCusId){
  try{
    debtNormalize();
    const name=(document.getElementById('debtEntryCustomer')?.value||'').trim().slice(0,120);
    const amount=Number(document.getElementById('debtEntryAmount')?.value||0);
    const date=document.getElementById('debtEntryDate')?.value||new Date().toISOString().slice(0,10);
    const remarks=((document.getElementById('debtEntryRemarks')?.value||'').trim()||(type==='payment'?'دفعة':'دين')).slice(0,200);
    const status=document.getElementById('debtEntryStatus');
    if(!name){if(status)status.textContent='اكتب اسم العميل أولًا';alert('اكتب اسم العميل');return false;}
    if(!(amount>0)||!Number.isFinite(amount)){if(status)status.textContent='أدخل مبلغًا أكبر من صفر';alert('أدخل مبلغًا صحيحًا');return false;}
    let c=data.debtLedger.customers.find(x=>String(x.id)===String(existingCusId||''));
    if(!c)c=data.debtLedger.customers.find(x=>String(x.name||'').trim()===name);
    if(!c){
      c={id:'local_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),name,gsm:'',section:debtActiveSection==='all'?'زبائن':debtActiveSection};
      data.debtLedger.customers.push(c);
    }
    const tx={id:'local_'+Date.now()+'_'+Math.random().toString(36).slice(2,9),sourceId:null,cus_id:c.id,direction:type==='payment'?-1:1,amount:Math.abs(amount),date_:date,now_:new Date().toLocaleTimeString('ar',{hour:'2-digit',minute:'2-digit'}),remarks,curr_id:0};
    data.debtLedger.transactions.push(tx);
    data.debtLedger.imported=true;
    try{logActivity((type==='payment'?'دفعة ديون: ':'إضافة دين: ')+name+' · '+money(amount),'ديون');}catch(e){}
    Sync.markChanged();
    debtMigrateSections();
    renderDebtDashboard();
    renderDebtCustomers();
    showDebtStatement(c.id);
    document.getElementById('debtEntryOverlay')?.remove();
    notify(type==='payment'?'💚 تم تسجيل الدفعة بنجاح':'🔴 تم إضافة الدين بنجاح');
    return true;
  }catch(error){
    console.error('saveDebtEntry',error);
    const status=document.getElementById('debtEntryStatus');if(status)status.textContent='حدث خطأ: '+(error?.message||error);
    alert('تعذر حفظ الحركة: '+(error?.message||error));
    return false;
  }
}

function showDebtStatement(cusId){
  debtEnsureSections();const c=data.debtLedger.customers.find(x=>String(x.id)===String(cusId));if(!c)return;
  const box=document.getElementById('debtStatementBox');if(!box)return;const tx=debtCustomerTransactions(c.id,0).slice().sort((a,b)=>debtDateValue(a.date_)-debtDateValue(b.date_));const bal=debtBalance(c.id,0);
  const id=esc(String(c.id));
  box.classList.remove('hidden');box.innerHTML=`<div class="debt-statement-head-v2"><div><div class="debt-statement-title">📒 ${esc(c.name||'')}</div><div class="debt-statement-meta">${esc(c.gsm||'لا يوجد رقم')} · ${esc(c.section||'الوكلاء')}</div></div><button type="button" class="btn light debt-statement-action" data-statement-action="close" data-cus-id="${id}">✕</button></div>
    <div class="debt-statement-tools"><button type="button" class="btn primary debt-statement-action" data-statement-action="whatsapp-pdf" data-cus-id="${id}">💬 واتساب PDF</button><button type="button" class="btn light debt-statement-action" data-statement-action="payment" data-cus-id="${id}">💳 تسجيل دفعة</button></div>
    <div class="muted-box"><b>الرصيد الحالي:</b> <span class="${bal>0?'debt-positive':bal<0?'debt-credit':'debt-paid'}">${bal>0?'عليه ':bal<0?'له ':''}${debtMoney(bal,0)}</span></div>
    <div class="debt-statement-list-v2">${tx.length?tx.slice().reverse().map(t=>`<div class="debt-statement-row"><div class="date">${esc(t.date_||'')}<br>${esc(t.now_||'')}</div><div class="desc">${Number(t.direction)>0?'🔴':'💚'} ${esc(t.remarks|| (Number(t.direction)>0?'دين':'دفعة'))}</div><div class="amount ${Number(t.direction)>0?'debt-positive':'debt-paid'}">${Number(t.direction)>0?'+':'-'}${debtMoney(t.amount,t.curr_id)}</div></div>`).join(''):'<div class="debt-empty-v2">لا توجد حركات لهذا العميل.</div>'}</div>
    <div class="debt-statement-footer">الرصيد النهائي: ${bal>0?'عليه ':bal<0?'له ':''}${debtMoney(bal,0)}</div>`;
  box.scrollIntoView({behavior:'smooth',block:'start'});
}
async function shareDebtStatementPDF(cusId){
  debtEnsureSections();
  const c=data.debtLedger.customers.find(x=>String(x.id)===String(cusId));
  if(!c){alert('لم يتم العثور على العميل.');return false;}
  const tx=debtCustomerTransactions(c.id,0).slice().sort((a,b)=>debtDateValue(a.date_)-debtDateValue(b.date_));
  try{
    await loadVendorScript(VENDOR.jspdf);
    const JsPDF=window.jspdf?.jsPDF; if(!JsPDF) throw new Error('jsPDF unavailable');
    // PDF ثابت الصفحة: كل SVG هنا يمثل صفحة A4 كاملة.
    const PAGE_W=794, PAGE_H=1123, M=42, ROW_H=34;
    const rows=tx.map(t=>({date:t.date_||'',desc:t.remarks||'حركة',type:Number(t.direction)>0?'دين':'دفعة',amount:Number(t.amount||0),direction:Number(t.direction)>0?1:-1}));
    const perPage=22;
    const totalPages=Math.max(1,Math.ceil(rows.length/perPage));
    const escXml=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
    const txt=(x,y,s,size=18,weight=600,fill='#182235',anchor='end')=>`<text x="${x}" y="${y}" font-family="Arial, Tahoma, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escXml(s)}</text>`;
    const line=(x1,y1,x2,y2,stroke='#dbe3ec',w=1)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}"/>`;
    const moneyNum=n=>debtMoney(Number(n||0),0);
    let running=0;
    const balances=[];
    rows.forEach(r=>{running += r.direction*r.amount; balances.push(running);});
    const finalBalance=running;
    const makePage=(pageIndex)=>{
      const from=pageIndex*perPage,to=Math.min(rows.length,from+perPage),pageRows=rows.slice(from,to);
      const pageStartBalance=from>0?balances[from-1]:0;
      let body='';
      body+=`<rect x="${M}" y="${M}" width="${PAGE_W-2*M}" height="165" rx="18" fill="#f7faff" stroke="#dce6f1"/>`;
      body+=txt(PAGE_W-M,82,'Ramez SIM Manager',28,900,'#17366f');
      body+=txt(PAGE_W-M,116,'كشف حساب الديون',22,800,'#182235');
      body+=txt(PAGE_W-M,148,'العميل: '+(c.name||'بدون اسم'),18,800);
      body+=txt(M+10,82,'Smile sim',22,900,'#17366f','start');
      body+=txt(M+10,114,(c.gsm||'لا يوجد رقم'),16,600,'#64748b','start');
      body+=txt(M+10,145,'القسم: '+(c.section||'حسابات خارجية'),15,600,'#64748b','start');
      body+=`<rect x="${M}" y="${M+177}" width="${PAGE_W-2*M}" height="48" rx="12" fill="${finalBalance>0?'#fff1f2':finalBalance<0?'#eff6ff':'#f0fdf4'}"/>`;
      body+=txt(PAGE_W-M, M+209, 'الرصيد الحالي: '+moneyNum(finalBalance),19,900,finalBalance>0?'#c83c4d':finalBalance<0?'#2563eb':'#0b9a67');
      const thY=M+258;
      body+=`<rect x="${M}" y="${thY}" width="${PAGE_W-2*M}" height="38" fill="#eaf0f6"/>`;
      const xDate=PAGE_W-M, xDesc=555, xType=385, xAmount=240, xBal=70;
      body+=txt(xDate,thY+25,'التاريخ',14,900);
      body+=txt(xDesc,thY+25,'البيان',14,900);
      body+=txt(xType,thY+25,'النوع',14,900);
      body+=txt(xAmount,thY+25,'المبلغ',14,900);
      body+=txt(xBal,thY+25,'الرصيد',14,900);
      pageRows.forEach((r,i)=>{
        const globalIndex=from+i, y=thY+38+i*ROW_H;
        if(i%2===0) body+=`<rect x="${M}" y="${y}" width="${PAGE_W-2*M}" height="${ROW_H}" fill="#fbfcfe"/>`;
        body+=line(M,y+ROW_H,PAGE_W-M,y+ROW_H,'#dfe6ee',1);
        body+=txt(xDate,y+23,r.date,13,600);
        body+=txt(xDesc,y+23,r.desc,13,700);
        body+=txt(xType,y+23,r.type,13,700);
        body+=txt(xAmount,y+23,(r.direction>0?'+':'-')+moneyNum(r.amount),13,800,r.direction>0?'#c83c4d':'#0b9a67');
        body+=txt(xBal,y+23,moneyNum(balances[globalIndex]),13,800,balances[globalIndex]>0?'#c83c4d':balances[globalIndex]<0?'#2563eb':'#0b9a67');
      });
      const footY=PAGE_H-M-26;
      body+=line(M,footY-28,PAGE_W-M,footY-28,'#d8e0e9',1);
      body+=txt(PAGE_W-M,footY,'الرصيد في نهاية الصفحة: '+moneyNum(pageRows.length?balances[to-1]:pageStartBalance),14,800);
      body+=txt(M,footY,'صفحة '+(pageIndex+1)+' من '+totalPages,13,600,'#64748b','start');
      body+=txt(PAGE_W/2,PAGE_H-18,'Ramez SIM · كشف حساب الديون',11,500,'#94a3b8','middle');
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
    };
    const pdf=new JsPDF({orientation:'p',unit:'mm',format:'a4',compress:true});
    for(let i=0;i<totalPages;i++){
      const svg=makePage(i);
      const img=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);});
      const canvas=document.createElement('canvas');
      canvas.width=1191;canvas.height=1684;
      const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
      if(i>0)pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg',0.94),'JPEG',0,0,210,297,undefined,'FAST');
      canvas.width=1;canvas.height=1;
    }
    const blob=pdf.output('blob');
    const safeName=(c.name||'عميل').replace(/[\\/:*?"<>|]/g,'-');
    const file=new File([blob],`كشف-حساب-${safeName}.pdf`,{type:'application/pdf'});
    if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){
      try{await navigator.share({files:[file],text:`كشف حساب ${c.name||''}`});notify('💬 تم تجهيز كشف الحساب كملف PDF');return true;}catch(e){if(e?.name==='AbortError')return false;}
    }
    downloadBlob(blob,file.name);
    alert('تم إنشاء ملف PDF. افتحه من التنزيلات ثم اختر مشاركة → WhatsApp.');return true;
  }catch(e){console.error('shareDebtStatementPDF',e);alert('تعذر إنشاء ملف PDF: '+(e?.message||e));return false;}
}
function printDebtStatement(cusId){
  debtEnsureSections();
  const c=data.debtLedger.customers.find(x=>String(x.id)===String(cusId));
  if(!c)return;
  const tx=debtCustomerTransactions(c.id,0).slice().sort((a,b)=>debtDateValue(a.date_)-debtDateValue(b.date_));
  let running=0;
  const rows=tx.map(t=>{
    running+=Number(t.direction)>0?Number(t.amount||0):-Number(t.amount||0);
    return {date:t.date_||'',time:t.now_||'',desc:t.remarks||'',type:Number(t.direction)>0?'دين':'دفعة',amount:debtMoney(t.amount,t.curr_id),balance:debtMoney(running,t.curr_id),direction:Number(t.direction)};
  });
  const title='كشف حساب - '+(c.name||'');
  document.getElementById('debtPrintOverlay')?.remove();
  const styleId='debtPrintStyleV35';
  if(!document.getElementById(styleId)){
    const st=document.createElement('style');
    st.id=styleId;
    st.textContent=`
      #debtPrintOverlay{position:fixed;inset:0;z-index:2147483000;background:#f4f7fb;overflow:auto;padding:12px;font-family:Arial,sans-serif;color:#172b4d;direction:rtl}
      #debtPrintOverlay .dp-wrap{max-width:900px;margin:0 auto;background:#fff;border-radius:18px;padding:18px;box-shadow:0 8px 30px rgba(0,0,0,.10)}
      #debtPrintOverlay .dp-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
      #debtPrintOverlay h1{font-size:23px;margin:0}
      #debtPrintOverlay .dp-tools{display:flex;gap:8px;flex-wrap:wrap}
      #debtPrintOverlay button{border:0;border-radius:12px;padding:12px 16px;font-weight:900;font-size:15px;cursor:pointer;font-family:inherit}
      #debtPrintOverlay .dp-print{background:#2f7de1;color:#fff}
      #debtPrintOverlay .dp-close{background:#eaf0f6;color:#172b4d}
      #debtPrintOverlay .dp-meta{color:#64748b;line-height:1.9;margin-bottom:12px}
      #debtPrintOverlay .dp-balance{padding:13px;border-radius:14px;background:#f4f7fb;font-size:19px;font-weight:900;margin-bottom:14px}
      #debtPrintOverlay table{width:100%;border-collapse:collapse}
      #debtPrintOverlay th,#debtPrintOverlay td{border:1px solid #dfe6ef;padding:9px;text-align:right;vertical-align:top}
      #debtPrintOverlay th{background:#edf2f7}
      #debtPrintOverlay .dp-debt{color:#c83c4d;font-weight:900}
      #debtPrintOverlay .dp-pay{color:#0b9a67;font-weight:900}
      #debtPrintOverlay .dp-footer{margin-top:14px;padding:13px;background:#f4f7fb;border-radius:14px;font-weight:900}
      @media(max-width:650px){#debtPrintOverlay{padding:7px}#debtPrintOverlay .dp-wrap{padding:12px;border-radius:14px}#debtPrintOverlay h1{font-size:19px}#debtPrintOverlay table{font-size:11px}#debtPrintOverlay th,#debtPrintOverlay td{padding:6px}#debtPrintOverlay .dp-tools{width:100%}#debtPrintOverlay button{flex:1}}
      @media print{
        body>*:not(#debtPrintOverlay){display:none!important}
        #debtPrintOverlay{position:static!important;inset:auto!important;overflow:visible!important;background:#fff!important;padding:0!important}
        #debtPrintOverlay .dp-wrap{max-width:none!important;box-shadow:none!important;border-radius:0!important;padding:0!important}
        #debtPrintOverlay .dp-tools{display:none!important}
        #debtPrintOverlay table{font-size:10px}
        #debtPrintOverlay th,#debtPrintOverlay td{padding:6px}
      }
    `;
    document.head.appendChild(st);
  }
  const overlay=document.createElement('div');
  overlay.id='debtPrintOverlay';
  overlay.innerHTML=`<div class="dp-wrap">
    <div class="dp-head">
      <h1>📒 ${esc(title)}</h1>
      <div class="dp-tools">
        <button type="button" class="dp-print" id="debtPrintNowBtn">🖨️ طباعة / حفظ PDF</button>
        <button class="dp-close" id="debtPrintCloseBtn">✕ إغلاق</button>
      </div>
    </div>
    <div class="dp-meta">كشف حساب الديون · العميل: <b>${esc(c.name||'')}</b><br>الهاتف: ${esc(c.gsm||'-')} · القسم: ${esc(c.section||'الوكلاء')}</div>
    <div class="dp-balance">الرصيد الحالي: ${debtMoney(debtBalance(c.id,0),0)}</div>
    <table><thead><tr><th>التاريخ</th><th>البيان</th><th>النوع</th><th>المبلغ</th><th>الرصيد</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${esc(r.date)}${r.time?`<br>${esc(r.time)}`:''}</td><td>${esc(r.desc)}</td><td>${esc(r.type)}</td><td class="${r.direction>0?'dp-debt':'dp-pay'}">${r.direction>0?'+':'-'}${esc(r.amount)}</td><td>${esc(r.balance)}</td></tr>`).join('')||'<tr><td colspan="5" style="text-align:center">لا توجد حركات لهذا العميل.</td></tr>'}
    </tbody></table>
    <div class="dp-footer">الرصيد النهائي: ${debtMoney(debtBalance(c.id,0),0)}</div>
  </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow='hidden';
  const cleanup=()=>{document.body.style.overflow='';overlay.remove();window.removeEventListener('afterprint',cleanup);};
  window.addEventListener('afterprint',cleanup);
  document.getElementById('debtPrintCloseBtn')?.addEventListener('click',cleanup);
  // iPhone/Safari: window.print must run directly from the user's tap.
  document.getElementById('debtPrintNowBtn')?.addEventListener('click',function(){try{window.print();}catch(e){alert('تعذر فتح الطباعة: '+(e?.message||e));}});
}
function renderDebtSection(){debtNormalize();renderDebtDashboard();renderDebtCustomers();}

function downloadDebtBackup(){
  debtNormalize();
  const payload={app:'Ramez SIM Manager',type:'debtLedger-backup',createdAt:new Date().toISOString(),data:data.debtLedger};
  downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}),'backup-debts-'+new Date().toISOString().slice(0,10)+'.json');
}
// CSV export of the whole ledger (formula-safe cells, UTF-8 BOM for Excel).
function exportDebtCSV(){
  debtNormalize();
  const rows=[['العميل','الهاتف','التاريخ','نوع الحركة','المبلغ','العملة','التفاصيل']];
  const byId=new Map(data.debtLedger.customers.map(c=>[String(c.id),c]));
  data.debtLedger.transactions.forEach(t=>{
    const c=byId.get(String(t.cus_id));
    rows.push([c?.name||'',c?.gsm||'',t.date_||'',Number(t.direction)>0?'دين':'دفعة',t.amount,debtCurrencyName(t.curr_id),t.remarks||'']);
  });
  const csv='﻿'+rows.map(r=>r.map(csvCell).join(',')).join('\n');
  downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),'ديون-العملاء.csv');
}
function openDebtDbImport(){
  const input=document.getElementById('debtDbFileInput');
  if(input){input.value='';input.click();}
}
function debtFindColumn(cols,names){
  const lower=cols.map(x=>String(x).toLowerCase());
  for(const n of names){
    const i=lower.indexOf(String(n).toLowerCase());
    if(i>=0)return cols[i];
  }
  return null;
}
function debtRowsFromSqlResult(result){
  if(!result?.columns)return [];
  return (result.values||[]).map(row=>Object.fromEntries(result.columns.map((c,i)=>[c,row[i]])));
}
async function handleDebtDbFile(input){
  const file=input?.files?.[0];
  if(!file)return;
  try{
    debtNormalize();
    if(file.size>100*1024*1024)throw new Error('الملف كبير جدًا.');
    const ok=confirm(`استيراد ملف دفتر الحسابات؟\n\n${file.name}\n\nسيتم دمج العملاء والحركات الجديدة فقط، ولن يتم حذف بياناتك الحالية.`);
    if(!ok)return;
    notify('⏳ جاري قراءة ملف DB...');
    await loadVendorScript(VENDOR.sqljs);
    if(!window.initSqlJs) throw new Error('محرك SQLite لم يجهز');
    const SQL=await window.initSqlJs({locateFile:()=>appUrl(VENDOR.sqlWasm)});
    const buffer=await file.arrayBuffer();
    const db=new SQL.Database(new Uint8Array(buffer));
    try{
      const tables=(db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")[0]?.values||[]).map(r=>String(r[0]));
      if(!tables.length)throw new Error('ملف DB لا يحتوي جداول قابلة للقراءة.');
      const qn=n=>`"${String(n).replaceAll('"','""')}"`;
      const tableInfo=tables.map(name=>{
        const res=db.exec(`PRAGMA table_info(${qn(name)})`)[0];
        return {name,cols:(res?.values||[]).map(r=>String(r[1]))};
      });
      const has=(cols,names)=>names.some(n=>cols.some(c=>String(c).toLowerCase()===String(n).toLowerCase()));
      const scoreCustomer=x=>{let s=0;if(has(x.cols,['id','ID','customer_id','cus_id']))s+=3;if(has(x.cols,['name','customer_name','full_name','title']))s+=4;if(has(x.cols,['gsm','phone','mobile','number']))s+=2;return s;};
      const scoreTx=x=>{let s=0;if(has(x.cols,['id','ID','transaction_id','entry_id']))s+=2;if(has(x.cols,['cus_id','customer_id','client_id','cusid']))s+=4;if(has(x.cols,['amount','value','money','total','debt','credit','debit','payment']))s+=4;if(has(x.cols,['direction','dir','movement_type','type']))s+=2;if(has(x.cols,['date_','date','created_at','created','entry_date']))s+=1;return s;};
      const customerTable=tableInfo.slice().sort((a,b)=>scoreCustomer(b)-scoreCustomer(a))[0];
      const txTable=tableInfo.slice().sort((a,b)=>scoreTx(b)-scoreTx(a))[0];
      if(!customerTable||scoreCustomer(customerTable)<5)throw new Error('لم أتعرف على جدول العملاء. الجداول الموجودة: '+tables.join('، '));
      if(!txTable||scoreTx(txTable)<7)throw new Error('لم أتعرف على جدول الحركات. الجداول الموجودة: '+tables.join('، '));
      const customers=debtRowsFromSqlResult(db.exec(`SELECT * FROM ${qn(customerTable.name)}`)[0]);
      const transactions=debtRowsFromSqlResult(db.exec(`SELECT * FROM ${qn(txTable.name)}`)[0]);
      const cCols=customers.length?Object.keys(customers[0]):customerTable.cols;
      const tCols=transactions.length?Object.keys(transactions[0]):txTable.cols;
      const cId=debtFindColumn(cCols,['ID','id','customer_id','cus_id']);
      const cName=debtFindColumn(cCols,['name','customer_name','full_name','title']);
      const cGsm=debtFindColumn(cCols,['gsm','phone','mobile','number']);
      const tId=debtFindColumn(tCols,['ID','id','transaction_id','entry_id']);
      const tCus=debtFindColumn(tCols,['cus_id','customer_id','client_id','cusid']);
      const tDirection=debtFindColumn(tCols,['direction','dir','movement_type','type']);
      const tAmount=debtFindColumn(tCols,['amount','value','money','total']);
      const tIn=debtFindColumn(tCols,['in','credit','debt']);
      const tOut=debtFindColumn(tCols,['out','debit','payment']);
      const tDate=debtFindColumn(tCols,['date_','date','created_at','created','entry_date']);
      const tNow=debtFindColumn(tCols,['now_','time','created_time']);
      const tRemarks=debtFindColumn(tCols,['remarks','note','description','details','memo']);
      const tCurr=debtFindColumn(tCols,['curr_id','currency_id','currency']);
      if(!cId||!cName||!tId||!tCus)throw new Error('تم العثور على الجداول لكن أعمدة الربط الأساسية غير واضحة.');
      if(!tAmount&&!tIn&&!tOut)throw new Error('لم أجد عمود مبلغ في جدول الحركات.');
      const str=(v,n=200)=>String(v??'').slice(0,n);
      const customerMap=new Map();let addedCustomers=0,updatedCustomers=0,addedTransactions=0,skippedTransactions=0;
      customers.forEach(c=>{
        const sourceId=String(c[cId]);
        let local=data.debtLedger.customers.find(x=>String(x.sourceId)===sourceId);
        if(!local)local=data.debtLedger.customers.find(x=>String(x.name||'').trim()===String(c[cName]||'').trim()&&String(x.gsm||'').trim()===String(cGsm?c[cGsm]||'':'').trim());
        if(!local){local={id:'db_'+sourceId,sourceId:c[cId],name:str(c[cName],120),gsm:str(cGsm?c[cGsm]||'':'',40).trim(),section:'زبائن'};data.debtLedger.customers.push(local);addedCustomers++;}
        else {if(!local.sourceId)local.sourceId=c[cId];if(!local.name&&c[cName])local.name=str(c[cName],120);if(!local.gsm&&cGsm&&c[cGsm])local.gsm=str(c[cGsm],40);if(!local.section)local.section='زبائن';updatedCustomers++;}
        customerMap.set(sourceId,local);
      });
      const existingSourceTx=new Set(data.debtLedger.transactions.filter(t=>t.sourceId!=null).map(t=>String(t.sourceId)));
      transactions.forEach(t=>{
        const sourceId=String(t[tId]);if(existingSourceTx.has(sourceId)){skippedTransactions++;return;}
        const localCustomer=customerMap.get(String(t[tCus]));if(!localCustomer){skippedTransactions++;return;}
        let direction=1,amount=0;
        if(tDirection){const raw=String(t[tDirection]??'').toLowerCase();direction=(raw.includes('-')||raw.includes('payment')||raw.includes('دف')||raw==='out'||raw==='2')?-1:(Number(raw)<0?-1:1);}
        if(tAmount)amount=Math.abs(Number(t[tAmount]||0));else if(tOut&&Number(t[tOut]||0)){amount=Math.abs(Number(t[tOut]||0));direction=-1;}else if(tIn&&Number(t[tIn]||0)){amount=Math.abs(Number(t[tIn]||0));direction=1;}
        if(!Number.isFinite(amount)||amount<=0){skippedTransactions++;return;}
        const currId=tCurr?Number(t[tCurr]??0):0;
        data.debtLedger.transactions.push({id:'dbt_'+sourceId,sourceId:t[tId],cus_id:localCustomer.id,direction,amount,date_:str(tDate?t[tDate]||'':'',40),now_:str(tNow?t[tNow]||'':'',40),remarks:str(tRemarks?t[tRemarks]||'':(direction<0?'دفعة':'دين')),curr_id:Number.isFinite(currId)?currId:0});
        existingSourceTx.add(sourceId);addedTransactions++;
      });
      data.debtLedger.imported=true;debtMigrateSections();renderDebtSection();
      Sync.markChanged();
      alert(`تم استيراد الملف بنجاح\n\nالعملاء الجدد: ${addedCustomers}\nتحديثات العملاء: ${updatedCustomers}\nالحركات الجديدة: ${addedTransactions}\nالمتجاهلة: ${skippedTransactions}`);
      notify(`✅ تم استيراد ${addedCustomers} عميل و${addedTransactions} حركة`);
    }finally{ db.close(); }
  }catch(e){
    console.error('DB import failed',e);
    alert('تعذر استيراد ملف DB:\n\n'+(e?.message||e));notify('⚠️ فشل استيراد ملف DB');
  }finally{if(input)input.value='';}
}

registerActions({
  openDebtEntry:(el)=>openDebtEntry(el.dataset.type,el.dataset.cusId||''),
  openDebtDbImport:()=>openDebtDbImport(),
  downloadDebtBackup:()=>downloadDebtBackup(),
  handleDebtDbFile:(el)=>handleDebtDbFile(el),
  renderDebtCustomers:()=>renderDebtCustomers(),
  deleteAllDebtCustomers:()=>deleteAllDebtCustomers()
});
