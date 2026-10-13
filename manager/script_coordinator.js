'use strict';
// PmheeAether authorized maintenance only. Do not bypass leases or usage accounting.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const PROBE_JS = `(() => {
 const busy = ['__isWalkingToMap','__isShopping','__isRecovering','__isNavigating','__isConsolidating','__consolidationReceiverMode','__isChangingJob','__isGearRefining','__isStoring','__planMarketBuyInFlight','__isManualSelling','__isAutoSellingNow','__isMarketScanning','__unexpectedTownWaiting','__isHumanizing','__isWeightScrollBusy','__senderTradeBusy'].filter(k => window[k]);
 if(document.querySelector('.human-check')) busy.push('human-check');
 let bootstrap=null; try { bootstrap=window.__pmScriptBootstrap?.status?.() || null; } catch(_){}
 return {version:window.__pelicanBotVersion||null,running:!!window.__isBotRunning,bootstrap,busy,existingRuntime:!!window.__pmLegacyInjectionAttempted||!!window.__pmBrowserInjectionAttempted||('__isBotRunning' in window)||typeof window.startMasterBot==='function'||!!document.querySelector('#pelican-hud')};
})()`;
function dpapi(value, decrypt = false) {
  if (process.platform !== 'win32') throw new Error('Windows DPAPI required');
  const operation = decrypt ? 'Unprotect' : 'Protect';
  const script = `Add-Type -AssemblyName System.Security; $v=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${operation}($v,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`;
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { input: value, encoding: 'utf8', windowsHide: true }).trim();
}
async function fetchApprovedPayload(service, metadata, lease) {
  if(metadata?.success!==true || metadata.chunked!==true || !Number.isInteger(metadata.chunkCount) || metadata.chunkCount<1 || metadata.chunkCount>128 || !Number.isSafeInteger(metadata.size) || metadata.size<1 || metadata.size>4*1024*1024 || !/^\d+\.\d+\.\d+$/.test(metadata.version||'') || !/^[a-f0-9]{64}$/.test(metadata.hash||'')) throw new Error('INVALID_PAYLOAD_METADATA');
  const pieces=[];let bytes=0;
  for(let ordinal=0;ordinal<metadata.chunkCount;ordinal+=3) {
    const count=Math.min(3,metadata.chunkCount-ordinal);
    const response=await service.serviceRequest('/v1/aetheria/script/payload-chunk',{...lease,ordinal,count});
    if(!response?.success || response.version!==metadata.version || response.hash!==metadata.hash || !Array.isArray(response.chunks) || response.chunks.length!==count) throw new Error('INVALID_PAYLOAD_CHUNKS');
    for(let i=0;i<count;i++) {
      const chunk=response.chunks[i];
      if(chunk?.ordinal!==ordinal+i || typeof chunk.source!=='string' || Buffer.byteLength(chunk.source)>60000) throw new Error('INVALID_PAYLOAD_CHUNK_ORDER_OR_SIZE');
      bytes+=Buffer.byteLength(chunk.source);if(bytes>metadata.size) throw new Error('PAYLOAD_SIZE_MISMATCH');pieces.push(chunk.source);
    }
  }
  const source=pieces.join('');
  if(bytes!==metadata.size || crypto.createHash('sha256').update(source,'utf8').digest('hex')!==metadata.hash) throw new Error('PAYLOAD_HASH_OR_SIZE_MISMATCH');
  return {source,version:metadata.version,hash:metadata.hash};
}
const usageEvidenceData=event=>Buffer.from('PmheeAether.usage-evidence.v1\n'+JSON.stringify([event.eventId,event.sequence,event.slotId,event.bangkokDate,event.observedAt,event.deviceId,event.leaseId,event.runtimeNonce,event.previousAnchor]));
function createScriptCoordinator({ dataDir, loadProfiles, evalProfilePort, service, now = Date.now, protect = dpapi, unprotect = value => dpapi(value, true), trustedKeys = {}, pilotProfileIds = [], configurationCode = 'DEFAULT_OBSERVATION', serviceOrigin = service.serviceOrigin, reloadRollout }) {
  const stateFile = path.join(dataDir, 'script_coordinator_v1.json'), keyFile = path.join(dataDir, 'script_device_v1.json');
  let state = { schema: 1, slots: {}, queue: [], sequence: 0, observed: {} }, device = null, timer = null, inFlight = false;
  const clients = {}, pilot = new Set(pilotProfileIds);
  let rolloutRevision=0, billingMode=null, billingCheckedAt=0;
  const bootstrapSource=()=>fs.readFileSync(path.join(__dirname,'script_bootstrap.js'),'utf8').replace('/* PMHEE_PUBLIC_KEYS */ {}',JSON.stringify(trustedKeys));
  function applyRollout(next) {
    if(!next || next.serviceOrigin!==serviceOrigin || !Array.isArray(next.pilotProfileIds))throw Error('ROLLOUT_ORIGIN_CHANGED');
    const fingerprint=JSON.stringify([next.mode,next.pilotProfileIds,next.trustedKeys,next.configurationCode]);
    if(fingerprint===appliedRolloutFingerprint)return;
    pilot.clear();for(const id of next.pilotProfileIds)pilot.add(id);
    trustedKeys=next.trustedKeys;configurationCode=next.configurationCode;
    appliedRolloutFingerprint=fingerprint;rolloutRevision++;
  }
  let appliedRolloutFingerprint=null;
  let registeredAccount = null;
  const requestTimes=[], downloadAttempts=new Map(), slotRefreshNeeded=new Set();
  async function apiCall(route,body) {
    while(requestTimes.length && requestTimes[0]<=now()-60000)requestTimes.shift();
    // Leave headroom below account120/min for statement, topup and owner operations.
    if(requestTimes.length>=96) throw new Error('COORDINATOR_REQUEST_BUDGET');
    requestTimes.push(now());return service.serviceRequest(route,body);
  }
  try { const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8')); if(saved.schema !== 1 || !Array.isArray(saved.queue) || !saved.slots || !saved.observed || !Number.isSafeInteger(saved.sequence)) throw new Error('INVALID_COORDINATOR_STATE'); state = saved; } catch(e) { if(e.code !== 'ENOENT') throw e; }
  const write = (file, value) => { fs.mkdirSync(dataDir, { recursive:true }); fs.writeFileSync(file+'.tmp', JSON.stringify(value), {mode:0o600}); fs.renameSync(file+'.tmp',file); };
  const persist = () => write(stateFile,state);
  if (!state.managerInstanceId) { state.managerInstanceId = crypto.randomUUID(); persist(); }
  const instanceId = state.managerInstanceId;
  const dateKey = () => new Date(now()+7*3600000).toISOString().slice(0,10);
  async function ensureDevice() {
    if(device) return device;
    try { const saved=JSON.parse(fs.readFileSync(keyFile,'utf8')); device={deviceId:saved.deviceId,privateKey:crypto.createPrivateKey(Buffer.from(unprotect(saved.protectedKey),'base64').toString('utf8')),publicJwk:saved.publicJwk}; }
    catch(e) {
      if(e.code !== 'ENOENT') throw e;
      const keys=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
      device={deviceId:crypto.randomUUID(),privateKey:keys.privateKey,publicJwk:keys.publicKey.export({format:'jwk'})};
      write(keyFile,{deviceId:device.deviceId,publicJwk:device.publicJwk,protectedKey:protect(Buffer.from(keys.privateKey.export({type:'pkcs8',format:'pem'})).toString('base64'))});
    }
    return device;
  }
  function verifyDelivery(ticket,payload,expected) {
    if(typeof ticket?.claims!=='string' || !/^[A-Za-z0-9_-]+$/.test(ticket.claims)) throw new Error('INVALID_SCRIPT_TICKET');
    const claims=JSON.parse(Buffer.from(ticket.claims,'base64url').toString('utf8')), key=trustedKeys[ticket.keyId];
    const accountId=service.loadSettings?.().accountId;
    if(!claims || !key || (accountId && claims.accountId!==accountId) || claims.protocol!==1 || claims.deviceId!==expected.deviceId || claims.slotId!==expected.slotId || claims.runtimeNonce!==expected.runtimeNonce || claims.managerInstanceId!==instanceId || claims.bindingVersion!==expected.bindingVersion || ![claims.issuedAt,claims.expiresAt,claims.graceUntil].every(Number.isSafeInteger) || claims.expiresAt<=now() || claims.expiresAt<=claims.issuedAt || claims.issuedAt>now()+30000 || claims.expiresAt-claims.issuedAt>900000 || claims.graceUntil<claims.expiresAt || claims.graceUntil-claims.expiresAt>300000) throw new Error('INVALID_SCRIPT_TICKET');
    if(payload && (claims.version!==payload.version || claims.payloadHash!==payload.hash || typeof payload.source!=='string' || Buffer.byteLength(payload.source)>4*1024*1024 || crypto.createHash('sha256').update(payload.source,'utf8').digest('hex')!==payload.hash)) throw new Error('INVALID_PAYLOAD_HASH');
    if(!crypto.verify('sha256',Buffer.from('PmheeAether.ticket.v1\n'+ticket.claims),{key:crypto.createPublicKey({key,format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(ticket.signature,'base64url'))) throw new Error('INVALID_TICKET_SIGNATURE');
    return claims;
  }
  async function cycle() {
    if(inFlight) return; inFlight=true;
    try {
      // Only a cycle boundary can change admissions. Downloads, leases and rebinds retain their original policy.
      if(reloadRollout)applyRollout(reloadRollout());
      if(service.loadSettings?.().accountId && now()-billingCheckedAt>=60000) {
        billingCheckedAt=now();
        try { const summary=await apiCall('/v1/aetheria/usage/statement'); billingMode=summary?.success && ['shadow','deferred'].includes(summary.billingMode) ? summary.billingMode : null; } catch(_) {billingMode=null;}
      }
      const pending=[];
      for(const profile of loadProfiles()) {
        if(!profile.debugPort) continue;
        try {
          const result=await evalProfilePort(profile.debugPort,PROBE_JS,5000);
          if(!result?.success || !result.result) {clients[profile.id]={state:'offline'};continue;}
          const probe=result.result; clients[profile.id]={state:'observed',version:probe.version,busy:probe.busy,protocol:probe.bootstrap?.protocol||0};
          if(probe.bootstrap?.protocol===2){clients[profile.id].state='friends-offline';continue;}
          // Observation is local by default; no enrollment, lease or billable usage.
          const day=dateKey(); if(probe.running) {state.observed[day] ||= {};state.observed[day][profile.id]=true;persist();}
          if(!pilot.has(profile.id)) continue;
          pending.push({profile,probe});
        } catch(e) {clients[profile.id]={state:'not-ready',reason:e.message};}
      }
      // Renew already-running screens before starting bounded new downloads.
      pending.sort((a,b)=>Number(!!b.probe.bootstrap?.activated)-Number(!!a.probe.bootstrap?.activated)||(downloadAttempts.get(a.profile.id)||0)-(downloadAttempts.get(b.profile.id)||0));
      let downloadCount=0;
      for(const {profile,probe} of pending) {
        try {
          const day=dateKey();
          if(!probe.bootstrap && !probe.version && !probe.existingRuntime && !probe.busy.length) {
            if(!Object.keys(trustedKeys).length) throw new Error('PINNED_KEY_REQUIRED');
            const bootstrap=bootstrapSource();
            const injected=await evalProfilePort(profile.debugPort,bootstrap+'\n({success:!!window.__pmScriptBootstrap})',5000);
            if(!injected?.success || injected.result?.success!==true) throw new Error('BOOTSTRAP_NOT_ACKNOWLEDGED');
            clients[profile.id].state='waiting-safe-bootstrap';continue;
          }
          if((probe.version && !probe.bootstrap?.activated) || (probe.existingRuntime && !probe.bootstrap) || !probe.bootstrap?.runtimeNonce || (probe.busy.length && !probe.bootstrap?.activated)) {clients[profile.id].state='waiting-safe-bootstrap';continue;}
          if(!probe.bootstrap.activated && downloadCount>=3) {clients[profile.id].state='waiting-download-budget';continue;}
          const d=await ensureDevice(),accountId=service.loadSettings?.().accountId || 'authenticated-service';
          if(registeredAccount!==accountId) {
            const registration=await apiCall('/v1/aetheria/script/device',{deviceId:d.deviceId,publicJwk:d.publicJwk});
            if(!registration?.success) throw new Error('DEVICE_REGISTRATION_FAILED');
            registeredAccount=service.loadSettings?.().accountId || accountId;
          }
          let slot=state.slots[profile.id];
          if(!slot || slot.accountId!==registeredAccount || slotRefreshNeeded.has(profile.id)) {
            const registered=await apiCall('/v1/aetheria/script/slot',{profileId:profile.id,deviceId:d.deviceId});
            if(!registered.success || typeof registered.slotId!=='string' || !Number.isInteger(registered.bindingVersion)) throw new Error('INVALID_SLOT');
            if(slotRefreshNeeded.has(profile.id) && registered.slotId!==slot.slotId) throw new Error('SERVER_SLOT_ID_CHANGED_REVIEW_REQUIRED');
            slot={slotId:registered.slotId,bindingVersion:registered.bindingVersion,accountId:registeredAccount};state.slots[profile.id]=slot;persist();
            slotRefreshNeeded.delete(profile.id);
          }
          const runtimeNonce=probe.bootstrap.runtimeNonce, proofBody='PmheeAether.device.v1\n'+JSON.stringify([slot.slotId,d.deviceId,instanceId,runtimeNonce]);
          const proof=crypto.sign('sha256',Buffer.from(proofBody),{key:d.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
          const lease=await apiCall('/v1/aetheria/script/lease',{slotId:slot.slotId,deviceId:d.deviceId,managerInstanceId:instanceId,runtimeNonce,proof});
          if(probe.bootstrap.activated) {
            const activeClaims=verifyDelivery(lease.ticket,null,{...d,...slot,runtimeNonce});
            const knownHash=probe.bootstrap.payloadHash || (state.runtimeHashes?.[profile.id]?.runtimeNonce===runtimeNonce ? state.runtimeHashes[profile.id].hash : null);
            if(activeClaims.version!==(probe.bootstrap.version||probe.version) || (knownHash && activeClaims.payloadHash!==knownHash)) {clients[profile.id]={state:'update-required',reason:'รุ่นหรือ hash เปลี่ยน รออัปเดตที่ช่วงปลอดภัย',busy:probe.busy};continue;}
            const renewed=await evalProfilePort(profile.debugPort,`window.__pmScriptBootstrap.renew(${JSON.stringify(lease.ticket)})`,5000);
            if(!renewed?.success || renewed.result?.success!==true) throw new Error(renewed?.result?.code==='BINDING_CHANGED'?'SCRIPT_UPDATE_REFRESH_REQUIRED':'RENEWAL_NOT_ACKNOWLEDGED');
            if(probe.running) enqueue(slot.slotId,day,d,lease.leaseId,runtimeNonce);
            clients[profile.id].state='authorized';continue;
          }
          downloadCount++;downloadAttempts.set(profile.id,now());
          const claims=verifyDelivery(lease.ticket,null,{...d,...slot,runtimeNonce});
          if(claims.leaseId!==lease.leaseId)throw new Error('LEASE_TICKET_MISMATCH');
          const metadata=await apiCall('/v1/aetheria/script/payload',{leaseId:lease.leaseId,runtimeNonce});
          if(metadata.version!==claims.version || metadata.hash!==claims.payloadHash)throw new Error('PAYLOAD_METADATA_NOT_APPROVED');
          const payload=await fetchApprovedPayload({serviceRequest:apiCall},metadata,{leaseId:lease.leaseId,runtimeNonce});
          verifyDelivery(lease.ticket,payload,{...d,...slot,runtimeNonce});
          const delivered=await evalProfilePort(profile.debugPort,`window.__pmScriptBootstrap.accept(${JSON.stringify({ticket:lease.ticket,payload,profileId:profile.id})})`,30000);
          if(!delivered?.success || delivered.result?.success!==true) throw new Error('DELIVERY_NOT_ACKNOWLEDGED');
          state.runtimeHashes ||= {};state.runtimeHashes[profile.id]={runtimeNonce,hash:payload.hash,version:payload.version};persist();
          clients[profile.id].state='authorized';
        } catch(e) {
          if(e.message==='INVALID_SCRIPT_TICKET' || ['SLOT_BINDING_CONFLICT','SLOT_INVALID','LEASE_INVALID'].includes(e.code))slotRefreshNeeded.add(profile.id);
          clients[profile.id]={state:e.message==='SCRIPT_UPDATE_REFRESH_REQUIRED'?'update-required':'not-ready',reason:e.message};
        }
      }
      await flush();
    } finally {inFlight=false;}
  }
  function enqueue(slotId,day,d,leaseId,runtimeNonce) {
    const usageKey=slotId+':'+day;
    state.usageKeys ||= {};
    if(state.usageKeys[usageKey]) return;
    if(state.queue.length>=10000) throw new Error('USAGE_QUEUE_FULL');
    const event={eventId:crypto.randomUUID(),sequence:++state.sequence,slotId,bangkokDate:day,observedAt:now(),deviceId:d.deviceId,leaseId,runtimeNonce,previousAnchor:state.lastAckAnchor||null};
    event.proof=crypto.sign('sha256',usageEvidenceData(event),{key:d.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
    state.queue.push(event); state.usageKeys[usageKey]=event.eventId;persist();
  }
  async function flush() {
    // Shadow records cannot activate billing. Offline records stay durable until explicit IDs are acknowledged.
    if(!state.queue.length) return;
    for(const event of state.queue.slice(0,100)) {
      // The API only trusts server time. Never turn yesterday's queued evidence into today's charge.
      if(event.bangkokDate!==dateKey() || ['LEASE_INVALID','ACTIVE_LEASE_REQUIRED'].includes(event.reconciliationReason)) continue;
      try {
        if(!event.proof) {event.reconciliationReason='UNSIGNED_USAGE_EVIDENCE';persist();continue;}
        const d=await ensureDevice();
        if(event.deviceId!==d.deviceId || !Number.isSafeInteger(event.sequence) || event.sequence<1 || event.sequence>state.sequence || state.queue.filter(other=>other.sequence===event.sequence).length!==1 || !crypto.verify('sha256',usageEvidenceData(event),{key:crypto.createPublicKey(d.privateKey),dsaEncoding:'ieee-p1363'},Buffer.from(event.proof,'base64url'))) {
          event.reconciliationReason='INVALID_USAGE_EVIDENCE';persist();continue;
        }
        const response=await apiCall('/v1/aetheria/usage/record',{slotId:event.slotId,eventId:event.eventId,leaseId:event.leaseId,runtimeNonce:event.runtimeNonce});
        if(response.success && response.eventId===event.eventId && response.slotId===event.slotId && response.bangkokDay===event.bangkokDate) {
          const accountId=service.loadSettings?.().accountId;
          if(!/^[a-f0-9]{64}$/.test(response.ackAnchor||'') || (accountId && response.ackAnchor!==crypto.createHash('sha256').update(JSON.stringify([accountId,event.eventId,event.slotId,event.bangkokDate])).digest('hex'))) {event.reconciliationReason='INVALID_SERVER_ACK_ANCHOR';persist();continue;}
          state.lastAckAnchor=response.ackAnchor;state.lastAckSequence=event.sequence;
          state.queue=state.queue.filter(e=>e.eventId!==event.eventId);persist();
        }
      } catch(e){event.reconciliationReason=e.code||e.message;persist();if(!e.code || e.code==='SERVICE_UNAVAILABLE')break;}
    }
  }
  async function prepareCredentialChange(profile) {
    if(inFlight)throw Error('กำลังตรวจสิทธิ์จอ กรุณาลองใหม่หลังรอบนี้');
    inFlight=true;
    try {
    const slot=state.slots[profile.id];
    if(!slot) return {success:true,observation:true};
    const probe=await evalProfilePort(profile.debugPort,PROBE_JS,3000);
    if(probe?.success && probe.result) throw new Error('ต้องปิดเฉพาะจอนี้ก่อนเปลี่ยนข้อมูลเข้าบัญชี');
    const d=await ensureDevice();state.pendingRebind ||= {};
    if(!state.pendingRebind[profile.id]) {
      state.pendingRebind[profile.id]={slotId:slot.slotId,deviceId:d.deviceId,expectedBindingVersion:slot.bindingVersion,requestId:crypto.randomUUID()};persist();
    }
    const pending=state.pendingRebind[profile.id];
    if(pending.slotId!==slot.slotId || pending.deviceId!==d.deviceId) throw new Error('ต้องตรวจ pending binding เดิมก่อนเปลี่ยนเครื่อง');
    const body={...pending};
    body.proof=crypto.sign('sha256',Buffer.from('PmheeAether.rebind.v1\n'+JSON.stringify([body.slotId,body.deviceId,body.expectedBindingVersion,body.requestId])),{key:d.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
    const result=await apiCall('/v1/aetheria/script/rebind',body);
    if(!result.success || result.slotId!==slot.slotId || !Number.isInteger(result.bindingVersion) || result.bindingVersion<=slot.bindingVersion) throw new Error('ยังยืนยันการเปลี่ยน binding บนเซิร์ฟเวอร์ไม่ได้');
    slot.bindingVersion=result.bindingVersion;delete state.pendingRebind[profile.id];persist();return {success:true,slotId:slot.slotId};
    } finally {inFlight=false;}
  }
  return {cycle,verifyDelivery,prepareCredentialChange,profileScriptSource(profileId){return pilot.has(profileId)?bootstrapSource():null;},start(){if(!timer){cycle().catch(()=>{});timer=setInterval(()=>cycle().catch(()=>{}),30000);timer.unref();}},stop(){clearInterval(timer);timer=null;},status(){return {success:true,mode:pilot.size?(billingMode==='deferred'?'pilot-deferred':'pilot-shadow'):'observation',configurationCode,serviceOrigin,rolloutRevision,cycleInFlight:inFlight,pilotProfileIds:[...pilot],billingEnabled:billingMode===null?null:billingMode==='deferred',billingMode,billingCheckedAt,pendingEvents:state.queue.length,reconciliationRequired:state.queue.filter(e=>!e.proof||e.bangkokDate!==dateKey()||['LEASE_INVALID','ACTIVE_LEASE_REQUIRED','UNSIGNED_USAGE_EVIDENCE','INVALID_USAGE_EVIDENCE','INVALID_SERVER_ACK_ANCHOR'].includes(e.reconciliationReason)).length,observedSlotsToday:Object.keys(state.observed[dateKey()]||{}).length,clients};}};
}
module.exports={createScriptCoordinator,PROBE_JS,fetchApprovedPayload,usageEvidenceData};
