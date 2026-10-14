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

// Evaluates inside the game client (Electron or Browser mode).
// Reads character, guild state, pending guild invite, and checks which daily material tiers can be donated.
const PROBE_GUILD_CLIENT_JS = `(() => {
  try {
    let s = (typeof getReactStore === 'function') ? getReactStore() : null;
    if (!s) {
      const root = document.getElementById('root');
      const container = root && Object.keys(root).find(k => k.startsWith('__reactContainer'));
      if (container) {
        const q = [root[container]];
        const seen = new Set();
        while (q.length) {
          const n = q.shift();
          if (!n || seen.has(n)) continue;
          seen.add(n);
          const st = n.memoizedState;
          if (st && typeof st === 'object') {
            let cur = st;
            while (cur) {
              const v = cur.memoizedState;
              if (v && typeof v === 'object' && ('character' in v) && ('guild' in v)) { s = v; break; }
              cur = cur.next;
            }
          }
          if (s) break;
          if (n.child) q.push(n.child);
          if (n.sibling) q.push(n.sibling);
        }
      }
    }
    const room = (typeof getGameRoom === 'function') ? getGameRoom() : window.__gameRoom;
    const roomOpen = !!(room && room.connection && room.connection.isOpen);
    const ch = s && s.character;
    if (!ch || !ch.name) {
      return { inWorld: false, roomOpen };
    }
    const g = s.guild;
    const inv = s.invite;
    const bag = Array.isArray(s.inventory) ? s.inventory : [];

    // Count unequipped, unrefined bag items by itemId
    const bagCounts = {};
    for (const it of bag) {
      if (!it || it.equipped || Number(it.refine || 0) > 0) continue;
      const id = Number(it.itemId);
      if (!id) continue;
      bagCounts[id] = (bagCounts[id] || 0) + Number(it.qty || it.count || 0);
    }

    let inGameGuild = null;
    const donatableTiers = [];
    const tierSummaries = [];

    if (g && g.id) {
      const mats = Array.isArray(g.materials) ? g.materials : [];
      const lv = Number(ch.level || 1);
      for (const m of mats) {
        if (!m || !Array.isArray(m.items) || m.items.length === 0) continue;
        const minLv = Number(m.minLevel || 1);
        const lvOk = lv >= minLv;
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
    if (inv && inv.kind === 'guild') {
      pendingGuildInvite = {
        from: inv.from || '',
        label: inv.label || '',
        expiresAt: Number(inv.expiresAt || 0)
      };
    }

    return {
      inWorld: true,
      roomOpen,
      charName: ch.name,
      level: Number(ch.level || 1),
      jobLevel: Number(ch.jobLevel || 1),
      className: ch.classTh || ch.className || ch.classId || '',
      zeny: Number(ch.zeny || 0),
      mapName: (s.map && (s.map.name || s.map.id)) || ch.mapName || ch.mapId || '',
      inGameGuild,
      pendingGuildInvite,
      donatableTiers
    };
  } catch (e) {
    return { inWorld: false, error: e.message };
  }
})()`;

function sendGuildActionJs(payloadObj) {
  return `(() => {
    const room = (typeof getGameRoom === 'function') ? getGameRoom() : window.__gameRoom;
    if (!room || !room.connection || !room.connection.isOpen) {
      return { ok: false, error: 'no-room' };
    }
    room.send('guild', ${JSON.stringify(payloadObj)});
    return { ok: true };
  })()`;
}

function createGuildService({ loadProfiles, evalProfilePort, dataFile, isBusy }) {
  let state = loadState();
  // Runtime status per profileId
  const liveStatus = {};
  let syncInFlight = false;
  let timer = null;

  function loadState() {
    try {
      if (fs.existsSync(dataFile)) {
        const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        if (raw && Array.isArray(raw.guilds)) {
          return {
            autoDonate: raw.autoDonate !== false,
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
    return { autoDonate: true, guilds: [] };
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
          donatableTiers: pr.donatableTiers || []
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

  async function tryAutoDonateForProfile(g, profileId, profile, probe) {
    if (state.autoDonate === false || g.autoDonate === false) return false;
    if (!profile || !profile.debugPort || !probe || !probe.inWorld) return false;
    const ig = probe.inGameGuild;
    if (!ig || !ig.id) return false;
    if (ig.donatedToday) {
      const today = getThaiDateKey();
      if (g.lastDonatedDateByProfile[profileId] !== today) {
        g.lastDonatedDateByProfile[profileId] = today;
        saveState();
      }
      return false;
    }
    const tiers = Array.isArray(probe.donatableTiers) ? probe.donatableTiers : [];
    if (tiers.length === 0) return false;

    const chosen = tiers[0]; // highest exp / tier available
    await evalProfilePort(profile.debugPort, sendGuildActionJs({ action: 'donateMaterial', tier: chosen.tier }), 3000);
    const today = getThaiDateKey();
    g.lastDonatedDateByProfile[profileId] = today;
    saveState();
    setActionNote(profileId, `บริจาครายวัน Tier ${chosen.tier} (+${chosen.exp} EXP)`);
    return true;
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

    const inGameMemberNames = new Set((igGuild.members || []).map(m => normName(m.name)));

    // 4. Sync each member (invite -> accept -> auto daily donate)
    for (const memId of g.memberIds) {
      const memProfile = byId.get(memId);
      let memProbe = probes.get(memId);
      if (!memProfile || !memProfile.debugPort || !memProbe || !memProbe.inWorld || !memProbe.roomOpen) {
        setActionNote(memId, 'ออฟไลน์');
        continue;
      }

      const memInSameGuild = (
        (memProbe.inGameGuild && (memProbe.inGameGuild.id === igGuild.id || normName(memProbe.inGameGuild.name) === normName(igGuild.name))) ||
        inGameMemberNames.has(normName(memProbe.charName))
      );

      if (memInSameGuild) {
        const donated = await tryAutoDonateForProfile(g, memId, memProfile, memProbe);
        if (!donated) {
          const isDonated = !!(memProbe.inGameGuild && memProbe.inGameGuild.donatedToday);
          setActionNote(memId, isDonated ? 'บริจาครายวันแล้ว' : 'อยู่ในกิลด์แล้ว');
        }
        continue;
      }

      // If member is in a different guild, leave it only if they are not master of that guild
      if (memProbe.inGameGuild && memProbe.inGameGuild.id !== igGuild.id) {
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
        await new Promise(r => setTimeout(r, 500));
        memProbe = await probeClient(memProfile.debugPort);
        probes.set(memId, memProbe);
        if (memProbe && memProbe.inGameGuild) {
          await tryAutoDonateForProfile(g, memId, memProfile, memProbe);
        }
        continue;
      }

      // Otherwise, leader invites member by character name, then member accepts
      if ((igGuild.members || []).length >= (igGuild.maxMembers || 20)) {
        setActionNote(memId, `กิลด์เต็ม (${igGuild.maxMembers || 20} คน)`);
        continue;
      }

      setActionNote(memId, `เชิญ ${memProbe.charName} เข้ากิลด์`);
      await evalProfilePort(leaderProfile.debugPort, sendGuildActionJs({ action: 'invite', name: memProbe.charName }), 3000);
      await new Promise(r => setTimeout(r, 650));

      const afterInviteProbe = await probeClient(memProfile.debugPort);
      if (afterInviteProbe && afterInviteProbe.pendingGuildInvite) {
        await evalProfilePort(memProfile.debugPort, sendGuildActionJs({ action: 'accept' }), 3000);
        setActionNote(memId, 'รับคำเชิญเข้ากิลด์แล้ว');
        await new Promise(r => setTimeout(r, 500));
        const joinedProbe = await probeClient(memProfile.debugPort);
        if (joinedProbe && joinedProbe.inGameGuild) {
          probes.set(memId, joinedProbe);
          await tryAutoDonateForProfile(g, memId, memProfile, joinedProbe);
        }
      }
    }
  }

  async function syncAllGuilds() {
    if (syncInFlight) return { skipped: 'in-flight' };
    if (typeof isBusy === 'function' && isBusy()) return { skipped: 'busy' };
    if (state.guilds.length === 0) return { ok: true, count: 0 };

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
        donatedToday: !!(ig && ig.donatedToday),
        myPoints: ig ? ig.myPoints : 0,
        canDonateCount: Array.isArray(ls.donatableTiers) ? ls.donatableTiers.length : 0,
        donatableTiers: ls.donatableTiers || [],
        lastAction: ls.lastAction || null,
        lastActionAt: ls.lastActionAt || null
      };
    };

    const guilds = state.guilds.map(g => {
      const leader = decorateProfile(g.leaderId);
      const leaderIg = (liveStatus[g.leaderId] && liveStatus[g.leaderId].inGameGuild) || null;
      const members = g.memberIds.map(decorateProfile);
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

    return {
      autoDonate: state.autoDonate !== false,
      guilds,
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

    // POST /api/guilds/settings — toggle global autoDonate
    if (req.method === 'POST' && pathname === '/api/guilds/settings') {
      try {
        const body = await readBody(req);
        if (typeof body.autoDonate === 'boolean') {
          state.autoDonate = body.autoDonate;
          saveState();
        }
        return sendJSON({ success: true, ...buildPublicView() }), true;
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
      let donatedNow = 0;
      for (const pid of allIds) {
        const p = byId.get(pid);
        const pr = probes.get(pid);
        if (p && pr && pr.inWorld) {
          const ok = await tryAutoDonateForProfile(g, pid, p, pr);
          if (ok) donatedNow++;
        }
      }
      await probeAllConfigured().catch(() => {});
      return sendJSON({ success: true, donatedNow, ...buildPublicView() }), true;
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
