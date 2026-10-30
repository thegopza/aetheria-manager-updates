// manager/public/inventory_market.js — Left Halloween Exchange panel + Right Bag panel + Tab 4 Market Hub + Floating Market fallback.
// Depends on app.js globals: API_BASE, escapeHTML, gameAssetUrl, getRarityColor, formatItemDisplayName,
// renderItemStatGroups, getItemStatLabel, loadCharacterDetail, currentCharProfileId.
(function () {
  'use strict';

  // ==========================================================================
  // OPTION QUERY: "dex, matk>=5, melee dmg, atk%" -> random-option terms (affixes only)
  // ==========================================================================
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

  const CANDY_ICON_PATH = '/art/icons/items/halloween-candy.webp';
  const PUMPKIN_ICON_PATH = '/art/icons/items/golden-pumpkin.webp';

  const DEFAULT_WITCH_HAZEL_ITEMS = [
    { itemId: 90888, name: 'Halloween Box', type: 'Consumable', rarity: 'epic', icon: '/art/icons/items/halloween-box.webp', price: 0, bound: false, cost: [{ itemId: 90880, name: 'Halloween Candy', qty: 200, icon: CANDY_ICON_PATH }, { itemId: 90881, name: 'Golden Pumpkin', qty: 1, icon: PUMPKIN_ICON_PATH }], limit: { max: 10, perAccount: true, reset: 'Daily' }, desc: 'กล่องสุ่มฮาโลวีน (แลกเปลี่ยน/ตั้งขายตลาดกลางได้)' },
    { itemId: 90340, name: 'Enchant Rune', type: 'Enchantment', rarity: 'rare', icon: '/art/icons/items/greater-enchant-rune.webp', price: 0, bound: true, cost: [{ itemId: 90880, name: 'Halloween Candy', qty: 150, icon: CANDY_ICON_PATH }], limit: { max: 100, perAccount: true, reset: 'Weekly' }, desc: 'รูนสุ่มออปชั่นอุปกรณ์' },
    { itemId: 90341, name: 'Accessory Enchant Rune', type: 'Enchantment', rarity: 'epic', icon: '/art/icons/items/accessory-enchant-rune.webp', price: 0, bound: true, cost: [{ itemId: 90880, name: 'Halloween Candy', qty: 1000, icon: CANDY_ICON_PATH }, { itemId: 90881, name: 'Golden Pumpkin', qty: 1, icon: PUMPKIN_ICON_PATH }], limit: { max: 10, perAccount: true, reset: 'Weekly' }, desc: 'รูนสุ่มออปชั่นเครื่องประดับ' },
    { itemId: 90889, name: 'Socket Charm', type: 'Enchantment', rarity: 'legendary', icon: '/art/icons/items/socket-charm.webp', price: 0, bound: true, cost: [{ itemId: 90880, name: 'Halloween Candy', qty: 5000, icon: CANDY_ICON_PATH }, { itemId: 90881, name: 'Golden Pumpkin', qty: 30, icon: PUMPKIN_ICON_PATH }], limit: { max: 2, perAccount: true, reset: 'Weekly' }, desc: 'ยันต์เจาะรูอุปกรณ์การันตีสำเร็จ 100%' },
    { itemId: 90206, name: 'Enriched Elunium', type: 'Enchantment', rarity: 'epic', icon: '/art/icons/items/enriched-elunium.webp', price: 0, bound: true, cost: [{ itemId: 90880, name: 'Halloween Candy', qty: 300, icon: CANDY_ICON_PATH }], limit: { max: 5, perAccount: true, reset: 'None' }, desc: 'แร่อีลูเนียมบริสุทธิ์ เพิ่มโอกาสตีบวกชุดเกราะ' },
    { itemId: 90886, name: 'Halloween Pecopeco Hairband', type: 'Equipment', equipType: 'Helmet', rarity: 'epic', icon: '/art/icons/items/pecopeco-hairband.webp', price: 5000000, bound: true, cost: [{ itemId: 90880, name: 'Halloween Candy', qty: 2000, icon: CANDY_ICON_PATH }, { itemId: 90881, name: 'Golden Pumpkin', qty: 15, icon: PUMPKIN_ICON_PATH }], limit: { max: 1, perAccount: true, reset: 'None' }, desc: 'หมวกคาดผมเปโกะฮาโลวีน (Move Speed +5%)' },
    { itemId: 90887, name: 'Halloween Snake Head', type: 'Equipment', equipType: 'Helmet', rarity: 'epic', icon: '/art/icons/items/coiled-snake-hat.webp', price: 5000000, bound: true, cost: [{ itemId: 90880, name: 'Halloween Candy', qty: 2000, icon: CANDY_ICON_PATH }, { itemId: 90881, name: 'Golden Pumpkin', qty: 15, icon: PUMPKIN_ICON_PATH }], limit: { max: 1, perAccount: true, reset: 'None' }, desc: 'หมวกงูฮาโลวีน (Double Attack +10%)' },
    { itemId: 90882, name: 'Pumpkin Head Hat', type: 'Equipment', equipType: 'CostumeHeadTop', rarity: 'rare', icon: '/art/icons/items/pumpkin-head-hat.webp', price: 0, bound: true, cost: [], limit: { max: 1, perAccount: true, reset: 'None' }, desc: 'คอสตูมหมวกหัวฟักทองฮาโลวีน (รับฟรี)' },
    { itemId: 90885, name: 'Pumpkin Imp Egg', type: 'Consumable', rarity: 'rare', icon: '/art/icons/items/pumpkin-imp-egg.webp', price: 0, bound: true, cost: [{ itemId: 90880, name: 'Halloween Candy', qty: 200, icon: CANDY_ICON_PATH }, { itemId: 90881, name: 'Golden Pumpkin', qty: 2, icon: PUMPKIN_ICON_PATH }], limit: { max: 1, perAccount: true, reset: 'None' }, desc: 'ไข่สัตว์เลี้ยงภูตฟักทองฮาโลวีน' },
    { itemId: 90203, name: 'Oridecon', type: 'Enchantment', rarity: 'uncommon', icon: '/art/icons/items/oridecon.webp', price: 0, bound: true, cost: [{ itemId: 90880, name: 'Halloween Candy', qty: 30, icon: CANDY_ICON_PATH }], limit: { max: 500, perAccount: true, reset: 'Weekly' }, desc: 'แร่ตีบวกอาวุธ' },
    { itemId: 90205, name: 'Elunium', type: 'Enchantment', rarity: 'uncommon', icon: '/art/icons/items/elunium.webp', price: 0, bound: true, cost: [{ itemId: 90880, name: 'Halloween Candy', qty: 30, icon: CANDY_ICON_PATH }], limit: { max: 500, perAccount: true, reset: 'Weekly' }, desc: 'แร่ตีบวกชุดเกราะ' },
    { itemId: 90351, name: 'Fury Potion', type: 'Consumable', rarity: 'rare', icon: '/art/icons/items/fury-potion.webp', price: 0, bound: true, cost: [{ itemId: 90880, name: 'Halloween Candy', qty: 40, icon: CANDY_ICON_PATH }], limit: { max: 5, perAccount: true, reset: 'Daily' }, desc: 'ยาเพิ่มพลังโจมตีกายภาพ (ATK +25, Melee DMG +5%)' },
    { itemId: 90352, name: 'Arcane Potion', type: 'Consumable', rarity: 'rare', icon: '/art/icons/items/arcane-potion.webp', price: 0, bound: true, cost: [{ itemId: 90880, name: 'Halloween Candy', qty: 40, icon: CANDY_ICON_PATH }], limit: { max: 5, perAccount: true, reset: 'Daily' }, desc: 'ยาเพิ่มพลังโจมตีเวท (MATK +25, Magic DMG +5%)' },
    { itemId: 90353, name: 'Keen Eye Potion', type: 'Consumable', rarity: 'rare', icon: '/art/icons/items/keen-eye-potion.webp', price: 0, bound: true, cost: [{ itemId: 90880, name: 'Halloween Candy', qty: 40, icon: CANDY_ICON_PATH }], limit: { max: 5, perAccount: true, reset: 'Daily' }, desc: 'ยาเพิ่มความแม่นยำและระยะไกล (HIT +20, Ranged DMG +5%)' }
  ];

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
    if (!ts) return '--';
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
  // MAIN-SCREEN LEFT DRAWER: HALLOWEEN EXCHANGE (NPC WITCH HAZEL)
  // ==========================================================================
  const hw = {
    open: false,
    pollTimer: null,
    profileId: 'all',   // 'all' or specific profile.id
    enabled: true,
    rules: {},          // itemId -> { enabled: boolean, minQty: number }
    catalog: DEFAULT_WITCH_HAZEL_ITEMS,
    clients: [],
    quotaState: {},
    bagCounts: { 90880: 0, 90881: 0 },
    zeny: 0,
    filter: 'all',      // 'all' | 'selected' | 'ready'
    loading: false,
    saving: false,
    tabEl: null,
    scrimEl: null,
    el: null
  };

  function getHwLimitLabel(limit) {
    if (!limit || !limit.max) return 'ไม่จำกัด';
    const rs = String(limit.reset || '').toLowerCase();
    const r = rs === 'daily' ? '/วัน' : rs === 'weekly' ? '/สัปดาห์' : ' ครั้ง (ถาวร)';
    return `จำกัด ${limit.max}${r}`;
  }

  function calcHwMaxExchangeable(item) {
    let maxByMat = 9999;
    const costs = Array.isArray(item.cost) ? item.cost : [];
    for (const c of costs) {
      const have = Number(hw.bagCounts[c.itemId] || 0);
      const need = Math.max(1, Number(c.qty ?? c.amount) || 1);
      maxByMat = Math.min(maxByMat, Math.floor(have / need));
    }
    const price = Number(item.price) || 0;
    const maxByZeny = price > 0 ? Math.floor((Number(hw.zeny) || 0) / price) : 9999;
    const maxLimit = item.limit && item.limit.max ? Number(item.limit.max) : 9999;
    const qEntry = hw.quotaState && hw.quotaState[item.itemId];
    const quotaLeft = (qEntry && typeof qEntry.limitLeft === 'number') ? qEntry.limitLeft : maxLimit;
    const rawAffordable = Math.max(0, Math.min(maxByMat, maxByZeny, maxLimit));
    const cappedByQuota = Math.max(0, Math.min(rawAffordable, quotaLeft));
    return { rawAffordable, cappedByQuota, quotaLeft, maxLimit };
  }

  function syncHwDisplayedStats() {
    const onlineClients = (hw.clients || []).filter(c => c && c.online);
    const chosen = hw.profileId && hw.profileId !== 'all'
      ? (hw.clients || []).find(c => c && c.id === hw.profileId)
      : null;

    if (chosen && chosen.online) {
      hw.bagCounts[90880] = Number(chosen.candy) || 0;
      hw.bagCounts[90881] = Number(chosen.pumpkin) || 0;
      hw.zeny = Number(chosen.zeny) || 0;
      hw.quotaState = chosen.quotaState || {};
      return;
    }

    if (onlineClients.length > 0) {
      // When "all" is selected, sum materials across online screens (or show the active screen if 1)
      let totalCandy = 0, totalPumpkin = 0, totalZeny = 0;
      for (const c of onlineClients) {
        totalCandy += Number(c.candy) || 0;
        totalPumpkin += Number(c.pumpkin) || 0;
        totalZeny += Number(c.zeny) || 0;
      }
      hw.bagCounts[90880] = totalCandy;
      hw.bagCounts[90881] = totalPumpkin;
      hw.zeny = totalZeny;
      hw.quotaState = onlineClients[0].quotaState || {};
      return;
    }

    // Fallback to opened character bag if any
    if (bag.data && Array.isArray(bag.data.items)) {
      let candy = 0, pumpkin = 0;
      for (const it of bag.data.items) {
        const id = Number(it.itemId);
        const nm = String(it.name || '').trim().toLowerCase();
        if (id === 90880 || nm === 'halloween candy') candy += (Number(it.qty) || 0);
        else if (id === 90881 || nm === 'golden pumpkin') pumpkin += (Number(it.qty) || 0);
      }
      hw.bagCounts[90880] = candy;
      hw.bagCounts[90881] = pumpkin;
      if (typeof bag.data.zeny === 'number') hw.zeny = bag.data.zeny;
    }
  }

  function updateHwTabBadge() {
    const badge = document.getElementById('hw-tab-badge');
    if (!badge) return;
    const selectedCount = Object.values(hw.rules || {}).filter(r => r && r.enabled).length;
    badge.textContent = selectedCount > 0 ? String(selectedCount) : '';
  }

  function setHwDrawerOpen(v) {
    hw.open = Boolean(v);
    if (hw.open) {
      document.body.classList.remove('pt-open', 'pm-open', 'gd-open');
    }
    document.body.classList.toggle('hw-open', hw.open);
    clearInterval(hw.pollTimer);
    if (hw.open) {
      refreshHalloween();
      hw.pollTimer = setInterval(() => {
        if (!document.hidden) refreshHalloween();
      }, 5000);
    }
  }

  function ensureHalloweenPanel() {
    if (hw.el && hw.el.isConnected) return hw.el;

    // Remove any legacy panel that might have been inside #char-detail-modal
    const oldModalOverlay = document.getElementById('char-detail-modal');
    if (oldModalOverlay) {
      oldModalOverlay.classList.remove('has-hw');
      oldModalOverlay.querySelectorAll('.im-hw-panel').forEach(n => n.remove());
    }

    const tab = document.createElement('button');
    tab.className = 'hw-tab';
    tab.id = 'hw-tab';
    tab.type = 'button';
    tab.title = 'แลกของกิจกรรม Halloween (NPC Witch Hazel · เมืองหลวงโซลเฮเวน)';
    tab.setAttribute('aria-label', 'เปิดหน้าแลกของกิจกรรม Halloween');
    tab.innerHTML = `<span class="hw-tab-emoji">🎃</span><span class="hw-tab-badge" id="hw-tab-badge"></span>`;

    const scrim = document.createElement('div');
    scrim.className = 'hw-scrim';
    scrim.id = 'hw-scrim';

    const el = document.createElement('aside');
    el.className = 'hw-drawer im-hw-panel';
    el.id = 'hw-drawer';
    el.setAttribute('aria-label', 'แลกของกิจกรรม Halloween');
    el.innerHTML = `
      <div class="im-hw-head">
        <div class="im-hw-title-wrap">
          <div class="im-hw-title">🎃 แลกของ Halloween</div>
          <div class="im-hw-sub">NPC Witch Hazel · เมืองหลวงโซลเฮเวน</div>
        </div>
        <div class="im-hw-head-right">
          <label class="im-hw-master-toggle" title="เปิด/ปิด ให้บอทเดินไปแลกของกับ Witch Hazel อัตโนมัติเมื่อของในตัวครบตามจำนวนที่ตั้ง">
            <input type="checkbox" data-hw="master-toggle" checked>
            <span>ออโต้แลก</span>
          </label>
          <button type="button" class="im-icon-btn" data-hw="refresh" title="รีเฟรชข้อมูลแลกของ">⟳</button>
          <button type="button" class="im-icon-btn close" data-hw="close" title="ปิดหน้าต่าง">✕</button>
        </div>
      </div>

      <div class="im-hw-client-bar">
        <label class="im-hw-client-lbl" for="hw-client-select">🖥️ จอเป้าหมาย:</label>
        <select id="hw-client-select" class="im-hw-client-select" data-hw="client-select">
          <option value="all">🌐 ทุกจอออนไลน์ (ซิงค์พร้อมกัน)</option>
        </select>
      </div>

      <div class="im-hw-mats" data-role="hw-mats">
        <div class="im-hw-mat">
          <img src="${esc(gameAssetUrl(CANDY_ICON_PATH))}" alt="">
          <div><small>Candy</small><b data-role="hw-candy">0</b></div>
        </div>
        <div class="im-hw-mat">
          <img src="${esc(gameAssetUrl(PUMPKIN_ICON_PATH))}" alt="">
          <div><small>Pumpkin</small><b data-role="hw-pumpkin">0</b></div>
        </div>
        <div class="im-hw-mat zeny">
          <span>💰</span>
          <div><small>Zeny</small><b data-role="hw-zeny">0</b></div>
        </div>
      </div>

      <div class="im-hw-wl-banner">
        🛡️ <b>กันขาย NPC อัตโนมัติ:</b> รายการที่ติ๊กเลือก (รวม Candy & Pumpkin) จะอยู่ใน <b>WL ห้ามขายลง NPC</b> แต่สามารถตั้งขายลง<b>ตลาดกลาง</b>ได้ตามปกติ
      </div>

      <div class="im-hw-actions-bar">
        <button type="button" class="im-btn hw-go" data-hw="exchange-now" title="สั่งบอทเดินไปหา Witch Hazel เพื่อแลกของที่ครบเงื่อนไขทันที">⚡ เดินไปแลกทันที</button>
        <button type="button" class="im-btn ghost sm" data-hw="apply-all" title="คัดลอกรายการที่เลือกและจำนวนขั้นต่ำไปใช้กับทุกจอทันที">📋 ใช้กับทุกจอ</button>
      </div>

      <div class="im-hw-tabs" data-role="hw-tabs"></div>
      <div class="im-hw-list" data-role="hw-list"></div>`;

    document.body.append(tab, scrim, el);

    tab.addEventListener('click', () => setHwDrawerOpen(!hw.open));
    scrim.addEventListener('click', () => setHwDrawerOpen(false));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && hw.open) setHwDrawerOpen(false);
    });

    el.addEventListener('click', onHwClick);
    el.addEventListener('change', onHwChange);

    hw.tabEl = tab;
    hw.scrimEl = scrim;
    hw.el = el;
    renderHalloweenPanel();
    return el;
  }

  async function refreshHalloween() {
    if (hw.loading) return;
    hw.loading = true;
    try {
      const data = await api('/api/halloween');
      if (data && data.success) {
        if (Array.isArray(data.catalog) && data.catalog.length) hw.catalog = data.catalog;
        if (Array.isArray(data.clients)) hw.clients = data.clients;
        const cfg = data.config || {};
        hw.enabled = cfg.enabled !== false;
        hw.rules = cfg.rules && typeof cfg.rules === 'object' ? cfg.rules : {};
        syncHwDisplayedStats();
        updateHwTabBadge();
        renderHalloweenPanel();
      }
    } finally {
      hw.loading = false;
    }
  }

  let hwSaveTimer = null;
  function scheduleSaveHalloween(immediate = false) {
    clearTimeout(hwSaveTimer);
    if (immediate) return saveHalloweenConfig();
    hwSaveTimer = setTimeout(saveHalloweenConfig, 280);
  }

  async function saveHalloweenConfig() {
    hw.saving = true;
    updateHwTabBadge();
    try {
      const r = await api('/api/halloween', {
        op: 'save',
        profileId: hw.profileId || 'all',
        enabled: hw.enabled,
        rules: hw.rules
      });
      if (!r || !r.success) {
        toast(`❌ บันทึกตั้งค่า Halloween ไม่สำเร็จ: ${(r && r.error) || ''}`, 'err');
      }
    } finally {
      hw.saving = false;
    }
  }

  function renderHalloweenPanel() {
    const el = hw.el;
    if (!el) return;
    syncHwDisplayedStats();
    updateHwTabBadge();

    const masterCb = el.querySelector('[data-hw="master-toggle"]');
    if (masterCb && document.activeElement !== masterCb) masterCb.checked = hw.enabled !== false;

    const selectEl = el.querySelector('[data-hw="client-select"]');
    if (selectEl && document.activeElement !== selectEl) {
      const onlineCount = (hw.clients || []).filter(c => c && c.online).length;
      const opts = [
        `<option value="all" ${hw.profileId === 'all' ? 'selected' : ''}>🌐 ทุกจอออนไลน์ (${onlineCount} จอ)</option>`
      ];
      (hw.clients || []).forEach(c => {
        const label = c.charName ? `${c.name} (${c.charName})` : c.name;
        const statusTxt = c.online
          ? `🍬 ${(c.candy || 0).toLocaleString()} · 🎃 ${(c.pumpkin || 0).toLocaleString()}`
          : 'ออฟไลน์';
        opts.push(`<option value="${esc(c.id)}" ${hw.profileId === c.id ? 'selected' : ''}>${esc(label)} — ${esc(statusTxt)}</option>`);
      });
      selectEl.innerHTML = opts.join('');
    }

    const candyEl = el.querySelector('[data-role="hw-candy"]');
    const pumpEl = el.querySelector('[data-role="hw-pumpkin"]');
    const zenyEl = el.querySelector('[data-role="hw-zeny"]');
    if (candyEl) candyEl.textContent = Number(hw.bagCounts[90880] || 0).toLocaleString();
    if (pumpEl) pumpEl.textContent = Number(hw.bagCounts[90881] || 0).toLocaleString();
    if (zenyEl) zenyEl.textContent = fmtShort(hw.zeny || 0);

    const items = hw.catalog || DEFAULT_WITCH_HAZEL_ITEMS;
    let selectedCount = 0;
    let readyCount = 0;
    items.forEach(it => {
      const r = hw.rules[it.itemId] || {};
      const calc = calcHwMaxExchangeable(it);
      const minQty = Math.max(1, Number(r.minQty) || 1);
      if (r.enabled) selectedCount++;
      if (calc.cappedByQuota >= minQty) readyCount++;
    });

    const tabsEl = el.querySelector('[data-role="hw-tabs"]');
    if (tabsEl) {
      const tabs = [
        ['all', `ทั้งหมด (${items.length})`],
        ['selected', `เลือกแลก (${selectedCount})`],
        ['ready', `ของพอแลก (${readyCount})`]
      ];
      tabsEl.innerHTML = tabs.map(([k, lbl]) =>
        `<button type="button" class="im-hw-tab ${hw.filter === k ? 'active' : ''}" data-hw-tab="${k}">${lbl}</button>`
      ).join('');
    }

    const visible = items.filter(it => {
      const r = hw.rules[it.itemId] || {};
      const calc = calcHwMaxExchangeable(it);
      const minQty = Math.max(1, Number(r.minQty) || 1);
      if (hw.filter === 'selected') return Boolean(r.enabled);
      if (hw.filter === 'ready') return calc.cappedByQuota >= minQty;
      return true;
    });

    const listEl = el.querySelector('[data-role="hw-list"]');
    if (!listEl) return;

    if (visible.length === 0) {
      listEl.innerHTML = `<div class="im-empty">${hw.filter === 'selected' ? '🎃 ยังไม่ได้ติ๊กเลือกไอเทมที่จะแลก — คลิกติ๊กหน้าไอเทมที่ต้องการด้านล่างได้เลย' : '🔍 ไม่มีรายการในหมวดนี้'}</div>`;
      return;
    }

    listEl.innerHTML = visible.map(it => {
      const rule = hw.rules[it.itemId] || { enabled: false, minQty: 1 };
      const isSelected = Boolean(rule.enabled);
      const minQty = Math.max(1, Number(rule.minQty) || 1);
      const calc = calcHwMaxExchangeable(it);
      const isReady = calc.cappedByQuota >= minQty && calc.quotaLeft > 0;
      const quotaExhausted = calc.quotaLeft <= 0;

      // Render cost chips
      const costChips = [];
      (it.cost || []).forEach(c => {
        const have = Number(hw.bagCounts[c.itemId] || 0);
        const unitNeed = Math.max(1, Number(c.qty ?? c.amount) || 1);
        const totalNeed = unitNeed * minQty;
        const enough = have >= totalNeed;
        const shortName = c.itemId === 90880 ? 'Candy' : c.itemId === 90881 ? 'Pumpkin' : c.name;
        const iconUrl = c.icon || (c.itemId === 90880 ? CANDY_ICON_PATH : c.itemId === 90881 ? PUMPKIN_ICON_PATH : '');
        costChips.push(`
          <span class="im-hw-cost ${enough ? 'ok' : 'lack'}" title="ใช้ ${c.name} ${unitNeed} ชิ้นต่อการแลก 1 ครั้ง (มีในกระเป๋า ${have.toLocaleString()} ชิ้น)">
            ${iconUrl ? `<img src="${esc(gameAssetUrl(iconUrl))}" alt="">` : ''}
            <b>${unitNeed.toLocaleString()}</b> ${esc(shortName)}
          </span>`);
      });
      if (Number(it.price) > 0) {
        const enoughZ = (Number(hw.zeny) || 0) >= Number(it.price) * minQty;
        costChips.push(`<span class="im-hw-cost ${enoughZ ? 'ok' : 'lack'}" title="ใช้เงิน ${Number(it.price).toLocaleString()} z ต่อชิ้น">💰 <b>${fmtShort(it.price)}</b> z</span>`);
      }
      if (costChips.length === 0) {
        costChips.push(`<span class="im-hw-cost ok">🎁 <b>รับฟรี (0 z)</b></span>`);
      }

      let statusHtml = '';
      if (quotaExhausted) {
        statusHtml = `<span class="im-hw-state full">🔴 โควต้าเต็ม (0/${calc.maxLimit})</span>`;
      } else if (isReady) {
        statusHtml = `<span class="im-hw-state ready">🟢 แลกได้ ${calc.cappedByQuota} ชิ้น</span>`;
      } else {
        statusHtml = `<span class="im-hw-state wait">⏳ พอแลก ${calc.cappedByQuota}/${minQty}</span>`;
      }

      const quotaBadge = (hw.quotaState && hw.quotaState[it.itemId] && typeof hw.quotaState[it.itemId].limitLeft === 'number')
        ? `${getHwLimitLabel(it.limit)} · เหลือ ${hw.quotaState[it.itemId].limitLeft}/${calc.maxLimit}`
        : getHwLimitLabel(it.limit);

      return `
        <div class="im-hw-card ${isSelected ? 'selected' : ''} ${isReady && isSelected ? 'ready-glow' : ''}" data-item-id="${it.itemId}">
          <div class="im-hw-card-top">
            <label class="im-hw-check-wrap" title="คลิกเพื่อเลือก/ยกเลิกการแลกอัตโนมัติ (เมื่อเลือกจะเพิ่มเข้า WL ห้ามขาย NPC อัตโนมัติ)">
              <input type="checkbox" data-hw-check="${it.itemId}" ${isSelected ? 'checked' : ''}>
            </label>
            <div class="im-hw-icon-box" style="--rc: ${getRarityColor(it.rarity)};" data-hw-toggle-card="${it.itemId}">
              <img src="${esc(gameAssetUrl(it.icon))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
            </div>
            <div class="im-hw-info" data-hw-toggle-card="${it.itemId}">
              <div class="im-hw-name-row">
                <span class="im-hw-name" style="color: ${getRarityColor(it.rarity)};">${esc(it.name)}</span>
                ${!it.bound
                  ? `<span class="im-hw-tag tradable" title="แลกมาแล้วไม่ติดตัว สามารถตั้งขายลงตลาดกลางได้">🏪 ขายตลาดได้</span>`
                  : `<span class="im-hw-tag bound" title="ไอเทมผูกมัดตัวละคร">🔒 ติดตัว</span>`}
                ${isSelected ? `<span class="im-hw-tag wl" title="อยู่ใน Whitelist ห้ามขายให้ NPC">🛡️ WL</span>` : ''}
              </div>
              <div class="im-hw-desc">${esc(it.desc || '')}</div>
              <div class="im-hw-costs-row">
                ${costChips.join('')}
                <span class="im-hw-limit">${esc(quotaBadge)}</span>
              </div>
            </div>
          </div>

          <div class="im-hw-cond-row">
            <div class="im-hw-cond-left">
              <span>แลกครบ ≥</span>
              <div class="im-hw-qty-box">
                <button type="button" class="im-hw-step" data-hw-step="-1" data-item-id="${it.itemId}">−</button>
                <input type="number" class="im-hw-qty-input" data-hw-minqty="${it.itemId}" min="1" max="${it.limit?.max || 500}" value="${minQty}">
                <button type="button" class="im-hw-step" data-hw-step="1" data-item-id="${it.itemId}">+</button>
              </div>
              <span>ชิ้น</span>
            </div>
            <div class="im-hw-cond-right">
              ${statusHtml}
              ${!it.bound ? `<button type="button" class="im-btn ghost xs" data-hw-autosell="${esc(it.name)}" title="ตั้งให้บอทนำ ${esc(it.name)} ไปลงขายตลาดกลางอัตโนมัติ">🏷️ Auto-Sell</button>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');
  }

  function ensureHwRule(itemId) {
    if (!hw.rules[itemId]) hw.rules[itemId] = { enabled: false, minQty: 1 };
    return hw.rules[itemId];
  }

  async function onHwClick(e) {
    const tabBtn = e.target.closest('[data-hw-tab]');
    if (tabBtn) {
      hw.filter = tabBtn.dataset.hwTab;
      renderHalloweenPanel();
      return;
    }

    const toggleCard = e.target.closest('[data-hw-toggle-card]');
    if (toggleCard && !e.target.closest('button, input, label')) {
      const id = Number(toggleCard.dataset.hwToggleCard);
      const r = ensureHwRule(id);
      r.enabled = !r.enabled;
      if (r.enabled && (!r.minQty || r.minQty < 1)) r.minQty = 1;
      renderHalloweenPanel();
      scheduleSaveHalloween(true);
      const it = (hw.catalog || DEFAULT_WITCH_HAZEL_ITEMS).find(x => x.itemId === id);
      if (it) {
        toast(r.enabled
          ? `🎃 เลือกแลก "${it.name}" (ครบ ≥ ${r.minQty} ชิ้น) + เพิ่มเข้า WL กันขาย NPC แล้ว`
          : `ยกเลิกแลก "${it.name}" อัตโนมัติแล้ว`);
      }
      return;
    }

    const stepBtn = e.target.closest('[data-hw-step]');
    if (stepBtn) {
      const id = Number(stepBtn.dataset.itemId);
      const delta = Number(stepBtn.dataset.hwStep) || 0;
      const it = (hw.catalog || DEFAULT_WITCH_HAZEL_ITEMS).find(x => x.itemId === id);
      const maxLim = (it && it.limit && it.limit.max) ? it.limit.max : 500;
      const r = ensureHwRule(id);
      r.minQty = Math.max(1, Math.min(maxLim, (Number(r.minQty) || 1) + delta));
      r.enabled = true; // stepping quantity automatically enables the item
      renderHalloweenPanel();
      scheduleSaveHalloween();
      return;
    }

    const autoSellBtn = e.target.closest('[data-hw-autosell]');
    if (autoSellBtn) {
      const name = autoSellBtn.dataset.hwAutosell;
      if (!name) return;
      const ans = prompt(`ลงขาย "${name}" ในตลาดกลางอัตโนมัติ เมื่อมีในกระเป๋าครบกี่ชิ้น?`, '1');
      if (ans === null) return;
      const minQty = Math.max(1, parseInt(ans, 10) || 1);
      const r = await api('/api/halloween', {
        op: 'autosell',
        profileId: hw.profileId || 'all',
        itemName: name,
        minQty
      });
      if (r && r.success) {
        toast(`🏷️ ตั้ง Auto-Sell "${name}" (ครบ ≥ ${minQty} ชิ้น) เรียบร้อยแล้ว (${r.appliedOnline || 0} จอ)`);
      } else {
        toast(`❌ ตั้ง Auto-Sell ไม่สำเร็จ: ${(r && r.error) || ''}`, 'err');
      }
      return;
    }

    const actBtn = e.target.closest('[data-hw]');
    if (!actBtn) return;
    const act = actBtn.dataset.hw;
    if (act === 'close') {
      setHwDrawerOpen(false);
      return;
    }
    if (act === 'refresh') {
      await refreshHalloween();
      toast('🎃 รีเฟรชข้อมูลกิจกรรม Halloween แล้ว');
      return;
    }
    if (act === 'exchange-now') {
      const activeCount = Object.values(hw.rules).filter(r => r && r.enabled).length;
      if (activeCount === 0) {
        toast('⚠️ กรุณาติ๊กเลือกรายการของรางวัล Halloween ที่ต้องการแลกอย่างน้อย 1 รายการก่อนครับ', 'warn');
        return;
      }
      actBtn.disabled = true;
      const origTxt = actBtn.textContent;
      actBtn.textContent = '⏳ กำลังสั่งแลก...';
      try {
        const r = await api('/api/halloween', {
          op: 'exchange_now',
          profileId: hw.profileId || 'all',
          enabled: true,
          rules: hw.rules
        });
        if (r && r.success) {
          toast(`🎃 ${r.summary || 'สั่งบอทเดินไปแลกของกับ Witch Hazel แล้ว!'}`);
          setTimeout(() => { refreshHalloween(); }, 2500);
        } else {
          toast(`❌ สั่งแลกไม่สำเร็จ: ${(r && r.error) || 'จอเกมไม่ตอบ'}`, 'err');
        }
      } finally {
        actBtn.disabled = false;
        actBtn.textContent = origTxt;
      }
      return;
    }
    if (act === 'apply-all') {
      actBtn.disabled = true;
      try {
        const r = await api('/api/halloween', {
          op: 'apply_all',
          enabled: hw.enabled,
          rules: hw.rules
        });
        if (r && r.success) {
          toast(`📋 ซิงค์ตั้งค่า Halloween + WL กันขาย NPC ไปยังทุกโปรไฟล์แล้ว (อัปเดตออนไลน์ ${r.appliedOnline || 0} จอ)`);
        } else {
          toast(`❌ ซิงค์ไม่สำเร็จ: ${(r && r.error) || ''}`, 'err');
        }
      } finally {
        actBtn.disabled = false;
      }
    }
  }

  function onHwChange(e) {
    if (e.target.dataset.hw === 'client-select') {
      hw.profileId = e.target.value || 'all';
      renderHalloweenPanel();
      return;
    }
    if (e.target.dataset.hw === 'master-toggle') {
      hw.enabled = Boolean(e.target.checked);
      scheduleSaveHalloween(true);
      toast(hw.enabled ? '🎃 เปิดระบบเดินไปแลกของ Halloween อัตโนมัติแล้ว' : '⏸️ ปิดระบบแลกของ Halloween อัตโนมัติชั่วคราว');
      return;
    }
    if (e.target.dataset.hwCheck) {
      const id = Number(e.target.dataset.hwCheck);
      const r = ensureHwRule(id);
      r.enabled = Boolean(e.target.checked);
      if (r.enabled && (!r.minQty || r.minQty < 1)) r.minQty = 1;
      renderHalloweenPanel();
      scheduleSaveHalloween(true);
      const it = (hw.catalog || DEFAULT_WITCH_HAZEL_ITEMS).find(x => x.itemId === id);
      if (it) {
        toast(r.enabled
          ? `🎃 เลือกแลก "${it.name}" (ครบ ≥ ${r.minQty} ชิ้น) + เพิ่มเข้า WL กันขาย NPC แล้ว`
          : `ยกเลิกแลก "${it.name}" อัตโนมัติแล้ว`);
      }
      return;
    }
    if (e.target.dataset.hwMinqty) {
      const id = Number(e.target.dataset.hwMinqty);
      const it = (hw.catalog || DEFAULT_WITCH_HAZEL_ITEMS).find(x => x.itemId === id);
      const maxLim = (it && it.limit && it.limit.max) ? it.limit.max : 500;
      const r = ensureHwRule(id);
      r.minQty = Math.max(1, Math.min(maxLim, parseInt(e.target.value, 10) || 1));
      r.enabled = true;
      e.target.value = r.minQty;
      renderHalloweenPanel();
      scheduleSaveHalloween(true);
    }
  }

  // ==========================================================================
  // BAG PANEL (docked on the RIGHT side of the character window)
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
    syncSidePanelHeights();
    return el;
  }

  // Keep Right (Bag) panel as tall as the center character card
  let resizeObs = null;
  function syncSidePanelHeights() {
    const card = document.querySelector('#char-detail-modal .char-modal-card');
    if (!card) return;
    const apply = () => {
      const h = card.offsetHeight;
      if (h > 200) {
        if (bag.el) bag.el.style.height = `${h}px`;
      }
    };
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
        if (hw.el) renderHalloweenPanel();
        if (hub.el && isMarketTabActive() && hub.subTab === 'sell') {
          renderHubSellStrip();
        }
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
    if ((market.open || isMarketTabActive()) && sel && market.item && market.item.slot === sel.slot && market.item.itemId === sel.itemId) {
      market.item = sel;
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
          <div class="im-detail-name" style="color: ${getRarityColor(item.rarity)};">${esc(formatItemDisplayName(item))}${item.locked ? ' 🔒' : ''}${item.bound ? ' <small class="im-bound-lbl">(ติดตัว)</small>' : ''}</div>
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
    toast(`🏷️ เพิ่ม "${name}" เข้า Auto Sell แล้ว (ครบ ≥ ${minQty} ชิ้น)${out.enabled ? '' : ' — ระบบ Auto Sell ยังปิดอยู่ เปิดได้ที่แท็บ Auto Sell ตลาดกลาง'}`);
    refreshAutoSellHub();
  }

  function isMarketTabActive() {
    const view = document.getElementById('char-market-view');
    return Boolean(view && view.style.display !== 'none');
  }

  async function onBagClick(e) {
    const tabBtn = e.target.closest('.im-tab');
    if (tabBtn) { bag.tab = tabBtn.dataset.tab; renderBag(); return; }

    const cell = e.target.closest('.im-cell');
    if (cell) {
      bag.selected = { slot: Number(cell.dataset.slot), itemId: Number(cell.dataset.item) };
      renderBag();
      const item = selectedBagItem();
      if (item && (market.open || (isMarketTabActive() && hub.subTab === 'sell'))) {
        openMarketFor(item, { preferTab: isMarketTabActive() });
      }
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
    if (act === 'market') return openMarketFor(item, { preferTab: true });
  }

  // ==========================================================================
  // TAB 4: MARKETPLACE HUB (INSIDE #char-market-view) + FLOATING WINDOW
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
    optText: '',
    reqToken: 0,
    cache: new Map(),
    form: { qty: 1, unit: '', hours: 24 }
  };

  const hub = {
    el: null,
    subTab: 'sell',        // 'sell' | 'autosell' | 'active' | 'deliveries' | 'browse'
    mine: null,            // { active: [], closed: [], deliveries: [], activeLimit: 8 }
    mineLoading: false,
    autoSell: {
      loading: false,
      saving: false,
      offline: false,
      config: { enabled: false, priceStrategy: 'median', rules: [] },
      ruleStates: {},
      activeCount: 0,
      maxListings: 8,
      bagItemsSummary: [],
      otherProfiles: [],
      filterQ: '',
      filterStatus: 'all', // 'all' | 'ready' | 'inbag' | 'empty'
      newName: '',
      newMin: 10,
      newMode: 'all',
      copyOpen: false,
      copyMode: 'replace', // 'replace' | 'merge'
      copyEnabled: true,
      copyTargetIds: new Set(),
      copyFilterQ: ''
    },
    browse: {
      q: '',
      category: 'all',
      optText: '',
      sort: 'price_asc',
      loading: false,
      results: null
    }
  };

  function marketHostEl() {
    if (isMarketTabActive() && hub.el) {
      const sellPane = hub.el.querySelector('[data-hub-pane="sell"]');
      if (sellPane) return sellPane;
    }
    return market.el;
  }

  function marketOptQuery() {
    const parsed = parseOptionQuery(market.optText);
    const lead = parsed.terms.slice().sort((a, b) => b.min - a.min)[0] || null;
    return { terms: parsed.terms, lead };
  }

  function ensureMarketHub() {
    const container = document.getElementById('char-market-view');
    if (!container) return null;
    if (hub.el && hub.el.isConnected && container.contains(hub.el)) return hub.el;

    container.innerHTML = `
      <div class="im-hub">
        <!-- SUB-TABS BAR -->
        <div class="im-hub-nav">
          <div class="im-hub-tabs">
            <button type="button" class="im-hub-tab active" data-hub-tab="sell">
              <span>🏷️</span> ลงขายไอเทม
            </button>
            <button type="button" class="im-hub-tab" data-hub-tab="autosell">
              <span>🤖</span> Auto Sell ตลาดกลาง <span class="im-hub-pill" data-role="hub-autosell-count">0</span>
            </button>
            <button type="button" class="im-hub-tab" data-hub-tab="active">
              <span>📦</span> ของที่ลงขายอยู่ <span class="im-hub-pill" data-role="hub-active-count">0</span>
            </button>
            <button type="button" class="im-hub-tab" data-hub-tab="deliveries">
              <span>📬</span> รับของ / รับเงิน <span class="im-hub-pill warn" data-role="hub-deliv-count" style="display:none;">0</span>
            </button>
            <button type="button" class="im-hub-tab" data-hub-tab="browse">
              <span>🔍</span> ค้นหา / ซื้อของ
            </button>
          </div>
          <div class="im-hub-nav-right">
            <span class="im-hub-slot-info" data-role="hub-slot-info">ช่องวางขาย: --/--</span>
            <button type="button" class="im-btn ghost sm" data-hub-act="refresh-all" title="โหลดข้อมูลตลาดใหม่">⟳ รีเฟรชตลาด</button>
          </div>
        </div>

        <!-- PANE 1: SELL ITEM -->
        <div class="im-hub-pane" data-hub-pane="sell">
          <div class="im-hub-sell-strip-wrap">
            <span class="im-hub-strip-lbl">🎒 เลือกไอเทมจากกระเป๋าที่จะขาย:</span>
            <div class="im-hub-sell-strip" data-role="sell-strip"></div>
          </div>

          <div class="im-mk-selected-bar" data-role="title-bar">
            <div class="im-mk-title" data-role="title">🏪 คลิกเลือกไอเทมจากแถบด้านบน หรือจากกระเป๋าด้านขวาเพื่อดูราคาและลงขาย</div>
            <div class="im-mk-mine" data-role="mine"></div>
          </div>

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
                  <button type="button" data-range="7d" class="active">7 วัน</button>
                  <button type="button" data-range="30d">1 เดือน</button>
                </div>
              </div>
              <div data-role="history"></div>
            </section>
          </div>
          <form class="im-mk-sell" data-role="sell"></form>
        </div>

        <!-- PANE 1.5: AUTO SELL MARKET LIST & COPY TO OTHER PROFILES -->
        <div class="im-hub-pane" data-hub-pane="autosell" style="display:none;">
          <div data-role="autosell-root"></div>
        </div>

        <!-- PANE 2: MY ACTIVE & CLOSED LISTINGS -->
        <div class="im-hub-pane" data-hub-pane="active" style="display:none;">
          <div class="im-hub-summary-bar" data-role="active-summary"></div>
          <div class="im-hub-sec-title">📦 รายการที่กำลังวางขายอยู่ในตลาด</div>
          <div class="im-hub-table-wrap" data-role="active-list"></div>
          <div class="im-hub-sec-title" style="margin-top: 10px;">📜 ประวัติรายการที่ขายออก / หมดเวลาล่าสุด</div>
          <div class="im-hub-table-wrap" data-role="closed-list"></div>
        </div>

        <!-- PANE 3: DELIVERIES (CLAIM ITEMS & ZENY) -->
        <div class="im-hub-pane" data-hub-pane="deliveries" style="display:none;">
          <div class="im-hub-claim-banner" data-role="deliveries-banner"></div>
          <div class="im-hub-table-wrap" data-role="deliveries-list"></div>
        </div>

        <!-- PANE 4: BROWSE & BUY MARKET -->
        <div class="im-hub-pane" data-hub-pane="browse" style="display:none;">
          <div class="im-hub-browse-bar">
            <input type="text" class="im-input" data-browse="q" placeholder="พิมพ์ชื่อไอเทม เช่น Halloween Box, Elunium, Gakkung Bow..." autocomplete="off">
            <select class="im-select" data-browse="cat">
              <option value="all">หมวด: ทั้งหมด</option>
              <option value="Weapon">อาวุธ (Weapon)</option>
              <option value="Armor">ชุดเกราะ (Armor)</option>
              <option value="Accessory">เครื่องประดับ (Accessory)</option>
              <option value="Gem">เจม (Gem)</option>
              <option value="Card">การ์ด (Card)</option>
              <option value="Consumable">ของใช้ (Consumable)</option>
              <option value="Enchantment">แร่/รูนตีบวก (Refine)</option>
              <option value="Miscellaneous">วัตถุดิบ (Material)</option>
            </select>
            <input type="text" class="im-input" data-browse="opt" placeholder="กรองออฟชั่น เช่น dex>=5, atk%, crit" autocomplete="off">
            <select class="im-select" data-browse="sort">
              <option value="price_asc">ราคา/ชิ้น: ต่ำ → สูง</option>
              <option value="price_desc">ราคา/ชิ้น: สูง → ต่ำ</option>
              <option value="newest">เพิ่งลงขายล่าสุด</option>
            </select>
            <button type="button" class="im-btn market" data-browse="go">🔍 ค้นหา</button>
          </div>
          <div class="im-query-hint" data-role="browse-opt-hint"></div>
          <div class="im-hub-table-wrap" data-role="browse-list">
            <div class="im-empty">🔍 พิมพ์ชื่อไอเทมหรือเลือกหมวดหมู่แล้วกด "ค้นหา" เพื่อดูของในตลาดกลาง</div>
          </div>
        </div>
      </div>`;

    const el = container.firstElementChild;
    wireMarketSurfaceEvents(el);
    el.addEventListener('click', onHubClick);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.target.dataset.browse === 'q' || e.target.dataset.browse === 'opt')) {
        e.preventDefault();
        runBrowseSearch();
      }
      if (e.key === 'Enter' && (e.target.dataset.as === 'new-name' || e.target.dataset.as === 'new-min')) {
        e.preventDefault();
        addAutoSellRuleFromBar();
      }
    });
    el.addEventListener('input', e => {
      if (e.target.dataset.browse === 'q') hub.browse.q = e.target.value;
      if (e.target.dataset.browse === 'opt') {
        hub.browse.optText = e.target.value;
        renderBrowseOptHint();
        if (Array.isArray(hub.browse.results)) renderBrowseResults();
      }
      if (e.target.dataset.as === 'new-name') hub.autoSell.newName = e.target.value;
      if (e.target.dataset.as === 'new-min') hub.autoSell.newMin = Math.max(1, parseInt(e.target.value, 10) || 1);
      if (e.target.dataset.as === 'filter-q') {
        hub.autoSell.filterQ = e.target.value;
        renderAutoSellRulesOnly();
      }
      if (e.target.dataset.as === 'copy-filter') {
        hub.autoSell.copyFilterQ = e.target.value;
        renderAutoSellCopyGridOnly();
      }
      if (e.target.dataset.asRuleName) {
        const rid = e.target.dataset.asRuleName;
        const rule = (hub.autoSell.config.rules || []).find(r => r.id === rid);
        if (rule) {
          rule.itemName = e.target.value;
          scheduleSaveAutoSellHub();
        }
      }
      if (e.target.dataset.asRuleMin) {
        const rid = e.target.dataset.asRuleMin;
        const rule = (hub.autoSell.config.rules || []).find(r => r.id === rid);
        if (rule) {
          rule.minQty = Math.max(1, parseInt(e.target.value, 10) || 1);
          scheduleSaveAutoSellHub();
        }
      }
    });
    el.addEventListener('change', e => {
      if (e.target.dataset.browse === 'cat') { hub.browse.category = e.target.value; runBrowseSearch(); }
      if (e.target.dataset.browse === 'sort') { hub.browse.sort = e.target.value; renderBrowseResults(); }
      if (e.target.dataset.as === 'toggle-enabled') {
        hub.autoSell.config.enabled = Boolean(e.target.checked);
        saveAutoSellHub(true);
      }
      if (e.target.dataset.as === 'new-mode') {
        hub.autoSell.newMode = e.target.value === 'min' ? 'min' : 'all';
      }
      if (e.target.dataset.as === 'copy-mode') {
        hub.autoSell.copyMode = e.target.value === 'merge' ? 'merge' : 'replace';
      }
      if (e.target.dataset.as === 'copy-enabled') {
        hub.autoSell.copyEnabled = Boolean(e.target.checked);
      }
      if (e.target.dataset.asCopyTarget) {
        const tid = e.target.dataset.asCopyTarget;
        if (e.target.checked) hub.autoSell.copyTargetIds.add(tid);
        else hub.autoSell.copyTargetIds.delete(tid);
        updateAutoSellCopyFooterBtn();
      }
      if (e.target.dataset.asRuleMode) {
        const rid = e.target.dataset.asRuleMode;
        const rule = (hub.autoSell.config.rules || []).find(r => r.id === rid);
        if (rule) {
          rule.sellMode = e.target.value === 'min' ? 'min' : 'all';
          saveAutoSellHub(false);
        }
      }
    });
    hub.el = el;
    return el;
  }

  function wireMarketSurfaceEvents(el) {
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
    el.addEventListener('submit', e => {
      if (e.target.matches('[data-role="sell"]')) {
        e.preventDefault();
        submitListing();
      }
    });
  }

  function switchHubSubTab(subTab) {
    hub.subTab = subTab || 'sell';
    if (!hub.el) return;
    hub.el.querySelectorAll('[data-hub-tab]').forEach(b => b.classList.toggle('active', b.dataset.hubTab === hub.subTab));
    hub.el.querySelectorAll('[data-hub-pane]').forEach(p => {
      p.style.display = p.dataset.hubPane === hub.subTab ? '' : 'none';
    });
    if (hub.subTab === 'sell') {
      renderHubSellStrip();
      if (!market.item) {
        const sel = selectedBagItem();
        const firstTradable = sel && !sel.bound ? sel : (bag.data && Array.isArray(bag.data.items) ? bag.data.items.find(i => !i.bound) : null);
        if (firstTradable) {
          bag.selected = { slot: firstTradable.slot, itemId: firstTradable.itemId };
          renderBag();
          openMarketFor(firstTradable, { preferTab: true });
        } else {
          renderMarketHeader();
          renderListings();
          renderHistory();
          renderMarketSellForm();
        }
      } else {
        renderMarketHeader();
        renderListings();
        renderHistory();
        renderMarketSellForm();
      }
    } else if (hub.subTab === 'autosell') {
      refreshAutoSellHub();
    } else if (hub.subTab === 'active' || hub.subTab === 'deliveries') {
      refreshMineMarket();
    } else if (hub.subTab === 'browse') {
      if (hub.browse.results === null) runBrowseSearch();
    }
    setTimeout(syncSidePanelHeights, 50);
  }

  function renderHubSellStrip() {
    if (!hub.el) return;
    const strip = hub.el.querySelector('[data-role="sell-strip"]');
    if (!strip) return;
    const items = (bag.data && Array.isArray(bag.data.items))
      ? bag.data.items.filter(i => !i.bound).sort((a, b) => a.slot - b.slot)
      : [];
    if (items.length === 0) {
      strip.innerHTML = `<span class="im-muted">ไม่มีไอเทมที่แลกเปลี่ยนได้ในกระเป๋า</span>`;
      return;
    }
    const cur = market.item;
    strip.innerHTML = items.map(i => `
      <button type="button" class="im-strip-item ${cur && cur.slot === i.slot && cur.itemId === i.itemId ? 'active' : ''}"
        data-strip-slot="${i.slot}" data-strip-item="${i.itemId}" title="${esc(formatItemDisplayName(i))} x${i.qty}">
        ${i.icon ? `<img src="${esc(gameAssetUrl(i.icon))}" alt="">` : ''}
        <span class="im-strip-name" style="color:${getRarityColor(i.rarity)};">${esc(formatItemDisplayName(i))}</span>
        ${i.qty > 1 ? `<small>x${i.qty}</small>` : ''}
      </button>`).join('');
  }

  async function refreshMineMarket() {
    if (!bag.profileId || hub.mineLoading) return;
    hub.mineLoading = true;
    renderMineViews();
    try {
      const r = await api(`/api/profiles/${encodeURIComponent(bag.profileId)}/market`, { op: 'mine' });
      if (r && r.success) {
        hub.mine = {
          active: Array.isArray(r.active) ? r.active : [],
          closed: Array.isArray(r.closed) ? r.closed : [],
          deliveries: Array.isArray(r.deliveries) ? r.deliveries : [],
          activeLimit: Number(r.activeLimit) || 8
        };
      } else if (!hub.mine) {
        hub.mine = { error: (r && r.error) || 'โหลดข้อมูลตลาดของฉันไม่สำเร็จ', active: [], closed: [], deliveries: [], activeLimit: 8 };
      }
    } finally {
      hub.mineLoading = false;
      updateMarketBadges();
      renderMineViews();
    }
  }

  function updateMarketBadges() {
    const m = hub.mine;
    const delivCount = m && Array.isArray(m.deliveries) ? m.deliveries.length : 0;
    const activeCount = m && Array.isArray(m.active) ? m.active.length : 0;
    const limit = m && m.activeLimit ? m.activeLimit : 8;

    const topBadge = document.getElementById('char-modal-market-badge');
    if (topBadge) {
      if (delivCount > 0) {
        topBadge.style.display = 'inline-block';
        topBadge.textContent = `${delivCount}`;
        topBadge.title = `มีของ/เงินรอรับในตลาดกลาง ${delivCount} รายการ`;
      } else {
        topBadge.style.display = 'none';
      }
    }

    if (hub.el) {
      const asPill = hub.el.querySelector('[data-role="hub-autosell-count"]');
      if (asPill) {
        const cnt = (hub.autoSell.config && Array.isArray(hub.autoSell.config.rules)) ? hub.autoSell.config.rules.length : 0;
        asPill.textContent = String(cnt);
      }
      const actPill = hub.el.querySelector('[data-role="hub-active-count"]');
      if (actPill) actPill.textContent = `${activeCount}/${limit}`;
      const delPill = hub.el.querySelector('[data-role="hub-deliv-count"]');
      if (delPill) {
        delPill.style.display = delivCount > 0 ? 'inline-block' : 'none';
        delPill.textContent = String(delivCount);
      }
      const slotInfo = hub.el.querySelector('[data-role="hub-slot-info"]');
      if (slotInfo) slotInfo.textContent = `วางขายอยู่: ${activeCount}/${limit} ช่อง`;
    }
  }

  // ---------- 🤖 AUTO SELL SUB-TAB (LIST & COPY TO OTHER PROFILES) ----------
  let autoSellSaveTimer = null;

  function applyAutoSellApiResult(r) {
    if (!r || !r.success) return;
    const st = hub.autoSell;
    st.offline = Boolean(r.offline);
    if (r.config && typeof r.config === 'object') {
      st.config = {
        enabled: Boolean(r.config.enabled),
        priceStrategy: r.config.priceStrategy || 'median',
        checkIntervalSec: Number(r.config.checkIntervalSec) || 25,
        maxActiveListings: Number(r.config.maxActiveListings) || 10,
        rules: Array.isArray(r.config.rules) ? r.config.rules : []
      };
    }
    if (r.ruleStates && typeof r.ruleStates === 'object') st.ruleStates = r.ruleStates;
    if (typeof r.activeCount === 'number') st.activeCount = r.activeCount;
    if (typeof r.maxListings === 'number') st.maxListings = r.maxListings;
    if (Array.isArray(r.bagItemsSummary)) st.bagItemsSummary = r.bagItemsSummary;
    if (Array.isArray(r.otherProfiles)) st.otherProfiles = r.otherProfiles;
    updateMarketBadges();
  }

  async function refreshAutoSellHub() {
    if (!bag.profileId) return;
    hub.autoSell.loading = true;
    if (hub.subTab === 'autosell') renderAutoSellHub();
    try {
      const r = await api(`/api/profiles/${encodeURIComponent(bag.profileId)}/autosell`);
      if (r && r.success) {
        applyAutoSellApiResult(r);
      }
    } finally {
      hub.autoSell.loading = false;
      updateMarketBadges();
      if (hub.subTab === 'autosell') renderAutoSellHub();
    }
  }

  function scheduleSaveAutoSellHub() {
    if (autoSellSaveTimer) clearTimeout(autoSellSaveTimer);
    autoSellSaveTimer = setTimeout(() => {
      autoSellSaveTimer = null;
      saveAutoSellHub(false);
    }, 650);
  }

  async function saveAutoSellHub(showToast = false) {
    if (!bag.profileId) return;
    hub.autoSell.saving = true;
    try {
      const r = await api(`/api/profiles/${encodeURIComponent(bag.profileId)}/autosell`, {
        op: 'save',
        config: hub.autoSell.config
      });
      if (r && r.success) {
        applyAutoSellApiResult(r);
        if (showToast) {
          toast(`🤖 บันทึก Auto Sell แล้ว (${hub.autoSell.config.enabled ? '🟢 เปิดใช้งาน' : '⚪ ปิด'} · ${(hub.autoSell.config.rules || []).length} รายการ)`);
        }
      } else if (showToast) {
        toast(`❌ บันทึก Auto Sell ไม่สำเร็จ: ${(r && r.error) || ''}`, 'err');
      }
    } finally {
      hub.autoSell.saving = false;
      renderAutoSellRulesOnly();
      renderAutoSellBagSuggestionsOnly();
    }
  }

  function addAutoSellRuleFromBar(customName, customMin) {
    const st = hub.autoSell;
    const name = String(customName !== undefined ? customName : st.newName || '').trim();
    if (!name) {
      toast('⚠️ กรุณาพิมพ์หรือเลือกชื่อไอเทมที่จะตั้งขายอัตโนมัติ', 'warn');
      return;
    }
    const minQty = Math.max(1, parseInt(customMin !== undefined ? customMin : st.newMin, 10) || 1);
    const sellMode = st.newMode === 'min' ? 'min' : 'all';
    if (!Array.isArray(st.config.rules)) st.config.rules = [];
    const existing = st.config.rules.find(r => r && String(r.itemName || '').trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.minQty = minQty;
      existing.sellMode = sellMode;
      existing.enabled = true;
      toast(`ℹ️ อัปเดต "${name}" ในรายการ Auto Sell (ครบ ≥ ${minQty} ชิ้น)`);
    } else {
      st.config.rules.unshift({
        id: 'rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        itemName: name,
        minQty,
        sellMode,
        enabled: true
      });
      toast(`➕ เพิ่ม "${name}" เข้ารายการ Auto Sell แล้ว (ครบ ≥ ${minQty} ชิ้น)`);
    }
    if (customName === undefined) st.newName = '';
    saveAutoSellHub(false);
    renderAutoSellHub();
  }

  function classifyAutoSellRuleState(rule) {
    const st = hub.autoSell;
    const rs = (st.ruleStates && st.ruleStates[rule.id]) || null;
    if (rs) {
      if (rs.ready) return 'ready';
      if (rs.bagQty > 0) return 'inbag';
      return 'empty';
    }
    const norm = String(rule.itemName || '').trim().toLowerCase();
    const bagHit = (st.bagItemsSummary || []).find(b => b.name && b.name.toLowerCase() === norm);
    if (!bagHit || !bagHit.qty) return 'empty';
    return bagHit.qty >= (Number(rule.minQty) || 1) ? 'ready' : 'inbag';
  }

  function resolveAutoSellItemIcon(itemName, ruleId) {
    const st = hub.autoSell;
    const rs = st.ruleStates && st.ruleStates[ruleId];
    if (rs && rs.icon) return rs.icon;
    const norm = String(itemName || '').trim().toLowerCase();
    if (!norm) return '';
    const bagHit = (st.bagItemsSummary || []).find(b => b.name && b.name.toLowerCase() === norm);
    if (bagHit && bagHit.icon) return bagHit.icon;
    if (bag.data && Array.isArray(bag.data.items)) {
      const it = bag.data.items.find(x => x && x.name && x.name.trim().toLowerCase() === norm);
      if (it && it.icon) return it.icon;
    }
    return '';
  }

  function buildAutoSellRuleStatusBadge(rule) {
    const st = hub.autoSell;
    if (st.offline) {
      return `<span class="im-as-status muted">⚪ จอออฟไลน์ (บันทึกไว้แล้ว)</span>`;
    }
    const rs = (st.ruleStates && st.ruleStates[rule.id]) || null;
    const bagQty = rs ? (Number(rs.bagQty) || 0) : 0;
    const reserveQty = rs ? (Number(rs.reserveQty) || 0) : 0;
    const sellableQty = rs ? (Number(rs.sellableQty) || 0) : bagQty;
    const threshold = Math.max(1, Number(rule.minQty) || 1);
    const effThreshold = rs && rs.effectiveThreshold ? rs.effectiveThreshold : threshold;

    if (bagQty <= 0) {
      return `<span class="im-as-status empty">❌ ไม่มีในตัว</span>`;
    }
    if (reserveQty > 0 && bagQty <= reserveQty) {
      return `<span class="im-as-status reserve" title="เก็บสำรองบริจาคกิลด์/ตีบวก ${reserveQty} ชิ้น">🏛️ มี ${bagQty.toLocaleString()}/${reserveQty} ชิ้น (สำรอง)</span>`;
    }
    if (bagQty >= effThreshold && sellableQty > 0) {
      return `<span class="im-as-status ready">✅ มี ${bagQty.toLocaleString()} ชิ้น (พร้อมขาย${reserveQty > 0 ? ` ${sellableQty.toLocaleString()}` : ''})</span>`;
    }
    return `<span class="im-as-status wait">⏳ มี ${bagQty.toLocaleString()}/${effThreshold} ชิ้น (รอฟาร์ม)</span>`;
  }

  function renderAutoSellBagSuggestionsHtml() {
    const st = hub.autoSell;
    const existingSet = new Set((st.config.rules || []).map(r => String(r.itemName || '').trim().toLowerCase()).filter(Boolean));
    const suggestions = (st.bagItemsSummary || []).filter(b => b && b.name && !existingSet.has(b.name.toLowerCase()));
    if (suggestions.length === 0) return '';
    return `
      <div class="im-as-bag-pick">
        <span class="im-as-bag-pick-lbl">🎒 คลิกเพิ่มจากของในกระเป๋า:</span>
        <div class="im-as-bag-chips">
          ${suggestions.slice(0, 18).map(b => `
            <button type="button" class="im-as-bag-chip" data-as-pick-bag="${esc(b.name)}" data-as-pick-qty="${b.qty || 1}" title="คลิกเพื่อเพิ่ม ${esc(b.name)} เข้า Auto Sell">
              ${b.icon ? `<img src="${esc(gameAssetUrl(b.icon))}" alt="">` : ''}
              <span>+ ${esc(b.name)}</span>
              <b>x${Number(b.qty || 1).toLocaleString()}</b>
            </button>
          `).join('')}
        </div>
      </div>`;
  }

  function renderAutoSellBagSuggestionsOnly() {
    if (!hub.el) return;
    const box = hub.el.querySelector('[data-role="as-bag-suggestions"]');
    if (box) box.innerHTML = renderAutoSellBagSuggestionsHtml();
  }

  function renderAutoSellCopyGridHtml() {
    const st = hub.autoSell;
    const q = String(st.copyFilterQ || '').trim().toLowerCase();
    const list = (st.otherProfiles || []).filter(p => {
      if (!q) return true;
      return (p.name && p.name.toLowerCase().includes(q)) ||
             (p.charName && p.charName.toLowerCase().includes(q)) ||
             (p.account && p.account.toLowerCase().includes(q));
    });
    if (list.length === 0) {
      return `<div class="im-empty sm">ไม่พบโปรไฟล์อื่นที่ตรงกับคำค้นหา</div>`;
    }
    return list.map(p => {
      const checked = st.copyTargetIds.has(p.id);
      const label = p.charName && p.charName !== p.name ? `${p.name} (${p.charName})` : p.name;
      return `
        <label class="im-as-target-card ${checked ? 'selected' : ''} ${p.online ? 'online' : 'offline'}">
          <input type="checkbox" data-as-copy-target="${esc(p.id)}" ${checked ? 'checked' : ''}>
          <span class="im-as-dot ${p.online ? 'on' : 'off'}" title="${p.online ? 'ออนไลน์' : 'ออฟไลน์'}"></span>
          <div class="im-as-target-info">
            <div class="im-as-target-name">${esc(label)}</div>
            <div class="im-as-target-sub">${p.online ? '🟢 ออนไลน์' : '⚫ ออฟไลน์'} · มี ${p.rulesCount || 0} รายการ ${p.enabled ? '(เปิดอยู่)' : ''}</div>
          </div>
        </label>`;
    }).join('');
  }

  function renderAutoSellCopyGridOnly() {
    if (!hub.el) return;
    const grid = hub.el.querySelector('[data-role="as-copy-grid"]');
    if (grid) grid.innerHTML = renderAutoSellCopyGridHtml();
    updateAutoSellCopyFooterBtn();
  }

  function updateAutoSellCopyFooterBtn() {
    if (!hub.el) return;
    const btn = hub.el.querySelector('[data-as="copy-run-selected"]');
    const cnt = hub.autoSell.copyTargetIds.size;
    if (btn) {
      btn.disabled = cnt === 0;
      btn.textContent = `🚀 คัดลอกไปยังจอที่เลือก (${cnt} จอ)`;
    }
  }

  function renderAutoSellRulesListHtml() {
    const st = hub.autoSell;
    const rules = Array.isArray(st.config.rules) ? st.config.rules : [];
    const q = String(st.filterQ || '').trim().toLowerCase();

    let countReady = 0, countInBag = 0, countEmpty = 0;
    const decorated = rules.map((r, idx) => {
      const cls = classifyAutoSellRuleState(r);
      if (cls === 'ready') countReady++;
      else if (cls === 'inbag') countInBag++;
      else countEmpty++;
      return { r, idx, cls };
    });

    if (hub.el) {
      const fBar = hub.el.querySelector('[data-role="as-filter-pills"]');
      if (fBar) {
        const pills = [
          ['all', `ทั้งหมด (${rules.length})`],
          ['ready', `✅ พร้อมขาย (${countReady})`],
          ['inbag', `⏳ มีในตัว (${countInBag})`],
          ['empty', `❌ ไม่มีในตัว (${countEmpty})`]
        ];
        fBar.innerHTML = pills.map(([k, lbl]) => `
          <button type="button" class="im-as-pill ${st.filterStatus === k ? 'active' : ''}" data-as-filter="${k}">${lbl}</button>
        `).join('');
      }
    }

    const filtered = decorated.filter(({ r, cls }) => {
      if (st.filterStatus !== 'all' && cls !== st.filterStatus) return false;
      if (q && !String(r.itemName || '').toLowerCase().includes(q)) return false;
      return true;
    });

    if (rules.length === 0) {
      return `<div class="im-empty">💡 ยังไม่มีรายการ Auto Sell ตลาดกลางสำหรับโปรไฟล์นี้ — พิมพ์ชื่อไอเทมด้านบน หรือคลิกเลือกจากของในกระเป๋าเพื่อเพิ่มรายการ</div>`;
    }
    if (filtered.length === 0) {
      return `<div class="im-empty">🔍 ไม่พบรายการ Auto Sell ที่ตรงกับตัวกรอง</div>`;
    }

    return `<div class="im-as-grid">${filtered.map(({ r, idx, cls }) => {
      const icon = resolveAutoSellItemIcon(r.itemName, r.id);
      const canSellNow = !st.offline && (cls === 'ready' || cls === 'inbag');
      return `
        <div class="im-as-card ${cls === 'ready' ? 'ready' : ''}" data-rule-id="${esc(r.id)}">
          <div class="im-as-card-top">
            <span class="im-as-idx">#${idx + 1}</span>
            <div class="im-as-icon-box">
              ${icon ? `<img src="${esc(gameAssetUrl(icon))}" alt="">` : '🏷️'}
            </div>
            <input type="text" class="im-as-name-input" list="im-as-bag-datalist" value="${esc(r.itemName || '')}" placeholder="ชื่อไอเทม..." data-as-rule-name="${esc(r.id)}">
            <button type="button" class="im-as-del-btn" data-as-del="${esc(r.id)}" title="ลบรายการนี้ออกจาก Auto Sell">➖</button>
          </div>
          <div class="im-as-card-mid">
            <div class="im-as-cond">
              <span>ครบ ≥</span>
              <input type="number" min="1" max="99999" class="im-as-min-input" value="${Number(r.minQty) || 1}" data-as-rule-min="${esc(r.id)}">
              <span>ชิ้น</span>
            </div>
            <select class="im-as-mode-select" data-as-rule-mode="${esc(r.id)}">
              <option value="all" ${r.sellMode !== 'min' ? 'selected' : ''}>ขายหมดในตัว</option>
              <option value="min" ${r.sellMode === 'min' ? 'selected' : ''}>ขายทีละ ${Number(r.minQty) || 1} ชิ้น</option>
            </select>
          </div>
          <div class="im-as-card-foot">
            ${buildAutoSellRuleStatusBadge(r)}
            <button type="button" class="im-btn ${canSellNow ? 'primary' : 'ghost'} xs" data-as-sell-now="${esc(r.id)}" ${canSellNow ? '' : 'disabled'} title="สั่งประเมินราคาและลงขายในตลาดกลางทันที">
              ⚡ ขายทันที
            </button>
          </div>
        </div>`;
    }).join('')}</div>`;
  }

  function renderAutoSellRulesOnly() {
    if (!hub.el) return;
    const box = hub.el.querySelector('[data-role="as-rules-list"]');
    if (box) box.innerHTML = renderAutoSellRulesListHtml();
    updateMarketBadges();
  }

  function renderAutoSellHub() {
    if (!hub.el) return;
    const root = hub.el.querySelector('[data-role="autosell-root"]');
    if (!root) return;
    const st = hub.autoSell;
    const rules = Array.isArray(st.config.rules) ? st.config.rules : [];
    const datalistNames = Array.from(new Set([
      ...(st.bagItemsSummary || []).map(b => b.name),
      ...rules.map(r => r.itemName)
    ].filter(Boolean))).sort();

    root.innerHTML = `
      <datalist id="im-as-bag-datalist">
        ${datalistNames.map(n => `<option value="${esc(n)}"></option>`).join('')}
      </datalist>

      <div class="im-as-wrap">
        <!-- TOP CONTROL HEADER -->
        <div class="im-as-head">
          <div class="im-as-head-left">
            <label class="im-as-switch">
              <input type="checkbox" data-as="toggle-enabled" ${st.config.enabled ? 'checked' : ''}>
              <span class="im-as-slider"></span>
              <span class="im-as-switch-lbl">เปิดใช้งาน Auto Sell ตลาดกลาง (${rules.length} รายการ)</span>
            </label>
            <div class="im-as-badges">
              <span class="im-as-badge strat">⚖️ กลยุทธ์: ราคากลางสมดุล / ตัดราคา 1z (ข้ามราคาล่อ)</span>
              <span class="im-as-badge shield">🛡️ ป้องกันขาย NPC อัตโนมัติ</span>
              <span class="im-as-badge quota">โควตาวางขาย: ${st.activeCount}/${st.maxListings} ช่อง</span>
            </div>
          </div>
          <div class="im-as-head-right">
            <button type="button" class="im-btn ghost sm" data-as="check-now" ${st.offline ? 'disabled' : ''} title="สั่งให้บอทเช็กกระเป๋าและตั้งขายทุกรายการที่ครบเงื่อนไขทันที">
              ⚡ ตรวจสอบทันที
            </button>
            <button type="button" class="im-btn copy-btn sm ${st.copyOpen ? 'active' : ''}" data-as="toggle-copy-panel" title="คัดลอกรายการ Auto Sell ของโปรไฟล์นี้ไปยังโปรไฟล์อื่น">
              📋 Copy To จออื่น (${(st.otherProfiles || []).length})
            </button>
          </div>
        </div>

        <!-- COPY TO OTHER PROFILES DRAWER/PANEL -->
        <div class="im-as-copy-panel" style="display:${st.copyOpen ? 'flex' : 'none'};">
          <div class="im-as-copy-head">
            <div>
              <div class="im-as-copy-title">📋 คัดลอกรายการ Auto Sell (${rules.length} รายการ) ไปยังโปรไฟล์อื่น</div>
              <div class="im-as-copy-sub">รองรับทั้งจอที่กำลังออนไลน์ (ซิงค์เข้าเกมทันที) และจอที่ออฟไลน์อยู่</div>
            </div>
            <button type="button" class="im-btn ghost xs" data-as="toggle-copy-panel">✕ ปิด</button>
          </div>

          <div class="im-as-copy-controls">
            <label class="im-as-copy-opt">
              <span>โหมดการคัดลอก:</span>
              <select class="im-select" data-as="copy-mode">
                <option value="replace" ${st.copyMode !== 'merge' ? 'selected' : ''}>เขียนทับรายการทั้งหมดให้เหมือนจอนี้เป๊ะ (Replace)</option>
                <option value="merge" ${st.copyMode === 'merge' ? 'selected' : ''}>รวมรายการเพิ่มเข้าไปโดยไม่ลบของเดิม (Merge)</option>
              </select>
            </label>
            <label class="im-check">
              <input type="checkbox" data-as="copy-enabled" ${st.copyEnabled ? 'checked' : ''}>
              คัดลอกสถานะ เปิด/ปิด Auto Sell (${st.config.enabled ? 'เปิด' : 'ปิด'}) ไปด้วย
            </label>
            <div class="im-as-copy-quick">
              <input type="text" class="im-input sm" data-as="copy-filter" value="${esc(st.copyFilterQ)}" placeholder="ค้นหาชื่อจอ...">
              <button type="button" class="im-btn ghost xs" data-as="copy-sel-all">☑️ เลือกทุกจอ</button>
              <button type="button" class="im-btn ghost xs" data-as="copy-sel-online">🟢 เฉพาะออนไลน์</button>
              <button type="button" class="im-btn ghost xs" data-as="copy-sel-none">⬜ ล้างที่เลือก</button>
            </div>
          </div>

          <div class="im-as-copy-grid" data-role="as-copy-grid">
            ${renderAutoSellCopyGridHtml()}
          </div>

          <div class="im-as-copy-foot">
            <span class="im-muted">💡 จอที่ได้รับรายการจะเก็บไอเทมเหล่านี้ไว้ลงขายตลาดกลางและไม่ขายทิ้งให้ NPC</span>
            <div class="im-as-copy-actions">
              <button type="button" class="im-btn ghost sm" data-as="copy-run-selected" ${st.copyTargetIds.size === 0 ? 'disabled' : ''}>
                🚀 คัดลอกไปยังจอที่เลือก (${st.copyTargetIds.size} จอ)
              </button>
              <button type="button" class="im-btn market sm" data-as="copy-run-all" ${(st.otherProfiles || []).length === 0 ? 'disabled' : ''}>
                ⚡ คัดลอกไปทุกจอทันที (${(st.otherProfiles || []).length} จอ)
              </button>
            </div>
          </div>
        </div>

        <!-- ADD NEW RULE BAR -->
        <div class="im-as-add-card">
          <div class="im-as-add-row">
            <input type="text" class="im-input" list="im-as-bag-datalist" data-as="new-name" value="${esc(st.newName)}" placeholder="พิมพ์หรือเลือกชื่อไอเทมที่จะตั้งขายอัตโนมัติ เช่น Elunium, Halloween Box, Slime Card...">
            <div class="im-as-add-min">
              <span>ครบ ≥</span>
              <input type="number" min="1" max="99999" class="im-input" data-as="new-min" value="${Number(st.newMin) || 10}">
              <span>ชิ้น</span>
            </div>
            <select class="im-select" data-as="new-mode">
              <option value="all" ${st.newMode !== 'min' ? 'selected' : ''}>ขายหมดในตัว</option>
              <option value="min" ${st.newMode === 'min' ? 'selected' : ''}>ขายทีละจำนวนขั้นต่ำ</option>
            </select>
            <button type="button" class="im-btn primary" data-as="add-rule">➕ เพิ่มรายการลงขาย</button>
          </div>
          <div data-role="as-bag-suggestions">
            ${renderAutoSellBagSuggestionsHtml()}
          </div>
        </div>

        <!-- FILTER & SEARCH BAR -->
        <div class="im-as-filter-row">
          <input type="text" class="im-input" data-as="filter-q" value="${esc(st.filterQ)}" placeholder="🔍 ค้นหาไอเทมในรายการ Auto Sell (${rules.length} รายการ)...">
          <div class="im-as-pills" data-role="as-filter-pills"></div>
        </div>

        <!-- RULES GRID -->
        <div class="im-as-rules-box" data-role="as-rules-list">
          ${st.loading ? '<div class="im-empty">⏳ กำลังโหลดรายการ Auto Sell...</div>' : renderAutoSellRulesListHtml()}
        </div>
      </div>`;
  }

  function renderMineViews() {
    if (!hub.el) return;
    const m = hub.mine;
    const actSumEl = hub.el.querySelector('[data-role="active-summary"]');
    const actListEl = hub.el.querySelector('[data-role="active-list"]');
    const closedListEl = hub.el.querySelector('[data-role="closed-list"]');
    const delivBannerEl = hub.el.querySelector('[data-role="deliveries-banner"]');
    const delivListEl = hub.el.querySelector('[data-role="deliveries-list"]');

    if (!m && hub.mineLoading) {
      const waitHtml = '<div class="im-empty">⏳ กำลังดึงข้อมูลตลาดกลางของตัวละคร...</div>';
      if (actListEl) actListEl.innerHTML = waitHtml;
      if (delivListEl) delivListEl.innerHTML = waitHtml;
      return;
    }
    if (!m) return;

    // 1. Active & Closed Listings
    const active = m.active || [];
    const closed = m.closed || [];
    const totalActiveVal = active.reduce((s, l) => s + (Number(l.price) || 0), 0);

    if (actSumEl) {
      actSumEl.innerHTML = `
        <div class="im-tile"><small>กำลังวางขาย</small><b>${active.length} / ${m.activeLimit || 8} ช่อง</b></div>
        <div class="im-tile hl"><small>มูลค่าที่ตั้งขายรวม</small><b>${fmtZ(totalActiveVal)}</b></div>
        <div class="im-tile"><small>ประวัติปิดการขาย</small><b>${closed.length} รายการ</b></div>
        <div class="im-tile"><small>รอรับในหน้ารับของ</small><b style="color:${(m.deliveries || []).length ? '#4ade80' : '#94a3b8'};">${(m.deliveries || []).length} รายการ</b></div>`;
    }

    if (actListEl) {
      if (active.length === 0) {
        actListEl.innerHTML = `<div class="im-empty">📦 ตอนนี้ยังไม่มีไอเทมที่กำลังวางขายอยู่ — ไปที่แท็บ "🏷️ ลงขายไอเทม" เพื่อตั้งขายได้เลย</div>`;
      } else {
        actListEl.innerHTML = `<div class="im-hub-rows">${active.map(l => {
          const it = l.item || {};
          const unit = Math.round((Number(l.price) || 0) / Math.max(1, Number(l.qty) || 1));
          return `
            <div class="im-hub-item-row">
              <div class="im-hub-item-left">
                <div class="im-hub-icon" style="--rc:${getRarityColor(it.rarity)};">
                  ${it.icon ? `<img src="${esc(gameAssetUrl(it.icon))}" alt="">` : '📦'}
                </div>
                <div class="im-hub-meta">
                  <div class="im-hub-name">
                    <span style="color:${getRarityColor(it.rarity)};">${esc(formatItemDisplayName(it))}</span>
                    ${l.qty > 1 ? `<span class="im-hub-qty">x${Number(l.qty).toLocaleString()}</span>` : ''}
                  </div>
                  ${it.affixes && it.affixes.length ? renderItemStatGroups({ affixes: it.affixes }) : '<span class="im-muted">ไม่มีออฟชั่นสุ่ม</span>'}
                </div>
              </div>
              <div class="im-hub-item-right">
                <div class="im-hub-price">
                  <b>${fmtZ(l.price)}</b>
                  ${l.qty > 1 ? `<small>${fmtZ(unit)} / ชิ้น</small>` : ''}
                </div>
                <span class="im-hub-time">⏳ ${timeLeft(l.expiresAt)}</span>
                <button type="button" class="im-btn danger sm" data-hub-cancel="${esc(l.listingId ?? l.id)}">❌ ยกเลิกขาย</button>
              </div>
            </div>`;
        }).join('')}</div>`;
      }
    }

    if (closedListEl) {
      if (closed.length === 0) {
        closedListEl.innerHTML = `<div class="im-empty sm">ยังไม่มีประวัติรายการที่ปิดการขาย</div>`;
      } else {
        closedListEl.innerHTML = `<div class="im-hub-rows">${closed.slice(0, 30).map(l => {
          const it = l.item || {};
          const st = String(l.status || '').toLowerCase();
          const stBadge = st === 'sold'
            ? `<span class="im-st-badge sold">✅ ขายสำเร็จ</span>`
            : st === 'cancelled'
            ? `<span class="im-st-badge cancel">🚫 ยกเลิก</span>`
            : `<span class="im-st-badge exp">⏰ หมดเวลา</span>`;
          return `
            <div class="im-hub-item-row compact">
              <div class="im-hub-item-left">
                <div class="im-hub-icon sm" style="--rc:${getRarityColor(it.rarity)};">
                  ${it.icon ? `<img src="${esc(gameAssetUrl(it.icon))}" alt="">` : '📦'}
                </div>
                <div class="im-hub-meta">
                  <div class="im-hub-name">
                    ${stBadge}
                    <span style="color:${getRarityColor(it.rarity)};">${esc(formatItemDisplayName(it))}</span>
                    ${l.qty > 1 ? `<span class="im-hub-qty">x${Number(l.qty).toLocaleString()}</span>` : ''}
                  </div>
                  <div class="im-muted">
                    ${l.buyerName ? `ผู้ซื้อ: <b>${esc(l.buyerName)}</b> · ` : ''}${timeAgo(l.closedAt || l.createdAt)}
                  </div>
                </div>
              </div>
              <div class="im-hub-item-right">
                <div class="im-hub-price">
                  <b>${fmtZ(l.price)}</b>
                  ${l.netPayout ? `<small style="color:#4ade80;">รับสุทธิ ${fmtZ(l.netPayout)}</small>` : ''}
                </div>
              </div>
            </div>`;
        }).join('')}</div>`;
      }
    }

    // 2. Deliveries (Claim box)
    const delivs = m.deliveries || [];
    const totalPendingZeny = delivs.reduce((s, d) => s + (Number(d.zeny) || 0), 0);
    const totalPendingItems = delivs.filter(d => d && d.item).length;

    if (delivBannerEl) {
      delivBannerEl.innerHTML = `
        <div class="im-claim-stats">
          <div class="im-claim-stat">
            <span>💰 เงินรอรับจากการขาย</span>
            <b class="zeny">+${fmtZ(totalPendingZeny)}</b>
          </div>
          <div class="im-claim-stat">
            <span>📦 ไอเทมรอรับเข้ากระเป๋า</span>
            <b>${totalPendingItems.toLocaleString()} รายการ</b>
          </div>
        </div>
        <button type="button" class="im-btn primary lg" data-hub-act="collect-all" ${delivs.length ? '' : 'disabled'}>
          📥 รับของและเงินทั้งหมด (${delivs.length})
        </button>`;
    }

    if (delivListEl) {
      if (delivs.length === 0) {
        delivListEl.innerHTML = `<div class="im-empty">✨ ไม่มีไอเทมหรือเงินค้างรับในตลาดกลาง</div>`;
      } else {
        delivListEl.innerHTML = `<div class="im-hub-rows">${delivs.map(d => {
          const it = d.item || null;
          const r = String(d.reason || '').toLowerCase();
          const reasonBadge = r.includes('sale') || (d.zeny > 0 && !it)
            ? `<span class="im-st-badge sold">💰 เงินจากการขาย</span>`
            : r.includes('purchase') || r.includes('won')
            ? `<span class="im-st-badge buy">🛒 ซื้อสำเร็จ</span>`
            : r.includes('cancel')
            ? `<span class="im-st-badge cancel">🚫 ของที่ยกเลิกขาย</span>`
            : r.includes('expire')
            ? `<span class="im-st-badge exp">⏰ ของหมดเวลาขาย</span>`
            : `<span class="im-st-badge">📬 พัสดุตลาด</span>`;
          return `
            <div class="im-hub-item-row">
              <div class="im-hub-item-left">
                <div class="im-hub-icon" style="--rc:${it ? getRarityColor(it.rarity) : '#fbbf24'};">
                  ${it && it.icon ? `<img src="${esc(gameAssetUrl(it.icon))}" alt="">` : '💰'}
                </div>
                <div class="im-hub-meta">
                  <div class="im-hub-name">
                    ${reasonBadge}
                    ${it ? `<span style="color:${getRarityColor(it.rarity)};">${esc(formatItemDisplayName(it))}</span>` : (d.name ? `<span style="color:#e2e8f0;">${esc(d.name)}</span>` : '')}
                    ${it && it.qty > 1 ? `<span class="im-hub-qty">x${Number(it.qty).toLocaleString()}</span>` : ''}
                    ${d.zeny > 0 ? `<b style="color:#fde047; font-family:var(--font-mono);">+${fmtZ(d.zeny)}</b>` : ''}
                  </div>
                  <div class="im-muted">${esc(d.note || '')} ${d.createdAt ? `· ${timeAgo(d.createdAt)}` : ''}</div>
                  ${it && it.affixes && it.affixes.length ? renderItemStatGroups({ affixes: it.affixes }) : ''}
                </div>
              </div>
              <div class="im-hub-item-right">
                <button type="button" class="im-btn primary sm" data-hub-collect="${esc(d.deliveryId ?? d.id)}">📥 กดรับ</button>
              </div>
            </div>`;
        }).join('')}</div>`;
      }
    }
  }

  function renderBrowseOptHint() {
    if (!hub.el) return;
    const box = hub.el.querySelector('[data-role="browse-opt-hint"]');
    if (!box) return;
    const parsed = parseOptionQuery(hub.browse.optText);
    box.innerHTML = [
      ...parsed.terms.map(t => `<span class="im-qchip opt">✓ ${esc(describeTerm(t))}</span>`),
      ...parsed.names.map(n => `<span class="im-qchip bad">? ${esc(n)}</span>`)
    ].join('');
  }

  async function runBrowseSearch() {
    if (!bag.profileId || !hub.el) return;
    const listEl = hub.el.querySelector('[data-role="browse-list"]');
    if (listEl) listEl.innerHTML = `<div class="im-empty">⏳ กำลังค้นหาไอเทมในตลาดกลาง...</div>`;
    hub.browse.loading = true;
    try {
      const parsed = parseOptionQuery(hub.browse.optText);
      const lead = parsed.terms.slice().sort((a, b) => b.min - a.min)[0] || null;
      const body = {
        op: 'search',
        q: hub.browse.q.trim(),
        category: hub.browse.category,
        pages: lead ? 5 : 3
      };
      if (lead) { body.affix = lead.type; if (lead.min) body.affixMin = lead.min; }
      const r = await api(`/api/profiles/${encodeURIComponent(bag.profileId)}/market`, body);
      hub.browse.results = (r && r.success) ? (r.listings || []) : { error: (r && r.error) || 'ค้นหาตลาดไม่สำเร็จ' };
    } finally {
      hub.browse.loading = false;
      renderBrowseResults();
    }
  }

  function renderBrowseResults() {
    if (!hub.el) return;
    const listEl = hub.el.querySelector('[data-role="browse-list"]');
    if (!listEl) return;
    const res = hub.browse.results;
    if (!res) return;
    if (res.error) {
      listEl.innerHTML = `<div class="im-empty">⚠️ ${esc(res.error)}</div>`;
      return;
    }
    const parsed = parseOptionQuery(hub.browse.optText);
    const optFilter = { terms: parsed.terms, names: [] };
    const hiTypes = parsed.terms.map(t => t.type);

    let rows = res
      .filter(l => l && l.item && (parsed.terms.length === 0 || itemMatchesOptionQuery(l.item, optFilter, 'all')))
      .map(l => ({ l, unit: Math.round((Number(l.price) || 0) / Math.max(1, Number(l.qty) || 1)) }));

    if (hub.browse.sort === 'price_asc') rows.sort((a, b) => a.unit - b.unit);
    else if (hub.browse.sort === 'price_desc') rows.sort((a, b) => b.unit - a.unit);
    else rows.sort((a, b) => (Number(b.l.createdAt) || 0) - (Number(a.l.createdAt) || 0));

    if (rows.length === 0) {
      listEl.innerHTML = `<div class="im-empty">🔍 ไม่พบไอเทมที่ค้นหาในตลาดกลางตอนนี้</div>`;
      return;
    }

    listEl.innerHTML = `<div class="im-hub-rows">${rows.slice(0, 80).map(({ l, unit }) => {
      const it = l.item || {};
      const auction = l.auctionEndsAt && l.auctionEndsAt > Date.now();
      return `
        <div class="im-hub-item-row ${l.mine ? 'mine' : ''}">
          <div class="im-hub-item-left">
            <div class="im-hub-icon" style="--rc:${getRarityColor(it.rarity)};">
              ${it.icon ? `<img src="${esc(gameAssetUrl(it.icon))}" alt="">` : '📦'}
            </div>
            <div class="im-hub-meta">
              <div class="im-hub-name">
                <span style="color:${getRarityColor(it.rarity)};">${esc(formatItemDisplayName(it))}</span>
                ${l.qty > 1 ? `<span class="im-hub-qty">x${Number(l.qty).toLocaleString()}</span>` : ''}
                ${auction ? '<span class="im-auction">ประมูล</span>' : ''}
                ${l.mine ? '<span class="im-auction mine">ของฉัน</span>' : ''}
              </div>
              ${it.affixes && it.affixes.length ? renderItemStatGroups({ affixes: it.affixes }, hiTypes) : '<span class="im-muted">ไม่มีออฟชั่นสุ่ม</span>'}
              <div class="im-muted">ผู้ขาย: ${esc(l.sellerName || '-')} · เหลือเวลา ${timeLeft(l.expiresAt)}</div>
            </div>
          </div>
          <div class="im-hub-item-right">
            <div class="im-hub-price">
              <b>${fmtZ(unit)} <small>/ ชิ้น</small></b>
              ${l.qty > 1 ? `<small>รวม ${fmtZ(l.price)} (x${l.qty})</small>` : ''}
            </div>
            ${l.mine
              ? `<button type="button" class="im-btn danger sm" data-hub-cancel="${esc(l.listingId ?? l.id)}">❌ ยกเลิก</button>`
              : `<button type="button" class="im-btn primary sm" data-hub-buy="${esc(l.listingId ?? l.id)}" data-buy-name="${esc(formatItemDisplayName(it))}" data-buy-qty="${l.qty || 1}" data-buy-price="${l.price || 0}" data-buy-unit="${unit}">🛒 ซื้อ</button>`}
          </div>
        </div>`;
    }).join('')}</div>`;
  }

  async function onHubClick(e) {
    const tabBtn = e.target.closest('[data-hub-tab]');
    if (tabBtn) {
      switchHubSubTab(tabBtn.dataset.hubTab);
      return;
    }

    const stripBtn = e.target.closest('[data-strip-slot]');
    if (stripBtn && bag.data) {
      const slot = Number(stripBtn.dataset.stripSlot);
      const itemId = Number(stripBtn.dataset.stripItem);
      bag.selected = { slot, itemId };
      renderBag();
      const it = selectedBagItem();
      if (it) openMarketFor(it, { preferTab: true });
      return;
    }

    const browseGo = e.target.closest('[data-browse="go"]');
    if (browseGo) {
      runBrowseSearch();
      return;
    }

    // ---------- 🤖 Auto Sell Hub click actions ----------
    const asFilterBtn = e.target.closest('[data-as-filter]');
    if (asFilterBtn) {
      hub.autoSell.filterStatus = asFilterBtn.dataset.asFilter || 'all';
      renderAutoSellRulesOnly();
      return;
    }

    const asPickBag = e.target.closest('[data-as-pick-bag]');
    if (asPickBag) {
      const nm = asPickBag.dataset.asPickBag;
      if (nm) addAutoSellRuleFromBar(nm, hub.autoSell.newMin || 1);
      return;
    }

    const asDelBtn = e.target.closest('[data-as-del]');
    if (asDelBtn) {
      const rid = asDelBtn.dataset.asDel;
      const rule = (hub.autoSell.config.rules || []).find(r => r.id === rid);
      hub.autoSell.config.rules = (hub.autoSell.config.rules || []).filter(r => r.id !== rid);
      toast(`🗑️ ลบ "${(rule && rule.itemName) || rid}" ออกจาก Auto Sell แล้ว`);
      saveAutoSellHub(false);
      renderAutoSellHub();
      return;
    }

    const asSellNowBtn = e.target.closest('[data-as-sell-now]');
    if (asSellNowBtn) {
      const rid = asSellNowBtn.dataset.asSellNow;
      const rule = (hub.autoSell.config.rules || []).find(r => r.id === rid);
      asSellNowBtn.disabled = true;
      const origTxt = asSellNowBtn.textContent;
      asSellNowBtn.textContent = '⏳ กำลังขาย...';
      try {
        const r = await api(`/api/profiles/${encodeURIComponent(bag.profileId)}/autosell`, {
          op: 'sell_rule_now',
          ruleId: rid,
          config: hub.autoSell.config
        });
        if (r && r.success) {
          applyAutoSellApiResult(r);
          toast(`⚡ สั่งประเมินราคากลางและลงขาย "${(rule && rule.itemName) || ''}" แล้ว`);
          setTimeout(() => { refreshBag(); refreshMineMarket(); }, 500);
        } else {
          toast(`❌ ขายทันทีไม่สำเร็จ: ${(r && r.error) || ''}`, 'err');
        }
      } finally {
        asSellNowBtn.disabled = false;
        asSellNowBtn.textContent = origTxt;
        renderAutoSellHub();
      }
      return;
    }

    const asBtn = e.target.closest('[data-as]');
    if (asBtn && asBtn.tagName === 'BUTTON') {
      const act = asBtn.dataset.as;
      if (act === 'add-rule') {
        addAutoSellRuleFromBar();
        return;
      }
      if (act === 'check-now') {
        asBtn.disabled = true;
        const origTxt = asBtn.textContent;
        asBtn.textContent = '⏳ กำลังตรวจสอบ...';
        try {
          const r = await api(`/api/profiles/${encodeURIComponent(bag.profileId)}/autosell`, {
            op: 'check_now',
            config: hub.autoSell.config
          });
          if (r && r.success) {
            applyAutoSellApiResult(r);
            toast('⚡ สั่งตรวจสอบกระเป๋าและลงขายอัตโนมัติทันทีแล้ว!');
            setTimeout(() => { refreshBag(); refreshMineMarket(); }, 600);
          } else {
            toast(`❌ ตรวจสอบไม่สำเร็จ: ${(r && r.error) || ''}`, 'err');
          }
        } finally {
          asBtn.disabled = false;
          asBtn.textContent = origTxt;
          renderAutoSellHub();
        }
        return;
      }
      if (act === 'toggle-copy-panel') {
        hub.autoSell.copyOpen = !hub.autoSell.copyOpen;
        renderAutoSellHub();
        return;
      }
      if (act === 'copy-sel-all') {
        (hub.autoSell.otherProfiles || []).forEach(p => hub.autoSell.copyTargetIds.add(p.id));
        renderAutoSellCopyGridOnly();
        return;
      }
      if (act === 'copy-sel-online') {
        hub.autoSell.copyTargetIds.clear();
        (hub.autoSell.otherProfiles || []).filter(p => p.online).forEach(p => hub.autoSell.copyTargetIds.add(p.id));
        renderAutoSellCopyGridOnly();
        return;
      }
      if (act === 'copy-sel-none') {
        hub.autoSell.copyTargetIds.clear();
        renderAutoSellCopyGridOnly();
        return;
      }
      if (act === 'copy-run-selected' || act === 'copy-run-all') {
        const isAll = act === 'copy-run-all';
        const targetIds = isAll ? 'all' : Array.from(hub.autoSell.copyTargetIds);
        const targetCount = isAll ? (hub.autoSell.otherProfiles || []).length : targetIds.length;
        if (targetCount === 0) {
          toast('⚠️ กรุณาเลือกจอปลายทางอย่างน้อย 1 จอ', 'warn');
          return;
        }
        const rulesLen = (hub.autoSell.config.rules || []).length;
        const modeTxt = hub.autoSell.copyMode === 'merge' ? 'รวมรายการเพิ่ม (Merge)' : 'เขียนทับให้เหมือนกันเป๊ะ (Replace)';
        if (!confirm(`ยืนยันคัดลอกรายการ Auto Sell (${rulesLen} รายการ · โหมด ${modeTxt}) ไปยัง ${targetCount} จอ ?`)) return;

        asBtn.disabled = true;
        const origTxt = asBtn.textContent;
        asBtn.textContent = '⏳ กำลังคัดลอก...';
        try {
          const r = await api(`/api/profiles/${encodeURIComponent(bag.profileId)}/autosell`, {
            op: 'copy_to',
            targetIds,
            mode: hub.autoSell.copyMode,
            copyEnabled: hub.autoSell.copyEnabled,
            config: hub.autoSell.config
          });
          if (r && r.success) {
            if (Array.isArray(r.otherProfiles)) hub.autoSell.otherProfiles = r.otherProfiles;
            toast(`📋 คัดลอก Auto Sell (${r.rulesCount} รายการ) สำเร็จ ${r.totalTargets} จอ! (ออนไลน์ซิงค์ทันที ${r.appliedOnline} จอ${r.savedOffline ? ` · ออฟไลน์บันทึกไว้ ${r.savedOffline} จอ` : ''})`);
          } else {
            toast(`❌ คัดลอกไม่สำเร็จ: ${(r && r.error) || ''}`, 'err');
          }
        } finally {
          asBtn.disabled = false;
          asBtn.textContent = origTxt;
          renderAutoSellHub();
        }
        return;
      }
    }

    const actBtn = e.target.closest('[data-hub-act]');
    if (actBtn) {
      const act = actBtn.dataset.hubAct;
      if (act === 'refresh-all') {
        market.cache.clear();
        await Promise.all([refreshBag(), refreshMineMarket(), refreshAutoSellHub()]);
        if (hub.subTab === 'sell' && market.item) loadMarketData(true);
        if (hub.subTab === 'browse') runBrowseSearch();
        toast('🏪 รีเฟรชข้อมูลตลาดกลางแล้ว');
        return;
      }
      if (act === 'collect-all') {
        actBtn.disabled = true;
        const orig = actBtn.textContent;
        actBtn.textContent = '⏳ กำลังรับทั้งหมด...';
        try {
          const r = await api(`/api/profiles/${encodeURIComponent(bag.profileId)}/market`, { op: 'collect_all' });
          if (r && r.success) {
            toast('📥 รับของและเงินทั้งหมดจากตลาดกลางเรียบร้อยแล้ว!');
            hub.mine = {
              active: r.active || [],
              closed: r.closed || [],
              deliveries: r.deliveries || [],
              activeLimit: r.activeLimit || 8
            };
            updateMarketBadges();
            renderMineViews();
            setTimeout(refreshBag, 400);
            if (typeof loadCharacterDetail === 'function' && currentCharProfileId) {
              setTimeout(() => loadCharacterDetail(currentCharProfileId, true), 600);
            }
          } else {
            toast(`❌ รับทั้งหมดไม่สำเร็จ: ${(r && r.error) || ''}`, 'err');
          }
        } finally {
          actBtn.disabled = false;
          actBtn.textContent = orig;
        }
        return;
      }
    }

    const collectBtn = e.target.closest('[data-hub-collect]');
    if (collectBtn) {
      const deliveryId = collectBtn.dataset.hubCollect;
      collectBtn.disabled = true;
      collectBtn.textContent = '⏳...';
      const r = await api(`/api/profiles/${encodeURIComponent(bag.profileId)}/market`, { op: 'collect', deliveryId });
      if (r && r.success) {
        toast('📥 รับรายการเข้ากระเป๋าแล้ว');
        hub.mine = {
          active: r.active || [],
          closed: r.closed || [],
          deliveries: r.deliveries || [],
          activeLimit: r.activeLimit || 8
        };
        updateMarketBadges();
        renderMineViews();
        setTimeout(refreshBag, 400);
      } else {
        toast(`❌ รับไม่สำเร็จ: ${(r && r.error) || ''}`, 'err');
        collectBtn.disabled = false;
        collectBtn.textContent = '📥 กดรับ';
      }
      return;
    }

    const cancelBtn = e.target.closest('[data-hub-cancel]');
    if (cancelBtn) {
      const listingId = cancelBtn.dataset.hubCancel;
      if (!confirm('ยกเลิกการวางขายรายการนี้? (ไอเทมจะถูกส่งไปที่แท็บ "📬 รับของ / รับเงิน")')) return;
      cancelBtn.disabled = true;
      cancelBtn.textContent = '⏳...';
      const r = await api(`/api/profiles/${encodeURIComponent(bag.profileId)}/market`, { op: 'cancel', listingId });
      if (r && r.success) {
        toast('🚫 ยกเลิกรายการขายแล้ว — กดรับไอเทมคืนได้ที่แท็บ "📬 รับของ / รับเงิน"');
        hub.mine = {
          active: r.active || [],
          closed: r.closed || [],
          deliveries: r.deliveries || [],
          activeLimit: r.activeLimit || 8
        };
        updateMarketBadges();
        renderMineViews();
        if (hub.subTab === 'browse') runBrowseSearch();
      } else {
        toast(`❌ ยกเลิกไม่สำเร็จ: ${(r && r.error) || ''}`, 'err');
        cancelBtn.disabled = false;
        cancelBtn.textContent = '❌ ยกเลิกขาย';
      }
      return;
    }

    const buyBtn = e.target.closest('[data-hub-buy]');
    if (buyBtn) {
      const listingId = buyBtn.dataset.hubBuy;
      const name = buyBtn.dataset.buyName || 'Item';
      const maxQty = Math.max(1, Number(buyBtn.dataset.buyQty) || 1);
      const totalPrice = Number(buyBtn.dataset.buyPrice) || 0;
      const unitPrice = Number(buyBtn.dataset.buyUnit) || totalPrice;
      const msg = maxQty > 1
        ? `ยืนยันซื้อ "${name}" x${maxQty} ชิ้น\nราคารวม ${fmtZ(totalPrice)} (เฉลี่ยชิ้นละ ${fmtZ(unitPrice)}) ?`
        : `ยืนยันซื้อ "${name}" ราคา ${fmtZ(totalPrice)} ?`;
      if (!confirm(msg)) return;
      buyBtn.disabled = true;
      buyBtn.textContent = '⏳...';
      const r = await api(`/api/profiles/${encodeURIComponent(bag.profileId)}/market`, { op: 'buy', listingId, price: totalPrice, qty: maxQty });
      if (r && r.success) {
        toast(`🛒 ซื้อ ${name} x${maxQty} สำเร็จ! (รับของได้ที่แท็บ "📬 รับของ / รับเงิน")`);
        refreshMineMarket();
        runBrowseSearch();
        if (hub.subTab === 'sell') { market.cache.clear(); loadMarketData(true); }
      } else {
        toast(`❌ ซื้อไม่สำเร็จ: ${(r && r.error) || ''}`, 'err');
        buyBtn.disabled = false;
        buyBtn.textContent = '🛒 ซื้อ';
      }
    }
  }

  // Floating market window (fallback if #char-market-view is not present)
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
    const bagRect = bag.el && bag.el.getBoundingClientRect();
    const left = bagRect && bagRect.width ? bagRect.left - el.offsetWidth - 10 : window.innerWidth - el.offsetWidth - 20;
    el.style.left = `${Math.max(12, left)}px`;
    el.style.top = `${Math.max(12, bagRect && bagRect.width ? bagRect.top : 70)}px`;
    makeDraggable(el, el.querySelector('[data-role="drag"]'));
    wireMarketSurfaceEvents(el);
    market.el = el;
    return el;
  }

  function closeMarket() {
    market.open = false;
    market.reqToken++;
    if (market.el) market.el.remove();
    market.el = null;
  }

  function openMarketFor(item, opts = {}) {
    const hasTab4 = Boolean(document.getElementById('char-market-view'));
    if (hasTab4 && (opts.preferTab || isMarketTabActive())) {
      closeMarket();
      if (!isMarketTabActive() && typeof window.switchCharModalTab === 'function') {
        window.switchCharModalTab('market');
      }
      ensureMarketHub();
      if (hub.subTab !== 'sell') {
        hub.subTab = 'sell';
        hub.el.querySelectorAll('[data-hub-tab]').forEach(b => b.classList.toggle('active', b.dataset.hubTab === 'sell'));
        hub.el.querySelectorAll('[data-hub-pane]').forEach(p => { p.style.display = p.dataset.hubPane === 'sell' ? '' : 'none'; });
      }
    } else {
      const el = ensureMarketWindow();
      el.classList.remove('collapsed');
      market.open = true;
    }

    const host = marketHostEl();
    if (!host) return;

    const changed = !market.item || market.item.itemId !== item.itemId || market.item.slot !== item.slot;
    market.item = item;
    if (changed) {
      const globalHours = (typeof window.getGlobalMarketSettings === 'function' && window.getGlobalMarketSettings().durationHours) || 0;
      market.form = {
        qty: item.qty > 1 ? String(item.qty) : '1',
        unit: '',
        hours: [12, 24, 48].includes(Number(globalHours)) ? Number(globalHours) : (market.form.hours || 24)
      };
      market.listings = null;
      market.history = null;
    }
    if (!market.optText.trim()) {
      market.optText = parseOptionQuery(bag.query).terms.map(t => t.raw).join(', ');
    }
    const optInput = host.querySelector('[data-mk="opt"]');
    if (optInput && optInput.value !== market.optText) optInput.value = market.optText;
    renderHubSellStrip();
    renderOptHint();
    renderMarketHeader();
    renderListings();
    renderHistory();
    renderMarketSellForm();
    if (changed) loadMarketData(false);
  }

  function renderMarketHeader() {
    const host = marketHostEl();
    if (!host) return;
    const it = market.item;
    const titleEl = host.querySelector('[data-role="title"]');
    const mineEl = host.querySelector('[data-role="mine"]');
    if (!it) {
      if (titleEl) titleEl.innerHTML = `🏪 คลิกไอเทมจากแถบด้านบน หรือจากกระเป๋าด้านขวาเพื่อดูราคาและลงขาย`;
      if (mineEl) mineEl.innerHTML = '';
      return;
    }
    if (titleEl) {
      titleEl.innerHTML = `
        ${it.icon ? `<img src="${esc(gameAssetUrl(it.icon))}" alt="">` : '🏪'}
        <span style="color: ${getRarityColor(it.rarity)};">${esc(formatItemDisplayName(it))}</span>
        <small class="im-muted" style="margin-left:6px;">(ในกระเป๋า x${Number(it.qty || 1).toLocaleString()} · ช่อง #${it.slot})</small>`;
    }
    const opts = Array.isArray(it.affixes) ? it.affixes : [];
    if (mineEl) {
      mineEl.innerHTML = `
        <span class="im-mk-mine-lbl">ออฟชั่นของชิ้นนี้</span>
        ${opts.length ? renderItemStatGroups({ affixes: opts }) : '<span class="im-muted">ไม่มีออฟชั่นสุ่ม</span>'}`;
    }
    host.querySelectorAll('[data-range]').forEach(b => b.classList.toggle('active', b.dataset.range === market.range));
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
      market.listings = (r.listings || []).filter(l => l.item && Number(l.item.itemId) === Number(it.itemId));
      market.cache.set(key, { at: Date.now(), listings: market.listings });
    } else {
      market.listings = { error: r.error || 'ค้นหาตลาดไม่สำเร็จ' };
    }
    renderListings();
    renderMarketSellForm();
    if (market.history && !market.history.error) return;
    await new Promise(res => setTimeout(res, 400));
    if (token === market.reqToken) loadHistory();
  }

  function renderOptHint() {
    const host = marketHostEl();
    const box = host && host.querySelector('[data-role="opt-hint"]');
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

  function similarity(listing) {
    if (!market.item) return { score: 0, hits: 0, total: 0 };
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
    if (!market.item || !Array.isArray(market.listings)) return [];
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
    const host = marketHostEl();
    if (!host) return;
    const box = host.querySelector('[data-role="listings"]');
    const sum = host.querySelector('[data-role="list-summary"]');
    const sortEl = host.querySelector('[data-mk="sort"]');
    const refEl = host.querySelector('[data-mk="same-refine"]');
    if (sortEl) sortEl.value = market.sort;
    if (refEl) refEl.checked = market.sameRefine;
    if (!market.item) {
      if (sum) sum.innerHTML = '';
      if (box) box.innerHTML = '<div class="im-empty">เลือกไอเทมจากกระเป๋าเพื่อดูราคาตลาด</div>';
      return;
    }
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

  function historyStats(h) {
    const pts = (h.points || []).filter(p => p && p.pieces > 0);
    const pieces = pts.reduce((s, p) => s + p.pieces, 0);
    const avg = pieces ? Math.round(pts.reduce((s, p) => s + p.avg * p.pieces, 0) / pieces) : null;
    const low = pts.length ? Math.min(...pts.map(p => p.low)) : null;
    const high = pts.length ? Math.max(...pts.map(p => p.high)) : null;
    let units = (h.recent || []).map(r => Math.round(r.price / Math.max(1, r.qty))).filter(u => u > 0).sort((a, b) => a - b);
    if (units.length >= 4) {
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
    const host = marketHostEl();
    if (!host) return;
    const box = host.querySelector('[data-role="history"]');
    host.querySelectorAll('[data-range]').forEach(b => b.classList.toggle('active', b.dataset.range === market.range));
    if (!market.item) {
      if (box) box.innerHTML = '<div class="im-empty">เลือกไอเทมจากกระเป๋าเพื่อดูสถิติการขาย</div>';
      return;
    }
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
    if (rows.length) {
      const minU = Math.min(...rows.map(r => r.unit));
      q.undercut = Math.max(1, minU - 1);
      q.cheapest = minU;
    }
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
    const host = marketHostEl();
    if (!host) return;
    const form = host.querySelector('[data-role="sell"]');
    if (!form) return;
    const it = market.item;
    if (!it) {
      form.innerHTML = `<div class="im-muted" style="text-align:center; padding:6px;">คลิกเลือกไอเทมจากกระเป๋าด้านขวา หรือแถบด้านบนเพื่อตั้งราคาขาย</div>`;
      return;
    }
    const q = quickPrices();
    const stackable = it.maxStack !== 1 && it.qty > 1;
    const blocked = it.bound
      ? 'ไอเทมนี้ติดตัวละคร (Bound) ไม่สามารถลงขายตลาดกลางได้'
      : it.locked
      ? 'ไอเทมถูกล็อคอยู่ — ปลดล็อคในกระเป๋าก่อนลงขาย'
      : '';
    const active = document.activeElement && form.contains(document.activeElement) ? document.activeElement.dataset.form : null;
    form.innerHTML = `
      <div class="im-sell-grid">
        <label>จำนวนที่จะขาย
          <div class="im-inline"><input class="im-input" data-form="qty" inputmode="numeric" value="${esc(market.form.qty)}" ${stackable ? '' : 'disabled'}><small>/ ${it.qty}</small></div>
        </label>
        <label>ราคาต่อชิ้น (z)
          <input class="im-input" data-form="unit" inputmode="numeric" placeholder="เช่น 5000" value="${esc(market.form.unit)}">
        </label>
        <label>ระยะเวลาวางขาย
          <select class="im-select" data-form="hours">${MARKET_RULES.durations.map(h => `<option value="${h}" ${Number(market.form.hours) === h ? 'selected' : ''}>${h} ชั่วโมง</option>`).join('')}</select>
        </label>
      </div>
      <div class="im-quick">
        <span>ตั้งราคาเร็ว:</span>
        <button type="button" class="im-btn ghost sm" data-quick="undercut" ${q.undercut ? '' : 'disabled'}>⚡ ถูกกว่าคนอื่น 1z${q.undercut ? ` (${fmtZ(q.undercut)})` : ''}</button>
        <button type="button" class="im-btn ghost sm" data-quick="cheapest" ${q.cheapest ? '' : 'disabled'}>🏷️ เท่าถูกสุด${q.cheapest ? ` (${fmtZ(q.cheapest)})` : ''}</button>
        <button type="button" class="im-btn ghost sm" data-quick="median" ${q.median ? '' : 'disabled'}>📊 ราคากลาง${q.median ? ` (${fmtZ(q.median)})` : ''}</button>
        <button type="button" class="im-btn ghost sm" data-quick="similar" ${q.similar ? '' : 'disabled'}>✨ เท่าออฟใกล้เคียง${q.similar ? ` (${fmtZ(q.similar)})` : ''}</button>
      </div>
      <div class="im-sell-foot">
        <div class="im-sell-summary" data-role="sell-summary"></div>
        <button type="submit" class="im-btn market lg" ${blocked ? 'disabled' : ''}>🏪 ลงขายในตลาดกลาง</button>
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
    if (!it) return { qty: 1, unit: 0, total: 0, taxPct: 8, deposit: 0, receive: 0 };
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
    const host = marketHostEl();
    const box = host && host.querySelector('[data-role="sell-summary"]');
    if (!box) return;
    const n = sellNumbers();
    box.innerHTML = n.total > 0
      ? `<span>ราคารวม <b>${fmtZ(n.total)}</b></span><span>มัดจำ ${fmtZ(n.deposit)} (คืนเมื่อขายได้)</span><span>ขายได้รับ <b class="ok">${fmtZ(n.receive)}</b> (หักภาษี ${n.taxPct}%)</span>`
      : '<span class="im-muted">ใส่ราคาต่อชิ้น หรือกดปุ่มตั้งราคาเร็วด้านบน</span>';
  }

  async function submitListing() {
    const it = market.item;
    if (!it) return;
    const n = sellNumbers();
    if (!(n.unit > 0)) { toast('ใส่ราคาต่อชิ้นก่อน', 'err'); return; }
    const ok = confirm(`ลงขาย ${formatItemDisplayName(it)} x${n.qty}\nราคารวม ${fmtZ(n.total)} (${fmtZ(n.unit)}/ชิ้น) · ${market.form.hours} ชั่วโมง\nมัดจำ ${fmtZ(n.deposit)} · ขายได้รับ ${fmtZ(n.receive)}\n\nยืนยัน?`);
    if (!ok) return;
    const host = marketHostEl();
    const btn = host && host.querySelector('.im-mk-sell button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังลงขาย...'; }
    const r = await api(`/api/profiles/${encodeURIComponent(bag.profileId)}/market`, {
      op: 'list', slot: it.slot, itemId: it.itemId, qty: n.qty, price: n.total, hours: Number(market.form.hours)
    });
    if (!r.success) toast(`❌ ${r.error || 'ลงขายไม่สำเร็จ'}`, 'err');
    else if (r.confirmed) toast(`✅ ลงขาย ${it.name} x${n.qty} ราคา ${fmtZ(n.total)} แล้ว`);
    else toast('ส่งคำสั่งลงขายแล้ว แต่ยังไม่เห็นไอเทมออกจากกระเป๋า — ตรวจที่ "ของที่ลงขายอยู่"', 'warn');
    if (r.success) {
      bag.selected = null;
      market.item = null;
      market.cache.clear();
    }
    await Promise.all([refreshBag(), refreshMineMarket()]);
    if (r.success) {
      if (market.open) closeMarket();
      else {
        renderHubSellStrip();
        renderMarketHeader();
        renderListings();
        renderHistory();
        renderMarketSellForm();
      }
    } else {
      renderMarketSellForm();
    }
  }

  // ==========================================================================
  // PUBLIC API (called from app.js when the character window opens/closes/switches tab)
  // ==========================================================================
  window.InvMarket = {
    open(profileId) {
      if (bag.profileId !== profileId) {
        bag.data = null;
        bag.selected = null;
        bag.query = '';
        hub.mine = null;
        hub.browse.results = null;
        market.item = null;
        closeMarket();
      }
      bag.profileId = profileId;

      ensureHalloweenPanel();
      const bagEl = ensureBagPanel();
      ensureMarketHub();

      if (bagEl) {
        bagEl.querySelector('[data-role="query"]').value = bag.query;
        bagEl.querySelector('[data-role="grid"]').innerHTML = bag.data ? '' : '<div class="im-empty">⏳ กำลังโหลดกระเป๋า...</div>';
        if (bag.data) renderBag();
      }

      refreshBag();
      refreshMineMarket(); // preloads delivery count badge on Tab 4
      refreshAutoSellHub(); // preloads Auto Sell rule count badge on Tab 4

      clearInterval(bag.timer);
      bag.timer = setInterval(() => {
        if (!document.hidden) {
          refreshBag();
        }
      }, 4000);
      setTimeout(syncSidePanelHeights, 50);
    },
    openMarketTab(profileId, subTab) {
      if (profileId && bag.profileId !== profileId) {
        this.open(profileId);
      }
      if (subTab) hub.subTab = subTab;
      ensureMarketHub();
      switchHubSubTab(hub.subTab || 'sell');
      refreshMineMarket();
    },
    openHalloweenDrawer(profileId) {
      ensureHalloweenPanel();
      if (profileId) hw.profileId = profileId;
      setHwDrawerOpen(true);
    },
    close() {
      clearInterval(bag.timer);
      bag.timer = null;
      closeMarket();
    },
    refresh: refreshBag
  };

  function initMainPageHalloweenDrawer() {
    ensureHalloweenPanel();
    refreshHalloween();
    setInterval(() => {
      if (!document.hidden && !hw.open) refreshHalloween();
    }, 15000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMainPageHalloweenDrawer);
  } else {
    initMainPageHalloweenDrawer();
  }
})();
