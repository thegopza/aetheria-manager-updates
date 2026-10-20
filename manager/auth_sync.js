// manager/auth_sync.js — keep each game client's Auto-login in line with its Manager profile.
//
// - profile with ID + password: the client's Auto-login gets them (and is switched on) whenever its saved
//   ID/password differ from the profile's.
// - profile created without a password (profile.autoRegister): the Manager generates the missing ID and
//   password in candidate memory (WITHOUT saving unverified credentials to the profile beforehand).
//   Registration is performed either via Proxy or in-game sign-up form.
//   Only when registration SUCCEEDS are the ID and password committed to the profile / credentials,
//   and the client logs in normally.
// Passwords never leave the Manager except to the profile's own game client.

const crypto = require('crypto');

const SYNC_MS = 10 * 1000;
const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
const pick = (chars, n) => Array.from(crypto.randomBytes(n), b => chars[b % chars.length]).join('');
const genUserId = () => 'pm' + pick(ALNUM, 8);   // 10 chars, a-z 0-9 (game: 3-16, a-z 0-9 _)
const genPassword = () => pick('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', 12);

const READ_JS = `(() => {
  const c = window.__authConfig;
  if (!c || typeof window.executeAutoLogin !== 'function') return null;
  const inGame = Boolean(
    document.querySelector('.char-card:not(.empty)') ||
    (typeof window.getCurrentMapName === 'function' && window.getCurrentMapName() && window.getCurrentMapName() !== 'ไม่ทราบ') ||
    window.__charName
  );
  let charName = '';
  try {
    const live = typeof window.getLiveCharacterData === 'function' ? window.getLiveCharacterData() : null;
    charName = String((live && (live.name || live.characterName)) || window.__charName || '').trim();
  } catch (_) {}
  return {
    username: c.username || '',
    password: c.password || '',
    enabled: !!c.enabled,
    register: !!c.register,
    registerDone: !!c.registerDone,
    registerError: c.registerError || '',
    generatedUser: !!c.generatedUser,
    userEditedAt: Number(c.userEditedAt) || 0,
    verifiedLoginAt: Number(c.verifiedLoginAt) || 0,
    userToggledAt: Number(c.userToggledAt) || 0,
    inGame,
    charName
  };
})()`;

const pushJs = cfg => `(() => {
  const c = window.__authConfig || (window.__authConfig = {});
  const patch = ${JSON.stringify(cfg)};
  if (patch.preserveUserToggle && c.userToggledAt && typeof c.enabled === 'boolean') {
    delete patch.enabled;
  }
  delete patch.preserveUserToggle;
  Object.assign(c, patch);
  c.lastManagerPushAt = Date.now();
  try { localStorage.setItem('pelican_auth_cfg', JSON.stringify(c)); } catch (e) {}
  const set = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) { if (el.type === 'checkbox') el.checked = !!v; else el.value = v; } };
  if (c.enabled !== undefined) set('p-auth-enabled', c.enabled);
  set('p-auth-user', c.username || '');
  set('p-auth-pass', c.password || '');
  return { success: true };
})()`;

function createAuthSync({ loadProfiles, saveProfiles, evalProfilePort, credentials, proxyRegister }) {
  // passwords live in data/credentials.json (git-ignored), not in profiles.json
  const pw = p => credentials.getPassword(p.id);
  const pendingCreds = new Map(); // profileId -> { username, password, generatedUser }

  function updateProfile(id, patch) {
    const profiles = loadProfiles();
    const p = profiles.find(x => x.id === id);
    if (!p) return null;
    Object.assign(p, patch);
    saveProfiles(profiles);
    return p;
  }

  function getCandidateCreds(profile) {
    let c = pendingCreds.get(profile.id);
    const hasAccount = !!(profile.account && profile.account.trim());
    if (!c || (hasAccount && c.username !== profile.account.trim())) {
      c = {
        username: hasAccount ? profile.account.trim() : genUserId(),
        password: pw(profile) || genPassword(),
        generatedUser: !hasAccount
      };
      pendingCreds.set(profile.id, c);
    }
    return c;
  }

  function rotateCandidateUser(profile) {
    const c = getCandidateCreds(profile);
    c.username = genUserId();
    c.generatedUser = true;
    pendingCreds.set(profile.id, c);
    return c;
  }

  function commitSuccessfulRegistration(profile, username, password) {
    credentials.setPassword(profile.id, password);
    const updated = updateProfile(profile.id, {
      account: username,
      autoRegister: false,
      generatedAccount: true,
      registeredAt: Date.now(),
      proxyRegistrationState: 'done',
      registerError: '',
      loginSyncPending: true,
      lastAuthSyncPushAt: Date.now()
    });
    pendingCreds.delete(profile.id);
    return updated || profile;
  }

  async function syncProxyRegistration(profile, { clientOnline = true } = {}) {
    const cred = getCandidateCreds(profile);
    try {
      const result = await proxyRegister.registerAccountWithProxy({
        profileId: profile.id,
        username: cred.username,
        password: cred.password
      });
      if (result?.success === true) {
        commitSuccessfulRegistration(profile, cred.username, cred.password);
        if (clientOnline && profile.debugPort) {
          const delivered = await evalProfilePort(profile.debugPort, pushJs({
            enabled: true, autoResumeBot: true, username: cred.username, password: cred.password,
            register: false, registerDone: true, autoCreateChar: true
          }), 3000);
          if (!delivered?.success || delivered.result?.success !== true) {
            updateProfile(profile.id, { registerError: 'สมัครสำเร็จแล้ว แต่ยังส่งค่าล็อกอินเข้าจอไม่ได้ รอซิงค์อีกครั้ง' });
          } else {
            updateProfile(profile.id, { loginSyncPending: false, lastAuthSyncPushAt: Date.now() });
          }
        }
        console.log(`[AuthSync] ✅ ${profile.name}: สมัครบัญชีผ่าน Proxy สำเร็จ ("${cred.username}")${clientOnline ? ' -> ส่งคำสั่งล็อกอินเข้าเกม' : ' -> รอส่งค่าล็อกอินเมื่อเปิดจอ'}`);
      } else if (result?.code === 'USERNAME_TAKEN') {
        const nextUser = rotateCandidateUser(profile).username;
        if (profile.generatedAccount) {
          updateProfile(profile.id, { account: nextUser, generatedAccount: true, proxyRegistrationState: 'known-rejected', registerError: '' });
        } else if (!profile.account) {
          updateProfile(profile.id, { proxyRegistrationState: 'known-rejected', registerError: '' });
        } else {
          updateProfile(profile.id, { proxyRegistrationState: 'known-rejected', registerError: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' });
        }
      } else if (result?.code === 'IP_RATE_LIMITED') {
        updateProfile(profile.id, {
          proxyRegistrationState: 'retry-pending',
          registerError: result.error || 'IP นี้สมัครครบโควต้าแล้ว กำลังสลับ IP ใหม่ในรอบถัดไป'
        });
      } else if (result?.pending) {
        updateProfile(profile.id, { proxyRegistrationState: 'review-required', registerError: result.error || 'รายการสมัครยังรอตรวจสอบ' });
      } else {
        updateProfile(profile.id, {
          proxyRegistrationState: 'known-rejected',
          proxyFallbackBrowser: true,
          registerError: 'Proxy ไม่อนุมัติ (' + (result?.error || 'ไม่ทราบสาเหตุ') + ') — เปลี่ยนไปสมัครผ่านหน้าเกมแทน'
        });
        console.warn(`[AuthSync] ⚠️ ${profile.name}: Proxy ไม่อนุมัติการสมัคร -> สมัครผ่านหน้าเกมแทน`);
      }
    } catch (err) {
      if (err?.message === 'PROXY_DISABLED' || (typeof proxyRegister?.isEnabled === 'function' && !proxyRegister.isEnabled())) {
        updateProfile(profile.id, {
          proxyFallbackBrowser: true,
          registerError: 'ระบบ Proxy ปิดอยู่ — เปลี่ยนไปสมัครผ่านหน้าเกมแทน'
        });
        console.warn(`[AuthSync] ⚠️ ${profile.name}: Proxy ปิดอยู่ -> เปลี่ยนไปสมัครผ่านหน้าเกมแทน`);
      } else {
        updateProfile(profile.id, { proxyRegistrationState: 'retry-pending', registerError: 'ยังยืนยันผล Proxy ไม่ได้ เก็บรายการเดิมไว้ก่อนลองใหม่' });
      }
    }
  }

  async function syncOne(profile) {
    if (!profile.debugPort && !profile.autoRegister) return;
    if (!profile.autoRegister && !(profile.account && pw(profile))) return;

    const proxyAvailable = !profile.proxyFallbackBrowser && proxyRegister && (
      typeof proxyRegister.isEnabled === 'function' && proxyRegister.isEnabled()
    );

    const r = profile.debugPort ? await evalProfilePort(profile.debugPort, READ_JS, 2500) : null;
    const cur = r && r.success ? r.result : null;
    if (!cur) {
      // Allow Proxy registration to proceed even before the game client window is online,
      // ONLY if this profile does not already have a character!
      if (profile.autoRegister && !profile.lastCharName && (proxyRegister?.hasPending?.(profile.id) || proxyAvailable)) {
        await syncProxyRegistration(profile, { clientOnline: false });
      }
      return;
    }

    // 1. If the user manually edited ID/Password in the in-game Bot HUD or logged in manually on the game screen,
    // adopt the user's credentials into the Manager profile instead of overwriting them with a bot account!
    const clientEditStamp = Math.max(Number(cur.userEditedAt) || 0, Number(cur.verifiedLoginAt) || 0);
    const lastManagerPushAt = Number(profile.lastAuthSyncPushAt) || 0;
    if (cur.username && cur.password && !cur.register && !cur.registerError && clientEditStamp > lastManagerPushAt) {
      if (cur.username !== profile.account || cur.password !== pw(profile) || profile.autoRegister) {
        credentials.setPassword(profile.id, cur.password);
        updateProfile(profile.id, {
          account: cur.username,
          autoRegister: false,
          generatedAccount: !!cur.generatedUser,
          registerError: '',
          loginSyncPending: false,
          lastAuthSyncPushAt: Date.now(),
          ...(cur.charName && !profile.lastCharName ? { lastCharName: cur.charName } : {})
        });
        pendingCreds.delete(profile.id);
        console.log(`[AuthSync] 🔄 ${profile.name}: ซิงค์ไอดี/รหัสที่ผู้ใช้ใช้งานในเกม ("${cur.username}") เข้าโปรไฟล์ Manager อัตโนมัติ`);
      } else {
        updateProfile(profile.id, { lastAuthSyncPushAt: Date.now() });
      }
      return;
    }

    if (profile.autoRegister) {
      // NEVER auto-register over a profile that already has a character or manual credentials in HUD!
      if (cur.username && cur.password && !cur.register && !cur.registerError && !cur.generatedUser) {
        credentials.setPassword(profile.id, cur.password);
        updateProfile(profile.id, {
          account: cur.username,
          autoRegister: false,
          generatedAccount: false,
          registerError: '',
          loginSyncPending: false,
          lastAuthSyncPushAt: Date.now()
        });
        pendingCreds.delete(profile.id);
        console.log(`[AuthSync] 🔄 ${profile.name}: พบไอดี/รหัสเดิมในหน้าเกม ("${cur.username}") -> บันทึกเข้าโปรไฟล์โดยไม่สร้างไอดีบอททับ`);
        return;
      }
      if (profile.lastCharName || ((cur.inGame || cur.charName) && !cur.registerDone)) {
        updateProfile(profile.id, {
          autoRegister: false,
          ...(cur.charName && !profile.lastCharName ? { lastCharName: cur.charName } : {})
        });
        pendingCreds.delete(profile.id);
        console.log(`[AuthSync] 🛡️ ${profile.name}: พบตัวละครในเกมแล้ว ("${profile.lastCharName || cur.charName || 'in-game'}") -> ปิด Auto-Register เพื่อไม่ให้เปลี่ยนรหัสทับ`);
        return;
      }
      if (proxyRegister?.hasPending?.(profile.id)) {
        await syncProxyRegistration(profile, { clientOnline: true });
        return;
      }
      if (cur.registerDone && cur.username) {
        const cred = getCandidateCreds(profile);
        commitSuccessfulRegistration(profile, cur.username, cur.password || cred.password);
        console.log(`[AuthSync] ✅ ${profile.name}: สมัครบัญชีผ่านหน้าเกม "${cur.username}" สำเร็จ`);
        return;
      }
      // If Proxy is enabled and not in browser fallback, use proxy registration (even if cur.register was previously set)
      if (proxyAvailable) {
        await syncProxyRegistration(profile, { clientOnline: true });
        return;
      }
      if (cur.register) {
        if (cur.username) {
          const cred = getCandidateCreds(profile);
          if (cur.username !== cred.username) cred.username = cur.username;
        }
        return;
      }
      if (cur.registerError) {
        updateProfile(profile.id, { autoRegister: false, registerError: cur.registerError });
        return;
      }

      const cred = getCandidateCreds(profile);
      await evalProfilePort(profile.debugPort, pushJs({
        enabled: true, autoResumeBot: true, username: cred.username, password: cred.password,
        register: true, registerDone: false, autoCreateChar: true, generatedUser: !!cred.generatedUser
      }), 3000);
      updateProfile(profile.id, { lastAuthSyncPushAt: Date.now() });
      console.log(`[AuthSync] 📝 ${profile.name}: ส่งคำสั่งสมัครบัญชี "${cred.username}" ไปที่จอ`);
      return;
    }

    if (profile.loginSyncPending || cur.username !== profile.account || cur.password !== pw(profile)) {
      const delivered = await evalProfilePort(profile.debugPort, pushJs({
        enabled: true,
        preserveUserToggle: !profile.loginSyncPending,
        username: profile.account,
        password: pw(profile),
        register: false,
        ...(profile.loginSyncPending ? { registerDone: true, autoCreateChar: true, autoResumeBot: true } : {})
      }), 3000);
      if (delivered?.success && delivered.result?.success === true) {
        updateProfile(profile.id, { loginSyncPending: false, registerError: '', lastAuthSyncPushAt: Date.now() });
      }
    }
  }

  function resetProxyFallback() {
    const profiles = loadProfiles();
    let changed = false;
    for (const p of profiles) {
      if (p.autoRegister && (p.proxyFallbackBrowser || p.proxyRegistrationState === 'known-rejected')) {
        delete p.proxyFallbackBrowser;
        if (p.proxyRegistrationState === 'known-rejected') delete p.proxyRegistrationState;
        if (p.registerError && (p.registerError.includes('Proxy') || p.registerError.includes('เปลี่ยนไปสมัครผ่านหน้าเกมแทน'))) {
          p.registerError = '';
        }
        changed = true;
      }
    }
    if (changed) saveProfiles(profiles);
  }

  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const profiles = loadProfiles().slice().sort((a, b) => {
        const prioA = (a.autoRegister || a.loginSyncPending) ? 0 : 1;
        const prioB = (b.autoRegister || b.loginSyncPending) ? 0 : 1;
        return prioA - prioB;
      });
      for (const p of profiles) {
        try { await syncOne(p); } catch (e) {}
      }
    } finally {
      running = false;
    }
  }

  function start() {
    setTimeout(() => { tick(); setInterval(tick, SYNC_MS); }, 8000);
  }

  return { start, tick, syncOne, resetProxyFallback };
}

module.exports = { createAuthSync };
