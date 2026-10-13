// Block foreign websites and DNS rebinding against the loopback Manager.
// Local processes/owners remain inside the trust boundary.
function allowLocalRequest(req, port) {
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  if (!allowedHosts.has((req.headers.host || '').toLowerCase())) return false;
  const remote = req.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      const url = new URL(origin);
      if (url.origin !== origin || url.protocol !== 'http:' || !allowedHosts.has(url.host.toLowerCase())) return false;
    } catch (_) { return false; }
  }
  return true;
}
module.exports = { allowLocalRequest };
