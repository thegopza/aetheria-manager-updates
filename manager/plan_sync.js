// manager/plan_sync.js — deliver Plan Script profiles to game clients.
//
// - assign:   send the plan and switch Plan Script on (the user picked "use this plan")
// - edit:     send the updated plan but keep each client's on/off switch as it is
// - delete:   clear the plan on clients that were using it
// - reconcile (every 30 s): clients that were offline when a plan was assigned/edited get it when
//   they come online. Uses POST /api/eval so large plans never hit URL length limits.

const RECONCILE_MS = 30 * 1000;

function createPlanSync({ loadPlans, savePlans, loadProfiles, evalProfilePort }) {
  const applyCode = (plan, enable) =>
    `(() => {
      if (typeof window.__applyScriptPlan !== 'function') return { success: false, error: 'bot not ready' };
      window.__applyScriptPlan(${JSON.stringify(plan)}${typeof enable === 'boolean' ? `, ${enable}` : ''});
      return { success: true, enabled: !!window.__planScriptEnabled };
    })()`;

  async function push(profile, plan, enable) {
    if (!profile || !profile.debugPort) return false;
    const r = await evalProfilePort(profile.debugPort, applyCode(plan, enable), 5000);
    return Boolean(r && r.success && r.result && r.result.success);
  }

  function assignedProfiles(planId) {
    const data = loadPlans();
    const ids = Object.keys(data.assignments || {}).filter(cId => data.assignments[cId] === planId);
    const profiles = loadProfiles();
    return ids.map(id => profiles.find(p => p.id === id)).filter(Boolean);
  }

  async function pushToAssigned(plan) {
    const targets = assignedProfiles(plan.id);
    const results = await Promise.all(targets.map(p => push(p, plan)));
    return results.filter(Boolean).length;
  }

  async function clearClients(profiles) {
    await Promise.all(profiles.map(p => push(p, null, false)));
  }

  // Bring online clients in line with their assignment (plan id + updatedAt)
  async function reconcile() {
    const data = loadPlans();
    const assignments = data.assignments || {};
    const profiles = loadProfiles().filter(p => p.debugPort && assignments[p.id]);
    for (const p of profiles) {
      const plan = (data.profiles || []).find(x => x.id === assignments[p.id]);
      if (!plan) continue;
      const r = await evalProfilePort(p.debugPort, `(() => { const c = window.__currentScriptPlan; return typeof window.__applyScriptPlan === 'function' ? { id: c ? c.id : null, u: c ? c.updatedAt || null : null } : null; })()`, 3000);
      const cur = r && r.success ? r.result : null;
      if (!cur) continue;   // offline or bot not loaded yet
      const enablePending = Boolean(data.pendingEnable && data.pendingEnable[p.id]);
      if (cur.id !== plan.id || (cur.u || null) !== (plan.updatedAt || null) || enablePending) {
        // Assigned while this client was offline -> switch Plan Script on now that it got the plan
        const ok = await push(p, plan, enablePending ? true : undefined);
        if (ok && enablePending) {
          const fresh = loadPlans();
          if (fresh.pendingEnable) { delete fresh.pendingEnable[p.id]; savePlans(fresh); }
        }
      }
    }
  }

  function start() {
    setTimeout(() => { reconcile().catch(() => {}); setInterval(() => reconcile().catch(() => {}), RECONCILE_MS); }, 15000);
  }

  // Live Plan Script status of one client: switch, loaded plan and trigger progress (bot >= 4.5.0)
  const STATE_JS = `(() => {
    const plan = window.__currentScriptPlan;
    const name = (typeof window.getCharacterName === 'function') ? window.getCharacterName() : '';
    let st = null;
    if (plan) { try { st = JSON.parse(localStorage.getItem('pelican_plan_state_' + name + '_' + (plan.id || plan.name || 'plan')) || 'null'); } catch (e) {} }
    return {
      ready: typeof window.__applyScriptPlan === 'function',
      enabled: !!window.__planScriptEnabled,
      botRunning: !!window.__isBotRunning,
      planId: plan ? plan.id || null : null,
      planName: plan ? plan.name || null : null,
      done: st ? Object.keys(st.done || {}) : [],
      pending: st ? Object.keys(st.pending || {}).map(id => ({ id, level: st.pending[id].level, type: st.pending[id].type, cls: st.pending[id].cls || '' })) : []
    };
  })()`;
  const enableJs = en => `(() => {
    window.__planScriptEnabled = ${en};
    try { localStorage.setItem('pelican_plan_script_enabled', '${en}'); } catch (e) {}
    const cb = document.getElementById('p-plan-script-enabled');
    if (cb) cb.checked = ${en};
    return { success: true, enabled: !!window.__planScriptEnabled };
  })()`;

  async function handleRoute(req, res, pathname, sendJSON) {
    const m = pathname.match(/^\/api\/profiles\/([^/]+)\/(plan-state|plan-enabled)$/);
    if (!m) return false;
    const profile = loadProfiles().find(p => p.id === m[1]);
    if (!profile || !profile.debugPort) { sendJSON({ success: false, error: 'จอนี้ออฟไลน์อยู่' }); return true; }
    if (m[2] === 'plan-state' && req.method === 'GET') {
      const r = await evalProfilePort(profile.debugPort, STATE_JS, 3000);
      sendJSON(r && r.success && r.result ? { success: true, ...r.result } : { success: false, error: 'จอนี้ออฟไลน์หรือบอทยังไม่พร้อม' });
      return true;
    }
    if (m[2] === 'plan-enabled' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      await new Promise(r => req.on('end', r));
      let en = false;
      try { en = JSON.parse(body || '{}').enabled === true; } catch (e) {}
      const r = await evalProfilePort(profile.debugPort, enableJs(en), 3000);
      sendJSON(r && r.success && r.result ? r.result : { success: false, error: 'สั่งงานจอนี้ไม่สำเร็จ' });
      return true;
    }
    return false;
  }

  return { push, pushToAssigned, assignedProfiles, clearClients, start, handleRoute };
}

module.exports = { createPlanSync };
