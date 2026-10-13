// PmheeAether Manager — Auto Premium drawer (diamond tab under the party crown). Backend: manager/premium_api.js
(function () {
  'use strict';
  const API = (typeof API_BASE === 'string' ? API_BASE : '') + '/api/premium';
  const GEM = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 3h10l4.5 5.5L12 21 2.5 8.5 7 3zm1.1 2L5.6 8h3.1l1.6-3H8.1zm5.6 0l1.6 3h3.1l-2.5-3h-2.2zM12 5.4L10.9 8h2.2L12 5.4zM5.9 10l4.5 6.1L8.7 10H5.9zm4.9 0L12 15.6 13.2 10h-2.4zm4.5 0l-1.7 6.1 4.5-6.1h-2.8z"/></svg>';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (t, k) => (typeof window.showToast === 'function' ? window.showToast(t, k) : console.log('[Premium]', t));
  const fmt = n => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('th-TH'));
  const hue = s => { let h = 0; for (const c of String(s || '?')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const initial = s => (String(s || '?').trim()[0] || '?').toUpperCase();
  const left = ms => {
    if (!ms) return '';
    const d = ms - Date.now(); if (d <= 0) return 'หมดแล้ว';
    const day = Math.floor(d / 86400000), h = Math.floor((d % 86400000) / 3600000), m = Math.floor((d % 3600000) / 60000);
    return day ? `เหลือ ${day} วัน ${h} ชม.` : h ? `เหลือ ${h} ชม. ${m} นาที` : `เหลือ ${m} นาที`;
  };

  let data = { settings: {}, market: null, clients: [] };
  let open = false, pollTimer = null, busy = false, filter = 'all';

  function build() {
    const tab = document.createElement('button');
    tab.className = 'pm-tab'; tab.id = 'pm-tab'; tab.type = 'button';
    tab.title = 'Premium อัตโนมัติ'; tab.setAttribute('aria-label', 'เปิดหน้า Premium อัตโนมัติ');
    tab.innerHTML = GEM + '<span class="pm-tab-badge" id="pm-tab-badge"></span>';
    const scrim = document.createElement('div'); scrim.className = 'pm-scrim'; scrim.id = 'pm-scrim';
    const drawer = document.createElement('aside');
    drawer.className = 'pm-drawer'; drawer.id = 'pm-drawer'; drawer.setAttribute('aria-label', 'Premium อัตโนมัติ');
    drawer.innerHTML = `
      <header class="pm-head">
        <div class="pm-head-icon">${GEM}</div>
        <div><h2>Premium อัตโนมัติ</h2><p>ซื้อ Token ด้วย zeny แล้วปลดล็อค / ต่อ Premium ให้เอง</p></div>
        <button class="pm-close" id="pm-close" type="button" aria-label="ปิด">✕</button>
      </header>
      <section class="pm-settings" id="pm-settings"></section>
      <nav class="pm-filter" id="pm-filter">
        <button type="button" data-f="all" class="on">ทุกจอ</button>
        <button type="button" data-f="on">เปิดอยู่</button>
        <button type="button" data-f="active">มี Premium</button>
        <span class="pm-filter-sp"></span>
        <button type="button" class="pm-mini" id="pm-all-on">เปิดทุกจอ</button>
        <button type="button" class="pm-mini" id="pm-all-off">ปิดทุกจอ</button>
      </nav>
      <div class="pm-body" id="pm-body"></div>
      <footer class="pm-foot">
        เริ่มทำงานเมื่อ Plan Script ผ่านครบทุกเงื่อนไข (เลเวล ใส่เซ็ต เงิน) · จอที่ไม่ได้ใช้แผนเริ่มได้ทันที<br>
        ยังไม่มี Premium → ซื้อ Token ราคาขายต่ำสุดจนครบแล้วปลดล็อค · มี Premium แล้ว → ทยอยซื้อให้ครบก่อนหมด ${'<b id="pm-lead-hint"></b>'}
      </footer>`;
    document.body.append(tab, scrim, drawer);

    tab.addEventListener('click', () => setOpen(true));
    scrim.addEventListener('click', () => setOpen(false));
    drawer.querySelector('#pm-close').addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) setOpen(false); });
    drawer.querySelector('#pm-body').addEventListener('change', onToggle);
    drawer.querySelector('#pm-settings').addEventListener('change', onSetting);
    drawer.querySelector('#pm-filter').addEventListener('click', e => {
      const b = e.target.closest('[data-f]'); if (!b) return;
      filter = b.dataset.f;
      drawer.querySelectorAll('#pm-filter [data-f]').forEach(x => x.classList.toggle('on', x === b));
      renderList();
    });
    drawer.querySelector('#pm-all-on').addEventListener('click', () => toggle('*', true));
    drawer.querySelector('#pm-all-off').addEventListener('click', () => toggle('*', false));
  }

  function setOpen(v) {
    open = v;
    if (v) document.body.classList.remove('pt-open');
    document.body.classList.toggle('pm-open', v);
    clearInterval(pollTimer);
    if (v) { load(); pollTimer = setInterval(load, 5000); }
    else pollTimer = setInterval(load, 60000);
  }

  async function api(p, body) {
    const res = await fetch(API + p, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({ success: false, error: 'HTTP ' + res.status }));
    if (j && Array.isArray(j.clients)) { data = j; render(); }
    return j;
  }
  async function load() { if (busy) return; try { await api(''); } catch (e) { /* Manager restarting */ } }

  function renderSettings() {
    const el = document.getElementById('pm-settings'); if (!el) return;
    if (el.contains(document.activeElement)) return;
    const s = data.settings || {}, m = data.market;
    const plans = (m && m.plans && m.plans.length) ? m.plans : [{ id: '7d', days: 7, tokens: 1000 }, { id: '30d', days: 30, tokens: 3500 }, { id: '90d', days: 90, tokens: 8000 }];
    const cur = plans.find(p => p.id === s.planId) || plans[0];
    const est = m && m.bestAsk && cur ? cur.tokens * m.bestAsk : null;
    el.innerHTML = `
      <div class="pm-market">
        <div><span>ราคาขายต่ำสุด</span><b>${m && m.bestAsk ? fmt(m.bestAsk) + ' z' : '—'}</b><small>/ Token</small></div>
        <div><span>Premium ${esc(cur.days)} วัน</span><b>${fmt(cur.tokens)}</b><small>Token</small></div>
        <div><span>ประมาณ</span><b>${est ? (est / 1e6).toFixed(1) + 'M' : '—'}</b><small>z / รอบ</small></div>
      </div>
      <div class="pm-fields">
        <div class="pm-field"><label for="pm-plan">แพ็กเกจ</label>
          <select id="pm-plan" data-set="planId">${plans.map(p => `<option value="${esc(p.id)}" ${p.id === cur.id ? 'selected' : ''}>${esc(p.days)} วัน · ${fmt(p.tokens)} Token</option>`).join('')}</select></div>
        <div class="pm-field"><label for="pm-reserve">เก็บเงินสำรองไว้ (z)</label>
          <input id="pm-reserve" data-set="reserveZeny" inputmode="numeric" value="${esc(fmt(s.reserveZeny))}"></div>
        <div class="pm-field"><label for="pm-lead">ซื้อครบก่อนหมด (วัน)</label>
          <input id="pm-lead" data-set="leadDays" inputmode="decimal" value="${esc(s.leadDays)}"></div>
      </div>`;
    const hint = document.getElementById('pm-lead-hint');
    if (hint) hint.textContent = cur ? `(${cur.days} วัน → ครบใน ${Math.max(0.25, cur.days - (Number(s.leadDays) || 0))} วัน)` : '';
  }

  function row(c) {
    const cost = c.cost || 1000;
    const pct = c.tokens == null ? 0 : Math.min(100, Math.round(c.tokens / cost * 100));
    const tgtPct = c.target == null ? null : Math.min(100, Math.round(c.target / cost * 100));
    const active = c.premiumUntil && c.premiumUntil > Date.now();
    const sub = [c.name, c.online ? (c.zeny != null ? fmt(c.zeny) + ' z' : null) : 'ออฟไลน์', c.planName ? 'แผน ' + c.planName : null].filter(Boolean).join(' · ');
    const last = c.history && c.history[0];
    return `<div class="pm-row ${c.enabled ? 'on' : ''}">
      <div class="pm-ava ${active ? 'vip' : ''}" style="--pm-h:${hue(c.charName || c.name)}">${active ? GEM.replace('<svg', '<svg width="16" height="16"') : esc(initial(c.charName || c.name))}</div>
      <div class="pm-who">
        <div class="pm-name">${esc(c.charName || c.name)}${c.level ? `<span class="pm-lv">Lv.${esc(c.level)}</span>` : ''}
          ${active ? `<span class="pm-vip" title="${esc(new Date(c.premiumUntil).toLocaleString('th-TH'))}">Premium · ${esc(left(c.premiumUntil))}</span>` : ''}</div>
        <div class="pm-sub">${esc(sub)}</div>
        ${c.enabled ? `<div class="pm-bar" title="Token ${fmt(c.tokens)} / ${fmt(cost)}${c.target != null ? ' · เป้าตอนนี้ ' + fmt(c.target) : ''}">
          <i style="width:${pct}%"></i>${tgtPct != null && tgtPct < 100 ? `<em style="left:${tgtPct}%"></em>` : ''}
          <span>${fmt(c.tokens)} / ${fmt(cost)} Token</span></div>` : ''}
        ${c.enabled ? `<div class="pm-state ${esc(c.status)}">${esc(c.statusText)}</div>` : ''}
        ${c.enabled && last ? `<div class="pm-last ${last.ok ? '' : 'bad'}">${esc(new Date(last.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }))} · ${esc(last.text)}</div>` : ''}
      </div>
      <label class="pm-switch" title="${c.enabled ? 'ปิด' : 'เปิด'} Premium อัตโนมัติ"><input type="checkbox" data-id="${esc(c.id)}" ${c.enabled ? 'checked' : ''}><span></span></label>
    </div>`;
  }

  function renderList() {
    const body = document.getElementById('pm-body'); if (!body) return;
    let list = data.clients.slice();
    if (filter === 'on') list = list.filter(c => c.enabled);
    if (filter === 'active') list = list.filter(c => c.premiumUntil && c.premiumUntil > Date.now());
    list.sort((a, b) => (b.enabled - a.enabled) || (b.online - a.online) || String(a.name).localeCompare(String(b.name), 'th', { numeric: true }));
    body.innerHTML = list.length ? list.map(row).join('') : `<div class="pm-empty">ไม่มีจอในหมวดนี้</div>`;
  }

  function render() {
    const badge = document.getElementById('pm-tab-badge');
    const n = data.clients.filter(c => c.enabled).length;
    if (badge) badge.textContent = n ? String(n) : '';
    renderSettings();
    renderList();
  }

  async function toggle(profileId, enabled) {
    if (profileId === '*' && enabled && !confirm('เปิด Premium อัตโนมัติทุกจอ? แต่ละจอจะเริ่มซื้อ Token ด้วย zeny เมื่อผ่านเงื่อนไขแผน')) return;
    busy = true;
    try {
      const r = await api('/toggle', { profileId, enabled });
      if (r.success === false) toast(r.error || 'บันทึกไม่สำเร็จ', 'error');
      else toast(enabled ? 'เปิด Premium อัตโนมัติแล้ว' : 'ปิด Premium อัตโนมัติแล้ว', 'success');
    } finally { busy = false; }
  }
  function onToggle(e) { const t = e.target; if (t.dataset.id) toggle(t.dataset.id, t.checked); }

  async function onSetting(e) {
    const t = e.target; if (!t.dataset.set) return;
    let v = t.value;
    if (t.dataset.set === 'reserveZeny') v = Number(String(v).replace(/[^0-9]/g, '')) || 0;
    if (t.dataset.set === 'leadDays') v = Number(v);
    busy = true;
    try {
      const r = await api('/settings', { [t.dataset.set]: v });
      if (r.success === false) toast(r.error || 'บันทึกไม่สำเร็จ', 'error'); else toast('บันทึกแล้ว', 'success');
    } finally { busy = false; t.blur(); render(); }
  }

  function init() { build(); setOpen(false); load(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
