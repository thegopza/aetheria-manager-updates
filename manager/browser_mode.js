// manager/browser_mode.js — run game clients as windows of ONE real Chrome / Edge instead of one Electron
// app per client. All windows share one browser + GPU process (much lighter than N Electron apps).
//
// The Manager drives that browser through the Chrome DevTools Protocol (remote debugging port) and, for each
// profile, serves the same small HTTP API the Electron loader serves on profile.debugPort (/api/eval,
// /api/state, /api/window), so the rest of the Manager works unchanged.
// - each window gets window.__pmProfileId before the page runs: bot.js uses it to keep its localStorage
//   settings per profile (all windows share one browser storage)
// - bot.js (GitHub, local fallback) + msgpack are injected on every load of the game page
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const GAME_URL = 'https://www.aetheria-online.in.th/play';
const BOT_URL = 'https://raw.githubusercontent.com/thegopza/aetheria-pelican-bot/main/bot.js';
const DEFAULT_CDP_PORT = 9339;
const MAX_SCREENS_PER_DEVICE = 3;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;
function deriveMachineId(seed) {
  return crypto.createHash('sha256').update('pmhee-machine:' + String(seed || crypto.randomUUID())).digest('hex');
}
const HEALTH_JS = `(() => {
  const bs = window.__pmScriptBootstrap?.status?.() || null;
  const bootstrapPhase = bs?.phase || null;
  return {
    href: location.href,
    documentId: String(performance.timeOrigin),
    ready: document.readyState,
    profileId: window.__pmProfileId || (typeof sessionStorage !== 'undefined' && sessionStorage.getItem && sessionStorage.getItem('__pmProfileId')) || null,
    deviceId: window.__pmDeviceId || null,
    machineId: window.__pmMachineId || null,
    storageRestored: !!window.__pmStorageRestored,
    version: window.__pelicanBotVersion || null,
    hud: !!document.getElementById('pelican-hud'),
    liveHook: typeof window.__getClientLiveState === 'function',
    bootstrapPhase,
    bootstrapFailed: bootstrapPhase === 'failed',
    payloadInitialized: !!window.__pmPayloadInitialized,
    initialized: !!window.__pmPayloadInitialized || (bs && bootstrapPhase !== 'waiting') || !!window.__pmBrowserInjectionAttempted || ('__isBotRunning' in window) || typeof window.startMasterBot === 'function' || typeof window.startAutoLoop === 'function'
  };
})()`;

function findBrowser(kind) {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const chrome = [path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'), path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'), path.join(local, 'Google\\Chrome\\Application\\chrome.exe')];
  const edge = [path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'), path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe')];
  const list = kind === 'edge' ? edge.concat(chrome) : chrome.concat(edge);
  return list.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
}

function getText(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let d = '';
      res.setEncoding('utf8');
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

function isUnverifiedCandidateAuth(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  if (cfg.register === true) return true;
  if (cfg.registerError && String(cfg.registerError).trim() && !cfg.registerDone && !cfg.verifiedLoginAt && !cfg.userEditedAt) return true;
  if (cfg.generatedUser && !cfg.registerDone && !cfg.verifiedLoginAt && !cfg.userEditedAt) return true;
  return false;
}

function mergeAuthConfigString(existingRaw, incomingRaw) {
  if (!existingRaw) return incomingRaw;
  if (!incomingRaw) return existingRaw;
  try {
    const a = JSON.parse(existingRaw);
    const b = JSON.parse(incomingRaw);
    if (!a || typeof a !== 'object') return incomingRaw;
    if (!b || typeof b !== 'object') return existingRaw;
    const aHasCreds = Boolean(a.username && String(a.username).trim() && a.password && String(a.password).trim());
    const bHasCreds = Boolean(b.username && String(b.username).trim() && b.password && String(b.password).trim());
    const aUnverified = isUnverifiedCandidateAuth(a);
    const bUnverified = isUnverifiedCandidateAuth(b);
    if (aHasCreds && !aUnverified && bUnverified) {
      const keep = { ...b, ...a };
      if (!keep.charName && b.charName) keep.charName = b.charName;
      return JSON.stringify(keep);
    }
    const aStamp = Math.max(Number(a.userEditedAt) || 0, Number(a.verifiedLoginAt) || 0);
    const bStamp = Math.max(Number(b.userEditedAt) || 0, Number(b.verifiedLoginAt) || 0);
    if (aHasCreds && aStamp > 0 && bHasCreds && bStamp < aStamp && (b.generatedUser || Number(b.lastManagerPushAt) > 0)) {
      const keep = { ...b, ...a };
      if (!keep.charName && b.charName) keep.charName = b.charName;
      return JSON.stringify(keep);
    }
    const out = { ...a, ...b };
    if (a.username && String(a.username).trim() && !(b.username && String(b.username).trim())) {
      out.username = a.username;
      if (a.enabled) out.enabled = true;
    }
    if (a.password && String(a.password).trim() && !(b.password && String(b.password).trim())) {
      out.password = a.password;
      if (a.enabled) out.enabled = true;
    }
    if (a.charName && String(a.charName).trim() && !(b.charName && String(b.charName).trim())) {
      out.charName = a.charName;
    }
    return JSON.stringify(out);
  } catch (_) {
    return incomingRaw;
  }
}

function isStubSellWhitelist(wl) {
  const s = String(wl || '').trim();
  return !s || s === 'Halloween Candy, Golden Pumpkin' || s === 'Phracon, Rough Elunium, Enchant Rune, Composite Bow, Crossbow, Gakkung, Hunter Bow';
}

function mergeSellConfigString(existingRaw, incomingRaw) {
  if (!existingRaw) return incomingRaw;
  if (!incomingRaw) return existingRaw;
  try {
    const a = JSON.parse(existingRaw);
    const b = JSON.parse(incomingRaw);
    if (!a || typeof a !== 'object') return incomingRaw;
    if (!b || typeof b !== 'object') return existingRaw;
    const aComplete = typeof a.weaponRarity === 'string' && typeof a.armorRarity === 'string' && Object.keys(a).length >= 8;
    const bComplete = typeof b.weaponRarity === 'string' && typeof b.armorRarity === 'string' && Object.keys(b).length >= 8;
    if (aComplete && !bComplete) {
      const out = { ...a, ...b };
      if (a.whitelist && String(a.whitelist).length > 50 && isStubSellWhitelist(b.whitelist)) {
        out.whitelist = a.whitelist;
      }
      if (a.forceSellList && String(a.forceSellList).trim() && !(b.forceSellList && String(b.forceSellList).trim())) {
        out.forceSellList = a.forceSellList;
      }
      if (a.statsFilter && typeof a.statsFilter === 'object' && (!b.statsFilter || typeof b.statsFilter !== 'object')) {
        out.statsFilter = a.statsFilter;
      }
      return JSON.stringify(out);
    }
    if (aComplete && bComplete && !b.__userSavedAt && isStubSellWhitelist(b.whitelist) && a.whitelist && String(a.whitelist).length > 80 && b.weaponRarity === 'normal' && b.armorRarity === 'normal' && !b.forceSellList) {
      return existingRaw;
    }
    return incomingRaw;
  } catch (_) {
    return incomingRaw;
  }
}

function readVarint(buf, offset, limit) {
  let res = 0, shift = 0, pos = offset;
  const end = limit !== undefined ? limit : buf.length;
  while (pos < end) {
    const b = buf[pos++];
    res += (b & 0x7f) * Math.pow(2, shift);
    if ((b & 0x80) === 0) return { val: res, next: pos };
    shift += 7;
    if (shift > 49) return null;
  }
  return null;
}

function snappyUncompress(comp) {
  const hdr = readVarint(comp, 0);
  if (!hdr || hdr.val <= 0 || hdr.val > 8 * 1024 * 1024) return null;
  const out = Buffer.allocUnsafe(hdr.val);
  let ip = hdr.next, op = 0;
  while (ip < comp.length && op < out.length) {
    const tag = comp[ip++];
    const type = tag & 0x03;
    if (type === 0) {
      let len = (tag >> 2) + 1;
      if (len > 60) {
        const extraBytes = len - 60;
        if (ip + extraBytes > comp.length) return null;
        len = 0;
        for (let i = 0; i < extraBytes; i++) len |= comp[ip++] << (8 * i);
        len += 1;
      }
      if (ip + len > comp.length || op + len > out.length) return null;
      comp.copy(out, op, ip, ip + len);
      ip += len;
      op += len;
    } else {
      let len = 0, offset = 0;
      if (type === 1) {
        len = ((tag >> 2) & 0x07) + 4;
        if (ip >= comp.length) return null;
        offset = ((tag & 0xe0) << 3) | comp[ip++];
      } else if (type === 2) {
        len = (tag >> 2) + 1;
        if (ip + 2 > comp.length) return null;
        offset = comp[ip] | (comp[ip + 1] << 8);
        ip += 2;
      } else {
        len = (tag >> 2) + 1;
        if (ip + 4 > comp.length) return null;
        offset = (comp[ip] | (comp[ip + 1] << 8) | (comp[ip + 2] << 16) | (comp[ip + 3] << 24)) >>> 0;
        ip += 4;
      }
      if (offset <= 0 || offset > op || op + len > out.length) return null;
      for (let i = 0; i < len; i++) {
        out[op] = out[op - offset];
        op++;
      }
    }
  }
  return op === out.length ? out : null;
}

function decodeChromiumString(buf) {
  if (!buf || buf.length === 0) return '';
  if (buf[0] === 0) return buf.subarray(1).toString('utf16le');
  if (buf[0] === 1) return buf.subarray(1).toString('latin1');
  return buf.toString('utf8');
}

function decodeLevelDbKeyAndVal(rawKey, rawVal, isWal) {
  const userKey = (!isWal && rawKey.length >= 8) ? rawKey.subarray(0, rawKey.length - 8) : rawKey;
  const sep = userKey.indexOf(0x00);
  if (sep === -1 || sep + 1 >= userKey.length) return null;
  const keyPart = userKey.subarray(sep + 1);
  return { kStr: decodeChromiumString(keyPart), vStr: decodeChromiumString(rawVal) };
}

function extractPelicanStorageFromLevelDb(levelDbDir, fallbackProfileId = null) {
  const byProfile = {};
  const unprefixed = {};
  const authHistoryByProfile = {};
  const unprefixedAuthHistory = [];
  let totalKeys = 0;
  if (!levelDbDir || !fs.existsSync(levelDbDir)) return { byProfile, unprefixed, authHistoryByProfile, unprefixedAuthHistory, totalKeys };
  const recordAuthHistory = (pid, vStr) => {
    try {
      const parsed = JSON.parse(vStr);
      if (!parsed || typeof parsed !== 'object') return;
      const username = String(parsed.username || '').trim();
      const password = String(parsed.password || '').trim();
      const charName = String(parsed.charName || '').trim();
      if (!username && !password) return;
      const item = {
        username,
        password,
        charName,
        generatedUser: Boolean(parsed.generatedUser),
        register: Boolean(parsed.register),
        registerDone: Boolean(parsed.registerDone),
        registerError: String(parsed.registerError || ''),
        verifiedLoginAt: Number(parsed.verifiedLoginAt) || 0,
        userEditedAt: Number(parsed.userEditedAt) || 0
      };
      const sig = username + ':' + password;
      if (pid) {
        if (!authHistoryByProfile[pid]) authHistoryByProfile[pid] = [];
        const existingIdx = authHistoryByProfile[pid].findIndex(x => (x.username + ':' + x.password) === sig);
        if (existingIdx === -1) authHistoryByProfile[pid].push(item);
        else authHistoryByProfile[pid][existingIdx] = { ...authHistoryByProfile[pid][existingIdx], ...item };
      } else {
        const existingIdx = unprefixedAuthHistory.findIndex(x => (x.username + ':' + x.password) === sig);
        if (existingIdx === -1) unprefixedAuthHistory.push(item);
        else unprefixedAuthHistory[existingIdx] = { ...unprefixedAuthHistory[existingIdx], ...item };
      }
    } catch (_) {}
  };
  const recordEntry = (kStr, vStr) => {
    if (!kStr || typeof vStr !== 'string' || !kStr.startsWith('pelican_')) return;
    const isAuth = kStr.endsWith('__auth_cfg') || kStr === 'pelican_auth_cfg';
    const isSell = kStr.endsWith('__sell_cfg') || kStr === 'pelican_sell_cfg';
    const m = kStr.match(/^pelican_(profile_[a-zA-Z0-9_]+)__/);
    if (m && m[1]) {
      const pid = m[1];
      if (!byProfile[pid]) byProfile[pid] = {};
      if (isAuth) recordAuthHistory(pid, vStr);
      if (isAuth && byProfile[pid][kStr]) {
        byProfile[pid][kStr] = mergeAuthConfigString(byProfile[pid][kStr], vStr);
      } else if (isSell && byProfile[pid][kStr]) {
        byProfile[pid][kStr] = mergeSellConfigString(byProfile[pid][kStr], vStr);
      } else {
        byProfile[pid][kStr] = vStr;
      }
      totalKeys++;
    } else {
      if (isAuth) recordAuthHistory(fallbackProfileId || null, vStr);
      if (isAuth && unprefixed[kStr]) {
        unprefixed[kStr] = mergeAuthConfigString(unprefixed[kStr], vStr);
      } else if (isSell && unprefixed[kStr]) {
        unprefixed[kStr] = mergeSellConfigString(unprefixed[kStr], vStr);
      } else {
        unprefixed[kStr] = vStr;
      }
      if (fallbackProfileId) {
        if (!byProfile[fallbackProfileId]) byProfile[fallbackProfileId] = {};
        if (isAuth && byProfile[fallbackProfileId][kStr]) {
          byProfile[fallbackProfileId][kStr] = mergeAuthConfigString(byProfile[fallbackProfileId][kStr], vStr);
        } else if (isSell && byProfile[fallbackProfileId][kStr]) {
          byProfile[fallbackProfileId][kStr] = mergeSellConfigString(byProfile[fallbackProfileId][kStr], vStr);
        } else {
          byProfile[fallbackProfileId][kStr] = vStr;
        }
      }
      totalKeys++;
    }
  };

  try {
    const files = fs.readdirSync(levelDbDir).filter(f => f.endsWith('.ldb') || f.endsWith('.log')).sort();
    for (const f of files) {
      try {
        const buf = fs.readFileSync(path.join(levelDbDir, f));
        if (f.endsWith('.ldb')) {
          if (buf.length < 48) continue;
          const footer = buf.subarray(buf.length - 48);
          const mhOff = readVarint(footer, 0);
          const mhSz = mhOff ? readVarint(footer, mhOff.next) : null;
          const ihOff = mhSz ? readVarint(footer, mhSz.next) : null;
          const ihSz = ihOff ? readVarint(footer, ihOff.next) : null;
          if (!ihOff || !ihSz || ihOff.val + ihSz.val + 1 > buf.length) continue;
          let idxBlock = buf.subarray(ihOff.val, ihOff.val + ihSz.val);
          if (buf[ihOff.val + ihSz.val] === 1) idxBlock = snappyUncompress(idxBlock) || idxBlock;
          if (!idxBlock || idxBlock.length < 4) continue;
          const idxRestarts = idxBlock.readUInt32LE(idxBlock.length - 4);
          const idxLimit = idxBlock.length - 4 - idxRestarts * 4;
          let pos = 0;
          while (pos < idxLimit) {
            const s = readVarint(idxBlock, pos, idxLimit); if (!s) break;
            const u = readVarint(idxBlock, s.next, idxLimit); if (!u) break;
            const v = readVarint(idxBlock, u.next, idxLimit); if (!v) break;
            pos = v.next;
            if (pos + u.val + v.val > idxLimit) break;
            const hBuf = idxBlock.subarray(pos + u.val, pos + u.val + v.val);
            pos += u.val + v.val;
            const bOff = readVarint(hBuf, 0);
            const bSz = bOff ? readVarint(hBuf, bOff.next) : null;
            if (!bOff || !bSz || bOff.val + bSz.val + 1 > buf.length) continue;
            let dBlock = buf.subarray(bOff.val, bOff.val + bSz.val);
            if (buf[bOff.val + bSz.val] === 1) dBlock = snappyUncompress(dBlock);
            if (!dBlock || dBlock.length < 4) continue;
            const numRestarts = dBlock.readUInt32LE(dBlock.length - 4);
            const dLimit = dBlock.length - 4 - numRestarts * 4;
            let dPos = 0, lastKey = Buffer.alloc(0);
            while (dPos < dLimit) {
              const ds = readVarint(dBlock, dPos, dLimit); if (!ds) break;
              const du = readVarint(dBlock, ds.next, dLimit); if (!du) break;
              const dv = readVarint(dBlock, du.next, dLimit); if (!dv) break;
              dPos = dv.next;
              if (ds.val > lastKey.length || dPos + du.val + dv.val > dLimit) break;
              const key = Buffer.concat([lastKey.subarray(0, ds.val), dBlock.subarray(dPos, dPos + du.val)]);
              const val = dBlock.subarray(dPos + du.val, dPos + du.val + dv.val);
              dPos += du.val + dv.val;
              lastKey = key;
              const kv = decodeLevelDbKeyAndVal(key, val, false);
              if (kv) recordEntry(kv.kStr, kv.vStr);
            }
          }
        } else if (f.endsWith('.log')) {
          const BLOCK_SIZE = 32768;
          let blockOffset = 0;
          let pendingChunks = [];
          const parseBatch = (batch) => {
            if (!batch || batch.length < 12) return;
            let pos = 12;
            while (pos < batch.length) {
              const recType = batch[pos++];
              if (recType === 1) {
                const kLen = readVarint(batch, pos); if (!kLen) break;
                pos = kLen.next;
                if (pos + kLen.val > batch.length) break;
                const key = batch.subarray(pos, pos + kLen.val);
                pos += kLen.val;
                const vLen = readVarint(batch, pos); if (!vLen) break;
                pos = vLen.next;
                if (pos + vLen.val > batch.length) break;
                const val = batch.subarray(pos, pos + vLen.val);
                pos += vLen.val;
                const kv = decodeLevelDbKeyAndVal(key, val, true);
                if (kv) recordEntry(kv.kStr, kv.vStr);
              } else if (recType === 0) {
                const kLen = readVarint(batch, pos); if (!kLen) break;
                pos = kLen.next + kLen.val;
              } else {
                break;
              }
            }
          };
          while (blockOffset < buf.length) {
            const blockEnd = Math.min(buf.length, blockOffset + BLOCK_SIZE);
            let pos = blockOffset;
            while (pos + 7 <= blockEnd) {
              const len = buf[pos + 4] | (buf[pos + 5] << 8);
              const type = buf[pos + 6];
              if (type === 0 || len === 0 || pos + 7 + len > blockEnd) break;
              const chunk = buf.subarray(pos + 7, pos + 7 + len);
              pos += 7 + len;
              if (type === 1) {
                parseBatch(chunk);
                pendingChunks = [];
              } else if (type === 2) {
                pendingChunks = [chunk];
              } else if (type === 3 && pendingChunks.length > 0) {
                pendingChunks.push(chunk);
              } else if (type === 4 && pendingChunks.length > 0) {
                pendingChunks.push(chunk);
                parseBatch(Buffer.concat(pendingChunks));
                pendingChunks = [];
              }
            }
            blockOffset += BLOCK_SIZE;
          }
        }
        try {
          const textAscii = buf.toString('utf8');
          const re = /\{[^{}]{0,400}"username"\s*:\s*"([^"]{1,64})"[^{}]{0,400}"password"\s*:\s*"([^"]{1,64})"[^{}]{0,400}\}/g;
          let m;
          while ((m = re.exec(textAscii)) !== null) {
            recordAuthHistory(fallbackProfileId || null, m[0]);
          }
        } catch (_) {}
      } catch (_) {}
    }
  } catch (_) {}
  return { byProfile, unprefixed, authHistoryByProfile, unprefixedAuthHistory, totalKeys };
}

function createBrowserMode({ rootDir, sessionsDir, getSettings, loadProfiles, preferLocalBot, cdpPort = DEFAULT_CDP_PORT, browserUserDataDir, gameUrl = GAME_URL, profileScriptSource, screenProxy, assetCache }) {
  if(!Number.isInteger(cdpPort)||cdpPort<1024||cdpPort>65535)throw Error('INVALID_CDP_PORT');
  const CDP_PORT = cdpPort;
  const effectiveAssetCache = assetCache || screenProxy?.assetCache || null;
  const isGameUrl=value=>{try{return new URL(value).origin===new URL(gameUrl).origin;}catch(_){return false;}};
  const userDataDir = browserUserDataDir || path.join(sessionsDir, '_browser');
  const storageDir = (sessionsDir && sessionsDir !== 'fake') ? path.join(sessionsDir, '_browser_storage') : null;
  const localBotPath = path.join(rootDir, 'bot.js');
  let browserProc = null;
  let ws = null, wsReady = null, nextId = 1;
  const pending = new Map();            // CDP call id -> {resolve, reject}
  const listeners = new Set();          // CDP event listeners
  const clients = new Map();            // profileId -> { targetId, sessionId, server, port, browserContextId }
  let startupPages = [];                // the empty window Chrome opens on start — closed once a game window exists
  const portServers = new Map();        // port -> proxy server (one per port, even if a client object went stale)
  let rediscovering = null;
  let started = false, reconnectTimer = null, reconnectDelay = 1000, monitorTimer = null;
  const stoppedProfiles = new Set(), knownTargets = new Map(), diagnostics = new Map();
  const knownTargetsFile = (sessionsDir && sessionsDir !== 'fake') ? path.join(sessionsDir, '_browser_targets.json') : null;
  const wsUrlFile = (sessionsDir && sessionsDir !== 'fake') ? path.join(sessionsDir, '_browser_ws.json') : null;
  const isRealSession = Boolean(sessionsDir && sessionsDir !== 'fake');
  const profileDeviceIds = new Map();
  const profileMachineIds = new Map();
  const profileDeviceGroupIndex = new Map();
  const deviceMachineMap = new Map();
  const usedDeviceIds = new Set();
  const usedMachineIds = new Set();
  let deviceIdsInitialized = false;
  let lastGroupedOrderSignature = '';

  // Anti-Clone Hardware Guard: if this folder was copied/cloned to another PC (different MachineGuid),
  // automatically strip the old PC's spoofed Device/Machine IDs and stale browser target files so the cloned PC
  // mints fresh Device/Machine IDs and never collides with the original PC.
  if (storageDir) {
    try {
      let currentHwId = (screenProxy && typeof screenProxy.getMachineHwid === 'function') ? screenProxy.getMachineHwid() : '';
      if (!currentHwId) {
        let rawGuid = '';
        try {
          const { execSync } = require('child_process');
          const regOut = execSync('reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', { encoding: 'utf8', windowsHide: true });
          rawGuid = regOut.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i)?.[1]?.toUpperCase() || '';
        } catch (_) {}
        currentHwId = crypto.createHash('sha256').update('PMhee.MachineFingerprint.v1|' + (rawGuid || require('os').hostname().toUpperCase())).digest('hex').toUpperCase();
      }
      fs.mkdirSync(storageDir, { recursive: true });
      const ownerFile = path.join(storageDir, '_machine_owner.json');
      let savedOwner = null;
      if (fs.existsSync(ownerFile)) {
        try { savedOwner = JSON.parse(fs.readFileSync(ownerFile, 'utf8')); } catch (_) {}
      }
      if (savedOwner && savedOwner.machineHwid && savedOwner.machineHwid !== currentHwId) {
        console.warn('[Anti-Clone Guard] 🛡️ ตรวจพบการคัดลอกโฟลเดอร์แอพมาจากเครื่องอื่น -> รีเซ็ต Device ID / Machine ID ยกชุดสำหรับเครื่องใหม่เพื่อป้องกันการชนกัน!');
        const files = fs.readdirSync(storageDir).filter(f => f.endsWith('.json') && f !== '_machine_owner.json');
        for (const f of files) {
          try {
            const fp = path.join(storageDir, f);
            const obj = JSON.parse(fs.readFileSync(fp, 'utf8'));
            if (obj && typeof obj === 'object') {
              let modified = false;
              for (const k of Object.keys(obj)) {
                if (k === 'aetheria.device' || k === 'aetheria.machine' || k.endsWith('__aetheria_device') || k.endsWith('__aetheria_machine')) {
                  delete obj[k];
                  modified = true;
                }
              }
              if (modified) {
                fs.writeFileSync(fp + '.tmp', JSON.stringify(obj), 'utf8');
                fs.renameSync(fp + '.tmp', fp);
              }
            }
          } catch (_) {}
        }
        try { if (knownTargetsFile && fs.existsSync(knownTargetsFile)) fs.unlinkSync(knownTargetsFile); } catch (_) {}
        try { if (wsUrlFile && fs.existsSync(wsUrlFile)) fs.unlinkSync(wsUrlFile); } catch (_) {}
      }
      if (!savedOwner || savedOwner.machineHwid !== currentHwId) {
        fs.writeFileSync(ownerFile + '.tmp', JSON.stringify({ machineHwid: currentHwId, updatedAt: Date.now() }, null, 2), 'utf8');
        fs.renameSync(ownerFile + '.tmp', ownerFile);
      }
    } catch (_) {}
  }

  function loadProfileStorage(profileId) {
    if (!storageDir || !profileId) return {};
    try {
      const f = path.join(storageDir, `${profileId}.json`);
      if (!fs.existsSync(f)) return {};
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    } catch (_) { return {}; }
  }
  function isTransientStorageKey(k) {
    if (!k || typeof k !== 'string') return false;
    if (k === 'aetheria.device' || k === 'aetheria.machine' || k === 'pelican_icon_manifest' || k === 'pelican_item_catalog' || k === 'pelican_latest_inventory' || k === 'pelican_packet_logs' || k === 'pelican_last_weight' || k === 'pelican_embedded_human_check_cfg' || k.startsWith('webgame.chat.')) return true;
    return k.endsWith('__icon_manifest') || k.endsWith('__item_catalog') || k.endsWith('__latest_inventory') || k.endsWith('__packet_logs') || k.endsWith('__last_weight') || k.endsWith('__embedded_human_check_cfg');
  }
  function extractSessionJwtUserId(jwtStr) {
    if (!jwtStr || typeof jwtStr !== 'string') return '';
    try {
      const parts = jwtStr.split('.');
      if (parts.length < 2) return '';
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return (payload && typeof payload.userId === 'string') ? payload.userId.trim() : '';
    } catch (_) {
      return '';
    }
  }
  function isForeignAuthUsername(profileId, username) {
    const u = String(username || '').trim().toLowerCase();
    if (!u || !profileId || typeof loadProfiles !== 'function') return false;
    try {
      const list = loadProfiles() || [];
      const self = list.find(p => p && p.id === profileId);
      const selfAccount = String(self && self.account || '').trim().toLowerCase();
      if (selfAccount && selfAccount === u) return false;
      return list.some(p => p && p.id !== profileId && String(p.account || '').trim().toLowerCase() === u);
    } catch (_) {
      return false;
    }
  }
  function isForeignOrMismatchedSessionJwt(profileId, jwtStr) {
    const jwtUser = extractSessionJwtUserId(jwtStr);
    if (!jwtUser || !profileId || typeof loadProfiles !== 'function') return false;
    const u = jwtUser.toLowerCase();
    try {
      const list = loadProfiles() || [];
      const self = list.find(p => p && p.id === profileId);
      const selfAccount = String(self && self.account || '').trim().toLowerCase();
      if (selfAccount && selfAccount !== u) return true;
      return list.some(p => p && p.id !== profileId && String(p.account || '').trim().toLowerCase() === u);
    } catch (_) {
      return false;
    }
  }
  function isForeignAuthCfgString(profileId, rawAuthStr) {
    if (!rawAuthStr || typeof rawAuthStr !== 'string') return false;
    try {
      const parsed = JSON.parse(rawAuthStr);
      if (parsed && typeof parsed === 'object' && parsed.username) {
        return isForeignAuthUsername(profileId, parsed.username);
      }
    } catch (_) {}
    return false;
  }
  function saveProfileStorage(profileId, entries) {
    if (!storageDir || !profileId || !entries || typeof entries !== 'object') return;
    try {
      fs.mkdirSync(storageDir, { recursive: true });
      const f = path.join(storageDir, `${profileId}.json`);
      const pfx = `pelican_${profileId}__`;
      const rawExisting = loadProfileStorage(profileId);
      const merged = {};
      for (const [k, v] of Object.entries(rawExisting || {})) {
        if (v === null || v === undefined || isTransientStorageKey(k)) continue;
        if (k === '__ss:aetheria.session' && isForeignOrMismatchedSessionJwt(profileId, v)) continue;
        if (k.startsWith('pelican_')) {
          if (k.startsWith(pfx)) {
            if (k.endsWith('__auth_cfg') && isForeignAuthCfgString(profileId, v)) continue;
            merged[k] = v;
          } else if (!k.includes('__') && k !== 'pelican_auth_cfg' && k !== 'pelican_icon_manifest' && k !== 'pelican_item_catalog' && k !== 'pelican_script_plan' && k !== 'pelican_plan_script_enabled') {
            const mapped = pfx + k.slice(8);
            if (isTransientStorageKey(mapped)) continue;
            if (rawExisting[mapped] === undefined && merged[mapped] === undefined) merged[mapped] = v;
          }
        } else {
          merged[k] = v;
        }
      }
      for (const [k, v] of Object.entries(entries)) {
        if (v === null || v === undefined || isTransientStorageKey(k)) continue;
        if (k === '__ss:aetheria.session' && isForeignOrMismatchedSessionJwt(profileId, v)) continue;
        let targetKey = k;
        if (k.startsWith('pelican_')) {
          if (k.startsWith(pfx)) {
            targetKey = k;
          } else if (!k.includes('__')) {
            if (k === 'pelican_auth_cfg' || k === 'pelican_icon_manifest' || k === 'pelican_item_catalog' || k === 'pelican_script_plan' || k === 'pelican_plan_script_enabled') continue;
            const mapped = pfx + k.slice(8);
            if (isTransientStorageKey(mapped)) continue;
            if (entries[mapped] !== undefined || merged[mapped] !== undefined) continue;
            targetKey = mapped;
          } else {
            continue;
          }
        }
        if (targetKey.endsWith('__auth_cfg') && isForeignAuthCfgString(profileId, v)) continue;
        if (targetKey.endsWith('__auth_cfg') && merged[targetKey]) {
          merged[targetKey] = mergeAuthConfigString(merged[targetKey], v);
        } else if ((targetKey.endsWith('__sell_cfg') || targetKey === 'pelican_sell_cfg') && merged[targetKey]) {
          merged[targetKey] = mergeSellConfigString(merged[targetKey], v);
        } else {
          merged[targetKey] = v;
        }
      }
      const devKey = `pelican_${profileId}__aetheria_device`;
      const incomingDev = typeof entries[devKey] === 'string' ? entries[devKey].trim() : '';
      if (profileDeviceIds.has(profileId)) {
        merged[devKey] = profileDeviceIds.get(profileId);
      } else if (UUID_V4_RE.test(incomingDev)) {
        profileDeviceIds.set(profileId, incomingDev);
        usedDeviceIds.add(incomingDev.toLowerCase());
        merged[devKey] = incomingDev;
      }
      const machKey = `pelican_${profileId}__aetheria_machine`;
      const incomingMach = typeof entries[machKey] === 'string' ? entries[machKey].trim().toLowerCase() : '';
      if (profileMachineIds.has(profileId)) {
        merged[machKey] = profileMachineIds.get(profileId);
      } else if (SHA256_HEX_RE.test(incomingMach)) {
        profileMachineIds.set(profileId, incomingMach);
        usedMachineIds.add(incomingMach);
        merged[machKey] = incomingMach;
      }
      fs.writeFileSync(f + '.tmp', JSON.stringify(merged), 'utf8');
      fs.renameSync(f + '.tmp', f);
    } catch (_) {}
  }

  function mintUniqueDeviceId() {
    let cand = '';
    do {
      cand = crypto.randomUUID();
    } while (usedDeviceIds.has(cand.toLowerCase()));
    usedDeviceIds.add(cand.toLowerCase());
    return cand;
  }

  function mintUniqueMachineId(seed) {
    let cand = deriveMachineId(seed || crypto.randomUUID());
    while (usedMachineIds.has(cand)) {
      cand = deriveMachineId(crypto.randomUUID() + ':' + Date.now());
    }
    usedMachineIds.add(cand);
    return cand;
  }

  function getOrMintMachineIdForDevice(deviceId, preferredMach) {
    const devLower = String(deviceId || '').trim().toLowerCase();
    if (devLower && deviceMachineMap.has(devLower)) {
      return deviceMachineMap.get(devLower);
    }
    const pref = typeof preferredMach === 'string' ? preferredMach.trim().toLowerCase() : '';
    let mach = '';
    if (SHA256_HEX_RE.test(pref) && !usedMachineIds.has(pref)) {
      mach = pref;
      usedMachineIds.add(mach);
    } else {
      mach = mintUniqueMachineId('device-group:' + (devLower || crypto.randomUUID()));
    }
    if (devLower) {
      deviceMachineMap.set(devLower, mach);
    }
    return mach;
  }

  let orderedProfileIdsCache = null;
  let orderedProfileIdsCacheAt = 0;
  function getOrderedProfileIds(extraProfileId) {
    const now = Date.now();
    if (!extraProfileId && orderedProfileIdsCache && (now - orderedProfileIdsCacheAt < 5000)) {
      return orderedProfileIdsCache;
    }
    const seen = new Set();
    const ordered = [];
    const addId = (pid) => {
      const id = typeof pid === 'string' ? pid.trim() : '';
      if (!id || seen.has(id)) return;
      seen.add(id);
      ordered.push(id);
    };
    try {
      if (typeof loadProfiles === 'function') {
        const list = loadProfiles() || [];
        for (const p of list) {
          if (p && p.id) addId(p.id);
        }
      }
    } catch (_) {}
    try {
      if (storageDir && fs.existsSync(storageDir)) {
        const files = fs.readdirSync(storageDir)
          .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
          .map(f => f.slice(0, -5))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        for (const pid of files) addId(pid);
      }
    } catch (_) {}
    for (const pid of profileDeviceIds.keys()) addId(pid);
    if (!extraProfileId) {
      orderedProfileIdsCache = ordered;
      orderedProfileIdsCacheAt = now;
      return ordered;
    }
    addId(extraProfileId);
    return ordered;
  }

  function getScreensPerIp() {
    try {
      const s = screenProxy && typeof screenProxy.loadSettings === 'function' ? screenProxy.loadSettings() : null;
      const n = Number(s && s.maxScreensPerIp);
      if (Number.isFinite(n) && n >= 1) {
        return Math.max(1, Math.min(20, Math.floor(n)));
      }
    } catch (_) {}
    return MAX_SCREENS_PER_DEVICE;
  }

  function buildDeviceGroupLayout(orderedIds, screensPerIp) {
    const list = Array.isArray(orderedIds) ? orderedIds : [];
    const perIp = Math.max(1, Math.min(20, Number(screensPerIp) || getScreensPerIp() || MAX_SCREENS_PER_DEVICE));
    const devicesPerIp = Math.ceil(perIp / MAX_SCREENS_PER_DEVICE);
    const deviceSubSizes = [];
    for (let sub = 0; sub < devicesPerIp; sub++) {
      deviceSubSizes.push(Math.min(MAX_SCREENS_PER_DEVICE, Math.max(1, perIp - sub * MAX_SCREENS_PER_DEVICE)));
    }

    const totalIpBlocks = Math.ceil(list.length / perIp);
    const layout = [];
    let globalGroupIdx = 0;

    for (let ipIdx = 0; ipIdx < totalIpBlocks; ipIdx++) {
      const ipSlice = list.slice(ipIdx * perIp, (ipIdx + 1) * perIp);
      for (let sub = 0; sub < devicesPerIp; sub++) {
        const subStart = sub * MAX_SCREENS_PER_DEVICE;
        const subEnd = Math.min(perIp, (sub + 1) * MAX_SCREENS_PER_DEVICE);
        const groupPids = ipSlice.slice(subStart, subEnd);
        if (groupPids.length === 0) break;
        globalGroupIdx++;
        const subMax = Math.min(MAX_SCREENS_PER_DEVICE, Math.max(1, perIp - subStart));
        layout.push({
          groupIndex: globalGroupIdx,
          ipIndex: ipIdx + 1,
          deviceIndexInIp: sub + 1,
          devicesPerIp,
          screensPerIp: perIp,
          deviceSubSizes,
          maxScreens: subMax,
          maxScreensPerDevice: MAX_SCREENS_PER_DEVICE,
          ipSlotStart: subStart + 1,
          ipProfileIds: ipSlice,
          profileIds: groupPids
        });
      }
    }
    return layout;
  }

  function rebalanceDeviceGroups(extraProfileId, forceRecheck = false) {
    try {
      const orderedIds = getOrderedProfileIds(extraProfileId);
      const perIp = getScreensPerIp();
      const sig = `${perIp}::${orderedIds.join('|')}`;
      if (!forceRecheck && deviceIdsInitialized && sig === lastGroupedOrderSignature && (!extraProfileId || profileDeviceIds.has(extraProfileId))) {
        return;
      }
      deviceIdsInitialized = true;
      lastGroupedOrderSignature = sig;

      const rawByProfile = new Map();
      for (const pid of orderedIds) {
        const data = loadProfileStorage(pid);
        rawByProfile.set(pid, data);
        if (typeof data['aetheria.device'] === 'string' && data['aetheria.device'].trim()) {
          usedDeviceIds.add(data['aetheria.device'].trim().toLowerCase());
        }
      }

      const claimedDevices = new Set();
      const layout = buildDeviceGroupLayout(orderedIds, perIp);

      for (const grp of layout) {
        const groupPids = grp.profileIds;
        let groupDev = '';
        let candidateMach = '';

        for (const pid of groupPids) {
          const memDev = profileDeviceIds.get(pid) || '';
          const diskData = rawByProfile.get(pid) || {};
          const diskDev = typeof diskData[`pelican_${pid}__aetheria_device`] === 'string'
            ? diskData[`pelican_${pid}__aetheria_device`].trim()
            : '';
          const cand = UUID_V4_RE.test(memDev) ? memDev : (UUID_V4_RE.test(diskDev) ? diskDev : '');
          if (cand && !claimedDevices.has(cand.toLowerCase())) {
            groupDev = cand;
            break;
          }
        }

        for (const pid of groupPids) {
          const memMach = profileMachineIds.get(pid) || '';
          const diskData = rawByProfile.get(pid) || {};
          const diskMach = typeof diskData[`pelican_${pid}__aetheria_machine`] === 'string'
            ? diskData[`pelican_${pid}__aetheria_machine`].trim().toLowerCase()
            : '';
          const candM = SHA256_HEX_RE.test(memMach) ? memMach : (SHA256_HEX_RE.test(diskMach) ? diskMach : '');
          if (candM) {
            candidateMach = candM;
            break;
          }
        }

        if (!groupDev) {
          groupDev = mintUniqueDeviceId();
        } else {
          usedDeviceIds.add(groupDev.toLowerCase());
        }
        claimedDevices.add(groupDev.toLowerCase());

        const groupMach = getOrMintMachineIdForDevice(groupDev, candidateMach);

        for (const pid of groupPids) {
          const prevMemDev = profileDeviceIds.get(pid) || '';
          const prevMemMach = profileMachineIds.get(pid) || '';
          const devKey = `pelican_${pid}__aetheria_device`;
          const machKey = `pelican_${pid}__aetheria_machine`;
          const diskData = rawByProfile.get(pid) || {};
          const diskDev = typeof diskData[devKey] === 'string' ? diskData[devKey].trim() : '';
          const diskMach = typeof diskData[machKey] === 'string' ? diskData[machKey].trim().toLowerCase() : '';
          const hasLegacyRaw = Object.prototype.hasOwnProperty.call(diskData, 'aetheria.device') || Object.prototype.hasOwnProperty.call(diskData, 'aetheria.machine');

          profileDeviceIds.set(pid, groupDev);
          profileMachineIds.set(pid, groupMach);
          profileDeviceGroupIndex.set(pid, grp.groupIndex);

          if (diskDev !== groupDev || diskMach !== groupMach || hasLegacyRaw) {
            saveProfileStorage(pid, { [devKey]: groupDev, [machKey]: groupMach });
          }

          if (prevMemDev && (prevMemDev !== groupDev || prevMemMach !== groupMach)) {
            const c = clients.get(pid);
            if (c && c.sessionId) {
              ensureSessionHooks(c.sessionId, pid, c).catch(() => {});
              evaluate(c, profileInitScript(pid), 4500).catch(() => {});
            }
          }
        }
      }
    } catch (_) {}
  }

  function initDeviceIdsFromStorage() {
    if (deviceIdsInitialized) return;
    rebalanceDeviceGroups(null, true);
  }

  function ensureProfileDeviceId(profileId) {
    initDeviceIdsFromStorage();
    if (!profileId) return mintUniqueDeviceId();
    rebalanceDeviceGroups(profileId, false);
    if (profileDeviceIds.has(profileId)) return profileDeviceIds.get(profileId);
    rebalanceDeviceGroups(profileId, true);
    return profileDeviceIds.get(profileId) || mintUniqueDeviceId();
  }

  function ensureProfileMachineId(profileId) {
    const devId = ensureProfileDeviceId(profileId);
    if (!profileId) return mintUniqueMachineId();
    if (profileMachineIds.has(profileId)) return profileMachineIds.get(profileId);
    const assignedMach = getOrMintMachineIdForDevice(devId);
    profileMachineIds.set(profileId, assignedMach);
    saveProfileStorage(profileId, { [`pelican_${profileId}__aetheria_machine`]: assignedMach });
    return assignedMach;
  }

  function ensureProfileDeviceGroupIndex(profileId) {
    ensureProfileDeviceId(profileId);
    return profileDeviceGroupIndex.get(profileId) || 1;
  }

  function getDeviceGroupsSnapshot() {
    initDeviceIdsFromStorage();
    rebalanceDeviceGroups(null, false);
    const orderedIds = getOrderedProfileIds();
    const perIp = getScreensPerIp();
    const layout = buildDeviceGroupLayout(orderedIds, perIp);
    let poolItems = [];
    try {
      if (screenProxy && typeof screenProxy.loadPool === 'function') {
        const p = screenProxy.loadPool();
        if (p && Array.isArray(p.proxies)) {
          poolItems = p.proxies.filter(x => x && x.enabled !== false);
        }
      }
    } catch (_) {}

    return layout.map(grp => {
      const firstPid = grp.profileIds[0];
      const deviceId = firstPid ? ensureProfileDeviceId(firstPid) : '';
      const machineId = firstPid ? ensureProfileMachineId(firstPid) : '';
      const poolItem = poolItems[grp.ipIndex - 1] || null;
      return {
        groupIndex: grp.groupIndex,
        ipIndex: grp.ipIndex,
        deviceIndexInIp: grp.deviceIndexInIp,
        devicesPerIp: grp.devicesPerIp,
        screensPerIp: grp.screensPerIp,
        deviceSubSizes: grp.deviceSubSizes,
        ipSlotStart: grp.ipSlotStart,
        ipProfileIds: grp.ipProfileIds,
        proxyIp: poolItem ? (poolItem.labelIp || poolItem.host || null) : null,
        proxyPort: poolItem ? (poolItem.port || null) : null,
        deviceId,
        machineId,
        maxScreens: grp.maxScreens,
        maxScreensPerDevice: grp.maxScreensPerDevice,
        profileIds: grp.profileIds
      };
    });
  }

  async function rotateDeviceGroup(target) {
    initDeviceIdsFromStorage();
    rebalanceDeviceGroups(null, false);
    const orderedIds = getOrderedProfileIds();
    if (orderedIds.length === 0) return null;
    const perIp = getScreensPerIp();
    const layout = buildDeviceGroupLayout(orderedIds, perIp);
    if (layout.length === 0) return null;

    let targetGrp = null;
    if (typeof target === 'number' && Number.isFinite(target) && target >= 1) {
      targetGrp = layout[Math.floor(target) - 1] || null;
    } else if (typeof target === 'string' && target.trim()) {
      const t = target.trim();
      if (/^\d+$/.test(t)) {
        targetGrp = layout[Math.max(0, parseInt(t, 10) - 1)] || null;
      } else {
        targetGrp = layout.find(g => g.profileIds.includes(t)) || null;
        if (!targetGrp) {
          targetGrp = layout.find(g => g.profileIds.some(pid => (profileDeviceIds.get(pid) || '').toLowerCase() === t.toLowerCase())) || null;
        }
      }
    }

    if (!targetGrp) return null;

    const groupPids = targetGrp.profileIds;
    const assigned = mintUniqueDeviceId();
    const assignedMach = mintUniqueMachineId('device-group:' + assigned.toLowerCase() + ':' + Date.now());
    deviceMachineMap.set(assigned.toLowerCase(), assignedMach);

    for (const pid of groupPids) {
      const devKey = `pelican_${pid}__aetheria_device`;
      const machKey = `pelican_${pid}__aetheria_machine`;
      profileDeviceIds.set(pid, assigned);
      profileMachineIds.set(pid, assignedMach);
      profileDeviceGroupIndex.set(pid, targetGrp.groupIndex);
      saveProfileStorage(pid, { [devKey]: assigned, [machKey]: assignedMach });
      const c = clients.get(pid);
      if (c && c.sessionId) {
        await ensureSessionHooks(c.sessionId, pid, c).catch(() => {});
        await evaluate(c, profileInitScript(pid), 4500).catch(() => {});
      }
    }

    return {
      groupIndex: targetGrp.groupIndex,
      ipIndex: targetGrp.ipIndex,
      deviceIndexInIp: targetGrp.deviceIndexInIp,
      devicesPerIp: targetGrp.devicesPerIp,
      screensPerIp: targetGrp.screensPerIp,
      deviceSubSizes: targetGrp.deviceSubSizes,
      ipSlotStart: targetGrp.ipSlotStart,
      ipProfileIds: targetGrp.ipProfileIds,
      deviceId: assigned,
      machineId: assignedMach,
      maxScreens: targetGrp.maxScreens,
      maxScreensPerDevice: targetGrp.maxScreensPerDevice,
      profileIds: groupPids
    };
  }

  async function rotateProfileDeviceId(profileId) {
    initDeviceIdsFromStorage();
    if (!profileId) return null;
    rebalanceDeviceGroups(profileId, false);
    const res = await rotateDeviceGroup(profileId);
    return res ? res.deviceId : null;
  }

  async function rotateAllDeviceIds() {
    initDeviceIdsFromStorage();
    rebalanceDeviceGroups(null, false);
    const orderedIds = getOrderedProfileIds();
    const layout = buildDeviceGroupLayout(orderedIds, getScreensPerIp());
    const rotatedByProfile = {};
    const groups = [];
    for (let g = 1; g <= layout.length; g++) {
      const grp = await rotateDeviceGroup(g);
      if (grp) {
        groups.push(grp);
        for (const pid of grp.profileIds) {
          rotatedByProfile[pid] = grp.deviceId;
        }
      }
    }
    return { deviceIds: rotatedByProfile, groups };
  }

  function loadKnownTargets() {
    if (!knownTargetsFile) return;
    try {
      if (!fs.existsSync(knownTargetsFile)) return;
      const raw = JSON.parse(fs.readFileSync(knownTargetsFile, 'utf8'));
      if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) if (typeof k === 'string' && typeof v === 'string') knownTargets.set(k, v);
      }
    } catch (_) {}
  }
  function saveKnownTargets() {
    if (!knownTargetsFile) return;
    try {
      if (!fs.existsSync(sessionsDir)) return;
      fs.writeFileSync(knownTargetsFile, JSON.stringify(Object.fromEntries(knownTargets), null, 2), 'utf8');
    } catch (_) {}
  }
  loadKnownTargets();
  const retryDelays = [1000, 3000, 10000];
  function scheduleReconnect() {
    if(!started || reconnectTimer) return;
    reconnectTimer=setTimeout(async()=>{reconnectTimer=null;try{await rediscover();reconnectDelay=1000;}catch(_){reconnectDelay=Math.min(30000,reconnectDelay*2);scheduleReconnect();}},reconnectDelay);
    reconnectTimer.unref?.();
  }
  function diagnostic(c, state, extra={}) { diagnostics.set(c.profileId,{gameAlive:state!=='closed',botReady:state==='ready',state,...extra}); }

  // A window that is gone (closed with Chrome's X, crashed, browser closed, CDP reconnected) must not stay
  // "open": that made launch answer "already open" and left a proxy with a dead session on the port.
  function drop(c) {
    if (!c) return;
    stopProxy(c);
    if (clients.get(c.profileId) === c) clients.delete(c.profileId);
    c.generation++;clearTimeout(c.retryTimer);c.retryTimer=null;
  }
  const isGoneError = e => /Session with given id not found|No target with given id|Target closed|CDP closed|CDP not connected/i.test(String(e && e.message || e));

  // ---------- CDP connection ----------
  function openCdpSocket(debuggerUrl, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(debuggerUrl); ws = socket;
      const openingTimeout = setTimeout(() => { reject(new Error('CDP connect timeout')); try { socket.close(); } catch (_) {} }, timeoutMs);
      openingTimeout.unref?.();
      socket.onopen = () => { clearTimeout(openingTimeout); resolve(); };
      socket.onerror = () => { clearTimeout(openingTimeout); reject(new Error('CDP connect failed')); };
      socket.onclose = () => {
        clearTimeout(openingTimeout); reject(new Error('CDP closed'));
        if (ws !== socket) return; ws = null;
        for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error('CDP closed')); } pending.clear();
        for (const c of Array.from(clients.values())) { diagnostic(c, 'transport-disconnected', { gameAlive: null }); drop(c); } scheduleReconnect();
      };
      socket.onmessage = ev => {
        if (ws !== socket) return;
        let msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
        if (msg.id && pending.has(msg.id)) {
          const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
        } else if (msg.method) {
          listeners.forEach(fn => { try { fn(msg); } catch (e) {} });
        }
      };
    });
  }
  async function connect() {
    if (ws && ws.readyState === 1) return;
    if (wsReady) return wsReady;
    wsReady = (async () => {
      let connectedViaCache = false;
      if (wsUrlFile) {
        try {
          if (fs.existsSync(wsUrlFile)) {
            const cached = JSON.parse(fs.readFileSync(wsUrlFile, 'utf8'));
            if (cached && typeof cached.webSocketDebuggerUrl === 'string' && cached.webSocketDebuggerUrl.startsWith('ws://')) {
              await openCdpSocket(cached.webSocketDebuggerUrl, 12000);
              connectedViaCache = true;
            }
          }
        } catch (_) {
          if (ws) { try { ws.close(); } catch (__) {} ws = null; }
        }
      }
      if (!connectedViaCache) {
        const info = JSON.parse(await getText(`http://127.0.0.1:${CDP_PORT}/json/version`, isRealSession ? 20000 : 6000));
        if (wsUrlFile && info && typeof info.webSocketDebuggerUrl === 'string') {
          try { fs.writeFileSync(wsUrlFile, JSON.stringify({ webSocketDebuggerUrl: info.webSocketDebuggerUrl }), 'utf8'); } catch (_) {}
        }
        await openCdpSocket(info.webSocketDebuggerUrl, isRealSession ? 12000 : 8000);
      }
    })();
    try { await wsReady; } finally { wsReady = null; }
    await send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
  }
  function send(method, params = {}, sessionId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== 1) return reject(new Error('CDP not connected'));
      const id = nextId++;
      const timer=setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)); } }, timeoutMs);timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      try{ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));}
      catch(e){clearTimeout(timer);pending.delete(id);reject(e);}
    });
  }

  async function browserAlive() {
    if (ws && ws.readyState === 1) return true;
    if (wsUrlFile && fs.existsSync(wsUrlFile)) {
      try { await connect(); return Boolean(ws && ws.readyState === 1); } catch (_) {}
    }
    try { await getText(`http://127.0.0.1:${CDP_PORT}/json/version`, isRealSession ? 15000 : 6000); return true; } catch (e) { return false; }
  }

  function killStuckBrowserProcesses() {
    if (!sessionsDir || sessionsDir === 'fake' || typeof execFile !== 'function') return Promise.resolve();
    return new Promise((resolve) => {
      const escapedDir = String(userDataDir || '').replace(/'/g, "''");
      const portFlag = `--remote-debugging-port=${CDP_PORT}`;
      const psCmd = `
        $dir = '${escapedDir}';
        $portFlag = '${portFlag}';
        Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' OR Name = 'msedge.exe'" -ErrorAction SilentlyContinue | Where-Object {
          $_.CommandLine -and ($_.CommandLine.IndexOf($dir, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or $_.CommandLine.IndexOf($portFlag, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
        } | ForEach-Object {
          Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
      `;
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCmd], { timeout: 6000, windowsHide: true }, () => {
        for (const lockName of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile']) {
          try {
            const lp = path.join(userDataDir, lockName);
            if (fs.existsSync(lp)) fs.unlinkSync(lp);
          } catch (_) {}
        }
        setTimeout(resolve, 400);
      });
    });
  }

  let ensureBrowserPromise = null;
  function ensureBrowser(forceClean = false) {
    if (!ensureBrowserPromise) {
      ensureBrowserPromise = ensureBrowserOnce(forceClean).finally(() => {
        ensureBrowserPromise = null;
      });
    }
    return ensureBrowserPromise;
  }

  async function ensureBrowserOnce(forceClean = false) {
    if (!forceClean && await browserAlive()) {
      try {
        await connect();
        await send('Target.getTargets', {}, undefined, 4000);
        return;
      } catch (e) {
        if (ws) { try { ws.close(); } catch (_) {} ws = null; }
        if (clients.size > 0) throw e;
        forceClean = true;
      }
    }
    if (forceClean && clients.size === 0) {
      await killStuckBrowserProcesses();
    }
    const settings = getSettings() || {};
    const exe = findBrowser(settings.browserKind);
    if (!exe) throw new Error('ไม่พบ Google Chrome หรือ Microsoft Edge ในเครื่อง');
    fs.mkdirSync(userDataDir, { recursive: true });
    const args = [
      `--remote-debugging-port=${CDP_PORT}`, '--remote-allow-origins=*',
      `--user-data-dir=${userDataDir}`,
      '--disable-background-mode',
      '--disable-renderer-accessibility',
      '--disable-platform-accessibility-integration',
      // the bot's timers must keep running in background / covered windows
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
      // many game windows in one browser: Chrome drops the oldest WebGL context past 16 live ones
      '--max-active-webgl-contexts=64',
      '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank'
    ];
    browserProc = spawn(exe, args, { detached: true, stdio: 'ignore' });
    browserProc.unref();
    let cleanedMidWait = forceClean;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 300));
      if (await browserAlive()) {
        try {
          await connect();
          const tRes = await send('Target.getTargets', {}, undefined, 4000);
          startupPages = (tRes?.targetInfos || []).filter(t => t.type === 'page').map(t => t.targetId);
          return;
        } catch (e) {
          if (ws) { try { ws.close(); } catch (_) {} ws = null; }
        }
      }
      if (i === 10 && !cleanedMidWait && clients.size === 0) {
        cleanedMidWait = true;
        await killStuckBrowserProcesses();
        browserProc = spawn(exe, args, { detached: true, stdio: 'ignore' });
        browserProc.unref();
      }
    }
    throw new Error('เปิดเบราว์เซอร์ไม่สำเร็จ');
  }

  // ---------- bot injection ----------
  async function botSource(profileId) {
    const selected=profileScriptSource?.(profileId);
    if(typeof selected==='string')return selected;
    if(profileScriptSource) throw Error('MANAGED_SCRIPT_SOURCE_UNAVAILABLE');
    if (preferLocalBot) return fs.readFileSync(localBotPath, 'utf8');
    try {
      const code = await getText(BOT_URL + '?t=' + Date.now(), 8000);
      if (code.length > 1000) return code;
    } catch (e) {}
    return fs.readFileSync(localBotPath, 'utf8');
  }
  const MSGPACK = `(function(){ if (!window.msgpack && !window.__pmMsgpackLoading) { window.__pmMsgpackLoading=true; const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/msgpack-lite/0.1.26/msgpack.min.js'; s.onerror=()=>{window.__pmMsgpackLoading=false;}; document.head.appendChild(s); } })(); void 0;`;

  const crashedTargetReloadAt = new Map();
  const crashedTargetFailCount = new Map();
  const profileInitScript = profileId => {
    const deviceId = ensureProfileDeviceId(profileId);
    const machineId = ensureProfileMachineId(profileId);
    const rawSaved = loadProfileStorage(profileId);
    const saved = {};
    const pfx = profileId ? `pelican_${profileId}__` : 'pelican_';
    for (const [k, v] of Object.entries(rawSaved || {})) {
      if (typeof v !== 'string' || isTransientStorageKey(k)) continue;
      if (profileId && k === '__ss:aetheria.session' && isForeignOrMismatchedSessionJwt(profileId, v)) continue;
      if (profileId && k.startsWith('pelican_')) {
        if (k.startsWith(pfx)) {
          if (k.endsWith('__auth_cfg') && isForeignAuthCfgString(profileId, v)) continue;
          saved[k] = v;
        } else if (!k.includes('__') && k !== 'pelican_auth_cfg' && k !== 'pelican_icon_manifest' && k !== 'pelican_item_catalog') {
          const mappedKey = pfx + k.slice(8);
          if (isTransientStorageKey(mappedKey)) continue;
          if (rawSaved[mappedKey] === undefined && saved[mappedKey] === undefined) saved[mappedKey] = v;
        }
      } else {
        saved[k] = v;
      }
    }
    if (profileId && deviceId) {
      saved[`pelican_${profileId}__aetheria_device`] = deviceId;
    }
    if (profileId && machineId) {
      saved[`pelican_${profileId}__aetheria_machine`] = machineId;
    }
    const orderedSaved = {};
    const isPriorityStorageKey = k => k.endsWith('_cfg') || k.endsWith('_config') || k.endsWith('__script_plan') || k.endsWith('__plan_script_enabled') || k.endsWith('__auto_loop') || k.endsWith('__farm_map') || k.endsWith('__target_map') || k.endsWith('__aetheria_device') || k.endsWith('__aetheria_machine') || k.startsWith('__ss:');
    for (const [k, v] of Object.entries(saved)) {
      if (isPriorityStorageKey(k)) orderedSaved[k] = v;
    }
    for (const [k, v] of Object.entries(saved)) {
      if (!Object.prototype.hasOwnProperty.call(orderedSaved, k)) orderedSaved[k] = v;
    }
    const hasSaved = Object.keys(orderedSaved).length > 0;
    const restoreJs = hasSaved
      ? `try { const __s = ${JSON.stringify(orderedSaved)}; const __rawGet = (window.__pmRawStorage && window.__pmRawStorage.get) || Storage.prototype.getItem; const __rawSet = (window.__pmRawStorage && window.__pmRawStorage.set) || Storage.prototype.setItem; const __rawDel = (window.__pmRawStorage && window.__pmRawStorage.del) || Storage.prototype.removeItem; if (window.localStorage && window.__pmProfileId && __rawGet.call(window.localStorage, 'pelican_auth_cfg') !== null) { const __rm = []; for (let i = 0; i < window.localStorage.length; i++) { const lk = window.localStorage.key(i); if (lk && lk.startsWith('pelican_') && lk.indexOf('__') === -1 && lk !== 'pelican_icon_manifest' && lk !== 'pelican_item_catalog') __rm.push(lk); } for (const lk of __rm) { try { __rawDel.call(window.localStorage, lk); } catch (_) {} } } for (const [k, v] of Object.entries(__s)) { if (typeof v !== 'string' || k === 'aetheria.device' || k === 'aetheria.machine') continue; if (k.startsWith('__ss:')) { const sk = k.slice(5); if (window.sessionStorage && __rawGet.call(window.sessionStorage, sk) === null) { try { __rawSet.call(window.sessionStorage, sk, v); } catch (_) {} } } else if (window.localStorage) { const curV = __rawGet.call(window.localStorage, k); const isClobberedSell = (k.endsWith('__sell_cfg') || k === 'pelican_sell_cfg') && curV !== null && curV.indexOf('"weaponRarity"') === -1 && v.indexOf('"weaponRarity"') !== -1; if (k.endsWith('__aetheria_device') || k.endsWith('__aetheria_machine') || curV === null || isClobberedSell) { try { __rawSet.call(window.localStorage, k, v); } catch (_) { if (typeof __freeStorageQuota === 'function') __freeStorageQuota(window.localStorage, __rawDel); try { __rawSet.call(window.localStorage, k, v); } catch (__) {} } } } } window.__pmStorageRestored = true; if (typeof window.reloadBotConfigsFromLocalStorage === 'function') { try { window.reloadBotConfigsFromLocalStorage(); } catch (_) {} } } catch (_) { window.__pmStorageRestored = true; }`
      : `window.__pmStorageRestored = true;`;
    // IMPORTANT: Do NOT use regex literals (/.../) inside this template string, because \/ unescapes to / and // becomes a JS line comment!
    const deviceHookJs = `try {
      const __isTransientStorageKey = function(k) {
        if (!k || typeof k !== 'string') return false;
        if (k === 'aetheria.device' || k === 'aetheria.machine' || k === 'pelican_icon_manifest' || k === 'pelican_item_catalog' || k === 'pelican_latest_inventory' || k === 'pelican_packet_logs' || k === 'pelican_last_weight' || k === 'pelican_embedded_human_check_cfg' || k.startsWith('webgame.chat.')) return true;
        return k.endsWith('__icon_manifest') || k.endsWith('__item_catalog') || k.endsWith('__latest_inventory') || k.endsWith('__packet_logs') || k.endsWith('__last_weight') || k.endsWith('__embedded_human_check_cfg') || (k.indexOf('__gear_bought_') !== -1 && k.endsWith('_pending'));
      };
      const __freeStorageQuota = function(ls, rawDel) {
        try {
          if (!ls || !rawDel) return;
          const keys = [];
          for (let i = 0; i < ls.length; i++) {
            const k = ls.key(i);
            if (k) keys.push(k);
          }
          for (const k of keys) {
            if (__isTransientStorageKey(k)) {
              try { rawDel.call(ls, k); } catch (_) {}
            }
          }
        } catch (_) {}
      };
      const __mintUuid = function() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        const tpl = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
        let out = '';
        for (let i = 0; i < tpl.length; i++) {
          const c = tpl[i];
          if (c === 'x' || c === 'y') {
            const r = (Math.random() * 16) | 0;
            out += (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
          } else {
            out += c;
          }
        }
        return out;
      };
      const __mintMachineId = function() {
        try {
          if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
            const bytes = new Uint8Array(32);
            crypto.getRandomValues(bytes);
            let hex = '';
            for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
            return hex;
          }
        } catch (_) {}
        let hex = '';
        for (let i = 0; i < 64; i++) hex += ((Math.random() * 16) | 0).toString(16);
        return hex;
      };
      const __hexToBytes = function(hex) {
        const arr = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
          arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
        }
        return arr.buffer;
      };
      if (!window.__pmMachineId || typeof window.__pmMachineId !== 'string' || window.__pmMachineId.length !== 64) {
        window.__pmMachineId = __mintMachineId();
      }
      try {
        if (typeof navigator !== 'undefined' && navigator.webdriver) {
          Object.defineProperty(Object.getPrototypeOf(navigator), 'webdriver', { get: function() { return false; }, configurable: true });
        }
      } catch (_) {}
      if (!window.__pmConsoleDebugHookInstalled && typeof console !== 'undefined' && typeof console.debug === 'function') {
        window.__pmConsoleDebugHookInstalled = true;
        const __origConsoleDebug = console.debug.bind(console);
        console.debug = function() {
          try {
            for (let i = 0; i < arguments.length; i++) {
              const arg = arguments[i];
              if (arg && (arg instanceof Error || typeof arg === 'object')) {
                const desc = Object.getOwnPropertyDescriptor(arg, 'stack');
                if (desc && typeof desc.get === 'function') return;
              }
            }
          } catch (_) {}
          return __origConsoleDebug.apply(console, arguments);
        };
      }
      if (!window.__pmSubtleDigestHookInstalled && typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
        window.__pmSubtleDigestHookInstalled = true;
        const __origDigest = crypto.subtle.digest.bind(crypto.subtle);
        crypto.subtle.digest = function(algo, data) {
          try {
            const algoName = typeof algo === 'string' ? algo : (algo && algo.name ? String(algo.name) : '');
            if (algoName.toUpperCase() === 'SHA-256' && data && typeof TextDecoder !== 'undefined') {
              const txt = new TextDecoder().decode(data);
              if (txt && txt.split('|').length === 7 && (txt.endsWith('|win') || txt.endsWith('|mac') || txt.endsWith('|linux') || txt.endsWith('|android') || txt.endsWith('|ios') || txt.endsWith('|other'))) {
                const mach = (window.__pmMachineId && window.__pmMachineId.length === 64) ? window.__pmMachineId : (window.__pmMachineId = __mintMachineId());
                return Promise.resolve(__hexToBytes(mach));
              }
            }
          } catch (_) {}
          return __origDigest(algo, data);
        };
      }
      if (!window.__pmDeviceIdHookInstalled) {
        window.__pmDeviceIdHookInstalled = true;
        const __sp = Storage.prototype;
        const __rawGet = __sp.getItem;
        const __rawSet = __sp.setItem;
        const __rawDel = __sp.removeItem;
        window.__pmRawStorage = { get: __rawGet, set: __rawSet, del: __rawDel };
        const __getPid = function() {
          if (window.__pmProfileId) return window.__pmProfileId;
          try {
            const s = window.sessionStorage && __rawGet.call(window.sessionStorage, '__pmProfileId');
            if (s) {
              window.__pmProfileId = s;
              return s;
            }
          } catch (_) {}
          return null;
        };
        const __mapKey = function(st, k) {
          const pid = __getPid();
          if (st !== window.localStorage || !pid || typeof k !== 'string') return k;
          const pfx = 'pelican_' + pid + '__';
          if (k === 'aetheria.device') return pfx + 'aetheria_device';
          if (k === 'aetheria.machine') return pfx + 'aetheria_machine';
          if (k.startsWith('pelican_') && !k.startsWith(pfx) && k.indexOf('__') === -1 && k !== 'pelican_icon_manifest' && k !== 'pelican_item_catalog') {
            return pfx + k.slice(8);
          }
          return k;
        };
        __sp.getItem = function(k) {
          if (this === window.localStorage) {
            const pid = __getPid();
            if (window.__pmDeviceId && (k === 'aetheria.device' || (pid && k === 'pelican_' + pid + '__aetheria_device'))) {
              return window.__pmDeviceId;
            }
            if (window.__pmMachineId && (k === 'aetheria.machine' || (pid && k === 'pelican_' + pid + '__aetheria_machine'))) {
              return window.__pmMachineId;
            }
          }
          return __rawGet.call(this, __mapKey(this, k));
        };
        __sp.setItem = function(k, v) {
          const pid = __getPid();
          if (this === window.localStorage && pid) {
            if (!__isTransientStorageKey(k)) {
              window.__pmStorageDirtyAt = Date.now();
            }
            if (k === 'aetheria.device' || k === 'pelican_' + pid + '__aetheria_device') {
              const incoming = String(v || '').trim();
              const dev = (incoming && incoming.length >= 16 && incoming !== 'unknown-device') ? incoming : (window.__pmDeviceId || __mintUuid());
              window.__pmDeviceId = dev;
              const targetKey = 'pelican_' + pid + '__aetheria_device';
              try {
                return __rawSet.call(this, targetKey, dev);
              } catch (_) {
                __freeStorageQuota(this, __rawDel);
                try { return __rawSet.call(this, targetKey, dev); } catch (__) { return; }
              }
            }
            if (k === 'aetheria.machine' || k === 'pelican_' + pid + '__aetheria_machine') {
              const incoming = String(v || '').trim().toLowerCase();
              const mach = (incoming && incoming.length === 64) ? incoming : (window.__pmMachineId || __mintMachineId());
              window.__pmMachineId = mach;
              const targetKey = 'pelican_' + pid + '__aetheria_machine';
              try {
                return __rawSet.call(this, targetKey, mach);
              } catch (_) {
                __freeStorageQuota(this, __rawDel);
                try { return __rawSet.call(this, targetKey, mach); } catch (__) { return; }
              }
            }
            const mk = __mapKey(this, k);
            let finalVal = v;
            if ((mk.endsWith('__sell_cfg') || mk === 'pelican_sell_cfg') && typeof v === 'string' && v.indexOf('"weaponRarity"') === -1) {
              try {
                const prevSell = __rawGet.call(this, mk);
                if (prevSell && prevSell.indexOf('"weaponRarity"') !== -1) {
                  const pa = JSON.parse(prevSell);
                  const pb = JSON.parse(v);
                  if (pa && pb && typeof pa === 'object' && typeof pb === 'object') {
                    const mergedSell = Object.assign({}, pa, pb);
                    if (pa.whitelist && String(pa.whitelist).length > 50 && (!pb.whitelist || String(pb.whitelist).trim() === 'Halloween Candy, Golden Pumpkin')) {
                      mergedSell.whitelist = pa.whitelist;
                    }
                    finalVal = JSON.stringify(mergedSell);
                  }
                }
              } catch (_) {}
            }
            try {
              return __rawSet.call(this, mk, finalVal);
            } catch (_) {
              __freeStorageQuota(this, __rawDel);
              try { return __rawSet.call(this, mk, finalVal); } catch (__) { return; }
            }
          }
          return __rawSet.call(this, k, v);
        };
        __sp.removeItem = function(k) {
          const pid = __getPid();
          if (this === window.localStorage && pid && (k === 'aetheria.device' || k === 'aetheria.machine' || k === 'pelican_' + pid + '__aetheria_device' || k === 'pelican_' + pid + '__aetheria_machine')) {
            return;
          }
          return __rawDel.call(this, __mapKey(this, k));
        };
      }
      try {
        if (window.localStorage) {
          const __rawSet = (window.__pmRawStorage && window.__pmRawStorage.set) || Storage.prototype.setItem;
          const __rawDel = (window.__pmRawStorage && window.__pmRawStorage.del) || Storage.prototype.removeItem;
          try { __rawDel.call(window.localStorage, 'aetheria.device'); } catch (_) {}
          try { __rawDel.call(window.localStorage, 'aetheria.machine'); } catch (_) {}
          if (window.__pmProfileId && window.__pmDeviceId) {
            const targetKey = 'pelican_' + window.__pmProfileId + '__aetheria_device';
            try {
              __rawSet.call(window.localStorage, targetKey, window.__pmDeviceId);
            } catch (_) {
              __freeStorageQuota(window.localStorage, __rawDel);
              try { __rawSet.call(window.localStorage, targetKey, window.__pmDeviceId); } catch (__) {}
            }
          }
          if (window.__pmProfileId && window.__pmMachineId) {
            const machKey = 'pelican_' + window.__pmProfileId + '__aetheria_machine';
            try {
              __rawSet.call(window.localStorage, machKey, window.__pmMachineId);
            } catch (_) {
              __freeStorageQuota(window.localStorage, __rawDel);
              try { __rawSet.call(window.localStorage, machKey, window.__pmMachineId); } catch (__) {}
            }
          }
        }
      } catch (_) {}
      if (!window.__pmEnterWorldDeviceHookInstalled && typeof window.fetch === 'function') {
        window.__pmEnterWorldDeviceHookInstalled = true;
        const __origFetch = window.fetch;
        window.fetch = function(input, init) {
          let loginCreds = null;
          let isEnterWorld = false;
          try {
            const urlStr = typeof input === 'string' ? input : (input && typeof input.url === 'string' ? input.url : '');
            const isRegisterCall = urlStr.includes('/auth/register');
            if (urlStr === '/world/enter' || urlStr.endsWith('/world/enter') || urlStr.includes('/world/enter?')) {
              isEnterWorld = true;
            }
            if (isEnterWorld || isRegisterCall || (init && typeof init.body === 'string' && (init.body.includes('"deviceId"') || init.body.includes('"machineId"')))) {
              if (!window.__pmDeviceId || window.__pmDeviceId === 'unknown-device') {
                window.__pmDeviceId = __mintUuid();
              }
              if (!window.__pmMachineId || typeof window.__pmMachineId !== 'string' || window.__pmMachineId.length !== 64) {
                window.__pmMachineId = __mintMachineId();
              }
              if (init && typeof init.body === 'string') {
                const parsed = JSON.parse(init.body);
                if (parsed && typeof parsed === 'object') {
                  if (isEnterWorld || isRegisterCall || 'deviceId' in parsed) parsed.deviceId = window.__pmDeviceId;
                  if (isEnterWorld || isRegisterCall || 'machineId' in parsed) parsed.machineId = window.__pmMachineId;
                  init = Object.assign({}, init, { body: JSON.stringify(parsed) });
                }
              }
            }
            if (init && typeof init.body === 'string' && (urlStr.includes('/auth/login') || urlStr.includes('/auth/register') || urlStr.includes('/auth/upgrade'))) {
              const parsedAuth = JSON.parse(init.body);
              const authUser = parsedAuth && (typeof parsedAuth.userId === 'string' ? parsedAuth.userId.trim() : (typeof parsedAuth.username === 'string' ? parsedAuth.username.trim() : ''));
              if (authUser && parsedAuth && typeof parsedAuth.password === 'string' && parsedAuth.password) {
                loginCreds = { username: authUser, password: parsedAuth.password, isRegister: urlStr.includes('/auth/register') || urlStr.includes('/auth/upgrade') };
              }
            }
          } catch (_) {}
          const p = __origFetch.call(this, input, init);
          if (isEnterWorld && p && typeof p.then === 'function') {
            p.then(res => {
              if (res && !res.ok && !window.__pmManagedDeviceGroup) {
                try {
                  res.clone().text().then(txt => {
                    if (txt && txt.includes('เครื่องนี้เล่นพร้อมกัน')) {
                      const nextDev = __mintUuid();
                      const nextMach = __mintMachineId();
                      window.__pmDeviceId = nextDev;
                      window.__pmMachineId = nextMach;
                      try {
                        const __rawSet = (window.__pmRawStorage && window.__pmRawStorage.set) || Storage.prototype.setItem;
                        if (window.localStorage && window.__pmProfileId) {
                          __rawSet.call(window.localStorage, 'pelican_' + window.__pmProfileId + '__aetheria_device', nextDev);
                          __rawSet.call(window.localStorage, 'pelican_' + window.__pmProfileId + '__aetheria_machine', nextMach);
                        }
                      } catch (_) {}
                    }
                  }).catch(() => {});
                } catch (_) {}
              }
              return res;
            }).catch(() => {});
          }
          if (loginCreds && p && typeof p.then === 'function') {
            p.then(res => {
              if (res && res.ok) {
                try {
                  const now = Date.now();
                  const cur = (window.__authConfig && typeof window.__authConfig === 'object') ? window.__authConfig : {};
                  const isSameGen = Boolean(cur.generatedUser && cur.username === loginCreds.username);
                  const next = Object.assign({}, cur, {
                    username: loginCreds.username,
                    password: loginCreds.password,
                    generatedUser: isSameGen,
                    register: false,
                    registerDone: true,
                    verifiedLoginAt: now,
                    userEditedAt: Number(cur.userEditedAt) || 0
                  });
                  delete next.registerError;
                  window.__authConfig = next;
                  if (window.localStorage) window.localStorage.setItem('pelican_auth_cfg', JSON.stringify(next));
                  const uEl = document.getElementById('p-auth-user');
                  const pEl = document.getElementById('p-auth-pass');
                  if (uEl && document.activeElement !== uEl) uEl.value = next.username;
                  if (pEl && document.activeElement !== pEl) pEl.value = next.password;
                } catch (_) {}
              }
              return res;
            }).catch(() => {});
          }
          return p;
        };
      }
      if (!window.__pmAuthInputGuardInstalled && typeof document !== 'undefined') {
        window.__pmAuthInputGuardInstalled = true;
        const onAuthInput = (ev) => {
          try {
            const t = ev && ev.target;
            if (!t || !t.id) return;
            if (t.id === 'p-auth-user' || t.id === 'p-auth-pass') {
              const now = Date.now();
              const cur = (window.__authConfig && typeof window.__authConfig === 'object') ? window.__authConfig : {};
              if (t.id === 'p-auth-user') cur.username = String(t.value || '').trim();
              if (t.id === 'p-auth-pass') cur.password = String(t.value || '');
              cur.userEditedAt = now;
              cur.generatedUser = false;
              cur.register = false;
              delete cur.registerError;
              window.__authConfig = cur;
              if (window.localStorage) window.localStorage.setItem('pelican_auth_cfg', JSON.stringify(cur));
            } else if (t.id === 'p-auth-enabled') {
              const cur = (window.__authConfig && typeof window.__authConfig === 'object') ? window.__authConfig : {};
              cur.enabled = Boolean(t.checked);
              cur.userToggledAt = Date.now();
              window.__authConfig = cur;
              if (window.localStorage) window.localStorage.setItem('pelican_auth_cfg', JSON.stringify(cur));
            }
          } catch (_) {}
        };
        document.addEventListener('input', onAuthInput, true);
        document.addEventListener('change', onAuthInput, true);
      }
    } catch (_) {}`;
    const cacheFlag = Boolean(effectiveAssetCache && effectiveAssetCache.isEnabled());
    return `window.__pmProfileId = ${JSON.stringify(profileId)}; window.__pmManagedDeviceGroup = true; window.__pmDeviceId = ${JSON.stringify(deviceId)}; window.__pmMachineId = ${JSON.stringify(machineId)}; window.__pmLocalAssetCacheEnabled = ${cacheFlag}; try { window.sessionStorage && window.sessionStorage.setItem('__pmProfileId', ${JSON.stringify(profileId)}); } catch (_) {} ${deviceHookJs} ${restoreJs}`;
  };

  async function configureSessionAssetCache(sessionId) {
    if (!sessionId) return;
    await Promise.all([
      send('Fetch.disable', {}, sessionId, 3000).catch(() => {}),
      send('Runtime.disable', {}, sessionId, 3000).catch(() => {})
    ]);
  }

  let lastSharedHarvestAt = 0;
  async function syncClientStorage(c, forceHarvest = false) {
    if (!c || !c.sessionId || !storageDir) return;
    try {
      const prefix = `pelican_${c.profileId}__`;
      const harvestAll = !c.browserContextId && (Date.now() - lastSharedHarvestAt > 120000);
      if (harvestAll) lastSharedHarvestAt = Date.now();
      const res = await evaluate(c, `(() => {
        if (!window.__pmStorageRestored) return { restored: false, out: {}, other: {} };
        if (window.__pmProfileId && window.__pmProfileId !== ${JSON.stringify(c.profileId)}) return { restored: false, out: {}, other: {} };
        const curDirty = window.__pmStorageDirtyAt || 1;
        const doHarvest = ${Boolean(harvestAll)};
        const force = ${Boolean(forceHarvest)};
        if (!force && !doHarvest && window.__pmLastHarvestedDirtyAt === curDirty) {
          return { restored: true, unchanged: true, dirtyAt: curDirty };
        }
        window.__pmLastHarvestedDirtyAt = curDirty;
        const out = {};
        const other = {};
        const __rawGet = (window.__pmRawStorage && window.__pmRawStorage.get) || Storage.prototype.getItem;
        if (window.localStorage) {
          const pfx = ${JSON.stringify(prefix)};
          const extraKeys = new Set(['ui.windows', 'partyFrameFolded', 'skip-anim:refine', 'hudMenuOpen', 'webgame.camera']);
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (!k || k === 'aetheria.device' || k === 'aetheria.machine' || k === 'pelican_icon_manifest' || k === 'pelican_item_catalog' || k === 'pelican_latest_inventory' || k === 'pelican_packet_logs' || k === 'pelican_last_weight' || k === 'pelican_embedded_human_check_cfg' || k.endsWith('__icon_manifest') || k.endsWith('__item_catalog') || k.endsWith('__latest_inventory') || k.endsWith('__packet_logs') || k.endsWith('__last_weight') || k.endsWith('__embedded_human_check_cfg') || k.startsWith('webgame.chat.')) continue;
            const isOwn = k.startsWith(pfx) || extraKeys.has(k);
            const isOther = doHarvest && !isOwn && k.startsWith('pelican_profile_');
            if (!isOwn && !isOther) continue;
            const rawVal = __rawGet.call(window.localStorage, k);
            if (typeof rawVal !== 'string') continue;
            if (isOwn) {
              out[k] = rawVal;
            } else {
              const rest = k.slice(8);
              const sepIdx = rest.indexOf('__');
              if (sepIdx > 0) {
                const otherPid = rest.slice(0, sepIdx);
                if (!other[otherPid]) other[otherPid] = {};
                other[otherPid][k] = rawVal;
              }
            }
          }
        }
        if (window.sessionStorage) {
          const ssVal = __rawGet.call(window.sessionStorage, 'aetheria.session');
          if (ssVal) out['__ss:aetheria.session'] = ssVal;
        }
        return { restored: true, dirtyAt: curDirty, out, other };
      })()`, 5000);
      if (!res || res.restored === false || res.unchanged) return;
      const entries = res && res.out ? res.out : res;
      if (entries && typeof entries === 'object' && Object.keys(entries).length > 0) {
        saveProfileStorage(c.profileId, entries);
        if (res && res.dirtyAt && res.dirtyAt !== c.lastSyncedDirtyAt) {
          c.lastSyncedDirtyAt = res.dirtyAt;
          if (forceHarvest && (!isRealSession || !c.initScriptId || Date.now() - (c.lastSessionHooksAt || 0) > 180000)) {
            c.lastSessionHooksAt = Date.now();
            await ensureSessionHooks(c.sessionId, c.profileId, c).catch(() => {});
          }
        }
      }
      if (res && res.other && typeof res.other === 'object') {
        let harvestedNew = false;
        for (const [otherId, map] of Object.entries(res.other)) {
          if (!map || typeof map !== 'object' || Object.keys(map).length === 0) continue;
          const existing = loadProfileStorage(otherId);
          if (!existing || Object.keys(existing).length === 0) harvestedNew = true;
          saveProfileStorage(otherId, map);
        }
        if (harvestedNew && typeof loadProfiles === 'function') {
          try { loadProfiles(); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  async function ensureSessionHooks(sessionId, profileId, clientObj = null) {
    await send('Page.enable', {}, sessionId, 5000).catch(() => {});
    await configureSessionAssetCache(sessionId);
    const c = clientObj || clients.get(profileId) || null;
    if (c) {
      const oldIds = Array.isArray(c.initScriptIds) ? c.initScriptIds.slice() : [];
      if (c.initScriptId && !oldIds.includes(c.initScriptId)) oldIds.push(c.initScriptId);
      c.initScriptIds = [];
      c.initScriptId = null;
      for (const id of oldIds) {
        if (id) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id }, sessionId, 2000).catch(() => {});
      }
    }
    const added = await send('Page.addScriptToEvaluateOnNewDocument', { source: profileInitScript(profileId) }, sessionId, 5000).catch(() => null);
    if (c && added && added.identifier) {
      c.initScriptId = added.identifier;
      if (!Array.isArray(c.initScriptIds)) c.initScriptIds = [];
      c.initScriptIds.push(added.identifier);
    }
  }

  async function health(c, customTimeoutMs = 0) {
    const tMs = customTimeoutMs > 0 ? customTimeoutMs : (isRealSession ? 6000 : 8000);
    const value=await evaluate(c,HEALTH_JS,tMs,true);
    if(!value || typeof value.documentId!=='string')throw Error('INVALID_DOCUMENT_PROBE');
    if(c.documentId!==value.documentId) {c.documentId=value.documentId;c.generation++;c.attempts=0;clearTimeout(c.retryTimer);c.retryTimer=null;}
    return value;
  }
  const current=(c,token)=>clients.get(c.profileId)===c&&!stoppedProfiles.has(c.profileId)&&c.generation===token.generation&&c.sessionId===token.sessionId;
  function classify(c,h) {
    const devId = ensureProfileDeviceId(c.profileId);
    if(h.version&&h.hud&&h.liveHook){
      if (Date.now() - (c.lastCrashReloadAt || 0) > 120000) c.crashReloadCount=0;
      c.stateFailCount=0;c.firstStateFailAt=0;c.attempts=0;c.probeFailCount=0;c.evalTimeouts=0;c.evalCooldownUntil=0;c.initialHealthChecked=true;
      diagnostic(c,'ready',{version:h.version,documentId:h.documentId,deviceId:h.deviceId||devId,hud:h.hud,liveHook:h.liveHook});
      return true;
    }
    if(h.version||h.hud||h.liveHook||(isRealSession ? h.payloadInitialized : (h.initialized&&h.bootstrapPhase!=='waiting'))){c.stateFailCount=0;c.firstStateFailAt=0;c.probeFailCount=0;diagnostic(c,'partial-runtime',{version:h.version,documentId:h.documentId,deviceId:h.deviceId||devId,hud:h.hud,liveHook:h.liveHook});return true;}
    return false;
  }

  async function reloadCrashedClient(c, reason = 'crashed', force = false) {
    if (!c || stoppedProfiles.has(c.profileId) || clients.get(c.profileId) !== c) return false;
    const now = Date.now();
    if (c.crashReloadInFlight) return false;
    if (!force) {
      if ((c.crashReloadCount || 0) >= 3) return false;
      if (now - (c.lastCrashReloadAt || 0) < 90000) return false;
    }
    c.crashReloadInFlight = true;
    c.lastCrashReloadAt = now;
    c.crashReloadCount = (c.crashReloadCount || 0) + 1;
    c.stateFailCount = 0;
    c.firstStateFailAt = 0;
    c.evalTimeouts = 0;
    c.evalCooldownUntil = Date.now() + 4000;
    c.probeFailCount = 0;
    c.generation++;
    c.documentId = null;
    c.attempts = 0;
    clearTimeout(c.retryTimer);
    c.retryTimer = null;
    diagnostic(c, 'crashed-reloading', { reason: String(reason), reloadCount: c.crashReloadCount });
    console.warn(`[BrowserMode] 🔄 จอ ${c.profileId} ค้างหรือแรมเต็ม (${reason}) -> สั่ง Refresh หน้าเกมอัตโนมัติ (ครั้งที่ ${c.crashReloadCount})`);
    const schedulePostReloadInject = () => {
      const t = setTimeout(() => {
        if (c) c.evalCooldownUntil = 0;
        ensureSessionHooks(c.sessionId, c.profileId, c).finally(() => injectBot(c).catch(() => {}));
      }, 1800);
      t.unref?.();
    };
    try {
      await ensureSessionHooks(c.sessionId, c.profileId, c).catch(() => {});
      await send('Page.reload', { ignoreCache: false }, c.sessionId, isRealSession ? 3000 : 8000);
      schedulePostReloadInject();
      return true;
    } catch (_) {
      try {
        await ensureSessionHooks(c.sessionId, c.profileId, c).catch(() => {});
        await send('Page.navigate', { url: gameUrl }, c.sessionId, isRealSession ? 4000 : 8000);
        schedulePostReloadInject();
        return true;
      } catch (_) {
        try {
          const { sessionId } = await send('Target.attachToTarget', { targetId: c.targetId, flatten: true }, undefined, 4000);
          c.sessionId = sessionId;
          await ensureSessionHooks(sessionId, c.profileId, c).catch(() => {});
          await send('Page.reload', { ignoreCache: false }, sessionId, 3000).catch(() => send('Page.navigate', { url: gameUrl }, sessionId, 4000));
          schedulePostReloadInject();
          return true;
        } catch (_) {
          return false;
        }
      }
    } finally {
      c.crashReloadInFlight = false;
    }
  }

  let activeHeavyInjectionChain = Promise.resolve();
  let heavyInjectionInFlightCount = 0;
  async function injectBot(c) {
    if(clients.get(c.profileId)!==c||stoppedProfiles.has(c.profileId))return;
    if(c.retryTimer)return;
    if(c.injectionInFlight){c.pendingLoad=true;return c.injectionInFlightPromise;}
    const flight={};c.injectionInFlight=flight;
    let token;
    const runPromise = (async () => {
    try {
      const before=await health(c);token={generation:c.generation,sessionId:c.sessionId};
      const expectedDeviceId = ensureProfileDeviceId(c.profileId);
      const expectedMachineId = ensureProfileMachineId(c.profileId);
      if (isRealSession && before.profileId === c.profileId && before.version && before.hud && before.liveHook) {
        if (!c.initScriptId) {
          ensureSessionHooks(c.sessionId, c.profileId, c).catch(() => {});
        }
        if (classify(c, before)) return;
      }
      if (before.profileId && before.profileId !== c.profileId) {
        if (knownTargets.get(c.profileId) === c.targetId) {
          knownTargets.delete(c.profileId);
          saveKnownTargets();
        }
        drop(c);
        return;
      }
      if (before.profileId !== c.profileId || before.deviceId !== expectedDeviceId || before.machineId !== expectedMachineId || !before.storageRestored) {
        await ensureSessionHooks(c.sessionId, c.profileId, c);
        await evaluate(c, profileInitScript(c.profileId), 6000, true).catch(() => {});
        before.deviceId = expectedDeviceId;
        before.machineId = expectedMachineId;
        before.storageRestored = true;
      }
      if(classify(c,before))return;
      if(!isGameUrl(before.href)||new URL(before.href).pathname!=='/play'||before.ready!=='complete'){
        diagnostic(c,'document-pending');
        if(c.attempts<5 && current(c,token)){
          c.retryTimer=setTimeout(()=>{c.retryTimer=null;injectBot(c);},retryDelays[Math.min(c.attempts,retryDelays.length-1)]||1000);
          c.retryTimer.unref?.();
        }
        return;
      }
      if(c.attempts>=3){
        if (Date.now() - (c.lastAttemptAt || 0) > 12000) {
          c.attempts = 0;
        } else {
          diagnostic(c,'load-failed',{code:'RETRY_LIMIT'});
          return;
        }
      }
      c.attempts++;c.lastAttemptAt=Date.now();diagnostic(c,'loading');
      const selectedSource=profileScriptSource?.(c.profileId);
      const code = (typeof selectedSource === 'string' && isRealSession) ? selectedSource : await botSource(c.profileId);
      if(!isRealSession && profileScriptSource?.(c.profileId)!==selectedSource)return;
      if(!current(c,token))return;
      if (isRealSession) {
        let releaseGate;
        const prevGate = activeHeavyInjectionChain;
        activeHeavyInjectionChain = new Promise(r => { releaseGate = r; });
        try {
          await prevGate;
          heavyInjectionInFlightCount++;
          try {
            if(!current(c,token))return;
            const after=await health(c);
            if(!current(c,token)||after.documentId!==before.documentId||classify(c,after))return;
            await evaluate(c,MSGPACK,8000,true);
            if(!current(c,token))return;
            const invokeCode = code.includes('\nwindow.__pmScriptBootstrap.accept(')
              ? code.replace('\nwindow.__pmScriptBootstrap.accept(', '\nreturn window.__pmScriptBootstrap.accept(')
              : code;
            const expression=`(async () => { if(String(performance.timeOrigin)!==${JSON.stringify(before.documentId)}) return {skipped:true,reason:'DOCUMENT_CHANGED'}; if(!window.__pmProfileId) window.__pmProfileId=${JSON.stringify(c.profileId)}; if(!window.__pmDeviceId) window.__pmDeviceId=${JSON.stringify(expectedDeviceId)}; try { window.sessionStorage && window.sessionStorage.setItem('__pmProfileId', window.__pmProfileId); } catch (_) {} if(window.__pelicanBotVersion || window.__pmPayloadInitialized || ('__isBotRunning' in window) || typeof window.startMasterBot==='function' || document.getElementById('pelican-hud') || typeof window.__getClientLiveState==='function') return {skipped:true,reason:'ALREADY_RUNNING'}; if(window.__pmScriptBootstrap?.status?.()?.phase === 'failed') { try { delete window.__pmScriptBootstrap; delete window.__pmBrowserInjectionAttempted; } catch (_) { window.__pmScriptBootstrap = null; window.__pmBrowserInjectionAttempted = false; } } window.__pmBrowserInjectionAttempted=true; const evalResult = await (async () => { /*(0,eval)(*/\n${invokeCode}\n})(); return {attempted:true, evalResult}; })()`;
            await evaluate(c, expression, 25000, true);
            await new Promise(r => setTimeout(r, 200));
          } finally {
            heavyInjectionInFlightCount = Math.max(0, heavyInjectionInFlightCount - 1);
          }
        } finally {
          releaseGate();
        }
      } else {
        const after=await health(c);
        if(!current(c,token)||after.documentId!==before.documentId||classify(c,after))return;
        await evaluate(c,MSGPACK,8000);
        if(!current(c,token))return;
        // Atomic document/runtime guard closes the race with a delayed legacy loader response.
        const expression=`(async () => { if(String(performance.timeOrigin)!==${JSON.stringify(before.documentId)}) return {skipped:true,reason:'DOCUMENT_CHANGED'}; if(!window.__pmProfileId) window.__pmProfileId=${JSON.stringify(c.profileId)}; if(!window.__pmDeviceId) window.__pmDeviceId=${JSON.stringify(expectedDeviceId)}; try { window.sessionStorage && window.sessionStorage.setItem('__pmProfileId', window.__pmProfileId); } catch (_) {} if(window.__pelicanBotVersion || window.__pmPayloadInitialized || ('__isBotRunning' in window) || typeof window.startMasterBot==='function' || document.getElementById('pelican-hud') || typeof window.__getClientLiveState==='function') return {skipped:true,reason:'ALREADY_RUNNING'}; if(window.__pmScriptBootstrap?.status?.()?.phase === 'failed') { try { delete window.__pmScriptBootstrap; delete window.__pmBrowserInjectionAttempted; } catch (_) { window.__pmScriptBootstrap = null; window.__pmBrowserInjectionAttempted = false; } } window.__pmBrowserInjectionAttempted=true; const evalResult = await (0,eval)(${JSON.stringify(code)}); return {attempted:true, evalResult}; })()`;
        await evaluate(c,expression);
      }
      if(!current(c,token))return;
      const result=await health(c);
      if(!classify(c,result)) {
        diagnostic(c,'partial-runtime',{code:'POSTCONDITION_MISSING'});
        if (c.attempts < 3 && !c.retryTimer) {
          c.retryTimer=setTimeout(()=>{c.retryTimer=null;injectBot(c);},retryDelays[Math.max(0,c.attempts-1)]||2500);
          c.retryTimer.unref?.();
        }
      }
    } catch (e) {
      if(isGoneError(e)){diagnostic(c,'transport-disconnected',{gameAlive:null});drop(c);scheduleReconnect();return;}
      if(!token){
        if(clients.get(c.profileId)===c){
          const curDiag = diagnostics.get(c.profileId);
          if (!curDiag || curDiag.state !== 'ready') {
            diagnostic(c,'probe-unavailable',{code:'DOCUMENT_PROBE_FAILED'});
            c.probeFailCount = (c.probeFailCount || 0) + 1;
            if ((c.probeFailCount || 0) < 6 && !c.retryTimer) {
              const delayMs = isRealSession ? Math.min(20000, 4000 * c.probeFailCount) : 2500;
              c.retryTimer=setTimeout(()=>{c.retryTimer=null;injectBot(c);},delayMs);
              c.retryTimer.unref?.();
            }
          }
        }
        return;
      }
      if(!current(c,token))return;
      let existing=false;
      try{existing=classify(c,await health(c));}catch(_){}
      if(!existing && current(c,token) && c.attempts<3 && !isGoneError(e)) {
        diagnostic(c,'retry-pending',{code:'LOAD_FAILED'});
        c.retryTimer=setTimeout(()=>{c.retryTimer=null;injectBot(c);},retryDelays[Math.max(0,c.attempts-1)]);c.retryTimer.unref?.();
      } else if(!existing)diagnostic(c,'load-failed',{code:isGoneError(e)?'CDP_UNAVAILABLE':'LOAD_FAILED'});
    } finally {
      if(c.injectionInFlight===flight){c.injectionInFlight=null;c.injectionInFlightPromise=null;}
      if(c.pendingLoad&&clients.get(c.profileId)===c&&!stoppedProfiles.has(c.profileId)){c.pendingLoad=false;setTimeout(()=>injectBot(c),0);}
    }
    })();
    c.injectionInFlightPromise = runPromise;
    return runPromise;
  }

  listeners.add(msg => {
    if (!msg.sessionId) return;
    if (msg.method === 'Fetch.requestPaused' && msg.params?.requestId) {
      const requestId = msg.params.requestId;
      const reqUrl = msg.params.request?.url || '';
      const reqMethod = String(msg.params.request?.method || 'GET').toUpperCase();
      if (reqUrl.includes('/__pmhee_recover__')) {
        send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
          body: Buffer.from('<!doctype html><html><body>ok</body></html>').toString('base64')
        }, msg.sessionId, 3000).catch(() => {});
        return;
      }
      if (effectiveAssetCache && effectiveAssetCache.isEnabled() && reqMethod === 'GET' && effectiveAssetCache.isCacheableAssetUrl(reqUrl)) {
        effectiveAssetCache.getOrFetch(reqUrl).then(cached => {
          if (cached && cached.ok && cached.base64) {
            return send('Fetch.fulfillRequest', {
              requestId,
              responseCode: 200,
              responseHeaders: [
                { name: 'Content-Type', value: cached.mimeType || 'application/octet-stream' },
                { name: 'Content-Length', value: String(cached.size || 0) },
                { name: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
                { name: 'Access-Control-Allow-Origin', value: '*' },
                { name: 'Access-Control-Allow-Methods', value: 'GET, HEAD, OPTIONS' },
                { name: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
                { name: 'X-Pmhee-Asset-Cache', value: cached.hit ? 'HIT' : 'MISS-DIRECT' }
              ],
              body: cached.base64
            }, msg.sessionId, 10000);
          }
          return send('Fetch.continueRequest', { requestId }, msg.sessionId, 5000);
        }).catch(() => {
          send('Fetch.continueRequest', { requestId }, msg.sessionId, 5000).catch(() => {});
        });
      } else {
        send('Fetch.continueRequest', { requestId }, msg.sessionId, 5000).catch(() => {});
      }
      return;
    }
    const c = Array.from(clients.values()).find(x => x.sessionId === msg.sessionId);
    if (!c) return;
    if(msg.method==='Page.frameNavigated'&&!msg.params?.frame?.parentId){c.generation++;c.documentId=null;c.attempts=0;clearTimeout(c.retryTimer);diagnostic(c,'document-pending',{navigationType:String(msg.params?.type||'navigation').slice(0,40)});}
    if(msg.method==='Page.loadEventFired')injectBot(c);
    if(msg.method==='Inspector.targetCrashed')reloadCrashedClient(c,'Inspector.targetCrashed').catch(()=>{});
  });
  listeners.add(msg => {
    if (msg.method === 'Target.targetDestroyed') {
      for (const c of Array.from(clients.values())) if (c.targetId === msg.params.targetId) {diagnostic(c,'closed');knownTargets.delete(c.profileId);saveKnownTargets();drop(c);}
    }
    if (msg.method === 'Target.targetCrashed') {
      for (const c of Array.from(clients.values())) if (c.targetId === msg.params.targetId) reloadCrashedClient(c, msg.params?.status || 'Target.targetCrashed').catch(() => {});
    }
    if (msg.method === 'Target.detachedFromTarget') {
      for (const c of Array.from(clients.values())) if (c.sessionId === msg.params.sessionId) {diagnostic(c,'transport-disconnected',{gameAlive:null});drop(c);scheduleReconnect();}
    }
  });

  async function ensureClientFramePacerHealed(c) {
    if (!c || !c.sessionId || c.framePacerHealInFlight) return;
    if (!c.cdpFetchDisabled) {
      c.cdpFetchDisabled = true;
      send('Fetch.disable', {}, c.sessionId, 3000).catch(() => {});
    }
    if (c.framePacerHealedDocId && c.framePacerHealedDocId === c.documentId) return;
    c.framePacerHealInFlight = true;
    try {
      const res = await evaluate(c, `(async () => {
        if (window.__pmFramePacerLeakFixedV3) return { healed: true, docId: String(performance.timeOrigin) };
        window.__pmFramePacerLeakFixed = true;
        window.__pmFramePacerLeakFixedV2 = true;
        window.__pmFramePacerLeakFixedV3 = true;
        try {
          const st1 = document.getElementById('pm-bg-anim-pause');
          if (st1 && !window.__pmZeroRender) st1.textContent = '';
          const st2 = document.getElementById('pelican-bg-anim-pause');
          if (st2 && !window.__pmZeroRender) st2.textContent = '';
        } catch (e) {}
        if (window.__tooltipRescueInterval && !window.__tooltipRescueIntervalThrottled) {
          window.__tooltipRescueIntervalThrottled = true;
          clearInterval(window.__tooltipRescueInterval);
          window.__tooltipRescueInterval = setInterval(() => {
            if (window.__pmZeroRender) return;
            try {
              const ttEl = document.querySelector('.item-tooltip');
              if (ttEl && !document.querySelector(':hover')) {
                const rootEl = document.getElementById('root') || document.body.firstElementChild;
                if (rootEl) {
                  const fk = Object.keys(rootEl).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
                  if (fk) {
                    let q = [rootEl[fk]], visited = 0;
                    while (q.length > 0 && visited < 1200) {
                      let node = q.shift();
                      visited++;
                      if (!node) continue;
                      if (node.type && (node.type.name === 'TooltipLayer' || node.type.name === 'Fx') && node.memoizedState) {
                        let s = node.memoizedState;
                        while (s) {
                          if (s.memoizedState && typeof s.memoizedState === 'object' && 'item' in s.memoizedState && s.queue && s.queue.dispatch) {
                            s.queue.dispatch(null);
                            break;
                          }
                          s = s.next;
                        }
                      }
                      if (node.child) q.push(node.child);
                      if (node.sibling) q.push(node.sibling);
                    }
                  }
                }
              }
            } catch (_) {}
          }, 2500);
        }
        if (!window.__pmPointerWakeInstalled) {
          window.__pmPointerWakeInstalled = true;
          const onPtr = () => {
            window.__pmHovered = true;
            window.__pmLastPointerTs = Date.now();
            try {
              const st1 = document.getElementById('pm-bg-anim-pause');
              if (st1 && !window.__pmZeroRender) st1.textContent = '';
              const st2 = document.getElementById('pelican-bg-anim-pause');
              if (st2 && !window.__pmZeroRender) st2.textContent = '';
            } catch (e) {}
            if (typeof window.__pmSyncActiveState === 'function') {
              try { window.__pmSyncActiveState(); } catch (e) {}
            }
          };
          try {
            document.addEventListener('pointerenter', onPtr, { passive: true, capture: true });
            document.addEventListener('pointermove', onPtr, { passive: true, capture: true });
            document.addEventListener('pointerdown', onPtr, { passive: true, capture: true });
            document.addEventListener('mousedown', onPtr, { passive: true, capture: true });
          } catch (e) {}
        }
        return { healed: true, docId: String(performance.timeOrigin) };
      })()`, 4000);
      if (res && res.healed) {
        c.framePacerHealedDocId = res.docId || c.documentId || 'healed';
      }
    } catch (_) {
    } finally {
      c.framePacerHealInFlight = false;
    }
  }

  async function attach(profileId, targetId, skipIdentityProbe = false, browserContextId = null, fastRediscover = false) {
    if(stoppedProfiles.has(profileId))throw Error('PROFILE_STOPPED');
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, undefined, 15000);
    try {
    const initScript = profileInitScript(profileId);
    const resInit = await Promise.all([
      send('Page.enable', {}, sessionId, 3500).catch(() => {}),
      configureSessionAssetCache(sessionId),
      send('Page.addScriptToEvaluateOnNewDocument', { source: initScript }, sessionId, 3500).catch(() => null)
    ]);
    const addedInit = resInit[2];
    if (!fastRediscover && !skipIdentityProbe) {
      try {
        const identity = await evaluate({ sessionId }, `(() => { if(!window.__pmProfileId)window.__pmProfileId=${JSON.stringify(profileId)}; try { window.sessionStorage && window.sessionStorage.setItem('__pmProfileId', window.__pmProfileId); } catch (_) {} return window.__pmProfileId; })()`, 4000);
        if (identity && identity !== profileId) throw Error('PROFILE_ID_CONFLICT');
        await evaluate({ sessionId }, initScript, 4000).catch(() => {});
      } catch (probeErr) {
        if (probeErr && probeErr.message === 'PROFILE_ID_CONFLICT') throw probeErr;
      }
    }
    if(stoppedProfiles.has(profileId))throw Error('PROFILE_STOPPED');
    const initScriptId = (addedInit && addedInit.identifier) ? addedInit.identifier : null;
    const c = { profileId, targetId, sessionId, browserContextId: browserContextId || null, generation:0,documentId:null,attempts:0,injectionInFlight:null,injectionInFlightPromise:null,retryTimer:null,crashReloadCount:0,lastCrashReloadAt:0,crashReloadInFlight:false,stateFailCount:0,firstStateFailAt:0,lastStorageSyncAt:0,initScriptId,initScriptIds:initScriptId?[initScriptId]:[],stateEvalPromise:null,inFlightEvals:new Map(),lastGoodState:null,lastGoodStateAt:0,initialHealthChecked:!fastRediscover,evalInFlightCount:0,evalWaiters:[],evalTimeouts:0,evalCooldownUntil:0,probeFailCount:0 };
    clients.set(profileId, c);
    knownTargets.set(profileId,targetId);saveKnownTargets();diagnostic(c,'document-pending');
    return c;
    } catch(e) {await send('Target.detachFromTarget',{sessionId}, undefined, 3000).catch(()=>{});throw e;}
  }

  let lastLevelDbExtractAt = 0;
  async function migrateProfileStorageFromDefaultContext(profileId) {
    if (!storageDir || !profileId) return;
    const existing = loadProfileStorage(profileId);
    const authKey = `pelican_${profileId}__auth_cfg`;
    let hasFullAuth = false;
    if (existing && typeof existing[authKey] === 'string') {
      try {
        const parsed = JSON.parse(existing[authKey]);
        if (parsed && parsed.username && parsed.password) hasFullAuth = true;
      } catch (_) {}
    }
    if (hasFullAuth) return;
    if (!isRealSession || Date.now() - lastLevelDbExtractAt > 60000) {
      lastLevelDbExtractAt = Date.now();
      try {
        const levelDbDir = path.join(userDataDir, 'Default', 'Local Storage', 'leveldb');
        const diskHarvest = extractPelicanStorageFromLevelDb(levelDbDir);
        if (diskHarvest && diskHarvest.byProfile) {
          for (const [pid, map] of Object.entries(diskHarvest.byProfile)) {
            saveProfileStorage(pid, map);
          }
        }
      } catch (_) {}
    }
    const donor = Array.from(clients.values()).find(x => !x.browserContextId && x.sessionId);
    if (!donor) return;
    try {
      const prefix = `pelican_${profileId}__`;
      const entries = await evaluate(donor, `(() => {
        const out = {};
        if (!window.localStorage) return out;
        const pfx = ${JSON.stringify(prefix)};
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && k.startsWith(pfx) && typeof window.localStorage[k] === 'string') out[k] = window.localStorage[k];
        }
        return out;
      })()`, 3000);
      if (entries && typeof entries === 'object' && Object.keys(entries).length > 0) {
        saveProfileStorage(profileId, entries);
      }
    } catch (_) {}
  }

  async function getCustomBrowserContexts() {
    try {
      const r = await send('Target.getBrowserContexts', {}, undefined, 3000);
      return new Set(Array.isArray(r?.browserContextIds) ? r.browserContextIds : []);
    } catch (_) {
      return new Set();
    }
  }

  // After a Manager restart the browser windows are still there: find them again by __pmProfileId
  function rediscover() {
    if (!rediscovering) rediscovering = rediscoverOnce().finally(() => { rediscovering = null; });
    return rediscovering;
  }
  async function rediscoverOnce() {
    if (!(await browserAlive())) throw Error('CDP not available');
    await connect();
    const { targetInfos } = await send('Target.getTargets');
    const customContexts = await getCustomBrowserContexts();
    const surviving=new Set(targetInfos.map(t=>t.targetId));
    for(const c of Array.from(clients.values())){
      if(c.browserContextId && !customContexts.has(c.browserContextId)) c.browserContextId = null;
      if(!surviving.has(c.targetId)){diagnostic(c,'closed');knownTargets.delete(c.profileId);saveKnownTargets();drop(c);}
    }
    const allProfiles = loadProfiles() || [];
    if (isRealSession && allProfiles.length > 0) {
      const validPids = new Set(allProfiles.map(p => p.id));
      let pruned = false;
      for (const k of Array.from(knownTargets.keys())) {
        if (!validPids.has(k)) { knownTargets.delete(k); pruned = true; }
      }
      if (pruned) saveKnownTargets();
    }
    const unattachedPages = targetInfos.filter(x => x.type === 'page' && isGameUrl(x.url) && !Array.from(clients.values()).some(c => c.targetId === x.targetId));
    const newlyAttached = [];
    const knownPages = [];
    const unknownPages = [];
    for (const t of unattachedPages) {
      const knownMatch = allProfiles.find(p => !clients.has(p.id) && knownTargets.get(p.id) === t.targetId);
      if (knownMatch) knownPages.push({ t, knownMatch });
      else unknownPages.push(t);
    }
    if (knownPages.length > 0) {
      if (screenProxy && screenProxy.isEnabled() && typeof screenProxy.acquireLeasesForProfiles === 'function') {
        await screenProxy.acquireLeasesForProfiles(knownPages.map(x => x.knownMatch.id)).catch(() => {});
      }
      await Promise.all(knownPages.map(async ({ t, knownMatch }) => {
        try {
          if (stoppedProfiles.has(knownMatch.id)) stoppedProfiles.delete(knownMatch.id);
          const isCustomCtx = Boolean(t.browserContextId && customContexts.has(t.browserContextId));
          if (screenProxy && (screenProxy.isEnabled() || isCustomCtx)) {
            if (screenProxy.isEnabled()) screenProxy.acquireForProfile(knownMatch.id, { debugPort: knownMatch.debugPort }).catch(() => {});
            else if (typeof screenProxy.ensureProfileTunnel === 'function') screenProxy.ensureProfileTunnel(knownMatch.id, knownMatch.debugPort).catch(() => {});
          }
          const c = await attach(knownMatch.id, t.targetId, true, isCustomCtx ? t.browserContextId : null, true);
          startProxy(c, knownMatch.debugPort);
          newlyAttached.push({ c, fast: true });
        } catch (_) {}
      }));
    }
    const hasUnclaimedProfile = allProfiles.some(p => !clients.has(p.id));
    if (hasUnclaimedProfile) {
    for (const t of unknownPages) {
      try {
        const knownMatch = null;
        let identified = null;
        let probeFailed = false;
        let pid = null, charName = null, sessionUserId = null, authUser = null, bodyText = '';
        if (!identified) {
          const { sessionId } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true }, undefined, isRealSession ? 4000 : 10000);
          try {
            const r = await send('Runtime.evaluate', {
              expression: `(() => {
                let sUser = null;
                try {
                  const tok = typeof sessionStorage !== 'undefined' && sessionStorage.getItem ? sessionStorage.getItem('aetheria.session') : null;
                  if (tok && tok.split('.').length >= 2) {
                    const p = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
                    if (p && typeof p.userId === 'string') sUser = p.userId.trim();
                  }
                } catch (_) {}
                return {
                  pid: window.__pmProfileId || (typeof sessionStorage !== 'undefined' && sessionStorage.getItem && sessionStorage.getItem('__pmProfileId')) || null,
                  charName: (typeof window.getLiveCharacterData === 'function' && window.getLiveCharacterData() && window.getLiveCharacterData().name) || window.__charName || null,
                  sessionUserId: sUser,
                  authUser: (window.__authConfig && typeof window.__authConfig.username === 'string' && window.__authConfig.username.trim()) || null,
                  bodyText: (typeof document !== 'undefined' && document.body && typeof document.body.innerText === 'string') ? document.body.innerText.slice(0, 1500) : ''
                };
              })()`,
              returnByValue: true
            }, sessionId, isRealSession ? 3000 : 6000);
            if(r.exceptionDetails)throw Error('PROFILE_PROBE_FAILED');
            crashedTargetFailCount.delete(t.targetId);
            const val = r && r.result && r.result.value;
            if (val && typeof val === 'object') {
              pid = val.pid || null;
              charName = val.charName || null;
              sessionUserId = val.sessionUserId || null;
              authUser = val.authUser || null;
              bodyText = String(val.bodyText || '');
            } else if (typeof val === 'string') {
              pid = val;
            }
          } catch (_) {
            probeFailed = true;
            if (!isRealSession) {
              const fails = (crashedTargetFailCount.get(t.targetId) || 0) + 1;
              crashedTargetFailCount.set(t.targetId, fails);
              const lastAt = crashedTargetReloadAt.get(t.targetId) || 0;
              if (fails >= 4 && Date.now() - lastAt > 90000) {
                crashedTargetReloadAt.set(t.targetId, Date.now());
                crashedTargetFailCount.set(t.targetId, 0);
                await send('Page.enable', {}, sessionId, 3000).catch(() => {});
                await send('Page.reload', { ignoreCache: false }, sessionId, 4000).catch(() => send('Page.navigate', { url: gameUrl }, sessionId, 4000).catch(() => {}));
              }
            }
          } finally {
            await send('Target.detachFromTarget', { sessionId }).catch(() => {});
          }
          if (pid && clients.has(pid)) {
            continue;
          }
          identified = pid || allProfiles.find(p => !clients.has(p.id) && knownTargets.get(p.id) === t.targetId)?.id || null;
        }
        if (!identified) {
          const unclaimed = allProfiles.filter(p => !clients.has(p.id) && (!knownTargets.get(p.id) || !surviving.has(knownTargets.get(p.id))));
          const effectiveUser = String(sessionUserId || authUser || '').trim().toLowerCase();
          if (effectiveUser) {
            const allByUser = allProfiles.filter(p => String(p.account || '').trim().toLowerCase() === effectiveUser);
            const byUser = unclaimed.filter(p => String(p.account || '').trim().toLowerCase() === effectiveUser);
            if (byUser.length === 1) {
              identified = byUser[0].id;
            } else if (allByUser.length > 0) {
              continue;
            }
          }
          if (!identified && (charName || bodyText)) {
            const tokens = new Set(bodyText.split(/[\r\n\s·•]+/).filter(Boolean));
            const matchesChar = p => {
              const cn = String(p.lastCharName || '').trim();
              if (!cn) return false;
              return charName === cn || tokens.has(cn) || bodyText.includes(cn) || bodyText.includes('เข้าเกมด้วย ' + cn);
            };
            const allByChar = allProfiles.filter(matchesChar);
            const byChar = unclaimed.filter(matchesChar);
            if (byChar.length === 1) {
              identified = byChar[0].id;
            } else if (allByChar.length > 0) {
              continue;
            }
          }
          if (!identified && allProfiles.length <= 1 && unattachedPages.length === 1 && unclaimed.length === 1) {
            identified = unclaimed[0].id;
          }
        }
        if (identified && stoppedProfiles.has(identified) && (knownMatch || sessionUserId || charName || pid)) {
          stoppedProfiles.delete(identified);
        }
        const profile = identified && !stoppedProfiles.has(identified) && allProfiles.find(p => p.id === identified);
        const isCustomCtx = Boolean(t.browserContextId && customContexts.has(t.browserContextId));
        if (profile) {
          if (screenProxy && (screenProxy.isEnabled() || isCustomCtx)) {
            const pTask = screenProxy.isEnabled()
              ? screenProxy.acquireForProfile(profile.id, { debugPort: profile.debugPort }).catch(() => {})
              : (typeof screenProxy.ensureProfileTunnel === 'function' ? screenProxy.ensureProfileTunnel(profile.id, profile.debugPort).catch(() => {}) : Promise.resolve());
            if (!knownMatch) await pTask;
          }
          const c = await attach(profile.id, t.targetId, Boolean(knownMatch || probeFailed), isCustomCtx ? t.browserContextId : null, Boolean(knownMatch));
          startProxy(c, profile.debugPort);
          newlyAttached.push({ c, fast: Boolean(knownMatch) });
        }
      } catch (e) {}
    }
    }
    // Phase 2: initialize session hooks & bot health in small batches AFTER all proxy ports are open
    const toCheck = [];
    for (const item of newlyAttached) {
      toCheck.push(item);
    }
    for (const c of clients.values()) {
      if (newlyAttached.some(x => x.c === c)) continue;
      const diag = diagnostics.get(c.profileId);
      if (!isRealSession || !diag || diag.state !== 'ready') {
        toCheck.push({ c, fast: false });
      }
    }
    if (toCheck.length > 0) {
      if (!isRealSession) {
        let idx = 0;
        const worker = async () => {
          while (idx < toCheck.length) {
            const cur = toCheck[idx++];
            if (!cur || !cur.c || clients.get(cur.c.profileId) !== cur.c) continue;
            try {
              if (cur.fast) {
                await Promise.all([
                  send('Page.enable', {}, cur.c.sessionId, 2500).catch(() => {}),
                  configureSessionAssetCache(cur.c.sessionId)
                ]);
              }
              await injectBot(cur.c).catch(() => {});
            } finally {
              cur.c.initialHealthChecked = true;
            }
          }
        };
        const concurrency = Math.min(3, toCheck.length);
        Promise.all(Array.from({ length: concurrency }, () => worker())).catch(() => {});
      } else if (!phase2Running) {
        phase2Running = true;
        (async () => {
          const needsInject = [];
          const slowTabs = [];
          const readyTabs = [];
          try {
            // Step 2A: Fast health sweep across all tabs BEFORE any 1.5 MB bot injection runs
            let idx = 0;
            const healthWorker = async () => {
              while (idx < toCheck.length) {
                const cur = toCheck[idx++];
                if (!cur || !cur.c || clients.get(cur.c.profileId) !== cur.c || stoppedProfiles.has(cur.c.profileId)) continue;
                try {
                  const h = await health(cur.c, 3000);
                  if (h && h.profileId && h.profileId !== cur.c.profileId) {
                    if (knownTargets.get(cur.c.profileId) === cur.c.targetId) {
                      knownTargets.delete(cur.c.profileId);
                      saveKnownTargets();
                    }
                    drop(cur.c);
                    continue;
                  }
                  if (h && h.profileId === cur.c.profileId && h.version && h.hud && h.liveHook && classify(cur.c, h)) {
                    cur.c.initialHealthChecked = true;
                    readyTabs.push(cur.c);
                  } else {
                    needsInject.push(cur.c);
                  }
                } catch (_) {
                  slowTabs.push(cur.c);
                }
              }
            };
            const sweepConcurrency = Math.min(8, toCheck.length);
            await Promise.all(Array.from({ length: sweepConcurrency }, () => healthWorker()));

            // Step 2B: Sequential heavy bot injection (1 tab at a time), responsive tabs first then slow tabs
            for (const c of needsInject.concat(slowTabs)) {
              if (!c || clients.get(c.profileId) !== c || stoppedProfiles.has(c.profileId)) continue;
              try {
                await injectBot(c).catch(() => {});
              } finally {
                c.initialHealthChecked = true;
              }
              await new Promise(r => setTimeout(r, 250));
            }

            // Step 2C: Gently ensure Page.enable + initScriptId on ready tabs one at a time in background
            for (const c of readyTabs) {
              if (!c || clients.get(c.profileId) !== c || stoppedProfiles.has(c.profileId)) continue;
              if (!c.initScriptId) {
                await ensureSessionHooks(c.sessionId, c.profileId, c).catch(() => {});
                await new Promise(r => setTimeout(r, 350));
              }
            }
          } finally {
            for (const cur of toCheck) {
              if (cur && cur.c) cur.c.initialHealthChecked = true;
            }
            phase2Running = false;
          }
        })().catch(() => { phase2Running = false; });
      }
    }
  }

  let phase2Running = false;

  // ---------- per-profile HTTP API (same as the Electron loader's) ----------
  const MAX_CONCURRENT_CDP_EVALS = 10;
  let activeCdpEvals = 0;
  const cdpEvalWaiters = [];
  function acquireCdpEvalSlot(timeoutMs = 10000) {
    if (!isRealSession) return Promise.resolve(() => {});
    return new Promise((resolve, reject) => {
      let waiterEntry = null;
      let queueTimer = null;
      const grant = () => {
        if (queueTimer) { clearTimeout(queueTimer); queueTimer = null; }
        activeCdpEvals++;
        let released = false;
        const holdLimit = Math.min(Math.max((Number(timeoutMs) || 10000) + 1000, 6000), 28000);
        let safetyTimer = setTimeout(() => release(), holdLimit);
        safetyTimer.unref?.();
        function release() {
          if (released) return;
          released = true;
          clearTimeout(safetyTimer);
          activeCdpEvals = Math.max(0, activeCdpEvals - 1);
          while (cdpEvalWaiters.length > 0 && activeCdpEvals < MAX_CONCURRENT_CDP_EVALS) {
            const next = cdpEvalWaiters.shift();
            if (next && !next.cancelled) {
              next.grant();
              break;
            }
          }
        }
        resolve(release);
      };
      if (activeCdpEvals < MAX_CONCURRENT_CDP_EVALS) {
        grant();
      } else {
        waiterEntry = { grant, cancelled: false };
        cdpEvalWaiters.push(waiterEntry);
        const maxQueueWait = Math.min(Math.max(Number(timeoutMs) || 8000, 3000), 8000);
        queueTimer = setTimeout(() => {
          queueTimer = null;
          if (waiterEntry && !waiterEntry.cancelled) {
            waiterEntry.cancelled = true;
            const idx = cdpEvalWaiters.indexOf(waiterEntry);
            if (idx !== -1) cdpEvalWaiters.splice(idx, 1);
            reject(new Error('CDP eval queue busy'));
          }
        }, maxQueueWait);
        queueTimer.unref?.();
      }
    });
  }

  function acquireClientEvalLock(c, timeoutMs = 10000) {
    if (!isRealSession || !c || !c.profileId) return Promise.resolve(() => {});
    if (!c.evalWaiters) c.evalWaiters = [];
    if ((c.evalInFlightCount || 0) >= 1 && c.evalWaiters.length >= 10) {
      return Promise.reject(new Error('CDP client busy'));
    }
    return new Promise((resolve, reject) => {
      let waiterEntry = null;
      let waitTimer = null;
      const grant = () => {
        if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
        c.evalInFlightCount = (c.evalInFlightCount || 0) + 1;
        let released = false;
        function release() {
          if (released) return;
          released = true;
          c.evalInFlightCount = Math.max(0, (c.evalInFlightCount || 1) - 1);
          while (c.evalWaiters && c.evalWaiters.length > 0 && c.evalInFlightCount < 1) {
            const next = c.evalWaiters.shift();
            if (next && !next.cancelled) {
              next.grant();
              break;
            }
          }
        }
        resolve(release);
      };
      if ((c.evalInFlightCount || 0) < 1) {
        grant();
      } else {
        waiterEntry = { grant, cancelled: false };
        c.evalWaiters.push(waiterEntry);
        const maxWait = Math.min(Math.max(Number(timeoutMs) || 8000, 3000), 8000);
        waitTimer = setTimeout(() => {
          waitTimer = null;
          if (waiterEntry && !waiterEntry.cancelled) {
            waiterEntry.cancelled = true;
            const idx = c.evalWaiters.indexOf(waiterEntry);
            if (idx !== -1) c.evalWaiters.splice(idx, 1);
            reject(new Error('CDP client queue timeout'));
          }
        }, maxWait);
        waitTimer.unref?.();
      }
    });
  }

  async function runSingleClientEval(c, code, timeoutMs, isInternal = false) {
    const releaseClient = isInternal ? () => {} : await acquireClientEvalLock(c, timeoutMs);
    let releaseGlobal = null;
    try {
      releaseGlobal = isInternal ? () => {} : await acquireCdpEvalSlot(timeoutMs);
      const r = await send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true }, c.sessionId, timeoutMs);
      if (isRealSession && c && c.profileId) {
        c.evalTimeouts = 0;
        c.evalCooldownUntil = 0;
        c.probeFailCount = 0;
      }
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || 'Script failed');
      return r.result ? r.result.value : undefined;
    } catch (err) {
      if (isRealSession && c && c.profileId && /CDP timeout:\s*Runtime\.evaluate/i.test(String(err && err.message || err))) {
        c.evalTimeouts = (c.evalTimeouts || 0) + 1;
        c.evalCooldownUntil = Date.now() + Math.min(8000, 2500 * c.evalTimeouts);
      }
      throw err;
    } finally {
      if (releaseGlobal) releaseGlobal();
      releaseClient();
    }
  }

  async function evaluate(c, code, timeoutMs = 20000, isInternal = false) {
    const effectiveTimeout = isRealSession ? Math.min(Number(timeoutMs) || 10000, code && code.length > 20000 ? 25000 : 12000) : timeoutMs;
    if (isRealSession && !isInternal && c && c.inFlightEvals && typeof code === 'string' && code.length < 4096) {
      const existing = c.inFlightEvals.get(code);
      if (existing) return existing;
      const p = runSingleClientEval(c, code, effectiveTimeout, false).finally(() => {
        c.inFlightEvals.delete(code);
      });
      c.inFlightEvals.set(code, p);
      return p;
    }
    return runSingleClientEval(c, code, effectiveTimeout, isInternal);
  }
  async function windowAction(c, action, q) {
    const { windowId } = await send('Browser.getWindowForTarget', { targetId: c.targetId });
    const set = bounds => send('Browser.setWindowBounds', { windowId, bounds });
    if (action === 'hide' || action === 'zero-render-on') {
      await set({ windowState: 'normal' }).catch(() => {});
      await evaluate(c, `typeof window.setZeroRenderMode === 'function' ? window.setZeroRenderMode(true) : (typeof window.setLowPowerMode === 'function' && window.setLowPowerMode(true))`, 4500).catch(() => {});
    } else if (action === 'minimize') {
      await set({ windowState: 'minimized' }).catch(() => {});
    } else if (action === 'show' || action === 'restore' || action === 'top' || action === 'focus' || action === 'zero-render-off') {
      await set({ windowState: 'normal' }).catch(() => {});
      if (action === 'top' || action === 'focus') await send('Target.activateTarget', { targetId: c.targetId });
      await evaluate(c, `typeof window.setZeroRenderMode === 'function' ? window.setZeroRenderMode(false) : (typeof window.setLowPowerMode === 'function' && window.setLowPowerMode(false))`, 4500).catch(() => {});
    } else if (action === 'set-bounds') {
      await set({ windowState: 'normal' });
      await set({ left: Number(q.get('x')) || 0, top: Number(q.get('y')) || 0, width: Number(q.get('w')) || 640, height: Number(q.get('h')) || 520 });
    }
  }
  function startProxy(c, port) {
    if (c.server) return;
    c.port = port;
    c.server = http.createServer(async (req, res) => {
      req.setEncoding('utf8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.writeHead(204);
        res.end();
        return;
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/__pm_bootstrap.js') {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.writeHead(200);
        res.end(c.pendingBootstrapScript || 'void 0;');
        return;
      }
      const reply = (status, obj) => { res.writeHead(status); res.end(JSON.stringify(obj)); };
      try {
        if (url.pathname === '/api/eval') {
          let code = url.searchParams.get('code');
          if (req.method === 'POST') {
            let body = '';
            for await (const chunk of req) body += chunk;
            try { code = JSON.parse(body).code || body; } catch (e) { code = body; }
          }
          if (!code) return reply(400, { error: 'Missing code' });
          const isLiveStateProbe = code.includes('__getClientLiveState') && code.includes('grossZenyGained');
          const isBootstrapAccept = isRealSession && code.includes('__pmScriptBootstrap.accept(');
          const isReadyClient = diagnostics.get(c.profileId)?.state === 'ready';
          if (isRealSession && !isBootstrapAccept && ((!c.initialHealthChecked && !isReadyClient) || (!isReadyClient && heavyInjectionInFlightCount > 0) || (c.evalCooldownUntil && Date.now() < c.evalCooldownUntil))) {
            if (isLiveStateProbe && c.lastGoodState && (Date.now() - (c.lastGoodStateAt || 0) < 180000)) {
              return reply(200, { success: true, result: c.lastGoodState, cached: true });
            }
            return reply(503, { success: false, error: !c.initialHealthChecked ? 'Client initializing' : 'Client in timeout cooldown' });
          }
          try {
            let evalRes;
            if (isLiveStateProbe) {
              if (isRealSession && c.lastGoodState && (Date.now() - (c.lastGoodStateAt || 0) < 1800)) {
                return reply(200, { success: true, result: c.lastGoodState, cached: true });
              }
              if (!c.liveStateEvalPromise) {
                c.liveStateEvalPromise = evaluate(c, code, 8000).finally(() => {
                  c.liveStateEvalPromise = null;
                });
              }
              evalRes = await c.liveStateEvalPromise;
              c.stateFailCount = 0;
              c.firstStateFailAt = 0;
              if (evalRes && typeof evalRes === 'object') {
                c.lastGoodState = evalRes;
                c.lastGoodStateAt = Date.now();
                ensureClientFramePacerHealed(c).catch(() => {});
                if (Date.now() - (c.lastStorageSyncAt || 0) > 60000) {
                  c.lastStorageSyncAt = Date.now();
                  syncClientStorage(c).catch(() => {});
                }
              }
            } else if (isRealSession && code.includes('__pmScriptBootstrap.accept(')) {
              if (diagnostics.get(c.profileId)?.state === 'ready') {
                return reply(200, { success: true, result: { success: true, cached: true } });
              }
              if (c.injectionInFlightPromise) {
                await c.injectionInFlightPromise.catch(() => {});
                if (diagnostics.get(c.profileId)?.state === 'ready') {
                  return reply(200, { success: true, result: { success: true } });
                }
              }
              await injectBot(c).catch(() => {});
              if (diagnostics.get(c.profileId)?.state === 'ready') {
                return reply(200, { success: true, result: { success: true } });
              }
              return reply(503, { success: false, error: 'Bot injection pending' });
            } else {
              evalRes = await evaluate(c, code, 8000);
              if (!code.includes('pelican_embedded_human_check_cfg') && /applyScriptPlan|applyPelicanSettings|importAllBotSettings|setItem\s*\(\s*['"]pelican_/.test(code)) {
                if (!isRealSession || Date.now() - (c.lastStorageSyncAt || 0) > 15000) {
                  c.lastStorageSyncAt = Date.now();
                  syncClientStorage(c, true).catch(() => {});
                }
              }
            }
            return reply(200, { success: true, result: evalRes });
          } catch (e) {
            if (isGoneError(e)) { drop(c); return reply(500, { success: false, error: e.message }); }
            if (isLiveStateProbe) {
              const now = Date.now();
              if (!c.firstStateFailAt) c.firstStateFailAt = now;
              c.stateFailCount = (c.stateFailCount || 0) + 1;
              if (c.stateFailCount >= 30 && (now - c.firstStateFailAt) >= 240000) {
                reloadCrashedClient(c, 'state-probe-timeout').catch(() => {});
              }
              if (c.lastGoodState && (now - (c.lastGoodStateAt || 0)) < 180000) {
                return reply(200, { success: true, result: c.lastGoodState, cached: true });
              }
            }
            return reply(500, { success: false, error: e.message });
          }
        }
        if (url.pathname === '/api/state') {
          const isReadyStateClient = diagnostics.get(c.profileId)?.state === 'ready';
          if (isRealSession && ((!c.initialHealthChecked && !isReadyStateClient) || (!isReadyStateClient && heavyInjectionInFlightCount > 0) || (c.evalCooldownUntil && Date.now() < c.evalCooldownUntil))) {
            if (c.lastGoodState && (Date.now() - (c.lastGoodStateAt || 0) < 180000)) {
              return reply(200, c.lastGoodState);
            }
            return reply(503, { success: false, error: !c.initialHealthChecked ? 'Client initializing' : 'Client in timeout cooldown' });
          }
          try {
            if (isRealSession && c.lastGoodState && (Date.now() - (c.lastGoodStateAt || 0) < 1800)) {
              return reply(200, c.lastGoodState);
            }
            if (!c.stateEvalPromise) {
              c.stateEvalPromise = evaluate(c, `typeof window.__getClientLiveState === 'function' ? window.__getClientLiveState() : null`, 8000).finally(() => {
                c.stateEvalPromise = null;
              });
            }
            const st = await c.stateEvalPromise;
            c.stateFailCount = 0;
            c.firstStateFailAt = 0;
            if (st) {
              c.lastGoodState = st;
              c.lastGoodStateAt = Date.now();
              ensureClientFramePacerHealed(c).catch(() => {});
            }
            if (st === null && !c.injectionInFlight && !c.retryTimer) {
              injectBot(c).catch(() => {});
            } else if (st && Date.now() - (c.lastStorageSyncAt || 0) > 60000) {
              c.lastStorageSyncAt = Date.now();
              syncClientStorage(c).catch(() => {});
            }
            return reply(200, st);
          } catch (e) {
            if (isGoneError(e)) { drop(c); return reply(500, { success: false, error: e.message }); }
            const now = Date.now();
            if (!c.firstStateFailAt) c.firstStateFailAt = now;
            c.stateFailCount = (c.stateFailCount || 0) + 1;
            if (c.stateFailCount >= 30 && (now - c.firstStateFailAt) >= 240000) {
              reloadCrashedClient(c, 'state-probe-timeout').catch(() => {});
            }
            if (c.lastGoodState && (now - (c.lastGoodStateAt || 0)) < 180000) {
              return reply(200, c.lastGoodState);
            }
            return reply(500, { success: false, error: e.message });
          }
        }
        if(url.pathname==='/api/browser-status')return reply(200,{success:true,profileId:c.profileId,deviceId:ensureProfileDeviceId(c.profileId),browserContextId:c.browserContextId||null,...diagnostics.get(c.profileId)});
        if (url.pathname === '/api/window') {
          await windowAction(c, url.searchParams.get('action'), url.searchParams);
          return reply(200, { success: true });
        }
        reply(200, { name: 'PmheeAether browser-mode client', profileId: c.profileId, endpoints: ['/api/eval', '/api/state', '/api/window'] });
      } catch (e) {
        if (isGoneError(e)) drop(c);
        reply(500, { success: false, error: e.message });
      }
    });
    c.server.on('error', e => console.warn(`[BrowserMode] port ${port}: ${e.message}`));
    const old = portServers.get(port);
    if (old) { try { old.close(); old.closeAllConnections && old.closeAllConnections(); } catch (e) {} }
    portServers.set(port, c.server);
    c.server.listen(port, '127.0.0.1');
  }
  function stopProxy(c) {
    if (c && c.server) {
      try { c.server.close(); c.server.closeAllConnections && c.server.closeAllConnections(); } catch (e) {}
      if (portServers.get(c.port) === c.server) portServers.delete(c.port);
      c.server = null;
    }
  }

  // ---------- public ----------
  async function launch(profile) {
    try {
      return await launchOnce(profile, false);
    } catch (e) {
      if (isGoneError(e) || /CDP connect|CDP timeout|CDP not available|เปิดเบราว์เซอร์ไม่สำเร็จ/i.test(String(e && e.message || e))) {
        if (ws) { try { ws.close(); } catch (_) {} ws = null; }
        await new Promise(r => setTimeout(r, 400));
        return await launchOnce(profile, clients.size === 0);
      }
      throw e;
    }
  }

  async function launchOnce(profile, forceCleanBrowser = false) {
    stoppedProfiles.delete(profile.id);
    await ensureBrowser(forceCleanBrowser);
    const wasReady = diagnostics.get(profile.id)?.botReady === true;
    await rediscover();
    let existing = clients.get(profile.id);
    if (!existing) {
      const { targetInfos } = await send('Target.getTargets');
      const customContexts = await getCustomBrowserContexts();
      const allProfiles = (typeof loadProfiles === 'function' ? loadProfiles() : []) || [];
      const knownTargetId = knownTargets.get(profile.id);
      const claimedTargets = new Set([...Array.from(clients.values()).map(c => c.targetId), ...Array.from(knownTargets.entries()).filter(([k]) => k !== profile.id).map(([, v]) => v)]);
      const orphans = targetInfos.filter(t => t.type === 'page' && isGameUrl(t.url) && !claimedTargets.has(t.targetId));
      const matchedOrphan = orphans.find(t => knownTargetId && t.targetId === knownTargetId) ||
        ((allProfiles.length <= 1 && orphans.length === 1 && clients.size === 0) ? orphans[0] : null);
      if (matchedOrphan) {
        try {
          const orphanCtx = (matchedOrphan.browserContextId && customContexts.has(matchedOrphan.browserContextId)) ? matchedOrphan.browserContextId : null;
          existing = await attach(profile.id, matchedOrphan.targetId, true, orphanCtx);
        } catch (_) {}
      }
    }
    if (existing) {
      const { targetInfos } = await send('Target.getTargets');
      if (targetInfos.some(t => t.targetId === existing.targetId)) {
        if (screenProxy && screenProxy.isEnabled()) {
          await screenProxy.acquireForProfile(profile.id, { debugPort: profile.debugPort }).catch(() => {});
        }
        startProxy(existing, profile.debugPort);
        let h = null, reloaded = false;
        try { h = await health(existing); } catch (_) {}
        if (!h) {
          reloaded = await reloadCrashedClient(existing, 'launch-recover', true);
          try { h = await health(existing); } catch (_) {}
        }
        if (h && (!h.version || !h.hud)) {
          try {
            await injectBot(existing);
            h = await health(existing).catch(() => null);
          } catch (_) {}
        }
        const isReady = !!(h && h.version && h.hud);
        const recovered = (!wasReady && isReady) || reloaded;
        await windowAction(existing, 'focus', new URLSearchParams()).catch(() => {});
        return {
          success: true,
          message: reloaded ? 'รีเฟรชกู้คืนจอที่ค้างสำเร็จ' : (recovered ? 'กู้คืนและเชื่อมต่อจอเดิมสำเร็จ' : 'หน้าต่างนี้เปิดอยู่แล้ว'),
          alreadyOpen: true,
          recovered
        };
      }
      drop(existing);
    }
    await migrateProfileStorageFromDefaultContext(profile.id);
    let browserContextId = null;
    let tunnelInfo = null;
    if (screenProxy && screenProxy.isEnabled()) {
      try {
        tunnelInfo = await screenProxy.acquireForProfile(profile.id, { debugPort: profile.debugPort });
        if (tunnelInfo && tunnelInfo.proxyServerUrl) {
          const ctxRes = await send('Target.createBrowserContext', {
            disposeOnDetach: false,
            proxyServer: tunnelInfo.proxyServerUrl,
            proxyBypassList: 'localhost,127.0.0.1'
          });
          browserContextId = ctxRes?.browserContextId || null;
        }
      } catch (e) {
        console.warn(`[BrowserMode] createBrowserContext proxy failed for ${profile.id}: ${e.message}`);
      }
    }
    const createParams = browserContextId
      ? { url: 'about:blank', newWindow: true, browserContextId }
      : { url: 'about:blank', newWindow: true };
    const { targetId } = await send('Target.createTarget', createParams);
    const c = await attach(profile.id, targetId, true, browserContextId);
    c.initialHealthChecked = true;
    startProxy(c, profile.debugPort);
    await send('Page.navigate', { url: gameUrl }, c.sessionId);
    for (const targetId of startupPages.splice(0)) await send('Target.closeTarget', { targetId }).catch(() => {});
    const proxyTag = tunnelInfo?.lease?.proxyHost ? ` (IP: ${tunnelInfo.lease.proxyHost} [${tunnelInfo.lease.slot || 1}/${tunnelInfo.lease.maxSlots || 3}])` : '';
    return { success: true, message: `เปิดหน้าต่างเบราว์เซอร์แล้ว${proxyTag}` };
  }
  async function stop(profileId) {
    stoppedProfiles.add(profileId);
    const c = clients.get(profileId);
    if (c) await syncClientStorage(c).catch(() => {});
    const targetId=c?.targetId||knownTargets.get(profileId);knownTargets.delete(profileId);saveKnownTargets();
    const oldCtxId = c?.browserContextId || null;
    diagnostics.set(profileId,{gameAlive:null,botReady:false,state:'explicitly-stopped'});
    if (screenProxy) await screenProxy.releaseProfile(profileId, 'stopped').catch(() => {});
    if (!targetId) return false;
    if(c)drop(c);
    await connect().then(async () => {
      await send('Target.closeTarget', { targetId }).catch(() => {});
      if (oldCtxId) await send('Target.disposeBrowserContext', { browserContextId: oldCtxId }).catch(() => {});
    }).catch(() => {});
    return true;
  }
  const isOpen = profileId => clients.has(profileId);

  async function applyProxyModeToOpenWindows({ onlyProfileIds } = {}) {
    if (!screenProxy) return { switched: 0, updatedTunnels: 0, details: [] };
    await connect().catch(() => {});
    const customContexts = await getCustomBrowserContexts();
    const allProfiles = loadProfiles() || [];
    const filterSet = Array.isArray(onlyProfileIds) && onlyProfileIds.length > 0 ? new Set(onlyProfileIds) : null;
    let switched = 0;
    let updatedTunnels = 0;
    const details = [];

    for (const c of Array.from(clients.values())) {
      if (filterSet && !filterSet.has(c.profileId)) continue;
      if (c.browserContextId && !customContexts.has(c.browserContextId)) c.browserContextId = null;
      const profile = allProfiles.find(p => p.id === c.profileId) || { id: c.profileId, debugPort: c.port };
      await syncClientStorage(c).catch(() => {});
      if (!screenProxy.isEnabled()) {
        await screenProxy.releaseProfile(c.profileId, 'disabled').catch(() => {});
        updatedTunnels++;
        details.push({ profileId: c.profileId, action: 'direct-tunnel' });
        continue;
      }
      const tunnelInfo = await screenProxy.acquireForProfile(c.profileId, { debugPort: profile.debugPort });
      if (c.browserContextId && customContexts.has(c.browserContextId)) {
        // Already running in a proxy-enabled BrowserContext pointing to 127.0.0.1:<tunnelPort>
        updatedTunnels++;
        details.push({ profileId: c.profileId, action: 'tunnel-updated', proxyHost: tunnelInfo?.lease?.proxyHost || null });
        continue;
      }
      // Migrate from default context to isolated proxy BrowserContext while preserving window bounds
      if (tunnelInfo && tunnelInfo.proxyServerUrl) {
        try {
          let savedBounds = null;
          let savedCookies = [];
          try {
            const winInfo = await send('Browser.getWindowForTarget', { targetId: c.targetId });
            if (winInfo && winInfo.bounds) savedBounds = winInfo.bounds;
          } catch (_) {}
          try {
            const cookieRes = await send('Network.getCookies', { urls: [gameUrl] }, c.sessionId, 3000);
            if (Array.isArray(cookieRes?.cookies)) savedCookies = cookieRes.cookies;
          } catch (_) {}
          const ctxRes = await send('Target.createBrowserContext', {
            disposeOnDetach: false,
            proxyServer: tunnelInfo.proxyServerUrl,
            proxyBypassList: 'localhost,127.0.0.1'
          });
          const browserContextId = ctxRes?.browserContextId || null;
          if (browserContextId) {
            if (savedCookies.length > 0) {
              await send('Storage.setCookies', { cookies: savedCookies, browserContextId }, undefined, 3000).catch(() => {});
            }
            const oldTargetId = c.targetId;
            const { targetId: newTargetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true, browserContextId });
            drop(c);
            const newClient = await attach(profile.id, newTargetId, false, browserContextId);
            startProxy(newClient, profile.debugPort);
            if (savedBounds) {
              try {
                const { windowId: newWinId } = await send('Browser.getWindowForTarget', { targetId: newTargetId });
                await send('Browser.setWindowBounds', { windowId: newWinId, bounds: { windowState: 'normal' } }).catch(() => {});
                await send('Browser.setWindowBounds', {
                  windowId: newWinId,
                  bounds: {
                    left: savedBounds.left,
                    top: savedBounds.top,
                    width: savedBounds.width,
                    height: savedBounds.height
                  }
                }).catch(() => {});
              } catch (_) {}
            }
            await send('Page.navigate', { url: gameUrl }, newClient.sessionId);
            await send('Target.closeTarget', { targetId: oldTargetId }).catch(() => {});
            switched++;
            details.push({ profileId: c.profileId, action: 'recreated-with-proxy', proxyHost: tunnelInfo?.lease?.proxyHost || null });
          }
        } catch (e) {
          details.push({ profileId: c.profileId, action: 'error', error: e.message });
        }
      }
    }
    return { switched, updatedTunnels, details };
  }

  async function syncAssetCacheToOpenWindows() {
    if (!effectiveAssetCache) return { synced: 0 };
    const enabled = effectiveAssetCache.isEnabled();
    let synced = 0;
    for (const c of Array.from(clients.values())) {
      if (!c.sessionId) continue;
      try {
        await configureSessionAssetCache(c.sessionId);
        await evaluate(c, `window.__pmLocalAssetCacheEnabled = ${Boolean(enabled)};`, 2500).catch(() => {});
        synced++;
      } catch (_) {}
    }
    return { synced, enabled };
  }

  let levelDbHarvestPromise = null;
  async function harvestAllFromBrowserLevelDb() {
    if (!storageDir) return { harvestedProfiles: 0, totalKeys: 0 };
    if (levelDbHarvestPromise) return levelDbHarvestPromise;
    levelDbHarvestPromise = (async () => {
      let targetId = null;
      const byProfile = {};
      let totalKeys = 0;
      try {
        const levelDbDir = path.join(userDataDir, 'Default', 'Local Storage', 'leveldb');
        if (!fs.existsSync(levelDbDir)) return { harvestedProfiles: 0, totalKeys: 0 };
        const diskHarvest = extractPelicanStorageFromLevelDb(levelDbDir);
        if (diskHarvest && diskHarvest.byProfile) {
          for (const [pid, map] of Object.entries(diskHarvest.byProfile)) {
            if (!byProfile[pid]) byProfile[pid] = {};
            for (const [k, v] of Object.entries(map)) {
              if (k.endsWith('__auth_cfg') && byProfile[pid][k]) {
                byProfile[pid][k] = mergeAuthConfigString(byProfile[pid][k], v);
              } else {
                byProfile[pid][k] = v;
              }
              totalKeys++;
            }
          }
          for (const [pid, map] of Object.entries(byProfile)) {
            saveProfileStorage(pid, map);
          }
        }
        const donor = Array.from(clients.values()).find(x => !x.browserContextId && x.sessionId) || Array.from(clients.values()).find(x => x.sessionId);
        if (donor) {
          try {
            const origin = new URL(gameUrl).origin;
            const allKeys = await evaluate(donor, `(() => {
              if (!window.location || window.location.origin !== ${JSON.stringify(origin)} || !window.localStorage) return null;
              const out = {};
              for (let i = 0; i < window.localStorage.length; i++) {
                const k = window.localStorage.key(i);
                if (!k || !k.startsWith('pelican_')) continue;
                const v = window.localStorage[k];
                if (typeof v === 'string') out[k] = v;
              }
              return out;
            })()`, 4000);
            if (allKeys && typeof allKeys === 'object') {
              for (const [k, v] of Object.entries(allKeys)) {
                if (typeof v !== 'string') continue;
                const m = k.match(/^pelican_(profile_[a-zA-Z0-9_]+)__/);
                if (m && m[1]) {
                  if (!byProfile[m[1]]) byProfile[m[1]] = {};
                  if (k.endsWith('__auth_cfg') && byProfile[m[1]][k]) {
                    byProfile[m[1]][k] = mergeAuthConfigString(byProfile[m[1]][k], v);
                  } else {
                    byProfile[m[1]][k] = v;
                  }
                  totalKeys++;
                }
              }
              for (const [pid, map] of Object.entries(byProfile)) {
                saveProfileStorage(pid, map);
              }
            }
          } catch (_) {}
        }
        return { harvestedProfiles: Object.keys(byProfile).length, totalKeys };
      } catch (_) {
        return { harvestedProfiles: Object.keys(byProfile).length, totalKeys };
      } finally {
        if (targetId) await send('Target.closeTarget', { targetId }, undefined, 3000).catch(() => {});
        levelDbHarvestPromise = null;
      }
    })();
    return levelDbHarvestPromise;
  }

  function start() {
    if(started)return;started=true;
    try {
      initDeviceIdsFromStorage();
      const all = typeof loadProfiles === 'function' ? (loadProfiles() || []) : [];
      for (const p of all) {
        if (p && p.id) ensureProfileDeviceId(p.id);
      }
    } catch (_) {}
    // reconnect to a browser left open by a previous Manager run
    setTimeout(() => {if(started)rediscover().catch(() => {});}, 3000);
    monitorTimer=setInterval(()=>{
      const now = Date.now();
      let syncedCount = 0;
      for (const c of clients.values()) {
        if (!c.stateEvalPromise && !c.injectionInFlight && (now - (c.lastStorageSyncAt || 0) > 60000)) {
          c.lastStorageSyncAt = now;
          syncClientStorage(c).catch(() => {});
          if (++syncedCount >= 4) break;
        }
      }
      rediscover().catch(()=>scheduleReconnect());
    },15000);monitorTimer.unref?.();
  }

  function dispose(){
    started=false;clearTimeout(reconnectTimer);reconnectTimer=null;clearInterval(monitorTimer);monitorTimer=null;
    for(const c of [...clients.values()]){stoppedProfiles.add(c.profileId);clearTimeout(c.retryTimer);drop(c);}
    if(ws){const socket=ws;ws=null;socket.close();}
    for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error('BROWSER_MODE_DISPOSED'));}pending.clear();
  }
  return { launch, stop, isOpen, start, dispose, findBrowser, rebalanceDeviceGroups, ensureProfileDeviceId, ensureProfileMachineId, ensureProfileDeviceGroupIndex, getDeviceGroupsSnapshot, rotateDeviceGroup, rotateProfileDeviceId, rotateAllDeviceIds, applyProxyModeToOpenWindows, syncAssetCacheToOpenWindows, harvestAllFromBrowserLevelDb, status:()=>Object.fromEntries(diagnostics) };
}

module.exports = { createBrowserMode, findBrowser, HEALTH_JS, MAX_SCREENS_PER_DEVICE, extractPelicanStorageFromLevelDb, mergeAuthConfigString, mergeSellConfigString };
