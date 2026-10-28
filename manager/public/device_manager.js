// ============================================================
// DEVICE SPOOF MANAGER UI — Right-edge slide-out drawer (`#dv-tab` + `#dv-drawer`)
// ============================================================
// - Sits on the right edge directly below Jail (`#jl-tab`), with a gear icon (`⚙️`).
// - Groups profiles into 1 Device per 3 Screens (MAX_SCREENS_PER_DEVICE = 3).
// - Shows which screens/IDs use which Device ID & Machine ID, separated by group.
// - Allows one-click Random (rotating Device ID & Machine ID) per group or for all groups.

(function () {
  const MAX_SCREENS_PER_DEVICE = 3;

  let isOpen = false;
  let cachedProfiles = [];
  let cachedGroups = [];
  let rotatingGroups = new Set();
  let rotatingAll = false;
  let justRotatedGroupSet = new Set();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function buildGroupsFromProfiles(profiles, serverGroups) {
    const list = Array.isArray(profiles)
      ? profiles
      : (typeof currentProfiles !== 'undefined' && Array.isArray(currentProfiles) ? currentProfiles : cachedProfiles);
    const byId = new Map();
    list.forEach((p, idx) => {
      if (p && p.id) byId.set(p.id, { profile: p, orderIndex: idx + 1 });
    });

    if (Array.isArray(serverGroups) && serverGroups.length > 0) {
      const built = [];
      serverGroups.forEach((g, idx) => {
        const members = (g.profileIds || [])
          .map(pid => byId.get(pid))
          .filter(Boolean);
        if (members.length > 0) {
          built.push({
            groupIndex: Number(g.groupIndex) || (idx + 1),
            deviceId: g.deviceId || (members[0].profile && members[0].profile.deviceId) || '-',
            machineId: g.machineId || (members[0].profile && members[0].profile.machineId) || '',
            maxScreens: Number(g.maxScreens) || MAX_SCREENS_PER_DEVICE,
            members
          });
        }
      });
      if (built.length > 0) return built;
    }

    const totalGroups = Math.ceil(list.length / MAX_SCREENS_PER_DEVICE);
    const groups = [];
    for (let g = 0; g < totalGroups; g++) {
      const slice = list.slice(g * MAX_SCREENS_PER_DEVICE, (g + 1) * MAX_SCREENS_PER_DEVICE);
      const members = slice.map((p, i) => ({
        profile: p,
        orderIndex: g * MAX_SCREENS_PER_DEVICE + i + 1
      }));
      const first = slice[0] || {};
      groups.push({
        groupIndex: g + 1,
        deviceId: first.deviceId || '-',
        machineId: first.machineId || '',
        maxScreens: MAX_SCREENS_PER_DEVICE,
        members
      });
    }
    return groups;
  }

  function mountShell() {
    if (document.getElementById('dv-drawer')) return;

    const tab = document.createElement('button');
    tab.id = 'dv-tab';
    tab.type = 'button';
    tab.title = 'จัดการ Device Spoof (1 Device ต่อ 3 จอ · คลิกเพื่อดูกลุ่มและสุ่มเลข Device ใหม่)';
    tab.innerHTML = `
      <span class="dv-tab-icon">⚙️</span>
      <span class="dv-tab-label">Device</span>
      <span class="dv-tab-count" id="dv-tab-count">0</span>
    `;
    tab.addEventListener('click', () => toggleDrawer());

    const backdrop = document.createElement('div');
    backdrop.id = 'dv-backdrop';
    backdrop.addEventListener('click', () => setOpen(false));

    const drawer = document.createElement('aside');
    drawer.id = 'dv-drawer';
    drawer.setAttribute('aria-label', 'จัดการ Device Spoof (1 Device ต่อ 3 จอ)');
    drawer.innerHTML = `
      <header class="dv-header">
        <div class="dv-header-title">
          <span class="dv-header-icon">⚙️</span>
          <div>
            <h2>จัดการ Device Spoof (1 Device : 3 จอ)</h2>
            <p>แบ่งกลุ่มอัตโนมัติ กลุ่มละ 3 จอ · กด Random เพื่อสุ่มเลข Device ใหม่</p>
          </div>
        </div>
        <div class="dv-header-actions">
          <button type="button" class="dv-btn dv-btn-primary" id="dv-rotate-all-btn" title="สุ่มเลข Device ID และ Machine ID ใหม่ให้ทุกกลุ่มพร้อมกัน">🎲 Random ทุกกลุ่ม</button>
          <button type="button" class="dv-btn" id="dv-close-btn" title="ปิดแถบ (Esc)">✕</button>
        </div>
      </header>

      <div class="dv-summary-bar">
        <div class="dv-summary-pills">
          <span class="dv-summary-pill">📦 กลุ่ม Device: <b id="dv-summary-groups">0</b> กลุ่ม</span>
          <span class="dv-summary-pill">🖥️ จอทั้งหมด: <b id="dv-summary-profiles">0</b> จอ</span>
          <span class="dv-summary-pill">🟢 ออนไลน์: <b id="dv-summary-online">0</b> จอ</span>
        </div>
        <span style="font-size: 10.5px; color: #94a3b8;">คลิกที่จอเพื่อเลื่อนไปหาการ์ด</span>
      </div>

      <div class="dv-body" id="dv-list-body"></div>
    `;

    document.body.appendChild(tab);
    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);

    document.getElementById('dv-close-btn').addEventListener('click', () => setOpen(false));
    document.getElementById('dv-rotate-all-btn').addEventListener('click', () => rotateAllGroups());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) setOpen(false);
    });

    const bodyObserver = new MutationObserver(() => {
      if (isOpen && (
        document.body.classList.contains('jl-open') ||
        document.body.classList.contains('pt-open') ||
        document.body.classList.contains('pm-open') ||
        document.body.classList.contains('gd-open')
      )) {
        isOpen = false;
        document.body.classList.remove('dv-open');
      }
    });
    bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  function setOpen(next) {
    isOpen = Boolean(next);
    if (isOpen) {
      document.body.classList.remove('jl-open', 'pt-open', 'pm-open', 'gd-open');
    }
    document.body.classList.toggle('dv-open', isOpen);
    if (isOpen) {
      renderDrawerList();
    }
  }

  function toggleDrawer(force) {
    setOpen(typeof force === 'boolean' ? force : !isOpen);
  }

  function scrollToProfileCard(profileId) {
    if (!profileId) return;
    setOpen(false);
    setTimeout(() => {
      const cardEl = document.getElementById(`card-${profileId}`);
      if (!cardEl) {
        if (typeof showToast === 'function') {
          showToast(`ไม่พบการ์ดของโปรไฟล์ ${profileId}`, 'warn');
        }
        return;
      }
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      cardEl.classList.remove('jail-card-focus-pulse');
      void cardEl.offsetWidth;
      cardEl.classList.add('jail-card-focus-pulse');
      setTimeout(() => {
        cardEl.classList.remove('jail-card-focus-pulse');
      }, 2600);
    }, 120);
  }

  async function rotateSingleGroup(groupIndex, event) {
    if (event) event.stopPropagation();
    const gIdx = Number(groupIndex);
    if (!gIdx || rotatingGroups.has(gIdx) || rotatingAll) return;
    rotatingGroups.add(gIdx);
    renderDrawerList();
    try {
      const res = await fetch('/api/device-groups/rotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupIndex: gIdx })
      });
      const data = await res.json();
      if (!data || !data.success) {
        throw new Error((data && data.error) || 'Rotate failed');
      }
      if (Array.isArray(data.deviceGroups)) {
        cachedGroups = data.deviceGroups;
      }
      if (data.group && Array.isArray(data.group.profileIds)) {
        const list = typeof currentProfiles !== 'undefined' && Array.isArray(currentProfiles) ? currentProfiles : cachedProfiles;
        list.forEach(p => {
          if (p && data.group.profileIds.includes(p.id)) {
            p.deviceId = data.group.deviceId;
            p.machineId = data.group.machineId;
            p.deviceGroupIndex = data.group.groupIndex;
          }
        });
      }
      justRotatedGroupSet.add(gIdx);
      setTimeout(() => {
        justRotatedGroupSet.delete(gIdx);
        if (isOpen) renderDrawerList();
      }, 2200);
      if (typeof showToast === 'function') {
        const shortDev = data.group && data.group.deviceId ? data.group.deviceId.slice(0, 8) + '...' : '';
        showToast(`🎲 สุ่มเลข Device ใหม่ให้ Group #${gIdx} เรียบร้อย (${shortDev})`, 'info');
      }
    } catch (e) {
      console.error('Failed to rotate device group:', e);
      if (typeof showToast === 'function') {
        showToast(`❌ สุ่ม Device ไม่สำเร็จ: ${e.message}`, 'error');
      }
    } finally {
      rotatingGroups.delete(gIdx);
      renderDrawerList();
    }
  }

  async function rotateAllGroups() {
    if (rotatingAll) return;
    rotatingAll = true;
    renderDrawerList();
    try {
      const res = await fetch('/api/profiles/rotate-all-device-ids', { method: 'POST' });
      const data = await res.json();
      if (!data || !data.success) {
        throw new Error((data && data.error) || 'Rotate all failed');
      }
      if (Array.isArray(data.deviceGroups)) {
        cachedGroups = data.deviceGroups;
      }
      const map = data.deviceIds || {};
      const list = typeof currentProfiles !== 'undefined' && Array.isArray(currentProfiles) ? currentProfiles : cachedProfiles;
      list.forEach(p => {
        if (p && map[p.id]) {
          p.deviceId = map[p.id];
        }
      });
      if (Array.isArray(data.groups)) {
        data.groups.forEach(g => {
          if (g && g.groupIndex) justRotatedGroupSet.add(Number(g.groupIndex));
        });
        setTimeout(() => {
          justRotatedGroupSet.clear();
          if (isOpen) renderDrawerList();
        }, 2200);
      }
      if (typeof showToast === 'function') {
        const gCount = Array.isArray(data.groups) ? data.groups.length : cachedGroups.length;
        showToast(`🎲 สุ่มเลข Device ใหม่ทั้งหมด ${gCount} กลุ่ม (กลุ่มละ 3 จอ) เรียบร้อยแล้ว`, 'info');
      }
    } catch (e) {
      console.error('Failed to rotate all device groups:', e);
      if (typeof showToast === 'function') {
        showToast(`❌ สุ่ม Device ทั้งหมดไม่สำเร็จ: ${e.message}`, 'error');
      }
    } finally {
      rotatingAll = false;
      renderDrawerList();
    }
  }

  function copyDeviceText(text, label) {
    if (!text || text === '-') return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        if (typeof showToast === 'function') {
          showToast(`📋 คัดลอก ${label}: ${text.slice(0, 18)}... แล้ว`, 'info');
        }
      }).catch(() => {});
    }
  }

  function renderDrawerList() {
    mountShell();
    const list = typeof currentProfiles !== 'undefined' && Array.isArray(currentProfiles) ? currentProfiles : cachedProfiles;
    const groups = buildGroupsFromProfiles(list, cachedGroups);
    const totalGroups = groups.length;
    const totalProfiles = list.length;
    const totalOnline = list.filter(p => p && p.isRunning).length;

    const tabCount = document.getElementById('dv-tab-count');
    const sumGroups = document.getElementById('dv-summary-groups');
    const sumProfiles = document.getElementById('dv-summary-profiles');
    const sumOnline = document.getElementById('dv-summary-online');
    const rotateAllBtn = document.getElementById('dv-rotate-all-btn');
    const bodyEl = document.getElementById('dv-list-body');

    if (tabCount) tabCount.textContent = String(totalGroups);
    if (sumGroups) sumGroups.textContent = String(totalGroups);
    if (sumProfiles) sumProfiles.textContent = String(totalProfiles);
    if (sumOnline) sumOnline.textContent = String(totalOnline);
    if (rotateAllBtn) {
      rotateAllBtn.disabled = rotatingAll || totalGroups === 0;
      rotateAllBtn.textContent = rotatingAll ? '⏳ กำลังสุ่ม...' : '🎲 Random ทุกกลุ่ม';
    }
    if (!bodyEl) return;

    if (totalGroups === 0) {
      bodyEl.innerHTML = `
        <div class="dv-empty">
          <div class="dv-empty-icon">⚙️</div>
          <div class="dv-empty-title">ยังไม่มีโปรไฟล์ในระบบ</div>
          <div class="dv-empty-sub">
            เมื่อสร้างโปรไฟล์จอเกม ระบบจะจัดกลุ่มให้อัตโนมัติ<br>
            <b>1 Device ต่อ 3 จอ</b> (ใช้ Device ID และ Machine ID เดียวกันภายในกลุ่ม)
          </div>
        </div>
      `;
      return;
    }

    bodyEl.innerHTML = groups.map(grp => {
      const gIdx = grp.groupIndex;
      const isRot = rotatingGroups.has(gIdx) || rotatingAll;
      const isJustRot = justRotatedGroupSet.has(gIdx);
      const onlineInGroup = grp.members.filter(m => m.profile && m.profile.isRunning).length;
      const devId = grp.deviceId || '-';
      const machId = grp.machineId || '';
      const shortMach = machId.length >= 20 ? `${machId.slice(0, 12)}...${machId.slice(-10)}` : (machId || '-');

      const membersHtml = grp.members.map((m, slotIdx) => {
        const p = m.profile || {};
        const state = p.isRunning ? p.liveState : null;
        const charName = (state && state.charName) || p.lastCharName || '';
        const accountId = p.account || (state && state.username) || 'ยังไม่ตั้งไอดี';
        const portrait = (typeof getPortraitSrc === 'function') ? getPortraitSrc(p, state) : '';
        const isOnline = Boolean(p.isRunning);

        return `
          <div class="dv-member-row ${isOnline ? 'is-online' : ''}" data-profile-id="${esc(p.id)}" title="คลิกเพื่อเลื่อนไปยังการ์ดของ ${esc(p.name)}">
            <div class="dv-member-left">
              <span class="dv-slot-pill">จอ ${slotIdx + 1}/${grp.maxScreens}</span>
              <div class="dv-member-avatar">
                ${portrait ? `<img src="${esc(portrait)}" alt="" onerror="this.style.display='none'">` : '🎮'}
              </div>
              <div class="dv-member-info">
                <div class="dv-member-title">
                  <span>${esc(p.name || p.id)}</span>
                  <span style="font-size:10px;color:#64748b;font-family:'JetBrains Mono',monospace;">#${m.orderIndex}</span>
                </div>
                <div class="dv-member-sub">
                  <span>🆔 <b class="dv-member-account">${esc(accountId)}</b></span>
                  ${charName ? `<span>• 👤 ${esc(charName)}</span>` : ''}
                </div>
              </div>
            </div>
            <div class="dv-member-right">
              <span class="dv-status-dot ${isOnline ? 'online' : 'offline'}">${isOnline ? '🟢 ออนไลน์' : '⚪ ออฟไลน์'}</span>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="dv-group-card ${isJustRot ? 'dv-just-rotated' : ''}" data-group-index="${gIdx}">
          <div class="dv-group-top">
            <div class="dv-group-badges">
              <span class="dv-group-title-badge">🖥️ Group #${gIdx}</span>
              <span class="dv-group-slots-badge">${grp.members.length} / ${grp.maxScreens} จอ</span>
              ${onlineInGroup > 0 ? `<span class="dv-group-online-badge">🟢 ออนไลน์ ${onlineInGroup} จอ</span>` : ''}
            </div>
            <button type="button" class="dv-random-group-btn" data-rotate-group="${gIdx}" ${isRot ? 'disabled' : ''} title="สุ่มเลข Device ID และ Machine ID ใหม่ให้จอทั้งหมดใน Group #${gIdx}">
              ${isRot ? '⏳ กำลังสุ่ม...' : '🎲 Random Device'}
            </button>
          </div>

          <div class="dv-device-box">
            <div class="dv-device-row">
              <span class="dv-device-label">🔑 Device ID:</span>
              <div class="dv-device-val-wrap">
                <code class="dv-device-code" title="${esc(devId)}">${esc(devId)}</code>
                <button type="button" class="dv-copy-btn" data-copy-dev="${esc(devId)}" title="คัดลอก Device ID">📋</button>
              </div>
            </div>
            <div class="dv-device-row">
              <span class="dv-device-label">🧬 Machine ID:</span>
              <div class="dv-device-val-wrap">
                <code class="dv-machine-code" title="${esc(machId)}">${esc(shortMach)}</code>
                ${machId ? `<button type="button" class="dv-copy-btn" data-copy-mach="${esc(machId)}" title="คัดลอก Machine ID">📋</button>` : ''}
              </div>
            </div>
          </div>

          <div class="dv-members-list">
            ${membersHtml}
          </div>
        </div>
      `;
    }).join('');

    bodyEl.querySelectorAll('[data-rotate-group]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const gIdx = btn.getAttribute('data-rotate-group');
        rotateSingleGroup(gIdx, e);
      });
    });

    bodyEl.querySelectorAll('[data-copy-dev]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyDeviceText(btn.getAttribute('data-copy-dev'), 'Device ID');
      });
    });

    bodyEl.querySelectorAll('[data-copy-mach]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyDeviceText(btn.getAttribute('data-copy-mach'), 'Machine ID');
      });
    });

    bodyEl.querySelectorAll('.dv-member-row').forEach(row => {
      row.addEventListener('click', () => {
        const pid = row.getAttribute('data-profile-id');
        scrollToProfileCard(pid);
      });
    });
  }

  function updateDeviceManagerFromProfiles(profiles, deviceGroups) {
    if (Array.isArray(profiles)) {
      cachedProfiles = profiles;
    }
    if (Array.isArray(deviceGroups)) {
      cachedGroups = deviceGroups;
    }
    mountShell();
    const list = typeof currentProfiles !== 'undefined' && Array.isArray(currentProfiles) ? currentProfiles : cachedProfiles;
    const groups = buildGroupsFromProfiles(list, cachedGroups);
    const tabCount = document.getElementById('dv-tab-count');
    if (tabCount) tabCount.textContent = String(groups.length);
    if (isOpen) {
      renderDrawerList();
    }
  }

  window.updateDeviceManagerFromProfiles = updateDeviceManagerFromProfiles;
  window.toggleDeviceDrawer = toggleDrawer;
  window.rotateDeviceGroupByIndex = rotateSingleGroup;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      mountShell();
      updateDeviceManagerFromProfiles(typeof currentProfiles !== 'undefined' ? currentProfiles : [], []);
    });
  } else {
    mountShell();
    updateDeviceManagerFromProfiles(typeof currentProfiles !== 'undefined' ? currentProfiles : [], []);
  }
})();
