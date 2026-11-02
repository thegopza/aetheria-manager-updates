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

const CONFIG_FILE = path.join(__dirname, 'data', 'market_sniper_config.json');
const STATE_FILE = path.join(__dirname, 'data', 'market_sniper_state.json');

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
  try {
    if (fs.existsSync(STATE_FILE)) {
      const d = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
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
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      priceCache: state.priceCache || {},
      activeBids: (state.activeBids || []).slice(0, 100),
      pendingFlips: (state.pendingFlips || []).slice(0, 50),
      history: (state.history || []).slice(0, 200),
      stats: state.stats || {}
    }, null, 2), 'utf8');
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
    return /\b(card|stone)\b|การ์ด|ศิลา/i.test(itemOrName);
  }
  const cat = inferItemCategory(itemOrName);
  if (cat === 'card' || cat === 'stone' || cat === 'weapon' || cat === 'armor' || cat === 'accessory') return true;
  return /\b(card|stone)\b|การ์ด|ศิลา/i.test(String(itemOrName.name || itemOrName.itemName || ''));
}

// Compute Clean Reference Price from the last 10 hours (fallback 24h) + active listings.
// 7d history is used ONLY for liquidity count (sales7d), never for price averaging so old prices don't distort flips.
// Strips both mistyped low sales (< 45% of 70th percentile, e.g. 1.4M vs 14M)
// and wash-trade spikes (> Q3 + 1.5*IQR), and never sets flipUnitPrice above cleanRefUnitPrice.
function computeCleanReferencePrice(history24h, history7d, activeListingsForSameItem, undercutZeny = 1) {
  const now = Date.now();
  const tenHoursAgo = now - 10 * 3600 * 1000;
  const fourHoursAgo = now - 4 * 3600 * 1000;
  const recent10hSamples = [];
  const recent4hSamples = [];
  const recent24hSamples = [];
  const hourly10hSamples = [];
  const hourly4hSamples = [];
  const hourly24hSamples = [];
  const seenRecentKeys = new Set();
  let sales24h = 0;
  let sales7d = 0;

  const medianOf = (arr) => {
    if (!arr || !arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return (s.length % 2 !== 0) ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  };

  const collectFromHistory = (hist, is24h) => {
    if (!hist || typeof hist !== 'object') return;
    const recent = Array.isArray(hist.recent) ? hist.recent : [];
    const points = Array.isArray(hist.points) ? hist.points : [];
    const totalBuckets = Number(hist.buckets) || points.length || 24;
    const cutoff10hBucket = Math.max(0, totalBuckets - 10);
    const cutoff4hBucket = Math.max(0, totalBuckets - 4);

    let countFromPoints = 0;
    for (const pt of points) {
      if (!pt) continue;
      const s = Number(pt.sales ?? pt.count ?? 0) || 0;
      const avg = Number(pt.avg) || 0;
      const low = Number(pt.low) || avg;
      const high = Number(pt.high) || avg;
      const bucketIdx = Number(pt.bucket);
      if (s > 0 && avg > 0) {
        countFromPoints += s;
        if (is24h) {
          // If an hourly bucket had a severe mistyped crash (< 40% of high in that same hour),
          // its avg is pulled down by the mistake; use high or skip that distorted avg.
          const isCleanBucket = !(low > 0 && high > 0 && low < high * 0.40);
          const estUnit = Math.round(isCleanBucket ? avg : high);
          if (estUnit > 0) {
            const weight = Math.min(s, 4);
            for (let i = 0; i < weight; i++) {
              hourly24hSamples.push(estUnit);
              if (Number.isFinite(bucketIdx) && bucketIdx >= cutoff10hBucket) {
                hourly10hSamples.push(estUnit);
              }
              if (Number.isFinite(bucketIdx) && bucketIdx >= cutoff4hBucket && isCleanBucket) {
                hourly4hSamples.push(estUnit);
              }
            }
          }
        }
      }
    }

    let countFromRecent = 0;
    for (const r of recent) {
      if (!r) continue;
      const qty = Math.max(1, Number(r.qty) || 1);
      const price = Number(r.price) || 0;
      const u = Math.round(price / qty);
      const at = Number(r.at) || 0;
      if (u > 0) {
        countFromRecent += 1;
        const rKey = `${at}:${price}:${qty}`;
        if (!seenRecentKeys.has(rKey)) {
          seenRecentKeys.add(rKey);
          if (is24h || (at > 0 && at >= now - 24 * 3600 * 1000)) {
            recent24hSamples.push(u);
          }
          if (!at || at >= tenHoursAgo) {
            recent10hSamples.push(u);
          }
          if (at > 0 && at >= fourHoursAgo) {
            recent4hSamples.push(u);
          }
        }
      }
    }

    const total = Math.max(countFromPoints, countFromRecent);
    if (is24h) sales24h = total;
    else sales7d = total;
  };

  collectFromHistory(history24h, true);
  collectFromHistory(history7d, false);

  // Build primary sample pool from the last 10 hours (recent 10h trades + hourly 10h buckets).
  // Only fall back to 24h if the item had fewer than 3 samples in the last 10 hours.
  let unitSamples = [...recent10hSamples, ...hourly10hSamples];
  if (unitSamples.length < 3) {
    unitSamples = [...recent24hSamples, ...hourly24hSamples];
  }

  const totalSales = Math.max(sales7d, sales24h);
  if (unitSamples.length === 0 || totalSales === 0) {
    return { valid: false, reason: 'no_history', totalSales: 0, sales24h: 0, sales7d: 0 };
  }

  const sortedAll = unitSamples.slice().sort((a, b) => a - b);

  // Stage 1: Reject isolated mistyped low sales (e.g. seller forgot a 0 or dumped at 10% of real value)
  const p70Idx = Math.min(sortedAll.length - 1, Math.floor(sortedAll.length * 0.70));
  const anchorHigh = sortedAll[p70Idx];
  const lowMistakeFloor = Math.round(anchorHigh * 0.45);
  const withoutMistakes = sortedAll.filter(p => p >= lowMistakeFloor);
  const stage1 = withoutMistakes.length >= 2 ? withoutMistakes : sortedAll;

  // Stage 2: IQR outlier rejection to strip wash-trade high spikes
  const q1 = stage1[Math.floor(stage1.length * 0.25)];
  const medRaw = stage1[Math.floor(stage1.length * 0.50)];
  const q3 = stage1[Math.floor(stage1.length * 0.75)];
  const iqr = Math.max(1, q3 - q1);
  const maxFence = Math.max(q3 + 1.5 * iqr, Math.round(medRaw * 2.0));
  const minFence = Math.max(lowMistakeFloor, q1 - 1.5 * iqr);

  const cleanSamples = stage1.filter(p => p >= minFence && p <= maxFence);
  const finalSamples = cleanSamples.length > 0 ? cleanSamples : stage1;

  let cleanRefUnitPrice = medianOf(finalSamples);

  // Stage 2.5: Short-Term (Last 1-4 Hours) Downtrend Anchor
  // Filter out mistyped low dumps (< lowMistakeFloor) from the last 4h stream first,
  // then if the last 1-4 hours traded lower than the 10h median, anchor down to the 4h median!
  const cleanRecent4h = recent4hSamples.filter(p => p >= lowMistakeFloor && p <= maxFence);
  const cleanHourly4h = hourly4hSamples.filter(p => p >= lowMistakeFloor && p <= maxFence);
  const shortTermPool = [...cleanRecent4h, ...cleanHourly4h];
  if (shortTermPool.length >= 2) {
    const shortTermMed = medianOf(shortTermPool);
    if (shortTermMed > 0 && shortTermMed < cleanRefUnitPrice) {
      cleanRefUnitPrice = shortTermMed;
    }
  }

  // Stage 3: Competing Active Listings Ceiling & Flip Price
  const allActiveUnitPrices = [];
  const normalActivePrices = [];
  if (Array.isArray(activeListingsForSameItem)) {
    for (const l of activeListingsForSameItem) {
      if (!l || l.mine) continue;
      const q = Math.max(1, Number(l.qty) || 1);
      const u = Math.round((Number(l.minBid || l.price) || 0) / q);
      if (u > 0) {
        allActiveUnitPrices.push(u);
      }
    }
  }
  allActiveUnitPrices.sort((a, b) => a - b);

  // Cap cleanRefUnitPrice by the 2nd cheapest active listing on the market so we never overvalue an item
  // that already has multiple sellers offering it at a lower price.
  if (allActiveUnitPrices.length >= 2) {
    const secondCheapestActive = allActiveUnitPrices[1];
    if (secondCheapestActive > 0 && secondCheapestActive < cleanRefUnitPrice) {
      cleanRefUnitPrice = secondCheapestActive;
    }
  }

  if (Array.isArray(activeListingsForSameItem)) {
    for (const l of activeListingsForSameItem) {
      if (!l || l.mine) continue;
      if (l.auctionEndsAt && Number(l.auctionEndsAt) > now) continue;
      const q = Math.max(1, Number(l.qty) || 1);
      const u = Math.round((Number(l.price) || 0) / q);
      // Only consider normal Buy-Now listings that are AT OR BELOW cleanRefUnitPrice (down to 75% of cleanRefUnitPrice).
      // Never chase overpriced unsold listings above cleanRefUnitPrice (e.g. 700k when real sold price is 572k).
      if (u >= Math.round(cleanRefUnitPrice * 0.75) && u <= cleanRefUnitPrice) {
        normalActivePrices.push(u);
      }
    }
  }
  normalActivePrices.sort((a, b) => a - b);

  let flipUnitPrice = cleanRefUnitPrice;
  if (normalActivePrices.length > 0) {
    const cheapestNormal = normalActivePrices[0];
    flipUnitPrice = Math.min(
      cleanRefUnitPrice,
      Math.max(
        Math.round(cleanRefUnitPrice * 0.78),
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
    minCleanSold: finalSamples[0],
    maxCleanSold: finalSamples[finalSamples.length - 1]
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

  // Probe all online profiles to get their live Zeny, Premium status, Market Quota, and connection readiness
  async function getOnlineScreenStates() {
    const profiles = (typeof loadProfiles === 'function' ? loadProfiles() : []) || [];
    const running = profiles.filter(p => p && p.debugPort);
    if (!running.length) return [];

    const sniperAutoFlip = Boolean(config.enabled && config.mode === 'auto_flip');
    const reserveSlots = sniperAutoFlip ? 2 : 0;

    const probeCode = `(() => {
      const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
      if (!room || !room.connection || !room.connection.isOpen) return { connected: false };
      if (room !== window.__pmSniperMineHookedRoomV3) {
        window.__pmSniperMineHookedRoomV3 = room;
        room.onMessage('market_mine', (msg) => {
          if (msg && Array.isArray(msg.active)) {
            window.__myMarketActiveCount = msg.active.length;
            window.__myMarketActiveCountUpdatedAt = Date.now();
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
            for (const a of nonAuction) {
              const nm = String((a.item && a.item.name) || '').trim().toLowerCase();
              const iid = Number(a.item && (a.item.itemId ?? a.item.id)) || 0;
              if (nm) nameCounts[nm] = (nameCounts[nm] || 0) + 1;
              if (iid) idCounts[iid] = (idCounts[iid] || 0) + 1;
            }
            window.__myMarketActiveNameCounts = nameCounts;
            window.__myMarketActiveIdCounts = idCounts;
            window.__myMarketStackedCards = nonAuction
              .filter(a => a && Number(a.qty) > 1 && /\\b(card|stone)\\b|การ์ด|ศิลา/i.test(String((a.item && a.item.name) || '')))
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
      const ch = (typeof window.getLiveCharacterData === 'function' ? window.getLiveCharacterData() : null) || window.__latestCharacterData || {};
      const live = (typeof window.__getClientLiveState === 'function' ? window.__getClientLiveState() : null) || {};
      const premium = Boolean(
        (Array.isArray(ch.buffs) && ch.buffs.some(b => b && b.skillId === 'ui:token')) ||
        (Array.isArray(live.buffs) && live.buffs.some(b => b && (b.skillId === 'ui:token' || b === 'ui:token')))
      );
      const zeny = (typeof window.__currentZeny === 'number') ? window.__currentZeny : (typeof ch.zeny === 'number' ? ch.zeny : (typeof live.zeny === 'number' ? live.zeny : 0));

      // 1) Reserve 2 market slots on Sniper screens (>= 300k zeny) so normal Auto-Sell stops at 18/20
      window.__pmSniperReservedSlots = (zeny >= 300000) ? ${reserveSlots} : 0;
      window.__pmSniperBlockCheapAutoSell = Boolean(${sniperAutoFlip ? 'true' : 'false'} && zeny >= 300000);

      // 2) Packet-level guard on room.send('market', { op: 'list', ... }):
      //    - Never allow Cards/Stones to be listed with qty > 1 (auto-rewrite to qty: 1 at unit price)
      //    - On Sniper screens, block Auto-Sell from listing items with total price <= 50,000 z or > 2 concurrent copies of the same Card
      if (room !== window.__pmSniperSendGuardRoom && typeof room.send === 'function') {
        window.__pmSniperSendGuardRoom = room;
        const origRoomSend = room.send.bind(room);
        room.send = function (type, data) {
          if (type === 'market' && data && data.op === 'list') {
            const bag = (typeof window.getBagItems === 'function') ? window.getBagItems() : [];
            const slotItem = bag.find(b => b && Number(b.slot) === Number(data.slot));
            const itemName = String((slotItem && slotItem.name) || '').trim();
            const norm = itemName.toLowerCase();
            const isCardOrStone = /\\b(card|stone)\\b|การ์ด|ศิลา/i.test(itemName);
            if (isCardOrStone && Number(data.qty) > 1) {
              const unitP = Math.max(1, Math.round((Number(data.price) || 0) / Math.max(1, Number(data.qty) || 1)));
              data.qty = 1;
              data.price = unitP;
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
              if (isCardOrStone && norm) {
                const curSame = (window.__myMarketActiveNameCounts && window.__myMarketActiveNameCounts[norm]) || 0;
                if (curSame >= 2) {
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

      // 3) Sync Auto-Sell rules & backoffs on Sniper screens:
      //    - Add any unlocked Card in bag to Auto-Sell rules (minQty: 1, sellMode: 'min') so sniped cards in bag get listed 1 by 1 automatically
      //    - Force all Card/Stone rules to sellMode = 'min', minQty = 1
      //    - Set rule.id backoff for cheap items (<= 50k z) and Cards that already have >= 2 active listings
      if (${sniperAutoFlip ? 'true' : 'false'} && zeny >= 300000 && window.__autoMarketSellConfig && Array.isArray(window.__autoMarketSellConfig.rules)) {
        if (!window.__autoSellRuleBackoffUntil) window.__autoSellRuleBackoffUntil = {};
        let changedCardRule = false;
        const existingRuleNames = new Set(window.__autoMarketSellConfig.rules.map(r => String((r && (r.itemName || r.name)) || '').trim().toLowerCase()).filter(Boolean));
        const bag = (typeof window.getBagItems === 'function') ? window.getBagItems() : [];
        for (const b of bag) {
          if (!b || b.locked) continue;
          const bName = String(b.name || '').trim();
          const bNorm = bName.toLowerCase();
          if (bName && /\\bCard$/i.test(bName) && !existingRuleNames.has(bNorm)) {
            window.__autoMarketSellConfig.rules.unshift({
              id: 'rule_sniper_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
              itemName: bName,
              minQty: 1,
              sellMode: 'min',
              enabled: true
            });
            existingRuleNames.add(bNorm);
            changedCardRule = true;
          }
        }
        for (const r of window.__autoMarketSellConfig.rules) {
          if (!r) continue;
          const rName = String(r.itemName || r.name || '').trim();
          const rNorm = rName.toLowerCase();
          const rKey = r.id || rNorm;
          const isCardOrStone = /\\b(card|stone)\\b|การ์ด|ศิลา/i.test(rName);
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

      if (zeny >= 300000 && (!window.__myMarketActiveCountUpdatedAt || window.__myMarketEvictableCheapCount === undefined || (Date.now() - window.__myMarketActiveCountUpdatedAt > 60000))) {
        window.__myMarketActiveCountUpdatedAt = Date.now();
        try { room.send('market', { op: 'mine' }); } catch (_) {}
      }
      const baseLevel = Number(ch.baseLevel ?? ch.level ?? live.level) || 0;
      const charName = ch.name || live.charName || window.__characterName || '';
      const activeCount = Number(window.__myMarketActiveCount) || 0;
      const cheapestActivePrice = Number(window.__myMarketCheapestActivePrice) || 0;
      const evictableCheapCount = Number(window.__myMarketEvictableCheapCount) || 0;
      const activeNameCounts = window.__myMarketActiveNameCounts || {};
      const activeIdCounts = window.__myMarketActiveIdCounts || {};
      const stackedCards = Array.isArray(window.__myMarketStackedCards) ? window.__myMarketStackedCards : [];
      const maxListings = premium ? 20 : 3;
      const weight = Number(ch.weight ?? live.weight) || 0;
      const weightLimit = Number(ch.weightLimit ?? live.weightLimit) || 0;
      const busy = !!(window.__isConsolidating || window.__isShopping || window.__isAutoSellingNow || window.__isManualSelling || window.__isStoring);
      const sniperEvents = Array.isArray(window.__pmSniperEvents) ? window.__pmSniperEvents.splice(0, 50) : [];
      return {
        connected: true,
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
        maxListings,
        weight,
        weightLimit,
        busy,
        sniperEvents
      };
    })()`;

    const results = await Promise.all(running.map(async (p) => {
      try {
        const r = await evalProfilePort(p.debugPort, probeCode, 4500);
        if (r && (r.success || r.ok) && r.result && r.result.connected) {
          return {
            profileId: String(p.id),
            profileName: p.name || p.id,
            debugPort: p.debugPort,
            ...r.result
          };
        }
      } catch (_) {}
      return null;
    }));

    const online = results.filter(Boolean);
    for (const scr of online) {
      if (Array.isArray(scr.sniperEvents) && scr.sniperEvents.length > 0) {
        for (const ev of scr.sniperEvents) {
          handleClientSniperEvent(scr, ev);
        }
      }
    }
    return online;
  }

  function recordHistoryEvent(entry) {
    const item = Object.assign({
      id: `snp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now()
    }, entry);
    state.history.unshift(item);
    if (state.history.length > 200) state.history.length = 200;
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
  async function fetchItemReferencePrice(screen, item, activeListings) {
    const itemId = Number(item.itemId ?? item.id);
    const refine = Number(item.refine) || 0;
    const itemName = String(item.name || '').trim();
    const cacheKey = `${itemId}:${refine}`;
    const cached = state.priceCache[cacheKey];
    if (cached && cached.cacheVer === 4 && (Date.now() - (Number(cached.updatedAt) || 0)) < PRICE_CACHE_TTL_MS) {
      // Re-adjust flipUnitPrice against latest normal active listings if available (never above cleanRefUnitPrice)
      const sameItemListings = (Array.isArray(activeListings) ? activeListings : []).filter(
        l => l && l.item && Number(l.item.itemId ?? l.item.id) === itemId && (Number(l.item.refine) || 0) === refine
      );
      if (cached.valid && sameItemListings.length > 0) {
        const now = Date.now();
        const normalActives = sameItemListings
          .filter(l => !l.mine && !(l.auctionEndsAt && Number(l.auctionEndsAt) > now))
          .map(l => Math.round((Number(l.price) || 0) / Math.max(1, Number(l.qty) || 1)))
          .filter(u => u >= Math.round(cached.cleanRefUnitPrice * 0.75) && u <= cached.cleanRefUnitPrice)
          .sort((a, b) => a - b);
        if (normalActives.length > 0) {
          cached.flipUnitPrice = Math.min(
            cached.cleanRefUnitPrice,
            Math.max(
              Math.round(cached.cleanRefUnitPrice * 0.78),
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
      const fetchCheapestActive = () => new Promise(resolve => {
        let unsub;
        const t = setTimeout(() => { if (unsub) unsub(); resolve(null); }, 2800);
        unsub = room.onMessage('market_results', msg => {
          clearTimeout(t);
          if (unsub) unsub();
          resolve(msg && Array.isArray(msg.listings) ? msg.listings : null);
        });
        room.send('market', { op: 'search', filters: { q: ${JSON.stringify(itemName)}, sort: 'price_asc', page: 0 } });
      });
      const h24 = await fetchHist('24h');
      await new Promise(r => setTimeout(r, 140));
      const h7d = await fetchHist('7d');
      await new Promise(r => setTimeout(r, 140));
      const itemActives = ${itemName ? 'await fetchCheapestActive()' : 'null'};
      return { ok: true, h24, h7d, itemActives };
    })()`;

    const res = await evalProfilePort(screen.debugPort, code, 9500);
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
      config.relistUndercutZeny
    );

    const entry = {
      cacheVer: 4,
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
      minCleanSold: calc.minCleanSold || 0,
      maxCleanSold: calc.maxCleanSold || 0,
      updatedAt: Date.now()
    };

    state.priceCache[cacheKey] = entry;
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

      if (!window.__pmSniperProtectedItems) window.__pmSniperProtectedItems = new Set();
      window.__pmSniperProtectedItems.add(String(p.itemName).trim().toLowerCase());

      // Hook isSellWhitelisted so NPC auto-sell never sells a sniped item waiting to be flipped
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

      if (!window.__pmSniperAuctions) window.__pmSniperAuctions = {};
      if (!window.__pmSniperHandledDeliveries) window.__pmSniperHandledDeliveries = new Set();
      if (!Array.isArray(window.__pmSniperEvents)) window.__pmSniperEvents = [];

      // Helper to claim deliveries and auto-list won/bought item (with Smart Cheap-Item Eviction & Single-Unit Card Splitting)
      window.__pmSniperClaimAndFlip = async function (targetInfo, paidTotal, waitBeforeCollectMs = 750) {
        if (waitBeforeCollectMs >= 0) {
          if (waitBeforeCollectMs > 0) {
            await new Promise(r => setTimeout(r, waitBeforeCollectMs));
          }
          try {
            room.send('market', { op: 'collect_all' });
          } catch (_) {}
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
        const isSingle = Boolean(targetInfo.singleUnit || /\\b(card|stone)\\b|การ์ด|ศิลา/i.test(normName));

        const findMatchingInBag = () => {
          const bag = (typeof window.getBagItems === 'function') ? window.getBagItems() : [];
          return bag.filter(b => {
            if (!b || b.locked) return false;
            const bId = Number((b.raw && b.raw.itemId) ?? b.id);
            const bRef = Number(b.refine || (b.raw && b.raw.refine) || 0);
            if (bId === Number(targetInfo.itemId) && bRef === Number(targetInfo.refine)) return true;
            return String(b.name || '').trim().toLowerCase() === normName && bRef === Number(targetInfo.refine);
          });
        };

        const initialCandidates = findMatchingInBag();
        foundInBag = initialCandidates.length > 0;

        if (foundInBag && targetInfo.autoFlip && targetInfo.relistPriceTotal > paidTotal) {
          const totalBagQty = initialCandidates.reduce((s, c) => s + (Number(c.qty) || 1), 0);
          const totalWantedQty = Math.min(Number(targetInfo.qty) || 1, totalBagQty);
          const unitPrice = Math.max(1, Number(targetInfo.flipUnitPrice) || Math.round((Number(targetInfo.relistPriceTotal) || 0) / Math.max(1, Number(targetInfo.qty) || 1)));
          // Cards/Stones MUST be listed as qty: 1 per slot (never as a stack!). List up to 2 individual copies immediately; Auto-Sell lists any remaining 1 by 1 as they sell.
          const listingsToPost = isSingle ? Math.min(2, Math.max(1, totalWantedQty)) : 1;
          const perListingQty = isSingle ? 1 : totalWantedQty;
          const perListingPrice = isSingle ? unitPrice : (unitPrice * totalWantedQty);
          const totalDepositFee = Math.max(1, Math.floor(perListingPrice * 2 / 100)) * listingsToPost;
          const curZeny = (typeof window.__currentZeny === 'number') ? window.__currentZeny : 0;

          if (totalWantedQty > 0 && (unitPrice * totalWantedQty) > paidTotal && (curZeny === 0 || curZeny >= totalDepositFee)) {
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
                  try {
                    room.send('market', { op: 'cancel', listingId: Number(targetEvict.listingId) });
                  } catch (_) {}
                  await new Promise(r => setTimeout(r, 320));
                }
                console.log('%c[PmheeAether Sniper] 🔄 ถอดไอเทมราคาถูก (' + evictedNames.join(', ') + ') ออกเพื่อเปิดช่องตั้งขายของทำกำไรทันที!', 'color: #f59e0b; font-weight: bold;');
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
              const qtyThisPost = Math.min(perListingQty, beforeQty);
              if (qtyThisPost <= 0) break;
              const priceThisPost = isSingle ? unitPrice : (unitPrice * qtyThisPost);

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
              console.log('%c[PmheeAether Sniper] 🏷️ ตั้งขายทำกำไรอัตโนมัติสำเร็จ: ' + targetInfo.itemName + (isSingle ? ' (แยกทีละ 1 ใบ x' + listedUnitsCount + ' ช่อง)' : ' x' + listedUnitsCount) + ' @ ' + unitPrice.toLocaleString() + ' z/ชิ้น!', 'color: #10b981; font-weight: bold; font-size: 13px;');
            }
          }
        }
        if (relisted && window.__pmSniperProtectedItems && listedUnitsCount >= (Number(targetInfo.qty) || 1)) {
          window.__pmSniperProtectedItems.delete(normName);
        }
        return {
          relisted,
          foundInBag,
          listedUnitsCount,
          evictedItemName: evictedInfo ? evictedInfo.name : null,
          evictedItemPrice: evictedInfo ? evictedInfo.price : 0
        };
      };

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

      const scanner = nonBusyScreens[scannerCursor % nonBusyScreens.length];
      scannerCursor = (scannerCursor + 1) % Math.max(1, nonBusyScreens.length);

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

      // Prioritize items already in priceCache first, then cheapest unit price first
      const prioritizedListings = listings.slice().sort((a, b) => {
        const itA = (a && a.item) || {};
        const itB = (b && b.item) || {};
        const kA = `${Number(itA.itemId ?? itA.id)}:${Number(itA.refine) || 0}`;
        const kB = `${Number(itB.itemId ?? itB.id)}:${Number(itB.refine) || 0}`;
        const cA = state.priceCache[kA];
        const cB = state.priceCache[kB];
        const freshA = Boolean(cA && cA.cacheVer === 4 && (now - (Number(cA.updatedAt) || 0)) < PRICE_CACHE_TTL_MS);
        const freshB = Boolean(cB && cB.cacheVer === 4 && (now - (Number(cB.updatedAt) || 0)) < PRICE_CACHE_TTL_MS);
        if (freshA !== freshB) return freshA ? -1 : 1;
        const uA = Math.ceil((Number(a && (a.minBid || a.price)) || 0) / Math.max(1, Number(a && a.qty) || 1));
        const uB = Math.ceil((Number(b && (b.minBid || b.price)) || 0) / Math.max(1, Number(b && b.qty) || 1));
        return uA - uB;
      });

      for (const l of prioritizedListings) {
        if (!l || !l.item || l.mine) continue;
        const lid = Number(l.listingId);
        if (!lid) continue;

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
        const cacheFresh = refInfo && refInfo.cacheVer === 4 && (now - (Number(refInfo.updatedAt) || 0)) < PRICE_CACHE_TTL_MS;

        if (!cacheFresh) {
          if (historyFetchesRemaining <= 0) continue;
          historyFetchesRemaining -= 1;
          refInfo = await fetchItemReferencePrice(scanner, it, listings);
        }

        if (!refInfo || !refInfo.valid || refInfo.cleanRefUnitPrice <= 0) continue;
        if (refInfo.totalSales < config.minSalesVolume) continue;

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

      // 3) Auto-unstack stacked Cards/Stones (qty > 1 -> qty: 1 per slot) & proactively evict cheap (<= 50,000 z) filler listings on Sniper buyer screens
      if (config.mode === 'auto_flip') {
        const onlineScreens = await getOnlineScreenStates();
        for (const scr of onlineScreens) {
          if (!scr || scr.busy || (Number(scr.zeny) || 0) < 300000) continue;

          // 3a) Unstack 1 stacked Card/Stone listing per tick (e.g. Poison Toad Card x6, Magma Titan Card x4, Tidemark Seal Card x2, Snowman Card x2)
          if (Array.isArray(scr.stackedCards) && scr.stackedCards.length > 0) {
            const stCard = scr.stackedCards[0];
            const unstackCode = `(async () => {
              const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
              if (!room || !room.connection || !room.connection.isOpen) return { ok: false };
              const st = ${JSON.stringify(stCard)};
              const hours = ${Number(config.relistDurationHours) || 24};
              const norm = String(st.name || '').trim().toLowerCase();

              // Query live active listings so we can also evict up to 2 cheap (<= 50k z) filler items if needed
              const mineMsg = await new Promise(resolve => {
                let unsub;
                const t = setTimeout(() => { if (unsub) unsub(); resolve(null); }, 2200);
                unsub = room.onMessage('market_mine', m => { clearTimeout(t); if (unsub) unsub(); resolve(m); });
                try { room.send('market', { op: 'mine' }); } catch (_) { clearTimeout(t); if (unsub) unsub(); resolve(null); }
              });
              const activeList = (mineMsg && Array.isArray(mineMsg.active)) ? mineMsg.active : [];
              const nowTs = Date.now();
              const cheapEvictable = activeList
                .filter(a => a && Number(a.listingId) !== Number(st.listingId) && !(a.auctionEndsAt && Number(a.auctionEndsAt) > nowTs) && Number(a.price) > 0 && Number(a.price) <= 50000)
                .sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));

              // Cancel the stacked card listing first
              try { room.send('market', { op: 'cancel', listingId: Number(st.listingId) }); } catch (_) {}
              await new Promise(r => setTimeout(r, 380));

              // Cancel up to 2 cheap <= 50k items so we have room to split the card into individual x1 listings
              if (!window.__pmSniperEvictedItemNames) window.__pmSniperEvictedItemNames = new Set();
              if (!window.__autoSellRuleBackoffUntil) window.__autoSellRuleBackoffUntil = {};
              const evictedNames = [];
              for (const ce of cheapEvictable.slice(0, 2)) {
                const ceName = (ce.item && ce.item.name) || 'Item';
                const ceNorm = String(ceName).trim().toLowerCase();
                evictedNames.push(ceName);
                window.__pmSniperEvictedItemNames.add(ceNorm);
                window.__autoSellRuleBackoffUntil[ceNorm] = Date.now() + 30 * 60 * 1000;
                try { room.send('market', { op: 'cancel', listingId: Number(ce.listingId) }); } catch (_) {}
                await new Promise(r => setTimeout(r, 320));
              }

              try { room.send('market', { op: 'collect_all' }); } catch (_) {}
              await new Promise(r => setTimeout(r, 850));

              // List up to 2 individual copies (qty: 1 each) at st.unitPrice
              let posted = 0;
              for (let u = 0; u < 2; u++) {
                const bag = (typeof window.getBagItems === 'function') ? window.getBagItems() : [];
                const targetSlot = bag.find(b => b && !b.locked && String(b.name || '').trim().toLowerCase() === norm && (Number(b.qty) || 0) >= 1);
                if (!targetSlot) break;
                const beforeQty = Number(targetSlot.qty) || 1;
                window.__pmExplicitHoursOnce = true;
                try {
                  room.send('market', {
                    op: 'list',
                    slot: Number(targetSlot.slot),
                    qty: 1,
                    price: Number(st.unitPrice),
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
                  if (left <= beforeQty - 1) {
                    okOne = true;
                    posted += 1;
                    break;
                  }
                }
                if (!okOne) break;
                await new Promise(r => setTimeout(r, 320));
              }
              try { room.send('market', { op: 'mine' }); } catch (_) {}
              console.log('%c[PmheeAether Sniper] 🃏 แยกกองการ์ด ' + st.name + ' x' + st.qty + ' -> ตั้งขายแยกทีละ 1 ใบ (' + posted + ' ช่อง @ ' + Number(st.unitPrice).toLocaleString() + ' z/ใบ)!', 'color: #10b981; font-weight: bold;');
              return { ok: true, posted, evictedNames };
            })()`;

            await evalProfilePort(scr.debugPort, unstackCode, 9000);
            break; // Process 1 unstack operation per maintenance cycle
          }

          // 3b) If a rich Sniper screen (>= 500k zeny) has cheap <= 50,000 z items taking up slots and fewer than 5 free slots, evict up to 3 cheap items per tick
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
              const toCancel = cheapEvictable.slice(0, 3);
              const names = [];
              for (const ce of toCancel) {
                const ceName = (ce.item && ce.item.name) || 'Item';
                const ceNorm = String(ceName).trim().toLowerCase();
                names.push(ceName + ' (' + Number(ce.price).toLocaleString() + ' z)');
                window.__pmSniperEvictedItemNames.add(ceNorm);
                window.__autoSellRuleBackoffUntil[ceNorm] = Date.now() + 30 * 60 * 1000;
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
        replyJSON(200, {
          success: true,
          config,
          stats: state.stats,
          lastScan: lastScanSummary,
          pausedAllScreensFull,
          activeBids: state.activeBids.slice(0, 50),
          history: state.history.slice(0, 100),
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
  inferItemCategory
};
