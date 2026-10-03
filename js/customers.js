'use strict';
/* Customer accounts, statements, payments, receipts, statement image and the print/export window. */

function customerKeyOf(name,phone){return String(name||'').trim().toLowerCase()+'|'+String(phone||'').trim();}
function customerRecords(){
 let map={};
 allOps().forEach(o=>{
   let name=String(o.customerName||'زبون غير مسمى').trim(), phone=String(o.customerPhone||'').trim();
   let key=(name.toLowerCase()+'|'+phone);
   if(!map[key])map[key]={key,name,phone,ops:[],paid:0,note:data.customerProfiles[key]?.note||''};
   map[key].ops.push(o);
   map[key].paid+=Number(o.paid||0);
 });
 (data.customerPayments||[]).forEach(p=>{
   let key=customerKeyOf(p.customerName,p.customerPhone);
   if(!map[key])map[key]={key,name:p.customerName||'زبون',phone:p.customerPhone||'',ops:[],paid:0,note:data.customerProfiles[key]?.note||''};
   map[key].paid+=Number(p.amount||0);
 });
 return Object.values(map).map(c=>{
   c.total=c.ops.reduce((a,o)=>a+Number(o.price||0),0);
   c.due=Math.max(0,c.total-c.paid);
   return c;
 });
}
function paymentsOf(c){return (data.customerPayments||[]).filter(p=>customerKeyOf(p.customerName,p.customerPhone)===c.key);}
function renderCustomers(){
 let q=(document.getElementById('customerSearch')?.value||'').trim().toLowerCase();
 let cs=customerRecords().filter(c=>(c.name+' '+c.phone).toLowerCase().includes(q));
 document.getElementById('customerList').innerHTML=cs.length?cs.map(c=>{const k=esc(c.key);return `
   <div class="company" style="border-color:#dfe7f2;background:#fff">
    <div class="company-head"><div><div class="company-name">${esc(c.name)}</div><div class="company-meta">${esc(c.phone||'لا يوجد رقم')} · ${c.ops.length} عملية</div></div>
    <div style="text-align:left"><b class="${c.due?'red':''}">${money(c.due)}</b><div class="small">المتبقي</div></div></div>
    <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px">
      <button class="btn primary" style="padding:8px 11px" data-action="showStatement" data-key="${k}">كشف الحساب</button>
      ${c.due>0?`<button class="btn success" style="padding:8px 11px" data-action="addPayment" data-key="${k}">💵 تسجيل دفعة</button>`:''}<button class="btn light" style="padding:8px 11px" data-action="editCustomerNote" data-key="${k}">📝 ملاحظة</button>
    </div>
   </div>`}).join(''):'<div class="empty">لا يوجد زبائن مطابقون</div>';
}
function getCustomer(key){
 return customerRecords().find(c=>c.key===String(key));
}
function showStatement(key){
 let c=getCustomer(key);if(!c)return;
 const k=esc(c.key);
 let html=`<div id="statementPrint"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><h3 style="margin:0">${esc(c.name)}</h3><div class="small">${esc(c.phone||'لا يوجد رقم')}</div></div><b>${money(c.due)} متبقي</b></div>${c.note?`<div class="muted-box" style="margin-top:10px">📝 ${esc(c.note)}</div>`:''}
 <div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>التاريخ</th><th>الرقم</th><th>البيان</th><th>المبلغ</th><th>المدفوع</th><th>المتبقي</th></tr></thead><tbody>`;
 c.ops.sort((a,b)=>new Date(a.date)-new Date(b.date)).forEach(o=>{
   let due=Math.max(0,Number(o.price)-Number(o.paid||0));
   html+=`<tr><td>${esc(new Date(o.date).toLocaleDateString('ar'))}</td><td>${esc(o.phone)}</td><td>${esc(o.type)}</td><td>${money(o.price)}</td><td>${money(o.paid||0)}</td><td>${money(due)}</td></tr>`;
 });
 paymentsOf(c).forEach(p=>{
   html+=`<tr><td>${esc(new Date(p.date).toLocaleDateString('ar'))}</td><td>-</td><td>دفعة على الحساب</td><td>-${money(p.amount)}</td><td>${money(p.amount)}</td><td>-</td></tr>`;
 });
 html+=`</tbody></table></div><div class="muted-box" style="margin-top:12px"><b>💳 سجل الدفعات</b><div style="margin-top:7px">${paymentsOf(c).sort((a,b)=>new Date(b.date)-new Date(a.date)).map(p=>`<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)"><span>${money(p.amount)} · ${esc(new Date(p.date).toLocaleDateString('ar'))} ${p.operator?`· ${esc(p.operator)}`:''}</span><span><button class="btn light" style="padding:5px 8px" data-action="editPayment" data-id="${esc(p.id)}" data-key="${k}">تعديل</button> <button class="btn danger" style="padding:5px 8px" data-action="deletePayment" data-id="${esc(p.id)}" data-key="${k}">حذف</button></span></div>`).join('')||'<span class="small">لا توجد دفعات منفصلة</span>'}</div></div><div class="cards" style="margin-top:12px"><div class="card"><div class="label">إجمالي الخدمات</div><div class="big">${money(c.total)}</div></div><div class="card"><div class="label">إجمالي المدفوع</div><div class="big">${money(c.paid)}</div></div><div class="card"><div class="label">المتبقي</div><div class="big red">${money(c.due)}</div></div></div></div>
 <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn primary" data-action="printCustomer" data-key="${k}">🖨️ طباعة كشف الحساب</button><button class="btn" data-action="showStatementImage" data-key="${k}">🖼️ كشف كصورة</button><button class="btn light" data-action="printReceipt" data-key="${k}">🧾 إيصال</button>${c.due>0?`<button class="btn success" data-action="addPayment" data-key="${k}">💵 تسجيل دفعة</button>`:''}</div>`;
 const statementEl=document.getElementById('customerStatement');
 if(statementEl){
   statementEl.innerHTML=html;
   statementEl.style.scrollMarginTop='95px';
   requestAnimationFrame(()=>statementEl.scrollIntoView({behavior:'smooth',block:'start'}));
 }
}
function addPayment(key){if(!requireCloudPermission('payment'))return;
 let c=getCustomer(key);if(!c)return;
 let amount=prompt(`المبلغ المدفوع من ${c.name} (₪)؟`,c.due.toFixed(2));if(amount===null)return;
 amount=Math.max(0,Number(amount)||0);if(!amount)return alert('أدخل مبلغًا صحيحًا');if(amount>c.due)amount=c.due;
 let paymentNote=prompt('ملاحظة الدفعة (اختياري)؟','')||'';
 data.customerPayments.push({id:Date.now(),customerName:c.name,customerPhone:c.phone,amount,date:nowDate(),operator:currentUser().name,note:paymentNote});
 save();showStatement(key);notify(`💵 تم تسجيل دفعة ${money(amount)} من ${c.name}`);
}
function editPayment(id,key){if(!requireCloudPermission('payment'))return;const p=(data.customerPayments||[]).find(x=>x.id==id);if(!p)return;let a=prompt('تعديل مبلغ الدفعة (₪)؟',String(p.amount));if(a===null)return;a=Number(a);if(!a||a<0)return alert('مبلغ غير صحيح');let n=prompt('تعديل ملاحظة الدفعة؟',p.note||'');if(n===null)return;p.amount=a;p.note=n;save();showStatement(key);}
function deletePayment(id,key){if(!requireCloudPermission('payment'))return;const p=(data.customerPayments||[]).find(x=>x.id==id);if(!p)return;if(!confirm(`حذف دفعة ${money(p.amount)}؟`))return;data.customerPayments=data.customerPayments.filter(x=>x.id!=id);save();showStatement(key);notify('🗑️ تم حذف الدفعة');}
function getProfile(key){data.customerProfiles ||= {}; data.customerProfiles[key] ||= {}; return data.customerProfiles[key];}
function editCustomerNote(key){if(!requireCloudPermission('customerNote'))return;let c=getCustomer(key);if(!c)return;let p=getProfile(c.key);let note=prompt('ملاحظة العميل؟',p.note||'');if(note===null)return;p.note=note.trim();save();showStatement(key);}

function buildStatementRows(c){
 const rows=(c.ops||[]).slice().sort((a,b)=>new Date(a.date)-new Date(b.date)).map(o=>({date:new Date(o.date||Date.now()).toLocaleDateString('en-CA'),num:o.phone||'-',desc:o.type||'عملية',amount:Number(o.price||0),paid:Number(o.paid||0),due:Math.max(0,Number(o.price||0)-Number(o.paid||0))}));
 const payments=paymentsOf(c).map(p=>({date:new Date(p.date||Date.now()).toLocaleDateString('en-CA'),num:'-',desc:'دفعة على الحساب',amount:-Number(p.amount||0),paid:Number(p.amount||0),due:0}));
 return rows.concat(payments);
}
function showStatementImage(key){
 const c=getCustomer(key); if(!c)return;
 const rows=buildStatementRows(c);
 const payload={name:c.name||'',phone:c.phone||'',rows,total:Number(c.total||0),paid:Number(c.paid||0),due:Number(c.due||0),storeName:data.settings?.storeName||'Ramez SIM Manager'};
 const svg=statementSVG(payload);
 document.getElementById('statementImageOverlay')?.remove();
 const overlay=document.createElement('div'); overlay.id='statementImageOverlay';
 overlay.innerHTML='<div style="position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px"><div style="background:#fff;border-radius:18px;max-width:560px;width:100%;max-height:94vh;overflow:auto;padding:12px;direction:rtl;box-shadow:0 18px 60px rgba(0,0,0,.3)"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px"><b style="font-size:18px">🖼️ كشف الحساب كصورة</b><button data-action="closeStatementImage" style="border:0;background:#edf2f7;border-radius:10px;padding:8px 12px;font-weight:800">✕</button></div><div style="background:#f6f8fb;border-radius:12px;padding:8px;overflow:auto"><img id="statementPreviewImg" style="width:100%;height:auto;border:1px solid #e5e7eb;border-radius:10px;display:block;background:#fff"/></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button data-action="downloadStatementImage" style="flex:1;min-width:140px;border:0;border-radius:12px;padding:13px;background:#2f7de1;color:#fff;font-weight:800;font-size:15px">⬇️ حفظ الصورة</button><button data-action="shareStatementToWhatsApp" style="flex:1;min-width:140px;border:0;border-radius:12px;padding:13px;background:#12a36d;color:#fff;font-weight:800;font-size:15px">💬 إرسال إلى واتساب</button></div><p style="font-size:12px;color:#718096;text-align:center;margin:9px 0 2px">الصورة كاملة بدون قص، ومناسبة للمشاركة على واتساب.</p></div></div>';
 document.body.appendChild(overlay);
 window.__statementImageSVG=svg;
 const img=overlay.querySelector('#statementPreviewImg'); img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}
function statementSVG(d){
 const esc=x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 const W=794,H=1123,M=38,tableW=W-M*2;
 const rowsArr=Array.isArray(d.rows)?d.rows:[];
 const rowH=48, tableTop=205, headerH=54;
 const cols={date:116,num:245,desc:385,amount:490,paid:610,due:744};
 let y=tableTop+headerH+34;
 let rows=rowsArr.map(r=>{
   const yy=y; y+=rowH;
   return `<line x1="${M}" y1="${yy+17}" x2="${W-M}" y2="${yy+17}" stroke="#e4e9f0" stroke-width="1"/>
   <text x="${cols.date}" y="${yy}" text-anchor="end" class="cell">${esc(r.date)}</text>
   <text x="${cols.num}" y="${yy}" text-anchor="end" class="cell">${esc(r.num)}</text>
   <text x="${cols.desc}" y="${yy}" text-anchor="end" class="cell">${esc(r.desc)}</text>
   <text x="${cols.amount}" y="${yy}" text-anchor="end" class="cell">${money(r.amount)}</text>
   <text x="${cols.paid}" y="${yy}" text-anchor="end" class="cell paid">${money(r.paid)}</text>
   <text x="${cols.due}" y="${yy}" text-anchor="end" class="cell">${money(r.due)}</text>`;
 }).join('');

 const bottom=y;
 const showTotals=!!d.showTotals;
 const pageNo=Number(d.pageNo||1), totalPages=Number(d.totalPages||1);
 const totals=showTotals?`
   <rect x="${M}" y="${bottom+26}" width="${tableW}" height="145" rx="16" fill="#f6f8fb"/>
   <text x="${W-M-18}" y="${bottom+63}" text-anchor="end" class="tot">إجمالي الخدمات: ${money(d.total)}</text>
   <text x="${W-M-18}" y="${bottom+101}" text-anchor="end" class="tot">إجمالي المدفوع: ${money(d.paid)}</text>
   <text x="${W-M-18}" y="${bottom+139}" text-anchor="end" class="totStrong">المتبقي: ${money(d.due)}</text>`:'';

 return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
 <rect width="${W}" height="${H}" fill="#ffffff"/>
 <rect x="0" y="0" width="${W}" height="10" fill="#17366f"/>
 <style>
 .title{font-family:Arial,"Noto Naskh Arabic",sans-serif;font-size:27px;font-weight:800;fill:#17366f}
 .sub{font-family:Arial,"Noto Naskh Arabic",sans-serif;font-size:21px;font-weight:700;fill:#182235}
 .small{font-family:Arial,"Noto Naskh Arabic",sans-serif;font-size:15px;fill:#66758a}
 .head{font-family:Arial,"Noto Naskh Arabic",sans-serif;font-size:13px;font-weight:800;fill:#31445c}
 .cell{font-family:Arial,"Noto Naskh Arabic",sans-serif;font-size:13px;fill:#182235}
 .paid{fill:#14966a}
 .tot{font-family:Arial,"Noto Naskh Arabic",sans-serif;font-size:17px;font-weight:700;fill:#31445c}
 .totStrong{font-family:Arial,"Noto Naskh Arabic",sans-serif;font-size:19px;font-weight:900;fill:#c52e46}
 .page{font-family:Arial,sans-serif;font-size:12px;fill:#8794a7}
 </style>
 <text x="${W-M}" y="58" text-anchor="end" class="title">${esc(d.storeName||'Ramez SIM Manager')}</text>
 <text x="${W-M}" y="92" text-anchor="end" class="sub">كشف حساب الديون</text>
 <text x="${W-M}" y="124" text-anchor="end" class="small">العميل: ${esc(d.name)}  ·  ${esc(d.phone)}</text>
 <rect x="${M}" y="${tableTop}" width="${tableW}" height="${headerH}" rx="12" fill="#eef3f8"/>
 <text x="${cols.date}" y="${tableTop+34}" text-anchor="end" class="head">التاريخ</text>
 <text x="${cols.num}" y="${tableTop+34}" text-anchor="end" class="head">الرقم</text>
 <text x="${cols.desc}" y="${tableTop+34}" text-anchor="end" class="head">البيان</text>
 <text x="${cols.amount}" y="${tableTop+34}" text-anchor="end" class="head">المبلغ</text>
 <text x="${cols.paid}" y="${tableTop+34}" text-anchor="end" class="head">المدفوع</text>
 <text x="${cols.due}" y="${tableTop+34}" text-anchor="end" class="head">المتبقي</text>
 ${rows}
 ${totals}
 <text x="${W/2}" y="${H-24}" text-anchor="middle" class="page">Ramez SIM  ·  صفحة ${pageNo} من ${totalPages}</text>
 </svg>`;
}
async function svgToPngBlob(svg){
 return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const scale=2;const c=document.createElement('canvas');c.width=1080*scale;c.height=Math.ceil(img.height*scale);const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);c.toBlob(b=>b?resolve(b):reject(new Error('blob')),'image/png',.95)};img.onerror=reject;img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);});
}
async function downloadStatementImage(){try{const b=await svgToPngBlob(window.__statementImageSVG);downloadBlob(b,'كشف-حساب.png')}catch(e){alert('تعذر إنشاء الصورة. حاول مرة أخرى.')}}
async function shareStatementToWhatsApp(){try{const b=await svgToPngBlob(window.__statementImageSVG);const f=new File([b],'كشف-حساب.png',{type:'image/png'});if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[f]}))){await navigator.share({files:[f],text:'كشف حساب من Ramez SIM'});}else{downloadBlob(b,'كشف-حساب.png');setTimeout(()=>{window.open('https://wa.me/?text='+encodeURIComponent('كشف حساب من Ramez SIM'),'_blank','noopener')},500)}}catch(e){if(e.name!=='AbortError')alert('تعذر إرسال الصورة. استخدم حفظ الصورة ثم شاركها عبر واتساب.')}}

function printCustomer(key){
 let c=getCustomer(key);if(!c)return;
 const statementRows=buildStatementRows(c);
 let rows=statementRows.map(o=>`<tr><td>${esc(o.date)}</td><td>${esc(o.num)}</td><td>${esc(o.desc)}</td><td>${money(o.amount)}</td><td>${money(o.paid)}</td><td>${money(o.due)}</td></tr>`).join('');
 // تقسيم كشف الحساب إلى صفحات A4 حقيقية بدل إنشاء صورة واحدة ضخمة.
 const perPage=15;
 const totalPages=Math.max(1,Math.ceil(statementRows.length/perPage));
 const pdfPages=[];
 for(let i=0;i<totalPages;i++){
   const pageRows=statementRows.slice(i*perPage,(i+1)*perPage);
   pdfPages.push(statementSVG({
     name:c.name||'',phone:c.phone||'',rows:pageRows,
     total:Number(c.total||0),paid:Number(c.paid||0),due:Number(c.due||0),
     showTotals:i===totalPages-1,pageNo:i+1,totalPages,storeName:'Ramez SIM Manager'
   }));
 }
 printWindow(
   `كشف حساب - ${c.name}`,
   `<h1>Ramez SIM Manager</h1><h2>كشف حساب الزبون</h2><p><b>${esc(c.name)}</b> ${esc(c.phone||'')}</p><table><thead><tr><th>التاريخ</th><th>الرقم</th><th>البيان</th><th>المبلغ</th><th>المدفوع</th><th>المتبقي</th></tr></thead><tbody>${rows}</tbody></table><div class="totals">إجمالي الخدمات: ${money(c.total)}<br>إجمالي المدفوع: ${money(c.paid)}<br><b>المتبقي: ${money(c.due)}</b></div>`,
   pdfPages[0]||'',
   pdfPages
 );
}
function printReceipt(key){const c=getCustomer(key);if(!c)return;const pays=paymentsOf(c).sort((a,b)=>new Date(b.date)-new Date(a.date));const p=pays[0];if(!p)return alert('لا توجد دفعة مسجلة لهذا العميل');let body=`<div style="max-width:520px;margin:auto;border:2px solid #17366f;border-radius:18px;padding:24px"><h1 style="color:#17366f;margin:0 0 6px">${esc(data.settings?.storeName||'Ramez SIM Manager')}</h1><h2>🧾 إيصال دفع</h2><p><b>العميل:</b> ${esc(c.name)}</p><p><b>الهاتف:</b> ${esc(c.phone||'-')}</p><hr><p style="font-size:26px"><b>المبلغ المدفوع: ${money(p.amount)}</b></p><p><b>التاريخ:</b> ${esc(new Date(p.date).toLocaleString('ar'))}</p><p><b>المتبقي:</b> ${money(c.due)}</p><p style="color:#718096">شكرًا لتعاملكم معنا.</p></div>`;printWindow('إيصال دفع',body);}

// Opens the print/export window. Content is escaped HTML; the window's logic lives
// in js/print-window.js and its data is passed as inert JSON (no inline script).
function printWindow(title,body,pdfSvg='',pdfPages=null){
 const w=window.open('','_blank');
 if(!w)return alert('اسمح بالنوافذ المنبثقة للطباعة');
 w.document.open();
 w.document.write(buildPrintWindowHtml(title,body,pdfSvg,pdfPages));
 w.document.close();
}
function buildPrintWindowHtml(title,body,pdfSvg='',pdfPages=null){
 const pages=Array.isArray(pdfPages)&&pdfPages.length?pdfPages:(pdfSvg?[pdfSvg]:[]);
 const payload=jsonForScript({pdfSvg:pdfSvg||pages[0]||'',pdfPages:pages,jspdf:{src:appUrl(VENDOR.jspdf.src),integrity:VENDOR.jspdf.integrity}});
 return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(title)}</title><link rel="stylesheet" href="${esc(appUrl('css/print-window.css'))}"></head><body><div class="actions"><button id="backBtn" class="back">← رجوع</button><button id="pdfBtn" class="pdf">📄 تصدير PDF</button><button id="imgBtn" class="img">🖼️ حفظ كصورة</button><button id="waBtn" class="wa">💬 واتساب</button><button id="printBtn" class="print">🖨️ طباعة</button></div><p class="hint">PDF يتم إنشاؤه كملف PDF فعلي، والصورة بحجم ثابت بدون قص.</p><div id="statementContent">${body}</div><script type="application/json" id="printWindowData">${payload}<\/script><script src="${esc(appUrl('js/print-window.js'))}"><\/script></body></html>`;
}

function openWhatsApp(phone,text){let p=String(phone||'').replace(/\D/g,'');if(p.startsWith('0'))p='972'+p.slice(1);if(!p)return;window.open('https://wa.me/'+p+'?text='+encodeURIComponent(String(text||'')),'_blank','noopener');}

registerActions({
  renderCustomers:()=>renderCustomers(),
  showStatement:(el)=>{ if(!document.getElementById('customers')?.classList.contains('hidden')||el.closest('#customers')) showStatement(el.dataset.key); else { openTab('customers'); setTimeout(()=>showStatement(el.dataset.key),30); } },
  addPayment:(el)=>addPayment(el.dataset.key),
  editPayment:(el)=>editPayment(el.dataset.id,el.dataset.key),
  deletePayment:(el)=>deletePayment(el.dataset.id,el.dataset.key),
  editCustomerNote:(el)=>editCustomerNote(el.dataset.key),
  printCustomer:(el)=>printCustomer(el.dataset.key),
  printReceipt:(el)=>printReceipt(el.dataset.key),
  showStatementImage:(el)=>showStatementImage(el.dataset.key),
  closeStatementImage:()=>document.getElementById('statementImageOverlay')?.remove(),
  downloadStatementImage:()=>downloadStatementImage(),
  shareStatementToWhatsApp:()=>shareStatementToWhatsApp(),
  openWhatsApp:(el)=>openWhatsApp(el.dataset.phone,el.dataset.text)
});
