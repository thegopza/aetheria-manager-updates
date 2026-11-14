/* Multi-PC Fleet Card Dashboard & Full-Screen Remote Manager Controller */
(function () {
  if (window.__PM_REMOTE_MODE__) {
    window.FleetDashboard = {
      onTabShown: function () {},
      refresh: function () {},
      openRemote: function () {},
      closeRemote: function () {}
    };
    return;
  }

  let machines = [];
  let fleetMeta = { username: null, currentMachineKey: null, serverTime: 0, walletSummary: null };
  let lastError = null;
  let lastUpdatedAt = 0;
  let loading = false;
  let searchQuery = "";
  let statusFilter = "all"; // 'all' | 'online' | 'offline' | 'debt'
  let editingMachineKey = null;
  let editingDraft = "";
  let activeRemoteKey = null;
  let initializedDom = false;
  let pollTimer = null;

  function esc(val) {
    return String(val == null ? "" : val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatAgo(ts) {
    if (!ts) return "ไม่ทราบเวลา";
    const diff = Math.max(0, Math.floor((Date.now() - Number(ts)) / 1000));
    if (diff < 10) return "เมื่อสักครู่";
    if (diff < 60) return diff + " วินาทีที่แล้ว";
    const mins = Math.floor(diff / 60);
    if (mins < 60) return mins + " นาทีที่แล้ว";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + " ชม.ที่แล้ว";
    return Math.floor(hrs / 24) + " วันที่แล้ว";
  }

  function formatZeny(num) {
    const n = Math.floor(Number(num) || 0);
    return n.toLocaleString("en-US") + " z";
  }

  function formatMerit(num) {
    const n = Number(num || 0);
    if (!Number.isFinite(n)) return "0";
    return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function isFleetTabActive() {
    const pane = document.getElementById("fleet-dashboard-pane");
    return Boolean(pane && pane.classList.contains("active"));
  }

  function isProfilesTabActive() {
    const pane = document.querySelector('.tab-pane[data-pane="profiles"]');
    return Boolean(pane && pane.classList.contains("active"));
  }

  function getLocalFallbackInfo() {
    const st = typeof window.__getAccessUiState === "function" ? window.__getAccessUiState() : null;
    const nickEl = document.getElementById("device-nickname-input");
    const hwidEl = document.getElementById("device-hwid-short");
    const nickRaw = (nickEl && nickEl.value ? nickEl.value.trim() : "") || (st && st.nickname && st.nickname !== "-" ? st.nickname : "");
    const hwidRaw = (hwidEl && hwidEl.textContent ? hwidEl.textContent.trim() : "") || (st && st.hwidShort ? st.hwidShort : "");
    const hwidClean = (hwidRaw && hwidRaw !== "----" && hwidRaw !== "-") ? hwidRaw : "";
    return {
      username: (st && st.username) || fleetMeta.username || "",
      isUserAccount: Boolean(st && st.isUserAccount),
      requiresLogin: Boolean(st && st.requiresLogin),
      deviceName: nickRaw || "เครื่องปัจจุบัน",
      hwidCode: hwidClean,
      machineKey: fleetMeta.currentMachineKey || hwidClean || "__local__"
    };
  }

  function getSwitcherMachines() {
    const localInfo = getLocalFallbackInfo();
    const list = machines.map(m => ({ ...m }));
    let hasCurrent = false;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m.isCurrentMachine || (localInfo.machineKey && m.machineKey === localInfo.machineKey)) {
        hasCurrent = true;
        list[i] = {
          ...m,
          isCurrentMachine: true,
          isOnline: true,
          remoteReady: true,
          deviceName: m.deviceName || localInfo.deviceName,
          hwidCode: m.hwidCode || localInfo.hwidCode || m.machineKey
        };
      }
    }
    if (!hasCurrent) {
      list.unshift({
        machineKey: localInfo.machineKey,
        hwidCode: localInfo.hwidCode || (localInfo.machineKey !== "__local__" ? localInfo.machineKey : "----"),
        deviceName: localInfo.deviceName,
        isOnline: true,
        remoteReady: true,
        legacyOnly: false,
        isCurrentMachine: true
      });
    }
    list.sort((a, b) => {
      if (Boolean(a.isCurrentMachine) !== Boolean(b.isCurrentMachine)) return a.isCurrentMachine ? -1 : 1;
      const aReady = Boolean(a.isOnline && a.remoteReady);
      const bReady = Boolean(b.isOnline && b.remoteReady);
      if (aReady !== bReady) return aReady ? -1 : 1;
      if (Boolean(a.isOnline) !== Boolean(b.isOnline)) return a.isOnline ? -1 : 1;
      return String(a.deviceName || a.machineKey || "").localeCompare(String(b.deviceName || b.machineKey || ""));
    });
    return list;
  }

  function buildSwitcherOptionsHtml(selectedKey) {
    const list = getSwitcherMachines();
    if (!list.length) return "";
    return list.map(m => {
      const name = m.deviceName || m.hostname || m.machineKey || "เครื่อง";
      const hwid = m.hwidCode && m.hwidCode !== "----" ? m.hwidCode : (m.machineKey && m.machineKey !== "__local__" ? m.machineKey : "");
      const idSuffix = hwid ? ` (${hwid})` : "";
      let label = "";
      if (m.isCurrentMachine) {
        label = `⭐ ${name}${idSuffix} — เครื่องปัจจุบัน`;
      } else if (m.isOnline && m.remoteReady) {
        label = `🛰️ ${name}${idSuffix}`;
      } else if (m.legacyOnly) {
        label = `📦 ${name}${idSuffix} — เวอร์ชันเก่า`;
      } else {
        label = `⚫ ${name}${idSuffix} — ออฟไลน์`;
      }
      const isSel = selectedKey ? (m.machineKey === selectedKey) : Boolean(m.isCurrentMachine);
      const canSelect = Boolean(m.isCurrentMachine || (m.isOnline && m.remoteReady) || isSel);
      return `<option value="${esc(m.machineKey)}"${isSel ? " selected" : ""}${!canSelect ? " disabled" : ""}>${esc(label)}</option>`;
    }).join("");
  }

  function ensureGlobalTopbarMounted() {
    if (window.__PM_REMOTE_MODE__) return null;
    const bar = document.getElementById("fleet-global-topbar");
    if (!bar) return null;
    if (bar.dataset.mounted !== "1") {
      bar.dataset.mounted = "1";
      bar.innerHTML = `
        <div class="fleet-remote-topbar-left">
          <button type="button" class="btn btn-sm btn-secondary fleet-nav-fleet-btn" id="fleet-global-all-btn">🖥️ หน้าเครื่องทั้งหมด</button>
          <button type="button" class="btn btn-sm fleet-home-btn" id="fleet-global-home-btn">⭐ เครื่องตัวเอง</button>
          <select class="fleet-remote-select" id="fleet-global-switcher" aria-label="สลับเครื่องที่ควบคุม"></select>
          <span class="fleet-hwid-chip" id="fleet-global-hwid" title="คลิกเพื่อคัดลอก HWID">----</span>
          <span class="fleet-local-star-pill" id="fleet-global-status-pill">⭐ เครื่องปัจจุบัน (เครื่องนี้)</span>
        </div>
        <div class="fleet-remote-topbar-right">
          <span class="fleet-online-summary-pill" id="fleet-global-online-pill" role="button" tabindex="0" title="คลิกเพื่อเปิดหน้าเครื่องทั้งหมด">🟢 ออนไลน์ 1/1 เครื่อง</span>
          <button type="button" class="btn btn-sm btn-secondary" id="fleet-global-reload-btn">🔄 รีเฟรช</button>
        </div>
      `;

      document.getElementById("fleet-global-all-btn")?.addEventListener("click", () => {
        if (typeof window.switchMainTab === "function") window.switchMainTab("fleet");
      });
      document.getElementById("fleet-global-home-btn")?.addEventListener("click", () => {
        if (typeof window.switchMainTab === "function") window.switchMainTab("profiles");
      });
      document.getElementById("fleet-global-reload-btn")?.addEventListener("click", () => {
        fetchMachines(true);
        if (isProfilesTabActive()) {
          document.getElementById("btn-refresh")?.click();
        }
      });
      const onlinePill = document.getElementById("fleet-global-online-pill");
      if (onlinePill) {
        const handlePillClick = () => {
          const info = getLocalFallbackInfo();
          const loggedIn = Boolean((info.isUserAccount && info.username && !info.requiresLogin) || fleetMeta.username);
          if (!loggedIn) {
            document.getElementById("btn-account-auth")?.click();
          } else if (typeof window.switchMainTab === "function") {
            window.switchMainTab("fleet");
          }
        };
        onlinePill.addEventListener("click", handlePillClick);
        onlinePill.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handlePillClick();
          }
        });
      }
      const hwidChip = document.getElementById("fleet-global-hwid");
      if (hwidChip) {
        hwidChip.addEventListener("click", () => {
          const val = hwidChip.dataset.hwid || "";
          if (!val || val === "----") return;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(val).catch(() => {});
          }
          hwidChip.dataset.copiedUntil = String(Date.now() + 1200);
          hwidChip.textContent = val + " ✓";
          setTimeout(() => {
            hwidChip.dataset.copiedUntil = "0";
            hwidChip.textContent = hwidChip.dataset.hwid || "----";
          }, 1200);
        });
      }
      const switcher = document.getElementById("fleet-global-switcher");
      if (switcher) {
        switcher.addEventListener("change", function () {
          const nextKey = this.value;
          const list = getSwitcherMachines();
          const nextTarget = list.find(x => x.machineKey === nextKey);
          const curMachine = list.find(x => x.isCurrentMachine);
          if (!nextKey || (nextTarget && nextTarget.isCurrentMachine)) {
            if (typeof window.switchMainTab === "function") window.switchMainTab("profiles");
            return;
          }
          if (curMachine) this.value = curMachine.machineKey;
          openRemote(nextKey);
        });
      }
    }
    bar.style.display = "flex";
    document.body && document.body.classList && document.body.classList.add("has-fleet-global-bar");
    return bar;
  }

  function syncGlobalTopbar() {
    if (window.__PM_REMOTE_MODE__) return;
    const bar = ensureGlobalTopbarMounted();
    if (!bar) return;

    const allBtn = document.getElementById("fleet-global-all-btn");
    const homeBtn = document.getElementById("fleet-global-home-btn");
    const switcher = document.getElementById("fleet-global-switcher");
    const hwidChip = document.getElementById("fleet-global-hwid");
    const onlinePill = document.getElementById("fleet-global-online-pill");

    const fleetActive = isFleetTabActive();
    const profilesActive = isProfilesTabActive();
    if (allBtn) allBtn.classList.toggle("is-active", fleetActive);
    if (homeBtn) homeBtn.classList.toggle("is-active", profilesActive);

    const list = getSwitcherMachines();
    const cur = list.find(m => m.isCurrentMachine) || list[0] || null;
    const targetVal = cur ? cur.machineKey : "__local__";
    if (switcher && document.activeElement !== switcher) {
      const optsHtml = buildSwitcherOptionsHtml(targetVal);
      if (switcher.dataset.lastOpts !== optsHtml) {
        switcher.innerHTML = optsHtml;
        switcher.dataset.lastOpts = optsHtml;
      }
      if (targetVal && switcher.value !== targetVal) {
        switcher.value = targetVal;
      }
    }

    if (hwidChip) {
      const hwidVal = (cur && cur.hwidCode && cur.hwidCode !== "----")
        ? cur.hwidCode
        : (cur && cur.machineKey && cur.machineKey !== "__local__" ? cur.machineKey : "----");
      hwidChip.dataset.hwid = hwidVal;
      if (!hwidChip.dataset.copiedUntil || Date.now() > Number(hwidChip.dataset.copiedUntil)) {
        hwidChip.textContent = hwidVal;
      }
    }

    if (onlinePill) {
      const info = getLocalFallbackInfo();
      const loggedIn = Boolean((info.isUserAccount && info.username && !info.requiresLogin) || fleetMeta.username);
      if (!loggedIn) {
        onlinePill.classList.add("is-guest");
        onlinePill.textContent = "👤 เข้าสู่ระบบเพื่อเชื่อมหลายเครื่อง";
      } else {
        onlinePill.classList.remove("is-guest");
        const total = Math.max(1, machines.length || list.length);
        const online = Math.max(1, machines.filter(m => m.isOnline).length || list.filter(m => m.isOnline).length);
        onlinePill.textContent = `🟢 ออนไลน์ ${online}/${total} เครื่อง`;
      }
    }
  }

  function ensureShellMounted() {
    const pane = document.getElementById("fleet-dashboard-pane");
    if (!pane) return null;
    if (!initializedDom || !document.getElementById("fleet-cards-grid")) {
      initializedDom = true;
      pane.innerHTML = `
        <div class="fleet-shell">
          <div class="fleet-kpi-grid" id="fleet-kpi-grid"></div>
          <div class="fleet-toolbar">
            <div class="fleet-toolbar-left">
              <input type="text" id="fleet-search-input" class="fleet-search-input" placeholder="🔍 ค้นหาชื่อเครื่อง, HWID, หรือชื่อตัวละคร..." />
              <div class="fleet-filter-group" role="group">
                <button type="button" class="fleet-filter-btn active" data-fleet-filter="all">ทั้งหมด</button>
                <button type="button" class="fleet-filter-btn" data-fleet-filter="online">🟢 ออนไลน์</button>
                <button type="button" class="fleet-filter-btn" data-fleet-filter="offline">⚫ ออฟไลน์</button>
                <button type="button" class="fleet-filter-btn" data-fleet-filter="debt">🔴 ติดลบ</button>
              </div>
            </div>
            <div class="fleet-toolbar-right">
              <span class="fleet-user-badge" id="fleet-user-badge">👤 กำลังตรวจสอบบัญชี...</span>
              <span class="fleet-sync-hint" id="fleet-sync-hint">-</span>
              <button type="button" class="btn btn-sm btn-primary" id="fleet-btn-refresh">🔄 รีเฟรชทันที</button>
            </div>
          </div>
          <div id="fleet-merit-overview-bar" class="fleet-merit-overview-bar" style="display:none;"></div>
          <div id="fleet-cards-container">
            <div class="fleet-cards-grid" id="fleet-cards-grid"></div>
          </div>
        </div>
      `;

      const searchEl = document.getElementById("fleet-search-input");
      if (searchEl) {
        searchEl.value = searchQuery;
        searchEl.addEventListener("input", function () {
          searchQuery = String(this.value || "");
          renderCards();
        });
      }

      pane.querySelectorAll("[data-fleet-filter]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          statusFilter = btn.getAttribute("data-fleet-filter") || "all";
          pane.querySelectorAll("[data-fleet-filter]").forEach(function (b) {
            b.classList.toggle("active", b.getAttribute("data-fleet-filter") === statusFilter);
          });
          renderCards();
        });
      });

      const refreshBtn = document.getElementById("fleet-btn-refresh");
      if (refreshBtn) {
        refreshBtn.addEventListener("click", function () {
          fetchMachines(true);
        });
      }
    }
    return pane;
  }

  function updateTabBadge() {
    const badge = document.getElementById("tab-count-fleet");
    if (!badge) return;
    const online = machines.filter(m => m.isOnline).length;
    badge.textContent = machines.length > 0 ? `${online}/${machines.length}` : "0";
  }

  function renderKpis() {
    const grid = document.getElementById("fleet-kpi-grid");
    if (!grid) return;
    const totalMachines = machines.length;
    const onlineMachines = machines.filter(m => m.isOnline).length;
    let totalOnlineScreens = 0;
    let totalFarmingScreens = 0;
    let totalZenyAll = 0;
    machines.forEach(m => {
      const s = m.summary || {};
      totalOnlineScreens += Number(s.onlineCount || 0);
      totalFarmingScreens += Number(s.farmingCount || 0);
      totalZenyAll += Number(s.totalZeny || 0);
    });

    const ws = fleetMeta.walletSummary || null;
    const fallbackDebtUnits = machines.reduce((acc, m) => acc + Number(m.merit?.debtUnits || 0), 0);
    const balUnits = ws ? Number(ws.balanceUnits || 0) : fallbackDebtUnits;
    const balMerit = ws && ws.balanceMerit != null ? Number(ws.balanceMerit) : (balUnits / 100);
    const negMachines = ws
      ? Number(ws.negativeMachineCount || 0)
      : machines.filter(m => Number(m.merit?.debtUnits || 0) < 0).length;
    const hasMeritInfo = Boolean(ws || machines.some(m => m.merit));
    const meritCls = balUnits < 0 ? "accent-rose" : "accent-emerald";
    const meritValText = hasMeritInfo ? `${formatMerit(balMerit)} บุญ` : "-";
    const meritSubText = !hasMeritInfo
      ? "กำลังโหลดข้อมูล..."
      : (negMachines > 0 ? `ติดลบ ${negMachines} / ${totalMachines} เครื่อง` : "ไม่ติดลบทุกเครื่อง");

    grid.innerHTML = `
      <div class="fleet-kpi-card">
        <span class="fleet-kpi-label">🖥️ เครื่องทั้งหมดในบัญชี</span>
        <span class="fleet-kpi-val accent-sky">${totalMachines.toLocaleString()} เครื่อง</span>
      </div>
      <div class="fleet-kpi-card">
        <span class="fleet-kpi-label">🟢 เครื่องออนไลน์</span>
        <span class="fleet-kpi-val accent-emerald">${onlineMachines.toLocaleString()} เครื่อง</span>
      </div>
      <div class="fleet-kpi-card">
        <span class="fleet-kpi-label">🎮 จอออนไลน์รวมทุกเครื่อง</span>
        <span class="fleet-kpi-val">${totalOnlineScreens.toLocaleString()} จอ</span>
      </div>
      <div class="fleet-kpi-card">
        <span class="fleet-kpi-label">⚔️ กำลังฟาร์มรวม</span>
        <span class="fleet-kpi-val accent-amber">${totalFarmingScreens.toLocaleString()} จอ</span>
      </div>
      <div class="fleet-kpi-card">
        <span class="fleet-kpi-label">💰 Zeny รวมทุกเครื่อง</span>
        <span class="fleet-kpi-val accent-gold">${formatZeny(totalZenyAll)}</span>
      </div>
      <div class="fleet-kpi-card">
        <span class="fleet-kpi-label">🧧 ส่วนบุญรวมบัญชี</span>
        <span class="fleet-kpi-val ${meritCls}">${meritValText}</span>
        <span class="fleet-kpi-sub ${negMachines > 0 ? "is-debt" : "is-clean"}">${meritSubText}</span>
      </div>
    `;

    const overviewBar = document.getElementById("fleet-merit-overview-bar");
    if (overviewBar) {
      if (hasMeritInfo && machines.length > 0) {
        const chips = machines.map(m => {
          const mr = m.merit || {};
          const dUnits = Number(mr.debtUnits || 0);
          const dMerit = mr.debtMerit != null ? mr.debtMerit : (dUnits / 100);
          const isDebt = dUnits < 0;
          const cls = `fleet-merit-chip ${isDebt ? "is-debt" : "is-clean"} ${m.isCurrentMachine ? "is-current" : ""}`;
          const lbl = esc(m.deviceName || m.hwidCode || m.machineKey || "-");
          const val = isDebt ? `ติดลบ ${formatMerit(dMerit)} ส่วนบุญ` : "ไม่ติดลบ (0 บุญ)";
          return `<span class="${cls}" title="HWID: ${esc(m.hwidCode || m.machineKey || "")}">${m.isCurrentMachine ? "⭐" : "💻"} <b>${lbl}${m.isCurrentMachine ? " (เครื่องนี้)" : ""}</b>: ${val}</span>`;
        });
        if (ws && Number(ws.unassignedDebtUnits || 0) < 0) {
          const unMerit = ws.unassignedDebtMerit != null ? ws.unassignedDebtMerit : (Number(ws.unassignedDebtUnits) / 100);
          chips.push(`<span class="fleet-merit-chip is-debt">⏳ <b>ยอดค้างเดิมก่อนผูกเครื่อง</b>: ติดลบ ${formatMerit(unMerit)} ส่วนบุญ</span>`);
        }
        overviewBar.innerHTML = `<span class="fleet-merit-overview-lbl">💳 ส่วนบุญแยกตามเครื่อง:</span>${chips.join("")}`;
        overviewBar.style.display = "flex";
      } else {
        overviewBar.innerHTML = "";
        overviewBar.style.display = "none";
      }
    }

    const userBadge = document.getElementById("fleet-user-badge");
    if (userBadge) {
      userBadge.textContent = fleetMeta.username
        ? `👤 บัญชีกลาง: ${fleetMeta.username}`
        : "👤 ยังไม่ได้เข้าสู่ระบบบัญชีกลาง";
    }
    const syncHint = document.getElementById("fleet-sync-hint");
    if (syncHint) {
      syncHint.textContent = loading
        ? "⏳ กำลังอัปเดต..."
        : (lastUpdatedAt ? `อัปเดต: ${formatAgo(lastUpdatedAt)}` : "-");
    }
  }

  function renderClientRow(c) {
    let dotCls = "offline";
    let stateCls = "";
    if (c.isBanned) { dotCls = "banned"; stateCls = "banned"; }
    else if (c.isJailed) { dotCls = "jailed"; stateCls = "jailed"; }
    else if (c.isBotRunning) { dotCls = "farming"; stateCls = "farming"; }
    else if (c.isRunning) { dotCls = "online"; stateCls = "online"; }

    const label = esc(c.charName || c.name || c.id || "Client");
    const lvText = c.baseLv > 0 ? ` Lv.${c.baseLv}` : "";
    const mapText = esc(c.map || (c.isRunning ? "-" : "ออฟไลน์"));
    const zenyText = formatZeny(c.zeny);
    const statusText = esc(c.statusText || (c.isRunning ? "เปิดจอ" : "ออฟไลน์"));

    return `
      <div class="fleet-client-row">
        <div class="fleet-client-main" title="${label}${esc(lvText)} (${esc(c.charClass || "")})">
          <span class="fleet-client-dot ${dotCls}"></span>
          <span class="fleet-client-name">${label}${esc(lvText)}</span>
        </div>
        <span class="fleet-client-sub" title="${mapText}">${mapText}</span>
        <span class="fleet-client-zeny">${esc(zenyText)}</span>
        <span class="fleet-client-state ${stateCls}">${statusText}</span>
      </div>
    `;
  }

  function renderCards() {
    ensureShellMounted();
    renderKpis();
    const container = document.getElementById("fleet-cards-container");
    if (!container) return;

    if (lastError && machines.length === 0) {
      container.innerHTML = `
        <div class="fleet-empty-box">
          <div style="font-size:28px;">🔐</div>
          <div style="font-size:15px;font-weight:800;color:#f8fafc;">${esc(lastError)}</div>
          <div style="font-size:12.5px;color:#94a3b8;">เข้าสู่ระบบด้วย Username เดียวกันในแต่ละเครื่อง แล้วกดรีเฟรชเพื่อดูและควบคุมเครื่องทั้งหมดได้จากที่นี่</div>
          <button type="button" class="btn btn-primary btn-sm" id="fleet-retry-btn">🔄 ลองใหม่อีกครั้ง</button>
        </div>
      `;
      const retryBtn = document.getElementById("fleet-retry-btn");
      if (retryBtn) retryBtn.addEventListener("click", () => fetchMachines(true));
      return;
    }

    const q = searchQuery.trim().toLowerCase();
    const filtered = machines.filter(m => {
      if (statusFilter === "online" && !m.isOnline) return false;
      if (statusFilter === "offline" && m.isOnline) return false;
      if (statusFilter === "debt" && !(Number(m.merit?.debtUnits || 0) < 0)) return false;
      if (!q) return true;
      const hay = [
        m.deviceName,
        m.hostname,
        m.hwidCode,
        m.machineKey,
        ...(Array.isArray(m.summary?.clients) ? m.summary.clients.flatMap(c => [c.name, c.charName, c.map]) : [])
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="fleet-empty-box">
          <div style="font-size:26px;">🖥️</div>
          <div style="font-size:14.5px;font-weight:700;color:#e2e8f0;">ไม่พบเครื่องที่ตรงกับตัวกรอง</div>
          <div style="font-size:12px;">ลองล้างช่องค้นหา หรือเปิด Manager บนเครื่องอื่นแล้วล็อกอินด้วยบัญชีเดียวกัน</div>
        </div>
      `;
      return;
    }

    let grid = document.getElementById("fleet-cards-grid");
    if (!grid) {
      container.innerHTML = '<div class="fleet-cards-grid" id="fleet-cards-grid"></div>';
      grid = document.getElementById("fleet-cards-grid");
    }

    grid.innerHTML = filtered.map(m => {
      const sum = m.summary || {};
      const clients = Array.isArray(sum.clients) ? sum.clients : [];
      const cardCls = [
        "fleet-card",
        m.isOnline ? "is-online" : "is-offline",
        m.isCurrentMachine ? "is-current" : ""
      ].filter(Boolean).join(" ");

      const statusPill = m.isOnline
        ? '<span class="fleet-status-pill online"><span class="fleet-dot"></span>ออนไลน์</span>'
        : '<span class="fleet-status-pill offline"><span class="fleet-dot"></span>ออฟไลน์</span>';

      let rolePill = "";
      if (m.isCurrentMachine) {
        rolePill = '<span class="fleet-role-pill current">⭐ เครื่องปัจจุบัน</span>';
      } else if (m.remoteReady && m.isOnline) {
        rolePill = '<span class="fleet-role-pill remote-ready">🛰️ พร้อมรีโมท</span>';
      } else if (m.legacyOnly) {
        rolePill = '<span class="fleet-role-pill legacy">📦 เวอร์ชันเก่า (ดูสถานะ)</span>';
      }

      const removeBtn = (!m.isOnline && !m.isCurrentMachine)
        ? `<button type="button" class="fleet-icon-btn danger" data-fleet-remove="${esc(m.machineKey)}" title="ลบการ์ดเครื่องออฟไลน์นี้ออก">🗑️</button>`
        : "";

      const isEditing = editingMachineKey === m.machineKey;
      const nameSection = isEditing
        ? `<div class="fleet-rename-form">
             <input type="text" class="fleet-rename-input" id="fleet-rename-input" maxlength="32" value="${esc(editingDraft)}" />
             <button type="button" class="fleet-icon-btn" data-fleet-rename-save="${esc(m.machineKey)}" title="บันทึก">💾</button>
             <button type="button" class="fleet-icon-btn" data-fleet-rename-cancel title="ยกเลิก">✕</button>
           </div>`
        : `<div class="fleet-name-row">
             <span class="fleet-machine-name">${m.isCurrentMachine ? "⭐ " : ""}${esc(m.deviceName || m.hostname || m.machineKey)}</span>
             <button type="button" class="fleet-icon-btn" data-fleet-rename-start="${esc(m.machineKey)}" title="เปลี่ยนชื่อเครื่อง">✏️</button>
           </div>`;

      const warnJailBan = (Number(sum.jailedCount || 0) + Number(sum.bannedCount || 0)) > 0;
      const clientListHtml = clients.length > 0
        ? clients.map(renderClientRow).join("")
        : '<div style="font-size:11.5px;color:#64748b;padding:8px 4px;text-align:center;">ยังไม่มีโปรไฟล์จอเกมในเครื่องนี้</div>';

      let actionHtml = "";
      if (m.isCurrentMachine) {
        actionHtml = `
          <button type="button" class="fleet-btn-primary" data-fleet-go-local>⭐ จัดการเครื่องปัจจุบัน (เครื่องนี้)</button>
        `;
      } else if (m.isOnline && m.remoteReady) {
        actionHtml = `
          <button type="button" class="fleet-btn-primary" data-fleet-open-remote="${esc(m.machineKey)}">🕹️ เข้าควบคุมเครื่องนี้ (Remote Manager)</button>
        `;
      } else {
        actionHtml = `
          <button type="button" class="fleet-btn-disabled" disabled>${m.legacyOnly ? "⏳ กรุณาอัปเดตเครื่องเป้าหมายเป็น v4.58+ เพื่อรีโมทเต็มรูปแบบ" : "⏸️ เครื่องออฟไลน์อยู่ — รีโมทได้เมื่อเปิด Manager"}</button>
        `;
      }

      const mr = m.merit || null;
      const mDebtUnits = Number(mr?.debtUnits || 0);
      const mDebtMerit = mr && mr.debtMerit != null ? mr.debtMerit : (mDebtUnits / 100);
      const mTodayMerit = mr && mr.todayUsedMerit != null ? mr.todayUsedMerit : (Number(mr?.todayUsedUnits || 0) / 100);
      const mTotalMerit = mr && mr.totalUsedMerit != null ? mr.totalUsedMerit : (Number(mr?.totalUsedUnits || 0) / 100);
      const mIsDebt = mDebtUnits < 0;
      const meritStripHtml = mr
        ? `<div class="fleet-merit-strip ${mIsDebt ? "is-debt" : "is-clean"}">
            <div class="fleet-merit-strip-left">
              <span class="fleet-merit-strip-title">💳 ส่วนบุญเครื่องนี้</span>
              <span class="fleet-merit-strip-sub">ใช้วันนี้ ${formatMerit(mTodayMerit)} บุญ • สะสม ${formatMerit(mTotalMerit)} บุญ</span>
            </div>
            <span class="fleet-merit-strip-badge ${mIsDebt ? "is-debt" : "is-clean"}">${mIsDebt ? `ติดลบ ${formatMerit(mDebtMerit)} ส่วนบุญ` : "ไม่ติดลบ (0 บุญ)"}</span>
          </div>`
        : `<div class="fleet-merit-strip">
            <div class="fleet-merit-strip-left">
              <span class="fleet-merit-strip-title">💳 ส่วนบุญเครื่องนี้</span>
              <span class="fleet-merit-strip-sub">ใช้วันนี้ 0 บุญ • สะสม 0 บุญ</span>
            </div>
            <span class="fleet-merit-strip-badge is-clean">ไม่ติดลบ (0 บุญ)</span>
          </div>`;

      return `
        <article class="${cardCls}" data-machine-key="${esc(m.machineKey)}">
          <div class="fleet-card-top">
            <div class="fleet-badges-left">
              ${statusPill}
              ${rolePill}
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              ${m.managerVersion ? `<span style="font-size:10.5px;color:#64748b;">v${esc(m.managerVersion)}</span>` : ""}
              ${removeBtn}
            </div>
          </div>
          <div class="fleet-title-block">
            ${nameSection}
            <div class="fleet-meta-row">
              <span>HWID: <code class="fleet-hwid-chip" data-fleet-copy-hwid="${esc(m.hwidCode || m.machineKey)}" title="คลิกเพื่อคัดลอก HWID">${esc(m.hwidCode || m.machineKey)} 📋</code></span>
              ${m.hostname ? `<span>• ${esc(m.hostname)}</span>` : ""}
              <span>• ${esc(formatAgo(m.lastSeenAt))}</span>
            </div>
          </div>
          ${meritStripHtml}
          <div class="fleet-card-stats">
            <div class="fleet-stat-box">
              <span class="fleet-stat-lbl">จอออนไลน์</span>
              <span class="fleet-stat-num ok">${Number(sum.onlineCount || 0)} / ${Number(sum.totalProfiles || 0)}</span>
            </div>
            <div class="fleet-stat-box">
              <span class="fleet-stat-lbl">กำลังฟาร์ม</span>
              <span class="fleet-stat-num">${Number(sum.farmingCount || 0)}</span>
            </div>
            <div class="fleet-stat-box">
              <span class="fleet-stat-lbl">คุก / แบน</span>
              <span class="fleet-stat-num ${warnJailBan ? "danger" : ""}">${Number(sum.jailedCount || 0)} / ${Number(sum.bannedCount || 0)}</span>
            </div>
            <div class="fleet-stat-box">
              <span class="fleet-stat-lbl">Zeny รวม</span>
              <span class="fleet-stat-num gold" title="${esc(formatZeny(sum.totalZeny))}">${Number(sum.totalZeny || 0).toLocaleString("en-US")} z</span>
            </div>
          </div>
          <div class="fleet-clients-box">
            <div class="fleet-clients-hdr">
              <span>รายการตัวละคร (${clients.length})</span>
              <span>สถานะ / เงิน</span>
            </div>
            <div class="fleet-clients-list">${clientListHtml}</div>
          </div>
          <div class="fleet-card-actions">${actionHtml}</div>
        </article>
      `;
    }).join("");

    // Wire events safely via delegation
    grid.querySelectorAll("[data-fleet-copy-hwid]").forEach(el => {
      el.addEventListener("click", () => {
        const val = el.getAttribute("data-fleet-copy-hwid") || "";
        if (navigator.clipboard && val) {
          navigator.clipboard.writeText(val).catch(() => {});
        }
        el.textContent = val + " ✓";
        setTimeout(() => { el.textContent = val + " 📋"; }, 1200);
      });
    });

    grid.querySelectorAll("[data-fleet-rename-start]").forEach(btn => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-fleet-rename-start");
        const found = machines.find(x => x.machineKey === key);
        editingMachineKey = key;
        editingDraft = (found && found.deviceName) || key || "";
        renderCards();
        const inp = document.getElementById("fleet-rename-input");
        if (inp) { inp.focus(); inp.select(); }
      });
    });

    const renameInput = document.getElementById("fleet-rename-input");
    if (renameInput) {
      renameInput.addEventListener("input", function () { editingDraft = this.value; });
      renameInput.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") submitRename(editingMachineKey, this.value);
        if (ev.key === "Escape") { editingMachineKey = null; renderCards(); }
      });
    }

    grid.querySelectorAll("[data-fleet-rename-save]").forEach(btn => {
      btn.addEventListener("click", () => submitRename(btn.getAttribute("data-fleet-rename-save"), editingDraft));
    });
    grid.querySelectorAll("[data-fleet-rename-cancel]").forEach(btn => {
      btn.addEventListener("click", () => { editingMachineKey = null; renderCards(); });
    });

    grid.querySelectorAll("[data-fleet-remove]").forEach(btn => {
      btn.addEventListener("click", () => removeMachine(btn.getAttribute("data-fleet-remove")));
    });

    grid.querySelectorAll("[data-fleet-go-local]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (typeof window.switchMainTab === "function") window.switchMainTab("profiles");
      });
    });

    grid.querySelectorAll("[data-fleet-open-remote]").forEach(btn => {
      btn.addEventListener("click", () => {
        openRemote(btn.getAttribute("data-fleet-open-remote"));
      });
    });
  }

  async function submitRename(machineKey, newName) {
    const clean = String(newName || "").trim().slice(0, 32);
    if (!machineKey || !clean) return;
    try {
      const res = await fetch("/api/fleet/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetMachineKey: machineKey, deviceName: clean })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "เปลี่ยนชื่อไม่สำเร็จ");
      editingMachineKey = null;
      await fetchMachines(true);
    } catch (e) {
      alert(e.message || "เปลี่ยนชื่อเครื่องไม่สำเร็จ");
    }
  }

  async function removeMachine(machineKey) {
    if (!machineKey) return;
    const target = machines.find(m => m.machineKey === machineKey);
    const label = target ? (target.deviceName || target.machineKey) : machineKey;
    if (!confirm(`ยืนยันลบการ์ดเครื่อง "${label}" ออกจากรายการ?`)) return;
    try {
      const res = await fetch("/api/fleet/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetMachineKey: machineKey })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "ลบเครื่องไม่สำเร็จ");
      await fetchMachines(true);
    } catch (e) {
      alert(e.message || "ลบการ์ดเครื่องไม่สำเร็จ");
    }
  }

  function openRemote(machineKey) {
    if (!machineKey) return;
    const overlay = document.getElementById("fleet-remote-overlay");
    if (!overlay) return;
    activeRemoteKey = machineKey;
    const target = machines.find(m => m.machineKey === machineKey);
    const optionsHtml = buildSwitcherOptionsHtml(machineKey);

    overlay.style.display = "flex";
    overlay.innerHTML = `
      <div class="fleet-remote-topbar">
        <div class="fleet-remote-topbar-left">
          <button type="button" class="btn btn-sm btn-secondary" id="fleet-remote-back">⬅️ กลับหน้าเครื่องทั้งหมด</button>
          <button type="button" class="btn btn-sm fleet-home-btn" id="fleet-remote-home">⭐ กลับเครื่องตัวเอง</button>
          <select class="fleet-remote-select" id="fleet-remote-switcher">${optionsHtml || `<option value="${esc(machineKey)}">${esc(machineKey)}</option>`}</select>
          <span class="fleet-hwid-chip">${esc(target?.hwidCode || machineKey)}</span>
          <span class="fleet-remote-lock-pill">🔒 ล็อก Logout/สลับบัญชีระหว่างรีโมท</span>
        </div>
        <div class="fleet-remote-topbar-right">
          <button type="button" class="btn btn-sm btn-secondary" id="fleet-remote-reload">🔄 รีเฟรช</button>
          <button type="button" class="btn btn-sm btn-secondary" id="fleet-remote-popout">↗️ เปิดแยกแท็บใหม่</button>
          <button type="button" class="btn btn-sm btn-danger" id="fleet-remote-close">✕ ปิด</button>
        </div>
      </div>
      <div class="fleet-remote-body">
        <div class="fleet-remote-loading" id="fleet-remote-loading">
          <div>🛰️ กำลังเชื่อมต่อ Manager ของเครื่อง <b>${esc(target?.deviceName || machineKey)}</b> ...</div>
        </div>
        <iframe id="fleet-remote-iframe" class="fleet-remote-iframe" src="/remote/${encodeURIComponent(machineKey)}/"></iframe>
      </div>
    `;

    const remoteSwitcher = document.getElementById("fleet-remote-switcher");
    if (remoteSwitcher && optionsHtml) {
      remoteSwitcher.dataset.lastOpts = optionsHtml;
    }

    const iframe = document.getElementById("fleet-remote-iframe");
    const loader = document.getElementById("fleet-remote-loading");
    if (iframe) {
      iframe.addEventListener("load", () => {
        if (loader) loader.style.display = "none";
      });
    }

    document.getElementById("fleet-remote-back")?.addEventListener("click", () => {
      closeRemote();
      if (typeof window.switchMainTab === "function") window.switchMainTab("fleet");
    });
    document.getElementById("fleet-remote-close")?.addEventListener("click", closeRemote);
    document.getElementById("fleet-remote-home")?.addEventListener("click", () => {
      closeRemote();
      if (typeof window.switchMainTab === "function") window.switchMainTab("profiles");
    });
    document.getElementById("fleet-remote-reload")?.addEventListener("click", () => {
      if (loader) loader.style.display = "flex";
      if (iframe && iframe.contentWindow) {
        iframe.src = `/remote/${encodeURIComponent(activeRemoteKey)}/?_t=${Date.now()}`;
      }
    });
    document.getElementById("fleet-remote-popout")?.addEventListener("click", () => {
      window.open(`/remote/${encodeURIComponent(activeRemoteKey)}/`, "_blank", "noopener");
    });
    remoteSwitcher?.addEventListener("change", function () {
      const nextKey = this.value;
      if (!nextKey || nextKey === activeRemoteKey) return;
      const nextTarget = getSwitcherMachines().find(x => x.machineKey === nextKey);
      if (nextTarget && nextTarget.isCurrentMachine) {
        closeRemote();
        if (typeof window.switchMainTab === "function") window.switchMainTab("profiles");
      } else {
        openRemote(nextKey);
      }
    });
  }

  function closeRemote() {
    activeRemoteKey = null;
    const overlay = document.getElementById("fleet-remote-overlay");
    if (overlay) {
      overlay.style.display = "none";
      overlay.innerHTML = "";
    }
    syncGlobalTopbar();
    fetchMachines(true);
  }

  async function fetchMachines(force = false) {
    if (loading && !force) return;
    if (!force && editingMachineKey) return;
    if (!force && window.PmUiGuard && typeof window.PmUiGuard.isInteractionBusy === "function" && window.PmUiGuard.isInteractionBusy()) {
      return;
    }

    loading = true;
    if (isFleetTabActive()) renderKpis();
    try {
      const res = await fetch("/api/fleet/machines");
      const data = await res.json();
      if (!res.ok || !data.success) {
        lastError = data.error || "กรุณาเข้าสู่ระบบบัญชีผู้ใช้งานก่อน";
        if (res.status === 401) machines = [];
      } else {
        lastError = null;
        machines = Array.isArray(data.machines) ? data.machines : [];
        fleetMeta = {
          username: data.username || null,
          currentMachineKey: data.currentMachineKey || null,
          serverTime: data.serverTime || Date.now(),
          walletSummary: data.walletSummary || null
        };
        lastUpdatedAt = Date.now();
      }
    } catch (e) {
      lastError = "ไม่สามารถโหลดข้อมูลเครื่องได้: " + (e.message || "Network error");
    } finally {
      loading = false;
      updateTabBadge();
      syncGlobalTopbar();
      if (activeRemoteKey) {
        const remoteSwitcher = document.getElementById("fleet-remote-switcher");
        if (remoteSwitcher && document.activeElement !== remoteSwitcher) {
          const remoteOptsHtml = buildSwitcherOptionsHtml(activeRemoteKey);
          if (remoteOptsHtml && remoteSwitcher.dataset.lastOpts !== remoteOptsHtml) {
            remoteSwitcher.innerHTML = remoteOptsHtml;
            remoteSwitcher.dataset.lastOpts = remoteOptsHtml;
            remoteSwitcher.value = activeRemoteKey;
          }
        }
      }
      if (isFleetTabActive() && !editingMachineKey) {
        renderCards();
      }
    }
  }

  function onTabShown() {
    ensureShellMounted();
    syncGlobalTopbar();
    renderCards();
    fetchMachines(true);
  }

  function scheduleLoop() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      const intervalMs = activeRemoteKey ? 15000 : (isFleetTabActive() ? 4500 : 12000);
      if (Date.now() - lastUpdatedAt >= intervalMs - 200) {
        fetchMachines(false);
      }
    }, 4500);
  }

  function init() {
    ensureShellMounted();
    ensureGlobalTopbarMounted();
    syncGlobalTopbar();
    scheduleLoop();

    window.addEventListener("pm-access-state-changed", () => {
      syncGlobalTopbar();
      fetchMachines(true);
    });
    window.addEventListener("pm-main-tab-changed", () => {
      syncGlobalTopbar();
    });
    const nickInp = document.getElementById("device-nickname-input");
    if (nickInp) {
      nickInp.addEventListener("input", syncGlobalTopbar);
      nickInp.addEventListener("change", syncGlobalTopbar);
    }

    const modalFleetBtn = document.getElementById("btn-auth-view-fleet");
    if (modalFleetBtn) {
      modalFleetBtn.addEventListener("click", () => {
        const modal = document.getElementById("account-auth-modal");
        if (modal) modal.style.display = "none";
        if (typeof window.switchMainTab === "function") window.switchMainTab("fleet");
      });
    }
    if (isFleetTabActive()) {
      onTabShown();
    } else {
      setTimeout(() => fetchMachines(false), 350);
    }
  }

  window.FleetDashboard = {
    onTabShown: onTabShown,
    refresh: () => fetchMachines(true),
    openRemote: openRemote,
    closeRemote: closeRemote,
    syncGlobalTopbar: syncGlobalTopbar
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
