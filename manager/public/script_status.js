'use strict';
const el = id => document.getElementById(id);
const states = {observed:'สังเกตการณ์',offline:'ออฟไลน์','not-ready':'ยังไม่พร้อม','waiting-safe-bootstrap':'รอ bootstrap / ช่วงปลอดภัย','waiting-download-budget':'รอคิวดาวน์โหลด','update-required':'รออัปเดตรุ่นที่ช่วงปลอดภัย',authorized:'ยืนยันสิทธิ์แล้ว'};
let termsVersion=null;
async function refresh() {
  try {
    const response=await fetch('/api/script/status'), data=await response.json();
    if(!response.ok || !data.success) throw Error('ยังอ่านสถานะไม่ได้');
    el('mode').textContent=data.billingEnabled===null?'ยังอ่านสถานะการคิดส่วนบุญไม่ได้':data.billingEnabled?'กำลังใช้นโยบายที่เปิดใช้งานแล้ว':data.mode==='pilot-shadow'?'โหมดทดลองเฉพาะจอ — ยังไม่มีการเรียกเก็บเงิน':'โหมดสังเกตการณ์ — ยังไม่มีการเรียกเก็บเงิน';
    el('mode-note').textContent=data.mode==='friends-offline'?'บอทและการแก้คำถามทำงานในเครื่อง • อัปเดตข้อมูลส่วนบุญอัตโนมัติ':data.pilotProfileIds?.length?`จอที่เลือกทดลอง: ${(data.pilotProfileIds||[]).join(', ')} • ${data.serviceOrigin||''}`:'จอเดิมใช้งานตามเดิม การเปลี่ยนผ่านต้องผ่านการตรวจความพร้อมก่อน';
    el('observed').textContent=String(data.observedSlotsToday);el('pending').textContent=String(data.pendingEvents);el('reconcile').textContent=String(data.reconciliationRequired);
    el('clients').replaceChildren();
    for(const [id,client] of Object.entries(data.clients)) {
      const tr=document.createElement('tr');
      for(const value of [id,client.version||'—',states[client.state]||client.state,client.reason||(client.busy||[]).join(', ')||'—']) {const td=document.createElement('td');td.textContent=value;tr.append(td);}
      el('clients').append(tr);
    }
  } catch(error) {el('mode').textContent='ยังอ่านสถานะ Manager ไม่ได้';el('mode-note').textContent=error.message;}
}
el('refresh').addEventListener('click',refresh);
el('statement').addEventListener('click',async()=>{
  el('statement').disabled=true;el('statement-data').textContent='';
  try {
    const response=await fetch('/api/script/statement'),data=await response.json();
    if(!response.ok || data.schemaVersion!==2 || data.unitScale!==100 || ![data.balanceUnits,data.rateUnits,data.estimatedUnits].every(Number.isSafeInteger)) throw Error(data.message||'ใบสรุปยังไม่พร้อม');
    el('statement-message').textContent=`วันที่ ${data.bangkokDay} • ${data.billingMode==='shadow'?'ทดลอง ไม่มีการหักส่วนบุญ':'คิดตามการใช้จริง'} • ยอด ${data.balanceUnits/100} ส่วนบุญ • เรท ${data.rateUnits/100} ส่วนบุญ/จอ • ใช้จริงวันนี้ ${data.estimatedUnits/100} ส่วนบุญ${Number.isSafeInteger(data.shadowEstimatedUnits)?' • ตัวอย่างราคาตามจอที่สังเกต '+data.shadowEstimatedUnits/100+' ส่วนบุญ':''}`;
    termsVersion=null;el('terms-check').disabled=true;el('terms-check').checked=false;el('terms-accept').disabled=true;
    if(data.activationDay && typeof data.termsVersion==='string') {
      termsVersion=data.termsVersion;el('terms-check').disabled=false;
      el('terms-detail').textContent=`วันเริ่ม ${data.activationDay} (ไทย) • เรทวันนี้ ${data.rateUnits/100} ส่วนบุญ/จอ • เงื่อนไข ${termsVersion}`;
      el('terms-accept').textContent='ยอมรับเงื่อนไขที่แสดง';
    }
    el('statement-data').textContent=JSON.stringify({usage:data.usage,ledger:data.ledger},null,2);
  } catch(error) {el('statement-message').textContent=error.message;}
  finally {el('statement').disabled=false;}
});
el('terms-check').addEventListener('change',()=>{el('terms-accept').disabled=!termsVersion||!el('terms-check').checked;});
el('terms-accept').addEventListener('click',async()=>{
  el('terms-accept').disabled=true;
  try {
    const response=await fetch('/api/script/terms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({termsVersion})}),data=await response.json();
    if(!response.ok||data.success!==true||data.termsVersion!==termsVersion)throw Error(data.error||'ยังยืนยันการบันทึกไม่ได้');
    el('terms-result').textContent='เซิร์ฟเวอร์บันทึกความยินยอมแล้ว การเปิดนโยบายยังเป็นไปตามวันเริ่มที่ประกาศ';
  }catch(error){el('terms-result').textContent=error.message;}
});
refresh();

async function loadPilots(){
 try{
  const response=await fetch('/api/script/pilot'),data=await response.json();
  if(!response.ok||data.success!==true)throw Error('ยังอ่านรายชื่อจอไม่ได้');
  el('pilot-profiles').replaceChildren();
  for(const profile of data.profiles){
   const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.value=profile.id;check.checked=data.pilotProfileIds.includes(profile.id);
   label.append(check,document.createTextNode(' '+profile.name+' ('+profile.id+')'));label.style.display='block';el('pilot-profiles').append(label);
  }
 }catch(error){el('pilot-result').textContent=error.message;}
}
el('pilot-check').addEventListener('change',()=>{el('pilot-save').disabled=!el('pilot-check').checked;});
async function savePilot(mode){
 el('pilot-save').disabled=true;el('pilot-observe').disabled=true;
 try{
  const pilotProfileIds=mode==='pilot'?[...el('pilot-profiles').querySelectorAll('input:checked')].map(check=>check.value):[];
  if(mode==='pilot'&&!pilotProfileIds.length)throw Error('เลือกจอทดลองอย่างน้อยหนึ่งจอ');
  const response=await fetch('/api/script/pilot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,pilotProfileIds,acknowledgePilot:mode==='pilot'&&el('pilot-check').checked})}),data=await response.json();
  if(!response.ok||data.success!==true)throw Error(data.error||'ยังบันทึกจอทดลองไม่ได้');
  el('pilot-result').textContent=data.message;
  el('pilot-check').checked=false;await refresh();
 }catch(error){el('pilot-result').textContent=error.message;}
 finally{el('pilot-save').disabled=!el('pilot-check').checked;el('pilot-observe').disabled=false;}
}
el('pilot-save').addEventListener('click',()=>savePilot('pilot'));
el('pilot-observe').addEventListener('click',()=>savePilot('observation'));
loadPilots();
