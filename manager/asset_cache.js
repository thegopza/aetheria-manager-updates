'use strict';
// manager/asset_cache.js
// Shared Local Disk Cache for Static Game Assets (.png, .webp, .mp3, .woff2, etc.)
// Intercepts static assets across all 500 screens so they load from local disk/RAM
// instead of consuming upstream proxy bandwidth.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const CACHEABLE_EXTENSIONS = new Set([
  '.png',
  '.webp',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.avif',
  '.ico',
  '.mp3',
  '.ogg',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.woff2',
  '.woff',
  '.ttf',
  '.otf',
  '.eot',
  '.js',
  '.css'
]);

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

// Patterns for CDP Fetch.enable interception
const CDP_ASSET_FETCH_PATTERNS = [
  '*://*.aetheria-online.in.th/assets/*.js*',
  '*://*.aetheria-online.in.th/assets/*.css*',
  '*://aetheria-online.in.th/assets/*.js*',
  '*://aetheria-online.in.th/assets/*.css*',
  '*://cdnjs.cloudflare.com/ajax/libs/*.js*',
  '*://*.aetheria-online.in.th/*.png*',
  '*://*.aetheria-online.in.th/*.webp*',
  '*://*.aetheria-online.in.th/*.jpg*',
  '*://*.aetheria-online.in.th/*.jpeg*',
  '*://*.aetheria-online.in.th/*.gif*',
  '*://*.aetheria-online.in.th/*.svg*',
  '*://*.aetheria-online.in.th/*.mp3*',
  '*://*.aetheria-online.in.th/*.ogg*',
  '*://*.aetheria-online.in.th/*.wav*',
  '*://*.aetheria-online.in.th/*.m4a*',
  '*://*.aetheria-online.in.th/*.woff2*',
  '*://*.aetheria-online.in.th/*.woff*',
  '*://*.aetheria-online.in.th/*.ttf*',
  '*://aetheria-online.in.th/*.png*',
  '*://aetheria-online.in.th/*.webp*',
  '*://aetheria-online.in.th/*.mp3*',
  '*://aetheria-online.in.th/*.ogg*',
  '*://aetheria-online.in.th/*.wav*',
  '*://aetheria-online.in.th/*.woff2*',
  '*://fonts.gstatic.com/*.woff2*',
  '*://fonts.gstatic.com/*.ttf*'
].map(urlPattern => ({ urlPattern, requestStage: 'Request' }));

const MAX_MEMORY_CACHE_BYTES = 80 * 1024 * 1024; // 80 MB hot RAM cache for base64/buffers
const MAX_SINGLE_ASSET_BYTES = 25 * 1024 * 1024; // 25 MB max per single file

function getExtensionFromPathname(pathname) {
  const ext = path.posix.extname(String(pathname || '').toLowerCase());
  return CACHEABLE_EXTENSIONS.has(ext) ? ext : '';
}

function classifyExtGroup(ext) {
  if (ext === '.png') return 'png';
  if (ext === '.webp') return 'webp';
  if (ext === '.mp3' || ext === '.ogg' || ext === '.wav' || ext === '.m4a' || ext === '.aac' || ext === '.flac') return 'audio';
  if (ext === '.woff2' || ext === '.woff' || ext === '.ttf' || ext === '.otf' || ext === '.eot') return 'font';
  return 'other';
}

function isAllowedAssetHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/:\d+$/, '');
  if (!h) return false;
  return (
    h === 'aetheria-online.in.th' ||
    h.endsWith('.aetheria-online.in.th') ||
    h === 'fonts.gstatic.com' ||
    h === 'cdnjs.cloudflare.com'
  );
}

function isCacheableAssetUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) return false;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  if (!isAllowedAssetHost(parsed.hostname)) return false;
  const lowerPath = parsed.pathname.toLowerCase();
  // Never cache dynamic security/captcha/auth endpoints if any ever use image extensions
  if (/human[-_]?check|captcha|verify|auth|session|login/i.test(lowerPath)) return false;
  const ext = getExtensionFromPathname(lowerPath);
  if (!ext) return false;
  if (ext === '.js' || ext === '.css') {
    const h = parsed.hostname.toLowerCase();
    if (h === 'cdnjs.cloudflare.com') return lowerPath.startsWith('/ajax/libs/');
    // Only cache immutable hashed Vite bundles under /assets/ (never cache root bot.js or dynamic scripts)
    return lowerPath.startsWith('/assets/') && /-[a-z0-9_]{6,}\.(js|css)$/i.test(lowerPath);
  }
  return true;
}

function normalizeAssetCacheKey(rawUrl) {
  const parsed = new URL(rawUrl);
  const ext = getExtensionFromPathname(parsed.pathname);
  const cleanOrigin = `${parsed.protocol}//${parsed.hostname.toLowerCase()}`;
  const cleanPath = parsed.pathname;
  const normalizedUrl = `${cleanOrigin}${cleanPath}`;
  const hash = crypto.createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 32);
  return {
    hash,
    ext: ext || '.bin',
    fileName: `${hash}${ext || '.bin'}`,
    normalizedUrl,
    mimeType: MIME_BY_EXT[ext] || 'application/octet-stream',
    group: classifyExtGroup(ext)
  };
}

function fetchBufferDirect(targetUrl, timeoutMs = 15000, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 3) return reject(new Error('TOO_MANY_REDIRECTS'));
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return reject(e);
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(parsed, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': '*/*'
      },
      timeout: timeoutMs
    }, res => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        let nextUrl;
        try {
          nextUrl = new URL(res.headers.location, targetUrl).toString();
        } catch (e) {
          return reject(e);
        }
        return resolve(fetchBufferDirect(nextUrl, timeoutMs, redirectCount + 1));
      }
      if (status !== 200) {
        res.resume();
        return reject(new Error(`HTTP_${status}`));
      }
      const chunks = [];
      let total = 0;
      res.on('data', chunk => {
        total += chunk.length;
        if (total > MAX_SINGLE_ASSET_BYTES) {
          req.destroy(new Error('ASSET_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = String(res.headers['content-type'] || '').split(';')[0].trim();
        resolve({ buffer, contentType, status: 200 });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => {
      req.destroy(new Error('ASSET_FETCH_TIMEOUT'));
    });
    req.on('error', reject);
  });
}

function createAssetCache({ dataDir, fetchDirect = fetchBufferDirect, now = Date.now } = {}) {
  const cacheDir = path.join(dataDir, 'asset_cache');
  const filesDir = path.join(cacheDir, 'files');
  const stateFile = path.join(cacheDir, 'state.json');
  fs.mkdirSync(filesDir, { recursive: true });

  // Hot in-memory LRU cache: fileName -> { buffer, base64, mimeType, size, group }
  const memoryCache = new Map();
  let memoryCacheBytes = 0;
  const inFlight = new Map();

  let state = {
    enabled: true,
    startedAt: now(),
    hits: 0,
    misses: 0,
    bytesSaved: 0,
    bytesFetchedDirect: 0,
    byGroup: {
      png: { hits: 0, bytesSaved: 0 },
      webp: { hits: 0, bytesSaved: 0 },
      audio: { hits: 0, bytesSaved: 0 },
      font: { hits: 0, bytesSaved: 0 },
      other: { hits: 0, bytesSaved: 0 }
    }
  };

  try {
    if (fs.existsSync(stateFile)) {
      const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (saved && typeof saved === 'object') {
        if (typeof saved.enabled === 'boolean') state.enabled = saved.enabled;
        if (typeof saved.hits === 'number') state.hits = saved.hits;
        if (typeof saved.misses === 'number') state.misses = saved.misses;
        if (typeof saved.bytesSaved === 'number') state.bytesSaved = saved.bytesSaved;
        if (typeof saved.bytesFetchedDirect === 'number') state.bytesFetchedDirect = saved.bytesFetchedDirect;
        if (typeof saved.startedAt === 'number') state.startedAt = saved.startedAt;
        if (saved.byGroup && typeof saved.byGroup === 'object') {
          for (const k of Object.keys(state.byGroup)) {
            if (saved.byGroup[k]) {
              state.byGroup[k].hits = Number(saved.byGroup[k].hits) || 0;
              state.byGroup[k].bytesSaved = Number(saved.byGroup[k].bytesSaved) || 0;
            }
          }
        }
      }
    }
  } catch (_) {}

  let stateDirty = false;
  function saveStateNow() {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      const tmp = stateFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
      fs.renameSync(tmp, stateFile);
      stateDirty = false;
    } catch (_) {}
  }

  const flushTimer = setInterval(() => {
    if (stateDirty) saveStateNow();
  }, 10000);
  flushTimer.unref?.();

  function putMemoryCache(fileName, entry) {
    if (!entry || entry.size > 4 * 1024 * 1024) return; // Don't keep >4MB single files in hot RAM
    if (memoryCache.has(fileName)) {
      const prev = memoryCache.get(fileName);
      memoryCacheBytes -= prev.size;
      memoryCache.delete(fileName);
    }
    while (memoryCacheBytes + entry.size > MAX_MEMORY_CACHE_BYTES && memoryCache.size > 0) {
      const oldestKey = memoryCache.keys().next().value;
      const oldest = memoryCache.get(oldestKey);
      memoryCacheBytes -= (oldest?.size || 0);
      memoryCache.delete(oldestKey);
    }
    memoryCache.set(fileName, entry);
    memoryCacheBytes += entry.size;
  }

  function recordHit(group, size, isHit = true) {
    if (isHit) {
      state.hits += 1;
    } else {
      state.misses += 1;
      state.bytesFetchedDirect += size;
    }
    state.bytesSaved += size;
    const g = state.byGroup[group] || state.byGroup.other;
    g.hits += 1;
    g.bytesSaved += size;
    stateDirty = true;
  }

  async function getOrFetch(rawUrl) {
    if (!isCacheableAssetUrl(rawUrl)) {
      return { ok: false, reason: 'NOT_CACHEABLE' };
    }
    const keyInfo = normalizeAssetCacheKey(rawUrl);
    const { fileName, mimeType, group } = keyInfo;

    // 1. Check hot RAM cache first
    const mem = memoryCache.get(fileName);
    if (mem) {
      // Refresh LRU order
      memoryCache.delete(fileName);
      memoryCache.set(fileName, mem);
      recordHit(group, mem.size, true);
      return {
        ok: true,
        hit: true,
        fromCache: true,
        source: 'memory',
        status: 200,
        mimeType: mem.mimeType,
        buffer: mem.buffer,
        body: mem.buffer,
        base64: mem.base64,
        size: mem.size
      };
    }

    // 2. Check local disk cache
    const filePath = path.join(filesDir, fileName);
    try {
      if (fs.existsSync(filePath)) {
        const buffer = await fs.promises.readFile(filePath);
        if (buffer && buffer.length > 0) {
          const entry = {
            buffer,
            base64: buffer.toString('base64'),
            mimeType,
            size: buffer.length,
            group
          };
          putMemoryCache(fileName, entry);
          recordHit(group, buffer.length, true);
          return {
            ok: true,
            hit: true,
            fromCache: true,
            source: 'disk',
            status: 200,
            mimeType,
            buffer,
            body: buffer,
            base64: entry.base64,
            size: buffer.length
          };
        }
      }
    } catch (_) {}

    // 3. Cache miss -> Deduplicated direct fetch (bypasses proxy!)
    if (inFlight.has(fileName)) {
      try {
        const shared = await inFlight.get(fileName);
        if (shared && shared.ok) {
          recordHit(group, shared.size, true);
          return { ...shared, hit: true, fromCache: true, source: 'inflight-shared' };
        }
      } catch (_) {}
    }

    const fetchPromise = (async () => {
      const fetched = await fetchDirect(rawUrl, 15000);
      const buffer = fetched && (fetched.buffer || fetched.body);
      if (!buffer || buffer.length === 0) {
        throw new Error('EMPTY_ASSET_BUFFER');
      }
      const effectiveMime = (fetched.contentType && !fetched.contentType.includes('text/html'))
        ? fetched.contentType
        : mimeType;
      try {
        const tmpFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        await fs.promises.writeFile(tmpFile, buffer);
        await fs.promises.rename(tmpFile, filePath).catch(async () => {
          await fs.promises.unlink(tmpFile).catch(() => {});
        });
      } catch (_) {}

      const entry = {
        buffer,
        base64: buffer.toString('base64'),
        mimeType: effectiveMime,
        size: buffer.length,
        group
      };
      putMemoryCache(fileName, entry);
      return {
        ok: true,
        hit: false,
        fromCache: false,
        source: 'direct-network',
        status: 200,
        mimeType: effectiveMime,
        buffer,
        body: buffer,
        base64: entry.base64,
        size: buffer.length
      };
    })();

    inFlight.set(fileName, fetchPromise);
    try {
      const result = await fetchPromise;
      recordHit(group, result.size, false);
      return result;
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      inFlight.delete(fileName);
    }
  }

  function getDiskSummary() {
    let filesCount = 0;
    let diskBytes = 0;
    try {
      const names = fs.readdirSync(filesDir);
      for (const name of names) {
        if (name.endsWith('.tmp')) continue;
        try {
          const st = fs.statSync(path.join(filesDir, name));
          if (st.isFile()) {
            filesCount += 1;
            diskBytes += st.size;
          }
        } catch (_) {}
      }
    } catch (_) {}
    return { filesCount, diskBytes };
  }

  function getStatus() {
    const disk = getDiskSummary();
    return {
      enabled: state.enabled !== false,
      startedAt: state.startedAt,
      hits: state.hits,
      misses: state.misses,
      totalServed: state.hits + state.misses,
      bytesSaved: state.bytesSaved,
      bytesFetchedDirect: state.bytesFetchedDirect,
      filesCount: disk.filesCount,
      diskBytes: disk.diskBytes,
      memoryFilesCount: memoryCache.size,
      memoryBytes: memoryCacheBytes,
      byGroup: state.byGroup
    };
  }

  function setEnabled(enabled) {
    state.enabled = Boolean(enabled);
    stateDirty = true;
    saveStateNow();
    return state.enabled;
  }

  function resetStats() {
    state.startedAt = now();
    state.hits = 0;
    state.misses = 0;
    state.bytesSaved = 0;
    state.bytesFetchedDirect = 0;
    for (const k of Object.keys(state.byGroup)) {
      state.byGroup[k] = { hits: 0, bytesSaved: 0 };
    }
    stateDirty = true;
    saveStateNow();
    return getStatus();
  }

  function dispose() {
    clearInterval(flushTimer);
    if (stateDirty) saveStateNow();
  }

  return {
    isEnabled: () => state.enabled !== false,
    setEnabled,
    isCacheableAssetUrl,
    normalizeAssetCacheKey,
    getOrFetch,
    getStatus,
    getStats: getStatus,
    resetStats,
    dispose,
    CDP_ASSET_FETCH_PATTERNS
  };
}

module.exports = {
  createAssetCache,
  isCacheableAssetUrl,
  normalizeAssetCacheKey,
  CDP_ASSET_FETCH_PATTERNS,
  CACHEABLE_EXTENSIONS
};
