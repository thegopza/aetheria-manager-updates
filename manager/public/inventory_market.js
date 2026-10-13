// manager/public/inventory_market.js — Bag panel (next to the character window) + floating market window.
// Depends on app.js globals: API_BASE, escapeHTML, gameAssetUrl, getRarityColor, formatItemDisplayName,
// renderItemStatGroups, getItemStatLabel, loadCharacterDetail, currentCharProfileId.
(function () {
  'use strict';

  // ==========================================================================
  // OPTION QUERY: "dex, matk>=5, melee dmg, atk%" -> random-option terms (affixes only)
  // ==========================================================================
  // Stats that are percentages even in "base" mode (mirrors the game's own formatter)
  const PERCENT_TYPES = new Set(['MOVE_SPEED', 'CRIT_DAMAGE', 'MELEE_DAMAGE_PERCENT', 'RANGED_DAMAGE_PERCENT',
    'MAGIC_DAMAGE_PERCENT', 'DAMAGE_REDUCTION', 'BLOCK_CHANCE', 'HEAL_POWER']);

  const OPTION_ALIASES = {
    ATK: ['atk', 'attack', 'พลังโจมตี'],
    MATK: ['matk', 'magic atk', 'magic attack', 'พลังเวท'],
    DEF: ['def', 'defense', 'ป้องกัน'],
    MDEF: ['mdef', 'magic def', 'ป้องกันเวท'],
    HIT: ['hit', 'แม่นยำ'],
    FLEE: ['flee', 'หลบ', 'หลบหลีก'],
    CRIT: ['crit', 'cri', 'critical', 'คริ'],
    ASPD: ['aspd', 'atk spd', 'attack speed', 'ความเร็วโจมตี'],
    MAXHP: ['hp', 'max hp', 'maxhp'],
    MAXSP: ['sp', 'max sp', 'maxsp'],
    MOVE_SPEED: ['move', 'move speed', 'speed', 'ms', 'ความเร็วเดิน', 'เดินเร็ว'],
    CRIT_DAMAGE: ['crit dmg', 'crit damage', 'cd', 'ดาเมจคริ'],
    MELEE_DAMAGE_PERCENT: ['melee dmg', 'melee damage', 'melee', 'ดาเมจประชิด', 'ดาเมจระยะประชิด', 'ประชิด'],
    RANGED_DAMAGE_PERCENT: ['ranged dmg', 'range dmg', 'ranged damage', 'ranged', 'range', 'ดาเมจไกล', 'ดาเมจระยะไกล', 'ระยะไกล'],
    MAGIC_DAMAGE_PERCENT: ['magic dmg', 'magic damage', 'magic', 'ดาเมจเวท'],
    DAMAGE_REDUCTION: ['dmg reduction', 'damage reduction', 'reduction', 'reduce', 'dr', 'ลดดาเมจ', 'ลดดาเมจที่ได้รับ'],
    BLOCK_CHANCE: ['block', 'block chance', 'บล็อก', 'โอกาสบล็อก'],
    HEAL_POWER: ['heal', 'heal power', 'ฮีล', 'พลังฮีล'],
    IGNORE_SIZE: ['ignore size', 'ignoresize', 'size'],
    STR: ['str'], AGI: ['agi'], VIT: ['vit'], INT: ['int'], DEX: ['dex'], LUK: ['luk', 'luck']
  };

  const norm = s => String(s || '').toLowerCase().replace(/[\s_\-.%]+/g, '');
  const ALIAS_INDEX = [];
  Object.entries(OPTION_ALIASES).forEach(([type, list]) => {
    [type, ...list].forEach(a => ALIAS_INDEX.push({ alias: norm(a), type }));
  });

  function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return dp[a.length][b.length];
  }

  function resolveOptionType(text) {
    const n = norm(text);
    if (!n) return null;
    const exact = ALIAS_INDEX.find(a => a.alias === n);
    if (exact) return exact.type;
    if (n.length >= 3) {
      const prefixTypes = new Set(ALIAS_INDEX.filter(a => a.alias.startsWith(n)).map(a => a.type));
      if (prefixTypes.size === 1) return [...prefixTypes][0];
    }
    if (n.length >= 4) {
      const maxDist = n.length >= 7 ? 2 : 1;
      let best = null, bestDist = Infinity, tie = false;
      ALIAS_INDEX.forEach(a => {
        if (Math.abs(a.alias.length - n.length) > maxDist) return;
        const d = levenshtein(n, a.alias);
        if (d < bestDist) { bestDist = d; best = a.type; tie = false; }
        else if (d === bestDist && a.type !== best) tie = true;
      });
      if (best && bestDist <= maxDist && !tie) return best;
    }
    return null;
  }

  const isPercentOption = o => o.mode !== 'base' || PERCENT_TYPES.has(o.type);

  // Split on commas; each token may carry a minimum ("dex>=5", "dex 5") and a "%" (percent rolls only).
  function parseOptionQuery(text) {
    const terms = [], names = [];
    String(text || '').split(/[,;]+/).map(s => s.trim()).filter(Boolean).forEach(tok => {
      let name = tok, min = 0;
      const m = tok.match(/^(.*?)\s*(>=|≥|>|=|\s)\s*(\d+)\s*%?\s*$/);
      if (m && m[1].trim()) {
        name = m[1].trim();
        min = Number(m[3]) + (m[2] === '>' ? 1 : 0);
      }
      const wantPct = /%\s*$/.test(name);
      name = name.replace(/%\s*$/, '').trim();
      const type = resolveOptionType(name);
      if (type) terms.push({ type, min, wantPct, raw: tok });
      else names.push(tok);
    });
    return { terms, names };
  }

  function optionTermValue(item, term) {
    const opts = Array.isArray(item && item.affixes) ? item.affixes : [];
    const hits = opts.filter(o => o && o.type === term.type && (!term.wantPct || isPercentOption(o)));
    if (hits.length === 0) return null;
    return hits.reduce((s, o) => s + (Number(o.value) || 0), 0);
  }

  function itemMatchesOptionQuery(item, parsed, mode) {
    const name = String(item && item.name || '').toLowerCase();
    if (!parsed.names.every(n => name.includes(n.toLowerCase()))) return false;
    if (parsed.terms.length === 0) return true;
    const ok = t => { const v = optionTermValue(item, t); return v !== null && v >= t.min; };
    return mode === 'any' ? parsed.terms.some(ok) : parsed.terms.every(ok);
  }

  function optionQueryScore(item, parsed) {
    return parsed.terms.reduce((s, t) => s + (optionTermValue(item, t) || 0), 0);
  }

  function describeTerm(t) {
    const label = (typeof getItemStatLabel === 'function') ? getItemStatLabel(t.type) : t.type;
    return `${label}${t.wantPct ? ' %' : ''}${t.min ? ` ≥${t.min}` : ''}`;
  }

  window.OptionQuery = { parse: parseOptionQuery, matches: itemMatchesOptionQuery, score: optionQueryScore, describe: describeTerm, resolve: resolveOptionType };

  // ==========================================================================
  // SHARED HELPERS
  // ==========================================================================
  const MARKET_RULES = { durations: [12, 24, 48], depositPercent: 2, taxPercent: 8, taxPercentPremium: 4 };
  const BAG_TABS = [['all', 'ทั้งหมด'], ['weapon', 'อาวุธ'], ['armor', 'ชุดเกราะ'], ['accessory', 'ประดับ/เจม'],
    ['usable', 'ใช้ได้'], ['card', 'การ์ด'], ['refine', 'แร่/ตีบวก'], ['material', 'วัตถุดิบ'], ['other', 'อื่นๆ']];

  // Same grouping as the game's bag tabs
  function bagCategory(it) {
    const t = it.type, e = it.equipType;
    if (t === 'Card') return 'card';
    if (t === 'Equipment') return (e === 'Weapon' || e === 'Ammo') ? 'weapon' : (e === 'Acc' || e === 'Gem') ? 'accessory' : 'armor';
    if (t === 'Consumable') return 'usable';
    if (t === 'Enchantment') return 'refine';
    if (t === 'Miscellaneous') return 'material';
    return 'other';
  }
  const categoryLabel = c => (BAG_TABS.find(t => t[0] === c) || [, 'อื่นๆ'])[1];
  const fmtZ = n => `${Math.round(Number(n) || 0).toLocaleString()} z`;
  const fmtShort = n => { n = Number(n) || 0; return n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n.toLocaleString(); };
  const esc = s => escapeHTML(s == null ? '' : String(s));

  function timeLeft(ts) {
    const ms = Number(ts) - Date.now();
    if (!(ms > 0)) return 'หมดเวลา';
    const h = Math.floor(ms / 3600000);
    return h >= 1 ? `${h} ชม.` : `${Math.max(1, Math.floor(ms / 60000))} นาที`;
  }
  function timeAgo(ts) {
    const ms = Date.now() - Number(ts);
    const h = Math.floor(ms / 3600000);
    if (h >= 24) return `${Math.floor(h / 24)} วันที่แล้ว`;
    if (h >= 1) return `${h} ชม.ที่แล้ว`;
    return `${Math.max(1, Math.floor(ms / 60000))} นาทีที่แล้ว`;
  }

  async function api(path, body) {
    const res = await fetch(`${API_BASE}${path}`, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!data) return { success: false, error: `HTTP ${res.status}` };
    return data;
  }

  function toast(text, kind = 'ok') {
    let host = document.getElementById('im-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'im-toast-host';
      document.body.appendChild(host);
    }
    const t = document.createElement('div');
    t.className = `im-toast ${kind}`;
    t.textContent = text;
    host.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3200);
  }

  function makeDraggable(win, handle) {
    handle.addEventListener('mousedown', e => {
      if (e.button !== 0 || e.target.closest('button, input, select, a')) return;
      e.preventDefault();
      const rect = win.getBoundingClientRect();
      const dx = e.clientX - rect.left, dy = e.clientY - rect.top;
      const move = ev => {
        const x = Math.min(window.innerWidth - 80, Math.max(-rect.width + 120, ev.clientX - dx));
        const y = Math.min(window.innerHeight - 40, Math.max(0, ev.clientY - dy));
        win.style.left = `${x}px`;
        win.style.top = `${y}px`;
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  // ==========================================================================
  // BAG PANEL (docked beside the character window)
  // ==========================================================================
  const bag = {
    profileId: null,
    data: null,
    tab: 'all',
    query: '',
    selected: null,        // { slot, itemId }
    timer: null,
    loading: false,
    el: null
  };

  function ensureBagPanel() {
    const overlay = document.getElementById('char-detail-modal');
    if (!overlay) return null;
    if (bag.el && bag.el.isConnected) return bag.el;
    const el = document.createElement('aside');
    el.className = 'im-bag-panel';
    el.innerHTML = `
      <div class="im-bag-head">
        <div class="im-bag-title">🎒 กระเป๋า <span class="im-bag-count">--</span></div>
        <button type="button" class="im-icon-btn" data-act="refresh" title="รีเฟรชกระเป๋า">⟳</button>
      </div>
      <div class="im-bag-search">
        <input type="text" class="im-input" data-role="query" placeholder="ค้นหาชื่อ หรือออฟชั่น เช่น dex, matk>=5, melee dmg">
        <div class="im-query-hint" data-role="hint"></div>
      </div>
      <div class="im-bag-tabs" data-role="tabs"></div>
      <div class="im-bag-grid" data-role="grid"></div>
      <div class="im-bag-detail" data-role="detail"></div>
      <div class="im-bag-foot">
        <div class="im-bag-foot-row">
          <span>Zeny <b data-role="zeny">--</b></span>
          <button type="button" class="im-btn ghost sm" data-act="sort">จัดเรียง</button>
        </div>
        <div class="im-weight">
          <span>น้ำหนัก</span>
          <div class="im-weight-track"><div class="im-weight-fill" data-role="weight-bar"></div></div>
          <span data-role="weight">--</span>
        </div>
      </div>`;
    overlay.appendChild(el);
    overlay.classList.add('has-bag');

    const input = el.querySelector('[data-role="query"]');
    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { bag.query = input.value; renderBag(); }, 120);
    });
    el.addEventListener('click', onBagClick);
    bag.el = el;
    syncBagHeight();
    return el;
  }

  // Keep the bag panel as tall as the character card next to it
  let resizeObs = null;
  function syncBagHeight() {
    const card = document.querySelector('#char-detail-modal .char-modal-card');
    if (!card || !bag.el) return;
    const apply = () => { if (bag.el) bag.el.style.height = `${card.offsetHeight}px`; };
    apply();
    if (resizeObs) resizeObs.disconnect();
    if (typeof ResizeObserver === 'function') {
      resizeObs = new ResizeObserver(apply);
      resizeObs.observe(card);
    }
  }

  async function refreshBag() {
    if (!bag.profileId || bag.loading) return;
    bag.loading = true;
    try {
      const data = await api(`/api/profiles/${encodeURIComponent(bag.profileId)}/inventory`);
      if (data && data.success) {
        bag.data = data;
        renderBag();
      } else if (!bag.data) {
        const grid = bag.el && bag.el.querySelector('[data-role="grid"]');
        if (grid) grid.innerHTML = `<div class="im-empty">⚠️ ${esc(data && data.error || 'อ่านกระเป๋าไม่สำเร็จ')}</div>`;
      }
    } finally {
      bag.loading = false;
    }
  }

  function selectedBagItem() {
    if (!bag.selected || !bag.data) return null;
    return bag.data.items.find(i => i.slot === bag.selected.slot && i.itemId === bag.selected.itemId) || null;
  }

  function renderBag() {
    const el = bag.el;
    const d = bag.data;
    if (!el || !d) return;
    const parsed = parseOptionQuery(bag.query);
    const items = d.items.slice().sort((a, b) => a.slot - b.slot);
    const counts = { all: items.length };
    items.forEach(i => { const c = bagCategory(i); counts[c] = (counts[c] || 0) + 1; });

    el.querySelector('.im-bag-count').textContent = `${items.length}/${d.slots || 100}`;
    el.querySelector('[data-role="tabs"]').innerHTML = BAG_TABS.map(([key, label]) =>
      `<button type="button" class="im-tab ${bag.tab === key ? 'active' : ''} ${counts[key] ? '' : 'empty'}" data-tab="${key}">${label} <small>${counts[key] || 0}</small></button>`
    ).join('');

    // Query hint: recognised options vs plain name words
    const hint = el.querySelector('[data-role="hint"]');
    if (parsed.terms.length || parsed.names.length) {
      hint.innerHTML = [
        ...parsed.terms.map(t => `<span class="im-qchip opt">✓ ${esc(describeTerm(t))}</span>`),
        ...parsed.names.map(n => `<span class="im-qchip name">ชื่อ: ${esc(n)}</span>`)
      ].join('');
    } else {
      hint.innerHTML = '';
    }

    const visible = items.filter(i => (bag.tab === 'all' || bagCategory(i) === bag.tab) && itemMatchesOptionQuery(i, parsed, 'all'));
    const sel = selectedBagItem();
    const grid = el.querySelector('[data-role="grid"]');
    grid.innerHTML = visible.length === 0
      ? `<div class="im-empty">${items.length ? '🔍 ไม่พบไอเทมตามที่ค้นหา' : 'กระเป๋าว่าง'}</div>`
      : visible.map(i => `
        <button type="button" class="im-cell ${sel && sel.slot === i.slot ? 'selected' : ''}" data-slot="${i.slot}" data-item="${i.itemId}"
          title="${esc(formatItemDisplayName(i))}" style="--rc: ${getRarityColor(i.rarity)};">
          ${i.icon ? `<img src="${esc(gameAssetUrl(i.icon))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : ''}
          ${i.qty > 1 ? `<span class="im-cell-qty">${i.qty.toLocaleString()}</span>` : ''}
          ${i.refine ? `<span class="im-cell-ref">+${i.refine}</span>` : ''}
          ${i.locked ? '<span class="im-cell-lock">🔒</span>' : ''}
          ${parsed.terms.length && i.affixes && i.affixes.length ? '<span class="im-cell-hit"></span>' : ''}
        </button>`).join('');

    el.querySelector('[data-role="zeny"]').textContent = typeof d.zeny === 'number' ? d.zeny.toLocaleString() : '--';
    const w = Number(d.weight), wl = Number(d.weightLimit);
    const pct = wl > 0 ? Math.min(100, (w / wl) * 100) : 0;
    const bar = el.querySelector('[data-role="weight-bar"]');
    bar.style.width = `${pct}%`;
    bar.className = `im-weight-fill ${pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : ''}`;
    el.querySelector('[data-role="weight"]').textContent = wl > 0 ? `${w.toLocaleString()}/${wl.toLocaleString()}` : '--';

    renderBagDetail(sel, parsed);
    if (market.open && sel && market.item && market.item.slot === sel.slot && market.item.itemId === sel.itemId) {
      market.item = sel;  // keep qty/lock state fresh in the market window
      renderMarketSellForm();
    }
  }

  function renderBagDetail(item, parsed) {
    const box = bag.el.querySelector('[data-role="detail"]');
    if (!item) {
      box.innerHTML = `<div class="im-detail-hint">คลิกไอเทมเพื่อดูรายละเอียด · สวมใส่ / ใช้ / ล็อค / ทิ้ง / ขายลงตลาด</div>`;
      return;
    }
    const isEquip = Boolean(item.equipType) && !item.usable;
    const canLock = item.maxStack === 1;
    const highlight = parsed.terms.map(t => t.type);
    const meta = [
      categoryLabel(bagCategory(item)),
      `จำนวน ${item.qty.toLocaleString()}`,
      item.weight != null ? `น้ำหนัก ${item.weight}` : null,
      item.sellPrice != null ? `ขาย NPC ${fmtZ(item.sellPrice)}` : null,
      item.levelReq ? `ต้อง Lv.${item.levelReq}` : null
    ].filter(Boolean).join(' · ');
    box.innerHTML = `
      <div class="im-detail-top">
        ${item.icon ? `<img src="${esc(gameAssetUrl(item.icon))}" class="im-detail-icon" alt="">` : ''}
        <div class="im-detail-name-wrap">
          <div class="im-detail-name" style="color: ${getRarityColor(item.rarity)};">${esc(formatItemDisplayName(item))}${item.locked ? ' 🔒' : ''}</div>
          <div class="im-detail-meta">${esc(meta)}</div>
          ${item.jobs && item.jobs.length ? `<div class="im-detail-meta">ใช้ได้: ${esc(item.jobs.join(', '))}</div>` : ''}
        </div>
      </div>
      ${renderItemStatGroups(item, highlight)}
      <div class="im-detail-actions">
        ${isEquip ? `<button type="button" class="im-btn primary" data-act="equip">สวมใส่</button>` : ''}
        ${item.usable ? `<button type="button" class="im-btn primary" data-act="use">ใช้</button>` : ''}
        ${canLock ? `<button type="button" class="im-btn ghost" data-act="lock">${item.locked ? '🔓 ปลดล็อค' : '🔒 ล็อค'}</button>` : ''}
        ${item.destroyable ? `<button type="button" class="im-btn danger" data-act="destroy" ${item.locked ? 'disabled title="ไอเทมถูกล็อคอยู่"' : ''}>ทิ้ง</button>` : ''}
        <button type="button" class="im-btn ghost" data-act="wl" title="เพิ่มเข้า Whitelist (รายการห้ามขายให้ NPC)">🛡️ เพิ่ม WL</button>
        <button type="button" class="im-btn ghost" data-act="autosell" title="เพิ่มเข้ารายการ Auto Sell — บอทจะลงขายตลาดกลางให้เอง (ราคาถูกกว่าคนอื่น 1 z)">🏷️ เพิ่ม Auto Sell</button>
        <button type="button" class="im-btn market" data-act="market">🏪 ขายลงตลาด</button>
      </div>`;
  }

  async function bagAction(op, extra = {}) {
    const item = selectedBagItem();
    if (!item && op !== 'sort') return;
    const body = Object.assign({ op }, item ? { slot: item.slot, itemId: item.itemId } : {}, extra);
    const r = await api(`/api/profiles/${encodeURIComponent(bag.profileId)}/inventory-action`, body);
    if (!r.success) toast(`❌ ${r.error || 'ทำรายการไม่สำเร็จ'}`, 'err');
    setTimeout(refreshBag, 500);
    if (op === 'equip' && typeof loadCharacterDetail === 'function' && typeof currentCharProfileId !== 'undefined' && currentCharProfileId) {
      setTimeout(() => loadCharacterDetail(currentCharProfileId), 700);
    }
    return r;
  }

  async function addToWhitelist(name) {
    const base = `/api/profiles/${encodeURIComponent(bag.profileId)}/whitelist`;
    const cur = await api(base);
    const list = String(cur && cur.whitelist || '').split(',').map(s => s.trim()).filter(Boolean);
    if (list.some(n => n.toLowerCase() === name.toLowerCase())) {
      toast(`ℹ️ "${name}" อยู่ใน Whitelist แล้ว`);
      return;
    }
    list.push(name);
    const res = await fetch(`${API_BASE}${base}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ whitelist: list.join(', ') }) });
    const r = await res.json().catch(() => null);
    toast(r && r.success !== false ? `🛡️ เพิ่ม "${name}" เข้า Whitelist แล้ว` : '❌ บันทึก Whitelist ไม่สำเร็จ', r && r.success !== false ? 'ok' : 'err');
  }

  // "🏷️ เพิ่ม Auto Sell": a rule added inside the game (read + add there, so a list changed in the game meanwhile
  // is never overwritten by an older copy from this page)
  async function addToAutoSell(item) {
    const name = String(item.name || '').trim();
    if (!name) return;
    const ans = prompt(`ลงขาย "${name}" ในตลาดกลางอัตโนมัติ เมื่อมีในกระเป๋าครบกี่ชิ้น?`, '1');
    if (ans === null) return;
    const minQty = Math.max(1, parseInt(ans, 10) || 1);
    const code = `(() => {
      const c = window.__autoMarketSellConfig || (window.__autoMarketSellConfig = { rules: [] });
      if (!Array.isArray(c.rules)) c.rules = [];
      const name = ${JSON.stringify(name)};
      if (c.rules.some(r => r && String(r.itemName || '').trim().toLowerCase() === name.toLowerCase())) return { success: true, exists: true };
      c.rules.push({ id: 'rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), itemName: name, minQty: ${minQty}, sellMode: 'all', enabled: true });
      try { localStorage.setItem('pelican_auto_market_sell_cfg', JSON.stringify(c)); } catch (e) { return { success: false, error: e.message }; }
      try { const box = document.getElementById('p-autosell-hud-rules-container'); if (box && typeof window.renderAutoSellHudRulesHtml === 'function') box.innerHTML = window.renderAutoSellHudRulesHtml(); } catch (e) {}
      return { success: true, added: true, count: c.rules.length, enabled: !!c.enabled };
    })()`;
    const r = await api(`/api/profiles/${encodeURIComponent(bag.profileId)}/client-action`, { type: 'eval', code });
    const out = r && r.result && r.result.result;
    if (!out || out.success === false) return toast('❌ เพิ่มรายการ Auto Sell ไม่สำเร็จ: ' + ((out && out.error) || (r && r.error) || 'จอเกมไม่ตอบ'), 'err');
    if (out.exists) return toast(`ℹ️ "${name}" อยู่ในรายการ Auto Sell แล้ว`);
    toast(`🏷️ เพิ่ม "${name}" เข้า Auto Sell แล้ว (ครบ ≥ ${minQty} ชิ้น)${out.enabled ? '' : ' — ระบบ Auto Sell ยังปิดอยู่ เปิดได้ที่เมนูบอท > ตลาด'}`);
  }

  async function onBagClick(e) {
    const tabBtn = e.target.closest('.im-tab');
    if (tabBtn) { bag.tab = tabBtn.dataset.tab; renderBag(); return; }

    const cell = e.target.closest('.im-cell');
    if (cell) {
      bag.selected = { slot: Number(cell.dataset.slot), itemId: Number(cell.dataset.item) };
      renderBag();
      const item = selectedBagItem();
      if (market.open && item) openMarketFor(item);
      return;
    }

    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    const item = selectedBagItem();
    if (act === 'refresh') return refreshBag();
    if (act === 'sort') {
      if (confirm('จัดเรียงกระเป๋าในเกมตอนนี้?')) { bag.selected = null; await bagAction('sort'); }
      return;
    }
    if (!item) return;
    if (act === 'equip') return bagAction('equip');
    if (act === 'use') return bagAction('use');
    if (act === 'lock') return bagAction('lock', { locked: !item.locked });
    if (act === 'destroy') {
      if (confirm(`ทิ้ง ${formatItemDisplayName(item)} x${item.qty} ?\nไอเทมจะหายถาวร กู้คืนไม่ได้`)) {
        const r = await bagAction('destroy', { qty: item.qty });
        if (r && r.success) { bag.selected = null; toast(`🗑️ ทิ้ง ${item.name} แล้ว`); }
      }
      return;
    }
    if (act === 'wl') return addToWhitelist(item.name);
    if (act === 'autosell') return addToAutoSell(item);
    if (act === 'market') return openMarketFor(item);
  }

  // ==========================================================================
  // FLOATING MARKET WINDOW (follows the selected bag item)
  // ==========================================================================
  const market = {
    open: false,
    el: null,
    item: null,
    listings: null,
    history: null,
    range: '7d',
    sort: 'similar',
    sameRefine: true,
    optText: '',           // option filter for other sellers' listings, e.g. "dex>=5, matk%"
    reqToken: 0,
    cache: new Map(),
    form: { qty: 1, unit: '', hours: 24 }
  };

  // The game's market search filters one option server-side (affix + affixMin, ATK also matches ATK%).
  // Use the most restrictive typed term there; the rest are applied client-side in visibleListings().
  function marketOptQuery() {
    const parsed = parseOptionQuery(market.optText);
    const lead = parsed.terms.slice().sort((a, b) => b.min - a.min)[0] || null;
    return { terms: parsed.terms, lead };
  }

  function ensureMarketWindow() {
    if (market.el && market.el.isConnected) return market.el;
    const el = document.createElement('div');
    el.className = 'im-market';
    el.innerHTML = `
      <div class="im-mk-head" data-role="drag">
        <div class="im-mk-title" data-role="title">🏪 ตลาด</div>
        <div class="im-mk-head-btns">
          <button type="button" class="im-icon-btn" data-mk="reload" title="โหลดราคาใหม่">⟳</button>
          <button type="button" class="im-icon-btn" data-mk="collapse" title="ย่อ/ขยาย">−</button>
          <button type="button" class="im-icon-btn close" data-mk="close" title="ปิด">✕</button>
        </div>
      </div>
      <div class="im-mk-body">
        <div class="im-mk-mine" data-role="mine"></div>
        <div class="im-mk-cols">
          <section class="im-mk-col">
            <div class="im-mk-col-head">
              <span>🏷️ คนอื่นตั้งขายอยู่</span>
              <div class="im-mk-tools">
                <label class="im-check"><input type="checkbox" data-mk="same-refine" checked> ตีบวกเท่ากัน</label>
                <select class="im-select" data-mk="sort">
                  <option value="similar">ออฟใกล้เคียงของฉัน</option>
                  <option value="price">ราคาต่ำ → สูง</option>
                </select>
              </div>
            </div>
            <div class="im-mk-optrow">
              <input type="text" class="im-input" data-mk="opt" placeholder="หาคนขายที่มีออฟ เช่น dex, matk>=5, melee dmg" autocomplete="off">
              <button type="button" class="im-btn ghost sm" data-mk="opt-go" title="ค้นหาในตลาดตามออฟที่พิมพ์">ค้นหา</button>
            </div>
            <div class="im-query-hint" data-role="opt-hint"></div>
            <div class="im-mk-summary" data-role="list-summary"></div>
            <div class="im-mk-list" data-role="listings"></div>
          </section>
          <section class="im-mk-col">
            <div class="im-mk-col-head">
              <span>📈 ราคาที่ขายได้จริง</span>
              <div class="im-seg" data-role="range">
                <button type="button" data-range="24h">24 ชม.</button>
                <button type="button" data-range="7d">7 วัน</button>
                <button type="button" data-range="30d">1 เดือน</button>
              </div>
            </div>
            <div data-role="history"></div>
          </section>
        </div>
        <form class="im-mk-sell" data-role="sell"></form>
      </div>`;
    document.body.appendChild(el);
    // Open beside the bag panel (to its left) so the grid stays clickable
    const bagRect = bag.el && bag.el.getBoundingClientRect();
    const left = bagRect && bagRect.width ? bagRect.left - el.offsetWidth - 10 : window.innerWidth - el.offsetWidth - 20;
    el.style.left = `${Math.max(12, left)}px`;
    el.style.top = `${Math.max(12, bagRect && bagRect.width ? bagRect.top : 70)}px`;
    makeDraggable(el, el.querySelector('[data-role="drag"]'));

    el.addEventListener('click', e => {
      const b = e.target.closest('[data-mk], [data-range], [data-quick]');
      if (!b) return;
      if (b.dataset.mk === 'close') return closeMarket();
      if (b.dataset.mk === 'collapse') { el.classList.toggle('collapsed'); b.textContent = el.classList.contains('collapsed') ? '+' : '−'; return; }
      if (b.dataset.mk === 'reload') { market.cache.clear(); return loadMarketData(true); }
      if (b.dataset.mk === 'opt-go') { clearTimeout(market.optTimer); return loadMarketData(false); }
      if (b.dataset.range) { market.range = b.dataset.range; return loadHistory(); }
      if (b.dataset.quick) { e.preventDefault(); applyQuickPrice(b.dataset.quick); }
    });
    el.addEventListener('change', e => {
      if (e.target.dataset.mk === 'sort') { market.sort = e.target.value; renderListings(); }
      if (e.target.dataset.mk === 'same-refine') { market.sameRefine = e.target.checked; renderListings(); }
    });
    el.addEventListener('input', e => {
      if (e.target.dataset.mk === 'opt') {
        market.optText = e.target.value;
        renderOptHint();
        renderListings();
        // Re-query the market once typing settles (the server needs the leading option)
        clearTimeout(market.optTimer);
        market.optTimer = setTimeout(() => loadMarketData(false), 800);
        return;
      }
      const f = e.target.dataset.form;
      if (!f) return;
      if (f === 'hours') market.form.hours = Number(e.target.value);
      else market.form[f] = e.target.value.replace(/[^\d]/g, '');
      if (f !== 'hours' && e.target.value !== market.form[f]) e.target.value = market.form[f];
      renderSellSummary();
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.dataset.mk === 'opt') {
        e.preventDefault();
        clearTimeout(market.optTimer);
        loadMarketData(false);
      }
    });
    el.addEventListener('submit', e => { e.preventDefault(); submitListing(); });
    market.el = el;
    return el;
  }

  function closeMarket() {
    market.open = false;
    market.reqToken++;
    if (market.el) market.el.remove();
    market.el = null;
  }

  function openMarketFor(item) {
    const el = ensureMarketWindow();
    el.classList.remove('collapsed');
    const changed = !market.item || market.item.itemId !== item.itemId || market.item.slot !== item.slot;
    market.open = true;
    market.item = item;
    if (changed) {
      market.form = { qty: item.qty > 1 ? String(item.qty) : '1', unit: '', hours: market.form.hours || 24 };
      market.listings = null;
      market.history = null;
    }
    // Carry over options typed in the bag search ("dex, matk") so the market searches the same thing
    if (!market.optText.trim()) {
      market.optText = parseOptionQuery(bag.query).terms.map(t => t.raw).join(', ');
    }
    const optInput = el.querySelector('[data-mk="opt"]');
    if (optInput && optInput.value !== market.optText) optInput.value = market.optText;
    renderOptHint();
    renderMarketHeader();
    renderListings();
    renderHistory();
    renderMarketSellForm();
    if (changed) loadMarketData(false);
  }

  function renderMarketHeader() {
    const it = market.item;
    const el = market.el;
    el.querySelector('[data-role="title"]').innerHTML = `
      ${it.icon ? `<img src="${esc(gameAssetUrl(it.icon))}" alt="">` : '🏪'}
      <span style="color: ${getRarityColor(it.rarity)};">${esc(formatItemDisplayName(it))}</span>`;
    const opts = Array.isArray(it.affixes) ? it.affixes : [];
    el.querySelector('[data-role="mine"]').innerHTML = `
      <span class="im-mk-mine-lbl">ออฟชั่นของชิ้นนี้</span>
      ${opts.length ? renderItemStatGroups({ affixes: opts }) : '<span class="im-muted">ไม่มีออฟชั่นสุ่ม</span>'}`;
    el.querySelectorAll('[data-range]').forEach(b => b.classList.toggle('active', b.dataset.range === market.range));
  }

  async function loadMarketData(force) {
    const it = market.item;
    if (!it) return;
    const { lead } = marketOptQuery();
    const key = `${bag.profileId}:${it.itemId}:${it.name}:${lead ? `${lead.type}>=${lead.min}` : ''}`;
    const cached = market.cache.get(key);
    if (!force && cached && Date.now() - cached.at < 60000) {
      market.listings = cached.listings;
      renderListings();
      renderMarketSellForm();
      if (!market.history) loadHistory();
      return;
    }
    const token = ++market.reqToken;
    market.listings = null;
    renderListings();
    const body = { op: 'search', q: it.name, pages: lead ? 6 : 3 };
    if (lead) { body.affix = lead.type; if (lead.min) body.affixMin = lead.min; }
    const r = await api(`/api/profiles/${encodeURIComponent(bag.profileId)}/market`, body);
    if (token !== market.reqToken) return;
    if (r.success) {
      // Search is "contains"; keep only the exact item (Slayer must not include Doom Slayer)
      market.listings = (r.listings || []).filter(l => l.item && Number(l.item.itemId) === Number(it.itemId));
      market.cache.set(key, { at: Date.now(), listings: market.listings });
    } else {
      market.listings = { error: r.error || 'ค้นหาตลาดไม่สำเร็จ' };
    }
    renderListings();
    renderMarketSellForm();
    if (market.history && !market.history.error) return;  // sold-price history doesn't depend on the option filter
    await new Promise(res => setTimeout(res, 400));  // the game server ignores back-to-back market requests
    if (token === market.reqToken) loadHistory();
  }

  function renderOptHint() {
    const box = market.el && market.el.querySelector('[data-role="opt-hint"]');
    if (!box) return;
    const parsed = parseOptionQuery(market.optText);
    box.innerHTML = [
      ...parsed.terms.map(t => `<span class="im-qchip opt">✓ ${esc(describeTerm(t))}</span>`),
      ...parsed.names.map(n => `<span class="im-qchip bad" title="ไม่รู้จักออฟชั่นนี้">? ${esc(n)}</span>`)
    ].join('');
  }

  async function loadHistory() {
    const it = market.item;
    if (!it) return;
    const token = ++market.reqToken;
    market.history = null;
    renderMarketHeader();
    renderHistory();
    const r = await api(`/api/profiles/${encodeURIComponent(bag.profileId)}/market`, { op: 'history', itemId: it.itemId, refine: it.refine || 0, range: market.range });
    if (token !== market.reqToken) return;
    market.history = r.success ? r.history : { error: r.error || 'โหลดประวัติราคาไม่สำเร็จ' };
    renderHistory();
    renderMarketSellForm();
  }

  // How many of my item's random options a listing also has (type match, value-weighted)
  function similarity(listing) {
    const mine = Array.isArray(market.item.affixes) ? market.item.affixes : [];
    if (mine.length === 0) return { score: 0, hits: 0, total: 0 };
    const theirs = Array.isArray(listing.item.affixes) ? listing.item.affixes : [];
    let score = 0, hits = 0;
    mine.forEach(o => {
      const t = theirs.find(x => x.type === o.type && isPercentOption(x) === isPercentOption(o));
      if (t) { hits++; score += Math.min(1, (Number(t.value) || 0) / Math.max(1, Number(o.value) || 1)); }
    });
    return { score: score / mine.length, hits, total: mine.length };
  }

  function visibleListings() {
    if (!Array.isArray(market.listings)) return [];
    const refine = market.item.refine || 0;
    const { terms } = marketOptQuery();
    const optFilter = { terms, names: [] };
    return market.listings
      .filter(l => !market.sameRefine || (l.item.refine || 0) === refine)
      .filter(l => terms.length === 0 || itemMatchesOptionQuery(l.item, optFilter, 'all'))
      .map(l => ({ l, unit: Math.round(l.price / Math.max(1, l.qty)), sim: similarity(l) }))
      .sort((a, b) => market.sort === 'similar' ? (b.sim.score - a.sim.score || a.unit - b.unit) : a.unit - b.unit);
  }

  function renderListings() {
    const el = market.el;
    if (!el) return;
    const box = el.querySelector('[data-role="listings"]');
    const sum = el.querySelector('[data-role="list-summary"]');
    el.querySelector('[data-mk="sort"]').value = market.sort;
    el.querySelector('[data-mk="same-refine"]').checked = market.sameRefine;
    if (market.listings === null) {
      sum.innerHTML = '';
      box.innerHTML = '<div class="im-empty">⏳ กำลังค้นหาในตลาด...</div>';
      return;
    }
    if (market.listings.error) {
      sum.innerHTML = '';
      box.innerHTML = `<div class="im-empty">⚠️ ${esc(market.listings.error)}</div>`;
      return;
    }
    const rows = visibleListings();
    const { terms } = marketOptQuery();
    const mineTypes = [...(market.item.affixes || []).map(o => o.type), ...terms.map(t => t.type)];
    const cheapest = rows.length ? Math.min(...rows.map(r => r.unit)) : null;
    const fullMatch = rows.filter(r => r.sim.total > 0 && r.sim.hits === r.sim.total);
    const cheapestMatch = fullMatch.length ? Math.min(...fullMatch.map(r => r.unit)) : null;
    const optLabel = terms.map(describeTerm).join(' + ');
    sum.innerHTML = terms.length ? `
      <div class="im-tile"><small>มีออฟนี้ขายอยู่</small><b>${rows.length}</b></div>
      <div class="im-tile hl wide"><small>ถูกสุดที่มี ${esc(optLabel)}</small><b>${cheapest !== null ? fmtZ(cheapest) : 'ไม่มีคนขาย'}</b></div>
      <div class="im-tile"><small>ถูกสุดที่ออฟตรงทุกข้อของฉัน</small><b>${cheapestMatch !== null ? fmtZ(cheapestMatch) : '--'}</b></div>` : `
      <div class="im-tile"><small>ขายอยู่</small><b>${rows.length}</b></div>
      <div class="im-tile"><small>ถูกสุด</small><b>${cheapest !== null ? fmtZ(cheapest) : '--'}</b></div>
      <div class="im-tile hl"><small>ถูกสุดที่ออฟตรงทุกข้อ</small><b>${cheapestMatch !== null ? fmtZ(cheapestMatch) : '--'}</b></div>`;
    if (rows.length === 0) {
      box.innerHTML = terms.length
        ? `<div class="im-empty">ยังไม่มีใครตั้งขาย ${esc(market.item.name)} ที่มี ${esc(optLabel)}</div>`
        : '<div class="im-empty">ยังไม่มีใครตั้งขายไอเทมนี้ (ตามเงื่อนไขที่เลือก)</div>';
      return;
    }
    box.innerHTML = rows.slice(0, 60).map(({ l, unit, sim }) => {
      const auction = l.auctionEndsAt && l.auctionEndsAt > Date.now();
      return `
        <div class="im-row ${sim.total && sim.hits === sim.total ? 'full' : ''} ${l.mine ? 'mine' : ''}">
          <div class="im-row-main">
            <div class="im-row-name">
              ${l.item.refine ? `<b>+${l.item.refine}</b> ` : ''}${sim.total ? `<span class="im-match m${Math.min(3, sim.hits)}">ตรง ${sim.hits}/${sim.total}</span>` : ''}
              ${auction ? '<span class="im-auction">ประมูล</span>' : ''}${l.mine ? '<span class="im-auction mine">ของฉัน</span>' : ''}
            </div>
            ${l.item.affixes && l.item.affixes.length ? renderItemStatGroups({ affixes: l.item.affixes }, mineTypes) : '<span class="im-muted">ไม่มีออฟชั่น</span>'}
          </div>
          <div class="im-row-side">
            <b>${fmtZ(unit)}</b>
            ${l.qty > 1 ? `<small>x${l.qty} · รวม ${fmtZ(l.price)}</small>` : ''}
            <small>${esc(l.sellerName || '')} · ${timeLeft(l.expiresAt)}</small>
          </div>
        </div>`;
    }).join('');
  }

  // Sold-price stats. Note: the game records sales per item + refine only (not per option).
  function historyStats(h) {
    const pts = (h.points || []).filter(p => p && p.pieces > 0);
    const pieces = pts.reduce((s, p) => s + p.pieces, 0);
    const avg = pieces ? Math.round(pts.reduce((s, p) => s + p.avg * p.pieces, 0) / pieces) : null;
    const low = pts.length ? Math.min(...pts.map(p => p.low)) : null;
    const high = pts.length ? Math.max(...pts.map(p => p.high)) : null;
    let units = (h.recent || []).map(r => Math.round(r.price / Math.max(1, r.qty))).filter(u => u > 0).sort((a, b) => a - b);
    if (units.length >= 4) {  // IQR outlier rejection (one-off 500,000 z sales skew everything)
      const q1 = units[Math.floor(units.length * 0.25)], q3 = units[Math.floor(units.length * 0.75)];
      const lo = q1 - 1.5 * (q3 - q1), hi = q3 + 1.5 * (q3 - q1);
      const kept = units.filter(u => u >= lo && u <= hi);
      if (kept.length) units = kept;
    }
    const mid = Math.floor(units.length / 2);
    const median = units.length ? (units.length % 2 ? units[mid] : Math.round((units[mid - 1] + units[mid]) / 2)) : avg;
    return { pts, pieces, avg, low, high, median, last: (h.recent || [])[0] };
  }

  function renderHistoryChart(h) {
    const pts = h.points || [];
    const W = 340, H = 96, P = 4;
    const valid = pts.filter(p => p && p.pieces > 0);
    if (valid.length < 2) return '<div class="im-empty sm">ข้อมูลน้อยเกินไปสำหรับกราฟ</div>';
    // Clip the y-axis at the 90th percentile so a single extreme sale doesn't flatten the line
    const highs = valid.map(p => p.high).sort((a, b) => a - b);
    const yMax = Math.max(1, highs[Math.floor(highs.length * 0.9)] || highs[highs.length - 1]);
    const n = Math.max(2, h.buckets || pts.length);
    const x = b => P + (b / (n - 1)) * (W - 2 * P);
    const y = v => H - P - (Math.min(v, yMax) / yMax) * (H - 2 * P);
    const line = valid.map(p => `${x(p.bucket).toFixed(1)},${y(p.avg).toFixed(1)}`).join(' ');
    const band = valid.map(p => `${x(p.bucket).toFixed(1)},${y(p.high).toFixed(1)}`).join(' ') + ' ' +
      valid.slice().reverse().map(p => `${x(p.bucket).toFixed(1)},${y(p.low).toFixed(1)}`).join(' ');
    const maxPieces = Math.max(...valid.map(p => p.pieces));
    const bars = valid.map(p => {
      const bh = Math.max(1, (p.pieces / maxPieces) * 18);
      return `<rect x="${(x(p.bucket) - 2).toFixed(1)}" y="${(H + 22 - bh).toFixed(1)}" width="4" height="${bh.toFixed(1)}" rx="1"></rect>`;
    }).join('');
    const mark = Number(market.form.unit) > 0 ? `<line class="im-ch-mark" x1="${P}" x2="${W - P}" y1="${y(Number(market.form.unit)).toFixed(1)}" y2="${y(Number(market.form.unit)).toFixed(1)}"></line>` : '';
    return `
      <svg class="im-chart" viewBox="0 0 ${W} ${H + 24}" preserveAspectRatio="none">
        <polygon class="im-ch-band" points="${band}"></polygon>
        <polyline class="im-ch-line" points="${line}"></polyline>
        ${mark}
        <g class="im-ch-bars">${bars}</g>
      </svg>
      <div class="im-chart-legend"><span><i class="l"></i>ราคาเฉลี่ย/ชิ้น</span><span><i class="b"></i>ช่วงต่ำ-สูง</span><span><i class="v"></i>จำนวนที่ขายได้</span>${mark ? '<span><i class="m"></i>ราคาที่ฉันตั้ง</span>' : ''}</div>`;
  }

  function renderHistory() {
    const el = market.el;
    if (!el) return;
    const box = el.querySelector('[data-role="history"]');
    el.querySelectorAll('[data-range]').forEach(b => b.classList.toggle('active', b.dataset.range === market.range));
    const h = market.history;
    if (h === null) { box.innerHTML = '<div class="im-empty">⏳ กำลังโหลดประวัติราคา...</div>'; return; }
    if (h.error) { box.innerHTML = `<div class="im-empty">⚠️ ${esc(h.error)}</div>`; return; }
    const s = historyStats(h);
    if (!s.pieces && !(h.recent || []).length) { box.innerHTML = '<div class="im-empty">ยังไม่มีประวัติการขายในช่วงเวลานี้</div>'; return; }
    box.innerHTML = `
      <div class="im-mk-summary">
        <div class="im-tile hl"><small>ราคากลาง</small><b>${s.median ? fmtZ(s.median) : '--'}</b></div>
        <div class="im-tile"><small>เฉลี่ย</small><b>${s.avg ? fmtZ(s.avg) : '--'}</b></div>
        <div class="im-tile"><small>ต่ำ / สูง</small><b title="${s.low != null ? `${s.low.toLocaleString()} / ${s.high.toLocaleString()} z` : ''}">${s.low != null ? `${fmtShort(s.low)} / ${fmtShort(s.high)}` : '--'}</b></div>
        <div class="im-tile"><small>ขายไป</small><b>${s.pieces.toLocaleString()} ชิ้น</b></div>
      </div>
      ${renderHistoryChart(h)}
      <div class="im-recent">
        <div class="im-recent-head"><span>ขายล่าสุด</span><span>จำนวน</span><span>ต่อชิ้น</span></div>
        ${(h.recent || []).slice(0, 12).map(r => `
          <div class="im-recent-row"><span>${timeAgo(r.at)}</span><span>${r.qty}</span><b>${fmtZ(r.price / Math.max(1, r.qty))}</b></div>`).join('')}
      </div>
      <div class="im-note">ราคาขายจริงเกมเก็บแยกตามชื่อไอเทม + ตีบวกเท่านั้น ไม่แยกตามออฟชั่น</div>`;
  }

  function quickPrices() {
    const rows = visibleListings().filter(r => !r.l.mine);
    const q = {};
    if (market.history && !market.history.error) {
      const s = historyStats(market.history);
      if (s.median) q.median = s.median;
    }
    if (rows.length) q.undercut = Math.max(1, Math.min(...rows.map(r => r.unit)) - 1);
    const best = rows.filter(r => r.sim.total > 0).sort((a, b) => b.sim.score - a.sim.score || a.unit - b.unit)[0];
    if (best) q.similar = best.unit;
    return q;
  }

  function applyQuickPrice(kind) {
    const q = quickPrices();
    if (!q[kind]) return;
    market.form.unit = String(q[kind]);
    renderMarketSellForm();
    renderHistory();
  }

  function renderMarketSellForm() {
    const el = market.el;
    const it = market.item;
    if (!el || !it) return;
    const form = el.querySelector('[data-role="sell"]');
    const q = quickPrices();
    const stackable = it.maxStack !== 1 && it.qty > 1;
    const blocked = it.locked ? 'ไอเทมถูกล็อคอยู่ — ปลดล็อคในกระเป๋าก่อนลงขาย' : '';
    const active = document.activeElement && form.contains(document.activeElement) ? document.activeElement.dataset.form : null;
    form.innerHTML = `
      <div class="im-sell-grid">
        <label>จำนวน
          <div class="im-inline"><input class="im-input" data-form="qty" inputmode="numeric" value="${esc(market.form.qty)}" ${stackable ? '' : 'disabled'}><small>/ ${it.qty}</small></div>
        </label>
        <label>ราคาต่อชิ้น (z)
          <input class="im-input" data-form="unit" inputmode="numeric" placeholder="เช่น 5000" value="${esc(market.form.unit)}">
        </label>
        <label>ระยะเวลา
          <select class="im-select" data-form="hours">${MARKET_RULES.durations.map(h => `<option value="${h}" ${Number(market.form.hours) === h ? 'selected' : ''}>${h} ชั่วโมง</option>`).join('')}</select>
        </label>
      </div>
      <div class="im-quick">
        <span>ตั้งราคาเร็ว:</span>
        <button type="button" class="im-btn ghost sm" data-quick="median" ${q.median ? '' : 'disabled'}>ราคากลาง${q.median ? ` ${fmtZ(q.median)}` : ''}</button>
        <button type="button" class="im-btn ghost sm" data-quick="undercut" ${q.undercut ? '' : 'disabled'}>ถูกกว่าคนอื่น 1z${q.undercut ? ` ${fmtZ(q.undercut)}` : ''}</button>
        <button type="button" class="im-btn ghost sm" data-quick="similar" ${q.similar ? '' : 'disabled'}>เท่าออฟใกล้เคียง${q.similar ? ` ${fmtZ(q.similar)}` : ''}</button>
      </div>
      <div class="im-sell-foot">
        <div class="im-sell-summary" data-role="sell-summary"></div>
        <button type="submit" class="im-btn market lg" ${blocked ? 'disabled' : ''}>ลงขาย</button>
      </div>
      ${blocked ? `<div class="im-warn">🔒 ${blocked}</div>` : ''}`;
    if (active) {
      const inp = form.querySelector(`[data-form="${active}"]`);
      if (inp) { inp.focus(); if (inp.setSelectionRange && inp.value) inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
    renderSellSummary();
  }

  function sellNumbers() {
    const it = market.item;
    const qty = it.maxStack === 1 ? 1 : Math.min(it.qty, Math.max(1, Number(market.form.qty) || 1));
    const unit = Number(market.form.unit) || 0;
    const total = unit * qty;
    const premium = Boolean(bag.data && bag.data.premium);
    const taxPct = premium ? MARKET_RULES.taxPercentPremium : MARKET_RULES.taxPercent;
    const deposit = total > 0 ? Math.max(1, Math.floor(total * MARKET_RULES.depositPercent / 100)) : 0;
    const receive = total - Math.floor(total * taxPct / 100);
    return { qty, unit, total, taxPct, deposit, receive };
  }

  function renderSellSummary() {
    const box = market.el && market.el.querySelector('[data-role="sell-summary"]');
    if (!box) return;
    const n = sellNumbers();
    box.innerHTML = n.total > 0
      ? `<span>ราคารวม <b>${fmtZ(n.total)}</b></span><span>มัดจำ ${fmtZ(n.deposit)} (คืนเมื่อขายได้)</span><span>ขายได้รับ <b class="ok">${fmtZ(n.receive)}</b> (หักภาษี ${n.taxPct}%)</span>`
      : '<span class="im-muted">ใส่ราคาต่อชิ้น หรือกดปุ่มตั้งราคาเร็ว</span>';
  }

  async function submitListing() {
    const it = market.item;
    const n = sellNumbers();
    if (!(n.unit > 0)) { toast('ใส่ราคาต่อชิ้นก่อน', 'err'); return; }
    const ok = confirm(`ลงขาย ${formatItemDisplayName(it)} x${n.qty}\nราคารวม ${fmtZ(n.total)} (${fmtZ(n.unit)}/ชิ้น) · ${market.form.hours} ชั่วโมง\nมัดจำ ${fmtZ(n.deposit)} · ขายได้รับ ${fmtZ(n.receive)}\n\nยืนยัน?`);
    if (!ok) return;
    const btn = market.el.querySelector('.im-mk-sell button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังลงขาย...'; }
    const r = await api(`/api/profiles/${encodeURIComponent(bag.profileId)}/market`, {
      op: 'list', slot: it.slot, itemId: it.itemId, qty: n.qty, price: n.total, hours: Number(market.form.hours)
    });
    if (!r.success) toast(`❌ ${r.error || 'ลงขายไม่สำเร็จ'}`, 'err');
    else if (r.confirmed) toast(`✅ ลงขาย ${it.name} x${n.qty} ราคา ${fmtZ(n.total)} แล้ว`);
    else toast('ส่งคำสั่งลงขายแล้ว แต่ยังไม่เห็นไอเทมออกจากกระเป๋า — ตรวจที่ "ของที่ฉันขาย" ในเกม', 'warn');
    if (r.success) { bag.selected = null; market.cache.clear(); }
    await refreshBag();
    if (r.success) closeMarket();
    else renderMarketSellForm();
  }

  // ==========================================================================
  // PUBLIC API (called from app.js when the character window opens/closes)
  // ==========================================================================
  window.InvMarket = {
    open(profileId) {
      if (bag.profileId !== profileId) {
        bag.data = null;
        bag.selected = null;
        bag.query = '';
        closeMarket();
      }
      bag.profileId = profileId;
      const el = ensureBagPanel();
      if (!el) return;
      el.querySelector('[data-role="query"]').value = bag.query;
      el.querySelector('[data-role="grid"]').innerHTML = bag.data ? '' : '<div class="im-empty">⏳ กำลังโหลดกระเป๋า...</div>';
      if (bag.data) renderBag();
      refreshBag();
      clearInterval(bag.timer);
      bag.timer = setInterval(() => { if (!document.hidden) refreshBag(); }, 4000);
      setTimeout(syncBagHeight, 50);
    },
    close() {
      clearInterval(bag.timer);
      bag.timer = null;
      closeMarket();
    },
    refresh: refreshBag
  };
})();
