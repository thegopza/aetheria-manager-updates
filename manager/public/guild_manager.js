// Left-edge slide-out Guild Manager drawer (`#gd-tab` + `#gd-drawer`).
// Works alongside `party_manager.js` (`#pt-tab`) and `premium_manager.js` (`#pm-tab`).
// Flow:
//   1. Click `+ สร้าง / ตั้งกิลด์` -> select Guild Leader (หัวกิลด์) -> enter Guild Name (ชื่อกิลด์) -> click ตกลง
//   2. Leader appears inside the Guild Card; Manager creates the guild in-game (if needed)
//   3. Auto-selects free online characters into the guild (`autoFill`) & invites/accepts them
//   4. Auto Daily Material Donation (`donateMaterial`) runs for leader & members whenever eligible.

(function () {
  const POLL_MS = 4500;
  let isOpen = false;
  let pollTimer = null;
  let lastData = { autoDonate: true, guilds: [], availableProfiles: [], allProfiles: [] };
  let createModalState = null; // { selectedLeaderId: string|null, guildName: string, autoFill: boolean, autoDonate: boolean }
  let memberPickerState = null; // { guildId: string }

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
          <button type="button" class="gd-btn gd-btn-ghost" id="gd-sync-now" title="ซิงค์กิลด์และเช็กบริจาครายวันทันที">🔄 ซิงค์ตอนนี้</button>
          <button type="button" class="gd-btn gd-btn-primary" id="gd-create-btn">+ สร้าง / ตั้งกิลด์</button>
          <button type="button" class="gd-close" id="gd-close-btn" title="ปิด">✕</button>
        </div>
      </header>
      <div class="gd-master-bar" id="gd-master-bar">
        <label class="gd-switch-label" title="เมื่อเปิด ลูกกิลด์และหัวกิลด์ทุกจอที่มีไอเทมบริจาครายวันครบจะส่งบริจาคเข้ากิลด์ให้อัตโนมัติวันละ 1 ครั้ง">
          <input type="checkbox" id="gd-global-autodonate" checked>
          <span>🎁 บริจาคไอเทมกิลด์รายวันออโต้ทุกจอ (เมื่อมีของในกระเป๋า)</span>
        </label>
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
    document.getElementById('gd-global-autodonate').addEventListener('change', async (e) => {
      await api('POST', '/api/guilds/settings', { autoDonate: e.target.checked });
    });
    document.getElementById('gd-picker').addEventListener('click', (e) => {
      if (e.target.id === 'gd-picker') closePicker();
    });

    refresh(false);
  }

  function toggleDrawer(force) {
    isOpen = typeof force === 'boolean' ? force : !isOpen;
    if (isOpen) {
      document.body.classList.remove('pt-open', 'pm-open');
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
    if (m.canDonateCount > 0) {
      return `<span class="gd-donate-badge is-ready" title="มีไอเทมพร้อมบริจาครายวันในกระเป๋า ระบบกำลังส่งบริจาค">📦 พร้อมบริจาค (${m.canDonateCount})</span>`;
    }
    if (m.online && m.inGameGuildName) {
      return `<span class="gd-donate-badge is-waiting" title="ยังไม่มีไอเทมบริจาครายวันครบตามจำนวนในกระเป๋า">⏳ รอไอเทมบริจาค</span>`;
    }
    return '';
  }

  function renderMemberRow(m, guildId, isLeader) {
    const charLabel = m.charName ? esc(m.charName) : `<span class="gd-dim">(ยังไม่เข้าเกม)</span>`;
    const subParts = [esc(m.name)];
    if (m.level) subParts.push(`Lv.${m.level}`);
    if (m.charClass) subParts.push(esc(m.charClass));
    if (isLeader && m.zeny !== null && m.zeny !== undefined) {
      subParts.push(`💰 ${Number(m.zeny).toLocaleString()}z`);
    }
    const statusText = m.lastAction ? esc(m.lastAction) : (m.online ? 'ออนไลน์' : 'ออฟไลน์');

    return `
      <div class="gd-slot ${isLeader ? 'is-leader' : 'is-member'} ${m.online ? 'is-online' : 'is-offline'}">
        ${avatarHtml(m)}
        <div class="gd-slot-info">
          <div class="gd-slot-top">
            <span class="gd-online-dot ${m.online ? 'on' : 'off'}" title="${m.online ? 'ออนไลน์ในเกม' : 'ออฟไลน์'}"></span>
            <span class="gd-char-name">${charLabel}</span>
            ${isLeader ? '<span class="gd-crown" title="หัวกิลด์">👑 หัวกิลด์</span>' : '<span class="gd-member-tag">ลูกกิลด์</span>'}
            ${renderDonationBadge(m)}
          </div>
          <div class="gd-slot-sub">${subParts.join(' · ')}</div>
          <div class="gd-slot-status">${statusText}</div>
        </div>
        <div class="gd-slot-actions">
          ${isLeader
            ? `<button type="button" class="gd-icon-btn" data-act="change-leader" data-guild="${esc(guildId)}" title="เปลี่ยนหัวกิลด์">🔄</button>`
            : `<button type="button" class="gd-icon-btn gd-danger" data-act="remove-member" data-guild="${esc(guildId)}" data-profile="${esc(m.id)}" title="เอาออกจากรายการกิลด์">✕</button>`
          }
        </div>
      </div>
    `;
  }

  function render() {
    const countEl = document.getElementById('gd-tab-count');
    const guilds = lastData.guilds || [];
    if (countEl) {
      countEl.textContent = String(guilds.length);
      countEl.classList.toggle('has-guilds', guilds.length > 0);
    }

    const globalAutoDonateEl = document.getElementById('gd-global-autodonate');
    if (globalAutoDonateEl) {
      globalAutoDonateEl.checked = lastData.autoDonate !== false;
    }

    const body = document.getElementById('gd-body');
    if (!body) return;

    if (guilds.length === 0) {
      body.innerHTML = `
        <div class="gd-empty">
          <div class="gd-empty-icon">🏰</div>
          <h3>ยังไม่ได้ตั้งค่ากิลด์</h3>
          <p>กด <b>"+ สร้าง / ตั้งกิลด์"</b> ด้านบน → เลือก<b>หัวกิลด์</b> → ตั้ง<b>ชื่อกิลด์</b> แล้วกด<b>ตกลง</b><br>
          หัวกิลด์จะเข้ามาอยู่ในกล่อง ระบบจะดึงตัวละครที่ว่างเข้ากิลด์ให้ออโต้ และบริจาคไอเทมรายวันอัตโนมัติ</p>
          <button type="button" class="gd-btn gd-btn-primary" id="gd-empty-create">+ สร้าง / ตั้งกิลด์แรก</button>
        </div>
      `;
      body.querySelector('#gd-empty-create')?.addEventListener('click', () => openCreateGuildModal());
      return;
    }

    body.innerHTML = guilds.map(g => {
      const displayName = g.inGameName || g.desiredName || g.name || 'กิลด์ใหม่';
      const lvBadge = g.guildLevel
        ? `<span class="gd-lv-badge" title="เลเวลกิลด์ในเกม (EXP ${g.guildExp || 0}/${g.guildExpToNext || 0})">Lv.${g.guildLevel} (${g.guildExp || 0}/${g.guildExpToNext || 0} EXP)</span>`
        : `<span class="gd-lv-badge is-pending" title="รอก่อตั้งกิลด์ในเกม (ใช้ 10,000 Zeny)">⏳ รอสร้างในเกม</span>`;
      const memberCountBadge = `<span class="gd-count-badge" title="จำนวนสมาชิกในกิลด์">${g.totalAssigned}/${g.maxMembers || 20} คน</span>`;
      const donateProgressBadge = `<span class="gd-donate-summary" title="จำนวนตัวละครที่บริจาครายวันแล้ววันนี้">🎁 บริจาคแล้ว ${g.donatedCount}/${g.totalAssigned}</span>`;

      const membersHtml = g.members.length > 0
        ? g.members.map(m => renderMemberRow(m, g.id, false)).join('')
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
              <button type="button" class="gd-mini-btn gd-mini-btn-gold" data-act="trigger-donate" data-guild="${esc(g.id)}" title="สั่งเช็กและบริจาคไอเทมรายวันทันที">🎁 บริจาคตอนนี้</button>
            </div>
          </div>

          <div class="gd-section-label">หัวกิลด์ (Guild Master)</div>
          ${renderMemberRow(g.leader, g.id, true)}

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

    bindCardEvents(body);
  }

  function bindCardEvents(root) {
    root.querySelectorAll('[data-act]').forEach(el => {
      const act = el.dataset.act;
      const guildId = el.dataset.guild;
      if (act === 'rename-guild') {
        el.addEventListener('change', async () => {
          const val = el.value.trim();
          if (val.length < 2 || val.length > 16) {
            if (typeof showToast === 'function') showToast('ชื่อกิลด์ต้องมีความยาว 2–16 ตัวอักษร', true);
            render();
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
          } else if (act === 'trigger-donate') {
            const res = await api('POST', `/api/guilds/${encodeURIComponent(guildId)}/donate`);
            if (typeof showToast === 'function') {
              showToast(res.donatedNow > 0 ? `🎁 สั่งบริจาครายวันเพิ่ม ${res.donatedNow} จอเรียบร้อย` : 'ℹ️ ไม่มีจอที่บริจาคเพิ่มได้ในขณะนี้ (บริจาคแล้ว หรือยังไม่มีของครบ)');
            }
          }
        } catch (err) {
          if (typeof showToast === 'function') showToast(err.message, true);
        }
      });
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
    const overlay = document.getElementById('gd-picker');
    if (overlay) overlay.hidden = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountShell);
  } else {
    mountShell();
  }
})();
