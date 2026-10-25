// Guild Manager service for PmheeAether Manager.
//
// Lets the user create/manage guilds from a left-edge drawer (next to Party & Premium):
//   1. Pick a Guild Leader (หัวกิลด์) and enter a Guild Name (ชื่อกิลด์) -> Confirm (ตกลง)
//   2. Leader is placed in the guild box; if leader has no guild in-game yet, creates the guild
//      via `room.send('guild', { action: 'create', name })`
//   3. Auto-selects free online characters into the guild (`autoFill`) and invites + auto-accepts them
//   4. Auto Daily Material Donation (`donateMaterial`): leader & members automatically donate daily
//      guild materials once per day when they have the required items in their bag.

const fs = require('fs');
const path = require('path');

function normName(s) {
  return String(s || '').trim().toLowerCase();
}

const GUILD_MAT_NAMES = {
  90201: 'Phracon',
  90202: 'Emveretarcon',
  90203: 'Oridecon',
  90204: 'Rough Elunium',
  90205: 'Elunium',
  90206: 'Enriched Elunium'
};

const DEFAULT_DAILY_ROUTINE = {
  autoBuyDonateMaterials: false,
  maxMaterialUnitPrice: 5000,
  autoExchangeShop: false,
  exchangeAccessoryRune: true,
  accessoryRuneQty: 1,
  exchangeEnchantRune: true,
  enchantRuneQty: 10,
  autoTopUpZenyForShop: true,
  keepZeny: 50000
};

function sanitizeDailyRoutine(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  return {
    autoBuyDonateMaterials: typeof src.autoBuyDonateMaterials === 'boolean' ? src.autoBuyDonateMaterials : DEFAULT_DAILY_ROUTINE.autoBuyDonateMaterials,
    maxMaterialUnitPrice: Math.max(100, Math.floor(Number(src.maxMaterialUnitPrice) || DEFAULT_DAILY_ROUTINE.maxMaterialUnitPrice)),
    autoExchangeShop: typeof src.autoExchangeShop === 'boolean' ? src.autoExchangeShop : DEFAULT_DAILY_ROUTINE.autoExchangeShop,
    exchangeAccessoryRune: typeof src.exchangeAccessoryRune === 'boolean' ? src.exchangeAccessoryRune : DEFAULT_DAILY_ROUTINE.exchangeAccessoryRune,
    accessoryRuneQty: Math.min(1, Math.max(0, Math.floor(Number(src.accessoryRuneQty ?? DEFAULT_DAILY_ROUTINE.accessoryRuneQty)))),
    exchangeEnchantRune: typeof src.exchangeEnchantRune === 'boolean' ? src.exchangeEnchantRune : DEFAULT_DAILY_ROUTINE.exchangeEnchantRune,
    enchantRuneQty: Math.min(10, Math.max(0, Math.floor(Number(src.enchantRuneQty ?? DEFAULT_DAILY_ROUTINE.enchantRuneQty)))),
    autoTopUpZenyForShop: typeof src.autoTopUpZenyForShop === 'boolean' ? src.autoTopUpZenyForShop : DEFAULT_DAILY_ROUTINE.autoTopUpZenyForShop,
    keepZeny: Math.max(0, Math.floor(Number(src.keepZeny ?? DEFAULT_DAILY_ROUTINE.keepZeny)))
  };
}

// Evaluates inside the game client (Electron or Browser mode).
// Reads character, guild state, pending guild invite, and checks which daily material tiers can be donated.
const PROBE_GUILD_CLIENT_JS = `(() => {
  try {
    const findGetters = () => {
      const out = {};
      try {
        const rootEl = document.getElementById('root') || document.body.firstElementChild;
        const key = rootEl && Object.keys(rootEl).find(k => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'));
        if (!key) return out;
        let start = rootEl[key];
        if (start && start.stateNode && start.stateNode.current) start = start.stateNode.current;
        const stack = [start];
        let n = 0;
        while (stack.length && n++ < 100000 && !(out.character && out.inventory && out.guild && out.invite && out.chat)) {
          const f = stack.pop();
          if (!f) continue;
          let h = f.memoizedState, g = 0;
          while (h && typeof h === 'object' && g++ < 80) {
            const q = h.queue;
            if (q && typeof q.getSnapshot === 'function') {
              const src = String(q.getSnapshot).replace(/\\s+/g, '');
              if (!out.character && /^\\(\\)=>[A-Za-z_$][\\w$]*\\.character$/.test(src)) out.character = q.getSnapshot;
              if (!out.inventory && /^\\(\\)=>[A-Za-z_$][\\w$]*\\.inventory$/.test(src)) out.inventory = q.getSnapshot;
              if (!out.guild && /^\\(\\)=>[A-Za-z_$][\\w$]*\\.guild$/.test(src)) out.guild = q.getSnapshot;
              if (!out.invite && /^\\(\\)=>[A-Za-z_$][\\w$]*\\.invite$/.test(src)) out.invite = q.getSnapshot;
              if (!out.chat && /^\\(\\)=>[A-Za-z_$][\\w$]*\\.chat$/.test(src)) out.chat = q.getSnapshot;
            }
            h = h.next;
          }
          if (f.sibling) stack.push(f.sibling);
          if (f.child) stack.push(f.child);
        }
      } catch (e) {}
      return out;
    };

    let getters = window.__pmGuildGetters;
    if (!getters || !getters.character || !getters.inventory || !getters.guild || !getters.invite || !getters.chat) {
      getters = findGetters();
      window.__pmGuildGetters = getters;
    }

    const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
    if (room && !room.__pmGuildHook && typeof room.onMessage === 'function') {
      room.__pmGuildHook = true;
      try {
        room.onMessage('guild', d => { window.__pmGuildData = d; });
        room.onMessage('invite', d => { window.__pmInviteData = d && d.ttlMs ? { ...d, expiresAt: Date.now() + d.ttlMs } : d; });
      } catch (e) {}
    }

    const roomOpen = !!(room && room.state && (!room.connection || room.connection.isOpen !== false));
    let me = null;
    try { me = room && room.state && room.state.players && room.state.players.get(room.sessionId); } catch (e) {}
    let live = null;
    try { live = typeof window.__getClientLiveState === 'function' ? window.__getClientLiveState() : null; } catch (e) {}
    let ch = null;
    try { ch = getters.character ? getters.character() : null; } catch (e) {}

    const charName = (me && me.name) || (ch && ch.name) || (live && live.charName) || (typeof window.getCharacterName === 'function' ? window.getCharacterName() : '') || '';
    if (!charName || !roomOpen) {
      return { inWorld: false, roomOpen };
    }

    let g = null;
    try { g = getters.guild ? getters.guild() : null; } catch (e) {}
    if (!g && window.__pmGuildData) g = window.__pmGuildData;

    let inv = null;
    try { inv = getters.invite ? getters.invite() : null; } catch (e) {}
    if (!inv && window.__pmInviteData) inv = window.__pmInviteData;
    try {
      if (!inv && typeof document.querySelector === 'function') {
        const toast = document.querySelector('.invite-toast');
        if (toast) {
          const txt = (toast.innerText || toast.textContent || '').trim();
          if (txt.includes('กิลด์')) {
            const m = txt.match(/^(\\S+)\\s+เชิญคุณเข้ากิลด์(?:\\s+(.+))?/m);
            inv = { kind: 'guild', from: m ? m[1] : '', label: m && m[2] ? m[2].trim() : txt };
          }
        }
      }
    } catch (e) {}

    let newMemberCooldownNote = null;
    let newMemberUnlockAt = 0;
    try {
      const chatArr = getters.chat ? getters.chat() : null;
      if (Array.isArray(chatArr) && chatArr.length > 0) {
        const recent = chatArr.slice(-100);
        for (let i = recent.length - 1; i >= 0; i--) {
          const entry = recent[i];
          const txt = String((entry && (entry.text || entry.message || entry.content)) || entry || '');
          if (txt.includes('สมาชิกใหม่ต้องอยู่กิลด์ครบ')) {
            const m = txt.match(/\\(([^)]+)\\)/);
            newMemberCooldownNote = m && m[1] ? ('รอครบ 24 ชม. (' + m[1] + ')') : 'รอสมาชิกใหม่ครบ 24 ชม.';
            break;
          }
        }
      }
      if (g && Array.isArray(g.members) && Array.isArray(g.log)) {
        const myMem = g.members.find(m => m && String(m.name || '').trim().toLowerCase() === String(charName || '').trim().toLowerCase());
        if (myMem && myMem.role !== 'master') {
          const joinTarget = String(charName || '').trim().toLowerCase() + ' เข้าร่วมกิลด์';
          const joinLog = g.log.find(l => l && String(l.text || '').trim().toLowerCase() === joinTarget && Number(l.at) > 0);
          if (joinLog) {
            const unlockAt = Number(joinLog.at) + 24 * 3600 * 1000;
            const remMs = unlockAt - Date.now();
            if (remMs > 0) {
              newMemberUnlockAt = unlockAt;
              const hrs = Math.floor(remMs / 3600000);
              const mins = Math.max(1, Math.ceil((remMs % 3600000) / 60000));
              newMemberCooldownNote = 'รอครบ 24 ชม. (อีก ' + (hrs > 0 ? (hrs + ' ชม. ') : '') + mins + ' นาที)';
            }
          }
        }
      }
    } catch (e) {}

    let invRaw = null;
    try { invRaw = getters.inventory ? getters.inventory() : null; } catch (e) {}
    if (!invRaw && window.__latestInventory) invRaw = window.__latestInventory;
    const bag = Array.isArray(invRaw) ? invRaw : (invRaw && Array.isArray(invRaw.items) ? invRaw.items : []);

    // Count bag items by itemId (matching the game's guild material counter)
    const bagCounts = {};
    for (const it of bag) {
      if (!it || it.equipped || Number(it.refine || 0) > 0) continue;
      const id = Number(it.itemId);
      if (!id) continue;
      bagCounts[id] = (bagCounts[id] || 0) + Number(it.qty ?? it.count ?? 1);
    }

    const level = Number((ch && (ch.baseLevel || ch.level)) || (me && me.level) || (live && live.baseLv) || 1);
    const jobLevel = Number((ch && ch.jobLevel) || (me && me.jobLevel) || (live && live.jobLv) || 1);
    const className = (ch && (ch.classTh || ch.className || ch.classId)) || (me && me.classId) || (live && live.classId) || '';
    const zeny = Number((ch && ch.zeny != null) ? ch.zeny : ((live && live.zeny != null) ? live.zeny : (me && me.zeny))) || 0;
    const mapName = (room && room.state && (room.state.displayName || room.state.mapId)) || (live && live.currentMap) || '';

    let inGameGuild = null;
    const donatableTiers = [];
    const tierSummaries = [];

    if (g && g.id) {
      const mats = Array.isArray(g.materials) ? g.materials : [];
      for (const m of mats) {
        if (!m || !Array.isArray(m.items) || m.items.length === 0) continue;
        const minLv = Number(m.minLevel || 1);
        const lvOk = level >= minLv;
        let itemsOk = true;
        const itemDetails = m.items.map(req => {
          const itemId = Number(req.itemId);
          const need = Number(req.qty || 1);
          const have = Number(bagCounts[itemId] || 0);
          if (have < need) itemsOk = false;
          return { itemId, need, have };
        });
        const canDonate = !g.donatedToday && lvOk && itemsOk;
        tierSummaries.push({
          tier: m.tier,
          exp: Number(m.exp || 0),
          minLevel: minLv,
          lvOk,
          itemsOk,
          canDonate,
          items: itemDetails
        });
        if (canDonate) {
          donatableTiers.push({
            tier: m.tier,
            exp: Number(m.exp || 0),
            minLevel: minLv,
            items: itemDetails
          });
        }
      }
      // Prefer highest EXP / highest tier when donating
      donatableTiers.sort((a, b) => (b.exp - a.exp) || (b.tier - a.tier));

      inGameGuild = {
        id: g.id,
        name: g.name || '',
        level: Number(g.level || 1),
        exp: Number(g.exp || 0),
        expToNext: Number(g.expToNext || 0),
        maxMembers: Number(g.maxMembers || 20),
        donatedToday: !!g.donatedToday,
        myPoints: Number(g.myPoints || 0),
        shopToday: (g.shopToday && typeof g.shopToday === 'object') ? { ...g.shopToday } : {},
        totalDonated: Number(g.totalDonated || 0),
        members: Array.isArray(g.members) ? g.members.map(m => ({
          name: m.name,
          online: !!m.online,
          level: m.level,
          jobLevel: m.jobLevel,
          classId: m.classId,
          role: m.role
        })) : [],
        tierSummaries
      };
    }

    let pendingGuildInvite = null;
    if (inv && inv.kind === 'guild' && (!inv.expiresAt || inv.expiresAt > Date.now())) {
      pendingGuildInvite = {
        from: inv.from || '',
        label: inv.label || '',
        expiresAt: Number(inv.expiresAt || 0)
      };
    }

    return {
      inWorld: true,
      roomOpen,
      charName,
      level,
      jobLevel,
      className,
      zeny,
      mapName,
      inGameGuild,
      pendingGuildInvite,
      donatableTiers,
      newMemberCooldownNote,
      newMemberUnlockAt
    };
  } catch (e) {
    return { inWorld: false, error: e.message };
  }
})()`;

function sendGuildActionJs(payloadObj) {
  if (payloadObj && payloadObj.action === 'accept') {
    return `(() => {
      try {
        if (typeof document.querySelector === 'function') {
          const toast = document.querySelector('.invite-toast');
          if (toast && (toast.innerText || toast.textContent || '').includes('กิลด์')) {
            const btn = toast.querySelector('.invite-actions button.primary') || toast.querySelector('button.primary');
            if (btn && typeof btn.click === 'function') {
              btn.click();
              window.__pmInviteData = null;
              return { ok: true, via: 'toast' };
            }
          }
        }
      } catch (e) {}
      const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
      if (!room || !room.state) {
        return { ok: false, error: 'no-room' };
      }
      window.__pmInviteData = null;
      room.send('guild', { action: 'accept' });
      return { ok: true, via: 'room' };
    })()`;
  }
  return `(() => {
    const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
    if (!room || !room.state) {
      return { ok: false, error: 'no-room' };
    }
    room.send('guild', ${JSON.stringify(payloadObj)});
    return { ok: true };
  })()`;
}

function buildBuyMissingMaterialsAndDonateJs(tierObj, maxUnitPrice, keepZeny) {
  const payloadJson = JSON.stringify({
    tier: Number(tierObj.tier || 0),
    exp: Number(tierObj.exp || 0),
    items: (tierObj.items || []).map(it => ({
      itemId: Number(it.itemId),
      need: Number(it.need || 1),
      name: GUILD_MAT_NAMES[Number(it.itemId)] || String(it.name || '')
    })),
    maxUnitPrice: Math.max(100, Number(maxUnitPrice || 5000)),
    keepZeny: Math.max(0, Number(keepZeny || 0))
  });
  return `(async () => {
    const cfg = ${payloadJson};
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    try {
      const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
      if (!room || !room.state || (room.connection && room.connection.isOpen === false)) {
        return { ok: false, reason: 'ไม่ได้เชื่อมต่อห้องเกม' };
      }
      const getters = window.__pmGuildGetters || {};
      const getGuild = () => {
        try { if (getters.guild) return getters.guild(); } catch (e) {}
        return window.__pmGuildData || null;
      };
      const getChar = () => {
        try { if (getters.character) return getters.character(); } catch (e) {}
        return (typeof window.getLiveCharacterData === 'function' ? window.getLiveCharacterData() : null) || {};
      };
      const getBag = () => {
        let raw = null;
        try { if (getters.inventory) raw = getters.inventory(); } catch (e) {}
        if (!raw && window.__latestInventory) raw = window.__latestInventory;
        return Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : []);
      };
      const countItem = (itemId) => {
        const id = Number(itemId);
        let sum = 0;
        for (const it of getBag()) {
          if (!it || it.equipped || Number(it.refine || 0) > 0) continue;
          if (Number(it.itemId) === id) sum += Number(it.qty ?? it.count ?? 1);
        }
        return sum;
      };
      const getZeny = () => {
        const ch = getChar();
        if (ch && ch.zeny != null) return Number(ch.zeny) || 0;
        try {
          const me = room.state.players && room.state.players.get(room.sessionId);
          if (me && me.zeny != null) return Number(me.zeny) || 0;
        } catch (e) {}
        return 0;
      };

      const g0 = getGuild();
      if (!g0 || !g0.id) return { ok: false, reason: 'ตัวละครยังไม่มีกิลด์ในเกม' };
      if (g0.donatedToday) return { ok: true, alreadyDonated: true, donated: false };

      if (window.__pmGuildBuyInFlight || window.__planMarketBuyInFlight) {
        return { ok: false, busy: true, reason: 'กำลังซื้อของในตลาดอยู่ รอสักครู่' };
      }
      window.__pmGuildBuyInFlight = true;
      window.__planMarketBuyInFlight = true;
      if (typeof window.pauseSniper === 'function') {
        try { window.pauseSniper(); } catch (e) {}
      }

      try {
        const hasAllInBag = () => cfg.items.every(req => countItem(req.itemId) >= req.need);
        if (!hasAllInBag()) {
          room.send('market', { op: 'collect_all' });
          await sleep(1200);
        }
        const g1 = getGuild();
        if (g1 && g1.donatedToday) {
          return { ok: true, alreadyDonated: true, donated: false };
        }

        const boughtSummary = [];
        let totalSpent = 0;

        const searchMarketPage = (q, page) => new Promise(resolve => {
          let unsub = null;
          const timer = setTimeout(() => {
            if (typeof unsub === 'function') { try { unsub(); } catch (e) {} }
            resolve([]);
          }, 3800);
          try {
            unsub = room.onMessage('market_results', msg => {
              clearTimeout(timer);
              if (typeof unsub === 'function') { try { unsub(); } catch (e) {} }
              resolve((msg && Array.isArray(msg.listings)) ? msg.listings : []);
            });
            room.send('market', { op: 'search', filters: { q, sort: 'price_asc', page } });
          } catch (e) {
            clearTimeout(timer);
            resolve([]);
          }
        });

        for (const req of cfg.items) {
          if (!req.itemId || !req.name) continue;
          for (let round = 0; round < 6; round++) {
            const gNow = getGuild();
            if (gNow && gNow.donatedToday) break;
            const haveNow = countItem(req.itemId);
            const left = req.need - haveNow;
            if (left <= 0) break;

            const zenyNow = getZeny();
            const canPay = Math.max(0, zenyNow - cfg.keepZeny);
            if (canPay <= 0) {
              return { ok: false, reason: 'เงิน Zeny หลังหักสำรองไม่พอซื้อ ' + req.name + ' (มี ' + zenyNow.toLocaleString() + 'z)' };
            }

            let best = null;
            let fallbackOverStack = null;
            for (let page = 0; page < 5 && !best; page++) {
              const now = Date.now();
              const listings = await searchMarketPage(req.name, page);
              if (!Array.isArray(listings) || listings.length === 0) break;

              const exactMatches = listings
                .filter(l => l && !l.mine && l.item && Number(l.item.itemId) === Number(req.itemId))
                .filter(l => !l.currency || l.currency === 'zeny')
                .filter(l => !(l.auctionEndsAt && l.auctionEndsAt > now))
                .map(l => {
                  const qty = Math.max(1, Number(l.qty) || 1);
                  const price = Number(l.price) || 0;
                  const unit = price / qty;
                  return { l, qty, price, unit };
                })
                .filter(c => c.price > 0 && c.price <= canPay && c.unit <= cfg.maxUnitPrice);

              const exactFit = exactMatches
                .filter(c => c.qty <= left)
                .sort((a, b) => (a.unit - b.unit) || (b.qty - a.qty))[0] || null;
              if (exactFit) {
                best = exactFit;
                break;
              }
              if (!fallbackOverStack) {
                fallbackOverStack = exactMatches
                  .filter(c => c.qty <= Math.max(left + 10, 20))
                  .sort((a, b) => (a.price - b.price) || (a.unit - b.unit))[0] || null;
              }
              if (listings.length < 20) break;
            }

            const chosen = best || fallbackOverStack;
            if (!chosen) {
              return {
                ok: false,
                marketShortage: true,
                reason: 'ไม่พบ ' + req.name + ' ในตลาดราคา ≤' + cfg.maxUnitPrice.toLocaleString() + 'z/ชิ้น (ขาดอีก ' + left + ' ชิ้น)'
              };
            }

            const beforeCount = countItem(req.itemId);
            room.send('market', { op: 'buy', listingId: Number(chosen.l.listingId), price: Number(chosen.price) });
            await sleep(950);
            room.send('market', { op: 'collect_all' });
            let got = 0;
            for (let w = 0; w < 14 && got <= 0; w++) {
              await sleep(250);
              got = countItem(req.itemId) - beforeCount;
            }
            if (got > 0) {
              totalSpent += chosen.price;
              boughtSummary.push(req.name + ' x' + got + ' (' + chosen.price.toLocaleString() + 'z)');
            }
            await sleep(350);
          }
        }

        const gBeforeDonate = getGuild();
        if (gBeforeDonate && gBeforeDonate.donatedToday) {
          return { ok: true, alreadyDonated: true, donated: false, boughtSummary, totalSpent };
        }
        if (!hasAllInBag()) {
          const stillMissing = cfg.items
            .map(r => ({ name: r.name, left: Math.max(0, r.need - countItem(r.itemId)) }))
            .filter(x => x.left > 0)
            .map(x => x.name + ' ขาด ' + x.left)
            .join(', ');
          return { ok: false, marketShortage: true, reason: 'ยังได้ของบริจาคไม่ครบ (' + stillMissing + ')', boughtSummary, totalSpent };
        }

        room.send('guild', { action: 'donateMaterial', tier: cfg.tier });
        await sleep(800);
        const gAfter = getGuild();
        const donatedOk = Boolean(gAfter && gAfter.donatedToday);
        return {
          ok: donatedOk,
          donated: donatedOk,
          tier: cfg.tier,
          exp: cfg.exp,
          boughtSummary,
          totalSpent,
          myPoints: gAfter ? Number(gAfter.myPoints || 0) : 0,
          zeny: getZeny()
        };
      } finally {
        window.__pmGuildBuyInFlight = false;
        window.__planMarketBuyInFlight = false;
        if (typeof window.resumeSniper === 'function') {
          try { window.resumeSniper(1000); } catch (e) {}
        }
      }
    } catch (err) {
      window.__pmGuildBuyInFlight = false;
      window.__planMarketBuyInFlight = false;
      return { ok: false, reason: err.message || 'error' };
    }
  })()`;
}

function buildSmartTopUpAndExchangeShopJs(shopCfg) {
  const cfgJson = JSON.stringify({
    want90341: shopCfg.exchangeAccessoryRune ? Math.min(1, Math.max(0, Number(shopCfg.accessoryRuneQty ?? 1))) : 0,
    want90340: shopCfg.exchangeEnchantRune ? Math.min(10, Math.max(0, Number(shopCfg.enchantRuneQty ?? 10))) : 0,
    autoTopUpZeny: Boolean(shopCfg.autoTopUpZenyForShop),
    keepZeny: Math.max(0, Number(shopCfg.keepZeny || 0)),
    requireDonatedTodayForTopUp: shopCfg.requireDonatedTodayForTopUp !== false
  });
  return `(async () => {
    const cfg = ${cfgJson};
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    try {
      const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
      if (!room || !room.state || (room.connection && room.connection.isOpen === false)) {
        return { ok: false, reason: 'ไม่ได้เชื่อมต่อห้องเกม' };
      }
      const getters = window.__pmGuildGetters || {};
      const getGuild = () => {
        try { if (getters.guild) return getters.guild(); } catch (e) {}
        return window.__pmGuildData || null;
      };
      const getChar = () => {
        try { if (getters.character) return getters.character(); } catch (e) {}
        return (typeof window.getLiveCharacterData === 'function' ? window.getLiveCharacterData() : null) || {};
      };
      const getZeny = () => {
        const ch = getChar();
        if (ch && ch.zeny != null) return Number(ch.zeny) || 0;
        try {
          const me = room.state.players && room.state.players.get(room.sessionId);
          if (me && me.zeny != null) return Number(me.zeny) || 0;
        } catch (e) {}
        return 0;
      };

      let g = getGuild();
      if (!g || !g.id) return { ok: false, reason: 'ตัวละครยังไม่มีกิลด์ในเกม' };

      const shopToday = (g.shopToday && typeof g.shopToday === 'object') ? g.shopToday : {};
      const bought90341 = Math.max(0, Number(shopToday['90341'] || 0));
      const bought90340 = Math.max(0, Number(shopToday['90340'] || 0));
      const rem90341 = Math.max(0, Math.min(1, cfg.want90341) - bought90341);
      const rem90340 = Math.max(0, Math.min(10, cfg.want90340) - bought90340);

      if (rem90341 <= 0 && rem90340 <= 0) {
        return { ok: true, alreadyCompleted: true, bought90341, bought90340, myPoints: Number(g.myPoints || 0) };
      }

      const fullPointsNeeded = (rem90341 * 60) + (rem90340 * 10);
      let myPoints = Math.max(0, Number(g.myPoints || 0));
      let missingPoints = Math.max(0, fullPointsNeeded - myPoints);
      let zenyDonated = 0;

      if (missingPoints > 0 && cfg.autoTopUpZeny) {
        if (cfg.requireDonatedTodayForTopUp && !g.donatedToday) {
          return {
            ok: false,
            waitingMaterialDonate: true,
            reason: 'รอบริจาคไอเทมรายวันก่อนคำนวณทบ Zeny แลกหิน (ขาดอีก ' + missingPoints + ' แต้ม)'
          };
        }
        const zenyNow = getZeny();
        const spendableZeny = Math.floor(Math.max(0, zenyNow - cfg.keepZeny) / 10000) * 10000;
        const maxExtraPoints = Math.floor(spendableZeny / 10000);
        const totalPossiblePoints = myPoints + maxExtraPoints;

        let planPts = 0;
        let remPossible = totalPossiblePoints;
        if (rem90341 > 0 && remPossible >= 60) {
          planPts += 60;
          remPossible -= 60;
        }
        if (rem90340 > 0 && remPossible >= 10) {
          const canBuy40 = Math.min(rem90340, Math.floor(remPossible / 10));
          planPts += canBuy40 * 10;
          remPossible -= canBuy40 * 10;
        }

        const topUpPoints = Math.max(0, planPts - myPoints);
        const topUpZeny = topUpPoints * 10000;
        if (topUpZeny >= 10000 && topUpZeny <= spendableZeny) {
          room.send('guild', { action: 'donateZeny', amount: topUpZeny });
          zenyDonated = topUpZeny;
          await sleep(750);
          g = getGuild() || g;
          myPoints = Math.max(0, Number(g.myPoints || 0));
        }
      }

      const exchanged = [];
      g = getGuild() || g;
      myPoints = Math.max(0, Number(g.myPoints || 0));
      const curShop0 = (g.shopToday && typeof g.shopToday === 'object') ? g.shopToday : {};
      const curRem90341 = Math.max(0, Math.min(1, cfg.want90341) - Math.max(0, Number(curShop0['90341'] || 0)));
      if (curRem90341 > 0 && myPoints >= 60) {
        room.send('guild', { action: 'shopBuy', itemId: 90341, qty: 1 });
        await sleep(650);
        g = getGuild() || g;
        myPoints = Math.max(0, Number(g.myPoints || 0));
        const after341 = Math.max(0, Number((g.shopToday && g.shopToday['90341']) || 0));
        if (after341 > bought90341) {
          exchanged.push('Accessory Enchant Rune x' + (after341 - bought90341));
        }
      }

      g = getGuild() || g;
      myPoints = Math.max(0, Number(g.myPoints || 0));
      const curShop1 = (g.shopToday && typeof g.shopToday === 'object') ? g.shopToday : {};
      const curRem90340 = Math.max(0, Math.min(10, cfg.want90340) - Math.max(0, Number(curShop1['90340'] || 0)));
      const buyQty90340 = Math.min(curRem90340, Math.floor(myPoints / 10));
      if (buyQty90340 > 0) {
        room.send('guild', { action: 'shopBuy', itemId: 90340, qty: buyQty90340 });
        await sleep(650);
        g = getGuild() || g;
        myPoints = Math.max(0, Number(g.myPoints || 0));
        const after340 = Math.max(0, Number((g.shopToday && g.shopToday['90340']) || 0));
        if (after340 > bought90340) {
          exchanged.push('Enchant Rune x' + (after340 - bought90340));
        }
      }

      const finalShop = (g && g.shopToday && typeof g.shopToday === 'object') ? g.shopToday : {};
      const final90341 = Math.max(0, Number(finalShop['90341'] || 0));
      const final90340 = Math.max(0, Number(finalShop['90340'] || 0));
      const allDone = (final90341 >= cfg.want90341) && (final90340 >= cfg.want90340);

      if (exchanged.length === 0 && !allDone) {
        const stillNeedPts = Math.max(0, ((cfg.want90341 - final90341) * 60) + ((cfg.want90340 - final90340) * 10) - myPoints);
        const zenyShort = stillNeedPts * 10000;
        return {
          ok: false,
          shortZeny: true,
          zenyDonated,
          myPoints,
          bought90341: final90341,
          bought90340: final90340,
          reason: !g.donatedToday
            ? 'รอบริจาคของรายวันก่อนแลกหิน'
            : ('แต้ม/เงินไม่พอแลกหิน (มี ' + myPoints + ' แต้ม, ขาดอีก ' + stillNeedPts + ' แต้ม = ' + zenyShort.toLocaleString() + 'z)')
        };
      }

      return {
        ok: true,
        allDone,
        exchanged,
        zenyDonated,
        myPoints,
        bought90341: final90341,
        bought90340: final90340
      };
    } catch (err) {
      return { ok: false, reason: err.message || 'error' };
    }
  })()`;
}

function createGuildService({ loadProfiles, evalProfilePort, dataFile, isBusy }) {
  let state = loadState();
  // Runtime status per profileId
  const liveStatus = {};
  const donateBackoffUntil = {};
  const donateBackoffNote = {};
  const marketBuyBackoffUntil = {};
  const marketBuyBackoffNote = {};
  const shopExchangeBackoffUntil = {};
  const shopExchangeBackoffNote = {};
  let syncInFlight = false;
  let timer = null;

  function loadState() {
    try {
      if (fs.existsSync(dataFile)) {
        const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        if (raw && Array.isArray(raw.guilds)) {
          return {
            autoDonate: raw.autoDonate !== false,
            dailyRoutine: sanitizeDailyRoutine(raw.dailyRoutine),
            profileDonate: (raw.profileDonate && typeof raw.profileDonate === 'object') ? raw.profileDonate : {},
            lastDonatedDateByProfile: (raw.lastDonatedDateByProfile && typeof raw.lastDonatedDateByProfile === 'object') ? raw.lastDonatedDateByProfile : {},
            guilds: raw.guilds.map(g => ({
              id: String(g.id),
              name: String(g.name || '').trim(),
              inGameName: String(g.inGameName || g.name || '').trim(),
              leaderId: String(g.leaderId),
              memberIds: Array.isArray(g.memberIds) ? g.memberIds.map(String) : [],
              excludedMemberIds: Array.isArray(g.excludedMemberIds) ? g.excludedMemberIds.map(String) : [],
              autoFill: g.autoFill !== false,
              autoDonate: g.autoDonate !== false,
              lastDonatedDateByProfile: (g.lastDonatedDateByProfile && typeof g.lastDonatedDateByProfile === 'object') ? g.lastDonatedDateByProfile : {}
            }))
          };
        }
      }
    } catch (e) {
      console.error('[Guild] Failed to load guilds.json:', e.message);
    }
    return { autoDonate: true, dailyRoutine: sanitizeDailyRoutine(), profileDonate: {}, lastDonatedDateByProfile: {}, guilds: [] };
  }

  function isProfileDonateEnabled(profileId) {
    const id = String(profileId || '');
    if (!id) return false;
    if (state.profileDonate && typeof state.profileDonate[id] === 'boolean') {
      return state.profileDonate[id];
    }
    return true;
  }

  function saveState() {
    try {
      fs.mkdirSync(path.dirname(dataFile), { recursive: true });
      fs.writeFileSync(dataFile, JSON.stringify(state, null, 2), 'utf8');
    } catch (e) {
      console.error('[Guild] Failed to save guilds.json:', e.message);
    }
  }

  function findGuildOfProfile(profileId, ignoreGuildId = null) {
    const id = String(profileId);
    for (const g of state.guilds) {
      if (ignoreGuildId && g.id === ignoreGuildId) continue;
      if (g.leaderId === id || g.memberIds.includes(id)) return g;
    }
    return null;
  }

  async function probeClient(port) {
    if (!port) return { inWorld: false };
    const r = await evalProfilePort(port, PROBE_GUILD_CLIENT_JS, 4000);
    if (!r || !r.success || !r.result) return { inWorld: false, offline: true };
    return r.result;
  }

  async function probeAllConfigured() {
    const profiles = loadProfiles();
    const byId = new Map(profiles.map(p => [String(p.id), p]));
    const results = new Map();
    await Promise.all(profiles.map(async (p) => {
      const id = String(p.id);
      if (!p || !p.debugPort) {
        results.set(id, { inWorld: false, offline: true });
        return;
      }
      const pr = await probeClient(p.debugPort);
      results.set(id, pr);
      if (pr && pr.inWorld) {
        if (pr.newMemberCooldownNote) {
          donateBackoffNote[id] = pr.newMemberCooldownNote;
          const targetUntil = pr.newMemberUnlockAt && pr.newMemberUnlockAt > Date.now()
            ? Math.min(pr.newMemberUnlockAt, Date.now() + 15 * 60 * 1000)
            : (Date.now() + 15 * 60 * 1000);
          if (!donateBackoffUntil[id] || donateBackoffUntil[id] < Date.now() || donateBackoffUntil[id] > targetUntil) {
            donateBackoffUntil[id] = targetUntil;
          }
        } else if (pr.newMemberUnlockAt === 0 && donateBackoffUntil[id] && donateBackoffUntil[id] <= Date.now()) {
          delete donateBackoffUntil[id];
          delete donateBackoffNote[id];
        }
        liveStatus[id] = {
          ...(liveStatus[id] || {}),
          online: true,
          charName: pr.charName,
          level: pr.level,
          jobLevel: pr.jobLevel,
          className: pr.className,
          zeny: pr.zeny,
          mapName: pr.mapName,
          inGameGuild: pr.inGameGuild,
          donatedToday: !!(pr.inGameGuild && pr.inGameGuild.donatedToday),
          myPoints: pr.inGameGuild ? pr.inGameGuild.myPoints : 0,
          donatableTiers: pr.donatableTiers || [],
          cooldownNote: pr.newMemberCooldownNote || (donateBackoffUntil[id] > Date.now() ? donateBackoffNote[id] : null) || null
        };
      } else {
        liveStatus[id] = { ...(liveStatus[id] || {}), online: false };
      }
    }));
    return { byId, results };
  }

  function setActionNote(profileId, note) {
    liveStatus[profileId] = {
      ...(liveStatus[profileId] || {}),
      lastAction: note,
      lastActionAt: Date.now()
    };
  }

  function getThaiDateKey() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
    } catch (_) {
      return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    }
  }

  // Automatically picks unassigned online characters into guild `g`
  function autoFillMembersForGuild(g, byId, probes) {
    if (g.autoFill === false) return false;
    let changed = false;
    const leaderProbe = probes.get(g.leaderId);
    const maxMembers = (leaderProbe && leaderProbe.inGameGuild && leaderProbe.inGameGuild.maxMembers) || 20;
    const targetGuildName = normName(
      (leaderProbe && leaderProbe.inGameGuild && leaderProbe.inGameGuild.name) ||
      g.inGameName ||
      g.name
    );
    const excluded = new Set(Array.isArray(g.excludedMemberIds) ? g.excludedMemberIds : []);

    for (const [pid, p] of byId.entries()) {
      if (pid === g.leaderId) continue;
      if (excluded.has(pid)) continue;
      if (findGuildOfProfile(pid)) continue;
      if (1 + g.memberIds.length >= maxMembers) break;

      const pr = probes.get(pid);
      if (!pr || !pr.inWorld || !pr.charName) continue;

      // Include if character has no guild in-game OR is already in this guild in-game
      const prGuildName = pr.inGameGuild ? normName(pr.inGameGuild.name) : '';
      if (!pr.inGameGuild || (targetGuildName && prGuildName === targetGuildName)) {
        g.memberIds.push(pid);
        changed = true;
      }
    }
    if (changed) saveState();
    return changed;
  }

  async function tryAutoDonateForProfile(g, profileId, profile, probe, force = false) {
    const pid = String(profileId);
    if (!force) {
      if (state.autoDonate === false) return false;
      if (g && g.autoDonate === false) return false;
      if (!isProfileDonateEnabled(pid)) return false;
    }
    if (!profile || !profile.debugPort || !probe || !probe.inWorld) return false;
    const ig = probe.inGameGuild;
    if (!ig || !ig.id) return false;
    if (!state.lastDonatedDateByProfile) state.lastDonatedDateByProfile = {};
    if (ig.donatedToday) {
      delete donateBackoffUntil[pid];
      delete donateBackoffNote[pid];
      const today = getThaiDateKey();
      let dirty = false;
      if (g && g.lastDonatedDateByProfile && g.lastDonatedDateByProfile[pid] !== today) {
        g.lastDonatedDateByProfile[pid] = today;
        dirty = true;
      }
      if (state.lastDonatedDateByProfile[pid] !== today) {
        state.lastDonatedDateByProfile[pid] = today;
        dirty = true;
      }
      if (dirty) saveState();
      return false;
    }
    if (!force && probe.newMemberCooldownNote) {
      donateBackoffUntil[pid] = probe.newMemberUnlockAt && probe.newMemberUnlockAt > Date.now()
        ? Math.min(probe.newMemberUnlockAt, Date.now() + 15 * 60 * 1000)
        : (Date.now() + 15 * 60 * 1000);
      donateBackoffNote[pid] = probe.newMemberCooldownNote;
      setActionNote(pid, probe.newMemberCooldownNote);
      return false;
    }
    if (!force && donateBackoffUntil[pid] && donateBackoffUntil[pid] > Date.now()) {
      setActionNote(pid, donateBackoffNote[pid] || 'รอครบ 24 ชม. จึงบริจาคได้');
      return false;
    }
    const tiers = Array.isArray(probe.donatableTiers) ? probe.donatableTiers : [];
    if (tiers.length === 0) return false;

    const chosen = tiers[0]; // highest exp / tier available
    await evalProfilePort(profile.debugPort, sendGuildActionJs({ action: 'donateMaterial', tier: chosen.tier }), 3000);
    await new Promise(r => setTimeout(r, 550));
    const after = await probeClient(profile.debugPort);
    if (after && after.inWorld) {
      liveStatus[pid] = {
        ...(liveStatus[pid] || {}),
        online: true,
        charName: after.charName,
        zeny: after.zeny,
        inGameGuild: after.inGameGuild,
        donatedToday: !!(after.inGameGuild && after.inGameGuild.donatedToday),
        myPoints: after.inGameGuild ? after.inGameGuild.myPoints : 0,
        donatableTiers: after.donatableTiers || [],
        cooldownNote: after.newMemberCooldownNote || null
      };
      if (after.inGameGuild && after.inGameGuild.donatedToday) {
        delete donateBackoffUntil[pid];
        delete donateBackoffNote[pid];
        const today = getThaiDateKey();
        if (g && g.lastDonatedDateByProfile) g.lastDonatedDateByProfile[pid] = today;
        state.lastDonatedDateByProfile[pid] = today;
        saveState();
        setActionNote(pid, `บริจาคของรายวัน Tier ${chosen.tier} (+${chosen.exp} EXP)`);
        return true;
      }
      const note = after.newMemberCooldownNote || 'รอครบ 24 ชม. จึงบริจาคได้';
      donateBackoffUntil[pid] = after.newMemberUnlockAt && after.newMemberUnlockAt > Date.now()
        ? Math.min(after.newMemberUnlockAt, Date.now() + 15 * 60 * 1000)
        : (Date.now() + 15 * 60 * 1000);
      donateBackoffNote[pid] = note;
      setActionNote(pid, note);
      return false;
    }
    return false;
  }

  // Buy missing daily donation materials from Market (strictly once per day when !donatedToday) and donate immediately
  async function tryBuyMissingMaterialsAndDonate(g, profileId, profile, probe, force = false) {
    const pid = String(profileId);
    const dr = sanitizeDailyRoutine(state.dailyRoutine);
    if (!force) {
      if (!dr.autoBuyDonateMaterials) return { ok: false, skipped: true };
      if (state.autoDonate === false) return { ok: false, skipped: true };
      if (g && g.autoDonate === false) return { ok: false, skipped: true };
      if (!isProfileDonateEnabled(pid)) return { ok: false, skipped: true };
      if (marketBuyBackoffUntil[pid] && marketBuyBackoffUntil[pid] > Date.now()) {
        return { ok: false, skipped: true, reason: marketBuyBackoffNote[pid] || 'รอค้นตลาดใหม่' };
      }
    }
    if (!profile || !profile.debugPort || !probe || !probe.inWorld || !probe.roomOpen) {
      return { ok: false, skipped: true, reason: 'ตัวละครไม่ได้ออนไลน์ในเกม' };
    }
    const ig = probe.inGameGuild;
    if (!ig || !ig.id) {
      return { ok: false, skipped: true, reason: 'ตัวละครยังไม่มีกิลด์ในเกม' };
    }
    if (ig.donatedToday) {
      delete marketBuyBackoffUntil[pid];
      delete marketBuyBackoffNote[pid];
      return { ok: true, alreadyDonated: true, donated: false };
    }
    if (probe.newMemberCooldownNote || (donateBackoffUntil[pid] && donateBackoffUntil[pid] > Date.now())) {
      const note = probe.newMemberCooldownNote || donateBackoffNote[pid] || 'รอครบ 24 ชม. จึงบริจาคได้';
      setActionNote(pid, note);
      return { ok: false, cooldown: true, reason: note };
    }

    // If character already has items in bag, use direct donate without touching market
    if (Array.isArray(probe.donatableTiers) && probe.donatableTiers.length > 0) {
      const ok = await tryAutoDonateForProfile(g, pid, profile, probe, true);
      return { ok, donated: ok, boughtSummary: [], totalSpent: 0 };
    }

    // Pick highest EXP tier where character level qualifies
    const eligibleTiers = (Array.isArray(ig.tierSummaries) ? ig.tierSummaries : [])
      .filter(t => t && t.lvOk && Array.isArray(t.items) && t.items.length > 0)
      .sort((a, b) => (b.exp - a.exp) || (b.tier - a.tier));
    if (eligibleTiers.length === 0) {
      return { ok: false, skipped: true, reason: 'เลเวลตัวละครยังไม่ถึงเกณฑ์บริจาคของ' };
    }
    const targetTier = eligibleTiers[0];

    setActionNote(pid, `🛒 กำลังเช็ก/ซื้อของบริจาครายวัน (Tier ${targetTier.tier})...`);
    const code = buildBuyMissingMaterialsAndDonateJs(targetTier, dr.maxMaterialUnitPrice, dr.keepZeny);
    const evalRes = await evalProfilePort(profile.debugPort, code, 28000);
    const r = (evalRes && evalRes.success && evalRes.result) ? evalRes.result : { ok: false, reason: 'คำสั่งซื้อของบริจาคไม่ตอบสนอง' };

    const after = await probeClient(profile.debugPort);
    if (after && after.inWorld) {
      liveStatus[pid] = {
        ...(liveStatus[pid] || {}),
        online: true,
        charName: after.charName,
        zeny: after.zeny,
        inGameGuild: after.inGameGuild,
        donatedToday: !!(after.inGameGuild && after.inGameGuild.donatedToday),
        myPoints: after.inGameGuild ? after.inGameGuild.myPoints : 0,
        shopToday: (after.inGameGuild && after.inGameGuild.shopToday) || {},
        donatableTiers: after.donatableTiers || [],
        cooldownNote: after.newMemberCooldownNote || null
      };
      if (after.inGameGuild && after.inGameGuild.donatedToday) {
        delete donateBackoffUntil[pid];
        delete donateBackoffNote[pid];
        delete marketBuyBackoffUntil[pid];
        delete marketBuyBackoffNote[pid];
        const today = getThaiDateKey();
        if (g && g.lastDonatedDateByProfile) g.lastDonatedDateByProfile[pid] = today;
        if (!state.lastDonatedDateByProfile) state.lastDonatedDateByProfile = {};
        state.lastDonatedDateByProfile[pid] = today;
        saveState();
        const boughtTxt = (Array.isArray(r.boughtSummary) && r.boughtSummary.length > 0)
          ? ` (ซื้อ ${r.boughtSummary.join(', ')})`
          : '';
        setActionNote(pid, `🎁 บริจาครายวันสำเร็จ +${targetTier.exp} แต้ม${boughtTxt}`);
        return { ok: true, donated: true, boughtSummary: r.boughtSummary || [], totalSpent: r.totalSpent || 0, afterProbe: after };
      }
      if (after.newMemberCooldownNote) {
        const cNote = after.newMemberCooldownNote;
        donateBackoffUntil[pid] = after.newMemberUnlockAt && after.newMemberUnlockAt > Date.now()
          ? Math.min(after.newMemberUnlockAt, Date.now() + 15 * 60 * 1000)
          : (Date.now() + 15 * 60 * 1000);
        donateBackoffNote[pid] = cNote;
        setActionNote(pid, cNote);
        return { ok: false, cooldown: true, reason: cNote, afterProbe: after };
      }
    }

    const failNote = r.reason || 'ยังหาซื้อของบริจาครายวันในตลาดไม่ได้';
    marketBuyBackoffUntil[pid] = Date.now() + 10 * 60 * 1000;
    marketBuyBackoffNote[pid] = failNote;
    setActionNote(pid, failNote);
    return { ok: false, reason: failNote, afterProbe: after };
  }

  // Exchange selected Guild Shop runes (and optionally top up exact missing points via Zeny after daily material donation)
  async function tryExchangeGuildShopForProfile(g, profileId, profile, probe, force = false) {
    const pid = String(profileId);
    const dr = sanitizeDailyRoutine(state.dailyRoutine);
    const want90341 = dr.exchangeAccessoryRune ? Math.min(1, Math.max(0, Number(dr.accessoryRuneQty ?? 1))) : 0;
    const want90340 = dr.exchangeEnchantRune ? Math.min(10, Math.max(0, Number(dr.enchantRuneQty ?? 10))) : 0;
    if (want90341 <= 0 && want90340 <= 0) {
      return { ok: false, skipped: true, reason: 'ไม่ได้ติ๊กเลือกหินที่จะแลกในตั้งค่า' };
    }
    if (!force) {
      if (!dr.autoExchangeShop) return { ok: false, skipped: true };
      if (!isProfileDonateEnabled(pid)) return { ok: false, skipped: true };
      if (shopExchangeBackoffUntil[pid] && shopExchangeBackoffUntil[pid] > Date.now()) {
        return { ok: false, skipped: true, reason: shopExchangeBackoffNote[pid] || 'รอแต้ม/เงินแลกหิน' };
      }
    }
    if (!profile || !profile.debugPort || !probe || !probe.inWorld || !probe.roomOpen) {
      return { ok: false, skipped: true, reason: 'ตัวละครไม่ได้ออนไลน์ในเกม' };
    }
    const ig = probe.inGameGuild;
    if (!ig || !ig.id) {
      return { ok: false, skipped: true, reason: 'ตัวละครยังไม่มีกิลด์ในเกม' };
    }

    const shopToday = (ig.shopToday && typeof ig.shopToday === 'object') ? ig.shopToday : {};
    const bought90341 = Math.max(0, Number(shopToday['90341'] || 0));
    const bought90340 = Math.max(0, Number(shopToday['90340'] || 0));
    const rem90341 = Math.max(0, want90341 - bought90341);
    const rem90340 = Math.max(0, want90340 - bought90340);
    if (rem90341 <= 0 && rem90340 <= 0) {
      delete shopExchangeBackoffUntil[pid];
      delete shopExchangeBackoffNote[pid];
      return { ok: true, alreadyCompleted: true, exchanged: [], zenyDonated: 0 };
    }

    if (probe.newMemberCooldownNote || (donateBackoffUntil[pid] && donateBackoffUntil[pid] > Date.now())) {
      const cNote = probe.newMemberCooldownNote || donateBackoffNote[pid] || 'รอครบ 24 ชม.';
      return { ok: false, cooldown: true, reason: cNote };
    }

    const pointsNeededNow = (rem90341 * 60) + (rem90340 * 10);
    const myPoints = Math.max(0, Number(ig.myPoints || 0));
    // Wait for daily material donation first before topping up Zeny, unless points are already sufficient
    if (!ig.donatedToday && myPoints < pointsNeededNow) {
      return { ok: false, waitingMaterialDonate: true, reason: 'รอบริจาคไอเทมรายวันก่อนคำนวณทบ Zeny แลกหิน' };
    }

    const code = buildSmartTopUpAndExchangeShopJs({
      ...dr,
      requireDonatedTodayForTopUp: true
    });
    const evalRes = await evalProfilePort(profile.debugPort, code, 12000);
    const r = (evalRes && evalRes.success && evalRes.result) ? evalRes.result : { ok: false, reason: 'คำสั่งแลกหินร้านค้ากิลด์ไม่ตอบสนอง' };

    const after = await probeClient(profile.debugPort);
    if (after && after.inWorld) {
      liveStatus[pid] = {
        ...(liveStatus[pid] || {}),
        online: true,
        charName: after.charName,
        zeny: after.zeny,
        inGameGuild: after.inGameGuild,
        donatedToday: !!(after.inGameGuild && after.inGameGuild.donatedToday),
        myPoints: after.inGameGuild ? after.inGameGuild.myPoints : 0,
        shopToday: (after.inGameGuild && after.inGameGuild.shopToday) || {},
        donatableTiers: after.donatableTiers || [],
        cooldownNote: after.newMemberCooldownNote || null
      };
    }

    if (r.ok) {
      delete shopExchangeBackoffUntil[pid];
      delete shopExchangeBackoffNote[pid];
      if (Array.isArray(r.exchanged) && r.exchanged.length > 0) {
        const zTxt = r.zenyDonated > 0 ? ` (ทบ ${Number(r.zenyDonated).toLocaleString()}z)` : '';
        setActionNote(pid, `💎 แลก ${r.exchanged.join(' + ')} สำเร็จ${zTxt}`);
      }
      return {
        ok: true,
        alreadyCompleted: Boolean(r.alreadyCompleted),
        exchanged: r.exchanged || [],
        zenyDonated: Number(r.zenyDonated || 0)
      };
    }

    const note = r.reason || 'แต้ม/เงินไม่พอแลกหินร้านค้ากิลด์';
    shopExchangeBackoffUntil[pid] = Date.now() + 5 * 60 * 1000;
    shopExchangeBackoffNote[pid] = note;
    if (!r.waitingMaterialDonate) {
      setActionNote(pid, note);
    }
    return { ok: false, reason: note };
  }

  async function donateZenyForProfile(profileId, profile, amount, keepZeny = 0) {
    const pid = String(profileId || '');
    if (!profile || !profile.debugPort) {
      return { ok: false, profileId: pid, reason: 'โปรไฟล์ไม่ได้เปิดจอเกม' };
    }
    const probe = await probeClient(profile.debugPort);
    if (!probe || !probe.inWorld || !probe.roomOpen) {
      return { ok: false, profileId: pid, reason: 'ตัวละครไม่ได้ออนไลน์ในเกม' };
    }
    const ig = probe.inGameGuild;
    if (!ig || !ig.id) {
      return { ok: false, profileId: pid, charName: probe.charName, reason: 'ตัวละครยังไม่มีกิลด์ในเกม' };
    }
    const curZeny = Math.max(0, Math.floor(Number(probe.zeny || 0)));
    const reserve = Math.max(0, Math.floor(Number(keepZeny || 0)));
    const spendable = Math.max(0, curZeny - reserve);
    const reqAmount = (amount === 'all' || Number(amount) <= 0)
      ? spendable
      : Math.min(Math.floor(Number(amount || 0)), spendable);
    const finalAmount = Math.floor(reqAmount / 10000) * 10000;
    if (finalAmount < 10000) {
      const reason = curZeny < 10000
        ? `เงินไม่พอ (${curZeny.toLocaleString()}z < 10,000z)`
        : (spendable < 10000
          ? `เงินหลังหักสำรองไม่ถึง 10,000z (มี ${curZeny.toLocaleString()}z, เก็บไว้ ${reserve.toLocaleString()}z)`
          : 'จำนวนเงินบริจาคต้องอย่างน้อย 10,000z (ทวีคูณละ 10,000z)');
      setActionNote(pid, reason);
      return { ok: false, skipped: true, profileId: pid, charName: probe.charName, guildName: ig.name, zeny: curZeny, reason };
    }

    await evalProfilePort(profile.debugPort, sendGuildActionJs({ action: 'donateZeny', amount: finalAmount }), 3500);
    await new Promise(r => setTimeout(r, 600));
    const after = await probeClient(profile.debugPort);
    const zenyAfter = (after && after.inWorld && typeof after.zeny === 'number') ? after.zeny : Math.max(0, curZeny - finalAmount);
    const actualDonated = Math.max(0, curZeny - zenyAfter) || finalAmount;
    const expGained = Math.floor(actualDonated / 10000);
    if (after && after.inWorld) {
      liveStatus[pid] = {
        ...(liveStatus[pid] || {}),
        online: true,
        charName: after.charName,
        zeny: after.zeny,
        inGameGuild: after.inGameGuild,
        donatedToday: !!(after.inGameGuild && after.inGameGuild.donatedToday),
        myPoints: after.inGameGuild ? after.inGameGuild.myPoints : 0,
        donatableTiers: after.donatableTiers || []
      };
    }
    setActionNote(pid, `บริจาคเงิน ${actualDonated.toLocaleString()}z (+${expGained} EXP/แต้ม)`);
    return {
      ok: true,
      profileId: pid,
      charName: probe.charName,
      guildName: ig.name,
      donatedAmount: actualDonated,
      expGained,
      zenyBefore: curZeny,
      zenyAfter
    };
  }

  async function syncSingleGuild(g, byId, probes) {
    // 1. Auto-select available online members if enabled
    autoFillMembersForGuild(g, byId, probes);

    const leaderProfile = byId.get(g.leaderId);
    let leaderProbe = probes.get(g.leaderId);

    if (!leaderProfile || !leaderProfile.debugPort || !leaderProbe || !leaderProbe.inWorld || !leaderProbe.roomOpen) {
      setActionNote(g.leaderId, 'รอหัวกิลด์ออนไลน์ในเกม');
      // Still allow existing guild members who are already in-game guild to donate daily
      for (const memId of g.memberIds) {
        const mp = byId.get(memId);
        const mpr = probes.get(memId);
        if (mp && mpr && mpr.inWorld && mpr.inGameGuild) {
          await tryAutoDonateForProfile(g, memId, mp, mpr);
        }
      }
      return;
    }

    // 2. Ensure Leader has a guild in-game (create if not in a guild yet)
    if (!leaderProbe.inGameGuild) {
      const desiredName = String(g.name || '').trim();
      if (desiredName.length < 2 || desiredName.length > 16) {
        setActionNote(g.leaderId, 'ชื่อกิลด์ต้องยาว 2–16 ตัวอักษร');
        return;
      }
      if (Number(leaderProbe.zeny || 0) < 10000) {
        setActionNote(g.leaderId, 'หัวกิลด์ต้องมีอย่างน้อย 10,000z เพื่อสร้างกิลด์');
        return;
      }
      setActionNote(g.leaderId, `กำลังสร้างกิลด์ "${desiredName}"`);
      await evalProfilePort(leaderProfile.debugPort, sendGuildActionJs({ action: 'create', name: desiredName }), 3000);
      await new Promise(r => setTimeout(r, 900));
      leaderProbe = await probeClient(leaderProfile.debugPort);
      probes.set(g.leaderId, leaderProbe);
      if (leaderProbe && leaderProbe.inWorld) {
        liveStatus[g.leaderId] = {
          ...(liveStatus[g.leaderId] || {}),
          online: true,
          charName: leaderProbe.charName,
          zeny: leaderProbe.zeny,
          inGameGuild: leaderProbe.inGameGuild,
          donatedToday: !!(leaderProbe.inGameGuild && leaderProbe.inGameGuild.donatedToday),
          donatableTiers: leaderProbe.donatableTiers || []
        };
      }
      if (!leaderProbe || !leaderProbe.inGameGuild) {
        setActionNote(g.leaderId, `สั่งสร้างกิลด์ "${desiredName}" แล้ว (รอเซิร์ฟเวอร์ตอบกลับ)`);
        return;
      }
    }

    // Sync guild name from in-game guild
    const igGuild = leaderProbe.inGameGuild;
    if (igGuild && igGuild.name && g.inGameName !== igGuild.name) {
      g.inGameName = igGuild.name;
      if (!g.name) g.name = igGuild.name;
      saveState();
    }

    // Re-run auto-fill now that we know the leader's in-game guild
    autoFillMembersForGuild(g, byId, probes);

    // 3. Auto-donate for leader if possible
    const leaderDonated = await tryAutoDonateForProfile(g, g.leaderId, leaderProfile, leaderProbe);
    if (!leaderDonated) {
      setActionNote(g.leaderId, igGuild.donatedToday ? 'หัวกิลด์ (บริจาครายวันแล้ว)' : 'หัวกิลด์พร้อม');
    }

    // Authoritative guild roster from the leader's in-game guild state
    const inGameMemberNames = new Set((igGuild.members || []).map(m => normName(m.name)));
    let currentMemberCount = (igGuild.members || []).length || 1;
    const maxMembers = igGuild.maxMembers || 20;
    const toInvite = [];
    let anyChanged = false;

    // 4. Sync each member (existing / pending invite / queue for invite)
    for (const memId of g.memberIds) {
      const memProfile = byId.get(memId);
      let memProbe = probes.get(memId);
      if (!memProfile || !memProfile.debugPort || !memProbe || !memProbe.inWorld || !memProbe.roomOpen) {
        setActionNote(memId, 'ออฟไลน์');
        continue;
      }

      const memInSameGuild = inGameMemberNames.size > 0
        ? inGameMemberNames.has(normName(memProbe.charName))
        : !!(memProbe.inGameGuild && (memProbe.inGameGuild.id === igGuild.id || normName(memProbe.inGameGuild.name) === normName(igGuild.name)));

      if (memInSameGuild) {
        const donated = await tryAutoDonateForProfile(g, memId, memProfile, memProbe);
        if (donated) anyChanged = true;
        else {
          const isDonated = !!(memProbe.inGameGuild && memProbe.inGameGuild.donatedToday);
          const cooldownNote = memProbe.newMemberCooldownNote || (donateBackoffUntil[memId] > Date.now() ? donateBackoffNote[memId] : null);
          setActionNote(memId, isDonated ? 'บริจาครายวันแล้ว' : (cooldownNote || 'อยู่ในกิลด์แล้ว'));
        }
        continue;
      }

      // If member is in a genuinely different guild, leave it only if they are not master of that guild
      if (memProbe.inGameGuild && memProbe.inGameGuild.id !== igGuild.id && normName(memProbe.inGameGuild.name) !== normName(igGuild.name)) {
        const myEntry = (memProbe.inGameGuild.members || []).find(m => normName(m.name) === normName(memProbe.charName));
        if (myEntry && myEntry.role === 'master') {
          setActionNote(memId, `เป็นหัวกิลด์อื่นอยู่ (${memProbe.inGameGuild.name})`);
          continue;
        }
        setActionNote(memId, `ออกจากกิลด์เดิม (${memProbe.inGameGuild.name})`);
        await evalProfilePort(memProfile.debugPort, sendGuildActionJs({ action: 'leave' }), 3000);
        await new Promise(r => setTimeout(r, 500));
      }

      // Check if member already has a pending guild invite from this guild/leader
      const inv = memProbe.pendingGuildInvite;
      const inviteMatches = inv && (
        normName(inv.label) === normName(igGuild.name) ||
        normName(inv.from) === normName(leaderProbe.charName)
      );

      if (inviteMatches) {
        await evalProfilePort(memProfile.debugPort, sendGuildActionJs({ action: 'accept' }), 3000);
        setActionNote(memId, 'กดรับคำเชิญเข้ากิลด์');
        await new Promise(r => setTimeout(r, 700));
        memProbe = await probeClient(memProfile.debugPort);
        if (memProbe && memProbe.inWorld) {
          probes.set(memId, memProbe);
          liveStatus[memId] = {
            ...(liveStatus[memId] || {}),
            online: true,
            charName: memProbe.charName,
            inGameGuild: memProbe.inGameGuild,
            donatedToday: !!(memProbe.inGameGuild && memProbe.inGameGuild.donatedToday),
            myPoints: memProbe.inGameGuild ? memProbe.inGameGuild.myPoints : 0,
            donatableTiers: memProbe.donatableTiers || []
          };
          if (memProbe.inGameGuild) {
            currentMemberCount++;
            inGameMemberNames.add(normName(memProbe.charName));
            anyChanged = true;
            await tryAutoDonateForProfile(g, memId, memProfile, memProbe);
          }
        }
        continue;
      }

      if (currentMemberCount + toInvite.length >= maxMembers) {
        setActionNote(memId, `กิลด์เต็ม (${maxMembers} คน)`);
        continue;
      }

      if (toInvite.length < 4) {
        toInvite.push({ memId, memProfile, memProbe });
      } else {
        setActionNote(memId, 'รอคิวเชิญเข้ากิลด์...');
      }
    }

    // 5. Sequential invite + accept (1 member at a time to avoid cross-channel DB race condition)
    if (toInvite.length > 0) {
      for (const { memId, memProfile, memProbe } of toInvite) {
        try {
          setActionNote(memId, `เชิญ ${memProbe.charName} เข้ากิลด์`);
          await evalProfilePort(leaderProfile.debugPort, sendGuildActionJs({ action: 'invite', name: memProbe.charName }), 3000);
          await new Promise(r => setTimeout(r, 650));
          await evalProfilePort(memProfile.debugPort, sendGuildActionJs({ action: 'accept' }), 3000);
          setActionNote(memId, 'รับคำเชิญเข้ากิลด์แล้ว');
          await new Promise(r => setTimeout(r, 700));
          const joinedProbe = await probeClient(memProfile.debugPort);
          if (joinedProbe && joinedProbe.inWorld) {
            probes.set(memId, joinedProbe);
            liveStatus[memId] = {
              ...(liveStatus[memId] || {}),
              online: true,
              charName: joinedProbe.charName,
              inGameGuild: joinedProbe.inGameGuild,
              donatedToday: !!(joinedProbe.inGameGuild && joinedProbe.inGameGuild.donatedToday),
              myPoints: joinedProbe.inGameGuild ? joinedProbe.inGameGuild.myPoints : 0,
              donatableTiers: joinedProbe.donatableTiers || []
            };
            if (joinedProbe.inGameGuild) {
              anyChanged = true;
              const donated = await tryAutoDonateForProfile(g, memId, memProfile, joinedProbe);
              if (!donated) {
                const cooldownNote = joinedProbe.newMemberCooldownNote || (donateBackoffUntil[memId] > Date.now() ? donateBackoffNote[memId] : null);
                setActionNote(memId, joinedProbe.inGameGuild.donatedToday ? 'บริจาครายวันแล้ว' : (cooldownNote || 'อยู่ในกิลด์แล้ว'));
              }
            }
          }
        } catch (_) {}
      }
    }

    // 6. Refresh leader probe if guild membership or donations changed
    if (anyChanged || leaderDonated) {
      const freshLeader = await probeClient(leaderProfile.debugPort);
      if (freshLeader && freshLeader.inWorld) {
        probes.set(g.leaderId, freshLeader);
        liveStatus[g.leaderId] = {
          ...(liveStatus[g.leaderId] || {}),
          online: true,
          charName: freshLeader.charName,
          zeny: freshLeader.zeny,
          inGameGuild: freshLeader.inGameGuild,
          donatedToday: !!(freshLeader.inGameGuild && freshLeader.inGameGuild.donatedToday),
          myPoints: freshLeader.inGameGuild ? freshLeader.inGameGuild.myPoints : 0,
          donatableTiers: freshLeader.donatableTiers || []
        };
      }
    }
  }

  async function syncAllGuilds() {
    if (syncInFlight) return { skipped: 'in-flight' };
    if (typeof isBusy === 'function' && isBusy()) return { skipped: 'busy' };

    syncInFlight = true;
    try {
      const { byId, results: probes } = await probeAllConfigured();
      for (const g of state.guilds) {
        try {
          await syncSingleGuild(g, byId, probes);
        } catch (e) {
          console.error(`[Guild] sync error on ${g.id}:`, e.message);
        }
      }

      // Sync daily item auto-donation for characters in external guilds (not in any Manager guild card)
      const assigned = new Set();
      for (const g of state.guilds) {
        assigned.add(String(g.leaderId));
        for (const m of g.memberIds) assigned.add(String(m));
      }
      for (const [pid, p] of byId.entries()) {
        if (assigned.has(pid)) continue;
        const pr = probes.get(pid);
        if (!p || !pr || !pr.inWorld || !pr.inGameGuild) continue;
        try {
          const donated = await tryAutoDonateForProfile(null, pid, p, pr, false);
          if (!donated) {
            const isDonated = !!(pr.inGameGuild && pr.inGameGuild.donatedToday);
            const cooldownNote = pr.newMemberCooldownNote || (donateBackoffUntil[pid] > Date.now() ? donateBackoffNote[pid] : null);
            const donateOff = !isProfileDonateEnabled(pid) || state.autoDonate === false;
            setActionNote(pid, isDonated ? 'บริจาครายวันแล้ว' : (donateOff ? 'ปิดบริจาคของออโต้ไว้' : (cooldownNote || `สังกัดกิลด์ ${pr.inGameGuild.name}`)));
          }
        } catch (e) {
          console.error(`[Guild] external donate error on ${pid}:`, e.message);
        }
      }

      // Daily Routine Pass:
      //  (A) Auto-buy missing daily donation materials from Market (max 1 character per sync tick to avoid market search rate limit)
      //  (B) Auto-exchange selected Guild Shop runes (and smart Zeny top-up after daily material donation is done)
      const dr = sanitizeDailyRoutine(state.dailyRoutine);
      if (dr.autoBuyDonateMaterials || dr.autoExchangeShop) {
        let marketBuyDoneThisTick = 0;
        let shopExchangeDoneThisTick = 0;
        for (const [pid, p] of byId.entries()) {
          let pr = probes.get(pid);
          if (!p || !pr || !pr.inWorld || !pr.inGameGuild) continue;
          const gCard = findGuildOfProfile(pid);

          // Step A: If not donated today & missing materials, auto-buy from market and donate (1 per tick)
          if (dr.autoBuyDonateMaterials && !pr.inGameGuild.donatedToday && marketBuyDoneThisTick < 1) {
            const canTryBuy = state.autoDonate !== false &&
              (!gCard || gCard.autoDonate !== false) &&
              isProfileDonateEnabled(pid) &&
              !pr.newMemberCooldownNote &&
              !(donateBackoffUntil[pid] > Date.now()) &&
              !(marketBuyBackoffUntil[pid] > Date.now()) &&
              (!Array.isArray(pr.donatableTiers) || pr.donatableTiers.length === 0);
            if (canTryBuy) {
              marketBuyDoneThisTick++;
              const buyRes = await tryBuyMissingMaterialsAndDonate(gCard, pid, p, pr, false);
              if (buyRes && buyRes.afterProbe) {
                pr = buyRes.afterProbe;
                probes.set(pid, pr);
              }
            }
          }

          // Step B: Auto-exchange Guild Shop runes (up to 2 characters per tick)
          if (dr.autoExchangeShop && shopExchangeDoneThisTick < 2) {
            const ig = pr.inGameGuild;
            const shopToday = (ig && ig.shopToday && typeof ig.shopToday === 'object') ? ig.shopToday : {};
            const want90341 = dr.exchangeAccessoryRune ? Math.min(1, Math.max(0, Number(dr.accessoryRuneQty ?? 1))) : 0;
            const want90340 = dr.exchangeEnchantRune ? Math.min(10, Math.max(0, Number(dr.enchantRuneQty ?? 10))) : 0;
            const rem90341 = Math.max(0, want90341 - Math.max(0, Number(shopToday['90341'] || 0)));
            const rem90340 = Math.max(0, want90340 - Math.max(0, Number(shopToday['90340'] || 0)));
            const ptsNeed = (rem90341 * 60) + (rem90340 * 10);
            const readyForShop = (rem90341 > 0 || rem90340 > 0) &&
              isProfileDonateEnabled(pid) &&
              !pr.newMemberCooldownNote &&
              !(donateBackoffUntil[pid] > Date.now()) &&
              !(shopExchangeBackoffUntil[pid] > Date.now()) &&
              (ig.donatedToday || Number(ig.myPoints || 0) >= ptsNeed);
            if (readyForShop) {
              shopExchangeDoneThisTick++;
              await tryExchangeGuildShopForProfile(gCard, pid, p, pr, false);
            }
          }
        }
      }

      return { ok: true, count: state.guilds.length };
    } finally {
      syncInFlight = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      syncAllGuilds().catch(() => {});
    }, 5500);
    setTimeout(() => syncAllGuilds().catch(() => {}), 2500);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function buildPublicView() {
    const profiles = loadProfiles();
    const byId = new Map(profiles.map(p => [String(p.id), p]));

    const decorateProfile = (id) => {
      const p = byId.get(String(id));
      const ls = liveStatus[String(id)] || {};
      const ig = ls.inGameGuild || null;
      return {
        id: String(id),
        name: p ? p.name : `(ลบแล้ว #${id})`,
        charName: ls.charName || (p && (p.lastCharName || p.characterName)) || '',
        charClass: ls.className || (p && (p.lastCharClass || p.charClass)) || '',
        portrait: (p && p.lastPortrait) || null,
        level: ls.level || null,
        jobLevel: ls.jobLevel || null,
        zeny: ls.zeny ?? null,
        mapName: ls.mapName || (p && p.targetMap) || '',
        online: !!ls.online,
        inGameGuildName: ig ? ig.name : null,
        inGameGuildLevel: ig ? ig.level : null,
        inGameGuildExp: ig ? ig.exp : null,
        inGameGuildExpToNext: ig ? ig.expToNext : null,
        tierSummaries: ig ? (ig.tierSummaries || []) : [],
        autoDonate: isProfileDonateEnabled(id),
        donatedToday: !!(ig && ig.donatedToday),
        myPoints: ig ? ig.myPoints : 0,
        shopToday: (ig && ig.shopToday && typeof ig.shopToday === 'object') ? ig.shopToday : {},
        canDonateCount: Array.isArray(ls.donatableTiers) ? ls.donatableTiers.length : 0,
        donatableTiers: ls.donatableTiers || [],
        cooldownNote: ls.cooldownNote || (donateBackoffUntil[String(id)] > Date.now() ? donateBackoffNote[String(id)] : null) || null,
        lastAction: ls.lastAction || null,
        lastActionAt: ls.lastActionAt || null
      };
    };

    const guilds = state.guilds.map(g => {
      const leader = decorateProfile(g.leaderId);
      const leaderIg = (liveStatus[g.leaderId] && liveStatus[g.leaderId].inGameGuild) || null;
      const inGameRoster = leaderIg && Array.isArray(leaderIg.members) && leaderIg.members.length > 0
        ? new Set(leaderIg.members.map(m => normName(m.name)))
        : null;
      const members = g.memberIds.map(id => {
        const m = decorateProfile(id);
        if (inGameRoster && m.charName) {
          const inRoster = inGameRoster.has(normName(m.charName));
          if (!inRoster && m.inGameGuildName && leaderIg && normName(m.inGameGuildName) === normName(leaderIg.name)) {
            m.inGameGuildName = null;
          } else if (inRoster && !m.inGameGuildName && leaderIg) {
            m.inGameGuildName = leaderIg.name;
            m.inGameGuildLevel = leaderIg.level;
          }
        }
        return m;
      });
      const allMembers = [leader, ...members];
      const donatedCount = allMembers.filter(m => m.donatedToday).length;
      return {
        id: g.id,
        name: g.inGameName || g.name || 'กิลด์ใหม่',
        desiredName: g.name || '',
        inGameName: g.inGameName || (leaderIg ? leaderIg.name : ''),
        guildLevel: leaderIg ? leaderIg.level : null,
        guildExp: leaderIg ? leaderIg.exp : null,
        guildExpToNext: leaderIg ? leaderIg.expToNext : null,
        maxMembers: leaderIg ? leaderIg.maxMembers : 20,
        inGameMemberCount: leaderIg && Array.isArray(leaderIg.members) ? leaderIg.members.length : null,
        totalDonated: leaderIg ? leaderIg.totalDonated : null,
        tierSummaries: leaderIg ? (leaderIg.tierSummaries || []) : [],
        autoFill: g.autoFill !== false,
        autoDonate: g.autoDonate !== false,
        leaderId: g.leaderId,
        leader,
        memberIds: g.memberIds,
        members,
        donatedCount,
        totalAssigned: allMembers.length
      };
    });

    const assigned = new Set();
    for (const g of state.guilds) {
      assigned.add(g.leaderId);
      for (const m of g.memberIds) assigned.add(m);
    }

    const availableProfiles = profiles
      .filter(p => !assigned.has(String(p.id)))
      .map(p => decorateProfile(p.id));

    const externalGuildProfiles = availableProfiles.filter(p => Boolean(p.inGameGuildName));

    return {
      autoDonate: state.autoDonate !== false,
      dailyRoutine: sanitizeDailyRoutine(state.dailyRoutine),
      profileDonate: state.profileDonate || {},
      guilds,
      externalGuildProfiles,
      availableProfiles,
      allProfiles: profiles.map(p => ({
        ...decorateProfile(p.id),
        inGuildId: (findGuildOfProfile(p.id) || {}).id || null
      }))
    };
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let b = '';
      req.on('data', c => {
        b += c;
        if (b.length > 65536) { req.destroy(); reject(new Error('Body too large')); }
      });
      req.on('end', () => {
        try { resolve(b ? JSON.parse(b) : {}); }
        catch (e) { reject(new Error('Invalid JSON')); }
      });
      req.on('error', reject);
    });
  }

  async function handleRoute(req, res, pathname, sendJSON) {
    if (!pathname.startsWith('/api/guilds')) return false;

    // GET /api/guilds
    if (req.method === 'GET' && pathname === '/api/guilds') {
      await probeAllConfigured().catch(() => {});
      return sendJSON({ success: true, ...buildPublicView() }), true;
    }

    // POST /api/guilds/sync
    if (req.method === 'POST' && pathname === '/api/guilds/sync') {
      const r = await syncAllGuilds();
      return sendJSON({ success: true, sync: r, ...buildPublicView() }), true;
    }

    // POST /api/guilds/settings — toggle global autoDonate and/or update dailyRoutine config
    if (req.method === 'POST' && pathname === '/api/guilds/settings') {
      try {
        const body = await readBody(req);
        let changed = false;
        if (typeof body.autoDonate === 'boolean') {
          state.autoDonate = body.autoDonate;
          changed = true;
        }
        if (body.dailyRoutine && typeof body.dailyRoutine === 'object') {
          state.dailyRoutine = sanitizeDailyRoutine({
            ...(state.dailyRoutine || {}),
            ...body.dailyRoutine
          });
          // Clear backoffs so new settings take effect immediately
          for (const k of Object.keys(marketBuyBackoffUntil)) delete marketBuyBackoffUntil[k];
          for (const k of Object.keys(marketBuyBackoffNote)) delete marketBuyBackoffNote[k];
          for (const k of Object.keys(shopExchangeBackoffUntil)) delete shopExchangeBackoffUntil[k];
          for (const k of Object.keys(shopExchangeBackoffNote)) delete shopExchangeBackoffNote[k];
          changed = true;
        }
        if (changed) {
          saveState();
          syncAllGuilds().catch(() => {});
        }
        return sendJSON({ success: true, ...buildPublicView() }), true;
      } catch (e) {
        return sendJSON({ success: false, error: e.message }, 400), true;
      }
    }

    // POST /api/guilds/run-daily-routine — run buy missing daily materials + donate + smart Zeny top-up + exchange runes
    if (req.method === 'POST' && pathname === '/api/guilds/run-daily-routine') {
      try {
        const body = await readBody(req);
        if (body.dailyRoutine && typeof body.dailyRoutine === 'object') {
          state.dailyRoutine = sanitizeDailyRoutine({
            ...(state.dailyRoutine || {}),
            ...body.dailyRoutine
          });
          saveState();
        }
        const { byId, results: probes } = await probeAllConfigured();
        const assigned = new Set();
        for (const g of state.guilds) {
          assigned.add(String(g.leaderId));
          for (const m of g.memberIds) assigned.add(String(m));
        }

        let targetIds = [];
        if (body.profileId) {
          targetIds = [String(body.profileId)];
        } else if (Array.isArray(body.profileIds) && body.profileIds.length > 0) {
          targetIds = body.profileIds.map(String);
        } else if (body.guildId) {
          const g = state.guilds.find(x => x.id === String(body.guildId));
          if (!g) return sendJSON({ success: false, error: 'ไม่พบกิลด์ที่ระบุ' }, 404), true;
          targetIds = [String(g.leaderId), ...g.memberIds.map(String)];
        } else if (body.scope === 'external') {
          targetIds = Array.from(byId.keys()).filter(pid => !assigned.has(pid));
        } else {
          targetIds = Array.from(byId.keys());
        }

        let donatedMaterialsCount = 0;
        let boughtMaterialsCount = 0;
        let exchangedCharsCount = 0;
        let totalTopUpZeny = 0;
        let cooldownCount = 0;

        for (const pid of targetIds) {
          const p = byId.get(pid);
          let pr = probes.get(pid);
          if (!p || !pr || !pr.inWorld || !pr.inGameGuild) continue;
          const gCard = findGuildOfProfile(pid);

          // 1. Daily Material Donation (direct or buy missing from market)
          if (!pr.inGameGuild.donatedToday) {
            const matRes = await tryBuyMissingMaterialsAndDonate(gCard, pid, p, pr, true);
            if (matRes && matRes.donated) {
              donatedMaterialsCount++;
              if (Array.isArray(matRes.boughtSummary) && matRes.boughtSummary.length > 0) {
                boughtMaterialsCount++;
              }
            } else if (matRes && matRes.cooldown) {
              cooldownCount++;
            }
            if (matRes && matRes.afterProbe) {
              pr = matRes.afterProbe;
              probes.set(pid, pr);
            } else {
              pr = await probeClient(p.debugPort);
              probes.set(pid, pr);
            }
          }

          // 2. Guild Shop Rune Exchange + Smart Zeny Top-Up
          if (pr && pr.inWorld && pr.inGameGuild) {
            const shopRes = await tryExchangeGuildShopForProfile(gCard, pid, p, pr, true);
            if (shopRes && shopRes.ok && Array.isArray(shopRes.exchanged) && shopRes.exchanged.length > 0) {
              exchangedCharsCount++;
              totalTopUpZeny += Number(shopRes.zenyDonated || 0);
            }
          }
        }

        await probeAllConfigured().catch(() => {});
        return sendJSON({
          success: true,
          donatedMaterialsCount,
          boughtMaterialsCount,
          exchangedCharsCount,
          totalTopUpZeny,
          cooldownCount,
          ...buildPublicView()
        }), true;
      } catch (e) {
        return sendJSON({ success: false, error: e.message }, 400), true;
      }
    }

    // POST /api/guilds/profile-donate — toggle per-character item autoDonate (works for both managed & external guilds)
    if (req.method === 'POST' && pathname === '/api/guilds/profile-donate') {
      try {
        const body = await readBody(req);
        if (!state.profileDonate || typeof state.profileDonate !== 'object') state.profileDonate = {};
        const enabled = !!body.autoDonate;
        const ids = Array.isArray(body.profileIds)
          ? body.profileIds.map(String).filter(Boolean)
          : (body.profileId ? [String(body.profileId)] : []);
        if (ids.length === 0) {
          return sendJSON({ success: false, error: 'กรุณาระบุตัวละคร' }, 400), true;
        }
        for (const id of ids) {
          state.profileDonate[id] = enabled;
        }
        saveState();
        if (enabled) syncAllGuilds().catch(() => {});
        return sendJSON({ success: true, ...buildPublicView() }), true;
      } catch (e) {
        return sendJSON({ success: false, error: e.message }, 400), true;
      }
    }

    // POST /api/guilds/donate-item — force immediate daily material donation (single profile, external guilds, or all guilded profiles)
    if (req.method === 'POST' && pathname === '/api/guilds/donate-item') {
      try {
        const body = await readBody(req);
        const { byId, results: probes } = await probeAllConfigured();
        const assigned = new Set();
        for (const g of state.guilds) {
          assigned.add(String(g.leaderId));
          for (const m of g.memberIds) assigned.add(String(m));
        }
        let targetIds = [];
        if (body.profileId) {
          targetIds = [String(body.profileId)];
        } else if (Array.isArray(body.profileIds) && body.profileIds.length > 0) {
          targetIds = body.profileIds.map(String);
        } else if (body.scope === 'external') {
          targetIds = Array.from(byId.keys()).filter(pid => !assigned.has(pid));
        } else {
          targetIds = Array.from(byId.keys());
        }

        const dr = sanitizeDailyRoutine(state.dailyRoutine);
        const allowBuyMissing = Boolean(body.buyMissing || dr.autoBuyDonateMaterials);
        let donatedNow = 0;
        let boughtNow = 0;
        let cooldownCount = 0;
        let missingItemsCount = 0;
        let alreadyDonatedCount = 0;
        for (const pid of targetIds) {
          const p = byId.get(pid);
          const pr = probes.get(pid);
          if (!p || !pr || !pr.inWorld || !pr.inGameGuild) continue;
          if (pr.inGameGuild.donatedToday) {
            alreadyDonatedCount++;
            continue;
          }
          const gCard = findGuildOfProfile(pid);
          const tiers = Array.isArray(pr.donatableTiers) ? pr.donatableTiers : [];
          if (tiers.length === 0) {
            if (allowBuyMissing) {
              const buyRes = await tryBuyMissingMaterialsAndDonate(gCard, pid, p, pr, true);
              if (buyRes && buyRes.donated) {
                donatedNow++;
                if (Array.isArray(buyRes.boughtSummary) && buyRes.boughtSummary.length > 0) boughtNow++;
                if (dr.autoExchangeShop && buyRes.afterProbe) {
                  await tryExchangeGuildShopForProfile(gCard, pid, p, buyRes.afterProbe, false);
                }
              } else if (buyRes && buyRes.cooldown) {
                cooldownCount++;
              } else {
                missingItemsCount++;
              }
            } else {
              missingItemsCount++;
            }
            continue;
          }
          const ok = await tryAutoDonateForProfile(gCard, pid, p, pr, true);
          if (ok) {
            donatedNow++;
            if (dr.autoExchangeShop) {
              const freshPr = await probeClient(p.debugPort);
              if (freshPr && freshPr.inWorld) {
                await tryExchangeGuildShopForProfile(gCard, pid, p, freshPr, false);
              }
            }
          } else {
            cooldownCount++;
          }
        }
        await probeAllConfigured().catch(() => {});
        return sendJSON({ success: true, donatedNow, boughtNow, cooldownCount, missingItemsCount, alreadyDonatedCount, ...buildPublicView() }), true;
      } catch (e) {
        return sendJSON({ success: false, error: e.message }, 400), true;
      }
    }

    // POST /api/guilds/donate-zeny — force donate Zeny to guild (single character or sequential across guild/external/all screens)
    if (req.method === 'POST' && pathname === '/api/guilds/donate-zeny') {
      try {
        const body = await readBody(req);
        const amount = body.amount === 'all' ? 'all' : Math.floor(Number(body.amount || 0));
        const keepZeny = Math.max(0, Math.floor(Number(body.keepZeny || 0)));
        const maxTotalZeny = Math.max(0, Math.floor(Number(body.maxTotalZeny || 0) / 10000) * 10000);
        const splitLevelUp = Boolean(body.splitLevelUp && maxTotalZeny >= 10000);
        if (amount !== 'all' && amount < 10000) {
          return sendJSON({ success: false, error: 'จำนวนเงินบริจาคต้องอย่างน้อย 10,000 Zeny (10,000z = 1 EXP กิลด์)' }, 400), true;
        }
        const { byId, results: probes } = await probeAllConfigured();
        const assigned = new Set();
        for (const g of state.guilds) {
          assigned.add(String(g.leaderId));
          for (const m of g.memberIds) assigned.add(String(m));
        }

        let targetIds = [];
        if (body.profileId) {
          targetIds = [String(body.profileId)];
        } else if (Array.isArray(body.profileIds) && body.profileIds.length > 0) {
          targetIds = body.profileIds.map(String);
        } else if (body.guildId) {
          const g = state.guilds.find(x => x.id === String(body.guildId));
          if (!g) return sendJSON({ success: false, error: 'ไม่พบกิลด์ที่ระบุ' }, 404), true;
          targetIds = [String(g.leaderId), ...g.memberIds.map(String)];
        } else if (body.scope === 'external') {
          targetIds = Array.from(byId.keys()).filter(pid => !assigned.has(pid));
        } else {
          // scope === 'all': all profiles that have an in-game guild
          targetIds = Array.from(byId.keys());
        }

        const results = [];
        let donatedCount = 0;
        let totalZenyDonated = 0;
        let totalExpGained = 0;
        let skippedCount = 0;

        // Pre-filter online characters in guild so we know exact remaining count for splitLevelUp
        const onlineEligibleIds = targetIds.filter(pid => {
          const p = byId.get(pid);
          const pr = probes.get(pid);
          return Boolean(p && p.debugPort && pr && pr.inWorld && pr.inGameGuild);
        });

        for (let idx = 0; idx < targetIds.length; idx++) {
          const pid = targetIds[idx];
          if (maxTotalZeny > 0 && totalZenyDonated >= maxTotalZeny) {
            break;
          }
          const p = byId.get(pid);
          const pr = probes.get(pid);
          if (!p || !p.debugPort || !pr || !pr.inWorld || !pr.inGameGuild) {
            if (targetIds.length === 1) {
              results.push({ ok: false, profileId: pid, reason: !pr || !pr.inWorld ? 'ตัวละครไม่ได้ออนไลน์ในเกม' : 'ตัวละครยังไม่มีกิลด์ในเกม' });
              skippedCount++;
            }
            continue;
          }

          let reqAmountForChar = amount;
          if (maxTotalZeny > 0) {
            const remainingTotal = Math.max(0, maxTotalZeny - totalZenyDonated);
            if (remainingTotal < 10000) break;
            if (splitLevelUp) {
              const remainingOnlineCount = Math.max(1, onlineEligibleIds.filter(remId => targetIds.indexOf(remId) >= idx).length);
              const dynamicShare = Math.max(10000, Math.ceil((remainingTotal / 10000) / remainingOnlineCount) * 10000);
              const basePerChar = amount === 'all' ? remainingTotal : Math.max(amount, dynamicShare);
              reqAmountForChar = Math.min(basePerChar, remainingTotal);
            } else {
              reqAmountForChar = amount === 'all' ? remainingTotal : Math.min(amount, remainingTotal);
            }
          }

          const r = await donateZenyForProfile(pid, p, reqAmountForChar, keepZeny);
          results.push(r);
          if (r.ok) {
            donatedCount++;
            totalZenyDonated += Number(r.donatedAmount || 0);
            totalExpGained += Number(r.expGained || 0);
            if (targetIds.length > 1) {
              await new Promise(resDelay => setTimeout(resDelay, 450));
            }
          } else {
            skippedCount++;
          }
        }

        await probeAllConfigured().catch(() => {});
        return sendJSON({
          success: true,
          donatedCount,
          totalZenyDonated,
          totalExpGained,
          skippedCount,
          results,
          ...buildPublicView()
        }), true;
      } catch (e) {
        return sendJSON({ success: false, error: e.message }, 400), true;
      }
    }

    // POST /api/guilds — create guild card + auto-select members
    if (req.method === 'POST' && pathname === '/api/guilds') {
      try {
        const body = await readBody(req);
        const leaderId = String(body.leaderId || '').trim();
        const rawName = String(body.name || '').trim();
        if (!leaderId) return sendJSON({ success: false, error: 'กรุณาเลือกหัวกิลด์' }, 400), true;

        const existing = findGuildOfProfile(leaderId);
        if (existing) {
          return sendJSON({ success: false, error: `โปรไฟล์นี้อยู่ในกิลด์ "${existing.name || existing.id}" อยู่แล้ว` }, 409), true;
        }

        // Check if leader already has a guild in-game
        const profiles = loadProfiles();
        const leaderProfile = profiles.find(p => String(p.id) === leaderId);
        let inGameName = '';
        if (leaderProfile && leaderProfile.debugPort) {
          const pr = await probeClient(leaderProfile.debugPort);
          if (pr && pr.inGameGuild && pr.inGameGuild.name) {
            inGameName = pr.inGameGuild.name;
          }
        }

        const finalName = rawName || inGameName;
        if (!finalName || finalName.length < 2 || finalName.length > 16) {
          return sendJSON({ success: false, error: 'กรุณาตั้งชื่อกิลด์ (ความยาว 2–16 ตัวอักษร)' }, 400), true;
        }

        const g = {
          id: 'guild_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          name: finalName,
          inGameName: inGameName || finalName,
          leaderId,
          memberIds: [],
          excludedMemberIds: [],
          autoFill: body.autoFill !== false,
          autoDonate: body.autoDonate !== false,
          lastDonatedDateByProfile: {}
        };
        state.guilds.push(g);
        saveState();

        // Probe & auto-fill online members + trigger sync immediately
        syncAllGuilds().catch(() => {});
        await new Promise(r => setTimeout(r, 350));
        return sendJSON({ success: true, guild: g, ...buildPublicView() }), true;
      } catch (e) {
        return sendJSON({ success: false, error: e.message }, 400), true;
      }
    }

    // Routes with /api/guilds/:id...
    const m = pathname.match(/^\/api\/guilds\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/);
    if (!m) return false;
    const [, guildId, sub, subArg] = m;
    const g = state.guilds.find(x => x.id === guildId);
    if (!g) return sendJSON({ success: false, error: 'ไม่พบกิลด์นี้' }, 404), true;

    // PATCH /api/guilds/:id — update name, leaderId, autoFill, autoDonate
    if (req.method === 'PATCH' && !sub) {
      try {
        const body = await readBody(req);
        if (typeof body.name === 'string' && body.name.trim()) {
          g.name = body.name.trim();
        }
        if (typeof body.autoFill === 'boolean') {
          g.autoFill = body.autoFill;
          if (body.autoFill) g.excludedMemberIds = [];
        }
        if (typeof body.autoDonate === 'boolean') {
          g.autoDonate = body.autoDonate;
        }
        if (body.leaderId && String(body.leaderId) !== g.leaderId) {
          const newLeader = String(body.leaderId);
          const other = findGuildOfProfile(newLeader, g.id);
          if (other) return sendJSON({ success: false, error: 'ตัวละครนี้อยู่กิลด์อื่นแล้ว' }, 409), true;
          const idx = g.memberIds.indexOf(newLeader);
          if (idx !== -1) g.memberIds.splice(idx, 1);
          if (!g.memberIds.includes(g.leaderId)) g.memberIds.unshift(g.leaderId);
          g.leaderId = newLeader;
        }
        saveState();
        syncAllGuilds().catch(() => {});
        return sendJSON({ success: true, ...buildPublicView() }), true;
      } catch (e) {
        return sendJSON({ success: false, error: e.message }, 400), true;
      }
    }

    // DELETE /api/guilds/:id — remove guild card from Manager (does NOT disband in-game guild)
    if (req.method === 'DELETE' && !sub) {
      state.guilds = state.guilds.filter(x => x.id !== g.id);
      saveState();
      return sendJSON({ success: true, ...buildPublicView() }), true;
    }

    // POST /api/guilds/:id/auto-fill — re-enable autoFill and immediately pick free online characters
    if (req.method === 'POST' && sub === 'auto-fill') {
      g.autoFill = true;
      g.excludedMemberIds = [];
      saveState();
      await syncAllGuilds();
      return sendJSON({ success: true, ...buildPublicView() }), true;
    }

    // POST /api/guilds/:id/donate — trigger immediate daily material donation across this guild
    if (req.method === 'POST' && sub === 'donate') {
      const { byId, results: probes } = await probeAllConfigured();
      const allIds = [g.leaderId, ...g.memberIds];
      const dr = sanitizeDailyRoutine(state.dailyRoutine);
      let donatedNow = 0;
      let boughtNow = 0;
      let cooldownCount = 0;
      let missingItemsCount = 0;
      let alreadyDonatedCount = 0;
      for (const pid of allIds) {
        const p = byId.get(pid);
        const pr = probes.get(pid);
        if (p && pr && pr.inWorld) {
          if (pr.inGameGuild && pr.inGameGuild.donatedToday) {
            alreadyDonatedCount++;
            continue;
          }
          const tiers = Array.isArray(pr.donatableTiers) ? pr.donatableTiers : [];
          if (tiers.length === 0) {
            if (dr.autoBuyDonateMaterials) {
              const buyRes = await tryBuyMissingMaterialsAndDonate(g, pid, p, pr, true);
              if (buyRes && buyRes.donated) {
                donatedNow++;
                if (Array.isArray(buyRes.boughtSummary) && buyRes.boughtSummary.length > 0) boughtNow++;
                if (dr.autoExchangeShop && buyRes.afterProbe) {
                  await tryExchangeGuildShopForProfile(g, pid, p, buyRes.afterProbe, false);
                }
              } else if (buyRes && buyRes.cooldown) {
                cooldownCount++;
              } else {
                missingItemsCount++;
              }
            } else {
              missingItemsCount++;
            }
            continue;
          }
          const ok = await tryAutoDonateForProfile(g, pid, p, pr, true);
          if (ok) {
            donatedNow++;
            if (dr.autoExchangeShop) {
              const freshPr = await probeClient(p.debugPort);
              if (freshPr && freshPr.inWorld) {
                await tryExchangeGuildShopForProfile(g, pid, p, freshPr, false);
              }
            }
          } else {
            cooldownCount++;
          }
        }
      }
      await probeAllConfigured().catch(() => {});
      return sendJSON({ success: true, donatedNow, boughtNow, cooldownCount, missingItemsCount, alreadyDonatedCount, ...buildPublicView() }), true;
    }

    // POST /api/guilds/:id/members — manually add a member
    if (req.method === 'POST' && sub === 'members') {
      try {
        const body = await readBody(req);
        const profileId = String(body.profileId || '').trim();
        if (!profileId) return sendJSON({ success: false, error: 'กรุณาเลือกตัวละคร' }, 400), true;
        const existing = findGuildOfProfile(profileId);
        if (existing) {
          return sendJSON({ success: false, error: `ตัวละครนี้อยู่ในกิลด์ "${existing.name}" อยู่แล้ว` }, 409), true;
        }
        g.excludedMemberIds = (g.excludedMemberIds || []).filter(x => x !== profileId);
        g.memberIds.push(profileId);
        saveState();
        syncAllGuilds().catch(() => {});
        return sendJSON({ success: true, ...buildPublicView() }), true;
      } catch (e) {
        return sendJSON({ success: false, error: e.message }, 400), true;
      }
    }

    // DELETE /api/guilds/:id/members/:profileId — remove member from guild card (and remember exclusion)
    if (req.method === 'DELETE' && sub === 'members' && subArg) {
      const profileId = decodeURIComponent(subArg);
      const idx = g.memberIds.indexOf(profileId);
      if (idx === -1) return sendJSON({ success: false, error: 'ไม่พบสมาชิกในกิลด์นี้' }, 404), true;
      g.memberIds.splice(idx, 1);
      if (!Array.isArray(g.excludedMemberIds)) g.excludedMemberIds = [];
      if (!g.excludedMemberIds.includes(profileId)) g.excludedMemberIds.push(profileId);
      saveState();
      return sendJSON({ success: true, ...buildPublicView() }), true;
    }

    return false;
  }

  return {
    start,
    stop,
    syncAllGuilds,
    handleRoute,
    getState: buildPublicView
  };
}

module.exports = { createGuildService };
