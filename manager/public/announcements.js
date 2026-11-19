(() => {
  'use strict';
  if (typeof window === 'undefined' || window.__PM_REMOTE_MODE__) return;

  const POLL_INTERVAL_MS = 4000;
  const LOCAL_ACK_KEY_PREFIX = 'pelican_ann_ack_v1:';

  const state = {
    actorKey: '',
    username: '',
    requiresLogin: false,
    unacked: [],
    history: [],
    modalOpen: false,
    modalMode: 'blocking', // 'blocking' | 'history'
    displayedIds: [],
    ackBusy: false,
    pollBusy: false,
    pollTimer: null
  };

  let dom = null;

  function loadLocalAckMap(actorKey) {
    if (!actorKey) return {};
    try {
      const raw = localStorage.getItem(LOCAL_ACK_KEY_PREFIX + actorKey);
      const parsed = raw ? JSON.parse(raw) : {};
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveLocalAckItems(actorKey, items) {
    if (!actorKey || !Array.isArray(items) || !items.length) return;
    try {
      const map = loadLocalAckMap(actorKey);
      for (const it of items) {
        if (it && it.id) {
          map[String(it.id)] = Number(it.updatedAt || it.createdAt || Date.now());
        }
      }
      localStorage.setItem(LOCAL_ACK_KEY_PREFIX + actorKey, JSON.stringify(map));
    } catch (_) {}
  }

  function isLocallyAckedSameVersion(actorKey, item) {
    if (!actorKey || !item || !item.id) return false;
    const map = loadLocalAckMap(actorKey);
    const ackedVer = Number(map[String(item.id)] || 0);
    const curVer = Number(item.updatedAt || item.createdAt || 0);
    return ackedVer > 0 && ackedVer >= curVer;
  }

  function formatBangkokDateTime(ms) {
    if (!ms) return '';
    try {
      return new Date(ms).toLocaleString('th-TH', {
        timeZone: 'Asia/Bangkok',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) + ' น.';
    } catch (_) {
      return '';
    }
  }

  function injectStyles() {
    if (document.getElementById('pm-announcements-style')) return;
    const style = document.createElement('style');
    style.id = 'pm-announcements-style';
    style.textContent = `
      #btn-header-announcements {
        background: linear-gradient(135deg, rgba(56, 189, 248, 0.16), rgba(14, 165, 233, 0.08));
        border: 1px solid rgba(56, 189, 248, 0.42);
        color: #7dd3fc;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
        position: relative;
      }
      #btn-header-announcements:hover {
        border-color: rgba(56, 189, 248, 0.8);
        color: #e0f2fe;
      }
      #btn-header-announcements .pm-ann-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ef4444;
        box-shadow: 0 0 8px #ef4444;
        display: none;
      }
      #btn-header-announcements.has-unacked .pm-ann-dot {
        display: inline-block;
      }

      #pm-ann-overlay {
        position: fixed;
        inset: 0;
        z-index: 10000010;
        background: rgba(2, 6, 23, 0.82);
        backdrop-filter: blur(7px);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 18px;
      }
      #pm-ann-overlay.is-open {
        display: flex;
        animation: pmAnnFadeIn 0.2s ease-out;
      }
      @keyframes pmAnnFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .pm-ann-dialog {
        width: min(680px, 95vw);
        max-height: 86vh;
        background: linear-gradient(165deg, #0b1325 0%, #0f172a 60%, #131c31 100%);
        border: 1px solid rgba(56, 189, 248, 0.5);
        border-radius: 18px;
        box-shadow: 0 28px 70px rgba(0, 0, 0, 0.9), 0 0 40px rgba(56, 189, 248, 0.18);
        color: #f8fafc;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: pmAnnPopIn 0.24s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .pm-ann-dialog.level-important {
        border-color: rgba(250, 204, 21, 0.65);
        box-shadow: 0 28px 70px rgba(0, 0, 0, 0.9), 0 0 42px rgba(234, 179, 8, 0.22);
      }
      .pm-ann-dialog.level-urgent {
        border-color: rgba(248, 113, 113, 0.72);
        box-shadow: 0 28px 70px rgba(0, 0, 0, 0.92), 0 0 46px rgba(239, 68, 68, 0.28);
      }
      @keyframes pmAnnPopIn {
        from { transform: translateY(14px) scale(0.96); opacity: 0; }
        to { transform: translateY(0) scale(1); opacity: 1; }
      }

      .pm-ann-header {
        padding: 16px 20px;
        background: rgba(9, 13, 24, 0.85);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-shrink: 0;
      }
      .pm-ann-header-left {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }
      .pm-ann-icon-box {
        width: 42px;
        height: 42px;
        border-radius: 12px;
        background: linear-gradient(135deg, rgba(56, 189, 248, 0.24), rgba(14, 165, 233, 0.12));
        border: 1px solid rgba(56, 189, 248, 0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 21px;
        flex-shrink: 0;
      }
      .pm-ann-dialog.level-important .pm-ann-icon-box {
        background: linear-gradient(135deg, rgba(250, 204, 21, 0.26), rgba(234, 88, 12, 0.14));
        border-color: rgba(250, 204, 21, 0.65);
      }
      .pm-ann-dialog.level-urgent .pm-ann-icon-box {
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.28), rgba(185, 28, 28, 0.16));
        border-color: rgba(248, 113, 113, 0.72);
      }
      .pm-ann-head-title {
        font-size: 16.5px;
        font-weight: 800;
        color: #f8fafc;
        line-height: 1.25;
      }
      .pm-ann-head-sub {
        font-size: 11.5px;
        color: #94a3b8;
        margin-top: 2px;
      }
      .pm-ann-close-x {
        background: rgba(148, 163, 184, 0.12);
        border: 1px solid rgba(148, 163, 184, 0.25);
        color: #cbd5e1;
        width: 32px;
        height: 32px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 15px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .pm-ann-close-x:hover {
        background: rgba(148, 163, 184, 0.24);
        color: #fff;
      }

      .pm-ann-body {
        padding: 18px 20px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .pm-ann-card {
        background: rgba(15, 23, 42, 0.78);
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 13px;
        padding: 15px 17px;
        display: flex;
        flex-direction: column;
        gap: 9px;
      }
      .pm-ann-card.is-primary {
        background: linear-gradient(180deg, rgba(15, 29, 52, 0.92), rgba(11, 19, 35, 0.9));
        border-color: rgba(56, 189, 248, 0.45);
      }
      .pm-ann-card.card-important {
        border-color: rgba(250, 204, 21, 0.5);
      }
      .pm-ann-card.card-urgent {
        border-color: rgba(248, 113, 113, 0.58);
        background: linear-gradient(180deg, rgba(52, 16, 24, 0.55), rgba(15, 23, 42, 0.9));
      }
      .pm-ann-card-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
      }
      .pm-ann-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 9px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        background: rgba(56, 189, 248, 0.16);
        color: #7dd3fc;
        border: 1px solid rgba(56, 189, 248, 0.4);
      }
      .pm-ann-pill.pill-important {
        background: rgba(250, 204, 21, 0.18);
        color: #fef08a;
        border-color: rgba(250, 204, 21, 0.45);
      }
      .pm-ann-pill.pill-urgent {
        background: rgba(239, 68, 68, 0.22);
        color: #fecaca;
        border-color: rgba(248, 113, 113, 0.55);
      }
      .pm-ann-time {
        font-size: 11.5px;
        color: #94a3b8;
      }
      .pm-ann-title {
        font-size: 16px;
        font-weight: 800;
        color: #fef08a;
        line-height: 1.35;
      }
      .pm-ann-text {
        font-size: 13.8px;
        line-height: 1.65;
        color: #e2e8f0;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .pm-ann-img {
        max-width: 100%;
        max-height: 320px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        object-fit: contain;
        background: rgba(2, 6, 23, 0.6);
        cursor: zoom-in;
        align-self: flex-start;
      }
      .pm-ann-divider {
        font-size: 11.5px;
        font-weight: 700;
        color: #94a3b8;
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 2px 0 -4px;
      }
      .pm-ann-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: rgba(148, 163, 184, 0.2);
      }

      .pm-ann-footer {
        padding: 14px 20px;
        background: rgba(9, 13, 24, 0.9);
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-shrink: 0;
        flex-wrap: wrap;
      }
      .pm-ann-footer-note {
        font-size: 11.5px;
        color: #94a3b8;
      }
      .pm-ann-ack-btn {
        background: linear-gradient(135deg, #10b981, #059669);
        border: 1px solid #34d399;
        color: #022c22;
        font-family: inherit;
        font-size: 13.5px;
        font-weight: 800;
        padding: 9px 24px;
        border-radius: 10px;
        cursor: pointer;
        box-shadow: 0 6px 20px rgba(16, 185, 129, 0.32);
        transition: transform 0.14s ease, filter 0.14s ease;
      }
      .pm-ann-ack-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        filter: brightness(1.06);
      }
      .pm-ann-ack-btn:disabled {
        opacity: 0.6;
        cursor: default;
      }

      #pm-ann-lightbox {
        position: fixed;
        inset: 0;
        z-index: 10000015;
        background: rgba(2, 6, 23, 0.92);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 24px;
        cursor: zoom-out;
      }
      #pm-ann-lightbox.is-open {
        display: flex;
      }
      #pm-ann-lightbox img {
        max-width: 94vw;
        max-height: 90vh;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.85);
      }
    `;
    document.head.appendChild(style);
  }

  function mountDom() {
    if (dom) return dom;
    injectStyles();

    // 1. Header History Button (next to topup / refresh in .header-actions)
    let headerBtn = document.getElementById('btn-header-announcements');
    if (!headerBtn) {
      headerBtn = document.createElement('button');
      headerBtn.id = 'btn-header-announcements';
      headerBtn.type = 'button';
      headerBtn.className = 'btn btn-sm';
      headerBtn.title = 'ดูประกาศล่าสุดและประวัติประกาศจากแอดมิน';
      headerBtn.innerHTML = `<span class="pm-ann-dot"></span><span>📢</span><span>ประกาศ</span>`;
      const actions = document.querySelector('.header-actions');
      const refreshBtn = document.getElementById('btn-refresh');
      if (actions && refreshBtn) {
        actions.insertBefore(headerBtn, refreshBtn);
      } else if (actions) {
        actions.appendChild(headerBtn);
      }
    }

    // 2. Modal Overlay
    const overlay = document.createElement('div');
    overlay.id = 'pm-ann-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div id="pm-ann-dialog" class="pm-ann-dialog">
        <div class="pm-ann-header">
          <div class="pm-ann-header-left">
            <div id="pm-ann-icon-box" class="pm-ann-icon-box">📢</div>
            <div>
              <div id="pm-ann-head-title" class="pm-ann-head-title">ประกาศจากผู้ดูแลระบบ</div>
              <div id="pm-ann-head-sub" class="pm-ann-head-sub">กรุณาอ่านรายละเอียดและกดรับทราบเพื่อดำเนินการต่อ</div>
            </div>
          </div>
          <button type="button" id="pm-ann-close-x" class="pm-ann-close-x" title="ปิดหน้าต่าง" style="display:none;">✕</button>
        </div>
        <div id="pm-ann-body" class="pm-ann-body"></div>
        <div class="pm-ann-footer">
          <div id="pm-ann-footer-note" class="pm-ann-footer-note">กดรับทราบครั้งเดียว จะไม่แสดงซ้ำอีกในทุกเครื่องที่ใช้ ID เดียวกัน</div>
          <button type="button" id="pm-ann-ack-btn" class="pm-ann-ack-btn">✅ รับทราบ</button>
        </div>
      </div>
    `;

    // 3. Image Lightbox
    const lightbox = document.createElement('div');
    lightbox.id = 'pm-ann-lightbox';
    const lightboxImg = document.createElement('img');
    lightboxImg.alt = 'ภาพขยายประกาศ';
    lightbox.appendChild(lightboxImg);
    lightbox.addEventListener('click', () => lightbox.classList.remove('is-open'));

    document.body.appendChild(overlay);
    document.body.appendChild(lightbox);

    dom = {
      headerBtn,
      overlay,
      dialog: document.getElementById('pm-ann-dialog'),
      iconBox: document.getElementById('pm-ann-icon-box'),
      headTitle: document.getElementById('pm-ann-head-title'),
      headSub: document.getElementById('pm-ann-head-sub'),
      closeX: document.getElementById('pm-ann-close-x'),
      body: document.getElementById('pm-ann-body'),
      footerNote: document.getElementById('pm-ann-footer-note'),
      ackBtn: document.getElementById('pm-ann-ack-btn'),
      lightbox,
      lightboxImg
    };

    headerBtn.addEventListener('click', () => {
      if (state.unacked.length > 0) {
        openModal('blocking');
      } else {
        openModal('history');
      }
    });

    dom.closeX.addEventListener('click', () => {
      if (state.modalMode === 'history') {
        closeModal();
      }
    });

    overlay.addEventListener('click', (e) => {
      // Blocking announcements NEVER close on backdrop click; only history mode can
      if (e.target === overlay && state.modalMode === 'history') {
        closeModal();
      }
    });

    dom.ackBtn.addEventListener('click', () => {
      if (state.modalMode === 'history' && state.unacked.length === 0) {
        closeModal();
        return;
      }
      acknowledgeDisplayed();
    });

    return dom;
  }

  function isLoginGateBlockingScreen() {
    if (state.requiresLogin) return true;
    const authModal = document.getElementById('account-auth-modal');
    if (authModal && authModal.style.display !== 'none' && getComputedStyle(authModal).display !== 'none') {
      const closeBtn = document.getElementById('btn-auth-modal-close');
      if (closeBtn && closeBtn.style.display === 'none') return true;
    }
    return false;
  }

  function buildAnnouncementCard(item, isPrimary) {
    const card = document.createElement('article');
    const lv = item.level === 'urgent' ? 'urgent' : item.level === 'important' ? 'important' : 'info';
    card.className = 'pm-ann-card'
      + (isPrimary ? ' is-primary' : '')
      + (lv === 'urgent' ? ' card-urgent' : lv === 'important' ? ' card-important' : '');

    const meta = document.createElement('div');
    meta.className = 'pm-ann-card-meta';

    const pill = document.createElement('span');
    pill.className = 'pm-ann-pill' + (lv === 'urgent' ? ' pill-urgent' : lv === 'important' ? ' pill-important' : '');
    pill.textContent = lv === 'urgent'
      ? '🚨 ประกาศด่วนมาก'
      : lv === 'important'
        ? '⚠️ ประกาศสำคัญ'
        : (isPrimary ? '📢 ประกาศล่าสุด' : '📌 ประกาศก่อนหน้า');

    const timeEl = document.createElement('span');
    timeEl.className = 'pm-ann-time';
    timeEl.textContent = formatBangkokDateTime(item.updatedAt || item.createdAt);
    meta.append(pill, timeEl);
    card.appendChild(meta);

    if (item.title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'pm-ann-title';
      titleEl.textContent = item.title;
      card.appendChild(titleEl);
    }

    if (item.body) {
      const bodyEl = document.createElement('div');
      bodyEl.className = 'pm-ann-text';
      bodyEl.textContent = item.body;
      card.appendChild(bodyEl);
    }

    if (item.imageDataUrl) {
      const img = document.createElement('img');
      img.className = 'pm-ann-img';
      img.src = item.imageDataUrl;
      img.alt = item.title || 'รูปประกอบประกาศ';
      img.addEventListener('click', () => {
        if (!dom) return;
        dom.lightboxImg.src = item.imageDataUrl;
        dom.lightbox.classList.add('is-open');
      });
      card.appendChild(img);
    }

    return card;
  }

  function openModal(mode = 'blocking') {
    mountDom();
    state.modalMode = mode;
    const isBlocking = mode === 'blocking';
    const items = isBlocking ? state.unacked : state.history;

    state.displayedIds = items.map(x => Number(x.id)).filter(x => x > 0);

    // Determine highest severity for dialog border/icon
    const hasUrgent = items.some(x => x.level === 'urgent');
    const hasImportant = items.some(x => x.level === 'important');
    dom.dialog.classList.remove('level-important', 'level-urgent');
    if (hasUrgent) {
      dom.dialog.classList.add('level-urgent');
      dom.iconBox.textContent = '🚨';
    } else if (hasImportant) {
      dom.dialog.classList.add('level-important');
      dom.iconBox.textContent = '⚠️';
    } else {
      dom.iconBox.textContent = '📢';
    }

    if (isBlocking) {
      dom.headTitle.textContent = hasUrgent
        ? 'ประกาศด่วนจากแอดมิน (กรุณากดรับทราบ)'
        : items.length > 1
          ? `ประกาศใหม่จากแอดมิน (${items.length} รายการ)`
          : 'ประกาศจากแอดมิน';
      dom.headSub.textContent = items.length > 1
        ? 'รวมประกาศที่คุณยังไม่ได้อ่านไว้ในหน้าต่างเดียว — อ่านครบแล้วกด "รับทราบทั้งหมด" ครั้งเดียวได้เลย'
        : 'หน้าต่างนี้จะปิดลงเมื่อกดปุ่ม "✅ รับทราบ" ด้านล่าง และจะไม่เด้งซ้ำอีก';
      dom.closeX.style.display = 'none';
      dom.footerNote.textContent = state.username
        ? `ซิงค์สถานะรับทราบตามบัญชี @${state.username} (ไม่เด้งซ้ำในเครื่องอื่น)`
        : 'กดรับทราบเพื่อปิดหน้าต่างนี้';
      dom.ackBtn.textContent = items.length > 1
        ? `✅ รับทราบทั้งหมด (${items.length} รายการ)`
        : '✅ รับทราบ';
    } else {
      dom.headTitle.textContent = 'ประวัติประกาศจากแอดมิน';
      dom.headSub.textContent = 'รายการประกาศย้อนหลังทั้งหมดในระบบ';
      dom.closeX.style.display = 'inline-flex';
      dom.footerNote.textContent = 'สามารถเปิดดูประกาศย้อนหลังได้ที่ปุ่ม "📢 ประกาศ" ด้านบน';
      dom.ackBtn.textContent = 'ปิดหน้าต่าง';
    }

    dom.body.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;color:#94a3b8;padding:28px 12px;font-size:13.5px;';
      empty.textContent = 'ยังไม่มีประกาศจากผู้ดูแลระบบในขณะนี้';
      dom.body.appendChild(empty);
    } else {
      dom.body.appendChild(buildAnnouncementCard(items[0], true));
      if (items.length > 1) {
        const div = document.createElement('div');
        div.className = 'pm-ann-divider';
        div.textContent = isBlocking
          ? `📌 ประกาศก่อนหน้าที่ยังไม่ได้อ่าน (อีก ${items.length - 1} รายการ)`
          : `📋 ประกาศก่อนหน้า (${items.length - 1} รายการ)`;
        dom.body.appendChild(div);
        for (let i = 1; i < items.length; i++) {
          dom.body.appendChild(buildAnnouncementCard(items[i], false));
        }
      }
    }

    state.modalOpen = true;
    dom.overlay.classList.add('is-open');
  }

  function closeModal() {
    if (!dom) return;
    state.modalOpen = false;
    dom.overlay.classList.remove('is-open');
  }

  async function acknowledgeDisplayed() {
    if (state.ackBusy) return;
    const itemsToAck = state.unacked.slice();
    const ids = itemsToAck.map(x => Number(x.id)).filter(x => x > 0);
    if (!ids.length) {
      closeModal();
      return;
    }

    state.ackBusy = true;
    if (dom && dom.ackBtn) {
      dom.ackBtn.disabled = true;
      dom.ackBtn.textContent = '⏳ กำลังบันทึก...';
    }

    // Optimistic local save + close immediately once server confirms (or fallback local)
    if (state.actorKey) {
      saveLocalAckItems(state.actorKey, itemsToAck);
    }

    try {
      await fetch('/api/announcements/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
    } catch (_) {}

    const ackedSet = new Set(ids);
    state.unacked = state.unacked.filter(x => !ackedSet.has(Number(x.id)));
    state.history = state.history.map(x => ackedSet.has(Number(x.id)) ? { ...x, acked: true } : x);
    state.ackBusy = false;
    if (dom) {
      dom.ackBtn.disabled = false;
      dom.headerBtn.classList.toggle('has-unacked', state.unacked.length > 0);
    }
    closeModal();
  }

  async function pollAnnouncements() {
    if (state.pollBusy) return;
    state.pollBusy = true;
    try {
      const res = await fetch('/api/announcements/poll', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.success) return;

      state.requiresLogin = Boolean(data.requiresLogin);
      if (state.requiresLogin) {
        if (state.modalOpen && state.modalMode === 'blocking') closeModal();
        return;
      }

      const actorKey = String(data.actorKey || '');
      state.actorKey = actorKey;
      state.username = String(data.username || '');

      const rawUnacked = Array.isArray(data.unackedAnnouncements) ? data.unackedAnnouncements : [];
      const filteredUnacked = rawUnacked.filter(item => !isLocallyAckedSameVersion(actorKey, item));
      state.unacked = filteredUnacked;
      state.history = Array.isArray(data.historyAnnouncements) ? data.historyAnnouncements : [];

      mountDom();
      dom.headerBtn.classList.toggle('has-unacked', filteredUnacked.length > 0);

      if (filteredUnacked.length > 0 && !isLoginGateBlockingScreen()) {
        // Open or live-refresh blocking modal if new announcement arrived while open!
        const curKey = state.displayedIds.join(',');
        const nextKey = filteredUnacked.map(x => x.id).join(',');
        if (!state.modalOpen || state.modalMode !== 'blocking' || curKey !== nextKey) {
          openModal('blocking');
        }
      } else if (state.modalOpen && state.modalMode === 'blocking' && filteredUnacked.length === 0) {
        // Closed or acknowledged on another PC with the same Username ID -> auto-dismiss here too!
        closeModal();
      }
    } catch (_) {
    } finally {
      state.pollBusy = false;
    }
  }

  function init() {
    mountDom();
    pollAnnouncements();
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => {
      if (!document.hidden) {
        pollAnnouncements();
      }
    }, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) pollAnnouncements();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
