const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../miniprogram/lib/records');
const row = (extra = {}) => ({
  id: 'one',
  source: 'ble',
  mode: 'free',
  shots: 10,
  hits: 6,
  seconds: 120,
  endedAt: Date.now(),
  ...extra,
});
function api() {
  const data = {};
  return { getStorageSync: (k) => data[k], setStorageSync: (k, v) => (data[k] = v) };
}
test('zero denominator is not NaN', () => assert.equal(R.rate(0, 0), '0.0'));
test('weighted accuracy, not average of per-session percentages', () =>
  assert.equal(R.summary([row(), row({ shots: 90, hits: 9 })]).rate, '15.0'));
test('save readback and repeated save idempotency', () => {
  const wx = api();
  R.save(wx, row());
  R.save(wx, row());
  assert.equal(R.load(wx).length, 1);
});
test('storage write failure propagates', () =>
  assert.throws(
    () =>
      R.save(
        {
          getStorageSync: () => [],
          setStorageSync: () => {
            throw Error('full');
          },
        },
        row(),
      ),
    /full/,
  ));
test('corrupt storage safely ignored', () =>
  assert.deepEqual(
    R.load({ getStorageSync: () => [null, row({ source: 'fake' }), row({ hits: 11 })] }),
    [],
  ));
test('record mode validation rejects inherited object keys and non-string coercion', () => {
  for (const mode of ['toString', 'constructor', '__proto__', ['free'], null]) {
    assert.equal(R.valid(row({ mode })), false);
    assert.throws(() => R.save(api(), row({ mode })), /记录格式无效/);
  }
});
test('production rejects synthetic source and ignores historical simulations', () => {
  const wx = api();
  wx.setStorageSync(R.KEY, [row({ source: 'demo' }), row({ id: 'real' })]);
  assert.deepEqual(
    R.load(wx).map((r) => r.id),
    ['real'],
  );
  assert.throws(() => R.save(wx, row({ source: 'demo' })), /记录格式无效/);
});
test('clock supports hours', () => assert.equal(R.clock(3661), '01:01:01'));
test('local dates do not shift through UTC', () =>
  assert.equal(R.dayKey(new Date(2026, 9, 26, 0, 1)), '2026-10-26'));
test('trend includes zero days and correct day sums', () => {
  const now = new Date(2026, 9, 26, 12);
  const points = R.trend([row({ endedAt: now.getTime() })], 7, now);
  assert.equal(points.length, 7);
  assert.equal(points[0].shots, 0);
  assert.equal(points[6].shots, 10);
});
