// ============================================================
// DEVICE SPOOF MANAGER UI — Right-edge slide-out drawer (`#dv-tab` + `#dv-drawer`)
// ============================================================
// - Sits on the right edge directly below Jail (`#jl-tab`), with a gear icon (`⚙️`).
// - Tab 1 ("จัดกลุ่มอัตโนมัติ"): Groups unisolated profiles by IP block (`screensPerIp`, default 6),
//   subdivides each IP block into Device Spoof groups of at most 3 screens per Device,
//   and shows tiered merit surcharge rate relative to baseline (1 IP : 6 จอ = +0%).
// - Tab 2 ("แยก IP / Device พิเศษ"): Lets users create dedicated Custom IP Groups
//   (reserving 1 Proxy IP upfront), create flexible Custom Device Groups inside each IP
//   (e.g. 1 IP -> 2 Device Groups of 1 Client each), assign/remove specific clients,
//   and rotate Device/Machine IDs independently.

(function () {
  const MAX_SCREENS_PER_DEVICE = 3;
  const DEFAULT_SURCHARGE_CFG = {
    enabled: true,
    baseline: 6,
    tiers: { '6': 0, '5': 5, '4': 10, '3': 15, '2': 20, '1': 25 },
    customExtraPct: 0
  };

  let isOpen = false;
  let activeTab = 'auto'; // 'auto' | 'custom'
  let cachedProfiles = [];
  let cachedGroups = [];
  let cachedScreensPerIp = 6;
  let cachedCustomConfig = { ipGroups: [] };
  let cachedCustomLeases = [];
  let cachedSurchargeConfig = JSON.parse(JSON.stringify(DEFAULT_SURCHARGE_CFG));

  let rotatingGroups = new Set();
  let rotatingCustomDevices = new Set();
  let rotatingAll = false;
  let savingScreensPerIp = false;
  let customMutating = false;
  let justRotatedGroupSet = new Set();

  let pickerState = null; // { ipGroupId, deviceGroupId, ipGroupName, deviceGroupName, search, initialIds: Set, selected: Set }
  let editingTitleState = null; // { kind: 'ip'|'device', ipGroupId, deviceGroupId, value }
  let pendingDeleteState = null; // { kind: 'ip'|'device', ipGroupId, deviceGroupId, label }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function mergeSurchargeConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    cachedSurchargeConfig = {
      ...DEFAULT_SURCHARGE_CFG,
      ...cfg,
      tiers: {
        ...DEFAULT_SURCHARGE_CFG.tiers,
        ...(cfg.tiers || {})
      }
    };
  }

  function computeSurchargePctForShare(shareCount, isCustom = false) {
    const cfg = cachedSurchargeConfig || DEFAULT_SURCHARGE_CFG;
    if (cfg.enabled === false) return 0;
    const base = Math.max(1, Math.min(20, Math.floor(Number(cfg.baseline) || 6)));
    const n = Math.max(1, Math.min(20, Math.floor(Number(shareCount) || base)));
    let pct = 0;
    if (n < base) {
      const tierVal = Number(cfg.tiers && cfg.tiers[String(n)]);
      pct = Number.isFinite(tierVal) ? Math.max(0, tierVal) : 0;
    }
    if (isCustom && Number(cfg.customExtraPct) > 0) {
      pct += Number(cfg.customExtraPct);
    }
    return Math.min(500, Math.max(0, Math.round(pct * 100) / 100));
  }

  function formatSurchargeTag(pct, shareCount) {
    if (!pct || pct <= 0) {
      return `เรทปกติ +0% (1:${shareCount})`;
    }
    return `ส่วนบุญ +${pct}% (1:${shareCount})`;
  }

  function getCustomAssignedMap() {
    const map = new Map();
    const groups = Array.isArray(cachedCustomConfig?.ipGroups) ? cachedCustomConfig.ipGroups : [];
    for (const ig of groups) {
      const dgs = Array.isArray(ig.deviceGroups) ? ig.deviceGroups : [];
      for (const dg of dgs) {
        const pids = Array.isArray(dg.profileIds) ? dg.profileIds : [];
        for (const pid of pids) {
          map.set(pid, { ig, dg });
        }
      }
    }
    return map;
  }

  function getCustomLeaseMap() {
    const map = new Map();
    if (Array.isArray(cachedCustomLeases)) {
      for (const l of cachedCustomLeases) {
        if (l && (l.id || l.ipGroupId)) {
          map.set(String(l.id || l.ipGroupId), l);
        }
      }
    }
    return map;
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
    return Math.max(1, Math.min(20, Number(cachedScreensPerIp) || 6));
  }

  function computeSubSizes(perIp) {
    const n = Math.max(1, Math.min(20, Number(perIp) || 6));
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
    const customMap = getCustomAssignedMap();
    const byId = new Map();
    const autoList = [];
    list.forEach((p, idx) => {
      if (p && p.id) {
        byId.set(p.id, { profile: p, orderIndex: idx + 1 });
        if (!customMap.has(p.id)) {
          autoList.push({ profile: p, orderIndex: idx + 1 });
        }
      }
    });

    const perIp = getEffectiveScreensPerIp(serverGroups);
    cachedScreensPerIp = perIp;
    const defaultSubSizes = computeSubSizes(perIp);
    const defaultDevicesPerIp = defaultSubSizes.length;

    if (Array.isArray(serverGroups) && serverGroups.length > 0) {
      const built = [];
      serverGroups.forEach((g, idx) => {
        const members = (g.profileIds || [])
          .filter(pid => !customMap.has(pid))
          .map(pid => byId.get(pid))
          .filter(Boolean);
        if (members.length > 0) {
          const screensPerIp = Number(g.screensPerIp) || perIp;
          const subSizes = Array.isArray(g.deviceSubSizes) && g.deviceSubSizes.length > 0
            ? g.deviceSubSizes
            : computeSubSizes(screensPerIp);
          built.push({
            groupIndex: Number(g.groupIndex) || (idx + 1),
            ipIndex: Number(g.ipIndex) || (Math.floor(idx / Math.max(1, defaultDevicesPerIp)) + 1),
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
      // If all profiles moved into Custom IP groups, serverGroups matching autoList may genuinely be empty
      if (autoList.length === 0) return [];
    }

    const totalIpBlocks = Math.ceil(autoList.length / perIp);
    const groups = [];
    let globalGroupIdx = 0;

    for (let ipIdx = 0; ipIdx < totalIpBlocks; ipIdx++) {
      const ipSlice = autoList.slice(ipIdx * perIp, (ipIdx + 1) * perIp);
      for (let sub = 0; sub < defaultDevicesPerIp; sub++) {
        const subStart = sub * MAX_SCREENS_PER_DEVICE;
        const subEnd = Math.min(perIp, (sub + 1) * MAX_SCREENS_PER_DEVICE);
        const slice = ipSlice.slice(subStart, subEnd);
        if (slice.length === 0) break;
        globalGroupIdx++;
        const subMax = Math.min(MAX_SCREENS_PER_DEVICE, Math.max(1, perIp - subStart));
        const members = slice;
        const first = (slice[0] && slice[0].profile) || {};
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

  async function refreshCustomIpDevices(refreshReserve = false) {
    try {
      const q = refreshReserve ? '?refresh=1' : '';
      const res = await fetch(`/api/custom-ip-devices${q}`).then(r => r.json());
      if (res && res.success) {
        if (res.customIpConfig) cachedCustomConfig = res.customIpConfig;
        if (Array.isArray(res.customGroupLeases)) cachedCustomLeases = res.customGroupLeases;
        if (res.surchargeConfig) mergeSurchargeConfig(res.surchargeConfig);
        if (Array.isArray(res.deviceGroups)) cachedGroups = res.deviceGroups;
        if (Number.isFinite(Number(res.screensPerIp)) && Number(res.screensPerIp) >= 1) {
          cachedScreensPerIp = Number(res.screensPerIp);
        }
        renderDrawerList(true);
      }
    } catch (_) {}
  }

  async function mutateCustomApi(payload, successToast) {
    if (customMutating) return null;
    customMutating = true;
    renderDrawerList(true);
    try {
      const res = await fetch('/api/custom-ip-devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      }).then(r => r.json());
      if (!res || !res.success) {
        throw new Error((res && res.error) || 'ดำเนินการไม่สำเร็จ');
      }
      if (res.customIpConfig) cachedCustomConfig = res.customIpConfig;
      if (Array.isArray(res.customGroupLeases)) cachedCustomLeases = res.customGroupLeases;
      if (res.surchargeConfig) mergeSurchargeConfig(res.surchargeConfig);
      if (Array.isArray(res.deviceGroups)) cachedGroups = res.deviceGroups;
      if (typeof fetchProfiles === 'function') {
        fetchProfiles();
      }
      if (successToast && typeof showToast === 'function') {
        showToast(successToast, 'success');
      }
      return res;
    } catch (e) {
      if (typeof showToast === 'function') {
        showToast(`❌ ${e.message}`, 'error');
      }
      return null;
    } finally {
      customMutating = false;
      renderDrawerList(true);
    }
  }

  async function applyScreensPerIpFromDrawer(nextScreensPerIp) {
    const perIp = Math.max(1, Math.min(20, Number(nextScreensPerIp) || 6));
    if (savingScreensPerIp) return;
    savingScreensPerIp = true;
    cachedScreensPerIp = perIp;
    const maxInputModal = document.getElementById('sp-max-screens');
    if (maxInputModal) maxInputModal.value = String(perIp);
    if (typeof currentScreenProxySettings !== 'undefined' && currentScreenProxySettings) {
      currentScreenProxySettings.maxScreensPerIp = perIp;
    }
    renderDrawerList(true);
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
        if (res.customIpConfig) {
          cachedCustomConfig = res.customIpConfig;
        }
        if (Array.isArray(res.customGroupLeases)) {
          cachedCustomLeases = res.customGroupLeases;
        }
        if (res.surchargeConfig) {
          mergeSurchargeConfig(res.surchargeConfig);
        }
        if (res.settings && typeof window.updateScreenProxyToolbarBtn === 'function') {
          window.updateScreenProxyToolbarBtn(res.settings);
        }
        if (typeof fetchProfiles === 'function') {
          fetchProfiles();
        }
        if (typeof showToast === 'function') {
          const subSizes = computeSubSizes(perIp);
          const pct = computeSurchargePctForShare(perIp, false);
          const pctMsg = pct > 0 ? ` · อัตราส่วนบุญ +${pct}%` : ' · อัตรามาตรฐาน +0%';
          showToast(
            `🌐 ตั้งค่า 1 IP ต่อ ${perIp} จอสำเร็จ — แบ่งเป็น ${subSizes.length} Device (${subSizes.join(' + ')} จอ)${pctMsg}`,
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
      renderDrawerList(true);
    }
  }

  function mountShell() {
    if (document.getElementById('dv-drawer')) return;

    const tab = document.createElement('button');
    tab.id = 'dv-tab';
    tab.type = 'button';
    tab.title = 'จัดการ Device Spoof & แยก IP/Device พิเศษ (คลิกเพื่อดูและตั้งค่า)';
    tab.innerHTML = `
      <span class="dv-tab-icon">⚙️</span>
      <span class="dv-tab-label">Device</span>
      <span class="dv-tab-count" id="dv-tab-count">0</span>
    `;
    tab.addEventListener('click', () => toggleDrawer());

    const backdrop = document.createElement('div');
    backdrop.id = 'dv-backdrop';
    backdrop.addEventListener('click', () => {
      if (pickerState) {
        pickerState = null;
        renderPickerModal();
        return;
      }
      setOpen(false);
    });

    const drawer = document.createElement('aside');
    drawer.id = 'dv-drawer';
    drawer.setAttribute('aria-label', 'จัดการ Device Spoof & แยก IP พิเศษ');
    drawer.innerHTML = `
      <header class="dv-header">
        <div class="dv-header-title">
          <span class="dv-header-icon">⚙️</span>
          <div>
            <h2 id="dv-header-title-text">จัดการ Device Spoof (1 IP : 6 จอ)</h2>
            <p id="dv-header-sub-text">จัดกลุ่มอัตโนมัติ หรือแยก IP/Device พิเศษเฉพาะจอที่ต้องการ</p>
          </div>
        </div>
        <div class="dv-header-actions">
          <button type="button" class="dv-btn dv-btn-primary" id="dv-rotate-all-btn" title="สุ่มเลข Device ID และ Machine ID ใหม่ให้ทุกกลุ่มอัตโนมัติพร้อมกัน">🎲 Random ทุกกลุ่ม</button>
          <button type="button" class="dv-btn" id="dv-close-btn" title="ปิดแถบ (Esc)">✕</button>
        </div>
      </header>

      <div class="dv-mode-tabs" role="tablist">
        <button type="button" class="dv-mode-tab active" id="dv-mode-tab-auto" data-dv-tab="auto" role="tab">
          <span>📦 จัดกลุ่มอัตโนมัติ</span>
          <span class="dv-mode-badge" id="dv-mode-badge-auto">0 จอ</span>
        </button>
        <button type="button" class="dv-mode-tab" id="dv-mode-tab-custom" data-dv-tab="custom" role="tab">
          <span>🎯 แยก IP / Device พิเศษ</span>
          <span class="dv-mode-badge" id="dv-mode-badge-custom">0 วง</span>
        </button>
      </div>

      <div id="dv-auto-controls-wrap">
        <div class="dv-ip-config-bar">
          <div class="dv-ip-config-left">
            <span class="dv-ip-config-lbl">🌐 1 IP ใช้กี่จอ:</span>
            <input type="number" id="dv-screens-per-ip-input" min="1" max="20" value="6" class="dv-ip-config-input" title="กำหนดจำนวนจอต่อ 1 IP (มาตรฐาน 1:6 ไม่บวกเพิ่ม)">
            <span style="font-size: 11px; color: #94a3b8;">จอ</span>
            <div class="dv-ip-preset-group" id="dv-ip-preset-group">
              <button type="button" class="dv-ip-preset-btn" data-dv-per-ip="1" title="1 IP = 1 จอ">1</button>
              <button type="button" class="dv-ip-preset-btn" data-dv-per-ip="2" title="1 IP = 2 จอ">2</button>
              <button type="button" class="dv-ip-preset-btn" data-dv-per-ip="3" title="1 IP = 3 จอ">3</button>
              <button type="button" class="dv-ip-preset-btn" data-dv-per-ip="4" title="1 IP = 4 จอ">4</button>
              <button type="button" class="dv-ip-preset-btn" data-dv-per-ip="5" title="1 IP = 5 จอ">5</button>
              <button type="button" class="dv-ip-preset-btn" data-dv-per-ip="6" title="1 IP = 6 จอ (มาตรฐาน +0%)">6</button>
            </div>
            <span class="dv-surcharge-hint is-std" id="dv-auto-surcharge-hint">+0% มาตรฐาน</span>
          </div>
          <button type="button" class="dv-open-proxy-btn" id="dv-open-proxy-modal-btn" title="เปิดหน้าต่างตั้งค่า Proxy แยก IP รายจอ">
            🛡️ ตั้งค่า Proxy IP
          </button>
        </div>
        <div class="dv-ip-split-banner" id="dv-ip-split-banner">
          ⚙️ 1 IP (6 จอ) ➜ แบ่งเป็น <b>2 กลุ่ม · 2 Device</b> (3 + 3 จอ)
        </div>

        <div class="dv-summary-bar">
          <div class="dv-summary-pills">
            <span class="dv-summary-pill">🌐 บล็อก IP: <b id="dv-summary-ips">0</b> IP</span>
            <span class="dv-summary-pill">📦 กลุ่ม Device: <b id="dv-summary-groups">0</b> กลุ่ม</span>
            <span class="dv-summary-pill">🖥️ จออัตโนมัติ: <b id="dv-summary-profiles">0</b> จอ</span>
            <span class="dv-summary-pill">🟢 ออนไลน์: <b id="dv-summary-online">0</b> จอ</span>
          </div>
          <span style="font-size: 10.5px; color: #94a3b8;">คลิกที่จอเพื่อเลื่อนไปหาการ์ด</span>
        </div>
      </div>

      <div class="dv-body" id="dv-list-body"></div>
      <div id="dv-picker-host"></div>
    `;

    document.body.appendChild(tab);
    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);

    document.getElementById('dv-close-btn').addEventListener('click', () => setOpen(false));
    document.getElementById('dv-rotate-all-btn').addEventListener('click', () => rotateAllGroups());

    drawer.querySelectorAll('[data-dv-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const nextTab = btn.getAttribute('data-dv-tab') === 'custom' ? 'custom' : 'auto';
        if (activeTab !== nextTab) {
          activeTab = nextTab;
          editingTitleState = null;
          pendingDeleteState = null;
          renderDrawerList(true);
          if (activeTab === 'custom') refreshCustomIpDevices(true);
        }
      });
    });

    const perIpInput = document.getElementById('dv-screens-per-ip-input');
    if (perIpInput) {
      perIpInput.addEventListener('change', () => {
        applyScreensPerIpFromDrawer(perIpInput.value);
      });
    }
    drawer.querySelectorAll('[data-dv-per-ip]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = Number(btn.getAttribute('data-dv-per-ip')) || 6;
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
      if (e.key === 'Escape' && isOpen) {
        if (pickerState) {
          pickerState = null;
          renderPickerModal();
        } else {
          setOpen(false);
        }
      }
    });

    const bodyObserver = new MutationObserver(() => {
      if (isOpen && (
        document.body.classList.contains('jl-open') ||
        document.body.classList.contains('pt-open') ||
        document.body.classList.contains('pm-open') ||
        document.body.classList.contains('gd-open')
      )) {
        isOpen = false;
        pickerState = null;
        document.body.classList.remove('dv-open');
      }
    });
    bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  function setOpen(next) {
    isOpen = Boolean(next);
    if (isOpen) {
      document.body.classList.remove('jl-open', 'pt-open', 'pm-open', 'gd-open');
    } else {
      pickerState = null;
      editingTitleState = null;
      pendingDeleteState = null;
    }
    document.body.classList.toggle('dv-open', isOpen);
    if (isOpen) {
      renderDrawerList(true);
      refreshCustomIpDevices(activeTab === 'custom');
    }
  }

  function toggleDrawer(force) {
    setOpen(typeof force === 'boolean' ? force : !isOpen);
  }

  function openDeviceDrawerTab(tabName) {
    activeTab = tabName === 'custom' ? 'custom' : 'auto';
    editingTitleState = null;
    pendingDeleteState = null;
    setOpen(true);
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

  function renderPickerListOnly() {
    const listEl = document.getElementById('dv-picker-list');
    const countEl = document.getElementById('dv-picker-selected-count');
    if (!pickerState) return;
    if (countEl) countEl.textContent = String(pickerState.selected.size);
    if (!listEl) return;

    const list = typeof currentProfiles !== 'undefined' && Array.isArray(currentProfiles) ? currentProfiles : cachedProfiles;
    const customMap = getCustomAssignedMap();
    const q = String(pickerState.search || '').trim().toLowerCase();

    const filtered = list.filter(p => {
      if (!p || !p.id) return false;
      if (!q) return true;
      const state = p.isRunning ? p.liveState : null;
      const charName = (state && state.charName) || p.lastCharName || '';
      const accountId = p.account || (state && state.username) || '';
      const hay = `${p.name || ''} ${p.id} ${accountId} ${charName}`.toLowerCase();
      return hay.includes(q);
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="dv-custom-empty-dev">ไม่พบโปรไฟล์ที่ตรงกับ "${esc(pickerState.search)}"</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(p => {
      const checked = pickerState.selected.has(p.id);
      const state = p.isRunning ? p.liveState : null;
      const charName = (state && state.charName) || p.lastCharName || '';
      const accountId = p.account || (state && state.username) || 'ยังไม่ตั้งไอดี';
      const curAssign = customMap.get(p.id);
      let tagHtml = `<span class="dv-picker-tag is-auto">อัตโนมัติ</span>`;
      if (curAssign) {
        if (curAssign.dg.id === pickerState.deviceGroupId) {
          tagHtml = `<span class="dv-picker-tag is-here">อยู่ใน Device นี้แล้ว</span>`;
        } else {
          tagHtml = `<span class="dv-picker-tag is-other-custom" title="หากเลือก จะย้ายมาจาก ${esc(curAssign.ig.name)} · ${esc(curAssign.dg.name)}">ย้ายจาก ${esc(curAssign.ig.name)}</span>`;
        }
      }
      return `
        <label class="dv-picker-item ${checked ? 'is-selected' : ''}" data-picker-pid="${esc(p.id)}">
          <div class="dv-picker-item-left">
            <input type="checkbox" class="dv-picker-chk" data-picker-pid="${esc(p.id)}" ${checked ? 'checked' : ''}>
            <div style="min-width:0;">
              <div style="font-size:12px;font-weight:700;color:#f8fafc;">${esc(p.name || p.id)} ${p.isRunning ? '<span style="color:#34d399;font-size:10px;">● ออนไลน์</span>' : ''}</div>
              <div style="font-size:10.5px;color:#94a3b8;">🆔 ${esc(accountId)}${charName ? ` · 👤 ${esc(charName)}` : ''}</div>
            </div>
          </div>
          ${tagHtml}
        </label>
      `;
    }).join('');

    listEl.querySelectorAll('.dv-picker-chk').forEach(chk => {
      chk.addEventListener('change', () => {
        const pid = chk.getAttribute('data-picker-pid');
        if (!pid || !pickerState) return;
        if (chk.checked) pickerState.selected.add(pid);
        else pickerState.selected.delete(pid);
        const row = chk.closest('.dv-picker-item');
        if (row) row.classList.toggle('is-selected', chk.checked);
        const cntEl = document.getElementById('dv-picker-selected-count');
        if (cntEl) cntEl.textContent = String(pickerState.selected.size);
      });
    });
  }

  function renderPickerModal() {
    const host = document.getElementById('dv-picker-host');
    if (!host) return;
    if (!pickerState) {
      host.innerHTML = '';
      return;
    }

    host.innerHTML = `
      <div class="dv-picker-overlay" id="dv-picker-overlay">
        <div class="dv-picker-dialog" role="dialog" aria-modal="true">
          <div class="dv-picker-head">
            <div>
              <h3>👥 เลือกจอเข้า ${esc(pickerState.deviceGroupName)}</h3>
              <div style="font-size:10.5px;color:#bae6fd;margin-top:2px;">วง IP: <b>${esc(pickerState.ipGroupName)}</b> · จอที่เลือกจะออกจากกลุ่มอัตโนมัติทันที</div>
            </div>
            <button type="button" class="dv-btn dv-btn-xs" id="dv-picker-close-x">✕</button>
          </div>
          <div class="dv-picker-search-wrap">
            <input type="text" class="dv-picker-search" id="dv-picker-search" placeholder="🔍 ค้นหาชื่อจอ / ไอดีเกม / ชื่อตัวละคร..." value="${esc(pickerState.search)}">
            <button type="button" class="dv-btn dv-btn-xs" id="dv-picker-select-all-btn">เลือกทั้งหมดที่เห็น</button>
            <button type="button" class="dv-btn dv-btn-xs" id="dv-picker-clear-btn">ล้าง</button>
          </div>
          <div class="dv-picker-list" id="dv-picker-list"></div>
          <div class="dv-picker-foot">
            <span style="font-size:11px;color:#cbd5e1;">เลือกแล้ว <b id="dv-picker-selected-count" style="color:#6ee7b7;">${pickerState.selected.size}</b> จอ</span>
            <div style="display:flex;gap:6px;">
              <button type="button" class="dv-btn" id="dv-picker-cancel-btn">ยกเลิก</button>
              <button type="button" class="dv-btn dv-btn-emerald" id="dv-picker-save-btn">✅ บันทึกเข้า Device นี้</button>
            </div>
          </div>
        </div>
      </div>
    `;

    renderPickerListOnly();

    const searchInput = document.getElementById('dv-picker-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        if (!pickerState) return;
        pickerState.search = searchInput.value;
        renderPickerListOnly();
      });
      setTimeout(() => searchInput.focus(), 30);
    }

    const closeFn = () => {
      pickerState = null;
      renderPickerModal();
    };
    document.getElementById('dv-picker-close-x')?.addEventListener('click', closeFn);
    document.getElementById('dv-picker-cancel-btn')?.addEventListener('click', closeFn);
    document.getElementById('dv-picker-overlay')?.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'dv-picker-overlay') closeFn();
    });

    document.getElementById('dv-picker-select-all-btn')?.addEventListener('click', () => {
      if (!pickerState) return;
      document.querySelectorAll('#dv-picker-list .dv-picker-chk').forEach(chk => {
        const pid = chk.getAttribute('data-picker-pid');
        if (pid) pickerState.selected.add(pid);
      });
      renderPickerListOnly();
    });
    document.getElementById('dv-picker-clear-btn')?.addEventListener('click', () => {
      if (!pickerState) return;
      pickerState.selected.clear();
      renderPickerListOnly();
    });

    document.getElementById('dv-picker-save-btn')?.addEventListener('click', async () => {
      if (!pickerState) return;
      const snap = pickerState;
      const toRemove = Array.from(snap.initialIds).filter(pid => !snap.selected.has(pid));
      const toAdd = Array.from(snap.selected);
      pickerState = null;
      renderPickerModal();
      if (toRemove.length > 0) {
        await mutateCustomApi({ action: 'remove_profile', profileIds: toRemove }, null);
      }
      if (toAdd.length > 0) {
        await mutateCustomApi(
          { action: 'assign_profiles', ipGroupId: snap.ipGroupId, deviceGroupId: snap.deviceGroupId, profileIds: toAdd },
          `✅ บันทึก ${toAdd.length} จอเข้า ${snap.deviceGroupName} (${snap.ipGroupName}) แล้ว`
        );
      } else if (toRemove.length > 0 && typeof showToast === 'function') {
        showToast(`✅ ถอด ${toRemove.length} จอออกจาก ${snap.deviceGroupName} แล้ว`, 'info');
      }
    });
  }

  function renderCustomTabBody(bodyEl, list) {
    const profileById = new Map();
    list.forEach((p, idx) => {
      if (p && p.id) profileById.set(p.id, { profile: p, orderIndex: idx + 1 });
    });
    const customGroups = Array.isArray(cachedCustomConfig?.ipGroups) ? cachedCustomConfig.ipGroups : [];
    const leaseMap = getCustomLeaseMap();

    const toolbarHtml = `
      <div class="dv-custom-toolbar">
        <div class="dv-custom-toolbar-top">
          <div>
            <div style="font-size:12.5px;font-weight:800;color:#fef3c7;">🎯 จัดการวงแยก IP / Device พิเศษรายจอ</div>
            <div class="dv-custom-toolbar-desc">สร้างวงจอง Proxy IP เฉพาะกิจ แล้วเพิ่มหลายกลุ่ม Device ภายใน IP เดียวกันได้ (เช่น 1 IP แยก 2 Device จอละ 1 Device)</div>
          </div>
          <button type="button" class="dv-btn dv-btn-amber" id="dv-add-custom-ip-btn" ${customMutating ? 'disabled' : ''}>
            ${customMutating ? '⏳ กำลังบันทึก...' : '+ เพิ่มวง IP พิเศษ (จอง 1 IP)'}
          </button>
        </div>
      </div>
    `;

    let groupsHtml = '';
    if (customGroups.length === 0) {
      groupsHtml = `
        <div class="dv-empty">
          <div class="dv-empty-icon">🎯</div>
          <div class="dv-empty-title">ยังไม่มีวงแยก IP / Device พิเศษ</div>
          <div class="dv-empty-sub">
            กดปุ่ม <b>"+ เพิ่มวง IP พิเศษ (จอง 1 IP)"</b> ด้านบน เพื่อจอง Proxy IP แยกไว้สำหรับจอเฉพาะทาง<br>
            แล้วค่อยเพิ่มกลุ่ม Device ย่อย และกดเลือก Client ที่ต้องการได้เลย
          </div>
        </div>
      `;
    } else {
      groupsHtml = customGroups.map(ig => {
        const lease = leaseMap.get(ig.id) || null;
        const devGroups = Array.isArray(ig.deviceGroups) ? ig.deviceGroups : [];
        const totalMembers = devGroups.reduce((sum, dg) => sum + (Array.isArray(dg.profileIds) ? dg.profileIds.length : 0), 0);
        const shareCount = Math.max(1, totalMembers);
        const surchargePct = lease && Number.isFinite(Number(lease.surchargePct))
          ? Number(lease.surchargePct)
          : computeSurchargePctForShare(shareCount, true);

        const reservedIpText = lease && lease.assigned && (lease.ip || lease.proxyHost)
          ? `🛡️ จอง IP: ${lease.ip || lease.proxyHost}${lease.proxyPort ? `:${lease.proxyPort}` : ''}`
          : (lease && lease.error ? `⏳ ${lease.error}` : '⏳ รอเปิด Proxy / จองคิว IP');
        const resClass = lease && lease.assigned && (lease.ip || lease.proxyHost) ? 'is-reserved' : 'is-waiting';

        const isEditingIp = editingTitleState && editingTitleState.kind === 'ip' && editingTitleState.ipGroupId === ig.id;
        const isDeletingIp = pendingDeleteState && pendingDeleteState.kind === 'ip' && pendingDeleteState.ipGroupId === ig.id;

        const editIpBar = isEditingIp ? `
          <div class="dv-inline-bar">
            <input type="text" class="dv-inline-input" id="dv-inline-rename-input" value="${esc(editingTitleState.value)}" maxlength="64" placeholder="ชื่อวง IP พิเศษ...">
            <div style="display:flex;gap:4px;">
              <button type="button" class="dv-btn dv-btn-xs dv-btn-emerald" data-inline-save="1">บันทึก</button>
              <button type="button" class="dv-btn dv-btn-xs" data-inline-cancel="1">ยกเลิก</button>
            </div>
          </div>
        ` : '';

        const deleteIpBar = isDeletingIp ? `
          <div class="dv-inline-bar is-danger">
            <span style="font-size:11px;color:#fecaca;">ยืนยันลบวง <b>${esc(ig.name)}</b> (จอในวงจะกลับเข้ากลุ่มอัตโนมัติ และคืน IP ที่จองไว้)?</span>
            <div style="display:flex;gap:4px;">
              <button type="button" class="dv-btn dv-btn-xs dv-btn-danger-soft" data-confirm-del-ip="${esc(ig.id)}">ยืนยันลบ</button>
              <button type="button" class="dv-btn dv-btn-xs" data-cancel-del="1">ยกเลิก</button>
            </div>
          </div>
        ` : '';

        const devCardsHtml = devGroups.length === 0
          ? `<div class="dv-custom-empty-dev">ยังไม่มีกลุ่ม Device ในวง IP นี้ — กด <b>"+ เพิ่มกลุ่ม Device"</b> ด้านบน</div>`
          : devGroups.map((dg, dgIdx) => {
              const dgKey = `${ig.id}:${dg.id}`;
              const isRotDg = rotatingCustomDevices.has(dgKey);
              const dgPids = Array.isArray(dg.profileIds) ? dg.profileIds : [];
              const devId = dg.deviceId || '-';
              const machId = dg.machineId || '';
              const shortMach = machId.length >= 20 ? `${machId.slice(0, 12)}...${machId.slice(-10)}` : (machId || '-');

              const isEditingDg = editingTitleState && editingTitleState.kind === 'device' && editingTitleState.deviceGroupId === dg.id;
              const isDeletingDg = pendingDeleteState && pendingDeleteState.kind === 'device' && pendingDeleteState.deviceGroupId === dg.id;

              const editDgBar = isEditingDg ? `
                <div class="dv-inline-bar">
                  <input type="text" class="dv-inline-input" id="dv-inline-rename-input" value="${esc(editingTitleState.value)}" maxlength="64" placeholder="ชื่อกลุ่ม Device...">
                  <div style="display:flex;gap:4px;">
                    <button type="button" class="dv-btn dv-btn-xs dv-btn-emerald" data-inline-save="1">บันทึก</button>
                    <button type="button" class="dv-btn dv-btn-xs" data-inline-cancel="1">ยกเลิก</button>
                  </div>
                </div>
              ` : '';

              const deleteDgBar = isDeletingDg ? `
                <div class="dv-inline-bar is-danger">
                  <span style="font-size:11px;color:#fecaca;">ยืนยันลบ <b>${esc(dg.name)}</b> (จอในกลุ่มนี้จะกลับไปกลุ่มอัตโนมัติ)?</span>
                  <div style="display:flex;gap:4px;">
                    <button type="button" class="dv-btn dv-btn-xs dv-btn-danger-soft" data-confirm-del-dg="${esc(ig.id)}:${esc(dg.id)}">ยืนยันลบ</button>
                    <button type="button" class="dv-btn dv-btn-xs" data-cancel-del="1">ยกเลิก</button>
                  </div>
                </div>
              ` : '';

              const membersHtml = dgPids.length === 0
                ? `<div class="dv-custom-empty-dev">ยังไม่มีจอใน Device นี้ — กด <b>"+ เลือกจอเข้า Device"</b> เพื่อเพิ่ม Client</div>`
                : dgPids.map((pid, mIdx) => {
                    const found = profileById.get(pid);
                    const p = found ? found.profile : { id: pid, name: pid, isRunning: false };
                    const state = p.isRunning ? p.liveState : null;
                    const charName = (state && state.charName) || p.lastCharName || '';
                    const accountId = p.account || (state && state.username) || 'ยังไม่ตั้งไอดี';
                    const portrait = (typeof getPortraitSrc === 'function') ? getPortraitSrc(p, state) : '';
                    const isOnline = Boolean(p.isRunning);
                    return `
                      <div class="dv-member-row ${isOnline ? 'is-online' : ''}" data-profile-id="${esc(p.id)}" title="คลิกเพื่อเลื่อนไปหาการ์ดของ ${esc(p.name)}">
                        <div class="dv-member-left">
                          <span class="dv-slot-pill">จอ ${mIdx + 1}</span>
                          <div class="dv-member-avatar">
                            ${portrait ? `<img src="${esc(portrait)}" alt="" onerror="this.style.display='none'">` : '🎮'}
                          </div>
                          <div class="dv-member-info">
                            <div class="dv-member-title">
                              <span>${esc(p.name || p.id)}</span>
                              ${found ? `<span style="font-size:10px;color:#64748b;font-family:'JetBrains Mono',monospace;">#${found.orderIndex}</span>` : ''}
                            </div>
                            <div class="dv-member-sub">
                              <span>🆔 <b class="dv-member-account">${esc(accountId)}</b></span>
                              ${charName ? `<span>• 👤 ${esc(charName)}</span>` : ''}
                            </div>
                          </div>
                        </div>
                        <div class="dv-member-right">
                          <span class="dv-status-dot ${isOnline ? 'online' : 'offline'}">${isOnline ? '🟢 ออนไลน์' : '⚪ ออฟไลน์'}</span>
                          <button type="button" class="dv-remove-member-btn" data-remove-custom-pid="${esc(p.id)}" title="ถอดจอนี้ออกจากวงพิเศษ (กลับเข้ากลุ่มอัตโนมัติ)">✕ ถอดออก</button>
                        </div>
                      </div>
                    `;
                  }).join('');

              return `
                <div class="dv-custom-dev-card">
                  <div class="dv-custom-dev-top">
                    <div class="dv-custom-dev-title">
                      <span>🖥️ ${esc(dg.name || `Device #${dgIdx + 1}`)}</span>
                      <span class="dv-group-slots-badge">${dgPids.length} จอ</span>
                    </div>
                    <div style="display:flex;gap:4px;flex-wrap:wrap;">
                      <button type="button" class="dv-btn dv-btn-xs dv-btn-emerald" data-open-picker="${esc(ig.id)}:${esc(dg.id)}" ${customMutating ? 'disabled' : ''}>+ เลือกจอเข้า Device</button>
                      <button type="button" class="dv-random-group-btn" data-rotate-custom-dg="${esc(ig.id)}:${esc(dg.id)}" ${isRotDg || customMutating ? 'disabled' : ''} title="สุ่มเลข Device ID และ Machine ID ใหม่">
                        ${isRotDg ? '⏳ กำลังสุ่ม...' : '🎲 Random Device'}
                      </button>
                      <button type="button" class="dv-btn dv-btn-xs" data-rename-dg="${esc(ig.id)}:${esc(dg.id)}" title="เปลี่ยนชื่อกลุ่ม Device">✏️</button>
                      <button type="button" class="dv-btn dv-btn-xs dv-btn-danger-soft" data-ask-del-dg="${esc(ig.id)}:${esc(dg.id)}" title="ลบกลุ่ม Device นี้">🗑️</button>
                    </div>
                  </div>
                  ${editDgBar}
                  ${deleteDgBar}
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
                  <div class="dv-members-list">${membersHtml}</div>
                </div>
              `;
            }).join('');

        return `
          <section class="dv-custom-ip-card">
            <div class="dv-custom-ip-header">
              <div class="dv-custom-ip-row">
                <div class="dv-custom-ip-name">
                  <span>🎯 ${esc(ig.name)}</span>
                  <span class="dv-ip-screens-badge">${totalMembers} จอ · ${devGroups.length} Device</span>
                </div>
                <div class="dv-custom-ip-actions">
                  <button type="button" class="dv-btn dv-btn-xs dv-btn-primary" data-add-custom-dg="${esc(ig.id)}" ${customMutating ? 'disabled' : ''}>+ เพิ่มกลุ่ม Device</button>
                  <button type="button" class="dv-btn dv-btn-xs" data-rename-ip="${esc(ig.id)}" title="เปลี่ยนชื่อวง IP พิเศษ">✏️</button>
                  <button type="button" class="dv-btn dv-btn-xs dv-btn-danger-soft" data-ask-del-ip="${esc(ig.id)}" title="ลบวง IP พิเศษ">🗑️</button>
                </div>
              </div>
              <div class="dv-custom-ip-row">
                <span class="dv-custom-res-pill ${resClass}">${esc(reservedIpText)}</span>
                <span class="dv-custom-rate-pill">💰 ${esc(formatSurchargeTag(surchargePct, shareCount))}</span>
              </div>
              ${editIpBar}
              ${deleteIpBar}
            </div>
            <div class="dv-custom-dev-list">${devCardsHtml}</div>
          </section>
        `;
      }).join('');
    }

    const fullHtml = toolbarHtml + groupsHtml;
    bodyEl.innerHTML = fullHtml;

    document.getElementById('dv-add-custom-ip-btn')?.addEventListener('click', () => {
      mutateCustomApi({ action: 'add_ip_group' }, '🎯 สร้างวง IP พิเศษ + จองคิว IP สำเร็จแล้ว');
    });

    bodyEl.querySelectorAll('[data-add-custom-dg]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ipGroupId = btn.getAttribute('data-add-custom-dg');
        mutateCustomApi({ action: 'add_device_group', ipGroupId }, '🖥️ เพิ่มกลุ่ม Device ย่อยในวง IP แล้ว');
      });
    });

    bodyEl.querySelectorAll('[data-rename-ip]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ipGroupId = btn.getAttribute('data-rename-ip');
        const ig = customGroups.find(x => x.id === ipGroupId);
        pendingDeleteState = null;
        editingTitleState = ig ? { kind: 'ip', ipGroupId: ig.id, value: ig.name } : null;
        renderDrawerList(true);
      });
    });

    bodyEl.querySelectorAll('[data-rename-dg]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [ipGroupId, deviceGroupId] = String(btn.getAttribute('data-rename-dg') || '').split(':');
        const ig = customGroups.find(x => x.id === ipGroupId);
        const dg = (ig?.deviceGroups || []).find(d => d.id === deviceGroupId);
        pendingDeleteState = null;
        editingTitleState = dg ? { kind: 'device', ipGroupId, deviceGroupId, value: dg.name } : null;
        renderDrawerList(true);
      });
    });

    const inlineInput = document.getElementById('dv-inline-rename-input');
    if (inlineInput) {
      setTimeout(() => { inlineInput.focus(); inlineInput.select(); }, 20);
      inlineInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') bodyEl.querySelector('[data-inline-save]')?.click();
        if (e.key === 'Escape') { editingTitleState = null; renderDrawerList(true); }
      });
    }
    bodyEl.querySelector('[data-inline-save]')?.addEventListener('click', async () => {
      if (!editingTitleState) return;
      const val = document.getElementById('dv-inline-rename-input')?.value?.trim() || '';
      const st = editingTitleState;
      editingTitleState = null;
      if (!val) {
        renderDrawerList(true);
        return;
      }
      if (st.kind === 'ip') {
        await mutateCustomApi({ action: 'rename_ip_group', ipGroupId: st.ipGroupId, name: val }, `✏️ เปลี่ยนชื่อวงเป็น "${val}" แล้ว`);
      } else {
        await mutateCustomApi({ action: 'rename_device_group', ipGroupId: st.ipGroupId, deviceGroupId: st.deviceGroupId, name: val }, `✏️ เปลี่ยนชื่อกลุ่ม Device เป็น "${val}" แล้ว`);
      }
    });
    bodyEl.querySelector('[data-inline-cancel]')?.addEventListener('click', () => {
      editingTitleState = null;
      renderDrawerList(true);
    });

    bodyEl.querySelectorAll('[data-ask-del-ip]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ipGroupId = btn.getAttribute('data-ask-del-ip');
        editingTitleState = null;
        pendingDeleteState = { kind: 'ip', ipGroupId };
        renderDrawerList(true);
      });
    });
    bodyEl.querySelectorAll('[data-ask-del-dg]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [ipGroupId, deviceGroupId] = String(btn.getAttribute('data-ask-del-dg') || '').split(':');
        editingTitleState = null;
        pendingDeleteState = { kind: 'device', ipGroupId, deviceGroupId };
        renderDrawerList(true);
      });
    });
    bodyEl.querySelectorAll('[data-cancel-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        pendingDeleteState = null;
        renderDrawerList(true);
      });
    });
    bodyEl.querySelectorAll('[data-confirm-del-ip]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ipGroupId = btn.getAttribute('data-confirm-del-ip');
        pendingDeleteState = null;
        mutateCustomApi({ action: 'delete_ip_group', ipGroupId }, '🗑️ ลบวง IP พิเศษและคืนคิว IP แล้ว');
      });
    });
    bodyEl.querySelectorAll('[data-confirm-del-dg]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [ipGroupId, deviceGroupId] = String(btn.getAttribute('data-confirm-del-dg') || '').split(':');
        pendingDeleteState = null;
        mutateCustomApi({ action: 'delete_device_group', ipGroupId, deviceGroupId }, '🗑️ ลบกลุ่ม Device ย่อยแล้ว');
      });
    });

    bodyEl.querySelectorAll('[data-rotate-custom-dg]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = String(btn.getAttribute('data-rotate-custom-dg') || '');
        const [ipGroupId, deviceGroupId] = key.split(':');
        if (!ipGroupId || !deviceGroupId || rotatingCustomDevices.has(key)) return;
        rotatingCustomDevices.add(key);
        renderDrawerList(true);
        try {
          await mutateCustomApi({ action: 'rotate_custom_device', ipGroupId, deviceGroupId }, '🎲 สุ่มเลข Device ใหม่ให้กลุ่มพิเศษเรียบร้อย');
        } finally {
          rotatingCustomDevices.delete(key);
          renderDrawerList(true);
        }
      });
    });

    bodyEl.querySelectorAll('[data-open-picker]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [ipGroupId, deviceGroupId] = String(btn.getAttribute('data-open-picker') || '').split(':');
        const ig = customGroups.find(x => x.id === ipGroupId);
        const dg = (ig?.deviceGroups || []).find(d => d.id === deviceGroupId);
        if (!ig || !dg) return;
        const initSet = new Set(Array.isArray(dg.profileIds) ? dg.profileIds : []);
        pickerState = {
          ipGroupId: ig.id,
          deviceGroupId: dg.id,
          ipGroupName: ig.name,
          deviceGroupName: dg.name,
          search: '',
          initialIds: new Set(initSet),
          selected: new Set(initSet)
        };
        renderPickerModal();
      });
    });

    bodyEl.querySelectorAll('[data-remove-custom-pid]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const profileId = btn.getAttribute('data-remove-custom-pid');
        if (!profileId) return;
        mutateCustomApi({ action: 'remove_profile', profileId }, '↩️ ย้ายจอกลับเข้ากลุ่มอัตโนมัติแล้ว');
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

  function renderDrawerList(force = true) {
    mountShell();
    const list = typeof currentProfiles !== 'undefined' && Array.isArray(currentProfiles) ? currentProfiles : cachedProfiles;
    const customMap = getCustomAssignedMap();
    const customGroups = Array.isArray(cachedCustomConfig?.ipGroups) ? cachedCustomConfig.ipGroups : [];
    const customDevCount = customGroups.reduce((s, ig) => s + (Array.isArray(ig.deviceGroups) ? ig.deviceGroups.length : 0), 0);

    const groups = buildGroupsFromProfiles(list, cachedGroups);
    const perIp = getEffectiveScreensPerIp(cachedGroups);
    const subSizes = computeSubSizes(perIp);
    const splitText = subSizes.map(n => `${n} จอ`).join(' + ');

    const autoProfiles = list.filter(p => p && p.id && !customMap.has(p.id));
    const totalAutoGroups = groups.length;
    const totalAutoProfiles = autoProfiles.length;
    const totalAutoOnline = autoProfiles.filter(p => p && p.isRunning).length;
    const totalAutoIps = Math.ceil(totalAutoProfiles / perIp);

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
    const surchargeHintEl = document.getElementById('dv-auto-surcharge-hint');
    const autoControlsWrap = document.getElementById('dv-auto-controls-wrap');
    const badgeAuto = document.getElementById('dv-mode-badge-auto');
    const badgeCustom = document.getElementById('dv-mode-badge-custom');
    const bodyEl = document.getElementById('dv-list-body');

    if (tabCount) tabCount.textContent = String(totalAutoGroups + customDevCount);
    if (badgeAuto) badgeAuto.textContent = `${totalAutoProfiles} จอ`;
    if (badgeCustom) badgeCustom.textContent = `${customGroups.length} วง · ${customMap.size} จอ`;

    document.querySelectorAll('[data-dv-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-dv-tab') === activeTab);
    });
    if (autoControlsWrap) {
      autoControlsWrap.classList.toggle('dv-hidden', activeTab === 'custom');
    }

    if (sumIps) sumIps.textContent = String(totalAutoIps);
    if (sumGroups) sumGroups.textContent = String(totalAutoGroups);
    if (sumProfiles) sumProfiles.textContent = String(totalAutoProfiles);
    if (sumOnline) sumOnline.textContent = String(totalAutoOnline);

    if (headerTitleEl) {
      if (activeTab === 'custom') {
        headerTitleEl.textContent = `แยก IP / Device พิเศษ (${customGroups.length} วง)`;
      } else {
        headerTitleEl.textContent = subSizes.length > 1
          ? `จัดการ Device Spoof (1 IP : ${perIp} จอ · ${subSizes.length} Device)`
          : `จัดการ Device Spoof (1 IP : ${perIp} จอ · 1 Device)`;
      }
    }
    if (headerSubEl) {
      if (activeTab === 'custom') {
        headerSubEl.textContent = 'จอง Proxy IP แยกเฉพาะวง · เพิ่มหลาย Device ใน IP เดียว หรือแยก 1 จอต่อ 1 IP ได้อิสระ';
      } else {
        headerSubEl.textContent = subSizes.length > 1
          ? `1 IP (${perIp} จอ) แบ่งเป็น ${subSizes.length} กลุ่ม · ${subSizes.length} Device (${splitText}) · กด Random เพื่อสุ่มเลขใหม่`
          : `แบ่งกลุ่มอัตโนมัติ กลุ่มละ ${perIp} จอ (1 IP : 1 Device) · กด Random เพื่อสุ่มเลข Device ใหม่`;
      }
    }

    if (perIpInput && document.activeElement !== perIpInput) {
      perIpInput.value = String(perIp);
    }
    document.querySelectorAll('[data-dv-per-ip]').forEach(btn => {
      const val = Number(btn.getAttribute('data-dv-per-ip'));
      const pct = computeSurchargePctForShare(val, false);
      btn.classList.toggle('active', val === perIp);
      btn.title = pct > 0
        ? `1 IP = ${val} จอ (ส่วนบุญเพิ่ม +${pct}%)`
        : `1 IP = ${val} จอ (เรทมาตรฐาน +0%)`;
    });

    if (surchargeHintEl) {
      const pct = computeSurchargePctForShare(perIp, false);
      surchargeHintEl.textContent = pct > 0 ? `+${pct}% ส่วนบุญ` : '+0% มาตรฐาน';
      surchargeHintEl.className = `dv-surcharge-hint ${pct > 0 ? 'is-extra' : 'is-std'}`;
    }

    if (splitBannerEl) {
      const pills = subSizes.map((sz, i) => `<span class="dv-split-chip">🖥️ Device ${i + 1}: <b>${sz} จอ</b></span>`).join(' <span style="color:#64748b;">+</span> ');
      splitBannerEl.innerHTML = `
        <span>⚙️ <b>สูตรแบ่งต่อ 1 IP:</b> 1 IP (<b>${perIp} จอ</b>) = <b style="color:#fde047;">${subSizes.length} กลุ่ม · ${subSizes.length} Device</b></span>
        <span class="dv-split-chips-wrap">${pills}</span>
      `;
    }

    if (rotateAllBtn) {
      rotateAllBtn.classList.toggle('dv-hidden', activeTab === 'custom');
      rotateAllBtn.disabled = rotatingAll || totalAutoGroups === 0;
      rotateAllBtn.textContent = rotatingAll ? '⏳ กำลังสุ่ม...' : '🎲 Random ทุกกลุ่ม';
    }
    if (!bodyEl) return;

    if (activeTab === 'custom') {
      renderCustomTabBody(bodyEl, list);
      return;
    }

    if (!force && window.PmUiGuard && window.PmUiGuard.deferIfInteracting('dv-list-body', bodyEl, () => renderDrawerList(false))) {
      return;
    }

    if (totalAutoGroups === 0) {
      const emptyHtml = `
        <div class="dv-empty">
          <div class="dv-empty-icon">⚙️</div>
          <div class="dv-empty-title">${customMap.size > 0 ? 'ทุกจอถูกย้ายไปอยู่วงแยก IP / Device พิเศษแล้ว' : 'ยังไม่มีโปรไฟล์ในกลุ่มอัตโนมัติ'}</div>
          <div class="dv-empty-sub">
            ${customMap.size > 0
              ? 'สามารถสลับไปดูหรือถอดจอออกจากแท็บ <b>"🎯 แยก IP / Device พิเศษ"</b> ด้านบนได้ตลอดเวลา'
              : `เมื่อสร้างโปรไฟล์จอเกม ระบบจะจัดกลุ่มให้อัตโนมัติ<br><b>1 IP ต่อ ${perIp} จอ</b> แบ่งเป็น <b>${subSizes.length} Device (${splitText})</b>`}
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

  function updateDeviceManagerFromProfiles(profiles, deviceGroups, screensPerIp, extra) {
    if (Array.isArray(profiles)) {
      cachedProfiles = profiles;
    }
    if (Array.isArray(deviceGroups)) {
      cachedGroups = deviceGroups;
    }
    if (Number.isFinite(Number(screensPerIp)) && Number(screensPerIp) >= 1) {
      cachedScreensPerIp = Math.max(1, Math.min(20, Math.floor(Number(screensPerIp))));
    }
    if (extra && typeof extra === 'object') {
      if (extra.customIpConfig && Array.isArray(extra.customIpConfig.ipGroups)) {
        cachedCustomConfig = extra.customIpConfig;
      }
      if (Array.isArray(extra.customGroupLeases)) {
        cachedCustomLeases = extra.customGroupLeases;
      }
      if (extra.ipSurchargeConfig) {
        mergeSurchargeConfig(extra.ipSurchargeConfig);
      }
    }
    mountShell();
    const list = typeof currentProfiles !== 'undefined' && Array.isArray(currentProfiles) ? currentProfiles : cachedProfiles;
    const groups = buildGroupsFromProfiles(list, cachedGroups);
    const customGroups = Array.isArray(cachedCustomConfig?.ipGroups) ? cachedCustomConfig.ipGroups : [];
    const customDevCount = customGroups.reduce((s, ig) => s + (Array.isArray(ig.deviceGroups) ? ig.deviceGroups.length : 0), 0);
    const tabCount = document.getElementById('dv-tab-count');
    if (tabCount) tabCount.textContent = String(groups.length + customDevCount);
    if (isOpen) {
      if (activeTab === 'custom' && (editingTitleState || pendingDeleteState || pickerState)) {
        return;
      }
      renderDrawerList(false);
    }
  }

  window.updateDeviceManagerFromProfiles = updateDeviceManagerFromProfiles;
  window.toggleDeviceDrawer = toggleDrawer;
  window.openDeviceDrawerTab = openDeviceDrawerTab;
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
