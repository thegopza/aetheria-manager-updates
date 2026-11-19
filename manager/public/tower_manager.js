(() => {
  'use strict';
  if (typeof window === 'undefined') return;

  const POLL_INTERVAL_MS = 2500;

  const uiState = {
    isOpen: false,
    loading: false,
    scanningQuotas: false,
    loadingSkills: { damage: false, priest: false },
    roleSkillsCache: {
      damage: { profileId: '', charName: '', job: '', skills: [] },
      priest: { profileId: '', charName: '', job: '', skills: [] }
    },
    serverData: null,
    dirtySettings: false,
    localSettings: {
      damageProfileId: '',
      priestProfileId: '',
      targetFloor: 60,
      autoResetBeforeEnter: true,
      autoNextBatch: true,
      priestProfileMode: 'safe_anchor_12',
      kidMode: 'auto_until_boss',
      carryUseQuota: false,
      resumeFarmAfterFinish: true,
      damageSkills: [],
      priestSkills: ['resurrection', 'heal', 'blessing', 'increase-agi', 'kyrie-eleison', 'magnificat', 'gloria'],
      priestOutBuffSkills: ['blessing', 'increase-agi', 'impositio-manus', 'aspersio', 'kyrie-eleison'],
      selectedKidProfileIds: []
    },
    pollTimer: null
  };

  let dom = null;

  function injectStyles() {
    if (document.getElementById('tw-carry-styles')) return;
    const style = document.createElement('style');
    style.id = 'tw-carry-styles';
    style.textContent = `
      /* Bottom-Center Floating Launcher Tab */
      #tw-carry-launcher {
        position: fixed;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        z-index: 9945;
        display: inline-flex;
        align-items: center;
        gap: 9px;
        padding: 8px 18px 9px 16px;
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.97) 0%, rgba(9, 13, 24, 0.99) 100%);
        border: 1px solid rgba(250, 204, 21, 0.45);
        border-bottom: none;
        border-radius: 13px 13px 0 0;
        color: #fef08a;
        font-family: inherit;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.65), 0 0 18px rgba(234, 179, 8, 0.16);
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        user-select: none;
        white-space: nowrap;
      }
      #tw-carry-launcher:hover {
        border-color: rgba(250, 204, 21, 0.85);
        box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.8), 0 0 24px rgba(250, 204, 21, 0.28);
        padding-bottom: 11px;
      }
      #tw-carry-launcher.tw-running {
        border-color: rgba(52, 211, 153, 0.75);
        box-shadow: 0 -6px 26px rgba(0, 0, 0, 0.7), 0 0 22px rgba(16, 185, 129, 0.3);
        color: #a7f3d0;
      }
      .tw-launcher-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #facc15;
        box-shadow: 0 0 8px #facc15;
        flex-shrink: 0;
      }
      #tw-carry-launcher.tw-running .tw-launcher-dot {
        background: #10b981;
        box-shadow: 0 0 10px #10b981;
        animation: twPulseDot 1.4s infinite ease-in-out;
      }
      @keyframes twPulseDot {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.28); opacity: 0.75; }
      }
      .tw-launcher-chip {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 9px;
        border-radius: 999px;
        background: rgba(250, 204, 21, 0.14);
        border: 1px solid rgba(250, 204, 21, 0.35);
        color: #fde047;
      }
      #tw-carry-launcher.tw-running .tw-launcher-chip {
        background: rgba(16, 185, 129, 0.18);
        border-color: rgba(52, 211, 153, 0.45);
        color: #6ee7b7;
      }
      .tw-launcher-chevron {
        font-size: 10px;
        color: #94a3b8;
        transition: transform 0.22s ease;
      }
      #tw-carry-launcher.tw-open .tw-launcher-chevron {
        transform: rotate(180deg);
      }

      /* Backdrop & Slide-Up Drawer */
      #tw-carry-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(2, 6, 23, 0.72);
        backdrop-filter: blur(4px);
        z-index: 9948;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.24s ease;
      }
      #tw-carry-backdrop.tw-open {
        opacity: 1;
        pointer-events: auto;
      }
      #tw-carry-drawer {
        position: fixed;
        bottom: 0;
        left: 50%;
        transform: translate(-50%, 104%);
        width: min(1140px, 97vw);
        max-height: 86vh;
        z-index: 9949;
        background: linear-gradient(165deg, #0b1325 0%, #0f172a 55%, #131c31 100%);
        border: 1px solid rgba(250, 204, 21, 0.42);
        border-bottom: none;
        border-radius: 16px 16px 0 0;
        box-shadow: 0 -20px 60px rgba(0, 0, 0, 0.88), 0 0 35px rgba(234, 179, 8, 0.14);
        color: #f8fafc;
        display: flex;
        flex-direction: column;
        transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
        overflow: hidden;
      }
      #tw-carry-drawer.tw-open {
        transform: translate(-50%, 0);
      }

      /* Drawer Header */
      .tw-drawer-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 13px 18px;
        background: rgba(9, 13, 22, 0.78);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        flex-shrink: 0;
        gap: 10px;
        flex-wrap: wrap;
      }
      .tw-drawer-title-group {
        display: flex;
        align-items: center;
        gap: 11px;
      }
      .tw-drawer-icon {
        width: 38px;
        height: 38px;
        border-radius: 10px;
        background: linear-gradient(135deg, rgba(250, 204, 21, 0.22), rgba(234, 88, 12, 0.18));
        border: 1px solid rgba(250, 204, 21, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        flex-shrink: 0;
      }
      .tw-drawer-title {
        font-size: 15.5px;
        font-weight: 800;
        color: #fef08a;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .tw-drawer-subtitle {
        font-size: 11.5px;
        color: #94a3b8;
        margin-top: 2px;
      }

      /* Drawer Body */
      .tw-drawer-body {
        padding: 14px 18px 18px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      /* Live Status Banner */
      .tw-status-banner {
        background: rgba(15, 23, 42, 0.85);
        border: 1px solid rgba(56, 189, 248, 0.32);
        border-radius: 11px;
        padding: 10px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px;
      }
      .tw-status-banner.tw-active {
        background: linear-gradient(90deg, rgba(6, 78, 59, 0.45), rgba(15, 23, 42, 0.9));
        border-color: rgba(52, 211, 153, 0.5);
      }

      /* Grid Layout */
      .tw-roles-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
        gap: 12px;
      }
      .tw-card {
        background: rgba(9, 14, 26, 0.72);
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 11px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 9px;
      }
      .tw-card.tw-card-damage {
        border-color: rgba(248, 113, 113, 0.38);
      }
      .tw-card.tw-card-priest {
        border-color: rgba(56, 189, 248, 0.4);
      }
      .tw-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .tw-card-title {
        font-size: 13.5px;
        font-weight: 800;
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .tw-select, .tw-input {
        background: #090d16;
        border: 1px solid rgba(148, 163, 184, 0.32);
        border-radius: 7px;
        color: #f8fafc;
        font-size: 12px;
        padding: 6px 10px;
        font-family: inherit;
        outline: none;
      }
      .tw-select:focus, .tw-input:focus {
        border-color: #38bdf8;
      }

      /* Skill Picker Box */
      .tw-skill-box {
        background: rgba(15, 23, 42, 0.65);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        padding: 8px 10px;
        max-height: 155px;
        overflow-y: auto;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .tw-skill-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 8px;
        border-radius: 6px;
        background: rgba(30, 41, 59, 0.75);
        border: 1px solid rgba(148, 163, 184, 0.25);
        font-size: 11.5px;
        color: #cbd5e1;
        cursor: pointer;
        user-select: none;
        transition: all 0.14s ease;
      }
      .tw-skill-chip:hover {
        border-color: rgba(56, 189, 248, 0.5);
        color: #fff;
      }
      .tw-skill-chip input {
        margin: 0;
        accent-color: #38bdf8;
      }
      .tw-skill-chip.tw-checked {
        background: rgba(14, 165, 233, 0.22);
        border-color: rgba(56, 189, 248, 0.65);
        color: #e0f2fe;
        font-weight: 600;
      }
      .tw-skill-chip.tw-checked-damage {
        background: rgba(239, 68, 68, 0.2);
        border-color: rgba(248, 113, 113, 0.65);
        color: #fee2e2;
        font-weight: 600;
      }
      .tw-skill-chip.tw-checked-buff {
        background: rgba(234, 179, 8, 0.2);
        border-color: rgba(250, 204, 21, 0.65);
        color: #fef08a;
        font-weight: 600;
      }

      /* Kids Queue Table */
      .tw-kids-table-wrap {
        max-height: 200px;
        overflow-y: auto;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        background: rgba(6, 10, 19, 0.7);
      }
      .tw-kids-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11.5px;
      }
      .tw-kids-table th {
        position: sticky;
        top: 0;
        background: #0f172a;
        color: #94a3b8;
        font-weight: 700;
        text-align: left;
        padding: 6px 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        z-index: 1;
      }
      .tw-kids-table td {
        padding: 5px 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        color: #e2e8f0;
      }
      .tw-kids-table tr:hover td {
        background: rgba(30, 41, 59, 0.45);
      }
      .tw-quota-pill {
        display: inline-block;
        padding: 1px 7px;
        border-radius: 999px;
        font-size: 10.5px;
        font-weight: 700;
      }
      .tw-quota-ok {
        background: rgba(16, 185, 129, 0.18);
        color: #6ee7b7;
        border: 1px solid rgba(52, 211, 153, 0.4);
      }
      .tw-quota-zero {
        background: rgba(148, 163, 184, 0.14);
        color: #94a3b8;
        border: 1px solid rgba(148, 163, 184, 0.25);
      }
    `;
    document.head.appendChild(style);
  }

  function mountDom() {
    if (dom) return dom;
    injectStyles();

    // 1. Bottom-Center Floating Launcher Button
    const launcher = document.createElement('button');
    launcher.id = 'tw-carry-launcher';
    launcher.type = 'button';
    launcher.title = 'คลิกเพื่อเปิดระบบแบกหอคอย 100 ชั้น (Endless Tower Carry)';
    launcher.innerHTML = `
      <span class="tw-launcher-dot"></span>
      <span>🏰 แบกหอคอย</span>
      <span id="tw-launcher-chip" class="tw-launcher-chip">พร้อมทำงาน</span>
      <span class="tw-launcher-chevron">▲</span>
    `;

    // 2. Backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'tw-carry-backdrop';

    // 3. Slide-Up Drawer Dialog
    const drawer = document.createElement('section');
    drawer.id = 'tw-carry-drawer';
    drawer.setAttribute('aria-label', 'ระบบแบกหอคอย 100 ชั้นอัตโนมัติ');
    drawer.innerHTML = `
      <div class="tw-drawer-header">
        <div class="tw-drawer-title-group">
          <div class="tw-drawer-icon">🏰</div>
          <div>
            <div class="tw-drawer-title">
              <span>ระบบแบกหอคอย 100 ชั้นอัตโนมัติ (Endless Tower Carry)</span>
              <span id="tw-header-badge" class="tw-launcher-chip">สถานะ: พร้อมทำงาน</span>
            </div>
            <div class="tw-drawer-subtitle">
              จัดตี้ตัวแบก Damage + Priest อัจฉริยะ (ระยะล่า 12 ช่อง · เดินอ้อมหลบบอสไปชุบ/บัพ · ห้ามกดเกิดในชั้น · วนโควต้า 3/3 รอบเปลี่ยนชุดเด็กอัตโนมัติ)
            </div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <button type="button" id="btn-tw-scan-quotas" class="btn btn-ghost btn-sm" style="font-size:11.5px;padding:5px 11px;border:1px solid rgba(56,189,248,0.4);color:#38bdf8;">
            🔍 สแกนโควต้าทุกจอ (3/3)
          </button>
          <button type="button" id="btn-tw-reset-all" class="btn btn-ghost btn-sm" style="font-size:11.5px;padding:5px 11px;border:1px solid rgba(250,204,21,0.4);color:#fde047;" title="สั่งทุกตัวในตี้ปัจจุบันกดรีเซตเริ่มชั้น 1">
            🔄 กด Reset ชั้น 1 ยกตี้
          </button>
          <button type="button" id="btn-tw-start-stop" class="btn btn-primary btn-sm" style="font-size:12px;padding:6px 16px;font-weight:700;background:linear-gradient(135deg,#059669,#10b981);border-color:#34d399;color:#022c22;">
            🚀 เริ่มระบบแบกหอคอย
          </button>
          <button type="button" id="btn-tw-close" class="btn btn-secondary btn-sm" style="font-size:12px;padding:5px 12px;">
            ▼ พับลง
          </button>
        </div>
      </div>

      <div class="tw-drawer-body">
        <!-- Live Runtime Status Banner -->
        <div id="tw-status-banner" class="tw-status-banner">
          <div style="display:flex;flex-direction:column;gap:3px;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="font-size:12px;font-weight:800;color:#fde047;" id="tw-status-phase">⏸️ ระบบหยุดอยู่ (พร้อมเริ่มงาน)</span>
              <span style="font-size:11.5px;color:#cbd5e1;" id="tw-status-detail">เลือกตัวแบก Damage และ Priest ด้านล่าง แล้วกด "เริ่มระบบแบกหอคอย"</span>
            </div>
            <div style="font-size:11px;color:#94a3b8;display:flex;gap:14px;flex-wrap:wrap;" id="tw-status-telemetry">
              <span>ชั้นปัจจุบัน: <b id="tw-stat-floor" style="color:#38bdf8;">-</b></span>
              <span>เป้าหมายจบ: <b id="tw-stat-target" style="color:#fde047;">ชั้น 60</b></span>
              <span>ปุ่มรีเซ็ตก่อนเข้า: <b id="tw-stat-reset-mode" style="color:#34d399;">เปิด (กดรีเซ็ต)</b></span>
              <span>รอบของชุดนี้: <b id="tw-stat-round" style="color:#34d399;">0 / 3</b></span>
              <span>สถานะ Priest AI: <b id="tw-stat-priest-ai" style="color:#c084fc;">รอเข้าหอคอย</b></span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <button type="button" id="btn-tw-save-settings" class="btn btn-secondary btn-sm" style="font-size:11.5px;padding:5px 12px;border-color:rgba(56,189,248,0.45);color:#7dd3fc;">
              💾 บันทึกการตั้งค่า
            </button>
          </div>
        </div>

        <!-- Role 1 (Damage) & Role 2 (Priest) Configuration Grid -->
        <div class="tw-roles-grid">
          <!-- ROLE 1: DAMAGE -->
          <div class="tw-card tw-card-damage">
            <div class="tw-card-header">
              <div class="tw-card-title" style="color:#fca5a5;">
                <span>⚔️ Role 1: ตัวแบก Damage (หัวหน้าตี้ & ดาเมจหลัก)</span>
              </div>
              <button type="button" id="btn-tw-reload-damage-skills" class="btn btn-ghost btn-sm" style="font-size:10.5px;padding:2px 8px;border:1px solid rgba(248,113,113,0.35);color:#fca5a5;">
                🔄 ดึงสกิลจากตัวละคร
              </button>
            </div>

            <div style="display:flex;flex-direction:column;gap:4px;">
              <label style="font-size:11px;color:#94a3b8;">เลือกตัวละครแบก Damage (ทำหน้าที่สร้างตี้ ชวนเด็ก และกดเข้าหอคอย):</label>
              <select id="tw-select-damage" class="tw-select">
                <option value="">-- เลือกตัวละคร Damage --</option>
              </select>
            </div>

            <div style="display:flex;flex-direction:column;gap:5px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:11px;font-weight:700;color:#fecaca;">🎯 เซ็ตสกิลที่ใช้ตอนเปิด Auto ลุยหอคอย (ดึงจาก Data ตัวละครจริง):</span>
                <span id="tw-damage-skill-meta" style="font-size:10.5px;color:#94a3b8;">ยังไม่ได้เลือกตัวละคร</span>
              </div>
              <div id="tw-damage-skills-box" class="tw-skill-box">
                <div style="font-size:11px;color:#64748b;padding:8px;">เลือกตัวละคร Damage เพื่อดึงรายการสกิลที่มีทั้งหมดมาให้ติ๊กตั้งค่า</div>
              </div>
            </div>
          </div>

          <!-- ROLE 2: PRIEST -->
          <div class="tw-card tw-card-priest">
            <div class="tw-card-header">
              <div class="tw-card-title" style="color:#7dd3fc;">
                <span>✨ Role 2: ตัวแบก Priest (พระชุบ & หลบบอสอัจฉริยะ)</span>
              </div>
              <button type="button" id="btn-tw-reload-priest-skills" class="btn btn-ghost btn-sm" style="font-size:10.5px;padding:2px 8px;border:1px solid rgba(56,189,248,0.35);color:#7dd3fc;">
                🔄 ดึงสกิลจากตัวละคร
              </button>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div style="display:flex;flex-direction:column;gap:4px;">
                <label style="font-size:11px;color:#94a3b8;">เลือกตัวละคร Priest:</label>
                <select id="tw-select-priest" class="tw-select">
                  <option value="">-- เลือกตัวละคร Priest --</option>
                </select>
              </div>
              <div style="display:flex;flex-direction:column;gap:4px;">
                <label style="font-size:11px;color:#94a3b8;">โปรไฟล์ระบบการเล่นพระ:</label>
                <select id="tw-select-priest-mode" class="tw-select" style="color:#6ee7b7;font-weight:600;">
                  <option value="safe_anchor_12">โปรไฟล์ 1: ระยะ 12 ช่อง + เดินอ้อมบอสไปชุบ/บัพ</option>
                </select>
              </div>
            </div>

            <div style="background:rgba(14,165,233,0.09);border:1px solid rgba(56,189,248,0.25);border-radius:7px;padding:6px 9px;font-size:10.8px;color:#bae6fd;line-height:1.45;">
              💡 <b>โปรไฟล์ 1:</b> ตั้งระยะต่อสู้ <b>12 ช่อง</b> เปิด Auto ยืนจุดเริ่ม (พอจบเวฟศพตัวเด็กจะเด้งกลับมาจุดเริ่มให้พระชุบเอง) · <b>ชั้นบอส:</b> ถ้าตัว Damage ตายหรือบัพหมด พระจะ<b>ปิด Auto ห้ามตีบอส</b> คำนวณเส้นทาง<b>เดินโค้งอ้อมห่างบอส + หลบวง AoE</b> ไปชุบ/บัพจากฝั่งตรงข้ามบอส แล้วเดินถอยกลับจุดเริ่มทันที
            </div>

            <div style="display:flex;flex-direction:column;gap:5px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:11px;font-weight:700;color:#bae6fd;">🪄 สกิลเปิด Auto ประจำจุดเริ่มต้น (ระยะ 12 ช่อง):</span>
                <span id="tw-priest-skill-meta" style="font-size:10.5px;color:#94a3b8;">ยังไม่ได้เลือกตัวละคร</span>
              </div>
              <div id="tw-priest-skills-box" class="tw-skill-box" style="max-height:105px;">
                <div style="font-size:11px;color:#64748b;padding:6px;">เลือกตัวละคร Priest เพื่อดึงสกิลมาตั้งค่า</div>
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:5px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:11px;font-weight:700;color:#fef08a;">🛡️ สกิลที่ให้พระเดินอ้อมหลบบอสไปเติมให้ตัว Damage เมื่อบัพหมด:</span>
                <span style="font-size:10px;color:#94a3b8;">เช็กบัพเรียลไทม์</span>
              </div>
              <div id="tw-priest-outbuff-box" class="tw-skill-box" style="max-height:85px;">
                <div style="font-size:11px;color:#64748b;padding:6px;">เลือกตัวละคร Priest เพื่อเลือกบัพสำคัญ</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Floor Target, Rules & Candidate Kids Queue -->
        <div class="tw-roles-grid">
          <!-- Run Rules & Target Floor -->
          <div class="tw-card">
            <div class="tw-card-title" style="color:#fde047;">⚙️ ตั้งค่าชั้นเป้าหมาย & พฤติกรรมตัวเด็ก</div>

            <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:8px;align-items:end;">
              <div style="display:flex;flex-direction:column;gap:4px;min-width:0;">
                <label style="font-size:11px;color:#94a3b8;">ลงถึงชั้นไหนแล้วกลับเมือง (เลือกด่วน / ระบุชั้น 1-100):</label>
                <div style="display:flex;gap:6px;align-items:stretch;min-width:0;">
                  <select id="tw-select-target-floor" class="tw-select" style="flex:1;min-width:0;width:100%;color:#fde047;font-weight:700;">
                    <option value="9">ชั้น 9 (วนฟาร์ม 1-9 กลับเมืองเข้าใหม่)</option>
                    <option value="10">ชั้น 10 (บอสชั้น 10)</option>
                    <option value="19">ชั้น 19 (ฟาร์มถึง 19 ออกก่อนบอส 20)</option>
                    <option value="20">ชั้น 20 (บอสชั้น 20)</option>
                    <option value="30">ชั้น 30 (บอสชั้น 30)</option>
                    <option value="40">ชั้น 40 (บอสชั้น 40)</option>
                    <option value="50">ชั้น 50 (บอสชั้น 50)</option>
                    <option value="60" selected>ชั้น 60 (บอสชั้น 60 - หีบทอง แนะนำ)</option>
                    <option value="70">ชั้น 70 (บอสชั้น 70)</option>
                    <option value="80">ชั้น 80 (บอสชั้น 80)</option>
                    <option value="90">ชั้น 90 (บอสชั้น 90)</option>
                    <option value="100">ชั้น 100 (บอสชั้น 100)</option>
                    <option value="custom">✏️ ระบุเลขชั้นเอง (1-100)</option>
                  </select>
                  <div style="display:flex;align-items:center;gap:4px;background:#090d16;border:1px solid rgba(250,204,21,0.48);border-radius:7px;padding:0 7px;flex-shrink:0;" title="ระบุชั้นเป้าหมายที่ต้องการจบแล้วกลับเมือง (1 - 100) เช่น 9 เพื่อวนชั้น 1-9">
                    <span style="font-size:11px;color:#94a3b8;white-space:nowrap;">ชั้น</span>
                    <input type="number" id="tw-input-target-floor" min="1" max="100" step="1" value="60" style="width:44px;background:transparent;border:none;color:#fde047;font-weight:800;font-size:13px;padding:5px 2px;text-align:center;outline:none;font-family:inherit;">
                  </div>
                </div>
              </div>

              <div style="display:flex;flex-direction:column;gap:4px;min-width:0;">
                <label style="font-size:11px;color:#94a3b8;">โหมดตัวเด็กในหอคอย:</label>
                <select id="tw-select-kid-mode" class="tw-select" style="width:100%;min-width:0;">
                  <option value="auto_until_boss" selected>เปิด Auto ชั้นปกติ → หยุดเมื่อถึงห้องบอส</option>
                  <option value="stand_still">ยืนเฉยๆ ทุกชั้น (กดรับรางวัลอย่างเดียว)</option>
                </select>
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:6px;margin-top:2px;font-size:11.5px;color:#cbd5e1;">
              <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;background:rgba(250,204,21,0.09);border:1px solid rgba(250,204,21,0.35);border-radius:8px;padding:7px 10px;">
                <input type="checkbox" id="tw-chk-auto-reset" checked style="accent-color:#facc15;margin-top:2px;">
                <span style="line-height:1.45;">
                  <b style="color:#fef08a;">🔄 เปิด/ปิด กดปุ่ม "รีเซ็ตเริ่มชั้น 1" ก่อนเข้าหอคอยใหม่:</b>
                  <span id="tw-reset-mode-hint" style="display:block;font-size:11px;color:#e2e8f0;">✅ เปิดอยู่: เมื่อกลับเมืองออกมาจะทำการกดปุ่มรีเซ็ตเริ่มชั้น 1 ก่อนเข้าไปใหม่</span>
                </span>
              </label>
              <label style="display:flex;align-items:center;gap:7px;cursor:pointer;">
                <input type="checkbox" id="tw-chk-auto-next-batch" checked style="accent-color:#10b981;">
                <span><b>วนครบ 3/3 รอบแล้วดึงชุดถัดไปอัตโนมัติ:</b> เมื่อชุดปัจจุบันใช้โควต้าครบ 3 รอบ/สัปดาห์ ให้เตะออกตี้แล้วดึงตัวเด็กชุดถัดไปมาลงต่อทันที (หากตั้งชั้น 1-9 หรือไม่ติ๊ก ระบบจะวนตี้เดิมซ้ำต่อเนื่อง)</span>
              </label>
              <label style="display:flex;align-items:center;gap:7px;cursor:pointer;">
                <input type="checkbox" id="tw-chk-resume-bot" checked style="accent-color:#38bdf8;">
                <span><b>ส่งตัวเด็กที่ครบโควต้า 3/3 กลับไปเปิดบอทฟาร์มต่ออัตโนมัติ</b></span>
              </label>
              <div style="background:rgba(239,68,68,0.12);border:1px solid rgba(248,113,113,0.35);border-radius:7px;padding:6px 9px;font-size:11px;color:#fecaca;">
                🛡️ <b>ระบบกันกดเกิดทำงานอัตโนมัติ:</b> ตัวเด็กและตัวแบกที่ตายในหอคอยจะ<b>ไม่กดปุ่ม "ฟื้นที่จุดเกิด / กลับเมืองหลวง" เด็ดขาด</b> รอศพเด้งกลับจุดเริ่มเมื่อจบเวฟให้พระชุบ
              </div>
            </div>

            <!-- Live Activity Log -->
            <div style="display:flex;flex-direction:column;gap:4px;margin-top:2px;">
              <div style="font-size:11px;font-weight:700;color:#94a3b8;">📜 บันทึกการทำงานล่าสุด (Tower Carry Log):</div>
              <div id="tw-logs-box" style="background:#060a12;border:1px solid rgba(255,255,255,0.07);border-radius:7px;padding:7px 9px;height:105px;overflow-y:auto;font-family:monospace;font-size:11px;color:#cbd5e1;display:flex;flex-direction:column;gap:3px;">
                <div style="color:#64748b;">ยังไม่มีประวัติการทำงาน</div>
              </div>
            </div>
          </div>

          <!-- Candidate Kids & 3/3 Weekly Quota Table -->
          <div class="tw-card">
            <div class="tw-card-header">
              <div class="tw-card-title" style="color:#6ee7b7;">
                <span>👥 คิวตัวเด็ก & โควต้าหอคอยรายสัปดาห์ (สูงสุด 4 ตัว/ชุด · 3 รอบ/สัปดาห์)</span>
              </div>
              <div style="display:flex;gap:5px;">
                <button type="button" id="btn-tw-kids-clear" class="btn btn-ghost btn-sm" style="font-size:10.5px;padding:2px 7px;border:1px solid rgba(148,163,184,0.3);color:#cbd5e1;" title="ไม่ระบุเจาะจง = ดึงทุกตัวที่ Lv.99+ และมีโควต้าเหลืออัตโนมัติ">
                  ✨ ออโต้ทุกตัวที่มีโควต้า
                </button>
              </div>
            </div>
            <div style="font-size:11px;color:#94a3b8;">
              หากไม่ติ๊กเลือกเฉพาะเจาะจง ระบบจะดึงทุกตัวที่ออนไลน์ (Lv.99+) และเหลือโควต้า <b>3/3, 2/3, 1/3</b> เข้าตี้ทีละชุด ชุดละ 4 ตัว (แม้กำลังฟาร์มอยู่ก็จะสั่งกลับเมืองมาเข้าตี้หอคอยให้อัตโนมัติ)
            </div>
            <div class="tw-kids-table-wrap">
              <table class="tw-kids-table">
                <thead>
                  <tr>
                    <th style="width:28px;">เลือก</th>
                    <th>ตัวละคร</th>
                    <th>อาชีพ / Lv</th>
                    <th>โควต้าสัปดาห์นี้</th>
                    <th>ชั้นค้าง</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody id="tw-kids-tbody">
                  <tr><td colspan="6" style="text-align:center;color:#64748b;padding:16px;">กำลังโหลดข้อมูลตัวละคร...</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(launcher);
    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);

    dom = {
      launcher,
      launcherChip: document.getElementById('tw-launcher-chip'),
      backdrop,
      drawer,
      headerBadge: document.getElementById('tw-header-badge'),
      statusBanner: document.getElementById('tw-status-banner'),
      statusPhase: document.getElementById('tw-status-phase'),
      statusDetail: document.getElementById('tw-status-detail'),
      statFloor: document.getElementById('tw-stat-floor'),
      statTarget: document.getElementById('tw-stat-target'),
      statResetMode: document.getElementById('tw-stat-reset-mode'),
      statRound: document.getElementById('tw-stat-round'),
      statPriestAi: document.getElementById('tw-stat-priest-ai'),
      selectDamage: document.getElementById('tw-select-damage'),
      selectPriest: document.getElementById('tw-select-priest'),
      selectPriestMode: document.getElementById('tw-select-priest-mode'),
      selectTargetFloor: document.getElementById('tw-select-target-floor'),
      inputTargetFloor: document.getElementById('tw-input-target-floor'),
      selectKidMode: document.getElementById('tw-select-kid-mode'),
      chkAutoReset: document.getElementById('tw-chk-auto-reset'),
      resetModeHint: document.getElementById('tw-reset-mode-hint'),
      chkAutoNextBatch: document.getElementById('tw-chk-auto-next-batch'),
      chkResumeBot: document.getElementById('tw-chk-resume-bot'),
      damageSkillMeta: document.getElementById('tw-damage-skill-meta'),
      damageSkillsBox: document.getElementById('tw-damage-skills-box'),
      priestSkillMeta: document.getElementById('tw-priest-skill-meta'),
      priestSkillsBox: document.getElementById('tw-priest-skills-box'),
      priestOutbuffBox: document.getElementById('tw-priest-outbuff-box'),
      kidsTbody: document.getElementById('tw-kids-tbody'),
      logsBox: document.getElementById('tw-logs-box'),
      btnStartStop: document.getElementById('btn-tw-start-stop'),
      btnScanQuotas: document.getElementById('btn-tw-scan-quotas'),
      btnResetAll: document.getElementById('btn-tw-reset-all'),
      btnSaveSettings: document.getElementById('btn-tw-save-settings'),
      btnClose: document.getElementById('btn-tw-close'),
      btnReloadDamageSkills: document.getElementById('btn-tw-reload-damage-skills'),
      btnReloadPriestSkills: document.getElementById('btn-tw-reload-priest-skills'),
      btnKidsClear: document.getElementById('btn-tw-kids-clear')
    };

    bindEvents();
    return dom;
  }

  function toggleDrawer(forceOpen) {
    mountDom();
    const next = typeof forceOpen === 'boolean' ? forceOpen : !uiState.isOpen;
    uiState.isOpen = next;
    dom.launcher.classList.toggle('tw-open', next);
    dom.backdrop.classList.toggle('tw-open', next);
    dom.drawer.classList.toggle('tw-open', next);
    if (next) {
      fetchTowerStatus(true);
    }
  }

  function bindEvents() {
    dom.launcher.addEventListener('click', () => toggleDrawer());
    dom.backdrop.addEventListener('click', () => toggleDrawer(false));
    dom.btnClose.addEventListener('click', () => toggleDrawer(false));

    dom.selectDamage.addEventListener('change', async () => {
      uiState.localSettings.damageProfileId = dom.selectDamage.value;
      uiState.dirtySettings = true;
      await loadRoleSkills('damage', uiState.localSettings.damageProfileId, true);
      await saveSettingsQuiet();
      renderKidsTable();
    });

    dom.selectPriest.addEventListener('change', async () => {
      uiState.localSettings.priestProfileId = dom.selectPriest.value;
      uiState.dirtySettings = true;
      await loadRoleSkills('priest', uiState.localSettings.priestProfileId, true);
      await saveSettingsQuiet();
      renderKidsTable();
    });

    dom.selectPriestMode.addEventListener('change', () => {
      uiState.localSettings.priestProfileMode = dom.selectPriestMode.value;
      uiState.dirtySettings = true;
      saveSettingsQuiet();
    });

    const syncTargetFloorUi = (floorNum, skipNumberInput = false) => {
      const clamped = Math.max(1, Math.min(100, Math.floor(Number(floorNum) || 60)));
      uiState.localSettings.targetFloor = clamped;
      if (!skipNumberInput && dom.inputTargetFloor) {
        dom.inputTargetFloor.value = String(clamped);
      }
      if (dom.selectTargetFloor) {
        const hasOption = Array.from(dom.selectTargetFloor.options).some(o => o.value === String(clamped));
        dom.selectTargetFloor.value = hasOption ? String(clamped) : 'custom';
      }
      if (dom.statTarget) {
        dom.statTarget.textContent = clamped === 9 ? 'ชั้น 1-9 (วนกลับเมือง)' : `ชั้น ${clamped}`;
      }
    };

    const syncResetModeUi = (enabled) => {
      const on = enabled !== false;
      uiState.localSettings.autoResetBeforeEnter = on;
      if (dom.chkAutoReset) dom.chkAutoReset.checked = on;
      if (dom.resetModeHint) {
        dom.resetModeHint.textContent = on
          ? '✅ เปิดอยู่: เมื่อกลับเมืองออกมาจะทำการกดปุ่ม "รีเซ็ตเริ่มชั้น 1" ก่อนเข้าไปใหม่'
          : '⏭️ ปิดอยู่: เมื่อกลับเมืองออกมาจะเข้าไปหอคอยใหม่ทันที โดยไม่ต้องกดปุ่มรีเซ็ต';
        dom.resetModeHint.style.color = on ? '#e2e8f0' : '#fde68a';
      }
      if (dom.statResetMode) {
        dom.statResetMode.textContent = on ? 'เปิด (กดรีเซ็ต)' : 'ปิด (เข้าทันที)';
        dom.statResetMode.style.color = on ? '#34d399' : '#facc15';
      }
    };

    dom.selectTargetFloor.addEventListener('change', () => {
      if (dom.selectTargetFloor.value === 'custom') {
        if (dom.inputTargetFloor) {
          dom.inputTargetFloor.focus();
          dom.inputTargetFloor.select();
        }
        return;
      }
      syncTargetFloorUi(Number(dom.selectTargetFloor.value) || 60, false);
      uiState.dirtySettings = true;
      saveSettingsQuiet();
    });

    if (dom.inputTargetFloor) {
      dom.inputTargetFloor.addEventListener('input', () => {
        const raw = parseInt(dom.inputTargetFloor.value, 10);
        if (!Number.isFinite(raw) || raw < 1) return;
        syncTargetFloorUi(raw, true);
        uiState.dirtySettings = true;
      });
      dom.inputTargetFloor.addEventListener('change', () => {
        syncTargetFloorUi(Number(dom.inputTargetFloor.value) || 60, false);
        uiState.dirtySettings = true;
        saveSettingsQuiet();
      });
    }

    if (dom.chkAutoReset) {
      dom.chkAutoReset.addEventListener('change', () => {
        syncResetModeUi(dom.chkAutoReset.checked);
        uiState.dirtySettings = true;
        saveSettingsQuiet();
      });
    }

    dom.selectKidMode.addEventListener('change', () => {
      uiState.localSettings.kidMode = dom.selectKidMode.value === 'stand_still' ? 'stand_still' : 'auto_until_boss';
      uiState.dirtySettings = true;
      saveSettingsQuiet();
    });

    dom.chkAutoNextBatch.addEventListener('change', () => {
      uiState.localSettings.autoNextBatch = dom.chkAutoNextBatch.checked;
      uiState.dirtySettings = true;
      saveSettingsQuiet();
    });

    dom.chkResumeBot.addEventListener('change', () => {
      uiState.localSettings.resumeFarmAfterFinish = dom.chkResumeBot.checked;
      uiState.dirtySettings = true;
      saveSettingsQuiet();
    });

    dom.btnReloadDamageSkills.addEventListener('click', () => {
      loadRoleSkills('damage', dom.selectDamage.value, false);
    });

    dom.btnReloadPriestSkills.addEventListener('click', () => {
      loadRoleSkills('priest', dom.selectPriest.value, false);
    });

    dom.btnSaveSettings.addEventListener('click', async () => {
      await saveSettingsQuiet(true);
    });

    dom.btnKidsClear.addEventListener('click', async () => {
      uiState.localSettings.selectedKidProfileIds = [];
      uiState.dirtySettings = true;
      renderKidsTable();
      await saveSettingsQuiet();
    });

    dom.btnScanQuotas.addEventListener('click', async () => {
      if (uiState.scanningQuotas) return;
      uiState.scanningQuotas = true;
      dom.btnScanQuotas.disabled = true;
      dom.btnScanQuotas.textContent = '⏳ กำลังสแกนโควต้า...';
      try {
        const res = await fetch('/api/tower/scan-quotas', { method: 'POST' });
        const data = await res.json();
        if (data) applyServerData(data);
      } catch (_) {}
      uiState.scanningQuotas = false;
      dom.btnScanQuotas.disabled = false;
      dom.btnScanQuotas.textContent = '🔍 สแกนโควต้าทุกจอ (3/3)';
    });

    dom.btnResetAll.addEventListener('click', async () => {
      dom.btnResetAll.disabled = true;
      dom.btnResetAll.textContent = '⏳ กำลังสั่ง Reset...';
      try {
        const res = await fetch('/api/tower/reset-all', { method: 'POST' });
        const data = await res.json();
        if (data) applyServerData(data);
      } catch (_) {}
      dom.btnResetAll.disabled = false;
      dom.btnResetAll.textContent = '🔄 กด Reset ชั้น 1 ยกตี้';
    });

    dom.btnStartStop.addEventListener('click', async () => {
      const running = Boolean(uiState.serverData && uiState.serverData.state && uiState.serverData.state.running);
      dom.btnStartStop.disabled = true;
      try {
        if (running) {
          const res = await fetch('/api/tower/stop', { method: 'POST' });
          const data = await res.json();
          if (data) applyServerData(data);
        } else {
          await saveSettingsQuiet();
          const res = await fetch('/api/tower/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(uiState.localSettings)
          });
          const data = await res.json();
          if (data && data.success === false && data.error) {
            alert('ไม่สามารถเริ่มระบบแบกหอคอยได้: ' + data.error);
          }
          if (data) applyServerData(data);
        }
      } catch (e) {
        alert('เกิดข้อผิดพลาด: ' + e.message);
      }
      dom.btnStartStop.disabled = false;
    });
  }

  async function saveSettingsQuiet(showFeedback = false) {
    try {
      const res = await fetch('/api/tower/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(uiState.localSettings)
      });
      const data = await res.json();
      uiState.dirtySettings = false;
      if (data) applyServerData(data);
      if (showFeedback && dom && dom.btnSaveSettings) {
        const old = dom.btnSaveSettings.textContent;
        dom.btnSaveSettings.textContent = '✅ บันทึกแล้ว';
        setTimeout(() => { dom.btnSaveSettings.textContent = old; }, 1400);
      }
    } catch (_) {}
  }

  async function loadRoleSkills(role, profileId, autoDefaultIfEmpty = false) {
    mountDom();
    const isDamage = role === 'damage';
    const metaEl = isDamage ? dom.damageSkillMeta : dom.priestSkillMeta;
    const boxEl = isDamage ? dom.damageSkillsBox : dom.priestSkillsBox;

    if (!profileId) {
      metaEl.textContent = 'ยังไม่ได้เลือกตัวละคร';
      boxEl.innerHTML = `<div style="font-size:11px;color:#64748b;padding:6px;">เลือกตัวละคร ${isDamage ? 'Damage' : 'Priest'} เพื่อดึงรายการสกิลจริง</div>`;
      if (!isDamage) {
        dom.priestOutbuffBox.innerHTML = `<div style="font-size:11px;color:#64748b;padding:6px;">เลือกตัวละคร Priest เพื่อเลือกบัพสำคัญ</div>`;
      }
      return;
    }

    metaEl.textContent = '⏳ กำลังดึงสกิลจากเกม...';
    try {
      const res = await fetch('/api/tower/role-skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId })
      });
      const data = await res.json();
      if (!data || data.success === false) {
        metaEl.textContent = `⚠️ ดึงสกิลไม่สำเร็จ (${(data && data.error) || 'จอเกมยังไม่พร้อม'})`;
        return;
      }

      const rs = data.roleSkills || (data.roleSkillsCache && data.roleSkillsCache[profileId]) || data;
      const skills = Array.isArray(rs.skills) ? rs.skills : [];
      uiState.roleSkillsCache[role] = {
        profileId,
        charName: rs.charName || '',
        job: rs.classId || rs.job || '',
        skills
      };

      if (isDamage) {
        if (autoDefaultIfEmpty && (!Array.isArray(uiState.localSettings.damageSkills) || uiState.localSettings.damageSkills.length === 0)) {
          const fromAuto = Array.isArray(rs.autoSkills) && rs.autoSkills.length > 0
            ? rs.autoSkills
            : skills.filter(s => s.id !== 'first-aid' && s.id !== 'trick-dead').map(s => s.id);
          uiState.localSettings.damageSkills = fromAuto;
        }
      } else {
        if (autoDefaultIfEmpty && (!Array.isArray(uiState.localSettings.priestSkills) || uiState.localSettings.priestSkills.length === 0)) {
          const fromAuto = Array.isArray(rs.autoSkills) && rs.autoSkills.length > 0
            ? rs.autoSkills.slice()
            : skills.map(s => s.id);
          if (!fromAuto.includes('resurrection') && skills.some(s => s.id === 'resurrection')) {
            fromAuto.unshift('resurrection');
          }
          uiState.localSettings.priestSkills = fromAuto;
        }
      }

      renderRoleSkillBoxes(role);
    } catch (e) {
      metaEl.textContent = '⚠️ เชื่อมต่อจอเกมไม่สำเร็จ';
    }
  }

  function renderRoleSkillBoxes(role) {
    mountDom();
    const isDamage = role === 'damage';
    const cache = uiState.roleSkillsCache[role] || { skills: [] };
    const skills = Array.isArray(cache.skills) ? cache.skills : [];
    const metaEl = isDamage ? dom.damageSkillMeta : dom.priestSkillMeta;
    const boxEl = isDamage ? dom.damageSkillsBox : dom.priestSkillsBox;

    if (!cache.profileId || skills.length === 0) {
      metaEl.textContent = cache.charName ? `${cache.charName} (${cache.job || '-'}) · ไม่พบสกิลกดใช้` : 'ยังไม่ได้เลือกตัวละคร';
      return;
    }

    const selectedSet = new Set(isDamage ? (uiState.localSettings.damageSkills || []) : (uiState.localSettings.priestSkills || []));
    metaEl.textContent = `${cache.charName} (${cache.job || '-'}) · เลือก ${selectedSet.size}/${skills.length} สกิล`;

    boxEl.innerHTML = '';
    for (const sk of skills) {
      const checked = selectedSet.has(sk.id);
      const label = document.createElement('label');
      label.className = `tw-skill-chip ${checked ? (isDamage ? 'tw-checked-damage' : 'tw-checked') : ''}`;
      label.title = `${sk.nameTh || sk.name || sk.id} (Lv.${sk.level || 1} · SP ${sk.sp || 0} · ระยะ ${sk.rangeTiles || '-'} ช่อง)`;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = checked;
      input.addEventListener('change', () => {
        const arr = isDamage ? (uiState.localSettings.damageSkills || []) : (uiState.localSettings.priestSkills || []);
        const set = new Set(arr);
        if (input.checked) set.add(sk.id);
        else set.delete(sk.id);
        if (isDamage) uiState.localSettings.damageSkills = [...set];
        else uiState.localSettings.priestSkills = [...set];
        uiState.dirtySettings = true;
        renderRoleSkillBoxes(role);
        saveSettingsQuiet();
      });
      const text = document.createElement('span');
      text.textContent = `${sk.nameTh || sk.name || sk.id} (Lv.${sk.level || 1})`;
      label.append(input, text);
      boxEl.appendChild(label);
    }

    // For Priest, also render the Out-of-Range Boss Buff delivery skill checkboxes
    if (!isDamage) {
      const buffCandidates = skills.filter(s =>
        ['blessing', 'increase-agi', 'impositio-manus', 'aspersio', 'kyrie-eleison', 'gloria', 'magnificat', 'angelus', 'suffragium'].includes(s.id) ||
        s.target === 'ally' || s.target === 'self'
      );
      const outBuffSet = new Set(uiState.localSettings.priestOutBuffSkills || []);
      dom.priestOutbuffBox.innerHTML = '';
      for (const sk of buffCandidates) {
        if (sk.id === 'resurrection' || sk.id === 'heal') continue;
        const checked = outBuffSet.has(sk.id);
        const label = document.createElement('label');
        label.className = `tw-skill-chip ${checked ? 'tw-checked-buff' : ''}`;
        label.title = `เมื่อตัว Damage บัพ ${sk.nameTh || sk.name} หมดในห้องบอส พระจะเดินโค้งอ้อมบอสไปบัพให้แล้วถอยกลับจุดเริ่ม`;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.addEventListener('change', () => {
          const set = new Set(uiState.localSettings.priestOutBuffSkills || []);
          if (input.checked) set.add(sk.id);
          else set.delete(sk.id);
          uiState.localSettings.priestOutBuffSkills = [...set];
          uiState.dirtySettings = true;
          renderRoleSkillBoxes('priest');
          saveSettingsQuiet();
        });
        const text = document.createElement('span');
        text.textContent = `${sk.nameTh || sk.name || sk.id}`;
        label.append(input, text);
        dom.priestOutbuffBox.appendChild(label);
      }
    }
  }

  function populateRoleSelectors(profiles) {
    mountDom();
    const dmgVal = uiState.localSettings.damageProfileId || '';
    const priVal = uiState.localSettings.priestProfileId || '';

    const buildOptions = (selectedId, placeholder, preferPriest) => {
      const sorted = [...profiles].sort((a, b) => {
        const aJob = a.classId || a.job || '';
        const bJob = b.classId || b.job || '';
        if (preferPriest) {
          const aPri = /priest|acolyte/i.test(aJob) ? 1 : 0;
          const bPri = /priest|acolyte/i.test(bJob) ? 1 : 0;
          if (aPri !== bPri) return bPri - aPri;
        }
        return (Number(b.baseLevel || b.level) || 0) - (Number(a.baseLevel || a.level) || 0);
      });
      let html = `<option value="">${placeholder}</option>`;
      for (const p of sorted) {
        const sel = String(p.id) === String(selectedId) ? 'selected' : '';
        const name = p.charName || p.name || p.id;
        const jobVal = p.classId || p.job || '';
        const job = jobVal ? `[${jobVal}]` : '';
        const lvVal = p.baseLevel || p.level || 0;
        const lv = lvVal ? `Lv.${lvVal}` : '';
        const online = p.online ? '🟢' : '⚫';
        html += `<option value="${p.id}" ${sel}>${online} ${name} ${job} ${lv}</option>`;
      }
      return html;
    };

    if (document.activeElement !== dom.selectDamage) {
      dom.selectDamage.innerHTML = buildOptions(dmgVal, '-- เลือกตัวแบก Damage (หัวหน้าตี้) --', false);
    }
    if (document.activeElement !== dom.selectPriest) {
      dom.selectPriest.innerHTML = buildOptions(priVal, '-- เลือกตัวแบก Priest (พระซัพพอร์ต) --', true);
    }
  }

  function renderKidsTable() {
    mountDom();
    const profiles = (uiState.serverData && Array.isArray(uiState.serverData.clients))
      ? uiState.serverData.clients
      : ((uiState.serverData && Array.isArray(uiState.serverData.profiles)) ? uiState.serverData.profiles : []);
    const rt = (uiState.serverData && (uiState.serverData.state || uiState.serverData.runtime)) || {};
    const activeBatchSet = new Set(Array.isArray(rt.currentBatchKidIds) ? rt.currentBatchKidIds.map(String) : []);
    const selectedSet = new Set(Array.isArray(uiState.localSettings.selectedKidProfileIds) ? uiState.localSettings.selectedKidProfileIds.map(String) : []);
    const dmgId = String(uiState.localSettings.damageProfileId || '');
    const priId = String(uiState.localSettings.priestProfileId || '');

    const kids = profiles.filter(p => String(p.id) !== dmgId && String(p.id) !== priId);
    if (kids.length === 0) {
      dom.kidsTbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:14px;">ไม่มีตัวละครอื่นนอกเหนือจากตัวแบก Damage / Priest</td></tr>`;
      return;
    }

    dom.kidsTbody.innerHTML = '';
    for (const p of kids) {
      const tr = document.createElement('tr');
      const runsPerWeek = Number(p.runsPerWeek) || 3;
      const runsLeft = typeof p.runsLeft === 'number' ? p.runsLeft : null;
      const inCurrentBatch = activeBatchSet.has(String(p.id));
      const checked = selectedSet.has(String(p.id));

      const quotaHtml = runsLeft === null
        ? `<span class="tw-quota-pill tw-quota-zero">รอสแกน</span>`
        : runsLeft > 0
          ? `<span class="tw-quota-pill tw-quota-ok">${runsLeft}/${runsPerWeek} รอบ</span>`
          : `<span class="tw-quota-pill tw-quota-zero">0/${runsPerWeek} ครบแล้ว</span>`;

      const checkpointText = p.checkpoint ? `ชั้น ${p.checkpoint}` : 'ชั้น 1';
      const statusHtml = inCurrentBatch
        ? `<span style="color:#34d399;font-weight:700;">🏰 กำลังลงชุดนี้</span>`
        : p.online
          ? `<span style="color:#7dd3fc;">🟢 ออนไลน์ (${p.mapName || '-'})</span>`
          : `<span style="color:#64748b;">⚫ ออฟไลน์</span>`;

      tr.innerHTML = `
        <td><input type="checkbox" class="tw-kid-chk" data-id="${p.id}" ${checked ? 'checked' : ''} style="accent-color:#10b981;cursor:pointer;"></td>
        <td style="font-weight:700;color:#f8fafc;">${p.charName || p.name || p.id}</td>
        <td>${p.classId || p.job || '-'} <span style="color:#fde047;">Lv.${p.baseLevel || p.level || '-'}</span></td>
        <td>${quotaHtml}</td>
        <td>${checkpointText}</td>
        <td>${statusHtml}</td>
      `;

      const chk = tr.querySelector('.tw-kid-chk');
      chk.addEventListener('change', () => {
        const set = new Set((uiState.localSettings.selectedKidProfileIds || []).map(String));
        if (chk.checked) set.add(String(p.id));
        else set.delete(String(p.id));
        uiState.localSettings.selectedKidProfileIds = [...set];
        uiState.dirtySettings = true;
        saveSettingsQuiet();
      });

      dom.kidsTbody.appendChild(tr);
    }
  }

  function applyServerData(data) {
    if (!data) return;
    mountDom();
    uiState.serverData = data;

    if (!uiState.dirtySettings && data.settings) {
      uiState.localSettings = {
        ...uiState.localSettings,
        ...data.settings
      };
      const tf = Math.max(1, Math.min(100, Math.floor(Number(uiState.localSettings.targetFloor) || 60)));
      if (dom.inputTargetFloor && document.activeElement !== dom.inputTargetFloor) {
        dom.inputTargetFloor.value = String(tf);
      }
      if (dom.selectTargetFloor && document.activeElement !== dom.selectTargetFloor) {
        const hasOption = Array.from(dom.selectTargetFloor.options).some(o => o.value === String(tf));
        dom.selectTargetFloor.value = hasOption ? String(tf) : 'custom';
      }
      dom.selectPriestMode.value = uiState.localSettings.priestProfileMode || 'safe_anchor_12';
      dom.selectKidMode.value = uiState.localSettings.kidMode === 'stand_still' ? 'stand_still' : 'auto_until_boss';
      const resetOn = uiState.localSettings.autoResetBeforeEnter !== false;
      if (dom.chkAutoReset) dom.chkAutoReset.checked = resetOn;
      if (dom.resetModeHint) {
        dom.resetModeHint.textContent = resetOn
          ? '✅ เปิดอยู่: เมื่อกลับเมืองออกมาจะทำการกดปุ่ม "รีเซ็ตเริ่มชั้น 1" ก่อนเข้าไปใหม่'
          : '⏭️ ปิดอยู่: เมื่อกลับเมืองออกมาจะเข้าไปหอคอยใหม่ทันที โดยไม่ต้องกดปุ่มรีเซ็ต';
        dom.resetModeHint.style.color = resetOn ? '#e2e8f0' : '#fde68a';
      }
      dom.chkAutoNextBatch.checked = uiState.localSettings.autoNextBatch !== false;
      dom.chkResumeBot.checked = uiState.localSettings.resumeFarmAfterFinish !== false;
    }

    // Hydrate cached role skills from server if present
    if (data.roleSkillsCache) {
      const dId = uiState.localSettings.damageProfileId;
      if (dId && data.roleSkillsCache[dId] && uiState.roleSkillsCache.damage.profileId !== dId) {
        const c = data.roleSkillsCache[dId];
        uiState.roleSkillsCache.damage = { profileId: dId, charName: c.charName || '', job: c.classId || '', skills: c.skills || [] };
        renderRoleSkillBoxes('damage');
      }
      const pId = uiState.localSettings.priestProfileId;
      if (pId && data.roleSkillsCache[pId] && uiState.roleSkillsCache.priest.profileId !== pId) {
        const c = data.roleSkillsCache[pId];
        uiState.roleSkillsCache.priest = { profileId: pId, charName: c.charName || '', job: c.classId || '', skills: c.skills || [] };
        renderRoleSkillBoxes('priest');
      }
    }

    const profiles = Array.isArray(data.clients) ? data.clients : (Array.isArray(data.profiles) ? data.profiles : []);
    populateRoleSelectors(profiles);
    renderKidsTable();

    // Auto-fetch live character skills if Damage or Priest is selected and not yet cached
    const dmgId = uiState.localSettings.damageProfileId;
    if (dmgId && uiState.roleSkillsCache.damage.profileId !== dmgId && !uiState.loadingSkills.damage) {
      uiState.loadingSkills.damage = true;
      loadRoleSkills('damage', dmgId, false).finally(() => { uiState.loadingSkills.damage = false; });
    }
    const priId = uiState.localSettings.priestProfileId;
    if (priId && uiState.roleSkillsCache.priest.profileId !== priId && !uiState.loadingSkills.priest) {
      uiState.loadingSkills.priest = true;
      loadRoleSkills('priest', priId, false).finally(() => { uiState.loadingSkills.priest = false; });
    }

    // Update Runtime Status & Launcher Badge
    const rt = data.state || data.runtime || {};
    const running = Boolean(rt.running);
    dom.launcher.classList.toggle('tw-running', running);
    dom.statusBanner.classList.toggle('tw-active', running);

    const tfVal = Math.max(1, Math.min(100, Math.floor(Number(uiState.localSettings.targetFloor) || 60)));
    const isQuotaMode = (uiState.localSettings.autoNextBatch !== false) && tfVal >= 10;
    const resetOnNow = uiState.localSettings.autoResetBeforeEnter !== false;

    if (running) {
      const floorTxt = rt.currentFloor > 0 ? `ชั้น ${rt.currentFloor}/${tfVal}` : 'กำลังเตรียมตี้';
      const roundBadge = isQuotaMode ? `รอบ ${rt.roundInBatch || 1}/3` : `รอบที่ ${rt.roundInBatch || 1}`;
      dom.launcherChip.textContent = `🟢 ${floorTxt} · ${roundBadge}`;
      dom.headerBadge.textContent = `กำลังทำงาน · ${floorTxt}`;
      dom.statusPhase.textContent = `🏰 กำลังทำงาน (${rt.phase || 'ACTIVE'})`;
      dom.statusPhase.style.color = '#6ee7b7';
      dom.btnStartStop.textContent = '⏹️ หยุดระบบแบกหอคอย';
      dom.btnStartStop.style.background = 'linear-gradient(135deg,#dc2626,#ef4444)';
      dom.btnStartStop.style.borderColor = '#f87171';
      dom.btnStartStop.style.color = '#fff';
    } else {
      dom.launcherChip.textContent = `พร้อมทำงาน (ชั้น ${tfVal === 9 ? '1-9' : tfVal})`;
      dom.headerBadge.textContent = 'สถานะ: พร้อมทำงาน';
      dom.statusPhase.textContent = '⏸️ ระบบหยุดอยู่ (พร้อมเริ่มงาน)';
      dom.statusPhase.style.color = '#fde047';
      dom.btnStartStop.textContent = '🚀 เริ่มระบบแบกหอคอย';
      dom.btnStartStop.style.background = 'linear-gradient(135deg,#059669,#10b981)';
      dom.btnStartStop.style.borderColor = '#34d399';
      dom.btnStartStop.style.color = '#022c22';
    }

    dom.statusDetail.textContent = rt.statusText || rt.stepText || 'พร้อมทำงาน';
    dom.statFloor.textContent = rt.currentFloor > 0 ? `ชั้น ${rt.currentFloor}` : '-';
    dom.statTarget.textContent = tfVal === 9 ? 'ชั้น 1-9 (วนกลับเมือง)' : `ชั้น ${tfVal}`;
    if (dom.statResetMode) {
      dom.statResetMode.textContent = resetOnNow ? 'เปิด (กดรีเซ็ต)' : 'ปิด (เข้าทันที)';
      dom.statResetMode.style.color = resetOnNow ? '#34d399' : '#facc15';
    }
    dom.statRound.textContent = isQuotaMode ? `${rt.roundInBatch || 0} / 3` : `รอบที่ ${rt.roundInBatch || 0} (วนต่อเนื่อง)`;

    const priestClient = profiles.find(c => String(c.id) === String(uiState.localSettings.priestProfileId));
    dom.statPriestAi.textContent = (priestClient && priestClient.priestActionText) || 'รอเข้าหอคอย (ระยะ 12 ช่อง)';

    // Render logs
    const logs = Array.isArray(rt.logs) ? rt.logs : [];
    if (logs.length === 0) {
      dom.logsBox.innerHTML = `<div style="color:#64748b;">ยังไม่มีประวัติการทำงาน</div>`;
    } else {
      dom.logsBox.innerHTML = logs.slice(0, 35).map(item => {
        const tsVal = item.at || item.ts;
        const t = tsVal ? new Date(tsVal).toLocaleTimeString('th-TH', { hour12: false }) : '';
        return `<div><span style="color:#64748b;">[${t}]</span> ${escapeHtml(item.text || '')}</div>`;
      }).join('');
    }
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function fetchTowerStatus() {
    if (uiState.loading) return;
    uiState.loading = true;
    try {
      const res = await fetch('/api/tower');
      const data = await res.json();
      if (data && data.ok !== false) {
        applyServerData(data);
      }
    } catch (_) {}
    uiState.loading = false;
  }

  function init() {
    mountDom();
    fetchTowerStatus();
    if (uiState.pollTimer) clearInterval(uiState.pollTimer);
    uiState.pollTimer = setInterval(() => {
      // Poll faster when drawer is open or tower carry is actively running
      const isRunning = Boolean(uiState.serverData && uiState.serverData.state && uiState.serverData.state.running);
      if (uiState.isOpen || isRunning) {
        fetchTowerStatus();
      }
    }, POLL_INTERVAL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
