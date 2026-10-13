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
  return { username: c.username || '', password: c.password || '', enabled: !!c.enabled, register: !!c.register, registerDone: !!c.registerDone, registerError: c.registerError || '' };
})()`;

const pushJs = cfg => `(() => {
  const c = window.__authConfig || (window.__authConfig = {});
  Object.assign(c, ${JSON.stringify(cfg)});
  try { localStorage.setItem('pelican_auth_cfg', JSON.stringify(c)); } catch (e) {}
  const set = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) { if (el.type === 'checkbox') el.checked = !!v; else el.value = v; } };
  set('p-auth-enabled', c.enabled); set('p-auth-user', c.username || ''); set('p-auth-pass', c.password || '');
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
      loginSyncPending: true
    });
    pendingCreds.delete(profile.id);
    return updated || profile;
  }

  async function syncProxyRegistration(profile) {
    const cred = getCandidateCreds(profile);
    try {
      const result = await proxyRegister.registerAccountWithProxy({
        profileId: profile.id,
        username: cred.username,
        password: cred.password
      });
      if (result?.success === true) {
        commitSuccessfulRegistration(profile, cred.username, cred.password);
        const delivered = await evalProfilePort(profile.debugPort, pushJs({
          enabled: true, autoResumeBot: true, username: cred.username, password: cred.password,
          register: false, registerDone: true, autoCreateChar: true
        }), 3000);
        if (!delivered?.success || delivered.result?.success !== true) {
          updateProfile(profile.id, { registerError: 'สมัครสำเร็จแล้ว แต่ยังส่งค่าล็อกอินเข้าจอไม่ได้ รอซิงค์อีกครั้ง' });
        } else {
          updateProfile(profile.id, { loginSyncPending: false });
        }
        console.log(`[AuthSync] ✅ ${profile.name}: สมัครบัญชีผ่าน Proxy สำเร็จ ("${cred.username}") -> ส่งคำสั่งล็อกอินเข้าเกม`);
      } else if (result?.code === 'USERNAME_TAKEN') {
        const nextUser = rotateCandidateUser(profile).username;
        if (profile.generatedAccount) {
          updateProfile(profile.id, { account: nextUser, generatedAccount: true, proxyRegistrationState: 'known-rejected', registerError: '' });
        } else if (!profile.account) {
          updateProfile(profile.id, { proxyRegistrationState: 'known-rejected', registerError: '' });
        } else {
          updateProfile(profile.id, { proxyRegistrationState: 'known-rejected', registerError: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' });
        }
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
    if (!profile.debugPort) return;
    if (!profile.autoRegister && !(profile.account && pw(profile))) return;
    const r = await evalProfilePort(profile.debugPort, READ_JS, 3000);
    const cur = r && r.success ? r.result : null;
    if (!cur) return;   // offline or bot not loaded yet

    if (profile.autoRegister) {
      if (proxyRegister?.hasPending?.(profile.id)) {
        await syncProxyRegistration(profile);
        return;
      }
      if (cur.registerDone && cur.username) {
        const cred = getCandidateCreds(profile);
        commitSuccessfulRegistration(profile, cur.username, cur.password || cred.password);
        console.log(`[AuthSync] ✅ ${profile.name}: สมัครบัญชีผ่านหน้าเกม "${cur.username}" สำเร็จ`);
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

      // If Proxy is enabled and not in browser fallback, use proxy registration
      const proxyAvailable = !profile.proxyFallbackBrowser && proxyRegister && (
        typeof proxyRegister.isEnabled === 'function' && proxyRegister.isEnabled()
      );
      if (proxyAvailable) {
        await syncProxyRegistration(profile);
        return;
      }

      const cred = getCandidateCreds(profile);
      await evalProfilePort(profile.debugPort, pushJs({
        enabled: true, autoResumeBot: true, username: cred.username, password: cred.password,
        register: true, registerDone: false, autoCreateChar: true, generatedUser: !!cred.generatedUser
      }), 3000);
      console.log(`[AuthSync] 📝 ${profile.name}: ส่งคำสั่งสมัครบัญชี "${cred.username}" ไปที่จอ`);
      return;
    }

    if (profile.loginSyncPending || cur.username !== profile.account || cur.password !== pw(profile)) {
      const delivered = await evalProfilePort(profile.debugPort, pushJs({
        enabled: true, username: profile.account, password: pw(profile), register: false,
        ...(profile.loginSyncPending ? { registerDone: true, autoCreateChar: true, autoResumeBot: true } : {})
      }), 3000);
      if (delivered?.success && delivered.result?.success === true) updateProfile(profile.id, { loginSyncPending: false, registerError: '' });
    }
  }

  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      for (const p of loadProfiles()) {
        try { await syncOne(p); } catch (e) {}
      }
    } finally {
      running = false;
    }
  }

  function start() {
    setTimeout(() => { tick(); setInterval(tick, SYNC_MS); }, 8000);
  }

  return { start, tick, syncOne };
}

module.exports = { createAuthSync };
