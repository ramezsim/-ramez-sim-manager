'use strict';
/* SIM lines, sales/renewals, dashboard, reports, daily work, exports, backup, settings. */

function renderDashboard(){
 let o=ops(),sales=o.reduce((a,x)=>a+Number(x.price||0),0),profit=o.reduce((a,x)=>a+Number(x.price||0)-Number(x.wholesale||0),0);
 document.getElementById('cCompanies').textContent=data.companies.length;
 document.getElementById('cOps').textContent=o.length;
 document.getElementById('cNew').textContent=o.filter(x=>x.type==='بيع').length;
 document.getElementById('cRenew').textContent=o.filter(x=>x.type==='تجديد').length+' تجديد';
 document.getElementById('cSales').textContent=money(sales);
 document.getElementById('cProfit').textContent=money(profit); document.getElementById('cStock').textContent=data.sims.filter(s=>s.status==='available').length;

 document.getElementById('companies').innerHTML=data.companies.map(c=>{
   let co=o.filter(x=>x.companyId==c.id),used=co.reduce((a,x)=>a+Number(x.price||0),0);
   let stock=data.sims.filter(s=>s.companyId==c.id&&s.status==='available').length;
   let limit=Math.max(used+500,1),pct=Math.min(100,Math.round(used/limit*100));
   return `<div class="company"><div class="company-head"><div style="display:flex;align-items:center;gap:10px">${companyLogoHtml(c)}<div class="company-name">${esc(c.name)}</div></div><b>${money(used)}</b></div><div class="bar"><div class="fill" style="width:${pct}%"></div></div><div class="company-bottom"><span>المخزون: ${stock}</span><span>العمليات: ${co.length}</span></div><div style="display:flex;justify-content:flex-start;margin-top:10px"><button type="button" class="btn light company-details-mini" data-action="showCompanyDetailsFromDashboard" data-id="${esc(c.id)}">📊 تفاصيل ${esc(c.name)}</button></div></div>`
 }).join('')||'<div class="empty">لا توجد شركات</div>';
 const up=document.getElementById('upcomingRenewals'); if(up){const arr=renewalRecords().slice(0,5);up.innerHTML=arr.length?arr.map(x=>`<div class="muted-box" style="margin:7px 0"><b>${esc(x.s.phone)}</b> · ${esc(x.s.customerName||'غير مسمى')}<br><span class="small">📅 ${esc(x.s.nextRenewal)} · ${x.diff===0?'اليوم':'بعد '+x.diff+' يوم'}</span></div>`).join(''):'<div class="empty">لا توجد مواعيد مسجلة</div>';}
}

function addSim(){if(!requireCloudPermission('addSim'))return;
 let phone=document.getElementById('phone').value.trim(),cid=Number(document.getElementById('company').value),w=Number(document.getElementById('wholesale').value),sp=Number(document.getElementById('salePrice').value||0);
 if(!phone)return alert('اكتب رقم الشريحة');
 if(phone.length>40)return alert('رقم الشريحة طويل جدًا');
 let existing=data.sims.find(s=>s.phone===phone);
 if(existing)return alert('الرقم موجود أصلًا. استخدم زر "تجديد" لتسجيل عملية جديدة على نفس الرقم.');
 data.sims.push({id:Date.now(),phone,companyId:cid,wholesale:w,salePrice:sp,status:'available',createdAt:nowDate(),history:[]});
 document.getElementById('phone').value='';document.getElementById('salePrice').value='';logActivity(`إضافة الخط ${phone} · ${companyName(cid)}`,'مخزون');save();alert('تمت إضافة الشريحة')
}
function sellSim(id,type='بيع'){if(!requireCloudPermission(type==='تجديد'?'renew':'sell'))return;
 let s=data.sims.find(x=>x.id==id);if(!s)return;
 let price=prompt(type==='تجديد'?'سعر التجديد (₪)؟':'سعر البيع (₪)؟',s.salePrice||'');if(price===null)return;
 price=Number(price);if(!price)return alert('أدخل سعر صحيح');
 let customerName=prompt('اسم الزبون؟',s.customerName||'');if(customerName===null)return;
 customerName=customerName.trim()||'زبون غير مسمى';
 let customerPhone=prompt('رقم الزبون (اختياري)؟',s.customerPhone||'');if(customerPhone===null)return;
 let paid=prompt('المبلغ المدفوع الآن (₪)؟',String(price));if(paid===null)return;
 paid=Math.max(0,Number(paid)||0); if(paid>price) paid=price;
 let nextRenewal=prompt('موعد التجديد القادم (YYYY-MM-DD)؟',s.nextRenewal||'');if(nextRenewal===null)return;
 let note=prompt('ملاحظة على العملية (اختياري)؟',s.notes||'');if(note===null)return;
 let discount=prompt('الخصم (₪)؟','0');if(discount===null)return; discount=Math.max(0,Number(discount)||0);
 let extra=prompt('مصاريف/عمولة على العملية (₪)؟','0');if(extra===null)return; extra=Math.max(0,Number(extra)||0);
 let date=nowDate(),invoice='INV-'+new Date().getFullYear()+'-'+String(data.invoiceSeq++).padStart(6,'0');
 s.salePrice=price;s.status='sold';s.soldAt=date;s.customerName=customerName;s.customerPhone=customerPhone.trim();s.nextRenewal=nextRenewal.trim();s.notes=note.trim();
 s.history.push({type,price,wholesale:s.wholesale,date,customerName,customerPhone:s.customerPhone,paid,nextRenewal:s.nextRenewal,note:s.notes,operator:currentUser().name,discount,expense:extra,invoice});
 logActivity(`${type} ${s.phone} · ${customerName} · ${money(Math.max(0,price-discount))}`,'عملية'); save();
 notify(`${type==='تجديد'?'🔄 تم تسجيل التجديد':'💰 تم تسجيل البيع'} للرقم ${s.phone}`);
}
function renewSim(id){sellSim(id,'تجديد')}
function renderSims(){
 let q=(document.getElementById('search')?.value||'').trim(),rows=data.sims.filter(s=>String(s.phone).includes(q));
 document.getElementById('simTable').innerHTML=rows.length?rows.map(s=>{
   let count=s.history?.length||0,last=s.history?.at(-1),due=last?Number(last.price||0)-Number(last.paid||0):0;
   let status=due>0?'غير مكتمل':(last?'مدفوع':'متوفرة');
   const id=esc(s.id);
   return `<tr><td>${esc(s.phone)}</td><td>${esc(companyName(s.companyId))}</td><td>${money(s.wholesale)}</td><td>${count}</td><td><span class="badge ${due>0?'borange':(s.status==='sold'?'bblue':'bgreen')}">${esc(status)}</span></td><td>${s.status==='available'?`<button class="btn success" style="padding:7px 9px" data-action="sellSim" data-id="${id}">بيع</button>`:`<button class="btn primary" style="padding:7px 9px" data-action="renewSim" data-id="${id}">تجديد</button>`} <button class="btn light" style="padding:7px 9px" data-action="historySim" data-id="${id}">السجل</button> <button class="btn light" style="padding:7px 9px" data-action="editSimMeta" data-id="${id}">📝 ملاحظات</button> <button class="btn light" style="padding:7px 9px" data-action="changeSimStatus" data-id="${id}">⚙️ حالة</button></td></tr>`
 }).join(''):'<tr><td colspan="6" class="empty">لا توجد شرائح</td></tr>'
}
function historySim(id){
 let s=data.sims.find(x=>x.id==id),h=s?.history||[];
 alert(h.length?`سجل ${s.phone}\n\n`+h.map((x,i)=>`${i+1}. ${x.type} | ${x.customerName||'غير مسمى'} | ${new Date(x.date).toLocaleString('ar')}\nالمبلغ: ${money(x.price)} | المدفوع: ${money(x.paid||0)} | المتبقي: ${money((x.price||0)-(x.paid||0))} | الربح: ${money(x.price-x.wholesale)}`).join('\n\n'):'لا توجد عمليات لهذا الرقم');
}
function editSimMeta(id){if(!requireCloudPermission('simNote'))return;let s=data.sims.find(x=>x.id==id);if(!s)return;let note=prompt('ملاحظات الخط؟',s.notes||'');if(note===null)return;let next=prompt('موعد التجديد القادم YYYY-MM-DD؟',s.nextRenewal||'');if(next===null)return;s.notes=note.trim();s.nextRenewal=next.trim();save();notify('📝 تم تحديث بيانات الخط');}
function changeSimStatus(id){if(!requireCloudPermission('simStatus'))return;let s=data.sims.find(x=>x.id==id);if(!s)return;let v=prompt('الحالة: متوفر / محجوز / مباع / ملغي',s.status==='available'?'متوفر':s.status==='reserved'?'محجوز':s.status==='sold'?'مباع':'ملغي');if(v===null)return;v=v.trim();let map={'متوفر':'available','محجوز':'reserved','مباع':'sold','ملغي':'cancelled','available':'available','reserved':'reserved','sold':'sold','cancelled':'cancelled'};if(!map[v])return alert('الحالة غير صحيحة');s.status=map[v];save();}
function openQuickSell(){let phone=prompt('رقم الخط للبيع السريع؟','');if(!phone)return;let s=data.sims.find(x=>String(x.phone).trim()===phone.trim());if(!s)return alert('الخط غير موجود. أضفه أولًا.');if(s.status!=='available')return alert('هذا الخط مباع أو محجوز.');sellSim(s.id,'بيع')}
function openQuickRenew(){let phone=prompt('رقم الخط للتجديد السريع؟','');if(!phone)return;let s=data.sims.find(x=>String(x.phone).trim()===phone.trim());if(!s)return alert('الخط غير موجود.');renewSim(s.id)}

function renderGlobalSearch(){const q=(document.getElementById('globalSearch')?.value||'').trim().toLowerCase();const el=document.getElementById('globalResults');if(!el)return;if(!q){el.innerHTML='<div class="empty">اكتب رقمًا أو اسمًا للبحث في الخطوط والعملاء والشركات</div>';return;}let sims=data.sims.filter(s=>(s.phone+' '+(s.customerName||'')+' '+(s.customerPhone||'')+' '+companyName(s.companyId)).toLowerCase().includes(q));let cs=customerRecords().filter(c=>(c.name+' '+c.phone).toLowerCase().includes(q));let companies=data.companies.filter(c=>String(c.name||'').toLowerCase().includes(q));let html='';companies.forEach(c=>html+=`<div class="company"><b>🏢 ${esc(c.name)}</b><div class="small">سعر الجملة الافتراضي: ${money(c.price)}</div></div>`);sims.forEach(s=>html+=`<div class="company"><div class="company-head"><div><b>📱 ${esc(s.phone)}</b><div class="company-meta">${esc(s.customerName||'غير مباع')} · ${esc(companyName(s.companyId))}</div></div><button class="btn primary" style="padding:8px 11px" data-action="openSimInList" data-phone="${esc(s.phone)}">فتح</button></div></div>`);cs.forEach(c=>html+=`<div class="company"><div class="company-head"><div><b>👤 ${esc(c.name)}</b><div class="company-meta">${esc(c.phone||'لا يوجد رقم')} · المتبقي ${money(c.due)}</div></div><button class="btn primary" style="padding:8px 11px" data-action="showStatement" data-key="${esc(c.key)}">كشف</button></div></div>`);el.innerHTML=html||'<div class="empty">لا توجد نتائج</div>';}
function openSimInList(phone){openTab('sims');const s=document.getElementById('search');if(s)s.value=phone;renderSims();}

function renderReport(){
 let o=ops(),sales=o.reduce((a,x)=>a+Number(x.price||0),0),cost=o.reduce((a,x)=>a+Number(x.wholesale||0),0),profit=sales-cost;
 let rows=data.companies.map(c=>{let x=o.filter(a=>a.companyId==c.id);return {name:c.name,count:x.length,sales:x.reduce((a,z)=>a+Number(z.price||0),0),profit:x.reduce((a,z)=>a+Number(z.price||0)-Number(z.wholesale||0),0)}}).filter(x=>x.count);
 const maxSales=Math.max(1,...rows.map(r=>r.sales)); const chart=rows.length?`<div class="chart">${rows.map(r=>`<div class="barcol" title="${esc(r.name)}"><b style="font-size:10px">${money(r.sales)}</b><div class="barv" style="height:${Math.max(4,Math.round(r.sales/maxSales*120))}px"></div><span>${esc(r.name)}</span></div>`).join('')}</div>`:'';
 const dayMap={};o.forEach(x=>{const k=new Date(x.date).toLocaleDateString('en-CA');dayMap[k]=(dayMap[k]||0)+Number(x.price||0)});const days=Object.entries(dayMap).sort((a,b)=>a[0].localeCompare(b[0])).slice(-7);const maxDay=Math.max(1,...days.map(x=>x[1]));const dailyChart=days.length?`<div class="chart">${days.map(x=>`<div class="barcol"><b style="font-size:9px">${money(x[1])}</b><div class="barv" style="height:${Math.max(4,Math.round(x[1]/maxDay*120))}px"></div><span>${esc(x[0].slice(5))}</span></div>`).join('')}</div>`:'<div class="empty">لا توجد مبيعات في الفترة</div>';
 document.getElementById('report').innerHTML=`<div class="cards"><div class="card"><div class="label">المبيعات</div><div class="big">${money(sales)}</div></div><div class="card"><div class="label">التكلفة</div><div class="big">${money(cost)}</div></div><div class="card"><div class="label">الربح</div><div class="big green">${money(profit)}</div></div><div class="card"><div class="label">الديون الحالية</div><div class="big red">${money(customerRecords().reduce((a,c)=>a+c.due,0))}</div></div></div><div class="panel" style="margin-top:14px;padding:12px"><h3 style="margin:0">📅 المبيعات اليومية</h3>${dailyChart}</div><div class="panel" style="margin-top:14px;padding:12px"><h3 style="margin:0">📈 المبيعات حسب الشركة</h3>${chart||'<div class="empty">لا توجد بيانات</div>'}</div><div class="tablewrap" style="margin-top:14px"><table><thead><tr><th>الشركة</th><th>العمليات</th><th>المبيعات</th><th>الربح</th><th>المخزون</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.count}</td><td>${money(r.sales)}</td><td>${money(r.profit)}</td><td>${data.sims.filter(s=>s.companyId==data.companies.find(c=>c.name===r.name)?.id&&s.status==='available').length}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">لا توجد بيانات</td></tr>'}</tbody></table></div>`
}
function printReport(){
 let o=ops(),sales=o.reduce((a,x)=>a+Number(x.price||0),0),cost=o.reduce((a,x)=>a+Number(x.wholesale||0),0),profit=sales-cost;
 let rows=o.sort((a,b)=>new Date(a.date)-new Date(b.date)).map(x=>`<tr><td>${esc(new Date(x.date).toLocaleDateString('ar'))}</td><td>${esc(x.phone)}</td><td>${esc(companyName(x.companyId))}</td><td>${esc(x.type)}</td><td>${money(x.price)}</td><td>${money(x.price-x.wholesale)}</td></tr>`).join('');
 printWindow('تقرير المبيعات',`<h1>Ramez SIM Manager</h1><h2>تقرير المبيعات</h2><p>عدد العمليات: ${o.length} | المبيعات: ${money(sales)} | الأرباح: ${money(profit)}</p><table><thead><tr><th>التاريخ</th><th>الرقم</th><th>الشركة</th><th>العملية</th><th>البيع</th><th>الربح</th></tr></thead><tbody>${rows}</tbody></table>`);
}

function renderDaily(){const el=document.getElementById('dailyOverview');if(!el)return;const todayOps=allOps().filter(o=>new Date(o.date).toDateString()===new Date().toDateString());const sales=todayOps.reduce((a,o)=>a+opNet(o),0),profit=todayOps.reduce((a,o)=>a+opProfit(o),0),payments=(data.customerPayments||[]).filter(p=>new Date(p.date).toDateString()===new Date().toDateString()).reduce((a,p)=>a+Number(p.amount||0),0),due=customerRecords().reduce((a,c)=>a+c.due,0),renew=renewalRecords().filter(x=>x.diff>=0&&x.diff<=7);el.innerHTML=`<div class="kpi-grid"><div class="mini-card">💰 المبيعات اليوم<b>${money(sales)}</b></div><div class="mini-card">📈 صافي الربح<b class="status-ok">${money(profit)}</b></div><div class="mini-card">💳 دفعات اليوم<b>${money(payments)}</b></div><div class="mini-card">🔴 إجمالي الديون<b class="status-danger">${money(due)}</b></div></div><div class="quick-grid" style="margin-top:12px"><div class="notice">🔄 <b>${renew.length}</b> تجديدات خلال 7 أيام</div><div class="notice">📦 <b>${data.sims.filter(s=>s.status==='available').length}</b> خطوط متوفرة</div><div class="notice">👥 <b>${customerRecords().length}</b> عملاء</div><div class="notice">🧾 <b>${todayOps.length}</b> عمليات اليوم</div></div>`;const al=document.getElementById('activityList');if(al)al.innerHTML=(data.activity||[]).slice(0,12).map(a=>`<div style="padding:9px 0;border-bottom:1px solid var(--line)"><b>${esc(a.text)}</b><div class="small">${esc(a.type)} · ${esc(a.user||'')} · ${esc(new Date(a.date).toLocaleString('ar'))}</div></div>`).join('')||'<div class="empty">لا يوجد نشاط مسجل بعد</div>'}

function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
// Neutralises spreadsheet formulas (=,+,-,@) so exported CSV cannot run anything in Excel.
function csvCell(v){let s=String(v??'');if(/^[=+\-@\t\r]/.test(s)&&!/^-?\d+(\.\d+)?$/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
function exportCSV(kind){let rows=[],name='ramez-'+kind+'.csv';if(kind==='customers'){rows=[['الاسم','الهاتف','إجمالي الخدمات','المدفوع','المتبقي'],...customerRecords().map(c=>[c.name,c.phone,c.total,c.paid,c.due])]}else if(kind==='sales'){rows=[['التاريخ','الفاتورة','النوع','الخط','العميل','الشركة','المبلغ','الخصم','المصاريف','الربح','الموظف'],...allOps().map(o=>[o.date,o.invoice||'',o.type,o.phone,o.customerName||'',companyName(o.companyId),opNet(o),o.discount||0,o.expense||0,opProfit(o),o.operator||''])]}else if(kind==='payments'){rows=[['التاريخ','العميل','الهاتف','المبلغ','الملاحظة','الموظف'],...(data.customerPayments||[]).map(p=>[p.date,p.customerName,p.customerPhone,p.amount,p.note||'',p.operator||''])]}else{rows=[['الخط','الشركة','الحالة','الجملة','سعر البيع','العميل','الهاتف'],...data.sims.map(s=>[s.phone,companyName(s.companyId),s.status,s.wholesale,s.salePrice,s.customerName||'',s.customerPhone||''])]};const csv='﻿'+rows.map(r=>r.map(csvCell).join(',')).join('\n');downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),name);notify('📤 تم تصدير CSV')}
function periodStats(from,to){const a=new Date(from+'T00:00:00'),b=new Date(to+'T23:59:59');const arr=allOps().filter(o=>{const d=new Date(o.date);return d>=a&&d<=b});return {count:arr.length,sales:arr.reduce((x,o)=>x+opNet(o),0),profit:arr.reduce((x,o)=>x+opProfit(o),0)}}
function comparePeriods(){const f1=document.getElementById('cmpFrom1').value,t1=document.getElementById('cmpTo1').value,f2=document.getElementById('cmpFrom2').value,t2=document.getElementById('cmpTo2').value;if(!f1||!t1||!f2||!t2)return alert('حدد الفترتين أولًا');const a=periodStats(f1,t1),b=periodStats(f2,t2);const diff=(x,y)=>y?Math.round((x-y)/y*100):0;document.getElementById('comparisonResult').innerHTML=`<div class="cards"><div class="card"><div class="label">الفترة الأولى</div><div class="big">${money(a.sales)}</div><div class="sub">ربح ${money(a.profit)} · ${a.count} عملية</div></div><div class="card"><div class="label">الفترة الثانية</div><div class="big">${money(b.sales)}</div><div class="sub">ربح ${money(b.profit)} · ${b.count} عملية</div></div><div class="card"><div class="label">تغير المبيعات</div><div class="big ${diff(b.sales,a.sales)>=0?'green':'red'}">${diff(b.sales,a.sales)}%</div></div><div class="card"><div class="label">تغير الأرباح</div><div class="big ${diff(b.profit,a.profit)>=0?'green':'red'}">${diff(b.profit,a.profit)}%</div></div></div>`}

// ---- backup ----
function chooseBackupFile(){document.getElementById('backupFile').click()}
function restoreData(raw,sourceLabel){
  try{
    if(!raw || typeof raw!=='object' || !Array.isArray(raw.companies) || !Array.isArray(raw.sims)) throw new Error('صيغة النسخة الاحتياطية غير صحيحة');
    if(!confirm(`سيتم استبدال البيانات الحالية ببيانات ${sourceLabel}. هل تريد المتابعة؟`)) return;
    data={...raw,companies:raw.companies,sims:raw.sims,customerPayments:Array.isArray(raw.customerPayments)?raw.customerPayments:[]};
    normalize();
    if(typeof Sync!=='undefined') Sync.markChanged();
    goHome();
    notify('✅ تم استرجاع النسخة الاحتياطية بنجاح');
  }catch(e){alert('تعذر استرجاع النسخة الاحتياطية: '+e.message)}
}
function importBackupFile(input){
  const file=input.files?.[0];
  input.value='';
  if(!file)return;
  if(file.size>50*1024*1024)return alert('الملف كبير جدًا.');
  const reader=new FileReader();
  reader.onload=()=>{
    try{restoreData(JSON.parse(reader.result),'الملف الذي اخترته')}
    catch(e){alert('الملف ليس نسخة JSON صالحة.')}
  };
  reader.onerror=()=>alert('تعذر قراءة الملف.');
  reader.readAsText(file,'utf-8');
}
function exportData(){downloadBlob(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'ramez-sim-backup.json');notify('💾 تم تصدير نسخة احتياطية')}

// ---- settings ----
function saveSettings(){if(!requireCloudPermission('settings'))return;data.settings ||= {};data.settings.storeName=document.getElementById('storeName')?.value||'Ramez SIM Manager';data.settings.storeWhatsApp=document.getElementById('storeWhatsApp')?.value||'';data.settings.autoLock=Number(document.getElementById('autoLock')?.value||0);save();Idle.bump();notify('⚙️ تم حفظ الإعدادات');}
function loadSettings(){const st=data.settings||{};const set=(id,v)=>{const el=document.getElementById(id);if(el&&document.activeElement!==el)el.value=v;};set('storeName',st.storeName||'Ramez SIM Manager');set('storeWhatsApp',st.storeWhatsApp||'');set('autoLock',String(st.autoLock||0));}
async function cloudSyncNow(){
  if(!Auth.user)return alert('سجّل الدخول أولًا.');
  if(Sync.conflict){showSyncConflict(Sync.conflict);return false;}
  if(!Sync.hasUnsynced()){notify('☁️ كل البيانات محفوظة في السحابة');return true;}
  const ok=await Sync.flushNow(); notify(ok?'☁️ تم حفظ البيانات في السحابة':'⚠️ تعذر حفظ البيانات في السحابة'); return ok;
}

registerActions({
  addSim:()=>addSim(),
  sellSim:(el)=>sellSim(el.dataset.id),
  renewSim:(el)=>renewSim(el.dataset.id),
  historySim:(el)=>historySim(el.dataset.id),
  editSimMeta:(el)=>editSimMeta(el.dataset.id),
  changeSimStatus:(el)=>changeSimStatus(el.dataset.id),
  renderSims:()=>renderSims(),
  openQuickSell:()=>openQuickSell(),
  openQuickRenew:()=>openQuickRenew(),
  renderGlobalSearch:()=>renderGlobalSearch(),
  openSimInList:(el)=>openSimInList(el.dataset.phone||''),
  printReport:()=>printReport(),
  exportData:()=>exportData(),
  exportCSV:(el)=>exportCSV(el.dataset.kind),
  comparePeriods:()=>comparePeriods(),
  chooseBackupFile:()=>chooseBackupFile(),
  importBackupFile:(el)=>importBackupFile(el),
  saveSettings:()=>saveSettings(),
  cloudSyncNow:()=>cloudSyncNow()
});
