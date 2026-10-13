// manager/public/config_copy.js — "copy bot settings to other clients" dialog (opened from the web bot menu)
// Depends on app.js globals: currentProfiles, escapeHTML
(function () {
  'use strict';

  const STYLE_TEXT = `
    .cc-overlay { position: fixed; inset: 0; z-index: 200000; display: flex; align-items: center; justify-content: center; background: rgba(2, 6, 16, 0.7); backdrop-filter: blur(4px); }
    .cc-card { width: 440px; max-width: calc(100vw - 24px); max-height: calc(100vh - 40px); display: flex; flex-direction: column; gap: 10px; padding: 16px; background: linear-gradient(180deg, #111a30, #0c1426); border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 14px; box-shadow: 0 30px 70px rgba(0, 0, 0, 0.65); color: #e2e8f0; font-size: 12px; }
    .cc-head { display: flex; align-items: center; justify-content: space-between; }
    .cc-head b { font-size: 15px; color: #f8fafc; }
    .cc-x { width: 30px; height: 28px; border-radius: 8px; border: none; background: transparent; color: #94a3b8; font-size: 18px; cursor: pointer; }
    .cc-x:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
    .cc-src { font-size: 12px; color: #94a3b8; }
    .cc-src b { color: #7dd3fc; }
    .cc-info { padding: 8px 10px; border-radius: 9px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #a7f3d0; line-height: 1.5; font-size: 11.5px; }
    .cc-info .no { color: #fca5a5; }
    .cc-tools { display: flex; justify-content: space-between; align-items: center; font-weight: 700; color: #cbd5e1; }
    .cc-tools button { font-size: 10.5px; padding: 3px 9px; border-radius: 6px; border: 1px solid rgba(148, 163, 184, 0.3); background: rgba(255, 255, 255, 0.04); color: #cbd5e1; cursor: pointer; margin-left: 4px; }
    .cc-list { display: flex; flex-direction: column; gap: 5px; overflow-y: auto; max-height: 300px; }
    .cc-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 9px; background: rgba(2, 6, 18, 0.55); border: 1px solid rgba(148, 163, 184, 0.14); cursor: pointer; }
    .cc-item:hover { border-color: rgba(56, 189, 248, 0.45); }
    .cc-item.off { opacity: 0.5; cursor: not-allowed; }
    .cc-item input { width: 16px; height: 16px; accent-color: #10b981; cursor: inherit; }
    .cc-item .nm { flex: 1; min-width: 0; font-weight: 700; color: #f1f5f9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cc-item .nm small { display: block; font-weight: 500; color: #94a3b8; font-size: 10.5px; }
    .cc-item .st { font-size: 10.5px; font-weight: 700; }
    .cc-item .st.on { color: #34d399; } .cc-item .st.ok { color: #34d399; } .cc-item .st.bad { color: #f87171; }
    .cc-foot { display: flex; justify-content: flex-end; gap: 8px; }
    .cc-btn { padding: 8px 14px; border-radius: 9px; border: 1px solid transparent; font-size: 12.5px; font-weight: 700; cursor: pointer; }
    .cc-btn.ghost { background: rgba(255, 255, 255, 0.05); color: #cbd5e1; border-color: rgba(148, 163, 184, 0.3); }
    .cc-btn.go { background: linear-gradient(135deg, #10b981, #047857); color: #fff; }
    .cc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  `;

  const esc = s => (typeof escapeHTML === 'function' ? escapeHTML(s) : String(s == null ? '' : s));

  function ensureStyle() {
    if (document.getElementById('cc-style')) return;
    const st = document.createElement('style');
    st.id = 'cc-style';
    st.textContent = STYLE_TEXT;
    document.head.appendChild(st);
  }

  function close() {
    const el = document.getElementById('cc-overlay');
    if (el) el.remove();
  }

  window.openConfigCopyDialog = function (sourceId) {
    ensureStyle();
    close();
    const profiles = (typeof currentProfiles !== 'undefined' && Array.isArray(currentProfiles)) ? currentProfiles : [];
    const source = profiles.find(p => p.id === sourceId);
    const others = profiles.filter(p => p.id !== sourceId);
    const sourceName = source ? (source.liveState?.charName ? `${source.name} (${source.liveState.charName})` : source.name) : sourceId;

    const el = document.createElement('div');
    el.id = 'cc-overlay';
    el.className = 'cc-overlay';
    el.innerHTML = `
      <div class="cc-card" role="dialog" aria-modal="true">
        <div class="cc-head"><b>📋 คัดลอกการตั้งค่าบอทไปจออื่น</b><button type="button" class="cc-x" data-cc="close">✕</button></div>
        <div class="cc-src">จาก: <b>${esc(sourceName)}</b></div>
        <div class="cc-info">
          คัดลอกทุกอย่าง: แมพฟาร์ม, ลูป 24 ชม., ธนู/ลูกธนู/B.Wing, ยาบัพ, ขายของ NPC + Whitelist + ตัวกรองออฟ, Auto Sell ตลาด, Sniper, Auto-Shop, Auto-Login (เปิด/ปิด, เริ่มบอทต่อ)<br>
          <span class="no">ไม่คัดลอก: ID, รหัสผ่าน และชื่อตัวละคร (จอปลายทางใช้ของเดิม)</span>
        </div>
        <div class="cc-tools">
          <span>เลือกจอปลายทาง</span>
          <span><button type="button" data-cc="all">เลือกทุกจอที่ออนไลน์</button><button type="button" data-cc="none">ล้าง</button></span>
        </div>
        <div class="cc-list">
          ${others.length ? others.map(p => {
            const on = Boolean(p.isRunning);
            const sub = [p.liveState?.charName, p.account].filter(Boolean).join(' · ');
            return `<label class="cc-item ${on ? '' : 'off'}" data-id="${esc(p.id)}">
              <input type="checkbox" value="${esc(p.id)}" ${on ? '' : 'disabled'}>
              <span class="nm">${esc(p.name)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
              <span class="st ${on ? 'on' : ''}">${on ? 'ออนไลน์' : 'ออฟไลน์'}</span>
            </label>`;
          }).join('') : '<div class="cc-src">ไม่มีจออื่น</div>'}
        </div>
        <div class="cc-foot">
          <button type="button" class="cc-btn ghost" data-cc="close">ยกเลิก</button>
          <button type="button" class="cc-btn go" data-cc="go" disabled>คัดลอก</button>
        </div>
      </div>`;
    document.body.appendChild(el);

    const goBtn = el.querySelector('[data-cc="go"]');
    const boxes = () => Array.from(el.querySelectorAll('.cc-item input:not(:disabled)'));
    const refresh = () => {
      const n = boxes().filter(b => b.checked).length;
      goBtn.disabled = n === 0;
      goBtn.textContent = n ? `คัดลอกไป ${n} จอ` : 'คัดลอก';
    };

    el.addEventListener('change', refresh);
    el.addEventListener('click', async e => {
      if (e.target === el) return close();
      const b = e.target.closest('[data-cc]');
      if (!b) return;
      const act = b.dataset.cc;
      if (act === 'close') return close();
      if (act === 'all') { boxes().forEach(x => { x.checked = true; }); return refresh(); }
      if (act === 'none') { boxes().forEach(x => { x.checked = false; }); return refresh(); }
      if (act === 'go') {
        const targets = boxes().filter(x => x.checked).map(x => x.value);
        if (!targets.length) return;
        goBtn.disabled = true;
        goBtn.textContent = '⏳ กำลังคัดลอก...';
        let r = null;
        try {
          const res = await fetch(`/api/profiles/${encodeURIComponent(sourceId)}/copy-config`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targets })
          });
          r = await res.json();
        } catch (err) {
          r = { success: false, error: err.message };
        }
        if (!r || (!r.results && !r.success)) {
          goBtn.disabled = false;
          goBtn.textContent = 'ลองอีกครั้ง';
          alert('❌ ' + ((r && r.error) || 'คัดลอกไม่สำเร็จ'));
          return;
        }
        (r.results || []).forEach(x => {
          const st = el.querySelector(`.cc-item[data-id="${CSS.escape(x.id)}"] .st`);
          if (st) {
            st.className = `st ${x.success ? 'ok' : 'bad'}`;
            st.textContent = x.success ? '✅ คัดลอกแล้ว' : `❌ ${x.error || 'ไม่สำเร็จ'}`;
          }
        });
        goBtn.textContent = `เสร็จ ${r.copied}/${r.total} จอ`;
        el.querySelector('.cc-foot .ghost').textContent = 'ปิด';
      }
    });
  };
})();
