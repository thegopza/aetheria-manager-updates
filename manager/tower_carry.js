'use strict';
// manager/tower_carry.js — Endless Tower (หอคอยนิรันดร์ 100 ชั้น) Automated Carry & Smart Priest Boss-Avoidance Service

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  damageProfileId: '',
  priestProfileId: '',
  damageSkills: [],
  priestSkills: [
    'resurrection',
    'heal',
    'blessing',
    'increase-agi',
    'gloria',
    'impositio-manus',
    'aspersio',
    'kyrie-eleison',
    'purifying-light'
  ],
  priestOutBuffSkills: [
    'blessing',
    'increase-agi',
    'impositio-manus',
    'aspersio',
    'kyrie-eleison'
  ],
  priestProfileMode: 'safe_anchor_12',
  targetFloor: 60,
  kidMode: 'auto_until_boss', // 'auto_until_boss' | 'stand_still'
  carryUseQuota: false,
  resumeFarmAfterFinish: true,
  selectedKidProfileIds: []
};

// Self-contained installer for clients that haven't refreshed to bot.js v4.47.0 yet
const ENSURE_TOWER_CONTROL_JS = `(() => {
  if (typeof window.isInEndlessTowerMap !== 'function') {
    window.isInEndlessTowerMap = function() {
      try {
        const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : ((typeof window.getColyseusRoom === 'function') ? window.getColyseusRoom() : window.__gameRoom);
        if (room && room.state) {
          if (room.state.mapId === 'endless_tower') return true;
          if (String(room.state.displayName || '').includes('หอคอยนิรันดร์')) return true;
        }
        const mm = document.querySelector('.minimap-name');
        if (mm && String(mm.textContent || '').includes('หอคอยนิรันดร์')) return true;
      } catch (e) {}
      return false;
    };
  }
  if (typeof window.sendRespawn === 'function' && !window.sendRespawn.__pmTowerGuarded) {
    const origRespawn = window.sendRespawn;
    const guarded = function(forceAllowInTower) {
      if (!forceAllowInTower && typeof window.isInEndlessTowerMap === 'function' && window.isInEndlessTowerMap()) {
        return;
      }
      return origRespawn.apply(this, arguments);
    };
    guarded.__pmTowerGuarded = true;
    window.sendRespawn = guarded;
  }
  if (window.__towerCarryControl) return { ok: true, alreadyLoaded: true };

  const TILE_PX = 32;
  const DEFAULT_HOME_X = 1392;
  const DEFAULT_HOME_Y = 1776;
  const PRIEST_ANCHOR_RADIUS_TILES = 12;
  const REVIVE_MAX_RANGE_PX = 300;
  const BUFF_MAX_RANGE_PX = 272;
  const BOSS_SAFE_DIST_PX = 260;

  const towerRuntime = {
    hookedRoom: null,
    currentFloor: 0,
    clearedFloor: 0,
    targetFloorCompleted: false,
    homeAnchor: { x: DEFAULT_HOME_X, y: DEFAULT_HOME_Y, floor: 0 },
    dangerZones: [],
    partyBuffsByName: {},
    partyDeadByName: {},
    latestDungeonInfo: null,
    latestDungeonInfoAt: 0,
    priestState: 'IDLE_ANCHOR',
    priestActionText: 'รอประจำจุดเริ่ม (12 ช่อง)',
    lastAutoSetAt: 0,
    lastAutoEnabledState: null,
    lastMoveSentAt: 0,
    lastCastSentAt: 0,
    lastBuffCastBySkill: {},
    lastTowerChoiceSentAt: 0,
    autoPausedByPriestAi: false
  };
  window.__pmTowerRuntime = towerRuntime;

  function getActiveRoom() {
    return (typeof window.getGameRoom === 'function' ? window.getGameRoom() : null)
      || (typeof window.getColyseusRoom === 'function' ? window.getColyseusRoom() : null)
      || window.__gameRoom
      || null;
  }
  function parseFloorNumber(text) {
    const m = String(text || '').match(/ชั้น\\s*(\\d+)/);
    return m ? (parseInt(m[1], 10) || 0) : 0;
  }
  function ensureRoomHooks(room) {
    if (!room || typeof room.onMessage !== 'function') return;
    if (towerRuntime.hookedRoom === room || room.__pmTowerCarryHooked) return;
    room.__pmTowerCarryHooked = true;
    towerRuntime.hookedRoom = room;
    towerRuntime.dangerZones = [];
    const floorNum = parseFloorNumber(room.state && room.state.displayName);
    if (floorNum > 0) towerRuntime.currentFloor = floorNum;

    room.onMessage('dungeon_info', info => {
      towerRuntime.latestDungeonInfo = info;
      towerRuntime.latestDungeonInfoAt = Date.now();
      window.__pmLatestDungeonInfo = info;
    });
    room.onMessage('boss_cast', pkt => {
      if (!pkt || !Array.isArray(pkt.areas)) return;
      const now = Date.now();
      const castMs = Math.max(600, Math.min(6000, Number(pkt.castMs) || 1500));
      for (const a of pkt.areas) {
        if (!a) continue;
        towerRuntime.dangerZones.push({
          monsterId: pkt.monsterId || '',
          skill: pkt.skill || pkt.name || 'aoe',
          x: Number(a.x) || 0,
          y: Number(a.y) || 0,
          toX: a.toX !== undefined ? Number(a.toX) : undefined,
          toY: a.toY !== undefined ? Number(a.toY) : undefined,
          radiusPx: a.radiusPx !== undefined ? Number(a.radiusPx) : undefined,
          innerPx: a.innerPx !== undefined ? Number(a.innerPx) : undefined,
          widthPx: a.widthPx !== undefined ? Number(a.widthPx) : undefined,
          expiresAt: now + castMs + 380
        });
      }
    });
    room.onMessage('boss_fx', pkt => {
      if (!pkt || !Array.isArray(pkt.areas)) return;
      const now = Date.now();
      const remainHits = Math.max(1, (Number(pkt.hits) || 1) - (Number(pkt.hit) || 1) + 1);
      const lingerMs = Math.min(2200, remainHits * 420);
      for (const a of pkt.areas) {
        if (!a) continue;
        towerRuntime.dangerZones.push({
          monsterId: pkt.monsterId || '',
          skill: pkt.skill || 'fx',
          x: Number(a.x) || 0,
          y: Number(a.y) || 0,
          toX: a.toX !== undefined ? Number(a.toX) : undefined,
          toY: a.toY !== undefined ? Number(a.toY) : undefined,
          radiusPx: a.radiusPx !== undefined ? Number(a.radiusPx) : undefined,
          innerPx: a.innerPx !== undefined ? Number(a.innerPx) : undefined,
          widthPx: a.widthPx !== undefined ? Number(a.widthPx) : undefined,
          expiresAt: now + lingerMs
        });
      }
    });
    room.onMessage('party_buffs', pkt => {
      if (!pkt || !pkt.name || !Array.isArray(pkt.buffs)) return;
      const key = String(pkt.name).trim().toLowerCase();
      towerRuntime.partyBuffsByName[key] = pkt.buffs.map(b => ({
        skillId: b.skillId,
        name: b.name,
        endsAt: Number(b.endsAt) || 0
      }));
    });
    room.onMessage('party_life', pkt => {
      if (!pkt || !pkt.name) return;
      const key = String(pkt.name).trim().toLowerCase();
      towerRuntime.partyDeadByName[key] = Boolean(pkt.dead);
    });
    room.onMessage('center_notice', pkt => {
      const txt = String((pkt && pkt.text) || '').trim();
      if (!txt) return;
      const passMatch = txt.match(/ผ่านชั้น\\s*(\\d+)\\s*แล้ว/);
      if (passMatch) {
        const passed = parseInt(passMatch[1], 10) || 0;
        if (passed > towerRuntime.clearedFloor) towerRuntime.clearedFloor = passed;
        const cfg = window.__towerCarryConfig;
        const targetF = (cfg && Number(cfg.targetFloor)) || 60;
        if (passed >= targetF) {
          towerRuntime.targetFloorCompleted = true;
          window.__towerTargetFloorCompleted = true;
        }
      }
      const enterMatch = txt.match(/^ชั้น\\s*(\\d+)$/);
      if (enterMatch) {
        const entered = parseInt(enterMatch[1], 10) || 0;
        if (entered > 0) {
          towerRuntime.currentFloor = entered;
          if (entered === 1) {
            towerRuntime.clearedFloor = 0;
            towerRuntime.targetFloorCompleted = false;
            window.__towerTargetFloorCompleted = false;
          }
        }
      }
    });
    room.onMessage('tower_choice', pkt => {
      const cfg = window.__towerCarryConfig;
      if (!cfg || !cfg.active) return;
      const runsLeft = Number(pkt && pkt.runsLeft) || 0;
      const wantReward = cfg.role === 'kid' ? (runsLeft > 0) : (cfg.useRewardQuota !== false && runsLeft > 0);
      setTimeout(() => {
        try {
          room.send('tower_choice', { reward: Boolean(wantReward) });
          towerRuntime.lastTowerChoiceSentAt = Date.now();
        } catch (e) {}
      }, 350);
    });
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 1e-6) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }
  function isPointInDangerZone(px, py, marginPx = 42) {
    const now = Date.now();
    towerRuntime.dangerZones = towerRuntime.dangerZones.filter(z => z && z.expiresAt > now);
    for (const z of towerRuntime.dangerZones) {
      if (typeof z.radiusPx === 'number' && z.radiusPx > 0) {
        const d = Math.hypot(px - z.x, py - z.y);
        if (typeof z.innerPx === 'number' && z.innerPx > 0) {
          if (d >= Math.max(0, z.innerPx - marginPx) && d <= z.radiusPx + marginPx) return true;
        } else if (d <= z.radiusPx + marginPx) return true;
      } else if (typeof z.toX === 'number' && typeof z.toY === 'number' && typeof z.widthPx === 'number') {
        if (distToSegment(px, py, z.x, z.y, z.toX, z.toY) <= (z.widthPx / 2) + marginPx) return true;
      }
    }
    return false;
  }
  function getLivingBosses(room) {
    const out = [];
    if (!room || !room.state || !room.state.monsters) return out;
    room.state.monsters.forEach((m, id) => {
      if (m && m.hp > 0 && (m.boss || m.level >= 70)) {
        out.push({ id, name: m.name, x: Number(m.x) || 0, y: Number(m.y) || 0, boss: Boolean(m.boss), hp: m.hp, maxHp: m.maxHp });
      }
    });
    return out;
  }
  function minBossDistance(px, py, bosses) {
    if (!bosses || !bosses.length) return 99999;
    let minD = 99999;
    for (const b of bosses) {
      const d = Math.hypot(px - b.x, py - b.y);
      if (d < minD) minD = d;
    }
    return minD;
  }
  function pickSafeCastPosition(me, targetPlayer, bosses, maxCastRangePx, preferredRangePx) {
    const tx = Number(targetPlayer.x) || 0, ty = Number(targetPlayer.y) || 0;
    const mx = Number(me.x) || 0, my = Number(me.y) || 0;
    const radii = [preferredRangePx, Math.max(180, preferredRangePx - 28), Math.min(maxCastRangePx - 10, preferredRangePx + 20)];
    let bestPoint = null, bestScore = -1e9;
    for (const r of radii) {
      for (let i = 0; i < 20; i++) {
        const ang = (i / 20) * Math.PI * 2;
        const cx = Math.max(96, Math.min(2680, tx + Math.cos(ang) * r));
        const cy = Math.max(96, Math.min(1980, ty + Math.sin(ang) * r));
        if (isPointInDangerZone(cx, cy, 46)) continue;
        const bDist = minBossDistance(cx, cy, bosses);
        const travelDist = Math.hypot(cx - mx, cy - my);
        const bossSafetyScore = bDist < BOSS_SAFE_DIST_PX ? (bDist - BOSS_SAFE_DIST_PX) * 12 : Math.min(420, bDist) * 2.2;
        const score = bossSafetyScore - travelDist * 0.65;
        if (score > bestScore) {
          bestScore = score;
          bestPoint = { x: Math.round(cx), y: Math.round(cy), bossDist: Math.round(bDist) };
        }
      }
    }
    if (bestPoint) return bestPoint;
    const primaryBoss = bosses[0];
    if (primaryBoss) {
      const vx = tx - primaryBoss.x, vy = ty - primaryBoss.y;
      const len = Math.hypot(vx, vy) || 1;
      return { x: Math.round(tx + (vx / len) * preferredRangePx), y: Math.round(ty + (vy / len) * preferredRangePx), bossDist: Math.round(preferredRangePx) };
    }
    return { x: Math.round(tx), y: Math.round(ty), bossDist: 9999 };
  }
  function computeSafeStepToward(me, destX, destY, bosses) {
    const mx = Number(me.x) || 0, my = Number(me.y) || 0;
    for (const b of bosses) {
      const segDist = distToSegment(b.x, b.y, mx, my, destX, destY);
      const curBossDist = Math.hypot(mx - b.x, my - b.y);
      if (segDist < BOSS_SAFE_DIST_PX && Math.hypot(destX - mx, destY - my) > 80) {
        const vx = destX - mx, vy = destY - my;
        const len = Math.hypot(vx, vy) || 1;
        const nx = -vy / len, ny = vx / len;
        const arcRadius = Math.max(BOSS_SAFE_DIST_PX + 28, curBossDist);
        const opt1 = { x: Math.round(b.x + nx * arcRadius), y: Math.round(b.y + ny * arcRadius) };
        const opt2 = { x: Math.round(b.x - nx * arcRadius), y: Math.round(b.y - ny * arcRadius) };
        const d1 = Math.hypot(opt1.x - mx, opt1.y - my) + (!isPointInDangerZone(opt1.x, opt1.y, 40) ? 0 : 1000);
        const d2 = Math.hypot(opt2.x - mx, opt2.y - my) + (!isPointInDangerZone(opt2.x, opt2.y, 40) ? 0 : 1000);
        return d1 <= d2 ? opt1 : opt2;
      }
    }
    return { x: Math.round(destX), y: Math.round(destY) };
  }
  function pickImmediateDodgePoint(me, bosses) {
    const mx = Number(me.x) || 0, my = Number(me.y) || 0;
    let best = null, bestScore = -1e9;
    for (const d of [115, 165, 225, 285]) {
      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * Math.PI * 2;
        const cx = Math.max(96, Math.min(2680, mx + Math.cos(ang) * d));
        const cy = Math.max(96, Math.min(1980, my + Math.sin(ang) * d));
        if (isPointInDangerZone(cx, cy, 48)) continue;
        const bDist = minBossDistance(cx, cy, bosses);
        const homeDist = Math.hypot(cx - towerRuntime.homeAnchor.x, cy - towerRuntime.homeAnchor.y);
        const score = Math.min(400, bDist) * 2 - d * 0.8 - homeDist * 0.25;
        if (score > bestScore) { bestScore = score; best = { x: Math.round(cx), y: Math.round(cy) }; }
      }
      if (best) return best;
    }
    return { x: towerRuntime.homeAnchor.x, y: towerRuntime.homeAnchor.y };
  }
  function findPlayerByName(room, charName) {
    if (!room || !room.state || !room.state.players || !charName) return null;
    const want = String(charName).trim().toLowerCase();
    let found = null;
    room.state.players.forEach((p, sid) => {
      if (!found && p && String(p.name || '').trim().toLowerCase() === want) found = { sid, player: p };
    });
    return found;
  }
  function setGameAutoState(room, enabled, configPatch) {
    if (!room || typeof room.send !== 'function') return;
    const live = typeof window.getLiveCharacterData === 'function' ? window.getLiveCharacterData() : window.__latestCharacterData;
    const curCfg = (live && live.auto && live.auto.config) || {};
    const payload = {};
    if (typeof enabled === 'boolean') payload.enabled = enabled;
    if (configPatch && typeof configPatch === 'object') payload.config = Object.assign({}, curCfg, configPatch);
    room.send('auto_set', payload);
    towerRuntime.lastAutoSetAt = Date.now();
  }
  function getMissingDamageBuffs(damageName, desiredBuffSkills, learnedMap) {
    if (!damageName || !Array.isArray(desiredBuffSkills) || !desiredBuffSkills.length) return [];
    const activeBuffs = towerRuntime.partyBuffsByName[String(damageName).trim().toLowerCase()];
    if (!Array.isArray(activeBuffs)) return [];
    const now = Date.now();
    const activeMap = new Map();
    for (const b of activeBuffs) if (b && b.skillId) activeMap.set(b.skillId, Math.max(0, (Number(b.endsAt) || 0) - now));
    const missing = [];
    for (const skId of desiredBuffSkills) {
      if (learnedMap && !(Number(learnedMap[skId]) > 0)) continue;
      if (now - (towerRuntime.lastBuffCastBySkill[skId] || 0) < 4500) continue;
      if ((activeMap.get(skId) || 0) <= 2500) missing.push(skId);
    }
    return missing;
  }

  setInterval(() => {
    try {
      const room = getActiveRoom();
      if (!room || !room.state) return;
      ensureRoomHooks(room);
      const inTower = typeof window.isInEndlessTowerMap === 'function' && window.isInEndlessTowerMap();
      const cfg = window.__towerCarryConfig;
      if (!inTower || !cfg || !cfg.active) { towerRuntime.priestState = 'IDLE_ANCHOR'; return; }

      const floorNum = parseFloorNumber(room.state.displayName) || towerRuntime.currentFloor || 1;
      towerRuntime.currentFloor = floorNum;
      const targetFloor = Math.max(10, Number(cfg.targetFloor) || 60);
      const now = Date.now();
      const me = room.state.players && room.state.players.get ? room.state.players.get(room.sessionId) : null;
      if (!me) return;

      if (towerRuntime.homeAnchor.floor !== floorNum && !me.dead) {
        towerRuntime.homeAnchor = { x: Math.round(Number(me.x) || DEFAULT_HOME_X), y: Math.round(Number(me.y) || DEFAULT_HOME_Y), floor: floorNum };
        towerRuntime.autoPausedByPriestAi = false;
      }

      if (now - towerRuntime.lastTowerChoiceSentAt > 2500) {
        const modalBtns = Array.from(document.querySelectorAll('button'));
        const rewardBtn = modalBtns.find(b => /รับรางวัล\\s*\\(ใช้\\s*1/.test(b.textContent || ''));
        const helpBtn = modalBtns.find(b => (b.textContent || '').trim() === 'ช่วยเพื่อน');
        if (rewardBtn || helpBtn) {
          const wantReward = cfg.role === 'kid' ? true : (cfg.useRewardQuota !== false);
          room.send('tower_choice', { reward: Boolean(wantReward) });
          towerRuntime.lastTowerChoiceSentAt = now;
        }
      }

      if (towerRuntime.clearedFloor >= targetFloor || floorNum > targetFloor) {
        towerRuntime.targetFloorCompleted = true;
        window.__towerTargetFloorCompleted = true;
        if (now - towerRuntime.lastAutoSetAt > 1500) {
          setGameAutoState(room, false, { autoRevive: false, flyWing: false });
          room.send('target', { targetId: null });
        }
        return;
      }

      if (cfg.role === 'kid') {
        if (me.dead) return;
        const shouldStopForBoss = cfg.kidMode === 'stand_still' || floorNum >= targetFloor || towerRuntime.clearedFloor >= (targetFloor - 1);
        const live = typeof window.getLiveCharacterData === 'function' ? window.getLiveCharacterData() : null;
        const curAutoOn = Boolean(live && live.auto && live.auto.enabled);
        if (shouldStopForBoss) {
          if (curAutoOn && now - towerRuntime.lastAutoSetAt > 1200) {
            setGameAutoState(room, false, { autoRevive: false, flyWing: false });
            room.send('target', { targetId: null });
          }
        } else if (!curAutoOn && now - towerRuntime.lastAutoSetAt > 2000) {
          setGameAutoState(room, true, { autoRevive: false, flyWing: false, huntRadiusTiles: 'all' });
        }
        return;
      }

      if (cfg.role === 'damage') {
        if (me.dead) return;
        const live = typeof window.getLiveCharacterData === 'function' ? window.getLiveCharacterData() : null;
        const curAutoOn = Boolean(live && live.auto && live.auto.enabled);
        if (!curAutoOn && now - towerRuntime.lastAutoSetAt > 1800) {
          const patch = { huntRadiusTiles: 'all', basicAttack: true, flyWing: false, autoRevive: false };
          if (Array.isArray(cfg.damageSkills) && cfg.damageSkills.length > 0) patch.skills = cfg.damageSkills;
          setGameAutoState(room, true, patch);
        }
        return;
      }

      if (cfg.role === 'priest') {
        if (me.dead) return;
        const live = typeof window.getLiveCharacterData === 'function' ? window.getLiveCharacterData() : null;
        const learned = Object.assign({}, (live && live.skills) || {}, (live && live.grantedSkills) || {});
        const curAutoOn = Boolean(live && live.auto && live.auto.enabled);
        const bosses = getLivingBosses(room);
        const homeX = towerRuntime.homeAnchor.x, homeY = towerRuntime.homeAnchor.y;
        const distFromHome = Math.hypot((me.x || 0) - homeX, (me.y || 0) - homeY);

        if (isPointInDangerZone(me.x, me.y, 42)) {
          towerRuntime.priestState = 'DODGE_AOE';
          towerRuntime.priestActionText = '⚡ หลบวงสกิล AoE ของบอส!';
          if (curAutoOn && now - towerRuntime.lastAutoSetAt > 400) {
            towerRuntime.autoPausedByPriestAi = true;
            setGameAutoState(room, false);
            room.send('target', { targetId: null });
          }
          if (now - towerRuntime.lastMoveSentAt > 240) {
            const dodgePt = pickImmediateDodgePoint(me, bosses);
            room.send('move_to', { x: dodgePt.x, y: dodgePt.y, auto: false });
            towerRuntime.lastMoveSentAt = now;
          }
          return;
        }

        const dmgEntry = findPlayerByName(room, cfg.damageCharName);
        const dmgPlayer = dmgEntry ? dmgEntry.player : null;
        const dmgSid = dmgEntry ? dmgEntry.sid : null;
        const dmgDead = Boolean(dmgPlayer && (dmgPlayer.dead || (typeof dmgPlayer.hp === 'number' && dmgPlayer.hp <= 0)));
        const distToDmg = dmgPlayer ? Math.hypot((me.x || 0) - (dmgPlayer.x || 0), (me.y || 0) - (dmgPlayer.y || 0)) : 99999;

        if (dmgPlayer && dmgDead && Number(learned['resurrection']) > 0) {
          towerRuntime.priestState = 'RESCUE_REVIVE';
          if (curAutoOn && now - towerRuntime.lastAutoSetAt > 400) {
            towerRuntime.autoPausedByPriestAi = true;
            setGameAutoState(room, false, { basicAttack: false });
            room.send('target', { targetId: null });
          }
          if (distToDmg <= REVIVE_MAX_RANGE_PX) {
            towerRuntime.priestActionText = '✨ ร่ายชุบชีวิตให้ ' + cfg.damageCharName;
            if (now - towerRuntime.lastCastSentAt > 950) {
              room.send('ally_focus', { targetId: dmgSid });
              room.send('cast', { skillId: 'resurrection', targetId: dmgSid });
              towerRuntime.lastCastSentAt = now;
            }
          } else {
            const safeCastPt = pickSafeCastPosition(me, dmgPlayer, bosses, REVIVE_MAX_RANGE_PX, 265);
            const stepPt = computeSafeStepToward(me, safeCastPt.x, safeCastPt.y, bosses);
            towerRuntime.priestActionText = '🏃 เดินอ้อมหลบบอสไปชุบ ' + cfg.damageCharName;
            if (now - towerRuntime.lastMoveSentAt > 320) {
              room.send('move_to', { x: stepPt.x, y: stepPt.y, auto: false });
              towerRuntime.lastMoveSentAt = now;
            }
          }
          return;
        }

        const outBuffList = Array.isArray(cfg.priestOutBuffSkills) && cfg.priestOutBuffSkills.length > 0
          ? cfg.priestOutBuffSkills
          : ['blessing', 'increase-agi', 'impositio-manus', 'aspersio', 'kyrie-eleison'];
        const missingBuffs = (dmgPlayer && !dmgDead) ? getMissingDamageBuffs(cfg.damageCharName, outBuffList, learned) : [];
        const priestHpPct = (me.maxHp > 0 && typeof me.hp === 'number') ? (me.hp / me.maxHp) : 1;

        if (dmgPlayer && !dmgDead && missingBuffs.length > 0 && distToDmg > 250 && priestHpPct >= 0.55) {
          towerRuntime.priestState = 'DELIVER_BUFF';
          if (curAutoOn && now - towerRuntime.lastAutoSetAt > 400) {
            towerRuntime.autoPausedByPriestAi = true;
            setGameAutoState(room, false, { basicAttack: false });
            room.send('target', { targetId: null });
          }
          if (distToDmg <= BUFF_MAX_RANGE_PX) {
            const nextBuff = missingBuffs[0];
            towerRuntime.priestActionText = '🙏 เติมบัพ ' + nextBuff + ' ให้ ' + cfg.damageCharName;
            if (now - towerRuntime.lastCastSentAt > 550) {
              room.send('ally_focus', { targetId: dmgSid });
              room.send('cast', { skillId: nextBuff, targetId: dmgSid });
              towerRuntime.lastCastSentAt = now;
              towerRuntime.lastBuffCastBySkill[nextBuff] = now;
            }
          } else {
            const safeCastPt = pickSafeCastPosition(me, dmgPlayer, bosses, BUFF_MAX_RANGE_PX, 246);
            const stepPt = computeSafeStepToward(me, safeCastPt.x, safeCastPt.y, bosses);
            towerRuntime.priestActionText = '🏃 เดินหลบบอสไปเติมบัพ ' + cfg.damageCharName;
            if (now - towerRuntime.lastMoveSentAt > 320) {
              room.send('move_to', { x: stepPt.x, y: stepPt.y, auto: false });
              towerRuntime.lastMoveSentAt = now;
            }
          }
          return;
        }

        if (towerRuntime.autoPausedByPriestAi || distFromHome > (PRIEST_ANCHOR_RADIUS_TILES * TILE_PX * 0.65)) {
          if (distFromHome > 72) {
            towerRuntime.priestState = 'RETREAT_HOME';
            towerRuntime.priestActionText = '🛡️ ถอยกลับจุดเริ่มต้น (' + Math.round(distFromHome / TILE_PX) + ' ช่อง)';
            if (curAutoOn && now - towerRuntime.lastAutoSetAt > 400) setGameAutoState(room, false, { basicAttack: false });
            if (now - towerRuntime.lastMoveSentAt > 320) {
              const stepHome = computeSafeStepToward(me, homeX, homeY, bosses);
              room.send('move_to', { x: stepHome.x, y: stepHome.y, auto: false });
              towerRuntime.lastMoveSentAt = now;
            }
            return;
          }
          towerRuntime.autoPausedByPriestAi = false;
        }

        towerRuntime.priestState = 'IDLE_ANCHOR';
        towerRuntime.priestActionText = '🛡️ ประจำจุดเริ่ม (ระยะล่า 12 ช่อง · พร้อมชุบ/บัพ)';
        const curRadius = live && live.auto && live.auto.config ? live.auto.config.huntRadiusTiles : null;
        if ((!curAutoOn || curRadius !== PRIEST_ANCHOR_RADIUS_TILES) && now - towerRuntime.lastAutoSetAt > 1800) {
          const desiredSkills = Array.isArray(cfg.priestSkills) && cfg.priestSkills.length > 0
            ? cfg.priestSkills.slice()
            : ['resurrection', 'heal', 'blessing', 'increase-agi', 'gloria', 'kyrie-eleison', 'impositio-manus', 'aspersio', 'purifying-light'].filter(id => Number(learned[id]) > 0);
          if (Number(learned['resurrection']) > 0 && !desiredSkills.includes('resurrection')) desiredSkills.unshift('resurrection');
          setGameAutoState(room, true, {
            huntRadiusTiles: PRIEST_ANCHOR_RADIUS_TILES,
            basicAttack: false,
            buffParty: true,
            flyWing: false,
            autoRevive: false,
            skills: desiredSkills
          });
        }
      }
    } catch (e) {}
  }, 120);

  window.__towerCarryControl = {
    getAvailableSkills() {
      const live = typeof window.getLiveCharacterData === 'function' ? window.getLiveCharacterData(true) : window.__latestCharacterData;
      const cat = window.__skillCatalog;
      const learnedMap = Object.assign({}, (live && live.skills) || {}, (live && live.grantedSkills) || {});
      const curAutoSkills = (live && live.auto && live.auto.config && Array.isArray(live.auto.config.skills)) ? live.auto.config.skills : [];
      const catalogSkills = (cat && Array.isArray(cat.skills)) ? cat.skills : [];
      const catalogById = new Map(catalogSkills.map(s => [s.id, s]));
      const list = [];
      for (const [skId, lv] of Object.entries(learnedMap)) {
        const numLv = Number(lv) || 0;
        if (numLv <= 0 || skId === 'basic-skill' || skId === 'first-aid' || skId === 'chat-room') continue;
        const meta = catalogById.get(skId);
        if (meta && meta.kind === 'passive') continue;
        list.push({
          id: skId,
          level: numLv,
          name: (meta && meta.name) || skId,
          thai: (meta && meta.thai) || (meta && meta.name) || skId,
          classId: (meta && meta.classId) || (live && live.classId) || '',
          autoUse: (meta && typeof meta.autoUse === 'string') ? meta.autoUse : 'enemy',
          target: (meta && typeof meta.target === 'string') ? meta.target : 'enemy',
          rangeTiles: (meta && typeof meta.rangeTiles === 'number') ? meta.rangeTiles : 0,
          selectedInGameAuto: curAutoSkills.includes(skId)
        });
      }
      return {
        ok: true,
        charName: (live && (live.name || live.charName)) || (typeof window.getCharacterName === 'function' ? window.getCharacterName() : null),
        classId: (live && live.classId) || null,
        baseLevel: (live && live.baseLevel) || 0,
        autoSkills: curAutoSkills,
        skills: list
      };
    },
    async queryDungeonInfo() {
      const room = getActiveRoom();
      if (!room || !room.state) return { ok: false, error: 'not-in-game' };
      ensureRoomHooks(room);
      const t0 = Date.now();
      try { room.send('dungeon_info'); } catch (e) {}
      for (let i = 0; i < 18 && !(towerRuntime.latestDungeonInfoAt >= t0); i++) {
        await new Promise(r => setTimeout(r, 120));
      }
      const info = towerRuntime.latestDungeonInfo || window.__pmLatestDungeonInfo || null;
      const tw = info && info.tower ? info.tower : null;
      const me = room.state.players && room.state.players.get ? room.state.players.get(room.sessionId) : null;
      const party = typeof window.getInGamePartyState === 'function' ? window.getInGamePartyState() : null;
      return {
        ok: true,
        charName: (me && me.name) || (typeof window.getCharacterName === 'function' ? window.getCharacterName() : null),
        classId: (me && me.classId) || null,
        baseLevel: (me && me.level) || 0,
        hp: me ? me.hp : 0,
        maxHp: me ? me.maxHp : 0,
        dead: Boolean(me && me.dead),
        x: me ? Math.round(me.x) : 0,
        y: me ? Math.round(me.y) : 0,
        mapId: room.state.mapId || null,
        displayName: room.state.displayName || null,
        channel: room.state.channel || null,
        inTower: typeof window.isInEndlessTowerMap === 'function' && window.isInEndlessTowerMap(),
        currentFloor: parseFloorNumber(room.state.displayName) || towerRuntime.currentFloor || 0,
        clearedFloor: towerRuntime.clearedFloor || 0,
        targetFloorCompleted: Boolean(towerRuntime.targetFloorCompleted),
        priestState: towerRuntime.priestState,
        priestActionText: towerRuntime.priestActionText,
        party: party ? {
          leader: party.leader || null,
          members: Array.isArray(party.members) ? party.members.map(m => ({ name: m.name, online: m.online, classId: m.classId, mapId: m.mapId, channel: m.channel })) : []
        } : null,
        tower: tw ? {
          runsPerWeek: Number(tw.runsPerWeek) || 3,
          runsUsed: Number(tw.runsUsed) || 0,
          runsLeft: Math.max(0, (Number(tw.runsPerWeek) || 3) - (Number(tw.runsUsed) || 0)),
          checkpoint: Number(tw.checkpoint) || 1,
          claimed: Number(tw.claimed) || 0,
          charged: Boolean(tw.charged),
          inTower: Boolean(tw.inTower),
          gatherTiles: Number(tw.gatherTiles) || 15,
          minLevel: Number(tw.minLevel) || 99,
          floors: Number(tw.floors) || 80
        } : null
      };
    },
    configureRole(cfg) {
      cfg = cfg || {};
      window.__towerCarryConfig = cfg;
      window.__towerCarryActive = Boolean(cfg.active);
      if (!cfg.active) {
        towerRuntime.targetFloorCompleted = false;
        window.__towerTargetFloorCompleted = false;
        towerRuntime.priestState = 'IDLE_ANCHOR';
        towerRuntime.autoPausedByPriestAi = false;
      } else {
        window.__isNavigating = false;
        window.__isShopping = false;
      }
      return { ok: true, active: window.__towerCarryActive, role: cfg.role || null };
    },
    async recallToCapital(gatherX = 1480, gatherY = 1480, targetChannel = null) {
      const room = getActiveRoom();
      if (!room || !room.state) return { ok: false, error: 'not-in-game' };
      ensureRoomHooks(room);
      window.__towerCarryActive = true;
      if (window.__isBotRunning && typeof window.stopMasterBot === 'function') {
        window.stopMasterBot('เรียกตัวกลับเมืองหลวงเพื่อลงหอคอยนิรันดร์');
      }
      setGameAutoState(room, false, { autoRevive: false, flyWing: false });
      room.send('target', { targetId: null });
      const me = room.state.players && room.state.players.get ? room.state.players.get(room.sessionId) : null;
      if (me && me.dead) {
        room.send('respawn', { to: 'capital' });
        return { ok: true, action: 'respawn-capital' };
      }
      const mapName = String(room.state.displayName || '');
      const inTower = typeof window.isInEndlessTowerMap === 'function' && window.isInEndlessTowerMap();
      const inCapital = /เมืองหลวง|โซลเฮเวน/i.test(mapName) && !inTower;
      if (!inCapital) {
        if (inTower && room.state.npcs) {
          let keeperKey = null, kx = 1478, ky = 1734;
          room.state.npcs.forEach((n, k) => { if (n && n.name === 'Tower Keeper') { keeperKey = k; kx = n.x; ky = n.y; } });
          if (keeperKey && me) {
            const d = Math.hypot((me.x || 0) - kx, (me.y || 0) - ky);
            if (d > 110) room.send('move_to', { x: Math.round(kx - 32), y: Math.round(ky + 16), auto: false });
            else {
              room.send('npc_talk', { npcKey: keeperKey });
              setTimeout(() => { try { room.send('npc_option', { index: 0 }); } catch (e) {} }, 450);
            }
          }
        }
        if (typeof window.useButterflyWing === 'function') window.useButterflyWing();
        return { ok: true, action: 'returning-to-capital', inCapital: false };
      }
      if (targetChannel && Number(room.state.channel) !== Number(targetChannel)) {
        room.send('channel_switch', { channel: Number(targetChannel) });
        return { ok: true, action: 'switching-channel', inCapital: true, channel: room.state.channel };
      }
      const dist = me ? Math.hypot((me.x || 0) - gatherX, (me.y || 0) - gatherY) : 999;
      if (dist > 96) {
        room.send('move_to', { x: Math.round(gatherX), y: Math.round(gatherY), auto: false });
        return { ok: true, action: 'walking-to-gather', inCapital: true, dist: Math.round(dist) };
      }
      return { ok: true, action: 'ready-at-gather', inCapital: true, dist: Math.round(dist), x: Math.round(me.x), y: Math.round(me.y), channel: room.state.channel };
    },
    async resetAndEnterTower(isLeader) {
      const room = getActiveRoom();
      if (!room) return { ok: false, error: 'not-in-game' };
      ensureRoomHooks(room);
      towerRuntime.clearedFloor = 0;
      towerRuntime.targetFloorCompleted = false;
      window.__towerTargetFloorCompleted = false;
      room.send('tower_reset');
      await new Promise(r => setTimeout(r, 450));
      if (isLeader) room.send('tower_enter');
      return { ok: true, resetSent: true, enterSent: Boolean(isLeader) };
    }
  };
  return { ok: true, installed: true };
})()`;

function sanitizeSettings(s) {
  s = s || {};
  const tf = Math.floor(Number(s.targetFloor) || DEFAULTS.targetFloor);
  const uniq = arr => [...new Set(arr.map(x => String(x || '').trim()).filter(Boolean))];
  return {
    damageProfileId: typeof s.damageProfileId === 'string' ? s.damageProfileId.trim() : DEFAULTS.damageProfileId,
    priestProfileId: typeof s.priestProfileId === 'string' ? s.priestProfileId.trim() : DEFAULTS.priestProfileId,
    damageSkills: Array.isArray(s.damageSkills) ? uniq(s.damageSkills) : DEFAULTS.damageSkills.slice(),
    priestSkills: Array.isArray(s.priestSkills) ? uniq(s.priestSkills) : DEFAULTS.priestSkills.slice(),
    priestOutBuffSkills: Array.isArray(s.priestOutBuffSkills) ? uniq(s.priestOutBuffSkills) : DEFAULTS.priestOutBuffSkills.slice(),
    priestProfileMode: typeof s.priestProfileMode === 'string' && s.priestProfileMode ? s.priestProfileMode : DEFAULTS.priestProfileMode,
    targetFloor: Math.max(10, Math.min(100, Math.round(tf / 10) * 10)),
    kidMode: s.kidMode === 'stand_still' ? 'stand_still' : 'auto_until_boss',
    carryUseQuota: Boolean(s.carryUseQuota),
    resumeFarmAfterFinish: s.resumeFarmAfterFinish !== undefined ? Boolean(s.resumeFarmAfterFinish) : DEFAULTS.resumeFarmAfterFinish,
    selectedKidProfileIds: Array.isArray(s.selectedKidProfileIds) ? uniq(s.selectedKidProfileIds) : []
  };
}

function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    if (req.setEncoding) req.setEncoding('utf8');
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch (e) { resolve({}); }
    });
  });
}

function createTowerCarryService(opts) {
  const { loadProfiles, evalProfilePort } = opts;
  const dataFile = opts.dataFile || path.join(__dirname, 'data', 'tower_carry.json');
  const now = opts.now || (() => Date.now());
  const log = opts.log || ((...a) => console.log('[TowerCarry]', ...a));

  let settings = Object.assign({}, DEFAULTS);
  let roleSkillsCache = {};
  try {
    const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    settings = sanitizeSettings(raw.settings);
    roleSkillsCache = (raw.roleSkillsCache && typeof raw.roleSkillsCache === 'object') ? raw.roleSkillsCache : {};
  } catch (e) {}

  const snapshots = new Map(); // profileId -> latest queryDungeonInfo result
  const state = {
    running: false,
    phase: 'IDLE', // 'IDLE' | 'PICK_BATCH' | 'RECALL_AND_GATHER' | 'PARTY_INVITE' | 'RESET_AND_ENTER' | 'CLIMBING' | 'EXITING_TOWER' | 'COMPLETED'
    statusText: 'พร้อมเริ่มระบบแบกหอคอย 100 ชั้น',
    batchNumber: 0,
    roundInBatch: 0,
    currentFloor: 0,
    clearedFloor: 0,
    currentBatchKidIds: [],
    completedKidIds: [],
    gatherCoords: { x: 1480, y: 1480, channel: null },
    phaseEnteredAt: 0,
    lastEnterSentAt: 0,
    logs: []
  };

  let ticking = false;
  let timer = null;

  function save() {
    try {
      fs.mkdirSync(path.dirname(dataFile), { recursive: true });
      const tmp = dataFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ settings, roleSkillsCache }, null, 2));
      fs.renameSync(tmp, dataFile);
    } catch (e) {
      log('save failed', e.message);
    }
  }

  function pushLog(text, kind = 'info') {
    state.logs.unshift({ at: now(), text, kind });
    state.logs = state.logs.slice(0, 40);
    log(text);
  }

  function setPhase(nextPhase, text) {
    if (state.phase !== nextPhase) {
      state.phase = nextPhase;
      state.phaseEnteredAt = now();
    }
    if (text) state.statusText = text;
  }

  async function evalControl(profile, methodExpr, timeoutMs = 8000) {
    if (!profile || !profile.debugPort) return { ok: false, error: 'offline' };
    const code = `(async () => {
      ${ENSURE_TOWER_CONTROL_JS};
      return await (${methodExpr});
    })()`;
    const r = await evalProfilePort(profile.debugPort, code, timeoutMs);
    if (!r || r.success === false || !r.result) {
      return { ok: false, error: (r && r.error) || 'eval-failed' };
    }
    return r.result;
  }

  async function fetchRoleSkills(profileId) {
    const profiles = loadProfiles();
    const p = profiles.find(x => String(x.id) === String(profileId));
    if (!p || !p.debugPort) {
      return { ok: false, error: 'จอที่เลือกยังไม่ได้ออนไลน์ในเกม' };
    }
    const res = await evalControl(p, 'window.__towerCarryControl.getAvailableSkills()', 7000);
    if (res && res.ok) {
      roleSkillsCache[profileId] = {
        at: now(),
        charName: res.charName || p.lastCharName || p.name,
        classId: res.classId || p.lastCharClass || '',
        baseLevel: res.baseLevel || p.lastBaseLv || 0,
        autoSkills: Array.isArray(res.autoSkills) ? res.autoSkills : [],
        skills: Array.isArray(res.skills) ? res.skills : []
      };
      save();
    }
    return res;
  }

  async function refreshProfileSnapshot(p) {
    if (!p || !p.debugPort) return null;
    const res = await evalControl(p, 'window.__towerCarryControl.queryDungeonInfo()', 8000);
    if (res && res.ok) {
      snapshots.set(String(p.id), Object.assign({ at: now() }, res));
      return res;
    }
    return null;
  }

  async function scanAllQuotas() {
    const profiles = loadProfiles().filter(p => p && p.debugPort);
    await Promise.all(profiles.map(p => refreshProfileSnapshot(p).catch(() => null)));
    return { ok: true, scanned: profiles.length };
  }

  async function pushRoleConfigToClient(p, role, active, damageCharName, priestCharName) {
    if (!p || !p.debugPort) return;
    const cfg = {
      active: Boolean(active),
      role,
      damageCharName: damageCharName || '',
      priestCharName: priestCharName || '',
      targetFloor: settings.targetFloor,
      damageSkills: settings.damageSkills,
      priestSkills: settings.priestSkills,
      priestOutBuffSkills: settings.priestOutBuffSkills,
      priestProfileMode: settings.priestProfileMode,
      kidMode: settings.kidMode,
      useRewardQuota: role === 'kid' ? true : Boolean(settings.carryUseQuota)
    };
    await evalControl(p, `window.__towerCarryControl.configureRole(${JSON.stringify(cfg)})`, 6000).catch(() => null);
  }

  async function inviteAndAcceptParty(leaderProfile, memberProfiles, kickNames = []) {
    if (!leaderProfile || !leaderProfile.debugPort) return;
    const inviteNames = memberProfiles.map(m => {
      const snap = snapshots.get(String(m.id));
      return (snap && snap.charName) || m.lastCharName || '';
    }).filter(Boolean);

    await evalProfilePort(leaderProfile.debugPort, `(async () => {
      const room = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
      if (!room) return { ok: false };
      const party = typeof window.getInGamePartyState === 'function' ? window.getInGamePartyState() : null;
      const curMembers = new Set((party && Array.isArray(party.members) ? party.members : []).map(m => m.name));
      for (const kn of ${JSON.stringify(kickNames)}) {
        if (kn && curMembers.has(kn)) {
          room.send('party', { action: 'kick', name: kn });
          await new Promise(r => setTimeout(r, 250));
        }
      }
      for (const nm of ${JSON.stringify(inviteNames)}) {
        if (nm && !curMembers.has(nm)) {
          room.send('party', { action: 'invite', name: nm });
          await new Promise(r => setTimeout(r, 320));
        }
      }
      return { ok: true };
    })()`, 8000).catch(() => null);

    await new Promise(r => setTimeout(r, 550));

    await Promise.all(memberProfiles.map(mp => {
      if (!mp || !mp.debugPort) return Promise.resolve();
      return evalProfilePort(mp.debugPort, `(async () => {
        const room = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
        if (!room) return { ok: false };
        room.send('party', { action: 'accept' });
        const btns = Array.from(document.querySelectorAll('button'));
        const accBtn = btns.find(b => /^(รับ|ตอบรับ|เข้าร่วม|ตกลง|Accept)$/i.test((b.textContent || '').trim()));
        if (accBtn) accBtn.click();
        return { ok: true };
      })()`, 5000).catch(() => null);
    }));
  }

  async function stepPipeline() {
    if (!state.running) return;
    const profiles = loadProfiles();
    const dmgProfile = profiles.find(p => String(p.id) === String(settings.damageProfileId));
    const priestProfile = profiles.find(p => String(p.id) === String(settings.priestProfileId));

    if (!dmgProfile || !dmgProfile.debugPort) {
      state.statusText = '⚠️ รอจอตัวแบก Damage ออนไลน์...';
      return;
    }
    if (!priestProfile || !priestProfile.debugPort) {
      state.statusText = '⚠️ รอจอตัวแบก Priest ออนไลน์...';
      return;
    }

    const dmgSnap = await refreshProfileSnapshot(dmgProfile);
    const priestSnap = await refreshProfileSnapshot(priestProfile);
    const dmgName = (dmgSnap && dmgSnap.charName) || dmgProfile.lastCharName || dmgProfile.name;
    const priestName = (priestSnap && priestSnap.charName) || priestProfile.lastCharName || priestProfile.name;

    // -----------------------------------------------------------------
    // STAGE 1: PICK_BATCH (เลือกตัวเด็กสูงสุด 4 ตัวที่ยังมีโควต้า > 0/3)
    // -----------------------------------------------------------------
    if (state.phase === 'PICK_BATCH') {
      const candidatePool = profiles.filter(p => {
        if (!p || !p.debugPort) return false;
        if (String(p.id) === String(dmgProfile.id) || String(p.id) === String(priestProfile.id)) return false;
        if (state.completedKidIds.includes(String(p.id))) return false;
        if (settings.selectedKidProfileIds.length > 0 && !settings.selectedKidProfileIds.includes(String(p.id))) return false;
        return true;
      });

      await Promise.all(candidatePool.map(p => refreshProfileSnapshot(p).catch(() => null)));

      const eligibleKids = candidatePool.filter(p => {
        const sn = snapshots.get(String(p.id));
        if (!sn || !sn.ok) return false;
        const lv = Number(sn.baseLevel) || Number(p.lastBaseLv) || 0;
        if (lv > 0 && lv < 99) return false;
        const runsLeft = sn.tower ? Number(sn.tower.runsLeft) : 3;
        if (runsLeft <= 0) {
          if (!state.completedKidIds.includes(String(p.id))) state.completedKidIds.push(String(p.id));
          return false;
        }
        return true;
      });

      if (eligibleKids.length === 0) {
        state.running = false;
        setPhase('COMPLETED', '🎉 แบกหอคอยครบทุกตัวละครที่มีโควต้าเรียบร้อยแล้ว!');
        pushLog('🎉 แบกหอคอยครบทุกคิวที่มีโควต้า (0/3 ทุกตัว) เรียบร้อยแล้ว!', 'success');
        await pushRoleConfigToClient(dmgProfile, 'damage', false, dmgName, priestName);
        await pushRoleConfigToClient(priestProfile, 'priest', false, dmgName, priestName);
        return;
      }

      const nextBatch = eligibleKids.slice(0, 4);
      state.batchNumber += 1;
      state.roundInBatch = 1;
      state.currentBatchKidIds = nextBatch.map(p => String(p.id));
      const kidNames = nextBatch.map(p => (snapshots.get(String(p.id)) && snapshots.get(String(p.id)).charName) || p.lastCharName || p.name);
      pushLog(`📦 เริ่มชุดที่ ${state.batchNumber}: ดึงตัวเด็ก ${kidNames.join(', ')} (ลงให้ครบ 3/3 รอบ ถึงชั้น ${settings.targetFloor})`, 'info');
      setPhase('RECALL_AND_GATHER', `ชุดที่ ${state.batchNumber} (รอบ 1/3): กำลังเรียกทุกตัวกลับเมืองหลวงและรวมปาร์ตี้...`);
      return;
    }

    const batchKidProfiles = state.currentBatchKidIds
      .map(id => profiles.find(p => String(p.id) === String(id)))
      .filter(p => p && p.debugPort);
    const allBatchProfiles = [dmgProfile, priestProfile, ...batchKidProfiles];

    // Push active role configuration to all batch members
    await Promise.all([
      pushRoleConfigToClient(dmgProfile, 'damage', true, dmgName, priestName),
      pushRoleConfigToClient(priestProfile, 'priest', true, dmgName, priestName),
      ...batchKidProfiles.map(kp => pushRoleConfigToClient(kp, 'kid', true, dmgName, priestName))
    ]);

    // -----------------------------------------------------------------
    // STAGE 2: RECALL_AND_GATHER (เรียกกลับเมืองหลวงโซลเฮเวน + ย้ายแนล + เดินมารวมกันในระยะ 15 ช่อง + ชวนตี้)
    // -----------------------------------------------------------------
    if (state.phase === 'RECALL_AND_GATHER') {
      const dmgRes = await evalControl(dmgProfile, `window.__towerCarryControl.recallToCapital(1480, 1480, null)`, 7000);
      if (!dmgRes || !dmgRes.inCapital) {
        state.statusText = `กำลังนำหัวตี้ (${dmgName}) กลับเมืองหลวงโซลเฮเวน...`;
        return;
      }
      const targetCh = dmgRes.channel || (dmgSnap && dmgSnap.channel) || 1;
      const gatherX = dmgRes.x || 1480;
      const gatherY = dmgRes.y || 1480;
      state.gatherCoords = { x: gatherX, y: gatherY, channel: targetCh };

      const memberProfiles = [priestProfile, ...batchKidProfiles];
      const recallResults = await Promise.all(
        memberProfiles.map(mp => evalControl(mp, `window.__towerCarryControl.recallToCapital(${gatherX}, ${gatherY}, ${targetCh})`, 7000))
      );

      const waitingNames = [];
      recallResults.forEach((r, idx) => {
        const mp = memberProfiles[idx];
        const nm = (snapshots.get(String(mp.id)) && snapshots.get(String(mp.id)).charName) || mp.lastCharName || mp.name;
        if (!r || r.action !== 'ready-at-gather') {
          waitingNames.push(nm);
        }
      });

      // Also invite party members while gathering
      const wantedPartyNames = new Set([dmgName, priestName, ...batchKidProfiles.map(p => (snapshots.get(String(p.id)) && snapshots.get(String(p.id)).charName) || p.lastCharName || '').filter(Boolean)]);
      const curPartyMembers = (dmgSnap && dmgSnap.party && Array.isArray(dmgSnap.party.members)) ? dmgSnap.party.members : [];
      const toKick = curPartyMembers.map(m => m.name).filter(n => n && !wantedPartyNames.has(n));
      await inviteAndAcceptParty(dmgProfile, memberProfiles, toKick);

      if (waitingNames.length > 0) {
        state.statusText = `กำลังเรียกกลับเมือง/รวมพลที่ CH${targetCh}: รอ ${waitingNames.join(', ')}`;
        return;
      }

      const missingInParty = Array.from(wantedPartyNames).filter(n => n !== dmgName && !curPartyMembers.some(m => m.name === n));
      if (missingInParty.length > 0 && (now() - state.phaseEnteredAt < 25000)) {
        state.statusText = `กำลังชวนเข้าปาร์ตี้: รอ ${missingInParty.join(', ')} กดรับตี้...`;
        return;
      }

      setPhase('RESET_AND_ENTER', `รวมตี้ครบแล้ว! กำลังกดรีเซ็ตชั้น 1 และพาเข้าหอคอย (รอบที่ ${state.roundInBatch}/3)...`);
      return;
    }

    // -----------------------------------------------------------------
    // STAGE 3: RESET_AND_ENTER (กดรีเซ็ตเริ่มชั้น 1 ทุกตัว + หัวตี้กดไปทันที)
    // -----------------------------------------------------------------
    if (state.phase === 'RESET_AND_ENTER') {
      await Promise.all(allBatchProfiles.map(p => refreshProfileSnapshot(p).catch(() => null)));
      const anyInTower = allBatchProfiles.some(p => {
        const sn = snapshots.get(String(p.id));
        return Boolean(sn && sn.inTower);
      });
      if (anyInTower) {
        state.currentFloor = (dmgSnap && dmgSnap.currentFloor) || 1;
        state.clearedFloor = 0;
        pushLog(`🏰 เข้าสู่หอคอยนิรันดร์สำเร็จ (ชุดที่ ${state.batchNumber} · รอบที่ ${state.roundInBatch}) — เป้าหมายชั้น ${settings.targetFloor}`, 'success');
        setPhase('CLIMBING', `กำลังลุยหอคอย ชั้น ${state.currentFloor} / ${settings.targetFloor} (ชุดที่ ${state.batchNumber} · รอบที่ ${state.roundInBatch})`);
        return;
      }

      if (now() - state.lastEnterSentAt >= 3500) {
        state.lastEnterSentAt = now();
        // Reset members first, then leader resets & enters
        const memberProfiles = [priestProfile, ...batchKidProfiles];
        await Promise.all(memberProfiles.map(mp => evalControl(mp, 'window.__towerCarryControl.resetAndEnterTower(false)', 6000)));
        await new Promise(r => setTimeout(r, 400));
        await evalControl(dmgProfile, 'window.__towerCarryControl.resetAndEnterTower(true)', 6000);
      }
      return;
    }

    // -----------------------------------------------------------------
    // STAGE 4: CLIMBING (กำลังไต่หอคอย 1 -> targetFloor)
    // -----------------------------------------------------------------
    if (state.phase === 'CLIMBING') {
      await Promise.all(batchKidProfiles.map(p => refreshProfileSnapshot(p).catch(() => null)));
      const curFloor = (dmgSnap && dmgSnap.currentFloor) || (priestSnap && priestSnap.currentFloor) || state.currentFloor || 1;
      const clrFloor = Math.max((dmgSnap && dmgSnap.clearedFloor) || 0, (priestSnap && priestSnap.clearedFloor) || 0);
      state.currentFloor = curFloor;
      state.clearedFloor = clrFloor;

      const priestAction = (priestSnap && priestSnap.priestActionText) ? ` · พระ: ${priestSnap.priestActionText}` : '';
      state.statusText = `⚔️ กำลังลุยชั้น ${curFloor} / ${settings.targetFloor} (ชุดที่ ${state.batchNumber} · รอบ ${state.roundInBatch})${priestAction}`;

      const completedTarget = Boolean(
        (dmgSnap && dmgSnap.targetFloorCompleted) ||
        (priestSnap && priestSnap.targetFloorCompleted) ||
        clrFloor >= settings.targetFloor ||
        curFloor > settings.targetFloor
      );

      if (completedTarget) {
        pushLog(`🏆 ผ่านบอสชั้น ${settings.targetFloor} สำเร็จ! (ชุดที่ ${state.batchNumber} · รอบที่ ${state.roundInBatch}) -> พาทุกตัวกลับเมืองเพื่อรีเซ็ตรอบถัดไป`, 'success');
        setPhase('EXITING_TOWER', `ผ่านชั้น ${settings.targetFloor} แล้ว! กำลังพาทุกตัวออกจากหอคอยกลับเมืองหลวง...`);
      }
      return;
    }

    // -----------------------------------------------------------------
    // STAGE 5: EXITING_TOWER (ออกจากหอคอย -> เช็คโควต้า 3/3 -> ลงรอบถัดไป หรือ เปลี่ยนชุดเด็กถัดไป)
    // -----------------------------------------------------------------
    if (state.phase === 'EXITING_TOWER') {
      const gatherX = state.gatherCoords.x || 1480;
      const gatherY = state.gatherCoords.y || 1480;
      const targetCh = state.gatherCoords.channel || null;

      await Promise.all(allBatchProfiles.map(p => evalControl(p, `window.__towerCarryControl.recallToCapital(${gatherX}, ${gatherY}, ${targetCh})`, 7000)));
      await Promise.all(allBatchProfiles.map(p => refreshProfileSnapshot(p).catch(() => null)));

      const stillInTower = allBatchProfiles.filter(p => {
        const sn = snapshots.get(String(p.id));
        return Boolean(sn && sn.inTower);
      });
      if (stillInTower.length > 0) {
        state.statusText = `กำลังออกจากหอคอยกลับเมืองหลวง (รออีก ${stillInTower.length} จอ)...`;
        return;
      }

      // Check remaining weekly quota of kids in current batch
      const kidsWithQuotaLeft = batchKidProfiles.filter(kp => {
        const sn = snapshots.get(String(kp.id));
        const left = (sn && sn.tower) ? Number(sn.tower.runsLeft) : 0;
        return left > 0;
      });
      const finishedKids = batchKidProfiles.filter(kp => !kidsWithQuotaLeft.includes(kp));

      for (const fk of finishedKids) {
        if (!state.completedKidIds.includes(String(fk.id))) {
          state.completedKidIds.push(String(fk.id));
        }
        const fnm = (snapshots.get(String(fk.id)) && snapshots.get(String(fk.id)).charName) || fk.lastCharName || fk.name;
        pushLog(`✅ ${fnm} ใช้โควต้าหอคอยครบ 3/3 รอบแล้ว! ถอดออกจากตี้และปล่อยกลับไปฟาร์มต่อ`, 'success');
        await pushRoleConfigToClient(fk, 'kid', false, dmgName, priestName);
        if (settings.resumeFarmAfterFinish && fk.debugPort) {
          await evalProfilePort(fk.debugPort, `(async () => {
            const room = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
            if (room) room.send('party', { action: 'leave' });
            if (!window.__isBotRunning && typeof window.startMasterBot === 'function') window.startMasterBot();
            return { ok: true };
          })()`, 5000).catch(() => null);
        }
      }

      if (kidsWithQuotaLeft.length > 0 && state.roundInBatch < 3) {
        state.currentBatchKidIds = kidsWithQuotaLeft.map(p => String(p.id));
        state.roundInBatch += 1;
        pushLog(`🔄 เริ่มรอบที่ ${state.roundInBatch}/3 ของชุดที่ ${state.batchNumber} (รีเซ็ตเริ่มชั้น 1 ใหม่)`, 'info');
        setPhase('RECALL_AND_GATHER', `เตรียมลงรอบที่ ${state.roundInBatch}/3 ของชุดที่ ${state.batchNumber}...`);
      } else {
        pushLog(`🎉 ชุดที่ ${state.batchNumber} ลงครบ 3/3 รอบแล้ว! กำลังดึงตัวเด็กชุดถัดไปเข้าตี้โดยอัตโนมัติ...`, 'success');
        state.currentBatchKidIds = [];
        setPhase('PICK_BATCH', 'กำลังค้นหาตัวเด็กชุดถัดไปที่มีโควต้าเหลือ...');
      }
    }
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      await stepPipeline();
    } catch (e) {
      log('tick error:', e.message);
    } finally {
      ticking = false;
    }
  }

  async function startCarry() {
    const profiles = loadProfiles();
    const dmg = profiles.find(p => String(p.id) === String(settings.damageProfileId));
    const pr = profiles.find(p => String(p.id) === String(settings.priestProfileId));
    if (!dmg || !dmg.debugPort) {
      return { success: false, error: 'กรุณาเลือกจอ "ตัวแบก Damage" ที่ออนไลน์อยู่ก่อนเริ่ม' };
    }
    if (!pr || !pr.debugPort) {
      return { success: false, error: 'กรุณาเลือกจอ "ตัวแบก Priest (พระ)" ที่ออนไลน์อยู่ก่อนเริ่ม' };
    }
    if (String(dmg.id) === String(pr.id)) {
      return { success: false, error: 'ตัวแบก Damage และ Priest ต้องเป็นคนละจอกัน' };
    }

    state.running = true;
    state.batchNumber = 0;
    state.roundInBatch = 0;
    state.currentBatchKidIds = [];
    state.completedKidIds = [];
    setPhase('PICK_BATCH', '🚀 เริ่มระบบแบกหอคอย: กำลังตรวจสอบโควต้า 3/3 และจัดชุดปาร์ตี้...');
    pushLog(`🚀 เริ่มระบบแบกหอคอย (Damage: ${dmg.lastCharName || dmg.name} · Priest: ${pr.lastCharName || pr.name} · เป้าหมายชั้น ${settings.targetFloor})`, 'info');
    setTimeout(() => tick().catch(() => {}), 80);
    return { success: true };
  }

  async function stopCarry() {
    state.running = false;
    setPhase('IDLE', '⏹️ หยุดระบบแบกหอคอยแล้ว');
    pushLog('⏹️ สั่งหยุดระบบแบกหอคอยแล้ว', 'warn');
    const profiles = loadProfiles().filter(p => p && p.debugPort);
    await Promise.all(profiles.map(p => pushRoleConfigToClient(p, null, false, '', '').catch(() => null)));
    return { success: true };
  }

  function view() {
    const profiles = loadProfiles();
    return {
      success: true,
      settings,
      state: {
        running: state.running,
        phase: state.phase,
        statusText: state.statusText,
        batchNumber: state.batchNumber,
        roundInBatch: state.roundInBatch,
        currentFloor: state.currentFloor,
        clearedFloor: state.clearedFloor,
        currentBatchKidIds: state.currentBatchKidIds,
        completedKidIds: state.completedKidIds,
        logs: state.logs
      },
      roleSkillsCache,
      clients: profiles.map(p => {
        const sn = snapshots.get(String(p.id)) || null;
        const tw = sn && sn.tower ? sn.tower : null;
        const isDamage = String(p.id) === String(settings.damageProfileId);
        const isPriest = String(p.id) === String(settings.priestProfileId);
        const isInBatch = state.currentBatchKidIds.includes(String(p.id));
        const isCompleted = state.completedKidIds.includes(String(p.id));
        return {
          id: p.id,
          name: p.name,
          charName: (sn && sn.charName) || p.lastCharName || null,
          classId: (sn && sn.classId) || p.lastCharClass || null,
          baseLevel: (sn && sn.baseLevel) || p.lastBaseLv || 0,
          online: Boolean(p.debugPort),
          inTower: Boolean(sn && sn.inTower),
          currentFloor: (sn && sn.currentFloor) || 0,
          mapName: (sn && sn.displayName) || null,
          channel: (sn && sn.channel) || null,
          dead: Boolean(sn && sn.dead),
          hp: sn ? sn.hp : null,
          maxHp: sn ? sn.maxHp : null,
          priestState: sn ? sn.priestState : null,
          priestActionText: sn ? sn.priestActionText : null,
          runsLeft: tw ? tw.runsLeft : null,
          runsPerWeek: tw ? tw.runsPerWeek : 3,
          checkpoint: tw ? tw.checkpoint : null,
          claimed: tw ? tw.claimed : null,
          role: isDamage ? 'damage' : isPriest ? 'priest' : isInBatch ? 'kid_active' : isCompleted ? 'kid_done' : 'kid_candidate'
        };
      })
    };
  }

  async function handleRoute(req, res, pathname, sendJSON) {
    if (!pathname.startsWith('/api/tower')) return false;
    if (pathname === '/api/tower' && req.method === 'GET') {
      sendJSON(view());
      return true;
    }
    if (req.method !== 'POST') return false;
    const body = (await readBody(req)) || {};

    if (pathname === '/api/tower/settings') {
      const prevDmg = settings.damageProfileId;
      const prevPr = settings.priestProfileId;
      settings = sanitizeSettings(Object.assign({}, settings, body));
      save();
      if (settings.damageProfileId && settings.damageProfileId !== prevDmg) {
        await fetchRoleSkills(settings.damageProfileId).catch(() => null);
        const cache = roleSkillsCache[settings.damageProfileId];
        if (cache && (!settings.damageSkills || settings.damageSkills.length === 0)) {
          settings.damageSkills = (cache.autoSkills && cache.autoSkills.length)
            ? cache.autoSkills.slice()
            : cache.skills.filter(s => s.autoUse === 'enemy' || s.autoUse === 'buff').map(s => s.id);
          save();
        }
      }
      if (settings.priestProfileId && settings.priestProfileId !== prevPr) {
        await fetchRoleSkills(settings.priestProfileId).catch(() => null);
      }
      sendJSON(view());
      return true;
    }

    if (pathname === '/api/tower/role-skills') {
      const pid = String(body.profileId || '');
      if (!pid) {
        sendJSON({ success: false, error: 'ไม่ได้ระบุ profileId' }, 400);
        return true;
      }
      const r = await fetchRoleSkills(pid);
      if (!r || !r.ok) {
        sendJSON(Object.assign(view(), { success: false, error: (r && r.error) || 'ดึงข้อมูลสกิลจากตัวละครไม่สำเร็จ' }), 400);
        return true;
      }
      sendJSON(Object.assign(view(), { roleSkills: roleSkillsCache[pid] }));
      return true;
    }

    if (pathname === '/api/tower/scan-quotas') {
      await scanAllQuotas();
      sendJSON(view());
      return true;
    }

    if (pathname === '/api/tower/start') {
      const r = await startCarry();
      if (!r.success) {
        sendJSON(Object.assign(view(), r), 400);
        return true;
      }
      sendJSON(view());
      return true;
    }

    if (pathname === '/api/tower/stop') {
      await stopCarry();
      sendJSON(view());
      return true;
    }

    if (pathname === '/api/tower/reset-all') {
      const profiles = loadProfiles().filter(p => p && p.debugPort);
      await Promise.all(profiles.map(p => evalControl(p, 'window.__towerCarryControl.resetAndEnterTower(false)', 5000).catch(() => null)));
      await scanAllQuotas();
      pushLog('🔄 สั่งกดรีเซ็ตหอคอยเริ่มชั้น 1 ให้ทุกจอที่อยู่ในเมืองเรียบร้อยแล้ว', 'info');
      sendJSON(view());
      return true;
    }

    return false;
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      if (state.running) tick().catch(() => {});
    }, 3000);
    if (timer.unref) timer.unref();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  function updateSettings(patch) {
    settings = sanitizeSettings(Object.assign({}, settings, patch || {}));
    save();
    return settings;
  }

  return {
    handleRoute,
    start,
    stop,
    tick,
    view,
    updateSettings,
    fetchRoleSkills,
    scanAllQuotas,
    startCarry,
    stopCarry
  };
}

module.exports = {
  createTowerCarryService,
  sanitizeSettings,
  DEFAULTS
};
