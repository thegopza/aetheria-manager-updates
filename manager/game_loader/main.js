// Aetheria Online for Windows + PmheeAether Auto-Injector & GitHub Auto-Update
const { app, BrowserWindow, Menu, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const https = require("https");

const GAME = "https://www.aetheria-online.in.th/play";
const SITE = new URL(GAME).host;

// URL สำหรับ Remote Auto-Update (เปลี่ยนเป็น URL ของคุณเมื่อสร้าง GitHub Repo เสร็จ)
const GITHUB_RAW_URL = "https://raw.githubusercontent.com/thegopza/aetheria-pelican-bot/main/bot.js";

// Parse multi-client arguments
const args = process.argv;
let profileName = "";
let debugPort = 49876;
let isMulti = false;
let userDataDir = "";
let protectedScriptMode = false;
const LOADER_PROTOCOL = 1;

for (const arg of args) {
  if(arg === "--pmhee-protected-script") {protectedScriptMode=true;isMulti=true;}
  else if (arg.startsWith("--user-data-dir=")) {
    userDataDir = arg.slice("--user-data-dir=".length);
    isMulti = true;
  } else if (arg.startsWith("--profile-name=")) {
    profileName = decodeURIComponent(arg.slice("--profile-name=".length));
    isMulti = true;
  } else if (arg.startsWith("--debug-port=")) {
    debugPort = parseInt(arg.slice("--debug-port=".length)) || 49876;
    isMulti = true;
  } else if (arg.includes("--multi-instance")) {
    isMulti = true;
  }
}

// Crucial: Set isolated userData directory for each profile before ready
if (userDataDir) {
  try {
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
    app.setPath("userData", userDataDir);
  } catch (e) {
    console.error("[PmheeAether Loader] Failed to set custom userData dir:", e);
  }
}

// Single instance lock only if running standalone without multi-client flag
if (!isMulti) {
  if (!app.requestSingleInstanceLock()) app.quit();
}

let win = null;
function open() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    // Small minimum so many clients fit on one screen (e.g. 6 windows = 3 x 2 at 640 x 520 on 1920 x 1080)
    minWidth: 320,
    minHeight: 240,
    backgroundColor: "#0e1424",
    title: profileName ? `Aetheria Online [${profileName}]` : "Aetheria Online",
    autoHideMenuBar: true,
    show: true,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });

  try { win.show(); win.focus(); } catch(e){}

  // Low-power while hidden or minimized: the bot stops drawing the game and frees its GPU memory
  // (window.setLowPowerMode in bot.js); audio is muted. A hidden window keeps document "visible"
  // because backgroundThrottling is off, so the page has to be told.
  const setLowPower = on => {
    try { win.webContents.setAudioMuted(on); } catch (e) {}
    win.webContents.executeJavaScript(`typeof window.setLowPowerMode === 'function' && window.setLowPowerMode(${on})`).catch(() => {});
  };
  const isAway = () => !win.isVisible() || win.isMinimized();
  win.on("hide", () => setLowPower(true));
  win.on("minimize", () => setLowPower(true));
  win.on("show", () => { if (!isAway()) setLowPower(false); });
  win.on("restore", () => { if (!isAway()) setLowPower(false); });
  // after a reload (bot updates) the bot starts in normal mode: tell it again once it has loaded
  win.webContents.on("did-finish-load", () => setTimeout(() => { if (isAway()) setLowPower(true); }, 8000));
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  let documentGeneration=0;
  // Inject PmheeAether Bot automatically upon game page load
  win.webContents.on("did-finish-load", async () => {
    const currentUrl = win.webContents.getURL();
    let parsed;try{parsed=new URL(currentUrl);}catch(_){return;}
    if(parsed.origin!==new URL(GAME).origin||parsed.pathname!=="/play")return;
    const generation=++documentGeneration;
    let documentId;try{documentId=await win.webContents.executeJavaScript('String(performance.timeOrigin)');}catch(_){return;}

    console.log("[PmheeAether Loader] 🎮 Detected game window! Preparing PmheeAether Bot injection...");

    // 1. Ensure msgpack-lite is available in the page window
    await win.webContents.executeJavaScript(`
      (function() {
        if (!window.msgpack) {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/msgpack-lite/0.1.26/msgpack.min.js';
          document.head.appendChild(s);
          console.log("[PmheeAether Loader] Injected msgpack-lite CDN");
        }
      })();
    `).catch(() => {});

    // Selected protected pilot waits for Manager POST bridge. No payload, private key or editable trust anchor is shipped here.
    if(protectedScriptMode) {
      console.log("[PmheeAether Loader] รอ Manager ตรวจสิทธิ์และส่งสคริปต์ให้จอทดลอง");
      return;
    }
    // 2. Load compatibility bot (Remote Auto-Update with local fallback)
    const localBotPath = path.join(process.resourcesPath, "bot.js");

    function injectScript(code) {
      if(generation!==documentGeneration)return;
      const guarded=`(() => { if(String(performance.timeOrigin)!==${JSON.stringify(documentId)} || window.__pelicanBotVersion || window.__pmPayloadInitialized || window.__pmScriptBootstrap || window.__pmLegacyInjectionAttempted || ('__isBotRunning' in window) || typeof window.startMasterBot==='function' || document.getElementById('pelican-hud') || typeof window.__getClientLiveState==='function') return {skipped:true}; window.__pmLegacyInjectionAttempted=true; (0,eval)(${JSON.stringify(code)}); return {attempted:true}; })()`;
      win.webContents.executeJavaScript(guarded)
        .then(result => console.log(result?.attempted ? "[PmheeAether Loader] 🚀 เริ่มโหลดสคริปต์แล้ว" : "[PmheeAether Loader] ข้ามการโหลดซ้ำหรือ document เก่า"))
        .catch(err => console.error("[PmheeAether Loader] ❌ Injection error:", err));
    }

    let fetched = false;
    // Check if remote URL is configured
    if (GITHUB_RAW_URL && true) {
      try {
        const req = https.get(GITHUB_RAW_URL + "?t=" + Date.now(), (res) => {
          if (res.statusCode === 200) {
            let data = "";
            res.setEncoding("utf8");   // Thai text split across chunks would otherwise become U+FFFD
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
              if (data.length > 1000) {
                fetched = true;
                console.log("[PmheeAether Loader] 🌐 Successfully updated latest bot from GitHub (" + data.length + " bytes)!");
                try { fs.writeFileSync(localBotPath, data, "utf8"); } catch(e) {}
                injectScript(data);
              }
            });
          }
        });
        req.on("error", () => {});
        req.setTimeout(2500, () => req.destroy());
      } catch(e) {}
    }

    // Local fallback after 1.5s
    setTimeout(() => {
      if (!fetched) {
        if (fs.existsSync(localBotPath)) {
          console.log("[PmheeAether Loader] 📂 Loading local bot.js from " + localBotPath);
          const code = fs.readFileSync(localBotPath, "utf8");
          injectScript(code);
        } else {
          console.warn("[PmheeAether Loader] ⚠️ Local bot.js not found at " + localBotPath);
        }
      }
    }, 1500);
  });

  // Links to other sites open in the player's browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).host !== SITE) shell.openExternal(url);
    else win.loadURL(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (e, url) => {
    const host = new URL(url).host;
    if (host !== SITE && !host.endsWith(".aetheria-online.in.th") && host !== "aetheria-online.in.th") {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // F11 full screen, F5 reload, Ctrl+Shift+I developer tools
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") win.setFullScreen(!win.isFullScreen());
    else if (input.key === "F5") win.webContents.reload();
    else if (input.key === "F12" || (input.key === "I" && input.control && input.shift)) win.webContents.toggleDevTools();
    else return;
    e.preventDefault();
  });

  // No connection: a short note and a retry
  win.webContents.on("did-fail-load", (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`<body style="background:#0e1424;color:#e5e7eb;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>เชื่อมต่อเกมไม่ได้</h2><p>ตรวจสอบอินเทอร์เน็ต แล้วลองใหม่ (${desc})</p><button onclick="location.href='${GAME}'" style="padding:10px 24px;font-size:16px;border-radius:8px;border:0;background:#fcd34d;cursor:pointer">ลองใหม่</button></div></body>`));
  });

  win.loadURL(GAME);
}

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

Menu.setApplicationMenu(null);

// ==========================================
// PmheeAether Local Debug & State API Server
// ==========================================
const http = require("http");
let DEBUG_PORT = debugPort || 49876;
let debugServer = null;

function startDebugServer(port = DEBUG_PORT) {
  DEBUG_PORT = port;
  if (debugServer) return;
  debugServer = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const parsedUrl = new URL(req.url, `http://localhost:${DEBUG_PORT}`);

    if(parsedUrl.pathname === "/api/loader-status" && req.method === "GET") {
      res.writeHead(200);return res.end(JSON.stringify({success:true,protocol:LOADER_PROTOCOL,protectedScriptMode,postEval:true,documentGuard:true}));
    }
    if (parsedUrl.pathname === "/api/eval") {
      const handleEval = (evalCode) => {
        if (!evalCode || !win || !win.webContents) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: "Missing code or game window" }));
        }
        win.webContents.executeJavaScript(evalCode)
          .then(result => {
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, result }));
          })
          .catch(err => {
            res.writeHead(500);
            res.end(JSON.stringify({ success: false, error: err.message }));
          });
      };

      if (req.method === "POST") {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            handleEval(data.code || body);
          } catch(e) {
            handleEval(body);
          }
        });
        return;
      }

      handleEval(parsedUrl.searchParams.get("code"));
      return;
    }

    
    if (parsedUrl.pathname === "/api/window") {
      if (!win) {
        res.writeHead(503);
        return res.end(JSON.stringify({ error: "Game window not ready" }));
      }
      const action = parsedUrl.searchParams.get("action");
      if (action === "hide") {
        win.hide();
      } else if (action === "show") {
        win.show();
      } else if (action === "minimize") {
        win.minimize();
      } else if (action === "restore") {
        win.restore();
      } else if (action === "top" || action === "focus") {
        if (win.isMinimized()) win.restore();
        win.setAlwaysOnTop(true);
        win.show();
        win.focus();
        setTimeout(() => { try { win.setAlwaysOnTop(false); } catch(e){} }, 500);
      } else if (action === "set-bounds") {
        const x = parseInt(parsedUrl.searchParams.get("x"));
        const y = parseInt(parsedUrl.searchParams.get("y"));
        const width = parseInt(parsedUrl.searchParams.get("w"));
        const height = parseInt(parsedUrl.searchParams.get("h"));
        if (!isNaN(x) && !isNaN(y) && !isNaN(width) && !isNaN(height)) {
          win.setBounds({ x, y, width, height });
        }
      }
      res.writeHead(200);
      return res.end(JSON.stringify({
        success: true,
        visible: win.isVisible(),
        minimized: win.isMinimized(),
        bounds: win.getBounds()
      }));
    }

    if (parsedUrl.pathname === "/api/state") {
      if (!win || !win.webContents) {
        res.writeHead(503);
        return res.end(JSON.stringify({ error: "Game window not ready" }));
      }
      win.webContents.executeJavaScript(`(typeof window.__getClientLiveState === 'function' ? window.__getClientLiveState() : (() => {
        const nameEl = document.querySelector('.hud-name');
        const classEl = document.querySelector('.hud-class');
        const levelsEl = document.querySelector('.hud-levels');
        const hpBar = document.querySelector('.bar-fill.bar-hp')?.closest('.bar');
        const hpText = hpBar?.querySelector('.bar-num')?.innerText?.trim() || null;
        const spBar = document.querySelector('.bar-fill.bar-sp')?.closest('.bar');
        const spText = spBar?.querySelector('.bar-num')?.innerText?.trim() || null;
        let hpCurrent = null, hpMax = null;
        if (hpText) {
          const m = hpText.match(/(\\d+)\\s*\\/\\s*(\\d+)/);
          if (m) { hpCurrent = Number(m[1]); hpMax = Number(m[2]); }
        }
        let spCurrent = null, spMax = null;
        if (spText) {
          const m = spText.match(/(\\d+)\\s*\\/\\s*(\\d+)/);
          if (m) { spCurrent = Number(m[1]); spMax = Number(m[2]); }
        }
        let mapName = null;
        const footer = document.querySelector('.minimap-footer');
        if (footer) {
          const spans = Array.from(footer.querySelectorAll('span, div')).map(s => s.innerText.trim()).filter(Boolean);
          const foundMap = spans.find(t => t.length > 2 && !t.includes(',') && !/^CH\\s*\\d+/i.test(t) && !/^\\d+%?$/.test(t));
          if (foundMap) mapName = foundMap;
        }
        if (!mapName && typeof window.getCurrentMapName === 'function') mapName = window.getCurrentMapName();
        const pos = window.__currentPos || { x: 0, y: 0, tileX: 0, tileY: 0 };
        const ammo = (typeof window.__currentAmmo === 'number') ? window.__currentAmmo : 0;
        const weightText = document.getElementById('p-quick-weight')?.innerText?.replace('⚖️', '')?.trim() || null;
        const hudState = document.getElementById('p-char-state')?.innerText?.trim();
        let activity = '🟢 ยืนรอ / แสตนด์บาย';
        if (window.__isRecovering) activity = '⚠️ กำลังชุบชีวิต';
        else if (window.__isShopping) activity = '🛒 ซื้อ/ขายของที่ NPC';
        else if (window.__isNavigating) activity = '🚶 กำลังเดินทาง';
        else if (window.__autoLoopEnabled || window.__isBotRunning) activity = '⚔️ Auto-Farm ทำงาน';
        else if (hudState) activity = hudState;
        return {
          charName: nameEl?.innerText?.trim() || window.__charName || null,
          charClass: classEl?.innerText?.trim() || 'Hunter',
          levels: levelsEl?.innerText?.trim() || '',
          hp: hpCurrent,
          hpMax: hpMax,
          hpText: hpText,
          sp: spCurrent,
          spMax: spMax,
          spText: spText,
          map: mapName || null,
          targetMap: window.__targetFarmMap || null,
          pos: pos,
          coords: pos.tileX ? (pos.tileX + ', ' + pos.tileY + ' (' + pos.x + ', ' + pos.y + ')') : (pos.x ? (pos.x + ', ' + pos.y) : '--'),
          ammo: ammo,
          weight: weightText,
          botStatus: activity,
          navigating: !!window.__isNavigating,
          recovering: !!window.__isRecovering,
          shopping: !!window.__isShopping,
          autoLoop: !!window.__autoLoopEnabled,
          isBotRunning: !!window.__isBotRunning,
          hasSocket: !!window.__gameSocket,
          hasInventory: !!window.__latestInventory,
          isOnline: true
        };
      })())`)
        .then(result => {
          res.writeHead(200);
          res.end(JSON.stringify(result, null, 2));
        })
        .catch(err => {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    if (parsedUrl.pathname === "/api/inventory") {
      if (!win || !win.webContents) {
        res.writeHead(503);
        return res.end(JSON.stringify({ error: "Game window not ready" }));
      }
      win.webContents.executeJavaScript(`window.dumpDeepInventory ? window.dumpDeepInventory() : { raw: window.__latestInventory }`)
        .then(result => {
          res.writeHead(200);
          res.end(JSON.stringify(result, null, 2));
        })
        .catch(err => {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    if (parsedUrl.pathname === "/api/packets") {
      if (!win || !win.webContents) {
        res.writeHead(503);
        return res.end(JSON.stringify({ error: "Game window not ready" }));
      }
      win.webContents.executeJavaScript(`(window.__packetLogs || []).slice(-30)`)
        .then(result => {
          res.writeHead(200);
          res.end(JSON.stringify(result, null, 2));
        })
        .catch(err => {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    res.writeHead(200);
    res.end(JSON.stringify({
      status: "ok",
      service: "PmheeAether In-Game Debug API",
      endpoints: ["/api/state", "/api/inventory", "/api/packets", "/api/eval?code=..."]
    }, null, 2));
  });

  // Port already taken (e.g. two windows with the same port): log it instead of crashing the game window
  debugServer.on("error", (e) => {
    console.error(`[PmheeAether Debug API] Cannot listen on 127.0.0.1:${DEBUG_PORT}: ${e.message}`);
  });
  debugServer.listen(DEBUG_PORT, "127.0.0.1", () => {
    console.log(`[PmheeAether Debug API] Listening on http://127.0.0.1:${DEBUG_PORT}`);
  });
}

app.whenReady().then(() => { open(); startDebugServer(debugPort); });
app.on("window-all-closed", () => app.quit());
