// manager/inventory_market_api.js — Bag (inventory) and Market endpoints for the Manager.
//
// Every request becomes a fixed eval snippet run inside the game client. User input only
// ever enters the snippet as JSON-encoded, validated values (never as code).
//
//   GET  /api/profiles/:id/inventory          full bag + weight/zeny/premium
//   POST /api/profiles/:id/inventory-action   { op: use|equip|lock|destroy|sort, slot, itemId, ... }
//   POST /api/profiles/:id/market             { op: search|history|list, ... }

const fs = require('fs');
const path = require('path');

const HALLOWEEN_STORE_PATH = path.join(__dirname, 'data', 'halloween_exchange.json');
const AUTOSELL_STORE_PATH = path.join(__dirname, 'data', 'autosell_configs.json');
const BROWSER_STORAGE_DIR = path.join(__dirname, '..', 'sessions', '_browser_storage');

function sanitizeAutoSellConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const rawRules = Array.isArray(cfg.rules) ? cfg.rules : [];
  const seen = new Set();
  const rules = [];
  rawRules.forEach((r, idx) => {
    if (!r || typeof r !== 'object') return;
    const itemName = String(r.itemName || '').trim();
    const id = String(r.id || `rule_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`);
    const minQty = Math.max(1, Math.min(99999, parseInt(r.minQty, 10) || 1));
    const sellMode = r.sellMode === 'min' ? 'min' : 'all';
    const enabled = r.enabled !== false;
    const key = itemName ? itemName.toLowerCase() : `__empty_${id}`;
    if (itemName && seen.has(key)) return;
    if (itemName) seen.add(key);
    rules.push({ id, itemName, minQty, sellMode, enabled });
  });
  return {
    enabled: Boolean(cfg.enabled),
    priceStrategy: String(cfg.priceStrategy || 'median'),
    checkIntervalSec: Number(cfg.checkIntervalSec) || 25,
    maxActiveListings: Number(cfg.maxActiveListings) || 10,
    rules
  };
}

function loadAllAutoSellStore() {
  try {
    if (fs.existsSync(AUTOSELL_STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(AUTOSELL_STORE_PATH, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (_) {}
  return {};
}

function loadProfileAutoSellStore(profileId) {
  const pid = String(profileId || '').trim();
  const all = loadAllAutoSellStore();
  if (pid && all[pid] && typeof all[pid] === 'object') {
    return sanitizeAutoSellConfig(all[pid]);
  }
  try {
    const bsFile = path.join(BROWSER_STORAGE_DIR, `${pid}.json`);
    if (fs.existsSync(bsFile)) {
      const d = JSON.parse(fs.readFileSync(bsFile, 'utf8'));
      const rawStr = d[`pelican_${pid}__auto_market_sell_cfg`] || d.pelican_auto_market_sell_cfg;
      if (rawStr) {
        return sanitizeAutoSellConfig(JSON.parse(rawStr));
      }
    }
  } catch (_) {}
  return sanitizeAutoSellConfig({ enabled: false, priceStrategy: 'median', rules: [] });
}

function saveProfileAutoSellStore(profileId, rawCfg) {
  const pid = String(profileId || '').trim();
  const clean = sanitizeAutoSellConfig(rawCfg);
  if (!pid) return clean;
  try {
    const all = loadAllAutoSellStore();
    all[pid] = Object.assign({}, clean, { updatedAt: Date.now() });
    fs.mkdirSync(path.dirname(AUTOSELL_STORE_PATH), { recursive: true });
    fs.writeFileSync(AUTOSELL_STORE_PATH, JSON.stringify(all, null, 2), 'utf8');
  } catch (_) {}
  try {
    fs.mkdirSync(BROWSER_STORAGE_DIR, { recursive: true });
    const bsFile = path.join(BROWSER_STORAGE_DIR, `${pid}.json`);
    let d = {};
    if (fs.existsSync(bsFile)) {
      try { d = JSON.parse(fs.readFileSync(bsFile, 'utf8')) || {}; } catch (_) { d = {}; }
    }
    const serialized = JSON.stringify(clean);
    d[`pelican_${pid}__auto_market_sell_cfg`] = serialized;
    d.pelican_auto_market_sell_cfg = serialized;
    fs.writeFileSync(bsFile, JSON.stringify(d, null, 2), 'utf8');
  } catch (_) {}
  return clean;
}

function buildAutoSellReadCode() {
  return `(() => {
    const cfg = window.__autoMarketSellConfig || { enabled: false, priceStrategy: 'median', rules: [] };
    const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
    const bagItems = (typeof window.getBagItems === 'function') ? window.getBagItems() : [];
    const gearKept = it => typeof window.isGearKeptItem === 'function' && window.isGearKeptItem(it.raw || it);
    const stashOnly = it => typeof window.isStashOnlyItem === 'function' && window.isStashOnlyItem(it.raw || it);
    const iconByName = new Map();
    const bagSummaryMap = new Map();
    for (const it of bagItems) {
      if (!it || !it.name) continue;
      const nm = String(it.name).trim();
      const key = nm.toLowerCase();
      const icon = it.icon || (it.raw && it.raw.icon) || '';
      if (icon && !iconByName.has(key)) iconByName.set(key, icon);
      if (!it.bound && !it.locked && !gearKept(it)) {
        const cur = bagSummaryMap.get(key) || { name: nm, itemId: it.itemId || it.id || 0, qty: 0, icon: icon || '' };
        cur.qty += (Number(it.qty) || 1);
        if (!cur.icon && icon) cur.icon = icon;
        bagSummaryMap.set(key, cur);
      }
    }
    const ruleStates = {};
    for (const r of rules) {
      if (!r || !r.id) continue;
      const nm = String(r.itemName || '').trim();
      const norm = nm.toLowerCase();
      let totalCount = 0;
      let sampleItem = null;
      for (const it of bagItems) {
        if (it && !it.locked && it.name && String(it.name).trim().toLowerCase() === norm && !gearKept(it) && !stashOnly(it)) {
          totalCount += (Number(it.qty) || 1);
          if (!sampleItem) sampleItem = it;
        }
      }
      const threshold = Math.max(1, Number(r.minQty) || 1);
      const gdReserve = (typeof window.getGuildDonationReserveQty === 'function') ? (Number(window.getGuildDonationReserveQty(sampleItem || nm)) || 0) : 0;
      const gearReserve = (typeof window.getGearOreReserveQty === 'function') ? (Number(window.getGearOreReserveQty(sampleItem || nm)) || 0) : 0;
      const reserveQty = Math.max(gdReserve, gearReserve);
      const sellableQty = Math.max(0, totalCount - reserveQty);
      const effectiveThreshold = reserveQty > 0
        ? ((r.sellMode === 'min' || threshold <= reserveQty) ? (reserveQty + threshold) : threshold)
        : threshold;
      const ready = Boolean(nm && totalCount >= effectiveThreshold && sellableQty > 0);
      ruleStates[r.id] = {
        bagQty: totalCount,
        reserveQty,
        sellableQty,
        effectiveThreshold,
        ready,
        icon: iconByName.get(norm) || ''
      };
    }
    const activeCount = Number(window.__myMarketActiveCount) || 0;
    const maxListings = (typeof window.getEffectiveMarketMaxListings === 'function') ? Number(window.getEffectiveMarketMaxListings()) : (Number(cfg.maxActiveListings) || 8);
    return {
      success: true,
      config: {
        enabled: Boolean(cfg.enabled),
        priceStrategy: cfg.priceStrategy || 'median',
        checkIntervalSec: Number(cfg.checkIntervalSec) || 25,
        maxActiveListings: Number(cfg.maxActiveListings) || 10,
        rules: rules.map(r => ({
          id: String(r.id || ''),
          itemName: String(r.itemName || '').trim(),
          minQty: Math.max(1, Number(r.minQty) || 1),
          sellMode: r.sellMode === 'min' ? 'min' : 'all',
          enabled: r.enabled !== false
        }))
      },
      ruleStates,
      activeCount,
      maxListings,
      isBotRunning: Boolean(window.__isBotRunning),
      bagItemsSummary: Array.from(bagSummaryMap.values()).sort((a, b) => b.qty - a.qty)
    };
  })()`;
}

function buildAutoSellSaveCode(cleanCfg) {
  return `(() => {
    const next = ${JSON.stringify(cleanCfg)};
    window.__autoMarketSellConfig = Object.assign({}, window.__autoMarketSellConfig || {}, next);
    try { localStorage.setItem('pelican_auto_market_sell_cfg', JSON.stringify(window.__autoMarketSellConfig)); } catch (e) {}
    const en = Boolean(window.__autoMarketSellConfig.enabled);
    const t1 = document.getElementById('p-autosell-toggle');
    if (t1) t1.checked = en;
    const t2 = document.getElementById('p-autosell-toggle-hud');
    if (t2) t2.checked = en;
    const badge = document.getElementById('p-subtab-autosell-count');
    if (badge && Array.isArray(window.__autoMarketSellConfig.rules)) badge.innerText = String(window.__autoMarketSellConfig.rules.length);
    if (typeof window.renderAutoSellHudRulesHtml === 'function') {
      const hudBox = document.getElementById('p-autosell-hud-rules-container');
      if (hudBox) hudBox.innerHTML = window.renderAutoSellHudRulesHtml();
    }
    if (typeof window.renderAutoSellRulesHtml === 'function') {
      const modBox = document.getElementById('p-autosell-rules-container');
      if (modBox) modBox.innerHTML = window.renderAutoSellRulesHtml();
    }
    return (${buildAutoSellReadCode()});
  })()`;
}

function loadGlobalHalloweenStore() {
  try {
    if (fs.existsSync(HALLOWEEN_STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(HALLOWEEN_STORE_PATH, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        return {
          enabled: parsed.enabled !== false,
          rules: (parsed.rules && typeof parsed.rules === 'object') ? parsed.rules : {}
        };
      }
    }
  } catch (_) {}
  return { enabled: true, rules: {} };
}

function saveGlobalHalloweenStore(cfg) {
  const cleanRules = {};
  const rawRules = (cfg && cfg.rules && typeof cfg.rules === 'object') ? cfg.rules : {};
  WITCH_HAZEL_ITEMS.forEach(it => {
    const k = String(it.itemId);
    const r = rawRules[k];
    if (r && typeof r === 'object') {
      cleanRules[k] = {
        enabled: !!r.enabled,
        minQty: Math.max(1, Math.min(9999, parseInt(r.minQty, 10) || 1))
      };
    }
  });
  const out = {
    enabled: cfg && cfg.enabled !== undefined ? !!cfg.enabled : true,
    rules: cleanRules,
    updatedAt: Date.now()
  };
  try {
    fs.mkdirSync(path.dirname(HALLOWEEN_STORE_PATH), { recursive: true });
    fs.writeFileSync(HALLOWEEN_STORE_PATH, JSON.stringify(out, null, 2), 'utf8');
  } catch (_) {}
  return out;
}

const ROOM_JS = `((typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom)`;

// Resolve the icon from the game's manifest (by itemId, then name key) as an absolute URL.
const ICON_JS = `((raw, name) => {
  const base = 'https://www.aetheria-online.in.th/art/icons/';
  const m = window.__itemIconManifest;
  const id = raw && (raw.itemId ?? raw.id);
  if (m && m.items && id !== undefined && m.items[id]) return base + m.items[id];
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (m && m.itemKeys && m.itemKeys[slug]) return base + m.itemKeys[slug];
  return slug ? base + 'items/' + slug + '.webp' : null;
})`;

// Find the bag item at `slot` and make sure it is still the item the user clicked.
// Guards against the bag shifting (sort, pickups) between render and click.
const FIND_ITEM_JS = `((slot, itemId) => {
  const bag = (typeof window.getBagItems === 'function') ? window.getBagItems() : [];
  const b = bag.find(x => Number(x.slot) === Number(slot));
  if (!b) return { error: 'ไม่พบไอเทมในช่องกระเป๋านี้แล้ว (กระเป๋าอาจถูกจัดเรียงใหม่)' };
  const raw = b.raw || {};
  const realId = raw.itemId ?? b.id;
  if (itemId !== null && itemId !== undefined && Number(realId) !== Number(itemId)) {
    return { error: 'ไอเทมในช่องนี้เปลี่ยนไปแล้ว กรุณารีเฟรชกระเป๋าแล้วลองใหม่' };
  }
  return { b, raw };
})`;

const MARKET_DURATIONS = [12, 24, 48];
const HISTORY_RANGES = ['24h', '7d', '30d'];

function toInt(v, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch (e) { resolve(null); }
    });
  });
}

function buildInventoryCode() {
  return `(() => {
    const room = ${ROOM_JS};
    const inv = window.__latestInventory || {};
    const bag = (typeof window.getBagItems === 'function') ? window.getBagItems() : [];
    const ch = (typeof window.getLiveCharacterData === 'function' ? window.getLiveCharacterData() : null) || window.__latestCharacterData || {};
    const icon = ${ICON_JS};
    const premium = Array.isArray(ch.buffs) && ch.buffs.some(b => b && b.skillId === 'ui:token');
    return {
      success: true,
      connected: !!(room && room.connection && room.connection.isOpen),
      slots: inv.slots || 100,
      weight: inv.weight ?? null,
      weightLimit: inv.weightLimit ?? null,
      zeny: (typeof window.__currentZeny === 'number') ? window.__currentZeny : (typeof ch.zeny === 'number' ? ch.zeny : null),
      premium,
      baseLevel: ch.baseLevel ?? null,
      classId: ch.classId ?? null,
      items: bag.map(b => {
        const r = b.raw || {};
        return {
          slot: b.slot, itemId: r.itemId ?? b.id, name: r.name || b.name, qty: b.qty,
          refine: b.refine || r.refine || 0, type: r.type || null, equipType: r.equipType || null,
          weaponType: r.weaponType || null, weight: r.weight ?? null, sellPrice: r.sellPrice ?? null,
          levelReq: r.levelReq || 0, jobs: r.jobs || null, rarity: r.rarity || 'common', slots: r.slots || 0,
          cards: r.cards || [], attributes: r.attributes || [], affixes: r.affixes || [], effects: r.effects || [],
          maxStack: r.maxStack ?? null, usable: !!r.usable, destroyable: r.destroyable !== false,
          locked: !!r.locked, icon: icon(r, r.name || b.name)
        };
      })
    };
  })()`;
}

function buildInventoryActionCode(p) {
  const op = p.op;
  const slot = toInt(p.slot, 0, 999);
  const itemId = p.itemId === undefined || p.itemId === null ? null : Number(p.itemId);
  if (op === 'sort') {
    return { code: `(() => { const room = ${ROOM_JS}; if (!room || !room.connection?.isOpen) return { success: false, error: 'ไม่ได้เชื่อมต่อเกม' }; room.send('inv_sort', {}); return { success: true }; })()` };
  }
  if (slot === null) return { error: 'ช่องกระเป๋าไม่ถูกต้อง' };

  let send;
  if (op === 'use') send = `room.send('inv_use', { slot: ${slot} })`;
  else if (op === 'equip') send = `room.send('equip', { slot: ${slot} })`;
  else if (op === 'lock') send = `room.send('inv_lock', { slot: ${slot}, locked: ${p.locked ? 'true' : 'false'} })`;
  else if (op === 'destroy') {
    const qty = toInt(p.qty, 1, 100000);
    if (qty === null) return { error: 'จำนวนไม่ถูกต้อง' };
    send = `(() => { if (found.raw.locked) throw new Error('ไอเทมถูกล็อคอยู่ ปลดล็อคก่อนทิ้ง'); if (${qty} > Number(found.b.qty)) throw new Error('จำนวนเกินที่มีในกระเป๋า'); room.send('inv_destroy', { slot: ${slot}, qty: ${qty} }); })()`;
  } else return { error: 'ไม่รู้จักคำสั่ง ' + op };

  return {
    code: `(() => {
      const room = ${ROOM_JS};
      if (!room || !room.connection?.isOpen) return { success: false, error: 'ไม่ได้เชื่อมต่อเกม' };
      const found = (${FIND_ITEM_JS})(${slot}, ${JSON.stringify(itemId)});
      if (found.error) return { success: false, error: found.error };
      try { ${send}; } catch (e) { return { success: false, error: e.message }; }
      return { success: true };
    })()`
  };
}

// Await one reply of `type` after running `send`. Manager-initiated market searches pause the
// bot's sniper/auto-buy so a price lookup can never trigger an automatic purchase.
const AWAIT_REPLY_JS = `((room, type, send, ms) => new Promise(resolve => {
  let unsub;
  const t = setTimeout(() => { if (unsub) unsub(); resolve(null); }, ms);
  unsub = room.onMessage(type, msg => { clearTimeout(t); if (unsub) unsub(); resolve(msg); });
  send();
}))`;

function buildMarketCode(p) {
  if (p.op === 'search') {
    const q = String(p.q || '').slice(0, 60).trim();
    if (!q) return { error: 'ต้องระบุชื่อไอเทม' };
    const pages = toInt(p.pages ?? 3, 1, 6);
    const affix = p.affix ? String(p.affix).replace(/[^A-Z_]/g, '').slice(0, 40) : null;
    const affixMin = p.affix ? toInt(p.affixMin ?? 0, 0, 100000) : null;
    const filters = { q, sort: 'price_asc' };
    if (affix) { filters.affix = affix; if (affixMin) filters.affixMin = affixMin; }
    return {
      timeout: 4000 + pages * 2500,
      code: `(async () => {
        const room = ${ROOM_JS};
        if (!room || !room.connection?.isOpen) return { success: false, error: 'ไม่ได้เชื่อมต่อเกม' };
        const awaitReply = ${AWAIT_REPLY_JS};
        const cfg = window.__marketFilterConfig || {};
        const shared = typeof window.pauseSniper === 'function';
        const saved = { autoBuy: cfg.autoBuy, sniperAlert: cfg.sniperAlert };
        if (shared) window.pauseSniper(); else { cfg.autoBuy = false; cfg.sniperAlert = false; }
        const listings = []; let total = 0;
        try {
          for (let page = 0; page < ${pages}; page++) {
            if (page > 0) await new Promise(r => setTimeout(r, 350));
            const res = await awaitReply(room, 'market_results', () => room.send('market', { op: 'search', filters: Object.assign(${JSON.stringify(filters)}, { page }) }), 3000);
            if (!res || !Array.isArray(res.listings)) break;
            total = res.total || 0;
            listings.push(...res.listings);
            if (listings.length >= total || res.listings.length < (res.pageSize || 20)) break;
          }
        } finally {
          if (shared) window.resumeSniper(); else setTimeout(() => { cfg.autoBuy = saved.autoBuy; cfg.sniperAlert = saved.sniperAlert; }, 400);
        }
        const icon = ${ICON_JS};
        listings.forEach(l => {
          if (l && l.item && !l.item.icon) l.item.icon = icon(l.item, l.item.name);
        });
        return { success: true, total, listings };
      })()`
    };
  }

  if (p.op === 'mine' || p.op === 'collect' || p.op === 'collect_all' || p.op === 'cancel') {
    let actionJs = `room.send('market', { op: 'mine' });`;
    let targetCancelId = 0;
    let targetCollectId = 0;
    if (p.op === 'collect') {
      const deliveryId = toInt(p.deliveryId ?? p.id, 1, 2000000000);
      if (deliveryId === null) return { error: 'deliveryId ไม่ถูกต้อง' };
      targetCollectId = deliveryId;
      actionJs = `room.send('market', { op: 'collect', deliveryId: ${deliveryId} });`;
    } else if (p.op === 'collect_all') {
      actionJs = `room.send('market', { op: 'collect_all' });`;
    } else if (p.op === 'cancel') {
      const listingId = toInt(p.listingId ?? p.id, 1, 2000000000);
      if (listingId === null) return { error: 'listingId ไม่ถูกต้อง' };
      targetCancelId = listingId;
      actionJs = `room.send('market', { op: 'cancel', listingId: ${listingId} });`;
    }
    return {
      timeout: 8000,
      code: `(async () => {
        const room = ${ROOM_JS};
        if (!room || !room.connection?.isOpen) return { success: false, error: 'ไม่ได้เชื่อมต่อเกม' };
        const awaitReply = ${AWAIT_REPLY_JS};
        const icon = ${ICON_JS};
        let mine = null;
        if (${JSON.stringify(p.op)} === 'mine') {
          mine = await awaitReply(room, 'market_mine', () => { ${actionJs} }, 4500);
        } else {
          try { ${actionJs} } catch (_) {}
          await new Promise(r => setTimeout(r, 420));
          mine = await awaitReply(room, 'market_mine', () => {
            try { room.send('market', { op: 'mine' }); } catch (_) {}
          }, 4000);
          if (${targetCancelId} > 0 && mine && Array.isArray(mine.active) && mine.active.some(e => Number(e && (e.listingId ?? e.id)) === ${targetCancelId})) {
            await new Promise(r => setTimeout(r, 450));
            const retryMine = await awaitReply(room, 'market_mine', () => {
              try { room.send('market', { op: 'mine' }); } catch (_) {}
            }, 3500);
            if (retryMine) mine = retryMine;
          }
          if (${targetCollectId} > 0 && mine && Array.isArray(mine.deliveries) && mine.deliveries.some(e => Number(e && (e.deliveryId ?? e.id)) === ${targetCollectId})) {
            await new Promise(r => setTimeout(r, 400));
            const retryMine = await awaitReply(room, 'market_mine', () => {
              try { room.send('market', { op: 'mine' }); } catch (_) {}
            }, 3500);
            if (retryMine) mine = retryMine;
          }
          if (!mine) {
            mine = await awaitReply(room, 'market_mine', () => {
              try { room.send('market', { op: 'mine' }); } catch (_) {}
            }, 3500);
          }
        }
        if (!mine) return { success: false, error: 'เซิร์ฟเวอร์ตลาดไม่ตอบกลับ (ลองใหม่อีกครั้ง)' };
        const enrich = list => (Array.isArray(list) ? list : []).map(entry => {
          if (entry && entry.item) {
            entry.item.icon = entry.item.icon || icon(entry.item, entry.item.name);
          }
          if (entry && entry.id === undefined) {
            if (entry.listingId !== undefined) entry.id = entry.listingId;
            else if (entry.deliveryId !== undefined) entry.id = entry.deliveryId;
          }
          return entry;
        });
        const ch = (typeof window.getLiveCharacterData === 'function' ? window.getLiveCharacterData() : null) || window.__latestCharacterData || {};
        const premium = Array.isArray(ch.buffs) && ch.buffs.some(b => b && b.skillId === 'ui:token');
        const zeny = (typeof window.__currentZeny === 'number') ? window.__currentZeny : (typeof ch.zeny === 'number' ? ch.zeny : 0);
        let active = enrich(mine.active);
        const closed = enrich(mine.closed);
        let deliveries = enrich(mine.deliveries);
        if (${targetCancelId} > 0) {
          active = active.filter(e => Number(e && (e.listingId ?? e.id)) !== ${targetCancelId});
        }
        if (${targetCollectId} > 0) {
          deliveries = deliveries.filter(e => Number(e && (e.deliveryId ?? e.id)) !== ${targetCollectId});
        }
        window.__lastMarketMine = { active, closed, deliveries };
        window.__myMarketActiveCount = active.length;
        const activeLimit = premium ? 20 : 5;
        return {
          success: true,
          zeny,
          premium,
          maxListings: activeLimit,
          activeLimit,
          active,
          closed,
          deliveries,
          mine: {
            active,
            closed,
            deliveries
          }
        };
      })()`
    };
  }

  if (p.op === 'buy') {
    const listingId = toInt(p.listingId, 1, 2000000000);
    const price = toInt(p.price, 1, 2000000000);
    if (listingId === null || price === null) return { error: 'ข้อมูลการซื้อไม่ถูกต้อง' };
    return {
      timeout: 6500,
      code: `(async () => {
        const room = ${ROOM_JS};
        if (!room || !room.connection?.isOpen) return { success: false, error: 'ไม่ได้เชื่อมต่อเกม' };
        const awaitReply = ${AWAIT_REPLY_JS};
        const zenyBefore = (typeof window.__currentZeny === 'number') ? window.__currentZeny : 0;
        if (zenyBefore > 0 && zenyBefore < ${price}) {
          return { success: false, error: 'เงิน Zeny ในตัวไม่พอซื้อรายการนี้' };
        }
        await awaitReply(room, 'market_done', () => room.send('market', { op: 'buy', listingId: ${listingId}, price: ${price} }), 4000);
        await new Promise(r => setTimeout(r, 300));
        const zenyAfter = (typeof window.__currentZeny === 'number') ? window.__currentZeny : zenyBefore;
        return { success: true, zenyBefore, zenyAfter };
      })()`
    };
  }

  if (p.op === 'trades') {
    return {
      timeout: 6500,
      code: `(async () => {
        const room = ${ROOM_JS};
        if (!room || !room.connection?.isOpen) return { success: false, error: 'ไม่ได้เชื่อมต่อเกม' };
        const awaitReply = ${AWAIT_REPLY_JS};
        const icon = ${ICON_JS};
        const res = await awaitReply(room, 'market_trades', () => room.send('market', { op: 'trades' }), 4500);
        if (!res) return { success: false, error: 'โหลดประวัติการซื้อขายไม่สำเร็จ' };
        const trades = (Array.isArray(res.trades) ? res.trades : []).map(t => {
          if (t && t.item) t.item.icon = t.item.icon || icon(t.item, t.item.name);
          return t;
        });
        return { success: true, trades };
      })()`
    };
  }

  if (p.op === 'history') {
    const itemId = toInt(p.itemId, 1, 10000000);
    const refine = toInt(p.refine ?? 0, 0, 30);
    const range = HISTORY_RANGES.includes(p.range) ? p.range : '7d';
    if (itemId === null || refine === null) return { error: 'itemId ไม่ถูกต้อง' };
    return {
      timeout: 7000,
      code: `(async () => {
        const room = ${ROOM_JS};
        if (!room || !room.connection?.isOpen) return { success: false, error: 'ไม่ได้เชื่อมต่อเกม' };
        const awaitReply = ${AWAIT_REPLY_JS};
        const msg = await awaitReply(room, 'market_history', () => room.send('market', { op: 'history', itemId: ${itemId}, refine: ${refine}, range: '${range}' }), 5000);
        if (!msg) return { success: false, error: 'เซิร์ฟเวอร์ไม่ตอบกลับ (ลองใหม่อีกครั้ง)' };
        return { success: true, history: msg };
      })()`
    };
  }

  if (p.op === 'list') {
    const slot = toInt(p.slot, 0, 999);
    const itemId = toInt(p.itemId, 1, 10000000);
    const qty = toInt(p.qty, 1, 100000);
    const price = toInt(p.price, 1, 2000000000);
    const hours = MARKET_DURATIONS.includes(Number(p.hours)) ? Number(p.hours) : null;
    if (slot === null || itemId === null || qty === null || price === null || hours === null) {
      return { error: 'ข้อมูลการลงขายไม่ครบหรือไม่ถูกต้อง' };
    }
    return {
      timeout: 6000,
      code: `(async () => {
        const room = ${ROOM_JS};
        if (!room || !room.connection?.isOpen) return { success: false, error: 'ไม่ได้เชื่อมต่อเกม' };
        const found = (${FIND_ITEM_JS})(${slot}, ${itemId});
        if (found.error) return { success: false, error: found.error };
        if (found.raw.locked) return { success: false, error: 'ไอเทมถูกล็อคอยู่ ปลดล็อคก่อนลงขาย' };
        const before = Number(found.b.qty) || 0;
        if (${qty} > before) return { success: false, error: 'จำนวนเกินที่มีในกระเป๋า' };
        room.send('market', { op: 'list', slot: ${slot}, qty: ${qty}, price: ${price}, hours: ${hours} });
        // Confirm by watching the bag: the listed quantity leaves the slot when the server accepts it.
        for (let i = 0; i < 12; i++) {
          await new Promise(r => setTimeout(r, 250));
          const bag = (typeof window.getBagItems === 'function') ? window.getBagItems() : [];
          const now = bag.find(x => Number(x.slot) === ${slot} && Number((x.raw && x.raw.itemId) ?? x.id) === ${itemId});
          const left = now ? Number(now.qty) || 0 : 0;
          if (left <= before - ${qty}) return { success: true, confirmed: true };
        }
        return { success: true, confirmed: false };
      })()`
    };
  }

  return { error: 'ไม่รู้จักคำสั่งตลาด ' + p.op };
}

// ==========================================================================
// HALLOWEEN EVENT EXCHANGE (NPC Witch Hazel, npcId: 223, shopId: 950)
// ==========================================================================
const CANDY_ICON = 'https://www.aetheria-online.in.th/art/icons/items/halloween-candy.webp';
const PUMPKIN_ICON = 'https://www.aetheria-online.in.th/art/icons/items/golden-pumpkin.webp';

const WITCH_HAZEL_ITEMS = [
  {
    itemId: 90888, name: 'Halloween Box', type: 'Consumable', rarity: 'epic', price: 0, bound: false,
    icon: 'https://www.aetheria-online.in.th/art/icons/items/halloween-box.webp',
    cost: [
      { itemId: 90880, name: 'Halloween Candy', amount: 200, qty: 200, icon: CANDY_ICON },
      { itemId: 90881, name: 'Golden Pumpkin', amount: 1, qty: 1, icon: PUMPKIN_ICON }
    ],
    limit: { max: 10, perAccount: true, reset: 'Daily' },
    desc: 'กล่องสุ่มฮาโลวีน (แลกเปลี่ยน/ตั้งขายตลาดกลางได้)'
  },
  {
    itemId: 90340, name: 'Enchant Rune', type: 'Enchantment', rarity: 'rare', price: 0, bound: true,
    icon: 'https://www.aetheria-online.in.th/art/icons/items/greater-enchant-rune.webp',
    cost: [{ itemId: 90880, name: 'Halloween Candy', amount: 150, qty: 150, icon: CANDY_ICON }],
    limit: { max: 100, perAccount: true, reset: 'Weekly' },
    desc: 'รูนสุ่มออปชั่นอุปกรณ์'
  },
  {
    itemId: 90341, name: 'Accessory Enchant Rune', type: 'Enchantment', rarity: 'epic', price: 0, bound: true,
    icon: 'https://www.aetheria-online.in.th/art/icons/items/accessory-enchant-rune.webp',
    cost: [
      { itemId: 90880, name: 'Halloween Candy', amount: 1000, qty: 1000, icon: CANDY_ICON },
      { itemId: 90881, name: 'Golden Pumpkin', amount: 1, qty: 1, icon: PUMPKIN_ICON }
    ],
    limit: { max: 10, perAccount: true, reset: 'Weekly' },
    desc: 'รูนสุ่มออปชั่นเครื่องประดับ'
  },
  {
    itemId: 90889, name: 'Socket Charm', type: 'Enchantment', rarity: 'legendary', price: 0, bound: true,
    icon: 'https://www.aetheria-online.in.th/art/icons/items/socket-charm.webp',
    cost: [
      { itemId: 90880, name: 'Halloween Candy', amount: 5000, qty: 5000, icon: CANDY_ICON },
      { itemId: 90881, name: 'Golden Pumpkin', amount: 30, qty: 30, icon: PUMPKIN_ICON }
    ],
    limit: { max: 2, perAccount: true, reset: 'Weekly' },
    desc: 'ยันต์เจาะรูอุปกรณ์การันตีสำเร็จ 100%'
  },
  {
    itemId: 90206, name: 'Enriched Elunium', type: 'Enchantment', rarity: 'epic', price: 0, bound: true,
    icon: 'https://www.aetheria-online.in.th/art/icons/items/enriched-elunium.webp',
    cost: [{ itemId: 90880, name: 'Halloween Candy', amount: 300, qty: 300, icon: CANDY_ICON }],
    limit: { max: 5, perAccount: true, reset: 'None' },
    desc: 'แร่อีลูเนียมบริสุทธิ์ เพิ่มโอกาสตีบวกชุดเกราะ'
  },
  {
    itemId: 90886, name: 'Halloween Pecopeco Hairband', type: 'Equipment', equipType: 'Helmet', rarity: 'epic', price: 5000000, bound: true,
    icon: 'https://www.aetheria-online.in.th/art/icons/items/pecopeco-hairband.webp',
    cost: [
      { itemId: 90880, name: 'Halloween Candy', amount: 2000, qty: 2000, icon: CANDY_ICON },
      { itemId: 90881, name: 'Golden Pumpkin', amount: 15, qty: 15, icon: PUMPKIN_ICON }
    ],
    limit: { max: 1, perAccount: true, reset: 'None' },
    desc: 'หมวกคาดผมเปโกะฮาโลวีน (Move Speed +5%)'
  },
  {
    itemId: 90887, name: 'Halloween Snake Head', type: 'Equipment', equipType: 'Helmet', rarity: 'epic', price: 5000000, bound: true,
    icon: 'https://www.aetheria-online.in.th/art/icons/items/coiled-snake-hat.webp',
    cost: [
      { itemId: 90880, name: 'Halloween Candy', amount: 2000, qty: 2000, icon: CANDY_ICON },
      { itemId: 90881, name: 'Golden Pumpkin', amount: 15, qty: 15, icon: PUMPKIN_ICON }
    ],
    limit: { max: 1, perAccount: true, reset: 'None' },
    desc: 'หมวกงูฮาโลวีน (Double Attack +10%)'
  },
  {
    itemId: 90882, name: 'Pumpkin Head Hat', type: 'Equipment', equipType: 'CostumeHeadTop', rarity: 'rare', price: 0, bound: true,
    icon: 'https://www.aetheria-online.in.th/art/icons/items/pumpkin-head-hat.webp',
    cost: [],
    limit: { max: 1, perAccount: true, reset: 'None' },
    desc: 'คอสตูมหมวกหัวฟักทองฮาโลวีน (รับฟรี)'
  },
  {
    itemId: 90885, name: 'Pumpkin Imp Egg', type: 'Consumable', rarity: 'rare', price: 0, bound: true,
    icon: 'https://www.aetheria-online.in.th/art/icons/items/pumpkin-imp-egg.webp',
    cost: [
      { itemId: 90880, name: 'Halloween Candy', amount: 200, qty: 200, icon: CANDY_ICON },
      { itemId: 90881, name: 'Golden Pumpkin', amount: 2, qty: 2, icon: PUMPKIN_ICON }
    ],
    limit: { max: 1, perAccount: true, reset: 'None' },
    desc: 'ไข่สัตว์เลี้ยงภูตฟักทองฮาโลวีน'
  },
  {
    itemId: 90203, name: 'Oridecon', type: 'Enchantment', rarity: 'uncommon', price: 0, bound: true,
    icon: 'https://www.aetheria-online.in.th/art/icons/items/oridecon.webp',
    cost: [{ itemId: 90880, name: 'Halloween Candy', amount: 30, qty: 30, icon: CANDY_ICON }],
    limit: { max: 500, perAccount: true, reset: 'Weekly' },
    desc: 'แร่ตีบวกอาวุธ'
  },
  {
    itemId: 90205, name: 'Elunium', type: 'Enchantment', rarity: 'uncommon', price: 0, bound: true,
    icon: 'https://www.aetheria-online.in.th/art/icons/items/elunium.webp',
    cost: [{ itemId: 90880, name: 'Halloween Candy', amount: 30, qty: 30, icon: CANDY_ICON }],
    limit: { max: 500, perAccount: true, reset: 'Weekly' },
    desc: 'แร่ตีบวกชุดเกราะ'
  },
  {
    itemId: 90351, name: 'Fury Potion', type: 'Consumable', rarity: 'rare', price: 0, bound: true,
    icon: 'https://www.aetheria-online.in.th/art/icons/items/fury-potion.webp',
    cost: [{ itemId: 90880, name: 'Halloween Candy', amount: 40, qty: 40, icon: CANDY_ICON }],
    limit: { max: 5, perAccount: true, reset: 'Daily' },
    desc: 'ยาเพิ่มพลังโจมตีกายภาพ (ATK +25, Melee DMG +5%)'
  },
  {
    itemId: 90352, name: 'Arcane Potion', type: 'Consumable', rarity: 'rare', price: 0, bound: true,
    icon: 'https://www.aetheria-online.in.th/art/icons/items/arcane-potion.webp',
    cost: [{ itemId: 90880, name: 'Halloween Candy', amount: 40, qty: 40, icon: CANDY_ICON }],
    limit: { max: 5, perAccount: true, reset: 'Daily' },
    desc: 'ยาเพิ่มพลังโจมตีเวท (MATK +25, Magic DMG +5%)'
  },
  {
    itemId: 90353, name: 'Keen Eye Potion', type: 'Consumable', rarity: 'rare', price: 0, bound: true,
    icon: 'https://www.aetheria-online.in.th/art/icons/items/keen-eye-potion.webp',
    cost: [{ itemId: 90880, name: 'Halloween Candy', amount: 40, qty: 40, icon: CANDY_ICON }],
    limit: { max: 5, perAccount: true, reset: 'Daily' },
    desc: 'ยาเพิ่มความแม่นยำและระยะไกล (HIT +20, Ranged DMG +5%)'
  }
];

const HALLOWEEN_RUNTIME_INSTALL_JS = `(() => {
  if (!window.WITCH_HAZEL_ITEMS) window.WITCH_HAZEL_ITEMS = ${JSON.stringify(WITCH_HAZEL_ITEMS)};
  const CFG_KEY = 'pelican_halloween_cfg';
  if (!window.__halloweenExchangeConfig) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch (_) {}
    window.__halloweenExchangeConfig = {
      enabled: saved && typeof saved.enabled === 'boolean' ? saved.enabled : true,
      rules: (saved && saved.rules && typeof saved.rules === 'object') ? saved.rules : {},
      quotaState: (saved && saved.quotaState && typeof saved.quotaState === 'object') ? saved.quotaState : {}
    };
  }
  window.saveHalloweenExchangeConfig = function () {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(window.__halloweenExchangeConfig)); } catch (_) {}
  };
  window.getHalloweenPeriodKey = function (reset) {
    const bkk = new Date(Date.now() + 7 * 3600000);
    const day = bkk.toISOString().slice(0, 10);
    if (reset === 'Daily') return 'D:' + day;
    if (reset === 'Weekly') {
      const dow = (bkk.getUTCDay() + 6) % 7; // Monday = 0
      const mon = new Date(bkk.getTime() - dow * 86400000).toISOString().slice(0, 10);
      return 'W:' + mon;
    }
    if (reset === 'Monthly') return 'M:' + day.slice(0, 7);
    return 'FOREVER';
  };
  window.syncHalloweenWhitelist = function () {
    const cfg = window.__halloweenExchangeConfig || {};
    const rules = cfg.rules || {};
    const enabledNames = ['Halloween Candy', 'Golden Pumpkin'];
    (window.WITCH_HAZEL_ITEMS || []).forEach(it => {
      const r = rules[String(it.itemId)];
      if (r && r.enabled) enabledNames.push(it.name);
    });
    const sellCfg = window.__sellConfig || (window.__sellConfig = {});
    const list = String(sellCfg.whitelist || '').split(',').map(s => s.trim()).filter(Boolean);
    let changed = false;
    enabledNames.forEach(name => {
      if (!list.some(x => x.toLowerCase() === name.toLowerCase())) {
        list.push(name);
        changed = true;
      }
    });
    if (changed) {
      sellCfg.whitelist = list.join(', ');
      try { localStorage.setItem('pelican_sell_cfg', JSON.stringify(sellCfg)); } catch (_) {}
      const wlTextarea = document.getElementById('p-sell-whitelist');
      if (wlTextarea) wlTextarea.value = sellCfg.whitelist;
    }
    return sellCfg.whitelist;
  };
  window.isHalloweenExchangeProtectedItem = function (itemName) {
    if (!itemName) return false;
    const clean = String(itemName).trim().toLowerCase();
    if (clean === 'halloween candy' || clean === 'golden pumpkin') return true;
    const rules = (window.__halloweenExchangeConfig && window.__halloweenExchangeConfig.rules) || {};
    return (window.WITCH_HAZEL_ITEMS || []).some(it => {
      const r = rules[String(it.itemId)];
      return r && r.enabled && it.name.toLowerCase() === clean;
    });
  };
  if (typeof window.isSellWhitelisted === 'function' && !window.__hwWlHooked) {
    const origWl = window.isSellWhitelisted;
    window.isSellWhitelisted = function (itemName, customWhitelistStr) {
      const defWl = (window.__sellConfig && window.__sellConfig.whitelist) || '';
      if ((customWhitelistStr === undefined || customWhitelistStr === defWl) && window.isHalloweenExchangeProtectedItem && window.isHalloweenExchangeProtectedItem(itemName)) {
        return true;
      }
      return origWl.call(this, itemName, customWhitelistStr);
    };
    window.__hwWlHooked = true;
  }
  window.readLiveWitchShopState = function () {
    const rows = document.querySelectorAll('.shop-row');
    if (!rows.length) return null;
    for (const el of rows) {
      for (const k of Object.keys(el)) {
        if (k.startsWith('__reactFiber$')) {
          let f = el[k];
          while (f) {
            let s = f.memoizedState;
            while (s) {
              const v = s.memoizedState;
              const cand = (v && Array.isArray(v.items)) ? v : (v && v.value && Array.isArray(v.value.items) ? v.value : null);
              if (cand && (cand.shopId === 950 || /ฮาโลวีน|แม่มด|Witch Hazel/i.test(cand.name || ''))) return cand;
              s = s.next;
            }
            f = f.return;
          }
        }
      }
    }
    return null;
  };
  window.updateHalloweenQuotaFromShop = function (shopObj) {
    if (!shopObj || !Array.isArray(shopObj.items)) return;
    const cfg = window.__halloweenExchangeConfig;
    if (!cfg.quotaState) cfg.quotaState = {};
    shopObj.items.forEach(it => {
      if (!it || !it.itemId) return;
      const pKey = window.getHalloweenPeriodKey(it.limit && it.limit.reset);
      cfg.quotaState[String(it.itemId)] = {
        limitLeft: typeof it.limitLeft === 'number' ? it.limitLeft : (it.limit ? it.limit.max : -1),
        max: it.limit ? it.limit.max : -1,
        reset: it.limit ? it.limit.reset : 'None',
        periodKey: pKey,
        updatedAt: Date.now()
      };
    });
    window.saveHalloweenExchangeConfig();
  };
  window.getHalloweenExchangeStatus = function () {
    const liveShop = window.readLiveWitchShopState();
    if (liveShop) window.updateHalloweenQuotaFromShop(liveShop);
    const bag = (window.__latestInventory && Array.isArray(window.__latestInventory.items))
      ? window.__latestInventory.items.filter(Boolean)
      : ((typeof window.getBagItems === 'function') ? window.getBagItems() : []);
    const countItem = id => bag.filter(x => Number((x.raw && x.raw.itemId) ?? x.itemId ?? x.id) === Number(id)).reduce((s, x) => s + (Number(x.qty) || 0), 0);
    const candy = countItem(90880);
    const pumpkin = countItem(90881);
    const ch = (typeof window.getLiveCharacterData === 'function' ? window.getLiveCharacterData() : null) || window.__latestCharacterData || {};
    const zeny = (typeof window.__currentZeny === 'number') ? window.__currentZeny : (typeof ch.zeny === 'number' ? ch.zeny : 0);
    const cfg = window.__halloweenExchangeConfig || { enabled: true, rules: {}, quotaState: {} };
    const rules = cfg.rules || {};
    const qs = cfg.quotaState || {};
    const items = (window.WITCH_HAZEL_ITEMS || []).map(it => {
      const key = String(it.itemId);
      const r = rules[key] || { enabled: false, minQty: 1 };
      const minQty = Math.max(1, parseInt(r.minQty, 10) || 1);
      const q = qs[key];
      const pKey = window.getHalloweenPeriodKey(it.limit && it.limit.reset);
      const limitMax = it.limit ? it.limit.max : -1;
      const limitLeft = (q && q.periodKey === pKey && typeof q.limitLeft === 'number') ? q.limitLeft : limitMax;
      let maxByMaterials = 9999;
      (it.cost || []).forEach(c => {
        const have = Number(c.itemId) === 90880 ? candy : (Number(c.itemId) === 90881 ? pumpkin : countItem(c.itemId));
        maxByMaterials = Math.min(maxByMaterials, Math.floor(have / Math.max(1, c.amount)));
      });
      if (it.price > 0) {
        maxByMaterials = Math.min(maxByMaterials, Math.floor(zeny / it.price));
      }
      const exchangeableNow = limitLeft >= 0 ? Math.min(maxByMaterials, limitLeft) : maxByMaterials;
      const ownedInBag = countItem(it.itemId);
      return {
        ...it,
        ownedInBag,
        limitLeft,
        limitMax,
        maxByMaterials,
        exchangeableNow,
        enabled: !!r.enabled,
        minQty,
        ready: !!r.enabled && exchangeableNow >= minQty && limitLeft !== 0
      };
    });
    return {
      success: true,
      enabled: cfg.enabled !== false,
      exchanging: !!window.__isHalloweenExchanging,
      candy,
      pumpkin,
      zeny,
      lastLog: window.__halloweenLastLog || '',
      items,
      catalog: window.WITCH_HAZEL_ITEMS,
      config: {
        enabled: cfg.enabled !== false,
        rules
      },
      live: {
        bagCounts: { 90880: candy, 90881: pumpkin },
        zeny,
        quotaState: qs
      }
    };
  };
  window.runHalloweenExchangeStep = async function (manual = false, targetItemId = null) {
    if (window.__isHalloweenExchanging) return { success: false, busy: true, message: 'กำลังดำเนินการแลกของ Halloween อยู่...' };
    if (!manual && (window.__halloweenNextTryAt || 0) > Date.now()) return false;
    const st = window.getHalloweenExchangeStatus();
    if (!manual && !st.enabled) return false;
    const candidates = st.items.filter(it => {
      if (targetItemId && Number(it.itemId) !== Number(targetItemId)) return false;
      if (manual && targetItemId) return it.exchangeableNow >= 1;
      if (manual) return it.enabled && it.exchangeableNow >= 1;
      return it.ready;
    });
    if (!candidates.length) {
      if (manual) return { success: false, error: 'วัตถุดิบ (ลูกอม/ฟักทอง/Zeny) ยังไม่พอแลก หรือครบโควต้าแล้ว' };
      return false;
    }
    const room = ${ROOM_JS};
    if (!room || !room.connection?.isOpen) {
      if (manual) return { success: false, error: 'ไม่ได้เชื่อมต่อเกม' };
      return false;
    }
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const isCap = typeof window.isInCapital === 'function'
      ? window.isInCapital()
      : /เมืองหลวง|โซลเฮเวน|capital/i.test((typeof window.getCurrentMapName === 'function' ? window.getCurrentMapName() : '') || (room.state && room.state.mapId) || '');
    if (!isCap) {
      if (window.__isWalkingToMap || window.__isNavigating) return false;
      const farm = window.__targetFarmMap || '';
      if (farm && !/เมืองหลวง|โซลเฮเวน/.test(farm)) {
        try { localStorage.setItem('pelican_job_return_map', farm); } catch (_) {}
      }
      window.__halloweenLastLog = '🎃 ของครบเงื่อนไขแลก (' + candidates.map(c => c.name + ' x' + c.exchangeableNow).join(', ') + ') -> เดินทางกลับเมืองหลวงไปหา Witch Hazel';
      console.log('%c[PmheeAether Halloween] ' + window.__halloweenLastLog, 'color: #fb923c; font-weight: bold;');
      window.__planJobChangeHoldUntil = Date.now() + 120000;
      if (typeof window.needTown === 'function') window.needTown('halloween');
      if (typeof window.planTripToCapital === 'function') window.planTripToCapital('halloween');
      else if (typeof window.goToCapital === 'function') window.goToCapital('halloween');
      window.__halloweenNextTryAt = Date.now() + 8000;
      return { success: true, navigating: true, message: window.__halloweenLastLog };
    }
    let witchKey = null;
    if (room.state && room.state.npcs && typeof room.state.npcs.forEach === 'function') {
      room.state.npcs.forEach((n, k) => {
        if (!witchKey && n && (n.npcId === 223 || /Witch Hazel|แม่มดฮาเซล/i.test(n.name || ''))) witchKey = k;
      });
    }
    if (!witchKey) {
      window.__halloweenNextTryAt = Date.now() + 60000;
      window.__planJobChangeHoldUntil = 0;
      if (typeof window.restoreFarmMapAfterJobChange === 'function') window.restoreFarmMapAfterJobChange('halloween');
      return { success: false, error: 'ไม่พบ NPC Witch Hazel ในเมืองหลวง' };
    }
    window.__isHalloweenExchanging = true;
    window.__planJobChangeHoldUntil = Date.now() + 45000;
    if (typeof window.needTown === 'function') window.needTown('halloween');
    let unsubDlg = null, unsubShop = null;
    try {
      window.syncHalloweenWhitelist();
      const closeAll = () => {
        document.querySelectorAll('.shop-window .win-close, .npc-dialog .win-close').forEach(b => { try { b.click(); } catch (_) {} });
        try { room.send('npc_close', {}); } catch (_) {}
      };
      let netDlg = null, netShop = null;
      if (typeof room.onMessage === 'function') {
        try {
          unsubDlg = room.onMessage('npc_dialog', m => { if (m) netDlg = m; });
          unsubShop = room.onMessage('shop', m => {
            if (m && (m.shopId === 950 || /ฮาโลวีน|แม่มด|Witch Hazel/i.test(m.name || ''))) netShop = m;
          });
        } catch (_) {}
      }
      let shopObj = window.readLiveWitchShopState();
      if (!shopObj) {
        room.send('npc_talk', { npcKey: witchKey });
        let dlg = null;
        for (let i = 0; i < 100 && !dlg && !netDlg && !shopObj && !netShop; i++) {
          if (i === 40) { try { room.send('npc_talk', { npcKey: witchKey }); } catch (_) {} }
          await sleep(200);
          shopObj = netShop || window.readLiveWitchShopState();
          dlg = document.querySelector('.npc-dialog');
        }
        if ((dlg || netDlg) && !shopObj) {
          const opts = netDlg && Array.isArray(netDlg.options)
            ? netDlg.options.map(s => String(s || '').trim())
            : Array.from((dlg ? dlg.querySelectorAll('.npc-options button') : [])).map(b => (b.innerText || '').replace(/^\\s*\\d+\\s*/, '').trim());
          let optIdx = opts.findIndex(o => /รางวัล|แลก|ร้าน|ฮาโลวีน|reward|shop/i.test(o));
          if (optIdx < 0) optIdx = 0;
          room.send('npc_option', { index: optIdx });
          for (let i = 0; i < 40 && !shopObj; i++) {
            await sleep(200);
            shopObj = netShop || window.readLiveWitchShopState();
          }
        }
      }
      if (!shopObj) {
        closeAll();
        window.__halloweenNextTryAt = Date.now() + 15000;
        return { success: false, error: 'เปิดหน้าต่างแลกของ Witch Hazel ไม่สำเร็จ (กำลังเดินไปหา NPC)' };
      }
      window.updateHalloweenQuotaFromShop(shopObj);
      const fresh = window.getHalloweenExchangeStatus();
      let remCandy = fresh.candy;
      let remPumpkin = fresh.pumpkin;
      let remZeny = fresh.zeny;
      const lines = [];
      const exchangedSummary = [];
      for (const it of fresh.items) {
        const want = targetItemId
          ? (Number(it.itemId) === Number(targetItemId))
          : (manual ? it.enabled : it.ready);
        if (!want) continue;
        const liveIt = (shopObj.items || []).find(x => Number(x.itemId) === Number(it.itemId));
        const limLeft = liveIt && typeof liveIt.limitLeft === 'number' ? liveIt.limitLeft : it.limitLeft;
        if (limLeft === 0) continue;
        let maxNow = limLeft > 0 ? limLeft : 9999;
        (it.cost || []).forEach(c => {
          const pool = Number(c.itemId) === 90880 ? remCandy : (Number(c.itemId) === 90881 ? remPumpkin : 0);
          maxNow = Math.min(maxNow, Math.floor(pool / Math.max(1, c.amount)));
        });
        if (it.price > 0) maxNow = Math.min(maxNow, Math.floor(remZeny / it.price));
        const minReq = (manual && targetItemId) ? 1 : it.minQty;
        if (maxNow < minReq || maxNow <= 0) continue;
        lines.push({ itemId: Number(it.itemId), qty: maxNow });
        exchangedSummary.push(it.name + ' x' + maxNow);
        (it.cost || []).forEach(c => {
          if (Number(c.itemId) === 90880) remCandy -= c.amount * maxNow;
          if (Number(c.itemId) === 90881) remPumpkin -= c.amount * maxNow;
        });
        if (it.price > 0) remZeny -= it.price * maxNow;
        const qEntry = window.__halloweenExchangeConfig.quotaState[String(it.itemId)];
        if (qEntry && typeof qEntry.limitLeft === 'number' && qEntry.limitLeft > 0) {
          qEntry.limitLeft = Math.max(0, qEntry.limitLeft - maxNow);
        }
      }
      window.saveHalloweenExchangeConfig();
      if (!lines.length) {
        closeAll();
        window.__halloweenLastLog = '⏭️ โควต้าของที่เลือกเต็มแล้ววันนี้ — เดินทางกลับแมพฟาร์ม';
        window.__planJobChangeHoldUntil = 0;
        if (typeof window.restoreFarmMapAfterJobChange === 'function') window.restoreFarmMapAfterJobChange('halloween');
        return { success: false, error: 'โควต้าของที่เลือกเต็มแล้ว หรือวัตถุดิบไม่พอแลกตามจำนวนขั้นต่ำที่ตั้งไว้' };
      }
      netShop = null;
      const beforeCandy = fresh.candy;
      room.send('shop_buy_many', { lines });
      window.__halloweenLastLog = '✅ แลกสำเร็จ: ' + exchangedSummary.join(', ');
      console.log('%c[PmheeAether Halloween] ' + window.__halloweenLastLog, 'color: #22c55e; font-weight: bold;');
      for (let i = 0; i < 12; i++) {
        await sleep(200);
        if (netShop) { window.updateHalloweenQuotaFromShop(netShop); break; }
        const curSt = window.getHalloweenExchangeStatus();
        if (curSt.candy < beforeCandy) break;
      }
      closeAll();
      window.__halloweenNextTryAt = Date.now() + 8000;
      window.__planJobChangeHoldUntil = 0;
      if (typeof window.restoreFarmMapAfterJobChange === 'function') window.restoreFarmMapAfterJobChange('halloween');
      return { success: true, exchanged: lines, summary: exchangedSummary.join(', '), status: window.getHalloweenExchangeStatus() };
    } finally {
      if (typeof unsubDlg === 'function') { try { unsubDlg(); } catch (_) {} }
      if (typeof unsubShop === 'function') { try { unsubShop(); } catch (_) {} }
      window.__isHalloweenExchanging = false;
    }
  };
  if (!window.__pmHalloweenLoopId || window.__pmHalloweenLoopVer !== 3) {
    if (window.__pmHalloweenLoopId) { try { clearInterval(window.__pmHalloweenLoopId); } catch (_) {} }
    window.__pmHalloweenLoopVer = 3;
    window.__pmHalloweenLoopId = setInterval(() => {
      try {
        const liveShop = window.readLiveWitchShopState && window.readLiveWitchShopState();
        if (liveShop && !window.__isHalloweenExchanging) window.updateHalloweenQuotaFromShop(liveShop);
        if (window.__isBotRunning && !window.__consolidationPending && !window.__isHalloweenExchanging) {
          window.runHalloweenExchangeStep(false);
        }
      } catch (_) {}
    }, 5000);
  }
})()`;

function buildHalloweenReadCode() {
  return `(() => {
    ${HALLOWEEN_RUNTIME_INSTALL_JS};
    return window.getHalloweenExchangeStatus();
  })()`;
}

function buildHalloweenSaveCode(payload) {
  const enabled = payload.enabled !== undefined ? !!payload.enabled : true;
  const rawRules = (payload && payload.rules && typeof payload.rules === 'object') ? payload.rules : {};
  const cleanRules = {};
  WITCH_HAZEL_ITEMS.forEach(it => {
    const k = String(it.itemId);
    const r = rawRules[k];
    if (r && typeof r === 'object') {
      cleanRules[k] = {
        enabled: !!r.enabled,
        minQty: Math.max(1, Math.min(9999, parseInt(r.minQty, 10) || 1))
      };
    }
  });
  return `(() => {
    ${HALLOWEEN_RUNTIME_INSTALL_JS};
    const cfg = window.__halloweenExchangeConfig;
    cfg.enabled = ${JSON.stringify(enabled)};
    cfg.rules = ${JSON.stringify(cleanRules)};
    window.saveHalloweenExchangeConfig();
    const wl = window.syncHalloweenWhitelist();
    return Object.assign(window.getHalloweenExchangeStatus(), { whitelist: wl });
  })()`;
}

function buildHalloweenExchangeNowCode(payload) {
  const itemId = payload && payload.itemId ? toInt(payload.itemId, 1, 10000000) : null;
  const hasRules = payload && payload.rules && typeof payload.rules === 'object';
  let saveSnippet = '';
  if (hasRules) {
    const cleanRules = {};
    WITCH_HAZEL_ITEMS.forEach(it => {
      const k = String(it.itemId);
      const r = payload.rules[k];
      if (r && typeof r === 'object') {
        cleanRules[k] = {
          enabled: !!r.enabled,
          minQty: Math.max(1, Math.min(9999, parseInt(r.minQty, 10) || 1))
        };
      }
    });
    saveSnippet = `
      const cfg = window.__halloweenExchangeConfig;
      cfg.rules = ${JSON.stringify(cleanRules)};
      window.saveHalloweenExchangeConfig();
      window.syncHalloweenWhitelist();
    `;
  }
  return `(async () => {
    ${HALLOWEEN_RUNTIME_INSTALL_JS};
    ${saveSnippet}
    return await window.runHalloweenExchangeStep(true, ${JSON.stringify(itemId)});
  })()`;
}

// ==========================================================================
// GLOBAL MARKET OVERVIEW ACROSS ALL PROFILES (/api/market/overview)
// ==========================================================================
const overviewMarketCache = new Map(); // profileId -> { updatedAt, active, closed, deliveries, activeLimit, premium, zeny }

function buildOverviewProfileCode(fetchMine = true) {
  return `(async () => {
    const room = ${ROOM_JS};
    const awaitReply = ${AWAIT_REPLY_JS};
    const icon = ${ICON_JS};
    const ch = (typeof window.getLiveCharacterData === 'function' ? window.getLiveCharacterData() : null) || window.__latestCharacterData || {};
    const premium = Array.isArray(ch.buffs) && ch.buffs.some(b => b && b.skillId === 'ui:token');
    const zeny = (typeof window.__currentZeny === 'number') ? window.__currentZeny : (typeof ch.zeny === 'number' ? ch.zeny : 0);
    const activeLimit = premium ? 20 : 5;
    let mine = window.__lastMarketMine || null;
    let fetchedMine = false;
    if (${Boolean(fetchMine)} && room && room.connection?.isOpen) {
      const fresh = await awaitReply(room, 'market_mine', () => {
        try { room.send('market', { op: 'mine' }); } catch (_) {}
      }, 3200);
      if (fresh) {
        mine = fresh;
        window.__lastMarketMine = fresh;
        fetchedMine = true;
      }
    }
    const enrich = list => (Array.isArray(list) ? list : []).map(entry => {
      if (entry && entry.item) {
        entry.item.icon = entry.item.icon || icon(entry.item, entry.item.name);
      }
      if (entry && entry.id === undefined) {
        if (entry.listingId !== undefined) entry.id = entry.listingId;
        else if (entry.deliveryId !== undefined) entry.id = entry.deliveryId;
      }
      return entry;
    });
    const active = mine ? enrich(mine.active) : null;
    const closed = mine ? enrich(mine.closed) : null;
    const deliveries = mine ? enrich(mine.deliveries) : null;
    if (Array.isArray(active)) window.__myMarketActiveCount = active.length;
    const autoSell = (${buildAutoSellReadCode()});
    const inv = window.__latestInventory || {};
    const curMap = (typeof window.getCurrentMapName === 'function' ? window.getCurrentMapName() : '') || (room && room.state && room.state.mapId) || '';
    return {
      success: true,
      charName: ch.name || window.__myCharName || '',
      job: ch.job || ch.classId || '',
      baseLv: Number(ch.level ?? ch.baseLv) || 0,
      jobLv: Number(ch.jobLevel ?? ch.jobLv) || 0,
      currentMap: String(curMap || ''),
      zeny,
      premium,
      activeLimit,
      weight: Number(inv.weight ?? ch.weight) || 0,
      weightLimit: Number(inv.weightLimit ?? ch.maxWeight) || 0,
      isBotRunning: Boolean(window.__isBotRunning),
      hasMine: Boolean(mine),
      fetchedMine,
      active,
      closed,
      deliveries,
      autoSell
    };
  })()`;
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await worker(items[cur], cur);
    }
  });
  await Promise.all(runners);
  return results;
}

async function querySingleProfileOverview(p, evalProfilePort, forceRefresh = false) {
  const storedAs = loadProfileAutoSellStore(p.id);
  const cached = overviewMarketCache.get(p.id) || null;
  const liveSt = p.liveState || {};
  const base = {
    id: p.id,
    name: p.name || p.id,
    charName: liveSt.charName || p.lastCharName || '',
    job: liveSt.job || p.lastJob || '',
    baseLv: Number(liveSt.baseLv || p.lastBaseLv) || 0,
    jobLv: Number(liveSt.jobLv || p.lastJobLv) || 0,
    currentMap: liveSt.currentMap || p.targetMap || '',
    online: Boolean(p.debugPort),
    isBotRunning: Boolean(liveSt.isBotRunning),
    zeny: Number(liveSt.zeny ?? p.lastZeny ?? (cached && cached.zeny)) || 0,
    premium: Boolean(cached && cached.premium),
    activeLimit: (cached && cached.activeLimit) || 5,
    weight: Number(liveSt.weight) || 0,
    weightLimit: Number(liveSt.weightLimit) || 0,
    active: (cached && Array.isArray(cached.active)) ? cached.active : [],
    closed: (cached && Array.isArray(cached.closed)) ? cached.closed : [],
    deliveries: (cached && Array.isArray(cached.deliveries)) ? cached.deliveries : [],
    mineUpdatedAt: (cached && cached.updatedAt) || 0,
    autoSell: {
      enabled: Boolean(storedAs.enabled),
      priceStrategy: storedAs.priceStrategy || 'median',
      rules: Array.isArray(storedAs.rules) ? storedAs.rules : [],
      ruleStates: {},
      readyCount: 0,
      bagTradableCount: 0,
      bagItemsSummary: []
    }
  };

  if (!p.debugPort) return base;

  const needMineFetch = forceRefresh || !cached || (Date.now() - cached.updatedAt > 18000);
  try {
    const r = await evalProfilePort(p.debugPort, buildOverviewProfileCode(needMineFetch), needMineFetch ? 4800 : 2800);
    const d = r && r.result && r.result.success ? r.result : null;
    if (!d) return base;

    const useFreshMine = Boolean(d.fetchedMine) || (!cached && Array.isArray(d.active));
    const active = useFreshMine && Array.isArray(d.active) ? d.active : base.active;
    const closed = useFreshMine && Array.isArray(d.closed) ? d.closed : base.closed;
    const deliveries = useFreshMine && Array.isArray(d.deliveries) ? d.deliveries : base.deliveries;
    const activeLimit = Number(d.activeLimit) || (d.premium ? 20 : 5);
    const nowTs = useFreshMine ? Date.now() : base.mineUpdatedAt;

    if (useFreshMine && Array.isArray(d.active)) {
      overviewMarketCache.set(p.id, {
        updatedAt: nowTs,
        active,
        closed,
        deliveries,
        activeLimit,
        premium: Boolean(d.premium),
        zeny: Number(d.zeny) || 0
      });
    }

    let asInfo = base.autoSell;
    if (d.autoSell && d.autoSell.config) {
      saveProfileAutoSellStore(p.id, d.autoSell.config);
      const rs = d.autoSell.ruleStates || {};
      const rules = Array.isArray(d.autoSell.config.rules) ? d.autoSell.config.rules : [];
      const readyCount = rules.filter(ru => ru && ru.enabled !== false && rs[ru.id] && rs[ru.id].ready).length;
      const bagSummary = Array.isArray(d.autoSell.bagItemsSummary) ? d.autoSell.bagItemsSummary : [];
      asInfo = {
        enabled: Boolean(d.autoSell.config.enabled),
        priceStrategy: d.autoSell.config.priceStrategy || 'median',
        rules,
        ruleStates: rs,
        readyCount,
        bagTradableCount: bagSummary.reduce((s, x) => s + (Number(x.qty) || 0), 0),
        bagItemsSummary: bagSummary.slice(0, 12)
      };
    }

    return {
      id: p.id,
      name: p.name || p.id,
      charName: d.charName || base.charName,
      job: d.job || base.job,
      baseLv: Number(d.baseLv) || base.baseLv,
      jobLv: Number(d.jobLv) || base.jobLv,
      currentMap: d.currentMap || base.currentMap,
      online: true,
      isBotRunning: Boolean(d.isBotRunning),
      zeny: typeof d.zeny === 'number' ? d.zeny : base.zeny,
      premium: Boolean(d.premium),
      activeLimit,
      weight: Number(d.weight) || base.weight,
      weightLimit: Number(d.weightLimit) || base.weightLimit,
      active,
      closed: closed.slice(0, 15),
      deliveries,
      mineUpdatedAt: nowTs,
      autoSell: asInfo
    };
  } catch (_) {
    return base;
  }
}

async function handleInventoryMarketRoute(req, res, pathname, ctx) {
  const { loadProfiles, evalProfilePort, sendJSON } = ctx;

  // Global Market Overview endpoint across all profiles (/api/market/overview)
  if (pathname === '/api/market/overview') {
    const profiles = loadProfiles() || [];
    const urlObj = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET') {
      const forceRefresh = urlObj.searchParams.get('refresh') === '1';
      const singleId = urlObj.searchParams.get('profileId') || '';
      const targetList = singleId ? profiles.filter(p => p && p.id === singleId) : profiles;
      const clients = await runWithConcurrency(targetList, 6, p =>
        querySingleProfileOverview(p, evalProfilePort, forceRefresh || Boolean(singleId))
      );
      sendJSON({
        success: true,
        timestamp: Date.now(),
        clients
      });
      return true;
    }

    if (req.method === 'POST') {
      const payload = await readBody(req);
      if (!payload) {
        sendJSON({ success: false, error: 'Invalid JSON' }, 400);
        return true;
      }
      const op = payload.op || '';
      const pid = String(payload.profileId || '').trim();

      if (op === 'cancel' || op === 'collect' || op === 'collect_profile') {
        const profile = profiles.find(p => p && p.id === pid);
        if (!profile) {
          sendJSON({ success: false, error: 'ไม่พบโปรไฟล์ที่ระบุ' }, 404);
          return true;
        }
        if (!profile.debugPort) {
          sendJSON({ success: false, error: 'จอนี้ออฟไลน์อยู่ ไม่สามารถสั่งงานตลาดได้' }, 400);
          return true;
        }
        const marketOp = op === 'collect_profile' ? 'collect_all' : op;
        const built = buildMarketCode({
          op: marketOp,
          listingId: payload.listingId,
          deliveryId: payload.deliveryId
        });
        if (built.error) {
          sendJSON({ success: false, error: built.error }, 400);
          return true;
        }
        const r = await evalProfilePort(profile.debugPort, built.code, built.timeout || 7000);
        const resObj = r && r.result ? r.result : { success: false, error: r?.error || 'สั่งงานตลาดไม่สำเร็จ' };
        if (resObj && resObj.success) {
          overviewMarketCache.set(profile.id, {
            updatedAt: Date.now(),
            active: Array.isArray(resObj.active) ? resObj.active : [],
            closed: Array.isArray(resObj.closed) ? resObj.closed : [],
            deliveries: Array.isArray(resObj.deliveries) ? resObj.deliveries : [],
            activeLimit: Number(resObj.activeLimit) || (resObj.premium ? 20 : 5),
            premium: Boolean(resObj.premium),
            zeny: Number(resObj.zeny) || 0
          });
        }
        const updatedClient = await querySingleProfileOverview(profile, evalProfilePort, false);
        sendJSON(Object.assign({}, resObj, { client: updatedClient }));
        return true;
      }

      if (op === 'collect_all_profiles') {
        const onlineProfiles = profiles.filter(p => p && p.debugPort);
        if (onlineProfiles.length === 0) {
          sendJSON({ success: false, error: 'ไม่มีจอที่ออนไลน์อยู่' }, 400);
          return true;
        }
        const built = buildMarketCode({ op: 'collect_all' });
        let claimedCount = 0;
        await runWithConcurrency(onlineProfiles, 6, async (p) => {
          try {
            const r = await evalProfilePort(p.debugPort, built.code, built.timeout || 7000);
            const resObj = r && r.result;
            if (resObj && resObj.success) {
              claimedCount++;
              overviewMarketCache.set(p.id, {
                updatedAt: Date.now(),
                active: Array.isArray(resObj.active) ? resObj.active : [],
                closed: Array.isArray(resObj.closed) ? resObj.closed : [],
                deliveries: Array.isArray(resObj.deliveries) ? resObj.deliveries : [],
                activeLimit: Number(resObj.activeLimit) || (resObj.premium ? 20 : 5),
                premium: Boolean(resObj.premium),
                zeny: Number(resObj.zeny) || 0
              });
            }
          } catch (_) {}
        });
        const clients = await runWithConcurrency(profiles, 6, p =>
          querySingleProfileOverview(p, evalProfilePort, false)
        );
        sendJSON({
          success: true,
          claimedProfilesCount: claimedCount,
          clients
        });
        return true;
      }

      if (op === 'toggle_autosell') {
        const profile = profiles.find(p => p && p.id === pid);
        if (!profile) {
          sendJSON({ success: false, error: 'ไม่พบโปรไฟล์ที่ระบุ' }, 404);
          return true;
        }
        const stored = loadProfileAutoSellStore(profile.id);
        stored.enabled = Boolean(payload.enabled);
        const cleanCfg = saveProfileAutoSellStore(profile.id, stored);
        if (profile.debugPort) {
          await evalProfilePort(profile.debugPort, buildAutoSellSaveCode(cleanCfg), 4000).catch(() => {});
        }
        const updatedClient = await querySingleProfileOverview(profile, evalProfilePort, false);
        sendJSON({ success: true, enabled: cleanCfg.enabled, client: updatedClient });
        return true;
      }

      if (op === 'trigger_autosell') {
        const targets = (pid && pid !== 'all')
          ? profiles.filter(p => p && p.id === pid && p.debugPort)
          : profiles.filter(p => p && p.debugPort);
        if (targets.length === 0) {
          sendJSON({ success: false, error: 'ไม่มีจอเป้าหมายที่ออนไลน์อยู่' }, 400);
          return true;
        }
        const code = `(async () => {
          if (typeof window.runAutoMarketSellCycle === 'function') {
            await window.runAutoMarketSellCycle(true);
          }
          return { success: true };
        })()`;
        let triggered = 0;
        await runWithConcurrency(targets, 5, async (p) => {
          try {
            const r = await evalProfilePort(p.debugPort, code, 18000);
            if (r && r.result && r.result.success) triggered++;
          } catch (_) {}
        });
        const clients = await runWithConcurrency(profiles, 6, p =>
          querySingleProfileOverview(p, evalProfilePort, true)
        );
        sendJSON({
          success: true,
          triggeredCount: triggered,
          clients
        });
        return true;
      }

      sendJSON({ success: false, error: 'ไม่รู้จักคำสั่งตลาดส่วนกลาง: ' + op }, 400);
      return true;
    }
    return false;
  }

  // Global Halloween Exchange endpoint for the main-screen left drawer (/api/halloween)
  if (pathname === '/api/halloween') {
    const profiles = loadProfiles() || [];
    let store = loadGlobalHalloweenStore();

    if (req.method === 'GET') {
      const readCode = buildHalloweenReadCode();
      const hasGlobalRules = Object.keys(store.rules || {}).length > 0;
      const clients = await Promise.all(profiles.map(async (p) => {
        const base = {
          id: p.id,
          name: p.name || p.id,
          charName: p.charName || p.characterName || '',
          online: false,
          candy: 0,
          pumpkin: 0,
          zeny: 0,
          exchanging: false,
          lastLog: '',
          quotaState: {},
          readyCount: 0
        };
        if (!p.debugPort) return base;
        try {
          let r = await evalProfilePort(p.debugPort, readCode, 2800);
          let st = r && r.result && r.result.success ? r.result : null;
          if (!st) return base;
          const clientRules = (st.config && st.config.rules) || {};
          const clientHasRules = Object.keys(clientRules).some(k => clientRules[k] && clientRules[k].enabled);
          if (!hasGlobalRules && clientHasRules && Object.keys(store.rules || {}).length === 0) {
            store = saveGlobalHalloweenStore({ enabled: st.enabled !== false, rules: clientRules });
          } else if (hasGlobalRules && !clientHasRules) {
            const syncRes = await evalProfilePort(p.debugPort, buildHalloweenSaveCode(store), 2800);
            if (syncRes && syncRes.result && syncRes.result.success) st = syncRes.result;
          }
          const readyCount = Array.isArray(st.items) ? st.items.filter(it => it && it.ready).length : 0;
          return {
            id: p.id,
            name: p.name || p.id,
            charName: p.charName || p.characterName || '',
            online: true,
            candy: Number(st.candy) || 0,
            pumpkin: Number(st.pumpkin) || 0,
            zeny: Number(st.zeny) || 0,
            exchanging: Boolean(st.exchanging),
            lastLog: st.lastLog || '',
            quotaState: (st.live && st.live.quotaState) || {},
            readyCount,
            config: st.config || store
          };
        } catch (_) {
          return base;
        }
      }));
      sendJSON({
        success: true,
        config: store,
        catalog: WITCH_HAZEL_ITEMS,
        clients
      });
      return true;
    }

    if (req.method === 'POST') {
      const payload = await readBody(req);
      if (!payload) {
        sendJSON({ success: false, error: 'Invalid JSON' }, 400);
        return true;
      }
      const op = payload.op || 'save';
      const targetId = payload.profileId && payload.profileId !== 'all' ? String(payload.profileId) : null;

      if (op === 'save' || op === 'apply_all') {
        store = saveGlobalHalloweenStore(payload);
        const code = buildHalloweenSaveCode(store);
        const targets = (op === 'apply_all' || !targetId)
          ? profiles.filter(p => p && p.debugPort)
          : profiles.filter(p => p && p.debugPort && p.id === targetId);
        let applied = 0;
        await Promise.all(targets.map(async (p) => {
          try {
            const r = await evalProfilePort(p.debugPort, code, 3500);
            if (r && r.result && r.result.success) applied++;
          } catch (_) {}
        }));
        sendJSON({
          success: true,
          config: store,
          appliedCount: applied,
          appliedOnline: applied
        });
        return true;
      }

      if (op === 'exchange_now') {
        if (payload.rules && typeof payload.rules === 'object') {
          store = saveGlobalHalloweenStore(payload);
        }
        const targets = targetId
          ? profiles.filter(p => p && p.debugPort && p.id === targetId)
          : profiles.filter(p => p && p.debugPort);
        if (targets.length === 0) {
          sendJSON({ success: false, error: 'ไม่มีจอเกมที่ออนไลน์อยู่' }, 400);
          return true;
        }
        const code = buildHalloweenExchangeNowCode({
          itemId: payload.itemId || null,
          rules: store.rules
        });
        const results = await Promise.all(targets.map(async (p) => {
          try {
            const r = await evalProfilePort(p.debugPort, code, 25000);
            return Object.assign({ profileId: p.id, name: p.name || p.id }, (r && r.result) || { success: false, error: r?.error || 'ไม่ตอบสนอง' });
          } catch (e) {
            return { profileId: p.id, name: p.name || p.id, success: false, error: e.message };
          }
        }));
        const okList = results.filter(x => x && x.success);
        if (okList.length === 0) {
          const firstErr = (results[0] && results[0].error) || 'วัตถุดิบยังไม่พอแลก หรือจอเกมไม่ตอบสนอง';
          sendJSON({ success: false, error: firstErr, results });
          return true;
        }
        sendJSON({
          success: true,
          triggeredCount: okList.length,
          summary: okList.map(x => `${x.name}: ${x.summary || x.message || 'กำลังเดินไปแลก'}`).join(' · '),
          results
        });
        return true;
      }

      if (op === 'autosell') {
        const itemName = String(payload.itemName || '').trim();
        const minQty = Math.max(1, Math.min(9999, parseInt(payload.minQty, 10) || 1));
        if (!itemName) {
          sendJSON({ success: false, error: 'ไม่ระบุชื่อไอเทม' }, 400);
          return true;
        }
        const targets = targetId
          ? profiles.filter(p => p && p.debugPort && p.id === targetId)
          : profiles.filter(p => p && p.debugPort);
        const code = `(() => {
          const c = window.__autoMarketSellConfig || (window.__autoMarketSellConfig = { rules: [] });
          if (!Array.isArray(c.rules)) c.rules = [];
          const name = ${JSON.stringify(itemName)};
          const existing = c.rules.find(r => r && String(r.itemName || '').trim().toLowerCase() === name.toLowerCase());
          if (existing) {
            existing.minQty = ${minQty};
            existing.enabled = true;
          } else {
            c.rules.push({ id: 'rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), itemName: name, minQty: ${minQty}, sellMode: 'all', enabled: true });
          }
          c.enabled = true;
          try { localStorage.setItem('pelican_auto_market_sell_cfg', JSON.stringify(c)); } catch (e) { return { success: false, error: e.message }; }
          try { const box = document.getElementById('p-autosell-hud-rules-container'); if (box && typeof window.renderAutoSellHudRulesHtml === 'function') box.innerHTML = window.renderAutoSellHudRulesHtml(); } catch (e) {}
          return { success: true, count: c.rules.length, enabled: !!c.enabled };
        })()`;
        let applied = 0;
        await Promise.all(targets.map(async (p) => {
          try {
            const r = await evalProfilePort(p.debugPort, code, 3500);
            if (r && r.result && r.result.success) applied++;
          } catch (_) {}
        }));
        sendJSON({ success: true, appliedOnline: applied, itemName, minQty });
        return true;
      }

      sendJSON({ success: false, error: 'ไม่รู้จักคำสั่ง halloween: ' + op }, 400);
      return true;
    }
    return false;
  }

  const m = pathname.match(/^\/api\/profiles\/([^/]+)\/(inventory|inventory-action|market|halloween|autosell)$/);
  if (!m) return false;
  const [, id, kind] = m;
  const profiles = loadProfiles();
  const profile = profiles.find(p => p.id === id);
  if (!profile) {
    sendJSON({ success: false, error: 'ไม่พบโปรไฟล์นี้' }, 404);
    return true;
  }

  if (kind === 'autosell') {
    const buildOtherProfilesMeta = () => profiles
      .filter(p => p && p.id && p.id !== id)
      .map(p => {
        const stored = loadProfileAutoSellStore(p.id);
        return {
          id: p.id,
          name: p.name || p.id,
          charName: p.lastCharName || '',
          account: p.account || '',
          online: Boolean(p.debugPort),
          rulesCount: (stored.rules || []).length,
          enabled: Boolean(stored.enabled)
        };
      });

    if (req.method === 'GET') {
      if (profile.debugPort) {
        try {
          const r = await evalProfilePort(profile.debugPort, buildAutoSellReadCode(), 4500);
          if (r && r.result && r.result.success && r.result.config) {
            saveProfileAutoSellStore(id, r.result.config);
            sendJSON(Object.assign({}, r.result, {
              offline: false,
              otherProfiles: buildOtherProfilesMeta()
            }));
            return true;
          }
        } catch (_) {}
      }
      const fallbackCfg = loadProfileAutoSellStore(id);
      sendJSON({
        success: true,
        offline: true,
        config: fallbackCfg,
        ruleStates: {},
        activeCount: 0,
        maxListings: Number(fallbackCfg.maxActiveListings) || 8,
        isBotRunning: false,
        bagItemsSummary: [],
        otherProfiles: buildOtherProfilesMeta()
      });
      return true;
    }

    if (req.method === 'POST') {
      const payload = await readBody(req);
      if (!payload) {
        sendJSON({ success: false, error: 'Invalid JSON' }, 400);
        return true;
      }
      const op = payload.op || 'save';

      if (op === 'save') {
        const cleanCfg = saveProfileAutoSellStore(id, payload.config || payload);
        if (profile.debugPort) {
          try {
            const r = await evalProfilePort(profile.debugPort, buildAutoSellSaveCode(cleanCfg), 4500);
            if (r && r.result && r.result.success) {
              sendJSON(Object.assign({}, r.result, {
                offline: false,
                otherProfiles: buildOtherProfilesMeta()
              }));
              return true;
            }
          } catch (_) {}
        }
        sendJSON({
          success: true,
          offline: true,
          config: cleanCfg,
          ruleStates: {},
          activeCount: 0,
          maxListings: Number(cleanCfg.maxActiveListings) || 8,
          isBotRunning: false,
          bagItemsSummary: [],
          otherProfiles: buildOtherProfilesMeta()
        });
        return true;
      }

      if (op === 'sell_rule_now') {
        if (!profile.debugPort) {
          sendJSON({ success: false, error: 'จอนี้ออฟไลน์อยู่ ไม่สามารถสั่งขายทันทีได้' }, 400);
          return true;
        }
        if (payload.config) {
          const cleanCfg = saveProfileAutoSellStore(id, payload.config);
          await evalProfilePort(profile.debugPort, buildAutoSellSaveCode(cleanCfg), 4000).catch(() => {});
        }
        const ruleId = String(payload.ruleId || '').trim();
        const sellCode = `(async () => {
          if (typeof window.sellSingleRuleNow !== 'function') return { success: false, error: 'ไม่พบฟังก์ชัน sellSingleRuleNow ในเกม' };
          await window.sellSingleRuleNow(${JSON.stringify(ruleId)});
          return (${buildAutoSellReadCode()});
        })()`;
        const r = await evalProfilePort(profile.debugPort, sellCode, 15000);
        sendJSON(r && r.result ? Object.assign({}, r.result, { otherProfiles: buildOtherProfilesMeta() }) : { success: false, error: r?.error || 'สั่งขายทันทีไม่สำเร็จ' });
        return true;
      }

      if (op === 'check_now') {
        if (!profile.debugPort) {
          sendJSON({ success: false, error: 'จอนี้ออฟไลน์อยู่ ไม่สามารถตรวจสอบกระเป๋าทันทีได้' }, 400);
          return true;
        }
        if (payload.config) {
          const cleanCfg = saveProfileAutoSellStore(id, payload.config);
          await evalProfilePort(profile.debugPort, buildAutoSellSaveCode(cleanCfg), 4000).catch(() => {});
        }
        const checkCode = `(async () => {
          if (typeof window.runAutoMarketSellCycle === 'function') {
            await window.runAutoMarketSellCycle(true);
          }
          return (${buildAutoSellReadCode()});
        })()`;
        const r = await evalProfilePort(profile.debugPort, checkCode, 20000);
        sendJSON(r && r.result ? Object.assign({}, r.result, { otherProfiles: buildOtherProfilesMeta() }) : { success: false, error: r?.error || 'ตรวจสอบกระเป๋าไม่สำเร็จ' });
        return true;
      }

      if (op === 'copy_to') {
        const sourceCfg = payload.config
          ? saveProfileAutoSellStore(id, payload.config)
          : loadProfileAutoSellStore(id);
        if (profile.debugPort && payload.config) {
          await evalProfilePort(profile.debugPort, buildAutoSellSaveCode(sourceCfg), 3500).catch(() => {});
        }
        const mode = payload.mode === 'merge' ? 'merge' : 'replace';
        const copyEnabled = payload.copyEnabled !== false;
        const rawTargetIds = payload.targetIds === 'all'
          ? profiles.filter(p => p && p.id && p.id !== id).map(p => p.id)
          : (Array.isArray(payload.targetIds) ? payload.targetIds.map(String) : []);
        const targetIdSet = new Set(rawTargetIds.filter(tid => tid && tid !== id));
        const targets = profiles.filter(p => p && targetIdSet.has(p.id));
        if (targets.length === 0) {
          sendJSON({ success: false, error: 'กรุณาเลือกจอปลายทางอย่างน้อย 1 จอ' }, 400);
          return true;
        }

        let appliedOnline = 0;
        let savedOffline = 0;
        await Promise.all(targets.map(async (tp) => {
          const existing = loadProfileAutoSellStore(tp.id);
          let nextRules;
          if (mode === 'merge') {
            const byName = new Map();
            (existing.rules || []).forEach(r => {
              if (!r || !r.itemName) return;
              byName.set(r.itemName.trim().toLowerCase(), Object.assign({}, r));
            });
            (sourceCfg.rules || []).forEach((r, idx) => {
              if (!r || !r.itemName) return;
              const k = r.itemName.trim().toLowerCase();
              if (byName.has(k)) {
                const prev = byName.get(k);
                prev.minQty = r.minQty;
                prev.sellMode = r.sellMode;
                prev.enabled = r.enabled !== false;
              } else {
                byName.set(k, {
                  id: `rule_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
                  itemName: r.itemName.trim(),
                  minQty: r.minQty,
                  sellMode: r.sellMode,
                  enabled: r.enabled !== false
                });
              }
            });
            nextRules = Array.from(byName.values());
          } else {
            nextRules = (sourceCfg.rules || []).map((r, idx) => ({
              id: `rule_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
              itemName: String(r.itemName || '').trim(),
              minQty: Math.max(1, Number(r.minQty) || 1),
              sellMode: r.sellMode === 'min' ? 'min' : 'all',
              enabled: r.enabled !== false
            }));
          }

          const targetCfg = saveProfileAutoSellStore(tp.id, {
            enabled: copyEnabled ? Boolean(sourceCfg.enabled) : Boolean(existing.enabled),
            priceStrategy: sourceCfg.priceStrategy || 'median',
            checkIntervalSec: sourceCfg.checkIntervalSec || 25,
            maxActiveListings: sourceCfg.maxActiveListings || 10,
            rules: nextRules
          });

          if (tp.debugPort) {
            try {
              const r = await evalProfilePort(tp.debugPort, buildAutoSellSaveCode(targetCfg), 4000);
              if (r && r.result && r.result.success) {
                appliedOnline++;
                return;
              }
            } catch (_) {}
          }
          savedOffline++;
        }));

        sendJSON({
          success: true,
          totalTargets: targets.length,
          appliedOnline,
          savedOffline,
          rulesCount: (sourceCfg.rules || []).length,
          otherProfiles: buildOtherProfilesMeta()
        });
        return true;
      }

      sendJSON({ success: false, error: 'ไม่รู้จักคำสั่ง autosell: ' + op }, 400);
      return true;
    }
    return false;
  }

  if (!profile.debugPort) {
    sendJSON({ success: false, error: 'จอนี้ออฟไลน์อยู่' }, 400);
    return true;
  }

  if (kind === 'inventory' && req.method === 'GET') {
    const r = await evalProfilePort(profile.debugPort, buildInventoryCode(), 5000);
    sendJSON(r && r.result ? r.result : { success: false, error: r?.error || 'อ่านกระเป๋าไม่สำเร็จ' });
    return true;
  }

  if (kind === 'halloween' && req.method === 'GET') {
    const r = await evalProfilePort(profile.debugPort, buildHalloweenReadCode(), 5000);
    sendJSON(r && r.result ? r.result : { success: false, error: r?.error || 'อ่านข้อมูลแลกของ Halloween ไม่สำเร็จ' });
    return true;
  }

  if (req.method !== 'POST' || kind === 'inventory') return false;
  const payload = await readBody(req);
  if (!payload) {
    sendJSON({ success: false, error: 'Invalid JSON' }, 400);
    return true;
  }

  if (kind === 'halloween') {
    const op = payload.op || 'save';
    if (op === 'save') {
      saveGlobalHalloweenStore(payload);
      const r = await evalProfilePort(profile.debugPort, buildHalloweenSaveCode(payload), 5000);
      sendJSON(r && r.result ? r.result : { success: false, error: r?.error || 'บันทึกตั้งค่า Halloween ไม่สำเร็จ' });
      return true;
    }
    if (op === 'exchange_now') {
      if (payload.rules && typeof payload.rules === 'object') saveGlobalHalloweenStore(payload);
      const r = await evalProfilePort(profile.debugPort, buildHalloweenExchangeNowCode(payload), 25000);
      sendJSON(r && r.result ? r.result : { success: false, error: r?.error || 'สั่งแลกของ Halloween ไม่สำเร็จ' });
      return true;
    }
    if (op === 'apply_all') {
      saveGlobalHalloweenStore(payload);
      const code = buildHalloweenSaveCode(payload);
      let applied = 0;
      for (const p of profiles) {
        if (!p.debugPort) continue;
        try {
          const r = await evalProfilePort(p.debugPort, code, 4000);
          if (r && r.result && r.result.success) applied++;
        } catch (_) {}
      }
      const cur = await evalProfilePort(profile.debugPort, buildHalloweenReadCode(), 4000);
      sendJSON(Object.assign(cur && cur.result ? cur.result : { success: true }, { appliedCount: applied, appliedOnline: applied }));
      return true;
    }
    sendJSON({ success: false, error: 'ไม่รู้จักคำสั่ง halloween: ' + op }, 400);
    return true;
  }

  const built = kind === 'market' ? buildMarketCode(payload) : buildInventoryActionCode(payload);
  if (built.error) {
    sendJSON({ success: false, error: built.error }, 400);
    return true;
  }
  const r = await evalProfilePort(profile.debugPort, built.code, built.timeout || 5000);
  if (kind === 'market' && r && r.result && r.result.success) {
    if (Array.isArray(r.result.active)) {
      overviewMarketCache.set(profile.id, {
        updatedAt: Date.now(),
        active: r.result.active,
        closed: Array.isArray(r.result.closed) ? r.result.closed : [],
        deliveries: Array.isArray(r.result.deliveries) ? r.result.deliveries : [],
        activeLimit: Number(r.result.activeLimit) || (r.result.premium ? 20 : 5),
        premium: Boolean(r.result.premium),
        zeny: Number(r.result.zeny) || 0
      });
    } else if (payload && payload.op === 'list') {
      overviewMarketCache.delete(profile.id);
    }
  }
  sendJSON(r && r.result ? r.result : { success: false, error: r?.error || 'สั่งงานในเกมไม่สำเร็จ' });
  return true;
}

module.exports = { handleInventoryMarketRoute, WITCH_HAZEL_ITEMS };
