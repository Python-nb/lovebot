const configured = require('../config/diagnostics');
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
function details(value) {
  const result = {};
  if (PHASES.has(value?.phase)) result.phase = value.phase;
  if (Number.isInteger(value?.code) && value.code >= -99999 && value.code <= 99999)
    result.code = value.code;
  if (Number.isInteger(value?.length) && value.length >= 0 && value.length <= 4096)
    result.length = value.length;
  if (typeof value?.sample === 'string' && /^(?:78|2c|3f|0a|0d){1,24}$/.test(value.sample))
    result.sample = value.sample;
  if (Number.isInteger(value?.count) && value.count >= 0 && value.count <= 100)
    result.count = value.count;
  return result;
}
class BleDiagnostics {
  constructor(api, config = configured) {
    this.api = api;
    this.config = config;
    this.active = false;
    this.queue = [];
    this.sentSamples = 0;
    this.timer = null;
    this.cloud = null;
    let version;
    try {
      version = api.getAccountInfoSync?.().miniProgram?.envVersion;
    } catch (_) {
      /* fail closed */
    }
    this.available =
      config.enabled === true &&
      !!config.env &&
      !!config.service &&
      version === 'develop' &&
      typeof api.cloud?.Cloud === 'function';
  }
  start() {
    if (!this.available || this.active) return null;
    this.active = true;
    this.sentSamples = 0;
    this.until = Date.now() + 5 * 60000;
    this.id =
      `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`
        .slice(0, 24)
        .padEnd(24, '0');
    this.record('session_started');
    return this.id;
  }
  stop() {
    this.active = false;
    this.queue = [];
    clearTimeout(this.timer);
    this.timer = null;
  }
  record(event, value = {}) {
    try {
      if (!this.active || Date.now() >= this.until || !EVENTS.has(event)) {
        if (this.active && Date.now() >= this.until) this.stop();
        return false;
      }
      if (event === 'notify_raw') {
        if (this.sentSamples >= 3) return false;
        this.sentSamples++;
      }
      this.queue.push({ event, at: Date.now(), ...details(value) });
      if (this.queue.length > 24) this.queue.shift();
      if (this.queue.length >= 8) this.flush();
      else if (!this.timer)
        this.timer = setTimeout(() => {
          this.timer = null;
          this.flush();
        }, 3000);
      return true;
    } catch (_) {
      return false;
    }
  }
  flush() {
    if (!this.active || !this.queue.length) return;
    clearTimeout(this.timer);
    this.timer = null;
    const events = this.queue.splice(0, 8),
      id = this.id;
    // Fire and forget: neither BLE callbacks nor control writes await cloud initialization/upload.
    Promise.resolve()
      .then(async () => {
        if (!this.active || id !== this.id) return;
        if (!this.cloud) {
          this.cloud = (async () => {
            const cloud = new this.api.cloud.Cloud({ resourceEnv: this.config.env });
            await cloud.init();
            return cloud;
          })().catch((error) => {
            this.cloud = null;
            throw error;
          });
        }
        const cloud = await this.cloud;
        if (!this.active || id !== this.id) return;
        await cloud.callContainer({
          path: '/v1/ble-diagnostics',
          method: 'POST',
          header: { 'X-WX-SERVICE': this.config.service, 'Content-Type': 'application/json' },
          data: { id, events },
          timeout: 1500,
        });
      })
      .catch(() => {
        /* diagnostics are best effort and never retry control actions */
      });
  }
}
module.exports = { BleDiagnostics, EVENTS, details };
