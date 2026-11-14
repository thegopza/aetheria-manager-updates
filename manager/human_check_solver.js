// PmheeAether CAPTCHA client. Wallet and redemption remain server-authoritative.
// Never accept a local balance/signature as payment authorization.
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execSync } = require('child_process');
const { createLocalHumanCheck } = require('./local_human_check');

function getMachineFingerprint() {
  let identity = os.hostname().toUpperCase();
  try {
    const output = execSync('reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', { encoding: 'utf8', windowsHide: true });
    identity = output.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i)?.[1]?.toUpperCase() || identity;
  } catch (_) {}
  return crypto.createHash('sha256').update('PMhee.MachineFingerprint.v1|' + identity).digest('hex').toUpperCase();
}
function createHumanCheckSolver({ dataDir, requestJSON: testRequest, serviceUrl: testServiceUrl, localCatalogSeed = true, requireUserLogin = false } = {}) {
  const settingsFile = path.join(dataDir, 'human_check_settings.json');
  const accountFile = path.join(dataDir, 'aetheria_service_account.json');
  const walletSnapshotFile = path.join(dataDir, 'wallet_snapshot_v1.json');
  const accessStateFile = path.join(dataDir, 'machine_access_state.json');
  fs.mkdirSync(dataDir, { recursive: true });
  const localMatcher = createLocalHumanCheck({ dataDir, seed: localCatalogSeed });
  const base = new URL(testServiceUrl || process.env.PMHEE_AETHERIA_API_URL || 'https://api.noggunsshop.xyz');
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('CAPTCHA service requires an HTTPS origin');
  }
  const machineHwid = getMachineFingerprint();
  const machineHwidHash = crypto.createHash('sha256').update(machineHwid.toUpperCase()).digest('hex').toUpperCase();
  const machineHwidShort = `${machineHwidHash.slice(0, 4)}-${machineHwidHash.slice(4, 8)}-${machineHwidHash.slice(8, 12)}`;
  const machineName = os.hostname();
  const managerSessionId = crypto.randomUUID();
  let points = 0;
  let balanceUnits = null;
  let pointsPerSolve = 1;
  let topupHistory = [];
  let machineMerit = null;
  let serviceAvailable = false;
  let account = null;
  let enrollment = null;
  let offlineWallet = null;
  let onAccountChanged = null;
  const onAccountChangedListeners = new Set();
  function emitAccountChanged(newId, prevId) {
    if (onAccountChanged) {
      try { onAccountChanged(newId, prevId); } catch (_) {}
    }
    for (const fn of onAccountChangedListeners) {
      try { fn(newId, prevId); } catch (_) {}
    }
  }
  let deviceNameProvider = null;
  let lastCatalogAttempt = 0;
  let accessStatus = 'approved';
  let customRateUnits = null;
  let effectiveRateUnits = null;
  let accessRequestedAt = null;
  let accessNote = '';
  let username = null;
  let isUserAccount = false;
  let loggedOutExplicitly = false;
  try {
    const saved = JSON.parse(fs.readFileSync(accountFile, 'utf8'));
    if (saved.origin === base.origin && (!saved.machineHwid || saved.machineHwid === machineHwid)) {
      if (saved.loggedOutExplicitly && !saved.token) {
        loggedOutExplicitly = true;
      } else if (/^[a-f0-9]{64}$/.test(saved.token || '') && typeof saved.accountId === 'string') {
        account = saved;
        username = typeof saved.username === 'string' && saved.username ? saved.username : null;
        isUserAccount = Boolean(saved.isUserAccount || username);
      }
    }
  } catch (_) {}
  try {
    const savedAccess = JSON.parse(fs.readFileSync(accessStateFile, 'utf8'));
    if (savedAccess && savedAccess.origin === base.origin && savedAccess.machineHwid === machineHwid && !loggedOutExplicitly) {
      if (['approved', 'pending', 'revoked'].includes(savedAccess.accessStatus)) accessStatus = savedAccess.accessStatus;
      if (savedAccess.customRateUnits === null || Number.isSafeInteger(savedAccess.customRateUnits)) customRateUnits = savedAccess.customRateUnits;
      if (savedAccess.effectiveRateUnits === null || Number.isSafeInteger(savedAccess.effectiveRateUnits)) effectiveRateUnits = savedAccess.effectiveRateUnits;
      if (savedAccess.accessRequestedAt === null || Number.isSafeInteger(savedAccess.accessRequestedAt)) accessRequestedAt = savedAccess.accessRequestedAt;
      if (typeof savedAccess.accessNote === 'string') accessNote = savedAccess.accessNote;
      if (!username && typeof savedAccess.username === 'string' && savedAccess.username) username = savedAccess.username;
      if (!isUserAccount && savedAccess.isUserAccount) isUserAccount = true;
    }
  } catch (_) {}
  try{const saved=JSON.parse(fs.readFileSync(walletSnapshotFile,'utf8'));if(saved.origin===base.origin&&saved.accountId===account?.accountId&&Number.isSafeInteger(saved.balanceUnits)){balanceUnits=saved.balanceUnits;points=balanceUnits/100;if(Array.isArray(saved.topupHistory))topupHistory=saved.topupHistory;if(saved.machineMerit&&typeof saved.machineMerit==='object')machineMerit=saved.machineMerit;}}catch(_){}
  function atomicWrite(file, data) {
    fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  }
  function applyAccessMeta(result) {
    if (!result || typeof result !== 'object') return;
    let changed = false;
    if (['approved', 'pending', 'revoked'].includes(result.accessStatus) && result.accessStatus !== accessStatus) {
      accessStatus = result.accessStatus;
      changed = true;
    }
    if (result.customRateUnits !== undefined) {
      const nextCustom = (result.customRateUnits === null) ? null : (Number.isSafeInteger(Number(result.customRateUnits)) ? Number(result.customRateUnits) : customRateUnits);
      if (nextCustom !== customRateUnits) {
        customRateUnits = nextCustom;
        changed = true;
      }
    }
    if (result.effectiveRateUnits !== undefined || result.rateUnits !== undefined) {
      const rawEff = result.effectiveRateUnits !== undefined ? result.effectiveRateUnits : result.rateUnits;
      const nextEff = (rawEff === null) ? null : (Number.isSafeInteger(Number(rawEff)) ? Number(rawEff) : effectiveRateUnits);
      if (nextEff !== effectiveRateUnits) {
        effectiveRateUnits = nextEff;
        changed = true;
      }
    }
    if (result.accessRequestedAt !== undefined && result.accessRequestedAt !== accessRequestedAt) {
      accessRequestedAt = result.accessRequestedAt || null;
      changed = true;
    }
    if (typeof result.accessNote === 'string' && result.accessNote !== accessNote) {
      accessNote = result.accessNote;
      changed = true;
    }
    if (result.username !== undefined) {
      const nextU = typeof result.username === 'string' && result.username ? result.username : null;
      if (nextU !== username) {
        username = nextU;
        changed = true;
      }
    }
    if (result.isUserAccount !== undefined) {
      const nextIsUser = Boolean(result.isUserAccount);
      if (nextIsUser !== isUserAccount) {
        isUserAccount = nextIsUser;
        changed = true;
      }
    }
    if (changed) {
      try {
        atomicWrite(accessStateFile, {
          origin: base.origin,
          machineHwid,
          machineHwidShort,
          accessStatus,
          customRateUnits,
          effectiveRateUnits,
          accessRequestedAt,
          accessNote,
          username,
          isUserAccount,
          updatedAt: Date.now()
        });
      } catch (_) {}
    }
  }
  function computeRequiresLogin() {
    if (loggedOutExplicitly && !account) return true;
    if (requireUserLogin) {
      return !account || !isUserAccount || !username;
    }
    return false;
  }
  function getAccessState() {
    return {
      accessStatus,
      machineHwid,
      machineHwidShort,
      customRateUnits,
      effectiveRateUnits,
      accessRequestedAt,
      accessNote,
      username,
      isUserAccount,
      requiresLogin: computeRequiresLogin(),
      accountId: account?.accountId || null
    };
  }
  function resolveEffectiveMachineMerit(effectiveBalanceUnits) {
    if (!machineMerit || typeof machineMerit !== 'object') return null;
    const baseMachines = Array.isArray(machineMerit.machines) ? machineMerit.machines : [];
    const nextMachines = baseMachines.map(m => ({ ...m }));
    const next = {
      ...machineMerit,
      machines: nextMachines,
      currentMachine: machineMerit.currentMachine ? { ...machineMerit.currentMachine } : null
    };
    if (
      Number.isSafeInteger(effectiveBalanceUnits) &&
      Number.isSafeInteger(next.balanceUnits) &&
      effectiveBalanceUnits < next.balanceUnits
    ) {
      const charge = next.balanceUnits - effectiveBalanceUnits;
      const shared = Math.max(0, Number(next.sharedCreditUnits || 0));
      const fromShared = Math.min(shared, charge);
      const extraDebt = -(charge - fromShared);
      next.sharedCreditUnits = shared - fromShared;
      next.sharedCreditMerit = next.sharedCreditUnits / 100;
      next.balanceUnits = effectiveBalanceUnits;
      next.balanceMerit = effectiveBalanceUnits / 100;
      const target = nextMachines.find(m => (next.currentMachineKey && m.machineKey === next.currentMachineKey) || m.isCurrentMachine);
      if (target) {
        target.debtUnits = Number(target.debtUnits || 0) + extraDebt;
        target.debtMerit = target.debtUnits / 100;
        target.todayUsedUnits = Number(target.todayUsedUnits || 0) + charge;
        target.todayUsedMerit = target.todayUsedUnits / 100;
        target.totalUsedUnits = Number(target.totalUsedUnits || 0) + charge;
        target.totalUsedMerit = target.totalUsedUnits / 100;
        next.currentMachine = { ...target };
      } else if (next.currentMachine) {
        next.currentMachine.debtUnits = Number(next.currentMachine.debtUnits || 0) + extraDebt;
        next.currentMachine.debtMerit = next.currentMachine.debtUnits / 100;
      }
      next.totalMachineDebtUnits = nextMachines.reduce((acc, m) => acc + Number(m.debtUnits || 0), 0);
      next.totalMachineDebtMerit = next.totalMachineDebtUnits / 100;
      next.negativeMachineCount = nextMachines.filter(m => Number(m.debtUnits || 0) < 0).length;
    }
    return next;
  }
  function loadSettings() {
    let s = {};
    try { s = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch (_) {}
    const effectiveBalanceUnits = offlineWallet ? offlineWallet.balance() : balanceUnits;
    return {
      autoAnswer: s.autoAnswer !== false,
      answerDelayMs: Math.max(800, Math.min(10000, parseInt(s.answerDelayMs, 10) || 1800)),
      pointSystemEnabled: true, points: offlineWallet ? offlineWallet.balance()/100 : points, balanceUnits: effectiveBalanceUnits, unitScale: 100, pointsPerSolve: localMatcher.ready() ? 0 : pointsPerSolve, localCatalogReady: localMatcher.ready(), pointsPerBaht: 1,
      machineHwid, machineHwidShort, accessStatus, customRateUnits, effectiveRateUnits, accessRequestedAt, accessNote,
      username, isUserAccount, requiresLogin: computeRequiresLogin(),
      topupHistory, machineMerit: resolveEffectiveMachineMerit(effectiveBalanceUnits), serviceAvailable, serviceOrigin: base.origin,
      accountId: account?.accountId || null
    };
  }
  function saveSettings(s) {
    const current = loadSettings();
    // Preserve old local records for support; their balances never authorize a solve.
    let prior = {};
    try { prior = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch (_) {}
    atomicWrite(settingsFile, {
      ...prior,
      autoAnswer: typeof s.autoAnswer === 'boolean' ? s.autoAnswer : current.autoAnswer,
      answerDelayMs: Math.max(800, Math.min(10000, parseInt(s.answerDelayMs ?? current.answerDelayMs, 10) || 1800))
    });
    return loadSettings();
  }
  const requestJSON = testRequest || ((route, payload, token, opts = {}) => new Promise((resolve, reject) => {
    const responseLimit = Number(opts && opts.responseLimit) || (['/v1/aetheria/script/payload-chunk','/v1/aetheria/offline/payload-chunk','/v1/aetheria/script/catalog'].includes(route) ? 1024 * 1024 : 131072);
    const data = payload == null ? null : JSON.stringify(payload);
    const activeDevName = String((typeof deviceNameProvider === 'function' ? deviceNameProvider() : '') || machineName || '').trim().slice(0, 80);
    const headers = {
      'Accept': 'application/json',
      'X-Machine-Hwid': machineHwid,
      'X-Device-Name-B64': Buffer.from(activeDevName, 'utf8').toString('base64url')
    };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const timeoutMs = Math.max(1000, Math.min(60000, Number(opts && opts.timeoutMs) || 15000));
    const req = https.request(new URL(route, base), { method: data ? 'POST' : 'GET', headers, timeout: timeoutMs }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('error', reject);
      res.on('data', c => {
        body += c;
        if (Buffer.byteLength(body) > responseLimit) res.destroy(new Error('Service response too large'));
      });
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const msg = (typeof result.message === 'string' && result.message) ? result.message : ((typeof result.error === 'string' && result.error) ? result.error : 'CAPTCHA service rejected request');
            const error = new Error(msg);
            error.status = res.statusCode;
            error.code = typeof result.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(result.code) ? result.code : 'SERVICE_REJECTED';
            return reject(error);
          }
          resolve(result);
        } catch (_) { reject(new Error('Invalid CAPTCHA service response')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('CAPTCHA service timeout')));
    req.end(data || undefined);
  }));
  async function ensureAccount(preferredDeviceName) {
    if (account) return account;
    if (loggedOutExplicitly || requireUserLogin) {
      const err = new Error('กรุณาเข้าสู่ระบบบัญชีผู้ใช้งาน');
      err.status = 401;
      err.code = 'AUTH_LOGIN_REQUIRED';
      throw err;
    }
    if (!enrollment) enrollment = (async () => {
      const payload = { machineHwid, machineName };
      if (typeof preferredDeviceName === 'string' && preferredDeviceName.trim()) {
        payload.deviceName = preferredDeviceName.trim().slice(0, 64);
      }
      const result = await requestJSON('/v1/aetheria/enroll', payload, null);
      if (!result?.success || typeof result.accountId !== 'string' || !/^[a-f0-9]{64}$/.test(result.token || '')) throw new Error('Invalid account enrollment');
      const saved = { origin: base.origin, accountId: result.accountId, token: result.token, machineHwid, username: result.username || null, isUserAccount: Boolean(result.isUserAccount) };
      atomicWrite(accountFile, saved);
      account = saved;
      loggedOutExplicitly = false;
      applyAccessMeta(result);
      if (result.schemaVersion === 2 && result.unitScale === 100 && Number.isSafeInteger(result.balanceUnits)) {
        updateBalance(result);
      }
      return account;
    })().finally(() => { enrollment = null; });
    return enrollment;
  }
  async function call(route, payload) {
    const credential = await ensureAccount();
    try {
      const result = await requestJSON(route, payload, credential.token);
      serviceAvailable = true;
      if (result && typeof result === 'object') applyAccessMeta(result);
      return result;
    } catch (e) {
      if (e && e.status === 403 && (e.code === 'ACCESS_PENDING' || e.code === 'ACCESS_REVOKED')) {
        serviceAvailable = true;
        applyAccessMeta({ accessStatus: e.code === 'ACCESS_REVOKED' ? 'revoked' : 'pending' });
        throw e;
      }
      if (e && e.status === 401 && (e.code === 'ACCOUNT_HWID_MISMATCH' || e.code === 'UNAUTHORIZED')) {
        const prevAccountId = account?.accountId || null;
        const wasUserAccount = Boolean(isUserAccount || account?.isUserAccount);
        account = null;
        machineMerit = null;
        try { fs.unlinkSync(walletSnapshotFile); } catch (_) {}
        if (wasUserAccount || requireUserLogin) {
          username = null;
          isUserAccount = false;
          loggedOutExplicitly = true;
          try { atomicWrite(accountFile, { origin: base.origin, machineHwid, loggedOutExplicitly: true }); } catch (_) {}
          if (prevAccountId) {
            emitAccountChanged(null, prevAccountId);
          }
          const err = new Error('เซสชันบัญชีผู้ใช้หมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
          err.status = 401;
          err.code = 'AUTH_LOGIN_REQUIRED';
          throw err;
        }
        try { fs.unlinkSync(accountFile); } catch (_) {}
        try {
          const fresh = await ensureAccount();
          if (fresh?.accountId && fresh.accountId !== prevAccountId) {
            emitAccountChanged(fresh.accountId, prevAccountId);
          }
          const retried = await requestJSON(route, payload, fresh.token);
          serviceAvailable = true;
          if (retried && typeof retried === 'object') applyAccessMeta(retried);
          return retried;
        } catch (retryErr) {
          if (retryErr && retryErr.status === 403 && (retryErr.code === 'ACCESS_PENDING' || retryErr.code === 'ACCESS_REVOKED')) {
            serviceAvailable = true;
            applyAccessMeta({ accessStatus: retryErr.code === 'ACCESS_REVOKED' ? 'revoked' : 'pending' });
          } else {
            serviceAvailable = false;
          }
          throw retryErr;
        }
      }
      serviceAvailable = false;
      throw e;
     }
  }
  function updateBalance(result) {
    applyAccessMeta(result);
    if (result.schemaVersion === 2 && result.unitScale === 100 && Number.isSafeInteger(result.balanceUnits ?? result.remainingUnits)) {
      balanceUnits = result.balanceUnits ?? result.remainingUnits; points = balanceUnits / 100;
      if (offlineWallet && typeof offlineWallet.confirmBalance === 'function' && Number.isSafeInteger(result.walletRevision)) {
        try { offlineWallet.confirmBalance(balanceUnits, result.walletRevision); } catch (_) {}
      }
    } else {
    const balance = result.points ?? result.remaining ?? result.totalPoints;
    if (Number.isSafeInteger(balance) && balance >= 0) points = balance;
    }
    if (result.pointsPerSolve === 0 || result.pointsPerSolve === 1) pointsPerSolve = result.pointsPerSolve;
    if (Array.isArray(result.topupHistory)) topupHistory = result.topupHistory;
    if (result.machineMerit && typeof result.machineMerit === 'object') machineMerit = result.machineMerit;
    if(account&&Number.isSafeInteger(balanceUnits))atomicWrite(walletSnapshotFile,{origin:base.origin,accountId:account.accountId,balanceUnits,topupHistory,machineMerit});
  }
  async function refreshBalance() {
    if(offlineWallet){try{await offlineWallet.refresh();}catch(_){serviceAvailable=false;}try{const result=await call('/v1/aetheria/balance');if(result?.success&&result.schemaVersion===2&&result.unitScale===100&&Number.isSafeInteger(result.balanceUnits))updateBalance(result);}catch(_){}return loadSettings();}
    try {
      const result = await call('/v1/aetheria/balance');
      if (!result?.success || !(result.schemaVersion === 2 ? result.unitScale === 100 && Number.isSafeInteger(result.balanceUnits) && (result.points === undefined || result.points === result.balanceUnits / 100) : Number.isSafeInteger(result.points) && result.points >= 0)) throw new Error('Invalid balance');
      updateBalance(result);
    } catch (_) { serviceAvailable = false; }
    return loadSettings();
  }
  async function syncAccessStatus(preferredDeviceName) {
    try {
      const payload = (typeof preferredDeviceName === 'string' && preferredDeviceName.trim())
        ? { machineName: preferredDeviceName.trim().slice(0, 64), deviceName: preferredDeviceName.trim().slice(0, 64) }
        : {};
      const res = await call('/v1/aetheria/machine/access-status', payload);
      if (res && typeof res === 'object') applyAccessMeta(res);
      return getAccessState();
    } catch (_) {
      return getAccessState();
    }
  }
  async function requestMachineAccess({ deviceName, note } = {}) {
    const cleanName = typeof deviceName === 'string' && deviceName.trim() ? deviceName.trim().slice(0, 64) : machineName;
    const cleanNote = typeof note === 'string' ? note.trim().slice(0, 240) : '';
    const credential = await ensureAccount(cleanName).catch(() => account);
    const res = await requestJSON('/v1/aetheria/machine/access-request', {
      machineHwid,
      machineName: cleanName,
      deviceName: cleanName,
      note: cleanNote
    }, credential?.token || null);
    if (res && typeof res === 'object') {
      if (!account && typeof res.accountId === 'string' && /^[a-f0-9]{64}$/.test(res.token || '')) {
        account = { origin: base.origin, accountId: res.accountId, token: res.token, machineHwid };
        try { atomicWrite(accountFile, account); } catch (_) {}
      }
      applyAccessMeta(res);
    }
    return {
      success: Boolean(res?.success),
      ...getAccessState(),
      deviceName: res?.deviceName || cleanName
    };
  }
  async function completeUserAuth(route, payload) {
    const cleanName = (typeof payload?.deviceName === 'string' && payload.deviceName.trim())
      ? payload.deviceName.trim().slice(0, 64)
      : ((typeof deviceNameProvider === 'function' ? deviceNameProvider() : '') || machineName);
    const res = await requestJSON(route, {
      ...payload,
      machineHwid,
      machineName: cleanName,
      deviceName: cleanName
    }, null);
    if (!res?.success || typeof res.accountId !== 'string' || !/^[a-f0-9]{64}$/.test(res.token || '')) {
      throw new Error(res?.message || 'การยืนยันตัวตนไม่สำเร็จ');
    }
    const prevAccountId = account?.accountId || null;
    account = {
      origin: base.origin,
      accountId: res.accountId,
      token: res.token,
      machineHwid,
      username: res.username || payload.username,
      isUserAccount: true,
      loggedOutExplicitly: false
    };
    loggedOutExplicitly = false;
    username = res.username || payload.username;
    isUserAccount = true;
    serviceAvailable = true;
    atomicWrite(accountFile, account);
    applyAccessMeta(res);
    if (Number.isSafeInteger(res.balanceUnits)) {
      updateBalance({ ...res, schemaVersion: 2, unitScale: 100 });
    }
    if (res.accountId !== prevAccountId) {
      emitAccountChanged(res.accountId, prevAccountId);
    }
    return {
      success: true,
      ...getAccessState(),
      deviceName: res.deviceName || cleanName,
      balanceUnits: Number.isSafeInteger(res.balanceUnits) ? res.balanceUnits : balanceUnits,
      mergedLegacyCount: Number(res.mergedLegacyCount || 0),
      mergedDeltaUnits: Number(res.mergedDeltaUnits || 0)
    };
  }
  async function registerUserAccount({ username: u, password, deviceName, note } = {}) {
    return completeUserAuth('/v1/aetheria/machine/auth-register', { username: u, password, deviceName, note });
  }
  async function loginUserAccount({ username: u, password, deviceName } = {}) {
    return completeUserAuth('/v1/aetheria/machine/auth-login', { username: u, password, deviceName });
  }
  async function logoutUserAccount() {
    const prevToken = account?.token || null;
    const prevAccountId = account?.accountId || null;
    if (prevToken) {
      try { await requestJSON('/v1/aetheria/machine/auth-logout', {}, prevToken); } catch (_) {}
    }
    account = null;
    username = null;
    isUserAccount = false;
    loggedOutExplicitly = true;
    accessStatus = 'approved';
    customRateUnits = null;
    effectiveRateUnits = null;
    accessRequestedAt = null;
    accessNote = '';
    balanceUnits = null;
    points = 0;
    machineMerit = null;
    try { atomicWrite(accountFile, { origin: base.origin, machineHwid, loggedOutExplicitly: true }); } catch (_) {}
    try { fs.unlinkSync(walletSnapshotFile); } catch (_) {}
    try { fs.unlinkSync(accessStateFile); } catch (_) {}
    if (prevAccountId) {
      emitAccountChanged(null, prevAccountId);
    }
    return { success: true, ...getAccessState() };
  }
  async function fleetRequest(route, payload, opts = {}) {
    if (!/^\/v1\/aetheria\/machine\/fleet\/(?:poll|reply|machines|request|rename|remove)$/.test(route)) {
      throw new Error('Unsupported fleet route');
    }
    if (loggedOutExplicitly || !account?.token || !isUserAccount || !username) {
      const err = new Error('กรุณาเข้าสู่ระบบด้วยบัญชีผู้ใช้ก่อนใช้งานระบบควบคุมหลายเครื่อง');
      err.status = 401;
      err.code = 'USER_ACCOUNT_REQUIRED';
      throw err;
    }
    const result = await requestJSON(route, payload, account.token, {
      timeoutMs: Math.max(5000, Math.min(40000, Number(opts && opts.timeoutMs) || 25000)),
      responseLimit: Math.max(131072, Math.min(16 * 1024 * 1024, Number(opts && opts.responseLimit) || 8 * 1024 * 1024))
    });
    if (result && typeof result === 'object') applyAccessMeta(result);
    return result;
  }
  async function solveHumanCheck(prompt, options = [], items = null, requestId = crypto.randomUUID()) {
    if (account && Date.now() - lastCatalogAttempt > 3600000) {
      lastCatalogAttempt = Date.now();
      // Refresh in the background. Local answers never wait for a billing/solve API.
      call('/v1/aetheria/script/catalog').then(result => {
        if (result?.success) localMatcher.update(result.catalog, result.hash);
      }).catch(() => {});
    }
    if (localMatcher.ready()) {
      const answer = localMatcher.solve({ prompt, options, items: items || [] });
      return answer ? { ...answer, requestId } : { success: false, code: 'MANUAL_REQUIRED', reason: 'คำตอบจากแคตตาล็อกไม่ชัดเจน กรุณาตอบเอง' };
    }
    try {
      const result = await call('/v1/aetheria/solve', { requestId, prompt, options, items });
      if (!result?.success || ![0, 1].includes(result.charged) || result.requestId !== requestId ||
          !Number.isInteger(result.pickIndex) || result.pickIndex < 0 || result.pickIndex > 5 ||
          result.pickIndex >= Math.max(options.length, items?.length || 0) ||
          !(result.schemaVersion === 2 ? result.unitScale === 100 && Number.isSafeInteger(result.remainingUnits) && (result.remaining === undefined || result.remaining === result.remainingUnits / 100) : Number.isSafeInteger(result.remaining) && result.remaining >= 0)) {
        return { success: false, code: 'INVALID_SERVICE_RESPONSE', reason: 'ไม่สามารถยืนยันคำตอบและการหักส่วนบุญ จากเซิร์ฟเวอร์' };
      }
      updateBalance(result);
      return result;
    } catch (e) { return { success: false, reason: e.message, code: typeof e.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(e.code) ? e.code : 'SERVICE_UNAVAILABLE', status: Number.isInteger(e.status) ? e.status : null }; }
  }
  async function reportSecurityEvent(kind, context = {}) {
    if (!['local_credit_override', 'offline_solver_probe'].includes(kind)) return false;
    const clientContext = { machineName, sessionId: managerSessionId };
    if (typeof context.profileId === 'string') clientContext.profileId = context.profileId.slice(0, 128);
    try {
      const result = await call('/v1/aetheria/security/report', { kind, clientContext });
      return result?.success === true;
    } catch (_) { return false; }
  }
  // Retained compatibility entry point for older offline-credit integrations.
  // It never grants local credits; the service rejects unsupported recovery requests.
  async function recoverOfflineCredit(points, context = {}) {
    try {
      await call('/v1/aetheria/admin/add-points', { points, adminToken: 'pmhee-legacy-offline-recovery-v1', clientContext: { machineName, sessionId: managerSessionId, profileId: typeof context.profileId === 'string' ? context.profileId.slice(0, 128) : undefined } });
    } catch (_) {}
    return { success: false, error: 'การกู้ ส่วนบุญ แบบออฟไลน์ไม่รองรับ' };
  }
  async function redeemTrueMoneyVoucher(voucherUrl) {
    try {
      const result = await call('/v1/aetheria/topup', { voucherUrl });
      if (result?.success) {try{updateBalance(result);if(offlineWallet){try{await offlineWallet.forceRefresh();}catch(_){serviceAvailable=false;}balanceUnits=offlineWallet.balance();points=balanceUnits/100;}else await refreshBalance();}catch(_){serviceAvailable=false;}}
      return result;
    } catch (e) { return { success: false, message: e.message }; }
  }
  return {
    get serviceOrigin() { return base.origin; },
    setOfflineWallet(value){offlineWallet=value||null;},
    setOnAccountChanged(fn){onAccountChanged=typeof fn==='function'?fn:null;},
    addAccountChangedListener(fn){if(typeof fn==='function')onAccountChangedListeners.add(fn);return ()=>onAccountChangedListeners.delete(fn);},
    setDeviceNameProvider(fn){deviceNameProvider=typeof fn==='function'?fn:null;},
    applyOfflineBalance(value){if(offlineWallet&&Number.isSafeInteger(value)){balanceUnits=value;points=value/100;}},
    applyOfflineWalletSnapshot(result){if(offlineWallet&&result?.unitScale===100&&Number.isSafeInteger(result.balanceUnits))updateBalance({...result,schemaVersion:2});},
    isRemoteService: true, loadSettings, saveSettings,
    publicSettings: (s = loadSettings()) => Object.fromEntries([
      'autoAnswer', 'answerDelayMs', 'pointSystemEnabled', 'points', 'pointsPerSolve',
      'pointsPerBaht', 'machineHwid', 'machineHwidShort', 'accessStatus', 'customRateUnits', 'effectiveRateUnits', 'accessRequestedAt', 'accessNote',
      'username', 'isUserAccount', 'requiresLogin',
      'topupHistory', 'machineMerit', 'serviceAvailable', 'serviceOrigin', 'accountId', 'balanceUnits', 'unitScale', 'localCatalogReady'
    ].map(key => [key, s[key]])),
    refreshBalance, solveHumanCheck, redeemTrueMoneyVoucher, getMachineFingerprint, reportSecurityEvent, recoverOfflineCredit,
    getMachineHwid: () => machineHwid,
    getMachineHwidShort: () => machineHwidShort,
    getAccessStatus: () => accessStatus,
    getAccessState,
    updateAccessStateFromServer: (meta) => { if (meta && typeof meta === 'object') applyAccessMeta(meta); return accessStatus; },
    ensureAccount: (preferredDeviceName) => ensureAccount(preferredDeviceName),
    syncAccessStatus,
    requestMachineAccess,
    registerUserAccount,
    loginUserAccount,
    logoutUserAccount,
    fleetRequest,
    serviceRequest: (route, payload) => {
      if (route !== '/v1/aetheria/health' && !/^\/v1\/aetheria\/(?:script|usage|billing|proxy|offline|machine)\/[a-z-]+(?:\/[a-z-]+)?$/.test(route)) throw new Error('Unsupported coordinator route');
      return call(route, payload);
    },
    proxyReserve: (ip, requestId) => call('/v1/aetheria/proxy/reserve', { ip, ...(requestId ? { requestId } : {}) }),
    proxyComplete: async (ticketId, username, success) => {
      const res = await call('/v1/aetheria/proxy/complete', { ticketId, username, success });
      if (res?.unitScale === 100 && Number.isSafeInteger(res.balanceUnits)) updateBalance({ ...res, schemaVersion: 2 });
      return res;
    },
    proxyStatus: ip => call('/v1/aetheria/proxy/status', { ip }),
    proxyBrokerCapabilities: () => call('/v1/aetheria/proxy/capabilities'),
    proxyBrokerSignup: async ({ requestId, profileId, username, password }) => {
      const res = await call('/v1/aetheria/proxy/signup', { requestId, profileId, username, password });
      if (res?.unitScale === 100 && Number.isSafeInteger(res.balanceUnits)) updateBalance({ ...res, schemaVersion: 2 });
      return res;
    },
    proxyBrokerSignupStatus: ({ jobId, requestId }) => call('/v1/aetheria/proxy/signup-status', { jobId, requestId }),
    updateLocalCatalog: (catalog, hash) => localMatcher.update(catalog, hash),
    localCatalogReady: () => localMatcher.ready(),
    // A client must never mint, debit or refund credit locally.
    addPoints: () => ({ success: false, error: 'เติมส่วนบุญ ได้ผ่านเซิร์ฟเวอร์เท่านั้น' }),
    deductPoints: () => ({ success: false, error: 'เซิร์ฟเวอร์เป็นผู้หักส่วนบุญ' }),
    isReady: () => serviceAvailable
  };
}
module.exports = { createHumanCheckSolver };
