const fs = require("fs");
const path = require("path");

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clampInt(val, fallback = 0, min = 0) {
  const n = Math.floor(Number(val));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, n);
}

function calcTransferZeny(zeny, keepZeny = 0, roundHundredK = false) {
  const cur = Math.max(0, Number(zeny) || 0);
  const keep = Math.max(0, Number(keepZeny) || 0);
  if (!roundHundredK) return Math.max(0, cur - keep);
  if (keep <= 100000) {
    let rounded = Math.floor(cur / 100000) * 100000;
    if (keep > 0 && (cur - rounded) < 10000 && rounded >= 100000) {
      rounded -= 100000;
    }
    return Math.max(0, rounded);
  }
  return Math.floor(Math.max(0, cur - keep) / 100000) * 100000;
}

function parseCompositeKey(key) {
  const s = String(key || "").trim();
  const idx = s.indexOf("::");
  if (idx <= 0) return { machineKey: "", id: "" };
  return {
    machineKey: s.slice(0, idx),
    id: s.slice(idx + 2)
  };
}

function makeCompositeKey(machineKey, id) {
  return `${String(machineKey || "").trim()}::${String(id || "").trim()}`;
}

function getProfileIpFromObject(p) {
  if (p && typeof p.ip === "string" && p.ip.trim()) return p.ip.trim();
  if (p && p.screenProxy && p.screenProxy.active && (p.screenProxy.ip || p.screenProxy.proxyHost)) {
    return String(p.screenProxy.ip || p.screenProxy.proxyHost).trim();
  }
  return "LOCAL";
}

function computeProfilePremium(p) {
  if (!p) return false;
  if (p.hasPremium === true) return true;
  if (p.liveState && p.liveState.hasPremium === true) return true;
  const until = Number(p.premiumUntil || p.liveState?.premiumUntil || p.lastPremiumUntil || 0);
  return until > Date.now();
}

function computeProfileZeny(p) {
  if (!p) return 0;
  if (typeof p.zeny === "number" && Number.isFinite(p.zeny)) return Math.max(0, Math.floor(p.zeny));
  if (p.liveState && typeof p.liveState.zeny === "number" && Number.isFinite(p.liveState.zeny)) {
    return Math.max(0, Math.floor(p.liveState.zeny));
  }
  if (typeof p.lastZeny === "number" && Number.isFinite(p.lastZeny)) return Math.max(0, Math.floor(p.lastZeny));
  return 0;
}

async function mapWithConcurrency(items, concurrency, fn) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];
  const results = new Array(list.length);
  let cursor = 0;
  const workers = Math.min(Math.max(1, Number(concurrency) || 1), list.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (cursor < list.length) {
      const idx = cursor++;
      results[idx] = await fn(list[idx], idx);
    }
  }));
  return results;
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    let settled = false;
    req.on("data", chunk => {
      if (settled) return;
      const str = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
      size += Buffer.byteLength(str, "utf8");
      if (size > maxBytes) {
        settled = true;
        const err = new Error("Payload too large");
        err.status = 413;
        try { req.destroy(); } catch (_) {}
        return reject(err);
      }
      body += str;
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (e) {
        e.status = 400;
        reject(e);
      }
    });
    req.on("error", err => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

function buildIpGroupsForMachine(machineKey, profiles, cfg, masterReceiverKey, consolidationStatus) {
  const keepZeny = clampInt(cfg?.keepZeny, 0, 0);
  const roundHundredK = Boolean(cfg?.roundHundredK);
  const minZenyThreshold = clampInt(cfg?.minZenyThreshold, 1000000, 0);
  const ringFirst = cfg?.ringFirst !== false;
  const ringReceivers = (cfg?.ringReceivers && typeof cfg.ringReceivers === "object") ? cfg.ringReceivers : {};
  const masterParsed = parseCompositeKey(masterReceiverKey);

  const runningTasks = Array.isArray(consolidationStatus?.activeTasks) ? consolidationStatus.activeTasks : [];
  const taskByIp = new Map(runningTasks.map(t => [String(t.ip || ""), t]));

  const groupMap = new Map();
  for (const rawP of profiles) {
    const p = {
      id: String(rawP.id || ""),
      name: String(rawP.name || rawP.lastCharName || rawP.id || "Client"),
      charName: String(rawP.charName || rawP.liveState?.charName || rawP.lastCharName || rawP.name || ""),
      charClass: String(rawP.charClass || rawP.liveState?.charClass || rawP.lastCharClass || ""),
      map: String(rawP.map || rawP.liveState?.map || rawP.targetMap || ""),
      channel: Number(rawP.channel || rawP.liveState?.channel || 0) || null,
      zeny: computeProfileZeny(rawP),
      isRunning: Boolean(rawP.isRunning),
      isBotRunning: Boolean(rawP.isBotRunning || rawP.liveState?.isBotRunning),
      isMain: Boolean(rawP.isMain),
      hasPremium: computeProfilePremium(rawP),
      ip: getProfileIpFromObject(rawP),
      busy: Boolean(rawP.busy)
    };
    if (!groupMap.has(p.ip)) {
      groupMap.set(p.ip, {
        ip: p.ip,
        profiles: [],
        onlineProfiles: [],
        premiumProfiles: [],
        onlinePremiumProfiles: []
      });
    }
    const g = groupMap.get(p.ip);
    g.profiles.push(p);
    if (p.isRunning) g.onlineProfiles.push(p);
    if (p.hasPremium) {
      g.premiumProfiles.push(p);
      if (p.isRunning) g.onlinePremiumProfiles.push(p);
    }
  }

  const groups = [];
  for (const g of groupMap.values()) {
    const ringKey = makeCompositeKey(machineKey, g.ip);
    const savedRecId = String(ringReceivers[ringKey] || "").trim();
    const masterInThisRing = (masterParsed.machineKey === machineKey && masterParsed.id)
      ? (g.onlinePremiumProfiles.find(p => p.id === masterParsed.id) || g.premiumProfiles.find(p => p.id === masterParsed.id) || null)
      : null;

    let receiver = g.onlinePremiumProfiles.find(p => p.id === savedRecId)
      || g.onlinePremiumProfiles.find(p => p.isMain)
      || g.onlinePremiumProfiles.slice().sort((a, b) => b.zeny - a.zeny)[0]
      || g.premiumProfiles.find(p => p.id === savedRecId)
      || g.premiumProfiles.find(p => p.isMain)
      || g.premiumProfiles[0]
      || null;

    if (masterInThisRing && !savedRecId) {
      receiver = masterInThisRing;
    }

    const effectiveStage1Receiver = masterInThisRing && masterInThisRing.isRunning
      ? masterInThisRing
      : receiver;

    const ringSenders = effectiveStage1Receiver && effectiveStage1Receiver.isRunning
      ? g.onlinePremiumProfiles.filter(p => p.id !== effectiveStage1Receiver.id)
      : [];
    const ringTransferableZeny = ringSenders.reduce(
      (sum, p) => sum + calcTransferZeny(p.zeny, keepZeny, roundHundredK),
      0
    );

    const thresholdQualified = g.onlinePremiumProfiles.filter(p => {
      if (masterParsed.machineKey === machineKey && masterParsed.id === p.id) return false;
      return p.zeny > minZenyThreshold && calcTransferZeny(p.zeny, keepZeny, roundHundredK) > 0;
    });
    const thresholdTransferableZeny = thresholdQualified.reduce(
      (sum, p) => sum + calcTransferZeny(p.zeny, keepZeny, roundHundredK),
      0
    );

    const onlineZeny = g.onlineProfiles.reduce((sum, p) => sum + p.zeny, 0);
    const activeTask = taskByIp.get(g.ip) || null;
    const isMasterRing = Boolean(masterInThisRing);

    const effectiveReceiverPostStage1Zeny = effectiveStage1Receiver
      ? (effectiveStage1Receiver.zeny + (ringSenders.length > 0 ? ringTransferableZeny : 0))
      : 0;
    const stage2TransferZeny = (!isMasterRing && effectiveStage1Receiver && effectiveStage1Receiver.isRunning)
      ? calcTransferZeny(effectiveReceiverPostStage1Zeny, keepZeny, roundHundredK)
      : 0;

    groups.push({
      ip: g.ip,
      ringKey,
      totalCount: g.profiles.length,
      onlineCount: g.onlineProfiles.length,
      vipCount: g.premiumProfiles.length,
      onlineVipCount: g.onlinePremiumProfiles.length,
      onlineZeny,
      isMasterRing,
      masterInThisRingId: masterInThisRing ? masterInThisRing.id : null,
      receiver: effectiveStage1Receiver ? {
        id: effectiveStage1Receiver.id,
        compositeKey: makeCompositeKey(machineKey, effectiveStage1Receiver.id),
        name: effectiveStage1Receiver.name,
        charName: effectiveStage1Receiver.charName,
        zeny: effectiveStage1Receiver.zeny,
        isRunning: effectiveStage1Receiver.isRunning,
        hasPremium: effectiveStage1Receiver.hasPremium
      } : null,
      receiverCandidates: g.premiumProfiles.map(p => ({
        id: p.id,
        name: p.name,
        charName: p.charName,
        zeny: p.zeny,
        isRunning: p.isRunning,
        isMain: p.isMain
      })),
      ringSenderCount: ringSenders.length,
      ringSenderIds: ringSenders.map(p => p.id),
      ringTransferableZeny,
      stage2TransferZeny,
      canConsolidateInRing: Boolean(effectiveStage1Receiver && effectiveStage1Receiver.isRunning && ringSenders.length > 0 && ringTransferableZeny > 0),
      thresholdQualifiedCount: thresholdQualified.length,
      thresholdTransferableZeny,
      activeTask,
      modeDisplayCount: ringFirst ? ringSenders.length : thresholdQualified.length,
      modeDisplayTransferZeny: ringFirst ? ringTransferableZeny : thresholdTransferableZeny
    });
  }

  return groups;
}

function createFleetZenyConsolidationService(deps = {}) {
  const {
    dataDir,
    loadProfiles,
    queryClientState,
    evalProfilePort,
    getProfileIpGroupKey,
    ensureClientConsolidationItemHelpers,
    activeConsolidationProfiles,
    activeConsolidationTasks,
    activeConsolidationChannels,
    syncConsolidationGlobalState,
    getConsolidationState,
    stopLocalConsolidation,
    remoteFleet,
    humanCheckSolver,
    getEffectiveDeviceNickname,
    os,
    managerVersion = "4.63.8",
    runningProcesses = null,
    isProcessAlive = null,
    browserMode = null,
    clientStateCacheByPort = null,
    clientStateLastFailureByPort = null,
    sleep = defaultSleep,
    pollIntervalMs = 700,
    stage1PollIntervalMs = 1500
  } = deps;

  const configFilePath = path.join(dataDir || path.join(__dirname, "data"), "fleet_zeny_config.json");

  function loadConfig() {
    const defaults = {
      masterReceiverKey: "",
      ringFirst: true,
      minZenyThreshold: 1000000,
      keepZeny: 0,
      roundHundredK: false,
      ringReceivers: {}
    };
    try {
      if (fs.existsSync(configFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(configFilePath, "utf8") || "{}");
        if (parsed && typeof parsed === "object") {
          const cleanRingReceivers = {};
          if (parsed.ringReceivers && typeof parsed.ringReceivers === "object") {
            for (const [k, v] of Object.entries(parsed.ringReceivers)) {
              if (k && typeof v === "string" && v.trim()) {
                cleanRingReceivers[String(k)] = String(v).trim();
              }
            }
          }
          return {
            masterReceiverKey: typeof parsed.masterReceiverKey === "string" ? parsed.masterReceiverKey.trim() : "",
            ringFirst: parsed.ringFirst !== false,
            minZenyThreshold: clampInt(parsed.minZenyThreshold, 1000000, 0),
            keepZeny: clampInt(parsed.keepZeny, 0, 0),
            roundHundredK: Boolean(parsed.roundHundredK),
            ringReceivers: cleanRingReceivers
          };
        }
      }
    } catch (_) {}
    return defaults;
  }

  function saveConfig(patch = {}) {
    const cur = loadConfig();
    const mergedRingReceivers = { ...cur.ringReceivers };
    if (patch.ringReceivers && typeof patch.ringReceivers === "object") {
      for (const [k, v] of Object.entries(patch.ringReceivers)) {
        if (!k) continue;
        if (typeof v === "string" && v.trim()) mergedRingReceivers[String(k)] = v.trim();
        else delete mergedRingReceivers[String(k)];
      }
    }
    const next = {
      masterReceiverKey: patch.masterReceiverKey !== undefined
        ? String(patch.masterReceiverKey || "").trim()
        : cur.masterReceiverKey,
      ringFirst: typeof patch.ringFirst === "boolean" ? patch.ringFirst : cur.ringFirst,
      minZenyThreshold: patch.minZenyThreshold !== undefined
        ? clampInt(patch.minZenyThreshold, cur.minZenyThreshold, 0)
        : cur.minZenyThreshold,
      keepZeny: patch.keepZeny !== undefined
        ? clampInt(patch.keepZeny, cur.keepZeny, 0)
        : cur.keepZeny,
      roundHundredK: typeof patch.roundHundredK === "boolean" ? patch.roundHundredK : cur.roundHundredK,
      ringReceivers: mergedRingReceivers
    };
    try {
      fs.mkdirSync(path.dirname(configFilePath), { recursive: true });
      fs.writeFileSync(configFilePath, JSON.stringify(next, null, 2), "utf8");
    } catch (_) {}
    return next;
  }

  // =========================================================================
  // LOCAL ACTOR STATE & JOBS (runs on every PC, callable via fleet relay)
  // =========================================================================
  let actorJobSeq = 0;
  const actorJobs = new Map();
  let actorAbortEpoch = 0;
  const actorLockedProfiles = new Map(); // profileId -> { lockId, wasBotRunning, homeChannel, channel }

  function pruneOldActorJobs() {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [id, j] of actorJobs.entries()) {
      if (j.status !== "running" && j.finishedAt && j.finishedAt < cutoff) {
        actorJobs.delete(id);
      }
    }
  }

  function acquireActorLock(profile, roleLabel = "รวมเงินข้ามเครื่อง") {
    const lockId = `fleet_actor_${profile.id}`;
    if (activeConsolidationProfiles && activeConsolidationProfiles.has(profile.id)) {
      const existing = activeConsolidationProfiles.get(profile.id);
      if (existing !== lockId) {
        throw new Error(`โปรไฟล์ ${profile.name} กำลังติดงานรวมเงินอื่นอยู่ (${existing})`);
      }
    }
    if (activeConsolidationProfiles) activeConsolidationProfiles.set(profile.id, lockId);
    if (activeConsolidationTasks) {
      const ip = typeof getProfileIpGroupKey === "function" ? getProfileIpGroupKey(profile.id) : "LOCAL";
      activeConsolidationTasks.set(lockId, {
        taskId: lockId,
        ip,
        sameIpOnly: false,
        isPremiumConsolidation: false,
        status: "running",
        stepIndex: 1,
        totalSteps: 5,
        step: `${roleLabel}: ${profile.name}`,
        receiver: null,
        currentSender: profile.name,
        completedSenders: [],
        totalSenders: 1,
        transferredZeny: 0,
        transferredItems: 0,
        targetChannel: null,
        startTime: Date.now()
      });
    }
    if (typeof syncConsolidationGlobalState === "function") syncConsolidationGlobalState();
    return lockId;
  }

  function releaseActorLock(profileId) {
    const lockId = `fleet_actor_${profileId}`;
    actorLockedProfiles.delete(profileId);
    if (activeConsolidationProfiles && activeConsolidationProfiles.get(profileId) === lockId) {
      activeConsolidationProfiles.delete(profileId);
    }
    if (activeConsolidationTasks) activeConsolidationTasks.delete(lockId);
    if (activeConsolidationChannels) {
      for (const [ch, tid] of activeConsolidationChannels.entries()) {
        if (tid === lockId) activeConsolidationChannels.delete(ch);
      }
    }
    if (typeof syncConsolidationGlobalState === "function") syncConsolidationGlobalState();
    const st = typeof getConsolidationState === "function" ? getConsolidationState() : null;
    if (st && (!activeConsolidationTasks || activeConsolidationTasks.size === 0)) {
      st.running = false;
      if (st.status === "running") {
        st.status = "completed";
        st.endTime = Date.now();
      }
    }
  }

  async function buildLocalSnapshot() {
    const profiles = typeof loadProfiles === "function" ? loadProfiles() : [];
    const items = await mapWithConcurrency(profiles, 8, async (p) => {
      const proc = runningProcesses && runningProcesses[p.id];
      const isOpenBrowser = Boolean(browserMode && typeof browserMode.isOpen === "function" && browserMode.isOpen(p.id));
      let alive = Boolean((proc && typeof isProcessAlive === "function" && isProcessAlive(proc.pid)) || isOpenBrowser);
      let liveState = null;

      if (p.debugPort) {
        const lastFail = clientStateLastFailureByPort ? clientStateLastFailureByPort.get(p.debugPort) : null;
        const skipClosed = !alive && lastFail && lastFail.reason === "ECONNREFUSED" && (Date.now() - lastFail.ts < 5000);
        if (!skipClosed) {
          const cached = clientStateCacheByPort ? clientStateCacheByPort.get(p.debugPort) : null;
          if (cached && cached.state && (Date.now() - Number(cached.ts || 0) < 4500)) {
            liveState = cached.state;
          } else {
            liveState = await queryClientState(p.debugPort).catch(() => null);
          }
          if (liveState && !liveState.error) alive = true;
        }
      }

      const isInGameLive = Boolean(alive && liveState && !liveState.error && !liveState._syntheticLoading && (!liveState.screenPhase || liveState.screenPhase === "in_game"));
      const hasPremium = isInGameLive
        ? Boolean(liveState.hasPremium)
        : Boolean(Number(p.lastPremiumUntil || 0) > Date.now());
      const zeny = (isInGameLive && typeof liveState?.zeny === "number" && Number.isFinite(liveState.zeny))
        ? Math.max(0, Math.floor(liveState.zeny))
        : (typeof p.lastZeny === "number" && Number.isFinite(p.lastZeny) ? Math.max(0, Math.floor(p.lastZeny)) : 0);

      const ip = typeof getProfileIpGroupKey === "function" ? getProfileIpGroupKey(p.id) : getProfileIpFromObject(p);
      return {
        id: String(p.id || ""),
        name: String(p.name || p.lastCharName || p.id || "Client"),
        charName: String((liveState && liveState.charName) || p.lastCharName || p.name || ""),
        charClass: String((liveState && liveState.charClass) || p.lastCharClass || p.charClass || ""),
        map: String((liveState && liveState.map) || p.targetMap || ""),
        channel: Number(liveState?.channel || 0) || null,
        zeny,
        isRunning: alive,
        isBotRunning: Boolean(alive && liveState && liveState.isBotRunning),
        isMain: Boolean(p.isMain),
        hasPremium,
        ip,
        debugPort: p.debugPort || null,
        busy: Boolean(activeConsolidationProfiles && activeConsolidationProfiles.has(p.id))
      };
    });

    const st = typeof getConsolidationState === "function" ? getConsolidationState() : null;
    return {
      success: true,
      actorReady: true,
      managerVersion,
      machineKey: (humanCheckSolver && typeof humanCheckSolver.getMachineHwidShort === "function")
        ? humanCheckSolver.getMachineHwidShort()
        : "",
      deviceName: typeof getEffectiveDeviceNickname === "function"
        ? getEffectiveDeviceNickname()
        : (os && typeof os.hostname === "function" ? os.hostname() : "Local"),
      profiles: items,
      consolidation: st ? {
        running: Boolean(st.running),
        status: st.status || "idle",
        step: st.step || "",
        stepIndex: st.stepIndex || 0,
        totalSteps: st.totalSteps || 5,
        totalTransferredZeny: Number(st.totalTransferredZeny || 0),
        activeTasks: Array.isArray(st.activeTasks) ? st.activeTasks : []
      } : null
    };
  }

  function findOnlineProfileOrThrow(profileId) {
    const profiles = typeof loadProfiles === "function" ? loadProfiles() : [];
    const p = profiles.find(x => x.id === profileId);
    if (!p || !p.debugPort) {
      throw new Error(`ไม่พบโปรไฟล์ (${profileId}) หรือจอเกมไม่ได้เปิดอยู่`);
    }
    return p;
  }

  const STOP_BOT_JS = `(() => {
    window.__consolidationAborted = false;
    window.__isConsolidating = true;
    window.__consolidationPending = true;
    window.__isBotRunning = false;
    window.__autoLoopEnabled = false;
    window.__isWalkingToMap = false;
    window.__isNavigating = false;
    window.__isShopping = false;
    window.__isStoring = false;
    window.__isRecovering = false;
    if (window.__townQueueTimer) { clearTimeout(window.__townQueueTimer); window.__townQueueTimer = null; }
    if (typeof window.stopMasterBot === 'function') window.stopMasterBot();
    if (typeof window.stopPelicanBot === 'function') window.stopPelicanBot();
    if (typeof window.stopArrivalWatcher === 'function') window.stopArrivalWatcher();
    if (typeof window.clearAllBotTimers === 'function') window.clearAllBotTimers();
    if (typeof window.deactivateInGameAuto === 'function') window.deactivateInGameAuto();
    try {
      const room = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
      if (typeof window.sendAutoSetPacket === 'function') window.sendAutoSetPacket(false);
      else if (room && typeof room.send === 'function') room.send('auto_set', { enabled: false });
      if (room && typeof room.send === 'function') {
        room.send('target', { targetId: null });
        const me = room.state && room.state.players && room.state.players.get ? room.state.players.get(room.sessionId) : null;
        if (me && Number.isFinite(me.x) && Number.isFinite(me.y)) {
          room.send('move_to', { x: Math.round(me.x), y: Math.round(me.y) });
        }
      }
    } catch (e) {}
    if (typeof window.closeShopUI === 'function') window.closeShopUI();
    if (typeof window.sendNpcClose === 'function') window.sendNpcClose();
    try { localStorage.setItem('pelican_bot_running', 'false'); } catch(e){}
    try { localStorage.setItem('pelican_auto_loop', 'false'); } catch(e){}
    const loopCheckbox = document.getElementById('p-auto-loop');
    if (loopCheckbox) loopCheckbox.checked = false;
    if (typeof updateMasterBotUI === 'function') updateMasterBotUI();
    return { success: true };
  })()`;

  const START_BOT_JS = `(() => {
    window.__consolidationAborted = true;
    window.__isConsolidating = false;
    window.__consolidationPending = false;
    window.__consolidationReceiverMode = false;
    window.__isWalkingToMap = false;
    window.__isNavigating = false;
    if (typeof window.restoreKeptFarmMap === 'function') window.restoreKeptFarmMap();
    window.__autoLoopEnabled = true;
    window.__isBotRunning = true;
    try { localStorage.setItem('pelican_auto_loop', 'true'); localStorage.setItem('pelican_bot_running', 'true'); } catch(e){}
    const cb = document.getElementById('p-auto-loop');
    if (cb) cb.checked = true;
    if (typeof window.startMasterBot === 'function') window.startMasterBot();
    else if (typeof window.startBot === 'function') window.startBot();
    if (typeof updateMasterBotUI === 'function') updateMasterBotUI();
    return { success: true };
  })()`;

  const CLEAR_FLAGS_JS = `(() => {
    window.__consolidationAborted = false;
    window.__isConsolidating = false;
    window.__consolidationPending = false;
    window.__consolidationReceiverMode = false;
    window.__consolidationExpectedSender = null;
    if (typeof window.stopReceiverTradeWatcher === 'function') { try { window.stopReceiverTradeWatcher(); } catch (_) {} }
    return { success: true };
  })()`;

  const BUSY_CHECK_JS = `(() => {
    window.__consolidationPending = true;
    if (window.__townQueueTimer) { clearTimeout(window.__townQueueTimer); window.__townQueueTimer = null; }
    const curMap = (typeof window.getCurrentMapName === 'function' ? window.getCurrentMapName() : '') || '';
    const inTown = /เมืองหลวง|โซลเฮเวน|คาราวาน/.test(curMap);
    if (!inTown || !window.__isBotRunning) {
      window.__isShopping = false;
      window.__isStoring = false;
    }
    const hard = [];
    const soft = [];
    const reconnEl = document.querySelector('.login-reconnecting, .panel.reconnecting');
    const bodyTxt = document.body ? (document.body.innerText || '') : '';
    const reconnecting = Boolean(
      (reconnEl && (reconnEl.offsetWidth > 0 || reconnEl.offsetHeight > 0)) ||
      bodyTxt.includes('กำลังเชื่อมต่อใหม่')
    );
    if (reconnecting) hard.push('ค้างหน้ากำลังเชื่อมต่อใหม่');
    const hc = document.querySelector('.human-check');
    if (hc && hc.offsetParent !== null) hard.push('เช็คผู้เล่น (Human Check)');
    if (inTown && window.__isGearRefining) hard.push('ตีบวกอุปกรณ์');
    if (window.__planMarketBuyInFlight) hard.push('ซื้อของในตลาด');
    if (inTown && window.__isChangingJob) hard.push('เปลี่ยนอาชีพ');
    if (inTown && window.__isShopping) soft.push('ขาย/ซื้อของกับ NPC');
    if (inTown && window.__isStoring) soft.push('ฝากของเข้าคลัง');
    if (window.__isWeightScrollBusy) soft.push('ใช้ Weight Scroll');
    if (window.__isManualSelling) soft.push('ลงขายของ');
    return { hard, soft, reconnecting };
  })()`;

  async function waitForProfileReadyAndHome(p, maxHomeWaitMs = 180000, epoch) {
    const checkBusy = async () => {
      const r = await evalProfilePort(p.debugPort, BUSY_CHECK_JS, 4500);
      return (r && r.success && r.result && typeof r.result === "object")
        ? {
            hard: Array.isArray(r.result.hard) ? r.result.hard : [],
            soft: Array.isArray(r.result.soft) ? r.result.soft : [],
            reconnecting: Boolean(r.result.reconnecting)
          }
        : { hard: ["จอไม่ตอบสนอง / ออฟไลน์"], soft: [], reconnecting: true };
    };

    let b = await checkBusy();
    for (let i = 0; i < 20 && (b.hard.length || b.soft.length); i++) {
      if (epoch !== actorAbortEpoch) throw new Error("ถูกยกเลิกโดยผู้ใช้");
      await sleep(1500);
      b = await checkBusy();
      if (i >= 3 && b.reconnecting) break;
      if (i >= 9 && b.soft.length > 0 && b.hard.length === 0) {
        await evalProfilePort(p.debugPort, `(() => {
          window.__isShopping = false; window.__isStoring = false; window.__isManualSelling = false; window.__isWeightScrollBusy = false;
          if (typeof window.closeShopUI === 'function') window.closeShopUI();
          if (typeof window.sendNpcClose === 'function') window.sendNpcClose();
          return true;
        })()`, 3500).catch(() => {});
        b.soft = [];
        break;
      }
    }
    if (b.hard.length > 0) {
      await evalProfilePort(p.debugPort, `(() => { window.__consolidationPending = false; return true; })()`, 3500).catch(() => {});
      throw new Error(`${p.name}: ติดสถานะ ${b.hard.join(", ")}`);
    }

    const liveBefore = await queryClientState(p.debugPort).catch(() => null);
    const wasBotRunning = Boolean(liveBefore && (liveBefore.isBotRunning || liveBefore.autoLoop));

    await evalProfilePort(p.debugPort, STOP_BOT_JS, 6000);
    await sleep(350);

    const triggerWing = () => evalProfilePort(p.debugPort, `(() => {
      window.__consolidationAborted = false;
      window.__isConsolidating = true;
      window.__isBotRunning = false;
      window.__autoLoopEnabled = false;
      if (typeof window.keepFarmMapForTrip === 'function') window.keepFarmMapForTrip();
      if (typeof window.isInCapital === 'function' && window.isInCapital()) return { success: true, already: true };
      if (typeof window.executeBwingHome === 'function') Promise.resolve(window.executeBwingHome(12000)).catch(() => {});
      else if (typeof window.useButterflyWing === 'function') window.useButterflyWing();
      else if (typeof window.goToCapital === 'function') window.goToCapital('รวมเงินข้ามเครื่อง', { allowDuringConsolidation: true });
      return { success: true };
    })()`, 6000);

    await triggerWing();
    await sleep(1800);
    if (epoch !== actorAbortEpoch) throw new Error("ถูกยกเลิกโดยผู้ใช้");

    const chBeforeRes = await evalProfilePort(p.debugPort, `window.getCurrentChannel ? window.getCurrentChannel() : null`, 4500);
    const homeChannel = (chBeforeRes && typeof chBeforeRes.result === "number") ? chBeforeRes.result : null;

    let homeRes = await evalProfilePort(p.debugPort, `(() => {
      window.__consolidationAborted = false;
      window.__isConsolidating = true;
      return window.ensureInCapital ? window.ensureInCapital(${Number(maxHomeWaitMs) || 180000}) : { success: true };
    })()`, (Number(maxHomeWaitMs) || 180000) + 10000);

    if (!(homeRes && homeRes.result && homeRes.result.success) && epoch === actorAbortEpoch) {
      await triggerWing();
      await sleep(1500);
      homeRes = await evalProfilePort(p.debugPort, `window.ensureInCapital ? window.ensureInCapital(120000) : { success: true }`, 130000);
    }
    if (!(homeRes && homeRes.result && homeRes.result.success)) {
      const errDetail = (homeRes && homeRes.result && homeRes.result.error) || (homeRes && homeRes.error) || "ไม่ทราบสาเหตุ";
      throw new Error(`${p.name} เดินทางกลับเมืองหลวงไม่สำเร็จ: ${errDetail}`);
    }

    return { wasBotRunning, homeChannel };
  }

  async function executeActorAction(action, payload = {}, job = null) {
    const epoch = actorAbortEpoch;
    const setStep = (s) => { if (job) job.step = s; };

    if (action === "prepare_master_receiver") {
      const profileId = String(payload.profileId || "").trim();
      const p = findOnlineProfileOrThrow(profileId);
      const lockId = acquireActorLock(p, "ตัวหลักรับเงินรวมทุกเครื่อง");
      try {
        await ensureClientConsolidationItemHelpers(p.debugPort, { tradeOnConsolidate: false, items: [] }).catch(() => {});
        setStep("เตรียมตัวหลักและวาร์ปกลับเมืองหลวงโซลเฮเวน...");
        const { wasBotRunning, homeChannel } = await waitForProfileReadyAndHome(p, 210000, epoch);
        if (epoch !== actorAbortEpoch) throw new Error("ถูกยกเลิกโดยผู้ใช้");

        setStep("ตัวหลักกำลังค้นหา Channel คนน้อยสุด...");
        const reserved = Array.isArray(payload.reservedChannels) ? payload.reservedChannels : [];
        const chFindRes = await evalProfilePort(p.debugPort, `(async () => {
          const reserved = ${JSON.stringify(reserved)};
          if (typeof window.getChannelsList === 'function') {
            const list = await window.getChannelsList(4000);
            if (Array.isArray(list) && list.length > 0) {
              const safe = list
                .filter(c => c && typeof c.channel === 'number' && c.channel > 0 && !c.locked && (c.players || 0) < ((c.maxPlayers || 80) - 5))
                .sort((a, b) => (a.players || 0) - (b.players || 0));
              const unreserved = safe.find(c => !reserved.includes(c.channel));
              if (unreserved) return unreserved.channel;
              if (safe[0]) return safe[0].channel;
            }
          }
          if (typeof window.findLeastPopulatedChannel === 'function') return await window.findLeastPopulatedChannel();
          return null;
        })()`, 6500);

        let targetChannel = (chFindRes && typeof chFindRes.result === "number" && chFindRes.result > 0) ? chFindRes.result : null;
        if (!targetChannel) {
          const curChRes = await evalProfilePort(p.debugPort, `window.getCurrentChannel ? window.getCurrentChannel() : 1`, 4500);
          targetChannel = (curChRes && typeof curChRes.result === "number" && curChRes.result > 0) ? curChRes.result : 1;
        }

        setStep(`ย้ายตัวหลักไป CH ${targetChannel}...`);
        await evalProfilePort(p.debugPort, `window.moveToChannel ? window.moveToChannel(${targetChannel}, 35000) : (window.switchChannel ? window.switchChannel(${targetChannel}) : null)`, 40000);
        await sleep(1200);

        const actualChRes = await evalProfilePort(p.debugPort, `window.getCurrentChannel ? window.getCurrentChannel() : null`, 4500);
        if (actualChRes && typeof actualChRes.result === "number" && actualChRes.result > 0) {
          targetChannel = actualChRes.result;
        }
        if (activeConsolidationChannels) activeConsolidationChannels.set(targetChannel, lockId);
        const taskObj = activeConsolidationTasks ? activeConsolidationTasks.get(lockId) : null;
        if (taskObj) {
          taskObj.targetChannel = targetChannel;
          taskObj.stepIndex = 3;
          if (typeof syncConsolidationGlobalState === "function") syncConsolidationGlobalState();
        }

        const posRes = await evalProfilePort(p.debugPort, `(() => {
          const r = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
          const me = r && r.state && r.state.players && r.state.players.get ? r.state.players.get(r.sessionId) : null;
          return me && Number.isFinite(me.x) && Number.isFinite(me.y) ? { x: Math.round(me.x), y: Math.round(me.y) } : { x: 1664, y: 1968 };
        })()`, 4500);
        const live = await queryClientState(p.debugPort).catch(() => null);
        const charName = String(live?.charName || p.lastCharName || p.name || "");
        const pos = (posRes && posRes.result && Number.isFinite(posRes.result.x)) ? posRes.result : { x: 1664, y: 1968 };

        actorLockedProfiles.set(p.id, { lockId, wasBotRunning, homeChannel, channel: targetChannel, isMaster: true });
        return {
          ok: true,
          profileId: p.id,
          charName,
          channel: targetChannel,
          homeChannel,
          wasBotRunning,
          pos,
          zeny: live && typeof live.zeny === "number" ? live.zeny : 0
        };
      } catch (err) {
        releaseActorLock(profileId);
        throw err;
      }
    }

    if (action === "sync_master_channel") {
      const profileId = String(payload.profileId || "").trim();
      const p = findOnlineProfileOrThrow(profileId);
      const targetChannel = Number(payload.targetChannel) || null;
      const walkToward = payload.walkTowardCharName ? String(payload.walkTowardCharName).trim() : "";

      if (targetChannel && targetChannel > 0) {
        await evalProfilePort(p.debugPort, `window.moveToChannel ? window.moveToChannel(${targetChannel}, 35000) : null`, 40000);
        await sleep(1200);
      }
      if (walkToward) {
        await evalProfilePort(p.debugPort, `(async () => {
          const want = ${JSON.stringify(walkToward)}.trim().toLowerCase();
          const room = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
          const players = room && room.state && room.state.players;
          const me = players && players.get ? players.get(room.sessionId) : null;
          let target = null;
          if (players && players.forEach) players.forEach(x => { if (!target && x && String(x.name || '').trim().toLowerCase() === want) target = x; });
          if (me && target) {
            const dist = Math.hypot((me.x || 0) - (target.x || 0), (me.y || 0) - (target.y || 0));
            if (dist > 80) {
              room.send('move_to', { x: target.x, y: target.y });
              await new Promise(r => setTimeout(r, 1800));
            }
          }
          return true;
        })()`, 4500).catch(() => {});
      }
      const [chRes, posRes] = await Promise.all([
        evalProfilePort(p.debugPort, `window.getCurrentChannel ? window.getCurrentChannel() : null`, 4500),
        evalProfilePort(p.debugPort, `(() => {
          const r = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
          const me = r && r.state && r.state.players && r.state.players.get ? r.state.players.get(r.sessionId) : null;
          return me && Number.isFinite(me.x) && Number.isFinite(me.y) ? { x: Math.round(me.x), y: Math.round(me.y) } : { x: 1664, y: 1968 };
        })()`, 4500)
      ]);
      return {
        ok: true,
        channel: (chRes && typeof chRes.result === "number" && chRes.result > 0) ? chRes.result : targetChannel,
        pos: (posRes && posRes.result && Number.isFinite(posRes.result.x)) ? posRes.result : { x: 1664, y: 1968 }
      };
    }

    if (action === "arm_master_watcher") {
      const profileId = String(payload.profileId || "").trim();
      const expectedSender = String(payload.expectedSenderCharName || "").trim();
      const timeoutMs = Number(payload.timeoutMs) || 45000;
      const p = findOnlineProfileOrThrow(profileId);
      await ensureClientConsolidationItemHelpers(p.debugPort, { tradeOnConsolidate: false, items: [] }).catch(() => {});
      await evalProfilePort(p.debugPort, `(() => {
        if (typeof window.setupReceiverTradeWatcher === 'function') {
          Promise.resolve(window.setupReceiverTradeWatcher(${JSON.stringify(expectedSender)}, ${timeoutMs})).catch(() => {});
        }
        return { success: true };
      })()`, 5000);
      return { ok: true };
    }

    if (action === "stop_master_watcher") {
      const profileId = String(payload.profileId || "").trim();
      const profiles = typeof loadProfiles === "function" ? loadProfiles() : [];
      const p = profiles.find(x => x.id === profileId);
      if (p && p.debugPort) {
        await evalProfilePort(p.debugPort, `window.stopReceiverTradeWatcher ? window.stopReceiverTradeWatcher() : null`, 3500).catch(() => {});
      }
      return { ok: true };
    }

    if (action === "prepare_sender") {
      const profileId = String(payload.profileId || "").trim();
      const p = findOnlineProfileOrThrow(profileId);
      const lockId = acquireActorLock(p, "ตัวส่งเงินข้ามเครื่อง");
      try {
        await ensureClientConsolidationItemHelpers(p.debugPort, { tradeOnConsolidate: false, items: [] }).catch(() => {});
        setStep(`หยุดบอทและวาร์ป ${p.name} กลับเมืองหลวง...`);
        const { wasBotRunning, homeChannel } = await waitForProfileReadyAndHome(p, 180000, epoch);
        if (epoch !== actorAbortEpoch) throw new Error("ถูกยกเลิกโดยผู้ใช้");

        const targetChannel = Number(payload.targetChannel) || null;
        const receiverCharName = String(payload.receiverCharName || "").trim();
        const receiverPos = (payload.receiverPos && Number.isFinite(payload.receiverPos.x)) ? payload.receiverPos : { x: 1664, y: 1968 };

        if (targetChannel && targetChannel > 0) {
          setStep(`ย้าย ${p.name} ไป CH ${targetChannel}...`);
          const mv = await evalProfilePort(p.debugPort, `window.moveToChannel ? window.moveToChannel(${targetChannel}, 38000) : (window.switchChannel ? window.switchChannel(${targetChannel}) : null)`, 42000);
          if (mv && mv.result && mv.result.success && receiverCharName) {
            await sleep(900);
            await evalProfilePort(p.debugPort, `(async () => {
              if (typeof window.closeShopUI === 'function') window.closeShopUI();
              if (typeof window.sendNpcClose === 'function') window.sendNpcClose();
              const want = ${JSON.stringify(receiverCharName)}.trim().toLowerCase();
              const hintX = ${Number(receiverPos.x)}, hintY = ${Number(receiverPos.y)}, nearPx = 92, maxMs = 9000;
              const start = Date.now();
              let lastSend = 0;
              while (Date.now() - start < maxMs) {
                const room = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
                const players = room && room.state && room.state.players;
                const me = players && players.get ? players.get(room.sessionId) : null;
                let target = null;
                if (players && players.forEach) players.forEach(x => { if (!target && x && String(x.name || '').trim().toLowerCase() === want) target = x; });
                if (me && target) {
                  const dist = Math.hypot((me.x || 0) - (target.x || 0), (me.y || 0) - (target.y || 0));
                  if (dist <= nearPx) return { success: true };
                  if (Date.now() - lastSend > 1800) { lastSend = Date.now(); room.send('move_to', { x: target.x, y: target.y }); }
                } else if (me) {
                  const distHint = Math.hypot((me.x || 0) - hintX, (me.y || 0) - hintY);
                  if (distHint <= nearPx) return { success: true };
                  if (Date.now() - lastSend > 1800) { lastSend = Date.now(); room.send('move_to', { x: hintX, y: hintY }); }
                }
                await new Promise(r => setTimeout(r, 400));
              }
              return { success: true };
            })()`, 12000).catch(() => {});
          }
        }

        const live = await queryClientState(p.debugPort).catch(() => null);
        const curChRes = await evalProfilePort(p.debugPort, `window.getCurrentChannel ? window.getCurrentChannel() : null`, 4500);
        const currentChannel = (curChRes && typeof curChRes.result === "number" && curChRes.result > 0) ? curChRes.result : null;
        const charName = String(live?.charName || p.lastCharName || p.name || "");
        const zeny = live && typeof live.zeny === "number" ? Math.max(0, Math.floor(live.zeny)) : 0;

        actorLockedProfiles.set(p.id, { lockId, wasBotRunning, homeChannel, channel: currentChannel });
        return { ok: true, profileId: p.id, charName, zeny, homeChannel, currentChannel, wasBotRunning };
      } catch (err) {
        releaseActorLock(profileId);
        throw err;
      }
    }

    if (action === "align_sender_to_receiver") {
      const profileId = String(payload.profileId || "").trim();
      const targetChannel = Number(payload.targetChannel) || null;
      const receiverCharName = String(payload.receiverCharName || "").trim();
      const receiverPos = (payload.receiverPos && Number.isFinite(payload.receiverPos.x)) ? payload.receiverPos : { x: 1664, y: 1968 };
      const p = findOnlineProfileOrThrow(profileId);

      await evalProfilePort(p.debugPort, `window.ensureInCapital ? window.ensureInCapital(40000) : { success: true }`, 45000);
      let curChRes = await evalProfilePort(p.debugPort, `window.getCurrentChannel ? window.getCurrentChannel() : null`, 4500);
      let sCh = (curChRes && typeof curChRes.result === "number" && curChRes.result > 0) ? curChRes.result : null;
      if (targetChannel && sCh !== targetChannel) {
        await evalProfilePort(p.debugPort, `window.moveToChannel ? window.moveToChannel(${targetChannel}, 35000) : null`, 40000);
        await sleep(900);
        curChRes = await evalProfilePort(p.debugPort, `window.getCurrentChannel ? window.getCurrentChannel() : null`, 4500);
        sCh = (curChRes && typeof curChRes.result === "number" && curChRes.result > 0) ? curChRes.result : sCh;
      }

      if (targetChannel && sCh && sCh !== targetChannel) {
        return {
          ok: true,
          channelMismatch: true,
          channel: sCh,
          inRange: false,
          distance: 9999
        };
      }

      const walkRes = await evalProfilePort(p.debugPort, `(async () => {
        if (typeof window.closeShopUI === 'function') window.closeShopUI();
        if (typeof window.sendNpcClose === 'function') window.sendNpcClose();
        const want = ${JSON.stringify(receiverCharName)}.trim().toLowerCase();
        const hintX = ${Number(receiverPos.x)}, hintY = ${Number(receiverPos.y)}, nearPx = 88, maxMs = 14000;
        const start = Date.now();
        let lastSend = 0, seen = false, lastDist = 9999;
        while (Date.now() - start < maxMs) {
          const room = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
          const players = room && room.state && room.state.players;
          const me = players && players.get ? players.get(room.sessionId) : null;
          let target = null;
          if (players && players.forEach) players.forEach(x => { if (!target && x && String(x.name || '').trim().toLowerCase() === want) target = x; });
          if (me && target) {
            seen = true;
            const dist = Math.hypot((me.x || 0) - (target.x || 0), (me.y || 0) - (target.y || 0));
            lastDist = Math.round(dist);
            if (dist <= nearPx) return { success: true, distance: lastDist, seen: true };
            if (Date.now() - lastSend > 1500) { lastSend = Date.now(); room.send('move_to', { x: target.x, y: target.y }); }
          } else if (me) {
            const distHint = Math.hypot((me.x || 0) - hintX, (me.y || 0) - hintY);
            lastDist = Math.round(distHint);
            if (Date.now() - lastSend > 1500) { lastSend = Date.now(); room.send('move_to', { x: hintX, y: hintY }); }
          }
          await new Promise(r => setTimeout(r, 350));
        }
        return { success: false, seen, distance: lastDist };
      })()`, 17000);

      const live = await queryClientState(p.debugPort).catch(() => null);
      return {
        ok: true,
        channelMismatch: false,
        channel: sCh,
        inRange: Boolean(walkRes && walkRes.result && walkRes.result.success),
        seen: Boolean(walkRes && walkRes.result && walkRes.result.seen),
        distance: Number(walkRes?.result?.distance ?? 9999),
        zeny: live && typeof live.zeny === "number" ? Math.max(0, Math.floor(live.zeny)) : null,
        charName: String(live?.charName || p.lastCharName || p.name || "")
      };
    }

    if (action === "execute_sender_trade") {
      const profileId = String(payload.profileId || "").trim();
      const receiverCharName = String(payload.receiverCharName || "").trim();
      const zenyAmount = Math.max(0, Math.floor(Number(payload.zenyAmount) || 0));
      const timeoutMs = Number(payload.timeoutMs) || 38000;
      const p = findOnlineProfileOrThrow(profileId);

      await ensureClientConsolidationItemHelpers(p.debugPort, { tradeOnConsolidate: false, items: [] }).catch(() => {});
      const before = await queryClientState(p.debugPort).catch(() => null);
      const zenyBefore = (before && typeof before.zeny === "number") ? before.zeny : null;

      const tradeRes = await evalProfilePort(p.debugPort, `(async () => {
        if (typeof window.executeSenderTrade === 'function') {
          return await window.executeSenderTrade(${JSON.stringify(receiverCharName)}, ${zenyAmount}, ${timeoutMs}, null, null);
        }
        return { success: false, error: 'No executeSenderTrade function' };
      })()`, timeoutMs + 6000);

      await sleep(1200);
      const after = await queryClientState(p.debugPort).catch(() => null);
      const zenyAfter = (after && typeof after.zeny === "number") ? after.zeny : null;

      let movedZeny = 0;
      if (zenyBefore !== null && zenyAfter !== null) {
        movedZeny = Math.max(0, zenyBefore - zenyAfter);
      } else if (tradeRes && tradeRes.result && tradeRes.result.success) {
        movedZeny = Number(tradeRes.result.transferredZeny) || zenyAmount;
      }
      const errMsg = tradeRes?.result?.error || tradeRes?.error || "";
      return {
        ok: movedZeny > 0,
        movedZeny,
        zenyBefore,
        zenyAfter,
        error: movedZeny > 0 ? null : (errMsg || "เงินไม่ลด (เทรดไม่สำเร็จ)")
      };
    }

    if (action === "release_actor") {
      const profileId = String(payload.profileId || "").trim();
      const resumeBot = Boolean(payload.resumeBot);
      const restoreChannel = Number(payload.restoreChannel) || null;
      const currentChannel = Number(payload.currentChannel) || null;
      const profiles = typeof loadProfiles === "function" ? loadProfiles() : [];
      const p = profiles.find(x => x.id === profileId);

      releaseActorLock(profileId);
      if (p && p.debugPort) {
        if (resumeBot) {
          await evalProfilePort(p.debugPort, START_BOT_JS, 5000).catch(() => {});
          if (restoreChannel && currentChannel && restoreChannel !== currentChannel) {
            setTimeout(() => {
              evalProfilePort(p.debugPort, `(() => {
                if (!window.__isConsolidating && typeof window.isInCapital === 'function' && !window.isInCapital() && typeof window.moveToChannel === 'function') {
                  window.moveToChannel(${restoreChannel}, 25000);
                }
              })()`, 4000).catch(() => {});
            }, 12000);
          }
        } else {
          await evalProfilePort(p.debugPort, CLEAR_FLAGS_JS, 4500).catch(() => {});
        }
      }
      return { ok: true, released: profileId, resumeBot };
    }

    throw new Error(`Unsupported fleet actor action: ${action}`);
  }

  function startActorJob(action, payload = {}) {
    pruneOldActorJobs();
    const jobId = `fjob_${++actorJobSeq}_${Date.now()}`;
    const job = {
      jobId,
      action: String(action || ""),
      status: "running",
      step: "",
      result: null,
      error: null,
      startedAt: Date.now(),
      finishedAt: 0
    };
    actorJobs.set(jobId, job);

    executeActorAction(action, payload, job)
      .then((res) => {
        job.status = "done";
        job.result = res;
        job.finishedAt = Date.now();
      })
      .catch((err) => {
        job.status = "error";
        job.error = err?.message || String(err);
        job.finishedAt = Date.now();
      });

    return jobId;
  }

  async function abortAllLocalActorJobs() {
    actorAbortEpoch++;
    const lockedIds = Array.from(actorLockedProfiles.keys());
    const profiles = typeof loadProfiles === "function" ? loadProfiles() : [];
    for (const pid of lockedIds) {
      const p = profiles.find(x => x.id === pid);
      releaseActorLock(pid);
      if (p && p.debugPort) {
        evalProfilePort(p.debugPort, CLEAR_FLAGS_JS, 3500).catch(() => {});
      }
    }
    if (activeConsolidationProfiles) {
      for (const [pid, tid] of Array.from(activeConsolidationProfiles.entries())) {
        if (String(tid).startsWith("fleet_actor_")) {
          releaseActorLock(pid);
        }
      }
    }
    for (const job of actorJobs.values()) {
      if (job.status === "running") {
        job.status = "error";
        job.error = "ผู้ใช้สั่งยกเลิกการรวมเงิน";
        job.finishedAt = Date.now();
      }
    }
    return { abortedCount: lockedIds.length };
  }

  // =========================================================================
  // CROSS-MACHINE ORCHESTRATOR (runs on the initiating Manager)
  // =========================================================================
  let orchestratorAborted = false;
  let orchestratorState = {
    running: false,
    status: "idle", // 'idle' | 'running' | 'completed' | 'stopped' | 'error'
    mode: "ring_first", // 'ring_first' | 'threshold'
    phase: "",
    stepIndex: 0,
    totalSteps: 4,
    step: "พร้อมรวมเงินข้ามทุกเครื่อง",
    masterReceiver: null,
    currentSender: null,
    completedSenders: [],
    totalSenders: 0,
    stage1TransferredZeny: 0,
    stage2TransferredZeny: 0,
    totalTransferredZeny: 0,
    logs: [],
    startTime: 0,
    endTime: 0
  };

  function addOrchestratorLog(text, level = "info") {
    const time = new Date().toLocaleTimeString("th-TH");
    orchestratorState.logs.push({ time, text, level });
    if (orchestratorState.logs.length > 400) orchestratorState.logs.shift();
  }

  async function getFleetMachinesSafe() {
    if (remoteFleet && typeof remoteFleet.listMachinesWithLocal === "function") {
      try {
        const res = await remoteFleet.listMachinesWithLocal(true);
        if (res && Array.isArray(res.machines) && res.machines.length > 0) {
          return res.machines;
        }
      } catch (e) {
        if (e && e.code !== "USER_ACCOUNT_REQUIRED" && e.status !== 401) {
          // fall through to local machine only if network hiccupped
        }
      }
    }
    const myKey = (humanCheckSolver && typeof humanCheckSolver.getMachineHwidShort === "function")
      ? humanCheckSolver.getMachineHwidShort()
      : "__local__";
    const localNick = typeof getEffectiveDeviceNickname === "function"
      ? getEffectiveDeviceNickname()
      : (os && typeof os.hostname === "function" ? os.hostname() : "เครื่องปัจจุบัน");
    return [{
      machineKey: myKey || "__local__",
      hwidCode: myKey || "----",
      deviceName: localNick,
      hostname: os && typeof os.hostname === "function" ? os.hostname() : "",
      managerVersion,
      isOnline: true,
      remoteReady: true,
      isCurrentMachine: true
    }];
  }

  async function fetchSingleMachineSnapshot(m) {
    const key = String(m.machineKey || "__local__");
    const online = Boolean(m.isCurrentMachine || (m.isOnline && m.remoteReady));
    if (!online) {
      return {
        machineKey: key,
        hwidCode: m.hwidCode || key,
        deviceName: m.deviceName || m.hostname || key,
        isCurrentMachine: Boolean(m.isCurrentMachine),
        isOnline: false,
        remoteReady: Boolean(m.remoteReady),
        actorReady: false,
        managerVersion: m.managerVersion || null,
        profiles: [],
        consolidation: null,
        error: m.legacyOnly ? "เวอร์ชันเก่า" : "เครื่องออฟไลน์"
      };
    }

    if (m.isCurrentMachine) {
      const snap = await buildLocalSnapshot();
      return {
        machineKey: key,
        hwidCode: m.hwidCode || snap.machineKey || key,
        deviceName: m.deviceName || snap.deviceName || key,
        isCurrentMachine: true,
        isOnline: true,
        remoteReady: true,
        actorReady: true,
        managerVersion: snap.managerVersion || managerVersion,
        profiles: snap.profiles,
        consolidation: snap.consolidation,
        error: null
      };
    }

    // Remote machine: try new fleet-actor/snapshot first
    try {
      const snapRes = await remoteFleet.requestMachineJson(key, "GET", "/api/consolidation/fleet-actor/snapshot", null, 18000);
      if (snapRes.ok && snapRes.data && snapRes.data.success === true && snapRes.data.actorReady === true) {
        return {
          machineKey: key,
          hwidCode: m.hwidCode || key,
          deviceName: m.deviceName || snapRes.data.deviceName || key,
          isCurrentMachine: false,
          isOnline: true,
          remoteReady: true,
          actorReady: true,
          managerVersion: snapRes.data.managerVersion || m.managerVersion || null,
          profiles: Array.isArray(snapRes.data.profiles) ? snapRes.data.profiles : [],
          consolidation: snapRes.data.consolidation || null,
          error: null
        };
      }

      // Legacy fallback: GET /api/profiles + GET /api/consolidation/status
      const [profRes, stRes] = await Promise.all([
        remoteFleet.requestMachineJson(key, "GET", "/api/profiles", null, 18000),
        remoteFleet.requestMachineJson(key, "GET", "/api/consolidation/status", null, 10000).catch(() => ({ ok: false, data: null }))
      ]);
      if (profRes.ok && Array.isArray(profRes.data)) {
        return {
          machineKey: key,
          hwidCode: m.hwidCode || key,
          deviceName: m.deviceName || key,
          isCurrentMachine: false,
          isOnline: true,
          remoteReady: true,
          actorReady: false,
          managerVersion: m.managerVersion || null,
          profiles: profRes.data,
          consolidation: (stRes && stRes.ok && stRes.data && stRes.data.success) ? stRes.data : null,
          error: null
        };
      }
      return {
        machineKey: key,
        hwidCode: m.hwidCode || key,
        deviceName: m.deviceName || key,
        isCurrentMachine: false,
        isOnline: true,
        remoteReady: true,
        actorReady: false,
        managerVersion: m.managerVersion || null,
        profiles: [],
        consolidation: null,
        error: (profRes.data && profRes.data.error) || `โหลดข้อมูลเครื่องไม่สำเร็จ (${profRes.status})`
      };
    } catch (e) {
      return {
        machineKey: key,
        hwidCode: m.hwidCode || key,
        deviceName: m.deviceName || key,
        isCurrentMachine: false,
        isOnline: true,
        remoteReady: true,
        actorReady: false,
        managerVersion: m.managerVersion || null,
        profiles: [],
        consolidation: null,
        error: e?.message || "เชื่อมต่อเครื่องเป้าหมายไม่สำเร็จ"
      };
    }
  }

  async function buildOverview(overrideCfg = null) {
    const baseCfg = loadConfig();
    const cfg = overrideCfg ? {
      ...baseCfg,
      ...overrideCfg,
      ringReceivers: {
        ...baseCfg.ringReceivers,
        ...(overrideCfg.ringReceivers && typeof overrideCfg.ringReceivers === "object" ? overrideCfg.ringReceivers : {})
      }
    } : baseCfg;

    const rawMachines = await getFleetMachinesSafe();
    const sortedMachines = rawMachines.slice().sort((a, b) => {
      if (Boolean(a.isCurrentMachine) !== Boolean(b.isCurrentMachine)) return a.isCurrentMachine ? -1 : 1;
      if (Boolean(a.isOnline) !== Boolean(b.isOnline)) return a.isOnline ? -1 : 1;
      return String(a.deviceName || a.machineKey || "").localeCompare(String(b.deviceName || b.machineKey || ""));
    });

    const snapshots = await Promise.all(sortedMachines.map(fetchSingleMachineSnapshot));

    // Resolve or auto-pick a valid Master Receiver
    const allOnlineVips = [];
    for (const snap of snapshots) {
      for (const p of snap.profiles) {
        const hasPrem = computeProfilePremium(p);
        if (p.isRunning && hasPrem) {
          allOnlineVips.push({
            machineKey: snap.machineKey,
            deviceName: snap.deviceName,
            isCurrentMachine: snap.isCurrentMachine,
            actorReady: snap.actorReady,
            id: String(p.id),
            compositeKey: makeCompositeKey(snap.machineKey, p.id),
            name: String(p.name || p.charName || p.id),
            charName: String(p.charName || p.liveState?.charName || p.lastCharName || p.name || ""),
            zeny: computeProfileZeny(p),
            ip: getProfileIpFromObject(p),
            isMain: Boolean(p.isMain)
          });
        }
      }
    }

    let effectiveMasterKey = cfg.masterReceiverKey;
    if (!effectiveMasterKey || !allOnlineVips.some(v => v.compositeKey === effectiveMasterKey)) {
      const preferred =
        allOnlineVips.find(v => v.isCurrentMachine && v.isMain)
        || allOnlineVips.find(v => v.isMain)
        || allOnlineVips.find(v => v.isCurrentMachine)
        || allOnlineVips[0]
        || null;
      effectiveMasterKey = preferred ? preferred.compositeKey : "";
    }
    const effectiveCfg = { ...cfg, masterReceiverKey: effectiveMasterKey };
    const masterVip = allOnlineVips.find(v => v.compositeKey === effectiveMasterKey) || null;

    let totalOnlineZenyAll = 0;
    let totalIpRings = 0;
    let totalEstimatedTransferZeny = 0;
    let totalEstimatedSendersCount = 0;

    const machinesOut = snapshots.map((snap, idx) => {
      const ipGroups = buildIpGroupsForMachine(
        snap.machineKey,
        snap.profiles,
        effectiveCfg,
        effectiveMasterKey,
        snap.consolidation
      );
      const machineOnlineZeny = snap.profiles.reduce(
        (sum, p) => sum + (p.isRunning ? computeProfileZeny(p) : 0),
        0
      );
      const machineOnlineCount = snap.profiles.filter(p => p.isRunning).length;
      const machineOnlineVipCount = snap.profiles.filter(p => p.isRunning && computeProfilePremium(p)).length;

      totalOnlineZenyAll += machineOnlineZeny;
      totalIpRings += ipGroups.length;

      if (effectiveCfg.ringFirst) {
        const ringStage1Sum = ipGroups.reduce((s, g) => s + g.ringTransferableZeny, 0);
        const stage2FromNonMasterRings = ipGroups.reduce((s, g) => s + g.stage2TransferZeny, 0);
        // Each machine's Stage 1 + Stage 2 total arriving at Master Receiver (excluding Master's own starting money)
        const masterZenyInMachine = (masterVip && masterVip.machineKey === snap.machineKey) ? masterVip.zeny : 0;
        const machineTotalGoingToMaster = masterVip && masterVip.machineKey === snap.machineKey
          ? stage2FromNonMasterRings + (ipGroups.find(g => g.isMasterRing)?.ringTransferableZeny || 0)
          : stage2FromNonMasterRings;
        totalEstimatedTransferZeny += Math.max(0, machineTotalGoingToMaster);
        const readyRingReceivers = ipGroups.filter(g => !g.isMasterRing && g.stage2TransferZeny > 0).length;
        const intraMasterRingSenders = (ipGroups.find(g => g.isMasterRing)?.ringSenderCount) || 0;
        totalEstimatedSendersCount += readyRingReceivers + intraMasterRingSenders;
        void ringStage1Sum;
        void masterZenyInMachine;
      } else {
        for (const g of ipGroups) {
          totalEstimatedTransferZeny += g.thresholdTransferableZeny;
          totalEstimatedSendersCount += g.thresholdQualifiedCount;
        }
      }

      return {
        machineIndex: idx + 1,
        machineKey: snap.machineKey,
        hwidCode: snap.hwidCode,
        deviceName: snap.deviceName,
        isCurrentMachine: snap.isCurrentMachine,
        isOnline: snap.isOnline,
        remoteReady: snap.remoteReady,
        actorReady: snap.actorReady,
        managerVersion: snap.managerVersion,
        error: snap.error,
        totalProfiles: snap.profiles.length,
        onlineCount: machineOnlineCount,
        onlineVipCount: machineOnlineVipCount,
        onlineZeny: machineOnlineZeny,
        ipGroupsCount: ipGroups.length,
        ipGroups,
        consolidationRunning: Boolean(snap.consolidation && snap.consolidation.running)
      };
    });

    const masterOptionsByMachine = snapshots
      .filter(s => s.isOnline && s.profiles.length > 0)
      .map((s, idx) => ({
        machineIndex: idx + 1,
        machineKey: s.machineKey,
        deviceName: s.deviceName,
        isCurrentMachine: s.isCurrentMachine,
        actorReady: s.actorReady,
        candidates: s.profiles
          .filter(p => p.isRunning && computeProfilePremium(p))
          .map(p => ({
            compositeKey: makeCompositeKey(s.machineKey, p.id),
            id: String(p.id),
            name: String(p.name || p.id),
            charName: String(p.charName || p.liveState?.charName || p.lastCharName || p.name || ""),
            zeny: computeProfileZeny(p),
            ip: getProfileIpFromObject(p),
            isMain: Boolean(p.isMain)
          }))
      }))
      .filter(m => m.candidates.length > 0);

    return {
      success: true,
      config: effectiveCfg,
      summary: {
        totalMachines: machinesOut.length,
        onlineMachines: machinesOut.filter(m => m.isOnline).length,
        totalIpRings,
        totalOnlineZeny: totalOnlineZenyAll,
        estimatedTransferZeny: totalEstimatedTransferZeny,
        estimatedSendersCount: totalEstimatedSendersCount
      },
      masterOptionsByMachine,
      machines: machinesOut,
      state: orchestratorState
    };
  }

  async function callMachineActorJob(machineKey, action, payload = {}, maxWaitMs = 240000) {
    const startRes = await remoteFleet.requestMachineJson(
      machineKey,
      "POST",
      "/api/consolidation/fleet-actor/start-job",
      { action, payload },
      15000
    );
    if (!startRes.ok || !startRes.data || !startRes.data.success || !startRes.data.jobId) {
      throw new Error((startRes.data && startRes.data.error) || `สั่งงานเครื่อง ${machineKey} (${action}) ไม่สำเร็จ`);
    }
    const jobId = startRes.data.jobId;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      if (orchestratorAborted && action !== "release_actor" && action !== "stop_master_watcher") {
        throw new Error("ผู้ใช้สั่งยกเลิกการรวมเงิน");
      }
      await sleep(pollIntervalMs);
      const stRes = await remoteFleet.requestMachineJson(
        machineKey,
        "GET",
        `/api/consolidation/fleet-actor/job-status?jobId=${encodeURIComponent(jobId)}`,
        null,
        12000
      );
      if (stRes.ok && stRes.data && stRes.data.job) {
        const job = stRes.data.job;
        if (job.status === "done") return job.result || {};
        if (job.status === "error") throw new Error(job.error || `งาน ${action} ล้มเหลว`);
      }
    }
    throw new Error(`หมดเวลารอผลลัพธ์ (${action}) จากเครื่อง ${machineKey}`);
  }

  async function transferSendersAcrossMachinesToMaster(masterInfo, senderList, cfg) {
    const keepZeny = clampInt(cfg.keepZeny, 0, 0);
    const roundHundredK = Boolean(cfg.roundHundredK);
    const participatingMachines = new Set([masterInfo.machineKey]);
    for (const s of senderList) participatingMachines.add(s.machineKey);

    if (senderList.length === 0) {
      addOrchestratorLog("ℹ️ ไม่มีจอผู้ส่งข้ามเครื่อง/ข้ามวงเพิ่มเติมที่ต้องโอนเข้าตัวหลักในรอบนี้", "info");
      return 0;
    }

    orchestratorState.totalSenders = senderList.length;
    orchestratorState.completedSenders = [];
    orchestratorState.step = `กำลังเตรียมตัวหลัก [${masterInfo.charName}] (${masterInfo.deviceName}) วาร์ปกลับเมืองหลวง...`;
    addOrchestratorLog(
      `👑 เตรียมตัวหลัก [${masterInfo.charName}] (เครื่อง: ${masterInfo.deviceName}) ประจำจุดรับเงินที่เมืองหลวงโซลเฮเวน...`,
      "info"
    );

    const masterPrep = await callMachineActorJob(masterInfo.machineKey, "prepare_master_receiver", {
      profileId: masterInfo.id,
      reservedChannels: []
    }, 240000);

    let masterChannel = masterPrep.channel || 1;
    let masterPos = masterPrep.pos || { x: 1664, y: 1968 };
    const masterCharName = masterPrep.charName || masterInfo.charName;
    const masterWasBotRunning = Boolean(masterPrep.wasBotRunning);

    addOrchestratorLog(
      `📍 ตัวหลัก [${masterCharName}] พร้อมรับเงินที่เมืองหลวง CH ${masterChannel} (${senderList.length} จอคิวโอน)`,
      "success"
    );

    const prepMap = new Map();
    const startPrep = (s) => {
      if (!s || prepMap.has(s.compositeKey) || orchestratorAborted) return;
      prepMap.set(s.compositeKey, callMachineActorJob(s.machineKey, "prepare_sender", {
        profileId: s.id,
        targetChannel: masterChannel,
        receiverCharName: masterCharName,
        receiverPos: masterPos
      }, 220000).catch(err => ({ ok: false, error: err?.message || String(err) })));
    };

    const SENDER_SLOTS = 2;
    const releasedKeys = new Set();
    let totalMoved = 0;

    try {
      senderList.slice(0, SENDER_SLOTS).forEach(startPrep);

      for (let i = 0; i < senderList.length; i++) {
        if (orchestratorAborted) throw new Error("ผู้ใช้สั่งยกเลิกการรวมเงิน");
        const sender = senderList[i];
        orchestratorState.currentSender = `${sender.deviceName} · ${sender.charName}`;
        orchestratorState.step = `กำลังโอน (${i + 1}/${senderList.length}): [${sender.charName}] (${sender.deviceName}) ➜ [${masterCharName}]`;
        addOrchestratorLog(`----------------------------------------`, "info");
        addOrchestratorLog(`▶️ คิวที่ ${i + 1}/${senderList.length}: [${sender.charName}] (${sender.deviceName} · ${sender.ip})`, "info");

        startPrep(sender);
        const prep = await prepMap.get(sender.compositeKey);
        if (orchestratorAborted) throw new Error("ผู้ใช้สั่งยกเลิกการรวมเงิน");

        if (!prep || !prep.ok) {
          addOrchestratorLog(`⚠️ ข้าม [${sender.charName}]: ${(prep && prep.error) || "เตรียมตัวไม่สำเร็จ"}`, "error");
          await callMachineActorJob(sender.machineKey, "release_actor", {
            profileId: sender.id,
            resumeBot: Boolean(prep?.wasBotRunning),
            restoreChannel: prep?.homeChannel || null,
            currentChannel: prep?.currentChannel || null
          }, 20000).catch(() => {});
          releasedKeys.add(sender.compositeKey);
          startPrep(senderList[i + SENDER_SLOTS]);
          continue;
        }

        const senderCharName = prep.charName || sender.charName;
        const senderZeny = (typeof prep.zeny === "number") ? prep.zeny : sender.zeny;
        const zenyToTransfer = calcTransferZeny(senderZeny, keepZeny, roundHundredK);
        if (zenyToTransfer <= 0) {
          addOrchestratorLog(`⏭️ [${senderCharName}] มีเงิน ${senderZeny.toLocaleString()} z ไม่เกินยอดเก็บติดตัว -> ข้าม`, "warning");
          orchestratorState.completedSenders.push(sender.compositeKey);
          await callMachineActorJob(sender.machineKey, "release_actor", {
            profileId: sender.id,
            resumeBot: Boolean(prep.wasBotRunning),
            restoreChannel: prep.homeChannel || null,
            currentChannel: prep.currentChannel || null
          }, 20000).catch(() => {});
          releasedKeys.add(sender.compositeKey);
          startPrep(senderList[i + SENDER_SLOTS]);
          continue;
        }

        let attempt = 0;
        let movedZeny = 0;
        let lastErr = "";
        let lastSenderCh = prep.currentChannel || masterChannel;

        while (attempt < 2 && movedZeny <= 0) {
          attempt++;
          if (orchestratorAborted) throw new Error("ผู้ใช้สั่งยกเลิกการรวมเงิน");

          // 1. Align sender to master's channel & coordinates
          let alignRes = await callMachineActorJob(sender.machineKey, "align_sender_to_receiver", {
            profileId: sender.id,
            targetChannel: masterChannel,
            receiverCharName: masterCharName,
            receiverPos: masterPos
          }, 60000);

          if (alignRes && alignRes.channelMismatch && alignRes.channel) {
            lastSenderCh = alignRes.channel;
            addOrchestratorLog(
              `🔄 [${senderCharName}] เข้า CH ${masterChannel} ไม่ได้ -> สั่งตัวหลัก [${masterCharName}] ย้ายมาที่ CH ${lastSenderCh} แทน`,
              "warning"
            );
            const syncRes = await callMachineActorJob(masterInfo.machineKey, "sync_master_channel", {
              profileId: masterInfo.id,
              targetChannel: lastSenderCh
            }, 50000);
            masterChannel = syncRes.channel || lastSenderCh;
            masterPos = syncRes.pos || masterPos;
            alignRes = await callMachineActorJob(sender.machineKey, "align_sender_to_receiver", {
              profileId: sender.id,
              targetChannel: masterChannel,
              receiverCharName: masterCharName,
              receiverPos: masterPos
            }, 60000);
          }

          if (alignRes && alignRes.channel) lastSenderCh = alignRes.channel;

          if (alignRes && !alignRes.inRange) {
            await callMachineActorJob(masterInfo.machineKey, "sync_master_channel", {
              profileId: masterInfo.id,
              walkTowardCharName: senderCharName
            }, 15000).catch(() => {});
          }

          // 2. Arm watcher on Master Receiver's machine
          await callMachineActorJob(masterInfo.machineKey, "arm_master_watcher", {
            profileId: masterInfo.id,
            expectedSenderCharName: senderCharName,
            timeoutMs: 45000
          }, 15000);

          await sleep(350);

          // 3. Execute sender trade on Sender's machine
          addOrchestratorLog(
            `📤 [${senderCharName}] ส่งคำขอเทรดเงิน ${zenyToTransfer.toLocaleString()} z ให้ [${masterCharName}]${attempt > 1 ? " (ลองใหม่)" : ""}...`,
            "info"
          );
          const tradeRes = await callMachineActorJob(sender.machineKey, "execute_sender_trade", {
            profileId: sender.id,
            receiverCharName: masterCharName,
            zenyAmount: zenyToTransfer,
            timeoutMs: 38000
          }, 55000);

          await callMachineActorJob(masterInfo.machineKey, "stop_master_watcher", {
            profileId: masterInfo.id
          }, 10000).catch(() => {});

          movedZeny = Number(tradeRes?.movedZeny) || 0;
          lastErr = tradeRes?.error || "";
          if (movedZeny > 0) break;
          if (attempt < 2) {
            addOrchestratorLog(`⚠️ เทรดไม่สำเร็จ (${lastErr}) — จัดตำแหน่งแล้วลองใหม่อีก 1 ครั้ง`, "warning");
            await sleep(1800);
          }
        }

        if (movedZeny > 0) {
          totalMoved += movedZeny;
          orchestratorState.stage2TransferredZeny += movedZeny;
          orchestratorState.totalTransferredZeny += movedZeny;
          orchestratorState.completedSenders.push(sender.compositeKey);
          addOrchestratorLog(`✅ โอนจาก [${senderCharName}] ➜ [${masterCharName}] สำเร็จ: +${movedZeny.toLocaleString()} z`, "success");
        } else {
          addOrchestratorLog(`❌ [${senderCharName}] โอนไม่สำเร็จ: ${lastErr || "เงินไม่ลด"} — ข้ามไปจอถัดไป`, "error");
        }

        // Release sender immediately so it returns to farm right away
        await callMachineActorJob(sender.machineKey, "release_actor", {
          profileId: sender.id,
          resumeBot: Boolean(prep.wasBotRunning),
          restoreChannel: prep.homeChannel || null,
          currentChannel: lastSenderCh || null
        }, 20000).catch(() => {});
        releasedKeys.add(sender.compositeKey);

        startPrep(senderList[i + SENDER_SLOTS]);
        await sleep(500);
      }

      return totalMoved;
    } finally {
      orchestratorState.currentSender = null;
      await callMachineActorJob(masterInfo.machineKey, "release_actor", {
        profileId: masterInfo.id,
        resumeBot: masterWasBotRunning,
        restoreChannel: masterPrep?.homeChannel || null,
        currentChannel: masterChannel
      }, 20000).catch(() => {});

      for (const s of senderList) {
        if (!releasedKeys.has(s.compositeKey) && prepMap.has(s.compositeKey)) {
          try {
            const p = await Promise.race([prepMap.get(s.compositeKey), sleep(1000).then(() => null)]);
            await callMachineActorJob(s.machineKey, "release_actor", {
              profileId: s.id,
              resumeBot: Boolean(p?.wasBotRunning),
              restoreChannel: p?.homeChannel || null,
              currentChannel: p?.currentChannel || null
            }, 15000).catch(() => {});
          } catch (_) {}
        }
      }
      void participatingMachines;
    }
  }

  async function runCrossMachineConsolidation(startOpts = {}) {
    const cfg = saveConfig({
      ...(startOpts.masterReceiverKey !== undefined ? { masterReceiverKey: startOpts.masterReceiverKey } : {}),
      ...(typeof startOpts.ringFirst === "boolean" ? { ringFirst: startOpts.ringFirst } : {}),
      ...(startOpts.minZenyThreshold !== undefined ? { minZenyThreshold: startOpts.minZenyThreshold } : {}),
      ...(startOpts.keepZeny !== undefined ? { keepZeny: startOpts.keepZeny } : {}),
      ...(typeof startOpts.roundHundredK === "boolean" ? { roundHundredK: startOpts.roundHundredK } : {}),
      ...(startOpts.ringReceivers && typeof startOpts.ringReceivers === "object" ? { ringReceivers: startOpts.ringReceivers } : {})
    });

    const initialOverview = await buildOverview(cfg);
    const masterParsed = parseCompositeKey(initialOverview.config.masterReceiverKey);
    let masterInfo = null;
    for (const m of initialOverview.machines) {
      if (!m.isOnline) continue;
      for (const optM of initialOverview.masterOptionsByMachine) {
        if (optM.machineKey !== m.machineKey) continue;
        const found = optM.candidates.find(c => c.compositeKey === initialOverview.config.masterReceiverKey);
        if (found) {
          masterInfo = {
            ...found,
            machineKey: m.machineKey,
            deviceName: m.deviceName,
            actorReady: m.actorReady
          };
          break;
        }
      }
      if (masterInfo) break;
    }

    if (!masterInfo) {
      throw new Error("กรุณาเลือกตัวหลักรับเงินปลายทางที่กำลังออนไลน์และมี 👑 Premium ก่อน");
    }
    if (!masterInfo.actorReady) {
      throw new Error(`เครื่องของตัวหลัก (${masterInfo.deviceName}) ยังเป็นเวอร์ชันเก่า — กรุณารออัปเดต Manager เป็น v4.63.8+ ก่อน`);
    }

    const ringFirst = initialOverview.config.ringFirst !== false;
    const minZenyThreshold = clampInt(initialOverview.config.minZenyThreshold, 1000000, 0);
    const keepZeny = clampInt(initialOverview.config.keepZeny, 0, 0);
    const roundHundredK = Boolean(initialOverview.config.roundHundredK);

    orchestratorAborted = false;
    orchestratorState = {
      running: true,
      status: "running",
      mode: ringFirst ? "ring_first" : "threshold",
      phase: ringFirst ? "stage1" : "direct",
      stepIndex: 1,
      totalSteps: ringFirst ? 4 : 3,
      step: ringFirst
        ? "ขั้นที่ 1/2: กำลังสั่งทุกเครื่องรวมเงินเฉพาะในวงแลน (Proxy IP) ของตัวเองก่อน..."
        : `ค้นหาตัวละครจากทุกเครื่องที่มีเงินมากกว่า ${minZenyThreshold.toLocaleString()} z...`,
      masterReceiver: {
        compositeKey: masterInfo.compositeKey,
        machineKey: masterInfo.machineKey,
        deviceName: masterInfo.deviceName,
        id: masterInfo.id,
        charName: masterInfo.charName
      },
      currentSender: null,
      completedSenders: [],
      totalSenders: 0,
      stage1TransferredZeny: 0,
      stage2TransferredZeny: 0,
      totalTransferredZeny: 0,
      logs: [],
      startTime: Date.now(),
      endTime: 0
    };

    try {
      if (ringFirst) {
        addOrchestratorLog(
          `🌐 เริ่มรวมเงินทุกเครื่องแบบ 2 ขั้นตอน (ในวงแลน/Proxy ➜ ตัวหลัก [${masterInfo.charName} @ ${masterInfo.deviceName}])`,
          "info"
        );

        // STAGE 1: Trigger intra-ring consolidation on every online machine in parallel
        const stage1Machines = [];
        for (const m of initialOverview.machines) {
          if (!m.isOnline) continue;
          const readyGroups = m.ipGroups
            .filter(g => g.canConsolidateInRing && g.receiver && g.ringSenderIds.length > 0)
            .map(g => ({
              ip: g.ip,
              receiverProfileId: g.receiver.id,
              senderProfileIds: g.ringSenderIds
            }));
          if (readyGroups.length === 0) continue;

          if (!m.actorReady) {
            addOrchestratorLog(
              `⚠️ เครื่อง ${m.deviceName} ยังไม่ได้อัปเดตเวอร์ชัน (ข้ามขั้น 2 แต่สั่งรวมในวง IP ให้ได้)`,
              "warning"
            );
          }

          const startRes = await remoteFleet.requestMachineJson(m.machineKey, "POST", "/api/consolidation/start", {
            keepZeny,
            sameIpOnly: true,
            roundHundredK,
            zenyOnly: true,
            ipGroups: readyGroups
          }, 18000);

          if (startRes.ok && startRes.data && startRes.data.success) {
            stage1Machines.push({
              machineKey: m.machineKey,
              deviceName: m.deviceName,
              groupsCount: readyGroups.length,
              lastZeny: 0,
              done: false
            });
            addOrchestratorLog(
              `🚀 เครื่อง ${m.deviceName}: เริ่มรวมเงินภายใน ${readyGroups.length} วง IP แล้ว`,
              "info"
            );
          } else {
            addOrchestratorLog(
              `⚠️ เครื่อง ${m.deviceName}: ข้ามขั้นที่ 1 (${startRes.data?.error || "ไม่สามารถเริ่มรวมเงินในวงได้"})`,
              "warning"
            );
          }
        }

        // Wait until all Stage 1 machines finish running
        if (stage1Machines.length > 0) {
          while (!orchestratorAborted) {
            await sleep(stage1PollIntervalMs);
            if (orchestratorAborted) break;

            let stage1Sum = 0;
            let allDone = true;
            await Promise.all(stage1Machines.map(async (sm) => {
              if (sm.done) {
                stage1Sum += sm.lastZeny;
                return;
              }
              const stRes = await remoteFleet.requestMachineJson(sm.machineKey, "GET", "/api/consolidation/status", null, 12000).catch(() => null);
              if (stRes && stRes.ok && stRes.data) {
                sm.lastZeny = Number(stRes.data.totalTransferredZeny || 0);
                stage1Sum += sm.lastZeny;
                if (!stRes.data.running) {
                  sm.done = true;
                  addOrchestratorLog(
                    `✅ ขั้นที่ 1 เครื่อง ${sm.deviceName} เสร็จสิ้น (รวมในวงได้ ${sm.lastZeny.toLocaleString()} z)`,
                    "success"
                  );
                } else {
                  allDone = false;
                }
              } else {
                allDone = false;
              }
            }));

            orchestratorState.stage1TransferredZeny = stage1Sum;
            orchestratorState.totalTransferredZeny = stage1Sum + orchestratorState.stage2TransferredZeny;
            const remaining = stage1Machines.filter(x => !x.done).map(x => x.deviceName);
            if (remaining.length > 0) {
              orchestratorState.step = `ขั้นที่ 1/2: กำลังรวมเงินในวงแลน (${remaining.join(", ")}) · รวมในวงแล้ว ${stage1Sum.toLocaleString()} z`;
            }
            if (allDone) break;
          }
        } else {
          addOrchestratorLog("ℹ️ ขั้นที่ 1: ไม่มีวง IP ที่มีหลายจอให้รวมภายในวง — ข้ามไปขั้นที่ 2 ทันที", "info");
        }

        if (orchestratorAborted) throw new Error("ผู้ใช้สั่งยกเลิกการรวมเงิน");

        // Pause briefly so client states flush after Stage 1, then refresh snapshots
        orchestratorState.phase = "stage2";
        orchestratorState.stepIndex = 2;
        orchestratorState.step = "ขั้นที่ 2/2: กำลังอ่านยอดเงินล่าสุดของตัวรับแต่ละวงเพื่อดึงมารวมที่ตัวหลัก...";
        await sleep(Math.min(1800, pollIntervalMs * 2));

        const postStage1Overview = await buildOverview(initialOverview.config);
        const stage2Senders = [];
        for (const m of postStage1Overview.machines) {
          if (!m.isOnline) continue;
          for (const g of m.ipGroups) {
            if (!g.receiver || !g.receiver.isRunning || !g.receiver.hasPremium) continue;
            if (g.receiver.compositeKey === masterInfo.compositeKey) continue;
            const transferAmt = calcTransferZeny(g.receiver.zeny, keepZeny, roundHundredK);
            if (transferAmt <= 0) continue;
            if (!m.actorReady) {
              addOrchestratorLog(
                `⚠️ ข้ามตัวรับวง [${g.ip}] (${g.receiver.charName} @ ${m.deviceName}) เนื่องจากเครื่องยังไม่อัปเดตเป็น v4.63.8+`,
                "warning"
              );
              continue;
            }
            stage2Senders.push({
              compositeKey: g.receiver.compositeKey,
              machineKey: m.machineKey,
              deviceName: m.deviceName,
              id: g.receiver.id,
              charName: g.receiver.charName,
              zeny: g.receiver.zeny,
              ip: g.ip
            });
          }
        }

        stage2Senders.sort((a, b) => b.zeny - a.zeny);
        orchestratorState.stepIndex = 3;
        addOrchestratorLog(
          `📦 ขั้นที่ 2/2: พบตัวรับประจำวง IP จากทุกเครื่องที่มียอดพร้อมโอนเข้าตัวหลัก ${stage2Senders.length} จอ`,
          "info"
        );
        await transferSendersAcrossMachinesToMaster(masterInfo, stage2Senders, initialOverview.config);
      } else {
        // DIRECT THRESHOLD MODE: every online VIP across all machines with zeny > minZenyThreshold
        addOrchestratorLog(
          `⚡ เริ่มรวมเงินทุกเครื่องตามยอดเงิน: ดึงทุกจอที่มีเงิน > ${minZenyThreshold.toLocaleString()} z เข้าตัวหลัก [${masterInfo.charName} @ ${masterInfo.deviceName}]`,
          "info"
        );
        const directSenders = [];
        const rawSnaps = await Promise.all((await getFleetMachinesSafe()).map(fetchSingleMachineSnapshot));
        for (const snap of rawSnaps) {
          if (!snap.isOnline) continue;
          for (const p of snap.profiles) {
            if (!p.isRunning || !computeProfilePremium(p)) continue;
            const compKey = makeCompositeKey(snap.machineKey, p.id);
            if (compKey === masterInfo.compositeKey) continue;
            const zeny = computeProfileZeny(p);
            if (zeny <= minZenyThreshold) continue;
            const transferAmt = calcTransferZeny(zeny, keepZeny, roundHundredK);
            if (transferAmt <= 0) continue;
            if (!snap.actorReady) {
              addOrchestratorLog(
                `⚠️ ข้าม [${p.charName || p.name}] (@ ${snap.deviceName}) เนื่องจากเครื่องยังไม่อัปเดตเป็น v4.63.8+`,
                "warning"
              );
              continue;
            }
            directSenders.push({
              compositeKey: compKey,
              machineKey: snap.machineKey,
              deviceName: snap.deviceName,
              id: String(p.id),
              charName: String(p.charName || p.lastCharName || p.name || ""),
              zeny,
              ip: getProfileIpFromObject(p)
            });
          }
        }
        directSenders.sort((a, b) => b.zeny - a.zeny);
        orchestratorState.stepIndex = 2;
        addOrchestratorLog(
          `🎯 พบตัวละครที่มีเงินมากกว่า ${minZenyThreshold.toLocaleString()} z ทั้งหมด ${directSenders.length} จอ across ทุกเครื่อง`,
          "info"
        );
        await transferSendersAcrossMachinesToMaster(masterInfo, directSenders, initialOverview.config);
      }

      orchestratorState.status = orchestratorAborted ? "stopped" : "completed";
      orchestratorState.stepIndex = orchestratorState.totalSteps;
      orchestratorState.step = orchestratorAborted
        ? "ยกเลิกการรวมเงินทุกเครื่องแล้ว"
        : `เสร็จสมบูรณ์! โอนเข้าตัวหลัก [${masterInfo.charName}] ได้ +${orchestratorState.stage2TransferredZeny.toLocaleString()} z (รวมในวง ${orchestratorState.stage1TransferredZeny.toLocaleString()} z)`;
      addOrchestratorLog(`🎉 ${orchestratorState.step}`, orchestratorAborted ? "warning" : "success");
    } catch (err) {
      orchestratorState.status = orchestratorAborted ? "stopped" : "error";
      orchestratorState.step = orchestratorAborted
        ? "ผู้ใช้สั่งหยุดการรวมเงินทุกเครื่อง"
        : `เกิดข้อผิดพลาด: ${err?.message || err}`;
      addOrchestratorLog(`⛔ ${orchestratorState.step}`, orchestratorAborted ? "warning" : "error");
    } finally {
      orchestratorState.running = false;
      orchestratorState.endTime = Date.now();
    }
  }

  async function stopAllCrossMachine() {
    orchestratorAborted = true;
    addOrchestratorLog("⏹️ ผู้ใช้สั่งหยุดการรวมเงินทุกเครื่อง — กำลังปลดล็อกทุกจอ...", "warning");
    try {
      if (typeof stopLocalConsolidation === "function") stopLocalConsolidation();
    } catch (_) {}
    try {
      const machines = await getFleetMachinesSafe();
      await Promise.all(machines
        .filter(m => m.isCurrentMachine || (m.isOnline && m.remoteReady))
        .map(async (m) => {
          await remoteFleet.requestMachineJson(m.machineKey, "POST", "/api/consolidation/stop", {}, 8000).catch(() => {});
          await remoteFleet.requestMachineJson(m.machineKey, "POST", "/api/consolidation/fleet-actor/abort", {}, 8000).catch(() => {});
        }));
    } catch (_) {}
    if (!orchestratorState.running) {
      orchestratorState.status = "stopped";
      orchestratorState.step = "หยุดการรวมเงินทุกเครื่องเรียบร้อย";
      orchestratorState.endTime = Date.now();
    }
    return { success: true };
  }

  async function handleRoute(req, res, pathname, parsedUrl, sendJSON) {
    // ---------------------------------------------------------
    // 1. LOCAL ACTOR ROUTES (/api/consolidation/fleet-actor/*)
    // ---------------------------------------------------------
    if (req.method === "GET" && pathname === "/api/consolidation/fleet-actor/snapshot") {
      try {
        const snap = await buildLocalSnapshot();
        return sendJSON(snap);
      } catch (e) {
        return sendJSON({ success: false, error: e.message }, 500);
      }
    }

    if (req.method === "POST" && pathname === "/api/consolidation/fleet-actor/start-job") {
      try {
        const body = await readJsonBody(req);
        if (!body || !body.action) {
          return sendJSON({ success: false, error: "Missing action" }, 400);
        }
        const jobId = startActorJob(body.action, body.payload || {});
        return sendJSON({ success: true, jobId });
      } catch (e) {
        return sendJSON({ success: false, error: e.message }, e?.status || 400);
      }
    }

    if (req.method === "GET" && pathname === "/api/consolidation/fleet-actor/job-status") {
      const jobId = String(parsedUrl?.searchParams?.get("jobId") || "").trim();
      const job = actorJobs.get(jobId);
      if (!job) return sendJSON({ success: false, error: "Job not found" }, 404);
      return sendJSON({ success: true, job });
    }

    if (req.method === "POST" && pathname === "/api/consolidation/fleet-actor/abort") {
      const result = await abortAllLocalActorJobs();
      return sendJSON({ success: true, ...result });
    }

    // ---------------------------------------------------------
    // 2. CROSS-MACHINE ORCHESTRATOR ROUTES (/api/fleet-zeny/*)
    // ---------------------------------------------------------
    if (req.method === "GET" && pathname === "/api/fleet-zeny/overview") {
      try {
        const overview = await buildOverview();
        return sendJSON(overview);
      } catch (e) {
        return sendJSON({ success: false, error: e?.message || "โหลดข้อมูลรวมเงินทุกเครื่องไม่สำเร็จ" }, 500);
      }
    }

    if (req.method === "POST" && pathname === "/api/fleet-zeny/config") {
      try {
        const body = await readJsonBody(req);
        const saved = saveConfig(body || {});
        return sendJSON({ success: true, config: saved });
      } catch (e) {
        return sendJSON({ success: false, error: e.message }, e?.status || 400);
      }
    }

    if (req.method === "GET" && pathname === "/api/fleet-zeny/status") {
      return sendJSON({ success: true, ...orchestratorState });
    }

    if (req.method === "POST" && pathname === "/api/fleet-zeny/start") {
      if (orchestratorState.running) {
        return sendJSON({ success: false, error: "ระบบรวมเงินทุกเครื่องกำลังทำงานอยู่แล้วในขณะนี้" }, 409);
      }
      try {
        const body = await readJsonBody(req);
        // Validate preflight synchronously so UI receives immediate errors if Master isn't ready
        const cfg = saveConfig(body || {});
        const ov = await buildOverview(cfg);
        const selKey = ov.config.masterReceiverKey;
        let master = null;
        for (const m of ov.masterOptionsByMachine) {
          const c = m.candidates.find(x => x.compositeKey === selKey);
          if (c) {
            master = { ...c, machineKey: m.machineKey, deviceName: m.deviceName, actorReady: m.actorReady };
            break;
          }
        }
        if (!master) {
          return sendJSON({ success: false, error: "ไม่พบตัวหลักรับเงินปลายทางที่ออนไลน์และมี 👑 Premium" }, 400);
        }
        if (!master.actorReady) {
          return sendJSON({ success: false, error: `เครื่องของตัวหลัก (${master.deviceName}) ยังเป็นเวอร์ชันเก่า — กรุณาอัปเดตก่อนเริ่มรวมเงินข้ามเครื่อง` }, 400);
        }

        // Kick off in background
        runCrossMachineConsolidation(body || {}).catch((err) => {
          orchestratorState.running = false;
          orchestratorState.status = "error";
          orchestratorState.step = err?.message || "เกิดข้อผิดพลาดระหว่างรวมเงินทุกเครื่อง";
          orchestratorState.endTime = Date.now();
        });
        return sendJSON({ success: true, message: "เริ่มต้นรวมเงินทุกเครื่องเรียบร้อยแล้ว", state: orchestratorState });
      } catch (e) {
        return sendJSON({ success: false, error: e?.message || "ไม่สามารถเริ่มรวมเงินทุกเครื่องได้" }, e?.status || 400);
      }
    }

    if (req.method === "POST" && pathname === "/api/fleet-zeny/run-ring") {
      try {
        const body = await readJsonBody(req);
        const machineKey = String(body?.machineKey || "").trim();
        const ip = String(body?.ip || "").trim();
        if (!machineKey || !ip) {
          return sendJSON({ success: false, error: "กรุณาระบุเครื่องและวง IP ที่ต้องการรวมเงิน" }, 400);
        }
        const cfg = loadConfig();
        const keepZeny = body.keepZeny !== undefined ? clampInt(body.keepZeny, 0, 0) : cfg.keepZeny;
        const roundHundredK = typeof body.roundHundredK === "boolean" ? body.roundHundredK : cfg.roundHundredK;
        const ov = await buildOverview({
          ...cfg,
          keepZeny,
          roundHundredK,
          ...(body.ringReceivers ? { ringReceivers: body.ringReceivers } : {})
        });
        const machine = ov.machines.find(m => m.machineKey === machineKey);
        const grp = machine && machine.ipGroups.find(g => g.ip === ip);
        if (!grp || !grp.canConsolidateInRing || !grp.receiver) {
          return sendJSON({ success: false, error: `วง IP [${ip}] ยังไม่มีตัวรับและผู้ส่งสถานะ 👑 Premium ออนไลน์ในวงเดียวกัน` }, 400);
        }
        const resRemote = await remoteFleet.requestMachineJson(machineKey, "POST", "/api/consolidation/start", {
          keepZeny,
          sameIpOnly: true,
          roundHundredK,
          zenyOnly: true,
          ipGroups: [{
            ip: grp.ip,
            receiverProfileId: grp.receiver.id,
            senderProfileIds: grp.ringSenderIds
          }]
        }, 18000);
        if (!resRemote.ok || !resRemote.data?.success) {
          return sendJSON({ success: false, error: resRemote.data?.error || "สั่งรวมเงินเฉพาะวงนี้ไม่สำเร็จ" }, resRemote.status || 400);
        }
        return sendJSON({ success: true, message: `เริ่มรวมเงินเฉพาะวง [${ip}] บนเครื่อง ${machine.deviceName} แล้ว` });
      } catch (e) {
        return sendJSON({ success: false, error: e?.message || "สั่งรวมเงินเฉพาะวงนี้ไม่สำเร็จ" }, e?.status || 400);
      }
    }

    if (req.method === "POST" && pathname === "/api/fleet-zeny/stop") {
      const result = await stopAllCrossMachine();
      return sendJSON(result);
    }

    return false;
  }

  return {
    handleRoute,
    buildOverview,
    loadConfig,
    saveConfig,
    runCrossMachineConsolidation,
    stopAllCrossMachine,
    calcTransferZeny,
    getState: () => orchestratorState
  };
}

module.exports = {
  createFleetZenyConsolidationService,
  buildIpGroupsForMachine,
  calcTransferZeny,
  parseCompositeKey,
  makeCompositeKey
};
