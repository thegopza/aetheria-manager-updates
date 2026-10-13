// manager/public/gear_builder.js — "🛡️ เซ็ตอุปกรณ์" of a plan.
//
// plan.gearPlan = { startClass, steps: [...] } — the bot works through the steps strictly in order, one at a time:
//   { id, kind: 'equip',  slot, itemId, itemName, options: 'DEX>=1, ASPD>=1', zeny }   buy (market) / equip
//   { id, kind: 'refine', slot, itemName, toLevel, zeny, blessing }                    refine at Blacksmith Enok
// A step runs only when the zeny reached its amount AND every step before it is done (wearing the item with the
// required random options / refined to the level). It starts once the character is the chosen class (or later).
(function () {
  const SLOTS = [
    { key: 'head-upper', label: 'หมวกบน', types: ['Helmet'], side: 'L' },
    { key: 'head-middle', label: 'หน้า', types: ['HeadMid'], side: 'L' },
    { key: 'head-lower', label: 'ปาก', types: ['HeadLow'], side: 'L' },
    { key: 'armor', label: 'เกราะ / เสื้อ', types: ['Armor'], side: 'L' },
    { key: 'gloves', label: 'ถุงมือ', types: ['Glove'], side: 'L' },
    { key: 'accessory-left', label: 'เครื่องประดับ 1', types: ['Acc'], side: 'L' },
    { key: 'main-hand', label: 'อาวุธ', types: ['Weapon'], side: 'R' },
    { key: 'off-hand', label: 'มือซ้าย / โล่', types: ['Shield'], side: 'R' },
    { key: 'garment', label: 'ผ้าคลุม', types: ['Cape'], side: 'R' },
    { key: 'legs', label: 'กางเกง', types: ['Pants'], side: 'R' },
    { key: 'boots', label: 'รองเท้า', types: ['Boot'], side: 'R' },
    { key: 'accessory-right', label: 'เครื่องประดับ 2', types: ['Acc'], side: 'R' },
    { key: 'gem-1', label: 'เจม 1', types: ['Gem'], side: 'G' },
    { key: 'gem-2', label: 'เจม 2', types: ['Gem'], side: 'G' },
    { key: 'gem-3', label: 'เจม 3', types: ['Gem'], side: 'G' },
    { key: 'gem-4', label: 'เจม 4', types: ['Gem'], side: 'G' }
  ];
  const OPTION_TYPES = ['DEX', 'AGI', 'STR', 'VIT', 'INT', 'LUK', 'ATK', 'ATK%', 'MATK', 'MATK%', 'ASPD', 'HIT', 'FLEE', 'CRIT', 'CRIT_DAMAGE', 'MAXHP', 'MAXSP', 'DEF', 'MDEF', 'MOVE_SPEED', 'RANGED_DAMAGE_PERCENT', 'MELEE_DAMAGE_PERCENT', 'MAGIC_DAMAGE_PERCENT', 'DAMAGE_REDUCTION', 'HEAL_POWER'];
  const RARITY = { common: '#cbd5e1', uncommon: '#4ade80', rare: '#38bdf8', epic: '#c084fc', legendary: '#fbbf24' };
  const ATTR_TH = { MELEE_ATTACK: 'ATK ประชิด', RANGE_ATTACK: 'ATK ระยะไกล', MAGIC_ATTACK: 'MATK', MELEE_DEFENSE: 'DEF', MAGIC_DEFENSE: 'MDEF' };

  let cards = [], pickMode = 'item';
  let items = null, classes = [], snapshot = null, slotSel = 'main-hand', query = '', onlyMine = true, focusStepId = null;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => (Number(n) || 0).toLocaleString();
  const plan = () => (typeof activeEditingPlan !== 'undefined' ? activeEditingPlan : null);
  const gp = () => {
    const p = plan();
    if (!p.gearPlan || typeof p.gearPlan !== 'object') p.gearPlan = { startClass: 'novice', steps: [] };
    if (!Array.isArray(p.gearPlan.steps)) p.gearPlan.steps = [];
    return p.gearPlan;
  };
  const newId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  // classes of this plan: novice -> class 1 -> class 2
  function lineage() {
    const p = plan() || {};
    return ['novice', p.class1Target || 'archer', p.class2Target || ''].filter(Boolean);
  }
  const className = id => (classes.find(c => c.id === id) || {}).name || (id ? id[0].toUpperCase() + id.slice(1) : '');
  const gemSkill = name => String(name || '').replace(/\s+Gem\b.*$/i, '').trim().toLowerCase();
  function planSkillNames() {
    const db = (typeof SKILLS_DATABASE !== 'undefined' && SKILLS_DATABASE) || {};
    const mine = new Set(), all = new Set();
    Object.keys(db).forEach(t => (db[t] || []).forEach(s => {
      const n = String(s.name || '').toLowerCase();
      all.add(n);
      if (lineage().includes(t)) mine.add(n);
    }));
    return { mine, all };
  }
  function wearableByPlan(it) {
    if (it.slotType === 'Gem') {
      const sk = gemSkill(it.name), names = planSkillNames();
      return names.mine.has(sk) || !names.all.has(sk);
    }
    if (!it.jobs || !it.jobs.length) return true;
    const names = lineage().map(className).map(n => n.toLowerCase());
    return it.jobs.some(j => names.includes(String(j).toLowerCase()));
  }
  const itemById = id => (items || []).find(i => i.id === id);

  const cardById = id => cards.find(c => c.id === id);
  // what the steps plan for a slot: last item + highest refine + its cards
  function slotPlan(slotKey) {
    const steps = gp().steps;
    let equip = null, refine = 0, cardCount = 0;
    steps.forEach(st => {
      if (st.slot !== slotKey) return;
      if (st.kind === 'equip') { equip = st; refine = 0; cardCount = 0; }
      else if (st.kind === 'refine' && equip && st.itemName === equip.itemName) refine = Math.max(refine, st.toLevel || 0);
      else if (st.kind === 'card' && equip && st.itemName === equip.itemName) cardCount++;
    });
    return { equip, refine, cardCount };
  }

  function ensureModal() {
    let m = document.getElementById('gear-builder-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'gear-builder-modal';
    m.className = 'gb-backdrop';
    m.innerHTML = `
      <div class="gb-card" role="dialog" aria-label="เซ็ตอุปกรณ์">
        <header class="gb-head">
          <div>
            <h3>🛡️ เซ็ตอุปกรณ์ <span class="gb-plan-name"></span></h3>
            <small>คลิกช่องสวมใส่ / เจม → เลือกไอเทม → ใส่เงินและเลเวลที่ต้องถึงก่อน · <b>+</b> = ตีบวก · <b>🃏</b> = ใส่การ์ด (ไอเทมที่มีรู) · บอททำทีละรายการตามลำดับ · เจม % สูงกว่าที่ตั้งก็นับว่าผ่าน</small>
          </div>
          <button type="button" class="gb-x" data-gb="cancel" aria-label="ปิด">✕</button>
        </header>
        <div class="gb-start">
          <label>▶️ เริ่มทำเซ็ตเมื่อเป็นอาชีพ</label>
          <select class="gb-start-sel"></select>
          <span class="gb-start-hint"></span>
        </div>
        <div class="gb-main">
          <div class="gb-board">
            <div class="gb-col gb-col-L"></div>
            <div class="gb-figure"><img class="gb-figure-img" alt=""></div>
            <div class="gb-col gb-col-R"></div>
            <div class="gb-gems gb-col-G"></div>
          </div>
          <div class="gb-picker">
            <div class="gb-picker-head"><b class="gb-picker-title"></b></div>
            <input type="search" class="gb-search" placeholder="ค้นหาชื่อ / ประเภท / สเตตัส (เช่น bow, dex, staff)">
            <label class="gb-only"><input type="checkbox" class="gb-only-cb" checked> แสดงเฉพาะที่อาชีพในแผนใส่ได้</label>
            <div class="gb-list"><div class="gb-empty">กำลังโหลดรายการไอเทมจากเกม...</div></div>
          </div>
        </div>
        <div class="gb-done-map">
          <label>🏁 เมื่อเซ็ตครบทุกรายการ → เปลี่ยนแมพฟาร์มเป็น</label>
          <select class="gb-done-sel"></select>
          <span class="gb-start-hint">ทำครั้งเดียวต่อตัวละคร · เปลี่ยนแมพเองภายหลังได้ ระบบจะไม่เปลี่ยนกลับ</span>
        </div>
        <div class="gb-steps-head">
          <b>📋 ลำดับการทำงาน (<span class="gb-steps-count">0</span> รายการ)</b>
          <small>รายการถัดไปจะเริ่มเมื่อรายการก่อนหน้าเสร็จแล้ว และเงิน + เลเวลถึงตามที่ตั้ง</small>
        </div>
        <div class="gb-steps"></div>
        <footer class="gb-foot">
          <button type="button" class="btn btn-secondary" data-gb="cancel">ยกเลิก</button>
          <button type="button" class="btn btn-success" data-gb="save">💾 ใช้เซ็ตนี้</button>
        </footer>
      </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', onClick);
    m.addEventListener('change', onChange);
    m.addEventListener('input', onInput);
    return m;
  }

  // ---------- render ----------
  function render() {
    const m = ensureModal();
    const p = plan();
    m.querySelector('.gb-plan-name').textContent = p && p.name ? '— ' + p.name : '';
    // start class
    const sel = m.querySelector('.gb-start-sel');
    sel.innerHTML = lineage().map((c, i) => `<option value="${esc(c)}">${['Novice', 'Class 1', 'Class 2'][i] || ''}: ${esc(className(c))}</option>`).join('');
    if (!lineage().includes(gp().startClass)) gp().startClass = 'novice';
    sel.value = gp().startClass;
    m.querySelector('.gb-start-hint').textContent = `บอทจะเริ่มทำรายการแรกเมื่อตัวละครเป็น ${className(sel.value)} (หรืออาชีพถัดไปในสาย) แล้ว`;
    // map after the whole set is done (once)
    const dm = m.querySelector('.gb-done-sel');
    const groups = (typeof PLAN_MAP_OPTIONS !== 'undefined' && Array.isArray(PLAN_MAP_OPTIONS)) ? PLAN_MAP_OPTIONS : [];
    dm.innerHTML = '<option value="">— ไม่เปลี่ยนแมพ —</option>' + groups.map(g => `<optgroup label="${esc(g.group)}">${(g.maps || [])
      .filter(x => !/เมืองหลวง|โซลเฮเวน/.test(x.value)).map(x => `<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('')}</optgroup>`).join('');
    dm.value = gp().onCompleteMap || '';
    // figure
    const cls = lineage()[lineage().length - 1];
    const img = m.querySelector('.gb-figure-img');
    img.src = `https://www.aetheria-online.in.th/art/classes/${cls}.webp`;
    img.onerror = () => { img.style.visibility = 'hidden'; };
    // slots
    ['L', 'R', 'G'].forEach(side => {
      m.querySelector('.gb-col-' + side).innerHTML = SLOTS.filter(s => s.side === side).map(s => {
        const sp = slotPlan(s.key);
        const it = sp.equip && itemById(sp.equip.itemId);
        return `<div class="gb-slot ${slotSel === s.key ? 'active' : ''} ${sp.equip ? 'filled' : ''}" data-slot="${s.key}">
          <div class="gb-slot-icon">${it && it.icon ? `<img src="${esc(it.icon)}" alt="">` : ''}</div>
          <div class="gb-slot-text">
            <small>${esc(s.label)}</small>
            <b style="${it ? 'color:' + (RARITY[it.rarity] || '#e2e8f0') : ''}">${sp.equip ? esc(sp.equip.itemName) + (sp.refine ? ` <span class="gb-ref">+${sp.refine}</span>` : '') + (sp.cardCount ? ` <span class="gb-cardn">🃏${sp.cardCount}</span>` : '') : 'ว่าง'}</b>
          </div>
          ${sp.equip && it && it.slots > 0 ? `<button type="button" class="gb-card-btn ${slotSel === s.key && pickMode === 'card' ? 'on' : ''}" data-gb="card-mode" data-slot="${s.key}" title="ใส่การ์ดใน ${esc(sp.equip.itemName)} (${sp.cardCount}/${it.slots} ช่อง)">🃏 ${sp.cardCount}/${it.slots}</button>` : ''}
          ${sp.equip && (!it || it.refineable) ? `<div class="gb-slot-ref"><button type="button" data-gb="ref-minus" data-slot="${s.key}" title="เอาขั้นตีบวกล่าสุดออก" ${sp.refine ? '' : 'disabled'}>−</button><button type="button" data-gb="ref-plus" data-slot="${s.key}" title="เพิ่มรายการตีบวก +${sp.refine + 1}" ${sp.refine >= 10 ? 'disabled' : ''}>+</button></div>` : ''}
        </div>`;
      }).join('');
    });
    renderPicker();
    renderSteps();
  }

  function renderPicker() {
    const m = ensureModal();
    const slot = SLOTS.find(s => s.key === slotSel);
    m.querySelector('.gb-picker-title').textContent = `เลือก${slot ? slot.label : ''}`;
    const box = m.querySelector('.gb-list');
    if (!items) return;
    if (pickMode === 'card') return renderCardPicker(m, slot, box);
    const q = query.trim().toLowerCase();
    const list = items.filter(it => slot.types.includes(it.slotType))
      .filter(it => !onlyMine || wearableByPlan(it))
      .filter(it => !q || [it.name, it.weaponType, ...(it.attributes || []).map(a => a.type), ...(it.jobs || [])].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (a.level - b.level) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!list.length) { box.innerHTML = '<div class="gb-empty">ไม่พบไอเทมที่ตรงกับการค้นหา</div>'; return; }
    box.innerHTML = list.map(it => `
      <div class="gb-item">
        <div class="gb-item-icon">${it.icon ? `<img src="${esc(it.icon)}" alt="" loading="lazy">` : ''}</div>
        <div class="gb-item-body">
          <b style="color:${RARITY[it.rarity] || '#e2e8f0'}">${esc(it.name)}${it.slots ? ` [${it.slots}]` : ''}</b>
          <small>Lv.${it.level}${it.weaponType && it.weaponType !== 'None' ? ' · ' + esc(it.weaponType) : ''}${it.refineable ? '' : ' · ตีบวกไม่ได้'}${it.jobs.length ? ' · ' + esc(it.jobs.join('/')) : ''}</small>
          <div class="gb-attrs">${(it.attributes || []).map(a => `<span>${esc(ATTR_TH[a.type] || a.type)} +${a.value}</span>`).join('')}</div>
        </div>
        <button type="button" class="gb-pick" data-gb="pick" data-id="${it.id}">เลือก</button>
      </div>`).join('');
  }

  // Cards that fit the planned item of the slot (game: card.cardSlotTypes has the item's equipment type)
  function renderCardPicker(m, slot, box) {
    const sp = slotPlan(slotSel);
    const it = sp.equip && itemById(sp.equip.itemId);
    if (!sp.equip || !it) { pickMode = 'item'; return renderPicker(); }
    m.querySelector('.gb-picker-title').textContent = `🃏 เลือกการ์ดใส่ ${sp.equip.itemName} (${sp.cardCount}/${it.slots} ช่อง)`;
    const q = query.trim().toLowerCase();
    const list = cards.filter(c => (c.cardSlotTypes || []).includes(it.slotType))
      .filter(c => !q || [c.name, ...(c.attributes || []).map(a => a.type)].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const full = sp.cardCount >= it.slots;
    if (!list.length) { box.innerHTML = '<div class="gb-empty">ไม่มีการ์ดที่ใส่กับไอเทมชนิดนี้ได้</div>'; return; }
    box.innerHTML = `<div class="gb-card-note">ใส่แล้วถอดเองไม่ได้ (ต้องให้ NPC ถอดและเสียเงิน) · การ์ดติดไปกับอุปกรณ์ชิ้นนี้${full ? ' · <b>ช่องการ์ดเต็มแล้ว</b>' : ''}</div>` + list.map(c => `
      <div class="gb-item">
        <div class="gb-item-icon">${c.icon ? `<img src="${esc(c.icon)}" alt="" loading="lazy">` : ''}</div>
        <div class="gb-item-body">
          <b style="color:${RARITY[c.rarity] || '#e2e8f0'}">${esc(c.name)}</b>
          <small>ใส่ได้กับ: ${esc((c.cardSlotTypes || []).join(', '))}</small>
          <div class="gb-attrs">${(c.attributes || []).map(a => `<span>${esc(ATTR_TH[a.type] || a.type)} +${esc(a.value)}</span>`).join('')}</div>
        </div>
        <button type="button" class="gb-pick" data-gb="pick-card" data-id="${c.id}" ${full ? 'disabled' : ''}>ใส่</button>
      </div>`).join('');
  }

  function stepText(st) {
    if (st.kind === 'card') return `🃏 ใส่การ์ด <b>${esc(st.cardName)}</b> ใน <b>${esc(st.itemName)}</b>`;
    if (st.kind === 'refine') return `🔨 ตีบวก <b>${esc(st.itemName)}</b> → <span class="gb-ref">+${Number(st.toLevel) || 0}</span>`;
    return `🛒 ซื้อ / สวม <b>${esc(st.itemName)}</b>`;
  }
  function optionChips(st) {
    const terms = String(st.options || '').split(',').map(s => s.trim()).filter(Boolean);
    return terms.map((t, i) => `<span class="gb-opt">${esc(t.replace('>=', ' ≥ '))}<button type="button" data-gb="opt-del" data-id="${esc(st.id)}" data-i="${i}" aria-label="ลบ">✕</button></span>`).join('');
  }
  function renderSteps() {
    const m = ensureModal();
    const steps = gp().steps;
    m.querySelector('.gb-steps-count').textContent = steps.length;
    const box = m.querySelector('.gb-steps');
    if (!steps.length) {
      box.innerHTML = '<div class="gb-empty">ยังไม่มีรายการ — คลิกช่องสวมใส่ด้านบน แล้วกด "เลือก" ที่ไอเทม</div>';
      return;
    }
    box.innerHTML = steps.map((st, i) => {
      const it = st.kind === 'card' ? cardById(st.cardId) : st.itemId ? itemById(st.itemId) : (items || []).find(x => x.name === st.itemName);
      const slot = SLOTS.find(s => s.key === st.slot);
      // a refine step needs its item equipped by an earlier step
      const orphan = (st.kind === 'refine' || st.kind === 'card') && !steps.slice(0, i).some(x => x.kind === 'equip' && x.slot === st.slot && x.itemName === st.itemName);
      return `<div class="gb-step ${focusStepId === st.id ? 'flash' : ''} ${orphan ? 'warn' : ''}" data-id="${esc(st.id)}">
        <span class="gb-step-no">${i + 1}</span>
        <div class="gb-step-icon">${it && it.icon ? `<img src="${esc(it.icon)}" alt="">` : ''}</div>
        <div class="gb-step-body">
          <div class="gb-step-title">${stepText(st)} <small>· ${esc(slot ? slot.label : st.slot)}</small></div>
          ${st.kind === 'equip' ? `<div class="gb-step-opts"><small>ออปชั่นสุ่มที่ต้องมี:</small> ${optionChips(st) || '<small class="gb-muted">ไม่กำหนด (ชื่อตรงก็ใช้ได้)</small>'}
            <select class="gb-opt-type" data-id="${esc(st.id)}"><option value="">+ เพิ่มออปชั่น</option>${OPTION_TYPES.map(o => `<option value="${o}">${o}</option>`).join('')}</select></div>` : ''}
          ${st.kind === 'refine' ? `<label class="gb-step-bless"><input type="checkbox" data-gb="bless" data-id="${esc(st.id)}" ${st.blessing !== false ? 'checked' : ''}> ใช้ Blacksmith Blessing ถ้ามี (กันแตก/ลดขั้น) · ขั้นที่อาจแตกจะรอจนมี Blessing — เอาติ๊กออก = ยอมเสี่ยงตีเลย</label>` : ''}
          ${st.kind === 'refine' && st.toLevel > 4 ? `<small class="gb-warn-text">⚠️ เกิน +4 (ขั้นปลอดภัย) ตีพลาดอาจลดขั้น · +${st.toLevel >= 9 ? st.toLevel + ' อาจแตก ถ้าไม่มี Blessing' : '9 ขึ้นไปอาจแตก'}</small>` : ''}
          ${st.kind === 'card' ? '<small class="gb-warn-text">🃏 ใส่แล้วถอดเองไม่ได้ · ไม่มีการ์ดในกระเป๋า = ซื้อในตลาด (ราคาไม่เกินเงินที่ตั้ง)</small>' : ''}
          ${orphan ? '<small class="gb-warn-text">⚠️ ต้องมีรายการซื้อ/สวมไอเทมนี้อยู่ก่อนหน้า — ไม่งั้นบอทจะข้ามรายการนี้</small>' : ''}
        </div>
        <div class="gb-conds">
          <label class="gb-zeny" title="บอทเริ่มรายการนี้เมื่อเงินถึงจำนวนนี้ · ซื้อไอเทมในราคาไม่เกินจำนวนนี้">เมื่อเงิน ≥ <input type="text" inputmode="numeric" data-gb="zeny" data-id="${esc(st.id)}" value="${num(st.zeny)}"> z</label>
          <label class="gb-lv" title="และ Base Lv. ถึงค่านี้ (0 = ไม่กำหนด)">เลเวล ≥ <input type="text" inputmode="numeric" data-gb="lv" data-id="${esc(st.id)}" value="${Number(st.minLevel) || 0}"></label>
        </div>
        <div class="gb-step-btns">
          <button type="button" data-gb="up" data-id="${esc(st.id)}" ${i === 0 ? 'disabled' : ''} title="ขึ้น">▲</button>
          <button type="button" data-gb="down" data-id="${esc(st.id)}" ${i === steps.length - 1 ? 'disabled' : ''} title="ลง">▼</button>
          <button type="button" data-gb="del" data-id="${esc(st.id)}" title="ลบ" class="gb-del">🗑</button>
        </div>
      </div>`;
    }).join('');
    if (focusStepId) {
      const el = box.querySelector(`.gb-step[data-id="${CSS.escape(focusStepId)}"]`);
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      focusStepId = null;
    }
  }

  // ---------- events ----------
  const stepById = id => gp().steps.find(s => s.id === id);
  const lastZeny = () => { const st = gp().steps; return st.length ? (Number(st[st.length - 1].zeny) || 0) : 0; };
  const lastLevel = () => { const st = gp().steps; return st.length ? (Number(st[st.length - 1].minLevel) || 0) : 0; };
  function onClick(e) {
    const slotEl = e.target.closest('.gb-slot');
    const btn = e.target.closest('[data-gb]');
    const act = btn && btn.dataset.gb;
    if (slotEl && !btn) { slotSel = slotEl.dataset.slot; pickMode = 'item'; query = ''; ensureModal().querySelector('.gb-search').value = ''; render(); return; }
    if (!act) return;
    const steps = gp().steps;
    const id = btn.dataset.id;
    if (act === 'cancel') return close(false);
    if (act === 'save') return close(true);
    if (act === 'pick') {
      const it = itemById(Number(id));
      if (!it) return;
      const st = { id: newId(), kind: 'equip', slot: slotSel, itemId: it.id, itemName: it.name, jobs: (it.jobs || []).slice(), options: '', zeny: lastZeny(), minLevel: Number(it.level) || 0 };
      steps.push(st);
      focusStepId = st.id;
      return render();
    }
    if (act === 'card-mode') {
      slotSel = btn.dataset.slot;
      pickMode = 'card';
      query = '';
      ensureModal().querySelector('.gb-search').value = '';
      return render();
    }
    if (act === 'pick-card') {
      const c = cardById(Number(id));
      const sp = slotPlan(slotSel);
      const it = sp.equip && itemById(sp.equip.itemId);
      if (!c || !sp.equip || !it) return;
      if (sp.cardCount >= it.slots) return alert(`${sp.equip.itemName} มีช่องการ์ดแค่ ${it.slots} ช่อง`);
      const st = { id: newId(), kind: 'card', slot: slotSel, itemName: sp.equip.itemName, cardId: c.id, cardName: c.name, zeny: lastZeny(), minLevel: lastLevel() };
      steps.push(st);
      focusStepId = st.id;
      return render();
    }
    if (act === 'ref-plus' || act === 'ref-minus') {
      const sp = slotPlan(btn.dataset.slot);
      if (!sp.equip) return;
      if (act === 'ref-plus') {
        const st = { id: newId(), kind: 'refine', slot: btn.dataset.slot, itemName: sp.equip.itemName, toLevel: sp.refine + 1, zeny: lastZeny(), minLevel: lastLevel(), blessing: true };
        steps.push(st);
        focusStepId = st.id;
      } else {
        for (let i = steps.length - 1; i >= 0; i--) {
          if (steps[i].kind === 'refine' && steps[i].slot === btn.dataset.slot && steps[i].itemName === sp.equip.itemName && steps[i].toLevel === sp.refine) { steps.splice(i, 1); break; }
        }
      }
      return render();
    }
    const idx = steps.findIndex(s => s.id === id);
    if (idx < 0) return;
    if (act === 'del') steps.splice(idx, 1);
    else if (act === 'up' && idx > 0) [steps[idx - 1], steps[idx]] = [steps[idx], steps[idx - 1]];
    else if (act === 'down' && idx < steps.length - 1) [steps[idx + 1], steps[idx]] = [steps[idx], steps[idx + 1]];
    else if (act === 'opt-del') {
      const terms = String(steps[idx].options || '').split(',').map(s => s.trim()).filter(Boolean);
      terms.splice(Number(btn.dataset.i), 1);
      steps[idx].options = terms.join(', ');
    } else return;
    render();
  }
  function onChange(e) {
    const t = e.target;
    if (t.classList.contains('gb-start-sel')) { gp().startClass = t.value; render(); return; }
    if (t.classList.contains('gb-done-sel')) { gp().onCompleteMap = t.value || ''; return; }
    if (t.classList.contains('gb-only-cb')) { onlyMine = t.checked; renderPicker(); return; }
    if (t.classList.contains('gb-opt-type') && t.value) {
      const st = stepById(t.dataset.id);
      const min = prompt(`${t.value} อย่างน้อยเท่าไร? (ออปชั่นสุ่ม ไม่นับค่าพื้นฐานของไอเทม)`, '1');
      if (st && min !== null) {
        const v = Math.max(1, parseInt(min, 10) || 1);
        const terms = String(st.options || '').split(',').map(s => s.trim()).filter(Boolean).filter(x => !x.startsWith(t.value + '>='));
        terms.push(`${t.value}>=${v}`);
        st.options = terms.join(', ');
      }
      renderSteps();
      return;
    }
    if (t.dataset.gb === 'bless') { const st = stepById(t.dataset.id); if (st) st.blessing = t.checked; return; }
    if (t.dataset.gb === 'zeny') { t.value = num(parseInt(String(t.value).replace(/[^0-9]/g, ''), 10) || 0); }
    if (t.dataset.gb === 'lv') { t.value = Math.min(99, parseInt(String(t.value).replace(/[^0-9]/g, ''), 10) || 0); }
  }
  function onInput(e) {
    const t = e.target;
    if (t.classList.contains('gb-search')) { query = t.value; renderPicker(); return; }
    if (t.dataset.gb === 'zeny') { const st = stepById(t.dataset.id); if (st) st.zeny = parseInt(String(t.value).replace(/[^0-9]/g, ''), 10) || 0; }
    if (t.dataset.gb === 'lv') { const st = stepById(t.dataset.id); if (st) st.minLevel = Math.min(99, parseInt(String(t.value).replace(/[^0-9]/g, ''), 10) || 0); }
  }

  async function loadItems() {
    if (items) return;
    try {
      const r = await fetch('/api/game-items').then(x => x.json());
      if (!r.success) throw new Error(r.error || 'error');
      items = r.items;
      classes = r.classes || [];
      cards = r.cards || [];
    } catch (e) {
      if (!plan()) return;
      const box = ensureModal().querySelector('.gb-list');
      box.innerHTML = `<div class="gb-empty">❌ โหลดรายการไอเทมไม่สำเร็จ: ${esc(e.message)}</div>`;
      return;
    }
    if (plan() && ensureModal().style.display !== 'none') render();
  }

  function open() {
    if (!plan()) return;
    gp();
    snapshot = JSON.stringify(plan().gearPlan);
    const m = ensureModal();
    m.style.display = 'flex';
    render();
    loadItems();
  }
  function close(save) {
    const m = ensureModal();
    if (!save && snapshot && plan()) plan().gearPlan = JSON.parse(snapshot);
    snapshot = null;
    m.style.display = 'none';
    if (save && typeof markPlanDirty === 'function') markPlanDirty();
    updateGearBadge();
  }
  function updateGearBadge() {
    const badge = document.getElementById('plan-gear-count-badge');
    if (!badge || !plan()) return;
    const n = (plan().gearPlan && plan().gearPlan.steps || []).length;
    badge.textContent = `${n} รายการ`;
    badge.style.background = n ? 'rgba(34, 197, 94, 0.4)' : 'rgba(34, 197, 94, 0.18)';
  }

  window.openGearBuilderModal = open;
  window.updateGearBadge = updateGearBadge;
  document.addEventListener('click', e => { if (e.target.closest('#btn-open-gear-builder')) open(); });
})();
