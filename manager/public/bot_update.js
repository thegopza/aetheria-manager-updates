// manager/public/bot_update.js — header pill + panel for automatic bot.js updates from GitHub
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

  function mount() {
    const actions = document.querySelector('.header-actions');
    if (!actions || pill) return;
    const wrap = document.createElement('div');
    wrap.className = 'bu-wrap';
    wrap.innerHTML = `
      <button type="button" class="btn btn-ghost bu-pill" title="อัปเดตบอทอัตโนมัติจาก GitHub">
        <span class="bu-dot"></span><span class="bu-text">Auto-update</span>
      </button>
      <div class="bu-panel" hidden></div>`;
    const refresh = document.getElementById('btn-refresh');
    actions.insertBefore(wrap, refresh || null);
    pill = wrap.querySelector('.bu-pill');
    panel = wrap.querySelector('.bu-panel');
    pill.addEventListener('click', e => { e.stopPropagation(); panel.hidden = !panel.hidden; render(); });
    document.addEventListener('click', e => { if (!wrap.contains(e.target)) panel.hidden = true; });
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
    const b = e.target.closest('[data-bu]');
    if (!b) return;
    if (b.dataset.bu === 'toggle') {
      await fetch('/api/bot-update/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !status.enabled }) });
      await load();
    } else if (b.dataset.bu === 'check') {
      b.disabled = true;
      b.textContent = '⏳ กำลังเช็ก...';
      await Promise.all([fetch('/api/bot-update/check', { method: 'POST' }), fetch('/api/manager-update/check', { method: 'POST' })]);
      setTimeout(load, 3000);
    } else if (b.dataset.bu === 'mtoggle') {
      await fetch('/api/manager-update/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !mgr.enabled }) });
      await load();
    } else if (b.dataset.bu === 'mapply') {
      if (!confirm(mgr.mode === 'git' ? 'รีสตาร์ท Manager server ตอนนี้? (จอเกมไม่ปิด)' : 'อัปเดต Manager จาก GitHub ตอนนี้? (จอเกมไม่ปิด)')) return;
      b.disabled = true;
      b.textContent = '⏳ กำลังอัปเดต...';
      const r = await fetch('/api/manager-update/apply', { method: 'POST' }).then(x => x.json()).catch(() => null);
      if (r && !r.success) alert(r.error || 'อัปเดตไม่สำเร็จ');
      setTimeout(load, 3000);
    } else if (b.dataset.bu === 'reload') {
      location.reload();
    }
  }

  function renderManagerSection() {
    if (!mgr) return '';
    const files = mgr.pending || [];
    const modeText = mgr.mode === 'git'
      ? 'โหมดนักพัฒนา (รันจากโฟลเดอร์ git): ไม่ดาวน์โหลดทับไฟล์ในเครื่อง — เมื่อไฟล์ server ถูก commit จะรีสตาร์ท server ให้เอง'
      : 'เช็ก GitHub ทุก 10 นาที มีไฟล์ใหม่ในโฟลเดอร์ manager/ จะดาวน์โหลดและรีสตาร์ท server ให้เอง (ไม่แตะ profiles/presets/settings)';
    return `
      <div class="bu-sep"></div>
      <div class="bu-head">
        <b>🖥️ ตัว Manager</b>
        <button type="button" class="bu-switch ${mgr.enabled ? 'on' : ''}" data-bu="mtoggle" title="เปิด/ปิด"><span></span></button>
      </div>
      <p class="bu-desc">${modeText} · จอเกมไม่ปิด</p>
      ${!mgr.supervised ? '<div class="bu-error">⚠️ ต้องปิด-เปิด PelicanManager.exe หนึ่งครั้ง เพื่อเปิดใช้การรีสตาร์ท server อัตโนมัติ</div>' : ''}
      ${reloadPending ? '<div class="bu-latest"><div>♻️ มีหน้าเว็บเวอร์ชันใหม่</div><button type="button" class="btn btn-ghost btn-sm" data-bu="reload">โหลดหน้าใหม่</button></div>' : ''}
      <div class="bu-latest">
        ${mgr.mode === 'release' && mgr.latest ? `<small>manager/ ล่าสุดบน GitHub</small><div><code>${esc(mgr.latest.sha.slice(0, 7))}</code> ${esc(mgr.latest.message)}</div>` : ''}
        ${files.length
          ? `<small>${files.length} ไฟล์ที่ต้องอัปเดต: ${esc(files.map(f => f.path).slice(0, 6).join(', '))}${files.length > 6 ? ' ...' : ''}</small>`
          : '<small>✅ Manager เป็นเวอร์ชันล่าสุด</small>'}
        ${mgr.note ? `<small>${esc(mgr.note)}</small>` : ''}
        ${mgr.lastApplied ? `<small>อัปเดตล่าสุด ${ago(mgr.lastApplied.at)} (${(mgr.lastApplied.files || []).length} ไฟล์)</small>` : ''}
      </div>
      ${mgr.lastError ? `<div class="bu-error">⚠️ ${esc(mgr.lastError)}</div>` : ''}
      ${files.length && mgr.supervised ? `<button type="button" class="btn btn-ghost btn-sm" data-bu="mapply">${mgr.mode === 'git' ? '♻️ รีสตาร์ท server ตอนนี้' : '⬇️ อัปเดต Manager ตอนนี้'}</button>` : ''}`;
  }

  function render() {
    if (!pill || !status) return;
    if (reloadPending && !userBusy() && !document.querySelector('.bu-reload-toast')) watchForNewBuild();
    const clients = Object.values(status.clients || {});
    const pending = clients.filter(c => ['outdated', 'waiting', 'reloading', 'resuming'].includes(c.state)).length;
    const hasError = clients.some(c => c.state === 'error') || status.lastError;
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
    panel.innerHTML = `
      <div class="bu-head">
        <b>🔄 อัปเดตบอทอัตโนมัติ</b>
        <button type="button" class="bu-switch ${status.enabled ? 'on' : ''}" data-bu="toggle" title="เปิด/ปิด">
          <span></span>
        </button>
      </div>
      <p class="bu-desc">เช็ก GitHub ทุก ${status.pollMinutes || 5} นาที เมื่อ bot.js มีเวอร์ชันใหม่ จะรีเฟรชหน้าเกมทีละจอเฉพาะตอนที่ปลอดภัย แล้วให้บอทกลับมาทำงานต่อ</p>
      <div class="bu-latest">
        <small>bot.js ล่าสุดบน GitHub</small>
        ${l ? `<div><code>${esc(l.sha.slice(0, 7))}</code> ${esc(l.message)}</div><small>${ago(l.date)}${status.ready && status.ready.sha === l.sha ? ' · ✅ พร้อมใช้งาน' : status.phase === 'waiting-cdn' ? ' · ⏳ รอ GitHub CDN' : ''}${status.phase === 'settling' ? ' · ⏳ จะรีเฟรชจอตอน ' + new Date(status.settleUntil).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' (รอ 10 นาทีเผื่อมีเวอร์ชันใหม่ตามมา จะได้รีเฟรชรอบเดียว — กด "เช็กตอนนี้" เพื่ออัปเดตทันที)' : ''}</small>`
          : '<div class="bu-muted">ยังไม่ได้เช็ก (เช็กครั้งแรกหลังเปิด Manager 1 นาที)</div>'}
      </div>
      ${status.lastError ? `<div class="bu-error">⚠️ ${esc(status.lastError)}</div>` : ''}
      <div class="bu-clients">
        ${clients.length ? clients.map(c => {
          const [icon, label] = STATE_LABEL[c.state] || ['•', c.state];
          return `<div class="bu-client ${c.state}"><span>${icon} ${esc(c.name)}${c.version ? ` <em class="bu-ver">v${esc(c.version)}</em>` : ''}</span><small>${esc(c.note || label)}</small></div>`;
        }).join('') : '<div class="bu-muted">ยังไม่มีข้อมูลจอ</div>'}
      </div>
      ${renderManagerSection()}
      <div class="bu-foot">
        <small>เช็กล่าสุด ${ago(status.lastCheckAt)}</small>
        <button type="button" class="btn btn-ghost btn-sm" data-bu="check">เช็กตอนนี้</button>
      </div>`;
  }

  mount();
  load();
  setInterval(load, 10000);
})();
