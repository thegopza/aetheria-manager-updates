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
const FORCE_DISABLE_REVISION = '2026-10-21-off';


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
  const blockedFile = path.join(dataDir, 'screen_proxy_blocked.json');
  const billingFile = path.join(dataDir, 'screen_proxy_billing.json');
  const assetCache = providedAssetCache || createAssetCache({ dataDir, now });

  const BYTES_PER_GB = 1024 * 1024 * 1024;
  const DEFAULT_PACKAGE_GB = 5000;
  const DEFAULT_PACKAGE_MERIT = 1500;

  const tunnels = new Map();       // profileId -> { server, port, sockets: Set }
  const activeLeases = new Map();  // profileId -> lease object
  const stickyHistory = new Map(); // profileId -> proxyId
  const blockedProxies = new Map(); // key (proxyId or ip:x.x.x.x) -> block record
  const jailCooldowns = new Map(); // key (proxyId or ip:x.x.x.x) -> cooldownUntilMs
  const JAIL_IP_COOLDOWN_MS = 30 * 60 * 1000;

  function getThaiDateKey(ts = now()) {
    return new Date(ts + 7 * 3600000).toISOString().slice(0, 10);
  }

  function getMachineHwid() {
    try {
      const fp = solver?.getMachineFingerprint?.();
      if (fp && typeof fp === 'string' && fp.length >= 16) return fp.toUpperCase();
    } catch (_) {}
    try {
      const { execSync } = require('child_process');
      const out = execSync('reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', { encoding: 'utf8', windowsHide: true });
      const guid = out.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i)?.[1]?.toUpperCase() || '';
      if (guid) {
        return crypto.createHash('sha256').update('PMhee.MachineFingerprint.v1|' + guid).digest('hex').toUpperCase();
      }
    } catch (_) {}
    return crypto.createHash('sha256').update('PMhee.MachineFingerprint.v1|' + require('os').hostname().toUpperCase()).digest('hex').toUpperCase();
  }

  function getMachineId() {
    try {
      return getMachineHwid().slice(0, 32) || 'local_machine';
    } catch (_) {
      return 'local_machine';
    }
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

  const currentMachineHwid = getMachineHwid();
  let cloneDetectedOnBoot = false;

  function isJailOnlyBlockRecord(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const trig = String(obj.trigger || obj.triggerType || '').trim().toLowerCase();
    const rsn = String(obj.reason || obj.banMessage || '').trim();
    const hasRealBan = /บัญชีถูกระงับ|ถูกระงับ|ระงับการใช้งาน|โดนแบน|ถูกแบน|\bbanned\b|\bsuspended\b/i.test(rsn);
    if (trig === 'jailed' || trig === 'jail' || trig === 'jail_map') return !hasRealBan;
    if (!hasRealBan && /ถูกดึงเข้าคุก|ติดคุก|เข้าแมพคุก|อยู่ในแมพคุก/.test(rsn)) return true;
    return false;
  }

  function saveBlockedProxies() {
    try {
      writeJson(blockedFile, {
        updatedAt: now(),
        items: Array.from(blockedProxies.values())
      });
    } catch (_) {}
  }

  // Load persisted blocked proxies (Banned IP Blacklist — auto-purge any legacy jail-only entries)
  try {
    const savedBlocked = readJson(blockedFile, { items: [] });
    const list = Array.isArray(savedBlocked?.items) ? savedBlocked.items : [];
    let purgedJailBlocks = false;
    for (const item of list) {
      if (item && typeof item === 'object' && (item.proxyId || item.ip)) {
        if (isJailOnlyBlockRecord(item)) {
          purgedJailBlocks = true;
          continue;
        }
        const key = item.proxyId || (`ip:${item.ip}`);
        blockedProxies.set(key, item);
      }
    }
    if (purgedJailBlocks) saveBlockedProxies();
  } catch (_) {}

  function getProxyBlockInfo(proxyOrLease) {
    if (!proxyOrLease || blockedProxies.size === 0) return null;
    const proxyId = String(proxyOrLease.proxyId || '').trim();
    const ip = String(proxyOrLease.labelIp || proxyOrLease.ip || proxyOrLease.host || proxyOrLease.proxyHost || '').trim();
    const host = String(proxyOrLease.host || proxyOrLease.proxyHost || ip).trim();
    const port = Number(proxyOrLease.port || proxyOrLease.proxyPort || 0);
    const hostPort = (host && port) ? `${host}:${port}` : '';

    if (proxyId && blockedProxies.has(proxyId)) return blockedProxies.get(proxyId);
    if (ip && blockedProxies.has(`ip:${ip}`)) return blockedProxies.get(`ip:${ip}`);
    if (hostPort && blockedProxies.has(`hp:${hostPort}`)) return blockedProxies.get(`hp:${hostPort}`);
    for (const b of blockedProxies.values()) {
      if (proxyId && b.proxyId === proxyId) return b;
      if (hostPort && b.host && b.port && `${b.host}:${b.port}` === hostPort) return b;
      if (ip && b.ip === ip && (!b.port || !port || b.port === port)) return b;
    }
    return null;
  }

  function isProxyBlocked(proxyOrLease) {
    return Boolean(getProxyBlockInfo(proxyOrLease));
  }

  function isProxyOnJailCooldown(proxyOrLease) {
    if (!proxyOrLease || jailCooldowns.size === 0) return false;
    const nowMs = now();
    for (const [k, untilMs] of Array.from(jailCooldowns.entries())) {
      if (!untilMs || untilMs <= nowMs) jailCooldowns.delete(k);
    }
    if (jailCooldowns.size === 0) return false;
    const proxyId = String(proxyOrLease.proxyId || '').trim();
    const ip = String(proxyOrLease.labelIp || proxyOrLease.ip || proxyOrLease.host || proxyOrLease.proxyHost || '').trim().toLowerCase();
    const host = String(proxyOrLease.host || proxyOrLease.proxyHost || ip).trim().toLowerCase();
    if (proxyId && (jailCooldowns.get(proxyId) || 0) > nowMs) return true;
    if (ip && (jailCooldowns.get(`ip:${ip}`) || 0) > nowMs) return true;
    if (host && (jailCooldowns.get(`ip:${host}`) || 0) > nowMs) return true;
    return false;
  }

  function getExcludedProxyFilters() {
    if (blockedProxies.size === 0) return {};
    const excludeProxyIds = [];
    const excludeHosts = [];
    for (const b of blockedProxies.values()) {
      if (!b || isJailOnlyBlockRecord(b)) continue;
      if (b.proxyId && /^[A-Za-z0-9_-]{1,128}$/.test(String(b.proxyId))) {
        excludeProxyIds.push(String(b.proxyId));
      }
      const host = String(b.host || b.ip || '').trim().toLowerCase();
      const ip = String(b.ip || '').trim().toLowerCase();
      const port = Number(b.port) || 0;
      if (host) excludeHosts.push(port ? `${host}:${port}` : host);
      if (ip && ip !== host) excludeHosts.push(ip);
    }
    const out = {};
    if (excludeProxyIds.length > 0) out.excludeProxyIds = Array.from(new Set(excludeProxyIds));
    if (excludeHosts.length > 0) out.excludeHosts = Array.from(new Set(excludeHosts));
    return out;
  }

  // Load persisted sticky history and active leases (with Anti-Clone HWID check)
  try {
    const savedLeases = readJson(leasesFile, {});
    const initEnabled = readJson(settingsFile, {})?.enabled === true;
    if (savedLeases && savedLeases.machineHwid && savedLeases.machineHwid !== currentMachineHwid) {
      cloneDetectedOnBoot = true;
      console.warn('[Anti-Clone Guard] 🛡️ ตรวจพบไฟล์คิว Proxy (screen_proxy_leases.json) จากเครื่องอื่น -> รีเซ็ตการจับคู่ Sticky IP ใหม่สำหรับเครื่องนี้!');
      writeJson(leasesFile, {
        machineHwid: currentMachineHwid,
        cloneResetAt: now(),
        updatedAt: now(),
        sticky: {},
        activeLeases: {}
      });
    } else if (savedLeases && typeof savedLeases === 'object') {
      if (savedLeases.sticky && typeof savedLeases.sticky === 'object') {
        for (const [k, v] of Object.entries(savedLeases.sticky)) {
          if (typeof k === 'string' && typeof v === 'string' && !blockedProxies.has(v)) {
            stickyHistory.set(k, v);
          }
        }
      }
      if (initEnabled && savedLeases.activeLeases && typeof savedLeases.activeLeases === 'object') {
        for (const [pid, l] of Object.entries(savedLeases.activeLeases)) {
          if (pid && l && typeof l === 'object' && l.assigned && (l.proxyHost || l.ip) && !isProxyBlocked(l)) {
            activeLeases.set(pid, { ...l, expiresAt: Math.max(Number(l.expiresAt) || 0, now() + LEASE_TTL_MS) });
          }
        }
      }
      if (!savedLeases.machineHwid) {
        writeJson(leasesFile, {
          machineHwid: currentMachineHwid,
          updatedAt: now(),
          sticky: Object.fromEntries(stickyHistory),
          activeLeases: Object.fromEntries(activeLeases)
        });
      }
    }
  } catch (_) {}

  function saveStickyHistory() {
    try {
      const persistedActive = {};
      for (const [pid, l] of activeLeases.entries()) {
        if (pid && l && l.assigned && !isProxyBlocked(l)) {
          persistedActive[pid] = l;
        }
      }
      writeJson(leasesFile, {
        machineHwid: currentMachineHwid,
        updatedAt: now(),
        sticky: Object.fromEntries(stickyHistory),
        activeLeases: persistedActive
      });
    } catch (_) {}
  }

  // Load persisted Proxy Bandwidth & Merit Billing Ledger (with Anti-Clone HWID check)
  let billingDirty = false;
  let billingSyncInFlight = false;
  let lastBillingSyncAt = 0;

  function createCleanBillingState(existingConfig = {}) {
    const pkgGb = Math.max(1, Number(existingConfig.packageGb) || DEFAULT_PACKAGE_GB);
    const pkgMerit = Number.isFinite(Number(existingConfig.packageMerit)) && Number(existingConfig.packageMerit) >= 0
      ? Number(existingConfig.packageMerit)
      : DEFAULT_PACKAGE_MERIT;
    const ratePerGb = Number.isFinite(Number(existingConfig.ratePerGb)) && Number(existingConfig.ratePerGb) > 0
      ? Number(existingConfig.ratePerGb)
      : Number((pkgMerit / pkgGb).toFixed(4));
    const ratePerScreenDay = Math.max(0, Number(existingConfig.ratePerScreenDay) || 0);
    return {
      schemaVersion: 1,
      machineHwid: currentMachineHwid,
      installationId: crypto.randomUUID(),
      createdAt: now(),
      updatedAt: now(),
      packageGb: pkgGb,
      packageMerit: pkgMerit,
      ratePerGb,
      ratePerScreenDay,
      autoDeductWallet: existingConfig.autoDeductWallet !== false,
      cloneResetCount: Number(existingConfig.cloneResetCount) || 0,
      lastCloneResetAt: existingConfig.lastCloneResetAt || null,
      totalProxyRxBytes: 0,
      totalProxyTxBytes: 0,
      totalProxyBytes: 0,
      settledProxyBytes: 0,
      settledUnitsTotal: 0,
      lastSettledAt: null,
      lastSettlementError: null,
      byDay: {},
      byProfile: {}
    };
  }

  let billingState = (() => {
    try {
      const saved = readJson(billingFile, null);
      if (saved && typeof saved === 'object') {
        if (saved.machineHwid && saved.machineHwid !== currentMachineHwid) {
          cloneDetectedOnBoot = true;
          console.warn('[Anti-Clone Guard] 🛡️ ตรวจพบมิเตอร์ค่าเน็ต Proxy (screen_proxy_billing.json) โคลนมาจากเครื่องอื่น -> รีเซ็ตตัวนับแยกตามรหัสเครื่อง (HWID) ใหม่ทันทีเพื่อป้องกันบัคคิดส่วนบุญซ้ำ/เพี้ยน!');
          const clean = createCleanBillingState({
            packageGb: saved.packageGb,
            packageMerit: saved.packageMerit,
            ratePerGb: saved.ratePerGb,
            ratePerScreenDay: saved.ratePerScreenDay,
            autoDeductWallet: saved.autoDeductWallet,
            cloneResetCount: (Number(saved.cloneResetCount) || 0) + 1,
            lastCloneResetAt: now()
          });
          writeJson(billingFile, clean);
          return clean;
        }
        const pkgGb = Math.max(1, Number(saved.packageGb) || DEFAULT_PACKAGE_GB);
        const pkgMerit = Number.isFinite(Number(saved.packageMerit)) && Number(saved.packageMerit) >= 0
          ? Number(saved.packageMerit)
          : DEFAULT_PACKAGE_MERIT;
        const ratePerGb = Number.isFinite(Number(saved.ratePerGb)) && Number(saved.ratePerGb) > 0
          ? Number(saved.ratePerGb)
          : Number((pkgMerit / pkgGb).toFixed(4));
        const normalized = {
          schemaVersion: 1,
          machineHwid: currentMachineHwid,
          installationId: (typeof saved.installationId === 'string' && saved.installationId) ? saved.installationId : crypto.randomUUID(),
          createdAt: Number(saved.createdAt) || now(),
          updatedAt: Number(saved.updatedAt) || now(),
          packageGb: pkgGb,
          packageMerit: pkgMerit,
          ratePerGb,
          ratePerScreenDay: Math.max(0, Number(saved.ratePerScreenDay) || 0),
          autoDeductWallet: saved.autoDeductWallet !== false,
          cloneResetCount: Number(saved.cloneResetCount) || 0,
          lastCloneResetAt: saved.lastCloneResetAt || null,
          totalProxyRxBytes: Math.max(0, Number(saved.totalProxyRxBytes) || 0),
          totalProxyTxBytes: Math.max(0, Number(saved.totalProxyTxBytes) || 0),
          totalProxyBytes: Math.max(0, Number(saved.totalProxyBytes) || ((Number(saved.totalProxyRxBytes) || 0) + (Number(saved.totalProxyTxBytes) || 0))),
          settledProxyBytes: Math.max(0, Number(saved.settledProxyBytes) || 0),
          settledUnitsTotal: Math.max(0, Math.floor(Number(saved.settledUnitsTotal) || 0)),
          lastSettledAt: saved.lastSettledAt || null,
          lastSettlementError: saved.lastSettlementError || null,
          byDay: (saved.byDay && typeof saved.byDay === 'object') ? saved.byDay : {},
          byProfile: (saved.byProfile && typeof saved.byProfile === 'object') ? saved.byProfile : {}
        };
        if (!saved.machineHwid) writeJson(billingFile, normalized);
        return normalized;
      }
    } catch (_) {}
    const fresh = createCleanBillingState();
    try { writeJson(billingFile, fresh); } catch (_) {}
    return fresh;
  })();

  function saveBillingStateNow() {
    try {
      const dayKeys = Object.keys(billingState.byDay || {}).sort();
      while (dayKeys.length > 45) {
        const old = dayKeys.shift();
        delete billingState.byDay[old];
      }
      billingState.machineHwid = currentMachineHwid;
      billingState.updatedAt = now();
      writeJson(billingFile, billingState);
      billingDirty = false;
    } catch (_) {}
  }

  let leaseRenewInFlight = false;
  const billingSaveInterval = setInterval(() => {
    if (billingDirty) saveBillingStateNow();
    syncProxyBillingToServer().catch(() => {});
    if (!leaseRenewInFlight && activeLeases.size > 0) {
      const settings = loadSettings();
      if (settings.enabled && settings.mode === 'owner-queue') {
        const nowMs = now();
        const staleIds = [];
        for (const [pid, l] of activeLeases.entries()) {
          if (pid && (!l || !l.assigned || isProxyBlocked(l) || (nowMs - (l.renewedAt || 0) > 5 * 60 * 1000))) {
            staleIds.push(pid);
          }
        }
        if (staleIds.length > 0) {
          leaseRenewInFlight = true;
          acquireLeasesForProfiles(staleIds).catch(() => {}).finally(() => {
            leaseRenewInFlight = false;
          });
        }
      }
    }
  }, 10000);
  billingSaveInterval.unref?.();

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
      billingState.totalProxyRxBytes = (billingState.totalProxyRxBytes || 0) + rx;
      billingState.totalProxyTxBytes = (billingState.totalProxyTxBytes || 0) + tx;
      billingState.totalProxyBytes = billingState.totalProxyRxBytes + billingState.totalProxyTxBytes;

      const dayKey = getThaiDateKey();
      if (!billingState.byDay[dayKey]) {
        billingState.byDay[dayKey] = {
          date: dayKey,
          proxyRxBytes: 0,
          proxyTxBytes: 0,
          proxyTotalBytes: 0,
          screens: {}
        };
      }
      const dayBucket = billingState.byDay[dayKey];
      dayBucket.proxyRxBytes = (dayBucket.proxyRxBytes || 0) + rx;
      dayBucket.proxyTxBytes = (dayBucket.proxyTxBytes || 0) + tx;
      dayBucket.proxyTotalBytes = dayBucket.proxyRxBytes + dayBucket.proxyTxBytes;

      if (profileId) {
        const lease = activeLeases.get(profileId);
        const curIp = lease?.ip || lease?.proxyHost || null;
        if (!dayBucket.screens) dayBucket.screens = {};
        if (!dayBucket.screens[profileId]) {
          dayBucket.screens[profileId] = {
            profileId,
            proxyRxBytes: 0,
            proxyTxBytes: 0,
            proxyTotalBytes: 0,
            lastIp: curIp,
            firstSeenAt: now(),
            lastSeenAt: now()
          };
        }
        const ds = dayBucket.screens[profileId];
        ds.proxyRxBytes += rx;
        ds.proxyTxBytes += tx;
        ds.proxyTotalBytes = ds.proxyRxBytes + ds.proxyTxBytes;
        if (curIp) ds.lastIp = curIp;
        ds.lastSeenAt = now();

        if (!billingState.byProfile[profileId]) {
          billingState.byProfile[profileId] = {
            profileId,
            proxyRxBytes: 0,
            proxyTxBytes: 0,
            proxyTotalBytes: 0,
            lastIp: curIp,
            updatedAt: now()
          };
        }
        const bp = billingState.byProfile[profileId];
        bp.proxyRxBytes += rx;
        bp.proxyTxBytes += tx;
        bp.proxyTotalBytes = bp.proxyRxBytes + bp.proxyTxBytes;
        if (curIp) bp.lastIp = curIp;
        bp.updatedAt = now();
      }
      billingDirty = true;
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

  function computeTargetBillingUnits() {
    const ratePerGb = Math.max(0, Number(billingState.ratePerGb) || 0);
    const ratePerScreenDay = Math.max(0, Number(billingState.ratePerScreenDay) || 0);
    const bwMerit = ((billingState.totalProxyBytes || 0) / BYTES_PER_GB) * ratePerGb;
    let screenDayCount = 0;
    for (const d of Object.values(billingState.byDay || {})) {
      if (d && d.screens && typeof d.screens === 'object') {
        screenDayCount += Object.keys(d.screens).length;
      }
    }
    const screenMerit = screenDayCount * ratePerScreenDay;
    const totalMerit = bwMerit + screenMerit;
    const targetUnits = Math.max(0, Math.floor(totalMerit * 100 + 1e-9));
    return {
      ratePerGb,
      ratePerScreenDay,
      bwMerit,
      screenMerit,
      totalMerit,
      targetUnits
    };
  }

  let lastSyncedProxyBytes = billingState.settledProxyBytes || 0;
  let lastSyncedActiveScreens = -1;

  async function syncProxyBillingToServer({ force = false } = {}) {
    if (billingSyncInFlight) return null;
    if (!billingState.autoDeductWallet || typeof solver?.serviceRequest !== 'function') return null;
    const { targetUnits, ratePerGb, ratePerScreenDay } = computeTargetBillingUnits();
    const unsettledUnits = Math.max(0, targetUnits - (billingState.settledUnitsTotal || 0));
    const settings = loadSettings();
    const todayKey = getThaiDateKey();
    const todayBucket = billingState.byDay[todayKey] || { proxyTotalBytes: 0, screens: {} };
    const activeScreensToday = Object.keys(todayBucket.screens || {}).length;
    const effectiveScreensCount = Math.max(activeLeases.size, activeScreensToday);
    const hasActiveProxyState = Boolean(settings.enabled && effectiveScreensCount > 0);
    const hasUnsyncedTraffic = (billingState.totalProxyBytes || 0) > lastSyncedProxyBytes;
    const screensChanged = hasActiveProxyState && effectiveScreensCount !== lastSyncedActiveScreens;
    const statusHeartbeatDue = (hasActiveProxyState || hasUnsyncedTraffic) && (screensChanged || (now() - lastBillingSyncAt >= 60000));
    if (unsettledUnits < 1 && !force && !statusHeartbeatDue) return null;
    if (!force && unsettledUnits < 1 && !screensChanged && (now() - lastBillingSyncAt < 25000)) return null;
    if (!force && unsettledUnits >= 1 && (now() - lastBillingSyncAt < 15000)) return null;

    billingSyncInFlight = true;
    lastBillingSyncAt = now();
    try {
      const deltaBytes = Math.max(0, (billingState.totalProxyBytes || 0) - (billingState.settledProxyBytes || 0));
      const reportId = 'pxbw_' + crypto.createHash('sha256')
        .update(`${currentMachineHwid}|${billingState.installationId}|${billingState.settledUnitsTotal}|${targetUnits}|${billingState.totalProxyBytes || 0}|${effectiveScreensCount}`)
        .digest('hex')
        .slice(0, 32);

      const res = await solver.serviceRequest('/v1/aetheria/proxy/bandwidth-settle', {
        reportId,
        machineId: getMachineId(),
        installationId: billingState.installationId,
        bangkokDay: todayKey,
        deltaUnits: unsettledUnits,
        deltaBytes,
        todayProxyBytes: todayBucket.proxyTotalBytes || 0,
        totalProxyBytes: billingState.totalProxyBytes || 0,
        activeScreensCount: effectiveScreensCount,
        ratePerGb,
        ratePerScreenDay
      });
      if (res && res.success) {
        if (res.billingConfig && typeof res.billingConfig === 'object') {
          if (res.billingConfig.packageGb) billingState.packageGb = Number(res.billingConfig.packageGb);
          if (res.billingConfig.packageMerit !== undefined) billingState.packageMerit = Number(res.billingConfig.packageMerit);
          if (res.billingConfig.ratePerGb !== undefined) billingState.ratePerGb = Number(res.billingConfig.ratePerGb);
          if (res.billingConfig.ratePerScreenDay !== undefined) billingState.ratePerScreenDay = Number(res.billingConfig.ratePerScreenDay);
          if (typeof res.billingConfig.enabled === 'boolean') billingState.autoDeductWallet = res.billingConfig.enabled;
        }
        billingState.settledUnitsTotal = Number.isFinite(Number(res.settledUnitsTotal)) ? Number(res.settledUnitsTotal) : targetUnits;
        if (unsettledUnits >= 1 || (Number(res.chargedUnits) || 0) > 0) {
          billingState.settledProxyBytes = billingState.totalProxyBytes || 0;
        }
        lastSyncedProxyBytes = billingState.totalProxyBytes || 0;
        lastSyncedActiveScreens = effectiveScreensCount;
        billingState.lastSettledAt = now();
        billingState.lastSettlementError = null;
        saveBillingStateNow();
        if (Number.isSafeInteger(res.balanceUnits) && typeof solver.applyOfflineWalletSnapshot === 'function') {
          try { solver.applyOfflineWalletSnapshot({ unitScale: 100, balanceUnits: res.balanceUnits }); } catch (_) {}
        }
        return res;
      }
    } catch (e) {
      billingState.lastSettlementError = e.message || 'SYNC_FAILED';
    } finally {
      billingSyncInFlight = false;
    }
    return null;
  }

  function getBillingStatus() {
    const todayKey = getThaiDateKey();
    const todayBucket = billingState.byDay[todayKey] || { proxyRxBytes: 0, proxyTxBytes: 0, proxyTotalBytes: 0, screens: {} };
    const ratePerGb = Math.max(0, Number(billingState.ratePerGb) || 0);
    const ratePerScreenDay = Math.max(0, Number(billingState.ratePerScreenDay) || 0);
    const todayProxyBytes = todayBucket.proxyTotalBytes || 0;
    const todayScreensMap = todayBucket.screens || {};
    const todayScreenIds = Object.keys(todayScreensMap);
    const activeProxyScreensToday = Math.max(todayScreenIds.length, activeLeases.size);

    const todayBandwidthMerit = (todayProxyBytes / BYTES_PER_GB) * ratePerGb;
    const todayScreenMerit = todayScreenIds.length * ratePerScreenDay;
    const todayTotalMerit = todayBandwidthMerit + todayScreenMerit;

    const { bwMerit, screenMerit, totalMerit, targetUnits } = computeTargetBillingUnits();
    const settledUnits = billingState.settledUnitsTotal || 0;
    const unsettledUnits = Math.max(0, targetUnits - settledUnits);

    const allProfiles = typeof loadProfiles === 'function' ? (loadProfiles() || []) : [];
    const nameById = new Map(allProfiles.map(p => [p.id, p.name || p.id]));

    const allProfileIds = Array.from(new Set([
      ...allProfiles.map(p => p.id),
      ...Object.keys(billingState.byProfile || {}),
      ...todayScreenIds
    ]));

    const perScreen = allProfileIds.map(pid => {
      const tp = todayScreensMap[pid] || { proxyRxBytes: 0, proxyTxBytes: 0, proxyTotalBytes: 0 };
      const ap = billingState.byProfile[pid] || { proxyRxBytes: 0, proxyTxBytes: 0, proxyTotalBytes: 0 };
      const lease = activeLeases.get(pid);
      const todayBytes = tp.proxyTotalBytes || 0;
      const totalBytes = ap.proxyTotalBytes || 0;
      const usedToday = Boolean(todayScreensMap[pid] || (lease && lease.assigned));
      const todayMerit = ((todayBytes / BYTES_PER_GB) * ratePerGb) + (usedToday ? ratePerScreenDay : 0);
      const totalScreenMerit = ((totalBytes / BYTES_PER_GB) * ratePerGb);
      return {
        profileId: pid,
        profileName: nameById.get(pid) || pid,
        activeLease: Boolean(lease && lease.assigned),
        ip: (lease && lease.ip) || tp.lastIp || ap.lastIp || null,
        todayProxyBytes: todayBytes,
        totalProxyBytes: totalBytes,
        todayMerit: Number(todayMerit.toFixed(4)),
        totalMerit: Number(totalScreenMerit.toFixed(4))
      };
    }).filter(x => x.activeLease || x.todayProxyBytes > 0 || x.totalProxyBytes > 0);

    const byProfileUi = {};
    for (const row of perScreen) {
      byProfileUi[row.profileId] = {
        todayProxyBytes: row.todayProxyBytes,
        totalProxyBytes: row.totalProxyBytes,
        todayMeritPoints: row.todayMerit,
        meritPoints: row.totalMerit
      };
    }

    return {
      enabled: billingState.autoDeductWallet !== false,
      date: todayKey,
      machineHwid: currentMachineHwid.slice(0, 16),
      installationId: billingState.installationId,
      cloneProtected: true,
      cloneDetectedOnBoot,
      cloneResetCount: billingState.cloneResetCount || 0,
      lastCloneResetAt: billingState.lastCloneResetAt || null,
      packageGb: billingState.packageGb || DEFAULT_PACKAGE_GB,
      packageMerit: Number.isFinite(Number(billingState.packageMerit)) ? Number(billingState.packageMerit) : DEFAULT_PACKAGE_MERIT,
      ratePerGb: Number(ratePerGb.toFixed(4)),
      ratePerScreenDay: Number(ratePerScreenDay.toFixed(4)),
      autoDeductWallet: billingState.autoDeductWallet !== false,
      todayProxyRxBytes: todayBucket.proxyRxBytes || 0,
      todayProxyTxBytes: todayBucket.proxyTxBytes || 0,
      todayProxyBytes,
      todayBytes: todayProxyBytes,
      todayProxyGb: Number((todayProxyBytes / BYTES_PER_GB).toFixed(4)),
      todayGb: Number((todayProxyBytes / BYTES_PER_GB).toFixed(4)),
      activeProxyScreensToday,
      todayActiveScreensCount: activeProxyScreensToday,
      todayBandwidthMerit: Number(todayBandwidthMerit.toFixed(4)),
      todayScreenMerit: Number(todayScreenMerit.toFixed(4)),
      todayTotalMerit: Number(todayTotalMerit.toFixed(4)),
      todayMeritPoints: Number(todayTotalMerit.toFixed(4)),
      totalProxyRxBytes: billingState.totalProxyRxBytes || 0,
      totalProxyTxBytes: billingState.totalProxyTxBytes || 0,
      totalProxyBytes: billingState.totalProxyBytes || 0,
      totalProxyGb: Number(((billingState.totalProxyBytes || 0) / BYTES_PER_GB).toFixed(4)),
      totalGb: Number(((billingState.totalProxyBytes || 0) / BYTES_PER_GB).toFixed(4)),
      totalBandwidthMerit: Number(bwMerit.toFixed(4)),
      totalScreenMerit: Number(screenMerit.toFixed(4)),
      totalMerit: Number(totalMerit.toFixed(4)),
      totalMeritPoints: Number(totalMerit.toFixed(4)),
      targetUnits,
      settledUnits,
      syncedChargedUnits: settledUnits * 100,
      settledMerit: Number((settledUnits / 100).toFixed(2)),
      unsettledUnits,
      pendingUnits: unsettledUnits * 100,
      unsettledMerit: Number((unsettledUnits / 100).toFixed(2)),
      lastSettledAt: billingState.lastSettledAt || null,
      lastSettlementError: billingState.lastSettlementError || null,
      perScreen,
      byProfile: byProfileUi
    };
  }

  function updateBillingConfig(patch = {}) {
    if (patch.packageGb !== undefined) {
      billingState.packageGb = Math.max(1, Math.min(1000000, Number(patch.packageGb) || DEFAULT_PACKAGE_GB));
    }
    if (patch.packageMerit !== undefined) {
      billingState.packageMerit = Math.max(0, Math.min(1000000, Number(patch.packageMerit) || 0));
    }
    if (patch.ratePerGb !== undefined && Number.isFinite(Number(patch.ratePerGb)) && Number(patch.ratePerGb) >= 0) {
      billingState.ratePerGb = Number(Number(patch.ratePerGb).toFixed(4));
    } else if (patch.packageGb !== undefined || patch.packageMerit !== undefined) {
      billingState.ratePerGb = Number((billingState.packageMerit / billingState.packageGb).toFixed(4));
    }
    if (patch.ratePerScreenDay !== undefined && Number.isFinite(Number(patch.ratePerScreenDay)) && Number(patch.ratePerScreenDay) >= 0) {
      billingState.ratePerScreenDay = Number(Number(patch.ratePerScreenDay).toFixed(4));
    }
    if (typeof patch.autoDeductWallet === 'boolean') {
      billingState.autoDeductWallet = patch.autoDeductWallet;
    } else if (typeof patch.enabled === 'boolean') {
      billingState.autoDeductWallet = patch.enabled;
    }
    // Re-baseline settledUnitsTotal to current targetUnits if rate changed so changing the rate doesn't retroactively charge old bytes
    const { targetUnits } = computeTargetBillingUnits();
    billingState.settledUnitsTotal = targetUnits;
    billingState.settledProxyBytes = billingState.totalProxyBytes || 0;
    saveBillingStateNow();
    return getBillingStatus();
  }

  function getTrafficStats() {
    const elapsedSec = Math.max(1, Math.round((now() - trafficState.startedAt) / 1000));
    const sessionProxyBytes = trafficState.proxyRxBytes + trafficState.proxyTxBytes;
    const persistedTotalBytes = billingState.totalProxyBytes || 0;
    const proxyTotalBytes = Math.max(sessionProxyBytes, persistedTotalBytes);
    const directTotalBytes = trafficState.directRxBytes + trafficState.directTxBytes;
    const proxyBps = elapsedSec >= 2 ? Math.round(sessionProxyBytes / elapsedSec) : 0;
    const cacheStatus = assetCache ? assetCache.getStatus() : null;
    return {
      startedAt: trafficState.startedAt,
      elapsedSec,
      proxyRxBytes: Math.max(trafficState.proxyRxBytes, billingState.totalProxyRxBytes || 0),
      proxyTxBytes: Math.max(trafficState.proxyTxBytes, billingState.totalProxyTxBytes || 0),
      proxyTotalBytes,
      sessionProxyBytes,
      proxyBps,
      proxyBytesPerHour: proxyBps * 3600,
      directRxBytes: trafficState.directRxBytes,
      directTxBytes: trafficState.directTxBytes,
      directTotalBytes,
      byProfile: trafficState.byProfile,
      assetCache: cacheStatus,
      billing: getBillingStatus()
    };
  }

  function resetTrafficStats({ resetAssetCacheStats = true, resetBillingStats = false } = {}) {
    trafficState.startedAt = now();
    trafficState.proxyRxBytes = 0;
    trafficState.proxyTxBytes = 0;
    trafficState.directRxBytes = 0;
    trafficState.directTxBytes = 0;
    trafficState.byProfile = {};
    if (resetBillingStats) {
      billingState.totalProxyRxBytes = 0;
      billingState.totalProxyTxBytes = 0;
      billingState.totalProxyBytes = 0;
      billingState.settledProxyBytes = 0;
      billingState.settledUnitsTotal = 0;
      billingState.byDay = {};
      billingState.byProfile = {};
      saveBillingStateNow();
    }
    if (resetAssetCacheStats && assetCache && typeof assetCache.resetStats === 'function') {
      assetCache.resetStats();
    }
    return getTrafficStats();
  }

  function loadSettings() {
    const raw = readJson(settingsFile, {});
    const maxScreensPerIp = Math.max(1, Math.min(20, parseInt(raw.maxScreensPerIp, 10) || DEFAULT_MAX_SCREENS_PER_IP));
    const mode = raw.mode === 'local-pool' ? 'local-pool' : 'owner-queue';
    const localAssetCache = raw.localAssetCache !== false;
    return {
      enabled: raw.enabled === true,
      mode,
      maxScreensPerIp,
      onlyGameTraffic: raw.onlyGameTraffic !== false,
      localAssetCache,
      forceDisableRev: raw.forceDisableRev || null,
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
      ...(patch.maxScreensPerIp !== undefined ? { maxScreensPerIp: Math.max(1, Math.min(20, parseInt(patch.maxScreensPerIp, 10) || DEFAULT_MAX_SCREENS_PER_IP)) } : {}),
      ...(typeof patch.onlyGameTraffic === 'boolean' ? { onlyGameTraffic: patch.onlyGameTraffic } : {}),
      ...(typeof patch.localAssetCache === 'boolean' ? { localAssetCache: patch.localAssetCache } : {}),
      ...(patch.forceDisableRev !== undefined ? { forceDisableRev: patch.forceDisableRev } : {}),
      ...(patch.lastTestedIp !== undefined ? { lastTestedIp: patch.lastTestedIp } : {}),
      ...(patch.lastTestedAt !== undefined ? { lastTestedAt: patch.lastTestedAt } : {}),
      updatedAt: now()
    };
    writeJson(settingsFile, next);
    if (assetCache && typeof assetCache.setEnabled === 'function') {
      assetCache.setEnabled(next.localAssetCache !== false);
    }
    syncDaemonState().catch(() => {});
    return loadSettings();
  }

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
    const parsed = parseProxyPoolText(rawText || raw.proxies || [], settings.maxScreensPerIp);
    const proxies = parsed.map(p => {
      const blockInfo = getProxyBlockInfo(p);
      return {
        ...p,
        blocked: Boolean(blockInfo),
        blockInfo: blockInfo || null
      };
    });
    return { rawText, proxies };
  }

  function savePool(rawText, maxScreensPerIp) {
    const s = loadSettings();
    const maxPerIp = maxScreensPerIp || s.maxScreensPerIp || DEFAULT_MAX_SCREENS_PER_IP;
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    const parsed = parseProxyPoolText(text, maxPerIp);
    const proxies = parsed.map(p => {
      const blockInfo = getProxyBlockInfo(p);
      return {
        ...p,
        blocked: Boolean(blockInfo),
        blockInfo: blockInfo || null
      };
    });
    writeJson(poolFile, {
      updatedAt: now(),
      maxScreensPerIp: maxPerIp,
      rawText: text,
      proxies
    });
    return { rawText: text, proxies };
  }

  function getBlockedProxies() {
    return Array.from(blockedProxies.values()).sort((a, b) => (Number(b.blockedAt) || 0) - (Number(a.blockedAt) || 0));
  }

  async function markProxyJailCooldownForProfile(profileId, meta = {}) {
    const pid = String(profileId || '').trim();
    const activeLease = pid ? activeLeases.get(pid) : null;
    const { proxies } = loadPool();
    let targetProxy = null;

    if (activeLease && (activeLease.proxyId || activeLease.ip || activeLease.proxyHost)) {
      targetProxy = {
        proxyId: activeLease.proxyId || '',
        labelIp: activeLease.ip || activeLease.proxyHost || '',
        host: activeLease.proxyHost || activeLease.ip || '',
        port: Number(activeLease.proxyPort) || 0
      };
    } else if (pid && stickyHistory.has(pid)) {
      const sId = stickyHistory.get(pid);
      const found = proxies.find(p => p.proxyId === sId);
      if (found) {
        targetProxy = {
          proxyId: found.proxyId,
          labelIp: found.labelIp || found.host || '',
          host: found.host || found.labelIp || '',
          port: Number(found.port) || 0
        };
      }
    } else if (meta && (meta.proxyId || meta.ip || meta.host)) {
      targetProxy = {
        proxyId: String(meta.proxyId || '').trim(),
        labelIp: String(meta.ip || meta.host || '').trim(),
        host: String(meta.host || meta.ip || '').trim(),
        port: Number(meta.port) || 0
      };
    }

    if (pid && stickyHistory.has(pid)) {
      stickyHistory.delete(pid);
      saveStickyHistory();
    }

    if (!targetProxy || (!targetProxy.proxyId && !targetProxy.labelIp && !targetProxy.host)) {
      return {
        success: true,
        blocked: false,
        cooldown: false,
        reason: 'NO_ACTIVE_PROXY_FOR_PROFILE',
        blockedCount: blockedProxies.size
      };
    }

    const cooldownUntilMs = now() + JAIL_IP_COOLDOWN_MS;
    if (targetProxy.proxyId) jailCooldowns.set(targetProxy.proxyId, cooldownUntilMs);
    if (targetProxy.labelIp) jailCooldowns.set(`ip:${String(targetProxy.labelIp).toLowerCase()}`, cooldownUntilMs);
    if (targetProxy.host) jailCooldowns.set(`ip:${String(targetProxy.host).toLowerCase()}`, cooldownUntilMs);

    const reasonText = String(meta.reason || 'ตัวละครถูกดึงเข้าคุก').trim();
    if (typeof solver?.serviceRequest === 'function') {
      await solver.serviceRequest('/v1/aetheria/proxy/screen-block', {
        machineId: getMachineId(),
        proxyId: targetProxy.proxyId || undefined,
        ip: targetProxy.labelIp || targetProxy.host,
        labelIp: targetProxy.labelIp || targetProxy.host,
        host: targetProxy.host || targetProxy.labelIp,
        proxyHost: targetProxy.host || targetProxy.labelIp,
        port: targetProxy.port || undefined,
        proxyPort: targetProxy.port || undefined,
        reason: reasonText,
        trigger: 'jailed',
        triggerType: 'jailed',
        profileId: pid || undefined,
        charName: String(meta.charName || '').trim() || undefined
      }).catch(() => {});
    }

    return {
      success: true,
      blocked: false,
      cooldown: true,
      cooldownUntilMs,
      proxyId: targetProxy.proxyId || null,
      ip: targetProxy.labelIp || targetProxy.host || null,
      port: targetProxy.port || 0,
      blockedCount: blockedProxies.size
    };
  }

  async function blockProxyForProfile(profileId, meta = {}) {
    if (isJailOnlyBlockRecord(meta)) {
      const cd = await markProxyJailCooldownForProfile(profileId, meta);
      return {
        success: true,
        blocked: false,
        skipped: true,
        cooldown: Boolean(cd.cooldown),
        cooldownUntilMs: cd.cooldownUntilMs || null,
        reason: 'JAIL_DOES_NOT_BLOCK_IP',
        evictedProfileIds: [],
        blockedCount: blockedProxies.size
      };
    }
    const pid = String(profileId || '').trim();
    const { proxies } = loadPool();
    const settings = loadSettings();
    const maxPerIp = settings.maxScreensPerIp || DEFAULT_MAX_SCREENS_PER_IP;

    let targetProxy = null;
    const activeLease = pid ? activeLeases.get(pid) : null;
    if (activeLease && (activeLease.proxyId || activeLease.ip || activeLease.proxyHost)) {
      targetProxy = proxies.find(p => p.proxyId === activeLease.proxyId) || {
        proxyId: activeLease.proxyId || `px_${crypto.createHash('sha1').update(`${activeLease.proxyHost || activeLease.ip}:${activeLease.proxyPort || 0}`).digest('hex').slice(0, 12)}`,
        labelIp: activeLease.ip || activeLease.proxyHost,
        host: activeLease.proxyHost || activeLease.ip,
        port: Number(activeLease.proxyPort) || 0,
        scheme: activeLease.scheme || 'http'
      };
    }

    if (!targetProxy && pid && stickyHistory.has(pid)) {
      const stickyId = stickyHistory.get(pid);
      targetProxy = proxies.find(p => p.proxyId === stickyId) || null;
    }

    // Fallback: if profile hasn't leased yet or Proxy is currently toggled off, check its deterministic block slot
    if (!targetProxy && pid && typeof loadProfiles === 'function') {
      try {
        const allProfiles = loadProfiles() || [];
        const orderIdx = allProfiles.findIndex(p => p && p.id === pid);
        const enabledUnblocked = proxies.filter(p => p.enabled !== false && !isProxyBlocked(p));
        if (orderIdx >= 0 && Math.floor(orderIdx / maxPerIp) < enabledUnblocked.length) {
          targetProxy = enabledUnblocked[Math.floor(orderIdx / maxPerIp)];
        }
      } catch (_) {}
    }

    if (!targetProxy && (meta.proxyId || meta.ip || meta.host)) {
      const mId = String(meta.proxyId || '').trim();
      const mIp = String(meta.ip || meta.host || '').trim();
      targetProxy = proxies.find(p => (mId && p.proxyId === mId) || (mIp && (p.labelIp === mIp || p.host === mIp))) || {
        proxyId: mId || `ip:${mIp}`,
        labelIp: mIp,
        host: String(meta.host || mIp),
        port: Number(meta.port) || 0,
        scheme: 'http'
      };
    }

    if (!targetProxy) {
      return {
        success: false,
        blocked: false,
        reason: 'NO_PROXY_ASSIGNED_TO_PROFILE'
      };
    }

    const key = targetProxy.proxyId || `ip:${targetProxy.labelIp || targetProxy.host}`;
    const existing = blockedProxies.get(key);
    const affectedProfiles = new Set(Array.isArray(existing?.affectedProfiles) ? existing.affectedProfiles : []);
    if (pid) affectedProfiles.add(pid);

    // Find all profiles currently sharing this banned IP
    const evictedProfileIds = [];
    for (const [leasedPid, l] of Array.from(activeLeases.entries())) {
      if (l.proxyId === targetProxy.proxyId || (targetProxy.labelIp && l.ip === targetProxy.labelIp)) {
        affectedProfiles.add(leasedPid);
        activeLeases.delete(leasedPid);
        evictedProfileIds.push(leasedPid);
      }
    }
    for (const [stickyPid, sProxyId] of Array.from(stickyHistory.entries())) {
      if (sProxyId === targetProxy.proxyId) {
        stickyHistory.delete(stickyPid);
      }
    }
    saveStickyHistory();

    const blockEntry = {
      key,
      proxyId: targetProxy.proxyId || key,
      ip: targetProxy.labelIp || targetProxy.host || '',
      host: targetProxy.host || targetProxy.labelIp || '',
      port: Number(targetProxy.port) || 0,
      scheme: targetProxy.scheme || 'http',
      raw: targetProxy.raw || '',
      reason: String(meta.reason || existing?.reason || 'บัญชีถูกระงับ / โดนแบน IP').trim(),
      trigger: String(meta.trigger || existing?.trigger || 'account_banned').trim(),
      profileId: pid || existing?.profileId || null,
      profileName: String(meta.profileName || existing?.profileName || '').trim(),
      charName: String(meta.charName || existing?.charName || '').trim(),
      account: String(meta.account || existing?.account || '').trim(),
      affectedProfiles: Array.from(affectedProfiles),
      blockedAt: existing?.blockedAt || now(),
      updatedAt: now()
    };

    blockedProxies.set(key, blockEntry);
    saveBlockedProxies();

    // Notify owner-host backend to disable this banned IP in owner_screen_proxy_pool
    if (typeof solver?.serviceRequest === 'function') {
      await solver.serviceRequest('/v1/aetheria/proxy/screen-block', {
        machineId: getMachineId(),
        proxyId: blockEntry.proxyId,
        ip: blockEntry.ip,
        labelIp: blockEntry.ip,
        host: blockEntry.host,
        proxyHost: blockEntry.host,
        port: blockEntry.port,
        proxyPort: blockEntry.port,
        reason: blockEntry.reason,
        trigger: blockEntry.trigger,
        triggerType: blockEntry.trigger,
        profileId: blockEntry.profileId,
        charName: blockEntry.charName
      }).catch(() => {});
    }

    // Re-allocate clean IPs for other profiles that were sharing this IP (excluding the banned profile itself if requested)
    const profilesToReassign = evictedProfileIds.filter(id => id !== pid || !meta.stopBannedProfile);
    if (settings.enabled && profilesToReassign.length > 0) {
      if (settings.mode === 'owner-queue' && typeof solver?.serviceRequest === 'function') {
        await acquireLeasesForProfiles(profilesToReassign);
      } else {
        allocateFromLocalPool(profilesToReassign.map(id => ({ profileId: id })));
      }
    }
    syncDaemonState().catch(() => {});
    for (const evictedId of evictedProfileIds) {
      resetProfileSockets(evictedId);
    }

    return {
      success: true,
      blocked: true,
      entry: blockEntry,
      evictedProfileIds,
      blockedCount: blockedProxies.size
    };
  }

  async function blockProxyManual({ proxyId, ip, host, port, reason, trigger } = {}) {
    return blockProxyForProfile('', {
      proxyId,
      ip: ip || host,
      host: host || ip,
      port,
      reason: reason || 'บล็อคด้วยตัวเอง (Manual Block)',
      trigger: trigger || 'manual'
    });
  }

  function unblockProxy({ key, proxyId, ip } = {}) {
    let removed = 0;
    const targetKey = String(key || proxyId || '').trim();
    const targetIp = String(ip || '').trim();
    for (const [k, v] of Array.from(blockedProxies.entries())) {
      if ((targetKey && (k === targetKey || v.proxyId === targetKey)) || (targetIp && (v.ip === targetIp || v.host === targetIp))) {
        blockedProxies.delete(k);
        removed++;
      }
    }
    if (removed > 0) {
      saveBlockedProxies();
      syncDaemonState().catch(() => {});
    }
    return {
      success: true,
      removed,
      blockedCount: blockedProxies.size,
      blockedProxies: getBlockedProxies()
    };
  }

  function clearAllBlockedProxies() {
    const count = blockedProxies.size;
    blockedProxies.clear();
    saveBlockedProxies();
    if (count > 0) syncDaemonState().catch(() => {});
    return {
      success: true,
      removed: count,
      blockedCount: 0,
      blockedProxies: []
    };
  }

  function pruneBlockedFromPool() {
    const settings = loadSettings();
    const { rawText } = loadPool();
    const lines = String(rawText || '').split(/\r?\n/);
    const keptLines = [];
    let removedCount = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        keptLines.push(line);
        continue;
      }
      const parsed = parseSingleProxyLine(trimmed, 0, settings.maxScreensPerIp);
      if (parsed && isProxyBlocked(parsed)) {
        removedCount++;
        continue;
      }
      keptLines.push(line);
    }
    const cleanText = keptLines.join('\n').trim();
    const saved = savePool(cleanText, settings.maxScreensPerIp);
    return {
      success: true,
      removedCount,
      remainingCount: saved.proxies.length,
      poolText: saved.rawText
    };
  }

  // Local 1 IP : N Screens Queue Allocator
  function allocateFromLocalPool(requestedProfiles) {
    const settings = loadSettings();
    const { proxies } = loadPool();
    const enabledPool = proxies.filter(p => p.enabled !== false && !isProxyBlocked(p));
    const poolMap = new Map(enabledPool.map(p => [p.proxyId, p]));
    const maxPerIp = settings.maxScreensPerIp || DEFAULT_MAX_SCREENS_PER_IP;

    const profileOrderMap = new Map();
    try {
      const allProfiles = typeof loadProfiles === 'function' ? (loadProfiles() || []) : [];
      allProfiles.forEach((p, idx) => {
        if (p && p.id) profileOrderMap.set(p.id, idx);
      });
    } catch (_) {}

    // Prune activeLeases for profiles whose proxy is no longer in pool or was blocked
    for (const [pid, l] of Array.from(activeLeases.entries())) {
      if (!poolMap.has(l.proxyId) || isProxyBlocked(l)) activeLeases.delete(pid);
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
    const cleanEnabledPool = enabledPool.filter(p => !isProxyOnJailCooldown(p));

    for (const reqItem of requestedProfiles) {
      const pid = reqItem.profileId;
      let chosenProxy = null;
      let chosenSlotNo = 1;
      const existingActive = activeLeases.get(pid);

      // Keep already-active survivor screen on its IP even if that IP entered soft jail cooldown
      if (existingActive && poolMap.has(existingActive.proxyId)) {
        const cand = poolMap.get(existingActive.proxyId);
        const usedMap = slotsByProxy.get(cand.proxyId);
        const cap = maxPerIp;
        if (usedMap.has(pid) && usedMap.size <= cap) {
          chosenProxy = cand;
          chosenSlotNo = usedMap.get(pid);
        }
      }

      const orderIdx = profileOrderMap.has(pid) ? profileOrderMap.get(pid) : -1;
      const preferredBlockProxy = (!chosenProxy && orderIdx >= 0 && Math.floor(orderIdx / maxPerIp) < enabledPool.length)
        ? enabledPool[Math.floor(orderIdx / maxPerIp)]
        : null;
      const preferredSlotInBlock = orderIdx >= 0 ? ((orderIdx % maxPerIp) + 1) : 1;

      if (!chosenProxy && preferredBlockProxy && (!isProxyOnJailCooldown(preferredBlockProxy) || cleanEnabledPool.length === 0)) {
        const usedMap = slotsByProxy.get(preferredBlockProxy.proxyId);
        const cap = maxPerIp;
        if (usedMap.has(pid) && usedMap.size <= cap) {
          chosenProxy = preferredBlockProxy;
          chosenSlotNo = usedMap.get(pid);
        } else if (!usedMap.has(pid) && usedMap.size < cap) {
          // Remove from any old proxy slot if it moved IP blocks
          for (const m of slotsByProxy.values()) {
            if (m.has(pid)) m.delete(pid);
          }
          chosenProxy = preferredBlockProxy;
          const taken = new Set(usedMap.values());
          chosenSlotNo = !taken.has(preferredSlotInBlock)
            ? preferredSlotInBlock
            : pickFreeSlotNo(usedMap, cap);
          usedMap.set(pid, chosenSlotNo);
        }
      }

      if (!chosenProxy) {
        const stickyProxyId = existingActive?.proxyId || stickyHistory.get(pid);

        if (stickyProxyId && poolMap.has(stickyProxyId)) {
          const cand = poolMap.get(stickyProxyId);
          if (!isProxyOnJailCooldown(cand) || cleanEnabledPool.length === 0) {
            const usedMap = slotsByProxy.get(cand.proxyId);
            const cap = maxPerIp;
            if (usedMap.has(pid) && usedMap.size <= cap) {
              chosenProxy = cand;
              chosenSlotNo = usedMap.get(pid);
            } else if (!usedMap.has(pid) && usedMap.size < cap) {
              chosenProxy = cand;
              chosenSlotNo = pickFreeSlotNo(usedMap, cap);
              usedMap.set(pid, chosenSlotNo);
            }
          }
        }
      }

      if (!chosenProxy) {
        const poolOrder = cleanEnabledPool.length > 0 ? [...cleanEnabledPool, ...enabledPool.filter(p => isProxyOnJailCooldown(p))] : enabledPool;
        for (const cand of poolOrder) {
          const usedMap = slotsByProxy.get(cand.proxyId);
          const cap = maxPerIp;
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
          error: enabledPool.length === 0
            ? (proxies.length > 0 ? 'Proxy IP ในคิวถูกบล็อค (โดนแบน/เข้าคุก) หมดแล้ว' : 'ยังไม่ได้ใส่รายการ Proxy IP')
            : `คิว IP เต็มทุกช่องแล้ว (1 IP : ${maxPerIp} จอ)`
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
        maxScreens: maxPerIp,
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
      l.maxScreens = maxPerIp;
    }
    saveStickyHistory();
    syncDaemonState().catch(() => {});
    return results;
  }

  // If proxy is enabled in local-pool mode on boot, pre-allocate leases for known profiles immediately
  try {
    const bootSettings = loadSettings();
    if (bootSettings.enabled && bootSettings.mode === 'local-pool' && typeof loadProfiles === 'function') {
      const bootProfiles = loadProfiles() || [];
      const missingBoot = bootProfiles.filter(p => p && p.id && !activeLeases.has(p.id)).map(p => ({ profileId: p.id }));
      if (missingBoot.length > 0 && loadPool().proxies.length > 0) {
        allocateFromLocalPool(missingBoot);
      }
    }
  } catch (_) {}

  const usePersistentDaemon = Boolean(
    process.env.PELICAN_TEST_INSTANCE !== '1' &&
    path.resolve(dataDir).toLowerCase() === path.resolve(__dirname, 'data').toLowerCase()
  );
  const daemonControlPort = Number(process.env.PELICAN_TUNNEL_DAEMON_PORT) || 18989;
  const supervisorPid = process.env.PELICAN_SERVER_CHILD === '1' ? process.ppid : process.pid;
  let daemonSpawnPromise = null;

  function daemonRequest(method, urlPath, bodyObj = null, timeoutMs = 2500) {
    return new Promise((resolve, reject) => {
      const payload = bodyObj !== null ? JSON.stringify(bodyObj) : '';
      const req = http.request({
        host: '127.0.0.1',
        port: daemonControlPort,
        method,
        path: urlPath,
        headers: bodyObj !== null ? {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': String(Buffer.byteLength(payload, 'utf8'))
        } : {},
        timeout: timeoutMs
      }, res => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          try {
            const parsed = raw ? JSON.parse(raw) : {};
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
            else reject(new Error(parsed.error || `HTTP_${res.statusCode}`));
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('timeout', () => req.destroy(new Error('DAEMON_TIMEOUT')));
      req.on('error', reject);
      if (bodyObj !== null) req.write(payload);
      req.end();
    });
  }

  function buildDaemonSyncPayload() {
    const leasesObj = {};
    for (const [pid, l] of activeLeases.entries()) {
      if (pid && l && l.assigned && !isProxyBlocked(l)) {
        leasesObj[pid] = l;
      }
    }
    return {
      supervisorPid,
      settings: loadSettings(),
      leases: leasesObj,
      replaceLeases: true,
      blockedProxies: Array.from(blockedProxies.values())
    };
  }

  const EXPECTED_DAEMON_VERSION = 2;

  async function ensureDaemonRunning() {
    if (!usePersistentDaemon) return false;
    let prevTunnelsToRestore = [];
    try {
      const ping = await daemonRequest('GET', '/ping', null, 1200);
      if (ping && ping.ok) {
        if ((Number(ping.version) || 1) >= EXPECTED_DAEMON_VERSION) {
          if (Array.isArray(ping.tunnels)) {
            for (const dt of ping.tunnels) {
              if (dt && dt.profileId && dt.port && !tunnels.has(dt.profileId)) {
                tunnels.set(dt.profileId, {
                  profileId: dt.profileId,
                  port: dt.port,
                  proxyUrl: dt.proxyUrl || `http://127.0.0.1:${dt.port}`,
                  daemonManaged: true,
                  server: { listening: true, close: cb => cb && cb() },
                  sockets: new Set()
                });
              }
            }
          }
          return true;
        }
        // Outdated daemon (e.g. v1 fail-open) -> gracefully upgrade to v2 fail-closed and restore tunnel ports
        prevTunnelsToRestore = Array.isArray(ping.tunnels) ? ping.tunnels : [];
        await daemonRequest('POST', '/shutdown', {}, 1200).catch(() => {});
        await new Promise(r => setTimeout(r, 220));
      }
    } catch (_) {}

    if (daemonSpawnPromise) return daemonSpawnPromise;
    daemonSpawnPromise = (async () => {
      try {
        const { spawn } = require('child_process');
        const daemonScript = path.join(__dirname, 'proxy_tunnel_daemon.js');
        if (!fs.existsSync(daemonScript)) return false;
        const child = spawn(process.execPath, [
          daemonScript,
          '--data-dir', dataDir,
          '--port', String(daemonControlPort),
          '--supervisor-pid', String(supervisorPid)
        ], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        child.unref?.();
        for (let i = 0; i < 15; i++) {
          await new Promise(r => setTimeout(r, 100));
          try {
            const ping = await daemonRequest('GET', '/ping', null, 1000);
            if (ping && ping.ok) {
              await daemonRequest('POST', '/sync', buildDaemonSyncPayload(), 2000).catch(() => {});
              for (const dt of prevTunnelsToRestore) {
                if (dt && dt.profileId && dt.port) {
                  const inferredDebugPort = dt.port >= 51000 ? (49876 + (dt.port - 51000)) : 49876;
                  await daemonRequest('POST', '/ensure-tunnel', {
                    supervisorPid,
                    profileId: dt.profileId,
                    debugPort: inferredDebugPort,
                    settings: loadSettings(),
                    lease: activeLeases.get(dt.profileId) || null
                  }, 2000).catch(() => {});
                }
              }
              return true;
            }
          } catch (_) {}
        }
      } catch (_) {}
      return false;
    })().finally(() => {
      daemonSpawnPromise = null;
    });
    return daemonSpawnPromise;
  }

  async function syncDaemonState() {
    if (!usePersistentDaemon) return false;
    try {
      const ok = await ensureDaemonRunning();
      if (!ok) return false;
      await daemonRequest('POST', '/sync', buildDaemonSyncPayload(), 2000);
      return true;
    } catch (_) {
      return false;
    }
  }

  async function drainDaemonTraffic() {
    if (!usePersistentDaemon) return;
    try {
      const res = await daemonRequest('POST', '/drain-traffic', {}, 1500);
      if (res && res.ok && res.byProfile && typeof res.byProfile === 'object') {
        for (const [pid, counts] of Object.entries(res.byProfile)) {
          if (!counts || typeof counts !== 'object') continue;
          const realPid = pid === '_global' ? null : pid;
          if ((counts.proxyRxBytes || 0) > 0 || (counts.proxyTxBytes || 0) > 0) {
            recordTraffic(realPid, counts.proxyRxBytes || 0, counts.proxyTxBytes || 0, true);
          }
          if ((counts.directRxBytes || 0) > 0 || (counts.directTxBytes || 0) > 0) {
            recordTraffic(realPid, counts.directRxBytes || 0, counts.directTxBytes || 0, false);
          }
        }
      }
    } catch (_) {}
  }

  if (usePersistentDaemon) {
    ensureDaemonRunning().then(ok => {
      if (ok) syncDaemonState().catch(() => {});
    }).catch(() => {});
    const daemonDrainTimer = setInterval(() => {
      drainDaemonTraffic().catch(() => {});
    }, 3000);
    daemonDrainTimer.unref?.();
  }

  async function acquireLeasesForProfiles(profileIds = []) {
    const ids = Array.from(new Set(profileIds.filter(Boolean)));
    if (ids.length === 0) return [];
    const settings = loadSettings();
    if (!settings.enabled) return [];

    const reqProfiles = ids.map(profileId => ({ profileId }));
    const allKnownProfiles = typeof loadProfiles === 'function' ? (loadProfiles() || []) : [];
    const validProfileIds = allKnownProfiles.map(p => p && p.id).filter(Boolean);

    if (settings.mode === 'owner-queue' && typeof solver?.serviceRequest === 'function') {
      try {
        const excludedFilters = getExcludedProxyFilters();
        const res = await solver.serviceRequest('/v1/aetheria/proxy/screen-lease', {
          machineId: getMachineId(),
          profiles: reqProfiles,
          validProfileIds: validProfileIds.length > 0 ? validProfileIds : undefined,
          ...excludedFilters
        });
        if (res?.success && Array.isArray(res.leases)) {
          const validLeases = res.leases.filter(l => !l.assigned || !isProxyBlocked(l));
          const hasAnyAssigned = validLeases.some(l => l.assigned);
          const allEmpty = res.leases.length > 0 && res.leases.every(l => l.code === 'IP_POOL_EMPTY');
          if (hasAnyAssigned || !allEmpty) {
            for (const l of validLeases) {
              if (l.assigned) {
                const prev = activeLeases.get(l.profileId);
                activeLeases.set(l.profileId, { ...prev, ...l, source: 'owner-queue', renewedAt: now() });
                stickyHistory.set(l.profileId, l.proxyId);
                if (prev && prev.proxyId && prev.proxyId !== l.proxyId) {
                  resetProfileSockets(l.profileId);
                }
              }
            }
            saveStickyHistory();
            await syncDaemonState().catch(() => {});
            syncProxyBillingToServer().catch(() => {});
            return validLeases;
          }
        }
      } catch (_) {
        // If owner-host has a brief hiccup, keep existing active leases alive rather than dropping to uncoordinated local pool
        const cached = ids.map(pid => activeLeases.get(pid)).filter(l => l && !isProxyBlocked(l));
        if (cached.length > 0) return cached;
        return ids.map(profileId => ({
          profileId,
          assigned: false,
          code: 'OWNER_QUEUE_UNAVAILABLE',
          error: 'ติดต่อเซิร์ฟเวอร์คิว Proxy ไม่ได้ชั่วคราว'
        }));
      }
    }

    return allocateFromLocalPool(reqProfiles);
  }

  function resetProfileSockets(profileId) {
    if (usePersistentDaemon) {
      daemonRequest('POST', '/reset-sockets', { profileId }, 1500).catch(() => {});
    }
    const t = tunnels.get(profileId);
    if (!t || !t.sockets) return;
    for (const sock of Array.from(t.sockets)) {
      try { sock.destroy(); } catch (_) {}
    }
    t.sockets.clear();
  }

  async function ensureProfileTunnel(profileId, debugPort = 49876) {
    if (usePersistentDaemon) {
      try {
        const daemonOk = await ensureDaemonRunning();
        if (daemonOk) {
          const res = await daemonRequest('POST', '/ensure-tunnel', {
            supervisorPid,
            profileId,
            debugPort,
            settings: loadSettings(),
            lease: activeLeases.get(profileId) || null
          }, 3000);
          if (res && res.ok && res.port) {
            const entry = {
              profileId,
              port: res.port,
              proxyUrl: res.proxyUrl || `http://127.0.0.1:${res.port}`,
              daemonManaged: true,
              server: { listening: true, close: cb => cb && cb() },
              sockets: new Set()
            };
            tunnels.set(profileId, entry);
            return entry;
          }
        }
      } catch (_) {}
    }

    const existing = tunnels.get(profileId);
    if (existing && !existing.daemonManaged && existing.server && existing.server.listening) {
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
      const requiresProxy = Boolean(settings.enabled && (!settings.onlyGameTraffic || isGameOrIpCheckHost(targetHost)));
      let lease = settings.enabled ? activeLeases.get(profileId) : null;
      if (requiresProxy && (!lease?.assigned || isProxyBlocked(lease))) {
        try {
          await acquireLeasesForProfiles([profileId]);
          lease = activeLeases.get(profileId) || null;
        } catch (_) {}
      }
      if (requiresProxy && (!lease?.assigned || isProxyBlocked(lease))) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Proxy lease unavailable (Fail-Closed)');
      }
      const useProxy = Boolean(requiresProxy && lease?.assigned && !isProxyBlocked(lease));

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
          recordTraffic(profileId, 0, rawReqHead.length, true);
          upstream.write(rawReqHead);
          req.on('data', chunk => recordTraffic(profileId, 0, chunk.length, true));
          upstream.on('data', chunk => recordTraffic(profileId, chunk.length, 0, true));
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
      const requiresProxy = Boolean(
        settings.enabled &&
        (!settings.onlyGameTraffic || isGameOrIpCheckHost(targetHost))
      );
      let lease = settings.enabled ? activeLeases.get(profileId) : null;
      if (requiresProxy && (!lease?.assigned || isProxyBlocked(lease))) {
        try {
          await acquireLeasesForProfiles([profileId]);
          lease = activeLeases.get(profileId);
        } catch (_) {}
      }
      if (requiresProxy && (!lease?.assigned || isProxyBlocked(lease))) {
        // Fail-Closed: NEVER fall back to Direct Home IP when Proxy Mode is ON
        clientSocket.destroy();
        return;
      }

      const shouldRouteViaProxy = Boolean(
        requiresProxy &&
        lease?.assigned &&
        !isProxyBlocked(lease)
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

      // Connect through assigned upstream proxy (1 IP : N screens) with automatic fast retries
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
    let lease = activeLeases.get(profileId) || null;
    if (!lease || !lease.assigned || isProxyBlocked(lease)) {
      const res = await acquireLeasesForProfiles([profileId]);
      lease = res[0] || activeLeases.get(profileId) || null;
    }
    if (!lease || !lease.assigned || isProxyBlocked(lease)) {
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
    saveStickyHistory();
    syncDaemonState().catch(() => {});
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
    saveStickyHistory();
    syncDaemonState().catch(() => {});
    if (usePersistentDaemon) {
      daemonRequest('POST', '/reset-sockets', { all: true }, 1500).catch(() => {});
    }
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
    } else if (openProfileIds.length > 0) {
      await acquireLeasesForProfiles(openProfileIds);
      for (const pid of openProfileIds) resetProfileSockets(pid);
    }
    return updated;
  }

  function publicSettings() {
    const settings = loadSettings();
    const { rawText, proxies } = loadPool();
    const enabledPool = proxies.filter(p => p.enabled !== false && !isProxyBlocked(p));
    const maxPerIp = settings.maxScreensPerIp || DEFAULT_MAX_SCREENS_PER_IP;
    const totalSlots = enabledPool.length * maxPerIp;
    const activeLeaseCount = activeLeases.size;
    return {
      ...settings,
      poolCount: enabledPool.length,
      totalPoolCount: proxies.length,
      blockedCount: blockedProxies.size,
      totalSlots,
      activeLeaseCount,
      freeSlots: Math.max(0, totalSlots - activeLeaseCount),
      poolText: rawText
    };
  }

  async function savePoolAndSettings(data = {}) {
    const prevSettings = loadSettings();
    const updated = saveSettings({
      ...(typeof data.enabled === 'boolean' ? { enabled: data.enabled } : {}),
      ...(data.mode ? { mode: data.mode } : {}),
      ...(data.maxScreensPerIp !== undefined ? { maxScreensPerIp: data.maxScreensPerIp } : {}),
      ...(typeof data.onlyGameTraffic === 'boolean' ? { onlyGameTraffic: data.onlyGameTraffic } : {}),
      ...(typeof data.localAssetCache === 'boolean' ? { localAssetCache: data.localAssetCache } : {})
    });
    if (data.billingConfig && typeof data.billingConfig === 'object') {
      updateBillingConfig(data.billingConfig);
    }
    const rawPoolText = typeof data.poolText === 'string'
      ? data.poolText
      : (typeof data.rawText === 'string' ? data.rawText : null);
    let poolInfo = loadPool();
    if (rawPoolText !== null) {
      poolInfo = savePool(rawPoolText, updated.maxScreensPerIp);
    } else if (prevSettings.maxScreensPerIp !== updated.maxScreensPerIp && typeof poolInfo.rawText === 'string') {
      poolInfo = savePool(poolInfo.rawText, updated.maxScreensPerIp);
    }
    if (prevSettings.maxScreensPerIp !== updated.maxScreensPerIp && activeLeases.size > 0) {
      const currentActivePids = Array.from(activeLeases.keys());
      activeLeases.clear();
      if (updated.mode === 'owner-queue' && typeof solver?.serviceRequest === 'function') {
        await acquireLeasesForProfiles(currentActivePids);
      } else {
        allocateFromLocalPool(currentActivePids.map(profileId => ({ profileId })));
      }
    }
    return {
      success: true,
      settings: publicSettings(),
      pool: poolInfo,
      billing: getBillingStatus(),
      blockedProxies: getBlockedProxies()
    };
  }

  async function testConnection(sampleProfileId = 'test_probe') {
    const { proxies } = loadPool();
    const unblockedProxies = proxies.filter(p => !isProxyBlocked(p));
    let targetLease = activeLeases.get(sampleProfileId) || Array.from(activeLeases.values())[0] || null;
    if (!targetLease) {
      const leases = await acquireLeasesForProfiles([sampleProfileId]);
      targetLease = leases.find(l => l.assigned) || null;
      if (sampleProfileId === 'test_probe') activeLeases.delete('test_probe');
    }
    if (!targetLease && unblockedProxies.length > 0) {
      const p = unblockedProxies[0];
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
        error: proxies.length > 0 && unblockedProxies.length === 0
          ? 'Proxy IP ในคิวถูกบล็อคหมดแล้ว กรุณาปลดบล็อคหรือเพิ่ม IP ใหม่ก่อนทดสอบ'
          : 'ยังไม่มี Proxy IP ในคิว กรุณาเพิ่มรายการ Proxy (ip:port:user:pass) ก่อนทดสอบ'
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
    await drainDaemonTraffic().catch(() => {});
    const pub = publicSettings();
    const { rawText, proxies } = loadPool();
    const enabledPool = proxies.filter(p => p.enabled !== false && !isProxyBlocked(p));
    const maxPerIp = pub.maxScreensPerIp || DEFAULT_MAX_SCREENS_PER_IP;
    const allProfiles = typeof loadProfiles === 'function' ? (loadProfiles() || []) : [];
    const validProfileIds = allProfiles.map(p => p && p.id).filter(Boolean);
    if (validProfileIds.length > 0) {
      const validSet = new Set(validProfileIds);
      let pruned = false;
      for (const pid of Array.from(activeLeases.keys())) {
        if (!validSet.has(pid)) {
          activeLeases.delete(pid);
          stickyHistory.delete(pid);
          pruned = true;
        }
      }
      if (pruned) {
        saveStickyHistory();
        syncDaemonState().catch(() => {});
      }
    }

    if (pub.enabled && Array.isArray(openProfileIds) && openProfileIds.length > 0) {
      const nowMs = now();
      const missing = openProfileIds.filter(pid => {
        const l = activeLeases.get(pid);
        if (!l || !l.assigned || isProxyBlocked(l)) return true;
        if (pub.mode === 'owner-queue' && (nowMs - (l.renewedAt || 0) > 5 * 60 * 1000)) return true;
        return false;
      });
      if (missing.length > 0) {
        await acquireLeasesForProfiles(missing).catch(() => {});
      }
    }

    let remoteSummary = null;
    if (pub.mode === 'owner-queue' && typeof solver?.serviceRequest === 'function') {
      try {
        const excludedFilters = getExcludedProxyFilters();
        const r = await solver.serviceRequest('/v1/aetheria/proxy/screen-status', {
          machineId: getMachineId(),
          validProfileIds: validProfileIds.length > 0 ? validProfileIds : undefined,
          ...excludedFilters
        });
        if (r?.success && r.totalIps > 0) {
          remoteSummary = r;
          if (Array.isArray(r.myLeases)) {
            let syncedChanged = false;
            for (const rl of r.myLeases) {
              if (!rl || !rl.profileId || isProxyBlocked(rl)) continue;
              const prev = activeLeases.get(rl.profileId);
              if (rl.proxyHost && rl.proxyPort) {
                const proxyChanged = Boolean(prev && prev.proxyId && prev.proxyId !== rl.proxyId);
                const metaChanged = Boolean(!prev || proxyChanged || prev.slotNo !== rl.slotNo || prev.activeOnIp !== rl.activeOnIp);
                if (metaChanged) {
                  activeLeases.set(rl.profileId, {
                    ...prev,
                    ...rl,
                    assigned: true,
                    source: 'owner-queue',
                    renewedAt: prev?.renewedAt || now()
                  });
                  stickyHistory.set(rl.profileId, rl.proxyId);
                  syncedChanged = true;
                  if (proxyChanged) {
                    resetProfileSockets(rl.profileId);
                  }
                }
              } else if (prev) {
                prev.slotNo = rl.slotNo || prev.slotNo;
                prev.activeOnIp = rl.activeOnIp || prev.activeOnIp;
                prev.maxScreens = rl.maxScreens || maxPerIp;
              }
            }
            if (syncedChanged) {
              saveStickyHistory();
              syncDaemonState().catch(() => {});
            }
          }
        }
      } catch (_) {}
    }

    const totalIps = remoteSummary ? remoteSummary.totalIps : enabledPool.length;
    const totalCapacity = totalIps * maxPerIp;
    const activeCount = remoteSummary ? remoteSummary.activeLeases : activeLeases.size;

    const openSet = new Set(Array.isArray(openProfileIds) ? openProfileIds : []);
    const billing = getBillingStatus();

    const leases = Array.from(activeLeases.values()).filter(l => l && l.assigned).map(l => {
      const tunnel = tunnels.get(l.profileId) || null;
      const pTraffic = trafficState.byProfile[l.profileId] || { proxyRxBytes: 0, proxyTxBytes: 0 };
      const pBill = billing.byProfile?.[l.profileId] || null;
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
        proxyTotalBytes: (pTraffic.proxyRxBytes || 0) + (pTraffic.proxyTxBytes || 0),
        meritTotal: pBill?.totalMerit || 0,
        meritToday: pBill?.todayMerit || 0
      };
    });

    const assignments = allProfiles.map(p => {
      const lease = activeLeases.get(p.id) || null;
      const tunnel = tunnels.get(p.id) || null;
      const pTraffic = trafficState.byProfile[p.id] || { proxyRxBytes: 0, proxyTxBytes: 0 };
      const pBill = billing.byProfile?.[p.id] || null;
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
        proxyTotalBytes: (pTraffic.proxyRxBytes || 0) + (pTraffic.proxyTxBytes || 0),
        meritTotal: pBill?.totalMerit || 0,
        meritToday: pBill?.todayMerit || 0,
        isBanned: Boolean(p.isBanned),
        banReason: p.banReason || null
      };
    });

    const traffic = getTrafficStats();

    return {
      success: true,
      settings: {
        ...pub,
        poolCount: totalIps,
        totalPoolCount: proxies.length,
        blockedCount: blockedProxies.size,
        totalSlots: totalCapacity,
        activeLeaseCount: activeCount,
        freeSlots: Math.max(0, totalCapacity - activeCount)
      },
      pool: {
        totalIps,
        totalPoolCount: proxies.length,
        blockedCount: blockedProxies.size,
        maxScreensPerIp: maxPerIp,
        totalCapacity,
        activeLeases: activeCount,
        availableSlots: Math.max(0, totalCapacity - activeCount),
        rawText,
        items: proxies.map(p => ({
          proxyId: p.proxyId,
          ip: p.labelIp,
          host: p.host,
          port: p.port,
          scheme: p.scheme,
          hasAuth: Boolean(p.user || p.pass),
          maxScreens: p.maxScreens || maxPerIp,
          blocked: Boolean(p.blocked),
          blockInfo: p.blockInfo || null
        }))
      },
      blockedProxies: getBlockedProxies(),
      billing,
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
    getMachineHwid: () => currentMachineHwid,
    getMachineId,
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
    getBillingStatus,
    updateBillingConfig,
    syncProxyBillingToServer,
    getBlockedProxies,
    markProxyJailCooldownForProfile,
    isProxyOnJailCooldown,
    blockProxyForProfile,
    blockProxyManual,
    unblockProxy,
    clearAllBlockedProxies,
    pruneBlockedFromPool,
    isProxyBlocked,
    dispose
  };
}

module.exports = {
  createScreenProxyManager,
  parseProxyPoolText,
  parseProxyPoolLines: parseProxyPoolText,
  isGameOrIpCheckHost
};
