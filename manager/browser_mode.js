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
const { spawn } = require('child_process');

const GAME_URL = 'https://www.aetheria-online.in.th/play';
const BOT_URL = 'https://raw.githubusercontent.com/thegopza/aetheria-pelican-bot/main/bot.js';
const DEFAULT_CDP_PORT = 9339;
const HEALTH_JS = `(() => {
  const bs = window.__pmScriptBootstrap?.status?.() || null;
  return {
    href: location.href,
    documentId: String(performance.timeOrigin),
    ready: document.readyState,
    profileId: window.__pmProfileId || (typeof sessionStorage !== 'undefined' && sessionStorage.getItem && sessionStorage.getItem('__pmProfileId')) || null,
    version: window.__pelicanBotVersion || null,
    hud: !!document.getElementById('pelican-hud'),
    liveHook: typeof window.__getClientLiveState === 'function',
    bootstrapPhase: bs?.phase || null,
    initialized: !!window.__pmPayloadInitialized || (bs && bs.phase !== 'waiting') || !!window.__pmBrowserInjectionAttempted || ('__isBotRunning' in window) || typeof window.startMasterBot === 'function' || typeof window.startAutoLoop === 'function'
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

function mergeAuthConfigString(existingRaw, incomingRaw) {
  if (!existingRaw) return incomingRaw;
  if (!incomingRaw) return existingRaw;
  try {
    const a = JSON.parse(existingRaw);
    const b = JSON.parse(incomingRaw);
    if (!a || typeof a !== 'object') return incomingRaw;
    if (!b || typeof b !== 'object') return existingRaw;
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
  let totalKeys = 0;
  if (!levelDbDir || !fs.existsSync(levelDbDir)) return { byProfile, unprefixed, totalKeys };
  const recordEntry = (kStr, vStr) => {
    if (!kStr || typeof vStr !== 'string' || !kStr.startsWith('pelican_')) return;
    const isAuth = kStr.endsWith('__auth_cfg') || kStr === 'pelican_auth_cfg';
    const m = kStr.match(/^pelican_(profile_[a-zA-Z0-9_]+)__/);
    if (m && m[1]) {
      const pid = m[1];
      if (!byProfile[pid]) byProfile[pid] = {};
      if (isAuth && byProfile[pid][kStr]) {
        byProfile[pid][kStr] = mergeAuthConfigString(byProfile[pid][kStr], vStr);
      } else {
        byProfile[pid][kStr] = vStr;
      }
      totalKeys++;
    } else {
      if (isAuth && unprefixed[kStr]) {
        unprefixed[kStr] = mergeAuthConfigString(unprefixed[kStr], vStr);
      } else {
        unprefixed[kStr] = vStr;
      }
      if (fallbackProfileId) {
        if (!byProfile[fallbackProfileId]) byProfile[fallbackProfileId] = {};
        if (isAuth && byProfile[fallbackProfileId][kStr]) {
          byProfile[fallbackProfileId][kStr] = mergeAuthConfigString(byProfile[fallbackProfileId][kStr], vStr);
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
      } catch (_) {}
    }
  } catch (_) {}
  return { byProfile, unprefixed, totalKeys };
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

  function loadProfileStorage(profileId) {
    if (!storageDir || !profileId) return {};
    try {
      const f = path.join(storageDir, `${profileId}.json`);
      if (!fs.existsSync(f)) return {};
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    } catch (_) { return {}; }
  }
  function saveProfileStorage(profileId, entries) {
    if (!storageDir || !profileId || !entries || typeof entries !== 'object') return;
    try {
      fs.mkdirSync(storageDir, { recursive: true });
      const f = path.join(storageDir, `${profileId}.json`);
      const merged = { ...loadProfileStorage(profileId) };
      for (const [k, v] of Object.entries(entries)) {
        if (v === null || v === undefined) continue;
        if ((k.endsWith('__auth_cfg') || k === 'pelican_auth_cfg') && merged[k]) {
          merged[k] = mergeAuthConfigString(merged[k], v);
        } else {
          merged[k] = v;
        }
      }
      fs.writeFileSync(f + '.tmp', JSON.stringify(merged), 'utf8');
      fs.renameSync(f + '.tmp', f);
    } catch (_) {}
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
  async function connect() {
    if (ws && ws.readyState === 1) return;
    if (wsReady) return wsReady;
    wsReady = (async () => {
      const info = JSON.parse(await getText(`http://127.0.0.1:${CDP_PORT}/json/version`, 3000));
      await new Promise((resolve, reject) => {
        const socket = new WebSocket(info.webSocketDebuggerUrl);ws=socket;
        const openingTimeout=setTimeout(()=>{reject(new Error('CDP connect timeout'));try{socket.close();}catch(_){}},3000);
        socket.onopen = () => {clearTimeout(openingTimeout);resolve();};
        socket.onerror = () => {clearTimeout(openingTimeout);reject(new Error('CDP connect failed'));};
        socket.onclose = () => {
          clearTimeout(openingTimeout);reject(new Error('CDP closed'));
          if(ws!==socket)return;ws=null;
          for (const [, p] of pending) {clearTimeout(p.timer);p.reject(new Error('CDP closed'));}pending.clear();
          for(const c of Array.from(clients.values())){diagnostic(c,'transport-disconnected',{gameAlive:null});drop(c);}scheduleReconnect();
        };
        socket.onmessage = ev => {
          if(ws!==socket)return;
          let msg;try{msg=JSON.parse(ev.data);}catch(_){return;}
          if (msg.id && pending.has(msg.id)) {
            const p = pending.get(msg.id); pending.delete(msg.id);clearTimeout(p.timer);
            if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
          } else if (msg.method) {
            listeners.forEach(fn => { try { fn(msg); } catch (e) {} });
          }
        };
      });
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
    try { await getText(`http://127.0.0.1:${CDP_PORT}/json/version`, 1500); return true; } catch (e) { return false; }
  }

  async function ensureBrowser() {
    if (await browserAlive()) return connect();
    const settings = getSettings() || {};
    const exe = findBrowser(settings.browserKind);
    if (!exe) throw new Error('ไม่พบ Google Chrome หรือ Microsoft Edge ในเครื่อง');
    fs.mkdirSync(userDataDir, { recursive: true });
    const args = [
      `--remote-debugging-port=${CDP_PORT}`, '--remote-allow-origins=*',
      `--user-data-dir=${userDataDir}`,
      // the bot's timers must keep running in background / covered windows
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
      // many game windows in one browser: Chrome drops the oldest WebGL context past 16 live ones
      '--max-active-webgl-contexts=64',
      '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank'
    ];
    browserProc = spawn(exe, args, { detached: true, stdio: 'ignore' });
    browserProc.unref();
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 300));
      if (await browserAlive()) {
        await connect();
        try { startupPages = (await send('Target.getTargets')).targetInfos.filter(t => t.type === 'page').map(t => t.targetId); } catch (e) {}
        return;
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
  const profileInitScript = profileId => {
    const saved = loadProfileStorage(profileId);
    const hasSaved = saved && Object.keys(saved).length > 0;
    const restoreJs = hasSaved
      ? `try { const __s = ${JSON.stringify(saved)}; for (const [k, v] of Object.entries(__s)) { if (typeof v !== 'string') continue; if (k.startsWith('__ss:')) { const sk = k.slice(5); if (window.sessionStorage && window.sessionStorage.getItem(sk) === null) window.sessionStorage.setItem(sk, v); } else if (window.localStorage && window.localStorage.getItem(k) === null) { window.localStorage.setItem(k, v); } } } catch (_) {}`
      : '';
    const cacheFlag = Boolean(effectiveAssetCache && effectiveAssetCache.isEnabled());
    return `window.__pmProfileId = ${JSON.stringify(profileId)}; window.__pmLocalAssetCacheEnabled = ${cacheFlag}; try { window.sessionStorage && window.sessionStorage.setItem('__pmProfileId', ${JSON.stringify(profileId)}); } catch (_) {} ${restoreJs}`;
  };

  async function configureSessionAssetCache(sessionId) {
    if (!sessionId || !effectiveAssetCache) return;
    try {
      if (effectiveAssetCache.isEnabled()) {
        await send('Fetch.enable', { patterns: effectiveAssetCache.CDP_ASSET_FETCH_PATTERNS }, sessionId, 4000);
      } else {
        await send('Fetch.disable', {}, sessionId, 3000);
      }
    } catch (_) {}
  }

  let lastSharedHarvestAt = 0;
  async function syncClientStorage(c) {
    if (!c || !c.sessionId || !storageDir) return;
    try {
      const prefix = `pelican_${c.profileId}__`;
      const harvestAll = !c.browserContextId && (Date.now() - lastSharedHarvestAt > 60000);
      if (harvestAll) lastSharedHarvestAt = Date.now();
      const res = await evaluate(c, `(() => {
        const out = {};
        const other = {};
        if (window.localStorage) {
          const pfx = ${JSON.stringify(prefix)};
          const doHarvest = ${Boolean(harvestAll)};
          const extraKeys = new Set(['aetheria.device', 'ui.windows', 'partyFrameFolded', 'skip-anim:refine', 'hudMenuOpen', 'webgame.camera']);
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (!k) continue;
            const rawVal = window.localStorage[k];
            if (typeof rawVal !== 'string') continue;
            if (k.startsWith(pfx) || (k.startsWith('pelican_') && !k.includes('__')) || extraKeys.has(k)) {
              out[k] = rawVal;
            } else if (doHarvest && k.startsWith('pelican_profile_')) {
              const m = k.match(/^pelican_(profile_[a-zA-Z0-9_]+)__/);
              if (m && m[1]) {
                if (!other[m[1]]) other[m[1]] = {};
                other[m[1]][k] = rawVal;
              }
            }
          }
        }
        if (window.sessionStorage) {
          const ssVal = window.sessionStorage.getItem('aetheria.session');
          if (ssVal) out['__ss:aetheria.session'] = ssVal;
        }
        return { out, other };
      })()`, 3000);
      const entries = res && res.out ? res.out : res;
      if (entries && typeof entries === 'object' && Object.keys(entries).length > 0) {
        saveProfileStorage(c.profileId, entries);
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

  async function ensureSessionHooks(sessionId, profileId) {
    await send('Page.enable', {}, sessionId, 5000).catch(() => {});
    await send('Runtime.enable', {}, sessionId, 5000).catch(() => {});
    await configureSessionAssetCache(sessionId);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: profileInitScript(profileId) }, sessionId, 5000).catch(() => {});
  }

  async function health(c) {
    const value=await evaluate(c,HEALTH_JS,4500);
    if(!value || typeof value.documentId!=='string')throw Error('INVALID_DOCUMENT_PROBE');
    if(c.documentId!==value.documentId) {c.documentId=value.documentId;c.generation++;c.attempts=0;clearTimeout(c.retryTimer);c.retryTimer=null;}
    return value;
  }
  const current=(c,token)=>clients.get(c.profileId)===c&&!stoppedProfiles.has(c.profileId)&&c.generation===token.generation&&c.sessionId===token.sessionId;
  function classify(c,h) {
    if(h.version&&h.hud&&h.liveHook){c.crashReloadCount=0;c.stateFailCount=0;diagnostic(c,'ready',{version:h.version,documentId:h.documentId,hud:h.hud,liveHook:h.liveHook});return true;}
    if(h.version||h.hud||h.liveHook||(h.initialized&&h.bootstrapPhase!=='waiting')){c.stateFailCount=0;diagnostic(c,'partial-runtime',{version:h.version,documentId:h.documentId,hud:h.hud,liveHook:h.liveHook});return true;}
    return false;
  }

  async function reloadCrashedClient(c, reason = 'crashed', force = false) {
    if (!c || stoppedProfiles.has(c.profileId) || clients.get(c.profileId) !== c) return false;
    const now = Date.now();
    if (c.crashReloadInFlight) return false;
    if (!force) {
      if ((c.crashReloadCount || 0) >= 3) return false;
      if (now - (c.lastCrashReloadAt || 0) < 20000) return false;
    }
    c.crashReloadInFlight = true;
    c.lastCrashReloadAt = now;
    c.crashReloadCount = (c.crashReloadCount || 0) + 1;
    c.stateFailCount = 0;
    c.generation++;
    c.documentId = null;
    c.attempts = 0;
    clearTimeout(c.retryTimer);
    c.retryTimer = null;
    diagnostic(c, 'crashed-reloading', { reason: String(reason), reloadCount: c.crashReloadCount });
    console.warn(`[BrowserMode] 🔄 จอ ${c.profileId} ค้างหรือแรมเต็ม (${reason}) -> สั่ง Refresh หน้าเกมอัตโนมัติ (ครั้งที่ ${c.crashReloadCount})`);
    const schedulePostReloadInject = () => {
      const t = setTimeout(() => {
        ensureSessionHooks(c.sessionId, c.profileId).finally(() => injectBot(c).catch(() => {}));
      }, 1800);
      t.unref?.();
    };
    try {
      await ensureSessionHooks(c.sessionId, c.profileId);
      await send('Page.reload', { ignoreCache: false }, c.sessionId, 8000);
      schedulePostReloadInject();
      return true;
    } catch (_) {
      try {
        await send('Page.navigate', { url: gameUrl }, c.sessionId, 8000);
        schedulePostReloadInject();
        return true;
      } catch (_) {
        try {
          const { sessionId } = await send('Target.attachToTarget', { targetId: c.targetId, flatten: true }, undefined, 5000);
          c.sessionId = sessionId;
          await ensureSessionHooks(sessionId, c.profileId);
          await send('Page.reload', { ignoreCache: false }, sessionId, 8000).catch(() => send('Page.navigate', { url: gameUrl }, sessionId, 8000));
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

  async function injectBot(c) {
    if(clients.get(c.profileId)!==c||stoppedProfiles.has(c.profileId))return;
    if(c.retryTimer)return;
    if(c.injectionInFlight){c.pendingLoad=true;return;}
    const flight={};c.injectionInFlight=flight;
    let token;
    try {
      const before=await health(c);token={generation:c.generation,sessionId:c.sessionId};
      if(before.profileId!==c.profileId){
        await ensureSessionHooks(c.sessionId,c.profileId);
        await evaluate(c,profileInitScript(c.profileId),4500).catch(()=>{});
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
      if(c.attempts>=3){diagnostic(c,'load-failed',{code:'RETRY_LIMIT'});return;}
      c.attempts++;diagnostic(c,'loading');
      const selectedSource=profileScriptSource?.(c.profileId);
      const code = await botSource(c.profileId);
      if(profileScriptSource?.(c.profileId)!==selectedSource)return;
      if(!current(c,token))return;
      const after=await health(c);
      if(!current(c,token)||after.documentId!==before.documentId||classify(c,after))return;
      await evaluate(c,MSGPACK,8000);
      if(!current(c,token))return;
      // Atomic document/runtime guard closes the race with a delayed legacy loader response.
      const expression=`(async () => { if(String(performance.timeOrigin)!==${JSON.stringify(before.documentId)}) return {skipped:true,reason:'DOCUMENT_CHANGED'}; if(!window.__pmProfileId) window.__pmProfileId=${JSON.stringify(c.profileId)}; try { window.sessionStorage && window.sessionStorage.setItem('__pmProfileId', window.__pmProfileId); } catch (_) {} if(window.__pelicanBotVersion || window.__pmPayloadInitialized || ('__isBotRunning' in window) || typeof window.startMasterBot==='function' || document.getElementById('pelican-hud') || typeof window.__getClientLiveState==='function') return {skipped:true,reason:'ALREADY_RUNNING'}; if(window.__pmScriptBootstrap?.status?.()?.phase === 'failed') return {skipped:true,reason:'INITIALIZATION_FAILED'}; window.__pmBrowserInjectionAttempted=true; const evalResult = await (0,eval)(${JSON.stringify(code)}); return {attempted:true, evalResult}; })()`;
      await evaluate(c,expression);
      if(!current(c,token))return;
      const result=await health(c);if(!classify(c,result))diagnostic(c,'partial-runtime',{code:'POSTCONDITION_MISSING'});
    } catch (e) {
      if(isGoneError(e)){diagnostic(c,'transport-disconnected',{gameAlive:null});drop(c);scheduleReconnect();return;}
      if(!token){
        if(clients.get(c.profileId)===c){
          diagnostic(c,'probe-unavailable',{code:'DOCUMENT_PROBE_FAILED'});
          reloadCrashedClient(c,'DOCUMENT_PROBE_FAILED').catch(()=>{});
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
      if(c.injectionInFlight===flight)c.injectionInFlight=null;
      if(c.pendingLoad&&clients.get(c.profileId)===c&&!stoppedProfiles.has(c.profileId)){c.pendingLoad=false;setTimeout(()=>injectBot(c),0);}
    }
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

  async function attach(profileId, targetId, skipIdentityProbe = false, browserContextId = null) {
    if(stoppedProfiles.has(profileId))throw Error('PROFILE_STOPPED');
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    try {
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await configureSessionAssetCache(sessionId);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: profileInitScript(profileId) }, sessionId);
    if (!skipIdentityProbe) {
      const identity=await evaluate({sessionId},`(() => { if(!window.__pmProfileId)window.__pmProfileId=${JSON.stringify(profileId)}; try { window.sessionStorage && window.sessionStorage.setItem('__pmProfileId', window.__pmProfileId); } catch (_) {} return window.__pmProfileId; })()`,4500);
      if(identity!==profileId)throw Error('PROFILE_ID_CONFLICT');
    }
    if(stoppedProfiles.has(profileId))throw Error('PROFILE_STOPPED');
    const c = { profileId, targetId, sessionId, browserContextId: browserContextId || null, generation:0,documentId:null,attempts:0,injectionInFlight:null,retryTimer:null,crashReloadCount:0,lastCrashReloadAt:0,crashReloadInFlight:false,stateFailCount:0,lastStorageSyncAt:0 };
    clients.set(profileId, c);
    knownTargets.set(profileId,targetId);saveKnownTargets();diagnostic(c,'document-pending');
    return c;
    } catch(e) {await send('Target.detachFromTarget',{sessionId}).catch(()=>{});throw e;}
  }

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
    try {
      const levelDbDir = path.join(userDataDir, 'Default', 'Local Storage', 'leveldb');
      const diskHarvest = extractPelicanStorageFromLevelDb(levelDbDir);
      if (diskHarvest && diskHarvest.byProfile) {
        for (const [pid, map] of Object.entries(diskHarvest.byProfile)) {
          saveProfileStorage(pid, map);
        }
      }
    } catch (_) {}
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
    const unattachedPages = targetInfos.filter(x => x.type === 'page' && isGameUrl(x.url) && !Array.from(clients.values()).some(c => c.targetId === x.targetId));
    for (const t of unattachedPages) {
      try {
        const { sessionId } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
        let pid = null, charName = null, bodyText = '', probeFailed = false;
        try {
          const r = await send('Runtime.evaluate', {
            expression: `(() => ({
              pid: window.__pmProfileId || (typeof sessionStorage !== 'undefined' && sessionStorage.getItem && sessionStorage.getItem('__pmProfileId')) || null,
              charName: (typeof window.getLiveCharacterData === 'function' && window.getLiveCharacterData() && window.getLiveCharacterData().name) || window.__charName || null,
              bodyText: (typeof document !== 'undefined' && document.body && typeof document.body.innerText === 'string') ? document.body.innerText.slice(0, 1500) : ''
            }))()`,
            returnByValue: true
          }, sessionId, 4500);
          if(r.exceptionDetails)throw Error('PROFILE_PROBE_FAILED');
          const val = r && r.result && r.result.value;
          if (val && typeof val === 'object') {
            pid = val.pid || null;
            charName = val.charName || null;
            bodyText = String(val.bodyText || '');
          } else if (typeof val === 'string') {
            pid = val;
          }
        } catch (_) {
          probeFailed = true;
          const lastAt = crashedTargetReloadAt.get(t.targetId) || 0;
          if (Date.now() - lastAt > 20000) {
            crashedTargetReloadAt.set(t.targetId, Date.now());
            await send('Page.enable', {}, sessionId, 5000).catch(() => {});
            await send('Page.reload', { ignoreCache: false }, sessionId, 8000).catch(() => send('Page.navigate', { url: gameUrl }, sessionId, 8000).catch(() => {}));
          }
        } finally {
          await send('Target.detachFromTarget', { sessionId }).catch(() => {});
        }
        let identified = pid || allProfiles.find(p => knownTargets.get(p.id) === t.targetId)?.id || null;
        if (!identified) {
          const unclaimed = allProfiles.filter(p => !stoppedProfiles.has(p.id) && !clients.has(p.id) && (!knownTargets.get(p.id) || !surviving.has(knownTargets.get(p.id))));
          if (charName || bodyText) {
            const tokens = new Set(bodyText.split(/[\r\n\s·•]+/).filter(Boolean));
            const byChar = unclaimed.filter(p => {
              const cn = String(p.lastCharName || '').trim();
              if (!cn) return false;
              return charName === cn || tokens.has(cn) || bodyText.includes('เข้าเกมด้วย ' + cn);
            });
            if (byChar.length === 1) identified = byChar[0].id;
          }
          if (!identified && unattachedPages.length === 1 && unclaimed.length === 1 && clients.size > 0) {
            identified = unclaimed[0].id;
          }
        }
        const profile = identified && !stoppedProfiles.has(identified) && allProfiles.find(p => p.id === identified);
        const isCustomCtx = Boolean(t.browserContextId && customContexts.has(t.browserContextId));
        if (profile) {
          if (screenProxy && (screenProxy.isEnabled() || isCustomCtx)) {
            await screenProxy.acquireForProfile(profile.id, { debugPort: profile.debugPort }).catch(() => {});
          }
          const c = await attach(profile.id, t.targetId, probeFailed, isCustomCtx ? t.browserContextId : null);
          startProxy(c, profile.debugPort);
          if (probeFailed) await reloadCrashedClient(c, 'rediscover-crashed', true);
        }
      } catch (e) {}
    }
    for(const c of clients.values())await injectBot(c);
  }

  // ---------- per-profile HTTP API (same as the Electron loader's) ----------
  async function evaluate(c, code, timeoutMs = 300000) {
    // long scripts (channel switch waiting for a free slot, trades) may take minutes, like the Electron loader allows
    const r = await send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true }, c.sessionId, timeoutMs);
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || 'Script failed');
    return r.result ? r.result.value : undefined;
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
      const url = new URL(req.url, 'http://127.0.0.1');
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
          try { return reply(200, { success: true, result: await evaluate(c, code) }); }
          catch (e) { if (isGoneError(e)) drop(c); return reply(500, { success: false, error: e.message }); }
        }
        if (url.pathname === '/api/state') {
          try {
            const st = await evaluate(c, `typeof window.__getClientLiveState === 'function' ? window.__getClientLiveState() : null`, 4500);
            c.stateFailCount = 0;
            if (st === null && !c.injectionInFlight && !c.retryTimer) {
              injectBot(c).catch(() => {});
            } else if (st && Date.now() - (c.lastStorageSyncAt || 0) > 15000) {
              c.lastStorageSyncAt = Date.now();
              syncClientStorage(c).catch(() => {});
            }
            return reply(200, st);
          } catch (e) {
            if (isGoneError(e)) { drop(c); return reply(500, { success: false, error: e.message }); }
            c.stateFailCount = (c.stateFailCount || 0) + 1;
            if (c.stateFailCount >= 2) reloadCrashedClient(c, 'state-probe-timeout').catch(() => {});
            return reply(500, { success: false, error: e.message });
          }
        }
        if(url.pathname==='/api/browser-status')return reply(200,{success:true,profileId:c.profileId,browserContextId:c.browserContextId||null,...diagnostics.get(c.profileId)});
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
    stoppedProfiles.delete(profile.id);
    await ensureBrowser();
    const wasReady = diagnostics.get(profile.id)?.botReady === true;
    await rediscover();
    let existing = clients.get(profile.id);
    if (!existing) {
      const { targetInfos } = await send('Target.getTargets');
      const customContexts = await getCustomBrowserContexts();
      const claimedTargets = new Set([...Array.from(clients.values()).map(c => c.targetId), ...Array.from(knownTargets.entries()).filter(([k]) => k !== profile.id).map(([, v]) => v)]);
      const orphans = targetInfos.filter(t => t.type === 'page' && isGameUrl(t.url) && !claimedTargets.has(t.targetId));
      if (orphans.length === 1) {
        try {
          const orphanCtx = (orphans[0].browserContextId && customContexts.has(orphans[0].browserContextId)) ? orphans[0].browserContextId : null;
          existing = await attach(profile.id, orphans[0].targetId, true, orphanCtx);
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
    const c = await attach(profile.id, targetId, false, browserContextId);
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
        if (await browserAlive()) {
          await connect();
          const origin = new URL(gameUrl).origin;
          const recoverUrl = `${origin}/__pmhee_recover__`;
          const created = await send('Target.createTarget', { url: 'about:blank' }, undefined, 6000);
          targetId = created && created.targetId;
          if (targetId) {
            const attached = await send('Target.attachToTarget', { targetId, flatten: true }, undefined, 6000);
            const sessionId = attached && attached.sessionId;
            if (sessionId) {
              await send('Fetch.enable', { patterns: [{ urlPattern: `${recoverUrl}*` }] }, sessionId, 4000);
              await send('Page.navigate', { url: recoverUrl }, sessionId, 6000);
              let allKeys = {};
              for (let attempt = 0; attempt < 16; attempt++) {
                await new Promise(r => setTimeout(r, 150));
                try {
                  const evalRes = await send('Runtime.evaluate', {
                    expression: `(() => {
                      if (!window.location || window.location.origin !== ${JSON.stringify(origin)} || !window.localStorage) return null;
                      const out = {};
                      for (let i = 0; i < window.localStorage.length; i++) {
                        const k = window.localStorage.key(i);
                        if (!k || !k.startsWith('pelican_')) continue;
                        const v = window.localStorage[k];
                        if (typeof v === 'string') out[k] = v;
                      }
                      return out;
                    })()`,
                    returnByValue: true
                  }, sessionId, 3000);
                  if (evalRes?.result?.value && typeof evalRes.result.value === 'object') {
                    allKeys = evalRes.result.value;
                    break;
                  }
                } catch (_) {}
              }
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
          }
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
    // reconnect to a browser left open by a previous Manager run
    setTimeout(() => {if(started)rediscover().catch(() => {});}, 3000);
    monitorTimer=setInterval(()=>rediscover().catch(()=>scheduleReconnect()),15000);monitorTimer.unref?.();
  }

  function dispose(){
    started=false;clearTimeout(reconnectTimer);reconnectTimer=null;clearInterval(monitorTimer);monitorTimer=null;
    for(const c of [...clients.values()]){stoppedProfiles.add(c.profileId);clearTimeout(c.retryTimer);drop(c);}
    if(ws){const socket=ws;ws=null;socket.close();}
    for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error('BROWSER_MODE_DISPOSED'));}pending.clear();
  }
  return { launch, stop, isOpen, start, dispose, findBrowser, applyProxyModeToOpenWindows, syncAssetCacheToOpenWindows, harvestAllFromBrowserLevelDb, status:()=>Object.fromEntries(diagnostics) };
}

module.exports = { createBrowserMode, findBrowser, HEALTH_JS, extractPelicanStorageFromLevelDb, mergeAuthConfigString };
