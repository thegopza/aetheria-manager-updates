// PmheeAether Manager — Auto Premium drawer (diamond tab under the party crown). Backend: manager/premium_api.js
(function () {
  'use strict';
  const API = (typeof API_BASE === 'string' ? API_BASE : '') + '/api/premium';
  const GEM = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 3h10l4.5 5.5L12 21 2.5 8.5 7 3zm1.1 2L5.6 8h3.1l1.6-3H8.1zm5.6 0l1.6 3h3.1l-2.5-3h-2.2zM12 5.4L10.9 8h2.2L12 5.4zM5.9 10l4.5 6.1L8.7 10H5.9zm4.9 0L12 15.6 13.2 10h-2.4zm4.5 0l-1.7 6.1 4.5-6.1h-2.8z"/></svg>';
  const GEM_SM = GEM.replace('<svg', '<svg width="16" height="16"');

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (t, k) => (typeof window.showToast === 'function' ? window.showToast(t, k) : console.log('[Premium]', t));
  const fmt = n => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('th-TH'));
  const hue = s => { let h = 0; for (const c of String(s || '?')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const initial = s => (String(s || '?').trim()[0] || '?').toUpperCase();
  const setText = (el, txt) => { if (el && el.textContent !== String(txt)) el.textContent = String(txt); };
  const setHtml = (el, html) => { if (el && el.innerHTML !== html) el.innerHTML = html; };
  const left = ms => {
    if (!ms) return '';
    const d = ms - Date.now(); if (d <= 0) return 'หมดแล้ว';
    const day = Math.floor(d / 86400000), h = Math.floor((d % 86400000) / 3600000), m = Math.floor((d % 3600000) / 60000);
    return day ? `เหลือ ${day} วัน ${h} ชม.` : h ? `เหลือ ${h} ชม. ${m} นาที` : `เหลือ ${m} นาที`;
  };

  let data = { settings: {}, market: null, clients: [] };
  let open = false, pollTimer = null, busy = false, filter = 'all', pointerDown = false, pendingRender = false;
  let lastPlansSig = '';

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
      <section class="pm-settings" id="pm-settings">
        <div class="pm-market">
          <div><span>ราคาขายต่ำสุด</span><b id="pm-ask-val">—</b><small>/ Token</small></div>
          <div><span id="pm-plan-lbl">Premium 7 วัน</span><b id="pm-plan-tokens">1,000</b><small>Token</small></div>
          <div><span>ประมาณ</span><b id="pm-est-val">—</b><small>z / รอบ</small></div>
        </div>
        <div class="pm-fields">
          <div class="pm-field"><label for="pm-plan">แพ็กเกจ</label>
            <select id="pm-plan" data-set="planId"></select></div>
          <div class="pm-field"><label for="pm-reserve">เก็บเงินสำรองไว้ (z)</label>
            <input id="pm-reserve" data-set="reserveZeny" inputmode="numeric" value=""></div>
          <div class="pm-field"><label for="pm-lead">ซื้อครบก่อนหมด (วัน)</label>
            <input id="pm-lead" data-set="leadDays" inputmode="decimal" value=""></div>
        </div>
      </section>
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
        ยังไม่มี Premium → ซื้อ Token ราคาขายต่ำสุดจนครบแล้วปลดล็อค · มี Premium แล้ว → ทยอยซื้อให้ครบก่อนหมด <b id="pm-lead-hint"></b>
      </footer>`;
    document.body.append(tab, scrim, drawer);

    tab.addEventListener('click', () => setOpen(true));
    scrim.addEventListener('click', () => setOpen(false));
    drawer.querySelector('#pm-close').addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) setOpen(false); });
    drawer.addEventListener('pointerdown', () => { pointerDown = true; });
    window.addEventListener('pointerup', () => {
      if (!pointerDown) return;
      pointerDown = false;
      if (pendingRender) { pendingRender = false; render(); }
    });
    window.addEventListener('pointercancel', () => {
      if (!pointerDown) return;
      pointerDown = false;
      if (pendingRender) { pendingRender = false; render(); }
    });
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
    if (j && Array.isArray(j.clients)) {
      data = j;
      if (pointerDown && body === undefined) pendingRender = true;
      else render();
    }
    return j;
  }

  async function load() {
    if (busy || pointerDown) return;
    try { await api(''); } catch (e) { /* Manager restarting */ }
  }

  function renderSettings() {
    const el = document.getElementById('pm-settings'); if (!el) return;
    const s = data.settings || {}, m = data.market;
    const plans = (m && m.plans && m.plans.length) ? m.plans : [{ id: '7d', days: 7, tokens: 1000 }, { id: '30d', days: 30, tokens: 3500 }, { id: '90d', days: 90, tokens: 8000 }];
    const cur = plans.find(p => p.id === s.planId) || plans[0];
    const est = m && m.bestAsk && cur ? cur.tokens * m.bestAsk : null;

    setText(document.getElementById('pm-ask-val'), m && m.bestAsk ? fmt(m.bestAsk) + ' z' : '—');
    setText(document.getElementById('pm-plan-lbl'), `Premium ${cur.days} วัน`);
    setText(document.getElementById('pm-plan-tokens'), fmt(cur.tokens));
    setText(document.getElementById('pm-est-val'), est ? (est / 1e6).toFixed(1) + 'M' : '—');

    const planSel = document.getElementById('pm-plan');
    if (planSel) {
      const sig = plans.map(p => `${p.id}:${p.days}:${p.tokens}`).join('|');
      if (sig !== lastPlansSig) {
        lastPlansSig = sig;
        planSel.innerHTML = plans.map(p => `<option value="${esc(p.id)}">${esc(p.days)} วัน · ${fmt(p.tokens)} Token</option>`).join('');
      }
      if (document.activeElement !== planSel && planSel.value !== String(cur.id)) {
        planSel.value = String(cur.id);
      }
    }

    const resInp = document.getElementById('pm-reserve');
    if (resInp && document.activeElement !== resInp) {
      const nextRes = fmt(s.reserveZeny);
      if (resInp.value !== nextRes) resInp.value = nextRes;
    }

    const leadInp = document.getElementById('pm-lead');
    if (leadInp && document.activeElement !== leadInp) {
      const nextLead = s.leadDays == null ? '' : String(s.leadDays);
      if (leadInp.value !== nextLead) leadInp.value = nextLead;
    }

    const hint = document.getElementById('pm-lead-hint');
    if (hint) setText(hint, cur ? `(${cur.days} วัน → ครบใน ${Math.max(0.25, cur.days - (Number(s.leadDays) || 0))} วัน)` : '');
  }

  function createRowEl(c) {
    const row = document.createElement('div');
    row.className = 'pm-row';
    row.dataset.rowId = String(c.id);
    row.innerHTML = `
      <div class="pm-ava"></div>
      <div class="pm-who">
        <div class="pm-name">
          <span class="pm-name-txt"></span>
          <span class="pm-lv" hidden></span>
          <span class="pm-vip" hidden></span>
        </div>
        <div class="pm-sub"></div>
        <div class="pm-bar" hidden>
          <i></i>
          <em hidden></em>
          <span></span>
        </div>
        <div class="pm-state" hidden></div>
        <div class="pm-last" hidden></div>
      </div>
      <label class="pm-switch"><input type="checkbox" data-id="${esc(c.id)}"><span></span></label>`;
    patchRowEl(row, c);
    return row;
  }

  function patchRowEl(row, c) {
    const cost = c.cost || 1000;
    const pct = c.tokens == null ? 0 : Math.min(100, Math.round(c.tokens / cost * 100));
    const tgtPct = c.target == null ? null : Math.min(100, Math.round(c.target / cost * 100));
    const active = Boolean(c.premiumUntil && c.premiumUntil > Date.now());
    const sub = [c.name, c.online ? (c.zeny != null ? fmt(c.zeny) + ' z' : null) : 'ออฟไลน์', c.planName ? 'แผน ' + c.planName : null].filter(Boolean).join(' · ');
    const last = c.history && c.history[0];
    const displayName = c.charName || c.name || '?';

    const nextRowCls = 'pm-row' + (c.enabled ? ' on' : '');
    if (row.className !== nextRowCls) row.className = nextRowCls;

    const ava = row.querySelector('.pm-ava');
    if (ava) {
      const nextAvaCls = 'pm-ava' + (active ? ' vip' : '');
      if (ava.className !== nextAvaCls) ava.className = nextAvaCls;
      const h = String(hue(displayName));
      if (ava.style.getPropertyValue('--pm-h') !== h) ava.style.setProperty('--pm-h', h);
      if (active) setHtml(ava, GEM_SM);
      else setText(ava, initial(displayName));
    }

    setText(row.querySelector('.pm-name-txt'), displayName);
    const lvEl = row.querySelector('.pm-lv');
    if (lvEl) {
      if (c.level) {
        lvEl.hidden = false;
        setText(lvEl, 'Lv.' + c.level);
      } else {
        lvEl.hidden = true;
      }
    }

    const vipEl = row.querySelector('.pm-vip');
    if (vipEl) {
      if (active) {
        vipEl.hidden = false;
        const vipTitle = new Date(c.premiumUntil).toLocaleString('th-TH');
        if (vipEl.title !== vipTitle) vipEl.title = vipTitle;
        setText(vipEl, 'Premium · ' + left(c.premiumUntil));
      } else {
        vipEl.hidden = true;
      }
    }

    setText(row.querySelector('.pm-sub'), sub);

    const barEl = row.querySelector('.pm-bar');
    if (barEl) {
      if (c.enabled) {
        barEl.hidden = false;
        const barTitle = `Token ${fmt(c.tokens)} / ${fmt(cost)}${c.target != null ? ' · เป้าตอนนี้ ' + fmt(c.target) : ''}`;
        if (barEl.title !== barTitle) barEl.title = barTitle;
        const fillEl = barEl.querySelector('i');
        if (fillEl && fillEl.style.width !== pct + '%') fillEl.style.width = pct + '%';
        const emEl = barEl.querySelector('em');
        if (emEl) {
          if (tgtPct != null && tgtPct < 100) {
            emEl.hidden = false;
            if (emEl.style.left !== tgtPct + '%') emEl.style.left = tgtPct + '%';
          } else {
            emEl.hidden = true;
          }
        }
        setText(barEl.querySelector('span'), `${fmt(c.tokens)} / ${fmt(cost)} Token`);
      } else {
        barEl.hidden = true;
      }
    }

    const stEl = row.querySelector('.pm-state');
    if (stEl) {
      if (c.enabled) {
        stEl.hidden = false;
        const nextStCls = 'pm-state ' + (c.status || '');
        if (stEl.className !== nextStCls) stEl.className = nextStCls;
        setText(stEl, c.statusText || '');
      } else {
        stEl.hidden = true;
      }
    }

    const lastEl = row.querySelector('.pm-last');
    if (lastEl) {
      if (c.enabled && last) {
        lastEl.hidden = false;
        const nextLastCls = 'pm-last' + (last.ok ? '' : ' bad');
        if (lastEl.className !== nextLastCls) lastEl.className = nextLastCls;
        const tStr = new Date(last.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' · ' + last.text;
        setText(lastEl, tStr);
      } else {
        lastEl.hidden = true;
      }
    }

    const swLbl = row.querySelector('.pm-switch');
    const swTitle = (c.enabled ? 'ปิด' : 'เปิด') + ' Premium อัตโนมัติ';
    if (swLbl && swLbl.title !== swTitle) swLbl.title = swTitle;
    const swInput = row.querySelector('.pm-switch input');
    if (swInput && swInput.checked !== Boolean(c.enabled)) swInput.checked = Boolean(c.enabled);
  }

  function renderList() {
    const body = document.getElementById('pm-body'); if (!body) return;
    let list = data.clients.slice();
    if (filter === 'on') list = list.filter(c => c.enabled);
    if (filter === 'active') list = list.filter(c => c.premiumUntil && c.premiumUntil > Date.now());
    list.sort((a, b) => (b.enabled - a.enabled) || (b.online - a.online) || String(a.name).localeCompare(String(b.name), 'th', { numeric: true }));

    if (!list.length) {
      if (!body.querySelector('.pm-empty')) {
        body.innerHTML = `<div class="pm-empty">ไม่มีจอในหมวดนี้</div>`;
      }
      return;
    }
    const emptyEl = body.querySelector('.pm-empty');
    if (emptyEl) emptyEl.remove();

    const existingRows = new Map();
    Array.from(body.querySelectorAll('.pm-row')).forEach(el => {
      existingRows.set(el.dataset.rowId, el);
    });

    const nextRows = list.map(c => {
      const key = String(c.id);
      let rowEl = existingRows.get(key);
      if (rowEl) {
        patchRowEl(rowEl, c);
        existingRows.delete(key);
      } else {
        rowEl = createRowEl(c);
      }
      return rowEl;
    });

    existingRows.forEach(stale => stale.remove());
    nextRows.forEach((rowEl, idx) => {
      if (body.children[idx] !== rowEl) body.insertBefore(rowEl, body.children[idx] || null);
    });
  }

  function render() {
    const badge = document.getElementById('pm-tab-badge');
    const n = data.clients.filter(c => c.enabled).length;
    if (badge) setText(badge, n ? String(n) : '');
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
