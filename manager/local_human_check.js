'use strict';
// PmheeAether local answers never depend on wallet balance or billing availability.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
function validateCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.items) || !catalog.items.length || catalog.items.length > 100000) throw new Error('INVALID_CATALOG');
  const names = new Map();
  for (const item of catalog.items) {
    if (!Number.isSafeInteger(item.id) || item.id < 1 || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 512 || names.has(item.id)) throw new Error('INVALID_CATALOG');
    names.set(item.id, item.name.trim());
  }
  const icons = new Map();
  const clean = value => typeof value === 'string' ? value.replace(/^https?:\/\/[^/]+/, '').replace(/^\/?art\/icons\//, '').replace(/^\//, '').split('?')[0] : '';
  for (const [id, value] of Object.entries(catalog.manifest?.items || catalog.manifest || {})) {
    const name = names.get(Number(id)), key = clean(value);
    if (name && key) { if (!icons.has(key)) icons.set(key, new Set()); icons.get(key).add(name); }
  }
  return ({ prompt, options = [], items = [] }) => {
    if (typeof prompt !== 'string' || !Array.isArray(options) || !Array.isArray(items) || Math.max(options.length, items.length) > 6) return null;
    const target = prompt.trim().toLowerCase().replace(/^(?:กรุณา)?\s*(?:คลิก|กด|เลือก)\s*(?:ที่)?\s*(?:รูปภาพ|รูป|ภาพ)?\s*(?:ของ)?\s*/i, '')
      .replace(/^(?:please\s+)?(?:press|click|select|choose)\s+(?:the\s+)?(?:picture|image|icon)\s+(?:of\s+)?/i, '')
      .replace(/\s*(?:ภายในเวลา|ด่วน|ก่อนหมดเวลา).*$/i, '').trim();
    const matches = new Map();
    for (let i = 0; i < Math.max(options.length, items.length); i++) {
      const option = options[i] || { index: i }, index = option.index ?? i;
      if (!Number.isInteger(index) || index < 0 || index >= Math.max(options.length, items.length)) return null;
      const candidates = new Set(icons.get(clean(option.icon)) || []), name = names.get(Number(option.itemId ?? items[i]));
      if (name) candidates.add(name);
      // Exact catalog name avoids partial-name collisions such as Red Potion / Potion.
      for (const candidate of candidates) if (candidate.toLowerCase() === target) matches.set(index, candidate);
    }
    if (matches.size !== 1) return null;
    const [pickIndex, matchedName] = [...matches][0];
    return { success: true, pickIndex, matchedName, confidence: 100, charged: 0, source: 'local-catalog' };
  };
}
function createLocalHumanCheck({ dataDir, seed = true }) {
  const file = path.join(dataDir, 'human_check_catalog_v1.json');
  let matcher = null;
  try { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); if (saved.hash === crypto.createHash('sha256').update(JSON.stringify(saved.catalog)).digest('hex')) matcher = validateCatalog(saved.catalog); } catch (_) {}
  if (!matcher && seed) {
    // Public game wiki/icons snapshot, 1160 items. This is not a credential or a private payload.
    const source=fs.readFileSync(path.join(__dirname,'human_check_catalog_seed.json'),'utf8');
    if(crypto.createHash('sha256').update(source).digest('hex')!=='259877fc0b3441525c0dbf777575057568fba6afd9f2bec87ce9f5c3a38a0423') throw new Error('CATALOG_SEED_HASH_MISMATCH');
    matcher=validateCatalog(JSON.parse(source));
  }
  return {
    ready: () => !!matcher,
    solve: payload => matcher ? matcher(payload) : null,
    update(catalog, expectedHash) {
      const candidate = validateCatalog(catalog), hash = crypto.createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
      if (hash !== expectedHash) throw new Error('CATALOG_HASH_MISMATCH');
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify({ catalog, hash, updatedAt: Date.now() }), { mode: 0o600 });
      fs.renameSync(file + '.tmp', file); matcher = candidate;
    }
  };
}
module.exports = { createLocalHumanCheck, validateCatalog };
