
// ==========================================
// WEB CONFIG MODAL (EXPORT & IMPORT FOR WEB HUD)
// ==========================================
function openWebConfigModal(profileId, mode, preloadedJson = '') {
  let modal = document.getElementById('pelican-config-modal-web');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'pelican-config-modal-web';
    modal.style.cssText = 'display: none; position: fixed; inset: 0; z-index: 999999; align-items: center; justify-content: center; font-family: "Segoe UI", Tahoma, sans-serif;';
    modal.innerHTML = `
      <div id="p-web-cfg-backdrop" style="position: absolute; inset: 0; background: rgba(0,0,0,0.72); backdrop-filter: blur(4px);"></div>
      <div style="position: relative; width: 620px; max-width: 95vw; background: #0b1329; border: 1.5px solid #a855f7; border-radius: 12px; box-shadow: 0 25px 60px rgba(0,0,0,0.9), 0 0 30px rgba(168,85,247,0.3); color: #f8fafc; overflow: hidden; display: flex; flex-direction: column;">
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #1e1b4b; border-bottom: 1px solid rgba(168,85,247,0.3);">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 18px;">💾</span>
            <span id="p-web-cfg-title" style="font-weight: bold; font-size: 14px; color: #c084fc;">สำรอง & ถ่ายโอนการตั้งค่า (Settings & Config)</span>
          </div>
          <button id="p-web-cfg-close" style="background: transparent; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; padding: 0 4px; font-weight: bold;">✕</button>
        </div>

        <div style="padding: 14px 16px; display: flex; flex-direction: column; gap: 10px;">
          <div style="background: rgba(168, 85, 247, 0.12); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 8px; padding: 8px 12px; font-size: 11.5px; color: #e9d5ff; line-height: 1.4;">
            🔒 <b>ระบบความปลอดภัย (Security Guaranteed):</b><br/>
            ไฟล์คอนฟิกนี้จะรวบรวมการตั้งค่าทั้งหมด (แมพฟาร์ม, ลูกธนู, กรองขายของ NPC, กฎตลาดกลาง, ร้านค้า) โดย <b>ยกเว้นชื่อผู้ใช้ (ID) และ รหัสผ่าน (Password) ออก 100%</b> ทำให้แชร์หรือย้ายไปใช้กับจออื่นได้ทันทีอย่างปลอดภัย ไม่ทับซ้อนไอดีกัน
          </div>

          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-size: 11.5px; color: #cbd5e1; font-weight: 600;">ข้อมูลการตั้งค่า (Config JSON Data):</span>
              <span id="p-web-cfg-status" style="font-size: 10.5px; color: #10b981; font-weight: 600;"></span>
            </div>
            <textarea id="p-web-cfg-json" placeholder="วางโค้ด JSON การตั้งค่าที่นี่..." style="width: 100%; height: 250px; box-sizing: border-box; background: #0f172a; border: 1px solid #475569; border-radius: 6px; color: #38bdf8; font-family: 'JetBrains Mono', 'Consolas', monospace; font-size: 11px; padding: 10px; resize: vertical; line-height: 1.4; outline: none;"></textarea>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
            <div style="display: flex; gap: 6px;">
              <button id="p-web-cfg-copy" style="background: #7c3aed; color: #fff; border: 1px solid #a855f7; padding: 6px 12px; border-radius: 6px; font-size: 11.5px; font-weight: bold; cursor: pointer;">
                📋 คัดลอก JSON
              </button>
              <button id="p-web-cfg-download" style="background: #1e293b; color: #38bdf8; border: 1px solid rgba(56,189,248,0.4); padding: 6px 12px; border-radius: 6px; font-size: 11.5px; font-weight: bold; cursor: pointer;">
                💾 ดาวน์โหลด .json
              </button>
            </div>
            <div style="display: flex; gap: 6px;">
              <label style="background: #334155; color: #e2e8f0; border: 1px solid #475569; padding: 6px 12px; border-radius: 6px; font-size: 11.5px; font-weight: bold; cursor: pointer;">
                📂 เลือกไฟล์ .json
                <input type="file" id="p-web-cfg-file" accept=".json,application/json" style="display: none;">
              </label>
              <button id="p-web-cfg-apply" style="background: #0284c7; color: #fff; border: 1px solid #38bdf8; padding: 6px 14px; border-radius: 6px; font-size: 11.5px; font-weight: bold; cursor: pointer;">
                📥 นำเข้าการตั้งค่า (Apply)
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => { modal.style.display = 'none'; };
    modal.querySelector('#p-web-cfg-close').onclick = close;
    modal.querySelector('#p-web-cfg-backdrop').onclick = close;

    modal.querySelector('#p-web-cfg-copy').onclick = () => {
      const txt = modal.querySelector('#p-web-cfg-json').value;
      if (!txt) return;
      navigator.clipboard.writeText(txt);
      modal.querySelector('#p-web-cfg-status').innerText = '✅ คัดลอกลง Clipboard เรียบร้อย';
    };

    modal.querySelector('#p-web-cfg-download').onclick = () => {
      const txt = modal.querySelector('#p-web-cfg-json').value;
      if (!txt) return;
      const element = document.createElement('a');
      element.setAttribute('href', 'data:application/json;charset=utf-8,' + encodeURIComponent(txt));
      element.setAttribute('download', 'aetheria_bot_config.json');
      element.style.display = 'none';
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
      modal.querySelector('#p-web-cfg-status').innerText = '💾 ดาวน์โหลดไฟล์เรียบร้อย';
    };

    modal.querySelector('#p-web-cfg-file').onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        modal.querySelector('#p-web-cfg-json').value = event.target.result;
        modal.querySelector('#p-web-cfg-status').innerText = `📄 โหลดไฟล์ "${file.name}" แล้ว`;
      };
      reader.readAsText(file);
    };
  }

  const targetProfId = profileId;
  const area = modal.querySelector('#p-web-cfg-json');
  const title = modal.querySelector('#p-web-cfg-title');
  const status = modal.querySelector('#p-web-cfg-status');

  if (mode === 'export') {
    title.innerText = '📤 ส่งออกการตั้งค่า (Export Config JSON)';
    area.value = preloadedJson;
    status.innerText = '✅ คัดลอก JSON ลง Clipboard แล้ว';
    if (preloadedJson) navigator.clipboard.writeText(preloadedJson);
  } else {
    title.innerText = '📥 นำเข้าการตั้งค่า (Import Config JSON)';
    area.value = '';
    status.innerText = 'วางโค้ด JSON การตั้งค่าที่นี่';
  }

  modal.querySelector('#p-web-cfg-apply').onclick = async () => {
    const txt = area.value;
    if (!txt || !txt.trim()) {
      alert('กรุณาวางโค้ด JSON การตั้งค่าก่อนกดนำเข้า');
      return;
    }
    try { JSON.parse(txt); } catch (e) {
      alert('❌ ไฟล์/ข้อความนี้ไม่ใช่ JSON ที่ถูกต้อง: ' + e.message);
      return;
    }
    const res = await sendWebHudAction(targetProfId, { type: 'import-config', configJson: txt }) || {};
    const gameAnswer = res.result && res.result.result;
    if (res.success && res.result?.success !== false && gameAnswer && gameAnswer.success !== false) {
      status.innerText = '✅ นำเข้าการตั้งค่าสำเร็จครบทุกระบบ!';
      alert('✅ นำเข้าการตั้งค่าสำเร็จ! (คง ID และ Password เดิมของจอนี้ไว้)');
      modal.style.display = 'none';
    } else {
      const why = res.error || res.result?.error || gameAnswer?.error || (gameAnswer ? 'นำเข้าไม่สำเร็จ' : 'จอเกมไม่ตอบกลับ (ต้องเปิดจอเกมนี้ไว้)');
      status.innerText = '❌ ผิดพลาด: ' + why;
      alert('❌ ไม่สามารถนำเข้าการตั้งค่าได้: ' + why);
    }
  };

  modal.style.display = 'flex';
}

﻿const API_BASE = "";
let currentProfiles = [];
let currentBandwidthSummary = null;
let allWindowsHidden = false;

// DOM Elements
const gridEl = document.getElementById("profiles-grid");
const totalEl = document.getElementById("metric-total-profiles");
const onlineEl = document.getElementById("metric-online-profiles");
const farmingEl = document.getElementById("metric-farming-profiles");
const zenyEl = document.getElementById("metric-total-zeny");

// Profile Modal Elements
const modalEl = document.getElementById("profile-modal");
const modalTitle = document.getElementById("modal-title");
const profileForm = document.getElementById("profile-form");
const formId = document.getElementById("form-profile-id");
const formName = document.getElementById("form-name");
const formAccount = document.getElementById("form-account");
const formClass = document.getElementById("form-class");
const formMap = document.getElementById("form-map");
const formPort = document.getElementById("form-port");
const formNotes = document.getElementById("form-notes");
const formPassword = document.getElementById("form-password");
const formAuthHint = document.getElementById("form-auth-hint");
const formPasswordEye = document.getElementById("form-password-eye");
if (formPasswordEye && formPassword) formPasswordEye.onclick = () => { formPassword.type = formPassword.type === 'password' ? 'text' : 'password'; };

// Script Plan Modal Elements
const planModalEl = document.getElementById("plan-modal");
const planForm = document.getElementById("plan-form");
const planProfileId = document.getElementById("plan-profile-id");
const planNameInput = document.getElementById("plan-name");
const planModeSelect = document.getElementById("plan-mode");
const planMapSelect = document.getElementById("plan-map");
const planAmmoMin = document.getElementById("plan-ammo-min");
const planWeightMax = document.getElementById("plan-weight-max");
const planRequireArrow = document.getElementById("plan-require-arrow");
const planArrowType = document.getElementById("plan-arrow-type");
const planAutoSell = document.getElementById("plan-auto-sell");
const planSellWeapons = document.getElementById("plan-sell-weapons");
const planSellArmors = document.getElementById("plan-sell-armors");
const planNotes = document.getElementById("plan-notes");

// Active Floating Web HUDs tracking: profileId -> { el, activeTab, activeSubTab, interval }
const activeWebHuds = {};
let topHudZIndex = 10000;

// ==========================================
// INITIALIZATION & POLLING
// ==========================================
async function fetchProfiles() {
  try {
    const res = await fetch(`${API_BASE}/api/profiles`);
    const data = await res.json();
    if (data.success) {
      currentProfiles = data.profiles;
      currentBandwidthSummary = data.bandwidthSummary || null;
      allWindowsHidden = !!data.allWindowsHidden;
      
      const lblHideAll = document.getElementById("lbl-toggle-all-windows");
      if (lblHideAll) {
        lblHideAll.innerText = allWindowsHidden ? "แสดงกราฟิกทุกจอ" : "พักกราฟิกทุกจอ (Zero-Render)";
      }

      if (typeof window.refreshPartyManagerData === 'function' && (Date.now() - (window.__lastPartyPollAt || 0) > 4000)) {
        window.__lastPartyPollAt = Date.now();
        window.refreshPartyManagerData();
      }
      renderProfiles();
      updateMetrics();
      updateActiveWebHuds();
      if (typeof updateZenyConsolidationView === 'function') {
        updateZenyConsolidationView();
      }
      if (typeof window.updateJailManagerFromProfiles === 'function') {
        window.updateJailManagerFromProfiles(currentProfiles);
      }

      if (data.captchaStats && typeof data.captchaStats.totalSolved === 'number') {
        updateCaptchaSolvedDisplay(data.captchaStats.totalSolved);
      }
      if (data.screenProxySummary && typeof updateScreenProxyToolbarBtn === 'function') {
        updateScreenProxyToolbarBtn(data.screenProxySummary);
      }
      if (data.channelCheckMode && typeof syncChannelCheckModeUI === 'function') {
        syncChannelCheckModeUI(data.channelCheckMode);
      }

      // Play alert chime if any card has humanCheck active or is in prison
      const hasActiveHumanCheck = currentProfiles.some(p => p.liveState && p.liveState.humanCheck && p.liveState.humanCheck.active);
      const hasPrisonProfile = currentProfiles.some(p => p.liveState && typeof p.liveState.map === 'string' && /คุก|เรือนจำ|\bprison\b|\bjail\b/i.test(p.liveState.map));
      if (hasActiveHumanCheck || hasPrisonProfile) {
        playHumanCheckAlert(hasPrisonProfile);
      }
    }
  } catch (err) {
    console.error("Failed to fetch profiles:", err);
  }
}

let lastHumanCheckBeep = 0;
let sharedAlertAudioCtx = null;
function ensureAlertAudioCtx() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAlertAudioCtx || sharedAlertAudioCtx.state === 'closed') {
    sharedAlertAudioCtx = new AudioCtx();
  }
  if (sharedAlertAudioCtx.state === 'suspended' && typeof sharedAlertAudioCtx.resume === 'function') {
    sharedAlertAudioCtx.resume().catch(() => {});
  }
  return sharedAlertAudioCtx;
}
window.addEventListener('click', () => { try { ensureAlertAudioCtx(); } catch (_) {} }, { passive: true });
window.addEventListener('keydown', () => { try { ensureAlertAudioCtx(); } catch (_) {} }, { passive: true });

function playHumanCheckAlert(urgent = false) {
  const now = Date.now();
  const cooldown = urgent ? 4500 : 5000;
  if (now - lastHumanCheckBeep < cooldown) return;
  lastHumanCheckBeep = now;
  try {
    const ctx = ensureAlertAudioCtx();
    if (!ctx) return;
    const notes = urgent ? [987.77, 1318.51, 987.77, 1318.51] : [880, 1174.66, 880, 1318.51];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = urgent ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.16);
      gain.gain.setValueAtTime(urgent ? 0.35 : 0.28, ctx.currentTime + idx * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.16 + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.16);
      osc.stop(ctx.currentTime + idx * 0.16 + 0.15);
    });
  } catch (e) {}
}

function updateCaptchaSolvedDisplay(count) {
  const el = document.getElementById("captcha-solved-count");
  if (!el) return;
  const num = Number(count) || 0;
  el.innerText = num.toLocaleString();
}
window.updateCaptchaSolvedDisplay = updateCaptchaSolvedDisplay;

let lastCaptchaStatsData = null;

async function fetchCaptchaStats() {
  try {
    const res = await fetch(`${API_BASE}/api/captcha-stats`).then(r => r.json());
    if (res && res.success && typeof res.totalSolved === 'number') {
      updateCaptchaSolvedDisplay(res.totalSolved);
      lastCaptchaStatsData = res;
    }
  } catch (e) {}
}

// ==========================================
// CAPTCHA HISTORY & DAILY BREAKDOWN MODAL
// ==========================================

function formatThaiDateLabel(dateStr, todayKey) {
  if (!dateStr) return '';
  const parts = dateStr.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  const thaiMonths = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];
  const dateFormatted = `${d} ${thaiMonths[m - 1] || ''} ${y}`;
  if (dateStr === todayKey) {
    return `วันนี้ (${dateFormatted})`;
  }
  try {
    const dObj = new Date(`${dateStr}T12:00:00+07:00`);
    const todayObj = new Date(`${todayKey}T12:00:00+07:00`);
    const diffDays = Math.round((todayObj - dObj) / (1000 * 3600 * 24));
    if (diffDays === 1) return `เมื่อวาน (${dateFormatted})`;
    if (diffDays > 1 && diffDays <= 7) return `${diffDays} วันที่แล้ว (${dateFormatted})`;
  } catch (e) {}
  return dateFormatted;
}

function formatThaiTime(timestamp) {
  if (!timestamp) return '-';
  try {
    const d = new Date(Number(timestamp));
    const thaiMonths = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];
    const options = { timeZone: 'Asia/Bangkok', hour12: false, hour: '2-digit', minute: '2-digit' };
    const timeStr = new Intl.DateTimeFormat('th-TH', options).format(d);
    const day = d.getDate();
    const month = thaiMonths[d.getMonth()];
    return `${day} ${month} ${timeStr} น.`;
  } catch (e) {
    return new Date(timestamp).toLocaleString();
  }
}

async function loadCaptchaHistory() {
  const container = document.getElementById("captcha-history-list");
  if (!container) return;
  if (!lastCaptchaStatsData) {
    container.innerHTML = `<div style="text-align: center; color: #64748b; padding: 36px 12px; font-size: 12px;">กำลังโหลดสถิติ...</div>`;
  } else {
    renderCaptchaHistoryModal(lastCaptchaStatsData);
  }
  try {
    const res = await fetch(`/api/captcha-stats`).then(r => r.json());
    if (!res || !res.success) throw new Error(res?.error || "Failed to load stats");
    lastCaptchaStatsData = res;
    renderCaptchaHistoryModal(res);
  } catch (err) {
    if (!lastCaptchaStatsData) {
      container.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 24px 12px; font-size: 12px;">⚠️ ไม่สามารถโหลดประวัติได้: ${err.message}</div>`;
    }
  }
}

function renderCaptchaHistoryModal(data) {
  const container = document.getElementById("captcha-history-list");
  if (!container) return;

  const todayEl = document.getElementById("ch-stat-today");
  const totalEl = document.getElementById("ch-stat-total");
  const lastEl = document.getElementById("ch-stat-last");
  if (todayEl) todayEl.innerText = (data.todaySolved || 0).toLocaleString();
  if (totalEl) totalEl.innerText = (data.totalSolved || 0).toLocaleString();
  if (lastEl) lastEl.innerText = formatThaiTime(data.lastSolvedAt);

  const daily = data.daily || {};
  const dateKeys = Object.keys(daily).sort().reverse();

  if (dateKeys.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: #64748b; padding: 40px 14px; font-size: 12px; background: rgba(15, 23, 42, 0.4); border-radius: 8px; border: 1px dashed rgba(255, 255, 255, 0.08);">
        <div style="font-size: 28px; margin-bottom: 8px;">🌱</div>
        <div style="color: #94a3b8; font-weight: 600; font-size: 13px;">ยังไม่มีประวัติการแก้ Captcha ที่บันทึกไว้</div>
        <div style="color: #64748b; font-size: 11px; margin-top: 4px;">เมื่อบอทตอบคำถามเช็คผู้เล่นสำเร็จ ระบบจะแยกสถิติตามวันและจอให้อัตโนมัติ</div>
      </div>
    `;
    return;
  }

  const profileMap = data.profiles || {};
  let html = "";

  dateKeys.forEach((dateStr, idx) => {
    const dayEntry = daily[dateStr] || { total: 0, byProfile: {} };
    const dateLabel = formatThaiDateLabel(dateStr, data.todayDate);
    const dayTotal = dayEntry.total || 0;
    const isFirst = idx === 0;
    const byProfile = dayEntry.byProfile || {};
    const profileIds = Object.keys(byProfile).sort((a, b) => (byProfile[b] || 0) - (byProfile[a] || 0));

    let profilesHtml = "";
    if (profileIds.length === 0) {
      profilesHtml = `<div style="color: #64748b; font-size: 11px; padding: 6px 4px; text-align: center;">ไม่มีข้อมูลแยกจอ</div>`;
    } else {
      profileIds.forEach(pid => {
        const count = byProfile[pid] || 0;
        const pct = dayTotal > 0 ? Math.round((count / dayTotal) * 100) : 0;
        
        let pName = pid;
        if (profileMap[pid] && profileMap[pid].name) {
          pName = profileMap[pid].name;
        } else if (typeof currentProfiles !== 'undefined') {
          const found = currentProfiles.find(p => p.id === pid);
          if (found && found.name) pName = found.name;
        }

        const shortId = pid.replace(/^profile_/, 'P-');

        profilesHtml += `
          <div class="ch-profile-item">
            <div class="ch-profile-name">
              <span class="ch-profile-dot"></span>
              <span class="ch-profile-label" title="${pid}">${pName}</span>
              <span class="ch-profile-id">#${shortId}</span>
            </div>
            <div class="ch-profile-bar-wrap" title="${pct}% ของวันนี้">
              <div class="ch-profile-bar" style="width: ${pct}%;"></div>
            </div>
            <div class="ch-profile-stat">
              <span>${count.toLocaleString()}</span> <small style="font-size: 10px; color: #6ee7b7;">ครั้ง</small>
              <span class="ch-profile-pct">(${pct}%)</span>
            </div>
          </div>
        `;
      });
    }

    html += `
      <div class="ch-day-card ${isFirst ? 'open' : ''}" data-date="${dateStr}">
        <div class="ch-day-header">
          <div class="ch-day-info">
            <span class="ch-day-toggle-icon">▶</span>
            <span class="ch-day-title">
              <span>${dateLabel}</span>
              ${dateStr === data.todayDate ? '<span style="font-size: 9.5px; background: rgba(52, 211, 153, 0.25); color: #34d399; padding: 1px 6px; border-radius: 999px; font-weight: 700;">วันนี้</span>' : ''}
            </span>
          </div>
          <div class="ch-day-badge">
            <span class="ch-count-num">${dayTotal.toLocaleString()}</span> ครั้ง
          </div>
        </div>
        <div class="ch-day-detail" style="display: ${isFirst ? 'flex' : 'none'};">
          ${profilesHtml}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  container.querySelectorAll('.ch-day-header').forEach(header => {
    header.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = header.closest('.ch-day-card');
      if (!card) return;
      const detail = card.querySelector('.ch-day-detail');
      if (!detail) return;
      const isOpen = card.classList.contains('open');
      if (isOpen) {
        card.classList.remove('open');
        detail.style.display = 'none';
      } else {
        card.classList.add('open');
        detail.style.display = 'flex';
      }
    });
  });
}

function openCaptchaHistoryModal() {
  const modal = document.getElementById("modal-captcha-history");
  if (!modal) return;
  modal.classList.add("active");
  modal.style.display = "flex";
  loadCaptchaHistory();
}
window.openCaptchaHistoryModal = openCaptchaHistoryModal;

function closeCaptchaHistoryModal() {
  const modal = document.getElementById("modal-captcha-history");
  if (modal) {
    modal.classList.remove("active");
    modal.style.display = "none";
  }
}
window.closeCaptchaHistoryModal = closeCaptchaHistoryModal;

function initCaptchaHistoryModal() {
  const pill = document.getElementById("captcha-solved-pill");
  if (pill) {
    pill.onclick = openCaptchaHistoryModal;
    pill.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openCaptchaHistoryModal();
      }
    };
  }

  const btnClose = document.getElementById("btn-captcha-history-close");
  const btnOk = document.getElementById("btn-captcha-history-ok");
  if (btnClose) btnClose.onclick = closeCaptchaHistoryModal;
  if (btnOk) btnOk.onclick = closeCaptchaHistoryModal;

  const btnRefresh = document.getElementById("btn-captcha-history-refresh");
  if (btnRefresh) {
    btnRefresh.onclick = () => {
      btnRefresh.innerText = "⏳ กำลังรีเฟรช...";
      loadCaptchaHistory().finally(() => {
        setTimeout(() => { btnRefresh.innerText = "🔄 รีเฟรช"; }, 400);
      });
    };
  }

  const modal = document.getElementById("modal-captcha-history");
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) closeCaptchaHistoryModal();
    };
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && modal.style.display !== "none") {
      closeCaptchaHistoryModal();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCaptchaHistoryModal);
} else {
  initCaptchaHistoryModal();
}

// ==========================================
// HUMAN CHECK IMAGE BOARD SIMULATOR CONTROLLER
// ==========================================
const HC_SIM_PRESETS = [
  { id: 90301, name: 'Red Potion', icon: '/art/icons/items/red-potion.webp', color: '#ef4444' },
  { id: 2101, name: 'Guard', icon: '/art/icons/items/rogear-guard.webp', color: '#3b82f6' },
  { id: 90201, name: 'Phracon', icon: '/art/icons/items/phracon.webp', color: '#10b981' },
  { id: 90304, name: 'Blue Potion', icon: '/art/icons/items/blue-potion.webp', color: '#06b6d4' },
  { id: 5035, name: 'Poring Hat', icon: '/art/icons/items/rogear-poring-hat.webp', color: '#f43f5e' },
  { id: 90103, name: 'Clover', icon: '/art/icons/items/clover.webp', color: '#84cc16' }
];

let simCurrentGroundTruth = null;
let simLoadedImages = new Map();

function loadSimImage(src) {
  if (simLoadedImages.has(src)) return Promise.resolve(simLoadedImages.get(src));
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      simLoadedImages.set(src, img);
      resolve(img);
    };
    img.onerror = () => {
      resolve(null);
    };
    img.src = src;
  });
}

function drawSimFallbackIcon(ctx, item, x, y, size) {
  ctx.save();
  ctx.fillStyle = item.color || '#64748b';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x + 4, y + 4, size - 8, size - 8, 8);
  else ctx.rect(x + 4, y + 4, size - 8, size - 8);
  ctx.fill();
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(item.name.slice(0, 7), x + size / 2, y + size / 2 + 4);
  ctx.restore();
}

async function renderSimulatorBoard(presetVal) {
  const canvas = document.getElementById('hc-sim-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const bw = 480, bh = 330;
  canvas.width = bw;
  canvas.height = bh;

  // Background matching Aetheria captcha screen
  const bgGrad = ctx.createLinearGradient(0, 0, bw, bh);
  bgGrad.addColorStop(0, '#151528');
  bgGrad.addColorStop(1, '#0c0c17');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, bw, bh);

  // Subtle grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < bw; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, bh); ctx.stroke(); }
  for (let y = 0; y < bh; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(bw, y); ctx.stroke(); }

  // Select target
  let target = null;
  if (!presetVal || presetVal === 'random') {
    target = HC_SIM_PRESETS[Math.floor(Math.random() * HC_SIM_PRESETS.length)];
  } else {
    target = HC_SIM_PRESETS.find(p => String(p.id) === String(presetVal)) || HC_SIM_PRESETS[0];
  }

  // Pick 3 distractors
  const distractors = HC_SIM_PRESETS.filter(p => p.id !== target.id);
  const shuffledDistractors = distractors.sort(() => Math.random() - 0.5).slice(0, 3);

  // Place items at non-overlapping positions
  const itemSize = 64;
  const placed = [];

  function getNonOverlappingPos() {
    for (let attempts = 0; attempts < 50; attempts++) {
      const x = 30 + Math.floor(Math.random() * (bw - itemSize - 60));
      const y = 30 + Math.floor(Math.random() * (bh - itemSize - 60));
      const overlap = placed.some(p => Math.abs(p.x - x) < 70 && Math.abs(p.y - y) < 70);
      if (!overlap) {
        placed.push({ x, y });
        return { x, y };
      }
    }
    const fallbackX = 40 + placed.length * 80;
    const fallback = { x: Math.min(bw - itemSize - 20, fallbackX), y: 100 };
    placed.push(fallback);
    return fallback;
  }

  const targetPos = getNonOverlappingPos();
  const targetImg = await loadSimImage(target.icon);
  if (targetImg) {
    ctx.drawImage(targetImg, targetPos.x, targetPos.y, itemSize, itemSize);
  } else {
    drawSimFallbackIcon(ctx, target, targetPos.x, targetPos.y, itemSize);
  }

  // Draw distractors
  for (const d of shuffledDistractors) {
    const dPos = getNonOverlappingPos();
    const dImg = await loadSimImage(d.icon);
    if (dImg) {
      ctx.drawImage(dImg, dPos.x, dPos.y, itemSize, itemSize);
    } else {
      drawSimFallbackIcon(ctx, d, dPos.x, dPos.y, itemSize);
    }
  }

  simCurrentGroundTruth = {
    target,
    targetImg,
    x: targetPos.x,
    y: targetPos.y,
    centerX: targetPos.x + itemSize / 2,
    centerY: targetPos.y + itemSize / 2
  };

  // Update UI text
  const promptEl = document.getElementById('hc-sim-prompt-text');
  if (promptEl) promptEl.textContent = `เลือก ${target.name}`;

  const groundTruthEl = document.getElementById('hc-sim-ground-truth');
  if (groundTruthEl) groundTruthEl.textContent = `พิกัดจริง: (X: ${Math.round(simCurrentGroundTruth.centerX)}, Y: ${Math.round(simCurrentGroundTruth.centerY)})`;

  // Hide marker and reset result
  const marker = document.getElementById('hc-sim-target-marker');
  if (marker) marker.style.display = 'none';

  const coordEl = document.getElementById('hc-sim-res-coord');
  if (coordEl) coordEl.textContent = '-';
  const confEl = document.getElementById('hc-sim-res-conf');
  if (confEl) confEl.textContent = '-';
  const timeEl = document.getElementById('hc-sim-res-time');
  if (timeEl) timeEl.textContent = '-';
  const accEl = document.getElementById('hc-sim-res-acc');
  if (accEl) {
    accEl.textContent = 'รอสั่งแก้โจทย์';
    accEl.style.color = '#e2e8f0';
  }
}

async function solveSimulatorBoard() {
  if (!simCurrentGroundTruth) return;
  const canvas = document.getElementById('hc-sim-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const btnSolve = document.getElementById('btn-hc-sim-solve');
  if (btnSolve) { btnSolve.disabled = true; btnSolve.textContent = '⏳ กำลังคำนวณ...'; }

  const startTime = performance.now();

  try {
    const boardData = ctx.getImageData(0, 0, 480, 330);
    const target = simCurrentGroundTruth.target;

    // Create 64x64 template
    const tCanvas = document.createElement('canvas');
    tCanvas.width = 64;
    tCanvas.height = 64;
    const tCtx = tCanvas.getContext('2d', { willReadFrequently: true });

    if (simCurrentGroundTruth.targetImg) {
      tCtx.drawImage(simCurrentGroundTruth.targetImg, 0, 0, 64, 64);
    } else {
      drawSimFallbackIcon(tCtx, target, 0, 0, 64);
    }
    const templateData = tCtx.getImageData(0, 0, 64, 64);

    const solver = window.ImageBoardSolver || (typeof ImageBoardSolver !== 'undefined' ? ImageBoardSolver : null);
    if (!solver) throw new Error('ไม่พบโมดูล ImageBoardSolver');

    const match = solver.matchTemplateOnBoard(boardData, templateData, { subsample: 2, coarseStep: 4 });
    const elapsed = Math.round(performance.now() - startTime);

    if (match && match.confidence >= 60) {
      // Position marker
      const marker = document.getElementById('hc-sim-target-marker');
      if (marker) {
        marker.style.left = `${match.centerX}px`;
        marker.style.top = `${match.centerY}px`;
        marker.style.display = 'block';
      }

      const dist = Math.round(Math.hypot(match.centerX - simCurrentGroundTruth.centerX, match.centerY - simCurrentGroundTruth.centerY));
      const isAccurate = dist <= 6;

      const coordEl = document.getElementById('hc-sim-res-coord');
      if (coordEl) coordEl.textContent = `(${match.centerX}, ${match.centerY})`;
      const confEl = document.getElementById('hc-sim-res-conf');
      if (confEl) confEl.textContent = `${match.confidence}%`;
      const timeEl = document.getElementById('hc-sim-res-time');
      if (timeEl) timeEl.textContent = `${elapsed} ms`;

      const accEl = document.getElementById('hc-sim-res-acc');
      if (accEl) {
        if (isAccurate) {
          accEl.textContent = `✅ แม่นยำ 100% (ตรงเป๊ะ ${dist}px)`;
          accEl.style.color = '#34d399';
        } else {
          accEl.textContent = `⚠️ คลาดเคลื่อน (${dist}px)`;
          accEl.style.color = '#fbbf24';
        }
      }

      // Also call server simulator endpoint for verification
      fetch(`${API_BASE}/api/human-check/simulate-board`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: `เลือก ${target.name}`, itemId: target.id })
      }).catch(() => {});

    } else {
      const coordEl = document.getElementById('hc-sim-res-coord');
      if (coordEl) coordEl.textContent = 'ไม่พบพิกัด';
      const confEl = document.getElementById('hc-sim-res-conf');
      if (confEl) confEl.textContent = `${match?.confidence || 0}%`;
      const timeEl = document.getElementById('hc-sim-res-time');
      if (timeEl) timeEl.textContent = `${elapsed} ms`;
      const accEl = document.getElementById('hc-sim-res-acc');
      if (accEl) {
        accEl.textContent = '❌ ความมั่นใจต่ำเกินไป';
        accEl.style.color = '#ef4444';
      }
    }
  } catch (err) {
    showToast(`❌ เกิดข้อผิดพลาดในการคำนวณ: ${err.message}`, 'error');
  } finally {
    if (btnSolve) { btnSolve.disabled = false; btnSolve.textContent = '🚀 สั่งแก้โจทย์'; }
  }
}

function openHumanCheckSimulatorModal() {
  const modal = document.getElementById('modal-human-check-simulator');
  if (!modal) return;
  modal.classList.add('active');
  modal.style.display = 'flex';
  const sel = document.getElementById('hc-sim-preset-select');
  renderSimulatorBoard(sel ? sel.value : '90301');
}
window.openHumanCheckSimulatorModal = openHumanCheckSimulatorModal;

function closeHumanCheckSimulatorModal() {
  const modal = document.getElementById('modal-human-check-simulator');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
}
window.closeHumanCheckSimulatorModal = closeHumanCheckSimulatorModal;

function initHumanCheckSimulator() {
  const btnOpen = document.getElementById('btn-hc-simulate');
  if (btnOpen) btnOpen.onclick = openHumanCheckSimulatorModal;
  const btnToolbar = document.getElementById('btn-toolbar-simulate-hc');
  if (btnToolbar) btnToolbar.onclick = openHumanCheckSimulatorModal;

  const btnClose = document.getElementById('btn-hc-sim-close');
  const btnDone = document.getElementById('btn-hc-sim-done');
  if (btnClose) btnClose.onclick = closeHumanCheckSimulatorModal;
  if (btnDone) btnDone.onclick = closeHumanCheckSimulatorModal;

  const sel = document.getElementById('hc-sim-preset-select');
  if (sel) {
    sel.onchange = () => renderSimulatorBoard(sel.value);
  }

  const btnGen = document.getElementById('btn-hc-sim-generate');
  if (btnGen) {
    btnGen.onclick = () => {
      const selVal = sel ? sel.value : 'random';
      renderSimulatorBoard(selVal);
    };
  }

  const btnSolve = document.getElementById('btn-hc-sim-solve');
  if (btnSolve) btnSolve.onclick = solveSimulatorBoard;

  const modal = document.getElementById('modal-human-check-simulator');
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) closeHumanCheckSimulatorModal();
    };
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
      closeHumanCheckSimulatorModal();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHumanCheckSimulator);
} else {
  initHumanCheckSimulator();
}
// ==========================================
// USAGE STATEMENT & DEBT HISTORY MODAL CONTROLLER
// ==========================================
let lastStatementData = null;
let currentStatementTab = 'usage'; // 'usage' | 'ledger'

async function fetchStatementData(force = false) {
  try {
    const res = await fetch(`${API_BASE}/api/script/statement`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (validStatement(data)) {
      lastStatementData = data;
      updateUsageStatementDisplay();
      const modal = document.getElementById("modal-usage-statement");
      if (modal && modal.style.display !== "none") {
        renderUsageStatementModal(data);
      }
      return data;
    }
    throw new Error('ใบสรุปยังไม่ตรงรูปแบบที่ถูกต้อง');
  } catch (err) {
    console.warn("Failed to fetch usage statement:", err);
    const content=document.getElementById('usage-statement-content');
    if(content&&!validStatement(lastStatementData))content.textContent='ยังอ่านใบสรุปจากเซิร์ฟเวอร์ไม่ได้ ไม่คำนวณจากจอออนไลน์';
    updateUsageStatementDisplay();
  }
  return null;
}
window.fetchStatementData = fetchStatementData;

function validStatement(data) {
  return data?.success===true&&data.schemaVersion===2&&data.unitScale===100&&['balanceUnits','rateUnits','estimatedUnits','usedSlotsToday','billableSlotsToday'].every(k=>Number.isSafeInteger(data[k]))&&data.rateUnits>=0&&data.estimatedUnits>=0&&data.usedSlotsToday>=0&&data.billableSlotsToday>=0&&['shadow','deferred'].includes(data.billingMode)&&Array.isArray(data.usage)&&Array.isArray(data.ledger);
}
function updateUsageStatementDisplay() {
  const pill=document.getElementById('btn-open-usage-statement'),text=document.getElementById('online-expense-text');if(!pill)return;
  if(!validStatement(lastStatementData)){if(text)text.textContent='ยังไม่มีใบสรุป';pill.title='ไม่คำนวณค่าใช้จ่ายจากจำนวนจอออนไลน์';pill.classList.remove('has-debt');return;}
  const data=lastStatementData,balance=data.balanceUnits/100,today=data.estimatedUnits/100;
  pill.classList.toggle('has-debt',balance<0);
  if(text)text.textContent=balance<0?`ส่วนบุญ ${balance.toLocaleString()} • รอสรุปวันนี้ ${today.toLocaleString()}`:`รอสรุปวันนี้ ${today.toLocaleString()} ส่วนบุญ`;
  pill.title=`ยอดส่วนบุญปัจจุบัน: ${balance.toLocaleString()} ส่วนบุญ • ${data.billingMode==='shadow'?'โหมดทดลอง ไม่หักจริง':'คิดจาก slot ที่ใช้สคริปต์จริง'} • ${data.usedSlotsToday} slot วันนี้`;
}
function renderUsageStatementModal(data) {
  const container=document.getElementById('usage-statement-content');
  if(!validStatement(data)){if(container)container.textContent='ยังอ่านข้อมูลใบสรุปไม่ได้';return;}
  const set=(id,value)=>{const node=document.getElementById(id);if(node)node.innerText=value;},balance=data.balanceUnits/100,today=data.estimatedUnits/100;
  set('us-stat-balance-icon',balance<0?'🚨':'🟢');set('us-stat-balance-title',balance<0?'ส่วนบุญติดลบ':'ส่วนบุญคงเหลือ');set('us-stat-balance-val',balance.toLocaleString());set('us-stat-balance-sub',balance<0?'ยอดส่วนบุญติดลบ':'ยอดส่วนบุญปัจจุบัน');
  set('us-stat-today-val',today.toLocaleString());set('us-stat-today-sub',`วันที่ ${data.bangkokDay} • ${data.billingMode==='shadow'?'ไม่มีการหักจริง':data.billingMode==='deferred'?'คิดตาม slot ที่ใช้จริง':'หักตามรอบ'}`);
  set('us-stat-slots-val',String(data.usedSlotsToday));set('us-stat-slots-sub',`คิดจริง ${data.billableSlotsToday} slot • เรท ${data.rateUnits/100} ส่วนบุญ/slot/วัน`);
  set('us-stat-mode-val',data.billingMode==='shadow'?'โหมดทดลอง ไม่หักจริง':'คิดตามการใช้จริง');set('us-stat-mode-sub',Number.isSafeInteger(data.shadowEstimatedUnits)?`ตัวอย่างจาก slot ที่สังเกต ${data.shadowEstimatedUnits/100} ส่วนบุญ (แยกจากยอดรอสรุปจริง)`:'ยอดตาม slot ที่ใช้สคริปต์จริง');
  const balanceNode=document.getElementById('us-stat-balance-val');if(balanceNode)balanceNode.style.color=balance<0?'#f87171':'#34d399';
  if(container){if(currentStatementTab==='usage')renderDailyUsageTab(container,data,today,data.usedSlotsToday,data.rateUnits/100);else renderLedgerTab(container,data);}
}
function renderDailyUsageTab(container,data,todayPoints,activeSlots,ratePoints) {
  const groups=new Map();
  for(const row of data.usage){if(typeof row.slot_id!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.bangkok_day||''))continue;let group=groups.get(row.bangkok_day);if(!group){group=new Map();groups.set(row.bangkok_day,group);}group.set(row.slot_id,row);}
  const ledger=new Map();for(const row of data.ledger)if(row.kind==='usage'&&typeof row.slot_id==='string'&&Number.isSafeInteger(row.delta_units))ledger.set(row.bangkok_day+':'+row.slot_id,row);
  let html=`<div class="us-row-item"><div><strong>วันนี้ ${escapeHTML(data.bangkokDay)}</strong><div>${activeSlots} slot ใช้สคริปต์ • คิดจริง ${data.billableSlotsToday} slot • เรท ${ratePoints} ส่วนบุญ</div></div><div>${todayPoints.toLocaleString()} ส่วนบุญ<div>${data.billingMode==='shadow'?'ทดลอง ไม่หักจริง':'ยอดรอสรุป'}</div></div></div>`;
  for(const [day,slots]of [...groups].sort((a,b)=>b[0].localeCompare(a[0]))){if(day===data.bangkokDay)continue;const billable=[...slots.values()].filter(r=>r.billable===1),entries=billable.map(r=>ledger.get(day+':'+r.slot_id)).filter(Boolean),complete=entries.length===billable.length;
    const sum=entries.reduce((units,r)=>units+r.delta_units,0),rates=[...new Set(entries.filter(r=>Number.isSafeInteger(r.rate_units)).map(r=>r.rate_units))];
    const status=!billable.length?'สังเกตการณ์ ไม่หักจริง':billable.some(r=>r.settled_ms==null)?'รอสรุป':complete?'สรุปจาก ledger แล้ว':'ยอด ledger บางส่วนอยู่นอกช่วงที่โหลด';
    const amount=!billable.length?'0':complete?(sum/100).toLocaleString():'—';
    html+=`<div class="us-row-item"><div><strong>วันที่ ${escapeHTML(day)}</strong><div>${slots.size} slot • คิดจริง ${billable.length} slot • เรทที่บันทึก ${rates.length?rates.map(r=>r/100).join(', '):'—'} ส่วนบุญ</div><small>${escapeHTML([...slots.keys()].join(', '))}</small></div><div>${amount} ส่วนบุญ<div>${status}</div></div></div>`;
  }
  if(!groups.size)html+='<div style="padding:24px;color:#94a3b8">ยังไม่มีบันทึกการใช้ slot จากเซิร์ฟเวอร์</div>';
  container.innerHTML=html;
}
function renderLedgerTab(container,data) {
  const labels={usage:'สรุปค่าบริการรายวัน',topup:'เติมส่วนบุญ',adjustment:'ปรับยอดโดยผู้ดูแล',proxy:'สมัครผ่าน Proxy',proxy_register:'สมัครผ่าน Proxy'};
  const entries=data.ledger.filter(row=>Number.isSafeInteger(row.delta_units));if(!entries.length){container.textContent='ยังไม่มีรายการเดินบัญชีส่วนบุญ';return;}
  container.innerHTML=entries.map(row=>{const amount=row.delta_units/100,time=Number.isSafeInteger(row.created_ms)?new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'short',timeStyle:'short'}).format(new Date(row.created_ms)):'—';return `<div class="us-row-item"><div><strong>${escapeHTML(labels[row.kind]||'รายการเดินบัญชี')}</strong><div>${escapeHTML(row.bangkok_day||time)} ${row.slot_id?'• slot '+escapeHTML(row.slot_id):''}</div><small>${escapeHTML(row.reason||row.entry_key||'')}</small></div><div style="color:${amount<0?'#f87171':'#34d399'}">${amount>0?'+':''}${amount.toLocaleString()} ส่วนบุญ</div></div>`;}).join('');
}

window.updateUsageStatementDisplay=updateUsageStatementDisplay;

function openUsageStatementModal() {
  const modal = document.getElementById("modal-usage-statement");
  if (!modal) return;
  modal.classList.add("active");
  modal.style.display = "flex";
  fetchStatementData(true);
}
window.openUsageStatementModal = openUsageStatementModal;

function closeUsageStatementModal() {
  const modal = document.getElementById("modal-usage-statement");
  if (modal) {
    modal.classList.remove("active");
    modal.style.display = "none";
  }
}
window.closeUsageStatementModal = closeUsageStatementModal;

function initUsageStatementModal() {
  const pill = document.getElementById("btn-open-usage-statement");
  if (pill) {
    pill.onclick = openUsageStatementModal;
    pill.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openUsageStatementModal();
      }
    };
  }

  const btnClose = document.getElementById("btn-usage-statement-close");
  const btnOk = document.getElementById("btn-usage-statement-ok");
  if (btnClose) btnClose.onclick = closeUsageStatementModal;
  if (btnOk) btnOk.onclick = closeUsageStatementModal;

  const btnTopup = document.getElementById("btn-usage-statement-topup");
  if (btnTopup) {
    btnTopup.onclick = () => {
      closeUsageStatementModal();
      const topupBtn = document.getElementById("btn-topup-captcha");
      if (topupBtn) topupBtn.click();
    };
  }

  const tabUsage = document.getElementById("us-tab-usage");
  const tabLedger = document.getElementById("us-tab-ledger");

  if (tabUsage && tabLedger) {
    tabUsage.onclick = () => {
      currentStatementTab = 'usage';
      tabUsage.style.background = "rgba(56, 189, 248, 0.2)";
      tabUsage.style.color = "#38bdf8";
      tabUsage.style.border = "1px solid rgba(56, 189, 248, 0.4)";
      tabUsage.style.fontWeight = "700";

      tabLedger.style.background = "transparent";
      tabLedger.style.color = "#94a3b8";
      tabLedger.style.border = "none";
      tabLedger.style.fontWeight = "normal";

      if (lastStatementData) renderUsageStatementModal(lastStatementData);
    };

    tabLedger.onclick = () => {
      currentStatementTab = 'ledger';
      tabLedger.style.background = "rgba(56, 189, 248, 0.2)";
      tabLedger.style.color = "#38bdf8";
      tabLedger.style.border = "1px solid rgba(56, 189, 248, 0.4)";
      tabLedger.style.fontWeight = "700";

      tabUsage.style.background = "transparent";
      tabUsage.style.color = "#94a3b8";
      tabUsage.style.border = "none";
      tabUsage.style.fontWeight = "normal";

      if (lastStatementData) renderUsageStatementModal(lastStatementData);
    };
  }

  const btnRefresh = document.getElementById("btn-usage-statement-refresh");
  if (btnRefresh) {
    btnRefresh.onclick = () => {
      btnRefresh.innerText = "⏳ กำลังรีเฟรช...";
      fetchStatementData(true).finally(() => {
        setTimeout(() => { btnRefresh.innerText = "🔄 รีเฟรช"; }, 400);
      });
    };
  }

  const modal = document.getElementById("modal-usage-statement");
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) closeUsageStatementModal();
    };
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && modal.style.display !== "none") {
      closeUsageStatementModal();
    }
  });

  // Initial statement fetch
  fetchStatementData();
  // Poll statement every 60s
  setInterval(() => fetchStatementData(), 60000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initUsageStatementModal);
} else {
  initUsageStatementModal();
}



window.answerHumanCheckQuick = async function(profileId, pick) {
  if (!confirm(`ยืนยันการตอบตัวเลือกที่ ${pick + 1} ให้จอ [${profileId}] ใช่หรือไม่?`)) return;
  try {
    const res = await fetch('/api/human-check/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, pick })
    }).then(r => r.json());
    if (res && res.success) {
      alert(`✅ ตอบตัวเลือกที่ ${pick + 1} เรียบร้อยแล้ว!`);
      fetchProfiles();
    } else {
      alert(`❌ สั่งตอบไม่สำเร็จ: ${res.error || 'Unknown error'}`);
    }
  } catch (e) {
    alert(`❌ เกิดข้อผิดพลาด: ${e.message}`);
  }
};

function updateMetrics() {
  const total = currentProfiles.length;
  if (totalEl) totalEl.innerText = total;
  const tabCount = document.getElementById("tab-count-profiles");
  if (tabCount) tabCount.innerText = total;
  const onlineCount = currentProfiles.filter(p => p.isRunning).length;
  if (onlineEl) onlineEl.innerText = onlineCount;
  const farmingCount = currentProfiles.filter(p => p.liveState && p.liveState.isBotRunning).length;
  if (farmingEl) farmingEl.innerText = farmingCount;

  const setBar = (id, ofId, count) => {
    const bar = document.getElementById(id);
    if (bar) bar.style.width = `${total > 0 ? Math.round((count / total) * 100) : 0}%`;
    const of = document.getElementById(ofId);
    if (of) of.innerText = `/ ${total}`;
  };
  setBar("metric-online-bar", "metric-online-of", onlineCount);
  setBar("metric-farming-bar", "metric-farming-of", farmingCount);

  if (typeof updateUsageStatementDisplay === 'function') {
    updateUsageStatementDisplay(onlineCount);
  }

  const totalZeny = currentProfiles.reduce((sum, p) => {
    const z = p.liveState && typeof p.liveState.zeny === 'number' ? p.liveState.zeny : 0;
    return sum + z;
  }, 0);
  if (zenyEl) {
    zenyEl.innerText = `${totalZeny.toLocaleString()} z`;
  }
}

// ==========================================
// RENDER CLIENT PROFILES (CARDS)
// ==========================================

// Accent hue per class family (used for portrait ring, class chip & card glow)
function getClassHue(cls) {
  const c = String(cls || '').toLowerCase();
  if (/novice/.test(c)) return 215;
  if (/bard|dancer|gypsy|clown/.test(c)) return 285;
  if (/archer|hunter|sniper|ranger/.test(c)) return 150;
  if (/sword|knight|crusader|paladin/.test(c)) return 0;
  if (/mage|wizard|sage|warlock/.test(c)) return 220;
  if (/acolyte|priest|monk/.test(c)) return 45;
  if (/thief|assassin|rogue/.test(c)) return 265;
  if (/merchant|blacksmith|alchemist/.test(c)) return 25;
  return 195;
}

// Portrait served through the manager's cache (/api/portrait) so offline cards keep their face
const failedPortraits = new Set();
function onPortraitError(img) {
  failedPortraits.add(img.getAttribute('src'));
  img.parentElement.classList.add('no-img');
  img.remove();
}

function getPortraitSrc(p, state) {
  const hasLiveChar = Boolean(state && state.charName);
  let src = (hasLiveChar ? state?.portrait : '') || p.lastPortrait || state?.portrait || '';
  if (!src) {
    const rawCls = String((hasLiveChar && state?.charClass) || p.lastCharClass || p.charClass || 'novice').toLowerCase();
    const cls = rawCls.split(/[^a-z]+/)[0] || 'novice';
    src = `https://www.aetheria-online.in.th/art/classes/${cls}-face.webp`;
  } else if (!src.startsWith('http')) {
    src = `https://www.aetheria-online.in.th${src.startsWith('/') ? '' : '/'}${src}`;
  }
  return failedPortraits.has(src) ? '' : src;
}

function getActivityTone(text) {
  if (text.includes('ตาย') || text.includes('ชุบ')) return 'danger';
  if (text.includes('ซื้อ') || text.includes('ขาย')) return 'warn';
  if (text.includes('เดิน')) return 'travel';
  if (text.includes('ฟาร์ม') || text.includes('Farm')) return 'farm';
  if (text.includes('รอ') || text.includes('แสตนด์บาย') || text.includes('หยุด')) return 'idle';
  return 'farm';
}

// State for top-right card dropdown menu & client-side Zeny rate fallback
let openCardMenuProfileId = null;
const clientZenyTrackers = {};

function toggleCardMenu(profileId, event) {
  if (event) event.stopPropagation();
  openCardMenuProfileId = (openCardMenuProfileId === profileId) ? null : profileId;
  renderProfiles();
}

function closeCardMenu() {
  if (openCardMenuProfileId !== null) {
    openCardMenuProfileId = null;
    renderProfiles();
  }
}

document.addEventListener('click', (e) => {
  if (openCardMenuProfileId && !e.target.closest('.card-top-menu')) {
    closeCardMenu();
  }
});

function getProfileZenyRate(p) {
  const isOnline = p.isRunning;
  const state = isOnline ? p.liveState : null;
  if (isOnline && state && typeof state.zeny === 'number') {
    const now = Date.now();
    const z = state.zeny;
    const gross = (typeof state.grossZenyGained === 'number' && Number.isFinite(state.grossZenyGained)) ? state.grossZenyGained : null;
    const isConsolReceiver = Boolean(state.consolidationReceiverMode);
    const charName = state.charName || '';
    let tr = clientZenyTrackers[p.id];
    if (!tr || (charName && tr.charName && tr.charName !== charName)) {
      tr = clientZenyTrackers[p.id] = {
        charName,
        startTime: now,
        lastTime: now,
        lastZeny: z,
        lastGrossGained: gross,
        totalGained: 0,
        samples: []
      };
    } else {
      if (charName && !tr.charName) tr.charName = charName;
      let gainDelta = 0;
      if (gross !== null) {
        if (typeof tr.lastGrossGained === 'number' && gross >= tr.lastGrossGained) {
          gainDelta = gross - tr.lastGrossGained;
        } else if (typeof tr.lastGrossGained === 'number' && gross > 0 && gross < tr.lastGrossGained) {
          gainDelta = gross;
        } else if (tr.lastGrossGained == null && typeof tr.lastZeny === 'number') {
          const rawDelta = z - tr.lastZeny;
          if (rawDelta > 0 && !isConsolReceiver) gainDelta = rawDelta;
        }
        tr.lastGrossGained = gross;
      } else {
        const delta = z - tr.lastZeny;
        if (delta > 0 && !isConsolReceiver) {
          gainDelta = delta;
        }
      }
      tr.lastZeny = z;
      tr.lastTime = now;
      if (gainDelta > 0 && !isConsolReceiver) {
        tr.totalGained += gainDelta;
        tr.samples.push({ t: now, gain: gainDelta });
      }
    }
    const cutoff = now - 60 * 60 * 1000;
    if (tr.samples.length > 0 && tr.samples[0].t < cutoff) {
      tr.samples = tr.samples.filter(s => s.t >= cutoff);
    }
    const windowStart = Math.max(tr.startTime, cutoff);
    const elapsedMs = Math.max(0, now - windowStart);
    const windowGain = tr.samples.reduce((sum, s) => sum + s.gain, 0);
    let clientGpm = 0;
    if (elapsedMs >= 3000 && windowGain > 0) {
      const effectiveMin = Math.max(elapsedMs / 60000, 0.25);
      clientGpm = Math.round(windowGain / effectiveMin);
    }
    const srvGpm = (p.zenyRate && typeof p.zenyRate.gpm === 'number') ? p.zenyRate.gpm : 0;
    const gpm = srvGpm > 0 ? srvGpm : clientGpm;
    return {
      gpm,
      gph: (p.zenyRate && p.zenyRate.gph > 0) ? p.zenyRate.gph : (gpm * 60),
      totalGained: Math.max((p.zenyRate && p.zenyRate.totalGained) || 0, tr.totalGained || 0)
    };
  }
  if (p.zenyRate && typeof p.zenyRate.gpm === 'number') {
    return {
      gpm: p.zenyRate.gpm,
      gph: p.zenyRate.gph || (p.zenyRate.gpm * 60),
      totalGained: p.zenyRate.totalGained || 0
    };
  }
  return { gpm: 0, gph: 0, totalGained: 0 };
}

function resetZenyRate(profileId, event) {
  if (event) event.stopPropagation();
  delete clientZenyTrackers[profileId];
  const p = currentProfiles.find(x => x.id === profileId);
  if (p && p.zenyRate) {
    p.zenyRate = { gpm: 0, gph: 0, totalGained: 0, elapsedSec: 0 };
  }
  fetch(`${API_BASE}/api/profiles/${profileId}/reset-zeny-rate`, { method: 'POST' }).catch(() => {});
  renderProfiles();
  if (typeof showToast === 'function') {
    showToast('🔄 รีเซ็ตค่าเฉลี่ย GP/M · GP/H ของจอนี้แล้ว', 'info');
  }
}

function formatBytes(bytes, decimals = 1) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(decimals)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(decimals)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatBytesShort(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0B';
  if (n < 1024) return `${Math.round(n)}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)}K`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}M`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)}G`;
}

const clientBwFallback = {};
function getProfileBandwidth(p) {
  if (p.bandwidth && typeof p.bandwidth.todayBytes === 'number') {
    return p.bandwidth;
  }
  const lbw = p.liveState && p.liveState.bandwidth;
  if (lbw && typeof lbw.totalBytes === 'number') {
    const now = Date.now();
    let tr = clientBwFallback[p.id];
    if (!tr || tr.sessionId !== lbw.sessionId) {
      tr = clientBwFallback[p.id] = {
        sessionId: lbw.sessionId,
        startTime: now,
        startBytes: lbw.totalBytes
      };
    }
    const elapsedSec = Math.max(1, (now - tr.startTime) / 1000);
    const delta = Math.max(0, lbw.totalBytes - tr.startBytes);
    const bps = elapsedSec >= 2 ? Math.round(delta / elapsedSec) : 0;
    const bytesPerHour = bps * 3600;
    return {
      todayBytes: lbw.totalBytes,
      todayRxBytes: lbw.rxBytes || 0,
      todayTxBytes: lbw.txBytes || 0,
      bps,
      bytesPerHour,
      estDayBytes: bytesPerHour * 24
    };
  }
  return {
    todayBytes: 0,
    todayRxBytes: 0,
    todayTxBytes: 0,
    bps: 0,
    bytesPerHour: 0,
    estDayBytes: 0
  };
}

function getAllBandwidthSummary() {
  if (currentBandwidthSummary && typeof currentBandwidthSummary.todayBytes === 'number') {
    return currentBandwidthSummary;
  }
  return currentProfiles.reduce((acc, p) => {
    const b = getProfileBandwidth(p);
    acc.todayBytes += (b.todayBytes || 0);
    acc.todayRxBytes += (b.todayRxBytes || 0);
    acc.todayTxBytes += (b.todayTxBytes || 0);
    acc.totalBps += (b.bps || 0);
    acc.totalBytesPerHour += (b.bytesPerHour || 0);
    acc.totalEstDayBytes += (b.estDayBytes || 0);
    return acc;
  }, { todayBytes: 0, todayRxBytes: 0, todayTxBytes: 0, totalBps: 0, totalBytesPerHour: 0, totalEstDayBytes: 0 });
}

function resetProfileBandwidth(profileId, event) {
  if (event) event.stopPropagation();
  delete clientBwFallback[profileId];
  const p = currentProfiles.find(x => x.id === profileId);
  if (p && p.bandwidth) {
    p.bandwidth = {
      ...p.bandwidth,
      todayBytes: 0,
      todayRxBytes: 0,
      todayTxBytes: 0,
      bps: 0,
      bytesPerHour: 0,
      estDayBytes: 0
    };
  }
  fetch(`${API_BASE}/api/profiles/${profileId}/reset-bandwidth`, { method: 'POST' })
    .then(() => fetchProfiles())
    .catch(() => {});
  renderProfiles();
  if (typeof showToast === 'function') {
    showToast('🔄 รีเซ็ตสถิติการใช้เน็ต (Bandwidth) ของจอนี้แล้ว', 'info');
  }
}

function isProfilePremium(p) {
  if (!p) return false;
  if (p.hasPremium === true) return true;
  if (p.liveState && p.liveState.hasPremium === true) return true;
  const until = Number(p.premiumUntil || p.liveState?.premiumUntil || p.lastPremiumUntil || 0);
  return until > Date.now();
}

function buildProfileCard(p) {
  const isOnline = p.isRunning;
  const state = isOnline ? p.liveState : null;
  const isWindowHidden = Boolean(state && typeof state.zeroRender === 'boolean' ? state.zeroRender : p.windowState?.isHidden);
  const isBotRunning = Boolean(state && state.isBotRunning);
  const isMenuOpen = openCardMenuProfileId === p.id;
  const hasPremium = isProfilePremium(p);
  const isJailed = Boolean(p.isJailed || (state && typeof state.map === 'string' && /คุก|เรือนจำ|\bprison\b|\bjail\b/i.test(state.map)));

  const charName = state?.charName || p.lastCharName || null;
  const curClass = (state?.charName && state?.charClass) ? state.charClass : (p.lastCharClass || p.charClass || state?.charClass || 'Archer');
  const hue = getClassHue(curClass);
  const portraitSrc = getPortraitSrc(p, state);
  const initial = escapeHTML(String(charName || p.name || '?').trim().charAt(0).toUpperCase());

  // Levels: prefer parsed numbers, fall back to the raw "Base Lv. 99\nJob Lv. 50" text
  let baseLv = state?.baseLv ?? null;
  let jobLv = state?.jobLv ?? null;
  if (state?.levels && (baseLv === null || jobLv === null)) {
    const nums = String(state.levels).match(/\d+/g) || [];
    if (baseLv === null && nums[0]) baseLv = Number(nums[0]);
    if (jobLv === null && nums[1]) jobLv = Number(nums[1]);
  }

  const curMap = isJailed ? (p.jailedMap || state?.map || 'คุก (ปิดจออัตโนมัติ)') : (state && state.map ? state.map : p.targetMap);
  const curAmmo = state && typeof state.ammo === 'number' ? state.ammo.toLocaleString() : '--';
  const curPos = state && state.pos && state.pos.tileX ? `${state.pos.tileX}, ${state.pos.tileY}` : (state?.coords && state.coords !== '--' ? state.coords.split(' (')[0] : '--');
  const curZeny = (state && typeof state.zeny === 'number') ? state.zeny.toLocaleString() : '--';
  const weightPct = state?.weight ? parseFloat(String(state.weight).replace(/[^\d.]/g, '')) : NaN;
  const weightTone = weightPct >= 80 ? 'bad' : weightPct >= 60 ? 'warn' : 'ok';
  const zenyRate = getProfileZenyRate(p);
  const bw = getProfileBandwidth(p);
  const allBw = getAllBandwidthSummary();

  // HP & SP
  const hpCur = state?.hp;
  const hpMax = state?.hpMax || hpCur || 1;
  const hpPct = (typeof hpCur === 'number' && hpMax > 0) ? Math.min(100, Math.round((hpCur / hpMax) * 100)) : 100;
  const hpStr = typeof hpCur === 'number' ? `${hpCur.toLocaleString()} / ${hpMax.toLocaleString()}` : (state?.hpText || '--');

  const spCur = state?.sp;
  const spMax = state?.spMax || spCur || 1;
  const spPct = (typeof spCur === 'number' && spMax > 0) ? Math.min(100, Math.round((spCur / spMax) * 100)) : 100;
  const spStr = typeof spCur === 'number' ? `${spCur.toLocaleString()} / ${spMax.toLocaleString()}` : (state?.spText || '--');

  const expPct = (t) => (t === 'MAX' ? 100 : Math.min(100, parseFloat(t) || 0));
  const hasExp = Boolean(state && (state.baseExp || state.jobExp));

  // Bot Activity Status
  let activityText = "ออฟไลน์";
  let activityTone = "offline";
  if (isJailed && !isOnline) {
    activityText = "🚨 ติดคุก (ปิดจออัตโนมัติแล้ว)";
    activityTone = "danger";
  } else if (isOnline) {
    if (isJailed) {
      activityText = "⛓️ อยู่ในคุก (เปิดจอโดยผู้ใช้)";
      activityTone = "danger";
    } else if (state) {
      if (state.botStatus) {
        activityText = state.botStatus;
        activityTone = getActivityTone(activityText);
      } else if (isBotRunning) {
        activityText = "⚔️ Auto-Farm ทำงาน";
        activityTone = "farm";
      } else {
        activityText = "⏸️ ยืนรอ / แสตนด์บาย";
        activityTone = "idle";
      }
    } else {
      activityText = "⏳ กำลังเชื่อมต่อ...";
      activityTone = "warn";
    }
  }

  const gauge = (kind, label, pct, val) => `
        <div class="gauge-row">
          <span class="gauge-lbl ${kind}">${label}</span>
          <div class="gauge-track"><div class="gauge-fill ${kind}" style="width: ${pct}%;"></div></div>
          <span class="gauge-val">${val}</span>
        </div>`;

  return `
    <article class="profile-card ${isOnline ? 'is-online' : 'is-offline'} ${p.isMain ? 'is-main' : ''} ${hasPremium ? 'is-premium' : ''} ${isBotRunning ? 'is-farming' : ''} ${isJailed ? 'is-jailed' : ''} ${isMenuOpen ? 'menu-open' : ''}" id="card-${p.id}" data-profile-id="${p.id}" style="--h: ${hue};">
      ${isJailed && !isOnline ? `
      <div class="card-jail-cross-overlay" title="ตัวละครนี้ตรวจพบว่าอยู่ในคุก ระบบได้ทำการปิดจอเกมอัตโนมัติแล้ว (เปิดจอใหม่ได้โดยไม่ปิดซ้ำ)">
        <svg class="jail-cross-svg" viewBox="0 0 200 200" preserveAspectRatio="none" aria-hidden="true">
          <line x1="12" y1="12" x2="188" y2="188" />
          <line x1="188" y1="12" x2="12" y2="188" />
        </svg>
        <div class="jail-cross-center-badge">
          <div class="jail-cross-icon">❌</div>
          <div class="jail-cross-title">ติดคุก · ปิดจออัตโนมัติแล้ว</div>
          <div class="jail-cross-sub">${escapeHTML(p.jailedMap || 'แมพคุก')}${p.jailedAt ? ` · ${formatThaiTime(p.jailedAt)}` : ''}</div>
          <button type="button" class="btn-clear-jail-badge" onclick="clearProfileJail('${p.id}', event)" title="ล้างสถานะกากบาทแดงของจอนี้">✓ ล้างกากบาท</button>
        </div>
      </div>` : ''}
      <div class="card-hero">
        ${portraitSrc ? `<div class="card-hero-bg-wrap"><div class="card-hero-bg" style="background-image: url('${portraitSrc}');"></div></div>` : ''}
        <div class="avatar ${portraitSrc ? '' : 'no-img'}" onclick="openCharacterModal('${p.id}')" title="คลิกเพื่อดูหน้าต่างตัวละคร สวมใส่/ถอดอุปกรณ์ และดูสถานะ (Equipment & Stats)">
          <span class="avatar-fallback">${initial}</span>
          ${portraitSrc ? `<img src="${portraitSrc}" alt="${escapeHTML(curClass)}" draggable="false" onerror="onPortraitError(this)">` : ''}
          ${baseLv !== null ? `<span class="avatar-lv" title="Base Level">${baseLv}</span>` : ''}
          <span class="avatar-dot ${isOnline ? 'online' : ''}"></span>
          <span class="avatar-hover-hint">🔍 ตรวจสอบ</span>
        </div>
        <div class="card-identity">
          <div class="card-title-row">
            <h3 class="profile-title" title="${escapeHTML(p.name)}">${escapeHTML(p.name)}</h3>
            ${isJailed ? `<span class="jail-card-badge" title="ตัวละครนี้ถูกส่งเข้าคุกและปิดจออัตโนมัติแล้ว">⛓️ ติดคุก</span>` : ''}
            ${hasPremium ? `<span class="premium-card-badge" title="ตัวละครนี้มีสถานะ Premium (สามารถแลกเปลี่ยน/เทรดโอนเงินได้)">👑 PREMIUM</span>` : ''}
            ${p.isMain ? `<span class="chip chip-main">★ MAIN</span>` : ''}
          </div>

          <div class="card-subline">
            ${charName ? `<span class="char-live-name">👤 ${escapeHTML(charName)}</span>` : ''}
            <span class="profile-acc">${escapeHTML(p.account || (p.autoRegister ? '⏳ รอสมัครไอดีอัตโนมัติ' : 'บัญชีเริ่มต้น'))}</span>
            ${p.registerError ? `<span class="profile-acc" style="color:#f59e0b; font-size:0.74rem;" title="${escapeHTML(p.registerError)}">⚠️ ${escapeHTML(p.registerError)}</span>` : ''}
          </div>
          <div class="card-class-row">
            <span class="chip chip-class">${escapeHTML(curClass)}</span>
            ${baseLv !== null ? `<span class="lv-text">Base <b>${baseLv}</b></span>` : ''}
            ${jobLv !== null ? `<span class="lv-text">Job <b>${jobLv}</b></span>` : ''}
            ${buildPartyRoleChip(p.id)}
            ${p.screenProxy && p.screenProxy.active && p.screenProxy.proxyHost ? `<span class="chip" style="background:rgba(168,85,247,0.18);color:#e9d5ff;border:1px solid rgba(168,85,247,0.45);font-size:0.68rem;cursor:pointer;" onclick="openScreenProxyModal()" title="จอนี้เชื่อมต่อผ่านคิวแยก IP: ${escapeHTML(p.screenProxy.proxyHost)}:${p.screenProxy.proxyPort || ''} (ช่อง ${p.screenProxy.slotIndex || 1}/${p.screenProxy.maxScreensPerIp || 3})">🛡️ IP: ${escapeHTML(p.screenProxy.proxyHost)} (${p.screenProxy.slotIndex || 1}/${p.screenProxy.maxScreensPerIp || 3})</span>` : ''}
          </div>
        </div>
        <div class="card-meta">
          <div class="card-meta-top">
            <span class="chip chip-port" title="Debug Port">:${p.debugPort || 49876}</span>
            <div class="card-top-menu ${isMenuOpen ? 'is-open' : ''}">
              <button type="button" class="btn-card-menu ${isMenuOpen ? 'active' : ''}" onclick="toggleCardMenu('${p.id}', event)" title="เมนูจัดการโปรไฟล์และการตั้งค่า">
                <span class="card-menu-bars">☰</span>
              </button>
              <div class="card-menu-dropdown" onclick="event.stopPropagation()">
                <div class="card-menu-header">⚙️ จัดการจอ: ${escapeHTML(p.name)}</div>
                <div class="card-menu-bw-box">
                  <div class="cm-bw-head">
                    <span>🌐 Bandwidth วันนี้ (จอนี้)</span>
                    <button type="button" class="cm-bw-reset-btn" onclick="resetProfileBandwidth('${p.id}', event)" title="รีเซ็ตสถิติการใช้เน็ตของจอนี้">🔄 รีเซ็ต</button>
                  </div>
                  <div class="cm-bw-grid">
                    <div class="cm-bw-item">
                      <span class="cm-bw-lbl">ใช้จริงวันนี้</span>
                      <span class="cm-bw-val">${formatBytes(bw.todayBytes)}</span>
                      <span class="cm-bw-sub">↓${formatBytesShort(bw.todayRxBytes)} · ↑${formatBytesShort(bw.todayTxBytes)}</span>
                    </div>
                    <div class="cm-bw-item">
                      <span class="cm-bw-lbl">คาดการณ์ 24 ชม.</span>
                      <span class="cm-bw-val est">${bw.estDayBytes > 0 ? `~${formatBytes(bw.estDayBytes)}` : '--'}</span>
                      <span class="cm-bw-sub">${isOnline ? `${formatBytesShort(bw.bps)}/s` : 'ออฟไลน์'} · ~${formatBytesShort(bw.bytesPerHour)}/ชม.</span>
                    </div>
                  </div>
                  <div class="cm-bw-total-row" title="ปริมาณการใช้เน็ตรวมทุกจอวันนี้และคาดการณ์ 24 ชม. สำหรับคำนวณแพ็กเกจ Proxy / VPN">
                    <span>🌍 รวมทุกจอ: <b>${formatBytes(allBw.todayBytes)}</b></span>
                    <span>(~<b>${formatBytes(allBw.totalEstDayBytes)}</b>/วัน)</span>
                  </div>
                </div>
                ${isOnline ? `
                <button type="button" class="card-menu-item" onclick="closeCardMenu(); focusClientWindow('${p.id}', this)">
                  <span class="cm-icon">🔝</span>
                  <span>ดึงจอขึ้นบนสุด (Popup)</span>
                </button>
                <button type="button" class="card-menu-item" onclick="closeCardMenu(); toggleClientWindow('${p.id}')">
                  <span class="cm-icon">⚡</span>
                  <span>${isWindowHidden ? 'แสดงภาพกราฟิกปกติ' : 'พักการ์ดจอ (Zero-Render)'}</span>
                </button>
                <button type="button" class="card-menu-item cm-warn" onclick="closeCardMenu(); stopClient('${p.id}')">
                  <span class="cm-icon">⏹️</span>
                  <span>ปิดจอเกมนี้</span>
                </button>
                <div class="card-menu-divider"></div>` : ''}
                <button type="button" class="card-menu-item" onclick="closeCardMenu(); openScriptPlanModal('${p.id}')">
                  <span class="cm-icon">📜</span>
                  <span>ตั้งค่าแผนการเล่น (Plan)</span>
                </button>
                <button type="button" class="card-menu-item" onclick="closeCardMenu(); openCardWhitelistModal('${p.id}')">
                  <span class="cm-icon">🛡️</span>
                  <span>จัดการ Whitelist (ห้ามขาย)</span>
                </button>
                <button type="button" class="card-menu-item" onclick="closeCardMenu(); openSaveClientPresetModal('${p.id}')">
                  <span class="cm-icon">💾</span>
                  <span>บันทึกเข้า Save List (Preset)</span>
                </button>
                <button type="button" class="card-menu-item" onclick="closeCardMenu(); openEditModal('${p.id}')">
                  <span class="cm-icon">⚙️</span>
                  <span>แก้ไขการตั้งค่าโปรไฟล์</span>
                </button>
                ${!p.isMain ? `
                <div class="card-menu-divider"></div>
                <button type="button" class="card-menu-item cm-danger" onclick="closeCardMenu(); deleteProfile('${p.id}')">
                  <span class="cm-icon">🗑️</span>
                  <span>ลบโปรไฟล์</span>
                </button>` : ''}
              </div>
            </div>
          </div>
          ${isOnline ? `<span class="chip ${isWindowHidden ? 'chip-warn' : 'chip-ok'}" style="cursor:pointer;" onclick="toggleClientWindow('${p.id}')" title="คลิกเพื่อเปิด/ปิดโหมดพักการ์ดจอ (Zero-Render — บอททำงานปกติ 100%)">${isWindowHidden ? '⚡ Zero-Render' : '🖥️ แสดงภาพ'}</span>` : ''}
        </div>
      </div>

      ${state && (typeof hpCur === 'number' || typeof spCur === 'number') ? `
      <div class="char-gauges">
        ${gauge('hp', 'HP', hpPct, hpStr)}
        ${gauge('sp', 'SP', spPct, spStr)}
        ${hasExp ? `
        <div class="exp-row">
          <div class="exp-item">
            <span class="exp-lbl">Base EXP</span>
            <div class="gauge-track thin"><div class="gauge-fill exp" style="width: ${expPct(state.baseExp)}%;"></div></div>
            <span class="exp-val">${escapeHTML(state.baseExp || '--')}</span>
          </div>
          <div class="exp-item">
            <span class="exp-lbl">Job EXP</span>
            <div class="gauge-track thin"><div class="gauge-fill exp job" style="width: ${expPct(state.jobExp)}%;"></div></div>
            <span class="exp-val">${escapeHTML(state.jobExp || '--')}</span>
          </div>
        </div>` : ''}
      </div>` : ''}

      ${state?.humanCheck?.active ? `
      <div class="human-check-alert-box" style="margin: 8px 12px; background: rgba(239, 68, 68, 0.2); border: 2px solid #ef4444; border-radius: 8px; padding: 10px; animation: pulse 1.5s infinite;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-weight: bold; color: #fca5a5; font-size: 13px;">🚨 เช็คผู้เล่น (Human Check)!</span>
          <div style="display: flex; gap: 6px; align-items: center;">
            ${state.humanCheck.autoSolved ? `<span style="font-size: 11px; color: #a7f3d0; background: #065f46; padding: 2px 6px; border-radius: 4px; font-weight: bold;">🤖 ตอบอัตโนมัติแล้ว</span>` : ''}
            <span style="font-size: 11px; color: #fecaca; background: #b91c1c; padding: 2px 6px; border-radius: 4px;">${escapeHTML(state.humanCheck.meta || 'ตอบด่วน')}</span>
          </div>
        </div>
        <div style="font-size: 12px; color: #fff; margin-bottom: 8px; font-weight: 500;">
          ❓ ${escapeHTML(state.humanCheck.prompt || 'กรุณาเลือกรูปภาพให้ถูกต้อง')}
        </div>
        <div style="display: grid; grid-template-columns: repeat(${Math.min(4, (state.humanCheck.options || []).length || 4)}, 1fr); gap: 6px;">
          ${((state.humanCheck.options && state.humanCheck.options.length) ? state.humanCheck.options : [0, 1, 2, 3]).map((opt, i) => {
            const idx = (typeof opt === 'object' && opt.index != null) ? opt.index : i;
            const name = (typeof opt === 'object' && opt.itemName) ? opt.itemName : `ข้อ ${i + 1}`;
            const icon = (typeof opt === 'object' && opt.icon) ? opt.icon : '';
            return `
            <button type="button" class="btn btn-sm" style="font-size: 11px; padding: 6px 4px; background: #dc2626; color: #fff; border: 1px solid #ef4444; border-radius: 6px; font-weight: bold; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 48px;" onclick="answerHumanCheckQuick('${p.id}', ${idx})" title="${escapeHTML(name)}">
              ${icon ? `<img src="${escapeHTML(icon)}" style="width: 22px; height: 22px; object-fit: contain; border-radius: 3px;" onerror="this.style.display='none'">` : ''}
              <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; font-size: 10.5px;">${escapeHTML(name)}</span>
            </button>
            `;
          }).join('')}
        </div>
      </div>` : ''}

      <div class="card-status-row">
        <span class="activity-pill tone-${activityTone}"><i></i>${escapeHTML(activityText)}</span>
        <div class="points-chips">
          ${state?.statPoints ? `<span class="chip chip-points" title="แต้มสถานะที่ยังไม่ได้อัป">STAT ${state.statPoints}</span>` : ''}
          ${state?.skillPoints ? `<span class="chip chip-points" title="แต้มสกิลที่ยังไม่ได้อัป">SKILL ${state.skillPoints}</span>` : ''}
        </div>
      </div>

      <div class="card-body">
        <div class="stat-item stat-wide">
          <span class="stat-lbl">📍 ${isOnline ? 'แมพปัจจุบัน' : 'แมพเป้าหมาย'}</span>
          <span class="stat-val stat-map" title="${escapeHTML(curMap)}">${escapeHTML(curMap || '--')}</span>
        </div>
        ${isOnline ? `
        <div class="stat-item">
          <span class="stat-lbl">พิกัด</span>
          <span class="stat-val mono" title="${escapeHTML(state?.coords || '')}">${escapeHTML(curPos)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-lbl">ลูกธนู</span>
          <span class="stat-val mono text-cyan">${curAmmo}</span>
        </div>
        <div class="stat-item">
          <span class="stat-lbl">น้ำหนัก</span>
          <span class="stat-val mono">${escapeHTML(state?.weight || '--')}</span>
          ${!isNaN(weightPct) ? `<div class="mini-track"><div class="mini-fill ${weightTone}" style="width: ${Math.min(100, weightPct)}%;"></div></div>` : ''}
        </div>
        <div class="stat-item">
          <span class="stat-lbl">Zeny</span>
          <span class="stat-val mono text-gold">${curZeny}</span>
        </div>` : ''}
        <div class="gp-rate-row" onclick="resetZenyRate('${p.id}', event)" title="รายได้เฉลี่ยต่อนาที (GP/M) และต่อชั่วโมง (GP/H) [คิดเฉพาะรายได้อย่างเดียว ไม่หักค่าซื้อของ/Token]${zenyRate.totalGained > 0 ? ` · สะสมรอบนี้ +${zenyRate.totalGained.toLocaleString()} z` : ''} — คลิกเพื่อรีเซ็ตการนับใหม่">
          <div class="gp-rate-cell">
            <span class="gp-rate-lbl">⚡ GP/M</span>
            <span class="gp-rate-val gp-m">${isOnline ? `${zenyRate.gpm.toLocaleString()} <small>z/m</small>` : '--'}</span>
          </div>
          <div class="gp-rate-sep"></div>
          <div class="gp-rate-cell">
            <span class="gp-rate-lbl">📈 GP/H</span>
            <span class="gp-rate-val gp-h">${isOnline ? `${zenyRate.gph.toLocaleString()} <small>z/h</small>` : '--'}</span>
          </div>
        </div>
        <div class="bw-rate-row" onclick="resetProfileBandwidth('${p.id}', event)" title="ปริมาณการใช้เน็ตของจอนี้วันนี้ (↓${formatBytes(bw.todayRxBytes)} / ↑${formatBytes(bw.todayTxBytes)}) · ความเร็ว ${formatBytes(bw.bps, 1)}/s (~${formatBytes(bw.bytesPerHour)}/ชม.) · รวมทุกจอวันนี้ ${formatBytes(allBw.todayBytes)} (คาดการณ์รวม ~${formatBytes(allBw.totalEstDayBytes)}/วัน) — คลิกเพื่อรีเซ็ตสถิติของจอนี้">
          <div class="bw-rate-cell">
            <div class="bw-cell-top">
              <span class="bw-rate-lbl">🌐 วันนี้</span>
              <span class="bw-rate-val bw-today">${(bw.todayBytes > 0 || isOnline) ? formatBytes(bw.todayBytes) : '--'}</span>
            </div>
            <div class="bw-cell-sub">
              <span>↓${formatBytesShort(bw.todayRxBytes)}</span>
              <span>↑${formatBytesShort(bw.todayTxBytes)}</span>
            </div>
          </div>
          <div class="bw-rate-sep"></div>
          <div class="bw-rate-cell">
            <div class="bw-cell-top">
              <span class="bw-rate-lbl">📊 ต่อวัน</span>
              <span class="bw-rate-val bw-est">${(bw.estDayBytes > 0 || isOnline) ? `~${formatBytes(bw.estDayBytes)}<small>/d</small>` : '--'}</span>
            </div>
            <div class="bw-cell-sub">
              <span>${isOnline && bw.bps > 0 ? `${formatBytes(bw.bps, 1)}/s` : 'ออฟไลน์'}</span>
              <span>${bw.bytesPerHour > 0 ? `~${formatBytesShort(bw.bytesPerHour)}/ชม.` : '24h'}</span>
            </div>
          </div>
        </div>
      </div>

      ${p.notes ? `<div class="card-notes" title="${escapeHTML(p.notes)}">📝 ${escapeHTML(p.notes)}</div>` : ''}

      <div class="card-footer-controls">
        <div class="card-action-row main-actions">
          ${isOnline ? (isBotRunning ? `
          <button class="btn btn-sm btn-bot-toggle is-stop" onclick="toggleBotExecution('${p.id}', false, this)" title="หยุดการทำงานของบอท (เกมยังเปิดอยู่)">
            <span>⏸️</span> หยุดบอท
          </button>` : `
          <button class="btn btn-sm btn-bot-toggle is-start" onclick="toggleBotExecution('${p.id}', true, this)" title="เริ่มการทำงานของบอททันที">
            <span>▶️</span> เริ่มบอท
          </button>`) : `
          <button class="btn btn-sm btn-launch" onclick="launchClient('${p.id}')" title="เปิดหน้าต่างเกมสำหรับโปรไฟล์นี้">
            <span>▶️</span> เปิดจอเกม
          </button>`}
          <button class="btn btn-sm btn-bot-menu" onclick="openWebBotHUD('${p.id}')" title="เปิดหน้าต่างเมนูบอท (หน้าตาเหมือนในเกม) สำหรับ Session นี้">
            <span>🎮</span> เมนูบอท
          </button>
        </div>
      </div>
    </article>`;
}

// Minimal DOM morph: update only changed attributes/text so images don't reload
// and HP/SP bars animate instead of the whole grid being rebuilt every poll.
function morphNode(oldNode, newNode) {
  if (oldNode.isEqualNode(newNode)) return;
  if (oldNode.nodeType !== newNode.nodeType || oldNode.nodeName !== newNode.nodeName || oldNode.childNodes.length !== newNode.childNodes.length) {
    oldNode.replaceWith(newNode);
    return;
  }
  if (oldNode.nodeType !== Node.ELEMENT_NODE) {
    oldNode.nodeValue = newNode.nodeValue;
    return;
  }
  Array.from(oldNode.attributes).forEach(a => { if (!newNode.hasAttribute(a.name)) oldNode.removeAttribute(a.name); });
  Array.from(newNode.attributes).forEach(a => { if (oldNode.getAttribute(a.name) !== a.value) oldNode.setAttribute(a.name, a.value); });
  const newKids = Array.from(newNode.childNodes);
  Array.from(oldNode.childNodes).forEach((child, i) => morphNode(child, newKids[i]));
}

// ==========================================
// PARTY GROUP VIEW & GP/M · GP/H COMPARISON
// ==========================================
let cardViewMode = 'default';
let cardSortMode = 'default';
try {
  const urlView = new URLSearchParams(window.location.search).get('view');
  cardViewMode = (urlView === 'party' || urlView === 'default') ? urlView : (localStorage.getItem('pelican_card_view_mode') || 'default');
  cardSortMode = localStorage.getItem('pelican_card_sort_mode') || 'default';
} catch (_) {}
const collapsedCardGroups = new Set();

function syncViewModeControls() {
  const btnDefault = document.getElementById('btn-view-mode-default');
  const btnParty = document.getElementById('btn-view-mode-party');
  const sortSel = document.getElementById('card-sort-select');
  if (btnDefault) btnDefault.classList.toggle('active', cardViewMode !== 'party');
  if (btnParty) btnParty.classList.toggle('active', cardViewMode === 'party');
  if (sortSel && sortSel.value !== cardSortMode) sortSel.value = cardSortMode;
  if (typeof syncChannelCheckModeUI === 'function') syncChannelCheckModeUI(currentChannelCheckMode);
}

function setCardViewMode(mode) {
  cardViewMode = mode === 'party' ? 'party' : 'default';
  try { localStorage.setItem('pelican_card_view_mode', cardViewMode); } catch (_) {}
  syncViewModeControls();
  if (cardViewMode === 'party' && typeof window.refreshPartyManagerData === 'function') {
    window.refreshPartyManagerData();
  }
  renderProfiles();
}

function setCardSortMode(sort) {
  cardSortMode = sort || 'default';
  try { localStorage.setItem('pelican_card_sort_mode', cardSortMode); } catch (_) {}
  syncViewModeControls();
  renderProfiles();
}

let currentChannelCheckMode = 'all';
try {
  currentChannelCheckMode = localStorage.getItem('pelican_channel_check_mode') || 'all';
} catch (_) {}

function syncChannelCheckModeUI(mode) {
  const valid = ['all', 'party_only', 'solo_only', 'off'];
  const norm = valid.includes(mode) ? mode : 'all';
  currentChannelCheckMode = norm;
  try { localStorage.setItem('pelican_channel_check_mode', norm); } catch (_) {}
  const selMain = document.getElementById('channel-check-mode-select');
  if (selMain && document.activeElement !== selMain && selMain.value !== norm) {
    selMain.value = norm;
  }
  const selParty = document.getElementById('pt-channel-check-mode');
  if (selParty && document.activeElement !== selParty && selParty.value !== norm) {
    selParty.value = norm;
  }
}

window.setChannelCheckMode = async function (mode) {
  const valid = ['all', 'party_only', 'solo_only', 'off'];
  const norm = valid.includes(mode) ? mode : 'all';
  syncChannelCheckModeUI(norm);
  const labels = {
    all: '🔄 เช็ค CH คนน้อยสุดหลังขายของ + ดึงตี้ตาม (ทุกจอ)',
    party_only: '👑 เฉพาะปาร์ตี้: หลังขายของย้าย CH คนน้อยสุด + ดึงตี้ตาม',
    solo_only: '👤 เฉพาะฟาร์มเดี่ยว: เช็ค CH คนน้อยสุดหลังขายของ',
    off: '⏸️ ปิดการเช็ค/ย้าย CH หลังขายของ'
  };
  try {
    const res = await fetch(`${API_BASE}/api/channel-check-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: norm })
    });
    const j = await res.json().catch(() => ({}));
    if (j && j.mode) syncChannelCheckModeUI(j.mode);
    if (typeof showToast === 'function') {
      showToast(`ตั้งโหมดเช็ค Channel: ${labels[norm] || norm}`, 'success');
    }
    if (typeof window.refreshPartyManagerData === 'function') {
      window.refreshPartyManagerData();
    }
  } catch (err) {
    console.error('Failed to save channelCheckMode:', err);
    if (typeof showToast === 'function') {
      showToast('บันทึกโหมดเช็ค Channel ไม่สำเร็จ', 'error');
    }
  }
};

function toggleCardGroupCollapse(groupKey, event) {
  if (event) event.stopPropagation();
  if (collapsedCardGroups.has(groupKey)) collapsedCardGroups.delete(groupKey);
  else collapsedCardGroups.add(groupKey);
  renderProfiles();
}

window.onPartyDataUpdated = function () {
  if (currentProfiles && currentProfiles.length > 0) {
    renderProfiles();
  }
};

function isPriestClassName(cls) {
  return /^(priest|acolyte|พระ)$/i.test(String(cls || '').trim());
}

function getPartyRoleMap() {
  const map = new Map();
  const pData = window.__partyManagerData;
  const parties = (pData && Array.isArray(pData.parties)) ? pData.parties : [];
  const profileById = new Map(currentProfiles.map(p => [p.id, p]));

  parties.forEach((party, idx) => {
    const pIndex = party.index || (idx + 1);
    const allSlots = [party.leader, ...(Array.isArray(party.members) ? party.members : [])].filter(Boolean);
    let anchorPriestId = null;
    for (const slot of allSlots) {
      const prof = profileById.get(slot.id);
      const liveCls = (prof?.liveState?.charName && prof?.liveState?.charClass) ? prof.liveState.charClass : '';
      const candidates = [liveCls, slot.charClass, prof?.lastCharClass, prof?.charClass];
      if (candidates.some(c => isPriestClassName(c))) {
        anchorPriestId = slot.id;
        break;
      }
    }
    allSlots.forEach((slot) => {
      const isLeader = Boolean(party.leader && slot.id === party.leader.id);
      const isAnchorPriest = slot.id === anchorPriestId;
      map.set(slot.id, {
        partyId: party.id,
        partyIndex: pIndex,
        isLeader,
        isAnchorPriest,
        followMode: slot.followMode || 'none',
        status: slot.status || '',
        statusText: slot.statusText || ''
      });
    });
  });
  return map;
}

function buildPartyRoleChip(profileId) {
  const info = getPartyRoleMap().get(profileId);
  if (!info) return '';
  if (info.isLeader && info.isAnchorPriest) {
    return `<span class="party-role-chip role-priest-leader" onclick="if(window.openPartyDrawer)window.openPartyDrawer()" title="หัวตี้ + พระหลักศูนย์กลางของปาร์ตี้ #${info.partyIndex}">👑✨ หัวตี้·พระ #${info.partyIndex}</span>`;
  }
  if (info.isLeader) {
    return `<span class="party-role-chip role-leader" onclick="if(window.openPartyDrawer)window.openPartyDrawer()" title="หัวหน้าปาร์ตี้ #${info.partyIndex}">👑 หัวตี้ #${info.partyIndex}</span>`;
  }
  if (info.isAnchorPriest) {
    return `<span class="party-role-chip role-priest" onclick="if(window.openPartyDrawer)window.openPartyDrawer()" title="พระหลักจุดศูนย์กลางของปาร์ตี้ #${info.partyIndex}">✨ พระหลัก #${info.partyIndex}</span>`;
  }
  return `<span class="party-role-chip role-member" onclick="if(window.openPartyDrawer)window.openPartyDrawer()" title="สมาชิกปาร์ตี้ #${info.partyIndex}${info.statusText ? ' · ' + escapeHTML(info.statusText) : ''}">👥 ตี้ #${info.partyIndex}</span>`;
}

function getProfileBaseLevelNum(p) {
  const st = p.isRunning ? p.liveState : null;
  if (st && typeof st.baseLv === 'number') return st.baseLv;
  if (st && st.levels) {
    const nums = String(st.levels).match(/\d+/g);
    if (nums && nums[0]) return Number(nums[0]);
  }
  return 0;
}

function sortProfileList(list) {
  if (!Array.isArray(list) || list.length <= 1 || cardSortMode === 'default') return list;
  const copy = list.slice();
  copy.sort((a, b) => {
    if (cardSortMode === 'gpm_desc') {
      const d = getProfileZenyRate(b).gpm - getProfileZenyRate(a).gpm;
      if (d !== 0) return d;
      return (b.isRunning ? 1 : 0) - (a.isRunning ? 1 : 0);
    }
    if (cardSortMode === 'gpm_asc') {
      const aRate = getProfileZenyRate(a).gpm;
      const bRate = getProfileZenyRate(b).gpm;
      if (a.isRunning !== b.isRunning) return a.isRunning ? -1 : 1;
      return aRate - bRate;
    }
    if (cardSortMode === 'zeny_desc') {
      const az = (a.isRunning && a.liveState && typeof a.liveState.zeny === 'number') ? a.liveState.zeny : -1;
      const bz = (b.isRunning && b.liveState && typeof b.liveState.zeny === 'number') ? b.liveState.zeny : -1;
      return bz - az;
    }
    if (cardSortMode === 'level_desc') {
      return getProfileBaseLevelNum(b) - getProfileBaseLevelNum(a);
    }
    return 0;
  });
  return copy;
}

function summarizeGroupStats(profiles) {
  let onlineCount = 0;
  let farmingCount = 0;
  let totalGpm = 0;
  let totalGph = 0;
  let totalGained = 0;
  let topEarner = null;

  for (const p of profiles) {
    const rate = getProfileZenyRate(p);
    if (p.isRunning) {
      onlineCount++;
      if (p.liveState && p.liveState.isBotRunning) farmingCount++;
      totalGpm += rate.gpm || 0;
      totalGph += rate.gph || 0;
      totalGained += rate.totalGained || 0;
      if ((rate.gpm || 0) > 0 && (!topEarner || rate.gpm > topEarner.gpm)) {
        topEarner = {
          id: p.id,
          name: (p.liveState && p.liveState.charName) || p.lastCharName || p.name,
          gpm: rate.gpm,
          gph: rate.gph
        };
      }
    }
  }

  const avgGpm = onlineCount > 0 ? Math.round(totalGpm / onlineCount) : 0;
  const avgGph = onlineCount > 0 ? Math.round(totalGph / onlineCount) : 0;

  return {
    totalCount: profiles.length,
    onlineCount,
    farmingCount,
    totalGpm,
    totalGph,
    totalGained,
    avgGpm,
    avgGph,
    topEarner
  };
}

function resetAllZenyRates(event) {
  if (event) event.stopPropagation();
  for (const p of currentProfiles) {
    delete clientZenyTrackers[p.id];
    if (p.zenyRate) p.zenyRate = { gpm: 0, gph: 0, totalGained: 0, elapsedSec: 0 };
    fetch(`${API_BASE}/api/profiles/${p.id}/reset-zeny-rate`, { method: 'POST' }).catch(() => {});
  }
  renderProfiles();
  if (typeof showToast === 'function') {
    showToast('🔄 รีเซ็ต GP/M · GP/H ทุกจอพร้อมกันแล้ว (เริ่มเทียบความไวใหม่จาก 0)', 'success');
  }
}

function resetGroupZenyRate(groupKey, event) {
  if (event) event.stopPropagation();
  const roleMap = getPartyRoleMap();
  let targets = [];
  let label = 'กลุ่มนี้';
  if (groupKey === 'solo') {
    targets = currentProfiles.filter(p => !roleMap.has(p.id));
    label = 'กลุ่มฟาร์มเดี่ยว (Solo)';
  } else if (groupKey.startsWith('party:')) {
    const pid = groupKey.slice(6);
    targets = currentProfiles.filter(p => {
      const r = roleMap.get(p.id);
      return r && r.partyId === pid;
    });
    const first = targets[0] ? roleMap.get(targets[0].id) : null;
    label = first ? `ปาร์ตี้ #${first.partyIndex}` : 'ปาร์ตี้นี้';
  }
  for (const p of targets) {
    delete clientZenyTrackers[p.id];
    if (p.zenyRate) p.zenyRate = { gpm: 0, gph: 0, totalGained: 0, elapsedSec: 0 };
    fetch(`${API_BASE}/api/profiles/${p.id}/reset-zeny-rate`, { method: 'POST' }).catch(() => {});
  }
  renderProfiles();
  if (typeof showToast === 'function') {
    showToast(`🔄 รีเซ็ต GP/M · GP/H ของ ${label} (${targets.length} จอ) แล้ว`, 'info');
  }
}

function buildPartyVsSoloBanner(partyCount, partyStats, soloStats) {
  const maxAvg = Math.max(1, partyStats.avgGpm, soloStats.avgGpm);
  const partyBarPct = partyStats.avgGpm > 0 ? Math.max(6, Math.round((partyStats.avgGpm / maxAvg) * 100)) : 0;
  const soloBarPct = soloStats.avgGpm > 0 ? Math.max(6, Math.round((soloStats.avgGpm / maxAvg) * 100)) : 0;

  let verdictHtml = `<div class="pvs-verdict neutral"><span class="pvs-verdict-icon">⏳</span><div><div class="pvs-verdict-title">รอข้อมูลเปรียบเทียบ GP/M ต่อจอ</div><div class="pvs-verdict-sub">เปิดบอทฟาร์มทั้งแบบตี้และแบบเดี่ยว ระบบจะคำนวณให้ทันทีว่าแบบไหนทำเงินต่อจอได้ไวกว่ากัน</div></div></div>`;

  if (partyStats.avgGpm > 0 && soloStats.avgGpm > 0) {
    const diffGpm = partyStats.avgGpm - soloStats.avgGpm;
    const diffGph = partyStats.avgGph - soloStats.avgGph;
    const base = Math.min(partyStats.avgGpm, soloStats.avgGpm);
    const pct = base > 0 ? ((Math.abs(diffGpm) / base) * 100).toFixed(1) : '0.0';
    if (Math.abs(diffGpm) <= Math.max(50, base * 0.02)) {
      verdictHtml = `
        <div class="pvs-verdict tie">
          <span class="pvs-verdict-icon">⚖️</span>
          <div>
            <div class="pvs-verdict-title">สูสีกัน! รายได้เฉลี่ยต่อจอใกล้เคียงกันมาก (ต่างกัน ~${pct}%)</div>
            <div class="pvs-verdict-sub">แบบตี้ ${partyStats.avgGpm.toLocaleString()} z/m ต่อจอ vs แบบเดี่ยว ${soloStats.avgGpm.toLocaleString()} z/m ต่อจอ</div>
          </div>
        </div>`;
    } else if (diffGpm > 0) {
      verdictHtml = `
        <div class="pvs-verdict party-win">
          <span class="pvs-verdict-icon">🏆</span>
          <div>
            <div class="pvs-verdict-title">ฟาร์มแบบตี้ไวกว่า <b>+${pct}%</b> ต่อจอ!</div>
            <div class="pvs-verdict-sub">ได้มากกว่าเฉลี่ย <b>+${diffGpm.toLocaleString()} z/m</b> (<b>+${diffGph.toLocaleString()} z/h</b>) ต่อ 1 จอที่ออนไลน์</div>
          </div>
        </div>`;
    } else {
      const absGpm = Math.abs(diffGpm);
      const absGph = Math.abs(diffGph);
      verdictHtml = `
        <div class="pvs-verdict solo-win">
          <span class="pvs-verdict-icon">⚡</span>
          <div>
            <div class="pvs-verdict-title">ฟาร์มเดี่ยว (Solo) ไวกว่า <b>+${pct}%</b> ต่อจอ!</div>
            <div class="pvs-verdict-sub">ได้มากกว่าเฉลี่ย <b>+${absGpm.toLocaleString()} z/m</b> (<b>+${absGph.toLocaleString()} z/h</b>) ต่อ 1 จอที่ออนไลน์</div>
          </div>
        </div>`;
    }
  } else if (partyStats.avgGpm > 0 && soloStats.onlineCount === 0) {
    verdictHtml = `
      <div class="pvs-verdict party-win">
        <span class="pvs-verdict-icon">👑</span>
        <div>
          <div class="pvs-verdict-title">กำลังฟาร์มแบบตี้: เฉลี่ย <b>${partyStats.avgGpm.toLocaleString()} z/m</b> (${partyStats.avgGph.toLocaleString()} z/h) ต่อจอ</div>
          <div class="pvs-verdict-sub">รวมทุกตี้ ${partyStats.totalGpm.toLocaleString()} z/m · ${partyStats.totalGph.toLocaleString()} z/h (ไม่มีจอฟาร์มเดี่ยวออนไลน์)</div>
        </div>
      </div>`;
  } else if (soloStats.avgGpm > 0 && partyStats.onlineCount === 0) {
    verdictHtml = `
      <div class="pvs-verdict solo-win">
        <span class="pvs-verdict-icon">⚔️</span>
        <div>
          <div class="pvs-verdict-title">กำลังฟาร์มเดี่ยว: เฉลี่ย <b>${soloStats.avgGpm.toLocaleString()} z/m</b> (${soloStats.avgGph.toLocaleString()} z/h) ต่อจอ</div>
          <div class="pvs-verdict-sub">รวมโซโล่ ${soloStats.totalGpm.toLocaleString()} z/m · ${soloStats.totalGph.toLocaleString()} z/h (ยังไม่มีจอในปาร์ตี้ออนไลน์)</div>
        </div>
      </div>`;
  }

  return `
    <div class="party-vs-solo-banner" data-group-id="banner-party-vs-solo">
      <div class="pvs-top-row">
        <div class="pvs-heading">
          <span class="pvs-badge-icon">📊</span>
          <div>
            <div class="pvs-title">เปรียบเทียบความไว: ฟาร์มแบบตี้ (Party) vs ฟาร์มเดี่ยว (Solo)</div>
            <div class="pvs-subtitle">เทียบค่าเฉลี่ย GP/M (ต่อนาที) และ GP/H (ต่อชั่วโมง) ต่อ 1 จอที่ออนไลน์ เพื่อดูว่าโหมดไหนคุ้มค่ากว่ากัน</div>
          </div>
        </div>
        <div class="pvs-actions">
          <button type="button" class="btn btn-ghost btn-sm pvs-btn-reset" onclick="resetAllZenyRates(event)" title="รีเซ็ตตัวนับ GP/M และ GP/H ของทุกจอพร้อมกัน เพื่อเริ่มจับเวลาเปรียบเทียบใหม่พร้อมกัน">
            <span>🔄</span> รีเซ็ต GP/M ทุกจอพร้อมกัน
          </button>
          <button type="button" class="btn btn-ghost btn-sm pvs-btn-party" onclick="if(window.openPartyDrawer)window.openPartyDrawer()" title="เปิดหน้าต่างตั้งค่าปาร์ตี้">
            <span>👑</span> จัดการตี้ (${partyCount})
          </button>
        </div>
      </div>

      <div class="pvs-grid">
        <!-- PARTY SUMMARY -->
        <div class="pvs-metric-box is-party ${partyStats.avgGpm > soloStats.avgGpm && partyStats.avgGpm > 0 ? 'is-leading' : ''}">
          <div class="pvs-box-head">
            <span class="pvs-box-tag party">👑 เฉลี่ยแบบตี้ (ต่อ 1 จอ)</span>
            <span class="pvs-box-count">${partyCount} ตี้ · ออนไลน์ <b>${partyStats.onlineCount}</b>/${partyStats.totalCount} จอ</span>
          </div>
          <div class="pvs-main-numbers">
            <div class="pvs-num-col">
              <span class="pvs-num-lbl">⚡ เฉลี่ย GP/M ต่อจอ</span>
              <span class="pvs-num-val gpm">${partyStats.avgGpm.toLocaleString()} <small>z/m</small></span>
            </div>
            <div class="pvs-num-sep"></div>
            <div class="pvs-num-col">
              <span class="pvs-num-lbl">📈 เฉลี่ย GP/H ต่อจอ</span>
              <span class="pvs-num-val gph">${partyStats.avgGph.toLocaleString()} <small>z/h</small></span>
            </div>
          </div>
          <div class="pvs-bar-track"><div class="pvs-bar-fill party" style="width: ${partyBarPct}%;"></div></div>
          <div class="pvs-box-foot">
            <span>รวมทุกตี้: <b>${partyStats.totalGpm.toLocaleString()} z/m</b> · <b>${partyStats.totalGph.toLocaleString()} z/h</b></span>
            <span>สะสมรอบนี้: <b>+${partyStats.totalGained.toLocaleString()} z</b></span>
          </div>
        </div>

        <!-- SOLO SUMMARY -->
        <div class="pvs-metric-box is-solo ${soloStats.avgGpm > partyStats.avgGpm && soloStats.avgGpm > 0 ? 'is-leading' : ''}">
          <div class="pvs-box-head">
            <span class="pvs-box-tag solo">⚔️ เฉลี่ยฟาร์มเดี่ยว (ต่อ 1 จอ)</span>
            <span class="pvs-box-count">โซโล่ · ออนไลน์ <b>${soloStats.onlineCount}</b>/${soloStats.totalCount} จอ</span>
          </div>
          <div class="pvs-main-numbers">
            <div class="pvs-num-col">
              <span class="pvs-num-lbl">⚡ เฉลี่ย GP/M ต่อจอ</span>
              <span class="pvs-num-val gpm">${soloStats.avgGpm.toLocaleString()} <small>z/m</small></span>
            </div>
            <div class="pvs-num-sep"></div>
            <div class="pvs-num-col">
              <span class="pvs-num-lbl">📈 เฉลี่ย GP/H ต่อจอ</span>
              <span class="pvs-num-val gph">${soloStats.avgGph.toLocaleString()} <small>z/h</small></span>
            </div>
          </div>
          <div class="pvs-bar-track"><div class="pvs-bar-fill solo" style="width: ${soloBarPct}%;"></div></div>
          <div class="pvs-box-foot">
            <span>รวมโซโล่: <b>${soloStats.totalGpm.toLocaleString()} z/m</b> · <b>${soloStats.totalGph.toLocaleString()} z/h</b></span>
            <span>สะสมรอบนี้: <b>+${soloStats.totalGained.toLocaleString()} z</b></span>
          </div>
        </div>

        <!-- VERDICT -->
        <div class="pvs-verdict-wrap">
          ${verdictHtml}
        </div>
      </div>
    </div>`;
}

function buildPartyGroupSection(party, idx, profileById, roleMap, soloAvgGpm) {
  const pIndex = party.index || (idx + 1);
  const groupKey = `party:${party.id}`;
  const isCollapsed = collapsedCardGroups.has(groupKey);

  const rawSlots = [party.leader, ...(Array.isArray(party.members) ? party.members : [])].filter(Boolean);
  let partyProfiles = rawSlots.map(s => profileById.get(s.id)).filter(Boolean);

  // Default order inside party: Leader -> Priest Anchor -> Other Members
  if (cardSortMode === 'default') {
    partyProfiles.sort((a, b) => {
      const ra = roleMap.get(a.id) || {};
      const rb = roleMap.get(b.id) || {};
      const score = r => (r.isLeader ? 0 : r.isAnchorPriest ? 1 : 2);
      return score(ra) - score(rb);
    });
  } else {
    partyProfiles = sortProfileList(partyProfiles);
  }

  const stats = summarizeGroupStats(partyProfiles);
  const leaderSlot = party.leader || {};
  const leaderName = leaderSlot.charName || leaderSlot.profileName || 'หัวตี้';
  const priestSlot = rawSlots.find(s => {
    const r = roleMap.get(s.id);
    return r && r.isAnchorPriest;
  });
  const priestName = priestSlot ? (priestSlot.charName || priestSlot.profileName) : null;
  const anchorSlot = (priestSlot && priestSlot.mapName) ? priestSlot : leaderSlot;
  const mapLabel = anchorSlot.mapName || '--';
  const chLabel = anchorSlot.channel ? `CH ${anchorSlot.channel}` : '';
  const expLabel = party.expMode === 'even-share' ? 'EXP แชร์กัน' : 'EXP แยก';

  let vsSoloBadge = '';
  if (stats.avgGpm > 0 && soloAvgGpm > 0) {
    const diffPct = Math.round(((stats.avgGpm - soloAvgGpm) / soloAvgGpm) * 100);
    if (diffPct > 2) {
      vsSoloBadge = `<span class="pg-vs-pill win" title="เฉลี่ยต่อจอของตี้นี้สูงกว่าค่าเฉลี่ยฟาร์มเดี่ยว">+${diffPct}% vs โซโล่</span>`;
    } else if (diffPct < -2) {
      vsSoloBadge = `<span class="pg-vs-pill loss" title="เฉลี่ยต่อจอของตี้นี้ต่ำกว่าค่าเฉลี่ยฟาร์มเดี่ยว">${diffPct}% vs โซโล่</span>`;
    } else {
      vsSoloBadge = `<span class="pg-vs-pill tie">≈ พอๆ กับโซโล่</span>`;
    }
  }

  return `
    <section class="profile-group-section is-party-group ${isCollapsed ? 'is-collapsed' : ''}" data-group-id="group-party-${party.id}">
      <header class="profile-group-header" onclick="toggleCardGroupCollapse('${groupKey}', event)">
        <div class="pg-head-left">
          <button type="button" class="pg-collapse-btn" title="${isCollapsed ? 'คลิกเพื่อขยายดูการ์ดในตี้นี้' : 'คลิกเพื่อพับเก็บการ์ดในตี้นี้'}">${isCollapsed ? '▶' : '▼'}</button>
          <span class="pg-group-badge party">👑 ปาร์ตี้ #${pIndex}</span>
          <div class="pg-title-block">
            <div class="pg-title-main">
              <span>หัวตี้: <b>${escapeHTML(leaderName)}</b></span>
              ${priestName ? `<span class="pg-priest-pill">✨ พระหลัก: <b>${escapeHTML(priestName)}</b></span>` : `<span class="pg-no-priest-pill">ไม่มีพระในตี้</span>`}
            </div>
            <div class="pg-meta-pills">
              <span class="pg-meta-chip">👥 สมาชิก <b>${partyProfiles.length}</b>/${party.max || 6} · ออนไลน์ <b>${stats.onlineCount}</b></span>
              <span class="pg-meta-chip map">📍 ${escapeHTML(mapLabel)}${chLabel ? ` · <b>${escapeHTML(chLabel)}</b>` : ''}</span>
              <span class="pg-meta-chip">${escapeHTML(expLabel)}</span>
            </div>
          </div>
        </div>

        <div class="pg-head-right" onclick="event.stopPropagation()">
          <div class="pg-rate-summary">
            <div class="pg-rate-col">
              <span class="pg-rate-lbl">⚡ รวมทั้งตี้ (${stats.onlineCount} จอ)</span>
              <span class="pg-rate-val total">${stats.totalGpm.toLocaleString()} <small>z/m</small> · <span class="gph">${stats.totalGph.toLocaleString()} <small>z/h</small></span></span>
            </div>
            <div class="pg-rate-sep"></div>
            <div class="pg-rate-col">
              <span class="pg-rate-lbl">👤 เฉลี่ยต่อจอ ${vsSoloBadge}</span>
              <span class="pg-rate-val avg">${stats.avgGpm.toLocaleString()} <small>z/m</small> · <span class="gph">${stats.avgGph.toLocaleString()} <small>z/h</small></span></span>
            </div>
          </div>
          <div class="pg-head-actions">
            <button type="button" class="btn btn-ghost btn-sm pg-action-btn" onclick="resetGroupZenyRate('${groupKey}', event)" title="รีเซ็ต GP/M · GP/H เฉพาะสมาชิกในปาร์ตี้นี้">🔄 รีเซ็ตตี้</button>
            <button type="button" class="btn btn-ghost btn-sm pg-action-btn" onclick="if(window.openPartyDrawer)window.openPartyDrawer()" title="ตั้งค่าปาร์ตี้นี้">⚙️ ตั้งค่าตี้</button>
          </div>
        </div>
      </header>
      ${isCollapsed ? '' : `
      <div class="profile-group-grid profiles-grid">
        ${partyProfiles.map(buildProfileCard).join('')}
      </div>`}
    </section>`;
}

function buildSoloGroupSection(soloProfiles) {
  const groupKey = 'solo';
  const isCollapsed = collapsedCardGroups.has(groupKey);
  const sortedSolo = sortProfileList(soloProfiles);
  const stats = summarizeGroupStats(sortedSolo);

  return `
    <section class="profile-group-section is-solo-group ${isCollapsed ? 'is-collapsed' : ''}" data-group-id="group-solo">
      <header class="profile-group-header" onclick="toggleCardGroupCollapse('${groupKey}', event)">
        <div class="pg-head-left">
          <button type="button" class="pg-collapse-btn" title="${isCollapsed ? 'คลิกเพื่อขยายดูการ์ดฟาร์มเดี่ยว' : 'คลิกเพื่อพับเก็บการ์ดฟาร์มเดี่ยว'}">${isCollapsed ? '▶' : '▼'}</button>
          <span class="pg-group-badge solo">⚔️ ฟาร์มเดี่ยว (Solo)</span>
          <div class="pg-title-block">
            <div class="pg-title-main">
              <span>ตัวละครที่ไม่ได้อยู่ในปาร์ตี้ (${stats.totalCount} จอ)</span>
              ${stats.topEarner ? `<span class="pg-top-earner-pill" title="จอฟาร์มเดี่ยวที่ทำ GP/M สูงสุดในตอนนี้">🏆 สูงสุด: <b>${escapeHTML(stats.topEarner.name)}</b> (${stats.topEarner.gpm.toLocaleString()} z/m)</span>` : ''}
            </div>
            <div class="pg-meta-pills">
              <span class="pg-meta-chip">🖥️ ออนไลน์ <b>${stats.onlineCount}</b>/${stats.totalCount} จอ</span>
              <span class="pg-meta-chip">⚔️ กำลังฟาร์ม <b>${stats.farmingCount}</b> จอ</span>
              <span class="pg-meta-chip">💰 สะสมรอบนี้ <b>+${stats.totalGained.toLocaleString()} z</b></span>
            </div>
          </div>
        </div>

        <div class="pg-head-right" onclick="event.stopPropagation()">
          <div class="pg-rate-summary">
            <div class="pg-rate-col">
              <span class="pg-rate-lbl">⚡ รวมโซโล่ (${stats.onlineCount} จอ)</span>
              <span class="pg-rate-val total">${stats.totalGpm.toLocaleString()} <small>z/m</small> · <span class="gph">${stats.totalGph.toLocaleString()} <small>z/h</small></span></span>
            </div>
            <div class="pg-rate-sep"></div>
            <div class="pg-rate-col">
              <span class="pg-rate-lbl">👤 เฉลี่ยต่อจอ</span>
              <span class="pg-rate-val avg">${stats.avgGpm.toLocaleString()} <small>z/m</small> · <span class="gph">${stats.avgGph.toLocaleString()} <small>z/h</small></span></span>
            </div>
          </div>
          <div class="pg-head-actions">
            <button type="button" class="btn btn-ghost btn-sm pg-action-btn" onclick="resetGroupZenyRate('solo', event)" title="รีเซ็ต GP/M · GP/H เฉพาะกลุ่มฟาร์มเดี่ยว">🔄 รีเซ็ตโซโล่</button>
          </div>
        </div>
      </header>
      ${isCollapsed ? '' : `
      <div class="profile-group-grid profiles-grid">
        ${sortedSolo.length > 0 ? sortedSolo.map(buildProfileCard).join('') : `<div class="empty-state" style="padding: 24px;"><p style="margin:0;">ทุกโปรไฟล์ถูกจัดอยู่ในปาร์ตี้หมดแล้ว</p></div>`}
      </div>`}
    </section>`;
}

function renderProfiles() {
  syncViewModeControls();
  if (currentProfiles.length === 0) {
    gridEl.classList.remove('grouped-mode');
    gridEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎮</div>
        <p>ยังไม่มีโปรไฟล์จอเกมในระบบ</p>
        <button class="btn btn-primary" onclick="openAddModal()">➕ เพิ่มโปรไฟล์แรกเลย</button>
      </div>
    `;
    return;
  }

  const tpl = document.createElement('template');
  if (cardViewMode === 'party') {
    gridEl.classList.add('grouped-mode');
    const pData = window.__partyManagerData;
    const parties = (pData && Array.isArray(pData.parties)) ? pData.parties : [];
    const profileById = new Map(currentProfiles.map(p => [p.id, p]));
    const roleMap = getPartyRoleMap();

    const partyProfilesAll = currentProfiles.filter(p => roleMap.has(p.id));
    const soloProfilesAll = currentProfiles.filter(p => !roleMap.has(p.id));
    const partyStats = summarizeGroupStats(partyProfilesAll);
    const soloStats = summarizeGroupStats(soloProfilesAll);

    let html = buildPartyVsSoloBanner(parties.length, partyStats, soloStats);
    if (parties.length === 0) {
      html += `
        <section class="profile-group-section is-party-group" data-group-id="group-no-party">
          <div class="pg-empty-party-notice">
            <div>
              <strong>👑 ยังไม่ได้สร้างปาร์ตี้ในระบบ</strong>
              <p>คุณสามารถกดปุ่มด้านขวาเพื่อเลือกหัวตี้และจัดสมาชิกเข้าตี้ เพื่อเปรียบเทียบ GP/M · GP/H กับกลุ่มฟาร์มเดี่ยวได้ทันที</p>
            </div>
            <button type="button" class="btn btn-primary btn-sm" onclick="if(window.openPartyDrawer)window.openPartyDrawer()">➕ สร้าง / จัดปาร์ตี้</button>
          </div>
        </section>`;
    } else {
      html += parties.map((party, idx) => buildPartyGroupSection(party, idx, profileById, roleMap, soloStats.avgGpm)).join('');
    }
    html += buildSoloGroupSection(soloProfilesAll);
    tpl.innerHTML = html;
  } else {
    gridEl.classList.remove('grouped-mode');
    const sorted = sortProfileList(currentProfiles);
    tpl.innerHTML = sorted.map(buildProfileCard).join('');
  }

  const newCards = Array.from(tpl.content.children);
  const oldCards = Array.from(gridEl.children);
  const sameLayout = oldCards.length === newCards.length &&
    oldCards.every((el, i) => {
      const oldKey = el.dataset.profileId || el.dataset.groupId || '';
      const newKey = newCards[i].dataset.profileId || newCards[i].dataset.groupId || '';
      return oldKey !== '' && oldKey === newKey;
    });

  if (!sameLayout) {
    gridEl.replaceChildren(...newCards);
    return;
  }
  oldCards.forEach((el, i) => morphNode(el, newCards[i]));
}

function escapeHTML(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

// ==========================================
// BOT & WINDOW ACTIONS (PER-CARD)
// ==========================================
async function toggleBotExecution(id, start, btnEl) {
  try {
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.innerHTML = start ? `<span>⏳</span> กำลังเริ่ม...` : `<span>⏳</span> กำลังหยุด...`;
    }
    const action = start ? "start" : "stop";
    const res = await fetch(`${API_BASE}/api/profiles/${id}/toggle-bot?action=${action}`, { method: "POST" });
    const data = await res.json();
    if (data.success) {
      await fetchProfiles();
    } else {
      const err = String(data.error || "เกิดข้อผิดพลาด");
      alert(/ECONNREFUSED/.test(err)
        ? "❌ จอนี้ยังไม่เชื่อมต่อกับบอท\n\n• ถ้าเพิ่งเปิดจอ รอให้เกมโหลดเสร็จสักครู่แล้วลองใหม่\n• ถ้ายังไม่ได้ ไปที่ปุ่ม \"สคริปต์เกม\" ตรวจว่าโฟลเดอร์เกมถูกต้องแล้วกด \"ติดตั้ง\" จากนั้นปิด-เปิดจอเกมใหม่"
        : "❌ ไม่สามารถสั่งงานบอทได้: " + err);
      await fetchProfiles();
    }
  } catch (err) {
    console.error("toggleBotExecution error:", err);
    await fetchProfiles();
  }
}

// Bring this client's game window to the front
async function focusClientWindow(id, btnEl) {
  if (btnEl) btnEl.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/profiles/${id}/focus-window`, { method: "POST" });
    const data = await res.json();
    if (!data.success) showToast("❌ แสดงจอไม่สำเร็จ: " + (data.error || "เกิดข้อผิดพลาด"), "error");
    fetchProfiles();
  } catch (err) {
    console.error("focusClientWindow error:", err);
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

async function toggleClientWindow(id) {
  try {
    const res = await fetch(`${API_BASE}/api/profiles/${id}/toggle-window`, { method: "POST" });
    const data = await res.json();
    if (data.success) {
      fetchProfiles();
    }
  } catch (err) {
    console.error("toggleClientWindow error:", err);
  }
}

async function launchClient(id) {
  try {
    const res = await fetch(`${API_BASE}/api/profiles/${id}/launch`, { method: "POST" });
    const data = await res.json();
    if (!data.success) {
      alert("❌ เปิดจอไม่สำเร็จ: " + (data.error || "เกิดข้อผิดพลาด"));
    }
  } catch (err) {
    alert("❌ เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์");
  }
  fetchProfiles();
}

async function stopClient(id) {
  if (!confirm("ต้องการปิดจอเกมนี้ใช่หรือไม่?")) return;
  try {
    await fetch(`${API_BASE}/api/profiles/${id}/stop`, { method: "POST" });
  } catch (err) {}
  fetchProfiles();
}

// ==========================================
// TOP ACTION TOOLBAR LISTENERS
// ==========================================
const btnAutoTileShrink = document.getElementById("btn-auto-tile-shrink");
if (btnAutoTileShrink) {
  const autoTileLabel = btnAutoTileShrink.innerText;
  btnAutoTileShrink.onclick = async (e) => {
    e.preventDefault();
    try {
      btnAutoTileShrink.innerText = "⏳ กำลังจัดเรียง...";
      await fetch(`${API_BASE}/api/tile-windows?layout=compact`, { method: "POST" });
    } catch(err) {}
    setTimeout(() => { btnAutoTileShrink.innerText = autoTileLabel; }, 1000);
  };
}

const btnGlobalPlanSetup = document.getElementById("btn-global-plan-setup");
if (btnGlobalPlanSetup) {
  btnGlobalPlanSetup.onclick = () => {
    const online = currentProfiles.find(p => p.isRunning) || currentProfiles[0];
    if (online) {
      openScriptPlanModal(online.id);
    } else {
      alert("กรุณาเพิ่มหรือเปิดโปรไฟล์ก่อนตั้งค่า Plan");
    }
  };
}

const btnToggleAllWindows = document.getElementById("btn-toggle-all-windows");
if (btnToggleAllWindows) {
  btnToggleAllWindows.onclick = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/toggle-all-windows`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        allWindowsHidden = !!data.allWindowsHidden;
        const lbl = document.getElementById("lbl-toggle-all-windows");
        if (lbl) lbl.innerText = allWindowsHidden ? "แสดงกราฟิกทุกจอ" : "พักกราฟิกทุกจอ (Zero-Render)";
        fetchProfiles();
      }
    } catch(e) {
      console.error(e);
    }
  };
}

document.getElementById("btn-launch-all").onclick = async () => {
  if (confirm("ยืนยันเปิดจอเกมทั้งหมดพร้อมกัน?")) {
    try {
      const res = await fetch(`${API_BASE}/api/launch-all`, { method: "POST" });
      const data = await res.json();
      if (!data.success) alert("❌ เปิดจอไม่สำเร็จ: " + (data.error || "เกิดข้อผิดพลาด"));
      else showToast(`🚀 เปิดใหม่ ${(data.launched || []).length} จอ${(data.skipped || []).length ? ` · ข้าม ${data.skipped.length} จอที่เปิดอยู่แล้ว` : ""}`, "success");
    } catch (e) {}
    fetchProfiles();
  }
};

// Small notice in the corner (same look as the bag window's toasts)
function showToast(text, kind = "success") {
  let host = document.getElementById("im-toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "im-toast-host";
    document.body.appendChild(host);
  }
  const t = document.createElement("div");
  t.className = `im-toast ${kind === "error" ? "err" : kind === "warning" ? "warn" : "ok"}`;
  t.textContent = text;
  host.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, 3200);
}

// START / STOP BOT on every online client at once
async function setBotOnAllClients(start, btn) {
  const online = currentProfiles.filter(p => p.isRunning);
  if (!online.length) return showToast("ยังไม่มีจอที่ออนไลน์", "warning");
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="icon">⏳</span> ${start ? "กำลังเริ่มบอท..." : "กำลังหยุดบอท..."}`;
  const results = await Promise.all(online.map(p =>
    fetch(`${API_BASE}/api/profiles/${p.id}/toggle-bot?action=${start ? "start" : "stop"}`, { method: "POST" })
      .then(r => r.json()).catch(e => ({ success: false, error: e.message }))
  ));
  btn.disabled = false;
  btn.innerHTML = label;
  const failed = online.filter((p, i) => !results[i].success).map(p => p.name);
  showToast(`${start ? "▶️ START" : "⏹️ STOP"} BOT สำเร็จ ${online.length - failed.length}/${online.length} จอ${failed.length ? " — ไม่สำเร็จ: " + failed.join(", ") : ""}`, failed.length ? "warning" : "success");
  fetchProfiles();
}
// ⚖️ เช็คน้ำหนัก: list max weight of every plan client, then (after confirming) let the ones below 7,000
// buy + use the missing Weight Limit Scrolls (+500 each, ~5,000 z each)
const WEIGHT_TARGET = 7000, WEIGHT_SCROLL_PRICE = 5000;
async function runWeightCheck(btn) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="icon">⏳</span> กำลังเช็ค...';
  try {
    const data = await fetch(`${API_BASE}/api/weight-check?apply=0&target=${WEIGHT_TARGET}`, { method: "POST" }).then(r => r.json());
    if (!data.success) return showToast("❌ เช็คน้ำหนักไม่สำเร็จ: " + (data.error || ""), "error");
    const rows = data.results.filter(r => !r.offline);
    if (!rows.length) return showToast("ยังไม่มีจอที่ออนไลน์", "warning");
    const lines = [], toFix = [];
    let total = 0;
    for (const r of rows) {
      if (r.skip === "no-plan") { lines.push(`➖ ${r.name}: ไม่ได้ใช้ Plan — ข้าม`); continue; }
      if (r.error) { lines.push(`⚠️ ${r.name}: ${r.error}`); continue; }
      const lim = `${r.limit.toLocaleString()} / ${WEIGHT_TARGET.toLocaleString()}`;
      const extra = r.scrolls ? ` · มี Scroll เหลือในกระเป๋า ${r.scrolls} อัน (ใช้ไม่ได้แล้ว ขาย NPC ได้)` : "";
      if (!r.need && r.used === 10 && r.limit < WEIGHT_TARGET) { lines.push(`🔒 ${r.name}: ${lim} — ใช้ Scroll ครบ 10 ครั้งแล้ว เพิ่มอีกไม่ได้${extra}`); continue; }
      if (!r.need) { lines.push(`✅ ${r.name}: ${lim} ครบแล้ว${r.used === 10 && r.scrolls ? extra : ""}`); continue; }
      if (!r.supported) { lines.push(`⚠️ ${r.name}: ${lim} — บอทในจอนี้ยังเป็นเวอร์ชันเก่า (รอ Auto-update / รีเฟรชจอ)`); continue; }
      const buy = Math.max(0, r.need - (r.scrolls || 0));
      const cost = buy * WEIGHT_SCROLL_PRICE;
      total += r.need;
      toFix.push(r.id);
      let note = `ต้องใช้อีก ${r.need} อัน`;
      if (r.scrolls) note += ` (มีในกระเป๋า ${r.scrolls})`;
      if (buy) note += ` ซื้อ ${buy} อัน ≈ ${cost.toLocaleString()} z${r.zeny < cost ? ` ⚠️ เงินมี ${r.zeny.toLocaleString()} z (ซื้อเท่าที่พอ แล้วรอเงิน)` : ""}`;
      if (!r.bot) note += " ⏸️ บอทยังไม่ START (จะไปซื้อเมื่อกด START BOT)";
      if (r.pending) note += " — กำลังดำเนินการอยู่แล้ว";
      lines.push(`📦 ${r.name}: ${lim} — ${note}`);
    }
    if (!toFix.length) return alert(`⚖️ เช็คน้ำหนัก (เป้า ${WEIGHT_TARGET.toLocaleString()})\n\n` + lines.join("\n") + "\n\nไม่มีจอที่ต้องซื้อเพิ่ม");
    if (!confirm(`⚖️ เช็คน้ำหนัก (เป้า ${WEIGHT_TARGET.toLocaleString()})\n\n` + lines.join("\n") + `\n\nกด OK ให้ ${toFix.length} จอไปซื้อและใช้ Weight Limit Scroll ให้ครบ (รวม ${total} อัน)`)) return;
    const res = await fetch(`${API_BASE}/api/weight-check?apply=1&target=${WEIGHT_TARGET}&ids=${encodeURIComponent(toFix.join(","))}`, { method: "POST" }).then(r => r.json());
    const ok = (res.results || []).filter(r => r.requested).length;
    showToast(`⚖️ สั่งเติมน้ำหนักแล้ว ${ok}/${toFix.length} จอ`, ok === toFix.length ? "success" : "warning");
  } catch (e) {
    showToast("❌ เช็คน้ำหนักไม่สำเร็จ: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = label;
  }
}
document.getElementById("btn-weight-check").onclick = e => runWeightCheck(e.currentTarget);

function updateAutoAnswerToolbarBtn(isAuto) {
  const btn = document.getElementById("btn-toggle-auto-answer");
  const lbl = document.getElementById("lbl-toggle-auto-answer");
  if (!btn) return;
  if (isAuto) {
    if (lbl) lbl.textContent = "Auto ตอบ: เปิด";
    btn.style.borderColor = "rgba(16, 185, 129, 0.4)";
    btn.style.background = "rgba(16, 185, 129, 0.12)";
    btn.style.color = "#34d399";
    btn.title = "เปิดใช้งาน Auto ตอบคำถามเช็คผู้เล่นอยู่ — คลิกเพื่อปิด";
  } else {
    if (lbl) lbl.textContent = "Auto ตอบ: ปิด";
    btn.style.borderColor = "rgba(239, 68, 68, 0.4)";
    btn.style.background = "rgba(239, 68, 68, 0.12)";
    btn.style.color = "#f87171";
    btn.title = "ปิด Auto ตอบคำถามเช็คผู้เล่นอยู่ — คลิกเพื่อเปิด";
  }
}
window.updateAutoAnswerToolbarBtn = updateAutoAnswerToolbarBtn;

const btnToggleAutoAnswer = document.getElementById("btn-toggle-auto-answer");
if (btnToggleAutoAnswer) {
  btnToggleAutoAnswer.onclick = async () => {
    btnToggleAutoAnswer.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/human-check/toggle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(r => r.json());
      if (res && res.success) {
        updateAutoAnswerToolbarBtn(res.autoAnswer);
        showToast(res.autoAnswer ? "🤖 เปิด Auto ตอบคำถามเช็คผู้เล่นแล้ว" : "⏸️ ปิด Auto ตอบคำถามเช็คผู้เล่นแล้ว", res.autoAnswer ? "success" : "warning");
        const hcGlobal = document.getElementById("hc-global-auto-answer");
        if (hcGlobal) hcGlobal.checked = res.autoAnswer;
        const discAuto = document.getElementById("discord-auto-answer");
        if (discAuto) discAuto.checked = res.autoAnswer;
      } else {
        showToast("❌ เปลี่ยนสถานะไม่สำเร็จ: " + (res.error || "Unknown"), "error");
      }
    } catch (e) {
      showToast("❌ เกิดข้อผิดพลาด: " + e.message, "error");
    } finally {
      btnToggleAutoAnswer.disabled = false;
    }
  };
}

// ==========================================
// PROXY AUTO-REGISTER MODAL & TOGGLE CONTROLLER
// ==========================================
let currentProxyRegisterEnabled = false;

function updateProxyRegisterToolbarBtn(enabled) {
  currentProxyRegisterEnabled = !!enabled;
  const btn = document.getElementById("btn-toggle-proxy-register");
  const lbl = document.getElementById("lbl-toggle-proxy-register");
  if (!btn) return;
  if (enabled) {
    if (lbl) lbl.textContent = "Proxy สมัคร: เปิด";
    btn.style.borderColor = "rgba(14, 165, 233, 0.5)";
    btn.style.background = "rgba(14, 165, 233, 0.15)";
    btn.style.color = "#38bdf8";
    btn.title = "ระบบ Proxy สมัครไอดีเปิดใช้งานอยู่ (0.1 ส่วนบุญ/ไอดี) — คลิกเพื่อดูเงื่อนไขหรือปิด";
  } else {
    if (lbl) lbl.textContent = "Proxy สมัคร: ปิด";
    btn.style.borderColor = "rgba(148, 163, 184, 0.3)";
    btn.style.background = "rgba(148, 163, 184, 0.08)";
    btn.style.color = "#94a3b8";
    btn.title = "ระบบ Proxy สมัครไอดีปิดอยู่ — คลิกเพื่อดูเงื่อนไขและเปิดใช้งาน";
  }
}
window.updateProxyRegisterToolbarBtn = updateProxyRegisterToolbarBtn;

function openProxyRegisterModal() {
  const modal = document.getElementById("modal-proxy-register-confirm");
  if (!modal) return;
  modal.style.display = "flex";

  const badge = document.getElementById("proxy-modal-status-badge");
  const confirmBtn = document.getElementById("btn-proxy-modal-confirm");
  if (badge) {
    if (currentProxyRegisterEnabled) {
      badge.textContent = "สถานะ: เปิดใช้งาน";
      badge.style.background = "rgba(16, 185, 129, 0.2)";
      badge.style.color = "#34d399";
      badge.style.borderColor = "rgba(16, 185, 129, 0.4)";
    } else {
      badge.textContent = "สถานะ: ปิด";
      badge.style.background = "rgba(148, 163, 184, 0.15)";
      badge.style.color = "#94a3b8";
      badge.style.borderColor = "rgba(148, 163, 184, 0.3)";
    }
  }
  if (confirmBtn) {
    if (currentProxyRegisterEnabled) {
      confirmBtn.textContent = "⏸️ ปิดใช้งาน Proxy";
      confirmBtn.style.background = "rgba(239, 68, 68, 0.8)";
      confirmBtn.style.borderColor = "rgba(239, 68, 68, 0.5)";
    } else {
      confirmBtn.textContent = "✅ ยอมรับเงื่อนไขและเปิดใช้งาน";
      confirmBtn.style.background = "#0284c7";
      confirmBtn.style.borderColor = "#38bdf8";
    }
  }

  fetchProxyRegisterSettings();
}

function closeProxyRegisterModal() {
  const modal = document.getElementById("modal-proxy-register-confirm");
  if (modal) modal.style.display = "none";
}

function proxyQuotaFromSettings(settings) {
  if(settings?.unitScale!==100||!Number.isSafeInteger(settings.balanceUnits))return null;
  return Math.max(0,Math.floor(settings.balanceUnits/10));
}
function applyProxyConnectionSettings(settings) {
  const isBroker = settings.mode === 'owner-broker';
  const brokerRadio = document.getElementById('proxy-mode-broker');
  const localRadio = document.getElementById('proxy-mode-local');
  if (brokerRadio) brokerRadio.checked = isBroker;
  if (localRadio) localRadio.checked = !isBroker;

  const brokerSection = document.getElementById('proxy-broker-info-section');
  const localSection = document.getElementById('proxy-local-config-section');
  if (brokerSection) brokerSection.style.display = isBroker ? 'block' : 'none';
  if (localSection) localSection.style.display = isBroker ? 'none' : 'block';
  const fields={'proxy-config-host':settings.proxyHost||'','proxy-config-port':settings.proxyPort||'','proxy-config-country':settings.country||'th'};
  for(const [id,value]of Object.entries(fields)){const input=document.getElementById(id);if(input&&document.activeElement!==input)input.value=value;}
  const note=document.getElementById('proxy-config-note');
  if(note)note.textContent=settings.configured?'ใช้ข้อมูลรับรองที่เก็บในเครื่องได้ กรอกใหม่เฉพาะเมื่อต้องการเปลี่ยน':'กรอกข้อมูลรับรอง Proxy ที่ต้องการใช้ในเครื่องนี้';
  const confirm=document.getElementById('btn-proxy-modal-confirm');if(confirm)confirm.disabled = isBroker ? false : (!settings.enabled && !settings.configured);
}
async function saveProxyConnectionSettings(){
  const value=id=>(document.getElementById(id)?.value||'').trim(),user=value('proxy-config-user'),password=document.getElementById('proxy-config-pass')?.value||'';
  const body={mode:'local',proxyHost:value('proxy-config-host'),proxyPort:Number(value('proxy-config-port')),country:value('proxy-config-country').toLowerCase(),enabled:false};
  if(!body.proxyHost||!Number.isInteger(body.proxyPort)||body.proxyPort<1||body.proxyPort>65535||!/^[a-z]{2}$/.test(body.country))return showToast('กรอก Host, Port และรหัสประเทศสองตัวให้ถูกต้อง','error');
  if(!!user!==!!password)return showToast('กรอกชื่อผู้ใช้ Proxy และรหัสผ่านใหม่ทั้งคู่ หรือเว้นทั้งคู่เพื่อคงค่าเดิม','error');
  if(user){body.proxyUser=user;body.proxyPass=password;}
  try{const response=await fetch(`${API_BASE}/api/proxy-register/settings`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await response.json();if(!response.ok||data.success!==true)throw Error(data.error||'ยังบันทึกค่า Proxy ไม่ได้');
    document.getElementById('proxy-config-user').value='';document.getElementById('proxy-config-pass').value='';applyProxyConnectionSettings(data.settings);updateProxyRegisterToolbarBtn(data.settings.enabled);showToast('บันทึกไว้ในเครื่องแล้ว Proxy ยังปิดอยู่ สามารถเปิดใช้งานเมื่อพร้อม','success');
  }catch(error){showToast(error.message,'error');}
}
async function fetchProxyRegisterSettings() {
  try {
    const [proxyRes, hcRes] = await Promise.all([
      fetch(`${API_BASE}/api/proxy-register/settings`).then(r => r.json()).catch(() => null),
      fetch(`${API_BASE}/api/human-check/settings`).then(r => r.json()).catch(() => null)
    ]);
    if (proxyRes && proxyRes.success && proxyRes.settings) {
      let s = proxyRes.settings;
      if (s.mode === 'local' && !s.configured && !s.hasCredentials) {
        try {
          const autoRes = await fetch(`${API_BASE}/api/proxy-register/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'owner-broker' })
          }).then(r => r.json());
          if (autoRes && autoRes.success && autoRes.settings) s = autoRes.settings;
        } catch (_) {}
      }
      applyProxyConnectionSettings(s);
      updateProxyRegisterToolbarBtn(s.enabled);
      const regCountEl = document.getElementById("proxy-modal-reg-count");
      if (regCountEl) regCountEl.textContent = (s.registeredCount || 0) + " ไอดี";
      const lastIpEl = document.getElementById("proxy-modal-last-ip");
      if (lastIpEl) lastIpEl.textContent = s.lastTestedIp || "-";
    }
    const settings=hcRes?.success?hcRes.settings:null,quota=proxyQuotaFromSettings(settings);
    const balEl=document.getElementById('proxy-modal-balance-display'),quotaEl=document.getElementById('proxy-modal-quota-calc');
    if(balEl)balEl.textContent=quota===null?'—':(settings.balanceUnits/100).toLocaleString('th-TH',{minimumFractionDigits:1,maximumFractionDigits:2})+' ส่วนบุญ';
    if(quotaEl)quotaEl.textContent=quota===null?'—':(quota>0?quota.toLocaleString():'คิดตามรอบบิล (0.1/ไอดี)');
  } catch (_) {}
}

function initProxyRegisterControls() {
  const modeBroker = document.getElementById('proxy-mode-broker');
  const modeLocal = document.getElementById('proxy-mode-local');
  if (modeBroker) {
    modeBroker.addEventListener('change', async () => {
      if (modeBroker.checked) {
        try {
          const res = await fetch(`${API_BASE}/api/proxy-register/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'owner-broker' })
          }).then(r => r.json());
          if (res && res.success) {
            applyProxyConnectionSettings(res.settings);
            showToast('สลับเป็นโหมด Proxy กลางของระบบแล้ว (ไม่ต้องกรอกข้อมูล)', 'success');
          }
        } catch (e) {
          showToast('ไม่สามารถสลับโหมดได้: ' + e.message, 'error');
        }
      }
    });
  }
  if (modeLocal) {
    modeLocal.addEventListener('change', async () => {
      if (modeLocal.checked) {
        try {
          const res = await fetch(`${API_BASE}/api/proxy-register/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'local' })
          }).then(r => r.json());
          if (res && res.success) {
            applyProxyConnectionSettings(res.settings);
            showToast('สลับเป็นโหมดกำหนด Proxy ในเครื่องแล้ว', 'info');
          }
        } catch (e) {
          showToast('ไม่สามารถสลับโหมดได้: ' + e.message, 'error');
        }
      }
    });
  }
  const saveConfig=document.getElementById('btn-proxy-config-save');if(saveConfig)saveConfig.onclick=saveProxyConnectionSettings;
  const btnToolbar = document.getElementById("btn-toggle-proxy-register");
  if (btnToolbar) {
    btnToolbar.onclick = () => {
      openProxyRegisterModal();
    };
  }

  const btnClose = document.getElementById("btn-proxy-register-close");
  if (btnClose) btnClose.onclick = closeProxyRegisterModal;
  const btnCancel = document.getElementById("btn-proxy-modal-cancel");
  if (btnCancel) btnCancel.onclick = closeProxyRegisterModal;

  const btnConfirm = document.getElementById("btn-proxy-modal-confirm");
  if (btnConfirm) {
    btnConfirm.onclick = async () => {
      btnConfirm.disabled = true;
      try {
        const nextState = !currentProxyRegisterEnabled;
        const res = await fetch(`${API_BASE}/api/proxy-register/toggle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: nextState })
        }).then(r => r.json());
        if (res && res.success) {
          updateProxyRegisterToolbarBtn(res.enabled);
          showToast(res.enabled ? "🌐 เปิดใช้งานระบบ Proxy สำหรับสมัครไอดีแล้ว (0.1 ส่วนบุญ/ไอดี)" : "⏸️ ปิดใช้งานระบบ Proxy แล้ว", res.enabled ? "success" : "info");
          closeProxyRegisterModal();
        } else {
          showToast("❌ เปลี่ยนสถานะไม่สำเร็จ: " + (res.error || "Unknown"), "error");
        }
      } catch (e) {
        showToast("❌ เกิดข้อผิดพลาด: " + e.message, "error");
      } finally {
        btnConfirm.disabled = false;
      }
    };
  }

  const btnTest = document.getElementById("btn-proxy-test-conn");
  const testStatus = document.getElementById("proxy-test-status");
  if (btnTest) {
    btnTest.onclick = async () => {
      btnTest.disabled = true;
      if (testStatus) {
        testStatus.textContent = "⏳ กำลังเชื่อมต่อ Proxy และตรวจสอบสถานะ IP ผ่าน Cloudflare...";
        testStatus.style.color = "#38bdf8";
      }
      try {
        const res = await fetch(`${API_BASE}/api/proxy-register/test`, { method: "POST" }).then(r => r.json());
        if (res && res.success) {
          const cf = res.cloudflareStatus;
          const slots = cf?.availableSlots != null ? cf.availableSlots : 3;
          if (testStatus) {
            testStatus.textContent = `✅ เชื่อมต่อสำเร็จ! Egress IP: ${res.ip} (โควต้าชม.นี้: ว่าง ${slots}/3 ช่อง)`;
            testStatus.style.color = "#34d399";
          }
          const lastIpEl = document.getElementById("proxy-modal-last-ip");
          if (lastIpEl) lastIpEl.textContent = res.ip;
          showToast(`✅ เชื่อมต่อ Proxy สำเร็จ (IP: ${res.ip})`, "success");
        } else {
          if (testStatus) {
            testStatus.textContent = `❌ เชื่อมต่อไม่สำเร็จ: ${res.error || "Unknown"}`;
            testStatus.style.color = "#f87171";
          }
          showToast(`❌ ทดสอบไม่สำเร็จ: ${res.error || "Unknown"}`, "error");
        }
      } catch (e) {
        if (testStatus) {
          testStatus.textContent = `❌ เกิดข้อผิดพลาด: ${e.message}`;
          testStatus.style.color = "#f87171";
        }
      } finally {
        btnTest.disabled = false;
      }
    };
  }

  fetchProxyRegisterSettings();
}

// ==========================================
// PER-SCREEN IP QUEUE (1 IP : 3 SCREENS) MODAL & TOGGLE CONTROLLER
// ==========================================
let currentScreenProxySettings = {
  enabled: false,
  mode: "owner-queue",
  maxScreensPerIp: 3,
  onlyGameTraffic: true,
  localAssetCache: true,
  poolCount: 0,
  totalSlots: 0,
  activeLeaseCount: 0,
  freeSlots: 0
};

function formatProxyBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return "0 B";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function updateScreenProxyToolbarBtn(summary) {
  if (summary && typeof summary === "object") {
    currentScreenProxySettings = { ...currentScreenProxySettings, ...summary };
  }
  const enabled = !!currentScreenProxySettings.enabled;
  const maxS = Number(currentScreenProxySettings.maxScreensPerIp) || 3;
  const activeCount = Number(currentScreenProxySettings.activeLeaseCount) || 0;
  const poolCount = Number(currentScreenProxySettings.poolCount) || 0;

  const btn = document.getElementById("btn-toggle-screen-proxy");
  const lbl = document.getElementById("lbl-toggle-screen-proxy");
  if (!btn) return;

  if (enabled) {
    if (lbl) {
      lbl.textContent = poolCount > 0
        ? `แยก IP (1:${maxS}): เปิด (${activeCount}/${poolCount * maxS})`
        : `แยก IP (1:${maxS}): เปิด`;
    }
    btn.style.borderColor = "rgba(168, 85, 247, 0.55)";
    btn.style.background = "rgba(168, 85, 247, 0.18)";
    btn.style.color = "#e9d5ff";
    btn.title = `ระบบแยก IP รายจอเปิดใช้งานอยู่ (1 IP ต่อ ${maxS} จอ · จับคู่แล้ว ${activeCount} จอ จาก ${poolCount} IP) — คลิกเพื่อตั้งค่าหรือเปิด/ปิด`;
  } else {
    if (lbl) lbl.textContent = `แยก IP (1:${maxS}): ปิด`;
    btn.style.borderColor = "rgba(148, 163, 184, 0.3)";
    btn.style.background = "rgba(148, 163, 184, 0.08)";
    btn.style.color = "#94a3b8";
    btn.title = `ระบบแยก IP รายจอ (1 IP ต่อ ${maxS} จอ) ปิดอยู่ — คลิกเพื่อตั้งค่ารายการ IP หรือเปิดใช้งาน`;
  }
}
window.updateScreenProxyToolbarBtn = updateScreenProxyToolbarBtn;

function renderScreenProxyModal(statusData) {
  if (!statusData) return;
  if (statusData.settings) {
    updateScreenProxyToolbarBtn(statusData.settings);
  }
  const s = currentScreenProxySettings;
  const enabled = !!s.enabled;
  const maxS = Number(s.maxScreensPerIp) || 3;

  const badge = document.getElementById("screen-proxy-status-badge");
  if (badge) {
    if (enabled) {
      badge.textContent = "สถานะ: เปิดใช้งาน";
      badge.style.background = "rgba(16, 185, 129, 0.2)";
      badge.style.color = "#34d399";
      badge.style.borderColor = "rgba(16, 185, 129, 0.45)";
    } else {
      badge.textContent = "สถานะ: ปิด";
      badge.style.background = "rgba(148, 163, 184, 0.15)";
      badge.style.color = "#94a3b8";
      badge.style.borderColor = "rgba(148, 163, 184, 0.3)";
    }
  }

  const toggleBtn = document.getElementById("btn-screen-proxy-toggle-main");
  if (toggleBtn) {
    if (enabled) {
      toggleBtn.textContent = "⏸️ ปิดใช้งานระบบแยก IP";
      toggleBtn.style.background = "rgba(239, 68, 68, 0.85)";
      toggleBtn.style.borderColor = "rgba(239, 68, 68, 0.55)";
    } else {
      toggleBtn.textContent = `✅ เปิดใช้งานแยก IP (1:${maxS})`;
      toggleBtn.style.background = "#7c3aed";
      toggleBtn.style.borderColor = "#a855f7";
    }
  }

  const poolCountEl = document.getElementById("sp-stat-pool-count");
  const totalSlotsEl = document.getElementById("sp-stat-total-slots");
  const activeLeasesEl = document.getElementById("sp-stat-active-leases");
  const freeSlotsEl = document.getElementById("sp-stat-free-slots");
  if (poolCountEl) poolCountEl.textContent = `${s.poolCount || 0} IP`;
  if (totalSlotsEl) totalSlotsEl.textContent = `${s.totalSlots || 0} จอ`;
  if (activeLeasesEl) activeLeasesEl.textContent = `${s.activeLeaseCount || 0} จอ`;
  if (freeSlotsEl) freeSlotsEl.textContent = `${s.freeSlots || 0} ช่อง`;

  const modeOwner = document.getElementById("sp-mode-owner");
  const modeLocal = document.getElementById("sp-mode-local");
  if (modeOwner) modeOwner.checked = s.mode !== "local-pool";
  if (modeLocal) modeLocal.checked = s.mode === "local-pool";

  const maxInput = document.getElementById("sp-max-screens");
  if (maxInput && document.activeElement !== maxInput) {
    maxInput.value = String(maxS);
  }

  const onlyGameChk = document.getElementById("sp-only-game-traffic");
  if (onlyGameChk) {
    onlyGameChk.checked = s.onlyGameTraffic !== false;
  }

  const localCacheChk = document.getElementById("sp-local-asset-cache");
  if (localCacheChk) {
    localCacheChk.checked = s.localAssetCache !== false;
  }

  const tr = statusData.traffic || {};
  const ac = statusData.assetCache || tr.assetCache || {};
  const proxyTrafficEl = document.getElementById("sp-stat-proxy-traffic");
  const proxyTrafficSubEl = document.getElementById("sp-stat-proxy-traffic-sub");
  const cacheSavedEl = document.getElementById("sp-stat-cache-saved");
  const cacheSavedSubEl = document.getElementById("sp-stat-cache-saved-sub");
  const cacheFilesEl = document.getElementById("sp-stat-cache-files");
  const cacheFilesSubEl = document.getElementById("sp-stat-cache-files-sub");
  if (proxyTrafficEl) {
    proxyTrafficEl.textContent = formatProxyBytes(tr.proxyTotalBytes || 0);
  }
  if (proxyTrafficSubEl) {
    const rateNote = tr.proxyBytesPerHour > 0 ? ` · ~${formatProxyBytes(tr.proxyBytesPerHour)}/ชม.` : "";
    proxyTrafficSubEl.textContent = `↓${formatProxyBytes(tr.proxyRxBytes || 0)} / ↑${formatProxyBytes(tr.proxyTxBytes || 0)}${rateNote}`;
  }
  if (cacheSavedEl) {
    cacheSavedEl.textContent = formatProxyBytes(ac.bytesSaved || 0);
  }
  if (cacheSavedSubEl) {
    cacheSavedSubEl.textContent = `Hit ${(Number(ac.hits) || 0).toLocaleString()} ครั้ง (ดึงใหม่ ${(Number(ac.misses) || 0).toLocaleString()})`;
  }
  if (cacheFilesEl) {
    cacheFilesEl.textContent = `${(Number(ac.filesCount) || 0).toLocaleString()} ไฟล์`;
  }
  if (cacheFilesSubEl) {
    cacheFilesSubEl.textContent = `ขนาดรวม ${formatProxyBytes(ac.diskBytes || 0)}`;
  }

  const poolTextarea = document.getElementById("sp-pool-textarea");
  if (poolTextarea && document.activeElement !== poolTextarea && typeof s.poolText === "string") {
    poolTextarea.value = s.poolText;
  }

  const leasesListEl = document.getElementById("sp-leases-list");
  if (leasesListEl) {
    const leases = Array.isArray(statusData.leases) ? statusData.leases : [];
    if (leases.length === 0) {
      leasesListEl.innerHTML = `<div style="text-align: center; color: #64748b; padding: 14px;">ยังไม่มีจอที่จับคู่ IP ในขณะนี้ (เมื่อเปิดใช้งานและเปิดจอเกม ระบบจะจับคู่ให้อัตโนมัติ)</div>`;
    } else {
      const profById = new Map(currentProfiles.map(p => [p.id, p]));
      leasesListEl.innerHTML = leases.map(l => {
        const prof = profById.get(l.profileId);
        const pName = prof ? prof.name : l.profileId;
        const isOnline = prof ? !!prof.isRunning : false;
        const pTraffic = (tr.byProfile && tr.byProfile[l.profileId]) ? tr.byProfile[l.profileId].proxyTotalBytes : 0;
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(2, 6, 23, 0.55); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 6px 10px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="width: 8px; height: 8px; border-radius: 50%; background: ${isOnline ? '#34d399' : '#64748b'}; display: inline-block;"></span>
              <strong style="color: #f8fafc;">${escapeHTML(pName)}</strong>
              <span style="color: #64748b; font-size: 10.5px;">(${escapeHTML(l.profileId)})</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-family: 'JetBrains Mono', Consolas, monospace; color: #38bdf8; font-weight: 600;">${escapeHTML(l.proxyHost)}:${escapeHTML(String(l.proxyPort || ''))}</span>
              <span style="background: rgba(168, 85, 247, 0.2); color: #e9d5ff; border: 1px solid rgba(168, 85, 247, 0.4); border-radius: 99px; padding: 1px 8px; font-size: 10.5px; font-weight: 700;">
                ช่อง ${l.slotIndex || 1}/${l.maxScreensPerIp || maxS}
              </span>
              ${pTraffic > 0 ? `<span style="color: #7dd3fc; font-size: 10px; font-family: monospace;" title="เน็ตที่วิ่งผ่าน Proxy ของจอนี้">${formatProxyBytes(pTraffic)}</span>` : ''}
              ${l.tunnelPort ? `<span style="color: #10b981; font-size: 10px;" title="Local Forwarder Port">127.0.0.1:${l.tunnelPort}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

async function fetchScreenProxyStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/screen-proxy/status`).then(r => r.json());
    if (res && res.success) {
      renderScreenProxyModal(res);
    }
  } catch (_) {}
}

function openScreenProxyModal() {
  const modal = document.getElementById("modal-screen-proxy-settings");
  if (!modal) return;
  modal.style.display = "flex";
  fetchScreenProxyStatus();
}
window.openScreenProxyModal = openScreenProxyModal;

function closeScreenProxyModal() {
  const modal = document.getElementById("modal-screen-proxy-settings");
  if (modal) modal.style.display = "none";
}
window.closeScreenProxyModal = closeScreenProxyModal;

async function saveScreenProxySettings(showToastFeedback = true) {
  const modeOwner = document.getElementById("sp-mode-owner");
  const mode = (modeOwner && modeOwner.checked) ? "owner-queue" : "local-pool";
  const maxScreensPerIp = Math.max(1, Math.min(10, Number(document.getElementById("sp-max-screens")?.value) || 3));
  const onlyGameTraffic = document.getElementById("sp-only-game-traffic")?.checked !== false;
  const localAssetCache = document.getElementById("sp-local-asset-cache")?.checked !== false;
  const poolText = document.getElementById("sp-pool-textarea")?.value || "";

  const btnSave = document.getElementById("btn-sp-save-pool");
  if (btnSave) btnSave.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/screen-proxy/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, maxScreensPerIp, onlyGameTraffic, localAssetCache, poolText })
    }).then(r => r.json());
    if (res && res.success) {
      await fetchScreenProxyStatus();
      if (showToastFeedback) {
        const pCount = res.settings?.poolCount || 0;
        showToast(`💾 บันทึกรายการ IP สำเร็จ (${pCount} IP = รองรับสูงสุด ${pCount * maxScreensPerIp} จอ)`, "success");
      }
      return res;
    } else {
      if (showToastFeedback) showToast("❌ บันทึกไม่สำเร็จ: " + (res?.error || "Unknown"), "error");
      return null;
    }
  } catch (e) {
    if (showToastFeedback) showToast("❌ เกิดข้อผิดพลาด: " + e.message, "error");
    return null;
  } finally {
    if (btnSave) btnSave.disabled = false;
  }
}

function initScreenProxyControls() {
  const btnToolbar = document.getElementById("btn-toggle-screen-proxy");
  if (btnToolbar) {
    btnToolbar.onclick = () => openScreenProxyModal();
  }

  const btnClose = document.getElementById("btn-screen-proxy-close");
  if (btnClose) btnClose.onclick = closeScreenProxyModal;
  const btnCancel = document.getElementById("btn-screen-proxy-cancel");
  if (btnCancel) btnCancel.onclick = closeScreenProxyModal;

  const modal = document.getElementById("modal-screen-proxy-settings");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeScreenProxyModal();
    });
  }

  const btnSave = document.getElementById("btn-sp-save-pool");
  if (btnSave) {
    btnSave.onclick = () => saveScreenProxySettings(true);
  }

  const localCacheChk = document.getElementById("sp-local-asset-cache");
  if (localCacheChk) {
    localCacheChk.onchange = async () => {
      const enabled = localCacheChk.checked;
      const res = await saveScreenProxySettings(false);
      if (res && res.success) {
        showToast(
          enabled
            ? "📦 เปิด Local Asset Cache แล้ว — โหลด .png/.webp/.mp3/.woff2 จากเครื่องโดยไม่เปลืองเน็ต Proxy"
            : "⏸️ ปิด Local Asset Cache แล้ว",
          enabled ? "success" : "info"
        );
      }
    };
  }

  const btnResetTraffic = document.getElementById("btn-sp-reset-traffic");
  if (btnResetTraffic) {
    btnResetTraffic.onclick = async () => {
      btnResetTraffic.disabled = true;
      try {
        const res = await fetch(`${API_BASE}/api/screen-proxy/reset-traffic`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        }).then(r => r.json());
        if (res && res.success) {
          renderScreenProxyModal(res);
          fetchProfiles();
          showToast("🔄 รีเซ็ตตัวนับเน็ต Proxy และตัวนับเน็ตวันนี้เรียบร้อยแล้ว", "success");
        }
      } catch (e) {
        showToast("❌ รีเซ็ตไม่สำเร็จ: " + e.message, "error");
      } finally {
        btnResetTraffic.disabled = false;
      }
    };
  }

  const btnToggleMain = document.getElementById("btn-screen-proxy-toggle-main");
  if (btnToggleMain) {
    btnToggleMain.onclick = async () => {
      btnToggleMain.disabled = true;
      try {
        // Save any unsaved IP pool edits first before toggling
        await saveScreenProxySettings(false);
        const nextEnabled = !currentScreenProxySettings.enabled;
        const res = await fetch(`${API_BASE}/api/screen-proxy/toggle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: nextEnabled, applyToOpenWindows: true })
        }).then(r => r.json());
        if (res && res.success) {
          await fetchScreenProxyStatus();
          fetchProfiles();
          showToast(
            res.enabled
              ? `🛡️ เปิดใช้งานระบบแยก IP รายจอ (1 IP ต่อ ${res.settings?.maxScreensPerIp || 3} จอ) แล้ว`
              : "⏸️ ปิดระบบแยก IP รายจอแล้ว (สลับกลับไปใช้เน็ตปกติ)",
            res.enabled ? "success" : "info"
          );
        } else {
          showToast("❌ เปลี่ยนสถานะไม่สำเร็จ: " + (res?.error || "Unknown"), "error");
        }
      } catch (e) {
        showToast("❌ เกิดข้อผิดพลาด: " + e.message, "error");
      } finally {
        btnToggleMain.disabled = false;
      }
    };
  }

  const btnApplyOpen = document.getElementById("btn-sp-apply-open");
  if (btnApplyOpen) {
    btnApplyOpen.onclick = async () => {
      btnApplyOpen.disabled = true;
      try {
        await saveScreenProxySettings(false);
        const res = await fetch(`${API_BASE}/api/screen-proxy/apply-open`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        }).then(r => r.json());
        if (res && res.success) {
          await fetchScreenProxyStatus();
          fetchProfiles();
          const count = Array.isArray(res.switched) ? res.switched.filter(x => x.ok).length : 0;
          showToast(`🔄 จัดคิวและสลับ IP ให้จอที่เปิดอยู่สำเร็จ (${count} จอ)`, "success");
        } else {
          showToast("❌ สลับ IP ไม่สำเร็จ: " + (res?.error || "Unknown"), "error");
        }
      } catch (e) {
        showToast("❌ เกิดข้อผิดพลาด: " + e.message, "error");
      } finally {
        btnApplyOpen.disabled = false;
      }
    };
  }

  const btnTest = document.getElementById("btn-sp-test-conn");
  const statusMsg = document.getElementById("sp-test-status-msg");
  if (btnTest) {
    btnTest.onclick = async () => {
      btnTest.disabled = true;
      if (statusMsg) {
        statusMsg.textContent = "⏳ กำลังบันทึกและทดสอบการเชื่อมต่อผ่าน Proxy IP...";
        statusMsg.style.color = "#38bdf8";
      }
      try {
        await saveScreenProxySettings(false);
        const res = await fetch(`${API_BASE}/api/screen-proxy/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        }).then(r => r.json());
        if (res && res.success) {
          if (statusMsg) {
            statusMsg.textContent = `✅ เชื่อมต่อสำเร็จ! Egress IP: ${res.ip} (ผ่าน Proxy ${res.proxyHost}:${res.proxyPort})`;
            statusMsg.style.color = "#34d399";
          }
          showToast(`✅ ทดสอบแยก IP สำเร็จ! Egress IP: ${res.ip}`, "success");
        } else {
          if (statusMsg) {
            statusMsg.textContent = `❌ ทดสอบไม่สำเร็จ: ${res?.error || "ยังไม่ได้ใส่รายการ IP หรือ Proxy ตอบกลับผิดพลาด"}`;
            statusMsg.style.color = "#f87171";
          }
          showToast(`❌ ทดสอบไม่สำเร็จ: ${res?.error || "Unknown"}`, "error");
        }
      } catch (e) {
        if (statusMsg) {
          statusMsg.textContent = `❌ เกิดข้อผิดพลาด: ${e.message}`;
          statusMsg.style.color = "#f87171";
        }
      } finally {
        btnTest.disabled = false;
      }
    };
  }

  fetchScreenProxyStatus();
}

// ==========================================
// AUTO CAPTCHA POINT TOP-UP MODAL CONTROLLER
// ==========================================
let lastKnownPointsPerSolve = 1;
function updatePointDisplays(points, pointsPerSolve, serviceAvailable) {
  if (pointsPerSolve != null) lastKnownPointsPerSolve = pointsPerSolve;
  const p = points != null ? Number(points) : 0;
  const topupBadge = document.getElementById("topup-point-badge");
  const topupPointsVal = document.getElementById("topup-modal-points");
  const hcPoints = document.getElementById("hc-points-val");
  const topupStatusBadge = document.getElementById("topup-modal-status-badge");
  const topupRate = document.getElementById("topup-modal-rate");

  if (topupBadge) {
    if (lastKnownPointsPerSolve === 0) {
      topupBadge.innerText = p < 0 ? `ส่วนบุญ ${p.toLocaleString()}` : `ส่วนบุญคงเหลือ ${p.toLocaleString()}`;
      topupBadge.style.background = "rgba(16, 185, 129, 0.25)";
      topupBadge.style.color = "#a7f3d0";
      topupBadge.style.borderColor = "rgba(16, 185, 129, 0.4)";
    } else {
      topupBadge.innerText = p < 0 ? `ส่วนบุญ ${p.toLocaleString()}` : `ส่วนบุญคงเหลือ ${p.toLocaleString()}`;
      topupBadge.style.background = "rgba(250, 204, 21, 0.25)";
      topupBadge.style.color = "#fef08a";
      topupBadge.style.borderColor = "rgba(250, 204, 21, 0.4)";
    }
  }
  if (topupPointsVal) topupPointsVal.innerText = p.toLocaleString();
  if (hcPoints) hcPoints.innerText = p;
  if (topupStatusBadge) {
    if (serviceAvailable === false) {
      topupStatusBadge.innerText = "● ติดต่อเซิร์ฟเวอร์ไม่ได้";
      topupStatusBadge.style.color = "#f87171";
    } else if (lastKnownPointsPerSolve === 0 || p > 0) {
      topupStatusBadge.style.background = "rgba(16, 185, 129, 0.2)";
      topupStatusBadge.style.color = "#34d399";
      topupStatusBadge.style.borderColor = "rgba(16, 185, 129, 0.4)";
      topupStatusBadge.innerText = lastKnownPointsPerSolve === 0 ? "● Humancheck ไม่มีค่าต่อคำตอบ" : "● พร้อมใช้งาน";
    } else {
      topupStatusBadge.style.background = "rgba(239, 68, 68, 0.2)";
      topupStatusBadge.style.color = "#f87171";
      topupStatusBadge.style.borderColor = "rgba(239, 68, 68, 0.4)";
      topupStatusBadge.innerText = "● ส่วนบุญหมด";
    }
  }
  if (topupRate) {
    topupRate.innerText = lastKnownPointsPerSolve === 0
      ? "Humancheck ไม่มีค่าต่อคำตอบ — ส่วนบุญ สำหรับสคริปต์ดูหน้าใบสรุป"
      : 'Humancheck ไม่มีค่าต่อคำตอบ — ดูยอดส่วนบุญสำหรับสคริปต์ในหน้าใบสรุป';
  }
}
window.updatePointDisplays = updatePointDisplays;

function initTopupCaptchaModal() {
  const btnTopup = document.getElementById("btn-topup-captcha");
  const modal = document.getElementById("modal-topup-captcha");
  const btnClose = document.getElementById("btn-topup-close");
  const btnCancel = document.getElementById("btn-topup-cancel");
  const voucherInput = document.getElementById("topup-voucher-input");
  const btnVoucher = document.getElementById("btn-topup-voucher");
  const voucherMsg = document.getElementById("topup-voucher-msg");
  const hwidShort = document.getElementById("topup-hwid-short");
  const btnCopyHwid = document.getElementById("btn-copy-hwid");
  const receiverPhoneEl = document.getElementById("topup-receiver-phone");
  const historyContainer = document.getElementById("topup-history-container");
  const historyCountEl = document.getElementById("topup-history-count");
  const btnGotoSettings = document.getElementById("btn-topup-goto-settings");

  let cachedFullHwid = "";

  if (!btnTopup || !modal) return;

  function showVoucherMsg(text, isError = false) {
    if (!voucherMsg) return;
    voucherMsg.style.display = "block";
    voucherMsg.style.background = isError ? "rgba(239, 68, 68, 0.18)" : "rgba(16, 185, 129, 0.18)";
    voucherMsg.style.color = isError ? "#f87171" : "#34d399";
    voucherMsg.style.border = isError ? "1px solid rgba(239, 68, 68, 0.35)" : "1px solid rgba(16, 185, 129, 0.35)";
    voucherMsg.innerText = text;
    setTimeout(() => { if (voucherMsg) voucherMsg.style.display = "none"; }, 8000);
  }

  function renderHistory(history) {
    if (!historyContainer) return;
    const list = Array.isArray(history) ? history : [];
    if (historyCountEl) historyCountEl.innerText = `${list.length} รายการ`;
    if (list.length === 0) {
      historyContainer.innerHTML = '<div style="color: #64748b; text-align: center; padding: 12px 0;">ยังไม่มีประวัติการเติมเงิน</div>';
      return;
    }
    historyContainer.innerHTML = list.map(item => {
      let dateStr = "";
      try {
        const d = new Date(item.date);
        dateStr = d.toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
      } catch (e) {
        dateStr = item.date || "";
      }
      const points = (Number(item.pointsAdded) || 0).toLocaleString();
      const amount = item.amountBaht != null ? `${Number(item.amountBaht).toFixed(2)} ฿` : `${points} ส่วนบุญ`;
      return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 4px; border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
        <div>
          <span style="font-weight: 700; color: #34d399; font-size: 11.5px;">+${amount}</span>
          <span style="color: #facc15; font-size: 11px; margin-left: 4px;">(+${points} ส่วนบุญ)</span>
          <div style="color: #94a3b8; font-size: 10px; margin-top: 1px;">${escapeHTML(item.note || 'เติมเงิน')}</div>
        </div>
        <div style="font-size: 10px; color: #64748b; font-family: monospace;">${escapeHTML(dateStr)}</div>
      </div>`;
    }).join("");
  }

  async function refreshTopupData() {
    try {
      const res = await fetch(`${API_BASE}/api/human-check/settings`).then(r => r.json());
      if (res && res.success && res.settings) {
        const s = res.settings;
        updatePointDisplays(s.points, s.pointsPerSolve, s.serviceAvailable);

        // Show dev-only shortcuts ONLY if running in dev/git mode
        const isDev = !!res.isDev;
        document.querySelectorAll(".dev-only-feature").forEach(el => {
          el.style.display = isDev ? "" : "none";
        });

        if (s.machineHwid) {
          cachedFullHwid = s.machineHwid;
          if (hwidShort) {
            hwidShort.innerText = `${s.machineHwid.slice(0, 8)}...${s.machineHwid.slice(-6)}`;
            hwidShort.title = `Full HWID: ${s.machineHwid}`;
          }
        }
        const accountEl = document.getElementById("topup-service-account");
        if (accountEl) accountEl.innerText = s.accountId || "ยังไม่ได้เชื่อมต่อบริการ";
        renderHistory(s.topupHistory);
      }
    } catch (e) {}
  }

  async function executeRedeemVoucher() {
    if (!voucherInput) return;
    const url = (voucherInput.value || "").trim();
    if (!url) {
      return showVoucherMsg("กรุณาวางลิงก์ซองของขวัญ TrueMoney เช่น https://gift.truemoney.com/campaign/?v=...", true);
    }
    if (btnVoucher) {
      btnVoucher.disabled = true;
      btnVoucher.innerText = "⏳ กำลังแลกซอง...";
    }
    try {
      const res = await fetch(`${API_BASE}/api/human-check/topup-voucher`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voucherUrl: url })
      }).then(r => r.json());

      if (res && res.success) {
        voucherInput.value = "";
        showVoucherMsg(typeof res.message === 'string' && res.message ? res.message.replace(/\bpoints?\b/gi, 'ส่วนบุญ') : `🎉 แลกซองสำเร็จ! ได้รับ ${res.amount} บาท (+${res.pointsAdded} ส่วนบุญ)`);
        showToast(`🧧 เติมเงินสำเร็จ: +${res.amount} บ. (+${res.pointsAdded} ส่วนบุญ)`, "success");
        await refreshTopupData();
      } else {
        showVoucherMsg("❌ " + (res.message || res.error || "แลกซองไม่สำเร็จ"), true);
      }
    } catch (e) {
      showVoucherMsg("❌ เกิดข้อผิดพลาดในการเชื่อมต่อ: " + e.message, true);
    } finally {
      if (btnVoucher) {
        btnVoucher.disabled = false;
        btnVoucher.innerText = "⚡ แลกซองเข้า ส่วนบุญ";
      }
    }
  }

  async function executeAddPoints(amount) {
    const val = parseInt(amount, 10);
    if (!val || val <= 0) return showVoucherMsg("กรุณาระบุจำนวน ส่วนบุญ ให้ถูกต้อง", true);
    try {
      const res = await fetch(`${API_BASE}/api/human-check/add-points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: val })
      }).then(r => r.json());

      if (res && res.success) {
        updatePointDisplays(res.points);
        showVoucherMsg(`🎉 เติมส่วนบุญ ด่วนสำเร็จ: +${val.toLocaleString()} ส่วนบุญ (คงเหลือ ${res.points.toLocaleString()} ส่วนบุญ)`);
        showToast(`🪙 เติมส่วนบุญ สำเร็จ: +${val.toLocaleString()} ส่วนบุญ`, "success");
        await refreshTopupData();
      } else {
        showVoucherMsg("❌ เติมไม่สำเร็จ: " + (res.error || "Unknown error"), true);
      }
    } catch (e) {
      showVoucherMsg("❌ เกิดข้อผิดพลาด: " + e.message, true);
    }
  }

  btnTopup.addEventListener("click", () => {
    modal.style.display = "flex";
    refreshTopupData();
  });

  const closeModal = () => { modal.style.display = "none"; };
  if (btnClose) btnClose.addEventListener("click", closeModal);
  if (btnCancel) btnCancel.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  if (btnVoucher) btnVoucher.addEventListener("click", executeRedeemVoucher);
  if (voucherInput) {
    voucherInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        executeRedeemVoucher();
      }
    });
  }

  if (btnCopyHwid) {
    btnCopyHwid.addEventListener("click", async () => {
      if (!cachedFullHwid) return;
      try {
        await navigator.clipboard.writeText(cachedFullHwid);
        showToast("📋 คัดลอก HWID เครื่องเรียบร้อยแล้ว", "info");
      } catch (err) {
        prompt("HWID ของเครื่องนี้คือ:", cachedFullHwid);
      }
    });
  }

  document.querySelectorAll(".btn-modal-point").forEach(btn => {
    btn.addEventListener("click", () => {
      const amt = btn.dataset.amount;
      executeAddPoints(amt);
    });
  });

  if (btnGotoSettings) {
    btnGotoSettings.addEventListener("click", () => {
      closeModal();
      const patcherBtn = document.getElementById("btn-game-patcher");
      if (patcherBtn) patcherBtn.click();
    });
  }

  refreshTopupData();
}

function initDeviceNickname() {
  const input = document.getElementById("device-nickname-input");
  const savedBadge = document.getElementById("device-nickname-saved");
  if (!input) return;

  let currentSavedValue = "";
  let hideSavedTimer = null;

  async function loadNickname() {
    try {
      const res = await fetch(`${API_BASE}/api/device-nickname`).then(r => r.json());
      if (res && res.success) {
        currentSavedValue = res.nickname || "";
        input.value = currentSavedValue;
        if (res.defaultNickname) {
          input.placeholder = res.defaultNickname;
        }
      }
    } catch (err) {
      console.warn("Failed to load device nickname:", err);
    }
  }

  async function saveNickname() {
    const val = input.value.trim();
    if (val === currentSavedValue) return;
    try {
      const res = await fetch(`${API_BASE}/api/device-nickname`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: val })
      }).then(r => r.json());

      if (res && res.success) {
        currentSavedValue = res.nickname || "";
        input.value = currentSavedValue;
        if (savedBadge) {
          savedBadge.style.display = "inline";
          if (hideSavedTimer) clearTimeout(hideSavedTimer);
          hideSavedTimer = setTimeout(() => {
            if (savedBadge) savedBadge.style.display = "none";
          }, 2000);
        }
      }
    } catch (err) {
      console.error("Failed to save device nickname:", err);
    }
  }

  input.addEventListener("change", saveNickname);
  input.addEventListener("blur", saveNickname);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    }
  });

  loadNickname();
}

(async () => {
  try {
    const res = await fetch(`${API_BASE}/api/human-check/settings`).then(r => r.json());
    if (res && res.success && res.settings) {
      updateAutoAnswerToolbarBtn(res.settings.autoAnswer !== false);
      updatePointDisplays(res.settings.points, res.settings.pointsPerSolve, res.settings.serviceAvailable);
      const isDev = !!res.isDev;
      document.querySelectorAll(".dev-only-feature").forEach(el => {
        el.style.display = isDev ? "" : "none";
      });
    }
  } catch (e) {}
  // The modal markup follows this script; a fast/cached response can finish before parsing it.
  const initAccountModals=()=>{initTopupCaptchaModal();initProxyRegisterControls();initScreenProxyControls();};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAccountModals, { once: true });
  else initAccountModals();
  initDeviceNickname();
  fetchCaptchaStats();
})();
document.getElementById("btn-start-bot-all").onclick = e => setBotOnAllClients(true, e.currentTarget);
document.getElementById("btn-stop-bot-all").onclick = e => setBotOnAllClients(false, e.currentTarget);

document.getElementById("btn-stop-all").onclick = async () => {
  if (confirm("ยืนยันสั่งปิดจอเกมทั้งหมดทันที?")) {
    await fetch(`${API_BASE}/api/stop-all`, { method: "POST" });
    fetchProfiles();
  }
};

document.getElementById("tile-side").onclick = async (e) => {
  e.preventDefault();
  await fetch(`${API_BASE}/api/tile-windows?layout=side`, { method: "POST" });
};

// Fixed grid cols x rows: windows fill left to right, top to bottom; window cells+1 goes back on cell 1
async function tileFixedGrid(cols, rows) {
  const r = await fetch(`${API_BASE}/api/tile-windows?layout=custom&cols=${cols}&rows=${rows}`, { method: "POST" }).then(x => x.json()).catch(() => null);
  const online = currentProfiles.filter(p => p.isRunning).length;
  if (r && r.success) showToast(`📐 จัดจอแบบ ${cols} × ${rows}${online > cols * rows ? ` — ${online} จอ เกิน ${cols * rows} ช่อง: จอที่ ${cols * rows + 1} ขึ้นไปซ้อนช่องเดิมตามลำดับ` : ""}`, "success");
}
document.querySelectorAll(".tile-fixed").forEach(a => a.onclick = e => { e.preventDefault(); tileFixedGrid(Number(a.dataset.cols), Number(a.dataset.rows)); });
document.getElementById("tile-custom").onclick = e => {
  e.preventDefault();
  let last = "4x3";
  try { last = localStorage.getItem("pm_tile_custom") || last; } catch (err) {}
  const v = prompt("จัดจอเป็นตารางกี่คอลัมน์ × กี่แถว? (เช่น 4x3 = 4 คอลัมน์ 3 แถว)", last);
  if (!v) return;
  const m = String(v).match(/(\d+)\s*[x×*,\s]\s*(\d+)/i);
  if (!m) return alert("พิมพ์แบบ 4x3 (คอลัมน์ x แถว)");
  const cols = Math.max(1, Math.min(10, Number(m[1]))), rows = Math.max(1, Math.min(10, Number(m[2])));
  try { localStorage.setItem("pm_tile_custom", `${cols}x${rows}`); } catch (err) {}
  tileFixedGrid(cols, rows);
};

document.getElementById("tile-grid").onclick = async (e) => {
  e.preventDefault();
  await fetch(`${API_BASE}/api/tile-windows?layout=grid`, { method: "POST" });
};

document.getElementById("btn-refresh").onclick = () => {
  fetchProfiles();
};

document.getElementById("btn-add-profile").onclick = () => {
  openAddModal();
};

// ==========================================
// MAIN SECTION TABS (Game Clients / Zeny Consolidation)
// ==========================================
// ==========================================
// ZENY CONSOLIDATION WORKFLOW (UI CONTROLLER)
// ==========================================
let selectedReceiverProfileId = null;
let selectedSenderIds = new Set();
let unselectedSenderIds = new Set();
let consolidationPollTimer = null;
let isConsolidationRunning = false;
let lastConsolidationState = null;

// "เหลือเงินติดตัวจอที่โอน": each sender keeps this much zeny (server: keepZeny). Remembered in this browser.
function getConsolidationKeepZeny() {
  const el = document.getElementById("zeny-keep-input");
  const v = el ? parseInt(String(el.value).replace(/[^0-9]/g, ""), 10) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 0;
}
(function initConsolidationKeepInput() {
  const el = document.getElementById("zeny-keep-input");
  if (!el) return;
  try { const saved = localStorage.getItem("pm_consolidation_keep"); if (saved) el.value = Number(saved).toLocaleString(); } catch (e) {}
  el.addEventListener("input", () => {
    const n = getConsolidationKeepZeny();
    try { localStorage.setItem("pm_consolidation_keep", String(n)); } catch (e) {}
    if (typeof updateZenyConsolidationView === "function") updateZenyConsolidationView();
  });
  el.addEventListener("blur", () => { el.value = getConsolidationKeepZeny().toLocaleString(); });
})();

function updateZenyConsolidationView() {
  const onlineProfiles = currentProfiles.filter(p => p.isRunning);
  const premiumProfiles = currentProfiles.filter(p => isProfilePremium(p));
  const onlinePremiumProfiles = onlineProfiles.filter(p => isProfilePremium(p));
  
  // 1. Update Top Metrics in Zeny Pane
  const totalOnlineZeny = onlineProfiles.reduce((sum, p) => {
    const z = p.liveState && typeof p.liveState.zeny === 'number' ? p.liveState.zeny : 0;
    return sum + z;
  }, 0);

  const zenyTotalEl = document.getElementById("zeny-total-online-val");
  if (zenyTotalEl) zenyTotalEl.innerText = `${totalOnlineZeny.toLocaleString()} z`;

  const onlineCountEl = document.getElementById("zeny-online-count");
  if (onlineCountEl) onlineCountEl.innerText = `${onlineProfiles.length}`;

  const sendersBadge = document.getElementById("zeny-senders-count-badge");
  if (sendersBadge) sendersBadge.innerText = `${currentProfiles.length} จอ (${onlinePremiumProfiles.length} จอมี 👑 Premium ออนไลน์)`;

  // 2. Populate Receiver Select (Only Premium profiles are selectable)
  const receiverSelect = document.getElementById("zeny-receiver-select");
  if (receiverSelect) {
    const curRecProfile = currentProfiles.find(p => p.id === selectedReceiverProfileId);
    if (!selectedReceiverProfileId || !curRecProfile || !isProfilePremium(curRecProfile)) {
      const defaultRec = onlinePremiumProfiles.find(p => p.isMain) || onlinePremiumProfiles[0] || premiumProfiles.find(p => p.isMain) || premiumProfiles[0] || null;
      selectedReceiverProfileId = defaultRec ? defaultRec.id : "";
    }

    const currentVal = selectedReceiverProfileId || "";
    if (premiumProfiles.length === 0) {
      receiverSelect.innerHTML = `<option value="" disabled selected>⚠️ ไม่มีตัวละครที่มีสถานะ 👑 Premium (การเทรดต้องมี Premium)</option>` +
        currentProfiles.map(p => {
          const charName = p.liveState?.charName || p.lastCharName || p.name;
          return `<option value="${p.id}" disabled>🔒 [ไม่มี Premium] ${escapeHTML(p.name)} [${escapeHTML(charName)}]</option>`;
        }).join("");
    } else {
      receiverSelect.innerHTML = currentProfiles.map(p => {
        const hasPrem = isProfilePremium(p);
        const charName = p.liveState?.charName || p.lastCharName || p.name;
        const isOnline = p.isRunning ? "🟢 ออนไลน์" : "⚪ ออฟไลน์";
        const zeny = p.liveState && typeof p.liveState.zeny === 'number' ? `${p.liveState.zeny.toLocaleString()} z` : '--';
        const mainStar = p.isMain ? "⭐ " : "";
        const premPrefix = hasPrem ? "👑 " : "🔒 [ไม่มี Premium] ";
        return `<option value="${p.id}" ${p.id === currentVal && hasPrem ? "selected" : ""} ${!hasPrem ? "disabled" : ""}>${premPrefix}${mainStar}${escapeHTML(p.name)} [${escapeHTML(charName)}] — ${zeny} (${isOnline})</option>`;
      }).join("");
    }
  }

  // 3. Render Senders Table (Only online Premium profiles can be checked)
  const tbody = document.getElementById("zeny-senders-tbody");
  if (tbody) {
    if (currentProfiles.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 24px;">ไม่พบรายการโปรไฟล์ในระบบ</td></tr>`;
      return;
    }

    let pendingTransferSum = 0;
    let eligibleCount = 0;
    let checkedEligibleCount = 0;
    const completedSet = new Set((lastConsolidationState && Array.isArray(lastConsolidationState.completedSenders)) ? lastConsolidationState.completedSenders : []);
    const activeSenderName = (lastConsolidationState && lastConsolidationState.running) ? lastConsolidationState.currentSender : null;

    tbody.innerHTML = currentProfiles.map(p => {
      const isReceiver = Boolean(selectedReceiverProfileId && p.id === selectedReceiverProfileId);
      const isOnline = !!p.isRunning;
      const hasPrem = isProfilePremium(p);
      const canSelectSender = isOnline && hasPrem && !isReceiver;
      const state = p.liveState || {};
      const charName = state.charName || p.lastCharName || p.name;
      const charClass = state.charClass || p.lastCharClass || p.charClass || 'Novice';
      const mapName = state.map || p.targetMap || '--';
      const channel = state.channel ? `CH ${state.channel}` : (state.channelText || '--');
      const zeny = typeof state.zeny === 'number' ? state.zeny : 0;
      const zenyText = typeof state.zeny === 'number' ? `${zeny.toLocaleString()} z` : '--';

      let isChecked = false;
      if (!canSelectSender) {
        selectedSenderIds.delete(p.id);
        isChecked = false;
      } else {
        eligibleCount++;
        if (!selectedSenderIds.has(p.id) && !unselectedSenderIds.has(p.id)) {
          selectedSenderIds.add(p.id);
        }
        isChecked = selectedSenderIds.has(p.id);
        if (isChecked) {
          checkedEligibleCount++;
          pendingTransferSum += Math.max(0, zeny - getConsolidationKeepZeny());
        }
      }

      let statusBadge = '';
      if (isReceiver) {
        statusBadge = `<span class="zeny-badge-receiver">👑 ตัวรับเงิน (Receiver)</span>`;
      } else if (!hasPrem) {
        statusBadge = `<span class="zeny-badge-status offline" style="color: #fca5a5; border-color: rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.12);" title="ต้องมีสถานะ Premium จึงจะเทรดแลกเปลี่ยนเงินกับผู้เล่นอื่นได้">🔒 ไม่มี Premium (เทรดไม่ได้)</span>`;
      } else if (!isOnline) {
        statusBadge = `<span class="zeny-badge-status offline">⚪ ออฟไลน์</span>`;
      } else if (isConsolidationRunning) {
        if (completedSet.has(p.id)) {
          statusBadge = `<span class="zeny-badge-status done">✅ โอนสำเร็จแล้ว</span>`;
        } else if (activeSenderName && activeSenderName === p.name) {
          statusBadge = `<span class="zeny-badge-status transferring">🔄 กำลังโอนเงิน...</span>`;
        } else if (isChecked) {
          statusBadge = `<span class="zeny-badge-status transferring">⏳ รอคิวโอนเงิน...</span>`;
        } else {
          statusBadge = `<span class="zeny-badge-status ready">🟢 พร้อมโอนเงิน (👑 Premium)</span>`;
        }
      } else {
        statusBadge = `<span class="zeny-badge-status ready">🟢 พร้อมโอนเงิน (👑 Premium)</span>`;
      }

      const checkboxHtml = isReceiver ? 
        `<span style="color: #facc15; font-size: 14px;" title="ตัวรับเงิน (ยกเว้นจากการส่งเงิน)">👑</span>` :
        `<input type="checkbox" class="zeny-sender-cb" data-profile-id="${p.id}" ${isChecked ? 'checked' : ''} ${!canSelectSender ? 'disabled' : ''} title="${!hasPrem ? 'เลือกไม่ได้: ตัวละครนี้ไม่มีสถานะ Premium' : (!isOnline ? 'เลือกไม่ได้: จอนี้ยังไม่ออนไลน์' : 'เลือกเพื่อโอนเงิน')}" style="accent-color: #0ea5e9; cursor: ${canSelectSender ? 'pointer' : 'not-allowed'};">`;

      return `
        <tr class="${isReceiver ? 'receiver-row' : ''}" style="${!hasPrem ? 'opacity: 0.65;' : ''}">
          <td style="text-align: center;">${checkboxHtml}</td>
          <td>
            <div style="font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
              <span>${p.isMain ? '⭐ ' : ''}${escapeHTML(p.name)}</span>
              ${hasPrem ? '<span class="premium-card-badge" style="font-size: 9px; padding: 1px 5px;">👑 PREMIUM</span>' : ''}
            </div>
            <div style="font-size: 10.5px; color: #64748b;">Port: ${p.debugPort || '--'}</div>
          </td>
          <td>
            <div style="font-weight: 600; color: #e2e8f0;">${escapeHTML(charName)}</div>
            <div style="font-size: 10.5px; color: #94a3b8;">${escapeHTML(charClass)}</div>
          </td>
          <td>
            <div style="color: #cbd5e1; font-size: 11.5px;">📍 ${escapeHTML(mapName)}</div>
            <div style="font-size: 10.5px; color: #38bdf8; font-weight: 600;">📡 ${channel}</div>
          </td>
          <td style="text-align: right; font-family: var(--font-mono); font-weight: 700; color: ${zeny > 0 ? '#facc15' : '#94a3b8'};">
            ${zenyText}
            ${!isReceiver && isChecked && getConsolidationKeepZeny() > 0 ? `<div style="font-size: 10.5px; font-weight: 600; color: #94a3b8;">→ โอน ${Math.max(0, zeny - getConsolidationKeepZeny()).toLocaleString()} z</div>` : ''}
          </td>
          <td style="text-align: center;">${statusBadge}</td>
        </tr>
      `;
    }).join("");

    const selectAllCb = document.getElementById("zeny-select-all-checkbox");
    if (selectAllCb && eligibleCount > 0) {
      selectAllCb.checked = (checkedEligibleCount === eligibleCount);
    }

    const pendingEl = document.getElementById("zeny-pending-transfer-val");
    if (pendingEl) pendingEl.innerText = `${pendingTransferSum.toLocaleString()} z`;
  }
}

function switchMainTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tabName);
  });
  document.querySelectorAll(".tab-pane").forEach(pane => {
    pane.classList.toggle("active", pane.getAttribute("data-pane") === tabName);
  });
  document.querySelectorAll("[data-tab-only]").forEach(el => {
    const only = el.getAttribute("data-tab-only");
    el.style.display = (only === tabName) ? "" : "none";
  });
  try { localStorage.setItem("manager.activeTab", tabName); } catch (e) {}

  if (tabName === "zeny") {
    updateZenyConsolidationView();
    pollConsolidationStatus();
  }
}

(() => {
  let saved = null;
  try { saved = localStorage.getItem("manager.activeTab"); } catch (e) {}
  if (saved && document.querySelector(`.tab-pane[data-pane="${saved}"]`)) switchMainTab(saved);
})();

function initZenyConsolidationEvents() {
  // Main Tab Navigation Listeners
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => {
      const tabName = btn.getAttribute("data-tab");
      if (tabName) switchMainTab(tabName);
    };
  });

  const recSelect = document.getElementById("zeny-receiver-select");
  if (recSelect) {
    recSelect.onchange = (e) => {
      const chosen = currentProfiles.find(p => p.id === e.target.value);
      if (!chosen || !isProfilePremium(chosen)) {
        showToast("⚠️ เลือกได้เฉพาะตัวละครที่มีสถานะ 👑 Premium เท่านั้น", "warning");
        updateZenyConsolidationView();
        return;
      }
      selectedReceiverProfileId = e.target.value;
      selectedSenderIds.delete(selectedReceiverProfileId);
      updateZenyConsolidationView();
    };
  }


  const selectAllCb = document.getElementById("zeny-select-all-checkbox");
  if (selectAllCb) {
    selectAllCb.onchange = (e) => {
      const checked = e.target.checked;
      currentProfiles.forEach(p => {
        if (p.id !== selectedReceiverProfileId && p.isRunning && isProfilePremium(p)) {
          if (checked) {
            selectedSenderIds.add(p.id);
            unselectedSenderIds.delete(p.id);
          } else {
            selectedSenderIds.delete(p.id);
            unselectedSenderIds.add(p.id);
          }
        } else {
          selectedSenderIds.delete(p.id);
        }
      });
      updateZenyConsolidationView();
    };
  }

  const tbody = document.getElementById("zeny-senders-tbody");
  if (tbody) {
    tbody.onchange = (e) => {
      const cb = e.target.closest(".zeny-sender-cb");
      if (cb) {
        const pid = cb.dataset.profileId;
        const prof = currentProfiles.find(p => p.id === pid);
        if (!prof || !isProfilePremium(prof)) {
          cb.checked = false;
          selectedSenderIds.delete(pid);
          showToast("⚠️ เลือกได้เฉพาะตัวละครที่มีสถานะ 👑 Premium เท่านั้น", "warning");
          return;
        }
        if (cb.checked) {
          selectedSenderIds.add(pid);
          unselectedSenderIds.delete(pid);
        } else {
          selectedSenderIds.delete(pid);
          unselectedSenderIds.add(pid);
        }
        updateZenyConsolidationView();
      }
    };
  }

  const btnClaimMarket = document.getElementById("btn-claim-market-all");
  if (btnClaimMarket) {
    btnClaimMarket.onclick = async () => {
      try {
        btnClaimMarket.disabled = true;
        btnClaimMarket.innerHTML = `<span>⏳</span> กำลังรับของ...`;
        const res = await fetch(`${API_BASE}/api/market/claim-all`, { method: "POST" });
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch(pe) {
          throw new Error(`เซิร์ฟเวอร์ยังไม่ได้รีสตาร์ทหรือตอบกลับไม่ถูกต้อง (${res.status}): กรุณารีเฟรชหน้าเว็บ (Ctrl + F5)`);
        }
        if (data.success) {
          showToast("🛒 ส่งคำสั่งรับของและเงินจากตลาดกลางทุกจอเรียบร้อย!", "success");
          setTimeout(fetchProfiles, 1500);
        } else {
          showToast(`⚠️ ข้อผิดพลาด: ${data.error || 'ล้มเหลว'}`, "warning");
        }
      } catch(err) {
        showToast(`❌ ข้อผิดพลาด: ${err.message}`, "error");
      } finally {
        btnClaimMarket.disabled = false;
        btnClaimMarket.innerHTML = `<span class="icon">🛒</span> รับไอเทมจากตลาดทุกจอ`;
      }
    };
  }

  const btnStartConsolidation = document.getElementById("btn-start-consolidation");
  const btnStopConsolidation = document.getElementById("btn-stop-consolidation");
  const progressSection = document.getElementById("zeny-progress-section");

  initConsolidationItemTradeUI();

  if (btnStartConsolidation) {
    btnStartConsolidation.onclick = async () => {
      const recProfile = currentProfiles.find(p => p.id === selectedReceiverProfileId);
      if (!selectedReceiverProfileId || !recProfile || !isProfilePremium(recProfile)) {
        alert("กรุณาเลือกตัวรับเงิน (Receiver) ที่มีสถานะ 👑 Premium ก่อน (การเทรดโอนเงินใช้ได้เฉพาะตัวที่มี Premium เท่านั้น)");
        return;
      }
      const senderList = Array.from(selectedSenderIds).filter(id => {
        if (id === selectedReceiverProfileId) return false;
        const sp = currentProfiles.find(p => p.id === id);
        return sp && sp.isRunning && isProfilePremium(sp);
      });
      if (senderList.length === 0) {
        alert("กรุณาเลือกจอผู้โอนที่มีสถานะ 👑 Premium อย่างน้อย 1 จอ");
        return;
      }

      const recName = recProfile?.liveState?.charName || recProfile?.name || selectedReceiverProfileId;
      const keepZeny = getConsolidationKeepZeny();
      const tradeItemsOn = Boolean(consolidationItemSettings.tradeOnConsolidate);
      const tradeItemsNames = Array.isArray(consolidationItemSettings.items) && consolidationItemSettings.items.length > 0
        ? consolidationItemSettings.items
        : ["Enchant Rune"];
      const itemConfirmNote = tradeItemsOn
        ? `📦 เบิกไอเทมจากคลังมาเทรดรวมด้วย: ${tradeItemsNames.join(", ")}\n   (ทุกจอจะแวะขายขยะเคลียร์น้ำหนัก → เบิกหินจากคลัง → เทรดพร้อมเงิน และตัวรับจะฝากเข้าคลังอัตโนมัติ)\n`
        : "";
      if (!confirm(`คุณต้องการเริ่มต้นรวมเงินจาก ${senderList.length} จอ เข้าตัวหลัก [${recName}] ใช่หรือไม่?\n\n${keepZeny > 0 ? `💰 แต่ละจอจะเหลือเงินติดตัวไว้ ${keepZeny.toLocaleString()} z\n` : '💰 โอนเงินทั้งหมดของแต่ละจอ\n'}${itemConfirmNote}(ทุกจอจะหยุดบอท วาร์ปกลับเมืองหลวง และเรียงคิวเทรด)`)) {
        return;
      }

      try {
        btnStartConsolidation.disabled = true;
        btnStartConsolidation.innerHTML = `<span class="icon">⏳</span> กำลังเริ่มรวมเงิน...`;
        if (progressSection) {
          progressSection.style.display = "block";
          try { progressSection.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) {}
        }
        const logsBox = document.getElementById("zeny-logs-box");
        if (logsBox) {
          logsBox.innerHTML = `<div class="zeny-log-entry info"><span class="log-time">${new Date().toLocaleTimeString('th-TH')}</span> ⏳ กำลังตรวจสอบสถานะ Premium และเริ่มระบบรวมเงิน (${senderList.length} จอ)...</div>`;
        }
        const res = await fetch(`${API_BASE}/api/consolidation/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            receiverProfileId: selectedReceiverProfileId,
            senderProfileIds: senderList,
            keepZeny,
            storeOnlyEnabled: Boolean(consolidationItemSettings.storeOnlyEnabled),
            tradeOnConsolidate: tradeItemsOn,
            items: tradeItemsNames
          })
        });
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch(pe) {
          throw new Error(`เซิร์ฟเวอร์ยังไม่ได้รีสตาร์ทหรือตอบกลับไม่ถูกต้อง (${res.status}): กรุณารีเฟรชหน้าเว็บ (Ctrl + F5)`);
        }
        if (data.success) {
          isConsolidationRunning = true;
          if (progressSection) progressSection.style.display = "block";
          btnStartConsolidation.style.display = "none";
          if (btnStopConsolidation) btnStopConsolidation.style.display = "inline-flex";
          showToast(`🚀 เริ่มรวมเงิน${tradeItemsOn ? ' + ไอเทม' : ''}จาก ${senderList.length} จอ เข้า [${recName}] แล้ว`, "info");
          startConsolidationPolling();
          updateZenyConsolidationView();
        } else {
          alert(data.error || "ไม่สามารถเริ่มการรวมเงินได้");
        }
      } catch(err) {
        alert("เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์: " + err.message);
      } finally {
        btnStartConsolidation.disabled = false;
        btnStartConsolidation.innerHTML = `<span class="icon">🚀</span> เริ่มต้นรวมเงิน`;
      }
    };
  }

  if (btnStopConsolidation) {
    btnStopConsolidation.onclick = async () => {
      if (!confirm("คุณต้องการหยุดกระบวนการรวมเงินใช่หรือไม่?")) return;
      try {
        btnStopConsolidation.disabled = true;
        await fetch(`${API_BASE}/api/consolidation/stop`, { method: "POST" });
        showToast("⏹️ สั่งหยุดกระบวนการรวมเงินเรียบร้อย", "warning");
      } catch(err) {
        showToast(err.message, "error");
      } finally {
        btnStopConsolidation.disabled = false;
      }
    };
  }
}

// ==========================================
// STASH-ONLY & CONSOLIDATION ITEM TRADE UI
// ==========================================
const PRESET_CONSOLIDATION_ITEMS = [
  { name: "Enchant Rune", icon: "✨" },
  { name: "Accessory Enchant Rune", icon: "💍" },
  { name: "Rough Elunium", icon: "🪨" },
  { name: "Elunium", icon: "🛡️" },
  { name: "Enriched Elunium", icon: "💎" },
  { name: "Oridecon", icon: "⚔️" },
  { name: "Phracon", icon: "🔩" },
  { name: "Emveretarcon", icon: "🔶" }
];

let consolidationItemSettings = {
  storeOnlyEnabled: false,
  tradeOnConsolidate: false,
  items: ["Enchant Rune"]
};

function renderConsolidationItemTradeUI() {
  const cbStoreOnly = document.getElementById("cb-stash-only-enabled");
  const cbTradeItems = document.getElementById("cb-trade-items-consolidate");
  const boxStoreOnly = document.getElementById("zst-box-store-only");
  const boxTradeItems = document.getElementById("zst-box-trade-items");
  const badgeStoreOnly = document.getElementById("badge-stash-only-state");
  const badgeTradeItems = document.getElementById("badge-trade-items-state");
  const chipsContainer = document.getElementById("zst-items-chips-container");

  const storeOn = Boolean(consolidationItemSettings.storeOnlyEnabled);
  const tradeOn = Boolean(consolidationItemSettings.tradeOnConsolidate);
  const selectedList = Array.isArray(consolidationItemSettings.items) && consolidationItemSettings.items.length > 0
    ? consolidationItemSettings.items
    : ["Enchant Rune"];
  const selectedLower = new Set(selectedList.map(x => String(x || "").trim().toLowerCase()));

  if (cbStoreOnly) cbStoreOnly.checked = storeOn;
  if (cbTradeItems) cbTradeItems.checked = tradeOn;
  if (boxStoreOnly) boxStoreOnly.classList.toggle("is-active-emerald", storeOn);
  if (boxTradeItems) boxTradeItems.classList.toggle("is-active-purple", tradeOn);

  if (badgeStoreOnly) {
    badgeStoreOnly.textContent = storeOn ? "🟢 เปิดเก็บคลังอย่างเดียว" : "ปิดอยู่";
    badgeStoreOnly.classList.toggle("on-emerald", storeOn);
  }
  if (badgeTradeItems) {
    badgeTradeItems.textContent = tradeOn ? "🟣 เบิกคลังมาเทรดด้วย" : "โอนเฉพาะเงิน";
    badgeTradeItems.classList.toggle("on-purple", tradeOn);
  }

  if (chipsContainer) {
    const presetLower = new Set(PRESET_CONSOLIDATION_ITEMS.map(p => p.name.toLowerCase()));
    const customItems = selectedList.filter(x => !presetLower.has(String(x || "").trim().toLowerCase()));

    const presetHtml = PRESET_CONSOLIDATION_ITEMS.map(p => {
      const isSelected = selectedLower.has(p.name.toLowerCase());
      return `<button type="button" class="zst-item-chip ${isSelected ? 'active' : ''}" data-item-name="${escapeHTML(p.name)}" title="คลิกเพื่อเลือก/ยกเลิก ${escapeHTML(p.name)}">
        <span>${isSelected ? '✅' : p.icon}</span>
        <span>${escapeHTML(p.name)}</span>
      </button>`;
    }).join("");

    const customHtml = customItems.map(name => {
      return `<button type="button" class="zst-item-chip active" data-item-name="${escapeHTML(name)}" title="คลิกเพื่อเอา ${escapeHTML(name)} ออกจากรายการ">
        <span>✅</span>
        <span>${escapeHTML(name)}</span>
        <span class="zst-chip-remove">×</span>
      </button>`;
    }).join("");

    chipsContainer.innerHTML = presetHtml + customHtml;
  }
}

async function saveAndSyncConsolidationItemSettings(patch = {}, toastLabel = "") {
  consolidationItemSettings = {
    ...consolidationItemSettings,
    ...patch
  };
  if (!Array.isArray(consolidationItemSettings.items) || consolidationItemSettings.items.length === 0) {
    consolidationItemSettings.items = ["Enchant Rune"];
  }
  renderConsolidationItemTradeUI();

  const syncPill = document.getElementById("zst-sync-status-pill");
  if (syncPill) syncPill.textContent = "⏳ กำลังซิงค์ไปทุกจอ...";

  try {
    const res = await fetch(`${API_BASE}/api/consolidation/item-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(consolidationItemSettings)
    }).then(r => r.json());
    if (res && res.success && res.settings) {
      consolidationItemSettings = res.settings;
      renderConsolidationItemTradeUI();
      if (syncPill) {
        syncPill.textContent = `✅ ซิงค์แล้ว (${res.syncedClients || 0}/${res.totalChecked || 0} จอ)`;
      }
      if (toastLabel) {
        showToast(`${toastLabel} (ซิงค์ ${res.syncedClients || 0} จอ)`, "success");
      }
    }
  } catch (err) {
    if (syncPill) syncPill.textContent = "⚠️ ซิงค์ไม่สำเร็จ";
    console.warn("saveAndSyncConsolidationItemSettings error:", err);
  }
}

let consolidationItemTradeUIInitialized = false;
async function initConsolidationItemTradeUI() {
  if (consolidationItemTradeUIInitialized) return;
  consolidationItemTradeUIInitialized = true;

  const cbStoreOnly = document.getElementById("cb-stash-only-enabled");
  const cbTradeItems = document.getElementById("cb-trade-items-consolidate");
  const chipsContainer = document.getElementById("zst-items-chips-container");
  const customInput = document.getElementById("zst-custom-item-input");
  const btnAddCustom = document.getElementById("btn-zst-add-custom-item");

  if (cbStoreOnly) {
    cbStoreOnly.onchange = () => {
      const enabled = cbStoreOnly.checked;
      saveAndSyncConsolidationItemSettings(
        { storeOnlyEnabled: enabled },
        enabled
          ? `🔒 เปิดโหมดเก็บ [${consolidationItemSettings.items.join(", ")}] เข้าคลังอย่างเดียว (ห้ามขาย)`
          : "🔓 ปิดโหมดเก็บหินเข้าคลังอย่างเดียวแล้ว"
      );
    };
  }

  if (cbTradeItems) {
    cbTradeItems.onchange = () => {
      const enabled = cbTradeItems.checked;
      saveAndSyncConsolidationItemSettings(
        { tradeOnConsolidate: enabled },
        enabled
          ? `📦 เปิดเบิก [${consolidationItemSettings.items.join(", ")}] จากคลังมาเทรดรวมตอนรวมเงิน`
          : "💰 ตั้งค่าให้รวมเฉพาะเงิน Zeny อย่างเดียว"
      );
    };
  }

  if (chipsContainer) {
    chipsContainer.onclick = (e) => {
      const btn = e.target.closest(".zst-item-chip");
      if (!btn) return;
      const itemName = (btn.dataset.itemName || "").trim();
      if (!itemName) return;
      const cur = Array.isArray(consolidationItemSettings.items) ? [...consolidationItemSettings.items] : ["Enchant Rune"];
      const idx = cur.findIndex(x => String(x || "").trim().toLowerCase() === itemName.toLowerCase());
      if (idx >= 0) {
        if (cur.length <= 1) {
          showToast("⚠️ ต้องเลือกไอเทมไว้อย่างน้อย 1 รายการ", "warning");
          return;
        }
        cur.splice(idx, 1);
      } else {
        cur.push(itemName);
      }
      saveAndSyncConsolidationItemSettings({ items: cur }, `🎯 อัปเดตรายการไอเทม: ${cur.join(", ")}`);
    };
  }

  const handleAddCustom = () => {
    if (!customInput) return;
    const val = (customInput.value || "").trim();
    if (!val) return;
    const cur = Array.isArray(consolidationItemSettings.items) ? [...consolidationItemSettings.items] : ["Enchant Rune"];
    if (!cur.some(x => String(x || "").trim().toLowerCase() === val.toLowerCase())) {
      cur.push(val);
    }
    customInput.value = "";
    saveAndSyncConsolidationItemSettings({ items: cur }, `➕ เพิ่ม "${val}" ในรายการเก็บคลัง/เทรดรวมแล้ว`);
  };

  if (btnAddCustom) btnAddCustom.onclick = handleAddCustom;
  if (customInput) {
    customInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddCustom();
      }
    });
  }

  renderConsolidationItemTradeUI();
  try {
    const res = await fetch(`${API_BASE}/api/consolidation/item-settings`).then(r => r.json());
    if (res && res.success && res.settings) {
      consolidationItemSettings = res.settings;
      renderConsolidationItemTradeUI();
    }
  } catch (e) {}
}

function startConsolidationPolling() {
  if (consolidationPollTimer) clearInterval(consolidationPollTimer);
  consolidationPollTimer = setInterval(pollConsolidationStatus, 900);
  pollConsolidationStatus();
}

async function pollConsolidationStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/consolidation/status`);
    const state = await res.json();
    if (!state.success) return;
    lastConsolidationState = state;

    const progressSection = document.getElementById("zeny-progress-section");
    if (state.status === 'running' || state.logs.length > 0) {
      if (progressSection) progressSection.style.display = "block";
    }

    const stepBadge = document.getElementById("zeny-current-step-badge");
    if (stepBadge) stepBadge.innerText = `ขั้นตอนที่ ${state.stepIndex || 1}/${state.totalSteps || 5}`;

    const stepTitle = document.getElementById("zeny-current-step-title");
    if (stepTitle) stepTitle.innerText = state.step || "กำลังดำเนินการ...";

    document.querySelectorAll(".zeny-pipeline-step").forEach(el => {
      const stepNum = parseInt(el.dataset.step) || 0;
      el.classList.toggle("completed", stepNum < state.stepIndex);
      el.classList.toggle("active", stepNum === state.stepIndex);
    });

    const barFill = document.getElementById("zeny-progress-bar-fill");
    if (barFill) {
      const percent = Math.min(100, Math.round((state.stepIndex / (state.totalSteps || 5)) * 100));
      barFill.style.width = `${percent}%`;
    }

    const logsBox = document.getElementById("zeny-logs-box");
    if (logsBox && Array.isArray(state.logs)) {
      logsBox.innerHTML = state.logs.map(log => {
        return `<div class="zeny-log-entry ${log.level || 'info'}"><span class="log-time">${escapeHTML(log.time)}</span> ${escapeHTML(log.text)}</div>`;
      }).join("");
      logsBox.scrollTop = logsBox.scrollHeight;
    }

    const btnStart = document.getElementById("btn-start-consolidation");
    const btnStop = document.getElementById("btn-stop-consolidation");
    if (state.running) {
      isConsolidationRunning = true;
      if (btnStart) btnStart.style.display = "none";
      if (btnStop) btnStop.style.display = "inline-flex";
      if (!consolidationPollTimer) {
        consolidationPollTimer = setInterval(pollConsolidationStatus, 900);
      }
      updateZenyConsolidationView();
    } else {
      const wasRunning = isConsolidationRunning;
      isConsolidationRunning = false;
      if (btnStart) btnStart.style.display = "inline-flex";
      if (btnStop) btnStop.style.display = "none";
      if (wasRunning) updateZenyConsolidationView();
      if (state.status === "completed") {
        if (consolidationPollTimer) {
          clearInterval(consolidationPollTimer);
          consolidationPollTimer = null;
        }
        if (wasRunning) showToast("🎉 รวมเงินเสร็จสิ้นสมบูรณ์!", "success");
        fetchProfiles();
      } else if (state.status === "stopped" || state.status === "error") {
        if (consolidationPollTimer) {
          clearInterval(consolidationPollTimer);
          consolidationPollTimer = null;
        }
      }
    }
  } catch(e) {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initZenyConsolidationEvents);
} else {
  initZenyConsolidationEvents();
}

// ==========================================
// FLOATING IN-GAME BOT HUD (DIRECT GITHUB REPLICA)
// ==========================================
function getGitHubHudTemplate(profileId, clientData, profile) {
  const isCentral = (profileId === '__central__');
  const onlineCount = currentProfiles.filter(p => p.isRunning).length;
  const charDisplayName = isCentral ? `เมนูส่วนกลาง (${onlineCount} จอออนไลน์)` : (clientData?.state?.charName || profile.name);
  const archer = clientData?.archerConfig || {};
  const sell = clientData?.sellConfig || {};
  const auth = clientData?.authConfig || {};
  const autosell = clientData?.autoMarketSellConfig || {};
  const marketFilter = clientData?.marketFilterConfig || {};
  const shop = clientData?.shopConfig || {};
  const travel = clientData?.travelConfig || {};
  const humanize = clientData?.humanizeConfig || {};
  const potionCounts = clientData?.potionCounts || {};
  const planName = clientData?.currentPlanName || '(ยังไม่เลือกแผน)';

  return `
<div class="p-header" id="pelican-drag-handle" style="${isCentral ? 'background: linear-gradient(135deg, #78350f 0%, #451a03 100%); border-bottom: 1px solid rgba(250, 204, 21, 0.45);' : ''}">
                <div class="p-header-top">
                    <div class="p-header-name">
                        <span style="font-size: 13px;">${isCentral ? '🎛️' : '🔄'}</span>
                        <span class="p-header-title" style="${isCentral ? 'color: #fde047;' : ''}">${escapeHTML(charDisplayName)}</span>
                    </div>
                    <div class="p-header-controls">
                        <span class="pelican-toggle" onclick="toggleWebHudCollapse('${profileId}')" title="ย่อ/ขยาย">−</span>
                        <span class="pelican-close-btn" onclick="closeWebBotHUD('${profileId}')" title="ปิดหน้าต่าง">✕</span>
                    </div>
                </div>
                <div class="p-header-badges">
                    ${isCentral ? `
                    <span id="p-central-online-pill" style="font-size: 10px; background: rgba(250, 204, 21, 0.22); border: 1px solid rgba(250, 204, 21, 0.5); color: #fef08a; padding: 2px 8px; border-radius: 10px; font-weight: bold;">🖥️ คุมพร้อมกัน ${onlineCount} จอ (ส่งเฉพาะค่าที่คุณกดปรับ)</span>
                    ` : `
                    <span id="p-quick-zeny" style="font-size: 10px; background: rgba(250, 204, 21, 0.2); border: 1px solid rgba(250, 204, 21, 0.4); color: #facc15; padding: 1px 7px; border-radius: 10px; font-weight: bold;" title="เงินในตัว (Zeny)">💰 ${typeof clientData?.state?.zeny === 'number' ? clientData.state.zeny.toLocaleString() + ' z' : '-- z'}</span>
                    <span id="p-quick-ammo" style="font-size: 10px; background: rgba(34, 197, 94, 0.2); border: 1px solid rgba(34, 197, 94, 0.4); color: #22c55e; padding: 1px 7px; border-radius: 10px; font-weight: bold;">🏹 ${clientData?.currentAmmo ?? 0}</span>
                    <span id="p-quick-weight" style="font-size: 10px; background: rgba(56, 189, 248, 0.2); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; padding: 1px 7px; border-radius: 10px; font-weight: bold; cursor: pointer;" title="คลิกเพื่อจัดเรียงกระเป๋าและอัปเดตน้ำหนัก">⚖️ ${escapeHTML(clientData?.state?.weight || '--%')}</span>
                    <button type="button" class="p-copy-cfg-btn" onclick="openConfigCopyDialog('${profileId}')" title="คัดลอกการตั้งค่าบอททั้งหมดของจอนี้ไปจออื่น (ยกเว้น ID / รหัสผ่าน / ชื่อตัวละคร)">📋 คัดลอกไปจออื่น</button>
                    `}
                </div>
            </div>

            <div class="p-body" id="pelican-content">
                ${isCentral ? `
                <div style="background: rgba(250, 204, 21, 0.12); border: 1px solid rgba(250, 204, 21, 0.35); color: #fde68a; padding: 6px 8px; border-radius: 6px; font-size: 10px; line-height: 1.45; margin: 6px 10px 2px 10px;">
                  💡 <b>โหมดเมนูส่วนกลาง:</b> การเปิดหน้าต่างนี้หรือสลับแท็บ<b>จะไม่ทับค่าใดๆ</b> ของแต่ละจอ จนกว่าคุณจะกดปุ่มหรือติ๊กปรับตัวเลือกตัวนั้น ระบบจึงจะส่ง<b>เฉพาะคำสั่งนั้น</b>ไปทุกจอทันที
                </div>
                ` : `
                <div id="p-weight-alert-banner" style="display: none; background: rgba(239, 68, 68, 0.25); border: 1px solid #ef4444; color: #fca5a5; padding: 4px 8px; border-radius: 6px; font-weight: bold; font-size: 10px; text-align: center; margin: 4px 10px 0 10px;">⚠️ น้ำหนักเกินเกณฑ์!</div>
                <div class="p-status-strip">
                    <span>แมพ: <b id="p-cur-map-display" style="color:#38bdf8;">รอระบุแมพ...</b></span>
                    <span>สถานะ: <b id="p-char-state" style="color:#22c55e;">ปกติ</b></span>
                </div>
                <div class="p-status-strip" style="border-top:none; padding-top:0;">
                    <span>Status: <b id="pelican-status-text" style="color:#22c55e;">Online</b></span>
                    <span>Pos: <b id="p-cur-pos" style="color:#00ffcc;">รอ Minimap...</b></span>
                </div>
                `}

                <div class="p-tabs">
                    <button class="p-tab-btn active" data-tab="farm">🚀 ฟาร์ม</button>
                    <button class="p-tab-btn" data-tab="ammo">🏹 ธนู</button>
                    <button class="p-tab-btn" data-tab="potion">🧪 ยาบัพ</button>
                    <button class="p-tab-btn" data-tab="sell">💰 ขายของ</button>
                    <button class="p-tab-btn" data-tab="market">🛒 ตลาด</button>
                    <button class="p-tab-btn" data-tab="system">⚙️ ตั้งค่า</button>
                </div>

                <!-- TAB 1: FARM -->
                <div class="p-tab-pane active" id="p-tab-farm">
                    ${isCentral ? `
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px;">
                      <button type="button" class="p-btn" id="p-btn-central-start-bot" style="margin: 0; font-size: 11.5px; padding: 8px 6px; font-weight: bold; border-radius: 6px; background: linear-gradient(135deg, #16a34a, #15803d); color: #fff; border: 1px solid #4ade80;" title="สั่งเริ่มบอททุกจอที่ออนไลน์ (จอที่บอททำงานอยู่แล้วจะทำงานต่อไป ไม่สลับหยุด)">▶️ เริ่มบอททุกจอ</button>
                      <button type="button" class="p-btn" id="p-btn-central-stop-bot" style="margin: 0; font-size: 11.5px; padding: 8px 6px; font-weight: bold; border-radius: 6px; background: linear-gradient(135deg, #dc2626, #b91c1c); color: #fff; border: 1px solid #f87171;" title="สั่งหยุดบอททุกจอที่ออนไลน์ (จอที่หยุดอยู่แล้วจะหยุดต่อไป ไม่สลับเปิด)">⏹️ หยุดบอททุกจอ</button>
                    </div>
                    ` : `
                    <button class="p-btn" id="p-btn-toggle-bot" style="font-size: 12.5px; padding: 8px 10px; font-weight: bold; border-radius: 6px; transition: all 0.2s ease;">▶️ START BOT (เริ่มทำงาน)</button>
                    `}

                    <div class="p-card">
                        <div class="p-card-title" style="font-size: 10.5px; font-weight: bold; color: #e2e8f0; margin-bottom: 4px;">⚙️ โหมดการทำงาน</div>
                        <label class="p-check-box" style="color: #4ade80;">
                            <input type="checkbox" id="p-auto-loop" ${clientData?.autoLoopEnabled ? "checked" : ""}>
                            <span><b>ลูป 24 ชม.</b> <small style="color:#94a3b8;">(ตาย → ชุบ → กลับแมพฟาร์มอัตโนมัติ)</small></span>
                        </label>
                        <label class="p-check-box" style="color: #c084fc; margin-top: 3px;">
                            <input type="checkbox" id="p-plan-script-enabled" ${clientData?.planScriptEnabled ? "checked" : ""}>
                            <span><b>📜 Plan Script</b> <small style="color:#94a3b8;">แผน: <span id="p-plan-name-display" style="color: #38bdf8; font-weight: bold;">${escapeHTML(planName)}</span></small></span>
                        </label>
                    </div>

                    <div class="p-card">
                        <div class="p-card-title" style="font-size: 10.5px; font-weight: bold; color: #e2e8f0; margin-bottom: 4px;">🗺️ แมพฟาร์มเป้าหมาย</div>
                        <select id="p-target-map-select" class="p-select">
                            <optgroup label="🏰 เขตเมือง & พื้นที่ปลอดภัย">
                                <option value="เมืองหลวงโซลเฮเวน">เมืองหลวงโซลเฮเวน (ปลอดภัย)</option>
                                <option value="ตลาดคาราวาน">ตลาดคาราวาน (ปลอดภัย)</option>
                            </optgroup>
                            <optgroup label="🌱 แมพระดับเริ่มต้น (Lv. 1-12)">
                                <option value="สวนนักผจญภัยมือใหม่">สวนนักผจญภัยมือใหม่ (Lv. 1-3)</option>
                                <option value="ทุ่งโคลเวอร์">ทุ่งโคลเวอร์ (Lv. 1-5)</option>
                                <option value="ทุ่งหญ้าตะวันออก">ทุ่งหญ้าตะวันออก (Lv. 1-5)</option>
                                <option value="ไร่ซันเกรน">ไร่ซันเกรน (Lv. 1-6)</option>
                                <option value="ถนนต้นหลิว">ถนนต้นหลิว (Lv. 6-12)</option>
                            </optgroup>
                            <optgroup label="⚔️ แมพยอดนิยมระดับกลาง (Lv. 12-35)">
                                <option value="ทะเลสาบอาซูร์">ทะเลสาบอาซูร์ (Lv. 12-20)</option>
                                <option value="ป่ามูนลีฟ">ป่ามูนลีฟ (Lv. 14-22)</option>
                                <option value="เส้นทางก็อบลิน">เส้นทางก็อบลิน (Lv. 16-20)</option>
                                <option value="เหมืองคริสตัลเก่า">เหมืองคริสตัลเก่า (Lv. 18-28)</option>
                                <option value="ค่ายออร์ค">ค่ายออร์ค (Lv. 22-32)</option>
                                <option value="ถ้ำเอมเบอร์">ถ้ำเอมเบอร์ (Lv. 22-32)</option>
                                <option value="ที่ราบสูงเกล">ที่ราบสูงเกล (Lv. 25-35)</option>
                            </optgroup>
                            <optgroup label="🏔️ แมพระดับกลางสูง (Lv. 30-60)">
                                <option value="แอ่งเวอร์แดนท์">แอ่งเวอร์แดนท์ (Lv. 30-40)</option>
                                <option value="ช่องเขาฟรอสต์พีค">ช่องเขาฟรอสต์พีค (Lv. 35-45)</option>
                                <option value="ชายฝั่งปะการัง">ชายฝั่งปะการัง (Lv. 40-50)</option>
                                <option value="ซากโบราณสถาน">ซากโบราณสถาน (Lv. 45-55)</option>
                                <option value="สุสานเงา">สุสานเงา (Lv. 50-60)</option>
                            </optgroup>
                            <optgroup label="🔥 แมพระดับสูง & แดนอันตราย (Lv. 60-150)">
                                <option value="หนองพิษ">หนองพิษ (Lv. 60-70)</option>
                                <option value="โบสถ์อเวจี">โบสถ์อเวจี (Lv. 80-95)</option>
                                <option value="บึงรากเน่า">บึงรากเน่า (Lv. 90-105)</option>
                                <option value="เนินทรายแผดเผา">เนินทรายแผดเผา (Lv. 100-115)</option>
                                <option value="พีระมิดจมทราย">พีระมิดจมทราย (Lv. 115-130)</option>
                                <option value="แกนลาวา">แกนลาวา (Lv. 135-150)</option>
                            </optgroup>
                        </select>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 5px;">
                            <button class="p-btn p-btn-loop" id="p-btn-walk-map">🚀 เดินกลับแมพ</button>
                            <button class="p-btn p-btn-map" id="p-btn-open-map">🗺️ แผนที่โลก</button>
                        </div>
                        <div class="p-row" title="ถ้าเงินต่ำกว่าจำนวนนี้ บอทจะไม่จ่ายค่าวาร์ปที่ NPC Alice แต่จะเปิดแผนที่โลกแล้วเดินไปเอง (0 = ปิด)" style="margin-top: 6px; gap: 6px;">
                            <span style="font-size: 10px; color: #e2e8f0;">💸 เงินต่ำกว่า</span>
                            <input type="number" id="p-warp-min-zeny" min="0" step="1000" value="${Number(travel.minZenyForWarp) || 0}" style="width: 84px; background: #0f172a; border: 1px solid #38bdf8; color: #fff; text-align: center; border-radius: 4px; font-size: 10.5px; padding: 2px;">
                            <span style="font-size: 10px; color: #e2e8f0;">z ไม่วาร์ป เดินแทน</span>
                        </div>
                        <div style="font-size: 9px; color: #94a3b8; margin-top: 2px;">0 = วาร์ปตามปกติ · ถ้าเดินไปจากจุดนั้นไม่ได้ จะยังวาร์ปให้</div>
                    </div>

                    <!-- CARD: SECURITY & HUMANIZE -->
                    <div class="p-card" style="border-color: rgba(56, 189, 248, 0.35); background: rgba(15, 23, 42, 0.65);">
                        <div style="font-size: 10.5px; font-weight: bold; color: #38bdf8; margin-bottom: 4px;">🛡️ ความปลอดภัย & พฤติกรรมเสมือนคน (Humanize)</div>
                        <label class="p-check-box" style="color: #38bdf8;">
                            <input type="checkbox" id="p-unexpected-town-guard" ${clientData?.unexpectedTownGuardEnabled !== false ? 'checked' : ''}>
                            <span><b>ตรวจจับกลับเมืองผิดปกติ</b> <small style="color:#94a3b8; display:block;">ไม่ตาย ไม่กดวิง แต่ตกค้างในเมือง → สุ่มพักรอ 5-15 นาที</small></span>
                        </label>
                        <div id="p-unexpected-town-box" style="display: ${clientData?.unexpectedTownWaiting ? 'block' : 'none'}; margin-top: 6px; padding: 6px 8px; background: rgba(239, 68, 68, 0.15); border: 1px dashed #ef4444; border-radius: 6px;">
                            <div style="font-size: 11px; color: #fca5a5; display: flex; justify-content: space-between; align-items: center;">
                                <span>⏳ พักรอนิรภัย: <b id="p-unexpected-countdown" style="color: #fef08a;">${escapeHTML(clientData?.unexpectedTownCountdown || '--:--')}</b></span>
                                <button id="p-btn-skip-unexpected-wait" style="background: #ef4444; color: #fff; border: none; border-radius: 4px; font-size: 10px; font-weight: bold; cursor: pointer; padding: 2px 7px;">⏩ ข้ามเวลารอ</button>
                            </div>
                        </div>

                        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.08);">
                            <label class="p-check-box" style="color: #a78bfa;">
                                <input type="checkbox" id="p-humanize-enabled" ${humanize.enabled !== false ? 'checked' : ''}>
                                <span><b>🎭 จำลองพฤติกรรมคน (Humanize)</b> <small style="color:#94a3b8; display:block;">สุ่มทำกิจกรรมตอนกลับเมือง ก่อนกลับไปฟาร์ม</small></span>
                            </label>
                            <div class="p-row" style="margin-top: 5px; gap: 6px;">
                                <span style="font-size: 10px; color: #cbd5e1;">🎲 โอกาสทำ:</span>
                                <input type="number" id="p-humanize-chance" min="10" max="100" step="5" value="${Number(humanize.chance) || 70}" style="width: 55px; background: #0f172a; border: 1px solid #a78bfa; color: #fff; text-align: center; border-radius: 4px; font-size: 10.5px; padding: 2px;">
                                <span style="font-size: 10px; color: #cbd5e1;">%</span>
                                <button id="p-btn-test-humanize" style="margin-left: auto; background: #6366f1; color: #fff; border: none; border-radius: 4px; font-size: 9px; cursor: pointer; padding: 2px 6px;">🧪 ทดสอบ</button>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 6px;">
                                <label class="p-check-box" style="margin: 0; font-size: 9.5px; color: #cbd5e1;">
                                    <input type="checkbox" id="p-humanize-blacksmith" ${humanize.buyBlacksmith !== false ? 'checked' : ''}>
                                    <span>⚒️ ซื้อหินแล้วขาย</span>
                                </label>
                                <label class="p-check-box" style="margin: 0; font-size: 9.5px; color: #cbd5e1;">
                                    <input type="checkbox" id="p-humanize-sundries" ${humanize.buySundries !== false ? 'checked' : ''}>
                                    <span>🧪 ซื้อยาแล้วขาย</span>
                                </label>
                                <label class="p-check-box" style="margin: 0; font-size: 9.5px; color: #cbd5e1;">
                                    <input type="checkbox" id="p-humanize-walk" ${humanize.randomWalk !== false ? 'checked' : ''}>
                                    <span>🚶 เดินสำรวจลาน</span>
                                </label>
                                <label class="p-check-box" style="margin: 0; font-size: 9.5px; color: #cbd5e1;">
                                    <input type="checkbox" id="p-humanize-storage" ${humanize.storeDeposit !== false ? 'checked' : ''}>
                                    <span>📦 เก็บ Whitelist</span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- TAB 2: HUNTER / AMMO -->
                <div class="p-tab-pane" id="p-tab-ammo">
                    <div class="p-card" style="border-color: rgba(34, 197, 94, 0.3); background: rgba(34, 197, 94, 0.08);">
                        <div class="p-row">
                            <span>ลูกธนูคงเหลือ (Server):</span>
                            <b id="p-ammo-count" style="color: #22c55e; font-size: 13px;">${clientData?.currentAmmo ?? 0} ดอก</b>
                            <div style="display: flex; gap: 3px;">
                                <button id="p-btn-sync-ammo" style="background: #0284c7; color: #fff; border: none; border-radius: 3px; font-size: 9px; cursor: pointer; padding: 2px 6px;">🔄 ซิงก์</button>
                                <button id="p-btn-zero-ammo" style="background: #e11d48; color: #fff; border: none; border-radius: 3px; font-size: 9px; cursor: pointer; padding: 2px 6px;">ตั้งเป็น 0</button>
                            </div>
                        </div>
                    </div>

                    <label class="p-check-box" style="color: #c084fc;">
                        <input type="checkbox" id="p-archer-req" ${archer.requireArrow ? "checked" : ""}>
                        <b>Require Arrow (เช็ค & ซื้ออัตโนมัติ)</b>
                    </label>

                    <div>
                        <span style="font-size: 10px; color: #94a3b8;">ชนิดลูกธนู:</span>
                        <select id="p-archer-type" class="p-select">
                            <option value="90030" ${parseInt(archer.arrowType || 90030) === 90030 ? "selected" : ""}>Arrow (ธรรมดา - 1z)</option>
                            <option value="90031" ${parseInt(archer.arrowType || 90030) === 90031 ? "selected" : ""}>Fire Arrow (ไฟ - 3z)</option>
                            <option value="90032" ${parseInt(archer.arrowType || 90030) === 90032 ? "selected" : ""}>Crystal Arrow (น้ำ - 3z)</option>
                            <option value="90033" ${parseInt(archer.arrowType || 90030) === 90033 ? "selected" : ""}>Stone Arrow (ดิน - 3z)</option>
                            <option value="90034" ${parseInt(archer.arrowType || 90030) === 90034 ? "selected" : ""}>Arrow of Wind (ลม - 3z)</option>
                            <option value="90035" ${parseInt(archer.arrowType || 90030) === 90035 ? "selected" : ""}>Poison Arrow (พิษ - 3z)</option>
                            <option value="90036" ${parseInt(archer.arrowType || 90030) === 90036 ? "selected" : ""}>Silver Arrow (ศักดิ์สิทธิ์ - 3z)</option>
                            <option value="90037" ${parseInt(archer.arrowType || 90030) === 90037 ? "selected" : ""}>Shadow Arrow (เงา - 3z)</option>
                        </select>
                    </div>

                    <div class="p-row">
                        <span>ตั้งเป้าพกลูกธนู (ซื้อเติมให้ครบ):</span>
                        <input type="number" id="p-archer-qty" value="${archer.arrowBuyQty || 5000}" style="width: 65px; background: #0f172a; border: 1px solid #c084fc; color: #fff; text-align: center; border-radius: 4px; font-size: 11px; padding: 2px;">
                    </div>

                    <div class="p-row">
                        <span>วาร์ปซื้อเมื่อเหลือ <= (ดอก):</span>
                        <input type="number" id="p-archer-threshold" value="${archer.ammoThreshold || 50}" style="width: 55px; background: #0f172a; border: 1px solid #c084fc; color: #fff; text-align: center; border-radius: 4px; font-size: 11px; padding: 2px;">
                    </div>

                    <div class="p-card" style="border-color: rgba(56, 189, 248, 0.3);">
                        <label class="p-check-box" style="color: #38bdf8;">
                            <input type="checkbox" id="p-archer-bwing" ${archer.useBwing ? "checked" : ""}>
                            <b>ใช้วาร์ปกลับเมือง (Butterfly Wing)</b>
                        </label>
                        <div class="p-row" style="margin-top: 3px;">
                            <span>ซื้อ Bwing ติดตัว (ใบ):</span>
                            <input type="number" id="p-archer-bwing-qty" value="${archer.bwingBuyQty || 5}" style="width: 55px; background: #0f172a; border: 1px solid #38bdf8; color: #fff; text-align: center; border-radius: 4px; font-size: 11px; padding: 2px;">
                        </div>
                        <div style="font-size: 9.5px; color: #94a3b8; margin-top: 3px;">
                            มีในกระเป๋า: <b id="p-bwing-count" style="color: #38bdf8;">${clientData?.bwingCount ?? 0}</b> ใบ (ซื้อเติมส่วนต่างให้ครบ)
                        </div>
                    </div>

                    <div class="p-card" style="border-color: rgba(234, 179, 8, 0.4); background: rgba(234, 179, 8, 0.05);">
                        <span style="font-size: 10px; font-weight: bold; color: #eab308;">🎯 ตรวจสอบ & ดักจับการสวมใส่ (Equip Inspector)</span>
                        <div style="font-size: 9.5px; color: #94a3b8; margin: 2px 0 4px 0; line-height: 1.3;">
                            กดปุ่มด้านล่าง แล้วดับเบิลคลิกสวมใส่ "ลูกธนู" ในเกม เพื่อจับ Packet ของแท้
                        </div>
                        <button class="p-btn" id="p-btn-sniff-equip" style="background: #eab308; color: #000; font-size: 10px; padding: 4px;">🎯 เริ่มดักจับ Packet สวมใส่ (Sniff)</button>
                        <div id="p-sniffer-result" style="display: none; margin-top: 4px; padding: 4px; background: rgba(0,0,0,0.5); border-radius: 4px; border: 1px dashed rgba(234, 179, 8, 0.4);"></div>

                        <button class="p-btn" id="p-btn-equip-bow-arrow" style="background: #10b981; color: #fff; font-size: 11px; padding: 6px; margin-top: 6px; font-weight: bold; border-radius: 4px; border: 1px solid #059669; width: 100%; cursor: pointer;">🏹 สวมใส่คันธนู & ลูกธนูทันที (Equip Bow & Arrow)</button>

                        <label class="p-check-box" style="color: #94a3b8; margin-top: 5px;">
                            <input type="checkbox" id="p-archer-auto-equip" ${archer.autoEquipArrow ? "checked" : ""}>
                            <span style="font-size: 9.5px;">สวมใส่คันธนู & ลูกธนูอัตโนมัติ (Auto-Equip Bow & Arrow)</span>
                        </label>
                    </div>
                </div>

                <!-- TAB 3: BUFF POTIONS -->
                <div class="p-tab-pane" id="p-tab-potion">
                    <div class="p-card" style="border-color: rgba(245, 158, 11, 0.3); background: rgba(245, 158, 11, 0.06); padding: 8px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span style="font-weight: bold; color: #fbbf24; font-size: 11px;">🧪 ตั้งค่ายาบัพ (Buff Potions)</span>
                            <button class="p-btn-sync-potion-game" id="p-btn-sync-potion-game" style="background: linear-gradient(135deg, #10b981, #059669); color: #fff; border: 1px solid #34d399; border-radius: 4px; font-size: 9.5px; cursor: pointer; padding: 2px 7px; font-weight: bold;">🔄 ซิงก์เข้าเกม</button>
                        </div>
                        <div style="font-size: 9.5px; color: #94a3b8; line-height: 1.3;">
                            ติ๊กถูกเพื่อเปิดใช้ในระบบต่อสู้อัตโนมัติ และกำหนดจำนวนพกติดตัวเพื่อซื้อเติมเมื่อเข้าเมือง
                        </div>
                    </div>

                    <!-- Concentration Potion (90306) -->
                    <div class="p-card" style="border-color: rgba(234, 179, 8, 0.3); background: rgba(15, 23, 42, 0.6); padding: 6px 8px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 20px;">🧪</span>
                            <div style="flex: 1;">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span style="font-weight: bold; color: #facc15; font-size: 11px;">Concentration Potion</span>
                                    <span style="font-size: 9px; color: #94a3b8;">Lv.1+ (ASPD +)</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
                                    <span style="font-size: 9.5px; color: #94a3b8;">มีในกระเป๋า: <b id="p-potion-count-90306" style="color: #22c55e;">${potionCounts[90306] ?? 0}</b> ขวด</span>
                                    <span style="font-size: 9px; color: #64748b;">ID: 90306</span>
                                </div>
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.08);">
                            <label class="p-check-box" style="color: #cbd5e1; margin: 0; font-size: 10px;">
                                <input type="checkbox" id="p-potion-enable-90306" ${clientData?.buffPotionConfig?.[90306]?.enabled ? 'checked' : ''}>
                                <b>เปิดใช้ต่อสู้อัตโนมัติ & ซื้อเติม</b>
                            </label>
                            <div style="display: flex; align-items: center; gap: 4px;">
                                <span style="font-size: 9.5px; color: #94a3b8;">พกติดตัว:</span>
                                <input type="number" id="p-potion-qty-90306" min="0" max="999" value="${clientData?.buffPotionConfig?.[90306]?.targetQty ?? 10}" style="width: 48px; background: #0f172a; border: 1px solid #eab308; color: #fff; text-align: center; border-radius: 4px; font-size: 11px; padding: 2px;">
                            </div>
                        </div>
                    </div>

                    <!-- Awakening Potion (90307) -->
                    <div class="p-card" style="border-color: rgba(249, 115, 22, 0.3); background: rgba(15, 23, 42, 0.6); padding: 6px 8px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 20px;">🧪</span>
                            <div style="flex: 1;">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span style="font-weight: bold; color: #fb923c; font-size: 11px;">Awakening Potion</span>
                                    <span style="font-size: 9px; color: #94a3b8;">Lv.40+ (ASPD ++)</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
                                    <span style="font-size: 9.5px; color: #94a3b8;">มีในกระเป๋า: <b id="p-potion-count-90307" style="color: #22c55e;">${potionCounts[90307] ?? 0}</b> ขวด</span>
                                    <span style="font-size: 9px; color: #64748b;">ID: 90307</span>
                                </div>
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.08);">
                            <label class="p-check-box" style="color: #cbd5e1; margin: 0; font-size: 10px;">
                                <input type="checkbox" id="p-potion-enable-90307" ${clientData?.buffPotionConfig?.[90307]?.enabled ? 'checked' : ''}>
                                <b>เปิดใช้ต่อสู้อัตโนมัติ & ซื้อเติม</b>
                            </label>
                            <div style="display: flex; align-items: center; gap: 4px;">
                                <span style="font-size: 9.5px; color: #94a3b8;">พกติดตัว:</span>
                                <input type="number" id="p-potion-qty-90307" min="0" max="999" value="${clientData?.buffPotionConfig?.[90307]?.targetQty ?? 10}" style="width: 48px; background: #0f172a; border: 1px solid #f97316; color: #fff; text-align: center; border-radius: 4px; font-size: 11px; padding: 2px;">
                            </div>
                        </div>
                    </div>

                    <!-- Berserk Potion (90308) -->
                    <div class="p-card" style="border-color: rgba(239, 68, 68, 0.3); background: rgba(15, 23, 42, 0.6); padding: 6px 8px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 20px;">🧪</span>
                            <div style="flex: 1;">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span style="font-weight: bold; color: #f87171; font-size: 11px;">Berserk Potion</span>
                                    <span style="font-size: 9px; color: #94a3b8;">Lv.85+ (ASPD +++)</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
                                    <span style="font-size: 9.5px; color: #94a3b8;">มีในกระเป๋า: <b id="p-potion-count-90308" style="color: #22c55e;">${potionCounts[90308] ?? 0}</b> ขวด</span>
                                    <span style="font-size: 9px; color: #64748b;">ID: 90308</span>
                                </div>
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.08);">
                            <label class="p-check-box" style="color: #cbd5e1; margin: 0; font-size: 10px;">
                                <input type="checkbox" id="p-potion-enable-90308" ${clientData?.buffPotionConfig?.[90308]?.enabled ? 'checked' : ''}>
                                <b>เปิดใช้ต่อสู้อัตโนมัติ & ซื้อเติม</b>
                            </label>
                            <div style="display: flex; align-items: center; gap: 4px;">
                                <span style="font-size: 9.5px; color: #94a3b8;">พกติดตัว:</span>
                                <input type="number" id="p-potion-qty-90308" min="0" max="999" value="${clientData?.buffPotionConfig?.[90308]?.targetQty ?? 10}" style="width: 48px; background: #0f172a; border: 1px solid #ef4444; color: #fff; text-align: center; border-radius: 4px; font-size: 11px; padding: 2px;">
                            </div>
                        </div>
                    </div>

                    <div style="display: flex; gap: 4px; margin-top: 4px;">
                        <button class="p-btn p-btn-buy-potion-now" id="p-btn-buy-potion-now" style="background: linear-gradient(135deg, #0284c7, #0369a1); color: #fff; font-size: 10px; padding: 5px; font-weight: bold; border-radius: 4px; border: 1px solid #38bdf8; width: 100%; cursor: pointer;">🛒 ทดสอบซื้อเติมยาบัพทันที (เมื่ออยู่ในร้านค้า)</button>
                    </div>

                    <div style="font-size: 9px; color: #64748b; line-height: 1.3; margin-top: 2px; text-align: center;">
                        💡 ทุกครั้งที่ตัวละครกลับมาซื้อลูกธนูในเมือง บอทจะตรวจนับยาในกระเป๋าและซื้อเติมส่วนต่างให้อัตโนมัติ
                    </div>
                </div>

                <!-- TAB 4: AUTO-SELL & WHITELIST -->
                <div class="p-tab-pane" id="p-tab-sell">
                    <!-- Weight Check Card -->
                    <div class="p-card" style="border-color: rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.05); margin-bottom: 6px;">
                        <label class="p-check-box" style="color: #f59e0b;">
                            <input type="checkbox" id="p-weight-check-enabled" ${sell.weightCheckEnabled ? 'checked' : ''}>
                            <b>⚖️ ตรวจสอบน้ำหนักเกิน (Weight Return)</b>
                        </label>
                        <div class="p-row" style="margin-top: 4px;">
                            <span style="font-size: 10px; color: #cbd5e1;">วาร์ปกลับไปขายเมื่อเกิน (%):</span>
                            <div style="display: flex; align-items: center; gap: 4px;">
                                <input type="number" id="p-weight-threshold" min="10" max="95" value="${sell.weightThreshold || 80}" style="width: 48px; background: #0f172a; border: 1px solid #f59e0b; color: #fff; text-align: center; border-radius: 4px; font-size: 11px; padding: 2px;">
                                <span style="font-size: 10px; color: #94a3b8;">%</span>
                            </div>
                        </div>
                        <div id="p-weight-hud-display" style="font-size: 9.5px; color: #94a3b8; margin-top: 3px; display: flex; justify-content: space-between; align-items: center;">
                            <span>น้ำหนัก: <span id="p-cur-weight-val" style="color: #00ffcc; font-weight: bold;">${escapeHTML(clientData?.state?.weight || '-- / --')}</span></span>
                            <button id="p-btn-refresh-weight" style="background: #0284c7; color: white; border: none; padding: 2px 7px; border-radius: 4px; font-size: 9px; cursor: pointer; font-weight: bold; transition: all 0.2s ease;">🔄 จัดเรียง & อัปเดต</button>
                        </div>
                    </div>

                    <!-- Shortcut to Market Auto-Sell -->
                    <div style="background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.35); border-radius: 6px; padding: 5px 8px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-size: 10px; font-weight: bold; color: #c084fc;">🏷️ ต้องการตั้งขายที่ตลาดกลาง (Market)?</div>
                            <div style="font-size: 8.5px; color: #94a3b8;">แท็บนี้สำหรับขายขยะ NPC</div>
                        </div>
                        <button type="button" id="p-btn-goto-market-autosell" style="background: linear-gradient(135deg, #7c3aed, #9333ea); color: #fff; border: 1px solid #c084fc; padding: 3px 8px; border-radius: 4px; font-size: 9.5px; font-weight: bold; cursor: pointer; white-space: nowrap;">
                            ไปที่ Auto Sell ตลาด ➔
                        </button>
                    </div>

                    <label class="p-check-box" style="color: #facc15;">
                        <input type="checkbox" id="p-sell-enabled" ${sell.enabled ? "checked" : ""}>
                        <b>เปิดระบบ Auto-Sell คัดกรองอัตโนมัติ (ขายขยะ NPC)</b>
                    </label>

                    <!-- Category Rarity Card -->
                    <div class="p-card" style="border-color: rgba(56, 189, 248, 0.35); background: rgba(15, 23, 42, 0.7); padding: 6px; display: flex; flex-direction: column; gap: 4px;">
                        <div style="font-size: 10px; font-weight: bold; color: #38bdf8; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(56, 189, 248, 0.2); padding-bottom: 3px; margin-bottom: 1px;">
                            <span>🗂️ แยกขายตามระดับและประเภท</span>
                            <span style="font-size: 8.5px; color: #94a3b8; font-weight: normal;">ระดับไม่เกินที่เลือก</span>
                        </div>

                        <!-- 1. อาวุธ -->
                        <div class="p-row">
                            <span style="font-size: 10px; color: #e2e8f0; font-weight: 500;">⚔️ อาวุธ:</span>
                            <select id="p-sell-rarity-weap" class="p-select" style="width: 142px; padding: 2px 4px; font-size: 9.5px; background: #0b1329; border: 1px solid rgba(56, 189, 248, 0.35);">
                                <option value="none" ${(sell.weaponRarity || 'rare') === 'none' ? "selected" : ""}>❌ ไม่ขาย</option>
                                <option value="normal" ${(sell.weaponRarity || 'rare') === 'normal' ? "selected" : ""}>⚪ ขาวเท่านั้น (0 Opt)</option>
                                <option value="good" ${(sell.weaponRarity || 'rare') === 'good' ? "selected" : ""}>🟢 ดี (เขียวลงไป)</option>
                                <option value="rare" ${(sell.weaponRarity || 'rare') === 'rare' ? "selected" : ""}>🔵 หายาก (ฟ้าลงไป)</option>
                                <option value="epic" ${(sell.weaponRarity || 'rare') === 'epic' ? "selected" : ""}>🟣 มหากาพย์ (ม่วงลงไป)</option>
                            </select>
                        </div>

                        <!-- 2. ชุดเกราะ -->
                        <div class="p-row">
                            <span style="font-size: 10px; color: #e2e8f0; font-weight: 500;">🛡️ ชุดเกราะ:</span>
                            <select id="p-sell-rarity-armor" class="p-select" style="width: 142px; padding: 2px 4px; font-size: 9.5px; background: #0b1329; border: 1px solid rgba(56, 189, 248, 0.35);">
                                <option value="none" ${(sell.armorRarity || 'good') === 'none' ? "selected" : ""}>❌ ไม่ขาย</option>
                                <option value="normal" ${(sell.armorRarity || 'good') === 'normal' ? "selected" : ""}>⚪ ขาวเท่านั้น (0 Opt)</option>
                                <option value="good" ${(sell.armorRarity || 'good') === 'good' ? "selected" : ""}>🟢 ดี (เขียวลงไป)</option>
                                <option value="rare" ${(sell.armorRarity || 'good') === 'rare' ? "selected" : ""}>🔵 หายาก (ฟ้าลงไป)</option>
                                <option value="epic" ${(sell.armorRarity || 'good') === 'epic' ? "selected" : ""}>🟣 มหากาพย์ (ม่วงลงไป)</option>
                            </select>
                        </div>

                        <!-- 3. ประดับ/เจม -->
                        <div class="p-row">
                            <span style="font-size: 10px; color: #e2e8f0; font-weight: 500;">💍 ประดับ/เจม:</span>
                            <select id="p-sell-rarity-acc" class="p-select" style="width: 142px; padding: 2px 4px; font-size: 9.5px; background: #0b1329; border: 1px solid rgba(56, 189, 248, 0.35);">
                                <option value="none" ${sell.accRarity === 'none' ? 'selected' : ''}>❌ ไม่ขาย</option>
                                <option value="normal" ${sell.accRarity === 'normal' ? 'selected' : ''}>⚪ ขาวเท่านั้น (0 Opt)</option>
                                <option value="good" ${sell.accRarity === 'good' ? 'selected' : ''}>🟢 ดี (เขียวลงไป)</option>
                                <option value="rare" ${sell.accRarity === 'rare' ? 'selected' : ''}>🔵 หายาก (ฟ้าลงไป)</option>
                                <option value="epic" ${sell.accRarity === 'epic' ? 'selected' : ''}>🟣 มหากาพย์ (ม่วงลงไป)</option>
                            </select>
                        </div>

                        <!-- 4. วัตถุดิบ -->
                        <div class="p-row">
                            <span style="font-size: 10px; color: #e2e8f0; font-weight: 500;">🌿 วัตถุดิบ:</span>
                            <select id="p-sell-rarity-mat" class="p-select" style="width: 142px; padding: 2px 4px; font-size: 9.5px; background: #0b1329; border: 1px solid rgba(56, 189, 248, 0.35);">
                                <option value="all" ${sell.sellMaterials && sell.materialMode !== 'common' ? 'selected' : ''}>🧺 ขายขยะทั้งหมด (รวมหายาก)</option>
                                <option value="common" ${sell.sellMaterials && sell.materialMode === 'common' ? 'selected' : ''}>🧺 เฉพาะขยะธรรมดา</option>
                                <option value="none" ${!sell.sellMaterials ? 'selected' : ''}>❌ ไม่ขาย</option>
                            </select>
                        </div>

                        <!-- 5. แร่ตีบวก -->
                        <div class="p-row" title="Phracon / Elunium / Oridecon ฯลฯ — ถ้าเลือกขาย จะขายเฉพาะชนิดที่ไม่ได้อยู่ใน Whitelist">
                            <span style="font-size: 10px; color: #e2e8f0; font-weight: 500;">⛏️ แร่ตีบวก:</span>
                            <select id="p-sell-refine-ores" class="p-select" style="width: 142px; padding: 2px 4px; font-size: 9.5px; background: #0b1329; border: 1px solid rgba(56, 189, 248, 0.35);">
                                <option value="keep" ${!sell.sellRefineOres ? 'selected' : ''}>🔒 เก็บทั้งหมด</option>
                                <option value="unlisted" ${sell.sellRefineOres ? 'selected' : ''}>💰 ขายที่ไม่อยู่ใน Whitelist</option>
                            </select>
                        </div>
                    </div>

                    <!-- Safety Locks Card -->
                    <div class="p-card" style="border-color: rgba(239, 68, 68, 0.35); background: rgba(15, 23, 42, 0.65); padding: 5px; display: flex; flex-direction: column; gap: 4px;">
                        <div style="font-size: 10px; font-weight: bold; color: #f87171; border-bottom: 1px solid rgba(239, 68, 68, 0.2); padding-bottom: 2px;">
                            🔒 ล็อกความปลอดภัย (ห้ามขายเด็ดขาด)
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                            <label class="p-check-box" style="color: #ef4444;" title="ห้ามขายของที่ผ่านการตีบวก (+1 ขึ้นไป)">
                                <input type="checkbox" id="p-sell-keep-refined" ${sell.keepRefined !== false ? "checked" : ""}>
                                <span>🔨 ล็อกของตีบวก</span>
                            </label>
                            <label class="p-check-box" style="color: #c084fc;" title="ห้ามขายของที่มี Option สุ่ม">
                                <input type="checkbox" id="p-sell-keep-special" ${sell.keepSpecial ? "checked" : ""}>
                                <span>🔒 ล็อกของมี Option</span>
                            </label>
                        </div>
                        <label class="p-check-box" style="color: #38bdf8;" title="ห้ามขายของที่มีรูใส่การ์ด [1-4]">
                            <input type="checkbox" id="p-sell-keep-sockets" ${sell.keepSockets ? "checked" : ""}>
                            <span>🕳️ ล็อกของมีรูการ์ด [1-4]</span>
                        </label>
                    </div>

                    <!-- Whitelist Card -->
                    <div>
                        <span style="font-size: 10px; color: #94a3b8; display: block; margin-bottom: 2px;">🛡️ Whitelist ห้ามขาย (ชื่อไอเทมคั่นด้วย ,):</span>
                        <textarea id="p-sell-whitelist" style="width: 100%; box-sizing: border-box; background: #0f172a; border: 1px solid rgba(234, 179, 8, 0.4); color: #fff; border-radius: 4px; font-size: 9.5px; height: 34px; resize: vertical; padding: 3px;">${escapeHTML(sell.whitelist || "")}</textarea>
                    </div>

                    <!-- Smart Stat & Affix Filter Card (Whitelist Sub-Filter) -->
                    <div class="p-card" id="p-sell-stats-filter-card" style="border-color: rgba(168, 85, 247, 0.45); background: rgba(15, 23, 42, 0.75); padding: 6px; margin-top: 5px; display: flex; flex-direction: column; gap: 5px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(168, 85, 247, 0.25); padding-bottom: 3px;">
                            <label class="p-check-box" style="color: #c084fc; font-size: 10px; margin: 0; font-weight: bold;" title="คัดกรองออฟชั่นสุ่มของไอเทมใน Whitelist เก็บเฉพาะชิ้นที่ออฟชั่นสวย">
                                <input type="checkbox" id="p-statfilter-toggle" ${(sell.statsFilter?.enabled) ? 'checked' : ''}>
                                <span>⚙️ กรองออฟชั่น Whitelist (Stat Filter)</span>
                            </label>
                            <span style="font-size: 8.5px; color: #a855f7; font-weight: 500;">เฉพาะ Random Options</span>
                        </div>

                        <!-- Target Equipment Types & Gem Protection -->
                        <div style="display: flex; flex-direction: column; gap: 3px; background: rgba(0,0,0,0.25); padding: 4px 6px; border-radius: 4px;">
                            <span style="font-size: 9px; color: #94a3b8; font-weight: 600;">หมวดที่ใช้ตัวกรองนี้:</span>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                                <label class="p-check-box" style="font-size: 9px; color: #e2e8f0; margin: 0;">
                                    <input type="checkbox" id="p-statfilter-weap" ${(sell.statsFilter?.filterWeapons !== false) ? 'checked' : ''}>
                                    <span>⚔️ อาวุธ</span>
                                </label>
                                <label class="p-check-box" style="font-size: 9px; color: #e2e8f0; margin: 0;">
                                    <input type="checkbox" id="p-statfilter-armor" ${(sell.statsFilter?.filterArmors !== false) ? 'checked' : ''}>
                                    <span>🛡️ ชุดเกราะ</span>
                                </label>
                                <label class="p-check-box" style="font-size: 9px; color: #e2e8f0; margin: 0;">
                                    <input type="checkbox" id="p-statfilter-acc" ${(sell.statsFilter?.filterAccessories !== false) ? 'checked' : ''}>
                                    <span>💍 เครื่องประดับ</span>
                                </label>
                                <label class="p-check-box" style="font-size: 9px; color: #38bdf8; margin: 0; font-weight: 600;" title="ล็อกคุ้มครองเจมสกิลทุกเม็ด ไม่ให้ถูกขายทิ้งเด็ดขาด">
                                    <input type="checkbox" id="p-statfilter-protect-gems" ${(sell.statsFilter?.protectGems !== false) ? 'checked' : ''}>
                                    <span>💎 ล็อกเจมสกิล (ห้ามขาย)</span>
                                </label>
                            </div>
                        </div>

                        <!-- Options Count Required -->
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 2px;">
                            <span style="font-size: 9.5px; color: #cbd5e1; font-weight: 500;">🎯 Stats Require (ขั้นต่ำ):</span>
                            <div style="display: flex; align-items: center; gap: 4px;">
                                <input type="number" id="p-statfilter-min-opts" min="1" max="5" value="${sell.statsFilter?.minOptions || 2}" style="width: 42px; background: #0b1329; border: 1px solid rgba(168, 85, 247, 0.4); color: #fff; border-radius: 3px; font-size: 10px; padding: 1px 3px; text-align: center;">
                                <span style="font-size: 9px; color: #94a3b8;">ออฟขึ้นไป</span>
                            </div>
                        </div>

                        <!-- Main Stats List -->
                        <div style="background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 4px; padding: 4px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                                <span style="font-size: 9.5px; color: #38bdf8; font-weight: bold;">🔹 Main Stats (STR, AGI, VIT, INT, DEX, LUK)</span>
                                <button type="button" class="p-btn-add-mainstat" style="background: #0284c7; color: #fff; border: none; border-radius: 3px; font-size: 8.5px; font-weight: bold; padding: 2px 7px; cursor: pointer;">+ เพิ่ม</button>
                            </div>
                            <div class="p-statfilter-main-list" style="display: flex; flex-direction: column; gap: 3px;"></div>
                        </div>

                        <!-- Sub Stats List -->
                        <div style="background: rgba(234, 179, 8, 0.05); border: 1px solid rgba(234, 179, 8, 0.25); border-radius: 4px; padding: 4px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                                <span style="font-size: 9.5px; color: #facc15; font-weight: bold;">🔸 Sub Stats (ATK%, MATK%, CRIT, ASPD, ฯลฯ)</span>
                                <button type="button" class="p-btn-add-substat" style="background: #d97706; color: #fff; border: none; border-radius: 3px; font-size: 8.5px; font-weight: bold; padding: 2px 7px; cursor: pointer;">+ เพิ่ม</button>
                            </div>
                            <div class="p-statfilter-sub-list" style="display: flex; flex-direction: column; gap: 3px;"></div>
                        </div>
                    </div>

                    <!-- Storage deposit Card -->
                    <div class="p-card" id="p-store-card" style="border-color: rgba(56, 189, 248, 0.4); background: rgba(15, 23, 42, 0.75); padding: 6px; margin-top: 5px; display: flex; flex-direction: column; gap: 4px;">
                        <label class="p-check-box" style="color: #38bdf8; font-weight: bold; margin: 0;" title="หลังขายของในเมือง ฝากของที่ไม่ได้ขาย และไม่อยู่ใน Whitelist เข้าคลังเก็บของของบัญชี">
                            <input type="checkbox" id="p-store-enabled" ${sell.storeEnabled ? 'checked' : ''}>
                            <span>📦 ฝากของเข้าคลังหลังขาย (ที่ไม่อยู่ใน Whitelist)</span>
                        </label>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                            <label class="p-check-box" style="font-size: 9.5px; margin: 0;"><input type="checkbox" id="p-store-weapon" ${sell.storeWeapon !== false ? 'checked' : ''}><span>⚔️ อาวุธ</span></label>
                            <label class="p-check-box" style="font-size: 9.5px; margin: 0;"><input type="checkbox" id="p-store-armor" ${sell.storeArmor !== false ? 'checked' : ''}><span>🛡️ ชุดเกราะ</span></label>
                            <label class="p-check-box" style="font-size: 9.5px; margin: 0;"><input type="checkbox" id="p-store-acc" ${sell.storeAcc !== false ? 'checked' : ''}><span>💍 ประดับ/เจม</span></label>
                            <label class="p-check-box" style="font-size: 9.5px; margin: 0;"><input type="checkbox" id="p-store-refine" ${sell.storeRefine !== false ? 'checked' : ''}><span>💎 แร่ตีบวก</span></label>
                        </div>
                        <label class="p-check-box" style="font-size: 9.5px; color: #fbbf24; margin: 0;" title="ของที่กดล็อคในกระเป๋าไว้ จะเก็บติดตัวไว้ ไม่ฝาก">
                            <input type="checkbox" id="p-store-skip-locked" ${sell.storeSkipLocked !== false ? 'checked' : ''}>
                            <span>🔐 ไม่ฝากของที่ล็อคไว้</span>
                        </label>
                        <span class="p-hint" style="font-size: 8.5px; color: #94a3b8;">ไม่ฝาก: ของใช้, ลูกธนู, ของใน Whitelist, ของที่เซ็ตอุปกรณ์ยังต้องใช้ · คลังใช้ร่วมกันทั้งบัญชี · มีค่าเปิดคลังตามเกม</span>
                        <button type="button" class="p-btn" id="p-btn-store-now" style="background: #0369a1; color: #fff; font-weight: bold;">📦 ฝากเข้าคลังตอนนี้ (ต้องอยู่ในเมืองหลวง)</button>
                    </div>

                    <button class="p-btn" id="p-btn-test-sell-only" style="background: #ca8a04; color: #fff; font-weight: bold; margin-top: 2px;">🧺 ทดสอบขายของในร้านค้า (Sell Test)</button>
                </div>

                <!-- TAB 4: MARKET & STAT SNIPER -->
                <div class="p-tab-pane" id="p-tab-market">
                    <!-- Sub-Navigation: Auto Sell vs Sniper -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 6px; background: rgba(0,0,0,0.4); padding: 2px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08);">
                        <button id="p-subtab-btn-autosell" onclick="window.switchMarketSubTab('autosell')"
                            style="padding: 4px; border-radius: 4px; font-size: 10px; font-weight: bold; cursor: pointer; border: none; background: #9333ea; color: #fff; transition: all 0.2s;">
                            🏷️ Auto Sell ตั้งขาย (<span id="p-subtab-autosell-count">${(autosell.rules || []).length}</span>)
                        </button>
                        <button id="p-subtab-btn-sniper" onclick="window.switchMarketSubTab('sniper')"
                            style="padding: 4px; border-radius: 4px; font-size: 10px; font-weight: bold; cursor: pointer; border: none; background: transparent; color: #94a3b8; transition: all 0.2s;">
                            🎯 Sniper ค้นหาซื้อ
                        </button>
                    </div>

                    <!-- VIEW 1: AUTO SELL TO MARKET -->
                    <div id="p-market-view-autosell" style="display: block;">
                        <!-- Auto Sell Main Card -->
                        <div class="p-card" style="border-color: rgba(168, 85, 247, 0.45); background: rgba(168, 85, 247, 0.08); padding: 6px; margin-bottom: 5px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(168, 85, 247, 0.25); padding-bottom: 3px; margin-bottom: 4px;">
                                <label class="p-check-box" style="color: #c084fc; margin: 0; font-size: 10.5px;">
                                    <input type="checkbox" id="p-autosell-toggle-hud" ${autosell.enabled ? "checked" : ""} onchange="window.toggleAutoMarketSell(this.checked)">
                                    <b>เปิดใช้งาน Auto Sell</b>
                                </label>
                                <span id="p-autosell-quota-badge-hud" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); padding: 0 4px; border-radius: 3px; font-size: 9px; font-weight: bold;">
                                    โควตา: ${clientData?.myMarketActiveCount ?? 0}/10
                                </span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 8.5px; color: #d8b4fe; margin-bottom: 4px;">
                                <span>⚖️ กลยุทธ์: <b>ราคากลางสมดุล (Market Median)</b></span>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                                <button onclick="window.addAutoMarketSellRule();" style="background: linear-gradient(135deg, #10b981, #059669); color: #fff; border: 1px solid #34d399; padding: 4px; border-radius: 4px; font-size: 10px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 3px;">
                                    <span>➕</span> <span>เพิ่มรายการลงขาย</span>
                                </button>
                                <button onclick="window.runAutoMarketSellCycle(true);" style="background: #0284c7; color: #fff; border: none; padding: 4px; border-radius: 4px; font-size: 10px; font-weight: bold; cursor: pointer;" title="ตรวจสอบกระเป๋าและประเมินราคาทันที">
                                    ⚡ ตรวจสอบทันที
                                </button>
                            </div>
                        </div>

                        <!-- Rules List in HUD -->
                        <div id="p-autosell-hud-rules-container" style="max-height: 250px; overflow-y: auto;">
                            ${(typeof window.renderAutoSellHudRulesHtml === 'function') ? window.renderAutoSellHudRulesHtml() : ''}
                        </div>

                        <!-- Open Full Modal Button -->
                        <div style="margin-top: 5px;">
                            <button onclick="window.showDataViewerModal('market');" style="width: 100%; background: #1e293b; color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); padding: 4px; border-radius: 4px; font-size: 9.5px; font-weight: bold; cursor: pointer;">
                                🔎 จัดการรายการแบบตารางเต็มจอ (Data Hub)
                            </button>
                        </div>
                    </div>

                    <!-- VIEW 2: SNIPER & SEARCH (Original) -->
                    <div id="p-market-view-sniper" style="display: none;">
                        <!-- Quick Search Card -->
                        <div class="p-card" style="border-color: rgba(56, 189, 248, 0.4); background: rgba(56, 189, 248, 0.05);">
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(56, 189, 248, 0.2); padding-bottom: 2px; margin-bottom: 3px;">
                                <span style="font-size: 10px; font-weight: bold; color: #38bdf8;">🔍 ค้นหาไอเทมตลาดกลาง</span>
                                <span id="p-mk-server-count-badge" style="font-size: 8.5px; color: #94a3b8;">Server Sync</span>
                            </div>
                            <div>
                                <input type="text" id="p-mk-search-query" value="${marketFilter.q || ''}" placeholder="ค้นหาชื่อไอเทม (เช่น Bow, Ring, Dagger)..." style="width: 100%; box-sizing: border-box; background: #0f172a; border: 1px solid rgba(56, 189, 248, 0.35); color: #fff; border-radius: 4px; font-size: 10.5px; padding: 2px 6px;">
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 3px;">
                                <select id="p-mk-cat-select" class="p-select" style="font-size: 10px; padding: 2px 4px;">
                                    <option value="" ${marketFilter.category === '' ? 'selected' : ''}>ทุกหมวดหมู่</option>
                                    <option value="Weapon" ${marketFilter.category === 'Weapon' ? 'selected' : ''}>⚔️ อาวุธ</option>
                                    <option value="Armor" ${marketFilter.category === 'Armor' ? 'selected' : ''}>🛡️ ชุดเกราะ</option>
                                    <option value="Accessory" ${marketFilter.category === 'Accessory' ? 'selected' : ''}>💍 ประดับ/เจม</option>
                                    <option value="Card" ${marketFilter.category === 'Card' ? 'selected' : ''}>🎴 การ์ด</option>
                                    <option value="Ammo" ${marketFilter.category === 'Ammo' ? 'selected' : ''}>🏹 ลูกธนู</option>
                                </select>
                                <select id="p-mk-kind-select" class="p-select" style="font-size: 10px; padding: 2px 4px;">
                                    <option value="" ${marketFilter.kind === '' ? 'selected' : ''}>ทุกประเภท</option>
                                    <option value="bow" ${marketFilter.kind === 'bow' ? 'selected' : ''}>ธนู (Bow)</option>
                                    <option value="dagger" ${marketFilter.kind === 'dagger' ? 'selected' : ''}>มีด (Dagger)</option>
                                    <option value="sword" ${marketFilter.kind === 'sword' ? 'selected' : ''}>ดาบ (Sword)</option>
                                    <option value="spear" ${marketFilter.kind === 'spear' ? 'selected' : ''}>หอก (Spear)</option>
                                    <option value="axe" ${marketFilter.kind === 'axe' ? 'selected' : ''}>ขวาน (Axe)</option>
                                    <option value="staff" ${marketFilter.kind === 'staff' ? 'selected' : ''}>คทา (Staff)</option>
                                    <option value="shield" ${marketFilter.kind === 'shield' ? 'selected' : ''}>โล่ (Shield)</option>
                                    <option value="armor" ${marketFilter.kind === 'armor' ? 'selected' : ''}>ชุดเกราะ (Armor)</option>
                                    <option value="boot" ${marketFilter.kind === 'boot' ? 'selected' : ''}>รองเท้า (Boots)</option>
                                    <option value="cape" ${marketFilter.kind === 'cape' ? 'selected' : ''}>ผ้าคลุม (Cape)</option>
                                    <option value="ring" ${marketFilter.kind === 'ring' ? 'selected' : ''}>แหวน (Ring)</option>
                                </select>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 3px;">
                                <div class="p-row">
                                    <span style="font-size: 9.5px; color: #cbd5e1;">ตีบวก ≥:</span>
                                    <input type="number" id="p-mk-min-refine" min="0" max="15" value="${marketFilter.minRefine || 0}" style="width: 42px; background: #0f172a; border: 1px solid #c084fc; color: #fff; text-align: center; border-radius: 4px; font-size: 10px; padding: 1px;">
                                </div>
                                <div class="p-row">
                                    <span style="font-size: 9.5px; color: #cbd5e1;">งบสูงสุด:</span>
                                    <input type="number" id="p-mk-max-price" value="${marketFilter.maxPrice || 0}" placeholder="0=ไม่จำกัด" style="width: 58px; background: #0f172a; border: 1px solid #00ffcc; color: #00ffcc; text-align: right; border-radius: 4px; font-size: 10px; padding: 1px;">
                                </div>
                            </div>
                        </div>

                        <!-- Deep Stat & Affix Filter Card -->
                        <div class="p-card" style="border-color: rgba(234, 179, 8, 0.4); background: rgba(234, 179, 8, 0.05);">
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(234, 179, 8, 0.2); padding-bottom: 2px;">
                                <span style="font-size: 10px; font-weight: bold; color: #f59e0b;">💎 ตัวกรอง Option (Stat Filter)</span>
                                <span style="font-size: 8.5px; color: #94a3b8;">ลึกถึง Option สุ่ม</span>
                            </div>
                            <!-- Option 1 -->
                            <div class="p-row" style="margin-top: 2px;">
                                <span style="font-size: 9.5px; color: #fde047;">Opt 1:</span>
                                <select id="p-mk-stat1-type" class="p-select" style="width: 120px; font-size: 9.5px; padding: 1px 3px;">
                                    
                                </select>
                                <input type="number" id="p-mk-stat1-min" value="${marketFilter.statMinVal1 || 1}" min="1" style="width: 38px; background: #0f172a; border: 1px solid #f59e0b; color: #fff; text-align: center; border-radius: 4px; font-size: 10px; padding: 1px;">
                            </div>
                            <!-- Option 2 -->
                            <div class="p-row">
                                <span style="font-size: 9.5px; color: #c084fc;">Opt 2:</span>
                                <select id="p-mk-stat2-type" class="p-select" style="width: 120px; font-size: 9.5px; padding: 1px 3px;">
                                    
                                </select>
                                <input type="number" id="p-mk-stat2-min" value="${marketFilter.statMinVal2 || 1}" min="1" style="width: 38px; background: #0f172a; border: 1px solid #c084fc; color: #fff; text-align: center; border-radius: 4px; font-size: 10px; padding: 1px;">
                            </div>
                            <div class="p-row">
                                <span style="font-size: 9px; color: #94a3b8;">เงื่อนไข:</span>
                                <select id="p-mk-stat-mode" class="p-select" style="width: 90px; font-size: 9px; padding: 1px 3px;">
                                    <option value="AND" ${marketFilter.statMatchMode === 'AND' ? 'selected' : ''}>AND (ครบทุก Opt)</option>
                                    <option value="OR" ${marketFilter.statMatchMode === 'OR' ? 'selected' : ''}>OR (อย่างน้อย 1 Opt)</option>
                                </select>
                            </div>
                        </div>

                        <!-- Sniper & Auto-Buy Card -->
                        <div class="p-card" style="border-color: rgba(168, 85, 247, 0.35); background: rgba(168, 85, 247, 0.05);">
                            <label class="p-check-box" style="color: #f59e0b;">
                                <input type="checkbox" id="p-mk-sniper-alert" ${marketFilter.sniperAlert ? 'checked' : ''}>
                                <b>🎯 เสียงเตือนเมื่อพบของตรงสเปค</b>
                            </label>
                            <label class="p-check-box" style="color: #4ade80; margin-top: 2px;">
                                <input type="checkbox" id="p-mk-auto-buy" ${marketFilter.autoBuy ? 'checked' : ''}>
                                <b>⚡ Auto-Buy Sniper (ซื้อทันทีเมื่อพบ)</b>
                            </label>
                        </div>

                        <!-- Action Buttons -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                            <button class="p-btn" id="p-btn-mk-search" style="background: #0284c7; color: #fff; font-size: 10.5px; padding: 5px;">🔍 ค้นหาตลาด</button>
                            <button class="p-btn" id="p-btn-mk-scan" style="background: #9333ea; color: #fff; font-size: 10.5px; padding: 5px;">⚡ สแกนทุกหน้า</button>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                            <button class="p-btn" id="p-btn-mk-open-modal" style="background: #0d9488; color: #fff; font-size: 10px; padding: 4px;">🔎 ตลาดเต็มจอ</button>
                            <button class="p-btn" id="p-btn-mk-copy-json" style="background: #334155; color: #38bdf8; font-size: 10px; padding: 4px; border: 1px solid rgba(56,189,248,0.3);">📋 Dump JSON</button>
                        </div>

                        <!-- Live Results Section -->
                        <div style="border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 4px;">
                            <div style="font-size: 10px; color: #38bdf8; font-weight: bold; display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>📦 รายการตรงสเปค (<span id="p-mk-result-count" style="color: #00ffcc;">0</span>)</span>
                                <span style="font-size: 9px; color: #94a3b8;">1-Click Buy</span>
                            </div>
                            <div id="p-mk-hud-results" style="max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px;">
                                <div style="text-align: center; color: #64748b; padding: 12px 6px; font-size: 10px;">
                                    ยังไม่มีผลการค้นหา<br/><span style="color: #475569;">กดปุ่ม '🔍 ค้นหาตลาด' เพื่อเริ่ม</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- TAB 5: SYSTEM & TOOLS -->
                <div class="p-tab-pane" id="p-tab-system">
                    <!-- Auto-Login & Account Card -->
                    <div class="p-card" style="border-color: rgba(168, 85, 247, 0.4); background: rgba(168, 85, 247, 0.06); margin-bottom: 6px;">
                        <label class="p-check-box" style="color: #c084fc;">
                            <input type="checkbox" id="p-auth-enabled" ${auth.enabled ? "checked" : ""}>
                            <b>🔐 เปิดระบบ Auto-Login (เข้าเกมอัตโนมัติ)</b>
                        </label>
                        <div style="font-size: 9.5px; color: #94a3b8; margin: 3px 0 6px 0; line-height: 1.3;">
                            เมื่อเกมหลุดหรือเด้งไปหน้า Login บอทจะกรอก ID/PS และเข้าเกมให้อัตโนมัติ
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <div class="p-row">
                                <span style="font-size: 10px; color: #cbd5e1;">ชื่อผู้ใช้ (ID):</span>
                                <input type="text" id="p-auth-user" value="${escapeHTML(auth.username || "")}" placeholder="ชื่อผู้ใช้ / ID" style="width: 130px; background: #0f172a; border: 1px solid rgba(192, 132, 252, 0.5); color: #fff; border-radius: 4px; font-size: 10.5px; padding: 2px 6px;">
                            </div>
                            <div class="p-row">
                                <span style="font-size: 10px; color: #cbd5e1;">รหัสผ่าน (PS):</span>
                                <div style="display: flex; align-items: center; gap: 3px;">
                                    <input type="password" id="p-auth-pass" value="" placeholder="${auth.hasPassword ? '•••••• (มีแล้ว)' : 'รหัสผ่าน'}" autocomplete="new-password" style="width: 105px; background: #0f172a; border: 1px solid rgba(192, 132, 252, 0.5); color: #fff; border-radius: 4px; font-size: 10.5px; padding: 2px 6px;">
                                    <button type="button" id="p-auth-toggle-pass" style="background: rgba(15, 23, 42, 0.8); border: 1px solid #64748b; color: #94a3b8; border-radius: 3px; font-size: 9px; padding: 2px 4px; cursor: pointer;" title="แสดง/ซ่อนรหัสผ่าน">👁️</button>
                                </div>
                            </div>
                            <div class="p-row">
                                <span style="font-size: 10px; color: #cbd5e1;">เลือกตัวละคร (Char):</span>
                                <input type="text" id="p-auth-char" value="${escapeHTML(auth.charName || "")}" placeholder="ชื่อตัวละคร (เว้นว่าง = ตัวแรก)" style="width: 130px; background: #0f172a; border: 1px solid rgba(192, 132, 252, 0.5); color: #fff; border-radius: 4px; font-size: 10.5px; padding: 2px 6px;">
                            </div>
                        </div>

                        <label class="p-check-box" style="color: #4ade80; margin-top: 6px;">
                            <input type="checkbox" id="p-auth-resume" ${auth.autoResumeBot ? "checked" : ""}>
                            <span style="font-size: 9.5px;">เริ่มทำงานบอทต่อทันทีเมื่อ Login สำเร็จ (Auto-Resume)</span>
                        </label>

                        <button class="p-btn" id="p-btn-test-login" style="background: #9333ea; color: #fff; font-size: 10.5px; padding: 5px; margin-top: 6px; font-weight: bold; border-radius: 4px; border: 1px solid #a855f7; width: 100%; cursor: pointer;">🔑 ทดสอบเข้าสู่ระบบทันที (Test Login)</button>
                    </div>

                    <div class="p-card" style="border-color: rgba(56, 189, 248, 0.3);">
                        <label class="p-check-box" style="color: #38bdf8;">
                            <input type="checkbox" id="p-shop-enabled" ${shop.enabled ? "checked" : ""}>
                            <b>เปิดระบบ Auto-Shop</b>
                        </label>
                        <div class="p-row" style="margin-top: 3px;">
                            <span>NPC Key:</span>
                            <input type="text" id="p-shop-npckey" value="${escapeHTML(shop.npcKey || "tools")}" style="width: 55px; background: #0f172a; border: 1px solid #38bdf8; color: #fff; text-align: center; border-radius: 4px; font-size: 11px; padding: 2px;">
                        </div>
                        <button class="p-btn" id="p-btn-test-shop" style="background: #f59e0b; color: #000; font-weight: bold; margin-top: 4px;">🛍️ ทดสอบ Routine ร้านค้า (Shop Routine)</button>
                    </div>

                    <div class="p-card" style="border-color: rgba(34, 197, 94, 0.45); background: rgba(34, 197, 94, 0.06);">
                        <div style="font-size: 10.5px; font-weight: bold; color: #4ade80; margin-bottom: 4px;">⚡ ประหยัดทรัพยากรขั้นสุด (Ultra-Low Spec)</div>
                        <label class="p-check-box" style="color: #86efac;">
                            <input type="checkbox" id="p-ultra-low-spec" ${clientData?.ultraLowSpecEnabled !== false ? "checked" : ""}>
                            <span><b>เปิดโหมดประหยัด GPU / RAM ขั้นสุด</b></span>
                        </label>
                        <div style="font-size: 9px; color: #94a3b8; margin-top: 3px; line-height: 1.35;">
                            • ตัดเอฟเฟกต์สกิล, พาร์ติเคิล, เงา, สไปรต์มอนสเตอร์/พื้นหลังแมพ และตัวเลขดาเมจลอย<br>
                            • ปิดแอนิเมชัน CSS ทั้งหน้าเกม (ลดภาระ GPU Compositor)<br>
                            • <b>ไม่ล็อก FPS และไม่พับจอ</b> (ป้องกันการ์ดจอไดรเวอร์ค้าง/หลุดฟาร์ม)
                        </div>
                    </div>

                    <div class="p-card" style="border-color: rgba(250, 204, 21, 0.35); background: rgba(250, 204, 21, 0.05);">
                        <div style="font-size: 10.5px; font-weight: bold; color: #facc15; margin-bottom: 4px;">🎮 ตั้งค่าอัตโนมัติใน Plan Script (Auto-Battle & Display)</div>
                        <label class="p-check-box" style="color: #fde047;">
                            <input type="checkbox" id="p-auto-config-char" ${clientData?.autoConfigCharEnabled !== false ? "checked" : ""}>
                            <span>ตั้งระยะล่า <b>ทั้งแมพ</b> + ติ๊ก Auto สกิล (เฉพาะตอนเปิด Plan Script)</span>
                        </label>
                        <label class="p-check-box" style="color: #fde047; margin-top: 4px;">
                            <input type="checkbox" id="p-auto-mute-display" ${clientData?.autoMuteDisplayEnabled !== false ? "checked" : ""}>
                            <span>ปิดประกาศบนจอ & ปิดหน้าต่างข่าวสาร (เฉพาะตอนเปิด Plan Script)</span>
                        </label>
                        <button class="p-btn" id="p-btn-apply-autoconfig" style="background: linear-gradient(135deg, #ca8a04, #eab308); color: #000; font-size: 10px; font-weight: bold; padding: 5px; margin-top: 6px;">⚡ สั่งตั้งค่าระยะล่า + สกิล + ปิดประกาศเดี๋ยวนี้</button>
                    </div>
                    
                    <div class="p-card" style="border-color: rgba(168, 85, 247, 0.35); background: rgba(168, 85, 247, 0.05);">
                        <span style="font-size: 10.5px; font-weight: bold; color: #c084fc;">💾 สำรอง & ถ่ายโอนการตั้งค่า (Settings & Config)</span>
                        <div style="font-size: 9px; color: #94a3b8; margin: 2px 0 5px 0;">
                            ส่งออกหรือนำเข้าการตั้งค่าทั้งหมด (ยกเว้น ID / Password เพื่อความปลอดภัย)
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                            <button class="p-btn" id="p-btn-export-cfg" style="background: linear-gradient(135deg, #7c3aed, #9333ea); color: #fff; font-size: 10px; font-weight: bold; padding: 5px;">📤 Export Config (JSON)</button>
                            <button class="p-btn" id="p-btn-import-cfg" style="background: #0284c7; color: #fff; font-size: 10px; font-weight: bold; padding: 5px;">📥 Import Config (นำเข้า)</button>
                        </div>
                    </div>
                    <div class="p-card" style="border-color: rgba(34, 197, 94, 0.3);">
                        <span style="font-size: 10.5px; font-weight: bold; color: #22c55e;">📥 Data Dumper (ดึง/ส่งออกข้อมูล)</span>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 2px;">
                            <button class="p-btn" id="p-btn-dump-map" style="background: #0284c7; color: #fff; padding: 4px; font-size: 10px;">🗺️ Dump แมพ (25 โซน)</button>
                            <button class="p-btn" id="p-btn-dump-item" style="background: #7c3aed; color: #fff; padding: 4px; font-size: 10px;">📦 Dump ไอเทม</button>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 3px;">
                            <button class="p-btn" id="p-btn-dump-packets" style="background: #e11d48; color: #fff; padding: 4px; font-size: 10px;">📜 Dump Packet</button>
                            <button class="p-btn" id="p-btn-dump-state" style="background: #059669; color: #fff; padding: 4px; font-size: 10px;">🕹️ Dump State</button>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 3px;">
                            <button class="p-btn" id="p-btn-dump-market" style="background: #ec4899; color: #fff; font-weight: bold; padding: 4px; font-size: 10px;">🛒 Dump ตลาดกลาง</button>
                            <button class="p-btn" id="p-btn-dump-weight" style="background: #f59e0b; color: #000; font-weight: bold; padding: 4px; font-size: 10px;">⚖️ Dump น้ำหนัก DOM & กระเป๋า</button>
                        </div>
                        <button class="p-btn" id="p-btn-dump-npc" style="background: #8b5cf6; color: #fff; font-weight: bold; padding: 5px; font-size: 10.5px; margin-top: 3px;">👥 Dump NPC (รายชื่อ, Key & พิกัดทั้งหมด)</button>
                    </div>

                    <button class="p-btn p-btn-copy-out" id="p-btn-copy-out" style="margin-top: 2px;">📋 คัดลอก Packet ขาออก (Hex เต็ม)</button>
                </div>
            </div>
        `;
}

const MANAGER_MAIN_STATS = [
  { value: 'DEX', label: 'DEX (ความแม่นยำ/ระยะไกล)' },
  { value: 'STR', label: 'STR (พลังโจมตีประชิด/แบกน้ำหนัก)' },
  { value: 'AGI', label: 'AGI (ความเร็วโจมตี/หลบหลีก)' },
  { value: 'VIT', label: 'VIT (พลังป้องกัน/HP)' },
  { value: 'INT', label: 'INT (พลังเวท/มานา)' },
  { value: 'LUK', label: 'LUK (คริติคอล/โชคลาภ)' }
];

const MANAGER_SUB_STATS = [
  { value: 'ATK_PERCENT', label: 'ATK% (พลังโจมตีกายภาพ %)' },
  { value: 'ATK_FLAT', label: 'ATK (พลังโจมตีกายภาพ หน่วยตรง)' },
  { value: 'RANGED_DAMAGE_PERCENT', label: 'RANGED DMG% (ความแรงระยะไกล %)' },
  { value: 'RANGE_ATTACK', label: 'RANGE ATK (พลังโจมตีระยะไกล หน่วยตรง)' },
  { value: 'MELEE_DAMAGE_PERCENT', label: 'MELEE DMG% (ความแรงประชิด %)' },
  { value: 'MELEE_ATTACK', label: 'MELEE ATK (พลังโจมตีประชิด หน่วยตรง)' },
  { value: 'MATK_PERCENT', label: 'MATK% (พลังโจมตีเวท %)' },
  { value: 'MATK_FLAT', label: 'MATK (พลังโจมตีเวท หน่วยตรง)' },
  { value: 'MAGIC_DAMAGE_PERCENT', label: 'MAGIC DMG% (ความแรงเวท %)' },
  { value: 'MAGIC_ATTACK', label: 'MAGIC ATK (พลังโจมตีเวท หน่วยตรง)' },
  { value: 'CRIT', label: 'CRIT (อัตราคริติคอล)' },
  { value: 'CRIT_DAMAGE', label: 'CRIT DMG% (ความแรงคริ %)' },
  { value: 'ASPD', label: 'ASPD (ความเร็วโจมตี หน่วยตรง)' },
  { value: 'ASPD_PERCENT', label: 'ASPD% (ความเร็วโจมตี %)' },
  { value: 'HIT', label: 'HIT (ความแม่นยำ)' },
  { value: 'FLEE', label: 'FLEE (การหลบหลีก)' },
  { value: 'MOVE_SPEED', label: 'MOVE SPEED (ความเร็วเดิน)' },
  { value: 'CAST_TIME_REDUCTION', label: 'CAST RED% (ลดเวลาร่าย %)' },
  { value: 'DEF', label: 'DEF (พลังป้องกันกายภาพ)' },
  { value: 'MDEF', label: 'MDEF (พลังป้องกันเวท)' },
  { value: 'DAMAGE_REDUCTION', label: 'DMG RED% (ลดดาเมจที่ได้รับ %)' },
  { value: 'BLOCK_CHANCE', label: 'BLOCK% (โอกาสบล็อก %)' },
  { value: 'MAXHP_PERCENT', label: 'Max HP% (เลือดสูงสุด %)' },
  { value: 'MAXHP', label: 'Max HP (เลือดสูงสุด หน่วยตรง)' },
  { value: 'MAXSP_PERCENT', label: 'Max SP% (มานาสูงสุด %)' },
  { value: 'MAXSP', label: 'Max SP (มานาสูงสุด หน่วยตรง)' },
  { value: 'HP_REGEN', label: 'HP REGEN (ฟื้นฟูเลือด)' },
  { value: 'SP_REGEN', label: 'SP REGEN (ฟื้นฟูมานา)' },
  { value: 'HEAL_POWER', label: 'HEAL% (พลังการฮีล %)' }
];

function openCentralBotHUD() {
  return openWebBotHUD('__central__');
}
window.openCentralBotHUD = openCentralBotHUD;

document.addEventListener('DOMContentLoaded', () => {
  const centralBtn = document.getElementById('btn-open-central-bot-menu');
  if (centralBtn) centralBtn.addEventListener('click', () => openCentralBotHUD());
});
if (document.readyState !== 'loading') {
  const centralBtn = document.getElementById('btn-open-central-bot-menu');
  if (centralBtn) centralBtn.onclick = () => openCentralBotHUD();
}

async function openWebBotHUD(profileId) {
  const isCentral = (profileId === '__central__');
  const profile = isCentral
    ? { id: '__central__', name: 'เมนูส่วนกลาง (Master Control)' }
    : currentProfiles.find(p => p.id === profileId);
  if (!profile) return;

  // Bring to top if already exists
  if (activeWebHuds[profileId]) {
    const existing = activeWebHuds[profileId].el;
    existing.style.zIndex = ++topHudZIndex;
    existing.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  // Fetch initial client data (for __central__, read-only snapshot from first online client or saved draft — NEVER writes to any client!)
  let clientData = null;
  if (isCentral) {
    try {
      const firstOnline = currentProfiles.find(p => p.isRunning);
      if (firstOnline) {
        const res = await fetch(API_BASE + '/api/profiles/' + firstOnline.id + '/client-data');
        const json = await res.json();
        if (json.success) clientData = json.data;
      }
    } catch (e) {}
  } else {
    try {
      const res = await fetch(API_BASE + '/api/profiles/' + profileId + '/client-data');
      const json = await res.json();
      if (json.success) clientData = json.data;
    } catch (e) {}
  }

  const container = document.getElementById("web-huds-container") || document.body;
  const hudCount = Object.keys(activeWebHuds).length;
  const topPos = Math.min(window.innerHeight - 450, 100 + (hudCount * 30) % 250);
  const leftPos = Math.min(window.innerWidth - 320, 60 + (hudCount * 35) % 400);

  const hudEl = document.createElement("div");
  hudEl.className = "pelican-hud-web" + (isCentral ? " is-central-hud" : "");
  hudEl.id = 'pelican-hud-' + profileId;
  hudEl.style.top = topPos + 'px';
  hudEl.style.left = leftPos + 'px';
  hudEl.style.zIndex = ++topHudZIndex;
  if (isCentral) {
    hudEl.style.borderColor = "rgba(250, 204, 21, 0.65)";
    hudEl.style.boxShadow = "0 20px 50px rgba(0, 0, 0, 0.75), 0 0 24px rgba(245, 158, 11, 0.3)";
  }

  hudEl.innerHTML = getGitHubHudTemplate(profileId, clientData, profile);
  container.appendChild(hudEl);

  // Store active reference
  activeWebHuds[profileId] = {
    el: hudEl,
    activeTab: 'farm',
    data: clientData,
    profile: profile,
    isCentral: isCentral
  };

  // Wire Tab Switching directly within this HUD window (switching tabs NEVER sends any action to clients)
  const tabBtns = hudEl.querySelectorAll('.p-tab-btn');
  const tabPanes = hudEl.querySelectorAll('.p-tab-pane');
  tabBtns.forEach(btn => {
    btn.onclick = () => {
      const targetTab = btn.getAttribute('data-tab');
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const activePane = hudEl.querySelector('#p-tab-' + targetTab);
      if (activePane) activePane.classList.add('active');
      activeWebHuds[profileId].activeTab = targetTab;
    };
  });

  // Wire Market subtabs
  const btnAuto = hudEl.querySelector('#p-subtab-btn-autosell');
  const btnSniper = hudEl.querySelector('#p-subtab-btn-sniper');
  const viewAuto = hudEl.querySelector('#p-market-view-autosell');
  const viewSniper = hudEl.querySelector('#p-market-view-sniper');
  if (btnAuto && btnSniper) {
    btnAuto.onclick = () => {
      if (viewAuto) viewAuto.style.display = 'block';
      if (viewSniper) viewSniper.style.display = 'none';
      btnAuto.style.background = '#9333ea'; btnAuto.style.color = '#fff';
      btnSniper.style.background = 'transparent'; btnSniper.style.color = '#94a3b8';
    };
    btnSniper.onclick = () => {
      if (viewAuto) viewAuto.style.display = 'none';
      if (viewSniper) viewSniper.style.display = 'block';
      btnAuto.style.background = 'transparent'; btnAuto.style.color = '#94a3b8';
      btnSniper.style.background = '#0284c7'; btnSniper.style.color = '#fff';
    };
  }

  // Shortcut button from Sell tab -> Market AutoSell subtab
  const gotoMarketAutoSellBtn = hudEl.querySelector('#p-btn-goto-market-autosell');
  if (gotoMarketAutoSellBtn) {
    gotoMarketAutoSellBtn.onclick = () => {
      const marketTabBtn = hudEl.querySelector('.p-tab-btn[data-tab="market"]');
      if (marketTabBtn) marketTabBtn.click();
      if (btnAuto) btnAuto.click();
    };
  }

  // Password toggle
  const passToggle = hudEl.querySelector('#p-auth-toggle-pass');
  const passInp = hudEl.querySelector('#p-auth-pass');
  if (passToggle && passInp) {
    passToggle.onclick = () => {
      passInp.type = passInp.type === 'password' ? 'text' : 'password';
    };
  }

  // Auto Sell ตั้งขาย list (web version)
  wireWebAutoSell(profileId, hudEl);

  // Action Buttons Wiring (Idempotent Start All / Stop All for Central Menu)
  const centralStartBtn = hudEl.querySelector('#p-btn-central-start-bot');
  if (centralStartBtn) {
    centralStartBtn.onclick = () => setBotOnAllClients(true, centralStartBtn);
  }
  const centralStopBtn = hudEl.querySelector('#p-btn-central-stop-bot');
  if (centralStopBtn) {
    centralStopBtn.onclick = () => setBotOnAllClients(false, centralStopBtn);
  }

  const toggleBotBtn = hudEl.querySelector('#p-btn-toggle-bot');
  if (toggleBotBtn) {
    toggleBotBtn.onclick = () => {
      const isRunning = Boolean(activeWebHuds[profileId]?.data?.isBotRunning);
      toggleBotExecution(profileId, !isRunning);
    };
  }

  const autoLoopCb = hudEl.querySelector('#p-auto-loop');
  if (autoLoopCb) {
    autoLoopCb.onchange = (e) => {
      sendWebHudAction(profileId, { type: 'toggle-auto-loop', enabled: e.target.checked });
    };
  }

  const planScriptCb = hudEl.querySelector('#p-plan-script-enabled');
  if (planScriptCb) {
    planScriptCb.onchange = (e) => {
      sendWebHudAction(profileId, { type: 'toggle-plan-script', enabled: e.target.checked });
    };
  }

  const mapSelect = hudEl.querySelector('#p-target-map-select');
  if (mapSelect) {
    mapSelect.onchange = (e) => {
      sendWebHudAction(profileId, { type: 'set-farm-map', map: e.target.value });
    };
  }

  const walkMapBtn = hudEl.querySelector('#p-btn-walk-map');
  if (walkMapBtn) {
    walkMapBtn.onclick = () => sendWebHudAction(profileId, { type: 'walk-to-map' });
  }

  const openMapBtn = hudEl.querySelector('#p-btn-open-map');
  if (openMapBtn) {
    openMapBtn.onclick = () => sendWebHudAction(profileId, { type: 'open-world-map' });
  }

  const warpMinZenyInp = hudEl.querySelector('#p-warp-min-zeny');
  if (warpMinZenyInp) {
    warpMinZenyInp.onchange = (e) => {
      const minZ = Math.max(0, parseInt(e.target.value, 10) || 0);
      sendWebHudAction(profileId, { type: 'update-travel', minZenyForWarp: minZ, config: { minZenyForWarp: minZ } });
    };
  }

  // Security & Humanize listeners (each control sends ONLY its own key)
  const unexpGuardCb = hudEl.querySelector('#p-unexpected-town-guard');
  if (unexpGuardCb) {
    unexpGuardCb.onchange = (e) => {
      sendWebHudAction(profileId, { type: 'toggle-unexpected-town-guard', enabled: e.target.checked });
    };
  }

  const skipUnexpBtn = hudEl.querySelector('#p-btn-skip-unexpected-wait');
  if (skipUnexpBtn) {
    skipUnexpBtn.onclick = () => {
      sendWebHudAction(profileId, { type: 'skip-unexpected-wait' });
    };
  }

  const bindHumanizeField = (sel, buildPatch) => {
    const el = hudEl.querySelector(sel);
    if (!el) return;
    el.onchange = () => {
      sendWebHudAction(profileId, { type: 'update-humanize', config: buildPatch(el) });
    };
  };
  bindHumanizeField('#p-humanize-enabled', el => ({ enabled: !!el.checked }));
  bindHumanizeField('#p-humanize-chance', el => {
    const v = Math.max(0, Math.min(100, parseInt(el.value, 10) || 0));
    return { chance: v, chancePercent: v };
  });
  bindHumanizeField('#p-humanize-blacksmith', el => ({ buyBlacksmith: !!el.checked, visitBlacksmith: !!el.checked }));
  bindHumanizeField('#p-humanize-sundries', el => ({ buySundries: !!el.checked, visitSundries: !!el.checked }));
  bindHumanizeField('#p-humanize-walk', el => ({ randomWalk: !!el.checked }));
  bindHumanizeField('#p-humanize-storage', el => ({ storeDeposit: !!el.checked, openStorage: !!el.checked }));

  const testHumanizeBtn = hudEl.querySelector('#p-btn-test-humanize');
  if (testHumanizeBtn) {
    testHumanizeBtn.onclick = async () => {
      const r = await sendWebHudAction(profileId, { type: 'test-humanize' });
      showToast(r && r.success !== false ? '🎭 สั่งทดสอบกิจกรรม Humanize ในจอเกมแล้ว' : '❌ สั่งงานจอเกมไม่สำเร็จ', r && r.success !== false ? 'success' : 'error');
    };
  }

  // Archer event listeners (each control sends ONLY its own key)
  const bindArcherField = (sel, buildPatch) => {
    const el = hudEl.querySelector(sel);
    if (!el) return;
    el.onchange = () => {
      sendWebHudAction(profileId, { type: 'update-archer', config: buildPatch(el) });
    };
  };
  bindArcherField('#p-archer-req', el => ({ requireArrow: !!el.checked }));
  bindArcherField('#p-archer-type', el => ({ arrowType: parseInt(el.value || '90030', 10) }));
  bindArcherField('#p-archer-qty', el => ({ arrowBuyQty: parseInt(el.value || '5000', 10) }));
  bindArcherField('#p-archer-threshold', el => ({ ammoThreshold: parseInt(el.value || '50', 10) }));
  bindArcherField('#p-archer-bwing', el => ({ useBwing: !!el.checked }));
  bindArcherField('#p-archer-bwing-qty', el => ({ bwingBuyQty: parseInt(el.value || '2', 10) }));
  bindArcherField('#p-archer-auto-equip', el => ({ autoEquipArrow: !!el.checked }));

  const syncAmmoBtn = hudEl.querySelector('#p-btn-sync-ammo');
  if (syncAmmoBtn) syncAmmoBtn.onclick = () => sendWebHudAction(profileId, { type: 'sync-ammo' });

  const zeroAmmoBtn = hudEl.querySelector('#p-btn-zero-ammo');
  if (zeroAmmoBtn) zeroAmmoBtn.onclick = () => sendWebHudAction(profileId, { type: 'zero-ammo' });

  // Buff Potion event listeners (each control sends ONLY its own potion & property)
  ['90306', '90307', '90308'].forEach(id => {
    const cb = hudEl.querySelector(`#p-potion-enable-${id}`);
    if (cb) {
      cb.onchange = () => {
        sendWebHudAction(profileId, { type: 'update-buff-potions', config: { [id]: { enabled: !!cb.checked } } });
      };
    }
    const qty = hudEl.querySelector(`#p-potion-qty-${id}`);
    if (qty) {
      qty.onchange = () => {
        sendWebHudAction(profileId, { type: 'update-buff-potions', config: { [id]: { targetQty: parseInt(qty.value || '10', 10) } } });
      };
    }
  });

  const syncPotionBtn = hudEl.querySelector('.p-btn-sync-potion-game');
  if (syncPotionBtn) syncPotionBtn.onclick = () => sendWebHudAction(profileId, { type: 'sync-buff-potions' });

  const buyPotionBtn = hudEl.querySelector('.p-btn-buy-potion-now');
  if (buyPotionBtn) buyPotionBtn.onclick = () => sendWebHudAction(profileId, { type: 'buy-buff-potions' });

  // Sell & Stat Filter State & Listeners (each control sends ONLY the property that changed!)
  let currentStatsFilter = Object.assign({
    enabled: false,
    filterWeapons: true,
    filterArmors: true,
    filterAccessories: true,
    protectGems: true,
    minOptions: 2,
    mainStats: [],
    subStats: []
  }, clientData?.sellConfig?.statsFilter || {});

  const sendStatsFilterPatch = (patch) => {
    Object.assign(currentStatsFilter, patch);
    sendWebHudAction(profileId, { type: 'update-sell', config: { statsFilterPatch: patch } });
  };

  const renderWebHudStatsFilter = () => {
    const mainList = hudEl.querySelector('.p-statfilter-main-list');
    const subList = hudEl.querySelector('.p-statfilter-sub-list');
    if (!mainList || !subList) return;

    // Header controls
    const toggleEl = hudEl.querySelector('#p-statfilter-toggle');
    if (toggleEl && document.activeElement !== toggleEl) toggleEl.checked = !!currentStatsFilter.enabled;
    const weapEl = hudEl.querySelector('#p-statfilter-weap');
    if (weapEl && document.activeElement !== weapEl) weapEl.checked = currentStatsFilter.filterWeapons !== false;
    const armorEl = hudEl.querySelector('#p-statfilter-armor');
    if (armorEl && document.activeElement !== armorEl) armorEl.checked = currentStatsFilter.filterArmors !== false;
    const accEl = hudEl.querySelector('#p-statfilter-acc');
    if (accEl && document.activeElement !== accEl) accEl.checked = currentStatsFilter.filterAccessories !== false;
    const gemEl = hudEl.querySelector('#p-statfilter-protect-gems');
    if (gemEl && document.activeElement !== gemEl) gemEl.checked = currentStatsFilter.protectGems !== false;
    const minOptsEl = hudEl.querySelector('#p-statfilter-min-opts');
    if (minOptsEl && document.activeElement !== minOptsEl) minOptsEl.value = currentStatsFilter.minOptions || 2;

    // Main Stats
    const mStats = Array.isArray(currentStatsFilter.mainStats) ? currentStatsFilter.mainStats : [];
    if (mStats.length === 0) {
      mainList.innerHTML = `<div style="font-size: 8.5px; color: #64748b; text-align: center; padding: 2px;">(ไม่มีเงื่อนไข Main Stats - คลิก + เพื่อเพิ่ม)</div>`;
    } else {
      mainList.innerHTML = mStats.map((item, idx) => `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px; background: rgba(0,0,0,0.3); padding: 2px 4px; border-radius: 3px; border: 1px solid rgba(56, 189, 248, 0.2);">
          <select class="p-sf-main-select" data-index="${idx}" style="flex: 1; min-width: 0; background: #0f172a; border: 1px solid rgba(56, 189, 248, 0.35); color: #fff; border-radius: 3px; font-size: 9px; padding: 1px 3px;">
            ${MANAGER_MAIN_STATS.map(opt => `<option value="${opt.value}" ${opt.value === item.stat ? 'selected' : ''}>${opt.label}</option>`).join('')}
          </select>
          <label class="p-check-box" style="margin: 0; font-size: 8px; color: #38bdf8; display: flex; align-items: center; gap: 2px; white-space: nowrap;">
            <input type="checkbox" class="p-sf-main-must" data-index="${idx}" ${item.mustHave ? 'checked' : ''}>
            <span>Must Have</span>
          </label>
          <button type="button" class="p-sf-main-del" data-index="${idx}" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 3px; font-size: 8.5px; cursor: pointer; padding: 0 4px; line-height: 14px;">✕</button>
        </div>
      `).join('');
    }

    // Sub Stats
    const sStats = Array.isArray(currentStatsFilter.subStats) ? currentStatsFilter.subStats : [];
    if (sStats.length === 0) {
      subList.innerHTML = `<div style="font-size: 8.5px; color: #64748b; text-align: center; padding: 2px;">(ไม่มีเงื่อนไข Sub Stats - คลิก + เพื่อเพิ่ม)</div>`;
    } else {
      subList.innerHTML = sStats.map((item, idx) => `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px; background: rgba(0,0,0,0.3); padding: 2px 4px; border-radius: 3px; border: 1px solid rgba(234, 179, 8, 0.2);">
          <select class="p-sf-sub-select" data-index="${idx}" style="flex: 1; min-width: 0; background: #0f172a; border: 1px solid rgba(234, 179, 8, 0.35); color: #fff; border-radius: 3px; font-size: 9px; padding: 1px 3px;">
            ${MANAGER_SUB_STATS.map(opt => `<option value="${opt.value}" ${opt.value === item.stat ? 'selected' : ''}>${opt.label}</option>`).join('')}
          </select>
          <label class="p-check-box" style="margin: 0; font-size: 8px; color: #facc15; display: flex; align-items: center; gap: 2px; white-space: nowrap;">
            <input type="checkbox" class="p-sf-sub-must" data-index="${idx}" ${item.mustHave ? 'checked' : ''}>
            <span>Must Have</span>
          </label>
          <button type="button" class="p-sf-sub-del" data-index="${idx}" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 3px; font-size: 8.5px; cursor: pointer; padding: 0 4px; line-height: 14px;">✕</button>
        </div>
      `).join('');
    }

    // Row event listeners
    mainList.querySelectorAll('.p-sf-main-select').forEach(sel => {
      sel.onchange = (e) => {
        const i = parseInt(e.target.dataset.index);
        if (currentStatsFilter.mainStats?.[i]) {
          currentStatsFilter.mainStats[i].stat = e.target.value;
          sendStatsFilterPatch({ mainStats: currentStatsFilter.mainStats });
        }
      };
    });
    mainList.querySelectorAll('.p-sf-main-must').forEach(cb => {
      cb.onchange = (e) => {
        const i = parseInt(e.target.dataset.index);
        if (currentStatsFilter.mainStats?.[i]) {
          currentStatsFilter.mainStats[i].mustHave = e.target.checked;
          sendStatsFilterPatch({ mainStats: currentStatsFilter.mainStats });
        }
      };
    });
    mainList.querySelectorAll('.p-sf-main-del').forEach(btn => {
      btn.onclick = (e) => {
        const i = parseInt(e.target.dataset.index);
        currentStatsFilter.mainStats.splice(i, 1);
        renderWebHudStatsFilter();
        sendStatsFilterPatch({ mainStats: currentStatsFilter.mainStats });
      };
    });

    subList.querySelectorAll('.p-sf-sub-select').forEach(sel => {
      sel.onchange = (e) => {
        const i = parseInt(e.target.dataset.index);
        if (currentStatsFilter.subStats?.[i]) {
          currentStatsFilter.subStats[i].stat = e.target.value;
          sendStatsFilterPatch({ subStats: currentStatsFilter.subStats });
        }
      };
    });
    subList.querySelectorAll('.p-sf-sub-must').forEach(cb => {
      cb.onchange = (e) => {
        const i = parseInt(e.target.dataset.index);
        if (currentStatsFilter.subStats?.[i]) {
          currentStatsFilter.subStats[i].mustHave = e.target.checked;
          sendStatsFilterPatch({ subStats: currentStatsFilter.subStats });
        }
      };
    });
    subList.querySelectorAll('.p-sf-sub-del').forEach(btn => {
      btn.onclick = (e) => {
        const i = parseInt(e.target.dataset.index);
        currentStatsFilter.subStats.splice(i, 1);
        renderWebHudStatsFilter();
        sendStatsFilterPatch({ subStats: currentStatsFilter.subStats });
      };
    });
  };

  const bindSellField = (sel, buildPatch) => {
    const el = hudEl.querySelector(sel);
    if (!el) return;
    el.onchange = () => {
      const patch = buildPatch(el);
      if (patch && Object.keys(patch).length > 0) {
        sendWebHudAction(profileId, { type: 'update-sell', config: patch });
      }
    };
  };
  bindSellField('#p-sell-enabled', el => ({ enabled: !!el.checked }));
  bindSellField('#p-weight-check-enabled', el => ({ weightCheckEnabled: !!el.checked }));
  bindSellField('#p-weight-threshold', el => {
    const wPct = parseInt(el.value, 10);
    return (wPct >= 10 && wPct <= 95) ? { weightThreshold: wPct } : {};
  });
  bindSellField('#p-sell-rarity-weap', el => ({ weaponRarity: el.value }));
  bindSellField('#p-sell-rarity-armor', el => ({ armorRarity: el.value }));
  bindSellField('#p-sell-rarity-acc', el => ({ accRarity: el.value }));
  bindSellField('#p-sell-rarity-mat', el => ({ sellMaterials: el.value !== 'none', materialMode: el.value === 'common' ? 'common' : 'all' }));
  bindSellField('#p-sell-refine-ores', el => ({ sellRefineOres: el.value === 'unlisted' }));
  bindSellField('#p-sell-keep-refined', el => ({ keepRefined: !!el.checked }));
  bindSellField('#p-sell-keep-special', el => ({ keepSpecial: !!el.checked }));
  bindSellField('#p-sell-keep-sockets', el => ({ keepSockets: !!el.checked }));
  bindSellField('#p-sell-whitelist', el => ({ whitelist: el.value || '' }));
  [
    ['#p-store-enabled', 'storeEnabled'],
    ['#p-store-weapon', 'storeWeapon'],
    ['#p-store-armor', 'storeArmor'],
    ['#p-store-acc', 'storeAcc'],
    ['#p-store-refine', 'storeRefine'],
    ['#p-store-skip-locked', 'storeSkipLocked']
  ].forEach(([sel, key]) => {
    bindSellField(sel, el => ({ [key]: !!el.checked }));
  });

  // Stat Filter Header Controls (each sends only its own statsFilterPatch)
  const addMainBtn = hudEl.querySelector('.p-btn-add-mainstat');
  if (addMainBtn) {
    addMainBtn.onclick = () => {
      if (!Array.isArray(currentStatsFilter.mainStats)) currentStatsFilter.mainStats = [];
      currentStatsFilter.mainStats.push({ stat: 'DEX', mustHave: false });
      renderWebHudStatsFilter();
      sendStatsFilterPatch({ mainStats: currentStatsFilter.mainStats });
    };
  }
  const addSubBtn = hudEl.querySelector('.p-btn-add-substat');
  if (addSubBtn) {
    addSubBtn.onclick = () => {
      if (!Array.isArray(currentStatsFilter.subStats)) currentStatsFilter.subStats = [];
      currentStatsFilter.subStats.push({ stat: 'ATK_PERCENT', mustHave: false });
      renderWebHudStatsFilter();
      sendStatsFilterPatch({ subStats: currentStatsFilter.subStats });
    };
  }

  [
    ['#p-statfilter-toggle', el => ({ enabled: !!el.checked })],
    ['#p-statfilter-weap', el => ({ filterWeapons: !!el.checked })],
    ['#p-statfilter-armor', el => ({ filterArmors: !!el.checked })],
    ['#p-statfilter-acc', el => ({ filterAccessories: !!el.checked })],
    ['#p-statfilter-protect-gems', el => ({ protectGems: !!el.checked })],
    ['#p-statfilter-min-opts', el => ({ minOptions: Math.max(1, parseInt(el.value, 10) || 2) })]
  ].forEach(([sel, fn]) => {
    const el = hudEl.querySelector(sel);
    if (el) {
      el.onchange = () => {
        sendStatsFilterPatch(fn(el));
      };
    }
  });

  if (activeWebHuds[profileId]) {
    activeWebHuds[profileId].currentStatsFilter = currentStatsFilter;
    activeWebHuds[profileId].renderStatsFilter = renderWebHudStatsFilter;
  }
  renderWebHudStatsFilter();

  const refreshInvBtn = hudEl.querySelector('#p-btn-sort-inv') || hudEl.querySelector('#p-quick-weight');
  if (refreshInvBtn) refreshInvBtn.onclick = () => sendWebHudAction(profileId, { type: 'sort-inventory' });

  const testSellBtn = hudEl.querySelector('#p-btn-test-sell-only');
  if (testSellBtn) testSellBtn.onclick = () => sendWebHudAction(profileId, { type: 'test-sell' });

  // Shop (NPC trip) settings (each control sends only its own key)
  const shopEnEl = hudEl.querySelector('#p-shop-enabled');
  if (shopEnEl) {
    shopEnEl.onchange = () => {
      const en = !!shopEnEl.checked;
      sendWebHudAction(profileId, { type: 'eval', code: `(() => {
        window.__shopConfig = Object.assign(window.__shopConfig || {}, { enabled: ${JSON.stringify(en)} });
        try { localStorage.setItem('pelican_shop_cfg', JSON.stringify(window.__shopConfig)); } catch (e) {}
        const a = document.getElementById('p-shop-enabled'); if (a) a.checked = !!window.__shopConfig.enabled;
        return { success: true };
      })()` });
    };
  }
  const shopKeyEl = hudEl.querySelector('#p-shop-npckey');
  if (shopKeyEl) {
    shopKeyEl.onchange = () => {
      const key = (shopKeyEl.value || '').trim();
      if (!key) return;
      sendWebHudAction(profileId, { type: 'eval', code: `(() => {
        window.__shopConfig = Object.assign(window.__shopConfig || {}, { npcKey: ${JSON.stringify(key)} });
        try { localStorage.setItem('pelican_shop_cfg', JSON.stringify(window.__shopConfig)); } catch (e) {}
        const b = document.getElementById('p-shop-npckey'); if (b) b.value = window.__shopConfig.npcKey || '';
        return { success: true };
      })()` });
    };
  }

  // Ultra-Low Spec & Auto-Config Char / Mute Display (each checkbox sends only its own key)
  const ultraLowSpecCb = hudEl.querySelector('#p-ultra-low-spec');
  if (ultraLowSpecCb) {
    ultraLowSpecCb.onchange = (e) => {
      sendWebHudAction(profileId, { type: 'toggle-ultra-low-spec', enabled: e.target.checked });
    };
  }

  const autoCfgCharEl = hudEl.querySelector('#p-auto-config-char');
  if (autoCfgCharEl) {
    autoCfgCharEl.onchange = () => {
      sendWebHudAction(profileId, { type: 'update-auto-config', config: { autoConfigCharEnabled: !!autoCfgCharEl.checked } });
    };
  }
  const autoMuteDispEl = hudEl.querySelector('#p-auto-mute-display');
  if (autoMuteDispEl) {
    autoMuteDispEl.onchange = () => {
      sendWebHudAction(profileId, { type: 'update-auto-config', config: { autoMuteDisplayEnabled: !!autoMuteDispEl.checked } });
    };
  }

  const applyAutoConfigBtn = hudEl.querySelector('#p-btn-apply-autoconfig');
  if (applyAutoConfigBtn) {
    applyAutoConfigBtn.onclick = async () => {
      const r = await sendWebHudAction(profileId, { type: 'apply-autoconfig-now' });
      showToast(r && r.success !== false ? '⚡ สั่งตั้งค่าระยะล่า + สกิล + ปิดประกาศแล้ว' : '❌ สั่งงานจอเกมไม่สำเร็จ', r && r.success !== false ? 'success' : 'error');
    };
  }

  // Market sniper filter (each control sends only its own key)
  const MK_FIELDS = [['#p-mk-search-query', 'q', 'text'], ['#p-mk-cat-select', 'category', 'text'], ['#p-mk-kind-select', 'kind', 'text'],
    ['#p-mk-min-refine', 'minRefine', 'int'], ['#p-mk-max-price', 'maxPrice', 'int'], ['#p-mk-stat1-type', 'statType1', 'text'],
    ['#p-mk-stat1-min', 'statMinVal1', 'int1'], ['#p-mk-stat2-type', 'statType2', 'text'], ['#p-mk-stat2-min', 'statMinVal2', 'int1'],
    ['#p-mk-stat-mode', 'statMatchMode', 'text'], ['#p-mk-sniper-alert', 'sniperAlert', 'bool'], ['#p-mk-auto-buy', 'autoBuy', 'bool']];
  MK_FIELDS.forEach(([sel, key, kind]) => {
    const el = hudEl.querySelector(sel);
    if (!el) return;
    el.onchange = () => {
      const val = kind === 'bool' ? el.checked : kind === 'int' ? (parseInt(el.value, 10) || 0) : kind === 'int1' ? (parseInt(el.value, 10) || 1) : el.value;
      const mk = { [key]: val };
      sendWebHudAction(profileId, { type: 'eval', code: `(() => {
        window.__marketFilterConfig = Object.assign(window.__marketFilterConfig || {}, ${JSON.stringify(mk)});
        try { localStorage.setItem('pelican_market_filter_cfg', JSON.stringify(window.__marketFilterConfig)); } catch (e) {}
        const domEl = document.querySelector(${JSON.stringify(sel)});
        if (domEl) {
          if (${JSON.stringify(kind === 'bool')}) domEl.checked = ${JSON.stringify(Boolean(val))};
          else domEl.value = ${JSON.stringify(String(val ?? ''))};
        }
        if (typeof window.applyMarketFilters === 'function') { try { window.applyMarketFilters(); } catch (e) {} }
        return { success: true };
      })()` });
    };
  });

  // Buttons that called functions which only exist inside the game window
  const gameCall = (sel, code, confirmText) => {
    const btn = hudEl.querySelector(sel);
    if (!btn) return;
    btn.onclick = async () => {
      if (confirmText && !confirm(confirmText)) return;
      const r = await sendWebHudAction(profileId, { type: 'eval', code });
      showToast(r && r.success !== false ? '✅ ส่งคำสั่งเข้าจอเกมแล้ว' : '❌ สั่งงานจอเกมไม่สำเร็จ', r && r.success !== false ? 'success' : 'error');
    };
  };
  gameCall('#p-btn-equip-bow-arrow', `(typeof window.equipArrowAndBow === 'function' && window.equipArrowAndBow(), true)`);
  gameCall('#p-btn-refresh-weight', `(typeof window.refreshInventoryAndWeight === 'function' && window.refreshInventoryAndWeight(), true)`);
  gameCall('#p-btn-test-login', `(typeof window.executeAutoLogin === 'function' && window.executeAutoLogin(true), true)`);
  gameCall('#p-btn-mk-scan', `(window.__isMarketScanning ? (typeof window.stopMarketScan === 'function' && window.stopMarketScan()) : (typeof window.startMarketMultiPageScan === 'function' && window.startMarketMultiPageScan('all')), true)`);
  gameCall('#p-btn-store-now', `(typeof window.runAutoStorageDeposit === 'function' && window.runAutoStorageDeposit({ manual: true }), true)`);
  gameCall('#p-btn-test-shop', `(typeof window.executeAutoShopRoutine === 'function' && window.executeAutoShopRoutine(), true)`,
    'ส่งตัวละครกลับเมืองไปขาย/ซื้อของตามตั้งค่าตอนนี้เลยใช่ไหม?');
  ['#p-btn-sniff-equip', '#p-btn-mk-open-modal', '#p-btn-mk-copy-json', '#p-btn-dump-map', '#p-btn-dump-item', '#p-btn-dump-packets',
    '#p-btn-dump-state', '#p-btn-dump-market', '#p-btn-dump-weight', '#p-btn-dump-npc', '#p-btn-copy-out'].forEach(sel => {
    const btn = hudEl.querySelector(sel);
    if (btn) btn.onclick = () => showToast('ปุ่มนี้เป็นเครื่องมือดูข้อมูล ใช้ได้ในหน้าต่างเกมเท่านั้น', 'warning');
  });

  // Auth event listeners (each control sends only its own key)
  const bindAuthField = (sel, buildPatch) => {
    const el = hudEl.querySelector(sel);
    if (!el) return;
    el.onchange = () => {
      const patch = buildPatch(el);
      if (patch && Object.keys(patch).length > 0) {
        sendWebHudAction(profileId, { type: 'update-auth', config: patch });
      }
    };
  };
  bindAuthField('#p-auth-enabled', el => ({ enabled: !!el.checked }));
  bindAuthField('#p-auth-user', el => ({ username: el.value || '' }));
  bindAuthField('#p-auth-pass', el => (el.value ? { password: el.value } : {}));
  bindAuthField('#p-auth-char', el => ({ charName: el.value || '' }));
  bindAuthField('#p-auth-resume', el => ({ autoResumeBot: !!el.checked }));

  // Config Export / Import
  const exportBtn = hudEl.querySelector('#p-btn-export-cfg');
  if (exportBtn) {
    exportBtn.onclick = async () => {
      const targetId = isCentral ? (currentProfiles.find(p => p.isRunning)?.id || '') : profileId;
      if (!targetId) {
        alert('❌ ไม่มีจอเกมที่ออนไลน์ให้ดึงตั้งค่า');
        return;
      }
      const res = await sendWebHudAction(targetId, { type: 'export-config' });
      const jsonStr = res?.result?.result?.json || res?.result?.json;
      if (!jsonStr) {
        alert('❌ ส่งออกไม่สำเร็จ: ' + (res?.error || res?.result?.error || 'จอเกมไม่ตอบกลับ (ต้องเปิดจอเกมนี้ไว้)'));
        return;
      }
      openWebConfigModal(profileId, 'export', jsonStr);
    };
  }

  const importBtn = hudEl.querySelector('#p-btn-import-cfg');
  if (importBtn) {
    importBtn.onclick = () => {
      openWebConfigModal(profileId, 'import');
    };
  }

  // Market Search
  const mkSearchBtn = hudEl.querySelector('#p-btn-mk-search');
  if (mkSearchBtn) {
    mkSearchBtn.onclick = () => {
      const kw = hudEl.querySelector('#p-mk-keyword')?.value || '';
      sendWebHudAction(profileId, { type: 'market-search', keyword: kw });
    };
  }

  // Draggable
  makeElementDraggable(hudEl, hudEl.querySelector('#pelican-drag-handle'));

  // Initial Populate
  populateWebHudData(profileId, clientData);
}

function makeElementDraggable(elmnt, dragHandle) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  if (dragHandle) {
    dragHandle.onmousedown = dragMouseDown;
  }

  function dragMouseDown(e) {
    elmnt.style.zIndex = ++topHudZIndex;
    if (e.target.closest('button') || e.target.closest('.p-header-controls') || e.target.closest('span[style*="cursor"]') || e.target.closest('input') || e.target.closest('select')) return;
    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
  }

  function elementDrag(e) {
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    elmnt.style.top = Math.max(0, elmnt.offsetTop - pos2) + "px";
    elmnt.style.left = Math.max(0, elmnt.offsetLeft - pos1) + "px";
  }

  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
  }
}

function closeWebBotHUD(profileId) {
  if (activeWebHuds[profileId]) {
    activeWebHuds[profileId].el.remove();
    delete activeWebHuds[profileId];
  }
}

function toggleWebHudCollapse(profileId) {
  const hud = activeWebHuds[profileId]?.el;
  if (!hud) return;
  const content = hud.querySelector('#pelican-content');
  const toggleBtn = hud.querySelector('.pelican-toggle') || hud.querySelector('#pelican-toggle');
  if (!content) return;
  if (content.style.display === 'none') {
    content.style.display = 'flex';
    if (toggleBtn) toggleBtn.innerText = '−';
  } else {
    content.style.display = 'none';
    if (toggleBtn) toggleBtn.innerText = '+';
  }
}

// "🏷️ Auto Sell ตั้งขาย" list in the web bot menu. The HUD copy called the game's own functions
// (renderAutoSellHudRulesHtml / addAutoMarketSellRule ...), which only exist inside the game window, so the
// list was always empty here. Drawn from client-data; every change is sent as update-autosell { rules }.
const escAttr = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function webAutoSellRules(profileId) {
  const d = activeWebHuds[profileId]?.data;
  return ((d && d.autoMarketSellConfig && d.autoMarketSellConfig.rules) || []).map(r => ({ ...r }));
}
function renderWebAutoSellRules(profileId, force) {
  const hud = activeWebHuds[profileId]?.el;
  const box = hud && hud.querySelector('#p-autosell-hud-rules-container');
  if (!box) return;
  if (!force && box.contains(document.activeElement)) return;   // don't redraw under the user's cursor
  const rules = webAutoSellRules(profileId);
  const sig = JSON.stringify(rules);
  if (!force && box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  const badge = hud.querySelector('#p-subtab-autosell-count');
  if (badge) badge.innerText = rules.length;
  if (!rules.length) {
    box.innerHTML = `<div style="background: rgba(15, 23, 42, 0.6); border: 1px dashed rgba(168, 85, 247, 0.35); border-radius: 6px; padding: 10px 8px; text-align: center; color: #94a3b8; font-size: 10px; margin: 4px 0;">
      💡 ยังไม่มีรายการตั้งขายอัตโนมัติ<br><span style="color: #cbd5e1; font-size: 9px;">กดปุ่ม <b style="color: #4ade80;">[➕ เพิ่มรายการลงขาย]</b> ด้านบน แล้วใส่ชื่อไอเทมและจำนวนขั้นต่ำ</span></div>`;
    return;
  }
  box.innerHTML = rules.map((r, i) => `
    <div class="p-card ws-rule" data-rule-id="${escAttr(r.id)}" style="border-color: rgba(168, 85, 247, 0.35); background: rgba(15, 23, 42, 0.7); padding: 5px; margin-bottom: 4px; ${r.enabled === false ? 'opacity: .55;' : ''}">
      <div style="display: flex; align-items: center; gap: 4px;">
        <span style="color: #a855f7; font-weight: bold; font-size: 10px; font-family: monospace;">#${i + 1}</span>
        <input type="checkbox" class="ws-en" ${r.enabled === false ? '' : 'checked'} title="เปิด/ปิดรายการนี้">
        <input type="text" class="ws-name" value="${escAttr(r.itemName)}" placeholder="ชื่อไอเทม (ตรงตัว)..." style="flex: 1; min-width: 0; background: #020617; border: 1px solid #475569; color: #fff; padding: 2px 5px; border-radius: 4px; font-size: 10px; font-weight: bold;">
        <button type="button" class="ws-del" title="ลบรายการนี้" style="background: #ef4444; color: #fff; border: none; width: 20px; height: 20px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer; flex-shrink: 0;">➖</button>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 3px; gap: 4px; font-size: 9.5px; color: #cbd5e1;">
        <span>ครบ ≥ <input type="number" class="ws-min" min="1" value="${Number(r.minQty) || 20}" style="width: 48px; background: #020617; border: 1px solid #475569; color: #38bdf8; padding: 1px 3px; border-radius: 3px; font-size: 10px; text-align: center; font-weight: bold;"> ชิ้น</span>
        <select class="ws-mode" style="background: #020617; border: 1px solid #475569; color: #c084fc; padding: 1px 4px; border-radius: 3px; font-size: 9.5px;">
          <option value="all" ${r.sellMode !== 'min' ? 'selected' : ''}>ขายหมดในตัว</option>
          <option value="min" ${r.sellMode === 'min' ? 'selected' : ''}>ทีละ ${Number(r.minQty) || 20} ชิ้น</option>
        </select>
      </div>
    </div>`).join('');
}
function readWebAutoSellRules(box) {
  return Array.from(box.querySelectorAll('.ws-rule')).map(row => ({
    id: row.dataset.ruleId,
    itemName: row.querySelector('.ws-name').value.trim(),
    minQty: Math.max(1, parseInt(row.querySelector('.ws-min').value) || 1),
    sellMode: row.querySelector('.ws-mode').value,
    enabled: row.querySelector('.ws-en').checked
  }));
}
async function saveWebAutoSellRules(profileId, rules) {
  const d = activeWebHuds[profileId]?.data;
  if (d) d.autoMarketSellConfig = Object.assign({}, d.autoMarketSellConfig, { rules });
  const r = await sendWebHudAction(profileId, { type: 'update-autosell', config: { rules } });
  if (!r || r.success === false) showToast('❌ บันทึกรายการตั้งขายไม่สำเร็จ: ' + ((r && r.error) || 'จอเกมไม่ตอบ'), 'error');
}
function wireWebAutoSell(profileId, hudEl) {
  const box = hudEl.querySelector('#p-autosell-hud-rules-container');
  if (!box) return;
  let typing = null;
  const saveNow = () => saveWebAutoSellRules(profileId, readWebAutoSellRules(box));
  box.addEventListener('input', e => {
    if (!e.target.matches('.ws-name, .ws-min')) return;
    clearTimeout(typing);
    typing = setTimeout(saveNow, 700);
  });
  box.addEventListener('change', e => {
    if (!e.target.matches('.ws-mode, .ws-en, .ws-name, .ws-min')) return;
    clearTimeout(typing);
    saveNow();
    if (e.target.matches('.ws-en')) e.target.closest('.ws-rule').style.opacity = e.target.checked ? '' : '.55';
  });
  box.addEventListener('click', e => {
    const del = e.target.closest('.ws-del');
    if (!del) return;
    const row = del.closest('.ws-rule');
    const rules = readWebAutoSellRules(box).filter(r => r.id !== row.dataset.ruleId);
    saveWebAutoSellRules(profileId, rules);
    renderWebAutoSellRules(profileId, true);
  });
  // buttons of the HUD copy that pointed at in-game functions
  hudEl.querySelectorAll('button').forEach(btn => {
    const on = btn.getAttribute('onclick') || '';
    if (on.includes('addAutoMarketSellRule')) {
      btn.onclick = () => {
        const rules = box.querySelector('.ws-rule') ? readWebAutoSellRules(box) : webAutoSellRules(profileId);
        rules.push({ id: 'rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), itemName: '', minQty: 20, sellMode: 'all', enabled: true });
        saveWebAutoSellRules(profileId, rules);
        renderWebAutoSellRules(profileId, true);
        const names = box.querySelectorAll('.ws-name');
        if (names.length) names[names.length - 1].focus();
      };
    } else if (on.includes('runAutoMarketSellCycle')) {
      btn.onclick = async () => {
        const r = await sendWebHudAction(profileId, { type: 'trigger-autosell-now' });
        showToast(r && r.success !== false ? '⚡ สั่งตรวจสอบกระเป๋าและลงขายแล้ว (ดูผลในจอเกม)' : '❌ สั่งงานจอเกมไม่สำเร็จ', r && r.success !== false ? 'success' : 'error');
      };
    } else if (on.includes("showDataViewerModal('market')")) {
      btn.onclick = () => showToast('ตารางเต็มจอ (Data Hub) เปิดได้ในหน้าต่างเกม — รายการด้านบนแก้ได้จากหน้านี้เลย', 'warning');
    }
  });
  const toggle = hudEl.querySelector('#p-autosell-toggle-hud');
  if (toggle) toggle.onchange = e => sendWebHudAction(profileId, { type: 'update-autosell', config: { enabled: e.target.checked } });
  renderWebAutoSellRules(profileId, true);
}

function populateWebHudData(profileId, data) {
  if (!data) return;
  const hud = activeWebHuds[profileId]?.el;
  if (!hud) return;
  const isCentral = (profileId === '__central__');
  renderWebAutoSellRules(profileId);
  const autoTog = hud.querySelector('#p-autosell-toggle-hud');
  if (autoTog && document.activeElement !== autoTog && data.autoMarketSellConfig) autoTog.checked = !!data.autoMarketSellConfig.enabled;

  // Title: Only character / profile name (NO Pmhee), or Central Menu header
  const titleEl = hud.querySelector('.p-header-title');
  if (isCentral) {
    const onlineCount = currentProfiles.filter(p => p.isRunning).length;
    if (titleEl) titleEl.innerText = `🎛️ เมนูส่วนกลาง (${onlineCount} จอออนไลน์)`;
    const onlinePill = hud.querySelector('#p-central-online-pill');
    if (onlinePill) onlinePill.innerText = `ออนไลน์ ${onlineCount}/${currentProfiles.length} จอ`;
  } else {
    const charName = data.state?.charName || activeWebHuds[profileId]?.profile?.name;
    if (titleEl && charName) titleEl.innerText = charName;
  }

  // Header quick badges
  const quickZeny = hud.querySelector('#p-quick-zeny');
  if (quickZeny) {
    if (isCentral) {
      const totalZ = currentProfiles.reduce((acc, p) => acc + (typeof p.liveState?.zeny === 'number' ? p.liveState.zeny : 0), 0);
      quickZeny.innerText = '💰 รวม ' + totalZ.toLocaleString() + ' z';
    } else {
      const z = data.state?.zeny;
      quickZeny.innerText = '💰 ' + (typeof z === 'number' ? z.toLocaleString() + ' z' : '-- z');
    }
  }

  const quickAmmo = hud.querySelector('#p-quick-ammo');
  if (quickAmmo) {
    if (isCentral) {
      const runningBots = currentProfiles.filter(p => p.isRunning && p.liveState?.isBotRunning).length;
      quickAmmo.innerText = `🤖 บอทวิ่ง ${runningBots} จอ`;
    } else {
      quickAmmo.innerText = '🏹 ' + (data.currentAmmo ?? '--');
    }
  }

  const quickWeight = hud.querySelector('#p-quick-weight');
  if (quickWeight) {
    if (isCentral) {
      const premCount = currentProfiles.filter(p => isProfilePremium(p)).length;
      quickWeight.innerText = `👑 VIP ${premCount} จอ`;
    } else {
      quickWeight.innerText = '⚖️ ' + (data.state?.weight ?? '--%');
    }
  }

  // Status strip
  const mapEl = hud.querySelector('#p-cur-map-display');
  if (mapEl) mapEl.innerText = data.state?.map || data.targetFarmMap || 'รอระบุแมพ...';

  const charStateEl = hud.querySelector('#p-char-state');
  if (charStateEl) {
    if (data.state?.botStatus) {
      charStateEl.innerText = data.state.botStatus;
    } else if (data.isBotRunning) {
      charStateEl.innerText = '⚔️ Auto-Farm ทำงาน';
    } else {
      charStateEl.innerText = '⏸️ หยุดทำงาน';
    }
  }

  const posEl = hud.querySelector('#p-cur-pos');
  if (posEl) posEl.innerText = data.state?.coords || 'รอ Minimap...';

  // Toggle Bot Button (Exact in-game styling)
  const btn = hud.querySelector('#p-btn-toggle-bot');
  if (btn) {
    const isRunning = Boolean(data.isBotRunning);
    if (isRunning) {
      btn.innerHTML = '⏹️ STOP BOT (หยุดทำงาน)';
      btn.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
      btn.style.boxShadow = '0 0 14px rgba(239, 68, 68, 0.55)';
      btn.style.border = '1px solid #f87171';
      btn.style.color = '#fff';
    } else {
      btn.innerHTML = '▶️ START BOT (เริ่มทำงาน)';
      btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      btn.style.boxShadow = '0 0 14px rgba(16, 185, 129, 0.4)';
      btn.style.border = '1px solid #34d399';
      btn.style.color = '#fff';
    }
  }

  // Auto Loop & Plan Script Checkbox
  const autoLoopCb = hud.querySelector('#p-auto-loop');
  if (autoLoopCb && document.activeElement !== autoLoopCb) autoLoopCb.checked = !!data.autoLoopEnabled;

  const planScriptCb = hud.querySelector('#p-plan-script-enabled');
  if (planScriptCb && document.activeElement !== planScriptCb) planScriptCb.checked = !!data.planScriptEnabled;

  const planNameEl = hud.querySelector('#p-plan-name-display');
  if (planNameEl && data.currentPlanName !== undefined) {
    planNameEl.innerText = data.currentPlanName || '(ยังไม่เลือกแผน)';
  }

  // Farm Map Select & Travel Config
  const mapSelect = hud.querySelector('#p-target-map-select');
  if (mapSelect && data.targetFarmMap && document.activeElement !== mapSelect) mapSelect.value = data.targetFarmMap;

  const warpMinZenyInp = hud.querySelector('#p-warp-min-zeny');
  if (warpMinZenyInp && data.travelConfig && document.activeElement !== warpMinZenyInp) {
    warpMinZenyInp.value = Number(data.travelConfig.minZenyForWarp) || 0;
  }

  // Security & Humanize
  const unexpGuardCb = hud.querySelector('#p-unexpected-town-guard');
  if (unexpGuardCb && data.unexpectedTownGuardEnabled !== undefined && document.activeElement !== unexpGuardCb) {
    unexpGuardCb.checked = !!data.unexpectedTownGuardEnabled;
  }
  const unexpBox = hud.querySelector('#p-unexpected-town-box');
  if (unexpBox) unexpBox.style.display = data.unexpectedTownWaiting ? 'block' : 'none';
  const unexpCd = hud.querySelector('#p-unexpected-countdown');
  if (unexpCd && data.unexpectedTownCountdown) unexpCd.innerText = data.unexpectedTownCountdown;

  const humanize = data.humanizeConfig || {};
  const syncCb = (sel, val) => {
    const el = hud.querySelector(sel);
    if (el && val !== undefined && document.activeElement !== el) el.checked = !!val;
  };
  syncCb('#p-humanize-enabled', humanize.enabled);
  const humChance = hud.querySelector('#p-humanize-chance');
  const humChanceVal = humanize.chancePercent !== undefined ? humanize.chancePercent : humanize.chance;
  if (humChance && humChanceVal !== undefined && document.activeElement !== humChance) {
    humChance.value = humChanceVal;
  }
  syncCb('#p-humanize-blacksmith', humanize.visitBlacksmith !== undefined ? humanize.visitBlacksmith : humanize.buyBlacksmith);
  syncCb('#p-humanize-sundries', humanize.visitSundries !== undefined ? humanize.visitSundries : humanize.buySundries);
  syncCb('#p-humanize-walk', humanize.randomWalk);
  syncCb('#p-humanize-storage', humanize.openStorage !== undefined ? humanize.openStorage : humanize.storeDeposit);

  // Archer
  const archer = data.archerConfig || {};
  const ammoCount = hud.querySelector('#p-ammo-count');
  if (ammoCount) ammoCount.innerText = (data.currentAmmo ?? 0) + ' ดอก';

  const reqArrow = hud.querySelector('#p-archer-req');
  if (reqArrow && document.activeElement !== reqArrow) reqArrow.checked = !!archer.requireArrow;

  const autoEquipArrow = hud.querySelector('#p-archer-auto-equip');
  if (autoEquipArrow && archer.autoEquipArrow !== undefined && document.activeElement !== autoEquipArrow) {
    autoEquipArrow.checked = !!archer.autoEquipArrow;
  }

  const arrowType = hud.querySelector('#p-archer-type');
  if (arrowType && archer.arrowType && document.activeElement !== arrowType) arrowType.value = String(archer.arrowType);

  const arrowQty = hud.querySelector('#p-archer-qty');
  if (arrowQty && document.activeElement !== arrowQty) arrowQty.value = archer.arrowBuyQty || 5000;

  const arrowThresh = hud.querySelector('#p-archer-threshold');
  if (arrowThresh && document.activeElement !== arrowThresh) arrowThresh.value = archer.ammoThreshold || 50;

  const bwing = hud.querySelector('#p-archer-bwing');
  if (bwing && document.activeElement !== bwing) bwing.checked = !!archer.useBwing;

  const bwingQty = hud.querySelector('#p-archer-bwing-qty');
  if (bwingQty && document.activeElement !== bwingQty) bwingQty.value = archer.bwingBuyQty || 2;

  const bwingCountEl = hud.querySelector('#p-bwing-count');
  if (bwingCountEl && data.bwingCount !== undefined) {
    bwingCountEl.innerText = data.bwingCount >= 0 ? String(data.bwingCount) : 'รอเปิดกระเป๋า';
  }

  // Buff Potions
  const buffPotions = data.buffPotionConfig || {};
  const potionCounts = data.potionCounts || {};
  ['90306', '90307', '90308'].forEach(id => {
    const pCfg = buffPotions[id];
    if (pCfg) {
      const cb = hud.querySelector(`#p-potion-enable-${id}`);
      if (cb && document.activeElement !== cb) cb.checked = !!pCfg.enabled;
      const qty = hud.querySelector(`#p-potion-qty-${id}`);
      if (qty && document.activeElement !== qty && pCfg.targetQty !== undefined) qty.value = pCfg.targetQty;
    }
    const cntEl = hud.querySelector(`#p-potion-count-${id}`);
    if (cntEl && potionCounts[id] !== undefined) {
      cntEl.innerText = potionCounts[id] >= 0 ? String(potionCounts[id]) : 'รอเปิดกระเป๋า';
    }
  });

  // Sell
  const sell = data.sellConfig || {};
  const sellEn = hud.querySelector('#p-sell-enabled');
  if (sellEn && document.activeElement !== sellEn) sellEn.checked = !!sell.enabled;

  const weightCheckEn = hud.querySelector('#p-weight-check-enabled');
  if (weightCheckEn && document.activeElement !== weightCheckEn) weightCheckEn.checked = sell.weightCheckEnabled !== false;

  const weightThresh = hud.querySelector('#p-weight-threshold');
  if (weightThresh && document.activeElement !== weightThresh) weightThresh.value = sell.weightThreshold || 80;

  const curWeightVal = hud.querySelector('#p-cur-weight-val');
  if (curWeightVal) {
    const wStr = data.state?.weight || '--%';
    curWeightVal.innerText = wStr;
    const wNum = parseFloat(String(wStr).replace('%', ''));
    const wLim = Number(sell.weightThreshold) || 80;
    const alertBanner = hud.querySelector('#p-weight-alert-banner');
    if (Number.isFinite(wNum) && sell.weightCheckEnabled !== false && wNum >= wLim) {
      curWeightVal.style.color = '#f87171';
      if (alertBanner) alertBanner.style.display = 'block';
    } else {
      curWeightVal.style.color = '#22c55e';
      if (alertBanner) alertBanner.style.display = 'none';
    }
  }

  const syncSel = (id, val) => {
    const el = hud.querySelector(id);
    if (el && val !== undefined && document.activeElement !== el) el.value = val;
  };
  syncSel('#p-sell-rarity-weap', sell.weaponRarity);
  syncSel('#p-sell-rarity-armor', sell.armorRarity);
  syncSel('#p-sell-rarity-acc', sell.accRarity);
  syncSel('#p-sell-rarity-mat', !sell.sellMaterials ? 'none' : (sell.materialMode === 'common' ? 'common' : 'all'));
  syncSel('#p-sell-refine-ores', sell.sellRefineOres ? 'unlisted' : 'keep');

  const keepRef = hud.querySelector('#p-sell-keep-refined');
  if (keepRef && document.activeElement !== keepRef) keepRef.checked = sell.keepRefined !== false;

  const keepSpec = hud.querySelector('#p-sell-keep-special');
  if (keepSpec && document.activeElement !== keepSpec) keepSpec.checked = !!sell.keepSpecial;

  const keepSock = hud.querySelector('#p-sell-keep-sockets');
  if (keepSock && document.activeElement !== keepSock) keepSock.checked = !!sell.keepSockets;

  const sellWl = hud.querySelector('#p-sell-whitelist');
  if (sellWl && document.activeElement !== sellWl) sellWl.value = sell.whitelist || '';
  [['#p-store-enabled', !!sell.storeEnabled], ['#p-store-weapon', sell.storeWeapon !== false], ['#p-store-armor', sell.storeArmor !== false],
   ['#p-store-acc', sell.storeAcc !== false], ['#p-store-refine', sell.storeRefine !== false], ['#p-store-skip-locked', sell.storeSkipLocked !== false]].forEach(([id, v]) => {
    const el = hud.querySelector(id);
    if (el && document.activeElement !== el) el.checked = v;
  });

  // Stat Filter sync
  const activeHud = activeWebHuds[profileId];
  const sfCard = hud.querySelector('#p-sell-stats-filter-card');
  if (sell.statsFilter && activeHud && sfCard && !sfCard.contains(document.activeElement)) {
    const incStr = JSON.stringify(sell.statsFilter);
    if (JSON.stringify(activeHud.currentStatsFilter) !== incStr) {
      activeHud.currentStatsFilter = Object.assign({}, sell.statsFilter);
      if (typeof activeHud.renderStatsFilter === 'function') activeHud.renderStatsFilter();
    }
  }

  // Market Sniper Filter sync
  const mk = data.marketFilterConfig || {};
  [
    ['#p-mk-search-query', mk.q, 'text'],
    ['#p-mk-cat-select', mk.category, 'text'],
    ['#p-mk-kind-select', mk.kind, 'text'],
    ['#p-mk-min-refine', mk.minRefine, 'int'],
    ['#p-mk-max-price', mk.maxPrice, 'int'],
    ['#p-mk-stat1-type', mk.statType1, 'text'],
    ['#p-mk-stat1-min', mk.statMinVal1, 'int'],
    ['#p-mk-stat2-type', mk.statType2, 'text'],
    ['#p-mk-stat2-min', mk.statMinVal2, 'int'],
    ['#p-mk-stat-mode', mk.statMatchMode, 'text'],
    ['#p-mk-sniper-alert', mk.sniperAlert, 'bool'],
    ['#p-mk-auto-buy', mk.autoBuy, 'bool']
  ].forEach(([sel, val, kind]) => {
    if (val === undefined) return;
    const el = hud.querySelector(sel);
    if (!el || document.activeElement === el) return;
    if (kind === 'bool') el.checked = !!val;
    else el.value = String(val ?? '');
  });

  // Shop & System Tab
  const shop = data.shopConfig || {};
  syncCb('#p-shop-enabled', shop.enabled);
  const shopKeyEl = hud.querySelector('#p-shop-npckey');
  if (shopKeyEl && shop.npcKey !== undefined && document.activeElement !== shopKeyEl) shopKeyEl.value = shop.npcKey || 'tools';

  syncCb('#p-ultra-low-spec', data.ultraLowSpecEnabled !== false);
  syncCb('#p-auto-config-char', data.autoConfigCharEnabled !== false);
  syncCb('#p-auto-mute-display', data.autoMuteDisplayEnabled !== false);

  // Auth
  const auth = data.authConfig || {};
  const authEn = hud.querySelector('#p-auth-enabled');
  if (authEn && document.activeElement !== authEn) authEn.checked = !!auth.enabled;

  const authUs = hud.querySelector('#p-auth-user');
  if (authUs && document.activeElement !== authUs) authUs.value = auth.username || '';

  const authPs = hud.querySelector('#p-auth-pass');
  if (authPs && document.activeElement !== authPs) authPs.placeholder = auth.hasPassword ? '•••••• (มีแล้ว)' : 'รหัสผ่าน';

  const authCh = hud.querySelector('#p-auth-char');
  if (authCh && document.activeElement !== authCh) authCh.value = auth.charName || '';

  const authRes = hud.querySelector('#p-auth-resume');
  if (authRes && document.activeElement !== authRes) authRes.checked = !!auth.autoResumeBot;
}

async function sendWebHudAction(profileId, payload) {
  try {
    if (profileId === '__central__') {
      const online = currentProfiles.filter(p => p.isRunning);
      if (online.length === 0) {
        showToast('⚠️ ไม่มีจอเกมที่กำลังออนไลน์ให้สั่งการ', 'warning');
        return { success: false, error: 'ไม่มีจอเกมที่กำลังออนไลน์' };
      }
      const centralPayload = Object.assign({}, payload, { targetProfileIds: online.map(p => p.id) });
      const resp = await fetch(API_BASE + '/api/profiles/__central__/client-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(centralPayload)
      });
      const j = await resp.json().catch(() => ({}));
      if (resp.ok && typeof j.updatedCount === 'number') {
        const okCount = j.updatedCount;
        const total = j.totalOnline || online.length;
        showToast(`🎛️ เมนูส่วนกลาง: อัปเดตไปยัง ${okCount}/${total} จอเรียบร้อย`, okCount > 0 ? 'success' : 'error');
        setTimeout(() => { updateActiveWebHuds(); }, 250);
        return { success: okCount > 0, updatedCount: okCount, totalOnline: total };
      }
      // Fallback if server was not restarted yet
      const results = await Promise.allSettled(online.map(async (p) => {
        const r = await fetch(API_BASE + '/api/profiles/' + p.id + '/client-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const rj = await r.json().catch(() => ({}));
        return Boolean(r.ok && rj.success !== false);
      }));
      const okCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
      showToast(`🎛️ เมนูส่วนกลาง: อัปเดตไปยัง ${okCount}/${online.length} จอเรียบร้อย`, okCount > 0 ? 'success' : 'error');
      setTimeout(() => { updateActiveWebHuds(); }, 250);
      return { success: okCount > 0, updatedCount: okCount, totalOnline: online.length };
    }

    const resp = await fetch(API_BASE + '/api/profiles/' + profileId + '/client-action', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    let out;
    try { out = await resp.json(); } catch (e) { out = { success: false, error: 'HTTP ' + resp.status }; }
    // Immediately pull refreshed data
    setTimeout(async () => {
      const res = await fetch(API_BASE + '/api/profiles/' + profileId + '/client-data');
      const json = await res.json();
      if (json.success && json.data) {
        if (activeWebHuds[profileId]) activeWebHuds[profileId].data = json.data;
        populateWebHudData(profileId, json.data);
      }
    }, 250);
    return out;
  } catch(e) {
    console.error("sendWebHudAction error:", e);
    return { success: false, error: e.message };
  }
}

async function updateActiveWebHuds() {
  const openIds = Object.keys(activeWebHuds);
  for (const id of openIds) {
    if (id === '__central__') {
      const hud = activeWebHuds[id]?.el;
      if (hud) {
        const onlineCount = currentProfiles.filter(p => p.isRunning).length;
        const titleEl = hud.querySelector('.p-header-title');
        if (titleEl) titleEl.innerText = `🎛️ เมนูส่วนกลาง (${onlineCount} จอออนไลน์)`;
        const onlinePill = hud.querySelector('#p-central-online-pill');
        if (onlinePill) onlinePill.innerText = `ออนไลน์ ${onlineCount}/${currentProfiles.length} จอ`;
        const quickZeny = hud.querySelector('#p-quick-zeny');
        if (quickZeny) {
          const totalZ = currentProfiles.reduce((acc, p) => acc + (typeof p.liveState?.zeny === 'number' ? p.liveState.zeny : 0), 0);
          quickZeny.innerText = '💰 รวม ' + totalZ.toLocaleString() + ' z';
        }
        const quickAmmo = hud.querySelector('#p-quick-ammo');
        if (quickAmmo) {
          const runningBots = currentProfiles.filter(p => p.isRunning && p.liveState?.isBotRunning).length;
          quickAmmo.innerText = `🤖 บอทวิ่ง ${runningBots} จอ`;
        }
        const quickWeight = hud.querySelector('#p-quick-weight');
        if (quickWeight) {
          const premCount = currentProfiles.filter(p => isProfilePremium(p)).length;
          quickWeight.innerText = `👑 VIP ${premCount} จอ`;
        }
      }
      continue;
    }
    try {
      const res = await fetch(API_BASE + '/api/profiles/' + id + '/client-data');
      const json = await res.json();
      if (json.success && json.data) {
        activeWebHuds[id].data = json.data;
        populateWebHudData(id, json.data);
      }
    } catch(e) {}
  }
}

// ==========================================
// SCRIPT PLAN WORKFLOW BUILDER (n8n-style)
// ==========================================
let currentPlanProfiles = [];
let currentPlanAssignments = {};
let activePlanClientProfileId = null;
let activeEditingPlan = null;

// Same map values as the in-game HUD select (the bot walks by these names)
const PLAN_MAP_OPTIONS = [
  {
    "group": "🏰 เขตเมือง & พื้นที่ปลอดภัย",
    "maps": [
      {
        "value": "เมืองหลวงโซลเฮเวน",
        "label": "เมืองหลวงโซลเฮเวน (ปลอดภัย)"
      },
      {
        "value": "ตลาดคาราวาน",
        "label": "ตลาดคาราวาน (ปลอดภัย)"
      }
    ]
  },
  {
    "group": "🌱 แมพระดับเริ่มต้น (Lv. 1-12)",
    "maps": [
      {
        "value": "สวนนักผจญภัยมือใหม่",
        "label": "สวนนักผจญภัยมือใหม่ (Lv. 1-3)"
      },
      {
        "value": "ทุ่งโคลเวอร์",
        "label": "ทุ่งโคลเวอร์ (Lv. 1-5)"
      },
      {
        "value": "ทุ่งหญ้าตะวันออก",
        "label": "ทุ่งหญ้าตะวันออก (Lv. 1-5)"
      },
      {
        "value": "ไร่ซันเกรน",
        "label": "ไร่ซันเกรน (Lv. 1-6)"
      },
      {
        "value": "ถนนต้นหลิว",
        "label": "ถนนต้นหลิว (Lv. 6-12)"
      }
    ]
  },
  {
    "group": "⚔️ แมพยอดนิยมระดับกลาง (Lv. 12-35)",
    "maps": [
      {
        "value": "ทะเลสาบอาซูร์",
        "label": "ทะเลสาบอาซูร์ (Lv. 12-20)"
      },
      {
        "value": "ป่ามูนลีฟ",
        "label": "ป่ามูนลีฟ (Lv. 14-22)"
      },
      {
        "value": "เส้นทางก็อบลิน",
        "label": "เส้นทางก็อบลิน (Lv. 16-20)"
      },
      {
        "value": "เหมืองคริสตัลเก่า",
        "label": "เหมืองคริสตัลเก่า (Lv. 18-28)"
      },
      {
        "value": "ค่ายออร์ค",
        "label": "ค่ายออร์ค (Lv. 22-32)"
      },
      {
        "value": "ถ้ำเอมเบอร์",
        "label": "ถ้ำเอมเบอร์ (Lv. 22-32)"
      },
      {
        "value": "ที่ราบสูงเกล",
        "label": "ที่ราบสูงเกล (Lv. 25-35)"
      }
    ]
  },
  {
    "group": "🏔️ แมพระดับกลางสูง (Lv. 30-60)",
    "maps": [
      {
        "value": "แอ่งเวอร์แดนท์",
        "label": "แอ่งเวอร์แดนท์ (Lv. 30-40)"
      },
      {
        "value": "ช่องเขาฟรอสต์พีค",
        "label": "ช่องเขาฟรอสต์พีค (Lv. 35-45)"
      },
      {
        "value": "ชายฝั่งปะการัง",
        "label": "ชายฝั่งปะการัง (Lv. 40-50)"
      },
      {
        "value": "ซากโบราณสถาน",
        "label": "ซากโบราณสถาน (Lv. 45-55)"
      },
      {
        "value": "สุสานเงา",
        "label": "สุสานเงา (Lv. 50-60)"
      }
    ]
  },
  {
    "group": "🔥 แมพระดับสูง & แดนอันตราย (Lv. 60-150)",
    "maps": [
      {
        "value": "หนองพิษ",
        "label": "หนองพิษ (Lv. 60-70)"
      },
      {
        "value": "โบสถ์อเวจี",
        "label": "โบสถ์อเวจี (Lv. 80-95)"
      },
      {
        "value": "บึงรากเน่า",
        "label": "บึงรากเน่า (Lv. 90-105)"
      },
      {
        "value": "เนินทรายแผดเผา",
        "label": "เนินทรายแผดเผา (Lv. 100-115)"
      },
      {
        "value": "พีระมิดจมทราย",
        "label": "พีระมิดจมทราย (Lv. 115-130)"
      },
      {
        "value": "แกนลาวา",
        "label": "แกนลาวา (Lv. 135-150)"
      }
    ]
  }
];

// Class ids as the game uses them (lowercase)
const PLAN_CLASS_OPTIONS = [
  {
    "value": "novice",
    "label": "Novice (โนวิซ)"
  },
  {
    "value": "archer",
    "label": "Archer (นักธนู)"
  },
  {
    "value": "swordsman",
    "label": "Swordsman (นักดาบ)"
  },
  {
    "value": "mage",
    "label": "Mage (นักเวท)"
  },
  {
    "value": "thief",
    "label": "Thief (โจร)"
  },
  {
    "value": "acolyte",
    "label": "Acolyte (นักบวชฝึกหัด)"
  },
  {
    "value": "merchant",
    "label": "Merchant (พ่อค้า)"
  },
  {
    "value": "hunter",
    "label": "Hunter (นักล่า)"
  },
  {
    "value": "bard",
    "label": "Bard (กวี)"
  },
  {
    "value": "dancer",
    "label": "Dancer (นักเต้น)"
  },
  {
    "value": "knight",
    "label": "Knight (อัศวิน)"
  },
  {
    "value": "crusader",
    "label": "Crusader (ครูเซเดอร์)"
  },
  {
    "value": "wizard",
    "label": "Wizard (จอมเวท)"
  },
  {
    "value": "sage",
    "label": "Sage (นักปราชญ์)"
  },
  {
    "value": "assassin",
    "label": "Assassin (นักฆ่า)"
  },
  {
    "value": "rogue",
    "label": "Rogue (โร้ก)"
  },
  {
    "value": "priest",
    "label": "Priest (พรีสต์)"
  },
  {
    "value": "monk",
    "label": "Monk (มองค์)"
  },
  {
    "value": "blacksmith",
    "label": "Blacksmith (ช่างตีเหล็ก)"
  },
  {
    "value": "alchemist",
    "label": "Alchemist (นักเล่นแร่แปรธาตุ)"
  }
];

// Open Plan Modal
async function openScriptPlanModal(profileId) {
  activePlanClientProfileId = profileId;
  const clientProfile = currentProfiles.find(p => p.id === profileId);

  const targetNameEl = document.getElementById("plan-target-client-name");
  const targetIdInput = document.getElementById("plan-target-client-id");
  if (targetNameEl) targetNameEl.innerText = clientProfile ? `${clientProfile.name} (Port: ${clientProfile.debugPort || '--'})` : profileId;
  if (targetIdInput) targetIdInput.value = profileId;

  switchPlanModalView('list');

  const modal = document.getElementById("plan-modal");
  if (modal) modal.classList.add("active");

  await fetchAndRenderPlanProfiles();
  startPlanLiveStatus();
}

function closeScriptPlanModal() {
  const modal = document.getElementById("plan-modal");
  if (modal) modal.classList.remove("active");
  activePlanClientProfileId = null;
  activeEditingPlan = null;
}

function switchPlanModalView(view) {
  const viewList = document.getElementById("plan-view-list");
  const viewEditor = document.getElementById("plan-view-editor");
  if (view === 'list') {
    if (viewList) viewList.style.display = 'flex';
    if (viewEditor) viewEditor.style.display = 'none';
  } else if (view === 'editor') {
    if (viewList) viewList.style.display = 'none';
    if (viewEditor) viewEditor.style.display = 'flex';
  }
}

// Fetch Plan Profiles from Backend
async function fetchAndRenderPlanProfiles() {
  try {
    const res = await fetch(`${API_BASE}/api/plan-profiles`);
    const data = await res.json();
    if (data.success) {
      currentPlanProfiles = data.profiles || [];
      currentPlanAssignments = data.assignments || {};
    }
  } catch(e) {
    console.error("Failed to load plan profiles:", e);
  }

  renderPlanProfilesList();
}

function renderPlanProfilesList() {
  const container = document.getElementById("plan-profiles-list-container");
  const activeBadge = document.getElementById("plan-active-badge");
  if (!container) return;

  const currentAssignedPlanId = currentPlanAssignments[activePlanClientProfileId];
  const assignedPlan = currentPlanProfiles.find(p => p.id === currentAssignedPlanId);

  if (activeBadge) {
    if (assignedPlan) {
      activeBadge.innerText = assignedPlan.name;
      activeBadge.style.background = 'rgba(34, 197, 94, 0.18)';
      activeBadge.style.color = '#4ade80';
      activeBadge.style.borderColor = 'rgba(34, 197, 94, 0.3)';
    } else {
      activeBadge.innerText = 'ยังไม่ได้กำหนดแผน';
      activeBadge.style.background = 'rgba(148, 163, 184, 0.12)';
      activeBadge.style.color = '#94a3b8';
      activeBadge.style.borderColor = 'rgba(148, 163, 184, 0.2)';
    }
  }

  if (currentPlanProfiles.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: #94a3b8; padding: 30px; font-size: 13px;">
        <span style="font-size: 28px; opacity: 0.6; display: block; margin-bottom: 8px;">📜</span>
        ยังไม่มี Plan Profile ในระบบ<br>
        คลิกปุ่ม <b>"➕ เพิ่ม Plan Profile ใหม่"</b> ด้านบนเพื่อเริ่มสร้างแผนแรกของคุณ
      </div>
    `;
    return;
  }

  container.innerHTML = currentPlanProfiles.map(plan => {
    const isAssigned = (plan.id === currentAssignedPlanId);
    const triggersCount = (plan.triggers || []).length;
    let actionsCount = 0;
    (plan.triggers || []).forEach(t => actionsCount += (t.actions || []).length);

    return `
      <div class="plan-profile-item ${isAssigned ? 'active-assigned' : ''}">
        <div style="display: flex; flex-direction: column; gap: 4px; flex: 1;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 14px; font-weight: 700; color: #f8fafc;">${escapeHTML(plan.name)}</span>
            <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); font-size: 10px; padding: 1px 6px;">
              🏹 ${escapeHTML(plan.class1Target || 'Archer')} ➔ 👑 ${escapeHTML(plan.class2Target || 'Hunter')} <small style="opacity: 0.75;">(Job ${plan.class2JobLevel || 50})</small>
            </span>
            ${(plan.skillBuild?.skillPointQueue?.length > 0) ? `
              <span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.35); font-size: 10px; padding: 1px 6px;">
                ⚡ ${plan.skillBuild.skillPointQueue.length} แต้ม
              </span>
            ` : ''}
            ${plan.statBuild ? `
              <span class="badge" style="background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.35); font-size: 10px; padding: 1px 6px;">
                📊 Stat Build
              </span>
            ` : ''}
            ${(plan.gearPlan?.steps?.length > 0) ? `
              <span class="badge" style="background: rgba(34, 197, 94, 0.15); color: #86efac; border: 1px solid rgba(34, 197, 94, 0.35); font-size: 10px; padding: 1px 6px;">
                🛡️ เซ็ต ${plan.gearPlan.steps.length} รายการ
              </span>
            ` : ''}
            ${isAssigned ? `
              <span class="badge" style="background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4); font-size: 10px; padding: 1px 6px; border-radius: 4px;">
                ⚡ กำลังใช้งานกับจอนี้
              </span>
            ` : ''}
          </div>
          <div style="display: flex; align-items: center; gap: 12px; font-size: 11.5px; color: #94a3b8;">
            <span>🎯 <b>${triggersCount}</b> ระดับเลเวล</span>
            <span>⚡ <b>${actionsCount}</b> การทำงาน (Actions)</span>
            <span style="opacity: 0.8;">${escapeHTML(plan.description || '')}</span>
          </div>
        </div>

        <div style="display: flex; gap: 6px; align-items: center;">
          <button type="button" class="btn btn-primary btn-sm" onclick="openPlanWorkflowEditor('${plan.id}')" title="เปิดหน้าต่างแก้ไขแผนสไตล์ n8n">
            <span>✏️</span> Edit
          </button>
          <button type="button" class="btn ${isAssigned ? 'btn-secondary' : 'btn-success'} btn-sm" onclick="openPlanAssignPicker('${plan.id}')" title="เลือกจอเกมที่จะใช้แผนนี้">
            <span>⚡</span> ${isAssigned ? 'ซิงค์ซ้ำ' : 'ใช้งาน'}
          </button>
          <button type="button" class="btn btn-secondary btn-sm btn-icon" onclick="exportPlanProfiles(['${plan.id}'])" title="ส่งออกแผนนี้เป็นไฟล์ (Export)">
            <span>📤</span>
          </button>
          <button type="button" class="btn btn-secondary btn-sm btn-icon" onclick="duplicatePlanProfile('${plan.id}')" title="ทำสำเนาแผนนี้">
            <span>📋</span>
          </button>
          <button type="button" class="btn btn-danger btn-sm btn-icon" onclick="deletePlanProfile('${plan.id}')" title="ลบแผนนี้">
            <span>➖</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Create new Plan Profile
async function createNewPlanProfile() {
  const name = prompt("ตั้งชื่อ Plan Profile ใหม่:", "แผนเก็บเลเวล Archer " + (currentPlanProfiles.length + 1));
  if (!name || !name.trim()) return;

  try {
    const res = await fetch(`${API_BASE}/api/plan-profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        description: "สร้างเมื่อ " + new Date().toLocaleDateString('th-TH'),
        triggers: [
          {
            id: "trig_" + Date.now(),
            type: "base_level",
            targetLevel: 8,
            actions: [
              {
                id: "act_" + Date.now(),
                type: "equip_item",
                itemName: "Gakkung Bow",
                optionFilter: "",
                buyFromMarket: true,
                maxPrice: 100000
              }
            ]
          }
        ]
      })
    });
    const result = await res.json();
    if (result.success && result.profile) {
      await fetchAndRenderPlanProfiles();
      openPlanWorkflowEditor(result.profile.id);
    }
  } catch(e) {
    alert("เกิดข้อผิดพลาดในการสร้างแผนใหม่");
  }
}

// Delete Plan Profile
async function deletePlanProfile(planId) {
  const plan = currentPlanProfiles.find(p => p.id === planId);
  if (!plan) return;
  if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบแผน "${plan.name}"?\n(หากมีจอเกมที่ใช้แผนนี้อยู่ แผนจะถูกยกเลิก)`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/plan-profiles/${planId}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      await fetchAndRenderPlanProfiles();
    }
  } catch(e) {
    alert("เกิดข้อผิดพลาดในการลบแผน");
  }
}

// Duplicate Plan Profile
async function duplicatePlanProfile(planId) {
  const plan = currentPlanProfiles.find(p => p.id === planId);
  if (!plan) return;

  try {
    const res = await fetch(`${API_BASE}/api/plan-profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign(JSON.parse(JSON.stringify(plan)), { id: undefined, name: plan.name + " (Copy)", autoJobChange: planAutoJobChangeOf(plan) }))
    });
    const result = await res.json();
    if (result.success) {
      await fetchAndRenderPlanProfiles();
    }
  } catch(e) {
    alert("เกิดข้อผิดพลาดในการทำสำเนาแผน");
  }
}

// ---------- "ใช้งาน": pick which game clients (sessions) use this plan ----------
function openPlanAssignPicker(planId) {
  const plan = currentPlanProfiles.find(p => p.id === planId);
  if (!plan) return;

  let modal = document.getElementById('plan-assign-picker');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'plan-assign-picker';
    modal.className = 'modal-overlay';
    modal.style.zIndex = '1200';
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
  }

  const planName = id => (currentPlanProfiles.find(p => p.id === id) || {}).name || '';
  const rows = currentProfiles.map(p => {
    const st = p.liveState || {};
    const assigned = currentPlanAssignments[p.id];
    const checked = assigned === planId || (!Object.values(currentPlanAssignments).includes(planId) && p.id === activePlanClientProfileId);
    const charLabel = st.charName || p.lastCharName || '';
    const cls = st.charClass || p.lastCharClass || p.charClass || '';
    const other = assigned && assigned !== planId ? `<span class="pp-other">ตอนนี้ใช้: ${escapeHTML(planName(assigned) || assigned)}</span>` : '';
    return `
      <label class="pp-row">
        <input type="checkbox" value="${escapeHTML(p.id)}" ${checked ? 'checked' : ''} data-was="${assigned === planId ? '1' : ''}">
        <span class="pp-dot ${p.isRunning ? 'on' : ''}" title="${p.isRunning ? 'ออนไลน์' : 'ออฟไลน์'}"></span>
        <span class="pp-main">
          <b>${escapeHTML(p.name || p.id)}</b>
          <small>${escapeHTML(charLabel)}${cls ? ' · ' + escapeHTML(cls) : ''} · Port ${escapeHTML(String(p.debugPort || '-'))}</small>
        </span>
        ${assigned === planId ? '<span class="pp-cur">ใช้แผนนี้อยู่</span>' : other}
      </label>`;
  }).join('');

  modal.innerHTML = `
    <div class="modal-card pp-card">
      <div class="pp-head">
        <div>
          <h3>⚡ ใช้แผน "${escapeHTML(plan.name)}" กับจอไหนบ้าง?</h3>
          <p>ติ๊กจอที่ต้องการ — จอที่เอาติ๊กออกจะถูกถอดแผนนี้ (ปิด Plan Script ของจอนั้น)</p>
        </div>
        <button type="button" class="pp-x" onclick="document.getElementById('plan-assign-picker').classList.remove('active')">✕</button>
      </div>
      <div class="pp-tools">
        <button type="button" class="btn btn-secondary btn-sm" id="pp-all">เลือกทั้งหมด</button>
        <button type="button" class="btn btn-secondary btn-sm" id="pp-none">ไม่เลือกเลย</button>
      </div>
      <div class="pp-list">${rows || '<div class="pp-empty">ยังไม่มีโปรไฟล์จอเกม</div>'}</div>
      <div class="pp-foot">
        <span class="pp-hint">จอที่ออฟไลน์จะได้รับแผนและเปิด Plan Script เองเมื่อเปิดจอ</span>
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('plan-assign-picker').classList.remove('active')">ยกเลิก</button>
        <button type="button" class="btn btn-success" id="pp-ok">⚡ ยืนยัน</button>
      </div>
    </div>`;

  const boxes = () => Array.from(modal.querySelectorAll('.pp-list input[type=checkbox]'));
  modal.querySelector('#pp-all').onclick = () => boxes().forEach(b => { b.checked = true; });
  modal.querySelector('#pp-none').onclick = () => boxes().forEach(b => { b.checked = false; });
  modal.querySelector('#pp-ok').onclick = async () => {
    const add = boxes().filter(b => b.checked).map(b => b.value);
    const remove = boxes().filter(b => !b.checked && b.dataset.was === '1').map(b => b.value);
    if (!add.length && !remove.length) { modal.classList.remove('active'); return; }
    const okBtn = modal.querySelector('#pp-ok');
    okBtn.disabled = true;
    okBtn.textContent = '⏳ กำลังส่งแผน...';
    try {
      const res = await fetch(`${API_BASE}/api/plan-profiles/${planId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientProfileIds: add, unassignProfileIds: remove })
      });
      const result = await res.json();
      if (result.success) {
        modal.classList.remove('active');
        alert(`⚡ ${result.message}`);
        await fetchAndRenderPlanProfiles();
        if (typeof refreshPlanLiveStatus === 'function') refreshPlanLiveStatus();
      } else {
        alert('❌ ' + (result.error || 'ผูกแผนไม่สำเร็จ'));
      }
    } catch (e) {
      alert('❌ เชื่อมต่อ Manager ไม่ได้');
    }
    okBtn.disabled = false;
    okBtn.textContent = '⚡ ยืนยัน';
  };
  modal.classList.add('active');
}

// Assign Plan to Active Client Card
async function assignPlanToActiveClient(planId) {
  if (!activePlanClientProfileId) return;

  try {
    const res = await fetch(`${API_BASE}/api/plan-profiles/${planId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientProfileId: activePlanClientProfileId })
    });
    const result = await res.json();
    if (result.success) {
      alert(`⚡ ${result.message || 'ผูกแผนกับจอนี้เรียบร้อยแล้ว!'}`);
      await fetchAndRenderPlanProfiles();
    }
  } catch(e) {
    alert("เกิดข้อผิดพลาดในการผูกแผน");
  }
}

// Open Visual Workflow Editor for a Plan
function openPlanWorkflowEditor(planId) {
  const plan = currentPlanProfiles.find(p => p.id === planId);
  if (!plan) return;

  activeEditingPlan = JSON.parse(JSON.stringify(plan));
  if (!activeEditingPlan.class1Target) activeEditingPlan.class1Target = 'archer';
  if (!activeEditingPlan.class2Target) activeEditingPlan.class2Target = 'hunter';
  if (!activeEditingPlan.skillBuild) activeEditingPlan.skillBuild = { skillPointQueue: [], plannedLevels: {} };
  if (!activeEditingPlan.statBuild) activeEditingPlan.statBuild = { targets: { STR: 1, AGI: 50, VIT: 1, INT: 1, DEX: 99, LUK: 30 }, priorityOrder: ['DEX', 'AGI', 'LUK', 'VIT', 'INT', 'STR'] };

  const titleInput = document.getElementById("plan-editor-title");
  const descInput = document.getElementById("plan-editor-desc");
  if (titleInput) titleInput.value = activeEditingPlan.name || "Untitled Plan";
  if (descInput) descInput.value = activeEditingPlan.description || "";

  // Initialize Class Selectors and Badges
  if (typeof updateClassDropdownsInEditor === 'function') {
    updateClassDropdownsInEditor();
  }
  if (typeof updatePlanEditorBadges === 'function') {
    updatePlanEditorBadges();
  }

  sortPlanTriggers();
  renderPlanWorkflowCanvas();
  markPlanDirty(false);
  switchPlanModalView('editor');
}

// ---------- Plan editor: trigger timeline (n8n-style) ----------
const planCollapsedTriggers = new Set();
let planEditorDirty = false;

function markPlanDirty(dirty = true) {
  planEditorDirty = dirty;
  const badge = document.getElementById('plan-editor-dirty');
  if (badge) badge.style.display = dirty ? '' : 'none';
}

function confirmDiscardPlanChanges() {
  return !planEditorDirty || confirm('แผนนี้มีการแก้ไขที่ยังไม่ได้บันทึก — ปิดโดยไม่บันทึกใช่ไหม?');
}

function planMapLabel(value) {
  for (const g of PLAN_MAP_OPTIONS) {
    const m = g.maps.find(x => x.value === value);
    if (m) return m.label;
  }
  return value || '-';
}

// Same arrow list as the in-game HUD (ธนู tab)
const PLAN_ARROW_OPTIONS = [
  { value: 90030, label: 'Arrow (ธรรมดา - 1z)' },
  { value: 90031, label: 'Fire Arrow (ไฟ - 3z)' },
  { value: 90032, label: 'Crystal Arrow (น้ำ - 3z)' },
  { value: 90033, label: 'Stone Arrow (ดิน - 3z)' },
  { value: 90034, label: 'Arrow of Wind (ลม - 3z)' },
  { value: 90035, label: 'Poison Arrow (พิษ - 3z)' },
  { value: 90036, label: 'Silver Arrow (ศักดิ์สิทธิ์ - 3z)' },
  { value: 90037, label: 'Shadow Arrow (เงา - 3z)' }
];
function planArrowLabel(value) {
  const a = PLAN_ARROW_OPTIONS.find(x => x.value === Number(value));
  return a ? a.label : 'Arrow';
}

function planClassLabel(value) {
  const c = PLAN_CLASS_OPTIONS.find(x => x.value === String(value || '').toLowerCase());
  return c ? c.label : (value || '-');
}

// Short chips shown in the trigger header so the whole plan reads at a glance
function planActionSummary(act) {
  if (act.type === 'equip_item') return `🛡️ ${act.itemName || '(ยังไม่ใส่ชื่อ)'}${act.optionFilter ? ` [${act.optionFilter}]` : ''}`;
  if (act.type === 'change_map') return `🗺️ ${planMapLabel(act.targetMap)}`;
  if (act.type === 'change_class') return `🏹 ${planClassLabel(act.targetClass)}`;
  if (act.type === 'sell_trip') return '🛒 กลับเมืองขายของ';
  if (act.type === 'weight_scroll') return `📦 Weight Scroll x${act.qty || 10}`;
  if (act.type === 'set_arrow') return act.requireArrow === false ? '🎯 ลูกธนู: ปิด' : `🎯 ลูกธนู ${planArrowLabel(act.arrowType).split(' (')[0]} x${act.arrowBuyQty || 200}`;
  return act.type;
}

// "เปลี่ยนอาชีพอัตโนมัติ": plans without the setting are automatic unless they already have a
// "เปลี่ยนอาชีพ" action (same rule as the bot)
function planHasClassAction(plan) {
  return (plan.triggers || []).some(t => (t.actions || []).some(a => a.type === 'change_class'));
}
function planAutoJobChangeOf(plan) {
  if (!plan) return false;
  return typeof plan.autoJobChange === 'boolean' ? plan.autoJobChange : !planHasClassAction(plan);
}
function refreshAutoJobUi() {
  const on = planAutoJobChangeOf(activeEditingPlan);
  document.querySelectorAll('.pe-joblv').forEach(el => { el.style.display = on ? '' : 'none'; });
  const hint = document.getElementById('plan-autojob-hint');
  if (hint) hint.innerHTML = on
    ? 'ℹ️ <b>เปลี่ยนอาชีพอัตโนมัติ:</b> เมื่อถึง Job Lv. ที่ตั้งไว้และเกมเปิดให้เปลี่ยน บอทจะใช้แต้มสกิลตามคิวให้หมดก่อน แล้วไปคุยกับ Valkyrie เปลี่ยนอาชีพให้เอง'
    : 'ℹ️ <b>เปลี่ยนอาชีพเอง:</b> บอทจะเปลี่ยนอาชีพเฉพาะตอนที่ถึงเงื่อนไขที่มี Action <b>🏹 เปลี่ยนอาชีพ</b> เช่น <b>Job Lv.10 (โนวิซ)</b> → เปลี่ยนอาชีพ → สวมใส่ Bow (Action ในเงื่อนไขทำตามลำดับจากบนลงล่าง) · Class 1/2 ด้านบนใช้กับหน้าจัดการสกิล';
}

// Job Lv. starts at 1 again with every class -> job triggers say which class they belong to
function planClassTier(cls) {
  const c = String(cls || '').toLowerCase();
  if (!c) return 9;
  if (c === 'novice') return 0;
  if (typeof CLASS_TREE_MAP !== 'undefined' && CLASS_TREE_MAP[c]) return 1;
  return 2;
}
const PLAN_TRIGGER_RANK = { base_level: 0, job_level: 1, zeny: 2 };
function planTriggerOrder(a, b) {
  if (a.type === 'zeny' || b.type === 'zeny') {
    return ((PLAN_TRIGGER_RANK[a.type] || 0) - (PLAN_TRIGGER_RANK[b.type] || 0)) || (Number(a.targetZeny) || 0) - (Number(b.targetZeny) || 0);
  }
  return (a.type === b.type ? 0 : a.type === 'job_level' ? 1 : -1)
    || (a.type === 'job_level' ? planClassTier(a.classId) - planClassTier(b.classId) : 0)
    || (parseInt(a.targetLevel, 10) || 0) - (parseInt(b.targetLevel, 10) || 0);
}
function planTriggerLabel(t) {
  if (t.type === 'zeny') return `เงิน ≥ ${(Number(t.targetZeny) || 0).toLocaleString()} z`;
  if (t.type !== 'job_level') return `Base Lv.${t.targetLevel}`;
  return `Job Lv.${t.targetLevel} (${t.classId ? planClassLabel(t.classId) : 'ทุกอาชีพ'})`;
}
function jobClassChoices(trig) {
  const p = activeEditingPlan || {};
  const ids = ['novice', p.class1Target, p.class2Target, trig.classId].filter(Boolean).map(x => String(x).toLowerCase());
  return [...new Set(ids)];
}
function updateTriggerZeny(trigIdx, val) {
  if (!activeEditingPlan || !activeEditingPlan.triggers) return;
  activeEditingPlan.triggers[trigIdx].targetZeny = Math.max(1, parseInt(String(val).replace(/[^0-9]/g, ''), 10) || 1);
  sortPlanTriggers();
  markPlanDirty();
  renderPlanWorkflowCanvas();
}
function updateTriggerClass(trigIdx, cls) {
  if (!activeEditingPlan || !activeEditingPlan.triggers) return;
  activeEditingPlan.triggers[trigIdx].classId = cls;
  sortPlanTriggers();
  markPlanDirty();
  renderPlanWorkflowCanvas();
}
function sortPlanTriggers() {
  const t = activeEditingPlan && activeEditingPlan.triggers;
  if (!Array.isArray(t)) return;
  t.sort(planTriggerOrder);
}

// ---------- Plan editor: summary timeline + "เพิ่ม/แก้ไขเงื่อนไข" dialog ----------
// The plan page lists each condition as one readable card ("Base Lv.30 → 1. ขายของ 2. ย้ายแมพ").
// Adding or editing happens in a dialog: ① when (Base / Job + class / money) ② what to do (in order).
// The dialog edits a draft (trigIdx -1 in the action editors) that is only put into the plan on "ส่งลงแผน".
let planDraft = null;
let planDraftIdx = -1;

function planTrigger(trigIdx) {
  if (trigIdx === -1) return planDraft;
  return activeEditingPlan && activeEditingPlan.triggers ? activeEditingPlan.triggers[trigIdx] : null;
}
function planRerender(trigIdx) {
  if (trigIdx === -1) renderTriggerDialog();
  else renderPlanWorkflowCanvas();
}
function planWhenText(t) {
  if (t.type === 'zeny') return `💰 เงิน ≥ ${(Number(t.targetZeny) || 0).toLocaleString()} z`;
  if (t.type === 'job_level') return `Job Lv.${parseInt(t.targetLevel, 10) || 1} · ${t.classId ? planClassLabel(t.classId).split(' (')[0] : 'ทุกอาชีพ'}`;
  return `Base Lv.${parseInt(t.targetLevel, 10) || 1}`;
}

// Render Triggers (summary cards)
function renderPlanWorkflowCanvas() {
  const canvas = document.getElementById("plan-workflow-canvas");
  if (!canvas || !activeEditingPlan) return;

  const triggers = activeEditingPlan.triggers || [];
  if (triggers.length === 0) {
    canvas.innerHTML = `
      <div class="pe-empty">
        <div class="pe-empty-icon">🎯</div>
        <b>ยังไม่มีเงื่อนไขในแผนนี้</b>
        <span>กด <b>"➕ เพิ่มเงื่อนไข"</b> แล้วเลือกว่า <b>เมื่อไหร่</b> (เลเวล / Job / เงิน) และ <b>ทำอะไร</b> เช่น Base Lv.8 → สวม Gakkung Bow → ย้ายไปทะเลสาบอาซูร์</span>
      </div>`;
    return;
  }

  canvas.innerHTML = `<div class="pe-timeline">${triggers.map((trig, trigIdx) => {
    const isJob = trig.type === 'job_level';
    const isZeny = trig.type === 'zeny';
    const actions = trig.actions || [];
    return `
      <div class="pe-node ${isZeny ? 'zeny' : isJob ? 'job' : 'base'}" data-trigger-idx="${trigIdx}" data-trigger-id="${escapeHTML(trig.id || '')}">
        <div class="pe-rail"><span class="pe-dot">${isZeny ? '💰' : isJob ? 'J' : 'B'}</span></div>
        <div class="pe-card pe-sum" onclick="openTriggerDialog(${trigIdx})" title="คลิกเพื่อแก้ไขเงื่อนไขนี้">
          <div class="pe-sum-when">${escapeHTML(planWhenText(trig))}</div>
          <div class="pe-sum-steps">
            ${actions.length
              ? actions.map((a, i) => `<span class="pe-sum-step"><i>${i + 1}</i><span class="pe-chip ${a.type}">${escapeHTML(planActionSummary(a))}</span></span>`).join('<span class="pe-sum-arrow">→</span>')
              : '<span class="pe-chip empty">ยังไม่มี Action — คลิกเพื่อเพิ่ม</span>'}
          </div>
          <div class="pe-head-btns" onclick="event.stopPropagation()">
            <button type="button" class="pe-icon-btn" onclick="openTriggerDialog(${trigIdx})" title="แก้ไข">✏️</button>
            <button type="button" class="pe-icon-btn" onclick="duplicateTrigger(${trigIdx})" title="ทำสำเนาเงื่อนไขนี้">⧉</button>
            <button type="button" class="pe-icon-btn danger" onclick="removeTrigger(${trigIdx})" title="ลบเงื่อนไขนี้">🗑</button>
          </div>
        </div>
      </div>`;
  }).join('')}</div>`;
}

// Scroll to a condition and make it flash so the eye finds it
function focusPlanTrigger(id) {
  const node = document.querySelector(`.pe-node[data-trigger-id="${CSS.escape(String(id || ''))}"]`);
  if (!node) return;
  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  node.classList.remove('pe-flash');
  void node.offsetWidth;
  node.classList.add('pe-flash');
}

// ---- dialog ----
const PLAN_ACTION_TILES = [
  { type: 'change_class', icon: '🏹', title: 'เปลี่ยนอาชีพ', desc: 'ไปคุยกับ Valkyrie เปลี่ยนอาชีพ' },
  { type: 'equip_item', icon: '🛡️', title: 'สวมใส่ของ', desc: 'ใส่จากกระเป๋า หรือซื้อจากตลาด' },
  { type: 'change_map', icon: '🗺️', title: 'ย้ายแมพฟาร์ม', desc: 'เปลี่ยนแมพที่ไปฟาร์ม' },
  { type: 'set_arrow', icon: '🎯', title: 'ลูกธนู', desc: 'เปิด/ปิด เลือกชนิด จำนวน' },
  { type: 'sell_trip', icon: '🛒', title: 'กลับไปขายของ', desc: 'กลับเมืองขาย/ซื้อของ 1 รอบ' },
  { type: 'weight_scroll', icon: '📦', title: 'เพิ่มน้ำหนัก', desc: 'ซื้อ+ใช้ Weight Limit Scroll ให้ครบ' }
];

function openTriggerDialog(trigIdx) {
  if (!activeEditingPlan) return;
  if (!Array.isArray(activeEditingPlan.triggers)) activeEditingPlan.triggers = [];
  if (trigIdx >= 0 && activeEditingPlan.triggers[trigIdx]) {
    planDraftIdx = trigIdx;
    planDraft = JSON.parse(JSON.stringify(activeEditingPlan.triggers[trigIdx]));
  } else {
    planDraftIdx = -1;
    const baseLevels = activeEditingPlan.triggers.filter(t => t.type === 'base_level' || !t.type).map(t => parseInt(t.targetLevel, 10) || 0);
    planDraft = { id: "trig_" + Date.now(), type: "base_level", targetLevel: baseLevels.length ? Math.max(...baseLevels) + 5 : 8, actions: [] };
  }
  let dlg = document.getElementById('pe-trigger-dialog');
  if (!dlg) {
    dlg = document.createElement('div');
    dlg.id = 'pe-trigger-dialog';
    dlg.className = 'modal-overlay pe-dlg';
    document.body.appendChild(dlg);
    dlg.addEventListener('mousedown', e => { if (e.target === dlg) closeTriggerDialog(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && dlg.classList.contains('active')) closeTriggerDialog(); });
  }
  renderTriggerDialog();
  dlg.classList.add('active');
}

function closeTriggerDialog() {
  const dlg = document.getElementById('pe-trigger-dialog');
  if (dlg) dlg.classList.remove('active');
  planDraft = null;
  planDraftIdx = -1;
}

function draftSet(field, val) {
  if (!planDraft) return;
  if (field === 'type') {
    planDraft.type = val;
    if (val === 'job_level' && planDraft.classId === undefined) planDraft.classId = 'novice';
    if (val !== 'job_level') delete planDraft.classId;
    if (val === 'zeny' && !(Number(planDraft.targetZeny) > 0)) planDraft.targetZeny = 20000;
    if (val !== 'zeny' && !(parseInt(planDraft.targetLevel, 10) > 0)) planDraft.targetLevel = 10;
    renderTriggerDialog();
    return;
  }
  if (field === 'targetLevel') planDraft.targetLevel = Math.max(1, Math.min(200, parseInt(val, 10) || 1));
  else if (field === 'targetZeny') planDraft.targetZeny = Math.max(1, parseInt(String(val).replace(/[^0-9]/g, ''), 10) || 1);
  else planDraft[field] = val;
  const head = document.querySelector('#pe-trigger-dialog .pe-dlg-when-text');
  if (head) head.textContent = planWhenText(planDraft);
}

function moveAction(trigIdx, actIdx, dir) {
  const trig = planTrigger(trigIdx);
  if (!trig || !trig.actions) return;
  const to = actIdx + dir;
  if (to < 0 || to >= trig.actions.length) return;
  const [a] = trig.actions.splice(actIdx, 1);
  trig.actions.splice(to, 0, a);
  if (trigIdx !== -1) markPlanDirty();
  planRerender(trigIdx);
}

function renderTriggerDialog() {
  const dlg = document.getElementById('pe-trigger-dialog');
  if (!dlg || !planDraft) return;
  const t = planDraft;
  const isJob = t.type === 'job_level', isZeny = t.type === 'zeny', isBase = !isJob && !isZeny;
  const scrollBox = dlg.querySelector('.pe-dlg-body');
  const keepScroll = scrollBox ? scrollBox.scrollTop : 0;
  dlg.innerHTML = `
    <div class="modal-card pe-dlg-card">
      <div class="pe-dlg-head">
        <div>
          <h3>${planDraftIdx >= 0 ? '✏️ แก้ไขเงื่อนไข' : '➕ เพิ่มเงื่อนไขใหม่'}</h3>
          <p class="pe-dlg-when-text">${escapeHTML(planWhenText(t))}</p>
        </div>
        <button type="button" class="pp-x" onclick="closeTriggerDialog()" title="ปิด (Esc)">✕</button>
      </div>
      <div class="pe-dlg-body">
        <section class="pe-dlg-step">
          <div class="pe-dlg-step-title"><span>1</span> ทำเมื่อไหร่</div>
          <div class="pe-dlg-kinds">
            <button type="button" class="${isBase ? 'on' : ''}" onclick="draftSet('type', 'base_level')"><b>Base Lv.</b><small>เลเวลตัวละคร</small></button>
            <button type="button" class="${isJob ? 'on' : ''}" onclick="draftSet('type', 'job_level')"><b>Job Lv.</b><small>เลเวลอาชีพ</small></button>
            <button type="button" class="${isZeny ? 'on' : ''}" onclick="draftSet('type', 'zeny')"><b>💰 เงิน</b><small>เมื่อเงินถึงจำนวน</small></button>
          </div>
          <div class="pe-dlg-when">
            ${isZeny ? `
              <label>เมื่อมีเงิน ≥ <input type="number" class="form-input" min="1" step="1000" value="${Number(t.targetZeny) || 20000}" oninput="draftSet('targetZeny', this.value)"> z</label>
            ` : `
              <label>ถึง ${isJob ? 'Job' : 'Base'} Lv. <input type="number" class="form-input" min="1" max="200" value="${parseInt(t.targetLevel, 10) || 1}" oninput="draftSet('targetLevel', this.value)"></label>
              ${isJob ? `
              <label>ของอาชีพ
                <select class="form-select" onchange="draftSet('classId', this.value)">
                  ${jobClassChoices(t).map(c => `<option value="${escapeHTML(c)}" ${String(t.classId || '').toLowerCase() === c ? 'selected' : ''}>${escapeHTML(planClassLabel(c))}</option>`).join('')}
                  <option value="" ${!t.classId ? 'selected' : ''}>ทุกอาชีพ</option>
                </select>
              </label>` : ''}
            `}
          </div>
          <small class="pe-hint">${isZeny ? 'ทำครั้งเดียวเมื่อเงินถึงจำนวนนี้' : isJob ? 'Job Lv. เริ่มนับ 1 ใหม่ทุกครั้งที่เปลี่ยนอาชีพ จึงต้องเลือกว่าเป็น Job ของอาชีพไหน' : 'ทำครั้งเดียวเมื่อเลเวลตัวละครถึงค่านี้'}</small>
        </section>

        <section class="pe-dlg-step">
          <div class="pe-dlg-step-title"><span>2</span> ทำอะไร <small>(ทำตามลำดับจากบนลงล่าง)</small></div>
          <div class="pe-dlg-actions">
            ${(t.actions || []).length
              ? t.actions.map((a, i) => `<div class="pe-dlg-act"><div class="pe-dlg-act-no">${i + 1}</div>${renderActionNodeHtml(-1, i, a)}</div>`).join('')
              : '<div class="pe-dlg-noact">ยังไม่มี Action — เลือกจากปุ่มด้านล่าง</div>'}
          </div>
          <div class="pe-dlg-tiles">
            ${PLAN_ACTION_TILES.map(x => `<button type="button" onclick="addActionToTrigger(-1, '${x.type}')"><span>${x.icon}</span><b>${x.title}</b><small>${x.desc}</small></button>`).join('')}
          </div>
        </section>
      </div>
      <div class="pe-dlg-foot">
        <span class="pe-dlg-err" id="pe-dlg-err"></span>
        <button type="button" class="btn btn-secondary" onclick="closeTriggerDialog()">ยกเลิก</button>
        <button type="button" class="btn btn-success" onclick="submitTriggerDialog()">✔ ${planDraftIdx >= 0 ? 'บันทึกการแก้ไข' : 'ส่งลงแผน'}</button>
      </div>
    </div>`;
  const body = dlg.querySelector('.pe-dlg-body');
  if (body) body.scrollTop = keepScroll;
}

function submitTriggerDialog() {
  const t = planDraft;
  if (!t || !activeEditingPlan) return;
  // inputs commit on change: make sure the focused one is in
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const err = [];
  if (!(t.actions || []).length) err.push('เพิ่ม Action อย่างน้อย 1 อย่าง');
  (t.actions || []).forEach((a, i) => {
    if (a.type === 'equip_item' && !String(a.itemName || '').trim()) err.push(`Action ${i + 1}: ยังไม่ได้ใส่ชื่อไอเทม`);
  });
  if (t.type === 'zeny' && !(Number(t.targetZeny) > 0)) err.push('ใส่จำนวนเงิน');
  if (err.length) {
    const box = document.getElementById('pe-dlg-err');
    if (box) box.textContent = '⚠️ ' + err.join(' · ');
    return;
  }
  const id = t.id || ("trig_" + Date.now());
  t.id = id;
  if (planDraftIdx >= 0 && activeEditingPlan.triggers[planDraftIdx]) activeEditingPlan.triggers[planDraftIdx] = t;
  else activeEditingPlan.triggers.push(t);
  sortPlanTriggers();
  markPlanDirty();
  closeTriggerDialog();
  renderPlanWorkflowCanvas();
  setTimeout(() => focusPlanTrigger(id), 60);
}

// Render single Action Node (used in the dialog; trigIdx -1 = the draft)
function renderActionNodeHtml(trigIdx, actIdx, act) {
  const draft = trigIdx === -1 ? planDraft : planTrigger(trigIdx);
  const count = draft && draft.actions ? draft.actions.length : 0;
  const moves = `
    <button type="button" class="pe-icon-btn sm" onclick="moveAction(${trigIdx}, ${actIdx}, -1)" ${actIdx === 0 ? 'disabled' : ''} title="ย้ายขึ้น">↑</button>
    <button type="button" class="pe-icon-btn sm" onclick="moveAction(${trigIdx}, ${actIdx}, 1)" ${actIdx >= count - 1 ? 'disabled' : ''} title="ย้ายลง">↓</button>`;
  const del = `<span class="pe-act-btns">${moves}<button type="button" class="pe-icon-btn danger sm" onclick="removeAction(${trigIdx}, ${actIdx})" title="ลบ Action นี้">✕</button></span>`;
  if (act.type === 'equip_item') {
    return `
      <div class="pe-action equip_item">
        <div class="pe-act-icon">🛡️</div>
        <div class="pe-act-main">
          <div class="pe-act-title"><b>สวมใส่อุปกรณ์</b>${del}</div>
          <div class="pe-fields">
            <label>ชื่อไอเทม (ตรงตัว)
              <input type="text" class="form-input" placeholder="เช่น Gakkung Bow" value="${escapeHTML(act.itemName || '')}" onchange="updateActionField(${trigIdx}, ${actIdx}, 'itemName', this.value.trim())">
            </label>
            <label>ออปชั่นที่ต้องมี (ว่าง = ไม่กรอง)
              <input type="text" class="form-input" placeholder="เช่น dex>=3, luk, melee dmg" title="ออปชั่นสุ่มที่ต้องมี คั่นด้วย , ใส่ค่าขั้นต่ำได้ เช่น dex>=3" value="${escapeHTML(act.optionFilter || '')}" onchange="updateActionField(${trigIdx}, ${actIdx}, 'optionFilter', this.value.trim())">
            </label>
          </div>
          <div class="pe-inline">
            <label class="pe-check">
              <input type="checkbox" ${act.buyFromMarket !== false ? 'checked' : ''} onchange="updateActionField(${trigIdx}, ${actIdx}, 'buyFromMarket', this.checked)">
              ถ้าไม่มีในตัว/กระเป๋า ให้ซื้อจากตลาด
            </label>
            <label class="pe-budget">งบสูงสุด
              <input type="number" class="form-input" min="0" value="${Number(act.maxPrice) || 100000}" onchange="updateActionField(${trigIdx}, ${actIdx}, 'maxPrice', parseInt(this.value, 10) || 0)"> z
            </label>
          </div>
        </div>
      </div>`;
  }
  if (act.type === 'change_map') {
    return `
      <div class="pe-action change_map">
        <div class="pe-act-icon">🗺️</div>
        <div class="pe-act-main">
          <div class="pe-act-title"><b>เปลี่ยนแมพฟาร์ม</b>${del}</div>
          <select class="form-select" onchange="updateActionField(${trigIdx}, ${actIdx}, 'targetMap', this.value)">
            ${PLAN_MAP_OPTIONS.map(grp => `
              <optgroup label="${escapeHTML(grp.group)}">
                ${grp.maps.map(m => `<option value="${escapeHTML(m.value)}" ${act.targetMap === m.value ? 'selected' : ''}>${escapeHTML(m.label)}</option>`).join('')}
              </optgroup>`).join('')}
          </select>
        </div>
      </div>`;
  }
  if (act.type === 'change_class') {
    return `
      <div class="pe-action change_class">
        <div class="pe-act-icon">🏹</div>
        <div class="pe-act-main">
          <div class="pe-act-title"><b>เปลี่ยนอาชีพ</b>${del}</div>
          <select class="form-select" onchange="updateActionField(${trigIdx}, ${actIdx}, 'targetClass', this.value)">
            ${PLAN_CLASS_OPTIONS.map(cls => `<option value="${cls.value}" ${String(act.targetClass || '').toLowerCase() === cls.value ? 'selected' : ''}>${cls.label}</option>`).join('')}
          </select>
          <small class="pe-hint">บอทจะเปลี่ยนเมื่อเกมเปิดให้เปลี่ยนอาชีพนี้ได้ (คุยกับ Valkyrie ในเมืองหลวงให้เอง)</small>
        </div>
      </div>`;
  }
  if (act.type === 'weight_scroll') {
    return `
      <div class="pe-action weight_scroll">
        <div class="pe-act-icon">📦</div>
        <div class="pe-act-main">
          <div class="pe-act-title"><b>ซื้อ + ใช้ Weight Limit Scroll</b>${del}</div>
          <div class="pe-fields">
            <label>ใช้ให้ครบ (ครั้ง ต่อตัวละคร)
              <input type="number" class="form-input" min="1" max="10" value="${act.qty || 10}" onchange="updateActionField(${trigIdx}, ${actIdx}, 'qty', Math.max(1, Math.min(10, parseInt(this.value, 10) || 10)))">
            </label>
            <label>งบสูงสุดรวม (0 = ไม่จำกัด)
              <input type="number" class="form-input" min="0" step="1000" value="${Number(act.maxPrice) || 0}" onchange="updateActionField(${trigIdx}, ${actIdx}, 'maxPrice', Math.max(0, parseInt(this.value, 10) || 0))">
            </label>
          </div>
          <small class="pe-hint">บอทจะใช้ที่มีในกระเป๋าก่อน ถ้าไม่พอจะกลับเมืองไปซื้อจากร้าน NPC ที่ขาย (เช็คเงินก่อนซื้อ) แล้วกดใช้ทีละอันจนครบ — จำไว้กับตัวละครนี้ ใช้ครบแล้วจะไม่ซื้ออีก</small>
        </div>
      </div>`;
  }
  if (act.type === 'sell_trip') {
    return `
      <div class="pe-action sell_trip">
        <div class="pe-act-icon">🛒</div>
        <div class="pe-act-main">
          <div class="pe-act-title"><b>กลับไปขายของ 1 รอบ</b>${del}</div>
          <small class="pe-hint">บอทจะกลับเมือง ขายของตามที่ตั้งไว้ในแท็บ "ขาย" ซื้อของใช้ (ลูกธนู/ยา/ปีก) แล้วเดินกลับแมพฟาร์มเอง — เหมือนตอนกระเป๋าเต็ม</small>
        </div>
      </div>`;
  }
  if (act.type === 'set_arrow') {
    const on = act.requireArrow !== false;
    return `
      <div class="pe-action set_arrow">
        <div class="pe-act-icon">🎯</div>
        <div class="pe-act-main">
          <div class="pe-act-title"><b>ตั้งค่าลูกธนู (Require Arrow)</b>${del}</div>
          <label class="pe-check"><input type="checkbox" ${on ? 'checked' : ''} onchange="updateActionField(${trigIdx}, ${actIdx}, 'requireArrow', this.checked); planRerender(${trigIdx});"> เปิดใช้ลูกธนู (เช็ค & ซื้อให้อัตโนมัติ)</label>
          ${on ? `
          <div class="pe-fields pe-fields-3">
            <label>ชนิดลูกธนู
              <select class="form-select" onchange="updateActionField(${trigIdx}, ${actIdx}, 'arrowType', Number(this.value))">
                ${PLAN_ARROW_OPTIONS.map(a => `<option value="${a.value}" ${Number(act.arrowType || 90030) === a.value ? 'selected' : ''}>${a.label}</option>`).join('')}
              </select>
            </label>
            <label>ซื้อให้ครบ (ดอก)
              <input type="number" class="form-input" min="1" step="50" value="${act.arrowBuyQty || 200}" oninput="updateActionField(${trigIdx}, ${actIdx}, 'arrowBuyQty', Math.max(1, parseInt(this.value, 10) || 200))">
            </label>
            <label>ซื้อเมื่อเหลือ <= (ดอก)
              <input type="number" class="form-input" min="50" step="10" value="${act.ammoThreshold || 50}" oninput="updateActionField(${trigIdx}, ${actIdx}, 'ammoThreshold', Math.max(50, parseInt(this.value, 10) || 50))">
            </label>
          </div>` : '<small class="pe-hint">บอทจะเลิกเช็คและเลิกซื้อลูกธนูตั้งแต่เลเวลนี้</small>'}
        </div>
      </div>`;
  }
  return '';
}

// Trigger and Action Mutators
function addLevelTrigger() {
  openTriggerDialog(-1);
}

function removeTrigger(trigIdx) {
  if (!activeEditingPlan || !activeEditingPlan.triggers) return;
  const t = activeEditingPlan.triggers[trigIdx];
  if (t && (t.actions || []).length && !confirm(`ลบเงื่อนไข "${planWhenText(t)}" และ Action ทั้ง ${(t.actions || []).length} รายการ?`)) return;
  activeEditingPlan.triggers.splice(trigIdx, 1);
  markPlanDirty();
  renderPlanWorkflowCanvas();
}

function duplicateTrigger(trigIdx) {
  if (!activeEditingPlan || !activeEditingPlan.triggers) return;
  const src = activeEditingPlan.triggers[trigIdx];
  if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = "trig_" + Date.now();
  if (copy.type === 'zeny') copy.targetZeny = (Number(src.targetZeny) || 0) + 10000;
  else copy.targetLevel = (parseInt(src.targetLevel, 10) || 1) + 1;
  (copy.actions || []).forEach(a => { a.id = "act_" + Date.now() + "_" + Math.floor(Math.random() * 1000); });
  activeEditingPlan.triggers.push(copy);
  sortPlanTriggers();
  markPlanDirty();
  renderPlanWorkflowCanvas();
  setTimeout(() => focusPlanTrigger(copy.id), 60);
}

function togglePlanTriggerCollapse(trigIdx) {
  const t = activeEditingPlan && activeEditingPlan.triggers && activeEditingPlan.triggers[trigIdx];
  if (!t) return;
  const key = t.id || `idx_${trigIdx}`;
  if (planCollapsedTriggers.has(key)) planCollapsedTriggers.delete(key);
  else planCollapsedTriggers.add(key);
  renderPlanWorkflowCanvas();
}

function updateTriggerType(trigIdx, type) {
  if (!activeEditingPlan || !activeEditingPlan.triggers) return;
  const trig = activeEditingPlan.triggers[trigIdx];
  trig.type = type;
  if (type === 'job_level' && trig.classId === undefined) trig.classId = 'novice';
  if (type !== 'job_level') delete trig.classId;
  if (type === 'zeny' && !(Number(trig.targetZeny) > 0)) trig.targetZeny = 20000;
  sortPlanTriggers();
  markPlanDirty();
  renderPlanWorkflowCanvas();
}

function updateTriggerLevel(trigIdx, level) {
  if (!activeEditingPlan || !activeEditingPlan.triggers) return;
  activeEditingPlan.triggers[trigIdx].targetLevel = Math.max(1, parseInt(level, 10) || 1);
  sortPlanTriggers();
  markPlanDirty();
  renderPlanWorkflowCanvas();
}

function stepTriggerLevel(trigIdx, delta) {
  const t = activeEditingPlan && activeEditingPlan.triggers && activeEditingPlan.triggers[trigIdx];
  if (!t) return;
  updateTriggerLevel(trigIdx, (parseInt(t.targetLevel, 10) || 1) + delta);
}

function addActionToTrigger(trigIdx, actionType) {
  if (!activeEditingPlan) return;
  const trig = planTrigger(trigIdx);
  if (!trig) return;
  if (!Array.isArray(trig.actions)) trig.actions = [];
  const newAction = { id: "act_" + Date.now() + "_" + Math.floor(Math.random() * 100), type: actionType };
  if (actionType === 'equip_item') {
    Object.assign(newAction, { itemName: "", optionFilter: "", buyFromMarket: true, maxPrice: 100000 });
  } else if (actionType === 'change_map') {
    newAction.targetMap = "ซากโบราณสถาน";
  } else if (actionType === 'change_class') {
    newAction.targetClass = trig.type === 'job_level' && String(trig.classId || '').toLowerCase() === 'novice'
      ? (activeEditingPlan.class1Target || "archer")
      : (trig.type === 'job_level' && trig.classId ? (activeEditingPlan.class2Target || "hunter") : (activeEditingPlan.class1Target || "archer"));
    if (activeEditingPlan.autoJobChange !== false) {
      activeEditingPlan.autoJobChange = false;
      const cb = document.getElementById('plan-editor-autojob');
      if (cb) cb.checked = false;
      refreshAutoJobUi();
    }
  } else if (actionType === 'set_arrow') {
    Object.assign(newAction, { requireArrow: true, arrowType: 90030, arrowBuyQty: 200, ammoThreshold: 50 });
  } else if (actionType === 'weight_scroll') {
    Object.assign(newAction, { qty: 10, maxPrice: 0 });
  }
  trig.actions.push(newAction);
  if (trigIdx !== -1) markPlanDirty();
  planRerender(trigIdx);
  if (trigIdx === -1) {
    // bring the new action into view inside the dialog
    setTimeout(() => {
      const acts = document.querySelectorAll('#pe-trigger-dialog .pe-dlg-act');
      if (acts.length) acts[acts.length - 1].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 30);
  }
}

function removeAction(trigIdx, actIdx) {
  const trig = planTrigger(trigIdx);
  if (trig && trig.actions) {
    trig.actions.splice(actIdx, 1);
    if (trigIdx !== -1) markPlanDirty();
    planRerender(trigIdx);
  }
}

function updateActionField(trigIdx, actIdx, field, val) {
  const trig = planTrigger(trigIdx);
  if (trig && trig.actions && trig.actions[actIdx]) {
    trig.actions[actIdx][field] = val;
    if (trigIdx === -1) return;
    markPlanDirty();
    // Refresh the header chips (cheap) without re-rendering the inputs being edited
    const node = document.querySelector(`.pe-node[data-trigger-idx="${trigIdx}"] .pe-summary`);
    if (node) node.innerHTML = trig.actions.map(a => `<span class="pe-chip ${a.type}">${escapeHTML(planActionSummary(a))}</span>`).join('');
  }
}

// ---------- Plan list: live Plan Script status of the selected client ----------
let planLiveStatusTimer = null;

async function refreshPlanLiveStatus() {
  const box = document.getElementById('plan-live-status');
  if (!box || !activePlanClientProfileId) return;
  let st = null;
  try {
    const res = await fetch(`${API_BASE}/api/profiles/${encodeURIComponent(activePlanClientProfileId)}/plan-state`);
    st = await res.json();
  } catch (e) {}
  if (!st || !st.success) {
    box.innerHTML = `<span class="pl-muted">⚪ จอนี้ออฟไลน์ — แผนที่ผูกไว้จะถูกส่งและเปิดใช้งานให้เองเมื่อเปิดจอ</span>`;
    return;
  }
  const assignedId = currentPlanAssignments[activePlanClientProfileId];
  const assigned = currentPlanProfiles.find(p => p.id === assignedId);
  const total = assigned && Array.isArray(assigned.triggers) ? assigned.triggers.length : 0;
  const syncing = assigned && st.planId !== assigned.id;
  const pending = (st.pending || []).map(p => p.type === 'zeny' ? `เงิน ≥ ${Number(p.level).toLocaleString()} z` : `${p.type === 'job_level' ? `Job${p.cls ? ' ' + planClassLabel(p.cls).split(' ')[0] : ''}` : 'Base'} Lv.${p.level}`).join(', ');
  box.innerHTML = `
    <label class="pl-switch" title="เปิด/ปิด Plan Script ของจอนี้">
      <input type="checkbox" ${st.enabled ? 'checked' : ''} onchange="togglePlanScriptEnabled(this.checked)">
      <span></span>
      <b>Plan Script ${st.enabled ? 'เปิดอยู่' : 'ปิดอยู่'}</b>
    </label>
    <span class="pl-sep"></span>
    <span>${st.botRunning ? '🟢 บอทกำลังทำงาน' : '⏸️ บอทหยุดอยู่ <small>(แผนจะทำงานเมื่อกด START BOT)</small>'}</span>
    ${syncing ? '<span class="pl-warn">⏳ กำลังส่งแผนล่าสุดไปที่จอ...</span>' : ''}
    ${st.planId && !syncing && total ? `<span>✅ ทำแล้ว <b>${Math.min((st.done || []).length, total)}/${total}</b> เงื่อนไข</span>` : ''}
    ${pending ? `<span class="pl-warn">⏳ กำลังรอทำ: ${escapeHTML(pending)}</span>` : ''}`;
}

async function togglePlanScriptEnabled(enabled) {
  if (!activePlanClientProfileId) return;
  if (enabled && !currentPlanAssignments[activePlanClientProfileId]) {
    alert('ยังไม่ได้เลือกแผนให้จอนี้ — กด "ใช้งาน" ที่แผนที่ต้องการก่อน');
    refreshPlanLiveStatus();
    return;
  }
  try {
    await fetch(`${API_BASE}/api/profiles/${encodeURIComponent(activePlanClientProfileId)}/plan-enabled`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled })
    });
  } catch (e) {}
  refreshPlanLiveStatus();
}

function startPlanLiveStatus() {
  clearInterval(planLiveStatusTimer);
  refreshPlanLiveStatus();
  planLiveStatusTimer = setInterval(() => {
    const modal = document.getElementById('plan-modal');
    if (!modal || !modal.classList.contains('active')) { clearInterval(planLiveStatusTimer); return; }
    refreshPlanLiveStatus();
  }, 5000);
}

// Sort triggers by level and list anything that would not work in the bot
function validatePlanForSave(plan) {
  const problems = [];
  const triggers = Array.isArray(plan.triggers) ? plan.triggers : [];
  triggers.forEach(t => { t.targetLevel = Math.max(1, parseInt(t.targetLevel, 10) || 1); if (!t.id) t.id = "trig_" + Date.now() + "_" + Math.floor(Math.random() * 1000); });
  triggers.sort(planTriggerOrder);
  const seen = {};
  triggers.forEach(t => {
    const label = planTriggerLabel(t);
    if (t.type === 'zeny' && !(Number(t.targetZeny) > 0)) problems.push('เงื่อนไข 💰 เงิน ยังไม่ได้ใส่จำนวนเงิน');
    const key = t.type === 'zeny' ? `zeny_${t.targetZeny}` : `${t.type}_${t.type === 'job_level' ? (t.classId || '') : ''}_${t.targetLevel}`;
    if (seen[key]) problems.push(`มีเงื่อนไข ${label} ซ้ำกัน (รวมไว้ในอันเดียวจะอ่านง่ายกว่า)`);
    seen[key] = true;
    if (!(t.actions || []).length) problems.push(`${label} ยังไม่มี Action`);
    (t.actions || []).forEach(a => {
      if (a.type === 'equip_item' && !String(a.itemName || '').trim()) problems.push(`${label}: Action สวมใส่ยังไม่ได้ใส่ชื่อไอเทม`);
      if (a.type === 'equip_item' && a.buyFromMarket !== false && !(Number(a.maxPrice) > 0)) problems.push(`${label}: ซื้อจากตลาดแต่งบสูงสุดเป็น 0`);
    });
  });
  if (plan.autoJobChange === false && !planHasClassAction(plan)) problems.push('ปิด "เปลี่ยนอาชีพอัตโนมัติ" แต่ยังไม่มี Action เปลี่ยนอาชีพ — ตัวละครจะไม่เปลี่ยนอาชีพเลย (เพิ่มเงื่อนไข Job Lv.10 (โนวิซ) → 🏹 เปลี่ยนอาชีพ)');
  if (plan.autoJobChange === true && planHasClassAction(plan)) problems.push('เปิด "เปลี่ยนอาชีพอัตโนมัติ" อยู่ และมี Action เปลี่ยนอาชีพด้วย — บอทอาจเปลี่ยนอาชีพก่อนถึงเงื่อนไขที่ตั้งไว้');
  const tree = (typeof CLASS_TREE_MAP !== 'undefined') ? CLASS_TREE_MAP[plan.class1Target] : null;
  if (tree && plan.class2Target && !tree.secondClasses.some(c => c.id === plan.class2Target)) {
    problems.push(`Class 2 "${plan.class2Target}" ไม่ได้ต่อจาก Class 1 "${plan.class1Target}"`);
  }
  return problems;
}

// Save Plan
async function saveActivePlan(applyLive = false) {
  if (!activeEditingPlan) return;

  const titleInput = document.getElementById("plan-editor-title");
  const descInput = document.getElementById("plan-editor-desc");
  const c1Sel = document.getElementById("plan-editor-class1");
  const c2Sel = document.getElementById("plan-editor-class2");

  if (titleInput && titleInput.value.trim()) activeEditingPlan.name = titleInput.value.trim();
  if (descInput) activeEditingPlan.description = descInput.value.trim();
  if (c1Sel) activeEditingPlan.class1Target = c1Sel.value;
  if (c2Sel) activeEditingPlan.class2Target = c2Sel.value;
  const jobLv = (id, def) => {
    const n = Math.round(Number(document.getElementById(id)?.value));
    return Number.isFinite(n) && n >= 1 && n <= 99 ? n : def;
  };
  activeEditingPlan.class1JobLevel = jobLv("plan-editor-class1-job", 10);
  const autoCb = document.getElementById("plan-editor-autojob");
  if (autoCb) activeEditingPlan.autoJobChange = autoCb.checked;
  const gemCb = document.getElementById("plan-editor-autogem");
  if (gemCb) activeEditingPlan.autoUpgradeGems = gemCb.checked;
  const petCb = document.getElementById("plan-editor-eventpet");
  if (petCb) activeEditingPlan.eventPet = petCb.checked;
  activeEditingPlan.class2JobLevel = jobLv("plan-editor-class2-job", 50);

  const problems = validatePlanForSave(activeEditingPlan);
  if (problems.length && !confirm("พบจุดที่ควรตรวจในแผนนี้:\n\n• " + problems.join("\n• ") + "\n\nบันทึกต่อเลยไหม?")) return;

  try {
    const res = await fetch(`${API_BASE}/api/plan-profiles/${activeEditingPlan.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(activeEditingPlan)
    });
    const result = await res.json();
    if (result.success) {
      markPlanDirty(false);
      if (applyLive && activePlanClientProfileId) {
        await assignPlanToActiveClient(activeEditingPlan.id);
      } else {
        alert("💾 บันทึกแผนการเล่นเรียบร้อยแล้ว!");
      }
      await fetchAndRenderPlanProfiles();
      switchPlanModalView('list');
    } else {
      alert("เกิดข้อผิดพลาด: " + (result.error || "ไม่สามารถบันทึกได้"));
    }
  } catch(e) {
    alert("เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์");
  }
}

// Import & Export Plans
function handleImportPlansClick() {
  const input = document.getElementById("plan-import-file-input");
  if (input) {
    input.value = '';
    input.click();
  }
}

// Export the chosen plans to a .json file (the import reads { profiles: [...] })
function exportPlanProfiles(planIds) {
  const list = currentPlanProfiles.filter(p => planIds.includes(p.id));
  if (!list.length) return;
  const assignments = {};
  Object.entries(currentPlanAssignments || {}).forEach(([cid, pid]) => { if (planIds.includes(pid)) assignments[cid] = pid; });
  const text = JSON.stringify({ exportedAt: new Date().toISOString(), profiles: list, assignments }, null, 2);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safe = s => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
  a.download = list.length === 1 ? `plan_${safe(list[0].name)}_${Date.now()}.json` : `aetheria_plan_scripts_${list.length}_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`📤 ส่งออก ${list.length === 1 ? 'แผน "' + list[0].name + '"' : list.length + ' แผน'} แล้ว`, 'success');
}

// "ส่งออก (Export)": tick the plans to put in the file
function handleExportPlansClick() {
  if (currentPlanProfiles.length === 0) {
    alert("ไม่มี Plan Profile ในระบบให้ส่งออก");
    return;
  }
  let modal = document.getElementById('plan-export-picker');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'plan-export-picker';
    modal.className = 'modal-overlay';
    modal.style.zIndex = '1200';
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
  }
  modal.innerHTML = `
    <div class="modal-card" style="width: min(460px, 92vw);">
      <div class="modal-header">
        <h3 style="margin: 0;">📤 เลือกแผนที่จะส่งออก</h3>
        <button class="modal-close" data-x="close">&times;</button>
      </div>
      <label style="display: flex; align-items: center; gap: 8px; padding: 8px 4px; border-bottom: 1px solid rgba(255,255,255,0.08); font-weight: 700; font-size: 12.5px; cursor: pointer;">
        <input type="checkbox" class="pe-exp-all"> เลือกทั้งหมด (${currentPlanProfiles.length} แผน)
      </label>
      <div style="max-height: 340px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding: 6px 0;">
        ${currentPlanProfiles.map(p => `
          <label style="display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-radius: 6px; cursor: pointer; font-size: 12.5px;">
            <input type="checkbox" class="pe-exp-cb" value="${escapeHTML(p.id)}">
            <span style="flex: 1; color: #f1f5f9;">${escapeHTML(p.name)}</span>
            <small style="color: #94a3b8;">${escapeHTML(p.class1Target || '')} ➔ ${escapeHTML(p.class2Target || '')}${p.gearPlan?.steps?.length ? ' · 🛡️' + p.gearPlan.steps.length : ''}</small>
          </label>`).join('')}
      </div>
      <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px;">
        <button type="button" class="btn btn-secondary" data-x="close">ยกเลิก</button>
        <button type="button" class="btn btn-primary" data-x="go" disabled>📤 ส่งออก (0 แผน)</button>
      </div>
    </div>`;
  const cbs = [...modal.querySelectorAll('.pe-exp-cb')];
  const all = modal.querySelector('.pe-exp-all');
  const go = modal.querySelector('[data-x="go"]');
  const refresh = () => {
    const n = cbs.filter(c => c.checked).length;
    go.disabled = !n;
    go.textContent = `📤 ส่งออก (${n} แผน)`;
    all.checked = n === cbs.length;
    all.indeterminate = n > 0 && n < cbs.length;
  };
  cbs.forEach(c => c.onchange = refresh);
  all.onchange = () => { cbs.forEach(c => c.checked = all.checked); refresh(); };
  modal.querySelectorAll('[data-x="close"]').forEach(b => b.onclick = () => modal.classList.remove('active'));
  go.onclick = () => {
    exportPlanProfiles(cbs.filter(c => c.checked).map(c => c.value));
    modal.classList.remove('active');
  };
  modal.classList.add('active');
}

// Setup Event Listeners for Plan Modal
function setupPlanModalEventListeners() {
  const btnClose = document.getElementById("plan-modal-close-btn");
  if (btnClose) btnClose.onclick = closeScriptPlanModal;

  const btnListClose = document.getElementById("plan-modal-list-close");
  if (btnListClose) btnListClose.onclick = closeScriptPlanModal;

  const btnEditorClose = document.getElementById("plan-editor-close-btn");
  if (btnEditorClose) btnEditorClose.onclick = () => { if (confirmDiscardPlanChanges()) { markPlanDirty(false); closeScriptPlanModal(); } };

  const btnBack = document.getElementById("btn-back-to-plan-list");
  if (btnBack) btnBack.onclick = () => { if (confirmDiscardPlanChanges()) { markPlanDirty(false); switchPlanModalView('list'); } };
  ['plan-editor-title', 'plan-editor-desc', 'plan-editor-class1', 'plan-editor-class2', 'plan-editor-class1-job', 'plan-editor-class2-job'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => markPlanDirty());
  });

  const btnCreate = document.getElementById("btn-create-new-plan");
  if (btnCreate) btnCreate.onclick = createNewPlanProfile;

  const btnAddTrigger = document.getElementById("btn-add-level-trigger");
  if (btnAddTrigger) btnAddTrigger.onclick = addLevelTrigger;

  const btnSave = document.getElementById("btn-save-plan");
  if (btnSave) btnSave.onclick = () => saveActivePlan(false);

  const btnSaveApply = document.getElementById("btn-save-and-apply-plan");
  if (btnSaveApply) btnSaveApply.onclick = () => saveActivePlan(true);

  const btnImport = document.getElementById("btn-import-plans");
  if (btnImport) btnImport.onclick = handleImportPlansClick;

  const fileInput = document.getElementById("plan-import-file-input");
  if (fileInput) {
    fileInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          const res = await fetch(`${API_BASE}/api/plan-profiles/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parsed)
          });
          const result = await res.json();
          if (result.success) {
            alert(`📥 ${result.message || 'นำเข้าแผนเรียบร้อยแล้ว!'}`);
            await fetchAndRenderPlanProfiles();
          } else {
            alert("ไม่สามารถนำเข้าได้: " + (result.error || "ไฟล์ไม่ถูกต้อง"));
          }
        } catch(err) {
          alert("รูปแบบไฟล์ JSON ไม่ถูกต้อง");
        }
      };
      reader.readAsText(file);
    };
  }

  const btnExport = document.getElementById("btn-export-plans");
  if (btnExport) btnExport.onclick = handleExportPlansClick;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupPlanModalEventListeners);
} else {
  setupPlanModalEventListeners();
}

// ==========================================
// PROFILE MODAL (EDIT / ADD)
// ==========================================
// "จำนวนจอที่จะสร้าง": names and ports for N new profiles. "Client 16" x3 -> Client 16, 17, 18; a name without a
// number gets " 1", " 2"...; ports continue from the port box, skipping ports other profiles use.
function planNewProfiles(baseName, count, firstPort) {
  const used = new Set(currentProfiles.map(p => Number(p.debugPort)));
  const m = String(baseName).trim().match(/^(.*?)(\d+)$/);
  const out = [];
  let port = firstPort;
  for (let i = 0; i < count; i++) {
    while (i > 0 && used.has(port)) port++;
    const name = count === 1 ? baseName.trim() : (m ? `${m[1]}${Number(m[2]) + i}` : `${baseName.trim()} ${i + 1}`);
    out.push({ name, port });
    used.add(port);
    port++;
  }
  return out;
}
const formCount = document.getElementById("form-count");
function refreshCountUi() {
  if (!formCount) return;
  const isAdd = !formId.value;
  document.getElementById("form-count-group").style.display = isAdd ? "" : "none";
  const n = isAdd ? Math.max(1, Math.min(50, parseInt(formCount.value) || 1)) : 1;
  const many = n > 1;
  // several new screens can't share one ID: each one registers its own account
  formAccount.disabled = many;
  if (formPassword) formPassword.disabled = many;
  if (many) { formAccount.value = ""; if (formPassword) formPassword.value = ""; }
  const hint = document.getElementById("form-count-hint");
  if (hint) {
    if (many) {
      const plan = planNewProfiles(formName.value || "Client 1", n, parseInt(formPort.value) || 49876);
      const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
      hint.innerHTML = `➕ จะสร้าง <b>${n} จอ</b>: ${esc(plan[0].name)} → ${esc(plan[n - 1].name)} (พอร์ต ${plan[0].port} → ${plan[n - 1].port})<br>📝 ทุกจอ<b>สมัครบัญชีใหม่ + สร้างตัวละคร</b>ให้เอง (ID/รหัสสุ่มแยกกันทุกจอ)`;
      hint.style.display = "";
    } else hint.style.display = "none";
  }
}
if (formCount) ["input", "change"].forEach(ev => {
  formCount.addEventListener(ev, refreshCountUi);
  formName.addEventListener(ev, refreshCountUi);
  formPort.addEventListener(ev, refreshCountUi);
});

function openAddModal() {
  formId.value = "";
  if (formCount) formCount.value = 1;
  formName.value = `Client ${currentProfiles.length + 1}`;
  formAccount.value = "";
  formClass.value = "Hunter";
  formMap.value = "ถนนต้นหลิว";
  const maxPort = Math.max(49875, ...currentProfiles.map(p => p.debugPort || 49876));
  formPort.value = maxPort + 1;
  formNotes.value = "";
  if (formPassword) { formPassword.value = ""; formPassword.placeholder = "เว้นว่าง = สมัครบัญชีใหม่ให้"; }
  modalTitle.innerText = "➕ เพิ่มโปรไฟล์จอเกมใหม่";
  refreshCountUi();
  modalEl.classList.add("active");
}

function openEditModal(id) {
  const profile = currentProfiles.find(p => p.id === id);
  if (!profile) return;
  formId.value = profile.id;
  formName.value = profile.name;
  formAccount.value = profile.account || "";
  formClass.value = profile.charClass || "Hunter";
  formMap.value = profile.targetMap || "ถนนต้นหลิว";
  formPort.value = profile.debugPort || 49876;
  formNotes.value = profile.notes || "";
  if (formPassword) {
    formPassword.value = "";
    formPassword.placeholder = profile.hasLoginPassword ? "•••••• (มีรหัสแล้ว — เว้นว่าง = ไม่เปลี่ยน)" : (profile.autoRegister ? "กำลังรอสมัครบัญชีอัตโนมัติ" : "ใส่รหัสผ่านเพื่อเปิด Auto-login");
  }
  modalTitle.innerText = `⚙️ แก้ไขโปรไฟล์: ${profile.name}`;
  refreshCountUi();
  modalEl.classList.add("active");
}

document.getElementById("modal-close-btn").onclick = () => {
  modalEl.classList.remove("active");
};

profileForm.onsubmit = async (e) => {
  e.preventDefault();
  const id = formId.value;
  const payload = {
    name: formName.value,
    account: formAccount.value,
    charClass: formClass.value,
    targetMap: formMap.value,
    debugPort: parseInt(formPort.value),
    notes: formNotes.value,
    loginPassword: formPassword ? formPassword.value : ""
  };

  try {
    if (id) {
      await fetch(`${API_BASE}/api/profiles/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } else {
      const count = formCount ? Math.max(1, Math.min(50, parseInt(formCount.value) || 1)) : 1;
      const plan = planNewProfiles(payload.name, count, payload.debugPort);
      const submitBtn = document.getElementById("modal-submit-btn");
      const failed = [];
      for (let i = 0; i < plan.length; i++) {
        if (submitBtn && count > 1) submitBtn.innerText = `⏳ กำลังสร้าง ${i + 1}/${count}...`;
        const one = count > 1 ? { ...payload, name: plan[i].name, debugPort: plan[i].port, account: "", loginPassword: "" } : payload;
        const r = await fetch(`${API_BASE}/api/profiles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(one)
        }).then(x => x.json()).catch(e => ({ success: false, error: e.message }));
        if (!r.success) failed.push(`${plan[i].name}: ${r.error || "ไม่สำเร็จ"}`);
      }
      if (submitBtn) submitBtn.innerText = "💾 บันทึกโปรไฟล์";
      if (count > 1) showToast(failed.length ? `สร้างได้ ${count - failed.length}/${count} จอ` : `➕ สร้างโปรไฟล์ ${count} จอแล้ว`, failed.length ? "warning" : "success");
      if (failed.length) alert("สร้างไม่สำเร็จบางจอ:\n" + failed.join("\n"));
    }
    modalEl.classList.remove("active");
    fetchProfiles();
  } catch (err) {
    alert("เกิดข้อผิดพลาดในการบันทึกข้อมูล");
  }
};

async function deleteProfile(id) {
  if (!confirm("คุณแน่ใจว่าต้องการลบโปรไฟล์นี้ใช่หรือไม่?")) return;
  try {
    await fetch(`${API_BASE}/api/profiles/${id}`, { method: "DELETE" });
    fetchProfiles();
  } catch (err) {}
}

// Global Poll interval
fetchProfiles();
setInterval(fetchProfiles, 2000);

// ==========================================
// PRESETS & SAVE LIST SYSTEM (CENTRAL PROFILE LIBRARY)
// ==========================================
let currentPresets = [];
let activeCopyToPresetId = null;

// Fetch all presets from server
async function fetchPresets() {
  try {
    const res = await fetch(`${API_BASE}/api/presets`);
    const data = await res.json();
    if (data.success && Array.isArray(data.presets)) {
      currentPresets = data.presets;
      renderPresetsList();
    }
  } catch (err) {
    console.error('Failed to fetch presets:', err);
  }
}

// Render presets inside presets-modal
function renderPresetsList() {
  const container = document.getElementById('presets-list-container');
  if (!container) return;

  if (currentPresets.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; background: rgba(15, 23, 42, 0.5); border-radius: 8px; border: 1px dashed rgba(168, 85, 247, 0.25); color: #94a3b8;">
        <div style="font-size: 28px; margin-bottom: 6px;">📂</div>
        <div style="font-size: 13px; font-weight: 600; color: #cbd5e1;">ยังไม่มีการตั้งค่าในระบบ Save List ส่วนกลาง</div>
        <div style="font-size: 11px; color: #64748b; margin-top: 4px;">กดปุ่ม "บันทึกจอเกมปัจจุบันเข้า Save List" หรือ "นำเข้า (Import)" เพื่อสร้างหรือโหลดโปรไฟล์</div>
      </div>
    `;
    return;
  }

  container.innerHTML = currentPresets.map(preset => {
    const cfg = preset.config || {};
    const targetMap = cfg.targetMap || cfg.archerConfig?.targetMap || 'ตามเดิม';
    const ammoMin = cfg.archerConfig?.minAmmoRestock || cfg.minAmmoRestock || null;
    const sellCount = cfg.sellConfig?.items?.length || 0;
    const updateTime = new Date(preset.updatedAt || preset.createdAt || Date.now()).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

    return `
      <div class="preset-card-item" id="preset-card-${preset.id}">
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="font-size: 13.5px; font-weight: 700; color: #f8fafc;">💾 ${escapeHTML(preset.name)}</span>
            <span class="badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); font-size: 9.5px; padding: 1px 6px; border-radius: 4px;">
              🗺️ ${escapeHTML(targetMap)}
            </span>
            ${ammoMin ? `<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); font-size: 9.5px; padding: 1px 6px; border-radius: 4px;">🏹 ธนู: ${ammoMin} ดอก</span>` : ''}
            ${sellCount > 0 ? `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 9.5px; padding: 1px 6px; border-radius: 4px;">💰 ขายตลาด ${sellCount} ชิ้น</span>` : ''}
            <span style="font-size: 10px; color: #34d399; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.25); padding: 1px 5px; border-radius: 3px;">🔒 ปลอดภัย (ไม่รวม ID/รหัส)</span>
          </div>
          <div style="font-size: 11px; color: #94a3b8; margin-top: 5px; line-height: 1.4;">
            ${escapeHTML(preset.description || 'ไม่มีคำอธิบาย')}
            <span style="color: #64748b; margin-left: 8px;">🕒 อัปเดต ${updateTime}</span>
          </div>
        </div>

        <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
          <button class="btn btn-purple btn-sm" onclick="openCopyToModal('${preset.id}')" title="คัดลอกการตั้งค่านี้ไปยังจอเกมต่างๆ ทันที">
            <span>📋</span> Copy to...
          </button>
          <button class="btn btn-secondary btn-sm" onclick="exportSinglePreset('${preset.id}')" title="ส่งออกเป็นไฟล์ .json แยกโปรไฟล์">
            <span>📤</span> Export
          </button>
          <button class="btn btn-secondary btn-sm btn-icon" onclick="deletePreset('${preset.id}')" title="ลบโปรไฟล์นี้จาก Save List" style="color: #f87171;">
            <span>🗑️</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// -------------------------------------------------------------
// PRESETS MODAL CONTROLS
// -------------------------------------------------------------
function openPresetsModal() {
  const modal = document.getElementById('presets-modal');
  if (modal) {
    modal.classList.add('active');
    fetchPresets();
  }
}

function closePresetsModal() {
  const modal = document.getElementById('presets-modal');
  if (modal) modal.classList.remove('active');
}

// -------------------------------------------------------------
// COPY TO PROFILES MODAL & LOGIC
// -------------------------------------------------------------
function openCopyToModal(presetId) {
  activeCopyToPresetId = presetId;
  const preset = currentPresets.find(p => p.id === presetId);
  if (!preset) return;

  const titleEl = document.getElementById('copy-to-preset-title');
  if (titleEl) {
    titleEl.innerText = `Preset: "${preset.name}" (แมพ: ${preset.config?.targetMap || 'ตามเดิม'})`;
  }

  const checklistContainer = document.getElementById('copy-to-profiles-checklist');
  if (checklistContainer) {
    if (currentProfiles.length === 0) {
      checklistContainer.innerHTML = '<div style="text-align: center; color: #94a3b8; padding: 12px;">ไม่พบจอเกมในระบบ</div>';
    } else {
      checklistContainer.innerHTML = currentProfiles.map(p => `
        <label class="copy-to-check-item">
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="checkbox" class="copy-to-profile-checkbox" value="${p.id}" data-online="${p.isRunning ? '1' : ''}" ${p.isRunning ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer;">
            <span style="font-weight: 600; color: #f8fafc; font-size: 12px;">${escapeHTML(p.name)}</span>
            ${(p.liveState && p.liveState.charName) || p.lastCharName ? `<span style="font-size: 11.5px; font-weight: 700; color: #fcd34d;">👤 ${escapeHTML((p.liveState && p.liveState.charName) || p.lastCharName)}</span>` : ''}
            <span style="font-size: 11px; color: #94a3b8;">(${escapeHTML((p.liveState && p.liveState.charClass) || p.charClass || 'Archer')})</span>
            <span style="font-size: 10px; color: #64748b;">Port: ${p.debugPort || '--'}</span>
          </div>
          <span style="font-size: 10px; padding: 2px 7px; border-radius: 4px; font-weight: 600; ${p.isRunning ? 'background: rgba(34,197,94,0.18); color: #4ade80; border: 1px solid rgba(34,197,94,0.3);' : 'background: rgba(148,163,184,0.12); color: #94a3b8; border: 1px solid rgba(148,163,184,0.2);'}">
            ${p.isRunning ? '🟢 ออนไลน์' : '⚪ ออฟไลน์'}
          </span>
        </label>
      `).join('');
      // Quick pickers: copying works only to clients that are open right now
      checklistContainer.insertAdjacentHTML('afterbegin', `
        <div class="copy-to-pickers">
          <button type="button" class="btn btn-secondary btn-sm" onclick="setCopyToChecks('online')">🟢 เลือกเฉพาะจอออนไลน์</button>
          <small>จอที่ออฟไลน์จะรับค่าไม่ได้ — เปิดจอก่อนแล้วค่อยคัดลอก</small>
        </div>`);
    }
  }

  const modal = document.getElementById('copy-to-modal');
  if (modal) modal.classList.add('active');
}

function setCopyToChecks(mode) {
  document.querySelectorAll('.copy-to-profile-checkbox').forEach(cb => {
    cb.checked = mode === 'all' || (mode === 'online' && cb.dataset.online === '1');
  });
}

function closeCopyToModal() {
  const modal = document.getElementById('copy-to-modal');
  if (modal) modal.classList.remove('active');
  activeCopyToPresetId = null;
}

async function confirmApplyCopyTo() {
  if (!activeCopyToPresetId) return;
  const checkboxes = document.querySelectorAll('.copy-to-profile-checkbox:checked');
  const targetProfileIds = Array.from(checkboxes).map(cb => cb.value);

  if (targetProfileIds.length === 0) {
    alert('กรุณาเลือกจอเกมเป้าหมายอย่างน้อย 1 จอ');
    return;
  }

  const confirmBtn = document.getElementById('copy-to-modal-confirm');
  const originalText = confirmBtn ? confirmBtn.innerHTML : '';
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '⏳ กำลังคัดลอกและอัปเดต...';
  }

  try {
    const res = await fetch(`${API_BASE}/api/presets/${activeCopyToPresetId}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetProfileIds })
    });
    const result = await res.json();
    if (result.success) {
      alert(result.message || `คัดลอกการตั้งค่าไปยัง ${result.appliedCount || targetProfileIds.length} จอเรียบร้อยแล้ว!`);
      closeCopyToModal();
      fetchProfiles();
    } else {
      alert('เกิดข้อผิดพลาด: ' + (result.error || 'ไม่สามารถคัดลอกได้'));
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = originalText;
    }
  }
}

// -------------------------------------------------------------
// IMPORT PROFILE / PRESETS MODAL
// -------------------------------------------------------------
function openImportProfileModal() {
  const nameInput = document.getElementById('import-preset-name');
  const textarea = document.getElementById('import-json-textarea');
  const fileInput = document.getElementById('import-file-input');

  if (nameInput) nameInput.value = 'โปรไฟล์นำเข้าส่วนกลาง ' + (currentPresets.length + 1);
  if (textarea) textarea.value = '';
  if (fileInput) fileInput.value = '';

  const modal = document.getElementById('import-profile-modal');
  if (modal) modal.classList.add('active');
}

function closeImportProfileModal() {
  const modal = document.getElementById('import-profile-modal');
  if (modal) modal.classList.remove('active');
}

async function handleImportProfileSubmit(e) {
  e.preventDefault();
  const nameInput = document.getElementById('import-preset-name');
  const textarea = document.getElementById('import-json-textarea');
  if (!textarea || !textarea.value.trim()) {
    alert('กรุณาวางโค้ด JSON การตั้งค่าที่ต้องการนำเข้า');
    return;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(textarea.value.trim());
  } catch (err) {
    alert('รูปแบบ JSON ไม่ถูกต้อง: ' + err.message);
    return;
  }

  const presetName = nameInput && nameInput.value.trim() ? nameInput.value.trim() : 'โปรไฟล์นำเข้าส่วนกลาง';

  let payload = parsed;
  if (!Array.isArray(parsed) && !parsed.presets) {
    // Single preset or single config object
    if (!parsed.name) parsed.name = presetName;
    payload = parsed;
  }

  const submitBtn = document.getElementById('import-modal-submit-btn');
  const origText = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '⏳ กำลังนำเข้า...';
  }

  try {
    if (parsed && (parsed.format === 'pmhee-aetheria-profile-backup-v1' || (Array.isArray(parsed.profiles) && !parsed.presets))) {
      const resBackup = await fetch(`${API_BASE}/api/profiles/import-backup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });
      const resultBackup = await resBackup.json();
      if (resultBackup.success) {
        alert(`🎉 กู้คืนโปรไฟล์สำเร็จ ${resultBackup.restoredProfiles || 0} จอ (พร้อม ID/Password ${resultBackup.restoredCredentials || 0} จอ) เรียบร้อยแล้ว!`);
        closeImportProfileModal();
        if (typeof fetchProfiles === 'function') fetchProfiles();
      } else {
        alert('นำเข้าไฟล์สำรองโปรไฟล์ไม่สำเร็จ: ' + (resultBackup.error || 'เกิดข้อผิดพลาด'));
      }
      return;
    }

    const res = await fetch(`${API_BASE}/api/presets/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.success) {
      alert(`นำเข้าการตั้งค่าสำเร็จ ${result.count || 1} รายการเข้าสู่ Save List เรียบร้อย!`);
      closeImportProfileModal();
      openPresetsModal();
      fetchPresets();
    } else {
      alert('นำเข้าไม่สำเร็จ: ' + (result.error || 'เกิดข้อผิดพลาด'));
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origText;
    }
  }
}

// -------------------------------------------------------------
// SAVE CLIENT AS PRESET MODAL
// -------------------------------------------------------------
function openSaveClientPresetModal(preferredProfileId = null) {
  const select = document.getElementById('save-client-select');
  const nameInput = document.getElementById('save-client-preset-name');
  const descInput = document.getElementById('save-client-preset-desc');
  const hiddenId = document.getElementById('save-client-profile-id');

  if (!select) return;
  select.innerHTML = currentProfiles.map(p => `
    <option value="${p.id}" ${p.id === preferredProfileId ? 'selected' : ''}>
      ${escapeHTML(p.name)} (${escapeHTML(p.charClass || 'Archer')}) - พอร์ต ${p.debugPort || '--'} ${p.isRunning ? '🟢 ออนไลน์' : '⚪ ออฟไลน์'}
    </option>
  `).join('');

  const targetProfile = currentProfiles.find(p => p.id === (preferredProfileId || (select.value || currentProfiles[0]?.id)));
  const baseName = targetProfile ? targetProfile.name : 'Client';

  if (hiddenId) hiddenId.value = targetProfile ? targetProfile.id : '';
  if (nameInput) nameInput.value = `${baseName} Setup`;
  if (descInput) descInput.value = `ดึงการตั้งค่าจาก ${baseName} (พอร์ต ${targetProfile?.debugPort || '--'})`;

  select.onchange = () => {
    const chosen = currentProfiles.find(p => p.id === select.value);
    if (chosen) {
      if (hiddenId) hiddenId.value = chosen.id;
      if (nameInput) nameInput.value = `${chosen.name} Setup`;
      if (descInput) descInput.value = `ดึงการตั้งค่าจาก ${chosen.name} (พอร์ต ${chosen.debugPort || '--'})`;
    }
  };

  const modal = document.getElementById('save-client-preset-modal');
  if (modal) modal.classList.add('active');
}

function closeSaveClientPresetModal() {
  const modal = document.getElementById('save-client-preset-modal');
  if (modal) modal.classList.remove('active');
}

async function handleSaveClientPresetSubmit(e) {
  e.preventDefault();
  const select = document.getElementById('save-client-select');
  const nameInput = document.getElementById('save-client-preset-name');
  const descInput = document.getElementById('save-client-preset-desc');

  const profileId = select ? select.value : null;
  if (!profileId) {
    alert('ไม่พบจอเกมที่เลือก');
    return;
  }

  const name = nameInput && nameInput.value.trim() ? nameInput.value.trim() : 'โปรไฟล์ส่วนกลาง';
  const description = descInput ? descInput.value.trim() : '';

  try {
    const res = await fetch(`${API_BASE}/api/profiles/${profileId}/save-as-preset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    });
    const result = await res.json();
    if (result.success) {
      alert(`บันทึก "${name}" เข้า Save List ส่วนกลางเรียบร้อย!`);
      closeSaveClientPresetModal();
      openPresetsModal();
      fetchPresets();
    } else {
      alert('เกิดข้อผิดพลาด: ' + (result.error || 'ไม่สามารถบันทึกได้'));
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
  }
}

// -------------------------------------------------------------
// EXPORT & DELETE PRESETS
// -------------------------------------------------------------
function exportAllPresets() {
  window.location.href = `${API_BASE}/api/presets/export`;
}

function exportSinglePreset(presetId) {
  const preset = currentPresets.find(p => p.id === presetId);
  if (!preset) return;

  const jsonStr = JSON.stringify(preset, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const cleanName = preset.name.replace(/[^a-zA-Z0-9ก-๙_-]/g, '_');
  a.download = `preset_${cleanName}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function deletePreset(presetId) {
  const preset = currentPresets.find(p => p.id === presetId);
  const name = preset ? preset.name : presetId;
  if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบ "${name}" ออกจาก Save List?`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/presets/${presetId}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      fetchPresets();
    } else {
      alert('ลบไม่สำเร็จ: ' + (result.error || 'เกิดข้อผิดพลาด'));
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการเชื่อมต่อ');
  }
}

// -------------------------------------------------------------
// DOM EVENT WIRING FOR PRESETS & SAVE LIST
// -------------------------------------------------------------
function setupPresetsEventListeners() {
  // Top row buttons
  const btnOpenPresets = document.getElementById('btn-open-presets-modal');
  if (btnOpenPresets) btnOpenPresets.onclick = openPresetsModal;

  const btnImportGlobal = document.getElementById('btn-import-profile-global');
  if (btnImportGlobal) btnImportGlobal.onclick = openImportProfileModal;

  const btnExportGlobal = document.getElementById('btn-export-profile-global');
  if (btnExportGlobal) btnExportGlobal.onclick = exportAllPresets;

  // Presets modal buttons
  const btnPresetsClose = document.getElementById('presets-modal-close-btn');
  if (btnPresetsClose) btnPresetsClose.onclick = closePresetsModal;

  const btnPresetsCloseBottom = document.getElementById('presets-modal-close-bottom');
  if (btnPresetsCloseBottom) btnPresetsCloseBottom.onclick = closePresetsModal;

  const btnCreateFromClient = document.getElementById('btn-create-preset-from-client');
  if (btnCreateFromClient) btnCreateFromClient.onclick = () => openSaveClientPresetModal();

  const btnPresetsModalImport = document.getElementById('btn-presets-modal-import');
  if (btnPresetsModalImport) btnPresetsModalImport.onclick = openImportProfileModal;

  const btnPresetsModalExport = document.getElementById('btn-presets-modal-export');
  if (btnPresetsModalExport) btnPresetsModalExport.onclick = exportAllPresets;

  // Copy-to modal buttons
  const btnCopyClose = document.getElementById('copy-to-modal-close-btn');
  if (btnCopyClose) btnCopyClose.onclick = closeCopyToModal;

  const btnCopyCancel = document.getElementById('copy-to-modal-cancel');
  if (btnCopyCancel) btnCopyCancel.onclick = closeCopyToModal;

  const btnCopyConfirm = document.getElementById('copy-to-modal-confirm');
  if (btnCopyConfirm) btnCopyConfirm.onclick = confirmApplyCopyTo;

  const btnSelectAll = document.getElementById('btn-copy-to-select-all');
  if (btnSelectAll) {
    btnSelectAll.onclick = () => {
      document.querySelectorAll('.copy-to-profile-checkbox').forEach(cb => cb.checked = true);
    };
  }

  const btnDeselectAll = document.getElementById('btn-copy-to-deselect-all');
  if (btnDeselectAll) {
    btnDeselectAll.onclick = () => {
      document.querySelectorAll('.copy-to-profile-checkbox').forEach(cb => cb.checked = false);
    };
  }

  // Import modal buttons & form
  const btnImportClose = document.getElementById('import-modal-close-btn');
  if (btnImportClose) btnImportClose.onclick = closeImportProfileModal;

  const btnImportCancel = document.getElementById('import-modal-cancel-btn');
  if (btnImportCancel) btnImportCancel.onclick = closeImportProfileModal;

  const importForm = document.getElementById('import-profile-form');
  if (importForm) importForm.onsubmit = handleImportProfileSubmit;

  const importFileInput = document.getElementById('import-file-input');
  if (importFileInput) {
    importFileInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target.result;
        const textarea = document.getElementById('import-json-textarea');
        if (textarea) textarea.value = text;
        try {
          const parsed = JSON.parse(text);
          const nameInput = document.getElementById('import-preset-name');
          if (nameInput) {
            if (parsed && (parsed.format === 'pmhee-aetheria-profile-backup-v1' || (Array.isArray(parsed.profiles) && !parsed.presets))) {
              nameInput.value = `ไฟล์สำรองโปรไฟล์ + ID/Pass (${parsed.profiles.length} จอ)`;
            } else if (Array.isArray(parsed) || parsed.presets) {
              nameInput.value = `ชุดโปรไฟล์นำเข้า (${(parsed.presets || parsed).length} รายการ)`;
            } else if (parsed.name) {
              nameInput.value = parsed.name;
            } else {
              nameInput.value = file.name.replace(/\.json$/i, '');
            }
          }
        } catch(err) {}
      };
      reader.readAsText(file);
    };
  }

  // Save client modal buttons & form
  const btnSaveClientClose = document.getElementById('save-client-modal-close-btn');
  if (btnSaveClientClose) btnSaveClientClose.onclick = closeSaveClientPresetModal;

  const btnSaveClientCancel = document.getElementById('save-client-modal-cancel');
  if (btnSaveClientCancel) btnSaveClientCancel.onclick = closeSaveClientPresetModal;

  const saveClientForm = document.getElementById('save-client-preset-form');
  if (saveClientForm) saveClientForm.onsubmit = handleSaveClientPresetSubmit;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupPresetsEventListeners);
} else {
  setupPresetsEventListeners();
}

// Initial fetch presets
fetchPresets();


// ==========================================================================
// CARD WHITELIST MODAL & CONTROLLER
// ==========================================================================
let activeWLProfileId = null;
let activeWLItems = [];
let activeWLViewMode = 'chips'; // 'chips' or 'text'

async function openCardWhitelistModal(profileId) {
  activeWLProfileId = profileId;
  const profile = currentProfiles.find(p => p.id === profileId);
  if (!profile) return;

  const modal = document.getElementById('card-whitelist-modal');
  const subtitleEl = document.getElementById('card-wl-subtitle');
  const bannerEl = document.getElementById('card-wl-banner');
  const statusTextEl = document.getElementById('card-wl-status-text');
  const copyPanel = document.getElementById('card-wl-copy-panel');
  const inputEl = document.getElementById('card-wl-input');

  if (copyPanel) copyPanel.style.display = 'none';
  if (inputEl) inputEl.value = '';

  activeWLViewMode = 'chips';
  updateWLViewModeUI();

  if (subtitleEl) {
    subtitleEl.innerText = `จอ: ${profile.name} (${profile.account || 'No account'}) • Port: ${profile.debugPort || '--'}`;
  }

  if (statusTextEl) {
    statusTextEl.innerText = '⏳ กำลังดึงข้อมูล Whitelist จากจอเกม...';
  }

  // Open modal first with loading state
  if (modal) modal.classList.add('active');

  try {
    const res = await fetch(`${API_BASE}/api/profiles/${profileId}/whitelist`);
    const data = await res.json();
    if (data.success) {
      activeWLItems = Array.isArray(data.items) ? data.items : [];
      if (statusTextEl) {
        if (data.isOnline) {
          statusTextEl.innerHTML = `🟢 <b>ออนไลน์</b> (Port ${profile.debugPort}) — ซิงค์ข้อมูล Real-time กับเกมสด`;
          if (bannerEl) bannerEl.style.background = 'rgba(16, 185, 129, 0.12)';
          if (bannerEl) bannerEl.style.borderColor = 'rgba(16, 185, 129, 0.3)';
          if (bannerEl) bannerEl.style.color = '#a7f3d0';
        } else {
          statusTextEl.innerHTML = `⚪ <b>ออฟไลน์</b> — ข้อมูลบันทึกไว้ในโปรไฟล์ (จะอัปเดตเมื่อเปิดจอ)`;
          if (bannerEl) bannerEl.style.background = 'rgba(148, 163, 184, 0.1)';
          if (bannerEl) bannerEl.style.borderColor = 'rgba(148, 163, 184, 0.25)';
          if (bannerEl) bannerEl.style.color = '#cbd5e1';
        }
      }
    } else {
      activeWLItems = (profile.whitelist || '').split(',').map(s => s.trim()).filter(Boolean);
      if (statusTextEl) statusTextEl.innerText = '⚠️ ใช้ข้อมูลจากโปรไฟล์เครื่อง';
    }
  } catch(e) {
    console.warn('Fetch whitelist error:', e);
    activeWLItems = (profile.whitelist || '').split(',').map(s => s.trim()).filter(Boolean);
    if (statusTextEl) statusTextEl.innerText = '⚠️ ใช้ข้อมูลแคชในตัว';
  }

  renderCardWhitelistChips();
}

function closeCardWhitelistModal() {
  const modal = document.getElementById('card-whitelist-modal');
  if (modal) modal.classList.remove('active');
  const copyPanel = document.getElementById('card-wl-copy-panel');
  if (copyPanel) copyPanel.style.display = 'none';
  activeWLProfileId = null;
  activeWLItems = [];
}

function renderCardWhitelistChips() {
  const container = document.getElementById('card-wl-chips-container');
  const textarea = document.getElementById('card-wl-textarea');
  const countBadge = document.getElementById('card-wl-count-badge');

  if (countBadge) {
    countBadge.innerText = `${activeWLItems.length} รายการ`;
  }

  if (textarea) {
    textarea.value = activeWLItems.join(', ');
  }

  if (!container) return;

  if (activeWLItems.length === 0) {
    container.innerHTML = `
      <div class="wl-empty-msg">
        <span style="font-size: 24px; opacity: 0.6;">📦</span>
        <span>ไม่มีไอเทมใน Whitelist (บอทจะขายทุกชิ้นตามเกณฑ์ความหายาก)</span>
        <span style="font-size: 11px; opacity: 0.7;">พิมพ์ชื่อไอเทมด้านบนแล้วกด "➕ เพิ่ม" หรือกด "📥 นำเข้า"</span>
      </div>
    `;
    return;
  }

  container.innerHTML = activeWLItems.map((item, idx) => `
    <div class="wl-chip" title="${escapeHTML(item)}">
      <span class="wl-chip-icon">🛡️</span>
      <span class="wl-chip-text">${escapeHTML(item)}</span>
      <span class="wl-chip-del" onclick="removeCardWhitelistItem(${idx})" title="ลบออกจาก Whitelist">&times;</span>
    </div>
  `).join('');
}

function addCardWhitelistItems(inputStr) {
  if (!inputStr || !inputStr.trim()) return;
  const parts = inputStr.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
  let addedCount = 0;

  parts.forEach(name => {
    const exists = activeWLItems.some(existing => existing.toLowerCase() === name.toLowerCase());
    if (!exists) {
      activeWLItems.push(name);
      addedCount++;
    }
  });

  renderCardWhitelistChips();
  return addedCount;
}

function removeCardWhitelistItem(idx) {
  if (idx >= 0 && idx < activeWLItems.length) {
    activeWLItems.splice(idx, 1);
    renderCardWhitelistChips();
  }
}

function updateWLViewModeUI() {
  const chipsContainer = document.getElementById('card-wl-chips-container');
  const textContainer = document.getElementById('card-wl-text-container');
  const viewLabel = document.getElementById('card-wl-view-label');
  const textarea = document.getElementById('card-wl-textarea');

  if (activeWLViewMode === 'chips') {
    if (chipsContainer) chipsContainer.style.display = 'flex';
    if (textContainer) textContainer.style.display = 'none';
    if (viewLabel) viewLabel.innerText = '📝 Text Mode';
  } else {
    if (chipsContainer) chipsContainer.style.display = 'none';
    if (textContainer) textContainer.style.display = 'block';
    if (viewLabel) viewLabel.innerText = '🏷️ Tags Mode';
    if (textarea) textarea.value = activeWLItems.join(', ');
  }
}

function toggleCardWhitelistViewMode() {
  const textarea = document.getElementById('card-wl-textarea');
  if (activeWLViewMode === 'chips') {
    activeWLViewMode = 'text';
    if (textarea) textarea.value = activeWLItems.join(', ');
  } else {
    if (textarea) {
      const parts = textarea.value.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
      const unique = [];
      parts.forEach(p => {
        if (!unique.some(u => u.toLowerCase() === p.toLowerCase())) {
          unique.push(p);
        }
      });
      activeWLItems = unique;
    }
    activeWLViewMode = 'chips';
  }
  updateWLViewModeUI();
  renderCardWhitelistChips();
}

function handleCardWhitelistImport() {
  const fileInput = document.getElementById('card-wl-file-input');
  if (fileInput) {
    fileInput.value = '';
    fileInput.click();
  }
}

function handleCardWhitelistExport() {
  if (activeWLItems.length === 0) {
    alert('Whitelist ว่างเปล่า ไม่มีรายการให้ส่งออก');
    return;
  }
  const profile = currentProfiles.find(p => p.id === activeWLProfileId);
  const text = activeWLItems.join(', ');

  // 1. Copy to clipboard
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  // 2. Download as text file
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = (profile?.name || 'profile').replace(/[^a-zA-Z0-9_\u0E00-\u0E7F]/g, '_');
  a.download = `whitelist_${safeName}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  alert(`📤 ส่งออกเรียบร้อย!\n- คัดลอก ${activeWLItems.length} รายการลงคลิปบอร์ดแล้ว\n- ดาวน์โหลดไฟล์ ${a.download} เรียบร้อยแล้ว`);
}

function toggleCardWhitelistCopyPanel() {
  const panel = document.getElementById('card-wl-copy-panel');
  if (!panel) return;
  const isHidden = panel.style.display === 'none' || !panel.style.display;
  if (isHidden) {
    populateWLCopyTargetList();
    panel.style.display = 'block';
  } else {
    panel.style.display = 'none';
  }
}

function populateWLCopyTargetList() {
  const container = document.getElementById('card-wl-target-clients-list');
  if (!container) return;

  const targets = currentProfiles.filter(p => p.id !== activeWLProfileId);
  if (targets.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: #94a3b8; padding: 8px; font-size: 11px;">ไม่มีจออื่นในระบบให้คัดลอก</div>';
    return;
  }

  container.innerHTML = targets.map(p => `
    <label class="wl-target-client-item">
      <div style="display: flex; align-items: center; gap: 8px;">
        <input type="checkbox" class="wl-target-checkbox" value="${p.id}" checked style="width: 14px; height: 14px; cursor: pointer;">
        <span style="font-size: 12px; font-weight: 600; color: #f8fafc;">${escapeHTML(p.name)}</span>
        <span style="font-size: 11px; color: #94a3b8;">(${escapeHTML(p.charClass || 'Archer')})</span>
        <span style="font-size: 10px; color: #64748b;">Port: ${p.debugPort || '--'}</span>
      </div>
      <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 600; ${p.isRunning ? 'background: rgba(34,197,94,0.18); color: #4ade80; border: 1px solid rgba(34,197,94,0.3);' : 'background: rgba(148,163,184,0.12); color: #94a3b8; border: 1px solid rgba(148,163,184,0.2);'}">
        ${p.isRunning ? '🟢 ออนไลน์' : '⚪ ออฟไลน์'}
      </span>
    </label>
  `).join('');
}

async function executeCardWhitelistCopyToTargets() {
  if (!activeWLProfileId) return;
  const checkboxes = document.querySelectorAll('.wl-target-checkbox:checked');
  const targetIds = Array.from(checkboxes).map(cb => cb.value);

  if (targetIds.length === 0) {
    alert('กรุณาเลือกจอเป้าหมายอย่างน้อย 1 จอ');
    return;
  }

  if (activeWLViewMode === 'text') {
    const textarea = document.getElementById('card-wl-textarea');
    if (textarea) {
      activeWLItems = textarea.value.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
    }
  }

  const execBtn = document.getElementById('btn-card-wl-copy-execute');
  const originalText = execBtn ? execBtn.innerHTML : '';
  if (execBtn) {
    execBtn.disabled = true;
    execBtn.innerHTML = '⏳ กำลังคัดลอก...';
  }

  try {
    const res = await fetch(`${API_BASE}/api/profiles/${activeWLProfileId}/whitelist`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        whitelist: activeWLItems.join(', '),
        targets: targetIds
      })
    });
    const result = await res.json();
    if (result.success) {
      alert(`🚀 ${result.message || 'คัดลอก Whitelist สำเร็จแล้ว!'}`);
      const panel = document.getElementById('card-wl-copy-panel');
      if (panel) panel.style.display = 'none';
      fetchProfiles();
    } else {
      alert('เกิดข้อผิดพลาด: ' + (result.error || 'ไม่สามารถคัดลอกได้'));
    }
  } catch(e) {
    alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
  } finally {
    if (execBtn) {
      execBtn.disabled = false;
      execBtn.innerHTML = originalText;
    }
  }
}

async function saveCardWhitelist() {
  if (!activeWLProfileId) return;

  if (activeWLViewMode === 'text') {
    const textarea = document.getElementById('card-wl-textarea');
    if (textarea) {
      const parts = textarea.value.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
      const unique = [];
      parts.forEach(p => {
        if (!unique.some(u => u.toLowerCase() === p.toLowerCase())) {
          unique.push(p);
        }
      });
      activeWLItems = unique;
    }
  }

  const saveBtn = document.getElementById('btn-card-wl-save');
  const originalText = saveBtn ? saveBtn.innerHTML : '';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '⏳ กำลังบันทึก...';
  }

  try {
    const res = await fetch(`${API_BASE}/api/profiles/${activeWLProfileId}/whitelist`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        whitelist: activeWLItems.join(', ')
      })
    });
    const result = await res.json();
    if (result.success) {
      alert('💾 บันทึก Whitelist สำเร็จและอัปเดตเข้าจอเกมเรียบร้อยแล้ว!');
      closeCardWhitelistModal();
      fetchProfiles();
    } else {
      alert('เกิดข้อผิดพลาด: ' + (result.error || 'ไม่สามารถบันทึกได้'));
    }
  } catch(e) {
    alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalText;
    }
  }
}

function setupCardWhitelistEventListeners() {
  const btnClose = document.getElementById('card-wl-modal-close-btn');
  if (btnClose) btnClose.onclick = closeCardWhitelistModal;

  const btnCancel = document.getElementById('card-wl-modal-cancel');
  if (btnCancel) btnCancel.onclick = closeCardWhitelistModal;

  const inputEl = document.getElementById('card-wl-input');
  const btnAdd = document.getElementById('btn-card-wl-add');
  const handleAdd = () => {
    if (inputEl && inputEl.value.trim()) {
      addCardWhitelistItems(inputEl.value);
      inputEl.value = '';
      inputEl.focus();
    }
  };
  if (btnAdd) btnAdd.onclick = handleAdd;
  if (inputEl) {
    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAdd();
      }
    };
  }

  const btnToggleView = document.getElementById('btn-card-wl-toggle-view');
  if (btnToggleView) btnToggleView.onclick = toggleCardWhitelistViewMode;

  const btnImport = document.getElementById('btn-card-wl-import');
  if (btnImport) btnImport.onclick = handleCardWhitelistImport;

  const fileInput = document.getElementById('card-wl-file-input');
  if (fileInput) {
    fileInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target.result;
        let importedItems = [];
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            importedItems = parsed.map(String);
          } else if (parsed.whitelist) {
            importedItems = String(parsed.whitelist).split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
          } else if (parsed.items && Array.isArray(parsed.items)) {
            importedItems = parsed.items.map(String);
          }
        } catch(err) {
          importedItems = content.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
        }

        if (importedItems.length === 0) {
          alert('ไม่พบรายการไอเทมในไฟล์ที่เลือก');
          return;
        }

        const isReplace = confirm(`พบรายการไอเทมทั้งหมด ${importedItems.length} รายการ\n\nต้องการ "แทนที่ทั้งหมด (Replace)" หรือไม่?\n[OK] = แทนที่ทั้งหมด\n[Cancel] = เพิ่มต่อท้าย (Append)`);
        if (isReplace) {
          activeWLItems = [];
        }

        importedItems.forEach(name => {
          name = name.trim();
          if (name && !activeWLItems.some(existing => existing.toLowerCase() === name.toLowerCase())) {
            activeWLItems.push(name);
          }
        });

        renderCardWhitelistChips();
        alert(`📥 นำเข้าเรียบร้อย! ตอนนี้มีทั้งหมด ${activeWLItems.length} รายการ`);
      };
      reader.readAsText(file);
    };
  }

  const btnExport = document.getElementById('btn-card-wl-export');
  if (btnExport) btnExport.onclick = handleCardWhitelistExport;

  const btnCopyTo = document.getElementById('btn-card-wl-copy-to');
  if (btnCopyTo) btnCopyTo.onclick = toggleCardWhitelistCopyPanel;

  const btnCopyCancel = document.getElementById('btn-card-wl-copy-cancel');
  if (btnCopyCancel) btnCopyCancel.onclick = () => {
    const panel = document.getElementById('card-wl-copy-panel');
    if (panel) panel.style.display = 'none';
  };

  const btnCopySelectAll = document.getElementById('btn-card-wl-copy-select-all');
  if (btnCopySelectAll) btnCopySelectAll.onclick = () => {
    document.querySelectorAll('.wl-target-checkbox').forEach(cb => cb.checked = true);
  };

  const btnCopyClearAll = document.getElementById('btn-card-wl-copy-clear-all');
  if (btnCopyClearAll) btnCopyClearAll.onclick = () => {
    document.querySelectorAll('.wl-target-checkbox').forEach(cb => cb.checked = false);
  };

  const btnCopyExec = document.getElementById('btn-card-wl-copy-execute');
  if (btnCopyExec) btnCopyExec.onclick = executeCardWhitelistCopyToTargets;

  const btnClearAll = document.getElementById('btn-card-wl-clear-all');
  if (btnClearAll) {
    btnClearAll.onclick = () => {
      if (activeWLItems.length === 0) return;
      if (confirm('คุณแน่ใจหรือไม่ว่าต้องการล้างรายการ Whitelist ทั้งหมดสำหรับจอนี้?')) {
        activeWLItems = [];
        renderCardWhitelistChips();
      }
    };
  }

  const btnSave = document.getElementById('btn-card-wl-save');
  if (btnSave) btnSave.onclick = saveCardWhitelist;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupCardWhitelistEventListeners();
    initCharacterModalEvents();
  });
} else {
  setupCardWhitelistEventListeners();
  initCharacterModalEvents();
}

// ==========================================
// CHARACTER DETAIL & INTERACTIVE EQUIPMENT WINDOW
// ==========================================
let currentCharProfileId = null;
let currentCharData = null;
let currentCharTab = 'equip'; // 'equip' | 'costume' | 'gem'
let selectedSlotDef = null;

const CHAR_EQUIP_SLOTS_LEFT = [
  { key: 'head-upper', label: 'หมวกบน', icon: '👑', equipTypes: ['Helmet', 'head-upper'] },
  { key: 'head-middle', label: 'หน้า', icon: '🎭', equipTypes: ['HeadMid', 'head-middle'] },
  { key: 'head-lower', label: 'ปาก', icon: '🌿', equipTypes: ['HeadLow', 'head-lower'] },
  { key: 'armor', label: 'เกราะ / เสื้อ', icon: '👕', equipTypes: ['Armor', 'armor'] },
  { key: 'gloves', label: 'ถุงมือ', icon: '🧤', equipTypes: ['Glove', 'gloves'] },
  { key: 'accessory-left', label: 'เครื่องประดับ 1', icon: '💍', equipTypes: ['Acc', 'Accessory', 'accessory-left', 'accessory-right'] }
];

const CHAR_EQUIP_SLOTS_RIGHT = [
  { key: 'main-hand', label: 'อาวุธ', icon: '🗡️', equipTypes: ['Weapon', 'main-hand'] },
  { key: 'off-hand', label: 'มือซ้าย / โล่', icon: '🛡️', equipTypes: ['Shield', 'off-hand', 'Weapon'] },
  { key: 'garment', label: 'ผ้าคลุม', icon: '🧣', equipTypes: ['Cape', 'Garment', 'garment'] },
  { key: 'legs', label: 'กางเกง', icon: '👖', equipTypes: ['Pants', 'legs'] },
  { key: 'boots', label: 'รองเท้า', icon: '👢', equipTypes: ['Boot', 'Boots', 'boots'] },
  { key: 'accessory-right', label: 'เครื่องประดับ 2', icon: '💍', equipTypes: ['Acc', 'Accessory', 'accessory-left', 'accessory-right'] }
];

const CHAR_AMMO_SLOT = { key: 'ammo', label: 'กระสุน / ลูกธนู', icon: '🏹', equipTypes: ['Ammo', 'ammo'] };

const CHAR_GEM_SLOTS = [
  { key: 'gem-1', label: 'เจมช่อง 1', icon: '💎', equipTypes: ['Gem', 'gem-1'] },
  { key: 'gem-2', label: 'เจมช่อง 2', icon: '💎', equipTypes: ['Gem', 'gem-2'] },
  { key: 'gem-3', label: 'เจมช่อง 3', icon: '💎', equipTypes: ['Gem', 'gem-3'] },
  { key: 'gem-4', label: 'เจมช่อง 4', icon: '💎', equipTypes: ['Gem', 'gem-4'] }
];

const CHAR_COSTUME_SLOTS = [
  { key: 'costume-head-upper', label: 'คอสตูมหมวกบน', icon: '✨', equipTypes: ['Costume', 'costume-head-upper'] },
  { key: 'costume-head-middle', label: 'คอสตูมหน้า', icon: '✨', equipTypes: ['Costume', 'costume-head-middle'] },
  { key: 'costume-head-lower', label: 'คอสตูมปาก', icon: '✨', equipTypes: ['Costume', 'costume-head-lower'] },
  { key: 'costume-garment', label: 'คอสตูมผ้าคลุม', icon: '✨', equipTypes: ['Costume', 'costume-garment'] }
];

function getRarityColor(rarity) {
  const r = String(rarity || 'common').toLowerCase();
  if (r === 'legendary' || r === 'mythic') return '#fbbf24';
  if (r === 'epic') return '#c084fc';
  if (r === 'rare') return '#38bdf8';
  if (r === 'uncommon') return '#4ade80';
  return '#cbd5e1';
}

function formatItemDisplayName(item) {
  if (!item) return '';
  let name = item.name || 'Unknown Item';
  if (item.refine && item.refine > 0 && !name.startsWith('+')) {
    name = `+${item.refine} ${name}`;
  }
  if (item.slots && item.slots > 0 && !name.includes('[')) {
    name = `${name} [${item.slots}]`;
  }
  return name;
}

// Item stats come in two groups:
//   item.attributes = base stats, fixed for the item type (e.g. Formal Suit always DEF +5)
//   item.affixes    = random options rolled per drop ("ออฟชั่นสุ่ม" / Random Options / Affixes)
const ITEM_STAT_LABELS = {
  MELEE_DEFENSE: 'DEF', MAGIC_DEFENSE: 'MDEF', DEFENSE: 'DEF', DEF: 'DEF', MDEF: 'MDEF',
  RANGE_ATTACK: 'ATK ระยะไกล', RANGED_ATK: 'ATK ระยะไกล', MELEE_ATTACK: 'ATK ประชิด', MELEE_ATK: 'ATK ประชิด',
  ATTACK: 'ATK', ATK: 'ATK', MAGIC_ATTACK: 'MATK', MATK: 'MATK',
  STR: 'STR', AGI: 'AGI', VIT: 'VIT', INT: 'INT', DEX: 'DEX', LUK: 'LUK',
  MAXHP: 'Max HP', MAX_HP: 'Max HP', MAXSP: 'Max SP', MAX_SP: 'Max SP',
  HIT: 'HIT', FLEE: 'FLEE', CRIT: 'CRIT', CRITICAL: 'CRIT', CRIT_DAMAGE: 'ดาเมจคริ',
  ASPD: 'ASPD', ATTACK_SPEED: 'ASPD', MOVE_SPEED: 'ความเร็วเดิน', HEAL_POWER: 'พลังฮีล',
  BLOCK_CHANCE: 'โอกาสบล็อก', DAMAGE_REDUCTION: 'ลดดาเมจที่ได้รับ', IGNORE_SIZE: 'ยกเลิกโทษขนาดอาวุธ',
  MELEE_DAMAGE_PERCENT: 'ดาเมจระยะประชิด', RANGED_DAMAGE_PERCENT: 'ดาเมจระยะไกล', MAGIC_DAMAGE_PERCENT: 'ดาเมจเวท'
};

// Stats shown with "%" even when rolled in "base" mode (same set the game's formatter uses)
const ITEM_PERCENT_STATS = new Set(['MOVE_SPEED', 'CRIT_DAMAGE', 'MELEE_DAMAGE_PERCENT', 'RANGED_DAMAGE_PERCENT',
  'MAGIC_DAMAGE_PERCENT', 'DAMAGE_REDUCTION', 'BLOCK_CHANCE', 'HEAL_POWER']);

function getItemStatLabel(type) {
  return ITEM_STAT_LABELS[type] || String(type || 'Stat').replace(/_/g, ' ');
}

// Mirrors the game: base mode -> "+v" (+"%" for percent stats); increasedPercent/morePercent -> "+v%"
function formatItemStatValue(stat) {
  if (stat.type === 'IGNORE_SIZE') return '';
  const v = Number(stat.value) || 0;
  const sign = v > 0 ? '+' : '';
  if (!stat.mode || stat.mode === 'base') return `${sign}${v}${ITEM_PERCENT_STATS.has(stat.type) ? '%' : ''}`;
  return `${sign}${v}%${stat.mode === 'morePercent' ? ' (คูณ)' : ''}`;
}

// attributes may arrive as an array of {type, value} or a plain {TYPE: value} object
function getItemBaseStats(item) {
  const a = item?.attributes;
  if (Array.isArray(a)) return a.filter(s => s && s.value !== undefined);
  if (a && typeof a === 'object') return Object.entries(a).map(([type, value]) => ({ type, value }));
  return [];
}

function getItemRandomOptions(item) {
  return Array.isArray(item?.affixes) ? item.affixes.filter(s => s && s.value !== undefined) : [];
}

function renderStatChip(stat, kind, highlightTypes) {
  const isHit = Boolean(highlightTypes && highlightTypes.includes(stat.type));
  const cls = kind === 'base' ? 'base' : `opt ${stat.category === 'primary' ? 'primary' : 'secondary'}`;
  const tip = kind === 'base'
    ? 'ค่าพื้นฐานของไอเทม (คงที่)'
    : `ออฟชั่นสุ่ม${stat.category === 'primary' ? ' (หลัก)' : ' (รอง)'}`;
  return `<span class="stat-chip ${cls}${isHit ? ' hit' : ''}" title="${tip}"><span>${escapeHTML(getItemStatLabel(stat.type))}</span><b>${escapeHTML(formatItemStatValue(stat))}</b></span>`;
}

function renderItemStatGroups(item, highlightTypes) {
  if (!item) return '';
  const base = getItemBaseStats(item);
  const opts = getItemRandomOptions(item);
  const extras = [];
  if (Array.isArray(item.effects)) item.effects.forEach(ef => extras.push(`🌟 ${typeof ef === 'object' ? (ef.name || ef.type || '') : ef}`));
  if (Array.isArray(item.cards) && item.cards.length > 0) {
    extras.push(`🎴 การ์ด: ${item.cards.map(c => (typeof c === 'object' ? c.name : c) || 'Card').join(', ')}`);
  }
  if (base.length === 0 && opts.length === 0 && extras.length === 0) return '';
  return `
    <div class="item-stat-groups">
      ${base.length ? `<div class="item-stat-row"><span class="isr-label">พื้นฐาน</span><div class="isr-chips">${base.map(s => renderStatChip(s, 'base')).join('')}</div></div>` : ''}
      ${opts.length ? `<div class="item-stat-row"><span class="isr-label opt">ออฟชั่น</span><div class="isr-chips">${opts.map(s => renderStatChip(s, 'opt', highlightTypes)).join('')}</div></div>` : ''}
      ${extras.map(t => `<div class="item-stat-extra">${escapeHTML(t)}</div>`).join('')}
    </div>`;
}

function renderItemAffixesHtml(item) {
  return renderItemStatGroups(item);
}

function renderItemAffixSummary(item, highlightTypes) {
  return renderItemStatGroups(item, highlightTypes);
}

// ---------- Bag filter by random options (affixes only, base stats ignored) ----------
// Typed query such as "dex, matk>=5, melee dmg" — parsed by OptionQuery (inventory_market.js)
let gearOptFilter = { slotKey: null, text: '', mode: 'all' };

function rerenderGearScanner() {
  if (selectedSlotDef && currentCharData) renderGearScanner(selectedSlotDef, currentCharData);
}

function getGearOptQuery() {
  return window.OptionQuery ? window.OptionQuery.parse(gearOptFilter.text) : { terms: [], names: [] };
}

function getGearOptHighlight() {
  return getGearOptQuery().terms.map(t => t.type);
}

function setGearOptFilterMode(mode) {
  gearOptFilter.mode = mode === 'any' ? 'any' : 'all';
  rerenderGearScanner();
}

function clearGearOptFilter() {
  gearOptFilter.text = '';
  const input = document.querySelector('#scanner-opt-filter .sof-input');
  if (input) input.value = '';
  rerenderGearScanner();
}

// Clicking a suggestion appends it to the typed query
function appendGearOptToken(type) {
  const token = String(type).toLowerCase().replace(/_/g, ' ');
  const cur = gearOptFilter.text.trim().replace(/,\s*$/, '');
  gearOptFilter.text = cur ? `${cur}, ${token}` : token;
  const input = document.querySelector('#scanner-opt-filter .sof-input');
  if (input) { input.value = gearOptFilter.text; input.focus(); }
  rerenderGearScanner();
}

function applyGearOptFilter(candidates) {
  const q = getGearOptQuery();
  if (!window.OptionQuery || (q.terms.length === 0 && q.names.length === 0)) return candidates;
  return candidates
    .filter(item => window.OptionQuery.matches(item, q, gearOptFilter.mode))
    .map(item => ({ item, score: window.OptionQuery.score(item, q) }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.item);
}

function renderGearOptFilterBar(candidates) {
  const el = document.getElementById('scanner-opt-filter');
  if (!el) return;
  const counts = new Map();
  candidates.forEach(item => {
    new Set(getItemRandomOptions(item).map(o => o.type)).forEach(t => counts.set(t, (counts.get(t) || 0) + 1));
  });
  if (counts.size === 0 && !gearOptFilter.text) {
    el.style.display = 'none';
    el.innerHTML = '';
    el.dataset.slotKey = '';
    return;
  }
  el.style.display = '';

  // Build the input once per slot so re-renders while typing never steal focus
  if (el.dataset.slotKey !== gearOptFilter.slotKey || !el.querySelector('.sof-input')) {
    el.dataset.slotKey = gearOptFilter.slotKey;
    el.innerHTML = `
      <div class="sof-head">
        <span class="sof-title" title="ออฟชั่นสุ่ม (Random Options / Affixes) คือค่าที่สุ่มตอนไอเทมดรอป ไม่รวมค่าพื้นฐานของไอเทม">🎛️ กรองตามออฟชั่นสุ่ม</span>
        <div class="sof-actions"><div class="sof-mode" data-role="mode" title="เงื่อนไขเมื่อพิมพ์หลายออฟชั่น"></div></div>
      </div>
      <div class="sof-input-row">
        <input type="text" class="sof-input" placeholder="พิมพ์ เช่น dex, matk, melee dmg>=5" autocomplete="off">
        <button type="button" class="sof-clear" onclick="clearGearOptFilter()">ล้าง</button>
      </div>
      <div class="sof-parsed" data-role="parsed"></div>
      <div class="sof-suggest" data-role="suggest"></div>`;
    const input = el.querySelector('.sof-input');
    input.value = gearOptFilter.text;
    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { gearOptFilter.text = input.value; rerenderGearScanner(); }, 150);
    });
  }

  el.querySelector('[data-role="mode"]').innerHTML = `
    <button type="button" class="${gearOptFilter.mode === 'all' ? 'active' : ''}" onclick="setGearOptFilterMode('all')">ครบทุกข้อ</button>
    <button type="button" class="${gearOptFilter.mode === 'any' ? 'active' : ''}" onclick="setGearOptFilterMode('any')">ข้อใดข้อหนึ่ง</button>`;

  const q = getGearOptQuery();
  el.querySelector('[data-role="parsed"]').innerHTML = [
    ...q.terms.map(t => `<span class="sof-token ok">✓ ${escapeHTML(window.OptionQuery.describe(t))}</span>`),
    ...q.names.map(n => `<span class="sof-token name">ชื่อ: ${escapeHTML(n)}</span>`)
  ].join('');

  const typed = new Set(q.terms.map(t => t.type));
  const sorted = [...counts.entries()]
    .filter(([type]) => !typed.has(type))
    .sort((a, b) => b[1] - a[1] || getItemStatLabel(a[0]).localeCompare(getItemStatLabel(b[0])));
  el.querySelector('[data-role="suggest"]').innerHTML = sorted.length
    ? `<span class="sof-suggest-lbl">มีในกระเป๋า:</span>${sorted.map(([type, n]) =>
        `<button type="button" class="sof-chip" data-type="${escapeHTML(type)}" onclick="appendGearOptToken(this.dataset.type)">${escapeHTML(getItemStatLabel(type))}<small>${n}</small></button>`
      ).join('')}`
    : '';
}

function isItemMatchingSlot(item, slotDef, classId) {
  if (!item || !slotDef) return false;
  const eq = item.equipType || '';
  const key = slotDef.key;
  
  if (key === 'main-hand') {
    return eq === 'Weapon' || item.type === 'Weapon' || (item.weaponType && item.weaponType !== 'none');
  }
  if (key === 'off-hand') {
    if (eq === 'Shield' || item.type === 'Shield') return true;
    if (classId === 'assassin' && (eq === 'Weapon' || item.type === 'Weapon')) return true;
    return false;
  }
  if (key === 'ammo') {
    return eq === 'Ammo' || item.type === 'Ammo' || item.ammoType != null;
  }
  if (key.startsWith('gem-')) {
    return eq === 'Gem' || item.type === 'Gem';
  }
  if (key === 'head-upper') {
    return eq === 'Helmet' || eq === 'head-upper';
  }
  if (key === 'head-middle') {
    return eq === 'HeadMid' || eq === 'head-middle';
  }
  if (key === 'head-lower') {
    return eq === 'HeadLow' || eq === 'head-lower';
  }
  if (key === 'armor') {
    return eq === 'Armor' || eq === 'armor';
  }
  if (key === 'gloves') {
    return eq === 'Glove' || eq === 'gloves';
  }
  if (key === 'garment') {
    return eq === 'Cape' || eq === 'Garment' || eq === 'garment';
  }
  if (key === 'legs') {
    return eq === 'Pants' || eq === 'legs';
  }
  if (key === 'boots') {
    return eq === 'Boot' || eq === 'Boots' || eq === 'boots';
  }
  if (key.startsWith('accessory-')) {
    return eq === 'Acc' || eq === 'Accessory' || eq === 'accessory';
  }
  if (slotDef.equipTypes && Array.isArray(slotDef.equipTypes)) {
    return slotDef.equipTypes.includes(eq);
  }
  return false;
}

function openCharacterModal(profileId) {
  currentCharProfileId = profileId;
  selectedSlotDef = null;
  currentCharTab = 'equip';
  
  const modal = document.getElementById('char-detail-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  
  const nameEl = document.getElementById('char-modal-name');
  if (nameEl) nameEl.innerText = 'กำลังโหลดข้อมูลตัวละคร...';
  
  loadCharacterDetail(profileId, false);
  if (window.InvMarket) window.InvMarket.open(profileId);  // bag panel + market window
}

function closeCharacterModal() {
  const modal = document.getElementById('char-detail-modal');
  if (modal) modal.style.display = 'none';
  if (window.InvMarket) window.InvMarket.close();
  currentCharProfileId = null;
  currentCharData = null;
  selectedSlotDef = null;
}

async function loadCharacterDetail(profileId, keepSelectedSlot = true) {
  try {
    const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/character`);
    const data = await res.json();
    if (!data.success) {
      alert(`ไม่สามารถดึงข้อมูลตัวละครได้: ${data.error || 'บอทอาจจะยังไม่เชื่อมต่อหรืออยู่ในหน้าเลือกตัวละคร'}`);
      closeCharacterModal();
      return;
    }
    currentCharData = data;
    renderCharacterModal(data);
    if (keepSelectedSlot && selectedSlotDef) {
      selectCharSlot(selectedSlotDef);
    }
  } catch (err) {
    console.error('[CharModal] Fetch error:', err);
    alert('เกิดข้อผิดพลาดในการเชื่อมต่อกับตัวละคร: ' + err.message);
  }
}

function selectCharSlotByKey(slotKey) {
  const allDefs = [
    ...CHAR_EQUIP_SLOTS_LEFT,
    ...CHAR_EQUIP_SLOTS_RIGHT,
    CHAR_AMMO_SLOT,
    ...CHAR_GEM_SLOTS,
    ...CHAR_COSTUME_SLOTS
  ];
  const def = allDefs.find(d => d.key === slotKey);
  if (def) selectCharSlot(def);
}

function selectCharSlot(slotDef) {
  selectedSlotDef = slotDef;
  
  document.querySelectorAll('.char-slot-btn, .char-ammo-btn').forEach(btn => {
    btn.classList.toggle('active-selected', btn.dataset.slotKey === slotDef.key);
  });
  
  const statsView = document.getElementById('char-stats-view');
  const scanView = document.getElementById('char-scanner-view');
  if (statsView) statsView.style.display = 'none';
  if (scanView) scanView.style.display = 'flex';
  
  if (currentCharData) {
    renderGearScanner(slotDef, currentCharData);
  }
}

// Game asset paths may come back relative (/art/icons/...); resolve them against the game site
// because the Manager runs on localhost.
function gameAssetUrl(url) {
  if (!url) return '';
  try { return new URL(url, 'https://www.aetheria-online.in.th').href; } catch (e) { return ''; }
}

function renderSlotColumn(containerId, slotDefs, equipment) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = slotDefs.map(def => {
    const it = equipment?.[def.key];
    const isSelected = selectedSlotDef && selectedSlotDef.key === def.key;
    const hasItem = Boolean(it && it.name);
    const displayName = hasItem ? formatItemDisplayName(it) : 'ว่าง';
    const rarityColor = hasItem ? getRarityColor(it.rarity) : '#64748b';
    
    return `
      <button type="button" class="char-slot-btn ${hasItem ? '' : 'empty'} ${isSelected ? 'active-selected' : ''}" data-slot-key="${def.key}" onclick="selectCharSlotByKey('${def.key}')" title="คลิกเพื่อจัดการช่อง: ${def.label}">
        <div class="slot-icon-box">
          ${it?.icon ? `<img src="${escapeHTML(gameAssetUrl(it.icon))}" class="slot-icon-img" alt="" onerror="this.parentElement.innerHTML='${def.icon}'">` : `<span class="slot-icon-ph">${def.icon}</span>`}
        </div>
        <div class="slot-meta">
          <span class="slot-label">${def.label}</span>
          <span class="slot-item-name" style="color: ${rarityColor};">${escapeHTML(displayName)}</span>
        </div>
      </button>
    `;
  }).join('');
}

function renderAmmoSlot(ammoItem) {
  const container = document.getElementById('char-ammo-slot');
  if (!container) return;
  const isSelected = selectedSlotDef && selectedSlotDef.key === 'ammo';
  const hasAmmo = Boolean(ammoItem && ammoItem.name);
  const ammoName = hasAmmo ? `${ammoItem.name} ${ammoItem.qty ? `x${ammoItem.qty.toLocaleString()}` : ''}` : 'ยังไม่ได้ใส่กระสุน';
  
  container.innerHTML = `
    <button type="button" class="char-ammo-btn ${isSelected ? 'active-selected' : ''}" data-slot-key="ammo" onclick="selectCharSlotByKey('ammo')" title="คลิกเพื่อเลือกกระสุน/ลูกธนู">
      <div class="slot-icon-box">
        ${ammoItem?.icon ? `<img src="${escapeHTML(gameAssetUrl(ammoItem.icon))}" class="slot-icon-img" alt="" onerror="this.parentElement.innerHTML='🏹'">` : `<span class="slot-icon-ph">🏹</span>`}
      </div>
      <div class="slot-meta" style="flex: 1; text-align: left;">
        <span class="slot-label">กระสุน / ลูกธนู</span>
        <span class="slot-item-name" style="color: ${hasAmmo ? '#38bdf8' : '#64748b'};">${escapeHTML(ammoName)}</span>
      </div>
    </button>
  `;
}

function renderStatAllocBar(data) {
  const container = document.getElementById('char-stats-alloc-bar');
  if (!container) return;
  const stats = ['STR', 'AGI', 'VIT', 'INT', 'DEX', 'LUK'];
  const curStats = data.stats || {};
  const bonus = data.bonusStats || {};
  const costs = data.statCosts || {};
  const pts = data.statusPoints || 0;

  container.innerHTML = stats.map(st => {
    const val = curStats[st] ?? 1;
    const bon = bonus[st] ?? 0;
    const cost = costs[st] ?? 2;
    const canAdd = pts >= cost;
    return `
      <div class="stat-alloc-box">
        <span class="stat-alloc-name">${st}</span>
        <span class="stat-alloc-val">${val} <span class="stat-alloc-bonus">(+${bon})</span></span>
        <button type="button" class="stat-plus-btn" ${canAdd ? '' : 'disabled style="opacity: 0.35; cursor: not-allowed;"'} onclick="handleStatUp('${st}', 1)" title="ใช้ ${cost} แต้มสถานะเพื่อเพิ่ม ${st}">+</button>
        <span style="font-size: 8.5px; color: #64748b;">${cost} pts</span>
      </div>
    `;
  }).join('');
}

function renderCombatStats(derived, data) {
  const d = derived || {};
  const offEl = document.getElementById('char-stats-offense');
  const defEl = document.getElementById('char-stats-defense');
  const othEl = document.getElementById('char-stats-other');
  if (!offEl || !defEl || !othEl) return;

  const row = (lbl, val) => `
    <div class="stat-row-item">
      <span class="stat-row-lbl">${lbl}</span>
      <span class="stat-row-val">${val}</span>
    </div>
  `;

  // Offense (matching Image 2)
  offEl.innerHTML = [
    row('ATK', d.atk ?? '--'),
    row('MATK', d.matk ?? '--'),
    row('HIT', d.hit ?? '--'),
    row('CRIT', d.crit !== undefined ? `${d.crit}%` : '--'),
    row('ดาเมจคริ', d.critDamagePercent !== undefined ? `${d.critDamagePercent}%` : '--'),
    row('ASPD', d.aspd ? `${d.aspd} (${((d.attackIntervalMs || 0)/1000).toFixed(2)}s)` : '--'),
    row('ตีปกติดูดเลือด', d.hpDrainAttackPercent !== undefined ? `${d.hpDrainAttackPercent}%` : '0%'),
    row('สกิลดูดเลือด', d.hpDrainSkillPercent !== undefined ? `${d.hpDrainSkillPercent}%` : '0%'),
    row('ตีปกติดูด SP', d.spDrainAttackPercent !== undefined ? `${d.spDrainAttackPercent}%` : '0%'),
    row('สกิลดูด SP', d.spDrainSkillPercent !== undefined ? `${d.spDrainSkillPercent}%` : '0%'),
    row('ร่ายเร็วขึ้น', d.castReductionPercent !== undefined ? `${d.castReductionPercent}%` : '0%'),
    row('ระยะโจมตี', d.attackRangeTiles !== undefined ? `${d.attackRangeTiles} ช่อง` : '--'),
    row('ธาตุโจมตี', d.attackElement || 'neutral')
  ].join('');

  // Defense (matching Image 2)
  defEl.innerHTML = [
    row('Max HP', (d.maxHp || data.hpMax || '--').toLocaleString()),
    row('Max SP', (d.maxSp || data.spMax || '--').toLocaleString()),
    row('DEF', d.def ?? '--'),
    row('MDEF', d.mdef ?? '--'),
    row('FLEE', d.flee ?? '--'),
    row('ลดดาเมจ', d.damageReductionPercent !== undefined ? `${d.damageReductionPercent}%` : '0%'),
    row('บล็อก', d.blockChance !== undefined ? `${d.blockChance}%` : '0%'),
    row('ฟื้น HP', d.hpRegen !== undefined ? `+${d.hpRegen}/${d.hpRegenSeconds || 6}s` : '--'),
    row('ฟื้น SP', d.spRegen !== undefined ? `+${d.spRegen}/${d.spRegenSeconds || 8}s` : '--')
  ].join('');

  // Other (matching Image 2)
  othEl.innerHTML = [
    row('ความเร็ว', d.moveSpeedPercent !== undefined ? `${d.moveSpeedPercent}%` : '100%'),
    row('ดับเบิ้ลแอทแทค', d.doubleAttackChance !== undefined ? `${d.doubleAttackChance}%` : '0%'),
    row('พลังฮีล', d.healPowerPercent !== undefined ? `+${d.healPowerPercent}%` : '+0%')
  ].join('');
}

function renderGearScanner(slotDef, data) {
  const iconEl = document.getElementById('scanner-slot-icon');
  const titleEl = document.getElementById('scanner-slot-title');
  const subEl = document.getElementById('scanner-slot-subtitle');
  if (iconEl) iconEl.innerText = slotDef.icon;
  if (titleEl) titleEl.innerText = `จัดการอุปกรณ์: ${slotDef.label}`;
  if (subEl) subEl.innerText = `ช่องสวมใส่: ${slotDef.key}`;

  // Current Equipped Item
  const equipped = data.equipment?.[slotDef.key];
  const eqBox = document.getElementById('scanner-equipped-box');
  if (eqBox) {
    if (equipped && equipped.name) {
      eqBox.innerHTML = `
        <div class="equipped-item-top">
          <img src="${escapeHTML(gameAssetUrl(equipped.icon))}" class="gear-cand-icon" alt="" onerror="this.style.opacity=0.3">
          <div style="flex: 1; overflow: hidden;">
            <div class="equipped-item-name" style="color: ${getRarityColor(equipped.rarity)};">${escapeHTML(formatItemDisplayName(equipped))}</div>
            <div style="font-size: 10px; color: #94a3b8;">Req Lv.${equipped.levelReq || 0} | นน. ${equipped.weight || 0} ${equipped.qty > 1 ? `| x${equipped.qty.toLocaleString()}` : ''}</div>
          </div>
          <button type="button" class="btn-unequip-slot" onclick="handleUnequip('${slotDef.key}')">❌ ถอด</button>
        </div>
        ${renderItemAffixesHtml(equipped)}
      `;
    } else {
      eqBox.innerHTML = `
        <div style="font-size: 11px; color: #94a3b8; text-align: center; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 6px;">
          ยังไม่มีไอเทมสวมใส่ในช่องนี้
        </div>
      `;
    }
  }

  // Compatible Bag Items (optionally filtered by random options)
  const bagItems = data.bagItems || [];
  const candidates = bagItems.filter(item => isItemMatchingSlot(item, slotDef, data.classId));
  if (gearOptFilter.slotKey !== slotDef.key) {
    gearOptFilter = { slotKey: slotDef.key, text: '', mode: gearOptFilter.mode };
  }
  renderGearOptFilterBar(candidates);
  const shown = applyGearOptFilter(candidates);
  const countEl = document.getElementById('scanner-bag-count');
  if (countEl) countEl.innerText = gearOptFilter.text.trim() ? `${shown.length}/${candidates.length}` : candidates.length;

  const bagListEl = document.getElementById('scanner-bag-list');
  if (bagListEl) {
    if (candidates.length === 0) {
      bagListEl.innerHTML = `
        <div style="text-align: center; color: #64748b; font-size: 11px; padding: 24px; background: rgba(0,0,0,0.15); border-radius: 6px;">
          🎒 ไม่พบไอเทมในกระเป๋าที่สวมใส่ช่อง "${slotDef.label}" ได้
        </div>
      `;
    } else if (shown.length === 0) {
      bagListEl.innerHTML = `
        <div style="text-align: center; color: #64748b; font-size: 11px; padding: 24px; background: rgba(0,0,0,0.15); border-radius: 6px;">
          🔍 ไม่มีไอเทมที่มีออฟชั่นตามที่เลือก
        </div>
      `;
    } else {
      bagListEl.innerHTML = shown.map(item => {
        const displayName = formatItemDisplayName(item);
        const rarityCol = getRarityColor(item.rarity);
        const btnText = equipped ? '🔄 สลับใส่' : '⚡ สวมใส่';
        return `
          <div class="gear-cand-card">
            <div class="gear-cand-top">
              <img src="${escapeHTML(gameAssetUrl(item.icon))}" class="gear-cand-icon" alt="" onerror="this.style.opacity=0.3">
              <div class="gear-cand-info">
                <div class="gear-cand-name" style="color: ${rarityCol};">${escapeHTML(displayName)}</div>
                <div class="gear-cand-meta">Req Lv.${item.levelReq || 0} ${item.qty > 1 ? `| x${item.qty}` : ''} | ช่องกระเป๋า: ${item.slot}</div>
              </div>
              <button type="button" class="btn-equip-action" onclick="handleEquip(${item.slot}, '${slotDef.key}')">
                ${btnText}
              </button>
            </div>
            ${renderItemAffixSummary(item, getGearOptHighlight())}
          </div>
        `;
      }).join('');
    }
  }
}

function renderCharacterModal(data) {
  if (!data) return;
  
  // Header
  const faceImg = document.getElementById('char-modal-face');
  if (faceImg) {
    faceImg.src = data.faceAvatar || `https://www.aetheria-online.in.th/art/classes/${data.classId || 'hunter'}-face.webp`;
    faceImg.onerror = () => { faceImg.src = 'https://www.aetheria-online.in.th/art/classes/hunter-face.webp'; };
  }
  const baseBadge = document.getElementById('char-modal-base-badge');
  if (baseBadge) baseBadge.innerText = data.baseLevel || '--';

  const nameEl = document.getElementById('char-modal-name');
  if (nameEl) nameEl.innerText = data.charName || data.profileName || 'Character';

  const jobPill = document.getElementById('char-modal-job-pill');
  if (jobPill) jobPill.innerText = `${data.className || 'Novice'} (Base ${data.baseLevel || 1} / Job ${data.jobLevel || 1})`;

  const profPill = document.getElementById('char-modal-profile-pill');
  if (profPill) profPill.innerText = data.profileName || 'Profile';

  // Base & Job Exp
  const baseLvEl = document.getElementById('char-modal-baselv');
  if (baseLvEl) baseLvEl.innerText = data.baseLevel || 1;
  const baseExpPct = (data.baseExpNext && data.baseExpNext > 0) ? Math.min(100, (data.baseExp / data.baseExpNext) * 100).toFixed(1) : '0.0';
  const baseBar = document.getElementById('char-modal-base-bar');
  if (baseBar) baseBar.style.width = `${baseExpPct}%`;
  const basePctEl = document.getElementById('char-modal-base-pct');
  if (basePctEl) basePctEl.innerText = `${baseExpPct}%`;

  const jobLvEl = document.getElementById('char-modal-joblv');
  if (jobLvEl) jobLvEl.innerText = data.jobLevel || 1;
  const isJobMax = (data.jobLevel || 1) >= (data.jobMaxLevel || 50);
  const jobExpPct = isJobMax ? '100' : ((data.jobExpNext && data.jobExpNext > 0) ? Math.min(100, (data.jobExp / data.jobExpNext) * 100).toFixed(1) : '0.0');
  const jobBar = document.getElementById('char-modal-job-bar');
  if (jobBar) jobBar.style.width = isJobMax ? '100%' : `${jobExpPct}%`;
  const jobPctEl = document.getElementById('char-modal-job-pct');
  if (jobPctEl) jobPctEl.innerText = isJobMax ? 'MAX' : `${jobExpPct}%`;

  // HP / SP
  const hpCur = data.hp ?? 0;
  const hpMax = data.hpMax || hpCur || 1;
  const hpPct = Math.min(100, Math.round((hpCur / hpMax) * 100));
  const hpBarEl = document.getElementById('char-modal-hp-bar');
  if (hpBarEl) hpBarEl.style.width = `${hpPct}%`;
  const hpValEl = document.getElementById('char-modal-hp-val');
  if (hpValEl) hpValEl.innerText = `${hpCur.toLocaleString()} / ${hpMax.toLocaleString()}`;

  const spCur = data.sp ?? 0;
  const spMax = data.spMax || spCur || 1;
  const spPct = Math.min(100, Math.round((spCur / spMax) * 100));
  const spBarEl = document.getElementById('char-modal-sp-bar');
  if (spBarEl) spBarEl.style.width = `${spPct}%`;
  const spValEl = document.getElementById('char-modal-sp-val');
  if (spValEl) spValEl.innerText = `${spCur.toLocaleString()} / ${spMax.toLocaleString()}`;

  // ส่วนบุญ & Zeny
  const ptsVal = document.getElementById('char-modal-pts-val');
  if (ptsVal) ptsVal.innerText = (data.statusPoints || 0).toLocaleString();
  const zenyVal = document.getElementById('char-modal-zeny-val');
  if (zenyVal) zenyVal.innerText = `${(data.zeny || 0).toLocaleString()} z`;

  // Full Art
  const fullArt = document.getElementById('char-modal-full-art');
  if (fullArt) {
    fullArt.src = data.fullPortrait || `https://www.aetheria-online.in.th/art/classes/${data.classId || 'hunter'}.webp`;
    fullArt.onerror = () => { fullArt.src = 'https://www.aetheria-online.in.th/art/classes/hunter.webp'; };
  }

  // Subtabs state
  document.querySelectorAll('.char-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.charTab === currentCharTab);
  });
  const gemCount = Object.keys(data.equipment || {}).filter(k => k.startsWith('gem-') && data.equipment[k]).length;
  const gemCountEl = document.getElementById('char-modal-gem-count');
  if (gemCountEl) gemCountEl.innerText = `(${gemCount})`;

  // Render Slots based on active subtab
  if (currentCharTab === 'gem') {
    renderSlotColumn('char-slots-left', CHAR_GEM_SLOTS.slice(0, 2), data.equipment);
    renderSlotColumn('char-slots-right', CHAR_GEM_SLOTS.slice(2, 4), data.equipment);
  } else if (currentCharTab === 'costume') {
    renderSlotColumn('char-slots-left', CHAR_COSTUME_SLOTS.slice(0, 2), data.equipment);
    renderSlotColumn('char-slots-right', CHAR_COSTUME_SLOTS.slice(2, 4), data.equipment);
  } else {
    // Normal equipment tab
    renderSlotColumn('char-slots-left', CHAR_EQUIP_SLOTS_LEFT, data.equipment);
    renderSlotColumn('char-slots-right', CHAR_EQUIP_SLOTS_RIGHT, data.equipment);
  }

  // Center Ammo & Stat Alloc
  renderAmmoSlot(data.equipment?.ammo);
  renderStatAllocBar(data);

  // Side Panel
  if (selectedSlotDef) {
    renderGearScanner(selectedSlotDef, data);
  } else {
    const statsView = document.getElementById('char-stats-view');
    const scanView = document.getElementById('char-scanner-view');
    if (scanView) scanView.style.display = 'none';
    if (statsView) statsView.style.display = 'flex';
    renderCombatStats(data.derived, data);
  }
}

async function handleEquip(bagSlot, targetSlotKey) {
  if (!currentCharProfileId) return;
  try {
    const res = await fetch(`/api/profiles/${encodeURIComponent(currentCharProfileId)}/equip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bagSlot, targetSlot: targetSlotKey })
    });
    const result = await res.json();
    if (!result.success) {
      alert(`ไม่สามารถสวมใส่อุปกรณ์ได้: ${result.error || 'Server error'}`);
      return;
    }
    setTimeout(() => {
      loadCharacterDetail(currentCharProfileId, true);
    }, 300);
  } catch (err) {
    console.error('[CharModal] Equip error:', err);
    alert('เกิดข้อผิดพลาดในการสวมใส่อุปกรณ์: ' + err.message);
  }
}

async function handleUnequip(slotKey) {
  if (!currentCharProfileId) return;
  try {
    const res = await fetch(`/api/profiles/${encodeURIComponent(currentCharProfileId)}/unequip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: slotKey })
    });
    const result = await res.json();
    if (!result.success) {
      alert(`ไม่สามารถถอดอุปกรณ์ได้: ${result.error || 'Server error'}`);
      return;
    }
    setTimeout(() => {
      loadCharacterDetail(currentCharProfileId, true);
    }, 300);
  } catch (err) {
    console.error('[CharModal] Unequip error:', err);
    alert('เกิดข้อผิดพลาดในการถอดอุปกรณ์: ' + err.message);
  }
}

async function handleStatUp(statKey, count = 1) {
  if (!currentCharProfileId) return;
  try {
    const res = await fetch(`/api/profiles/${encodeURIComponent(currentCharProfileId)}/stat-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stat: statKey, count })
    });
    const result = await res.json();
    if (!result.success) {
      alert(`ไม่สามารถอัปสเตตัสได้: ${result.error || 'Server error'}`);
      return;
    }
    setTimeout(() => {
      loadCharacterDetail(currentCharProfileId, false);
    }, 250);
  } catch (err) {
    console.error('[CharModal] Stat-up error:', err);
    alert('เกิดข้อผิดพลาดในการอัปค่าสถานะ: ' + err.message);
  }
}

function initCharacterModalEvents() {
  const modal = document.getElementById('char-detail-modal');
  if (!modal) return;
  
  const closeBtn = document.getElementById('char-modal-close');
  if (closeBtn) closeBtn.onclick = closeCharacterModal;
  
  modal.onclick = (e) => {
    if (e.target === modal) closeCharacterModal();
  };
  
  const btnCloseScanner = document.getElementById('btn-close-scanner');
  if (btnCloseScanner) {
    btnCloseScanner.onclick = () => {
      selectedSlotDef = null;
      document.querySelectorAll('.char-slot-btn, .char-ammo-btn').forEach(btn => btn.classList.remove('active-selected'));
      const scanView = document.getElementById('char-scanner-view');
      const statsView = document.getElementById('char-stats-view');
      if (scanView) scanView.style.display = 'none';
      if (statsView) statsView.style.display = 'flex';
    };
  }

  // Subtabs switching
  document.querySelectorAll('.char-tab-btn').forEach(btn => {
    btn.onclick = () => {
      currentCharTab = btn.dataset.charTab;
      selectedSlotDef = null;
      const scanView = document.getElementById('char-scanner-view');
      const statsView = document.getElementById('char-stats-view');
      if (scanView) scanView.style.display = 'none';
      if (statsView) statsView.style.display = 'flex';
      if (currentCharData) renderCharacterModal(currentCharData);
    };
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display !== 'none') {
      closeCharacterModal();
    }
  });
}


