'use strict';
/* Smart control center (analytics over the employee's own data). */

function smartAllRenewals(){
  normalizeRenewalImports();
  const out=[];
  (data.renewalImports||[]).forEach(r=>{
    const phone=normalizeRenewalPhone(r.phone); if(!phone)return;
    const date=normalizeRenewalDate(r.expiry||r.endDate||r.date||r.renewalDate||'');
    out.push({phone,name:r.customer||r.customerName||r.name||'',companyId:Number(r.companyId||0),company:companyName(r.companyId)||r.carrier||'',date,source:'استرداد',package:r.package||r.packageName||'',carrier:r.carrier||'',agent:r.agent||''});
  });
  data.sims.forEach(s=>{
    const date=normalizeRenewalDate(s.nextRenewal||'');
    if(date) out.push({phone:normalizeRenewalPhone(s.phone),name:s.customerName||'',companyId:Number(s.companyId||0),company:companyName(s.companyId),date,source:'الخطوط',package:'',carrier:'',agent:''});
  });
  const seen=new Map(), ded=[];
  out.forEach(x=>{if(!x.phone||!x.date)return; const k=x.companyId+'|'+x.phone; if(!seen.has(k)){seen.set(k,x);ded.push(x)}else{const old=seen.get(k); if(x.source==='استرداد')Object.assign(old,x)}});
  return ded;
}
function smartDays(date){if(!date)return null; const d=new Date(date+'T00:00:00'); if(isNaN(d))return null; const n=new Date(); n.setHours(0,0,0,0); return Math.round((d-n)/86400000)}
function smartDateText(d){if(!d)return '-'; const x=new Date(d+'T00:00:00'); if(isNaN(x))return String(d); return x.toLocaleDateString('ar',{year:'numeric',month:'2-digit',day:'2-digit'})}
function smartEsc(v){return esc(v==null?'':v)}
function smartCustomerStats(){
  const map=new Map();
  allOps().forEach(o=>{
    const name=String(o.customerName||'').trim()||'غير مسمى', phone=String(o.customerPhone||'').trim(); const key=(name+'|'+phone).toLowerCase();
    if(!map.has(key))map.set(key,{name,phone,ops:0,sales:0,profit:0,last:'',renewals:0});
    const c=map.get(key); c.ops++; c.sales+=Number(o.price||0); c.profit+=opProfit(o); if(o.type==='تجديد')c.renewals++; if(!c.last||new Date(o.date)>new Date(c.last))c.last=o.date;
  });
  return [...map.values()].filter(c=>c.name!=='غير مسمى'||c.phone).sort((a,b)=>b.profit-a.profit);
}
function smartTodayStats(){
  const now=new Date(), start=new Date(now); start.setHours(0,0,0,0); const end=new Date(now); end.setHours(23,59,59,999);
  const opsToday=allOps().filter(o=>{const d=new Date(o.date);return d>=start&&d<=end});
  const sales=opsToday.reduce((a,o)=>a+Number(o.price||0),0), profit=opsToday.reduce((a,o)=>a+opProfit(o),0);
  const pays=(data.customerPayments||[]).filter(p=>{const d=new Date(p.date);return d>=start&&d<=end}).reduce((a,p)=>a+Number(p.amount||0),0);
  const due=customerRecords().reduce((a,c)=>a+Number(c.due||0),0);
  const renew=smartAllRenewals().map(x=>({...x,days:smartDays(x.date)})).filter(x=>x.days!=null&&x.days>=0&&x.days<=7);
  return {opsToday,sales,profit,pays,due,renew};
}
function smartRenderToday(){
 const el=document.getElementById('smartToday'); if(!el)return; const t=smartTodayStats();
 const urgent=t.renew.filter(x=>x.days<=0).length, next3=t.renew.filter(x=>x.days>0&&x.days<=3).length;
 el.innerHTML=`<div class="kpi-grid"><div class="mini-card">💰 المبيعات اليوم<b>${money(t.sales)}</b></div><div class="mini-card">📈 الربح اليوم<b class="status-ok">${money(t.profit)}</b></div><div class="mini-card">💳 دفعات اليوم<b>${money(t.pays)}</b></div><div class="mini-card">🔴 ديون العملاء<b class="status-danger">${money(t.due)}</b></div></div><div class="quick-grid" style="margin-top:12px"><div class="notice">🔴 <b>${urgent}</b> تنتهي اليوم</div><div class="notice">🟠 <b>${next3}</b> خلال 3 أيام</div><div class="notice">📦 <b>${data.sims.filter(s=>s.status==='available').length}</b> مخزون</div><div class="notice">🧾 <b>${t.opsToday.length}</b> عمليات اليوم</div></div>`;
}
function smsButton(x){return `<button class="btn primary" style="padding:7px 10px" data-action="sendSmartSMS" data-phone="${esc(x.phone)}" data-name="${esc(x.name||'')}" data-date="${esc(x.date||'')}">SMS</button>`;}
function smartRenderActions(){
 const el=document.getElementById('smartActionsList'), count=document.getElementById('smartActionCount'); if(!el)return;
 const items=[]; smartAllRenewals().forEach(x=>{x.days=smartDays(x.date); if(x.days!=null&&x.days<=3&&x.days>=0)items.push({score:x.days===0?100:80-x.days*10,title:x.days===0?'ينتهي اليوم':'ينتهي خلال '+x.days+' يوم',meta:`${x.phone} · ${x.name||'بدون اسم'} · ${x.company}`,x})});
 customerRecords().filter(c=>Number(c.due||0)>0).slice(0,10).forEach(c=>items.push({score:70,title:'مبلغ مستحق',meta:`${c.name} · ${money(c.due)}`,x:null}));
 items.sort((a,b)=>b.score-a.score); count.textContent=items.length; el.innerHTML=items.slice(0,8).map(i=>`<div class="smart-row"><div><div class="smart-title ${i.score>=90?'smart-danger':'smart-warn'}">${i.score>=90?'🔴':'🟠'} ${smartEsc(i.title)}</div><div class="smart-meta">${smartEsc(i.meta)}</div></div>${i.x?smsButton(i.x):''}</div>`).join('')||'<div class="smart-empty">لا توجد إجراءات عاجلة 🎉</div>';
}
function smartRenderOpportunities(){
 const el=document.getElementById('smartOpportunitiesList'),count=document.getElementById('smartOpportunityCount'); if(!el)return;
 const arr=smartAllRenewals().map(x=>({...x,days:smartDays(x.date)})).filter(x=>x.days!=null&&x.days>=0&&x.days<=30).sort((a,b)=>a.days-b.days);
 const noName=arr.filter(x=>!x.name).length; const inactive=smartCustomerStats().filter(c=>c.last&&((Date.now()-new Date(c.last))/86400000)>45).length;
 const list=[...arr.slice(0,6).map(x=>({title:x.days===0?'تجديد اليوم':'تجديد قريب',meta:`${x.phone} · ${x.name||'بدون اسم'} · ${x.company} · ${x.days} يوم`,score:100-x.days})), ...(noName?[{title:'بيانات ناقصة',meta:`${noName} رقم تجديد بدون اسم عميل`,score:40}]:[]), ...(inactive?[{title:'عملاء يحتاجون متابعة',meta:`${inactive} عميل لم يسجل له نشاط منذ فترة طويلة`,score:30}]:[])];
 count.textContent=list.length; el.innerHTML=list.slice(0,8).map(i=>`<div class="smart-alert"><b>💎 ${smartEsc(i.title)}</b><div class="smart-meta">${smartEsc(i.meta)}</div></div>`).join('')||'<div class="smart-empty">لا توجد فرص واضحة حاليًا</div>';
}
function smartRenderLost(){
 const el=document.getElementById('smartLostList'),count=document.getElementById('smartLostCount'); if(!el)return; const now=Date.now();
 const arr=smartCustomerStats().filter(c=>c.last&&((now-new Date(c.last))/86400000)>=45).sort((a,b)=>new Date(a.last)-new Date(b.last)).slice(0,8); count.textContent=arr.length;
 el.innerHTML=arr.map(c=>`<div class="smart-row"><div><div class="smart-title">👤 ${smartEsc(c.name)}</div><div class="smart-meta">${smartEsc(c.phone)} · آخر نشاط ${smartEsc(smartDateText(c.last))} · ${Math.floor((now-new Date(c.last))/86400000)} يوم</div></div><span class="smart-chip">${c.renewals} تجديد</span></div>`).join('')||'<div class="smart-empty">لا يوجد عميل متوقف واضح حسب البيانات الحالية</div>';
}
function smartDataQuality(){
 const issues=[]; const phones=new Map(); data.sims.forEach(s=>{const p=normalizeRenewalPhone(s.phone);if(!p)issues.push('خط بدون رقم'); else {if(phones.has(p))issues.push(`رقم مكرر في الخطوط: ${p}`); else phones.set(p,s)}; if(!s.companyId)issues.push(`خط بدون شركة: ${p}`); if(s.status==='sold'&&!s.customerName)issues.push(`خط مباع بدون اسم عميل: ${p}`)});
 // Imported records store the expiry in "endDate" (older records may use "expiry").
 const ri=new Map(); (data.renewalImports||[]).forEach(r=>{const p=normalizeRenewalPhone(r.phone);const k=(r.companyId||0)+'|'+p;if(!p)issues.push('سجل تجديد بدون رقم'); else if(ri.has(k))issues.push(`تكرار مسترد: ${p}`); else ri.set(k,r); if(!r.endDate&&!r.expiry)issues.push(`رقم بدون تاريخ انتهاء: ${p}`)});
 return issues;
}
function runSmartQuality(){
 const issues=smartDataQuality(), q=document.getElementById('smartQualityList'),c=document.getElementById('smartQualityCount'),d=document.getElementById('smartDuplicates'); if(c)c.textContent=issues.length; if(q)q.innerHTML=issues.slice(0,10).map(x=>`<div class="smart-alert">⚠️ ${smartEsc(x)}</div>`).join('')||'<div class="smart-empty">✅ البيانات الأساسية تبدو سليمة</div>';
 if(d){const sims={};data.sims.forEach(s=>{const p=normalizeRenewalPhone(s.phone);if(p)(sims[p] ||= []).push(companyName(s.companyId))}); const dup=Object.entries(sims).filter(([,v])=>v.length>1); d.innerHTML=dup.map(([p,v])=>`<div class="smart-alert"><b>📱 ${smartEsc(p)}</b><div class="smart-meta">مكرر في: ${v.map(smartEsc).join(' · ')}</div></div>`).join('')||'<div class="smart-empty">لا توجد أرقام مكررة بين الشركات داخل المخزون</div>'}
}
function smartRenderCompanyPerformance(){
 const el=document.getElementById('smartCompanyPerformance');if(!el)return; const rows=data.companies.map(c=>{const ops=allOps().filter(o=>o.companyId==c.id),sales=ops.reduce((a,o)=>a+Number(o.price||0),0),profit=ops.reduce((a,o)=>a+opProfit(o),0),renew=ops.filter(o=>o.type==='تجديد').length,stock=data.sims.filter(s=>s.companyId==c.id&&s.status==='available').length,clients=new Set(ops.map(o=>String(o.customerPhone||o.customerName||'').trim()).filter(Boolean)).size;return {c,sales,profit,renew,stock,clients}}).sort((a,b)=>b.profit-a.profit);
 el.innerHTML=`<div class="tablewrap"><table class="smart-company-table"><thead><tr><th>الشركة</th><th>المبيعات</th><th>الربح</th><th>التجديدات</th><th>العملاء</th><th>المخزون</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${smartEsc(r.c.name)}</b></td><td>${money(r.sales)}</td><td class="smart-ok"><b>${money(r.profit)}</b></td><td>${r.renew}</td><td>${r.clients}</td><td>${r.stock}</td></tr>`).join('')}</tbody></table></div>`;
}
function smartRenderCustomerValue(){
 const el=document.getElementById('smartCustomerValue');if(!el)return; const arr=smartCustomerStats().slice(0,10); el.innerHTML=arr.map((c,i)=>`<div class="smart-row"><div><div class="smart-title">${i<3?'🏆':'👤'} ${smartEsc(c.name)}</div><div class="smart-meta">${smartEsc(c.phone||'بدون هاتف')} · ${c.ops} عمليات · ${c.renewals} تجديدات</div></div><b class="smart-ok">${money(c.profit)}</b></div>`).join('')||'<div class="smart-empty">لا توجد بيانات عملاء كافية</div>';
}
function smartRenderForecast(){
 const el=document.getElementById('smartForecast');if(!el)return; const arr=smartAllRenewals().map(x=>({...x,days:smartDays(x.date)})).filter(x=>x.days!=null&&x.days>=0&&x.days<=30).sort((a,b)=>a.days-b.days).slice(0,12); el.innerHTML=arr.map(x=>`<div class="smart-row"><div><div class="smart-title">${x.days===0?'🔴 اليوم':x.days<=3?'🟠 قريب جدًا':'🟡 قريب'} · ${smartEsc(x.phone)}</div><div class="smart-meta">${smartEsc(x.name||'بدون اسم')} · ${smartEsc(x.company)} · ${smartEsc(smartDateText(x.date))}</div></div><span class="smart-chip">${x.days===0?'اليوم':x.days+' يوم'}</span></div>`).join('')||'<div class="smart-empty">لا توجد تواريخ تجديد قادمة</div>';
}
function renderSmartSearch(){
 const q=(document.getElementById('smartSearch')?.value||'').trim().toLowerCase(),el=document.getElementById('smartSearchResults');if(!el)return;if(!q){el.innerHTML='<div class="smart-empty">ابدأ البحث...</div>';return}
 let renew=smartAllRenewals().map(x=>({...x,days:smartDays(x.date)})); if(q.includes('اليوم'))renew=renew.filter(x=>x.days===0); else if(q.includes('غد')||q.includes('بكرة'))renew=renew.filter(x=>x.days===1); else if(q.includes('اسبوع')||q.includes('أسبوع'))renew=renew.filter(x=>x.days>=0&&x.days<=7);
 const matches=[]; renew.forEach(x=>{const hay=(x.phone+' '+x.name+' '+x.company+' '+x.package).toLowerCase(); if(hay.includes(q)||q.includes('اليوم')||q.includes('غد')||q.includes('بكرة')||q.includes('أسبوع'))matches.push(x)});
 const sims=data.sims.filter(s=>(s.phone+' '+(s.customerName||'')+' '+companyName(s.companyId)).toLowerCase().includes(q)).slice(0,10);
 el.innerHTML=[...matches.slice(0,10).map(x=>`<div class="smart-row"><div><b>🔄 ${smartEsc(x.phone)}</b><div class="smart-meta">${smartEsc(x.name||'بدون اسم')} · ${smartEsc(x.company)} · ${smartEsc(smartDateText(x.date))}</div></div>${smsButton(x)}</div>`),...sims.map(s=>`<div class="smart-row"><div><b>📱 ${smartEsc(s.phone)}</b><div class="smart-meta">${smartEsc(s.customerName||'غير مباع')} · ${smartEsc(companyName(s.companyId))}</div></div><span class="smart-chip">${smartEsc(s.status)}</span></div>`)] .join('')||'<div class="smart-empty">لا توجد نتائج</div>';
}
function renderSmartPricing(){
 const cost=Number(document.getElementById('smartCost')?.value||0), profit=Number(document.getElementById('smartTargetProfit')?.value||0), margin=Number(document.getElementById('smartTargetMargin')?.value||0); let suggested=cost+profit; if(margin>0&&margin<100)suggested=cost/(1-margin/100); const out=document.getElementById('smartSuggestedPrice');if(out)out.value=suggested.toFixed(2)+' ₪'; const table=document.getElementById('smartPriceTable');if(!table)return; const rows=[5,10,15,20,25,30,40,50].map(p=>[cost+p,p,(p/Math.max(cost,1)*100)]);table.innerHTML=`<div class="tablewrap"><table class="smart-company-table"><thead><tr><th>سعر البيع</th><th>الربح</th><th>هامش على التكلفة</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${money(r[0])}</td><td class="smart-ok">${money(r[1])}</td><td>${r[2].toFixed(1)}%</td></tr>`).join('')}</tbody></table></div>`;
}
function openSmartSMS(windowValue){openTab('toolsTab');setTimeout(()=>{const w=document.getElementById('alertWindow');if(w)w.value=windowValue==='today'?'1':windowValue;renderRenewalAlerts();document.getElementById('renewalAlerts')?.scrollIntoView({behavior:'smooth'})},60)}
function sendSmartSMS(p,n,d){const tpl=document.getElementById('renewalAlertMessage')?.value||'الزبون العزيز، رقمكم {phone} قارب على الانتهاء، يرجى التواصل مع رامز نصار لتجديد الاشتراك. شكرًا لكم.';const msg=tpl.replaceAll('{name}',n||'عزيزي العميل').replaceAll('{phone}',p).replaceAll('{date}',d).replaceAll('{days}',String(smartDays(d))).replaceAll('{company}','');openSMS(p,msg)}
function smartRenderActivity(){const el=document.getElementById('smartActivity');if(!el)return;el.innerHTML=(data.activity||[]).slice(0,20).map(a=>`<div class="smart-row"><div><b>${smartEsc(a.text)}</b><div class="smart-meta">${smartEsc(a.type)} · ${smartEsc(a.user||'')} · ${smartEsc(new Date(a.date).toLocaleString('ar'))}</div></div></div>`).join('')||'<div class="smart-empty">لا يوجد نشاط مسجل</div>'}
function renderSmartCenter(){if(!document.getElementById('smartCenter'))return;smartRenderToday();smartRenderActions();smartRenderOpportunities();smartRenderLost();runSmartQuality();smartRenderCompanyPerformance();smartRenderCustomerValue();smartRenderForecast();renderSmartSearch();renderSmartPricing();smartRenderActivity()}

registerActions({
  runSmartQuality:()=>runSmartQuality(),
  renderSmartSearch:()=>renderSmartSearch(),
  renderSmartPricing:()=>renderSmartPricing(),
  openSmartSMS:(el)=>openSmartSMS(el.dataset.window),
  sendSmartSMS:(el)=>sendSmartSMS(el.dataset.phone||'',el.dataset.name||'',el.dataset.date||'')
});
