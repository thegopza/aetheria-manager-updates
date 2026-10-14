// ============================================================
// JAIL MONITOR UI — Right-edge slide-out drawer (`#jl-tab` + `#jl-drawer`)
// ============================================================
// - Sits on the right edge (`คุก`), sliding from right to left when clicked.
// - Lists all clients detected in Jail (`isJailed` or live map matching Jail).
// - Clicking a jailed client row scrolls the Manager page smoothly to that card
//   (`#card-<profileId>`) and highlights it.
// - Provides one-click clearing of the Red Cross (`❌`) status per card or all.

(function () {
  const JAIL_MAP_RE = /คุก|เรือนจำ|\bprison\b|\bjail\b/i;

  let isOpen = false;
  let cachedProfiles = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function isProfileJailed(p) {
    if (!p) return false;
    if (p.isJailed) return true;
    const liveMap = p.liveState && typeof p.liveState.map === 'string' ? p.liveState.map : '';
    return Boolean(liveMap && JAIL_MAP_RE.test(liveMap));
  }

  function getJailedProfiles(profiles) {
    const list = Array.isArray(profiles) ? profiles : (typeof currentProfiles !== 'undefined' ? currentProfiles : cachedProfiles);
    return list.filter(isProfileJailed).sort((a, b) => (Number(b.jailedAt) || 0) - (Number(a.jailedAt) || 0));
  }

  function fmtTime(ts) {
    if (!ts) return 'เมื่อสักครู่';
    if (typeof formatThaiTime === 'function') return formatThaiTime(ts);
    try {
      return new Date(Number(ts)).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '-';
    }
  }

  function mountShell() {
    if (document.getElementById('jl-drawer')) return;

    const tab = document.createElement('button');
    tab.id = 'jl-tab';
    tab.type = 'button';
    tab.title = 'รายชื่อจอที่ติดคุก (คลิกเพื่อเปิดแถบด้านขวาและเลื่อนไปที่การ์ด)';
    tab.innerHTML = `
      <span class="jl-tab-icon">⛓️</span>
      <span class="jl-tab-label">คุก</span>
      <span class="jl-tab-count" id="jl-tab-count">0</span>
    `;
    tab.addEventListener('click', () => toggleDrawer());

    const backdrop = document.createElement('div');
    backdrop.id = 'jl-backdrop';
    backdrop.addEventListener('click', () => setOpen(false));

    const drawer = document.createElement('aside');
    drawer.id = 'jl-drawer';
    drawer.setAttribute('aria-label', 'รายชื่อจอที่ติดคุก');
    drawer.innerHTML = `
      <header class="jl-header">
        <div class="jl-header-title">
          <span class="jl-header-icon">⛓️</span>
          <div>
            <h2>รายชื่อจอที่ติดคุก (Jail Monitor)</h2>
            <p>ตรวจพบแมพคุก → ปิดจออัตโนมัติครั้งแรก · เปิดใหม่ไม่ปิดซ้ำ</p>
          </div>
        </div>
        <div class="jl-header-actions">
          <button type="button" class="jl-btn jl-btn-danger" id="jl-clear-all-btn" title="ล้างกากบาทแดงของทุกจอที่ติดคุก" style="display: none;">🧹 ล้างทั้งหมด</button>
          <button type="button" class="jl-btn" id="jl-close-btn" title="ปิดแถบ (Esc)">✕</button>
        </div>
      </header>

      <div class="jl-summary-bar">
        <div class="jl-summary-stat">
          <span>🚨 ติดคุกสะสมรอบนี้:</span>
          <b id="jl-summary-count">0</b>
          <span>จอ</span>
        </div>
        <span style="font-size: 10.5px; color: #cbd5e1;">คลิกการ์ดในรายการเพื่อเลื่อนไปหา</span>
      </div>

      <div class="jl-body" id="jl-list-body"></div>
    `;

    document.body.appendChild(tab);
    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);

    document.getElementById('jl-close-btn').addEventListener('click', () => setOpen(false));
    document.getElementById('jl-clear-all-btn').addEventListener('click', () => clearAllJailedProfiles());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) setOpen(false);
    });

    const bodyObserver = new MutationObserver(() => {
      if (isOpen && (document.body.classList.contains('pt-open') || document.body.classList.contains('pm-open') || document.body.classList.contains('gd-open'))) {
        isOpen = false;
        document.body.classList.remove('jl-open');
      }
    });
    bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  function setOpen(next) {
    isOpen = Boolean(next);
    if (isOpen) {
      document.body.classList.remove('pt-open', 'pm-open', 'gd-open');
    }
    document.body.classList.toggle('jl-open', isOpen);
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
      void cardEl.offsetWidth; // reflow to restart animation
      cardEl.classList.add('jail-card-focus-pulse');
      setTimeout(() => {
        cardEl.classList.remove('jail-card-focus-pulse');
      }, 2600);
    }, 120);
  }

  async function clearSingleProfileJail(profileId, event) {
    if (event) event.stopPropagation();
    if (!profileId) return;
    try {
      const p = (typeof currentProfiles !== 'undefined' ? currentProfiles : cachedProfiles).find(x => x.id === profileId);
      if (p) {
        p.isJailed = false;
        p.jailedAt = null;
        p.jailedMap = null;
      }
      await fetch(`/api/profiles/${encodeURIComponent(profileId)}/clear-jail`, { method: 'POST' });
      if (typeof renderProfiles === 'function') renderProfiles();
      updateJailManagerFromProfiles(typeof currentProfiles !== 'undefined' ? currentProfiles : cachedProfiles);
      if (typeof showToast === 'function') {
        showToast(`✅ ล้างสถานะกากบาทแดงของ ${p ? p.name : profileId} แล้ว`, 'info');
      }
    } catch (e) {
      console.error('Failed to clear jail status:', e);
    }
  }

  async function clearAllJailedProfiles() {
    const jailed = getJailedProfiles();
    if (jailed.length === 0) return;
    try {
      (typeof currentProfiles !== 'undefined' ? currentProfiles : cachedProfiles).forEach(p => {
        if (p) {
          p.isJailed = false;
          p.jailedAt = null;
          p.jailedMap = null;
        }
      });
      await fetch('/api/jail/clear-all', { method: 'POST' });
      if (typeof renderProfiles === 'function') renderProfiles();
      updateJailManagerFromProfiles(typeof currentProfiles !== 'undefined' ? currentProfiles : cachedProfiles);
      if (typeof showToast === 'function') {
        showToast(`🧹 ล้างสถานะคุกทั้งหมด (${jailed.length} จอ) เรียบร้อยแล้ว`, 'info');
      }
    } catch (e) {
      console.error('Failed to clear all jail statuses:', e);
    }
  }

  function renderDrawerList() {
    mountShell();
    const jailed = getJailedProfiles();
    const count = jailed.length;

    const tabBtn = document.getElementById('jl-tab');
    const tabCount = document.getElementById('jl-tab-count');
    const summaryCount = document.getElementById('jl-summary-count');
    const clearAllBtn = document.getElementById('jl-clear-all-btn');
    const bodyEl = document.getElementById('jl-list-body');

    if (tabCount) {
      tabCount.textContent = String(count);
      tabCount.classList.toggle('has-jailed', count > 0);
    }
    if (tabBtn) {
      tabBtn.classList.toggle('has-jailed', count > 0);
    }
    if (summaryCount) {
      summaryCount.textContent = String(count);
    }
    if (clearAllBtn) {
      clearAllBtn.style.display = count > 0 ? 'inline-flex' : 'none';
    }
    if (!bodyEl) return;

    if (count === 0) {
      bodyEl.innerHTML = `
        <div class="jl-empty">
          <div class="jl-empty-icon">🛡️</div>
          <div class="jl-empty-title">ไม่มีจอที่ติดคุกในขณะนี้</div>
          <div class="jl-empty-sub">
            หากระบบตรวจพบว่าไอดีไหนถูกย้ายเข้าแมพคุก<br>
            จะทำการ<b>ปิดจอนั้นอัตโนมัติครั้งแรกทันที</b> แสดงกากบาทแดง ❌ บนการ์ด<br>
            (หากคุณกดเปิดจอนั้นขึ้นมาใหม่เอง ระบบจะไม่สั่งปิดซ้ำ)
          </div>
        </div>
      `;
      return;
    }

    bodyEl.innerHTML = jailed.map(p => {
      const state = p.isRunning ? p.liveState : null;
      const charName = state?.charName || p.lastCharName || p.account || 'ไม่ทราบชื่อตัวละคร';
      const curClass = state?.charClass || p.lastCharClass || p.charClass || 'Archer';
      const jailMap = p.jailedMap || (state && state.map) || 'คุก (Prison)';
      const portrait = (typeof getPortraitSrc === 'function') ? getPortraitSrc(p, state) : '';
      const timeStr = fmtTime(p.jailedAt);

      return `
        <div class="jl-item-card" data-profile-id="${esc(p.id)}" title="คลิกเพื่อเลื่อนหน้าเว็บไปยังการ์ดของ ${esc(p.name)}">
          <div class="jl-item-left">
            <div class="jl-item-cross-avatar">
              ${portrait ? `<img src="${esc(portrait)}" alt="" onerror="this.style.display='none'">` : ''}
              <span class="jl-mini-x">❌</span>
            </div>
            <div class="jl-item-info">
              <div class="jl-item-name-row">
                <span class="jl-item-name">${esc(p.name)}</span>
                <span class="jl-item-port">:${esc(p.debugPort || 49876)}</span>
              </div>
              <div class="jl-item-char">👤 ${esc(charName)} · <span style="color:#94a3b8;">${esc(curClass)}</span></div>
              <div class="jl-item-meta">
                <span>⛓️ ${esc(jailMap)}</span>
                <span>•</span>
                <span>🕒 ${esc(timeStr)}</span>
                <span>•</span>
                ${p.isRunning ? '<span style="color:#fde047;font-weight:700;">🖥️ เปิดจออยู่ (ไม่ปิดซ้ำ)</span>' : '<span style="color:#fca5a5;font-weight:700;">⏹️ ปิดจอแล้ว</span>'}
              </div>
            </div>
          </div>
          <div class="jl-item-actions">
            <span class="jl-jump-pill">📍 เลื่อนไปที่การ์ด</span>
            <button type="button" class="jl-clear-one-btn" data-clear-id="${esc(p.id)}" title="ล้างสถานะกากบาทแดงของจอนี้">✓ ล้างกากบาท</button>
          </div>
        </div>
      `;
    }).join('');

    bodyEl.querySelectorAll('.jl-item-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-clear-id]')) return;
        const pid = card.getAttribute('data-profile-id');
        scrollToProfileCard(pid);
      });
    });

    bodyEl.querySelectorAll('[data-clear-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pid = btn.getAttribute('data-clear-id');
        clearSingleProfileJail(pid, e);
      });
    });
  }

  function updateJailManagerFromProfiles(profiles) {
    if (Array.isArray(profiles)) {
      cachedProfiles = profiles;
    }
    renderDrawerList();
  }

  window.clearProfileJail = clearSingleProfileJail;
  window.scrollToJailedProfileCard = scrollToProfileCard;
  window.updateJailManagerFromProfiles = updateJailManagerFromProfiles;
  window.toggleJailDrawer = toggleDrawer;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      mountShell();
      updateJailManagerFromProfiles(typeof currentProfiles !== 'undefined' ? currentProfiles : []);
    });
  } else {
    mountShell();
    updateJailManagerFromProfiles(typeof currentProfiles !== 'undefined' ? currentProfiles : []);
  }
})();
