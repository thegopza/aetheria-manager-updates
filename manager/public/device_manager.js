// ============================================================
// DEVICE SPOOF MANAGER UI — Right-edge slide-out drawer (`#dv-tab` + `#dv-drawer`)
// ============================================================
// - Sits on the right edge directly below Jail (`#jl-tab`), with a gear icon (`⚙️`).
// - Groups profiles first by IP block (`screensPerIp`, e.g. 1 IP = 5 จอ), and subdivides
//   each IP block into Device Spoof groups of at most 3 screens per Device (e.g. 5 จอ -> 3 + 2 จอ = 2 Device).
// - Shows which screens/IDs use which Device ID & Machine ID, separated by IP block & Device group.
// - Allows one-click Random (rotating Device ID & Machine ID) per group or for all groups.

(function () {
  const MAX_SCREENS_PER_DEVICE = 3;

  let isOpen = false;
  let cachedProfiles = [];
  let cachedGroups = [];
  let cachedScreensPerIp = 3;
  let rotatingGroups = new Set();
  let rotatingAll = false;
  let savingScreensPerIp = false;
  let justRotatedGroupSet = new Set();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function getEffectiveScreensPerIp(serverGroups) {
    if (Array.isArray(serverGroups) && serverGroups.length > 0) {
      const fromGrp = Number(serverGroups[0].screensPerIp);
      if (Number.isFinite(fromGrp) && fromGrp >= 1) {
        return Math.max(1, Math.min(20, Math.floor(fromGrp)));
      }
    }
    if (typeof currentScreenProxySettings !== 'undefined' && currentScreenProxySettings) {
      const fromProxy = Number(currentScreenProxySettings.maxScreensPerIp);
      if (Number.isFinite(fromProxy) && fromProxy >= 1) {
        return Math.max(1, Math.min(20, Math.floor(fromProxy)));
      }
    }
    return Math.max(1, Math.min(20, Number(cachedScreensPerIp) || MAX_SCREENS_PER_DEVICE));
  }

  function computeSubSizes(perIp) {
    const n = Math.max(1, Math.min(20, Number(perIp) || MAX_SCREENS_PER_DEVICE));
    const count = Math.ceil(n / MAX_SCREENS_PER_DEVICE);
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push(Math.min(MAX_SCREENS_PER_DEVICE, Math.max(1, n - i * MAX_SCREENS_PER_DEVICE)));
    }
    return out;
  }

  function buildGroupsFromProfiles(profiles, serverGroups) {
    const list = Array.isArray(profiles)
      ? profiles
      : (typeof currentProfiles !== 'undefined' && Array.isArray(currentProfiles) ? currentProfiles : cachedProfiles);
    const byId = new Map();
    list.forEach((p, idx) => {
      if (p && p.id) byId.set(p.id, { profile: p, orderIndex: idx + 1 });
    });

    const perIp = getEffectiveScreensPerIp(serverGroups);
    cachedScreensPerIp = perIp;
    const defaultSubSizes = computeSubSizes(perIp);
    const defaultDevicesPerIp = defaultSubSizes.length;

    if (Array.isArray(serverGroups) && serverGroups.length > 0) {
      const built = [];
      serverGroups.forEach((g, idx) => {
        const members = (g.profileIds || [])
          .map(pid => byId.get(pid))
          .filter(Boolean);
        if (members.length > 0) {
          const screensPerIp = Number(g.screensPerIp) || perIp;
          const subSizes = Array.isArray(g.deviceSubSizes) && g.deviceSubSizes.length > 0
            ? g.deviceSubSizes
            : computeSubSizes(screensPerIp);
          built.push({
            groupIndex: Number(g.groupIndex) || (idx + 1),
            ipIndex: Number(g.ipIndex) || (Math.floor((members[0].orderIndex - 1) / screensPerIp) + 1),
            deviceIndexInIp: Number(g.deviceIndexInIp) || 1,
            devicesPerIp: Number(g.devicesPerIp) || subSizes.length,
            screensPerIp,
            deviceSubSizes: subSizes,
            ipSlotStart: Number(g.ipSlotStart) || 1,
            proxyIp: g.proxyIp || null,
            proxyPort: g.proxyPort || null,
            deviceId: g.deviceId || (members[0].profile && members[0].profile.deviceId) || '-',
            machineId: g.machineId || (members[0].profile && members[0].profile.machineId) || '',
            maxScreens: Number(g.maxScreens) || MAX_SCREENS_PER_DEVICE,
            members
          });
        }
      });
      if (built.length > 0) return built;
    }

    const totalIpBlocks = Math.ceil(list.length / perIp);
    const groups = [];
    let globalGroupIdx = 0;

    for (let ipIdx = 0; ipIdx < totalIpBlocks; ipIdx++) {
      const ipSlice = list.slice(ipIdx * perIp, (ipIdx + 1) * perIp);
      for (let sub = 0; sub < defaultDevicesPerIp; sub++) {
        const subStart = sub * MAX_SCREENS_PER_DEVICE;
        const subEnd = Math.min(perIp, (sub + 1) * MAX_SCREENS_PER_DEVICE);
        const slice = ipSlice.slice(subStart, subEnd);
        if (slice.length === 0) break;
        globalGroupIdx++;
        const subMax = Math.min(MAX_SCREENS_PER_DEVICE, Math.max(1, perIp - subStart));
        const members = slice.map((p, i) => ({
          profile: p,
          orderIndex: ipIdx * perIp + subStart + i + 1
        }));
        const first = slice[0] || {};
        groups.push({
          groupIndex: globalGroupIdx,
          ipIndex: ipIdx + 1,
          deviceIndexInIp: sub + 1,
          devicesPerIp: defaultDevicesPerIp,
          screensPerIp: perIp,
          deviceSubSizes: defaultSubSizes,
          ipSlotStart: subStart + 1,
          proxyIp: (first.screenProxy && first.screenProxy.ip) || null,
          proxyPort: (first.screenProxy && first.screenProxy.proxyPort) || null,
          deviceId: first.deviceId || '-',
          machineId: first.machineId || '',
          maxScreens: subMax,
          members
        });
      }
    }
    return groups;
  }

  async function applyScreensPerIpFromDrawer(nextScreensPerIp) {
    const perIp = Math.max(1, Math.min(20, Number(nextScreensPerIp) || 3));
    if (savingScreensPerIp) return;
    savingScreensPerIp = true;
    cachedScreensPerIp = perIp;
    const maxInputModal = document.getElementById('sp-max-screens');
    if (maxInputModal) maxInputModal.value = String(perIp);
    if (typeof currentScreenProxySettings !== 'undefined' && currentScreenProxySettings) {
      currentScreenProxySettings.maxScreensPerIp = perIp;
    }
    renderDrawerList();
    try {
      const res = await fetch('/api/screen-proxy/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxScreensPerIp: perIp })
      }).then(r => r.json());
      if (res && res.success) {
        if (Array.isArray(res.deviceGroups)) {
          cachedGroups = res.deviceGroups;
        }
        if (res.settings && typeof window.updateScreenProxyToolbarBtn === 'function') {
          window.updateScreenProxyToolbarBtn(res.settings);
        }
        if (typeof fetchProfiles === 'function') {
          fetchProfiles();
        }
        if (typeof showToast === 'function') {
          const subSizes = computeSubSizes(perIp);
          showToast(
            `🌐 ตั้งค่า 1 IP ต่อ ${perIp} จอสำเร็จ — แบ่งเป็น ${subSizes.length} กลุ่ม · ${subSizes.length} Device (${subSizes.join(' + ')} จอ)`,
            'success'
          );
        }
      }
    } catch (e) {
      if (typeof showToast === 'function') {
        showToast(`❌ บันทึกจำนวนจอต่อ IP ไม่สำเร็จ: ${e.message}`, 'error');
      }
    } finally {
      savingScreensPerIp = false;
      renderDrawerList();
    }
  }

  function mountShell() {
    if (document.getElementById('dv-drawer')) return;

    const tab = document.createElement('button');
    tab.id = 'dv-tab';
    tab.type = 'button';
    tab.title = 'จัดการ Device Spoof & แบ่งกลุ่มตาม IP (คลิกเพื่อดูกลุ่มและสุ่มเลข Device ใหม่)';
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
    drawer.setAttribute('aria-label', 'จัดการ Device Spoof & แบ่งกลุ่มตาม IP');
    drawer.innerHTML = `
      <header class="dv-header">
        <div class="dv-header-title">
          <span class="dv-header-icon">⚙️</span>
          <div>
            <h2 id="dv-header-title-text">จัดการ Device Spoof (1 IP : 3 จอ)</h2>
            <p id="dv-header-sub-text">แบ่งกลุ่มอัตโนมัติตาม IP (ไม่เกิน 3 จอ/Device) · กด Random เพื่อสุ่มเลข Device ใหม่</p>
          </div>
        </div>
        <div class="dv-header-actions">
          <button type="button" class="dv-btn dv-btn-primary" id="dv-rotate-all-btn" title="สุ่มเลข Device ID และ Machine ID ใหม่ให้ทุกกลุ่มพร้อมกัน">🎲 Random ทุกกลุ่ม</button>
          <button type="button" class="dv-btn" id="dv-close-btn" title="ปิดแถบ (Esc)">✕</button>
        </div>
      </header>

      <div class="dv-ip-config-bar">
        <div class="dv-ip-config-left">
          <span class="dv-ip-config-lbl">🌐 1 IP ใช้กี่จอ:</span>
          <input type="number" id="dv-screens-per-ip-input" min="1" max="20" value="3" class="dv-ip-config-input" title="กำหนดจำนวนจอต่อ 1 IP (ระบบจะซอยเป็นกลุ่ม Device ละไม่เกิน 3 จอให้อัตโนมัติ)">
          <span style="font-size: 11px; color: #94a3b8;">จอ</span>
          <div class="dv-ip-preset-group">
            <button type="button" class="dv-ip-preset-btn" data-dv-per-ip="3" title="1 IP = 3 จอ (1 Device: 3 จอ)">3</button>
            <button type="button" class="dv-ip-preset-btn" data-dv-per-ip="4" title="1 IP = 4 จอ (2 Device: 3 + 1 จอ)">4</button>
            <button type="button" class="dv-ip-preset-btn" data-dv-per-ip="5" title="1 IP = 5 จอ (2 Device: 3 + 2 จอ)">5</button>
            <button type="button" class="dv-ip-preset-btn" data-dv-per-ip="6" title="1 IP = 6 จอ (2 Device: 3 + 3 จอ)">6</button>
          </div>
        </div>
        <button type="button" class="dv-open-proxy-btn" id="dv-open-proxy-modal-btn" title="เปิดหน้าต่างตั้งค่า Proxy แยก IP รายจอ">
          🛡️ ตั้งค่า Proxy IP
        </button>
      </div>
      <div class="dv-ip-split-banner" id="dv-ip-split-banner">
        ⚙️ 1 IP (3 จอ) ➜ แบ่งเป็น <b>1 กลุ่ม · 1 Device</b> (3 จอ)
      </div>

      <div class="dv-summary-bar">
        <div class="dv-summary-pills">
          <span class="dv-summary-pill">🌐 บล็อก IP: <b id="dv-summary-ips">0</b> IP</span>
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

    const perIpInput = document.getElementById('dv-screens-per-ip-input');
    if (perIpInput) {
      perIpInput.addEventListener('change', () => {
        applyScreensPerIpFromDrawer(perIpInput.value);
      });
    }
    drawer.querySelectorAll('[data-dv-per-ip]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = Number(btn.getAttribute('data-dv-per-ip')) || 3;
        if (perIpInput) perIpInput.value = String(val);
        applyScreensPerIpFromDrawer(val);
      });
    });

    const openProxyBtn = document.getElementById('dv-open-proxy-modal-btn');
    if (openProxyBtn) {
      openProxyBtn.addEventListener('click', () => {
        setOpen(false);
        if (typeof window.openScreenProxyModal === 'function') {
          window.openScreenProxyModal();
        }
      });
    }

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
      renderDrawerList(true);
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
        showToast(`🎲 สุ่มเลข Device ใหม่ทั้งหมด ${gCount} กลุ่มเรียบร้อยแล้ว`, 'info');
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

  function renderDrawerList(force = true) {
    mountShell();
    const list = typeof currentProfiles !== 'undefined' && Array.isArray(currentProfiles) ? currentProfiles : cachedProfiles;
    const groups = buildGroupsFromProfiles(list, cachedGroups);
    const perIp = getEffectiveScreensPerIp(cachedGroups);
    const subSizes = computeSubSizes(perIp);
    const splitText = subSizes.map(n => `${n} จอ`).join(' + ');

    const totalGroups = groups.length;
    const totalProfiles = list.length;
    const totalOnline = list.filter(p => p && p.isRunning).length;
    const totalIps = Math.ceil(totalProfiles / perIp);

    const tabCount = document.getElementById('dv-tab-count');
    const sumIps = document.getElementById('dv-summary-ips');
    const sumGroups = document.getElementById('dv-summary-groups');
    const sumProfiles = document.getElementById('dv-summary-profiles');
    const sumOnline = document.getElementById('dv-summary-online');
    const rotateAllBtn = document.getElementById('dv-rotate-all-btn');
    const headerTitleEl = document.getElementById('dv-header-title-text');
    const headerSubEl = document.getElementById('dv-header-sub-text');
    const perIpInput = document.getElementById('dv-screens-per-ip-input');
    const splitBannerEl = document.getElementById('dv-ip-split-banner');
    const bodyEl = document.getElementById('dv-list-body');

    if (tabCount) tabCount.textContent = String(totalGroups);
    if (sumIps) sumIps.textContent = String(totalIps);
    if (sumGroups) sumGroups.textContent = String(totalGroups);
    if (sumProfiles) sumProfiles.textContent = String(totalProfiles);
    if (sumOnline) sumOnline.textContent = String(totalOnline);

    if (headerTitleEl) {
      headerTitleEl.textContent = subSizes.length > 1
        ? `จัดการ Device Spoof (1 IP : ${perIp} จอ · ${subSizes.length} Device)`
        : `จัดการ Device Spoof (1 IP : ${perIp} จอ · 1 Device)`;
    }
    if (headerSubEl) {
      headerSubEl.textContent = subSizes.length > 1
        ? `1 IP (${perIp} จอ) แบ่งเป็น ${subSizes.length} กลุ่ม · ${subSizes.length} Device (${splitText}) · กด Random เพื่อสุ่มเลขใหม่`
        : `แบ่งกลุ่มอัตโนมัติ กลุ่มละ ${perIp} จอ (1 IP : 1 Device) · กด Random เพื่อสุ่มเลข Device ใหม่`;
    }
    if (perIpInput && document.activeElement !== perIpInput) {
      perIpInput.value = String(perIp);
    }
    document.querySelectorAll('[data-dv-per-ip]').forEach(btn => {
      const val = Number(btn.getAttribute('data-dv-per-ip'));
      btn.classList.toggle('active', val === perIp);
    });
    if (splitBannerEl) {
      const pills = subSizes.map((sz, i) => `<span class="dv-split-chip">🖥️ Device ${i + 1}: <b>${sz} จอ</b></span>`).join(' <span style="color:#64748b;">+</span> ');
      splitBannerEl.innerHTML = `
        <span>⚙️ <b>สูตรแบ่งต่อ 1 IP:</b> 1 IP (<b>${perIp} จอ</b>) = <b style="color:#fde047;">${subSizes.length} กลุ่ม · ${subSizes.length} Device</b></span>
        <span class="dv-split-chips-wrap">${pills}</span>
      `;
    }

    if (rotateAllBtn) {
      rotateAllBtn.disabled = rotatingAll || totalGroups === 0;
      rotateAllBtn.textContent = rotatingAll ? '⏳ กำลังสุ่ม...' : '🎲 Random ทุกกลุ่ม';
    }
    if (!bodyEl) return;
    if (!force && window.PmUiGuard && window.PmUiGuard.deferIfInteracting('dv-list-body', bodyEl, () => renderDrawerList(false))) {
      return;
    }

    if (totalGroups === 0) {
      const emptyHtml = `
        <div class="dv-empty">
          <div class="dv-empty-icon">⚙️</div>
          <div class="dv-empty-title">ยังไม่มีโปรไฟล์ในระบบ</div>
          <div class="dv-empty-sub">
            เมื่อสร้างโปรไฟล์จอเกม ระบบจะจัดกลุ่มให้อัตโนมัติ<br>
            <b>1 IP ต่อ ${perIp} จอ</b> แบ่งเป็น <b>${subSizes.length} Device (${splitText})</b>
          </div>
        </div>
      `;
      if (window.PmUiGuard) window.PmUiGuard.setHtmlIfChanged(bodyEl, emptyHtml);
      else bodyEl.innerHTML = emptyHtml;
      return;
    }

    // Group Device groups by IP block (`ipIndex`)
    const ipBlocksMap = new Map();
    groups.forEach(grp => {
      const ipIdx = grp.ipIndex || 1;
      if (!ipBlocksMap.has(ipIdx)) {
        ipBlocksMap.set(ipIdx, []);
      }
      ipBlocksMap.get(ipIdx).push(grp);
    });

    const ipBlocksHtml = Array.from(ipBlocksMap.entries()).map(([ipIdx, ipGroups]) => {
      const firstGrp = ipGroups[0];
      const ipScreensCount = ipGroups.reduce((sum, g) => sum + g.members.length, 0);
      const ipOnlineCount = ipGroups.reduce((sum, g) => sum + g.members.filter(m => m.profile && m.profile.isRunning).length, 0);
      const ipSubSizes = ipGroups.map(g => g.maxScreens);
      const ipSplitLabel = ipGroups.length > 1
        ? `แบ่ง ${ipGroups.length} กลุ่ม · ${ipGroups.length} Device (${ipSubSizes.join(' + ')} จอ)`
        : `1 กลุ่ม · 1 Device (${firstGrp.maxScreens} จอ)`;

      // Determine active or configured Proxy IP for this block
      let activeProxyIp = firstGrp.proxyIp || null;
      for (const g of ipGroups) {
        for (const m of g.members) {
          if (m.profile && m.profile.screenProxy && m.profile.screenProxy.active && m.profile.screenProxy.ip) {
            activeProxyIp = m.profile.screenProxy.ip;
            break;
          }
        }
      }

      const subGroupsHtml = ipGroups.map(grp => {
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
          const ipSlotNo = (grp.ipSlotStart || 1) + slotIdx;

          return `
            <div class="dv-member-row ${isOnline ? 'is-online' : ''}" data-profile-id="${esc(p.id)}" title="คลิกเพื่อเลื่อนไปยังการ์ดของ ${esc(p.name)}">
              <div class="dv-member-left">
                <div class="dv-slot-pills-col">
                  <span class="dv-slot-pill" title="ลำดับจอใน Device นี้">จอ ${slotIdx + 1}/${grp.maxScreens}</span>
                  ${grp.screensPerIp > MAX_SCREENS_PER_DEVICE ? `<span class="dv-ip-slot-pill" title="ลำดับจอใน IP #${ipIdx}">IP ${ipSlotNo}/${grp.screensPerIp}</span>` : ''}
                </div>
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
                <span class="dv-group-subdevice-badge">Device ${grp.deviceIndexInIp}/${grp.devicesPerIp}</span>
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

      return `
        <section class="dv-ip-block">
          <div class="dv-ip-block-header">
            <div class="dv-ip-block-left">
              <span class="dv-ip-badge">🌐 IP #${ipIdx}</span>
              <span class="dv-ip-screens-badge">${ipScreensCount} / ${firstGrp.screensPerIp} จอ</span>
              <span class="dv-ip-split-badge">${esc(ipSplitLabel)}</span>
            </div>
            <div class="dv-ip-block-right">
              ${activeProxyIp ? `<span class="dv-ip-addr-pill" title="Proxy IP ของกลุ่มนี้">🛡️ ${esc(activeProxyIp)}</span>` : ''}
              ${ipOnlineCount > 0 ? `<span class="dv-group-online-badge">🟢 ${ipOnlineCount} จอ</span>` : ''}
            </div>
          </div>
          <div class="dv-ip-block-groups">
            ${subGroupsHtml}
          </div>
        </section>
      `;
    }).join('');

    const changed = window.PmUiGuard ? window.PmUiGuard.setHtmlIfChanged(bodyEl, ipBlocksHtml) : (bodyEl.innerHTML = ipBlocksHtml, true);
    if (!changed) return;

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

  function updateDeviceManagerFromProfiles(profiles, deviceGroups, screensPerIp) {
    if (Array.isArray(profiles)) {
      cachedProfiles = profiles;
    }
    if (Array.isArray(deviceGroups)) {
      cachedGroups = deviceGroups;
    }
    if (Number.isFinite(Number(screensPerIp)) && Number(screensPerIp) >= 1) {
      cachedScreensPerIp = Math.max(1, Math.min(20, Math.floor(Number(screensPerIp))));
    }
    mountShell();
    const list = typeof currentProfiles !== 'undefined' && Array.isArray(currentProfiles) ? currentProfiles : cachedProfiles;
    const groups = buildGroupsFromProfiles(list, cachedGroups);
    const tabCount = document.getElementById('dv-tab-count');
    if (tabCount) tabCount.textContent = String(groups.length);
    if (isOpen) {
      renderDrawerList(false);
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
