// manager/config_copy_api.js — copy one client's bot settings to other clients.
//
//   POST /api/profiles/:id/copy-config   { targets: [profileId, ...] }
//
// Reads the live config from the source client (window.exportAllBotSettings), removes everything
// tied to the account (username/password are never exported; the character name is removed here
// so other accounts don't try to pick the source's character), then imports it into each target.

// Persist with the keys bot.js actually loads from — older bot builds saved two of them under the
// wrong names, which made copied market settings disappear after the next page reload.
const IMPORT_JS = config => `(() => {
  if (typeof window.importAllBotSettings !== 'function') return { success: false, error: 'บอทในจอนี้ยังไม่พร้อม (importAllBotSettings ไม่มี)' };
  const before = window.__authConfig ? { username: window.__authConfig.username, password: window.__authConfig.password, charName: window.__authConfig.charName } : null;
  const r = window.importAllBotSettings(${JSON.stringify(config)});
  if (before && window.__authConfig) {
    window.__authConfig.username = before.username;
    window.__authConfig.password = before.password;
    window.__authConfig.charName = before.charName;
    try { localStorage.setItem('pelican_auth_cfg', JSON.stringify(window.__authConfig)); } catch (e) {}
  }
  try {
    if (window.__autoMarketSellConfig) localStorage.setItem('pelican_auto_market_sell_cfg', JSON.stringify(window.__autoMarketSellConfig));
    if (window.__marketFilterConfig) localStorage.setItem('pelican_market_filter_cfg', JSON.stringify(window.__marketFilterConfig));
  } catch (e) {}
  return r || { success: true };
})()`;

function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { resolve(null); } });
  });
}

async function handleConfigCopyRoute(req, res, pathname, ctx) {
  const m = pathname.match(/^\/api\/profiles\/([^/]+)\/copy-config$/);
  if (!m || req.method !== 'POST') return false;
  const { loadProfiles, saveProfiles, evalProfilePort, sendJSON } = ctx;

  const payload = await readBody(req);
  if (!payload || !Array.isArray(payload.targets)) {
    sendJSON({ success: false, error: 'ต้องระบุจอปลายทาง (targets)' }, 400);
    return true;
  }
  const profiles = loadProfiles();
  const source = profiles.find(p => p.id === m[1]);
  if (!source || !source.debugPort) {
    sendJSON({ success: false, error: 'จอต้นทางออฟไลน์อยู่' }, 400);
    return true;
  }

  const exp = await evalProfilePort(source.debugPort, "(typeof window.exportAllBotSettings === 'function') ? window.exportAllBotSettings() : null", 5000);
  const config = exp && exp.result && exp.result.data;
  if (!config) {
    sendJSON({ success: false, error: 'อ่านการตั้งค่าจากจอต้นทางไม่สำเร็จ (บอทอาจยังโหลดไม่เสร็จ)' }, 502);
    return true;
  }
  // Account-specific: never copy
  if (config.authConfig) {
    delete config.authConfig.username;
    delete config.authConfig.password;
    delete config.authConfig.charName;
  }

  const results = [];
  for (const id of payload.targets) {
    const target = profiles.find(p => p.id === id);
    if (!target || id === source.id) continue;
    if (!target.debugPort) { results.push({ id, name: target.name, success: false, error: 'ไม่มีพอร์ต' }); continue; }
    const r = await evalProfilePort(target.debugPort, IMPORT_JS(config), 6000);
    const ok = Boolean(r && r.success && r.result && r.result.success !== false);
    results.push({ id, name: target.name, success: ok, error: ok ? null : (r && r.result && r.result.error) || (r && r.error) || 'จอนี้ออฟไลน์หรือไม่ตอบสนอง' });
    if (ok) {
      // Keep the Manager's own record in step (card map label, whitelist fallback)
      if (config.targetMap) target.targetMap = config.targetMap;
      if (config.sellConfig && typeof config.sellConfig.whitelist === 'string') {
        target.whitelist = config.sellConfig.whitelist;
        target.sellConfig = Object.assign({}, target.sellConfig || {}, { whitelist: config.sellConfig.whitelist });
      }
    }
  }
  if (results.some(r => r.success)) saveProfiles(profiles);

  const okCount = results.filter(r => r.success).length;
  sendJSON({ success: okCount > 0, copied: okCount, total: results.length, results, source: source.name });
  return true;
}

module.exports = { handleConfigCopyRoute };
