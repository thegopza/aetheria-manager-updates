/* Cross-Machine Fleet Zeny Consolidation UI */
(function () {
  if (window.__PM_REMOTE_MODE__) {
    window.FleetZeny = {
      onTabShown: function () {},
      refresh: function () {}
    };
    return;
  }

  let overview = null;
  let loading = false;
  let lastError = null;
  let pollTimer = null;
  let lastFetchAt = 0;
  let initializedDom = false;
  let draftConfig = null;
  let saveTimer = null;

  function esc(val) {
    return String(val == null ? "" : val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function parseZenyText(raw, fallback = 0) {
    const s = String(raw || "").trim().toLowerCase().replace(/,/g, "");
    if (!s) return fallback;
    const mMatch = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*m$/i);
    if (mMatch) return Math.max(0, Math.floor(Number(mMatch[1]) * 1000000));
    const kMatch = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*k$/i);
    if (kMatch) return Math.max(0, Math.floor(Number(kMatch[1]) * 1000));
    const digits = parseInt(s.replace(/[^0-9]/g, ""), 10);
    return Number.isFinite(digits) && digits >= 0 ? digits : fallback;
  }

  function calcTransfer(zeny, keepZeny, roundHundredK) {
    const cur = Math.max(0, Number(zeny) || 0);
    const keep = Math.max(0, Number(keepZeny) || 0);
    if (!roundHundredK) return Math.max(0, cur - keep);
    if (keep <= 100000) {
      let rounded = Math.floor(cur / 100000) * 100000;
      if (keep > 0 && (cur - rounded) < 10000 && rounded >= 100000) {
        rounded -= 100000;
      }
      return Math.max(0, rounded);
    }
    return Math.floor(Math.max(0, cur - keep) / 100000) * 100000;
  }

  function isPaneActive() {
    const pane = document.getElementById("fleet-zeny-pane");
    return Boolean(pane && pane.classList.contains("active"));
  }

  function notifyToast(msg, type = "info") {
    if (typeof window.showToast === "function") {
      window.showToast(msg, type);
    }
  }

  function ensureShellMounted() {
    const pane = document.getElementById("fleet-zeny-pane");
    if (!pane) return null;
    if (!initializedDom || !document.getElementById("fz-machines-container")) {
      initializedDom = true;
      pane.innerHTML = `
        <div class="fz-shell">
          <div class="fz-header-banner">
            <div class="fz-title-group">
              <span class="fz-title-icon">💰</span>
              <div>
                <h2 class="fz-title">ระบบรวมเงินทุกเครื่อง (Cross-PC Zeny Consolidation)</h2>
                <p class="fz-subtitle">บริหารและรวมเงินข้ามทุกเครื่องในบัญชีเดียวกัน — เลือกได้ทั้งรวมภายในวง Proxy/LAN ก่อนแล้วส่งเข้าตัวหลัก หรือดึงตรงทุกจอที่มียอดเงินถึงเกณฑ์ที่กำหนด</p>
              </div>
            </div>
            <div class="fz-header-actions">
              <button type="button" class="btn btn-sm btn-secondary" id="fz-btn-refresh">🔄 รีเฟรชทุกเครื่อง</button>
            </div>
          </div>

          <div class="fz-kpi-grid" id="fz-kpi-grid">
            <div class="fleet-kpi-card"><span class="fleet-kpi-label">🖥️ เครื่องที่เชื่อมต่อ</span><span class="fleet-kpi-val accent-sky" id="fz-kpi-machines">- / -</span></div>
            <div class="fleet-kpi-card"><span class="fleet-kpi-label">🌐 วง IP รวมทุกเครื่อง</span><span class="fleet-kpi-val" id="fz-kpi-rings">0 วง IP</span></div>
            <div class="fleet-kpi-card"><span class="fleet-kpi-label">💰 เงินออนไลน์รวมทุกเครื่อง</span><span class="fleet-kpi-val accent-gold" id="fz-kpi-total-zeny">0 z</span></div>
            <div class="fleet-kpi-card"><span class="fleet-kpi-label">📦 ยอดที่จะเข้าตัวหลักรอบนี้</span><span class="fleet-kpi-val accent-emerald" id="fz-kpi-transfer-zeny">0 z</span></div>
          </div>

          <div class="fz-control-card">
            <div class="fz-controls-top-grid">
              <div class="fz-field">
                <label class="fz-label" for="fz-master-select">👑 ตัวหลักรับเงินปลายทาง (เลือกได้จากทุกเครื่องที่ออนไลน์และมี VIP):</label>
                <select id="fz-master-select" class="zeny-select fz-select"></select>
              </div>
              <div class="fz-field fz-field-sm">
                <label class="fz-label" for="fz-keep-input">💵 เหลือเงินติดตัวจอที่โอน:</label>
                <input type="text" id="fz-keep-input" class="zeny-select fz-input-num" value="0" placeholder="0 = โอนหมด" autocomplete="off">
              </div>
              <div class="fz-field fz-field-auto">
                <label class="fz-label">&nbsp;</label>
                <label class="fz-pill-check" for="fz-cb-round-100k" title="ปัดเศษหลักหมื่นลงให้เหลือเฉพาะหลักแสนทุกจอ">
                  <input type="checkbox" id="fz-cb-round-100k">
                  <span>✂️ ตัดเศษหลักหมื่น (100k)</span>
                </label>
              </div>
            </div>

            <div class="fz-mode-panel">
              <label class="fz-mode-toggle-row" for="fz-cb-ring-first">
                <input type="checkbox" id="fz-cb-ring-first" checked>
                <div class="fz-mode-toggle-text">
                  <div class="fz-mode-toggle-title">🛡️ รวมเงินเฉพาะในวงแลน (Proxy IP) ของแต่ละเครื่องก่อน → แล้วให้ตัวรับแต่ละวงนำมารวมที่ตัวหลัก</div>
                  <div class="fz-mode-toggle-desc" id="fz-mode-desc">ขั้นที่ 1: แต่ละเครื่องเทรดรวมเงินกันเฉพาะในวง Proxy ของตัวเองก่อน · ขั้นที่ 2: ตัวรับเงินประจำแต่ละวงจากทุกเครื่องนำมารวมเข้าตัวหลักที่เลือก</div>
                </div>
              </label>

              <div class="fz-threshold-row" id="fz-threshold-panel" style="display: none;">
                <div class="fz-threshold-input-group">
                  <span class="fz-threshold-label">💰 เงิน &gt;&gt; มากกว่า:</span>
                  <input type="text" id="fz-min-zeny-input" class="fz-threshold-input" value="1,000,000" placeholder="เช่น 1,000,000 หรือ 1M" autocomplete="off">
                  <span class="fz-threshold-unit">z</span>
                </div>
                <div class="fz-quick-chips">
                  <button type="button" class="fz-quick-chip" data-fz-preset="500000">500K</button>
                  <button type="button" class="fz-quick-chip" data-fz-preset="1000000">1M</button>
                  <button type="button" class="fz-quick-chip" data-fz-preset="2000000">2M</button>
                  <button type="button" class="fz-quick-chip" data-fz-preset="5000000">5M</button>
                  <button type="button" class="fz-quick-chip" data-fz-preset="10000000">10M</button>
                </div>
                <div class="fz-threshold-summary" id="fz-threshold-summary"></div>
              </div>
            </div>

            <div class="fz-action-bar">
              <div class="fz-action-summary" id="fz-action-summary">กำลังโหลดข้อมูลเครื่องทั้งหมด...</div>
              <div class="fz-action-btns">
                <button type="button" class="btn btn-primary fz-start-btn" id="fz-btn-start">🚀 เริ่มรวมเงินทุกเครื่องเข้าตัวหลัก</button>
                <button type="button" class="btn btn-danger fz-stop-btn" id="fz-btn-stop" style="display: none;">⏹️ หยุดการรวมเงินทันที</button>
              </div>
            </div>
          </div>

          <div class="fz-progress-card" id="fz-progress-card" style="display: none;">
            <div class="fz-progress-head">
              <div class="fz-progress-title-row">
                <span class="zeny-step-pill" id="fz-step-badge">ขั้นตอน 1/4</span>
                <span class="fz-step-text" id="fz-step-text">กำลังเตรียมความพร้อม...</span>
              </div>
              <span class="fz-progress-totals" id="fz-progress-totals"></span>
            </div>
            <div class="zeny-progress-bar-wrap" style="margin: 8px 0;">
              <div class="zeny-progress-bar-fill" id="fz-progress-bar" style="width: 0%;"></div>
            </div>
            <div class="zeny-logs-container" id="fz-logs-box" style="max-height: 220px;"></div>
          </div>

          <div class="fz-machines-container" id="fz-machines-container">
            <div class="fleet-empty-box">⏳ กำลังโหลดข้อมูลวง IP ของแต่ละเครื่อง...</div>
          </div>
        </div>
      `;

      wireControls();
    }
    return pane;
  }

  function scheduleSaveConfig() {
    if (!draftConfig) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      try {
        await fetch("/api/fleet-zeny/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draftConfig)
        });
      } catch (_) {}
    }, 220);
  }

  function wireControls() {
    document.getElementById("fz-btn-refresh")?.addEventListener("click", () => fetchOverview(true));

    const masterSel = document.getElementById("fz-master-select");
    if (masterSel) {
      masterSel.addEventListener("change", () => {
        ensureDraftConfig();
        draftConfig.masterReceiverKey = masterSel.value || "";
        scheduleSaveConfig();
        renderAll({ force: true });
      });
    }

    const keepInp = document.getElementById("fz-keep-input");
    if (keepInp) {
      keepInp.addEventListener("input", () => {
        ensureDraftConfig();
        draftConfig.keepZeny = parseZenyText(keepInp.value, 0);
        scheduleSaveConfig();
        renderAll({ force: true });
      });
      keepInp.addEventListener("blur", () => {
        ensureDraftConfig();
        keepInp.value = Number(draftConfig.keepZeny || 0).toLocaleString();
      });
    }

    const roundCb = document.getElementById("fz-cb-round-100k");
    if (roundCb) {
      roundCb.addEventListener("change", () => {
        ensureDraftConfig();
        draftConfig.roundHundredK = Boolean(roundCb.checked);
        scheduleSaveConfig();
        renderAll({ force: true });
      });
    }

    const ringFirstCb = document.getElementById("fz-cb-ring-first");
    if (ringFirstCb) {
      ringFirstCb.addEventListener("change", () => {
        ensureDraftConfig();
        draftConfig.ringFirst = Boolean(ringFirstCb.checked);
        scheduleSaveConfig();
        renderAll({ force: true });
      });
    }

    const minZenyInp = document.getElementById("fz-min-zeny-input");
    if (minZenyInp) {
      minZenyInp.addEventListener("input", () => {
        ensureDraftConfig();
        draftConfig.minZenyThreshold = parseZenyText(minZenyInp.value, 0);
        scheduleSaveConfig();
        renderAll({ force: true });
      });
      minZenyInp.addEventListener("blur", () => {
        ensureDraftConfig();
        minZenyInp.value = Number(draftConfig.minZenyThreshold || 0).toLocaleString();
      });
    }

    document.querySelectorAll("[data-fz-preset]").forEach(btn => {
      btn.addEventListener("click", () => {
        const val = parseZenyText(btn.getAttribute("data-fz-preset"), 1000000);
        ensureDraftConfig();
        draftConfig.minZenyThreshold = val;
        if (minZenyInp) minZenyInp.value = val.toLocaleString();
        scheduleSaveConfig();
        renderAll({ force: true });
      });
    });

    document.getElementById("fz-btn-start")?.addEventListener("click", startFleetConsolidation);
    document.getElementById("fz-btn-stop")?.addEventListener("click", stopFleetConsolidation);

    const machinesContainer = document.getElementById("fz-machines-container");
    if (machinesContainer) {
      machinesContainer.addEventListener("change", (e) => {
        const sel = e.target.closest(".fz-ring-receiver-select");
        if (!sel) return;
        const ringKey = sel.dataset.ringKey;
        if (!ringKey) return;
        ensureDraftConfig();
        draftConfig.ringReceivers = draftConfig.ringReceivers || {};
        if (sel.value) draftConfig.ringReceivers[ringKey] = sel.value;
        scheduleSaveConfig();
        renderAll({ force: true });
      });

      machinesContainer.addEventListener("click", async (e) => {
        const btnRunRing = e.target.closest("[data-fz-run-ring-ip]");
        if (!btnRunRing) return;
        const machineKey = btnRunRing.dataset.fzRunRingMachine;
        const ip = btnRunRing.dataset.fzRunRingIp;
        await runSingleRing(machineKey, ip, btnRunRing);
      });
    }
  }

  function ensureDraftConfig() {
    if (!draftConfig) {
      const serverCfg = overview?.config || {};
      draftConfig = {
        masterReceiverKey: serverCfg.masterReceiverKey || "",
        ringFirst: serverCfg.ringFirst !== false,
        minZenyThreshold: Number(serverCfg.minZenyThreshold ?? 1000000),
        keepZeny: Number(serverCfg.keepZeny || 0),
        roundHundredK: Boolean(serverCfg.roundHundredK),
        ringReceivers: { ...(serverCfg.ringReceivers || {}) }
      };
    }
    return draftConfig;
  }

  function recomputeClientViewStats(ov) {
    const cfg = ensureDraftConfig();
    const keepZeny = Number(cfg.keepZeny || 0);
    const round100k = Boolean(cfg.roundHundredK);
    const ringFirst = cfg.ringFirst !== false;
    const minThresh = Number(cfg.minZenyThreshold || 0);
    const ringReceivers = cfg.ringReceivers || {};
    const masterKey = cfg.masterReceiverKey || "";
    const masterSplitIdx = masterKey.indexOf("::");
    const masterMachineKey = masterSplitIdx > 0 ? masterKey.slice(0, masterSplitIdx) : "";
    const masterProfileId = masterSplitIdx > 0 ? masterKey.slice(masterSplitIdx + 2) : "";

    let estZeny = 0;
    let estCount = 0;
    let ringCountStage1 = 0;
    let machineSetWithQualifiers = new Set();

    const computedMachines = (ov?.machines || []).map(m => {
      const rings = (m.ipGroups || []).map(g => {
        const savedRecId = String(ringReceivers[g.ringKey] || "").trim();
        const masterInThisRing = (m.machineKey === masterMachineKey && masterProfileId && g.masterInThisRingId === masterProfileId)
          ? g.masterInThisRingId
          : (m.machineKey === masterMachineKey && masterProfileId && (g.receiverCandidates || []).some(c => c.id === masterProfileId) ? masterProfileId : null);

        const cands = g.receiverCandidates || [];
        let chosenRec = cands.find(c => c.isRunning && c.id === savedRecId)
          || cands.find(c => c.isRunning && c.isMain)
          || cands.filter(c => c.isRunning).slice().sort((a, b) => b.zeny - a.zeny)[0]
          || cands.find(c => c.id === savedRecId)
          || cands.find(c => c.isMain)
          || cands[0]
          || null;
        if (masterInThisRing && !savedRecId) {
          chosenRec = cands.find(c => c.id === masterInThisRing) || chosenRec;
        }
        const effectiveRec = masterInThisRing
          ? (cands.find(c => c.id === masterInThisRing) || chosenRec)
          : chosenRec;

        // Senders inside this ring when ringFirst is enabled
        const onlineCands = cands.filter(c => c.isRunning);
        const intraRingSenders = (effectiveRec && effectiveRec.isRunning)
          ? onlineCands.filter(c => c.id !== effectiveRec.id)
          : [];
        const ringTransferSum = intraRingSenders.reduce((s, c) => s + calcTransfer(c.zeny, keepZeny, round100k), 0);

        const isMasterRing = Boolean(masterInThisRing);
        let stage2AmountForRing = 0;
        if (effectiveRec && effectiveRec.isRunning) {
          const postStage1Zeny = effectiveRec.zeny + (intraRingSenders.length > 0 ? ringTransferSum : 0);
          if (isMasterRing) {
            stage2AmountForRing = ringTransferSum;
          } else {
            stage2AmountForRing = calcTransfer(postStage1Zeny, keepZeny, round100k);
          }
        }

        // Direct threshold qualifiers in this ring
        const thresholdMembers = onlineCands.filter(c => {
          if (m.machineKey === masterMachineKey && c.id === masterProfileId) return false;
          return c.zeny > minThresh && calcTransfer(c.zeny, keepZeny, round100k) > 0;
        });
        const thresholdSum = thresholdMembers.reduce((s, c) => s + calcTransfer(c.zeny, keepZeny, round100k), 0);

        if (m.isOnline) {
          if (ringFirst) {
            if (intraRingSenders.length > 0 && ringTransferSum > 0) ringCountStage1++;
            if (stage2AmountForRing > 0) {
              estZeny += stage2AmountForRing;
              if (isMasterRing) {
                estCount += intraRingSenders.length;
                machineSetWithQualifiers.add(m.machineKey);
              } else {
                estCount += 1;
                machineSetWithQualifiers.add(m.machineKey);
              }
            }
          } else {
            if (thresholdMembers.length > 0 && thresholdSum > 0) {
              estZeny += thresholdSum;
              estCount += thresholdMembers.length;
              machineSetWithQualifiers.add(m.machineKey);
            }
          }
        }

        return {
          ...g,
          isMasterRing,
          uiReceiver: effectiveRec,
          uiIntraSendersCount: intraRingSenders.length,
          uiRingTransferSum: ringTransferSum,
          uiStage2AmountForRing: stage2AmountForRing,
          uiThresholdCount: thresholdMembers.length,
          uiThresholdSum: thresholdSum,
          uiCanRunRing: Boolean(effectiveRec && effectiveRec.isRunning && intraRingSenders.length > 0 && ringTransferSum > 0)
        };
      });
      return { ...m, uiRings: rings };
    });

    return {
      cfg,
      computedMachines,
      estZeny,
      estCount,
      ringCountStage1,
      qualifyingMachinesCount: machineSetWithQualifiers.size
    };
  }

  function renderMasterSelect(ov, cfg) {
    const sel = document.getElementById("fz-master-select");
    if (!sel) return;
    if (document.activeElement === sel) return;

    const groups = ov?.masterOptionsByMachine || [];
    if (groups.length === 0) {
      const emptyHtml = `<option value="">-- ยังไม่มีตัวละครที่มี 👑 Premium ออนไลน์ในเครื่องใด --</option>`;
      if (sel.innerHTML !== emptyHtml) sel.innerHTML = emptyHtml;
      return;
    }

    const curKey = cfg.masterReceiverKey || "";
    const optsHtml = groups.map(mg => {
      const mLabel = `${mg.isCurrentMachine ? "⭐" : "🛰️"} เครื่อง ${mg.machineIndex}: ${mg.deviceName}${mg.actorReady === false ? " (⏳ รออัปเดตเวอร์ชัน)" : ""}`;
      const inner = mg.candidates.map(c => {
        const isSel = c.compositeKey === curKey ? " selected" : "";
        const star = c.isMain ? "⭐ " : "";
        const lbl = `👑 ${star}${c.name} [${c.charName}] (${Number(c.zeny || 0).toLocaleString()} z · 🛡️ ${c.ip})`;
        return `<option value="${esc(c.compositeKey)}"${isSel}>${esc(lbl)}</option>`;
      }).join("");
      return `<optgroup label="${esc(mLabel)}">${inner}</optgroup>`;
    }).join("");

    if (sel.dataset.lastHtml !== optsHtml) {
      sel.innerHTML = optsHtml;
      sel.dataset.lastHtml = optsHtml;
    }
    if (curKey && sel.value !== curKey) sel.value = curKey;
  }

  function renderProgress(state) {
    const card = document.getElementById("fz-progress-card");
    const btnStart = document.getElementById("fz-btn-start");
    const btnStop = document.getElementById("fz-btn-stop");
    if (!card) return;

    const running = Boolean(state && state.running);
    if (btnStart) {
      btnStart.disabled = running;
      btnStart.style.display = running ? "none" : "inline-flex";
    }
    if (btnStop) {
      btnStop.style.display = running ? "inline-flex" : "none";
    }

    const hasLogs = Boolean(state && Array.isArray(state.logs) && state.logs.length > 0);
    if (!running && !hasLogs) {
      card.style.display = "none";
      return;
    }
    card.style.display = "block";

    const badge = document.getElementById("fz-step-badge");
    const stepTxt = document.getElementById("fz-step-text");
    const totalsEl = document.getElementById("fz-progress-totals");
    const bar = document.getElementById("fz-progress-bar");
    const logsBox = document.getElementById("fz-logs-box");

    if (badge) badge.textContent = `ขั้นตอน ${state.stepIndex || 1}/${state.totalSteps || 4}`;
    if (stepTxt) stepTxt.textContent = state.step || "พร้อมทำงาน";
    if (totalsEl) {
      const s1 = Number(state.stage1TransferredZeny || 0);
      const s2 = Number(state.stage2TransferredZeny || 0);
      totalsEl.textContent = state.mode === "ring_first"
        ? `ในวง: +${s1.toLocaleString()} z · เข้าตัวหลัก: +${s2.toLocaleString()} z`
        : `โอนเข้าตัวหลักแล้ว: +${s2.toLocaleString()} z`;
    }
    if (bar) {
      let pct = 10;
      if (state.status === "completed") pct = 100;
      else if (state.totalSenders > 0 && state.phase !== "stage1") {
        pct = Math.min(96, 35 + Math.round(((state.completedSenders?.length || 0) / state.totalSenders) * 60));
      } else {
        pct = Math.min(95, Math.round(((state.stepIndex || 1) / (state.totalSteps || 4)) * 100));
      }
      bar.style.width = `${pct}%`;
    }
    if (logsBox && Array.isArray(state.logs)) {
      const html = state.logs.map(l => {
        const cls = l.level === "error" ? "error" : (l.level === "warning" ? "warning" : (l.level === "success" ? "success" : "info"));
        return `<div class="zeny-log-entry ${cls}"><span class="log-time">${esc(l.time || "--:--:--")}</span> ${esc(l.text || "")}</div>`;
      }).join("");
      if (logsBox.dataset.lastHtml !== html) {
        const wasAtBottom = (logsBox.scrollHeight - logsBox.scrollTop - logsBox.clientHeight) < 40;
        logsBox.innerHTML = html;
        logsBox.dataset.lastHtml = html;
        if (wasAtBottom) logsBox.scrollTop = logsBox.scrollHeight;
      }
    }
  }

  function renderAll(opts = {}) {
    const forceRender = Boolean(opts && opts.force);
    ensureShellMounted();
    if (!overview) {
      const cont = document.getElementById("fz-machines-container");
      if (cont && lastError) {
        cont.innerHTML = `<div class="fleet-empty-box">⚠️ ${esc(lastError)}</div>`;
      }
      return;
    }

    const stats = recomputeClientViewStats(overview);
    const { cfg, computedMachines, estZeny, estCount, ringCountStage1, qualifyingMachinesCount } = stats;

    // KPI Cards
    const sum = overview.summary || {};
    const kpiM = document.getElementById("fz-kpi-machines");
    const kpiR = document.getElementById("fz-kpi-rings");
    const kpiT = document.getElementById("fz-kpi-total-zeny");
    const kpiE = document.getElementById("fz-kpi-transfer-zeny");
    if (kpiM) kpiM.textContent = `${sum.onlineMachines || 0} / ${sum.totalMachines || 0} เครื่อง`;
    if (kpiR) kpiR.textContent = `${sum.totalIpRings || 0} วง IP`;
    if (kpiT) kpiT.textContent = `${Number(sum.totalOnlineZeny || 0).toLocaleString()} z`;
    if (kpiE) kpiE.textContent = `${estZeny.toLocaleString()} z`;

    // Inputs sync (when not focused)
    const keepInp = document.getElementById("fz-keep-input");
    if (keepInp && document.activeElement !== keepInp) {
      keepInp.value = Number(cfg.keepZeny || 0).toLocaleString();
    }
    const roundCb = document.getElementById("fz-cb-round-100k");
    if (roundCb) roundCb.checked = Boolean(cfg.roundHundredK);

    const ringFirst = cfg.ringFirst !== false;
    const ringFirstCb = document.getElementById("fz-cb-ring-first");
    if (ringFirstCb) ringFirstCb.checked = ringFirst;

    const threshPanel = document.getElementById("fz-threshold-panel");
    if (threshPanel) threshPanel.style.display = ringFirst ? "none" : "flex";

    const minInp = document.getElementById("fz-min-zeny-input");
    if (minInp && document.activeElement !== minInp) {
      minInp.value = Number(cfg.minZenyThreshold || 0).toLocaleString();
    }

    const modeDesc = document.getElementById("fz-mode-desc");
    if (modeDesc) {
      modeDesc.textContent = ringFirst
        ? "ขั้นที่ 1: แต่ละเครื่องเทรดรวมเงินกันเฉพาะในวง Proxy ของตัวเองก่อน · ขั้นที่ 2: ตัวรับเงินประจำแต่ละวงจากทุกเครื่องนำมารวมเข้าตัวหลักที่เลือก"
        : "ปิดอยู่ — สามารถพิมพ์เลือกยอดเงินขั้นต่ำด้านล่างเพื่อดึงตรงจากทุกจอทุกเครื่องเข้าตัวหลักได้ทันที";
    }

    const threshSummary = document.getElementById("fz-threshold-summary");
    if (threshSummary) {
      threshSummary.innerHTML = estCount > 0
        ? `⚡ พบ <b>${estCount} จอ</b> (จาก <b>${qualifyingMachinesCount} เครื่อง</b>) ที่มีเงิน &gt; ${Number(cfg.minZenyThreshold || 0).toLocaleString()} z → พร้อมโอนตรง <b>${estZeny.toLocaleString()} z</b>`
        : `⚠️ ยังไม่มีตัวละครที่มีเงินมากกว่า ${Number(cfg.minZenyThreshold || 0).toLocaleString()} z ในทุกเครื่อง`;
    }

    renderMasterSelect(overview, cfg);

    const actionSum = document.getElementById("fz-action-summary");
    if (actionSum) {
      actionSum.innerHTML = ringFirst
        ? `🛡️ โหมดวงแลนก่อน → ตัวหลัก: ขั้น 1 รวม <b>${ringCountStage1} วง</b> → ขั้น 2 รวมเข้าตัวหลักทั้งหมด <b>~${estZeny.toLocaleString()} z</b>`
        : `⚡ โหมดดึงตรง &gt; <b>${Number(cfg.minZenyThreshold || 0).toLocaleString()} z</b>: ดึง <b>${estCount} จอ</b> จาก ${qualifyingMachinesCount} เครื่อง → เข้าตัวหลัก <b>~${estZeny.toLocaleString()} z</b>`;
    }

    const btnStart = document.getElementById("fz-btn-start");
    if (btnStart && !overview.state?.running) {
      btnStart.disabled = !cfg.masterReceiverKey || estZeny <= 0;
    }

    renderProgress(overview.state);

    // Render per-machine cards (IP rings ONLY, no bottom character table!)
    const container = document.getElementById("fz-machines-container");
    if (!container) return;
    if (!forceRender && window.PmUiGuard && window.PmUiGuard.isInteracting(container)) return;

    if (computedMachines.length === 0) {
      container.innerHTML = `<div class="fleet-empty-box">🖥️ ยังไม่พบเครื่องในบัญชีเดียวกัน กรุณาล็อกอินบัญชีผู้ใช้และรีเฟรช</div>`;
      return;
    }

    container.innerHTML = computedMachines.map(m => {
      const mIcon = m.isCurrentMachine ? "⭐" : (m.isOnline ? "🛰️" : "⚫");
      const mBadge = m.isCurrentMachine
        ? `<span class="fz-machine-pill is-current">เครื่องนี้</span>`
        : (m.isOnline
          ? (m.actorReady
            ? `<span class="fz-machine-pill is-online">🟢 พร้อมโอนข้ามเครื่อง</span>`
            : `<span class="fz-machine-pill is-warn">⏳ รออัปเดตเวอร์ชันเพื่อโอนข้ามเครื่อง</span>`)
          : `<span class="fz-machine-pill is-offline">⚪ ออฟไลน์</span>`);

      let bodyHtml = "";
      if (!m.isOnline) {
        bodyHtml = `<div class="fz-machine-offline-msg">⏸️ เครื่องนี้กำลังออฟไลน์อยู่ (${esc(m.error || "ยังไม่ได้เปิด Manager")})</div>`;
      } else if (m.error && m.uiRings.length === 0) {
        bodyHtml = `<div class="fz-machine-offline-msg">⚠️ ${esc(m.error)}</div>`;
      } else if (m.uiRings.length === 0) {
        bodyHtml = `<div class="fz-machine-offline-msg">ยังไม่มีโปรไฟล์ในเครื่องนี้</div>`;
      } else {
        bodyHtml = `<div class="fz-rings-grid">${m.uiRings.map(g => {
          const ipLabel = g.ip === "LOCAL" ? "LOCAL (เน็ตบ้าน)" : g.ip;
          const isRunningRing = Boolean(g.activeTask);
          const cardCls = [
            "fz-ring-card",
            g.isMasterRing ? "is-master-ring" : "",
            isRunningRing ? "is-running" : ""
          ].filter(Boolean).join(" ");

          const metricLabel = ringFirst
            ? (g.isMasterRing
              ? `รวมในวงเข้าตัวหลัก (${g.uiIntraSendersCount} จอ):`
              : `ยอดส่งต่อเข้าตัวหลัก (จาก ${g.uiIntraSendersCount} จอในวง):`)
            : `มากกว่า ${Number(cfg.minZenyThreshold || 0).toLocaleString()} z (${g.uiThresholdCount} จอ):`;
          const metricVal = ringFirst ? g.uiStage2AmountForRing : g.uiThresholdSum;

          const cands = g.receiverCandidates || [];
          const recOptsHtml = cands.length > 0
            ? cands.map(c => {
                const selected = g.uiReceiver && c.id === g.uiReceiver.id ? " selected" : "";
                const dot = c.isRunning ? "🟢" : "⚪";
                return `<option value="${esc(c.id)}"${selected}>${dot} 👑 ${esc(c.name)} [${esc(c.charName)}] (${Number(c.zeny || 0).toLocaleString()} z)</option>`;
              }).join("")
            : `<option value="">🔒 ไม่มีตัวละครที่มี Premium ในวงนี้</option>`;

          const runningPill = isRunningRing
            ? `<span class="fz-ring-running-pill">🔄 กำลังรวม (${Number(g.activeTask.stepIndex || 1)}/5)</span>`
            : (g.isMasterRing ? `<span class="fz-ring-master-pill" title="ตัวหลักรับเงินปลายทางอยู่ในวงนี้ — ขั้น 1 รวมเข้าตัวหลักโดยตรง">👑 วงตัวหลัก</span>` : "");

          return `
            <div class="${cardCls}">
              <div class="fz-ring-top">
                <div class="fz-ring-ip-wrap">
                  <span class="fz-ring-ip-chip">🛡️ ${esc(ipLabel)}</span>
                  ${runningPill}
                </div>
                <span class="fz-ring-counts">🟢 <b>${g.onlineCount}</b>/${g.totalCount} จอ · 👑 <b>${g.onlineVipCount}</b> VIP</span>
              </div>

              <div class="fz-ring-amount-row">
                <span class="fz-ring-amount-lbl">${metricLabel}</span>
                <b class="fz-ring-amount-val ${metricVal > 0 ? "has-val" : ""}">${Number(metricVal || 0).toLocaleString()} z</b>
              </div>

              <div class="fz-ring-rec-row">
                <label class="fz-ring-rec-lbl">${g.isMasterRing ? "👑 ตัวรับเงินประจำวง IP นี้ (ตัวหลักอยู่ในวงนี้):" : "👑 ตัวรับเงินประจำวง IP นี้:"}</label>
                <select class="zeny-select fz-ring-receiver-select" data-ring-key="${esc(g.ringKey)}" ${(cands.length === 0 || isRunningRing || g.isMasterRing) ? "disabled" : ""}>${recOptsHtml}</select>
              </div>

              <div class="fz-ring-actions">
                <button type="button" class="btn btn-sm fz-ring-run-btn" data-fz-run-ring-machine="${esc(m.machineKey)}" data-fz-run-ring-ip="${esc(g.ip)}" ${(!g.uiCanRunRing || isRunningRing || overview.state?.running) ? "disabled" : ""}>
                  ${isRunningRing ? "⏳ กำลังรวมวงนี้..." : `🚀 รวมเฉพาะวงนี้ (${g.uiRingTransferSum.toLocaleString()} z)`}
                </button>
              </div>
            </div>
          `;
        }).join("")}</div>`;
      }

      return `
        <section class="fz-machine-section ${m.isOnline ? "is-online" : "is-offline"}">
          <div class="fz-machine-header">
            <div class="fz-machine-title-wrap">
              <span class="fz-machine-name">${mIcon} เครื่อง ${m.machineIndex}: ${esc(m.deviceName)}</span>
              ${m.hwidCode ? `<code class="fleet-hwid-chip">${esc(m.hwidCode)}</code>` : ""}
              ${mBadge}
            </div>
            <div class="fz-machine-stats">
              <span class="fz-machine-stat-chip">🌐 <b>${m.ipGroupsCount || 0}</b> วง IP</span>
              <span class="fz-machine-stat-chip">🟢 <b>${m.onlineCount || 0}</b>/${m.totalProfiles || 0} จอ</span>
              <span class="fz-machine-stat-chip gold">💰 <b>${Number(m.onlineZeny || 0).toLocaleString()} z</b></span>
            </div>
          </div>
          ${bodyHtml}
        </section>
      `;
    }).join("");
  }

  async function runSingleRing(machineKey, ip, btn) {
    if (!machineKey || !ip) return;
    const cfg = ensureDraftConfig();
    if (!confirm(`ยืนยันสั่งรวมเงินเฉพาะภายในวง IP [${ip}] บนเครื่องนี้?\n\n(เทรดเฉพาะตัวละครในวง Proxy เดียวกันเท่านั้น)`)) {
      return;
    }
    if (btn) btn.disabled = true;
    try {
      const res = await fetch("/api/fleet-zeny/run-ring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machineKey,
          ip,
          keepZeny: cfg.keepZeny,
          roundHundredK: cfg.roundHundredK,
          ringReceivers: cfg.ringReceivers
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "สั่งรวมเงินเฉพาะวงไม่สำเร็จ");
      notifyToast(data.message || `เริ่มรวมเงินเฉพาะวง [${ip}] แล้ว`, "success");
      await fetchOverview(true);
    } catch (e) {
      alert(e.message || "สั่งรวมเงินเฉพาะวงไม่สำเร็จ");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function startFleetConsolidation() {
    if (!overview) return;
    const stats = recomputeClientViewStats(overview);
    const { cfg, estZeny, estCount, ringCountStage1, qualifyingMachinesCount } = stats;
    if (!cfg.masterReceiverKey) {
      alert("กรุณาเลือกตัวหลักรับเงินปลายทางก่อน");
      return;
    }
    const modeMsg = cfg.ringFirst !== false
      ? `🛡️ โหมด: รวมเงินเฉพาะในวงแลน/Proxy ของแต่ละเครื่องก่อน (${ringCountStage1} วง) → แล้วให้ตัวรับแต่ละวงมารวมที่ตัวหลัก\n💰 ยอดประเมินเข้าตัวหลัก: ~${estZeny.toLocaleString()} z`
      : `⚡ โหมด: ดึงตรงทุกจอทุกเครื่องที่มีเงิน > ${Number(cfg.minZenyThreshold || 0).toLocaleString()} z (${estCount} จอ จาก ${qualifyingMachinesCount} เครื่อง)\n💰 ยอดประเมินเข้าตัวหลัก: ~${estZeny.toLocaleString()} z`;

    if (!confirm(`🚀 ยืนยันเริ่มรวมเงินทุกเครื่องเข้าตัวหลัก?\n\n${modeMsg}\n\n(ทุกจอที่เกี่ยวข้องจะหยุดบอทชั่วคราว วาร์ปกลับเมืองหลวงเพื่อเทรด และกลับไปฟาร์มต่อให้อัตโนมัติหลังเทรดเสร็จ)`)) {
      return;
    }

    const btn = document.getElementById("fz-btn-start");
    if (btn) btn.disabled = true;
    try {
      const res = await fetch("/api/fleet-zeny/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg)
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "ไม่สามารถเริ่มรวมเงินทุกเครื่องได้");
      notifyToast(data.message || "🚀 เริ่มรวมเงินทุกเครื่องแล้ว", "success");
      await fetchStatusOnly();
      renderAll();
    } catch (e) {
      alert(e.message || "ไม่สามารถเริ่มรวมเงินทุกเครื่องได้");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function stopFleetConsolidation() {
    if (!confirm("ต้องการสั่งหยุดการรวมเงินทุกเครื่องทันทีหรือไม่?")) return;
    try {
      await fetch("/api/fleet-zeny/stop", { method: "POST" });
      notifyToast("⏹️ ส่งคำสั่งหยุดการรวมเงินทุกเครื่องแล้ว", "warning");
      await fetchStatusOnly();
      renderAll();
    } catch (_) {}
  }

  async function fetchStatusOnly() {
    try {
      const res = await fetch("/api/fleet-zeny/status");
      const data = await res.json();
      if (res.ok && data.success && overview) {
        overview.state = data;
        renderProgress(overview.state);
      }
    } catch (_) {}
  }

  async function fetchOverview(force = false) {
    if (loading && !force) return;
    if (!force && window.PmUiGuard && typeof window.PmUiGuard.isInteractionBusy === "function" && window.PmUiGuard.isInteractionBusy()) {
      return;
    }
    loading = true;
    const btn = document.getElementById("fz-btn-refresh");
    if (btn) btn.disabled = true;
    try {
      const res = await fetch("/api/fleet-zeny/overview");
      const data = await res.json();
      if (!res.ok || !data.success) {
        lastError = data.error || "ไม่สามารถโหลดข้อมูลได้";
      } else {
        lastError = null;
        overview = data;
        // Hydrate draftConfig on first load or sync server default master if empty
        if (!draftConfig) {
          draftConfig = {
            masterReceiverKey: data.config?.masterReceiverKey || "",
            ringFirst: data.config?.ringFirst !== false,
            minZenyThreshold: Number(data.config?.minZenyThreshold ?? 1000000),
            keepZeny: Number(data.config?.keepZeny || 0),
            roundHundredK: Boolean(data.config?.roundHundredK),
            ringReceivers: { ...(data.config?.ringReceivers || {}) }
          };
        } else if (!draftConfig.masterReceiverKey && data.config?.masterReceiverKey) {
          draftConfig.masterReceiverKey = data.config.masterReceiverKey;
        }
        lastFetchAt = Date.now();
      }
    } catch (e) {
      lastError = e?.message || "เกิดข้อผิดพลาดในการเชื่อมต่อ";
    } finally {
      loading = false;
      if (btn) btn.disabled = false;
      renderAll();
    }
  }

  function startPollLoop() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (!isPaneActive()) return;
      if (overview?.state?.running) {
        fetchStatusOnly();
        if (Date.now() - lastFetchAt >= 8000) fetchOverview(false);
      } else if (Date.now() - lastFetchAt >= 6000) {
        fetchOverview(false);
      }
    }, 1500);
  }

  function onTabShown() {
    ensureShellMounted();
    fetchOverview(true);
    startPollLoop();
  }

  window.FleetZeny = {
    onTabShown,
    refresh: () => fetchOverview(true)
  };
})();
