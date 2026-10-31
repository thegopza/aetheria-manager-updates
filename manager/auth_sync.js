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
const rInt = (min, max) => crypto.randomInt(min, max + 1);
const pickOne = arr => arr[crypto.randomInt(0, arr.length)];

const USER_NICKS = [
  'bank', 'boom', 'beam', 'boss', 'ball', 'benz', 'best', 'boat', 'book', 'boy', 'bas', 'bell', 'beer', 'big', 'bright',
  'champ', 'chok', 'chom', 'cream', 'cake', 'cop', 'captain', 'dew', 'dome', 'dream', 'don', 'dear', 'din', 'duke',
  'earth', 'ek', 'earn', 'eye', 'first', 'fluke', 'fiat', 'film', 'frame', 'folk', 'ford', 'forth', 'fah', 'fern', 'fon', 'fame', 'frank',
  'golf', 'gun', 'game', 'guy', 'got', 'gap', 'green', 'gift', 'grace', 'gus', 'hong', 'ice', 'ink', 'indie',
  'jay', 'jame', 'jeng', 'jeab', 'joker', 'job', 'jun', 'june', 'jib', 'jack', 'jane',
  'kao', 'korn', 'ken', 'krit', 'kim', 'kwan', 'kong', 'kan', 'kla', 'keng', 'keam', 'knight',
  'leo', 'luke', 'lek', 'lee', 'lotus', 'mark', 'max', 'mix', 'mike', 'mind', 'mild', 'mook', 'mew', 'mint', 'may', 'mean', 'mos', 'mick', 'mon', 'mork',
  'non', 'nut', 'nine', 'new', 'nick', 'note', 'art', 'arm', 'aom', 'aof', 'aun', 'ake', 'auto', 'atom', 'amp',
  'nam', 'nan', 'net', 'noey', 'ning', 'nook', 'neung', 'nai', 'ohm', 'off', 'oat', 'oak', 'oil', 'ong',
  'peat', 'pete', 'pond', 'phu', 'poom', 'pun', 'peam', 'palm', 'petch', 'plug', 'pop', 'pang', 'ploy', 'praew', 'plai', 'pleng', 'pear', 'por', 'ple', 'ping',
  'rew', 'ryu', 'rome', 'run', 'safe', 'save', 'sing', 'sky', 'sun', 'stamp', 'star', 'sea', 'win', 'wave', 'way', 'white', 'woody',
  'tar', 'tee', 'ton', 'top', 'toey', 'tle', 'ter', 'time', 'title', 'team', 'ten', 'tor', 'tum', 'tan', 'tawan', 'toy', 'tack',
  'view', 'vee', 'van', 'yok', 'zen', 'zee', 'zack'
];
const USER_STEMS = [
  'shadow', 'dark', 'night', 'storm', 'frost', 'flame', 'blaze', 'wolf', 'fox', 'raven', 'dragon', 'tiger', 'lion', 'viper', 'hawk', 'bear', 'neko', 'kitsune',
  'luna', 'nova', 'astro', 'pixel', 'cyber', 'neon', 'ghost', 'phantom', 'reaper', 'slayer', 'hunter', 'ranger', 'archer', 'sniper', 'rogue', 'mage', 'wizard', 'monk', 'paladin', 'bard',
  'kira', 'zoro', `luffy`, 'ace', 'sabo', 'sanji', 'law', 'shanks', 'naruto', 'sasuke', 'itachi', 'kakashi', 'gojo', 'toji', 'tanjiro', 'zenitsu', 'rengoku', 'goku', 'vegeta', 'asta', 'levi', 'eren', 'killua', 'rimuru', 'kirito', 'asuna', 'sinon', 'rem', 'anya', 'frieren', 'stark', 'jinwoo', 'beru',
  'kazu', 'haru', 'sora', 'riku', 'yuki', 'akira', 'kenji', 'hiro', 'ren', 'shin', 'rei', 'kai', 'zero', 'zephyr', 'ares', 'apollo', 'hades', 'zeus', 'loki', 'thor', 'odin', 'fenrir'
];
const USER_PREFIXES = [
  'lil', 'mini', 'mr', 'iam', 'im', 'its', 'the', 'real', 'itz', 'lazy', 'sleepy', 'lucky', 'happy', 'lonely', 'silent', 'crazy', 'wild', 'sweet', 'cold', 'blue', 'red', 'black', 'white', 'gold', 'silver', 'baby', 'super', 'pro'
];
const USER_TAGS = [
  'za', 'zaza', 'kung', 'krub', 'kub', 'ja', 'jaja', 'jung', 'th', 'bkk', 'cnx', 'vip', 'gg', 'ch', 'tv', 'xz', 'zx', 'zz', 'v2', 'jr', 'dk', 'pk', 'x', 'z'
];

function genHumanNum(style) {
  const mode = style !== undefined ? style : rInt(0, 5);
  if (mode === 0) return String(rInt(2534, 2553)); // พ.ศ. เกิด
  if (mode === 1) return String(rInt(1991, 2010)); // ค.ศ. เกิด
  if (mode === 2) return String(rInt(1, 28)).padStart(2, '0') + String(rInt(1, 12)).padStart(2, '0'); // วันเดือนเกิด DDMM
  if (mode === 3) return String(rInt(10, 99)); // เลข 2 หลัก
  if (mode === 4) return String(rInt(100, 999)); // เลข 3 หลัก
  return pickOne(['007', '01', '07', '09', '11', '24', '35', '42', '45', '55', '555', '69', '77', '777', '88', '888', '99', '999', '123', '168', '404', '1412']) + (rInt(0, 2) === 0 ? String(rInt(0, 9)) : '');
}

function genUserId() {
  const sep = () => (rInt(0, 10) < 3 ? '_' : '');
  const patterns = [
    () => pickOne(USER_NICKS) + pickOne(USER_TAGS) + genHumanNum(rInt(0, 4)),
    () => pickOne(USER_NICKS) + sep() + pickOne(USER_STEMS) + (rInt(0, 10) < 8 ? String(rInt(1, 999)) : genHumanNum(3)),
    () => pickOne(USER_STEMS) + sep() + pickOne(USER_NICKS) + (rInt(0, 10) < 8 ? String(rInt(1, 999)) : genHumanNum(3)),
    () => pickOne(USER_PREFIXES) + sep() + pickOne(USER_NICKS) + genHumanNum(rInt(0, 4)),
    () => {
      const n = pickOne(USER_NICKS);
      const tail = n[n.length - 1];
      return n + tail.repeat(rInt(1, 2)) + genHumanNum(rInt(0, 2));
    },
    () => pickOne(USER_NICKS) + sep() + pickOne(USER_NICKS) + String(rInt(10, 999)),
    () => pickOne(USER_STEMS) + pickOne(USER_TAGS) + genHumanNum(rInt(0, 4))
  ];
  for (let i = 0; i < 40; i++) {
    let raw = pickOne(patterns)().toLowerCase().replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '');
    if (raw.length > 14) raw = raw.slice(0, 14).replace(/_$/g, '');
    if (raw.length >= 6 && raw.length <= 14 && /^[a-z][a-z0-9_]{5,13}$/.test(raw) && !/^pm[a-z0-9]{8}$/.test(raw)) {
      return raw;
    }
  }
  return pickOne(USER_NICKS) + pickOne(USER_TAGS) + String(rInt(100, 9999));
}

function genPassword() {
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const digits = len => Array.from({ length: len }, () => rInt(0, 9)).join('');
  const patterns = [
    () => cap(pickOne(USER_NICKS)) + genHumanNum(rInt(0, 2)) + digits(rInt(1, 2)),
    () => cap(pickOne(USER_STEMS)) + genHumanNum(rInt(0, 2)) + (rInt(0, 1) ? digits(1) : ''),
    () => pickOne(USER_NICKS) + pickOne(USER_TAGS) + genHumanNum(rInt(0, 2)) + digits(1),
    () => pickOne(USER_NICKS) + genHumanNum(rInt(0, 2)) + cap(pickOne(USER_TAGS)),
    () => pickOne(['08', '09', '06']) + digits(rInt(6, 7)) + pickOne(USER_NICKS).slice(0, rInt(2, 3)),
    () => pickOne(USER_STEMS) + pickOne(USER_NICKS) + digits(rInt(2, 3))
  ];
  for (let i = 0; i < 30; i++) {
    let pw = pickOne(patterns)().replace(/[^A-Za-z0-9]/g, '');
    if (pw.length > 13) pw = pw.slice(0, 13);
    if (pw.length >= 8 && pw.length <= 13) return pw;
  }
  return cap(pickOne(USER_NICKS)) + digits(6);
}

const READ_JS = `(() => {
  const c = window.__authConfig;
  if (!c || typeof window.executeAutoLogin !== 'function') return null;
  const domUser = (document.getElementById('p-auth-user')?.value || '').trim();
  const domPass = document.getElementById('p-auth-pass')?.value || '';
  const domChar = (document.getElementById('p-auth-char')?.value || '').trim();
  if (domUser && !c.username) {
    c.username = domUser;
    c.userEditedAt = c.userEditedAt || Date.now();
    c.generatedUser = false;
    c.register = false;
    try { localStorage.setItem('pelican_auth_cfg', JSON.stringify(c)); } catch (_) {}
  }
  if (domPass && !c.password) {
    c.password = domPass;
    c.userEditedAt = c.userEditedAt || Date.now();
    c.generatedUser = false;
    c.register = false;
    try { localStorage.setItem('pelican_auth_cfg', JSON.stringify(c)); } catch (_) {}
  }
  if (domChar && !c.charName) {
    c.charName = domChar;
    try { localStorage.setItem('pelican_auth_cfg', JSON.stringify(c)); } catch (_) {}
  }
  const inGame = Boolean(
    document.querySelector('.char-card:not(.empty)') ||
    (typeof window.getCurrentMapName === 'function' && window.getCurrentMapName() && window.getCurrentMapName() !== 'ไม่ทราบ') ||
    window.__charName
  );
  let charName = '';
  try {
    const live = typeof window.getLiveCharacterData === 'function' ? window.getLiveCharacterData() : null;
    charName = String((live && (live.name || live.characterName)) || window.__charName || c.charName || '').trim();
  } catch (_) {}
  const activeEl = document.activeElement;
  const isEditingAuth = Boolean(
    activeEl && (
      activeEl.id === 'p-auth-user' ||
      activeEl.id === 'p-auth-pass' ||
      activeEl.id === 'p-auth-char' ||
      (typeof activeEl.closest === 'function' && activeEl.closest('form.login-form'))
    )
  );
  return {
    username: String(c.username || '').trim(),
    password: String(c.password || ''),
    enabled: !!c.enabled,
    register: !!c.register,
    registerDone: !!c.registerDone,
    registerError: c.registerError || '',
    generatedUser: !!c.generatedUser,
    userEditedAt: Number(c.userEditedAt) || 0,
    verifiedLoginAt: Number(c.verifiedLoginAt) || 0,
    userToggledAt: Number(c.userToggledAt) || 0,
    inGame,
    charName,
    isEditingAuth
  };
})()`;

const pushJs = cfg => `(() => {
  const c = window.__authConfig || (window.__authConfig = {});
  const patch = ${JSON.stringify(cfg)};
  const domUser = (document.getElementById('p-auth-user')?.value || '').trim();
  const domPass = document.getElementById('p-auth-pass')?.value || '';
  if (domUser && !c.username) c.username = domUser;
  if (domPass && !c.password) c.password = domPass;
  const activeEl = document.activeElement;
  const isEditingAuth = Boolean(
    activeEl && (
      activeEl.id === 'p-auth-user' ||
      activeEl.id === 'p-auth-pass' ||
      (typeof activeEl.closest === 'function' && activeEl.closest('form.login-form'))
    )
  );
  const hasManualUserCreds = Boolean(
    c.username && c.password && !c.generatedUser && !c.register &&
    (Number(c.userEditedAt) > 0 || Number(c.verifiedLoginAt) > 0 || !/^pm[a-z0-9]{8}$/.test(String(c.username)))
  );
  if ((patch.register || patch.generatedUser) && (hasManualUserCreds || isEditingAuth)) {
    return {
      success: false,
      abortedByUserCreds: true,
      username: String(c.username || '').trim(),
      password: String(c.password || '')
    };
  }
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
        generatedUser: !hasAccount || !!profile.generatedAccount || !!profile.autoRegister
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
            register: false, registerDone: true, autoCreateChar: true, generatedUser: !!cred.generatedUser
          }), 3000);
          if (delivered?.success && delivered.result?.abortedByUserCreds && delivered.result.username && delivered.result.password) {
            credentials.setPassword(profile.id, delivered.result.password);
            updateProfile(profile.id, {
              account: delivered.result.username,
              autoRegister: false,
              generatedAccount: false,
              registerError: '',
              loginSyncPending: false,
              lastAuthSyncPushAt: Date.now()
            });
            pendingCreds.delete(profile.id);
            return;
          }
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
    if (!profile.debugPort && !profile.autoRegister && !(profile.account && pw(profile))) return;

    const proxyAvailable = !profile.proxyFallbackBrowser && proxyRegister && (
      typeof proxyRegister.isEnabled === 'function' && proxyRegister.isEnabled()
    );

    const r = profile.debugPort ? await evalProfilePort(profile.debugPort, READ_JS, 2500) : null;
    const cur = r && r.success ? r.result : null;
    if (!cur) {
      // Allow Proxy registration to proceed even before the game client window is online,
      // ONLY if this profile does not already have a character or user account!
      if (profile.autoRegister && !profile.lastCharName && !(profile.account && pw(profile)) && (proxyRegister?.hasPending?.(profile.id) || proxyAvailable)) {
        await syncProxyRegistration(profile, { clientOnline: false });
      }
      return;
    }

    // If user is actively typing in the in-game Auth HUD or login form right now, wait for next sync tick
    if (cur.isEditingAuth && (!cur.username || !cur.password)) {
      return;
    }

    // 1. If the user manually entered ID/Password in the in-game Bot HUD, logged in manually on the game screen,
    // or the in-game Bot HUD already has credentials while Manager is empty or in autoRegister/generatedAccount mode,
    // adopt the user's credentials into the Manager profile instead of leaving Manager blank or overwriting with a bot account!
    const clientEditStamp = Math.max(Number(cur.userEditedAt) || 0, Number(cur.verifiedLoginAt) || 0);
    const lastManagerPushAt = Number(profile.lastAuthSyncPushAt) || 0;
    const hasClientCreds = Boolean(cur.username && cur.password && !cur.register && !cur.registerError);
    const managerMissingCreds = !profile.account || !pw(profile);
    const isCustomClientUser = Boolean(cur.username && !cur.generatedUser && !/^pm[a-z0-9]{8}$/.test(cur.username));
    const isSameGeneratedAccount = Boolean(profile.generatedAccount && profile.account && cur.username === profile.account);
    const shouldAdoptFromClient = hasClientCreds && !isSameGeneratedAccount && (
      clientEditStamp > lastManagerPushAt ||
      managerMissingCreds ||
      (!cur.generatedUser && (profile.autoRegister || profile.generatedAccount)) ||
      (isCustomClientUser && (cur.username !== profile.account || cur.password !== pw(profile)))
    );

    if (shouldAdoptFromClient) {
      if (cur.username !== profile.account || cur.password !== pw(profile) || profile.autoRegister || (profile.generatedAccount && !cur.generatedUser)) {
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
        console.log(`[AuthSync] 🔄 ${profile.name}: ซิงค์ไอดี/รหัสจากเมนูบอทในเกม ("${cur.username}") เข้าโปรไฟล์ Manager อัตโนมัติ`);
      } else if (clientEditStamp > lastManagerPushAt) {
        updateProfile(profile.id, { lastAuthSyncPushAt: Date.now() });
      }
      return;
    }

    if (profile.autoRegister) {
      // NEVER auto-register over a profile that already has a character or manual credentials in HUD!
      if (cur.username && cur.password && !cur.register && !cur.registerError && !cur.generatedUser && !isSameGeneratedAccount) {
        credentials.setPassword(profile.id, cur.password);
        updateProfile(profile.id, {
          account: cur.username,
          autoRegister: false,
          generatedAccount: false,
          registerError: '',
          loginSyncPending: false,
          lastAuthSyncPushAt: Date.now(),
          ...(cur.charName && !profile.lastCharName ? { lastCharName: cur.charName } : {})
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
      const pushRes = await evalProfilePort(profile.debugPort, pushJs({
        enabled: true, autoResumeBot: true, username: cred.username, password: cred.password,
        register: true, registerDone: false, autoCreateChar: true, generatedUser: !!cred.generatedUser
      }), 3000);
      if (pushRes?.success && pushRes.result?.abortedByUserCreds && pushRes.result.username && pushRes.result.password) {
        credentials.setPassword(profile.id, pushRes.result.password);
        updateProfile(profile.id, {
          account: pushRes.result.username,
          autoRegister: false,
          generatedAccount: false,
          registerError: '',
          loginSyncPending: false,
          lastAuthSyncPushAt: Date.now()
        });
        pendingCreds.delete(profile.id);
        console.log(`[AuthSync] 🛡️ ${profile.name}: ยกเลิกการสร้างไอดีใหม่ เพราะพบไอดีผู้ใช้ "${pushRes.result.username}" ในเมนูบอท`);
        return;
      }
      updateProfile(profile.id, { lastAuthSyncPushAt: Date.now() });
      console.log(`[AuthSync] 📝 ${profile.name}: ส่งคำสั่งสมัครบัญชี "${cred.username}" ไปที่จอ`);
      return;
    }

    // Only push Manager credentials to the client when Manager actually has both account and password
    if (profile.account && pw(profile) && (profile.loginSyncPending || cur.username !== profile.account || cur.password !== pw(profile))) {
      const delivered = await evalProfilePort(profile.debugPort, pushJs({
        enabled: true,
        preserveUserToggle: !profile.loginSyncPending,
        username: profile.account,
        password: pw(profile),
        register: false,
        generatedUser: !!profile.generatedAccount,
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

module.exports = { createAuthSync, genUserId, genPassword };
