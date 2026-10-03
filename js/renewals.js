'use strict';
/* Renewals: upcoming renewals of own lines, import of carrier Excel/CSV files,
   renewal alerts + SMS queue. Imported values are treated as untrusted text:
   phones are reduced to digits, every field is length-limited and always
   rendered through esc(). */

const IMPORT_MAX_FILE = 20*1024*1024;          // 20 MB upload
const IMPORT_MAX_UNZIPPED = 80*1024*1024;      // 80 MB per decompressed xlsx part
const IMPORT_MAX_ROWS = 50000;
const IMPORT_MAX_FIELD = 200;
const clip = v => String(v??'').slice(0, IMPORT_MAX_FIELD);

function renewalRecords(){const now=new Date();const arr=[];data.sims.forEach(s=>{if(!s.nextRenewal)return;const d=new Date(s.nextRenewal+'T23:59:59');if(isNaN(d))return;const diff=Math.ceil((d-now)/86400000);if(diff>=0)arr.push({s,d,diff});});return arr.sort((a,b)=>a.diff-b.diff);}
function renderRenewals(){const q=(document.getElementById('renewalSearch')?.value||'').trim().toLowerCase();const w=document.getElementById('renewalWindow')?.value||'30';let arr=renewalRecords().filter(x=>(w==='all'||x.diff<=Number(w)) && ((x.s.phone+' '+(x.s.customerName||'')+' '+companyName(x.s.companyId)).toLowerCase().includes(q)));const el=document.getElementById('renewalList');if(!el)return;el.innerHTML=arr.length?arr.map(x=>{let c=x.s.customerPhone||'';return `<div class="company"><div class="company-head"><div><div class="company-name">${esc(x.s.phone)}</div><div class="company-meta">${esc(x.s.customerName||'غير مسمى')} · ${esc(companyName(x.s.companyId))}</div></div><span class="pill ${x.diff<=3?'danger-text':''}">${x.diff===0?'اليوم':x.diff===1?'غدًا':'بعد '+x.diff+' يوم'}</span></div><div class="company-bottom" style="margin-top:8px"><span>📅 ${esc(x.s.nextRenewal)}</span><span>${money(x.s.salePrice||0)}</span></div><div style="display:flex;gap:7px;margin-top:10px;flex-wrap:wrap"><button class="btn primary" style="padding:8px 11px" data-action="renewSim" data-id="${esc(x.s.id)}">🔄 تسجيل تجديد</button>${c?`<button class="btn success" style="padding:8px 11px" data-action="openWhatsApp" data-phone="${esc(c)}" data-text="${esc('تذكير بتجديد الخط '+x.s.phone)}">💬 واتساب</button>`:''}</div></div>`}).join(''):'<div class="empty">لا توجد تجديدات قادمة ضمن الفترة المحددة</div>';}

function normalizeRenewalPhone(v){
  let x=String(v??'').replace(/ /g,' ').trim().replace(/\.0+$/,'').replace(/[^0-9+]/g,'').slice(0,20);
  if(!x)return '';
  if(x.startsWith('+970')) x='0'+x.slice(4);
  else if(x.startsWith('970')) x='0'+x.slice(3);
  else if(x.startsWith('+972')) x='0'+x.slice(4);
  else if(x.startsWith('972')) x='0'+x.slice(3);
  if(/^5\d{8}$/.test(x)) x='0'+x;
  return x;
}
function renewalValue(row,names){
  const keys=Object.keys(row||{});
  const norm=v=>String(v??'').replace(/^﻿/,'').trim().toLowerCase().replace(/[\s_\-–—():/\\]+/g,'');
  const wanted=names.map(norm);
  for(const key of keys){
    const nk=norm(key);
    if(wanted.includes(nk)){
      const v=String(row[key]??'').trim(); if(v)return v;
    }
  }
  for(const key of keys){
    const nk=norm(key);
    if(wanted.some(n=>n && (nk.includes(n)||n.includes(nk)))){
      const v=String(row[key]??'').trim(); if(v)return v;
    }
  }
  return '';
}
function renewalHeaderScore(row){
  const joined=Object.values(row||{}).map(v=>String(v??'').trim().toLowerCase()).join(' | ');
  let score=0;
  if(/رقم.*(الهاتف|الخط|الموبايل)|الهاتف|mobile|phone|msisdn/.test(joined))score+=5;
  if(/اسم.*(الزبون|العميل|المشترك)|customer|name/.test(joined))score+=2;
  if(/تاريخ.*(انتهاء|نهاية)|expiry|expiration|end date/.test(joined))score+=2;
  if(/اسم.*(الرزمة|الباقة)|package/.test(joined))score+=1;
  return score;
}
function matrixToRenewalRows(matrix){
  if(!Array.isArray(matrix)||!matrix.length)return [];
  let headerIndex=0,best=-1;
  for(let i=0;i<Math.min(matrix.length,20);i++){
    const obj={};(matrix[i]||[]).forEach((v,j)=>obj[String(j)]=v);
    const score=renewalHeaderScore(obj);if(score>best){best=score;headerIndex=i;}
  }
  const headers=(matrix[headerIndex]||[]).map((v,i)=>String(v??'').replace(/^﻿/,'').trim()||`عمود ${i+1}`);
  const objects=[];
  for(let i=headerIndex+1;i<matrix.length && objects.length<IMPORT_MAX_ROWS;i++){
    const vals=matrix[i]||[];if(!vals.some(v=>String(v??'').trim()))continue;
    const obj={};headers.forEach((h,j)=>obj[h]=vals[j]??'');objects.push(obj);
  }
  return objects;
}
function normalizeRenewalDate(v){
  if(v===null||v===undefined||String(v).trim()==='') return '';
  if(v instanceof Date && !isNaN(v)) return v.toISOString().slice(0,10);
  let x=String(v).trim().replace(/^﻿/,'');
  if(!x) return '';
  // Excel serial date, e.g. 45900. The 1899-12-30 base matches Excel's Windows date system.
  if(/^\d+(?:\.\d+)?$/.test(x)){
    const n=Number(x);
    if(n>20000 && n<80000){
      const d=new Date(Date.UTC(1899,11,30)+Math.round(n)*86400000);
      if(!isNaN(d)) return d.toISOString().slice(0,10);
    }
  }
  // ISO / ISO datetime
  let m=x.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if(m){
    const y=Number(m[1]),mo=Number(m[2]),day=Number(m[3]);
    if(y>=1900&&mo>=1&&mo<=12&&day>=1&&day<=31) return `${y}-${String(mo).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  // Common DD/MM/YYYY or DD-MM-YYYY formats.
  m=x.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
  if(m){
    const a=Number(m[1]),b=Number(m[2]),y=Number(m[3]);
    let day=a,mo=b;
    // If the first part is >12 it must be the day; otherwise default to DD/MM/YYYY.
    if(a<=12 && b>12){ day=b;mo=a; }
    if(y>=1900&&mo>=1&&mo<=12&&day>=1&&day<=31) return `${y}-${String(mo).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  const d=new Date(x);
  if(!isNaN(d)) return d.toISOString().slice(0,10);
  return clip(x);
}
function buildRenewalRecord(r){return {
  phone:normalizeRenewalPhone(renewalValue(r,['رقم الهاتف','الهاتف','رقم الخط','رقم الموبايل','الجوال','رقم الجوال','מספר טלפון','מספר הטלפון','mobile','phone','msisdn'])),
  simNumber:clip(String(renewalValue(r,['رقم الشريحة','رقم السيم','ICCID','sim','iccid'])||'').trim()),
  customerName:clip(renewalValue(r,['اسم الزبون','اسم العميل','اسم المشترك','العميل','الزبون','اسم العميل/المشترك','customer','customer name','subscriber','name'])),
  endDate:normalizeRenewalDate(renewalValue(r,['تاريخ نهاية الرزمة','تاريخ الانتهاء','تاريخ نهاية الباقة','تاريخ انتهاء الرزمة','تاريخ انتهاء الباقة','تاريخ نهاية الحزمة','تاريخ انتهاء الحزمة','expiry','expiration','end date','expiry date'])),
  packageName:clip(renewalValue(r,['اسم الرزمة','اسم الباقة','الرزمة','الباقة','package'])),
  carrier:clip(renewalValue(r,['شركة الاتصالات','شركة الإتصالات','الشركة','carrier','operator'])),
  agent:clip(renewalValue(r,['اسم الوكيل','الوكيل','agent']))
};}
async function inflateCapped(raw){
  const ds=new DecompressionStream('deflate-raw');
  const reader=new Blob([raw]).stream().pipeThrough(ds).getReader();
  const chunks=[];let total=0;
  for(;;){
    const {done,value}=await reader.read(); if(done)break;
    total+=value.length;
    if(total>IMPORT_MAX_UNZIPPED){try{reader.cancel();}catch(e){} throw new Error('ملف Excel كبير جدًا بعد فك الضغط.');}
    chunks.push(value);
  }
  const out=new Uint8Array(total);let off=0;for(const c of chunks){out.set(c,off);off+=c.length;}
  return out;
}
async function readXlsxMatrix(arrayBuffer){
  const bytes=new Uint8Array(arrayBuffer), view=new DataView(arrayBuffer);
  const u16=(o)=>view.getUint16(o,true), u32=(o)=>view.getUint32(o,true);
  let eocd=-1; const min=Math.max(0,bytes.length-65557);
  for(let i=bytes.length-22;i>=min;i--){if(u32(i)===0x06054b50){eocd=i;break;}}
  if(eocd<0)throw new Error('ملف Excel غير صالح أو غير مدعوم.');
  const cdSize=u32(eocd+12), cdOffset=u32(eocd+16);
  if(cdOffset+cdSize>bytes.length)throw new Error('ملف Excel تالف.');
  const entries=new Map(); let pos=cdOffset, end=cdOffset+cdSize;
  const dec=new TextDecoder('utf-8');
  while(pos<end){
    if(u32(pos)!==0x02014b50)break;
    const method=u16(pos+10), compSize=u32(pos+20), uncompSize=u32(pos+24);
    const nameLen=u16(pos+28), extraLen=u16(pos+30), commentLen=u16(pos+32), localOffset=u32(pos+42);
    const name=dec.decode(bytes.slice(pos+46,pos+46+nameLen));
    entries.set(name,{method,compSize,uncompSize,localOffset});
    pos+=46+nameLen+extraLen+commentLen;
  }
  const readEntry=async(name)=>{
    const meta=entries.get(name);if(!meta)throw new Error('ملف Excel ناقص: '+name);
    const o=meta.localOffset;
    if(o+30>bytes.length||u32(o)!==0x04034b50)throw new Error('تعذر قراءة ملف Excel.');
    const nameLen=u16(o+26),extraLen=u16(o+28),dataStart=o+30+nameLen+extraLen;
    const raw=bytes.slice(dataStart,dataStart+meta.compSize);
    if(meta.method===0)return raw;
    if(meta.method===8){
      if(typeof DecompressionStream==='undefined')throw new Error('متصفحك لا يدعم قراءة ملفات Excel المضغوطة. استخدم CSV من Sky.');
      return inflateCapped(raw);
    }
    throw new Error('نوع ضغط Excel غير مدعوم.');
  };
  const xml=async(name)=>new DOMParser().parseFromString(dec.decode(await readEntry(name)),'application/xml');
  const wb=await xml('xl/workbook.xml');
  const relDoc=await xml('xl/_rels/workbook.xml.rels');
  const rels={};
  relDoc.querySelectorAll('Relationship').forEach(r=>{rels[r.getAttribute('Id')]=r.getAttribute('Target')||'';});
  let shared=[];
  if(entries.has('xl/sharedStrings.xml')){
    const ss=await xml('xl/sharedStrings.xml');
    ss.querySelectorAll('si').forEach(si=>shared.push(Array.from(si.querySelectorAll('t')).map(t=>t.textContent||'').join('')));
  }
  const nsFix=(target)=>{
    let t=String(target||'').replace(/^\/+/, '');
    if(t.startsWith('xl/'))return t;
    if(t.startsWith('/'))return t.slice(1);
    return 'xl/'+t.replace(/^\.\//,'');
  };
  const sheets=[];
  wb.querySelectorAll('sheet').forEach(sh=>sheets.push({name:sh.getAttribute('name')||'Sheet',path:nsFix(rels[sh.getAttribute('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]||rels[sh.getAttribute('r:id')]||'')}));
  if(!sheets.length)throw new Error('ملف Excel لا يحتوي على أوراق.');
  const colIndex=(ref)=>{const m=String(ref||'').match(/^([A-Z]+)/i);if(!m)return 0;let n=0;for(const ch of m[1].toUpperCase())n=n*26+ch.charCodeAt(0)-64;return Math.min(n-1,500);};
  const matrices=[];
  for(const sh of sheets){
    if(!entries.has(sh.path))continue;
    const doc=await xml(sh.path), matrix=[];
    doc.querySelectorAll('sheetData > row').forEach(row=>{
      if(matrix.length>IMPORT_MAX_ROWS)return;
      const vals=[];
      row.querySelectorAll(':scope > c').forEach(c=>{
        const ref=c.getAttribute('r')||'', idx=colIndex(ref), type=c.getAttribute('t')||'';
        let val='';
        if(type==='inlineStr')val=Array.from(c.querySelectorAll('is t')).map(t=>t.textContent||'').join('');
        else if(type==='s'){const v=c.querySelector('v');val=v?String(shared[Number(v.textContent)]??''):'';}
        else if(type==='str'){const v=c.querySelector('v');val=v?v.textContent||'':'';}
        else {const v=c.querySelector('v');val=v?v.textContent||'':'';}
        vals[idx]=val;
      });
      matrix.push(vals);
    });
    matrices.push({name:sh.name,matrix});
  }
  return matrices;
}
async function rowsFromRenewalXlsx(arrayBuffer){
  const sheets=await readXlsxMatrix(arrayBuffer); let best=[];
  for(const sh of sheets){const candidate=matrixToRenewalRows(sh.matrix).map(buildRenewalRecord).filter(r=>r.phone);if(candidate.length>best.length)best=candidate;}
  return best;
}
function parseRenewalCSV(text){
  text=String(text||'').replace(/^﻿/,'');
  const sample=text.split(/\r?\n/).slice(0,10).join('\n');
  const counts={',':(sample.match(/,/g)||[]).length,';':(sample.match(/;/g)||[]).length,'\t':(sample.match(/\t/g)||[]).length,'|':(sample.match(/\|/g)||[]).length};
  const delimiter=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0]||',';
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i],next=text[i+1];
    if(ch==='"'){if(quoted&&next==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(ch===delimiter&&!quoted){row.push(cell);cell='';}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&next==='\n')i++;row.push(cell);cell='';if(row.some(v=>String(v).trim()))rows.push(row);row=[];if(rows.length>IMPORT_MAX_ROWS)break;}
    else cell+=ch;
  }
  row.push(cell);if(row.some(v=>String(v).trim()))rows.push(row);return rows;
}
function csvToRenewalRows(text){return matrixToRenewalRows(parseRenewalCSV(text)).map(buildRenewalRecord).filter(r=>r.phone);}
function previewRenewalImport(input){
  const file=input.files?.[0];input.value='';if(!file)return;
  const companyId=Number(document.getElementById('renewalImportCompany')?.value||0);
  const status=document.getElementById('renewalImportStatus'),preview=document.getElementById('renewalImportPreview');
  preview.innerHTML='';
  if(file.size>IMPORT_MAX_FILE){status.textContent='❌ الملف كبير جدًا (الحد 20MB).';return;}
  status.textContent='⏳ جارٍ قراءة الملف...';
  const ext=(file.name.split('.').pop()||'').toLowerCase();const isCSV=ext==='csv'||/text\/csv/i.test(file.type);
  const reader=new FileReader();
  reader.onload=async e=>{try{
    let rows=[];
    if(isCSV){status.textContent='⏳ جارٍ تحليل ملف CSV...';rows=csvToRenewalRows(e.target.result);}
    else{status.textContent='⏳ جارٍ قراءة ملف Excel...';rows=await rowsFromRenewalXlsx(e.target.result);}
    if(!rows.length)throw new Error('لم أجد أرقام هواتف. تأكد أن الملف يحتوي عمودًا مثل "رقم الهاتف" أو "الهاتف" أو Phone / Mobile.');
    window.__pendingRenewalImports={companyId,rows};const dup=rows.length-new Set(rows.map(r=>r.phone)).size;
    status.innerHTML=`✅ تم العثور على <b>${rows.length}</b> رقم${dup?`، منها <b>${dup}</b> تكرار داخل الملف`:''}.`;
    preview.innerHTML=`<div class="muted-box" style="margin-top:10px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b>معاينة قبل الحفظ</b><button class="btn success" data-action="savePendingRenewalImports">💾 استرداد وحفظ</button></div><div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>رقم الهاتف</th><th>اسم الزبون</th><th>تاريخ الانتهاء</th><th>الرزمة</th><th>الشركة</th></tr></thead><tbody>${rows.slice(0,50).map(r=>`<tr><td>${esc(r.phone)}</td><td>${esc(r.customerName||'-')}</td><td>${esc(r.endDate||'-')}</td><td>${esc(r.packageName||'-')}</td><td>${esc(r.carrier||'-')}</td></tr>`).join('')}</tbody></table></div>${rows.length>50?'<div class="small" style="margin-top:8px">تظهر أول 50 سجلًا فقط في المعاينة، وسيتم استرداد جميع السجلات.</div>':''}</div>`;
  }catch(err){status.textContent='❌ '+(err?.message||'تعذر قراءة الملف.');preview.innerHTML='';window.__pendingRenewalImports=null;}};
  reader.onerror=()=>status.textContent='❌ تعذر قراءة الملف.';
  if(isCSV)reader.readAsText(file,'utf-8');else reader.readAsArrayBuffer(file);
}
function savePendingRenewalImports(){if(!requireCloudPermission('imports'))return;
  const pending=window.__pendingRenewalImports; if(!pending?.rows?.length)return alert('لا توجد بيانات جاهزة للاسترداد.');
  data.renewalImports=Array.isArray(data.renewalImports)?data.renewalImports:[]; const companyId=Number(pending.companyId||0);
  const existing=new Map(data.renewalImports.map(r=>[`${r.companyId||0}|${normalizeRenewalPhone(r.phone)}`,r])); let added=0,updated=0;
  pending.rows.forEach(r=>{const phone=normalizeRenewalPhone(r.phone);if(!phone)return;const key=`${companyId}|${phone}`;const old=existing.get(key);const rec={...(old||{}),...r,phone,companyId,importedAt:nowDate()};if(old){Object.assign(old,rec);updated++;}else{data.renewalImports.push(rec);existing.set(key,rec);added++;}});
  data.skyRenewals=[]; save(); window.__pendingRenewalImports=null; const st=document.getElementById('renewalImportStatus');if(st)st.textContent=`✅ تم استرداد ${added+updated} رقم (${added} جديد، ${updated} محدث).`;const p=document.getElementById('renewalImportPreview');if(p)p.innerHTML='';renderRenewalImports();notify(`🔢 تم استرداد ${added+updated} رقم`);
}
function renewalDiff(date){if(!date)return null;const d=new Date(date+'T23:59:59');if(isNaN(d))return null;return Math.ceil((d-new Date())/86400000);}
function renderRenewalImports(){
  const list=document.getElementById('renewalImportsList');if(!list)return;const q=(document.getElementById('renewalImportSearch')?.value||'').trim().toLowerCase();const filter=document.getElementById('renewalImportFilter')?.value||'all';const all=data.renewalImports||[];const arr=all.filter(r=>(filter==='all'||String(r.companyId)===String(filter)) && `${r.phone} ${r.customerName||''} ${r.carrier||''} ${r.packageName||''}`.toLowerCase().includes(q));const count=document.getElementById('renewalImportCount');if(count)count.textContent=all.length;
  list.innerHTML=arr.slice(0,500).map(r=>{const diff=renewalDiff(r.endDate);const company=companyName(r.companyId);const badge=diff===null?'غير محدد':diff<0?'منتهية':diff===0?'اليوم':diff===1?'غدًا':'بعد '+diff+' يوم';const cls=diff!==null&&diff<=7?'danger-text':diff!==null&&diff<=15?'status-warn':'success-text';return `<div class="company"><div class="company-head"><div><b>📱 ${esc(r.phone)}</b><div class="company-meta">👤 ${esc(r.customerName||'غير مسمى')} · 🏢 ${esc(company)}</div></div><span class="pill ${cls}">${esc(badge)}</span></div><div class="company-bottom" style="margin-top:8px"><span>📅 ${esc(r.endDate||'غير محدد')}</span><span>📦 ${esc(r.packageName||'')}</span></div></div>`;}).join('')||'<div class="empty">لا توجد أرقام مستردة مطابقة</div>';
}
function openRenewalAlerts(){openTab('toolsTab');setTimeout(()=>{document.getElementById('renewalAlerts')?.scrollIntoView({behavior:'smooth'});renderRenewalAlerts()},30)}
function fillRenewalMessage(t,r,diff){return String(t||'').replaceAll('{name}',r.customerName||r.name||'').replaceAll('{phone}',r.phone||'').replaceAll('{date}',r.endDate||r.date||'').replaceAll('{days}',diff===null?'':String(Math.max(diff,0))).replaceAll('{company}',companyName(r.companyId));}
function smsPhone(phone){let x=normalizeRenewalPhone(phone);if(x.startsWith('05'))return x;if(x.startsWith('972'))return '+'+x; if(x.startsWith('970'))return '+'+x; return x.replace(/^\+/,'+');}
function openSMS(phone,text){const p=smsPhone(phone);if(!p)return alert('لا يوجد رقم صالح لإرسال SMS');const body=encodeURIComponent(text||'');window.location.href=`sms:${p}?body=${body}`;}
function sendRenewalSMS(phone){const r=(data.renewalImports||[]).find(x=>normalizeRenewalPhone(x.phone)===String(phone));if(!r)return;const diff=renewalDiff(r.endDate);const msg=fillRenewalMessage(document.getElementById('renewalAlertMessage')?.value,r,diff);openSMS(r.phone,msg);}
function renderRenewalAlerts(){
  const list=document.getElementById('renewalAlertsList');if(!list)return;const arr=getRenewalAlertRows();const count=document.getElementById('renewalAlertCount');if(count)count.textContent=arr.length;
  list.innerHTML=arr.slice(0,500).map(r=>{const d=renewalDiff(r.endDate);const ph=esc(normalizeRenewalPhone(r.phone));return `<div class="company"><div class="company-head"><div><b>📱 ${esc(r.phone)}</b><div class="company-meta">👤 ${esc(r.customerName||'غير مسمى')} · 🏢 ${esc(companyName(r.companyId))}</div></div><span class="pill ${d<=3?'danger-text':'status-warn'}">${d===0?'اليوم':d===1?'غدًا':'بعد '+d+' يوم'}</span></div><div class="company-bottom" style="margin-top:8px"><span>📅 ${esc(r.endDate)}</span><span>${esc(r.packageName||'')}</span></div><div style="display:flex;gap:7px;margin-top:10px;flex-wrap:wrap"><button class="btn success" style="padding:8px 12px" data-action="sendRenewalSMS" data-phone="${ph}">📩 إرسال SMS</button><button class="btn light" style="padding:8px 12px" data-action="copyText" data-text="${ph}">📋 نسخ الرقم</button></div></div>`;}).join('')||'<div class="empty">لا توجد أرقام تنتهي ضمن الفترة المحددة</div>';
}
function getRenewalAlertRows(){
  const filter=document.getElementById('alertCompany')?.value||'all';const w=document.getElementById('alertWindow')?.value||'7';
  return (data.renewalImports||[]).filter(r=>filter==='all'||String(r.companyId)===String(filter)).filter(r=>{const d=renewalDiff(r.endDate);return d!==null&&d>=0&&(w==='all'||d<=Number(w));}).sort((a,b)=>renewalDiff(a.endDate)-renewalDiff(b.endDate));
}
function startRenewalSMSQueue(){
  const rows=getRenewalAlertRows(); if(!rows.length)return alert('لا توجد أرقام ضمن الفترة المحددة.');
  const msg=document.getElementById('renewalAlertMessage')?.value||''; if(!msg.trim())return alert('اكتب رسالة SMS أولًا.');
  window.__renewalSmsQueue=rows.map(r=>({phone:r.phone,name:r.customerName||'',customerName:r.customerName||'',date:r.endDate,endDate:r.endDate,companyId:r.companyId}));window.__renewalSmsIndex=0;renderRenewalSMSQueue();
}
function renderRenewalSMSQueue(){
  const el=document.getElementById('renewalSmsQueue');if(!el)return;const q=window.__renewalSmsQueue||[],i=Number(window.__renewalSmsIndex||0);if(!q.length){el.innerHTML='';return;}if(i>=q.length){el.innerHTML='<div class="muted-box">✅ تم تجهيز جميع الأرقام للإرسال.</div>';return;}
  const r=q[i],diff=renewalDiff(r.date),msg=fillRenewalMessage(document.getElementById('renewalAlertMessage')?.value,r,diff);el.innerHTML=`<div class="panel" style="padding:12px;background:#f8fbff;border:1px solid #dce8f7"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>📩 SMS رقم ${i+1} من ${q.length}</b><span class="pill">${esc(r.phone)}</span></div><div class="small" style="margin-top:7px">${esc(r.name||'عزيزي العميل')} · ${esc(companyName(r.companyId))}</div><div class="muted-box" style="margin-top:8px">${esc(msg)}</div><div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:9px"><button class="btn success" data-action="sendCurrentRenewalSMS">📩 فتح الرسالة وإرسالها</button><button class="btn light" data-action="skipCurrentRenewalSMS">تخطي</button></div></div>`;
}
function sendCurrentRenewalSMS(){const q=window.__renewalSmsQueue||[],i=Number(window.__renewalSmsIndex||0);if(!q[i])return;const r=q[i],msg=fillRenewalMessage(document.getElementById('renewalAlertMessage')?.value,r,renewalDiff(r.date));window.__renewalSmsIndex=i+1;openSMS(r.phone,msg);setTimeout(renderRenewalSMSQueue,250);}
function skipCurrentRenewalSMS(){window.__renewalSmsIndex=Number(window.__renewalSmsIndex||0)+1;renderRenewalSMSQueue();}
function bulkRenewImportedNumbers(){if(!requireCloudPermission('renew'))return;
  const rows=getRenewalAlertRows();if(!rows.length)return alert('لا توجد أرقام ضمن الفترة المحددة.');
  const daysInput=prompt(`سيتم تحديث ${rows.length} رقمًا. كم يومًا مدة التجديد؟`,'30');if(daysInput===null)return;const days=Math.max(1,Number(daysInput)||0);if(!days)return alert('أدخل عدد أيام صحيح.');
  if(!confirm(`تأكيد تجديد ${rows.length} رقمًا لمدة ${days} يوم؟\nسيتم تعديل تاريخ الانتهاء في قائمة الأرقام المستردة.`))return;
  let changed=0;rows.forEach(r=>{const base=new Date(r.endDate+'T12:00:00');if(isNaN(base))return;base.setDate(base.getDate()+days);r.endDate=base.toISOString().slice(0,10);r.renewedAt=nowDate();r.renewedBy=currentUser().name;changed++;});
  save();renderRenewalAlerts();renderRenewalImports();renderSmartCenter();notify(`🔄 تم تجديد ${changed} رقمًا لمدة ${days} يوم`);startRenewalSMSQueue();
}

function populateRenewalCompanySelects(){
  const companies=Array.isArray(data.companies)?data.companies:[];
  const build=(select,allLabel)=>{
    if(!select)return;
    const current=select.value;
    const isAll=allLabel!==null;
    select.innerHTML=(isAll?`<option value="all">${esc(allLabel)}</option>`:'')+companies.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    if([...select.options].some(o=>o.value===current)) select.value=current;
    else if(isAll) select.value='all';
    else if(companies[0]) select.value=String(companies[0].id);
  };
  build(document.getElementById('renewalImportCompany'),null);
  build(document.getElementById('renewalImportFilter'),'كل الشركات');
  build(document.getElementById('alertCompany'),'كل الشركات');
}
// One-time migration of the very old "skyRenewals" list into renewalImports.
function normalizeRenewalImports(){data.renewalImports=Array.isArray(data.renewalImports)?data.renewalImports:[];if((data.skyRenewals||[]).length){const skyId=data.companies.find(c=>c.name==='سكاي')?.id||1;const existing=new Set(data.renewalImports.map(r=>`${r.companyId||0}|${normalizeRenewalPhone(r.phone)}`));(data.skyRenewals||[]).forEach(r=>{const phone=normalizeRenewalPhone(r.phone);if(!phone)return;const key=`${skyId}|${phone}`;if(!existing.has(key)){data.renewalImports.push({...r,phone,companyId:skyId});existing.add(key);}});data.skyRenewals=[];if(typeof Sync!=='undefined')Sync.markChanged();}}

registerActions({
  renderRenewals:()=>renderRenewals(),
  previewRenewalImport:(el)=>previewRenewalImport(el),
  savePendingRenewalImports:()=>savePendingRenewalImports(),
  renderRenewalImports:()=>renderRenewalImports(),
  openRenewalAlerts:()=>openRenewalAlerts(),
  renderRenewalAlerts:()=>renderRenewalAlerts(),
  sendRenewalSMS:(el)=>sendRenewalSMS(el.dataset.phone),
  startRenewalSMSQueue:()=>startRenewalSMSQueue(),
  sendCurrentRenewalSMS:()=>sendCurrentRenewalSMS(),
  skipCurrentRenewalSMS:()=>skipCurrentRenewalSMS(),
  bulkRenewImportedNumbers:()=>bulkRenewImportedNumbers()
});
