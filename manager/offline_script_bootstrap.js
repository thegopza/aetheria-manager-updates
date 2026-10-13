// PmheeAether authorized Manager bootstrap (transition candidate; not the live bot.js).
// ใช้งานผ่าน Manager โดยได้รับอนุญาตจากเจ้าของเท่านั้น การบำรุงรักษาและทดสอบที่เจ้าของอนุญาตทำได้
// Do not extract, redistribute, or modify to bypass authorization or usage accounting without owner permission.
// This ownership notice is not an AI safeguard or a claim that memory extraction is impossible.
(function (host) {
  'use strict';
  if (host.__pmScriptBootstrap) return;
  // Protected release tooling replaces this exact marker with pinned PUBLIC keys.
  // Never accept trust anchors supplied by a ticket, payload, or an API response.
  const PUBLIC_KEYS = /* PMHEE_PUBLIC_KEYS */ {};
  const nativeTimeout = host.setTimeout.bind(host);
  const nativeInterval = host.setInterval.bind(host);
  const encoder = new TextEncoder();
  const nonceBytes = new Uint8Array(24);
  host.crypto.getRandomValues(nonceBytes);
  const runtimeNonce = Array.from(nonceBytes, x => x.toString(16).padStart(2, '0')).join('');
  let phase = 'waiting', claims = null, failed = null, timer = null;
  const exports = new Map();
  const passthrough = new Set(['requestAnimationFrame', 'cancelAnimationFrame', 'dispatchEvent', 'WebSocket',
    'setLowPowerMode', 'getColyseusRoom', 'getGameRoom', '__getClientLiveState',
    'getCurrentMapName', 'getCurrentChannel', 'getLiveCharacterData']);
  const safeStops = new Set(['stopMasterBot', 'stopPelicanBot']);
  const facade = new Proxy(host, {
    get(target, key) {
      if (exports.has(key)) return exports.get(key);
      const value = Reflect.get(target, key, target);
      if (typeof key === 'string' && ['PointerEvent', 'MouseEvent', 'KeyboardEvent', 'UIEvent', 'FocusEvent', 'WheelEvent'].includes(key) && typeof value === 'function') {
        return new Proxy(value, {
          construct(ctor, args, newTarget) {
            const [type, dict] = args;
            if (dict && dict.view === facade) {
              args = [type, Object.assign({}, dict, { view: target })];
            }
            return Reflect.construct(ctor, args, newTarget);
          }
        });
      }
      // Browser methods require a genuine Window receiver; constructors must retain their prototype.
      return typeof value === 'function' && typeof key === 'string' && !/^[A-Z]/.test(key) ? value.bind(target) : value;
    },
    set(target, key, value) {
      if (typeof value === 'function' && !passthrough.has(key)) {
        exports.set(key, value);
        // External callers/HTML handlers must hold a valid ticket even while an older task drains.
        return Reflect.set(target, key, function (...args) {
          if (!safeStops.has(key)) { runtime.assert(); return value.apply(this, args); }
          const previous = cleaning;
          cleaning = true;
          try { return value.apply(this, args); } finally { cleaning = previous; }
        }, target);
      }
      exports.delete(key);
      return Reflect.set(target, key, value, target);
    }
  });
  const busyKeys = ['__isShopping', '__isStoring', '__isNavigating', '__isRecovering',
    '__isConsolidating', '__consolidationReceiverMode', '__isChangingJob', '__isGearRefining',
    '__isManualSelling', '__isManualWarping', '__isWalkingToMap', '__planMarketBuyInFlight',
    '__isAutoSellingNow', '__isMarketScanning', '__isHumanizing', '__isWeightScrollBusy', '__senderTradeBusy'];
  const busy = () => busyKeys.some(key => host[key] === true) || !!host.document?.querySelector('.human-check');
  const now = () => Date.now();
  let cleaning = false;
  const allowed = () => !!claims && phase === 'ready';
  function bytes(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error('INVALID_ENCODING');
    return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), x => x.charCodeAt(0));
  }
  async function verify(ticket) {
    if (!ticket || !Object.hasOwn(PUBLIC_KEYS, ticket.keyId)) throw Error('UNTRUSTED_KEY');
    const c = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes(ticket.claims)));
    if (c.protocol !== 2 || c.mode !== 'friends-offline' || !/^\d+\.\d+\.\d+$/.test(c.version) ||
      !/^[a-f0-9]{64}$/.test(c.payloadHash) || !Number.isSafeInteger(c.size) || c.size < 1 || c.size > 4 * 1024 * 1024 ||
      !Number.isSafeInteger(c.issuedAt) || c.issuedAt < 1 || c.issuedAt > now() + 30000) throw Error('INVALID_RELEASE');
    const key = await host.crypto.subtle.importKey('jwk', PUBLIC_KEYS[ticket.keyId], { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    if (!await host.crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key,
      bytes(ticket.signature), encoder.encode('PmheeAether.offline-release.v1\n' + ticket.claims))) throw Error('INVALID_SIGNATURE');
    return Object.freeze(c);
  }
  const runtime = Object.freeze({
    window: facade,
    allowed,
    nativeTimeout,
    nativeInterval,
    draining: () => cleaning || (!allowed() && phase === 'ready' && busy()),
    async wait(value) { const result = await value; if (!allowed() && !runtime.draining()) throw Error('SCRIPT_AUTHORIZATION_EXPIRED'); return result; },
    assert() { if (!allowed()) throw Error('SCRIPT_AUTHORIZATION_REQUIRED'); },
    setInterval(fn, ms, ...args) { return nativeInterval(() => { if (allowed() || busy()) fn(...args); }, ms); },
    setTimeout(fn, ms, ...args) { return nativeTimeout(() => { if (allowed() || busy()) fn(...args); }, ms); },
    guard(fn) { return function (...args) { runtime.assert(); return fn.apply(this, args); }; }
  });
  async function accept(input) {
    if (phase !== 'waiting') return { success: false, code: phase === 'ready' ? 'ALREADY_LOADED' : 'LOAD_IN_PROGRESS_OR_FAILED' };
    phase = 'verifying';
    try {
      const next = await verify(input?.envelope || input?.ticket);
      const source = typeof input.payload === 'string' ? input.payload : input.payload?.source;
      if (typeof source !== 'string' || encoder.encode(source).byteLength > 4 * 1024 * 1024) throw Error('INVALID_PAYLOAD');
      if (typeof input.payload === 'object' && (input.payload.version !== next.version || input.payload.hash !== next.payloadHash)) throw Error('PAYLOAD_METADATA_MISMATCH');
      if (encoder.encode(source).byteLength !== next.size) throw Error('PAYLOAD_SIZE_MISMATCH');
      const digest = await host.crypto.subtle.digest('SHA-256', encoder.encode(source));
      const hash = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
      if (hash !== next.payloadHash) throw Error('PAYLOAD_HASH_MISMATCH');
      if (host.__pelicanBotVersion || host.__pmPayloadInitialized || host.__pmLegacyInjectionAttempted || ('__isBotRunning' in host) || typeof host.startMasterBot === 'function' || host.document?.getElementById?.('pelican-hud')) throw Error('EXISTING_RUNTIME_REFRESH_REQUIRED');
      const initialize = new Function('runtime', source);
      claims = next;
      phase = 'ready';
      host.__pmPayloadInitialized = true; // Set BEFORE invoking any timer/export/plan IIFE.
      initialize(runtime);
      return { success: true, version: next.version, slotId: next.slotId };
    } catch (error) {
      failed = error.message;
      // A partial initialization must NEVER be retried on this document.
      phase = host.__pmPayloadInitialized ? 'failed' : 'waiting';
      if (phase === 'waiting') claims = null;
      return { success: false, code: failed };
    }
  }
  async function renew() { return { success: true, offline: true }; }
  Object.defineProperty(host, '__pmScriptBootstrap', { value: Object.freeze({
    accept, renew,
    status: () => ({ protocol: 2, mode: 'friends-offline', phase, runtimeNonce, activated: !!host.__pmPayloadInitialized, busy: busy(), version: claims?.version || null,
      slotId: claims?.slotId || null, payloadHash: claims?.payloadHash || null,
      expiresAt: claims?.expiresAt || null, graceUntil: claims?.graceUntil || null, code: failed })
  }), configurable: false, writable: false });
})(window);
