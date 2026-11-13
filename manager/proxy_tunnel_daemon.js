'use strict';
// manager/proxy_tunnel_daemon.js
// Persistent background proxy tunnel worker that survives Manager server.js child restarts (exit code 75)
// so active game WebSocket connections through 127.0.0.1:510XX never drop when Manager self-updates.

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { createAssetCache } = require('./asset_cache');

const DAEMON_VERSION = 2;
const DEFAULT_CONTROL_PORT = Number(process.env.PELICAN_TUNNEL_DAEMON_PORT) || 18989;

function isJailOnlyBlockRecord(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const trig = String(obj.trigger || obj.triggerType || '').trim().toLowerCase();
  const rsn = String(obj.reason || obj.banMessage || '').trim();
  const hasRealBan = /บัญชีถูกระงับ|ถูกระงับ|ระงับการใช้งาน|โดนแบน|ถูกแบน|\bbanned\b|\bsuspended\b/i.test(rsn);
  if (trig === 'jailed' || trig === 'jail' || trig === 'jail_map') return !hasRealBan;
  if (!hasRealBan && /ถูกดึงเข้าคุก|ติดคุก|เข้าแมพคุก|อยู่ในแมพคุก/.test(rsn)) return true;
  return false;
}

function parseArgs(argv) {
  const out = {
    dataDir: process.env.PELICAN_TUNNEL_DATA_DIR || path.join(__dirname, 'data'),
    controlPort: DEFAULT_CONTROL_PORT,
    supervisorPid: Number(process.env.PELICAN_SUPERVISOR_PID) || 0
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data-dir' && argv[i + 1]) out.dataDir = argv[++i];
    else if (a === '--port' && argv[i + 1]) out.controlPort = Number(argv[++i]) || DEFAULT_CONTROL_PORT;
    else if (a === '--supervisor-pid' && argv[i + 1]) out.supervisorPid = Number(argv[++i]) || 0;
  }
  return out;
}

function isGameOrIpCheckHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/:\d+$/, '');
  if (!h) return false;
  return (
    h === 'aetheria-online.in.th' ||
    h.endsWith('.aetheria-online.in.th') ||
    h === 'api.ipify.org'
  );
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
      req[1] = 0x01;
      req[2] = 0x00;
      req[3] = 0x03;
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

function startDaemon() {
  const cfg = parseArgs(process.argv);
  fs.mkdirSync(cfg.dataDir, { recursive: true });

  const settingsFile = path.join(cfg.dataDir, 'screen_proxy_settings.json');
  const leasesFile = path.join(cfg.dataDir, 'screen_proxy_leases.json');
  const blockedFile = path.join(cfg.dataDir, 'screen_proxy_blocked.json');
  const assetCache = createAssetCache({ dataDir: cfg.dataDir });

  let supervisorPid = cfg.supervisorPid || 0;
  let cachedSettings = {
    enabled: false,
    onlyGameTraffic: true,
    localAssetCache: true,
    maxScreensPerIp: 3
  };
  const activeLeases = new Map();
  const blockedProxies = new Map();
  const tunnels = new Map(); // profileId -> { profileId, server, port, proxyUrl, sockets: Set }
  const pendingTraffic = {}; // profileId -> { proxyRxBytes, proxyTxBytes, directRxBytes, directTxBytes }

  function readJson(file, fallback) {
    try {
      if (!fs.existsSync(file)) return fallback;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
      return fallback;
    }
  }

  function reloadFromDisk() {
    try {
      const rawSettings = readJson(settingsFile, null);
      if (rawSettings && typeof rawSettings === 'object') {
        cachedSettings = {
          enabled: rawSettings.enabled === true,
          onlyGameTraffic: rawSettings.onlyGameTraffic !== false,
          localAssetCache: rawSettings.localAssetCache !== false,
          maxScreensPerIp: Math.max(1, Math.min(20, Number(rawSettings.maxScreensPerIp) || 3))
        };
        assetCache.setEnabled(cachedSettings.localAssetCache !== false);
      }
    } catch (_) {}

    try {
      const rawBlocked = readJson(blockedFile, null);
      if (rawBlocked && Array.isArray(rawBlocked.items)) {
        blockedProxies.clear();
        for (const item of rawBlocked.items) {
          if (item && typeof item === 'object' && (item.proxyId || item.ip)) {
            if (isJailOnlyBlockRecord(item)) continue;
            const key = item.proxyId || (`ip:${item.ip}`);
            blockedProxies.set(key, item);
          }
        }
      }
    } catch (_) {}

    try {
      const rawLeases = readJson(leasesFile, null);
      if (rawLeases && rawLeases.activeLeases && typeof rawLeases.activeLeases === 'object') {
        for (const [pid, l] of Object.entries(rawLeases.activeLeases)) {
          if (pid && l && l.assigned && (l.proxyHost || l.ip)) {
            activeLeases.set(pid, l);
          }
        }
      }
    } catch (_) {}
  }

  reloadFromDisk();

  function isProxyBlocked(proxyOrLease) {
    if (!proxyOrLease || blockedProxies.size === 0) return false;
    const proxyId = String(proxyOrLease.proxyId || '').trim();
    const ip = String(proxyOrLease.labelIp || proxyOrLease.ip || proxyOrLease.host || proxyOrLease.proxyHost || '').trim();
    const host = String(proxyOrLease.host || proxyOrLease.proxyHost || ip).trim();
    const port = Number(proxyOrLease.port || proxyOrLease.proxyPort || 0);
    const hostPort = (host && port) ? `${host}:${port}` : '';

    if (proxyId && blockedProxies.has(proxyId)) return true;
    if (ip && blockedProxies.has(`ip:${ip}`)) return true;
    if (hostPort && blockedProxies.has(`hp:${hostPort}`)) return true;
    for (const b of blockedProxies.values()) {
      if (proxyId && b.proxyId === proxyId) return true;
      if (hostPort && b.host && b.port && `${b.host}:${b.port}` === hostPort) return true;
      if (ip && b.ip === ip && (!b.port || !port || b.port === port)) return true;
    }
    return false;
  }

  function addTraffic(profileId, rxBytes = 0, txBytes = 0, viaProxy = true) {
    const rx = Math.max(0, Number(rxBytes) || 0);
    const tx = Math.max(0, Number(txBytes) || 0);
    if (rx === 0 && tx === 0) return;
    const pid = profileId || '_global';
    if (!pendingTraffic[pid]) {
      pendingTraffic[pid] = {
        proxyRxBytes: 0,
        proxyTxBytes: 0,
        directRxBytes: 0,
        directTxBytes: 0
      };
    }
    if (viaProxy) {
      pendingTraffic[pid].proxyRxBytes += rx;
      pendingTraffic[pid].proxyTxBytes += tx;
    } else {
      pendingTraffic[pid].directRxBytes += rx;
      pendingTraffic[pid].directTxBytes += tx;
    }
  }

  function getLeaseForProfile(profileId) {
    let lease = activeLeases.get(profileId) || null;
    if (!lease) {
      reloadFromDisk();
      lease = activeLeases.get(profileId) || null;
    }
    return lease;
  }

  function resetProfileSockets(profileId) {
    const t = tunnels.get(profileId);
    if (!t) return 0;
    let count = 0;
    for (const sock of Array.from(t.sockets)) {
      try { sock.destroy(); count++; } catch (_) {}
    }
    t.sockets.clear();
    return count;
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
      const requiresProxy = Boolean(
        cachedSettings.enabled &&
        (!cachedSettings.onlyGameTraffic || isGameOrIpCheckHost(targetHost))
      );
      let lease = cachedSettings.enabled ? getLeaseForProfile(profileId) : null;
      if (requiresProxy && (!lease?.assigned || isProxyBlocked(lease))) {
        reloadFromDisk();
        lease = activeLeases.get(profileId) || null;
      }
      if (requiresProxy && (!lease?.assigned || isProxyBlocked(lease))) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Proxy lease unavailable (Fail-Closed)');
      }
      const useProxy = Boolean(
        requiresProxy &&
        lease?.assigned &&
        !isProxyBlocked(lease)
      );

      if (useProxy && lease.scheme === 'socks5') {
        try {
          const { socket: upstream } = await connectUpstream({
            lease,
            targetHost,
            targetPort,
            timeoutMs: 12000,
            maxAttempts: 2
          });
          trackSocket(upstream);
          const headerLines = [`${req.method} ${parsed.pathname + parsed.search} HTTP/1.1`];
          for (const [hk, hv] of Object.entries(req.headers)) {
            if (hk.toLowerCase() === 'proxy-connection' || hv === undefined) continue;
            if (Array.isArray(hv)) {
              for (const v of hv) headerLines.push(`${hk}: ${v}`);
            } else {
              headerLines.push(`${hk}: ${hv}`);
            }
          }
          const rawReqHead = Buffer.from(headerLines.join('\r\n') + '\r\n\r\n', 'utf8');
          addTraffic(profileId, 0, rawReqHead.length, true);
          upstream.write(rawReqHead);
          req.on('data', chunk => addTraffic(profileId, 0, chunk.length, true));
          upstream.on('data', chunk => addTraffic(profileId, chunk.length, 0, true));
          req.pipe(upstream);
          upstream.pipe(res.socket || upstream);
          upstream.on('error', () => { try { res.destroy(); } catch (_) {} });
          return;
        } catch (_) {
          if (!res.headersSent) res.writeHead(502);
          return res.end('Bad Gateway');
        }
      }

      const headers = { ...req.headers };
      delete headers['proxy-connection'];
      if (useProxy && (lease.proxyUser || lease.proxyPass)) {
        headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${lease.proxyUser || ''}:${lease.proxyPass || ''}`).toString('base64');
      }

      const proxyReq = http.request({
        host: useProxy ? lease.proxyHost : targetHost,
        port: useProxy ? lease.proxyPort : targetPort,
        method: req.method,
        path: useProxy ? req.url : (parsed.pathname + parsed.search),
        headers,
        timeout: 15000
      }, proxyRes => {
        proxyRes.on('data', chunk => {
          addTraffic(profileId, chunk.length, 0, useProxy);
        });
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      });
      req.on('data', chunk => {
        addTraffic(profileId, 0, chunk.length, useProxy);
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

      const requiresProxy = Boolean(
        cachedSettings.enabled &&
        (!cachedSettings.onlyGameTraffic || isGameOrIpCheckHost(targetHost))
      );
      let lease = cachedSettings.enabled ? getLeaseForProfile(profileId) : null;
      if (requiresProxy && (!lease?.assigned || isProxyBlocked(lease))) {
        reloadFromDisk();
        lease = activeLeases.get(profileId) || null;
      }
      if (requiresProxy && (!lease?.assigned || isProxyBlocked(lease))) {
        // Fail-Closed: never fall back to Direct Home IP when Proxy Mode is ON
        clientSocket.destroy();
        return;
      }

      const shouldRouteViaProxy = Boolean(
        requiresProxy &&
        lease?.assigned &&
        !isProxyBlocked(lease)
      );

      if (!shouldRouteViaProxy) {
        const upstream = net.connect({ host: targetHost, port: targetPort }, () => {
          if (clientSocket.destroyed) { upstream.destroy(); return; }
          upstream.setNoDelay(true);
          try { upstream.setKeepAlive(true, 15000); } catch (_) {}
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head && head.length) {
            addTraffic(profileId, 0, head.length, false);
            upstream.write(head);
          }
          upstream.on('data', chunk => addTraffic(profileId, chunk.length, 0, false));
          clientSocket.on('data', chunk => addTraffic(profileId, 0, chunk.length, false));
          upstream.pipe(clientSocket);
          clientSocket.pipe(upstream);
        });
        trackSocket(upstream);
        upstream.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => upstream.destroy());
        return;
      }

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
          addTraffic(profileId, 0, head.length, true);
          upstream.write(head);
        }
        if (upstreamHead && upstreamHead.length) {
          addTraffic(profileId, upstreamHead.length, 0, true);
          clientSocket.write(upstreamHead);
        }
        upstream.on('data', chunk => addTraffic(profileId, chunk.length, 0, true));
        clientSocket.on('data', chunk => addTraffic(profileId, 0, chunk.length, true));
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
        upstream.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => upstream.destroy());
      } catch (_) {
        clientSocket.destroy();
      }
    });

    const preferredPort = 51000 + Math.max(0, (Number(debugPort) || 49876) - 49876);
    const starting = new Promise((resolve, reject) => {
      let retries = 0;
      const tryListen = portToTry => {
        const onError = err => {
          server.removeListener('listening', onListening);
          if (portToTry !== 0 && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
            if (retries < 10) {
              retries++;
              setTimeout(() => tryListen(preferredPort), 150);
              return;
            }
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

  function applySyncPayload(body = {}) {
    if (body.supervisorPid && Number.isInteger(Number(body.supervisorPid))) {
      supervisorPid = Number(body.supervisorPid);
    }
    if (body.settings && typeof body.settings === 'object') {
      cachedSettings = {
        ...cachedSettings,
        enabled: body.settings.enabled === true,
        onlyGameTraffic: body.settings.onlyGameTraffic !== false,
        localAssetCache: body.settings.localAssetCache !== false,
        maxScreensPerIp: Math.max(1, Math.min(20, Number(body.settings.maxScreensPerIp) || 3))
      };
      assetCache.setEnabled(cachedSettings.localAssetCache !== false);
    }
    if (Array.isArray(body.blockedProxies)) {
      blockedProxies.clear();
      for (const item of body.blockedProxies) {
        if (item && typeof item === 'object' && (item.proxyId || item.ip)) {
          if (isJailOnlyBlockRecord(item)) continue;
          const key = item.proxyId || (`ip:${item.ip}`);
          blockedProxies.set(key, item);
        }
      }
    }
    if (body.leases && typeof body.leases === 'object') {
      if (body.replaceLeases === true) {
        activeLeases.clear();
      }
      for (const [pid, l] of Object.entries(body.leases)) {
        if (pid && l && l.assigned && (l.proxyHost || l.ip)) {
          activeLeases.set(pid, l);
        } else if (pid && l === null) {
          activeLeases.delete(pid);
        }
      }
    }
  }

  const startedAt = Date.now();
  const controlServer = http.createServer((req, res) => {
    req.setEncoding('utf8');
    const sendJson = (obj, code = 200) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };

    if (req.method === 'GET' && req.url === '/ping') {
      const tunnelList = [];
      for (const [pid, t] of tunnels.entries()) {
        if (t && t.port) {
          tunnelList.push({ profileId: pid, port: t.port, proxyUrl: t.proxyUrl, activeSockets: t.sockets ? t.sockets.size : 0 });
        }
      }
      return sendJson({
        ok: true,
        version: DAEMON_VERSION,
        pid: process.pid,
        supervisorPid,
        startedAt,
        enabled: cachedSettings.enabled,
        tunnelCount: tunnelList.length,
        tunnels: tunnelList
      });
    }

    let rawBody = '';
    req.on('data', c => {
      rawBody += c;
      if (rawBody.length > 524288) req.destroy();
    });
    req.on('end', async () => {
      let body = {};
      try { body = rawBody ? JSON.parse(rawBody) : {}; } catch (_) {}

      try {
        if (req.method === 'POST' && req.url === '/sync') {
          applySyncPayload(body);
          return sendJson({ ok: true, enabled: cachedSettings.enabled, leaseCount: activeLeases.size });
        }

        if (req.method === 'POST' && req.url === '/ensure-tunnel') {
          applySyncPayload(body);
          const profileId = String(body.profileId || '').trim();
          const debugPort = Number(body.debugPort) || 49876;
          if (!profileId) return sendJson({ ok: false, error: 'MISSING_PROFILE_ID' }, 400);
          if (body.lease && body.lease.assigned) {
            activeLeases.set(profileId, body.lease);
          }
          const t = await ensureProfileTunnel(profileId, debugPort);
          return sendJson({
            ok: true,
            profileId,
            port: t.port,
            proxyUrl: t.proxyUrl,
            activeSockets: t.sockets ? t.sockets.size : 0
          });
        }

        if (req.method === 'POST' && req.url === '/reset-sockets') {
          if (body.all === true) {
            let total = 0;
            for (const pid of tunnels.keys()) total += resetProfileSockets(pid);
            return sendJson({ ok: true, resetSockets: total });
          }
          const profileId = String(body.profileId || '').trim();
          const resetCount = profileId ? resetProfileSockets(profileId) : 0;
          return sendJson({ ok: true, profileId, resetSockets: resetCount });
        }

        if (req.method === 'POST' && req.url === '/drain-traffic') {
          const drained = {};
          for (const [pid, counts] of Object.entries(pendingTraffic)) {
            if (counts.proxyRxBytes > 0 || counts.proxyTxBytes > 0 || counts.directRxBytes > 0 || counts.directTxBytes > 0) {
              drained[pid] = { ...counts };
              counts.proxyRxBytes = 0;
              counts.proxyTxBytes = 0;
              counts.directRxBytes = 0;
              counts.directTxBytes = 0;
            }
          }
          return sendJson({
            ok: true,
            byProfile: drained,
            assetCacheStatus: assetCache ? assetCache.getStatus() : null
          });
        }

        if (req.method === 'POST' && req.url === '/shutdown') {
          sendJson({ ok: true, shuttingDown: true });
          setTimeout(() => process.exit(0), 100);
          return;
        }

        sendJson({ ok: false, error: 'NOT_FOUND' }, 404);
      } catch (err) {
        sendJson({ ok: false, error: err.message || 'DAEMON_ERROR' }, 500);
      }
    });
  });

  controlServer.on('error', () => {
    // Another daemon instance is already listening on controlPort
    process.exit(0);
  });

  controlServer.listen(cfg.controlPort, '127.0.0.1');

  // Periodically check if supervisor is still alive; only exit if supervisor is gone AND all game sockets have closed
  let supervisorDeadSince = 0;
  const watchdog = setInterval(() => {
    reloadFromDisk();
    if (supervisorPid > 0) {
      let alive = false;
      try {
        process.kill(supervisorPid, 0);
        alive = true;
      } catch (e) {
        alive = e && e.code === 'EPERM';
      }
      if (alive) {
        supervisorDeadSince = 0;
      } else {
        if (!supervisorDeadSince) supervisorDeadSince = Date.now();
        let activeSocketCount = 0;
        for (const t of tunnels.values()) {
          if (t && t.sockets) activeSocketCount += t.sockets.size;
        }
        if (activeSocketCount === 0 && (Date.now() - supervisorDeadSince > 30000)) {
          process.exit(0);
        }
      }
    }
  }, 10000);
  watchdog.unref?.();
}

if (require.main === module) {
  startDaemon();
}

module.exports = { startDaemon, DEFAULT_CONTROL_PORT };
