// PmheeAether Manager — Party drawer (crown tab on the left edge). Backend: manager/party_api.js
(function () {
  'use strict';
  const API = (typeof API_BASE === 'string' ? API_BASE : '') + '/api/parties';
  const EXP = { 'even-share': 'แชร์กัน (มีโบนัส)', individual: 'รับใครรับมัน' };
  const LOOT = { personal: 'คนตีมากสุด', 'round-robin': 'วนกันรับ', leader: 'หัวหน้า' };
  const CROWN = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 7.5l4.2 3.6L12 4l4.8 7.1L21 7.5l-1.8 10.2H4.8L3 7.5zm2 12.2h14v1.8H5v-1.8z"/></svg>';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (t, k) => (typeof window.showToast === 'function' ? window.showToast(t, k) : console.log('[Party]', t));
  const hue = s => { let h = 0; for (const c of String(s || '?')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const initial = s => (String(s || '?').trim()[0] || '?').toUpperCase();

  let data = { parties: [], clients: [], maxMembers: 6 };
  let open = false, pollTimer = null, busy = false;

  function build() {
    const tab = document.createElement('button');
    tab.className = 'pt-tab'; tab.id = 'pt-tab'; tab.type = 'button';
    tab.title = 'ปาร์ตี้'; tab.setAttribute('aria-label', 'เปิดหน้าจัดปาร์ตี้');
    tab.innerHTML = CROWN + '<span class="pt-tab-badge" id="pt-tab-badge"></span>';
    const scrim = document.createElement('div'); scrim.className = 'pt-scrim'; scrim.id = 'pt-scrim';
    const drawer = document.createElement('aside');
    drawer.className = 'pt-drawer'; drawer.id = 'pt-drawer'; drawer.setAttribute('aria-label', 'จัดปาร์ตี้');
    drawer.innerHTML = `
      <header class="pt-head">
        <div class="pt-head-icon">${CROWN}</div>
        <div><h2>ปาร์ตี้</h2><p>จัดตี้อัตโนมัติ สูงสุด 6 คนรวมหัวตี้</p></div>
        <button class="pt-close" id="pt-close" type="button" aria-label="ปิด">✕</button>
      </header>
      <div class="pt-body" id="pt-body"></div>
      <footer class="pt-foot">
        <button class="pt-add" id="pt-add" type="button">➕ เพิ่มตี้</button>
        <div class="pt-foot-hint">เลือกหัวตี้ แล้วระบบจะชวนจอที่เลเวลใกล้กันเข้าตี้ให้จนครบ 6 คน<br>สมาชิกตามไปแมพ + CH เดียวกับหัวตี้ · จอที่แผนยังเก็บ Base/Job ไม่ครบจะไม่ถูกดึง</div>
      </footer>
      <section class="pt-picker" id="pt-picker" hidden>
        <div class="pt-picker-head">
          <button class="pt-iconbtn" id="pt-pick-back" type="button" aria-label="กลับ">←</button>
          <h3>เลือกหัวตี้</h3>
        </div>
        <input class="pt-search" id="pt-search" type="search" placeholder="ค้นหาชื่อจอ / ชื่อตัวละคร" autocomplete="off">
        <div class="pt-pick-list" id="pt-pick-list"></div>
      </section>`;
    document.body.append(tab, scrim, drawer);

    tab.addEventListener('click', () => setOpen(true));
    scrim.addEventListener('click', () => setOpen(false));
    drawer.querySelector('#pt-close').addEventListener('click', () => setOpen(false));
    drawer.querySelector('#pt-add').addEventListener('click', openPicker);
    drawer.querySelector('#pt-pick-back').addEventListener('click', closePicker);
    drawer.querySelector('#pt-search').addEventListener('input', renderPicker);
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !open) return;
      if (!document.getElementById('pt-picker').hidden) closePicker(); else setOpen(false);
    });
    drawer.querySelector('#pt-body').addEventListener('change', onChange);
    drawer.querySelector('#pt-body').addEventListener('click', onClick);
  }

  function setOpen(v) {
    open = v;
    if (v) document.body.classList.remove('pm-open');
    document.body.classList.toggle('pt-open', v);
    clearInterval(pollTimer);
    if (v) { load(); pollTimer = setInterval(load, 5000); }
    else { closePicker(); pollTimer = setInterval(load, 30000); }
  }

  async function api(path, body) {
    const res = await fetch(API + path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({ success: false, error: 'HTTP ' + res.status }));
    if (j && Array.isArray(j.parties)) { data = j; render(); }
    return j;
  }

  async function load() {
    if (busy) return;
    try { await api(''); } catch (e) { /* Manager restarting */ }
  }

  function memberRow(m, pid, isLeader) {
    const sub = [m.profileName, m.mapName ? m.mapName + (m.channel ? ' · CH ' + m.channel : '') : null].filter(Boolean).join(' · ');
    return `<div class="pt-row ${isLeader ? 'leader' : ''}">
      <div class="pt-ava" style="--pt-h:${hue(m.charName || m.profileName)}">${isLeader ? CROWN.replace('<svg', '<svg width="16" height="16"') : esc(initial(m.charName || m.profileName))}</div>
      <div class="pt-who">
        <div class="pt-name">${esc(m.charName || m.profileName)}${m.level ? `<span class="pt-lv">Lv.${esc(m.level)}</span>` : ''}</div>
        <div class="pt-sub">${esc(sub)}</div>
      </div>
      <span class="pt-status ${esc(m.status)}">${esc(m.statusText)}</span>
      ${isLeader ? '' : `<button class="pt-rm" type="button" title="เอาออกจากตี้" data-act="remove" data-party="${esc(pid)}" data-id="${esc(m.id)}">✕</button>`}
    </div>`;
  }

  function card(p) {
    const full = p.count >= p.max;
    const slots = Math.max(0, p.max - p.count);
    const evenBlocked = p.inGame && p.inGame.evenShareAllowed === false;
    const opt = (map, cur, dis) => Object.keys(map).map(k => `<option value="${k}" ${k === cur ? 'selected' : ''} ${dis && dis(k) ? 'disabled' : ''}>${esc(map[k])}</option>`).join('');
    return `<article class="pt-card" data-party="${esc(p.id)}">
      <div class="pt-card-top">
        <span class="pt-card-title">ตี้ ${p.index}</span>
        <span class="pt-count ${full ? 'full' : ''}">${p.count}/${p.max}</span>
        <button class="pt-iconbtn" type="button" title="รวมทีม (เรียกสมาชิกมาหาหัวตี้)" data-act="summon" data-party="${esc(p.id)}">⤓</button>
        <button class="pt-iconbtn danger" type="button" title="ยุบตี้" data-act="delete" data-party="${esc(p.id)}">🗑</button>
      </div>
      ${memberRow(p.leader, p.id, true)}
      ${p.members.map(m => memberRow(m, p.id, false)).join('')}
      ${slots ? `<div class="pt-row pt-slot"><div class="pt-ava">+</div><div class="pt-who">ว่าง ${slots} ที่${p.autoFill ? ' · รอจอที่ออนไลน์และว่างอยู่' : ''}</div></div>` : ''}
      <div class="pt-modes">
        <div class="pt-field"><label for="pt-exp-${esc(p.id)}">โหมด EXP</label>
          <select id="pt-exp-${esc(p.id)}" data-set="expMode" data-party="${esc(p.id)}">${opt(EXP, p.expMode)}</select></div>
        <div class="pt-field"><label for="pt-loot-${esc(p.id)}">โหมดไอเทม</label>
          <select id="pt-loot-${esc(p.id)}" data-set="lootMode" data-party="${esc(p.id)}">${opt(LOOT, p.lootMode)}</select></div>
      </div>
      <div class="pt-toggles">
        <label class="pt-toggle"><input type="checkbox" data-set="syncMap" data-party="${esc(p.id)}" ${p.syncMap ? 'checked' : ''}>ตามแมพ + CH หัวตี้</label>
        <label class="pt-toggle"><input type="checkbox" data-set="autoFill" data-party="${esc(p.id)}" ${p.autoFill ? 'checked' : ''}>เติมสมาชิกอัตโนมัติ</label>
      </div>
      ${(p.notes && p.notes.length) || evenBlocked ? `<div class="pt-notes">${(p.notes || []).map(n => `<div class="pt-note">${esc(n)}</div>`).join('')}${evenBlocked && p.expMode === 'even-share' && !(p.notes || []).some(n => n.includes('แชร์ EXP')) ? `<div class="pt-note">แชร์ EXP ได้เมื่อเลเวลต่างกันไม่เกิน ${esc(p.inGame.levelRange)}</div>` : ''}</div>` : ''}
    </article>`;
  }

  function render() {
    const badge = document.getElementById('pt-tab-badge');
    if (badge) badge.textContent = data.parties.length ? String(data.parties.length) : '';
    const body = document.getElementById('pt-body');
    if (!body) return;
    // Don't redraw under the user's hand
    if (body.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
    body.innerHTML = data.parties.length ? data.parties.map(card).join('') :
      `<div class="pt-empty">ยังไม่มีปาร์ตี้<br>กด <b>➕ เพิ่มตี้</b> ด้านล่างเพื่อเลือกหัวตี้</div>`;
    const free = data.clients.filter(c => !c.assigned);
    const add = document.getElementById('pt-add');
    if (add) { add.disabled = !free.length; add.title = free.length ? '' : 'ทุกจออยู่ในตี้แล้ว'; }
    if (!document.getElementById('pt-picker').hidden) renderPicker();
  }

  function openPicker() {
    const pk = document.getElementById('pt-picker');
    pk.hidden = false;
    const s = document.getElementById('pt-search'); s.value = ''; renderPicker(); setTimeout(() => s.focus(), 50);
  }
  function closePicker() { const pk = document.getElementById('pt-picker'); if (pk) pk.hidden = true; }

  function renderPicker() {
    const q = (document.getElementById('pt-search').value || '').trim().toLowerCase();
    const list = data.clients
      .filter(c => !c.assigned)
      .filter(c => !q || String(c.name).toLowerCase().includes(q) || String(c.charName || '').toLowerCase().includes(q))
      .sort((a, b) => (b.online - a.online) || ((b.level || 0) - (a.level || 0)) || String(a.name).localeCompare(String(b.name)));
    const el = document.getElementById('pt-pick-list');
    el.innerHTML = list.length ? list.map(c => `
      <button class="pt-pick ${c.online ? '' : 'off'}" type="button" data-pick="${esc(c.id)}">
        <div class="pt-ava" style="--pt-h:${hue(c.charName || c.name)}">${esc(initial(c.charName || c.name))}</div>
        <div class="pt-who">
          <div class="pt-name">${esc(c.charName || c.name)}${c.level ? `<span class="pt-lv">Lv.${esc(c.level)}</span>` : ''}</div>
          <div class="pt-sub">${esc([c.name, c.online ? (c.mapName ? c.mapName + (c.channel ? ' · CH ' + c.channel : '') : 'ออนไลน์') : 'ออฟไลน์', c.inGameParty ? 'มีตี้ในเกมอยู่แล้ว' : null, c.planPending ? 'แผนยังเก็บเลเวล (' + c.planPending + ')' : null].filter(Boolean).join(' · '))}</div>
        </div>
        <span class="pt-go">เลือก →</span>
      </button>`).join('') : `<div class="pt-empty">ไม่มีจอที่ว่าง — ทุกจออยู่ในตี้แล้ว</div>`;
    el.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => createParty(b.dataset.pick)));
  }

  async function createParty(leaderId) {
    busy = true;
    try {
      const r = await api('', { leaderId });
      if (r.success === false) toast(r.error || 'เพิ่มตี้ไม่สำเร็จ', 'error');
      else { toast('เพิ่มตี้แล้ว กำลังชวนสมาชิกที่เลเวลใกล้กัน', 'success'); closePicker(); }
    } finally { busy = false; }
  }

  async function onChange(e) {
    const t = e.target; if (!t.dataset.set) return;
    const v = t.type === 'checkbox' ? t.checked : t.value;
    busy = true;
    try {
      const r = await api('/' + encodeURIComponent(t.dataset.party) + '/settings', { [t.dataset.set]: v });
      if (r.success === false) toast(r.error || 'บันทึกไม่สำเร็จ', 'error');
    } finally { busy = false; t.blur(); }
  }

  async function onClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const pid = encodeURIComponent(b.dataset.party);
    if (b.dataset.act === 'delete') {
      if (!confirm('ยุบตี้นี้? สมาชิกทุกจอจะออกจากปาร์ตี้ในเกม')) return;
      const r = await api('/' + pid + '/delete', {});
      toast(r.success === false ? (r.error || 'ยุบตี้ไม่สำเร็จ') : 'ยุบตี้แล้ว', r.success === false ? 'error' : 'success');
    } else if (b.dataset.act === 'remove') {
      const r = await api('/' + pid + '/remove-member', { profileId: b.dataset.id });
      toast(r.success === false ? (r.error || 'เอาออกไม่สำเร็จ') : 'เอาออกจากตี้แล้ว (จะไม่ถูกเลือกเข้าตี้นี้อัตโนมัติอีก)', r.success === false ? 'error' : 'success');
    } else if (b.dataset.act === 'summon') {
      const r = await api('/' + pid + '/summon', {});
      toast(r.success === false ? (r.error || 'รวมทีมไม่สำเร็จ') : 'หัวตี้เรียกสมาชิกมารวมแล้ว', r.success === false ? 'error' : 'success');
    }
  }

  function init() { build(); setOpen(false); load(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
