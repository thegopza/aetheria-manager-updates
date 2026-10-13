// manager/bot_auto_update.js — Reload game clients automatically when bot.js changes on GitHub.
//
// The game loader (main.js) already fetches the latest bot.js from GitHub on every page load,
// so an update is just a page reload. This module decides *when*:
//   1. Poll the GitHub API for the newest commit touching bot.js (only bot.js commits count).
//   2. Wait until raw.githubusercontent.com actually serves that file (its CDN can lag ~5 min),
//      verified by the git blob sha, then also refresh the local fallback resources/bot.js.
//   3. Reload outdated clients one at a time, only while the bot is in a safe state
//      (never mid Alice walk, NPC shopping, revive, consolidation/trade, job change, ...).
//   4. Make sure a bot that was farming before the reload is running again afterwards.

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO = 'thegopza/aetheria-pelican-bot';
const { getMainHeadSha } = require('./github_check');
const RAW_BOT_URL = `https://raw.githubusercontent.com/${REPO}/main/bot.js`;
const POLL_MS = 5 * 60 * 1000;
const TICK_MS = 15 * 1000;
const RAW_WAIT_LIMIT_MS = 20 * 60 * 1000;
const RESUME_GRACE_MS = 45 * 1000;
// Several bot.js versions pushed close together used to refresh every client once per version. Roll out only
// when no newer version showed up for this long (the "ตรวจตอนนี้" button skips the wait).
const SETTLE_MS = 10 * 60 * 1000;
const CLIENT_BACK_TIMEOUT_MS = 3 * 60 * 1000;

// Evaluated in the game: page load time, busy flags and whether the bot is farming.
const CLIENT_PROBE_JS = `(() => {
  const busy = [];
  if (window.__isWalkingToMap) busy.push('กำลังเดินกลับแมพผ่าน Alice');
  if (window.__isShopping) busy.push('กำลังซื้อ/ขายกับ NPC');
  if (window.__isRecovering) busy.push('กำลังชุบชีวิต');
  if (window.__isNavigating) busy.push('กำลังเดินทาง');
  if (window.__isConsolidating || window.__consolidationReceiverMode) busy.push('กำลังรวมเงิน/เทรด');
  if (window.__isChangingJob) busy.push('กำลังเปลี่ยนอาชีพ');
  if (window.__isGearRefining) busy.push('กำลังตีบวก (เซ็ตอุปกรณ์)');
  if (window.__isStoring) busy.push('กำลังฝากของเข้าคลัง');
  if (window.__planMarketBuyInFlight) busy.push('กำลังซื้อของในตลาดตามแผน');
  if (window.__isManualSelling || window.__isAutoSellingNow) busy.push('กำลังขายของ');
  if (window.__isMarketScanning) busy.push('กำลังสแกนตลาด');
  if (document.querySelector('.human-check')) busy.push('กำลังรอตอบเช็คผู้เล่น (Human Check)');
  if (window.__unexpectedTownWaiting) busy.push('กำลังพักรอนิรภัย (กลับเมืองผิดปกติ)');
  if (window.__isHumanizing) busy.push('กำลังทำกิจกรรม Humanize ในเมือง');
  if (window.__isWeightScrollBusy) busy.push('กำลังใช้ Weight Limit Scroll');
  if (window.__senderTradeBusy) busy.push('กำลังส่งของ/เงินผ่านเทรด');
  const nameEl = document.querySelector('.hud-name');
  let map = '';
  try { map = (typeof window.__getClientLiveState === 'function' && window.__getClientLiveState().map) || ''; } catch (e) {}
  return {
    loadedAt: Math.round(performance.timeOrigin),
    version: window.__pelicanBotVersion || null,
    payloadHash: window.__pmScriptBootstrap?.status?.()?.payloadHash || null,
    inGame: Boolean(nameEl && map && !map.startsWith('ไม่ทราบ')),
    running: Boolean(window.__isBotRunning),
    busy
  };
})()`;

const START_BOT_JS = `(() => {
  window.__autoLoopEnabled = true;
  window.__isBotRunning = true;
  try { localStorage.setItem('pelican_auto_loop', true); localStorage.setItem('pelican_bot_running', 'true'); } catch (e) {}
  if (typeof window.startMasterBot === 'function') window.startMasterBot();
  if (typeof window.startAutoLoop === 'function') window.startAutoLoop();
  return true;
})()`;

function getBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'PmheeAether-Manager', 'Cache-Control': 'no-cache' }, timeout: 20000 }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => res.statusCode === 200 ? resolve(Buffer.concat(chunks)) : reject(new Error(`HTTP ${res.statusCode}`)));
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

const gitBlobSha = buf => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function createBotAutoUpdater({ loadProfiles, evalProfilePort, getGameDir, dataDir, getManagedRelease, sleep = ms => new Promise(r => setTimeout(r, ms)), clock = () => Date.now(), clientBackTimeoutMs = CLIENT_BACK_TIMEOUT_MS }) {
  const stateFile = path.join(dataDir, 'bot_update_state.json');
  let saved = { enabled: true };
  try { saved = Object.assign(saved, JSON.parse(fs.readFileSync(stateFile, 'utf8'))); } catch (e) {}
  // profileId -> { key, at }: a refresh toward `key` already failed for this screen. Never reload it again
  // automatically for the same target (prevents a refresh every TICK_MS after a failed recovery, also across
  // Manager restarts). Cleared when a different release arrives or the owner presses "ตรวจตอนนี้".
  const failedTargets = {};
  if (saved.failedTargets && typeof saved.failedTargets === 'object') {
    for (const [id, f] of Object.entries(saved.failedTargets)) {
      if (f && typeof f.key === 'string' && f.key.length <= 200) failedTargets[id] = { key: f.key, at: Number(f.at) || 0 };
    }
  }

  const status = {
    enabled: saved.enabled !== false,
    lastCheckAt: null,
    lastError: null,
    latest: null,          // { sha, message, date, blobSha }
    ready: null,           // { sha, at } — raw CDN confirmed serving this version
    phase: 'idle',         // idle | waiting-cdn | settling | updating
    settleUntil: null,
    clients: {}            // profileId -> { name, state, note, at }
  };
  let busyCycle = false;
  // Only a refresh and its recovery block Manager restart. Waiting clients/CDN do not.
  let refreshInFlight = false;
  let manualAt = 0;

  const persist = () => {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify({ enabled: status.enabled, failedTargets }, null, 2));
    } catch (e) {}
  };
  const setClient = (p, state, note, version) => {
    const prev = status.clients[p.id];
    status.clients[p.id] = { name: p.name, state, note: note || '', at: Date.now(), version: version || (prev && prev.version) || null };
  };

  async function probe(p) {
    const r = await evalProfilePort(p.debugPort, CLIENT_PROBE_JS, 4000);
    return r && r.success && r.result && typeof r.result === 'object' ? r.result : null;
  }

  // No api.github.com here (60 requests/h per IP): main's commit comes from git's ref list, and only when
  // it moved is bot.js of that exact commit downloaded (immutable URL, no CDN lag) to get its blob sha.
  let checkedHead = null;
  async function checkGitHub() {
    status.lastCheckAt = Date.now();
    try {
      if (getManagedRelease) {
        const managed = getManagedRelease();
        if (managed !== undefined) {
          if (!managed) { status.lastError = 'รอ payload ที่ตรวจลายเซ็นแล้วในเครื่อง'; return; }
          if (!/^\d+\.\d+\.\d+$/.test(managed.version || '') || !/^[a-f0-9]{64}$/.test(managed.hash || '')) throw Error('INVALID_MANAGED_RELEASE');
          if (status.latest?.sha !== managed.hash) {
            status.latest = { sha: managed.hash, blobSha: managed.hash, version: managed.version,
              message: 'PmheeAether payload v' + managed.version, date: Date.now(), managed: true };
            status.ready = { sha: managed.hash, at: Date.now(), observedLive: true };
          }
          status.lastError = null;
          return;
        }
      }
      const head = await getMainHeadSha();
      if (!status.latest || checkedHead !== head) {
        const buf = await getBuffer(`https://raw.githubusercontent.com/${REPO}/${head}/bot.js`);
        const blob = gitBlobSha(buf);
        checkedHead = head;
        if (!status.latest || status.latest.blobSha !== blob) {
          const version = (buf.toString('utf8').match(/PELICAN_BOT_VERSION = '([^']+)'/) || [])[1] || null;
          status.latest = {
            sha: head,
            message: version ? `bot.js v${version}` : 'bot.js',
            version,
            date: Date.now(),
            blobSha: blob
          };
          if (!status.ready || status.ready.sha !== head) status.ready = null;
        }
      }
      status.lastError = null;
    } catch (e) {
      status.lastError = `เช็ก GitHub ไม่สำเร็จ: ${e.message}`;
    }
  }

  // Wait until the raw URL the game loader uses serves this exact blob, then refresh the local fallback.
  async function waitForRaw() {
    const latest = status.latest;
    if (!latest || latest.managed || !latest.blobSha || (status.ready && status.ready.sha === latest.sha)) return;
    status.phase = 'waiting-cdn';
    const started = clock();
    let attempts = 0;
    while (clock() - started < RAW_WAIT_LIMIT_MS && status.latest === latest) {
      attempts++;
      try {
        const buf = await getBuffer(`${RAW_BOT_URL}?t=${Date.now()}`);
        if (gitBlobSha(buf) === latest.blobSha) {
          // observedLive: we saw the CDN switch over, so `at` is a tight bound for "served from now on"
          status.ready = { sha: latest.sha, at: Date.now(), observedLive: attempts > 1 };
          try {
            const local = path.join(getGameDir(), 'resources', 'bot.js');
            if (fs.existsSync(path.dirname(local))) fs.writeFileSync(local, buf);
          } catch (e) {}
          return;
        }
      } catch (e) {}
      await sleep(30000);
    }
    status.phase = 'idle';
  }

  // A client is outdated if its page was loaded before the raw URL served this version.
  // When we didn't watch the CDN switch over (e.g. Manager started later), allow for its ~5 min cache.
  const CDN_LAG_MS = 6 * 60 * 1000;
  function outdatedThreshold() {
    if (!status.latest || !status.ready) return null;
    if (status.latest.managed) return null;
    if (status.ready.observedLive) return status.ready.at;
    return Math.min(status.latest.date + CDN_LAG_MS, status.ready.at);
  }

  // Immutable snapshot of what a refresh must reach; status.latest may change while a refresh is running.
  function currentTarget() {
    const latest = status.latest;
    if (!latest) return null;
    return {
      key: (latest.managed ? 'm:' : 'g:') + latest.sha,
      sha: latest.sha,
      version: latest.version || null,
      managed: Boolean(latest.managed),
      threshold: outdatedThreshold()
    };
  }
  function isCurrentFor(target, info) {
    if (!target || !info) return false;
    const sameVersion = Boolean(info.version && target.version && info.version === target.version);
    if (target.managed) return sameVersion && info.payloadHash === target.sha;
    return sameVersion || (target.threshold !== null && info.loadedAt >= target.threshold);
  }

  async function reloadClient(p, info, target) {
    refreshInFlight = true;
    try {
      const wasRunning = Boolean(info.running);
      setClient(p, 'reloading', 'กำลังรีเฟรชหน้าเกม...');
      // Wait for the dispatch to settle even when unload makes the eval time out.
      try {
        await evalProfilePort(p.debugPort, `(() => { try { localStorage.setItem('pelican_bot_running', ${wasRunning ? "'true'" : "'false'"}); } catch (e) {} setTimeout(() => location.reload(), 150); return true; })()`, 2000);
      } catch (e) {
        // A rejected eval may mean the page already unloaded. Keep protecting its recovery.
      }
      await sleep(8000);

      const started = clock();
      let resumedAt = null;
      while (clock() - started < clientBackTimeoutMs) {
        const now = await probe(p);
        if (now && now.inGame && now.loadedAt > info.loadedAt) {
          if (!isCurrentFor(target, now)) {
            await sleep(3000);
            continue;
          }
          if (failedTargets[p.id]) { delete failedTargets[p.id]; persist(); }
          if (!wasRunning) {
            setClient(p, 'done', 'อัปเดตแล้ว', now.version);
            return true;
          }
          if (now.running) {
            setClient(p, 'done', 'อัปเดตแล้ว บอททำงานต่อ', now.version);
            return true;
          }
          resumedAt = resumedAt || clock();
          if (clock() - resumedAt > RESUME_GRACE_MS) {
            await evalProfilePort(p.debugPort, START_BOT_JS, 4000);
            setClient(p, 'done', 'อัปเดตแล้ว (Manager สั่งเริ่มบอทให้)', now.version);
            return true;
          }
          setClient(p, 'resuming', 'รอบอทกลับมาทำงานต่อ...');
        }
        await sleep(5000);
      }
      failedTargets[p.id] = { key: target.key, at: clock() };
      persist();
      setClient(p, 'error', 'รีเฟรชแล้วแต่ตัวละครยังไม่กลับเข้าเกม หรือยังไม่ได้เวอร์ชันล่าสุด — ตรวจสอบจอนี้ (จะไม่รีเฟรชซ้ำจนกว่าจะมีเวอร์ชันใหม่หรือกด "ตรวจตอนนี้")');
      return false;
    } finally {
      refreshInFlight = false;
    }
  }

  async function updateCycle() {
    if (busyCycle) return;
    busyCycle = true;
    try {
      if (!status.ready) return;
      const settleUntil = status.latest ? status.latest.date + SETTLE_MS : 0;
      if (!status.latest?.managed && Date.now() < settleUntil && Date.now() - manualAt > SETTLE_MS) {
        status.phase = 'settling';
        status.settleUntil = settleUntil;
        return;
      }
      status.settleUntil = null;
      const target = currentTarget();
      if (!target) return;
      // A newer release supersedes old failures.
      let dropped = false;
      for (const [id, f] of Object.entries(failedTargets)) if (f.key !== target.key) { delete failedTargets[id]; dropped = true; }
      if (dropped) persist();
      const profiles = loadProfiles().filter(p => p.debugPort);
      let pending = 0;
      for (const p of profiles) {
        const info = await probe(p);
        if (!info) { delete status.clients[p.id]; continue; }
        if (isCurrentFor(target, info)) {
          if (failedTargets[p.id]) { delete failedTargets[p.id]; persist(); }
          if (!status.clients[p.id] || status.clients[p.id].state !== 'done') setClient(p, 'up-to-date', 'ใช้เวอร์ชันล่าสุดอยู่แล้ว', info.version);
          else status.clients[p.id].version = info.version;
          continue;
        }
        pending++;
        if (!status.enabled) { setClient(p, 'outdated', 'มีเวอร์ชันใหม่ (ปิดอัปเดตอัตโนมัติอยู่)', info.version); continue; }
        if (!info.inGame) { setClient(p, 'waiting', 'รอให้ตัวละครอยู่ในเกมก่อน', info.version); continue; }
        if (failedTargets[p.id] && failedTargets[p.id].key === target.key) {
          setClient(p, 'error', 'อัปเดตจอนี้ไม่สำเร็จรอบก่อน — ไม่รีเฟรชซ้ำอัตโนมัติ (กด "ตรวจตอนนี้" เพื่อลองใหม่)', info.version);
          continue;
        }
        if (info.busy.length) { setClient(p, 'waiting', `รอจังหวะปลอดภัย: ${info.busy.join(', ')}`, info.version); continue; }
        status.phase = 'updating';
        await reloadClient(p, info, target);   // one client at a time
        pending--;
      }
      status.phase = pending > 0 ? 'updating' : 'idle';
    } finally {
      busyCycle = false;
    }
  }

  async function checkNow() {
    await checkGitHub();
    await waitForRaw();
    await updateCycle();
  }

  // Explicit owner action: allow one more attempt for screens whose previous refresh failed.
  async function retryFailed() {
    for (const id of Object.keys(failedTargets)) delete failedTargets[id];
    persist();
    await checkNow();
  }

  function start() {
    // First check after a minute so a freshly started Manager doesn't reload clients immediately.
    setTimeout(() => { checkNow(); setInterval(() => checkGitHub().then(waitForRaw), POLL_MS); }, 60 * 1000);
    setInterval(() => { if (status.ready) return updateCycle(); }, TICK_MS);
  }

  async function handleRoute(req, res, pathname, sendJSON) {
    if (pathname === '/api/bot-update/status' && req.method === 'GET') {
      sendJSON({ success: true, ...status, pollMinutes: POLL_MS / 60000 });
      return true;
    }
    if (pathname === '/api/bot-update/settings' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      await new Promise(r => req.on('end', r));
      try {
        const p = JSON.parse(body || '{}');
        if (typeof p.enabled === 'boolean') { status.enabled = p.enabled; persist(); }
        sendJSON({ success: true, enabled: status.enabled });
      } catch (e) {
        sendJSON({ success: false, error: 'Invalid JSON' }, 400);
      }
      return true;
    }
    if (pathname === '/api/bot-update/check' && req.method === 'POST') {
      manualAt = Date.now();
      retryFailed();
      sendJSON({ success: true });
      return true;
    }
    return false;
  }

  return { start, handleRoute, status, isBusy: () => refreshInFlight, checkNow, retryFailed, updateCycle, _failedTargets: failedTargets };
}

module.exports = { createBotAutoUpdater };
