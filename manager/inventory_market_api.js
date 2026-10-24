// manager/inventory_market_api.js — Bag (inventory) and Market endpoints for the Manager.
//
// Every request becomes a fixed eval snippet run inside the game client. User input only
// ever enters the snippet as JSON-encoded, validated values (never as code).
//
//   GET  /api/profiles/:id/inventory          full bag + weight/zeny/premium
//   POST /api/profiles/:id/inventory-action   { op: use|equip|lock|destroy|sort, slot, itemId, ... }
//   POST /api/profiles/:id/market             { op: search|history|list, ... }

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
    if (p.op === 'collect') {
      const deliveryId = toInt(p.deliveryId, 1, 2000000000);
      if (deliveryId === null) return { error: 'deliveryId ไม่ถูกต้อง' };
      actionJs = `room.send('market', { op: 'collect', deliveryId: ${deliveryId} });`;
    } else if (p.op === 'collect_all') {
      actionJs = `room.send('market', { op: 'collect_all' });`;
    } else if (p.op === 'cancel') {
      const listingId = toInt(p.listingId, 1, 2000000000);
      if (listingId === null) return { error: 'listingId ไม่ถูกต้อง' };
      actionJs = `room.send('market', { op: 'cancel', listingId: ${listingId} });`;
    }
    return {
      timeout: 7000,
      code: `(async () => {
        const room = ${ROOM_JS};
        if (!room || !room.connection?.isOpen) return { success: false, error: 'ไม่ได้เชื่อมต่อเกม' };
        const awaitReply = ${AWAIT_REPLY_JS};
        const icon = ${ICON_JS};
        let mine = null;
        if (${JSON.stringify(p.op)} === 'mine') {
          mine = await awaitReply(room, 'market_mine', () => { ${actionJs} }, 4500);
        } else {
          mine = await awaitReply(room, 'market_mine', () => {
            ${actionJs}
            setTimeout(() => { try { room.send('market', { op: 'mine' }); } catch (_) {} }, 350);
          }, 5000);
          if (!mine) {
            mine = await awaitReply(room, 'market_mine', () => room.send('market', { op: 'mine' }), 3500);
          }
        }
        if (!mine) return { success: false, error: 'เซิร์ฟเวอร์ตลาดไม่ตอบกลับ (ลองใหม่อีกครั้ง)' };
        const enrich = list => (Array.isArray(list) ? list : []).map(entry => {
          if (entry && entry.item) {
            entry.item.icon = entry.item.icon || icon(entry.item, entry.item.name);
          }
          return entry;
        });
        const ch = (typeof window.getLiveCharacterData === 'function' ? window.getLiveCharacterData() : null) || window.__latestCharacterData || {};
        const premium = Array.isArray(ch.buffs) && ch.buffs.some(b => b && b.skillId === 'ui:token');
        const zeny = (typeof window.__currentZeny === 'number') ? window.__currentZeny : (typeof ch.zeny === 'number' ? ch.zeny : 0);
        const active = enrich(mine.active);
        const closed = enrich(mine.closed);
        const deliveries = enrich(mine.deliveries);
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
      if (typeof window.restoreFarmMapAfterJobChange === 'function') window.restoreFarmMapAfterJobChange('halloween');
      return { success: false, error: 'ไม่พบ NPC Witch Hazel ในเมืองหลวง' };
    }
    window.__isHalloweenExchanging = true;
    window.__planJobChangeHoldUntil = Date.now() + 45000;
    if (typeof window.needTown === 'function') window.needTown('halloween');
    try {
      window.syncHalloweenWhitelist();
      const closeAll = () => {
        document.querySelectorAll('.shop-window .win-close, .npc-dialog .win-close').forEach(b => { try { b.click(); } catch (_) {} });
        try { room.send('npc_close', {}); } catch (_) {}
      };
      let shopObj = window.readLiveWitchShopState();
      if (!shopObj) {
        room.send('npc_talk', { npcKey: witchKey });
        let dlg = null;
        for (let i = 0; i < 65 && !dlg && !shopObj; i++) {
          await sleep(200);
          shopObj = window.readLiveWitchShopState();
          dlg = document.querySelector('.npc-dialog');
        }
        if (dlg && !shopObj) {
          const opts = Array.from(dlg.querySelectorAll('.npc-options button')).map(b => (b.innerText || '').replace(/^\\s*\\d+\\s*/, '').trim());
          let optIdx = opts.findIndex(o => /รางวัล|แลก|ร้าน|reward|shop/i.test(o));
          if (optIdx < 0) optIdx = 0;
          room.send('npc_option', { index: optIdx });
          for (let i = 0; i < 30 && !shopObj; i++) {
            await sleep(200);
            shopObj = window.readLiveWitchShopState();
          }
        }
      }
      if (!shopObj) {
        closeAll();
        window.__halloweenNextTryAt = Date.now() + 20000;
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
        if (typeof window.restoreFarmMapAfterJobChange === 'function') window.restoreFarmMapAfterJobChange('halloween');
        return { success: false, error: 'โควต้าของที่เลือกเต็มแล้ว หรือวัตถุดิบไม่พอแลกตามจำนวนขั้นต่ำที่ตั้งไว้' };
      }
      room.send('shop_buy_many', { lines });
      window.__halloweenLastLog = '✅ แลกสำเร็จ: ' + exchangedSummary.join(', ');
      console.log('%c[PmheeAether Halloween] ' + window.__halloweenLastLog, 'color: #22c55e; font-weight: bold;');
      await sleep(1200);
      const afterShop = window.readLiveWitchShopState();
      if (afterShop) window.updateHalloweenQuotaFromShop(afterShop);
      closeAll();
      window.__halloweenNextTryAt = Date.now() + 8000;
      if (typeof window.restoreFarmMapAfterJobChange === 'function') window.restoreFarmMapAfterJobChange('halloween');
      return { success: true, exchanged: lines, summary: exchangedSummary.join(', '), status: window.getHalloweenExchangeStatus() };
    } finally {
      window.__isHalloweenExchanging = false;
    }
  };
  if (!window.__pmHalloweenLoopId) {
    window.__pmHalloweenLoopId = setInterval(() => {
      try {
        const liveShop = window.readLiveWitchShopState && window.readLiveWitchShopState();
        if (liveShop) window.updateHalloweenQuotaFromShop(liveShop);
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

async function handleInventoryMarketRoute(req, res, pathname, ctx) {
  const m = pathname.match(/^\/api\/profiles\/([^/]+)\/(inventory|inventory-action|market|halloween)$/);
  if (!m) return false;
  const [, id, kind] = m;
  const { loadProfiles, evalProfilePort, sendJSON } = ctx;
  const profiles = loadProfiles();
  const profile = profiles.find(p => p.id === id);
  if (!profile || !profile.debugPort) {
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
      const r = await evalProfilePort(profile.debugPort, buildHalloweenSaveCode(payload), 5000);
      sendJSON(r && r.result ? r.result : { success: false, error: r?.error || 'บันทึกตั้งค่า Halloween ไม่สำเร็จ' });
      return true;
    }
    if (op === 'exchange_now') {
      const r = await evalProfilePort(profile.debugPort, buildHalloweenExchangeNowCode(payload), 25000);
      sendJSON(r && r.result ? r.result : { success: false, error: r?.error || 'สั่งแลกของ Halloween ไม่สำเร็จ' });
      return true;
    }
    if (op === 'apply_all') {
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
  sendJSON(r && r.result ? r.result : { success: false, error: r?.error || 'สั่งงานในเกมไม่สำเร็จ' });
  return true;
}

module.exports = { handleInventoryMarketRoute, WITCH_HAZEL_ITEMS };
