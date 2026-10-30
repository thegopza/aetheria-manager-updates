// Left-edge slide-out Guild Manager drawer (`#gd-tab` + `#gd-drawer`).
// Works alongside `party_manager.js` (`#pt-tab`) and `premium_manager.js` (`#pm-tab`).
// Flow:
//   1. Click `+ สร้าง / ตั้งกิลด์` -> select Guild Leader (หัวกิลด์) -> enter Guild Name (ชื่อกิลด์) -> click ตกลง
//   2. Leader appears inside the Guild Card; Manager creates the guild in-game (if needed)
//   3. Auto-selects free online characters into the guild (`autoFill`) & invites/accepts them
//   4. Auto Daily Material Donation (`donateMaterial`) runs for leader & members whenever eligible.

(function () {
  const POLL_MS = 4500;
  const ZENY_CFG_KEY = 'pelican_guild_zeny_cfg_v2';
  let isOpen = false;
  let pollTimer = null;
  let lastData = { autoDonate: true, guilds: [], availableProfiles: [], allProfiles: [] };
  let createModalState = null; // { selectedLeaderId: string|null, guildName: string, autoFill: boolean, autoDonate: boolean }
  let memberPickerState = null; // { guildId: string }
  let zenyModalState = null; // { profileId: string|null, guildId: string|null, scope: string|null, amount: number, donateAll: boolean, keepZeny: number }

  function loadZenyCfg() {
    try {
      localStorage.removeItem('pelican_guild_zeny_cfg');
      const raw = localStorage.getItem(ZENY_CFG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          amount: Math.max(10000, Math.floor((Number(parsed.amount) || 10000) / 10000) * 10000),
          donateAll: Boolean(parsed.donateAll),
          splitLevelUp: Boolean(parsed.splitLevelUp),
          keepZeny: Math.max(0, Math.floor(Number(parsed.keepZeny) || 0))
        };
      }
    } catch (_) {}
    return { amount: 10000, donateAll: false, splitLevelUp: false, keepZeny: 0 };
  }

  let zenyCfg = loadZenyCfg();

  function formatShortZeny(z) {
    const n = Number(z || 0);
    if (n >= 1000000) {
      const m = n / 1000000;
      return (n % 1000000 === 0 ? m.toFixed(0) : m.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + 'M';
    }
    return Math.round(n / 1000) + 'k';
  }

  function computeGuildLevelUpSplit(g, keepZeny = 0) {
    const neededExp = g && g.guildExpToNext && g.guildExpToNext > (g.guildExp || 0)
      ? Math.max(0, Number(g.guildExpToNext) - Number(g.guildExp || 0))
      : 0;
    const neededZeny = neededExp > 0 ? neededExp * 10000 : 0;
    if (!g || neededZeny <= 0) {
      return { neededExp: 0, neededZeny: 0, onlineCount: 0, avgZenyPerChar: 0 };
    }
    const allMembers = [g.leader, ...(g.members || [])].filter(Boolean);
    const inGuildOnline = allMembers.filter(m => m.online && m.inGameGuildName);
    const onlineList = inGuildOnline.length > 0 ? inGuildOnline : allMembers.filter(m => m.online);
    const onlineCount = Math.max(1, onlineList.length);

    // Water-fill across online members who have known Zeny so if some members have less than average, others cover the remainder
    const spendableCaps = onlineList
      .map(m => Math.floor(Math.max(0, Number(m.zeny || 0) - keepZeny) / 10000) * 10000)
      .filter(z => z >= 10000)
      .sort((a, b) => a - b);

    let avgZenyPerChar = Math.max(10000, Math.ceil(neededExp / onlineCount) * 10000);
    if (spendableCaps.length > 0) {
      let remZeny = neededZeny;
      let remCount = spendableCaps.length;
      for (const cap of spendableCaps) {
        const share = Math.max(10000, Math.ceil((remZeny / 10000) / remCount) * 10000);
        if (cap < share) {
          remZeny = Math.max(0, remZeny - cap);
          remCount--;
        } else {
          avgZenyPerChar = share;
          break;
        }
      }
    }
    return {
      neededExp,
      neededZeny,
      onlineCount: spendableCaps.length > 0 ? spendableCaps.length : onlineCount,
      avgZenyPerChar: Math.min(neededZeny, Math.max(10000, avgZenyPerChar))
    };
  }

  function saveZenyCfg(patch = {}) {
    if (patch.amount !== undefined) {
      const n = Math.floor(Number(patch.amount) || 0);
      if (n >= 10000) zenyCfg.amount = Math.floor(n / 10000) * 10000;
    }
    if (patch.donateAll !== undefined) {
      zenyCfg.donateAll = Boolean(patch.donateAll);
    }
    if (patch.splitLevelUp !== undefined) {
      zenyCfg.splitLevelUp = Boolean(patch.splitLevelUp);
    }
    if (patch.keepZeny !== undefined) {
      zenyCfg.keepZeny = Math.max(0, Math.floor(Number(patch.keepZeny) || 0));
    }
    try {
      localStorage.setItem(ZENY_CFG_KEY, JSON.stringify(zenyCfg));
    } catch (_) {}
    syncZenyInputsDOM();
  }

  function syncZenyInputsDOM(excludeEl = null) {
    const drawer = document.getElementById('gd-drawer');
    if (!drawer) return;
    drawer.querySelectorAll('.js-gd-zeny-amount').forEach(inp => {
      if (inp === excludeEl || document.activeElement === inp) return;
      const cardEl = inp.closest('.gd-card');
      const gId = cardEl ? cardEl.dataset.guildId : null;
      const g = gId ? (lastData.guilds || []).find(x => x.id === gId) : null;
      if (zenyCfg.splitLevelUp && g) {
        const split = computeGuildLevelUpSplit(g, zenyCfg.keepZeny);
        if (split.avgZenyPerChar > 0) {
          inp.value = String(split.avgZenyPerChar);
          inp.disabled = false;
          return;
        }
      }
      inp.value = String(zenyCfg.amount);
      inp.disabled = zenyCfg.donateAll;
    });
    drawer.querySelectorAll('.js-gd-zeny-keep').forEach(inp => {
      if (inp === excludeEl || document.activeElement === inp) return;
      inp.value = String(zenyCfg.keepZeny);
    });
    drawer.querySelectorAll('[data-zeny-preset]').forEach(btn => {
      const val = btn.dataset.zenyPreset;
      const isLvBtn = btn.dataset.zenySplitLv === '1';
      const isActive = isLvBtn
        ? (!zenyCfg.donateAll && zenyCfg.splitLevelUp)
        : ((val === 'all' && zenyCfg.donateAll) || (!zenyCfg.donateAll && !zenyCfg.splitLevelUp && Number(val) === zenyCfg.amount));
      btn.classList.toggle('is-active', isActive);
    });
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function avatarHtml(p) {
    const label = (p.charName || p.name || '?').trim();
    const ini = esc(label.slice(0, 2).toUpperCase());
    if (p.portrait) {
      return `<div class="gd-avatar"><img src="${esc(p.portrait)}" alt="" onerror="this.remove()"><span>${ini}</span></div>`;
    }
    return `<div class="gd-avatar"><span>${ini}</span></div>`;
  }

  function mountShell() {
    if (document.getElementById('gd-drawer')) return;

    const tab = document.createElement('button');
    tab.id = 'gd-tab';
    tab.type = 'button';
    tab.title = 'จัดการกิลด์ & บริจาครายวันออโต้ (สร้างกิลด์ / ดึงสมาชิกออโต้ / บริจาคไอเทมรายวัน)';
    tab.innerHTML = `
      <span class="gd-tab-icon">🏰</span>
      <span class="gd-tab-label">กิลด์</span>
      <span class="gd-tab-count" id="gd-tab-count">0</span>
    `;
    tab.addEventListener('click', () => toggleDrawer());

    const backdrop = document.createElement('div');
    backdrop.id = 'gd-backdrop';
    backdrop.addEventListener('click', () => toggleDrawer(false));

    const drawer = document.createElement('aside');
    drawer.id = 'gd-drawer';
    drawer.setAttribute('aria-hidden', 'true');
    drawer.innerHTML = `
      <header class="gd-header">
        <div class="gd-header-title">
          <span class="gd-header-icon">🏰</span>
          <div>
            <h2>จัดการกิลด์ & บริจาครายวัน (Auto Guild)</h2>
            <p>เลือกหัวกิลด์ → ตั้งชื่อกิลด์ → ดึงสมาชิกเข้ากิลด์ออโต้ & บริจาคไอเทมรายวันอัตโนมัติ</p>
          </div>
        </div>
        <div class="gd-header-actions">
          <button type="button" class="gd-btn gd-btn-gold" id="gd-routine-settings-btn" title="ตั้งค่าซื้อของบริจาครายวันจากตลาด & เลือกแลกหินร้านค้ากิลด์ (Enchant Rune / Accessory Enchant Rune)">⚙️ ตั้งค่าแลกหิน</button>
          <button type="button" class="gd-btn gd-btn-ghost" id="gd-sync-now" title="ซิงค์กิลด์และเช็กบริจาครายวันทันที">🔄 ซิงค์</button>
          <button type="button" class="gd-btn gd-btn-primary" id="gd-create-btn">+ สร้างกิลด์</button>
          <button type="button" class="gd-close" id="gd-close-btn" title="ปิด">✕</button>
        </div>
      </header>
      <div class="gd-master-bar" id="gd-master-bar">
        <div class="gd-master-row">
          <label class="gd-switch-label" title="เมื่อเปิด ตัวละครทุกจอที่มีกิลด์ในเกม (ทั้งกิลด์ที่สร้างใน Manager และกิลด์คนอื่น) ที่เปิดติ๊กบริจาคไว้จะบริจาคของรายวันให้อัตโนมัติ">
            <input type="checkbox" id="gd-global-autodonate" checked>
            <span>🎁 บริจาคไอเทมกิลด์รายวันออโต้ทุกจอ (รวมกิลด์คนอื่นที่ตัวละครสังกัด)</span>
          </label>
          <div class="gd-master-btns">
            <button type="button" class="gd-mini-btn gd-mini-btn-gold" id="gd-donate-all-items-btn" title="สั่งเช็กและบังคับบริจาคไอเทมรายวันทุกจอที่มีกิลด์ทันที">🎁 บังคับบริจาคของทุกจอ</button>
            <button type="button" class="gd-mini-btn gd-mini-btn-cyan" id="gd-run-routine-all-btn" title="สั่งซื้อของบริจาคที่ขาด + บริจาคของ + ทบ Zeny พอดีแลก + แลกหินร้านค้ากิลด์ทุกจอทันที">💎 ซื้อบริจาค & แลกหินทุกจอ</button>
            <button type="button" class="gd-mini-btn" id="gd-open-routine-cfg-bar" title="ตั้งค่าระบบซื้อของบริจาค & เลือกแลกหินร้านค้ากิลด์">⚙️ ตั้งค่าแลกหิน</button>
          </div>
        </div>
        <div class="gd-routine-summary-bar" id="gd-routine-summary-bar"></div>
        <div class="gd-zeny-bar" id="gd-zeny-bar">
          <span class="gd-zeny-title">💰 ตั้งค่าบริจาคเงินเข้ากิลด์:</span>
          <label class="gd-zeny-field" title="จำนวนเงิน Zeny ที่จะสั่งบริจาคต่อจอ (ขั้นต่ำ 10,000z · ทุก 10,000z = 1 EXP/แต้มกิลด์)">
            <span>จำนวน/จอ</span>
            <input type="number" id="gd-zeny-amount" class="gd-zeny-input js-gd-zeny-amount" min="10000" step="10000" value="${zenyCfg.amount}" ${zenyCfg.donateAll ? 'disabled' : ''}>
          </label>
          <div class="gd-zeny-presets">
            <button type="button" class="gd-preset-btn ${!zenyCfg.donateAll && !zenyCfg.splitLevelUp && zenyCfg.amount === 10000 ? 'is-active' : ''}" data-zeny-preset="10000">10k</button>
            <button type="button" class="gd-preset-btn ${!zenyCfg.donateAll && !zenyCfg.splitLevelUp && zenyCfg.amount === 50000 ? 'is-active' : ''}" data-zeny-preset="50000">50k</button>
            <button type="button" class="gd-preset-btn ${!zenyCfg.donateAll && !zenyCfg.splitLevelUp && zenyCfg.amount === 100000 ? 'is-active' : ''}" data-zeny-preset="100000">100k</button>
            <button type="button" class="gd-preset-btn ${!zenyCfg.donateAll && !zenyCfg.splitLevelUp && zenyCfg.amount === 500000 ? 'is-active' : ''}" data-zeny-preset="500000">500k</button>
            <button type="button" class="gd-preset-btn ${!zenyCfg.donateAll && !zenyCfg.splitLevelUp && zenyCfg.amount === 1000000 ? 'is-active' : ''}" data-zeny-preset="1000000">1M</button>
            <button type="button" class="gd-preset-btn ${zenyCfg.donateAll ? 'is-active' : ''}" data-zeny-preset="all" title="บริจาคเงินทั้งหมดในตัวหลังหักเงินสำรอง">ทั้งหมด</button>
          </div>
          <label class="gd-zeny-field" title="เก็บเงินสำรองติดตัวไว้ขั้นต่ำ (Zeny) จะไม่ดึงเงินส่วนนี้ไปบริจาค">
            <span>เหลือติดตัว</span>
            <input type="number" id="gd-zeny-keep" class="gd-zeny-input gd-zeny-keep js-gd-zeny-keep" min="0" step="10000" value="${zenyCfg.keepZeny}">
          </label>
          <button type="button" class="gd-mini-btn gd-mini-btn-gold" id="gd-donate-zeny-all-btn" title="บังคับบริจาคเงินเข้ากิลด์เรียงตัวทุกหน้าจอที่มีกิลด์ในเกม">💰 บริจาคเงินทุกจอ (เรียงตัว)</button>
        </div>
      </div>
      <div class="gd-body" id="gd-body">
        <div class="gd-empty">กำลังโหลดข้อมูลกิลด์...</div>
      </div>
      <div class="gd-picker-overlay" id="gd-picker" hidden>
        <div class="gd-picker-card" id="gd-picker-card"></div>
      </div>
    `;

    document.body.appendChild(tab);
    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);

    document.getElementById('gd-close-btn').addEventListener('click', () => toggleDrawer(false));
    document.getElementById('gd-create-btn').addEventListener('click', () => openCreateGuildModal());
    document.getElementById('gd-sync-now').addEventListener('click', onSyncNow);
    document.getElementById('gd-routine-settings-btn')?.addEventListener('click', () => openDailyRoutineSettingsModal());
    document.getElementById('gd-open-routine-cfg-bar')?.addEventListener('click', () => openDailyRoutineSettingsModal());
    document.getElementById('gd-run-routine-all-btn')?.addEventListener('click', (e) => onRunDailyRoutine({ scope: 'all' }, e.currentTarget));
    document.getElementById('gd-global-autodonate').addEventListener('change', async (e) => {
      await api('POST', '/api/guilds/settings', { autoDonate: e.target.checked });
    });
    document.getElementById('gd-donate-all-items-btn')?.addEventListener('click', onDonateAllItemsNow);
    document.getElementById('gd-donate-zeny-all-btn')?.addEventListener('click', () => onDonateZenyBatch({ scope: 'all' }, document.getElementById('gd-donate-zeny-all-btn')));
    const masterAmtInput = document.getElementById('gd-zeny-amount');
    const masterKeepInput = document.getElementById('gd-zeny-keep');
    masterAmtInput?.addEventListener('input', () => {
      saveZenyCfg({ amount: masterAmtInput.value, donateAll: false, splitLevelUp: false });
    });
    masterKeepInput?.addEventListener('input', () => {
      saveZenyCfg({ keepZeny: masterKeepInput.value });
    });
    drawer.querySelectorAll('#gd-zeny-bar [data-zeny-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.zenyPreset;
        if (preset === 'all') {
          saveZenyCfg({ donateAll: !zenyCfg.donateAll, splitLevelUp: false });
        } else {
          saveZenyCfg({ amount: Number(preset || 10000), donateAll: false, splitLevelUp: false });
        }
      });
    });
    document.getElementById('gd-picker').addEventListener('click', (e) => {
      if (e.target.id === 'gd-picker') closePicker();
    });

    refresh(false);
  }

  function toggleDrawer(force) {
    isOpen = typeof force === 'boolean' ? force : !isOpen;
    if (isOpen) {
      document.body.classList.remove('pt-open', 'pm-open', 'hw-open', 'cd-open');
    }
    document.body.classList.toggle('gd-open', isOpen);
    const drawer = document.getElementById('gd-drawer');
    if (drawer) drawer.setAttribute('aria-hidden', isOpen ? 'false' : 'true');

    if (isOpen) {
      refresh(true);
      if (!pollTimer) pollTimer = setInterval(() => refresh(false), POLL_MS);
    } else {
      closePicker();
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }
  }

  async function api(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    const data = await r.json().catch(() => ({ success: false, error: 'Invalid response' }));
    if (!r.ok || data.success === false) {
      throw new Error(data.error || `HTTP ${r.status}`);
    }
    if (data.guilds) {
      lastData = data;
      render();
    }
    return data;
  }

  async function refresh(triggerSync) {
    try {
      if (triggerSync) {
        await api('POST', '/api/guilds/sync');
      } else {
        await api('GET', '/api/guilds');
      }
    } catch (e) {
      console.warn('[Guild UI]', e.message);
    }
  }

  async function onSyncNow(e) {
    const btn = e.currentTarget;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ กำลังซิงค์...';
    try {
      await api('POST', '/api/guilds/sync');
      if (typeof showToast === 'function') showToast('🏰 ซิงค์กิลด์และตรวจสอบการบริจาครายวันเรียบร้อย');
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  function renderDonationBadge(m) {
    if (m.donatedToday) {
      return `<span class="gd-donate-badge is-done" title="ตัวละครนี้บริจาคไอเทมรายวันวันนี้เรียบร้อยแล้ว">🎁 บริจาครายวันแล้ว</span>`;
    }
    const isCooldown24h = Boolean(m.cooldownNote || (m.lastAction && m.lastAction.includes('รอครบ 24')));
    if (m.canDonateCount > 0 && isCooldown24h) {
      return `<span class="gd-donate-badge is-waiting" title="มีไอเทมครบในกระเป๋าแล้ว แต่เซิร์ฟเวอร์เกมกำหนดให้สมาชิกใหม่ต้องอยู่กิลด์ครบ 24 ชม. ก่อนบริจาค (ระบบจะบริจาคให้อัตโนมัติทันทีที่ครบ 24 ชม.)">🔒 รอครบ 24 ชม. (ของครบ)</span>`;
    }
    if (m.canDonateCount > 0) {
      return `<span class="gd-donate-badge is-ready" title="มีไอเทมพร้อมบริจาครายวันในกระเป๋า ระบบกำลังส่งบริจาค">📦 พร้อมบริจาค (${m.canDonateCount})</span>`;
    }
    if (m.online && m.inGameGuildName) {
      return `<span class="gd-donate-badge is-waiting" title="ยังไม่มีไอเทมบริจาครายวันครบตามจำนวนในกระเป๋า">⏳ รอไอเทมบริจาค</span>`;
    }
    return '';
  }

  function renderShopBadge(m) {
    if (!m.online || !m.inGameGuildName) return '';
    const dr = lastData.dailyRoutine || {};
    const shop = (m.shopToday && typeof m.shopToday === 'object') ? m.shopToday : {};
    const b90341 = Math.max(0, Number(shop['90341'] || 0));
    const b90340 = Math.max(0, Number(shop['90340'] || 0));
    const want90341 = dr.exchangeAccessoryRune !== false ? Math.min(1, Math.max(0, Number(dr.accessoryRuneQty ?? 1))) : 0;
    const want90340 = dr.exchangeEnchantRune !== false ? Math.min(10, Math.max(0, Number(dr.enchantRuneQty ?? 10))) : 0;
    if (b90341 === 0 && b90340 === 0 && !dr.autoExchangeShop) return '';
    const done90341 = b90341 >= want90341;
    const done90340 = b90340 >= want90340;
    const allDone = done90341 && done90340 && (want90341 > 0 || want90340 > 0);
    return `<span class="gd-shop-badge ${allDone ? 'is-done' : (b90341 > 0 || b90340 > 0 ? 'is-partial' : 'is-waiting')}" title="แลกหินร้านค้ากิลด์วันนี้: Accessory Enchant Rune ${b90341}/1 · Enchant Rune ${b90340}/10">💎 ${b90341}/${want90341 || 1} · ${b90340}/${want90340 || 10}</span>`;
  }

  function renderRoutineSummaryBar() {
    const el = document.getElementById('gd-routine-summary-bar');
    if (!el) return;
    const dr = lastData.dailyRoutine || {};
    const want90341 = dr.exchangeAccessoryRune !== false ? Math.min(1, Math.max(0, Number(dr.accessoryRuneQty ?? 1))) : 0;
    const want90340 = dr.exchangeEnchantRune !== false ? Math.min(10, Math.max(0, Number(dr.enchantRuneQty ?? 10))) : 0;
    const dailyPts = (want90341 * 60) + (want90340 * 10);
    const itemsParts = [];
    if (want90341 > 0) itemsParts.push(`Accessory Rune x${want90341}`);
    if (want90340 > 0) itemsParts.push(`Enchant Rune x${want90340}`);
    const itemsLabel = itemsParts.length > 0 ? `${itemsParts.join(' + ')} (${dailyPts} แต้ม/วัน)` : 'ยังไม่เลือกหิน';

    el.innerHTML = `
      <span class="gd-routine-chip ${dr.autoBuyDonateMaterials ? 'is-on' : 'is-off'}" title="ซื้อวัตถุดิบบริจาคกิลด์รายวันที่ขาดจากตลาดกลางอัตโนมัติ (จำกัดวันละ 1 ครั้ง)">
        🛒 ซื้อของบริจาคออโต้: <b>${dr.autoBuyDonateMaterials ? `เปิด (≤${Number(dr.maxMaterialUnitPrice || 5000).toLocaleString()}z)` : 'ปิด'}</b>
      </span>
      <span class="gd-routine-chip ${dr.autoExchangeShop ? 'is-on' : 'is-off'}" title="แลกหินร้านค้ากิลด์รายวันอัตโนมัติ">
        💎 แลกหินออโต้: <b>${dr.autoExchangeShop ? 'เปิด' : 'ปิด'} · ${esc(itemsLabel)}</b>
      </span>
      <span class="gd-routine-chip ${dr.autoTopUpZenyForShop ? 'is-on' : 'is-off'}" title="เมื่อบริจาคไอเทมรายวันแล้วแต้มยังไม่พอแลกของที่เลือก จะบริจาค Zeny ทบเฉพาะแต้มที่ขาดให้พอดีแลกของ">
        💰 ทบ Zeny พอดีแลก: <b>${dr.autoTopUpZenyForShop ? `เปิด (สำรอง ${Number(dr.keepZeny || 0).toLocaleString()}z)` : 'ปิด'}</b>
      </span>
    `;
  }

  async function onRunDailyRoutine(payload, btn) {
    const orig = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ กำลังซื้อ/บริจาค/แลกหิน...';
    }
    try {
      const res = await api('POST', '/api/guilds/run-daily-routine', payload || {});
      if (typeof showToast === 'function') {
        const parts = [];
        if (res.donatedMaterialsCount > 0) {
          parts.push(`🎁 บริจาคของสำเร็จ ${res.donatedMaterialsCount} จอ${res.boughtMaterialsCount > 0 ? ` (ซื้อจากตลาด ${res.boughtMaterialsCount} จอ)` : ''}`);
        }
        if (res.exchangedCharsCount > 0) {
          parts.push(`💎 แลกหินสำเร็จ ${res.exchangedCharsCount} จอ${res.totalTopUpZeny > 0 ? ` (ทบ Zeny รวม ${Number(res.totalTopUpZeny).toLocaleString()}z)` : ''}`);
        }
        if (parts.length > 0) {
          showToast(parts.join(' · '));
        } else if (res.cooldownCount > 0) {
          showToast(`🔒 ติดคูลดาวน์สมาชิกใหม่ 24 ชม. (${res.cooldownCount} จอ)`);
        } else {
          showToast('ℹ️ ทุกจอที่ออนไลน์บริจาครายวันและแลกหินครบตามโควตาวันนี้แล้ว (หรือรอของ/เงิน)');
        }
      }
      return res;
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message, true);
      throw err;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = orig;
      }
    }
  }

  function getZenyInputs(cardEl = null) {
    const amtEl = (cardEl && cardEl.querySelector('.js-gd-zeny-amount')) || document.getElementById('gd-zeny-amount');
    const keepEl = (cardEl && cardEl.querySelector('.js-gd-zeny-keep')) || document.getElementById('gd-zeny-keep');
    const rawAmt = Math.max(10000, Math.floor((Number(amtEl && amtEl.value) || zenyCfg.amount || 10000) / 10000) * 10000);
    const keepZeny = Math.max(0, Math.floor(Number(keepEl && keepEl.value) ?? zenyCfg.keepZeny ?? 0));
    const amount = zenyCfg.donateAll ? 'all' : rawAmt;
    return { amount, rawAmt, keepZeny };
  }

  async function onDonateAllItemsNow(e) {
    const btn = e.currentTarget;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ กำลังบริจาคของ...';
    try {
      const res = await api('POST', '/api/guilds/donate-item', { scope: 'all' });
      if (typeof showToast === 'function') {
        if (res.donatedNow > 0) {
          showToast(`🎁 สั่งบริจาคไอเทมรายวันสำเร็จเพิ่ม ${res.donatedNow} จอ${res.boughtNow > 0 ? ` (ซื้อจากตลาด ${res.boughtNow} จอ)` : ''}`);
        } else if (res.cooldownCount > 0) {
          showToast(`🔒 ติดคูลดาวน์สมาชิกใหม่ 24 ชม. (${res.cooldownCount} จอ)`);
        } else {
          showToast('ℹ️ ไม่มีจอที่บริจาคของเพิ่มได้ในขณะนี้ (บริจาคแล้ว หรือยังไม่มีของครบ)');
        }
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  async function onDonateZenyBatch(payload, btn, overrideAmount = undefined, overrideKeep = undefined) {
    const cardEl = btn ? btn.closest('.gd-card') : null;
    const defaults = getZenyInputs(cardEl);
    const amount = overrideAmount !== undefined ? overrideAmount : defaults.amount;
    const keepZeny = overrideKeep !== undefined ? overrideKeep : defaults.keepZeny;
    let extraBody = {};
    if (payload && payload.guildId && zenyCfg.splitLevelUp && !zenyCfg.donateAll) {
      const g = (lastData.guilds || []).find(x => x.id === payload.guildId);
      const split = g ? computeGuildLevelUpSplit(g, keepZeny) : null;
      if (split && split.neededZeny >= 10000) {
        extraBody = {
          maxTotalZeny: split.neededZeny,
          splitLevelUp: true
        };
      }
    }
    const orig = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ กำลังบริจาคเงิน...';
    }
    try {
      const res = await api('POST', '/api/guilds/donate-zeny', { ...payload, amount, keepZeny, ...extraBody });
      if (typeof showToast === 'function') {
        if (res.donatedCount > 0) {
          showToast(`💰 บริจาคเงินสำเร็จ ${res.donatedCount} จอ · รวม ${Number(res.totalZenyDonated || 0).toLocaleString()}z (+${res.totalExpGained || 0} EXP/แต้มกิลด์)`);
        } else {
          const firstReason = (res.results && res.results[0] && res.results[0].reason) || 'ไม่มีจอที่มีเงินเพียงพอ (ขั้นต่ำ 10,000z หลังหักเงินสำรอง)';
          showToast(`ℹ️ ${firstReason}`, true);
        }
      }
      return res;
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message, true);
      throw err;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = orig;
      }
    }
  }

  function renderCardZenyBar(guildOrNull, scopeType) {
    const g = guildOrNull;
    const split = g ? computeGuildLevelUpSplit(g, zenyCfg.keepZeny) : { neededExp: 0, neededZeny: 0, onlineCount: 0, avgZenyPerChar: 0 };
    const displayAmt = (!zenyCfg.donateAll && zenyCfg.splitLevelUp && split.avgZenyPerChar > 0)
      ? split.avgZenyPerChar
      : zenyCfg.amount;
    const actionAttr = scopeType === 'guild'
      ? `data-act="donate-zeny-guild" data-guild="${esc(g.id)}"`
      : `data-act="donate-zeny-external"`;
    const btnLabel = scopeType === 'guild'
      ? '💰 บริจาคเงินกิลด์นี้ (เรียงตัว)'
      : '💰 บริจาคเงินกิลด์นอก (เรียงตัว)';

    return `
      <div class="gd-card-zeny-bar">
        <div class="gd-card-zeny-controls">
          <span class="gd-zeny-title">💰 ระบุเงินบริจาค/จอ:</span>
          <label class="gd-zeny-field" title="ระบุจำนวนเงิน Zeny ที่ต้องการบริจาคต่อตัวละคร (ขั้นต่ำ 10,000z · ทุก 10,000z = +1 EXP/แต้มกิลด์)">
            <input type="number" class="gd-zeny-input js-gd-zeny-amount" min="10000" step="10000" value="${displayAmt}" ${zenyCfg.donateAll ? 'disabled' : ''}>
            <span>z</span>
          </label>
          <div class="gd-zeny-presets">
            <button type="button" class="gd-preset-btn ${!zenyCfg.donateAll && !zenyCfg.splitLevelUp && zenyCfg.amount === 10000 ? 'is-active' : ''}" data-zeny-preset="10000">10k</button>
            <button type="button" class="gd-preset-btn ${!zenyCfg.donateAll && !zenyCfg.splitLevelUp && zenyCfg.amount === 50000 ? 'is-active' : ''}" data-zeny-preset="50000">50k</button>
            <button type="button" class="gd-preset-btn ${!zenyCfg.donateAll && !zenyCfg.splitLevelUp && zenyCfg.amount === 100000 ? 'is-active' : ''}" data-zeny-preset="100000">100k</button>
            <button type="button" class="gd-preset-btn ${!zenyCfg.donateAll && !zenyCfg.splitLevelUp && zenyCfg.amount === 500000 ? 'is-active' : ''}" data-zeny-preset="500000">500k</button>
            <button type="button" class="gd-preset-btn ${!zenyCfg.donateAll && !zenyCfg.splitLevelUp && zenyCfg.amount === 1000000 ? 'is-active' : ''}" data-zeny-preset="1000000">1M</button>
            ${split.neededZeny > 0 ? `<button type="button" class="gd-preset-btn gd-preset-lv ${!zenyCfg.donateAll && zenyCfg.splitLevelUp ? 'is-active' : ''}" data-zeny-preset="${split.avgZenyPerChar}" data-zeny-split-lv="1" data-needed-zeny="${split.neededZeny}" title="หารเฉลี่ยทุกจอที่ออนไลน์ในกิลด์ (${split.onlineCount} จอ): จอละ ~${split.avgZenyPerChar.toLocaleString()}z · รวมทั้งกิลด์ไม่เกิน ${split.neededZeny.toLocaleString()}z (+${split.neededExp.toLocaleString()} EXP เพื่ออัปเลเวลกิลด์ถัดไปพอดี)">⚡ เฉลี่ยอัป Lv. (${formatShortZeny(split.avgZenyPerChar)}/จอ · ${split.onlineCount} จอ)</button>` : ''}
            <button type="button" class="gd-preset-btn ${zenyCfg.donateAll ? 'is-active' : ''}" data-zeny-preset="all" title="บริจาคเงินทั้งหมดในตัวหลังหักเงินสำรอง">ทั้งหมด</button>
          </div>
          <label class="gd-zeny-field" title="เก็บเงินสำรองติดตัวไว้ขั้นต่ำ (Zeny)">
            <span>เหลือติดตัว</span>
            <input type="number" class="gd-zeny-input gd-zeny-keep js-gd-zeny-keep" min="0" step="10000" value="${zenyCfg.keepZeny}">
          </label>
        </div>
        <button type="button" class="gd-mini-btn gd-mini-btn-gold gd-zeny-submit-btn" ${actionAttr} title="สั่งบริจาคเงินเข้ากิลด์เรียงตัวตามจำนวนที่ระบุ">
          ${btnLabel}
        </button>
      </div>
    `;
  }

  function renderMemberRow(m, guildId, isLeader, isExternal = false) {
    const charLabel = m.charName ? esc(m.charName) : `<span class="gd-dim">(ยังไม่เข้าเกม)</span>`;
    const subParts = [esc(m.name)];
    if (m.level) subParts.push(`Lv.${m.level}`);
    if (m.charClass) subParts.push(esc(m.charClass));
    if (m.myPoints) {
      subParts.push(`⭐ ${Number(m.myPoints).toLocaleString()} แต้ม`);
    }
    const zenyBadge = (m.zeny !== null && m.zeny !== undefined)
      ? `<span class="gd-zeny-pill" title="เงิน Zeny ในตัวละครนี้">💰 ${Number(m.zeny).toLocaleString()}z</span>`
      : '';
    const statusText = m.lastAction ? esc(m.lastAction) : (m.online ? 'ออนไลน์' : 'ออฟไลน์');
    const roleTag = isExternal
      ? `<span class="gd-ext-guild-badge" title="ตัวละครนี้สังกัดกิลด์ในเกมแล้ว (กิลด์คนอื่น / นอกรายการสร้างกิลด์)">🏰 ${esc(m.inGameGuildName || 'มีกิลด์')}${m.inGameGuildLevel ? ` Lv.${m.inGameGuildLevel}` : ''}</span>`
      : (isLeader ? '<span class="gd-crown" title="หัวกิลด์">👑 หัวกิลด์</span>' : '<span class="gd-member-tag">ลูกกิลด์</span>');

    return `
      <div class="gd-slot ${isLeader ? 'is-leader' : 'is-member'} ${m.online ? 'is-online' : 'is-offline'}">
        ${avatarHtml(m)}
        <div class="gd-slot-info">
          <div class="gd-slot-top">
            <span class="gd-online-dot ${m.online ? 'on' : 'off'}" title="${m.online ? 'ออนไลน์ในเกม' : 'ออฟไลน์'}"></span>
            <span class="gd-char-name">${charLabel}</span>
            ${roleTag}
            ${zenyBadge}
            ${renderDonationBadge(m)}
            ${renderShopBadge(m)}
          </div>
          <div class="gd-slot-sub">${subParts.join(' · ')}</div>
          <div class="gd-slot-status">${statusText}</div>
        </div>
        <div class="gd-slot-actions">
          <label class="gd-slot-check" title="ติ๊กเพื่อเปิด/ปิดบริจาคของกิลด์รายวันอัตโนมัติของตัวละครนี้">
            <input type="checkbox" data-act="toggle-profile-donate" data-profile="${esc(m.id)}" ${m.autoDonate !== false ? 'checked' : ''}>
            <span>🎁 บริจาคของ</span>
          </label>
          <button type="button" class="gd-mini-btn" data-act="donate-item-profile" data-profile="${esc(m.id)}" ${(!m.online || !m.inGameGuildName || m.donatedToday) ? 'disabled' : ''} title="สั่งบริจาคของรายวันเฉพาะตัวละครนี้ทันที">🎁</button>
          <button type="button" class="gd-mini-btn gd-mini-btn-cyan" data-act="run-routine-profile" data-profile="${esc(m.id)}" ${(!m.online || !m.inGameGuildName) ? 'disabled' : ''} title="สั่งซื้อของบริจาคที่ขาด + บริจาครายวัน + ทบ Zeny พอดี + แลกหินร้านค้ากิลด์เฉพาะตัวละครนี้ทันที">💎 แลกหิน</button>
          <button type="button" class="gd-mini-btn gd-mini-btn-gold" data-act="donate-zeny-profile" data-profile="${esc(m.id)}" data-guild="${esc(guildId || '')}" ${(!m.online || !m.inGameGuildName || (m.zeny || 0) < 10000) ? 'disabled' : ''} title="คลิกเพื่อระบุจำนวนเงิน Zeny ที่ต้องการบริจาคของตัวละครนี้">💰 บริจาคเงิน</button>
          ${!isExternal
            ? (isLeader
              ? `<button type="button" class="gd-icon-btn" data-act="change-leader" data-guild="${esc(guildId)}" title="เปลี่ยนหัวกิลด์">🔄</button>`
              : `<button type="button" class="gd-icon-btn gd-danger" data-act="remove-member" data-guild="${esc(guildId)}" data-profile="${esc(m.id)}" title="เอาออกจากรายการกิลด์">✕</button>`)
            : ''
          }
        </div>
      </div>
    `;
  }

  function render(forceDom = false) {
    const countEl = document.getElementById('gd-tab-count');
    const guilds = lastData.guilds || [];
    const externalProfiles = lastData.externalGuildProfiles || [];
    const badgeCount = guilds.length > 0 ? guilds.length : externalProfiles.length;
    if (countEl) {
      countEl.textContent = String(badgeCount);
      countEl.classList.toggle('has-guilds', badgeCount > 0);
    }

    const globalAutoDonateEl = document.getElementById('gd-global-autodonate');
    if (globalAutoDonateEl) {
      globalAutoDonateEl.checked = lastData.autoDonate !== false;
    }

    renderRoutineSummaryBar();

    const body = document.getElementById('gd-body');
    if (!body) return;

    // Avoid clobbering focused input fields inside #gd-body during background polling
    if (!forceDom && body.contains(document.activeElement) && document.activeElement && document.activeElement.tagName === 'INPUT') {
      return;
    }

    if (guilds.length === 0 && externalProfiles.length === 0) {
      body.innerHTML = `
        <div class="gd-empty">
          <div class="gd-empty-icon">🏰</div>
          <h3>ยังไม่ได้ตั้งค่ากิลด์</h3>
          <p>กด <b>"+ สร้าง / ตั้งกิลด์"</b> ด้านบน → เลือก<b>หัวกิลด์</b> → ตั้ง<b>ชื่อกิลด์</b> แล้วกด<b>ตกลง</b><br>
          หรือหากตัวละครเข้ากิลด์คนอื่นในเกมไว้แล้ว เมื่อออนไลน์จะแสดงรายชื่อให้ติ๊กบริจาคของและบริจาคเงินอัตโนมัติที่นี่</p>
          <button type="button" class="gd-btn gd-btn-primary" id="gd-empty-create">+ สร้าง / ตั้งกิลด์แรก</button>
        </div>
      `;
      body.querySelector('#gd-empty-create')?.addEventListener('click', () => openCreateGuildModal());
      return;
    }

    const guildsHtml = guilds.map(g => {
      const displayName = g.inGameName || g.desiredName || g.name || 'กิลด์ใหม่';
      const lvBadge = g.guildLevel
        ? `<span class="gd-lv-badge" title="เลเวลกิลด์ในเกม (EXP ${g.guildExp || 0}/${g.guildExpToNext || 0})">Lv.${g.guildLevel} (${g.guildExp || 0}/${g.guildExpToNext || 0} EXP)</span>`
        : `<span class="gd-lv-badge is-pending" title="รอก่อตั้งกิลด์ในเกม (ใช้ 10,000 Zeny)">⏳ รอสร้างในเกม</span>`;
      const memberCountBadge = `<span class="gd-count-badge" title="จำนวนสมาชิกในกิลด์">${g.totalAssigned}/${g.maxMembers || 20} คน</span>`;
      const donateProgressBadge = `<span class="gd-donate-summary" title="จำนวนตัวละครที่บริจาครายวันแล้ววันนี้">🎁 บริจาคแล้ว ${g.donatedCount}/${g.totalAssigned}</span>`;

      const membersHtml = g.members.length > 0
        ? g.members.map(m => renderMemberRow(m, g.id, false, false)).join('')
        : `<div class="gd-no-members">ยังไม่มีลูกกิลด์ในกล่องนี้ — ระบบจะดึงตัวละครที่ออนไลน์และยังไม่มีกิลด์เข้าให้อัตโนมัติ หรือกด "+ เพิ่มสมาชิกเอง" ด้านล่าง</div>`;

      return `
        <section class="gd-card" data-guild-id="${esc(g.id)}">
          <div class="gd-card-head">
            <div class="gd-card-title-row">
              <span class="gd-card-emblem">🏰</span>
              <input type="text" class="gd-name-input" value="${esc(displayName)}" maxlength="16"
                data-act="rename-guild" data-guild="${esc(g.id)}" title="ชื่อกิลด์ (2–16 ตัวอักษร)">
              ${lvBadge}
              ${memberCountBadge}
              ${donateProgressBadge}
              <button type="button" class="gd-icon-btn gd-danger" data-act="delete-guild" data-guild="${esc(g.id)}" title="ลบการ์ดกิลด์นี้ออกจาก Manager (ไม่ยุบกิลด์ในเกม)">🗑️</button>
            </div>
            <div class="gd-card-toggles">
              <label class="gd-mini-toggle" title="ดึงตัวละครที่ออนไลน์และยังไม่มีกิลด์เข้ากิลด์นี้ให้อัตโนมัติ">
                <input type="checkbox" data-act="toggle-autofill" data-guild="${esc(g.id)}" ${g.autoFill !== false ? 'checked' : ''}>
                <span>🤖 เลือกสมาชิกออโต้</span>
              </label>
              <label class="gd-mini-toggle" title="ให้สมาชิกในกิลด์นี้บริจาคไอเทมรายวันอัตโนมัติเมื่อมีของในกระเป๋า">
                <input type="checkbox" data-act="toggle-autodonate" data-guild="${esc(g.id)}" ${g.autoDonate !== false ? 'checked' : ''}>
                <span>🎁 บริจาครายวันออโต้</span>
              </label>
              <button type="button" class="gd-mini-btn" data-act="trigger-autofill" data-guild="${esc(g.id)}" title="ดึงตัวละครที่ว่างทุกจอเข้ากิลด์นี้ทันที">⚡ ดึงคนว่างเข้ากิลด์</button>
              <button type="button" class="gd-mini-btn gd-mini-btn-gold" data-act="trigger-donate" data-guild="${esc(g.id)}" title="สั่งเช็กและบริจาคไอเทมรายวันทันที">🎁 บริจาคของกิลด์นี้</button>
              <button type="button" class="gd-mini-btn gd-mini-btn-cyan" data-act="run-routine-guild" data-guild="${esc(g.id)}" title="สั่งซื้อของบริจาครายวันที่ขาด + บริจาคของ + ทบ Zeny พอดีแลก + แลกหินร้านค้ากิลด์ทั้งกิลด์นี้ทันที">💎 ซื้อบริจาค & แลกหินกิลด์นี้</button>
            </div>
            ${renderCardZenyBar(g, 'guild')}
          </div>

          <div class="gd-section-label">หัวกิลด์ (Guild Master)</div>
          ${renderMemberRow(g.leader, g.id, true, false)}

          <div class="gd-section-label">สมาชิกกิลด์ (${g.members.length} คน) — ระบบเชิญและกดรับเข้ากิลด์ให้อัตโนมัติ</div>
          <div class="gd-members-list">
            ${membersHtml}
          </div>

          <button type="button" class="gd-add-member" data-act="add-member" data-guild="${esc(g.id)}">
            + เพิ่มสมาชิกกิลด์เอง
          </button>
        </section>
      `;
    }).join('');

    let externalHtml = '';
    if (externalProfiles.length > 0) {
      const extDonated = externalProfiles.filter(m => m.donatedToday).length;
      const allExtChecked = externalProfiles.every(m => m.autoDonate !== false);
      const extRows = externalProfiles.map(m => renderMemberRow(m, null, false, true)).join('');
      externalHtml = `
        <section class="gd-card gd-external-card">
          <div class="gd-card-head">
            <div class="gd-card-title-row">
              <span class="gd-card-emblem">🛡️</span>
              <strong class="gd-ext-title">ตัวละครที่มีกิลด์ในเกม (กิลด์คนอื่น / นอกรายการ Manager)</strong>
              <span class="gd-count-badge">${externalProfiles.length} ตัวละคร</span>
              <span class="gd-donate-summary">🎁 บริจาคแล้ว ${extDonated}/${externalProfiles.length}</span>
            </div>
            <div class="gd-card-toggles">
              <label class="gd-mini-toggle" title="ติ๊กเพื่อเปิด/ปิดบริจาคของรายวันออโต้ของตัวละครกิลด์นอกทั้งหมด">
                <input type="checkbox" data-act="toggle-external-all-donate" ${allExtChecked ? 'checked' : ''}>
                <span>🎁 บริจาคของออโต้ทั้งหมด</span>
              </label>
              <button type="button" class="gd-mini-btn gd-mini-btn-gold" data-act="donate-item-external" title="สั่งบริจาคของรายวันเฉพาะตัวละครที่สังกัดกิลด์นอกทันที">🎁 บริจาคของกิลด์นอกตอนนี้</button>
              <button type="button" class="gd-mini-btn gd-mini-btn-cyan" data-act="run-routine-external" title="สั่งซื้อของบริจาครายวันที่ขาด + บริจาคของ + ทบ Zeny พอดีแลก + แลกหินสำหรับจอกิลด์นอกทันที">💎 ซื้อบริจาค & แลกหินกิลด์นอก</button>
            </div>
            ${renderCardZenyBar(null, 'external')}
          </div>
          <div class="gd-section-label">รายชื่อตัวละครที่มีกิลด์ในเกม — เลือกติ๊กบริจาคของรายตัว หรือกดบังคับบริจาคเงินได้ทันที</div>
          <div class="gd-members-list">
            ${extRows}
          </div>
        </section>
      `;
    }

    body.innerHTML = guildsHtml + externalHtml;

    bindCardEvents(body);
  }

  function bindCardEvents(root) {
    root.querySelectorAll('.js-gd-zeny-amount').forEach(inp => {
      inp.addEventListener('input', () => {
        saveZenyCfg({ amount: inp.value, donateAll: false, splitLevelUp: false });
      });
    });
    root.querySelectorAll('.js-gd-zeny-keep').forEach(inp => {
      inp.addEventListener('input', () => {
        saveZenyCfg({ keepZeny: inp.value });
      });
    });
    root.querySelectorAll('[data-zeny-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.zenyPreset;
        const isSplitLv = btn.dataset.zenySplitLv === '1';
        if (preset === 'all') {
          saveZenyCfg({ donateAll: !zenyCfg.donateAll, splitLevelUp: false });
        } else if (isSplitLv) {
          saveZenyCfg({ amount: Number(preset || 10000), donateAll: false, splitLevelUp: true });
        } else {
          saveZenyCfg({ amount: Number(preset || 10000), donateAll: false, splitLevelUp: false });
        }
      });
    });
    root.querySelectorAll('[data-act]').forEach(el => {
      const act = el.dataset.act;
      const guildId = el.dataset.guild;
      if (act === 'rename-guild') {
        el.addEventListener('change', async () => {
          const val = el.value.trim();
          if (val.length < 2 || val.length > 16) {
            if (typeof showToast === 'function') showToast('ชื่อกิลด์ต้องมีความยาว 2–16 ตัวอักษร', true);
            render(true);
            return;
          }
          try {
            await api('PATCH', `/api/guilds/${encodeURIComponent(guildId)}`, { name: val });
          } catch (err) {
            if (typeof showToast === 'function') showToast(err.message, true);
          }
        });
        return;
      }
      if (act === 'toggle-autofill') {
        el.addEventListener('change', async () => {
          try {
            await api('PATCH', `/api/guilds/${encodeURIComponent(guildId)}`, { autoFill: el.checked });
          } catch (err) {
            if (typeof showToast === 'function') showToast(err.message, true);
          }
        });
        return;
      }
      if (act === 'toggle-autodonate') {
        el.addEventListener('change', async () => {
          try {
            await api('PATCH', `/api/guilds/${encodeURIComponent(guildId)}`, { autoDonate: el.checked });
          } catch (err) {
            if (typeof showToast === 'function') showToast(err.message, true);
          }
        });
        return;
      }
      if (act === 'toggle-profile-donate') {
        el.addEventListener('change', async () => {
          try {
            await api('POST', '/api/guilds/profile-donate', { profileId: el.dataset.profile, autoDonate: el.checked });
            if (typeof showToast === 'function') {
              showToast(el.checked ? '🎁 เปิดบริจาคของรายวันออโต้สำหรับตัวละครนี้แล้ว' : '⏸️ ปิดบริจาคของรายวันออโต้สำหรับตัวละครนี้แล้ว');
            }
          } catch (err) {
            if (typeof showToast === 'function') showToast(err.message, true);
          }
        });
        return;
      }
      if (act === 'toggle-external-all-donate') {
        el.addEventListener('change', async () => {
          try {
            const extIds = (lastData.externalGuildProfiles || []).map(p => p.id);
            if (extIds.length === 0) return;
            await api('POST', '/api/guilds/profile-donate', { profileIds: extIds, autoDonate: el.checked });
            if (typeof showToast === 'function') {
              showToast(el.checked ? '🎁 เปิดบริจาคของออโต้ให้ตัวละครกิลด์นอกทั้งหมดแล้ว' : '⏸️ ปิดบริจาคของออโต้ให้ตัวละครกิลด์นอกทั้งหมดแล้ว');
            }
          } catch (err) {
            if (typeof showToast === 'function') showToast(err.message, true);
          }
        });
        return;
      }
      el.addEventListener('click', async () => {
        try {
          if (act === 'add-member') {
            openMemberPickerModal(guildId, 'member');
          } else if (act === 'change-leader') {
            openMemberPickerModal(guildId, 'leader');
          } else if (act === 'remove-member') {
            await api('DELETE', `/api/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(el.dataset.profile)}`);
          } else if (act === 'delete-guild') {
            await api('DELETE', `/api/guilds/${encodeURIComponent(guildId)}`);
          } else if (act === 'trigger-autofill') {
            await api('POST', `/api/guilds/${encodeURIComponent(guildId)}/auto-fill`);
            if (typeof showToast === 'function') showToast('🤖 ดึงตัวละครที่ว่างเข้ากิลด์เรียบร้อย');
          } else if (act === 'donate-item-profile') {
            el.disabled = true;
            try {
              const res = await api('POST', '/api/guilds/donate-item', { profileId: el.dataset.profile, buyMissing: true });
              if (typeof showToast === 'function') {
                if (res.donatedNow > 0) showToast(`🎁 บริจาคไอเทมรายวันสำเร็จ${res.boughtNow > 0 ? ' (ซื้อส่วนที่ขาดจากตลาด)' : ''}`);
                else if (res.cooldownCount > 0) showToast('🔒 ติดคูลดาวน์สมาชิกใหม่ 24 ชม.');
                else showToast('ℹ️ ตัวละครนี้ยังไม่มีไอเทมบริจาครายวันครบตามจำนวน หรือบริจาคไปแล้ว', true);
              }
            } finally {
              el.disabled = false;
            }
          } else if (act === 'run-routine-profile') {
            await onRunDailyRoutine({ profileId: el.dataset.profile }, el);
          } else if (act === 'run-routine-guild') {
            await onRunDailyRoutine({ guildId }, el);
          } else if (act === 'run-routine-external') {
            await onRunDailyRoutine({ scope: 'external' }, el);
          } else if (act === 'donate-item-external') {
            el.disabled = true;
            const orig = el.textContent;
            el.textContent = '⏳ กำลังเช็ก...';
            try {
              const res = await api('POST', '/api/guilds/donate-item', { scope: 'external' });
              if (typeof showToast === 'function') {
                if (res.donatedNow > 0) showToast(`🎁 บริจาคของกิลด์นอกสำเร็จเพิ่ม ${res.donatedNow} จอ`);
                else showToast('ℹ️ ไม่มีจอกิลด์นอกที่บริจาคของเพิ่มได้ในขณะนี้');
              }
            } finally {
              el.disabled = false;
              el.textContent = orig;
            }
          } else if (act === 'donate-zeny-profile') {
            openZenyDonateModal(el.dataset.profile, el.dataset.guild || null);
          } else if (act === 'donate-zeny-guild') {
            await onDonateZenyBatch({ guildId }, el);
          } else if (act === 'donate-zeny-external') {
            await onDonateZenyBatch({ scope: 'external' }, el);
          } else if (act === 'trigger-donate') {
            el.disabled = true;
            const origText = el.textContent;
            el.textContent = '⏳ กำลังเช็ก...';
            try {
              const res = await api('POST', `/api/guilds/${encodeURIComponent(guildId)}/donate`);
              if (typeof showToast === 'function') {
                if (res.donatedNow > 0) {
                  showToast(`🎁 สั่งบริจาครายวันเพิ่ม ${res.donatedNow} จอเรียบร้อย${res.boughtNow > 0 ? ` (ซื้อจากตลาด ${res.boughtNow} จอ)` : ''}`);
                } else if (res.cooldownCount > 0) {
                  showToast(`🔒 เซิร์ฟเวอร์เกมล็อก "สมาชิกใหม่ต้องอยู่กิลด์ครบ 24 ชม." (${res.cooldownCount} จอมีของครบแล้ว ระบบจะบริจาคให้อัตโนมัติทันทีที่ครบ 24 ชม.)`);
                } else {
                  showToast('ℹ️ ไม่มีจอที่บริจาคเพิ่มได้ในขณะนี้ (บริจาคแล้ว หรือยังไม่มีของครบ)');
                }
              }
            } finally {
              el.disabled = false;
              el.textContent = origText;
            }
          }
        } catch (err) {
          if (typeof showToast === 'function') showToast(err.message, true);
        }
      });
    });
  }

  function findProfileInfo(profileId) {
    const all = lastData.allProfiles || [];
    const found = all.find(p => String(p.id) === String(profileId));
    if (found) return found;
    for (const g of (lastData.guilds || [])) {
      if (g.leader && String(g.leader.id) === String(profileId)) return g.leader;
      const m = (g.members || []).find(x => String(x.id) === String(profileId));
      if (m) return m;
    }
    return (lastData.externalGuildProfiles || []).find(x => String(x.id) === String(profileId)) || null;
  }

  // Modal 4: Daily Routine Settings (Auto-Buy Missing Donation Materials + Auto Guild Shop Rune Exchange + Smart Zeny Top-Up)
  function openDailyRoutineSettingsModal() {
    const overlay = document.getElementById('gd-picker');
    const card = document.getElementById('gd-picker-card');
    if (!overlay || !card) return;

    const cur = lastData.dailyRoutine || {};
    const draft = {
      autoBuyDonateMaterials: cur.autoBuyDonateMaterials !== undefined ? Boolean(cur.autoBuyDonateMaterials) : true,
      maxMaterialUnitPrice: Math.max(100, Number(cur.maxMaterialUnitPrice || 5000)),
      autoExchangeShop: cur.autoExchangeShop !== undefined ? Boolean(cur.autoExchangeShop) : true,
      exchangeAccessoryRune: cur.exchangeAccessoryRune !== false,
      accessoryRuneQty: Math.min(1, Math.max(0, Number(cur.accessoryRuneQty ?? 1))),
      exchangeEnchantRune: cur.exchangeEnchantRune !== false,
      enchantRuneQty: Math.min(10, Math.max(1, Number(cur.enchantRuneQty || 10))),
      autoTopUpZenyForShop: cur.autoTopUpZenyForShop !== false,
      keepZeny: Math.max(0, Number(cur.keepZeny ?? 50000))
    };

    card.innerHTML = `
      <div class="gd-picker-head">
        <h3>⚙️ ตั้งค่าซื้อของบริจาครายวัน & แลกหินร้านค้ากิลด์ออโต้</h3>
        <button type="button" class="gd-close" id="gd-picker-close">✕</button>
      </div>
      <div class="gd-create-form gd-routine-modal-body">
        <div class="gd-routine-section">
          <div class="gd-routine-sec-title">1. ซื้อไอเทมบริจาครายวันจากตลาดกลางอัตโนมัติ <span class="gd-badge-note">จำกัดวันละ 1 ครั้ง/ตัว</span></div>
          <label class="gd-create-check">
            <input type="checkbox" id="gd-rt-autobuy" ${draft.autoBuyDonateMaterials ? 'checked' : ''}>
            <span>🛒 <b>ซื้อวัตถุดิบบริจาครายวันที่ขาดจากตลาดกลางให้อัตโนมัติ</b> (เช่น อยู่แมพสูงแล้วขาด Elunium ระบบจะเช็กรับของค้างก่อน แล้วซื้อเฉพาะจำนวนที่ขาดเพื่อส่งบริจาครายวันทันที)</span>
          </label>
          <div class="gd-routine-inline-row">
            <label class="gd-zeny-field">
              <span>ราคาสูงสุดต่อชิ้น (Zeny/ก้อน)</span>
              <input type="number" id="gd-rt-maxprice" class="gd-zeny-input" min="100" step="500" value="${draft.maxMaterialUnitPrice}">
            </label>
            <div class="gd-zeny-presets">
              <button type="button" class="gd-preset-btn" data-rt-price="2000">2,000z</button>
              <button type="button" class="gd-preset-btn" data-rt-price="3500">3,500z</button>
              <button type="button" class="gd-preset-btn" data-rt-price="5000">5,000z</button>
              <button type="button" class="gd-preset-btn" data-rt-price="10000">10,000z</button>
            </div>
          </div>
        </div>

        <div class="gd-routine-section">
          <div class="gd-routine-sec-title">2. เลือกหินร้านค้ากิลด์ที่ต้องการแลกรายวัน (Guild Shop)</div>
          <label class="gd-create-check">
            <input type="checkbox" id="gd-rt-autoshop" ${draft.autoExchangeShop ? 'checked' : ''}>
            <span>💎 <b>เปิดแลกหินจากร้านค้ากิลด์อัตโนมัติทุกวัน</b> ตามรายการที่เลือกด้านล่าง</span>
          </label>

          <div class="gd-shop-item-grid">
            <div class="gd-shop-item-card">
              <label class="gd-create-check">
                <input type="checkbox" id="gd-rt-acc-rune" ${draft.exchangeAccessoryRune ? 'checked' : ''}>
                <div>
                  <div class="gd-shop-item-name">💍 Accessory Enchant Rune</div>
                  <div class="gd-shop-item-sub">ใช้ <b>60 คะแนน/ชิ้น</b> · จำกัดสูงสุด <b>1 ชิ้น/วัน</b></div>
                </div>
              </label>
              <div class="gd-shop-item-right">
                <span class="gd-pts-pill">60 แต้ม/วัน</span>
              </div>
            </div>

            <div class="gd-shop-item-card">
              <label class="gd-create-check">
                <input type="checkbox" id="gd-rt-enc-rune" ${draft.exchangeEnchantRune ? 'checked' : ''}>
                <div>
                  <div class="gd-shop-item-name">🔮 Enchant Rune</div>
                  <div class="gd-shop-item-sub">ใช้ <b>10 คะแนน/ชิ้น</b> · จำกัดสูงสุด <b>10 ชิ้น/วัน</b></div>
                </div>
              </label>
              <div class="gd-shop-item-right">
                <label class="gd-zeny-field" title="จำนวน Enchant Rune ที่ต้องการแลกต่อวัน (สูงสุด 10 ชิ้น/วัน)">
                  <span>จำนวน/วัน</span>
                  <input type="number" id="gd-rt-enc-qty" class="gd-zeny-input" style="width:52px" min="1" max="10" step="1" value="${draft.enchantRuneQty}">
                  <span>/10</span>
                </label>
                <div class="gd-zeny-presets">
                  <button type="button" class="gd-preset-btn" data-rt-qty="1">1</button>
                  <button type="button" class="gd-preset-btn" data-rt-qty="5">5</button>
                  <button type="button" class="gd-preset-btn" data-rt-qty="10">10</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="gd-routine-section">
          <div class="gd-routine-sec-title">3. คำนวณแต้ม & บริจาค Zeny ทบส่วนที่ขาดให้พอดีแลกของ</div>
          <label class="gd-create-check">
            <input type="checkbox" id="gd-rt-autotopup" ${draft.autoTopUpZenyForShop ? 'checked' : ''}>
            <span>💰 <b>ถ้าบริจาคของรายวันแล้วแต้มยังไม่พอแลกหินที่เลือก ให้บริจาค Zeny ทบเฉพาะแต้มที่ขาดให้พอดีแลก</b> (10,000z = +1 แต้ม · รอบริจาคของรายวันเสร็จก่อนเสมอเพื่อประหยัดเงิน)</span>
          </label>
          <div class="gd-routine-inline-row">
            <label class="gd-zeny-field" title="เก็บเงินสำรองติดตัวไว้ขั้นต่ำ (Zeny) ระบบจะไม่ดึงเงินส่วนนี้ไปซื้อของหรือบริจาคทบแต้ม">
              <span>เงินสำรองเหลือติดตัวขั้นต่ำ</span>
              <input type="number" id="gd-rt-keepzeny" class="gd-zeny-input" min="0" step="10000" value="${draft.keepZeny}">
              <span>z</span>
            </label>
            <div class="gd-zeny-presets">
              <button type="button" class="gd-preset-btn" data-rt-keep="0">0</button>
              <button type="button" class="gd-preset-btn" data-rt-keep="50000">50k</button>
              <button type="button" class="gd-preset-btn" data-rt-keep="200000">200k</button>
              <button type="button" class="gd-preset-btn" data-rt-keep="500000">500k</button>
            </div>
          </div>
        </div>

        <div class="gd-zeny-preview-box" id="gd-rt-calc-preview"></div>
      </div>
      <div class="gd-create-footer gd-routine-modal-footer">
        <button type="button" class="gd-btn gd-btn-ghost" id="gd-rt-cancel">ยกเลิก</button>
        <button type="button" class="gd-btn gd-btn-ghost" id="gd-rt-save">💾 บันทึกการตั้งค่า</button>
        <button type="button" class="gd-btn gd-btn-primary gd-btn-confirm" id="gd-rt-save-run">
          🚀 บันทึก & สั่งทำทันทีทุกจอ
        </button>
      </div>
    `;

    overlay.hidden = false;

    const autoBuyCb = card.querySelector('#gd-rt-autobuy');
    const maxPriceInput = card.querySelector('#gd-rt-maxprice');
    const autoShopCb = card.querySelector('#gd-rt-autoshop');
    const accRuneCb = card.querySelector('#gd-rt-acc-rune');
    const encRuneCb = card.querySelector('#gd-rt-enc-rune');
    const encQtyInput = card.querySelector('#gd-rt-enc-qty');
    const autoTopUpCb = card.querySelector('#gd-rt-autotopup');
    const keepZenyInput = card.querySelector('#gd-rt-keepzeny');
    const calcPreview = card.querySelector('#gd-rt-calc-preview');

    const readForm = () => {
      const wantAcc = Boolean(accRuneCb && accRuneCb.checked);
      const wantEnc = Boolean(encRuneCb && encRuneCb.checked);
      const encQty = Math.min(10, Math.max(1, Math.floor(Number(encQtyInput ? encQtyInput.value : 10) || 10)));
      return {
        autoBuyDonateMaterials: Boolean(autoBuyCb && autoBuyCb.checked),
        maxMaterialUnitPrice: Math.max(100, Math.floor(Number(maxPriceInput ? maxPriceInput.value : 5000) || 5000)),
        autoExchangeShop: Boolean(autoShopCb && autoShopCb.checked),
        exchangeAccessoryRune: wantAcc,
        accessoryRuneQty: wantAcc ? 1 : 0,
        exchangeEnchantRune: wantEnc,
        enchantRuneQty: encQty,
        autoTopUpZenyForShop: Boolean(autoTopUpCb && autoTopUpCb.checked),
        keepZeny: Math.max(0, Math.floor(Number(keepZenyInput ? keepZenyInput.value : 0) || 0))
      };
    };

    const updateCalcPreview = () => {
      const cfg = readForm();
      const accPts = cfg.exchangeAccessoryRune ? 60 : 0;
      const encPts = cfg.exchangeEnchantRune ? (cfg.enchantRuneQty * 10) : 0;
      const totalPtsPerDay = accPts + encPts;
      const matDonatePts = 60; // Tier 1 daily material donation gives +60 points
      const deficitAfterMat = Math.max(0, totalPtsPerDay - matDonatePts);
      const zenyTopUpIfZero = deficitAfterMat * 10000;

      if (totalPtsPerDay === 0) {
        calcPreview.innerHTML = `<span class="gd-preview-warn">⚠️ ยังไม่ได้ติ๊กเลือกหินที่ต้องการแลกรายวัน</span>`;
        return;
      }

      const itemsDesc = [
        cfg.exchangeAccessoryRune ? `Accessory Enchant Rune x1 (<b>60</b> แต้ม)` : null,
        cfg.exchangeEnchantRune ? `Enchant Rune x${cfg.enchantRuneQty} (<b>${encPts}</b> แต้ม)` : null
      ].filter(Boolean).join(' + ');

      calcPreview.innerHTML = `
        <div>📊 <b>คำนวณแต้มแลกหินต่อวัน/ตัวละคร:</b> ${itemsDesc} = รวม <b class="gd-gold-text">${totalPtsPerDay} แต้ม/วัน</b></div>
        <div class="gd-preview-sub">
          • บริจาคไอเทมรายวัน 1 ครั้ง ได้รับ <b class="gd-exp-text">+60 แต้ม</b> (Tier 1)<br>
          ${deficitAfterMat > 0
            ? `• หากตัวละครมีแต้มเดิม 0 แต้ม: หลังบริจาคของจะขาดอีก <b>${deficitAfterMat} แต้ม</b> → ${cfg.autoTopUpZenyForShop ? `ระบบจะบริจาค Zeny ทบพอดี <b class="gd-gold-text">${zenyTopUpIfZero.toLocaleString()} Zeny</b> แล้วแลกหินครบทุกชิ้นทันที (ถ้ามีแต้มสะสมอยู่แล้วจะหักลบแต้มที่มีก่อนและทบเฉพาะส่วนที่ขาดจริง)` : `<span class="gd-preview-warn">ปิดการทบ Zeny ไว้ ระบบจะแลกเท่าที่แต้มพอมี</span>`}`
            : `• แต้มจากการบริจาคของรายวัน (60 แต้ม) เพียงพอแลกได้ทันทีโดยไม่ต้องบริจาค Zeny เพิ่ม!`}
        </div>
      `;
    };

    updateCalcPreview();

    [autoBuyCb, maxPriceInput, autoShopCb, accRuneCb, encRuneCb, encQtyInput, autoTopUpCb, keepZenyInput].forEach(el => {
      el?.addEventListener('input', updateCalcPreview);
      el?.addEventListener('change', updateCalcPreview);
    });

    card.querySelectorAll('[data-rt-price]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (maxPriceInput) maxPriceInput.value = btn.dataset.rtPrice;
        updateCalcPreview();
      });
    });
    card.querySelectorAll('[data-rt-qty]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (encQtyInput) encQtyInput.value = btn.dataset.rtQty;
        if (encRuneCb) encRuneCb.checked = true;
        updateCalcPreview();
      });
    });
    card.querySelectorAll('[data-rt-keep]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (keepZenyInput) keepZenyInput.value = btn.dataset.rtKeep;
        updateCalcPreview();
      });
    });

    card.querySelector('#gd-picker-close')?.addEventListener('click', closePicker);
    card.querySelector('#gd-rt-cancel')?.addEventListener('click', closePicker);

    card.querySelector('#gd-rt-save')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const cfg = readForm();
      btn.disabled = true;
      btn.textContent = '⏳ กำลังบันทึก...';
      try {
        await api('POST', '/api/guilds/settings', { dailyRoutine: cfg });
        closePicker();
        if (typeof showToast === 'function') {
          showToast('⚙️ บันทึกการตั้งค่าซื้อของบริจาครายวัน & แลกหินร้านค้ากิลด์เรียบร้อย');
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '💾 บันทึกการตั้งค่า';
        if (typeof showToast === 'function') showToast(err.message, true);
      }
    });

    card.querySelector('#gd-rt-save-run')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const cfg = readForm();
      btn.disabled = true;
      btn.textContent = '⏳ กำลังซื้อ/บริจาค/แลกหิน...';
      try {
        await onRunDailyRoutine({ scope: 'all', dailyRoutine: cfg }, null);
        closePicker();
      } catch (_) {
        btn.disabled = false;
        btn.textContent = '🚀 บันทึก & สั่งทำทันทีทุกจอ';
      }
    });
  }

  // Modal 3: Specify Zeny Donation Amount for a Character
  function openZenyDonateModal(profileId, guildId = null) {
    const prof = findProfileInfo(profileId);
    if (!prof) return;
    const g = guildId ? (lastData.guilds || []).find(x => x.id === guildId) : null;
    zenyModalState = {
      profileId: String(profileId),
      guildId: guildId || null,
      amount: zenyCfg.amount || 10000,
      donateAll: Boolean(zenyCfg.donateAll),
      keepZeny: zenyCfg.keepZeny || 0
    };
    renderZenyDonateModal(prof, g);
  }

  function renderZenyDonateModal(prof, g) {
    if (!zenyModalState) return;
    const overlay = document.getElementById('gd-picker');
    const card = document.getElementById('gd-picker-card');
    if (!overlay || !card) return;

    const currentZeny = Math.max(0, Number(prof.zeny || 0));
    const guildName = (g && (g.inGameName || g.name)) || prof.inGameGuildName || 'กิลด์';
    const guildLv = (g && g.guildLevel) || prof.inGameGuildLevel || null;
    const guildExp = (g && g.guildExp !== null && g.guildExp !== undefined) ? g.guildExp : prof.inGameGuildExp;
    const guildExpToNext = (g && g.guildExpToNext) || prof.inGameGuildExpToNext || 0;
    const neededExp = guildExpToNext > (guildExp || 0) ? Math.max(0, Number(guildExpToNext) - Number(guildExp || 0)) : 0;
    const neededZeny = neededExp > 0 ? neededExp * 10000 : 0;
    const split = g ? computeGuildLevelUpSplit(g, zenyModalState.keepZeny) : { onlineCount: 1, avgZenyPerChar: neededZeny };

    card.innerHTML = `
      <div class="gd-picker-head">
        <h3>💰 ระบุจำนวนเงินบริจาคเข้ากิลด์</h3>
        <button type="button" class="gd-close" id="gd-picker-close">✕</button>
      </div>
      <div class="gd-create-form gd-zeny-modal-body">
        <div class="gd-zeny-char-summary">
          ${avatarHtml(prof)}
          <div class="gd-zeny-char-meta">
            <div class="gd-zeny-char-name">
              <span class="gd-online-dot ${prof.online ? 'on' : 'off'}"></span>
              <strong>${esc(prof.charName || prof.name)}</strong>
              <span class="gd-ext-guild-badge">🏰 ${esc(guildName)}${guildLv ? ` Lv.${guildLv}` : ''}</span>
            </div>
            <div class="gd-zeny-char-sub">
              <span>เงินในตัว: <b class="gd-gold-text">💰 ${currentZeny.toLocaleString()} Zeny</b></span>
              ${prof.myPoints ? `<span>· แต้มสะสม: <b>⭐ ${Number(prof.myPoints).toLocaleString()}</b></span>` : ''}
              ${neededExp > 0 ? `<span>· ขาดอีก <b>${neededExp.toLocaleString()} EXP</b> (${neededZeny.toLocaleString()}z) อัป Lv.${Number(guildLv || 1) + 1}</span>` : ''}
            </div>
          </div>
        </div>

        <div class="gd-create-step-label">1. ระบุจำนวนเงิน Zeny ที่ต้องการบริจาค <span class="gd-hint-inline">(ขั้นต่ำ 10,000z · ทุก 10,000z = +1 EXP/แต้มกิลด์)</span></div>
        <div class="gd-zeny-modal-input-wrap">
          <input type="number" id="gd-modal-zeny-amount" class="gd-create-input gd-zeny-modal-input" min="10000" step="10000"
            value="${zenyModalState.amount}" ${zenyModalState.donateAll ? 'disabled' : ''} placeholder="ใส่จำนวนเงิน เช่น 50000, 100000...">
          <span class="gd-zeny-unit">Zeny</span>
        </div>

        <div class="gd-zeny-modal-presets">
          <button type="button" class="gd-preset-btn" data-modal-preset="10000">10,000z (+1 EXP)</button>
          <button type="button" class="gd-preset-btn" data-modal-preset="50000">50,000z (+5 EXP)</button>
          <button type="button" class="gd-preset-btn" data-modal-preset="100000">100,000z (+10 EXP)</button>
          <button type="button" class="gd-preset-btn" data-modal-preset="300000">300,000z (+30 EXP)</button>
          <button type="button" class="gd-preset-btn" data-modal-preset="500000">500,000z (+50 EXP)</button>
          <button type="button" class="gd-preset-btn" data-modal-preset="1000000">1,000,000z (+100 EXP)</button>
          ${split.avgZenyPerChar > 0 && split.onlineCount > 1 ? `<button type="button" class="gd-preset-btn gd-preset-lv" data-modal-preset="${split.avgZenyPerChar}">⚡ เฉลี่ยอัป Lv. (${split.avgZenyPerChar.toLocaleString()}z / ${split.onlineCount} จอ)</button>` : ''}
          ${neededZeny > 0 ? `<button type="button" class="gd-preset-btn gd-preset-lv" data-modal-preset="${neededZeny}">⚡ เหมาอัป Lv. (${neededZeny.toLocaleString()}z)</button>` : ''}
          <button type="button" class="gd-preset-btn gd-preset-all ${zenyModalState.donateAll ? 'is-active' : ''}" data-modal-preset="all">🔥 บริจาคทั้งหมดในตัว</button>
        </div>

        <div class="gd-create-step-label">2. เงินสำรองเหลือติดตัวขั้นต่ำ (Keep Zeny) <span class="gd-hint-inline">(ระบบจะไม่ดึงเงินส่วนนี้ไปบริจาค)</span></div>
        <div class="gd-zeny-modal-input-wrap">
          <input type="number" id="gd-modal-zeny-keep" class="gd-create-input" min="0" step="10000" value="${zenyModalState.keepZeny}" placeholder="0">
          <span class="gd-zeny-unit">Zeny</span>
        </div>

        <div class="gd-zeny-preview-box" id="gd-modal-zeny-preview"></div>

        <div class="gd-create-footer">
          <button type="button" class="gd-btn gd-btn-ghost" id="gd-zeny-modal-cancel">ยกเลิก</button>
          <button type="button" class="gd-btn gd-btn-primary gd-btn-confirm" id="gd-zeny-modal-confirm">
            💰 ยืนยันบริจาคเงิน
          </button>
        </div>
      </div>
    `;

    overlay.hidden = false;

    const amtInput = card.querySelector('#gd-modal-zeny-keep') ? card.querySelector('#gd-modal-zeny-amount') : null;
    const keepInput = card.querySelector('#gd-modal-zeny-keep');
    const previewEl = card.querySelector('#gd-modal-zeny-preview');
    const confirmBtn = card.querySelector('#gd-zeny-modal-confirm');

    const updatePreview = () => {
      const keep = Math.max(0, Math.floor(Number(keepInput ? keepInput.value : 0) || 0));
      const spendable = Math.max(0, currentZeny - keep);
      const maxDonatable = Math.floor(spendable / 10000) * 10000;
      const reqAmt = zenyModalState.donateAll
        ? maxDonatable
        : Math.floor(Math.max(0, Number(amtInput ? amtInput.value : 0) || 0) / 10000) * 10000;
      const finalAmt = Math.min(reqAmt, maxDonatable);
      const expGain = Math.floor(finalAmt / 10000);
      const remainZeny = Math.max(0, currentZeny - finalAmt);

      card.querySelectorAll('[data-modal-preset]').forEach(b => {
        const p = b.dataset.modalPreset;
        const active = (p === 'all' && zenyModalState.donateAll) || (!zenyModalState.donateAll && Number(p) === reqAmt);
        b.classList.toggle('is-active', active);
      });

      if (finalAmt < 10000) {
        previewEl.innerHTML = `<span class="gd-preview-warn">⚠️ เงินที่บริจาคได้หลังหักเงินสำรองมีไม่ถึง 10,000 Zeny (มีให้ใช้ ${spendable.toLocaleString()}z)</span>`;
        if (confirmBtn) confirmBtn.disabled = true;
      } else {
        previewEl.innerHTML = `
          <div>จะบริจาคจริง: <b class="gd-gold-text">${finalAmt.toLocaleString()} Zeny</b> → ได้รับ <b class="gd-exp-text">+${expGain.toLocaleString()} EXP / แต้มกิลด์</b></div>
          <div class="gd-preview-sub">คงเหลือติดตัวหลังบริจาค: <b>${remainZeny.toLocaleString()} Zeny</b></div>
        `;
        if (confirmBtn) confirmBtn.disabled = false;
      }
    };

    updatePreview();

    if (amtInput && !zenyModalState.donateAll) {
      setTimeout(() => {
        amtInput.focus();
        amtInput.select();
      }, 30);
    }

    card.querySelector('#gd-picker-close')?.addEventListener('click', closePicker);
    card.querySelector('#gd-zeny-modal-cancel')?.addEventListener('click', closePicker);

    amtInput?.addEventListener('input', () => {
      zenyModalState.donateAll = false;
      zenyModalState.amount = Math.max(0, Number(amtInput.value) || 0);
      updatePreview();
    });
    keepInput?.addEventListener('input', () => {
      zenyModalState.keepZeny = Math.max(0, Number(keepInput.value) || 0);
      updatePreview();
    });

    card.querySelectorAll('[data-modal-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.modalPreset;
        if (val === 'all') {
          zenyModalState.donateAll = !zenyModalState.donateAll;
          if (amtInput) amtInput.disabled = zenyModalState.donateAll;
        } else {
          zenyModalState.donateAll = false;
          zenyModalState.amount = Number(val || 10000);
          if (amtInput) {
            amtInput.disabled = false;
            amtInput.value = String(zenyModalState.amount);
          }
        }
        updatePreview();
      });
    });

    const submitDonation = async () => {
      if (!confirmBtn || confirmBtn.disabled) return;
      const keep = Math.max(0, Math.floor(Number(keepInput ? keepInput.value : 0) || 0));
      const rawAmt = Math.max(10000, Math.floor((Number(amtInput ? amtInput.value : zenyModalState.amount) || 10000) / 10000) * 10000);
      const sendAmount = zenyModalState.donateAll ? 'all' : rawAmt;
      saveZenyCfg({ amount: rawAmt, donateAll: zenyModalState.donateAll, keepZeny: keep });
      confirmBtn.disabled = true;
      confirmBtn.textContent = '⏳ กำลังบริจาคเงิน...';
      try {
        await onDonateZenyBatch({ profileId: zenyModalState.profileId }, null, sendAmount, keep);
        closePicker();
      } catch (_) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '💰 ยืนยันบริจาคเงิน';
      }
    };

    confirmBtn?.addEventListener('click', submitDonation);
    amtInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitDonation();
      }
    });
  }

  // Modal 1: Create Guild (Step 1: Select Leader -> Step 2: Enter Guild Name -> Confirm)
  function openCreateGuildModal(preselectedLeaderId = null) {
    const candidates = lastData.availableProfiles || [];
    const selectedId = preselectedLeaderId || (candidates.length === 1 ? candidates[0].id : null);
    const selectedProfile = candidates.find(p => p.id === selectedId) || null;
    const defaultGuildName = (selectedProfile && selectedProfile.inGameGuildName) ? selectedProfile.inGameGuildName : '';

    createModalState = {
      selectedLeaderId: selectedId,
      guildName: defaultGuildName,
      autoFill: true,
      autoDonate: true
    };
    renderCreateGuildModal();
  }

  function renderCreateGuildModal() {
    if (!createModalState) return;
    const overlay = document.getElementById('gd-picker');
    const card = document.getElementById('gd-picker-card');
    if (!overlay || !card) return;

    const candidates = (lastData.availableProfiles || []).slice().sort((a, b) => (b.online - a.online));
    const selectedProfile = candidates.find(p => p.id === createModalState.selectedLeaderId) || null;

    const listHtml = candidates.length === 0
      ? `<div class="gd-picker-empty">ไม่มีโปรไฟล์ที่ว่าง (ทุกโปรไฟล์อยู่ในกิลด์อื่นแล้ว)</div>`
      : candidates.map(p => {
          const isSel = p.id === createModalState.selectedLeaderId;
          const zenyText = (p.zeny !== null && p.zeny !== undefined) ? `💰 ${Number(p.zeny).toLocaleString()}z` : '';
          const existingGuildTag = p.inGameGuildName
            ? `<span class="gd-existing-guild-tag">🏰 มีกิลด์: ${esc(p.inGameGuildName)}</span>`
            : '';
          return `
            <button type="button" class="gd-pick-item ${p.online ? 'is-online' : 'is-offline'} ${isSel ? 'is-selected' : ''}" data-pick-leader="${esc(p.id)}">
              ${avatarHtml(p)}
              <div class="gd-pick-info">
                <div class="gd-pick-name">
                  <span class="gd-online-dot ${p.online ? 'on' : 'off'}"></span>
                  ${p.charName ? esc(p.charName) : `<span class="gd-dim">${esc(p.name)}</span>`}
                  ${existingGuildTag}
                </div>
                <div class="gd-pick-sub">
                  ${esc(p.name)}
                  ${p.level ? ` · Lv.${p.level}` : ''}
                  ${p.charClass ? ` · ${esc(p.charClass)}` : ''}
                  ${zenyText ? ` · ${zenyText}` : ''}
                </div>
              </div>
              <span class="gd-pick-go">${isSel ? '✓ เลือกแล้ว' : 'เลือกหัวกิลด์'}</span>
            </button>
          `;
        }).join('');

    card.innerHTML = `
      <div class="gd-picker-head">
        <h3>👑 สร้าง / ตั้งกิลด์ใหม่</h3>
        <button type="button" class="gd-close" id="gd-picker-close">✕</button>
      </div>

      <div class="gd-create-step-label">1. เลือกตัวละครที่จะเป็น <b>หัวกิลด์ (Guild Leader)</b></div>
      <div class="gd-picker-list gd-leader-list">${listHtml}</div>

      <div class="gd-create-form">
        <div class="gd-create-step-label">2. ตั้งชื่อกิลด์ (2–16 ตัวอักษร) ${selectedProfile && selectedProfile.inGameGuildName ? `<span class="gd-hint-inline">(ตัวละครนี้มีกิลด์ "${esc(selectedProfile.inGameGuildName)}" อยู่แล้ว)</span>` : '<span class="gd-hint-inline">(สร้างกิลด์ใหม่ในเกมใช้ 10,000 Zeny)</span>'}</div>
        <input type="text" id="gd-create-name-input" class="gd-create-input" maxlength="16"
          placeholder="ใส่ชื่อกิลด์ เช่น PmheeGuild..." value="${esc(createModalState.guildName || '')}">

        <div class="gd-create-options">
          <label class="gd-create-check">
            <input type="checkbox" id="gd-create-autofill" ${createModalState.autoFill ? 'checked' : ''}>
            <span>🤖 เลือกสมาชิกกิลด์ให้ออโต้ (ดึงตัวละครที่ออนไลน์และยังไม่มีกิลด์เข้ากิลด์อัตโนมัติ)</span>
          </label>
          <label class="gd-create-check">
            <input type="checkbox" id="gd-create-autodonate" ${createModalState.autoDonate ? 'checked' : ''}>
            <span>🎁 บริจาคไอเทมรายวันออโต้ (ลูกกิลด์และหัวกิลด์บริจาครายวันทันทีที่มีของ)</span>
          </label>
        </div>

        <div class="gd-create-footer">
          <button type="button" class="gd-btn gd-btn-ghost" id="gd-create-cancel">ยกเลิก</button>
          <button type="button" class="gd-btn gd-btn-primary gd-btn-confirm" id="gd-create-confirm" ${!createModalState.selectedLeaderId ? 'disabled' : ''}>
            ✅ ตกลง (สร้างกิลด์ & ดึงสมาชิกออโต้)
          </button>
        </div>
      </div>
    `;

    overlay.hidden = false;

    card.querySelector('#gd-picker-close')?.addEventListener('click', closePicker);
    card.querySelector('#gd-create-cancel')?.addEventListener('click', closePicker);

    const nameInput = card.querySelector('#gd-create-name-input');
    const autoFillCb = card.querySelector('#gd-create-autofill');
    const autoDonateCb = card.querySelector('#gd-create-autodonate');

    nameInput?.addEventListener('input', () => {
      createModalState.guildName = nameInput.value;
    });
    autoFillCb?.addEventListener('change', () => {
      createModalState.autoFill = autoFillCb.checked;
    });
    autoDonateCb?.addEventListener('change', () => {
      createModalState.autoDonate = autoDonateCb.checked;
    });

    card.querySelectorAll('[data-pick-leader]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.pickLeader;
        createModalState.selectedLeaderId = pid;
        const prof = candidates.find(p => p.id === pid);
        if (prof && prof.inGameGuildName && !createModalState.guildName.trim()) {
          createModalState.guildName = prof.inGameGuildName;
        }
        renderCreateGuildModal();
        const inp = document.getElementById('gd-create-name-input');
        if (inp) inp.focus();
      });
    });

    card.querySelector('#gd-create-confirm')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const leaderId = createModalState.selectedLeaderId;
      const guildName = (nameInput ? nameInput.value : createModalState.guildName).trim();
      if (!leaderId) {
        if (typeof showToast === 'function') showToast('กรุณาเลือกหัวกิลด์ก่อน', true);
        return;
      }
      if (guildName.length < 2 || guildName.length > 16) {
        if (typeof showToast === 'function') showToast('กรุณาใส่ชื่อกิลด์ความยาว 2–16 ตัวอักษร', true);
        if (nameInput) nameInput.focus();
        return;
      }
      btn.disabled = true;
      btn.textContent = '⏳ กำลังสร้างกิลด์...';
      try {
        await api('POST', '/api/guilds', {
          leaderId,
          name: guildName,
          autoFill: autoFillCb ? autoFillCb.checked : true,
          autoDonate: autoDonateCb ? autoDonateCb.checked : true
        });
        closePicker();
        if (typeof showToast === 'function') showToast(`🏰 ตั้งกิลด์ "${guildName}" และเลือกสมาชิกออโต้เรียบร้อย`);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '✅ ตกลง (สร้างกิลด์ & ดึงสมาชิกออโต้)';
        if (typeof showToast === 'function') showToast(err.message, true);
      }
    });
  }

  // Modal 2: Pick an additional member or change leader
  function openMemberPickerModal(guildId, mode) {
    memberPickerState = { guildId, mode };
    const overlay = document.getElementById('gd-picker');
    const card = document.getElementById('gd-picker-card');
    if (!overlay || !card) return;

    const g = (lastData.guilds || []).find(x => x.id === guildId);
    let candidates = (lastData.availableProfiles || []).slice();
    if (mode === 'leader' && g) {
      candidates = [...g.members, ...candidates];
    }
    candidates.sort((a, b) => (b.online - a.online));

    const title = mode === 'leader' ? '👑 เปลี่ยนหัวกิลด์' : '🛡️ เลือกตัวละครเข้ากิลด์';
    const listHtml = candidates.length === 0
      ? `<div class="gd-picker-empty">ไม่มีตัวละครที่ว่างให้เลือก</div>`
      : candidates.map(p => `
          <button type="button" class="gd-pick-item ${p.online ? 'is-online' : 'is-offline'}" data-pick-profile="${esc(p.id)}">
            ${avatarHtml(p)}
            <div class="gd-pick-info">
              <div class="gd-pick-name">
                <span class="gd-online-dot ${p.online ? 'on' : 'off'}"></span>
                ${p.charName ? esc(p.charName) : `<span class="gd-dim">${esc(p.name)}</span>`}
              </div>
              <div class="gd-pick-sub">${esc(p.name)}${p.level ? ` · Lv.${p.level}` : ''}${p.charClass ? ` · ${esc(p.charClass)}` : ''}</div>
            </div>
            <span class="gd-pick-go">เลือก →</span>
          </button>
        `).join('');

    card.innerHTML = `
      <div class="gd-picker-head">
        <h3>${title}</h3>
        <button type="button" class="gd-close" id="gd-picker-close">✕</button>
      </div>
      <div class="gd-picker-list">${listHtml}</div>
    `;
    overlay.hidden = false;

    card.querySelector('#gd-picker-close')?.addEventListener('click', closePicker);
    card.querySelectorAll('[data-pick-profile]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const profileId = btn.dataset.pickProfile;
        closePicker();
        try {
          if (mode === 'leader') {
            await api('PATCH', `/api/guilds/${encodeURIComponent(guildId)}`, { leaderId: profileId });
          } else {
            await api('POST', `/api/guilds/${encodeURIComponent(guildId)}/members`, { profileId });
          }
        } catch (err) {
          if (typeof showToast === 'function') showToast(err.message, true);
        }
      });
    });
  }

  function closePicker() {
    createModalState = null;
    memberPickerState = null;
    zenyModalState = null;
    const overlay = document.getElementById('gd-picker');
    if (overlay) overlay.hidden = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountShell);
  } else {
    mountShell();
  }
})();
