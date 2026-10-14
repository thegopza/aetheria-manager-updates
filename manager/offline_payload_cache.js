'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {dpapi,encryptedStore}=require('./offline_journal');
function verifyOfflineRelease(release,trustedKeys){
  if(typeof release?.source!=='string'||Buffer.byteLength(release.source)>4*1024*1024||typeof release.envelope?.claims!=='string'||typeof release.envelope?.signature!=='string')throw Error('INVALID_OFFLINE_RELEASE');
  const envelope=release.envelope,key=trustedKeys[envelope.keyId],claims=JSON.parse(Buffer.from(envelope.claims,'base64url').toString('utf8'));
  if(!key||claims.protocol!==2||claims.mode!=='friends-offline'||!/^\d+\.\d+\.\d+$/.test(claims.version)||!Number.isSafeInteger(claims.issuedAt)||claims.size!==Buffer.byteLength(release.source)||claims.payloadHash!==crypto.createHash('sha256').update(release.source).digest('hex')||!crypto.verify('sha256',Buffer.from('PmheeAether.offline-release.v1\n'+envelope.claims),{key:crypto.createPublicKey({key,format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(envelope.signature,'base64url')))throw Error('OFFLINE_RELEASE_SIGNATURE_INVALID');
  return claims;
}
function createOfflinePayloadCache({dataDir,trustedKeys,protect=dpapi,unprotect=v=>dpapi(v,true)}){
  const dir=path.join(dataDir,'offline-cache');fs.mkdirSync(dir,{recursive:true});const index=path.join(dir,'index.dat'),store=encryptedStore(dir,protect,unprotect);let release=null,loadedName=null;
  function load(){try{const name=fs.readFileSync(index,'utf8').trim();if(!/^[a-f0-9]{32}\.dat$/.test(name))throw Error('INVALID_CACHE_INDEX');if(release&&loadedName===name)return release;const candidate=store.decode(fs.readFileSync(path.join(dir,name),'utf8'));verifyOfflineRelease(candidate,trustedKeys);release=candidate;loadedName=name;}catch(e){if(e.code!=='ENOENT')throw e;if(fs.existsSync(index))throw Error('OFFLINE_PAYLOAD_CACHE_MISSING');}return release;}
  function save(value){verifyOfflineRelease(value,trustedKeys);const name=crypto.randomBytes(16).toString('hex')+'.dat';fs.writeFileSync(path.join(dir,name),store.encode(value),{mode:0o600});fs.writeFileSync(index+'.tmp',name,{mode:0o600});fs.renameSync(index+'.tmp',index);release=value;loadedName=name;return release;}
  return {load,save,get:()=>{try{const name=fs.readFileSync(index,'utf8').trim();if(name!==loadedName)load();}catch(_){}return release;}};
}
module.exports={createOfflinePayloadCache,verifyOfflineRelease};
