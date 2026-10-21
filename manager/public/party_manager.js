// PmheeAether Manager — Party drawer (crown tab on the left edge). Backend: manager/party_api.js
(function () {
  'use strict';
  const API = (typeof API_BASE === 'string' ? API_BASE : '') + '/api/parties';
  const EXP = { 'even-share': 'แชร์กัน (มีโบนัส)', individual: 'รับใครรับมัน' };
  const LOOT = { personal: 'คนตีมากสุด', 'round-robin': 'วนกันรับ', leader: 'หัวหน้า' };
  const CROWN = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 7.5l4.2 3.6L12 4l4.8 7.1L21 7.5l-1.8 10.2H4.8L3 7.5zm2 12.2h14v1.8H5v-1.8z"/></svg>';
  const CROWN_SM = CROWN.replace('<svg', '<svg width="16" height="16"');

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (t, k) => (typeof window.showToast === 'function' ? window.showToast(t, k) : console.log('[Party]', t));
  const hue = s => { let h = 0; for (const c of String(s || '?')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const initial = s => (String(s || '?').trim()[0] || '?').toUpperCase();
  const setText = (el, txt) => { if (el && el.textContent !== String(txt)) el.textContent = String(txt); };
  const setHtml = (el, html) => { if (el && el.innerHTML !== html) el.innerHTML = html; };

  let data = { parties: [], clients: [], maxMembers: 6 };
  let open = false, pollTimer = null, busy = false, pointerDown = false, pendingRender = false;
  const collapsedParties = new Set();
  let pickerState = { mode: 'leader', partyId: null };

  function build() {
    const tab = document.createElement('button');
    tab.className = 'pt-tab'; tab.id = 'pt-tab'; tab.type = 'button';
    tab.title = 'ปาร์ตี้'; tab.setAttribute('aria-label', 'เปิดหน้าจัดปาร์ตี้');
    tab.innerHTML = CROWN + '<span class="pt-tab-badge" id="pt-tab-badge"></span>';
    const scrim = document.createElement('div'); scrim.className = 'pt-scrim'; scrim.id = 'pt-scrim';
    const drawer = document.createElement('aside');
    drawer.className = 'pt-drawer'; drawer.id = 'pt-drawer'; drawer.setAttribute('aria-label', 'จัดปาร์ตี้');
    drawer.innerHTML = `
      <header class="pt-head">
        <div class="pt-head-icon">${CROWN}</div>
        <div><h2>ปาร์ตี้</h2><p>จัดตี้อัตโนมัติหรือเลือกคนเอง สูงสุด 6 คนรวมหัวตี้</p></div>
        <button class="pt-close" id="pt-close" type="button" aria-label="ปิด">✕</button>
      </header>
      <div class="pt-ch-mode-bar" style="padding:8px 14px; background:rgba(15,23,42,0.75); border-bottom:1px solid rgba(255,255,255,0.08); display:flex; align-items:center; gap:8px; font-size:11.5px;">
        <label for="pt-channel-check-mode" style="color:#94a3b8; white-space:nowrap; font-weight:600;">📡 โหมดเช็ค CH:</label>
        <select id="pt-channel-check-mode" style="flex:1; background:#0f172a; color:#e2e8f0; border:1px solid rgba(56,189,248,0.35); border-radius:6px; padding:4px 8px; font-size:11.5px; outline:none; cursor:pointer;" title="เมื่อมีคนในตี้กลับมาแมพฟาร์ม ระบบจะเลือก CH คนน้อยสุดให้ (โดยไม่ทับ CH ตี้อื่นของเรา) และดึงคนในตี้ที่เหลือย้ายตาม">
          <option value="always">⚡ ทุกครั้งที่เข้าแมพฟาร์ม: ย้าย CH คนน้อยสุด + ดึงตี้ตาม (ขายของ/ตาย/กลับจากเมือง)</option>
          <option value="all">🔄 หลังขายของ: ย้าย CH คนน้อยสุด + ดึงตี้ตาม (ทุกจอ)</option>
          <option value="party_only">👑 เฉพาะปาร์ตี้: หลังขายของย้าย CH คนน้อยสุด + ดึงตี้ตาม</option>
          <option value="solo_only">👤 เฉพาะฟาร์มเดี่ยว: เช็ค CH คนน้อยสุดหลังขายของ</option>
          <option value="off">⏸️ ปิด (ไม่เช็ค/ไม่ย้าย CH หลังขายของ)</option>
        </select>
      </div>
      <div class="pt-body" id="pt-body"></div>
      <footer class="pt-foot">
        <button class="pt-add" id="pt-add" type="button">➕ เพิ่มตี้</button>
        <div class="pt-foot-hint">เลือกหัวตี้ แล้วให้ระบบดึงคนอัตโนมัติหรือกดเลือกสมาชิกเองก็ได้<br>ตั้งให้ลูกทีมแยกตีอิสระ หรือเดินตามช่วยตีหัวตี้/คนในตี้ได้รายคน</div>
      </footer>
      <section class="pt-picker" id="pt-picker" hidden>
        <div class="pt-picker-head">
          <button class="pt-iconbtn" id="pt-pick-back" type="button" aria-label="กลับ">←</button>
          <h3 id="pt-picker-title">เลือกหัวตี้</h3>
        </div>
        <input class="pt-search" id="pt-search" type="search" placeholder="ค้นหาชื่อจอ / ชื่อตัวละคร" autocomplete="off">
        <div class="pt-pick-list" id="pt-pick-list"></div>
      </section>`;
    document.body.append(tab, scrim, drawer);

    tab.addEventListener('click', () => setOpen(true));
    scrim.addEventListener('click', () => setOpen(false));
    drawer.querySelector('#pt-close').addEventListener('click', () => setOpen(false));
    const chModeSel = drawer.querySelector('#pt-channel-check-mode');
    if (chModeSel) {
      chModeSel.addEventListener('change', () => {
        if (typeof window.setChannelCheckMode === 'function') {
          window.setChannelCheckMode(chModeSel.value);
        }
      });
    }
    drawer.querySelector('#pt-add').addEventListener('click', () => openPicker({ mode: 'leader', partyId: null }));
    drawer.querySelector('#pt-pick-back').addEventListener('click', closePicker);
    drawer.querySelector('#pt-search').addEventListener('input', renderPicker);
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !open) return;
      if (!document.getElementById('pt-picker').hidden) closePicker(); else setOpen(false);
    });
    drawer.addEventListener('pointerdown', () => { pointerDown = true; });
    window.addEventListener('pointerup', () => {
      if (!pointerDown) return;
      pointerDown = false;
      if (pendingRender) { pendingRender = false; render(); }
    });
    window.addEventListener('pointercancel', () => {
      if (!pointerDown) return;
      pointerDown = false;
      if (pendingRender) { pendingRender = false; render(); }
    });
    drawer.querySelector('#pt-body').addEventListener('change', onChange);
    drawer.querySelector('#pt-body').addEventListener('click', onClick);
    drawer.querySelector('#pt-pick-list').addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      if (pickerState.mode === 'member' && pickerState.partyId) {
        addMemberToParty(pickerState.partyId, b.dataset.pick);
      } else {
        createParty(b.dataset.pick);
      }
    });
  }

  function setOpen(v) {
    open = v;
    if (v) document.body.classList.remove('pm-open', 'gd-open');
    document.body.classList.toggle('pt-open', v);
    clearInterval(pollTimer);
    if (v) { load(); pollTimer = setInterval(load, 5000); }
    else { closePicker(); pollTimer = setInterval(load, 10000); }
  }
  window.openPartyDrawer = () => setOpen(true);
  window.refreshPartyManagerData = () => load();

  async function api(path, body) {
    const res = await fetch(API + path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({ success: false, error: 'HTTP ' + res.status }));
    if (j && Array.isArray(j.parties)) {
      data = j;
      window.__partyManagerData = j;
      if (typeof window.onPartyDataUpdated === 'function') {
        try { window.onPartyDataUpdated(j); } catch (_) {}
      }
      if (pointerDown && body === undefined) pendingRender = true;
      else render();
    }
    return j;
  }

  async function load() {
    if (busy || pointerDown) return;
    try { await api(''); } catch (e) { /* Manager restarting */ }
  }

  function buildFollowOptions(m, p) {
    const opts = [
      { value: 'none', label: '⚔️ แยกตีอิสระ' },
      { value: 'leader', label: '👑 ตามหัวตี้' }
    ];
    for (const other of (p && p.members) || []) {
      if (!other || other.id === m.id) continue;
      const nm = other.charName || other.profileName || other.id;
      opts.push({ value: 'member:' + other.id, label: '👣 ตาม ' + nm });
    }
    return opts;
  }

  function createMemberRowEl(m, p, isLeader) {
    const pid = p.id;
    const row = document.createElement('div');
    row.className = 'pt-row' + (isLeader ? ' leader' : '');
    row.dataset.rowKey = isLeader ? 'leader:' + m.id : 'member:' + m.id;
    row.innerHTML = `
      <div class="pt-ava"></div>
      <div class="pt-who">
        <div class="pt-name"><span class="pt-name-txt"></span><span class="pt-lv" hidden></span></div>
        <div class="pt-sub"></div>
      </div>
      ${isLeader ? '' : `<select class="pt-follow-select" data-set="memberFollow" data-party="${esc(pid)}" data-member="${esc(m.id)}" title="เลือกโหมดเดินตาม / ช่วยตี"></select>`}
      <span class="pt-status"></span>
      ${isLeader ? '' : `<button class="pt-rm" type="button" title="เอาออกจากตี้" data-act="remove" data-party="${esc(pid)}" data-id="${esc(m.id)}">✕</button>`}`;
    patchMemberRowEl(row, m, p, isLeader);
    return row;
  }

  function patchMemberRowEl(row, m, p, isLeader) {
    const pid = p.id;
    const displayName = m.charName || m.profileName || '?';
    const sub = [m.profileName, m.mapName ? m.mapName + (m.channel ? ' · CH ' + m.channel : '') : null].filter(Boolean).join(' · ');
    const ava = row.querySelector('.pt-ava');
    if (ava) {
      const h = String(hue(displayName));
      if (ava.style.getPropertyValue('--pt-h') !== h) ava.style.setProperty('--pt-h', h);
      if (isLeader) setHtml(ava, CROWN_SM);
      else setText(ava, initial(displayName));
    }
    const nameTxt = row.querySelector('.pt-name-txt');
    setText(nameTxt, displayName);
    const lvEl = row.querySelector('.pt-lv');
    if (lvEl) {
      if (m.level) {
        lvEl.hidden = false;
        setText(lvEl, 'Lv.' + m.level);
      } else {
        lvEl.hidden = true;
      }
    }
    setText(row.querySelector('.pt-sub'), sub);
    const followSel = row.querySelector('.pt-follow-select');
    if (followSel) {
      if (followSel.dataset.party !== String(pid)) followSel.dataset.party = String(pid);
      if (followSel.dataset.member !== String(m.id)) followSel.dataset.member = String(m.id);
      const opts = buildFollowOptions(m, p);
      const curMode = opts.some(o => o.value === m.followMode) ? m.followMode : 'none';
      const sig = opts.map(o => o.value + ':' + o.label).join('|');
      if (document.activeElement !== followSel) {
        if (followSel.dataset.optSig !== sig) {
          followSel.dataset.optSig = sig;
          followSel.innerHTML = opts.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
        }
        if (followSel.value !== curMode) followSel.value = curMode;
      }
      followSel.classList.toggle('is-following', curMode !== 'none');
    }
    const st = row.querySelector('.pt-status');
    if (st) {
      const nextCls = 'pt-status ' + (m.status || '');
      if (st.className !== nextCls) st.className = nextCls;
      setText(st, m.statusText || '');
    }
    const rmBtn = row.querySelector('.pt-rm');
    if (rmBtn) {
      if (rmBtn.dataset.party !== String(pid)) rmBtn.dataset.party = String(pid);
      if (rmBtn.dataset.id !== String(m.id)) rmBtn.dataset.id = String(m.id);
    }
  }

  function createCardEl(p) {
    const opt = (map, cur) => Object.keys(map).map(k => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(map[k])}</option>`).join('');
    const el = document.createElement('article');
    el.className = 'pt-card';
    el.dataset.party = String(p.id);
    el.innerHTML = `
      <div class="pt-card-top">
        <span class="pt-card-title"></span>
        <span class="pt-count"></span>
        <button class="pt-iconbtn pt-add-member-btn" type="button" title="เลือกสมาชิกเข้าตี้เอง" data-act="pick-member" data-party="${esc(p.id)}">➕</button>
        <button class="pt-iconbtn" type="button" title="รวมทีม (เรียกสมาชิกมาหาหัวตี้)" data-act="summon" data-party="${esc(p.id)}">⤓</button>
        <button class="pt-iconbtn danger" type="button" title="ยุบตี้" data-act="delete" data-party="${esc(p.id)}">🗑</button>
      </div>
      <div class="pt-leader-box"></div>
      <button class="pt-expand-bar" type="button" data-act="toggle-members" data-party="${esc(p.id)}" aria-expanded="true">
        <span class="pt-expand-summary"></span>
        <span class="pt-expand-label"></span>
      </button>
      <div class="pt-members-wrap">
        <div class="pt-members"></div>
        <button class="pt-row pt-slot" type="button" data-act="pick-member" data-party="${esc(p.id)}" hidden>
          <div class="pt-ava">+</div>
          <div class="pt-who pt-slot-text"></div>
          <span class="pt-slot-cta">+ เลือกคนเข้าตี้</span>
        </button>
      </div>
      <div class="pt-modes">
        <div class="pt-field"><label for="pt-exp-${esc(p.id)}">โหมด EXP</label>
          <select id="pt-exp-${esc(p.id)}" data-set="expMode" data-party="${esc(p.id)}">${opt(EXP, p.expMode)}</select></div>
        <div class="pt-field"><label for="pt-loot-${esc(p.id)}">โหมดไอเทม</label>
          <select id="pt-loot-${esc(p.id)}" data-set="lootMode" data-party="${esc(p.id)}">${opt(LOOT, p.lootMode)}</select></div>
      </div>
      <div class="pt-toggles">
        <label class="pt-toggle"><input type="checkbox" data-set="syncMap" data-party="${esc(p.id)}" ${p.syncMap ? 'checked' : ''}>ตามแมพ + CH หัวตี้</label>
        <label class="pt-toggle"><input type="checkbox" data-set="autoFill" data-party="${esc(p.id)}" ${p.autoFill ? 'checked' : ''}>เติมสมาชิกอัตโนมัติ</label>
      </div>
      <div class="pt-notes" hidden></div>`;
    patchCardEl(el, p);
    return el;
  }

  function patchCardEl(cardEl, p) {
    const full = p.count >= p.max;
    const slots = Math.max(0, p.max - p.count);
    const evenBlocked = p.inGame && p.inGame.evenShareAllowed === false;
    const isExpanded = !collapsedParties.has(String(p.id));

    setText(cardEl.querySelector('.pt-card-title'), 'ตี้ ' + p.index);
    const cnt = cardEl.querySelector('.pt-count');
    if (cnt) {
      const nextCls = 'pt-count' + (full ? ' full' : '');
      if (cnt.className !== nextCls) cnt.className = nextCls;
      setText(cnt, p.count + '/' + p.max);
    }
    const addMemberBtn = cardEl.querySelector('.pt-add-member-btn');
    if (addMemberBtn) {
      addMemberBtn.hidden = full;
    }

    // Leader row (always visible)
    const leaderBox = cardEl.querySelector('.pt-leader-box');
    if (leaderBox && p.leader) {
      let leaderRow = leaderBox.firstElementChild;
      const leaderKey = 'leader:' + p.leader.id;
      if (leaderRow && leaderRow.dataset && leaderRow.dataset.rowKey === leaderKey) {
        patchMemberRowEl(leaderRow, p.leader, p, true);
      } else {
        leaderBox.innerHTML = '';
        leaderBox.appendChild(createMemberRowEl(p.leader, p, true));
      }
    }

    // Expand/collapse toggle bar for non-leader members
    const membersList = p.members || [];
    const maxFollowers = Math.max(0, (p.max || 6) - 1);
    const joinedCnt = membersList.filter(m => m.status === 'joined' || m.status === 'apart').length;
    const pendingCnt = membersList.length - joinedCnt;
    const summaryParts = [`👥 ลูกทีม ${membersList.length}/${maxFollowers} คน`];
    if (joinedCnt > 0) summaryParts.push(`ในตี้ ${joinedCnt}`);
    if (pendingCnt > 0) summaryParts.push(`รอเข้าตี้ ${pendingCnt}`);
    if (slots > 0) summaryParts.push(`ว่าง ${slots} ที่`);

    const expandBar = cardEl.querySelector('.pt-expand-bar');
    if (expandBar) {
      if (expandBar.getAttribute('aria-expanded') !== String(isExpanded)) {
        expandBar.setAttribute('aria-expanded', String(isExpanded));
      }
      expandBar.classList.toggle('open', isExpanded);
      setText(expandBar.querySelector('.pt-expand-summary'), summaryParts.join(' · '));
      setText(expandBar.querySelector('.pt-expand-label'), isExpanded ? 'ซ่อนลูกทีม ▲' : 'ดูรายชื่อ ▼');
    }

    const membersWrap = cardEl.querySelector('.pt-members-wrap');
    if (membersWrap) {
      membersWrap.hidden = !isExpanded;
    }

    // Reconcile non-leader member rows in-place
    const membersBox = cardEl.querySelector('.pt-members');
    if (membersBox) {
      const desired = membersList.map(m => ({ m, isLeader: false }));
      const existingByKey = new Map();
      Array.from(membersBox.children).forEach(ch => {
        if (ch.dataset && ch.dataset.rowKey) existingByKey.set(ch.dataset.rowKey, ch);
      });
      const nextNodes = desired.map(({ m, isLeader }) => {
        const key = 'member:' + m.id;
        let row = existingByKey.get(key);
        if (row) {
          patchMemberRowEl(row, m, p, isLeader);
          existingByKey.delete(key);
        } else {
          row = createMemberRowEl(m, p, isLeader);
        }
        return row;
      });
      existingByKey.forEach(stale => stale.remove());
      nextNodes.forEach((node, idx) => {
        if (membersBox.children[idx] !== node) membersBox.insertBefore(node, membersBox.children[idx] || null);
      });
    }

    // Empty slots row (clickable to manually add members)
    const slotRow = cardEl.querySelector('.pt-slot');
    if (slotRow) {
      if (slots > 0) {
        slotRow.hidden = false;
        setText(slotRow.querySelector('.pt-slot-text'), `ว่าง ${slots} ที่${p.autoFill ? ' · ระบบเติมอัตโนมัติ หรือคลิกเพื่อเลือกเอง' : ' · คลิกเพื่อเลือกสมาชิกเข้าตี้'}`);
      } else {
        slotRow.hidden = true;
      }
    }

    // Update selects and checkboxes only if not actively focused
    const expSel = cardEl.querySelector('select[data-set="expMode"]');
    if (expSel && document.activeElement !== expSel && expSel.value !== p.expMode) expSel.value = p.expMode;
    const lootSel = cardEl.querySelector('select[data-set="lootMode"]');
    if (lootSel && document.activeElement !== lootSel && lootSel.value !== p.lootMode) lootSel.value = p.lootMode;

    const syncCb = cardEl.querySelector('input[data-set="syncMap"]');
    if (syncCb && syncCb.checked !== Boolean(p.syncMap)) syncCb.checked = Boolean(p.syncMap);
    const fillCb = cardEl.querySelector('input[data-set="autoFill"]');
    if (fillCb && fillCb.checked !== Boolean(p.autoFill)) fillCb.checked = Boolean(p.autoFill);

    // Notes
    const notesBox = cardEl.querySelector('.pt-notes');
    if (notesBox) {
      const notesList = (p.notes || []).slice();
      if (evenBlocked && p.expMode === 'even-share' && !notesList.some(n => n.includes('แชร์ EXP'))) {
        notesList.push(`แชร์ EXP ได้เมื่อเลเวลต่างกันไม่เกิน ${p.inGame.levelRange}`);
      }
      if (notesList.length) {
        notesBox.hidden = false;
        const notesHtml = notesList.map(n => `<div class="pt-note">${esc(n)}</div>`).join('');
        setHtml(notesBox, notesHtml);
      } else {
        notesBox.hidden = true;
        setHtml(notesBox, '');
      }
    }
  }

  function render() {
    const badge = document.getElementById('pt-tab-badge');
    if (badge) setText(badge, data.parties.length ? String(data.parties.length) : '');
    const chSel = document.getElementById('pt-channel-check-mode');
    if (chSel && data.channelCheckMode && document.activeElement !== chSel && chSel.value !== data.channelCheckMode) {
      chSel.value = data.channelCheckMode;
    }
    const body = document.getElementById('pt-body');
    if (!body) return;

    if (!data.parties.length) {
      if (!body.querySelector('.pt-empty')) {
        body.innerHTML = `<div class="pt-empty">ยังไม่มีปาร์ตี้<br>กด <b>➕ เพิ่มตี้</b> ด้านล่างเพื่อเลือกหัวตี้</div>`;
      }
    } else {
      const emptyEl = body.querySelector('.pt-empty');
      if (emptyEl) emptyEl.remove();

      const existingCards = new Map();
      Array.from(body.querySelectorAll('.pt-card')).forEach(el => {
        existingCards.set(el.dataset.party, el);
      });

      const nextCards = data.parties.map(p => {
        const key = String(p.id);
        let cardEl = existingCards.get(key);
        if (cardEl) {
          patchCardEl(cardEl, p);
          existingCards.delete(key);
        } else {
          cardEl = createCardEl(p);
        }
        return cardEl;
      });

      existingCards.forEach(stale => stale.remove());
      nextCards.forEach((cardEl, idx) => {
        if (body.children[idx] !== cardEl) body.insertBefore(cardEl, body.children[idx] || null);
      });
    }

    const free = data.clients.filter(c => !c.assigned);
    const add = document.getElementById('pt-add');
    if (add) {
      add.disabled = !free.length;
      add.title = free.length ? '' : 'ทุกจออยู่ในตี้แล้ว';
    }
    const picker = document.getElementById('pt-picker');
    if (picker && !picker.hidden) renderPicker();
  }

  function openPicker(opts) {
    pickerState = Object.assign({ mode: 'leader', partyId: null }, opts || {});
    const pk = document.getElementById('pt-picker');
    pk.hidden = false;
    const s = document.getElementById('pt-search'); s.value = ''; renderPicker(); setTimeout(() => s.focus(), 50);
  }
  function closePicker() {
    const pk = document.getElementById('pt-picker');
    if (pk) pk.hidden = true;
    pickerState = { mode: 'leader', partyId: null };
  }

  function createPickBtn(c) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.pick = String(c.id);
    btn.innerHTML = `
      <div class="pt-ava"></div>
      <div class="pt-who">
        <div class="pt-name"><span class="pt-name-txt"></span><span class="pt-lv" hidden></span></div>
        <div class="pt-sub"></div>
      </div>
      <span class="pt-go"></span>`;
    patchPickBtn(btn, c);
    return btn;
  }

  function patchPickBtn(btn, c) {
    const nextCls = 'pt-pick' + (c.online ? '' : ' off');
    if (btn.className !== nextCls) btn.className = nextCls;
    const displayName = c.charName || c.name || '?';
    const ava = btn.querySelector('.pt-ava');
    if (ava) {
      const h = String(hue(displayName));
      if (ava.style.getPropertyValue('--pt-h') !== h) ava.style.setProperty('--pt-h', h);
      setText(ava, initial(displayName));
    }
    setText(btn.querySelector('.pt-name-txt'), displayName);
    const lv = btn.querySelector('.pt-lv');
    if (lv) {
      if (c.level) {
        lv.hidden = false;
        setText(lv, 'Lv.' + c.level);
      } else {
        lv.hidden = true;
      }
    }
    const sub = [
      c.name,
      c.online ? (c.mapName ? c.mapName + (c.channel ? ' · CH ' + c.channel : '') : 'ออนไลน์') : 'ออฟไลน์',
      c.inGameParty ? 'มีตี้ในเกมอยู่แล้ว' : null,
      c.planPending ? 'แผนยังเก็บเลเวล (' + c.planPending + ')' : null
    ].filter(Boolean).join(' · ');
    setText(btn.querySelector('.pt-sub'), sub);
    setText(btn.querySelector('.pt-go'), pickerState.mode === 'member' ? '+ เพิ่มเข้าตี้' : 'เลือก →');
  }

  function renderPicker() {
    const titleEl = document.getElementById('pt-picker-title');
    const targetParty = pickerState.mode === 'member' && pickerState.partyId
      ? data.parties.find(p => String(p.id) === String(pickerState.partyId))
      : null;
    if (titleEl) {
      if (targetParty) {
        const slots = Math.max(0, (targetParty.max || 6) - targetParty.count);
        setText(titleEl, `เพิ่มสมาชิกเข้าตี้ ${targetParty.index} (ว่าง ${slots} ที่)`);
      } else {
        setText(titleEl, 'เลือกหัวตี้');
      }
    }
    const leaderLv = targetParty && targetParty.leader && typeof targetParty.leader.level === 'number' ? targetParty.leader.level : null;
    const q = (document.getElementById('pt-search').value || '').trim().toLowerCase();
    const list = data.clients
      .filter(c => !c.assigned)
      .filter(c => !q || String(c.name).toLowerCase().includes(q) || String(c.charName || '').toLowerCase().includes(q))
      .sort((a, b) => {
        if (b.online !== a.online) return b.online - a.online;
        if (leaderLv != null && typeof a.level === 'number' && typeof b.level === 'number') {
          const da = Math.abs(a.level - leaderLv), db = Math.abs(b.level - leaderLv);
          if (da !== db) return da - db;
        }
        return ((b.level || 0) - (a.level || 0)) || String(a.name).localeCompare(String(b.name));
      });
    const el = document.getElementById('pt-pick-list');
    if (!el) return;

    if (!list.length) {
      if (!el.querySelector('.pt-empty')) {
        el.innerHTML = `<div class="pt-empty">ไม่มีจอที่ว่าง — ทุกจออยู่ในตี้แล้ว</div>`;
      }
      return;
    }
    const emptyEl = el.querySelector('.pt-empty');
    if (emptyEl) emptyEl.remove();

    const existing = new Map();
    Array.from(el.querySelectorAll('.pt-pick')).forEach(b => existing.set(b.dataset.pick, b));
    const nextBtns = list.map(c => {
      const key = String(c.id);
      let btn = existing.get(key);
      if (btn) {
        patchPickBtn(btn, c);
        existing.delete(key);
      } else {
        btn = createPickBtn(c);
      }
      return btn;
    });
    existing.forEach(stale => stale.remove());
    nextBtns.forEach((btn, idx) => {
      if (el.children[idx] !== btn) el.insertBefore(btn, el.children[idx] || null);
    });
  }

  async function createParty(leaderId) {
    busy = true;
    try {
      const r = await api('', { leaderId });
      if (r.success === false) toast(r.error || 'เพิ่มตี้ไม่สำเร็จ', 'error');
      else { toast('เพิ่มตี้แล้ว กำลังชวนสมาชิกที่เลเวลใกล้กัน', 'success'); closePicker(); }
    } finally { busy = false; }
  }

  async function addMemberToParty(partyId, profileId) {
    busy = true;
    try {
      collapsedParties.delete(String(partyId));
      const r = await api('/' + encodeURIComponent(partyId) + '/add-member', { profileId });
      if (r.success === false) {
        toast(r.error || 'เพิ่มสมาชิกไม่สำเร็จ', 'error');
        return;
      }
      const updatedParty = (data.parties || []).find(p => String(p.id) === String(partyId));
      const freeLeft = (data.clients || []).some(c => !c.assigned);
      toast('เพิ่มสมาชิกเข้าตี้แล้ว กำลังชวนในเกม', 'success');
      if (!updatedParty || updatedParty.count >= updatedParty.max || !freeLeft) {
        closePicker();
      } else {
        renderPicker();
      }
    } finally { busy = false; }
  }

  async function onChange(e) {
    const t = e.target; if (!t.dataset.set) return;
    busy = true;
    try {
      let payload;
      if (t.dataset.set === 'memberFollow') {
        payload = { memberFollow: { profileId: t.dataset.member, mode: t.value } };
      } else {
        const v = t.type === 'checkbox' ? t.checked : t.value;
        payload = { [t.dataset.set]: v };
      }
      const r = await api('/' + encodeURIComponent(t.dataset.party) + '/settings', payload);
      if (r.success === false) toast(r.error || 'บันทึกไม่สำเร็จ', 'error');
      else if (t.dataset.set === 'memberFollow') {
        toast(t.value === 'none' ? 'เปลี่ยนเป็นโหมดแยกตีอิสระแล้ว' : 'ตั้งค่าโหมดเดินตามแล้ว', 'success');
      }
    } finally { busy = false; t.blur(); }
  }

  async function onClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const rawPid = String(b.dataset.party || '');
    const pid = encodeURIComponent(rawPid);
    if (b.dataset.act === 'toggle-members') {
      if (collapsedParties.has(rawPid)) collapsedParties.delete(rawPid);
      else collapsedParties.add(rawPid);
      render();
      return;
    }
    if (b.dataset.act === 'pick-member') {
      collapsedParties.delete(rawPid);
      openPicker({ mode: 'member', partyId: rawPid });
      return;
    }
    if (b.dataset.act === 'delete') {
      if (!confirm('ยุบตี้นี้? สมาชิกทุกจอจะออกจากปาร์ตี้ในเกม')) return;
      collapsedParties.delete(rawPid);
      const r = await api('/' + pid + '/delete', {});
      toast(r.success === false ? (r.error || 'ยุบตี้ไม่สำเร็จ') : 'ยุบตี้แล้ว', r.success === false ? 'error' : 'success');
    } else if (b.dataset.act === 'remove') {
      const r = await api('/' + pid + '/remove-member', { profileId: b.dataset.id });
      toast(r.success === false ? (r.error || 'เอาออกไม่สำเร็จ') : 'เอาออกจากตี้แล้ว (กด + เลือกคนเข้าตี้ เพื่อดึงกลับได้ตลอด)', r.success === false ? 'error' : 'success');
    } else if (b.dataset.act === 'summon') {
      const r = await api('/' + pid + '/summon', {});
      toast(r.success === false ? (r.error || 'รวมทีมไม่สำเร็จ') : 'หัวตี้เรียกสมาชิกมารวมแล้ว', r.success === false ? 'error' : 'success');
    }
  }

  function init() { build(); setOpen(false); load(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
