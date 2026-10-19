'use strict';
// manager/screen_proxy_manager.js
// Per-Screen IP Queue (1 IP : 3 Screens) & Local Per-Profile Split-Tunnel Proxy Forwarder
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { createAssetCache } = require('./asset_cache');

const DEFAULT_MAX_SCREENS_PER_IP = 3;
const LEASE_TTL_MS = 180000;


function isGameOrIpCheckHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/:\d+$/, '');
  if (!h) return false;
  return (
    h === 'aetheria-online.in.th' ||
    h.endsWith('.aetheria-online.in.th') ||
    h === 'api.ipify.org'
  );
}

function parseProxyPoolText(rawInput, defaultMaxScreens = DEFAULT_MAX_SCREENS_PER_IP) {
  const maxPerIp = Math.max(1, Math.min(20, Number(defaultMaxScreens) || DEFAULT_MAX_SCREENS_PER_IP));
  let lines = [];
  if (typeof rawInput === 'string') {
    lines = rawInput.split(/\r?\n/);
  } else if (Array.isArray(rawInput)) {
    lines = rawInput;
  } else if (rawInput && typeof rawInput === 'object') {
    if (Array.isArray(rawInput.proxies)) lines = rawInput.proxies;
    else if (typeof rawInput.rawText === 'string') lines = rawInput.rawText.split(/\r?\n/);
  }

  const seen = new Set();
  const out = [];
  for (const item of lines) {
    let scheme = 'http', host = '', port = 0, user = '', pass = '', labelIp = '', itemMax = maxPerIp, enabled = true;
    if (typeof item === 'string') {
      let s = item.trim();
      if (!s || s.startsWith('#') || s.startsWith('//')) continue;
      const schemeMatch = s.match(/^(https?|socks5):\/\//i);
      if (schemeMatch) {
        scheme = schemeMatch[1].toLowerCase() === 'socks5' ? 'socks5' : 'http';
        s = s.slice(schemeMatch[0].length);
      }
      if (s.includes('@')) {
        const atIdx = s.lastIndexOf('@');
        const left = s.slice(0, atIdx);
        const right = s.slice(atIdx + 1);
        const leftParts = left.split(':');
        const rightParts = right.split(':');
        if (rightParts.length === 2 && /^\d+$/.test(rightParts[1])) {
          host = rightParts[0].trim();
          port = Number(rightParts[1]);
          user = leftParts[0] || '';
          pass = leftParts.slice(1).join(':') || '';
        } else if (leftParts.length === 2 && /^\d+$/.test(leftParts[1])) {
          host = leftParts[0].trim();
          port = Number(leftParts[1]);
          user = rightParts[0] || '';
          pass = rightParts.slice(1).join(':') || '';
        }
      } else {
        const parts = s.split(':');
        if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
          host = parts[0].trim();
          port = Number(parts[1]);
          if (parts.length >= 4) {
            user = parts[2];
            pass = parts.slice(3).join(':');
          } else if (parts.length === 3) {
            user = parts[2];
          }
        }
      }
      labelIp = host;
    } else if (item && typeof item === 'object') {
      if (item.enabled === false) enabled = false;
      scheme = String(item.scheme || 'http').toLowerCase() === 'socks5' ? 'socks5' : 'http';
      host = String(item.host || item.proxyHost || item.ip || '').trim();
      port = Number(item.port || item.proxyPort || 0);
      user = String(item.user ?? item.proxyUser ?? '').trim();
      pass = String(item.pass ?? item.proxyPass ?? '');
      labelIp = String(item.labelIp || item.ip || host).trim();
      if (Number.isInteger(item.maxScreens) && item.maxScreens >= 1 && item.maxScreens <= 20) {
        itemMax = item.maxScreens;
      }
    }
    if (!host || !/^[A-Za-z0-9.-]{1,253}$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    const proxyId = 'px_' + crypto.createHash('sha256').update(`${scheme}|${host.toLowerCase()}|${port}|${user}`).digest('hex').slice(0, 24);
    if (seen.has(proxyId)) continue;
    seen.add(proxyId);
    out.push({
      proxyId,
      sortOrder: out.length,
      scheme,
      protocol: scheme,
      host,
      proxyHost: host,
      port,
      proxyPort: port,
      user,
      proxyUser: user,
      pass,
      proxyPass: pass,
      labelIp: labelIp || host,
      maxScreens: itemMax,
      enabled
    });
  }
  return out;
}

function connectViaHttpProxy({ proxyHost, proxyPort, proxyUser, proxyPass, targetHost, targetPort, timeoutMs = 12000 }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const headers = { Host: `${targetHost}:${targetPort}` };
    if (proxyUser || proxyPass) {
      headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${proxyUser || ''}:${proxyPass || ''}`).toString('base64');
    }
    const req = http.request({
      host: proxyHost,
      port: proxyPort,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers,
      timeout: timeoutMs
    });
    const fail = err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const timer = setTimeout(() => fail(new Error('UPSTREAM_PROXY_TIMEOUT')), timeoutMs);
    timer.unref?.();
    req.on('connect', (res, socket, head) => {
      if (settled) {
        socket.destroy();
        return;
      }
      if (res.statusCode !== 200) {
        socket.destroy();
        return fail(new Error(`UPSTREAM_PROXY_HTTP_${res.statusCode}`));
      }
      settled = true;
      clearTimeout(timer);
      socket.setTimeout(0);
      socket.setNoDelay(true);
      try { socket.setKeepAlive(true, 15000); } catch (_) {}
      resolve({ socket, head });
    });
    req.on('timeout', () => fail(new Error('UPSTREAM_PROXY_TIMEOUT')));
    req.on('error', err => fail(err));
    req.end();
  });
}

function connectViaSocks5Proxy({ proxyHost, proxyPort, proxyUser, proxyPass, targetHost, targetPort, timeoutMs = 12000 }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = net.connect({ host: proxyHost, port: proxyPort });
    const fail = err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const timer = setTimeout(() => fail(new Error('SOCKS5_PROXY_TIMEOUT')), timeoutMs);
    timer.unref?.();

    let buf = Buffer.alloc(0);
    let stage = 'greeting';
    const hasAuth = Boolean(proxyUser || proxyPass);

    function sendConnectCmd() {
      stage = 'connect';
      const hostBytes = Buffer.from(targetHost, 'utf8');
      const req = Buffer.alloc(4 + 1 + hostBytes.length + 2);
      req[0] = 0x05;
      req[1] = 0x01; // CONNECT
      req[2] = 0x00;
      req[3] = 0x03; // DOMAINNAME
      req[4] = hostBytes.length;
      hostBytes.copy(req, 5);
      req.writeUInt16BE(Number(targetPort), 5 + hostBytes.length);
      socket.write(req);
    }

    socket.once('connect', () => {
      socket.setNoDelay(true);
      try { socket.setKeepAlive(true, 15000); } catch (_) {}
      if (hasAuth) {
        socket.write(Buffer.from([0x05, 0x02, 0x00, 0x02]));
      } else {
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
      }
    });

    const onData = chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 'greeting') {
        if (buf.length < 2) return;
        if (buf[0] !== 0x05) return fail(new Error('SOCKS5_BAD_VERSION'));
        const method = buf[1];
        buf = buf.slice(2);
        if (method === 0x00) {
          sendConnectCmd();
        } else if (method === 0x02 && hasAuth) {
          stage = 'auth';
          const uBytes = Buffer.from(String(proxyUser || ''), 'utf8');
          const pBytes = Buffer.from(String(proxyPass || ''), 'utf8');
          const authPacket = Buffer.concat([
            Buffer.from([0x01, uBytes.length]),
            uBytes,
            Buffer.from([pBytes.length]),
            pBytes
          ]);
          socket.write(authPacket);
        } else {
          return fail(new Error('SOCKS5_AUTH_METHOD_UNSUPPORTED'));
        }
      }
      if (stage === 'auth') {
        if (buf.length < 2) return;
        const status = buf[1];
        buf = buf.slice(2);
        if (status !== 0x00) return fail(new Error('SOCKS5_AUTH_REJECTED'));
        sendConnectCmd();
      }
      if (stage === 'connect') {
        if (buf.length < 4) return;
        if (buf[1] !== 0x00) return fail(new Error(`SOCKS5_CONNECT_FAILED_${buf[1]}`));
        const atyp = buf[3];
        let needed = 4;
        if (atyp === 0x01) needed += 4 + 2;
        else if (atyp === 0x03) {
          if (buf.length < 5) return;
          needed += 1 + buf[4] + 2;
        } else if (atyp === 0x04) needed += 16 + 2;
        else return fail(new Error('SOCKS5_BAD_ATYP'));
        if (buf.length < needed) return;
        const head = buf.slice(needed);
        socket.removeListener('data', onData);
        settled = true;
        clearTimeout(timer);
        socket.setTimeout(0);
        resolve({ socket, head });
      }
    };

    socket.on('data', onData);
    socket.on('error', fail);
  });
}

async function connectUpstream({ lease, targetHost, targetPort, timeoutMs = 12000, maxAttempts = 3 }) {
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  const perAttemptTimeout = attempts > 1 ? Math.max(3500, Math.min(timeoutMs, 5500)) : timeoutMs;
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      if (lease.scheme === 'socks5') {
        return await connectViaSocks5Proxy({
          proxyHost: lease.proxyHost,
          proxyPort: lease.proxyPort,
          proxyUser: lease.proxyUser,
          proxyPass: lease.proxyPass,
          targetHost,
          targetPort,
          timeoutMs: perAttemptTimeout
        });
      }
      return await connectViaHttpProxy({
        proxyHost: lease.proxyHost,
        proxyPort: lease.proxyPort,
        proxyUser: lease.proxyUser,
        proxyPass: lease.proxyPass,
        targetHost,
        targetPort,
        timeoutMs: perAttemptTimeout
      });
    } catch (err) {
      lastErr = err;
      if (i + 1 < attempts) {
        await new Promise(r => setTimeout(r, 250 * (i + 1)));
      }
    }
  }
  throw lastErr || new Error('UPSTREAM_PROXY_FAILED');
}

function createScreenProxyManager({ dataDir, solver, loadProfiles, assetCache: providedAssetCache, now = Date.now } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const settingsFile = path.join(dataDir, 'screen_proxy_settings.json');
  const poolFile = path.join(dataDir, 'screen_proxy_pool.json');
  const leasesFile = path.join(dataDir, 'screen_proxy_leases.json');
  const assetCache = providedAssetCache || createAssetCache({ dataDir, now });

  const tunnels = new Map();       // profileId -> { server, port, sockets: Set }
  const activeLeases = new Map();  // profileId -> lease object
  const stickyHistory = new Map(); // profileId -> proxyId

  const trafficState = {
    startedAt: now(),
    proxyRxBytes: 0,
    proxyTxBytes: 0,
    directRxBytes: 0,
    directTxBytes: 0,
    byProfile: {}
  };

  function recordTraffic(profileId, rxBytes = 0, txBytes = 0, viaProxy = true) {
    const rx = Math.max(0, Number(rxBytes) || 0);
    const tx = Math.max(0, Number(txBytes) || 0);
    if (rx === 0 && tx === 0) return;
    if (viaProxy) {
      trafficState.proxyRxBytes += rx;
      trafficState.proxyTxBytes += tx;
    } else {
      trafficState.directRxBytes += rx;
      trafficState.directTxBytes += tx;
    }
    if (profileId) {
      let p = trafficState.byProfile[profileId];
      if (!p) {
        p = trafficState.byProfile[profileId] = {
          proxyRxBytes: 0,
          proxyTxBytes: 0,
          directRxBytes: 0,
          directTxBytes: 0,
          updatedAt: now()
        };
      }
      if (viaProxy) {
        p.proxyRxBytes += rx;
        p.proxyTxBytes += tx;
      } else {
        p.directRxBytes += rx;
        p.directTxBytes += tx;
      }
      p.updatedAt = now();
    }
  }

  function getTrafficStats() {
    const elapsedSec = Math.max(1, Math.round((now() - trafficState.startedAt) / 1000));
    const proxyTotalBytes = trafficState.proxyRxBytes + trafficState.proxyTxBytes;
    const directTotalBytes = trafficState.directRxBytes + trafficState.directTxBytes;
    const proxyBps = elapsedSec >= 2 ? Math.round(proxyTotalBytes / elapsedSec) : 0;
    const cacheStatus = assetCache ? assetCache.getStatus() : null;
    return {
      startedAt: trafficState.startedAt,
      elapsedSec,
      proxyRxBytes: trafficState.proxyRxBytes,
      proxyTxBytes: trafficState.proxyTxBytes,
      proxyTotalBytes,
      proxyBps,
      proxyBytesPerHour: proxyBps * 3600,
      directRxBytes: trafficState.directRxBytes,
      directTxBytes: trafficState.directTxBytes,
      directTotalBytes,
      byProfile: trafficState.byProfile,
      assetCache: cacheStatus
    };
  }

  function resetTrafficStats({ resetAssetCacheStats = true } = {}) {
    trafficState.startedAt = now();
    trafficState.proxyRxBytes = 0;
    trafficState.proxyTxBytes = 0;
    trafficState.directRxBytes = 0;
    trafficState.directTxBytes = 0;
    trafficState.byProfile = {};
    if (resetAssetCacheStats && assetCache && typeof assetCache.resetStats === 'function') {
      assetCache.resetStats();
    }
    return getTrafficStats();
  }

  function readJson(file, fallback) {
    try {
      if (!fs.existsSync(file)) return fallback;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  // Load persisted sticky history
  try {
    const savedLeases = readJson(leasesFile, {});
    if (savedLeases && typeof savedLeases.sticky === 'object') {
      for (const [k, v] of Object.entries(savedLeases.sticky)) {
        if (typeof k === 'string' && typeof v === 'string') stickyHistory.set(k, v);
      }
    }
  } catch (_) {}

  function saveStickyHistory() {
    try {
      writeJson(leasesFile, {
        updatedAt: now(),
        sticky: Object.fromEntries(stickyHistory)
      });
    } catch (_) {}
  }

  function loadSettings() {
    const raw = readJson(settingsFile, {});
    const maxScreensPerIp = Math.max(1, Math.min(10, parseInt(raw.maxScreensPerIp, 10) || DEFAULT_MAX_SCREENS_PER_IP));
    const mode = raw.mode === 'local-pool' ? 'local-pool' : 'owner-queue';
    const localAssetCache = raw.localAssetCache !== false;
    return {
      enabled: raw.enabled === true,
      mode,
      maxScreensPerIp,
      onlyGameTraffic: raw.onlyGameTraffic !== false,
      localAssetCache,
      lastTestedIp: raw.lastTestedIp || null,
      lastTestedAt: raw.lastTestedAt || null,
      updatedAt: raw.updatedAt || null
    };
  }

  function saveSettings(patch = {}) {
    const cur = loadSettings();
    const next = {
      ...cur,
      ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
      ...(patch.mode === 'local-pool' || patch.mode === 'owner-queue' ? { mode: patch.mode } : {}),
      ...(patch.maxScreensPerIp !== undefined ? { maxScreensPerIp: Math.max(1, Math.min(10, parseInt(patch.maxScreensPerIp, 10) || DEFAULT_MAX_SCREENS_PER_IP)) } : {}),
      ...(typeof patch.onlyGameTraffic === 'boolean' ? { onlyGameTraffic: patch.onlyGameTraffic } : {}),
      ...(typeof patch.localAssetCache === 'boolean' ? { localAssetCache: patch.localAssetCache } : {}),
      ...(patch.lastTestedIp !== undefined ? { lastTestedIp: patch.lastTestedIp } : {}),
      ...(patch.lastTestedAt !== undefined ? { lastTestedAt: patch.lastTestedAt } : {}),
      updatedAt: now()
    };
    writeJson(settingsFile, next);
    if (assetCache && typeof assetCache.setEnabled === 'function') {
      assetCache.setEnabled(next.localAssetCache !== false);
    }
    return loadSettings();
  }

  // Sync initial localAssetCache flag to assetCache
  try {
    const initSt = loadSettings();
    if (assetCache && typeof assetCache.setEnabled === 'function') {
      assetCache.setEnabled(initSt.localAssetCache !== false);
    }
  } catch (_) {}


  function loadPool() {
    const settings = loadSettings();
    const raw = readJson(poolFile, { rawText: '', proxies: [] });
    const rawText = typeof raw.rawText === 'string' ? raw.rawText : '';
    const proxies = parseProxyPoolText(rawText || raw.proxies || [], settings.maxScreensPerIp);
    return { rawText, proxies };
  }

  function savePool(rawText, maxScreensPerIp) {
    const s = loadSettings();
    const maxPerIp = maxScreensPerIp || s.maxScreensPerIp || DEFAULT_MAX_SCREENS_PER_IP;
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    const proxies = parseProxyPoolText(text, maxPerIp);
    writeJson(poolFile, {
      updatedAt: now(),
      maxScreensPerIp: maxPerIp,
      rawText: text,
      proxies
    });
    return { rawText: text, proxies };
  }

  function getMachineId() {
    try {
      return solver?.getMachineFingerprint?.()?.slice(0, 32) || 'local_machine';
    } catch (_) {
      return 'local_machine';
    }
  }

  // Local 1 IP : 3 Screens Queue Allocator
  function allocateFromLocalPool(requestedProfiles) {
    const settings = loadSettings();
    const { proxies } = loadPool();
    const enabledPool = proxies.filter(p => p.enabled !== false);
    const poolMap = new Map(enabledPool.map(p => [p.proxyId, p]));
    const maxPerIp = settings.maxScreensPerIp || DEFAULT_MAX_SCREENS_PER_IP;

    // Prune activeLeases for profiles whose proxy is no longer in pool
    for (const [pid, l] of Array.from(activeLeases.entries())) {
      if (!poolMap.has(l.proxyId)) activeLeases.delete(pid);
    }

    const slotsByProxy = new Map();
    for (const p of enabledPool) slotsByProxy.set(p.proxyId, new Map());
    for (const [pid, l] of activeLeases.entries()) {
      const m = slotsByProxy.get(l.proxyId);
      if (m) m.set(pid, l.slotNo || 1);
    }

    const pickFreeSlotNo = (usedMap, maxScreens) => {
      const taken = new Set(usedMap.values());
      for (let s = 1; s <= maxScreens; s++) {
        if (!taken.has(s)) return s;
      }
      return usedMap.size + 1;
    };

    const results = [];
    let stickyChanged = false;

    for (const reqItem of requestedProfiles) {
      const pid = reqItem.profileId;
      let chosenProxy = null;
      let chosenSlotNo = 1;

      const existing = activeLeases.get(pid);
      const stickyProxyId = existing?.proxyId || stickyHistory.get(pid);

      if (stickyProxyId && poolMap.has(stickyProxyId)) {
        const cand = poolMap.get(stickyProxyId);
        const usedMap = slotsByProxy.get(cand.proxyId);
        const cap = cand.maxScreens || maxPerIp;
        if (usedMap.has(pid) && usedMap.size <= cap) {
          chosenProxy = cand;
          chosenSlotNo = usedMap.get(pid);
        } else if (!usedMap.has(pid) && usedMap.size < cap) {
          chosenProxy = cand;
          chosenSlotNo = pickFreeSlotNo(usedMap, cap);
          usedMap.set(pid, chosenSlotNo);
        }
      }

      if (!chosenProxy) {
        for (const cand of enabledPool) {
          const usedMap = slotsByProxy.get(cand.proxyId);
          const cap = cand.maxScreens || maxPerIp;
          if (usedMap.has(pid)) usedMap.delete(pid);
          if (usedMap.size < cap) {
            chosenProxy = cand;
            chosenSlotNo = pickFreeSlotNo(usedMap, cap);
            usedMap.set(pid, chosenSlotNo);
            break;
          }
        }
      }

      if (!chosenProxy) {
        results.push({
          assigned: false,
          profileId: pid,
          code: enabledPool.length === 0 ? 'IP_POOL_EMPTY' : 'IP_POOL_EXHAUSTED',
          error: enabledPool.length === 0 ? 'ยังไม่ได้ใส่รายการ Proxy IP' : `คิว IP เต็มทุกช่องแล้ว (1 IP : ${maxPerIp} จอ)`
        });
        continue;
      }

      const usedMap = slotsByProxy.get(chosenProxy.proxyId);
      const leaseObj = {
        assigned: true,
        profileId: pid,
        proxyId: chosenProxy.proxyId,
        ip: chosenProxy.labelIp,
        scheme: chosenProxy.scheme,
        proxyHost: chosenProxy.host,
        proxyPort: chosenProxy.port,
        proxyUser: chosenProxy.user,
        proxyPass: chosenProxy.pass,
        slotNo: chosenSlotNo,
        maxScreens: chosenProxy.maxScreens || maxPerIp,
        activeOnIp: usedMap ? usedMap.size : 1,
        source: 'local-pool',
        expiresAt: now() + LEASE_TTL_MS
      };
      activeLeases.set(pid, leaseObj);
      if (stickyHistory.get(pid) !== chosenProxy.proxyId) {
        stickyHistory.set(pid, chosenProxy.proxyId);
        stickyChanged = true;
      }
      results.push(leaseObj);
    }

    // Update activeOnIp across all activeLeases
    for (const l of activeLeases.values()) {
      const m = slotsByProxy.get(l.proxyId);
      if (m) l.activeOnIp = m.size;
    }
    if (stickyChanged) saveStickyHistory();
    return results;
  }

  async function acquireLeasesForProfiles(profileIds = []) {
    const ids = Array.from(new Set(profileIds.filter(Boolean)));
    if (ids.length === 0) return [];
    const settings = loadSettings();
    if (!settings.enabled) return [];

    const reqProfiles = ids.map(profileId => ({ profileId }));

    if (settings.mode === 'owner-queue' && typeof solver?.serviceRequest === 'function') {
      try {
        const res = await solver.serviceRequest('/v1/aetheria/proxy/screen-lease', {
          machineId: getMachineId(),
          profiles: reqProfiles
        });
        if (res?.success && Array.isArray(res.leases)) {
          const hasAnyAssigned = res.leases.some(l => l.assigned);
          const allEmpty = res.leases.every(l => l.code === 'IP_POOL_EMPTY');
          if (hasAnyAssigned || (!allEmpty && loadPool().proxies.length === 0)) {
            for (const l of res.leases) {
              if (l.assigned) {
                activeLeases.set(l.profileId, { ...l, source: 'owner-queue' });
                stickyHistory.set(l.profileId, l.proxyId);
              }
            }
            saveStickyHistory();
            return res.leases;
          }
        }
      } catch (_) {
        // If owner-host has a brief hiccup, keep existing active leases alive rather than dropping to empty local pool
        if (loadPool().proxies.length === 0) {
          const cached = ids.map(pid => activeLeases.get(pid)).filter(Boolean);
          if (cached.length > 0) return cached;
        }
      }
    }

    return allocateFromLocalPool(reqProfiles);
  }

  function resetProfileSockets(profileId) {
    const t = tunnels.get(profileId);
    if (!t) return;
    for (const sock of Array.from(t.sockets)) {
      try { sock.destroy(); } catch (_) {}
    }
    t.sockets.clear();
  }

  async function ensureProfileTunnel(profileId, debugPort = 49876) {
    const existing = tunnels.get(profileId);
    if (existing && existing.server && existing.server.listening) {
      return existing;
    }
    if (existing && existing.starting) return existing.starting;

    const sockets = new Set();
    const trackSocket = s => {
      if (!s) return;
      sockets.add(s);
      s.once('close', () => sockets.delete(s));
    };

    const server = http.createServer(async (req, res) => {
      // Standard HTTP request through tunnel
      let parsed;
      try { parsed = new URL(req.url); } catch (_) {
        res.writeHead(400);
        return res.end('Bad Request');
      }
      if (assetCache && assetCache.isEnabled() && req.method === 'GET' && assetCache.isCacheableAssetUrl(req.url)) {
        try {
          const cached = await assetCache.getOrFetch(req.url);
          if (cached && cached.ok && cached.buffer) {
            res.writeHead(200, {
              'Content-Type': cached.mimeType || 'application/octet-stream',
              'Content-Length': String(cached.size),
              'Cache-Control': 'public, max-age=31536000, immutable',
              'Access-Control-Allow-Origin': '*',
              'X-Pmhee-Asset-Cache': cached.hit ? 'HIT' : 'MISS-DIRECT'
            });
            return res.end(cached.buffer);
          }
        } catch (_) {}
      }
      const targetHost = parsed.hostname;
      const targetPort = Number(parsed.port) || 80;
      const settings = loadSettings();
      const lease = settings.enabled ? activeLeases.get(profileId) : null;
      const useProxy = Boolean(settings.enabled && lease?.assigned && (!settings.onlyGameTraffic || isGameOrIpCheckHost(targetHost)));

      const headers = { ...req.headers };
      delete headers['proxy-connection'];
      if (useProxy && (lease.proxyUser || lease.proxyPass)) {
        headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${lease.proxyUser || ''}:${lease.proxyPass || ''}`).toString('base64');
      }

      const proxyReq = http.request({
        host: useProxy && lease.scheme !== 'socks5' ? lease.proxyHost : targetHost,
        port: useProxy && lease.scheme !== 'socks5' ? lease.proxyPort : targetPort,
        method: req.method,
        path: useProxy && lease.scheme !== 'socks5' ? req.url : (parsed.pathname + parsed.search),
        headers,
        timeout: 15000
      }, proxyRes => {
        proxyRes.on('data', chunk => {
          recordTraffic(profileId, chunk.length, 0, useProxy);
        });
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      });
      req.on('data', chunk => {
        recordTraffic(profileId, 0, chunk.length, useProxy);
      });
      proxyReq.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end('Bad Gateway');
      });
      req.pipe(proxyReq);
    });

    server.on('connect', async (req, clientSocket, head) => {
      trackSocket(clientSocket);
      clientSocket.setNoDelay(true);
      try { clientSocket.setKeepAlive(true, 15000); } catch (_) {}
      const [rawHost, rawPort] = String(req.url || '').split(':');
      const targetHost = (rawHost || '').trim();
      const targetPort = Number(rawPort) || 443;
      if (!targetHost) {
        clientSocket.destroy();
        return;
      }

      const settings = loadSettings();
      let lease = settings.enabled ? activeLeases.get(profileId) : null;
      if (settings.enabled && !lease && isGameOrIpCheckHost(targetHost)) {
        try {
          await acquireLeasesForProfiles([profileId]);
          lease = activeLeases.get(profileId);
        } catch (_) {}
      }

      const shouldRouteViaProxy = Boolean(
        settings.enabled &&
        lease?.assigned &&
        (!settings.onlyGameTraffic || isGameOrIpCheckHost(targetHost))
      );

      if (!shouldRouteViaProxy) {
        // Direct connection
        const upstream = net.connect({ host: targetHost, port: targetPort }, () => {
          if (clientSocket.destroyed) { upstream.destroy(); return; }
          upstream.setNoDelay(true);
          try { upstream.setKeepAlive(true, 15000); } catch (_) {}
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head && head.length) {
            recordTraffic(profileId, 0, head.length, false);
            upstream.write(head);
          }
          upstream.on('data', chunk => recordTraffic(profileId, chunk.length, 0, false));
          clientSocket.on('data', chunk => recordTraffic(profileId, 0, chunk.length, false));
          upstream.pipe(clientSocket);
          clientSocket.pipe(upstream);
        });
        trackSocket(upstream);
        upstream.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => upstream.destroy());
        return;
      }

      // Connect through assigned upstream proxy (1 IP : 3 screens) with automatic fast retries
      try {
        const { socket: upstream, head: upstreamHead } = await connectUpstream({
          lease,
          targetHost,
          targetPort,
          timeoutMs: 12000,
          maxAttempts: 3
        });
        if (clientSocket.destroyed) {
          upstream.destroy();
          return;
        }
        trackSocket(upstream);
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head && head.length) {
          recordTraffic(profileId, 0, head.length, true);
          upstream.write(head);
        }
        if (upstreamHead && upstreamHead.length) {
          recordTraffic(profileId, upstreamHead.length, 0, true);
          clientSocket.write(upstreamHead);
        }
        upstream.on('data', chunk => recordTraffic(profileId, chunk.length, 0, true));
        clientSocket.on('data', chunk => recordTraffic(profileId, 0, chunk.length, true));
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
        upstream.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => upstream.destroy());
      } catch (err) {
        // Do NOT send HTTP/1.1 502 Bad Gateway on CONNECT, because Chromium caches 502 proxy responses
        // in BadProxyList for 10-20s and blocks subsequent page refreshes with ERR_TUNNEL_CONNECTION_FAILED.
        clientSocket.destroy();
      }
    });

    const preferredPort = 51000 + Math.max(0, (Number(debugPort) || 49876) - 49876);
    const starting = new Promise((resolve, reject) => {
      const tryListen = portToTry => {
        const onError = err => {
          server.removeListener('listening', onListening);
          if (portToTry !== 0 && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
            tryListen(0);
          } else {
            reject(err);
          }
        };
        const onListening = () => {
          server.removeListener('error', onError);
          const boundPort = server.address().port;
          const entry = { profileId, server, port: boundPort, proxyUrl: `http://127.0.0.1:${boundPort}`, sockets };
          tunnels.set(profileId, entry);
          resolve(entry);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(portToTry, '127.0.0.1');
      };
      tryListen(preferredPort);
    });

    tunnels.set(profileId, { profileId, server, port: 0, sockets, starting });
    return starting;
  }

  async function acquireForProfile(profileId, { debugPort = 49876 } = {}) {
    const settings = loadSettings();
    if (!settings.enabled) {
      return {
        enabled: false,
        tunnelPort: null,
        proxyServer: null,
        proxyServerUrl: null,
        lease: null
      };
    }
    const res = await acquireLeasesForProfiles([profileId]);
    const lease = res[0] || activeLeases.get(profileId) || null;
    if (!lease || !lease.assigned) {
      return {
        enabled: true,
        tunnelPort: null,
        proxyServer: null,
        proxyServerUrl: null,
        lease,
        error: lease?.error || 'ไม่มี IP ว่างในคิว'
      };
    }
    const tunnel = await ensureProfileTunnel(profileId, debugPort);
    return {
      enabled: true,
      tunnelPort: tunnel.port,
      proxyServer: tunnel.proxyUrl,
      proxyServerUrl: tunnel.proxyUrl,
      proxyHost: lease.proxyHost,
      proxyPort: lease.proxyPort,
      slotIndex: lease.slotNo,
      slotNo: lease.slotNo,
      maxScreensPerIp: lease.maxScreens || settings.maxScreensPerIp,
      lease
    };
  }

  async function releaseProfile(profileId) {
    const hadLease = activeLeases.has(profileId);
    activeLeases.delete(profileId);
    resetProfileSockets(profileId);
    if (hadLease && typeof solver?.serviceRequest === 'function') {
      solver.serviceRequest('/v1/aetheria/proxy/screen-release', {
        machineId: getMachineId(),
        profileIds: [profileId]
      }).catch(() => {});
    }
    return { success: true };
  }

  async function releaseAll() {
    activeLeases.clear();
    for (const pid of tunnels.keys()) resetProfileSockets(pid);
    if (typeof solver?.serviceRequest === 'function') {
      solver.serviceRequest('/v1/aetheria/proxy/screen-release', {
        machineId: getMachineId(),
        all: true
      }).catch(() => {});
    }
    return { success: true };
  }

  async function stopAllTunnels() {
    const closing = [];
    for (const t of tunnels.values()) {
      for (const s of t.sockets) { try { s.destroy(); } catch (_) {} }
      if (t.server && t.server.listening) {
        closing.push(new Promise(resolve => t.server.close(() => resolve())));
      }
    }
    tunnels.clear();
    await Promise.all(closing);
  }

  async function setEnabled(enabled, openProfileIds = []) {
    const updated = saveSettings({ enabled: Boolean(enabled) });
    if (!updated.enabled) {
      await releaseAll();
      await stopAllTunnels();
    } else if (openProfileIds.length > 0) {
      await acquireLeasesForProfiles(openProfileIds);
      for (const pid of openProfileIds) resetProfileSockets(pid);
    }
    return updated;
  }

  function publicSettings() {
    const settings = loadSettings();
    const { rawText, proxies } = loadPool();
    const enabledPool = proxies.filter(p => p.enabled !== false);
    const maxPerIp = settings.maxScreensPerIp || DEFAULT_MAX_SCREENS_PER_IP;
    const totalSlots = enabledPool.reduce((s, p) => s + (p.maxScreens || maxPerIp), 0);
    const activeLeaseCount = activeLeases.size;
    return {
      ...settings,
      poolCount: enabledPool.length,
      totalSlots,
      activeLeaseCount,
      freeSlots: Math.max(0, totalSlots - activeLeaseCount),
      poolText: rawText
    };
  }

  async function savePoolAndSettings(data = {}) {
    const updated = saveSettings({
      ...(typeof data.enabled === 'boolean' ? { enabled: data.enabled } : {}),
      ...(data.mode ? { mode: data.mode } : {}),
      ...(data.maxScreensPerIp !== undefined ? { maxScreensPerIp: data.maxScreensPerIp } : {}),
      ...(typeof data.onlyGameTraffic === 'boolean' ? { onlyGameTraffic: data.onlyGameTraffic } : {}),
      ...(typeof data.localAssetCache === 'boolean' ? { localAssetCache: data.localAssetCache } : {})
    });
    const rawPoolText = typeof data.poolText === 'string'
      ? data.poolText
      : (typeof data.rawText === 'string' ? data.rawText : null);
    let poolInfo = loadPool();
    if (rawPoolText !== null) {
      poolInfo = savePool(rawPoolText, updated.maxScreensPerIp);
    }
    return {
      success: true,
      settings: publicSettings(),
      pool: poolInfo
    };
  }

  async function testConnection(sampleProfileId = 'test_probe') {
    const { proxies } = loadPool();
    let targetLease = activeLeases.get(sampleProfileId) || Array.from(activeLeases.values())[0] || null;
    if (!targetLease) {
      const leases = await acquireLeasesForProfiles([sampleProfileId]);
      targetLease = leases.find(l => l.assigned) || null;
      if (sampleProfileId === 'test_probe') activeLeases.delete('test_probe');
    }
    if (!targetLease && proxies.length > 0) {
      const p = proxies[0];
      targetLease = {
        assigned: true,
        ip: p.labelIp,
        scheme: p.scheme,
        proxyHost: p.host,
        proxyPort: p.port,
        proxyUser: p.user,
        proxyPass: p.pass,
        slotNo: 1,
        maxScreens: p.maxScreens
      };
    }
    if (!targetLease || !targetLease.assigned) {
      return {
        success: false,
        error: 'ยังไม่มี Proxy IP ในคิว กรุณาเพิ่มรายการ Proxy (ip:port:user:pass) ก่อนทดสอบ'
      };
    }

    const t0 = Date.now();
    try {
      const { socket } = await connectUpstream({
        lease: targetLease,
        targetHost: 'api.ipify.org',
        targetPort: 443,
        timeoutMs: 10000
      });
      const egressIp = await new Promise((resolve, reject) => {
        const secure = tls.connect({ socket, servername: 'api.ipify.org' }, () => {
          secure.write('GET /?format=json HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n');
        });
        let raw = '';
        secure.setEncoding('utf8');
        secure.on('data', c => { raw += c; });
        secure.on('end', () => {
          const body = raw.split('\r\n\r\n').slice(1).join('\r\n\r\n');
          try {
            const j = JSON.parse(body.trim());
            if (j && j.ip) return resolve(j.ip);
          } catch (_) {}
          const m = body.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
          if (m) return resolve(m[1]);
          reject(new Error('INVALID_IP_RESPONSE'));
        });
        secure.on('error', reject);
      });
      const latencyMs = Date.now() - t0;
      saveSettings({ lastTestedIp: egressIp, lastTestedAt: now() });
      return {
        success: true,
        ip: egressIp,
        proxyHost: targetLease.proxyHost,
        proxyPort: targetLease.proxyPort,
        scheme: targetLease.scheme,
        latencyMs
      };
    } catch (e) {
      return {
        success: false,
        error: `เชื่อมต่อ Proxy (${targetLease.proxyHost}:${targetLease.proxyPort}) ไม่สำเร็จ: ${e.message}`
      };
    }
  }

  async function testProxy({ profileId } = {}) {
    return testConnection(profileId || 'test_probe');
  }

  async function getStatus(openProfileIds = []) {
    const pub = publicSettings();
    const { rawText, proxies } = loadPool();
    const enabledPool = proxies.filter(p => p.enabled !== false);
    const maxPerIp = pub.maxScreensPerIp || DEFAULT_MAX_SCREENS_PER_IP;

    if (pub.enabled && Array.isArray(openProfileIds) && openProfileIds.length > 0) {
      const missing = openProfileIds.filter(pid => !activeLeases.has(pid));
      if (missing.length > 0) {
        await acquireLeasesForProfiles(missing).catch(() => {});
      }
    }

    let remoteSummary = null;
    if (pub.mode === 'owner-queue' && typeof solver?.serviceRequest === 'function') {
      try {
        const r = await solver.serviceRequest('/v1/aetheria/proxy/screen-status', { machineId: getMachineId() });
        if (r?.success && r.totalIps > 0) remoteSummary = r;
      } catch (_) {}
    }

    const totalIps = remoteSummary ? remoteSummary.totalIps : enabledPool.length;
    const totalCapacity = remoteSummary ? remoteSummary.totalCapacity : enabledPool.reduce((s, p) => s + (p.maxScreens || maxPerIp), 0);
    const activeCount = remoteSummary ? remoteSummary.activeLeases : activeLeases.size;

    const allProfiles = typeof loadProfiles === 'function' ? (loadProfiles() || []) : [];
    const openSet = new Set(Array.isArray(openProfileIds) ? openProfileIds : []);

    const leases = Array.from(activeLeases.values()).filter(l => l && l.assigned).map(l => {
      const tunnel = tunnels.get(l.profileId) || null;
      const pTraffic = trafficState.byProfile[l.profileId] || { proxyRxBytes: 0, proxyTxBytes: 0 };
      return {
        profileId: l.profileId,
        proxyId: l.proxyId,
        ip: l.ip,
        proxyHost: l.proxyHost,
        proxyPort: l.proxyPort,
        slotNo: l.slotNo,
        slotIndex: l.slotNo,
        maxScreens: l.maxScreens || maxPerIp,
        maxScreensPerIp: l.maxScreens || maxPerIp,
        activeOnIp: l.activeOnIp || 1,
        scheme: l.scheme || 'http',
        tunnelPort: tunnel?.port || null,
        proxyRxBytes: pTraffic.proxyRxBytes || 0,
        proxyTxBytes: pTraffic.proxyTxBytes || 0,
        proxyTotalBytes: (pTraffic.proxyRxBytes || 0) + (pTraffic.proxyTxBytes || 0)
      };
    });

    const assignments = allProfiles.map(p => {
      const lease = activeLeases.get(p.id) || null;
      const tunnel = tunnels.get(p.id) || null;
      const pTraffic = trafficState.byProfile[p.id] || { proxyRxBytes: 0, proxyTxBytes: 0 };
      return {
        profileId: p.id,
        profileName: p.name,
        running: openSet.has(p.id) || Boolean(lease?.assigned && tunnel),
        assigned: Boolean(pub.enabled && lease?.assigned),
        ip: pub.enabled && lease?.assigned ? lease.ip : null,
        proxyHost: pub.enabled && lease?.assigned ? lease.proxyHost : null,
        proxyPort: pub.enabled && lease?.assigned ? lease.proxyPort : null,
        slotNo: pub.enabled && lease?.assigned ? lease.slotNo : null,
        slotIndex: pub.enabled && lease?.assigned ? lease.slotNo : null,
        maxScreens: pub.enabled && lease?.assigned ? (lease.maxScreens || maxPerIp) : maxPerIp,
        maxScreensPerIp: pub.enabled && lease?.assigned ? (lease.maxScreens || maxPerIp) : maxPerIp,
        activeOnIp: pub.enabled && lease?.assigned ? (lease.activeOnIp || 1) : 0,
        scheme: lease?.scheme || 'http',
        tunnelPort: tunnel?.port || null,
        proxyRxBytes: pTraffic.proxyRxBytes || 0,
        proxyTxBytes: pTraffic.proxyTxBytes || 0,
        proxyTotalBytes: (pTraffic.proxyRxBytes || 0) + (pTraffic.proxyTxBytes || 0)
      };
    });

    const traffic = getTrafficStats();

    return {
      success: true,
      settings: {
        ...pub,
        poolCount: totalIps,
        totalSlots: totalCapacity,
        activeLeaseCount: activeCount,
        freeSlots: Math.max(0, totalCapacity - activeCount)
      },
      pool: {
        totalIps,
        maxScreensPerIp: maxPerIp,
        totalCapacity,
        activeLeases: activeCount,
        availableSlots: Math.max(0, totalCapacity - activeCount),
        rawText,
        items: enabledPool.map(p => ({
          proxyId: p.proxyId,
          ip: p.labelIp,
          host: p.host,
          port: p.port,
          scheme: p.scheme,
          hasAuth: Boolean(p.user || p.pass),
          maxScreens: p.maxScreens || maxPerIp
        }))
      },
      leases,
      assignments,
      traffic,
      assetCache: traffic.assetCache
    };
  }

  async function getQueueStatus(opts = {}) {
    const openIds = Array.isArray(opts.openProfileIds) ? opts.openProfileIds : [];
    return getStatus(openIds);
  }

  function getProfileLeaseSnapshot(profileId) {
    const settings = loadSettings();
    if (!settings.enabled) return { active: false };
    const l = activeLeases.get(profileId);
    if (!l || !l.assigned) return { active: false };
    const maxS = l.maxScreens || settings.maxScreensPerIp || DEFAULT_MAX_SCREENS_PER_IP;
    const pTraffic = trafficState.byProfile[profileId] || { proxyRxBytes: 0, proxyTxBytes: 0 };
    return {
      active: true,
      ip: l.ip,
      proxyHost: l.proxyHost,
      proxyPort: l.proxyPort,
      slotNo: l.slotNo,
      slotIndex: l.slotNo,
      maxScreens: maxS,
      maxScreensPerIp: maxS,
      activeOnIp: l.activeOnIp || 1,
      scheme: l.scheme || 'http',
      proxyTotalBytes: (pTraffic.proxyRxBytes || 0) + (pTraffic.proxyTxBytes || 0)
    };
  }

  function dispose() {
    for (const t of tunnels.values()) {
      for (const s of t.sockets) { try { s.destroy(); } catch (_) {} }
      try { t.server.close(); } catch (_) {}
    }
    tunnels.clear();
    if (assetCache && typeof assetCache.dispose === 'function') {
      assetCache.dispose();
    }
  }

  return {
    isEnabled: () => loadSettings().enabled,
    isAssetCacheEnabled: () => assetCache ? assetCache.isEnabled() : false,
    assetCache,
    loadSettings,
    saveSettings,
    publicSettings,
    savePoolAndSettings,
    updateSettings: savePoolAndSettings,
    loadPool,
    savePool,
    setEnabled,
    acquireForProfile,
    acquireLeasesForProfiles,
    releaseProfile,
    releaseAll,
    stopAllTunnels,
    ensureProfileTunnel,
    resetProfileSockets,
    testConnection,
    testProxy,
    getStatus,
    getQueueStatus,
    getProfileLeaseSnapshot,
    getTrafficStats,
    resetTrafficStats,
    dispose
  };
}

module.exports = {
  createScreenProxyManager,
  parseProxyPoolText,
  parseProxyPoolLines: parseProxyPoolText,
  isGameOrIpCheckHost
};
