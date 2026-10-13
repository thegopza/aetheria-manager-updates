'use strict';
// Captcha solve statistics (data/captcha_stats.json), extracted from server.js so tests exercise the real code.
// Fixes the dedupe bug the old copied test hid: getCaptchaStats() returned a view without embeddedEventIds, so
// every record started with an empty dedupe map and a re-sent embedded event was counted again.
const fs = require('fs');
const path = require('path');

const EVENT_ID_LIMIT = 5000;               // newest IDs kept for dedupe
const EVENT_ID_TTL_MS = 30 * 86400000;     // embedded events older than this cannot be re-sent anyway

function thaiDateKey(timestamp = Date.now()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(Number(timestamp))); }
  catch (_) { return new Date(Number(timestamp) + 7 * 3600 * 1000).toISOString().slice(0, 10); }
}

function createCaptchaStats({ file, bootstrapDaily = () => ({}), now = Date.now, log = console }) {
  const readRaw = () => { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch (_) { return null; } };
  const writeAtomic = data => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2), 'utf8'); fs.renameSync(file + '.tmp', file); };

  // Public view (unchanged shape for the UI): {totalSolved,lastSolvedAt,daily}
  function get() {
    const stats = readRaw();
    if (stats) {
      const totalSolved = Math.max(0, parseInt(stats.totalSolved, 10) || 0);
      let daily = stats.daily;
      if (!daily || typeof daily !== 'object' || Object.keys(daily).length === 0) {
        daily = bootstrapDaily();
        if (Object.keys(daily).length > 0) { stats.daily = daily; try { writeAtomic(stats); } catch (_) {} }
      }
      return { totalSolved, lastSolvedAt: stats.lastSolvedAt || null, daily: daily || {} };
    }
    const bootstrapped = bootstrapDaily();
    const bootstrappedTotal = Object.values(bootstrapped).reduce((sum, d) => sum + (d.total || 0), 0);
    const initial = { totalSolved: Math.max(16, bootstrappedTotal), lastSolvedAt: now(), daily: bootstrapped };
    try { writeAtomic(initial); } catch (_) {}
    return initial;
  }

  function pruneEventIds(map, at) {
    const entries = Object.entries(map).map(([id, ts]) => [id, Number.isSafeInteger(ts) ? ts : at]) // legacy `true` -> now
      .filter(([, ts]) => at - ts <= EVENT_ID_TTL_MS)
      .sort((a, b) => b[1] - a[1]).slice(0, EVENT_ID_LIMIT);
    return Object.fromEntries(entries);
  }

  // Returns the stats (also for an already-counted duplicate, so the caller ACKs it and the client stops resending);
  // null only when the solve could not be stored (caller must not ACK).
  function record(profileId, details = {}) {
    try {
      const at = now();
      const raw = readRaw();
      const stats = raw ? { ...raw } : { ...get() };
      stats.embeddedEventIds = pruneEventIds(raw && raw.embeddedEventIds && typeof raw.embeddedEventIds === 'object' ? raw.embeddedEventIds : {}, at);
      if (details.eventId) {
        if (stats.embeddedEventIds[details.eventId]) return stats;
        stats.embeddedEventIds[details.eventId] = at;
      }
      stats.totalSolved = Math.max(0, parseInt(stats.totalSolved, 10) || 0) + 1;
      stats.lastSolvedAt = Number.isSafeInteger(details.timestamp) && details.timestamp > 0 && details.timestamp <= at + 30000 ? details.timestamp : at;
      if (!stats.daily || typeof stats.daily !== 'object') stats.daily = {};
      const key = thaiDateKey(stats.lastSolvedAt);
      const day = stats.daily[key] ||= { date: key, total: 0, byProfile: {} };
      day.total = (day.total || 0) + 1;
      if (profileId) { day.byProfile ||= {}; day.byProfile[profileId] = (day.byProfile[profileId] || 0) + 1; }
      writeAtomic(stats);
      return stats;
    } catch (e) {
      log.warn('[CaptchaStats] Failed to record solve:', e);
      return null;
    }
  }
  return { get, record };
}

module.exports = { createCaptchaStats, thaiDateKey, EVENT_ID_LIMIT, EVENT_ID_TTL_MS };
