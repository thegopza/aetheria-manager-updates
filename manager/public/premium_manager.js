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
  let openForceId = null;
  let openSellId = null;
  let openSellAll = false;
  let scannedOnOpen = false;

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
        <div><h2>Premium อัตโนมัติ</h2><p>ซื้อ/ขาย Token และปลดล็อค Premium อัตโนมัติ</p></div>
        <button class="pm-sell-all-top-btn" id="pm-sell-all-open" type="button" title="ตั้งขาย Token ของทุกตัวละครในราคาตั้งขายที่ถูกสุด">💰 ขายทุกตัว</button>
        <button class="pm-close" id="pm-close" type="button" aria-label="ปิด">✕</button>
      </header>
      <div class="pm-sell-all-box" id="pm-sell-all-box" hidden>
        <div class="pm-s-head">
          <span>💰 ตั้งขาย Token ทุกตัวละคร (ราคาตั้งขายที่ถูกสุด)</span>
          <button type="button" class="pm-f-close" id="pm-sell-all-close" title="ปิด">✕</button>
        </div>
        <div class="pm-s-presets">
          <button type="button" data-sa-price="ask" class="on">ราคาตั้งขายถูกสุด</button>
          <button type="button" data-sa-price="undercut">ตัดราคา -1 z</button>
          <button type="button" id="pm-sa-scan">🔄 เช็ค Token ทุกจอ</button>
        </div>
        <div class="pm-f-controls">
          <label class="pm-f-input-wrap">
            <span>ราคาตั้งขาย/Token:</span>
            <input type="number" id="pm-sa-price-inp" class="pm-f-qty" min="1" step="1" placeholder="ราคาขายต่ำสุด">
          </label>
          <button type="button" class="pm-s-submit" id="pm-sell-all-exec">💰 ขายทุกตัวทันที</button>
        </div>
        <div class="pm-f-opts">
          <label><input type="checkbox" id="pm-sa-offauto" checked> ปิดสวิตช์ซื้อออโต้ของจอที่สั่งขาย (กันบอทซื้อ Token กลับซ้ำ)</label>
        </div>
        <div class="pm-f-est ok" id="pm-sa-est"></div>
      </div>
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
          <div class="pm-field" id="pm-lead-field"><label for="pm-lead">ซื้อครบก่อนหมด (วัน)</label>
            <input id="pm-lead" data-set="leadDays" inputmode="decimal" value=""></div>
        </div>
        <div class="pm-toggles">
          <label class="pm-opt-toggle on" for="pm-prebuy">
            <div class="pm-opt-txt">
              <b>ซื้อเผื่อไว้รอบถัดไป</b>
              <small>สะสม Token ล่วงหน้าตอนมี VIP</small>
            </div>
            <span class="pm-switch"><input type="checkbox" id="pm-prebuy" data-set="prebuyNextRound" checked><span></span></span>
          </label>
          <label class="pm-opt-toggle on" for="pm-req-gear">
            <div class="pm-opt-txt">
              <b>ซื้อเซ็ตให้ครบก่อน</b>
              <small>รอใส่เซ็ตอุปกรณ์ในแผนครบก่อน</small>
            </div>
            <span class="pm-switch"><input type="checkbox" id="pm-req-gear" data-set="requireGearComplete" checked><span></span></span>
          </label>
        </div>
      </section>
      <nav class="pm-filter" id="pm-filter">
        <button type="button" data-f="all" class="on">ทุกจอ</button>
        <button type="button" data-f="on">เปิดอยู่</button>
        <button type="button" data-f="active">มี Premium</button>
        <button type="button" data-f="inactive">ไม่มี Premium</button>
        <span class="pm-filter-sp"></span>
        <button type="button" class="pm-mini" id="pm-all-on">เปิดทุกจอ</button>
        <button type="button" class="pm-mini" id="pm-all-off">ปิดทุกจอ</button>
      </nav>
      <div class="pm-body" id="pm-body"></div>
      <footer class="pm-foot">
        <span id="pm-gate-hint">เริ่มทำงานเมื่อ Plan Script ผ่านครบทุกเงื่อนไข (เลเวล ใส่เซ็ต เงิน) · จอที่ไม่ได้ใช้แผนเริ่มได้ทันที</span><br>
        ยังไม่มี Premium → ซื้อ Token ราคาขายต่ำสุดจนครบแล้วปลดล็อค · <span id="pm-prebuy-hint">มี Premium แล้ว → ทยอยซื้อให้ครบก่อนหมด</span> <b id="pm-lead-hint"></b>
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
    drawer.querySelector('#pm-body').addEventListener('change', onBodyChange);
    drawer.querySelector('#pm-body').addEventListener('input', onBodyInput);
    drawer.querySelector('#pm-body').addEventListener('click', onBodyClick);
    drawer.querySelector('#pm-settings').addEventListener('change', onSetting);
    drawer.querySelector('#pm-filter').addEventListener('click', e => {
      const b = e.target.closest('[data-f]'); if (!b) return;
      filter = b.dataset.f;
      drawer.querySelectorAll('#pm-filter [data-f]').forEach(x => x.classList.toggle('on', x === b));
      renderList();
    });
    drawer.querySelector('#pm-all-on').addEventListener('click', () => toggle('*', true));
    drawer.querySelector('#pm-all-off').addEventListener('click', () => toggle('*', false));
    drawer.querySelector('#pm-sell-all-open').addEventListener('click', () => {
      openSellAll = !openSellAll;
      const box = document.getElementById('pm-sell-all-box');
      if (box) {
        box.hidden = !openSellAll;
        if (openSellAll) {
          const inp = document.getElementById('pm-sa-price-inp');
          const bestAsk = (data.market && data.market.bestAsk) || 0;
          if (inp && (!inp.value || Number(inp.value) <= 0) && bestAsk > 0) inp.value = String(bestAsk);
          updateSellAllEstimate();
          const hasUnscanned = data.clients.some(c => c.hasPort && c.tokens == null);
          if (hasUnscanned && !busy) {
            api('/scan', {}).catch(() => {});
          }
        }
      }
      const btn = document.getElementById('pm-sell-all-open');
      if (btn) btn.classList.toggle('active', openSellAll);
    });
    drawer.querySelector('#pm-sell-all-close').addEventListener('click', () => {
      openSellAll = false;
      const box = document.getElementById('pm-sell-all-box');
      if (box) box.hidden = true;
      const btn = document.getElementById('pm-sell-all-open');
      if (btn) btn.classList.remove('active');
    });
    drawer.querySelector('#pm-sell-all-box').addEventListener('click', onSellAllBoxClick);
    drawer.querySelector('#pm-sa-price-inp').addEventListener('input', updateSellAllEstimate);
  }

  function setOpen(v) {
    open = v;
    if (v) document.body.classList.remove('pt-open', 'gd-open');
    document.body.classList.toggle('pm-open', v);
    clearInterval(pollTimer);
    if (v) {
      load();
      if (!scannedOnOpen) {
        scannedOnOpen = true;
        api('/scan', {}).catch(() => {});
      }
      pollTimer = setInterval(load, 5000);
    } else {
      pollTimer = setInterval(load, 60000);
    }
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

  function getSelectedPlanCost() {
    const s = data.settings || {}, m = data.market;
    const plans = (m && m.plans && m.plans.length) ? m.plans : [{ id: '7d', days: 7, tokens: 1000 }, { id: '30d', days: 30, tokens: 3500 }, { id: '90d', days: 90, tokens: 8000 }];
    const cur = plans.find(p => p.id === s.planId) || plans[0];
    return cur ? cur.tokens : 1000;
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

    const prebuyOn = s.prebuyNextRound !== false;
    const prebuyChk = document.getElementById('pm-prebuy');
    if (prebuyChk && prebuyChk.checked !== prebuyOn) prebuyChk.checked = prebuyOn;
    const prebuyCard = prebuyChk && prebuyChk.closest('.pm-opt-toggle');
    if (prebuyCard) prebuyCard.classList.toggle('on', prebuyOn);

    const reqGearOn = s.requireGearComplete !== false;
    const reqGearChk = document.getElementById('pm-req-gear');
    if (reqGearChk && reqGearChk.checked !== reqGearOn) reqGearChk.checked = reqGearOn;
    const reqGearCard = reqGearChk && reqGearChk.closest('.pm-opt-toggle');
    if (reqGearCard) reqGearCard.classList.toggle('on', reqGearOn);

    const leadField = document.getElementById('pm-lead-field');
    if (leadField) leadField.classList.toggle('disabled', !prebuyOn);
    if (leadInp) leadInp.disabled = !prebuyOn;

    const gateHint = document.getElementById('pm-gate-hint');
    if (gateHint) {
      setText(
        gateHint,
        reqGearOn
          ? 'เริ่มทำงานเมื่อ Plan Script ผ่านครบทุกเงื่อนไข (เลเวล ใส่เซ็ต เงิน) · จอที่ไม่ได้ใช้แผนเริ่มได้ทันที'
          : 'เริ่มทำงานเมื่อผ่านเงื่อนไขเลเวล/เงินในแผน (ไม่ต้องรอซื้อเซ็ตครบ) · จอที่ไม่ได้ใช้แผนเริ่มได้ทันที'
      );
    }

    const prebuyHint = document.getElementById('pm-prebuy-hint');
    if (prebuyHint) {
      setText(
        prebuyHint,
        prebuyOn ? 'มี Premium แล้ว → ทยอยซื้อให้ครบก่อนหมด' : 'มี Premium แล้ว → หยุดซื้อเผื่อรอบถัดไป'
      );
    }

    const hint = document.getElementById('pm-lead-hint');
    if (hint) {
      setText(
        hint,
        prebuyOn
          ? (cur ? `(${cur.days} วัน → ครบใน ${Math.max(0.25, cur.days - (Number(s.leadDays) || 0))} วัน)` : '')
          : '(รอหมดอายุก่อนค่อยซื้อรอบใหม่)'
      );
    }

    // Update counts on filter buttons
    const allCount = data.clients.length;
    const onCount = data.clients.filter(c => c.enabled).length;
    const vipCount = data.clients.filter(c => c.premiumUntil && c.premiumUntil > Date.now()).length;
    const noVipCount = allCount - vipCount;
    const filterEl = document.getElementById('pm-filter');
    if (filterEl) {
      setText(filterEl.querySelector('[data-f="all"]'), `ทุกจอ (${allCount})`);
      setText(filterEl.querySelector('[data-f="on"]'), `เปิดอยู่ (${onCount})`);
      setText(filterEl.querySelector('[data-f="active"]'), `มี VIP (${vipCount})`);
      setText(filterEl.querySelector('[data-f="inactive"]'), `ไม่มี VIP (${noVipCount})`);
    }
  }

  function updateForceEstimate(row, c) {
    const box = row.querySelector('.pm-force-box');
    if (!box || box.hidden) return;
    const cost = c.cost || getSelectedPlanCost();
    const curTokens = Number(c.tokens) || 0;
    const needForPlan = Math.max(0, cost - curTokens);
    const qtyInp = box.querySelector('.pm-f-qty');
    const noResChk = box.querySelector('.pm-f-nores');
    const actChk = box.querySelector('.pm-f-act');
    const estEl = box.querySelector('.pm-f-est');
    const needBtn = box.querySelector('[data-f-preset="need"]');
    if (needBtn) setText(needBtn, needForPlan > 0 ? `ครบแพ็ก (+${fmt(needForPlan)})` : `ครบแพ็ก (${fmt(cost)})`);

    const wantQty = Math.max(0, Math.floor(Number(qtyInp && qtyInp.value) || 0));
    const noRes = Boolean(noResChk && noResChk.checked);
    const autoAct = Boolean(actChk && actChk.checked);
    const bestAsk = (data.market && data.market.bestAsk) || 25000;
    const reserve = noRes ? 0 : Math.max(0, Number(data.settings && data.settings.reserveZeny) || 0);
    const usableZeny = c.zeny != null ? Math.max(0, c.zeny - reserve) : null;
    const maxAff = noRes ? c.maxBuyAllZeny : c.maxBuyWithReserve;
    const maxQty = maxAff ? maxAff.qty : (usableZeny != null && bestAsk > 0 ? Math.floor(usableZeny / bestAsk) : null);

    if (!estEl) return;
    if (!c.hasPort && !c.online) {
      estEl.className = 'pm-f-est warn';
      setText(estEl, '⚠️ จอนี้ยังไม่ได้เปิดเกม (ต้องออนไลน์ก่อนจึงจะสั่งซื้อได้)');
      return;
    }
    if (wantQty === 0 && curTokens >= cost && autoAct) {
      estEl.className = 'pm-f-est ok';
      setText(estEl, `✅ มี ${fmt(curTokens)} Token ครบแล้ว → กดยืนยันเพื่อปลดล็อค/ต่อ Premium ทันที`);
      return;
    }
    if (maxQty != null && maxQty <= 0) {
      const altAll = !noRes && c.maxBuyAllZeny && c.maxBuyAllZeny.qty > 0
        ? ` (หากติ๊ก "ไม่กันเงินสำรอง" จะซื้อได้ ${fmt(c.maxBuyAllZeny.qty)} Token)`
        : '';
      estEl.className = 'pm-f-est warn';
      setText(estEl, `⚠️ เงินที่ใช้ได้ (${fmt(usableZeny)} z) ไม่พอซื้อแม้แต่ 1 Token${altAll}`);
      return;
    }
    if (maxQty != null && wantQty > maxQty) {
      const estCost = maxAff ? maxAff.zeny : maxQty * bestAsk;
      estEl.className = 'pm-f-est partial';
      setText(estEl, `💡 สั่ง ${fmt(wantQty)} Token แต่เงินพอซื้อได้ ${fmt(maxQty)} Token (~${fmt(estCost)} z) → ระบบจะซื้อเท่าที่เงินพอ`);
      return;
    }
    const estCost = wantQty * bestAsk;
    estEl.className = 'pm-f-est ok';
    setText(estEl, `✅ ซื้อ ${fmt(wantQty)} Token (ใช้เงินประมาณ ~${fmt(estCost)} z${usableZeny != null ? ` · เงินใช้ได้ ${fmt(usableZeny)} z` : ''})`);
  }

  function updateSellEstimate(row, c) {
    const box = row.querySelector('.pm-sell-box');
    if (!box || box.hidden) return;
    const curTokens = Math.max(0, Math.floor(Number(c.tokens) || 0));
    const bestAsk = (data.market && Number(data.market.bestAsk)) || 0;
    const bestBid = (data.market && Number(data.market.bestBid)) || 0;
    const feePct = (data.market && Number(data.market.feePercent)) || 2;
    const qtyInp = box.querySelector('.pm-s-qty');
    const priceInp = box.querySelector('.pm-s-price');
    const estEl = box.querySelector('.pm-s-est');
    const allBtn = box.querySelector('[data-s-preset="all"]');
    const askBtn = box.querySelector('[data-s-price="ask"]');
    if (allBtn) setText(allBtn, `ทั้งหมด (${fmt(curTokens)})`);
    if (askBtn) setText(askBtn, bestAsk > 0 ? `ราคาขายถูกสุด (${fmt(bestAsk)})` : 'ราคาขายถูกสุด');

    const wantQty = Math.max(0, Math.floor(Number(qtyInp && qtyInp.value) || curTokens));
    const sellQty = curTokens > 0 ? Math.min(curTokens, wantQty || curTokens) : wantQty;
    const sellPrice = Math.max(0, Math.floor(Number(priceInp && priceInp.value) || bestAsk));

    if (!estEl) return;
    if (!c.hasPort && !c.online) {
      estEl.className = 'pm-s-est pm-f-est warn';
      setText(estEl, '⚠️ จอนี้ยังไม่ได้เปิดเกม (ต้องออนไลน์ก่อนจึงจะสั่งขายได้)');
      return;
    }
    if (curTokens <= 0) {
      const pendingOrders = Array.isArray(c.askOrders) ? c.askOrders : [];
      if (pendingOrders.length > 0) {
        const rem = pendingOrders.reduce((s, o) => s + (Number(o.remaining) || Number(o.qty) || 0), 0);
        const pr = pendingOrders[0].price || bestAsk;
        estEl.className = 'pm-s-est pm-f-est partial';
        setText(estEl, `⏳ กำลังตั้งขายอยู่ในตลาด ${fmt(rem)} Token @ ${fmt(pr)} z/Token (รอผู้เล่นซื้อ · เมื่อขายได้จะรับเงินเข้าตัวอัตโนมัติ)`);
      } else {
        estEl.className = 'pm-s-est pm-f-est warn';
        setText(estEl, '⚠️ ตัวละครนี้ไม่มี Token ให้ขาย (0 Token)');
      }
      return;
    }
    if (sellPrice <= 0) {
      estEl.className = 'pm-s-est pm-f-est warn';
      setText(estEl, '⚠️ ยังไม่ทราบราคาตั้งขายต่ำสุดในตลาด กรุณาระบุราคา');
      return;
    }
    const gross = sellQty * sellPrice;
    const fee = Math.ceil(gross * feePct / 100);
    const net = Math.max(0, gross - fee);
    const diffVsBid = bestBid > 0 && sellPrice > bestBid ? ` · ได้มากกว่าขายให้คนรับซื้อ +${fmt((sellPrice - bestBid) * sellQty)} z` : '';
    estEl.className = 'pm-s-est pm-f-est ok';
    setText(estEl, `✅ ตั้งขาย ${fmt(sellQty)} Token @ ${fmt(sellPrice)} z/Token → รับสุทธิ ~${fmt(net)} z (หักค่าธรรมเนียม ${feePct}%${diffVsBid})`);
  }

  function updateSellAllEstimate() {
    const box = document.getElementById('pm-sell-all-box');
    const estEl = document.getElementById('pm-sa-est');
    if (!box || box.hidden || !estEl) return;
    const bestAsk = (data.market && Number(data.market.bestAsk)) || 0;
    const bestBid = (data.market && Number(data.market.bestBid)) || 0;
    const feePct = (data.market && Number(data.market.feePercent)) || 2;
    const askBtn = box.querySelector('[data-sa-price="ask"]');
    const underBtn = box.querySelector('[data-sa-price="undercut"]');
    if (askBtn) setText(askBtn, bestAsk > 0 ? `ราคาตั้งขายถูกสุด (${fmt(bestAsk)} z)` : 'ราคาตั้งขายถูกสุด');
    if (underBtn) setText(underBtn, bestAsk > 1 ? `ตัดราคา -1 z (${fmt(bestAsk - 1)} z)` : 'ตัดราคา -1 z');

    const inp = document.getElementById('pm-sa-price-inp');
    const sellPrice = Math.max(0, Math.floor(Number(inp && inp.value) || bestAsk));
    const onlineClients = data.clients.filter(c => c.hasPort || c.online);
    const withTokens = onlineClients.filter(c => (Number(c.tokens) || 0) > 0);
    const totalTokens = withTokens.reduce((s, c) => s + (Number(c.tokens) || 0), 0);
    const unscanned = onlineClients.filter(c => c.tokens == null).length;

    if (!onlineClients.length) {
      estEl.className = 'pm-f-est warn';
      setText(estEl, '⚠️ ไม่มีหน้าจอที่ออนไลน์อยู่ในขณะนี้');
      return;
    }
    if (totalTokens <= 0) {
      estEl.className = 'pm-f-est ' + (unscanned > 0 ? 'partial' : 'warn');
      setText(
        estEl,
        unscanned > 0
          ? `⏳ กำลังอ่านจำนวน Token จาก ${unscanned} จอที่ออนไลน์... (หรือกดปุ่ม "ขายทุกตัวทันที" เพื่อให้ระบบเช็กและตั้งขายทุกจอที่มี Token ทันที)`
          : '⚠️ ไม่มีตัวละครที่ออนไลน์อยู่ที่มี Token คงเหลือให้ขาย (0 Token ทุกจอ)'
      );
      return;
    }
    const gross = totalTokens * sellPrice;
    const fee = Math.ceil(gross * feePct / 100);
    const net = Math.max(0, gross - fee);
    const diffBid = bestBid > 0 && sellPrice > bestBid ? ` · ได้มากกว่าขายราคาคนรับซื้อ +${fmt((sellPrice - bestBid) * totalTokens)} z` : '';
    estEl.className = 'pm-f-est ok';
    setText(
      estEl,
      `✅ พบ ${withTokens.length} ตัวละครที่มี Token · รวมทั้งหมด ${fmt(totalTokens)} Token @ ${fmt(sellPrice)} z/Token → รับเงินรวมสุทธิ ~${fmt(net)} z (หักภาษี ${feePct}%${diffBid})`
    );
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
        <div class="pm-ask-badge" hidden></div>
        <div class="pm-last" hidden></div>
        <div class="pm-force-box" hidden>
          <div class="pm-f-head">
            <span>⚡ บังคับซื้อ Token ทันที (ถ้าเงินไม่พอจะซื้อเท่าที่พอ)</span>
            <button type="button" class="pm-f-close" data-force-close="${esc(c.id)}" title="ปิด">✕</button>
          </div>
          <div class="pm-f-presets">
            <button type="button" data-f-preset="need" data-row-id="${esc(c.id)}">ครบแพ็ก</button>
            <button type="button" data-f-preset="100" data-row-id="${esc(c.id)}">+100</button>
            <button type="button" data-f-preset="500" data-row-id="${esc(c.id)}">+500</button>
            <button type="button" data-f-preset="1000" data-row-id="${esc(c.id)}">1,000</button>
            <button type="button" data-f-preset="max" data-row-id="${esc(c.id)}">เท่าที่เงินพอ</button>
          </div>
          <div class="pm-f-controls">
            <label class="pm-f-input-wrap">
              <span>จำนวนเหรียญ:</span>
              <input type="number" class="pm-f-qty" min="0" max="100000" step="1" value="1000">
            </label>
            <button type="button" class="pm-f-submit" data-force-exec="${esc(c.id)}">🛒 ซื้อทันที</button>
          </div>
          <div class="pm-f-opts">
            <label><input type="checkbox" class="pm-f-nores"> ไม่กันเงินสำรอง (ใช้เงินทั้งหมด)</label>
            <label><input type="checkbox" class="pm-f-act" checked> ปลดล็อค/ต่อ VIP ทันทีเมื่อครบ</label>
          </div>
          <div class="pm-f-est"></div>
        </div>
        <div class="pm-sell-box" hidden>
          <div class="pm-s-head">
            <span>💰 ตั้งขาย Token (ราคาตั้งขายที่ถูกสุด ไม่ขายราคาคนรับซื้อ)</span>
            <button type="button" class="pm-f-close" data-sell-close="${esc(c.id)}" title="ปิด">✕</button>
          </div>
          <div class="pm-s-presets">
            <button type="button" data-s-preset="all" data-row-id="${esc(c.id)}">ทั้งหมด</button>
            <button type="button" data-s-preset="100" data-row-id="${esc(c.id)}">100</button>
            <button type="button" data-s-preset="500" data-row-id="${esc(c.id)}">500</button>
            <button type="button" data-s-preset="1000" data-row-id="${esc(c.id)}">1,000</button>
            <button type="button" data-s-price="ask" data-row-id="${esc(c.id)}">ราคาขายถูกสุด</button>
            <button type="button" data-s-price="undercut" data-row-id="${esc(c.id)}">ตัดราคา -1z</button>
          </div>
          <div class="pm-f-controls">
            <label class="pm-f-input-wrap">
              <span>จำนวน:</span>
              <input type="number" class="pm-s-qty pm-f-qty" min="1" max="100000" step="1" value="1000">
            </label>
            <label class="pm-f-input-wrap">
              <span>ราคา/Token:</span>
              <input type="number" class="pm-s-price pm-f-qty" min="1" step="1" value="">
            </label>
            <button type="button" class="pm-s-submit" data-sell-exec="${esc(c.id)}">💰 ตั้งขาย</button>
          </div>
          <div class="pm-f-opts">
            <label><input type="checkbox" class="pm-s-offauto" checked> ปิดสวิตช์ซื้อออโต้ของจอนี้ (กันซื้อ Token กลับซ้ำ)</label>
          </div>
          <div class="pm-s-est pm-f-est"></div>
        </div>
      </div>
      <div class="pm-side-actions">
        <label class="pm-switch"><input type="checkbox" data-id="${esc(c.id)}"><span></span></label>
        <button type="button" class="pm-force-btn" data-force-toggle="${esc(c.id)}" title="บังคับซื้อ Token / Premium ทันที">⚡ ซื้อ</button>
        <button type="button" class="pm-sell-btn" data-sell-toggle="${esc(c.id)}" title="ตั้งขาย Token ในราคาตั้งขายที่ถูกสุด">💰 ขาย</button>
      </div>`;
    patchRowEl(row, c);
    return row;
  }

  function patchRowEl(row, c) {
    const cost = c.cost || getSelectedPlanCost();
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
        vipEl.className = 'pm-vip';
        const vipTitle = new Date(c.premiumUntil).toLocaleString('th-TH');
        if (vipEl.title !== vipTitle) vipEl.title = vipTitle;
        setText(vipEl, 'Premium · ' + left(c.premiumUntil));
      } else {
        vipEl.hidden = false;
        vipEl.className = 'pm-vip no-vip';
        vipEl.title = 'ตัวละครนี้ยังไม่มีสถานะ Premium';
        setText(vipEl, 'ไม่มี Premium');
      }
    }

    setText(row.querySelector('.pm-sub'), sub);

    const barEl = row.querySelector('.pm-bar');
    if (barEl) {
      if (c.enabled || c.tokens != null) {
        barEl.hidden = false;
        const barTitle = `Token ${fmt(c.tokens)} / ${fmt(cost)}${c.target != null ? ' · เป้าตอนนี้ ' + fmt(c.target) : ''}`;
        if (barEl.title !== barTitle) barEl.title = barTitle;
        const fillEl = barEl.querySelector('i');
        if (fillEl && fillEl.style.width !== pct + '%') fillEl.style.width = pct + '%';
        const emEl = barEl.querySelector('em');
        if (emEl) {
          if (tgtPct != null && tgtPct > 0 && tgtPct < 100) {
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

    const askBadgeEl = row.querySelector('.pm-ask-badge');
    if (askBadgeEl) {
      const askOrders = Array.isArray(c.askOrders) ? c.askOrders : [];
      if (askOrders.length > 0) {
        const rem = askOrders.reduce((s, o) => s + (Number(o.remaining) || Number(o.qty) || 0), 0);
        const pr = askOrders[0].price || (data.market && data.market.bestAsk) || 0;
        askBadgeEl.hidden = false;
        setText(askBadgeEl, `⏳ กำลังตั้งขาย ${fmt(rem)} Token @ ${fmt(pr)} z`);
      } else {
        askBadgeEl.hidden = true;
      }
    }

    const lastEl = row.querySelector('.pm-last');
    if (lastEl) {
      if ((c.enabled || last) && last) {
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

    const forceBtn = row.querySelector('.pm-force-btn');
    const isForceOpen = String(openForceId) === String(c.id);
    if (forceBtn) forceBtn.classList.toggle('active', isForceOpen);
    const forceBox = row.querySelector('.pm-force-box');
    if (forceBox) {
      const wasHidden = forceBox.hidden;
      forceBox.hidden = !isForceOpen;
      if (isForceOpen && wasHidden) {
        const curTokens = Number(c.tokens) || 0;
        const need = Math.max(0, cost - curTokens);
        const qtyInp = forceBox.querySelector('.pm-f-qty');
        if (qtyInp) qtyInp.value = String(need > 0 ? need : cost);
        const noResChk = forceBox.querySelector('.pm-f-nores');
        if (noResChk && c.maxBuyWithReserve && c.maxBuyWithReserve.qty === 0 && c.maxBuyAllZeny && c.maxBuyAllZeny.qty > 0) {
          noResChk.checked = true;
        }
      }
      if (isForceOpen) updateForceEstimate(row, c);
    }

    const sellBtn = row.querySelector('.pm-sell-btn');
    const isSellOpen = String(openSellId) === String(c.id);
    if (sellBtn) sellBtn.classList.toggle('active', isSellOpen);
    const sellBox = row.querySelector('.pm-sell-box');
    if (sellBox) {
      const wasSellHidden = sellBox.hidden;
      sellBox.hidden = !isSellOpen;
      if (isSellOpen && wasSellHidden) {
        const curTokens = Math.max(0, Math.floor(Number(c.tokens) || 0));
        const bestAsk = (data.market && Number(data.market.bestAsk)) || 0;
        const sQtyInp = sellBox.querySelector('.pm-s-qty');
        const sPriceInp = sellBox.querySelector('.pm-s-price');
        if (sQtyInp) sQtyInp.value = String(curTokens > 0 ? curTokens : 100);
        if (sPriceInp && bestAsk > 0) sPriceInp.value = String(bestAsk);
      }
      if (isSellOpen) updateSellEstimate(row, c);
    }
  }

  function renderList() {
    const body = document.getElementById('pm-body'); if (!body) return;
    let list = data.clients.slice();
    if (filter === 'on') list = list.filter(c => c.enabled);
    if (filter === 'active') list = list.filter(c => c.premiumUntil && c.premiumUntil > Date.now());
    if (filter === 'inactive') list = list.filter(c => !(c.premiumUntil && c.premiumUntil > Date.now()));
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
    if (openSellAll) updateSellAllEstimate();
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

  function onBodyChange(e) {
    const t = e.target;
    if (t.dataset.id) {
      toggle(t.dataset.id, t.checked);
      return;
    }
    const row = t.closest('.pm-row');
    if (row) {
      const c = data.clients.find(x => String(x.id) === String(row.dataset.rowId));
      if (c) {
        updateForceEstimate(row, c);
        updateSellEstimate(row, c);
      }
    }
  }

  function onBodyInput(e) {
    const row = e.target.closest('.pm-row');
    if (!row) return;
    const c = data.clients.find(x => String(x.id) === String(row.dataset.rowId));
    if (c) {
      updateForceEstimate(row, c);
      updateSellEstimate(row, c);
    }
  }

  async function onSellAllBoxClick(e) {
    const priceBtn = e.target.closest('[data-sa-price]');
    if (priceBtn) {
      const bestAsk = (data.market && Number(data.market.bestAsk)) || 0;
      const inp = document.getElementById('pm-sa-price-inp');
      const kind = priceBtn.dataset.saPrice;
      document.querySelectorAll('#pm-sell-all-box [data-sa-price]').forEach(b => b.classList.toggle('on', b === priceBtn));
      if (inp && bestAsk > 0) {
        inp.value = String(kind === 'undercut' ? Math.max(1, bestAsk - 1) : bestAsk);
      }
      updateSellAllEstimate();
      return;
    }
    const scanBtn = e.target.closest('#pm-sa-scan');
    if (scanBtn) {
      if (busy) return;
      busy = true;
      scanBtn.disabled = true;
      const oldTxt = scanBtn.textContent;
      scanBtn.textContent = '⏳ กำลังเช็ค...';
      try {
        await api('/scan', {});
        toast('อัปเดตจำนวน Token ทุกจอเรียบร้อย', 'success');
      } finally {
        busy = false;
        scanBtn.disabled = false;
        scanBtn.textContent = oldTxt;
      }
      return;
    }
    const execBtn = e.target.closest('#pm-sell-all-exec');
    if (execBtn) {
      if (busy) return;
      const inp = document.getElementById('pm-sa-price-inp');
      const offChk = document.getElementById('pm-sa-offauto');
      const bestAsk = (data.market && Number(data.market.bestAsk)) || 0;
      const price = Math.max(0, Math.floor(Number(inp && inp.value) || bestAsk));
      const disableAuto = Boolean(offChk ? offChk.checked : true);
      if (!confirm(`ยืนยันตั้งขาย Token ของทุกตัวละครที่ออนไลน์ (ในราคา ${price > 0 ? fmt(price) + ' z/Token' : 'ตั้งขายที่ถูกสุดในตลาด'})?`)) return;
      busy = true;
      execBtn.disabled = true;
      const oldTxt = execBtn.textContent;
      execBtn.textContent = '⏳ กำลังตั้งขายทุกตัว...';
      try {
        const r = await api('/force-sell-all', { price, disableAuto });
        if (r.success === false) {
          toast(r.error || 'ตั้งขายทุกตัวไม่สำเร็จ', 'error');
        } else {
          toast((r.sellAllResult && r.sellAllResult.message) || 'ตั้งขายทุกตัวสำเร็จ', 'success');
          openSellAll = false;
          const box = document.getElementById('pm-sell-all-box');
          if (box) box.hidden = true;
          const btn = document.getElementById('pm-sell-all-open');
          if (btn) btn.classList.remove('active');
          render();
        }
      } finally {
        busy = false;
        execBtn.disabled = false;
        execBtn.textContent = oldTxt;
      }
    }
  }

  async function onBodyClick(e) {
    const toggleBtn = e.target.closest('[data-force-toggle]');
    if (toggleBtn) {
      const id = String(toggleBtn.dataset.forceToggle);
      openForceId = String(openForceId) === id ? null : id;
      if (openForceId) openSellId = null;
      renderList();
      return;
    }
    const closeBtn = e.target.closest('[data-force-close]');
    if (closeBtn) {
      openForceId = null;
      renderList();
      return;
    }
    const sellToggleBtn = e.target.closest('[data-sell-toggle]');
    if (sellToggleBtn) {
      const id = String(sellToggleBtn.dataset.sellToggle);
      openSellId = String(openSellId) === id ? null : id;
      if (openSellId) openForceId = null;
      renderList();
      return;
    }
    const sellCloseBtn = e.target.closest('[data-sell-close]');
    if (sellCloseBtn) {
      openSellId = null;
      renderList();
      return;
    }
    const sellPresetBtn = e.target.closest('[data-s-preset]');
    if (sellPresetBtn) {
      const row = sellPresetBtn.closest('.pm-row');
      const c = row && data.clients.find(x => String(x.id) === String(row.dataset.rowId));
      if (!row || !c) return;
      const curTokens = Math.max(0, Math.floor(Number(c.tokens) || 0));
      const qtyInp = row.querySelector('.pm-s-qty');
      const kind = sellPresetBtn.dataset.sPreset;
      if (qtyInp) {
        if (kind === 'all') qtyInp.value = String(curTokens > 0 ? curTokens : 100);
        else qtyInp.value = String(curTokens > 0 ? Math.min(curTokens, Number(kind) || curTokens) : (Number(kind) || 100));
      }
      updateSellEstimate(row, c);
      return;
    }
    const sellPriceBtn = e.target.closest('[data-s-price]');
    if (sellPriceBtn) {
      const row = sellPriceBtn.closest('.pm-row');
      const c = row && data.clients.find(x => String(x.id) === String(row.dataset.rowId));
      if (!row || !c) return;
      const bestAsk = (data.market && Number(data.market.bestAsk)) || 0;
      const priceInp = row.querySelector('.pm-s-price');
      const kind = sellPriceBtn.dataset.sPrice;
      if (priceInp && bestAsk > 0) {
        priceInp.value = String(kind === 'undercut' ? Math.max(1, bestAsk - 1) : bestAsk);
      }
      updateSellEstimate(row, c);
      return;
    }
    const sellExecBtn = e.target.closest('[data-sell-exec]');
    if (sellExecBtn) {
      const id = String(sellExecBtn.dataset.sellExec);
      const row = sellExecBtn.closest('.pm-row');
      if (!row || busy) return;
      const qtyInp = row.querySelector('.pm-s-qty');
      const priceInp = row.querySelector('.pm-s-price');
      const offChk = row.querySelector('.pm-s-offauto');
      const qty = Math.max(0, Math.floor(Number(qtyInp && qtyInp.value) || 0));
      const price = Math.max(0, Math.floor(Number(priceInp && priceInp.value) || 0));
      const disableAuto = Boolean(offChk ? offChk.checked : true);
      busy = true;
      sellExecBtn.disabled = true;
      const oldTxt = sellExecBtn.textContent;
      sellExecBtn.textContent = '⏳ กำลังขาย...';
      try {
        const r = await api('/force-sell', { profileId: id, qty, price, disableAuto });
        if (r.success === false) {
          toast(r.error || 'ตั้งขายไม่สำเร็จ', 'error');
        } else {
          toast((r.sellResult && r.sellResult.message) || 'ตั้งขายสำเร็จ', 'success');
          openSellId = null;
          render();
        }
      } finally {
        busy = false;
        sellExecBtn.disabled = false;
        sellExecBtn.textContent = oldTxt;
      }
      return;
    }
    const presetBtn = e.target.closest('[data-f-preset]');
    if (presetBtn) {
      const row = presetBtn.closest('.pm-row');
      const c = row && data.clients.find(x => String(x.id) === String(row.dataset.rowId));
      if (!row || !c) return;
      const cost = c.cost || getSelectedPlanCost();
      const curTokens = Number(c.tokens) || 0;
      const need = Math.max(0, cost - curTokens);
      const qtyInp = row.querySelector('.pm-f-qty');
      const noResChk = row.querySelector('.pm-f-nores');
      const kind = presetBtn.dataset.fPreset;
      if (qtyInp) {
        if (kind === 'need') qtyInp.value = String(need > 0 ? need : cost);
        else if (kind === 'max') {
          const noRes = Boolean(noResChk && noResChk.checked);
          const maxAff = noRes ? c.maxBuyAllZeny : c.maxBuyWithReserve;
          qtyInp.value = String(maxAff && maxAff.qty > 0 ? maxAff.qty : cost);
        } else {
          qtyInp.value = String(Number(kind) || cost);
        }
      }
      updateForceEstimate(row, c);
      return;
    }
    const execBtn = e.target.closest('[data-force-exec]');
    if (execBtn) {
      const id = String(execBtn.dataset.forceExec);
      const row = execBtn.closest('.pm-row');
      if (!row || busy) return;
      const qtyInp = row.querySelector('.pm-f-qty');
      const noResChk = row.querySelector('.pm-f-nores');
      const actChk = row.querySelector('.pm-f-act');
      const qty = Math.max(0, Math.floor(Number(qtyInp && qtyInp.value) || 0));
      const ignoreReserve = Boolean(noResChk && noResChk.checked);
      const autoActivate = Boolean(actChk ? actChk.checked : true);
      busy = true;
      execBtn.disabled = true;
      const oldTxt = execBtn.textContent;
      execBtn.textContent = '⏳ กำลังซื้อ...';
      try {
        const r = await api('/force-buy', { profileId: id, qty, ignoreReserve, autoActivate });
        if (r.success === false) {
          toast(r.error || 'บังคับซื้อไม่สำเร็จ', 'error');
        } else {
          toast((r.forceResult && r.forceResult.message) || 'บังคับซื้อสำเร็จ', 'success');
          openForceId = null;
          render();
        }
      } finally {
        busy = false;
        execBtn.disabled = false;
        execBtn.textContent = oldTxt;
      }
    }
  }

  async function onSetting(e) {
    const t = e.target; if (!t.dataset.set) return;
    let v = t.type === 'checkbox' ? Boolean(t.checked) : t.value;
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
