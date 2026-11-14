(() => {
  'use strict';
  if (typeof window === 'undefined' || window.__PM_REMOTE_MODE__) return;

  const POLL_INTERVAL_MS = 4000;
  const state = {
    username: '',
    accessStatus: 'approved',
    isUserAccount: false,
    requiresLogin: true,
    isOpen: false,
    messages: [],
    lastMessageId: 0,
    unreadCount: 0,
    adminLastReadId: 0,
    userLastReadId: 0,
    pendingImage: '',
    pollBusy: false,
    sendBusy: false,
    pollTimer: null
  };

  let dom = null;

  function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function formatTime(ms) {
    if (!ms) return '';
    try {
      return new Date(ms).toLocaleTimeString('th-TH', {
        timeZone: 'Asia/Bangkok',
        hour: '2-digit',
        minute: '2-digit'
      }) + ' น.';
    } catch (_) {
      return '';
    }
  }

  function mountDom() {
    if (dom) return dom;

    const root = createEl('div');
    root.id = 'pm-support-root';
    root.hidden = true;

    const launcher = createEl('button', 'pm-support-launcher');
    launcher.id = 'pm-support-launcher';
    launcher.type = 'button';
    launcher.title = 'คลิกเพื่อเปิดแชทแจ้งปัญหาหาแอดมิน';

    const dot = createEl('span', 'pm-support-dot');
    const label = createEl('span', 'pm-support-launcher-label', '💬 แจ้งปัญหา');
    const userChip = createEl('span', 'pm-support-user-chip', '');
    userChip.id = 'pm-support-user-chip';
    const badge = createEl('span', 'pm-support-unread-badge', '0');
    badge.id = 'pm-support-unread-badge';
    badge.hidden = true;
    const chev = createEl('span', 'pm-support-chevron', '▲');
    launcher.append(dot, label, userChip, badge, chev);

    const panel = createEl('section', 'pm-support-panel');
    panel.id = 'pm-support-panel';
    panel.setAttribute('aria-label', 'แชทแจ้งปัญหา PmheeAether');

    const header = createEl('div', 'pm-support-header');
    const peer = createEl('div', 'pm-support-peer');
    const avatar = createEl('div', 'pm-support-avatar', '💬');
    const peerText = createEl('div');
    peerText.style.minWidth = '0';
    const title = createEl('div', 'pm-support-title', 'แจ้งปัญหา / ติดต่อแอดมิน');
    const subtitle = createEl('div', 'pm-support-subtitle', 'ประวัติแชทซิงค์ตาม ID ทุกเครื่อง');
    subtitle.id = 'pm-support-subtitle';
    peerText.append(title, subtitle);
    peer.append(avatar, peerText);

    const minBtn = createEl('button', 'pm-support-min-btn', '—');
    minBtn.type = 'button';
    minBtn.title = 'พับกล่องแชท';
    header.append(peer, minBtn);

    const messagesEl = createEl('div', 'pm-support-messages');
    messagesEl.id = 'pm-support-messages';

    const imgBar = createEl('div', 'pm-support-img-bar');
    imgBar.id = 'pm-support-img-bar';
    imgBar.hidden = true;
    const imgThumb = createEl('img', 'pm-support-img-thumb');
    imgThumb.alt = 'รูปที่แนบ';
    const imgNote = createEl('span', '', 'แนบรูปภาพพร้อมส่ง');
    const imgClearBtn = createEl('button', 'pm-support-img-clear', '✕ เอาออก');
    imgClearBtn.type = 'button';
    imgBar.append(imgThumb, imgNote, imgClearBtn);

    const errorEl = createEl('p', 'pm-support-error');
    errorEl.id = 'pm-support-error';
    errorEl.hidden = true;

    const composer = createEl('form', 'pm-support-composer');
    composer.id = 'pm-support-composer';
    const fileInput = createEl('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.hidden = true;
    const attachBtn = createEl('button', 'pm-support-attach-btn', '📷');
    attachBtn.type = 'button';
    attachBtn.title = 'แนบรูปภาพ (หรือกด Ctrl+V วางรูปหน้าจอ)';
    const textarea = createEl('textarea', 'pm-support-input');
    textarea.id = 'pm-support-input';
    textarea.rows = 1;
    textarea.maxLength = 2000;
    textarea.placeholder = 'พิมพ์แจ้งปัญหาถึงแอดมิน... (Enter ส่ง)';
    const sendBtn = createEl('button', 'pm-support-send-btn', 'ส่ง');
    sendBtn.id = 'pm-support-send-btn';
    sendBtn.type = 'submit';
    composer.append(fileInput, attachBtn, textarea, sendBtn);

    panel.append(header, messagesEl, imgBar, errorEl, composer);
    root.append(launcher, panel);

    const lightbox = createEl('div', 'pm-support-lightbox');
    lightbox.id = 'pm-support-lightbox';
    lightbox.hidden = true;
    const lightboxImg = createEl('img');
    lightboxImg.alt = 'ภาพขนาดเต็ม';
    const lightboxClose = createEl('button', '', '✕ ปิดรูปภาพ');
    lightboxClose.type = 'button';
    lightbox.append(lightboxImg, lightboxClose);

    document.body.append(root, lightbox);

    launcher.addEventListener('click', () => openChat());
    minBtn.addEventListener('click', () => closeChat());
    attachBtn.addEventListener('click', () => fileInput.click());
    imgClearBtn.addEventListener('click', () => setPendingImage(''));
    lightboxClose.addEventListener('click', () => { lightbox.hidden = true; });
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) lightbox.hidden = true;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !lightbox.hidden) lightbox.hidden = true;
    });

    fileInput.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      try {
        showError('');
        setPendingImage(await compressImageFile(f));
      } catch (err) {
        showError(err.message || 'แนบรูปภาพไม่สำเร็จ');
      }
    });

    textarea.addEventListener('paste', async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            try {
              showError('');
              setPendingImage(await compressImageFile(f));
            } catch (err) {
              showError(err.message || 'วางรูปภาพไม่สำเร็จ');
            }
            break;
          }
        }
      }
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    composer.addEventListener('submit', (e) => {
      e.preventDefault();
      sendMessage();
    });

    dom = {
      root,
      launcher,
      userChip,
      badge,
      panel,
      subtitle,
      messagesEl,
      imgBar,
      imgThumb,
      errorEl,
      textarea,
      sendBtn,
      lightbox,
      lightboxImg
    };
    return dom;
  }

  function showError(msgText) {
    if (!dom) return;
    if (msgText) {
      dom.errorEl.textContent = String(msgText);
      dom.errorEl.hidden = false;
    } else {
      dom.errorEl.textContent = '';
      dom.errorEl.hidden = true;
    }
  }

  function setPendingImage(dataUrl) {
    state.pendingImage = String(dataUrl || '');
    if (!dom) return;
    if (state.pendingImage) {
      dom.imgThumb.src = state.pendingImage;
      dom.imgBar.hidden = false;
    } else {
      dom.imgThumb.removeAttribute('src');
      dom.imgBar.hidden = true;
    }
  }

  async function compressImageFile(file) {
    const rawUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('อ่านไฟล์รูปไม่สำเร็จ'));
      reader.readAsDataURL(file);
    });
    if (!rawUrl.startsWith('data:image/')) {
      throw new Error('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
    }
    if (rawUrl.length <= 450000 && /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(rawUrl)) {
      return rawUrl;
    }
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('ไม่สามารถประมวลผลรูปภาพได้'));
      im.src = rawUrl;
    });
    const maxSide = 1280;
    let w = img.naturalWidth || img.width || 800;
    let h = img.naturalHeight || img.height || 600;
    if (w > maxSide || h > maxSide) {
      if (w >= h) {
        h = Math.max(1, Math.round((h * maxSide) / w));
        w = maxSide;
      } else {
        w = Math.max(1, Math.round((w * maxSide) / h));
        h = maxSide;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return rawUrl;
    ctx.drawImage(img, 0, 0, w, h);
    let out = canvas.toDataURL('image/jpeg', 0.82);
    if (out.length > 580000) out = canvas.toDataURL('image/jpeg', 0.62);
    if (out.length > 600000) throw new Error('รูปภาพมีขนาดใหญ่เกินไป กรุณาใช้รูปที่เล็กลง');
    return out;
  }

  function renderDockVisibility() {
    if (!dom) return;
    const canShow = Boolean(state.isUserAccount && state.username && !state.requiresLogin);
    dom.root.hidden = !canShow;
    if (!canShow) {
      state.isOpen = false;
      dom.panel.classList.remove('open');
      dom.launcher.hidden = false;
      document.body.classList.remove('pm-support-visible', 'pm-support-open');
      return;
    }
    const overLock = state.accessStatus === 'pending' || state.accessStatus === 'revoked';
    dom.root.classList.toggle('over-lock-overlay', overLock);
    dom.userChip.textContent = '@' + state.username;
    dom.subtitle.textContent = '@' + state.username + ' • ซิงค์ประวัติทุกเครื่อง';
    dom.launcher.hidden = state.isOpen;
    dom.panel.classList.toggle('open', state.isOpen);
    document.body.classList.add('pm-support-visible');
    document.body.classList.toggle('pm-support-open', Boolean(state.isOpen));

    const cnt = Number(state.unreadCount || 0);
    dom.badge.textContent = cnt > 99 ? '99+' : String(cnt);
    dom.badge.hidden = cnt <= 0;
  }

  function renderMessages(forceScroll = false) {
    if (!dom) return;
    const box = dom.messagesEl;
    const nearBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 90;

    if (!state.messages.length) {
      const empty = createEl(
        'div',
        'pm-support-empty',
        '💬 ยินดีต้อนรับสู่กล่องแชทแจ้งปัญหา\nพิมพ์ข้อความหรือกด 📷 / Ctrl+V แนบรูปภาพส่งหาแอดมินได้ทันที\nประวัติข้อความจะแสดงเหมือนกันทุกเครื่องที่ล็อกอิน ID @' + (state.username || '')
      );
      box.replaceChildren(empty);
      return;
    }

    const lastUserMsg = [...state.messages].reverse().find(m => m.sender !== 'admin');
    const frag = document.createDocumentFragment();
    for (const m of state.messages) {
      const isMe = m.sender !== 'admin';
      const row = createEl('div', 'pm-support-row ' + (isMe ? 'me' : 'admin'));
      const col = createEl('div', 'pm-support-msg-col');
      const senderText = isMe
        ? (m.machineName ? ('🖥️ ' + m.machineName) : 'คุณ')
        : '👨‍💻 แอดมิน';
      col.append(createEl('div', 'pm-support-sender-tag', senderText));

      const bubble = createEl('div', 'pm-support-bubble');
      if (m.body) {
        bubble.append(createEl('div', 'pm-support-bubble-text', m.body));
      }
      if (m.imageDataUrl) {
        const im = createEl('img', 'pm-support-bubble-img');
        im.src = m.imageDataUrl;
        im.alt = 'รูปภาพประกอบ';
        im.addEventListener('click', () => {
          dom.lightboxImg.src = m.imageDataUrl;
          dom.lightbox.hidden = false;
        });
        bubble.append(im);
      }
      col.append(bubble);

      const t = formatTime(m.createdAt);
      const seen = (isMe && lastUserMsg && m.id === lastUserMsg.id && Number(state.adminLastReadId || 0) >= m.id)
        ? ' • ✓ แอดมินอ่านแล้ว'
        : '';
      col.append(createEl('div', 'pm-support-time', t + seen));
      row.append(col);
      frag.append(row);
    }

    box.replaceChildren(frag);
    if (forceScroll || nearBottom) {
      box.scrollTop = box.scrollHeight;
    }
  }

  async function markAsRead(upToId) {
    const targetId = Math.max(0, Number(upToId || state.lastMessageId || 0));
    if (!targetId) return;
    try {
      const res = await fetch('/api/support/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upToId: targetId })
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.success) {
        state.unreadCount = Number(data.unreadCount || 0);
        state.userLastReadId = Number(data.userLastReadId || targetId);
        renderDockVisibility();
      }
    } catch (_) {}
  }

  async function pollMessages(forceFull = false) {
    if (!state.isUserAccount || !state.username || state.requiresLogin) return;
    if (state.pollBusy && !forceFull) return;
    state.pollBusy = true;
    try {
      const afterId = forceFull ? 0 : Number(state.lastMessageId || 0);
      const res = await fetch('/api/support/poll?afterId=' + afterId, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.success) return;

      const incoming = Array.isArray(data.messages) ? data.messages : [];
      if (afterId === 0) {
        state.messages = incoming;
      } else if (incoming.length) {
        const known = new Set(state.messages.map(m => m.id));
        for (const m of incoming) {
          if (!known.has(m.id)) state.messages.push(m);
        }
      }
      if (state.messages.length) {
        state.lastMessageId = Math.max(state.lastMessageId, ...state.messages.map(m => Number(m.id || 0)));
      } else {
        state.lastMessageId = Math.max(state.lastMessageId, Number(data.lastMessageId || 0));
      }
      state.unreadCount = Number(data.unreadCount || 0);
      state.adminLastReadId = Math.max(state.adminLastReadId, Number(data.adminLastReadId || 0));
      state.userLastReadId = Math.max(state.userLastReadId, Number(data.userLastReadId || 0));

      renderDockVisibility();
      renderMessages(forceFull || incoming.length > 0);

      if (state.isOpen && !document.hidden && state.unreadCount > 0 && state.lastMessageId > 0) {
        await markAsRead(state.lastMessageId);
      }
    } catch (_) {
    } finally {
      state.pollBusy = false;
    }
  }

  async function openChat() {
    mountDom();
    state.isOpen = true;
    showError('');
    renderDockVisibility();
    renderMessages(true);
    setTimeout(() => dom?.textarea?.focus(), 60);
    await pollMessages(state.messages.length === 0);
    if (state.unreadCount > 0 && state.lastMessageId > 0) {
      await markAsRead(state.lastMessageId);
    }
  }

  function closeChat() {
    state.isOpen = false;
    renderDockVisibility();
  }

  async function sendMessage() {
    if (!dom || state.sendBusy) return;
    if (!state.isUserAccount || !state.username || state.requiresLogin) return;
    const bodyText = String(dom.textarea.value || '').trim();
    const imgData = state.pendingImage || '';
    if (!bodyText && !imgData) return;

    state.sendBusy = true;
    dom.sendBtn.disabled = true;
    showError('');
    try {
      const res = await fetch('/api/support/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: bodyText, imageDataUrl: imgData })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || 'ส่งข้อความไม่สำเร็จ');
      }
      dom.textarea.value = '';
      setPendingImage('');
      if (data.message) {
        if (!state.messages.some(m => m.id === data.message.id)) {
          state.messages.push(data.message);
        }
        state.lastMessageId = Math.max(state.lastMessageId, Number(data.message.id || 0));
      }
      state.unreadCount = 0;
      renderDockVisibility();
      renderMessages(true);
    } catch (err) {
      showError(err.message || 'ส่งข้อความไม่สำเร็จ');
    } finally {
      state.sendBusy = false;
      dom.sendBtn.disabled = false;
      dom.textarea.focus();
    }
  }

  function handleAccessState(raw) {
    if (!raw || typeof raw !== 'object') return;
    mountDom();
    const nextUser = String(raw.username || '').trim();
    const nextIsUser = Boolean(raw.isUserAccount && nextUser);
    const nextReqLogin = Boolean(raw.requiresLogin || !nextIsUser);
    const nextStatus = String(raw.accessStatus || 'approved');
    const userChanged = nextUser.toLowerCase() !== state.username.toLowerCase() || (!nextIsUser && state.isUserAccount);

    state.username = nextUser;
    state.isUserAccount = nextIsUser;
    state.requiresLogin = nextReqLogin;
    state.accessStatus = nextStatus;

    if (userChanged) {
      state.messages = [];
      state.lastMessageId = 0;
      state.unreadCount = 0;
      state.adminLastReadId = 0;
      state.userLastReadId = 0;
      setPendingImage('');
      showError('');
      if (!nextIsUser || nextReqLogin) {
        state.isOpen = false;
      }
    }

    renderDockVisibility();
    if (nextIsUser && !nextReqLogin && (userChanged || state.lastMessageId === 0)) {
      pollMessages(true);
    }
  }

  function startLoop() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(() => {
      if (document.hidden) return;
      if (state.isUserAccount && state.username && !state.requiresLogin) {
        pollMessages(false);
      }
    }, POLL_INTERVAL_MS);
  }

  async function init() {
    mountDom();
    window.addEventListener('pm-access-state-changed', (e) => {
      if (e && e.detail) handleAccessState(e.detail);
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.isUserAccount && state.username && !state.requiresLogin) {
        pollMessages(false);
      }
    });

    if (typeof window.__getAccessUiState === 'function') {
      const snap = window.__getAccessUiState();
      if (snap && (snap.username || snap.requiresLogin !== undefined)) {
        handleAccessState(snap);
      }
    }
    try {
      const res = await fetch('/api/access/status', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data) handleAccessState(data);
      }
    } catch (_) {}
    startLoop();
  }

  window.__pmSupportChat = {
    open: openChat,
    close: closeChat,
    poll: () => pollMessages(false),
    getState: () => ({
      username: state.username,
      isOpen: state.isOpen,
      unreadCount: state.unreadCount,
      messageCount: state.messages.length,
      lastMessageId: state.lastMessageId
    })
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
