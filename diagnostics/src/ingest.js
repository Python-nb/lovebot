const EVENTS = new Set([
  'session_started',
  'connection_ready',
  'notify_ok',
  'notify_error',
  'notify_raw',
  'frame_valid',
  'start_requested',
  'gate_ok',
  'gate_blocked',
  'write_ok',
  'write_error',
  'receive_timeout',
  'disconnected',
]);
const PHASES = new Set([
  'before_confirm',
  'before_send',
  'start',
  'stop',
  'setup_time',
  'setup_count',
]);
const FIELDS = new Set(['event', 'at', 'phase', 'code', 'length', 'sample', 'count']);
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.has(key));
function validEvent(value, now) {
  return (
    exact(value, FIELDS) &&
    EVENTS.has(value.event) &&
    Number.isSafeInteger(value.at) &&
    Math.abs(value.at - now) <= 900000 &&
    (value.phase === undefined || PHASES.has(value.phase)) &&
    (value.code === undefined || (Number.isInteger(value.code) && Math.abs(value.code) <= 99999)) &&
    (value.length === undefined ||
      (Number.isInteger(value.length) && value.length >= 0 && value.length <= 4096)) &&
    (value.count === undefined ||
      (Number.isInteger(value.count) && value.count >= 0 && value.count <= 100)) &&
    (value.sample === undefined ||
      (typeof value.sample === 'string' && /^(?:78|2c|3f|0a|0d){1,24}$/.test(value.sample)))
  );
}
function createHandler({
  enabled = false,
  log = (row) => process.stdout.write(`${JSON.stringify(row)}\n`),
  now = Date.now,
} = {}) {
  const limits = new Map();
  function limited(key, max) {
    const time = now(),
      previous = limits.get(key);
    const value = previous && previous.until > time ? previous : { hits: 0, until: time + 60000 };
    value.hits++;
    if (limits.size > 2000) limits.clear();
    limits.set(key, value);
    return value.hits > max;
  }
  const reply = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  return (req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') return reply(res, 200, { ok: true });
    if (!enabled || req.method !== 'POST' || req.url !== '/v1/ble-diagnostics')
      return reply(res, 404, { error: 'NOT_FOUND' });
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))
      return reply(res, 415, { error: 'CONTENT_TYPE' });
    let body = '',
      ended = false;
    req.on('data', (chunk) => {
      if (ended) return;
      body += chunk;
      if (body.length > 8192) {
        ended = true;
        reply(res, 413, { error: 'TOO_LARGE' });
      }
    });
    req.on('end', () => {
      if (ended) return;
      let value;
      try {
        value = JSON.parse(body);
      } catch (_) {
        return reply(res, 400, { error: 'INVALID' });
      }
      const time = now();
      if (
        !exact(value, new Set(['id', 'events'])) ||
        Object.keys(value).length !== 2 ||
        typeof value.id !== 'string' ||
        !/^[a-f0-9]{24}$/.test(value.id) ||
        !Array.isArray(value.events) ||
        !value.events.length ||
        value.events.length > 8 ||
        !value.events.every((event) => validEvent(event, time))
      )
        return reply(res, 400, { error: 'INVALID' });
      const ip = req.socket.remoteAddress || 'unknown';
      if (limited('global', 100) || limited(`ip:${ip}`, 30) || limited(`id:${value.id}`, 10))
        return reply(res, 429, { error: 'RATE_LIMIT' });
      try {
        log({ kind: 'ble_diagnostic', receivedAt: time, id: value.id, events: value.events });
      } catch (_) {
        return reply(res, 503, { error: 'LOG_UNAVAILABLE' });
      }
      return reply(res, 202, { ok: true });
    });
  };
}
module.exports = { createHandler, EVENTS };
