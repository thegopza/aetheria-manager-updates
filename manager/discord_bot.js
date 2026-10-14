// manager/discord_bot.js — Discord Webhook & Interactive Bot Integration for PmheeAether Manager
// Supports:
// 1. One-way Webhook notification (Rich Embed + Options)
// 2. Two-way Discord Bot (Gateway WebSocket + Interactive Buttons)
// 3. Human-in-the-loop: click button in Discord -> clicks answer in game window

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { createHumanCheckSolver } = require('./human_check_solver.js');
const IMAGE_BOARD_SOLVER_JS = (() => {
  try {
    const p = path.join(__dirname, 'image_board_solver.js');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  } catch (_) {
    return '';
  }
})();

function createDiscordBotService({ dataDir, loadProfiles, evalProfilePort, focusProfileWindow, humanCheckSolver, getDeviceNickname, onCaptchaSolved, stopProfile, stopAll, launchProfile, launchAll }) {
  const SETTINGS_FILE = path.join(dataDir, 'discord_settings.json');
  const solver = humanCheckSolver || createHumanCheckSolver({ dataDir });

  let currentDeviceNickname = '';
  function resolveDeviceNickname() {
    if (currentDeviceNickname && currentDeviceNickname.trim()) return currentDeviceNickname.trim();
    if (typeof getDeviceNickname === 'function') {
      try {
        const nick = getDeviceNickname();
        if (nick && typeof nick === 'string' && nick.trim()) return nick.trim();
      } catch (e) {}
    }
    return process.env.USERNAME || (typeof os.userInfo === 'function' ? os.userInfo()?.username : '') || os.hostname() || 'PmheeUser';
  }
  function setDeviceNickname(name) {
    currentDeviceNickname = typeof name === 'string' ? name.trim() : '';
  }

  const DEFAULT_DISCORD_SETTINGS = {
    enabled: true,
    webhookUrl: Buffer.from('aHR0cHM6Ly9kaXNjb3JkLmNvbS9hcGkvd2ViaG9va3MvMTU1ODg5NDY4MDg3NDQyNjM2OC9TcmlIVk1FTFpqQlZhU2YtYlpQS1NiQWpCaFByS3pabk42UWdrMUFwSW43RzkzcDZ0Wk9XRERWbXU4a2VGY1kzbjI4aQ==', 'base64').toString('utf8'),
    townWebhookUrl: '',
    botToken: Buffer.from('TVRVMU9Ea3dPREl6TVRRM09UTXpNamc0TkEuR2FQbUc3LldDR0ZkUTN1NzN4QnlGX0cyeTdYbGhndUxqcnp5QVJ2dF9BTXM0', 'base64').toString('utf8'),
    channelId: '1558894629728817222',
    wrongChannelId: '1559706567560007730',
    autoBringToFront: true,
    soundAlert: true,
    autoAnswer: true,
    answerDelayMs: 1800
  };

  // Load / Save Settings
  function loadSettings() {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        return {
          enabled: s.enabled !== undefined ? !!s.enabled : DEFAULT_DISCORD_SETTINGS.enabled,
          webhookUrl: (typeof s.webhookUrl === 'string' && s.webhookUrl.trim()) ? s.webhookUrl.trim() : DEFAULT_DISCORD_SETTINGS.webhookUrl,
          townWebhookUrl: (typeof s.townWebhookUrl === 'string' && s.townWebhookUrl.trim()) ? s.townWebhookUrl.trim() : (DEFAULT_DISCORD_SETTINGS.townWebhookUrl || ''),
          botToken: (typeof s.botToken === 'string' && s.botToken.trim()) ? s.botToken.trim() : DEFAULT_DISCORD_SETTINGS.botToken,
          channelId: (typeof s.channelId === 'string' && s.channelId.trim()) ? s.channelId.trim() : DEFAULT_DISCORD_SETTINGS.channelId,
          wrongChannelId: (typeof s.wrongChannelId === 'string' && s.wrongChannelId.trim()) ? s.wrongChannelId.trim() : DEFAULT_DISCORD_SETTINGS.wrongChannelId,
          autoBringToFront: s.autoBringToFront !== false,
          soundAlert: s.soundAlert !== false,
          autoAnswer: s.autoAnswer !== false,
          answerDelayMs: parseInt(s.answerDelayMs, 10) || DEFAULT_DISCORD_SETTINGS.answerDelayMs
        };
      }
    } catch (e) {}
    const isNodeTest = !!(process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test');
    return {
      ...DEFAULT_DISCORD_SETTINGS,
      enabled: isNodeTest ? false : DEFAULT_DISCORD_SETTINGS.enabled
    };
  }

  function saveSettings(settings) {
    try {
      const current = loadSettings();
      const updated = {
        ...current,
        ...settings,
        townWebhookUrl: settings.townWebhookUrl !== undefined ? String(settings.townWebhookUrl || '').trim() : current.townWebhookUrl,
        wrongChannelId: (typeof settings.wrongChannelId === 'string' && settings.wrongChannelId.trim()) ? settings.wrongChannelId.trim() : (current.wrongChannelId || DEFAULT_DISCORD_SETTINGS.wrongChannelId),
        autoAnswer: settings.autoAnswer !== false,
        answerDelayMs: Math.max(800, Math.min(10000, parseInt(settings.answerDelayMs, 10) || 1800))
      };
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf8');
      // If bot token changed or enabled state changed, reconnect gateway
      syncGatewayConnection();
      return true;
    } catch (e) {
      console.error('[Discord] Failed to save settings:', e);
      return false;
    }
  }

  // Active checks tracker: profileId -> { checkId, prompt, notifiedAt, messageId, options }
  const activeChecks = new Map();
  const recentNonces = new Map();
  const reportedWrongAttempts = new Map();
  const requestStateFile = path.join(dataDir, 'aetheria_request_state.json');
  function questionFingerprint(check) {
    return crypto.createHash('sha256').update(JSON.stringify([
      check.id ?? null, check.prompt, check.options || [], check.items || null
    ])).digest('hex');
  }
  function durableRequestId(profileId, check) {
    const fingerprint = questionFingerprint(check);
    let records = {};
    try { records = JSON.parse(fs.readFileSync(requestStateFile, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const previous = records[profileId];
    const now = Date.now();
    const same = previous?.fingerprint === fingerprint &&
      (check.id != null || now - previous.seenAt < 90000);
    const requestId = same ? previous.requestId : crypto.randomUUID();
    records[profileId] = { fingerprint, requestId, seenAt: now };
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(requestStateFile + '.tmp', JSON.stringify(records), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(requestStateFile + '.tmp', requestStateFile);
    return requestId;
  }

  // Gateway connection state
  let gatewayWs = null;
  let heartbeatTimer = null;
  let reconnectTimer = null;
  let lastSequence = null;
  let isConnecting = false;

  // HTTP helper for Discord REST API (supports JSON and multipart/form-data with file attachments)
  function discordRequest(endpoint, method = 'GET', body = null, token = null, fileAttachment = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint.startsWith('http') ? endpoint : `https://discord.com/api/v10${endpoint}`);
      const headers = {};
      if (token) {
        headers['Authorization'] = `Bot ${token}`;
      }

      let requestBody = null;
      if (fileAttachment && fileAttachment.buffer) {
        const boundary = '----PmheeAetherBoundary' + Date.now().toString(16);
        const parts = [];
        if (body) {
          parts.push(Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="payload_json"\r\n` +
            `Content-Type: application/json; charset=utf-8\r\n\r\n` +
            JSON.stringify(body) + `\r\n`
          ));
        }
        parts.push(Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="files[0]"; filename="${fileAttachment.filename || 'human_check.png'}"\r\n` +
          `Content-Type: ${fileAttachment.contentType || 'image/png'}\r\n\r\n`
        ));
        parts.push(fileAttachment.buffer);
        parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
        requestBody = Buffer.concat(parts);
        headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
        headers['Content-Length'] = requestBody.length;
      } else {
        headers['Content-Type'] = 'application/json';
        if (body) requestBody = Buffer.from(JSON.stringify(body), 'utf8');
      }

      try {
        const client = url.protocol === 'http:' ? http : https;
        const req = client.request(url, {
          method,
          headers,
          timeout: 15000
        }, (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            let parsed = null;
            try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ success: true, status: res.statusCode, data: parsed });
            } else {
              resolve({ success: false, status: res.statusCode, error: parsed });
            }
          });
        });

        req.on('error', (err) => resolve({ success: false, error: err.message }));
        req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });

        if (requestBody) req.write(requestBody);
        req.end();
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    });
  }

  // Answer human check in the game window (supports both .human-check-pick buttons and .human-check-board coordinate boards)
  async function answerCheckInGame(profileId, pickIndex, matchedName = '', expectedCheck = null, options = {}) {
    if (!Number.isInteger(pickIndex) || pickIndex < 0 || pickIndex > 5 || typeof profileId !== 'string') {
      return { success: false, error: 'ตัวเลือกหรือโปรไฟล์ไม่ถูกต้อง' };
    }
    const profiles = loadProfiles();
    const profile = profiles.find(p => p.id === profileId);
    if (!profile || !profile.debugPort) {
      return { success: false, error: `ไม่พบโปรไฟล์ ${profileId} หรือโปรไฟล์ออฟไลน์อยู่` };
    }

    const cleanName = String(matchedName || '');
    const isManual = Boolean(options && options.manual);
    const answeredBy = (options && typeof options.answeredBy === 'string' && options.answeredBy.trim()) ? options.answeredBy.trim() : null;
    const evalCode = `(() => {
      let clickAttempted = false;
      try {
        const hc = document.querySelector('.human-check');
        if (!hc) {
          const last = window.__lastHumanCheckSolved;
          if (last && Date.now() - (last.timestamp || 0) < 120000) {
            const slotLabel = Number.isInteger(last.slot) ? ('ช่องที่ ' + last.slot) : (Number.isInteger(last.pickIndex) && last.pickIndex >= 0 ? ('ข้อที่ ' + (last.pickIndex + 1)) : '');
            const byWho = last.manual && last.answeredBy ? ('ผู้เล่น ' + last.answeredBy) : 'บอท';
            return { success: false, alreadySolved: true, error: byWho + 'ตอบคำถามนี้ไปแล้ว' + (slotLabel ? (' (' + slotLabel + ')') : '') + ' หน้าต่างเช็คผู้เล่นจึงปิดไปแล้ว' };
          }
          return { success: false, error: 'ไม่พบหน้าต่างเช็คผู้เล่น (อาจปิดหรือตอบไปแล้ว)' };
        }
        const expected = ${JSON.stringify(expectedCheck)};
        const packet = window.__latestHumanCheck;
        if (expected) {
          const prompt = (hc.querySelector('.human-check-prompt')?.innerText || '').trim();
          if ((expected.prompt && prompt && prompt !== expected.prompt) || (expected.id != null && packet?.id != null && String(packet.id) !== String(expected.id))) {
            return { success: false, error: 'คำถามนี้หมดอายุหรือเปลี่ยนไปแล้ว' };
          }
        }
        const btns = Array.from(hc.querySelectorAll('.human-check-pick'));
        if (btns.length > 0) {
          const targetBtn = btns[${Number(pickIndex)}];
          if (!targetBtn) return { success: false, error: 'ไม่พบปุ่มตัวเลือกที่ ${pickIndex + 1}' };
          if (targetBtn.disabled) return { success: false, error: 'ปุ่มนี้ถูกกดไปแล้วหรือถูกปิดใช้งาน' };
          clickAttempted = true;
          targetBtn.click();
          window.__lastHumanCheckSolved = {
            pickIndex: ${Number(pickIndex)},
            slot: ${Number(pickIndex) + 1},
            matchedName: ${JSON.stringify(cleanName)},
            manual: ${JSON.stringify(isManual)},
            answeredBy: ${JSON.stringify(answeredBy)},
            source: ${JSON.stringify(isManual ? 'discord-manual' : 'manager-auto')},
            timestamp: Date.now()
          };
          if (window.showHudToast) {
            const toastPrefix = ${JSON.stringify(isManual ? `👤 ตอบผ่าน Discord${answeredBy ? ' (' + answeredBy + ')' : ''}: ` : '🤖 ตอบเช็คผู้เล่น: ')};
            window.showHudToast(toastPrefix + ${JSON.stringify(cleanName || ('ข้อ ' + (pickIndex + 1)))}, 'success', 5000);
          }
          return { success: true, picked: ${pickIndex} };
        }

        const boardEl = hc.querySelector('.human-check-board');
        const boardImg = boardEl ? boardEl.querySelector('img') : null;
        if (boardEl || boardImg || (packet && packet.image)) {
          const slotIdx = ${Number(pickIndex)};
          if (slotIdx < 0 || slotIdx >= 4) {
            return { success: false, error: 'ตัวเลือกบนกระดานต้องเป็นข้อ 1 ถึง 4' };
          }
          const bw = (packet && packet.width) || 480;
          const bh = (packet && packet.height) || 330;
          const colRanges = [[15, 120], [130, 232], [248, 355], [365, 468]];
          let targetX = Math.round(((colRanges[slotIdx][0] + colRanges[slotIdx][1]) * 0.5) * (bw / 480));
          let targetY = Math.round(235 * (bh / 330));

          if (Array.isArray(window.__latestBoardCandidates) && window.__latestBoardCandidates[slotIdx]) {
            const c = window.__latestBoardCandidates[slotIdx];
            if (typeof c.x === 'number' && typeof c.y === 'number') {
              targetX = Math.round(c.x);
              targetY = Math.round(c.y);
            }
          } else if (boardImg && boardImg.complete && boardImg.naturalWidth > 0) {
            try {
              const cvs = document.createElement('canvas');
              cvs.width = bw;
              cvs.height = bh;
              const ctx = cvs.getContext('2d');
              if (ctx) {
                ctx.drawImage(boardImg, 0, 0, bw, bh);
                const imgData = ctx.getImageData(0, 0, bw, bh);
                if (typeof window.findHumanCheckBoardCandidates === 'function') {
                  const cands = window.findHumanCheckBoardCandidates(imgData);
                  if (Array.isArray(cands) && cands[slotIdx] && typeof cands[slotIdx].x === 'number') {
                    targetX = Math.round(cands[slotIdx].x);
                    targetY = Math.round(cands[slotIdx].y);
                  }
                } else {
                  const sx = bw / 480, sy = bh / 330;
                  const x1 = Math.round(colRanges[slotIdx][0] * sx), x2 = Math.round(colRanges[slotIdx][1] * sx);
                  const y1 = Math.round(175 * sy), y2 = Math.min(bh - 5, Math.round(318 * sy));
                  const data = imgData.data;
                  let sumW = 0, sumX = 0, sumY = 0;
                  const midX = (x1 + x2) * 0.5, midY = (y1 + y2) * 0.5;
                  for (let y = y1 + 2; y < y2 - 2; y++) {
                    for (let x = x1 + 2; x < x2 - 2; x++) {
                      const idx = (y * bw + x) * 4;
                      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
                      const gx = Math.abs(r - data[idx - 4]) + Math.abs(g - data[idx - 3]) + Math.abs(b - data[idx - 2]);
                      const gy = Math.abs(r - data[idx - bw * 4]) + Math.abs(g - data[idx - bw * 4 + 1]) + Math.abs(b - data[idx - bw * 4 + 2]);
                      const grad = (gx + gy) / 6;
                      if (grad > 18) {
                        const distPenalty = 1 / (1 + Math.hypot(x - midX, (y - midY) * 0.8) / 28);
                        const w = grad * distPenalty;
                        sumW += w;
                        sumX += x * w;
                        sumY += y * w;
                      }
                    }
                  }
                  if (sumW > 50) {
                    targetX = Math.round(sumX / sumW);
                    targetY = Math.round(sumY / sumW);
                  }
                }
              }
            } catch (_) {}
          }

          clickAttempted = true;
          let annotatedImageDataUrl = null;
          try {
            if (boardImg && (boardImg.naturalWidth > 0 || boardImg.width > 0)) {
              const bCanvas = document.createElement('canvas');
              bCanvas.width = bw;
              bCanvas.height = bh + 38;
              const bCtx = bCanvas.getContext('2d');
              if (bCtx) {
                bCtx.fillStyle = '#0f172a';
                bCtx.fillRect(0, 0, bCanvas.width, bCanvas.height);
                bCtx.drawImage(boardImg, 0, 0, bw, bh);
                bCtx.save();
                bCtx.strokeStyle = '#10b981';
                bCtx.lineWidth = 3;
                bCtx.beginPath();
                bCtx.arc(targetX, targetY, 26, 0, Math.PI * 2);
                bCtx.stroke();
                bCtx.restore();
                for (let i = 0; i < 4; i++) {
                  const isPicked = (i === slotIdx);
                  const cx = Math.round(((i + 0.5) * bw) / 4);
                  const bx = cx - 44;
                  const by = bh + 5;
                  bCtx.fillStyle = isPicked ? '#065f46' : '#1e293b';
                  bCtx.strokeStyle = isPicked ? '#10b981' : '#38bdf8';
                  bCtx.lineWidth = isPicked ? 2 : 1.5;
                  bCtx.beginPath();
                  if (bCtx.roundRect) bCtx.roundRect(bx, by, 88, 28, 6); else if (bCtx.rect) bCtx.rect(bx, by, 88, 28);
                  bCtx.fill();
                  bCtx.stroke();
                  bCtx.fillStyle = '#f8fafc';
                  bCtx.font = 'bold 13px "Segoe UI", Tahoma, sans-serif';
                  bCtx.textAlign = 'center';
                  bCtx.fillText((isPicked ? '✓ ตัวเลือก ' : 'ตัวเลือก ') + (i + 1), cx, by + 19);
                }
                annotatedImageDataUrl = bCanvas.toDataURL('image/png');
              }
            }
          } catch (_) {}

          let roomSent = false;
          try {
            if (typeof window.submitHumanCheckBoardAnswer === 'function') {
              roomSent = Boolean(window.submitHumanCheckBoardAnswer(hc, boardEl, packet, targetX, targetY));
            }
          } catch (_) {}

          if (!roomSent) {
            try {
              const room = (typeof window.getColyseusRoom === 'function' ? window.getColyseusRoom() : null)
                || (typeof window.getGameRoom === 'function' ? window.getGameRoom() : null)
                || window.__colyseusRoom || window.__gameRoom || null;
              if (room && typeof room.send === 'function' && packet && packet.id != null && !packet.isDomFallback) {
                room.send('human_check_answer', { id: packet.id, x: targetX, y: targetY });
                roomSent = true;
              }
            } catch (_) {}

            try {
              const targetEl = boardImg || boardEl;
              if (targetEl && typeof targetEl.getBoundingClientRect === 'function') {
                const rect = targetEl.getBoundingClientRect();
                const clientX = rect.left + (targetX / bw) * (rect.width || bw);
                const clientY = rect.top + (targetY / bh) * (rect.height || bh);
                const opts = { bubbles: !roomSent, cancelable: true, view: window, clientX, clientY };
                if (typeof PointerEvent !== 'undefined') targetEl.dispatchEvent(new PointerEvent('pointerdown', opts));
                if (typeof MouseEvent !== 'undefined') {
                  targetEl.dispatchEvent(new MouseEvent('mousedown', opts));
                  targetEl.dispatchEvent(new MouseEvent('mouseup', opts));
                  targetEl.dispatchEvent(new MouseEvent('click', opts));
                }
              }
            } catch (_) {}
          }

          window.__lastHumanCheckSolved = {
            pickIndex: slotIdx,
            slot: slotIdx + 1,
            x: targetX,
            y: targetY,
            matchedName: ${JSON.stringify(cleanName)} || ('ตัวเลือกที่ ' + (slotIdx + 1)),
            annotatedImageDataUrl: annotatedImageDataUrl || null,
            manual: ${JSON.stringify(isManual)},
            answeredBy: ${JSON.stringify(answeredBy)},
            source: ${JSON.stringify(isManual ? 'discord-manual' : 'manager-auto')},
            timestamp: Date.now()
          };
          if (window.showHudToast) {
            const toastPrefix = ${JSON.stringify(isManual ? `👤 ตอบผ่าน Discord${answeredBy ? ' (' + answeredBy + ')' : ''}: ` : '🤖 ตอบเช็คผู้เล่น: ')};
            window.showHudToast(toastPrefix + 'ตัวเลือกที่ ' + (slotIdx + 1) + ' (' + targetX + ', ' + targetY + ')', 'success', 5000);
          }
          return { success: true, picked: slotIdx, slot: slotIdx + 1, x: targetX, y: targetY, annotatedImageDataUrl };
        }

        return { success: false, error: 'ไม่พบปุ่มตัวเลือกที่ ${pickIndex + 1}' };
      } catch (err) {
        return { success: false, uncertain: clickAttempted, error: err.message };
      }
    })()`;

    try {
      const res = await evalProfilePort(profile.debugPort, evalCode, 6000);
      if (res?.result?.success) {
        if (typeof onCaptchaSolved === 'function') {
          try { onCaptchaSolved(profileId, { pickIndex, matchedName, manual: isManual, answeredBy }); } catch (e) {}
        }
      }
      return res?.result || { success: false, uncertain: true, error: 'ไม่ได้รับการตอบรับจากจอเกม' };
    } catch (e) {
      return { success: false, uncertain: true, error: e.message };
    }
  }

  // Connect to Discord Gateway via native WebSocket (Node.js 21+)
  function syncGatewayConnection() {
    const cfg = loadSettings();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (!cfg.enabled || !cfg.botToken || typeof WebSocket === 'undefined') {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (gatewayWs) {
        try { gatewayWs.close(); } catch (e) {}
        gatewayWs = null;
      }
      return;
    }

    if (gatewayWs && (gatewayWs.readyState === WebSocket.OPEN || gatewayWs.readyState === WebSocket.CONNECTING)) {
      return; // Already connected or connecting — keep heartbeat alive
    }

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    connectGateway(cfg.botToken);
  }

  function connectGateway(token) {
    if (isConnecting) return;
    isConnecting = true;

    try {
      console.log('[Discord Bot] Connecting to Discord Gateway...');
      const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
      gatewayWs = ws;

      ws.onopen = () => {
        isConnecting = false;
        console.log('[Discord Bot] Gateway WebSocket connected');
      };

      ws.onmessage = async (event) => {
        try {
          const payload = JSON.parse(event.data);
          const { op, d, s, t } = payload;
          if (s !== null) lastSequence = s;

          // OP 10: Hello -> start heartbeat & identify
          if (op === 10) {
            const interval = d.heartbeat_interval;
            heartbeatTimer = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ op: 1, d: lastSequence }));
              }
            }, interval);

            // Send Identify
            ws.send(JSON.stringify({
              op: 2,
              d: {
                token: token,
                intents: 33280, // Guilds + Guild Messages + Message Content
                properties: {
                  os: 'windows',
                  browser: 'PmheeAetherManager',
                  device: 'PmheeAetherManager'
                }
              }
            }));
          }

          // OP 0: Dispatch Events
          if (op === 0) {
            // READY
            if (t === 'READY') {
              console.log(`[Discord Bot] Logged in as ${d.user.username}#${d.user.discriminator} (${d.user.id})`);
            }

            // INTERACTION_CREATE (User clicked a button)
            if (t === 'INTERACTION_CREATE') {
              handleInteraction(d, token);
            }

            // MESSAGE_CREATE (User typed a number or reply in channel)
            if (t === 'MESSAGE_CREATE') {
              handleMessage(d, token);
            }
          }
        } catch (err) {
          console.error('[Discord Bot] Error handling gateway message:', err);
        }
      };

      ws.onclose = (event) => {
        isConnecting = false;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        console.log(`[Discord Bot] Gateway closed (${event.code}). Reconnecting in 10s...`);
        reconnectTimer = setTimeout(syncGatewayConnection, 10000);
      };

      ws.onerror = (err) => {
        isConnecting = false;
        console.error('[Discord Bot] Gateway error:', err.message || err);
      };
    } catch (e) {
      isConnecting = false;
      console.error('[Discord Bot] Failed to init gateway:', e);
      reconnectTimer = setTimeout(syncGatewayConnection, 15000);
    }
  }

  // Verify in-game whether a Human Check closed (correct) or stayed open (wrong) after answering.
  // Handles server/client lag by polling up to maxWaitMs and checking if triesLeft ("ตอบผิดได้อีก X ครั้ง") actually decreased.
  async function verifyHumanCheckAnswerInGame(profileId, waitMsOrOptions = 1200) {
    const profiles = typeof loadProfiles === 'function' ? (loadProfiles() || []) : [];
    const profile = profiles.find(p => p && p.id === profileId);
    if (!profile || !profile.debugPort || typeof evalProfilePort !== 'function') {
      return null;
    }
    const isTest = !!(process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test');
    const opts = (typeof waitMsOrOptions === 'object' && waitMsOrOptions !== null)
      ? waitMsOrOptions
      : { waitMs: Number(waitMsOrOptions) || 1200 };
    const initialWaitMs = opts.waitMs !== undefined ? Number(opts.waitMs) : 1200;
    const maxWaitMs = isTest ? initialWaitMs : Math.max(initialWaitMs, Number(opts.maxWaitMs) || 5800);
    const expectedTriesBefore = opts.expectedTriesBefore !== undefined ? opts.expectedTriesBefore : null;

    const startTime = Date.now();
    if (initialWaitMs > 0) {
      await new Promise(r => setTimeout(r, initialWaitMs));
    }

    let retriedLagClick = false;
    let lastResult = null;

    while (true) {
      try {
        const probe = await evalProfilePort(profile.debugPort, `(() => {
          const hc = document.querySelector('.human-check');
          if (!hc) return { stillOpen: false, solved: window.__lastHumanCheckSolved || null };
          const metaEl = hc.querySelector('.human-check-meta');
          const metaText = (metaEl && typeof metaEl.innerText === 'string') ? metaEl.innerText.trim() : '';
          const triesMatch = metaText.match(/ตอบผิดได้อีก\\s*(\\d+)/);
          const triesLeft = triesMatch ? Number(triesMatch[1]) : null;
          let imageDataUrl = null;
          const boardImg = hc.querySelector('.human-check-board img');
          if (boardImg && boardImg.complete && boardImg.naturalWidth > 0 && typeof document?.createElement === 'function') {
            try {
              const bw = 480, bh = 330, stripH = 38;
              const bCanvas = document.createElement('canvas');
              bCanvas.width = bw;
              bCanvas.height = bh + stripH;
              const bCtx = bCanvas.getContext('2d');
              if (bCtx) {
                bCtx.fillStyle = '#0f172a';
                bCtx.fillRect(0, 0, bw, bh + stripH);
                bCtx.drawImage(boardImg, 0, 0, bw, bh);
                const colCenters = [68, 181, 300, 416];
                const lastSlot = window.__lastHumanCheckSolved?.slot || null;
                for (let i = 0; i < 4; i++) {
                  const cx = colCenters[i];
                  const bx = cx - 44, by = bh + 5;
                  bCtx.fillStyle = (lastSlot === i + 1) ? '#991b1b' : '#1e293b';
                  bCtx.strokeStyle = (lastSlot === i + 1) ? '#ef4444' : '#38bdf8';
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
            } catch (_) {}
          }
          return { stillOpen: true, metaText, triesLeft, imageDataUrl, solved: window.__lastHumanCheckSolved || null };
        })()`, 3000);
        lastResult = probe && probe.result ? probe.result : null;
      } catch (_) {
        lastResult = null;
      }

      if (!lastResult) return null;
      // 1. Modal closed -> Confirmed CORRECT!
      if (!lastResult.stillOpen) {
        return lastResult;
      }

      const elapsed = Date.now() - startTime;
      const triesBefore = expectedTriesBefore ?? lastResult.solved?.triesLeftBefore ?? 1;
      const triesDropped = (lastResult.triesLeft != null && triesBefore != null && lastResult.triesLeft < triesBefore);

      // 2. triesLeft explicitly decreased (e.g. "ตอบผิดได้อีก 1 ครั้ง" -> "ตอบผิดได้อีก 0 ครั้ง") -> Confirmed WRONG!
      if (triesDropped && elapsed >= 1200) {
        lastResult.confirmedWrong = true;
        return lastResult;
      }

      if (isTest || elapsed >= maxWaitMs) {
        if (!triesDropped && lastResult.triesLeft != null && triesBefore != null && lastResult.triesLeft >= triesBefore) {
          lastResult.lagUnconfirmed = true;
        }
        return lastResult;
      }

      // 3. Still open and triesLeft has NOT decreased -> game/server is lagging!
      // At ~2.3s, re-send the answer packet once in case client lag swallowed the first click.
      if (!retriedLagClick && elapsed >= 1900) {
        retriedLagClick = true;
        try {
          await evalProfilePort(profile.debugPort, `(() => {
            const hc = document.querySelector('.human-check');
            const s = window.__lastHumanCheckSolved;
            const packet = window.__latestHumanCheck;
            if (!hc || !s) return false;
            if (typeof window.submitHumanCheckBoardAnswer === 'function' && typeof s.x === 'number' && typeof s.y === 'number') {
              return Boolean(window.submitHumanCheckBoardAnswer(hc, hc.querySelector('.human-check-board'), packet, s.x, s.y));
            }
            const room = (typeof window.getColyseusRoom === 'function' ? window.getColyseusRoom() : null)
              || (typeof window.getGameRoom === 'function' ? window.getGameRoom() : null)
              || window.__colyseusRoom || window.__gameRoom || null;
            if (room && typeof room.send === 'function' && packet && packet.id != null && typeof s.x === 'number' && typeof s.y === 'number') {
              room.send('human_check_answer', { id: packet.id, x: s.x, y: s.y });
              return true;
            }
            return false;
          })()`, 2000);
        } catch (_) {}
      }

      await new Promise(r => setTimeout(r, 800));
    }
  }

  // Send wrong-answer confirmation & board image to dedicated wrong-answer channel (1559706567560007730)
  async function notifyHumanCheckWrongAttempt({ profile, attempt }) {
    if (!profile || !attempt) return;
    const cfg = loadSettings();
    if (!cfg.enabled || !cfg.botToken) return;
    const wrongChannelId = cfg.wrongChannelId || DEFAULT_DISCORD_SETTINGS.wrongChannelId || '1559706567560007730';
    if (!wrongChannelId) return;

    // Guard against premature "wrong answer" reports caused by game/server lag:
    // When a Human Check opens, triesLeftBefore is 1 ("ตอบผิดได้อีก 1 ครั้ง").
    // If triesLeftAfter is still >= triesLeftBefore (did NOT drop to 0), the server hasn't rejected the answer yet!
    const isTest = !!(process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test');
    const triesBefore = attempt.triesLeftBefore ?? 1;
    const triesAfterInitial = attempt.triesLeftAfter ?? attempt.triesLeft ?? null;
    const alreadyConfirmedWrong = (triesAfterInitial != null && triesBefore != null && triesAfterInitial < triesBefore);

    if (!isTest && !alreadyConfirmedWrong && profile.debugPort && typeof evalProfilePort === 'function') {
      const verify = await verifyHumanCheckAnswerInGame(profile.id, {
        waitMs: 1400,
        maxWaitMs: 5800,
        expectedTriesBefore: triesBefore
      });
      // If the Human Check closed while waiting for lag, the answer was actually CORRECT! Cancel false wrong alert.
      if (!verify || !verify.stillOpen) {
        console.log(`[Discord Bot] ⏳ ยกเลิกแจ้งเตือนตอบผิดของจอ [${profile.name}] เพราะหน้าต่างเช็คผู้เล่นปิดลงแล้วหลังรอลดแลค (ตอบถูก!)`);
        return;
      }
      // If triesLeft STILL hasn't decreased (still "ตอบผิดได้อีก 1 ครั้ง"), the server hasn't rejected this choice as wrong.
      if (verify.lagUnconfirmed && verify.triesLeft != null && verify.triesLeft >= triesBefore) {
        console.log(`[Discord Bot] ⏳ ข้ามการยืนยันว่าตอบผิดของจอ [${profile.name}] เพราะจำนวนครั้งที่ตอบผิดได้ยังไม่ลดลง (${verify.metaText || verify.triesLeft})`);
        return;
      }
      if (verify.triesLeft != null) attempt.triesLeftAfter = verify.triesLeft;
      if (verify.metaText) attempt.metaText = verify.metaText;
      if (verify.imageDataUrl) attempt.imageDataUrl = verify.imageDataUrl;
    }

    const now = Date.now();
    for (const [k, t] of reportedWrongAttempts.entries()) {
      if (now - t > 180000) reportedWrongAttempts.delete(k);
    }
    const slotNum = Number.isInteger(attempt.slot) && attempt.slot >= 1
      ? attempt.slot
      : (Number.isInteger(attempt.pickedSlot) && attempt.pickedSlot >= 1
        ? attempt.pickedSlot
        : (Number.isInteger(attempt.pickIndex) && attempt.pickIndex >= 0 ? attempt.pickIndex + 1 : 1));
    const dedupKey = `${profile.id}:${attempt.checkId || ''}:${slotNum}:${attempt.triesLeftAfter ?? attempt.triesLeft ?? ''}`;
    if (reportedWrongAttempts.has(dedupKey)) return;
    reportedWrongAttempts.set(dedupKey, now);

    const nick = resolveDeviceNickname();
    const charName = profile.liveState?.charName || profile.lastCharName || profile.name;
    const promptText = attempt.prompt || '(กดรูปด้านล่างที่เหมือนกับรูปในกรอบ)';
    const byWho = attempt.manual && attempt.answeredBy
      ? `👤 ผู้เล่นกดตอบผ่าน Discord (**${attempt.answeredBy}**)`
      : `🤖 บอทตอบอัตโนมัติ (Auto-Solver)`;
    const triesText = attempt.metaText
      || (attempt.triesLeftAfter != null ? `ตอบผิดได้อีก ${attempt.triesLeftAfter} ครั้ง` : 'หน้าต่างเช็คผู้เล่นยังไม่ปิด (กำลังลองตัวเลือกถัดไป)');

    let fileAttachment = null;
    if (attempt.imageDataUrl && typeof attempt.imageDataUrl === 'string' && attempt.imageDataUrl.startsWith('data:image/')) {
      try {
        const base64Str = attempt.imageDataUrl.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
        const buf = Buffer.from(base64Str, 'base64');
        if (buf.length > 200) {
          fileAttachment = {
            buffer: buf,
            filename: 'human_check.png',
            contentType: 'image/png'
          };
        }
      } catch (_) {}
    }

    let tracked = activeChecks.get(profile.id);
    if (!tracked) {
      const nonce = crypto.randomBytes(12).toString('hex');
      tracked = {
        profileId: profile.id,
        checkId: attempt.checkId ?? null,
        fingerprint: '',
        nonce,
        requestId: null,
        prompt: promptText,
        notifiedAt: now,
        options: [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }]
      };
      activeChecks.set(profile.id, tracked);
      recentNonces.set(nonce, tracked);
    }

    const embed = {
      title: `❌ [ยืนยันผล: ตอบผิด!] เลือกตัวเลือกที่ ${slotNum} ไม่ถูกต้อง`,
      description:
        `💻 **เครื่อง:** \`${nick}\`\n` +
        `🎮 **จอเกม:** **${charName}** (\`${profile.name}\`)\n` +
        `🙋 **ผู้ตอบ:** ${byWho}\n\n` +
        `### ❓ โจทย์คำถาม:\n> **${promptText}**\n\n` +
        `❌ **ผลการตรวจสอบ (Confirm):** เลือก **ตัวเลือกที่ ${slotNum}** ${attempt.x != null ? `(พิกัด ${attempt.x}, ${attempt.y})` : ''} แล้ว **ตอบผิด!**\n` +
        `⏱️ **สถานะคงเหลือ:** **${triesText}**\n\n` +
        `👉 **ช่วยกดตอบใหม่ได้ทันที:** กดปุ่มตัวเลือกที่ถูกต้องด้านล่าง`,
      color: 0xEF4444,
      fields: [],
      footer: { text: `Aetheria Online · เครื่อง: ${nick} · จอ ${charName} (${profile.name})` },
      timestamp: new Date().toISOString()
    };

    if (fileAttachment) {
      embed.image = { url: 'attachment://human_check.png' };
    }

    const buttons = [];
    for (let i = 0; i < 4; i++) {
      buttons.push({
        type: 2,
        style: (i + 1 === slotNum) ? 4 : 1,
        label: (i + 1 === slotNum) ? `ตัวเลือกที่ ${i + 1} (ผิด)` : `ตัวเลือกที่ ${i + 1}`,
        custom_id: `hc:${profile.id}:${i}:${tracked.nonce}`
      });
    }
    const components = [
      { type: 1, components: buttons },
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            label: '🖥️ ดึงจอเกมขึ้นหน้าสุด',
            custom_id: `hc:${profile.id}:focus:${tracked.nonce}`
          }
        ]
      }
    ];

    const res = await discordRequest(
      `/channels/${wrongChannelId}/messages`,
      'POST',
      {
        content: `❌ **[ยืนยันผล: ตอบผิด! · เครื่อง: ${nick}]** จอ **${charName}** (${profile.name}) — ${attempt.manual && attempt.answeredBy ? `ผู้ตอบ **${attempt.answeredBy}**` : 'บอท'} เลือก **ตัวเลือกที่ ${slotNum}** แล้ว **ตอบผิด!** (${triesText})`,
        embeds: [embed],
        components
      },
      cfg.botToken,
      fileAttachment
    );
    if (res && res.success && res.data?.id && tracked) {
      tracked.wrongMessageId = res.data.id;
      if (!tracked.messageId) tracked.messageId = res.data.id;
    }
  }

  // Handle Button Interaction
  async function handleInteraction(interaction, token) {
    // Only handle Component Interactions (Type 3: Message Component / Button)
    if (interaction.type !== 3) return;

    const customId = interaction.data?.custom_id || '';
    const cfg = loadSettings();
    const allowedChannels = new Set([cfg.channelId, cfg.wrongChannelId].filter(Boolean));
    if (!cfg.enabled || !allowedChannels.has(interaction.channel_id)) return;

    const interactionId = interaction.id;
    const interactionToken = interaction.token;

    // Helper: Acknowledge & update interaction
    const respondInteraction = async (content, { updateMessage = false, ephemeral = true } = {}) => {
      // Type 4: ChannelMessageWithSource, Type 7: UpdateMessage
      const type = updateMessage ? 7 : 4;
      const data = { content };
      if (ephemeral) data.flags = 64; // 64 = ephemeral (visible only to clicker)
      await discordRequest(
        `https://discord.com/api/v10/interactions/${interactionId}/${interactionToken}/callback`,
        'POST',
        { type, data }
      );
    };

    const nick = resolveDeviceNickname();
    if (customId === 'hc_test_0' || customId === 'hc_test_1') {
      await respondInteraction(`✅ [${nick}] ทดสอบปุ่มกดสำเร็จ! ทุกคนในห้องสามารถกดปุ่มหรือพิมพ์เลข 1-4 เพื่อช่วยตอบคำถามได้ทันทีครับ`);
      return;
    }

    const parts = customId.split(':');
    if (parts.length !== 4 || parts[0] !== 'hc') return;
    const [, profileId, action, nonce] = parts;

    const profiles = typeof loadProfiles === 'function' ? (loadProfiles() || []) : [];
    const profileObj = profiles.find(p => p && p.id === profileId) || null;
    const charName = profileObj ? (profileObj.liveState?.charName || profileObj.lastCharName || profileObj.name) : profileId;
    const screenLabel = profileObj ? `**${charName}** (${profileObj.name})` : `[${profileId}]`;

    const active = activeChecks.get(profileId) || recentNonces.get(nonce);
    const ownsProfile = Boolean(
      recentNonces.has(nonce) ||
      activeChecks.has(profileId) ||
      profileObj
    );
    if (!ownsProfile) return;

    if (!active || Date.now() - active.notifiedAt > 300000) {
      await respondInteraction(`ℹ️ [${nick}] คำถามของจอ ${screenLabel} ถูกตอบไปแล้วหรือหมดเวลาแล้วครับ`);
      return;
    }
    if (active.nonce && active.nonce !== nonce && active.messageId && interaction.message?.id && active.messageId !== interaction.message.id && active.wrongMessageId !== interaction.message.id) {
      await respondInteraction(`ℹ️ [${nick}] ปุ่มนี้เป็นของคำถามรอบก่อนหน้า กรุณากดปุ่มจากข้อความแจ้งเตือนล่าสุดครับ`);
      return;
    }

    if (action === 'focus') {
      if (typeof focusProfileWindow === 'function') {
        focusProfileWindow(profileId);
      }
      await respondInteraction(`🖥️ [${nick}] ดึงหน้าต่างจอเกม ${screenLabel} ขึ้นมาหน้าสุดเรียบร้อยแล้ว!`);
      return;
    }

    const pickIndex = /^[0-5]$/.test(action) ? Number(action) : NaN;
    if (isNaN(pickIndex)) {
      await respondInteraction(`❌ [${nick}] คำสั่งไม่ถูกต้อง: ${action}`);
      return;
    }

    const helperName = interaction.member?.nick || interaction.member?.user?.global_name || interaction.member?.user?.username || interaction.user?.username || 'ผู้ช่วยในห้อง';
    active.solvedManually = true;
    active.solvedBy = helperName;

    // Answer in game with manual attribution so notifyHumanCheck never mistakes this for an Auto-Solver answer
    const result = await answerCheckInGame(
      profileId,
      pickIndex,
      '',
      { id: active.checkId, prompt: active.prompt },
      { manual: true, answeredBy: helperName }
    );
    if (result.success) {
      const verify = await verifyHumanCheckAnswerInGame(profileId, { waitMs: 1200, maxWaitMs: 5800 });
      if (verify && !verify.stillOpen) {
        activeChecks.delete(profileId);
        await respondInteraction(
          `✅ **[${nick} · ผู้ตอบ: ${helperName}]** กดเลือก **ตัวเลือกที่ ${pickIndex + 1}** ให้จอ ${screenLabel} — **ยืนยันผล (Confirm): ตอบถูก!** 🎉 (หน้าต่างเช็คผู้เล่นปิดลงเรียบร้อยแล้ว)`,
          { ephemeral: false }
        );
      } else if (verify && verify.stillOpen && !verify.lagUnconfirmed) {
        const metaNote = verify.metaText ? ` (${verify.metaText})` : '';
        await respondInteraction(
          `❌ **[${nick} · ผู้ตอบ: ${helperName}]** กดเลือก **ตัวเลือกที่ ${pickIndex + 1}** ให้จอ ${screenLabel} — **ยืนยันผล (Confirm): ตอบผิด!** ⚠️${metaNote} กรุณาเลือกคำตอบใหม่อีกครั้ง`,
          { ephemeral: false }
        );
        if (profileObj) {
          await notifyHumanCheckWrongAttempt({
            profile: profileObj,
            attempt: {
              timestamp: Date.now(),
              checkId: active.checkId,
              prompt: active.prompt,
              pickIndex,
              slot: pickIndex + 1,
              x: result.x ?? null,
              y: result.y ?? null,
              manual: true,
              answeredBy: helperName,
              triesLeftBefore: verify.solved?.triesLeftBefore ?? 1,
              triesLeftAfter: verify.triesLeft,
              metaText: verify.metaText,
              imageDataUrl: verify.imageDataUrl
            }
          });
        }
      } else {
        await respondInteraction(
          `✅ **[${nick} · ผู้ตอบ: ${helperName}]** กดเลือก **ตัวเลือกที่ ${pickIndex + 1}** ให้จอ ${screenLabel} เรียบร้อยแล้ว!`,
          { ephemeral: false }
        );
      }
    } else {
      await respondInteraction(`⚠️ [${nick}] สั่งตอบให้จอ ${screenLabel} ไม่สำเร็จ: ${result.error || 'ไม่ทราบสาเหตุ'}`);
    }
  }

  // Handle Text Message (e.g. anyone in the channel types "1", "2", "3", "4" or replies to the alert)
  async function handleMessage(msg, token) {
    if (msg.author?.bot) return;

    const cfg = loadSettings();
    const allowedChannels = new Set([cfg.channelId, cfg.wrongChannelId].filter(Boolean));
    if (!cfg.enabled || !allowedChannels.has(msg.channel_id)) return;

    const text = (msg.content || '').trim();

    // Admin Manager Commands via Discord
    if (text.startsWith('!')) {
      const parts = text.split(/\s+/);
      const cmd = (parts[0] || '').toLowerCase();

      // 1. !admin or !help
      if (cmd === '!admin' || cmd === '!help') {
        const nick = resolveDeviceNickname();
        const helpText = [
          `🛡️ **[PmheeAether Admin Manager · เครื่อง: ${nick}]**`,
          `📋 **คำสั่งควบคุมจอและเครื่องผ่าน Discord:**`,
          `• \`!status\` หรือ \`!devices\` — ดูสถานะเครื่องนี้และจอที่กำลังเปิดอยู่`,
          `• \`!stop all\` หรือ \`!close all\` — **ปิดทุกจอ ทุกเครื่อง** ทันที! 🛑`,
          `• \`!stop ${nick} all\` — ปิดทุกจอเฉพาะเครื่อง \`${nick}\``,
          `• \`!stop ${nick} <เลขจอ หรือ ชื่อตัวละคร>\` — ปิดเฉพาะจอที่ระบุของเครื่อง \`${nick}\``,
          `• \`!launch ${nick} all\` — เปิดทุกจอของเครื่อง \`${nick}\``,
          `• \`!launch ${nick} <เลขจอ หรือ ชื่อจอ>\` — เปิดจอระบุของเครื่อง \`${nick}\``
        ].join('\n');

        await discordRequest(`/channels/${msg.channel_id}/messages`, 'POST', {
          content: helpText,
          message_reference: { message_id: msg.id }
        }, token);
        return;
      }

      // 2. !status or !devices or !machines
      if (cmd === '!status' || cmd === '!devices' || cmd === '!machines') {
        const nick = resolveDeviceNickname();
        const profiles = typeof loadProfiles === 'function' ? loadProfiles() : [];
        const openProfiles = [];
        profiles.forEach((p, idx) => {
          if (p.debugPort) {
            const charName = p.liveState?.charName || p.lastCharName || p.name;
            const lv = p.liveState?.baseLv ? `Lv.${p.liveState.baseLv}` : '';
            const map = p.liveState?.currentMap ? `(${p.liveState.currentMap})` : '';
            openProfiles.push(`  **${idx + 1}️⃣** ${charName} ${lv} ${map} [\`${p.id}\`]`);
          }
        });

        const statusText = openProfiles.length > 0
          ? `🖥️ **[${nick}]** กำลังเปิดอยู่ **${openProfiles.length} จอ**:\n${openProfiles.join('\n')}\n👉 *สั่งปิดได้ด้วย \`!stop ${nick} all\` หรือ \`!stop ${nick} <เลขจอ>\`*`
          : `🖥️ **[${nick}]** ปัจจุบัน **ไม่มีจอเปิดอยู่**`;

        await discordRequest(`/channels/${msg.channel_id}/messages`, 'POST', {
          content: statusText,
          message_reference: { message_id: msg.id }
        }, token);
        return;
      }

      // 3. !stop all or !close all (Emergency Stop All Everywhere)
      if ((cmd === '!stop' || cmd === '!close') && (parts[1] || '').toLowerCase() === 'all' && parts.length === 2) {
        const nick = resolveDeviceNickname();
        if (typeof stopAll === 'function') {
          try { await stopAll(); } catch (_) {}
        }
        await discordRequest(`/channels/${msg.channel_id}/messages`, 'POST', {
          content: `🛑 **[${nick}] ปิดทุกจอในเครื่องเรียบร้อยแล้ว!**`,
          message_reference: { message_id: msg.id }
        }, token);
        return;
      }

      // 4. !stop <device_nickname> all OR !stop <device_nickname> <profile>
      if ((cmd === '!stop' || cmd === '!close') && parts.length >= 3) {
        const targetNick = parts[1].toLowerCase();
        const myNick = resolveDeviceNickname().toLowerCase();
        if (targetNick === myNick || targetNick === 'all') {
          const action = parts.slice(2).join(' ').toLowerCase();
          if (action === 'all') {
            if (typeof stopAll === 'function') {
              try { await stopAll(); } catch (_) {}
            }
            await discordRequest(`/channels/${msg.channel_id}/messages`, 'POST', {
              content: `🛑 **[${resolveDeviceNickname()}] ปิดทุกจอในเครื่องเรียบร้อยแล้ว!**`,
              message_reference: { message_id: msg.id }
            }, token);
            return;
          } else {
            const profiles = typeof loadProfiles === 'function' ? loadProfiles() : [];
            const idxNum = parseInt(action, 10);
            let targetP = null;
            if (!isNaN(idxNum) && idxNum >= 1 && idxNum <= profiles.length) {
              targetP = profiles[idxNum - 1];
            } else {
              targetP = profiles.find(p => (p.id && p.id.toLowerCase() === action) || (p.name && p.name.toLowerCase() === action) || (p.liveState?.charName && p.liveState.charName.toLowerCase() === action));
            }
            if (targetP) {
              if (typeof stopProfile === 'function') {
                try { await stopProfile(targetP.id); } catch (_) {}
              }
              await discordRequest(`/channels/${msg.channel_id}/messages`, 'POST', {
                content: `🛑 **[${resolveDeviceNickname()}] ปิดจอ [${targetP.name}] เรียบร้อยแล้ว!**`,
                message_reference: { message_id: msg.id }
              }, token);
            } else {
              await discordRequest(`/channels/${msg.channel_id}/messages`, 'POST', {
                content: `⚠️ [${resolveDeviceNickname()}] ไม่พบจอ "${parts.slice(2).join(' ')}" ในเครื่องนี้`,
                message_reference: { message_id: msg.id }
              }, token);
            }
            return;
          }
        }
      }

      // 5. !launch <device_nickname> all OR !launch <device_nickname> <profile>
      if (cmd === '!launch' && parts.length >= 3) {
        const targetNick = parts[1].toLowerCase();
        const myNick = resolveDeviceNickname().toLowerCase();
        if (targetNick === myNick || targetNick === 'all') {
          const action = parts.slice(2).join(' ').toLowerCase();
          if (action === 'all') {
            if (typeof launchAll === 'function') {
              try { await launchAll(); } catch (_) {}
            }
            await discordRequest(`/channels/${msg.channel_id}/messages`, 'POST', {
              content: `🚀 **[${resolveDeviceNickname()}] สั่งเปิดทุกจอเรียบร้อยแล้ว!**`,
              message_reference: { message_id: msg.id }
            }, token);
            return;
          } else {
            const profiles = typeof loadProfiles === 'function' ? loadProfiles() : [];
            const idxNum = parseInt(action, 10);
            let targetP = null;
            if (!isNaN(idxNum) && idxNum >= 1 && idxNum <= profiles.length) {
              targetP = profiles[idxNum - 1];
            } else {
              targetP = profiles.find(p => (p.id && p.id.toLowerCase() === action) || (p.name && p.name.toLowerCase() === action) || (p.liveState?.charName && p.liveState.charName.toLowerCase() === action));
            }
            if (targetP) {
              if (typeof launchProfile === 'function') {
                try { await launchProfile(targetP.id); } catch (_) {}
              }
              await discordRequest(`/channels/${msg.channel_id}/messages`, 'POST', {
                content: `🚀 **[${resolveDeviceNickname()}] สั่งเปิดจอ [${targetP.name}] เรียบร้อยแล้ว!**`,
                message_reference: { message_id: msg.id }
              }, token);
            }
            return;
          }
        }
      }
    }

    // Match "1", "2", "3", "4" or "!ans 1" or "ตอบ 1" or "ข้อ 1"
    const match = text.match(/^(?:!ans\s+|ตอบ\s*|ข้อ\s*|เลือก\s*)?([1-6])$/i);
    if (!match) return;

    const pickNum = parseInt(match[1], 10);
    const pickIndex = pickNum - 1;

    // Find active check: match explicit reply first, or fall back to most recent active check within 5 minutes
    let targetProfileId = null;
    let newestTime = 0;
    const refId = msg.message_reference?.message_id;
    if (refId) {
      for (const [pId, info] of activeChecks.entries()) {
        if ((info.messageId === refId || info.wrongMessageId === refId) && Date.now() - info.notifiedAt <= 300000 && info.notifiedAt > newestTime) {
          newestTime = info.notifiedAt;
          targetProfileId = pId;
        }
      }
    }
    if (!targetProfileId && !refId) {
      for (const [pId, info] of activeChecks.entries()) {
        if (Date.now() - info.notifiedAt <= 300000 && info.notifiedAt > newestTime) {
          newestTime = info.notifiedAt;
          targetProfileId = pId;
        }
      }
    }

    if (!targetProfileId) {
      // No active check registered
      return;
    }

    const nick = resolveDeviceNickname();
    const helperName = msg.member?.nick || msg.author?.global_name || msg.author?.username || 'ผู้ช่วยในห้อง';
    const active = activeChecks.get(targetProfileId);
    const profiles = typeof loadProfiles === 'function' ? (loadProfiles() || []) : [];
    const profileObj = profiles.find(p => p && p.id === targetProfileId) || null;
    const charName = profileObj ? (profileObj.liveState?.charName || profileObj.lastCharName || profileObj.name) : targetProfileId;
    const screenLabel = profileObj ? `**${charName}** (${profileObj.name})` : `**${targetProfileId}**`;

    active.solvedManually = true;
    active.solvedBy = helperName;

    const result = await answerCheckInGame(
      targetProfileId,
      pickIndex,
      '',
      { id: active.checkId, prompt: active.prompt },
      { manual: true, answeredBy: helperName }
    );
    let replyText = '';
    if (result.success) {
      const verify = await verifyHumanCheckAnswerInGame(targetProfileId, { waitMs: 1200, maxWaitMs: 5800 });
      if (verify && !verify.stillOpen) {
        activeChecks.delete(targetProfileId);
        replyText = `✅ **[${nick} · ผู้ตอบ: ${helperName}]** เลือก **ตัวเลือกที่ ${pickNum}** ให้จอ ${screenLabel} — **ยืนยันผล (Confirm): ตอบถูก!** 🎉`;
      } else if (verify && verify.stillOpen && !verify.lagUnconfirmed) {
        const metaNote = verify.metaText ? ` (${verify.metaText})` : '';
        replyText = `❌ **[${nick} · ผู้ตอบ: ${helperName}]** เลือก **ตัวเลือกที่ ${pickNum}** ให้จอ ${screenLabel} — **ยืนยันผล (Confirm): ตอบผิด!** ⚠️${metaNote}`;
        if (profileObj) {
          await notifyHumanCheckWrongAttempt({
            profile: profileObj,
            attempt: {
              timestamp: Date.now(),
              checkId: active.checkId,
              prompt: active.prompt,
              pickIndex,
              slot: pickNum,
              x: result.x ?? null,
              y: result.y ?? null,
              manual: true,
              answeredBy: helperName,
              triesLeftBefore: verify.solved?.triesLeftBefore ?? 1,
              triesLeftAfter: verify.triesLeft,
              metaText: verify.metaText,
              imageDataUrl: verify.imageDataUrl
            }
          });
        }
      } else {
        replyText = `✅ **[${nick} · ผู้ตอบ: ${helperName}]** เลือก **ตัวเลือกที่ ${pickNum}** ให้จอ ${screenLabel} เรียบร้อยแล้ว!`;
      }
    } else {
      replyText = `⚠️ [${nick} · ผู้ตอบ: ${helperName}] สั่งตอบให้จอ ${screenLabel} ไม่สำเร็จ: ${result.error}`;
    }

    await discordRequest(
      `/channels/${msg.channel_id}/messages`,
      'POST',
      {
        content: replyText,
        message_reference: { message_id: msg.id }
      },
      token
    );
  }

  // Notify Discord about an active human check & execute Auto-Answer if enabled
  async function notifyHumanCheck({ profile, check }) {
    const cfg = loadSettings();
    let hcSettings = { autoAnswer: false, pointSystemEnabled: true, points: 0, pointsPerSolve: 1 };
    try {
      if (solver && typeof solver.loadSettings === 'function') hcSettings = solver.loadSettings() || hcSettings;
    } catch (err) {
      console.warn('[HumanCheckSolver] Cannot verify point balance; auto-answer disabled.');
    }

    // If both Discord alert and Auto-Answer are disabled, nothing to do
    if (!cfg.enabled && !hcSettings.autoAnswer) return;

    const profileId = profile.id;
    const now = Date.now();

    // Avoid duplicate alerts for the exact same check prompt within 90 seconds
    const existing = activeChecks.get(profileId);
    if (existing && existing.fingerprint === questionFingerprint(check) && (now - existing.notifiedAt < 90000)) {
      return;
    }

    // Decode composite image preview if available from game client
    let fileAttachment = null;
    if (check.imageDataUrl && typeof check.imageDataUrl === 'string' && check.imageDataUrl.startsWith('data:image/')) {
      try {
        const base64Str = check.imageDataUrl.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
        const buf = Buffer.from(base64Str, 'base64');
        if (buf.length > 200) {
          fileAttachment = {
            buffer: buf,
            filename: 'human_check.png',
            contentType: 'image/png'
          };
        }
      } catch (e) {
        console.warn('[Discord Bot] Failed to decode imageDataUrl:', e.message);
      }
    }

    // Manual alerts use only option positions; board checks default to 4 options (left-to-right 1..4)
    const rawOptions = (Array.isArray(check.options) && check.options.length > 0)
      ? check.options
      : [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }];
    const resolvedOptions = rawOptions.map((o, i) => ({
      index: o.index != null ? o.index : i,
      label: `ตัวเลือกที่ ${i + 1}`,
      itemName: `ตัวเลือกที่ ${i + 1}`
    }));

    const nonce = crypto.randomBytes(12).toString('hex');
    const trackedRecord = {
      profileId,
      checkId: check.id ?? null,
      fingerprint: questionFingerprint(check),
      nonce,
      requestId: null,
      prompt: check.prompt,
      notifiedAt: now,
      options: resolvedOptions
    };
    activeChecks.set(profileId, trackedRecord);
    recentNonces.set(nonce, trackedRecord);
    for (const [k, v] of recentNonces.entries()) {
      if (now - v.notifiedAt > 600000) recentNonces.delete(k);
    }

    const trackedCheck = activeChecks.get(profileId);
    const charName = profile.liveState?.charName || profile.lastCharName || profile.name;
    const promptText = check.prompt || '(ไม่มีข้อความโจทย์)';
    let metaText = check.meta || '';
    const optionsCount = resolvedOptions.length || 4;
    const nick = resolveDeviceNickname();

    let pointMessage = '';
    let manualReason = '';
    let lastAttemptedSolved = null;
    let lastWrongAttempt = null;

    const autoAnswerEnabled = (hcSettings.autoAnswer && cfg.autoAnswer !== false);
    if (!autoAnswerEnabled) {
      manualReason = 'ไม่ได้เปิด Auto Captcha';
      pointMessage = 'ℹ️ **สถานะ:** ไม่ได้เปิดระบบตอบอัตโนมัติ (Auto Captcha) ไว้ — กรุณาเลือกตอบด้วยตนเองผ่านปุ่มด้านล่าง';
    }

    // Catalog matches work offline; points are display data and never gate Humancheck.
    const shouldAutoAnswer = autoAnswerEnabled && (solver?.isRemoteService === true || Boolean(check.embeddedSolver) || Boolean(check.isBoard));
    if (shouldAutoAnswer) {
      const baseDelay = parseInt(hcSettings.answerDelayMs || cfg.answerDelayMs, 10) || 1800;
      const jitter = Math.floor(Math.random() * 600) - 250;
      const delayMs = Math.max(800, baseDelay + jitter);
      await new Promise(r => setTimeout(r, delayMs));

      let solution = { success: false };
      let ansRes = { success: false, error: 'ไม่สามารถยืนยันสิทธิ์ตอบอัตโนมัติได้' };

      if (check.embeddedSolver || check.isBoard) {
        const isTest = !!(process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test');
        const maxPolls = isTest ? 3 : 6;
        let retriedAutoLag = false;
        let triedManagerBoardSolve = false;
        for (let pollIdx = 0; pollIdx < maxPolls; pollIdx++) {
          await new Promise(r => setTimeout(r, pollIdx === 0 ? (isTest ? 700 : 1100) : (isTest ? 2100 : 1200)));
          if (trackedCheck.solvedManually) return;
          if (activeChecks.get(profileId) !== trackedCheck) {
            // If server.js live-state polling already cleared activeChecks because .human-check closed, try reading __lastHumanCheckSolved once to send the green alert
            if (profile.debugPort && typeof evalProfilePort === 'function') {
              try {
                const probe = await evalProfilePort(profile.debugPort, `(() => ({ stillOpen: !!document.querySelector('.human-check'), solved: window.__lastHumanCheckSolved || null }))()`);
                const st = probe && probe.result ? probe.result : null;
                if (st?.solved?.manual || trackedCheck.solvedManually) return;
                if (st && !st.stillOpen && st.solved && (Date.now() - (st.solved.timestamp || 0) < 30000)) {
                  const s = st.solved;
                  lastAttemptedSolved = s;
                  const pickIdx = Number.isInteger(s.pickIndex) && s.pickIndex >= 0 ? s.pickIndex : (Number.isInteger(s.slot) && s.slot >= 1 ? s.slot - 1 : 0);
                  solution = {
                    success: true,
                    pickIndex: pickIdx,
                    matchedName: s.matchedName || `ตัวเลือกที่ ${pickIdx + 1}`,
                    x: s.x,
                    y: s.y,
                    confidence: s.confidence,
                    charged: 0,
                    remaining: 0,
                    source: 'local-catalog'
                  };
                  ansRes = { success: true, picked: pickIdx };
                }
              } catch (e) {}
            }
            if (!ansRes.success) return;
            break;
          }
          if (profile.debugPort && typeof evalProfilePort === 'function') {
            try {
              const probe = await evalProfilePort(profile.debugPort, `(() => {
                const hc = document.querySelector('.human-check');
                const metaEl = hc ? hc.querySelector('.human-check-meta') : null;
                const metaText = (metaEl && typeof metaEl.innerText === 'string') ? metaEl.innerText.trim() : '';
                return { stillOpen: !!hc, metaText, solved: window.__lastHumanCheckSolved || null };
              })()`);
              const st = probe && probe.result ? probe.result : null;
              if (st?.solved?.manual || trackedCheck.solvedManually) return;
              if (st?.solved && (Date.now() - (st.solved.timestamp || 0) < 30000)) {
                lastAttemptedSolved = st.solved;
                if (st.metaText) metaText = st.metaText;
              }
              if (st && !st.stillOpen) {
                const s = st.solved || lastAttemptedSolved || {};
                lastAttemptedSolved = s;
                const pickIdx = Number.isInteger(s.pickIndex) && s.pickIndex >= 0 ? s.pickIndex : (Number.isInteger(s.slot) && s.slot >= 1 ? s.slot - 1 : 0);
                solution = {
                  success: true,
                  pickIndex: pickIdx,
                  matchedName: s.matchedName || `ตัวเลือกที่ ${pickIdx + 1}`,
                  x: s.x,
                  y: s.y,
                  confidence: s.confidence,
                  charged: 0,
                  remaining: 0,
                  source: 'local-catalog'
                };
                ansRes = { success: true, picked: pickIdx };
                break;
              } else if (st && st.stillOpen && (!st.solved || (Date.now() - (st.solved.timestamp || 0) >= 20000)) && !triedManagerBoardSolve && pollIdx <= 1) {
                // In-game solver hasn't fired yet (e.g. older bot.js or missing packet listener): trigger in-game solver or Manager-side board solver fallback
                triedManagerBoardSolve = true;
                try {
                  if (IMAGE_BOARD_SOLVER_JS) {
                    await evalProfilePort(profile.debugPort, `(() => {
                      if (!window.PmheeImageBoardSolver || typeof window.PmheeImageBoardSolver.solveFrameChallenge !== 'function') {
                        ${IMAGE_BOARD_SOLVER_JS}
                      }
                      return Boolean(window.PmheeImageBoardSolver && typeof window.PmheeImageBoardSolver.solveFrameChallenge === 'function');
                    })()`, 2500);
                  }
                  const fallbackProbe = await evalProfilePort(profile.debugPort, `(() => {
                    try { if (typeof window.__pmSolveEmbeddedHumanCheck === 'function') window.__pmSolveEmbeddedHumanCheck(); } catch (_) {}
                    const hc = document.querySelector('.human-check');
                    if (!hc) return { solved: window.__lastHumanCheckSolved || null };
                    const boardImg = hc.querySelector('.human-check-board img');
                    if (!boardImg || !(boardImg.naturalWidth > 0 || boardImg.width > 0)) return { solved: window.__lastHumanCheckSolved || null };
                    if (window.PmheeImageBoardSolver && typeof window.PmheeImageBoardSolver.solveFrameChallenge === 'function') {
                      const bw = boardImg.naturalWidth || boardImg.width || 480;
                      const bh = boardImg.naturalHeight || boardImg.height || 330;
                      const c = document.createElement('canvas');
                      c.width = bw; c.height = bh;
                      const ctx = c.getContext('2d');
                      ctx.drawImage(boardImg, 0, 0, bw, bh);
                      const imgData = ctx.getImageData(0, 0, bw, bh);
                      const sol = window.PmheeImageBoardSolver.solveFrameChallenge({ width: bw, height: bh, data: imgData.data });
                      if (sol && sol.slot >= 1 && sol.slot <= 4) {
                        return { frameSol: { pickIndex: sol.slot - 1, slot: sol.slot, x: sol.x, y: sol.y, confidence: sol.confidence } };
                      }
                    }
                    return { solved: window.__lastHumanCheckSolved || null };
                  })()`, 2500);
                  const fbRes = fallbackProbe?.result || null;
                  if (fbRes?.frameSol && Number.isInteger(fbRes.frameSol.pickIndex)) {
                    const fsObj = fbRes.frameSol;
                    const itemMatch = promptText.replace(/^(กรุณา)?(คลิกที่รูปภาพของ|คลิกที่ภาพ|กดที่รูปภาพของ|กดที่ภาพ|กดรูป|เลือกรูปภาพของ|เลือกรูป|เลือก)\s*/i, '').replace(/\s*(ภายในเวลา.*)?$/i, '').trim();
                    const matchedLabel = itemMatch
                      ? `${itemMatch} (ตัวเลือกที่ ${fsObj.slot}${fsObj.confidence ? ` · ความแม่นยำ ${fsObj.confidence}%` : ''})`
                      : `ตัวเลือกที่ ${fsObj.slot}`;
                    const clickRes = await answerCheckInGame(profileId, fsObj.pickIndex, matchedLabel, { id: trackedCheck.checkId, prompt: trackedCheck.prompt });
                    if (clickRes && clickRes.success) {
                      lastAttemptedSolved = {
                        pickIndex: fsObj.pickIndex,
                        slot: fsObj.slot,
                        x: clickRes.x ?? fsObj.x,
                        y: clickRes.y ?? fsObj.y,
                        confidence: fsObj.confidence,
                        matchedName: matchedLabel,
                        annotatedImageDataUrl: clickRes.annotatedImageDataUrl || null,
                        timestamp: Date.now()
                      };
                    }
                  }
                } catch (_) {}
              } else if (st && st.stillOpen && st.solved && !st.solved.manual) {
                const elapsedSinceSolve = Date.now() - (st.solved.timestamp || 0);
                const mText = st.metaText || check.meta || '';
                if (mText) metaText = mText;
                const triesMatch = mText.match(/ตอบผิดได้อีก\s*(\d+)/);
                const triesLeftAfter = triesMatch ? Number(triesMatch[1]) : null;
                const triesBefore = st.solved.triesLeftBefore ?? 1;
                const triesDropped = (triesLeftAfter != null && triesBefore != null && triesLeftAfter < triesBefore);

                // Only report a wrong attempt if triesLeft actually dropped (e.g. 1 -> 0) OR in unit tests / final poll without tries counter
                if ((triesDropped && elapsedSinceSolve >= 1200) || (isTest && elapsedSinceSolve >= 850) || (pollIdx === maxPolls - 1 && triesLeftAfter == null && elapsedSinceSolve >= 4500)) {
                  lastWrongAttempt = {
                    ...st.solved,
                    checkId: check.id ?? st.solved.checkId ?? null,
                    prompt: check.prompt || st.solved.prompt || '',
                    triesLeftBefore: triesBefore,
                    triesLeftAfter,
                    metaText: mText,
                    imageDataUrl: st.solved.annotatedImageDataUrl || check.imageDataUrl || null
                  };
                  await notifyHumanCheckWrongAttempt({ profile, attempt: lastWrongAttempt });
                } else if (!triesDropped && !retriedAutoLag && elapsedSinceSolve >= 2200) {
                  // Game is lagging and triesLeft is still 1 -> re-send the answer packet once so lag doesn't drop the click
                  retriedAutoLag = true;
                  try {
                    await evalProfilePort(profile.debugPort, `(() => {
                      const hc = document.querySelector('.human-check');
                      const s = window.__lastHumanCheckSolved;
                      const packet = window.__latestHumanCheck;
                      if (!hc || !s) return false;
                      const room = (typeof window.getColyseusRoom === 'function' ? window.getColyseusRoom() : null)
                        || (typeof window.getGameRoom === 'function' ? window.getGameRoom() : null)
                        || window.__colyseusRoom || window.__gameRoom || null;
                      if (room && typeof room.send === 'function' && packet && packet.id != null && typeof s.x === 'number' && typeof s.y === 'number') {
                        room.send('human_check_answer', { id: packet.id, x: s.x, y: s.y });
                        return true;
                      }
                      return false;
                    })()`, 2000);
                  } catch (_) {}
                }
              }
            } catch (e) {}
          }
        }
        if (!ansRes.success) {
          const attempted = lastWrongAttempt || lastAttemptedSolved;
          const attemptedSlot = attempted ? (Number.isInteger(attempted.slot) && attempted.slot >= 1 ? attempted.slot : (Number.isInteger(attempted.pickIndex) ? attempted.pickIndex + 1 : null)) : null;
          const attemptedName = attempted?.matchedName || (attemptedSlot ? `ตัวเลือกที่ ${attemptedSlot}` : '');
          const attemptedCoords = (typeof attempted?.x === 'number' && typeof attempted?.y === 'number') ? ` (พิกัด ${attempted.x}, ${attempted.y})` : '';
          if (lastWrongAttempt && attemptedSlot) {
            manualReason = `ตอบผิด (บอทเลือกข้อ ${attemptedSlot})`;
            pointMessage = `🎯 **ระบบจับคู่อัตโนมัติ (ผู้ตอบ: บอท Auto-Solver):**\n❌ **เลือกตัวเลือกที่ ${attemptedSlot}:** **${attemptedName}**${attemptedCoords} -> **ยืนยันผล (Confirm): ตอบผิด!** (แจ้งเตือนไปที่ห้องตอบผิดแล้ว)\n⚠️ กรุณาเลือกคำตอบที่ถูกต้องด้วยตนเองผ่านปุ่มด้านล่าง`;
          } else if (attemptedSlot) {
            manualReason = `บอทเลือกข้อ ${attemptedSlot} แล้วแต่หน้าต่างยังไม่ปิด`;
            pointMessage = `🎯 **ระบบจับคู่อัตโนมัติ (ผู้ตอบ: บอท Auto-Solver):**\n🤖 **เลือกตัวเลือกที่ ${attemptedSlot}:** **${attemptedName}**${attemptedCoords} -> **กดส่งคำตอบแล้ว แต่หน้าต่างเช็คผู้เล่นยังไม่ปิด** (อาจเกิดจากเกมแลคหรือรอเซิร์ฟเวอร์ตอบรับ)\n⚠️ กรุณาตรวจสอบหรือเลือกตอบซ้ำด้วยตนเองผ่านปุ่มด้านล่าง`;
          } else {
            manualReason = 'รอผู้เล่นช่วยตรวจสอบคำตอบ';
            pointMessage = '⚠️ ระบบพยายามตอบอัตโนมัติแล้วแต่หน้าต่างเช็คผู้เล่นยังไม่ปิด กรุณาเลือกตอบด้วยตนเองผ่านปุ่มด้านล่าง';
          }
        }
      } else {
        try {
          const latestSettings = solver.loadSettings();
          if (activeChecks.get(profileId) === trackedCheck && latestSettings?.autoAnswer && loadSettings().autoAnswer !== false && typeof solver.solveHumanCheck === 'function') {
            trackedCheck.requestId = durableRequestId(profileId, check);
            solution = await solver.solveHumanCheck(check.prompt, check.options, check.items, trackedCheck.requestId);
            // The service bills for analysis. Game transport errors never refund that analysis.
            const authorized = solution?.success === true && [0, 1].includes(solution.charged) && solution.requestId === trackedCheck.requestId && Number.isInteger(solution.pickIndex) && solution.pickIndex >= 0 && solution.pickIndex < optionsCount;
            if (activeChecks.get(profileId) !== trackedCheck) return;
            const stillEnabled = solver.loadSettings()?.autoAnswer && loadSettings().autoAnswer !== false;
            if (authorized && stillEnabled) {
              ansRes = await answerCheckInGame(profileId, solution.pickIndex, solution.matchedName, { id: trackedCheck.checkId, prompt: trackedCheck.prompt });
              if (ansRes && ansRes.success) {
                lastAttemptedSolved = {
                  pickIndex: solution.pickIndex,
                  slot: solution.pickIndex + 1,
                  x: ansRes.x,
                  y: ansRes.y,
                  matchedName: solution.matchedName,
                  annotatedImageDataUrl: ansRes.annotatedImageDataUrl || null
                };
              }
            } else {
              if (!stillEnabled) {
                manualReason = 'ปิดการตอบอัตโนมัติแล้ว';
                pointMessage = 'ℹ️ ปิด Auto Humancheck แล้ว กรุณาตอบด้วยตนเองผ่านปุ่มด้านล่าง';
              } else if (solution?.code === 'INSUFFICIENT_POINTS' || solution?.status === 402) {
                manualReason = 'ส่วนบุญไม่เพียงพอ';
                pointMessage = '⚠️ เซิร์ฟเวอร์แจ้งว่า ส่วนบุญไม่เพียงพอ กรุณาตอบด้วยตนเองหรือเติมส่วนบุญ ใน Manager';
              } else if (solution?.code === 'NO_MATCH' || solution?.code === 'MANUAL_REQUIRED') {
                manualReason = 'จับคู่คำตอบไม่สำเร็จ';
                pointMessage = '⚠️ ระบบจับคู่คำตอบไม่สำเร็จ กรุณาตอบด้วยตนเองผ่านปุ่มด้านล่าง';
              } else if (solution?.code === 'INVALID_SERVICE_RESPONSE' || solution?.success === true) {
                manualReason = 'ตรวจสอบคำตอบจาก API ไม่ผ่าน';
                pointMessage = '⚠️ ไม่สามารถยืนยันคำตอบจาก API ได้ กรุณาตอบด้วยตนเองผ่านปุ่มด้านล่าง';
              } else {
                manualReason = solution?.code === 'MAINTENANCE' ? 'API กำลังปรับปรุง' : 'บริการ API ขัดข้อง';
                pointMessage = '⚠️ บริการ Auto Humancheck ไม่พร้อมใช้งานชั่วคราว กรุณาตอบด้วยตนเองผ่านปุ่มด้านล่าง';
              }
              ansRes = { success: false, error: 'บริการส่วนกลางไม่อนุมัติคำตอบ หรือปิดการตอบอัตโนมัติแล้ว' };
            }
          }
        } catch (err) {
          manualReason = 'การเชื่อมต่อขัดข้อง';
          pointMessage = '⚠️ ไม่สามารถยืนยันคำตอบจากบริการส่วนกลางได้ กรุณาตอบด้วยตนเองผ่านปุ่มด้านล่าง';
          console.warn('[PmheeAether HumanCheck] Remote authorization unavailable; auto-answer disabled.');
        }
      }

      if (ansRes && ansRes.success) {
        if (trackedCheck.solvedManually) return;
        console.log(`[Discord Bot] ✅ Auto-answer succeeded for [${profile.name}]! Picked #${solution.pickIndex + 1} (${solution.matchedName})`);

        // If the solver generated an annotated board image (highlighting the chosen slot in green), attach that!
        if (lastAttemptedSolved?.annotatedImageDataUrl && typeof lastAttemptedSolved.annotatedImageDataUrl === 'string') {
          try {
            const m = lastAttemptedSolved.annotatedImageDataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
            if (m) {
              fileAttachment = {
                buffer: Buffer.from(m[2], 'base64'),
                filename: 'human_check.png',
                contentType: `image/${m[1]}`
              };
            }
          } catch (_) {}
        }

        const coordSuffix = (typeof (solution.x ?? lastAttemptedSolved?.x) === 'number' && typeof (solution.y ?? lastAttemptedSolved?.y) === 'number')
          ? ` (พิกัด ${solution.x ?? lastAttemptedSolved.x}, ${solution.y ?? lastAttemptedSolved.y})`
          : '';

        // Send Success Notification to Discord
        const optionsList = resolvedOptions.map((opt, i) => {
          const isChosen = (opt.index === solution.pickIndex);
          const icon = isChosen ? '✅' : '⚪';
          const highlight = isChosen ? `**ข้อ ${i + 1}: ${opt.itemName}** 👈 *(ระบบเลือกข้อนี้${coordSuffix})*` : `ข้อ ${i + 1}: ${opt.itemName}`;
          return `${icon} ${highlight}`;
        }).join('\n');

        const pointDeductText = (solution.charged === 1)
          ? `\n🪙 **ส่วนบุญคงเหลือ:** **${solution.remaining}**`
          : '\n🪙 **ไม่มีค่าต่อคำตอบ:** ไม่หักส่วนบุญ สำหรับ Humancheck';

        const embed = {
          title: `🤖 [Auto Human Check] ตรวจพบและตอบเช็คผู้เล่นสำเร็จ! (✅ ยืนยันผล: ตอบถูก!)`,
          description: `💻 **เครื่อง:** \`${nick}\`\n🎮 **จอเกม:** \`${profile.name}\` (ตัวละคร: **${charName}**)\n\n### ❓ โจทย์คำถาม:\n> **${promptText}**\n\n🎯 **ระบบจับคู่อัตโนมัติ (ผู้ตอบ: บอท Auto-Solver):**\n✅ เลือกตัวเลือกที่ **${solution.pickIndex + 1}**: **${solution.matchedName}**${coordSuffix} (${solution.source === 'local-catalog' ? 'แคตตาล็อกในเครื่อง' : 'บริการส่วนกลาง'})\n🎉 **ยืนยันผล (Confirm):** **ตอบถูก!** (หน้าต่างเช็คผู้เล่นปิดลงเรียบร้อยแล้ว)\n⏱️ หน่วงเวลาตอบ: **${delayMs} ms** (เลียนแบบผู้เล่น)${pointDeductText}`,
          color: 0x10B981, // Emerald Green
          fields: [
            {
              name: `📋 ตัวเลือกรูปภาพ (${optionsCount} ตัวเลือก):`,
              value: optionsList || '(ไม่มีข้อมูล)',
              inline: false
            }
          ],
          footer: { text: `Aetheria Online · เครื่อง: ${nick} · จอ #${profile.name}` },
          timestamp: new Date().toISOString()
        };

        if (fileAttachment) {
          embed.image = { url: 'attachment://human_check.png' };
        }

        let sent = false;
        if (cfg.botToken && cfg.channelId) {
          const res = await discordRequest(`/channels/${cfg.channelId}/messages`, 'POST', {
            content: `🤖 **[Auto-Solver · เครื่อง: ${nick}]** จอ **${charName}** (${profile.name}) มีโจทย์เช็คผู้เล่น -> บอทเลือก **"${solution.matchedName}"**${coordSuffix} — ✅ **ยืนยันผล: ตอบถูก!**`,
            embeds: [embed]
          }, cfg.botToken, fileAttachment);
          if (res && res.success) sent = true;
        }
        if (!sent && cfg.webhookUrl) {
          await discordRequest(cfg.webhookUrl, 'POST', {
            username: `PmheeAether (${nick})`,
            avatar_url: 'https://raw.githubusercontent.com/thegopza/aetheria-pelican-bot/main/manager/public/icon.png',
            content: `🤖 **[Auto-Solver · เครื่อง: ${nick}]** จอ **${charName}** (${profile.name}) ตอบเช็คผู้เล่นอัตโนมัติสำเร็จ -> บอทเลือก **"${solution.matchedName}"**${coordSuffix} (✅ ยืนยันผล: ตอบถูก!)`,
            embeds: [embed]
          }, null, fileAttachment);
        }
        return;
      } else {
        if (!manualReason) {
          manualReason = 'ส่งคำตอบเข้าเกมไม่สำเร็จ';
          pointMessage = '⚠️ ส่งคำตอบเข้าเกมไม่สำเร็จ กรุณาตอบด้วยตนเองผ่านปุ่มด้านล่าง';
        }
        console.warn(`[Discord Bot] ⚠️ Auto-answer execution returned error: ${ansRes?.error}. Falling back to manual alert.`);
      }
    }

    if (activeChecks.get(profileId) !== trackedCheck || trackedCheck.solvedManually) return;

    // Fallback or Manual Mode: Send Urgent Alert with Interactive Buttons & Real Item Names & Card Image
    if (cfg.autoBringToFront && typeof focusProfileWindow === 'function') {
      try { focusProfileWindow(profileId); } catch (e) {}
    }

    const attemptedInfo = (typeof lastWrongAttempt !== 'undefined' && lastWrongAttempt)
      || (typeof lastAttemptedSolved !== 'undefined' && lastAttemptedSolved)
      || null;
    const attemptedSlotNum = attemptedInfo
      ? (Number.isInteger(attemptedInfo.slot) && attemptedInfo.slot >= 1 ? attemptedInfo.slot : (Number.isInteger(attemptedInfo.pickIndex) ? attemptedInfo.pickIndex + 1 : null))
      : null;
    const attemptedIsWrong = Boolean(typeof lastWrongAttempt !== 'undefined' && lastWrongAttempt && attemptedSlotNum);

    if (attemptedInfo && (attemptedInfo.imageDataUrl || attemptedInfo.annotatedImageDataUrl)) {
      try {
        const dataUrl = attemptedInfo.imageDataUrl || attemptedInfo.annotatedImageDataUrl;
        const m = typeof dataUrl === 'string' ? dataUrl.match(/^data:image\/(\w+);base64,(.+)$/) : null;
        if (m) {
          fileAttachment = {
            buffer: Buffer.from(m[2], 'base64'),
            filename: 'human_check.png',
            contentType: `image/${m[1]}`
          };
        }
      } catch (_) {}
    }

    const embed = {
      title: `🚨 ตรวจพบเช็คผู้เล่น (Human Check)!`,
      description: `💻 **เครื่อง:** \`${nick}\`\n🎮 **จอเกม:** \`${profile.name}\` (ตัวละคร: **${charName}**)\n\n### ❓ โจทย์คำถาม:\n> **${promptText}**\n\n⏱️ **สถานะ:** ${metaText || 'กรุณาตอบภายในเวลา มิฉะนั้นจะถูกส่งเข้าคุก!'}` +
        (pointMessage ? `\n\n${pointMessage}` : '') + '\n\n👉 **วิธีตอบ:** กดปุ่มตัวเลือกด้านล่าง หรือ Reply ข้อความนี้แล้วพิมพ์เลขข้อ',
      color: 0xEF4444, // Red
      fields: [],
      footer: { text: `Aetheria Online · เครื่อง: ${nick} · จอ #${profile.name}` },
      timestamp: new Date().toISOString()
    };

    if (fileAttachment) {
      embed.image = { url: 'attachment://human_check.png' };
    }

    const optionDescriptions = resolvedOptions.map((opt, i) => {
      const slotNum = i + 1;
      if (attemptedSlotNum === slotNum) {
        return attemptedIsWrong
          ? `❌ **${slotNum}️⃣ ตัวเลือกที่ ${slotNum}** 👈 *(ระบบเลือกข้อนี้ — ตอบผิด)*`
          : `🤖 **${slotNum}️⃣ ตัวเลือกที่ ${slotNum}** 👈 *(ระบบเลือกข้อนี้ไปแล้ว)*`;
      }
      return `**${slotNum}️⃣** ตัวเลือกที่ ${slotNum}`;
    }).join('\n');

    if (optionDescriptions) {
      embed.fields.push({
        name: `📋 ตัวเลือกรูปภาพ (${optionsCount} ตัวเลือก):`,
        value: optionDescriptions,
        inline: false
      });
    }

    // Build Interactive Buttons (with item names and recommended star)
    let components = [];
    if (cfg.enabled && cfg.botToken && cfg.channelId) {
      const buttons = [];
      for (let i = 0; i < optionsCount; i++) {
        const opt = resolvedOptions[i] || {};
        const slotNum = i + 1;
        const isAttempted = (attemptedSlotNum === slotNum);
        const labelText = isAttempted
          ? (attemptedIsWrong ? `ตัวเลือกที่ ${slotNum} (บอทเลือก-ผิด)` : `ตัวเลือกที่ ${slotNum} (บอทเลือกข้อนี้)`)
          : `ตัวเลือกที่ ${slotNum}`;
        buttons.push({
          type: 2, // Button
          style: isAttempted && attemptedIsWrong ? 4 : 1,
          label: labelText,
          custom_id: `hc:${profileId}:${opt.index != null ? opt.index : i}:${trackedCheck.nonce}`
        });
      }

      components.push({
        type: 1, // Action Row
        components: buttons
      });

      components.push({
        type: 1,
        components: [
          {
            type: 2,
            style: 4, // Danger (Red)
            label: '🖥️ ดึงจอเกมขึ้นหน้าสุด',
            custom_id: `hc:${profileId}:focus:${trackedCheck.nonce}`
          }
        ]
      });
    }

    // Send via Bot Token (to channel) or Webhook with image attachment
    if (cfg.enabled) {
      const reasonBadge = manualReason ? `[${manualReason}] ` : '';
      let sent = false;
      if (cfg.botToken && cfg.channelId) {
        const payload = {
          content: `🚨 **แจ้งเตือนด่วน [เครื่อง: ${nick}]** ${reasonBadge}จอ **${charName}** (${profile.name}) มีคำถามเช็คผู้เล่น! กดปุ่มด้านล่างเพื่อตอบได้ทันที:`,
          embeds: [embed],
          components
        };
        const res = await discordRequest(`/channels/${cfg.channelId}/messages`, 'POST', payload, cfg.botToken, fileAttachment);
        if (res && res.success) {
          sent = true;
          if (res.data?.id) {
            const info = activeChecks.get(profileId);
            if (info === trackedCheck) info.messageId = res.data.id;
          }
        }
      }
      if (!sent && cfg.webhookUrl) {
        const payload = {
          username: `PmheeAether (${nick})`,
          avatar_url: 'https://raw.githubusercontent.com/thegopza/aetheria-pelican-bot/main/manager/public/icon.png',
          content: `🚨 **แจ้งเตือนด่วน [เครื่อง: ${nick}]** ${reasonBadge}จอ **${charName}** (${profile.name}) มีคำถามเช็คผู้เล่น!`,
          embeds: [embed]
        };
        await discordRequest(cfg.webhookUrl, 'POST', payload, null, fileAttachment);
      }
    }
  }

  // Clear check when resolved in game
  function clearHumanCheck(profileId) {
    activeChecks.delete(profileId);
  }

  // Test Discord Message
  async function testNotification() {
    const cfg = loadSettings();
    if (!cfg.webhookUrl && (!cfg.botToken || !cfg.channelId)) {
      return { success: false, error: 'กรุณากรอก Webhook URL หรือ Bot Token + Channel ID ก่อนทดสอบ' };
    }

    const embed = {
      title: '🧪 ทดสอบการแจ้งเตือน Discord (PmheeAether Manager)',
      description: 'ระบบเชื่อมต่อ Discord สำเร็จเรียบร้อย! เมื่อมีคำถาม **เช็คผู้เล่น (Human Check)** เด้งขึ้นมาในเกม ระบบจะส่งข้อความแจ้งเตือนมายังห้องนี้ทันที',
      color: 0x10B981, // Emerald Green
      fields: [
        { name: '🖥️ โหมดการทำงาน', value: cfg.botToken ? '🤖 Discord Bot (รองรับปุ่มกดตอบโต้ในห้อง)' : '📢 Webhook (แจ้งเตือนข่าวสาร)', inline: true },
        { name: '🤖 ตอบอัตโนมัติ (Auto-Answer)', value: cfg.autoAnswer !== false ? `เปิดใช้งาน (หน่วง ${cfg.answerDelayMs || 1800}ms)` : 'ปิดใช้งาน', inline: true },
        { name: '🔔 ดึงจออัตโนมัติ', value: cfg.autoBringToFront ? 'เปิดใช้งาน' : 'ปิดใช้งาน', inline: true },
        { name: '🔊 เสียงเตือนในเครื่อง', value: cfg.soundAlert ? 'เปิดใช้งาน' : 'ปิดใช้งาน', inline: true },
        { name: '📚 ฐานข้อมูลไอเทม', value: solver && solver.isReady() ? 'พร้อมใช้งาน (1,160 รายการ)' : 'กำลังเตรียมข้อมูล...', inline: true }
      ],
      footer: { text: 'PmheeAether Manager · Discord Integration' },
      timestamp: new Date().toISOString()
    };

    const nick = resolveDeviceNickname();
    if (cfg.botToken && cfg.channelId) {
      const payload = {
        content: `👋 **[เครื่อง: ${nick}] ทดสอบการเชื่อมต่อสำเร็จ!**`,
        embeds: [embed],
        components: [
          {
            type: 1,
            components: [
              { type: 2, style: 1, label: 'ทดสอบปุ่ม 1', custom_id: 'hc_test_0' },
              { type: 2, style: 2, label: 'ทดสอบปุ่ม 2', custom_id: 'hc_test_1' }
            ]
          }
        ]
      };
      return await discordRequest(`/channels/${cfg.channelId}/messages`, 'POST', payload, cfg.botToken);
    } else if (cfg.webhookUrl) {
      const payload = {
        username: `PmheeAether (${nick})`,
        content: `👋 **[เครื่อง: ${nick}] ทดสอบการเชื่อมต่อสำเร็จ!**`,
        embeds: [embed]
      };
      return await discordRequest(cfg.webhookUrl, 'POST', payload);
    }
  }

  const townAlertCooldowns = new Map();

  async function notifyUnexpectedTown({ profile, unexpectedTown }) {
    const cfg = loadSettings();
    if (!cfg.enabled) return;

    const profileId = profile.id;
    const now = Date.now();
    const lastNotified = townAlertCooldowns.get(profileId) || 0;
    if (now - lastNotified < 5 * 60 * 1000) return; // at most once every 5 minutes per profile
    townAlertCooldowns.set(profileId, now);

    const remainingSec = Math.max(0, Math.ceil(((unexpectedTown.waitUntil || 0) - now) / 1000));
    const mm = Math.floor(remainingSec / 60);
    const ss = remainingSec % 60;
    const timeText = `${mm}:${ss < 10 ? '0' : ''}${ss} นาที`;
    const nick = resolveDeviceNickname();

    const embed = {
      title: '🚨 [เตือนภัยบอท] ตรวจพบตัวละครกลับเมืองโดยไม่ทราบสาเหตุ!',
      description: `💻 **เครื่อง:** \`${nick}\`\nตัวละคร **${profile.name}** กำลังอยู่ในเมืองหลวงโซลเฮเวนโดยตรวจไม่พบสาเหตุ\n(ไม่ได้เสียชีวิต / ไม่ได้กด Butterfly Wing / ไม่ได้กำลังเดินทางผ่านเมือง)\n\nระบบสั่งสุ่มพักรอนิรภัย **${timeText}** เพื่อความปลอดภัยสูงสุดของไอดี`,
      color: 0xEF4444,
      fields: [
        { name: '💻 เครื่อง', value: nick, inline: true },
        { name: '👤 จอโปรไฟล์', value: profile.name, inline: true },
        { name: '⏱️ ระยะเวลาพักรอ', value: timeText, inline: true },
        { name: '🛡️ สถานะระบบ', value: 'ระงับการเดินและรอครบเวลา หรือกดปุ่ม [ข้าม] ในหน้าจอเกม', inline: false }
      ],
      footer: { text: `PmheeAether Anti-Detection System · เครื่อง: ${nick} · Discord Alert` },
      timestamp: new Date().toISOString()
    };

    const webhookPayload = {
      username: `PmheeAether Security (${nick})`,
      avatar_url: 'https://raw.githubusercontent.com/thegopza/aetheria-pelican-bot/main/manager/public/icon.png',
      content: `🚨 **แจ้งเตือนความปลอดภัย [เครื่อง: ${nick}]:** ตรวจพบตัวละคร **${profile.name}** กลับเมืองโดยไม่ทราบสาเหตุ!`,
      embeds: [embed]
    };

    // If dedicated town webhook URL is configured, send EXCLUSIVELY to it!
    if (cfg.townWebhookUrl) {
      return await discordRequest(cfg.townWebhookUrl, 'POST', webhookPayload);
    }

    // Fallback: send via main bot token / main webhook if no dedicated webhook is configured
    if (cfg.botToken && cfg.channelId) {
      const payload = {
        content: `🚨 **แจ้งเตือนความปลอดภัย [เครื่อง: ${nick}]:** ตรวจพบตัวละคร **${profile.name}** กลับเมืองโดยไม่ทราบสาเหตุ!`,
        embeds: [embed]
      };
      return await discordRequest(`/channels/${cfg.channelId}/messages`, 'POST', payload, cfg.botToken);
    } else if (cfg.webhookUrl) {
      return await discordRequest(cfg.webhookUrl, 'POST', webhookPayload);
    }
  }

  async function testTownNotification(targetWebhookUrl) {
    const cfg = loadSettings();
    const url = (typeof targetWebhookUrl === 'string' && targetWebhookUrl.trim()) ? targetWebhookUrl.trim() : (cfg.townWebhookUrl || cfg.webhookUrl);
    if (!url) {
      return { success: false, error: 'กรุณากรอก Webhook URL สำหรับแจ้งเตือนกลับเมืองก่อนกดทดสอบ' };
    }
    const nick = resolveDeviceNickname();
    const embed = {
      title: '🚨 [ทดสอบระบบ] แจ้งเตือนความปลอดภัย (กลับเมืองโดยไม่ทราบสาเหตุ)',
      description: `💻 **เครื่อง:** \`${nick}\`\nนี่คือข้อความทดสอบการเชื่อมต่อ Webhook สำหรับระบบตรวจจับตัวละครกลับเมืองผิดปกติ\n\nเมื่อตรวจพบตัวละครกลับเมืองหลวงโดยไม่ได้กดวิงหรือตาย ระบบจะสั่งพักรอนิรภัยและส่งแจ้งเตือนมายังห้องนี้ทันที`,
      color: 0xF59E0B, // Amber
      fields: [
        { name: '💻 เครื่อง', value: nick, inline: true },
        { name: '📢 Webhook', value: 'ห้องแจ้งเตือนความปลอดภัยแยก', inline: true },
        { name: '⏱️ เวลาทดสอบ', value: new Date().toLocaleTimeString('th-TH'), inline: true }
      ],
      footer: { text: `PmheeAether Anti-Detection System · เครื่อง: ${nick} · Test Alert` },
      timestamp: new Date().toISOString()
    };
    const payload = {
      username: `PmheeAether Security (${nick})`,
      avatar_url: 'https://raw.githubusercontent.com/thegopza/aetheria-pelican-bot/main/manager/public/icon.png',
      content: `👋 **[เครื่อง: ${nick}] ทดสอบ Webhook แจ้งเตือนกลับเมืองสำเร็จ!**`,
      embeds: [embed]
    };
    return await discordRequest(url, 'POST', payload);
  }

  // Emergency stop notification when an updated / unknown Human Check format is detected
  async function notifyHumanCheckEmergency({ profile, check, reason = 'ตรวจพบ Human Check รูปแบบใหม่ (Image Board)' }) {
    const cfg = loadSettings();
    if (!cfg.enabled || !cfg.channelId) return;
    const nick = resolveDeviceNickname();
    const charName = profile.liveState?.charName || profile.lastCharName || profile.name;
    const promptText = check.prompt || '(ไม่มีข้อความโจทย์)';

    let fileAttachment = null;
    const imgSource = check.image || check.imageDataUrl;
    if (imgSource && typeof imgSource === 'string' && imgSource.startsWith('data:image/')) {
      try {
        const base64Str = imgSource.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
        const buf = Buffer.from(base64Str, 'base64');
        if (buf.length > 200) {
          fileAttachment = {
            buffer: buf,
            filename: 'human_check_new.png',
            contentType: 'image/png'
          };
        }
      } catch (_) {}
    }

    const embed = {
      title: '🚨🚨 [EMERGENCY STOP] สั่งปิดทุกจออัตโนมัติแล้ว! 🚨🚨',
      description: 'ระบบตรวจพบการอัปเดตรูปแบบคำถาม Human Check ใหม่จากเกม และได้ทำการ **"ปิดทุกจอในเครื่องทันที"** เรียบร้อยแล้ว เพื่อความปลอดภัยและป้องกันตัวละครถูกส่งเข้าคุก!',
      color: 0xef4444,
      fields: [
        { name: '🖥️ เครื่อง', value: `\`${nick}\``, inline: true },
        { name: '👤 จอที่พบปัญหา', value: `**${charName}** (\`${profile.id}\`)`, inline: true },
        { name: '❓ โจทย์คำถาม', value: `\`${promptText}\``, inline: false },
        { name: '⚠️ สาเหตุ', value: reason, inline: false },
        { name: '🛑 สถานะ', value: 'สั่งปิดจอทุกจอในเครื่องเรียบร้อยแล้ว ปลอดภัย 100%', inline: false }
      ],
      footer: { text: `PmheeAether Anti-Jail Safety System · เครื่อง: ${nick}` },
      timestamp: new Date().toISOString()
    };

    if (fileAttachment) {
      embed.image = { url: 'attachment://human_check_new.png' };
    }

    await discordRequest(
      `/channels/${cfg.channelId}/messages`,
      'POST',
      {
        content: `🚨 **[@everyone Emergency Stop · เครื่อง: ${nick}]** ตรวจพบโจทย์เช็คผู้เล่นรูปแบบใหม่ — ปิดทุกจออัตโนมัติแล้ว!`,
        embeds: [embed]
      },
      cfg.botToken,
      fileAttachment
    );
  }

  // Initialize gateway on startup
  syncGatewayConnection();

  return {
    loadSettings,
    saveSettings,
    notifyHumanCheck,
    notifyHumanCheckWrongAttempt,
    verifyHumanCheckAnswerInGame,
    notifyHumanCheckEmergency,
    notifyUnexpectedTown,
    clearHumanCheck,
    answerCheckInGame,
    testNotification,
    testTownNotification,
    syncGatewayConnection,
    getDeviceNickname: resolveDeviceNickname,
    setDeviceNickname
  };
}

module.exports = { createDiscordBotService };
