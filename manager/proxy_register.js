'use strict';
// PmheeAether proxy registration. Owner-provided credentials only; unknown signup outcomes require review.
const http=require('http'),https=require('https'),tls=require('tls'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const plainObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function validRegistrationState(value){
 if(!plainObject(value)||value.schema!==1||!plainObject(value.entries))return false;
 for(const [key,r]of Object.entries(value.entries)){
  if(!key||!plainObject(r)||!['reserving','reserved','submission-unknown','completion-pending','done'].includes(r.phase)||!/^[a-f0-9]{64}$/.test(r.identity||'')||!/^[a-f0-9]{64}$/.test(r.providerFingerprint||'')||typeof r.username!=='string'||!r.username||r.username.length>128||!/^[0-9a-f-]{36}$/.test(r.requestId||'')||!/^reg_[a-f0-9]{32}$/.test(r.sessionTag||''))return false;
  if(r.ip!==undefined&&(typeof r.ip!=='string'||!/^(\d{1,3}\.){3}\d{1,3}$/.test(r.ip)||r.ip.split('.').some(n=>Number(n)>255)))return false;
  if(['reserved','submission-unknown','completion-pending'].includes(r.phase)&&(!r.ip||typeof r.ticketId!=='string'||!r.ticketId||!Number.isSafeInteger(r.expiresAt)||r.expiresAt<=0))return false;
  if(r.phase==='completion-pending'&&(!plainObject(r.outcome)||typeof r.outcome.success!=='boolean'||r.outcome.code!==(r.outcome.success?'REGISTERED':'USERNAME_TAKEN')))return false;
  if(r.phase==='done'&&(!plainObject(r.result)||typeof r.result.success!=='boolean'||(r.result.success&&(!r.ticketId||!plainObject(r.outcome)||r.outcome.success!==true))||(!r.result.success&&!['IP_RATE_LIMITED','USERNAME_TAKEN','REGISTRATION_REJECTED'].includes(r.result.code))))return false;
 }
  return true;
}
function formatProxySessionUser(s,sessionTag){const baseUser=String(s.proxyUser||'').replace(/__cr[.-][a-z]{2}.*$/i,'');if(/dataimpulse/i.test(s.proxyHost||'')){const cleanTag=String(sessionTag||'').replace(/[^a-zA-Z0-9]/g,'').slice(0,32)||'session1';return baseUser+'__cr.'+s.country+';sessid.'+cleanTag+';sessttl.5';}return baseUser+'__cr-'+s.country+'__session-'+sessionTag;}
function createTunnel(host,s,user){return new Promise((resolve,reject)=>{
 let settled=false,secure;const req=http.request({host:s.proxyHost,port:s.proxyPort,method:'CONNECT',path:host+':443',headers:{Host:host+':443','Proxy-Authorization':'Basic '+Buffer.from(user+':'+s.proxyPass).toString('base64')},timeout:12000});
 const fail=code=>{if(settled)return;settled=true;clearTimeout(deadline);req.destroy();secure?.destroy();reject(Error(code));};
 // One deadline covers CONNECT and TLS handshake, not just the HTTP response.
 const deadline=setTimeout(()=>fail('PROXY_TUNNEL_TIMEOUT'),12000);
 req.on('connect',(res,socket)=>{if(res.statusCode!==200){socket.destroy();return fail('PROXY_CONNECT_REJECTED');}secure=tls.connect({socket,servername:host},()=>{if(settled)return;settled=true;clearTimeout(deadline);secure.setTimeout(0);resolve(secure);});secure.setTimeout(12000,()=>fail('PROXY_TLS_TIMEOUT'));secure.on('error',()=>fail('PROXY_TLS_FAILED'));});req.on('timeout',()=>fail('PROXY_TIMEOUT'));req.on('error',()=>fail('PROXY_CONNECTION_FAILED'));req.end();
});}
async function requestThroughProxy(host,route,s,user,payload){
 const socket=await createTunnel(host,s,user),body=payload==null?null:JSON.stringify(payload),limit=body?20000:10000;
 return new Promise((resolve,reject)=>{
  let settled=false,response,req;
  const fail=code=>{if(settled)return;settled=true;clearTimeout(deadline);req?.destroy();response?.destroy();socket.destroy();reject(Error(code));};
  // Absolute full-body deadline cannot be prolonged by a peer sending occasional chunks.
  const deadline=setTimeout(()=>fail('PROXY_REQUEST_DEADLINE'),limit);
  req=https.request({host,port:443,path:route,method:body?'POST':'GET',headers:{Host:host,Accept:'application/json','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),Origin:'https://www.aetheria-online.in.th',Referer:'https://www.aetheria-online.in.th/'}:{})},createConnection:()=>socket,timeout:limit},res=>{
   response=res;let text='';res.setEncoding('utf8');res.on('error',()=>fail('PROXY_RESPONSE_FAILED'));
   res.on('data',chunk=>{text+=chunk;if(Buffer.byteLength(text)>65536)fail('PROXY_RESPONSE_TOO_LARGE');});
   res.on('end',()=>{if(settled)return;settled=true;clearTimeout(deadline);let json=null;try{json=JSON.parse(text);}catch(_){}socket.destroy();resolve({statusCode:res.statusCode,json});});
  });
  req.on('timeout',()=>fail('PROXY_REQUEST_TIMEOUT'));req.on('error',()=>fail('PROXY_REQUEST_FAILED'));req.end(body||undefined);
 });
}
function createProxyRegisterService({dataDir,solver,fetchEgressIp:testIp,registerRequest:testRegister,now=Date.now}){
 const settingsFile=path.join(dataDir,'proxy_settings.json'),stateFile=path.join(dataDir,'proxy_register_state_v1.json'),inFlight=new Map();
 function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw Error('PROXY_STATE_REVIEW_REQUIRED');}}
 function write(file,value){fs.mkdirSync(dataDir,{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});fs.renameSync(file+'.tmp',file);}
 let state,stateBlocked=false;try{state=read(stateFile,{schema:1,entries:{}});if(!validRegistrationState(state))throw Error('PROXY_STATE_REVIEW_REQUIRED');}catch(_){state={schema:1,entries:{}};stateBlocked=true;}
 function normalizeSettings(s){if(!plainObject(s))throw Error('PROXY_SETTINGS_REVIEW_REQUIRED');const user=typeof s.proxyUser==='string'?s.proxyUser:'',pass=typeof s.proxyPass==='string'?s.proxyPass:'',rotationRequired=false;const configured=!!(typeof s.proxyHost==='string'&&/^[A-Za-z0-9.-]{1,253}$/.test(s.proxyHost)&&Number.isInteger(s.proxyPort)&&s.proxyPort>0&&s.proxyPort<=65535&&user&&pass);const mode=s.mode==='owner-broker'||(!configured&&s.mode!=='local'&&typeof solver?.proxyBrokerSignup==='function')?'owner-broker':'local';return {...s,mode,enabled:s.enabled===true,configured,rotationRequired,proxyHost:s.proxyHost||'',proxyPort:s.proxyPort||0,proxyUser:user,proxyPass:pass,country:/^[a-z]{2}$/.test(s.country||'')?s.country:'th',pointCost:0.1,registeredCount:Number.isSafeInteger(s.registeredCount)&&s.registeredCount>=0?s.registeredCount:0};}
 function loadSettings(){return normalizeSettings(read(settingsFile,{}));}
 function saveSettings(patch){if(Object.hasOwn(patch,'mode')&&!['local','owner-broker'].includes(patch.mode))throw Error('Mode ต้องเป็น local หรือ owner-broker');if(Object.hasOwn(patch,'proxyHost')&&!/^[A-Za-z0-9.-]{1,253}$/.test(patch.proxyHost||''))throw Error('Host ต้องเป็นชื่อโดเมนหรือ IP ไม่ใส่ URL หรือ credential');if(Object.hasOwn(patch,'proxyPort')&&(!Number.isInteger(patch.proxyPort)||patch.proxyPort<1||patch.proxyPort>65535))throw Error('Port ต้องเป็นจำนวนเต็ม 1–65535');if(Object.hasOwn(patch,'country')&&!/^[a-z]{2}$/.test(patch.country||''))throw Error('ประเทศต้องเป็นรหัสสองตัว');const candidate=normalizeSettings({...loadSettings(),...patch});if(candidate.enabled&&candidate.mode==='local'&&!candidate.configured){if(typeof solver?.proxyBrokerSignup==='function'&&!Object.hasOwn(patch,'mode'))candidate.mode='owner-broker';else throw Error('ต้องตั้งค่า Proxy และข้อมูลรับรองในเครื่องก่อนเปิดใช้งาน');}const next={...candidate};delete next.configured;delete next.rotationRequired;write(settingsFile,next);return loadSettings();}
 function publicSettings(){const s=loadSettings();const isBroker=s.mode==='owner-broker';const effectiveConfigured=isBroker?true:s.configured;return {mode:s.mode,enabled:s.enabled&&effectiveConfigured&&!stateBlocked,requestedEnabled:s.enabled,configured:effectiveConfigured,rotationRequired:s.rotationRequired,hasCredentials:!!s.proxyUser&&!!s.proxyPass,proxyHost:s.proxyHost,proxyPort:s.proxyPort,pointCost:s.pointCost,country:s.country,registeredCount:s.registeredCount,lastRegisteredAt:s.lastRegisteredAt||null,lastTestedIp:s.lastTestedIp||null,pendingReview:stateBlocked?1:Object.values(state.entries).filter(e=>e.phase==='submission-unknown'||e.phase==='completion-pending').length};}
 function requireConfigured(s){if(!s.configured)throw Error('PROXY_UNCONFIGURED');}
 const fetchIp=testIp||async function(s,user){const r=await requestThroughProxy('api.ipify.org','/?format=json',s,user,null),ip=r.json?.ip;if(r.statusCode!==200||typeof ip!=='string'||!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)||ip.split('.').some(n=>Number(n)>255))throw Error('PROXY_IP_INVALID');return ip;};
 const signup=testRegister||((s,user,username,password)=>requestThroughProxy('www.aetheria-online.in.th','/auth/register',s,user,{userId:username,password}));
 async function testConnection(){try{const s=loadSettings();if((s.mode==='owner-broker'||!s.configured)&&typeof solver?.proxyBrokerCapabilities==='function'){const caps=await solver.proxyBrokerCapabilities();if(caps?.success&&caps?.configured)return {success:true,mode:'owner-broker',country:caps.country||'th',ip:caps.ip||s.lastTestedIp||'พร้อมใช้งาน (Owner Broker)'};if(!s.configured)return {success:false,error:'Owner proxy ยังไม่พร้อม ตรวจสถานะบนเครื่องเจ้าของ'};}requireConfigured(s);const user=formatProxySessionUser(s,'test_'+crypto.randomUUID().replaceAll('-','')),ip=await fetchIp(s,user);saveSettings({lastTestedIp:ip});return {success:true,ip,country:s.country};}catch(_){return {success:false,error:'Proxy ยังไม่พร้อม ตรวจการตั้งค่าและ credential ที่เจ้าของจัดเตรียม'};}}
 async function perform({profileId,username,password}){
  if(stateBlocked)throw Error('PROXY_STATE_REVIEW_REQUIRED');
  const s=loadSettings();let isBroker=(s.mode==='owner-broker'||!s.configured)&&typeof solver?.proxyBrokerSignup==='function';if(!isBroker&&(!solver?.proxyReserve||!solver?.proxyComplete))throw Error('PROXY_SERVICE_UNAVAILABLE');if(typeof username!=='string'||!username||typeof password!=='string'||!password)throw Error('INVALID_REGISTRATION_INPUT');
  const key=profileId||username,identity=crypto.createHash('sha256').update(username+'\n'+password).digest('hex');let record=Object.hasOwn(state.entries,key)?state.entries[key]:null;
  if(record&&record.identity!==identity){if(record.phase!=='done')return {success:false,code:'REGISTRATION_REVIEW_REQUIRED',pending:true,error:'ยังมีรายการสมัครเดิมรอตรวจสอบ ห้ามเริ่มสมัครใหม่'};record=null;}
  if(record?.phase==='done'){if(record.result?.code==='IP_RATE_LIMITED'){delete state.entries[key];record=null;write(stateFile,state);}else return record.result;}
  if(record?.phase==='submission-unknown')return {success:false,code:'REGISTRATION_REVIEW_REQUIRED',pending:true,error:'คำสั่งสมัครถูกส่งแล้วแต่ยังไม่ทราบผล ต้องตรวจสอบก่อนลองใหม่'};
  if(record?.phase!=='completion-pending'){if(!s.enabled)throw Error('PROXY_DISABLED');if(!isBroker)requireConfigured(s);}
  if(isBroker){
   const providerFingerprint=crypto.createHash('sha256').update('owner-broker-v1').digest('hex');
   if(record&&record.phase==='reserving'&&record.providerFingerprint!==providerFingerprint){delete state.entries[key];record=null;}
   if(!record){try{await solver.refreshBalance?.();}catch(_){}record={identity,username,providerFingerprint,phase:'reserving',requestId:crypto.randomUUID(),sessionTag:'reg_'+crypto.randomUUID().replaceAll('-','')};state.entries[key]=record;write(stateFile,state);}
   let serverRes,brokerErr=null;try{serverRes=await solver.proxyBrokerSignup({requestId:record.requestId,profileId:profileId||key,username,password});}catch(e){brokerErr=e;}
   if(brokerErr){
    if((brokerErr.code==='OWNER_PROXY_UNCONFIGURED'||brokerErr.code==='OWNER_PROXY_DISABLED')&&s.configured&&solver?.proxyReserve&&solver?.proxyComplete){delete state.entries[key];record=null;isBroker=false;}
    else if(brokerErr.code==='INSUFFICIENT_POINTS'){delete state.entries[key];write(stateFile,state);return {success:false,code:'INSUFFICIENT_POINTS',error:'ส่วนบุญไม่พอสำหรับสมัครผ่าน Proxy (ใช้ 0.1 ส่วนบุญ/ไอดี)'};}
    else return {success:false,pending:true,code:'OWNER_OFFLINE',error:'ไม่สามารถติดต่อเครื่องเจ้าของได้ บันทึกรายการไว้รอส่งใหม่'};
   }
   if(isBroker){
    const resCode=serverRes?.code||serverRes?.outcomeCode;
    if(serverRes?.success===true){record.phase='done';record.ticketId=serverRes.ticketId||serverRes.jobId;record.outcome={success:true,code:'REGISTERED'};record.result={success:true,username:record.username,ip:serverRes.ip,ticketId:record.ticketId,chargedPoints:0.1,newBalance:serverRes.newBalance};write(stateFile,state);saveSettings({registeredCount:loadSettings().registeredCount+1,lastRegisteredAt:Date.now(),lastTestedIp:serverRes.ip});return record.result;}
    if(resCode==='USERNAME_TAKEN'){record.phase='done';record.outcome={success:false,code:'USERNAME_TAKEN'};record.result={success:false,code:'USERNAME_TAKEN',error:'ชื่อผู้ใช้นี้ถูกใช้แล้ว'};write(stateFile,state);return record.result;}
    if(resCode==='IP_RATE_LIMITED'){delete state.entries[key];write(stateFile,state);return {success:false,code:'IP_RATE_LIMITED',error:serverRes.message||serverRes.error||'IP นี้ติดโควต้า กำลังสลับ IP ใหม่ในรอบถัดไป'};}
    if(serverRes?.pending||resCode==='REGISTRATION_REVIEW_REQUIRED'){record.phase='submission-unknown';write(stateFile,state);return {success:false,code:'REGISTRATION_REVIEW_REQUIRED',pending:true,error:serverRes?.error||'รายการสมัครยังรอตรวจสอบ'};}
    record.phase='done';record.result={success:false,code:resCode||'REGISTRATION_REJECTED',error:serverRes?.error||'รายการสมัครไม่ผ่านการอนุมัติ'};write(stateFile,state);return record.result;
   }
  }
  const providerFingerprint=crypto.createHash('sha256').update(JSON.stringify([s.proxyHost,s.proxyPort,s.proxyUser,s.proxyPass,s.country])).digest('hex');
  if(!record){const balance=await solver.refreshBalance();if(!Number.isSafeInteger(balance?.balanceUnits))throw Error('PROXY_BALANCE_NOT_READY');record={identity,username,providerFingerprint,phase:'reserving',requestId:crypto.randomUUID(),sessionTag:'reg_'+crypto.randomUUID().replaceAll('-','')};state.entries[key]=record;write(stateFile,state);}
  if(record.phase!=='completion-pending'&&record.providerFingerprint!==providerFingerprint)return {success:false,pending:true,code:'PROXY_CONFIG_CHANGED_REVIEW_REQUIRED',error:'ค่า Proxy ของรายการเดิมเปลี่ยน ต้องตรวจสอบก่อนส่งสมัคร'};
  let user=formatProxySessionUser(s,record.sessionTag);
  function refreshExpiredReservation(){record.phase='reserving';record.requestId=crypto.randomUUID();delete record.ticketId;delete record.expiresAt;write(stateFile,state);return {success:false,pending:true,code:'PROXY_RESERVATION_REFRESH_PENDING',error:'สิทธิ์ IP เดิมหมดอายุก่อนส่งสมัคร รอจองใหม่ด้วย IP และ session เดิม'};}
  if(record.phase==='reserving'){
   for(let attempt=0;attempt<3;attempt++){
    if(!record.ip){record.ip=await fetchIp(s,user);write(stateFile,state);}
    let r;try{r=await solver.proxyReserve(record.ip,record.requestId);}catch(e){if(e?.code==='INSUFFICIENT_POINTS'){delete state.entries[key];write(stateFile,state);return {success:false,code:'INSUFFICIENT_POINTS',error:'ส่วนบุญไม่พอสำหรับสมัครผ่าน Proxy (ใช้ 0.1 ส่วนบุญ/ไอดี)'};}throw e;}
    if(!r?.success||typeof r.ticketId!=='string'){
     if(r?.code==='INSUFFICIENT_POINTS'){delete state.entries[key];write(stateFile,state);return {success:false,code:'INSUFFICIENT_POINTS',error:'ส่วนบุญไม่พอสำหรับสมัครผ่าน Proxy (ใช้ 0.1 ส่วนบุญ/ไอดี)'};}
     if(r?.code==='IP_RATE_LIMITED'){
      if(attempt<2){const prevIp=record.ip,nextTag='reg_'+crypto.randomUUID().replaceAll('-',''),nextUser=formatProxySessionUser(s,nextTag),nextIp=await fetchIp(s,nextUser);if(nextIp&&nextIp!==prevIp){record.sessionTag=nextTag;record.requestId=crypto.randomUUID();record.ip=nextIp;user=nextUser;write(stateFile,state);continue;}}
      delete state.entries[key];write(stateFile,state);return {success:false,code:'IP_RATE_LIMITED',error:'IP นี้ติดโควต้า กำลังสลับ IP ใหม่ในรอบถัดไป'};
     }
     throw Error('PROXY_RESERVATION_PENDING');
    }
    if(!Number.isSafeInteger(r.expiresAt))return {success:false,pending:true,code:'PROXY_RESERVATION_ACK_INVALID',error:'ยังยืนยันเวลาหมดอายุของสิทธิ์ IP ไม่ได้ หยุดก่อนส่งสมัคร'};
    record.ticketId=r.ticketId;record.expiresAt=r.expiresAt;if(record.expiresAt<=now()+60000)return refreshExpiredReservation();record.phase='reserved';write(stateFile,state);break;
   }
  }
  if(record.phase==='reserved'){
   if(!Number.isSafeInteger(record.expiresAt))return {success:false,pending:true,code:'PROXY_RESERVATION_ACK_INVALID',error:'รายการเก่ายังไม่มีเวลาหมดอายุที่ยืนยัน หยุดก่อนส่งสมัคร'};
   if(record.expiresAt<=now()+60000)return refreshExpiredReservation();
   const ip=await fetchIp(s,user);if(ip!==record.ip){record.phase='submission-unknown';record.reviewCode='EGRESS_IP_CHANGED_BEFORE_SIGNUP';write(stateFile,state);return {success:false,code:'REGISTRATION_REVIEW_REQUIRED',pending:true,error:'IP ของ session เปลี่ยน หยุดก่อนส่งคำสั่งสมัคร'};}
   if(record.expiresAt<=now()+60000)return refreshExpiredReservation();
   record.phase='submission-unknown';write(stateFile,state);let response;try{response=await signup(s,user,username,password);}catch(_){return {success:false,code:'REGISTRATION_REVIEW_REQUIRED',pending:true,error:'ยังไม่ทราบผลสมัคร ห้ามส่งคำสั่งซ้ำจนตรวจสอบแล้ว'};}
   const ok=response.statusCode>=200&&response.statusCode<300&&(response.json?.success===true||response.json?.ok===true||typeof response.json?.token==='string'||!!response.json?.token);
   const taken=response.statusCode===409||/ชื่อผู้ใช้.*(ใช้แล้ว|ซ้ำ)|USERNAME_TAKEN/i.test(response.json?.error||'');
   const rateLimited=response.statusCode===429||/โควต้า|จำกัด|rate limit|too many/i.test(response.json?.error||'');
   if(rateLimited){try{await solver.proxyComplete(record.ticketId,record.username,false);}catch(_){}record.phase='done';record.result={success:false,code:'IP_RATE_LIMITED',error:response.json?.error||'IP นี้ติดโควต้าการสมัคร 3 ไอดี/ชม. กรุณาลองใหม่อีกครั้ง'};write(stateFile,state);return record.result;}
   if(!ok&&!taken){
    if(response.statusCode>=400&&response.statusCode<500&&response.json?.error){try{await solver.proxyComplete(record.ticketId,record.username,false);}catch(_){}record.phase='done';record.result={success:false,code:'REGISTRATION_REJECTED',error:response.json.error};write(stateFile,state);return record.result;}
    return {success:false,code:'REGISTRATION_REVIEW_REQUIRED',pending:true,error:'รูปแบบผลตอบกลับยังยืนยันไม่ได้ ต้องตรวจสอบรายการสมัคร'};
   }
   record.outcome={success:ok,code:ok?'REGISTERED':'USERNAME_TAKEN'};record.phase='completion-pending';write(stateFile,state);
  }
  if(record.phase==='completion-pending'){const r=await solver.proxyComplete(record.ticketId,record.username,record.outcome.success);if(r?.success!==true)throw Error('PROXY_COMPLETION_PENDING');record.result=record.outcome.success?{success:true,username:record.username,ip:record.ip,ticketId:record.ticketId,chargedPoints:0.1,newBalance:r.balance}:{success:false,code:'USERNAME_TAKEN',error:'ชื่อผู้ใช้นี้ถูกใช้แล้ว'};record.phase='done';write(stateFile,state);if(record.result.success)saveSettings({registeredCount:loadSettings().registeredCount+1,lastRegisteredAt:Date.now(),lastTestedIp:record.ip});return record.result;}
  throw Error('PROXY_STATE_REVIEW_REQUIRED');
 }
 function registerAccountWithProxy(input){const key=input.profileId||input.username;if(inFlight.has(key))return inFlight.get(key);const work=perform(input).finally(()=>inFlight.delete(key));inFlight.set(key,work);return work;}
 return {loadSettings,saveSettings,publicSettings,testConnection,registerAccountWithProxy,isEnabled:()=>loadSettings().enabled,hasPending:key=>!!state.entries[key]&&state.entries[key].phase!=='done'};
}
module.exports={createProxyRegisterService,formatProxySessionUser};
