// manager/public/market_overview.js — Global Market Overview Tab (🏪 ตลาดกลางรวมทุกตัวละคร)
(function () {
  'use strict';

  const state = {
    clients: [],
    loading: false,
    lastUpdated: 0,
    searchQuery: '',
    filterMode: 'all', // 'all' | 'online' | 'selling' | 'deliveries' | 'autosell' | 'full' | 'under_hours'
    viewMode: 'chars', // 'chars' | 'listings'
    listingSort: 'price_desc', // 'price_desc' | 'price_asc' | 'exp_asc' | 'char_asc'
    globalSettings: {
      durationHours: 24,
      autoCancelEnabled: false,
      cancelUnderHours: 6,
      autoCollectAfterCancel: true
    },
    pollTimer: null
  };

  window.getGlobalMarketSettings = function () {
    return Object.assign({}, state.globalSettings);
  };

  function isListingUnderHours(l) {
    if (!l || !l.expiresAt) return false;
    const exp = Number(l.expiresAt) || 0;
    if (exp <= 0) return false;
    const underH = Math.max(1, Math.min(47, Number(state.globalSettings.cancelUnderHours) || 6));
    return (exp - Date.now()) < underH * 3600000;
  }

  function esc(str) {
    if (typeof escapeHTML === 'function') return escapeHTML(str == null ? '' : String(str));
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtZ(n) {
    return `${Math.round(Number(n) || 0).toLocaleString()} z`;
  }

  function iconUrl(raw) {
    if (!raw) return '';
    if (typeof gameAssetUrl === 'function') return gameAssetUrl(raw);
    return String(raw);
  }

  function rarityCol(r) {
    if (typeof getRarityColor === 'function') return getRarityColor(r);
    return '#e2e8f0';
  }

  function itemDisplayName(it) {
    if (!it) return 'ไอเทม';
    if (typeof formatItemDisplayName === 'function') return formatItemDisplayName(it);
    return `${it.refine ? '+' + it.refine + ' ' : ''}${it.name || 'Item'}`;
  }

  function timeLeft(ts) {
    const ms = Number(ts) - Date.now();
    if (!(ms > 0)) return 'หมดเวลา';
    const h = Math.floor(ms / 3600000);
    return h >= 1 ? `${h} ชม.` : `${Math.max(1, Math.floor(ms / 60000))} นาที`;
  }

  function isDeliveryHeld(d) {
    if (!d || !d.held) return false;
    if (d.heldUntil && Number(d.heldUntil) > 0) {
      return Number(d.heldUntil) > Date.now();
    }
    return true;
  }

  function fmtHeldUntil(ts) {
    const n = Number(ts) || 0;
    if (!(n > 0)) return 'รอระบบเกมตรวจสอบ';
    try {
      return new Date(n).toLocaleString('th-TH', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return new Date(n).toLocaleString();
    }
  }

  function notify(msg, type = 'info') {
    if (typeof showToast === 'function') {
      showToast(msg, type);
      return;
    }
    console.log('[MarketOverview]', msg);
  }

  function isMarketTabVisible() {
    const pane = document.getElementById('market-overview-pane');
    return Boolean(pane && pane.classList.contains('active'));
  }

  async function fetchOverview(forceRefresh = false, singleProfileId = '') {
    if (state.loading && !forceRefresh && !singleProfileId) return;
    state.loading = true;
    renderHeaderOnly();
    try {
      const qs = new URLSearchParams();
      if (forceRefresh) qs.set('refresh', '1');
      if (singleProfileId) qs.set('profileId', singleProfileId);
      const url = `/api/market/overview${qs.toString() ? '?' + qs.toString() : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data && data.globalSettings && typeof data.globalSettings === 'object') {
        state.globalSettings = Object.assign({}, state.globalSettings, data.globalSettings);
      }
      if (data && data.success && Array.isArray(data.clients)) {
        if (singleProfileId && data.clients.length === 1) {
          const updated = data.clients[0];
          const idx = state.clients.findIndex(c => c.id === updated.id);
          if (idx >= 0) state.clients[idx] = updated;
          else state.clients.push(updated);
        } else {
          state.clients = data.clients;
        }
        state.lastUpdated = Number(data.timestamp) || Date.now();
        const autoCancelled = data.clients.reduce((s, c) => s + (Number(c && c.autoCancelledCount) || 0), 0);
        if (autoCancelled > 0) {
          notify(`🚫 ระบบ Auto-Cancel ยกเลิกของเหลือเวลาต่ำกว่า ${state.globalSettings.cancelUnderHours} ชม. ให้แล้ว ${autoCancelled} รายการ (ดึงกลับเข้ากระเป๋าเรียบร้อย)`, 'success');
        }
      }
    } catch (e) {
      console.warn('[MarketOverview] fetchOverview error:', e);
    } finally {
      state.loading = false;
      updateMainTabBadges();
      renderAll();
    }
  }

  function computeSummary() {
    let onlineCount = 0;
    let totalActiveListings = 0;
    let totalActiveSlots = 0;
    let totalListedValueZeny = 0;
    let sellingCharsCount = 0;

    let totalDeliveries = 0;
    let totalPendingZeny = 0;
    let totalPendingItems = 0;
    let charsWithDeliveries = 0;
    let claimableDeliveries = 0;
    let claimablePendingZeny = 0;
    let heldDeliveries = 0;
    let heldPendingZeny = 0;

    let autoSellEnabledCount = 0;
    let autoSellReadyChars = 0;
    let totalReadyRules = 0;
    let maxPeerRulesCount = 0;
    let emptyAutoSellCharsCount = 0;

    let underHoursCount = 0;
    let underHoursCharsCount = 0;

    for (const c of state.clients) {
      const rLen = (c.autoSell && Array.isArray(c.autoSell.rules)) ? c.autoSell.rules.length : 0;
      if (rLen > maxPeerRulesCount) maxPeerRulesCount = rLen;
    }

    for (const c of state.clients) {
      const act = Array.isArray(c.active) ? c.active : [];
      const deliv = Array.isArray(c.deliveries) ? c.deliveries : [];
      const lim = Number(c.activeLimit) || (c.premium ? 20 : 5);
      const rLen = (c.autoSell && Array.isArray(c.autoSell.rules)) ? c.autoSell.rules.length : 0;
      if (rLen === 0 && maxPeerRulesCount > 0) {
        emptyAutoSellCharsCount++;
      }

      if (c.online) {
        onlineCount++;
        totalActiveSlots += lim;
      }
      if (act.length > 0) {
        sellingCharsCount++;
        totalActiveListings += act.length;
        let charHasUnder = false;
        for (const l of act) {
          totalListedValueZeny += Number(l && l.price) || 0;
          if (isListingUnderHours(l)) {
            underHoursCount++;
            charHasUnder = true;
          }
        }
        if (charHasUnder) underHoursCharsCount++;
      }
      if (deliv.length > 0) {
        charsWithDeliveries++;
        totalDeliveries += deliv.length;
        for (const d of deliv) {
          const z = Number(d && d.zeny) || 0;
          totalPendingZeny += z;
          if (d && d.item) totalPendingItems++;
          if (isDeliveryHeld(d)) {
            heldDeliveries++;
            heldPendingZeny += z;
          } else {
            claimableDeliveries++;
            claimablePendingZeny += z;
          }
        }
      }
      if (c.autoSell && c.autoSell.enabled) {
        autoSellEnabledCount++;
        if (Number(c.autoSell.readyCount) > 0) {
          autoSellReadyChars++;
          totalReadyRules += Number(c.autoSell.readyCount) || 0;
        }
      }
    }

    return {
      totalChars: state.clients.length,
      onlineCount,
      totalActiveListings,
      totalActiveSlots,
      totalListedValueZeny,
      sellingCharsCount,
      totalDeliveries,
      totalPendingZeny,
      totalPendingItems,
      charsWithDeliveries,
      claimableDeliveries,
      claimablePendingZeny,
      heldDeliveries,
      heldPendingZeny,
      autoSellEnabledCount,
      autoSellReadyChars,
      totalReadyRules,
      maxPeerRulesCount,
      emptyAutoSellCharsCount,
      underHoursCount,
      underHoursCharsCount
    };
  }

  function updateMainTabBadges() {
    const s = computeSummary();
    const countEl = document.getElementById('tab-count-market');
    if (countEl) {
      countEl.textContent = String(s.totalActiveListings);
      countEl.title = `กำลังวางขายรวม ${s.totalActiveListings} รายการ (${s.sellingCharsCount} ตัวละคร)`;
    }
    const dotEl = document.getElementById('tab-alert-market');
    if (dotEl) {
      if (s.totalDeliveries > 0) {
        dotEl.style.display = 'inline-block';
        dotEl.title = `มีเงิน/ของรอรับในตลาดกลาง ${s.totalDeliveries} รายการ (+${fmtZ(s.totalPendingZeny)})`;
      } else {
        dotEl.style.display = 'none';
      }
    }
  }

  function ensureSkeleton() {
    const pane = document.getElementById('market-overview-pane');
    if (!pane) return null;
    if (pane.querySelector('.mko-wrap')) return pane;

    pane.innerHTML = `
      <div class="mko-wrap">
        <!-- TOP SUMMARY & GLOBAL ACTIONS -->
        <div class="mko-top-grid" id="mko-summary-grid"></div>

        <!-- SEARCH, FILTER & VIEW SWITCHER -->
        <div class="mko-toolbar">
          <div class="mko-toolbar-left">
            <input type="text" class="mko-search-input" id="mko-search-input" placeholder="🔍 ค้นหาชื่อตัวละคร, ไอเทมที่กำลังวางขาย, หรือรายการ Auto-Sell..." autocomplete="off">
            <div class="mko-filter-pills" id="mko-filter-pills"></div>
          </div>
          <div class="mko-toolbar-right">
            <div class="mko-view-switch">
              <button type="button" class="mko-view-btn active" data-mko-view="chars">👤 แยกตามตัวละคร</button>
              <button type="button" class="mko-view-btn" data-mko-view="listings">📋 ตารางรวมของที่ขายทุกจอ</button>
            </div>
          </div>
        </div>

        <!-- MAIN CONTENT BODY -->
        <div id="mko-body-container"></div>
      </div>
    `;

    const searchInp = pane.querySelector('#mko-search-input');
    if (searchInp) {
      searchInp.addEventListener('input', e => {
        state.searchQuery = String(e.target.value || '').trim().toLowerCase();
        renderBodyOnly();
      });
    }

    pane.addEventListener('click', onPaneClick);
    pane.addEventListener('change', onPaneChange);
    return pane;
  }

  function renderHeaderOnly() {
    const grid = document.getElementById('mko-summary-grid');
    if (!grid) return;
    const activeElId = document.activeElement && document.activeElement.id;
    if (activeElId === 'mko-cancel-under-hours' || activeElId === 'mko-global-duration') {
      return;
    }
    const s = computeSummary();
    const gs = state.globalSettings || {};
    const durH = [12, 24, 48].includes(Number(gs.durationHours)) ? Number(gs.durationHours) : 24;
    const underH = Math.max(1, Math.min(47, Number(gs.cancelUnderHours) || 6));
    const autoCancelOn = Boolean(gs.autoCancelEnabled);

    grid.innerHTML = `
      <div class="mko-stat-card">
        <div class="mko-stat-head">
          <span>📦 กำลังวางขายรวมทุกจอ</span>
          <span class="mko-stat-chip">${s.sellingCharsCount} ตัวละครกำลังขาย</span>
        </div>
        <div class="mko-stat-main">${s.totalActiveListings} <small style="font-size:13px; color:#94a3b8; font-weight:600;">/ ${s.totalActiveSlots || '--'} ช่อง</small></div>
        <div class="mko-stat-sub">
          <span>มูลค่าตั้งขายรวม: <b style="color:#fde047;">${fmtZ(s.totalListedValueZeny)}</b></span>
          ${s.underHoursCount > 0 ? `<span style="color:#fbbf24;">⚠️ เหลือ &lt; ${underH} ชม.: <b>${s.underHoursCount} ชิ้น</b></span>` : ''}
        </div>
      </div>

      <div class="mko-stat-card ${s.totalDeliveries > 0 ? 'highlight-gold' : ''}">
        <div class="mko-stat-head">
          <span>📬 ขายออก / รอรับเงินและของคืน</span>
          <span class="mko-stat-chip">${s.charsWithDeliveries} ตัวละครมีของรอรับ</span>
        </div>
        <div class="mko-stat-main gold">+${fmtZ(s.totalPendingZeny)}</div>
        <div class="mko-stat-sub">
          <span>พร้อมกดรับทันที: <b style="color:#4ade80;">${s.claimableDeliveries} รายการ (+${fmtZ(s.claimablePendingZeny)})</b>${s.totalPendingItems > 0 ? ` · ไอเทมคืน ${s.totalPendingItems} ชิ้น` : ''}</span>
          ${s.heldDeliveries > 0 ? `<span style="color:#fbbf24;" title="เซิร์ฟเวอร์เกมกักเงินชั่วคราว (48–60 ชม.) สำหรับไอเทมที่ราคาขายตลาดสูงกว่าราคากลางร้านค้า NPC เช่น Elunium หรือการ์ด จะปลดล็อคให้กดรับได้เมื่อถึงเวลาที่กำหนด">⏳ รอเกมตรวจสอบ: <b>${s.heldDeliveries} รายการ (+${fmtZ(s.heldPendingZeny)})</b></span>` : ''}
        </div>
      </div>

      <div class="mko-stat-card">
        <div class="mko-stat-head">
          <span>🤖 ระบบ Auto-Sell ตลาดกลาง</span>
          <span class="mko-stat-chip">ออนไลน์ ${s.onlineCount}/${s.totalChars} จอ</span>
        </div>
        <div class="mko-stat-main emerald">${s.autoSellEnabledCount} <small style="font-size:13px; color:#94a3b8; font-weight:600;">/ ${s.totalChars} จอเปิดใช้ (ตั้ง ${durH} ชม.)</small></div>
        <div class="mko-stat-sub">
          <span>พร้อมลงขายในกระเป๋าตอนนี้: <b style="color:#34d399;">${s.autoSellReadyChars} จอ (${s.totalReadyRules} รายการ)</b></span>
        </div>
      </div>

      <div class="mko-actions-card">
        <div class="mko-stat-head">
          <span>⚡ แผงควบคุมตลาดกลางทุกจอ (Global Market Control)</span>
          <span style="font-size:11px; color:#7dd3fc;">${state.loading ? '⏳ กำลังซิงค์...' : (state.lastUpdated ? 'ซิงค์ล่าสุดเมื่อสักครู่' : '')}</span>
        </div>
        <div class="mko-actions-btns">
          <button type="button" class="mko-btn gold" data-mko-act="claim-all" ${s.onlineCount === 0 ? 'disabled' : ''} title="กดรับเงินจากการขายและไอเทมหมดเวลาของทุกจอที่ออนไลน์พร้อมกัน (รายการที่ติดเวลารอตรวจสอบจากเซิร์ฟเวอร์เกมจะรับได้เมื่อครบเวลา)">
            📥 รับเงิน/ของคืนทุกจอ ${s.claimableDeliveries > 0 ? `(${s.claimableDeliveries})` : (s.heldDeliveries > 0 ? `(รอตรวจ ${s.heldDeliveries})` : '')}
          </button>
          <button type="button" class="mko-btn emerald" data-mko-act="autosell-all" ${s.onlineCount === 0 ? 'disabled' : ''} title="สั่งให้ทุกจอที่ออนไลน์ตรวจสอบกระเป๋าและนำไอเทมตามรายการ Auto-Sell ขึ้นวางขายทันที">
            ⚡ สั่งเช็ค Auto-Sell ทุกจอ
          </button>
          <button type="button" class="mko-btn ${s.underHoursCount > 0 ? 'danger' : ''}" data-mko-act="cancel-under-hours" ${s.onlineCount === 0 ? 'disabled' : ''} title="ยกเลิกรายการขายทุกจอที่เหลือเวลาในตลาดต่ำกว่า ${underH} ชั่วโมง และรับของกลับเข้ากระเป๋าทันที">
            🚫 ยกเลิกของ &lt; ${underH} ชม. ${s.underHoursCount > 0 ? `(${s.underHoursCount})` : '(0)'}
          </button>
          <button type="button" class="mko-btn danger" data-mko-act="cancel-unconfigured" ${s.onlineCount === 0 ? 'disabled' : ''} title="ยกเลิกรายการที่วางขายอยู่ทุกจอที่ไม่อยู่ในรายการ Auto-Sell และไม่ใช่ของ Sniper พร้อมรับของคืนเข้ากระเป๋าทันที">
            🧹 ยกเลิกของนอก Auto-Sell ทุกจอ
          </button>
          ${s.emptyAutoSellCharsCount > 0 ? `
            <button type="button" class="mko-btn purple" data-mko-act="restore-empty-autosell" title="คัดลอกรายการ List Auto-Sell (${s.maxPeerRulesCount} รายการ) จากจอหลักไปใส่ให้จอที่ List ว่างอยู่ (${s.emptyAutoSellCharsCount} จอ) ทันที">
              🔄 กู้คืน List จอที่ว่าง (${s.emptyAutoSellCharsCount})
            </button>
          ` : ''}
          <button type="button" class="mko-btn sky" data-mko-act="refresh" ${state.loading ? 'disabled' : ''} title="ดึงรายการวางขายและสถานะตลาดล่าสุดจากทุกจอ">
            🔄 ${state.loading ? 'กำลังโหลด...' : 'รีเฟรชตลาด'}
          </button>
        </div>
        <div class="mko-global-settings-bar">
          <div class="mko-global-setting-group" title="เลือกระยะเวลาตั้งลงขายในตลาดกลาง มีผลกับทุกจอทันทีเวลาบอทลงขาย Auto-Sell">
            <span class="mko-gs-label">⏱️ ระยะเวลาตั้งขาย (ทุกจอ):</span>
            <select id="mko-global-duration" class="mko-global-select" data-mko-global-duration>
              <option value="12" ${durH === 12 ? 'selected' : ''}>12 ชั่วโมง</option>
              <option value="24" ${durH === 24 ? 'selected' : ''}>24 ชั่วโมง</option>
              <option value="48" ${durH === 48 ? 'selected' : ''}>48 ชั่วโมง</option>
            </select>
          </div>

          <div class="mko-global-setting-group" title="ยกเลิกการขายทันทีเมื่อไอเทมในตลาดเหลือเวลาต่ำกว่าชั่วโมงที่กำหนด (พร้อมรับของคืนเข้ากระเป๋าอัตโนมัติ)">
            <label class="mko-autocancel-toggle ${autoCancelOn ? 'on' : ''}">
              <input type="checkbox" id="mko-autocancel-toggle" data-mko-autocancel-toggle ${autoCancelOn ? 'checked' : ''}>
              <span>🚫 ยกเลิกอัตโนมัติเมื่อเหลือ &lt;</span>
            </label>
            <div class="mko-hours-input-wrap">
              <input type="number" id="mko-cancel-under-hours" class="mko-hours-input" data-mko-cancel-hours min="1" max="47" step="1" value="${underH}">
              <span>ชม.</span>
            </div>
          </div>
        </div>
      </div>
    `;

    const pillsEl = document.getElementById('mko-filter-pills');
    if (pillsEl) {
      const counts = {
        all: state.clients.length,
        online: state.clients.filter(c => c.online).length,
        selling: state.clients.filter(c => (c.active || []).length > 0).length,
        under_hours: state.clients.filter(c => (c.active || []).some(isListingUnderHours)).length,
        deliveries: state.clients.filter(c => (c.deliveries || []).length > 0).length,
        autosell: state.clients.filter(c => c.autoSell && c.autoSell.enabled).length,
        full: state.clients.filter(c => c.online && (c.active || []).length >= (Number(c.activeLimit) || 5)).length
      };
      const defs = [
        ['all', `ทั้งหมด (${counts.all})`],
        ['online', `🟢 ออนไลน์ (${counts.online})`],
        ['selling', `📦 กำลังขาย (${counts.selling})`],
        ['under_hours', `⚠️ เหลือ < ${underH} ชม. (${counts.under_hours})`],
        ['deliveries', `📬 มีของ/เงินรอรับ (${counts.deliveries})`],
        ['autosell', `🤖 เปิด Auto-Sell (${counts.autosell})`],
        ['full', `🔴 ช่องขายเต็ม (${counts.full})`]
      ];
      pillsEl.innerHTML = defs
        .map(([k, lbl]) => `<button type="button" class="mko-pill ${state.filterMode === k ? 'active' : ''}" data-mko-filter="${k}">${lbl}</button>`)
        .join('');
    }

    document.querySelectorAll('[data-mko-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mkoView === state.viewMode);
    });
  }

  function doesListingMatchQuery(c, l, q) {
    if (!q) return true;
    const query = String(q).trim().toLowerCase();
    if (!query) return true;
    const it = (l && l.item) || {};
    const disp = itemDisplayName(it).toLowerCase();
    const rawName = String(it.name || l.name || '').toLowerCase();
    const charName = String((c && c.charName) || '').toLowerCase();
    const profName = String((c && c.name) || '').toLowerCase();
    return disp.includes(query) || rawName.includes(query) || charName.includes(query) || profName.includes(query);
  }

  function getMatchedListings(filteredClients) {
    const rows = [];
    for (const c of filteredClients) {
      const act = Array.isArray(c.active) ? c.active : [];
      for (const l of act) {
        if (state.filterMode === 'under_hours' && !isListingUnderHours(l)) continue;
        if (state.searchQuery && !doesListingMatchQuery(c, l, state.searchQuery)) continue;
        const it = l.item || {};
        const qty = Math.max(1, Number(l.qty) || 1);
        const total = Number(l.price) || 0;
        const unit = Math.round(total / qty);
        rows.push({
          client: c,
          listing: l,
          item: it,
          listingId: Number(l.listingId ?? l.id) || 0,
          qty,
          total,
          unit,
          expiresAt: Number(l.expiresAt) || 0
        });
      }
    }
    return rows;
  }

  function renderSearchActionBannerHtml(filteredClients) {
    if (!state.searchQuery) return '';
    const q = state.searchQuery;
    const matchedRows = getMatchedListings(filteredClients);
    const onlineRows = matchedRows.filter(r => r.client && r.client.online);
    const totalQty = onlineRows.reduce((s, r) => s + r.qty, 0);
    const totalZeny = onlineRows.reduce((s, r) => s + r.total, 0);
    const charIds = new Set(onlineRows.map(r => r.client.id));

    let matchedAsRulesCount = 0;
    let matchedAsCharsCount = 0;
    for (const c of state.clients) {
      const rules = (c.autoSell && Array.isArray(c.autoSell.rules)) ? c.autoSell.rules : [];
      const hit = rules.filter(r => r && String(r.itemName || r.name || '').toLowerCase().includes(q)).length;
      if (hit > 0) {
        matchedAsRulesCount += hit;
        matchedAsCharsCount++;
      }
    }

    return `
      <div class="mko-char-card" style="margin-bottom:12px; border:1px solid rgba(244,63,94,0.45); background:linear-gradient(135deg, rgba(15,23,42,0.95), rgba(88,28,45,0.38)); padding:12px 16px;">
        <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px;">
          <div style="display:flex; flex-direction:column; gap:4px;">
            <div style="font-size:14px; font-weight:700; color:#f8fafc;">
              🔍 ผลการค้นหา <span style="color:#38bdf8;">"${esc(q)}"</span>:
              ${onlineRows.length > 0
                ? `<span style="color:#fda4af;">พบกำลังวางขาย <b>${onlineRows.length} รายการ</b> (รวม ${totalQty.toLocaleString()} ชิ้น · ${charIds.size} จอ · มูลค่ารวม <b style="color:#fde047;">${fmtZ(totalZeny)}</b>)</span>`
                : `<span style="color:#94a3b8;">ไม่พบรายการที่กำลังวางขายอยู่ในขณะนี้</span>`}
            </div>
            <div style="font-size:12px; color:#cbd5e1;">
              ${matchedAsRulesCount > 0
                ? `📋 พบอยู่ในรายการ <b>List Auto-Sell</b> ของ <b>${matchedAsCharsCount} จอ</b> — สามารถกดยกเลิกขายพร้อมลบออกจาก Auto-Sell ทุกจอได้ทันที`
                : `💡 กดปุ่มด้านขวาเพื่อยกเลิกรายการที่ค้นหาทั้งหมดทุกจอและดึงของกลับเข้ากระเป๋าได้ในคลิกเดียว`}
            </div>
          </div>
          <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px;">
            <button type="button" class="mko-btn danger" data-mko-act="cancel-matched" ${onlineRows.length === 0 ? 'disabled' : ''} title="ยกเลิกรายการที่ตรงกับคำค้นหาทั้งหมดทุกจอ และรับของคืนเข้ากระเป๋าทันที">
              🚫 ยกเลิกขายที่ค้นหาทั้งหมด (${onlineRows.length} รายการ) + รับของคืน
            </button>
            ${(onlineRows.length > 0 || matchedAsRulesCount > 0) ? `
              <button type="button" class="mko-btn purple" data-mko-act="cancel-and-remove-autosell" title="ยกเลิกขายที่ค้นหาทั้งหมด รับของคืนเข้ากระเป๋า และลบออกจาก List Auto-Sell ทุกจอเพื่อไม่ให้บอทนำกลับมาตั้งขายซ้ำ">
                🗑️ ยกเลิกขาย + ลบออกจาก Auto-Sell ทุกจอ${matchedAsCharsCount > 0 ? ` (${matchedAsCharsCount} จอ)` : ''}
              </button>
            ` : ''}
            <button type="button" class="mko-btn" data-mko-act="clear-search" title="ล้างคำค้นหา">
              ✖ ล้างคำค้นหา
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function filterClients() {
    return state.clients.filter(c => {
      const act = Array.isArray(c.active) ? c.active : [];
      const deliv = Array.isArray(c.deliveries) ? c.deliveries : [];
      const lim = Number(c.activeLimit) || (c.premium ? 20 : 5);

      if (state.filterMode === 'online' && !c.online) return false;
      if (state.filterMode === 'selling' && act.length === 0) return false;
      if (state.filterMode === 'under_hours' && !act.some(isListingUnderHours)) return false;
      if (state.filterMode === 'deliveries' && deliv.length === 0) return false;
      if (state.filterMode === 'autosell' && !(c.autoSell && c.autoSell.enabled)) return false;
      if (state.filterMode === 'full' && !(c.online && act.length >= lim)) return false;

      if (state.searchQuery) {
        const q = state.searchQuery;
        const hay = [
          c.name,
          c.charName,
          c.job,
          c.currentMap,
          ...act.map(l => itemDisplayName((l && l.item) || {}) + ' ' + ((l && l.item && l.item.name) || '')),
          ...deliv.map(d => (d && d.item && d.item.name) || d.name || ''),
          ...((c.autoSell && c.autoSell.rules) || []).map(r => r.itemName || '')
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderCharacterCardHtml(c) {
    const act = Array.isArray(c.active) ? c.active : [];
    const deliv = Array.isArray(c.deliveries) ? c.deliveries : [];
    const lim = Number(c.activeLimit) || (c.premium ? 20 : 5);
    const isFull = c.online && act.length >= lim;
    const as = c.autoSell || { enabled: false, rules: [], ruleStates: {}, readyCount: 0 };
    const rules = Array.isArray(as.rules) ? as.rules : [];
    const rs = as.ruleStates || {};

    const pendingZeny = deliv.reduce((sum, d) => sum + (Number(d && d.zeny) || 0), 0);
    const claimableDeliv = deliv.filter(d => !isDeliveryHeld(d));
    const heldDeliv = deliv.filter(isDeliveryHeld);
    const claimableZeny = claimableDeliv.reduce((sum, d) => sum + (Number(d && d.zeny) || 0), 0);
    const heldZeny = heldDeliv.reduce((sum, d) => sum + (Number(d && d.zeny) || 0), 0);
    const displayChar = c.charName ? `${c.charName}` : c.name;
    const subProfile = c.charName && c.charName !== c.name ? `(${c.name})` : '';
    const lvJobText = [c.job || '', c.baseLv ? `Lv.${c.baseLv}${c.jobLv ? '/' + c.jobLv : ''}` : ''].filter(Boolean).join(' ');

    const charSelfMatches = state.searchQuery
      ? [c.name, c.charName, c.job, c.currentMap].join(' ').toLowerCase().includes(state.searchQuery)
      : true;
    const matchedActOnChar = state.searchQuery
      ? act.filter(l => doesListingMatchQuery(c, l, state.searchQuery))
      : act;
    const visibleAct = (state.searchQuery && !charSelfMatches) ? matchedActOnChar : act;
    const visibleDeliv = (state.searchQuery && !charSelfMatches)
      ? deliv.filter(d => String((d && d.item && d.item.name) || d.name || '').toLowerCase().includes(state.searchQuery))
      : deliv;

    // Active listings cards
    let activeHtml = '';
    if (visibleAct.length > 0 || visibleDeliv.length > 0) {
      const itemCards = [];

      // Deliveries waiting to claim first (highlighted in gold)
      for (const d of visibleDeliv) {
        const it = d.item || null;
        const did = d.deliveryId ?? d.id;
        const reason = String(d.reason || '').toLowerCase();
        const held = isDeliveryHeld(d);
        const heldTimeStr = held ? fmtHeldUntil(d.heldUntil) : '';
        const badgeTxt = reason.includes('sale') || reason.includes('sold') || (d.zeny > 0 && !it)
          ? '💰 ขายออกแล้ว!'
          : reason.includes('cancel')
          ? '🚫 ของยกเลิกขาย'
          : reason.includes('expire')
          ? '⏰ หมดเวลาขาย'
          : '📬 รอรับ';
        itemCards.push(`
          <div class="mko-item-card delivery" style="${held ? 'border-color:rgba(245,158,11,0.35); background:linear-gradient(135deg, rgba(30,41,59,0.85), rgba(120,53,15,0.22));' : ''}">
            <div class="mko-item-left">
              <div class="mko-item-icon" style="--rc:${it ? rarityCol(it.rarity) : '#facc15'};">
                ${it && it.icon ? `<img src="${esc(iconUrl(it.icon))}" alt="">` : '💰'}
              </div>
              <div class="mko-item-info">
                <div class="mko-item-title" style="color:${it ? rarityCol(it.rarity) : '#fde047'};">
                  ${esc(badgeTxt)} ${it ? esc(itemDisplayName(it)) : esc(d.name || 'รับเงินจากการขาย')}
                  ${it && it.qty > 1 ? `<span style="color:#f8fafc;">x${Number(it.qty).toLocaleString()}</span>` : ''}
                </div>
                <div class="mko-item-sub">
                  ${d.zeny > 0 ? `<b style="color:#fde047;">+${fmtZ(d.zeny)}</b>` : ''}
                  ${held ? `<span style="color:#fbbf24; font-weight:600;" title="ระบบของเซิร์ฟเวอร์เกมกักเงินตรวจสอบอัตโนมัติ เนื่องจากราคาขายในตลาดสูงกว่าราคากลางร้านค้า NPC มาก — จะปลดล็อคให้กดรับได้ตามวันเวลาที่แสดง">⏳ รอเกมตรวจสอบ · รับได้ ${esc(heldTimeStr)}</span>` : ''}
                  ${d.note ? `<span>${esc(d.note)}</span>` : ''}
                </div>
              </div>
            </div>
            <div class="mko-item-right">
              ${held ? `
                <button type="button" class="mko-btn sm" disabled style="opacity:0.75; cursor:not-allowed; border-color:rgba(245,158,11,0.45); color:#fde68a; background:rgba(120,53,15,0.35);" title="เซิร์ฟเวอร์เกมล็อคเวลารอตรวจสอบอัตโนมัติ (ราคาสูงกว่าราคาอ้างอิง NPC) — จะกดรับได้เมื่อถึงเวลา ${esc(heldTimeStr)}">
                  ⏳ รอตรวจ (${esc(heldTimeStr)})
                </button>
              ` : `
                <button type="button" class="mko-btn gold sm" data-mko-collect="${esc(did)}" data-profile-id="${esc(c.id)}" ${c.online ? '' : 'disabled'}>
                  📥 กดรับ
                </button>
              `}
            </div>
          </div>
        `);
      }

      // Active listings
      const underH = Math.max(1, Math.min(47, Number(state.globalSettings.cancelUnderHours) || 6));
      for (const l of visibleAct) {
        const it = l.item || {};
        const lid = l.listingId ?? l.id;
        const qty = Math.max(1, Number(l.qty) || 1);
        const total = Number(l.price) || 0;
        const unit = Math.round(total / qty);
        const affixCount = Array.isArray(it.affixes) ? it.affixes.length : 0;
        const isUnder = isListingUnderHours(l);
        itemCards.push(`
          <div class="mko-item-card ${isUnder ? 'under-hours' : ''}">
            <div class="mko-item-left">
              <div class="mko-item-icon" style="--rc:${rarityCol(it.rarity)};">
                ${it.icon ? `<img src="${esc(iconUrl(it.icon))}" alt="">` : '📦'}
              </div>
              <div class="mko-item-info">
                <div class="mko-item-title" style="color:${rarityCol(it.rarity)};" title="${esc(itemDisplayName(it))}">
                  ${esc(itemDisplayName(it))} ${qty > 1 ? `<span style="color:#38bdf8;">x${qty.toLocaleString()}</span>` : ''}
                </div>
                <div class="mko-item-sub">
                  ${isUnder
                    ? `<span class="mko-time-warn" title="เวลาที่เหลือต่ำกว่า ${underH} ชม. ที่ตั้งไว้">⚠️ ⏳ ${timeLeft(l.expiresAt)} (&lt;${underH}ชม.)</span>`
                    : `<span>⏳ ${timeLeft(l.expiresAt)}</span>`}
                  ${affixCount > 0 ? `<span style="color:#a78bfa;">✨ ${affixCount} ออฟ</span>` : ''}
                </div>
              </div>
            </div>
            <div class="mko-item-right">
              <div class="mko-item-price-box">
                <div class="mko-item-price">${fmtZ(total)}</div>
                ${qty > 1 ? `<div class="mko-item-unit">${fmtZ(unit)}/ชิ้น</div>` : ''}
              </div>
              <button type="button" class="mko-btn danger sm" data-mko-cancel="${esc(lid)}" data-profile-id="${esc(c.id)}" data-item-name="${esc(itemDisplayName(it))}" ${c.online ? '' : 'disabled'} title="ยกเลิกการวางขายรายการนี้">
                ❌ ยกเลิกขาย
              </button>
            </div>
          </div>
        `);
      }

      activeHtml = `<div class="mko-listings-grid">${itemCards.join('')}</div>`;
    } else if (state.searchQuery && act.length > 0) {
      activeHtml = `<div class="mko-empty-inline">🔍 ไม่มีไอเทมที่กำลังวางขายตรงกับ "${esc(state.searchQuery)}" บนตัวละครนี้ (พบเฉพาะในรายการ Auto-Sell ด้านล่าง)</div>`;
    } else {
      activeHtml = `<div class="mko-empty-inline">${c.online ? '✨ ตอนนี้ยังไม่มีไอเทมที่กำลังวางขายในตลาดกลาง — กดปุ่ม "🎒 ขายของ (กระเป๋า)" ด้านขวาเพื่อเลือกไอเทมลงขายได้ทันที' : '⚪ จอนี้ออฟไลน์อยู่ — สามารถกดดูหรือแก้ไข "📋 List Auto-Sell" ล่วงหน้าได้'}</div>`;
    }

    // Auto-Sell summary strip
    let asStripHtml = '';
    if (rules.length > 0) {
      const chips = rules.slice(0, 10).map(r => {
        const st = rs[r.id] || null;
        const bagQty = st ? Number(st.bagQty) || 0 : 0;
        const ready = Boolean(st && st.ready);
        const cls = ready ? 'mko-as-chip ready' : bagQty > 0 ? 'mko-as-chip inbag' : 'mko-as-chip';
        const statusTxt = c.online
          ? (ready ? `✅ มี ${bagQty}/${r.minQty}` : `(${bagQty}/${r.minQty})`)
          : `(≥${r.minQty})`;
        return `
          <span class="${cls}" title="${esc(r.itemName)} — ตั้งขายเมื่อครบ ≥ ${r.minQty} ชิ้น">
            ${st && st.icon ? `<img src="${esc(iconUrl(st.icon))}" alt="">` : '🏷️'}
            <span>${esc(r.itemName)}</span>
            <b>${esc(statusTxt)}</b>
          </span>
        `;
      });
      if (rules.length > 10) {
        chips.push(`<span class="mko-as-chip">+อีก ${rules.length - 10} รายการ</span>`);
      }
      asStripHtml = `
        <div class="mko-autosell-strip">
          <span class="mko-as-lbl">🤖 รายการ Auto-Sell (${rules.length}):</span>
          ${chips.join('')}
        </div>
      `;
    }

    const charUnderCount = act.filter(isListingUnderHours).length;
    const underHLabel = Math.max(1, Math.min(47, Number(state.globalSettings.cancelUnderHours) || 6));

    return `
      <div class="mko-char-card ${deliv.length > 0 ? 'has-deliveries' : ''} ${c.online ? '' : 'offline'}" data-profile-id="${esc(c.id)}">
        <div class="mko-char-top">
          <div class="mko-char-identity">
            <span class="mko-online-dot ${c.online ? 'online' : ''}" title="${c.online ? 'ออนไลน์' : 'ออฟไลน์'}"></span>
            <span class="mko-char-name">${esc(displayChar)}</span>
            ${subProfile ? `<span class="mko-prof-sub">${esc(subProfile)}</span>` : ''}
            ${lvJobText ? `<span class="mko-badge">${esc(lvJobText)}</span>` : ''}
            ${c.currentMap ? `<span class="mko-badge">📍 ${esc(c.currentMap)}</span>` : ''}
            ${c.premium ? `<span class="mko-badge vip">💎 VIP (20 ช่อง)</span>` : `<span class="mko-badge">ทั่วไป (${lim} ช่อง)</span>`}
            <span class="mko-badge zeny">💰 ${fmtZ(c.zeny)}</span>
            <span class="mko-badge slots ${isFull ? 'full' : ''}">📦 วางขาย ${act.length}/${lim} ช่อง</span>
            ${state.searchQuery && matchedActOnChar.length > 0 ? `<span class="mko-badge slots full">🔍 ตรงที่ค้นหา ${matchedActOnChar.length} รายการ</span>` : ''}
            ${charUnderCount > 0 ? `<span class="mko-badge slots full">⚠️ เหลือ &lt; ${underHLabel} ชม. (${charUnderCount})</span>` : ''}
            ${claimableDeliv.length > 0 ? `<span class="mko-badge deliv">📬 พร้อมรับ ${claimableDeliv.length} รายการ${claimableZeny > 0 ? ` (+${fmtZ(claimableZeny)})` : ''}</span>` : ''}
            ${heldDeliv.length > 0 ? `<span class="mko-badge" style="background:rgba(245,158,11,0.16); border-color:rgba(245,158,11,0.45); color:#fcd34d;" title="เซิร์ฟเวอร์เกมกักเงินชั่วคราวเนื่องจากราคาตลาดสูงกว่าราคากลาง NPC — จะรับได้เมื่อครบเวลาตรวจสอบ">⏳ รอเกมตรวจ ${heldDeliv.length} รายการ${heldZeny > 0 ? ` (+${fmtZ(heldZeny)})` : ''}</span>` : ''}
          </div>

          <div class="mko-char-controls">
            <label class="mko-autosell-toggle ${as.enabled ? 'on' : ''}" title="เปิด/ปิด ระบบนำของในกระเป๋าไปลงขายตลาดกลางอัตโนมัติ (Auto-Sell) ของตัวละครนี้">
              <input type="checkbox" data-mko-toggle-as="${esc(c.id)}" ${as.enabled ? 'checked' : ''}>
              <span>🤖 Auto-Sell: ${as.enabled ? 'เปิด' : 'ปิด'}</span>
            </label>

            <button type="button" class="mko-btn purple sm" data-mko-open-autosell="${esc(c.id)}" title="เปิดดู/เพิ่ม/ลบ/คัดลอกรายการ List Auto-Sell ของตัวละครนี้">
              📋 List Auto-Sell (${rules.length})
            </button>

            ${rules.length === 0 && state.clients.some(x => x && x.id !== c.id && x.autoSell && Array.isArray(x.autoSell.rules) && x.autoSell.rules.length > 0) ? `
              <button type="button" class="mko-btn emerald sm" data-mko-restore-autosell="${esc(c.id)}" title="คัดลอกรายการ List Auto-Sell จากจออื่นที่มีข้อมูลมาใส่ให้ตัวละครนี้และเปิด Auto-Sell ทันที">
                🔄 กู้คืน List จากจออื่น
              </button>
            ` : ''}

            <button type="button" class="mko-btn sky sm" data-mko-open-bag-sell="${esc(c.id)}" ${c.online ? '' : 'disabled'} title="เปิดกระเป๋าของตัวละครนี้เพื่อเลือกไอเทมตั้งราคาขายลงตลาดกลาง">
              🎒 ขายของ (กระเป๋า)
            </button>

            ${state.searchQuery && matchedActOnChar.length > 0 ? `
              <button type="button" class="mko-btn danger sm" data-mko-cancel-matched-profile="${esc(c.id)}" ${c.online ? '' : 'disabled'} title="ยกเลิกเฉพาะรายการของตัวละครนี้ที่ตรงกับคำค้นหา '${esc(state.searchQuery)}' (${matchedActOnChar.length} รายการ) และรับคืนเข้ากระเป๋า">
                🚫 ยกเลิกที่ค้นหา (${matchedActOnChar.length})
              </button>
            ` : ''}

            ${charUnderCount > 0 ? `
              <button type="button" class="mko-btn danger sm" data-mko-cancel-under-profile="${esc(c.id)}" ${c.online ? '' : 'disabled'} title="ยกเลิกเฉพาะรายการของตัวละครนี้ที่เหลือเวลาต่ำกว่า ${underHLabel} ชั่วโมง และดึงกลับเข้ากระเป๋า">
                🚫 ยกเลิก &lt; ${underHLabel} ชม. (${charUnderCount})
              </button>
            ` : ''}

            ${claimableDeliv.length > 0 ? `
              <button type="button" class="mko-btn gold sm" data-mko-collect-profile="${esc(c.id)}" ${c.online ? '' : 'disabled'} title="กดรับเงินและไอเทมที่พร้อมรับของตัวละครนี้ทั้งหมด (${claimableDeliv.length} รายการ)">
                📥 รับเงิน/ของคืน (${claimableDeliv.length})
              </button>
            ` : (heldDeliv.length > 0 ? `
              <button type="button" class="mko-btn sm" disabled style="opacity:0.75; cursor:not-allowed; border-color:rgba(245,158,11,0.45); color:#fde68a; background:rgba(120,53,15,0.35);" title="ทุกรายการของตัวละครนี้ยังติดเวลารอตรวจสอบจากเซิร์ฟเวอร์เกม จะกดรับได้เมื่อถึงเวลาที่กำหนด">
                ⏳ รอเกมตรวจสอบ (${heldDeliv.length})
              </button>
            ` : '')}
          </div>
        </div>

        ${activeHtml}
        ${asStripHtml}
      </div>
    `;
  }

  function renderAllListingsTableHtml(filteredClients) {
    const rows = getMatchedListings(filteredClients);

    if (rows.length === 0) {
      return `<div class="mko-char-card"><div class="mko-empty-inline" style="text-align:center; padding:24px;">📦 ไม่มีรายการไอเทมที่กำลังวางขายอยู่ตามเงื่อนไขที่เลือก</div></div>`;
    }

    rows.sort((a, b) => {
      if (state.listingSort === 'price_asc') return a.unit - b.unit;
      if (state.listingSort === 'exp_asc') return a.expiresAt - b.expiresAt;
      if (state.listingSort === 'char_asc') return (a.client.charName || a.client.name).localeCompare(b.client.charName || b.client.name);
      return b.total - a.total;
    });

    const totalQty = rows.reduce((s, r) => s + r.qty, 0);
    const totalZeny = rows.reduce((s, r) => s + r.total, 0);

    return `
      <div class="mko-table-wrap">
        <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; padding:10px 14px; border-bottom:1px solid rgba(148,163,184,0.15); background:rgba(15,23,42,0.6);">
          <div style="font-size:13px; color:#cbd5e1;">
            📋 แสดงรายการวางขาย <b>${rows.length} รายการ</b> (รวม <b>${totalQty.toLocaleString()} ชิ้น</b> · มูลค่ารวม <b style="color:#fde047;">${fmtZ(totalZeny)}</b>)
          </div>
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span style="font-size:12px; color:#94a3b8;">เรียงตาม:</span>
            <button type="button" class="mko-pill ${state.listingSort === 'price_desc' ? 'active' : ''}" data-mko-sort="price_desc">💰 ราคารวมสูงสุด</button>
            <button type="button" class="mko-pill ${state.listingSort === 'price_asc' ? 'active' : ''}" data-mko-sort="price_asc">🏷️ ราคาต่อชิ้นต่ำสุด</button>
            <button type="button" class="mko-pill ${state.listingSort === 'exp_asc' ? 'active' : ''}" data-mko-sort="exp_asc">⏳ เวลาเหลือน้อยสุด</button>
            <button type="button" class="mko-pill ${state.listingSort === 'char_asc' ? 'active' : ''}" data-mko-sort="char_asc">👤 ชื่อตัวละคร</button>
          </div>
        </div>
        <table class="mko-table">
          <thead>
            <tr>
              <th>ไอเทมที่วางขาย</th>
              <th>ตัวละครผู้ขาย</th>
              <th>จำนวน</th>
              <th>ราคาต่อชิ้น</th>
              <th>ราคารวม</th>
              <th>เวลาที่เหลือ</th>
              <th style="text-align:right;">การจัดการ</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => {
              const lid = r.listing.listingId ?? r.listing.id;
              const charLabel = r.client.charName ? `${r.client.charName} (${r.client.name})` : r.client.name;
              const isUnder = isListingUnderHours(r.listing);
              const underH = Math.max(1, Math.min(47, Number(state.globalSettings.cancelUnderHours) || 6));
              return `
                <tr class="${isUnder ? 'mko-row-under-hours' : ''}">
                  <td>
                    <div style="display:flex; align-items:center; gap:9px;">
                      <div class="mko-item-icon" style="--rc:${rarityCol(r.item.rarity)}; width:32px; height:32px;">
                        ${r.item.icon ? `<img src="${esc(iconUrl(r.item.icon))}" alt="" style="width:24px;height:24px;">` : '📦'}
                      </div>
                      <div>
                        <div style="font-weight:700; color:${rarityCol(r.item.rarity)};">${esc(itemDisplayName(r.item))}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="mko-online-dot ${r.client.online ? 'online' : ''}" style="display:inline-block; margin-right:6px;"></span>
                    <b>${esc(charLabel)}</b>
                  </td>
                  <td><b>x${r.qty.toLocaleString()}</b></td>
                  <td style="font-family:'JetBrains Mono',monospace;">${fmtZ(r.unit)}</td>
                  <td style="font-family:'JetBrains Mono',monospace; color:#fde047; font-weight:700;">${fmtZ(r.total)}</td>
                  <td>${isUnder ? `<span class="mko-time-warn">⚠️ ⏳ ${timeLeft(r.expiresAt)} (&lt;${underH}ชม.)</span>` : `⏳ ${timeLeft(r.expiresAt)}`}</td>
                  <td style="text-align:right;">
                    <div style="display:inline-flex; gap:6px;">
                      <button type="button" class="mko-btn sky sm" data-mko-open-bag-sell="${esc(r.client.id)}" ${r.client.online ? '' : 'disabled'}>🎒 กระเป๋า</button>
                      <button type="button" class="mko-btn danger sm" data-mko-cancel="${esc(lid)}" data-profile-id="${esc(r.client.id)}" data-item-name="${esc(itemDisplayName(r.item))}" ${r.client.online ? '' : 'disabled'}>❌ ยกเลิกขาย</button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderBodyOnly() {
    const bodyEl = document.getElementById('mko-body-container');
    if (!bodyEl) return;

    const filtered = filterClients();
    const bannerHtml = renderSearchActionBannerHtml(filtered);
    if (filtered.length === 0) {
      bodyEl.innerHTML = bannerHtml + `<div class="mko-char-card"><div class="mko-empty-inline" style="text-align:center; padding:24px;">🔍 ไม่พบตัวละครหรือรายการตลาดที่ตรงกับเงื่อนไขการค้นหา</div></div>`;
      return;
    }

    if (state.viewMode === 'listings') {
      bodyEl.innerHTML = bannerHtml + renderAllListingsTableHtml(filtered);
    } else {
      bodyEl.innerHTML = bannerHtml + `<div class="mko-char-list">${filtered.map(renderCharacterCardHtml).join('')}</div>`;
    }
  }

  function renderAll() {
    if (!ensureSkeleton()) return;
    renderHeaderOnly();
    renderBodyOnly();
  }

  async function onPaneClick(e) {
    const filterBtn = e.target.closest('[data-mko-filter]');
    if (filterBtn) {
      state.filterMode = filterBtn.dataset.mkoFilter || 'all';
      renderAll();
      return;
    }

    const viewBtn = e.target.closest('[data-mko-view]');
    if (viewBtn) {
      state.viewMode = viewBtn.dataset.mkoView || 'chars';
      renderAll();
      return;
    }

    const sortBtn = e.target.closest('[data-mko-sort]');
    if (sortBtn) {
      state.listingSort = sortBtn.dataset.mkoSort || 'price_desc';
      renderBodyOnly();
      return;
    }

    // Cancel matched listings for a single character
    const cancelMatchedProfBtn = e.target.closest('[data-mko-cancel-matched-profile]');
    if (cancelMatchedProfBtn) {
      const profileId = cancelMatchedProfBtn.dataset.mkoCancelMatchedProfile;
      const q = state.searchQuery;
      if (!q) return;
      const cl = state.clients.find(c => c.id === profileId);
      const matched = cl ? (Array.isArray(cl.active) ? cl.active.filter(l => doesListingMatchQuery(cl, l, q)) : []) : [];
      if (!confirm(`ยืนยันยกเลิกรายการขายที่ตรงกับ "${q}" ของตัวละคร "${(cl && (cl.charName || cl.name)) || profileId}" จำนวน ${matched.length} รายการ และรับของคืนเข้ากระเป๋าทันที?`)) {
        return;
      }
      cancelMatchedProfBtn.disabled = true;
      const orig = cancelMatchedProfBtn.textContent;
      cancelMatchedProfBtn.textContent = '⏳ กำลังยกเลิก...';
      try {
        const listingIdsByProfile = {
          [profileId]: matched.map(l => Number(l.listingId ?? l.id)).filter(x => x > 0)
        };
        const res = await fetch('/api/market/overview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            op: 'cancel_matched_listings',
            profileId,
            query: q,
            mode: 'search',
            listingIdsByProfile,
            autoCollect: true
          })
        });
        const data = await res.json();
        if (data && data.success) {
          if (Array.isArray(data.clients)) state.clients = data.clients;
          const lockedHint = (data.lockedAuctionCount || 0) > 0
            ? ` (ติดเวลาประมูล 5 นาทีแรก ${data.lockedAuctionCount} รายการ รอครบ 5 นาทีแล้วกดอีกครั้งได้เลยครับ)`
            : '';
          notify(`🚫 ยกเลิกรายการที่ตรงกับ "${q}" สำเร็จ ${data.cancelledCount || 0} รายการ (รับกลับเข้ากระเป๋าแล้ว)!${lockedHint}`, 'success');
          updateMainTabBadges();
          renderAll();
        } else {
          notify(`❌ ยกเลิกไม่สำเร็จ: ${(data && data.error) || ''}`, 'error');
        }
      } catch (err) {
        notify(`❌ เกิดข้อผิดพลาด: ${err.message}`, 'error');
      } finally {
        cancelMatchedProfBtn.disabled = false;
        cancelMatchedProfBtn.textContent = orig;
      }
      return;
    }

    // Open Bag + Market Sell Dialog for a character
    const openBagBtn = e.target.closest('[data-mko-open-bag-sell]');
    if (openBagBtn) {
      const pid = openBagBtn.dataset.mkoOpenBagSell;
      if (pid && typeof openCharacterModal === 'function') {
        openCharacterModal(pid, 'market', 'sell');
      }
      return;
    }

    // Open Auto-Sell List Dialog for a character
    const openAsBtn = e.target.closest('[data-mko-open-autosell]');
    if (openAsBtn) {
      const pid = openAsBtn.dataset.mkoOpenAutosell;
      if (pid && typeof openCharacterModal === 'function') {
        openCharacterModal(pid, 'market', 'autosell');
      }
      return;
    }

    // Cancel a single active listing
    const cancelBtn = e.target.closest('[data-mko-cancel]');
    if (cancelBtn) {
      const listingId = cancelBtn.dataset.mkoCancel;
      const profileId = cancelBtn.dataset.profileId;
      const itemName = cancelBtn.dataset.itemName || 'รายการนี้';
      if (!confirm(`ยืนยันยกเลิกการวางขาย "${itemName}" ?\n(เมื่อยกเลิกแล้ว ไอเทมจะอยู่ในช่องรอรับคืน กดปุ่ม "📥 กดรับ" เพื่อรับเข้ากระเป๋าได้เลย)`)) return;
      cancelBtn.disabled = true;
      cancelBtn.textContent = '⏳...';
      try {
        const res = await fetch('/api/market/overview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'cancel', profileId, listingId })
        });
        const data = await res.json();
        if (data && data.success) {
          const idx = state.clients.findIndex(c => c.id === profileId);
          if (idx >= 0) {
            if (data.client) state.clients[idx] = data.client;
            if (Array.isArray(state.clients[idx].active)) {
              state.clients[idx].active = state.clients[idx].active.filter(
                a => Number(a && (a.listingId ?? a.id)) !== Number(listingId)
              );
            }
          }
          const cl = idx >= 0 ? state.clients[idx] : null;
          const cleanCancelName = String(itemName || '').replace(/^\+\d+\s*/, '').replace(/\s*\[\d+\]\s*$/, '').trim().toLowerCase();
          const inAutoSell = Boolean(
            cl && cl.autoSell && cl.autoSell.enabled && Array.isArray(cl.autoSell.rules) &&
            cl.autoSell.rules.some(r => r && r.enabled !== false && String(r.name || '').replace(/^\+\d+\s*/, '').replace(/\s*\[\d+\]\s*$/, '').trim().toLowerCase() === cleanCancelName)
          );
          const autoSellHint = inAutoSell
            ? ' (ไอเทมนี้อยู่ใน List Auto-Sell ด้วย — ถ้ารับเข้ากระเป๋าและไม่อยากให้บอทตั้งขายซ้ำ ให้ปิดใน List Auto-Sell ก่อนนะครับ)'
            : '';
          notify(`🚫 ยกเลิกการขาย "${itemName}" เรียบร้อยแล้ว! กดปุ่ม "📥 กดรับ" เพื่อนำของเข้ากระเป๋าได้ทันที${autoSellHint}`, 'success');
          updateMainTabBadges();
          renderAll();
        } else {
          notify(`❌ ยกเลิกไม่สำเร็จ: ${(data && data.error) || ''}`, 'error');
          cancelBtn.disabled = false;
          cancelBtn.textContent = '❌ ยกเลิกขาย';
        }
      } catch (err) {
        notify(`❌ เกิดข้อผิดพลาด: ${err.message}`, 'error');
        cancelBtn.disabled = false;
        cancelBtn.textContent = '❌ ยกเลิกขาย';
      }
      return;
    }

    // Collect single delivery
    const collectBtn = e.target.closest('[data-mko-collect]');
    if (collectBtn) {
      const deliveryId = collectBtn.dataset.mkoCollect;
      const profileId = collectBtn.dataset.profileId;
      collectBtn.disabled = true;
      collectBtn.textContent = '⏳...';
      try {
        const res = await fetch('/api/market/overview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'collect', profileId, deliveryId })
        });
        const data = await res.json();
        if (data && data.success) {
          if (data.client) {
            const idx = state.clients.findIndex(c => c.id === profileId);
            if (idx >= 0) state.clients[idx] = data.client;
          }
          notify('📥 รับเงิน/ไอเทมเข้ากระเป๋าเรียบร้อยแล้ว!', 'success');
          updateMainTabBadges();
          renderAll();
        } else {
          notify(`❌ กดรับไม่สำเร็จ: ${(data && data.error) || ''}`, 'error');
          collectBtn.disabled = false;
          collectBtn.textContent = '📥 กดรับ';
        }
      } catch (err) {
        notify(`❌ เกิดข้อผิดพลาด: ${err.message}`, 'error');
        collectBtn.disabled = false;
        collectBtn.textContent = '📥 กดรับ';
      }
      return;
    }

    // Cancel listings under X hours for a single character
    const cancelUnderProfBtn = e.target.closest('[data-mko-cancel-under-profile]');
    if (cancelUnderProfBtn) {
      const profileId = cancelUnderProfBtn.dataset.mkoCancelUnderProfile;
      const underH = Math.max(1, Math.min(47, Number(state.globalSettings.cancelUnderHours) || 6));
      cancelUnderProfBtn.disabled = true;
      const orig = cancelUnderProfBtn.textContent;
      cancelUnderProfBtn.textContent = '⏳ กำลังยกเลิก...';
      try {
        const res = await fetch('/api/market/overview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'cancel_under_hours', profileId, underHours: underH })
        });
        const data = await res.json();
        if (data && data.success) {
          if (data.globalSettings) state.globalSettings = Object.assign({}, state.globalSettings, data.globalSettings);
          if (Array.isArray(data.clients)) state.clients = data.clients;
          notify(`🚫 ยกเลิกของที่เหลือต่ำกว่า ${underH} ชม. สำเร็จ ${data.cancelledCount || 0} รายการ (รับกลับเข้ากระเป๋าแล้ว)!`, 'success');
          updateMainTabBadges();
          renderAll();
        } else {
          notify(`❌ ยกเลิกไม่สำเร็จ: ${(data && data.error) || ''}`, 'error');
        }
      } catch (err) {
        notify(`❌ เกิดข้อผิดพลาด: ${err.message}`, 'error');
      } finally {
        cancelUnderProfBtn.disabled = false;
        cancelUnderProfBtn.textContent = orig;
      }
      return;
    }

    // Collect all deliveries for one character
    const collectProfBtn = e.target.closest('[data-mko-collect-profile]');
    if (collectProfBtn) {
      const profileId = collectProfBtn.dataset.mkoCollectProfile;
      collectProfBtn.disabled = true;
      const orig = collectProfBtn.textContent;
      collectProfBtn.textContent = '⏳ กำลังรับ...';
      try {
        const res = await fetch('/api/market/overview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'collect_profile', profileId })
        });
        const data = await res.json();
        if (data && data.success) {
          let heldRemain = 0;
          if (data.client) {
            const idx = state.clients.findIndex(c => c.id === profileId);
            if (idx >= 0) state.clients[idx] = data.client;
            heldRemain = Array.isArray(data.client.deliveries) ? data.client.deliveries.filter(isDeliveryHeld).length : 0;
          }
          const heldMsg = heldRemain > 0
            ? ` (ส่วนอีก ${heldRemain} รายการยังติดเวลารอตรวจสอบจากเซิร์ฟเวอร์เกม จะกดรับได้เมื่อถึงเวลาที่กำหนด)`
            : '';
          notify(`📥 รับเงินและไอเทมที่พร้อมรับของตัวละครนี้เรียบร้อยแล้ว!${heldMsg}`, 'success');
          updateMainTabBadges();
          renderAll();
        } else {
          notify(`❌ กดรับไม่สำเร็จ: ${(data && data.error) || ''}`, 'error');
          collectProfBtn.disabled = false;
          collectProfBtn.textContent = orig;
        }
      } catch (err) {
        notify(`❌ เกิดข้อผิดพลาด: ${err.message}`, 'error');
        collectProfBtn.disabled = false;
        collectProfBtn.textContent = orig;
      }
      return;
    }

    // Restore Auto-Sell list from another profile for a character with 0 rules
    const restoreAsBtn = e.target.closest('[data-mko-restore-autosell]');
    if (restoreAsBtn) {
      const profileId = restoreAsBtn.dataset.mkoRestoreAutosell;
      restoreAsBtn.disabled = true;
      const orig = restoreAsBtn.textContent;
      restoreAsBtn.textContent = '⏳ กำลังกู้คืน...';
      try {
        const res = await fetch('/api/market/overview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'restore_autosell_from_peer', profileId })
        });
        const data = await res.json();
        if (data && data.success) {
          if (Array.isArray(data.clients)) state.clients = data.clients;
          notify(`✅ กู้คืนรายการ List Auto-Sell (${data.rulesCount || 0} รายการ จาก ${data.sourceName || 'จอหลัก'}) เรียบร้อยแล้ว!`, 'success');
          updateMainTabBadges();
          renderAll();
        } else {
          notify(`❌ กู้คืนไม่สำเร็จ: ${(data && data.error) || ''}`, 'error');
          restoreAsBtn.disabled = false;
          restoreAsBtn.textContent = orig;
        }
      } catch (err) {
        notify(`❌ เกิดข้อผิดพลาด: ${err.message}`, 'error');
        restoreAsBtn.disabled = false;
        restoreAsBtn.textContent = orig;
      }
      return;
    }

    // Global actions
    const actBtn = e.target.closest('[data-mko-act]');
    if (!actBtn) return;
    const act = actBtn.dataset.mkoAct;

    if (act === 'refresh') {
      await fetchOverview(true);
      notify('🔄 อัปเดตข้อมูลตลาดกลางทุกจอเรียบร้อยแล้ว', 'success');
      return;
    }

    if (act === 'clear-search') {
      state.searchQuery = '';
      const searchInp = document.getElementById('mko-search-input');
      if (searchInp) searchInp.value = '';
      renderBodyOnly();
      return;
    }

    if (act === 'cancel-matched' || act === 'cancel-and-remove-autosell') {
      const q = state.searchQuery;
      if (!q) return;
      const removeFromAutoSell = act === 'cancel-and-remove-autosell';
      const filtered = filterClients();
      const matchedRows = getMatchedListings(filtered).filter(r => r.client && r.client.online);
      const listingIdsByProfile = {};
      for (const r of matchedRows) {
        if (!listingIdsByProfile[r.client.id]) listingIdsByProfile[r.client.id] = [];
        if (r.listingId > 0) listingIdsByProfile[r.client.id].push(r.listingId);
      }
      const charCount = Object.keys(listingIdsByProfile).length;
      const confirmMsg = removeFromAutoSell
        ? `ยืนยันยกเลิกการวางขายที่ตรงกับ "${q}" ทั้งหมด ${matchedRows.length} รายการ (${charCount} จอ) รับของคืนเข้ากระเป๋า และลบ "${q}" ออกจาก List Auto-Sell ทุกจอทันที?`
        : `ยืนยันยกเลิกการวางขายที่ตรงกับ "${q}" ทั้งหมด ${matchedRows.length} รายการ (${charCount} จอ) และดึงของกลับเข้ากระเป๋าทันที?`;
      if (!confirm(confirmMsg)) return;

      actBtn.disabled = true;
      const orig = actBtn.textContent;
      actBtn.textContent = '⏳ กำลังยกเลิกรายการที่ค้นหา...';
      try {
        const res = await fetch('/api/market/overview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            op: 'cancel_matched_listings',
            profileId: 'all',
            query: q,
            mode: 'search',
            listingIdsByProfile,
            removeFromAutoSell,
            autoCollect: true
          })
        });
        const data = await res.json();
        if (data && data.success) {
          if (Array.isArray(data.clients)) state.clients = data.clients;
          const lockedHint = (data.lockedAuctionCount || 0) > 0
            ? ` (มี ${data.lockedAuctionCount} รายการยังติดเวลาประมูล 5 นาทีแรกของเซิร์ฟเวอร์ รอครบ 5 นาทีแล้วกดซ้ำได้เลยครับ)`
            : '';
          const removedAsHint = removeFromAutoSell
            ? ` พร้อมลบออกจาก List Auto-Sell รวม ${data.removedRulesTotal || 0} รายการ`
            : '';
          notify(`🚫 ยกเลิกขายที่ตรงกับ "${q}" สำเร็จ ${data.cancelledCount || 0} รายการ (${data.affectedProfilesCount || 0} จอ) และรับของคืนเข้ากระเป๋าแล้ว${removedAsHint}!${lockedHint}`, 'success');
          updateMainTabBadges();
          renderAll();
        } else {
          notify(`❌ ยกเลิกไม่สำเร็จ: ${(data && data.error) || ''}`, 'error');
        }
      } catch (err) {
        notify(`❌ เกิดข้อผิดพลาด: ${err.message}`, 'error');
      } finally {
        actBtn.disabled = false;
        actBtn.textContent = orig;
      }
      return;
    }

    if (act === 'cancel-unconfigured') {
      if (!confirm('ยืนยันตรวจสอบทุกจอและยกเลิกรายการขายที่ "ไม่อยู่ใน List Auto-Sell" และ "ไม่ใช่ของทำกำไรจาก Sniper" ทั้งหมด พร้อมดึงของกลับเข้ากระเป๋าทันที?')) {
        return;
      }
      actBtn.disabled = true;
      const orig = actBtn.textContent;
      actBtn.textContent = '⏳ กำลังตรวจสอบและยกเลิก...';
      try {
        const res = await fetch('/api/market/overview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            op: 'cancel_matched_listings',
            profileId: 'all',
            mode: 'unconfigured',
            autoCollect: true
          })
        });
        const data = await res.json();
        if (data && data.success) {
          if (Array.isArray(data.clients)) state.clients = data.clients;
          const lockedHint = (data.lockedAuctionCount || 0) > 0
            ? ` (มี ${data.lockedAuctionCount} รายการยังติดเวลาประมูล 5 นาทีแรก รอครบ 5 นาทีแล้วกดซ้ำได้เลยครับ)`
            : '';
          if ((data.cancelledCount || 0) > 0) {
            notify(`🧹 ยกเลิกไอเทมที่ไม่อยู่ใน Auto-Sell สำเร็จ ${data.cancelledCount} รายการ (${data.affectedProfilesCount || 0} จอ) และดึงกลับเข้ากระเป๋าแล้ว!${lockedHint}`, 'success');
          } else {
            notify(`✅ ไม่พบรายการขายที่อยู่นอกเหนือจาก Auto-Sell / Sniper ในขณะนี้${lockedHint}`, 'info');
          }
          updateMainTabBadges();
          renderAll();
        } else {
          notify(`❌ ยกเลิกไม่สำเร็จ: ${(data && data.error) || ''}`, 'error');
        }
      } catch (err) {
        notify(`❌ เกิดข้อผิดพลาด: ${err.message}`, 'error');
      } finally {
        actBtn.disabled = false;
        actBtn.textContent = orig;
      }
      return;
    }

    if (act === 'restore-empty-autosell') {
      actBtn.disabled = true;
      const orig = actBtn.textContent;
      actBtn.textContent = '⏳ กำลังกู้คืน...';
      try {
        const res = await fetch('/api/market/overview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'restore_autosell_from_peer', profileId: 'all' })
        });
        const data = await res.json();
        if (data && data.success) {
          if (Array.isArray(data.clients)) state.clients = data.clients;
          notify(`✅ กู้คืนรายการ List Auto-Sell (${data.rulesCount || 0} รายการ) ให้ ${data.restoredCount || 0} จอที่ว่างเรียบร้อยแล้ว!`, 'success');
          updateMainTabBadges();
          renderAll();
        } else {
          notify(`❌ กู้คืนไม่สำเร็จ: ${(data && data.error) || ''}`, 'error');
        }
      } catch (err) {
        notify(`❌ เกิดข้อผิดพลาด: ${err.message}`, 'error');
      } finally {
        actBtn.disabled = false;
        actBtn.textContent = orig;
      }
      return;
    }

    if (act === 'cancel-under-hours') {
      const hoursInp = document.getElementById('mko-cancel-under-hours');
      const underH = Math.max(1, Math.min(47, Number(hoursInp ? hoursInp.value : state.globalSettings.cancelUnderHours) || 6));
      state.globalSettings.cancelUnderHours = underH;
      const s = computeSummary();
      if (s.underHoursCount > 0) {
        if (!confirm(`ยืนยันยกเลิกรายการขายที่เหลือเวลาต่ำกว่า ${underH} ชั่วโมง ทั้งหมด ${s.underHoursCount} รายการ (${s.underHoursCharsCount} ตัวละคร) และดึงของกลับเข้ากระเป๋าทันที?`)) {
          return;
        }
      }
      actBtn.disabled = true;
      const orig = actBtn.textContent;
      actBtn.textContent = `⏳ กำลังยกเลิก < ${underH} ชม....`;
      try {
        const res = await fetch('/api/market/overview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'cancel_under_hours', profileId: 'all', underHours: underH })
        });
        const data = await res.json();
        if (data && data.success) {
          if (data.globalSettings) state.globalSettings = Object.assign({}, state.globalSettings, data.globalSettings);
          if (Array.isArray(data.clients)) state.clients = data.clients;
          if ((data.cancelledCount || 0) > 0) {
            notify(`🚫 ยกเลิกไอเทมที่เหลือเวลาต่ำกว่า ${underH} ชม. สำเร็จ ${data.cancelledCount} รายการ (${data.affectedProfilesCount || 0} จอ) และดึงของกลับเข้ากระเป๋าแล้ว!`, 'success');
          } else {
            notify(`✅ ไม่มีไอเทมที่เหลือเวลาต่ำกว่า ${underH} ชั่วโมงในขณะนี้`, 'info');
          }
          updateMainTabBadges();
          renderAll();
        } else {
          notify(`❌ ยกเลิกไม่สำเร็จ: ${(data && data.error) || ''}`, 'error');
        }
      } catch (err) {
        notify(`❌ เกิดข้อผิดพลาด: ${err.message}`, 'error');
      } finally {
        actBtn.disabled = false;
        actBtn.textContent = orig;
      }
      return;
    }

    if (act === 'claim-all') {
      actBtn.disabled = true;
      const orig = actBtn.textContent;
      actBtn.textContent = '⏳ กำลังรับทุกจอ...';
      try {
        const res = await fetch('/api/market/overview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'collect_all_profiles' })
        });
        const data = await res.json();
        if (data && data.success) {
          if (Array.isArray(data.clients)) state.clients = data.clients;
          const sAfter = computeSummary();
          const heldMsg = sAfter.heldDeliveries > 0
            ? ` (ส่วนอีก ${sAfter.heldDeliveries} รายการยังติดเวลารอตรวจสอบจากเซิร์ฟเวอร์เกม จะกดรับได้เมื่อถึงเวลาที่กำหนด)`
            : '';
          notify(`📥 สั่งรับเงินและของคืนที่พร้อมรับจากตลาดกลางสำเร็จ ${data.claimedProfilesCount || 0} จอ!${heldMsg}`, 'success');
          updateMainTabBadges();
          renderAll();
        } else {
          notify(`❌ รับของทุกจอไม่สำเร็จ: ${(data && data.error) || ''}`, 'error');
        }
      } finally {
        actBtn.disabled = false;
        actBtn.textContent = orig;
      }
      return;
    }

    if (act === 'autosell-all') {
      actBtn.disabled = true;
      const orig = actBtn.textContent;
      actBtn.textContent = '⏳ กำลังเช็ค Auto-Sell...';
      try {
        const res = await fetch('/api/market/overview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'trigger_autosell', profileId: 'all' })
        });
        const data = await res.json();
        if (data && data.success) {
          if (Array.isArray(data.clients)) state.clients = data.clients;
          notify(`⚡ สั่งเช็คกระเป๋าและลงขาย Auto-Sell แล้ว (${data.triggeredCount || 0} จอออนไลน์)`, 'success');
          updateMainTabBadges();
          renderAll();
        } else {
          notify(`❌ สั่ง Auto-Sell ไม่สำเร็จ: ${(data && data.error) || ''}`, 'error');
        }
      } finally {
        actBtn.disabled = false;
        actBtn.textContent = orig;
      }
    }
  }

  async function saveGlobalMarketSettingsToServer(patch, toastMsg) {
    state.globalSettings = Object.assign({}, state.globalSettings, patch);
    try {
      const res = await fetch('/api/market/overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ op: 'set_global_settings' }, state.globalSettings))
      });
      const data = await res.json();
      if (data && data.success) {
        if (data.globalSettings) state.globalSettings = Object.assign({}, state.globalSettings, data.globalSettings);
        if (Array.isArray(data.clients)) state.clients = data.clients;
        const extraCancel = Number(data.autoCancelledTotal) || 0;
        if (toastMsg) {
          notify(
            extraCancel > 0
              ? `${toastMsg} (พร้อมยกเลิกของเหลือ < ${state.globalSettings.cancelUnderHours} ชม. ให้ทันที ${extraCancel} รายการ)`
              : toastMsg,
            'success'
          );
        }
        updateMainTabBadges();
        renderAll();
      } else {
        notify(`❌ บันทึกตั้งค่าตลาดส่วนกลางไม่สำเร็จ: ${(data && data.error) || ''}`, 'error');
      }
    } catch (err) {
      notify(`❌ เกิดข้อผิดพลาด: ${err.message}`, 'error');
    }
  }

  async function onPaneChange(e) {
    const durSel = e.target.closest('[data-mko-global-duration]');
    if (durSel) {
      const dh = Number(durSel.value);
      const durationHours = [12, 24, 48].includes(dh) ? dh : 24;
      durSel.blur();
      await saveGlobalMarketSettingsToServer(
        { durationHours },
        `⏱️ ตั้งค่าระยะเวลาลงขายเป็น ${durationHours} ชั่วโมง ให้ทุกจอเรียบร้อยแล้ว!`
      );
      return;
    }

    const autoCancelChk = e.target.closest('[data-mko-autocancel-toggle]');
    if (autoCancelChk) {
      const autoCancelEnabled = Boolean(autoCancelChk.checked);
      const hoursInp = document.getElementById('mko-cancel-under-hours');
      const cancelUnderHours = Math.max(1, Math.min(47, Number(hoursInp ? hoursInp.value : state.globalSettings.cancelUnderHours) || 6));
      await saveGlobalMarketSettingsToServer(
        { autoCancelEnabled, cancelUnderHours },
        autoCancelEnabled
          ? `🚫 เปิดระบบยกเลิกการขายอัตโนมัติเมื่อไอเทมเหลือเวลาต่ำกว่า ${cancelUnderHours} ชั่วโมง แล้ว!`
          : `⚪ ปิดระบบยกเลิกการขายอัตโนมัติแล้ว`
      );
      return;
    }

    const cancelHoursInp = e.target.closest('[data-mko-cancel-hours]');
    if (cancelHoursInp) {
      const cancelUnderHours = Math.max(1, Math.min(47, Math.round((Number(cancelHoursInp.value) || 6) * 10) / 10));
      cancelHoursInp.value = String(cancelUnderHours);
      cancelHoursInp.blur();
      await saveGlobalMarketSettingsToServer(
        { cancelUnderHours },
        `⏳ ตั้งค่าเกณฑ์ยกเลิกการขายเมื่อเหลือเวลาต่ำกว่า ${cancelUnderHours} ชั่วโมง แล้ว!`
      );
      return;
    }

    const toggleAs = e.target.closest('[data-mko-toggle-as]');
    if (toggleAs) {
      const profileId = toggleAs.dataset.mkoToggleAs;
      const enabled = Boolean(toggleAs.checked);
      try {
        const res = await fetch('/api/market/overview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'toggle_autosell', profileId, enabled })
        });
        const data = await res.json();
        if (data && data.success && data.client) {
          const idx = state.clients.findIndex(c => c.id === profileId);
          if (idx >= 0) state.clients[idx] = data.client;
          notify(`🤖 ${enabled ? 'เปิด' : 'ปิด'} Auto-Sell ของ "${data.client.charName || data.client.name}" แล้ว`, 'success');
          updateMainTabBadges();
          renderAll();
        }
      } catch (err) {
        notify(`❌ เปลี่ยนสถานะ Auto-Sell ไม่สำเร็จ: ${err.message}`, 'error');
      }
    }
  }

  function init() {
    ensureSkeleton();
    // Initial background fetch to populate the tab badge
    setTimeout(() => fetchOverview(false), 1200);
    state.pollTimer = setInterval(() => {
      if (document.hidden) return;
      if (isMarketTabVisible()) {
        fetchOverview(false);
      }
    }, 10000);
  }

  window.MarketOverview = {
    onTabShown() {
      ensureSkeleton();
      renderAll();
      fetchOverview(false);
    },
    onModalClosed(profileId) {
      if (profileId) {
        fetchOverview(true, profileId);
      } else if (isMarketTabVisible()) {
        fetchOverview(false);
      }
    },
    refresh: () => fetchOverview(true)
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
