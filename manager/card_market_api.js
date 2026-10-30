// manager/card_market_api.js — Card Market Price & Velocity Tracker + Farm Map Switcher
//
// Features:
//   1. Loads all 66 cards from Wiki Data (via getGameItems), including slot type, attributes,
//      specials, album bonus, dropping monsters, and farmable spawn maps.
//   2. Crowdsources card prices & sales velocity (soldQty24h, soldQty7d, avgSoldPerHour, lowestPrice,
//      medianPrice) with the Central Server (/v1/aetheria/machine/card-market) + local cache.
//   3. Background distributed scanner: uses idle online game screens to sweep active card listings
//      every ~10 min and batch-scan card 24h/7d trade histories every ~15 min without interrupting farming.
//   4. Farm Map Switcher: lets the user click any card, pick a spawn map, and select which client
//      screens to send to farm that map (overrides only the farm map while keeping Plan Script's
//      stat/skill/shop/stash/gear routines active).

'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'data', 'card_market_cache.json');
const OVERRIDES_FILE = path.join(__dirname, 'data', 'card_farm_overrides.json');
const AUTOSELL_STORE_PATH = path.join(__dirname, 'data', 'autosell_configs.json');
const BROWSER_STORAGE_DIR = path.join(__dirname, '..', 'sessions', '_browser_storage');

function normMapName(s) {
  return String(s || '').replace(/\s*\(Lv\..*?\)/i, '').trim().toLowerCase();
}

function isTownMapName(s) {
  return /เมืองหลวง|โซลเฮเวน|ตลาดคาราวาน/i.test(String(s || ''));
}

const MAP_LEVEL_LABELS = {
  'สวนนักผจญภัยมือใหม่': 'Lv.1-3',
  'ทุ่งโคลเวอร์': 'Lv.1-5',
  'ทุ่งหญ้าตะวันออก': 'Lv.1-5',
  'ไร่ซันเกรน': 'Lv.1-6',
  'ถนนต้นหลิว': 'Lv.6-12',
  'ทะเลสาบอาซูร์': 'Lv.12-20',
  'ป่ามูนลีฟ': 'Lv.14-22',
  'เส้นทางก็อบลิน': 'Lv.16-20',
  'เหมืองคริสตัลเก่า': 'Lv.18-28',
  'ค่ายออร์ค': 'Lv.22-32',
  'ถ้ำเอมเบอร์': 'Lv.22-32',
  'ที่ราบสูงเกล': 'Lv.25-35',
  'แอ่งเวอร์แดนท์': 'Lv.30-40',
  'ช่องเขาฟรอสต์พีค': 'Lv.35-45',
  'ชายฝั่งปะการัง': 'Lv.40-50',
  'ซากโบราณสถาน': 'Lv.45-55',
  'สุสานเงา': 'Lv.50-60',
  'หนองพิษ': 'Lv.60-70',
  'โบสถ์อเวจี': 'Lv.80-95',
  'บึงรากเน่า': 'Lv.90-105',
  'บัลลังก์ราชาลิช': 'Lv.105',
  'เนินทรายแผดเผา': 'Lv.100-115',
  'พีระมิดจมทราย': 'Lv.115-130',
  'สุสานฟาโรห์': 'Lv.135',
  'แกนลาวา': 'Lv.135-150',
  'แดนลาวา': 'Lv.135-150',
  'ดินแดนน้ำแข็ง': 'Lv.150-160',
  'ที่ราบศิลา': 'Lv.155-165',
  'สุสานรูนโบราณ': 'Lv.165-175',
  'คุกใต้ดินรูน': 'Lv.170-190'
};

function resolveCardsForFarmMap(rawCards, mapNamesOrSingle, cardId = 0, cardName = '') {
  const cards = Array.isArray(rawCards) ? rawCards : [];
  const seen = new Set();
  const out = [];
  const addCardName = (nm) => {
    const clean = String(nm || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };

  if (Number(cardId) > 0) {
    const matchById = cards.find(c => c && Number(c.id) === Number(cardId));
    if (matchById && matchById.name) addCardName(matchById.name);
  }
  if (cardName) addCardName(cardName);

  const mapList = Array.isArray(mapNamesOrSingle) ? mapNamesOrSingle : [mapNamesOrSingle];
  for (const rawMap of mapList) {
    const mNorm = normMapName(rawMap);
    if (!mNorm || isTownMapName(mNorm)) continue;
    for (const c of cards) {
      if (!c || !c.name) continue;
      const maps = Array.isArray(c.maps) ? c.maps : [];
      const dropsHere = maps.some(mp => {
        const mpName = (typeof mp === 'string') ? mp : (mp && mp.map);
        return normMapName(mpName) === mNorm;
      });
      if (dropsHere) addCardName(c.name);
    }
  }
  return out;
}

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

function ensureCardsInProfileAutoSellStore(profileId, cardNames, preloadedAllStore = null) {
  const pid = String(profileId || '').trim();
  const targetCards = Array.isArray(cardNames) ? cardNames.map(s => String(s || '').trim()).filter(Boolean) : [];
  if (!pid || targetCards.length === 0) return { changed: false, addedCards: [], config: null };

  const allStore = preloadedAllStore || loadAllAutoSellStore();
  let baseRaw = allStore[pid];
  const bsFile = path.join(BROWSER_STORAGE_DIR, `${pid}.json`);
  let bsData = null;
  if (!baseRaw) {
    try {
      if (fs.existsSync(bsFile)) {
        bsData = JSON.parse(fs.readFileSync(bsFile, 'utf8')) || {};
        const rawStr = bsData[`pelican_${pid}__auto_market_sell_cfg`] || bsData.pelican_auto_market_sell_cfg;
        if (rawStr) baseRaw = JSON.parse(rawStr);
      }
    } catch (_) {}
  }

  const cfg = sanitizeAutoSellConfig(baseRaw || { enabled: true, priceStrategy: 'median', rules: [] });
  let changed = !baseRaw;
  const addedCards = [];

  if (!cfg.enabled) {
    cfg.enabled = true;
    changed = true;
  }

  for (const cardName of targetCards) {
    const norm = cardName.toLowerCase();
    const existing = cfg.rules.find(r => r && String(r.itemName || '').trim().toLowerCase() === norm);
    if (existing) {
      if (Number(existing.minQty) !== 1 || existing.sellMode !== 'all' || existing.enabled === false) {
        existing.minQty = 1;
        existing.sellMode = 'all';
        existing.enabled = true;
        changed = true;
      }
    } else {
      cfg.rules.push({
        id: `rule_card_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        itemName: cardName,
        minQty: 1,
        sellMode: 'all',
        enabled: true
      });
      addedCards.push(cardName);
      changed = true;
    }
  }

  if (changed) {
    allStore[pid] = Object.assign({}, cfg, { updatedAt: Date.now() });
    if (!preloadedAllStore) {
      try {
        fs.mkdirSync(path.dirname(AUTOSELL_STORE_PATH), { recursive: true });
        fs.writeFileSync(AUTOSELL_STORE_PATH, JSON.stringify(allStore, null, 2), 'utf8');
      } catch (_) {}
    }
    try {
      fs.mkdirSync(BROWSER_STORAGE_DIR, { recursive: true });
      if (!bsData) {
        bsData = {};
        if (fs.existsSync(bsFile)) {
          try { bsData = JSON.parse(fs.readFileSync(bsFile, 'utf8')) || {}; } catch (_) { bsData = {}; }
        }
      }
      const serialized = JSON.stringify(cfg);
      bsData[`pelican_${pid}__auto_market_sell_cfg`] = serialized;
      bsData.pelican_auto_market_sell_cfg = serialized;
      fs.writeFileSync(bsFile, JSON.stringify(bsData, null, 2), 'utf8');
    } catch (_) {}
  }

  return { changed, addedCards, config: cfg };
}

function buildEnsureCardAutoSellSnippet(cardNames) {
  const cleanNames = Array.isArray(cardNames) ? cardNames.map(s => String(s || '').trim()).filter(Boolean) : [];
  return `(() => {
    const targetCards = ${JSON.stringify(cleanNames)};
    if (!targetCards.length) return { changed: false, added: [], rulesCount: 0 };
    const defaultCfg = { enabled: true, priceStrategy: 'median', checkIntervalSec: 25, maxActiveListings: 10, rules: [] };
    if (!window.__autoMarketSellConfig || typeof window.__autoMarketSellConfig !== 'object') {
      try {
        const stored = JSON.parse(localStorage.getItem('pelican_auto_market_sell_cfg') || '{}');
        window.__autoMarketSellConfig = Object.assign({}, defaultCfg, stored);
      } catch (e) {
        window.__autoMarketSellConfig = Object.assign({}, defaultCfg);
      }
    }
    const cfg = window.__autoMarketSellConfig;
    if (!Array.isArray(cfg.rules)) cfg.rules = [];
    let changed = false;
    if (!cfg.enabled) {
      cfg.enabled = true;
      changed = true;
    }
    const added = [];
    for (const rawName of targetCards) {
      const nm = String(rawName || '').trim();
      if (!nm) continue;
      const norm = nm.toLowerCase();
      const existing = cfg.rules.find(r => r && String(r.itemName || '').trim().toLowerCase() === norm);
      if (existing) {
        if (Number(existing.minQty) !== 1 || existing.sellMode !== 'all' || existing.enabled === false) {
          existing.minQty = 1;
          existing.sellMode = 'all';
          existing.enabled = true;
          changed = true;
        }
      } else {
        cfg.rules.push({
          id: 'rule_card_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          itemName: nm,
          minQty: 1,
          sellMode: 'all',
          enabled: true
        });
        added.push(nm);
        changed = true;
      }
    }
    if (changed) {
      try {
        if (typeof window.saveAutoMarketSellConfig === 'function') window.saveAutoMarketSellConfig();
        else localStorage.setItem('pelican_auto_market_sell_cfg', JSON.stringify(cfg));
      } catch (e) {}
      try {
        const t1 = document.getElementById('p-autosell-toggle');
        if (t1) t1.checked = true;
        const t2 = document.getElementById('p-autosell-toggle-hud');
        if (t2) t2.checked = true;
        const badge = document.getElementById('p-subtab-autosell-count');
        if (badge) badge.innerText = String(cfg.rules.length);
        if (typeof window.renderAutoSellHudRulesHtml === 'function') {
          const hudBox = document.getElementById('p-autosell-hud-rules-container');
          if (hudBox) hudBox.innerHTML = window.renderAutoSellHudRulesHtml();
        }
        if (typeof window.renderAutoSellRulesHtml === 'function') {
          const modBox = document.getElementById('p-autosell-rules-container');
          if (modBox) modBox.innerHTML = window.renderAutoSellRulesHtml();
        }
      } catch (e) {}
      if (window.__isBotRunning && typeof window.runAutoMarketSellCycle === 'function' && !window.__isAutoSellingNow) {
        setTimeout(() => {
          try { window.runAutoMarketSellCycle(false); } catch (e) {}
        }, 1200);
      }
    }
    return { changed, added, enabled: Boolean(cfg.enabled), rulesCount: cfg.rules.length };
  })()`;
}

const BUSY_FLAGS = [
  '__isConsolidating', '__isShopping', '__isAutoSellingNow', '__isManualSelling',
  '__isStoring', '__isMarketScanning', '__isChangingJob', '__isGearRefining', '__isWeightScrollBusy'
];

function loadLocalCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const d = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (d && typeof d === 'object') {
        return {
          updatedAt: Number(d.updatedAt) || 0,
          lastListingSweepAt: Number(d.lastListingSweepAt) || 0,
          prices: (d.prices && typeof d.prices === 'object') ? d.prices : {}
        };
      }
    }
  } catch (_) {}
  return { updatedAt: 0, lastListingSweepAt: 0, prices: {} };
}

function saveLocalCache(cache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (_) {}
}

function loadOverridesStore() {
  try {
    if (fs.existsSync(OVERRIDES_FILE)) {
      const d = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'));
      if (d && typeof d === 'object') return d;
    }
  } catch (_) {}
  return {};
}

function saveOverridesStore(store) {
  try {
    fs.mkdirSync(path.dirname(OVERRIDES_FILE), { recursive: true });
    fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (_) {}
}

function updateBrowserStorageOverride(profileId, mapName) {
  const pid = String(profileId || '').trim();
  if (!pid) return;
  try {
    fs.mkdirSync(BROWSER_STORAGE_DIR, { recursive: true });
    const bsFile = path.join(BROWSER_STORAGE_DIR, `${pid}.json`);
    let d = {};
    if (fs.existsSync(bsFile)) {
      try { d = JSON.parse(fs.readFileSync(bsFile, 'utf8')) || {}; } catch (_) { d = {}; }
    }
    const clean = String(mapName || '').trim();
    delete d[`pelican_${pid}__override_farm_map`];
    delete d.pelican_override_farm_map;
    if (clean) {
      d[`pelican_${pid}__farm_map`] = clean;
      d.pelican_farm_map = clean;
      d[`pelican_${pid}__plan_manual_map`] = clean;
      d.pelican_plan_manual_map = clean;
    } else {
      delete d[`pelican_${pid}__plan_manual_map`];
      delete d.pelican_plan_manual_map;
    }
    fs.writeFileSync(bsFile, JSON.stringify(d, null, 2), 'utf8');
  } catch (_) {}
}

function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch (_) { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

// In-page snippet to check if a client is idle and connected to the game room
const CHECK_CLIENT_IDLE_JS = `(() => {
  const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
  if (!room || !room.connection || !room.connection.isOpen) return { ready: false, reason: 'not-connected' };
  const busyFlags = ${JSON.stringify(BUSY_FLAGS)};
  for (const f of busyFlags) {
    if (window[f]) return { ready: false, reason: f };
  }
  return {
    ready: true,
    overrideFarmMap: window.__overrideFarmMap || localStorage.getItem('pelican_override_farm_map') || '',
    targetFarmMap: window.__targetFarmMap || localStorage.getItem('pelican_farm_map') || ''
  };
})()`;

// In-page snippet to sweep all active Card listings in the market (up to 10 pages, 20 items/page)
function buildSweepListingsCode(allCardIds) {
  return `(async () => {
    const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
    if (!room || !room.connection || !room.connection.isOpen) return { success: false, error: 'ไม่ได้เชื่อมต่อเกม' };
    const cardSet = new Set(${JSON.stringify(allCardIds)});
    const cfg = window.__marketFilterConfig || {};
    const shared = typeof window.pauseSniper === 'function';
    const saved = { autoBuy: cfg.autoBuy, sniperAlert: cfg.sniperAlert };
    if (shared) window.pauseSniper(); else { cfg.autoBuy = false; cfg.sniperAlert = false; }

    const awaitReply = (type, send, ms) => new Promise(resolve => {
      let unsub;
      const t = setTimeout(() => { if (unsub) unsub(); resolve(null); }, ms);
      unsub = room.onMessage(type, msg => { clearTimeout(t); if (unsub) unsub(); resolve(msg); });
      send();
    });

    const listings = [];
    let total = 0;
    try {
      for (let page = 0; page < 10; page++) {
        if (page > 0) await new Promise(r => setTimeout(r, 320));
        const res = await awaitReply('market_results', () => {
          room.send('market', { op: 'search', filters: { q: 'Card', sort: 'price_asc', page } });
        }, 3500);
        if (!res || !Array.isArray(res.listings)) break;
        total = Number(res.total) || 0;
        listings.push(...res.listings);
        if (listings.length >= total || res.listings.length < (res.pageSize || 20)) break;
      }
    } finally {
      if (shared) window.resumeSniper();
      else setTimeout(() => { cfg.autoBuy = saved.autoBuy; cfg.sniperAlert = saved.sniperAlert; }, 400);
    }

    const now = Date.now();
    const byCard = new Map();
    const seenListingIds = new Set();
    for (const l of listings) {
      if (!l || !l.item) continue;
      if (l.listingId !== undefined) {
        if (seenListingIds.has(l.listingId)) continue;
        seenListingIds.add(l.listingId);
      }
      const itemId = Number(l.item.itemId ?? l.item.id);
      if (!cardSet.has(itemId)) continue;
      if (l.auctionEndsAt && Number(l.auctionEndsAt) > now) continue;
      const qty = Math.max(1, Number(l.qty) || 1);
      const unitPrice = Math.floor((Number(l.price) || 0) / qty);
      if (unitPrice <= 0) continue;
      const cur = byCard.get(itemId) || {
        itemId,
        itemName: String(l.item.name || ''),
        lowestPrice: unitPrice,
        activeListings: 0,
        activeQty: 0
      };
      if (unitPrice < cur.lowestPrice) cur.lowestPrice = unitPrice;
      cur.activeListings += 1;
      cur.activeQty += qty;
      byCard.set(itemId, cur);
    }

    const items = Array.from(byCard.values());
    const zeroCardIds = Array.from(cardSet).filter(id => !byCard.has(id));
    return { success: true, totalScanned: listings.length, items, zeroCardIds };
  })()`;
}

// In-page snippet to query 24h (and 7d fallback) trade history for a batch of card IDs
function buildHistoryBatchCode(cardItems, alsoSearchListingsForSingle = false) {
  return `(async () => {
    const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
    if (!room || !room.connection || !room.connection.isOpen) return { success: false, error: 'ไม่ได้เชื่อมต่อเกม' };
    const targets = ${JSON.stringify(cardItems)};
    const alsoListings = ${Boolean(alsoSearchListingsForSingle)};

    const awaitHistory = (itemId, range, ms) => new Promise(resolve => {
      let unsub;
      const t = setTimeout(() => { if (unsub) unsub(); resolve(null); }, ms);
      unsub = room.onMessage('market_history', msg => {
        if (msg && Number(msg.itemId) === Number(itemId)) {
          clearTimeout(t);
          if (unsub) unsub();
          resolve(msg);
        }
      });
      room.send('market', { op: 'history', itemId: Number(itemId), refine: 0, range });
    });

    const computePriceStats = (msg, windowMs) => {
      if (!msg) return { median: 0, min: 0, max: 0, lastPrice: 0, lastMs: 0, trades: 0, soldQty: 0 };
      const recent = Array.isArray(msg.recent) ? msg.recent : [];
      const points = Array.isArray(msg.points) ? msg.points : [];
      const now = Date.now();
      const cutoff = windowMs > 0 ? (now - windowMs) : 0;
      let recentQtyInWindow = 0;
      let recentTradesInWindow = 0;
      let lastPrice = 0;
      let lastMs = 0;
      const unitPrices = [];
      for (let i = 0; i < recent.length; i++) {
        const r = recent[i];
        if (!r) continue;
        const q = Math.max(1, Number(r.qty ?? r.amount ?? 1) || 1);
        const p = Math.round((Number(r.price) || 0) / q);
        if (p > 0) {
          unitPrices.push(p);
          const ts = Number(r.at || r.soldAt || r.createdAt || r.time || r.timestamp || 0) || 0;
          if (cutoff === 0 || (ts > 0 && ts >= cutoff)) {
            recentQtyInWindow += q;
            recentTradesInWindow++;
          }
          if (i === 0 || (ts > 0 && ts >= lastMs)) {
            lastPrice = p;
            if (ts > lastMs) lastMs = ts;
          }
        }
      }
      let pointsQty = 0;
      let pointBucketsWithSales = 0;
      let fallbackAvg = 0;
      for (const pt of points) {
        if (!pt) continue;
        const pq = Number(pt.pieces ?? pt.qty ?? pt.volume ?? pt.count ?? pt.sold ?? 0) || 0;
        pointsQty += pq;
        if (pq > 0 || (Number(pt.avg) || 0) > 0) pointBucketsWithSales++;
        if ((Number(pt.avg) || 0) > 0) fallbackAvg = Math.round(Number(pt.avg));
      }
      const soldQty = pointsQty > 0 ? pointsQty : recentQtyInWindow;
      const trades = pointBucketsWithSales > 0 ? Math.max(pointBucketsWithSales, recentTradesInWindow) : recentTradesInWindow;
      if (unitPrices.length === 0) {
        return {
          median: fallbackAvg,
          min: fallbackAvg,
          max: fallbackAvg,
          lastPrice: fallbackAvg,
          lastMs: 0,
          trades,
          soldQty
        };
      }
      const sorted = unitPrices.slice().sort((a, b) => a - b);
      let clean = sorted;
      if (sorted.length >= 4) {
        const q1 = sorted[Math.floor(sorted.length * 0.25)];
        const q3 = sorted[Math.floor(sorted.length * 0.75)];
        const iqr = q3 - q1;
        const low = Math.max(1, q1 - 1.5 * iqr);
        const high = q3 + 1.5 * iqr;
        const filtered = sorted.filter(x => x >= low && x <= high);
        if (filtered.length > 0) clean = filtered;
      }
      const mid = Math.floor(clean.length / 2);
      const median = (clean.length % 2 === 0 && clean.length > 1)
        ? Math.round((clean[mid - 1] + clean[mid]) / 2)
        : clean[mid];
      return {
        median,
        min: clean[0] || 0,
        max: clean[clean.length - 1] || 0,
        lastPrice: lastPrice || median,
        lastMs,
        trades,
        soldQty
      };
    };

    const out = [];
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const itemId = Number(t.id || t.itemId);
      const itemName = String(t.name || t.itemName || '');
      if (!itemId) continue;
      if (i > 0) await new Promise(r => setTimeout(r, 360));

      const msg24 = await awaitHistory(itemId, '24h', 3200);
      const st24 = computePriceStats(msg24, 24 * 3600 * 1000);
      let st7d = { median: 0, min: 0, max: 0, lastPrice: 0, lastMs: 0, trades: 0, soldQty: 0 };
      if (st24.soldQty === 0 || st24.median === 0) {
        await new Promise(r => setTimeout(r, 250));
        const msg7d = await awaitHistory(itemId, '7d', 3200);
        st7d = computePriceStats(msg7d, 7 * 24 * 3600 * 1000);
      }

      const soldQty24h = st24.soldQty;
      const soldQty7d = Math.max(soldQty24h, st7d.soldQty);
      const avgSoldPerHour = soldQty24h > 0
        ? Math.round((soldQty24h / 24) * 100) / 100
        : (soldQty7d > 0 ? Math.round((soldQty7d / 168) * 100) / 100 : 0);

      const entry = {
        itemId,
        itemName,
        medianPrice: st24.median > 0 ? st24.median : st7d.median,
        minTradePrice: st24.min > 0 ? st24.min : st7d.min,
        maxTradePrice: st24.max > 0 ? st24.max : st7d.max,
        trades24h: st24.trades,
        soldQty24h,
        soldQty7d,
        avgSoldPerHour,
        lastTradePrice: st24.lastPrice > 0 ? st24.lastPrice : st7d.lastPrice,
        lastTradeMs: st24.lastMs || st7d.lastMs || 0
      };

      if (alsoListings && targets.length === 1 && itemName) {
        const cfg = window.__marketFilterConfig || {};
        const shared = typeof window.pauseSniper === 'function';
        const saved = { autoBuy: cfg.autoBuy, sniperAlert: cfg.sniperAlert };
        if (shared) window.pauseSniper(); else { cfg.autoBuy = false; cfg.sniperAlert = false; }
        try {
          const searchRes = await new Promise(resolve => {
            let unsub;
            const tm = setTimeout(() => { if (unsub) unsub(); resolve(null); }, 3000);
            unsub = room.onMessage('market_results', m => { clearTimeout(tm); if (unsub) unsub(); resolve(m); });
            room.send('market', { op: 'search', filters: { q: itemName, sort: 'price_asc', page: 0 } });
          });
          if (searchRes && Array.isArray(searchRes.listings)) {
            const now = Date.now();
            let lowest = 0, count = 0, qtySum = 0;
            for (const l of searchRes.listings) {
              if (!l || !l.item || Number(l.item.itemId ?? l.item.id) !== itemId) continue;
              if (l.auctionEndsAt && Number(l.auctionEndsAt) > now) continue;
              const q = Math.max(1, Number(l.qty) || 1);
              const u = Math.floor((Number(l.price) || 0) / q);
              if (u > 0) {
                if (lowest === 0 || u < lowest) lowest = u;
                count++;
                qtySum += q;
              }
            }
            entry.lowestPrice = lowest;
            entry.activeListings = count;
            entry.activeQty = qtySum;
          }
        } finally {
          if (shared) window.resumeSniper();
          else setTimeout(() => { cfg.autoBuy = saved.autoBuy; cfg.sniperAlert = saved.sniperAlert; }, 400);
        }
      }

      out.push(entry);
    }
    return { success: true, historyItems: out };
  })()`;
}

// In-page snippet to switch the farm map once (one-time switch, never locks/overrides subsequent map changes or party sync)
function buildSetOverrideMapCode(mapName, autoSellCards = []) {
  const autoSellSnippet = buildEnsureCardAutoSellSnippet(autoSellCards);
  return `(() => {
    const rawMap = ${JSON.stringify(String(mapName || ''))};
    const clean = rawMap.replace(/\\s*\\(Lv\\..*?\\)/i, '').trim();
    window.__overrideFarmMap = '';
    try { localStorage.removeItem('pelican_override_farm_map'); } catch (e) {}

    // Ensure planMapForNow respects partyForcedMap first and pelican_plan_manual_map second, without any sticky card lock
    const basePlanMapForNow = (window.planMapForNow && window.planMapForNow.__origPlanMapForNow)
      ? window.planMapForNow.__origPlanMapForNow
      : window.planMapForNow;
    if (typeof basePlanMapForNow === 'function' && (!window.planMapForNow || !window.planMapForNow.__oneTimeHooked)) {
      const wrapped = function(opts) {
        const partyMap = String(window.__partyForcedMap || '').replace(/\\s*\\(Lv\\..*?\\)/i, '').trim();
        if (partyMap && !/เมืองหลวง|โซลเฮเวน|ตลาดคาราวาน/.test(partyMap)) return partyMap;
        if (!(opts && (opts.ignoreOverride || opts.ignoreManual))) {
          let man = '';
          try { man = String(localStorage.getItem('pelican_plan_manual_map') || '').replace(/\\s*\\(Lv\\..*?\\)/i, '').trim(); } catch (e) {}
          if (man && !/เมืองหลวง|โซลเฮเวน|ตลาดคาราวาน/.test(man)) return man;
        }
        return basePlanMapForNow.apply(this, arguments);
      };
      wrapped.__origPlanMapForNow = basePlanMapForNow;
      wrapped.__oneTimeHooked = true;
      window.planMapForNow = wrapped;
    }

    // Ensure any future call to setTargetFarmMap with a non-town map updates pelican_plan_manual_map so it never snaps back
    if (typeof window.setTargetFarmMap === 'function' && !window.setTargetFarmMap.__manualSyncHooked) {
      const origSetTarget = window.setTargetFarmMap;
      const wrappedSetTarget = function(m, walkNow, opts) {
        const cm = String(m || '').replace(/\\s*\\(Lv\\..*?\\)/i, '').trim();
        if (cm && !/เมืองหลวง|โซลเฮเวน|ตลาดคาราวาน/.test(cm) && !(opts && opts.fromPlanTrigger)) {
          try {
            if (localStorage.getItem('pelican_plan_manual_map')) {
              if (typeof window.setPlanManualMap === 'function') window.setPlanManualMap(cm);
              else localStorage.setItem('pelican_plan_manual_map', cm);
            }
          } catch (e) {}
        }
        return origSetTarget.apply(this, arguments);
      };
      wrappedSetTarget.__manualSyncHooked = true;
      window.setTargetFarmMap = wrappedSetTarget;
    }

    window.setOverrideFarmMap = function(m, walkNow = true) {
      const c = String(m || '').replace(/\\s*\\(Lv\\..*?\\)/i, '').trim();
      window.__overrideFarmMap = '';
      try { localStorage.removeItem('pelican_override_farm_map'); } catch (e) {}
      if (!c || /เมืองหลวง|โซลเฮเวน|ตลาดคาราวาน/.test(c)) {
        try {
          localStorage.removeItem('pelican_plan_manual_map');
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.endsWith('_manual')) localStorage.removeItem(k);
          }
        } catch (e) {}
        if (walkNow && window.__planScriptEnabled && typeof window.planMapForNow === 'function') {
          const pm = window.planMapForNow({ ignoreOverride: true, ignoreManual: true });
          if (pm && typeof window.setTargetFarmMap === 'function') window.setTargetFarmMap(pm, true, { fromPlanTrigger: true });
        }
        return { success: true, overrideMap: null, targetMap: window.__targetFarmMap || null };
      }
      if (typeof window.clearSafeMap === 'function') window.clearSafeMap('เปลี่ยนแมพฟาร์มการ์ด');
      if (typeof window.setPlanManualMap === 'function') window.setPlanManualMap(c);
      else { try { localStorage.setItem('pelican_plan_manual_map', c); } catch (e) {} }
      if (typeof window.setTargetFarmMap === 'function') {
        window.setTargetFarmMap(c, walkNow);
      } else {
        window.__targetFarmMap = c;
        try { localStorage.setItem('pelican_farm_map', c); } catch (e) {}
        if (walkNow && window.__isBotRunning && typeof window.walkToTargetMap === 'function') {
          window.walkToTargetMap(c, true);
        }
      }
      return { success: true, overrideMap: c, targetMap: window.__targetFarmMap || c };
    };

    const mapRes = window.setOverrideFarmMap(clean, true);
    let autoSellRes = null;
    try { autoSellRes = ${autoSellSnippet}; } catch (e) {}
    return Object.assign({}, mapRes || { success: true }, { autoSell: autoSellRes });
  })()`;
}

function createCardMarketService({
  loadProfiles,
  saveProfiles,
  evalProfilePort,
  queryProfileState,
  getGameItems,
  humanCheckSolver
}) {
  let localCache = loadLocalCache();
  let overridesStore = loadOverridesStore();
  let scanning = false;
  let lastCentralSyncAt = 0;
  let lastManualRefreshAt = 0;
  let timer = null;
  const lastSyncedLiveAutoSell = new Map();

  function mergePriceRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return;
    let maxUpdated = localCache.updatedAt || 0;
    for (const r of rows) {
      const id = Number(r && r.itemId);
      if (!id) continue;
      const prev = localCache.prices[id] || {};
      const rUpd = Number(r.updatedAt) || Date.now();
      if (rUpd > maxUpdated) maxUpdated = rUpd;
      localCache.prices[id] = {
        itemId: id,
        itemName: r.itemName || prev.itemName || '',
        lowestPrice: r.lowestPrice !== undefined ? Number(r.lowestPrice) || 0 : (Number(prev.lowestPrice) || 0),
        medianPrice: r.medianPrice !== undefined && Number(r.medianPrice) > 0 ? Number(r.medianPrice) : (Number(prev.medianPrice) || 0),
        minTradePrice: r.minTradePrice !== undefined && Number(r.minTradePrice) > 0 ? Number(r.minTradePrice) : (Number(prev.minTradePrice) || 0),
        maxTradePrice: r.maxTradePrice !== undefined && Number(r.maxTradePrice) > 0 ? Number(r.maxTradePrice) : (Number(prev.maxTradePrice) || 0),
        activeListings: r.activeListings !== undefined ? Number(r.activeListings) || 0 : (Number(prev.activeListings) || 0),
        activeQty: r.activeQty !== undefined ? Number(r.activeQty) || 0 : (Number(prev.activeQty) || 0),
        trades24h: r.trades24h !== undefined ? Number(r.trades24h) || 0 : (Number(prev.trades24h) || 0),
        soldQty24h: r.soldQty24h !== undefined ? Number(r.soldQty24h) || 0 : (Number(prev.soldQty24h) || 0),
        soldQty7d: r.soldQty7d !== undefined ? Number(r.soldQty7d) || 0 : (Number(prev.soldQty7d) || 0),
        avgSoldPerHour: r.avgSoldPerHour !== undefined ? Number(r.avgSoldPerHour) || 0 : (Number(prev.avgSoldPerHour) || 0),
        lastTradePrice: r.lastTradePrice !== undefined && Number(r.lastTradePrice) > 0 ? Number(r.lastTradePrice) : (Number(prev.lastTradePrice) || 0),
        lastTradeMs: r.lastTradeMs !== undefined && Number(r.lastTradeMs) > 0 ? Number(r.lastTradeMs) : (Number(prev.lastTradeMs) || 0),
        listingUpdatedAt: Number(r.listingUpdatedAt) || Number(prev.listingUpdatedAt) || 0,
        historyUpdatedAt: Number(r.historyUpdatedAt) || Number(prev.historyUpdatedAt) || 0,
        updatedAt: rUpd
      };
    }
    localCache.updatedAt = Math.max(localCache.updatedAt || 0, maxUpdated);
    saveLocalCache(localCache);
  }

  async function findIdleOnlineProfiles() {
    const profiles = loadProfiles() || [];
    const online = profiles.filter(p => p && p.debugPort);
    const idle = [];
    await Promise.all(online.map(async (p) => {
      try {
        const r = await evalProfilePort(p.debugPort, CHECK_CLIENT_IDLE_JS, 2500);
        if (r && r.result && r.result.ready) {
          idle.push({
            profile: p,
            overrideFarmMap: r.result.overrideFarmMap || '',
            targetFarmMap: r.result.targetFarmMap || ''
          });
        }
      } catch (_) {}
    }));
    return idle;
  }

  async function syncWithCentral(opts = {}) {
    if (!humanCheckSolver || typeof humanCheckSolver.serviceRequest !== 'function') return null;
    try {
      const gameData = await getGameItems().catch(() => null);
      const cards = (gameData && Array.isArray(gameData.cards)) ? gameData.cards : [];
      const cardIds = cards.map(c => Number(c.id)).filter(Boolean);
      const res = await humanCheckSolver.serviceRequest('/v1/aetheria/machine/card-market', {
        op: opts.op || 'get',
        canScan: Boolean(opts.canScan),
        forceScan: Boolean(opts.forceScan),
        batchSize: opts.batchSize || 12,
        cardIds,
        listingSweep: opts.listingSweep || undefined,
        historyItems: opts.historyItems || undefined
      });
      if (res && res.success) {
        lastCentralSyncAt = Date.now();
        if (Number(res.lastListingSweepAt) > (localCache.lastListingSweepAt || 0)) {
          localCache.lastListingSweepAt = Number(res.lastListingSweepAt);
        }
        if (Array.isArray(res.prices)) {
          mergePriceRows(res.prices);
        }
        return res;
      }
    } catch (_) {}
    return null;
  }

  async function runScanCycle(opts = {}) {
    if (scanning) return { success: false, busy: true, error: 'กำลังสแกนราคาการ์ดอยู่' };
    scanning = true;
    try {
      const gameData = await getGameItems().catch(() => null);
      const cards = (gameData && Array.isArray(gameData.cards)) ? gameData.cards : [];
      if (!cards.length) return { success: false, error: 'ไม่สามารถโหลดข้อมูลการ์ดจากฐานข้อมูลเกมได้' };
      const cardById = new Map(cards.map(c => [Number(c.id), c]));
      const allCardIds = Array.from(cardById.keys());

      const idleClients = await findIdleOnlineProfiles();
      if (idleClients.length === 0) {
        await syncWithCentral({ op: 'get', canScan: false });
        return { success: false, noOnlineClient: true, error: 'ไม่มีจอเกมที่ออนไลน์และว่างสำหรับสแกนตลาด (ดึงข้อมูลจากเซิร์ฟเวอร์กลางแทน)' };
      }

      // Single-card refresh (when user clicks a specific card)
      if (opts.itemId) {
        const card = cardById.get(Number(opts.itemId));
        if (!card) return { success: false, error: 'ไม่พบการ์ดนี้' };
        const client = idleClients[0].profile;
        const r = await evalProfilePort(
          client.debugPort,
          buildHistoryBatchCode([{ id: card.id, name: card.name }], true),
          12000
        );
        const histItems = (r && r.result && r.result.success && Array.isArray(r.result.historyItems))
          ? r.result.historyItems
          : [];
        if (histItems.length > 0) {
          const now = Date.now();
          mergePriceRows(histItems.map(h => Object.assign({}, h, {
            listingUpdatedAt: now,
            historyUpdatedAt: now,
            updatedAt: now
          })));
          await syncWithCentral({ op: 'report', historyItems: histItems });
          return { success: true, updatedCount: histItems.length };
        }
        return { success: false, error: 'ดึงข้อมูลราคาการ์ดจากเกมไม่สำเร็จ' };
      }

      // Ask Central DB what needs scanning
      const forceScan = Boolean(opts.force);
      const batchSize = forceScan ? Math.min(24, Math.max(12, idleClients.length * 8)) : 12;
      const centralPlan = await syncWithCentral({
        op: 'get',
        canScan: true,
        forceScan,
        batchSize
      });

      const now = Date.now();
      const shouldSweep = forceScan ||
        (centralPlan ? Boolean(centralPlan.shouldSweepListings) : (now - (localCache.lastListingSweepAt || 0) >= 10 * 60 * 1000));

      let assignedIds = (centralPlan && Array.isArray(centralPlan.assignedHistoryIds) && centralPlan.assignedHistoryIds.length > 0)
        ? centralPlan.assignedHistoryIds
        : [];

      if (assignedIds.length === 0) {
        const ttl = forceScan ? 2 * 60 * 1000 : 15 * 60 * 1000;
        const stale = allCardIds
          .map(id => ({ id, hAt: Number((localCache.prices[id] || {}).historyUpdatedAt) || 0 }))
          .filter(x => now - x.hAt >= ttl)
          .sort((a, b) => a.hAt - b.hAt);
        assignedIds = stale.slice(0, batchSize).map(x => x.id);
      }

      let listingSweepPayload = null;
      if (shouldSweep) {
        const sweepClient = idleClients[0].profile;
        const sr = await evalProfilePort(sweepClient.debugPort, buildSweepListingsCode(allCardIds), 28000);
        if (sr && sr.result && sr.result.success) {
          listingSweepPayload = {
            items: sr.result.items || [],
            zeroCardIds: sr.result.zeroCardIds || []
          };
          const sweepRows = [];
          for (const it of listingSweepPayload.items) {
            sweepRows.push({
              itemId: it.itemId,
              itemName: it.itemName,
              lowestPrice: it.lowestPrice,
              activeListings: it.activeListings,
              activeQty: it.activeQty,
              listingUpdatedAt: Date.now(),
              updatedAt: Date.now()
            });
          }
          for (const zid of listingSweepPayload.zeroCardIds) {
            const c = cardById.get(Number(zid));
            sweepRows.push({
              itemId: Number(zid),
              itemName: c ? c.name : '',
              lowestPrice: 0,
              activeListings: 0,
              activeQty: 0,
              listingUpdatedAt: Date.now(),
              updatedAt: Date.now()
            });
          }
          localCache.lastListingSweepAt = Date.now();
          mergePriceRows(sweepRows);
        }
      }

      const historyItemsPayload = [];
      if (assignedIds.length > 0) {
        const targetCards = assignedIds.map(id => cardById.get(Number(id))).filter(Boolean);
        // Distribute across up to 3 idle clients in parallel for fast, gentle scanning
        const workers = idleClients.slice(0, 3);
        const chunks = workers.map(() => []);
        targetCards.forEach((c, idx) => chunks[idx % workers.length].push({ id: c.id, name: c.name }));

        await Promise.all(workers.map(async (w, idx) => {
          const chunk = chunks[idx];
          if (!chunk || chunk.length === 0) return;
          try {
            const hr = await evalProfilePort(w.profile.debugPort, buildHistoryBatchCode(chunk, false), 8000 + chunk.length * 4500);
            if (hr && hr.result && hr.result.success && Array.isArray(hr.result.historyItems)) {
              historyItemsPayload.push(...hr.result.historyItems);
            }
          } catch (_) {}
        }));

        if (historyItemsPayload.length > 0) {
          const ts = Date.now();
          mergePriceRows(historyItemsPayload.map(h => Object.assign({}, h, {
            historyUpdatedAt: ts,
            updatedAt: ts
          })));
        }
      }

      if (listingSweepPayload || historyItemsPayload.length > 0) {
        await syncWithCentral({
          op: 'report',
          listingSweep: listingSweepPayload || undefined,
          historyItems: historyItemsPayload.length > 0 ? historyItemsPayload : undefined
        });
      }

      return {
        success: true,
        sweptListings: Boolean(listingSweepPayload),
        updatedHistories: historyItemsPayload.length
      };
    } finally {
      scanning = false;
    }
  }

  async function buildFullState(syncRemote = false) {
    if (syncRemote || Date.now() - lastCentralSyncAt > 45000) {
      await syncWithCentral({ op: 'get', canScan: false });
    }
    const gameData = await getGameItems().catch(() => ({ cards: [] }));
    const rawCards = Array.isArray(gameData && gameData.cards) ? gameData.cards : [];
    const cards = rawCards.map(c => {
      const p = localCache.prices[c.id] || {};
      const lowestPrice = Number(p.lowestPrice) || 0;
      const medianPrice = Number(p.medianPrice) || 0;
      const lastTradePrice = Number(p.lastTradePrice) || 0;
      const displayPrice = lowestPrice > 0 ? lowestPrice : (medianPrice > 0 ? medianPrice : lastTradePrice);
      const priceObj = {
        displayPrice,
        lowestPrice,
        medianPrice,
        lastTradePrice,
        minTradePrice: Number(p.minTradePrice) || 0,
        maxTradePrice: Number(p.maxTradePrice) || 0,
        activeListings: Number(p.activeListings) || 0,
        activeQty: Number(p.activeQty) || 0,
        trades24h: Number(p.trades24h) || 0,
        soldQty24h: Number(p.soldQty24h) || 0,
        soldQty7d: Number(p.soldQty7d) || 0,
        avgSoldPerHour: Number(p.avgSoldPerHour) || 0,
        listingUpdatedAt: Number(p.listingUpdatedAt) || 0,
        historyUpdatedAt: Number(p.historyUpdatedAt) || 0,
        updatedAt: Number(p.updatedAt) || 0
      };
      const slotArr = Array.isArray(c.cardSlotTypes) ? c.cardSlotTypes : (c.cardSlot ? [c.cardSlot] : []);
      const attrTexts = (Array.isArray(c.attributes) ? c.attributes : []).map(a => {
        if (!a) return '';
        if (typeof a === 'string') return a;
        const pct = a.mode === 'increasedPercent' || /PERCENT|RATE|POWER|CRIT_DAMAGE/i.test(String(a.type || '')) ? '%' : '';
        const sign = Number(a.value) >= 0 ? '+' : '';
        const ref = Number(a.perRefine) ? ` (+${a.perRefine}${pct}/ตีบวก)` : '';
        return `${a.type} ${sign}${a.value}${pct}${ref}`;
      }).filter(Boolean);
      const allEffects = [...attrTexts, ...(Array.isArray(c.specials) ? c.specials : [])];
      const albumText = Array.isArray(c.album)
        ? c.album.map(al => {
            if (!al) return '';
            if (typeof al === 'string') return al;
            const sign = Number(al.value) >= 0 ? '+' : '';
            return `${al.stat || al.type || ''} ${sign}${al.value}`;
          }).filter(Boolean).join(', ')
        : String(c.album || '');
      return {
        id: c.id,
        name: c.name,
        rarity: c.rarity || 'rare',
        cardSlot: c.cardSlot || slotArr[0] || '',
        cardSlotTypes: slotArr,
        attributes: c.attributes || [],
        specials: allEffects,
        album: albumText,
        icon: c.icon || null,
        monsters: c.monsters || [],
        maps: (Array.isArray(c.maps) ? c.maps : []).map(mp => {
          const baseMap = String((mp && mp.map) || '').replace(/\s*\(Lv\..*?\)/i, '').replace(/\s*Lv\.\s*\d+(?:-\d+)?/i, '').trim();
          const mapLevel = (mp && mp.mapLevel) || MAP_LEVEL_LABELS[baseMap] || (Number(mp && mp.monsterLevel) > 0 ? `Lv.${mp.monsterLevel}` : '');
          return Object.assign({}, mp, { mapLevel });
        }),
        price: priceObj,
        market: priceObj
      };
    });

    const profiles = loadProfiles() || [];
    const allAutoSellStore = loadAllAutoSellStore();
    let autoSellStoreDirty = false;
    let overridesDirty = false;

    const clients = await Promise.all(profiles.map(async (p) => {
      let storedOv = overridesStore[p.id] || {};
      let live = null;
      if (p.debugPort && typeof queryProfileState === 'function') {
        try { live = await queryProfileState(p); } catch (_) {}
      }
      const online = Boolean(live && live.online);
      const currentMap = (live && (live.map || live.currentMap)) || '';
      const liveTargetMap = String((live && live.targetMap) || '').replace(/\s*\(Lv\..*?\)/i, '').trim();
      const baseLv = (live && (live.baseLv || live.level)) || p.baseLv || p.level || 0;

      // One-time card map switch: if the character's targetMap has changed to another non-town map (e.g. Party or manual change),
      // automatically clear the stored card map assignment so it never sticks!
      const prevAssignedMap = storedOv.mapName || p.overrideFarmMap || '';
      if (online && prevAssignedMap && liveTargetMap && !isTownMapName(liveTargetMap)) {
        if (normMapName(liveTargetMap) !== normMapName(prevAssignedMap)) {
          delete overridesStore[p.id];
          delete p.overrideFarmMap;
          storedOv = {};
          overridesDirty = true;
        }
      }

      const overrideFarmMap = storedOv.mapName || p.overrideFarmMap || '';
      const targetMap = liveTargetMap || overrideFarmMap || '';

      // Determine all cards dropping on this character's active/assigned farm map(s)
      const activeFarmMaps = [overrideFarmMap, targetMap, currentMap].filter(Boolean);
      const autoSellCards = resolveCardsForFarmMap(rawCards, activeFarmMaps, storedOv.cardId, storedOv.cardName);

      if (autoSellCards.length > 0) {
        const storeRes = ensureCardsInProfileAutoSellStore(p.id, autoSellCards, allAutoSellStore);
        if (storeRes.changed) autoSellStoreDirty = true;
        if (online && p.debugPort) {
          const sig = `${p.debugPort}:${autoSellCards.join('|')}`;
          if (storeRes.changed || lastSyncedLiveAutoSell.get(p.id) !== sig) {
            lastSyncedLiveAutoSell.set(p.id, sig);
            evalProfilePort(p.debugPort, buildEnsureCardAutoSellSnippet(autoSellCards), 4500).catch(() => {});
          }
        }
      }

      return {
        id: p.id,
        name: p.name || p.id,
        charName: (live && live.charName) || p.lastCharName || p.characterName || '',
        charClass: (live && live.charClass) || p.charClass || '',
        level: baseLv,
        baseLv,
        jobLv: (live && live.jobLv) || p.jobLv || 0,
        online,
        isBotRunning: Boolean(live && (live.isBotRunning || live.botRunning)),
        currentMap,
        targetMap,
        overrideFarmMap,
        overrideCardId: Number(storedOv.cardId) || 0,
        cardName: storedOv.cardName || '',
        autoSellCards
      };
    }));

    if (overridesDirty) {
      saveOverridesStore(overridesStore);
      if (typeof saveProfiles === 'function') {
        try { saveProfiles(profiles); } catch (_) {}
      }
    }
    if (autoSellStoreDirty) {
      try {
        fs.mkdirSync(path.dirname(AUTOSELL_STORE_PATH), { recursive: true });
        fs.writeFileSync(AUTOSELL_STORE_PATH, JSON.stringify(allAutoSellStore, null, 2), 'utf8');
      } catch (_) {}
    }

    const pricedCount = cards.filter(c => c.price.displayPrice > 0 || c.price.updatedAt > 0).length;
    const listedCount = cards.filter(c => c.price.lowestPrice > 0).length;
    return {
      success: true,
      scanning,
      updatedAt: localCache.updatedAt || 0,
      lastListingSweepAt: localCache.lastListingSweepAt || 0,
      lastFullSweepAt: localCache.lastListingSweepAt || localCache.updatedAt || 0,
      totalCards: cards.length,
      pricedCount,
      listedCount,
      overrides: overridesStore,
      cards,
      clients
    };
  }

  async function applyBatchFarmMapAssignments(rawAssignments) {
    const list = Array.isArray(rawAssignments) ? rawAssignments : [];
    const profiles = loadProfiles() || [];
    const profileById = new Map(profiles.filter(Boolean).map(p => [String(p.id), p]));
    const gameData = await getGameItems().catch(() => ({ cards: [] }));
    const rawCards = Array.isArray(gameData && gameData.cards) ? gameData.cards : [];
    const allAutoSellStore = loadAllAutoSellStore();
    let autoSellStoreDirty = false;
    const allAddedAutoSellCards = new Set();

    const tasks = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const cleanMap = String(item.mapName || '').replace(/\s*\(Lv\..*?\)/i, '').trim();
      const isClear = !cleanMap;
      const cardId = Number(item.cardId) || 0;
      const cardName = String(item.cardName || '');
      const autoSellCards = isClear ? [] : resolveCardsForFarmMap(rawCards, cleanMap, cardId, cardName);
      autoSellCards.forEach(cn => allAddedAutoSellCards.add(cn));

      const ids = Array.isArray(item.profileIds) ? item.profileIds.map(String) : [];
      for (const pid of ids) {
        const p = profileById.get(pid);
        if (!p) continue;
        if (isClear) {
          delete overridesStore[p.id];
          delete p.overrideFarmMap;
        } else {
          overridesStore[p.id] = {
            mapName: cleanMap,
            cardId,
            cardName,
            updatedAt: Date.now()
          };
          p.overrideFarmMap = cleanMap;
          if (autoSellCards.length > 0) {
            const storeRes = ensureCardsInProfileAutoSellStore(p.id, autoSellCards, allAutoSellStore);
            if (storeRes.changed) autoSellStoreDirty = true;
          }
        }
        updateBrowserStorageOverride(p.id, cleanMap);
        tasks.push({ profile: p, cleanMap, autoSellCards });
      }
    }

    if (tasks.length === 0) {
      return { success: false, error: 'กรุณาเลือกจออย่างน้อย 1 จอ' };
    }

    if (autoSellStoreDirty) {
      try {
        fs.mkdirSync(path.dirname(AUTOSELL_STORE_PATH), { recursive: true });
        fs.writeFileSync(AUTOSELL_STORE_PATH, JSON.stringify(allAutoSellStore, null, 2), 'utf8');
      } catch (_) {}
    }

    saveOverridesStore(overridesStore);
    if (typeof saveProfiles === 'function') {
      try { saveProfiles(profiles); } catch (_) {}
    }

    let appliedOnline = 0;
    let savedOffline = 0;
    await Promise.all(tasks.map(async ({ profile, cleanMap, autoSellCards }) => {
      if (!profile.debugPort) {
        savedOffline++;
        return;
      }
      try {
        const code = buildSetOverrideMapCode(cleanMap, autoSellCards);
        const r = await evalProfilePort(profile.debugPort, code, 5000);
        if (r && r.result && r.result.success) {
          appliedOnline++;
          if (autoSellCards && autoSellCards.length > 0) {
            lastSyncedLiveAutoSell.set(profile.id, `${profile.debugPort}:${autoSellCards.join('|')}`);
          }
        } else {
          savedOffline++;
        }
      } catch (_) {
        savedOffline++;
      }
    }));

    return {
      success: true,
      totalSelected: tasks.length,
      appliedOnline,
      savedOffline,
      autoSellCards: Array.from(allAddedAutoSellCards),
      state: await buildFullState(false)
    };
  }

  async function applyFarmMapToProfiles({ mapName, profileIds, cardId, cardName }) {
    return applyBatchFarmMapAssignments([{ mapName, profileIds, cardId, cardName }]);
  }

  async function handleRoute(req, res, pathname, sendJSON) {
    if (!pathname.startsWith('/api/cards')) return false;

    if (pathname === '/api/cards' && req.method === 'GET') {
      const state = await buildFullState(true);
      // Trigger non-blocking background scan if data is stale and an online client exists
      const now = Date.now();
      if (!scanning && (state.pricedCount === 0 || now - (state.updatedAt || 0) > 15 * 60 * 1000)) {
        runScanCycle({ force: false }).catch(() => {});
      }
      sendJSON(state);
      return true;
    }

    if (pathname === '/api/cards/refresh' && req.method === 'POST') {
      const body = (await readBody(req)) || {};
      if (body.itemId) {
        const r = await runScanCycle({ itemId: Number(body.itemId) });
        const state = await buildFullState(false);
        sendJSON(Object.assign({}, state, { refreshResult: r }));
        return true;
      }
      const now = Date.now();
      if (now - lastManualRefreshAt < 15000 && !body.ignoreCooldown) {
        const waitSec = Math.ceil((15000 - (now - lastManualRefreshAt)) / 1000);
        const state = await buildFullState(false);
        sendJSON(Object.assign({}, state, {
          refreshResult: { success: false, error: `กรุณารอ ${waitSec} วินาทีก่อนกดสแกนใหม่` }
        }));
        return true;
      }
      lastManualRefreshAt = now;
      const r = await runScanCycle({ force: true });
      const state = await buildFullState(false);
      sendJSON(Object.assign({}, state, {
        refreshResult: r,
        result: { ok: Boolean(r && r.success), cardsFound: state.listedCount || state.pricedCount || 0, reason: r && r.error }
      }));
      return true;
    }

    if (pathname === '/api/cards/farm-map' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body) {
        sendJSON({ success: false, error: 'Invalid JSON' }, 400);
        return true;
      }
      const result = Array.isArray(body.assignments)
        ? await applyBatchFarmMapAssignments(body.assignments)
        : await applyFarmMapToProfiles({
            mapName: body.mapName || '',
            profileIds: body.profileIds || [],
            cardId: body.cardId,
            cardName: body.cardName
          });
      sendJSON(result, result.success ? 200 : 400);
      return true;
    }

    return false;
  }

  function start() {
    if (timer) return;
    // Immediately sync Card Auto-Sell rules (minQty: 1, enabled: true) for all profiles farming card maps
    setTimeout(() => {
      buildFullState(false).catch(() => {});
    }, 1500);
    timer = setInterval(() => {
      buildFullState(false).catch(() => {});
      if (!scanning) {
        runScanCycle({ force: false }).catch(() => {});
      }
    }, 60 * 1000);
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    handleRoute,
    start,
    stop,
    buildFullState,
    runScanCycle
  };
}

module.exports = { createCardMarketService };
