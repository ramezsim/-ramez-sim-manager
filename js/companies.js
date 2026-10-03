'use strict';
/* Companies: shared catalogue (Supabase table "companies", writable by admins only via RLS). */

function companyLogo(name){
 const c=data.companies.find(x=>String(x.name||'').trim()===String(name||'').trim());
 if(c?.logo) return safeImageSrc(c.logo);
 const n=String(name||'').trim();
 if(n==='ليان') return 'logos/layan.jpg';
 if(n==='سكاي') return 'logos/sky.jpg';
 if(n==='الوها') return 'logos/aloha.jpg';
 if(n==='أرين') return 'logos/areen.jpg';
 return '';
}
function companyLogoHtml(c){
 const src=companyLogo(c.name);
 return src ? `<img src="${esc(src)}" alt="${esc(c.name)}" style="width:52px;height:52px;object-fit:contain;border-radius:12px;background:#fff;border:1px solid #e5eaf2;padding:4px;flex:none">` : `<div style="width:52px;height:52px;border-radius:12px;background:#f2f5f9;display:flex;align-items:center;justify-content:center;font-weight:800;color:#5d6b82">${esc((c.name||'?').slice(0,1))}</div>`;
}
// Re-encodes any uploaded picture as a small raster image (SVG/scripts never stored).
async function fileToCompanyLogo(file){
 return new Promise((resolve,reject)=>{
   if(!file) return resolve('');
   const reader=new FileReader();
   reader.onerror=()=>reject(new Error('تعذر قراءة الصورة'));
   reader.onload=()=>{
     const img=new Image();
     img.onload=()=>{
       const max=420, ratio=Math.min(1,max/Math.max(img.width,img.height));
       const canvas=document.createElement('canvas');
       canvas.width=Math.max(1,Math.round(img.width*ratio)); canvas.height=Math.max(1,Math.round(img.height*ratio));
       const ctx=canvas.getContext('2d'); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
       ctx.drawImage(img,0,0,canvas.width,canvas.height);
       const out=canvas.toDataURL('image/webp',.82);
       safeImageSrc(out)?resolve(out):reject(new Error('صيغة الصورة غير مدعومة'));
     };
     img.onerror=()=>reject(new Error('الملف ليس صورة صالحة'));
     img.src=reader.result;
   };
   reader.readAsDataURL(file);
 });
}
function previewCompanyLogoFile(input,previewId){
 const file=input?.files?.[0]; const box=document.getElementById(previewId); if(!box)return;
 if(!file){box.innerHTML='🏢';return;}
 fileToCompanyLogo(file).then(src=>{const safe=safeImageSrc(src);box.innerHTML=safe?`<img src="${esc(safe)}" alt="شعار الشركة">`:'🏢';box.dataset.logo=safe||'';}).catch(()=>{box.innerHTML='🏢';box.dataset.logo='';alert('تعذر قراءة الشعار');});
}
function clearCompanyLogo(inputId,previewId){
 const input=document.getElementById(inputId),box=document.getElementById(previewId);
 if(input) input.value=''; if(box){box.innerHTML='🏢';box.dataset.logo='';}
}
function clearCompanyForm(){
 const n=document.getElementById('newCompany'), p=document.getElementById('defaultPrice');
 if(n) n.value=''; if(p) p.value=''; clearCompanyLogo('newCompanyLogo','newCompanyLogoPreview');
}
function companyLogoPreviewHtml(c){
 const src=companyLogo(c.name);
 return src?`<div class="company-edit-logo"><img src="${esc(src)}" alt="${esc(c.name)}"></div>`:`<div class="company-edit-logo">🏢</div>`;
}
function populateCompanies(){const sel=document.getElementById('company');if(!sel)return;const cur=sel.value;sel.innerHTML=data.companies.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');if([...sel.options].some(o=>o.value===cur))sel.value=cur;updateWholesale()}
function updateWholesale(){let c=data.companies.find(x=>x.id==document.getElementById('company')?.value);if(c)document.getElementById('wholesale').value=c.price}
async function addCompany(){
 if(!requireCloudPermission('companies'))return;
 let n=document.getElementById('newCompany').value.trim(),p=Number(document.getElementById('defaultPrice').value||0);
 if(!n)return alert('اكتب اسم الشركة');
 if(n.length>80)return alert('اسم الشركة طويل جدًا');
 if(data.companies.some(c=>String(c.name||'').trim()===n))return alert('هذه الشركة موجودة بالفعل');
 const box=document.getElementById('newCompanyLogoPreview');
 let logo=safeImageSrc(box?.dataset.logo||'');
 const file=document.getElementById('newCompanyLogo')?.files?.[0];
 try{
   if(file && !logo) logo=await fileToCompanyLogo(file);
   const company={id:Date.now(),name:n,price:p,logo};
   await cloudCreateCompanyShared(company);
   await cloudLoadSharedCompanies();
   clearCompanyForm();
   notify('🏢 تمت إضافة الشركة لجميع المستخدمين');
 }catch(e){alert('تعذر إضافة الشركة: '+e.message);}
}
async function changeCompanyLogo(id){
 if(!requireCloudPermission('companies'))return;
 const c=data.companies.find(x=>x.id==id); if(!c)return;
 const input=document.createElement('input'); input.type='file'; input.accept='image/png,image/jpeg,image/webp';
 input.onchange=async()=>{
   const file=input.files?.[0]; if(!file)return;
   try{
     const logo=await fileToCompanyLogo(file);
     await cloudUpdateCompanyShared(id,{logo});
     await cloudLoadSharedCompanies();
     notify('🖼️ تم تحديث شعار الشركة لجميع المستخدمين');
   }catch(e){alert('تعذر تحديث الشعار: '+e.message);}
 };
 input.click();
}
async function editCompany(id){
 if(!requireCloudPermission('companies'))return;
 const c=data.companies.find(x=>x.id==id); if(!c)return;
 const name=prompt('اسم الشركة؟',c.name); if(name===null)return;
 const n=name.trim(); if(!n)return alert('اسم الشركة لا يمكن أن يكون فارغًا');
 if(n.length>80)return alert('اسم الشركة طويل جدًا');
 if(data.companies.some(x=>x.id!=id && String(x.name||'').trim()===n))return alert('هناك شركة أخرى بهذا الاسم');
 const price=prompt('سعر الجملة الافتراضي (₪)؟',String(c.price??0)); if(price===null)return;
 try{
   await cloudUpdateCompanyShared(id,{name:n,wholesale_price:Number(price)||0});
   await cloudLoadSharedCompanies();
   notify('✏️ تم تعديل الشركة لجميع المستخدمين');
 }catch(e){alert('تعذر تعديل الشركة: '+e.message);}
}
function renderCompanies(){
 const el=document.getElementById('companyList'); if(!el)return;
 el.innerHTML=data.companies.map(c=>{
   const ops=allOps().filter(o=>o.companyId==c.id);
   const stock=data.sims.filter(s=>s.companyId==c.id&&s.status==='available').length;
   const sold=data.sims.filter(s=>s.companyId==c.id&&s.status==='sold').length;
   const sales=ops.reduce((a,o)=>a+Number(o.price||0),0);
   const cost=ops.reduce((a,o)=>a+Number(o.wholesale||0),0);
   const profit=sales-cost;
   return `<div class="company-edit-row" style="cursor:pointer" data-action="showCompanyDetails" data-id="${esc(c.id)}">
     <div class="company-edit-grid">
       <div class="company-edit-info">${companyLogoPreviewHtml(c)}<div style="min-width:0"><div style="font-weight:900;font-size:17px">${esc(c.name)}</div><div class="small">الجملة: ${money(c.price)} · متوفر: ${stock} · مباع: ${sold}</div><div class="small">المبيعات: ${money(sales)} · الربح: ${money(profit)}</div></div></div>
       <div class="company-edit-actions" data-action="noop">
         <button type="button" class="btn primary" data-action="showCompanyDetails" data-id="${esc(c.id)}">📊 تفاصيل</button>
         <button type="button" class="btn light" data-action="editCompany" data-id="${esc(c.id)}">✏️ تعديل الشركة</button>
         <button type="button" class="btn light" data-action="changeCompanyLogo" data-id="${esc(c.id)}">🖼️ تغيير الشعار</button>
       </div>
     </div>
   </div>`;
 }).join('')||'<div class="empty">لا توجد شركات</div>';
}
function showCompanyDetails(companyId){
 const c=data.companies.find(x=>String(x.id)===String(companyId));
 const box=document.getElementById('companyDetailBox'); if(!c||!box)return;
 const ops=allOps().filter(o=>o.companyId==c.id);
 const sales=ops.reduce((a,o)=>a+Number(o.price||0),0);
 const cost=ops.reduce((a,o)=>a+Number(o.wholesale||0),0);
 const profit=sales-cost;
 const stock=data.sims.filter(s=>s.companyId==c.id&&s.status==='available').length;
 const sold=data.sims.filter(s=>s.companyId==c.id&&s.status==='sold').length;
 const renewed=ops.filter(o=>String(o.type||'').includes('تجديد')||String(o.type||'').toLowerCase().includes('renew')).length;
 const customers=new Set(ops.map(o=>(o.customerName||'').trim()).filter(Boolean)).size;
 const margin=sales?((profit/sales)*100):0;
 box.innerHTML=`<div class="cards" style="margin:0">
   <div class="card"><div class="label">🏢 الشركة</div><div class="big" style="font-size:20px">${esc(c.name)}</div></div>
   <div class="card"><div class="label">📱 العمليات</div><div class="big">${ops.length}</div></div>
   <div class="card"><div class="label">💰 المبيعات</div><div class="big">${money(sales)}</div></div>
   <div class="card"><div class="label">💸 التكلفة</div><div class="big">${money(cost)}</div></div>
   <div class="card"><div class="label">📈 الربح</div><div class="big green">${money(profit)}</div></div>
   <div class="card"><div class="label">📊 هامش الربح</div><div class="big">${margin.toFixed(1)}%</div></div>
   <div class="card"><div class="label">📦 متوفر</div><div class="big">${stock}</div></div>
   <div class="card"><div class="label">👥 عملاء</div><div class="big">${customers}</div></div>
 </div>
 <div class="muted-box" style="margin-top:12px">المباع: <b>${sold}</b> · التجديدات: <b>${renewed}</b> · سعر الجملة الافتراضي: <b>${money(c.price)}</b></div>
 <div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>الخط</th><th>العميل</th><th>البيع</th><th>الربح</th></tr></thead><tbody>${ops.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,50).map(o=>`<tr><td>${esc(new Date(o.date||Date.now()).toLocaleDateString('ar'))}</td><td>${esc(o.type||'بيع')}</td><td>${esc(o.phone||'-')}</td><td>${esc(o.customerName||'غير مسمى')}</td><td>${money(o.price||0)}</td><td class="green">${money(Number(o.price||0)-Number(o.wholesale||0))}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">لا توجد عمليات لهذه الشركة</td></tr>'}</tbody></table></div>`;
 box.scrollIntoView({behavior:'smooth',block:'start'});
}
function showCompanyDetailsFromDashboard(companyId){
  openTab('companiesTab');
  setTimeout(()=>showCompanyDetails(companyId),50);
}

// ---- Supabase (shared table) ----
async function cloudLoadSharedCompanies(){
  if(!Auth.user) return false;
  try{
    const rows=await Cloud.select('companies','select=id,name,wholesale_price,logo&order=id.asc');
    if(Array.isArray(rows) && rows.length){
      data.companies=rows.map(c=>({id:Number(c.id),name:String(c.name||''),price:Number(c.wholesale_price||0),logo:safeImageSrc(c.logo)}));
      populateCompanies();
      renderAll();
    }
    return true;
  }catch(e){console.error('Shared companies load failed',e);return false;}
}
async function cloudCreateCompanyShared(company){
  if(!cloudIsAdmin()) throw new Error('إضافة الشركات متاحة للمدير العام فقط.');
  const rows=await Cloud.insert('companies',{id:company.id,name:company.name,wholesale_price:Number(company.price||0),logo:safeImageSrc(company.logo)});
  return Array.isArray(rows)?rows[0]:rows;
}
async function cloudUpdateCompanyShared(id,patch){
  if(!cloudIsAdmin()) throw new Error('تعديل الشركات متاح للمدير العام فقط.');
  if('logo' in patch) patch={...patch,logo:safeImageSrc(patch.logo)};
  const rows=await Cloud.update('companies','id=eq.'+encodeURIComponent(id),patch);
  return Array.isArray(rows)?rows[0]:rows;
}

registerActions({
  addCompany:()=>addCompany(),
  clearCompanyForm:()=>clearCompanyForm(),
  clearNewCompanyLogo:()=>clearCompanyLogo('newCompanyLogo','newCompanyLogoPreview'),
  previewNewCompanyLogo:(el)=>previewCompanyLogoFile(el,'newCompanyLogoPreview'),
  updateWholesale:()=>updateWholesale(),
  showCompanyDetails:(el)=>showCompanyDetails(el.dataset.id),
  showCompanyDetailsFromDashboard:(el)=>showCompanyDetailsFromDashboard(el.dataset.id),
  editCompany:(el)=>editCompany(el.dataset.id),
  changeCompanyLogo:(el)=>changeCompanyLogo(el.dataset.id)
});
