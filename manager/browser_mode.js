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

function createBrowserMode({ rootDir, sessionsDir, getSettings, loadProfiles, preferLocalBot, cdpPort = DEFAULT_CDP_PORT, browserUserDataDir, gameUrl = GAME_URL, profileScriptSource }) {
  if(!Number.isInteger(cdpPort)||cdpPort<1024||cdpPort>65535)throw Error('INVALID_CDP_PORT');
  const CDP_PORT = cdpPort;
  const isGameUrl=value=>{try{return new URL(value).origin===new URL(gameUrl).origin;}catch(_){return false;}};
  const userDataDir = browserUserDataDir || path.join(sessionsDir, '_browser');
  const localBotPath = path.join(rootDir, 'bot.js');
  let browserProc = null;
  let ws = null, wsReady = null, nextId = 1;
  const pending = new Map();            // CDP call id -> {resolve, reject}
  const listeners = new Set();          // CDP event listeners
  const clients = new Map();            // profileId -> { targetId, sessionId, server, port }
  let startupPages = [];                // the empty window Chrome opens on start — closed once a game window exists
  const portServers = new Map();        // port -> proxy server (one per port, even if a client object went stale)
  let rediscovering = null;
  let started = false, reconnectTimer = null, reconnectDelay = 1000, monitorTimer = null;
  const stoppedProfiles = new Set(), knownTargets = new Map(), diagnostics = new Map();
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
    try {
      await send('Page.reload', { ignoreCache: false }, c.sessionId, 8000);
      return true;
    } catch (_) {
      try {
        await send('Page.navigate', { url: gameUrl }, c.sessionId, 8000);
        return true;
      } catch (_) {
        try {
          const { sessionId } = await send('Target.attachToTarget', { targetId: c.targetId, flatten: true }, undefined, 5000);
          c.sessionId = sessionId;
          await send('Page.enable', {}, sessionId, 5000).catch(() => {});
          await send('Runtime.enable', {}, sessionId, 5000).catch(() => {});
          await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__pmProfileId = ${JSON.stringify(c.profileId)}; try { window.sessionStorage && window.sessionStorage.setItem('__pmProfileId', ${JSON.stringify(c.profileId)}); } catch (_) {}` }, sessionId, 5000).catch(() => {});
          await send('Page.reload', { ignoreCache: false }, sessionId, 8000).catch(() => send('Page.navigate', { url: gameUrl }, sessionId, 8000));
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
      const expression=`(() => { if(String(performance.timeOrigin)!==${JSON.stringify(before.documentId)}) return {skipped:true,reason:'DOCUMENT_CHANGED'}; if(window.__pelicanBotVersion || window.__pmPayloadInitialized || ('__isBotRunning' in window) || typeof window.startMasterBot==='function' || document.getElementById('pelican-hud') || typeof window.__getClientLiveState==='function') return {skipped:true,reason:'ALREADY_RUNNING'}; if(window.__pmScriptBootstrap?.status?.()?.phase === 'failed') return {skipped:true,reason:'INITIALIZATION_FAILED'}; window.__pmBrowserInjectionAttempted=true; (0,eval)(${JSON.stringify(code)}); return {attempted:true}; })()`;
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
    const c = Array.from(clients.values()).find(x => x.sessionId === msg.sessionId);
    if (!c) return;
    if(msg.method==='Page.frameNavigated'&&!msg.params?.frame?.parentId){c.generation++;c.documentId=null;c.attempts=0;clearTimeout(c.retryTimer);diagnostic(c,'document-pending',{navigationType:String(msg.params?.type||'navigation').slice(0,40)});}
    if(msg.method==='Page.loadEventFired')injectBot(c);
    if(msg.method==='Inspector.targetCrashed')reloadCrashedClient(c,'Inspector.targetCrashed').catch(()=>{});
  });
  listeners.add(msg => {
    if (msg.method === 'Target.targetDestroyed') {
      for (const c of Array.from(clients.values())) if (c.targetId === msg.params.targetId) {diagnostic(c,'closed');knownTargets.delete(c.profileId);drop(c);}
    }
    if (msg.method === 'Target.targetCrashed') {
      for (const c of Array.from(clients.values())) if (c.targetId === msg.params.targetId) reloadCrashedClient(c, msg.params?.status || 'Target.targetCrashed').catch(() => {});
    }
    if (msg.method === 'Target.detachedFromTarget') {
      for (const c of Array.from(clients.values())) if (c.sessionId === msg.params.sessionId) {diagnostic(c,'transport-disconnected',{gameAlive:null});drop(c);scheduleReconnect();}
    }
  });

  async function attach(profileId, targetId, skipIdentityProbe = false) {
    if(stoppedProfiles.has(profileId))throw Error('PROFILE_STOPPED');
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    try {
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__pmProfileId = ${JSON.stringify(profileId)}; try { window.sessionStorage && window.sessionStorage.setItem('__pmProfileId', ${JSON.stringify(profileId)}); } catch (_) {}` }, sessionId);
    if (!skipIdentityProbe) {
      const identity=await evaluate({sessionId},`(() => { if(!window.__pmProfileId)window.__pmProfileId=${JSON.stringify(profileId)}; try { window.sessionStorage && window.sessionStorage.setItem('__pmProfileId', window.__pmProfileId); } catch (_) {} return window.__pmProfileId; })()`,4500);
      if(identity!==profileId)throw Error('PROFILE_ID_CONFLICT');
    }
    if(stoppedProfiles.has(profileId))throw Error('PROFILE_STOPPED');
    const c = { profileId, targetId, sessionId, generation:0,documentId:null,attempts:0,injectionInFlight:null,retryTimer:null,crashReloadCount:0,lastCrashReloadAt:0,crashReloadInFlight:false,stateFailCount:0 };
    clients.set(profileId, c);
    knownTargets.set(profileId,targetId);diagnostic(c,'document-pending');
    return c;
    } catch(e) {await send('Target.detachFromTarget',{sessionId}).catch(()=>{});throw e;}
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
    const surviving=new Set(targetInfos.map(t=>t.targetId));
    for(const c of Array.from(clients.values()))if(!surviving.has(c.targetId)){diagnostic(c,'closed');knownTargets.delete(c.profileId);drop(c);}
    for (const t of targetInfos.filter(x => x.type === 'page' && isGameUrl(x.url))) {
      if (Array.from(clients.values()).some(c => c.targetId === t.targetId)) continue;
      try {
        const { sessionId } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
        let pid, probeFailed = false;
        try {
          const r = await send('Runtime.evaluate', { expression: `window.__pmProfileId || (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('__pmProfileId')) || null`, returnByValue: true }, sessionId, 4500);
          if(r.exceptionDetails)throw Error('PROFILE_PROBE_FAILED');
          pid = r && r.result && r.result.value;
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
        const identified=pid||loadProfiles().find(p=>knownTargets.get(p.id)===t.targetId)?.id;
        const profile = identified && !stoppedProfiles.has(identified) && loadProfiles().find(p => p.id === identified);
        if (profile) {
          const c = await attach(profile.id, t.targetId, probeFailed);
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
            return reply(200, st);
          } catch (e) {
            if (isGoneError(e)) { drop(c); return reply(500, { success: false, error: e.message }); }
            c.stateFailCount = (c.stateFailCount || 0) + 1;
            if (c.stateFailCount >= 2) reloadCrashedClient(c, 'state-probe-timeout').catch(() => {});
            return reply(500, { success: false, error: e.message });
          }
        }
        if(url.pathname==='/api/browser-status')return reply(200,{success:true,profileId:c.profileId,...diagnostics.get(c.profileId)});
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
    const existing = clients.get(profile.id);
    if (existing) {
      const { targetInfos } = await send('Target.getTargets');
      if (targetInfos.some(t => t.targetId === existing.targetId)) {
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
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true });
    const c = await attach(profile.id, targetId);
    startProxy(c, profile.debugPort);
    await send('Page.navigate', { url: gameUrl }, c.sessionId);
    for (const targetId of startupPages.splice(0)) await send('Target.closeTarget', { targetId }).catch(() => {});
    return { success: true, message: 'เปิดหน้าต่างเบราว์เซอร์แล้ว' };
  }
  async function stop(profileId) {
    stoppedProfiles.add(profileId);
    const c = clients.get(profileId);
    const targetId=c?.targetId||knownTargets.get(profileId);knownTargets.delete(profileId);
    diagnostics.set(profileId,{gameAlive:null,botReady:false,state:'explicitly-stopped'});
    if (!targetId) return false;
    if(c)drop(c);
    await connect().then(()=>send('Target.closeTarget', { targetId })).catch(() => {});
    return true;
  }
  const isOpen = profileId => clients.has(profileId);

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
  return { launch, stop, isOpen, start, dispose, findBrowser, status:()=>Object.fromEntries(diagnostics) };
}

module.exports = { createBrowserMode, findBrowser, HEALTH_JS };
