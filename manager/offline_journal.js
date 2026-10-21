'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {execFileSync}=require('child_process');
function dpapi(value,decrypt=false){
  if(process.platform!=='win32')throw Error('WINDOWS_DPAPI_REQUIRED');
  const script=`Add-Type -AssemblyName System.Security; $v=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${decrypt?'Unprotect':'Protect'}($v,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`;
  return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{input:value,encoding:'utf8',windowsHide:true}).trim();
}
const bangkokDate=ms=>new Date(ms+7*3600000).toISOString().slice(0,10);
// Acknowledged history older than this may be pruned; unacknowledged debt is never pruned.
const HISTORY_RETENTION_MS=400*86400000;
function validDebtPolicy(policy){return !!policy&&typeof policy==='object'&&!Array.isArray(policy)&&typeof policy.enabled==='boolean'&&Number.isSafeInteger(policy.revision)&&policy.revision>=0&&Number.isSafeInteger(policy.effectiveAt)&&policy.effectiveAt>=0;}
function encryptedStore(dir,protect,unprotect){
  const file=path.join(dir,'key.dat');let key;
  try{key=Buffer.from(unprotect(fs.readFileSync(file,'utf8')),'base64');if(key.length!==32)throw Error('INVALID_STORAGE_KEY');}
  catch(e){if(e.code!=='ENOENT')throw e;if(fs.existsSync(path.join(dir,'index.dat')))throw Error('STORAGE_KEY_MISSING');key=crypto.randomBytes(32);fs.writeFileSync(file+'.tmp',protect(key.toString('base64')),{mode:0o600});fs.renameSync(file+'.tmp',file);}
  return {encode(value){const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce),body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return JSON.stringify({v:1,nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),body:body.toString('base64')});},decode(text){const value=JSON.parse(text);if(value.v!==1)throw Error('INVALID_STORAGE_FORMAT');const cipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(value.nonce,'base64'));cipher.setAuthTag(Buffer.from(value.tag,'base64'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.body,'base64')),cipher.final()]).toString('utf8'));}};
}
function createOfflineJournal({dataDir,accountId,initialBalanceUnits=0,now=Date.now,protect=dpapi,unprotect=v=>dpapi(v,true)}){
  if(typeof accountId!=='string'||!accountId)throw Error('ACCOUNT_REQUIRED');
  const dir=path.join(dataDir,'offline',crypto.createHash('sha256').update(accountId).digest('hex'));
  fs.mkdirSync(dir,{recursive:true});const index=path.join(dir,'index.dat');
  const store=encryptedStore(dir,protect,unprotect);
  const read=file=>store.decode(fs.readFileSync(file,'utf8'));
  const write=(file,value)=>{fs.writeFileSync(file+'.tmp',store.encode(value),{mode:0o600});fs.renameSync(file+'.tmp',file);};
  let state={schema:1,accountId,machineId:crypto.randomUUID(),slots:{},seen:{},days:{},history:[],balanceUnits:Number.isSafeInteger(initialBalanceUnits)?initialBalanceUnits:0,rateUnits:100,unitScale:100,debtPolicy:{enabled:true,revision:0,effectiveAt:0}};let pending=[];
  try{state=read(index);if(state.schema!==1||state.accountId!==accountId||!state.days||!state.slots||!state.seen||!Array.isArray(state.history)||!Number.isSafeInteger(state.balanceUnits)||!Number.isSafeInteger(state.rateUnits)||state.rateUnits<0||(state.walletRevision!==undefined&&(!Number.isSafeInteger(state.walletRevision)||state.walletRevision<0)))throw Error('INVALID_JOURNAL');if(state.debtPolicy!==undefined&&!validDebtPolicy(state.debtPolicy))throw Error('INVALID_JOURNAL_POLICY');for(const h of state.history){if(!h||typeof h.eventId!=='string'||typeof h.slotId!=='string'||typeof h.profileId!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(h.date||'')||!Number.isSafeInteger(h.observedAt)||!Number.isSafeInteger(h.rateUnits))throw Error('INVALID_JOURNAL_HISTORY');}for(const [day,name]of Object.entries(state.days)){if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\w{32}\.dat$/.test(name))throw Error('INVALID_JOURNAL');const events=read(path.join(dir,name));if(!Array.isArray(events)||events.some(e=>e.date!==day||typeof e.eventId!=='string'||!Number.isSafeInteger(e.rateUnits)))throw Error('INVALID_DAILY_JOURNAL');pending.push(...events);}}catch(e){if(e.code!=='ENOENT'||fs.existsSync(index))throw Error('OFFLINE_JOURNAL_CORRUPT: '+e.message);}
  state.debtPolicy ||= {enabled:true,revision:0,effectiveAt:0};
  function persist(){const prior=state.days,days={};for(const day of new Set(pending.map(e=>e.date))){const name=crypto.randomBytes(16).toString('hex')+'.dat';write(path.join(dir,name),pending.filter(e=>e.date===day));days[day]=name;}write(index,{...state,days});state.days=days;for(const name of Object.values(prior)){try{fs.unlinkSync(path.join(dir,name));}catch(_){}}}
  if(!fs.existsSync(index)){
    try{const legacy=JSON.parse(fs.readFileSync(path.join(dataDir,'script_coordinator_v1.json'),'utf8'));for(const [id,value]of Object.entries(legacy.slots||{}))if(value.accountId===accountId&&typeof value.slotId==='string')state.slots[id]=value.slotId;}catch(e){if(e.code!=='ENOENT')throw Error('LEGACY_SLOT_IMPORT_FAILED');}
    persist();
  }
  function slot(profileId){if(typeof profileId!=='string'||!profileId||profileId.length>128)throw Error('INVALID_PROFILE_ID');if(!state.slots[profileId]){state.slots[profileId]=crypto.randomUUID();persist();}return state.slots[profileId];}
  function observe({profileId,characterId,observedAt=now()}){if(typeof profileId!=='string'||!profileId||profileId.length>128)throw Error('INVALID_PROFILE_ID');if(characterId!=null&&(typeof characterId!=='string'||characterId.length>128))throw Error('INVALID_CHARACTER_ID');if(!Number.isSafeInteger(observedAt)||observedAt<0)throw Error('INVALID_OBSERVED_AT');const slotId=slot(profileId),date=bangkokDate(observedAt),key=slotId+':'+date;if(!state.debtPolicy.enabled||state.seen[key])return null;const event={eventId:crypto.randomUUID(),slotId,profileId,date,observedAt,rateUnits:state.rateUnits,...(characterId?{characterId}:{} )};state.seen[key]=event.eventId;pending.push(event);state.history.push(event);const keepAfter=observedAt-HISTORY_RETENTION_MS;if(state.history.length>1000)state.history=state.history.filter(e=>!e.acknowledged||e.observedAt>=keepAfter);persist();return event;}
  function snapshot(limit=500,sessions=[]){if(state.pendingBatch)return JSON.parse(JSON.stringify(state.pendingBatch));const boundedLimit=Math.max(1,Math.min(Number.isSafeInteger(limit)?limit:500,500));const cleanSessions=Array.isArray(sessions)?sessions.filter(s=>s&&typeof s.profileId==='string'&&typeof s.slotId==='string').slice(0,1000):[];state.pendingBatch={machineId:state.machineId,batchId:crypto.randomUUID(),events:pending.slice(0,boundedLimit).map(({rateUnits,...event})=>event),sessions:cleanSessions};persist();return JSON.parse(JSON.stringify(state.pendingBatch));}
  // Review R4: clearing ACKed events and accepting a balance snapshot are separate. Clearing is always correct
  // (the server settled those events at or before response.walletRevision). The balance/rate/statement are only
  // accepted when the server's walletRevision is newer than the base we already hold, so a delayed ACK can never
  // roll back a newer topup/admin balance.
  function acknowledge(batch,response){if(response?.success!==true||response.batchId!==batch.batchId||response.unitScale!==100||!Number.isSafeInteger(response.balanceUnits)||!Number.isSafeInteger(response.rateUnits)||response.rateUnits<0||!Number.isSafeInteger(response.walletRevision)||response.walletRevision<0||!Array.isArray(response.ackEventIds))throw Error('INVALID_SYNC_ACK');const submitted=new Set(batch.events.map(e=>e.eventId));if(response.ackEventIds.some(id=>!submitted.has(id))||new Set(response.ackEventIds).size!==response.ackEventIds.length)throw Error('INVALID_SYNC_ACK_IDS');const policy=validateResponsePolicy(response);const charges=validateEventCharges(response);const ack=new Set(response.ackEventIds);pending=pending.filter(e=>!ack.has(e.eventId));for(const event of state.history)if(ack.has(event.eventId)){event.acknowledged=true;if(charges.has(event.eventId)){event.rateUnits=charges.get(event.eventId);const seenKey=event.slotId+':'+event.date;if(event.rateUnits===0&&state.seen[seenKey]===event.eventId)delete state.seen[seenKey];}}if(state.pendingBatch&&state.pendingBatch.batchId===batch.batchId)delete state.pendingBatch;const policyApplied=policy&&policy.revision>state.debtPolicy.revision;if(policyApplied)state.debtPolicy=policy;const currentRev=Number.isSafeInteger(state.walletRevision)?state.walletRevision:-1;const notOlder=response.walletRevision>=currentRev;const applied=acceptSnapshot(response.walletRevision,response.balanceUnits);if(applied||notOlder){state.rateUnits=response.rateUnits;state.statement=response.statement||state.statement;const syncDay=typeof response.bangkokDay==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(response.bangkokDay)?response.bangkokDay:bangkokDate(now());for(const event of state.history){if(event.acknowledged&&event.date===syncDay&&event.rateUnits>0&&!charges.has(event.eventId)){event.rateUnits=response.rateUnits;}}}persist();return {balance:balance(),applied,policyApplied:!!policyApplied,stale:!applied};}
  function validateEventCharges(response){
    const charges=new Map();if(response.eventCharges===undefined)return charges;
    if(!Array.isArray(response.eventCharges)||response.eventCharges.length!==response.ackEventIds.length)throw Error('INVALID_SYNC_EVENT_CHARGES');
    for(const e of response.eventCharges){if(!e||!response.ackEventIds.includes(e.eventId)||charges.has(e.eventId)||!Number.isSafeInteger(e.rateUnits)||e.rateUnits<0)throw Error('INVALID_SYNC_EVENT_CHARGES');charges.set(e.eventId,e.rateUnits);}
    return charges;
  }
  // Policy ordering is independent of wallet ordering. Validate before clearing any durable debt.
  function validateResponsePolicy(response){
    if(response.debtPolicy===undefined)return null; // Old hosts cannot reset a cached admin switch.
    const p=response.debtPolicy;
    if(!validDebtPolicy(p)||(response.billingEnabled!==undefined&&response.billingEnabled!==p.enabled)||(response.debtPolicyRevision!==undefined&&response.debtPolicyRevision!==p.revision))throw Error('INVALID_SYNC_DEBT_POLICY');
    const current=state.debtPolicy;
    if(p.revision<current.revision)return null; // Valid old ACKs still settle debt; never roll the switch back.
    if(p.revision===current.revision&&(p.enabled!==current.enabled||p.effectiveAt!==current.effectiveAt))throw Error('CONFLICTING_SYNC_DEBT_POLICY');
    return {enabled:p.enabled,revision:p.revision,effectiveAt:p.effectiveAt};
  }
  function acceptSnapshot(revision,value){const current=Number.isSafeInteger(state.walletRevision)?state.walletRevision:-1;if(revision<=current)return false;state.walletRevision=revision;state.balanceUnits=value;return true;}
  function balance(){return state.balanceUnits-pending.reduce((sum,e)=>sum+e.rateUnits,0);}
  return {slot,observe,snapshot,acknowledge,balance,debtPolicy:()=>({...state.debtPolicy}),
    // A confirmed balance must carry the server walletRevision it was read at; older/equal revisions are ignored.
    setConfirmedBalance(value,revision){if(!Number.isSafeInteger(value))throw Error('INVALID_CONFIRMED_BALANCE');if(!Number.isSafeInteger(revision)||revision<0)throw Error('WALLET_REVISION_REQUIRED');const applied=acceptSnapshot(revision,value);if(applied)persist();return applied;},
    walletRevision:()=>Number.isSafeInteger(state.walletRevision)?state.walletRevision:null,
    pendingCount:()=>pending.length,machineId:state.machineId,history:()=>state.history.map(e=>({...e})),statement:()=>state.statement||null,rate:()=>state.rateUnits};
}
module.exports={createOfflineJournal,dpapi,bangkokDate,encryptedStore};
