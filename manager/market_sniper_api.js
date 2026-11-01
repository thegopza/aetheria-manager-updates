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

// Compute Clean Reference Price from 24h & 7d market history + active listings.
// Strips both mistyped low sales (< 45% of 75th percentile, e.g. 1.4M vs 14M)
// and wash-trade spikes (> Q3 + 1.5*IQR).
function computeCleanReferencePrice(history24h, history7d, activeListingsForSameItem, undercutZeny = 1) {
  const unitSamples = [];
  let sales24h = 0;
  let sales7d = 0;

  const collectFromHistory = (hist, is24h) => {
    if (!hist || typeof hist !== 'object') return;
    const recent = Array.isArray(hist.recent) ? hist.recent : [];
    const points = Array.isArray(hist.points) ? hist.points : [];

    let countFromPoints = 0;
    for (const pt of points) {
      if (!pt) continue;
      const s = Number(pt.sales) || 0;
      const avg = Number(pt.avg) || 0;
      if (s > 0 && avg > 0) {
        countFromPoints += s;
        if (!is24h) {
          const weight = Math.min(s, 8);
          for (let i = 0; i < weight; i++) unitSamples.push(Math.round(avg));
        }
      }
    }

    let countFromRecent = 0;
    for (const r of recent) {
      if (!r) continue;
      const qty = Math.max(1, Number(r.qty) || 1);
      const u = Math.round((Number(r.price) || 0) / qty);
      if (u > 0) {
        countFromRecent += 1;
        unitSamples.push(u);
      }
    }

    const total = Math.max(countFromPoints, countFromRecent);
    if (is24h) sales24h = total;
    else sales7d = total;
  };

  collectFromHistory(history24h, true);
  collectFromHistory(history7d, false);

  const totalSales = Math.max(sales7d, sales24h);
  if (unitSamples.length === 0 || totalSales === 0) {
    return { valid: false, reason: 'no_history', totalSales: 0, sales24h: 0, sales7d: 0 };
  }

  const sortedAll = unitSamples.slice().sort((a, b) => a - b);

  // Stage 1: Reject mistyped low sales (e.g. seller forgot a 0 and sold at 10% of real value)
  // Use the 70th percentile as the anchor of normal trading price.
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
  const maxFence = Math.max(q3 + 1.5 * iqr, Math.round(medRaw * 2.2));
  const minFence = Math.max(lowMistakeFloor, q1 - 1.5 * iqr);

  const cleanSamples = stage1.filter(p => p >= minFence && p <= maxFence);
  const finalSamples = cleanSamples.length > 0 ? cleanSamples : stage1;

  const mid = Math.floor(finalSamples.length / 2);
  const cleanRefUnitPrice = (finalSamples.length % 2 !== 0)
    ? finalSamples[mid]
    : Math.round((finalSamples[mid - 1] + finalSamples[mid]) / 2);

  // Stage 3: Determine Flip Price (relist unit price)
  // Ignore any active listing in the 5-minute auction window AND ignore any active listing < 70% of cleanRefUnitPrice
  const now = Date.now();
  const normalActivePrices = [];
  if (Array.isArray(activeListingsForSameItem)) {
    for (const l of activeListingsForSameItem) {
      if (!l || l.mine) continue;
      if (l.auctionEndsAt && Number(l.auctionEndsAt) > now) continue;
      const q = Math.max(1, Number(l.qty) || 1);
      const u = Math.round((Number(l.price) || 0) / q);
      if (u >= Math.round(cleanRefUnitPrice * 0.70) && u <= Math.round(cleanRefUnitPrice * 1.60)) {
        normalActivePrices.push(u);
      }
    }
  }
  normalActivePrices.sort((a, b) => a - b);

  let flipUnitPrice = cleanRefUnitPrice;
  if (normalActivePrices.length > 0) {
    const cheapestNormal = normalActivePrices[0];
    flipUnitPrice = Math.max(
      Math.round(cleanRefUnitPrice * 0.78),
      cheapestNormal - Math.max(0, Number(undercutZeny) || 1)
    );
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

    const probeCode = `(() => {
      const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
      if (!room || !room.connection || !room.connection.isOpen) return { connected: false };
      const ch = (typeof window.getLiveCharacterData === 'function' ? window.getLiveCharacterData() : null) || window.__latestCharacterData || {};
      const premium = Array.isArray(ch.buffs) && ch.buffs.some(b => b && b.skillId === 'ui:token');
      const zeny = (typeof window.__currentZeny === 'number') ? window.__currentZeny : (typeof ch.zeny === 'number' ? ch.zeny : 0);
      const baseLevel = Number(ch.baseLevel ?? ch.level) || 0;
      const charName = ch.name || window.__characterName || '';
      const activeCount = Number(window.__myMarketActiveCount) || 0;
      const maxListings = premium ? 20 : 3;
      const busy = !!(window.__isConsolidating || window.__isShopping || window.__isAutoSellingNow || window.__isManualSelling || window.__isStoring);
      const sniperEvents = Array.isArray(window.__pmSniperEvents) ? window.__pmSniperEvents.splice(0, 50) : [];
      return {
        connected: true,
        zeny,
        premium,
        baseLevel,
        charName,
        activeCount,
        maxListings,
        busy,
        sniperEvents
      };
    })()`;

    const results = await Promise.all(running.map(async (p) => {
      try {
        const r = await evalProfilePort(p.debugPort, probeCode, 2500);
        if (r && r.ok && r.result && r.result.connected) {
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
      }
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
        status: ev.relisted ? 'relisted' : 'won',
        relistedPrice: ev.relistPriceTotal || 0,
        lastEventNote: ev.relisted
          ? `ชนะประมูล & ตั้งขายกลับที่ ${Number(ev.relistPriceTotal || 0).toLocaleString()} z สำเร็จ!`
          : `ชนะประมูล & รับของเข้ากระเป๋าแล้ว`
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
          ? `ชนะประมูลที่ ${Number(ev.buyPriceTotal || 0).toLocaleString()} z -> ตั้งขายกลับ ${Number(ev.relistPriceTotal || 0).toLocaleString()} z (คาดการณ์กำไรสุทธิ +${Number(ev.expectedNetProfit || 0).toLocaleString()} z)`
          : `ชนะประมูลที่ ${Number(ev.buyPriceTotal || 0).toLocaleString()} z และรับของเข้าตัวเรียบร้อย`
      });
    }
  }

  // Pick the richest eligible online screen to execute a buy or bid
  function selectRichestBuyerProfile(onlineScreens, requiredAmount, existingListingId = 0) {
    const allowedSet = new Set(Array.isArray(config.allowedBuyerProfileIds) ? config.allowedBuyerProfileIds : []);
    const lock = existingListingId ? listingLocks.get(Number(existingListingId)) : null;

    const candidates = onlineScreens.filter(s => {
      if (!s || !s.connected || s.busy) return false;
      if (s.baseLevel > 0 && s.baseLevel < 10) return false;
      if (allowedSet.size > 0 && !allowedSet.has(String(s.profileId))) return false;
      if (config.mode === 'auto_flip' && s.activeCount >= s.maxListings) return false;
      const spendable = (Number(s.zeny) || 0) - (Number(config.minReserveZeny) || 0);
      return spendable >= requiredAmount;
    });

    if (!candidates.length) return null;

    // If a screen already holds the lock for this listingId and can afford it, keep using the same screen
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

  // Fetch 24h & 7d market history for an item via an online screen
  async function fetchItemReferencePrice(screen, item, activeListings) {
    const itemId = Number(item.itemId ?? item.id);
    const refine = Number(item.refine) || 0;
    const cacheKey = `${itemId}:${refine}`;
    const cached = state.priceCache[cacheKey];
    if (cached && (Date.now() - (Number(cached.updatedAt) || 0)) < PRICE_CACHE_TTL_MS) {
      // Re-adjust flipUnitPrice against latest normal active listings if available
      const sameItemListings = (Array.isArray(activeListings) ? activeListings : []).filter(
        l => l && l.item && Number(l.item.itemId ?? l.item.id) === itemId && (Number(l.item.refine) || 0) === refine
      );
      if (cached.valid && sameItemListings.length > 0) {
        const now = Date.now();
        const normalActives = sameItemListings
          .filter(l => !l.mine && !(l.auctionEndsAt && Number(l.auctionEndsAt) > now))
          .map(l => Math.round((Number(l.price) || 0) / Math.max(1, Number(l.qty) || 1)))
          .filter(u => u >= Math.round(cached.cleanRefUnitPrice * 0.70) && u <= Math.round(cached.cleanRefUnitPrice * 1.60))
          .sort((a, b) => a - b);
        if (normalActives.length > 0) {
          cached.flipUnitPrice = Math.max(
            Math.round(cached.cleanRefUnitPrice * 0.78),
            normalActives[0] - Math.max(0, Number(config.relistUndercutZeny) || 1)
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
      const h24 = await fetchHist('24h');
      await new Promise(r => setTimeout(r, 180));
      const h7d = await fetchHist('7d');
      return { ok: true, h24, h7d };
    })()`;

    const res = await evalProfilePort(screen.debugPort, code, 8000);
    if (!res || !res.ok || !res.result || !res.result.ok) return null;

    const sameItemListings = (Array.isArray(activeListings) ? activeListings : []).filter(
      l => l && l.item && Number(l.item.itemId ?? l.item.id) === itemId && (Number(l.item.refine) || 0) === refine
    );

    const calc = computeCleanReferencePrice(
      res.result.h24,
      res.result.h7d,
      sameItemListings,
      config.relistUndercutZeny
    );

    const entry = {
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
      if (!Array.isArray(window.__pmSniperEvents)) window.__pmSniperEvents = [];

      // Helper to claim deliveries and auto-list won/bought item
      window.__pmSniperClaimAndFlip = async function (targetInfo, paidTotal) {
        try {
          room.send('market', { op: 'collect_all' });
        } catch (_) {}
        await new Promise(r => setTimeout(r, 650));
        if (typeof window.refreshInventoryAndWeight === 'function') {
          try { window.refreshInventoryAndWeight(); } catch (_) {}
        }
        await new Promise(r => setTimeout(r, 350));

        let relisted = false;
        if (targetInfo.autoFlip && targetInfo.relistPriceTotal > paidTotal) {
          const bag = (typeof window.getBagItems === 'function') ? window.getBagItems() : [];
          const normName = String(targetInfo.itemName || '').trim().toLowerCase();
          const candidates = bag.filter(b => {
            if (!b || b.locked) return false;
            const bId = Number((b.raw && b.raw.itemId) ?? b.id);
            const bRef = Number(b.refine || (b.raw && b.raw.refine) || 0);
            if (bId === Number(targetInfo.itemId) && bRef === Number(targetInfo.refine)) return true;
            return String(b.name || '').trim().toLowerCase() === normName && bRef === Number(targetInfo.refine);
          });

          if (candidates.length > 0) {
            const slotItem = candidates[0];
            const sellQty = Math.min(Number(targetInfo.qty) || 1, Number(slotItem.qty) || 1);
            const listPriceTotal = Number(targetInfo.flipUnitPrice) * sellQty;
            const depositFee = Math.max(1, Math.floor(listPriceTotal * 2 / 100));
            const curZeny = (typeof window.__currentZeny === 'number') ? window.__currentZeny : 0;
            if (sellQty > 0 && listPriceTotal > paidTotal && (curZeny === 0 || curZeny >= depositFee)) {
              const beforeQty = Number(slotItem.qty) || 1;
              window.__pmExplicitHoursOnce = true;
              try {
                room.send('market', {
                  op: 'list',
                  slot: Number(slotItem.slot),
                  qty: sellQty,
                  price: listPriceTotal,
                  hours: Number(targetInfo.relistDurationHours) || 24
                });
              } finally {
                window.__pmExplicitHoursOnce = false;
              }
              for (let i = 0; i < 8; i++) {
                await new Promise(r => setTimeout(r, 250));
                const nowBag = (typeof window.getBagItems === 'function') ? window.getBagItems() : [];
                const nowSlot = nowBag.find(x => Number(x.slot) === Number(slotItem.slot));
                const left = nowSlot ? (Number(nowSlot.qty) || 0) : 0;
                if (left <= beforeQty - sellQty) {
                  relisted = true;
                  break;
                }
              }
              if (relisted) {
                console.log('%c[PmheeAether Sniper] 🏷️ ตั้งขายทำกำไรอัตโนมัติสำเร็จ: ' + targetInfo.itemName + ' x' + sellQty + ' @ ' + listPriceTotal.toLocaleString() + ' z!', 'color: #10b981; font-weight: bold; font-size: 13px;');
              }
            }
          }
        }
        return relisted;
      };

      // Install real-time Colyseus listeners once per room
      if (room !== window.__pmSniperHookedRoom) {
        window.__pmSniperHookedRoom = room;

        room.onMessage('market_outbid', async (msg) => {
          if (!msg || !msg.listingId) return;
          const lid = Number(msg.listingId);
          const tracked = window.__pmSniperAuctions && window.__pmSniperAuctions[lid];
          // Always collect outbid refund immediately so Zeny returns to bag right away!
          try {
            room.send('market', { op: 'collect_all' });
            console.log('%c[PmheeAether Sniper] 💰 โดนปาดประมูล listing #' + lid + ' -> สั่งกดรับเงินประมูลคืนเข้ากระเป๋าทันที!', 'color: #f59e0b; font-weight: bold;');
          } catch (_) {}

          if (!tracked) return;
          const outbidAmount = Number(msg.amount) || 0;
          const nextBid = Math.max(outbidAmount + 1, Math.ceil(outbidAmount * 1.01));
          const nowTs = Date.now();
          if (tracked.auctionEndsAt && nowTs >= tracked.auctionEndsAt) return;

          if (nextBid <= tracked.maxBidCapTotal) {
            await new Promise(r => setTimeout(r, 550));
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
                  refund: Number(msg.refund) || 0,
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
              refund: Number(msg.refund) || 0,
              maxBidCapTotal: tracked.maxBidCapTotal,
              cleanRefUnitPrice: tracked.cleanRefUnitPrice,
              flipUnitPrice: tracked.flipUnitPrice
            });
          }
        });

        room.onMessage('market_won', async (msg) => {
          if (!msg || !msg.listingId) return;
          const lid = Number(msg.listingId);
          const tracked = window.__pmSniperAuctions && window.__pmSniperAuctions[lid];
          if (!tracked) {
            try { room.send('market', { op: 'collect_all' }); } catch (_) {}
            return;
          }
          delete window.__pmSniperAuctions[lid];
          const finalPrice = Number(msg.price) || tracked.lastBidAmount || tracked.actionAmount;
          console.log('%c[PmheeAether Sniper] 🏆 ชนะการประมูล! ' + tracked.itemName + ' ที่ราคา ' + finalPrice.toLocaleString() + ' z -> กำลังรับของและตั้งขายทำกำไร...', 'color: #10b981; font-weight: bold; font-size: 13px;');
          const relisted = await window.__pmSniperClaimAndFlip(tracked, finalPrice);
          const netRev = tracked.relistPriceTotal - Math.floor(tracked.relistPriceTotal * 4 / 100);
          window.__pmSniperEvents.push({
            type: relisted ? 'won_and_relisted' : 'won_claimed',
            relisted,
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
        const relisted = await window.__pmSniperClaimAndFlip(p, p.actionAmount);
        const zenyAfter = (typeof window.__currentZeny === 'number') ? window.__currentZeny : zenyBefore;
        return { success: true, mode: 'buy', amount: p.actionAmount, relisted, zenyBefore, zenyAfter };
      }
    })()`;

    const res = await evalProfilePort(buyerScreen.debugPort, execCode, 8500);
    return (res && res.ok && res.result) ? res.result : { success: false, error: 'คำสั่งไม่ตอบกลับ' };
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

      if (!scanRes || !scanRes.ok || !scanRes.result || !scanRes.result.ok) {
        return { ok: false, reason: 'search_timeout' };
      }

      const listings = scanRes.result.listings || [];
      lastScanSummary = {
        at: Date.now(),
        scannerProfileId: scanner.profileId,
        scannerName: scanner.charName || scanner.profileName,
        filterLabel: targetSearch.label,
        listingsCount: listings.length,
        evaluatedCount: 0
      };

      const blacklist = getBlacklistSet();
      const watchlistLower = new Set(getWatchlistArray().map(s => s.toLowerCase()));
      const now = Date.now();
      let historyFetchesRemaining = 5; // Cap history RPCs per tick so scans stay fast

      // Prioritize items already in priceCache first, then cheapest unit price first
      const prioritizedListings = listings.slice().sort((a, b) => {
        const itA = (a && a.item) || {};
        const itB = (b && b.item) || {};
        const kA = `${Number(itA.itemId ?? itA.id)}:${Number(itA.refine) || 0}`;
        const kB = `${Number(itB.itemId ?? itB.id)}:${Number(itB.refine) || 0}`;
        const cA = state.priceCache[kA];
        const cB = state.priceCache[kB];
        const freshA = Boolean(cA && (now - (Number(cA.updatedAt) || 0)) < PRICE_CACHE_TTL_MS);
        const freshB = Boolean(cB && (now - (Number(cB.updatedAt) || 0)) < PRICE_CACHE_TTL_MS);
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
        const cacheFresh = refInfo && (now - (Number(refInfo.updatedAt) || 0)) < PRICE_CACHE_TTL_MS;

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
        const buyerScreen = selectRichestBuyerProfile(onlineScreens, acquireTotalCost, lid);
        const taxPercent = (buyerScreen && buyerScreen.premium) ? 4 : 8;
        const flipUnitPrice = Math.max(refInfo.flipUnitPrice, refInfo.cleanRefUnitPrice);
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
            if (execResult.relisted) {
              state.stats.totalRelisted = (state.stats.totalRelisted || 0) + 1;
              state.stats.totalEstimatedNetProfit = (state.stats.totalEstimatedNetProfit || 0) + expectedNetProfit;
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
              status: execResult.relisted ? 'relisted' : 'bought',
              relistedPrice: execResult.relisted ? flipTotal : 0,
              lastEventNote: execResult.relisted
                ? `ช้อนซื้อทันที & ตั้งขายกลับที่ ${flipTotal.toLocaleString()} z สำเร็จ!`
                : `ช้อนซื้อทันที & รับของเข้ากระเป๋าแล้ว`
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
                ? `ช้อนซื้อขาดที่ ${acquireTotalCost.toLocaleString()} z -> ตั้งขายกลับ ${flipTotal.toLocaleString()} z (กำไรสุทธิ +${expectedNetProfit.toLocaleString()} z)`
                : `ช้อนซื้อขาดที่ ${acquireTotalCost.toLocaleString()} z และรับของเข้าตัวเรียบร้อย`
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

  // Periodic maintenance: check ended auctions, claim any stuck deliveries/refunds, and flip any unclaimed won items
  async function runMaintenanceCycle() {
    if (!config.enabled || isMaintenanceTick) return;
    isMaintenanceTick = true;
    try {
      const now = Date.now();
      const expiredLeads = state.activeBids.filter(
        b => b && b.status === 'leading' && b.auctionEndsAt > 0 && now > (Number(b.auctionEndsAt) + 3000)
      );
      if (!expiredLeads.length) return;

      const profiles = (typeof loadProfiles === 'function' ? loadProfiles() : []) || [];
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
              const relisted = await window.__pmSniperClaimAndFlip({
                itemId: ${Number(bid.itemId)},
                refine: ${Number(bid.refine) || 0},
                itemName: ${JSON.stringify(bid.itemName || '')},
                qty: ${Number(bid.qty) || 1},
                flipUnitPrice: ${Number(bid.flipUnitPrice) || 0},
                relistPriceTotal: ${Number(bid.flipUnitPrice || 0) * Math.max(1, Number(bid.qty) || 1)},
                relistDurationHours: ${Number(config.relistDurationHours) || 24},
                autoFlip: ${config.mode === 'auto_flip'}
              }, ${Number(bid.currentBid) || 0});
              return { ok: true, relisted };
            } else {
              try { room.send('market', { op: 'collect_all' }); } catch (_) {}
              return { ok: true, relisted: false };
            }
          })()`;

          const r = await evalProfilePort(prof.debugPort, settleCode, 6500);
          if (r && r.ok && r.result && r.result.ok) {
            const relisted = Boolean(r.result.relisted);
            const flipTotal = (Number(bid.flipUnitPrice) || 0) * Math.max(1, Number(bid.qty) || 1);
            if (relisted) {
              state.stats.totalWonOrBought = (state.stats.totalWonOrBought || 0) + 1;
              state.stats.totalRelisted = (state.stats.totalRelisted || 0) + 1;
              state.stats.totalEstimatedNetProfit = (state.stats.totalEstimatedNetProfit || 0) + (Number(bid.expectedNetProfit) || 0);
            }
            upsertActiveBid({
              listingId: bid.listingId,
              status: relisted ? 'relisted' : 'won',
              relistedPrice: relisted ? flipTotal : 0,
              lastEventNote: relisted
                ? `หมดเวลาประมูล 5 นาที -> รับของ & ตั้งขายกลับที่ ${flipTotal.toLocaleString()} z สำเร็จ!`
                : `หมดเวลาประมูล 5 นาที -> กดรับของ/เงินคืนจากแท็บรับของเรียบร้อย`
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
                note: `ครบ 5 นาที ชนะประมูลที่ ${Number(bid.currentBid || 0).toLocaleString()} z -> ตั้งขายกลับ ${flipTotal.toLocaleString()} z`
              });
            }
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

    if (req.method === 'GET' && pathname === '/api/market-sniper/status') {
      const onlineScreens = await getOnlineScreenStates();
      const bestBuyer = selectRichestBuyerProfile(onlineScreens, 100000, 0);
      sendJSON(res, 200, {
        success: true,
        config,
        stats: state.stats,
        lastScan: lastScanSummary,
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
        sendJSON(res, 400, { success: false, error: 'Invalid JSON body' });
        return true;
      }
      config = saveConfig(Object.assign({}, config, body));
      scheduleNextScan();
      sendJSON(res, 200, { success: true, config });
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/market-sniper/scan-now') {
      const r = await runScanCycle(true);
      sendJSON(res, 200, {
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
          if (r && r.ok && r.result && r.result.ok) claimedScreens += 1;
        } catch (_) {}
      }));
      sendJSON(res, 200, { success: true, claimedScreens });
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/market-sniper/clear-history') {
      state.activeBids = [];
      state.history = [];
      listingLocks.clear();
      savePersistedState(state);
      sendJSON(res, 200, { success: true });
      return true;
    }

    return false;
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
