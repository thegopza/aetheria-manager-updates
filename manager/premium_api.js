// manager/premium_api.js — Auto Premium (the game's VIP): buy Aetheria Token with zeny on the in-game Token market,
// unlock Premium, then keep saving Token little by little so the next round is paid before Premium runs out.
//
//   GET  /api/premium                         → settings + market + one row per client (status, Token, Premium end)
//   POST /api/premium/settings                { reserveZeny?, planId?, leadDays? }
//   POST /api/premium/toggle                  { profileId, enabled }   (profileId '*' = every client)
//   POST /api/premium/refresh                 → run one round now
//
// Per enabled client, every ~60 s:
//   1. Plan Script gate: every trigger of the loaded plan must be passed (levels, gear, zeny…). No plan = open.
//      Once passed it stays open for that plan (buying Token lowers zeny and must not re-close a zeny trigger).
//   2. reads the Token market ({type:'open'} — the same request the game's market window sends every 15 s)
//   3. no Premium   → buy Token at the lowest asks (keeps `reserveZeny`) until the plan price, then activate
//      Premium on → spread the next round over (plan days − leadDays): e.g. 7 d plan, 1 d lead → 1000 Token in 6 d
//                    and extend (from the old end date) when Premium is about to end
// Commands go through evalProfilePort (POST). Nothing runs while the Manager is updating / consolidating zeny or
// the bot is shopping / selling / moving zeny on that screen.

const fs = require('fs');
const path = require('path');

const DAY = 86400000;
const DEFAULTS = { reserveZeny: 2000000, planId: '7d', leadDays: 1 };
const TIMING = {
  tickMs: 60000,
  buyCooldownMs: 90000,
  activateCooldownMs: 5 * 60000,
  renewBeforeMs: 30 * 60000,
  minBatch: 10,
  readTimeoutMs: 9000,
  actTimeoutMs: 15000
};
const BUSY_FLAGS = ['__isConsolidating', '__isShopping', '__isAutoSellingNow', '__isManualSelling', '__isStoring',
  '__isMarketScanning', '__isChangingJob', '__isGearRefining', '__isWeightScrollBusy'];

// ---------------------------------------------------------------- in-page snippets
// Hook the game's `exchange` reply once per room, ask for a fresh snapshot and wait for it.
const EXCHANGE_FETCH = `
  if (!room.__pmExHook) { room.__pmExHook = true; room.onMessage('exchange', d => { window.__pmExchange = d; window.__pmExchangeAt = Date.now(); }); }
  const fetchEx = async () => {
    const t0 = Date.now();
    room.send('exchange', { type: 'open' });
    for (let i = 0; i < 40 && !(window.__pmExchangeAt >= t0); i++) await new Promise(r => setTimeout(r, 150));
    return window.__pmExchangeAt >= t0 ? window.__pmExchange : null;
  };`;

const READ_JS = `(async () => {
  const room = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
  if (!room || !room.state) return { ok: false, reason: 'not-in-game' };
  let me = null; try { me = room.state.players.get(room.sessionId); } catch (e) {}
  let live = null; try { live = typeof window.__getClientLiveState === 'function' ? window.__getClientLiveState() : null; } catch (e) {}
  ${EXCHANGE_FETCH}
  const ex = await fetchEx();
  const zeny = Number((live && live.zeny) != null ? live.zeny : (me && me.zeny)) || 0;
  const base = (me && me.level) || (live && live.baseLv) || 0;
  const job = (me && me.jobLevel) || (live && live.jobLv) || 0;
  const cls = String((me && me.classId) || (live && live.classId) || '').toLowerCase();
  const name = (me && me.name) || (live && live.charName) || null;
  // Plan Script: every trigger must be passed (done, or its condition already reached and nothing left to retry)
  const plan = (() => {
    const p = window.__currentScriptPlan;
    if (!window.__planScriptEnabled || !p) return null;
    const nm = (typeof window.getCharacterName === 'function' ? window.getCharacterName() : '') || name || '';
    let st = null; try { st = JSON.parse(localStorage.getItem('pelican_plan_state_' + nm + '_' + (p.id || p.name || 'plan')) || 'null'); } catch (e) {}
    const done = (st && st.done) || {}, pend = (st && st.pending) || {};
    const order = ['novice', p.class1Target, p.class2Target].filter(Boolean).map(x => String(x).toLowerCase());
    const ci = order.indexOf(cls);
    const label = t => t.type === 'base_level' ? 'Base ' + t.targetLevel : t.type === 'job_level' ? 'Job ' + t.targetLevel + (t.classId ? ' ' + t.classId : '')
      : t.type === 'zeny' ? 'เงิน ' + Number(t.targetZeny || 0).toLocaleString() + ' z' : String(t.type);
    const blocked = [];
    const trigs = p.triggers || [];
    const trigId = (t, i) => t.id || ((t.type || 'base_level') + '_' + t.targetLevel + '_' + i);
    const gearStartIdx = (p.gearPlan && Array.isArray(p.gearPlan.steps) && p.gearPlan.steps.length)
      ? order.indexOf(String(p.gearPlan.startClass || 'novice').toLowerCase())
      : -1;
    const gearActive = gearStartIdx >= 0 && ci >= gearStartIdx;
    let stateDirty = false;
    for (let i = 0; i < trigs.length; i++) {
      const t = trigs[i];
      if (!t) continue;
      const tid = trigId(t, i);
      if (done[tid]) continue;
      if (pend[tid]) {
        const pe = pend[tid];
        const left = Array.isArray(pe.actions) ? pe.actions.map(ai => (t.actions || [])[ai]).filter(Boolean) : (t.actions || []);
        const onlyEquipLeft = left.length > 0 && left.every(a => a && a.type === 'equip_item');
        const timedOut = pe.firstAt && (Date.now() - pe.firstAt > 30 * 60 * 1000);
        const laterDone = trigs.some((t2, j) => {
          if (!t2 || j === i || !done[trigId(t2, j)]) return false;
          if (t.type === 'base_level' && t2.type === 'base_level') return (Number(t2.targetLevel) || 0) > (Number(t.targetLevel) || 0);
          return false;
        });
        if (onlyEquipLeft && (timedOut || gearActive || laterDone || base >= 99)) {
          delete pend[tid];
          done[tid] = Date.now();
          stateDirty = true;
          continue;
        }
        blocked.push(label(t) + ' (ยังทำไม่เสร็จ)');
        continue;
      }
      let ok = true;
      if (t.type === 'base_level') ok = base >= (Number(t.targetLevel) || 0);
      else if (t.type === 'job_level') {
        const ti = t.classId ? order.indexOf(String(t.classId).toLowerCase()) : -1;
        if (t.classId && (ti < 0 || ci < 0)) ok = true; // unknown class order → don't block
        else if (t.classId && ci !== ti) ok = ci > ti;
        else ok = job >= (Number(t.targetLevel) || 0);
      } else if (t.type === 'zeny') ok = zeny >= (Number(t.targetZeny) || 0);
      if (!ok) blocked.push(label(t));
    }
    if (stateDirty && st) {
      try { localStorage.setItem('pelican_plan_state_' + nm + '_' + (p.id || p.name || 'plan'), JSON.stringify(st)); } catch (e) {}
    }
    return { id: String(p.id || p.name || 'plan'), name: p.name || null, blocked };
  })();
  return {
    ok: true, name, zeny, level: base,
    botRunning: window.__isBotRunning === true,
    busy: ${JSON.stringify(BUSY_FLAGS)}.filter(k => window[k] === true),
    plan,
    exchange: ex ? {
      tokens: Number(ex.tokens) || 0,
      premiumUntil: ex.premiumUntil || null,
      plans: Array.isArray(ex.premiumPlans) ? ex.premiumPlans.map(x => ({ id: x.id, days: x.days, tokens: x.tokens })) : [],
      bestAsk: ex.bestAsk || null, feePercent: ex.feePercent,
      asks: ((ex.book && ex.book.asks) || []).slice(0, 40).map(a => ({ price: a.price, qty: a.qty })),
      openOrders: Array.isArray(ex.orders) ? ex.orders.length : 0
    } : null
  };
})()`;

const ACTIONS = {
  // Buy right now at the lowest asks. Re-checks the wallet first so a stale Manager view can't buy twice.
  buy: (qty, maxZeny, tokensBelow) => `(async () => {
    const room = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
    if (!room) return { success: false, error: 'not-in-game' };
    ${EXCHANGE_FETCH}
    const before = await fetchEx();
    if (!before) return { success: false, error: 'อ่านตลาด Token ไม่ได้' };
    if ((Number(before.tokens) || 0) >= ${Number(tokensBelow)}) return { success: false, error: 'Token พอแล้ว', tokens: before.tokens };
    room.send('exchange', { type: 'now', side: 'bid', qty: ${Number(qty)}, maxZeny: ${Number(maxZeny)} });
    await new Promise(r => setTimeout(r, 2000));
    const after = await fetchEx();
    const b = Number(before.tokens) || 0, a = after ? Number(after.tokens) || 0 : null;
    return { success: a != null && a > b, before: b, after: a, error: a == null ? 'ไม่ได้คำตอบจากตลาด' : (a > b ? null : 'ซื้อไม่ได้ (ไม่มีคนขายในราคานี้ หรือเงินไม่พอ)') };
  })()`,
  activate: (planId, cost) => `(async () => {
    const room = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
    if (!room) return { success: false, error: 'not-in-game' };
    ${EXCHANGE_FETCH}
    const before = await fetchEx();
    if (!before) return { success: false, error: 'อ่านตลาด Token ไม่ได้' };
    if ((Number(before.tokens) || 0) < ${Number(cost)}) return { success: false, error: 'Token ไม่พอ' };
    room.send('exchange', { type: 'premium', plan: ${JSON.stringify(String(planId))} });
    await new Promise(r => setTimeout(r, 2000));
    const after = await fetchEx();
    const until = after && after.premiumUntil ? new Date(after.premiumUntil).getTime() : 0;
    const was = before.premiumUntil ? new Date(before.premiumUntil).getTime() : 0;
    return { success: until > was, premiumUntil: after ? after.premiumUntil : null, tokens: after ? after.tokens : null, error: until > was ? null : 'ซื้อ Premium ไม่สำเร็จ' };
  })()`
};

// ---------------------------------------------------------------- pure helpers (unit-tested)
function toMs(v) {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : new Date(v).getTime();
  return Number.isFinite(n) ? n : 0;
}

// Walk the sell orders (cheapest first) and see how many Token `budget` zeny buys, up to `want`.
function walkAsks(asks, want, budget) {
  let qty = 0, zeny = 0;
  const sorted = (asks || []).filter(a => a && a.price > 0 && a.qty > 0).sort((a, b) => a.price - b.price);
  for (const a of sorted) {
    if (qty >= want) break;
    const canAfford = Math.floor((budget - zeny) / a.price);
    const take = Math.min(a.qty, want - qty, canAfford);
    if (take <= 0) break;
    qty += take; zeny += take * a.price;
  }
  return { qty, zeny };
}

// How many Token should the wallet hold right now?
// No Premium → the full plan price. Premium on → grows linearly so the full price is there `leadDays` before the end.
function tokenTarget(cost, days, leadDays, premiumUntilMs, nowMs) {
  if (!premiumUntilMs || premiumUntilMs <= nowMs) return cost;
  const period = days * DAY;
  const spread = Math.max(DAY / 4, period - Math.max(0, leadDays) * DAY);
  const remaining = premiumUntilMs - nowMs;
  const elapsed = period - remaining; // negative while more than one period is left (e.g. a 30 d plan bought by hand)
  const frac = Math.max(0, Math.min(1, elapsed / spread));
  return Math.ceil(cost * frac);
}

// What to do for one client. snap = READ_JS result, cfg = settings, gateOpen = plan gate result (after latch)
function decide(snap, cfg, gateOpen, nowMs, timing) {
  const T = Object.assign({}, TIMING, timing || {});
  if (!snap || !snap.ok) return { action: 'offline', text: 'ออฟไลน์ / ยังไม่เข้าเกม' };
  if (!gateOpen) return { action: 'plan', text: 'รอแผน: ' + ((snap.plan && snap.plan.blocked && snap.plan.blocked[0]) || 'ยังไม่ผ่าน') };
  const ex = snap.exchange;
  if (!ex) return { action: 'wait', text: 'อ่านตลาด Token ไม่ได้' };
  const plan = (ex.plans || []).find(p => p.id === cfg.planId) || (ex.plans || [])[0];
  if (!plan) return { action: 'wait', text: 'ไม่พบแพ็กเกจ Premium ในเกม' };
  const until = toMs(ex.premiumUntil);
  const active = until > nowMs;
  const target = tokenTarget(plan.tokens, plan.days, cfg.leadDays, until, nowMs);
  const base = { plan, target, active, premiumUntil: until || null, tokens: ex.tokens };
  if (ex.tokens >= plan.tokens && (!active || until - nowMs <= T.renewBeforeMs)) {
    return Object.assign(base, { action: 'activate', text: active ? 'ต่อ Premium ' + plan.days + ' วัน' : 'ปลดล็อค Premium ' + plan.days + ' วัน' });
  }
  const need = target - ex.tokens;
  if (need <= 0) return Object.assign(base, { action: 'idle', text: active ? 'Premium ใช้งานอยู่ · Token ครบตามแผนแล้ว' : 'รอปลดล็อค' });
  const budget = Math.max(0, (Number(snap.zeny) || 0) - Math.max(0, Number(cfg.reserveZeny) || 0));
  if (budget <= 0) return Object.assign(base, { action: 'wait', need, text: 'เงินไม่พอ (เก็บสำรองไว้ ' + Number(cfg.reserveZeny || 0).toLocaleString() + ' z)' });
  const w = walkAsks(ex.asks, need, budget);
  if (w.qty <= 0) return Object.assign(base, { action: 'wait', need, text: (ex.asks && ex.asks.length) ? 'เงินไม่พอซื้อแม้แต่ 1 Token' : 'ยังไม่มีคนขาย Token' });
  if (w.qty < Math.min(need, T.minBatch)) return Object.assign(base, { action: 'wait', need, text: 'รอเงินพอซื้อ ' + Math.min(need, T.minBatch) + ' Token' });
  const maxZeny = Math.min(budget, Math.ceil(w.zeny * 1.01));
  return Object.assign(base, { action: 'buy', need, qty: w.qty, maxZeny, estZeny: w.zeny, text: 'ซื้อ ' + w.qty + ' Token (~' + w.zeny.toLocaleString() + ' z)' });
}

function sanitizeSettings(s) {
  s = s || {};
  const reserve = Math.floor(Number(s.reserveZeny));
  const lead = Number(s.leadDays);
  return {
    reserveZeny: Number.isFinite(reserve) && reserve >= 0 ? Math.min(reserve, 2e9) : DEFAULTS.reserveZeny,
    planId: typeof s.planId === 'string' && /^[\w-]{1,20}$/.test(s.planId) ? s.planId : DEFAULTS.planId,
    leadDays: Number.isFinite(lead) && lead >= 0 && lead <= 30 ? lead : DEFAULTS.leadDays
  };
}

function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.setEncoding && req.setEncoding('utf8');
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { resolve(null); } });
  });
}

// ---------------------------------------------------------------- service
function createPremiumService(opts) {
  const { loadProfiles, evalProfilePort } = opts;
  const dataFile = opts.dataFile || path.join(__dirname, 'data', 'premium.json');
  const isBusy = opts.isBusy || (() => false);
  const now = opts.now || (() => Date.now());
  const log = opts.log || ((...a) => console.log('[Premium]', ...a));
  const T = Object.assign({}, TIMING, opts.timing || {});

  let settings = Object.assign({}, DEFAULTS);
  let clients = {}; // profileId -> { enabled, gatePlan, history: [] }
  try {
    const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    settings = sanitizeSettings(raw.settings);
    clients = raw.clients && typeof raw.clients === 'object' ? raw.clients : {};
  } catch (e) { /* first run */ }

  const runtime = new Map(); // profileId -> { snap, decision, at, buyAt, activateAt, lastError }
  let market = null;
  let ticking = false, timer = null;

  function save() {
    try {
      fs.mkdirSync(path.dirname(dataFile), { recursive: true });
      const tmp = dataFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ settings, clients }, null, 2));
      fs.renameSync(tmp, dataFile);
    } catch (e) { log('save failed', e.message); }
  }
  const cl = id => { if (!clients[id]) clients[id] = { enabled: false, gatePlan: null, history: [] }; if (!Array.isArray(clients[id].history)) clients[id].history = []; return clients[id]; };
  const rt = id => { if (!runtime.has(id)) runtime.set(id, { snap: null, decision: null, at: 0, buyAt: 0, activateAt: 0, lastError: null }); return runtime.get(id); };
  function remember(id, text, ok) {
    const c = cl(id);
    c.history.unshift({ at: now(), text, ok: ok !== false });
    c.history = c.history.slice(0, 20);
    save();
  }

  // Plan gate with latch: once every trigger of plan X passed, X stays open (zeny triggers flip back after buying)
  function gateOpen(id, snap) {
    if (!snap || !snap.ok) return false;
    const c = cl(id);
    if (!snap.plan) return true;
    if (c.gatePlan && c.gatePlan === snap.plan.id) return true;
    if (!snap.plan.blocked || !snap.plan.blocked.length) { c.gatePlan = snap.plan.id; save(); return true; }
    return false;
  }

  async function evalOk(port, code, timeoutMs) {
    const r = await evalProfilePort(port, code, timeoutMs);
    const res = r && r.result;
    return { ok: Boolean(r && r.success !== false && res && res.success !== false), result: res, error: (res && res.error) || (r && r.error) || null };
  }

  async function handleClient(p) {
    const R = rt(p.id);
    if (!p.debugPort) { R.snap = null; R.decision = { action: 'offline', text: 'ออฟไลน์' }; return; }
    const r = await evalProfilePort(p.debugPort, READ_JS, T.readTimeoutMs);
    const snap = r && r.success !== false && r.result && typeof r.result === 'object' ? r.result : null;
    R.snap = snap; R.at = now();
    if (snap && snap.exchange) market = { bestAsk: snap.exchange.bestAsk, plans: snap.exchange.plans, feePercent: snap.exchange.feePercent, at: now() };
    const d = decide(snap, settings, gateOpen(p.id, snap), now(), T);
    R.decision = d;
    if (snap && snap.busy && snap.busy.length && (d.action === 'buy' || d.action === 'activate')) { d.action = 'wait'; d.text = 'รอบอทว่าง (' + snap.busy[0] + ')'; return; }
    if (d.action === 'buy') {
      if (now() - R.buyAt < T.buyCooldownMs) return;
      R.buyAt = now();
      const res = await evalOk(p.debugPort, ACTIONS.buy(d.qty, d.maxZeny, d.target), T.actTimeoutMs);
      if (res.ok) { remember(p.id, 'ซื้อ ' + (res.result.after - res.result.before) + ' Token (' + res.result.before + ' → ' + res.result.after + ')'); R.lastError = null; }
      else { R.lastError = res.error; if (res.error !== 'Token พอแล้ว') remember(p.id, 'ซื้อ Token ไม่สำเร็จ: ' + (res.error || 'ไม่ทราบสาเหตุ'), false); }
    } else if (d.action === 'activate') {
      if (now() - R.activateAt < T.activateCooldownMs) return;
      R.activateAt = now();
      const res = await evalOk(p.debugPort, ACTIONS.activate(d.plan.id, d.plan.tokens), T.actTimeoutMs);
      if (res.ok) { remember(p.id, (d.active ? 'ต่อ' : 'ปลดล็อค') + ' Premium ' + d.plan.days + ' วัน · ถึง ' + new Date(toMs(res.result.premiumUntil)).toLocaleString('th-TH')); R.lastError = null; }
      else { R.lastError = res.error; remember(p.id, 'ซื้อ Premium ไม่สำเร็จ: ' + (res.error || 'ไม่ทราบสาเหตุ'), false); }
    }
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const profiles = loadProfiles();
      const enabled = profiles.filter(p => clients[p.id] && clients[p.id].enabled);
      for (const p of profiles) if (!enabled.includes(p)) { const R = rt(p.id); R.decision = null; }
      if (!enabled.length) return;
      if (isBusy()) { for (const p of enabled) rt(p.id).decision = { action: 'wait', text: 'Manager กำลังอัปเดต / รวมเงิน — รอก่อน' }; return; }
      for (const p of enabled) {
        try { await handleClient(p); } catch (e) { log('client', p.name || p.id, e.message); }
      }
    } finally { ticking = false; }
  }

  function view() {
    const profiles = loadProfiles();
    return {
      success: true, settings, market,
      clients: profiles.map(p => {
        const c = clients[p.id] || { enabled: false, history: [] };
        const R = runtime.get(p.id) || {};
        const s = R.snap, d = R.decision;
        const ex = s && s.exchange;
        return {
          id: p.id, name: p.name, charName: (s && s.name) || p.lastCharName || null, charClass: p.lastCharClass || null,
          enabled: !!c.enabled, online: !!(s && s.ok),
          zeny: s && s.ok ? s.zeny : null, level: s && s.ok ? s.level : null,
          tokens: ex ? ex.tokens : null, premiumUntil: ex ? toMs(ex.premiumUntil) || null : null,
          target: d && d.target != null ? d.target : null, cost: d && d.plan ? d.plan.tokens : null,
          status: d ? d.action : (c.enabled ? 'pending' : 'off'), statusText: d ? d.text : (c.enabled ? 'รอรอบตรวจถัดไป' : 'ปิดอยู่'),
          planName: s && s.plan ? s.plan.name : null, planBlocked: s && s.plan && !(c.gatePlan && c.gatePlan === s.plan.id) ? s.plan.blocked : [],
          lastError: R.lastError || null, checkedAt: R.at || null, history: (c.history || []).slice(0, 5)
        };
      })
    };
  }

  async function handleRoute(req, res, pathname, sendJSON) {
    if (!pathname.startsWith('/api/premium')) return false;
    if (pathname === '/api/premium' && req.method === 'GET') { sendJSON(view()); return true; }
    if (req.method !== 'POST') return false;
    const body = (await readBody(req)) || {};
    if (pathname === '/api/premium/settings') {
      settings = sanitizeSettings(Object.assign({}, settings, body));
      save();
      sendJSON(view());
      return true;
    }
    if (pathname === '/api/premium/toggle') {
      const id = String(body.profileId || '');
      const ids = id === '*' ? loadProfiles().map(p => p.id) : [id];
      const known = new Set(loadProfiles().map(p => p.id));
      if (!ids.length || ids.some(x => !known.has(x))) { sendJSON({ success: false, error: 'ไม่พบจอนี้' }, 400); return true; }
      for (const x of ids) { cl(x).enabled = !!body.enabled; if (!body.enabled) rt(x).decision = null; }
      save();
      if (body.enabled) setTimeout(() => tick().catch(() => {}), 50);
      sendJSON(view());
      return true;
    }
    if (pathname === '/api/premium/refresh') {
      await tick().catch(e => log('tick failed', e.message));
      sendJSON(view());
      return true;
    }
    return false;
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => tick().catch(e => log('tick failed', e.message)), T.tickMs);
    if (timer.unref) timer.unref();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return { handleRoute, tick, start, stop, view, _settings: () => settings, _clients: () => clients };
}

module.exports = { createPremiumService, decide, walkAsks, tokenTarget, sanitizeSettings, toMs, READ_JS, ACTIONS, DEFAULTS, TIMING };
