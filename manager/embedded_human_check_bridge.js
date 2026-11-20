'use strict';
// Local answers never require a wallet request. ACK statistics only after durable storage.

function normalizeCaptchaPolicy(preferences = {}) {
  return {
    autoAnswer: preferences.autoAnswer !== false,
    answerDelayMs: Math.max(800, Math.min(10000, Number(preferences.answerDelayMs) || 1800)),
    skipWhenAutoInFarmMap: Boolean(preferences.skipWhenAutoInFarmMap),
    skipWhenBotStopped: Boolean(preferences.skipWhenBotStopped),
    skipWhenInTown: Boolean(preferences.skipWhenInTown)
  };
}

function evaluateServerSideAutoAnswerPolicy(preferences, state) {
  const pol = normalizeCaptchaPolicy(preferences);
  if (pol.autoAnswer === false) {
    return { allowed: false, reason: 'ไม่ได้เปิด Auto ตอบคำถาม' };
  }
  const mapStr = String((state && state.map) || '').trim();
  const inGame = !state || !state.screenPhase || state.screenPhase === 'in_game';
  const isUnknown = !mapStr || mapStr === '--' || /ไม่ทราบแมพ|unknown|loading|กำลังโหลด/i.test(mapStr);
  const isTown = /เมืองหลวง|โซลเฮเวน|ตลาดคาราวาน|\bsolhaven\b|\btown\b/i.test(mapStr);
  const isJail = !/คุกใต้ดิน/i.test(mapStr) && /คุก|เรือนจำ|\bprison\b|\bjail\b/i.test(mapStr);
  const isTower = /หอคอย|endless\s*tower/i.test(mapStr);
  const isFarmMap = Boolean(state && inGame && !isUnknown && !isTown && !isJail && !isTower);
  const isAuto = Boolean(state && state.isBotRunning);

  if (pol.skipWhenAutoInFarmMap && isAuto && isFarmMap) {
    return { allowed: false, reason: 'งดตอบอัตโนมัติ (บอท Auto อยู่ในแมพฟาร์ม)' };
  }
  if (pol.skipWhenBotStopped && state && !isAuto) {
    return { allowed: false, reason: 'งดตอบอัตโนมัติ (บอทไม่ได้กด START)' };
  }
  if (pol.skipWhenInTown && state && isTown) {
    return { allowed: false, reason: 'งดตอบอัตโนมัติ (อยู่ในเมือง)' };
  }
  return { allowed: true, reason: null };
}

function buildClientCaptchaPolicyInstallSnippet(preferences) {
  const pol = normalizeCaptchaPolicy(preferences);
  const solverCfg = { autoAnswer: pol.autoAnswer, answerDelayMs: pol.answerDelayMs };
  return `(() => {
    const pol = ${JSON.stringify(pol)};
    window.__pmCaptchaPolicy = pol;
    window.__pmHumanCheckSolverConfig = ${JSON.stringify(solverCfg)};
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('pelican_captcha_policy_v1', JSON.stringify(pol));
        localStorage.setItem('pelican_embedded_human_check_cfg', JSON.stringify(window.__pmHumanCheckSolverConfig));
        localStorage.setItem('pelican_auto_human_check', String(pol.autoAnswer));
      }
    } catch (_) {}
    window.__pmEvaluateCaptchaPolicy = function () {
      const p = window.__pmCaptchaPolicy || pol;
      if (p.autoAnswer === false) {
        window.__pmHumanCheckPauseReason = 'ปิด Auto ตอบคำถามไว้';
        return false;
      }
      const hasDoc = typeof document !== 'undefined';
      const isAuto = Boolean(
        window.__isBotRunning ||
        (hasDoc && document.querySelector('.btn-auto.active, .hud-auto.active, button.active[title*="Auto"]'))
      );
      let curMap = '';
      try {
        if (typeof window.__getClientLiveState === 'function') {
          curMap = String(window.__getClientLiveState()?.map || '').trim();
        }
      } catch (_) {}
      if (!curMap && hasDoc) {
        try {
          const mapEl = document.querySelector('.minimap-name, .minimap-title, [class*="map-name"]');
          if (mapEl) curMap = String(mapEl.textContent || mapEl.innerText || '').trim();
        } catch (_) {}
      }
      if (!curMap) {
        try {
          const rState = window.__gameRoom?.state || (typeof window.getColyseusRoom === 'function' ? window.getColyseusRoom()?.state : null);
          curMap = String(rState?.displayName || rState?.mapName || '').trim();
        } catch (_) {}
      }
      const hasHud = hasDoc ? Boolean(document.querySelector('.hud, .hud-status, .hud-name')) : true;
      const isUnknownMap = !curMap || curMap === '--' || /ไม่ทราบแมพ|unknown|loading|กำลังโหลด/i.test(curMap);
      const isTown = /เมืองหลวง|โซลเฮเวน|ตลาดคาราวาน|\\bsolhaven\\b|\\btown\\b/i.test(curMap);
      const isJail = !/คุกใต้ดิน/i.test(curMap) && /คุก|เรือนจำ|\\bprison\\b|\\bjail\\b/i.test(curMap);
      const isTower = /หอคอย|endless\\s*tower/i.test(curMap);
      const isFarmMap = hasHud && !isUnknownMap && !isTown && !isJail && !isTower;

      if (p.skipWhenAutoInFarmMap && isAuto && isFarmMap) {
        window.__pmHumanCheckPauseReason = 'งดตอบอัตโนมัติ (บอท Auto อยู่ในแมพฟาร์ม)';
        return false;
      }
      if (p.skipWhenBotStopped && !isAuto) {
        window.__pmHumanCheckPauseReason = 'งดตอบอัตโนมัติ (บอทไม่ได้กด START)';
        return false;
      }
      if (p.skipWhenInTown && isTown) {
        window.__pmHumanCheckPauseReason = 'งดตอบอัตโนมัติ (อยู่ในเมือง)';
        return false;
      }
      window.__pmHumanCheckPauseReason = null;
      return true;
    };
    try {
      Object.defineProperty(window, '__autoHumanCheckEnabled', {
        configurable: true,
        enumerable: true,
        get() { return window.__pmEvaluateCaptchaPolicy(); },
        set(v) {
          if (!window.__pmCaptchaPolicy) window.__pmCaptchaPolicy = { ...pol };
          window.__pmCaptchaPolicy.autoAnswer = Boolean(v);
        }
      });
      window.__pmCaptchaPolicyInstalled = true;
    } catch (_) {}
    return window.__pmEvaluateCaptchaPolicy();
  })()`;
}

function createEmbeddedHumanCheckBridge({ evalProfilePort, recordCaptchaSolved, getConfig }) {
  const busy = new Set();
  async function collect(profile, state) {
    if (!profile?.debugPort || busy.has(profile.id)) return false;
    busy.add(profile.id);
    try {
      const preferences = getConfig?.() || {};
      const installExpr = buildClientCaptchaPolicyInstallSnippet(preferences);
      const response = await evalProfilePort(profile.debugPort, `(() => {
        ${installExpr};
        if(!window.__pmEmbeddedHumanCheckSolver)return {enabled:false,events:[]};
        let events=[];try{events=typeof window.__pmGetHumanCheckEvents==='function'?window.__pmGetHumanCheckEvents():(window.__pmLocalHumanCheckEvents||[]);}catch(_){}
        return {enabled:true,events:Array.isArray(events)?events.slice(0,100):[]};
      })()`, 3000);
      if (!response?.success || response.result?.enabled !== true) return false;
      if (state?.humanCheck) state.humanCheck.embeddedSolver = true;
      const acknowledged = [];
      for (const event of response.result.events || []) {
        if (!event || typeof event.eventId !== 'string' || !event.eventId || event.eventId.length > 128 || !Number.isSafeInteger(event.timestamp) || event.timestamp < 1) continue;
        if (recordCaptchaSolved(profile.id, event)) acknowledged.push(event.eventId);
      }
      if (acknowledged.length) {
        await evalProfilePort(profile.debugPort, `(() => {const ids=${JSON.stringify(acknowledged)};return typeof window.__pmAckHumanCheckEvents==='function'?window.__pmAckHumanCheckEvents(ids):window.__pmAckLocalHumanCheckEvents?.(ids);})()`, 3000);
      }
      return true;
    } catch (_) {
      return false;
    } finally {
      busy.delete(profile.id);
    }
  }
  return { collect };
}

module.exports = {
  createEmbeddedHumanCheckBridge,
  normalizeCaptchaPolicy,
  buildClientCaptchaPolicyInstallSnippet,
  evaluateServerSideAutoAnswerPolicy
};
