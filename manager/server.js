// ==========================================
// SUPERVISOR: PelicanManager.exe runs `node server.js`. That process stays a thin supervisor and runs the
// real server as a child, so an update can restart the server (exit code 75) without restarting
// PelicanManager.exe — whose job object would also close every game window. See manager_self_update.js.
// If an updated server fails to start, the files backed up by the updater are restored automatically.
// ==========================================
if (process.env.PELICAN_SERVER_CHILD !== "1") {
  const { fork } = require("child_process");
  const fs = require("fs");
  const path = require("path");
  const marker = path.join(__dirname, "data", "manager_update_pending.json");
  let child = null;
  let crashes = [];
  const rollback = () => {
    try {
      const m = JSON.parse(fs.readFileSync(marker, "utf8"));
      for (const rel of m.files || []) {
        const src = path.join(m.backupDir, rel);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(__dirname, rel));
      }
      fs.unlinkSync(marker);
      // Remember the bad version so the updater doesn't apply it again automatically
      fs.writeFileSync(path.join(__dirname, "data", "manager_update_failed.json"), JSON.stringify({ sha: m.sha, at: Date.now() }));
      console.log("[Supervisor] ⏪ Updated server failed to start — restored the previous files");
      return true;
    } catch (e) {
      return false;
    }
  };
  const startChild = () => {
    child = fork(__filename, process.argv.slice(2), { env: { ...process.env, PELICAN_SERVER_CHILD: "1" } });
    child.on("exit", (code) => {
      if (code === 75) {
        console.log("[Supervisor] ♻️ Restarting Manager server after update...");
        return setTimeout(startChild, 800);
      }
      if (code === 0) return process.exit(0);
      if (rollback()) return setTimeout(startChild, 800);
      crashes = crashes.filter(t => Date.now() - t < 120000);
      crashes.push(Date.now());
      if (crashes.length <= 3) {
        console.log("[Supervisor] ⚠️ Manager server stopped unexpectedly (code " + code + ") — restarting");
        return setTimeout(startChild, 2000);
      }
      process.exit(code == null ? 1 : code);
    });
  };
  const stop = () => { try { if (child) child.kill(); } catch (e) {} process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  startChild();
  return;
}
// Child: exit together with the supervisor if it is killed (e.g. PelicanManager.exe "Restart")
process.on("disconnect", () => process.exit(0));

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, exec } = require("child_process");

const TEST_INSTANCE=process.env.PELICAN_TEST_INSTANCE==='1';
const testPort=Number(process.env.PELICAN_TEST_PORT),testCdpPort=Number(process.env.PELICAN_TEST_CDP_PORT);
if(TEST_INSTANCE) {
  const tempRoot=path.resolve(os.tmpdir())+path.sep;
  if(!path.resolve(__dirname).toLowerCase().startsWith(tempRoot.toLowerCase())||!Number.isInteger(testPort)||testPort<3899||testPort>65535||!Number.isInteger(testCdpPort)||testCdpPort<9400||testCdpPort>65535||testCdpPort===testPort)throw Error('ISOLATED_TEMP_MANAGER_REQUIRED');
  for(const name of ['bot_update_state.json','manager_update_state.json']) {
    const data=JSON.parse(fs.readFileSync(path.join(__dirname,'data',name),'utf8'));
    if(data.enabled!==false)throw Error('TEST_AUTO_UPDATE_MUST_BE_DISABLED');
  }
  // Review R6: only a manager seeded by the fixture builder (fake data, no customer files) may run as a test
  // instance, and it may only reach loopback fixture ports.
  const marker=(()=>{try{return JSON.parse(fs.readFileSync(path.join(__dirname,'data','test_fixture_marker.json'),'utf8'));}catch(_){return null;}})();
  if(marker?.fixture!==true||marker.customerData!==false)throw Error('TEST_FIXTURE_MARKER_REQUIRED');
}
const testFixturePort=Number(process.env.PELICAN_TEST_FIXTURE_PORT);
if(TEST_INSTANCE&&(!Number.isInteger(testFixturePort)||testFixturePort<1024||testFixturePort>65535||[testPort,testCdpPort,3888].includes(testFixturePort)))throw Error('TEST_FIXTURE_PORT_REQUIRED');
const testIsolation=TEST_INSTANCE?require('./test_isolation').installTestIsolation({allowedPorts:[testPort,testCdpPort,testFixturePort]}):null;
const PORT = TEST_INSTANCE?testPort:3888;
const BASE_DIR = path.resolve(__dirname, "..");
const PROFILES_FILE = path.join(__dirname, "profiles.json");
const PLANS_FILE = path.join(__dirname, "plans.json");
const PRESETS_FILE = path.join(__dirname, "presets.json");
const installer = require("./installer");
const { handleInventoryMarketRoute } = require("./inventory_market_api");
const { createPartyService } = require("./party_api");
const { createPremiumService } = require("./premium_api");
const { createGuildService } = require("./guild_api");
const { createBotAutoUpdater } = require("./bot_auto_update");
const { createManagerSelfUpdater } = require("./manager_self_update");
const { handleConfigCopyRoute } = require("./config_copy_api");
const { createPlanSync } = require("./plan_sync");
const { createAuthSync } = require("./auth_sync");
const credentials = require("./credentials");
const { createBrowserMode, extractPelicanStorageFromLevelDb, mergeAuthConfigString } = require("./browser_mode");
const { createDiscordBotService } = require("./discord_bot");
const { allowLocalRequest } = require("./local_request_security");
const { createHumanCheckSolver } = require("./human_check_solver");
const humanCheckSolver = createHumanCheckSolver({ dataDir: path.join(__dirname, "data"), ...(TEST_INSTANCE ? { requestJSON: require('./test_isolation').createFixtureRequestJSON(testFixturePort) } : {}) });
const { createProxyRegisterService } = require("./proxy_register");
const proxyRegister = createProxyRegisterService({ dataDir: path.join(__dirname, "data"), solver: humanCheckSolver });
const { createScreenProxyManager } = require("./screen_proxy_manager");
const imageBoardSolver = require('./image_board_solver');
const { createScriptCoordinator } = require('./script_coordinator');
const { loadScriptRollout, saveScriptRolloutSelection } = require('./script_rollout');
const PROFILES_BACKUP_FILE = path.join(__dirname, "data", "profiles.backup.json");
const PLANS_BACKUP_FILE = path.join(__dirname, "data", "plans.backup.json");
const PRESETS_BACKUP_FILE = path.join(__dirname, "data", "presets.backup.json");

function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const text = JSON.stringify(data, null, 2);
  const tmpFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpFile, text, "utf8");
    fs.renameSync(tmpFile, filePath);
  } catch (e) {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    fs.writeFileSync(filePath, text, "utf8");
  }
}

let lastValidPresetsCache = null;
function loadPresets() {
  if (fs.existsSync(PRESETS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(PRESETS_FILE, "utf8"));
      if (Array.isArray(parsed) && parsed.length > 0) {
        lastValidPresetsCache = parsed;
        if (!fs.existsSync(PRESETS_BACKUP_FILE)) {
          try { writeJsonAtomic(PRESETS_BACKUP_FILE, parsed); } catch (_) {}
        }
        return parsed;
      }
    } catch (e) {}
  }
  if (fs.existsSync(PRESETS_BACKUP_FILE)) {
    try {
      const backup = JSON.parse(fs.readFileSync(PRESETS_BACKUP_FILE, "utf8"));
      if (Array.isArray(backup) && backup.length > 0) {
        lastValidPresetsCache = backup;
        try { writeJsonAtomic(PRESETS_FILE, backup); } catch (_) {}
        return backup;
      }
    } catch (_) {}
  }
  if (lastValidPresetsCache && lastValidPresetsCache.length > 0) {
    return lastValidPresetsCache;
  }
  if (!fs.existsSync(PRESETS_FILE)) {
    const defaultPresets = [
      {
        id: "preset_archer_ruins",
        name: "Archer ฟาร์มซากโบราณสถาน (ลูป 24 ชม.)",
        description: "ลูกธนู 200 ดอก, ขยะขายหมด, ล็อคของตีบวกและออฟชั่น, ลูป 24 ชม.",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        config: {
          targetMap: "ซากโบราณสถาน Lv.45–55",
          autoLoop: true,
          sellConfig: {
            enabled: true,
            weightCheckEnabled: true,
            weightThreshold: 80,
            sellMaterials: true,
            weaponRarity: "normal",
            armorRarity: "normal",
            accRarity: "none",
            sellWeapons: true,
            sellArmors: true,
            keepRefined: true,
            keepSpecial: true,
            keepSockets: true,
            whitelist: "Phracon, Rough Elunium, Enchant Rune, Composite Bow, Crossbow, Gakkung, Hunter Bow"
          },
          archerConfig: {
            requireArrow: false,
            arrowType: 90030,
            arrowBuyQty: 200,
            useBwing: true,
            bwingBuyQty: 5,
            bwingItemId: 90311,
            ammoThreshold: 50,
            autoEquipArrow: false,
            arrowHotbarSlot: -1
          },
          shopConfig: {
            enabled: true,
            npcKey: "n2"
          },
          autoMarketSellConfig: {
            enabled: false,
            rules: []
          },
          authConfig: {
            enabled: true,
            autoResumeBot: true,
            charName: ""
          }
        }
      }
    ];
    writeJsonAtomic(PRESETS_FILE, defaultPresets);
    return defaultPresets;
  }
  return [];
}
function savePresets(presets) {
  if (!Array.isArray(presets)) return;
  lastValidPresetsCache = presets;
  writeJsonAtomic(PRESETS_FILE, presets);
  if (presets.length > 0) {
    try { writeJsonAtomic(PRESETS_BACKUP_FILE, presets); } catch (_) {}
  }
}


// Job Lv. at which the plan changes to Class 1 / Class 2 (the bot also caps it at the class's max job level)
function planJobLevel(v, def) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 99 ? n : def;
}

function normalizePlansData(raw) {
  if (raw && Array.isArray(raw.profiles)) {
    return {
      profiles: raw.profiles,
      assignments: raw.assignments || {},
      pendingEnable: raw.pendingEnable || {}
    };
  }

  // Initial starter plan matching user specifications:
  // Level 8: Equip Gakkung bow, Angelic Protection, Change map to ซากโบราณสถาน
  // Job Level 10: Change class to Archer
  const defaultProfiles = [
    {
      id: "plan_starter_archer",
      name: "Archer Speedrun Lv.1-50 (ตัวอย่างเริ่มต้น)",
      description: "Lv.8 สวมใส่ Gakkung Bow + Angelic Protection, ย้ายแมพ, Job 10 เปลี่ยนอาชีพ Archer",
      triggers: [
        {
          id: "trig_1",
          type: "base_level",
          targetLevel: 8,
          actions: [
            {
              id: "act_1",
              type: "equip_item",
              itemName: "Gakkung Bow",
              optionFilter: "dex",
              buyFromMarket: true,
              maxPrice: 100000
            },
            {
              id: "act_2",
              type: "equip_item",
              itemName: "Angelic Protection",
              optionFilter: "",
              buyFromMarket: true,
              maxPrice: 50000
            },
            {
              id: "act_3",
              type: "change_map",
              targetMap: "ซากโบราณสถาน"
            }
          ]
        },
        {
          id: "trig_2",
          type: "job_level",
          targetLevel: 10,
          actions: [
            {
              id: "act_4",
              type: "change_class",
              targetClass: "Archer"
            }
          ]
        }
      ],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  ];

  const assignments = {};
  return { profiles: defaultProfiles, assignments };
}

let lastValidPlansCache = null;
function loadPlans() {
  if (fs.existsSync(PLANS_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(PLANS_FILE, "utf8"));
      if (raw && Array.isArray(raw.profiles)) {
        const norm = normalizePlansData(raw);
        lastValidPlansCache = norm;
        if (!fs.existsSync(PLANS_BACKUP_FILE)) {
          try { writeJsonAtomic(PLANS_BACKUP_FILE, norm); } catch (_) {}
        }
        return norm;
      }
    } catch (e) {}
  }
  if (fs.existsSync(PLANS_BACKUP_FILE)) {
    try {
      const backup = JSON.parse(fs.readFileSync(PLANS_BACKUP_FILE, "utf8"));
      if (backup && Array.isArray(backup.profiles)) {
        const norm = normalizePlansData(backup);
        lastValidPlansCache = norm;
        try { writeJsonAtomic(PLANS_FILE, norm); } catch (_) {}
        return norm;
      }
    } catch (_) {}
  }
  if (lastValidPlansCache) return lastValidPlansCache;
  return normalizePlansData({});
}
function savePlans(plans) {
  if (!plans || typeof plans !== "object") return;
  lastValidPlansCache = plans;
  writeJsonAtomic(PLANS_FILE, plans);
  try { writeJsonAtomic(PLANS_BACKUP_FILE, plans); } catch (_) {}
}

const SESSIONS_DIR = path.join(BASE_DIR, "sessions");
const PUBLIC_DIR = path.join(__dirname, "public");

// Game executable on *this* PC: the patcher's saved folder if it exists, else %LOCALAPPDATA%/Programs/Aetheria Online
const getGameExe = () => path.join(installer.getEffectiveGamePath(), "Aetheria Online.exe");
// Why opening a game window would not work (null = fine)
function gameLaunchProblem() {
  const exe = getGameExe();
  if (!fs.existsSync(exe)) return `ไม่พบตัวเกม (${exe}) — กดปุ่ม "สคริปต์เกม" แล้วกด Auto-Detect หรือ Browse เลือกโฟลเดอร์เกม`;
  const st = installer.checkStatus();
  if (!st.isInstalled) return `ยังไม่ได้ติดตั้งสคริปต์ PmheeAether ในโฟลเดอร์เกม (${st.gamePath}) — กดปุ่ม "สคริปต์เกม" แล้วกด "ติดตั้ง" ก่อน`;
  if (st.asarActive) return `ตัวเกมยังใช้ไฟล์ app.asar เดิมอยู่ บอทจะไม่ทำงาน — กดปุ่ม "สคริปต์เกม" แล้วกด "ติดตั้ง" อีกครั้ง (อาจมีหน้าต่างขอสิทธิ์ผู้ดูแลระบบ ให้กด Yes)`;
  return null;
}

// Ensure sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Track running processes in memory: { [profileId]: { pid, startTime } }
const runningProcesses = {};
const windowStates = {}; // profileId -> { isHidden: boolean }
let allWindowsHidden = false;

const DEFAULT_WHITELIST_STR = "Phracon, Rough Elunium, Enchant Rune, Composite Bow, Crossbow, Gakkung, Hunter Bow";

function getDefaultMockProfiles() {
  return [
    {
      id: "profile_1",
      name: "Hunter Main",
      account: "Main Account",
      charClass: "Hunter",
      targetMap: "ซากโบราณสถาน Lv.45–55",
      debugPort: 49876,
      autoStart: true,
      notes: "ฟาร์มหลัก ธนูเพลิง / Arrow Crafting",
      createdAt: Date.now()
    },
    {
      id: "profile_2",
      name: "Farmer Alt",
      account: "Second Account",
      charClass: "Archer / Rogue",
      targetMap: "ถนนต้นหลิว",
      debugPort: 49877,
      autoStart: true,
      notes: "ฟาร์มหาขยะและวัตถุดิบทำยา",
      createdAt: Date.now()
    }
  ];
}

function isSingleDefaultMockProfile(p) {
  if (!p || typeof p !== "object") return false;
  if (p.lastCharName || p.generatedAccount) return false;
  if (p.id === "profile_1" && p.name === "Hunter Main" && p.account === "Main Account") return true;
  if (p.id === "profile_2" && p.name === "Farmer Alt" && p.account === "Second Account") return true;
  return false;
}

function isUntouchedDefaultMockProfiles(profiles) {
  if (!Array.isArray(profiles) || profiles.length === 0) return true;
  if (profiles.length > 2) return false;
  return profiles.every(isSingleDefaultMockProfile);
}

const DELETED_PROFILES_FILE = path.join(__dirname, "data", "deleted_profiles.json");
function loadDeletedProfileIds() {
  try {
    if (!fs.existsSync(DELETED_PROFILES_FILE)) return new Set();
    const arr = JSON.parse(fs.readFileSync(DELETED_PROFILES_FILE, "utf8"));
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch (_) {
    return new Set();
  }
}
function recordDeletedProfileId(id) {
  if (!id) return;
  try {
    const set = loadDeletedProfileIds();
    set.add(String(id));
    writeJsonAtomic(DELETED_PROFILES_FILE, Array.from(set));
  } catch (_) {}
}

function isVerifiedAuthConfig(auth) {
  if (!auth || typeof auth !== "object") return false;
  const u = String(auth.username || "").trim();
  const pw = String(auth.password || "").trim();
  if (!u && !pw) return false;
  if (auth.register === true) return false;
  if (auth.registerError && String(auth.registerError).trim() && !auth.registerDone && !auth.verifiedLoginAt && !auth.userEditedAt) return false;
  if (auth.generatedUser && !auth.registerDone && !auth.verifiedLoginAt && !auth.userEditedAt && !(auth.charName && String(auth.charName).trim())) return false;
  return true;
}

function writeOrMergeProfileStorageFile(pid, incomingMap) {
  if (!pid || !incomingMap || typeof incomingMap !== "object") return false;
  try {
    const bsDir = path.join(SESSIONS_DIR, "_browser_storage");
    fs.mkdirSync(bsDir, { recursive: true });
    const f = path.join(bsDir, `${pid}.json`);
    let cur = {};
    if (fs.existsSync(f)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(f, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) cur = parsed;
      } catch (_) {}
    }
    let changed = false;
    for (const [k, v] of Object.entries(incomingMap)) {
      if (typeof v !== "string") continue;
      if (k.endsWith("__auth_cfg") || k === "pelican_auth_cfg") {
        const merged = mergeAuthConfigString(cur[k], v);
        if (merged !== cur[k]) {
          cur[k] = merged;
          changed = true;
        }
        try {
          const auth = JSON.parse(cur[k]);
          if (isVerifiedAuthConfig(auth) && auth.password && String(auth.password).trim() && !credentials.getPassword(pid)) {
            credentials.setPassword(pid, String(auth.password).trim());
          }
        } catch (_) {}
      } else if (cur[k] !== v) {
        cur[k] = v;
        changed = true;
      }
    }
    if (changed) {
      writeJsonAtomic(f, cur);
    }
    return changed;
  } catch (_) {
    return false;
  }
}

function recoverProfilesFromLocalEvidence() {
  const deletedIds = loadDeletedProfileIds();
  try {
    const dataDir = path.join(__dirname, "data");
    const map = new Map();
    const ensure = (id) => {
      const s = String(id || "").trim();
      if (!s.startsWith("profile_") || deletedIds.has(s)) return null;
      if (!map.has(s)) map.set(s, { id: s });
      return map.get(s);
    };

    // 1. Seed from dedicated backup file if present (never return early before enriching credentials/accounts!)
    if (fs.existsSync(PROFILES_BACKUP_FILE)) {
      try {
        const backup = JSON.parse(fs.readFileSync(PROFILES_BACKUP_FILE, "utf8"));
        const filteredBackup = Array.isArray(backup) ? backup.filter(p => p && !deletedIds.has(String(p.id))) : [];
        if (filteredBackup.length > 0 && !isUntouchedDefaultMockProfiles(filteredBackup)) {
          for (const bp of filteredBackup) {
            const p = ensure(bp.id);
            if (!p) continue;
            Object.assign(p, bp, { id: String(bp.id).trim(), hasRealEvidence: true });
          }
        }
      } catch (_) {}
    }

    // 2.0 Harvest Chromium LevelDB directly from disk into sessions/_browser_storage/*.json
    try {
      const browserLdbDir = path.join(SESSIONS_DIR, "_browser", "Default", "Local Storage", "leveldb");
      if (fs.existsSync(browserLdbDir)) {
        const diskHarvest = extractPelicanStorageFromLevelDb(browserLdbDir);
        if (diskHarvest && diskHarvest.byProfile) {
          for (const [pid, entries] of Object.entries(diskHarvest.byProfile)) {
            writeOrMergeProfileStorageFile(pid, entries);
          }
        }
      }
    } catch (_) {}

    // 2a. sessions/_browser_storage/*.json
    const bsDir = path.join(SESSIONS_DIR, "_browser_storage");
    if (fs.existsSync(bsDir)) {
      for (const f of fs.readdirSync(bsDir)) {
        if (!f.endsWith(".json")) continue;
        const id = f.slice(0, -5);
        const p = ensure(id);
        if (!p) continue;
        try {
          const d = JSON.parse(fs.readFileSync(path.join(bsDir, f), "utf8"));
          const pfx = `pelican_${id}__`;
          const rawAuth = d[`${pfx}auth_cfg`] || d["pelican_auth_cfg"];
          if (rawAuth) {
            try {
              const auth = JSON.parse(rawAuth);
              if (auth && typeof auth === "object") {
                const verified = isVerifiedAuthConfig(auth);
                if (verified && auth.username && String(auth.username).trim()) {
                  p.account = String(auth.username).trim();
                  p.hasRealEvidence = true;
                }
                if (auth.charName && String(auth.charName).trim()) {
                  p.lastCharName = String(auth.charName).trim();
                  p.hasRealEvidence = true;
                }
                if (verified && auth.password && String(auth.password).trim() && !credentials.getPassword(id)) {
                  credentials.setPassword(id, String(auth.password).trim());
                  p.hasRealEvidence = true;
                }
              }
            } catch (_) {}
          }
          const farmMap = d[`${pfx}farm_map`] || d[`${pfx}target_map`] || d[`${pfx}last_farm_map`];
          if (farmMap && typeof farmMap === "string" && farmMap.trim()) {
            p.targetMap = farmMap.trim();
            p.hasRealEvidence = true;
          }
          const rawSell = d[`${pfx}sell_cfg`];
          if (rawSell) {
            try {
              const sell = JSON.parse(rawSell);
              if (sell && typeof sell.whitelist === "string" && sell.whitelist.trim()) {
                p.whitelist = sell.whitelist.trim();
              }
            } catch (_) {}
          }
          if (!p.lastCharName) {
            for (const k of Object.keys(d)) {
              const m = k.match(new RegExp(`^pelican_${id}__plan_state_(.+)_plan_`));
              if (m && m[1]) {
                p.lastCharName = m[1];
                p.hasRealEvidence = true;
                break;
              }
            }
          }
        } catch (_) {}
      }
    }

    // 2b. credentials.json
    if (typeof credentials.listProfileIds === "function") {
      for (const id of credentials.listProfileIds()) {
        const p = ensure(id);
        if (p) {
          p.hasSavedPassword = true;
          p.hasRealEvidence = true;
        }
      }
    }

    // 2c. proxy_register_state_v1.json
    const proxyRegFile = path.join(dataDir, "proxy_register_state_v1.json");
    if (fs.existsSync(proxyRegFile)) {
      try {
        const prx = JSON.parse(fs.readFileSync(proxyRegFile, "utf8"))?.entries || {};
        for (const [id, entry] of Object.entries(prx)) {
          const p = ensure(id);
          if (p && entry && entry.username) {
            if (!p.account) p.account = String(entry.username).trim();
            p.generatedAccount = true;
            p.hasRealEvidence = true;
          }
        }
      } catch (_) {}
    }

    // 2d. zeny_rate_state.json
    const zenyFile = path.join(dataDir, "zeny_rate_state.json");
    if (fs.existsSync(zenyFile)) {
      try {
        const trackers = JSON.parse(fs.readFileSync(zenyFile, "utf8"))?.trackers || {};
        for (const [id, trk] of Object.entries(trackers)) {
          const p = ensure(id);
          if (p && trk && trk.charName) {
            if (!p.lastCharName) p.lastCharName = String(trk.charName).trim();
            p.hasRealEvidence = true;
          }
        }
      } catch (_) {}
    }

    // 2e. guilds.json
    const guildsFile = path.join(dataDir, "guilds.json");
    if (fs.existsSync(guildsFile)) {
      try {
        const guilds = JSON.parse(fs.readFileSync(guildsFile, "utf8"))?.guilds || [];
        for (const g of guilds) {
          for (const [id, m] of Object.entries(g?.members || {})) {
            const p = ensure(id);
            if (p && m) {
              if (m.charName && !p.lastCharName) p.lastCharName = String(m.charName).trim();
              if (m.charClass && !p.charClass) p.charClass = String(m.charClass).trim();
              p.hasRealEvidence = true;
            }
          }
        }
      } catch (_) {}
    }

    // 2f. parties.json & premium.json & plans.json
    const partiesFile = path.join(dataDir, "parties.json");
    if (fs.existsSync(partiesFile)) {
      try {
        const parties = JSON.parse(fs.readFileSync(partiesFile, "utf8"))?.parties || [];
        for (const pt of parties) {
          for (const id of [pt?.leaderId, ...(pt?.memberIds || []), ...(pt?.excludedIds || [])]) {
            const p = ensure(id);
            if (p) p.hasRealEvidence = true;
          }
        }
      } catch (_) {}
    }
    const premiumFile = path.join(premiumDirOrData(dataDir), "premium.json");
    if (fs.existsSync(premiumFile)) {
      try {
        const clients = JSON.parse(fs.readFileSync(premiumFile, "utf8"))?.clients || {};
        for (const id of Object.keys(clients)) {
          const p = ensure(id);
          if (p) p.hasRealEvidence = true;
        }
      } catch (_) {}
    }
    if (fs.existsSync(PLANS_FILE)) {
      try {
        const assignments = JSON.parse(fs.readFileSync(PLANS_FILE, "utf8"))?.assignments || {};
        for (const id of Object.keys(assignments)) {
          const p = ensure(id);
          if (p) p.hasRealEvidence = true;
        }
      } catch (_) {}
    }

    // 2g. screen_proxy_leases.json (preserve assigned debugPort)
    const leasesFile = path.join(dataDir, "screen_proxy_leases.json");
    if (fs.existsSync(leasesFile)) {
      try {
        const leases = JSON.parse(fs.readFileSync(leasesFile, "utf8"))?.leases || {};
        for (const [id, l] of Object.entries(leases)) {
          if (map.has(id) && Number(l?.debugPort) >= 1024) {
            map.get(id).debugPort = Number(l.debugPort);
          }
        }
      } catch (_) {}
    }

    // 2h. sessions/profile_* folders (for Electron mode)
    if (fs.existsSync(SESSIONS_DIR)) {
      for (const entry of fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith("profile_")) continue;
        const id = entry.name;
        const ldbDir = path.join(SESSIONS_DIR, id, "Local Storage", "leveldb");
        const hasLevelDb = fs.existsSync(path.join(SESSIONS_DIR, id, "Local Storage"));
        let p = null;
        if (id !== "profile_1" && id !== "profile_2") {
          p = ensure(id);
          if (p) p.hasRealEvidence = true;
        } else if (hasLevelDb) {
          p = ensure(id);
          if (p) p.hasRealEvidence = true;
        }
        if (p && fs.existsSync(ldbDir)) {
          try {
            const parsedLdb = extractPelicanStorageFromLevelDb(ldbDir, id);
            if (parsedLdb && parsedLdb.byProfile && parsedLdb.byProfile[id]) {
              writeOrMergeProfileStorageFile(id, parsedLdb.byProfile[id]);
              const rawAuth = parsedLdb.byProfile[id][`pelican_${id}__auth_cfg`] || parsedLdb.byProfile[id]["pelican_auth_cfg"];
              if (rawAuth) {
                try {
                  const auth = JSON.parse(rawAuth);
                  if (auth && auth.username && !p.account) p.account = String(auth.username).trim();
                  if (auth && auth.charName && !p.lastCharName) p.lastCharName = String(auth.charName).trim();
                  if (auth && auth.password && !credentials.getPassword(id)) credentials.setPassword(id, String(auth.password).trim());
                  p.hasRealEvidence = true;
                } catch (_) {}
              }
            }
            let foundCred = null;
            for (const f of fs.readdirSync(ldbDir)) {
              if (!f.endsWith(".ldb") && !f.endsWith(".log")) continue;
              const str = fs.readFileSync(path.join(ldbDir, f)).toString("latin1");
              const re = /username\x22:\x22([a-zA-Z0-9_.-]{3,32})\x22,\x22password\x22:\x22([^\x22\x00-\x1f]{3,64})\x22/g;
              let m;
              while ((m = re.exec(str)) !== null) {
                foundCred = { username: m[1], password: m[2] };
              }
            }
            if (foundCred) {
              if (!p.account) p.account = foundCred.username;
              if (!credentials.getPassword(id)) credentials.setPassword(id, foundCred.password);
              p.hasRealEvidence = true;
            }
          } catch (_) {}
        }
      }
    }

    const validCandidates = Array.from(map.values()).filter(p => p.hasRealEvidence);
    if (validCandidates.length === 0) return null;

    // Sort: profile_main first, profile_1, profile_2, then profile_<ts> by timestamp
    validCandidates.sort((a, b) => {
      const rank = (id) => {
        if (id === "profile_main") return 0;
        if (id === "profile_1") return 1;
        if (id === "profile_2") return 2;
        const m = id.match(/^profile_(\d+)/);
        return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
      };
      return rank(a.id) - rank(b.id) || a.id.localeCompare(b.id);
    });

    const usedPorts = new Set();
    let nextPort = 49876;
    const recovered = validCandidates.map((c, idx) => {
      let port = Number(c.debugPort) || 0;
      if (port < 1024 || usedPorts.has(port)) {
        while (usedPorts.has(nextPort)) nextPort++;
        port = nextPort++;
      }
      usedPorts.add(port);
      const tsMatch = c.id.match(/^profile_(\d{10,})/);
      const createdAt = Number(c.createdAt) || (tsMatch ? Number(tsMatch[1]) : (Date.now() - (validCandidates.length - idx) * 1000));
      const wl = c.whitelist || DEFAULT_WHITELIST_STR;
      const isMain = Boolean(c.isMain) || c.id === "profile_main";
      const existingCustomName = c.name && !/^Client \d+$/.test(c.name) ? c.name : "";
      const displayName = existingCustomName || (isMain
        ? (c.lastCharName ? `Main (${c.lastCharName})` : "Main")
        : (c.lastCharName || c.account || (c.id === "profile_2" ? "Farmer Alt" : `Client ${idx + 1}`)));
      const { hasRealEvidence, hasSavedPassword, ...rest } = c;
      return {
        ...rest,
        id: c.id,
        name: displayName,
        account: c.account || "",
        autoRegister: Boolean(c.autoRegister),
        ...(c.generatedAccount ? { generatedAccount: true } : {}),
        charClass: c.charClass || "Hunter",
        targetMap: c.targetMap || "ถนนต้นหลิว",
        debugPort: port,
        autoStart: c.autoStart !== undefined ? Boolean(c.autoStart) : !isMain,
        ...(isMain ? { isMain: true } : {}),
        notes: c.notes !== undefined ? c.notes : (isMain ? "จอหลัก (Main Session)" : ""),
        createdAt,
        whitelist: wl,
        sellConfig: c.sellConfig && typeof c.sellConfig === "object" ? c.sellConfig : { whitelist: wl },
        ...(c.lastCharName ? { lastCharName: c.lastCharName } : {}),
        ...(c.charClass ? { lastCharClass: c.charClass } : {})
      };
    });

    console.log(`[PmheeAether Manager] 🛡️ กู้คืนโปรไฟล์อัตโนมัติ ${recovered.length} จอจากข้อมูลในเครื่อง (sessions / data) สำเร็จ!`);
    return recovered;
  } catch (e) {
    console.warn(`[PmheeAether Manager] ⚠️ Auto-recovery check failed: ${e.message}`);
    return null;
  }
}
function premiumDirOrData(dataDir) { return dataDir; }

let lastValidProfilesCache = null;

function loadProfiles() {
  let parsed = null;
  let readFailed = false;
  if (fs.existsSync(PROFILES_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(PROFILES_FILE, "utf8"));
      if (Array.isArray(raw)) parsed = raw;
      else readFailed = true;
    } catch (e) {
      readFailed = true;
    }
  }

  // If file was transiently unreadable or corrupted mid-write, never return [] when we have cache/backup
  if (readFailed) {
    if (lastValidProfilesCache && lastValidProfilesCache.length > 0) {
      return lastValidProfilesCache.map(p => ({ ...p }));
    }
    const recoveredOnCorrupt = recoverProfilesFromLocalEvidence();
    if (recoveredOnCorrupt && recoveredOnCorrupt.length > 0) {
      lastValidProfilesCache = recoveredOnCorrupt.map(p => ({ ...p }));
      try { writeJsonAtomic(PROFILES_FILE, recoveredOnCorrupt); } catch (_) {}
      try { writeJsonAtomic(PROFILES_BACKUP_FILE, recoveredOnCorrupt); } catch (_) {}
      return recoveredOnCorrupt;
    }
  }

  // If file does not exist OR contains only the 2 untouched install-time mock profiles, attempt auto-recovery
  if (!parsed || isUntouchedDefaultMockProfiles(parsed)) {
    const recovered = recoverProfilesFromLocalEvidence();
    if (recovered && recovered.length > 0) {
      lastValidProfilesCache = recovered.map(p => ({ ...p }));
      try { writeJsonAtomic(PROFILES_FILE, recovered); } catch (_) {}
      try { writeJsonAtomic(PROFILES_BACKUP_FILE, recovered); } catch (_) {}
      return recovered;
    }
    if (!parsed) {
      const defaultProfiles = getDefaultMockProfiles();
      writeJsonAtomic(PROFILES_FILE, defaultProfiles);
      return defaultProfiles;
    }
    return parsed;
  }

  lastValidProfilesCache = parsed.map(p => ({ ...p }));
  if (!fs.existsSync(PROFILES_BACKUP_FILE)) {
    try { writeJsonAtomic(PROFILES_BACKUP_FILE, parsed); } catch (_) {}
  }
  return parsed;
}

function saveProfiles(profiles, options = {}) {
  if (!Array.isArray(profiles)) return;
  const allowEmpty = Boolean(options && options.allowEmpty);
  if (profiles.length === 0 && !allowEmpty && lastValidProfilesCache && lastValidProfilesCache.length > 0) {
    console.warn("[PmheeAether Manager] ⚠️ ป้องกันการเขียนทับ profiles.json ด้วยรายการว่างเปล่า (Preserved existing profiles)");
    return;
  }
  writeJsonAtomic(PROFILES_FILE, profiles);
  if (!isUntouchedDefaultMockProfiles(profiles)) {
    lastValidProfilesCache = profiles.map(p => ({ ...p }));
    try { writeJsonAtomic(PROFILES_BACKUP_FILE, profiles); } catch (_) {}
    if (typeof scheduleCentralProfileBackupSync === "function") {
      scheduleCentralProfileBackupSync();
    }
  } else if (allowEmpty && profiles.length === 0) {
    lastValidProfilesCache = [];
  }
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

// Extra HUD details read straight from the game DOM (portrait, EXP, levels, unspent points).
// Evaluated alongside __getClientLiveState so it works without reinstalling bot.js.
const LIVE_STATE_EVAL = `(() => {
  const s = (typeof window.__getClientLiveState === 'function') ? window.__getClientLiveState() : null;
  if (!s) return null;
  try {
    const hud = document.querySelector('.hud-status');
    if (hud) {
      const img = hud.querySelector('img.portrait');
      if (img && img.src) s.portrait = img.src;
      const lv = Array.from(hud.querySelectorAll('.hud-levels span')).map(e => e.innerText || '');
      const num = t => { const m = String(t || '').match(/(\\d+)/); return m ? Number(m[1]) : null; };
      s.baseLv = num(lv[0]);
      s.jobLv = num(lv[1]);
      const exp = Array.from(hud.querySelectorAll('.bar-exp .bar-num')).map(e => (e.innerText || '').trim());
      s.baseExp = exp[0] || null;
      s.jobExp = exp[1] || null;
      Array.from(hud.querySelectorAll('.hud-alerts button')).forEach(b => {
        const t = b.innerText || '';
        if (t.includes('สถานะ')) s.statPoints = num(t);
        else if (t.includes('สกิล')) s.skillPoints = num(t);
      });
    }
  } catch (e) {}
  try {
    const hc = document.querySelector('.human-check');
    if (hc) {
      if (typeof window.triggerHumanCheckTickNow === 'function') {
        try { window.triggerHumanCheckTickNow(); } catch (_) {}
      }
      const promptEl = hc.querySelector('.human-check-prompt');
      const metaEl = hc.querySelector('.human-check-meta');
      const btns = Array.from(hc.querySelectorAll('.human-check-pick'));
      const boardEl = hc.querySelector('.human-check-board');
      const boardImg = boardEl ? boardEl.querySelector('img') : null;
      const isBoard = Boolean(boardEl || boardImg || (window.__latestHumanCheck && window.__latestHumanCheck.image));
      const isUpdatedFormat = Boolean(window.__humanCheckFormatUpdated || (!isBoard && (!Array.isArray(window.__latestHumanCheck?.items) || !window.__latestHumanCheck.items.length)));

      const options = btns.length > 0
        ? btns.map((b, i) => {
            const img = b.querySelector('img');
            let icon = img ? (img.getAttribute('src') || img.src || '') : '';
            let itemId = (window.__latestHumanCheck && window.__latestHumanCheck.items) ? window.__latestHumanCheck.items[i] : null;
            if (itemId == null) {
              try {
                const fk = Object.keys(b).find(k => k.startsWith('__reactFiber'));
                if (fk && b[fk]) {
                  const cp = b[fk].child?.memoizedProps;
                  if (cp && cp.itemId != null) itemId = Number(cp.itemId);
                }
              } catch (e) {}
            }
            return {
              index: i,
              label: b.getAttribute('aria-label') || ('ตัวเลือกที่ ' + (i + 1)),
              icon,
              itemId: itemId != null ? itemId : null
            };
          })
        : (isBoard
          ? [0, 1, 2, 3].map(i => ({
              index: i,
              label: 'ตัวเลือกที่ ' + (i + 1),
              icon: '',
              itemId: null
            }))
          : []);

      let imageDataUrl = null;
      try {
        const canvas = document.createElement('canvas');
        const w = 580;
        const h = 210;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(0, 0, w, h, 12); else ctx.rect(0, 0, w, h);
          ctx.fill();
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.fillStyle = '#ef4444';
          ctx.font = 'bold 14px "Segoe UI", Tahoma, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText('🚨 ตรวจพบเช็คผู้เล่น (Human Check) - Aetheria Online', 20, 28);

          ctx.fillStyle = '#f8fafc';
          ctx.font = 'bold 16px "Segoe UI", Tahoma, sans-serif';
          const pText = (promptEl ? (promptEl.innerText || '').trim() : '') || 'กดเลือกรูปภาพที่ถูกต้อง';
          ctx.fillText('❓ โจทย์คำถาม: ' + pText, 20, 54);

          ctx.fillStyle = '#94a3b8';
          ctx.font = '12px "Segoe UI", Tahoma, sans-serif';
          const mText = (metaEl ? (metaEl.innerText || '').trim() : '') || 'กรุณาตอบภายในเวลา';
          ctx.fillText('⏱️ ' + mText, 20, 74);

          const cardW = 125;
          const cardH = 110;
          const startX = 20;
          const startY = 86;
          const gap = 12;

          btns.forEach((b, i) => {
            if (i >= 4) return;
            const x = startX + i * (cardW + gap);
            const y = startY;

            ctx.fillStyle = '#1e293b';
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x, y, cardW, cardH, 8); else ctx.rect(x, y, cardW, cardH);
            ctx.fill();

            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = '#94a3b8';
            ctx.font = 'bold 12px "Segoe UI", Tahoma, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('ข้อ ' + (i + 1), x + cardW / 2, y + 18);

            const bImg = b.querySelector('img');
            if (bImg && bImg.complete && bImg.naturalWidth > 0) {
              ctx.drawImage(bImg, x + (cardW - 44) / 2, y + 26, 44, 44);
            } else {
              ctx.fillStyle = '#334155';
              ctx.fillRect(x + (cardW - 44) / 2, y + 26, 44, 44);
            }
          });

          imageDataUrl = canvas.toDataURL('image/png');
        }
      } catch (err) {}

      if (boardImg && boardImg.src && boardImg.src.startsWith('data:image/')) {
        imageDataUrl = boardImg.src;
        try {
          if (boardImg.complete && boardImg.naturalWidth > 0) {
            const bw = 480;
            const bh = 330;
            const stripH = 38;
            const bCanvas = document.createElement('canvas');
            bCanvas.width = bw;
            bCanvas.height = bh + stripH;
            const bCtx = bCanvas.getContext('2d');
            if (bCtx) {
              bCtx.fillStyle = '#0f172a';
              bCtx.fillRect(0, 0, bw, bh + stripH);
              bCtx.drawImage(boardImg, 0, 0, bw, bh);
              const colCenters = [68, 181, 300, 416];
              for (let i = 0; i < 4; i++) {
                const cx = colCenters[i];
                const bx = cx - 44;
                const by = bh + 5;
                bCtx.fillStyle = '#1e293b';
                bCtx.strokeStyle = '#38bdf8';
                bCtx.lineWidth = 1.5;
                bCtx.beginPath();
                if (bCtx.roundRect) bCtx.roundRect(bx, by, 88, 28, 6); else bCtx.rect(bx, by, 88, 28);
                bCtx.fill();
                bCtx.stroke();
                bCtx.fillStyle = '#f8fafc';
                bCtx.font = 'bold 13px "Segoe UI", Tahoma, sans-serif';
                bCtx.textAlign = 'center';
                bCtx.fillText('ตัวเลือก ' + (i + 1), cx, by + 19);
              }
              imageDataUrl = bCanvas.toDataURL('image/png');
            }
          }
        } catch (err) {}
      }

      s.humanCheck = {
        active: true,
        id: window.__latestHumanCheck?.id ?? null,
        prompt: (promptEl ? (promptEl.innerText || '').trim() : '') || (window.__latestHumanCheck?.prompt || ''),
        meta: metaEl ? (metaEl.innerText || '').trim() : '',
        autoSolved: !!window.__lastHumanCheckSolved && (Date.now() - window.__lastHumanCheckSolved.timestamp < 15000),
        lastSolved: window.__lastHumanCheckSolved || null,
        items: (window.__latestHumanCheck && Array.isArray(window.__latestHumanCheck.items)) ? window.__latestHumanCheck.items : null,
        image: (boardImg && (boardImg.getAttribute('src') || boardImg.src)) || window.__latestHumanCheck?.image || null,
        isBoard,
        isUpdatedFormat,
        options,
        imageDataUrl
      };
    } else {
      s.humanCheck = null;
      if (window.__lastHumanCheckSolved && Date.now() - (window.__lastHumanCheckSolved.timestamp || 0) < 30000) {
        window.__lastHumanCheckSolved.verified = 'correct';
        window.__lastHumanCheckSolved.isCorrect = true;
      }
    }
    if (hc && window.__lastHumanCheckSolved) {
      const sLast = window.__lastHumanCheckSolved;
      const elapsedS = Date.now() - (sLast.timestamp || 0);
      const curMetaS = (hc.querySelector('.human-check-meta')?.innerText || '').trim();
      const curTriesMatchS = curMetaS.match(/ตอบผิดได้อีก\s*(\d+)/);
      const curTriesS = curTriesMatchS ? Number(curTriesMatchS[1]) : null;
      const triesBeforeS = sLast.triesLeftBefore ?? 1;
      if (curTriesS != null && curTriesS >= triesBeforeS && elapsedS < 5800) {
        if (sLast.verified === 'wrong') {
          sLast.verified = null;
          delete sLast.isCorrect;
        }
        if (!sLast.retriedLagSend && elapsedS >= 1800) {
          sLast.retriedLagSend = true;
          try {
            if (typeof window.submitHumanCheckBoardAnswer === 'function' && typeof sLast.x === 'number' && typeof sLast.y === 'number') {
              window.submitHumanCheckBoardAnswer(hc, hc.querySelector('.human-check-board'), window.__latestHumanCheck, sLast.x, sLast.y);
            } else {
              const pkt = window.__latestHumanCheck;
              const room = (typeof window.getColyseusRoom === 'function' ? window.getColyseusRoom() : null)
                || (typeof window.getGameRoom === 'function' ? window.getGameRoom() : null)
                || window.__colyseusRoom || window.__gameRoom || null;
              if (room && typeof room.send === 'function' && pkt && pkt.id != null && typeof sLast.x === 'number' && typeof sLast.y === 'number') {
                room.send('human_check_answer', { id: pkt.id, x: sLast.x, y: sLast.y });
              }
            }
          } catch (e) {}
        }
      }
    }
    if (Array.isArray(window.__pmWrongHumanCheckQueue) && window.__pmWrongHumanCheckQueue.length) {
      const confirmedWrong = [];
      const stillPending = [];
      const curMeta = hc ? ((hc.querySelector('.human-check-meta')?.innerText || '').trim()) : '';
      const curTriesMatch = curMeta.match(/ตอบผิดได้อีก\s*(\d+)/);
      const curTriesLeft = curTriesMatch ? Number(curTriesMatch[1]) : null;
      for (const att of window.__pmWrongHumanCheckQueue) {
        if (!att) continue;
        if (!hc) {
          if (window.__lastHumanCheckSolved && window.__lastHumanCheckSolved.timestamp === att.timestamp) {
            window.__lastHumanCheckSolved.verified = 'correct';
            window.__lastHumanCheckSolved.isCorrect = true;
          }
          continue;
        }
        const elapsed = Date.now() - (att.timestamp || 0);
        const triesBefore = att.triesLeftBefore ?? 1;
        const triesNow = curTriesLeft ?? att.triesLeftAfter ?? null;
        const triesDropped = (triesNow != null && triesBefore != null && triesNow < triesBefore);
        if (triesDropped && elapsed >= 1200) {
          att.triesLeftAfter = triesNow;
          if (curMeta) att.metaText = curMeta;
          confirmedWrong.push(att);
        } else if (elapsed < 5800) {
          stillPending.push(att);
        }
      }
      window.__pmWrongHumanCheckQueue = stillPending;
      s.humanCheckWrongAttempts = confirmedWrong.length ? confirmedWrong : null;
    } else {
      s.humanCheckWrongAttempts = null;
    }
  } catch (e) {}
  try {
    if (window.__unexpectedTownWaiting) {
      s.unexpectedTown = {
        active: true,
        waitUntil: window.__unexpectedTownWaitUntil || 0,
        reason: window.__unexpectedTownReason || ''
      };
    } else {
      s.unexpectedTown = null;
    }
  } catch (e) {}
  try {
    s.bandwidth = (typeof window.__pmGetBandwidth === 'function') ? window.__pmGetBandwidth() : null;
  } catch (e) {}
  try {
    let pUntil = 0;
    let pActive = false;
    const exUntil = Number(window.__pmExchange && window.__pmExchange.premiumUntil) || 0;
    if (exUntil > Date.now()) {
      pUntil = exUntil;
      pActive = true;
    }
    let rStore = (typeof getReactStore === 'function') ? getReactStore() : null;
    const buffs = rStore && rStore.character && Array.isArray(rStore.character.buffs) ? rStore.character.buffs : [];
    const pBuff = buffs.find(b => b && (b.skillId === 'ui:token' || /premium/i.test(String(b.name || ''))));
    if (pBuff) {
      const ends = Number(pBuff.endsAt) || (Number(pBuff.remainingMs) > 0 ? (Date.now() + Number(pBuff.remainingMs)) : 0);
      if (ends > Date.now() || Number(pBuff.remainingMs) > 0) {
        pActive = true;
        if (ends > pUntil) pUntil = ends;
      }
    }
    if (!pActive) {
      const domBuff = document.querySelector('.hud-buffs img[src*="token"], .hud-buffs [title*="Premium" i]');
      if (domBuff) pActive = true;
    }
    s.hasPremium = pActive;
    s.premiumUntil = pUntil > 0 ? pUntil : null;
  } catch (e) {}
  try {
    s.zeroRender = Boolean(window.__pmZeroRender);
  } catch (e) {}
  try {
    if (typeof window.recordGrossZeny !== 'function') {
      window.recordGrossZeny = function(newZeny) {
        if (typeof newZeny !== 'number' || !Number.isFinite(newZeny) || newZeny < 0) return;
        const charKey = String((window.__latestCharacterData && window.__latestCharacterData.name) || window.__charName || '').trim();
        if (charKey && window.__grossZenyCharName && window.__grossZenyCharName !== charKey) {
          window.__lastGrossBaseZeny = newZeny;
          window.__grossZenyGained = 0;
          window.__grossZenyInitAt = Date.now();
        }
        if (charKey) window.__grossZenyCharName = charKey;
        if (typeof window.__grossZenyGained !== 'number' || !Number.isFinite(window.__grossZenyGained)) {
          window.__grossZenyGained = 0;
        }
        if (typeof window.__lastGrossBaseZeny !== 'number' || !Number.isFinite(window.__lastGrossBaseZeny)) {
          window.__lastGrossBaseZeny = newZeny;
          window.__grossZenyInitAt = Date.now();
          return;
        }
        if (window.__lastGrossBaseZeny === 0 && newZeny > 0 && (Date.now() - (window.__grossZenyInitAt || 0) < 8000)) {
          window.__lastGrossBaseZeny = newZeny;
          return;
        }
        const delta = newZeny - window.__lastGrossBaseZeny;
        if (delta > 0 && !window.__consolidationReceiverMode && !window.__isConsolidating) {
          window.__grossZenyGained += delta;
        }
        window.__lastGrossBaseZeny = newZeny;
      };
    }
    if (typeof window.__pmForceSyncCharZeny !== 'function') {
      window.__pmForceSyncCharZeny = function() {
        try {
          const root = document.querySelector('#root');
          const key = root ? Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber')) : null;
          let fiber = (root && key) ? root[key] : null;
          let charData = null, visited = 0;
          function walk(n, depth) {
            if (!n || depth > 40 || charData || ++visited > 350) return;
            if (n.memoizedProps) {
              if (n.memoizedProps.character && n.memoizedProps.character.stats) charData = n.memoizedProps.character;
              else if (n.memoizedProps.stats && n.memoizedProps.skills) charData = n.memoizedProps;
            }
            if (!charData && n.memoizedState) {
              let st = n.memoizedState, steps = 0;
              while (st && ++steps < 25) {
                const ms = st.memoizedState;
                if (ms && typeof ms === 'object') {
                  if (ms.character && ms.character.stats) { charData = ms.character; break; }
                  if (ms.stats && ms.skills) { charData = ms; break; }
                }
                st = st.next;
              }
            }
            if (n.child) walk(n.child, depth + 1);
            if (n.sibling) walk(n.sibling, depth + 1);
          }
          if (fiber) walk(fiber, 0);
          if (charData && typeof charData.zeny === 'number') {
            window.__latestCharacterData = charData;
            window.__currentZeny = charData.zeny;
            if (typeof window.recordGrossZeny === 'function') window.recordGrossZeny(charData.zeny);
          }
        } catch (_) {}
      };
    }
    if (!window.__grossZenyNative && !window.__pmGrossZenyHooked && typeof window.applyLiveCharacterPacket === 'function') {
      window.__pmGrossZenyHooked = true;
      const origApplyChar = window.applyLiveCharacterPacket;
      window.applyLiveCharacterPacket = function(charDec) {
        try {
          if (charDec && typeof charDec.zeny === 'number' && typeof window.recordGrossZeny === 'function') {
            window.recordGrossZeny(charDec.zeny);
          }
        } catch (_) {}
        return origApplyChar.apply(this, arguments);
      };
    }
    if (!window.__pmGrossClickHooked && typeof document !== 'undefined') {
      window.__pmGrossClickHooked = true;
      document.addEventListener('click', (ev) => {
        try {
          const el = ev.target && ev.target.closest ? ev.target.closest('button, div, span') : null;
          if (!el || (el.closest && el.closest('#pelican-hud'))) return;
          const txt = (el.innerText || '').trim();
          if (txt.includes('ยืนยันขาย') || txt === 'ซื้อ' || txt === 'ขาย' || txt.includes('รับเงิน') || txt.includes('รับทั้งหมด')) {
            if (typeof window.__pmForceSyncCharZeny === 'function') window.__pmForceSyncCharZeny();
            setTimeout(() => { try { if (typeof window.__pmForceSyncCharZeny === 'function') window.__pmForceSyncCharZeny(); } catch (_) {} }, 220);
            setTimeout(() => { try { if (typeof window.__pmForceSyncCharZeny === 'function') window.__pmForceSyncCharZeny(); } catch (_) {} }, 480);
            setTimeout(() => { try { if (typeof window.__pmForceSyncCharZeny === 'function') window.__pmForceSyncCharZeny(); } catch (_) {} }, 680);
          }
        } catch (_) {}
      }, true);
    }
    const room = (typeof window.getColyseusRoom === 'function' ? window.getColyseusRoom() : null) || window.__gameRoom || null;
    if (room && typeof room.send === 'function' && !room.__pmGrossSendHooked) {
      room.__pmGrossSendHooked = true;
      const origRoomSend = room.send;
      room.send = function(type) {
        try {
          const cmd = String(type || '');
          if (/shop_buy|shop_sell|market_buy|market_claim|market_collect|exchange|refine|warp|npc_option|trade/i.test(cmd)) {
            if (typeof window.__pmForceSyncCharZeny === 'function') window.__pmForceSyncCharZeny();
            setTimeout(() => { try { if (typeof window.__pmForceSyncCharZeny === 'function') window.__pmForceSyncCharZeny(); } catch (_) {} }, 250);
            setTimeout(() => { try { if (typeof window.__pmForceSyncCharZeny === 'function') window.__pmForceSyncCharZeny(); } catch (_) {} }, 600);
          }
        } catch (_) {}
        return origRoomSend.apply(this, arguments);
      };
    }
    if (window.__isShopping && typeof window.__pmForceSyncCharZeny === 'function') {
      window.__pmForceSyncCharZeny();
      if (typeof window.__currentZeny === 'number') s.zeny = window.__currentZeny;
    } else if (typeof s.zeny === 'number' && typeof window.recordGrossZeny === 'function') {
      window.recordGrossZeny(s.zeny);
    }
    s.grossZenyGained = (typeof window.__grossZenyGained === 'number' && Number.isFinite(window.__grossZenyGained)) ? window.__grossZenyGained : null;
    s.consolidationReceiverMode = Boolean(window.__consolidationReceiverMode || window.__isConsolidating);
  } catch (e) {}
  return s;
})()`;

const clientStateCacheByPort = new Map();
const clientStateInFlightByPort = new Map();

function queryClientState(port) {
  if (!port) return Promise.resolve(null);
  const now = Date.now();
  const cached = clientStateCacheByPort.get(port);
  if (cached && now - cached.ts < 950) {
    return Promise.resolve(cached.state);
  }
  if (clientStateInFlightByPort.has(port)) {
    return clientStateInFlightByPort.get(port);
  }
  const promise = new Promise((resolve) => {
    // 1. Try rich state via POST /api/eval (avoids HTTP URL/header overflow on large LIVE_STATE_EVAL)
    const payload = JSON.stringify({ code: LIVE_STATE_EVAL });
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: '/api/eval',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 1200
    }, (res) => {
      let data = "";
      res.setEncoding('utf8');
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.success && parsed.result) {
            return resolve(parsed.result);
          }
        } catch (e) {}
        queryStandardState(port).then(resolve);
      });
    });
    req.on("error", () => queryStandardState(port).then(resolve));
    req.on("timeout", () => {
      req.destroy();
      queryStandardState(port).then(resolve);
    });
    req.write(payload);
    req.end();
  }).then((state) => {
    clientStateInFlightByPort.delete(port);
    if (state) clientStateCacheByPort.set(port, { ts: Date.now(), state });
    return state;
  }).catch(() => {
    clientStateInFlightByPort.delete(port);
    return null;
  });
  clientStateInFlightByPort.set(port, promise);
  return promise;
}

function queryStandardState(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/state`, { timeout: 700 }, (res) => {
      let data = "";
      res.setEncoding('utf8');
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
  });
}

// Windows can reserve blocks of ports for Hyper-V / WSL / Docker (`netsh int ipv4 show excludedportrange
// protocol=tcp`) or give a port in the dynamic range (49152+) to another program. The game loader then cannot
// listen on the profile's debugPort and the Manager gets ECONNREFUSED (card stuck on "connecting"). Before
// launching, move such a profile to a free port below the dynamic range.
const reservedDebugPorts = new Set();
function canListenOn(port) {
  return new Promise((resolve) => {
    const srv = require("net").createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}
function portAnswers(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, { timeout: 1500 }, (res) => { res.resume(); resolve(true); });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}
// Is this profile's game window already open? runningProcesses is lost when the Manager restarts (updates)
// while the detached game windows keep running, so also ask the profile's port (loader or browser proxy).
async function clientAlreadyOpen(p) {
  if (browserMode.isOpen(p.id)) return true;
  if (runningProcesses[p.id] && isProcessAlive(runningProcesses[p.id].pid)) return true;
  return Boolean(p.debugPort) && await portAnswers(p.debugPort);
}

async function ensureUsableDebugPort(profileId) {
  const profiles = loadProfiles();
  const p = profiles.find(x => x.id === profileId);
  if (!p) return null;
  const port = Number(p.debugPort) || 49876;
  if (await canListenOn(port) || await portAnswers(port)) return p;   // free, or one of our clients already answers there
  const used = new Set([...profiles.map(x => Number(x.debugPort)).filter(Boolean), ...reservedDebugPorts]);
  for (let cand = 38760; cand < 39760; cand++) {
    if (used.has(cand) || !(await canListenOn(cand))) continue;
    reservedDebugPorts.add(cand);
    const fresh = loadProfiles();
    const target = fresh.find(x => x.id === profileId);
    if (!target) return p;
    target.debugPort = cand;
    saveProfiles(fresh);
    console.log(`[PmheeAether Manager] 🔌 Port ${port} of "${target.name}" cannot be used on this PC (reserved by Windows or taken) -> moved to ${cand}`);
    return { ...target, movedFromPort: port };
  }
  return p;
}

// ---------- game item data for the gear set editor (GET /api/game-items) ----------
const GAME_SITE = "https://www.aetheria-online.in.th";
const GAME_ITEMS_CACHE = path.join(__dirname, "data", "game_items_cache.json");
let gameItemsMem = null, gameItemsLoading = null;
function getUrlJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "PmheeAether-Manager" }, timeout: 20000 }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let d = "";
      res.setEncoding("utf8");
      res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on("error", reject).on("timeout", function () { this.destroy(new Error("timeout")); });
  });
}
async function getGameItems() {
  const fresh = x => x && Date.now() - (x.retryAt || x.fetchedAt + 6 * 3600 * 1000) < 0;
  if (fresh(gameItemsMem)) return gameItemsMem;
  if (!gameItemsLoading) gameItemsLoading = fetchGameItems().finally(() => { gameItemsLoading = null; });
  return gameItemsLoading;
}
async function fetchGameItems() {
  try {
    const [wiki, icons] = await Promise.all([getUrlJson(`${GAME_SITE}/wiki-data`), getUrlJson(`${GAME_SITE}/art/icons/manifest.json`).catch(() => ({}))]);
    const iconOf = id => { const p = icons && icons.items && icons.items[id]; return p ? `${GAME_SITE}/art/icons/${p}` : null; };
    const items = (wiki.items || []).filter(i => i.type === "Equipment" && i.equipmentType && i.equipmentType !== "Ammo" && !/^Costume/.test(i.equipmentType))
      .map(i => ({
        id: i.id, name: i.name, slotType: i.equipmentType, weaponType: i.weaponType, level: i.equipLevelMin || 0,
        rarity: i.rarity, refineable: !!i.refineable, slots: i.slots || 0, weaponLevel: i.weaponLevel || 0,
        jobs: i.jobs || [], attributes: (i.attributes || []).slice(0, 4).map(a => ({ type: a.type, value: a.value, perRefine: a.perRefine || 0 })),
        specials: (i.specials || []).slice(0, 2), soldBy: (i.soldBy || []).map(x => x.shop).slice(0, 1), icon: iconOf(i.id)
      }));
    const classes = (wiki.classes || []).map(c => ({ id: c.id, name: c.name, tier: c.tier }));
    const cards = (wiki.items || []).filter(i => i.type === "Card").map(i => ({
      id: i.id, name: i.name, rarity: i.rarity, cardSlotTypes: i.cardSlotTypes || [],
      attributes: (i.attributes || []).slice(0, 4).map(a => ({ type: a.type, value: a.value })), icon: iconOf(i.id)
    }));
    gameItemsMem = { fetchedAt: Date.now(), items, classes, cards };
    try { fs.mkdirSync(path.dirname(GAME_ITEMS_CACHE), { recursive: true }); fs.writeFileSync(GAME_ITEMS_CACHE, JSON.stringify(gameItemsMem)); } catch (e) {}
    return gameItemsMem;
  } catch (e) {
    if (!gameItemsMem) { try { gameItemsMem = JSON.parse(fs.readFileSync(GAME_ITEMS_CACHE, "utf8")); } catch (e2) {} }
    if (gameItemsMem) { gameItemsMem.retryAt = Date.now() + 30 * 60 * 1000; return gameItemsMem; }
    throw new Error("โหลดรายการไอเทมจากเว็บเกมไม่สำเร็จ: " + e.message);
  }
}

function evalProfilePort(port, code, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!port) return resolve({ success: false, error: 'No debug port' });
    const payload = JSON.stringify({ code });
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: '/api/eval',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: timeoutMs
    }, (res) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { resolve({ success: true, result: d }); }
      });
    });
    req.on('error', err => resolve({ success: false, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Timeout' });
    });
    req.write(payload);
    req.end();
  });
}

const profileClientActionQueues = new Map();
function enqueueProfileClientAction(profileId, taskFn) {
  const key = String(profileId || '');
  const prev = profileClientActionQueues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => taskFn());
  profileClientActionQueues.set(key, next.finally(() => {
    if (profileClientActionQueues.get(key) === next) {
      profileClientActionQueues.delete(key);
    }
  }));
  return next;
}

function buildClientActionEvalCode(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (payload.type === 'set-farm-map') {
    return `(() => {
      const map = ${JSON.stringify(payload.map)};
      if (typeof window.clearSafeMap === 'function') window.clearSafeMap('เลือกแมพจาก Manager');
      window.__targetFarmMap = map;
      try { localStorage.setItem('pelican_farm_map', map); } catch(e){}
      const mapSelect = document.getElementById('p-target-map-select');
      if (mapSelect) mapSelect.value = map;
      if (typeof window.rememberFarmMap === 'function') window.rememberFarmMap(map);
      if (window.__planScriptEnabled && typeof window.setPlanManualMap === 'function') window.setPlanManualMap(map);
      if (typeof window.setTargetFarmMap === 'function') window.setTargetFarmMap(map);
      if (typeof window.syncAllHudInputsFromConfig === 'function') window.syncAllHudInputsFromConfig();
      return { success: true };
    })()`;
  } else if (payload.type === 'toggle-auto-loop') {
    return `(() => {
      const en = ${Boolean(payload.enabled)};
      window.__autoLoopEnabled = en;
      try { localStorage.setItem('pelican_auto_loop', String(en)); } catch(e){}
      const loopCb = document.getElementById('p-auto-loop');
      if (loopCb) loopCb.checked = en;
      if (typeof updateMasterBotUI === 'function') updateMasterBotUI();
      if (typeof window.syncAllHudInputsFromConfig === 'function') window.syncAllHudInputsFromConfig();
      return { success: true, autoLoopEnabled: en };
    })()`;
  } else if (payload.type === 'toggle-plan-script') {
    return `(() => {
      const en = ${Boolean(payload.enabled)};
      window.__planScriptEnabled = en;
      try { localStorage.setItem('pelican_plan_script_enabled', String(en)); } catch(e){}
      const planCb = document.getElementById('p-plan-script-enabled');
      if (planCb) planCb.checked = en;
      if (en) {
        if (typeof window.applyPelicanSettings === 'function') window.applyPelicanSettings();
        if (typeof window.autoConfigureCombat === 'function') window.autoConfigureCombat();
      }
      if (typeof window.syncAllHudInputsFromConfig === 'function') window.syncAllHudInputsFromConfig();
      return { success: true, planScriptEnabled: en };
    })()`;
  } else if (payload.type === 'update-travel') {
    return `(() => {
      if (!window.__travelConfig) window.__travelConfig = {};
      const minZ = Math.max(0, parseInt(${JSON.stringify(payload.minZenyForWarp)}, 10) || 0);
      window.__travelConfig.minZenyForWarp = minZ;
      try { localStorage.setItem('pelican_travel_cfg', JSON.stringify(window.__travelConfig)); } catch(e){}
      if (typeof window.saveTravelConfig === 'function') window.saveTravelConfig();
      const inp = document.getElementById('p-warp-min-zeny');
      if (inp) inp.value = String(minZ);
      if (typeof window.syncAllHudInputsFromConfig === 'function') window.syncAllHudInputsFromConfig();
      return { success: true, minZenyForWarp: minZ };
    })()`;
  } else if (payload.type === 'toggle-unexpected-town-guard') {
    return `(() => {
      const en = ${Boolean(payload.enabled)};
      window.__unexpectedTownGuardEnabled = en;
      try { localStorage.setItem('pelican_unexpected_town_guard', String(en)); } catch(e){}
      const cb = document.getElementById('p-unexpected-town-guard');
      if (cb) cb.checked = en;
      if (typeof window.syncAllHudInputsFromConfig === 'function') window.syncAllHudInputsFromConfig();
      return { success: true, enabled: en };
    })()`;
  } else if (payload.type === 'skip-unexpected-wait') {
    return `(() => {
      if (typeof window.skipUnexpectedTownWait === 'function') window.skipUnexpectedTownWait();
      return { success: true };
    })()`;
  } else if (payload.type === 'update-humanize') {
    return `(() => {
      if (!window.__humanizeConfig) window.__humanizeConfig = {};
      const patch = ${JSON.stringify(payload.config || {})};
      Object.assign(window.__humanizeConfig, patch);
      if (patch.chance !== undefined) window.__humanizeConfig.chancePercent = Number(patch.chance);
      if (patch.chancePercent !== undefined) window.__humanizeConfig.chance = Number(patch.chancePercent);
      if (patch.buyBlacksmith !== undefined) window.__humanizeConfig.visitBlacksmith = !!patch.buyBlacksmith;
      if (patch.visitBlacksmith !== undefined) window.__humanizeConfig.buyBlacksmith = !!patch.visitBlacksmith;
      if (patch.buySundries !== undefined) window.__humanizeConfig.visitSundries = !!patch.buySundries;
      if (patch.visitSundries !== undefined) window.__humanizeConfig.buySundries = !!patch.visitSundries;
      if (patch.storeDeposit !== undefined) window.__humanizeConfig.openStorage = !!patch.storeDeposit;
      if (patch.openStorage !== undefined) window.__humanizeConfig.storeDeposit = !!patch.openStorage;
      try {
        localStorage.setItem('pelican_humanize_cfg', JSON.stringify(window.__humanizeConfig));
        localStorage.setItem('pelican_humanize_config', JSON.stringify(window.__humanizeConfig));
      } catch(e){}
      const c = window.__humanizeConfig;
      const setCb = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined) el.checked = !!v; };
      if (patch.enabled !== undefined) setCb('p-humanize-enabled', c.enabled);
      if (patch.buyBlacksmith !== undefined || patch.visitBlacksmith !== undefined) setCb('p-humanize-blacksmith', c.buyBlacksmith ?? c.visitBlacksmith);
      if (patch.buySundries !== undefined || patch.visitSundries !== undefined) setCb('p-humanize-sundries', c.buySundries ?? c.visitSundries);
      if (patch.randomWalk !== undefined) setCb('p-humanize-walk', c.randomWalk);
      if (patch.storeDeposit !== undefined || patch.openStorage !== undefined) setCb('p-humanize-storage', c.storeDeposit ?? c.openStorage);
      const chEl = document.getElementById('p-humanize-chance');
      if (chEl && (patch.chance !== undefined || patch.chancePercent !== undefined)) chEl.value = String(c.chance ?? c.chancePercent);
      if (typeof window.syncAllHudInputsFromConfig === 'function') window.syncAllHudInputsFromConfig();
      return { success: true };
    })()`;
  } else if (payload.type === 'test-humanize') {
    return `(() => {
      window.__isManualTestingHumanize = true;
      if (typeof window.runHumanizeRoutine === 'function') window.runHumanizeRoutine(() => {});
      return { success: true };
    })()`;
  } else if (payload.type === 'toggle-ultra-low-spec') {
    return `(() => {
      const en = ${Boolean(payload.enabled)};
      window.__ultraLowSpecEnabled = en;
      try { localStorage.setItem('pelican_ultra_low_spec', en ? 'true' : 'false'); } catch(e){}
      if (typeof window.setUltraLowSpecMode === 'function') window.setUltraLowSpecMode(en);
      const cb = document.getElementById('p-ultra-low-spec');
      if (cb) cb.checked = en;
      if (typeof window.syncAllHudInputsFromConfig === 'function') window.syncAllHudInputsFromConfig();
      return { success: true, ultraLowSpecEnabled: en };
    })()`;
  } else if (payload.type === 'update-auto-config') {
    return `(() => {
      const cfg = ${JSON.stringify(payload.config || {})};
      if (cfg.autoConfigCharEnabled !== undefined) {
        window.__autoConfigCharEnabled = !!cfg.autoConfigCharEnabled;
        try { localStorage.setItem('pelican_auto_config_char_enabled', String(!!cfg.autoConfigCharEnabled)); } catch(e){}
        const el = document.getElementById('p-auto-config-char');
        if (el) el.checked = !!cfg.autoConfigCharEnabled;
        if (cfg.autoConfigCharEnabled && typeof window.autoConfigureCombat === 'function') window.autoConfigureCombat(true);
      }
      if (cfg.autoMuteDisplayEnabled !== undefined) {
        window.__autoMuteDisplayEnabled = !!cfg.autoMuteDisplayEnabled;
        try { localStorage.setItem('pelican_auto_mute_display_enabled', String(!!cfg.autoMuteDisplayEnabled)); } catch(e){}
        const el = document.getElementById('p-auto-mute-display');
        if (el) el.checked = !!cfg.autoMuteDisplayEnabled;
        if (cfg.autoMuteDisplayEnabled && typeof window.applyPelicanSettings === 'function') window.applyPelicanSettings(true);
      }
      if (typeof window.syncAllHudInputsFromConfig === 'function') window.syncAllHudInputsFromConfig();
      return { success: true };
    })()`;
  } else if (payload.type === 'apply-autoconfig-now') {
    return `(async () => {
      if (typeof window.applyPelicanSettings === 'function') window.applyPelicanSettings(true);
      let ok = false;
      if (typeof window.autoConfigureCombat === 'function') ok = await window.autoConfigureCombat(true);
      return { success: true, applied: ok };
    })()`;
  } else if (payload.type === 'walk-to-map') {
    return `(() => {
      const select = document.getElementById('p-target-map-select');
      const targetMap = (select ? select.value : '') || window.__targetFarmMap;
      if (typeof window.walkToTargetMap === 'function') window.walkToTargetMap(targetMap, true);
      else if (typeof window.startWalkToTargetMap === 'function') window.startWalkToTargetMap();
      return { success: true };
    })()`;
  } else if (payload.type === 'open-world-map') {
    return `(() => {
      if (typeof window.openWorldMap === 'function') window.openWorldMap();
      else if (typeof window.toggleWorldMapModal === 'function') window.toggleWorldMapModal();
      return { success: true };
    })()`;
  } else if (payload.type === 'update-archer') {
    const cfg = payload.config || {};
    return `(() => {
      if (!window.__archerConfig) window.__archerConfig = {};
      const patch = ${JSON.stringify(cfg)};
      Object.assign(window.__archerConfig, patch);
      try { localStorage.setItem('pelican_archer_cfg', JSON.stringify(window.__archerConfig)); } catch(e){}
      const reqEl = document.getElementById('p-archer-req');
      if (reqEl && patch.requireArrow !== undefined) reqEl.checked = !!window.__archerConfig.requireArrow;
      const autoEqEl = document.getElementById('p-archer-auto-equip');
      if (autoEqEl && patch.autoEquipArrow !== undefined) autoEqEl.checked = !!window.__archerConfig.autoEquipArrow;
      const typeEl = document.getElementById('p-archer-type');
      if (typeEl && patch.arrowType !== undefined) typeEl.value = String(window.__archerConfig.arrowType);
      const qtyEl = document.getElementById('p-archer-qty');
      if (qtyEl && patch.arrowBuyQty !== undefined) qtyEl.value = String(window.__archerConfig.arrowBuyQty);
      const threshEl = document.getElementById('p-archer-threshold');
      if (threshEl && patch.ammoThreshold !== undefined) threshEl.value = String(window.__archerConfig.ammoThreshold);
      const bwingEl = document.getElementById('p-archer-bwing');
      if (bwingEl && patch.useBwing !== undefined) bwingEl.checked = !!window.__archerConfig.useBwing;
      const bwingQtyEl = document.getElementById('p-archer-bwing-qty');
      if (bwingQtyEl && patch.bwingBuyQty !== undefined) bwingQtyEl.value = String(window.__archerConfig.bwingBuyQty);
      if (typeof updateMasterBotUI === 'function') updateMasterBotUI();
      if (typeof updateAmmoHUD === 'function') updateAmmoHUD();
      if (typeof window.syncAllHudInputsFromConfig === 'function') window.syncAllHudInputsFromConfig();
      return { success: true };
    })()`;
  } else if (payload.type === 'sync-ammo') {
    return `(() => {
      if (typeof window.syncAmmoFromDOM === 'function') window.syncAmmoFromDOM();
      if (typeof window.updateAmmoHUD === 'function') window.updateAmmoHUD();
      return { ammo: window.__currentAmmo };
    })()`;
  } else if (payload.type === 'zero-ammo') {
    return `(() => {
      window.__currentAmmo = 0;
      try { localStorage.setItem('pelican_current_ammo', '0'); } catch(e){}
      if (typeof window.updateAmmoHUD === 'function') window.updateAmmoHUD();
      return { ammo: 0 };
    })()`;
  } else if (payload.type === 'update-buff-potions') {
    const cfg = payload.config || {};
    return `(() => {
      if (!window.__buffPotionConfig) window.__buffPotionConfig = {};
      const patch = ${JSON.stringify(cfg)};
      for (const k of Object.keys(patch)) {
        if (patch[k] && typeof patch[k] === 'object') {
          window.__buffPotionConfig[k] = Object.assign({}, window.__buffPotionConfig[k] || {}, patch[k]);
          const pCfg = window.__buffPotionConfig[k];
          const enEl = document.getElementById('p-potion-enable-' + k);
          if (enEl && pCfg.enabled !== undefined) enEl.checked = !!pCfg.enabled;
          const qtyEl = document.getElementById('p-potion-qty-' + k);
          if (qtyEl && pCfg.targetQty !== undefined) qtyEl.value = String(pCfg.targetQty);
        }
      }
      try { localStorage.setItem('pelican_buff_potions_cfg', JSON.stringify(window.__buffPotionConfig)); } catch(e){}
      if (typeof window.saveBuffPotionConfig === 'function') window.saveBuffPotionConfig();
      if (typeof window.syncBuffPotionsToGame === 'function') window.syncBuffPotionsToGame();
      if (typeof window.updatePotionHUD === 'function') window.updatePotionHUD();
      if (typeof window.syncAllHudInputsFromConfig === 'function') window.syncAllHudInputsFromConfig();
      return { success: true };
    })()`;
  } else if (payload.type === 'sync-buff-potions') {
    return `(() => {
      if (typeof window.syncBuffPotionsToGame === 'function') window.syncBuffPotionsToGame(true);
      return { success: true };
    })()`;
  } else if (payload.type === 'buy-buff-potions') {
    return `(() => {
      if (typeof window.manualRestockBuffPotions === 'function') window.manualRestockBuffPotions();
      return { success: true };
    })()`;
  } else if (payload.type === 'update-sell') {
    const cfg = payload.config || {};
    return `(() => {
      if (!window.__sellConfig) window.__sellConfig = {};
      const patch = ${JSON.stringify(cfg)};
      const sfPatch = (patch.statsFilterPatch && typeof patch.statsFilterPatch === 'object') ? patch.statsFilterPatch : null;
      if (sfPatch) {
        if (!window.__sellConfig.statsFilter || typeof window.__sellConfig.statsFilter !== 'object') {
          window.__sellConfig.statsFilter = {};
        }
        Object.assign(window.__sellConfig.statsFilter, sfPatch);
        delete patch.statsFilterPatch;
      }
      Object.assign(window.__sellConfig, patch);
      if (patch.weaponRarity !== undefined) {
        window.__sellConfig.sellWeapons = window.__sellConfig.weaponRarity !== 'none';
      }
      if (patch.armorRarity !== undefined) {
        window.__sellConfig.sellArmors = window.__sellConfig.armorRarity !== 'none';
      }
      try { localStorage.setItem('pelican_sell_cfg', JSON.stringify(window.__sellConfig)); } catch(e){}
      if (typeof window.refreshStoreHud === 'function') window.refreshStoreHud();
      const trashEl = document.getElementById('p-sell-enabled') || document.getElementById('p-sell-trash');
      if (trashEl && patch.enabled !== undefined) trashEl.checked = !!window.__sellConfig.enabled;
      const wChkEl = document.getElementById('p-weight-check-enabled');
      if (wChkEl && patch.weightCheckEnabled !== undefined) wChkEl.checked = !!window.__sellConfig.weightCheckEnabled;
      const weightEl = document.getElementById('p-weight-threshold') || document.getElementById('p-sell-weight');
      if (weightEl && patch.weightThreshold !== undefined) weightEl.value = String(window.__sellConfig.weightThreshold);
      const weapEl = document.getElementById('p-sell-rarity-weap') || document.getElementById('p-sell-weap');
      if (weapEl && patch.weaponRarity !== undefined) weapEl.value = String(window.__sellConfig.weaponRarity);
      const armorEl = document.getElementById('p-sell-rarity-armor') || document.getElementById('p-sell-armor');
      if (armorEl && patch.armorRarity !== undefined) armorEl.value = String(window.__sellConfig.armorRarity);
      const accEl = document.getElementById('p-sell-rarity-acc');
      if (accEl && patch.accRarity !== undefined) accEl.value = String(window.__sellConfig.accRarity);
      const matEl = document.getElementById('p-sell-rarity-mat');
      if (matEl && (patch.sellMaterials !== undefined || patch.materialMode !== undefined)) {
        matEl.value = !window.__sellConfig.sellMaterials ? 'none' : (window.__sellConfig.materialMode === 'common' ? 'common' : 'all');
      }
      const oreEl = document.getElementById('p-sell-refine-ores');
      if (oreEl && patch.sellRefineOres !== undefined) {
        oreEl.value = window.__sellConfig.sellRefineOres ? 'unlisted' : 'keep';
      }
      const refEl = document.getElementById('p-sell-keep-refined');
      if (refEl && patch.keepRefined !== undefined) refEl.checked = !!window.__sellConfig.keepRefined;
      const specEl = document.getElementById('p-sell-keep-special');
      if (specEl && patch.keepSpecial !== undefined) specEl.checked = !!window.__sellConfig.keepSpecial;
      const sockEl = document.getElementById('p-sell-keep-sockets');
      if (sockEl && patch.keepSockets !== undefined) sockEl.checked = !!window.__sellConfig.keepSockets;
      [
        ['p-store-enabled', 'storeEnabled'],
        ['p-store-weapon', 'storeWeapon'],
        ['p-store-armor', 'storeArmor'],
        ['p-store-acc', 'storeAcc'],
        ['p-store-refine', 'storeRefine'],
        ['p-store-skip-locked', 'storeSkipLocked'],
        ['p-store-refined', 'storeRefined'],
        ['p-store-special', 'storeSpecial'],
        ['p-store-sockets', 'storeSockets'],
        ['p-store-cards', 'storeCards'],
        ['p-store-whitelist', 'storeWhitelist']
      ].forEach(([elId, key]) => {
        if (patch[key] !== undefined) {
          const el = document.getElementById(elId);
          if (el) el.checked = !!window.__sellConfig[key];
        }
      });
      const wlEl = document.getElementById('p-sell-whitelist');
      if (wlEl && patch.whitelist !== undefined) wlEl.value = String(window.__sellConfig.whitelist);
      if (sfPatch) {
        const sf = window.__sellConfig.statsFilter || {};
        const setSfCb = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined) el.checked = !!v; };
        if (sfPatch.enabled !== undefined) setSfCb('p-statfilter-toggle', sf.enabled);
        if (sfPatch.filterWeapons !== undefined) setSfCb('p-statfilter-weap', sf.filterWeapons);
        if (sfPatch.filterArmors !== undefined) setSfCb('p-statfilter-armor', sf.filterArmors);
        if (sfPatch.filterAccessories !== undefined) setSfCb('p-statfilter-acc', sf.filterAccessories);
        if (sfPatch.protectGems !== undefined) setSfCb('p-statfilter-protect-gems', sf.protectGems);
        if (sfPatch.minOptions !== undefined) {
          const minEl = document.getElementById('p-statfilter-min-opts');
          if (minEl) minEl.value = String(sf.minOptions || 2);
        }
      }
      if (typeof window.renderSellStatsFilterUI === 'function') window.renderSellStatsFilterUI();
      if (typeof window.syncAllHudInputsFromConfig === 'function') window.syncAllHudInputsFromConfig();
      return { success: true };
    })()`;
  } else if (payload.type === 'sort-inventory') {
    return `if (typeof window.refreshInventoryAndWeight === 'function') window.refreshInventoryAndWeight(null, true);`;
  } else if (payload.type === 'test-sell') {
    return `if (typeof window.executeSellTrashAtNpc === 'function') window.executeSellTrashAtNpc(true);`;
  } else if (payload.type === 'update-auth') {
    const cfg = payload.config || {};
    return `(() => {
      if (!window.__authConfig) window.__authConfig = {};
      const patch = ${JSON.stringify(cfg)};
      Object.assign(window.__authConfig, patch);
      try { localStorage.setItem('pelican_auth_cfg', JSON.stringify(window.__authConfig)); } catch(e){}
      const authEn = document.getElementById('p-auth-enabled');
      if (authEn && patch.enabled !== undefined) authEn.checked = !!window.__authConfig.enabled;
      const authUs = document.getElementById('p-auth-user');
      if (authUs && patch.username !== undefined) authUs.value = String(window.__authConfig.username);
      const authPs = document.getElementById('p-auth-pass');
      if (authPs && patch.password !== undefined) authPs.value = String(window.__authConfig.password);
      const authCh = document.getElementById('p-auth-char');
      if (authCh && patch.charName !== undefined) authCh.value = String(window.__authConfig.charName || '');
      const authRes = document.getElementById('p-auth-resume');
      if (authRes && patch.autoResumeBot !== undefined) authRes.checked = !!window.__authConfig.autoResumeBot;
      if (typeof window.syncAllHudInputsFromConfig === 'function') window.syncAllHudInputsFromConfig();
      return { success: true };
    })()`;
  } else if (payload.type === 'update-autosell') {
    return `(() => {
      if (!window.__autoMarketSellConfig) window.__autoMarketSellConfig = { enabled: false, rules: [] };
      const patch = ${JSON.stringify(payload.config || {})};
      Object.assign(window.__autoMarketSellConfig, patch);
      try { localStorage.setItem('pelican_auto_market_sell_cfg', JSON.stringify(window.__autoMarketSellConfig)); } catch(e){}
      const en = !!window.__autoMarketSellConfig.enabled;
      const t1 = document.getElementById('p-autosell-toggle');
      if (t1) t1.checked = en;
      const t2 = document.getElementById('p-autosell-toggle-hud');
      if (t2) t2.checked = en;
      const badge = document.getElementById('p-subtab-autosell-count');
      if (badge && Array.isArray(window.__autoMarketSellConfig.rules)) badge.innerText = String(window.__autoMarketSellConfig.rules.length);
      if (typeof window.renderAutoSellHudRulesHtml === 'function') {
        const hudContainer = document.getElementById('p-autosell-hud-rules-container');
        if (hudContainer) hudContainer.innerHTML = window.renderAutoSellHudRulesHtml();
      }
      if (typeof window.renderAutoSellRulesRows === 'function') {
        const tbody = document.getElementById('p-autosell-rules-tbody');
        if (tbody) tbody.innerHTML = window.renderAutoSellRulesRows();
      }
      if (typeof updateMasterBotUI === 'function') updateMasterBotUI();
      if (typeof window.syncAllHudInputsFromConfig === 'function') window.syncAllHudInputsFromConfig();
      return { success: true };
    })()`;
  } else if (payload.type === 'add-autosell-rule') {
    return `if (typeof window.addAutoMarketSellRule === 'function') window.addAutoMarketSellRule(${JSON.stringify(payload.itemName || '')});`;
  } else if (payload.type === 'remove-autosell-rule') {
    return `if (typeof window.removeAutoMarketSellRule === 'function') window.removeAutoMarketSellRule(${JSON.stringify(payload.ruleId)});`;
  } else if (payload.type === 'trigger-autosell-now') {
    return `if (typeof window.runAutoMarketSellCycle === 'function') window.runAutoMarketSellCycle(true);`;
  } else if (payload.type === 'market-search') {
    return `(() => {
      const kw = ${JSON.stringify(payload.keyword || '')};
      const input = document.getElementById('p-mk-keyword');
      if (input) input.value = kw;
      if (kw && typeof window.searchMarketByKeyword === 'function') {
        window.searchMarketByKeyword(kw);
      } else if (typeof window.startMarketSearch === 'function') {
        window.startMarketSearch();
      }
      return { success: true };
    })()`;
  } else if (payload.type === 'export-config') {
    return `(typeof window.exportAllBotSettings === 'function' ? window.exportAllBotSettings() : null)`;
  } else if (payload.type === 'import-config') {
    return `(() => {
      try {
        if (typeof window.freeBotLocalStorageSpace === 'function') window.freeBotLocalStorageSpace(true);
        const s = Object.getPrototypeOf(window.localStorage);
        const len = window.localStorage.length;
        const drop = [];
        for (let i = 0; i < len; i++) {
          const k = s.key.call(window.localStorage, i);
          if (k && (k.startsWith('webgame.chat.') || k === 'pelican_item_catalog' || k === 'pelican_latest_inventory' || k === 'pelican_icon_manifest' || /__(?:icon_manifest|item_catalog|latest_inventory|packet_logs|last_weight)$/.test(k))) drop.push(k);
        }
        drop.forEach(k => s.removeItem.call(window.localStorage, k));
      } catch (e) {}
      return typeof window.importAllBotSettings === 'function' ? window.importAllBotSettings(${JSON.stringify(payload.configJson)}) : { success: false, error: 'import function not available' };
    })()`;
  } else if (payload.type === 'eval' && payload.code) {
    return payload.code;
  }
  return '';
}

// ==========================================
// STASH-ONLY & CONSOLIDATION ITEM SETTINGS
// ==========================================
const CONSOLIDATION_ITEMS_FILE = path.join(__dirname, "data", "consolidation_items.json");
const DEFAULT_CONSOLIDATION_ITEMS_CFG = {
  storeOnlyEnabled: false,
  tradeOnConsolidate: false,
  items: ["Enchant Rune"]
};

function sanitizeConsolidationItemsList(items) {
  const raw = Array.isArray(items)
    ? items
    : (typeof items === "string" ? items.split(",") : DEFAULT_CONSOLIDATION_ITEMS_CFG.items);
  const seen = new Set();
  const out = [];
  for (const x of raw) {
    const s = String(x || "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.length > 0 ? out : ["Enchant Rune"];
}

function loadConsolidationItemSettings() {
  try {
    if (fs.existsSync(CONSOLIDATION_ITEMS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONSOLIDATION_ITEMS_FILE, "utf8") || "{}");
      return {
        storeOnlyEnabled: Boolean(parsed.storeOnlyEnabled),
        tradeOnConsolidate: Boolean(parsed.tradeOnConsolidate),
        items: sanitizeConsolidationItemsList(parsed.items)
      };
    }
  } catch (e) {}
  return { ...DEFAULT_CONSOLIDATION_ITEMS_CFG, items: [...DEFAULT_CONSOLIDATION_ITEMS_CFG.items] };
}

function saveConsolidationItemSettings(cfg = {}) {
  const cur = loadConsolidationItemSettings();
  const next = {
    storeOnlyEnabled: typeof cfg.storeOnlyEnabled === "boolean" ? cfg.storeOnlyEnabled : cur.storeOnlyEnabled,
    tradeOnConsolidate: typeof cfg.tradeOnConsolidate === "boolean" ? cfg.tradeOnConsolidate : cur.tradeOnConsolidate,
    items: cfg.items !== undefined ? sanitizeConsolidationItemsList(cfg.items) : cur.items
  };
  try {
    fs.mkdirSync(path.dirname(CONSOLIDATION_ITEMS_FILE), { recursive: true });
    fs.writeFileSync(CONSOLIDATION_ITEMS_FILE, JSON.stringify(next, null, 2), "utf8");
  } catch (e) {}
  return next;
}

// Build eval code to sync stashTradeConfig AND ensure standalone helpers exist on clients that haven't reloaded yet
function buildStashTradeSyncEvalCode(cfg) {
  const safeCfg = {
    storeOnlyEnabled: Boolean(cfg && cfg.storeOnlyEnabled),
    tradeOnConsolidate: Boolean(cfg && cfg.tradeOnConsolidate),
    items: sanitizeConsolidationItemsList(cfg && cfg.items)
  };
  return `(() => {
    const cfg = ${JSON.stringify(safeCfg)};
    window.__stashTradeConfig = cfg;
    try { localStorage.setItem('pelican_stash_trade_cfg', JSON.stringify(cfg)); } catch (e) {}

    const isRealBagInv = (o) => Boolean(
      o && typeof o === 'object' && Array.isArray(o.items) &&
      o.feeZeny === undefined &&
      (typeof o.weight === 'number' || typeof o.weightLimit === 'number')
    );

    if (typeof window.applyLiveInventoryPacket === 'function' && !window.applyLiveInventoryPacket.__storageGuarded) {
      const origApply = window.applyLiveInventoryPacket;
      const guarded = function(dec, silent) {
        if (!isRealBagInv(dec)) {
          if (dec && typeof dec === 'object' && Array.isArray(dec.items) && dec.feeZeny !== undefined) {
            window.__latestStorage = dec;
          }
          return;
        }
        return origApply.apply(this, arguments);
      };
      guarded.__storageGuarded = true;
      window.applyLiveInventoryPacket = guarded;
    }

    const readAuthoritativeBagInventory = () => {
      try {
        const root = document.querySelector('#root');
        const key = root ? Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber')) : null;
        const fiber = (root && key) ? root[key] : null;
        let invData = null;
        let visited = 0;
        function walk(n, depth = 0) {
          if (!n || depth > 45 || invData || ++visited > 900) return;
          if (n.memoizedProps) {
            if (isRealBagInv(n.memoizedProps.inventory)) { invData = n.memoizedProps.inventory; return; }
            if (isRealBagInv(n.memoizedProps)) { invData = n.memoizedProps; return; }
          }
          if (!invData && n.memoizedState) {
            let s = n.memoizedState, steps = 0;
            while (s && ++steps < 30) {
              const ms = s.memoizedState;
              if (ms && typeof ms === 'object') {
                if (isRealBagInv(ms.inventory)) { invData = ms.inventory; break; }
                if (isRealBagInv(ms)) { invData = ms; break; }
              }
              s = s.next;
            }
          }
          if (n.child) walk(n.child, depth + 1);
          if (n.sibling) walk(n.sibling, depth + 1);
        }
        if (fiber) walk(fiber);
        if (isRealBagInv(invData)) {
          window.__latestInventory = invData;
          return invData;
        }
      } catch (e) {}
      if (isRealBagInv(window.__latestInventory)) return window.__latestInventory;
      return null;
    };
    window.__readAuthoritativeBagInventory = readAuthoritativeBagInventory;
    readAuthoritativeBagInventory();

    const KNOWN_IDS = { 'enchant rune': 90340, 'accessory enchant rune': 90341, 'rough elunium': 90204, 'elunium': 90205, 'enriched elunium': 90206, 'oridecon': 90203, 'phracon': 90201, 'emveretarcon': 90202 };
    window.matchesStashItemList = function(itemOrName, listOverride) {
      const list = Array.isArray(listOverride) ? listOverride : (window.__stashTradeConfig && Array.isArray(window.__stashTradeConfig.items) ? window.__stashTradeConfig.items : []);
      if (!list.length) return false;
      const raw = (itemOrName && typeof itemOrName === 'object') ? (itemOrName.raw || itemOrName) : null;
      const itemId = raw ? Number(raw.itemId ?? raw.id ?? itemOrName.itemId ?? itemOrName.id) : NaN;
      const rawName = typeof itemOrName === 'string'
        ? itemOrName
        : String((raw && (raw.refinedName || raw.name)) || (itemOrName && itemOrName.name) || '');
      const cleanName = rawName.replace(/\\+\\d+\\s*/g, '').replace(/\\[\\d+\\]/g, '').replace(/\\s*x\\d+$/i, '').trim().toLowerCase();
      for (const entry of list) {
        const w = String(entry || '').trim().toLowerCase();
        if (!w) continue;
        if (cleanName && (cleanName === w || rawName.trim().toLowerCase() === w)) return true;
        if (Number.isFinite(itemId) && KNOWN_IDS[w] && itemId === KNOWN_IDS[w]) return true;
      }
      return false;
    };

    window.isStashOnlyItem = function(itemOrName) {
      if (!window.__stashTradeConfig || !window.__stashTradeConfig.storeOnlyEnabled) return false;
      return window.matchesStashItemList(itemOrName);
    };

    window.hasStashOnlyItemsInBag = function() {
      if (!window.__stashTradeConfig || !window.__stashTradeConfig.storeOnlyEnabled) return false;
      const authInv = readAuthoritativeBagInventory();
      const bag = (authInv && Array.isArray(authInv.items)) ? authInv.items : ((typeof window.getBagItems === 'function') ? window.getBagItems() : []);
      return bag.some(it => it && !it.locked && !it.equipped && window.isStashOnlyItem(it.raw || it));
    };

    if (typeof window.setStashTradeConfig === 'function') {
      window.setStashTradeConfig(cfg);
    }
    // Wrap isItemOnMarketSellList & sellSingleRuleNow on older clients so stash-only items are never market-sold
    if (typeof window.isItemOnMarketSellList === 'function' && !window.isItemOnMarketSellList.__stashWrapped) {
      const origMarketCheck = window.isItemOnMarketSellList;
      const wrapped = function(itemName) {
        if (typeof window.isStashOnlyItem === 'function' && window.isStashOnlyItem(itemName)) return false;
        return origMarketCheck.apply(this, arguments);
      };
      wrapped.__stashWrapped = true;
      window.isItemOnMarketSellList = wrapped;
    }
    if (typeof window.sellSingleRuleNow === 'function' && !window.sellSingleRuleNow.__stashWrapped) {
      const origSellSingle = window.sellSingleRuleNow;
      const wrappedSingle = async function(rule) {
        if (rule && rule.itemName && typeof window.isStashOnlyItem === 'function' && window.isStashOnlyItem(rule.itemName)) {
          return { success: false, message: 'ไอเทมนี้ถูกตั้งค่าเป็น "เก็บเข้าคลังอย่างเดียว" (ห้ามขายตลาดกลาง)' };
        }
        return origSellSingle.apply(this, arguments);
      };
      wrappedSingle.__stashWrapped = true;
      window.sellSingleRuleNow = wrappedSingle;
    }
    window.getConsolidationMatchingBagItems = function(itemList) {
      const list = Array.isArray(itemList) ? itemList : (window.__stashTradeConfig && window.__stashTradeConfig.items) || [];
      const authInv = (typeof window.__readAuthoritativeBagInventory === 'function') ? window.__readAuthoritativeBagInventory() : null;
      const bag = (authInv && Array.isArray(authInv.items)) ? authInv.items : ((typeof window.getBagItems === 'function') ? window.getBagItems() : []);
      const matched = [];
      let totalQty = 0, totalWeight = 0;
      for (const it of bag) {
        if (!it || it.locked || it.equipped) continue;
        const raw = it.raw || it;
        if (raw.locked || raw.equipped) continue;
        if (!window.matchesStashItemList(raw, list)) continue;
        const qty = Math.max(1, Number(it.qty ?? raw.qty ?? 1) || 1);
        const unitW = Math.max(0, Number(raw.weight ?? it.weight ?? 1) || 1);
        matched.push({ slot: Number(it.slot ?? raw.slot), id: raw.itemId ?? raw.id ?? it.id, name: it.name || raw.name || 'Item', qty, unitWeight: unitW, totalWeight: qty * unitW });
        totalQty += qty;
        totalWeight += qty * unitW;
      }
      matched.sort((a, b) => (b.qty || 0) - (a.qty || 0));
      return { items: matched, totalQty, totalWeight };
    };
    return { success: true, config: window.__stashTradeConfig };
  })()`;
}

async function syncStashTradeConfigToPort(port, cfg = null) {
  if (!port) return { success: false, error: "No port" };
  const effectiveCfg = cfg || loadConsolidationItemSettings();
  return evalProfilePort(port, buildStashTradeSyncEvalCode(effectiveCfg), 5000);
}

async function syncStashTradeConfigToAllClients(cfg = null) {
  const effectiveCfg = cfg || loadConsolidationItemSettings();
  const profiles = loadProfiles();
  const online = profiles.filter(p => p.debugPort);
  const results = await Promise.allSettled(online.map(p => syncStashTradeConfigToPort(p.debugPort, effectiveCfg)));
  const syncedCount = results.filter(r => r.status === "fulfilled" && r.value && r.value.success && r.value.result && r.value.result.success).length;
  return { syncedCount, totalChecked: online.length };
}

// Install consolidation storage/trade helpers onto a client port (always ensures latest fixed storage/trade helpers)
async function ensureClientConsolidationItemHelpers(port, cfg = null) {
  await syncStashTradeConfigToPort(port, cfg);
  const helperCode = `(() => {
    const tradeRoom = () => (typeof window.getGameRoom === 'function') ? window.getGameRoom() : (typeof window.getColyseusRoom === 'function' ? window.getColyseusRoom() : null);
    const tradeZeny = () => Number(((typeof window.getLiveCharacterData === 'function' && window.getLiveCharacterData()) || {}).zeny);
    const sameName = (x, y) => String(x || '').trim().toLowerCase() === String(y || '').trim().toLowerCase();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const readBagInv = () => (typeof window.__readAuthoritativeBagInventory === 'function') ? window.__readAuthoritativeBagInventory() : window.__latestInventory;

    const getPlayerPixelPos = (room) => {
      const r = room || tradeRoom();
      const me = r && r.state && r.state.players && r.state.players.get(r.sessionId);
      if (me && Number.isFinite(me.x) && Number.isFinite(me.y)) {
        return { x: Number(me.x), y: Number(me.y) };
      }
      return null;
    };

    const getRealWeightInfo = () => {
      const inv = readBagInv() || {};
      const live = (typeof window.getLiveCharacterData === 'function' && window.getLiveCharacterData()) || {};
      const weight = Number(inv.weight ?? live.weight) || 0;
      const weightLimit = Number(inv.weightLimit ?? live.weightLimit) || 2000;
      return { weight, weightLimit };
    };

    const findStorageNpc = (room) => {
      const r = room || tradeRoom();
      const alice = (typeof window.getAliceNpc === 'function') ? window.getAliceNpc() : null;
      if (alice && alice.key) return alice;
      if (r && r.state && r.state.npcs && typeof r.state.npcs.forEach === 'function') {
        let found = null;
        r.state.npcs.forEach((n, k) => {
          if (!found && n && /Alice|อลิซ|Kafra|Storage|Banker|คลัง/i.test(n.name || '')) {
            found = { key: k, name: n.name, x: Number(n.x), y: Number(n.y) };
          }
        });
        if (found) return found;
      }
      return null;
    };

    const closeStorageAndDialogs = () => {
      try {
        document.querySelectorAll('.storage-window .win-close, .npc-dialog .win-close').forEach(b => { try { b.click(); } catch (e) {} });
      } catch (e) {}
      if (typeof window.closeShopUI === 'function') { try { window.closeShopUI(); } catch (e) {} }
      if (typeof window.sendNpcClose === 'function') { try { window.sendNpcClose(); } catch (e) {} }
    };

    // Clear any poisoned refused entries for refine ores in pelican_storage_state
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.includes('storage_state')) {
          const obj = JSON.parse(localStorage.getItem(k) || '{}');
          if (obj && obj.refused && typeof obj.refused === 'object') {
            for (const id of ['90201', '90202', '90203', '90204', '90205', '90206', '90340', '90341']) {
              delete obj.refused[id];
            }
            localStorage.setItem(k, JSON.stringify(obj));
          }
        }
      }
    } catch (e) {}

    window.openStorageWindow = async function(roomOrTimeout, stopped) {
      const room = (roomOrTimeout && typeof roomOrTimeout === 'object' && typeof roomOrTimeout.send === 'function')
        ? roomOrTimeout
        : tradeRoom();
      const isStopped = (typeof stopped === 'function') ? stopped : () => false;
      if (!room) return null;

      closeStorageAndDialogs();
      await sleep(250);

      let npc = null;
      for (let i = 0; i < 15 && !isStopped(); i++) {
        npc = findStorageNpc(room);
        if (npc) break;
        await sleep(300);
      }
      if (!npc || isStopped()) return null;

      if (Number.isFinite(npc.x) && Number.isFinite(npc.y)) {
        const walkStart = Date.now();
        let lastSend = 0;
        while (Date.now() - walkStart < 18000 && !isStopped()) {
          const p = getPlayerPixelPos(room);
          const dist = p ? Math.hypot(p.x - npc.x, p.y - npc.y) : Infinity;
          if (dist <= 115) break;
          if (Date.now() - lastSend > 1800) {
            lastSend = Date.now();
            try { room.send('move_to', { x: npc.x, y: npc.y }); } catch (e) {}
          }
          await sleep(250);
        }
        await sleep(200);
      }
      if (isStopped()) return null;

      for (let attempt = 0; attempt < 3 && !isStopped(); attempt++) {
        let latestStorage = null;
        let unsub = null;
        const waitStorage = new Promise(resolve => {
          const timer = setTimeout(() => { if (typeof unsub === 'function') unsub(); resolve(null); }, 5500);
          unsub = (typeof room.onMessage === 'function')
            ? room.onMessage('storage', (msg) => {
                if (msg && Array.isArray(msg.items)) {
                  clearTimeout(timer);
                  if (typeof unsub === 'function') unsub();
                  latestStorage = msg;
                  window.__latestStorage = msg;
                  resolve(msg);
                }
              })
            : null;
        });
        try {
          document.querySelectorAll('.npc-dialog .win-close').forEach(b => { try { b.click(); } catch (e) {} });
          await sleep(150);
          try { room.send('npc_talk', { npcKey: npc.key }); } catch (e) {}
          let dlg = null;
          for (let i = 0; i < 25 && !dlg && !latestStorage && !isStopped(); i++) {
            await sleep(180);
            const d = document.querySelector('.npc-dialog, .npc-dialog-window');
            if (d && d.querySelector('.npc-options button, .npc-dialog-choices button, button')) {
              dlg = d;
              break;
            }
          }
          if (!latestStorage && dlg) {
            const optBtns = Array.from(dlg.querySelectorAll('.npc-options button, .npc-dialog-choices button'));
            const idx = optBtns.findIndex(b => {
              const t = (b.innerText || b.textContent || '').replace(/^\\s*\\d+\\s*/, '').trim();
              return /คลัง|ฝากของ|storage/i.test(t) && !/กิลด์|guild/i.test(t);
            });
            if (idx >= 0) {
              room.send('npc_option', { index: idx });
            } else {
              document.querySelectorAll('.npc-dialog .win-close').forEach(b => { try { b.click(); } catch (e) {} });
              if (typeof unsub === 'function') unsub();
              await sleep(300);
              continue;
            }
          } else if (!latestStorage) {
            if (typeof unsub === 'function') unsub();
            if (Number.isFinite(npc.x) && Number.isFinite(npc.y)) {
              try { room.send('move_to', { x: npc.x, y: npc.y }); } catch (e) {}
            }
            await sleep(500);
            continue;
          }
          const msg = await waitStorage;
          if (msg && Array.isArray(msg.items)) {
            readBagInv();
            return msg;
          }
        } finally {
          if (typeof unsub === 'function') { try { unsub(); } catch (e) {} }
        }
        await sleep(350);
      }
      return null;
    };

    window.getConsolidationMatchingBagItems = function(itemList) {
      const list = Array.isArray(itemList) ? itemList : (window.__stashTradeConfig && window.__stashTradeConfig.items) || [];
      const authInv = readBagInv();
      const bag = (authInv && Array.isArray(authInv.items))
        ? authInv.items
        : ((typeof window.getBagItems === 'function') ? window.getBagItems() : []);
      const matched = [];
      let totalQty = 0;
      let totalWeight = 0;
      for (const it of bag) {
        if (!it || it.locked || it.equipped) continue;
        const raw = it.raw || it;
        if (raw.locked || raw.equipped) continue;
        if (!window.matchesStashItemList(raw, list)) continue;
        const qty = Math.max(1, Number(it.qty ?? raw.qty ?? 1) || 1);
        const unitW = Math.max(0, Number(raw.weight ?? it.weight ?? 1) || 1);
        matched.push({
          slot: Number(it.slot ?? raw.slot),
          id: raw.itemId ?? raw.id ?? it.id,
          name: it.name || raw.name || 'Item',
          qty,
          unitWeight: unitW,
          totalWeight: qty * unitW
        });
        totalQty += qty;
        totalWeight += qty * unitW;
      }
      matched.sort((a, b) => (b.qty || 0) - (a.qty || 0));
      return { items: matched, totalQty, totalWeight };
    };

    window.runConsolidationQuickSellTrash = async function(timeoutMs = 28000, force = false) {
      try {
        const authInv = readBagInv();
        const wInfo = getRealWeightInfo();
        const live = (typeof window.getLiveCharacterData === 'function' && window.getLiveCharacterData()) || {};
        const zeny = Number(live.zeny) || 0;
        const freeWeight = Math.max(0, wInfo.weightLimit - wInfo.weight);
        const heavyRatio = wInfo.weightLimit > 0 ? (wInfo.weight / wInfo.weightLimit) : 0;
        const maxSlots = Number(authInv?.slots ?? authInv?.maxSlots) || 100;
        const usedSlots = Array.isArray(authInv?.items) ? authInv.items.filter(Boolean).length : 0;
        const freeSlots = Math.max(0, maxSlots - usedSlots);

        // Skip walking to Shopkeeper Bor if character already has plenty of free bag weight/slots and >= 40 zeny for storage fee
        if (!force && freeWeight >= 800 && heavyRatio < 0.80 && freeSlots > 4 && zeny >= 40) {
          return { success: true, skipped: true, sold: false, weight: wInfo.weight, weightLimit: wInfo.weightLimit, zeny };
        }

        if (typeof window.triggerAutoSellTrash !== 'function') return { success: false, error: 'No triggerAutoSellTrash' };
        const room = tradeRoom();
        if (room && !document.querySelector('.shop-window')) {
          let shopNpc = null;
          if (room.state && room.state.npcs && typeof room.state.npcs.forEach === 'function') {
            room.state.npcs.forEach((n, k) => {
              if (!shopNpc && n && (k === 'n2' || /Shopkeeper|Bor|ร้านค้า/i.test(n.name || ''))) {
                shopNpc = { key: k, x: Number(n.x), y: Number(n.y) };
              }
            });
          }
          if (shopNpc && Number.isFinite(shopNpc.x) && Number.isFinite(shopNpc.y)) {
            const walkStart = Date.now();
            let lastSend = 0;
            while (Date.now() - walkStart < 15000) {
              const p = getPlayerPixelPos(room);
              if (p && Math.hypot(p.x - shopNpc.x, p.y - shopNpc.y) <= 115) break;
              if (Date.now() - lastSend > 1800) {
                lastSend = Date.now();
                try { room.send('move_to', { x: shopNpc.x, y: shopNpc.y }); } catch (e) {}
              }
              await sleep(250);
            }
            await sleep(200);
            try { room.send('npc_talk', { npcKey: shopNpc.key }); } catch (e) {}
            await sleep(550);
            try { room.send('npc_option', { index: 0 }); } catch (e) {}
            for (let i = 0; i < 15 && !document.querySelector('.shop-window'); i++) {
              await sleep(200);
            }
          }
        }

        window.__isManualSelling = true;
        await new Promise((resolve) => {
          let done = false;
          const t = setTimeout(() => { if (!done) { done = true; resolve(); } }, Math.min(timeoutMs, 20000));
          try {
            window.triggerAutoSellTrash(() => {
              if (!done) { done = true; clearTimeout(t); resolve(); }
            });
          } catch (e) {
            if (!done) { done = true; clearTimeout(t); resolve(); }
          }
        });
        window.__isManualSelling = false;
        closeStorageAndDialogs();
        await sleep(250);
        readBagInv();
        const liveAfter = (typeof window.getLiveCharacterData === 'function' && window.getLiveCharacterData()) || {};
        const wAfter = getRealWeightInfo();
        return { success: true, sold: true, weight: wAfter.weight, weightLimit: wAfter.weightLimit, zeny: Number(liveAfter.zeny) || 0 };
      } catch (err) {
        window.__isManualSelling = false;
        return { success: false, error: err.message };
      }
    };

    window.withdrawConsolidationItemsFromStorage = async function(itemList) {
      const list = Array.isArray(itemList) && itemList.length > 0 ? itemList : ((window.__stashTradeConfig && window.__stashTradeConfig.items) || ['Enchant Rune']);
      const room = tradeRoom();
      if (!room) return { success: false, error: 'No room connection', withdrawnQty: 0 };
      try {
        let st = await window.openStorageWindow(room, () => false);
        if (!st || !Array.isArray(st.items)) {
          const z = tradeZeny();
          const errReason = (Number.isFinite(z) && z < 40) ? 'เงินไม่พอค่าเปิดคลัง (ต้องมีอย่างน้อย 40 z)' : 'เปิดคลังไม่สำเร็จ';
          return { success: false, error: errReason, withdrawnQty: 0 };
        }
        let withdrawnQty = 0;
        const withdrawnDetails = [];
        for (let pass = 0; pass < 60; pass++) {
          const authInv = readBagInv();
          const wInfo = getRealWeightInfo();
          const safeAvailWeight = Math.max(0, wInfo.weightLimit - wInfo.weight - 20);
          if (safeAvailWeight <= 0) break;
          if (authInv && Array.isArray(authInv.items)) {
            const maxSlots = Number(authInv.slots ?? authInv.maxSlots) || 100;
            const usedSlots = authInv.items.filter(Boolean).length;
            if (maxSlots > 0 && usedSlots >= maxSlots - 1) break;
          }
          const stItems = Array.isArray(st.items) ? st.items : [];
          const candidates = stItems
            .filter(it => it && window.matchesStashItemList(it, list) && (Number(it.qty) || 0) > 0)
            .sort((a, b) => (Number(b.qty) || 0) - (Number(a.qty) || 0));
          const target = candidates[0];
          if (!target) break;
          const unitW = Math.max(0.1, Number(target.weight) || 1);
          const maxByWeight = unitW > 0 ? Math.floor(safeAvailWeight / unitW) : target.qty;
          const takeQty = Math.min(Number(target.qty) || 1, maxByWeight);
          if (takeQty <= 0) break;
          const nextPromise = new Promise(resolve => {
            let done = false;
            const unsub = room.onMessage('storage', msg => { if (done) return; done = true; if (typeof unsub === 'function') unsub(); resolve(msg); });
            setTimeout(() => { if (done) return; done = true; if (typeof unsub === 'function') unsub(); resolve(null); }, 3000);
          });
          room.send('storage_take', { slot: Number(target.slot), qty: Number(takeQty) });
          const updated = await nextPromise;
          withdrawnQty += takeQty;
          withdrawnDetails.push((target.name || 'Item') + ' x' + takeQty);
          await sleep(220);
          readBagInv();
          if (updated && Array.isArray(updated.items)) st = updated;
          else { await sleep(350); break; }
        }
        closeStorageAndDialogs();
        await sleep(300);
        readBagInv();
        const bagMatch = window.getConsolidationMatchingBagItems(list);
        const wAfter = getRealWeightInfo();
        return { success: true, withdrawnQty, withdrawnDetails, bagMatchingQty: bagMatch.totalQty, bagMatchingWeight: bagMatch.totalWeight, weight: wAfter.weight, weightLimit: wAfter.weightLimit };
      } catch (err) {
        closeStorageAndDialogs();
        return { success: false, error: err.message, withdrawnQty: 0 };
      }
    };

    window.depositConsolidationItemsToStorage = async function(itemList, returnTileCoords = null) {
      const list = Array.isArray(itemList) && itemList.length > 0 ? itemList : ((window.__stashTradeConfig && window.__stashTradeConfig.items) || ['Enchant Rune']);
      const room = tradeRoom();
      if (!room) return { success: false, error: 'No room connection', depositedQty: 0 };
      const beforePos = getPlayerPixelPos(room);
      try {
        let st = await window.openStorageWindow(room, () => false);
        if (!st || !Array.isArray(st.items)) return { success: false, error: 'เปิดคลังไม่สำเร็จ', depositedQty: 0 };
        readBagInv();
        const bagMatch = window.getConsolidationMatchingBagItems(list);
        let depositedQty = 0;
        for (const it of bagMatch.items) {
          if (!Number.isFinite(it.slot) || it.qty <= 0) continue;
          room.send('storage_put', { slot: Number(it.slot), qty: Number(it.qty) });
          depositedQty += it.qty;
          await sleep(260);
        }
        closeStorageAndDialogs();
        await sleep(250);
        readBagInv();
        const backTarget = returnTileCoords || beforePos;
        if (backTarget && Number.isFinite(backTarget.x) && Number.isFinite(backTarget.y)) {
          const tx = backTarget.x > 250 ? backTarget.x : (backTarget.x * 32 + 16);
          const ty = backTarget.y > 250 ? backTarget.y : (backTarget.y * 32 + 16);
          room.send('move_to', { x: tx, y: ty });
          const backStart = Date.now();
          while (Date.now() - backStart < 12000) {
            await sleep(350);
            const p = getPlayerPixelPos(room);
            if (p && Math.hypot(p.x - tx, p.y - ty) <= 96) break;
          }
        }
        const wAfter = getRealWeightInfo();
        return { success: true, depositedQty, weight: wAfter.weight, weightLimit: wAfter.weightLimit };
      } catch (err) {
        closeStorageAndDialogs();
        return { success: false, error: err.message, depositedQty: 0 };
      }
    };

    window.setupReceiverTradeWatcher = function(allowedSenderName, timeoutMs = 60000) {
      if (typeof window.stopReceiverTradeWatcher === 'function') window.stopReceiverTradeWatcher();
      return new Promise((resolve) => {
        const room = tradeRoom();
        if (!room) return resolve({ success: false, error: 'No room connection' });
        const expected = allowedSenderName ? String(allowedSenderName).trim() : '';
        if (!expected) return resolve({ success: false, error: 'Missing sender name' });
        window.__consolidationReceiverMode = true;
        window.__consolidationExpectedSender = expected.toLowerCase();
        const zenyBefore = tradeZeny();
        let accepted = false, lockSent = false, confirmSent = false, finished = false, receivedOffer = 0, receivedItemsCount = 0;
        let unsubInvite = null, unsubTrade = null;
        const finish = (result) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          if (typeof unsubInvite === 'function') unsubInvite();
          if (typeof unsubTrade === 'function') unsubTrade();
          if (window.__receiverWatcherStop === stop) {
            window.__receiverWatcherStop = null;
            window.__consolidationReceiverMode = false;
            window.__consolidationExpectedSender = null;
          }
          resolve(result);
        };
        const stop = reason => finish({ success: false, error: 'Receiver watcher ' + reason });
        window.__receiverWatcherStop = stop;
        const timer = setTimeout(() => finish({ success: false, error: 'Receiver timeout waiting for trade' }), timeoutMs);
        unsubInvite = room.onMessage('invite', (inv) => {
          if (finished || !inv || inv.kind !== 'trade' || accepted) return;
          if (!sameName(inv.from, expected)) return;
          accepted = true;
          room.send('trade', { action: 'accept' });
        });
        unsubTrade = room.onMessage('trade', (tr) => {
          if (finished) return;
          if (!tr) {
            if (!confirmSent) { accepted = false; lockSent = false; return; }
            setTimeout(() => {
              const now = tradeZeny();
              const got = (isFinite(now) && isFinite(zenyBefore)) ? now - zenyBefore : receivedOffer;
              finish((got > 0 || receivedItemsCount > 0)
                ? { success: true, receivedZeny: Math.max(0, got), receivedItemsCount }
                : { success: false, error: 'หน้าต่างเทรดปิดแต่เงิน/ไอเทมไม่เข้า' });
            }, 1200);
            return;
          }
          if (!sameName(tr.partner, expected)) return;
          if (tr.theirs && typeof tr.theirs.zeny === 'number') receivedOffer = tr.theirs.zeny;
          if (tr.theirs && Array.isArray(tr.theirs.items)) {
            receivedItemsCount = tr.theirs.items.reduce((sum, x) => sum + (Number(x && x.qty) || 0), 0);
          }
          if (tr.theirs && tr.theirs.locked && tr.mine && !tr.mine.locked && !lockSent) {
            lockSent = true;
            setTimeout(() => { if (!finished) room.send('trade', { action: 'lock' }); }, 300);
          }
          if (tr.theirs && tr.theirs.locked && tr.mine && tr.mine.locked && !tr.mine.confirmed && !confirmSent) {
            confirmSent = true;
            setTimeout(() => { if (!finished) room.send('trade', { action: 'confirm' }); }, 400);
          }
        });
      });
    };

    window.executeSenderTrade = function(receiverCharName, zenyAmount, timeoutMs = 45000, itemNamesToOffer = null, maxReceiverExtraWeight = null) {
      if (window.__senderTradeBusy) return Promise.resolve({ success: false, error: 'กำลังเทรดอยู่แล้ว (ไม่ส่งซ้ำ)' });
      return new Promise((resolve) => {
        const room = tradeRoom();
        if (!room) return resolve({ success: false, error: 'No room connection' });
        if (!receiverCharName) return resolve({ success: false, error: 'Missing receiver name' });
        const amount = Math.max(0, parseInt(zenyAmount) || 0);
        const zenyBefore = tradeZeny();
        if (isFinite(zenyBefore) && amount > zenyBefore) return resolve({ success: false, error: 'เงินไม่พอ' });
        const offerItems = [];
        let offerItemsTotalQty = 0;
        if (Array.isArray(itemNamesToOffer) && itemNamesToOffer.length > 0 && typeof window.getConsolidationMatchingBagItems === 'function') {
          const bagMatch = window.getConsolidationMatchingBagItems(itemNamesToOffer);
          let remWeight = (typeof maxReceiverExtraWeight === 'number' && Number.isFinite(maxReceiverExtraWeight)) ? Math.max(0, maxReceiverExtraWeight) : Infinity;
          for (const it of bagMatch.items) {
            if (offerItems.length >= 10) break;
            if (!Number.isFinite(it.slot) || it.qty <= 0) continue;
            const unitW = Math.max(0, Number(it.unitWeight) || 1);
            const allowedQty = (unitW > 0 && Number.isFinite(remWeight)) ? Math.min(it.qty, Math.floor(remWeight / unitW)) : it.qty;
            if (allowedQty <= 0) continue;
            offerItems.push({ slot: Number(it.slot), qty: Number(allowedQty) });
            offerItemsTotalQty += allowedQty;
            if (Number.isFinite(remWeight)) remWeight = Math.max(0, remWeight - allowedQty * unitW);
          }
        }
        if (amount <= 0 && offerItems.length === 0) return resolve({ success: false, error: 'ไม่มีเงินหรือไอเทมที่จะเทรด' });
        const bagMatchBefore = (offerItems.length > 0 && typeof window.getConsolidationMatchingBagItems === 'function')
          ? window.getConsolidationMatchingBagItems(itemNamesToOffer).totalQty : 0;
        window.__senderTradeBusy = true;
        let opened = false, offerSent = false, lockSent = false, confirmSent = false, finished = false;
        let unsubTrade = null;
        const finish = (result) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          clearTimeout(noAnswer);
          if (typeof unsubTrade === 'function') unsubTrade();
          window.__senderTradeBusy = false;
          resolve(result);
        };
        const timer = setTimeout(() => { try { room.send('trade', { action: 'cancel' }); } catch (e) {} finish({ success: false, error: 'Sender timeout in trade process' }); }, timeoutMs);
        const noAnswer = setTimeout(() => { if (!opened) finish({ success: false, error: 'ตัวรับไม่ตอบรับคำขอเทรด (ไม่ได้ส่งคำขอซ้ำ)' }); }, 12000);
        unsubTrade = room.onMessage('trade', (tr) => {
          if (finished) return;
          if (!tr) {
            if (!opened) return;
            if (!confirmSent) return finish({ success: false, error: 'อีกฝ่ายยกเลิก/ปิดหน้าต่างเทรด' });
            setTimeout(() => {
              const now = tradeZeny();
              const sent = (isFinite(now) && isFinite(zenyBefore)) ? zenyBefore - now : null;
              const bagMatchAfter = (offerItems.length > 0 && typeof window.getConsolidationMatchingBagItems === 'function')
                ? window.getConsolidationMatchingBagItems(itemNamesToOffer).totalQty : 0;
              const sentItems = Math.max(0, bagMatchBefore - bagMatchAfter);
              if (sent === null && offerItems.length === 0) finish({ success: true, transferredZeny: amount, transferredItemsQty: offerItemsTotalQty, unverified: true });
              else if ((sent !== null && sent > 0) || sentItems > 0) finish({ success: true, transferredZeny: Math.max(0, sent || 0), transferredItemsQty: sentItems });
              else finish({ success: false, error: 'หน้าต่างเทรดปิดแต่เงิน/ไอเทมไม่ลด (เทรดไม่สำเร็จ)' });
            }, 1200);
            return;
          }
          if (!sameName(tr.partner, receiverCharName)) return;
          opened = true;
          if (!offerSent) {
            offerSent = true;
            setTimeout(() => { if (!finished) room.send('trade', { action: 'offer', items: offerItems, zeny: amount }); }, 350);
            return;
          }
          const zenyMatched = tr.mine && tr.mine.zeny === amount;
          const itemsMatched = offerItems.length === 0 || (tr.mine && Array.isArray(tr.mine.items) && tr.mine.items.length === offerItems.length);
          if (!lockSent && zenyMatched && itemsMatched && !tr.mine.locked) {
            lockSent = true;
            setTimeout(() => { if (!finished) room.send('trade', { action: 'lock' }); }, 400);
            return;
          }
          if (lockSent && !confirmSent && tr.mine && tr.mine.locked && tr.theirs && tr.theirs.locked && !tr.mine.confirmed) {
            confirmSent = true;
            setTimeout(() => { if (!finished) room.send('trade', { action: 'confirm' }); }, 400);
          }
        });
        setTimeout(() => { if (!finished) room.send('trade', { action: 'request', name: receiverCharName }); }, 600);
      });
    };
    return { success: true };
  })()`;
  return evalProfilePort(port, helperCode, 6000);
}

// ==========================================
// CENTRALIZED ZENY CONSOLIDATION WORKFLOW
// ==========================================
let consolidationState = {
  running: false,
  status: 'idle', // 'idle' | 'running' | 'completed' | 'stopped' | 'error'
  step: 'พร้อมทำงาน',
  stepIndex: 0,
  totalSteps: 5,
  receiver: null,
  currentSender: null,
  completedSenders: [],
  totalTransferredZeny: 0,
  totalTransferredItems: 0,
  tradeItemsEnabled: false,
  tradeItemsList: [],
  logs: [],
  startTime: 0,
  endTime: 0
};
let consolidationAborted = false;

function addConsolidationLog(text, level = 'info') {
  const time = new Date().toLocaleTimeString('th-TH');
  consolidationState.logs.push({ time, text, level });
  if (consolidationState.logs.length > 300) consolidationState.logs.shift();
  console.log(`[Consolidation] [${level.toUpperCase()}] ${text}`);
}

async function runConsolidationWorkflow(receiverProfileId, senderProfileIds, keepZeny = 0, tradeItemsOpts = null) {
  if (consolidationState.running) return;
  const savedItemCfg = loadConsolidationItemSettings();
  const tradeItemsEnabled = (tradeItemsOpts && typeof tradeItemsOpts.enabled === 'boolean')
    ? tradeItemsOpts.enabled
    : Boolean(savedItemCfg.tradeOnConsolidate);
  const tradeItemsList = (tradeItemsOpts && Array.isArray(tradeItemsOpts.items) && tradeItemsOpts.items.length > 0)
    ? sanitizeConsolidationItemsList(tradeItemsOpts.items)
    : sanitizeConsolidationItemsList(savedItemCfg.items);

  consolidationAborted = false;
  consolidationState.running = true;
  consolidationState.status = 'running';
  consolidationState.stepIndex = 1;
  consolidationState.step = 'เตรียมพร้อมและหยุดบอททุกจอ...';
  consolidationState.completedSenders = [];
  consolidationState.totalTransferredZeny = 0;
  consolidationState.totalTransferredItems = 0;
  consolidationState.tradeItemsEnabled = tradeItemsEnabled;
  consolidationState.tradeItemsList = tradeItemsList;
  consolidationState.logs = [];
  consolidationState.startTime = Date.now();
  consolidationState.endTime = 0;

  const itemModeMsg = tradeItemsEnabled ? ` + เบิกคลังและเทรดไอเทม [${tradeItemsList.join(', ')}]` : '';
  addConsolidationLog(`🚀 เริ่มต้นระบบรวมเงินเข้าตัวหลัก (Receiver ID: ${receiverProfileId})${itemModeMsg}`, 'info');

  const allProfiles = loadProfiles();
  const receiverProfile = allProfiles.find(p => p.id === receiverProfileId);
  const senderProfiles = allProfiles.filter(p => senderProfileIds.includes(p.id) && p.id !== receiverProfileId);

  if (!receiverProfile || !receiverProfile.debugPort) {
    consolidationState.running = false;
    consolidationState.status = 'error';
    addConsolidationLog('❌ ไม่พบโปรไฟล์ตัวรับเงิน (Receiver) หรือไม่ได้เปิดจอเกม', 'error');
    return;
  }

  consolidationState.receiver = {
    id: receiverProfile.id,
    name: receiverProfile.name,
    port: receiverProfile.debugPort
  };

  try {
    // Ensure all involved clients have up-to-date stash/consolidation item helpers
    await Promise.all([receiverProfile, ...senderProfiles].map(p =>
      ensureClientConsolidationItemHelpers(p.debugPort, {
        ...savedItemCfg,
        tradeOnConsolidate: tradeItemsEnabled,
        items: tradeItemsList
      }).catch(() => {})
    ));

    // -------------------------------------------------------------
    // STEP 0: งานสำคัญที่ทำค้างอยู่ (ขายของ / ฝากคลัง / ตีบวก / ซื้อของ / เปลี่ยนอาชีพ / Weight Scroll) ต้องเสร็จก่อน —
    // ตั้ง __consolidationPending (ห้ามเริ่มงานใหม่) แล้วรอได้ถึง 3 นาที; จอที่ยังไม่เสร็จข้ามไปรอบนี้ (ไม่ตัดงานกลางคัน)
    // -------------------------------------------------------------
    consolidationState.step = 'รองานสำคัญของแต่ละจอให้เสร็จก่อน (ขายของ / ตีบวก / ซื้อของ...)';
    const BUSY_JS = `(() => {
      window.__consolidationPending = true;
      const curMap = (typeof window.getCurrentMapName === 'function' ? window.getCurrentMapName() : '') || '';
      const inTown = /เมืองหลวง|โซลเฮเวน|คาราวาน/.test(curMap);
      const b = [];
      if (inTown && window.__isShopping) b.push('ขาย/ซื้อของกับ NPC');
      if (inTown && window.__isStoring) b.push('ฝากของเข้าคลัง');
      if (inTown && window.__isGearRefining) b.push('ตีบวก (เซ็ตอุปกรณ์)');
      if (window.__planMarketBuyInFlight) b.push('ซื้อของในตลาดตามแผน');
      if (inTown && window.__isChangingJob) b.push('เปลี่ยนอาชีพ');
      if (window.__isWeightScrollBusy) b.push('ซื้อ/ใช้ Weight Limit Scroll');
      if (window.__isManualSelling) b.push('ลงขายของ');
      return b;
    })()`;
    const busyOf = async p => { const r = await evalProfilePort(p.debugPort, BUSY_JS, 5000); return (r && r.success && Array.isArray(r.result)) ? r.result : []; };
    const stillBusy = new Map();
    await Promise.all([receiverProfile, ...senderProfiles].map(async p => {
      let busy = await busyOf(p);
      if (busy.length) addConsolidationLog(`⏳ ${p.name}: รอ "${busy.join(', ')}" ให้เสร็จก่อน (ไม่ตัดงานกลางคัน)...`, 'info');
      for (let i = 0; i < 30 && busy.length && !consolidationAborted; i++) {
        await new Promise(r => setTimeout(r, 2000));
        busy = await busyOf(p);
        if (busy.length && (i + 1) % 5 === 0) {
          consolidationState.step = `รอ ${p.name} ทำ "${busy.join(', ')}" ให้เสร็จ (${(i + 1) * 2}/60 วิ)...`;
        }
      }
      if (busy.length) stillBusy.set(p.id, busy);
    }));
    const clearPending = p => evalProfilePort(p.debugPort, `(() => { window.__consolidationPending = false; return true; })()`, 4000);
    if (consolidationAborted) {
      await Promise.all([receiverProfile, ...senderProfiles].map(clearPending));
      throw new Error('ผู้ใช้ยกเลิกการรวมเงิน');
    }
    if (stillBusy.has(receiverProfile.id)) {
      await Promise.all([receiverProfile, ...senderProfiles].map(clearPending));
      throw new Error(`ตัวรับเงิน (${receiverProfile.name}) ยังทำ "${stillBusy.get(receiverProfile.id).join(', ')}" ไม่เสร็จใน 60 วินาที — ลองรวมเงินใหม่อีกครั้งภายหลัง`);
    }
    for (const s of senderProfiles.filter(x => stillBusy.has(x.id))) {
      addConsolidationLog(`⏭️ ${s.name}: ยังทำ "${stillBusy.get(s.id).join(', ')}" ไม่เสร็จใน 60 วินาที -> ข้ามจอนี้ในรอบนี้ (ไม่ตัดงานกลางคัน)`, 'warning');
      await clearPending(s);
    }
    for (let i = senderProfiles.length - 1; i >= 0; i--) if (stillBusy.has(senderProfiles[i].id)) senderProfiles.splice(i, 1);

    // -------------------------------------------------------------
    // STEP 1: สั่ง Stop Bot ทุกจอที่เกี่ยวข้อง
    // -------------------------------------------------------------
    consolidationState.stepIndex = 1;
    consolidationState.step = 'หยุดการทำงานของบอททุกจอ (Stop Bot)...';
    addConsolidationLog('⏹️ ขั้นตอนที่ 1/5: กำลังสั่งหยุดบอททุกจอที่เข้าร่วม...', 'info');

    const involvedProfiles = [receiverProfile, ...senderProfiles];
    for (const p of involvedProfiles) {
      if (consolidationAborted) throw new Error('ผู้ใช้ยกเลิกการรวมเงิน');
      await evalProfilePort(p.debugPort, `(() => {
        window.__isConsolidating = true;
        window.__isBotRunning = false;
        window.__autoLoopEnabled = false;
        window.__isWalkingToMap = false;
        window.__isNavigating = false;
        window.__isShopping = false;
        window.__isRecovering = false;
        if (typeof window.stopMasterBot === 'function') window.stopMasterBot();
        if (typeof window.stopPelicanBot === 'function') window.stopPelicanBot();
        if (typeof window.stopArrivalWatcher === 'function') window.stopArrivalWatcher();
        if (typeof window.clearAllBotTimers === 'function') window.clearAllBotTimers();
        if (typeof window.deactivateInGameAuto === 'function') window.deactivateInGameAuto();
        if (typeof window.closeShopUI === 'function') window.closeShopUI();
        if (typeof window.sendNpcClose === 'function') window.sendNpcClose();
        try { localStorage.setItem('pelican_bot_running', 'false'); } catch(e){}
        try { localStorage.setItem('pelican_auto_loop', 'false'); } catch(e){}
        const loopCheckbox = document.getElementById('p-auto-loop');
        if (loopCheckbox) loopCheckbox.checked = false;
        if (typeof updateMasterBotUI === 'function') updateMasterBotUI();
        return { success: true };
      })()`);
      addConsolidationLog(`🛑 สั่งหยุดบอทหน้าจอ: ${p.name}`, 'info');
    }
    await new Promise(r => setTimeout(r, 1200));

    // -------------------------------------------------------------
    // STEP 2: ค่อยๆ กด Butterfly Wing กลับบ้าน (โซลเฮเวน)
    // -------------------------------------------------------------
    if (consolidationAborted) throw new Error('ผู้ใช้ยกเลิกการรวมเงิน');
    consolidationState.stepIndex = 2;
    consolidationState.step = 'วาร์ปกลับเมืองหลวง (โซลเฮเวน) ด้วย Butterfly Wing...';
    addConsolidationLog('🦋 ขั้นตอนที่ 2/5: ทยอยกด Butterfly Wing กลับเมืองหลวงโซลเฮเวน...', 'info');

    for (const p of involvedProfiles) {
      if (consolidationAborted) throw new Error('ผู้ใช้ยกเลิกการรวมเงิน');
      addConsolidationLog(`🕊️ ${p.name}: กลับเมืองหลวง (Butterfly Wing / ถ้าไม่มีปีกจะเปิดแผนที่เดินกลับ)...`, 'info');
      evalProfilePort(p.debugPort, `(() => {
        window.__isConsolidating = true;
        window.__isBotRunning = false;
        window.__autoLoopEnabled = false;
        window.__isWalkingToMap = false;
        window.__isNavigating = false;
        if (typeof window.executeBwingHome === 'function') {
          window.executeBwingHome();
        } else if (typeof window.useButterflyWing === 'function') {
          window.useButterflyWing();
        }
        return { success: true };
      })()`);
      await new Promise(r => setTimeout(r, 800)); // Stagger delay
    }

    addConsolidationLog('⏳ รอตัวละครทุกตัวโหลดเข้าสู่เมืองหลวง (รอ 6 วินาที)...', 'info');
    await new Promise(r => setTimeout(r, 6000));

    // The receiver must be in the capital before it changes channel (no Butterfly Wing: it walks home first)
    const recvInCapCheck = await evalProfilePort(receiverProfile.debugPort, `window.isInCapital ? window.isInCapital() : true`, 4000);
    if (recvInCapCheck && recvInCapCheck.result === false) {
      addConsolidationLog(`🗺️ ตัวรับเงิน (${receiverProfile.name}) ยังไม่ถึงเมืองหลวง — กำลังรอให้เดินถึงเมืองหลวง...`, 'info');
      consolidationState.step = `รอตัวรับเงิน (${receiverProfile.name}) เดินทางถึงเมืองหลวง...`;
    }
    const recvHome = await evalProfilePort(receiverProfile.debugPort, `window.ensureInCapital ? window.ensureInCapital(280000) : { success: true }`, 290000);
    if (!(recvHome && recvHome.result && recvHome.result.success)) {
      throw new Error(`ตัวรับเงิน (${receiverProfile.name}) ไปไม่ถึงเมืองหลวง: ${(recvHome && recvHome.result && recvHome.result.error) || 'ไม่ทราบสาเหตุ'}`);
    }

    // If tradeItemsEnabled, have the Receiver also sell trash & deposit any current matching items to free bag space before receiving trades
    if (tradeItemsEnabled) {
      addConsolidationLog(`🧹 ตัวรับเงิน (${receiverProfile.name}): แวะขายขยะและเคลียร์น้ำหนักกระเป๋าเตรียมรับไอเทม...`, 'info');
      await evalProfilePort(receiverProfile.debugPort, `window.runConsolidationQuickSellTrash ? window.runConsolidationQuickSellTrash(25000) : null`, 30000);
      const recvInitDeposit = await evalProfilePort(receiverProfile.debugPort, `(async () => {
        const list = ${JSON.stringify(tradeItemsList)};
        const m = typeof window.getConsolidationMatchingBagItems === 'function' ? window.getConsolidationMatchingBagItems(list) : { totalQty: 0 };
        if (m.totalQty > 0 && typeof window.depositConsolidationItemsToStorage === 'function') {
          return await window.depositConsolidationItemsToStorage(list);
        }
        return { success: true, depositedQty: 0 };
      })()`, 30000);
      if (recvInitDeposit?.result?.depositedQty > 0) {
        addConsolidationLog(`📥 ตัวรับเงิน (${receiverProfile.name}) เก็บไอเทมเดิมในกระเป๋าเข้าคลังแล้ว ${recvInitDeposit.result.depositedQty} ชิ้น`, 'info');
      }
    }

    // -------------------------------------------------------------
    // STEP 3: ตัวรับเงินหา Channel ที่คนน้อยสุด และย้ายไป Channel นั้น
    // -------------------------------------------------------------
    if (consolidationAborted) throw new Error('ผู้ใช้ยกเลิกการรวมเงิน');
    consolidationState.stepIndex = 3;
    consolidationState.step = 'ตัวรับเงินกำลังค้นหา Channel คนน้อยสุด และย้ายแชนเนล...';
    addConsolidationLog(`🔍 ขั้นตอนที่ 3/5: ตัวรับเงิน (${receiverProfile.name}) กำลังสแกนหา Channel ที่คนน้อยสุด...`, 'info');

    let targetChannel = 1;
    const chFindRes = await evalProfilePort(receiverProfile.debugPort, `
      (async () => {
        if (typeof window.findLeastPopulatedChannel === 'function') {
          return await window.findLeastPopulatedChannel();
        }
        return null;
      })()
    `, 6000);

    if (chFindRes && typeof chFindRes.result === 'number' && chFindRes.result > 0) {
      targetChannel = chFindRes.result;
      addConsolidationLog(`📊 สแกน Channel สำเร็จ: CH ${targetChannel} มีผู้เล่นน้อยที่สุด!`, 'success');
    } else {
      const curChRes = await evalProfilePort(receiverProfile.debugPort, `
        window.getCurrentChannel ? window.getCurrentChannel() : 1
      `);
      targetChannel = (curChRes && typeof curChRes.result === 'number') ? curChRes.result : 1;
      addConsolidationLog(`ℹ️ ใช้ Channel ปัจจุบันของตัวรับเงิน: CH ${targetChannel}`, 'info');
    }

    addConsolidationLog(`👑 ตัวรับเงิน (${receiverProfile.name}) กำลังเปลี่ยนไป Channel ${targetChannel}...`, 'info');
    await evalProfilePort(receiverProfile.debugPort, `
      window.moveToChannel ? window.moveToChannel(${targetChannel}, 45000) : (window.switchChannel ? window.switchChannel(${targetChannel}) : null)
    `, 50000);
    await new Promise(r => setTimeout(r, 2000));
    // Senders go where the receiver REALLY is (a refused switch left it elsewhere: CH 47 vs 74)
    const recvCh = await evalProfilePort(receiverProfile.debugPort, `window.getCurrentChannel ? window.getCurrentChannel() : null`, 5000);
    if (recvCh && typeof recvCh.result === 'number' && recvCh.result > 0) {
      if (recvCh.result !== targetChannel) addConsolidationLog(`ℹ️ ตัวรับเงินย้ายไป CH ${targetChannel} ไม่ได้ ยังอยู่ CH ${recvCh.result} -> ให้จอรองมาที่ CH ${recvCh.result}`, 'warning');
      targetChannel = recvCh.result;
    }
    addConsolidationLog(`📍 ตัวรับเงินอยู่ที่ CH ${targetChannel}`, 'info');

    // -------------------------------------------------------------
    // STEP 4: จอรองทยอยย้าย Channel ตามมาทีละจอ และเรียงคิวเทรดเงิน/ไอเทมให้ตัวหลัก
    // -------------------------------------------------------------
    if (consolidationAborted) throw new Error('ผู้ใช้ยกเลิกการรวมเงิน');
    consolidationState.stepIndex = 4;
    consolidationState.step = `จอรองทยอยวาร์ปมา CH ${targetChannel} และเรียงคิวเทรด${tradeItemsEnabled ? 'เงิน + ไอเทม' : 'เงิน'}...`;
    addConsolidationLog(`🤝 ขั้นตอนที่ 4/5: เริ่มเรียงคิวจอรอง (${senderProfiles.length} จอ) เทรด${tradeItemsEnabled ? 'เงินและไอเทม (' + tradeItemsList.join(', ') + ')' : 'เงิน'}ให้ตัวหลัก...`, 'info');

    const receiverLive = await queryClientState(receiverProfile.debugPort);
    const receiverCharName = receiverLive?.charName || receiverProfile.name;

    // Channels fill up: only 2 senders are in the receiver's channel at a time. While one trades, the next
    // one is already moving in + walking up. A sender that is done moves out to another channel and starts
    // its bot (back to farming) — then the next sender in the queue comes in.
    const SENDER_SLOTS = 2;
    const restarted = new Set();
    const queue = [];
    for (const s of senderProfiles) {
      const live = await queryClientState(s.debugPort);
      const charName = live?.charName || s.name;
      const zeny = (live && typeof live.zeny === 'number') ? live.zeny : 0;
      if (!tradeItemsEnabled && Math.max(0, zeny - keepZeny) <= 0) {
        addConsolidationLog(`⏭️ จอ ${s.name} (${charName}) มีเงิน ${zeny.toLocaleString()} z (ไม่พอโอนหรือติดเก็บสำรอง) -> ข้าม`, 'warning');
        consolidationState.completedSenders.push(s.id);
        continue;
      }
      queue.push(s);
    }
    const startBotJs = `(() => {
      window.__isConsolidating = false; window.__consolidationPending = false; window.__isWalkingToMap = false; window.__isNavigating = false;
      if (typeof window.restoreKeptFarmMap === 'function') window.restoreKeptFarmMap();
      window.__autoLoopEnabled = true; window.__isBotRunning = true;
      try { localStorage.setItem('pelican_auto_loop', 'true'); localStorage.setItem('pelican_bot_running', 'true'); } catch(e){}
      const cb = document.getElementById('p-auto-loop'); if (cb) cb.checked = true;
      if (typeof window.startMasterBot === 'function') window.startMasterBot(); else if (typeof window.startBot === 'function') window.startBot();
      return { success: true };
    })()`;
    // into the receiver's channel (waits for cooldown / a free slot) and up to the receiver
    const prepareSender = async (s) => {
      // no Butterfly Wing: it is walking home — wait for the capital before changing channel / trading
      const sInCap = await evalProfilePort(s.debugPort, `window.isInCapital ? window.isInCapital() : true`, 4000);
      if (sInCap && sInCap.result === false) {
        addConsolidationLog(`🗺️ จอ ${s.name} ยังไม่ถึงเมืองหลวง (กำลังเดินกลับเมืองหลวง)...`, 'info');
      }
      const home = await evalProfilePort(s.debugPort, `window.ensureInCapital ? window.ensureInCapital(280000) : { success: true }`, 290000);
      if (!(home && home.result && home.result.success)) return { ok: false, homeChannel: null, error: `ยังไม่ถึงเมืองหลวง: ${(home && home.result && home.result.error) || 'ไม่ทราบสาเหตุ'}` };
      const fromCh = await evalProfilePort(s.debugPort, `window.getCurrentChannel ? window.getCurrentChannel() : null`, 5000);
      const homeChannel = (fromCh && typeof fromCh.result === 'number') ? fromCh.result : null;

      let bagMatchingQty = 0;
      let bagMatchingWeight = 0;
      if (tradeItemsEnabled) {
        // 1. Sell trash first to free up bag weight before opening storage (skips walking to shop if bag is already light)
        const sellRes = await evalProfilePort(s.debugPort, `window.runConsolidationQuickSellTrash ? window.runConsolidationQuickSellTrash(28000) : { success: false }`, 32000);
        if (sellRes?.result?.sold) {
          addConsolidationLog(`🧹 จอ ${s.name}: แวะขายขยะเคลียร์กระเป๋าแล้ว (น้ำหนัก ${sellRes.result.weight}/${sellRes.result.weightLimit})`, 'info');
        }
        // 2. Open storage and withdraw matching items up to safe bag weight
        addConsolidationLog(`📦 จอ ${s.name}: เปิดคลังเบิกไอเทม (${tradeItemsList.join(', ')})...`, 'info');
        const wdRes = await evalProfilePort(
          s.debugPort,
          `window.withdrawConsolidationItemsFromStorage ? window.withdrawConsolidationItemsFromStorage(${JSON.stringify(tradeItemsList)}) : { success: false, error: 'No withdraw helper' }`,
          40000
        );
        const wd = wdRes?.result || {};
        if (wd.success === false) {
          addConsolidationLog(`⚠️ จอ ${s.name}: เบิกไอเทมจากคลังไม่สำเร็จ (${wd.error || 'ไม่ทราบสาเหตุ'})`, 'warning');
          const fallbackBag = await evalProfilePort(
            s.debugPort,
            `window.getConsolidationMatchingBagItems ? window.getConsolidationMatchingBagItems(${JSON.stringify(tradeItemsList)}) : { totalQty: 0, totalWeight: 0 }`,
            4000
          );
          bagMatchingQty = Number(fallbackBag?.result?.totalQty) || 0;
          bagMatchingWeight = Number(fallbackBag?.result?.totalWeight) || 0;
        } else {
          bagMatchingQty = Number(wd.bagMatchingQty) || 0;
          bagMatchingWeight = Number(wd.bagMatchingWeight) || 0;
        }
        if (wd.withdrawnQty > 0) {
          addConsolidationLog(`📦 จอ ${s.name}: เบิกไอเทมจากคลังสำเร็จ +${wd.withdrawnQty} ชิ้น (รวมในกระเป๋า ${bagMatchingQty} ชิ้น, น้ำหนัก ${wd.weight}/${wd.weightLimit})`, 'success');
        } else if (bagMatchingQty > 0) {
          addConsolidationLog(`🎒 จอ ${s.name}: มีไอเทมในกระเป๋าพร้อมเทรด ${bagMatchingQty} ชิ้น (ไม่มีเพิ่มในคลัง)`, 'info');
        } else if (wd.success !== false) {
          addConsolidationLog(`ℹ️ จอ ${s.name}: ไม่มีไอเทม (${tradeItemsList.join(', ')}) ในคลังหรือในกระเป๋า`, 'info');
        }

        // Check if sender has neither Zeny nor items to trade -> skip channel switch!
        const sLiveNow = await queryClientState(s.debugPort);
        const zenyNow = (sLiveNow && typeof sLiveNow.zeny === 'number') ? sLiveNow.zeny : 0;
        if (Math.max(0, zenyNow - keepZeny) <= 0 && bagMatchingQty <= 0) {
          return { ok: true, nothingToTrade: true, homeChannel, bagMatchingQty: 0, bagMatchingWeight: 0 };
        }
      }

      addConsolidationLog(`🔄 จอ ${s.name} กำลังย้ายไป CH ${targetChannel} (รอคูลดาวน์/ที่ว่างให้เอง)...`, 'info');
      const mv = await evalProfilePort(s.debugPort, `window.moveToChannel ? window.moveToChannel(${targetChannel}, 120000) : (window.switchChannel ? window.switchChannel(${targetChannel}) : null)`, 125000);
      const there = mv && mv.result && mv.result.success;
      if (!there) return { ok: false, homeChannel, error: `ย้ายไป CH ${targetChannel} ไม่ได้: ${(mv && mv.result && mv.result.error) || (mv && mv.error) || 'ไม่ทราบสาเหตุ'}` };
      await new Promise(r => setTimeout(r, 2000));
      const rPosRes = await evalProfilePort(receiverProfile.debugPort, `(() => {
        const r = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
        const me = r && r.state && r.state.players && r.state.players.get ? r.state.players.get(r.sessionId) : null;
        return me && Number.isFinite(me.x) && Number.isFinite(me.y) ? { x: Math.round(me.x), y: Math.round(me.y) } : { x: 1664, y: 1968 };
      })()`, 4000);
      const recvPos = (rPosRes && rPosRes.result && Number.isFinite(rPosRes.result.x)) ? rPosRes.result : { x: 1664, y: 1968 };
      addConsolidationLog(`🚶 จอ ${s.name} เดินไปหาตัวรับเงิน (${receiverCharName} @ ${recvPos.x},${recvPos.y})...`, 'info');
      const walk = await evalProfilePort(s.debugPort, `(async () => {
        if (typeof window.closeShopUI === 'function') window.closeShopUI();
        if (typeof window.sendNpcClose === 'function') window.sendNpcClose();
        const want = ${JSON.stringify(receiverCharName)}.trim().toLowerCase();
        const hintX = ${recvPos.x}, hintY = ${recvPos.y}, nearPx = 96, maxMs = 45000;
        const start = Date.now();
        let lastSend = 0, seen = false;
        while (Date.now() - start < maxMs) {
          const room = typeof window.getGameRoom === 'function' ? window.getGameRoom() : null;
          const players = room && room.state && room.state.players;
          const me = players && players.get ? players.get(room.sessionId) : null;
          let target = null;
          if (players && players.forEach) players.forEach(p => { if (!target && p && String(p.name || '').trim().toLowerCase() === want) target = p; });
          if (me && target) {
            seen = true;
            const dist = Math.hypot((me.x || 0) - (target.x || 0), (me.y || 0) - (target.y || 0));
            if (dist <= nearPx) return { success: true, distance: Math.round(dist) };
            if (Date.now() - lastSend > 2200) {
              lastSend = Date.now();
              room.send('move_to', { x: target.x, y: target.y });
            }
          } else if (me && Number.isFinite(hintX) && Number.isFinite(hintY)) {
            const distHint = Math.hypot((me.x || 0) - hintX, (me.y || 0) - hintY);
            if (distHint > nearPx && Date.now() - lastSend > 2200) {
              lastSend = Date.now();
              room.send('move_to', { x: hintX, y: hintY });
            }
          }
          await new Promise(r => setTimeout(r, 450));
        }
        return { success: false, error: seen ? 'เดินไปไม่ถึงตัวรับเงิน' : 'ไม่เห็นตัวรับเงินในแมพ/channel นี้' };
      })()`, 50000);
      if (!(walk && walk.result && walk.result.success)) addConsolidationLog(`⚠️ จอ ${s.name}: ${(walk && walk.result && walk.result.error) || 'เดินไปหาตัวรับเงินไม่สำเร็จ'} — ลองขอเทรดเลย`, 'warning');
      return { ok: true, homeChannel, bagMatchingQty, bagMatchingWeight };
    };
    // out of the receiver's channel (back where it came from, or the emptiest other one), then START BOT
    const releaseSender = async (s, homeChannel) => {
      const curChRes = await evalProfilePort(s.debugPort, `window.getCurrentChannel ? window.getCurrentChannel() : null`, 4000);
      const curCh = (curChRes && typeof curChRes.result === 'number') ? curChRes.result : null;
      if (curCh === targetChannel) {
        let away = homeChannel && homeChannel !== targetChannel ? homeChannel : null;
        if (!away) {
          const best = await evalProfilePort(s.debugPort, `(async () => { const r = await window.getChannelsList(3500); if (!r.success) return null; const cap = r.data.hardCap || 40; const c = r.data.channels.filter(x => x.channel !== ${targetChannel} && x.players < cap).sort((a, b) => a.players - b.players)[0]; return c ? c.channel : null; })()`, 8000);
          away = best && typeof best.result === 'number' ? best.result : null;
        }
        if (away) {
          addConsolidationLog(`↪️ จอ ${s.name} ออกจาก CH ${targetChannel} ไป CH ${away} เพื่อเปิดที่ให้จอถัดไป`, 'info');
          await evalProfilePort(s.debugPort, `window.moveToChannel ? window.moveToChannel(${away}, 60000) : null`, 65000);
        }
      }
      await evalProfilePort(s.debugPort, startBotJs);
      restarted.add(s.id);
      addConsolidationLog(`▶️ จอ ${s.name} เริ่มบอทกลับไปฟาร์มแล้ว`, 'success');
    };

    // Helper: check Receiver bag weight and deposit matching items to Receiver's storage if needed
    const ensureReceiverWeightReady = async (incomingWeight = 0) => {
      if (!tradeItemsEnabled) return Infinity;
      const rStat = await evalProfilePort(receiverProfile.debugPort, `(() => {
        const inv = (typeof window.__readAuthoritativeBagInventory === 'function' ? window.__readAuthoritativeBagInventory() : window.__latestInventory) || {};
        const live = (typeof window.getLiveCharacterData === 'function' && window.getLiveCharacterData()) || {};
        const room = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : null;
        const me = room && room.state && room.state.players && room.state.players.get ? room.state.players.get(room.sessionId) : null;
        const pos = (me && Number.isFinite(me.x) && Number.isFinite(me.y)) ? { x: Number(me.x), y: Number(me.y) } : null;
        const m = (typeof window.getConsolidationMatchingBagItems === 'function')
          ? window.getConsolidationMatchingBagItems(${JSON.stringify(tradeItemsList)})
          : { totalQty: 0, totalWeight: 0 };
        return {
          weight: Number(inv.weight ?? live.weight) || 0,
          weightLimit: Number(inv.weightLimit ?? live.weightLimit) || 2000,
          matchingQty: m.totalQty,
          pos
        };
      })()`, 5000);
      const st = rStat?.result || { weight: 0, weightLimit: 2000, matchingQty: 0, pos: null };
      const avail = Math.max(0, st.weightLimit - st.weight - 25);
      const heavyRatio = st.weightLimit > 0 ? (st.weight / st.weightLimit) : 0;
      if (st.matchingQty > 0 && (heavyRatio >= 0.65 || incomingWeight > avail)) {
        addConsolidationLog(`📥 กระเป๋าตัวรับเงิน (${receiverCharName}) เริ่มหนัก (${st.weight}/${st.weightLimit}) -> เดินไปฝากไอเทมเข้าคลังก่อนรับเทรด...`, 'info');
        const dep = await evalProfilePort(
          receiverProfile.debugPort,
          `window.depositConsolidationItemsToStorage ? window.depositConsolidationItemsToStorage(${JSON.stringify(tradeItemsList)}, ${JSON.stringify(st.pos)}) : { success: false }`,
          35000
        );
        if (dep?.result?.success) {
          addConsolidationLog(`✅ ตัวรับเงินฝากไอเทมเข้าคลังแล้ว ${dep.result.depositedQty} ชิ้น (น้ำหนักเหลือ ${dep.result.weight}/${dep.result.weightLimit})`, 'success');
          return Math.max(0, (Number(dep.result.weightLimit) || 2000) - (Number(dep.result.weight) || 0) - 25);
        }
      }
      return avail;
    };

    const prep = new Map();
    const startPrep = (s) => { if (s && !prep.has(s.id)) prep.set(s.id, prepareSender(s).catch(e => ({ ok: false, error: e.message }))); };
    queue.slice(0, SENDER_SLOTS).forEach(startPrep);

    for (let i = 0; i < queue.length; i++) {
      if (consolidationAborted) throw new Error('ผู้ใช้ยกเลิกการรวมเงิน');
      const sender = queue[i];
      consolidationState.currentSender = sender.name;
      addConsolidationLog(`----------------------------------------`, 'info');
      addConsolidationLog(`▶️ ลำดับที่ ${i + 1}/${queue.length}: จอ ${sender.name}...`, 'info');
      const ready = await prep.get(sender.id);

      const senderLive = await queryClientState(sender.debugPort);
      const senderCharName = senderLive?.charName || sender.name;
      const curZeny = (senderLive && typeof senderLive.zeny === 'number') ? senderLive.zeny : 0;
      const zenyToTransfer = Math.max(0, curZeny - keepZeny);

      if (ready && ready.nothingToTrade) {
        addConsolidationLog(`⏭️ จอ ${sender.name} (${senderCharName}): ไม่มีเงินเกินสำรองและไม่มีไอเทมในคลัง/กระเป๋า -> ข้ามและกลับไปฟาร์ม`, 'warning');
        consolidationState.completedSenders.push(sender.id);
        await releaseSender(sender, ready.homeChannel);
        startPrep(queue[i + SENDER_SLOTS]);
        continue;
      }

      // Re-verify sender's matching items in bag if tradeItemsEnabled
      let senderItemsQty = Number(ready && ready.bagMatchingQty) || 0;
      let senderItemsWeight = Number(ready && ready.bagMatchingWeight) || 0;
      if (tradeItemsEnabled) {
        const bagCheck = await evalProfilePort(
          sender.debugPort,
          `window.getConsolidationMatchingBagItems ? window.getConsolidationMatchingBagItems(${JSON.stringify(tradeItemsList)}) : { totalQty: 0, totalWeight: 0 }`,
          4000
        );
        if (bagCheck?.result) {
          senderItemsQty = Number(bagCheck.result.totalQty) || 0;
          senderItemsWeight = Number(bagCheck.result.totalWeight) || 0;
        }
      }

      if (!ready || !ready.ok || (zenyToTransfer <= 0 && senderItemsQty <= 0)) {
        addConsolidationLog(`⚠️ จอ ${sender.name}: ${(ready && ready.error) || 'ไม่มีเงินหรือไอเทมให้โอน'} — ข้าม`, 'error');
        await releaseSender(sender, ready && ready.homeChannel);
        startPrep(queue[i + SENDER_SLOTS]);
        continue;
      }

      // Ensure Receiver has enough free weight before initiating trade
      const receiverAvailWeight = tradeItemsEnabled && senderItemsQty > 0
        ? await ensureReceiverWeightReady(senderItemsWeight)
        : null;

      // B + C: the receiver waits for exactly this sender (replaces the previous watcher), then the sender
      // requests ONE trade, offers, locks and confirms. Done = the sender's zeny or items really went down.
      let attempt = 0, movedZeny = 0, movedItems = 0, lastErr = '';
      while (attempt < 2 && movedZeny <= 0 && movedItems <= 0) {
        attempt++;
        if (consolidationAborted) throw new Error('ผู้ใช้ยกเลิกการรวมเงิน');
        addConsolidationLog(`👑 ตัวรับเงิน (${receiverCharName}) รอรับคำขอเทรดจาก '${senderCharName}'${attempt > 1 ? ' (ลองใหม่ครั้งที่ 2)' : ''}...`, 'info');
        evalProfilePort(receiverProfile.debugPort, `
          window.setupReceiverTradeWatcher ? window.setupReceiverTradeWatcher(${JSON.stringify(senderCharName)}, 45000) : null
        `);
        await new Promise(r => setTimeout(r, 1200));

        const itemOfferNote = (tradeItemsEnabled && senderItemsQty > 0) ? ` + ไอเทม ${senderItemsQty} ชิ้น` : '';
        addConsolidationLog(`📤 จอ ${sender.name} (${senderCharName}) ส่งคำขอเทรดเงิน ${zenyToTransfer.toLocaleString()} z${itemOfferNote}...`, 'info');
        const tradeRes = await evalProfilePort(sender.debugPort, `
          (async () => {
            if (typeof window.executeSenderTrade === 'function') {
              return await window.executeSenderTrade(
                ${JSON.stringify(receiverCharName)},
                ${zenyToTransfer},
                38000,
                ${tradeItemsEnabled ? JSON.stringify(tradeItemsList) : 'null'},
                ${typeof receiverAvailWeight === 'number' && Number.isFinite(receiverAvailWeight) ? receiverAvailWeight : 'null'}
              );
            }
            return { success: false, error: 'No executeSenderTrade function' };
          })()
        `, 44000);
        await new Promise(r => setTimeout(r, 1500));
        const after = await queryClientState(sender.debugPort);
        const afterZeny = (after && typeof after.zeny === 'number') ? after.zeny : null;
        movedZeny = afterZeny === null ? 0 : Math.max(0, curZeny - afterZeny);
        movedItems = Number(tradeRes?.result?.transferredItemsQty) || 0;
        if (tradeItemsEnabled && senderItemsQty > 0 && movedItems === 0) {
          const afterBag = await evalProfilePort(
            sender.debugPort,
            `window.getConsolidationMatchingBagItems ? window.getConsolidationMatchingBagItems(${JSON.stringify(tradeItemsList)}) : { totalQty: 0 }`,
            4000
          );
          if (afterBag?.result && typeof afterBag.result.totalQty === 'number') {
            movedItems = Math.max(0, senderItemsQty - afterBag.result.totalQty);
          }
        }
        lastErr = tradeRes?.result?.error || tradeRes?.error || '';
        if (movedZeny > 0 || movedItems > 0) break;
        if (tradeRes?.result?.success && afterZeny === null) { movedZeny = zenyToTransfer; break; }
        if (afterZeny === null || /No executeSenderTrade/.test(lastErr)) break;
        if (attempt < 2) {
          addConsolidationLog(`⚠️ จอ ${sender.name} เทรดไม่สำเร็จ (${lastErr || 'เงิน/ไอเทมไม่ลด'}) — จะลองใหม่อีก 1 ครั้ง`, 'warning');
          await new Promise(r => setTimeout(r, 4000));
        }
      }

      if (movedZeny > 0 || movedItems > 0) {
        consolidationState.totalTransferredZeny += movedZeny;
        consolidationState.totalTransferredItems += movedItems;
        consolidationState.completedSenders.push(sender.id);
        const parts = [];
        if (movedZeny > 0) parts.push(`เงิน ${movedZeny.toLocaleString()} z`);
        if (movedItems > 0) parts.push(`ไอเทม ${movedItems.toLocaleString()} ชิ้น`);
        addConsolidationLog(`✅ โอนจาก [${senderCharName}] ให้ [${receiverCharName}] สำเร็จ: ${parts.join(' + ')}`, 'success');
      } else {
        addConsolidationLog(`⚠️ จอ ${sender.name} (${senderCharName}) เทรดไม่สำเร็จ: ${lastErr || 'เงิน/ไอเทมไม่ลด'} — ข้ามไปจอถัดไป`, 'error');
      }
      evalProfilePort(receiverProfile.debugPort, `window.stopReceiverTradeWatcher ? window.stopReceiverTradeWatcher() : null`, 3000);
      // leave the channel free for the next one, back to farming; the sender after next starts moving in
      await releaseSender(sender, ready.homeChannel);
      startPrep(queue[i + SENDER_SLOTS]);
      await new Promise(r => setTimeout(r, 1000));
    }

    // If tradeItemsEnabled, have the Receiver deposit all collected items into its storage at the end of Step 4
    if (tradeItemsEnabled) {
      const endCheck = await evalProfilePort(
        receiverProfile.debugPort,
        `window.getConsolidationMatchingBagItems ? window.getConsolidationMatchingBagItems(${JSON.stringify(tradeItemsList)}) : { totalQty: 0 }`,
        5000
      );
      const endQty = Number(endCheck?.result?.totalQty) || 0;
      if (endQty > 0) {
        consolidationState.step = `ตัวรับเงิน (${receiverCharName}) กำลังนำไอเทมที่รับมา (${endQty} ชิ้น) ไปฝากเข้าคลัง...`;
        addConsolidationLog(`📦 ตัวรับเงิน (${receiverCharName}) กำลังนำไอเทมที่รับมาทั้งหมด (${endQty} ชิ้น) ไปฝากเข้าคลัง...`, 'info');
        const endDep = await evalProfilePort(
          receiverProfile.debugPort,
          `window.depositConsolidationItemsToStorage ? window.depositConsolidationItemsToStorage(${JSON.stringify(tradeItemsList)}) : { success: false }`,
          35000
        );
        if (endDep?.result?.success) {
          addConsolidationLog(`✅ ตัวรับเงิน (${receiverCharName}) ฝากไอเทมเข้าคลังเรียบร้อย (${endDep.result.depositedQty} ชิ้น)`, 'success');
        }
      }
    }

    // -------------------------------------------------------------
    // STEP 5: เสร็จสิ้นการโอนเงิน และสั่งเริ่มบอท (START BOT) ทุกจอกลับไปฟาร์ม
    // -------------------------------------------------------------
    consolidationState.stepIndex = 5;
    consolidationState.step = 'เสร็จสิ้นการรวมเงิน! กำลังเปิดบอทให้ทุกจอเดินทางกลับไปฟาร์ม...';
    const summaryItemsText = consolidationState.totalTransferredItems > 0
      ? ` | ไอเทมรวม: ${consolidationState.totalTransferredItems.toLocaleString()} ชิ้น`
      : '';
    addConsolidationLog(`🎉 รวมเงินเสร็จสิ้นสมบูรณ์! ยอดเงินรวมที่โอนให้ ${receiverCharName}: ${consolidationState.totalTransferredZeny.toLocaleString()} z${summaryItemsText}`, 'success');
    addConsolidationLog('🚀 ขั้นตอนที่ 5/5: เริ่มสั่งเปิดบอท (START BOT) ทุกจอเพื่อเดินทางกลับไปฟาร์ม...', 'info');

    for (const p of involvedProfiles.filter(x => !restarted.has(x.id))) {
      try {
        const startRes = await evalProfilePort(p.debugPort, `(() => {
          window.__isConsolidating = false;
          window.__consolidationPending = false;
          window.__isWalkingToMap = false;
          window.__isNavigating = false;
          if (typeof window.restoreKeptFarmMap === 'function') window.restoreKeptFarmMap();
          window.__autoLoopEnabled = true;
          window.__isBotRunning = true;
          try { localStorage.setItem('pelican_auto_loop', 'true'); } catch(e){}
          try { localStorage.setItem('pelican_bot_running', 'true'); } catch(e){}
          const loopCheckbox = document.getElementById('p-auto-loop');
          if (loopCheckbox) loopCheckbox.checked = true;
          if (typeof window.startMasterBot === 'function') {
            window.startMasterBot();
          } else if (typeof window.startBot === 'function') {
            window.startBot();
          }
          if (typeof updateMasterBotUI === 'function') updateMasterBotUI();
          return { success: true, running: window.__isBotRunning };
        })()`);

        if (startRes && startRes.result && startRes.result.running) {
          addConsolidationLog(`▶️ สั่งเริ่มบอทหน้าจอ ${p.name} เดินทางกลับไปฟาร์มเรียบร้อย`, 'success');
        } else {
          addConsolidationLog(`▶️ ส่งคำสั่งเริ่มบอทหน้าจอ ${p.name} สำเร็จ`, 'info');
        }
        await new Promise(r => setTimeout(r, 1200));
      } catch(e) {
        addConsolidationLog(`⚠️ ไม่สามารถเริ่มบอทจอ ${p.name}: ${e.message}`, 'warning');
      }
    }

    consolidationState.step = 'เสร็จสิ้นการรวมเงินและเริ่มบอทกลับฟาร์มเรียบร้อย!';
    consolidationState.running = false;
    consolidationState.status = 'completed';
    consolidationState.endTime = Date.now();

  } catch (err) {
    consolidationState.running = false;
    consolidationState.status = consolidationAborted ? 'stopped' : 'error';
    addConsolidationLog(`⛔ การรวมเงินหยุดทำงาน: ${err.message}`, 'error');
    const involvedProfiles = [receiverProfile, ...senderProfiles];
    for (const p of involvedProfiles) {
      try {
        evalProfilePort(p.debugPort, `(() => { window.__isConsolidating = false; window.__consolidationPending = false; if (typeof window.restoreKeptFarmMap === 'function') window.restoreKeptFarmMap(); })()`);
      } catch(e) {}
    }
  }
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};

// ==========================================
// CHARACTER PORTRAIT CACHE (game art proxied & stored on disk)
// ==========================================
const PORTRAIT_HOST = "www.aetheria-online.in.th";
const PORTRAIT_DIR = path.join(__dirname, "data", "portraits");

// Only allow game class art: /art/classes/<name>.webp
function portraitPathFromSrc(src) {
  try {
    const u = new URL(src, `https://${PORTRAIT_HOST}`);
    if (u.hostname !== PORTRAIT_HOST) return null;
    if (!/^\/art\/classes\/[a-z0-9_-]+\.(webp|png)$/i.test(u.pathname)) return null;
    return u.pathname;
  } catch (e) {
    return null;
  }
}

function fetchPortrait(artPath) {
  const file = path.join(PORTRAIT_DIR, path.basename(artPath));
  if (fs.existsSync(file)) return Promise.resolve(file);
  return new Promise((resolve) => {
    https.get(`https://${PORTRAIT_HOST}${artPath}`, { timeout: 5000 }, (r) => {
      if (r.statusCode !== 200) { r.resume(); return resolve(null); }
      const chunks = [];
      r.on("data", c => chunks.push(c));
      r.on("end", () => {
        try {
          fs.mkdirSync(PORTRAIT_DIR, { recursive: true });
          fs.writeFileSync(file, Buffer.concat(chunks));
          resolve(file);
        } catch (e) { resolve(null); }
      });
    }).on("error", () => resolve(null)).on("timeout", function () { this.destroy(); resolve(null); });
  });
}


function runPowerShell(script) {
  return new Promise((resolve) => {
    const b64 = Buffer.from(script, 'utf16le').toString('base64');
    exec(`powershell -NoProfile -EncodedCommand ${b64}`, (err, stdout, stderr) => {
      resolve({ err, stdout, stderr, success: !err });
    });
  });
}

// Per-profile Zeny farming rate tracker (GP/M & GP/H — Gross income only, never deducting purchases/Tokens)
const ZENY_RATE_STATE_FILE = path.join(__dirname, "data", "zeny_rate_state.json");
const zenyRateTrackers = {};
let zenyRateStateDirty = false;
let lastProfilesZenyPollAt = 0;

function loadZenyRateState() {
  try {
    if (fs.existsSync(ZENY_RATE_STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ZENY_RATE_STATE_FILE, "utf8"));
      if (parsed && parsed.trackers && typeof parsed.trackers === "object") {
        const now = Date.now();
        const cutoff = now - 60 * 60 * 1000;
        for (const [pid, tr] of Object.entries(parsed.trackers)) {
          if (!tr || typeof tr !== "object") continue;
          if (now - (Number(tr.lastTime) || 0) > 6 * 60 * 60 * 1000) continue;
          const samples = Array.isArray(tr.samples)
            ? tr.samples.filter(s => s && typeof s.t === "number" && typeof s.gain === "number" && s.gain > 0 && s.t >= cutoff)
            : [];
          zenyRateTrackers[pid] = {
            charName: String(tr.charName || ""),
            startTime: Number(tr.startTime) || now,
            lastTime: Number(tr.lastTime) || now,
            lastZeny: typeof tr.lastZeny === "number" ? tr.lastZeny : null,
            lastGrossGained: typeof tr.lastGrossGained === "number" ? tr.lastGrossGained : null,
            totalGained: Math.max(0, Number(tr.totalGained) || 0),
            samples
          };
        }
      }
    }
  } catch (e) {}
}

function saveZenyRateStateNow() {
  try {
    fs.mkdirSync(path.dirname(ZENY_RATE_STATE_FILE), { recursive: true });
    const tmpFile = ZENY_RATE_STATE_FILE + ".tmp";
    fs.writeFileSync(tmpFile, JSON.stringify({ updatedAt: Date.now(), trackers: zenyRateTrackers }, null, 2), "utf8");
    fs.renameSync(tmpFile, ZENY_RATE_STATE_FILE);
    zenyRateStateDirty = false;
  } catch (e) {}
}

loadZenyRateState();
setInterval(() => {
  if (zenyRateStateDirty) saveZenyRateStateNow();
}, 10000);
process.on("exit", () => {
  if (zenyRateStateDirty) saveZenyRateStateNow();
});

function updateZenyRateTracker(profileId, liveState) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 60-minute rolling window
  const cutoff = now - windowMs;
  if (!liveState || liveState.error || typeof liveState.zeny !== 'number') {
    const existing = zenyRateTrackers[profileId];
    if (!existing) return { gpm: 0, gph: 0, totalGained: 0, elapsedSec: 0 };
    if (Array.isArray(existing.samples) && existing.samples.length > 0 && existing.samples[0].t < cutoff) {
      existing.samples = existing.samples.filter(s => s.t >= cutoff);
    }
    const windowStart = Math.max(existing.startTime || now, cutoff);
    const elapsedMs = Math.max(0, (existing.lastTime || now) - windowStart);
    const effectiveMin = Math.max(elapsedMs / 60000, 0.25);
    const windowGain = Array.isArray(existing.samples) ? existing.samples.reduce((sum, s) => sum + s.gain, 0) : 0;
    const gpm = (elapsedMs >= 3000 && windowGain > 0) ? Math.round(windowGain / effectiveMin) : 0;
    return { gpm, gph: gpm * 60, totalGained: existing.totalGained || 0, elapsedSec: Math.round(Math.max(0, (existing.lastTime || now) - existing.startTime) / 1000) };
  }
  const z = liveState.zeny;
  const gross = (typeof liveState.grossZenyGained === 'number' && Number.isFinite(liveState.grossZenyGained)) ? liveState.grossZenyGained : null;
  const isConsolReceiver = Boolean(liveState.consolidationReceiverMode);
  const charName = liveState.charName || '';
  let tr = zenyRateTrackers[profileId];
  if (!tr || (charName && tr.charName && tr.charName !== charName)) {
    tr = zenyRateTrackers[profileId] = {
      charName,
      startTime: now,
      lastTime: now,
      lastZeny: z,
      lastGrossGained: gross,
      totalGained: 0,
      samples: []
    };
    zenyRateStateDirty = true;
  } else {
    if (charName && !tr.charName) {
      tr.charName = charName;
      zenyRateStateDirty = true;
    }
    let gainDelta = 0;
    if (gross !== null) {
      if (typeof tr.lastGrossGained === 'number' && gross >= tr.lastGrossGained) {
        gainDelta = gross - tr.lastGrossGained;
      } else if (typeof tr.lastGrossGained === 'number' && gross > 0 && gross < tr.lastGrossGained) {
        // Client page reloaded and already accumulated new gross Zeny since reload
        gainDelta = gross;
      } else if (tr.lastGrossGained == null && typeof tr.lastZeny === 'number') {
        // First time attaching gross tracker to an already-tracked profile
        const rawDelta = z - tr.lastZeny;
        if (rawDelta > 0 && !isConsolReceiver) gainDelta = rawDelta;
      }
      if (tr.lastGrossGained !== gross) {
        tr.lastGrossGained = gross;
        zenyRateStateDirty = true;
      }
    } else if (typeof tr.lastZeny === 'number') {
      const rawDelta = z - tr.lastZeny;
      if (rawDelta > 0 && !isConsolReceiver) {
        gainDelta = rawDelta;
      }
    }
    if (tr.lastZeny !== z) {
      tr.lastZeny = z;
      zenyRateStateDirty = true;
    }
    tr.lastTime = now;
    if (gainDelta > 0 && !isConsolReceiver) {
      tr.totalGained += gainDelta;
      tr.samples.push({ t: now, gain: gainDelta });
      zenyRateStateDirty = true;
    }
  }
  if (tr.samples.length > 0 && tr.samples[0].t < cutoff) {
    tr.samples = tr.samples.filter(s => s.t >= cutoff);
  }
  const windowStart = Math.max(tr.startTime, cutoff);
  const elapsedMs = Math.max(0, now - windowStart);
  const windowGain = tr.samples.reduce((sum, s) => sum + s.gain, 0);
  let gpm = 0;
  if (elapsedMs >= 3000 && windowGain > 0) {
    const effectiveMin = Math.max(elapsedMs / 60000, 0.25);
    gpm = Math.round(windowGain / effectiveMin);
  }
  return {
    gpm,
    gph: gpm * 60,
    totalGained: tr.totalGained,
    elapsedSec: Math.round((now - tr.startTime) / 1000)
  };
}

let zenyBgPollInFlight = false;
setInterval(async () => {
  if (zenyBgPollInFlight) return;
  if (Date.now() - lastProfilesZenyPollAt < 4500) return;
  zenyBgPollInFlight = true;
  try {
    const profiles = loadProfiles();
    await Promise.all(profiles.map(async (p) => {
      if (!p || !p.debugPort) return;
      const proc = runningProcesses[p.id];
      const hasKnownProc = proc && isProcessAlive(proc.pid);
      const hasTracker = Boolean(zenyRateTrackers[p.id]);
      if (!hasKnownProc && !hasTracker && !browserMode.isOpen(p.id)) return;
      const liveState = await queryClientState(p.debugPort);
      if (liveState && !liveState.error && typeof liveState.zeny === "number") {
        updateZenyRateTracker(p.id, liveState);
      }
    }));
  } catch (e) {} finally {
    zenyBgPollInFlight = false;
  }
}, 4000);

// ==========================================
// PER-PROFILE & DAILY BANDWIDTH MONITOR (WebSocket + HTTP)
// ==========================================
const BANDWIDTH_STATS_FILE = path.join(__dirname, "data", "bandwidth_stats.json");
const bandwidthRateTrackers = {};
const bwProbeInstallCooldown = {};
let bandwidthStatsDirty = false;
let bandwidthStatsCache = null;

const BANDWIDTH_PROBE_INSTALL_JS = `(() => {
  if (typeof window.__pmGetBandwidth === 'function' && window.__pmBwState && window.__pmBwProbeVersion === 2) {
    return window.__pmGetBandwidth();
  }
  window.__pmBwProbeVersion = 2;
  const sessionId = Math.round((typeof performance !== 'undefined' && performance.timeOrigin) ? performance.timeOrigin : Date.now());
  const st = window.__pmBwState = window.__pmBwState || {
    sessionId,
    startedAt: Date.now(),
    wsRxBytes: 0,
    wsTxBytes: 0,
    wsRxPackets: 0,
    wsTxPackets: 0,
    httpRxBytes: 0,
    httpTxBytes: 0,
    httpRequests: 0,
    cachedRxBytes: 0,
    cachedRequests: 0,
    navCounted: false
  };
  if (typeof st.cachedRxBytes !== 'number') st.cachedRxBytes = 0;
  if (typeof st.cachedRequests !== 'number') st.cachedRequests = 0;

  function byteLen(data) {
    if (!data) return 0;
    if (typeof data.byteLength === 'number') return data.byteLength;
    if (data.buffer && typeof data.buffer.byteLength === 'number') return data.buffer.byteLength;
    if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size || 0;
    if (typeof data === 'string') return data.length;
    return 0;
  }

  const STATIC_ASSET_RE = /\\.(?:png|webp|jpg|jpeg|gif|svg|avif|ico|mp3|ogg|wav|m4a|aac|flac|woff2|woff|ttf|otf|eot)(?:$|\\?)/i;

  function consumeResourceEntries(entries) {
    if (!entries || !entries.length) return;
    const localCacheOn = window.__pmLocalAssetCacheEnabled !== false;
    for (let i = 0; i < entries.length; i++) {
      const r = entries[i];
      if (!r) continue;
      const name = String(r.name || '');
      if (name.includes('127.0.0.1') || name.includes('localhost')) continue;
      const transfer = Number(r.transferSize) || 0;
      const encoded = Number(r.encodedBodySize) || 0;
      if (localCacheOn && STATIC_ASSET_RE.test(name)) {
        const saved = transfer > 0 ? transfer : encoded;
        if (saved > 0) {
          st.cachedRxBytes += saved;
          st.cachedRequests += 1;
        }
        continue;
      }
      if (transfer > 0) {
        st.httpRxBytes += transfer;
        st.httpTxBytes += 160;
        st.httpRequests += 1;
      } else if (encoded > 0 && (r.initiatorType === 'fetch' || r.initiatorType === 'xmlhttprequest')) {
        st.httpRxBytes += encoded + 120;
        st.httpTxBytes += 160;
        st.httpRequests += 1;
      }
    }
  }

  try {
    if (!st.navCounted && typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function') {
      st.navCounted = true;
      consumeResourceEntries(performance.getEntriesByType('navigation'));
      consumeResourceEntries(performance.getEntriesByType('resource'));
      if (typeof performance.clearResourceTimings === 'function') {
        performance.clearResourceTimings();
      }
    }
  } catch (e) {}

  try {
    if (st.observer && typeof st.observer.disconnect === 'function') {
      st.observer.disconnect();
      st.observer = null;
    }
    if (typeof PerformanceObserver === 'function' && !st.observer) {
      const obs = new PerformanceObserver((list) => {
        try {
          consumeResourceEntries(list.getEntries());
          if (typeof performance.clearResourceTimings === 'function') {
            performance.clearResourceTimings();
          }
        } catch (e) {}
      });
      obs.observe({ type: 'resource', buffered: false });
      st.observer = obs;
    }
  } catch (e) {}

  function hookSocket(ws) {
    if (!ws || ws.__pmBwHooked) return;
    const url = String(ws.url || '');
    if (url.includes('127.0.0.1') || url.includes('localhost')) return;
    ws.__pmBwHooked = true;
    try {
      ws.addEventListener('message', (ev) => {
        const len = byteLen(ev && ev.data);
        if (len > 0) {
          st.wsRxBytes += len + 28;
          st.wsRxPackets += 1;
        }
      });
    } catch (e) {}
    try {
      const prevSend = ws.send;
      if (typeof prevSend === 'function') {
        ws.send = function(data) {
          try {
            const len = byteLen(data);
            if (len > 0) {
              st.wsTxBytes += len + 32;
              st.wsTxPackets += 1;
            }
          } catch (e) {}
          return prevSend.apply(this, arguments);
        };
      }
    } catch (e) {}
  }

  window.__pmHookSocketBandwidth = hookSocket;
  if (window.__gameSocket) hookSocket(window.__gameSocket);

  try {
    const wsProto = window.WebSocket && window.WebSocket.prototype;
    if (wsProto && !wsProto.__pmBwProtoHooked) {
      wsProto.__pmBwProtoHooked = true;
      const prevAdd = wsProto.addEventListener;
      if (typeof prevAdd === 'function') {
        wsProto.addEventListener = function(type, listener, options) {
          if (type === 'message' && !this.__pmBwHooked) {
            hookSocket(this);
          }
          return prevAdd.apply(this, arguments);
        };
      }
    }
  } catch (e) {}

  if (!st.watchTimer) {
    st.watchTimer = setInterval(() => {
      if (window.__gameSocket && !window.__gameSocket.__pmBwHooked) {
        hookSocket(window.__gameSocket);
      }
    }, 1000);
  }

  window.__pmGetBandwidth = function() {
    if (window.__gameSocket && !window.__gameSocket.__pmBwHooked) {
      hookSocket(window.__gameSocket);
    }
    const rxBytes = st.wsRxBytes + st.httpRxBytes;
    const txBytes = st.wsTxBytes + st.httpTxBytes;
    return {
      probeVersion: 2,
      sessionId: st.sessionId,
      rxBytes,
      txBytes,
      totalBytes: rxBytes + txBytes,
      wsRxBytes: st.wsRxBytes,
      wsTxBytes: st.wsTxBytes,
      httpRxBytes: st.httpRxBytes,
      httpTxBytes: st.httpTxBytes,
      cachedRxBytes: st.cachedRxBytes || 0,
      cachedRequests: st.cachedRequests || 0,
      wsRxPackets: st.wsRxPackets,
      wsTxPackets: st.wsTxPackets,
      httpRequests: st.httpRequests
    };
  };

  return window.__pmGetBandwidth();
})()`;

function loadBandwidthStats() {
  if (bandwidthStatsCache) return bandwidthStatsCache;
  try {
    if (fs.existsSync(BANDWIDTH_STATS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(BANDWIDTH_STATS_FILE, "utf8"));
      if (parsed && typeof parsed === "object") {
        bandwidthStatsCache = {
          updatedAt: parsed.updatedAt || Date.now(),
          lastSession: (parsed.lastSession && typeof parsed.lastSession === "object") ? parsed.lastSession : {},
          daily: (parsed.daily && typeof parsed.daily === "object") ? parsed.daily : {}
        };
        return bandwidthStatsCache;
      }
    }
  } catch (e) {}
  bandwidthStatsCache = { updatedAt: Date.now(), lastSession: {}, daily: {} };
  return bandwidthStatsCache;
}

function saveBandwidthStatsNow() {
  if (!bandwidthStatsCache) return;
  try {
    fs.mkdirSync(path.dirname(BANDWIDTH_STATS_FILE), { recursive: true });
    const keys = Object.keys(bandwidthStatsCache.daily || {}).sort();
    while (keys.length > 30) {
      const oldKey = keys.shift();
      delete bandwidthStatsCache.daily[oldKey];
    }
    bandwidthStatsCache.updatedAt = Date.now();
    const tmpFile = BANDWIDTH_STATS_FILE + ".tmp";
    fs.writeFileSync(tmpFile, JSON.stringify(bandwidthStatsCache, null, 2), "utf8");
    fs.renameSync(tmpFile, BANDWIDTH_STATS_FILE);
    bandwidthStatsDirty = false;
  } catch (e) {}
}

setInterval(() => {
  if (bandwidthStatsDirty) saveBandwidthStatsNow();
}, 10000);
process.on("exit", () => {
  if (bandwidthStatsDirty) saveBandwidthStatsNow();
});

async function updateBandwidthTracker(profileId, liveState, debugPort) {
  const store = loadBandwidthStats();
  const now = Date.now();
  const todayKey = getThaiDateKey(now);
  if (!store.daily[todayKey]) {
    store.daily[todayKey] = {
      date: todayKey,
      rxBytes: 0,
      txBytes: 0,
      totalBytes: 0,
      wsRxBytes: 0,
      wsTxBytes: 0,
      httpRxBytes: 0,
      httpTxBytes: 0,
      byProfile: {}
    };
  }
  const dayBucket = store.daily[todayKey];
  if (!dayBucket.byProfile[profileId]) {
    dayBucket.byProfile[profileId] = {
      rxBytes: 0,
      txBytes: 0,
      totalBytes: 0,
      wsRxBytes: 0,
      wsTxBytes: 0,
      httpRxBytes: 0,
      httpTxBytes: 0,
      activeSec: 0,
      updatedAt: now
    };
  }
  const profDaily = dayBucket.byProfile[profileId];

  if (liveState && !liveState.error && (!liveState.bandwidth || liveState.bandwidth.probeVersion !== 2) && debugPort) {
    const lastTry = bwProbeInstallCooldown[debugPort] || 0;
    if (now - lastTry > 5000) {
      bwProbeInstallCooldown[debugPort] = now;
      try {
        const res = await evalProfilePort(debugPort, BANDWIDTH_PROBE_INSTALL_JS, 1500);
        if (res && res.success && res.result && typeof res.result.totalBytes === "number") {
          liveState.bandwidth = res.result;
        }
      } catch (e) {}
    }
  }

  const isOnline = Boolean(liveState && !liveState.error);
  const bw = (isOnline && liveState.bandwidth && typeof liveState.bandwidth.totalBytes === "number") ? liveState.bandwidth : null;

  if (bw) {
    const prevSess = store.lastSession[profileId];
    const sameSession = Boolean(
      prevSess &&
      prevSess.sessionId === bw.sessionId &&
      bw.rxBytes >= (prevSess.rxBytes || 0) &&
      bw.txBytes >= (prevSess.txBytes || 0)
    );

    const deltaRx = sameSession ? Math.max(0, bw.rxBytes - (prevSess.rxBytes || 0)) : Math.max(0, bw.rxBytes || 0);
    const deltaTx = sameSession ? Math.max(0, bw.txBytes - (prevSess.txBytes || 0)) : Math.max(0, bw.txBytes || 0);
    const deltaWsRx = sameSession ? Math.max(0, (bw.wsRxBytes || 0) - (prevSess.wsRxBytes || 0)) : Math.max(0, bw.wsRxBytes || 0);
    const deltaWsTx = sameSession ? Math.max(0, (bw.wsTxBytes || 0) - (prevSess.wsTxBytes || 0)) : Math.max(0, bw.wsTxBytes || 0);
    const deltaHttpRx = sameSession ? Math.max(0, (bw.httpRxBytes || 0) - (prevSess.httpRxBytes || 0)) : Math.max(0, bw.httpRxBytes || 0);
    const deltaHttpTx = sameSession ? Math.max(0, (bw.httpTxBytes || 0) - (prevSess.httpTxBytes || 0)) : Math.max(0, bw.httpTxBytes || 0);
    const deltaTotal = deltaRx + deltaTx;

    store.lastSession[profileId] = {
      sessionId: bw.sessionId,
      rxBytes: bw.rxBytes || 0,
      txBytes: bw.txBytes || 0,
      wsRxBytes: bw.wsRxBytes || 0,
      wsTxBytes: bw.wsTxBytes || 0,
      httpRxBytes: bw.httpRxBytes || 0,
      httpTxBytes: bw.httpTxBytes || 0,
      updatedAt: now
    };

    if (deltaTotal > 0) {
      profDaily.rxBytes = (profDaily.rxBytes || 0) + deltaRx;
      profDaily.txBytes = (profDaily.txBytes || 0) + deltaTx;
      profDaily.totalBytes = (profDaily.rxBytes || 0) + (profDaily.txBytes || 0);
      profDaily.wsRxBytes = (profDaily.wsRxBytes || 0) + deltaWsRx;
      profDaily.wsTxBytes = (profDaily.wsTxBytes || 0) + deltaWsTx;
      profDaily.httpRxBytes = (profDaily.httpRxBytes || 0) + deltaHttpRx;
      profDaily.httpTxBytes = (profDaily.httpTxBytes || 0) + deltaHttpTx;
      profDaily.updatedAt = now;

      dayBucket.rxBytes = (dayBucket.rxBytes || 0) + deltaRx;
      dayBucket.txBytes = (dayBucket.txBytes || 0) + deltaTx;
      dayBucket.totalBytes = (dayBucket.rxBytes || 0) + (dayBucket.txBytes || 0);
      dayBucket.wsRxBytes = (dayBucket.wsRxBytes || 0) + deltaWsRx;
      dayBucket.wsTxBytes = (dayBucket.wsTxBytes || 0) + deltaWsTx;
      dayBucket.httpRxBytes = (dayBucket.httpRxBytes || 0) + deltaHttpRx;
      dayBucket.httpTxBytes = (dayBucket.httpTxBytes || 0) + deltaHttpTx;
      bandwidthStatsDirty = true;
    }

    let rt = bandwidthRateTrackers[profileId];
    if (!rt || rt.sessionId !== bw.sessionId) {
      rt = bandwidthRateTrackers[profileId] = {
        sessionId: bw.sessionId,
        startTime: now,
        lastTime: now,
        samples: []
      };
    } else {
      const dtMs = now - rt.lastTime;
      rt.lastTime = now;
      if (dtMs > 0 && dtMs <= 30000) {
        profDaily.activeSec = (profDaily.activeSec || 0) + (dtMs / 1000);
        bandwidthStatsDirty = true;
      }
      if (deltaTotal > 0) {
        rt.samples.push({ t: now, bytes: deltaTotal, rx: deltaRx, tx: deltaTx });
      }
    }
  }

  let bps = 0;
  let rxBps = 0;
  let txBps = 0;
  const rt = bandwidthRateTrackers[profileId];
  if (isOnline && rt && Array.isArray(rt.samples)) {
    const windowMs = 10 * 60 * 1000;
    const cutoff = now - windowMs;
    if (rt.samples.length > 0 && rt.samples[0].t < cutoff) {
      rt.samples = rt.samples.filter(s => s.t >= cutoff);
    }
    const windowStart = Math.max(rt.startTime, cutoff);
    const elapsedSec = Math.max(0, (now - windowStart) / 1000);
    if (elapsedSec >= 1.5 && rt.samples.length > 0) {
      const sumBytes = rt.samples.reduce((acc, s) => acc + s.bytes, 0);
      const sumRx = rt.samples.reduce((acc, s) => acc + s.rx, 0);
      const sumTx = rt.samples.reduce((acc, s) => acc + s.tx, 0);
      bps = Math.round(sumBytes / elapsedSec);
      rxBps = Math.round(sumRx / elapsedSec);
      txBps = Math.round(sumTx / elapsedSec);
    }
  }

  const bytesPerHour = bps > 0
    ? bps * 3600
    : ((profDaily.activeSec >= 30 && profDaily.totalBytes > 0)
        ? Math.round((profDaily.totalBytes / profDaily.activeSec) * 3600)
        : 0);
  const estDayBytes = bytesPerHour * 24;

  return {
    date: todayKey,
    todayBytes: profDaily.totalBytes || 0,
    todayRxBytes: profDaily.rxBytes || 0,
    todayTxBytes: profDaily.txBytes || 0,
    todayWsBytes: (profDaily.wsRxBytes || 0) + (profDaily.wsTxBytes || 0),
    todayHttpBytes: (profDaily.httpRxBytes || 0) + (profDaily.httpTxBytes || 0),
    cachedRxBytes: (bw && typeof bw.cachedRxBytes === "number") ? bw.cachedRxBytes : 0,
    activeSec: Math.round(profDaily.activeSec || 0),
    bps,
    rxBps,
    txBps,
    bytesPerHour,
    estDayBytes
  };
}

function resetBandwidthTracker(profileId) {
  const store = loadBandwidthStats();
  const now = Date.now();
  const todayKey = getThaiDateKey(now);
  const dayBucket = store.daily[todayKey];
  if (profileId === "all") {
    store.daily[todayKey] = {
      date: todayKey,
      rxBytes: 0,
      txBytes: 0,
      totalBytes: 0,
      wsRxBytes: 0,
      wsTxBytes: 0,
      httpRxBytes: 0,
      httpTxBytes: 0,
      byProfile: {}
    };
    for (const k of Object.keys(bandwidthRateTrackers)) {
      bandwidthRateTrackers[k].startTime = now;
      bandwidthRateTrackers[k].lastTime = now;
      bandwidthRateTrackers[k].samples = [];
    }
    try {
      if (typeof screenProxy !== "undefined" && screenProxy && typeof screenProxy.resetTrafficStats === "function") {
        screenProxy.resetTrafficStats();
      }
    } catch (_) {}
  } else {
    if (dayBucket && dayBucket.byProfile && dayBucket.byProfile[profileId]) {
      const p = dayBucket.byProfile[profileId];
      dayBucket.rxBytes = Math.max(0, (dayBucket.rxBytes || 0) - (p.rxBytes || 0));
      dayBucket.txBytes = Math.max(0, (dayBucket.txBytes || 0) - (p.txBytes || 0));
      dayBucket.totalBytes = dayBucket.rxBytes + dayBucket.txBytes;
      dayBucket.wsRxBytes = Math.max(0, (dayBucket.wsRxBytes || 0) - (p.wsRxBytes || 0));
      dayBucket.wsTxBytes = Math.max(0, (dayBucket.wsTxBytes || 0) - (p.wsTxBytes || 0));
      dayBucket.httpRxBytes = Math.max(0, (dayBucket.httpRxBytes || 0) - (p.httpRxBytes || 0));
      dayBucket.httpTxBytes = Math.max(0, (dayBucket.httpTxBytes || 0) - (p.httpTxBytes || 0));
      dayBucket.byProfile[profileId] = {
        rxBytes: 0,
        txBytes: 0,
        totalBytes: 0,
        wsRxBytes: 0,
        wsTxBytes: 0,
        httpRxBytes: 0,
        httpTxBytes: 0,
        activeSec: 0,
        updatedAt: now
      };
    }
    if (bandwidthRateTrackers[profileId]) {
      bandwidthRateTrackers[profileId].startTime = now;
      bandwidthRateTrackers[profileId].lastTime = now;
      bandwidthRateTrackers[profileId].samples = [];
    }
  }
  bandwidthStatsDirty = true;
  saveBandwidthStatsNow();
}

const planSync = createPlanSync({ loadPlans, savePlans, loadProfiles, evalProfilePort });
// Observation only by default. Pilot keys/profile IDs require a separately reviewed activation.
const scriptRollout = loadScriptRollout({dataDir:path.join(__dirname,'data'),serviceOrigin:humanCheckSolver.serviceOrigin});
const legacyScriptCoordinator = createScriptCoordinator({ dataDir: path.join(__dirname, 'data'), loadProfiles, evalProfilePort, service: humanCheckSolver, ...scriptRollout, reloadRollout:()=>loadScriptRollout({dataDir:path.join(__dirname,'data'),serviceOrigin:humanCheckSolver.serviceOrigin}) });
const {createOfflineCoordinator}=require('./offline_coordinator');
const offlineCoordinator = createOfflineCoordinator({dataDir:path.join(__dirname,'data'),loadProfiles,evalProfilePort,service:humanCheckSolver,trustedKeys:require('./script_release_keys'),legacyCoordinator:legacyScriptCoordinator,autoBindWallet:false});

const { createCoordinatedScriptCoordinator } = require('./coordinated_coordinator');

const scriptCoordinator = createCoordinatedScriptCoordinator({
  legacyCoordinator: legacyScriptCoordinator,
  offlineCoordinator,
  service: humanCheckSolver,
  getSettings: () => ({ ...installer.loadSettings(), accountId: humanCheckSolver.loadSettings()?.accountId || null }),
  dataDir: path.join(__dirname, 'data')
});

const botAutoUpdater = createBotAutoUpdater({
  loadProfiles,
  evalProfilePort,
  getGameDir: () => installer.getEffectiveGamePath(),
  getManagedRelease:()=>scriptCoordinator.refreshRelease?scriptCoordinator.refreshRelease():scriptCoordinator.release?.(),
  getCachedManagedRelease:()=>scriptCoordinator.release?.(),
  isConsolidating: () => Boolean(typeof consolidationState !== 'undefined' && consolidationState && consolidationState.running),
  dataDir: path.join(__dirname, "data")
});
// Auto-login / auto-register: game clients get their profile's ID + password (manager/auth_sync.js)
const authSync = createAuthSync({ loadProfiles, saveProfiles, evalProfilePort, credentials, proxyRegister });
// Per-screen IP queue & split-tunnel forwarder (1 IP : 3 screens)
const screenProxy = createScreenProxyManager({
  dataDir: path.join(__dirname, "data"),
  solver: humanCheckSolver,
  loadProfiles
});
// Browser mode: game windows in one real Chrome / Edge instead of one Electron app each (manager/browser_mode.js)
const browserMode = createBrowserMode({ rootDir: path.resolve(__dirname, ".."), sessionsDir: SESSIONS_DIR, getSettings: () => installer.loadSettings(), loadProfiles, ...(TEST_INSTANCE?{cdpPort:testCdpPort,browserUserDataDir:path.join(SESSIONS_DIR,'_isolated_test_browser')}:{ }), profileScriptSource:id=>scriptCoordinator.profileScriptSource(id), screenProxy });
const isBrowserMode = () => {
  const st = installer.loadSettings() || {};
  return (st.launchMode || "browser") === "browser";
};

async function syncScreenProxyForOpenProfiles() {
  if (!screenProxy.isEnabled()) return [];
  const profiles = loadProfiles() || [];
  const openProfiles = [];
  for (const p of profiles) {
    const isOpen = browserMode.isOpen(p.id) || (runningProcesses[p.id] && isProcessAlive(runningProcesses[p.id].pid)) || (p.debugPort && await portAnswers(p.debugPort));
    if (isOpen) openProfiles.push(p);
  }
  if (openProfiles.length === 0) return [];
  try {
    await screenProxy.acquireLeasesForProfiles(openProfiles.map(p => p.id));
  } catch (_) {}
  const results = [];
  for (const p of openProfiles) {
    try {
      const tunnel = await screenProxy.ensureProfileTunnel(p.id, p.debugPort);
      const lease = screenProxy.getProfileLeaseSnapshot(p.id);
      results.push({ profileId: p.id, name: p.name, lease, proxyServerUrl: tunnel?.proxyUrl || null });
    } catch (e) {
      results.push({ profileId: p.id, name: p.name, error: e.message });
    }
  }
  return results;
}

const managerUpdater = createManagerSelfUpdater({
  managerDir: __dirname,
  dataDir: path.join(__dirname, "data"),
  // Never restart in the middle of reloading game clients or a zeny consolidation run
  isBusy: () => botAutoUpdater.isBusy() || consolidationState.running
});

const VALID_CHANNEL_CHECK_MODES = ["all", "party_only", "solo_only", "off"];

function getEffectiveChannelCheckMode() {
  const st = installer.loadSettings() || {};
  const raw = typeof st.channelCheckMode === "string" ? st.channelCheckMode.trim() : "";
  return VALID_CHANNEL_CHECK_MODES.includes(raw) ? raw : "all";
}

function saveChannelCheckMode(mode) {
  const valid = VALID_CHANNEL_CHECK_MODES.includes(mode) ? mode : "all";
  installer.saveSettings({ channelCheckMode: valid });
  return valid;
}

async function syncChannelCheckModeToAllClients(mode) {
  const valid = VALID_CHANNEL_CHECK_MODES.includes(mode) ? mode : getEffectiveChannelCheckMode();
  const profiles = loadProfiles();
  let syncedCount = 0;
  let totalChecked = 0;
  const evalCode = `(() => {
    if (typeof window.setChannelCheckMode === 'function') return window.setChannelCheckMode(${JSON.stringify(valid)});
    window.__channelCheckMode = ${JSON.stringify(valid)};
    try { localStorage.setItem('pelican_channel_check_mode', ${JSON.stringify(valid)}); } catch (_) {}
    return { success: true, mode: ${JSON.stringify(valid)} };
  })()`;
  await Promise.all(profiles.map(async (p) => {
    if (!p || !p.debugPort) return;
    totalChecked++;
    try {
      const r = await evalProfilePort(p.debugPort, evalCode, 3500);
      if (r && r.success !== false) syncedCount++;
    } catch (_) {}
  }));
  return { mode: valid, syncedCount, totalChecked };
}

// Party system: auto-form in-game parties from Manager clients (manager/party_api.js)
const partyService = createPartyService({
  loadProfiles,
  evalProfilePort,
  dataFile: path.join(__dirname, "data", "parties.json"),
  isBusy: () => consolidationState.running,
  getChannelCheckMode: getEffectiveChannelCheckMode
});
partyService.start();

// Auto Premium (VIP): buy Token with zeny and keep Premium going (manager/premium_api.js)
const premiumService = createPremiumService({
  loadProfiles,
  evalProfilePort,
  dataFile: path.join(__dirname, "data", "premium.json"),
  isBusy: () => botAutoUpdater.isBusy() || consolidationState.running
});
premiumService.start();

// Auto Guild & Daily Material Donation (manager/guild_api.js)
const guildService = createGuildService({
  loadProfiles,
  evalProfilePort,
  dataFile: path.join(__dirname, "data", "guilds.json"),
  isBusy: () => botAutoUpdater.isBusy() || consolidationState.running
});
guildService.start();

function getDefaultDeviceNickname() {
  return process.env.USERNAME || (typeof os.userInfo === 'function' ? os.userInfo()?.username : '') || os.hostname() || 'PmheeUser';
}

function getEffectiveDeviceNickname() {
  const st = installer.loadSettings() || {};
  if (st.deviceNickname && typeof st.deviceNickname === 'string' && st.deviceNickname.trim()) {
    return st.deviceNickname.trim();
  }
  return getDefaultDeviceNickname();
}

const CAPTCHA_STATS_FILE = path.join(__dirname, "data", "captcha_stats.json");

function getThaiDateKey(timestamp = Date.now()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(Number(timestamp)));
  } catch (e) {
    const d = new Date(Number(timestamp) + 7 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }
}

function bootstrapDailyFromRequests() {
  const daily = {};
  try {
    const reqStateFile = path.join(__dirname, "data", "aetheria_request_state.json");
    if (fs.existsSync(reqStateFile)) {
      const reqs = JSON.parse(fs.readFileSync(reqStateFile, "utf8")) || {};
      for (const [pid, entry] of Object.entries(reqs)) {
        if (!entry) continue;
        const ts = entry.seenAt || Date.now();
        const dateKey = getThaiDateKey(ts);
        if (!daily[dateKey]) {
          daily[dateKey] = { date: dateKey, total: 0, byProfile: {} };
        }
        daily[dateKey].total += 1;
        daily[dateKey].byProfile[pid] = (daily[dateKey].byProfile[pid] || 0) + 1;
      }
    }
  } catch (e) {}
  return daily;
}

// Real implementation lives in captcha_stats.js (tested directly by tests/captcha_stats_delayed.test.js).
const captchaStats = require('./captcha_stats').createCaptchaStats({ file: CAPTCHA_STATS_FILE, bootstrapDaily: bootstrapDailyFromRequests });
function getCaptchaStats() { return captchaStats.get(); }
function recordCaptchaSolved(profileId, details = {}) { return captchaStats.record(profileId, details); }
const ADMIN_PEERS_FILE = path.join(__dirname, "data", "admin_peers.json");
function loadAdminPeers() {
  try {
    if (fs.existsSync(ADMIN_PEERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ADMIN_PEERS_FILE, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (_) {}
  return [];
}
function saveAdminPeers(peers) {
  try {
    fs.writeFileSync(ADMIN_PEERS_FILE, JSON.stringify(peers, null, 2), 'utf8');
    return true;
  } catch (_) { return false; }
}

async function stopSingleProfile(id) {
  await screenProxy.releaseProfile(id, 'stopped').catch(() => {});
  if (browserMode.isOpen(id)) {
    try { await browserMode.stop(id); } catch (_) {}
    return { success: true };
  }
  const proc = runningProcesses[id];
  if (proc && proc.pid) {
    try { exec(`taskkill /pid ${proc.pid} /f /t`); } catch (_) {}
  }
  delete runningProcesses[id];
  return { success: true };
}

async function stopAllProfiles() {
  await screenProxy.releaseAll().catch(() => {});
  for (const p of loadProfiles()) {
    if (browserMode.isOpen(p.id)) browserMode.stop(p.id).catch(() => {});
  }
  for (const id in runningProcesses) {
    const proc = runningProcesses[id];
    if (proc && proc.pid) {
      try { exec(`taskkill /pid ${proc.pid} /f /t`); } catch (_) {}
    }
    delete runningProcesses[id];
  }
  return { success: true };
}


const discordService = createDiscordBotService({
  dataDir: path.join(__dirname, "data"),
  loadProfiles,
  evalProfilePort,
  focusProfileWindow: (profileId) => {
    const profile = loadProfiles().find(p => p.id === profileId);
    if (profile && profile.debugPort) {
      http.get(`http://127.0.0.1:${profile.debugPort}/api/window?action=top`, () => {}).on('error', () => {});
    }
  },
  humanCheckSolver,
  getDeviceNickname: getEffectiveDeviceNickname,
  onCaptchaSolved: recordCaptchaSolved,
  stopProfile: stopSingleProfile,
  stopAll: stopAllProfiles
});

const embeddedHumanCheckBridge=require('./embedded_human_check_bridge').createEmbeddedHumanCheckBridge({evalProfilePort,recordCaptchaSolved,getConfig:()=>{const hc=humanCheckSolver.loadSettings(),dc=discordService.loadSettings();return {autoAnswer:hc.autoAnswer!==false&&dc.autoAnswer!==false,answerDelayMs:hc.answerDelayMs};}});

// OS-level Windows sound alert so Human Check / Prison alerts are audible even when browser tabs are backgrounded or muted
let lastWindowsBeepAt = 0;
let windowsBeepInFlight = false;
function triggerWindowsAlertBeep(urgent = false) {
  if (TEST_INSTANCE || process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test') return;
  const now = Date.now();
  const minGap = urgent ? 4500 : 7500;
  if (windowsBeepInFlight || now - lastWindowsBeepAt < minGap) return;
  lastWindowsBeepAt = now;
  windowsBeepInFlight = true;
  try { process.stdout.write('\x07'); } catch (_) {}
  const psCmd = urgent
    ? '[console]::beep(988,160); [console]::beep(1318,160); [console]::beep(988,160); [console]::beep(1318,240)'
    : '[console]::beep(880,170); [console]::beep(1175,210)';
  runPowerShell(psCmd).finally(() => { windowsBeepInFlight = false; });
}

const humanCheckFirstSeenByProfile = new Map();
const prisonAlertedByProfile = new Map();
let humanCheckMonitorInFlight = false;

function isJailMapName(mapStr) {
  if (typeof mapStr !== 'string') return false;
  const s = mapStr.trim();
  if (!s || s === '--') return false;
  return /คุก|เรือนจำ|\bprison\b|\bjail\b/i.test(s);
}

function isConfirmedOutOfJailMap(state) {
  if (!state || typeof state.map !== 'string') return false;
  const s = state.map.trim();
  if (!s || s === '--' || s === '-' || /ไม่ทราบแมพ|unknown|loading|กำลังโหลด/i.test(s)) return false;
  if (isJailMapName(s)) return false;
  if (!state.charName) return false;
  return true;
}

const jailStoppingInFlight = new Set();
async function recordProfileJailedAndStop(profile, state) {
  if (!profile || !profile.id) return false;
  const pid = String(profile.id);
  const now = Date.now();
  const mapName = (state && typeof state.map === 'string' && state.map.trim()) ? state.map.trim() : 'คุก';
  let shouldStop = false;
  try {
    const fresh = loadProfiles();
    const target = fresh.find(f => String(f.id) === pid);
    if (target) {
      shouldStop = !target.jailAutoStopped;
      target.isJailed = true;
      target.jailAutoStopped = true;
      target.jailedAt = target.jailedAt || now;
      target.jailedMap = mapName;
      if (state && state.charName) target.lastCharName = state.charName;
      if (state && state.charClass) target.lastCharClass = state.charClass;
      saveProfiles(fresh);
    }
  } catch (_) {}

  if (shouldStop && !jailStoppingInFlight.has(pid)) {
    jailStoppingInFlight.add(pid);
    try {
      console.warn(`[JAIL AUTO-STOP] 🚨 ตรวจพบจอ "${profile.name || pid}" อยู่ในแมพคุกครั้งแรก (${mapName}) — ปิดจออัตโนมัติทันที!`);
      await stopSingleProfile(pid);
    } catch (_) {} finally {
      setTimeout(() => jailStoppingInFlight.delete(pid), 4000);
    }
  }
  return shouldStop;
}

function clearProfileJailStatus(profileId, resetAutoStop = false) {
  const pid = String(profileId || '');
  const fresh = loadProfiles();
  let changed = false;
  for (const p of fresh) {
    if (!profileId || String(p.id) === pid) {
      if (p.isJailed || p.jailedAt || p.jailedMap || (resetAutoStop && p.jailAutoStopped) || (!resetAutoStop && !p.jailAutoStopped)) {
        delete p.isJailed;
        delete p.jailedAt;
        delete p.jailedMap;
        if (resetAutoStop) {
          delete p.jailAutoStopped;
        } else {
          p.jailAutoStopped = true;
        }
        changed = true;
      }
    }
  }
  if (changed) saveProfiles(fresh);
  return changed;
}

// Background monitor for Human Check (alerts Discord + OS beep even if Manager UI is closed/idle)
setInterval(async () => {
  if (humanCheckMonitorInFlight) return;
  humanCheckMonitorInFlight = true;
  try {
    const profiles = loadProfiles().filter(p => p && p.debugPort);
    const BATCH_SIZE = 10;
    let shouldBeepNormal = false;
    let shouldBeepUrgent = false;

    for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
      const batch = profiles.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (p) => {
        try {
          const state = await queryClientState(p.debugPort);
          await embeddedHumanCheckBridge.collect(p, state);
          if (state && Array.isArray(state.humanCheckWrongAttempts) && state.humanCheckWrongAttempts.length > 0) {
            shouldBeepUrgent = true;
            if (typeof discordService.notifyHumanCheckWrongAttempt === 'function') {
              for (const attempt of state.humanCheckWrongAttempts) {
                discordService.notifyHumanCheckWrongAttempt({ profile: p, attempt });
              }
            }
          }
          if (state && state.humanCheck && state.humanCheck.active) {
            const now = Date.now();
            if (!humanCheckFirstSeenByProfile.has(p.id)) {
              humanCheckFirstSeenByProfile.set(p.id, now);
              shouldBeepNormal = true;
            } else if (now - humanCheckFirstSeenByProfile.get(p.id) >= 4000) {
              shouldBeepUrgent = true;
            }
            if (state.humanCheck.isUpdatedFormat) {
              console.warn(`[EMERGENCY STOP] ตรวจพบ Human Check รูปแบบใหม่บนจอ ${p.name || p.id} — ปิดทุกจออัตโนมัติทันที!`);
              stopAllProfiles();
              if (typeof discordService.notifyHumanCheckEmergency === 'function') {
                discordService.notifyHumanCheckEmergency({ profile: p, check: state.humanCheck, reason: 'ตรวจพบโจทย์รูปแบบใหม่ (Image Board / ไม่มีปุ่มเลือกไอคอนเดิม)' });
              }
            } else {
              discordService.notifyHumanCheck({ profile: p, check: state.humanCheck });
            }
          } else if (state) {
            humanCheckFirstSeenByProfile.delete(p.id);
            discordService.clearHumanCheck(p.id);
          }
          if (state && isJailMapName(state.map)) {
            if (!p.jailAutoStopped) {
              const lastPrisonBeep = prisonAlertedByProfile.get(p.id) || 0;
              if (Date.now() - lastPrisonBeep > 60000) {
                prisonAlertedByProfile.set(p.id, Date.now());
                shouldBeepUrgent = true;
              }
              await recordProfileJailedAndStop(p, state);
            }
          } else if (isConfirmedOutOfJailMap(state)) {
            prisonAlertedByProfile.delete(p.id);
            if (p.isJailed || p.jailAutoStopped) clearProfileJailStatus(p.id, true);
          }
          if (state && state.unexpectedTown && state.unexpectedTown.active) {
            discordService.notifyUnexpectedTown({ profile: p, unexpectedTown: state.unexpectedTown });
          }
        } catch (_) {}
      }));
    }

    if (shouldBeepUrgent) {
      triggerWindowsAlertBeep(true);
    } else if (shouldBeepNormal) {
      triggerWindowsAlertBeep(false);
    }
  } catch (e) {} finally {
    humanCheckMonitorInFlight = false;
  }
}, 2000);

// Cloud Profile & Credential (ID / Password) Backup Sync & Restore
let centralProfileBackupTimer = null;
let centralProfileBackupInFlight = false;

function buildLocalProfileBackupPayload() {
  const profiles = loadProfiles() || [];
  const deviceId = getEffectiveDeviceNickname();
  const cleanProfiles = [];
  const credsMap = {};
  for (const p of profiles) {
    if (!p || !p.id) continue;
    const password = credentials.getPassword(p.id) || "";
    const username = String(p.account || p.username || "").trim();
    const characterName = String((p.liveState && p.liveState.charName) || p.lastCharName || "").trim();
    const copy = { ...p };
    delete copy.liveState;
    delete copy.password;
    if (username) {
      copy.account = username;
      copy.username = username;
    }
    if (characterName) copy.lastCharName = characterName;
    cleanProfiles.push({
      id: p.id,
      name: p.name || p.id,
      characterName,
      username,
      account: username,
      password,
      server: p.server || "aetheria-main",
      profile: copy
    });
    if (username || password) {
      credsMap[p.id] = { username, password, updatedAt: Date.now() };
    }
  }
  return {
    format: "pmhee-aetheria-profile-backup-v1",
    exportedAt: new Date().toISOString(),
    machineId: deviceId,
    machineName: deviceId,
    profiles: cleanProfiles,
    credentials: credsMap
  };
}

function applyProfileBackupPayload(data) {
  if (!data || typeof data !== "object") return { restoredProfiles: 0, restoredCredentials: 0 };
  const rawList = Array.isArray(data.profiles) ? data.profiles : [];
  if (rawList.length === 0) return { restoredProfiles: 0, restoredCredentials: 0 };
  const existing = loadProfiles() || [];
  const existingById = new Map(existing.map(p => [p.id, p]));
  const merged = [];
  const seenIds = new Set();
  let restoredCredentials = 0;
  const credsObj = (data.credentials && typeof data.credentials === "object") ? data.credentials : {};

  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const base = (item.profile && typeof item.profile === "object") ? { ...item.profile } : { ...item };
    const id = String(base.id || item.id || item.profileId || "").trim();
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    const prev = existingById.get(id) || {};
    const username = String(item.username || item.account || base.account || base.username || (credsObj[id] && credsObj[id].username) || prev.account || prev.username || "").trim();
    const password = String(item.password || (credsObj[id] && credsObj[id].password) || "").trim();
    const charName = String(item.characterName || base.lastCharName || prev.lastCharName || "").trim();
    delete base.password;
    delete base.liveState;
    const finalProfile = {
      ...prev,
      ...base,
      id,
      name: String(item.name || base.name || prev.name || id).trim(),
      server: String(item.server || base.server || prev.server || "aetheria-main").trim(),
      ...(username ? { account: username, username } : {}),
      ...(charName ? { lastCharName: charName } : {})
    };
    merged.push(finalProfile);
    if (password) {
      credentials.setPassword(id, password);
      restoredCredentials++;
    }
  }

  for (const [id, cred] of Object.entries(credsObj)) {
    if (cred && cred.password && !rawList.some(x => (x.id || x.profileId) === id)) {
      credentials.setPassword(id, String(cred.password));
      restoredCredentials++;
    }
  }

  // Keep any existing non-mock profiles that were not in the backup
  if (!isUntouchedDefaultMockProfiles(existing)) {
    for (const p of existing) {
      if (p && p.id && !seenIds.has(p.id)) {
        merged.push(p);
      }
    }
  }

  if (merged.length > 0) {
    saveProfiles(merged);
  }
  return { restoredProfiles: merged.length, restoredCredentials };
}

async function syncProfileBackupToCentral() {
  if (TEST_INSTANCE || centralProfileBackupInFlight) return null;
  centralProfileBackupInFlight = true;
  try {
    const accountSettings = humanCheckSolver.loadSettings();
    if (!accountSettings || !accountSettings.accountId) return null;
    const currentProfiles = loadProfiles() || [];
    if (currentProfiles.length === 0 || isUntouchedDefaultMockProfiles(currentProfiles)) return null;
    const payload = buildLocalProfileBackupPayload();
    const res = await humanCheckSolver.serviceRequest('/v1/aetheria/machine/profile-backup', {
      machineId: payload.machineId,
      machineName: payload.machineName,
      profiles: payload.profiles
    });
    return res;
  } catch (_) {
    return null;
  } finally {
    centralProfileBackupInFlight = false;
  }
}

function scheduleCentralProfileBackupSync(delayMs = 3500) {
  if (TEST_INSTANCE) return;
  if (centralProfileBackupTimer) clearTimeout(centralProfileBackupTimer);
  centralProfileBackupTimer = setTimeout(() => {
    centralProfileBackupTimer = null;
    syncProfileBackupToCentral().catch(() => {});
  }, delayMs);
}

async function restoreProfilesFromCentral() {
  try {
    const accountSettings = humanCheckSolver.loadSettings();
    if (!accountSettings || !accountSettings.accountId) return { success: false, error: 'NO_ACCOUNT' };
    const deviceId = getEffectiveDeviceNickname();
    const res = await humanCheckSolver.serviceRequest('/v1/aetheria/machine/profile-restore', {
      machineId: deviceId
    });
    if (res && res.success && Array.isArray(res.profiles) && res.profiles.length > 0) {
      const result = applyProfileBackupPayload(res);
      console.log(`[Central Admin] 🛡️ กู้คืนโปรไฟล์จากเซิร์ฟเวอร์สำเร็จ ${result.restoredProfiles} จอ (รหัสผ่าน ${result.restoredCredentials} จอ)`);
      return { success: true, ...result };
    }
    return { success: false, error: 'NO_CLOUD_BACKUP' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function importEvidenceFromOtherManagerDirsOnDisk() {
  try {
    const home = os.homedir();
    const currentMgrDir = path.resolve(__dirname).toLowerCase();
    const searchRoots = new Set([
      path.resolve(__dirname, ".."),
      path.resolve(__dirname, "../.."),
      path.resolve(__dirname, "../../.."),
      path.join(home, "Desktop"),
      path.join(home, "Downloads"),
      path.join(home, "Documents"),
      path.join(home, "OneDrive", "Desktop"),
      path.join(home, "OneDrive", "Documents"),
      path.join(home, "AppData", "Local", "Temp"),
      "C:\\",
      "D:\\",
      "E:\\",
      "C:\\$Recycle.Bin",
      "D:\\$Recycle.Bin",
      "E:\\$Recycle.Bin"
    ]);
    const candidateMgrDirs = [];
    const seenDirs = new Set();
    const checkDir = (dir, depth = 0, maxDepth = 2) => {
      if (!dir || depth > maxDepth) return;
      let norm;
      try { norm = path.resolve(dir).toLowerCase(); } catch (_) { return; }
      if (seenDirs.has(norm)) return;
      seenDirs.add(norm);
      if (!fs.existsSync(dir)) return;
      try {
        const hasServerJs = fs.existsSync(path.join(dir, "server.js"));
        const hasSubMgr = fs.existsSync(path.join(dir, "manager", "server.js"));
        const hasSessionsOnly = !hasServerJs && !hasSubMgr && (
          fs.existsSync(path.join(dir, "sessions", "_browser", "Default", "Local Storage", "leveldb")) ||
          fs.existsSync(path.join(dir, "sessions", "_browser_storage"))
        );
        if ((hasServerJs || hasSessionsOnly) && norm !== currentMgrDir) {
          candidateMgrDirs.push(dir);
        }
        if (hasSubMgr && path.resolve(dir, "manager").toLowerCase() !== currentMgrDir) {
          candidateMgrDirs.push(path.join(dir, "manager"));
        }
        if (depth < maxDepth) {
          const isRecycle = norm.includes("$recycle.bin");
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            if (!e.isDirectory()) continue;
            if (/^(windows|program files|program files \(x86\)|programdata|system volume information|node_modules|\.git|appdata)$/i.test(e.name)) continue;
            if (!isRecycle && /^\$recycle\.bin$/i.test(e.name)) continue;
            if (isRecycle || depth === 0 || /pelican|pmhee|aetheria|bot|manager|release|rar\$|7z|\$r/i.test(e.name)) {
              checkDir(path.join(dir, e.name), depth + 1, maxDepth);
            }
          }
        }
      } catch (_) {}
    };
    for (const r of searchRoots) {
      const isRec = String(r).toLowerCase().includes("$recycle.bin");
      checkDir(r, 0, isRec ? 3 : 2);
    }

    for (const mgrDir of candidateMgrDirs) {
      try {
        const otherRoot = path.resolve(mgrDir, "..");
        // 1. Copy credentials.json entries if missing locally
        for (const credPath of [path.join(mgrDir, "data", "credentials.json"), path.join(otherRoot, "manager", "data", "credentials.json")]) {
          if (!fs.existsSync(credPath)) continue;
          try {
            const raw = JSON.parse(fs.readFileSync(credPath, "utf8"));
            if (raw && typeof raw === "object") {
              for (const [pid, val] of Object.entries(raw)) {
                if (!pid.startsWith("profile_") || credentials.getPassword(pid)) continue;
                const pw = typeof val === "string" ? val : (val && val.password ? String(val.password) : "");
                if (pw) credentials.setPassword(pid, pw);
              }
            }
          } catch (_) {}
        }
        // 2. Merge _browser_storage/*.json and extract LevelDB directly
        for (const sessBase of [path.join(otherRoot, "sessions"), path.join(mgrDir, "sessions")]) {
          const otherBs = path.join(sessBase, "_browser_storage");
          if (fs.existsSync(otherBs)) {
            for (const f of fs.readdirSync(otherBs)) {
              if (!f.endsWith(".json")) continue;
              const pid = f.slice(0, -5);
              if (!pid.startsWith("profile_")) continue;
              try {
                const srcData = JSON.parse(fs.readFileSync(path.join(otherBs, f), "utf8"));
                writeOrMergeProfileStorageFile(pid, srcData);
              } catch (_) {}
            }
          }
          // 3. Extract _browser/Default/Local Storage/leveldb directly and merge into local _browser_storage
          const otherLdb = path.join(sessBase, "_browser", "Default", "Local Storage", "leveldb");
          const localLdb = path.join(SESSIONS_DIR, "_browser", "Default", "Local Storage", "leveldb");
          if (fs.existsSync(otherLdb)) {
            try {
              const diskHarvest = extractPelicanStorageFromLevelDb(otherLdb);
              if (diskHarvest && diskHarvest.byProfile) {
                for (const [pid, entries] of Object.entries(diskHarvest.byProfile)) {
                  writeOrMergeProfileStorageFile(pid, entries);
                }
              }
            } catch (_) {}
            const sumBytes = d => {
              if (!fs.existsSync(d)) return 0;
              try {
                return fs.readdirSync(d).reduce((s, f) => {
                  try { return s + fs.statSync(path.join(d, f)).size; } catch (_) { return s; }
                }, 0);
              } catch (_) { return 0; }
            };
            if (sumBytes(otherLdb) > sumBytes(localLdb)) {
              fs.mkdirSync(localLdb, { recursive: true });
              for (const f of fs.readdirSync(otherLdb)) {
                if (f === "LOCK") continue;
                try { fs.copyFileSync(path.join(otherLdb, f), path.join(localLdb, f)); } catch (_) {}
              }
            }
          }
          // 3b. Extract Electron sessions/profile_*/Local Storage/leveldb directly
          if (fs.existsSync(sessBase)) {
            for (const entry of fs.readdirSync(sessBase, { withFileTypes: true })) {
              if (!entry.isDirectory() || !entry.name.startsWith("profile_")) continue;
              const pid = entry.name;
              const srcP = path.join(sessBase, pid, "Local Storage", "leveldb");
              const dstP = path.join(SESSIONS_DIR, pid, "Local Storage", "leveldb");
              if (fs.existsSync(srcP)) {
                try {
                  const diskHarvest = extractPelicanStorageFromLevelDb(srcP, pid);
                  if (diskHarvest && diskHarvest.byProfile && diskHarvest.byProfile[pid]) {
                    writeOrMergeProfileStorageFile(pid, diskHarvest.byProfile[pid]);
                  }
                } catch (_) {}
                if (!fs.existsSync(dstP)) {
                  fs.mkdirSync(dstP, { recursive: true });
                  for (const f of fs.readdirSync(srcP)) {
                    if (f === "LOCK") continue;
                    try { fs.copyFileSync(path.join(srcP, f), path.join(dstP, f)); } catch (_) {}
                  }
                }
              }
            }
          }
        }
        // 4. Check profiles.backup.json or profiles.json in other folder
        for (const pf of [path.join(mgrDir, "data", "profiles.backup.json"), path.join(mgrDir, "profiles.json")]) {
          if (!fs.existsSync(pf)) continue;
          try {
            const arr = JSON.parse(fs.readFileSync(pf, "utf8"));
            if (Array.isArray(arr) && arr.length > 0 && !isUntouchedDefaultMockProfiles(arr)) {
              const cur = loadProfiles() || [];
              if (isUntouchedDefaultMockProfiles(cur)) {
                saveProfiles(arr);
              } else {
                let enriched = false;
                const byId = new Map(arr.filter(x => x && x.id).map(x => [String(x.id), x]));
                for (const p of cur) {
                  const donor = p && p.id ? byId.get(String(p.id)) : null;
                  if (!donor) continue;
                  if (!p.account && donor.account) {
                    p.account = String(donor.account).trim();
                    p.loginSyncPending = true;
                    enriched = true;
                  }
                  if (!p.lastCharName && donor.lastCharName) {
                    p.lastCharName = String(donor.lastCharName).trim();
                    enriched = true;
                  }
                }
                if (enriched) saveProfiles(cur);
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
    }
  } catch (_) {}
}

function hasProfilesMissingCredentialsOrAccount(list) {
  return Array.isArray(list) && list.some(p => p && p.id && (!p.account || !credentials.getPassword(p.id)));
}

async function recoverAndEnrichProfilesFromBrowserAndLocal() {
  try {
    let current = loadProfiles() || [];
    if (isUntouchedDefaultMockProfiles(current) || hasProfilesMissingCredentialsOrAccount(current)) {
      importEvidenceFromOtherManagerDirsOnDisk();
      current = loadProfiles() || [];
    }
    const harvestedAuthHistory = {};
    const mergeHistoryList = (pid, list) => {
      if (!pid || !Array.isArray(list) || list.length === 0) return;
      if (!harvestedAuthHistory[pid]) harvestedAuthHistory[pid] = [];
      for (const item of list) {
        if (!item || (!item.username && !item.password)) continue;
        const sig = (item.username || "") + ":" + (item.password || "");
        if (!harvestedAuthHistory[pid].some(x => ((x.username || "") + ":" + (x.password || "")) === sig)) {
          harvestedAuthHistory[pid].push(item);
        }
      }
    };
    try {
      const browserLdbDir = path.join(SESSIONS_DIR, "_browser", "Default", "Local Storage", "leveldb");
      if (fs.existsSync(browserLdbDir)) {
        const diskHarvest = extractPelicanStorageFromLevelDb(browserLdbDir);
        if (diskHarvest && diskHarvest.byProfile) {
          for (const [pid, entries] of Object.entries(diskHarvest.byProfile)) {
            writeOrMergeProfileStorageFile(pid, entries);
          }
        }
        if (diskHarvest && diskHarvest.authHistoryByProfile) {
          for (const [pid, list] of Object.entries(diskHarvest.authHistoryByProfile)) {
            mergeHistoryList(pid, list);
          }
        }
      }
      if (fs.existsSync(SESSIONS_DIR)) {
        for (const entry of fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
          if (!entry.isDirectory() || !entry.name.startsWith("profile_")) continue;
          const pid = entry.name;
          const ldbDir = path.join(SESSIONS_DIR, pid, "Local Storage", "leveldb");
          if (fs.existsSync(ldbDir)) {
            const diskHarvest = extractPelicanStorageFromLevelDb(ldbDir, pid);
            if (diskHarvest && diskHarvest.byProfile && diskHarvest.byProfile[pid]) {
              writeOrMergeProfileStorageFile(pid, diskHarvest.byProfile[pid]);
            }
            if (diskHarvest && diskHarvest.authHistoryByProfile && diskHarvest.authHistoryByProfile[pid]) {
              mergeHistoryList(pid, diskHarvest.authHistoryByProfile[pid]);
            }
          }
        }
      }
    } catch (_) {}
    if (typeof browserMode?.harvestAllFromBrowserLevelDb === "function") {
      await browserMode.harvestAllFromBrowserLevelDb().catch(() => {});
    }
    if (isUntouchedDefaultMockProfiles(current)) {
      const localRec = recoverProfilesFromLocalEvidence();
      if (localRec && localRec.length > 0) {
        saveProfiles(localRec);
        current = localRec;
      } else {
        await restoreProfilesFromCentral().catch(() => {});
        current = loadProfiles() || [];
      }
    }
    if (!isUntouchedDefaultMockProfiles(current)) {
      const bsDir = path.join(SESSIONS_DIR, "_browser_storage");
      let changed = false;
      let authChanged = false;
      for (const p of current) {
        if (!p || !p.id) continue;
        const f = path.join(bsDir, `${p.id}.json`);
        if (!fs.existsSync(f)) continue;
        try {
          const d = JSON.parse(fs.readFileSync(f, "utf8"));
          const pfx = `pelican_${p.id}__`;
          const rawAuth = d[`${pfx}auth_cfg`] || d["pelican_auth_cfg"];
          if (harvestedAuthHistory[p.id] && harvestedAuthHistory[p.id].length > 0) {
            const prevJson = JSON.stringify(p.authHistory || []);
            const nextJson = JSON.stringify(harvestedAuthHistory[p.id]);
            if (prevJson !== nextJson) {
              p.authHistory = harvestedAuthHistory[p.id];
              changed = true;
            }
          }
          if (rawAuth) {
            const auth = JSON.parse(rawAuth);
            if (auth && typeof auth === "object") {
              const verified = isVerifiedAuthConfig(auth);
              const clientEditStamp = Math.max(Number(auth.userEditedAt) || 0, Number(auth.verifiedLoginAt) || 0);
              const managerPushStamp = Number(auth.lastManagerPushAt) || 0;
              const isNewerUserCred = verified && !auth.generatedUser && clientEditStamp > 0 && clientEditStamp > managerPushStamp;
              if (verified && auth.username && String(auth.username).trim() && (!p.account || isNewerUserCred)) {
                const nextU = String(auth.username).trim();
                if (p.account !== nextU) {
                  p.account = nextU;
                  p.autoRegister = false;
                  p.generatedAccount = Boolean(auth.generatedUser);
                  p.loginSyncPending = true;
                  changed = true;
                  authChanged = true;
                }
              }
              if (auth.charName && String(auth.charName).trim() && !p.lastCharName) {
                p.lastCharName = String(auth.charName).trim();
                if (/^Client \d+$/.test(p.name || "")) p.name = p.lastCharName;
                changed = true;
              }
              if (verified && auth.password && String(auth.password).trim() && (!credentials.getPassword(p.id) || isNewerUserCred)) {
                const nextPw = String(auth.password).trim();
                if (credentials.getPassword(p.id) !== nextPw) {
                  credentials.setPassword(p.id, nextPw);
                  p.loginSyncPending = true;
                  changed = true;
                  authChanged = true;
                }
              }
            }
          }
          const farmMap = d[`${pfx}farm_map`] || d[`${pfx}target_map`] || d[`${pfx}last_farm_map`];
          if (farmMap && typeof farmMap === "string" && farmMap.trim() && (!p.targetMap || p.targetMap === "ถนนต้นหลิว")) {
            p.targetMap = farmMap.trim();
            changed = true;
          }
        } catch (_) {}
      }
      if (changed) {
        saveProfiles(current);
      }
      if (authChanged && typeof authSync?.tick === "function") {
        authSync.tick().catch(() => {});
      }
      await syncProfileBackupToCentral().catch(() => {});
    }
  } catch (_) {}
}

if (!TEST_INSTANCE) {
  setTimeout(() => {
    recoverAndEnrichProfilesFromBrowserAndLocal().catch(() => {});
  }, 5000);
  setInterval(async () => {
    const cur = loadProfiles() || [];
    if (isUntouchedDefaultMockProfiles(cur) || hasProfilesMissingCredentialsOrAccount(cur)) {
      await recoverAndEnrichProfilesFromBrowserAndLocal().catch(() => {});
    } else {
      await syncProfileBackupToCentral().catch(() => {});
    }
  }, 120000);
}

// Poll remote commands from Central Admin Dashboard (https://api.noggunsshop.xyz)
let centralCommandPollInFlight = false;
async function pollCentralCommands() {
  if (centralCommandPollInFlight) return;
  centralCommandPollInFlight = true;
  try {
    const accountSettings = humanCheckSolver.loadSettings();
    if (!accountSettings || !accountSettings.accountId) return;
    const deviceId = getEffectiveDeviceNickname();
    const res = await humanCheckSolver.serviceRequest('/v1/aetheria/machine/commands', {
      machineId: deviceId
    });
    if (res && res.success && Array.isArray(res.commands) && res.commands.length > 0) {
      const ackIds = [];
      for (const cmd of res.commands) {
        console.log(`[Central Admin] Received remote command: ${cmd.action} target: ${cmd.target}`);
        if (cmd.action === 'stop') {
          if (cmd.target === 'all') {
            await stopAllProfiles();
          } else {
            await stopSingleProfile(cmd.target);
          }
        } else if (cmd.action === 'update_bot' || cmd.action === 'refresh_payload') {
          botAutoUpdater.retryFailed().catch(() => {});
        } else if (cmd.action === 'restore_profiles') {
          await restoreProfilesFromCentral().catch(() => {});
          await recoverAndEnrichProfilesFromBrowserAndLocal().catch(() => {});
        }
        ackIds.push(cmd.id);
      }
      if (ackIds.length > 0) {
        await humanCheckSolver.serviceRequest('/v1/aetheria/machine/commands/ack', {
          commandIds: ackIds,
          machineId: deviceId
        }).catch(() => {});
      }
    }
  } catch (_) {} finally {
    centralCommandPollInFlight = false;
  }
}
setInterval(pollCentralCommands, 3000);

const server = http.createServer(async (req, res) => {
  req.setEncoding('utf8');   // request bodies are built with += (Thai split across chunks -> U+FFFD)
  if (!allowLocalRequest(req, PORT)) {
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ success: false, error: "Forbidden request origin or host" }));
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  // JSON helper
  const sendJSON = (data, code = 200) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  };

  if (TEST_INSTANCE && pathname === '/api/test/outbound-blocked' && req.method === 'GET') {
    return sendJSON({ success: true, blocked: testIsolation.blocked() });
  }
  if (TEST_INSTANCE && pathname === '/api/test/outbound-probe' && req.method === 'POST') {
    // Proves the guard: each non-fixture destination must fail with TEST_OUTBOUND_BLOCKED before any socket opens.
    const attempt = (fn) => new Promise(resolve => { try { fn(resolve); } catch (e) { resolve('THROW ' + (e.code || e.message)); } });
    const viaHttp = (mod, url) => attempt(done => { const r = mod.get(url, { timeout: 3000 }, res => { res.resume(); done('STATUS ' + res.statusCode); }); r.on('error', e => done(e.code || e.message)); r.on('timeout', () => r.destroy(new Error('TIMEOUT'))); });
    const results = {
      githubHttps: await viaHttp(https, 'https://api.github.com/'),
      ownerApiHttps: await viaHttp(https, 'https://api.noggunsshop.xyz/v1/aetheria/health'),
      realGamePort: await viaHttp(http, 'http://127.0.0.1:49876/api/state'),
      fetchExternal: await fetch('https://example.com/').then(r => 'STATUS ' + r.status, e => e.code || e.message),
      fixture: await viaHttp(http, `http://127.0.0.1:${testFixturePort}/api/state`)
    };
    return sendJSON({ success: true, results, blocked: testIsolation.blocked() });
  }

  if (pathname.startsWith('/api/human-check/') && req.method === 'POST') {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      return sendJSON({ success: false, error: 'JSON body required' }, 415);
    }
    if (Number(req.headers['content-length']) > 16384) {
      return sendJSON({ success: false, error: 'Body too large' }, 413);
    }
  }

  // ==========================================
  // API ROUTING
  // ==========================================
  if (pathname === '/api/script/status' && req.method === 'GET') return sendJSON(scriptCoordinator.status());
  if(pathname==='/api/script/pilot' && req.method==='GET')return sendJSON({success:true,profiles:loadProfiles().map(p=>({id:p.id,name:p.name})),...scriptCoordinator.status()});
  if(pathname==='/api/script/pilot' && req.method==='POST') {
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return sendJSON({success:false,error:'JSON body required'},415);
    try {
      let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>16384)return sendJSON({success:false,error:'Body too large'},413);}
      const input=JSON.parse(text);
      if(Object.keys(input).some(k=>!['mode','pilotProfileIds','acknowledgePilot'].includes(k)))throw Error('INVALID_ROLLOUT_SELECTION');
      const saved=saveScriptRolloutSelection({dataDir:path.join(__dirname,'data'),serviceOrigin:humanCheckSolver.serviceOrigin,profiles:loadProfiles(),...input});
      // The coordinator picks this up at its next idle cycle; never replace its instance or queues.
      scriptCoordinator.cycle().catch(()=>{});
      return sendJSON({success:true,configurationCode:saved.configurationCode,pendingApply:true,message:'บันทึกแล้ว รอรอบตรวจสิทธิ์ที่ปลอดภัย จอเดิมยังไม่ถูกรีเฟรชหรือฉีดบอททับ'});
    }catch(error){return sendJSON({success:false,error:error.message},409);}
  }
  if (pathname === '/api/script/statement' && req.method === 'GET') {
    if(scriptCoordinator.statement)return sendJSON(scriptCoordinator.statement());
    try { return sendJSON(await humanCheckSolver.serviceRequest('/v1/aetheria/usage/statement')); }
    catch (_) { return sendJSON({ success: false, code: 'STATEMENT_UNAVAILABLE', message: 'ยังอ่านใบสรุปจากเซิร์ฟเวอร์ไม่ได้ โหมดสังเกตการณ์ไม่มีการเรียกเก็บเงิน' }, 503); }
  }
  if (pathname === '/api/script/terms' && req.method === 'POST') {
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 1024) return sendJSON({success:false,error:'Body too large'},413); }
      const input = JSON.parse(body);
      const statement = await humanCheckSolver.serviceRequest('/v1/aetheria/usage/statement');
      if (!statement.activationDay || input.termsVersion !== statement.termsVersion) return sendJSON({success:false,error:'ยังไม่ประกาศวันเริ่ม หรือเงื่อนไขเปลี่ยนแล้ว กรุณาอ่านใบสรุปใหม่'},409);
      return sendJSON(await humanCheckSolver.serviceRequest('/v1/aetheria/billing/accept', {termsVersion:input.termsVersion}));
    } catch (_) { return sendJSON({success:false,error:'ยังบันทึกความยินยอมบนเซิร์ฟเวอร์ไม่ได้'},503); }
  }

  // Plan Script live status / on-off switch per client — see plan_sync.js
  if (await planSync.handleRoute(req, res, pathname, sendJSON)) return;

  // Copy bot settings to other clients (no ID/password/character) — see config_copy_api.js
  if (await handleConfigCopyRoute(req, res, pathname, { loadProfiles, saveProfiles, evalProfilePort, sendJSON })) return;

  // Manager self-update (manager/ folder) — see manager_self_update.js
  if (await managerUpdater.handleRoute(req, res, pathname, sendJSON)) return;

  // Auto-reload game clients when bot.js changes on GitHub — see bot_auto_update.js
  if (await botAutoUpdater.handleRoute(req, res, pathname, sendJSON)) return;

  // Bag (inventory) & market endpoints — see inventory_market_api.js
  if (await handleInventoryMarketRoute(req, res, pathname, { loadProfiles, evalProfilePort, sendJSON })) return;

  // Party system — see party_api.js
  if (await partyService.handleRoute(req, res, pathname, sendJSON)) return;
  // Auto Premium — see premium_api.js
  if (await premiumService.handleRoute(req, res, pathname, sendJSON)) return;
  // Guild Manager & Auto Daily Donation — see guild_api.js
  if (await guildService.handleRoute(req, res, pathname, sendJSON)) return;

  // Discord Bot & Webhook Settings & Controls
  if (pathname === "/api/discord/settings") {
    if (req.method === "GET") {
      return sendJSON({ success: true, settings: discordService.loadSettings() });
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        try {
          const data = JSON.parse(body || "{}");
          const ok = discordService.saveSettings(data);
          sendJSON({ success: ok, settings: discordService.loadSettings() });
        } catch (e) {
          sendJSON({ success: false, error: e.message }, 400);
        }
      });
      return;
    }
  }

  if (pathname === "/api/discord/test" && req.method === "POST") {
    const testResult = await discordService.testNotification();
    return sendJSON(testResult || { success: true });
  }

  if (pathname === "/api/discord/test-town" && req.method === "POST") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        const testResult = await discordService.testTownNotification(data.webhookUrl);
        sendJSON(testResult || { success: true });
      } catch (e) {
        sendJSON({ success: false, error: e.message }, 400);
      }
    });
    return;
  }

  if (pathname === "/api/discord/test-topup" && req.method === "POST") {
    let body = "";
    req.on("data", c => {
      body += c;
      if (Buffer.byteLength(body, "utf8") > 16384) req.destroy();
    });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        const testResult = await discordService.testTopupNotification(data.webhookUrl, data);
        sendJSON(testResult || { success: true });
      } catch (e) {
        sendJSON({ success: false, error: e.message }, 400);
      }
    });
    return;
  }

  // GET /api/captcha-stats
  if (req.method === "GET" && pathname === "/api/captcha-stats") {
    const stats = getCaptchaStats();
    const profiles = loadProfiles() || [];
    const profileMap = {};
    for (const p of profiles) {
      if (p && p.id) {
        profileMap[p.id] = {
          id: p.id,
          name: p.name || p.id,
          characterName: p.characterName || ""
        };
      }
    }
    const todayKey = getThaiDateKey();
    const todayTotal = (stats.daily && stats.daily[todayKey]) ? (stats.daily[todayKey].total || 0) : 0;
    return sendJSON({
      success: true,
      totalSolved: stats.totalSolved || 0,
      todaySolved: todayTotal,
      todayDate: todayKey,
      lastSolvedAt: stats.lastSolvedAt,
      daily: stats.daily || {},
      profiles: profileMap
    });
  }

  // Answer human check from Manager UI or remote link
  if (pathname === "/api/human-check/answer" && req.method === "POST") {
    let body = "";
    req.on("data", c => {
        body += c;
        if (Buffer.byteLength(body, "utf8") > 16384) req.destroy();
      });
    req.on("end", async () => {
      try {
        const { profileId, pick } = JSON.parse(body || "{}");
        const res = await discordService.answerCheckInGame(profileId, pick);
        sendJSON(res);
      } catch (e) {
        sendJSON({ success: false, error: e.message }, 400);
      }
    });
    return;
  }

  // Human Check Auto-Answer & Point System Endpoints
  if (pathname === "/api/human-check/settings") {
    if (req.method === "GET") {
      const s = await humanCheckSolver.refreshBalance();
      return sendJSON({ success: true, settings: humanCheckSolver.publicSettings(s), isDev: false });
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", c => {
        body += c;
        if (Buffer.byteLength(body, "utf8") > 16384) req.destroy();
      });
      req.on("end", async () => {
        try {
          const data = JSON.parse(body || "{}");
          const creditOverride = ['points', 'balance', 'pointsPerBaht', 'sig', 'claimedVouchers'].some(key => Object.prototype.hasOwnProperty.call(data, key)) || data.pointSystemEnabled === false;
          if (creditOverride) humanCheckSolver.reportSecurityEvent('local_credit_override', { profileId: data.profileId }).catch(() => {});
          const updated = humanCheckSolver.saveSettings(data);
          // Sync to Discord settings as well if autoAnswer changed
          if (data.autoAnswer !== undefined || data.answerDelayMs !== undefined) {
            const dCfg = discordService.loadSettings();
            discordService.saveSettings({
              ...dCfg,
              autoAnswer: updated.autoAnswer,
              answerDelayMs: updated.answerDelayMs
            });
          }
          // Sync autoHumanCheckEnabled into all running game clients
          const profiles = loadProfiles();
          for (const p of profiles) {
            if (p.debugPort) {
              evalProfilePort(p.debugPort, `(() => {
                window.__autoHumanCheckEnabled = ${updated.autoAnswer};
                try { localStorage.setItem('pelican_auto_human_check', '${updated.autoAnswer}'); } catch(e){}
              })()`).catch(() => {});
            }
          }
          const publicUpdated = humanCheckSolver.publicSettings(updated);
          sendJSON({ success: true, settings: publicUpdated });
        } catch (e) {
          sendJSON({ success: false, error: e.message }, 400);
        }
      });
      return;
    }
  }

  // Quick toggle for Auto-Answer (from Manager toolbar or UI button)
  if (pathname === "/api/human-check/toggle" && req.method === "POST") {
    try {
      const current = humanCheckSolver.loadSettings();
      const newAutoAnswer = !current.autoAnswer;
      const updated = humanCheckSolver.saveSettings({ ...current, autoAnswer: newAutoAnswer });
      // Keep discord settings in sync
      const dCfg = discordService.loadSettings();
      discordService.saveSettings({ ...dCfg, autoAnswer: newAutoAnswer });
      // Sync into all running clients
      const profiles = loadProfiles();
      for (const p of profiles) {
        if (p.debugPort) {
          evalProfilePort(p.debugPort, `(() => {
            window.__autoHumanCheckEnabled = ${newAutoAnswer};
            try { localStorage.setItem('pelican_auto_human_check', '${newAutoAnswer}'); } catch(e){}
          })()`).catch(() => {});
        }
      }
      return sendJSON({ success: true, autoAnswer: newAutoAnswer, settings: humanCheckSolver.publicSettings(updated) });
    } catch (e) {
      return sendJSON({ success: false, error: e.message }, 500);
    }
  }

  // POST /api/human-check/simulate-board
  if (pathname === "/api/human-check/simulate-board" && req.method === "POST") {
    let body = "";
    req.on("data", c => {
      body += c;
      if (Buffer.byteLength(body, "utf8") > 65536) req.destroy();
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        let catalogSeed = null;
        try {
          catalogSeed = JSON.parse(fs.readFileSync(path.join(__dirname, "human_check_catalog_seed.json"), "utf8"));
        } catch (_) {}
        const prompt = payload.prompt || "เลือก Red Potion";
        const resolved = imageBoardSolver.resolveTargetItem(prompt, catalogSeed);
        return sendJSON({
          success: true,
          prompt,
          resolvedTarget: resolved,
          solverReady: true,
          boardWidth: 480,
          boardHeight: 330
        });
      } catch (e) {
        return sendJSON({ success: false, error: e.message }, 500);
      }
    });
    return;
  }

  // Retired compatibility endpoint: never grants credits.
  if (pathname === "/api/human-check/add-points" && req.method === "POST") {
    humanCheckSolver.reportSecurityEvent("local_credit_override").catch(() => {});
    return sendJSON({ success: false, error: "ปิดการเติม Point ทดสอบ กรุณาเติมผ่านซองของขวัญ" }, 403);
  }

  // TrueMoney Gift Voucher Top-up (ซองของขวัญ / อั่งเปา TrueMoney Wallet)
  if (pathname === "/api/human-check/topup-voucher" && req.method === "POST") {
    let body = "";
    req.on("data", c => {
        body += c;
        if (Buffer.byteLength(body, "utf8") > 16384) req.destroy();
      });
    req.on("end", async () => {
      try {
        const { voucherUrl } = JSON.parse(body || "{}");
        const beforeSettings = humanCheckSolver.loadSettings();
        const result = await humanCheckSolver.redeemTrueMoneyVoucher(voucherUrl);
        if (result && result.success && discordService && typeof discordService.notifyMeritTopup === "function") {
          const afterSettings = humanCheckSolver.loadSettings();
          const pointsAdded = Number(result.pointsAdded ?? result.amount ?? 0);
          const amountBaht = Number(result.amount ?? pointsAdded ?? 0);
          const netPoints = Number.isFinite(Number(afterSettings?.points))
            ? Number(afterSettings.points)
            : (Number.isFinite(Number(result.totalPoints))
                ? Number(result.totalPoints)
                : (Number.isSafeInteger(result.balanceUnits) ? result.balanceUnits / 100 : pointsAdded));
          const previousPoints = Number((netPoints - pointsAdded).toFixed(2));
          discordService.notifyMeritTopup({
            amount: amountBaht,
            pointsAdded,
            previousPoints,
            totalPoints: netPoints,
            balanceUnits: afterSettings?.balanceUnits ?? result.balanceUnits,
            accountId: afterSettings?.accountId || beforeSettings?.accountId || "",
            machineHwid: afterSettings?.machineHwid || beforeSettings?.machineHwid || ""
          }).catch(err => {
            console.warn("[Discord] Merit top-up notification failed:", err?.message || err);
          });
        }
        sendJSON(result, result.success ? 200 : 400);
      } catch (e) {
        sendJSON({ success: false, message: "เกิดข้อผิดพลาดในการประมวลผล: " + e.message }, 500);
      }
    });
    return;
  }

  // Proxy Registration Endpoints (0.1 pt / registered account, Cloudflare IP slot coordination)
  if (pathname === "/api/proxy-register/settings") {
    if (req.method === "GET") {
      return sendJSON({ success: true, settings: proxyRegister.publicSettings() });
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", c => {
        body += c;
        if (Buffer.byteLength(body, "utf8") > 16384) req.destroy();
      });
      req.on("end", () => {
        try {
          const data = JSON.parse(body || "{}");
          const updated = proxyRegister.saveSettings(data);
          if (updated.enabled) {
            authSync.resetProxyFallback?.();
            setImmediate(() => authSync.tick().catch(() => {}));
          }
          sendJSON({ success: true, settings: proxyRegister.publicSettings() });
        } catch (e) {
          sendJSON({ success: false, error: e.message }, 400);
        }
      });
      return;
    }
  }

  if (pathname === "/api/proxy-register/toggle" && req.method === "POST") {
    let body = "";
    req.on("data", c => {
      body += c;
      if (Buffer.byteLength(body, "utf8") > 4096) req.destroy();
    });
    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}");
        const current = proxyRegister.loadSettings();
        const nextState = typeof data.enabled === "boolean" ? data.enabled : !current.enabled;
        const patch = { enabled: nextState };
        if (nextState && !current.configured && current.mode !== "owner-broker") {
          patch.mode = "owner-broker";
        }
        const updated = proxyRegister.saveSettings(patch);
        if (updated.enabled) {
          authSync.resetProxyFallback?.();
          setImmediate(() => authSync.tick().catch(() => {}));
        }
        sendJSON({ success: true, enabled: updated.enabled, settings: proxyRegister.publicSettings() });
      } catch (e) {
        sendJSON({ success: false, error: e.message }, 400);
      }
    });
    return;
  }

  if (pathname === "/api/proxy-register/test" && req.method === "POST") {
    try {
      const result = await proxyRegister.testConnection();
      return sendJSON(result, result.success ? 200 : 502);
    } catch (e) {
      return sendJSON({ success: false, error: e.message }, 500);
    }
  }

  // ==========================================
  // PER-SCREEN IP QUEUE (1 IP : 3 SCREENS) API
  // ==========================================
  if (pathname === "/api/screen-proxy/status" && req.method === "GET") {
    try {
      const refresh = parsedUrl.searchParams.get("refresh") === "1";
      const st = await screenProxy.getQueueStatus({ refreshBackend: refresh });
      return sendJSON(st);
    } catch (e) {
      return sendJSON({ success: false, error: e.message }, 500);
    }
  }

  if (pathname === "/api/screen-proxy/settings") {
    if (req.method === "GET") {
      try {
        const st = await screenProxy.getQueueStatus({ refreshBackend: false });
        return sendJSON(st);
      } catch (e) {
        return sendJSON({ success: false, error: e.message }, 500);
      }
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", c => {
        body += c;
        if (Buffer.byteLength(body, "utf8") > 262144) req.destroy();
      });
      req.on("end", async () => {
        try {
          const data = JSON.parse(body || "{}");
          const saved = await screenProxy.savePoolAndSettings(data);
          if (saved.settings && saved.settings.enabled) {
            await syncScreenProxyForOpenProfiles().catch(() => {});
          } else if (saved.settings && !saved.settings.enabled) {
            await screenProxy.releaseAll().catch(() => {});
          }
          if (isBrowserMode() && typeof browserMode.syncAssetCacheToOpenWindows === "function") {
            await browserMode.syncAssetCacheToOpenWindows().catch(() => {});
          }
          const status = await screenProxy.getQueueStatus({ refreshBackend: true });
          sendJSON({ ...status, backendSync: saved.backendSync || null });
        } catch (e) {
          sendJSON({ success: false, error: e.message }, 400);
        }
      });
      return;
    }
  }

  if (pathname === "/api/screen-proxy/toggle" && req.method === "POST") {
    let body = "";
    req.on("data", c => {
      body += c;
      if (Buffer.byteLength(body, "utf8") > 8192) req.destroy();
    });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        const current = screenProxy.loadSettings();
        const nextState = typeof data.enabled === "boolean" ? data.enabled : !current.enabled;
        const updated = screenProxy.saveSettings({ enabled: nextState });
        let openApplied = null;
        if (updated.enabled) {
          await syncScreenProxyForOpenProfiles().catch(() => {});
          if ((data.applyToOpen || data.applyToOpenWindows) && isBrowserMode()) {
            openApplied = await browserMode.applyProxyModeToOpenWindows().catch(err => ({ error: err.message }));
          }
        } else {
          await screenProxy.releaseAll().catch(() => {});
        }
        if (isBrowserMode() && typeof browserMode.syncAssetCacheToOpenWindows === "function") {
          await browserMode.syncAssetCacheToOpenWindows().catch(() => {});
        }
        const status = await screenProxy.getQueueStatus({ refreshBackend: false });
        sendJSON({
          ...status,
          success: true,
          enabled: updated.enabled,
          openApplied
        });
      } catch (e) {
        sendJSON({ success: false, error: e.message }, 400);
      }
    });
    return;
  }

  if (pathname === "/api/screen-proxy/apply-open" && req.method === "POST") {
    let body = "";
    req.on("data", c => {
      body += c;
      if (Buffer.byteLength(body, "utf8") > 16384) req.destroy();
    });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        if (!screenProxy.isEnabled()) {
          screenProxy.saveSettings({ enabled: true });
        }
        const applied = isBrowserMode()
          ? await browserMode.applyProxyModeToOpenWindows({ onlyProfileIds: data.profileIds })
          : { switched: 0, updatedTunnels: (await syncScreenProxyForOpenProfiles()).length };
        if (isBrowserMode() && typeof browserMode.syncAssetCacheToOpenWindows === "function") {
          await browserMode.syncAssetCacheToOpenWindows().catch(() => {});
        }
        const status = await screenProxy.getQueueStatus({ refreshBackend: false });
        sendJSON({
          ...status,
          success: true,
          applied
        });
      } catch (e) {
        sendJSON({ success: false, error: e.message }, 500);
      }
    });
    return;
  }

  if (pathname === "/api/screen-proxy/reset-traffic" && req.method === "POST") {
    try {
      screenProxy.resetTrafficStats();
      resetBandwidthTracker("all");
      if (isBrowserMode() && typeof browserMode.syncAssetCacheToOpenWindows === "function") {
        await browserMode.syncAssetCacheToOpenWindows().catch(() => {});
      }
      const status = await screenProxy.getQueueStatus({ refreshBackend: false });
      return sendJSON({ ...status, success: true });
    } catch (e) {
      return sendJSON({ success: false, error: e.message }, 500);
    }
  }

  if (pathname === "/api/screen-proxy/test" && req.method === "POST") {
    let body = "";
    req.on("data", c => {
      body += c;
      if (Buffer.byteLength(body, "utf8") > 8192) req.destroy();
    });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        const result = await screenProxy.testProxy({
          proxyLine: data.proxyLine || "",
          profileId: data.profileId || ""
        });
        sendJSON(result, result.success ? 200 : 502);
      } catch (e) {
        sendJSON({ success: false, error: e.message }, 500);
      }
    });
    return;
  }

  // 1. GET /api/profiles
  if (req.method === "GET" && pathname === "/api/profiles") {
    lastProfilesZenyPollAt = Date.now();
    const profiles = loadProfiles();
    const enriched = await Promise.all(
      profiles.map(async (p) => {
        const proc = runningProcesses[p.id];
        let alive = proc && isProcessAlive(proc.pid);
        let liveState = null;

        // Auto-detect online state if debugPort is responding
        if (p.debugPort) {
          liveState = await queryClientState(p.debugPort);
          if (liveState && !liveState.error) {
            alive = true;
          }
        }

        if (alive && liveState && !liveState.error && liveState.map) {
          if (isJailMapName(liveState.map)) {
            if (!p.jailAutoStopped) {
              recordProfileJailedAndStop(p, liveState).catch(() => {});
              p.isJailed = true;
              p.jailAutoStopped = true;
              p.jailedAt = p.jailedAt || Date.now();
              p.jailedMap = liveState.map;
              alive = false;
            } else {
              p.jailedMap = liveState.map;
            }
          } else if (isConfirmedOutOfJailMap(liveState) && (p.isJailed || p.jailAutoStopped)) {
            clearProfileJailStatus(p.id, true);
            p.isJailed = false;
            p.jailAutoStopped = false;
            p.jailedAt = null;
            p.jailedMap = null;
          }
        }

        if (!alive && proc) {
          delete runningProcesses[p.id];
        }

        const zenyRate = updateZenyRateTracker(p.id, alive ? liveState : null);
        const bandwidth = await updateBandwidthTracker(p.id, alive ? liveState : null, p.debugPort);

        const liveHasPremium = !!(liveState && !liveState.error && liveState.hasPremium);
        const livePremiumUntil = (liveState && !liveState.error && Number(liveState.premiumUntil) > 0) ? Number(liveState.premiumUntil) : null;
        const effectivePremiumUntil = livePremiumUntil || (Number(p.lastPremiumUntil) > Date.now() ? Number(p.lastPremiumUntil) : null);
        const hasPremium = (alive && liveState && !liveState.error) ? liveHasPremium : Boolean(effectivePremiumUntil && effectivePremiumUntil > Date.now());

        if (alive && liveState && typeof liveState.zeroRender === 'boolean') {
          if (!windowStates[p.id] || (Date.now() - (windowStates[p.id].updatedAt || 0) > 4000)) {
            windowStates[p.id] = { isHidden: liveState.zeroRender, zeroRender: liveState.zeroRender, updatedAt: windowStates[p.id]?.updatedAt || 0 };
          }
        }

        const assignedDeviceId = typeof browserMode.ensureProfileDeviceId === "function"
          ? browserMode.ensureProfileDeviceId(p.id)
          : null;

        if (alive && p.debugPort && assignedDeviceId && !browserMode.isOpen(p.id)) {
          if (!windowStates[p.id]) windowStates[p.id] = {};
          if (windowStates[p.id].syncedDeviceId !== assignedDeviceId) {
            windowStates[p.id].syncedDeviceId = assignedDeviceId;
            evalProfilePort(p.debugPort, `(() => {
              window.__pmDeviceId = ${JSON.stringify(assignedDeviceId)};
              try { if (window.localStorage) window.localStorage.setItem('aetheria.device', window.__pmDeviceId); } catch (_) {}
              if (!window.__pmEnterWorldDeviceHookInstalled && typeof window.fetch === 'function') {
                window.__pmEnterWorldDeviceHookInstalled = true;
                const __origFetch = window.fetch;
                window.fetch = function(input, init) {
                  try {
                    const urlStr = typeof input === 'string' ? input : (input && typeof input.url === 'string' ? input.url : '');
                    if (window.__pmDeviceId && init && typeof init.body === 'string' && (urlStr === '/world/enter' || urlStr.endsWith('/world/enter'))) {
                      const parsed = JSON.parse(init.body);
                      if (parsed && typeof parsed === 'object') {
                        parsed.deviceId = window.__pmDeviceId;
                        init = Object.assign({}, init, { body: JSON.stringify(parsed) });
                      }
                    }
                  } catch (_) {}
                  return __origFetch.call(this, input, init);
                };
              }
              return { success: true, deviceId: window.__pmDeviceId };
            })()`, 2500).catch(() => {});
          }
        }

        return {
          ...p,
          deviceId: assignedDeviceId,
          hasLoginPassword: !!credentials.getPassword(p.id),
          isRunning: alive,
          pid: alive ? (proc ? proc.pid : null) : null,
          uptime: alive ? (proc ? Math.round((Date.now() - proc.startTime) / 1000) : 0) : 0,
          liveState,
          hasPremium,
          premiumUntil: effectivePremiumUntil,
          zenyRate,
          bandwidth,
          screenProxy: screenProxy.getProfileLeaseSnapshot(p.id),
          windowState: windowStates[p.id] || { isHidden: false, zeroRender: false }
        };
      })
    );

    // Remember last-seen portrait / character / premiumUntil so offline cards still show them.
    // Re-read the file here: other requests may have saved profiles while we awaited.
    const changed = enriched.filter(p => {
      const s = p.liveState;
      if (!s || s.error) return false;
      const hasChar = Boolean(s.charName);
      const portrait = hasChar && s.portrait && portraitPathFromSrc(s.portrait);
      const premChanged = (Number(s.premiumUntil) > 0 && Number(s.premiumUntil) !== Number(p.lastPremiumUntil || 0)) ||
                          (hasChar && s.hasPremium === false && Number(p.lastPremiumUntil || 0) > Date.now());
      return (portrait && portrait !== p.lastPortrait) || (hasChar && s.charName !== p.lastCharName) || (hasChar && s.charClass && s.charClass !== p.lastCharClass) || premChanged;
    });
    if (changed.length > 0) {
      const fresh = loadProfiles();
      changed.forEach(p => {
        const target = fresh.find(f => f.id === p.id);
        if (!target) return;
        const hasChar = Boolean(p.liveState.charName);
        const portrait = hasChar && p.liveState.portrait && portraitPathFromSrc(p.liveState.portrait);
        if (portrait) target.lastPortrait = p.lastPortrait = portrait;
        if (hasChar) target.lastCharName = p.lastCharName = p.liveState.charName;
        if (hasChar && p.liveState.charClass) target.lastCharClass = p.lastCharClass = p.liveState.charClass;
        if (Number(p.liveState.premiumUntil) > 0) {
          target.lastPremiumUntil = p.lastPremiumUntil = Number(p.liveState.premiumUntil);
        } else if (hasChar && p.liveState.hasPremium === false && Number(target.lastPremiumUntil || 0) > Date.now()) {
          target.lastPremiumUntil = p.lastPremiumUntil = 0;
        }
      });
      saveProfiles(fresh);
    }

    const bandwidthSummary = enriched.reduce((acc, p) => {
      const bw = p.bandwidth || {};
      acc.todayBytes += (bw.todayBytes || 0);
      acc.todayRxBytes += (bw.todayRxBytes || 0);
      acc.todayTxBytes += (bw.todayTxBytes || 0);
      acc.totalBps += (bw.bps || 0);
      acc.totalBytesPerHour += (bw.bytesPerHour || 0);
      acc.totalEstDayBytes += (bw.estDayBytes || 0);
      return acc;
    }, {
      date: getThaiDateKey(),
      todayBytes: 0,
      todayRxBytes: 0,
      todayTxBytes: 0,
      totalBps: 0,
      totalBytesPerHour: 0,
      totalEstDayBytes: 0
    });

    return sendJSON({
      success: true,
      profiles: enriched,
      bandwidthSummary,
      screenProxySummary: screenProxy.publicSettings(),
      gameExe: getGameExe(),
      allWindowsHidden,
      captchaStats: getCaptchaStats(),
      channelCheckMode: getEffectiveChannelCheckMode()
    });
  }

  // GET / POST /api/channel-check-mode
  if (pathname === "/api/channel-check-mode") {
    if (req.method === "GET") {
      return sendJSON({ success: true, mode: getEffectiveChannelCheckMode(), validModes: VALID_CHANNEL_CHECK_MODES });
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body || "{}");
          const saved = saveChannelCheckMode(payload.mode);
          const syncRes = await syncChannelCheckModeToAllClients(saved);
          return sendJSON({
            success: true,
            mode: saved,
            syncedClients: syncRes.syncedCount,
            totalChecked: syncRes.totalChecked
          });
        } catch (e) {
          return sendJSON({ success: false, error: e.message }, 400);
        }
      });
      return;
    }
  }

  // POST /api/profiles/:id/clear-jail
  if (req.method === "POST" && pathname.match(/^\/api\/profiles\/[^/]+\/clear-jail$/)) {
    const id = pathname.split("/")[3];
    const cleared = clearProfileJailStatus(id, false);
    return sendJSON({ success: true, cleared });
  }

  // POST /api/jail/clear-all
  if (req.method === "POST" && pathname === "/api/jail/clear-all") {
    const fresh = loadProfiles();
    let clearedCount = 0;
    fresh.forEach(p => {
      if (p.isJailed) {
        delete p.isJailed;
        delete p.jailedAt;
        delete p.jailedMap;
        p.jailAutoStopped = true;
        clearedCount++;
      }
    });
    if (clearedCount > 0) saveProfiles(fresh);
    return sendJSON({ success: true, clearedCount });
  }

  // POST /api/profiles/:id/reset-zeny-rate
  if (req.method === "POST" && pathname.match(/^\/api\/profiles\/[^/]+\/reset-zeny-rate$/)) {
    const id = pathname.split("/")[3];
    delete zenyRateTrackers[id];
    zenyRateStateDirty = true;
    saveZenyRateStateNow();
    return sendJSON({ success: true });
  }

  // POST /api/profiles/:id/reset-bandwidth
  if (req.method === "POST" && pathname.match(/^\/api\/profiles\/[^/]+\/reset-bandwidth$/)) {
    const id = pathname.split("/")[3];
    resetBandwidthTracker(id);
    return sendJSON({ success: true });
  }

  // POST /api/profiles/:id/rotate-device-id
  if (req.method === "POST" && pathname.match(/^\/api\/profiles\/[^/]+\/rotate-device-id$/)) {
    const id = pathname.split("/")[3];
    const profiles = loadProfiles();
    const profile = profiles.find(p => p.id === id);
    if (!profile) return sendJSON({ success: false, error: "Profile not found" }, 404);
    const newDeviceId = typeof browserMode.rotateProfileDeviceId === "function"
      ? await browserMode.rotateProfileDeviceId(id)
      : null;
    if (windowStates[id]) delete windowStates[id].syncedDeviceId;
    return sendJSON({ success: true, profileId: id, deviceId: newDeviceId });
  }

  // POST /api/profiles/rotate-all-device-ids
  if (req.method === "POST" && pathname === "/api/profiles/rotate-all-device-ids") {
    const profiles = loadProfiles();
    const rotated = {};
    for (const p of profiles) {
      if (p && p.id && typeof browserMode.rotateProfileDeviceId === "function") {
        rotated[p.id] = await browserMode.rotateProfileDeviceId(p.id);
        if (windowStates[p.id]) delete windowStates[p.id].syncedDeviceId;
      }
    }
    return sendJSON({ success: true, count: Object.keys(rotated).length, deviceIds: rotated });
  }

  // GET /api/portrait?src=/art/classes/hunter-face.webp — cached character portrait
  if (req.method === "GET" && pathname === "/api/portrait") {
    const artPath = portraitPathFromSrc(parsedUrl.searchParams.get("src") || "");
    const file = artPath ? await fetchPortrait(artPath) : null;
    if (!file) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("portrait not found");
    }
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(file).toLowerCase()] || "image/webp",
      "Cache-Control": "public, max-age=86400"
    });
    return fs.createReadStream(file).pipe(res);
  }

  // GET /api/profiles/export-credentials-txt (Download all profiles' ID/Password as a human-readable .txt file)
  if (req.method === "GET" && pathname === "/api/profiles/export-credentials-txt") {
    const profiles = loadProfiles() || [];
    const deviceName = getEffectiveDeviceNickname() || os.hostname() || "PC";
    const nowStr = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
    const lines = [
      "================================================================================",
      `📋 รายการไอดีและรหัสผ่านบอท PmheeAether — เครื่อง: ${deviceName}`,
      `📅 ส่งออกเมื่อ: ${nowStr} (ทั้งหมด ${profiles.length} โปรไฟล์)`,
      "================================================================================",
      "ลำดับ | ชื่อโปรไฟล์ | ตัวละคร | อาชีพ | พอร์ต | ID (Username) | Password",
      "--------------------------------------------------------------------------------"
    ];
    profiles.forEach((p, idx) => {
      if (!p || !p.id) return;
      const num = String(idx + 1).padStart(2, "0");
      const name = String(p.name || p.id).trim();
      const charName = String((p.liveState && p.liveState.charName) || p.lastCharName || "-").trim();
      const cls = String((p.liveState && p.liveState.charClass) || p.charClass || "-").trim();
      const port = p.debugPort || "-";
      const user = String(p.account || p.username || "").trim() || "(ยังไม่มี ID)";
      const pass = String(credentials.getPassword(p.id) || "").trim() || "(ยังไม่มีรหัส)";
      lines.push(`${num} | ${name} | ${charName} | ${cls} | ${port} | ${user} | ${pass}`);
    });
    lines.push("--------------------------------------------------------------------------------");
    lines.push("");
    lines.push("=== รูปแบบย่อ (ID:Password) สำหรับคัดลอกใช้งาน ===");
    profiles.forEach((p) => {
      if (!p || !p.id) return;
      const user = String(p.account || p.username || "").trim();
      const pass = String(credentials.getPassword(p.id) || "").trim();
      const charName = String((p.liveState && p.liveState.charName) || p.lastCharName || p.name || p.id).trim();
      if (user || pass) {
        lines.push(`${user}:${pass}   # ${p.name || p.id} (${charName})`);
      }
    });
    lines.push("");
    const safeDev = String(deviceName).replace(/[^a-zA-Z0-9ก-๙_-]/g, "_") || "PC";
    const dateTag = new Date().toISOString().slice(0, 10);
    const filename = `PmheeAether_ID_Pass_${safeDev}_${dateTag}.txt`;
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    });
    return res.end("\uFEFF" + lines.join("\r\n"));
  }

  // 2. POST /api/profiles (Create)
  if (req.method === "POST" && pathname === "/api/profiles") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const profiles = loadProfiles();
        const nextPort = Math.max(49875, ...profiles.map(p => p.debugPort || 49876)) + 1;
        let newId = "profile_" + Date.now();
        while (profiles.some(p => p.id === newId)) newId = "profile_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
        const newProfile = {
          id: newId,
          name: (data.name || "New Client").trim(),
          account: (data.account || "").trim(),
          autoRegister: !(data.loginPassword || "").trim(),
          charClass: data.charClass || "Archer",
          targetMap: data.targetMap || "ถนนต้นหลิว",
          debugPort: data.debugPort || nextPort,
          autoStart: data.autoStart !== false,
          notes: data.notes || "",
          whitelist: data.whitelist || "Phracon, Rough Elunium, Enchant Rune, Composite Bow, Crossbow, Gakkung, Hunter Bow",
          createdAt: Date.now()
        };
        profiles.push(newProfile);
        saveProfiles(profiles);

        // Pre-create session folder
        const sessionFolder = path.join(SESSIONS_DIR, newProfile.id);
        if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder, { recursive: true });

        if ((data.loginPassword || "").trim()) credentials.setPassword(newProfile.id, data.loginPassword.trim());
        if (newProfile.autoRegister && proxyRegister.isEnabled()) {
          setImmediate(() => authSync.syncOne(newProfile).catch(() => {}));
        }
        sendJSON({ success: true, profile: newProfile });
      } catch (err) {
        sendJSON({ success: false, error: err.message }, 400);
      }
    });
    return;
  }

  // 3. PUT /api/profiles/:id (Update)
  if (req.method === "PUT" && pathname.match(/^\/api\/profiles\/[^/]+$/)) {
    const id = pathname.split("/")[3];
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        const profiles = loadProfiles();
        const idx = profiles.findIndex(p => p.id === id);
        if (idx === -1) return sendJSON({ success: false, error: "Profile not found" }, 404);
        const nextAccount = data.account !== undefined ? data.account.trim() : (profiles[idx].account || "");
        const nextPassword = (data.loginPassword || "").trim();
        const existingPassword = credentials.getPassword(id) || "";
        const hasExistingCharacter = Boolean(profiles[idx].lastCharName && String(profiles[idx].lastCharName).trim());
        const accountChanged = data.account !== undefined && nextAccount !== (profiles[idx].account || "");
        const wantsNewAutoRegister = data.autoRegister === true || (
          data.autoRegister !== false &&
          !nextPassword &&
          !existingPassword &&
          !hasExistingCharacter &&
          data.account !== undefined &&
          nextAccount === "" &&
          accountChanged
        );
        const changesIdentity = accountChanged || !!nextPassword || wantsNewAutoRegister;
        if (changesIdentity) await scriptCoordinator.prepareCredentialChange(profiles[idx]);

        const nextAutoRegister = nextPassword
          ? false
          : (wantsNewAutoRegister ? true : !!profiles[idx].autoRegister);

        profiles[idx] = {
          ...profiles[idx],
          name: data.name !== undefined ? data.name.trim() : profiles[idx].name,
          account: nextAccount,
          autoRegister: nextAutoRegister,
          ...(wantsNewAutoRegister ? { generatedAccount: false, registerError: "", proxyFallbackBrowser: undefined, proxyRegistrationState: undefined } : {}),
          charClass: data.charClass || profiles[idx].charClass,
          targetMap: data.targetMap || profiles[idx].targetMap,
          debugPort: data.debugPort || profiles[idx].debugPort,
          autoStart: data.autoStart !== undefined ? data.autoStart : profiles[idx].autoStart,
          notes: data.notes !== undefined ? data.notes : profiles[idx].notes,
          whitelist: data.whitelist !== undefined ? data.whitelist : profiles[idx].whitelist
        };
        if (wantsNewAutoRegister) {
          delete profiles[idx].proxyFallbackBrowser;
          delete profiles[idx].proxyRegistrationState;
          credentials.setPassword(id, "");
        }
        saveProfiles(profiles);
        if (nextPassword) credentials.setPassword(id, nextPassword);
        if (profiles[idx].autoRegister && proxyRegister.isEnabled()) {
          setImmediate(() => authSync.syncOne(profiles[idx]).catch(() => {}));
        }
        sendJSON({ success: true, profile: profiles[idx] });
      } catch (err) {
        sendJSON({ success: false, error: err.message }, 400);
      }
    });
    return;
  }

    // GET /api/profiles/:id/whitelist (Fetch live from game client or fallback to saved profile)
  if (req.method === "GET" && pathname.match(/^\/api\/profiles\/[^/]+\/whitelist$/)) {
    const id = pathname.split("/")[3];
    const profiles = loadProfiles();
    const profile = profiles.find(p => p.id === id);
    if (!profile) return sendJSON({ success: false, error: "Profile not found" }, 404);

    const defaultWL = "Phracon, Rough Elunium, Enchant Rune, Composite Bow, Crossbow, Gakkung, Hunter Bow";
    const profileWL = profile.whitelist || (profile.sellConfig && profile.sellConfig.whitelist) || defaultWL;

    if (profile.debugPort) {
      const evalCode = `(window.__sellConfig && window.__sellConfig.whitelist !== undefined) ? window.__sellConfig.whitelist : null`;
      const evalUrl = `http://127.0.0.1:${profile.debugPort}/api/eval?code=` + encodeURIComponent(evalCode);
      let responded = false;
      const reqTimer = setTimeout(() => {
        if (responded) return;
        responded = true;
        sendJSON({
          success: true,
          profileId: id,
          profileName: profile.name,
          whitelist: profileWL,
          items: profileWL.split(",").map(s => s.trim()).filter(Boolean),
          isOnline: false
        });
      }, 700);

      http.get(evalUrl, (cRes) => {
        let d = "";
        cRes.setEncoding('utf8');
        cRes.on("data", c => d += c);
        cRes.on("end", () => {
          if (responded) return;
          responded = true;
          clearTimeout(reqTimer);
          try {
            const parsed = JSON.parse(d);
            const liveWL = (parsed.result !== null && parsed.result !== undefined) ? String(parsed.result) : profileWL;
            profile.whitelist = liveWL;
            saveProfiles(profiles);
            sendJSON({
              success: true,
              profileId: id,
              profileName: profile.name,
              whitelist: liveWL,
              items: liveWL.split(",").map(s => s.trim()).filter(Boolean),
              isOnline: true
            });
          } catch(e) {
            sendJSON({
              success: true,
              profileId: id,
              profileName: profile.name,
              whitelist: profileWL,
              items: profileWL.split(",").map(s => s.trim()).filter(Boolean),
              isOnline: false
            });
          }
        });
      }).on("error", () => {
        if (responded) return;
        responded = true;
        clearTimeout(reqTimer);
        sendJSON({
          success: true,
          profileId: id,
          profileName: profile.name,
          whitelist: profileWL,
          items: profileWL.split(",").map(s => s.trim()).filter(Boolean),
          isOnline: false
        });
      });
      return;
    }

    return sendJSON({
      success: true,
      profileId: id,
      profileName: profile.name,
      whitelist: profileWL,
      items: profileWL.split(",").map(s => s.trim()).filter(Boolean),
      isOnline: false
    });
  }

  // PUT /api/profiles/:id/whitelist (Update whitelist & sync live to clients)
  if (req.method === "PUT" && pathname.match(/^\/api\/profiles\/[^/]+\/whitelist$/)) {
    const id = pathname.split("/")[3];
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const profiles = loadProfiles();
        const profile = profiles.find(p => p.id === id);
        if (!profile) return sendJSON({ success: false, error: "Profile not found" }, 404);

        const newWhitelist = typeof payload.whitelist === "string" ? payload.whitelist : "";
        profile.whitelist = newWhitelist;
        if (!profile.sellConfig) profile.sellConfig = {};
        profile.sellConfig.whitelist = newWhitelist;

        const syncToLiveClient = (p) => {
          if (!p.debugPort) return;
          const code = `(() => {
            if (!window.__sellConfig) window.__sellConfig = {};
            window.__sellConfig.whitelist = ${JSON.stringify(newWhitelist)};
            try { localStorage.setItem("pelican_sell_cfg", JSON.stringify(window.__sellConfig)); } catch(e){}
            const wlEl = document.getElementById("p-sell-whitelist");
            if (wlEl) wlEl.value = ${JSON.stringify(newWhitelist)};
            return { success: true };
          })()`;
          evalProfilePort(p.debugPort, code, 5000);
        };

        // Sync live to current profile's game client
        syncToLiveClient(profile);

        let copiedTargetsCount = 0;
        if (Array.isArray(payload.targets) && payload.targets.length > 0) {
          payload.targets.forEach(targetId => {
            const targetProfile = profiles.find(p => p.id === targetId);
            if (targetProfile) {
              targetProfile.whitelist = newWhitelist;
              if (!targetProfile.sellConfig) targetProfile.sellConfig = {};
              targetProfile.sellConfig.whitelist = newWhitelist;
              syncToLiveClient(targetProfile);
              if (targetProfile.id !== profile.id) copiedTargetsCount++;
            }
          });
        }

        saveProfiles(profiles);
        sendJSON({
          success: true,
          whitelist: newWhitelist,
          items: newWhitelist.split(",").map(s => s.trim()).filter(Boolean),
          copiedTargetsCount,
          message: copiedTargetsCount > 0
            ? `คัดลอก Whitelist ไปยัง ${copiedTargetsCount} จอเรียบร้อยแล้ว!`
            : "บันทึกและซิงค์ Whitelist สำหรับจอนี้เรียบร้อยแล้ว!"
        });
      } catch (err) {
        sendJSON({ success: false, error: err.message }, 400);
      }
    });
    return;
  }

  // POST /api/profiles/recover (Manual / explicit auto-recovery trigger — local evidence first, then central server backup)
  if (req.method === "POST" && pathname === "/api/profiles/recover") {
    await recoverAndEnrichProfilesFromBrowserAndLocal().catch(() => {});
    const recovered = recoverProfilesFromLocalEvidence();
    if (recovered && recovered.length > 0) {
      saveProfiles(recovered);
      await recoverAndEnrichProfilesFromBrowserAndLocal().catch(() => {});
      const enriched = loadProfiles() || recovered;
      return sendJSON({ success: true, source: "local", recoveredCount: enriched.length, profiles: enriched });
    }
    const cloud = await restoreProfilesFromCentral();
    if (cloud && cloud.success && cloud.restoredProfiles > 0) {
      await recoverAndEnrichProfilesFromBrowserAndLocal().catch(() => {});
      const fresh = loadProfiles();
      return sendJSON({ success: true, source: "cloud", recoveredCount: cloud.restoredProfiles, restoredCredentials: cloud.restoredCredentials, profiles: fresh });
    }
    return sendJSON({ success: false, recoveredCount: 0, error: "ไม่พบข้อมูลโปรไฟล์สำรองในโฟลเดอร์นี้หรือบนเซิร์ฟเวอร์" }, 404);
  }

  // GET /api/profiles/export-backup (Export all local profiles + credentials as JSON)
  if (req.method === "GET" && pathname === "/api/profiles/export-backup") {
    const payload = buildLocalProfileBackupPayload();
    return sendJSON({ success: true, backup: payload });
  }

  // POST /api/profiles/import-backup (Import backup JSON exported from Admin Console or Manager)
  if (req.method === "POST" && pathname === "/api/profiles/import-backup") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const target = (parsed && parsed.backup && typeof parsed.backup === "object") ? parsed.backup : parsed;
        const result = applyProfileBackupPayload(target);
        if (result.restoredProfiles === 0) {
          return sendJSON({ success: false, error: "ไม่พบรายการโปรไฟล์ในไฟล์สำรองที่เลือก" }, 400);
        }
        scheduleCentralProfileBackupSync(1000);
        return sendJSON({
          success: true,
          restoredProfiles: result.restoredProfiles,
          restoredCredentials: result.restoredCredentials,
          profiles: loadProfiles()
        });
      } catch (err) {
        return sendJSON({ success: false, error: "ไฟล์สำรองไม่ถูกต้อง: " + err.message }, 400);
      }
    });
    return;
  }

  // POST /api/profiles/sync-cloud-backup (Force immediate sync of profiles + ID/Pass to central server)
  if (req.method === "POST" && pathname === "/api/profiles/sync-cloud-backup") {
    const resSync = await syncProfileBackupToCentral();
    return sendJSON({ success: Boolean(resSync && resSync.success), result: resSync });
  }

  // 4. DELETE /api/profiles/:id
  if (req.method === "DELETE" && pathname.match(/^\/api\/profiles\/[^/]+$/)) {
    const id = pathname.split("/")[3];
    const profiles = loadProfiles();
    const idx = profiles.findIndex(p => p.id === id);
    if (idx === -1) return sendJSON({ success: false, error: "Profile not found" }, 404);

    screenProxy.releaseProfile(id, "deleted").catch(() => {});
    recordDeletedProfileId(id);
    // Stop process if running
    if (runningProcesses[id] && isProcessAlive(runningProcesses[id].pid)) {
      try { process.kill(runningProcesses[id].pid, "SIGTERM"); } catch (e) {}
      delete runningProcesses[id];
    }

    profiles.splice(idx, 1);
    saveProfiles(profiles, { allowEmpty: true });
    if (profiles.length === 0) {
      try { writeJsonAtomic(PROFILES_BACKUP_FILE, []); } catch (_) {}
    }
    return sendJSON({ success: true });
  }

  // 5. POST /api/profiles/:id/launch
  if (req.method === "POST" && pathname.match(/^\/api\/profiles\/[^/]+\/launch$/)) {
    const id = pathname.split("/")[3];
    const profilesForLaunch = loadProfiles();
    const p0 = profilesForLaunch.find(p => p.id === id);
    if (!p0) return sendJSON({ success: false, error: "Profile not found" }, 404);
    if (!p0.jailAutoStopped) {
      p0.jailAutoStopped = true;
      saveProfiles(profilesForLaunch);
    }
    // already open (also after a Manager restart, or as the other kind of window): bring it up, don't open a 2nd
    if (!browserMode.isOpen(id) && await clientAlreadyOpen(p0)) {
      http.get(`http://127.0.0.1:${p0.debugPort}/api/window?action=top`, r => r.resume()).on("error", () => {});
      return sendJSON({ success: true, message: "จอนี้เปิดอยู่แล้ว", alreadyOpen: true });
    }
    const alreadyRunning = !isBrowserMode() && runningProcesses[id] && isProcessAlive(runningProcesses[id].pid);
    const profile = (!alreadyRunning && !browserMode.isOpen(id)) ? await ensureUsableDebugPort(id) : loadProfiles().find(p => p.id === id);

    if (isBrowserMode()) {
      browserMode.launch(profile)
        .then(r => {
          if (r && r.alreadyOpen) scriptCoordinator.cycle?.().catch(() => {});
          if (profile.autoRegister || profile.loginSyncPending) {
            setImmediate(() => authSync.syncOne(loadProfiles().find(x => x.id === profile.id) || profile).catch(() => {}));
            setTimeout(() => authSync.syncOne(loadProfiles().find(x => x.id === profile.id) || profile).catch(() => {}), 2500);
          }
          sendJSON(r);
        })
        .catch(e => sendJSON({ success: false, error: `เปิดในเบราว์เซอร์ไม่สำเร็จ: ${e.message}` }, 500));
      return;
    }

    if (runningProcesses[id] && isProcessAlive(runningProcesses[id].pid)) {
      return sendJSON({ success: true, message: "Client is already running", pid: runningProcesses[id].pid });
    }

    const sessionDir = path.join(SESSIONS_DIR, profile.id);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const launchProblem = gameLaunchProblem();
    if (launchProblem) return sendJSON({ success: false, error: launchProblem }, 500);

    const protectedPilot=!!scriptCoordinator.profileScriptSource(profile.id);
    if(protectedPilot&&!installer.checkStatus().protectedScriptCapable)return sendJSON({success:false,code:'PROTECTED_LOADER_UPDATE_REQUIRED',error:'จอทดลอง Electron ต้องอัปเดตผ่านปุ่ม สคริปต์เกม ก่อน (loader 1.0.7) จากนั้นเปิดเฉพาะจอทดลองใหม่ จออื่นไม่ต้องปิด'},409);
    let proxyArgs = [];
    if (screenProxy.isEnabled()) {
      try {
        const tunnelInfo = await screenProxy.acquireForProfile(profile.id, { debugPort: profile.debugPort });
        if (tunnelInfo && tunnelInfo.proxyServerUrl) {
          proxyArgs = [
            `--proxy-server=${tunnelInfo.proxyServerUrl}`,
            "--proxy-bypass-list=127.0.0.1;localhost"
          ];
        }
      } catch (_) {}
    }
    const args = [
      ...(protectedPilot?['--pmhee-protected-script']:[]),
      ...proxyArgs,
      `--user-data-dir=${sessionDir}`,
      `--profile-name=${encodeURIComponent(profile.name)}`,
      `--debug-port=${profile.debugPort || 49876}`,
      "--multi-instance"
    ];

    try {
      const child = spawn(getGameExe(), args, {
        cwd: path.dirname(getGameExe()),
        detached: true,
        stdio: "ignore",
        windowsHide: false
      });
      child.unref();

      runningProcesses[id] = {
        pid: child.pid,
        startTime: Date.now()
      };

      console.log(`[PmheeAether Manager] 🚀 Launched client "${profile.name}" (PID: ${child.pid}, Port: ${profile.debugPort})`);
      if (profile.autoRegister || profile.loginSyncPending) {
        setImmediate(() => authSync.syncOne(loadProfiles().find(x => x.id === profile.id) || profile).catch(() => {}));
        setTimeout(() => authSync.syncOne(loadProfiles().find(x => x.id === profile.id) || profile).catch(() => {}), 3500);
      }
      return sendJSON({ success: true, pid: child.pid, port: profile.debugPort, movedFromPort: profile.movedFromPort });
    } catch (err) {
      return sendJSON({ success: false, error: err.message }, 500);
    }
  }

  // 6. POST /api/profiles/:id/stop
  if (req.method === "POST" && pathname.match(/^\/api\/profiles\/[^/]+\/stop$/)) {
    const id = pathname.split("/")[3];
    screenProxy.releaseProfile(id, "stopped").catch(() => {});
    if (browserMode.isOpen(id)) {
      browserMode.stop(id).then(() => sendJSON({ success: true })).catch(e => sendJSON({ success: false, error: e.message }, 500));
      return;
    }
    const proc = runningProcesses[id];
    if (proc && proc.pid) {
      exec(`taskkill /pid ${proc.pid} /f /t`, (err) => {
        delete runningProcesses[id];
        return sendJSON({ success: true });
      });
    } else {
      delete runningProcesses[id];
      return sendJSON({ success: true, message: "Not running" });
    }
    return;
  }

  // 7. POST /api/launch-all
  if (req.method === "POST" && pathname === "/api/launch-all") {
    const allProfiles = loadProfiles();
    const openFlags = await Promise.all(allProfiles.map(p => clientAlreadyOpen(p)));
    const skipped = allProfiles.filter((p, i) => openFlags[i]).map(p => p.name);
    const toOpen = allProfiles.filter((p, i) => !openFlags[i]);
    let jailGuardUpdated = false;
    for (const p0 of toOpen) {
      if (!p0.jailAutoStopped) {
        p0.jailAutoStopped = true;
        jailGuardUpdated = true;
      }
    }
    if (jailGuardUpdated) saveProfiles(allProfiles);
    if (isBrowserMode()) {
      (async () => {
        const launched = [], failed = [];
        for (const p0 of toOpen) {
          const p = (await ensureUsableDebugPort(p0.id)) || p0;
          try {
            const r = await browserMode.launch(p);
            if (r && r.alreadyOpen) {
              scriptCoordinator.cycle?.().catch(() => {});
              if (!r.recovered) skipped.push(p.name);
              else launched.push({ id: p.id, name: p.name });
            } else {
              launched.push({ id: p.id, name: p.name });
            }
            if (p.autoRegister || p.loginSyncPending) {
              setImmediate(() => authSync.syncOne(loadProfiles().find(x => x.id === p.id) || p).catch(() => {}));
            }
          }
          catch (e) { failed.push(`${p.name}: ${e.message}`); }
        }
        sendJSON({ success: failed.length === 0, launched, skipped, error: failed.length ? failed.join('\n') : undefined });
      })();
      return;
    }
    const launchProblem = gameLaunchProblem();
    if (launchProblem) return sendJSON({ success: false, error: launchProblem }, 500);
    const launched = [], failed = [];
    for (const p0 of toOpen) {
      const p = (await ensureUsableDebugPort(p0.id)) || p0;
      const sessionDir = path.join(SESSIONS_DIR, p.id);
      if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

      const protectedPilot=!!scriptCoordinator.profileScriptSource(p.id);
      if(protectedPilot&&!installer.checkStatus().protectedScriptCapable){failed.push(p.name+': ต้องอัปเดต สคริปต์เกม เป็น loader 1.0.7 ก่อนเปิดจอทดลอง');continue;}
      let proxyArgs = [];
      if (screenProxy.isEnabled()) {
        try {
          const tunnelInfo = await screenProxy.acquireForProfile(p.id, { debugPort: p.debugPort });
          if (tunnelInfo && tunnelInfo.proxyServerUrl) {
            proxyArgs = [
              `--proxy-server=${tunnelInfo.proxyServerUrl}`,
              "--proxy-bypass-list=127.0.0.1;localhost"
            ];
          }
        } catch (_) {}
      }
      const args = [
        ...(protectedPilot?['--pmhee-protected-script']:[]),
        ...proxyArgs,
        `--user-data-dir=${sessionDir}`,
        `--profile-name=${encodeURIComponent(p.name)}`,
        `--debug-port=${p.debugPort || 49876}`,
        "--multi-instance"
      ];
      try {
        const child = spawn(getGameExe(), args, { cwd: path.dirname(getGameExe()), detached: true, stdio: "ignore", windowsHide: false });
        child.unref();
        runningProcesses[p.id] = { pid: child.pid, startTime: Date.now() };
        launched.push({ id: p.id, name: p.name, pid: child.pid });
        if (p.autoRegister || p.loginSyncPending) {
          setImmediate(() => authSync.syncOne(loadProfiles().find(x => x.id === p.id) || p).catch(() => {}));
        }
      } catch (e) {}
    }
    return sendJSON({ success:failed.length===0, launched, skipped, error:failed.length?failed.join('\n'):undefined });
  }

  // 8. POST /api/stop-all
  if (req.method === "POST" && pathname === "/api/stop-all") {
    screenProxy.releaseAll().catch(() => {});
    for (const p of loadProfiles()) if (browserMode.isOpen(p.id)) browserMode.stop(p.id).catch(() => {});
    for (const id in runningProcesses) {
      const proc = runningProcesses[id];
      if (proc && proc.pid) {
        try { exec(`taskkill /pid ${proc.pid} /f /t`); } catch (e) {}
      }
      delete runningProcesses[id];
    }
    return sendJSON({ success: true });
  }

  // 9. POST /api/tile-windows (Arrange Windows side-by-side, grid, or shrink)
  if (req.method === "POST" && pathname === "/api/tile-windows") {
    const reqLayout = parsedUrl.searchParams.get("layout");
    const layout = ["side", "grid", "compact", "shrink", "custom"].includes(reqLayout) ? reqLayout : "grid"; // only known values reach the PowerShell script
    // "custom": a fixed cols x rows grid (e.g. 4x4) filled left to right, top to bottom; with more windows
    // than cells, window cells+1 goes back on cell 1 (stacked on top of window 1), and so on
    const gridCols = Math.max(1, Math.min(10, parseInt(parsedUrl.searchParams.get("cols")) || 3));
    const gridRows = Math.max(1, Math.min(10, parseInt(parsedUrl.searchParams.get("rows")) || 3));
    const browserOpen = loadProfiles().filter(p => browserMode.isOpen(p.id));
    if (browserOpen.length) {
      const scr = await runPowerShell("Add-Type -AssemblyName System.Windows.Forms; $a=[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; Write-Output \"$($a.Width)x$($a.Height)\"");
      const m = String((scr && (scr.stdout || scr.output)) || '').match(/(\d+)x(\d+)/);
      const sw = m ? Number(m[1]) : 1920, sh = m ? Number(m[2]) : 1040;
      const n = browserOpen.length;
      const cols = layout === 'custom' ? gridCols : (layout === 'side' || n <= 2 ? n : (n <= 4 ? 2 : n <= 9 ? 3 : 4));
      const rows = layout === 'custom' ? gridRows : Math.ceil(n / cols);
      const w = Math.floor(sw / cols), h = Math.floor(sh / rows);
      browserOpen.forEach((p, i) => {
        const cell = i % (cols * rows);
        const x = (cell % cols) * w, y = Math.floor(cell / cols) * h;
        http.get(`http://127.0.0.1:${p.debugPort}/api/window?action=set-bounds&x=${x}&y=${y}&w=${w}&h=${h}`, () => {}).on('error', () => {});
      });
      return sendJSON({ success: true });
    }
    
    const pidOrder = loadProfiles().map(p => runningProcesses[p.id] && isProcessAlive(runningProcesses[p.id].pid) ? Number(runningProcesses[p.id].pid) : 0).filter(Boolean).join(",");
    const psScript = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class WinPos {
          [DllImport("user32.dll")]
          public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
          [DllImport("user32.dll")]
          public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
          [DllImport("user32.dll")]
          public static extern bool SetForegroundWindow(IntPtr hWnd);
        }
"@
      Add-Type -AssemblyName System.Windows.Forms
      # same order as the profile list (windows started by this Manager), the rest after them
      $order = @(${pidOrder})
      $procs = @(Get-Process -Name "Aetheria Online" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object @{ Expression = { $k = [array]::IndexOf($order, $_.Id); if ($k -lt 0) { 100000 } else { $k } } }, MainWindowTitle)
      $count = $procs.Count
      if ($count -gt 0) {
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
        $sw = $screen.Width
        $sh = $screen.Height
        for ($i = 0; $i -lt $count; $i++) {
          $h = $procs[$i].MainWindowHandle
          [WinPos]::ShowWindow($h, 9)
          if ('${layout}' -eq 'custom') {
            $cols = ${gridCols}
            $rows = ${gridRows}
            $cell = $i % ($cols * $rows)
            $w = [int][Math]::Floor($sw / $cols)
            $h_h = [int][Math]::Floor($sh / $rows)
            [WinPos]::MoveWindow($h, ($cell % $cols) * $w, [Math]::Floor($cell / $cols) * $h_h, $w, $h_h, $true)
          } elseif ('${layout}' -eq 'side' -or $count -le 2) {
            $w = [int]($sw / $count)
            $x = $i * $w
            [WinPos]::MoveWindow($h, $x, 0, $w, $sh, $true)
          } else {
            # Fit every window on screen: 3-4 -> 2x2, 5-6 -> 3x2, 7-9 -> 3x3, 10+ -> 4 columns
            if ($count -le 4) { $cols = 2 } elseif ($count -le 9) { $cols = 3 } else { $cols = 4 }
            $rows = [Math]::Ceiling($count / $cols)
            $w = [int][Math]::Floor($sw / $cols)
            $h_h = [int][Math]::Floor($sh / $rows)
            $col = $i % $cols
            $row = [Math]::Floor($i / $cols)
            $x = $col * $w
            $y = $row * $h_h
            [WinPos]::MoveWindow($h, $x, $y, $w, $h_h, $true)
          }
        }
      }
    `;

    runPowerShell(psScript).then(r => sendJSON({ success: r.success }));
    return;
  }

  // POST /api/toggle-all-windows (Toggle Smart Zero-Render Mode across all game windows)
  if (req.method === "POST" && pathname === "/api/toggle-all-windows") {
    allWindowsHidden = !allWindowsHidden;
    const profiles = loadProfiles();
    await Promise.all(profiles.map(async p => {
      windowStates[p.id] = { isHidden: allWindowsHidden, zeroRender: allWindowsHidden, updatedAt: Date.now() };
      if (p.debugPort) {
        clientStateCacheByPort.delete(p.debugPort);
        if (!allWindowsHidden) {
          http.get(`http://127.0.0.1:${p.debugPort}/api/window?action=show`, () => {}).on('error', () => {});
        }
        await evalProfilePort(p.debugPort, `typeof window.setZeroRenderMode === 'function' ? window.setZeroRenderMode(${allWindowsHidden}) : (typeof window.setLowPowerMode === 'function' && window.setLowPowerMode(${allWindowsHidden}))`, 3000).catch(() => {});
        clientStateCacheByPort.delete(p.debugPort);
      }
    }));
    return sendJSON({ success: true, allWindowsHidden, zeroRender: allWindowsHidden });
  }

  // POST /api/weight-check?apply=0|1&target=7000 — max weight of every online client that runs a plan.
  // apply=1 asks those below the target to buy + use Weight Limit Scrolls (bot: window.requestWeightTopUp).
  if (req.method === "POST" && pathname === "/api/weight-check") {
    const apply = parsedUrl.searchParams.get("apply") === "1";
    const target = Math.max(1000, Math.min(20000, parseInt(parsedUrl.searchParams.get("target")) || 7000));
    const only = (parsedUrl.searchParams.get("ids") || "").split(",").filter(Boolean);
    const code = `(() => {
      if (!window.__planScriptEnabled || !window.__currentScriptPlan) return { skip: 'no-plan' };
      const limit = Number((window.__latestInventory || {}).weightLimit) || 0;
      if (!limit) return { error: 'ยังไม่มีข้อมูลกระเป๋า (ยังไม่เข้าเกม?)' };
      const ch = (typeof window.getLiveCharacterData === 'function' && window.getLiveCharacterData()) || {};
      // scrolls already used, from max weight = 2000 + 30 × STR (base + bonus) + 500 × used (the game allows 10)
      let used = null;
      if (ch.stats && typeof ch.stats.STR === 'number' && !(Number((ch.skills || {})['enlarge-weight']) > 0)) {
        const x = (limit - 2000 - 30 * ((Number(ch.stats.STR) || 0) + (Number(ch.bonusStats && ch.bonusStats.STR) || 0))) / 500;
        if (Math.abs(x - Math.round(x)) < 0.01 && Math.round(x) >= 0 && Math.round(x) <= 10) used = Math.round(x);
      }
      const need = Math.max(0, Math.min(10 - (used || 0), Math.ceil((${target} - limit) / 500)));
      const supported = typeof window.requestWeightTopUp === 'function';
      const scrolls = ((window.__latestInventory || {}).items || []).filter(it => it && Number(it.itemId) === 90309).reduce((a, it) => a + (it.qty || 1), 0);
      let requested = false;
      if (${apply} && need > 0 && supported) requested = window.requestWeightTopUp(${target});
      return { limit, need, used, scrolls, zeny: Number(ch.zeny) || 0, bot: !!window.__isBotRunning, supported, requested,
               pending: !!(typeof window.getWeightTopUpState === 'function' && window.getWeightTopUpState()) };
    })()`;
    const profiles = loadProfiles().filter(p => p.debugPort && (!only.length || only.includes(p.id)));
    const results = await Promise.all(profiles.map(async p => {
      const r = await evalProfilePort(p.debugPort, code, 5000);
      if (!r || !r.success) return { id: p.id, name: p.name, offline: true };
      return { id: p.id, name: p.name, ...(r.result || {}) };
    }));
    return sendJSON({ success: true, target, apply, results });
  }

  // POST /api/profiles/:id/focus-window — bring this game window to the front (wakes graphics if in Zero-Render)
  if (req.method === "POST" && pathname.match(/^\/api\/profiles\/[^/]+\/focus-window$/)) {
    const id = pathname.split("/")[3];
    const profile = loadProfiles().find(p => p.id === id);
    if (!profile) return sendJSON({ success: false, error: "Profile not found" }, 404);
    if (!profile.debugPort) return sendJSON({ success: false, error: "Client debug port not set" }, 400);
    const port = profile.debugPort;

    const proc = runningProcesses[id];
    windowStates[id] = { isHidden: false, zeroRender: false, updatedAt: Date.now() };
    clientStateCacheByPort.delete(port);
    if (proc && proc.pid) {
      runPowerShell(`Add-Type 'using System; using System.Runtime.InteropServices; public class PmShow { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); }'
        Get-Process -Id ${proc.pid} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { [PmShow]::ShowWindow($_.MainWindowHandle, 9) }`);
    }
    await evalProfilePort(port, `typeof window.setZeroRenderMode === 'function' ? window.setZeroRenderMode(false) : (typeof window.setLowPowerMode === 'function' && window.setLowPowerMode(false))`, 3000).catch(() => {});
    clientStateCacheByPort.delete(port);
    // Electron loader: restore + always-on-top for a moment + focus. Browser mode: restore + activate tab.
    await new Promise(resolve => {
      http.get(`http://127.0.0.1:${port}/api/window?action=top`, { timeout: 5000 }, r => { r.resume(); r.on("end", resolve); })
        .on("error", resolve).on("timeout", resolve);
    });

    // Windows does not let a background program raise another program's window, and a browser window has
    // no process of its own to look up: tag the page title, find that top-level window, then raise it.
    if (browserMode.isOpen(id)) {
      const token = `PMFOCUS${Date.now()}`;
      await evalProfilePort(port, `(() => { window.__pmTitleBeforeFocus = document.title; document.title = ${JSON.stringify(token)} + ' ' + document.title; return true; })()`, 3000);
      await new Promise(r => setTimeout(r, 350));
      const ps = await runPowerShell(`Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class PmFocus {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  public static string Raise(string token) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      if (sb.ToString().Contains(token)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    if (found == IntPtr.Zero) return "notfound";
    if (IsIconic(found)) ShowWindow(found, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); // Alt tap: allows SetForegroundWindow
    BringWindowToTop(found);
    return SetForegroundWindow(found) ? "ok" : "fail";
  }
}
"@
[PmFocus]::Raise('${token}')`);
      await evalProfilePort(port, `(() => { if (document.title.startsWith(${JSON.stringify(token)})) document.title = window.__pmTitleBeforeFocus; return true; })()`, 3000);
      return sendJSON({ success: true, raised: String(ps.stdout || "").trim() });
    }
    return sendJSON({ success: true });
  }

  // POST /api/profiles/:id/toggle-window (Toggle Smart Zero-Render Mode for single game window)
  if (req.method === "POST" && pathname.match(/^\/api\/profiles\/[^/]+\/toggle-window$/)) {
    const id = pathname.split("/")[3];
    const profiles = loadProfiles();
    const profile = profiles.find(p => p.id === id);
    if (!profile) return sendJSON({ success: false, error: "Profile not found" }, 404);

    if (!windowStates[id]) windowStates[id] = { isHidden: false, zeroRender: false };
    windowStates[id].isHidden = !windowStates[id].isHidden;
    windowStates[id].zeroRender = windowStates[id].isHidden;
    windowStates[id].updatedAt = Date.now();
    const isHidden = windowStates[id].isHidden;

    if (profile.debugPort) {
      clientStateCacheByPort.delete(profile.debugPort);
      if (!isHidden) {
        http.get(`http://127.0.0.1:${profile.debugPort}/api/window?action=show`, () => {}).on('error', () => {});
      }
      await evalProfilePort(profile.debugPort, `typeof window.setZeroRenderMode === 'function' ? window.setZeroRenderMode(${isHidden}) : (typeof window.setLowPowerMode === 'function' && window.setLowPowerMode(${isHidden}))`, 3000).catch(() => {});
      clientStateCacheByPort.delete(profile.debugPort);
    }

    return sendJSON({ success: true, isHidden, zeroRender: isHidden });
  }

  // POST /api/profiles/:id/toggle-bot (Start / Stop Bot loop on specific card)
  if (req.method === "POST" && pathname.match(/^\/api\/profiles\/[^/]+\/toggle-bot$/)) {
    const id = pathname.split("/")[3];
    const profiles = loadProfiles();
    const profile = profiles.find(p => p.id === id);
    if (!profile) return sendJSON({ success: false, error: "Profile not found" }, 404);
    if (!profile.debugPort) return sendJSON({ success: false, error: "Client debug port not set" }, 400);

    const action = parsedUrl.searchParams.get("action"); // 'start', 'stop', or toggle
    const live = await queryClientState(profile.debugPort);
    // "ลูป 24 ชม." (autoLoop) is only a setting — START BOT is __isBotRunning
    const isRunning = Boolean(live && live.isBotRunning);
    const targetRunning = action === "start" ? true : (action === "stop" ? false : !isRunning);

    const code = targetRunning ? `(() => {
      if (window.__isBotRunning) {
        if (typeof updateMasterBotUI === 'function') updateMasterBotUI();
        return { success: true, running: true, unchanged: true };
      }
      window.__autoLoopEnabled = true;
      window.__isBotRunning = true;
      try { localStorage.setItem('pelican_auto_loop', true); } catch(e){}
      if (typeof window.startMasterBot === 'function') window.startMasterBot();
      if (typeof window.startAutoLoop === 'function') window.startAutoLoop();
      if (typeof updateMasterBotUI === 'function') updateMasterBotUI();
      return { success: true, running: true };
    })()` : `(() => {
      if (!window.__isBotRunning) {
        window.__autoLoopEnabled = false;
        try { localStorage.setItem('pelican_auto_loop', false); } catch(e){}
        if (typeof updateMasterBotUI === 'function') updateMasterBotUI();
        return { success: true, running: false, unchanged: true };
      }
      window.__autoLoopEnabled = false;
      window.__isBotRunning = false;
      try { localStorage.setItem('pelican_auto_loop', false); } catch(e){}
      if (typeof window.stopMasterBot === 'function') window.stopMasterBot();
      if (typeof window.stopAutoLoop === 'function') window.stopAutoLoop();
      if (typeof updateMasterBotUI === 'function') updateMasterBotUI();
      return { success: true, running: false };
    })()`;

    const evalUrl = `http://127.0.0.1:${profile.debugPort}/api/eval?code=` + encodeURIComponent(code);
    http.get(evalUrl, (cRes) => {
      let d = "";
      cRes.setEncoding('utf8');
      cRes.on("data", c => d += c);
      cRes.on("end", () => {
        let ok = false;
        try { const r = JSON.parse(d); ok = !!(r && r.success && r.result && r.result.success); } catch (e) {}
        if (ok) sendJSON({ success: true, isBotRunning: targetRunning });
        else sendJSON({ success: false, error: "เกมไม่ตอบรับคำสั่ง (บอทอาจยังโหลดไม่เสร็จ)" }, 502);
      });
    }).on('error', (err) => {
      sendJSON({ success: false, error: err.message }, 502);
    });
    return;
  }

  // GET /api/profiles/:id/client-data (Live Bot Configs & State for Floating Web HUD)
  if (req.method === "GET" && pathname.match(/^\/api\/profiles\/[^/]+\/client-data$/)) {
    const id = pathname.split("/")[3];
    const profiles = loadProfiles();
    const profile = profiles.find(p => p.id === id);
    if (!profile || !profile.debugPort) return sendJSON({ success: false, error: "Profile offline" }, 400);

    const code = `(() => {
      const auth = window.__authConfig || {};
      const archer = window.__archerConfig || {};
      const buffPotions = window.__buffPotionConfig || {};
      const sell = window.__sellConfig || {};
      const autosell = window.__autoMarketSellConfig || {};
      const marketFilter = window.__marketFilterConfig || {};
      const travel = window.__travelConfig || {};
      const humanize = window.__humanizeConfig || {};
      const shop = window.__shopConfig || {};
      const state = typeof window.__getClientLiveState === 'function' ? window.__getClientLiveState() : null;
      const bagCount = (itemId) => (typeof window.getBagItemCount === 'function' ? window.getBagItemCount(itemId) : 0);
      return {
        state: state,
        botVersion: window.__pelicanBotVersion || null,
        targetFarmMap: window.__targetFarmMap || (document.getElementById('p-target-map-select')?.value) || (state ? state.targetMap : null),
        autoLoopEnabled: !!window.__autoLoopEnabled,
        isBotRunning: !!window.__isBotRunning,
        planScriptEnabled: !!window.__planScriptEnabled,
        currentPlanName: (window.__currentScriptPlan && window.__currentScriptPlan.name) || null,
        travelConfig: {
          minZenyForWarp: Number(travel.minZenyForWarp) || 0
        },
        unexpectedTownGuardEnabled: window.__unexpectedTownGuardEnabled !== false,
        unexpectedTownWaiting: !!window.__unexpectedTownWaiting,
        unexpectedTownCountdown: document.getElementById('p-unexpected-countdown')?.innerText || '--:--',
        humanizeConfig: {
          enabled: humanize.enabled !== false,
          chance: Number(humanize.chance ?? humanize.chancePercent ?? 70),
          chancePercent: Number(humanize.chancePercent ?? humanize.chance ?? 70),
          buyBlacksmith: (humanize.buyBlacksmith ?? humanize.visitBlacksmith) !== false,
          visitBlacksmith: (humanize.visitBlacksmith ?? humanize.buyBlacksmith) !== false,
          buySundries: (humanize.buySundries ?? humanize.visitSundries) !== false,
          visitSundries: (humanize.visitSundries ?? humanize.buySundries) !== false,
          randomWalk: humanize.randomWalk !== false,
          storeDeposit: (humanize.storeDeposit ?? humanize.openStorage) !== false,
          openStorage: (humanize.openStorage ?? humanize.storeDeposit) !== false
        },
        archerConfig: archer,
        bwingCount: bagCount(90311),
        buffPotionConfig: buffPotions,
        potionCounts: {
          90306: bagCount(90306),
          90307: bagCount(90307),
          90308: bagCount(90308)
        },
        sellConfig: sell,
        autoMarketSellConfig: autosell,
        marketFilterConfig: marketFilter,
        shopConfig: shop,
        ultraLowSpecEnabled: window.__ultraLowSpecEnabled !== false,
        autoConfigCharEnabled: window.__autoConfigCharEnabled !== false,
        autoMuteDisplayEnabled: window.__autoMuteDisplayEnabled !== false,
        authConfig: {
          enabled: !!auth.enabled,
          username: auth.username || (document.getElementById('p-auth-user')?.value) || '',
          charName: auth.charName || (document.getElementById('p-auth-char')?.value) || '',
          hasPassword: !!(auth.password || (document.getElementById('p-auth-pass')?.value)),   // never the password itself
          autoResumeBot: !!auth.autoResumeBot
        },
        serverWeight: window.__serverWeight || null,
        currentAmmo: (typeof window.__currentAmmo === 'number') ? window.__currentAmmo : (state ? state.ammo : 0),
        myMarketActiveCount: window.__myMarketActiveCount || 0
      };
    })()`;

    const evalUrl = `http://127.0.0.1:${profile.debugPort}/api/eval?code=` + encodeURIComponent(code);
    http.get(evalUrl, (cRes) => {
      let d = "";
      cRes.setEncoding('utf8');
      cRes.on("data", c => d += c);
      cRes.on("end", () => {
        try {
          const parsed = JSON.parse(d);
          sendJSON({ success: true, data: parsed.result || {} });
        } catch(e) {
          sendJSON({ success: false, error: e.message }, 500);
        }
      });
    }).on('error', err => sendJSON({ success: false, error: err.message }, 502));
    return;
  }

  // GET /api/profiles/:id/character (Full character sheet, equipment slots, bag items, and stats)
  if (req.method === "GET" && pathname.match(/^\/api\/profiles\/[^/]+\/character$/)) {
    const id = pathname.split("/")[3];
    const profiles = loadProfiles();
    const profile = profiles.find(p => p.id === id);
    if (!profile || !profile.debugPort) return sendJSON({ success: false, error: "Profile offline" }, 400);

    const evalCode = `(typeof window.getCharacterFullDetail === 'function') ? window.getCharacterFullDetail() : { success: false, error: 'Character data not initialized' }`;
    const r = await evalProfilePort(profile.debugPort, evalCode, 5000);
    if (r && r.result && r.result.success) {
      return sendJSON({ success: true, profileId: id, profileName: profile.name, ...r.result });
    }
    return sendJSON({ success: false, error: r?.error || "Cannot retrieve character detail" }, 500);
  }

  // POST /api/profiles/:id/equip (Equip item from bag into specific slot or auto)
  if (req.method === "POST" && pathname.match(/^\/api\/profiles\/[^/]+\/equip$/)) {
    const id = pathname.split("/")[3];
    const profiles = loadProfiles();
    const profile = profiles.find(p => p.id === id);
    if (!profile || !profile.debugPort) return sendJSON({ success: false, error: "Profile offline" }, 400);

    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const bagSlot = payload.bagSlot !== undefined ? payload.bagSlot : payload.slot;
        const targetSlot = payload.targetSlot || payload.to || null;
        if (bagSlot === undefined || bagSlot === null) {
          return sendJSON({ success: false, error: "Missing bagSlot" }, 400);
        }
        const evalCode = `(typeof window.executeEquipItem === 'function') ? window.executeEquipItem(${JSON.stringify(bagSlot)}, ${JSON.stringify(targetSlot)}) : { success: false, error: 'Equip function unavailable' }`;
        const r = await evalProfilePort(profile.debugPort, evalCode, 4000);
        sendJSON(r?.result || { success: true });
      } catch (e) {
        sendJSON({ success: false, error: e.message }, 400);
      }
    });
    return;
  }

  // POST /api/profiles/:id/unequip (Unequip worn item from slot)
  if (req.method === "POST" && pathname.match(/^\/api\/profiles\/[^/]+\/unequip$/)) {
    const id = pathname.split("/")[3];
    const profiles = loadProfiles();
    const profile = profiles.find(p => p.id === id);
    if (!profile || !profile.debugPort) return sendJSON({ success: false, error: "Profile offline" }, 400);

    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const slotKey = payload.slot || payload.slotKey;
        if (!slotKey) {
          return sendJSON({ success: false, error: "Missing slotKey" }, 400);
        }
        const evalCode = `(typeof window.executeUnequipItem === 'function') ? window.executeUnequipItem(${JSON.stringify(slotKey)}) : { success: false, error: 'Unequip function unavailable' }`;
        const r = await evalProfilePort(profile.debugPort, evalCode, 4000);
        sendJSON(r?.result || { success: true });
      } catch (e) {
        sendJSON({ success: false, error: e.message }, 400);
      }
    });
    return;
  }

  // POST /api/profiles/:id/stat-up (Add status points to STR/AGI/VIT/INT/DEX/LUK)
  if (req.method === "POST" && pathname.match(/^\/api\/profiles\/[^/]+\/stat-up$/)) {
    const id = pathname.split("/")[3];
    const profiles = loadProfiles();
    const profile = profiles.find(p => p.id === id);
    if (!profile || !profile.debugPort) return sendJSON({ success: false, error: "Profile offline" }, 400);

    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const statKey = payload.stat;
        const count = payload.count || payload.n || 1;
        if (!statKey) {
          return sendJSON({ success: false, error: "Missing stat" }, 400);
        }
        const evalCode = `(typeof window.executeAddStat === 'function') ? window.executeAddStat(${JSON.stringify(statKey)}, ${Number(count)}) : { success: false, error: 'Stat-up function unavailable' }`;
        const r = await evalProfilePort(profile.debugPort, evalCode, 4000);
        sendJSON(r?.result || { success: true });
      } catch (e) {
        sendJSON({ success: false, error: e.message }, 400);
      }
    });
    return;
  }

  // POST /api/profiles/:id/client-action (Proxy config changes & actions from Web HUD / Central Menu)
  if (req.method === "POST" && pathname.match(/^\/api\/profiles\/[^/]+\/client-action$/)) {
    const id = decodeURIComponent(pathname.split("/")[3]);
    const profiles = loadProfiles();

    if (id !== "__central__") {
      const profile = profiles.find(p => p.id === id);
      if (!profile || !profile.debugPort) return sendJSON({ success: false, error: "Profile offline" }, 400);
    }

    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const codeToRun = buildClientActionEvalCode(payload);

        if (id === "__central__") {
          const targetSet = Array.isArray(payload.targetProfileIds) && payload.targetProfileIds.length > 0
            ? new Set(payload.targetProfileIds.map(String))
            : null;
          const targets = profiles.filter(p => p.debugPort && (!targetSet || targetSet.has(String(p.id))));
          if (targets.length === 0) {
            return sendJSON({ success: false, error: "ไม่มีจอเกมที่กำลังออนไลน์", updatedCount: 0, totalOnline: 0 }, 400);
          }
          const results = await Promise.allSettled(targets.map(p =>
            enqueueProfileClientAction(p.id, () => evalProfilePort(p.debugPort, codeToRun, 15000))
          ));
          const okCount = results.filter(r =>
            r.status === "fulfilled" && r.value && !(r.value.success === false && !("result" in r.value))
          ).length;
          return sendJSON({
            success: okCount > 0,
            updatedCount: okCount,
            totalOnline: targets.length
          });
        }

        const profile = profiles.find(p => p.id === id);
        if (!profile || !profile.debugPort) return sendJSON({ success: false, error: "Profile offline" }, 400);

        // POST: configs (import-config, whitelists, rules) are far too long for a URL once Thai text is encoded
        const r = await enqueueProfileClientAction(profile.id, () => evalProfilePort(profile.debugPort, codeToRun, 15000));
        if (r && r.success === false && !('result' in r)) return sendJSON({ success: false, error: r.error || 'สั่งงานจอเกมไม่สำเร็จ' }, 502);
        sendJSON({ success: true, result: r });
      } catch (err) {
        sendJSON({ success: false, error: err.message }, 400);
      }
    });
    return;
  }

  
  // ==========================================
  // ZENY CONSOLIDATION & MARKET CLAIM API
  // ==========================================

  // POST /api/market/claim-all (Claim all items & zeny from market across all active sessions)
  if (req.method === "POST" && pathname === "/api/market/claim-all") {
    (async () => {
      const profiles = loadProfiles();
      const results = [];
      for (const p of profiles) {
        if (p.debugPort) {
          try {
            const evalCode = `(async () => {
              if (typeof window.claimAllMarket === 'function') {
                return await window.claimAllMarket();
              }
              const r = (typeof window.getGameRoom === 'function') ? window.getGameRoom() : window.__gameRoom;
              if (r && r.connection?.isOpen) {
                r.send('market', { op: 'collect_all' });
                r.send('market', { op: 'mine' });
                return { success: true };
              }
              return { success: false, error: 'No room connection' };
            })()`;
            const r = await evalProfilePort(p.debugPort, evalCode, 3000);
            results.push({ id: p.id, name: p.name, port: p.debugPort, result: r });
          } catch(e) {
            results.push({ id: p.id, name: p.name, port: p.debugPort, error: e.message });
          }
        }
      }
      return sendJSON({ success: true, results });
    })();
    return;
  }

  // GET / POST /api/consolidation/item-settings
  if (pathname === "/api/consolidation/item-settings") {
    if (req.method === "GET") {
      return sendJSON({ success: true, settings: loadConsolidationItemSettings() });
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body || "{}");
          const saved = saveConsolidationItemSettings(payload);
          const syncRes = await syncStashTradeConfigToAllClients(saved);
          return sendJSON({
            success: true,
            settings: saved,
            syncedClients: syncRes.syncedCount,
            totalChecked: syncRes.totalChecked
          });
        } catch (e) {
          return sendJSON({ success: false, error: e.message }, 400);
        }
      });
      return;
    }
  }

  // POST /api/consolidation/start
  if (req.method === "POST" && pathname === "/api/consolidation/start") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const receiverId = payload.receiverProfileId;
        const senderIds = Array.isArray(payload.senderProfileIds) ? payload.senderProfileIds : [];
        const keepZeny = parseInt(payload.keepZeny) || 0;

        if (!receiverId) {
          return sendJSON({ success: false, error: "กรุณาระบุโปรไฟล์ตัวรับเงิน (receiverProfileId)" }, 400);
        }
        if (senderIds.length === 0) {
          return sendJSON({ success: false, error: "กรุณาเลือกจอที่จะโอนเงินอย่างน้อย 1 จอ" }, 400);
        }
        if (consolidationState.running) {
          return sendJSON({ success: false, error: "ระบบกำลังดำเนินการรวมเงินอยู่แล้วในขณะนี้" }, 409);
        }

        // Persist item trade preferences if supplied
        let itemCfg = loadConsolidationItemSettings();
        if (typeof payload.tradeOnConsolidate === "boolean" || Array.isArray(payload.items) || typeof payload.storeOnlyEnabled === "boolean") {
          itemCfg = saveConsolidationItemSettings({
            storeOnlyEnabled: typeof payload.storeOnlyEnabled === "boolean" ? payload.storeOnlyEnabled : itemCfg.storeOnlyEnabled,
            tradeOnConsolidate: typeof payload.tradeOnConsolidate === "boolean" ? payload.tradeOnConsolidate : itemCfg.tradeOnConsolidate,
            items: payload.items !== undefined ? payload.items : itemCfg.items
          });
          syncStashTradeConfigToAllClients(itemCfg).catch(() => {});
        }

        // Verify that Receiver and Senders have active Premium (required for in-game Trade)
        const profiles = loadProfiles();
        const checkProfilePremium = async (pid) => {
          const p = profiles.find(x => x.id === pid);
          if (!p) return { ok: false, name: pid };
          if (p.debugPort) {
            const st = await queryClientState(p.debugPort);
            if (st && !st.error) {
              return { ok: !!st.hasPremium, name: st.charName || p.name };
            }
          }
          return { ok: Number(p.lastPremiumUntil || 0) > Date.now(), name: p.lastCharName || p.name };
        };

        const [recCheck, senderChecks] = await Promise.all([
          checkProfilePremium(receiverId),
          Promise.all(senderIds.map(async sid => ({ sid, ...(await checkProfilePremium(sid)) })))
        ]);
        if (!recCheck.ok) {
          return sendJSON({ success: false, error: `ตัวรับเงิน (${recCheck.name}) ไม่มีสถานะ 👑 Premium — ระบบเทรดรวมเงินเลือกได้เฉพาะตัวละครที่มี Premium เท่านั้น` }, 400);
        }

        const validSenders = senderChecks.filter(sc => sc.ok).map(sc => sc.sid);
        if (validSenders.length === 0) {
          return sendJSON({ success: false, error: "จอผู้โอนที่เลือกไม่มีสถานะ 👑 Premium (การเทรดโอนเงินใช้ได้เฉพาะตัวที่มี Premium เท่านั้น)" }, 400);
        }

        // Run in background
        runConsolidationWorkflow(receiverId, validSenders, keepZeny, {
          enabled: Boolean(itemCfg.tradeOnConsolidate),
          items: itemCfg.items
        });
        return sendJSON({ success: true, message: "เริ่มต้นกระบวนการรวมเงินเรียบร้อยแล้ว" });
      } catch(e) {
        return sendJSON({ success: false, error: e.message }, 400);
      }
    });
    return;
  }

  // GET /api/consolidation/status
  if (req.method === "GET" && pathname === "/api/consolidation/status") {
    return sendJSON({ success: true, ...consolidationState });
  }

  // POST /api/consolidation/stop
  if (req.method === "POST" && pathname === "/api/consolidation/stop") {
    consolidationAborted = true;
    consolidationState.running = false;
    consolidationState.status = 'stopped';
    addConsolidationLog('⏹️ ผู้ใช้สั่งหยุดกระบวนการรวมเงิน', 'warning');
    return sendJSON({ success: true, message: "ยกเลิกกระบวนการรวมเงินเรียบร้อย" });
  }

  // ==========================================
  // PLAN PROFILES & WORKFLOW BUILDER API
  // ==========================================

  // ==========================================
  // GAME INSTALLER & PATCHER API
  // ==========================================

  // GET /api/game-install/status
  if (req.method === "GET" && pathname === "/api/game-install/status") {
    const qPath = parsedUrl.searchParams.get("path");
    const status = installer.checkStatus(qPath);
    return sendJSON({ success: true, ...status });
  }

  // GET/POST /api/launch-mode ({ launchMode: 'electron' | 'browser', browserKind: 'chrome' | 'edge' })
  if (pathname === "/api/launch-mode") {
    if (req.method === "GET") {
      const st = installer.loadSettings() || {};
      const launchMode = st.launchMode || "browser";
      const browserKind = st.browserKind || "chrome";
      return sendJSON({
        success: true,
        launchMode,
        browserKind,
        chrome: !!browserMode.findBrowser("chrome"),
        browserPath: browserMode.findBrowser(browserKind)
      });
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        try {
          const data = JSON.parse(body || "{}");
          const st = installer.loadSettings() || {};
          if (["electron", "browser"].includes(data.launchMode)) st.launchMode = data.launchMode;
          if (["chrome", "edge"].includes(data.browserKind)) st.browserKind = data.browserKind;
          installer.saveSettings(st);
          sendJSON({ success: true, launchMode: st.launchMode, browserKind: st.browserKind });
        } catch (e) { sendJSON({ success: false, error: e.message }, 400); }
      });
      return;
    }
  }

  // GET/POST /api/device-nickname ({ nickname: '...' })
  if (pathname === "/api/device-nickname") {
    if (req.method === "GET") {
      const defaultNick = getDefaultDeviceNickname();
      const currentNick = getEffectiveDeviceNickname();
      return sendJSON({ success: true, nickname: currentNick, defaultNickname: defaultNick });
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        try {
          const data = JSON.parse(body || "{}");
          const st = installer.loadSettings() || {};
          const cleaned = typeof data.nickname === 'string' ? data.nickname.trim().slice(0, 32) : '';
          st.deviceNickname = cleaned;
          installer.saveSettings(st);
          if (discordService && typeof discordService.setDeviceNickname === 'function') {
            discordService.setDeviceNickname(st.deviceNickname || getDefaultDeviceNickname());
          }
          sendJSON({ success: true, nickname: st.deviceNickname || getDefaultDeviceNickname(), defaultNickname: getDefaultDeviceNickname() });
        } catch (e) {
          sendJSON({ success: false, error: e.message }, 400);
        }
      });
      return;
    }
  }

  // POST /api/game-install/install
  if (req.method === "POST" && pathname === "/api/game-install/install") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        // Program Files installs need admin rights -> installScriptAsync asks once through UAC
        installer.installScriptAsync(payload.gamePath)
          .then(result => sendJSON(result, result.success ? 200 : 500))
          .catch(e => sendJSON({ success: false, error: e.message }, 500));
      } catch (e) {
        return sendJSON({ success: false, error: e.message }, 400);
      }
    });
    return;
  }

  // POST /api/game-install/restore
  if (req.method === "POST" && pathname === "/api/game-install/restore") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        const result = installer.restoreOriginal(payload.gamePath);
        return sendJSON(result, result.success ? 200 : 500);
      } catch (e) {
        return sendJSON({ success: false, error: e.message }, 400);
      }
    });
    return;
  }

  // POST /api/game-install/browse
  if (req.method === "POST" && pathname === "/api/game-install/browse") {
    installer.browseFolder().then((result) => {
      return sendJSON(result);
    }).catch((err) => {
      return sendJSON({ success: false, error: err.message }, 500);
    });
    return;
  }

  // GET /api/game-install/manager-update
  if (req.method === "GET" && pathname === "/api/game-install/manager-update") {
    installer.checkManagerOnlineUpdate().then((result) => {
      return sendJSON(result);
    }).catch((err) => {
      return sendJSON({ success: false, error: err.message }, 500);
    });
    return;
  }

    // GET /api/plan-profiles (List all plan profiles & assignments)
  // GET /api/game-items — the game's equipment (its /wiki-data, the same data as the in-game wiki) with icon
  // URLs, for the plan's gear set editor. Cached 6 h in memory and on disk (works offline from the last copy).
  if (req.method === "GET" && pathname === "/api/game-items") {
    try {
      sendJSON({ success: true, ...(await getGameItems()) });
    } catch (e) {
      sendJSON({ success: false, error: e.message }, 502);
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/plan-profiles") {
    const plansData = loadPlans();
    return sendJSON({
      success: true,
      profiles: plansData.profiles || [],
      assignments: plansData.assignments || {}
    });
  }

  // POST /api/plan-profiles (Create new plan profile)
  if (req.method === "POST" && pathname === "/api/plan-profiles") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const plansData = loadPlans();
        const newPlan = {
          id: "plan_" + Date.now(),
          name: (payload.name || "New Plan").trim(),
          description: payload.description || "",
          class1Target: payload.class1Target || "archer",
          class2Target: payload.class2Target || "hunter",
          // New plans: the player places "เปลี่ยนอาชีพ" actions (automatic change only when asked for)
          autoJobChange: payload.autoJobChange === true,
          autoUpgradeGems: payload.autoUpgradeGems !== false,
          eventPet: payload.eventPet !== false,
          class1JobLevel: planJobLevel(payload.class1JobLevel, 10),
          class2JobLevel: planJobLevel(payload.class2JobLevel, 50),
          skillBuild: payload.skillBuild || null,
          statBuild: payload.statBuild || null,
          gearPlan: payload.gearPlan || null,
          triggers: Array.isArray(payload.triggers) ? payload.triggers : [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        plansData.profiles.push(newPlan);
        savePlans(plansData);
        return sendJSON({ success: true, profile: newPlan });
      } catch (err) {
        return sendJSON({ success: false, error: err.message }, 400);
      }
    });
    return;
  }

  // PUT /api/plan-profiles/:id (Update plan profile)
  if (req.method === "PUT" && pathname.match(/^\/api\/plan-profiles\/[^/]+$/)) {
    const id = pathname.split("/")[3];
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const plansData = loadPlans();
        const idx = plansData.profiles.findIndex(p => p.id === id);
        if (idx === -1) return sendJSON({ success: false, error: "Plan profile not found" }, 404);

        plansData.profiles[idx] = {
          ...plansData.profiles[idx],
          name: payload.name !== undefined ? payload.name.trim() : plansData.profiles[idx].name,
          description: payload.description !== undefined ? payload.description : plansData.profiles[idx].description,
          class1Target: payload.class1Target !== undefined ? payload.class1Target : (plansData.profiles[idx].class1Target || "archer"),
          class2Target: payload.class2Target !== undefined ? payload.class2Target : (plansData.profiles[idx].class2Target || "hunter"),
          autoJobChange: typeof payload.autoJobChange === 'boolean' ? payload.autoJobChange : plansData.profiles[idx].autoJobChange,
          autoUpgradeGems: typeof payload.autoUpgradeGems === 'boolean' ? payload.autoUpgradeGems : plansData.profiles[idx].autoUpgradeGems,
          eventPet: typeof payload.eventPet === 'boolean' ? payload.eventPet : plansData.profiles[idx].eventPet,
          class1JobLevel: planJobLevel(payload.class1JobLevel !== undefined ? payload.class1JobLevel : plansData.profiles[idx].class1JobLevel, 10),
          class2JobLevel: planJobLevel(payload.class2JobLevel !== undefined ? payload.class2JobLevel : plansData.profiles[idx].class2JobLevel, 50),
          skillBuild: payload.skillBuild !== undefined ? payload.skillBuild : plansData.profiles[idx].skillBuild,
          statBuild: payload.statBuild !== undefined ? payload.statBuild : plansData.profiles[idx].statBuild,
          gearPlan: payload.gearPlan !== undefined ? payload.gearPlan : plansData.profiles[idx].gearPlan,
          triggers: Array.isArray(payload.triggers) ? payload.triggers : plansData.profiles[idx].triggers,
          updatedAt: Date.now()
        };

        savePlans(plansData);

        // Send the edited plan to clients using it (their Plan Script on/off switch is left as is)
        planSync.pushToAssigned(plansData.profiles[idx]).catch(() => {});

        return sendJSON({ success: true, profile: plansData.profiles[idx] });
      } catch (err) {
        return sendJSON({ success: false, error: err.message }, 400);
      }
    });
    return;
  }

  // DELETE /api/plan-profiles/:id (Delete plan profile)
  if (req.method === "DELETE" && pathname.match(/^\/api\/plan-profiles\/[^/]+$/)) {
    const id = pathname.split("/")[3];
    const plansData = loadPlans();
    const idx = plansData.profiles.findIndex(p => p.id === id);
    if (idx === -1) return sendJSON({ success: false, error: "Plan profile not found" }, 404);

    const usedBy = planSync.assignedProfiles(id);
    plansData.profiles.splice(idx, 1);
    planSync.clearClients(usedBy).catch(() => {});
    // Remove assignments
    if (plansData.assignments) {
      Object.keys(plansData.assignments).forEach(cId => {
        if (plansData.assignments[cId] === id) delete plansData.assignments[cId];
      });
    }

    savePlans(plansData);
    return sendJSON({ success: true });
  }

  // POST /api/plan-profiles/:id/assign (Assign plan to a client card & sync live)
  if (req.method === "POST" && pathname.match(/^\/api\/plan-profiles\/[^/]+\/assign$/)) {
    const id = pathname.split("/")[3];
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        // One client (clientProfileId) or a picked list (clientProfileIds); unassignProfileIds = unticked clients
        const addIds = Array.isArray(payload.clientProfileIds) ? payload.clientProfileIds : (payload.clientProfileId ? [payload.clientProfileId] : []);
        const removeIds = Array.isArray(payload.unassignProfileIds) ? payload.unassignProfileIds : [];
        if (!addIds.length && !removeIds.length) return sendJSON({ success: false, error: "ยังไม่ได้เลือกจอเกม" }, 400);

        const plansData = loadPlans();
        const plan = plansData.profiles.find(p => p.id === id);
        if (!plan) return sendJSON({ success: false, error: "Plan profile not found" }, 404);
        if (!plansData.assignments) plansData.assignments = {};
        if (!plansData.pendingEnable) plansData.pendingEnable = {};
        const profiles = loadProfiles();
        const label = cid => { const p = profiles.find(x => x.id === cid); return p ? (p.name || cid) : cid; };

        // Send to each client now and switch Plan Script on; offline ones get it when they come online
        const live = [], later = [];
        for (const cid of addIds) {
          plansData.assignments[cid] = id;
          const synced = await planSync.push(profiles.find(p => p.id === cid), plan, true);
          if (synced) { delete plansData.pendingEnable[cid]; live.push(label(cid)); }
          else { plansData.pendingEnable[cid] = true; later.push(label(cid)); }
        }
        const removed = [];
        for (const cid of removeIds) {
          if (plansData.assignments[cid] !== id || addIds.includes(cid)) continue;
          delete plansData.assignments[cid];
          delete plansData.pendingEnable[cid];
          removed.push(cid);
        }
        savePlans(plansData);
        if (removed.length) await planSync.clearClients(removed.map(cid => profiles.find(p => p.id === cid)).filter(Boolean));

        const lines = [];
        if (live.length) lines.push(`ส่งแผนและเปิด Plan Script แล้ว: ${live.join(', ')}`);
        if (later.length) lines.push(`จะเริ่มเมื่อเปิดจอ (ออฟไลน์อยู่): ${later.join(', ')}`);
        if (removed.length) lines.push(`ถอดแผนออกจาก: ${removed.map(label).join(', ')}`);
        return sendJSON({
          success: true,
          planId: id,
          clientProfileId: addIds[0],
          syncedLive: live.length > 0,
          message: `แผน "${plan.name}"\n` + lines.join('\n')
        });
      } catch (err) {
        return sendJSON({ success: false, error: err.message }, 400);
      }
    });
    return;
  }

  // POST /api/plan-profiles/import (Import plans from JSON)
  if (req.method === "POST" && pathname === "/api/plan-profiles/import") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const plansData = loadPlans();
        let importedList = [];
        if (Array.isArray(payload)) {
          importedList = payload;
        } else if (payload && Array.isArray(payload.profiles)) {
          importedList = payload.profiles;
        } else if (payload && payload.name) {
          importedList = [payload];
        }

        let addedCount = 0;
        importedList.forEach(p => {
          if (p && p.name) {
            plansData.profiles.push({
              id: "plan_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
              name: p.name.trim(),
              description: p.description || "",
              class1Target: p.class1Target || "archer",
              class2Target: p.class2Target || "hunter",
              autoJobChange: typeof p.autoJobChange === 'boolean' ? p.autoJobChange : undefined,
              autoUpgradeGems: p.autoUpgradeGems !== false,
              eventPet: p.eventPet !== false,
              class1JobLevel: planJobLevel(p.class1JobLevel, 10),
              class2JobLevel: planJobLevel(p.class2JobLevel, 50),
              skillBuild: p.skillBuild || null,
              statBuild: p.statBuild || null,
              gearPlan: p.gearPlan || null,
              triggers: Array.isArray(p.triggers) ? p.triggers : [],
              createdAt: Date.now(),
              updatedAt: Date.now()
            });
            addedCount++;
          }
        });

        savePlans(plansData);
        return sendJSON({
          success: true,
          addedCount,
          profiles: plansData.profiles,
          message: `นำเข้า Plan Profiles สำเร็จ ${addedCount} รายการ!`
        });
      } catch (err) {
        return sendJSON({ success: false, error: err.message }, 400);
      }
    });
    return;
  }

  // 9. GET /api/plans/:id
  if (req.method === "GET" && pathname.match(/^\/api\/plans\/[^/]+$/)) {
    const id = pathname.split("/")[3];
    const plans = loadPlans();
    return sendJSON({ success: true, plan: plans[id] || null });
  }

  // 10. POST /api/plans/:id
  if (req.method === "POST" && pathname.match(/^\/api\/plans\/[^/]+$/)) {
    const id = pathname.split("/")[3];
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const plan = JSON.parse(body);
        const plans = loadPlans();
        plans[id] = plan;
        savePlans(plans);
        return sendJSON({ success: true, plan });
      } catch (err) {
        return sendJSON({ success: false, error: err.message }, 400);
      }
    });
    return;
  }

  // 11. POST /api/plans/:id/apply
  if (req.method === "POST" && pathname.match(/^\/api\/plans\/[^/]+\/apply$/)) {
    const id = pathname.split("/")[3];
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const plan = JSON.parse(body);
        const plans = loadPlans();
        plans[id] = plan;
        savePlans(plans);

        const profiles = loadProfiles();
        const profile = profiles.find(p => p.id === id);
        if (!profile || !profile.debugPort) {
          return sendJSON({ success: true, warning: "Profile saved, but client debugPort not found", plan });
        }

        const code = `
          if (typeof window.__applyScriptPlan === 'function') {
            window.__applyScriptPlan(${JSON.stringify(plan)});
          } else {
            window.__currentScriptPlan = ${JSON.stringify(plan)};
            console.log('[PmheeAether Plan] Plan loaded:', ${JSON.stringify(plan.name)});
          }
        `;
        
        try {
          await evalProfilePort(profile.debugPort, code, 5000);
        } catch (e) {}

        return sendJSON({ success: true, message: "Plan applied successfully", plan });
      } catch (err) {
        return sendJSON({ success: false, error: err.message }, 400);
      }
    });
    return;
  }

  
  // ==========================================
  // PRESETS & PROFILE SAVE LIST API (CENTRAL PRESET LIBRARY)
  // ==========================================

  // GET /api/presets (List all presets)
  if (req.method === "GET" && pathname === "/api/presets") {
    return sendJSON({ success: true, presets: loadPresets() });
  }

  // GET /api/presets/export (Export all presets as downloadable JSON)
  if (req.method === "GET" && pathname === "/api/presets/export") {
    const presets = loadPresets();
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="aetheria_profiles_presets.json"'
    });
    return res.end(JSON.stringify(presets, null, 2));
  }

  // POST /api/presets (Create or update single preset)
  if (req.method === "POST" && pathname === "/api/presets") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const presets = loadPresets();
        const id = data.id || ("preset_" + Date.now());
        const existingIdx = presets.findIndex(p => p.id === id);

        // Sanitize auth config (strictly exclude username & password)
        const safeCfg = Object.assign({}, data.config || {});
        if (safeCfg.authConfig) {
          safeCfg.authConfig = {
            enabled: !!safeCfg.authConfig.enabled,
            autoResumeBot: safeCfg.authConfig.autoResumeBot !== false,
            charName: safeCfg.authConfig.charName || ''
          };
        }

        const presetItem = {
          id: id,
          name: (data.name || "โปรไฟล์ส่วนกลาง").trim(),
          description: data.description || "",
          updatedAt: Date.now(),
          createdAt: existingIdx >= 0 ? presets[existingIdx].createdAt : Date.now(),
          config: safeCfg
        };

        if (existingIdx >= 0) {
          presets[existingIdx] = presetItem;
        } else {
          presets.unshift(presetItem);
        }
        savePresets(presets);
        return sendJSON({ success: true, preset: presetItem });
      } catch (err) {
        return sendJSON({ success: false, error: err.message }, 400);
      }
    });
    return;
  }

  // POST /api/presets/import (Import 1 or multiple profiles/presets)
  if (req.method === "POST" && pathname === "/api/presets/import") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        let payload = JSON.parse(body);
        let itemsToImport = [];

        if (Array.isArray(payload)) {
          itemsToImport = payload;
        } else if (Array.isArray(payload.presets)) {
          itemsToImport = payload.presets;
        } else if (payload.config) {
          itemsToImport = [payload];
        } else if (payload.sellConfig || payload.archerConfig) {
          // Direct exported config object
          itemsToImport = [{
            name: payload.name || "โปรไฟล์นำเข้าส่วนกลาง",
            description: payload.description || "นำเข้าจากการตั้งค่าเดี่ยว",
            config: payload
          }];
        }

        if (itemsToImport.length === 0) {
          return sendJSON({ success: false, error: "ไม่พบข้อมูลโปรไฟล์ที่สามารถนำเข้าได้" }, 400);
        }

        const presets = loadPresets();
        let importedCount = 0;

        itemsToImport.forEach(item => {
          const cfg = item.config || item;
          // Sanitize
          const safeCfg = Object.assign({}, cfg);
          if (safeCfg.authConfig) {
            safeCfg.authConfig = {
              enabled: !!safeCfg.authConfig.enabled,
              autoResumeBot: safeCfg.authConfig.autoResumeBot !== false,
              charName: safeCfg.authConfig.charName || ''
            };
          }

          const newPreset = {
            id: "preset_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
            name: (item.name || payload.name || "โปรไฟล์นำเข้าส่วนกลาง").trim(),
            description: item.description || "นำเข้าเมื่อ " + new Date().toLocaleString('th-TH'),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            config: safeCfg
          };
          presets.unshift(newPreset);
          importedCount++;
        });

        savePresets(presets);
        return sendJSON({ success: true, count: importedCount, presets });
      } catch (err) {
        return sendJSON({ success: false, error: err.message }, 400);
      }
    });
    return;
  }

  // DELETE /api/presets/:id (Delete preset)
  if (req.method === "DELETE" && pathname.match(/^\/api\/presets\/[^/]+$/)) {
    const id = pathname.split("/")[3];
    let presets = loadPresets();
    presets = presets.filter(p => p.id !== id);
    savePresets(presets);
    return sendJSON({ success: true });
  }

  // POST /api/presets/:id/apply (Copy to specified profiles)
  if (req.method === "POST" && pathname.match(/^\/api\/presets\/[^/]+\/apply$/)) {
    const id = pathname.split("/")[3];
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        const targetIds = Array.isArray(data.targetProfileIds) ? data.targetProfileIds : [];
        const presets = loadPresets();
        const preset = presets.find(p => p.id === id);
        if (!preset) return sendJSON({ success: false, error: "Preset not found" }, 404);

        const profiles = loadProfiles();
        const appliedProfiles = [];
        const failedProfiles = [];
        const presetConfig = JSON.parse(JSON.stringify(preset.config || {}));
        if (presetConfig.authConfig) {
          delete presetConfig.authConfig.username;
          delete presetConfig.authConfig.password;
          delete presetConfig.authConfig.charName;
        }

        for (const pId of targetIds) {
          const profile = profiles.find(p => p.id === pId);
          if (!profile) continue;

          // 1. Update targetMap in profile
          if (preset.config?.targetMap) {
            profile.targetMap = preset.config.targetMap;
          }
          // 2. Send importAllBotSettings to the running game (POST: the config is too long for a URL)
          if (profile.debugPort) {
            const codeToRun = `(() => {
              if (typeof window.importAllBotSettings === 'function') {
                try {
                  if (typeof window.freeBotLocalStorageSpace === 'function') window.freeBotLocalStorageSpace(true);
                  const s = Object.getPrototypeOf(window.localStorage);
                  const len = window.localStorage.length;
                  const drop = [];
                  for (let i = 0; i < len; i++) {
                    const k = s.key.call(window.localStorage, i);
                    if (k && (k.startsWith('webgame.chat.') || k === 'pelican_item_catalog' || k === 'pelican_latest_inventory' || k === 'pelican_icon_manifest' || /__(?:icon_manifest|item_catalog|latest_inventory|packet_logs|last_weight)$/.test(k))) drop.push(k);
                  }
                  drop.forEach(k => s.removeItem.call(window.localStorage, k));
                } catch (e) {}
                const res = window.importAllBotSettings(${JSON.stringify(presetConfig)});
                try {
                  if (window.__planScriptEnabled && window.__currentScriptPlan && typeof window.planMapForNow === 'function') {
                    localStorage.removeItem('pelican_plan_manual_map');
                    const planMap = window.planMapForNow();
                    if (planMap && !/เมืองหลวง|โซลเฮเวน|ตลาดคาราวาน/.test(window.__targetFarmMap || '')) {
                      if (typeof window.setTargetFarmMap === 'function') window.setTargetFarmMap(planMap, Boolean(window.__isBotRunning));
                      else window.__targetFarmMap = planMap;
                    }
                  }
                } catch (e) {}
                return Object.assign({}, res, { effectiveTargetMap: window.__targetFarmMap || null });
              } else {
                return { success: false, error: 'importAllBotSettings not ready' };
              }
            })()`;

            const r = await evalProfilePort(profile.debugPort, codeToRun, 8000);
            if (r && r.success && r.result && r.result.success) {
              if (r.result.effectiveTargetMap && !/เมืองหลวง|โซลเฮเวน|ตลาดคาราวาน/.test(r.result.effectiveTargetMap)) {
                profile.targetMap = r.result.effectiveTargetMap;
              }
              appliedProfiles.push(profile.name || profile.id);
            }
            else failedProfiles.push(`${profile.name || profile.id} (${(r && r.result && r.result.error) || (r && r.error) || 'จอออฟไลน์'})`);
          } else {
            failedProfiles.push(`${profile.name || profile.id} (จอออฟไลน์)`);
          }
        }

        saveProfiles(profiles);
        return sendJSON({
          success: appliedProfiles.length > 0 || failedProfiles.length === 0,
          appliedCount: appliedProfiles.length,
          appliedProfiles: appliedProfiles,
          failedProfiles,
          message: `คัดลอกการตั้งค่า "${preset.name}" ไปยัง ${appliedProfiles.length} จอเรียบร้อยแล้ว`
            + (failedProfiles.length ? `\n\n⚠️ ส่งไม่สำเร็จ ${failedProfiles.length} จอ (ต้องเปิดจอเกมไว้ก่อน):\n• ${failedProfiles.join('\n• ')}` : ''),
          error: appliedProfiles.length ? undefined : `ส่งการตั้งค่าไม่สำเร็จ — ต้องเปิดจอเกมไว้ก่อน:\n• ${failedProfiles.join('\n• ')}`
        });
      } catch (err) {
        return sendJSON({ success: false, error: err.message }, 400);
      }
    });
    return;
  }

  // POST /api/profiles/:id/save-as-preset (Save current profile config as a preset)
  if (req.method === "POST" && pathname.match(/^\/api\/profiles\/[^/]+\/save-as-preset$/)) {
    const id = pathname.split("/")[3];
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        const profiles = loadProfiles();
        const profile = profiles.find(p => p.id === id);
        if (!profile) return sendJSON({ success: false, error: "Profile not found" }, 404);

        // Read the client's real settings (POST eval, generous timeout). Never save made-up defaults:
        // a preset with only a map and basic sell settings looked fine but copied nothing useful.
        if (!profile.debugPort) return sendJSON({ success: false, error: `จอ "${profile.name}" ออฟไลน์ — เปิดจอเกมนี้ก่อนแล้วค่อยบันทึก` }, 400);
        const r = await evalProfilePort(profile.debugPort, "typeof window.exportAllBotSettings === 'function' ? window.exportAllBotSettings() : null", 10000);
        const finalConfig = r && r.success && r.result && r.result.data;
        if (!finalConfig || typeof finalConfig !== 'object' || !finalConfig.sellConfig) {
          return sendJSON({ success: false, error: `อ่านการตั้งค่าจากจอ "${profile.name}" ไม่สำเร็จ (${(r && r.error) || 'บอทยังโหลดไม่เสร็จ'}) — รอให้จอโหลดเสร็จแล้วลองใหม่` }, 502);
        }

        const presets = loadPresets();
        const newPreset = {
          id: "preset_" + Date.now(),
          name: (data.name || (`เซฟจาก ${profile.name}`)).trim(),
          description: data.description || (`ดึงการตั้งค่าจากโปรไฟล์ "${profile.name}" เมื่อ ` + new Date().toLocaleString('th-TH')),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          config: finalConfig
        };
        presets.unshift(newPreset);
        savePresets(presets);

        return sendJSON({ success: true, preset: newPreset });
      } catch (err) {
        return sendJSON({ success: false, error: err.message }, 400);
      }
    });
    return;
  }

  // ==========================================

  // ==========================================
  // ADMIN MANAGER FLEET API
  // ==========================================

  // GET /api/admin/peer-status — queried by other Managers on the network
  if (req.method === "GET" && pathname === "/api/admin/peer-status") {
    const allProfiles = loadProfiles();
    const openProfiles = allProfiles.filter(p => browserMode.isOpen(p.id) || (runningProcesses[p.id] && isProcessAlive(runningProcesses[p.id].pid))).map(p => ({
      id: p.id,
      name: p.name,
      charName: p.liveState?.charName || p.lastCharName || p.name,
      baseLv: p.liveState?.baseLv || null,
      jobLv: p.liveState?.jobLv || null,
      currentMap: p.liveState?.currentMap || null,
      status: p.liveState?.status || 'Online',
      debugPort: p.debugPort
    }));
    return sendJSON({
      success: true,
      nickname: getEffectiveDeviceNickname(),
      hostname: os.hostname(),
      onlineCount: openProfiles.length,
      profiles: openProfiles,
      port: PORT,
      timestamp: Date.now()
    });
  }

  // POST /api/admin/remote-stop — executed when remote admin orders stop
  if (req.method === "POST" && pathname === "/api/admin/remote-stop") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        if (payload.mode === "single" && payload.profileId) {
          await stopSingleProfile(payload.profileId);
          return sendJSON({ success: true, stopped: payload.profileId });
        }
        await stopAllProfiles();
        return sendJSON({ success: true, stopped: "all" });
      } catch (err) {
        return sendJSON({ success: false, error: err.message }, 500);
      }
    });
    return;
  }

  // Serve or proxy game icon art assets
  if (req.method === "GET" && pathname.startsWith("/art/icons/")) {
    const rel = pathname.slice("/art/icons/".length);
    const safeRel = path.normalize(rel).replace(/^(\.\.[\/\\])+/, "");
    const localPath = path.join(__dirname, "data", "icons", safeRel);
    if (fs.existsSync(localPath)) {
      const ext = path.extname(localPath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": ext === ".webp" ? "image/webp" : (ext === ".png" ? "image/png" : "application/octet-stream"),
        "Cache-Control": "public, max-age=86400"
      });
      return fs.createReadStream(localPath).pipe(res);
    }
    const remoteUrl = "https://www.aetheria-online.in.th/art/icons/" + safeRel.replace(/\\/g, "/");
    https.get(remoteUrl, (pRes) => {
      if (pRes.statusCode === 200) {
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        const fileStream = fs.createWriteStream(localPath);
        pRes.pipe(fileStream);
        res.writeHead(200, {
          "Content-Type": pRes.headers["content-type"] || "image/webp",
          "Cache-Control": "public, max-age=86400"
        });
        pRes.pipe(res);
      } else {
        res.writeHead(pRes.statusCode, { "Content-Type": "text/plain" });
        res.end("Icon Not Found");
      }
    }).on("error", () => {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad Gateway");
    });
    return;
  }

  // STATIC FILE SERVING
  // ==========================================
  let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return sendJSON({ success: false }, 403);
  const ext = path.extname(filePath).toLowerCase();

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(PUBLIC_DIR, "index.html");
    }
    const finalExt = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[finalExt] || "application/octet-stream";

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
      } else {
        res.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0"
        });
        res.end(content);
      }
    });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  scriptCoordinator.start();
  if(!TEST_INSTANCE)botAutoUpdater.start();
  if(!TEST_INSTANCE)managerUpdater.start();
  planSync.start();
  if(!TEST_INSTANCE)authSync.start();
  browserMode.start();
  if (!TEST_INSTANCE) {
    try {
      const spSettings = screenProxy.loadSettings();
      if (spSettings && spSettings.updatedAt == null) {
        screenProxy.saveSettings({ enabled: true, mode: "owner-queue" });
      }
    } catch (_) {}
    setTimeout(() => {
      if (isBrowserMode() && typeof browserMode.syncAssetCacheToOpenWindows === "function") {
        browserMode.syncAssetCacheToOpenWindows().catch(() => {});
      }
      if (screenProxy.isEnabled()) {
        syncScreenProxyForOpenProfiles().catch(() => {});
      }
    }, 2800);
    setInterval(() => {
      if (screenProxy.isEnabled()) {
        syncScreenProxyForOpenProfiles().catch(() => {});
      }
    }, 60000);
    setTimeout(() => syncStashTradeConfigToAllClients().catch(() => {}), 3500);
    setInterval(() => syncStashTradeConfigToAllClients().catch(() => {}), 25000);
  }
  console.log(`========================================================`);
  console.log(`🚀 [Pmhee Ma weaw] Running on http://127.0.0.1:${PORT}`);
  console.log(`📁 Sessions directory: ${SESSIONS_DIR}`);
  console.log(`🎮 Game executable: ${getGameExe()}`);
  console.log(`========================================================`);
});
