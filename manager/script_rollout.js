'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const productionKeys=require('./script_release_keys');
const STAGING_ORIGIN='https://pmhee-aetheria-staging.pmhee-aetheria-worker.workers.dev';
const PRODUCTION_ORIGIN='https://api.noggunsshop.xyz';
function publicPins(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length>20) throw Error('INVALID_PUBLIC_PINS');
  const keys=Object.create(null);
  for(const [id,jwk] of Object.entries(input)) {
    if(!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !jwk || Object.keys(jwk).some(k=>!['kty','crv','x','y'].includes(k)) || jwk.kty!=='EC' || jwk.crv!=='P-256' || !/^[A-Za-z0-9_-]{43}$/.test(jwk.x||'') || !/^[A-Za-z0-9_-]{43}$/.test(jwk.y||'')) throw Error('INVALID_PUBLIC_PINS');
    crypto.createPublicKey({key:jwk,format:'jwk'});
    keys[id]=Object.freeze({kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y});
  }
  return Object.freeze(keys);
}
function validateScriptRollout(config,serviceOrigin) {
  const observation=code=>({mode:'observation',pilotProfileIds:Object.freeze([]),trustedKeys:Object.freeze({}),serviceOrigin,configurationCode:code});
  try {
    if(!config || config.schema!==1 || !['observation','pilot'].includes(config.mode) || Object.keys(config).some(k=>!['schema','mode','pilotProfileIds','stagingPublicKeys'].includes(k)))throw Error('INVALID_ROLLOUT_CONFIG');
    if(config.mode==='observation')return observation('EXPLICIT_OBSERVATION');
    if(!Array.isArray(config.pilotProfileIds) || !config.pilotProfileIds.length || config.pilotProfileIds.length>100 || config.pilotProfileIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(id)) || new Set(config.pilotProfileIds).size!==config.pilotProfileIds.length)throw Error('INVALID_PILOT_PROFILES');
    let keys;
    if(serviceOrigin===STAGING_ORIGIN) keys=publicPins(config.stagingPublicKeys);
    else if(serviceOrigin===PRODUCTION_ORIGIN) {
      if(Object.hasOwn(config,'stagingPublicKeys'))throw Error('PRODUCTION_LOCAL_PINS_FORBIDDEN');
      keys=publicPins(productionKeys);
    } else throw Error('UNAPPROVED_PILOT_ORIGIN');
    if(!Object.keys(keys).length)throw Error('RELEASE_PUBLIC_PINS_NOT_PROVISIONED');
    return {mode:'pilot',pilotProfileIds:Object.freeze([...config.pilotProfileIds]),trustedKeys:keys,serviceOrigin,configurationCode:'EXPLICIT_PILOT'};
  }catch(error){return observation(error.message);}
}
function loadScriptRollout({dataDir,serviceOrigin}) {
  try {
    const text=fs.readFileSync(path.join(dataDir,'script_rollout_v1.json'),'utf8');
    if(Buffer.byteLength(text)>32768)throw Error('CONFIG_TOO_LARGE');
    return validateScriptRollout(JSON.parse(text),serviceOrigin);
  } catch(error) {
    return {mode:'observation',pilotProfileIds:Object.freeze([]),trustedKeys:Object.freeze({}),serviceOrigin,configurationCode:error.code==='ENOENT'?'DEFAULT_OBSERVATION':'INVALID_ROLLOUT_CONFIG'};
  }
}
function saveScriptRolloutSelection({dataDir,serviceOrigin,profiles,mode,pilotProfileIds,acknowledgePilot}) {
  if(!['observation','pilot'].includes(mode)||!Array.isArray(pilotProfileIds))throw Error('INVALID_ROLLOUT_SELECTION');
  if(mode==='pilot'&&acknowledgePilot!==true)throw Error('PILOT_ACKNOWLEDGEMENT_REQUIRED');
  const known=new Set(profiles.map(profile=>profile.id));
  if(pilotProfileIds.some(id=>!known.has(id)))throw Error('UNKNOWN_PILOT_PROFILE');
  const config={schema:1,mode,pilotProfileIds:mode==='pilot'?pilotProfileIds:[]};
  // The UI chooses profiles, never trust anchors. Staging pins can only come from owner-prepared local configuration.
  if(serviceOrigin===STAGING_ORIGIN) {
    try {config.stagingPublicKeys=publicPins(JSON.parse(fs.readFileSync(path.join(dataDir,'script_rollout_v1.json'),'utf8')).stagingPublicKeys);}catch(_){}
  }
  const verified=validateScriptRollout(config,serviceOrigin);
  if(mode==='pilot'&&verified.mode!=='pilot')throw Error(verified.configurationCode);
  const file=path.join(dataDir,'script_rollout_v1.json');fs.mkdirSync(dataDir,{recursive:true});
  fs.writeFileSync(file+'.tmp',JSON.stringify(config,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);
  return verified;
}
module.exports={loadScriptRollout,saveScriptRolloutSelection,validateScriptRollout,STAGING_ORIGIN,PRODUCTION_ORIGIN};
