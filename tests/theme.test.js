const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../miniprogram/lib/theme');
test('default or corrupted preference follows system, missing API safely uses light', () => {
  assert.equal(T.read({ getStorageSync: () => null }), 'system');
  assert.equal(T.read({ getStorageSync: () => 'unknown' }), 'system');
  assert.equal(
    T.read({
      getStorageSync: () => {
        throw Error('denied');
      },
    }),
    'system',
  );
  assert.equal(T.system({}), 'light');
});
test('explicit theme wins, automatic theme uses light and dark', () => {
  assert.equal(T.resolve('light', 'dark'), 'light');
  assert.equal(T.resolve('dark', 'light'), 'dark');
  assert.equal(T.resolve('system', 'dark'), 'dark');
  assert.equal(T.resolve('system', 'light'), 'light');
});
test('native chrome foreground contrast changes with appearance', () => {
  assert.equal(T.chrome('light').frontColor, '#000000');
  assert.equal(T.chrome('dark').frontColor, '#ffffff');
  assert.equal(T.chrome('light').backgroundColor, '#f4f6fa');
  assert.equal(T.chrome('dark').backgroundColor, '#0e131c');
});
