// manager/public/update_log.js — Update Log Notification & History Modal for Manager UI
// กฎเหล็ก: เขียนเฉพาะว่า "ทำอะไรได้บ้าง" และ "แก้อะไรบ้าง" ด้วยภาษาผู้ใช้ที่เข้าใจง่าย ห้ามใส่รายละเอียดโค้ดหรือชื่อฟังก์ชันเด็ดขาด
(function () {
  'use strict';

  const STORAGE_KEY_SEEN_VER = 'pelican_seen_update_log_ver';

  const UPDATE_LOGS = [
    {
      version: 'v4.44.7',
      date: '21 ต.ค. 2026',
      title: 'ปลดล็อคขายตลาดกลางไม่ต้องมี Premium & ขายของใช้ให้ NPC',
      features: [
        'ปลดล็อคขายของลงตลาดกลางอัตโนมัติ แม้ไม่มี Premium ก็ตั้งขายได้แล้ว (ไม่มี Premium ลงขายได้สูงสุด 3 ชิ้น / มี Premium ลงขายได้ 20 ชิ้น)',
        'เพิ่มตัวเลือกขายของใช้และขวดยาให้ NPC อัตโนมัติ (ในแท็บขายของ) โดยจะเก็บใบวาป ยาบัพที่เปิดใช้งาน และของใน Whitelist ไว้ให้ปลอดภัย',
        'เพิ่มระบบแจ้งเตือน Update Log หน้า Manager เพื่อดูว่าแต่ละอัปเดตทำอะไรได้บ้างและแก้อะไรบ้าง'
      ],
      fixes: [
        'ปรับการแสดงจำนวนโควตาตั้งขายตลาดกลางให้ตรงตามสิทธิ์ของตัวละครจริง'
      ]
    },
    {
      version: 'v4.44.6',
      date: '21 ต.ค. 2026',
      title: 'บันทึกตั้งค่ารายโปรไฟล์ & แก้บัคกลับเมืองไปหาช่างตีเหล็กเอง',
      features: [
        'จำการตั้งค่าบอทแยกตามโปรไฟล์อัตโนมัติ ปิด-เปิดจอใหม่แล้วการตั้งค่าไม่หาย'
      ],
      fixes: [
        'แก้ไขปัญหาปิดแล้วเปิดจอใหม่แล้วการตั้งค่าบอท (Config) ถูกรีเซ็ต',
        'แก้ไขปัญหาบอทเดินกลับเมืองไปคุยกับช่างตีเหล็กเองแล้วหยุดทำงานโดยไม่ทราบสาเหตุ'
      ]
    },
    {
      version: 'v4.44.5',
      date: '21 ต.ค. 2026',
      title: 'รองรับอัปเดตเกมล่าสุด & แก้กดปุ่มเริ่มบอทซ้ำตอนเดินข้ามแมพ',
      features: [
        'รองรับหน้าต่างร้านค้า คลังเก็บของ และเมนูในเกมเวอร์ชันใหม่ทั้งหมด'
      ],
      fixes: [
        'แก้ไขปัญหาบอทกดปุ่ม Auto เพื่อเริ่มบอทซ้ำๆ ระหว่างกำลังเดินไปแมพเป้าหมายจนค้างเข้าแมพไม่ได้',
        'แก้ไขปัญหาซื้อลูกธนู ซื้อยาบัพ และฝากของเข้าคลังไม่สำเร็จหลังตัวเกมอัปเดตใหม่'
      ]
    },
    {
      version: 'v4.44.4',
      date: '20 ต.ค. 2026',
      title: 'ระบบจำกัด 3 จอต่อ 1 เครื่องอัตโนมัติ & ป้องกันรหัสผ่านเพี้ยน',
      features: [
        'ระบบสุ่มและจำข้อมูลเครื่องอัตโนมัติ จำกัดไม่เกิน 3 จอต่อ 1 เครื่องตามเงื่อนไขใหม่ของเกม'
      ],
      fixes: [
        'แก้ไขปัญหาบางจอค้างหน้าข้อความกำลังโหลดสคริปต์เมื่อเปิดพร้อมกันหลายจอ',
        'แก้ไขปัญหาการบันทึกข้อมูลโปรไฟล์ทับรหัสผ่านเดิมของผู้ใช้งาน'
      ]
    }
  ];

  window.PMHEE_UPDATE_LOGS = UPDATE_LOGS;

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getLatestLog() {
    return UPDATE_LOGS[0] || null;
  }

  function isLatestSeen() {
    const latest = getLatestLog();
    if (!latest) return true;
    try {
      return localStorage.getItem(STORAGE_KEY_SEEN_VER) === latest.version;
    } catch (e) {
      return false;
    }
  }

  function markLatestSeen() {
    const latest = getLatestLog();
    if (!latest) return;
    try {
      localStorage.setItem(STORAGE_KEY_SEEN_VER, latest.version);
    } catch (e) {}
    updateHeaderBadge();
  }

  function injectStyles() {
    if (document.getElementById('pmhee-update-log-styles')) return;
    const style = document.createElement('style');
    style.id = 'pmhee-update-log-styles';
    style.textContent = `
      #btn-update-log {
        position: relative;
        background: linear-gradient(135deg, rgba(168, 85, 247, 0.22), rgba(59, 130, 246, 0.16));
        border: 1px solid rgba(192, 132, 252, 0.45);
        color: #e9d5ff;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: all 0.2s ease;
      }
      #btn-update-log:hover {
        background: linear-gradient(135deg, rgba(168, 85, 247, 0.35), rgba(59, 130, 246, 0.28));
        border-color: rgba(216, 180, 254, 0.75);
        transform: translateY(-1px);
      }
      .ulog-ver-pill {
        background: rgba(168, 85, 247, 0.28);
        color: #f3e8ff;
        border: 1px solid rgba(192, 132, 252, 0.45);
        padding: 1px 6px;
        border-radius: 999px;
        font-size: 10.5px;
        font-weight: 700;
      }
      .ulog-new-dot {
        background: #ef4444;
        color: #fff;
        font-size: 9.5px;
        font-weight: 800;
        padding: 1px 5px;
        border-radius: 999px;
        box-shadow: 0 0 10px rgba(239, 68, 68, 0.85);
        animation: ulogPulse 1.6s infinite ease-in-out;
      }
      @keyframes ulogPulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.08); opacity: 0.85; }
      }
      #pmhee-update-notify-card {
        position: fixed;
        right: 22px;
        bottom: 22px;
        width: 410px;
        max-width: calc(100vw - 32px);
        background: linear-gradient(145deg, #0f172a 0%, #1e1b4b 100%);
        border: 1.5px solid rgba(192, 132, 252, 0.55);
        border-radius: 14px;
        box-shadow: 0 22px 55px rgba(0, 0, 0, 0.88), 0 0 28px rgba(168, 85, 247, 0.28);
        color: #f8fafc;
        padding: 16px 18px;
        z-index: 99990;
        font-family: inherit;
        animation: ulogSlideIn 0.28s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes ulogSlideIn {
        from { opacity: 0; transform: translateY(18px) scale(0.97); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .ulog-section-box {
        background: rgba(15, 23, 42, 0.65);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 9px;
        padding: 9px 12px;
        margin-top: 8px;
      }
      .ulog-section-title {
        font-size: 11.5px;
        font-weight: 700;
        margin-bottom: 5px;
        display: flex;
        align-items: center;
        gap: 5px;
      }
      .ulog-list {
        margin: 0;
        padding-left: 17px;
        font-size: 11.5px;
        color: #e2e8f0;
        line-height: 1.5;
      }
      .ulog-list li {
        margin-bottom: 3px;
      }
      .ulog-history-card {
        background: rgba(15, 23, 42, 0.75);
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 11px;
        padding: 14px 16px;
      }
      .ulog-history-card.latest {
        border-color: rgba(192, 132, 252, 0.5);
        background: linear-gradient(145deg, rgba(88, 28, 135, 0.18), rgba(15, 23, 42, 0.9));
      }
    `;
    document.head.appendChild(style);
  }

  function updateHeaderBadge() {
    const dot = document.getElementById('update-log-unread-dot');
    if (!dot) return;
    dot.style.display = isLatestSeen() ? 'none' : 'inline-block';
  }

  function renderLogSectionsHtml(entry) {
    const features = Array.isArray(entry.features) ? entry.features : [];
    const fixes = Array.isArray(entry.fixes) ? entry.fixes : [];
    let html = '';
    if (features.length > 0) {
      html += `
        <div class="ulog-section-box" style="border-color: rgba(52, 211, 153, 0.28);">
          <div class="ulog-section-title" style="color: #34d399;">✨ ทำอะไรได้บ้าง</div>
          <ul class="ulog-list">
            ${features.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </div>
      `;
    }
    if (fixes.length > 0) {
      html += `
        <div class="ulog-section-box" style="border-color: rgba(56, 189, 248, 0.28);">
          <div class="ulog-section-title" style="color: #38bdf8;">🛠️ แก้อะไรบ้าง</div>
          <ul class="ulog-list">
            ${fixes.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </div>
      `;
    }
    return html;
  }

  function openUpdateLogModal() {
    markLatestSeen();
    dismissNotifyCard();
    let modal = document.getElementById('modal-update-log');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-update-log';
      modal.className = 'modal-overlay modal';
      modal.style.cssText = 'display: none; align-items: center; justify-content: center; position: fixed; inset: 0; background: rgba(2, 6, 23, 0.82); z-index: 99999; backdrop-filter: blur(5px);';
      modal.innerHTML = `
        <div class="modal-content" style="background: #0b1329; border: 1.5px solid rgba(192, 132, 252, 0.45); border-radius: 14px; width: 660px; max-width: 95vw; max-height: 88vh; display: flex; flex-direction: column; box-shadow: 0 25px 70px rgba(0, 0, 0, 0.95), 0 0 35px rgba(168, 85, 247, 0.22); color: #f8fafc; padding: 20px 22px; font-family: inherit;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 12px; margin-bottom: 14px; flex-shrink: 0;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 38px; height: 38px; border-radius: 10px; background: rgba(168, 85, 247, 0.2); border: 1px solid rgba(192, 132, 252, 0.45); display: flex; align-items: center; justify-content: center; font-size: 20px;">
                🔔
              </div>
              <div>
                <h3 style="margin: 0; font-size: 16.5px; font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 8px;">
                  <span>รายการอัปเดตระบบ (Update Log)</span>
                  <span style="font-size: 11px; background: rgba(168, 85, 247, 0.22); color: #e9d5ff; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(192, 132, 252, 0.4); font-weight: 600;">PmheeAether</span>
                </h3>
                <div style="font-size: 11.5px; color: #94a3b8; margin-top: 2px;">สรุปความสามารถใหม่และรายการแก้ไขบั๊กในแต่ละเวอร์ชัน</div>
              </div>
            </div>
            <button type="button" id="btn-update-log-close" style="background: transparent; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 0 4px; font-weight: bold;">✕</button>
          </div>

          <div id="update-log-history-list" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding-right: 4px;"></div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.08); flex-shrink: 0;">
            <span style="font-size: 11px; color: #94a3b8;">💡 มีการแจ้งเตือนอัตโนมัติทุกครั้งที่มีเวอร์ชันใหม่</span>
            <button type="button" id="btn-update-log-ok" class="btn btn-primary" style="font-size: 12px; padding: 6px 20px; background: #7c3aed; border-color: #a855f7; font-weight: 600;">รับทราบ / ปิดหน้าต่าง</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#btn-update-log-close').addEventListener('click', () => {
        modal.style.display = 'none';
      });
      modal.querySelector('#btn-update-log-ok').addEventListener('click', () => {
        modal.style.display = 'none';
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
      });
    }

    const listEl = modal.querySelector('#update-log-history-list');
    if (listEl) {
      listEl.innerHTML = UPDATE_LOGS.map((entry, idx) => `
        <div class="ulog-history-card ${idx === 0 ? 'latest' : ''}">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 4px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 13.5px; font-weight: 800; color: #e9d5ff; background: rgba(168, 85, 247, 0.25); border: 1px solid rgba(192, 132, 252, 0.45); padding: 2px 9px; border-radius: 999px;">${escapeHtml(entry.version)}</span>
              ${idx === 0 ? '<span style="font-size: 10.5px; font-weight: 700; background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(52, 211, 153, 0.4); padding: 1px 7px; border-radius: 999px;">เวอร์ชันล่าสุด</span>' : ''}
              <span style="font-size: 13px; font-weight: 700; color: #f8fafc;">${escapeHtml(entry.title || '')}</span>
            </div>
            <span style="font-size: 11px; color: #94a3b8;">📅 ${escapeHtml(entry.date || '')}</span>
          </div>
          ${renderLogSectionsHtml(entry)}
        </div>
      `).join('');
    }

    modal.style.display = 'flex';
  }

  function dismissNotifyCard() {
    const card = document.getElementById('pmhee-update-notify-card');
    if (card) card.remove();
  }

  function showNotifyCardIfNeeded() {
    const latest = getLatestLog();
    if (!latest || isLatestSeen()) return;
    if (document.getElementById('pmhee-update-notify-card')) return;

    const card = document.createElement('div');
    card.id = 'pmhee-update-notify-card';
    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 6px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 20px;">🎉</span>
          <div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 13.5px; font-weight: 800; color: #f8fafc;">อัปเดตใหม่ ${escapeHtml(latest.version)}</span>
              <span class="ulog-new-dot">NEW</span>
            </div>
            <div style="font-size: 11.5px; color: #d8b4fe; font-weight: 600; margin-top: 1px;">${escapeHtml(latest.title || '')}</div>
          </div>
        </div>
        <button type="button" id="btn-ulog-notify-dismiss" title="ปิดแจ้งเตือน" style="background: transparent; border: none; color: #94a3b8; font-size: 16px; cursor: pointer; padding: 0 4px;">✕</button>
      </div>

      ${renderLogSectionsHtml(latest)}

      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.08);">
        <button type="button" id="btn-ulog-notify-all" class="btn btn-secondary btn-sm" style="font-size: 11.5px; padding: 5px 11px;">📜 ดูประวัติทั้งหมด</button>
        <button type="button" id="btn-ulog-notify-ack" class="btn btn-primary btn-sm" style="font-size: 11.5px; padding: 5px 14px; background: #7c3aed; border-color: #a855f7; font-weight: 700;">✅ รับทราบ</button>
      </div>
    `;
    document.body.appendChild(card);

    card.querySelector('#btn-ulog-notify-dismiss').addEventListener('click', () => {
      markLatestSeen();
      dismissNotifyCard();
    });
    card.querySelector('#btn-ulog-notify-ack').addEventListener('click', () => {
      markLatestSeen();
      dismissNotifyCard();
    });
    card.querySelector('#btn-ulog-notify-all').addEventListener('click', () => {
      openUpdateLogModal();
    });
  }

  function initUpdateLogUI() {
    injectStyles();
    const latest = getLatestLog();
    if (!latest) return;

    const headerActions = document.querySelector('.header-actions');
    if (headerActions && !document.getElementById('btn-update-log')) {
      const btn = document.createElement('button');
      btn.id = 'btn-update-log';
      btn.className = 'btn';
      btn.title = 'ดูรายการอัปเดตระบบ (Update Log)';
      btn.innerHTML = `
        <span class="icon" style="font-size: 14px;">🔔</span>
        <span>Update Log</span>
        <span class="ulog-ver-pill">${escapeHtml(latest.version)}</span>
        <span id="update-log-unread-dot" class="ulog-new-dot" style="display: ${isLatestSeen() ? 'none' : 'inline-block'};">ใหม่!</span>
      `;
      btn.addEventListener('click', openUpdateLogModal);

      const refreshBtn = document.getElementById('btn-refresh');
      if (refreshBtn && refreshBtn.parentNode === headerActions) {
        headerActions.insertBefore(btn, refreshBtn);
      } else {
        headerActions.appendChild(btn);
      }
    }

    setTimeout(showNotifyCardIfNeeded, 600);
  }

  window.openUpdateLogModal = openUpdateLogModal;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUpdateLogUI);
  } else {
    initUpdateLogUI();
  }
})();
