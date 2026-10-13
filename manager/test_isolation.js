'use strict';
// Review R6: outbound network guard for PELICAN_TEST_INSTANCE managers.
// Every outbound connection that is not loopback to an explicitly allowed fixture port is refused (the request
// fails asynchronously with TEST_OUTBOUND_BLOCKED) and recorded, so a UI fixture can prove that nothing reached
// GitHub, the owner API, Discord or a real game window.
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function installTestIsolation({ allowedPorts }) {
  const allowed = new Set(allowedPorts.map(Number).filter(Number.isInteger));
  const blocked = [];
  const isAllowed = (host, port) => LOOPBACK.has(String(host || '').toLowerCase()) && allowed.has(Number(port));
  const refuse = (host, port, via) => {
    blocked.push({ host: String(host), port: Number(port) || null, via, at: Date.now() });
    const err = new Error('TEST_OUTBOUND_BLOCKED ' + host + ':' + port);
    err.code = 'TEST_OUTBOUND_BLOCKED';
    return err;
  };
  const deadSocket = err => { const s = new net.Socket(); process.nextTick(() => s.destroy(err)); return s; };

  const target = (args, defaultPort) => {
    let url = null, opts = {}, cb;
    if (typeof args[0] === 'string' || args[0] instanceof URL) {
      url = new URL(String(args[0]));
      if (args[1] && typeof args[1] === 'object') { opts = args[1]; cb = args[2]; } else cb = args[1];
    } else { opts = args[0] || {}; cb = args[1]; }
    const host = opts.hostname || (opts.host ? String(opts.host).replace(/:\d+$/, '') : null) || url?.hostname || 'localhost';
    const port = opts.port || (opts.host && /:\d+$/.test(opts.host) ? opts.host.split(':').pop() : null) || url?.port || defaultPort;
    return { url, opts, cb, host, port };
  };
  const wrap = (mod, defaultPort, via) => {
    const origRequest = mod.request;
    mod.request = function (...args) {
      const t = target(args, defaultPort);
      if (isAllowed(t.host, t.port)) return origRequest.apply(this, args);
      const err = refuse(t.host, t.port, via);
      // Node uses options.createConnection only when no agent is given (agent:false would build a real Agent).
      const opts = { ...t.opts, agent: undefined, createConnection: () => deadSocket(err) };
      return t.url ? origRequest.call(this, t.url, opts, t.cb) : origRequest.call(this, opts, t.cb);
    };
    mod.get = function (...args) { const req = mod.request(...args); req.end(); return req; };
  };
  wrap(http, 80, 'http');
  wrap(https, 443, 'https');

  const origNetConnect = net.connect;
  net.connect = net.createConnection = function (...args) {
    const o = typeof args[0] === 'object' ? args[0] : { port: args[0], host: typeof args[1] === 'string' ? args[1] : 'localhost' };
    if (o.path || isAllowed(o.host || 'localhost', o.port)) return origNetConnect.apply(this, args);
    return deadSocket(refuse(o.host || 'localhost', o.port, 'net'));
  };
  const origTlsConnect = tls.connect;
  tls.connect = function (...args) {
    const o = typeof args[0] === 'object' ? args[0] : { port: args[0], host: typeof args[1] === 'string' ? args[1] : 'localhost' };
    if (isAllowed(o.host || 'localhost', o.port)) return origTlsConnect.apply(this, args);
    return deadSocket(refuse(o.host || 'localhost', o.port, 'tls'));
  };
  if (typeof globalThis.fetch === 'function') {
    const origFetch = globalThis.fetch;
    globalThis.fetch = function (input, init) {
      let u;
      try { u = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url); } catch { return Promise.reject(new TypeError('TEST_OUTBOUND_BLOCKED invalid')); }
      const port = u.port || (u.protocol === 'https:' ? 443 : 80);
      if (isAllowed(u.hostname, port)) return origFetch.call(this, input, init);
      return Promise.reject(refuse(u.hostname, port, 'fetch'));
    };
  }
  if (typeof globalThis.WebSocket === 'function') {
    globalThis.WebSocket = function () { throw refuse('websocket', 0, 'websocket'); };
  }
  return { blocked: () => blocked.slice(), isAllowed };
}

// Replaces human_check_solver's HTTPS requestJSON in test instances: same contract (resolve parsed JSON on
// success, reject with code/status otherwise) but only ever talks to the fixture mock on loopback.
function createFixtureRequestJSON(port) {
  return (route, payload, token) => new Promise((resolve, reject) => {
    const data = payload === undefined || payload === null ? null : JSON.stringify(payload);
    const headers = { Accept: 'application/json', 'X-Pmhee-Fixture': '1' };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (token) headers.Authorization = 'Bearer ' + token;
    const req = http.request({ host: '127.0.0.1', port, path: route, method: data ? 'POST' : 'GET', headers, timeout: 5000 }, res => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => {
        let result; try { result = JSON.parse(body); } catch (_) { return reject(new Error('Invalid fixture response')); }
        if (res.statusCode >= 200 && res.statusCode < 300 && result.success !== false) return resolve(result);
        const error = new Error(result.message || 'fixture rejected'); error.code = result.code || 'SERVICE_REJECTED'; error.status = res.statusCode; reject(error);
      });
    });
    req.on('timeout', () => req.destroy(new Error('fixture timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

module.exports = { installTestIsolation, createFixtureRequestJSON };
