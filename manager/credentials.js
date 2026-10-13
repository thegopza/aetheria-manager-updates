// manager/credentials.js — game passwords per profile, kept OUT of profiles.json.
// profiles.json is tracked in the (public) git repo; this file (data/credentials.json) is git-ignored and
// never touched by the Manager self-update or shipped in the release zip.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'credentials.json');

function loadAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) { return {}; }
}
function saveAll(all) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2), 'utf8');
}

const getPassword = id => (loadAll()[id] || {}).password || '';
function setPassword(id, password) {
  const all = loadAll();
  if (password) all[id] = { password, updatedAt: Date.now() };
  else delete all[id];
  saveAll(all);
}

module.exports = { getPassword, setPassword };
