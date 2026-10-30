// PmheeAether Manager — Card Market Price & Velocity Tracker + Multi-Card Farm Map Distributor (card_manager.js)
// Backend: manager/card_market_api.js + Central DB (/v1/aetheria/machine/card-market)
(function () {
  'use strict';

  const API = (typeof API_BASE === 'string' ? API_BASE : '') + '/api/cards';

  const CARD_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="4" y="3" width="13" height="18" rx="2.5" fill="rgba(251,191,36,0.14)"/>' +
    '<path d="M17 6h1.5A2.5 2.5 0 0 1 21 8.5v10a2.5 2.5 0 0 1-2.5 2.5H9"/>' +
    '<path d="M10.5 7.5l1.3 2.6 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4 1.3-2.6z" fill="currentColor" stroke="none"/>' +
    '</svg>';

  const esc = s =>
    String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  const toast = (t, k) => (typeof window.showToast === 'function' ? window.showToast(t, k) : console.log('[CardMarket]', t));
  const fmt = n => (n == null || isNaN(n) || Number(n) <= 0 ? '—' : Number(n).toLocaleString('th-TH'));

  const SLOT_LABELS = {
    all: 'ทั้งหมด',
    listed: '🟢 มีวางขาย',
    Weapon: '🗡️ อาวุธ',
    Armor: '🥋 เกราะ',
    Shield: '🛡️ โล่',
    Helmet: '🪖 หมวก',
    Cape: '🧣 ผ้าคลุม',
    Boot: '🥾 รองเท้า',
    Accessory: '💍 ประดับ'
  };

  const MAP_LEVEL_LABELS = {
    'สวนนักผจญภัยมือใหม่': 'Lv.1-3',
    'ทุ่งโคลเวอร์': 'Lv.1-5',
    'ทุ่งหญ้าตะวันออก': 'Lv.1-5',
    'ไร่ซันเกรน': 'Lv.1-6',
    'ถนนต้นหลิว': 'Lv.6-12',
    'ทะเลสาบอาซูร์': 'Lv.12-20',
    'ป่ามูนลีฟ': 'Lv.14-22',
    'เส้นทางก็อบลิน': 'Lv.16-20',
    'เหมืองคริสตัลเก่า': 'Lv.18-28',
    'ค่ายออร์ค': 'Lv.22-32',
    'ถ้ำเอมเบอร์': 'Lv.22-32',
    'ที่ราบสูงเกล': 'Lv.25-35',
    'แอ่งเวอร์แดนท์': 'Lv.30-40',
    'ช่องเขาฟรอสต์พีค': 'Lv.35-45',
    'ชายฝั่งปะการัง': 'Lv.40-50',
    'ซากโบราณสถาน': 'Lv.45-55',
    'สุสานเงา': 'Lv.50-60',
    'หนองพิษ': 'Lv.60-70',
    'โบสถ์อเวจี': 'Lv.80-95',
    'บึงรากเน่า': 'Lv.90-105',
    'บัลลังก์ราชาลิช': 'Lv.105',
    'เนินทรายแผดเผา': 'Lv.100-115',
    'พีระมิดจมทราย': 'Lv.115-130',
    'สุสานฟาโรห์': 'Lv.135',
    'แกนลาวา': 'Lv.135-150',
    'แดนลาวา': 'Lv.135-150',
    'ดินแดนน้ำแข็ง': 'Lv.150-160',
    'ที่ราบศิลา': 'Lv.155-165',
    'สุสานรูนโบราณ': 'Lv.165-175',
    'คุกใต้ดินรูน': 'Lv.170-190'
  };

  function getMapLevelLabel(mapName, fallbackMonsterLv) {
    const clean = String(mapName || '')
      .replace(/\s*\(Lv\..*?\)/i, '')
      .replace(/\s*Lv\.\s*\d+(?:-\d+)?/i, '')
      .trim();
    if (!clean) return '';
    if (MAP_LEVEL_LABELS[clean]) return MAP_LEVEL_LABELS[clean];
    if (Number(fallbackMonsterLv) > 0) return `Lv.${Number(fallbackMonsterLv)}`;
    return '';
  }

  function formatMapWithLevel(mapName, fallbackMonsterLv) {
    const raw = String(mapName || '').trim();
    if (!raw) return '';
    if (/Lv\.\s*\d+/i.test(raw)) return raw;
    const lv = getMapLevelLabel(raw, fallbackMonsterLv);
    return lv ? `${raw} ${lv}` : raw;
  }

  let state = {
    cards: [],
    clients: [],
    parties: [],
    overrides: {},
    scanning: false,
    lastFullSweepAt: 0
  };

  let isOpen = false;
  let farmPanelOpen = false;
  let pollTimer = null;
  let searchQuery = '';
  let sortMode = 'velocity_desc';
  let slotFilter = 'all';

  // Multi-card selection state
  const selectedCardIds = new Set(); // Set<number>
  const selectedCardMaps = new Map(); // Map<number, string>
  const selectedProfileIds = new Set(); // Set<string>
  const collapsedClientGroups = new Set(); // Set<string>
  let profilesInitializedForPanel = false;

  function isPriestClassName(cls) {
    return /^(priest|acolyte|พระ)$/i.test(String(cls || '').trim());
  }

  function buildClientPartyGrouping() {
    const liveParties =
      window.__partyManagerData &&
      Array.isArray(window.__partyManagerData.parties) &&
      window.__partyManagerData.parties.length > 0
        ? window.__partyManagerData.parties
        : Array.isArray(state.parties)
        ? state.parties
        : [];

    const clientById = new Map(state.clients.map(c => [String(c.id), c]));
    const roleMap = new Map();
    const partyGroups = [];

    liveParties.forEach((party, idx) => {
      if (!party) return;
      const pIndex = party.index || idx + 1;
      const leaderId = String((party.leader && party.leader.id) || party.leaderId || '');
      const rawMembers = Array.isArray(party.members)
        ? party.members.map(m => (m && m.id ? String(m.id) : '')).filter(Boolean)
        : Array.isArray(party.memberIds)
        ? party.memberIds.map(String).filter(Boolean)
        : [];
      const allIds = Array.from(new Set([leaderId, ...rawMembers].filter(Boolean)));
      const rawSlots = [party.leader, ...(Array.isArray(party.members) ? party.members : [])].filter(Boolean);
      const slotById = new Map(rawSlots.map(s => [String(s.id), s]));

      let anchorPriestId = null;
      for (const pid of allIds) {
        const cl = clientById.get(pid);
        const slot = slotById.get(pid);
        const cls = (cl && cl.charClass) || (slot && slot.charClass) || '';
        if (isPriestClassName(cls)) {
          anchorPriestId = pid;
          break;
        }
      }

      for (const pid of allIds) {
        const isLeader = pid === leaderId;
        const isAnchorPriest = pid === anchorPriestId;
        roleMap.set(pid, {
          partyId: String(party.id),
          partyIndex: pIndex,
          isLeader,
          isAnchorPriest
        });
      }

      const partyClients = allIds.map(pid => clientById.get(pid)).filter(Boolean);
      partyClients.sort((a, b) => {
        const ra = roleMap.get(String(a.id)) || {};
        const rb = roleMap.get(String(b.id)) || {};
        const score = r => (r.isLeader ? 0 : r.isAnchorPriest ? 1 : 2);
        return score(ra) - score(rb);
      });

      if (partyClients.length === 0) return;

      const leaderCl = clientById.get(leaderId) || partyClients[0];
      const leaderSlot = slotById.get(leaderId) || {};
      const leaderName =
        (leaderCl && (leaderCl.charName || leaderCl.name)) ||
        leaderSlot.charName ||
        leaderSlot.profileName ||
        'หัวตี้';

      const priestCl = anchorPriestId ? clientById.get(anchorPriestId) : null;
      const priestSlot = anchorPriestId ? slotById.get(anchorPriestId) : null;
      const priestName = priestCl
        ? priestCl.charName || priestCl.name
        : priestSlot
        ? priestSlot.charName || priestSlot.profileName
        : '';

      const anchorMapRaw =
        (priestCl && priestCl.currentMap) ||
        (leaderCl && leaderCl.currentMap) ||
        (priestSlot && priestSlot.mapName) ||
        leaderSlot.mapName ||
        '';
      const mapLabel = anchorMapRaw ? formatMapWithLevel(anchorMapRaw) : 'ในเมือง/ออฟไลน์';
      const onlineCount = partyClients.filter(c => c.online).length;
      const selectedCount = partyClients.filter(c => selectedProfileIds.has(String(c.id))).length;

      partyGroups.push({
        key: 'party:' + String(party.id),
        partyId: String(party.id),
        partyIndex: pIndex,
        leaderName,
        priestName,
        mapLabel,
        expMode: party.expMode || 'even-share',
        max: party.max || 6,
        clients: partyClients,
        onlineCount,
        selectedCount
      });
    });

    const soloClients = state.clients.filter(c => !roleMap.has(String(c.id)));
    const orderedClients = [...partyGroups.flatMap(g => g.clients), ...soloClients];

    return {
      hasParties: partyGroups.length > 0,
      partyGroups,
      soloClients,
      roleMap,
      orderedClients
    };
  }

  let busyScan = false;
  let busyRefreshOne = false;
  let busyApplyFarm = false;
  let scannedOnFirstOpen = false;

  function relTime(ms) {
    if (!ms || ms <= 0) return 'ยังไม่เคยสแกน';
    const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (diffSec < 60) return `${diffSec} วินาทีที่แล้ว`;
    const m = Math.floor(diffSec / 60);
    if (m < 60) return `${m} นาทีที่แล้ว`;
    const h = Math.floor(m / 60);
    return `${h} ชม. ที่แล้ว`;
  }

  function ensureCardDefaultMap(cardId) {
    const cid = Number(cardId);
    const card = state.cards.find(c => Number(c.id) === cid);
    if (!card) return '';
    const maps = Array.isArray(card.maps) ? card.maps : [];
    const cur = selectedCardMaps.get(cid);
    if (cur && maps.some(m => m.map === cur)) return cur;
    const ovMatch = Object.values(state.farmOverrides || {}).find(ov => Number(ov && ov.cardId) === cid && ov.mapName && maps.some(m => m.map === ov.mapName));
    if (ovMatch) {
      selectedCardMaps.set(cid, ovMatch.mapName);
      return ovMatch.mapName;
    }
    const defMap = maps.length > 0 ? maps[0].map : '';
    if (defMap) selectedCardMaps.set(cid, defMap);
    return defMap;
  }

  function ensureDefaultSelectedProfiles() {
    if (profilesInitializedForPanel && selectedProfileIds.size > 0) return;
    selectedProfileIds.clear();
    for (const c of state.clients) {
      if (c.online) selectedProfileIds.add(String(c.id));
    }
    if (selectedProfileIds.size === 0) {
      for (const c of state.clients) selectedProfileIds.add(String(c.id));
    }
    profilesInitializedForPanel = true;
  }

  function computeScreenDistribution() {
    const activeCards = [];
    for (const cid of selectedCardIds) {
      const card = state.cards.find(c => Number(c.id) === Number(cid));
      if (!card) continue;
      const mapName = ensureCardDefaultMap(cid);
      activeCards.push({ card, mapName });
    }

    const { orderedClients } = buildClientPartyGrouping();
    const chosenClients = orderedClients.filter(cl => selectedProfileIds.has(String(cl.id)));
    const M = activeCards.length;
    const N = chosenClients.length;

    const buckets = activeCards.map((ac, idx) => {
      const baseQuota = M > 0 ? Math.floor(N / M) + (idx < (N % M) ? 1 : 0) : 0;
      return {
        card: ac.card,
        mapName: ac.mapName,
        quota: baseQuota,
        profileIds: [],
        clientNames: []
      };
    });

    const byProfileId = new Map();
    if (M === 0 || N === 0) {
      return { buckets, byProfileId };
    }

    const unassigned = [];
    // Pass 1: keep screens that are already on or locked to one of the selected cards' maps in that bucket (up to quota)
    for (const cl of chosenClients) {
      const pid = String(cl.id);
      const curOv = String(cl.overrideFarmMap || '').trim();
      const curMap = String(cl.currentMap || '').trim();
      const matchedBucket = buckets.find(
        b =>
          b.mapName &&
          b.profileIds.length < b.quota &&
          (Number(cl.overrideCardId) === Number(b.card.id) || curOv === b.mapName || curMap === b.mapName)
      );
      if (matchedBucket) {
        matchedBucket.profileIds.push(pid);
        matchedBucket.clientNames.push(cl.charName || cl.name);
        byProfileId.set(pid, { card: matchedBucket.card, mapName: matchedBucket.mapName });
      } else {
        unassigned.push(cl);
      }
    }

    // Pass 2: fill remaining bucket quotas evenly in order
    let bIdx = 0;
    for (const cl of unassigned) {
      while (bIdx < buckets.length && buckets[bIdx].profileIds.length >= buckets[bIdx].quota) {
        bIdx++;
      }
      if (bIdx >= buckets.length) break;
      const b = buckets[bIdx];
      const pid = String(cl.id);
      b.profileIds.push(pid);
      b.clientNames.push(cl.charName || cl.name);
      byProfileId.set(pid, { card: b.card, mapName: b.mapName });
    }

    return { buckets, byProfileId };
  }

  function buildDOM() {
    if (document.getElementById('cd-tab')) return;

    const tab = document.createElement('button');
    tab.className = 'cd-tab';
    tab.id = 'cd-tab';
    tab.type = 'button';
    tab.title = 'เช็คราคาการ์ดทั้งหมด & เปลี่ยนแมพฟาร์ม';
    tab.setAttribute('aria-label', 'เปิดหน้าเช็คราคาการ์ดทั้งหมด');
    tab.innerHTML = CARD_SVG + '<span class="cd-tab-badge" id="cd-tab-badge"></span>';

    const scrim = document.createElement('div');
    scrim.className = 'cd-scrim';
    scrim.id = 'cd-scrim';

    const drawer = document.createElement('aside');
    drawer.className = 'cd-drawer';
    drawer.id = 'cd-drawer';
    drawer.setAttribute('aria-label', 'เช็คราคาการ์ดและเปลี่ยนแมพฟาร์ม');

    const slotPillsHtml = Object.keys(SLOT_LABELS)
      .map(k => `<button type="button" class="cd-slot-pill${k === 'all' ? ' on' : ''}" data-slot="${esc(k)}">${esc(SLOT_LABELS[k])}</button>`)
      .join('');

    drawer.innerHTML = `
      <header class="cd-head">
        <div class="cd-head-icon">${CARD_SVG}</div>
        <div class="cd-head-title">
          <h2>🃏 เช็คราคาการ์ด & เปลี่ยนแมพฟาร์ม</h2>
          <p>ติ๊กเลือกได้หลายการ์ดเพื่อเฉลี่ยจอฟาร์มอัตโนมัติ · ซิงค์ราคากลางทุกเครื่อง</p>
        </div>
        <button class="cd-top-farm-btn" id="cd-top-farm-btn" type="button" title="เปิดแผงเลือกจอและเฉลี่ยจอไปฟาร์มตามการ์ดที่เลือก">🗺️ เปลี่ยนแมพฟาร์ม</button>
        <button class="cd-scan-btn" id="cd-scan-btn" type="button" title="สแกนราคาการ์ดในตลาดและอัปเดตขึ้นฐานข้อมูลกลางทันที">🔄 เช็คราคา</button>
        <button class="cd-close" id="cd-close" type="button" aria-label="ปิด">✕</button>
      </header>

      <section class="cd-summary">
        <div class="cd-sum-box">
          <span>การ์ดที่มีวางขาย</span>
          <b id="cd-sum-listed">0 / 66 ใบ</b>
          <small id="cd-sum-updated">กำลังโหลดข้อมูล...</small>
        </div>
        <div class="cd-sum-box">
          <span>ขายออกถี่สุด (24ชม.)</span>
          <b id="cd-sum-top-card">—</b>
          <small id="cd-sum-top-vel">เฉลี่ย — ใบ/ชม.</small>
        </div>
        <div class="cd-sum-box">
          <span>จอที่ฟาร์มแมพการ์ด</span>
          <b id="cd-sum-farming">0 จอ</b>
          <small id="cd-sum-farming-sub">ติ๊กเลือกการ์ดเพื่อเฉลี่ยจอไปฟาร์ม</small>
        </div>
      </section>

      <section class="cd-controls">
        <div class="cd-search-row">
          <input type="text" class="cd-search-inp" id="cd-search-inp" placeholder="🔍 ค้นหาชื่อการ์ด, มอนสเตอร์, แมพ, หรือสเตตัส..." autocomplete="off">
          <select class="cd-sort-sel" id="cd-sort-sel" title="เรียงลำดับรายการการ์ด">
            <option value="velocity_desc">🔥 ขายออกถี่สุด (เฉลี่ย/ชม.)</option>
            <option value="price_asc">💰 ราคาถูก → แพง</option>
            <option value="price_desc">💎 ราคาแพง → ถูก</option>
            <option value="listings_desc">📦 วางขายมากสุด</option>
            <option value="lv_asc">⚔️ เลเวลมอนต่ำ → สูง</option>
            <option value="name_asc">🔤 ชื่อการ์ด A → Z</option>
          </select>
        </div>
        <div class="cd-slots-row">
          <div class="cd-slots" id="cd-slots">${slotPillsHtml}</div>
          <button type="button" class="cd-clear-sel-btn" id="cd-clear-sel-btn" hidden>✕ ล้างการ์ดที่เลือก</button>
        </div>
      </section>

      <div class="cd-override-banner" id="cd-override-banner" hidden>
        <span id="cd-override-banner-txt">🗺️ กำลังฟาร์มแมพการ์ดอยู่ 0 จอ</span>
        <button type="button" class="cd-override-clear-all" id="cd-override-clear-all">🔄 คืนแมพตาม Plan ทุกจอ</button>
      </div>

      <div class="cd-list" id="cd-list"></div>
    `;

    const farmPanel = document.createElement('section');
    farmPanel.className = 'cd-farm-panel';
    farmPanel.id = 'cd-farm-panel';
    farmPanel.setAttribute('aria-hidden', 'true');
    farmPanel.setAttribute('aria-label', 'แผงเลือกจอและเปลี่ยนแมพฟาร์มการ์ด');
    farmPanel.innerHTML = `
      <div class="cd-fp-head">
        <div class="cd-fp-title" id="cd-fp-title"></div>
        <div class="cd-fp-actions-top">
          <button type="button" class="cd-fp-refresh-one" id="cd-fp-refresh-one" title="ดึงราคาและประวัติการขาย 24ชม./7วัน ของการ์ดที่เลือกจากเกมสดๆ">🔄 เช็คราคาใบที่เลือก</button>
          <button type="button" class="cd-fp-close" id="cd-fp-close" title="ซ่อนแผงเลือกจอ">✕</button>
        </div>
      </div>

      <div class="cd-fp-cards-list" id="cd-fp-cards-list"></div>

      <div class="cd-fp-screen-bar">
        <span id="cd-fp-screen-lbl">🖥️ เลือกจอที่จะนำมาเฉลี่ยฟาร์ม (Plan Script อัปสเตตัส/ซื้อยา/ฝากคลัง ยังทำงานปกติ):</span>
        <div class="cd-fp-qbtns">
          <button type="button" class="cd-fp-qbtn" id="cd-fp-q-online">✅ เฉพาะจอออนไลน์</button>
          <button type="button" class="cd-fp-qbtn" id="cd-fp-q-all">☑️ เลือกทุกจอ</button>
          <button type="button" class="cd-fp-qbtn" id="cd-fp-q-none">⬜ ล้างที่เลือก</button>
        </div>
      </div>

      <div class="cd-fp-clients" id="cd-fp-clients"></div>

      <div class="cd-fp-footer">
        <button type="button" class="cd-fp-go" id="cd-fp-go">🚀 สั่งจอที่เลือกไปฟาร์มแมพการ์ดทันที</button>
        <button type="button" class="cd-fp-clear" id="cd-fp-clear" title="ปลดล็อกแมพการ์ดของจอที่เลือก เพื่อให้กลับไปเดินตามแมพเลเวลของ Plan Script เดิม">🔄 คืนแมพตาม Plan เดิม</button>
      </div>
    `;

    document.body.appendChild(tab);
    document.body.appendChild(scrim);
    document.body.appendChild(drawer);
    document.body.appendChild(farmPanel);

    tab.addEventListener('click', () => toggleDrawer(true));
    scrim.addEventListener('click', () => toggleDrawer(false));
    document.getElementById('cd-close').addEventListener('click', () => toggleDrawer(false));

    document.getElementById('cd-top-farm-btn').addEventListener('click', () => {
      if (selectedCardIds.size === 0) {
        toast('ติ๊กเลือกการ์ดอย่างน้อย 1 ใบ (เลือกหลายใบเพื่อเฉลี่ยจอฟาร์มได้) แล้วกดปุ่มนี้อีกครั้ง', 'info');
        return;
      }
      ensureDefaultSelectedProfiles();
      farmPanelOpen = !farmPanelOpen;
      renderAll();
    });

    document.getElementById('cd-clear-sel-btn').addEventListener('click', () => {
      selectedCardIds.clear();
      farmPanelOpen = false;
      renderAll();
    });

    document.getElementById('cd-search-inp').addEventListener('input', e => {
      searchQuery = String(e.target.value || '').trim().toLowerCase();
      renderList();
    });

    document.getElementById('cd-sort-sel').addEventListener('change', e => {
      sortMode = e.target.value || 'velocity_desc';
      renderList();
    });

    document.getElementById('cd-slots').addEventListener('click', e => {
      const btn = e.target.closest('[data-slot]');
      if (!btn) return;
      slotFilter = btn.getAttribute('data-slot') || 'all';
      document.querySelectorAll('#cd-slots .cd-slot-pill').forEach(el => {
        el.classList.toggle('on', el.getAttribute('data-slot') === slotFilter);
      });
      renderList();
    });

    document.getElementById('cd-scan-btn').addEventListener('click', () => triggerFullMarketScan());
    document.getElementById('cd-override-clear-all').addEventListener('click', () => clearAllOverrides());

    document.getElementById('cd-list').addEventListener('click', e => {
      const itemEl = e.target.closest('[data-card-id]');
      if (!itemEl) return;
      const cid = Number(itemEl.getAttribute('data-card-id'));
      if (!cid) return;
      const isCheckbox = Boolean(e.target.closest('.cd-card-check-wrap'));

      if (isCheckbox) {
        if (selectedCardIds.has(cid)) {
          selectedCardIds.delete(cid);
          if (selectedCardIds.size === 0) farmPanelOpen = false;
        } else {
          selectedCardIds.add(cid);
          ensureCardDefaultMap(cid);
          ensureDefaultSelectedProfiles();
          farmPanelOpen = true;
        }
      } else {
        // Clicking the card row itself:
        // If user already has multiple cards selected, toggle this card in the multi-select set
        if (selectedCardIds.size > 1 || (selectedCardIds.size === 1 && !selectedCardIds.has(cid) && farmPanelOpen)) {
          if (selectedCardIds.has(cid)) {
            selectedCardIds.delete(cid);
          } else {
            selectedCardIds.add(cid);
            ensureCardDefaultMap(cid);
          }
          ensureDefaultSelectedProfiles();
          farmPanelOpen = selectedCardIds.size > 0;
        } else {
          selectedCardIds.clear();
          selectedCardIds.add(cid);
          ensureCardDefaultMap(cid);
          ensureDefaultSelectedProfiles();
          farmPanelOpen = true;
        }
      }

      renderAll();

      // Background refresh if single card clicked and stale
      if (selectedCardIds.has(cid)) {
        const card = state.cards.find(c => Number(c.id) === cid);
        const m = (card && card.market) || {};
        const anyOnline = state.clients.some(c => c.online);
        if (anyOnline && (!m.historyUpdatedAt || Date.now() - Number(m.historyUpdatedAt) > 5 * 60 * 1000)) {
          triggerSingleCardRefresh(cid, true);
        }
      }
    });

    document.getElementById('cd-fp-close').addEventListener('click', () => {
      farmPanelOpen = false;
      renderFarmPanel();
    });

    document.getElementById('cd-fp-cards-list').addEventListener('change', e => {
      const sel = e.target.closest('select[data-card-map]');
      if (!sel) return;
      const cid = Number(sel.getAttribute('data-card-map'));
      if (!cid) return;
      selectedCardMaps.set(cid, String(sel.value || '').trim());
      renderFarmPanel();
    });

    document.getElementById('cd-fp-cards-list').addEventListener('click', e => {
      const rmBtn = e.target.closest('button[data-rm-card]');
      if (!rmBtn) return;
      const cid = Number(rmBtn.getAttribute('data-rm-card'));
      selectedCardIds.delete(cid);
      if (selectedCardIds.size === 0) farmPanelOpen = false;
      renderAll();
    });

    document.getElementById('cd-fp-refresh-one').addEventListener('click', async () => {
      const firstId = Array.from(selectedCardIds)[0];
      if (firstId) await triggerSingleCardRefresh(firstId, false);
    });

    document.getElementById('cd-fp-q-online').addEventListener('click', () => {
      selectedProfileIds.clear();
      for (const c of state.clients) {
        if (c.online) selectedProfileIds.add(String(c.id));
      }
      renderFarmPanel();
    });

    document.getElementById('cd-fp-q-all').addEventListener('click', () => {
      selectedProfileIds.clear();
      for (const c of state.clients) {
        selectedProfileIds.add(String(c.id));
      }
      renderFarmPanel();
    });

    document.getElementById('cd-fp-q-none').addEventListener('click', () => {
      selectedProfileIds.clear();
      renderFarmPanel();
    });

    document.getElementById('cd-fp-clients').addEventListener('change', e => {
      const groupCb = e.target.closest('input[data-group-check]');
      if (groupCb) {
        const gKey = String(groupCb.getAttribute('data-group-check') || '');
        const { partyGroups, soloClients } = buildClientPartyGrouping();
        let targetClients = [];
        if (gKey === 'solo') {
          targetClients = soloClients;
        } else {
          const found = partyGroups.find(g => g.key === gKey);
          if (found) targetClients = found.clients;
        }
        for (const cl of targetClients) {
          const pid = String(cl.id);
          if (groupCb.checked) selectedProfileIds.add(pid);
          else selectedProfileIds.delete(pid);
        }
        renderFarmPanel();
        return;
      }

      const cb = e.target.closest('input[data-prof-id]');
      if (!cb) return;
      const pid = String(cb.getAttribute('data-prof-id'));
      if (cb.checked) selectedProfileIds.add(pid);
      else selectedProfileIds.delete(pid);
      renderFarmPanel();
    });

    document.getElementById('cd-fp-clients').addEventListener('click', e => {
      const toggleAllBtn = e.target.closest('button[data-group-select-btn]');
      if (toggleAllBtn) {
        e.preventDefault();
        e.stopPropagation();
        const gKey = String(toggleAllBtn.getAttribute('data-group-select-btn') || '');
        const { partyGroups, soloClients } = buildClientPartyGrouping();
        const targetClients =
          gKey === 'solo' ? soloClients : (partyGroups.find(g => g.key === gKey) || { clients: [] }).clients;
        const allSelected =
          targetClients.length > 0 && targetClients.every(cl => selectedProfileIds.has(String(cl.id)));
        for (const cl of targetClients) {
          const pid = String(cl.id);
          if (allSelected) selectedProfileIds.delete(pid);
          else selectedProfileIds.add(pid);
        }
        renderFarmPanel();
        return;
      }

      const head = e.target.closest('.cd-fp-group-head[data-group-key]');
      if (head && !e.target.closest('.cd-fp-group-check-wrap') && !e.target.closest('button[data-group-select-btn]')) {
        const gKey = String(head.getAttribute('data-group-key') || '');
        if (!gKey) return;
        if (collapsedClientGroups.has(gKey)) collapsedClientGroups.delete(gKey);
        else collapsedClientGroups.add(gKey);
        renderFarmPanel();
      }
    });

    document.getElementById('cd-fp-go').addEventListener('click', () => applyFarmMapToSelected(false));
    document.getElementById('cd-fp-clear').addEventListener('click', () => applyFarmMapToSelected(true));
  }

  function toggleDrawer(open) {
    isOpen = !!open;
    if (isOpen) {
      document.body.classList.remove('pt-open', 'pm-open', 'gd-open');
      document.body.classList.add('cd-open');
      if (typeof window.refreshPartyManagerData === 'function') {
        try { window.refreshPartyManagerData(); } catch (_) {}
      }
      fetchCardsData().then(() => {
        if (!scannedOnFirstOpen) {
          scannedOnFirstOpen = true;
          const anyOnline = state.clients.some(c => c.online);
          const stale = !state.lastFullSweepAt || Date.now() - state.lastFullSweepAt > 10 * 60 * 1000;
          if (anyOnline && stale && !state.scanning) {
            triggerFullMarketScan(true);
          }
        }
      });
      if (!pollTimer) {
        pollTimer = setInterval(() => {
          if (isOpen) fetchCardsData();
        }, 6000);
      }
    } else {
      document.body.classList.remove('cd-open', 'cd-fp-open');
      const fp = document.getElementById('cd-farm-panel');
      if (fp) {
        fp.classList.remove('is-open');
        fp.setAttribute('aria-hidden', 'true');
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }
  }

  async function fetchCardsData() {
    try {
      const res = await fetch(API);
      const j = await res.json();
      if (!j || !j.success) return;
      state.cards = Array.isArray(j.cards) ? j.cards : [];
      state.clients = Array.isArray(j.clients) ? j.clients : [];
      state.parties = Array.isArray(j.parties) ? j.parties : [];
      state.overrides = j.overrides && typeof j.overrides === 'object' ? j.overrides : {};
      state.scanning = !!j.scanning;
      state.lastFullSweepAt = Number(j.lastFullSweepAt) || 0;
      renderAll();
    } catch (err) {
      console.warn('[CardMarket] fetch error:', err);
    }
  }

  async function triggerFullMarketScan(silent) {
    if (busyScan) return;
    busyScan = true;
    updateHeaderButtons();
    if (!silent) toast('กำลังสแกนราคาการ์ดทั้งหมดและซิงค์ฐานข้อมูลกลาง...', 'info');
    try {
      const res = await fetch(API + '/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full: true })
      });
      const j = await res.json();
      await fetchCardsData();
      if (!silent) {
        if (j && j.success && j.result && j.result.ok) {
          toast(`อัปเดตราคาการ์ดสำเร็จ (${j.result.cardsFound || 0} ชนิดที่วางขายในตลาด)`, 'success');
        } else {
          toast((j && (j.error || (j.result && j.result.reason))) || 'ต้องมีจอเกมที่ออนไลน์ในโลกเกมอย่างน้อย 1 จอเพื่อสแกนตลาด', 'warning');
        }
      }
    } catch (e) {
      if (!silent) toast('สแกนราคาตลาดไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      busyScan = false;
      updateHeaderButtons();
    }
  }

  async function triggerSingleCardRefresh(itemId, silent) {
    if (busyRefreshOne) return;
    busyRefreshOne = true;
    const btn = document.getElementById('cd-fp-refresh-one');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ กำลังเช็ค...';
    }
    try {
      const res = await fetch(API + '/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: Number(itemId) })
      });
      const j = await res.json();
      await fetchCardsData();
      if (!silent) {
        if (j && j.success) {
          toast('อัปเดตราคาและสถิติการขายของการ์ดใบนี้เรียบร้อยแล้ว', 'success');
        } else {
          toast((j && j.error) || 'ไม่สามารถดึงข้อมูลจากจอเกมได้ (ต้องมีจอออนไลน์ 1 จอ)', 'warning');
        }
      }
    } catch (e) {
      if (!silent) toast('เกิดข้อผิดพลาด: ' + e.message, 'error');
    } finally {
      busyRefreshOne = false;
      const b2 = document.getElementById('cd-fp-refresh-one');
      if (b2) {
        b2.disabled = false;
        b2.textContent = '🔄 เช็คราคาใบที่เลือก';
      }
    }
  }

  function updateHeaderButtons() {
    const scanBtn = document.getElementById('cd-scan-btn');
    if (scanBtn) {
      const working = busyScan || state.scanning;
      scanBtn.disabled = working;
      scanBtn.textContent = working ? '⏳ สแกน...' : '🔄 เช็คราคา';
    }

    const topFarmBtn = document.getElementById('cd-top-farm-btn');
    const clearSelBtn = document.getElementById('cd-clear-sel-btn');
    const selCount = selectedCardIds.size;
    if (topFarmBtn) {
      topFarmBtn.classList.toggle('has-sel', selCount > 0);
      topFarmBtn.textContent = selCount > 0 ? `🗺️ เปลี่ยนแมพฟาร์ม (${selCount} การ์ด)` : '🗺️ เปลี่ยนแมพฟาร์ม';
    }
    if (clearSelBtn) {
      clearSelBtn.hidden = selCount === 0;
      clearSelBtn.textContent = `✕ ล้างที่เลือก (${selCount})`;
    }
  }

  function getCardEffectivePrice(c) {
    const m = c.market || {};
    if (Number(m.lowestPrice) > 0) return Number(m.lowestPrice);
    if (Number(m.medianPrice) > 0) return Number(m.medianPrice);
    return 0;
  }

  function getFarmingCountForCard(c) {
    const cardMaps = new Set((c.maps || []).map(m => m.map));
    let count = 0;
    for (const cl of state.clients) {
      const ov = String(cl.overrideFarmMap || '').trim();
      if (!ov) continue;
      if (Number(cl.overrideCardId) === Number(c.id)) {
        count++;
      } else if (!Number(cl.overrideCardId) && cardMaps.has(ov)) {
        count++;
      }
    }
    return count;
  }

  function renderAll() {
    updateHeaderButtons();
    renderSummaryAndBadge();
    renderList();
    renderFarmPanel();
  }

  function renderSummaryAndBadge() {
    const totalCards = state.cards.length || 66;
    const listedCards = state.cards.filter(c => c.market && Number(c.market.lowestPrice) > 0).length;
    const pricedOrHistoryCards = state.cards.filter(
      c => c.market && (Number(c.market.lowestPrice) > 0 || Number(c.market.medianPrice) > 0 || Number(c.market.soldQty7d) > 0)
    ).length;

    let latestUpdate = state.lastFullSweepAt || 0;
    let topVelCard = null;
    for (const c of state.cards) {
      const m = c.market || {};
      if (Number(m.updatedAt) > latestUpdate) latestUpdate = Number(m.updatedAt);
      const vel = Number(m.avgSoldPerHour) || 0;
      const sold24 = Number(m.soldQty24h) || 0;
      const sold7 = Number(m.soldQty7d) || 0;
      if (vel > 0 || sold24 > 0 || sold7 > 0) {
        if (
          !topVelCard ||
          vel > (Number(topVelCard.market.avgSoldPerHour) || 0) ||
          (vel === (Number(topVelCard.market.avgSoldPerHour) || 0) && sold7 > (Number(topVelCard.market.soldQty7d) || 0))
        ) {
          topVelCard = c;
        }
      }
    }

    const farmingClients = state.clients.filter(c => String(c.overrideFarmMap || '').trim());

    const elListed = document.getElementById('cd-sum-listed');
    const elUpdated = document.getElementById('cd-sum-updated');
    const elTopCard = document.getElementById('cd-sum-top-card');
    const elTopVel = document.getElementById('cd-sum-top-vel');
    const elFarming = document.getElementById('cd-sum-farming');
    const elFarmingSub = document.getElementById('cd-sum-farming-sub');

    if (elListed) elListed.textContent = `${listedCards} / ${totalCards} ใบ`;
    if (elUpdated) {
      elUpdated.textContent = latestUpdate
        ? `ซิงค์ล่าสุด ${relTime(latestUpdate)} (มีข้อมูล ${pricedOrHistoryCards} ใบ)`
        : 'กด "เช็คราคา" เพื่อดึงราคาล่าสุด';
    }

    if (topVelCard) {
      const m = topVelCard.market || {};
      if (elTopCard) elTopCard.textContent = topVelCard.name.replace(/ Card$/i, '');
      if (elTopVel) {
        elTopVel.textContent = `เฉลี่ย ${Number(m.avgSoldPerHour || 0).toFixed(2)} ใบ/ชม. (24ชม.: ${m.soldQty24h || 0} ใบ)`;
      }
    } else {
      if (elTopCard) elTopCard.textContent = 'ยังไม่มีประวัติขาย';
      if (elTopVel) elTopVel.textContent = 'คลิกการ์ดหรือกดเช็คราคา';
    }

    if (elFarming) elFarming.textContent = `${farmingClients.length} จอ`;
    if (elFarmingSub) {
      if (farmingClients.length > 0) {
        const maps = Array.from(new Set(farmingClients.map(c => formatMapWithLevel(c.overrideFarmMap))));
        elFarmingSub.textContent = `แมพ: ${maps.join(', ')}`;
      } else {
        elFarmingSub.textContent = 'ติ๊กเลือกการ์ดเพื่อเฉลี่ยจอไปฟาร์ม';
      }
    }

    const banner = document.getElementById('cd-override-banner');
    const bannerTxt = document.getElementById('cd-override-banner-txt');
    if (banner && bannerTxt) {
      if (farmingClients.length > 0) {
        banner.hidden = false;
        const maps = Array.from(new Set(farmingClients.map(c => formatMapWithLevel(c.overrideFarmMap))));
        bannerTxt.textContent = `🗺️ กำลังฟาร์มแมพการ์ด ${farmingClients.length} จอ (${maps.join(', ')}) · เปลี่ยนแมพอื่นหรือเข้าตี้ได้ตามปกติ`;
      } else {
        banner.hidden = true;
      }
    }

    const badge = document.getElementById('cd-tab-badge');
    if (badge) {
      if (farmingClients.length > 0) {
        badge.className = 'cd-tab-badge has-farm';
        badge.textContent = `${farmingClients.length}`;
        badge.title = `กำลังฟาร์มแมพการ์ด ${farmingClients.length} จอ`;
      } else if (listedCards > 0) {
        badge.className = 'cd-tab-badge';
        badge.textContent = `${listedCards}`;
        badge.title = `มีการ์ดวางขายในตลาด ${listedCards} ชนิด`;
      } else {
        badge.className = 'cd-tab-badge';
        badge.textContent = '';
      }
    }
  }

  function renderList() {
    const listEl = document.getElementById('cd-list');
    if (!listEl) return;

    let filtered = state.cards.slice();

    if (slotFilter === 'listed') {
      filtered = filtered.filter(c => c.market && Number(c.market.lowestPrice) > 0);
    } else if (slotFilter !== 'all') {
      filtered = filtered.filter(c => String(c.cardSlot || '').toLowerCase() === slotFilter.toLowerCase());
    }

    if (searchQuery) {
      filtered = filtered.filter(c => {
        const hay = [
          c.name,
          c.cardSlot,
          ...(c.specials || []),
          c.album || '',
          ...(c.monsters || []).map(m => m.name),
          ...(c.maps || []).map(m => `${m.map} ${m.mapLevel || getMapLevelLabel(m.map, m.monsterLevel)}`)
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(searchQuery);
      });
    }

    filtered.sort((a, b) => {
      const ma = a.market || {};
      const mb = b.market || {};
      const pa = getCardEffectivePrice(a);
      const pb = getCardEffectivePrice(b);

      if (sortMode === 'price_asc') {
        if (pa > 0 && pb > 0) return pa - pb;
        if (pa > 0) return -1;
        if (pb > 0) return 1;
        return a.name.localeCompare(b.name);
      }
      if (sortMode === 'price_desc') {
        if (pa > 0 && pb > 0) return pb - pa;
        if (pa > 0) return -1;
        if (pb > 0) return 1;
        return a.name.localeCompare(b.name);
      }
      if (sortMode === 'listings_desc') {
        const la = Number(ma.activeQty || ma.activeListings || 0);
        const lb = Number(mb.activeQty || mb.activeListings || 0);
        if (lb !== la) return lb - la;
        return (pb || 0) - (pa || 0);
      }
      if (sortMode === 'lv_asc') {
        const lva = (a.monsters && a.monsters[0] && a.monsters[0].level) || 999;
        const lvb = (b.monsters && b.monsters[0] && b.monsters[0].level) || 999;
        if (lva !== lvb) return lva - lvb;
        return a.name.localeCompare(b.name);
      }
      if (sortMode === 'name_asc') {
        return a.name.localeCompare(b.name);
      }
      const va = Number(ma.avgSoldPerHour) || 0;
      const vb = Number(mb.avgSoldPerHour) || 0;
      if (vb !== va) return vb - va;
      const s7a = Number(ma.soldQty7d) || 0;
      const s7b = Number(mb.soldQty7d) || 0;
      if (s7b !== s7a) return s7b - s7a;
      if (pa > 0 && pb > 0) return pa - pb;
      if (pa > 0) return -1;
      if (pb > 0) return 1;
      return a.name.localeCompare(b.name);
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="text-align:center;color:#64748b;padding:34px 16px;font-size:12.5px;">ไม่พบการ์ดที่ตรงกับเงื่อนไขการค้นหา</div>`;
      return;
    }

    const html = filtered
      .map(c => {
        const m = c.market || {};
        const lowest = Number(m.lowestPrice) || 0;
        const median = Number(m.medianPrice) || 0;
        const activeQty = Number(m.activeQty || m.activeListings || 0);
        const vel = Number(m.avgSoldPerHour) || 0;
        const sold24 = Number(m.soldQty24h) || 0;
        const sold7 = Number(m.soldQty7d) || 0;
        const farmingCount = getFarmingCountForCard(c);
        const isSelected = selectedCardIds.has(Number(c.id));

        const fxText = (c.specials || []).join(' · ') || 'ไม่มีคำอธิบาย';
        const monText =
          (c.monsters || []).map(mo => `${mo.name} (Lv.${mo.level})`).join(', ') || 'ไม่ระบุมอนสเตอร์';
        const mapsHtml =
          (c.maps || []).length > 0
            ? c.maps
                .map(mp => {
                  const lvLabel = mp.mapLevel || getMapLevelLabel(mp.map, mp.monsterLevel);
                  return `<span class="cd-map-chip">🗺️ ${esc(mp.map)}${lvLabel ? ` <em class="cd-map-lv">${esc(lvLabel)}</em>` : ''} (${mp.count})</span>`;
                })
                .join(' ')
            : `<span style="color:#64748b;">ไม่มีแมพเกิดประจำ</span>`;

        let priceHtml = '';
        let priceSubHtml = '';
        if (lowest > 0) {
          priceHtml = `<div class="cd-price-val">${fmt(lowest)} z</div>`;
          priceSubHtml = `<div class="cd-price-sub">วางขาย ${activeQty} ใบ${median > 0 ? ` · กลาง ${fmt(median)} z` : ''}</div>`;
        } else if (median > 0) {
          priceHtml = `<div class="cd-price-val" style="color:#93c5fd;">~${fmt(median)} z</div>`;
          priceSubHtml = `<div class="cd-price-sub">ไม่มีวางขาย (ราคากลาง)</div>`;
        } else {
          priceHtml = `<div class="cd-price-val no-listing">ไม่มีวางขาย</div>`;
          priceSubHtml = `<div class="cd-price-sub">คลิกเพื่อเช็คราคา/ฟาร์ม</div>`;
        }

        let velClass = 'cd-vel-badge zero';
        let velText = '0 ใบ/ชม.';
        if (vel > 0 || sold24 > 0) {
          velClass = vel >= 0.25 || sold24 >= 5 ? 'cd-vel-badge hot' : 'cd-vel-badge';
          velText = `⚡ ${vel.toFixed(2)} ใบ/ชม. (${sold24}/วัน)`;
        } else if (sold7 > 0) {
          velClass = 'cd-vel-badge';
          velText = `📊 ${(sold7 / 168).toFixed(2)} ใบ/ชม. (${sold7}/7วัน)`;
        }

        return `
          <div class="cd-card-item${isSelected ? ' selected' : ''}${farmingCount > 0 ? ' farming' : ''}" data-card-id="${c.id}">
            <div class="cd-card-check-wrap" title="ติ๊กเลือกการ์ดนี้เพื่อนำไปเฉลี่ยจอฟาร์มร่วมกับการ์ดใบอื่น">
              <input type="checkbox" class="cd-card-check" ${isSelected ? 'checked' : ''} tabindex="-1">
            </div>
            <div class="cd-card-icon-wrap">
              ${c.icon ? `<img src="${esc(c.icon)}" alt="" loading="lazy">` : '🃏'}
              <span class="cd-slot-tag">${esc(c.cardSlot || 'Card')}</span>
            </div>
            <div class="cd-card-main">
              <div class="cd-card-title-row">
                <span class="cd-card-name">${esc(c.name)}</span>
                ${farmingCount > 0 ? `<span class="cd-farm-pill">🎯 กำลังฟาร์ม ${farmingCount} จอ</span>` : ''}
              </div>
              <div class="cd-card-fx" title="${esc(fxText)}${c.album ? ' | สมุด: ' + esc(c.album) : ''}">
                ✨ ${esc(fxText)}${c.album ? ` <span style="color:#a78bfa;">(สมุด: ${esc(c.album)})</span>` : ''}
              </div>
              <div class="cd-card-drop">
                <span>👾 <b>${esc(monText)}</b></span>
                ${mapsHtml}
              </div>
            </div>
            <div class="cd-card-metrics">
              ${priceHtml}
              ${priceSubHtml}
              <div class="${velClass}" title="ความถี่การขายออกในตลาดกลาง (24 ชั่วโมงล่าสุดขายออก ${sold24} ใบ / 7 วันล่าสุดขายออก ${sold7} ใบ)">
                ${esc(velText)}
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    listEl.innerHTML = html;
  }

  function renderFarmPanel() {
    const panel = document.getElementById('cd-farm-panel');
    if (!panel) return;
    const shouldShow = Boolean(isOpen && farmPanelOpen && selectedCardIds.size > 0);
    panel.classList.toggle('is-open', shouldShow);
    panel.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    document.body.classList.toggle('cd-fp-open', shouldShow);
    if (!shouldShow) return;

    const { buckets, byProfileId } = computeScreenDistribution();
    const M = buckets.length;
    const N = selectedProfileIds.size;

    const titleEl = document.getElementById('cd-fp-title');
    if (titleEl) {
      if (M === 1) {
        const card = buckets[0].card;
        const m = card.market || {};
        const lowest = Number(m.lowestPrice) || 0;
        const median = Number(m.medianPrice) || 0;
        const vel = Number(m.avgSoldPerHour) || 0;
        const sold24 = Number(m.soldQty24h) || 0;
        const priceStr = lowest > 0 ? `ต่ำสุด ${fmt(lowest)} z` : median > 0 ? `ราคากลาง ~${fmt(median)} z` : 'ไม่มีวางขาย';
        titleEl.innerHTML = `
          ${card.icon ? `<img src="${esc(card.icon)}" alt="">` : '🃏'}
          <div>
            <b>${esc(card.name)}</b>
            <small>${esc(priceStr)} · เฉลี่ย ${vel.toFixed(2)} ใบ/ชม. · <span style="color:#34d399;font-weight:700;">🏷️ เพิ่มเข้า Auto-Sell (≥1 ใบ ขายทันที) อัตโนมัติ</span></small>
          </div>
        `;
      } else {
        titleEl.innerHTML = `
          <span style="font-size:20px;">⚖️</span>
          <div>
            <b>เลือก ${M} การ์ด — เฉลี่ยกระจาย ${N} จอไปฟาร์มอัตโนมัติ</b>
            <small>แบ่งจอไปฟาร์มเท่าๆ กัน + <span style="color:#34d399;font-weight:700;">🏷️ เพิ่มการ์ดประจำแมพเข้า Auto-Sell (≥1 ใบ ขายทันที) ให้ทุกจออัตโนมัติ</span></small>
          </div>
        `;
      }
    }

    const cardsListEl = document.getElementById('cd-fp-cards-list');
    if (cardsListEl) {
      cardsListEl.innerHTML = buckets
        .map(b => {
          const c = b.card;
          const cardMaps = Array.isArray(c.maps) ? c.maps : [];
          const mapOpts =
            cardMaps.length > 0
              ? cardMaps
                  .map(mp => {
                    const lvLabel = mp.mapLevel || getMapLevelLabel(mp.map, mp.monsterLevel);
                    return `<option value="${esc(mp.map)}"${mp.map === b.mapName ? ' selected' : ''}>🗺️ ${esc(mp.map)}${lvLabel ? ' ' + esc(lvLabel) : ''} (${mp.count} ตัว)</option>`;
                  })
                  .join('')
              : `<option value="">— ไม่มีแมพมอนสเตอร์ประจำ —</option>`;

          const namesPreview =
            b.clientNames.length > 0
              ? ` (${b.clientNames.slice(0, 3).join(', ')}${b.clientNames.length > 3 ? '…' : ''})`
              : '';

          return `
            <div class="cd-fp-card-row">
              <div class="cd-fp-cr-name" title="${esc(c.name)}">
                ${c.icon ? `<img src="${esc(c.icon)}" alt="">` : '🃏'}
                <span>${esc(c.name.replace(/ Card$/i, ''))}</span>
              </div>
              <select class="cd-fp-map-sel" data-card-map="${c.id}" ${cardMaps.length === 0 ? 'disabled' : ''}>
                ${mapOpts}
              </select>
              <span class="cd-fp-cr-quota" title="จอที่ถูกแบ่งให้การ์ดใบนี้: ${esc(b.clientNames.join(', ') || 'ยังไม่ได้เลือกจอ')}">
                🎯 แบ่ง ${b.profileIds.length} จอ${esc(namesPreview)}
              </span>
              <button type="button" class="cd-fp-cr-rm" data-rm-card="${c.id}" title="เอาการ์ดใบนี้ออกจากที่เลือก">✕</button>
            </div>
          `;
        })
        .join('');
    }

    const clientsBox = document.getElementById('cd-fp-clients');
    if (clientsBox) {
      if (!state.clients || state.clients.length === 0) {
        clientsBox.classList.remove('is-grouped');
        clientsBox.innerHTML = `<div style="color:#64748b;font-size:11.5px;padding:8px;">ยังไม่มีโปรไฟล์ในระบบ</div>`;
      } else {
        const { hasParties, partyGroups, soloClients, roleMap } = buildClientPartyGrouping();

        const renderClientCard = cl => {
          const pid = String(cl.id);
          const checked = selectedProfileIds.has(pid);
          const dispName = cl.charName ? `${cl.charName} (${cl.name})` : cl.name;
          const lvStr = cl.level ? `Lv.${cl.level}` : '';
          const curMap = cl.currentMap ? formatMapWithLevel(cl.currentMap) : (cl.online ? 'ในเมือง/กำลังโหลด' : 'ออฟไลน์');
          const ovMap = String(cl.overrideFarmMap || '').trim();
          const assigned = byProfileId.get(pid);
          const autoSellCards = Array.isArray(cl.autoSellCards) ? cl.autoSellCards : [];
          const roleInfo = roleMap.get(pid);
          let roleChipHtml = '';
          if (roleInfo) {
            if (roleInfo.isLeader && roleInfo.isAnchorPriest) {
              roleChipHtml = `<span class="cd-fp-role-chip role-priest-leader">👑✨ หัวตี้·พระ #${roleInfo.partyIndex}</span>`;
            } else if (roleInfo.isLeader) {
              roleChipHtml = `<span class="cd-fp-role-chip role-leader">👑 หัวตี้ #${roleInfo.partyIndex}</span>`;
            } else if (roleInfo.isAnchorPriest) {
              roleChipHtml = `<span class="cd-fp-role-chip role-priest">✨ พระหลัก #${roleInfo.partyIndex}</span>`;
            } else {
              roleChipHtml = `<span class="cd-fp-role-chip role-member">👥 ตี้ #${roleInfo.partyIndex}</span>`;
            }
          }

          return `
            <label class="cd-fp-client${checked ? ' checked' : ''}">
              <input type="checkbox" data-prof-id="${esc(pid)}"${checked ? ' checked' : ''}>
              <span class="cd-fp-dot${cl.online ? ' on' : ''}"></span>
              <div class="cd-fp-cinfo">
                <div class="cd-fp-cname-row">
                  <span class="cd-fp-cname">${esc(dispName)} <small style="color:#94a3b8;font-weight:500;">${esc(lvStr)}</small></span>
                  ${roleChipHtml}
                </div>
                <div class="cd-fp-cmap">
                  📍 ${esc(curMap)}
                  ${ovMap ? ` · <b>🗺️ เป้าหมายการ์ด: ${esc(formatMapWithLevel(ovMap))}</b>` : ''}
                </div>
                ${
                  autoSellCards.length > 0
                    ? `<div style="font-size:10px;color:#34d399;margin-top:2px;">🏷️ Auto-Sell (≥1): ${esc(autoSellCards.join(', '))}</div>`
                    : ''
                }
                ${
                  assigned && assigned.mapName
                    ? `<div class="cd-fp-cassign">➡️ จะไป: ${esc(formatMapWithLevel(assigned.mapName))} (${esc(assigned.card.name.replace(/ Card$/i, ''))} · Auto-Sell ≥1)</div>`
                    : ''
                }
              </div>
            </label>
          `;
        };

        if (hasParties) {
          clientsBox.classList.add('is-grouped');
          const partySectionsHtml = partyGroups
            .map(g => {
              const isCollapsed = collapsedClientGroups.has(g.key);
              const allChecked = g.clients.length > 0 && g.selectedCount === g.clients.length;
              return `
                <section class="cd-fp-group is-party-group${isCollapsed ? ' is-collapsed' : ''}">
                  <header class="cd-fp-group-head" data-group-key="${esc(g.key)}">
                    <div class="cd-fp-gh-left">
                      <button type="button" class="cd-fp-collapse-btn" title="${isCollapsed ? 'คลิกเพื่อขยายดูจอในตี้นี้' : 'คลิกเพื่อพับเก็บจอในตี้นี้'}">${isCollapsed ? '▶' : '▼'}</button>
                      <label class="cd-fp-group-check-wrap" title="ติ๊กเลือก/ยกเลิกเลือกทุกจอในปาร์ตี้ #${g.partyIndex}">
                        <input type="checkbox" class="cd-fp-group-check" data-group-check="${esc(g.key)}"${allChecked ? ' checked' : ''}>
                      </label>
                      <span class="cd-fp-group-badge party">👑 ปาร์ตี้ #${g.partyIndex}</span>
                      <div class="cd-fp-gh-titles">
                        <div class="cd-fp-gh-main">
                          <span>หัวตี้: <b>${esc(g.leaderName)}</b></span>
                          ${
                            g.priestName
                              ? `<span class="cd-fp-priest-pill">✨ พระหลัก: <b>${esc(g.priestName)}</b></span>`
                              : `<span class="cd-fp-no-priest-pill">ไม่มีพระในตี้</span>`
                          }
                        </div>
                        <div class="cd-fp-gh-meta">
                          <span class="cd-fp-meta-chip">👥 สมาชิก <b>${g.clients.length}</b>/${g.max} · ออนไลน์ <b>${g.onlineCount}</b></span>
                          <span class="cd-fp-meta-chip map">📍 ${esc(g.mapLabel)}</span>
                        </div>
                      </div>
                    </div>
                    <div class="cd-fp-gh-right">
                      <button type="button" class="cd-fp-group-sel-btn${allChecked ? ' all-on' : g.selectedCount > 0 ? ' some-on' : ''}" data-group-select-btn="${esc(g.key)}" title="คลิกเพื่อเลือกหรือยกเลิกทั้งปาร์ตี้ #${g.partyIndex}">
                        ${allChecked ? '✅ เลือกทั้งตี้แล้ว' : '☑️ เลือกทั้งตี้'} (${g.selectedCount}/${g.clients.length})
                      </button>
                    </div>
                  </header>
                  ${
                    isCollapsed
                      ? ''
                      : `<div class="cd-fp-group-grid">${g.clients.map(renderClientCard).join('')}</div>`
                  }
                </section>
              `;
            })
            .join('');

          const soloKey = 'solo';
          const soloCollapsed = collapsedClientGroups.has(soloKey);
          const soloOnline = soloClients.filter(c => c.online).length;
          const soloSelected = soloClients.filter(c => selectedProfileIds.has(String(c.id))).length;
          const soloAllChecked = soloClients.length > 0 && soloSelected === soloClients.length;

          const soloSectionHtml = `
            <section class="cd-fp-group is-solo-group${soloCollapsed ? ' is-collapsed' : ''}">
              <header class="cd-fp-group-head" data-group-key="${soloKey}">
                <div class="cd-fp-gh-left">
                  <button type="button" class="cd-fp-collapse-btn" title="${soloCollapsed ? 'คลิกเพื่อขยายดูจอฟาร์มเดี่ยว' : 'คลิกเพื่อพับเก็บจอฟาร์มเดี่ยว'}">${soloCollapsed ? '▶' : '▼'}</button>
                  <label class="cd-fp-group-check-wrap" title="ติ๊กเลือก/ยกเลิกเลือกทุกจอฟาร์มเดี่ยว">
                    <input type="checkbox" class="cd-fp-group-check" data-group-check="${soloKey}"${soloAllChecked ? ' checked' : ''} ${soloClients.length === 0 ? 'disabled' : ''}>
                  </label>
                  <span class="cd-fp-group-badge solo">⚔️ ฟาร์มเดี่ยว (Solo)</span>
                  <div class="cd-fp-gh-titles">
                    <div class="cd-fp-gh-main">
                      <span>ตัวละครที่ไม่ได้อยู่ในปาร์ตี้ (${soloClients.length} จอ)</span>
                    </div>
                    <div class="cd-fp-gh-meta">
                      <span class="cd-fp-meta-chip">🖥️ ออนไลน์ <b>${soloOnline}</b>/${soloClients.length} จอ</span>
                    </div>
                  </div>
                </div>
                ${
                  soloClients.length > 0
                    ? `<div class="cd-fp-gh-right">
                        <button type="button" class="cd-fp-group-sel-btn${soloAllChecked ? ' all-on' : soloSelected > 0 ? ' some-on' : ''}" data-group-select-btn="${soloKey}">
                          ${soloAllChecked ? '✅ เลือกโซโล่ทั้งหมดแล้ว' : '☑️ เลือกโซโล่ทั้งหมด'} (${soloSelected}/${soloClients.length})
                        </button>
                      </div>`
                    : ''
                }
              </header>
              ${
                soloCollapsed
                  ? ''
                  : soloClients.length > 0
                  ? `<div class="cd-fp-group-grid">${soloClients.map(renderClientCard).join('')}</div>`
                  : `<div style="color:#64748b;font-size:11px;padding:6px 10px;">ทุกโปรไฟล์ถูกจัดอยู่ในปาร์ตี้หมดแล้ว</div>`
              }
            </section>
          `;

          clientsBox.innerHTML = partySectionsHtml + soloSectionHtml;

          // Update indeterminate state for group checkboxes
          partyGroups.forEach(g => {
            const cb = clientsBox.querySelector(`input[data-group-check="${g.key}"]`);
            if (cb) cb.indeterminate = g.selectedCount > 0 && g.selectedCount < g.clients.length;
          });
          const soloCb = clientsBox.querySelector('input[data-group-check="solo"]');
          if (soloCb) soloCb.indeterminate = soloSelected > 0 && soloSelected < soloClients.length;
        } else {
          clientsBox.classList.remove('is-grouped');
          clientsBox.innerHTML = state.clients.map(renderClientCard).join('');
        }
      }
    }

    const goBtn = document.getElementById('cd-fp-go');
    if (goBtn) {
      const validBuckets = buckets.filter(b => b.mapName && b.profileIds.length > 0);
      goBtn.disabled = busyApplyFarm || validBuckets.length === 0 || N === 0;
      if (M <= 1 && buckets[0]) {
        goBtn.textContent = buckets[0].mapName
          ? `🚀 สั่ง ${N} จอที่เลือกไปฟาร์ม "${formatMapWithLevel(buckets[0].mapName)}" (${buckets[0].card.name})`
          : 'ไม่สามารถเลือกแมพได้';
      } else {
        goBtn.textContent = `🚀 เฉลี่ย ${N} จอ ไปฟาร์ม ${M} การ์ดที่เลือกทันที`;
      }
    }
  }

  async function applyFarmMapToSelected(clearMode) {
    if (busyApplyFarm) return;
    const ids = Array.from(selectedProfileIds);
    if (ids.length === 0) {
      toast('กรุณาติ๊กเลือกจอที่ต้องการอย่างน้อย 1 จอ', 'warning');
      return;
    }

    let payload = null;
    const { buckets } = computeScreenDistribution();

    if (clearMode) {
      payload = {
        profileIds: ids,
        mapName: '',
        walkNow: true
      };
    } else {
      const validBuckets = buckets.filter(b => b.mapName && b.profileIds.length > 0);
      if (validBuckets.length === 0) {
        toast('กรุณาเลือกการ์ดที่มีแมพมอนสเตอร์เกิดอย่างน้อย 1 ใบ', 'warning');
        return;
      }
      payload = {
        assignments: validBuckets.map(b => ({
          profileIds: b.profileIds,
          mapName: b.mapName,
          cardId: b.card.id,
          cardName: b.card.name
        }))
      };
    }

    busyApplyFarm = true;
    renderFarmPanel();
    try {
      const res = await fetch(API + '/farm-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const j = await res.json();
      await fetchCardsData();
      if (j && j.success) {
        if (clearMode) {
          toast(`ปลดล็อกแมพการ์ดของ ${ids.length} จอแล้ว (กลับไปฟาร์มแมพตาม Plan Script เดิม)`, 'success');
        } else if (payload.assignments && payload.assignments.length > 1) {
          const summary = payload.assignments
            .map(a => `${a.cardName.replace(/ Card$/i, '')} → ${a.mapName} (${a.profileIds.length} จอ)`)
            .join(' · ');
          toast(`เฉลี่ยจอฟาร์มสำเร็จ + เพิ่มการ์ดเข้า Auto-Sell (≥1 ขายทันที)! ${summary}`, 'success');
        } else if (payload.assignments && payload.assignments[0]) {
          const a = payload.assignments[0];
          const autoCards = Array.isArray(j.autoSellCards) && j.autoSellCards.length > 0 ? j.autoSellCards.join(', ') : a.cardName;
          toast(`สั่ง ${a.profileIds.length} จอไปฟาร์ม "${a.mapName}" + 🏷️ ตั้ง Auto-Sell (≥1 ใบ ขายทันที): ${autoCards}`, 'success');
        }
      } else {
        toast((j && j.error) || 'สั่งเปลี่ยนแมพไม่สำเร็จ', 'error');
      }
    } catch (e) {
      toast('เกิดข้อผิดพลาด: ' + e.message, 'error');
    } finally {
      busyApplyFarm = false;
      renderFarmPanel();
    }
  }

  async function clearAllOverrides() {
    const farmingIds = state.clients
      .filter(c => String(c.overrideFarmMap || '').trim())
      .map(c => String(c.id));
    if (farmingIds.length === 0) return;

    try {
      const res = await fetch(API + '/farm-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileIds: farmingIds,
          mapName: '',
          walkNow: true
        })
      });
      const j = await res.json();
      await fetchCardsData();
      if (j && j.success) {
        toast(`คืนค่าแมพตาม Plan Script เดิมให้ทั้ง ${farmingIds.length} จอเรียบร้อยแล้ว`, 'success');
      }
    } catch (e) {
      toast('เกิดข้อผิดพลาด: ' + e.message, 'error');
    }
  }

  function init() {
    buildDOM();
    window.openCardMarketDrawer = () => toggleDrawer(true);
    const prevPartyHook = window.onPartyDataUpdated;
    window.onPartyDataUpdated = function (pData) {
      if (typeof prevPartyHook === 'function') {
        try { prevPartyHook(pData); } catch (_) {}
      }
      if (isOpen && farmPanelOpen) {
        renderFarmPanel();
      }
    };
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('openCards') === '1') {
        const rawPick = String(params.get('selectCard') || '').trim();
        const picks = rawPick
          .split(',')
          .map(s => Number(s.trim()))
          .filter(Boolean);
        setTimeout(() => {
          toggleDrawer(true);
          if (picks.length > 0) {
            setTimeout(() => {
              selectedCardIds.clear();
              for (const id of picks) {
                selectedCardIds.add(id);
                ensureCardDefaultMap(id);
              }
              ensureDefaultSelectedProfiles();
              farmPanelOpen = true;
              renderAll();
            }, 600);
          }
        }, 250);
      }
    } catch (_) {}
    setTimeout(() => fetchCardsData(), 1800);
    setInterval(() => {
      if (!isOpen) fetchCardsData();
    }, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
