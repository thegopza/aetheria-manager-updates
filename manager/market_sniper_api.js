// manager/market_sniper_api.js — Centralized Market Misprice Sniper & Auto-Flip Engine
//
// Features:
//   1. Rotating Multi-Screen Scanner: Uses online idle game screens in round-robin to scan
//      `sort: 'newest'` (newly listed items) and `sort: 'price_asc'` across target categories
//      (`stone`, `refine`, `card`, `craft`, `material`, `usable`, etc.).
//   2. Clean Reference Price & Anti-Bait Valuation:
//      - Queries 24h & 7d `market_history` and caches clean reference prices.
//      - Two-stage outlier rejection: strips both mistyped low sales (< 45% of upper quartile,
//        e.g. missing a zero 1.4M vs 14M) and wash-trade spikes (> Q3 + 1.5*IQR).
//      - Enforces minimum sales volume (`minSalesVolume`) so illiquid/manipulated items are ignored.
//   3. Richest Buyer Selection & Zero Self-Competition:
//      - Locks each `listingId` centrally on Manager so multiple screens never bid against each other.
//      - Picks the richest eligible online screen (preferring Premium `ui:token` for 4% tax & 20 slots).
//   4. 5-Minute Auction Bidding, Instant Outbid Refund Recovery & Auto-Rebid:
//      - Places initial bid (`op: 'bid'`) or instant buy (`op: 'buy'`).
//      - Installs an in-client real-time listener for `market_outbid` and `market_won`:
//        * On `market_outbid`: immediately sends `collect_all` to recover refunded Zeny and
//          automatically re-bids up to `maxBidCapTotal` (strictly bounded by profit thresholds).
//        * On `market_won` / `buy`: immediately sends `collect_all` to claim the item into the bag
//          and relists it (`op: 'list'`) at the clean reference price (never the bait/mispriced price).

'use strict';

const fs = require('fs');
const path = require('path');
const { loadGlobalMarketSettings, buildMarketGlobalRuntimeSnippet } = require('./inventory_market_api');

const CONFIG_FILE = path.join(__dirname, 'data', 'market_sniper_config.json');
const STATE_FILE = path.join(__dirname, 'data', 'market_sniper_state.json');
const searchHistoryByProfile = new Map();
const MAX_SEARCHES_PER_HOUR_PER_PROFILE = 140;

const DEFAULT_CONFIG = {
  enabled: false,
  mode: 'auto_flip', // 'auto_flip' | 'buy_only' | 'dry_run'
  scanIntervalSec: 4,
  categories: {
    stone: true,      // ศิลา (AwakeningStone / WeaponStone)
    refine: true,     // แร่/ตีบวก (Oridecon, Elunium, Enriched, Enchant Rune)
    card: true,       // การ์ด
    craft: true,      // วัสดุคราฟต์
    material: true,   // วัตถุดิบ
    usable: true,     // ของใช้ / กล่องสุ่ม / ยาบัฟ
    accessory: false, // ประดับ / เจม
    weapon: false,    // อาวุธ (ปิดเป็นค่าเริ่มต้นเพื่อกันช้อนออปขยะ)
    armor: false      // ชุดเกราะ (ปิดเป็นค่าเริ่มต้นเพื่อกันช้อนออปขยะ)
  },
  maxBuyRatioPercent: 60,     // ซื้อทันทีเมื่อราคาต่อชิ้น <= 60% ของราคาขายจริง
  maxBidRatioPercent: 65,     // ประมูลสู้สูงสุดไม่เกิน 65% ของราคาขายจริง
  minNetProfitZeny: 200000,   // กำไรสุทธิขั้นต่ำหลังหักภาษีตลาด (z)
  minNetProfitPercent: 25,    // กำไรสุทธิขั้นต่ำหลังหักภาษีตลาด (%)
  minSalesVolume: 3,          // จำนวนครั้งที่ขายออกขั้นต่ำใน 7 วัน (ป้องกันของปั่นราคา)
  maxSpendPerListing: 35000000, // งบสูงสุดต่อ 1 รายการ (z)
  minReserveZeny: 1000000,    // เงินสำรองขั้นต่ำที่ต้องเหลือติดตัวจอที่ซื้อ (z)
  relistDurationHours: 24,    // ระยะเวลาตั้งขายกลับ (12, 24, 48 ชม.)
  relistUndercutZeny: 0,      // 0 = ตั้งเท่ากับราคามาตรฐานตลาด / 1 = ตั้งตัดหน้า 1 z
  customWatchlist: '',        // ชื่อไอเทมที่ต้องการเฝ้าเป็นพิเศษ (คั่นด้วย ,)
  blacklistItems: 'Arrow, Silver Arrow, Fire Arrow, Crystal Arrow, Iron Arrow, Red Potion, Orange Potion, Yellow Potion, White Potion, Blue Potion, Green Potion, Fly Wing, Butterfly Wing',
  allowedBuyerProfileIds: []  // ว่าง = เลือกจากทุกจอที่ออนไลน์อัตโนมัติ
};

const PRICE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 นาที

function sanitizeConfig(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  const cats = (r.categories && typeof r.categories === 'object') ? r.categories : {};
  const mode = ['auto_flip', 'buy_only', 'dry_run'].includes(r.mode) ? r.mode : DEFAULT_CONFIG.mode;
  const relistHours = [12, 24, 48].includes(Number(r.relistDurationHours)) ? Number(r.relistDurationHours) : 24;
  return {
    enabled: Boolean(r.enabled),
    mode,
    scanIntervalSec: Math.max(2, Math.min(60, parseInt(r.scanIntervalSec, 10) || DEFAULT_CONFIG.scanIntervalSec)),
    categories: {
      stone: cats.stone !== undefined ? Boolean(cats.stone) : DEFAULT_CONFIG.categories.stone,
      refine: cats.refine !== undefined ? Boolean(cats.refine) : DEFAULT_CONFIG.categories.refine,
      card: cats.card !== undefined ? Boolean(cats.card) : DEFAULT_CONFIG.categories.card,
      craft: cats.craft !== undefined ? Boolean(cats.craft) : DEFAULT_CONFIG.categories.craft,
      material: cats.material !== undefined ? Boolean(cats.material) : DEFAULT_CONFIG.categories.material,
      usable: cats.usable !== undefined ? Boolean(cats.usable) : DEFAULT_CONFIG.categories.usable,
      accessory: cats.accessory !== undefined ? Boolean(cats.accessory) : DEFAULT_CONFIG.categories.accessory,
      weapon: cats.weapon !== undefined ? Boolean(cats.weapon) : DEFAULT_CONFIG.categories.weapon,
      armor: cats.armor !== undefined ? Boolean(cats.armor) : DEFAULT_CONFIG.categories.armor
    },
    maxBuyRatioPercent: Math.max(5, Math.min(90, parseInt(r.maxBuyRatioPercent, 10) || DEFAULT_CONFIG.maxBuyRatioPercent)),
    maxBidRatioPercent: Math.max(5, Math.min(90, parseInt(r.maxBidRatioPercent, 10) || DEFAULT_CONFIG.maxBidRatioPercent)),
    minNetProfitZeny: Math.max(1000, Math.min(1000000000, parseInt(r.minNetProfitZeny, 10) || DEFAULT_CONFIG.minNetProfitZeny)),
    minNetProfitPercent: Math.max(5, Math.min(500, parseInt(r.minNetProfitPercent, 10) || DEFAULT_CONFIG.minNetProfitPercent)),
    minSalesVolume: Math.max(1, Math.min(100, parseInt(r.minSalesVolume, 10) || DEFAULT_CONFIG.minSalesVolume)),
    maxSpendPerListing: Math.max(10000, Math.min(2000000000, parseInt(r.maxSpendPerListing, 10) || DEFAULT_CONFIG.maxSpendPerListing)),
    minReserveZeny: Math.max(0, Math.min(2000000000, parseInt(r.minReserveZeny, 10) !== undefined && !Number.isNaN(parseInt(r.minReserveZeny, 10)) ? parseInt(r.minReserveZeny, 10) : DEFAULT_CONFIG.minReserveZeny)),
    relistDurationHours: relistHours,
    relistUndercutZeny: Math.max(0, Math.min(1000000, parseInt(r.relistUndercutZeny, 10) !== undefined && !Number.isNaN(parseInt(r.relistUndercutZeny, 10)) ? parseInt(r.relistUndercutZeny, 10) : DEFAULT_CONFIG.relistUndercutZeny)),
    customWatchlist: typeof r.customWatchlist === 'string' ? r.customWatchlist.trim() : DEFAULT_CONFIG.customWatchlist,
    blacklistItems: typeof r.blacklistItems === 'string' ? r.blacklistItems.trim() : DEFAULT_CONFIG.blacklistItems,
    allowedBuyerProfileIds: Array.isArray(r.allowedBuyerProfileIds) ? r.allowedBuyerProfileIds.map(String).filter(Boolean) : []
  };
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return sanitizeConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
    }
  } catch (_) {}
  return sanitizeConfig(DEFAULT_CONFIG);
}

function saveConfig(cfg) {
  const clean = sanitizeConfig(cfg);
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(clean, null, 2), 'utf8');
  } catch (_) {}
  return clean;
}

function loadPersistedState() {
  for (const candidate of [STATE_FILE, `${STATE_FILE}.bak`, `${STATE_FILE}.tmp`]) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).size > 2) {
        const d = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (d && typeof d === 'object') {
          return {
            priceCache: (d.priceCache && typeof d.priceCache === 'object') ? d.priceCache : {},
            activeBids: Array.isArray(d.activeBids) ? d.activeBids : [],
            pendingFlips: Array.isArray(d.pendingFlips) ? d.pendingFlips : [],
            history: Array.isArray(d.history) ? d.history.slice(0, 200) : [],
            stats: Object.assign({
              totalScans: 0,
              totalOpportunitiesFound: 0,
              totalBidsPlaced: 0,
              totalWonOrBought: 0,
              totalRelisted: 0,
              totalEstimatedNetProfit: 0,
              totalRefundedCount: 0
            }, d.stats || {})
          };
        }
      }
    } catch (_) {}
  }
  return {
    priceCache: {},
    activeBids: [],
    pendingFlips: [],
    history: [],
    stats: {
      totalScans: 0,
      totalOpportunitiesFound: 0,
      totalBidsPlaced: 0,
      totalWonOrBought: 0,
      totalRelisted: 0,
      totalEstimatedNetProfit: 0,
      totalRefundedCount: 0
    }
  };
}

function savePersistedState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const raw = JSON.stringify({
      priceCache: state.priceCache || {},
      activeBids: (state.activeBids || []).slice(0, 100),
      pendingFlips: (state.pendingFlips || []).slice(0, 50),
      history: (state.history || []).slice(0, 200),
      stats: state.stats || {}
    }, null, 2);
    if (!raw || raw.length < 10) return;
    const tmpFile = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmpFile, raw, 'utf8');
    try {
      fs.renameSync(tmpFile, STATE_FILE);
    } catch (_) {
      fs.writeFileSync(STATE_FILE, raw, 'utf8');
    }
    try {
      fs.writeFileSync(`${STATE_FILE}.bak`, raw, 'utf8');
    } catch (_) {}
  } catch (_) {}
}

function inferItemCategory(item) {
  if (!item) return 'other';
  const t = String(item.type || '');
  const eq = String(item.equipType || '');
  const nm = String(item.name || '');
  if (t === 'Card' || /\bCard$/i.test(nm)) return 'card';
  if (t === 'AwakeningStone' || t === 'WeaponStone' || item.stone || /\bStone\s*\(/i.test(nm)) return 'stone';
  if (t === 'Enchantment' || /Oridecon|Elunium|Enchant Rune|Socket Charm/i.test(nm)) return 'refine';
  if (t === 'Craft') return 'craft';
  if (t === 'Miscellaneous') return 'material';
  if (t === 'Consumable') return 'usable';
  if (t === 'Equipment') {
    if (eq === 'Weapon' || eq === 'Ammo') return 'weapon';
    if (eq === 'Acc' || eq === 'Accessory' || eq === 'Gem' || eq === 'LevelGem') return 'accessory';
    return 'armor';
  }
  return 'other';
}

// Cards, Stones, and Equipment must ALWAYS be listed as qty: 1 per slot (never stacked, because stacks are hard to sell)
function isSingleUnitFlipItem(itemOrName) {
  if (!itemOrName) return false;
  if (typeof itemOrName === 'string') {
    return /\bcard\b|\bstone\s*\(|การ์ด|ศิลา/i.test(itemOrName);
  }
  const cat = inferItemCategory(itemOrName);
  if (cat === 'card' || cat === 'stone' || cat === 'weapon' || cat === 'armor' || cat === 'accessory') return true;
  return /\bcard\b|\bstone\s*\(|การ์ด|ศิลา/i.test(String(itemOrName.name || itemOrName.itemName || ''));
}

const ALLOWED_MISC_FLIP_NAMES = new Set([
  'boss card fragment',
  'rebirth feather'
]);

const KNOWN_NPC_TRASH_NAMES = new Set([
  'clover',
  'grasshopper leg',
  'ice heart',
  'cursed sigil',
  'censer ash',
  'sentinel wingstone',
  'rotroot heartwood',
  'bog hydra fang',
  'plague moth wing',
  'magma core',
  'ember scale',
  'sticky mucus',
  'feeler',
  'cricket fiddle',
  'tarnished plate',
  'soul flame',
  'torn vestment',
  'stone talon',
  'rotten twig',
  'bog scale',
  'venom gland',
  'moth dust',
  'tidestone'
]);

// Hard block on NPC monster trash drops (type === 'Miscellaneous' without description/rarity, or monster drop ID ranges).
// Scammers and RMT Zeny sellers use monster trash drops (like Bog Hydra Fang, Magma Core, Sticky Mucus) to wash-trade
// and set 5-minute auction bait traps. Real functional Miscellaneous items (Boss Card Fragment, Rebirth Feather) have description & rarity.
function isNpcVendorTrashItem(itemOrObj) {
  if (!itemOrObj) return false;
  const id = Number(itemOrObj.itemId ?? itemOrObj.id) || 0;
  const nm = String(itemOrObj.name || itemOrObj.itemName || '').trim().toLowerCase();
  if (nm && ALLOWED_MISC_FLIP_NAMES.has(nm)) return false;
  if (nm && KNOWN_NPC_TRASH_NAMES.has(nm)) return true;
  if ((id >= 90100 && id <= 90199) || (id >= 90400 && id <= 90799) || (id >= 92000 && id <= 92999)) {
    return true;
  }
  const t = String(itemOrObj.type || '');
  if (t === 'Miscellaneous') {
    const hasDesc = Boolean(itemOrObj.description && String(itemOrObj.description).trim().length > 0);
    const hasRarity = Boolean(itemOrObj.rarity && String(itemOrObj.rarity).trim().length > 0);
    if (!hasDesc && !hasRarity) return true;
  }
  return false;
}

// Compute retail-friendly split batch size for flipped items so buyers don't have to pay for a 999-stack all at once.
// - Cards, Stones, Equipment, or expensive items (>= 100,000 z/unit): qty 1 per listing, up to 2 concurrent listings
// - High-value consumables/fragments (20,000–99,999 z/unit, e.g. Swiftness Scroll, Fire Converter, Boss Card Fragment): qty 10, up to 3 concurrent
// - Mid-high runes/materials (8,000–19,999 z/unit, e.g. Enchant Rune, Gale Feather): qty 25, up to 3 concurrent
// - Mid-tier craft materials (1,800–7,999 z/unit, e.g. Glyph Leather, Tide Scale, Star Crumb): qty 50, up to 3 concurrent
// - Ores & refine stones (< 1,800 z/unit, e.g. Enriched Elunium, Enriched Oridecon, Oridecon, Elunium, Mythril Ore): qty 100, up to 3 concurrent
function getSmartFlipBatchConfig(itemName, unitPrice, isSingle = false) {
  const norm = String(itemName || '').trim().toLowerCase();
  const single = Boolean(isSingle || /\bcard\b|\bstone\s*\(|การ์ด|ศิลา/i.test(norm));
  const u = Math.max(1, Number(unitPrice) || 1);
  if (single || u >= 100000) {
    return { batchQty: 1, maxConcurrent: 2, isSingle: true };
  }
  if (u >= 20000) {
    return { batchQty: 10, maxConcurrent: 3, isSingle: false };
  }
  if (u >= 8000) {
    return { batchQty: 25, maxConcurrent: 3, isSingle: false };
  }
  if (u >= 1800) {
    return { batchQty: 50, maxConcurrent: 3, isSingle: false };
  }
  return { batchQty: 100, maxConcurrent: 3, isSingle: false };
}

const PRICE_CACHE_VER = 8;

// Find the Most-Stable Price Cluster from the last 10–20 individual trades (`recent` array).
// Strips out minority 5-minute auction snipe wins (< 72% of main Buy-Now trade body when >= 50% of trades are normal Buy-Now sales)
// so auction wins at 50–65% of market price never poison the item's true Buy-Now reference price!
function findMostStableClusterAvg(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { avg: 0, min: 0, max: 0, clusterCount: 0, totalCount: 0 };
  }
  const valid = samples.map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (valid.length === 0) {
    return { avg: 0, min: 0, max: 0, clusterCount: 0, totalCount: 0 };
  }
  if (valid.length === 1) {
    return { avg: Math.round(valid[0]), min: valid[0], max: valid[0], clusterCount: 1, totalCount: 1 };
  }

  const rawSorted = valid.slice().sort((a, b) => a - b);
  let sorted = rawSorted;

  // Strip minority 5-minute auction snipe wins when the majority (>= 50%) of trades are normal Buy-Now sales around p60
  if (rawSorted.length >= 5) {
    const p60 = rawSorted[Math.floor(rawSorted.length * 0.60)];
    if (p60 > 0) {
      const mainBodyCount = rawSorted.filter(v => v >= p60 * 0.78 && v <= p60 * 1.40).length;
      const auctionSnipeCount = rawSorted.filter(v => v < p60 * 0.72).length;
      if (mainBodyCount >= Math.ceil(rawSorted.length * 0.50) && auctionSnipeCount > 0 && auctionSnipeCount <= Math.floor(rawSorted.length * 0.40)) {
        const filtered = rawSorted.filter(v => v >= p60 * 0.72);
        if (filtered.length >= 4) {
          sorted = filtered;
        }
      }
    }
  }

  const pickBestCluster = (bandPct) => {
    let best = null;
    for (let i = 0; i < sorted.length; i++) {
      const center = sorted[i];
      const lo = center * (1 - bandPct);
      const hi = center * (1 + bandPct);
      const members = sorted.filter(v => v >= lo && v <= hi);
      const n = members.length;
      const mean = members.reduce((s, v) => s + v, 0) / n;
      const variance = members.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / n;
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 999;

      if (!best) {
        best = { members, count: n, mean, cv };
      } else if (n > best.count) {
        best = { members, count: n, mean, cv };
      } else if (n === best.count) {
        // Conservative tie-breaker: prefer lower price cluster on a tie so wash-trade clusters at higher fixed prices never win
        if (mean < best.mean * 0.97) {
          best = { members, count: n, mean, cv };
        } else if (Math.abs(mean - best.mean) <= best.mean * 0.03 && cv < best.cv) {
          best = { members, count: n, mean, cv };
        }
      }
    }
    return best;
  };

  let best = pickBestCluster(0.15);
  if (!best || (best.count < 2 && sorted.length >= 3)) {
    best = pickBestCluster(0.22);
  }

  let cluster = (best && best.members && best.members.length > 0) ? best.members.slice() : sorted;
  // If no cluster of >= 2 formed at all (every single trade was wildly different), use the lower-half median
  if (cluster.length === 1 && sorted.length >= 2) {
    const halfIdx = Math.max(0, Math.floor((sorted.length - 1) * 0.45));
    const med = sorted[halfIdx];
    return { avg: Math.round(med), min: sorted[0], max: sorted[sorted.length - 1], clusterCount: 1, totalCount: rawSorted.length };
  }

  const trimmed = cluster.length >= 5 ? cluster.slice(1, -1) : cluster;
  const avg = Math.round(trimmed.reduce((s, v) => s + v, 0) / trimmed.length);
  return {
    avg,
    min: cluster[0],
    max: cluster[cluster.length - 1],
    clusterCount: cluster.length,
    totalCount: rawSorted.length
  };
}

// Compute Clean Reference Price from the last 10–20 individual trades (`recent` array) using Most-Stable Cluster averaging
// + 7-day / 24h bucket baseline anti-pump guard + unique-seller active listings ceiling + strict anti-bait / anti-wash-trade / anti-RMT guards.
// Never uses `pt.high` from hourly buckets (`points[]`), which can be polluted by RMT Zeny transfers.
function computeCleanReferencePrice(history24h, history7d, activeListingsForSameItem, undercutZeny = 1, ourCharNamesSet = null, itemMeta = null) {
  if (itemMeta && isNpcVendorTrashItem(itemMeta)) {
    return { valid: false, reason: 'npc_trash_drop', totalSales: 0, sales24h: 0, sales7d: 0 };
  }

  const now = Date.now();
  const seenRecentKeys = new Set();
  const seenAllRecentKeys = new Set();
  const recentTrades = [];
  const allRecentTrades = [];
  const fallbackBucketPrices = [];
  const bucket24hPrices = [];
  const bucket7dPrices = [];
  let max24hBucketHigh = 0;
  let sales24h = 0;
  let sales7d = 0;

  const collectFromHistory = (hist, is24h) => {
    if (!hist || typeof hist !== 'object') return;
    const recent = Array.isArray(hist.recent) ? hist.recent : [];
    const points = Array.isArray(hist.points) ? hist.points : [];

    let countFromPoints = 0;
    for (const pt of points) {
      if (!pt) continue;
      const s = Number(pt.sales ?? pt.count ?? 0) || 0;
      const avg = Number(pt.avg) || 0;
      const low = Number(pt.low) || avg;
      const high = Number(pt.high) || avg;
      if (s > 0 && avg > 0) {
        countFromPoints += s;
        // NEVER use pt.high! If high > low * 2.2, an RMT/pump spike polluted pt.avg upward, so use pt.low; otherwise use pt.avg.
        const safeBucketUnit = Math.round((low > 0 && high > low * 2.2) ? low : avg);
        if (safeBucketUnit > 0) {
          if (is24h) {
            fallbackBucketPrices.push(safeBucketUnit);
            bucket24hPrices.push(safeBucketUnit);
            if (high > max24hBucketHigh) max24hBucketHigh = high;
          } else {
            bucket7dPrices.push(safeBucketUnit);
          }
        }
      }
    }

    const maxAgeMs = is24h ? (24 * 3600 * 1000) : (7 * 86400 * 1000);
    const max7dMs = 7 * 86400 * 1000;
    let countFromRecent = 0;
    for (const r of recent) {
      if (!r) continue;
      const qty = Math.max(1, Number(r.qty) || 1);
      const price = Number(r.price) || 0;
      const u = Math.round(price / qty);
      const at = Number(r.at) || 0;
      const withinRange = at > 0 ? ((now - at) >= -300000 && (now - at) <= maxAgeMs) : (countFromPoints > 0);
      const within7d = at > 0 ? ((now - at) >= -300000 && (now - at) <= max7dMs) : (countFromPoints > 0);
      if (u > 0) {
        if (withinRange) countFromRecent += 1;
        const rKey = `${at}:${price}:${qty}`;
        if (!seenAllRecentKeys.has(rKey)) {
          seenAllRecentKeys.add(rKey);
          allRecentTrades.push({ u, at, qty, price });
        }
        if (within7d && !seenRecentKeys.has(rKey)) {
          seenRecentKeys.add(rKey);
          recentTrades.push({ u, at, qty, price });
        }
      }
    }

    const total = Math.max(countFromPoints, countFromRecent);
    if (is24h) sales24h = total;
    else sales7d = total;
  };

  collectFromHistory(history24h, true);
  collectFromHistory(history7d, false);

  const totalSales = Math.max(sales7d, sales24h);
  const singleUnit = isSingleUnitFlipItem(itemMeta);

  // Sort newest trades first so slice(0, 20) is strictly the 10–20 most recent trades within the last 7 days
  recentTrades.sort((a, b) => (b.at || 0) - (a.at || 0));
  allRecentTrades.sort((a, b) => (b.at || 0) - (a.at || 0));
  const latest20UnitPrices = recentTrades.slice(0, 20).map(t => t.u);

  const primaryPool = latest20UnitPrices.length >= 2
    ? latest20UnitPrices
    : (latest20UnitPrices.length === 1 && fallbackBucketPrices.length > 0
      ? [latest20UnitPrices[0], ...fallbackBucketPrices.slice(-15)]
      : (latest20UnitPrices.length > 0 ? latest20UnitPrices : fallbackBucketPrices.slice(-15)));

  if (primaryPool.length === 0 || totalSales === 0) {
    return { valid: false, reason: 'no_history', totalSales: 0, sales24h: 0, sales7d: 0 };
  }

  // Strict Liquidity & Trade-Frequency Gate:
  // A scammer can easily wash-trade 1–5 times on a dead item (like Bog Hydra Fang: sales24h=1, sales7d=5).
  // Require real daily and weekly velocity before considering any item flippable.
  const minRequired24h = singleUnit ? 3 : 8;
  const minRequired7d = singleUnit ? 12 : 25;
  const minRequiredRecent7d = singleUnit ? 6 : 10;
  if (sales24h < minRequired24h) {
    return { valid: false, reason: 'low_24h_liquidity', totalSales, sales24h, sales7d };
  }
  if (totalSales < minRequired7d || recentTrades.length < minRequiredRecent7d) {
    return { valid: false, reason: 'low_7d_liquidity', totalSales, sales24h, sales7d };
  }

  const cluster20 = findMostStableClusterAvg(primaryPool);
  const minRequiredCluster = singleUnit ? 4 : 6;
  if (cluster20.clusterCount < minRequiredCluster) {
    return { valid: false, reason: 'unstable_sparse_cluster', totalSales, sales24h, sales7d };
  }

  let cleanRefUnitPrice = cluster20.avg;

  // 7-Day & 24-Hour Baseline Anti-Pump / Anti-Manipulation Protection:
  // Prevents buying into short-term pumps where a manipulator sweeps the book (e.g. Runic Silk pumped from 8k–12k to 36k–236k,
  // or Hydra Card pumped from 2M to 5M–6M) and then dumps stacks in 5-minute auctions!
  const sorted7dBuckets = bucket7dPrices.slice().sort((a, b) => a - b);
  const sorted24hBuckets = bucket24hPrices.slice().sort((a, b) => a - b);
  const bucket7dMedian = sorted7dBuckets.length >= 4
    ? sorted7dBuckets[Math.floor(sorted7dBuckets.length * 0.50)]
    : 0;
  const bucket7dLowP30 = sorted7dBuckets.length >= 6
    ? sorted7dBuckets[Math.floor(sorted7dBuckets.length * 0.30)]
    : 0;
  const bucket24hMedian = sorted24hBuckets.length >= 3
    ? sorted24hBuckets[Math.floor(sorted24hBuckets.length * 0.50)]
    : 0;
  const bucket24hLowP25 = sorted24hBuckets.length >= 3
    ? sorted24hBuckets[Math.floor(sorted24hBuckets.length * 0.25)]
    : 0;

  if (bucket7dMedian > 0 && sorted7dBuckets.length >= 6) {
    // If the recent 20 trades are pumped > 45% above the 7-day median bucket price, reject as a short-term pump!
    if (cleanRefUnitPrice > Math.round(bucket7dMedian * 1.45)) {
      return { valid: false, reason: 'short_term_pump_spike', totalSales, sales24h, sales7d, bucket7dMedian, pumpedRef: cleanRefUnitPrice };
    }
    // Cap reference price at <= 1.15x of 7-day median (or 1.0x of 7-day median if the 7-day history itself has wide volatility)
    const maxAllowedBy7d = (bucket7dLowP30 > 0 && bucket7dMedian > bucket7dLowP30 * 1.35)
      ? bucket7dMedian
      : Math.round(bucket7dMedian * 1.15);
    if (maxAllowedBy7d > 0 && cleanRefUnitPrice > maxAllowedBy7d) {
      cleanRefUnitPrice = maxAllowedBy7d;
    }
  }

  if (bucket24hLowP25 > 0 && sorted24hBuckets.length >= 3) {
    // If recent trades jumped > 55% above today's 25th-percentile hourly bucket (e.g. Runic Silk was 8,000 z earlier today), reject!
    if (cleanRefUnitPrice > Math.round(bucket24hLowP25 * 1.55)) {
      return { valid: false, reason: 'intraday_pump_spike', totalSales, sales24h, sales7d, bucket24hLowP25, pumpedRef: cleanRefUnitPrice };
    }
    // If an extreme pump/RMT spike (> 3.5x 24h median) occurred in the last 24h, anchor conservatively to pre-pump baseline
    if (bucket24hMedian > 0 && max24hBucketHigh > bucket24hMedian * 3.5) {
      const prePumpAnchor = Math.max(bucket24hLowP25, bucket7dLowP30 || bucket24hLowP25);
      if (prePumpAnchor > 0 && cleanRefUnitPrice > prePumpAnchor) {
        cleanRefUnitPrice = prePumpAnchor;
      }
    }
  }

  // RMT / Wash-Trade History Contamination Detector:
  // If an item has multiple extreme RMT Zeny transfer spikes (> 5x cluster average) in its recent 20 trades
  // and does not have massive organic daily volume, reject it as an RMT / wash-trade vehicle.
  if (allRecentTrades.length >= 5 && cleanRefUnitPrice > 0) {
    const rmtSpikeCount = allRecentTrades.filter(t => t.u > cleanRefUnitPrice * 5).length;
    if (rmtSpikeCount >= 3 && sales24h < 40) {
      return { valid: false, reason: 'rmt_contaminated_history', totalSales, sales24h, sales7d };
    }
  }

  // Check the latest 10 trades specifically: ONLY lower cleanRefUnitPrice if a true majority of the newest 10 trades
  // dropped AND buyers are no longer paying near the normal Buy-Now price (prevents 3-4 5-minute auction snipes from looking like a crash!)
  if (latest20UnitPrices.length >= 6) {
    const latest10 = latest20UnitPrices.slice(0, 10);
    const stillHighIn10 = latest10.filter(u => u >= cleanRefUnitPrice * 0.88).length;
    if (stillHighIn10 < Math.ceil(latest10.length * 0.40)) {
      const cluster10 = findMostStableClusterAvg(latest10);
      if (cluster10.clusterCount >= Math.max(4, Math.ceil(latest10.length * 0.50)) && cluster10.avg > 0 && cluster10.avg < cleanRefUnitPrice) {
        cleanRefUnitPrice = cluster10.avg;
      }
    }
  }

  // Latest-5 Crash Guard: if at least 4 of the newest 5 trades sold below 85% of cleanRefUnitPrice
  // (with zero normal Buy-Now trades in the newest 5), cap immediately!
  if (latest20UnitPrices.length >= 5) {
    const latest5 = latest20UnitPrices.slice(0, 5);
    const lowerRecent = latest5.filter(u => u > 0 && u < cleanRefUnitPrice * 0.85);
    const normalRecent = latest5.filter(u => u >= cleanRefUnitPrice * 0.90);
    if (lowerRecent.length >= 4 && normalRecent.length === 0) {
      const recentLowAvg = Math.round(lowerRecent.reduce((s, v) => s + v, 0) / lowerRecent.length);
      if (recentLowAvg > 0 && recentLowAvg < cleanRefUnitPrice) {
        cleanRefUnitPrice = recentLowAvg;
      }
    }
  }

  if (!cleanRefUnitPrice || cleanRefUnitPrice <= 0) {
    return { valid: false, reason: 'invalid_cluster', totalSales, sales24h, sales7d };
  }

  // Stage 2: Competing Active Listings Ceiling & Flip Price (excluding all of our own characters, deduplicated by seller!)
  const isOurListing = (l) => {
    if (!l) return true;
    if (l.mine) return true;
    if (ourCharNamesSet && l.sellerName) {
      const sNorm = String(l.sellerName).trim().toLowerCase();
      if (sNorm && ourCharNamesSet.has(sNorm)) return true;
    }
    return false;
  };

  const allActiveUnitPrices = [];
  const buyNowBySeller = new Map();
  const normalActivePrices = [];
  if (Array.isArray(activeListingsForSameItem)) {
    for (const l of activeListingsForSameItem) {
      if (!l || isOurListing(l)) continue;
      const q = Math.max(1, Number(l.qty) || 1);
      const u = Math.round((Number(l.minBid || l.price) || 0) / q);
      if (u > 0) {
        allActiveUnitPrices.push(u);
      }
      const inAuc = Boolean(l.auctionEndsAt && Number(l.auctionEndsAt) > now);
      if (!inAuc) {
        const buyNowU = Math.round((Number(l.price) || 0) / q);
        if (buyNowU > 0) {
          const sellerKey = String(l.sellerName || `anon_${l.listingId}`).trim().toLowerCase();
          const prev = buyNowBySeller.get(sellerKey);
          if (prev === undefined || buyNowU < prev) {
            buyNowBySeller.set(sellerKey, buyNowU);
          }
        }
      }
    }
  }
  allActiveUnitPrices.sort((a, b) => a - b);
  const uniqueSellerBuyNowPrices = Array.from(buyNowBySeller.values()).sort((a, b) => a - b);

  // Active market price is < 25% of historical price with zero listings near the historical price -> RMT transfer history!
  if (allActiveUnitPrices.length >= 1 && allActiveUnitPrices[0] < cleanRefUnitPrice * 0.25 && allActiveUnitPrices.filter(p => p >= cleanRefUnitPrice * 0.50).length === 0) {
    return { valid: false, reason: 'rmt_history_mismatch', totalSales, sales24h, sales7d };
  }

  // Cap cleanRefUnitPrice by unique sellers' Buy-Now prices (NEVER by 5-minute auction starting bids in allActiveUnitPrices!)
  // so 1 seller posting 3 stacks (e.g. panda1031 x3) only counts as 1 seller, and we never value an item above existing Buy-Now supply.
  if (uniqueSellerBuyNowPrices.length >= 2) {
    const secondUniqueSeller = uniqueSellerBuyNowPrices[1];
    if (secondUniqueSeller > 0 && secondUniqueSeller < cleanRefUnitPrice) {
      cleanRefUnitPrice = secondUniqueSeller;
    }
  } else if (uniqueSellerBuyNowPrices.length === 1) {
    const onlyUniqueSeller = uniqueSellerBuyNowPrices[0];
    // Only let a single seller cap cleanRefUnitPrice down to 85% of the trade cluster (prevents 1 cheap Buy-Now outlier from collapsing ref)
    if (onlyUniqueSeller > 0 && onlyUniqueSeller < cleanRefUnitPrice) {
      cleanRefUnitPrice = Math.max(Math.round(cleanRefUnitPrice * 0.85), onlyUniqueSeller);
    }
  }

  for (const u of uniqueSellerBuyNowPrices) {
    if (u >= Math.round(cleanRefUnitPrice * 0.78) && u <= cleanRefUnitPrice) {
      normalActivePrices.push(u);
    }
  }
  normalActivePrices.sort((a, b) => a - b);

  let flipUnitPrice = cleanRefUnitPrice;
  if (normalActivePrices.length > 0) {
    const cheapestNormal = normalActivePrices[0];
    flipUnitPrice = Math.min(
      cleanRefUnitPrice,
      Math.max(
        Math.round(cleanRefUnitPrice * 0.82),
        cheapestNormal - Math.max(0, Number(undercutZeny) || 0)
      )
    );
  } else if (Number(undercutZeny) > 0) {
    flipUnitPrice = Math.max(1, cleanRefUnitPrice - Math.max(0, Number(undercutZeny) || 0));
  }

  return {
    valid: true,
    cleanRefUnitPrice,
    flipUnitPrice,
    totalSales,
    sales24h,
    sales7d,
    bucket7dMedian,
    recentCount: latest20UnitPrices.length,
    clusterCount: cluster20.clusterCount,
    uniqueBuyNowSellersCount: uniqueSellerBuyNowPrices.length,
    minCleanSold: cluster20.min,
    maxCleanSold: cluster20.max
  };
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

function createMarketSniperService({
  loadProfiles,
  evalProfilePort,
  isBusy
}) {
  let config = loadConfig();
  const state = loadPersistedState();

  // Baseline Most-Stable Cluster reference prices for items before live cacheVer === 8 refresh completes
  const VERIFIED_STABLE_REF_BY_NAME = {
    'enchant rune': 15415,
    'armor blueprint': 504167,
    'gale feather': 16000,
    'profound gem shard': 4875000,
    'snowman card': 777220,
    'tidemark seal card': 249997,
    'magma titan card': 277770,
    'hydra card': 1554848,
    'controlled destruction stone (common)': 27000000,
    'treant card': 2205926,
    'wild boar card': 2400000,
    'runic silk': 12778
  };

  function getTrueRefUnitPrice(itemId, refine, itemName, fallbackRef = 0) {
    const k = `${Number(itemId) || 0}:${Number(refine) || 0}`;
    const c = state.priceCache && state.priceCache[k];
    if (c && c.cacheVer === PRICE_CACHE_VER && c.valid && Number(c.cleanRefUnitPrice) > 0) {
      return Number(c.cleanRefUnitPrice);
    }
    const nm = String(itemName || '').trim().toLowerCase();
    if (nm && VERIFIED_STABLE_REF_BY_NAME[nm]) {
      return VERIFIED_STABLE_REF_BY_NAME[nm];
    }
    if (c && c.valid && Number(c.cleanRefUnitPrice) > 0) {
      return Number(c.cleanRefUnitPrice);
    }
    return Number(fallbackRef) || 0;
  }

  function extractOriginalListedUnitFromNote(note, qty = 1) {
    const s = String(note || '');
    if (!s) return 0;
    const perUnitMatch = s.match(/@\s*([\d,]+)\s*z\/ชิ้น/);
    if (perUnitMatch && perUnitMatch[1]) {
      const u = Number(perUnitMatch[1].replace(/,/g, '')) || 0;
      if (u > 0) return u;
    }
    const totalMatch = s.match(/ตั้งขายกลับ\s+([\d,]+)\s*z/);
    if (totalMatch && totalMatch[1]) {
      const tot = Number(totalMatch[1].replace(/,/g, '')) || 0;
      if (tot > 0) return Math.max(1, Math.round(tot / Math.max(1, Number(qty) || 1)));
    }
    return 0;
  }

  function sanitizeHistoricalState() {
    let changed = false;
    const nowTs = Date.now();
    if (state.priceCache && typeof state.priceCache === 'object') {
      for (const [k, entry] of Object.entries(state.priceCache)) {
        if (!entry || entry.cacheVer !== PRICE_CACHE_VER || isNpcVendorTrashItem(entry)) {
          delete state.priceCache[k];
          changed = true;
        }
      }
    }

    if (Array.isArray(state.activeBids)) {
      const beforeLen = state.activeBids.length;
      state.activeBids = state.activeBids.filter(b => b && !isNpcVendorTrashItem(b));
      if (state.activeBids.length !== beforeLen) changed = true;
    }
    if (Array.isArray(state.pendingFlips)) {
      const beforeLen = state.pendingFlips.length;
      state.pendingFlips = state.pendingFlips.filter(pf => pf && !isNpcVendorTrashItem(pf));
      if (state.pendingFlips.length !== beforeLen) changed = true;
    }
    if (Array.isArray(state.history)) {
      const beforeLen = state.history.length;
      state.history = state.history.filter(h => h && !isNpcVendorTrashItem(h));
      if (state.history.length !== beforeLen) changed = true;
      for (const h of state.history) {
        if (!h) continue;
        if ((h.action === 'bid' || h.action === 'rebid') && h.at && (nowTs - Number(h.at) > 10 * 60 * 1000)) {
          const activeMatch = (state.activeBids || []).find(b => b && Number(b.listingId) === Number(h.listingId));
          if (!activeMatch || activeMatch.status === 'outbid_stopped') {
            h.action = 'outbid_refund';
            h.note = 'หมดเวลาประมูล 5 นาที -> โดนปาดเกินเพดาน & รับเงินคืนเรียบร้อย';
            changed = true;
          }
        }
      }
    }

    const fixRecordValuation = (rec, isHistory) => {
      if (!rec || !rec.itemName) return;
      const trueRef = getTrueRefUnitPrice(rec.itemId, rec.refine || 0, rec.itemName, rec.cleanRefUnitPrice);
      if (trueRef <= 0) return;
      const qty = Math.max(1, Number(rec.qty) || 1);
      const buyTotal = Number(isHistory ? rec.buyPriceTotal : rec.currentBid) || 0;
      const buyUnit = Math.round(buyTotal / qty);
      const minBreakEvenUnit = buyUnit > 0 ? Math.ceil(buyUnit / 0.96) : 0;
      const oldRef = Number(rec.cleanRefUnitPrice) || 0;

      if (isHistory) {
        const origFromNote = extractOriginalListedUnitFromNote(rec.note, qty);
        if (origFromNote > 0 && rec.initialListedUnitPrice !== origFromNote) {
          rec.initialListedUnitPrice = origFromNote;
          changed = true;
        }
        // Restore history records whose relistUnitPrice was mistakenly overwritten below cost or on old already-sold lots
        const curRelistU = Number(rec.relistUnitPrice) || 0;
        const restoreTarget = origFromNote > 0 ? origFromNote : Math.max(curRelistU, minBreakEvenUnit, trueRef);
        const isOldLot = rec.at && (nowTs - Number(rec.at) > 12 * 3600 * 1000);
        if (restoreTarget > 0 && ((minBreakEvenUnit > 0 && curRelistU > 0 && curRelistU < minBreakEvenUnit && restoreTarget >= minBreakEvenUnit) || (isOldLot && origFromNote > 0 && curRelistU !== origFromNote))) {
          rec.relistUnitPrice = restoreTarget;
          rec.listedUnitPrice = restoreTarget;
          rec.relistPriceTotal = restoreTarget * qty;
          changed = true;
        }
      } else {
        const curFlipU = Number(rec.flipUnitPrice) || 0;
        const safeFloorU = Math.max(minBreakEvenUnit, trueRef);
        if (minBreakEvenUnit > 0 && curFlipU > 0 && curFlipU < minBreakEvenUnit) {
          rec.flipUnitPrice = safeFloorU;
          rec.listedUnitPrice = safeFloorU;
          rec.relistedPrice = safeFloorU * qty;
          changed = true;
        }
      }

      const listedUnit = Number(isHistory ? rec.relistUnitPrice : rec.flipUnitPrice) || oldRef || trueRef;
      if (!rec.listedUnitPrice && listedUnit > 0) {
        rec.listedUnitPrice = listedUnit;
      }
      const realisticFlipTotal = trueRef * qty;
      const realisticNetRev = realisticFlipTotal - Math.floor(realisticFlipTotal * 4 / 100);
      const realisticProfit = buyTotal > 0 ? (realisticNetRev - buyTotal) : 0;
      rec.realisticUnitPrice = trueRef;
      rec.realisticNetProfit = realisticProfit;

      if (oldRef > Math.round(trueRef * 1.25) || (oldRef > 0 && oldRef < Math.round(trueRef * 0.75))) {
        rec.cleanRefUnitPrice = trueRef;
        rec.expectedNetProfit = realisticProfit;
        if (!isHistory) {
          rec.discountPct = buyUnit > 0 && trueRef > buyUnit
            ? Math.max(1, Math.round((1 - (buyUnit / trueRef)) * 100))
            : 0;
        }
        changed = true;
      }
    };

    if (Array.isArray(state.activeBids)) {
      for (const b of state.activeBids) fixRecordValuation(b, false);
    }
    if (Array.isArray(state.history)) {
      for (const h of state.history) fixRecordValuation(h, true);
    }
    if (Array.isArray(state.pendingFlips)) {
      for (const pf of state.pendingFlips) {
        const trueRef = getTrueRefUnitPrice(pf.itemId, pf.refine || 0, pf.itemName, pf.cleanRefUnitPrice);
        if (trueRef > 0 && (Number(pf.flipUnitPrice) || 0) > Math.round(trueRef * 1.25)) {
          pf.cleanRefUnitPrice = trueRef;
          pf.flipUnitPrice = trueRef;
          pf.relistPriceTotal = trueRef * Math.max(1, Number(pf.qty) || 1);
          changed = true;
        }
      }
    }

    // Recompute state.stats.totalEstimatedNetProfit from realistic profits so KPI never shows fake RMT-inflated +274M
    let honestEstimatedProfit = 0;
    const seenRelisted = new Set();
    for (const h of (state.history || [])) {
      if (h && h.action === 'relisted' && h.listingId && !seenRelisted.has(Number(h.listingId))) {
        seenRelisted.add(Number(h.listingId));
        const p = Number(h.realisticNetProfit !== undefined ? h.realisticNetProfit : h.expectedNetProfit) || 0;
        if (p > 0) honestEstimatedProfit += p;
      }
    }
    if (state.stats && state.stats.totalEstimatedNetProfit !== honestEstimatedProfit) {
      state.stats.totalEstimatedNetProfit = honestEstimatedProfit;
      changed = true;
    }

    if (changed) savePersistedState(state);
  }

  sanitizeHistoricalState();

  // In-memory runtime locks & cursors
  const listingLocks = new Map(); // listingId -> { buyerProfileId, lockedAt, lastBidAmount, maxBidCapTotal }
  let scannerCursor = 0;
  let filterCursor = 0;
  let scanTimer = null;
  let maintenanceTimer = null;
  let isScanningTick = false;
  let isMaintenanceTick = false;
  let lastScanSummary = {
    at: 0,
    scannerProfileId: null,
    scannerName: null,
    filterLabel: '',
    listingsCount: 0,
    evaluatedCount: 0
  };

  function getBlacklistSet() {
    return new Set(
      String(config.blacklistItems || '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
    );
  }

  function getWatchlistArray() {
    return String(config.customWatchlist || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  function buildSearchFilterQueue() {
    const queue = [];
    const cats = config.categories || {};
    const enabledCats = Object.keys(cats).filter(k => cats[k]);

    // 1. Global newest listings (catches any newly listed item across enabled categories within seconds)
    queue.push({ filters: { sort: 'newest', page: 0 }, label: 'ลงขายล่าสุด (ทุกหมวด)' });

    // 2. Category-specific scans (both newest and cheapest)
    const catLabels = {
      stone: 'ศิลา (Stone)',
      refine: 'แร่/ตีบวก (Refine)',
      card: 'การ์ด (Card)',
      craft: 'วัสดุคราฟต์ (Craft)',
      material: 'วัตถุดิบ (Material)',
      usable: 'ของใช้ (Usable)',
      accessory: 'ประดับ/เจม (Accessory)',
      weapon: 'อาวุธ (Weapon)',
      armor: 'ชุดเกราะ (Armor)'
    };

    for (const c of enabledCats) {
      if (c === 'stone') {
        queue.push({ filters: { category: 'stone', sort: 'newest', page: 0 }, label: `${catLabels[c]} · ลงใหม่` });
        queue.push({ filters: { category: 'stone', sort: 'price_asc', page: 0 }, label: `${catLabels[c]} · ราคาถูกสุด` });
      } else {
        queue.push({ filters: { category: c, sort: 'price_asc', page: 0 }, label: `${catLabels[c] || c} · ราคาถูกสุด` });
        queue.push({ filters: { category: c, sort: 'newest', page: 0 }, label: `${catLabels[c] || c} · ลงใหม่` });
      }
    }

    // 3. Custom Watchlist queries
    const watchItems = getWatchlistArray();
    for (const q of watchItems.slice(0, 10)) {
      queue.push({ filters: { q, sort: 'price_asc', page: 0 }, label: `เฝ้าดู: "${q}"` });
    }

    return queue;
  }

  function buildSniperClaimAndFlipRuntimeJs() {
    return `
      if (!window.__pmSniperProtectedItems) window.__pmSniperProtectedItems = new Set();
      if (typeof window.isSellWhitelisted === 'function' && !window.__pmSniperWlHooked) {
        const origWl = window.isSellWhitelisted;
        window.isSellWhitelisted = function (nm, customWl) {
          if (nm && window.__pmSniperProtectedItems && window.__pmSniperProtectedItems.has(String(nm).trim().toLowerCase())) {
            return true;
          }
          return origWl.call(this, nm, customWl);
        };
        window.__pmSniperWlHooked = true;
      }
      window.__pmGetSmartFlipBatchConfig = function (itemName, unitPrice, isSingle) {
        const norm = String(itemName || '').trim().toLowerCase();
        const single = Boolean(isSingle || /\\bcard\\b|\\bstone\\s*\\(|การ์ด|ศิลา/i.test(norm));
        const u = Math.max(1, Number(unitPrice) || 1);
        if (single || u >= 100000) return { batchQty: 1, maxConcurrent: 2, isSingle: true };
        if (u >= 20000) return { batchQty: 10, maxConcurrent: 3, isSingle: false };
        if (u >= 8000) return { batchQty: 25, maxConcurrent: 3, isSingle: false };
        if (u >= 1800) return { batchQty: 50, maxConcurrent: 3, isSingle: false };
        return { batchQty: 100, maxConcurrent: 3, isSingle: false };
      };
      if (window.__pmSniperRuntimeVer !== 3 || typeof window.__pmSniperClaimAndFlip !== 'function') {
        window.__pmSniperRuntimeVer = 3;
        window.__pmSniperClaimAndFlip = async function (targetInfo, paidTotal, waitBeforeCollectMs = 750) {
          const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
          if (!room || !room.connection || !room.connection.isOpen) {
            return { relisted: false, foundInBag: false, listedUnitsCount: 0, evictedItemName: null, evictedItemPrice: 0 };
          }
          if (waitBeforeCollectMs >= 0) {
            if (waitBeforeCollectMs > 0) {
              await new Promise(r => setTimeout(r, waitBeforeCollectMs));
            }
            try { room.send('market', { op: 'collect_all' }); } catch (_) {}
            await new Promise(r => setTimeout(r, 850));
            if (typeof window.refreshInventoryAndWeight === 'function') {
              try { window.refreshInventoryAndWeight(); } catch (_) {}
            }
            await new Promise(r => setTimeout(r, 300));
          }

          let relisted = false;
          let foundInBag = false;
          let evictedInfo = null;
          let listedUnitsCount = 0;
          const normName = String(targetInfo.itemName || '').trim().toLowerCase();
          const isSingle = Boolean(targetInfo.singleUnit || /\\bcard\\b|\\bstone\\s*\\(|การ์ด|ศิลา/i.test(normName));
          if (normName && window.__pmSniperProtectedItems) window.__pmSniperProtectedItems.add(normName);

          const findMatchingInBag = () => {
            const bag = (typeof window.getBagItems === 'function') ? window.getBagItems() : [];
            return bag.filter(b => {
              if (!b || b.locked) return false;
              const bId = Number((b.raw && b.raw.itemId) ?? b.id);
              const bRef = Number(b.refine || (b.raw && b.raw.refine) || 0);
              if (bId === Number(targetInfo.itemId) && bRef === Number(targetInfo.refine)) return true;
              return String(b.name || '').trim().toLowerCase() === normName && bRef === Number(targetInfo.refine);
            }).sort((a, b) => (Number(b.qty) || 1) - (Number(a.qty) || 1));
          };

          const initialCandidates = findMatchingInBag();
          const totalBagQty = initialCandidates.reduce((s, c) => s + (Number(c.qty) || 1), 0);
          const expectedLotQty = Math.max(1, Number(targetInfo.qty) || 1);

          // Guard against false positive when outbid on a large stack (e.g. x999) while holding a few farmed drops in bag
          if (!targetInfo.isRestock && expectedLotQty >= 20 && totalBagQty < Math.max(10, Math.floor(expectedLotQty * 0.4))) {
            foundInBag = false;
          } else {
            foundInBag = totalBagQty > 0;
          }

          const paidUnitCost = Math.floor((Number(paidTotal) || 0) / expectedLotQty);
          const minProfitableUnitPrice = paidUnitCost > 0 ? Math.ceil((paidUnitCost * 1.02) / 0.96) : 1;
          let unitPrice = Math.max(
            minProfitableUnitPrice,
            Number(targetInfo.flipUnitPrice) || Math.round((Number(targetInfo.relistPriceTotal) || 0) / expectedLotQty) || 1
          );

          if (foundInBag && targetInfo.autoFlip && unitPrice >= minProfitableUnitPrice) {
            const totalWantedQty = targetInfo.isRestock ? totalBagQty : Math.min(expectedLotQty, totalBagQty);
            if (!targetInfo.skipSmartPriceFetch && typeof window.fetchItemSmartSellPrice === 'function' && initialCandidates[0]) {
              try {
                const rawSmart = await window.fetchItemSmartSellPrice(initialCandidates[0]);
                const liveSmart = Number((rawSmart && typeof rawSmart === 'object') ? rawSmart.unitPrice : rawSmart) || 0;
                const minSmartAllowed = Math.max(minProfitableUnitPrice, Math.round(unitPrice * 0.88));
                if (liveSmart >= minSmartAllowed && liveSmart <= Math.round(unitPrice * 1.15)) {
                  unitPrice = liveSmart;
                }
              } catch (_) {}
            }

            const batchCfg = window.__pmGetSmartFlipBatchConfig(normName, unitPrice, isSingle);
            const batchQty = Math.max(1, Number(targetInfo.batchQty) || batchCfg.batchQty);
            const maxConcurrent = Math.max(1, Number(targetInfo.maxConcurrent) || batchCfg.maxConcurrent);

            const ch = (typeof window.getLiveCharacterData === 'function' ? window.getLiveCharacterData() : null) || window.__latestCharacterData || {};
            const live = (typeof window.__getClientLiveState === 'function' ? window.__getClientLiveState() : null) || {};
            const hasPrem = Boolean(
              (Array.isArray(ch.buffs) && ch.buffs.some(b => b && b.skillId === 'ui:token')) ||
              (Array.isArray(live.buffs) && live.buffs.some(b => b && (b.skillId === 'ui:token' || b === 'ui:token')))
            );
            const maxSlots = hasPrem ? 20 : 3;

            const mineMsg = await new Promise(resolve => {
              let unsub;
              const t = setTimeout(() => { if (unsub) unsub(); resolve(null); }, 2200);
              unsub = room.onMessage('market_mine', m => { clearTimeout(t); if (unsub) unsub(); resolve(m); });
              try { room.send('market', { op: 'mine' }); } catch (_) { clearTimeout(t); if (unsub) unsub(); resolve(null); }
            });

            const activeList = (mineMsg && Array.isArray(mineMsg.active)) ? mineMsg.active : [];
            const sameActiveCount = activeList.filter(a => a && String((a.item && a.item.name) || '').trim().toLowerCase() === normName).length;
            const desiredNewBatches = Math.max(targetInfo.isRestock ? 0 : (sameActiveCount < maxConcurrent ? 1 : 0), maxConcurrent - sameActiveCount);
            const maxBatchesFromBag = Math.max(1, Math.ceil(totalWantedQty / batchQty));
            const listingsToPost = Math.min(desiredNewBatches, maxBatchesFromBag);
            const sampleBatchQty = Math.min(batchQty, totalWantedQty);
            const sampleBatchPrice = unitPrice * sampleBatchQty;
            const totalDepositFee = Math.max(1, Math.floor(sampleBatchPrice * 2 / 100)) * Math.max(1, listingsToPost);
            const curZeny = (typeof window.__currentZeny === 'number') ? window.__currentZeny : 0;

            if (listingsToPost === 0 && sameActiveCount >= maxConcurrent) {
              // Already has maxConcurrent batches active on market; remaining units stay protected in bag for drip restock
              relisted = true;
            } else if (listingsToPost > 0 && totalWantedQty > 0 && unitPrice >= minProfitableUnitPrice && (curZeny === 0 || curZeny >= totalDepositFee)) {
              const freeSlotsNow = Math.max(0, maxSlots - activeList.length);
              const needEvictCount = Math.max(0, listingsToPost - freeSlotsNow);

              if (needEvictCount > 0) {
                const nowTs = Date.now();
                const evictable = activeList
                  .filter(a => a && a.listingId && !(a.auctionEndsAt && Number(a.auctionEndsAt) > nowTs) && Number(a.price) > 0 && Number(a.price) <= 50000)
                  .sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));

                const toEvict = evictable.slice(0, needEvictCount);
                if (toEvict.length > 0) {
                  if (!window.__pmSniperEvictedItemNames) window.__pmSniperEvictedItemNames = new Set();
                  if (!window.__autoSellRuleBackoffUntil) window.__autoSellRuleBackoffUntil = {};
                  if (!window.__pmSeenCancelledClosedIds) window.__pmSeenCancelledClosedIds = new Set();
                  const evictedNames = [];
                  let firstEvictPrice = 0;
                  for (const targetEvict of toEvict) {
                    const evName = (targetEvict.item && targetEvict.item.name) || 'Item';
                    const evNorm = String(evName).trim().toLowerCase();
                    const evPrice = Number(targetEvict.price) || 0;
                    if (!firstEvictPrice) firstEvictPrice = evPrice;
                    evictedNames.push(evName);
                    window.__pmSniperEvictedItemNames.add(evNorm);
                    window.__autoSellRuleBackoffUntil[evNorm] = Date.now() + 30 * 60 * 1000;
                    window.__pmSeenCancelledClosedIds.add(Number(targetEvict.listingId));
                    try { room.send('market', { op: 'cancel', listingId: Number(targetEvict.listingId) }); } catch (_) {}
                    await new Promise(r => setTimeout(r, 320));
                  }
                  try { room.send('market', { op: 'collect_all' }); } catch (_) {}
                  await new Promise(r => setTimeout(r, 500));
                  evictedInfo = { name: evictedNames.join(', '), price: firstEvictPrice, count: toEvict.length };
                }
              }

              for (let u = 0; u < listingsToPost; u++) {
                const freshCandidates = findMatchingInBag();
                if (!freshCandidates.length) break;
                const freshTarget = freshCandidates[0];
                const beforeQty = Number(freshTarget.qty) || 1;
                // If remaining stack is within 20% of batchQty (e.g. 115 left when batchQty=100), list all of it so no tiny tail is left
                const qtyThisPost = (batchQty > 1 && beforeQty <= Math.ceil(batchQty * 1.20))
                  ? beforeQty
                  : Math.min(batchQty, beforeQty);
                if (qtyThisPost <= 0) break;
                const priceThisPost = unitPrice * qtyThisPost;

                window.__pmExplicitHoursOnce = true;
                try {
                  room.send('market', {
                    op: 'list',
                    slot: Number(freshTarget.slot),
                    qty: qtyThisPost,
                    price: priceThisPost,
                    hours: Number(targetInfo.relistDurationHours) || 24
                  });
                } finally {
                  window.__pmExplicitHoursOnce = false;
                }

                let postedOne = false;
                for (let i = 0; i < 8; i++) {
                  await new Promise(r => setTimeout(r, 250));
                  const nowBag = (typeof window.getBagItems === 'function') ? window.getBagItems() : [];
                  const nowSlot = nowBag.find(x => Number(x.slot) === Number(freshTarget.slot));
                  const left = nowSlot ? (Number(nowSlot.qty) || 0) : 0;
                  if (left <= beforeQty - qtyThisPost) {
                    postedOne = true;
                    listedUnitsCount += qtyThisPost;
                    relisted = true;
                    break;
                  }
                }
                if (!postedOne) break;
                if (u + 1 < listingsToPost) {
                  await new Promise(r => setTimeout(r, 320));
                }
              }

              if (relisted) {
                try { room.send('market', { op: 'mine' }); } catch (_) {}
              }
            }
          }
          const remAfter = findMatchingInBag().reduce((s, c) => s + (Number(c.qty) || 1), 0);
          if (window.__pmSniperProtectedItems) {
            if (foundInBag && remAfter > 0) {
              window.__pmSniperProtectedItems.add(normName);
            } else if (!foundInBag || remAfter <= 0) {
              window.__pmSniperProtectedItems.delete(normName);
            }
          }
          return {
            relisted,
            foundInBag,
            listedUnitsCount,
            remainingBagQty: remAfter,
            evictedItemName: evictedInfo ? evictedInfo.name : null,
            evictedItemPrice: evictedInfo ? evictedInfo.price : 0
          };
        };
      }
    `;
  }

  const runtimeInstalledByPort = new Map();
  let cachedOnlineScreens = null;
  let cachedOnlineScreensAt = 0;
  let inflightOnlineScreensPromise = null;

  // Probe all online profiles to get their live Zeny, Premium status, Market Quota, and connection readiness
  async function getOnlineScreenStates(forceFresh = false) {
    if (!forceFresh && cachedOnlineScreens && (Date.now() - cachedOnlineScreensAt < 3500)) {
      return cachedOnlineScreens;
    }
    if (!forceFresh && inflightOnlineScreensPromise) {
      return inflightOnlineScreensPromise;
    }
    inflightOnlineScreensPromise = (async () => {
      try {
        const profiles = (typeof loadProfiles === 'function' ? loadProfiles() : []) || [];
        const running = profiles.filter(p => p && p.debugPort);
        if (!running.length) {
          cachedOnlineScreens = [];
          cachedOnlineScreensAt = Date.now();
          return [];
        }

        const sniperAutoFlip = Boolean(config.enabled && config.mode === 'auto_flip');
        const reserveSlots = sniperAutoFlip ? 2 : 0;

        // Build map ONLY of items actually bought/relisted by Sniper (never all scanned items in state.priceCache!)
        // and enforce break-even floor (buyUnit / 0.96) from the newest lot of each item so background hooks never reprice below cost.
        const sniperFlippedMap = Object.assign({}, VERIFIED_STABLE_REF_BY_NAME);
        const sniperMinFloorMap = {};
        for (const h of (state.history || []).slice().reverse()) {
          if (!h || !h.itemName) continue;
          if (h.action === 'relisted' || h.action === 'buy' || h.action === 'won') {
            const nm = String(h.itemName).trim().toLowerCase();
            if (!nm) continue;
            const q = Math.max(1, Number(h.qty) || 1);
            const buyU = Math.round((Number(h.buyPriceTotal) || 0) / q);
            const floorU = buyU > 0 ? Math.ceil(buyU / 0.96) : 0;
            if (floorU > 0) sniperMinFloorMap[nm] = floorU;
            const refP = getTrueRefUnitPrice(h.itemId, h.refine || 0, h.itemName, h.cleanRefUnitPrice);
            const safeRef = Math.max(refP, floorU);
            if (safeRef > 0) sniperFlippedMap[nm] = safeRef;
          }
        }
        for (const b of (state.activeBids || [])) {
          if (!b || !b.itemName) continue;
          if (b.status === 'relisted' || b.status === 'queued_flip' || b.status === 'won' || b.status === 'bought') {
            const nm = String(b.itemName).trim().toLowerCase();
            if (!nm) continue;
            const q = Math.max(1, Number(b.qty) || 1);
            const buyU = Math.round((Number(b.currentBid) || 0) / q);
            const floorU = buyU > 0 ? Math.ceil(buyU / 0.96) : 0;
            if (floorU > 0) sniperMinFloorMap[nm] = floorU;
            const refP = getTrueRefUnitPrice(b.itemId, b.refine || 0, b.itemName, b.cleanRefUnitPrice);
            const safeRef = Math.max(refP, floorU);
            if (safeRef > 0) sniperFlippedMap[nm] = safeRef;
          }
        }

        const globalSettings = loadGlobalMarketSettings();
        let cachedFullSetupCode = null;
        const getFullSetupCode = () => {
          if (!cachedFullSetupCode) {
            const globalMarketSnippet = buildMarketGlobalRuntimeSnippet(globalSettings);
            cachedFullSetupCode = `(() => {
              const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
              if (!room || !room.connection || !room.connection.isOpen) return false;
              try { ${globalMarketSnippet}; } catch (_) {}
              ${buildSniperClaimAndFlipRuntimeJs()}
              if (room !== window.__pmSniperMineHookedRoomV3) {
                window.__pmSniperMineHookedRoomV3 = room;
                room.onMessage('market_mine', (msg) => {
                  if (msg && Array.isArray(msg.active)) {
                    window.__lastMarketMine = msg;
                    window.__myMarketActiveCount = msg.active.length;
                    window.__myMarketActiveCountUpdatedAt = Date.now();
                    if (typeof window.__pmSyncKnownMarketItems === 'function') {
                      try { window.__pmSyncKnownMarketItems(msg); } catch (_) {}
                    }
                    const nowTs = Date.now();
                    const nonAuction = msg.active.filter(a => a && !(a.auctionEndsAt && Number(a.auctionEndsAt) > nowTs));
                    const prices = nonAuction.map(a => Number(a.price) || 0).filter(p => p > 0);
                    window.__myMarketCheapestActivePrice = prices.length ? Math.min(...prices) : 0;
                    if (!window.__pmSniperKnownCheapItems) window.__pmSniperKnownCheapItems = new Set();
                    window.__myMarketEvictableCheapCount = nonAuction.filter(a => {
                      const p = Number(a.price) || 0;
                      if (p > 0 && p <= 50000) {
                        const nm = String((a.item && a.item.name) || '').trim().toLowerCase();
                        if (nm) window.__pmSniperKnownCheapItems.add(nm);
                        return true;
                      }
                      return false;
                    }).length;
                    const nameCounts = {};
                    const idCounts = {};
                    for (const a of msg.active) {
                      if (!a) continue;
                      const nm = String((a.item && a.item.name) || '').trim().toLowerCase();
                      const iid = Number(a.item && (a.item.itemId ?? a.item.id)) || 0;
                      if (nm) nameCounts[nm] = (nameCounts[nm] || 0) + 1;
                      if (iid) idCounts[iid] = (idCounts[iid] || 0) + 1;
                    }
                    window.__myMarketActiveNameCounts = nameCounts;
                    window.__myMarketActiveIdCounts = idCounts;
                    window.__myMarketStackedCards = nonAuction
                      .filter(a => a && Number(a.qty) > 1 && /\\bcard\\b|\\bstone\\s*\\(|การ์ด|ศิลา/i.test(String((a.item && a.item.name) || '')))
                      .map(a => ({
                        listingId: Number(a.listingId),
                        itemId: Number(a.item && (a.item.itemId ?? a.item.id)) || 0,
                        refine: Number(a.item && a.item.refine) || 0,
                        name: String((a.item && a.item.name) || ''),
                        qty: Number(a.qty) || 1,
                        price: Number(a.price) || 0,
                        unitPrice: Math.max(1, Math.round((Number(a.price) || 0) / Math.max(1, Number(a.qty) || 1)))
                      }));
                  }
                });
              }
              if (room !== window.__pmSniperSendGuardRoomV2 && typeof room.send === 'function') {
                window.__pmSniperSendGuardRoomV2 = room;
                const origRoomSend = room.send.bind(room);
                room.send = function (type, data) {
                  if (type === 'market' && data && data.op === 'list') {
                    const bag = (typeof window.getBagItems === 'function') ? window.getBagItems() : [];
                    const slotItem = bag.find(b => b && Number(b.slot) === Number(data.slot));
                    const itemName = String((slotItem && slotItem.name) || '').trim();
                    const norm = itemName.toLowerCase();
                    const isCardOrStone = /\\bcard\\b|\\bstone\\s*\\(|การ์ด|ศิลา/i.test(itemName);
                    const isFlippedItem = Boolean(norm && window.__pmSniperFlippedItems && window.__pmSniperFlippedItems[norm]);
                    const unitP = Math.max(1, Math.round((Number(data.price) || 0) / Math.max(1, Number(data.qty) || 1)));
                    const bCfg = (typeof window.__pmGetSmartFlipBatchConfig === 'function')
                      ? window.__pmGetSmartFlipBatchConfig(norm, unitP, isCardOrStone)
                      : { batchQty: isCardOrStone ? 1 : 100, maxConcurrent: isCardOrStone ? 2 : 3 };
                    if (isCardOrStone && Number(data.qty) > 1) {
                      data.qty = 1;
                      data.price = unitP;
                    } else if (isFlippedItem && Number(data.qty) > Math.ceil(bCfg.batchQty * 1.20)) {
                      data.qty = bCfg.batchQty;
                      data.price = unitP * bCfg.batchQty;
                    }
                    if (window.__isAutoSellingNow && window.__pmSniperBlockCheapAutoSell) {
                      if ((Number(data.price) || 0) > 0 && (Number(data.price) || 0) <= 50000) {
                        if (!window.__pmSniperKnownCheapItems) window.__pmSniperKnownCheapItems = new Set();
                        if (norm) window.__pmSniperKnownCheapItems.add(norm);
                        return;
                      }
                      if (norm && window.__pmSniperEvictedItemNames && window.__pmSniperEvictedItemNames.has(norm)) {
                        return;
                      }
                      if ((isCardOrStone || isFlippedItem) && norm) {
                        const curSame = (window.__myMarketActiveNameCounts && window.__myMarketActiveNameCounts[norm]) || 0;
                        if (curSame >= bCfg.maxConcurrent) {
                          return;
                        }
                        if (!window.__myMarketActiveNameCounts) window.__myMarketActiveNameCounts = {};
                        window.__myMarketActiveNameCounts[norm] = curSame + 1;
                      }
                    }
                  }
                  return origRoomSend(type, data);
                };
              }
              return true;
            })()`;
          }
          return cachedFullSetupCode;
        };

        const fastProbeCode = `(() => {
          const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
          if (!room || !room.connection || !room.connection.isOpen) return { connected: false };
          const verifiedFlipMap = ${JSON.stringify(sniperFlippedMap)};
          const minFloorMap = ${JSON.stringify(sniperMinFloorMap)};
          window.__pmSniperFlippedItems = verifiedFlipMap;
          window.__pmSniperMinFloorItems = minFloorMap;
          if (window.__pmKnownMyMarketItems && typeof window.__pmKnownMyMarketItems === 'object') {
            for (const [k, v] of Object.entries(window.__pmKnownMyMarketItems)) {
              const refCap = verifiedFlipMap[k];
              if (refCap && v && Number(v.unitPrice) > Math.round(refCap * 1.30)) {
                v.unitPrice = Math.max(refCap, Number(minFloorMap[k]) || 0);
              }
            }
          }
          const runtimeInstalled = Boolean(
            window.__pmMarketGlobalTimerVer === 8 &&
            window.__pmSniperRuntimeVer === 3 &&
            typeof window.__pmSniperClaimAndFlip === 'function' &&
            window.__pmSniperMineHookedRoomV3 === room &&
            window.__pmSniperSendGuardRoomV2 === room
          );
          const ch = (typeof window.getLiveCharacterData === 'function' ? window.getLiveCharacterData() : null) || window.__latestCharacterData || {};
          const live = (typeof window.__getClientLiveState === 'function' ? window.__getClientLiveState() : null) || {};
          const premium = Boolean(
            (Array.isArray(ch.buffs) && ch.buffs.some(b => b && b.skillId === 'ui:token')) ||
            (Array.isArray(live.buffs) && live.buffs.some(b => b && (b.skillId === 'ui:token' || b === 'ui:token')))
          );
          const zeny = (typeof window.__currentZeny === 'number') ? window.__currentZeny : (typeof ch.zeny === 'number' ? ch.zeny : (typeof live.zeny === 'number' ? live.zeny : 0));

          window.__pmSniperReservedSlots = (zeny >= 300000) ? ${reserveSlots} : 0;
          window.__pmSniperBlockCheapAutoSell = Boolean(${sniperAutoFlip ? 'true' : 'false'} && zeny >= 300000);

          if (${sniperAutoFlip ? 'true' : 'false'} && zeny >= 300000 && (!window.__pmLastSniperRuleSyncAt || (Date.now() - window.__pmLastSniperRuleSyncAt > 30000)) && window.__autoMarketSellConfig && Array.isArray(window.__autoMarketSellConfig.rules)) {
            window.__pmLastSniperRuleSyncAt = Date.now();
            if (!window.__autoSellRuleBackoffUntil) window.__autoSellRuleBackoffUntil = {};
            let changedCardRule = false;
            // Remove any previously auto-injected rule_sniper_ / rule_relist_ for non-Sniper items (like Echo Stone)
            const beforeLen = window.__autoMarketSellConfig.rules.length;
            window.__autoMarketSellConfig.rules = window.__autoMarketSellConfig.rules.filter(r => {
              if (!r) return false;
              const rid = String(r.id || '');
              const rNorm = String(r.itemName || r.name || '').trim().toLowerCase();
              if ((rid.startsWith('rule_sniper_') || rid.startsWith('rule_relist_')) && !verifiedFlipMap[rNorm]) {
                return false;
              }
              return true;
            });
            if (window.__autoMarketSellConfig.rules.length !== beforeLen) changedCardRule = true;
            for (const r of window.__autoMarketSellConfig.rules) {
              if (!r) continue;
              const rName = String(r.itemName || r.name || '').trim();
              const rNorm = rName.toLowerCase();
              const rKey = r.id || rNorm;
              const isCardOrStone = /\\bcard\\b|\\bstone\\s*\\(|การ์ด|ศิลา/i.test(rName);
              if (isCardOrStone && (r.sellMode !== 'min' || Number(r.minQty) !== 1)) {
                r.sellMode = 'min';
                r.minQty = 1;
                changedCardRule = true;
              }
              if ((window.__pmSniperEvictedItemNames && window.__pmSniperEvictedItemNames.has(rNorm)) ||
                  (window.__pmSniperKnownCheapItems && window.__pmSniperKnownCheapItems.has(rNorm))) {
                window.__autoSellRuleBackoffUntil[rKey] = Date.now() + 30 * 60 * 1000;
                window.__autoSellRuleBackoffUntil[rNorm] = Date.now() + 30 * 60 * 1000;
              } else if (isCardOrStone) {
                const activeSame = (window.__myMarketActiveNameCounts && window.__myMarketActiveNameCounts[rNorm]) || 0;
                if (activeSame >= 2) {
                  window.__autoSellRuleBackoffUntil[rKey] = Date.now() + 3 * 60 * 1000;
                  window.__autoSellRuleBackoffUntil[rNorm] = Date.now() + 3 * 60 * 1000;
                }
              }
            }
            if (changedCardRule && typeof window.saveMarketSellConfig === 'function') {
              try { window.saveMarketSellConfig(); } catch (_) {}
            }
          }

          if (!window.__lastMarketMine || !window.__myMarketActiveCountUpdatedAt || window.__myMarketEvictableCheapCount === undefined || (Date.now() - window.__myMarketActiveCountUpdatedAt > 45000)) {
            window.__myMarketActiveCountUpdatedAt = Date.now();
            try { room.send('market', { op: 'mine' }); } catch (_) {}
          }
          const mineObj = window.__lastMarketMine || {};
          const rawActive = Array.isArray(mineObj.active) ? mineObj.active : [];
          const rawClosed = Array.isArray(mineObj.closed) ? mineObj.closed : [];
          const myActiveListings = rawActive.map(a => {
            if (!a) return null;
            const q = Math.max(1, Number(a.qty) || 1);
            const p = Number(a.price) || 0;
            return {
              listingId: Number(a.listingId) || 0,
              itemId: Number(a.item && (a.item.itemId ?? a.item.id)) || 0,
              refine: Number(a.item && a.item.refine) || 0,
              name: String((a.item && a.item.name) || ''),
              icon: (a.item && a.item.icon) || null,
              qty: q,
              price: p,
              unitPrice: Math.max(1, Math.round(p / q)),
              expiresAt: Number(a.expiresAt) || 0
            };
          }).filter(Boolean);
          const mySoldListings = rawClosed
            .filter(c => c && c.status === 'sold')
            .slice(0, 60)
            .map(c => {
              const q = Math.max(1, Number(c.qty) || 1);
              const p = Number(c.price) || 0;
              return {
                listingId: Number(c.listingId) || 0,
                itemId: Number(c.item && (c.item.itemId ?? c.item.id)) || 0,
                refine: Number(c.item && c.item.refine) || 0,
                name: String((c.item && c.item.name) || ''),
                icon: (c.item && c.item.icon) || null,
                qty: q,
                price: p,
                unitPrice: Math.max(1, Math.round(p / q)),
                buyerName: String(c.buyerName || ''),
                closedAt: Number(c.closedAt) || 0
              };
            });

          // Detect both stacked Cards/Stones (qty > 1) and oversized Sniper-flipped stacks (qty > batchQty * 1.35)
          const nowTs = Date.now();
          const nonAuctionActive = rawActive.filter(a => a && !(a.auctionEndsAt && Number(a.auctionEndsAt) > nowTs));
          const stackedCards = [];
          for (const a of nonAuctionActive) {
            const nm = String((a.item && a.item.name) || '').trim();
            const nmLower = nm.toLowerCase();
            const q = Math.max(1, Number(a.qty) || 1);
            const p = Number(a.price) || 0;
            const unitP = Math.max(1, Math.round(p / q));
            const isCardOrStone = /\\bcard\\b|\\bstone\\s*\\(|การ์ด|ศิลา/i.test(nm);
            const isFlippedItem = Boolean(nmLower && verifiedFlipMap[nmLower]);
            if (!isCardOrStone && !isFlippedItem) continue;
            const refUnit = verifiedFlipMap[nmLower] || unitP;
            const bCfg = (typeof window.__pmGetSmartFlipBatchConfig === 'function')
              ? window.__pmGetSmartFlipBatchConfig(nmLower, refUnit, isCardOrStone)
              : { batchQty: isCardOrStone ? 1 : (refUnit >= 20000 ? 10 : (refUnit >= 8000 ? 25 : (refUnit >= 1800 ? 50 : 100))), maxConcurrent: isCardOrStone ? 2 : 3 };
            if ((isCardOrStone && q > 1) || (isFlippedItem && q > Math.ceil(bCfg.batchQty * 1.35))) {
              const safeUnitP = (verifiedFlipMap[nmLower] && unitP > Math.round(verifiedFlipMap[nmLower] * 1.25))
                ? Math.max(verifiedFlipMap[nmLower], Number(minFloorMap[nmLower]) || 0)
                : unitP;
              stackedCards.push({
                listingId: Number(a.listingId) || 0,
                itemId: Number(a.item && (a.item.itemId ?? a.item.id)) || 0,
                refine: Number(a.item && a.item.refine) || 0,
                name: nm,
                qty: q,
                price: p,
                unitPrice: safeUnitP,
                batchQty: bCfg.batchQty,
                maxConcurrent: bCfg.maxConcurrent
              });
            }
          }
          window.__myMarketStackedCards = stackedCards;

          // Collect bag items that match Sniper-flipped items so remaining split batches are protected & drip-restocked
          const bagByNorm = new Map();
          const bagItemsArr = (typeof window.getBagItems === 'function') ? window.getBagItems() : [];
          if (!window.__pmSniperProtectedItems) window.__pmSniperProtectedItems = new Set();
          for (const b of bagItemsArr) {
            if (!b) continue;
            const nm = String(b.name || '').trim();
            const nmLower = nm.toLowerCase();
            if (!nmLower || !verifiedFlipMap[nmLower]) continue;
            const q = Math.max(1, Number(b.qty) || 1);
            const bId = Number((b.raw && b.raw.itemId) ?? b.id) || 0;
            const bRef = Number(b.refine || (b.raw && b.raw.refine) || 0);
            if (!bagByNorm.has(nmLower)) {
              bagByNorm.set(nmLower, {
                name: nm,
                nameLower: nmLower,
                itemId: bId,
                refine: bRef,
                qty: 0,
                unlockedQty: 0,
                unitPrice: Number(verifiedFlipMap[nmLower]) || 0
              });
            }
            const entry = bagByNorm.get(nmLower);
            entry.qty += q;
            if (!b.locked) entry.unlockedQty += q;
            window.__pmSniperProtectedItems.add(nmLower);
          }
          const bagFlippedItems = Array.from(bagByNorm.values());

          const baseLevel = Number(ch.baseLevel ?? ch.level ?? live.level) || 0;
          const charName = ch.name || live.charName || window.__characterName || '';
          const activeCount = Number(window.__myMarketActiveCount) || myActiveListings.length || 0;
          const cheapestActivePrice = Number(window.__myMarketCheapestActivePrice) || 0;
          const evictableCheapCount = Number(window.__myMarketEvictableCheapCount) || 0;
          const activeNameCounts = window.__myMarketActiveNameCounts || {};
          const activeIdCounts = window.__myMarketActiveIdCounts || {};
          const maxListings = premium ? 20 : 3;
          const weight = Number(ch.weight ?? live.weight) || 0;
          const weightLimit = Number(ch.weightLimit ?? live.weightLimit) || 0;
          const busy = !!(window.__isConsolidating || window.__isShopping || window.__isAutoSellingNow || window.__isManualSelling || window.__isStoring);
          const sniperEvents = Array.isArray(window.__pmSniperEvents) ? window.__pmSniperEvents.splice(0, 50) : [];
          return {
            connected: true,
            runtimeInstalled,
            zeny,
            premium,
            baseLevel,
            charName,
            activeCount,
            cheapestActivePrice,
            evictableCheapCount,
            activeNameCounts,
            activeIdCounts,
            stackedCards,
            bagFlippedItems,
            myActiveListings,
            mySoldListings,
            maxListings,
            weight,
            weightLimit,
            busy,
            sniperEvents
          };
        })()`;

        const results = new Array(running.length).fill(null);
        let nextIdx = 0;
        const concurrency = Math.min(6, running.length);
        await Promise.all(Array.from({ length: concurrency }, async () => {
          while (nextIdx < running.length) {
            const curIdx = nextIdx++;
            const p = running[curIdx];
            try {
              const r = await evalProfilePort(p.debugPort, fastProbeCode, 2500);
              if (r && (r.success || r.ok) && r.result && r.result.connected) {
                const rtMeta = runtimeInstalledByPort.get(p.debugPort);
                const needSetup = !r.result.runtimeInstalled || !rtMeta || rtMeta.settingsUpdatedAt !== globalSettings.updatedAt || (Date.now() - rtMeta.installedAt > 180000);
                if (needSetup) {
                  await evalProfilePort(p.debugPort, getFullSetupCode(), 3500).catch(() => {});
                  runtimeInstalledByPort.set(p.debugPort, {
                    installedAt: Date.now(),
                    settingsUpdatedAt: globalSettings.updatedAt
                  });
                }
                results[curIdx] = {
                  profileId: String(p.id),
                  profileName: p.name || p.id,
                  debugPort: p.debugPort,
                  ...r.result
                };
              }
            } catch (_) {}
          }
        }));

        const online = results.filter(Boolean);
        for (const scr of online) {
          if (Array.isArray(scr.sniperEvents) && scr.sniperEvents.length > 0) {
            for (const ev of scr.sniperEvents) {
              handleClientSniperEvent(scr, ev);
            }
          }
        }
        cachedOnlineScreens = online;
        cachedOnlineScreensAt = Date.now();
        return online;
      } finally {
        inflightOnlineScreensPromise = null;
      }
    })();
    return inflightOnlineScreensPromise;
  }

  function recordHistoryEvent(entry) {
    const lid = Number(entry && entry.listingId) || 0;
    if (lid > 0 && Array.isArray(state.history)) {
      const existingIdx = state.history.findIndex(h => h && Number(h.listingId) === lid);
      if (existingIdx >= 0) {
        const updated = Object.assign({}, state.history[existingIdx], entry, { at: Date.now() });
        state.history.splice(existingIdx, 1);
        state.history.unshift(updated);
        if (state.history.length > 300) state.history.length = 300;
        savePersistedState(state);
        return updated;
      }
    }
    const item = Object.assign({
      id: `snp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now()
    }, entry);
    state.history.unshift(item);
    if (state.history.length > 300) state.history.length = 300;
    savePersistedState(state);
    return item;
  }

  function upsertActiveBid(bidData) {
    const lid = Number(bidData.listingId);
    const idx = state.activeBids.findIndex(b => Number(b.listingId) === lid);
    if (idx >= 0) {
      state.activeBids[idx] = Object.assign({}, state.activeBids[idx], bidData, { updatedAt: Date.now() });
    } else {
      state.activeBids.unshift(Object.assign({ createdAt: Date.now(), updatedAt: Date.now() }, bidData));
    }
    if (state.activeBids.length > 80) state.activeBids.length = 80;
    savePersistedState(state);
  }

  function enqueuePendingFlip(entry) {
    if (!Array.isArray(state.pendingFlips)) state.pendingFlips = [];
    const lid = Number(entry.listingId);
    const idx = state.pendingFlips.findIndex(x => Number(x.listingId) === lid);
    if (idx >= 0) {
      state.pendingFlips[idx] = Object.assign({}, state.pendingFlips[idx], entry, { updatedAt: Date.now() });
    } else {
      state.pendingFlips.push(Object.assign({ queuedAt: Date.now(), updatedAt: Date.now() }, entry));
    }
    if (state.pendingFlips.length > 50) state.pendingFlips.length = 50;
    savePersistedState(state);
  }

  function handleClientSniperEvent(scr, ev) {
    if (!ev || typeof ev !== 'object') return;
    const lid = Number(ev.listingId);
    if (ev.type === 'outbid_rebid') {
      state.stats.totalRefundedCount = (state.stats.totalRefundedCount || 0) + 1;
      state.stats.totalBidsPlaced = (state.stats.totalBidsPlaced || 0) + 1;
      upsertActiveBid({
        listingId: lid,
        itemId: ev.itemId,
        itemName: ev.itemName,
        refine: ev.refine || 0,
        qty: ev.qty || 1,
        icon: ev.icon || null,
        currentBid: ev.newBid,
        cleanRefUnitPrice: ev.cleanRefUnitPrice || 0,
        flipUnitPrice: ev.flipUnitPrice || 0,
        expectedNetProfit: ev.expectedNetProfit || 0,
        buyerProfileId: scr.profileId,
        buyerCharName: scr.charName || scr.profileName,
        status: 'leading',
        lastEventNote: `โดนปาดที่ ${Number(ev.outbidAmount || 0).toLocaleString()} z -> รับเงินคืน & ประมูลสู้ต่อที่ ${Number(ev.newBid || 0).toLocaleString()} z`
      });
      recordHistoryEvent({
        listingId: lid,
        itemId: ev.itemId,
        itemName: ev.itemName,
        refine: ev.refine || 0,
        qty: ev.qty || 1,
        icon: ev.icon || null,
        action: 'rebid',
        buyPriceTotal: ev.newBid,
        buyUnitPrice: Math.round((Number(ev.newBid) || 0) / Math.max(1, Number(ev.qty) || 1)),
        cleanRefUnitPrice: ev.cleanRefUnitPrice || 0,
        relistUnitPrice: ev.flipUnitPrice || 0,
        expectedNetProfit: ev.expectedNetProfit || 0,
        buyerProfileId: scr.profileId,
        buyerCharName: scr.charName || scr.profileName,
        note: `รับเงินคืน ${Number(ev.refund || 0).toLocaleString()} z และประมูลทับที่ ${Number(ev.newBid || 0).toLocaleString()} z`
      });
    } else if (ev.type === 'outbid_stopped') {
      state.stats.totalRefundedCount = (state.stats.totalRefundedCount || 0) + 1;
      upsertActiveBid({
        listingId: lid,
        itemId: ev.itemId,
        itemName: ev.itemName,
        refine: ev.refine || 0,
        qty: ev.qty || 1,
        icon: ev.icon || null,
        currentBid: ev.outbidAmount || 0,
        maxBidCapTotal: ev.maxBidCapTotal || 0,
        cleanRefUnitPrice: ev.cleanRefUnitPrice || 0,
        flipUnitPrice: ev.flipUnitPrice || 0,
        buyerProfileId: scr.profileId,
        buyerCharName: scr.charName || scr.profileName,
        status: 'outbid_stopped',
        lastEventNote: `หยุดสู้ราคา (ราคา ${Number(ev.outbidAmount || 0).toLocaleString()} z เกินเพดาน ${Number(ev.maxBidCapTotal || 0).toLocaleString()} z) — รับเงินคืนแล้ว`
      });
      recordHistoryEvent({
        listingId: lid,
        itemId: ev.itemId,
        itemName: ev.itemName,
        refine: ev.refine || 0,
        qty: ev.qty || 1,
        icon: ev.icon || null,
        action: 'outbid_refund',
        buyPriceTotal: ev.outbidAmount || 0,
        buyUnitPrice: Math.round((Number(ev.outbidAmount) || 0) / Math.max(1, Number(ev.qty) || 1)),
        cleanRefUnitPrice: ev.cleanRefUnitPrice || 0,
        relistUnitPrice: ev.flipUnitPrice || 0,
        expectedNetProfit: 0,
        buyerProfileId: scr.profileId,
        buyerCharName: scr.charName || scr.profileName,
        note: `คู่แข่งประมูล ${Number(ev.outbidAmount || 0).toLocaleString()} z เกินเพดานกำไร — กดรับเงินคืน ${Number(ev.refund || 0).toLocaleString()} z เข้ากระเป๋าแล้ว`
      });
    } else if (ev.type === 'won_and_relisted' || ev.type === 'won_claimed') {
      state.stats.totalWonOrBought = (state.stats.totalWonOrBought || 0) + 1;
      if (ev.relisted) {
        state.stats.totalRelisted = (state.stats.totalRelisted || 0) + 1;
        state.stats.totalEstimatedNetProfit = (state.stats.totalEstimatedNetProfit || 0) + (Number(ev.expectedNetProfit) || 0);
      } else if (config.mode === 'auto_flip') {
        enqueuePendingFlip({
          listingId: lid,
          itemId: ev.itemId,
          itemName: ev.itemName,
          refine: ev.refine || 0,
          qty: ev.qty || 1,
          icon: ev.icon || null,
          buyPriceTotal: ev.buyPriceTotal || 0,
          cleanRefUnitPrice: ev.cleanRefUnitPrice || 0,
          flipUnitPrice: ev.flipUnitPrice || 0,
          relistPriceTotal: ev.relistPriceTotal || 0,
          expectedNetProfit: ev.expectedNetProfit || 0,
          buyerProfileId: scr.profileId,
          buyerCharName: scr.charName || scr.profileName
        });
      }
      const evictedText = ev.evictedItemName ? ` (ถอด ${ev.evictedItemName} @ ${Number(ev.evictedItemPrice || 0).toLocaleString()} z ออกชั่วคราว)` : '';
      upsertActiveBid({
        listingId: lid,
        itemId: ev.itemId,
        itemName: ev.itemName,
        refine: ev.refine || 0,
        qty: ev.qty || 1,
        icon: ev.icon || null,
        currentBid: ev.buyPriceTotal || 0,
        cleanRefUnitPrice: ev.cleanRefUnitPrice || 0,
        flipUnitPrice: ev.flipUnitPrice || 0,
        expectedNetProfit: ev.expectedNetProfit || 0,
        buyerProfileId: scr.profileId,
        buyerCharName: scr.charName || scr.profileName,
        status: ev.relisted ? 'relisted' : (config.mode === 'auto_flip' ? 'queued_flip' : 'won'),
        relistedPrice: ev.relistPriceTotal || 0,
        lastEventNote: ev.relisted
          ? `ชนะประมูล & ตั้งขายกลับที่ ${Number(ev.relistPriceTotal || 0).toLocaleString()} z สำเร็จ!${evictedText}`
          : (config.mode === 'auto_flip' ? `ชนะประมูล & รับของแล้ว — ⏳ เข้าคิวรอช่องตลาดว่างเพื่อตั้งขายอัตโนมัติ` : `ชนะประมูล & รับของเข้ากระเป๋าแล้ว`)
      });
      recordHistoryEvent({
        listingId: lid,
        itemId: ev.itemId,
        itemName: ev.itemName,
        refine: ev.refine || 0,
        qty: ev.qty || 1,
        icon: ev.icon || null,
        action: ev.relisted ? 'relisted' : 'won',
        buyPriceTotal: ev.buyPriceTotal || 0,
        buyUnitPrice: Math.round((Number(ev.buyPriceTotal) || 0) / Math.max(1, Number(ev.qty) || 1)),
        cleanRefUnitPrice: ev.cleanRefUnitPrice || 0,
        relistPriceTotal: ev.relistPriceTotal || 0,
        relistUnitPrice: ev.flipUnitPrice || 0,
        expectedNetProfit: ev.expectedNetProfit || 0,
        buyerProfileId: scr.profileId,
        buyerCharName: scr.charName || scr.profileName,
        note: ev.relisted
          ? `ชนะประมูลที่ ${Number(ev.buyPriceTotal || 0).toLocaleString()} z -> ตั้งขายกลับ ${Number(ev.relistPriceTotal || 0).toLocaleString()} z (คาดการณ์กำไรสุทธิ +${Number(ev.expectedNetProfit || 0).toLocaleString()} z)${evictedText}`
          : (config.mode === 'auto_flip' ? `ชนะประมูลที่ ${Number(ev.buyPriceTotal || 0).toLocaleString()} z -> รอช่องตลาดว่างเพื่อตั้งขายกลับอัตโนมัติ` : `ชนะประมูลที่ ${Number(ev.buyPriceTotal || 0).toLocaleString()} z และรับของเข้าตัวเรียบร้อย`)
      });
    }
  }

  // Pick the richest eligible online screen to execute a buy or bid
  // Rotates to the next richest screen when the #1 screen's market slots are full of high-profit items (> 50,000 z),
  // and returns null (pauses buying) when all eligible screens are full so items are never hoarded in bags.
  function selectRichestBuyerProfile(onlineScreens, requiredAmount, existingListingId = 0, requiredQty = 1, requireFreeSlot = false, isSingleUnit = false) {
    const allowedSet = new Set(Array.isArray(config.allowedBuyerProfileIds) ? config.allowedBuyerProfileIds : []);
    const lock = existingListingId ? listingLocks.get(Number(existingListingId)) : null;
    const slotsNeeded = isSingleUnit ? Math.min(2, Math.max(1, Number(requiredQty) || 1)) : 1;

    // Count slots reserved by currently leading 5-minute auctions on each profile
    const leadingBidsByProfile = {};
    for (const b of (state.activeBids || [])) {
      if (b && b.status === 'leading' && b.buyerProfileId && Number(b.listingId) !== Number(existingListingId)) {
        const pid = String(b.buyerProfileId);
        const bSlots = isSingleUnitFlipItem(b.itemName) ? Math.min(2, Math.max(1, Number(b.qty) || 1)) : 1;
        leadingBidsByProfile[pid] = (leadingBidsByProfile[pid] || 0) + bSlots;
      }
    }

    const candidates = onlineScreens.filter(s => {
      if (!s || !s.connected || s.busy) return false;
      if (s.baseLevel > 0 && s.baseLevel < 10) return false;
      if (allowedSet.size > 0 && !allowedSet.has(String(s.profileId))) return false;
      if (requireFreeSlot) {
        const freeNow = Math.max(0, (Number(s.maxListings) || 20) - (Number(s.activeCount) || 0));
        const evictable = Number(s.evictableCheapCount) || 0;
        const reservedLeading = leadingBidsByProfile[String(s.profileId)] || 0;
        const usableSlots = Math.max(0, freeNow + evictable - reservedLeading);
        if (usableSlots < slotsNeeded) return false;
      }
      if (s.weightLimit > 0) {
        const freeW = s.weightLimit * 0.85 - (Number(s.weight) || 0);
        if (freeW < Math.min(350, Math.max(20, requiredQty))) return false;
      }
      const rawZeny = Number(s.zeny) || 0;
      // Primary rich screens (>= 5M z) keep full config.minReserveZeny; secondary screens (< 5M z) keep 150,000 z reserve so they can take over when main screen is full
      const effectiveReserve = rawZeny >= 5000000
        ? (Number(config.minReserveZeny) || 0)
        : Math.min(Number(config.minReserveZeny) || 0, 150000);
      const spendable = rawZeny - effectiveReserve;
      return spendable >= requiredAmount;
    });

    if (!candidates.length) return null;

    // If a screen already holds the lock for this listingId and still has slots & budget, keep using the same screen
    if (lock && lock.buyerProfileId) {
      const same = candidates.find(c => String(c.profileId) === String(lock.buyerProfileId));
      if (same) return same;
    }

    // Sort by: 1) Premium first (4% tax vs 8%, 20 slots vs 3), 2) Highest Zeny
    candidates.sort((a, b) => {
      if (Boolean(a.premium) !== Boolean(b.premium)) return a.premium ? -1 : 1;
      return (Number(b.zeny) || 0) - (Number(a.zeny) || 0);
    });

    return candidates[0];
  }

  // Fetch 24h & 7d market history + cheapest active listings for an item via an online screen
  async function fetchItemReferencePrice(screen, item, activeListings, ourCharNamesSet = null) {
    const itemId = Number(item.itemId ?? item.id);
    const refine = Number(item.refine) || 0;
    const itemName = String(item.name || '').trim();
    const cacheKey = `${itemId}:${refine}`;
    if (isNpcVendorTrashItem(item)) {
      const rejectEntry = {
        cacheVer: PRICE_CACHE_VER,
        itemId,
        refine,
        name: itemName || `Item #${itemId}`,
        valid: false,
        reason: 'npc_trash_drop',
        cleanRefUnitPrice: 0,
        flipUnitPrice: 0,
        totalSales: 0,
        sales24h: 0,
        sales7d: 0,
        recentCount: 0,
        clusterCount: 0,
        uniqueBuyNowSellersCount: 0,
        updatedAt: Date.now()
      };
      state.priceCache[cacheKey] = rejectEntry;
      return rejectEntry;
    }
    const cached = state.priceCache[cacheKey];
    if (cached && cached.cacheVer === PRICE_CACHE_VER && (Date.now() - (Number(cached.updatedAt) || 0)) < PRICE_CACHE_TTL_MS) {
      // Re-adjust flipUnitPrice against latest normal active listings if available (never above cleanRefUnitPrice)
      const sameItemListings = (Array.isArray(activeListings) ? activeListings : []).filter(
        l => l && l.item && Number(l.item.itemId ?? l.item.id) === itemId && (Number(l.item.refine) || 0) === refine
      );
      if (cached.valid && sameItemListings.length > 0) {
        const now = Date.now();
        const isOurs = (l) => Boolean(l.mine || (ourCharNamesSet && l.sellerName && ourCharNamesSet.has(String(l.sellerName).trim().toLowerCase())));
        const normalActives = sameItemListings
          .filter(l => !isOurs(l) && !(l.auctionEndsAt && Number(l.auctionEndsAt) > now))
          .map(l => Math.round((Number(l.price) || 0) / Math.max(1, Number(l.qty) || 1)))
          .filter(u => u >= Math.round(cached.cleanRefUnitPrice * 0.78) && u <= cached.cleanRefUnitPrice)
          .sort((a, b) => a - b);
        if (normalActives.length > 0) {
          cached.flipUnitPrice = Math.min(
            cached.cleanRefUnitPrice,
            Math.max(
              Math.round(cached.cleanRefUnitPrice * 0.82),
              normalActives[0] - Math.max(0, Number(config.relistUndercutZeny) || 0)
            )
          );
        }
      }
      return cached;
    }

    const code = `(async () => {
      const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
      if (!room || !room.connection || !room.connection.isOpen) return { ok: false };
      const cfg = window.__marketFilterConfig || {};
      const shared = typeof window.pauseSniper === 'function';
      const saved = { autoBuy: cfg.autoBuy, sniperAlert: cfg.sniperAlert };
      if (shared) window.pauseSniper(); else { cfg.autoBuy = false; cfg.sniperAlert = false; }
      try {
        const fetchHist = (range) => new Promise(resolve => {
          let unsub;
          const t = setTimeout(() => { if (unsub) unsub(); resolve(null); }, 3200);
          unsub = room.onMessage('market_history', msg => {
            if (msg && Number(msg.itemId) === ${itemId}) {
              clearTimeout(t);
              if (unsub) unsub();
              resolve(msg);
            }
          });
          room.send('market', { op: 'history', itemId: ${itemId}, refine: ${refine}, range });
        });
        const fetchCheapestActives = async () => {
          const qName = ${JSON.stringify(itemName)};
          if (!qName) return [];
          const collected = [];
          for (let pg = 0; pg < 3; pg++) {
            const pageMsg = await new Promise(resolve => {
              let unsub;
              const t = setTimeout(() => { if (unsub) unsub(); resolve(null); }, 2200);
              unsub = room.onMessage('market_results', msg => {
                clearTimeout(t);
                if (unsub) unsub();
                resolve(msg || null);
              });
              room.send('market', { op: 'search', filters: { q: qName, sort: 'price_asc', page: pg } });
            });
            const list = (pageMsg && Array.isArray(pageMsg.listings)) ? pageMsg.listings : [];
            for (const l of list) {
              if (l && l.item && Number(l.item.itemId ?? l.item.id) === ${itemId} && (Number(l.item.refine) || 0) === ${refine}) {
                collected.push(l);
              }
            }
            const pageCount = Number(pageMsg && pageMsg.pageCount) || 0;
            if (collected.length >= 6 || list.length < 20 || (pageCount > 0 && pg + 1 >= pageCount)) {
              break;
            }
            await new Promise(r => setTimeout(r, 90));
          }
          return collected;
        };
        const h24 = await fetchHist('24h');
        await new Promise(r => setTimeout(r, 120));
        const h7d = await fetchHist('7d');
        await new Promise(r => setTimeout(r, 120));
        const itemActives = await fetchCheapestActives();
        return { ok: true, h24, h7d, itemActives };
      } finally {
        if (shared) window.resumeSniper();
        else setTimeout(() => { cfg.autoBuy = saved.autoBuy; cfg.sniperAlert = saved.sniperAlert; }, 300);
      }
    })()`;

    const res = await evalProfilePort(screen.debugPort, code, 9000);
    if (!res || !(res.success || res.ok) || !res.result || !res.result.ok) return null;

    const mergedMap = new Map();
    for (const src of [activeListings, res.result.itemActives]) {
      if (!Array.isArray(src)) continue;
      for (const l of src) {
        if (!l || !l.item) continue;
        if (Number(l.item.itemId ?? l.item.id) === itemId && (Number(l.item.refine) || 0) === refine) {
          mergedMap.set(Number(l.listingId) || Math.random(), l);
        }
      }
    }
    const sameItemListings = Array.from(mergedMap.values());

    const calc = computeCleanReferencePrice(
      res.result.h24,
      res.result.h7d,
      sameItemListings,
      config.relistUndercutZeny,
      ourCharNamesSet,
      item
    );

    const entry = {
      cacheVer: PRICE_CACHE_VER,
      itemId,
      refine,
      name: item.name || `Item #${itemId}`,
      valid: calc.valid,
      reason: calc.reason || null,
      cleanRefUnitPrice: calc.cleanRefUnitPrice || 0,
      flipUnitPrice: calc.flipUnitPrice || 0,
      totalSales: calc.totalSales || 0,
      sales24h: calc.sales24h || 0,
      sales7d: calc.sales7d || 0,
      recentCount: calc.recentCount || 0,
      clusterCount: calc.clusterCount || 0,
      uniqueBuyNowSellersCount: calc.uniqueBuyNowSellersCount || 0,
      minCleanSold: calc.minCleanSold || 0,
      maxCleanSold: calc.maxCleanSold || 0,
      updatedAt: Date.now()
    };

    state.priceCache[cacheKey] = entry;
    sanitizeHistoricalState();
    return entry;
  }

  // Install the real-time auction listener & execute bid/buy on the selected richest screen
  async function executeSnipeOnBuyerScreen(buyerScreen, listing, valuation) {
    const lid = Number(listing.listingId);
    const it = listing.item || {};
    const itemId = Number(it.itemId ?? it.id);
    const refine = Number(it.refine) || 0;
    const itemName = String(it.name || `Item #${itemId}`);
    const qty = Math.max(1, Number(listing.qty) || 1);
    const now = Date.now();
    const inAuction = Boolean(listing.auctionEndsAt && Number(listing.auctionEndsAt) > now);

    const payload = {
      listingId: lid,
      itemId,
      refine,
      itemName,
      qty,
      singleUnit: isSingleUnitFlipItem(it),
      icon: it.icon || null,
      inAuction,
      auctionEndsAt: Number(listing.auctionEndsAt) || 0,
      actionAmount: valuation.acquireTotalCost,
      maxBidCapTotal: valuation.maxBidCapTotal,
      cleanRefUnitPrice: valuation.cleanRefUnitPrice,
      flipUnitPrice: valuation.flipUnitPrice,
      relistPriceTotal: valuation.flipTotal,
      expectedNetProfit: valuation.expectedNetProfit,
      relistDurationHours: config.relistDurationHours,
      autoFlip: config.mode === 'auto_flip',
      minReserveZeny: config.minReserveZeny
    };

    const execCode = `(async () => {
      const p = ${JSON.stringify(payload)};
      const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
      if (!room || !room.connection || !room.connection.isOpen) return { success: false, error: 'ไม่ได้เชื่อมต่อห้องเกม' };

      if (!window.__pmSniperAuctions) window.__pmSniperAuctions = {};
      if (!window.__pmSniperHandledDeliveries) window.__pmSniperHandledDeliveries = new Set();
      if (!Array.isArray(window.__pmSniperEvents)) window.__pmSniperEvents = [];

      ${buildSniperClaimAndFlipRuntimeJs()}
      if (p.itemName && window.__pmSniperProtectedItems) {
        window.__pmSniperProtectedItems.add(String(p.itemName).trim().toLowerCase());
      }

      // Install real-time Colyseus listeners once per room (using market_badge + market_mine)
      if (room !== window.__pmSniperHookedRoom) {
        window.__pmSniperHookedRoom = room;

        room.onMessage('market_badge', (msg) => {
          if (msg && Number(msg.pending) > 0) {
            try { room.send('market', { op: 'mine' }); } catch (_) {}
          }
        });

        room.onMessage('market_mine', async (msg) => {
          if (!msg) return;
          if (Array.isArray(msg.active)) {
            window.__myMarketActiveCount = msg.active.length;
            window.__myMarketActiveCountUpdatedAt = Date.now();
          }
          const deliveries = Array.isArray(msg.deliveries) ? msg.deliveries.filter(d => d && !d.held) : [];
          if (!deliveries.length) return;

          // Collect all non-held deliveries (outbid refunds, won auctions, bought items) immediately
          try {
            room.send('market', { op: 'collect_all' });
          } catch (_) {}

          for (const d of deliveries) {
            const did = d.deliveryId || (d.reason + ':' + (d.name || '') + ':' + (d.zeny || 0));
            if (window.__pmSniperHandledDeliveries.has(did)) continue;
            window.__pmSniperHandledDeliveries.add(did);

            const activeAuctions = Object.values(window.__pmSniperAuctions || {});
            if (!activeAuctions.length) continue;

            if (d.reason === 'outbid') {
              const dNameLower = String(d.name || '').trim().toLowerCase();
              const tracked = activeAuctions.find(a => a && dNameLower.includes(String(a.itemName || '').trim().toLowerCase()));
              if (!tracked) continue;
              const lid = Number(tracked.listingId);
              const refundZeny = Number(d.zeny) || tracked.lastBidAmount || 0;
              console.log('%c[PmheeAether Sniper] 💰 โดนปาดประมูล ' + tracked.itemName + ' -> รับเงินประมูลคืน ' + refundZeny.toLocaleString() + ' z เข้ากระเป๋าทันที!', 'color: #f59e0b; font-weight: bold;');

              if (tracked.auctionEndsAt && Date.now() >= tracked.auctionEndsAt) {
                delete window.__pmSniperAuctions[lid];
                continue;
              }

              // Query live listing to check new minBid / topBid
              const searchRes = await new Promise(resolve => {
                let unsub;
                const t = setTimeout(() => { if (unsub) unsub(); resolve(null); }, 2500);
                unsub = room.onMessage('market_results', m => { clearTimeout(t); if (unsub) unsub(); resolve(m); });
                room.send('market', { op: 'search', filters: { q: tracked.itemName, sort: 'price_asc', page: 0 } });
              });
              const liveListing = searchRes && Array.isArray(searchRes.listings)
                ? searchRes.listings.find(x => x && Number(x.listingId) === lid)
                : null;
              if (!liveListing) {
                delete window.__pmSniperAuctions[lid];
                continue;
              }
              const outbidAmount = Number(liveListing.topBid || liveListing.price) || refundZeny;
              const nextBid = Number(liveListing.minBid) || Math.max(outbidAmount + 1, Math.ceil(outbidAmount * 1.01));

              if (nextBid <= tracked.maxBidCapTotal) {
                await new Promise(r => setTimeout(r, 450));
                const curZeny = (typeof window.__currentZeny === 'number') ? window.__currentZeny : 0;
                if (curZeny === 0 || (curZeny - tracked.minReserveZeny) >= nextBid) {
                  try {
                    room.send('market', { op: 'bid', listingId: lid, amount: nextBid });
                    tracked.lastBidAmount = nextBid;
                    const netRev = tracked.relistPriceTotal - Math.floor(tracked.relistPriceTotal * 4 / 100);
                    const newProfit = netRev - nextBid;
                    console.log('%c[PmheeAether Sniper] 🔨 ประมูลสู้ต่อทันที! ' + tracked.itemName + ' ที่ ' + nextBid.toLocaleString() + ' z (เพดาน ' + tracked.maxBidCapTotal.toLocaleString() + ' z)', 'color: #38bdf8; font-weight: bold;');
                    window.__pmSniperEvents.push({
                      type: 'outbid_rebid',
                      listingId: lid,
                      itemId: tracked.itemId,
                      itemName: tracked.itemName,
                      refine: tracked.refine,
                      qty: tracked.qty,
                      icon: tracked.icon,
                      outbidAmount,
                      refund: refundZeny,
                      newBid: nextBid,
                      cleanRefUnitPrice: tracked.cleanRefUnitPrice,
                      flipUnitPrice: tracked.flipUnitPrice,
                      expectedNetProfit: newProfit
                    });
                  } catch (_) {}
                }
              } else {
                console.log('%c[PmheeAether Sniper] ⏹️ หยุดสู้ราคา ' + tracked.itemName + ' (ราคา ' + outbidAmount.toLocaleString() + ' z เกินเพดานกำไร ' + tracked.maxBidCapTotal.toLocaleString() + ' z) — รับเงินคืนเรียบร้อย', 'color: #f87171; font-weight: bold;');
                delete window.__pmSniperAuctions[lid];
                window.__pmSniperEvents.push({
                  type: 'outbid_stopped',
                  listingId: lid,
                  itemId: tracked.itemId,
                  itemName: tracked.itemName,
                  refine: tracked.refine,
                  qty: tracked.qty,
                  icon: tracked.icon,
                  outbidAmount,
                  refund: refundZeny,
                  maxBidCapTotal: tracked.maxBidCapTotal,
                  cleanRefUnitPrice: tracked.cleanRefUnitPrice,
                  flipUnitPrice: tracked.flipUnitPrice
                });
              }
            } else if (d.reason === 'won') {
              const dItemId = d.item ? Number(d.item.itemId ?? d.item.id) : 0;
              const dNameLower = String((d.item && d.item.name) || d.name || '').trim().toLowerCase();
              const tracked = activeAuctions.find(a => a && (Number(a.itemId) === dItemId || dNameLower.includes(String(a.itemName || '').trim().toLowerCase())));
              if (!tracked) continue;
              const lid = Number(tracked.listingId);
              delete window.__pmSniperAuctions[lid];
              const finalPrice = tracked.lastBidAmount || tracked.actionAmount;
              console.log('%c[PmheeAether Sniper] 🏆 ชนะการประมูล! ' + tracked.itemName + ' ที่ราคา ' + finalPrice.toLocaleString() + ' z -> กำลังรับของและตั้งขายทำกำไร...', 'color: #10b981; font-weight: bold; font-size: 13px;');
              const flipOut = await window.__pmSniperClaimAndFlip(tracked, finalPrice, 250);
              const relisted = Boolean(flipOut && (flipOut.relisted || flipOut === true));
              const netRev = tracked.relistPriceTotal - Math.floor(tracked.relistPriceTotal * 4 / 100);
              window.__pmSniperEvents.push({
                type: relisted ? 'won_and_relisted' : 'won_claimed',
                relisted,
                evictedItemName: flipOut && flipOut.evictedItemName ? flipOut.evictedItemName : null,
                evictedItemPrice: flipOut && flipOut.evictedItemPrice ? flipOut.evictedItemPrice : 0,
                listingId: lid,
                itemId: tracked.itemId,
                itemName: tracked.itemName,
                refine: tracked.refine,
                qty: tracked.qty,
                icon: tracked.icon,
                buyPriceTotal: finalPrice,
                cleanRefUnitPrice: tracked.cleanRefUnitPrice,
                flipUnitPrice: tracked.flipUnitPrice,
                relistPriceTotal: tracked.relistPriceTotal,
                expectedNetProfit: netRev - finalPrice
              });
            }
          }
        });
      }

      if (p.inAuction) {
        window.__pmSniperAuctions[p.listingId] = Object.assign({}, p, { lastBidAmount: p.actionAmount });
        room.send('market', { op: 'bid', listingId: p.listingId, amount: p.actionAmount });
        console.log('%c[PmheeAether Sniper] 🔨 ส่งคำสั่งประมูล: ' + p.itemName + ' x' + p.qty + ' ที่ ' + p.actionAmount.toLocaleString() + ' z (ขายจริง ~' + p.relistPriceTotal.toLocaleString() + ' z)', 'color: #facc15; font-weight: bold; font-size: 13px;');
        return { success: true, mode: 'bid', amount: p.actionAmount };
      } else {
        const zenyBefore = (typeof window.__currentZeny === 'number') ? window.__currentZeny : 0;
        room.send('market', { op: 'buy', listingId: p.listingId, price: p.actionAmount });
        console.log('%c[PmheeAether Sniper] ⚡ ส่งคำสั่งช้อนซื้อทันที: ' + p.itemName + ' x' + p.qty + ' ที่ ' + p.actionAmount.toLocaleString() + ' z!', 'color: #10b981; font-weight: bold; font-size: 13px;');
        const flipOut = await window.__pmSniperClaimAndFlip(p, p.actionAmount, 750);
        const relisted = Boolean(flipOut && (flipOut.relisted || flipOut === true));
        const zenyAfter = (typeof window.__currentZeny === 'number') ? window.__currentZeny : zenyBefore;
        return {
          success: true,
          mode: 'buy',
          amount: p.actionAmount,
          relisted,
          evictedItemName: flipOut && flipOut.evictedItemName ? flipOut.evictedItemName : null,
          evictedItemPrice: flipOut && flipOut.evictedItemPrice ? flipOut.evictedItemPrice : 0,
          zenyBefore,
          zenyAfter
        };
      }
    })()`;

    const res = await evalProfilePort(buyerScreen.debugPort, execCode, 10500);
    return (res && (res.success || res.ok) && res.result) ? res.result : { success: false, error: 'คำสั่งไม่ตอบกลับ' };
  }

  // Main scan cycle
  async function runScanCycle(manualTrigger = false) {
    if (!config.enabled && !manualTrigger) return { skipped: true, reason: 'disabled' };
    if (isScanningTick) return { skipped: true, reason: 'already_scanning' };
    if (typeof isBusy === 'function' && isBusy() && !manualTrigger) return { skipped: true, reason: 'manager_busy' };

    isScanningTick = true;
    try {
      const onlineScreens = await getOnlineScreenStates();
      const nonBusyScreens = onlineScreens.filter(s => !s.busy);
      if (!nonBusyScreens.length) {
        return { skipped: true, reason: 'no_online_screens' };
      }

      // If in auto_flip mode and EVERY buyer-eligible screen (>= 300k Zeny) has 0 usable slots (all slots full of high-profit items > 50k z),
      // pause scanning/buying until existing items sell and open up a slot.
      if (config.mode === 'auto_flip' && !manualTrigger) {
        const anyBuyerReady = selectRichestBuyerProfile(onlineScreens, 50000, 0, 1, true, false);
        if (!anyBuyerReady) {
          lastScanSummary = {
            at: Date.now(),
            scannerProfileId: '-',
            scannerName: 'รอของขายออก',
            filterLabel: '⏸️ ช่องขายเต็มทุกจอที่มีงบ — พักรอของขายออกก่อนค่อยช้อนต่อ',
            listingsCount: 0,
            evaluatedCount: 0,
            pausedAllScreensFull: true
          };
          return { skipped: true, reason: 'all_screens_full', summary: lastScanSummary };
        }
      }

      const filterQueue = buildSearchFilterQueue();
      if (!filterQueue.length) {
        return { skipped: true, reason: 'no_categories_enabled' };
      }

      const nowSearchTs = Date.now();
      const lv10Screens = nonBusyScreens.filter(s => (Number(s.baseLevel) || 0) >= 10);
      const poolScreens = lv10Screens.length > 0 ? lv10Screens : nonBusyScreens;
      const underCapScreens = [];
      for (let i = 0; i < poolScreens.length; i++) {
        const s = poolScreens[(scannerCursor + i) % poolScreens.length];
        const pid = String(s.profileId || s.debugPort || '');
        const hist = (searchHistoryByProfile.get(pid) || []).filter(ts => nowSearchTs - ts < 3600000);
        searchHistoryByProfile.set(pid, hist);
        if (hist.length < MAX_SEARCHES_PER_HOUR_PER_PROFILE) {
          underCapScreens.push({ screen: s, count: hist.length, pid });
        }
      }
      if (!underCapScreens.length) {
        return { skipped: true, reason: 'hourly_search_cap_reached' };
      }
      underCapScreens.sort((a, b) => a.count - b.count);
      const scanner = underCapScreens[0].screen;
      const scannerPid = underCapScreens[0].pid;
      scannerCursor = (scannerCursor + 1) % Math.max(1, poolScreens.length);
      const curHist = searchHistoryByProfile.get(scannerPid) || [];
      curHist.push(nowSearchTs);
      searchHistoryByProfile.set(scannerPid, curHist);

      const targetSearch = filterQueue[filterCursor % filterQueue.length];
      filterCursor = (filterCursor + 1) % Math.max(1, filterQueue.length);

      const searchCode = `(async () => {
        const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
        if (!room || !room.connection || !room.connection.isOpen) return { ok: false };
        const cfg = window.__marketFilterConfig || {};
        const shared = typeof window.pauseSniper === 'function';
        const saved = { autoBuy: cfg.autoBuy, sniperAlert: cfg.sniperAlert };
        if (shared) window.pauseSniper(); else { cfg.autoBuy = false; cfg.sniperAlert = false; }
        try {
          const res = await new Promise(resolve => {
            let unsub;
            const t = setTimeout(() => { if (unsub) unsub(); resolve(null); }, 3200);
            unsub = room.onMessage('market_results', msg => { clearTimeout(t); if (unsub) unsub(); resolve(msg); });
            room.send('market', { op: 'search', filters: ${JSON.stringify(targetSearch.filters)} });
          });
          if (!res || !Array.isArray(res.listings)) return { ok: false };
          const base = 'https://www.aetheria-online.in.th/art/icons/';
          const m = window.__itemIconManifest;
          const resolveIcon = (raw, name) => {
            const id = raw && (raw.itemId ?? raw.id);
            if (m && m.items && id !== undefined && m.items[id]) return base + m.items[id];
            const slug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            if (m && m.itemKeys && m.itemKeys[slug]) return base + m.itemKeys[slug];
            return slug ? base + 'items/' + slug + '.webp' : null;
          };
          res.listings.forEach(l => {
            if (l && l.item && !l.item.icon) l.item.icon = resolveIcon(l.item, l.item.name);
          });
          return { ok: true, total: res.total || 0, listings: res.listings };
        } finally {
          if (shared) window.resumeSniper();
          else setTimeout(() => { cfg.autoBuy = saved.autoBuy; cfg.sniperAlert = saved.sniperAlert; }, 300);
        }
      })()`;

      const scanRes = await evalProfilePort(scanner.debugPort, searchCode, 5000);
      state.stats.totalScans = (state.stats.totalScans || 0) + 1;

      if (!scanRes || !(scanRes.success || scanRes.ok) || !scanRes.result || !scanRes.result.ok) {
        return { ok: false, reason: 'search_timeout' };
      }

      const listings = scanRes.result.listings || [];
      lastScanSummary = {
        at: Date.now(),
        scannerProfileId: scanner.profileId,
        scannerName: scanner.charName || scanner.profileName,
        filterLabel: targetSearch.label,
        listingsCount: listings.length,
        evaluatedCount: 0,
        pausedAllScreensFull: false
      };

      const blacklist = getBlacklistSet();
      const watchlistLower = new Set(getWatchlistArray().map(s => s.toLowerCase()));
      const now = Date.now();
      let historyFetchesRemaining = 4; // Cap history RPCs per tick so scans stay fast

      // Build set of ALL our own characters' names and active listing IDs across all screens so we never snipe our own screens' listings
      const ourCharNamesSet = new Set();
      const ourActiveListingIds = new Set();
      for (const scr of onlineScreens) {
        if (!scr) continue;
        if (scr.charName) ourCharNamesSet.add(String(scr.charName).trim().toLowerCase());
        if (scr.profileName) ourCharNamesSet.add(String(scr.profileName).trim().toLowerCase());
        if (Array.isArray(scr.myActiveListings)) {
          for (const a of scr.myActiveListings) {
            if (a && a.listingId) ourActiveListingIds.add(Number(a.listingId));
          }
        }
      }

      // Prioritize items already in priceCache first, then cheapest unit price first
      const prioritizedListings = listings.slice().sort((a, b) => {
        const itA = (a && a.item) || {};
        const itB = (b && b.item) || {};
        const kA = `${Number(itA.itemId ?? itA.id)}:${Number(itA.refine) || 0}`;
        const kB = `${Number(itB.itemId ?? itB.id)}:${Number(itB.refine) || 0}`;
        const cA = state.priceCache[kA];
        const cB = state.priceCache[kB];
        const freshA = Boolean(cA && cA.cacheVer === PRICE_CACHE_VER && (now - (Number(cA.updatedAt) || 0)) < PRICE_CACHE_TTL_MS);
        const freshB = Boolean(cB && cB.cacheVer === PRICE_CACHE_VER && (now - (Number(cB.updatedAt) || 0)) < PRICE_CACHE_TTL_MS);
        if (freshA !== freshB) return freshA ? -1 : 1;
        const uA = Math.ceil((Number(a && (a.minBid || a.price)) || 0) / Math.max(1, Number(a && a.qty) || 1));
        const uB = Math.ceil((Number(b && (b.minBid || b.price)) || 0) / Math.max(1, Number(b && b.qty) || 1));
        return uA - uB;
      });

      for (const l of prioritizedListings) {
        if (!l || !l.item || l.mine) continue;
        const lid = Number(l.listingId);
        if (!lid || ourActiveListingIds.has(lid)) continue;
        if (l.sellerName && ourCharNamesSet.has(String(l.sellerName).trim().toLowerCase())) continue;

        const it = l.item;
        const itemId = Number(it.itemId ?? it.id);
        const refine = Number(it.refine) || 0;
        const itemName = String(it.name || '').trim();
        const itemNameLower = itemName.toLowerCase();
        if (!itemId || !itemName) continue;
        if (blacklist.has(itemNameLower)) continue;

        const cat = inferItemCategory(it);
        const isWatched = watchlistLower.has(itemNameLower);
        if (!isWatched && (!config.categories || !config.categories[cat])) continue;
        // Hard block: never auto-flip NPC vendor monster trash drops (e.g. Bog Hydra Fang, Magma Core, Sticky Mucus)
        if (!isWatched && isNpcVendorTrashItem(it)) continue;

        const qty = Math.max(1, Number(l.qty) || 1);
        const singleUnit = isSingleUnitFlipItem(it);
        // Never buy large card/stone stacks (> 3) because cards must be sold 1 by 1 and we must not hoard cards
        if (singleUnit && qty > 3) continue;

        // Prevent hoarding the same Card/Stone: if we already have >= 2 active listings or leading bids of this Card/Stone across screens, skip until they sell
        if (singleUnit && config.mode === 'auto_flip') {
          let activeSameCardCount = 0;
          for (const scr of onlineScreens) {
            if (scr && scr.activeNameCounts && scr.activeNameCounts[itemNameLower]) {
              activeSameCardCount += Number(scr.activeNameCounts[itemNameLower]) || 0;
            }
          }
          for (const b of (state.activeBids || [])) {
            if (b && b.status === 'leading' && Number(b.listingId) !== lid && String(b.itemName || '').trim().toLowerCase() === itemNameLower) {
              activeSameCardCount += Math.max(1, Number(b.qty) || 1);
            }
          }
          if (activeSameCardCount >= 2 || (activeSameCardCount + qty) > 3) {
            continue;
          }
        }

        const inAuction = Boolean(l.auctionEndsAt && Number(l.auctionEndsAt) > now);
        const acquireTotalCost = inAuction
          ? (Number(l.minBid) || (l.topBid ? Math.ceil(Number(l.topBid) * 1.01) : Number(l.price)) || Number(l.price))
          : Number(l.price);
        if (!acquireTotalCost || acquireTotalCost <= 0) continue;
        if (acquireTotalCost > config.maxSpendPerListing) continue;

        const acquireUnitCost = Math.ceil(acquireTotalCost / qty);

        // Check if we already locked/bid on this listing at this price or higher
        const existingLock = listingLocks.get(lid);
        if (existingLock && existingLock.lastBidAmount >= acquireTotalCost && (now - existingLock.lockedAt) < 6 * 60 * 1000) {
          continue;
        }

        const cacheKey = `${itemId}:${refine}`;
        let refInfo = state.priceCache[cacheKey];
        const cacheFresh = refInfo && refInfo.cacheVer === PRICE_CACHE_VER && (now - (Number(refInfo.updatedAt) || 0)) < PRICE_CACHE_TTL_MS;

        if (!cacheFresh) {
          if (historyFetchesRemaining <= 0) continue;
          historyFetchesRemaining -= 1;
          refInfo = await fetchItemReferencePrice(scanner, it, listings, ourCharNamesSet);
        }

        if (!refInfo || !refInfo.valid || refInfo.cleanRefUnitPrice <= 0) continue;
        if (refInfo.totalSales < config.minSalesVolume) continue;

        // Enforce strict anti-wash-trade liquidity minimums on stackables vs single-unit Cards/Stones
        const minSales24h = singleUnit ? 3 : 8;
        const minSales7d = singleUnit ? 12 : 25;
        const minClusterCnt = singleUnit ? 4 : 6;
        if ((Number(refInfo.sales24h) || 0) < minSales24h) continue;
        if ((Number(refInfo.sales7d) || 0) < minSales7d) continue;
        if ((Number(refInfo.clusterCount) || 0) < minClusterCnt) continue;

        // Cornered-market auction bait guard:
        // Scammers list 1-2 fake Buy-Now stacks at an inflated price and put a 3rd stack in a 5-min auction at 40% of that fake price.
        // For stackable items in a 5-min auction, unless 24h trade volume is very high (>= 30 trades/day),
        // require at least 3 distinct external Buy-Now sellers so a single scammer (or 2 accounts) cannot corner the book.
        if (inAuction && !singleUnit && (Number(refInfo.sales24h) || 0) < 30 && (Number(refInfo.uniqueBuyNowSellersCount) || 0) < 3) {
          continue;
        }

        lastScanSummary.evaluatedCount += 1;

        const maxAllowedRatio = inAuction ? (config.maxBidRatioPercent / 100) : (config.maxBuyRatioPercent / 100);
        const maxAllowedUnitCost = Math.floor(refInfo.cleanRefUnitPrice * maxAllowedRatio);
        if (acquireUnitCost > maxAllowedUnitCost) continue;

        // Calculate profit using richest candidate screen's tax rate (4% Premium, 8% Free)
        const buyerScreen = selectRichestBuyerProfile(onlineScreens, acquireTotalCost, lid, qty, config.mode === 'auto_flip', singleUnit);
        const taxPercent = (buyerScreen && buyerScreen.premium) ? 4 : 8;
        const flipUnitPrice = refInfo.flipUnitPrice;
        const flipTotal = flipUnitPrice * qty;
        const netRevenueTotal = flipTotal - Math.floor(flipTotal * taxPercent / 100);
        const expectedNetProfit = netRevenueTotal - acquireTotalCost;
        const expectedNetProfitPct = Math.round((expectedNetProfit / acquireTotalCost) * 100);

        if (expectedNetProfit < config.minNetProfitZeny) continue;
        if (expectedNetProfitPct < config.minNetProfitPercent) continue;

        // Compute Max Bid Cap for 5-minute auctions
        const maxBidByRatio = Math.floor(refInfo.cleanRefUnitPrice * qty * (config.maxBidRatioPercent / 100));
        const maxBidByProfit = netRevenueTotal - config.minNetProfitZeny;
        const maxBidCapTotal = Math.min(config.maxSpendPerListing, maxBidByRatio, maxBidByProfit);

        if (inAuction && acquireTotalCost > maxBidCapTotal) continue;

        const discountPct = Math.max(1, Math.round((1 - (acquireUnitCost / refInfo.cleanRefUnitPrice)) * 100));
        state.stats.totalOpportunitiesFound = (state.stats.totalOpportunitiesFound || 0) + 1;

        // Dry-run mode: log & show in UI without spending Zeny
        if (config.mode === 'dry_run') {
          listingLocks.set(lid, { buyerProfileId: 'dry_run', lockedAt: now, lastBidAmount: acquireTotalCost, maxBidCapTotal });
          upsertActiveBid({
            listingId: lid,
            itemId,
            itemName,
            refine,
            qty,
            icon: it.icon || null,
            sellerName: l.sellerName || '-',
            initialPrice: Number(l.price) || acquireTotalCost,
            currentBid: acquireTotalCost,
            maxBidCapTotal,
            cleanRefUnitPrice: refInfo.cleanRefUnitPrice,
            flipUnitPrice,
            expectedNetProfit,
            discountPct,
            buyerProfileId: buyerScreen ? buyerScreen.profileId : '-',
            buyerCharName: buyerScreen ? (buyerScreen.charName || buyerScreen.profileName) : 'โหมดจำลอง (Dry-Run)',
            auctionEndsAt: Number(l.auctionEndsAt) || 0,
            status: 'dry_run',
            lastEventNote: `[Dry-Run] พบของราคาหลุด -${discountPct}% (${acquireTotalCost.toLocaleString()} z vs ขายจริง ${flipTotal.toLocaleString()} z)`
          });
          recordHistoryEvent({
            listingId: lid,
            itemId,
            itemName,
            refine,
            qty,
            icon: it.icon || null,
            action: 'dry_run',
            buyPriceTotal: acquireTotalCost,
            buyUnitPrice: acquireUnitCost,
            cleanRefUnitPrice: refInfo.cleanRefUnitPrice,
            relistPriceTotal: flipTotal,
            relistUnitPrice: flipUnitPrice,
            expectedNetProfit,
            buyerProfileId: buyerScreen ? buyerScreen.profileId : '-',
            buyerCharName: buyerScreen ? (buyerScreen.charName || buyerScreen.profileName) : 'Dry-Run',
            note: `[โหมดจำลอง] ลดราคา -${discountPct}% (ขายออก ${refInfo.totalSales} ครั้งใน 7 วัน · กำไรสุทธิ +${expectedNetProfit.toLocaleString()} z)`
          });
          continue;
        }

        if (!buyerScreen) {
          continue;
        }

        // Lock listingId to this buyerScreen so no other screen competes
        listingLocks.set(lid, {
          buyerProfileId: buyerScreen.profileId,
          lockedAt: now,
          lastBidAmount: acquireTotalCost,
          maxBidCapTotal
        });

        const execResult = await executeSnipeOnBuyerScreen(buyerScreen, l, {
          acquireTotalCost,
          maxBidCapTotal,
          cleanRefUnitPrice: refInfo.cleanRefUnitPrice,
          flipUnitPrice,
          flipTotal,
          expectedNetProfit
        });

        if (execResult && execResult.success) {
          // Deduct from local Zeny snapshot so next item in same tick knows updated balance
          buyerScreen.zeny = Math.max(0, (Number(buyerScreen.zeny) || 0) - acquireTotalCost);

          if (inAuction) {
            state.stats.totalBidsPlaced = (state.stats.totalBidsPlaced || 0) + 1;
            upsertActiveBid({
              listingId: lid,
              itemId,
              itemName,
              refine,
              qty,
              icon: it.icon || null,
              sellerName: l.sellerName || '-',
              initialPrice: Number(l.price) || acquireTotalCost,
              currentBid: acquireTotalCost,
              maxBidCapTotal,
              cleanRefUnitPrice: refInfo.cleanRefUnitPrice,
              flipUnitPrice,
              expectedNetProfit,
              discountPct,
              buyerProfileId: buyerScreen.profileId,
              buyerCharName: buyerScreen.charName || buyerScreen.profileName,
              auctionEndsAt: Number(l.auctionEndsAt) || 0,
              status: 'leading',
              lastEventNote: `ประมูลนำอยู่ที่ ${acquireTotalCost.toLocaleString()} z (เพดานสู้ ${maxBidCapTotal.toLocaleString()} z)`
            });
            recordHistoryEvent({
              listingId: lid,
              itemId,
              itemName,
              refine,
              qty,
              icon: it.icon || null,
              action: 'bid',
              buyPriceTotal: acquireTotalCost,
              buyUnitPrice: acquireUnitCost,
              cleanRefUnitPrice: refInfo.cleanRefUnitPrice,
              relistPriceTotal: flipTotal,
              relistUnitPrice: flipUnitPrice,
              expectedNetProfit,
              buyerProfileId: buyerScreen.profileId,
              buyerCharName: buyerScreen.charName || buyerScreen.profileName,
              note: `เข้าประมูล (-${discountPct}% จากราคาจริง ${refInfo.cleanRefUnitPrice.toLocaleString()} z/ชิ้น · เพดานสู้สูงสุด ${maxBidCapTotal.toLocaleString()} z)`
            });
          } else {
            state.stats.totalWonOrBought = (state.stats.totalWonOrBought || 0) + 1;
            const evictedNote = execResult.evictedItemName
              ? ` (ถอด ${execResult.evictedItemName} @ ${Number(execResult.evictedItemPrice || 0).toLocaleString()} z ออก)`
              : '';
            if (execResult.relisted) {
              const slotsUsed = singleUnit ? Math.min(2, qty) : 1;
              if (execResult.evictedItemName) {
                buyerScreen.evictableCheapCount = Math.max(0, (Number(buyerScreen.evictableCheapCount) || 0) - slotsUsed);
              }
              buyerScreen.activeCount = Math.min(buyerScreen.maxListings || 20, (Number(buyerScreen.activeCount) || 0) + (execResult.evictedItemName ? 0 : slotsUsed));
              if (buyerScreen.activeNameCounts) {
                buyerScreen.activeNameCounts[itemNameLower] = (buyerScreen.activeNameCounts[itemNameLower] || 0) + slotsUsed;
              }
              state.stats.totalRelisted = (state.stats.totalRelisted || 0) + 1;
              state.stats.totalEstimatedNetProfit = (state.stats.totalEstimatedNetProfit || 0) + expectedNetProfit;
            } else if (config.mode === 'auto_flip' && execResult.foundInBag !== false) {
              enqueuePendingFlip({
                listingId: lid,
                itemId,
                itemName,
                refine,
                qty,
                icon: it.icon || null,
                buyPriceTotal: acquireTotalCost,
                cleanRefUnitPrice: refInfo.cleanRefUnitPrice,
                flipUnitPrice,
                relistPriceTotal: flipTotal,
                expectedNetProfit,
                buyerProfileId: buyerScreen.profileId,
                buyerCharName: buyerScreen.charName || buyerScreen.profileName
              });
            }
            upsertActiveBid({
              listingId: lid,
              itemId,
              itemName,
              refine,
              qty,
              icon: it.icon || null,
              sellerName: l.sellerName || '-',
              initialPrice: acquireTotalCost,
              currentBid: acquireTotalCost,
              maxBidCapTotal,
              cleanRefUnitPrice: refInfo.cleanRefUnitPrice,
              flipUnitPrice,
              expectedNetProfit,
              discountPct,
              buyerProfileId: buyerScreen.profileId,
              buyerCharName: buyerScreen.charName || buyerScreen.profileName,
              auctionEndsAt: 0,
              status: execResult.relisted ? 'relisted' : (config.mode === 'auto_flip' ? 'queued_flip' : 'bought'),
              relistedPrice: execResult.relisted ? flipTotal : 0,
              lastEventNote: execResult.relisted
                ? `ช้อนซื้อทันที & ตั้งขายกลับที่ ${flipUnitPrice.toLocaleString()} z/ชิ้น สำเร็จ!${evictedNote}`
                : (config.mode === 'auto_flip' ? `ช้อนซื้อแล้ว — ⏳ รอช่องตลาดว่างเพื่อตั้งขายกลับอัตโนมัติ` : `ช้อนซื้อทันที & รับของเข้ากระเป๋าแล้ว`)
            });
            recordHistoryEvent({
              listingId: lid,
              itemId,
              itemName,
              refine,
              qty,
              icon: it.icon || null,
              action: execResult.relisted ? 'relisted' : 'buy',
              buyPriceTotal: acquireTotalCost,
              buyUnitPrice: acquireUnitCost,
              cleanRefUnitPrice: refInfo.cleanRefUnitPrice,
              relistPriceTotal: flipTotal,
              relistUnitPrice: flipUnitPrice,
              expectedNetProfit,
              buyerProfileId: buyerScreen.profileId,
              buyerCharName: buyerScreen.charName || buyerScreen.profileName,
              note: execResult.relisted
                ? `ช้อนซื้อขาดที่ ${acquireTotalCost.toLocaleString()} z -> ตั้งขายกลับ ${flipUnitPrice.toLocaleString()} z/ชิ้น (กำไรสุทธิ +${expectedNetProfit.toLocaleString()} z)${evictedNote}`
                : (config.mode === 'auto_flip' ? `ช้อนซื้อที่ ${acquireTotalCost.toLocaleString()} z -> เข้าคิวรอช่องตลาดว่างเพื่อตั้งขายกลับอัตโนมัติ` : `ช้อนซื้อขาดที่ ${acquireTotalCost.toLocaleString()} z และรับของเข้าตัวเรียบร้อย`)
            });
          }
        }
      }

      savePersistedState(state);
      return { ok: true, summary: lastScanSummary };
    } finally {
      isScanningTick = false;
    }
  }

  // Periodic maintenance:
  // 1) Settle ended 5-minute auctions
  // 2) Process Pending Flip Queue
  // 3) Unstack any stacked Card/Stone listings (qty > 1 -> qty: 1 per slot) & proactively evict cheap filler items (<= 50,000 z) when Sniper screens are near full
  async function runMaintenanceCycle() {
    if (!config.enabled || isMaintenanceTick) return;
    isMaintenanceTick = true;
    try {
      const now = Date.now();
      const profiles = (typeof loadProfiles === 'function' ? loadProfiles() : []) || [];

      // 1) Settle ended 5-minute auctions
      const expiredLeads = state.activeBids.filter(
        b => b && b.status === 'leading' && b.auctionEndsAt > 0 && now > (Number(b.auctionEndsAt) + 3000)
      );

      if (expiredLeads.length > 0) {
        const byProfile = new Map();
        for (const bid of expiredLeads) {
          const pid = String(bid.buyerProfileId || '');
          if (!pid) continue;
          if (!byProfile.has(pid)) byProfile.set(pid, []);
          byProfile.get(pid).push(bid);
        }

        for (const [pid, bids] of byProfile.entries()) {
          const prof = profiles.find(p => p && String(p.id) === pid && p.debugPort);
          if (!prof) continue;

          for (const bid of bids) {
            const settleCode = `(async () => {
              const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
              if (!room || !room.connection || !room.connection.isOpen) return { ok: false };
              ${buildSniperClaimAndFlipRuntimeJs()}
              const lid = ${Number(bid.listingId)};
              if (window.__pmSniperAuctions && window.__pmSniperAuctions[lid]) {
                delete window.__pmSniperAuctions[lid];
              }
              if (typeof window.__pmSniperClaimAndFlip === 'function') {
                const flipOut = await window.__pmSniperClaimAndFlip({
                  itemId: ${Number(bid.itemId)},
                  refine: ${Number(bid.refine) || 0},
                  itemName: ${JSON.stringify(bid.itemName || '')},
                  qty: ${Number(bid.qty) || 1},
                  singleUnit: ${isSingleUnitFlipItem(bid.itemName || '')},
                  flipUnitPrice: ${Number(bid.flipUnitPrice) || 0},
                  relistPriceTotal: ${Number(bid.flipUnitPrice || 0) * Math.max(1, Number(bid.qty) || 1)},
                  relistDurationHours: ${Number(config.relistDurationHours) || 24},
                  autoFlip: ${config.mode === 'auto_flip'}
                }, ${Number(bid.currentBid) || 0});
                const relisted = Boolean(flipOut && (flipOut.relisted || flipOut === true));
                const foundInBag = flipOut && flipOut.foundInBag !== undefined ? Boolean(flipOut.foundInBag) : relisted;
                return {
                  ok: true,
                  relisted,
                  foundInBag,
                  evictedItemName: flipOut && flipOut.evictedItemName ? flipOut.evictedItemName : null,
                  evictedItemPrice: flipOut && flipOut.evictedItemPrice ? flipOut.evictedItemPrice : 0
                };
              } else {
                try { room.send('market', { op: 'collect_all' }); } catch (_) {}
                return { ok: true, relisted: false, foundInBag: false };
              }
            })()`;

            const r = await evalProfilePort(prof.debugPort, settleCode, 7500);
            if (r && (r.success || r.ok) && r.result && r.result.ok) {
              const relisted = Boolean(r.result.relisted);
              const foundInBag = Boolean(r.result.foundInBag);
              const flipTotal = (Number(bid.flipUnitPrice) || 0) * Math.max(1, Number(bid.qty) || 1);
              const evictedNote = r.result.evictedItemName
                ? ` (ถอด ${r.result.evictedItemName} @ ${Number(r.result.evictedItemPrice || 0).toLocaleString()} z ออก)`
                : '';
              if (relisted) {
                state.stats.totalWonOrBought = (state.stats.totalWonOrBought || 0) + 1;
                state.stats.totalRelisted = (state.stats.totalRelisted || 0) + 1;
                state.stats.totalEstimatedNetProfit = (state.stats.totalEstimatedNetProfit || 0) + (Number(bid.expectedNetProfit) || 0);
              } else if (foundInBag && config.mode === 'auto_flip') {
                enqueuePendingFlip({
                  listingId: bid.listingId,
                  itemId: bid.itemId,
                  itemName: bid.itemName,
                  refine: bid.refine || 0,
                  qty: bid.qty || 1,
                  icon: bid.icon || null,
                  buyPriceTotal: bid.currentBid || 0,
                  cleanRefUnitPrice: bid.cleanRefUnitPrice || 0,
                  flipUnitPrice: bid.flipUnitPrice || 0,
                  relistPriceTotal: flipTotal,
                  expectedNetProfit: bid.expectedNetProfit || 0,
                  buyerProfileId: bid.buyerProfileId,
                  buyerCharName: bid.buyerCharName
                });
              }
              upsertActiveBid({
                listingId: bid.listingId,
                status: relisted ? 'relisted' : (foundInBag ? (config.mode === 'auto_flip' ? 'queued_flip' : 'won') : 'outbid_stopped'),
                relistedPrice: relisted ? flipTotal : 0,
                lastEventNote: relisted
                  ? `หมดเวลาประมูล 5 นาที -> รับของ & ตั้งขายกลับที่ ${Number(bid.flipUnitPrice || flipTotal).toLocaleString()} z/ชิ้น สำเร็จ!${evictedNote}`
                  : (foundInBag
                    ? (config.mode === 'auto_flip' ? `หมดเวลาประมูล 5 นาที -> รับของแล้ว (รอช่องว่างเพื่อตั้งขายกลับ)` : `หมดเวลาประมูล 5 นาที -> กดรับของเข้ากระเป๋าเรียบร้อย`)
                    : `หมดเวลาประมูล 5 นาที -> โดนปาดเกินเพดาน & รับเงินคืนเรียบร้อย`)
              });
              if (relisted) {
                recordHistoryEvent({
                  listingId: bid.listingId,
                  itemId: bid.itemId,
                  itemName: bid.itemName,
                  refine: bid.refine || 0,
                  qty: bid.qty || 1,
                  icon: bid.icon || null,
                  action: 'relisted',
                  buyPriceTotal: bid.currentBid,
                  buyUnitPrice: Math.round((Number(bid.currentBid) || 0) / Math.max(1, Number(bid.qty) || 1)),
                  cleanRefUnitPrice: bid.cleanRefUnitPrice || 0,
                  relistPriceTotal: flipTotal,
                  relistUnitPrice: bid.flipUnitPrice || 0,
                  expectedNetProfit: bid.expectedNetProfit || 0,
                  buyerProfileId: bid.buyerProfileId,
                  buyerCharName: bid.buyerCharName,
                  note: `ครบ 5 นาที ชนะประมูลที่ ${Number(bid.currentBid || 0).toLocaleString()} z -> ตั้งขายกลับ ${Number(bid.flipUnitPrice || flipTotal).toLocaleString()} z/ชิ้น${evictedNote}`
                });
              }
            }
          }
        }
      }

      // Reconcile any orphaned 'queued_flip' entries in state.activeBids that are missing from state.pendingFlips
      if (config.mode === 'auto_flip' && Array.isArray(state.activeBids)) {
        if (!Array.isArray(state.pendingFlips)) state.pendingFlips = [];
        const pendingIds = new Set(state.pendingFlips.map(pf => Number(pf && pf.listingId)).filter(Boolean));
        for (const b of state.activeBids) {
          if (!b || b.status !== 'queued_flip') continue;
          const lid = Number(b.listingId) || 0;
          if (lid > 0 && !pendingIds.has(lid) && (now - (Number(b.updatedAt || b.createdAt) || 0)) < 6 * 3600 * 1000) {
            const flipTotal = (Number(b.flipUnitPrice) || 0) * Math.max(1, Number(b.qty) || 1);
            enqueuePendingFlip({
              listingId: lid,
              itemId: b.itemId,
              itemName: b.itemName,
              refine: b.refine || 0,
              qty: b.qty || 1,
              icon: b.icon || null,
              buyPriceTotal: b.currentBid || 0,
              cleanRefUnitPrice: b.cleanRefUnitPrice || 0,
              flipUnitPrice: b.flipUnitPrice || 0,
              relistPriceTotal: flipTotal,
              expectedNetProfit: b.expectedNetProfit || 0,
              buyerProfileId: b.buyerProfileId,
              buyerCharName: b.buyerCharName
            });
            pendingIds.add(lid);
          }
        }
      }

      // 2) Process Pending Flip Queue (items waiting for a free market slot)
      if (config.mode === 'auto_flip' && Array.isArray(state.pendingFlips) && state.pendingFlips.length > 0) {
        const remainingQueue = [];
        for (const item of state.pendingFlips) {
          if (!item || (now - (Number(item.queuedAt) || now)) > 6 * 3600 * 1000) continue; // expire after 6h
          const prof = profiles.find(p => p && String(p.id) === String(item.buyerProfileId) && p.debugPort);
          if (!prof) {
            remainingQueue.push(item);
            continue;
          }

          const retryCode = `(async () => {
            const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
            if (!room || !room.connection || !room.connection.isOpen) return { ok: false };
            ${buildSniperClaimAndFlipRuntimeJs()}
            if (typeof window.__pmSniperClaimAndFlip !== 'function') return { ok: false };
            const flipOut = await window.__pmSniperClaimAndFlip({
              itemId: ${Number(item.itemId)},
              refine: ${Number(item.refine) || 0},
              itemName: ${JSON.stringify(item.itemName || '')},
              qty: ${Number(item.qty) || 1},
              singleUnit: ${isSingleUnitFlipItem(item.itemName || '')},
              flipUnitPrice: ${Number(item.flipUnitPrice) || 0},
              relistPriceTotal: ${Number(item.relistPriceTotal) || (Number(item.flipUnitPrice || 0) * Math.max(1, Number(item.qty) || 1))},
              relistDurationHours: ${Number(config.relistDurationHours) || 24},
              autoFlip: true
            }, ${Number(item.buyPriceTotal) || 0}, -1);
            const relisted = Boolean(flipOut && (flipOut.relisted || flipOut === true));
            const foundInBag = flipOut && flipOut.foundInBag !== undefined ? Boolean(flipOut.foundInBag) : relisted;
            return {
              ok: true,
              relisted,
              foundInBag,
              evictedItemName: flipOut && flipOut.evictedItemName ? flipOut.evictedItemName : null,
              evictedItemPrice: flipOut && flipOut.evictedItemPrice ? flipOut.evictedItemPrice : 0
            };
          })()`;

          const rr = await evalProfilePort(prof.debugPort, retryCode, 7500);
          if (rr && (rr.success || rr.ok) && rr.result && rr.result.relisted) {
            const flipTotal = Number(item.relistPriceTotal) || ((Number(item.flipUnitPrice) || 0) * Math.max(1, Number(item.qty) || 1));
            const evictedNote = rr.result.evictedItemName
              ? ` (ถอด ${rr.result.evictedItemName} @ ${Number(rr.result.evictedItemPrice || 0).toLocaleString()} z ออก)`
              : '';
            state.stats.totalRelisted = (state.stats.totalRelisted || 0) + 1;
            state.stats.totalEstimatedNetProfit = (state.stats.totalEstimatedNetProfit || 0) + (Number(item.expectedNetProfit) || 0);
            upsertActiveBid({
              listingId: item.listingId,
              status: 'relisted',
              relistedPrice: flipTotal,
              lastEventNote: `ช่องตลาดว่างแล้ว -> ตั้งขายกลับจากคิวรอที่ ${Number(item.flipUnitPrice || flipTotal).toLocaleString()} z/ชิ้น สำเร็จ!${evictedNote}`
            });
            recordHistoryEvent({
              listingId: item.listingId,
              itemId: item.itemId,
              itemName: item.itemName,
              refine: item.refine || 0,
              qty: item.qty || 1,
              icon: item.icon || null,
              action: 'relisted',
              buyPriceTotal: item.buyPriceTotal,
              buyUnitPrice: Math.round((Number(item.buyPriceTotal) || 0) / Math.max(1, Number(item.qty) || 1)),
              cleanRefUnitPrice: item.cleanRefUnitPrice || 0,
              relistPriceTotal: flipTotal,
              relistUnitPrice: item.flipUnitPrice || 0,
              expectedNetProfit: item.expectedNetProfit || 0,
              buyerProfileId: item.buyerProfileId,
              buyerCharName: item.buyerCharName,
              note: `ตั้งขายกลับจากคิวรอสำเร็จที่ ${Number(item.flipUnitPrice || flipTotal).toLocaleString()} z/ชิ้น (กำไรสุทธิ +${Number(item.expectedNetProfit || 0).toLocaleString()} z)${evictedNote}`
            });
          } else if (rr && (rr.success || rr.ok) && rr.result && rr.result.ok && rr.result.foundInBag === false) {
            // Item is not in bag (e.g. auction was outbid/refunded or already sold manually) -> drop from pendingFlips
            upsertActiveBid({
              listingId: item.listingId,
              status: 'outbid_stopped',
              lastEventNote: `ไม่ได้รับไอเทม (โดนปาดหรือขายออกแล้ว) — นำออกจากคิวรอ`
            });
          } else {
            remainingQueue.push(item);
          }
        }
        state.pendingFlips = remainingQueue;
      }

      // 3) Auto-split stacked Cards/Stones & oversized Sniper-flipped stacks, drip-restock split batches from bag, and evict cheap (<= 50,000 z) filler listings
      if (config.mode === 'auto_flip') {
        const onlineScreens = await getOnlineScreenStates();
        const flippedByProfile = new Map();
        const registerProfileFlip = (pid, itemName, itemId, refine, unitPrice, buyTotal = 0, lotQty = 1) => {
          const pKey = String(pid || '');
          const nm = String(itemName || '').trim().toLowerCase();
          if (!pKey || !nm) return;
          if (!flippedByProfile.has(pKey)) flippedByProfile.set(pKey, new Map());
          const buyU = buyTotal > 0 ? Math.round(Number(buyTotal) / Math.max(1, Number(lotQty) || 1)) : 0;
          const minFloor = buyU > 0 ? Math.ceil(buyU / 0.96) : 0;
          const trueRef = getTrueRefUnitPrice(itemId, refine || 0, itemName, unitPrice);
          const rawSafeU = (trueRef > 0 && Number(unitPrice) > Math.round(trueRef * 1.25))
            ? trueRef
            : (Number(unitPrice) || trueRef);
          const safeU = Math.max(rawSafeU, minFloor);
          if (safeU > 0) {
            flippedByProfile.get(pKey).set(nm, safeU);
          }
        };
        for (const h of (state.history || []).slice().reverse()) {
          if (h && (h.action === 'relisted' || h.action === 'buy' || h.action === 'won')) {
            registerProfileFlip(h.buyerProfileId, h.itemName, h.itemId, h.refine, h.relistUnitPrice || h.listedUnitPrice || h.cleanRefUnitPrice, h.buyPriceTotal, h.qty);
          }
        }
        for (const b of (state.activeBids || [])) {
          if (b && (b.status === 'relisted' || b.status === 'queued_flip' || b.status === 'won' || b.status === 'bought')) {
            registerProfileFlip(b.buyerProfileId, b.itemName, b.itemId, b.refine, b.flipUnitPrice || b.listedUnitPrice || b.cleanRefUnitPrice, b.currentBid, b.qty);
          }
        }

        for (const scr of onlineScreens) {
          if (!scr || scr.busy || (Number(scr.zeny) || 0) < 300000) continue;

          // 3a) Split 1 stacked Card/Stone or oversized Sniper-flipped stack per tick (e.g. Enriched Elunium x999 -> 3x 100, Glyph Leather x815 -> 3x 50, Enchant Rune x189 -> 3x 25, Cards -> 2x 1)
          if (Array.isArray(scr.stackedCards) && scr.stackedCards.length > 0) {
            const stCard = scr.stackedCards[0];
            const unstackCode = `(async () => {
              const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
              if (!room || !room.connection || !room.connection.isOpen) return { ok: false };
              const st = ${JSON.stringify(stCard)};
              const hours = ${Number(config.relistDurationHours) || 24};
              const norm = String(st.name || '').trim().toLowerCase();
              const batchQty = Math.max(1, Number(st.batchQty) || 1);
              const maxConcurrent = Math.max(1, Number(st.maxConcurrent) || (batchQty === 1 ? 2 : 3));
              if (!window.__pmSniperProtectedItems) window.__pmSniperProtectedItems = new Set();
              if (norm) window.__pmSniperProtectedItems.add(norm);
              if (!window.__pmSeenCancelledClosedIds) window.__pmSeenCancelledClosedIds = new Set();

              // Query live active listings so we know how many slots are free and can evict cheap (<= 50k z) filler items if needed
              const mineMsg = await new Promise(resolve => {
                let unsub;
                const t = setTimeout(() => { if (unsub) unsub(); resolve(null); }, 2200);
                unsub = room.onMessage('market_mine', m => { clearTimeout(t); if (unsub) unsub(); resolve(m); });
                try { room.send('market', { op: 'mine' }); } catch (_) { clearTimeout(t); if (unsub) unsub(); resolve(null); }
              });
              const activeList = (mineMsg && Array.isArray(mineMsg.active)) ? mineMsg.active : [];
              const nowTs = Date.now();
              const otherSameActive = activeList.filter(a => a && Number(a.listingId) !== Number(st.listingId) && String((a.item && a.item.name) || '').trim().toLowerCase() === norm).length;
              const toPostCount = Math.max(0, Math.min(Math.max(0, maxConcurrent - otherSameActive), Math.ceil((Number(st.qty) || 1) / batchQty)));
              const cheapEvictable = activeList
                .filter(a => a && Number(a.listingId) !== Number(st.listingId) && !(a.auctionEndsAt && Number(a.auctionEndsAt) > nowTs) && Number(a.price) > 0 && Number(a.price) <= 50000)
                .sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));

              // Cancel the oversized stack listing first
              window.__pmSeenCancelledClosedIds.add(Number(st.listingId));
              try { room.send('market', { op: 'cancel', listingId: Number(st.listingId) }); } catch (_) {}
              await new Promise(r => setTimeout(r, 380));

              // Cancel up to 2 cheap <= 50k items so we have room to split into individual batches
              if (!window.__pmSniperEvictedItemNames) window.__pmSniperEvictedItemNames = new Set();
              if (!window.__autoSellRuleBackoffUntil) window.__autoSellRuleBackoffUntil = {};
              const evictedNames = [];
              for (const ce of cheapEvictable.slice(0, Math.max(0, toPostCount - 1))) {
                const ceName = (ce.item && ce.item.name) || 'Item';
                const ceNorm = String(ceName).trim().toLowerCase();
                evictedNames.push(ceName);
                window.__pmSniperEvictedItemNames.add(ceNorm);
                window.__autoSellRuleBackoffUntil[ceNorm] = Date.now() + 30 * 60 * 1000;
                window.__pmSeenCancelledClosedIds.add(Number(ce.listingId));
                try { room.send('market', { op: 'cancel', listingId: Number(ce.listingId) }); } catch (_) {}
                await new Promise(r => setTimeout(r, 320));
              }

              try { room.send('market', { op: 'collect_all' }); } catch (_) {}
              await new Promise(r => setTimeout(r, 850));

              // List up to toPostCount split batches of batchQty each at st.unitPrice
              let posted = 0;
              let postedUnits = 0;
              const unitP = Math.max(1, Number(st.unitPrice) || 1);
              for (let u = 0; u < toPostCount; u++) {
                const bag = (typeof window.getBagItems === 'function') ? window.getBagItems() : [];
                const candidates = bag
                  .filter(b => b && !b.locked && String(b.name || '').trim().toLowerCase() === norm && (Number(b.qty) || 0) >= 1)
                  .sort((a, b) => (Number(b.qty) || 1) - (Number(a.qty) || 1));
                const targetSlot = candidates[0];
                if (!targetSlot) break;
                const beforeQty = Number(targetSlot.qty) || 1;
                const qtyThisPost = (batchQty > 1 && beforeQty <= Math.ceil(batchQty * 1.20))
                  ? beforeQty
                  : Math.min(batchQty, beforeQty);
                if (qtyThisPost <= 0) break;
                const priceThisPost = unitP * qtyThisPost;
                window.__pmExplicitHoursOnce = true;
                try {
                  room.send('market', {
                    op: 'list',
                    slot: Number(targetSlot.slot),
                    qty: qtyThisPost,
                    price: priceThisPost,
                    hours
                  });
                } finally {
                  window.__pmExplicitHoursOnce = false;
                }
                let okOne = false;
                for (let w = 0; w < 8; w++) {
                  await new Promise(r => setTimeout(r, 250));
                  const nowBag = (typeof window.getBagItems === 'function') ? window.getBagItems() : [];
                  const nowSlot = nowBag.find(x => Number(x.slot) === Number(targetSlot.slot));
                  const left = nowSlot ? (Number(nowSlot.qty) || 0) : 0;
                  if (left <= beforeQty - qtyThisPost) {
                    okOne = true;
                    posted += 1;
                    postedUnits += qtyThisPost;
                    break;
                  }
                }
                if (!okOne) break;
                await new Promise(r => setTimeout(r, 320));
              }
              try { room.send('market', { op: 'mine' }); } catch (_) {}
              console.log('%c[PmheeAether Sniper] 📦 แยกกอง ' + st.name + ' x' + st.qty + ' -> ตั้งขายแยกกองละ x' + batchQty + ' (' + posted + ' ช่อง รวม ' + postedUnits + ' ชิ้น @ ' + unitP.toLocaleString() + ' z/ชิ้น)!', 'color: #10b981; font-weight: bold;');
              return { ok: true, posted, postedUnits, evictedNames };
            })()`;

            await evalProfilePort(scr.debugPort, unstackCode, 9500);
            break; // Process 1 unstack operation per maintenance cycle
          }

          // 3b) Drip-restock remaining split batches from bag when existing batches sell (curActiveSame < maxConcurrent)
          const profFlippedMap = flippedByProfile.get(String(scr.profileId || ''));
          if (profFlippedMap && Array.isArray(scr.bagFlippedItems) && scr.bagFlippedItems.length > 0) {
            let didRestock = false;
            for (const bagItem of scr.bagFlippedItems) {
              if (!bagItem || !bagItem.nameLower) continue;
              const flipUnit = profFlippedMap.get(bagItem.nameLower);
              if (!flipUnit || flipUnit <= 0) continue;
              const bCfg = getSmartFlipBatchConfig(bagItem.nameLower, flipUnit, isSingleUnitFlipItem(bagItem.name));
              const minRestockQty = bCfg.batchQty === 1 ? 1 : Math.min(10, Math.max(2, Math.floor(bCfg.batchQty * 0.2)));
              const unlockedBagQty = Number(bagItem.unlockedQty !== undefined ? bagItem.unlockedQty : bagItem.qty) || 0;
              if (unlockedBagQty < minRestockQty) continue;

              const curActiveSame = (scr.myActiveListings || []).filter(
                a => a && String(a.name || '').trim().toLowerCase() === bagItem.nameLower
              ).length;
              if (curActiveSame >= bCfg.maxConcurrent) continue;

              const restockCode = `(async () => {
                const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
                if (!room || !room.connection || !room.connection.isOpen) return { ok: false };
                ${buildSniperClaimAndFlipRuntimeJs()}
                if (typeof window.__pmSniperClaimAndFlip !== 'function') return { ok: false };
                const flipOut = await window.__pmSniperClaimAndFlip({
                  itemId: ${Number(bagItem.itemId) || 0},
                  refine: ${Number(bagItem.refine) || 0},
                  itemName: ${JSON.stringify(bagItem.name || '')},
                  qty: ${unlockedBagQty},
                  singleUnit: ${Boolean(bCfg.isSingle)},
                  batchQty: ${Number(bCfg.batchQty)},
                  maxConcurrent: ${Number(bCfg.maxConcurrent)},
                  flipUnitPrice: ${Number(flipUnit)},
                  relistPriceTotal: ${Number(flipUnit) * Math.max(1, unlockedBagQty)},
                  relistDurationHours: ${Number(config.relistDurationHours) || 24},
                  autoFlip: true,
                  isRestock: true,
                  skipSmartPriceFetch: true
                }, 0, -1);
                return { ok: true, relisted: Boolean(flipOut && flipOut.relisted), listedUnitsCount: Number(flipOut && flipOut.listedUnitsCount) || 0 };
              })()`;

              const rsRes = await evalProfilePort(scr.debugPort, restockCode, 7500);
              if (rsRes && (rsRes.success || rsRes.ok) && rsRes.result && rsRes.result.relisted) {
                didRestock = true;
                break;
              }
            }
            if (didRestock) break;
          }

          // 3c) If a rich Sniper screen (>= 500k zeny) has cheap <= 50,000 z items taking up slots and fewer than 5 free slots, evict up to 3 cheap items per tick
          const freeSlots = Math.max(0, (Number(scr.maxListings) || 20) - (Number(scr.activeCount) || 0));
          if ((Number(scr.zeny) || 0) >= 500000 && (Number(scr.evictableCheapCount) || 0) > 0 && freeSlots < 5) {
            const evictBatchCode = `(async () => {
              const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
              if (!room || !room.connection || !room.connection.isOpen) return { ok: false };
              const mineMsg = await new Promise(resolve => {
                let unsub;
                const t = setTimeout(() => { if (unsub) unsub(); resolve(null); }, 2200);
                unsub = room.onMessage('market_mine', m => { clearTimeout(t); if (unsub) unsub(); resolve(m); });
                try { room.send('market', { op: 'mine' }); } catch (_) { clearTimeout(t); if (unsub) unsub(); resolve(null); }
              });
              const activeList = (mineMsg && Array.isArray(mineMsg.active)) ? mineMsg.active : [];
              const nowTs = Date.now();
              const cheapEvictable = activeList
                .filter(a => a && a.listingId && !(a.auctionEndsAt && Number(a.auctionEndsAt) > nowTs) && Number(a.price) > 0 && Number(a.price) <= 50000)
                .sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
              if (!cheapEvictable.length) return { ok: true, evicted: 0 };

              if (!window.__pmSniperEvictedItemNames) window.__pmSniperEvictedItemNames = new Set();
              if (!window.__autoSellRuleBackoffUntil) window.__autoSellRuleBackoffUntil = {};
              if (!window.__pmSeenCancelledClosedIds) window.__pmSeenCancelledClosedIds = new Set();
              const toCancel = cheapEvictable.slice(0, 3);
              const names = [];
              for (const ce of toCancel) {
                const ceName = (ce.item && ce.item.name) || 'Item';
                const ceNorm = String(ceName).trim().toLowerCase();
                names.push(ceName + ' (' + Number(ce.price).toLocaleString() + ' z)');
                window.__pmSniperEvictedItemNames.add(ceNorm);
                window.__autoSellRuleBackoffUntil[ceNorm] = Date.now() + 30 * 60 * 1000;
                window.__pmSeenCancelledClosedIds.add(Number(ce.listingId));
                try { room.send('market', { op: 'cancel', listingId: Number(ce.listingId) }); } catch (_) {}
                await new Promise(r => setTimeout(r, 320));
              }
              try { room.send('market', { op: 'collect_all' }); } catch (_) {}
              await new Promise(r => setTimeout(r, 500));
              try { room.send('market', { op: 'mine' }); } catch (_) {}
              console.log('%c[PmheeAether Sniper] 🧹 ถอดไอเทมราคาถูกออก ' + toCancel.length + ' ชิ้น (' + names.join(', ') + ') เพื่อเตรียมช่องว่างสำหรับตั้งขายการ์ด/ของทำกำไร!', 'color: #f59e0b; font-weight: bold;');
              return { ok: true, evicted: toCancel.length, names };
            })()`;

            await evalProfilePort(scr.debugPort, evictBatchCode, 7500);
            break;
          }
        }
      }

      savePersistedState(state);
    } finally {
      isMaintenanceTick = false;
    }
  }

  function scheduleNextScan() {
    if (scanTimer) clearTimeout(scanTimer);
    const delayMs = Math.max(2000, (Number(config.scanIntervalSec) || 4) * 1000);
    scanTimer = setTimeout(async () => {
      try {
        await runScanCycle(false);
      } catch (e) {
        console.error('[MarketSniper] scan error:', e.message);
      }
      scheduleNextScan();
    }, delayMs);
  }

  // Reconcile Sniper purchases against live market active & sold listings across all screens
  // Separates:
  //   1) ✅ ขายออกแล้ว (Sold — ทุนไม่จม ได้ทุนคืนแล้ว + กำไรสุทธิเข้ากระเป๋าจริง)
  //   2) 📦 ยังค้าง Stock (In Stock — ทุนยังจมอยู่ในตลาด/กระเป๋า + มูลค่าและกำไรตามราคาตลาดคงที่จริง)
  function buildStockAndProfitBreakdown(onlineScreens) {
    const ourCharNamesSet = new Set();
    const onlineProfileIds = new Set();
    for (const scr of (onlineScreens || [])) {
      if (!scr) continue;
      if (scr.profileId) onlineProfileIds.add(String(scr.profileId));
      if (scr.charName) ourCharNamesSet.add(String(scr.charName).trim().toLowerCase());
      if (scr.profileName) ourCharNamesSet.add(String(scr.profileName).trim().toLowerCase());
    }

    // 1. Pool all live active, bag-held, & sold listings across online screens
    const activePool = [];
    const bagPool = [];
    const soldPool = [];
    for (const scr of (onlineScreens || [])) {
      if (!scr) continue;
      const pid = String(scr.profileId || '');
      const cname = scr.charName || scr.profileName || pid;
      const taxPct = scr.premium ? 4 : 8;
      if (Array.isArray(scr.myActiveListings)) {
        for (const a of scr.myActiveListings) {
          if (!a || !a.name) continue;
          const q = Math.max(1, Number(a.qty) || 1);
          activePool.push({
            profileId: pid,
            charName: cname,
            taxPct,
            listingId: Number(a.listingId) || 0,
            itemId: Number(a.itemId) || 0,
            refine: Number(a.refine) || 0,
            name: String(a.name).trim(),
            nameLower: String(a.name).trim().toLowerCase(),
            icon: a.icon || null,
            qty: q,
            remQty: q,
            price: Number(a.price) || 0,
            unitPrice: Math.max(1, Number(a.unitPrice) || Math.round((Number(a.price) || 0) / q)),
            expiresAt: Number(a.expiresAt) || 0
          });
        }
      }
      if (Array.isArray(scr.bagFlippedItems)) {
        for (const b of scr.bagFlippedItems) {
          if (!b || !b.nameLower || (Number(b.qty) || 0) <= 0) continue;
          const q = Math.max(1, Number(b.qty) || 1);
          bagPool.push({
            profileId: pid,
            charName: cname,
            itemId: Number(b.itemId) || 0,
            refine: Number(b.refine) || 0,
            name: String(b.name || '').trim(),
            nameLower: String(b.nameLower).trim(),
            qty: q,
            remQty: q,
            unitPrice: Number(b.unitPrice) || 0
          });
        }
      }
      if (Array.isArray(scr.mySoldListings)) {
        for (const s of scr.mySoldListings) {
          if (!s || !s.name) continue;
          const bNorm = String(s.buyerName || '').trim().toLowerCase();
          if (bNorm && ourCharNamesSet.has(bNorm)) continue; // Ignore accidental internal self-buys
          const q = Math.max(1, Number(s.qty) || 1);
          soldPool.push({
            profileId: pid,
            charName: cname,
            taxPct,
            listingId: Number(s.listingId) || 0,
            itemId: Number(s.itemId) || 0,
            refine: Number(s.refine) || 0,
            name: String(s.name).trim(),
            nameLower: String(s.name).trim().toLowerCase(),
            icon: s.icon || null,
            qty: q,
            remQty: q,
            price: Number(s.price) || 0,
            unitPrice: Math.max(1, Number(s.unitPrice) || Math.round((Number(s.price) || 0) / q)),
            buyerName: String(s.buyerName || ''),
            closedAt: Number(s.closedAt) || 0
          });
        }
      }
    }

    // 2. Collect unique Sniper acquired lots (relisted / bought / won)
    const lotsMap = new Map();
    const avgBuyUnitByName = {};
    const buySumByName = {};
    const buyQtyByName = {};

    for (const h of (state.history || []).slice().reverse()) {
      if (!h || !h.listingId || !h.itemName) continue;
      if (h.action === 'relisted' || h.action === 'buy' || h.action === 'won') {
        const lid = Number(h.listingId);
        const q = Math.max(1, Number(h.qty) || 1);
        const buyTot = Number(h.buyPriceTotal) || 0;
        const nmLower = String(h.itemName).trim().toLowerCase();
        if (buyTot > 0) {
          buySumByName[nmLower] = (buySumByName[nmLower] || 0) + buyTot;
          buyQtyByName[nmLower] = (buyQtyByName[nmLower] || 0) + q;
        }
        const origFromNote = extractOriginalListedUnitFromNote(h.note, q);
        const listedU = Number(h.listedUnitPrice || h.relistUnitPrice || origFromNote || h.cleanRefUnitPrice) || 0;
        lotsMap.set(lid, {
          listingId: lid,
          itemId: Number(h.itemId) || 0,
          itemName: String(h.itemName).trim(),
          nameLower: nmLower,
          refine: Number(h.refine) || 0,
          qty: q,
          icon: h.icon || null,
          buyPriceTotal: buyTot,
          buyUnitPrice: Math.max(1, Math.round(buyTot / q)),
          listedUnitPrice: listedU,
          initialListedUnitPrice: Number(h.initialListedUnitPrice || origFromNote || listedU) || 0,
          buyerProfileId: String(h.buyerProfileId || ''),
          buyerCharName: String(h.buyerCharName || ''),
          status: h.action === 'relisted' ? 'relisted' : 'won',
          at: Number(h.at) || 0
        });
      }
    }

    for (const b of (state.activeBids || [])) {
      if (!b || !b.listingId || !b.itemName) continue;
      if (b.status === 'relisted' || b.status === 'queued_flip' || b.status === 'won' || b.status === 'bought') {
        const lid = Number(b.listingId);
        const existing = lotsMap.get(lid) || {};
        const q = Math.max(1, Number(b.qty || existing.qty) || 1);
        const buyTot = Number(b.currentBid || existing.buyPriceTotal) || 0;
        const nmLower = String(b.itemName).trim().toLowerCase();
        if (!existing.listingId && buyTot > 0) {
          buySumByName[nmLower] = (buySumByName[nmLower] || 0) + buyTot;
          buyQtyByName[nmLower] = (buyQtyByName[nmLower] || 0) + q;
        }
        const listedU = Number(b.listedUnitPrice || b.flipUnitPrice || existing.listedUnitPrice || b.cleanRefUnitPrice) || 0;
        lotsMap.set(lid, {
          listingId: lid,
          itemId: Number(b.itemId || existing.itemId) || 0,
          itemName: String(b.itemName || existing.itemName).trim(),
          nameLower: nmLower,
          refine: Number(b.refine ?? existing.refine) || 0,
          qty: q,
          icon: b.icon || existing.icon || null,
          buyPriceTotal: buyTot,
          buyUnitPrice: Math.max(1, Math.round(buyTot / q)),
          listedUnitPrice: listedU,
          initialListedUnitPrice: Number(existing.initialListedUnitPrice || listedU) || 0,
          buyerProfileId: String(b.buyerProfileId || existing.buyerProfileId || ''),
          buyerCharName: String(b.buyerCharName || existing.buyerCharName || ''),
          status: b.status,
          at: Number(existing.at || b.updatedAt || b.createdAt) || 0
        });
      }
    }

    for (const [nm, sum] of Object.entries(buySumByName)) {
      const q = buyQtyByName[nm] || 1;
      avgBuyUnitByName[nm] = Math.round(sum / q);
    }

    // Sort lots newest first
    const lots = Array.from(lotsMap.values()).sort((a, b) => (b.at || 0) - (a.at || 0));
    const stockStateByListingId = new Map();

    const soldSummary = {
      lotsCount: 0,
      unitsCount: 0,
      costRecoveredZeny: 0,
      grossRevenueZeny: 0,
      netRevenueZeny: 0,
      realizedNetProfitZeny: 0
    };

    const inStockSummary = {
      lotsCount: 0,
      unitsCount: 0,
      costTiedUpZeny: 0,
      listedGrossZeny: 0,
      realisticGrossZeny: 0,
      realisticNetRevenueZeny: 0,
      realisticNetProfitZeny: 0,
      overpricedLotsCount: 0,
      overpricedUnitsCount: 0
    };

    const biddingSummary = {
      lotsCount: 0,
      tiedUpBidZeny: 0
    };

    for (const b of (state.activeBids || [])) {
      if (b && b.status === 'leading') {
        biddingSummary.lotsCount += 1;
        biddingSummary.tiedUpBidZeny += Number(b.currentBid) || 0;
      }
    }

    const byItemMap = new Map();
    const getOrCreateItemGroup = (itemName, itemId, refine, icon, trueRef) => {
      const key = String(itemName || '').trim().toLowerCase();
      if (!byItemMap.has(key)) {
        byItemMap.set(key, {
          itemName: String(itemName || '').trim(),
          itemId: Number(itemId) || 0,
          refine: Number(refine) || 0,
          icon: icon || null,
          trueRefUnitPrice: trueRef,
          soldLots: 0,
          soldUnits: 0,
          costRecoveredZeny: 0,
          soldGrossZeny: 0,
          soldNetRevenueZeny: 0,
          realizedNetProfitZeny: 0,
          inStockLots: 0,
          inStockUnits: 0,
          costTiedUpZeny: 0,
          listedGrossZeny: 0,
          realisticGrossZeny: 0,
          realisticNetProfitZeny: 0,
          overpricedLots: 0,
          overpricedUnits: 0,
          buyers: []
        });
      }
      const g = byItemMap.get(key);
      if (!g.icon && icon) g.icon = icon;
      if (trueRef > 0) g.trueRefUnitPrice = trueRef;
      return g;
    };

    const lotsList = [];
    const nowMs = Date.now();

    for (const lot of lots) {
      const trueRef = getTrueRefUnitPrice(lot.itemId, lot.refine, lot.itemName, lot.listedUnitPrice);
      const listedUnit = lot.listedUnitPrice || trueRef;
      const isOverpriced = trueRef > 0 && listedUnit > Math.round(trueRef * 1.25);

      let rem = lot.qty;
      let inStockUnits = 0;
      let activeMatchedUnitPrice = listedUnit;
      let soldUnits = 0;
      let soldGross = 0;
      const matchedBuyers = [];

      // Step A: If the buyer screen has a matching SOLD entry in `m.closed` after lot.at - 10min, match that first
      for (const s of soldPool) {
        if (rem <= 0) break;
        if (s.remQty <= 0 || s.nameLower !== lot.nameLower) continue;
        if (s.profileId === lot.buyerProfileId && Math.abs(s.unitPrice - listedUnit) <= Math.max(100, listedUnit * 0.15) && (!lot.at || !s.closedAt || s.closedAt >= lot.at - 600000)) {
          const take = Math.min(rem, s.remQty);
          s.remQty -= take;
          rem -= take;
          soldUnits += take;
          soldGross += s.unitPrice * take;
          if (s.buyerName && !matchedBuyers.includes(s.buyerName)) matchedBuyers.push(s.buyerName);
        }
      }

      // Step B: Match remaining units against activePool on the SAME buyerProfileId first (so one character's lot never steals another character's active stock)
      if (rem > 0 && lot.status !== 'queued_flip') {
        const sameProfCandidates = activePool
          .filter(a => a.remQty > 0 && a.nameLower === lot.nameLower && a.profileId === lot.buyerProfileId)
          .sort((a, b) => Math.abs(a.unitPrice - listedUnit) - Math.abs(b.unitPrice - listedUnit));
        for (const a of sameProfCandidates) {
          if (rem <= 0) break;
          const take = Math.min(rem, a.remQty);
          a.remQty -= take;
          rem -= take;
          inStockUnits += take;
          activeMatchedUnitPrice = a.unitPrice;
        }
      }

      // Step B2: Match remaining split units waiting in the buyer character's bag (`bagPool`) before drip-restock
      if (rem > 0) {
        for (const bg of bagPool) {
          if (rem <= 0) break;
          if (bg.remQty <= 0 || bg.nameLower !== lot.nameLower || bg.profileId !== lot.buyerProfileId) continue;
          const take = Math.min(rem, bg.remQty);
          bg.remQty -= take;
          rem -= take;
          inStockUnits += take;
        }
      }

      // Step C: Check broader soldPool on the same buyerProfileId (e.g. if the item was repriced before selling)
      if (rem > 0 && lot.status !== 'queued_flip') {
        for (const s of soldPool) {
          if (rem <= 0) break;
          if (s.remQty <= 0 || s.nameLower !== lot.nameLower || s.profileId !== lot.buyerProfileId) continue;
          if (!lot.at || !s.closedAt || s.closedAt >= lot.at - 600000) {
            const take = Math.min(rem, s.remQty);
            s.remQty -= take;
            rem -= take;
            soldUnits += take;
            soldGross += s.unitPrice * take;
            if (s.buyerName && !matchedBuyers.includes(s.buyerName)) matchedBuyers.push(s.buyerName);
          }
        }
      }

      // Step D: Remaining units not in activePool, bagPool, or soldPool
      if (rem > 0) {
        const buyerIsOnline = Boolean(lot.buyerProfileId && onlineProfileIds.has(lot.buyerProfileId));
        const isOfflineRecentLot = !buyerIsOnline && lot.at && ((nowMs - lot.at) < 36 * 3600 * 1000);
        if (lot.status === 'queued_flip' || isOverpriced || isOfflineRecentLot) {
          inStockUnits += rem;
          rem = 0;
        } else {
          // Units that already sold earlier and scrolled off m.closed: value them at their original listed price (never below break-even cost)
          const historicalSoldUnit = Math.max(
            Number(lot.initialListedUnitPrice) || 0,
            Number(listedUnit) || 0,
            Math.ceil((Number(lot.buyUnitPrice) || 0) / 0.96)
          );
          soldUnits += rem;
          soldGross += historicalSoldUnit * rem;
          rem = 0;
        }
      }

      const grp = getOrCreateItemGroup(lot.itemName, lot.itemId, lot.refine, lot.icon, trueRef);

      if (soldUnits > 0) {
        const soldCost = Math.round((lot.buyPriceTotal * soldUnits) / lot.qty);
        const soldNetRev = soldGross - Math.floor(soldGross * 4 / 100);
        const soldNetProfit = soldNetRev - soldCost;

        soldSummary.lotsCount += 1;
        soldSummary.unitsCount += soldUnits;
        soldSummary.costRecoveredZeny += soldCost;
        soldSummary.grossRevenueZeny += soldGross;
        soldSummary.netRevenueZeny += soldNetRev;
        soldSummary.realizedNetProfitZeny += soldNetProfit;

        grp.soldLots += 1;
        grp.soldUnits += soldUnits;
        grp.costRecoveredZeny += soldCost;
        grp.soldGrossZeny += soldGross;
        grp.soldNetRevenueZeny += soldNetRev;
        grp.realizedNetProfitZeny += soldNetProfit;
        for (const bn of matchedBuyers) {
          if (bn && !grp.buyers.includes(bn)) grp.buyers.push(bn);
        }
      }

      if (inStockUnits > 0) {
        const stockCost = Math.round((lot.buyPriceTotal * inStockUnits) / lot.qty);
        const listedGross = activeMatchedUnitPrice * inStockUnits;
        const realisticGross = (trueRef || activeMatchedUnitPrice) * inStockUnits;
        const realisticNetRev = realisticGross - Math.floor(realisticGross * 4 / 100);
        const realisticProfit = realisticNetRev - stockCost;
        const lotOverpriced = trueRef > 0 && activeMatchedUnitPrice > Math.round(trueRef * 1.25);

        inStockSummary.lotsCount += 1;
        inStockSummary.unitsCount += inStockUnits;
        inStockSummary.costTiedUpZeny += stockCost;
        inStockSummary.listedGrossZeny += listedGross;
        inStockSummary.realisticGrossZeny += realisticGross;
        inStockSummary.realisticNetRevenueZeny += realisticNetRev;
        inStockSummary.realisticNetProfitZeny += realisticProfit;
        if (lotOverpriced) {
          inStockSummary.overpricedLotsCount += 1;
          inStockSummary.overpricedUnitsCount += inStockUnits;
        }

        grp.inStockLots += 1;
        grp.inStockUnits += inStockUnits;
        grp.costTiedUpZeny += stockCost;
        grp.listedGrossZeny += listedGross;
        grp.realisticGrossZeny += realisticGross;
        grp.realisticNetProfitZeny += realisticProfit;
        if (lotOverpriced) {
          grp.overpricedLots += 1;
          grp.overpricedUnits += inStockUnits;
        }
      }

      const lotState = {
        listingId: lot.listingId,
        itemId: lot.itemId,
        itemName: lot.itemName,
        refine: lot.refine,
        icon: lot.icon,
        qty: lot.qty,
        soldUnits,
        inStockUnits,
        buyPriceTotal: lot.buyPriceTotal,
        buyUnitPrice: lot.buyUnitPrice,
        listedUnitPrice: activeMatchedUnitPrice,
        trueRefUnitPrice: trueRef,
        isOverpriced: Boolean(inStockUnits > 0 && trueRef > 0 && activeMatchedUnitPrice > Math.round(trueRef * 1.25)),
        stockState: soldUnits >= lot.qty ? 'sold' : (inStockUnits >= lot.qty ? 'in_stock' : 'partial'),
        buyers: matchedBuyers,
        buyerCharName: lot.buyerCharName,
        at: lot.at,
        realizedNetProfit: soldUnits > 0
          ? (soldGross - Math.floor(soldGross * 4 / 100) - Math.round((lot.buyPriceTotal * soldUnits) / lot.qty))
          : 0,
        realisticNetProfit: inStockUnits > 0
          ? (((trueRef || activeMatchedUnitPrice) * inStockUnits) - Math.floor(((trueRef || activeMatchedUnitPrice) * inStockUnits) * 4 / 100) - Math.round((lot.buyPriceTotal * inStockUnits) / lot.qty))
          : 0
      };
      stockStateByListingId.set(Number(lot.listingId), lotState);
      lotsList.push(lotState);
    }

    // 3. Also include any remaining live active listings on our screens ONLY for items actually bought by Sniper (in avgBuyUnitByName)
    // that scrolled off the 200-item history buffer (never random farmed items like Griffin Cub Card!)
    for (const a of activePool) {
      if (a.remQty <= 0) continue;
      if (!avgBuyUnitByName[a.nameLower] && a.nameLower !== 'enchant rune' && a.nameLower !== 'armor blueprint') continue;
      const trueRef = getTrueRefUnitPrice(a.itemId, a.refine, a.name, 0);
      if (trueRef <= 0) continue;
      const isOverpricedActive = a.unitPrice > Math.round(trueRef * 1.25);
      if (!isOverpricedActive) continue;

      const q = a.remQty;
      a.remQty = 0;
      const estBuyUnit = avgBuyUnitByName[a.nameLower] || (a.nameLower === 'enchant rune' ? 15800 : (a.nameLower === 'armor blueprint' ? 350000 : trueRef));
      const estCost = estBuyUnit * q;
      const listedGross = a.unitPrice * q;
      const realisticGross = trueRef * q;
      const realisticNetRev = realisticGross - Math.floor(realisticGross * 4 / 100);
      const realisticProfit = realisticNetRev - estCost;

      inStockSummary.lotsCount += 1;
      inStockSummary.unitsCount += q;
      inStockSummary.costTiedUpZeny += estCost;
      inStockSummary.listedGrossZeny += listedGross;
      inStockSummary.realisticGrossZeny += realisticGross;
      inStockSummary.realisticNetRevenueZeny += realisticNetRev;
      inStockSummary.realisticNetProfitZeny += realisticProfit;
      inStockSummary.overpricedLotsCount += 1;
      inStockSummary.overpricedUnitsCount += q;

      const grp = getOrCreateItemGroup(a.name, a.itemId, a.refine, a.icon, trueRef);
      grp.inStockLots += 1;
      grp.inStockUnits += q;
      grp.costTiedUpZeny += estCost;
      grp.listedGrossZeny += listedGross;
      grp.realisticGrossZeny += realisticGross;
      grp.realisticNetProfitZeny += realisticProfit;
      grp.overpricedLots += 1;
      grp.overpricedUnits += q;

      lotsList.push({
        listingId: a.listingId,
        itemId: a.itemId,
        itemName: a.name,
        refine: a.refine,
        icon: a.icon,
        qty: q,
        soldUnits: 0,
        inStockUnits: q,
        buyPriceTotal: estCost,
        buyUnitPrice: estBuyUnit,
        listedUnitPrice: a.unitPrice,
        trueRefUnitPrice: trueRef,
        isOverpriced: true,
        stockState: 'in_stock',
        buyers: [],
        buyerCharName: a.charName,
        at: 0,
        realizedNetProfit: 0,
        realisticNetProfit: realisticProfit
      });
    }

    // Attach liveStockStatus to activeBids and history for UI rendering
    const annotateRecord = (rec) => {
      if (!rec) return rec;
      const lid = Number(rec.listingId) || 0;
      const st = stockStateByListingId.get(lid);
      const trueRef = getTrueRefUnitPrice(rec.itemId, rec.refine || 0, rec.itemName, rec.cleanRefUnitPrice);
      const out = Object.assign({}, rec);
      if (trueRef > 0) out.trueRefUnitPrice = trueRef;
      if (st) {
        out.stockState = st.stockState;
        out.soldUnits = st.soldUnits;
        out.inStockUnits = st.inStockUnits;
        out.listedUnitPrice = st.listedUnitPrice;
        out.isOverpriced = st.isOverpriced;
        out.buyers = st.buyers;
        out.realizedNetProfit = st.realizedNetProfit;
        out.realisticNetProfit = st.realisticNetProfit;
      } else if (rec.status === 'outbid_stopped' || rec.action === 'outbid_refund') {
        out.stockState = 'refunded';
      } else if (rec.status === 'leading' || rec.action === 'bid' || rec.action === 'rebid') {
        out.stockState = 'bidding';
      }
      return out;
    };

    const byItem = Array.from(byItemMap.values()).map(g => {
      const avgBuyUnit = g.inStockUnits > 0 ? Math.round(g.costTiedUpZeny / g.inStockUnits) : (g.soldUnits > 0 ? Math.round(g.costRecoveredZeny / g.soldUnits) : 0);
      const avgListedUnit = g.inStockUnits > 0 ? Math.round(g.listedGrossZeny / g.inStockUnits) : 0;
      return Object.assign({}, g, {
        avgBuyUnitPrice: avgBuyUnit,
        avgListedUnitPrice: avgListedUnit
      });
    }).sort((a, b) => (b.costTiedUpZeny + b.costRecoveredZeny) - (a.costTiedUpZeny + a.costRecoveredZeny));

    return {
      soldSummary,
      inStockSummary,
      biddingSummary,
      byItem,
      lotsList: lotsList.slice(0, 150),
      annotatedActiveBids: (state.activeBids || []).slice(0, 50).map(annotateRecord),
      annotatedHistory: (state.history || []).slice(0, 100).map(annotateRecord)
    };
  }

  // Cancel active listings across all screens that are overpriced (> 1.25x true stable reference price)
  // and re-list them at the true Most-Stable Cluster reference price!
  async function repriceOverpricedStock(onlineScreens, filterItemName = '') {
    const targetFilterNorm = String(filterItemName || '').trim().toLowerCase();
    const hours = Number(config.relistDurationHours) || 24;
    const undercut = Math.max(0, Number(config.relistUndercutZeny) || 0);
    let repricedListingsCount = 0;
    let repricedUnitsCount = 0;
    let affectedScreensCount = 0;
    const details = [];
    const repricedProfileItemKeys = new Set();

    for (const scr of (onlineScreens || [])) {
      if (!scr || !Array.isArray(scr.myActiveListings) || !scr.myActiveListings.length) continue;
      const targetsOnScreen = [];
      for (const a of scr.myActiveListings) {
        if (!a || !a.listingId || !a.name) continue;
        const nmLower = String(a.name).trim().toLowerCase();
        if (targetFilterNorm && nmLower !== targetFilterNorm) continue;
        const trueRef = getTrueRefUnitPrice(a.itemId, a.refine, a.name, 0);
        if (trueRef <= 0) continue;
        if (a.unitPrice > Math.round(trueRef * 1.25)) {
          const newUnitPrice = Math.max(1, trueRef - undercut);
          const bCfg = getSmartFlipBatchConfig(nmLower, newUnitPrice, isSingleUnitFlipItem(a.name));
          targetsOnScreen.push({
            listingId: Number(a.listingId),
            itemId: Number(a.itemId) || 0,
            refine: Number(a.refine) || 0,
            name: String(a.name).trim(),
            nameLower: nmLower,
            qty: Math.max(1, Number(a.qty) || 1),
            oldUnitPrice: a.unitPrice,
            newUnitPrice,
            singleUnit: bCfg.isSingle,
            batchQty: bCfg.batchQty,
            maxConcurrent: bCfg.maxConcurrent
          });
        }
      }
      if (!targetsOnScreen.length) continue;

      const repriceCode = `(async () => {
        const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
        if (!room || !room.connection || !room.connection.isOpen) return { ok: false };
        const targets = ${JSON.stringify(targetsOnScreen)};
        const hours = ${hours};
        if (!window.__pmSeenCancelledClosedIds) window.__pmSeenCancelledClosedIds = new Set();
        let cancelled = 0;
        for (const t of targets) {
          try {
            window.__pmSeenCancelledClosedIds.add(Number(t.listingId));
            room.send('market', { op: 'cancel', listingId: Number(t.listingId) });
            cancelled += 1;
          } catch (_) {}
          await new Promise(r => setTimeout(r, 280));
        }
        try { room.send('market', { op: 'collect_all' }); } catch (_) {}
        await new Promise(r => setTimeout(r, 950));
        if (typeof window.refreshInventoryAndWeight === 'function') {
          try { window.refreshInventoryAndWeight(); } catch (_) {}
        }
        await new Promise(r => setTimeout(r, 350));

        // Group wanted relist quantities by item name and cap slots at maxConcurrent (remaining units stay in bag for drip-restock)
        const wantedByNorm = {};
        for (const t of targets) {
          if (!wantedByNorm[t.nameLower]) {
            wantedByNorm[t.nameLower] = {
              name: t.name,
              nameLower: t.nameLower,
              newUnitPrice: t.newUnitPrice,
              singleUnit: t.singleUnit,
              batchQty: Math.max(1, Number(t.batchQty) || 1),
              maxConcurrent: Math.max(1, Number(t.maxConcurrent) || (t.singleUnit ? 2 : 3)),
              totalQty: 0,
              listingsLimit: 0
            };
          }
          wantedByNorm[t.nameLower].totalQty += t.qty;
          wantedByNorm[t.nameLower].listingsLimit = Math.min(
            wantedByNorm[t.nameLower].maxConcurrent,
            wantedByNorm[t.nameLower].listingsLimit + 1
          );
        }

        let relistedCount = 0;
        let relistedUnits = 0;
        for (const grp of Object.values(wantedByNorm)) {
          let remQty = grp.totalQty;
          let slotsLeft = grp.listingsLimit;
          while (remQty > 0 && slotsLeft > 0) {
            const bag = (typeof window.getBagItems === 'function') ? window.getBagItems() : [];
            const slotObj = bag.find(b => b && !b.locked && String(b.name || '').trim().toLowerCase() === grp.nameLower && (Number(b.qty) || 0) > 0);
            if (!slotObj) break;
            const slotQty = Number(slotObj.qty) || 1;
            const postQty = grp.singleUnit ? 1 : Math.min(grp.batchQty, remQty, slotQty);
            const postPrice = grp.newUnitPrice * postQty;
            window.__pmExplicitHoursOnce = true;
            try {
              room.send('market', {
                op: 'list',
                slot: Number(slotObj.slot),
                qty: postQty,
                price: postPrice,
                hours
              });
            } finally {
              window.__pmExplicitHoursOnce = false;
            }
            relistedCount += 1;
            relistedUnits += postQty;
            remQty -= postQty;
            slotsLeft -= 1;
            await new Promise(r => setTimeout(r, 380));
          }
        }
        try { room.send('market', { op: 'mine' }); } catch (_) {}
        return { ok: true, cancelled, relistedCount, relistedUnits };
      })()`;

      const r = await evalProfilePort(scr.debugPort, repriceCode, 15000).catch(() => null);
      if (r && (r.success || r.ok) && r.result && r.result.ok) {
        affectedScreensCount += 1;
        repricedListingsCount += Number(r.result.relistedCount || r.result.cancelled) || 0;
        repricedUnitsCount += Number(r.result.relistedUnits) || 0;
        for (const t of targetsOnScreen) {
          repricedProfileItemKeys.add(`${String(scr.profileId || '')}::${t.nameLower}`);
        }
        details.push({
          charName: scr.charName || scr.profileName,
          cancelled: r.result.cancelled,
          relistedCount: r.result.relistedCount,
          relistedUnits: r.result.relistedUnits
        });
      }
    }

    // Update listedUnitPrice / relistUnitPrice ONLY on active lots whose screen + item were actually repriced in this call
    const nowRepriceTs = Date.now();
    for (const b of (state.activeBids || [])) {
      if (!b || !b.itemName) continue;
      const nm = String(b.itemName).trim().toLowerCase();
      if (!repricedProfileItemKeys.has(`${String(b.buyerProfileId || '')}::${nm}`)) continue;
      const trueRef = getTrueRefUnitPrice(b.itemId, b.refine, b.itemName, 0);
      if (trueRef > 0 && Number(b.flipUnitPrice) > Math.round(trueRef * 1.25)) {
        const newU = Math.max(1, trueRef - undercut);
        b.flipUnitPrice = newU;
        b.listedUnitPrice = newU;
        b.relistedPrice = newU * Math.max(1, Number(b.qty) || 1);
      }
    }
    for (const h of (state.history || [])) {
      if (!h || !h.itemName) continue;
      const nm = String(h.itemName).trim().toLowerCase();
      if (!repricedProfileItemKeys.has(`${String(h.buyerProfileId || '')}::${nm}`)) continue;
      if (h.at && (nowRepriceTs - Number(h.at) > 12 * 3600 * 1000)) continue; // Never overwrite old already-sold lots
      const trueRef = getTrueRefUnitPrice(h.itemId, h.refine, h.itemName, 0);
      if (trueRef > 0 && Number(h.relistUnitPrice) > Math.round(trueRef * 1.25)) {
        const q = Math.max(1, Number(h.qty) || 1);
        if (!h.initialListedUnitPrice) {
          h.initialListedUnitPrice = extractOriginalListedUnitFromNote(h.note, q) || Number(h.relistUnitPrice) || 0;
        }
        const newU = Math.max(1, trueRef - undercut);
        h.relistUnitPrice = newU;
        h.listedUnitPrice = newU;
        h.relistPriceTotal = newU * q;
      }
    }
    sanitizeHistoricalState();
    savePersistedState(state);
    cachedOnlineScreensAt = 0; // Force fresh screen state on next status poll

    return {
      success: true,
      affectedScreensCount,
      repricedListingsCount,
      repricedUnitsCount,
      details
    };
  }

  function start() {
    scheduleNextScan();
    if (maintenanceTimer) clearInterval(maintenanceTimer);
    maintenanceTimer = setInterval(() => {
      runMaintenanceCycle().catch(() => {});
    }, 10000);
  }

  async function handleRoute(req, res, pathname, sendJSON) {
    if (!pathname.startsWith('/api/market-sniper')) return false;

    const replyJSON = (statusCode, payload) => {
      if (typeof sendJSON === 'function') {
        if (sendJSON.length >= 3) return sendJSON(res, statusCode, payload);
        return sendJSON(payload, statusCode);
      }
      res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    };

    try {
      if (req.method === 'GET' && pathname === '/api/market-sniper/status') {
        const onlineScreens = await getOnlineScreenStates();
        const bestBuyer = selectRichestBuyerProfile(onlineScreens, 50000, 0, 1, config.mode === 'auto_flip', false);
        const pausedAllScreensFull = Boolean(config.enabled && config.mode === 'auto_flip' && onlineScreens.length > 0 && !bestBuyer);
        const breakdown = buildStockAndProfitBreakdown(onlineScreens);
        replyJSON(200, {
          success: true,
          config,
          stats: state.stats,
          lastScan: lastScanSummary,
          pausedAllScreensFull,
          stockBreakdown: {
            soldSummary: breakdown.soldSummary,
            inStockSummary: breakdown.inStockSummary,
            biddingSummary: breakdown.biddingSummary,
            byItem: breakdown.byItem,
            lotsList: breakdown.lotsList
          },
          activeBids: breakdown.annotatedActiveBids,
          history: breakdown.annotatedHistory,
          cachedItemsCount: Object.keys(state.priceCache || {}).length,
          onlineScreens: onlineScreens.map(s => ({
            profileId: s.profileId,
            profileName: s.profileName,
            charName: s.charName,
            zeny: s.zeny,
            premium: s.premium,
            baseLevel: s.baseLevel,
            activeCount: s.activeCount,
            evictableCheapCount: s.evictableCheapCount || 0,
            maxListings: s.maxListings,
            busy: s.busy,
            isPrimaryBuyer: Boolean(bestBuyer && bestBuyer.profileId === s.profileId)
          }))
        });
        return true;
      }

      if (req.method === 'POST' && pathname === '/api/market-sniper/reprice-overpriced-stock') {
        const body = await readBody(req);
        const onlineScreens = await getOnlineScreenStates(true);
        const out = await repriceOverpricedStock(onlineScreens, body && body.itemName ? body.itemName : '');
        replyJSON(200, out);
        return true;
      }

      if (req.method === 'POST' && pathname === '/api/market-sniper/config') {
        const body = await readBody(req);
        if (!body) {
          replyJSON(400, { success: false, error: 'Invalid JSON body' });
          return true;
        }
        config = saveConfig(Object.assign({}, config, body));
        scheduleNextScan();
        replyJSON(200, { success: true, config });
        return true;
      }

      if (req.method === 'POST' && pathname === '/api/market-sniper/scan-now') {
        const r = await runScanCycle(true);
        replyJSON(200, {
          success: true,
          scanResult: r,
          lastScan: lastScanSummary,
          stats: state.stats,
          activeBids: state.activeBids.slice(0, 50),
          history: state.history.slice(0, 100)
        });
        return true;
      }

      if (req.method === 'POST' && pathname === '/api/market-sniper/claim-all-refunds') {
        const onlineScreens = await getOnlineScreenStates();
        let claimedScreens = 0;
        await Promise.all(onlineScreens.map(async (scr) => {
          try {
            const r = await evalProfilePort(scr.debugPort, `(() => {
              const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
              if (!room || !room.connection || !room.connection.isOpen) return { ok: false };
              room.send('market', { op: 'collect_all' });
              return { ok: true };
            })()`, 3000);
            if (r && (r.success || r.ok) && r.result && r.result.ok) claimedScreens += 1;
          } catch (_) {}
        }));
        replyJSON(200, { success: true, claimedScreens });
        return true;
      }

      if (req.method === 'POST' && pathname === '/api/market-sniper/clear-history') {
        state.activeBids = [];
        state.pendingFlips = [];
        state.history = [];
        listingLocks.clear();
        savePersistedState(state);
        replyJSON(200, { success: true });
        return true;
      }

      return false;
    } catch (err) {
      console.error('[MarketSniper] handleRoute error:', err && err.message ? err.message : err);
      replyJSON(500, { success: false, error: err && err.message ? err.message : 'Internal error' });
      return true;
    }
  }

  return {
    start,
    handleRoute,
    getConfig: () => config,
    computeCleanReferencePrice
  };
}

module.exports = {
  createMarketSniperService,
  computeCleanReferencePrice,
  inferItemCategory,
  isNpcVendorTrashItem
};
