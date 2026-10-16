// manager/party_api.js — Party system: Manager forms in-game parties from its own clients.
//
//   GET  /api/parties                      → parties + live status + client list (for the leader/member picker)
//   POST /api/parties                      { leaderId, memberIds?, autoFill? } → create a party
//   POST /api/parties/:id/settings         { expMode?, lootMode?, syncMap?, autoFill?, memberFollow?: { profileId, mode } }
//   POST /api/parties/:id/add-member       { profileId, profileIds?, followMode? } → manually add member(s)
//   POST /api/parties/:id/remove-member    { profileId }           → kick + never auto-pick again for this party
//   POST /api/parties/:id/summon                                   → leader uses the game's "รวมทีม"
//   POST /api/parties/:id/delete                                   → disband (members leave, then leader)
//
// Every ~10 s for each party the loop:
//   1. reads leader / members / free clients (char name, level, map, CH, in-game party, pending invite)
//   2. tops the party up to 6 (leader included) with free clients whose level is closest to the leader
//   3. leader sends `invite`, the member answers `accept` through the Manager (no need for AUTO acceptParty)
//   4. leader applies the EXP / loot mode chosen on the web page
//   5. members farm the leader's map; on that map they move to the leader's CH. When a member can't get into
//      that CH (full / refused) the leader moves to the least populated CH and everyone follows.
//
// The current in-game party is read from the game's own store through React's useSyncExternalStore getters
// (`()=>Y.party`, `()=>Y.invite`), so it also works right after a page reload. All commands go through
// evalProfilePort (POST). Game helpers (moveToChannel, setTargetFarmMap, …) come from the bot; when they are
// missing the related step is skipped and shown as a status instead.

const fs = require('fs');
const path = require('path');

const MAX_MEMBERS = 6;
const EXP_MODES = ['individual', 'even-share'];
const LOOT_MODES = ['personal', 'round-robin', 'leader'];
const BUSY_FLAGS = ['__isNavigating', '__isWalkingToMap', '__isShopping', '__isRecovering', '__isConsolidating',
  '__isChangingJob', '__isAutoSellingNow', '__isManualSelling', '__isStoring', '__isGearRefining',
  '__isMarketScanning', '__isWeightScrollBusy'];

const TIMING = {
  tickMs: 2500,
  inviteCooldownMs: 15000,
  inviteMaxAttempts: 3,
  excludeAfterFailMs: 5 * 60 * 1000,
  dropOfflineAfterMs: 2 * 60 * 1000,
  dropOtherPartyAfterMs: 45 * 1000,
  settingsCooldownMs: 15000,
  mapCooldownMs: 18000,
  channelCooldownMs: 45000,
  channelFailsBeforeFallback: 2,
  fallbackCooldownMs: 3 * 60 * 1000,
  acceptDelayMs: 1500,
  leaveCooldownMs: 15000,
  disbandGapMs: 1200,
  gatherCooldownMs: 12000,
  memberMoveWaitMs: 120000,
  leaderMoveWaitMs: 45000,
  unfollowCooldownMs: 20000,
  followCooldownMs: 8000
};

// ---------------------------------------------------------------- in-page snippets
const READ_JS = `(() => {
  const findGetters = () => {
    const out = {};
    try {
      const rootEl = document.getElementById('root') || document.body.firstElementChild;
      const key = rootEl && Object.keys(rootEl).find(k => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'));
      if (!key) return out;
      let start = rootEl[key]; if (start && start.stateNode && start.stateNode.current) start = start.stateNode.current;
      const stack = [start]; let n = 0;
      while (stack.length && n++ < 100000 && !(out.party && out.invite && out.follow)) {
        const f = stack.pop(); if (!f) continue;
        let h = f.memoizedState, g = 0;
        while (h && typeof h === 'object' && g++ < 80) {
          const q = h.queue;
          if (q && typeof q.getSnapshot === 'function') {
            const src = String(q.getSnapshot).replace(/\\s+/g, '');
            if (!out.party && /^\\(\\)=>[A-Za-z_$][\\w$]*\\.party$/.test(src)) out.party = q.getSnapshot;
            if (!out.invite && /^\\(\\)=>[A-Za-z_$][\\w$]*\\.invite$/.test(src)) out.invite = q.getSnapshot;
            if (!out.follow && /^\\(\\)=>[A-Za-z_$][\\w$]*\\.follow$/.test(src)) out.follow = q.getSnapshot;
          }
          h = h.next;
        }
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
    } catch (e) {}
    return out;
  };
  let g = window.__pmPartyGetters;
  if (!g || !g.party || !g.invite || !g.follow) { g = findGetters(); window.__pmPartyGetters = g; }
  const room = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
  if (!room || !room.state) return { ok: false, reason: 'not-in-game' };
  let me = null; try { me = room.state.players.get(room.sessionId); } catch (e) {}
  let live = null; try { live = typeof window.__getClientLiveState === 'function' ? window.__getClientLiveState() : null; } catch (e) {}
  let party = null, invite = null;
  try { party = g.party ? g.party() : null; } catch (e) {}
  try { invite = g.invite ? g.invite() : null; } catch (e) {}
  try {
    if (!invite && typeof document.querySelector === 'function') {
      const toast = document.querySelector('.invite-toast');
      if (toast) {
        const txt = (toast.innerText || toast.textContent || '').trim();
        const m = txt.match(/^(\\S+)\\s+เชิญคุณเข้าปาร์ตี้/m);
        if (m) invite = { kind: 'party', from: m[1] };
      }
    }
  } catch (e) {}
  // The game's own "follow" (set by รวมทีม / ติดตามหัวหน้า): walks after that player and AUTO assists them
  let follow = null;
  try { follow = g.follow ? g.follow() : null; } catch (e) {}
  try { if (!follow && document.querySelector('.follow-chip')) follow = '?'; } catch (e) {}
  const busy = ${JSON.stringify(BUSY_FLAGS)}.filter(k => window[k] === true);
  // Plan Script: only Base / Job level triggers keep the character on its own maps. Zeny / gear triggers don't.
  // Judge by the real level + class too: a plan loaded on an already-levelled character has an empty 'done' list.
  const plan = (() => {
    const p = window.__currentScriptPlan;
    if (!window.__planScriptEnabled || !p) return null;
    const nm = (typeof window.getCharacterName === 'function' ? window.getCharacterName() : '') || (me && me.name) || '';
    let st = null; try { st = JSON.parse(localStorage.getItem('pelican_plan_state_' + nm + '_' + (p.id || p.name || 'plan')) || 'null'); } catch (e) {}
    const done = (st && st.done) || {}, pend = (st && st.pending) || {};
    const base = (me && me.level) || (live && live.baseLv) || 0;
    const job = (me && me.jobLevel) || (live && live.jobLv) || 0;
    const cls = String((me && me.classId) || (live && live.classId) || '').toLowerCase();
    const order = ['novice', p.class1Target, p.class2Target].filter(Boolean).map(x => String(x).toLowerCase());
    const ci = order.indexOf(cls);
    const levelPending = (p.triggers || []).filter(t => t && (t.type === 'base_level' || t.type === 'job_level')).filter(t => {
      if (done[t.id]) return false;
      if (Array.isArray(t.actions) && t.actions.length && !t.actions.some(a => a && (a.type === 'change_map' || a.type === 'change_class'))) return false;
      if (pend[t.id]) {
        // Still retrying: only blocks while a map / class step is left (gear, arrows, selling don't move the character)
        const left = Array.isArray(pend[t.id].actions) ? pend[t.id].actions.map(i => (t.actions || [])[i]).filter(Boolean) : (t.actions || []);
        return left.some(a => a && (a.type === 'change_map' || a.type === 'change_class'));
      }
      const lv = Number(t.targetLevel) || 0;
      if (t.type === 'base_level') return base < lv;
      if (t.classId) {
        const ti = order.indexOf(String(t.classId).toLowerCase());
        if (ti < 0 || ci < 0) return false;
        if (ci > ti) return false;
        if (ci < ti) return true;
      }
      return job < lv;
    }).map(t => (t.type === 'base_level' ? 'Base ' : 'Job ') + t.targetLevel + (t.classId ? ' ' + t.classId : ''));
    return { name: p.name || null, levelPending };
  })();
  let needsPriestBuff = false;
  let buffStatus = null;
  try {
    if (typeof window.getPartyPriestBuffStatus === 'function') {
      buffStatus = window.getPartyPriestBuffStatus(25000);
      needsPriestBuff = Boolean(buffStatus && buffStatus.needsPriest);
    }
  } catch (e) {}
  return {
    ok: true,
    name: (me && me.name) || (live && live.charName) || null,
    level: (me && me.level) || (live && live.baseLv) || null,
    classId: (me && me.classId) || (live && live.classId) || null,
    mapId: room.state.mapId || null,
    mapName: room.state.displayName || null,
    channel: typeof room.state.channel === 'number' ? room.state.channel : null,
    targetMap: window.__targetFarmMap || (live && live.targetMap) || null,
    keptFarmMap: window.__keptFarmMap || null,
    botRunning: window.__isBotRunning === true,
    returningToPriest: window.__returningToPriest === true,
    priestBuffingTarget: window.__priestBuffingTarget || null,
    needsPriestBuff,
    buffStatus,
    busy,
    plan,
    partyKnown: !!g.party,
    follow: follow || null,
    party: party ? {
      leader: party.leader, expMode: party.expMode, lootMode: party.lootMode,
      evenShareAllowed: party.evenShareAllowed !== false, levelRange: party.levelRange, maxMembers: party.maxMembers || 6,
      members: (party.members || []).map(m => ({ name: m.name, online: m.online !== false, mapId: m.mapId, mapName: m.mapName, channel: m.channel, level: m.level }))
    } : null,
    invite: invite && invite.kind === 'party' && (!invite.expiresAt || invite.expiresAt > Date.now()) ? { from: invite.from, expiresAt: invite.expiresAt } : null,
    helpers: {
      moveToChannel: typeof window.moveToChannel === 'function',
      findLeast: typeof window.findLeastPopulatedChannel === 'function',
      evaluateAnchorChannel: typeof window.evaluatePartyChannelSwitch === 'function',
      setTargetFarmMap: typeof window.setTargetFarmMap === 'function',
      updatePartySyncState: typeof window.updatePartySyncState === 'function'
    }
  };
})()`;

const sendPartyJs = (msg, guard) => `(() => {
  const room = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
  if (!room) return { success: false, error: 'not-in-game' };
  ${guard || ''}
  room.send('party', ${JSON.stringify(msg)});
  return { success: true };
})()`;

const ACTIONS = {
  invite: name => sendPartyJs({ action: 'invite', name }),
  // Only accept an invite that really comes from our leader
  accept: leaderName => sendPartyJs({ action: 'accept' }, `
    const g = window.__pmPartyGetters; let inv = null; try { inv = g && g.invite ? g.invite() : null; } catch (e) {}
    let toastBtn = null;
    try {
      if (typeof document.querySelector === 'function') {
        const toast = document.querySelector('.invite-toast');
        if (toast && (toast.innerText || toast.textContent || '').includes(${JSON.stringify(leaderName)})) {
          toastBtn = toast.querySelector('.invite-actions button.primary') || toast.querySelector('button.primary');
          if (!inv) inv = { kind: 'party', from: ${JSON.stringify(leaderName)} };
        }
      }
    } catch (e) {}
    if (!inv || inv.kind !== 'party' || inv.from !== ${JSON.stringify(leaderName)}) return { success: false, error: 'no-invite' };
    try { if (inv && typeof inv === 'object') inv.expiresAt = 0; } catch (e) {}
    try { if (toastBtn && typeof toastBtn.click === 'function') { toastBtn.click(); return { success: true }; } } catch (e) {}`),
  leave: () => sendPartyJs({ action: 'leave' }),
  kick: name => sendPartyJs({ action: 'kick', name }),
  summon: () => sendPartyJs({ action: 'summon' }),
  // Engage the game's built-in follow & AUTO party assist on a party member (leader or any other member)
  startFollow: name => `(() => {
    const room = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
    const handlers = room && room.onMessageHandlers;
    if (!handlers || typeof handlers.emit !== 'function') return { success: false, error: 'no-follow-handler' };
    handlers.emit('party_follow', ${JSON.stringify({ name })});
    return { success: true };
  })()`,
  // Same as pressing the game's "ยกเลิกติดตาม" chip (calls the game's own stopFollow), with handler fallback
  stopFollow: () => `(() => {
    const b = typeof document.querySelector === 'function' ? document.querySelector('.follow-chip button') : null;
    if (b && typeof b.click === 'function') { b.click(); return { success: true }; }
    const room = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
    const handlers = room && room.onMessageHandlers;
    if (handlers && typeof handlers.emit === 'function') {
      handlers.emit('party_follow', { name: null });
      return { success: true };
    }
    return { success: false, error: 'no-follow' };
  })()`,
  settings: patch => sendPartyJs(Object.assign({ action: 'settings' }, patch)),
  setMap: (map, walkNow) => `(() => {
    const map = ${JSON.stringify(map)};
    if (typeof window.clearSafeMap === 'function') window.clearSafeMap('ปาร์ตี้: ตามแมพหัวตี้');
    window.__partyForcedMap = map;
    if (typeof window.setPlanManualMap === 'function') window.setPlanManualMap(map);
    window.__targetFarmMap = map;
    try { localStorage.setItem('pelican_farm_map', map); } catch (e) {}
    const sel = document.getElementById('p-target-map-select'); if (sel) sel.value = map;
    if (typeof window.setTargetFarmMap === 'function') window.setTargetFarmMap(map, ${walkNow ? 'true' : 'false'}, { fromParty: true });
    return { success: true };
  })()`,
  // Same idea as the zeny consolidation: moveToChannel waits for the cooldown / a free slot by itself;
  // we wait for it and report where the character REALLY is afterwards.
  moveChannelWait: (ch, waitMs) => `(async () => {
    if (typeof window.moveToChannel !== 'function') return { success: false, error: 'บอทจอนี้ไม่มีระบบย้าย CH' };
    let r = null;
    try { r = await window.moveToChannel(${Number(ch)}, ${Number(waitMs)}); } catch (e) { r = { success: false, error: String(e && e.message || e) }; }
    await new Promise(x => setTimeout(x, 1500));
    const room = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
    const cur = room && room.state && typeof room.state.channel === 'number' ? room.state.channel : (typeof window.getCurrentChannel === 'function' ? window.getCurrentChannel() : null);
    return { success: cur === ${Number(ch)}, channel: cur, error: cur === ${Number(ch)} ? null : ((r && r.error) || 'ย้าย CH ไม่สำเร็จ') };
  })()`,
  leastChannel: () => `(async () => {
    if (typeof window.findLeastPopulatedChannel !== 'function') return { success: false, error: 'no-helper' };
    let r = await window.findLeastPopulatedChannel();
    const ch = typeof r === 'number' ? r : (r && (r.channel != null ? r.channel : r.ch));
    return typeof ch === 'number' ? { success: true, channel: ch } : { success: false, error: 'no-channel' };
  })()`,
  evaluateAnchorChannel: (partySize, partyNames) => `(async () => {
    if (typeof window.evaluatePartyChannelSwitch !== 'function') return { success: false, error: 'no-helper' };
    return await window.evaluatePartyChannelSwitch(${Number(partySize) || 1}, ${JSON.stringify(partyNames || [])});
  })()`,
  syncClientPartyState: sync => `(() => {
    if (typeof window.updatePartySyncState === 'function') return window.updatePartySyncState(${JSON.stringify(sync)});
    window.__pmPartySync = ${JSON.stringify(sync)};
    return { success: true };
  })()`
};

// ---------------------------------------------------------------- pure helpers (unit-tested)
function isCityMapName(m) {
  return /เมืองหลวง|โซลเฮเวน|ตลาดคาราวาน/.test(String(m || ''));
}

function isPriestClass(cls) {
  return /^(priest|acolyte)$/i.test(String(cls || '').trim());
}

function findPartyPriest(party, profiles, states) {
  if (!party || !states) return null;
  const L = states.get(party.leaderId);
  const inGame = new Set(inGameMemberNames(L));
  const allIds = [party.leaderId].concat(Array.isArray(party.memberIds) ? party.memberIds : []);
  let fallback = null;
  for (const id of allIds) {
    const S = states.get(id);
    const P = profiles ? profiles.get(id) : null;
    if (!S || !S.ok || !S.name) continue;
    if (id !== party.leaderId && inGame.size > 0 && !inGame.has(S.name)) continue;
    const cls = S.classId || (P && P.lastCharClass) || '';
    if (!isPriestClass(cls)) continue;
    const entry = { id: String(id), name: S.name, snap: S, profile: P };
    if (!isCityMapName(S.mapName)) return entry;
    if (!fallback) fallback = entry;
  }
  return fallback;
}

function assignedIds(parties) {
  const s = new Set();
  for (const p of parties) { s.add(p.leaderId); for (const id of p.memberIds || []) s.add(id); }
  return s;
}

function inGameMemberNames(snap) {
  return snap && snap.party ? snap.party.members.map(m => m.name) : [];
}

// Pick free clients for `party`, closest level to the leader first.
// states: Map<profileId, snapshot|null>; managedNames: Set of char names that belong to this Manager.
function pickCandidates(party, parties, states, managedNames, slots, excluded) {
  if (slots <= 0) return [];
  const leaderSnap = states.get(party.leaderId);
  if (!leaderSnap || !leaderSnap.ok || !leaderSnap.name) return [];
  const taken = assignedIds(parties);
  const out = [];
  for (const [id, s] of states) {
    if (taken.has(id) || (excluded && excluded.has(id))) continue;
    if (!s || !s.ok || !s.name || typeof s.level !== 'number') continue;
    if (planBlocked(s)) continue; // still levelling with its Plan Script
    if (s.party) {
      // In someone else's party: only usable when that party is ours (stale bot party) or led by our leader
      const lead = s.party.leader;
      if (lead !== leaderSnap.name && !managedNames.has(lead)) continue;
    }
    out.push({ id, diff: Math.abs(s.level - leaderSnap.level), level: s.level, name: s.name });
  }
  out.sort((a, b) => a.diff - b.diff || b.level - a.level || a.name.localeCompare(b.name));
  return out.slice(0, slots).map(c => c.id);
}

// Which CH should a member move to? null = stay.
function channelTarget(leaderSnap, memberSnap) {
  if (!leaderSnap || !memberSnap || !leaderSnap.ok || !memberSnap.ok) return null;
  if (!leaderSnap.mapId || memberSnap.mapId !== leaderSnap.mapId) return null;
  if (typeof leaderSnap.channel !== 'number' || memberSnap.channel === leaderSnap.channel) return null;
  return leaderSnap.channel;
}

// Plan Script still has Base / Job level steps to do → the plan decides the map, the party doesn't move it
function planBlocked(s) {
  return !!(s && s.plan && Array.isArray(s.plan.levelPending) && s.plan.levelPending.length);
}

function normalizeFollowMode(mode, party, memberId) {
  if (!mode || mode === 'none') return 'none';
  const leaderId = party && party.leaderId ? String(party.leaderId) : '';
  if (mode === 'leader' || mode === 'member:' + leaderId) return 'leader';
  if (typeof mode === 'string' && mode.startsWith('member:')) {
    const targetId = mode.slice(7);
    if (!targetId || targetId === String(memberId)) return 'none';
    if (targetId === leaderId) return 'leader';
    const memberIds = Array.isArray(party && party.memberIds) ? party.memberIds.map(String) : [];
    if (memberIds.includes(targetId)) return 'member:' + targetId;
  }
  return 'none';
}

function sanitizeFollowModes(party) {
  const raw = party && party.followModes && typeof party.followModes === 'object' ? party.followModes : {};
  const out = {};
  for (const mid of (party && party.memberIds) || []) {
    const fm = normalizeFollowMode(raw[mid], party, mid);
    if (fm !== 'none') out[mid] = fm;
  }
  return out;
}

function resolveFollowTarget(party, memberId, profiles, states) {
  const mode = normalizeFollowMode(party && party.followModes && party.followModes[memberId], party, memberId);
  if (mode === 'none') return { mode: 'none', targetId: null, targetName: null, targetSnap: null };
  // เมื่อในปาร์ตี้มี Priest ออนไลน์: โหมดตามหัวตี้ ('leader') จะยึด Priest เป็นหลัก (ตามพระเป็นศูนย์กลาง)
  const priest = findPartyPriest(party, profiles, states);
  if (mode === 'leader' && priest) {
    if (String(memberId) === String(priest.id)) {
      return { mode: 'none', targetId: null, targetName: null, targetSnap: null, isAnchorPriest: true };
    }
    return { mode: 'leader', targetId: priest.id, targetName: priest.name, targetSnap: priest.snap, viaPriest: true };
  }
  const targetId = mode === 'leader' ? party.leaderId : mode.slice(7);
  const targetSnap = states ? states.get(targetId) : null;
  const targetProfile = profiles ? profiles.get(targetId) : null;
  const targetName = (targetSnap && targetSnap.name) || (targetProfile && targetProfile.lastCharName) || null;
  return { mode, targetId, targetName, targetSnap };
}

function sanitizeParty(p) {
  const leaderId = String(p.leaderId);
  const memberIds = Array.isArray(p.memberIds) ? p.memberIds.map(String).filter(id => id && id !== leaderId).slice(0, MAX_MEMBERS - 1) : [];
  const base = {
    id: String(p.id),
    leaderId,
    memberIds,
    excludedIds: Array.isArray(p.excludedIds) ? p.excludedIds.map(String) : [],
    expMode: EXP_MODES.includes(p.expMode) ? p.expMode : 'even-share',
    lootMode: LOOT_MODES.includes(p.lootMode) ? p.lootMode : 'personal',
    syncMap: p.syncMap !== false,
    autoFill: p.autoFill !== false,
    followModes: {},
    createdAt: Number(p.createdAt) || Date.now()
  };
  base.followModes = sanitizeFollowModes(Object.assign({}, base, { followModes: p.followModes }));
  return base;
}

// After a CH / map change the game joins a new room and may keep the old party object in its store even
// though the server already removed the player. Cross-check against the leader's own view when we can see it.
function normalizeStates(states) {
  const byName = new Map();
  for (const s of states.values()) if (s && s.ok && s.name) byName.set(s.name, s);
  for (const s of states.values()) {
    if (!s || !s.ok || !s.party || s.party.leader === s.name) continue;
    const lead = byName.get(s.party.leader);
    if (!lead) continue; // leader not one of ours — can't verify
    const leads = lead.party && lead.party.leader === lead.name;
    if (!leads || !lead.party.members.some(m => m.name === s.name)) { s.party = null; s.partyStale = true; }
  }
  return states;
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
function createPartyService(opts) {
  const { loadProfiles, evalProfilePort } = opts;
  const dataFile = opts.dataFile || path.join(__dirname, 'data', 'parties.json');
  const isBusy = opts.isBusy || (() => false);
  const now = opts.now || (() => Date.now());
  const sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const log = opts.log || ((...a) => console.log('[Party]', ...a));
  const T = Object.assign({}, TIMING, opts.timing || {});

  let parties = [];
  try {
    const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    parties = (Array.isArray(raw) ? raw : raw.parties || []).map(sanitizeParty);
  } catch (e) { parties = []; }

  const runtime = new Map();     // partyId -> { status, notes, lastTickAt, fallbackAt, ... }
  const memberRt = new Map();    // `${partyId}:${profileId}` -> counters
  const tempExcluded = new Map(); // `${partyId}:${profileId}` -> until
  let states = new Map();        // profileId -> snapshot | null
  let statesAt = 0;
  let ticking = false;
  let timer = null;

  function save() {
    try {
      fs.mkdirSync(path.dirname(dataFile), { recursive: true });
      const tmp = dataFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ parties }, null, 2));
      fs.renameSync(tmp, dataFile);
    } catch (e) { log('save failed', e.message); }
  }

  const mrt = (pid, id) => {
    const k = pid + ':' + id;
    if (!memberRt.has(k)) memberRt.set(k, { inviteAt: 0, inviteAttempts: 0, mapAt: 0, chAt: 0, chFails: 0, lastMoveAt: 0, leaveAt: 0, seenAt: now() });
    return memberRt.get(k);
  };
  const prt = pid => {
    if (!runtime.has(pid)) runtime.set(pid, { notes: [], settingsAt: 0, fallbackAt: 0, leaveAt: 0, lastTickAt: 0, gatherAt: 0, gathering: false, gatherNote: null, channelNote: null });
    return runtime.get(pid);
  };

  async function evalOk(port, code, timeoutMs) {
    const r = await evalProfilePort(port, code, timeoutMs || 6000);
    const res = r && r.result;
    return { ok: Boolean(r && r.success !== false && res && res.success !== false), result: res, error: (res && res.error) || (r && r.error) || null };
  }

  async function refreshStates(force) {
    if (!force && now() - statesAt < 4000) return states;
    const profiles = loadProfiles();
    const next = new Map();
    await Promise.all(profiles.map(async p => {
      if (!p.debugPort) { next.set(p.id, null); return; }
      const r = await evalProfilePort(p.debugPort, READ_JS, 5000);
      const s = r && r.success !== false && r.result && typeof r.result === 'object' ? r.result : null;
      next.set(p.id, s && s.ok ? s : (s ? s : null));
    }));
    states = normalizeStates(next);
    statesAt = now();
    return states;
  }

  function profileMap() {
    const m = new Map();
    for (const p of loadProfiles()) m.set(p.id, p);
    return m;
  }

  function managedNameSet() {
    const s = new Set();
    for (const st of states.values()) if (st && st.name) s.add(st.name);
    for (const p of loadProfiles()) if (p.lastCharName) s.add(p.lastCharName);
    return s;
  }

  async function act(profile, code, label, timeoutMs) {
    if (!profile || !profile.debugPort) return { ok: false, error: 'offline' };
    const r = await evalOk(profile.debugPort, code, timeoutMs);
    if (!r.ok) log(label, profile.name || profile.id, 'failed:', r.error);
    return r;
  }

  async function tickParty(party, profiles) {
    const rt = prt(party.id);
    const notes = [];
    rt.lastTickAt = now();
    const leaderP = profiles.get(party.leaderId);
    const L = states.get(party.leaderId);
    if (!leaderP) { rt.notes = ['ไม่พบโปรไฟล์หัวตี้แล้ว']; return; }
    if (!L || !L.ok || !L.name) { rt.notes = ['หัวตี้ออฟไลน์หรือยังไม่เข้าเกม']; return; }
    if (!L.partyKnown) notes.push('อ่านสถานะปาร์ตี้ในเกมไม่ได้ (หน้าเกมอาจยังโหลดไม่เสร็จ)');
    const managed = managedNameSet();

    // Leader stuck in another (stale bot) party → leave it first
    if (L.party && L.party.leader !== L.name) {
      if (managed.has(L.party.leader)) {
        if (now() - rt.leaveAt >= T.leaveCooldownMs) { rt.leaveAt = now(); await act(leaderP, ACTIONS.leave(), 'leader-leave'); }
        rt.notes = notes.concat('หัวตี้อยู่ในตี้เก่าของ ' + L.party.leader + ' — กำลังออกจากตี้นั้น');
      } else {
        rt.notes = notes.concat('หัวตี้อยู่ในตี้ของผู้เล่นอื่น (' + L.party.leader + ') — ออกจากตี้นั้นก่อน');
      }
      return;
    }

    // Drop members that have been offline / disconnected or stuck in another party so autoFill can pull free clients
    // (When autoFill is off, keep manually chosen members in the party until the user removes them)
    const inGameMembersMap = new Map();
    if (L.party && Array.isArray(L.party.members)) {
      for (const gm of L.party.members) if (gm && gm.name) inGameMembersMap.set(gm.name, gm);
    }
    const keep = [];
    for (const id of party.memberIds) {
      if (!profiles.has(id)) continue;
      const s = states.get(id), m = mrt(party.id, id);
      const charName = (s && s.name) || (profiles.get(id) && profiles.get(id).lastCharName) || null;
      const gm = charName ? inGameMembersMap.get(charName) : null;
      const isOnlineNow = Boolean(s && s.ok && s.name && (!gm || gm.online !== false));
      if (isOnlineNow) m.seenAt = now();
      if (party.autoFill && now() - m.seenAt >= T.dropOfflineAfterMs) {
        notes.push('ปลดสมาชิกที่ออฟไลน์นาน: ' + (charName || profiles.get(id).name || id));
        continue;
      }
      if (party.autoFill && s && s.ok && s.name && s.party && s.party.leader !== L.name) {
        if (!m.otherPartySince) m.otherPartySince = now();
        if ((m.leaveAttempts || 0) >= 2 || now() - m.otherPartySince >= (T.dropOtherPartyAfterMs || 45000)) {
          tempExcluded.set(party.id + ':' + id, now() + T.excludeAfterFailMs);
          m.otherPartySince = 0; m.leaveAttempts = 0;
          notes.push('สลับ ' + s.name + ' ออก (ติดอยู่ตี้อื่น) เพื่อดึงจอว่างเข้าแทน');
          continue;
        }
      } else {
        m.otherPartySince = 0; m.leaveAttempts = 0;
      }
      keep.push(id);
    }
    let changed = keep.length !== party.memberIds.length;
    party.memberIds = keep;
    if (changed) party.followModes = sanitizeFollowModes(party);

    if (L.party && L.party.leader === L.name && Array.isArray(L.party.members)) {
      const assignedBefore = new Set(party.memberIds.map(id => (states.get(id) && states.get(id).name) || (profiles.get(id) && profiles.get(id).lastCharName)).filter(Boolean));
      for (const m of L.party.members.slice()) {
        if (!m || !m.name || m.name === L.name) continue;
        if (!assignedBefore.has(m.name) && m.online === false) {
          await act(leaderP, ACTIONS.kick(m.name), 'kick-offline');
          L.party.members = L.party.members.filter(x => x.name !== m.name);
        }
      }
    }

    // Top up to 6 (leader included)
    if (party.autoFill) {
      const excluded = new Set(party.excludedIds);
      for (const [k, until] of tempExcluded) {
        if (until < now()) { tempExcluded.delete(k); continue; }
        const [pid, id] = k.split(':'); if (pid === party.id) excluded.add(id);
      }
      const inGameCount = L.party ? L.party.members.length : 1;
      const managedInGame = L.party ? L.party.members.filter(m => managed.has(m.name)).length : 1;
      const outsiders = Math.max(0, inGameCount - managedInGame);
      const slots = MAX_MEMBERS - 1 - party.memberIds.length - outsiders;
      let picks = pickCandidates(party, parties, states, managed, slots, excluded);
      // Fallback: if party still has empty slots and no non-excluded candidate is available, allow retrying temp-excluded clients
      if (!picks.length && slots > 0) {
        picks = pickCandidates(party, parties, states, managed, slots, new Set(party.excludedIds));
      }
      if (picks.length) { party.memberIds.push(...picks); changed = true; }
    }
    if (changed) save();

    if (L.party && L.party.leader === L.name && Array.isArray(L.party.members)) {
      const assignedAfter = new Set(party.memberIds.map(id => (states.get(id) && states.get(id).name) || (profiles.get(id) && profiles.get(id).lastCharName)).filter(Boolean));
      for (const m of L.party.members.slice()) {
        if (!m || !m.name || m.name === L.name) continue;
        if (!assignedAfter.has(m.name) && (m.online === false || managed.has(m.name))) {
          await act(leaderP, ACTIONS.kick(m.name), 'kick-unassigned');
          L.party.members = L.party.members.filter(x => x.name !== m.name);
        }
      }
    }

    const inGame = new Set(inGameMemberNames(L));
    const isLeader = !L.party || L.party.leader === L.name;
    const partyFull = L.party && L.party.members.length >= (L.party.maxMembers || MAX_MEMBERS);

    // Invites
    for (const id of party.memberIds) {
      const P = profiles.get(id), S = states.get(id), m = mrt(party.id, id);
      if (!S || !S.ok || !S.name) continue;
      if (inGame.has(S.name)) { m.inviteAttempts = 0; continue; }
      if (S.party && S.party.leader !== L.name) {
        if (now() - m.leaveAt >= T.leaveCooldownMs) {
          m.leaveAt = now();
          m.leaveAttempts = (m.leaveAttempts || 0) + 1;
          await act(P, ACTIONS.leave(), 'member-leave');
        }
        continue;
      }
      if (S.invite && S.invite.from === L.name) { await act(P, ACTIONS.accept(L.name), 'accept'); continue; }
      if (!isLeader || partyFull) continue;
      if (now() - m.inviteAt < T.inviteCooldownMs) continue;
      if (m.inviteAttempts >= T.inviteMaxAttempts) {
        if (party.autoFill) {
          tempExcluded.set(party.id + ':' + id, now() + T.excludeAfterFailMs);
          party.memberIds = party.memberIds.filter(x => x !== id);
          party.followModes = sanitizeFollowModes(party);
          m.inviteAttempts = 0;
          notes.push('ชวน ' + S.name + ' ไม่สำเร็จหลายครั้ง — สลับหาจอว่างอื่นแทน');
          save();
          continue;
        }
        m.inviteAttempts = 0;
      }
      m.inviteAt = now(); m.inviteAttempts++;
      const inv = await act(leaderP, ACTIONS.invite(S.name), 'invite');
      if (inv.ok) {
        await sleep(T.acceptDelayMs);
        await act(P, ACTIONS.accept(L.name), 'accept');
      }
    }

    // EXP / loot mode (leader only)
    if (L.party && L.party.leader === L.name && now() - rt.settingsAt >= T.settingsCooldownMs) {
      if (L.party.expMode !== party.expMode) {
        if (party.expMode === 'even-share' && !L.party.evenShareAllowed) {
          notes.push('แชร์ EXP ไม่ได้: เลเวลสมาชิกห่างกันเกิน ' + (L.party.levelRange || '?'));
        } else { rt.settingsAt = now(); await act(leaderP, ACTIONS.settings({ expMode: party.expMode }), 'exp-mode'); }
      }
      if (L.party.lootMode !== party.lootMode) { rt.settingsAt = now(); await act(leaderP, ACTIONS.settings({ lootMode: party.lootMode }), 'loot-mode'); }
    }

    // Per-member follow / assist mode:
    // - 'none' (default): cancel the game's follow (e.g. after รวมทีม) so the member farms the map independently
    //   (unless it is temporarily walking back to the Priest for buffs: S.returningToPriest === true).
    // - 'leader' or 'member:<id>': engage the game's follow on that party member (or the Priest when a Priest is in the party).
    const priest = findPartyPriest(party, profiles, states);
    const allPartyNames = [L.name].concat(party.memberIds.map(id => {
      const s = states.get(id), p = profiles.get(id);
      return (s && s.name) || (p && p.lastCharName) || null;
    })).filter(Boolean);

    for (const id of [party.leaderId].concat(party.memberIds)) {
      const P = profiles.get(id), S = states.get(id), m = mrt(party.id, id);
      if (!S || !S.ok || !S.name || (id !== party.leaderId && !inGame.has(S.name))) continue;
      const ft = id === party.leaderId
        ? { mode: 'none', targetId: null, targetName: null, targetSnap: null }
        : resolveFollowTarget(party, id, profiles, states);
      if (ft.mode === 'none' || ft.viaPriest) {
        if (!S.follow || S.returningToPriest) continue;
        if (now() - (m.unfollowAt || 0) < T.unfollowCooldownMs) continue;
        m.unfollowAt = now();
        const prev = S.follow;
        const r = await act(P, ACTIONS.stopFollow(), 'stop-follow');
        if (r.ok) { S.follow = null; log('stop-follow', S.name, '(was following ' + prev + ')'); }
      } else {
        if (S.returningToPriest) continue;
        if (!ft.targetName) continue;
        if (planBlocked(S) || (S.busy && S.busy.length)) continue;
        const TS = ft.targetSnap;
        const sameMapAndCh = TS && TS.ok && S.mapId && S.mapId === TS.mapId && S.channel === TS.channel;
        if (!sameMapAndCh) continue;
        if (S.follow === ft.targetName) continue;
        if (now() - (m.followAt || 0) < T.followCooldownMs) continue;
        m.followAt = now();
        const r = await act(P, ACTIONS.startFollow(ft.targetName), 'start-follow');
        if (r.ok) { S.follow = ft.targetName; log('start-follow', S.name, '->', ft.targetName); }
      }
    }

    // Same map + same CH as the party (Priest is the Channel Anchor when present on the farm map; otherwise Leader)
    let leaderMap = null;
    if (L.targetMap && !isCityMapName(L.targetMap)) leaderMap = L.targetMap;
    else if (L.mapName && !isCityMapName(L.mapName)) leaderMap = L.mapName;
    else if (L.keptFarmMap && !isCityMapName(L.keptFarmMap)) leaderMap = L.keptFarmMap;
    else if (rt.lastLeaderFarmMap && !isCityMapName(rt.lastLeaderFarmMap)) leaderMap = rt.lastLeaderFarmMap;
    else leaderMap = L.targetMap || L.mapName;
    if (leaderMap && !isCityMapName(leaderMap)) rt.lastLeaderFarmMap = leaderMap;

    if (party.syncMap) {
      let anchorId = party.leaderId;
      let anchorSnap = L;
      if (priest && priest.snap && priest.snap.ok && priest.snap.mapId && !isCityMapName(priest.snap.mapName)) {
        const onFarmMap = !leaderMap || (priest.snap.mapName && priest.snap.mapName.includes(leaderMap)) || priest.snap.mapId === L.mapId;
        if (onFarmMap) {
          anchorId = priest.id;
          anchorSnap = priest.snap;
        }
      }

      const anchorOnFarm = Boolean(anchorSnap && anchorSnap.mapId && !isCityMapName(anchorSnap.mapName));
      const needsInitialChannelCheck = Boolean(
        anchorOnFarm &&
        rt.settledMapId !== anchorSnap.mapId &&
        anchorSnap.helpers &&
        anchorSnap.helpers.evaluateAnchorChannel
      );
      const desiredCh = (anchorOnFarm && rt.settledMapId === anchorSnap.mapId && typeof rt.settledChannel === 'number')
        ? rt.settledChannel
        : (anchorSnap ? anchorSnap.channel : L.channel);

      const movers = [];
      // If Priest is the Channel Anchor (or settledChannel is locked on this map) and the Leader is on a different CH on the same map, Leader moves too!
      if (anchorOnFarm && L.mapId === anchorSnap.mapId && typeof desiredCh === 'number' && L.channel !== desiredCh && !(L.busy && L.busy.length) && L.helpers && L.helpers.moveToChannel) {
        if (anchorId !== party.leaderId || rt.settledMapId === anchorSnap.mapId) {
          movers.push(party.leaderId);
        }
      }

      for (const id of party.memberIds) {
        const P = profiles.get(id), S = states.get(id), m = mrt(party.id, id);
        if (!S || !S.ok || !S.name || !inGame.has(S.name)) continue;
        if (planBlocked(S)) continue; // the plan still levels this character on its own maps
        if (S.busy && S.busy.length) continue;
        const wrongTarget = Boolean(leaderMap && S.targetMap !== leaderMap);
        const wrongCurrentMap = Boolean(
          leaderMap &&
          !isCityMapName(leaderMap) &&
          S.botRunning &&
          S.mapName &&
          !S.mapName.includes(leaderMap) &&
          !isCityMapName(S.mapName)
        );
        if ((wrongTarget || wrongCurrentMap) && S.helpers && S.helpers.setTargetFarmMap && now() - m.mapAt >= T.mapCooldownMs) {
          m.mapAt = now();
          await act(P, ACTIONS.setMap(leaderMap, S.botRunning), 'set-map');
        }
        if (anchorSnap && S.mapId && S.mapId === anchorSnap.mapId && typeof desiredCh === 'number' && S.channel !== desiredCh && S.helpers && S.helpers.moveToChannel) {
          movers.push(id);
        }
      }
      if ((needsInitialChannelCheck || movers.length) && !rt.gathering && now() - rt.gatherAt >= T.gatherCooldownMs && !isBusy()) {
        gatherChannels(party, profiles, anchorId, anchorSnap, movers, needsInitialChannelCheck, allPartyNames).catch(e => log('gather error', e.message));
      }
      if (rt.gathering && rt.gatherNote) notes.push(rt.gatherNote);
      else if (rt.channelNote) notes.push(rt.channelNote);
    }

    // Push Priest-centric sync state + priority buffQueue to all clients in the party that support updatePartySyncState
    const buffQueue = [];
    for (const id of [party.leaderId].concat(party.memberIds)) {
      const s = states.get(id);
      if (!s || !s.ok || !s.name) continue;
      if (priest && String(priest.id) === String(id)) continue;
      if (priest && priest.snap && priest.snap.ok) {
        if (s.mapId !== priest.snap.mapId || s.channel !== priest.snap.channel) continue;
      }
      const bs = s.buffStatus || {};
      const minCoreBuffMs = typeof bs.minCoreBuffMs === 'number'
        ? bs.minCoreBuffMs
        : Math.min(typeof bs.blessingMs === 'number' ? bs.blessingMs : 999999, typeof bs.agiMs === 'number' ? bs.agiMs : 999999);
      const hpPct = typeof bs.hpPct === 'number' ? bs.hpPct : 1;
      const needsHeal = Boolean(bs.needsHeal || (hpPct > 0 && hpPct < 0.65));
      const needsBuff = Boolean(s.needsPriestBuff || s.returningToPriest || bs.needsBuff || minCoreBuffMs < 25000);
      if (needsHeal || needsBuff) {
        buffQueue.push({
          id: String(id),
          name: s.name,
          hpPct,
          minCoreBuffMs,
          blessingMs: typeof bs.blessingMs === 'number' ? bs.blessingMs : 0,
          agiMs: typeof bs.agiMs === 'number' ? bs.agiMs : 0,
          needsHeal,
          needsBuff,
          returningToPriest: Boolean(s.returningToPriest)
        });
      }
    }
    // Sort by priority: 1) Emergency heal (lowest HP% first) -> 2) Lowest remaining core buff time first
    buffQueue.sort((a, b) => {
      if (a.needsHeal !== b.needsHeal) return a.needsHeal ? -1 : 1;
      if (a.needsHeal && b.needsHeal && Math.abs(a.hpPct - b.hpPct) > 0.05) return a.hpPct - b.hpPct;
      return a.minCoreBuffMs - b.minCoreBuffMs;
    });

    const membersNeedingBuff = buffQueue.length;
    for (const id of [party.leaderId].concat(party.memberIds)) {
      const P = profiles.get(id), S = states.get(id);
      if (!P || !S || !S.ok || !S.helpers || !S.helpers.updatePartySyncState) continue;
      let effMode = 'none';
      if (id !== party.leaderId) {
        const ft = resolveFollowTarget(party, id, profiles, states);
        effMode = ft.viaPriest ? 'none' : ft.mode;
      }
      await act(P, ACTIONS.syncClientPartyState({
        partyId: party.id,
        leaderName: L.name,
        priestName: priest ? priest.name : null,
        isAnchorPriest: Boolean(priest && String(priest.id) === String(id)),
        followMode: effMode,
        forcedMap: (party.syncMap && id !== party.leaderId && !planBlocked(S)) ? leaderMap : null,
        partyNames: allPartyNames,
        membersNeedingBuff,
        buffQueue
      }), 'sync-party-state');
    }

    rt.notes = notes;
  }

  // Bring everyone onto the Anchor's CH (Priest when present on the farm map, otherwise Leader):
  // 1. On first arrival at a farm map (rt.settledMapId !== anchorSnap.mapId), the Anchor checks once for the
  //    least-crowded channel and locks rt.settledMapId + rt.settledChannel so it NEVER loops switching channels.
  // 2. Moves members (including Leader when Priest is Anchor, and independent 'none' members) to that locked CH.
  // 3. If a member can't enter that CH (full 40/40), the Anchor moves to the least-crowded CH and updates rt.settledChannel.
  async function gatherChannels(party, profiles, anchorId, anchorSnap, movers, needsInitialChannelCheck, allPartyNames) {
    const rt = prt(party.id);
    rt.gathering = true; rt.gatherAt = now();
    const anchorP = profiles.get(anchorId) || profiles.get(party.leaderId);
    const anchorLabel = (priestLabel => priestLabel ? 'พระ (' + anchorSnap.name + ')' : 'หัวตี้')(isPriestClass(anchorSnap && anchorSnap.classId));
    const moveAll = async (ids, ch) => {
      for (const id of ids) {
        if (!parties.includes(party)) return { ok: false, aborted: true };
        const S = states.get(id);
        const nm = (S && S.name) || id;
        if (S && S.channel === ch) continue;
        rt.gatherNote = nm + ' กำลังย้ายไป CH ' + ch + ' (รอคูลดาวน์/ที่ว่างให้เอง)';
        const r = await act(profiles.get(id), ACTIONS.moveChannelWait(ch, T.memberMoveWaitMs), 'move-ch', T.memberMoveWaitMs + 10000);
        if (!(r.ok && r.result && r.result.success)) return { ok: false, who: nm, error: (r.result && r.result.error) || r.error };
      }
      return { ok: true };
    };
    try {
      let targetCh = (rt.settledMapId === anchorSnap.mapId && typeof rt.settledChannel === 'number')
        ? rt.settledChannel
        : anchorSnap.channel;

      // Step 1: One-time least-crowded channel selection upon entering a farm map (never loops on the same mapId)
      if (needsInitialChannelCheck && anchorP && anchorSnap && anchorSnap.mapId) {
        rt.gatherNote = anchorLabel + ' กำลังสแกนหา CH ที่คนน้อยสุด (เช็กครั้งเดียวเมื่อลงแมพ)';
        const ev = await act(anchorP, ACTIONS.evaluateAnchorChannel(1 + party.memberIds.length, allPartyNames || []), 'eval-anchor-ch', 12000);
        if (ev.ok && ev.result && ev.result.shouldSwitch && typeof ev.result.channel === 'number' && ev.result.channel !== anchorSnap.channel) {
          const wantCh = ev.result.channel;
          rt.gatherNote = anchorLabel + ' กำลังย้ายไป CH ' + wantCh + ' (คนน้อยสุด)';
          const am = await act(anchorP, ACTIONS.moveChannelWait(wantCh, T.leaderMoveWaitMs), 'anchor-move-ch', T.leaderMoveWaitMs + 10000);
          const realCh = (am.result && typeof am.result.channel === 'number') ? am.result.channel : anchorSnap.channel;
          targetCh = realCh;
          anchorSnap.channel = realCh;
        } else {
          targetCh = anchorSnap.channel;
        }
        rt.settledMapId = anchorSnap.mapId;
        rt.settledChannel = targetCh;
      }

      // Recompute who needs to move to targetCh now
      const LNow = states.get(party.leaderId);
      const inGameNow = new Set(inGameMemberNames(LNow));
      const todoIds = [];
      for (const id of [party.leaderId].concat(party.memberIds)) {
        const S = states.get(id);
        if (!S || !S.ok || !S.name) continue;
        if (id !== party.leaderId && !inGameNow.has(S.name)) continue;
        if (planBlocked(S) || (S.busy && S.busy.length) || !(S.helpers && S.helpers.moveToChannel)) continue;
        if (S.mapId === anchorSnap.mapId && S.channel !== targetCh) todoIds.push(id);
      }
      for (const id of movers || []) {
        if (!todoIds.includes(id)) {
          const S = states.get(id);
          if (S && S.channel !== targetCh) todoIds.push(id);
        }
      }

      if (!todoIds.length) { rt.channelNote = null; return; }
      const first = await moveAll(todoIds, targetCh);
      if (first.ok) { rt.channelNote = null; return; }
      if (first.aborted) return;
      if (now() - rt.fallbackAt < T.fallbackCooldownMs) {
        rt.channelNote = first.who + ' เข้า CH ' + targetCh + ' ไม่ได้ — จะลองใหม่อีกครั้ง';
        return;
      }
      rt.fallbackAt = now();
      rt.gatherNote = first.who + ' เข้า CH ' + targetCh + ' ไม่ได้ — ' + anchorLabel + ' กำลังหา CH ที่คนน้อยสุด';
      const least = await act(anchorP, ACTIONS.leastChannel(), 'least-ch', 15000);
      const ch = least.ok && least.result ? least.result.channel : null;
      if (typeof ch !== 'number' || ch === targetCh) {
        rt.channelNote = first.who + ' เข้า CH ' + targetCh + ' ไม่ได้ และหา CH ที่ว่างกว่าไม่ได้';
        return;
      }
      rt.gatherNote = anchorLabel + ' กำลังย้ายไป CH ' + ch + ' (คนน้อยสุด)';
      const lm = await act(anchorP, ACTIONS.moveChannelWait(ch, T.leaderMoveWaitMs), 'leader-move-ch', T.leaderMoveWaitMs + 10000);
      const real = lm.result && typeof lm.result.channel === 'number' ? lm.result.channel : null;
      if (real == null || real === targetCh) {
        rt.channelNote = anchorLabel + ' ย้ายไป CH ' + ch + ' ไม่ได้ — จะลองใหม่ภายหลัง';
        return;
      }
      rt.settledMapId = anchorSnap.mapId;
      rt.settledChannel = real;
      // Everyone on the farm map follows to where the Anchor really is now
      await refreshStates(true);
      const L2 = states.get(party.leaderId);
      const inGame2 = new Set(inGameMemberNames(L2));
      const follow = [party.leaderId].concat(party.memberIds).filter(id => {
        if (id === anchorId) return false;
        const S = states.get(id);
        return S && S.ok && S.name && (id === party.leaderId || inGame2.has(S.name)) && !planBlocked(S) && !(S.busy && S.busy.length) && S.helpers && S.helpers.moveToChannel && S.mapId === anchorSnap.mapId && S.channel !== real;
      });
      const second = await moveAll(follow, real);
      rt.channelNote = second.ok
        ? null
        : (second.aborted ? null : second.who + ' ย้ายตามไป CH ' + real + ' ไม่ได้ — จะลองใหม่อีกครั้ง');
      if (second.ok) log('party', party.id, 'regrouped on CH', real);
    } finally {
      rt.gathering = false; rt.gatherNote = null; rt.gatherAt = now();
    }
  }

  async function tick() {
    if (ticking) return;
    if (!parties.length) return;
    if (isBusy()) return;
    ticking = true;
    try {
      await refreshStates(true);
      const profiles = profileMap();
      for (const party of parties.slice()) {
        if (!parties.includes(party)) continue;
        try { await tickParty(party, profiles); } catch (e) { log('tick error', party.id, e.message); prt(party.id).notes = ['ผิดพลาด: ' + e.message]; }
      }
    } finally { ticking = false; }
  }

  function memberView(party, id, profiles, leaderSnap) {
    const P = profiles.get(id), S = states.get(id);
    const inGame = new Set(inGameMemberNames(leaderSnap));
    const priest = findPartyPriest(party, profiles, states);
    const anchorSnap = (priest && priest.snap && priest.snap.ok && priest.snap.mapId && !isCityMapName(priest.snap.mapName)) ? priest.snap : leaderSnap;
    const ft = id === party.leaderId ? { mode: 'none', targetId: null, targetName: null } : resolveFollowTarget(party, id, profiles, states);
    let status = 'offline', text = 'ออฟไลน์';
    if (S && S.ok && S.name) {
      if (inGame.has(S.name)) {
        const same = anchorSnap && S.mapId === anchorSnap.mapId && S.channel === anchorSnap.channel;
        status = same ? 'joined' : 'apart';
        if (same && S.priestBuffingTarget) {
          text = 'เดินไปบัฟ ' + S.priestBuffingTarget;
        } else if (same && S.returningToPriest && priest) {
          text = 'เดินไปรับบัฟพระ (' + priest.name + ')';
        } else if (same && ft.isAnchorPriest) {
          text = 'พระหลัก (ศูนย์กลางตี้)';
        } else if (same && ft.mode !== 'none' && S.follow && (!ft.targetName || S.follow === ft.targetName)) {
          text = ft.viaPriest ? ('ตามพระ (' + ft.targetName + ')') : (ft.mode === 'leader' ? 'ตามหัวตี้' : ('ตาม ' + (ft.targetName || S.follow)));
        } else {
          text = same ? 'อยู่ด้วยกัน' : (S.mapId !== (anchorSnap && anchorSnap.mapId) ? 'กำลังไปแมพตี้' : 'กำลังย้าย CH');
        }
        if (!same && planBlocked(S)) { status = 'plan'; text = 'แผนยังเก็บเลเวล (' + S.plan.levelPending[0] + ')'; }
      } else if (S.party && leaderSnap && S.party.leader !== leaderSnap.name) { status = 'other'; text = 'อยู่ตี้อื่น'; }
      else { status = 'inviting'; text = 'กำลังชวน'; }
    } else if (S && S.reason === 'not-in-game') { status = 'offline'; text = 'ยังไม่เข้าเกม'; }
    return {
      id, profileName: P ? P.name : id, charName: (S && S.name) || (P && P.lastCharName) || null,
      charClass: (S && S.classId) || (P ? P.lastCharClass || null : null), level: S && S.level, mapName: S && S.mapName, channel: S && S.channel,
      followMode: ft.isAnchorPriest ? 'leader' : ft.mode, followTargetId: ft.targetId, followTargetName: ft.targetName, following: (S && S.follow) || null,
      status, statusText: text
    };
  }

  function view() {
    const profiles = profileMap();
    const taken = assignedIds(parties);
    const list = parties.map((p, i) => {
      const L = states.get(p.leaderId);
      const rt = prt(p.id);
      return {
        id: p.id, index: i + 1, expMode: p.expMode, lootMode: p.lootMode, syncMap: p.syncMap, autoFill: p.autoFill,
        followModes: p.followModes || {},
        leader: Object.assign(memberView(p, p.leaderId, profiles, L), L && L.ok ? { status: 'leader', statusText: L.party && L.party.leader === L.name ? 'หัวตี้' : 'หัวตี้ (ยังไม่มีสมาชิก)' } : {}),
        members: p.memberIds.map(id => memberView(p, id, profiles, L)),
        count: 1 + p.memberIds.length, max: MAX_MEMBERS,
        inGame: L && L.party ? { expMode: L.party.expMode, lootMode: L.party.lootMode, evenShareAllowed: L.party.evenShareAllowed, levelRange: L.party.levelRange, size: L.party.members.length } : null,
        notes: rt.notes || [], lastTickAt: rt.lastTickAt
      };
    });
    const clients = [...profiles.values()].map(p => {
      const S = states.get(p.id);
      return { id: p.id, name: p.name, charName: (S && S.name) || p.lastCharName || null, charClass: (S && S.classId) || p.lastCharClass || null,
        level: S && S.ok ? S.level : null, online: !!(S && S.ok && S.name), inGameParty: !!(S && S.party), assigned: taken.has(p.id),
        planPending: planBlocked(S) ? S.plan.levelPending[0] : null,
        mapName: S && S.mapName, channel: S && S.channel };
    });
    return { success: true, parties: list, clients, statesAt, maxMembers: MAX_MEMBERS };
  }

  async function disband(party) {
    const profiles = profileMap();
    for (const id of [party.leaderId].concat(party.memberIds || [])) {
      const P = profiles.get(id), S = states.get(id);
      if (P && S && S.ok && S.helpers && S.helpers.updatePartySyncState) {
        await act(P, ACTIONS.syncClientPartyState(null), 'clear-party-sync');
      }
    }
    let leaderName = null;
    // Members first (otherwise the game hands leadership to a member and the party lives on), then the leader.
    // The server drops rapid back-to-back party changes, so space them out and retry a few rounds.
    for (let round = 0; round < 4; round++) {
      await refreshStates(true);
      const L = states.get(party.leaderId);
      if (L && L.name) leaderName = L.name;
      if (!leaderName) return;
      const stillIn = party.memberIds.filter(id => { const S = states.get(id); return S && S.ok && S.party && S.party.leader === leaderName; });
      const leaderLeads = L && L.ok && L.party && L.party.leader === leaderName;
      if (!stillIn.length && !leaderLeads) return;
      for (const id of stillIn) { await act(profiles.get(id), ACTIONS.leave(), 'disband-leave'); await sleep(T.disbandGapMs); }
      if (leaderLeads && !stillIn.length) { await act(profiles.get(party.leaderId), ACTIONS.leave(), 'disband-leader'); await sleep(T.disbandGapMs); }
    }
  }

  async function handleRoute(req, res, pathname, sendJSON) {
    if (!pathname.startsWith('/api/parties')) return false;
    if (pathname === '/api/parties' && req.method === 'GET') {
      await refreshStates(false);
      sendJSON(view());
      return true;
    }
    if (pathname === '/api/parties' && req.method === 'POST') {
      const body = (await readBody(req)) || {};
      const leaderId = body && String(body.leaderId || '');
      const profiles = profileMap();
      const taken = assignedIds(parties);
      if (!leaderId || !profiles.has(leaderId)) { sendJSON({ success: false, error: 'ไม่พบจอที่เลือกเป็นหัวตี้' }, 400); return true; }
      if (taken.has(leaderId)) { sendJSON({ success: false, error: 'จอนี้อยู่ในตี้อื่นแล้ว' }, 409); return true; }
      const initialMembers = Array.isArray(body.memberIds)
        ? body.memberIds.map(String).filter(id => id && id !== leaderId && profiles.has(id) && !taken.has(id))
        : [];
      const party = sanitizeParty({ id: 'party_' + now().toString(36) + Math.random().toString(36).slice(2, 6), leaderId,
        memberIds: initialMembers, autoFill: body.autoFill, syncMap: body.syncMap, followModes: body.followModes,
        expMode: body.expMode, lootMode: body.lootMode, createdAt: now() });
      parties.push(party);
      save();
      setTimeout(() => tick().catch(() => {}), 50);
      sendJSON(Object.assign(view(), { created: party.id }));
      return true;
    }
    const m = pathname.match(/^\/api\/parties\/([^/]+)\/(settings|add-member|remove-member|summon|delete)$/);
    if (!m || req.method !== 'POST') return false;
    const party = parties.find(p => p.id === m[1]);
    if (!party) { sendJSON({ success: false, error: 'ไม่พบตี้นี้' }, 404); return true; }
    const body = (await readBody(req)) || {};
    if (m[2] === 'settings') {
      if (body.expMode !== undefined) { if (!EXP_MODES.includes(body.expMode)) { sendJSON({ success: false, error: 'โหมด EXP ไม่ถูกต้อง' }, 400); return true; } party.expMode = body.expMode; }
      if (body.lootMode !== undefined) { if (!LOOT_MODES.includes(body.lootMode)) { sendJSON({ success: false, error: 'โหมดไอเทมไม่ถูกต้อง' }, 400); return true; } party.lootMode = body.lootMode; }
      if (body.syncMap !== undefined) party.syncMap = !!body.syncMap;
      if (body.autoFill !== undefined) party.autoFill = !!body.autoFill;
      if (body.followModes && typeof body.followModes === 'object') {
        party.followModes = Object.assign({}, party.followModes || {}, body.followModes);
        party.followModes = sanitizeFollowModes(party);
      }
      if (body.memberFollow && typeof body.memberFollow === 'object') {
        const mid = String(body.memberFollow.profileId || '');
        if (!party.memberIds.includes(mid)) { sendJSON({ success: false, error: 'จอนี้ไม่ได้อยู่ในตี้' }, 400); return true; }
        if (!party.followModes) party.followModes = {};
        const fm = normalizeFollowMode(body.memberFollow.mode, party, mid);
        if (fm === 'none') delete party.followModes[mid];
        else party.followModes[mid] = fm;
        party.followModes = sanitizeFollowModes(party);
        const profiles = profileMap();
        const P = profiles.get(mid), S = states.get(mid);
        const mState = mrt(party.id, mid);
        mState.unfollowAt = 0; mState.followAt = 0;
        if (P && S && S.ok) {
          if (fm === 'none') {
            if (S.follow) {
              const r = await act(P, ACTIONS.stopFollow(), 'stop-follow');
              if (r.ok) S.follow = null;
            }
          } else {
            const ft = resolveFollowTarget(party, mid, profiles, states);
            if (ft.targetName && S.follow !== ft.targetName) {
              const r = await act(P, ACTIONS.startFollow(ft.targetName), 'start-follow');
              if (r.ok) S.follow = ft.targetName;
            }
          }
        }
      }
      prt(party.id).settingsAt = 0;
      save();
      setTimeout(() => tick().catch(() => {}), 50);
      sendJSON(view());
      return true;
    }
    if (m[2] === 'add-member') {
      const profiles = profileMap();
      const taken = assignedIds(parties);
      const rawIds = Array.isArray(body.profileIds) ? body.profileIds : (body.profileId ? [body.profileId] : []);
      const ids = rawIds.map(x => String(x || '').trim()).filter(Boolean);
      if (!ids.length) { sendJSON({ success: false, error: 'กรุณาเลือกสมาชิกที่จะเพิ่มเข้าตี้' }, 400); return true; }
      let added = 0;
      for (const id of ids) {
        if (!profiles.has(id)) { if (ids.length === 1) { sendJSON({ success: false, error: 'ไม่พบจอที่เลือก' }, 400); return true; } continue; }
        if (id === party.leaderId || party.memberIds.includes(id)) { if (ids.length === 1) { sendJSON({ success: false, error: 'จอนี้อยู่ในตี้นี้แล้ว' }, 409); return true; } continue; }
        if (taken.has(id)) { if (ids.length === 1) { sendJSON({ success: false, error: 'จอนี้อยู่ในตี้อื่นแล้ว' }, 409); return true; } continue; }
        if (party.memberIds.length >= MAX_MEMBERS - 1) { if (!added) { sendJSON({ success: false, error: 'ตี้นี้เต็มแล้ว (สูงสุด 6 คนรวมหัวตี้)' }, 409); return true; } break; }
        party.excludedIds = party.excludedIds.filter(x => x !== id);
        tempExcluded.delete(party.id + ':' + id);
        memberRt.delete(party.id + ':' + id);
        party.memberIds.push(id);
        taken.add(id);
        if (body.followMode !== undefined) {
          if (!party.followModes) party.followModes = {};
          const fm = normalizeFollowMode(body.followMode, party, id);
          if (fm !== 'none') party.followModes[id] = fm;
        }
        added++;
      }
      party.followModes = sanitizeFollowModes(party);
      save();
      setTimeout(() => tick().catch(() => {}), 50);
      sendJSON(Object.assign(view(), { added }));
      return true;
    }
    if (m[2] === 'remove-member') {
      const id = String(body.profileId || '');
      if (!party.memberIds.includes(id)) { sendJSON({ success: false, error: 'จอนี้ไม่ได้อยู่ในตี้' }, 400); return true; }
      party.memberIds = party.memberIds.filter(x => x !== id);
      party.followModes = sanitizeFollowModes(party);
      if (!party.excludedIds.includes(id)) party.excludedIds.push(id);
      save();
      const profiles = profileMap();
      const S = states.get(id), L = states.get(party.leaderId);
      if (S && S.ok && S.helpers && S.helpers.updatePartySyncState) {
        await act(profiles.get(id), ACTIONS.syncClientPartyState(null), 'clear-party-sync');
      }
      if (S && S.ok && S.follow) {
        const r = await act(profiles.get(id), ACTIONS.stopFollow(), 'stop-follow');
        if (r.ok) S.follow = null;
      }
      if (S && S.name && L && L.party && L.party.leader === L.name && inGameMemberNames(L).includes(S.name)) {
        await act(profiles.get(party.leaderId), ACTIONS.kick(S.name), 'kick');
      }
      sendJSON(view());
      return true;
    }
    if (m[2] === 'summon') {
      const r = await act(profileMap().get(party.leaderId), ACTIONS.summon(), 'summon');
      sendJSON(Object.assign(view(), { success: r.ok, error: r.ok ? null : 'หัวตี้ออฟไลน์หรือไม่ตอบสนอง' }));
      return true;
    }
    if (m[2] === 'delete') {
      parties = parties.filter(p => p !== party);
      save();
      try { await disband(party); } catch (e) { log('disband error', e.message); }
      runtime.delete(party.id);
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

  return { handleRoute, tick, start, stop, view, _parties: () => parties, _states: () => states };
}

module.exports = { createPartyService, pickCandidates, channelTarget, assignedIds, sanitizeParty, normalizeFollowMode, sanitizeFollowModes, findPartyPriest, resolveFollowTarget, normalizeStates, READ_JS, ACTIONS, MAX_MEMBERS };
