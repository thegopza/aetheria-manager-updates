// manager/public/bot_update.js — header pill + viewport-safe control panel for automatic bot.js & Manager updates
(function () {
  'use strict';

  const STATE_LABEL = {
    'up-to-date': ['✅', 'ล่าสุดแล้ว'],
    done: ['✅', 'อัปเดตแล้ว'],
    outdated: ['⚠️', 'มีเวอร์ชันใหม่'],
    waiting: ['⏳', 'รอจังหวะ'],
    reloading: ['🔄', 'กำลังรีเฟรช'],
    resuming: ['▶️', 'รอบอททำงานต่อ'],
    error: ['❌', 'มีปัญหา']
  };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const ago = ts => {
    if (!ts) return '--';
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'เมื่อสักครู่';
    if (m < 60) return `${m} นาทีที่แล้ว`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h} ชม.ที่แล้ว` : `${Math.round(h / 24)} วันที่แล้ว`;
  };

  let status = null;
  let mgr = null;        // Manager self-update status
  let firstSeen = null;  // { webBuild, serverStartedAt } of the page currently loaded
  let reloadPending = false;
  let pill = null;
  let panel = null;
  let activeFilter = 'all'; // 'all' | 'pending' | 'ok' | 'error'

  function mount() {
    const actions = document.querySelector('.header-actions');
    if (!actions || pill) return;
    const wrap = document.createElement('div');
    wrap.className = 'bu-wrap';
    wrap.innerHTML = `
      <button type="button" class="btn btn-ghost bu-pill" title="อัปเดตบอทและ Manager อัตโนมัติ">
        <span class="bu-dot"></span><span class="bu-text">Auto-update</span>
      </button>
      <div class="bu-panel" hidden></div>`;
    const refresh = document.getElementById('btn-refresh');
    actions.insertBefore(wrap, refresh || null);
    pill = wrap.querySelector('.bu-pill');
    panel = wrap.querySelector('.bu-panel');
    pill.addEventListener('click', e => {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
      render();
    });
    document.addEventListener('click', e => {
      if (!wrap.contains(e.target)) panel.hidden = true;
    });
    panel.addEventListener('click', onPanelClick);
  }

  async function load() {
    try {
      const [b, m] = await Promise.all([
        fetch('/api/bot-update/status').then(r => r.json()).catch(() => null),
        fetch('/api/manager-update/status').then(r => r.json()).catch(() => null)
      ]);
      if (b && b.success) status = b;
      if (m && m.success) { mgr = m; watchForNewBuild(); }
      render();
    } catch (e) {}
  }

  // Reload the page when the Manager was updated (new web files or a restarted server),
  // but never while the user is typing or has a dialog open.
  function userBusy() {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
    if (document.body.classList.contains('pt-open') || document.body.classList.contains('pm-open')) return true;
    if (document.querySelector('.modal-overlay.active, .im-market')) return true;
    const ch = document.getElementById('char-detail-modal');
    return Boolean(ch && ch.style.display && ch.style.display !== 'none');
  }
  function watchForNewBuild() {
    if (!firstSeen) { firstSeen = { webBuild: mgr.webBuild, serverStartedAt: mgr.serverStartedAt }; return; }
    if (mgr.webBuild === firstSeen.webBuild && mgr.serverStartedAt === firstSeen.serverStartedAt) return;
    reloadPending = true;
    if (!userBusy()) {
      document.body.insertAdjacentHTML('beforeend', '<div class="bu-reload-toast">♻️ Manager อัปเดตแล้ว — กำลังโหลดหน้าใหม่...</div>');
      setTimeout(() => location.reload(), 1500);
    }
  }

  async function onPanelClick(e) {
    const filterBtn = e.target.closest('[data-bu-filter]');
    if (filterBtn) {
      e.stopPropagation();
      activeFilter = filterBtn.dataset.buFilter || 'all';
      render();
      return;
    }

    const b = e.target.closest('[data-bu]');
    if (!b) return;
    e.stopPropagation();
    const action = b.dataset.bu;

    if (action === 'toggle') {
      await fetch('/api/bot-update/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !status.enabled }) });
      await load();
    } else if (action === 'check') {
      b.disabled = true;
      b.textContent = '⏳ กำลังเช็ก...';
      await Promise.all([
        fetch('/api/bot-update/check', { method: 'POST' }).catch(() => null),
        fetch('/api/manager-update/check', { method: 'POST' }).catch(() => null)
      ]);
      setTimeout(load, 1200);
      setTimeout(load, 3200);
    } else if (action === 'force-all') {
      b.disabled = true;
      b.textContent = '⚡ กำลังสั่งอัปเดต...';
      await fetch('/api/bot-update/force-all', { method: 'POST' }).catch(() => null);
      setTimeout(load, 1200);
      setTimeout(load, 3500);
    } else if (action === 'reload-one') {
      const profileId = b.dataset.id;
      if (!profileId) return;
      b.disabled = true;
      b.textContent = '⏳';
      await fetch('/api/bot-update/reload-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId })
      }).catch(() => null);
      setTimeout(load, 1000);
      setTimeout(load, 3000);
    } else if (action === 'mtoggle') {
      await fetch('/api/manager-update/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !mgr.enabled }) });
      await load();
    } else if (action === 'mapply') {
      if (!confirm(mgr.mode === 'git' ? 'รีสตาร์ท Manager server ตอนนี้? (จอเกมไม่ปิด)' : 'อัปเดต Manager จาก GitHub ตอนนี้? (จอเกมไม่ปิด)')) return;
      b.disabled = true;
      b.textContent = '⏳ กำลังอัปเดต...';
      const r = await fetch('/api/manager-update/apply', { method: 'POST' }).then(x => x.json()).catch(() => null);
      if (r && !r.success) alert(r.error || 'อัปเดตไม่สำเร็จ');
      setTimeout(load, 2500);
    } else if (action === 'reload') {
      location.reload();
    } else if (action === 'close') {
      panel.hidden = true;
    }
  }

  function renderManagerCard() {
    if (!mgr) return '';
    const files = mgr.pending || [];
    const hasUpdate = files.length > 0;
    return `
      <div class="bu-card ${hasUpdate || reloadPending ? 'bu-card-warn' : ''}">
        <div class="bu-card-head">
          <div class="bu-card-title">
            <span>🖥️ ตัวโปรแกรม Manager</span>
            <span class="bu-badge ${hasUpdate || reloadPending ? 'warn' : 'ok'}">
              ${reloadPending ? '♻️ รอโหลดหน้าใหม่' : hasUpdate ? `📦 มีอัปเดต ${files.length} ไฟล์` : '✅ ล่าสุดแล้ว'}
            </span>
          </div>
          <button type="button" class="bu-switch ${mgr.enabled ? 'on' : ''}" data-bu="mtoggle" title="เปิด/ปิด Auto-update ของ Manager"><span></span></button>
        </div>
        <div class="bu-card-body">
          ${mgr.mode === 'release' && mgr.latest ? `<div class="bu-commit-line"><code>${esc(mgr.latest.sha.slice(0, 7))}</code> <span>${esc(mgr.latest.message)}</span></div>` : ''}
          <div class="bu-meta-line">
            ${hasUpdate
              ? `<span style="color:#fcd34d;">ไฟล์ใหม่: ${esc(files.map(f => f.path).slice(0, 4).join(', '))}${files.length > 4 ? ` (+${files.length - 4})` : ''}</span>`
              : `<span>${mgr.mode === 'git' ? 'โหมดนักพัฒนา (Git) · รีสตาร์ทอัตโนมัติเมื่อ commit' : 'เช็กอัปเดตทุก 10 นาที · จอเกมไม่ปิด'}</span>`}
            ${mgr.lastApplied ? `<span>· อัปเดตล่าสุด ${ago(mgr.lastApplied.at)}</span>` : ''}
          </div>
          ${!mgr.supervised ? '<div class="bu-error">⚠️ ต้องปิด-เปิด PelicanManager.exe 1 ครั้ง เพื่อเปิดระบบรีสตาร์ทอัตโนมัติ</div>' : ''}
          ${mgr.lastError ? `<div class="bu-error">⚠️ ${esc(mgr.lastError)}</div>` : ''}
          ${(hasUpdate && mgr.supervised) || reloadPending ? `
            <div class="bu-card-actions">
              ${hasUpdate && mgr.supervised ? `<button type="button" class="bu-action-btn primary" data-bu="mapply">${mgr.mode === 'git' ? '♻️ รีสตาร์ท Server ตอนนี้' : '⬇️ อัปเดต Manager ตอนนี้'}</button>` : ''}
              ${reloadPending ? `<button type="button" class="bu-action-btn warn" data-bu="reload">♻️ โหลดหน้าเว็บใหม่</button>` : ''}
            </div>
          ` : ''}
        </div>
      </div>`;
  }

  function render() {
    if (!pill || !status) return;
    if (reloadPending && !userBusy() && !document.querySelector('.bu-reload-toast')) watchForNewBuild();
    const clientEntries = Object.entries(status.clients || {}).map(([id, c]) => ({ id: c.id || id, ...c }));
    const pendingList = clientEntries.filter(c => ['outdated', 'waiting', 'reloading', 'resuming'].includes(c.state));
    const okList = clientEntries.filter(c => ['up-to-date', 'done'].includes(c.state));
    const errList = clientEntries.filter(c => c.state === 'error');
    const pending = pendingList.length;
    const hasError = errList.length > 0 || Boolean(status.lastError);
    const tone = !status.enabled ? 'off' : hasError ? 'err' : (status.phase !== 'idle' || pending) ? 'busy' : 'ok';

    pill.className = `btn btn-ghost bu-pill ${tone}`;
    pill.querySelector('.bu-text').textContent =
      !status.enabled ? 'Auto-update ปิด'
        : status.phase === 'waiting-cdn' ? 'รอ GitHub ส่งไฟล์ใหม่'
          : status.phase === 'settling' ? `มีบอทใหม่ · อัปเดต ${new Date(status.settleUntil).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`
          : pending ? `กำลังอัปเดต (${pending})`
            : (mgr && mgr.pending && mgr.pending.length) || reloadPending ? 'มีอัปเดต Manager'
              : 'Auto-update';

    if (panel.hidden) return;
    const l = status.latest;
    const filteredClients = activeFilter === 'pending'
      ? pendingList
      : activeFilter === 'ok'
        ? okList
        : activeFilter === 'error'
          ? errList
          : clientEntries;

    panel.innerHTML = `
      <!-- Top Sticky Header with Immediate Check & Update Button -->
      <div class="bu-top-bar">
        <div class="bu-top-title">
          <b>🔄 ระบบอัปเดตอัตโนมัติ</b>
          <small>เช็กล่าสุด ${ago(status.lastCheckAt)}</small>
        </div>
        <div class="bu-top-actions">
          <button type="button" class="bu-action-btn primary" data-bu="check" title="เช็กเวอร์ชันล่าสุดและสั่งอัปเดตทันที">
            🔍 เช็กและอัปเดตตอนนี้
          </button>
          <button type="button" class="bu-close-btn" data-bu="close" title="ปิดหน้าต่าง">✕</button>
        </div>
      </div>

      <!-- Bot Auto-Update Summary Card -->
      <div class="bu-card">
        <div class="bu-card-head">
          <div class="bu-card-title">
            <span>🤖 สคริปต์บอทเกม (bot.js)</span>
            ${l && l.version ? `<span class="bu-badge info">v${esc(l.version)}</span>` : ''}
            <span class="bu-badge ${status.ready && l && status.ready.sha === l.sha ? 'ok' : 'warn'}">
              ${status.ready && l && status.ready.sha === l.sha ? '✅ พร้อมใช้งาน' : status.phase === 'waiting-cdn' ? '⏳ รอ CDN' : 'พร้อมตรวจสอบ'}
            </span>
          </div>
          <button type="button" class="bu-switch ${status.enabled ? 'on' : ''}" data-bu="toggle" title="เปิด/ปิด Auto-update บอท"><span></span></button>
        </div>
        <div class="bu-card-body">
          ${l
            ? `<div class="bu-commit-line"><code>${esc(l.sha.slice(0, 7))}</code> <span>${esc(l.message)}</span> <small style="color:#64748b;">(${ago(l.date)})</small></div>`
            : `<div class="bu-muted">ยังไม่ได้เช็กเวอร์ชัน (กดปุ่ม "เช็กและอัปเดตตอนนี้" ด้านบนได้เลย)</div>`}
          ${status.phase === 'settling' && status.settleUntil
            ? `<div class="bu-meta-line" style="color:#fcd34d;">⏳ จะรีเฟรชจออัตโนมัติเวลา ${new Date(status.settleUntil).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} หรือกดปุ่มด้านล่างเพื่ออัปเดตทันที</div>`
            : `<div class="bu-meta-line">เช็กอัตโนมัติทุก ${status.pollMinutes || 5} นาที · รีเฟรชทีละจอเฉพาะตอนปลอดภัยแล้วบอทฟาร์มต่อเอง</div>`}
          ${status.lastError ? `<div class="bu-error">⚠️ ${esc(status.lastError)}</div>` : ''}
          ${(pending > 0 || errList.length > 0) ? `
            <div class="bu-card-actions">
              <button type="button" class="bu-action-btn warn" data-bu="force-all">
                ⚡ บังคับรีเฟรชจอที่ยังไม่อัปเดตทันที (${pending + errList.length} จอ)
              </button>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Manager Self-Update Summary Card (Always Visible Near Top!) -->
      ${renderManagerCard()}

      <!-- Filter Tabs for Screen List -->
      <div class="bu-filter-bar">
        <button type="button" class="bu-filter-tab ${activeFilter === 'all' ? 'active' : ''}" data-bu-filter="all">
          ทั้งหมด <span>${clientEntries.length}</span>
        </button>
        <button type="button" class="bu-filter-tab ${activeFilter === 'pending' ? 'active' : ''} ${pending > 0 ? 'has-warn' : ''}" data-bu-filter="pending">
          รออัปเดต <span>${pending}</span>
        </button>
        <button type="button" class="bu-filter-tab ${activeFilter === 'ok' ? 'active' : ''}" data-bu-filter="ok">
          ล่าสุดแล้ว <span>${okList.length}</span>
        </button>
        ${errList.length > 0 ? `
          <button type="button" class="bu-filter-tab ${activeFilter === 'error' ? 'active' : ''} has-err" data-bu-filter="error">
            มีปัญหา <span>${errList.length}</span>
          </button>
        ` : ''}
      </div>

      <!-- Scrollable 2-Column Compact Screen List -->
      <div class="bu-clients">
        ${filteredClients.length ? filteredClients.map(c => {
          const [icon, label] = STATE_LABEL[c.state] || ['•', c.state];
          return `
            <div class="bu-client ${esc(c.state)}" title="${esc(c.note || label)}">
              <div class="bu-client-main">
                <span class="bu-client-name">${icon} ${esc(c.name)}${c.version ? ` <em class="bu-ver">v${esc(c.version)}</em>` : ''}</span>
                <small class="bu-client-note">${esc(c.note || label)}</small>
              </div>
              <button type="button" class="bu-client-reload" data-bu="reload-one" data-id="${esc(c.id)}" title="สั่งรีเฟรชอัปเดตจอ ${esc(c.name)} ทันที">🔄</button>
            </div>`;
        }).join('') : `<div class="bu-muted" style="grid-column: 1 / -1; text-align: center; padding: 16px 8px;">ไม่มีรายการจอในหมวดนี้</div>`}
      </div>

      <div class="bu-foot">
        <small>💡 กดปุ่ม 🔄 ท้ายรายชื่อจอเพื่อสั่งรีเฟรชเฉพาะจอนั้นได้ทันที</small>
        <button type="button" class="btn btn-ghost btn-sm" data-bu="check">เช็กตอนนี้</button>
      </div>`;
  }

  mount();
  load();
  setInterval(load, 10000);
})();
