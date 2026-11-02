// manager/public/market_sniper.js — Hidden Moneybag Trigger & Market Sniper / Auto-Flip Control Modal
(function () {
  'use strict';

  let sniperStatus = null;
  let pollTimer = null;
  let isModalOpen = false;
  let activeSubTab = 'active'; // 'active' | 'history' | 'screens'

  function fmtZeny(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('en-US') + ' z';
  }

  function fmtTimeAgo(ts) {
    if (!ts) return '-';
    const sec = Math.max(0, Math.floor((Date.now() - Number(ts)) / 1000));
    if (sec < 5) return 'เมื่อสักครู่';
    if (sec < 60) return `${sec} วินาทีที่แล้ว`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} นาทีที่แล้ว`;
    const hr = Math.floor(min / 60);
    return `${hr} ชม. ${min % 60} นาทีที่แล้ว`;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function injectStyles() {
    if (document.getElementById('market-sniper-styles')) return;
    const style = document.createElement('style');
    style.id = 'market-sniper-styles';
    style.textContent = `
      #btn-secret-market-sniper {
        cursor: pointer;
        position: relative;
        user-select: none;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      }
      #btn-secret-market-sniper:hover {
        transform: scale(1.06);
      }
      #btn-secret-market-sniper:active {
        transform: scale(0.96);
      }
      .ms-secret-dot {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #10b981;
        box-shadow: 0 0 8px #10b981;
        display: none;
        pointer-events: none;
      }
      .ms-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(2, 6, 23, 0.86);
        z-index: 10080;
        display: none;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(6px);
        padding: 14px;
      }
      .ms-modal-card {
        width: 100%;
        max-width: 1120px;
        max-height: 92vh;
        background: linear-gradient(155deg, #0b1120 0%, #131c31 100%);
        border: 1px solid rgba(250, 204, 21, 0.38);
        border-radius: 16px;
        box-shadow: 0 25px 70px rgba(0, 0, 0, 0.85), 0 0 35px rgba(234, 179, 8, 0.12);
        color: #f8fafc;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .ms-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 20px;
        background: rgba(15, 23, 42, 0.92);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        gap: 12px;
        flex-wrap: wrap;
      }
      .ms-body {
        padding: 16px 20px;
        overflow-y: auto;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .ms-kpi-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 10px;
      }
      .ms-kpi-card {
        background: rgba(15, 23, 42, 0.78);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        padding: 10px 14px;
      }
      .ms-kpi-label {
        font-size: 11px;
        color: #94a3b8;
        margin-bottom: 4px;
      }
      .ms-kpi-val {
        font-size: 16px;
        font-weight: 800;
        color: #f8fafc;
      }
      .ms-kpi-sub {
        font-size: 11px;
        color: #64748b;
        margin-top: 3px;
      }
      .ms-panel {
        background: rgba(15, 23, 42, 0.65);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 14px;
      }
      .ms-panel-title {
        font-size: 13px;
        font-weight: 700;
        color: #fde047;
        margin: 0 0 10px 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .ms-cat-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 12px;
      }
      .ms-cat-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 11px;
        border-radius: 8px;
        background: rgba(30, 41, 59, 0.75);
        border: 1px solid rgba(148, 163, 184, 0.25);
        font-size: 12px;
        color: #e2e8f0;
        cursor: pointer;
        user-select: none;
        transition: all 0.15s ease;
      }
      .ms-cat-chip input:checked + span {
        color: #fde047;
        font-weight: 700;
      }
      .ms-cat-chip:has(input:checked) {
        background: rgba(234, 179, 8, 0.16);
        border-color: rgba(250, 204, 21, 0.55);
      }
      .ms-inputs-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(195px, 1fr));
        gap: 10px;
      }
      .ms-field label {
        display: block;
        font-size: 11px;
        color: #cbd5e1;
        margin-bottom: 4px;
        font-weight: 600;
      }
      .ms-field input, .ms-field select {
        width: 100%;
        background: #090d16;
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 7px;
        color: #f8fafc;
        font-size: 12px;
        padding: 6px 10px;
        outline: none;
        box-sizing: border-box;
      }
      .ms-field input:focus, .ms-field select:focus {
        border-color: #facc15;
      }
      .ms-table-wrap {
        overflow-x: auto;
        max-height: 320px;
        overflow-y: auto;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 9px;
        background: rgba(9, 13, 22, 0.7);
      }
      .ms-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      .ms-table th {
        position: sticky;
        top: 0;
        background: #0f172a;
        color: #94a3b8;
        text-align: left;
        padding: 8px 10px;
        font-size: 11px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        white-space: nowrap;
      }
      .ms-table td {
        padding: 8px 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        vertical-align: middle;
      }
      .ms-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 10.5px;
        font-weight: 700;
        white-space: nowrap;
      }
      .ms-badge.leading { background: rgba(56, 189, 248, 0.18); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); }
      .ms-badge.relisted { background: rgba(16, 185, 129, 0.18); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.45); }
      .ms-badge.won, .ms-badge.bought { background: rgba(250, 204, 21, 0.18); color: #fde047; border: 1px solid rgba(250, 204, 21, 0.45); }
      .ms-badge.stopped { background: rgba(239, 68, 68, 0.16); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.4); }
      .ms-badge.dry { background: rgba(168, 85, 247, 0.18); color: #d8b4fe; border: 1px solid rgba(168, 85, 247, 0.4); }
      .ms-subtabs {
        display: flex;
        gap: 6px;
      }
      .ms-subtab-btn {
        background: rgba(30, 41, 59, 0.7);
        border: 1px solid rgba(148, 163, 184, 0.25);
        color: #cbd5e1;
        padding: 5px 12px;
        border-radius: 7px;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .ms-subtab-btn.active {
        background: rgba(234, 179, 8, 0.2);
        border-color: rgba(250, 204, 21, 0.55);
        color: #fde047;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureModalDom() {
    if (document.getElementById('modal-market-sniper')) return;
    const overlay = document.createElement('div');
    overlay.id = 'modal-market-sniper';
    overlay.className = 'ms-modal-overlay';
    overlay.innerHTML = `
      <div class="ms-modal-card" role="dialog" aria-label="Market Sniper & Auto-Flip">
        <div class="ms-header">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 42px; height: 42px; border-radius: 11px; background: linear-gradient(135deg, rgba(234, 179, 8, 0.25), rgba(16, 185, 129, 0.18)); border: 1px solid rgba(250, 204, 21, 0.5); display: flex; align-items: center; justify-content: center; font-size: 22px;">
              💰
            </div>
            <div>
              <h3 style="margin: 0; font-size: 16px; font-weight: 800; color: #f8fafc; display: flex; align-items: center; gap: 8px;">
                <span>ระบบช้อนตลาดกลาง & เก็งกำไรอัตโนมัติ (Market Sniper & Auto-Flip)</span>
                <span id="ms-header-state-pill" class="ms-badge stopped">ปิดอยู่</span>
              </h3>
              <div style="font-size: 11.5px; color: #94a3b8; margin-top: 2px;">
                ศูนย์กลางประมูล/ซื้อด้วยจอที่เงินเยอะสุด (ไม่แย่งกันเอง) · รับเงินคืนอัตโนมัติเมื่อโดนปาด · ตั้งขายกลับที่ราคาขายออกจริง (ข้ามราคาหลอก/ราคา Belt)
              </div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <label style="display: inline-flex; align-items: center; gap: 7px; background: rgba(16, 185, 129, 0.14); border: 1px solid rgba(52, 211, 153, 0.45); padding: 6px 12px; border-radius: 9px; cursor: pointer; font-size: 12.5px; font-weight: 700; color: #6ee7b7;">
              <input type="checkbox" id="ms-enable-toggle" style="width: 15px; height: 15px; accent-color: #10b981; cursor: pointer;">
              <span>เปิดทำงาน Sniper</span>
            </label>
            <select id="ms-mode-select" style="background: #090d16; border: 1px solid rgba(250, 204, 21, 0.45); color: #fde047; border-radius: 8px; padding: 6px 10px; font-size: 12px; font-weight: 700; outline: none;">
              <option value="auto_flip">🚀 ช้อน + ตั้งขายทำกำไรอัตโนมัติ (Auto-Flip)</option>
              <option value="buy_only">🛒 ช้อนเก็บเข้ากระเป๋าอย่างเดียว (ไม่ตั้งขายกลับ)</option>
              <option value="dry_run">🧪 โหมดจำลอง (Dry-Run สแกนดูโดยไม่ใช้เงินจริง)</option>
            </select>
            <button type="button" id="btn-ms-scan-now" class="btn btn-primary btn-sm" style="padding: 6px 12px; font-size: 12px; font-weight: 700;">
              ⚡ สแกนทันที
            </button>
            <button type="button" id="btn-ms-claim-refunds" class="btn btn-warning btn-sm" style="padding: 6px 12px; font-size: 12px; font-weight: 700;" title="กดรับของและเงินคืนจากการแพ้ประมูลในแท็บรับของทุกจอทันที">
              🎁 รับของ/เงินคืนทุกจอ
            </button>
            <button type="button" id="btn-ms-close" style="background: transparent; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 4px 8px;">✕</button>
          </div>
        </div>

        <div class="ms-body">
          <!-- KPI SUMMARY CARDS -->
          <div class="ms-kpi-grid">
            <div class="ms-kpi-card">
              <div class="ms-kpi-label">👑 จอหลักที่รับหน้าที่ช้อน/ประมูล (รวยสุด)</div>
              <div class="ms-kpi-val" id="ms-kpi-buyer-name" style="color: #fde047;">รอจอออนไลน์...</div>
              <div class="ms-kpi-sub" id="ms-kpi-buyer-sub">เลือกจอที่ Zeny มากสุด + มีโควตาว่างอัตโนมัติ</div>
            </div>
            <div class="ms-kpi-card">
              <div class="ms-kpi-label">🔍 สถานะการสแกนตลาดล่าสุด</div>
              <div class="ms-kpi-val" id="ms-kpi-scan-count" style="color: #38bdf8;">0 รอบ</div>
              <div class="ms-kpi-sub" id="ms-kpi-scan-sub">ยังไม่ได้เริ่มสแกน</div>
            </div>
            <div class="ms-kpi-card">
              <div class="ms-kpi-label">🔨 ประมูล / ช้อนสำเร็จ / ตั้งขายกลับ</div>
              <div class="ms-kpi-val" id="ms-kpi-actions" style="color: #e2e8f0;">0 ประมูล · 0 ได้ของ · 0 ตั้งขาย</div>
              <div class="ms-kpi-sub" id="ms-kpi-refunds">รับเงินคืนเมื่อโดนปาดอัตโนมัติ: 0 ครั้ง</div>
            </div>
            <div class="ms-kpi-card" style="border-color: rgba(16, 185, 129, 0.35); background: linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(15, 23, 42, 0.85));">
              <div class="ms-kpi-label">📈 กำไรสุทธิคาดการณ์รวม (หักภาษี 4% แล้ว)</div>
              <div class="ms-kpi-val" id="ms-kpi-profit" style="color: #34d399;">+0 z</div>
              <div class="ms-kpi-sub">คำนวณจากส่วนต่างราคาช้อนกับราคาตั้งขายกลับจริง</div>
            </div>
          </div>

          <!-- CONFIGURATION PANEL -->
          <div class="ms-panel">
            <div class="ms-panel-title">
              <span>⚙️ ตั้งค่าหมวดหมู่ไอเทมเป้าหมาย & เกณฑ์ทำกำไร (ป้องกันของปั่นราคา / ราคา Belt)</span>
              <button type="button" id="btn-ms-save-config" class="btn btn-success btn-sm" style="padding: 5px 14px; font-size: 12px; font-weight: 700;">
                💾 บันทึกการตั้งค่า
              </button>
            </div>

            <div style="font-size: 11px; color: #94a3b8; margin-bottom: 6px;">
              เลือกหมวดหมู่ที่ให้บอทกวาดสแกนจากหน้า <b>ลงขายล่าสุด (Newest)</b> และ <b>ราคาถูกสุด (Price Asc)</b>:
            </div>
            <div class="ms-cat-grid">
              <label class="ms-cat-chip"><input type="checkbox" data-ms-cat="stone"><span>💎 ศิลาสกิล (Stone — กำไร 10M+ แนะนำ!)</span></label>
              <label class="ms-cat-chip"><input type="checkbox" data-ms-cat="refine"><span>🔨 แร่/รูนตีบวก (Refine — คนใส่ราคารวมผิดบ่อย)</span></label>
              <label class="ms-cat-chip"><input type="checkbox" data-ms-cat="card"><span>🃏 การ์ด (Card)</span></label>
              <label class="ms-cat-chip"><input type="checkbox" data-ms-cat="craft"><span>⚒️ วัสดุคราฟต์ (Craft)</span></label>
              <label class="ms-cat-chip"><input type="checkbox" data-ms-cat="material"><span>📦 วัตถุดิบ (Material)</span></label>
              <label class="ms-cat-chip"><input type="checkbox" data-ms-cat="usable"><span>🧪 ของใช้/กล่องสุ่ม (Usable)</span></label>
              <label class="ms-cat-chip"><input type="checkbox" data-ms-cat="accessory"><span>💍 ประดับ/เจม (Accessory/Gem)</span></label>
              <label class="ms-cat-chip" title="ระวัง: อาวุธมีราคาต่างกันตาม Option สุ่ม"><input type="checkbox" data-ms-cat="weapon"><span>⚔️ อาวุธ (Weapon)</span></label>
              <label class="ms-cat-chip" title="ระวัง: ชุดเกราะมีราคาต่างกันตาม Option สุ่ม"><input type="checkbox" data-ms-cat="armor"><span>🛡️ ชุดเกราะ (Armor)</span></label>
            </div>

            <div class="ms-inputs-grid">
              <div class="ms-field">
                <label title="เช่น ตั้งไว้ 60% = ของราคาขายจริง 14M จะซื้อทันทีเมื่อตั้งขายไม่เกิน 8.4M (ถ้าคนตั้งผิด 1.4M คือ 10% ช้อนทันที!)">⚡ ซื้อขาดเมื่อราคา ≤ (% ของราคาจริง)</label>
                <input type="number" id="ms-inp-buy-ratio" min="5" max="90" value="60">
              </div>
              <div class="ms-field">
                <label title="เพดานประมูลสู้สูงสุดในช่วง 5 นาทีแรก เช่น 65% ของราคาขายจริง ถ้าคู่แข่งบิดเกินนี้บอทจะหยุดและรับเงินคืน">🔨 เพดานประมูลสู้สูงสุด ≤ (% ราคาจริง)</label>
                <input type="number" id="ms-inp-bid-ratio" min="5" max="90" value="65">
              </div>
              <div class="ms-field">
                <label title="กำไรสุทธิหลังหักภาษีตลาด 4% แล้ว ต้องได้ไม่ต่ำกว่าจำนวนนี้จึงจะเข้าช้อน">💰 กำไรสุทธิขั้นต่ำต่อรายการ (Zeny)</label>
                <input type="number" id="ms-inp-min-profit-zeny" min="1000" step="50000" value="200000">
              </div>
              <div class="ms-field">
                <label title="กำไรสุทธิขั้นต่ำคิดเป็น % เทียบกับทุนที่ใช้ซื้อ">📈 กำไรสุทธิขั้นต่ำ (%)</label>
                <input type="number" id="ms-inp-min-profit-pct" min="5" max="500" value="25">
              </div>
              <div class="ms-field">
                <label title="ป้องกันการช้อนของขยะที่มีคนตั้งราคาปั่นหลอก: ต้องมีประวัติขายออกจริงใน 7 วันอย่างน้อยกี่ครั้ง">🛡️ ขายออกขั้นต่ำใน 7 วัน (ครั้ง)</label>
                <input type="number" id="ms-inp-min-volume" min="1" max="100" value="3">
              </div>
              <div class="ms-field">
                <label title="จำกัดงบสูงสุดต่อการช้อน 1 รายการ เพื่อกระจายความเสี่ยง">🏦 งบสูงสุดต่อ 1 รายการ (Zeny)</label>
                <input type="number" id="ms-inp-max-spend" min="10000" step="1000000" value="35000000">
              </div>
              <div class="ms-field">
                <label title="เงินขั้นต่ำที่ต้องเหลือติดตัวจอที่ซื้อ (ไม่เอาไปประมูลจนหมดตัว)">🔒 เงินสำรองเหลือติดตัว (Zeny)</label>
                <input type="number" id="ms-inp-min-reserve" min="0" step="100000" value="1000000">
              </div>
              <div class="ms-field">
                <label title="0 = ตั้งขายเท่าราคามาตรฐานที่ขายออกจริง (เช่น 14,000,000 z) / 1 = ตั้งตัดหน้าราคาปกติ 1 z">🏷️ การตั้งราคาขายกลับ (Undercut z)</label>
                <input type="number" id="ms-inp-undercut" min="0" max="1000000" value="0">
              </div>
              <div class="ms-field">
                <label>⏱️ ความถี่สแกนตลาด (วินาที)</label>
                <input type="number" id="ms-inp-scan-interval" min="2" max="60" value="4">
              </div>
              <div class="ms-field">
                <label>⏳ ระยะเวลาตั้งขายกลับ</label>
                <select id="ms-inp-relist-hours">
                  <option value="12">12 ชั่วโมง</option>
                  <option value="24" selected>24 ชั่วโมง</option>
                  <option value="48">48 ชั่วโมง</option>
                </select>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px;">
              <div class="ms-field">
                <label>🎯 ชื่อไอเทมที่เฝ้าดูเป็นพิเศษ (คั่นด้วย , — เว้นว่างได้ ระบบสแกนตามหมวดให้อัตโนมัติ)</label>
                <input type="text" id="ms-inp-watchlist" placeholder="เช่น Tremor Stone, Spell Echo Stone, Aftershock Stone">
              </div>
              <div class="ms-field">
                <label>🚫 รายชื่อไอเทมที่ห้ามช้อนเด็ดขาด (Blacklist คั่นด้วย ,)</label>
                <input type="text" id="ms-inp-blacklist" placeholder="เช่น Arrow, Red Potion, Fly Wing">
              </div>
            </div>
          </div>

          <!-- LIVE FEED & TABLES -->
          <div class="ms-panel" style="flex: 1; display: flex; flex-direction: column; min-height: 240px;">
            <div class="ms-panel-title">
              <div class="ms-subtabs">
                <button type="button" class="ms-subtab-btn active" data-ms-tab="active">
                  🔨 รายการประมูล & ช้อนล่าสุด (<span id="ms-count-active">0</span>)
                </button>
                <button type="button" class="ms-subtab-btn" data-ms-tab="history">
                  📜 ประวัติการช้อน & ตั้งขายทำกำไร (<span id="ms-count-history">0</span>)
                </button>
                <button type="button" class="ms-subtab-btn" data-ms-tab="screens">
                  🖥️ ลำดับจอพร้อมช้อนตามเงิน Zeny (<span id="ms-count-screens">0</span>)
                </button>
              </div>
              <button type="button" id="btn-ms-clear-history" class="btn btn-ghost btn-sm" style="font-size: 11px; color: #94a3b8;">
                🗑️ ล้างประวัติแสดงผล
              </button>
            </div>

            <div class="ms-table-wrap" id="ms-table-container">
              <!-- Populated by renderTables() -->
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Wire events
    document.getElementById('btn-ms-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    document.getElementById('ms-enable-toggle').addEventListener('change', async () => {
      await saveCurrentConfigFromUi();
    });
    document.getElementById('ms-mode-select').addEventListener('change', async () => {
      await saveCurrentConfigFromUi();
    });
    document.getElementById('btn-ms-save-config').addEventListener('click', async () => {
      await saveCurrentConfigFromUi(true);
    });
    document.getElementById('btn-ms-scan-now').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const oldTxt = btn.innerText;
      btn.disabled = true;
      btn.innerText = '⏳ กำลังสแกน...';
      try {
        await fetch('/api/market-sniper/scan-now', { method: 'POST' });
        await fetchStatus(true);
      } catch (_) {}
      btn.disabled = false;
      btn.innerText = oldTxt;
    });
    document.getElementById('btn-ms-claim-refunds').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const oldTxt = btn.innerText;
      btn.disabled = true;
      btn.innerText = '⏳ กำลังกดรับทุกจอ...';
      try {
        await fetch('/api/market-sniper/claim-all-refunds', { method: 'POST' });
        await fetchStatus(true);
      } catch (_) {}
      btn.disabled = false;
      btn.innerText = oldTxt;
    });
    document.getElementById('btn-ms-clear-history').addEventListener('click', async () => {
      try {
        await fetch('/api/market-sniper/clear-history', { method: 'POST' });
        await fetchStatus(true);
      } catch (_) {}
    });

    overlay.querySelectorAll('.ms-subtab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeSubTab = btn.getAttribute('data-ms-tab') || 'active';
        overlay.querySelectorAll('.ms-subtab-btn').forEach(b => b.classList.toggle('active', b === btn));
        renderTables();
      });
    });
  }

  function readConfigFromUi() {
    const categories = {};
    document.querySelectorAll('#modal-market-sniper [data-ms-cat]').forEach(cb => {
      categories[cb.getAttribute('data-ms-cat')] = Boolean(cb.checked);
    });
    return {
      enabled: Boolean(document.getElementById('ms-enable-toggle')?.checked),
      mode: document.getElementById('ms-mode-select')?.value || 'auto_flip',
      categories,
      maxBuyRatioPercent: Number(document.getElementById('ms-inp-buy-ratio')?.value) || 60,
      maxBidRatioPercent: Number(document.getElementById('ms-inp-bid-ratio')?.value) || 65,
      minNetProfitZeny: Number(document.getElementById('ms-inp-min-profit-zeny')?.value) || 200000,
      minNetProfitPercent: Number(document.getElementById('ms-inp-min-profit-pct')?.value) || 25,
      minSalesVolume: Number(document.getElementById('ms-inp-min-volume')?.value) || 3,
      maxSpendPerListing: Number(document.getElementById('ms-inp-max-spend')?.value) || 35000000,
      minReserveZeny: Number(document.getElementById('ms-inp-min-reserve')?.value) || 0,
      relistUndercutZeny: Number(document.getElementById('ms-inp-undercut')?.value) || 0,
      scanIntervalSec: Number(document.getElementById('ms-inp-scan-interval')?.value) || 4,
      relistDurationHours: Number(document.getElementById('ms-inp-relist-hours')?.value) || 24,
      customWatchlist: document.getElementById('ms-inp-watchlist')?.value || '',
      blacklistItems: document.getElementById('ms-inp-blacklist')?.value || ''
    };
  }

  function populateConfigToUi(cfg) {
    if (!cfg) return;
    const en = document.getElementById('ms-enable-toggle');
    if (en) en.checked = Boolean(cfg.enabled);
    const modeSel = document.getElementById('ms-mode-select');
    if (modeSel && cfg.mode) modeSel.value = cfg.mode;

    const cats = cfg.categories || {};
    document.querySelectorAll('#modal-market-sniper [data-ms-cat]').forEach(cb => {
      const k = cb.getAttribute('data-ms-cat');
      cb.checked = Boolean(cats[k]);
    });

    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el && document.activeElement !== el && v !== undefined && v !== null) {
        el.value = String(v);
      }
    };
    setVal('ms-inp-buy-ratio', cfg.maxBuyRatioPercent);
    setVal('ms-inp-bid-ratio', cfg.maxBidRatioPercent);
    setVal('ms-inp-min-profit-zeny', cfg.minNetProfitZeny);
    setVal('ms-inp-min-profit-pct', cfg.minNetProfitPercent);
    setVal('ms-inp-min-volume', cfg.minSalesVolume);
    setVal('ms-inp-max-spend', cfg.maxSpendPerListing);
    setVal('ms-inp-min-reserve', cfg.minReserveZeny);
    setVal('ms-inp-undercut', cfg.relistUndercutZeny);
    setVal('ms-inp-scan-interval', cfg.scanIntervalSec);
    setVal('ms-inp-relist-hours', cfg.relistDurationHours);
    setVal('ms-inp-watchlist', cfg.customWatchlist ?? '');
    setVal('ms-inp-blacklist', cfg.blacklistItems ?? '');
  }

  async function saveCurrentConfigFromUi(showBtnFeedback = false) {
    const payload = readConfigFromUi();
    const saveBtn = document.getElementById('btn-ms-save-config');
    try {
      const res = await fetch('/api/market-sniper/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data && data.success && data.config) {
        if (!sniperStatus) sniperStatus = {};
        sniperStatus.config = data.config;
        updateSecretDotAndHeader();
      }
      if (showBtnFeedback && saveBtn) {
        const orig = saveBtn.innerText;
        saveBtn.innerText = '✅ บันทึกแล้ว!';
        setTimeout(() => { saveBtn.innerText = orig; }, 1400);
      }
    } catch (_) {}
  }

  function updateSecretDotAndHeader() {
    const enabled = Boolean(sniperStatus && sniperStatus.config && sniperStatus.config.enabled);
    document.querySelectorAll('.ms-secret-dot').forEach(dot => {
      dot.style.display = enabled ? 'block' : 'none';
    });
    const pill = document.getElementById('ms-header-state-pill');
    if (pill) {
      const mode = sniperStatus?.config?.mode || 'auto_flip';
      const pausedFull = Boolean(sniperStatus?.pausedAllScreensFull || sniperStatus?.lastScan?.pausedAllScreensFull);
      if (!enabled) {
        pill.className = 'ms-badge stopped';
        pill.innerText = 'ปิดอยู่';
      } else if (mode === 'dry_run') {
        pill.className = 'ms-badge dry';
        pill.innerText = '🧪 กำลังสแกน (โหมดจำลอง)';
      } else if (pausedFull) {
        pill.className = 'ms-badge won';
        pill.innerText = '⏸️ ช่องขายเต็มทุกจอ (รอของขายออก)';
      } else {
        pill.className = 'ms-badge relisted';
        pill.innerText = '🟢 กำลังทำงานอัตโนมัติ';
      }
    }
  }

  function renderStatusSummary() {
    if (!sniperStatus) return;
    updateSecretDotAndHeader();

    const screens = Array.isArray(sniperStatus.onlineScreens) ? sniperStatus.onlineScreens : [];
    const primary = screens.find(s => s.isPrimaryBuyer) || null;
    const pausedFull = Boolean(sniperStatus?.pausedAllScreensFull || sniperStatus?.lastScan?.pausedAllScreensFull);
    const buyerNameEl = document.getElementById('ms-kpi-buyer-name');
    const buyerSubEl = document.getElementById('ms-kpi-buyer-sub');
    if (buyerNameEl && buyerSubEl) {
      if (pausedFull && screens.length > 0) {
        buyerNameEl.innerText = '⏸️ ช่องขายเต็มทุกจอ — รอขายออก';
        buyerSubEl.innerText = `ของทำกำไรเต็มโควตาทุกจอที่มีงบแล้ว · ระบบจะช้อนต่ออัตโนมัติเมื่อมีช่องว่าง`;
      } else if (primary) {
        const evictHint = (Number(primary.evictableCheapCount) || 0) > 0 ? ` (ถอดของ ≤50k ได้ ${primary.evictableCheapCount} ช่อง)` : '';
        buyerNameEl.innerText = `${primary.charName || primary.profileName} (${fmtZeny(primary.zeny)})`;
        buyerSubEl.innerText = `${primary.premium ? '👑 Premium (ภาษี 4%)' : 'ภาษีปกติ 8%'} · โควตาขาย ${primary.activeCount}/${primary.maxListings}${evictHint} · ออนไลน์ ${screens.length} จอ`;
      } else if (screens[0]) {
        const top = screens[0];
        buyerNameEl.innerText = `${top.charName || top.profileName} (${fmtZeny(top.zeny)})`;
        buyerSubEl.innerText = `${top.premium ? '👑 Premium (ภาษี 4%)' : 'ภาษีปกติ 8%'} · โควตาขาย ${top.activeCount}/${top.maxListings} · ออนไลน์รวม ${screens.length} จอ`;
      } else {
        buyerNameEl.innerText = 'ไม่มีจอออนไลน์ที่พร้อมซื้อ';
        buyerSubEl.innerText = 'เปิดจอเกมอย่างน้อย 1 จอเพื่อให้ระบบเริ่มสแกน';
      }
    }

    const st = sniperStatus.stats || {};
    const ls = sniperStatus.lastScan || {};
    const scanCountEl = document.getElementById('ms-kpi-scan-count');
    const scanSubEl = document.getElementById('ms-kpi-scan-sub');
    if (scanCountEl && scanSubEl) {
      scanCountEl.innerText = `${(Number(st.totalScans) || 0).toLocaleString()} รอบ · แคชราคา ${sniperStatus.cachedItemsCount || 0} ชิ้น`;
      scanSubEl.innerText = ls.at
        ? `ล่าสุด: ${ls.filterLabel || '-'} โดย ${ls.scannerName || '-'} (${fmtTimeAgo(ls.at)})`
        : 'รอสแกนรอบแรก...';
    }

    const actEl = document.getElementById('ms-kpi-actions');
    const refEl = document.getElementById('ms-kpi-refunds');
    if (actEl && refEl) {
      actEl.innerText = `${Number(st.totalBidsPlaced) || 0} ประมูล · ${Number(st.totalWonOrBought) || 0} ได้ของ · ${Number(st.totalRelisted) || 0} ตั้งขาย`;
      refEl.innerText = `พบของเข้าเกณฑ์: ${Number(st.totalOpportunitiesFound) || 0} รายการ · กดรับเงินคืนประมูล: ${Number(st.totalRefundedCount) || 0} ครั้ง`;
    }

    const profEl = document.getElementById('ms-kpi-profit');
    if (profEl) {
      profEl.innerText = `+${fmtZeny(st.totalEstimatedNetProfit || 0)}`;
    }

    const cActive = document.getElementById('ms-count-active');
    if (cActive) cActive.innerText = String((sniperStatus.activeBids || []).length);
    const cHist = document.getElementById('ms-count-history');
    if (cHist) cHist.innerText = String((sniperStatus.history || []).length);
    const cScr = document.getElementById('ms-count-screens');
    if (cScr) cScr.innerText = String(screens.length);

    renderTables();
  }

  function renderStatusBadgeHtml(status) {
    if (status === 'leading') return '<span class="ms-badge leading">🔨 ประมูลนำอยู่</span>';
    if (status === 'relisted') return '<span class="ms-badge relisted">🏷️ ตั้งขายทำกำไรแล้ว</span>';
    if (status === 'won') return '<span class="ms-badge won">🏆 ชนะประมูล & รับของแล้ว</span>';
    if (status === 'bought') return '<span class="ms-badge bought">⚡ ช้อนซื้อสำเร็จ</span>';
    if (status === 'outbid_stopped') return '<span class="ms-badge stopped">⏹️ เกินเพดาน (รับเงินคืนแล้ว)</span>';
    if (status === 'queued_flip') return '<span class="ms-badge won">⏳ รอช่องว่างตั้งขายกลับ</span>';
    if (status === 'dry_run') return '<span class="ms-badge dry">🧪 โหมดจำลอง (Dry-Run)</span>';
    return `<span class="ms-badge">${escapeHtml(status || '-')}</span>`;
  }

  function renderTables() {
    const box = document.getElementById('ms-table-container');
    if (!box || !sniperStatus) return;

    if (activeSubTab === 'active') {
      const list = sniperStatus.activeBids || [];
      if (!list.length) {
        box.innerHTML = `<div style="padding: 36px 16px; text-align: center; color: #64748b; font-size: 12.5px;">ยังไม่มีรายการที่กำลังประมูลหรือช้อนในขณะนี้ — เปิดสวิตช์ <b>เปิดทำงาน Sniper</b> หรือกดปุ่ม <b>⚡ สแกนทันที</b></div>`;
        return;
      }
      box.innerHTML = `
        <table class="ms-table">
          <thead>
            <tr>
              <th>ไอเทม</th>
              <th>ราคาที่ช้อน / ประมูล</th>
              <th>เพดานประมูลสู้สูงสุด</th>
              <th>ราคาขายจริง (Flip)</th>
              <th>กำไรสุทธิคาดการณ์</th>
              <th>จอที่รับหน้าที่ซื้อ</th>
              <th>สถานะล่าสุด</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(b => {
              const qtyBadge = (Number(b.qty) > 1) ? ` <b style="color:#fde047;">×${Number(b.qty).toLocaleString()}</b>` : '';
              const refBadge = b.refine ? `<span style="color:#c084fc; font-weight:700;">+${b.refine} </span>` : '';
              const iconHtml = b.icon ? `<img src="${escapeHtml(b.icon)}" onerror="this.style.display='none'" style="width:24px;height:24px;border-radius:5px;object-fit:contain;background:#090d16;border:1px solid rgba(255,255,255,0.1);">` : '💎';
              const flipTotal = (Number(b.flipUnitPrice) || 0) * Math.max(1, Number(b.qty) || 1);
              return `
                <tr>
                  <td>
                    <div style="display:flex;align-items:center;gap:8px;">
                      ${iconHtml}
                      <div>
                        <div style="font-weight:700;color:#f8fafc;">${refBadge}${escapeHtml(b.itemName)}${qtyBadge}</div>
                        <div style="font-size:10.5px;color:#64748b;">#${b.listingId} · ผู้ขาย: ${escapeHtml(b.sellerName || '-')}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <b style="color:#38bdf8;">${fmtZeny(b.currentBid)}</b>
                    ${b.discountPct ? `<div style="font-size:10px;color:#34d399;">ต่ำกว่าตลาด -${b.discountPct}%</div>` : ''}
                  </td>
                  <td style="color:#cbd5e1;">${fmtZeny(b.maxBidCapTotal)}</td>
                  <td>
                    <b style="color:#fde047;">${fmtZeny(flipTotal)}</b>
                    <div style="font-size:10px;color:#94a3b8;">(ค่ากลาง ${fmtZeny(b.cleanRefUnitPrice)}/ชิ้น)</div>
                  </td>
                  <td><b style="color:#34d399;">+${fmtZeny(b.expectedNetProfit)}</b></td>
                  <td><span style="color:#e2e8f0;font-weight:600;">${escapeHtml(b.buyerCharName || b.buyerProfileId || '-')}</span></td>
                  <td>
                    ${renderStatusBadgeHtml(b.status)}
                    <div style="font-size:10px;color:#94a3b8;margin-top:2px;">${escapeHtml(b.lastEventNote || '')}</div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
      return;
    }

    if (activeSubTab === 'history') {
      const list = sniperStatus.history || [];
      if (!list.length) {
        box.innerHTML = `<div style="padding: 36px 16px; text-align: center; color: #64748b; font-size: 12.5px;">ยังไม่มีประวัติการช้อนหรือตั้งขายทำกำไร</div>`;
        return;
      }
      box.innerHTML = `
        <table class="ms-table">
          <thead>
            <tr>
              <th>เวลา</th>
              <th>ไอเทม</th>
              <th>ราคาช้อน</th>
              <th>ราคาตั้งขายกลับ</th>
              <th>กำไรสุทธิ</th>
              <th>จอที่ดำเนินการ</th>
              <th>รายละเอียด</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(h => {
              const qtyBadge = (Number(h.qty) > 1) ? ` <b style="color:#fde047;">×${Number(h.qty).toLocaleString()}</b>` : '';
              const refBadge = h.refine ? `<span style="color:#c084fc; font-weight:700;">+${h.refine} </span>` : '';
              return `
                <tr>
                  <td style="white-space:nowrap;color:#94a3b8;font-size:11px;">${fmtTimeAgo(h.at)}</td>
                  <td style="font-weight:700;color:#f8fafc;">${refBadge}${escapeHtml(h.itemName)}${qtyBadge}</td>
                  <td style="color:#38bdf8;font-weight:700;">${fmtZeny(h.buyPriceTotal)}</td>
                  <td style="color:#fde047;font-weight:700;">${h.relistPriceTotal ? fmtZeny(h.relistPriceTotal) : (h.relistUnitPrice ? fmtZeny(h.relistUnitPrice * (h.qty || 1)) : '-')}</td>
                  <td style="color:#34d399;font-weight:700;">${h.expectedNetProfit > 0 ? '+' + fmtZeny(h.expectedNetProfit) : '-'}</td>
                  <td style="color:#e2e8f0;">${escapeHtml(h.buyerCharName || h.buyerProfileId || '-')}</td>
                  <td style="color:#cbd5e1;font-size:11px;">${escapeHtml(h.note || '')}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
      return;
    }

    if (activeSubTab === 'screens') {
      const screens = (sniperStatus.onlineScreens || []).slice().sort((a, b) => (Number(b.zeny) || 0) - (Number(a.zeny) || 0));
      if (!screens.length) {
        box.innerHTML = `<div style="padding: 36px 16px; text-align: center; color: #64748b; font-size: 12.5px;">ไม่มีจอที่ออนไลน์อยู่ในขณะนี้</div>`;
        return;
      }
      box.innerHTML = `
        <table class="ms-table">
          <thead>
            <tr>
              <th>ลำดับ</th>
              <th>ตัวละคร / โปรไฟล์</th>
              <th>เงิน Zeny ในตัว</th>
              <th>สถานะ Premium (ภาษีตลาด)</th>
              <th>โควตาลงขายตลาดกลาง</th>
              <th>บทบาทในระบบ Sniper</th>
            </tr>
          </thead>
          <tbody>
            ${screens.map((s, idx) => `
              <tr>
                <td style="color:#94a3b8;font-weight:700;">#${idx + 1}</td>
                <td style="font-weight:700;color:#f8fafc;">${escapeHtml(s.charName || s.profileName)} <span style="color:#64748b;font-weight:400;">(${escapeHtml(s.profileName)})</span></td>
                <td style="color:#fde047;font-weight:800;">${fmtZeny(s.zeny)}</td>
                <td>${s.premium ? '<span class="ms-badge relisted">👑 มี Premium (ภาษี 4%)</span>' : '<span class="ms-badge">ทั่วไป (ภาษี 8%)</span>'}</td>
                <td style="color:#cbd5e1;">
                  ${s.activeCount} / ${s.maxListings} รายการ
                  ${(Number(s.evictableCheapCount) || 0) > 0
                    ? `<div style="font-size:10px;color:#fbbf24;">ถอดของถูก ≤50k ได้ ${s.evictableCheapCount} ช่อง</div>`
                    : (s.activeCount >= s.maxListings ? `<div style="font-size:10px;color:#f87171;">ของทำกำไรเต็มโควตา (ข้ามไปจอถัดไป)</div>` : '')}
                </td>
                <td>
                  ${s.isPrimaryBuyer
                    ? '<span class="ms-badge won">🎯 คนช้อน/ประมูลหลักตอนนี้</span>'
                    : (s.busy ? '<span class="ms-badge stopped">กำลังทำธุรกรรมอื่น</span>' : (s.activeCount >= s.maxListings && !(Number(s.evictableCheapCount) > 0) ? '<span class="ms-badge stopped">⏳ ช่องเต็ม (รอของขายออก)</span>' : '<span class="ms-badge leading">🔍 ช่วยสแกน & รับไม้ต่อเมื่อจอหลักเต็ม</span>'))}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  }

  async function fetchStatus(populateInputs = false) {
    try {
      const res = await fetch('/api/market-sniper/status');
      const data = await res.json();
      if (data && data.success) {
        sniperStatus = data;
        if (populateInputs && data.config) {
          populateConfigToUi(data.config);
        }
        renderStatusSummary();
      }
    } catch (_) {}
  }

  function openModal() {
    injectStyles();
    ensureModalDom();
    const modal = document.getElementById('modal-market-sniper');
    if (!modal) return;
    isModalOpen = true;
    modal.style.display = 'flex';
    fetchStatus(true);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (isModalOpen) fetchStatus(false);
    }, 3000);
  }

  function closeModal() {
    const modal = document.getElementById('modal-market-sniper');
    if (modal) modal.style.display = 'none';
    isModalOpen = false;
  }

  function attachSecretMoneybagTriggers() {
    injectStyles();
    const zenyIcon = document.querySelector('.metric-card.metric-zeny .metric-icon');
    if (zenyIcon && !zenyIcon.dataset.sniperBound) {
      zenyIcon.id = 'btn-secret-market-sniper';
      zenyIcon.dataset.sniperBound = '1';
      const dot = document.createElement('span');
      dot.className = 'ms-secret-dot';
      zenyIcon.appendChild(dot);
      zenyIcon.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal();
      });
    }

    const zenyTabIcon = document.querySelector('#zeny-pane .zeny-badge-icon');
    if (zenyTabIcon && !zenyTabIcon.dataset.sniperBound) {
      zenyTabIcon.dataset.sniperBound = '1';
      zenyTabIcon.style.cursor = 'pointer';
      zenyTabIcon.style.position = 'relative';
      const dot2 = document.createElement('span');
      dot2.className = 'ms-secret-dot';
      zenyTabIcon.appendChild(dot2);
      zenyTabIcon.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal();
      });
    }
  }

  window.openMarketSniperModal = openModal;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      attachSecretMoneybagTriggers();
      fetchStatus(false);
      setInterval(() => {
        if (!isModalOpen) fetchStatus(false);
      }, 15000);
    });
  } else {
    attachSecretMoneybagTriggers();
    fetchStatus(false);
    setInterval(() => {
      if (!isModalOpen) fetchStatus(false);
    }, 15000);
  }
})();
