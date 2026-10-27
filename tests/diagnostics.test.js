const test = require('node:test');
const assert = require('node:assert/strict');
const { BleDiagnostics } = require('../miniprogram/lib/diagnostics');
const { sections } = require('../miniprogram/lib/privacy');

function fixture(
  version = 'develop',
  config = { enabled: true, env: 'dev-env', service: 'dev-diag' },
) {
  const calls = [];
  const wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: version } }),
    cloud: {
      Cloud: class {
        async init() {}
        async callContainer(options) {
          calls.push(options);
          return { statusCode: 202, data: { ok: true } };
        }
      },
    },
  };
  return { diag: new BleDiagnostics(wx, config), calls };
}

test('diagnostics stay off without explicit opt-in, in preview, trial, release and unconfigured builds', () => {
  for (const [version, config] of [
    ['develop', { enabled: false, env: 'dev-env', service: 'dev-diag' }],
    ['trial', { enabled: true, env: 'dev-env', service: 'dev-diag' }],
    ['release', { enabled: true, env: 'dev-env', service: 'dev-diag' }],
    ['develop', { enabled: true, env: '', service: '' }],
  ]) {
    const h = fixture(version, config);
    assert.equal(h.diag.available, false);
    assert.equal(h.diag.record('start_requested'), false);
    assert.equal(h.calls.length, 0);
  }
  const ready = fixture();
  assert.equal(ready.diag.available, true);
  assert.equal(ready.diag.record('start_requested'), false);
});
test('diagnostic disclosure matches the isolated service in the existing cloud environment', () => {
  const notice = sections.find((section) => section.title.includes('蓝牙诊断'))?.content;
  assert.match(notice, /现有云环境中的独立诊断服务/);
  assert.doesNotMatch(notice, /专用开发云环境/);
});
test('opted-in diagnostics batch only allowlisted metadata without identity or training secrets', async () => {
  const h = fixture();
  const id = h.diag.start();
  assert.match(id, /^[a-f0-9]{24}$/);
  h.diag.record('notify_raw', {
    sample: '7878782c782c',
    length: 23,
    deviceId: 'private-device',
    token: 'private-token',
    password: 'private-password',
    message: 'private-message',
  });
  h.diag.record('write_error', { phase: 'start', code: 10003, message: 'private-message' });
  h.diag.record('unknown_event', { sample: 'aa' });
  h.diag.flush();
  await new Promise(setImmediate);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].path, '/v1/ble-diagnostics');
  assert.equal(h.calls[0].data.id, id);
  assert.deepEqual(
    h.calls[0].data.events.map((e) => e.event),
    ['session_started', 'notify_raw', 'write_error'],
  );
  assert.doesNotMatch(JSON.stringify(h.calls), /private-|Authorization|phone|openid/);
  h.diag.stop();
});
test('failed diagnostic upload never throws into a BLE callback or retries a control write', async () => {
  const h = fixture();
  let attempts = 0;
  h.diag.api.cloud.Cloud = class {
    async init() {}
    async callContainer() {
      attempts++;
      throw new Error('network unavailable');
    }
  };
  h.diag.start();
  assert.equal(h.diag.record('write_ok', { phase: 'start' }), true);
  assert.doesNotThrow(() => h.diag.flush());
  await new Promise(setImmediate);
  assert.equal(attempts, 1);
  assert.equal(h.diag.queue.length, 0);
  h.diag.stop();
});
test('overlapping diagnostic batches wait for one cloud initialization without blocking BLE', async () => {
  const h = fixture();
  let finishInit,
    initCalls = 0,
    sends = 0;
  h.diag.api.cloud.Cloud = class {
    async init() {
      initCalls++;
      await new Promise((resolve) => {
        finishInit = resolve;
      });
    }
    async callContainer() {
      sends++;
      return { statusCode: 202 };
    }
  };
  h.diag.start();
  h.diag.record('gate_ok');
  h.diag.flush();
  await new Promise(setImmediate);
  h.diag.record('write_ok', { phase: 'start' });
  h.diag.flush();
  await new Promise(setImmediate);
  assert.equal(initCalls, 1);
  assert.equal(sends, 0);
  finishInit();
  await new Promise(setImmediate);
  assert.equal(sends, 2);
  h.diag.stop();
});
