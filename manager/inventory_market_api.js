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
        return { success: true, total, listings };
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

async function handleInventoryMarketRoute(req, res, pathname, ctx) {
  const m = pathname.match(/^\/api\/profiles\/([^/]+)\/(inventory|inventory-action|market)$/);
  if (!m) return false;
  const [, id, kind] = m;
  const { loadProfiles, evalProfilePort, sendJSON } = ctx;
  const profile = loadProfiles().find(p => p.id === id);
  if (!profile || !profile.debugPort) {
    sendJSON({ success: false, error: 'จอนี้ออฟไลน์อยู่' }, 400);
    return true;
  }

  if (kind === 'inventory' && req.method === 'GET') {
    const r = await evalProfilePort(profile.debugPort, buildInventoryCode(), 5000);
    sendJSON(r && r.result ? r.result : { success: false, error: r?.error || 'อ่านกระเป๋าไม่สำเร็จ' });
    return true;
  }

  if (req.method !== 'POST' || kind === 'inventory') return false;
  const payload = await readBody(req);
  if (!payload) {
    sendJSON({ success: false, error: 'Invalid JSON' }, 400);
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

module.exports = { handleInventoryMarketRoute };
