const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");

const STATIC_MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

function encodeBody(buf, contentType = "") {
  const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf || ""), "utf8");
  if (buffer.length === 0) {
    return { bodyEncoding: "none", bodyData: "" };
  }
  if (buffer.length > 1024) {
    try {
      const gz = zlib.gzipSync(buffer);
      if (gz.length < buffer.length * 0.9) {
        return { bodyEncoding: "gzip+base64", bodyData: gz.toString("base64") };
      }
    } catch (_) {}
  }
  const ct = String(contentType || "").toLowerCase();
  const isText = !ct || ct.includes("application/json") || ct.startsWith("text/") || ct.includes("javascript") || ct.includes("svg+xml");
  if (isText) {
    return { bodyEncoding: "utf8", bodyData: buffer.toString("utf8") };
  }
  return { bodyEncoding: "base64", bodyData: buffer.toString("base64") };
}

function decodeBody(encoding, data) {
  if (!encoding || encoding === "none" || !data) return Buffer.alloc(0);
  if (encoding === "utf8") return Buffer.from(String(data), "utf8");
  if (encoding === "base64") return Buffer.from(String(data), "base64");
  if (encoding === "gzip+base64") {
    const gz = Buffer.from(String(data), "base64");
    return zlib.gunzipSync(gz, { maxOutputLength: 8 * 1024 * 1024 });
  }
  throw new Error("Unsupported bodyEncoding: " + encoding);
}

function validateRelayedApiPath(rawPath) {
  const raw = String(rawPath || "").trim();
  if (!raw || raw.includes("..") || raw.includes("\\")) {
    return { ok: false, status: 403, code: "REMOTE_ROUTE_BLOCKED", error: "ไม่อนุญาตให้เรียกใช้งานเส้นทางนี้จากระยะไกล" };
  }
  let u;
  try {
    u = new URL(raw, "http://localhost");
  } catch (_) {
    return { ok: false, status: 400, code: "INVALID_REMOTE_PATH", error: "รูปแบบเส้นทาง API ไม่ถูกต้อง" };
  }
  const p = u.pathname;
  if (!p.startsWith("/api/") || p.includes("..")) {
    return { ok: false, status: 403, code: "REMOTE_ROUTE_BLOCKED", error: "อนุญาตเฉพาะเส้นทาง /api/* เท่านั้น" };
  }
  if (p === "/api/auth/logout" || p === "/api/auth/login" || p === "/api/auth/register") {
    return { ok: false, status: 403, code: "REMOTE_AUTH_LOCKED", error: "ไม่สามารถออกจากระบบหรือสลับบัญชีระหว่างการควบคุมระยะไกลได้" };
  }
  if (p === "/api/fleet" || p.startsWith("/api/fleet/") || p === "/api/support" || p.startsWith("/api/support/") || p === "/api/game-install/browse" || p === "/api/test" || p.startsWith("/api/test/")) {
    return { ok: false, status: 403, code: "REMOTE_ROUTE_BLOCKED", error: "ไม่อนุญาตให้เรียกใช้งานเส้นทางนี้จากระยะไกล" };
  }
  return { ok: true, fullPath: p + u.search };
}

function readReqBuffer(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", chunk => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      size += buf.length;
      if (size > maxBytes) {
        settled = true;
        const err = new Error("Payload too large");
        err.status = 413;
        err.code = "BODY_TOO_LARGE";
        try { req.destroy(); } catch (_) {}
        return reject(err);
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on("error", err => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workerCount = Math.min(Math.max(1, limit), Math.max(1, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur], cur);
    }
  }));
  return results;
}

function buildRemoteBootstrapJs(machineKey) {
  const safeKeyJson = JSON.stringify(String(machineKey || ""));
  const apiBaseJson = JSON.stringify("/api/fleet/proxy/" + encodeURIComponent(String(machineKey || "")));
  return `(function(){
  var MACHINE_KEY = ${safeKeyJson};
  var API_BASE = ${apiBaseJson};
  window.__PM_REMOTE_MODE__ = true;
  window.__PM_REMOTE_MACHINE__ = MACHINE_KEY;
  window.__PM_REMOTE_API_BASE__ = API_BASE;

  // Namespace localStorage per remote machine so remote tab states never clobber the local PC
  try {
    var ls = window.localStorage;
    var prefix = "pm_remote_" + MACHINE_KEY + "__";
    var rawGet = ls.getItem.bind(ls);
    var rawSet = ls.setItem.bind(ls);
    var rawRem = ls.removeItem.bind(ls);
    rawGet; rawSet; rawRem;
    var proto = Object.getPrototypeOf(ls);
    var origGet = proto.getItem;
    var origSet = proto.setItem;
    var origRemove = proto.removeItem;
    if (!origGet.__pmRemoteWrapped) {
      proto.getItem = function(k) {
        var key = String(k || "");
        if (key === "manager.activeTab") {
          var v = origGet.call(this, prefix + key);
          return (!v || v === "fleet") ? "profiles" : v;
        }
        return origGet.call(this, prefix + key);
      };
      proto.getItem.__pmRemoteWrapped = true;
      proto.setItem = function(k, v) {
        var key = String(k || "");
        if (key === "manager.activeTab" && String(v) === "fleet") v = "profiles";
        return origSet.call(this, prefix + key, v);
      };
      proto.removeItem = function(k) {
        return origRemove.call(this, prefix + String(k || ""));
      };
    }
  } catch (e) {}

  function resolveApiSubPath(urlStr) {
    if (typeof urlStr !== "string") return null;
    try {
      var u = new URL(urlStr, window.location.origin);
      if (u.origin !== window.location.origin) return null;
      var p = u.pathname || "";
      if (p.indexOf("/api/fleet/proxy/") === 0) return { alreadyProxied: true, path: p, search: u.search || "" };
      if (p === "/api/portrait" || p.indexOf("/api/portrait?") === 0) return null;
      if (p === "/api/fleet" || p.indexOf("/api/fleet/") === 0) return { localBlocked: true, path: p };
      if (p.indexOf("/api/") === 0) return { subPath: p + (u.search || ""), pathname: p };
    } catch (_) {}
    return null;
  }

  function isAuthLockPath(pathname) {
    return pathname === "/api/auth/logout" || pathname === "/api/auth/login" || pathname === "/api/auth/register";
  }

  // Rewrite fetch calls to /api/fleet/proxy/<machineKey>/api/...
  if (typeof window.fetch === "function" && !window.fetch.__pmRemoteWrapped) {
    var origFetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
      var urlStr = typeof input === "string" ? input : (input && input.url ? input.url : "");
      var info = resolveApiSubPath(urlStr);
      if (info && info.localBlocked) {
        return Promise.resolve(new Response(JSON.stringify({ success: false, code: "REMOTE_ROUTE_BLOCKED", error: "ไม่อนุญาตให้เรียกใช้งานเส้นทางนี้จากระยะไกล" }), { status: 403, headers: { "Content-Type": "application/json; charset=utf-8" } }));
      }
      if (info && info.subPath) {
        if (isAuthLockPath(info.pathname)) {
          return Promise.resolve(new Response(JSON.stringify({ success: false, code: "REMOTE_AUTH_LOCKED", error: "ไม่สามารถออกจากระบบหรือสลับบัญชีระหว่างการควบคุมระยะไกลได้" }), { status: 403, headers: { "Content-Type": "application/json; charset=utf-8" } }));
        }
        var targetUrl = API_BASE + info.subPath;
        if (typeof input === "string") {
          return origFetch(targetUrl, init);
        }
        try {
          var clonedReq = new Request(targetUrl, input);
          return origFetch(clonedReq, init);
        } catch (_) {
          return origFetch(targetUrl, init);
        }
      }
      return origFetch(input, init);
    };
    window.fetch.__pmRemoteWrapped = true;
  }

  // Rewrite XMLHttpRequest
  try {
    var origOpen = XMLHttpRequest.prototype.open;
    if (origOpen && !origOpen.__pmRemoteWrapped) {
      XMLHttpRequest.prototype.open = function(method, url) {
        var args = Array.prototype.slice.call(arguments);
        var info = resolveApiSubPath(typeof url === "string" ? url : "");
        if (info && info.subPath && !isAuthLockPath(info.pathname)) {
          args[1] = API_BASE + info.subPath;
        }
        return origOpen.apply(this, args);
      };
      XMLHttpRequest.prototype.open.__pmRemoteWrapped = true;
    }
  } catch (_) {}

  function applyRemoteDomLocks() {
    if (window.self !== window.top) {
      var splash = document.getElementById("pm-boot-splash");
      if (splash) splash.style.display = "none";
      document.body && document.body.classList && document.body.classList.add("pm-remote-embedded");
    } else if (document.body && !document.getElementById("pm-remote-standalone-bar")) {
      var bar = document.createElement("div");
      bar.id = "pm-remote-standalone-bar";
      bar.style.cssText = "position:sticky;top:0;z-index:99990;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 16px;background:linear-gradient(90deg,rgba(14,165,233,0.22),rgba(15,23,42,0.96));border-bottom:1px solid rgba(56,189,248,0.4);color:#e0f2fe;font-size:13px;font-weight:700;backdrop-filter:blur(8px);";
      bar.innerHTML = '<span>🕹️ โหมดควบคุมระยะไกล (Remote Manager) · เครื่อง <code style="color:#7dd3fc;">' + MACHINE_KEY.replace(/</g, "&lt;") + '</code></span><a href="/" style="color:#fff;background:rgba(56,189,248,0.25);border:1px solid rgba(56,189,248,0.5);padding:4px 12px;border-radius:8px;text-decoration:none;font-size:12px;">⬅️ กลับ Manager เครื่องตัวเอง</a>';
      document.body.insertBefore(bar, document.body.firstChild);
    }

    var fleetTabBtn = document.getElementById("tab-btn-fleet");
    if (fleetTabBtn) fleetTabBtn.style.display = "none";

    ["btn-auth-logout", "btn-access-lock-logout"].forEach(function(id) {
      var btn = document.getElementById(id);
      if (btn) {
        btn.disabled = true;
        btn.title = "ล็อกการออกจากระบบ/สลับบัญชีขณะควบคุมระยะไกลเพื่อป้องกันการตัดการเชื่อมต่อ";
        btn.style.opacity = "0.55";
        btn.style.cursor = "not-allowed";
        btn.textContent = "🔒 ล็อกการออกจากระบบขณะควบคุมระยะไกล";
      }
    });

    var browseBtn = document.getElementById("btn-patcher-browse");
    if (browseBtn) {
      browseBtn.disabled = true;
      browseBtn.title = "ไม่รองรับหน้าต่างเลือกโฟลเดอร์ผ่านโหมดควบคุมระยะไกล";
      browseBtn.style.opacity = "0.55";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function() {
      applyRemoteDomLocks();
      setInterval(applyRemoteDomLocks, 1500);
    });
  } else {
    applyRemoteDomLocks();
    setInterval(applyRemoteDomLocks, 1500);
  }
})();`;
}

function createRemoteFleetService(deps) {
  const {
    getPort,
    publicDir,
    humanCheckSolver,
    loadProfiles,
    runningProcesses,
    browserMode,
    isProcessAlive,
    queryClientState,
    clientStateCacheByPort,
    updateZenyRateTracker,
    getEffectiveDeviceNickname,
    setLocalDeviceNickname,
    managerVersion = "4.58.0"
  } = deps;

  let running = false;
  let stopped = false;
  let sleepResolve = null;
  let cachedSummary = null;
  let cachedSummaryAt = 0;

  function wakeWorker() {
    if (typeof sleepResolve === "function") {
      const fn = sleepResolve;
      sleepResolve = null;
      fn();
    }
  }

  function sleepInterruptible(ms) {
    return new Promise(resolve => {
      if (ms <= 0 || stopped) return resolve();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (sleepResolve === finish) sleepResolve = null;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      if (typeof timer.unref === "function") timer.unref();
      sleepResolve = finish;
    });
  }

  async function collectMachineSummary(force = false) {
    const now = Date.now();
    if (!force && cachedSummary && (now - cachedSummaryAt) < 3500) {
      return cachedSummary;
    }
    const profiles = (typeof loadProfiles === "function" ? loadProfiles() : []) || [];
    const list = profiles.slice(0, 150);

    // Refresh stale ports quietly with concurrency cap 6
    await mapConcurrent(list, 6, async (p) => {
      if (!p || !p.debugPort) return;
      const proc = runningProcesses && runningProcesses[p.id];
      const isOpenBrowser = Boolean(browserMode && typeof browserMode.isOpen === "function" && browserMode.isOpen(p.id));
      const alive = Boolean((proc && isProcessAlive && isProcessAlive(proc.pid)) || isOpenBrowser);
      const cached = clientStateCacheByPort ? clientStateCacheByPort.get(p.debugPort) : null;
      const age = cached ? (Date.now() - Number(cached.ts || 0)) : Infinity;
      if ((alive && age > 12000) || (!cached && age > 12000)) {
        try {
          if (typeof queryClientState === "function") {
            await queryClientState(p.debugPort);
          }
        } catch (_) {}
      }
    });

    let onlineCount = 0;
    let farmingCount = 0;
    let jailedCount = 0;
    let bannedCount = 0;
    let totalZeny = 0;

    const clients = list.map(p => {
      const proc = runningProcesses && runningProcesses[p.id];
      const isOpenBrowser = Boolean(browserMode && typeof browserMode.isOpen === "function" && browserMode.isOpen(p.id));
      const cached = (p.debugPort && clientStateCacheByPort) ? clientStateCacheByPort.get(p.debugPort) : null;
      const freshState = (cached && cached.state && (Date.now() - Number(cached.ts || 0) < 60000)) ? cached.state : null;
      const isRunning = Boolean((proc && isProcessAlive && isProcessAlive(proc.pid)) || isOpenBrowser || (freshState && !freshState.error));
      const isBotRunning = Boolean(isRunning && freshState && freshState.isBotRunning);
      const isJailed = Boolean(p.isJailed || (freshState && freshState.isJailed));
      const isBanned = Boolean(p.isBanned || (freshState && (freshState.isBanned || freshState.banReason)));
      const hasPremium = Boolean(
        (isRunning && freshState && freshState.hasPremium) ||
        (Number(p.lastPremiumUntil) > Date.now())
      );

      let zenyVal = 0;
      if (isRunning && freshState && typeof freshState.zeny === "number" && Number.isFinite(freshState.zeny)) {
        zenyVal = Math.max(0, Math.floor(freshState.zeny));
      } else if (typeof p.lastZeny === "number" && Number.isFinite(p.lastZeny)) {
        zenyVal = Math.max(0, Math.floor(p.lastZeny));
      }

      let gph = 0;
      try {
        if (typeof updateZenyRateTracker === "function") {
          const rate = updateZenyRateTracker(p.id, isRunning ? freshState : null);
          gph = Math.max(0, Math.floor(Number(rate?.zenyPerHour || 0)));
        }
      } catch (_) {}

      if (isRunning) onlineCount++;
      if (isBotRunning) farmingCount++;
      if (isJailed) jailedCount++;
      if (isBanned) bannedCount++;
      totalZeny += zenyVal;

      let statusText = "ออฟไลน์";
      if (isBanned) statusText = "ถูกแบน";
      else if (isJailed) statusText = "ติดคุก";
      else if (isBotRunning) statusText = "กำลังฟาร์ม";
      else if (isRunning) statusText = "เปิดจอ";

      return {
        id: String(p.id || ""),
        name: String(p.name || p.lastCharName || p.id || "Client").slice(0, 48),
        charName: String((freshState && freshState.charName) || p.lastCharName || "").slice(0, 48),
        charClass: String((freshState && freshState.charClass) || p.lastCharClass || p.charClass || "").slice(0, 32),
        baseLv: Math.max(0, Math.floor(Number((freshState && freshState.baseLv) ?? p.lastBaseLv ?? 0) || 0)),
        jobLv: Math.max(0, Math.floor(Number((freshState && freshState.jobLv) ?? p.lastJobLv ?? 0) || 0)),
        map: String((freshState && freshState.map) || p.targetMap || "").slice(0, 48),
        zeny: zenyVal,
        gph,
        isRunning,
        isBotRunning,
        hasPremium,
        isJailed,
        isBanned,
        statusText
      };
    });

    cachedSummary = {
      totalProfiles: profiles.length,
      onlineCount,
      farmingCount,
      jailedCount,
      bannedCount,
      totalZeny,
      updatedAt: Date.now(),
      clients
    };
    cachedSummaryAt = cachedSummary.updatedAt;
    return cachedSummary;
  }

  function executeLocalApiRequest(reqSpec) {
    return new Promise((resolve) => {
      const requestId = String(reqSpec?.requestId || "");
      const method = String(reqSpec?.method || "GET").toUpperCase();
      if (!["GET", "POST", "PUT", "DELETE", "PATCH"].includes(method)) {
        const enc = encodeBody(JSON.stringify({ success: false, code: "METHOD_NOT_ALLOWED", error: "Method not allowed" }), "application/json");
        return resolve({ requestId, status: 405, headers: { "content-type": "application/json; charset=utf-8" }, ...enc });
      }
      const checked = validateRelayedApiPath(reqSpec?.path);
      if (!checked.ok) {
        const enc = encodeBody(JSON.stringify({ success: false, code: checked.code, error: checked.error }), "application/json");
        return resolve({ requestId, status: checked.status, headers: { "content-type": "application/json; charset=utf-8" }, ...enc });
      }

      let reqBuf = Buffer.alloc(0);
      try {
        reqBuf = decodeBody(reqSpec?.bodyEncoding || "none", reqSpec?.bodyData || "");
      } catch (e) {
        const enc = encodeBody(JSON.stringify({ success: false, error: "Invalid relayed body: " + e.message }), "application/json");
        return resolve({ requestId, status: 400, headers: { "content-type": "application/json; charset=utf-8" }, ...enc });
      }

      const headers = {
        "x-pmhee-remote-relay": "1",
        "accept": (reqSpec?.headers && reqSpec.headers.accept) || "application/json, text/plain, */*"
      };
      if (reqSpec?.headers && typeof reqSpec.headers["content-type"] === "string" && reqSpec.headers["content-type"]) {
        headers["content-type"] = reqSpec.headers["content-type"];
      } else if (reqBuf.length > 0 && method !== "GET") {
        headers["content-type"] = "application/json";
      }
      if (reqBuf.length > 0 && method !== "GET") {
        headers["content-length"] = String(reqBuf.length);
      }

      const port = Number(typeof getPort === "function" ? getPort() : 3888);
      let settled = false;
      const finishError = (status, msg) => {
        if (settled) return;
        settled = true;
        const enc = encodeBody(JSON.stringify({ success: false, error: msg }), "application/json");
        resolve({ requestId, status, headers: { "content-type": "application/json; charset=utf-8" }, ...enc, error: msg });
      };

      const localReq = http.request({
        hostname: "127.0.0.1",
        port,
        path: checked.fullPath,
        method,
        headers,
        timeout: 18000
      }, (proxyRes) => {
        const chunks = [];
        let totalBytes = 0;
        const maxRespBytes = 6 * 1024 * 1024;
        proxyRes.on("data", chunk => {
          if (settled) return;
          const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += b.length;
          if (totalBytes > maxRespBytes) {
            proxyRes.destroy();
            return finishError(502, "Local manager response too large for remote relay");
          }
          chunks.push(b);
        });
        proxyRes.on("end", () => {
          if (settled) return;
          settled = true;
          const outBuf = Buffer.concat(chunks);
          const outHeaders = {};
          for (const hName of ["content-type", "content-disposition", "cache-control"]) {
            if (typeof proxyRes.headers[hName] === "string" && proxyRes.headers[hName]) {
              outHeaders[hName] = proxyRes.headers[hName];
            }
          }
          const enc = encodeBody(outBuf, outHeaders["content-type"] || "");
          resolve({
            requestId,
            status: Number(proxyRes.statusCode || 200),
            headers: outHeaders,
            ...enc
          });
        });
        proxyRes.on("error", err => finishError(502, err?.message || "Local proxy read error"));
      });

      localReq.on("timeout", () => {
        try { localReq.destroy(); } catch (_) {}
        finishError(504, "Local manager route timed out");
      });
      localReq.on("error", err => finishError(502, err?.message || "Local manager connection error"));
      if (reqBuf.length > 0 && method !== "GET") {
        localReq.write(reqBuf);
      }
      localReq.end();
    });
  }

  async function workerLoop() {
    let errStreak = 0;
    let activeViewers = false;
    while (!stopped) {
      try {
        const access = typeof humanCheckSolver.getAccessState === "function" ? humanCheckSolver.getAccessState() : {};
        if (!access.isUserAccount || !access.username || access.requiresLogin || access.accessStatus !== "approved") {
          errStreak = 0;
          await sleepInterruptible(3000);
          continue;
        }
        const summary = await collectMachineSummary(false);
        const deviceName = typeof getEffectiveDeviceNickname === "function" ? getEffectiveDeviceNickname() : os.hostname();
        const res = await humanCheckSolver.fleetRequest("/v1/aetheria/machine/fleet/poll", {
          waitMs: activeViewers ? 15000 : 12000,
          deviceName,
          hostname: os.hostname(),
          managerVersion,
          summary
        }, { timeoutMs: 25000 });

        errStreak = 0;
        activeViewers = Boolean(res && res.activeViewers);
        if (res && typeof res.assignedDeviceName === "string" && res.assignedDeviceName.trim()) {
          const assigned = res.assignedDeviceName.trim().slice(0, 32);
          if (assigned && assigned !== deviceName && typeof setLocalDeviceNickname === "function") {
            try { setLocalDeviceNickname(assigned); } catch (_) {}
          }
        }
        const requests = Array.isArray(res?.requests) ? res.requests : [];
        if (requests.length > 0) {
          const replies = await Promise.all(requests.map(executeLocalApiRequest));
          await humanCheckSolver.fleetRequest("/v1/aetheria/machine/fleet/reply", { replies }, { timeoutMs: 15000 });
          continue;
        }
        await sleepInterruptible(activeViewers ? 150 : 1500);
      } catch (e) {
        errStreak = Math.min(4, errStreak + 1);
        const status = Number(e && e.status);
        const delay = (status === 401 || status === 403)
          ? 5000
          : Math.min(8000, 1500 * Math.pow(2, errStreak - 1));
        await sleepInterruptible(delay);
      }
    }
  }

  function start() {
    if (running) return;
    running = true;
    stopped = false;
    workerLoop().catch(() => {});
  }

  function stop() {
    stopped = true;
    running = false;
    wakeWorker();
  }

  function poke() {
    wakeWorker();
  }

  async function handleRoute(req, res, pathname, parsedUrl, sendJSON) {
    if (pathname === "/api/fleet/machines" && req.method === "GET") {
      const access = typeof humanCheckSolver.getAccessState === "function" ? humanCheckSolver.getAccessState() : {};
      if (!access.isUserAccount || !access.username || access.requiresLogin) {
        sendJSON({ success: false, code: "USER_ACCOUNT_REQUIRED", error: "กรุณาเข้าสู่ระบบด้วยบัญชีผู้ใช้งานก่อนดูเครื่องทั้งหมด" }, 401);
        return true;
      }
      try {
        const [data, localSummary] = await Promise.all([
          humanCheckSolver.fleetRequest("/v1/aetheria/machine/fleet/machines", null, { timeoutMs: 12000 }),
          collectMachineSummary(true)
        ]);
        const myKey = humanCheckSolver.getMachineHwidShort ? humanCheckSolver.getMachineHwidShort() : (data.currentMachineKey || "");
        const machines = Array.isArray(data?.machines) ? data.machines.slice() : [];
        const localNick = typeof getEffectiveDeviceNickname === "function" ? getEffectiveDeviceNickname() : os.hostname();
        let foundSelf = false;
        for (let i = 0; i < machines.length; i++) {
          const m = machines[i];
          if ((myKey && m.machineKey === myKey) || m.isCurrentMachine) {
            foundSelf = true;
            machines[i] = {
              ...m,
              isCurrentMachine: true,
              isOnline: true,
              remoteReady: true,
              legacyOnly: false,
              deviceName: localNick || m.deviceName,
              hostname: m.hostname || os.hostname(),
              managerVersion: m.managerVersion || managerVersion,
              lastSeenAt: Date.now(),
              summary: localSummary
            };
          }
        }
        if (!foundSelf && myKey) {
          machines.unshift({
            machineKey: myKey,
            hwidCode: myKey,
            deviceName: localNick,
            hostname: os.hostname(),
            managerVersion,
            lastSeenAt: Date.now(),
            isOnline: true,
            remoteReady: true,
            legacyOnly: false,
            isCurrentMachine: true,
            summary: localSummary
          });
        }
        sendJSON({
          success: true,
          username: data?.username || access.username,
          accountId: data?.accountId || access.accountId,
          currentMachineKey: myKey || data?.currentMachineKey || null,
          serverTime: data?.serverTime || Date.now(),
          ...(data?.walletSummary ? { walletSummary: data.walletSummary } : {}),
          machines
        });
      } catch (e) {
        sendJSON({ success: false, code: e?.code || "FLEET_FETCH_FAILED", error: e?.message || "โหลดรายการเครื่องไม่สำเร็จ" }, e?.status && e.status >= 400 ? e.status : 502);
      }
      return true;
    }

    if (pathname === "/api/fleet/rename" && req.method === "POST") {
      try {
        const buf = await readReqBuffer(req, 16384);
        const body = JSON.parse(buf.toString("utf8") || "{}");
        const targetMachineKey = String(body?.targetMachineKey || "").trim();
        const deviceName = String(body?.deviceName || "").trim().slice(0, 32);
        const result = await humanCheckSolver.fleetRequest("/v1/aetheria/machine/fleet/rename", { targetMachineKey, deviceName }, { timeoutMs: 12000 });
        const myKey = humanCheckSolver.getMachineHwidShort ? humanCheckSolver.getMachineHwidShort() : "";
        if (targetMachineKey && myKey && targetMachineKey === myKey && typeof setLocalDeviceNickname === "function") {
          try { setLocalDeviceNickname(deviceName); } catch (_) {}
        }
        sendJSON(result);
      } catch (e) {
        sendJSON({ success: false, code: e?.code || "FLEET_RENAME_FAILED", error: e?.message || "เปลี่ยนชื่อเครื่องไม่สำเร็จ" }, e?.status && e.status >= 400 ? e.status : 400);
      }
      return true;
    }

    if (pathname === "/api/fleet/remove" && req.method === "POST") {
      try {
        const buf = await readReqBuffer(req, 16384);
        const body = JSON.parse(buf.toString("utf8") || "{}");
        const targetMachineKey = String(body?.targetMachineKey || "").trim();
        const result = await humanCheckSolver.fleetRequest("/v1/aetheria/machine/fleet/remove", { targetMachineKey }, { timeoutMs: 12000 });
        sendJSON(result);
      } catch (e) {
        sendJSON({ success: false, code: e?.code || "FLEET_REMOVE_FAILED", error: e?.message || "ลบรายการเครื่องไม่สำเร็จ" }, e?.status && e.status >= 400 ? e.status : 400);
      }
      return true;
    }

    const proxyMatch = pathname.match(/^\/api\/fleet\/proxy\/([A-Za-z0-9_-]{3,64})(\/api\/.*)$/);
    if (proxyMatch) {
      const targetMachineKey = proxyMatch[1];
      const apiSubPath = proxyMatch[2] + (parsedUrl.search || "");
      const checked = validateRelayedApiPath(apiSubPath);
      if (!checked.ok) {
        sendJSON({ success: false, code: checked.code, error: checked.error }, checked.status);
        return true;
      }
      try {
        const reqBuf = (req.method === "GET" || req.method === "HEAD") ? Buffer.alloc(0) : await readReqBuffer(req, 2 * 1024 * 1024);
        const reqCt = String(req.headers["content-type"] || "");
        const myKey = humanCheckSolver.getMachineHwidShort ? humanCheckSolver.getMachineHwidShort() : "";

        let reply;
        if (myKey && targetMachineKey === myKey) {
          const encReq = encodeBody(reqBuf, reqCt);
          reply = await executeLocalApiRequest({
            requestId: "local",
            method: req.method,
            path: checked.fullPath,
            headers: {
              ...(reqCt ? { "content-type": reqCt } : {}),
              ...(req.headers.accept ? { accept: String(req.headers.accept) } : {})
            },
            ...encReq
          });
        } else {
          const encReq = encodeBody(reqBuf, reqCt);
          reply = await humanCheckSolver.fleetRequest("/v1/aetheria/machine/fleet/request", {
            targetMachineKey,
            method: req.method,
            path: checked.fullPath,
            headers: {
              ...(reqCt ? { "content-type": reqCt } : {}),
              ...(req.headers.accept ? { accept: String(req.headers.accept) } : {})
            },
            ...encReq,
            timeoutMs: 24000
          }, { timeoutMs: 26000 });
        }

        const outBuf = decodeBody(reply.bodyEncoding, reply.bodyData);
        const outHeaders = { "Cache-Control": "no-store" };
        if (reply.headers && typeof reply.headers["content-type"] === "string" && reply.headers["content-type"]) {
          outHeaders["Content-Type"] = reply.headers["content-type"];
        }
        if (reply.headers && typeof reply.headers["content-disposition"] === "string" && reply.headers["content-disposition"]) {
          outHeaders["Content-Disposition"] = reply.headers["content-disposition"];
        }
        res.writeHead(Number(reply.status || 200), outHeaders);
        res.end(outBuf);
      } catch (e) {
        sendJSON({
          success: false,
          code: e?.code || "REMOTE_PROXY_FAILED",
          error: e?.message || "ไม่สามารถติดต่อเครื่องเป้าหมายได้"
        }, e?.status && e.status >= 400 ? e.status : 502);
      }
      return true;
    }

    if (pathname === "/remote-bootstrap.js" && req.method === "GET") {
      const mKey = String(parsedUrl.searchParams.get("machine") || "").trim();
      if (!/^[A-Za-z0-9_-]{3,64}$/.test(mKey)) {
        res.writeHead(400, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
        res.end("console.error('Invalid remote machine key');");
        return true;
      }
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(buildRemoteBootstrapJs(mKey));
      return true;
    }

    const remoteRootMatch = pathname.match(/^\/remote\/([A-Za-z0-9_-]{3,64})$/);
    if (remoteRootMatch && req.method === "GET") {
      res.writeHead(302, { Location: `/remote/${remoteRootMatch[1]}/` });
      res.end();
      return true;
    }

    const remoteMatch = pathname.match(/^\/remote\/([A-Za-z0-9_-]{3,64})\/(.*)$/);
    if (remoteMatch && req.method === "GET") {
      const mKey = remoteMatch[1];
      const rel = remoteMatch[2] || "index.html";
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      if (rel === "" || rel === "index.html") {
        const indexPath = path.join(publicDir, "index.html");
        try {
          let html = fs.readFileSync(indexPath, "utf8");
          const scriptTag = `<script src="/remote-bootstrap.js?machine=${encodeURIComponent(mKey)}"></script>`;
          if (/<head\b[^>]*>/i.test(html)) {
            html = html.replace(/<head\b[^>]*>/i, match => `${match}\n  ${scriptTag}`);
          } else {
            html = `${scriptTag}\n${html}`;
          }
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache, no-store, must-revalidate"
          });
          res.end(html);
        } catch (_) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("404 Not Found");
        }
        return true;
      }

      const resolved = path.resolve(publicDir, rel);
      const pubRoot = path.resolve(publicDir);
      if (!resolved.startsWith(pubRoot + path.sep)) {
        sendJSON({ success: false }, 403);
        return true;
      }
      let targetFile = resolved;
      try {
        if (!fs.existsSync(targetFile) || !fs.statSync(targetFile).isFile()) {
          targetFile = path.join(pubRoot, "index.html");
        }
        const ext = path.extname(targetFile).toLowerCase();
        const ct = STATIC_MIME_TYPES[ext] || "application/octet-stream";
        res.writeHead(200, {
          "Content-Type": ct,
          "Cache-Control": "no-cache, no-store, must-revalidate"
        });
        res.end(fs.readFileSync(targetFile));
      } catch (_) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
      }
      return true;
    }

    return false;
  }

  return {
    start,
    stop,
    poke,
    collectMachineSummary,
    handleRoute,
    encodeBody,
    decodeBody,
    validateRelayedApiPath,
    executeLocalApiRequest
  };
}

module.exports = {
  createRemoteFleetService,
  encodeBody,
  decodeBody,
  validateRelayedApiPath
};
