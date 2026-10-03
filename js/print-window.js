/* Logic of the print/export popup opened by printWindow() (js/customers.js).
   Data arrives as inert JSON in <script type="application/json" id="printWindowData">. */
(function(){
 'use strict';
 let cfg={};
 try{ cfg=JSON.parse(document.getElementById('printWindowData')?.textContent||'{}'); }catch(e){ cfg={}; }
 const pdfSvg=typeof cfg.pdfSvg==='string'?cfg.pdfSvg:'';
 const pdfPages=Array.isArray(cfg.pdfPages)?cfg.pdfPages.filter(p=>typeof p==='string'&&p):[];
 const hasPdf=pdfPages.length>0||!!pdfSvg;

 function goBack(){try{if(window.opener&&!window.opener.closed){window.close();return}}catch(e){}try{history.back()}catch(e){}}
 function printPage(){window.print()}
 function loadJsPDF(){return new Promise((resolve,reject)=>{
   if(window.jspdf&&window.jspdf.jsPDF){resolve(window.jspdf.jsPDF);return}
   if(!cfg.jspdf?.src){reject(new Error('jsPDF unavailable'));return}
   const s=document.createElement('script');s.src=cfg.jspdf.src;if(cfg.jspdf.integrity)s.integrity=cfg.jspdf.integrity;
   s.onload=()=>window.jspdf&&window.jspdf.jsPDF?resolve(window.jspdf.jsPDF):reject(new Error('jsPDF unavailable'));
   s.onerror=()=>reject(new Error('jsPDF load failed'));document.head.appendChild(s)})}
 function svgImageFrom(svg){return new Promise((resolve,reject)=>{if(!svg){reject(new Error('No SVG'));return}const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)})}
 async function buildPdf(){
   const JsPDF=await loadJsPDF();
   const pages=pdfPages.length?pdfPages:[pdfSvg];
   if(!pages.length||!pages[0])throw new Error('No PDF content');
   const pdf=new JsPDF({orientation:'p',unit:'mm',format:'a4',compress:true});
   const pageW=210,pageH=297,margin=8,usableW=pageW-margin*2,usableH=pageH-margin*2;
   for(let i=0;i<pages.length;i++){
     const img=await svgImageFrom(pages[i]);
     const canvas=document.createElement('canvas');
     const scale=1.5;
     canvas.width=794*scale; canvas.height=1123*scale;
     const ctx=canvas.getContext('2d');
     ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
     ctx.drawImage(img,0,0,canvas.width,canvas.height);
     if(i>0)pdf.addPage();
     pdf.addImage(canvas.toDataURL('image/jpeg',.92),'JPEG',margin,margin,usableW,usableH);
   }
   return pdf;
 }
 async function exportPDF(){
   if(!hasPdf){printPage();return}
   try{ const pdf=await buildPdf(); pdf.save('كشف-حساب.pdf'); }
   catch(e){ console.error(e); alert('تعذر إنشاء ملف PDF. جرّب مرة أخرى.'); }
 }
 async function saveImage(){try{const img=await svgImageFrom(pdfSvg||pdfPages[0]);const scale=2,canvas=document.createElement('canvas');canvas.width=1080*scale;canvas.height=Math.ceil(img.height*scale);const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);canvas.toBlob(function(blob){if(!blob)return alert('تعذر إنشاء الصورة');const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='كشف-حساب.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1200)},'image/png',.95)}catch(e){alert('تعذر إنشاء الصورة. حاول مرة أخرى.')}}
 async function shareWhatsApp(){
   try{
     const pdf=await buildPdf();
     const blob=pdf.output('blob');
     const file=new File([blob],'كشف-حساب.pdf',{type:'application/pdf'});
     if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){await navigator.share({files:[file],text:'كشف حساب من Ramez SIM'});return}
     const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='كشف-حساب.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1200);
   }catch(e){if(e.name!=='AbortError')alert('تعذر تجهيز ملف PDF. يمكنك استخدام زر تصدير PDF ثم مشاركته عبر واتساب.')}
 }
 const $=id=>document.getElementById(id);
 $('backBtn').addEventListener('click',goBack);
 $('pdfBtn').addEventListener('click',exportPDF);
 $('imgBtn').addEventListener('click',saveImage);
 $('waBtn').addEventListener('click',shareWhatsApp);
 $('printBtn').addEventListener('click',printPage);
 // Documents without a statement image (report, receipt): PDF = system "Save as PDF".
 if(!hasPdf){ $('imgBtn').style.display='none'; $('waBtn').style.display='none'; }
})();
