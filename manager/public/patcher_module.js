// manager/public/patcher_module.js — Game Patcher, Script Installer & Auto-Updater Client Logic
(function() {
  'use strict';

  function initGamePatcher() {
    const btnOpen = document.getElementById('btn-game-patcher');
    const modal = document.getElementById('modal-game-patcher');
    const btnClose = document.getElementById('btn-patcher-close');
    const btnCancel = document.getElementById('btn-patcher-cancel');
    const pathInput = document.getElementById('game-patcher-path-input');
    const btnAutoDetect = document.getElementById('btn-patcher-autodetect');
    const btnBrowse = document.getElementById('btn-patcher-browse');
    const btnCheck = document.getElementById('btn-patcher-check');
    const btnInstall = document.getElementById('btn-patcher-install');
    const btnRestore = document.getElementById('btn-patcher-restore');
    const badge = document.getElementById('game-patcher-status-badge');
    const msgBox = document.getElementById('patcher-msg-box');

    const cardGameStatus = document.getElementById('patcher-card-game-status');
    const cardLoaderStatus = document.getElementById('patcher-card-loader-status');
    const cardBotStatus = document.getElementById('patcher-card-bot-status');
    const cardBackupStatus = document.getElementById('patcher-card-backup-status');

    const ghCommit = document.getElementById('patcher-github-commit');
    const ghDate = document.getElementById('patcher-github-date');

    if (!btnOpen || !modal) return;

    let defaultGamePath = '';

    function showMsg(text, isError = false) {
      if (!msgBox) return;
      msgBox.style.display = 'block';
      msgBox.style.background = isError ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)';
      msgBox.style.borderColor = isError ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)';
      msgBox.style.color = isError ? '#f87171' : '#34d399';
      msgBox.innerHTML = (isError ? '⚠️ ' : '✅ ') + text;
    }

    async function fetchStatus(overridePath = '') {
      try {
        const url = overridePath ? `/api/game-install/status?path=${encodeURIComponent(overridePath)}` : '/api/game-install/status';
        const res = await fetch(url);
        const data = await res.json();

        if (!data || !data.success) {
          showMsg('ไม่สามารถอ่านสถานะตัวเกมได้: ' + (data.error || 'Unknown error'), true);
          return;
        }

        defaultGamePath = data.defaultPath || '';
        if (pathInput && (!pathInput.value || !overridePath)) {
          pathInput.value = data.gamePath || defaultGamePath;
        }

        // 1. Game folder status
        if (cardGameStatus) {
          if (data.isValidFolder) {
            cardGameStatus.innerText = '✅ พบโฟลเดอร์ตัวเกม';
            cardGameStatus.style.color = '#34d399';
          } else {
            cardGameStatus.innerText = '❌ ไม่พบตัวเกมในโฟลเดอร์นี้';
            cardGameStatus.style.color = '#f87171';
          }
        }

        // 2. Loader status
        if (cardLoaderStatus) {
          if (data.isInstalled && data.asarActive) {
            cardLoaderStatus.innerText = '⚠️ เกมยังใช้ app.asar เดิม (บอทจะไม่ทำงาน) — กดติดตั้งอีกครั้ง';
            cardLoaderStatus.style.color = '#f87171';
          } else if (data.isInstalled && data.loaderUpToDate === false) {
            cardLoaderStatus.innerText = '⚡ มี Loader ใหม่ — กดติดตั้งแล้วปิด-เปิดจอเกมใหม่';
            cardLoaderStatus.style.color = '#fbbf24';
          } else if (data.isInstalled) {
            cardLoaderStatus.innerText = `✅ ติดตั้งแล้ว (v${data.loaderVersion || '1.0.2'})`;
            cardLoaderStatus.style.color = '#34d399';
          } else {
            cardLoaderStatus.innerText = '⚠️ ยังไม่ได้ติดตั้ง Loader';
            cardLoaderStatus.style.color = '#fbbf24';
          }
        }

        // 3. Bot script status
        if (cardBotStatus) {
          if (data.isInstalled && data.isUpToDate) {
            cardBotStatus.innerText = '✅ เวอร์ชันล่าสุด (Up-to-date)';
            cardBotStatus.style.color = '#34d399';
          } else if (data.isInstalled && !data.isUpToDate) {
            cardBotStatus.innerText = '⚡ ตรวจพบอัปเดตใหม่!';
            cardBotStatus.style.color = '#fbbf24';
          } else {
            cardBotStatus.innerText = '❌ ยังไม่ได้ติดตั้ง bot.js';
            cardBotStatus.style.color = '#f87171';
          }
        }

        // 4. Backup status
        if (cardBackupStatus) {
          if (data.hasBackup) {
            cardBackupStatus.innerText = '🛡️ มีไฟล์สำรองพร้อมกู้คืน';
            cardBackupStatus.style.color = '#34d399';
          } else {
            cardBackupStatus.innerText = 'ยังไม่มีไฟล์สำรอง';
            cardBackupStatus.style.color = '#94a3b8';
          }
        }

        // Update header badge
        if (badge) {
          if (data.isInstalled && data.isUpToDate) {
            badge.innerText = '✅ ติดตั้งแล้ว';
            badge.style.background = '#10b981';
          } else if (data.isInstalled && !data.isUpToDate) {
            badge.innerText = '⚡ มีอัปเดต';
            badge.style.background = '#f59e0b';
          } else {
            badge.innerText = '⚠️ ยังไม่ติดตั้ง';
            badge.style.background = '#ef4444';
          }
        }

      } catch (e) {
        console.error('[Patcher] Failed to fetch status:', e);
      }
    }

    async function checkGitHub() {
      try {
        const res = await fetch('/api/game-install/manager-update');
        const data = await res.json();
        if (data && data.success) {
          if (ghCommit) ghCommit.innerText = `Commit: ${data.latestCommit}`;
          if (ghDate) ghDate.innerText = `${new Date(data.commitDate).toLocaleString('th-TH')}`;
        } else {
          if (ghCommit) ghCommit.innerText = 'เชื่อมต่อ GitHub ปกติ';
        }
      } catch (e) {
        if (ghCommit) ghCommit.innerText = 'ออฟไลน์';
      }
    }

    // Launch mode (Electron app / browser windows)
    async function loadLaunchMode() {
      try {
        const r = await fetch('/api/launch-mode').then(x => x.json());
        if (!r.success) return;
        document.querySelectorAll('input[name="launch-mode"]').forEach(el => { el.checked = el.value === r.launchMode; });
        const kind = document.getElementById('lm-browser-kind');
        if (kind) kind.value = r.browserKind;
        const p = document.getElementById('lm-browser-path');
        if (p) p.textContent = r.browserPath ? '✅ ' + r.browserPath : '⚠️ ไม่พบเบราว์เซอร์ในเครื่อง';
        const row = document.getElementById('lm-browser-row');
        if (row) row.style.display = r.launchMode === 'browser' ? '' : 'none';
      } catch (e) {}
    }
    async function saveLaunchMode(patch) {
      await fetch('/api/launch-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).catch(() => {});
      loadLaunchMode();
      showMsg(patch.launchMode === 'browser' ? 'ตั้งเป็นโหมดเบราว์เซอร์แล้ว — ปิดจอเดิมแล้วกดเปิดใหม่' : patch.launchMode === 'electron' ? 'ตั้งเป็นโหมดแอปเกม (Electron) แล้ว' : 'บันทึกแล้ว');
    }
    document.querySelectorAll('input[name="launch-mode"]').forEach(el => el.addEventListener('change', () => { if (el.checked) saveLaunchMode({ launchMode: el.value }); }));
    const lmKind = document.getElementById('lm-browser-kind');
    if (lmKind) lmKind.addEventListener('change', () => saveLaunchMode({ browserKind: lmKind.value }));

    // Event Listeners
    btnOpen.addEventListener('click', () => {
      modal.style.display = 'flex';
      loadLaunchMode();
      fetchStatus(pathInput.value);
      checkGitHub();
      loadHumanCheckSettings();
      loadDiscordTownSettings();
    });

    const closeModal = () => { modal.style.display = 'none'; };
    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCancel) btnCancel.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    if (btnAutoDetect) {
      btnAutoDetect.addEventListener('click', () => {
        if (defaultGamePath) {
          pathInput.value = defaultGamePath;
          fetchStatus(defaultGamePath);
          showMsg(`ตรวจพบโฟลเดอร์เกม: ${defaultGamePath}`);
        }
      });
    }

    if (btnBrowse) {
      btnBrowse.addEventListener('click', async () => {
        try {
          btnBrowse.innerText = '⏳ กำลังเลือก...';
          const res = await fetch('/api/game-install/browse', { method: 'POST' });
          const data = await res.json();
          btnBrowse.innerText = '📂 Browse...';
          if (data && data.success && data.path) {
            pathInput.value = data.path;
            fetchStatus(data.path);
            showMsg(`เลือกโฟลเดอร์: ${data.path}`);
          }
        } catch (e) {
          btnBrowse.innerText = '📂 Browse...';
          alert('เกิดข้อผิดพลาดในการเปิด File Dialog: ' + e.message);
        }
      });
    }

    if (btnCheck) {
      btnCheck.addEventListener('click', () => {
        fetchStatus(pathInput.value);
      });
    }

    if (btnInstall) {
      btnInstall.addEventListener('click', async () => {
        const targetPath = (pathInput ? pathInput.value : '').trim();
        if (!targetPath) {
          alert('กรุณาระบุโฟลเดอร์ตัวเกมก่อนกดติดตั้ง');
          return;
        }

        try {
          btnInstall.disabled = true;
          btnInstall.innerText = '⏳ กำลังติดตั้งและอัปเดตสคริปต์...';

          const res = await fetch('/api/game-install/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gamePath: targetPath })
          });
          const data = await res.json();

          btnInstall.disabled = false;
          btnInstall.innerText = '🚀 ติดตั้ง / อัปเดตสคริปต์ลงตัวเกมทันที';

          if (data && data.success) {
            showMsg('🎉 ติดตั้งสคริปต์ PmheeAether ลงในตัวเกมเรียบร้อยแล้ว! จอเกมที่เปิดอยู่ให้ปิดแล้วเปิดใหม่ 1 ครั้งเพื่อใช้ตัวโหลดใหม่');
            fetchStatus(targetPath);
          } else {
            showMsg('❌ ติดตั้งไม่สำเร็จ: ' + (data.error || 'Unknown error'), true);
          }
        } catch (e) {
          btnInstall.disabled = false;
          btnInstall.innerText = '🚀 ติดตั้ง / อัปเดตสคริปต์ลงตัวเกมทันที';
          showMsg('❌ เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์: ' + e.message, true);
        }
      });
    }

    if (btnRestore) {
      btnRestore.addEventListener('click', async () => {
        const confirmRestore = confirm('คุณแน่ใจหรือไม่ว่าต้องการกู้คืนไฟล์เกมดั้งเดิม (ลบตัวโหลด PmheeAether และกู้คืน app.asar)?');
        if (!confirmRestore) return;

        const targetPath = (pathInput ? pathInput.value : '').trim();
        try {
          btnRestore.disabled = true;
          btnRestore.innerText = '⏳ กำลังกู้คืน...';

          const res = await fetch('/api/game-install/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gamePath: targetPath })
          });
          const data = await res.json();

          btnRestore.disabled = false;
          btnRestore.innerText = '🔄 กู้คืนไฟล์เกมเดิม (Restore)';

          if (data && data.success) {
            showMsg('กู้คืนไฟล์เกมเดิมเรียบร้อยแล้ว');
            fetchStatus(targetPath);
          } else {
            showMsg('❌ กู้คืนไม่สำเร็จ: ' + (data.error || 'Unknown error'), true);
          }
        } catch (e) {
          btnRestore.disabled = false;
          btnRestore.innerText = '🔄 กู้คืนไฟล์เกมเดิม (Restore)';
          showMsg('❌ เกิดข้อผิดพลาด: ' + e.message, true);
        }
      });
    }

    // Human Check & Point System Settings Handlers
    const hcGlobalAutoAnswer = document.getElementById('hc-global-auto-answer');
    const hcGlobalAnswerDelay = document.getElementById('hc-global-answer-delay');
    const hcPointSystemToggle = document.getElementById('hc-point-system-toggle');
    const hcPointsVal = document.getElementById('hc-points-val');
    const hcPointsPerSolve = document.getElementById('hc-points-per-solve');
    const btnHcSave = document.getElementById('btn-hc-save');
    const hcStatusMsg = document.getElementById('hc-status-msg');

    function showHcMsg(text, isError = false) {
      if (!hcStatusMsg) return;
      hcStatusMsg.style.display = 'block';
      hcStatusMsg.style.background = isError ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)';
      hcStatusMsg.style.color = isError ? '#f87171' : '#34d399';
      hcStatusMsg.style.border = isError ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)';
      hcStatusMsg.innerText = text;
      setTimeout(() => {
        if (hcStatusMsg) hcStatusMsg.style.display = 'none';
      }, 5000);
    }

    async function loadHumanCheckSettings() {
      try {
        const res = await fetch('/api/human-check/settings').then(r => r.json());
        if (res && res.success && res.settings) {
          const s = res.settings;
          if (hcGlobalAutoAnswer) hcGlobalAutoAnswer.checked = s.autoAnswer !== false;
          if (hcGlobalAnswerDelay) hcGlobalAnswerDelay.value = s.answerDelayMs || 1800;
          if (hcPointSystemToggle) { hcPointSystemToggle.checked = true; hcPointSystemToggle.disabled = true; }
          if (hcPointsVal) hcPointsVal.innerText = s.points || 0;
          if (hcPointsPerSolve) { hcPointsPerSolve.value = s.pointsPerSolve ?? 1; hcPointsPerSolve.disabled = true; }
          if (typeof window.updateAutoAnswerToolbarBtn === 'function') {
            window.updateAutoAnswerToolbarBtn(s.autoAnswer !== false);
          }
          if (typeof window.updatePointDisplays === 'function') {
            window.updatePointDisplays(s.points, s.pointsPerSolve, s.serviceAvailable);
          }
        }
      } catch (e) {
        console.error('[HumanCheck] Failed to load settings:', e);
      }
    }
    window.loadHumanCheckSettings = loadHumanCheckSettings;

    if (btnHcSave) {
      btnHcSave.addEventListener('click', async () => {
        btnHcSave.disabled = true;
        btnHcSave.innerText = '⏳ กำลังบันทึก...';
        try {
          const payload = {
            autoAnswer: hcGlobalAutoAnswer ? hcGlobalAutoAnswer.checked : true,
            answerDelayMs: hcGlobalAnswerDelay ? Math.max(800, parseInt(hcGlobalAnswerDelay.value, 10) || 1800) : 1800,
            pointSystemEnabled: true
          };
          const res = await fetch('/api/human-check/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }).then(r => r.json());

          if (res && res.success) {
            showHcMsg('✅ บันทึกการตั้งค่าตอบคำถามเรียบร้อยแล้ว');
            if (typeof window.updateAutoAnswerToolbarBtn === 'function') {
              window.updateAutoAnswerToolbarBtn(payload.autoAnswer);
            }
            if (discordAutoAnswer) discordAutoAnswer.checked = payload.autoAnswer;
          } else {
            showHcMsg('❌ บันทึกไม่สำเร็จ: ' + (res.error || 'Unknown error'), true);
          }
        } catch (e) {
          showHcMsg('❌ เกิดข้อผิดพลาด: ' + e.message, true);
        } finally {
          btnHcSave.disabled = false;
          btnHcSave.innerText = '💾 บันทึกตั้งค่าตอบคำถาม';
        }
      });
    }

    // Quick point top-up buttons
    document.querySelectorAll('.btn-quick-point').forEach(b => {
      b.addEventListener('click', async () => {
        const amount = parseInt(b.dataset.amount, 10);
        if (!amount) return;
        b.disabled = true;
        try {
          const res = await fetch('/api/human-check/add-points', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount })
          }).then(r => r.json());
          if (res && res.success) {
            if (hcPointsVal) hcPointsVal.innerText = res.points;
            if (typeof window.updatePointDisplays === 'function') {
              window.updatePointDisplays(res.points);
            }
            showHcMsg(`⚡ เติม Point สำเร็จ: +${amount} P (รวมคงเหลือ ${res.points} P)`);
          } else {
            showHcMsg('❌ เติม Point ไม่สำเร็จ: ' + (res.error || 'Unknown error'), true);
          }
        } catch (e) {
          showHcMsg('❌ เกิดข้อผิดพลาด: ' + e.message, true);
        } finally {
          b.disabled = false;
        }
      });
    });

    // Dedicated Discord Webhook for Unexpected Town Return
    const townWebhookInput = document.getElementById('discord-town-webhook-input');
    const btnSaveTownWebhook = document.getElementById('btn-save-town-webhook');
    const btnTestTownWebhook = document.getElementById('btn-test-town-webhook');
    const townWebhookStatusMsg = document.getElementById('town-webhook-status-msg');

    function showTownWebhookMsg(text, isError = false) {
      if (!townWebhookStatusMsg) return;
      townWebhookStatusMsg.style.display = 'inline-block';
      townWebhookStatusMsg.style.background = isError ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)';
      townWebhookStatusMsg.style.color = isError ? '#f87171' : '#34d399';
      townWebhookStatusMsg.style.border = isError ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(16, 185, 129, 0.4)';
      townWebhookStatusMsg.innerText = text;
      setTimeout(() => {
        if (townWebhookStatusMsg) townWebhookStatusMsg.style.display = 'none';
      }, 5000);
    }

    async function loadDiscordTownSettings() {
      try {
        const res = await fetch('/api/discord/settings').then(r => r.json());
        if (res && res.success && res.settings && townWebhookInput) {
          townWebhookInput.value = res.settings.townWebhookUrl || '';
        }
      } catch (e) {
        console.warn('[Patcher] Failed to load discord town settings:', e);
      }
    }
    window.loadDiscordTownSettings = loadDiscordTownSettings;

    if (btnSaveTownWebhook) {
      btnSaveTownWebhook.addEventListener('click', async () => {
        btnSaveTownWebhook.disabled = true;
        btnSaveTownWebhook.innerText = '⏳ กำลังบันทึก...';
        try {
          const url = (townWebhookInput ? townWebhookInput.value : '').trim();
          const res = await fetch('/api/discord/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ townWebhookUrl: url })
          }).then(r => r.json());
          if (res && res.success) {
            showTownWebhookMsg(url ? '✅ บันทึก Webhook แจ้งเตือนกลับเมืองแล้ว' : '✅ บันทึกแล้ว (ใช้ Webhook/Bot หลัก)');
          } else {
            showTownWebhookMsg('❌ บันทึกไม่สำเร็จ: ' + (res.error || 'Server error'), true);
          }
        } catch (e) {
          showTownWebhookMsg('❌ เกิดข้อผิดพลาด: ' + e.message, true);
        } finally {
          btnSaveTownWebhook.disabled = false;
          btnSaveTownWebhook.innerText = '💾 บันทึก Webhook';
        }
      });
    }

    if (btnTestTownWebhook) {
      btnTestTownWebhook.addEventListener('click', async () => {
        btnTestTownWebhook.disabled = true;
        btnTestTownWebhook.innerText = '⏳ กำลังทดสอบ...';
        try {
          const url = (townWebhookInput ? townWebhookInput.value : '').trim();
          const res = await fetch('/api/discord/test-town', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ webhookUrl: url })
          }).then(r => r.json());
          if (res && res.success) {
            showTownWebhookMsg('🎉 ส่งข้อความทดสอบเข้า Discord สำเร็จแล้ว!');
          } else {
            showTownWebhookMsg('❌ ส่งไม่สำเร็จ: ' + (res.error || res.status || 'ตรวจสอบ URL อีกครั้ง'), true);
          }
        } catch (e) {
          showTownWebhookMsg('❌ ข้อผิดพลาด: ' + e.message, true);
        } finally {
          btnTestTownWebhook.disabled = false;
          btnTestTownWebhook.innerText = '🔔 ทดสอบส่ง';
        }
      });
    }

    loadHumanCheckSettings();
    loadDiscordTownSettings();

    // Initial background check
    fetchStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGamePatcher);
  } else {
    initGamePatcher();
  }
})();
