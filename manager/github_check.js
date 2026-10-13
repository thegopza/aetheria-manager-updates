// manager/github_check.js — cheap "did main move?" checks shared by the bot / Manager auto-updaters.
//
// api.github.com allows only 60 requests per hour per internet IP without a token, and several PCs
// behind one router (or a mobile hotspot) share that budget — friends got "GitHub HTTP 403". So the
// updaters first ask git's own endpoint which commit main is on (not the API, no 60/h budget) and only
// call the API when main really moved. A 403 / 429 from the API pauses API calls until GitHub's reset time.
const https = require('https');

const REPO = 'thegopza/aetheria-pelican-bot';
// Manager distributions are public separately from the private development repository.
const MANAGER_UPDATE_REPO = 'thegopza/aetheria-manager-updates';
const UA = 'PmheeAether-Manager';
const headCache = new Map();
let apiBlockedUntil = 0;

function request(url, { timeout = 15000, accept } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': UA };
    if (accept) headers.Accept = accept;
    https.get(url, { headers, timeout }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

function rateLimitError() {
  const t = new Date(apiBlockedUntil);
  const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  return new Error(`GitHub จำกัดการเช็กชั่วคราว (60 ครั้ง/ชม. ต่อ IP อินเทอร์เน็ต) — จะลองใหม่หลัง ${hhmm}`);
}

// Commit sha of main, from git's smart-HTTP ref list (cached for a minute; both updaters share it)
async function getMainHeadSha(repo = REPO) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repo)) throw new Error('Invalid GitHub repository');
  const cached = headCache.get(repo);
  if (cached && Date.now() - cached.at < 60 * 1000) return cached.sha;
  const r = await request(`https://github.com/${repo}.git/info/refs?service=git-upload-pack`);
  if (r.status !== 200) throw new Error(`GitHub HTTP ${r.status}`);
  const m = r.body.toString('utf8').match(/([0-9a-f]{40}) refs\/heads\/main/);
  if (!m) throw new Error('อ่าน commit ล่าสุดจาก GitHub ไม่ได้');
  headCache.set(repo, { sha: m[1], at: Date.now() });
  return m[1];
}

async function apiGetJSON(url) {
  if (Date.now() < apiBlockedUntil) throw rateLimitError();
  const r = await request(url, { accept: 'application/vnd.github+json' });
  if (r.status === 403 || r.status === 429) {
    const reset = Number(r.headers['x-ratelimit-reset']) * 1000;
    apiBlockedUntil = reset > Date.now() ? reset + 5000 : Date.now() + 15 * 60 * 1000;
    throw rateLimitError();
  }
  if (r.status !== 200) throw new Error(`GitHub HTTP ${r.status}`);
  return JSON.parse(r.body.toString('utf8'));
}

module.exports = { REPO, MANAGER_UPDATE_REPO, getMainHeadSha, apiGetJSON };
