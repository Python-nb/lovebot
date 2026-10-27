const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const filename = path.join(__dirname, '../miniprogram/pages/index/index.js');
const accountId = '00000000-0000-4000-8000-000000000001';
const signedIn = () => ({
  token: 'a'.repeat(64),
  expiresAt: Date.now() + 3600000,
  user: { id: accountId, nickname: '训练者', phoneMasked: '', hasPassword: false },
});
function harness(draft, options = {}) {
  let page;
  const storage = new Map();
  if (options.account) storage.set('courtside.account.session.v1', signedIn());
  if (draft)
    storage.set(
      options.account ? `courtside.account.${accountId}.draft.v1` : 'courtside.draft.v1',
      draft,
    );
  if (options.preference) storage.set('courtside.theme.v1', options.preference);
  let systemTheme = options.systemTheme || 'light';
  const events = {},
    chrome = [],
    toasts = [];
  let hiddenToasts = 0;
  const intervals = new Map(),
    delays = new Map();
  let next = 1;
  const sent = [];
  const wx = {
    onBluetoothDeviceFound: () => {},
    onBLECharacteristicValueChange: () => {},
    onBLEConnectionStateChange: () => {},
    getStorageSync: (k) => storage.get(k),
    setStorageSync: (k, v) => storage.set(k, structuredClone(v)),
    removeStorageSync: (k) => storage.delete(k),
    setKeepScreenOn: () => {},
    pageScrollTo: () => {},
    showToast: (options) => toasts.push(options),
    hideToast: () => hiddenToasts++,
    showModal: async () => ({ confirm: true }),
    getAppBaseInfo: () => ({ theme: systemTheme }),
    onThemeChange: (fn) => (events.theme = fn),
    offThemeChange: (fn) => {
      if (events.theme === fn) delete events.theme;
    },
    setNavigationBarColor: (value) => chrome.push(value),
    setBackgroundColor: () => {},
    setBackgroundTextStyle: () => {},
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: createRequire(filename),
    wx,
    Page: (p) => (page = p),
    setInterval: (fn, duration) => {
      const id = next++;
      intervals.set(id, fn);
      delays.set(id, duration);
      return id;
    },
    clearInterval: (id) => intervals.delete(id),
    setTimeout: () => next++,
    clearTimeout: () => {},
    console,
  });
  page.setData = (patch) => Object.assign(page.data, patch);
  page.onLoad();
  page.ble.stopScan = async () => {};
  page.ble.ready = true;
  page.ble.send = async (command) => sent.push(command);
  page.currentFrame = { mode: 0 };
  page.frameAt = Date.now();
  return {
    page,
    wx,
    storage,
    intervals,
    delays,
    sent,
    events,
    chrome,
    toasts,
    hiddenToasts: () => hiddenToasts,
    changeSystem: (theme) => {
      systemTheme = theme;
      if (events.theme) events.theme({ theme });
    },
  };
}
test('theme follows native system at launch and when it changes', () => {
  const h = harness(undefined, { systemTheme: 'dark' });
  assert.equal(h.page.data.theme, 'dark');
  h.changeSystem('light');
  assert.equal(h.page.data.theme, 'light');
  assert.equal(h.chrome.at(-1).frontColor, '#000000');
  assert.equal(h.sent.length, 0);
});
test('official privacy guide opens via WeChat and failure never pretends it is configured', async () => {
  const h = harness();
  let opened = 0;
  h.wx.openPrivacyContract = (o) => {
    opened++;
    o.success({});
  };
  await h.page.privacy();
  assert.equal(opened, 1);
  assert.equal(h.toasts.length, 0);
  h.wx.openPrivacyContract = (o) => o.fail({ errMsg: 'not configured' });
  await h.page.privacy();
  assert.match(h.toasts.at(-1).title, /暂不可用/);
});
test('data deletion is confirmed, scoped to records, and forbidden during training', async () => {
  const h = harness(undefined, { account: true });
  await h.page.start();
  h.page.receive({ shots: 2, hits: 1, seconds: 6, mode: 0 });
  await h.page.finish();
  h.storage.set('courtside.nickname', '保留昵称');
  h.storage.set('courtside.theme.v1', 'dark');
  const sent = [...h.sent];
  h.wx.showModal = async () => ({ confirm: false });
  await h.page.deleteRecords();
  assert.equal(h.page.data.records.length, 1);
  h.wx.showModal = async () => ({ confirm: true });
  h.page.setData({ state: 'running' });
  await h.page.deleteRecords();
  assert.equal(h.page.data.records.length, 1);
  h.page.setData({ state: 'idle' });
  await h.page.deleteRecords();
  assert.equal(h.page.data.records.length, 0);
  assert.equal(h.storage.has(`courtside.account.${accountId}.records.v1`), false);
  assert.equal(h.storage.get('courtside.nickname'), '保留昵称');
  assert.equal(h.storage.get('courtside.theme.v1'), 'dark');
  assert.deepEqual(h.sent, sent);
  assert.match(h.toasts.at(-1).title, /已删除/);
});
test('failed deletion retains records and does not show a success message', async () => {
  const h = harness(undefined, { account: true });
  await h.page.start();
  await h.page.finish();
  h.wx.removeStorageSync = () => {
    throw Error('remove failed');
  };
  await h.page.deleteRecords();
  assert.equal(h.page.data.records.length, 1);
  assert.match(h.toasts.at(-1).title, /remove failed/);
});
test('manual theme persists, ignores system change, and can return to system', () => {
  const h = harness();
  h.page.selectTheme({ currentTarget: { dataset: { id: 'dark' } } });
  h.changeSystem('light');
  assert.equal(h.page.data.theme, 'dark');
  assert.equal(h.storage.get('courtside.theme.v1'), 'dark');
  const restored = harness(undefined, {
    preference: h.storage.get('courtside.theme.v1'),
    systemTheme: 'light',
  });
  assert.equal(restored.page.data.theme, 'dark');
  h.page.selectTheme({ currentTarget: { dataset: { id: 'system' } } });
  assert.equal(h.page.data.theme, 'light');
  h.changeSystem('dark');
  assert.equal(h.page.data.theme, 'dark');
});
test('theme persistence failure does not pretend success; unload removes listener', () => {
  const h = harness();
  h.wx.setStorageSync = () => {
    throw Error('full');
  };
  h.page.selectTheme({ currentTarget: { dataset: { id: 'dark' } } });
  assert.equal(h.page.data.themePreference, 'system');
  assert.match(h.toasts.at(-1).title, /保存失败/);
  h.page.ble.dispose = () => {};
  h.page.onUnload();
  assert.equal(h.events.theme, undefined);
});
test('guest device lifecycle keeps only confirmed telemetry in memory and clears watchdog', async () => {
  const h = harness();
  await h.page.start();
  assert.equal(h.page.data.state, 'running');
  assert.equal(h.intervals.size, 1);
  [...h.intervals.values()][0]();
  assert.equal(h.page.data.shots, 0);
  assert.equal(h.page.data.seconds, 0);
  h.page.receive({ shots: 12, hits: 8, seconds: 36, mode: 0 });
  await h.page.finish();
  assert.equal(h.page.data.state, 'idle');
  assert.equal(h.intervals.size, 0);
  assert.deepEqual(h.sent, ['Turn-on', 'Turn-off']);
  assert.equal(h.page.data.records[0].source, 'ble');
  assert.equal(h.page.data.records[0].hits, 8);
  assert.equal(h.storage.has('courtside.records.v1'), false);
  assert.equal(h.storage.has('courtside.draft.v1'), false);
});
test('idle preview clears stale numbers on manual disconnect without saving a record', async () => {
  const h = harness();
  h.page.setData({ connected: true });
  h.page.receive({ shots: 3, hits: 2, seconds: 10, mode: 0 });
  assert.equal(h.page.data.shots, 3);
  await h.page.disconnect();
  assert.equal(h.page.data.connected, false);
  assert.equal(h.page.data.shots, 0);
  assert.equal(h.page.data.clock, '00:00:00');
  assert.equal(h.page.data.records.length, 0);
  assert.deepEqual(h.sent, []);
});
test('the first frame delivered during subscription is visible after connection resolves', async () => {
  const h = harness();
  const firstFrame = { shots: 3, hits: 2, seconds: 10, mode: 0, target: 0 };
  h.page.setData({ devices: [{ deviceId: 'test', name: 'T1.2' }] });
  h.page.ble.connect = async () => h.page.receive(firstFrame);
  await h.page.connectDevice({ currentTarget: { dataset: { id: 'test' } } });
  assert.equal(h.page.data.connected, true);
  assert.equal(h.page.data.shots, 3);
  assert.equal(h.page.data.hits, 2);
  assert.match(h.page.data.status, /已收到设备回传/);
  assert.equal(h.page.data.records.length, 0);
  assert.deepEqual(h.sent, []);
});
test('a delayed connection cannot make its earlier frame fresh for the start gate', async () => {
  const h = harness();
  h.page.setData({ devices: [{ deviceId: 'test', name: 'T1.2' }] });
  h.page.ble.connect = async () => {
    h.page.receive({ shots: 3, hits: 2, seconds: 10, mode: 0, target: 0 });
    h.page.frameAt = Date.now() - 4000;
  };
  await h.page.connectDevice({ currentTarget: { dataset: { id: 'test' } } });
  assert.equal(h.page.data.shots, 0);
  assert.match(h.page.data.status, /等待设备数据/);
  await h.page.start();
  assert.deepEqual(h.sent, []);
  assert.match(h.toasts.at(-1).title, /新鲜设备回传/);
});
test('idle preview is invalidated when hidden and needs a fresh frame before start', async () => {
  const h = harness();
  h.page.setData({ connected: true });
  h.page.receive({ shots: 3, hits: 2, seconds: 10, mode: 0 });
  h.page.onHide();
  assert.equal(h.page.data.shots, 0);
  h.page.onShow();
  await h.page.start();
  assert.equal(h.page.data.state, 'idle');
  assert.deepEqual(h.sent, []);
  assert.match(h.toasts.at(-1).title, /新鲜设备回传/);
});
test('idle device updates never replace an already confirmed guest result', async () => {
  const h = harness();
  h.page.setData({ connected: true });
  await h.page.start();
  h.page.receive({ shots: 4, hits: 3, seconds: 12, mode: 0 });
  await h.page.finish();
  assert.equal(h.page.data.state, 'idle');
  assert.equal(h.page.data.shots, 4);
  h.page.receive({ shots: 5, hits: 4, seconds: 15, mode: 0 });
  assert.equal(h.page.data.shots, 4);
  assert.equal(h.page.data.records.length, 1);
  assert.equal(h.page.data.records[0].shots, 4);
});
test('idle device updates never replace a saved account result on the screen', async () => {
  const h = harness(undefined, { account: true });
  h.page.setData({ connected: true });
  await h.page.start();
  h.page.receive({ shots: 4, hits: 3, seconds: 12, mode: 0 });
  await h.page.finish();
  assert.equal(h.page.data.state, 'idle');
  assert.equal(h.page.data.records[0].shots, 4);
  h.page.receive({ shots: 5, hits: 4, seconds: 15, mode: 0 });
  assert.equal(h.page.data.shots, 4);
  assert.equal(h.page.data.records[0].shots, 4);
});
test('production has no simulation entry and cannot start without device', async () => {
  const h = harness();
  h.page.ble.ready = false;
  await h.page.start();
  assert.equal(h.page.data.state, 'idle');
  assert.equal(h.intervals.size, 0);
  assert.equal(h.sent.length, 0);
  assert.match(h.toasts.at(-1).title, /蓝牙未连接.*无法开始训练.*连接发球机/);
  assert.equal(h.toasts.at(-1).icon, 'none');
  assert.equal(h.toasts.at(-1).duration, 3000);
  assert.equal(h.toasts.at(-1).mask, false);
  assert.equal(Object.hasOwn(h.page.data, 'error'), false);
  assert.equal(h.page.toggleDemo, undefined);
  assert.equal(Object.hasOwn(h.page.data, 'demo'), false);
});
test('real start requires fresh telemetry', async () => {
  const h = harness();
  h.page.currentFrame = null;
  await h.page.start();
  assert.match(h.toasts.at(-1).title, /新鲜/);
  assert.equal(h.sent.length, 0);
});
test('opted-in trace distinguishes blocked start from sent start and receive timeout', async () => {
  const h = harness(),
    events = [];
  h.page.diagnostics = { record: (event, details) => events.push([event, details]) };
  h.page.currentFrame = null;
  await h.page.start();
  assert.deepEqual(
    events.map(([event]) => event),
    ['start_requested', 'gate_blocked'],
  );
  assert.deepEqual(h.sent, []);
  h.page.receive({ shots: 0, hits: 0, seconds: 0, mode: 0 });
  await h.page.start();
  assert.deepEqual(events.map(([event]) => event).slice(-3), [
    'start_requested',
    'gate_ok',
    'gate_ok',
  ]);
  h.page.frameAt = Date.now() - 4000;
  [...h.intervals.values()][0]();
  assert.equal(events.at(-1)[0], 'receive_timeout');
  assert.deepEqual(h.sent, ['Turn-on', 'Turn-off']);
});
test('navigation, hide and unload dismiss transient notices', async () => {
  const h = harness();
  h.page.ble.ready = false;
  await h.page.start();
  const hidden = h.hiddenToasts();
  h.page.switchTab({ currentTarget: { dataset: { id: 'stats' } } });
  assert.equal(h.hiddenToasts(), hidden + 1);
  h.page.notify('请连接发球机');
  h.page.onHide();
  assert.equal(h.hiddenToasts(), hidden + 2);
  const shown = h.toasts.length;
  h.page.notify('后台迟到的失败回调');
  assert.equal(h.toasts.length, shown);
  h.page.ble.dispose = () => {};
  h.page.onUnload();
  assert.equal(h.hiddenToasts(), hidden + 3);
  h.page.notify('卸载后的失败回调');
  assert.equal(h.toasts.length, shown);
});
test('draft write failure is notified once until storage recovers', async () => {
  const h = harness(undefined, { account: true });
  await h.page.start();
  const write = h.wx.setStorageSync;
  h.wx.setStorageSync = () => {
    throw Error('full');
  };
  const shown = h.toasts.length;
  h.page.checkpoint();
  h.page.checkpoint();
  h.page.checkpoint();
  assert.equal(h.toasts.length, shown + 1);
  assert.match(h.toasts.at(-1).title, /草稿存储失败/);
  h.wx.setStorageSync = write;
  h.page.checkpoint();
  h.wx.setStorageSync = () => {
    throw Error('full again');
  };
  h.page.checkpoint();
  assert.equal(h.toasts.length, shown + 2);
});
test('critical machine safety remains in training status rather than a transient banner', () => {
  const h = harness();
  h.page.interrupt('蓝牙断开，请现场停止设备并核对最终数据。');
  assert.equal(h.page.data.state, 'interrupted');
  assert.match(h.page.data.status, /蓝牙断开.*现场停止设备/);
  assert.equal(Object.hasOwn(h.page.data, 'error'), false);
});
test('connected signal polling uses real RSSI and pauses on hide then resumes on show', async () => {
  const h = harness();
  h.wx.getBLEDeviceRSSI = () => {};
  let reading = -55;
  h.page.ble.readSignal = async () => reading;
  h.page.setData({ connected: true, deviceName: '真实设备' });
  h.page.startSignalPolling();
  await new Promise(setImmediate);
  assert.equal(h.intervals.size, 1);
  assert.equal(h.delays.get(h.page.signalTimer), 10000);
  assert.equal(h.page.data.signalDbm, -55);
  assert.equal(h.page.data.signalLevel, 3);
  for (const [rssi, level] of [
    [-65, 3],
    [-66, 2],
    [-80, 2],
    [-81, 1],
    [null, 0],
  ]) {
    reading = rssi;
    await h.intervals.get(h.page.signalTimer)();
    assert.equal(h.page.data.signalDbm, rssi);
    assert.equal(h.page.data.signalLevel, level);
  }
  h.page.onHide();
  assert.equal(h.intervals.size, 0);
  assert.equal(h.page.data.signalDbm, null);
  reading = -72;
  h.page.onShow();
  await new Promise(setImmediate);
  assert.equal(h.intervals.size, 1);
  assert.equal(h.page.data.signalDbm, -72);
  assert.equal(h.page.data.signalLevel, 2);
  h.page.ble.dispose = () => {};
  h.page.onUnload();
  assert.equal(h.intervals.size, 0);
  assert.equal(h.sent.length, 0);
});
test('optional signal failure does not disconnect or produce repeated error toasts', async () => {
  const h = harness();
  h.wx.getBLEDeviceRSSI = () => {};
  h.page.ble.readSignal = async () => {
    throw Error('RSSI unavailable');
  };
  h.page.setData({ connected: true });
  h.page.startSignalPolling();
  await new Promise(setImmediate);
  assert.equal(h.page.data.connected, true);
  assert.equal(h.page.data.signalDbm, null);
  assert.equal(h.page.data.signalLabel, '信号暂不可用');
  assert.equal(h.toasts.length, 0);
  await h.page.disconnect();
  assert.equal(h.intervals.size, 0);
  assert.equal(h.page.data.connected, false);
});
test('unsupported RSSI has an honest fallback and no polling timer', async () => {
  const h = harness();
  h.page.setData({ connected: true });
  h.page.startSignalPolling();
  await new Promise(setImmediate);
  assert.equal(h.page.data.signalDbm, null);
  assert.equal(h.page.data.signalLabel, '信号暂不可用');
  assert.equal(h.intervals.size, 0);
});
test('pending RSSI calls do not overlap or overwrite state after disconnect', async () => {
  const h = harness();
  h.wx.getBLEDeviceRSSI = () => {};
  let complete,
    reads = 0;
  h.page.ble.readSignal = () => {
    reads++;
    return new Promise((resolve) => (complete = resolve));
  };
  h.page.setData({ connected: true });
  h.page.startSignalPolling();
  const tick = h.intervals.get(h.page.signalTimer);
  await tick();
  await tick();
  assert.equal(reads, 1);
  h.page.stopSignalPolling();
  h.page.setData({ connected: false });
  complete(-50);
  await new Promise(setImmediate);
  assert.equal(h.page.data.signalDbm, null);
  assert.equal(h.intervals.size, 0);
});
test('real free mode refuses undocumented reset', async () => {
  const h = harness();
  h.page.setData({ demo: false });
  h.page.currentFrame = { mode: 2 };
  h.page.frameAt = Date.now();
  await h.page.start();
  assert.match(h.toasts.at(-1).title, /自由模式/);
  assert.equal(h.sent.length, 0);
});
test('connection lost while confirming safety never sends a start command', async () => {
  const h = harness();
  h.wx.showModal = async () => {
    h.page.ble.ready = false;
    return { confirm: true };
  };
  await h.page.start();
  assert.equal(h.page.data.state, 'idle');
  assert.equal(h.sent.length, 0);
  assert.equal(h.storage.has('courtside.draft.v1'), false);
  assert.match(h.toasts.at(-1).title, /连接发球机/);
});
test('telemetry becoming stale during confirmation never starts hardware', async () => {
  const h = harness();
  h.wx.showModal = async () => {
    h.page.frameAt = Date.now() - 5000;
    return { confirm: true };
  };
  await h.page.start();
  assert.equal(h.sent.length, 0);
  assert.match(h.toasts.at(-1).title, /新鲜/);
});
test('failed setup write is never replayed and never followed by Turn-on', async () => {
  const h = harness();
  h.page.setData({ demo: false, mode: 'count' });
  h.page.currentFrame = { mode: 0 };
  h.page.frameAt = Date.now();
  h.page.ble.send = async (c) => {
    h.sent.push(c);
    throw Error('timeout');
  };
  await h.page.start();
  assert.deepEqual(h.sent, ['SET2#100#']);
  assert.equal(h.page.data.state, 'interrupted');
  await h.page.start();
  assert.equal(h.sent.length, 1);
});
test('real command order and explicit user-confirmed save', async () => {
  const h = harness(undefined, { account: true });
  h.page.setData({ demo: false, mode: 'time' });
  h.page.currentFrame = { mode: 0 };
  h.page.frameAt = Date.now();
  await h.page.start();
  h.page.receive({ shots: 2, hits: 1, seconds: 6, mode: 1, target: 600 });
  await h.page.finish();
  assert.deepEqual(h.sent, ['SET1#600#', 'Turn-on', 'Turn-off']);
  assert.equal(h.page.data.records[0].verifiedByUser, true);
});
test('background transition stops once, preserves draft, never auto-resumes', async () => {
  const h = harness(undefined, { account: true });
  h.page.setData({ demo: false });
  h.page.currentFrame = { mode: 0 };
  h.page.frameAt = Date.now();
  await h.page.start();
  h.page.onHide();
  h.page.onHide();
  assert.deepEqual(h.sent, ['Turn-on', 'Turn-off']);
  assert.equal(h.page.data.state, 'interrupted');
  assert.equal(h.intervals.size, 0);
  assert.ok(h.storage.has(`courtside.account.${accountId}.draft.v1`));
});
test('background during setup never issues a late Turn-on', async () => {
  const h = harness();
  h.page.setData({ demo: false, mode: 'time' });
  h.page.currentFrame = { mode: 0 };
  h.page.frameAt = Date.now();
  let resolveWrite, entered;
  const setupEntered = new Promise((resolve) => (entered = resolve));
  h.page.ble.send = async (c) => {
    h.sent.push(c);
    if (c.startsWith('SET'))
      await new Promise((resolve) => {
        resolveWrite = resolve;
        entered();
      });
  };
  const pending = h.page.start();
  await setupEntered;
  h.page.onHide();
  resolveWrite();
  await pending;
  assert.deepEqual(h.sent, ['SET1#600#', 'Turn-off']);
  assert.equal(h.page.data.state, 'interrupted');
});
test('cancel save retains draft and review state', async () => {
  const h = harness(undefined, { account: true });
  await h.page.start();
  h.wx.showModal = async () => ({ confirm: false });
  await h.page.finish();
  assert.equal(h.page.data.state, 'review');
  assert.equal(h.page.data.records.length, 0);
  assert.ok(h.storage.has(`courtside.account.${accountId}.draft.v1`));
});
test('discard removes only unsaved draft, no replay or history loss', async () => {
  const h = harness(undefined, { account: true });
  await h.page.start();
  await h.page.finish();
  await h.page.start();
  h.page.onHide();
  await h.page.discard();
  assert.equal(h.page.data.state, 'idle');
  assert.equal(h.page.data.records.length, 1);
  assert.equal(h.storage.has(`courtside.account.${accountId}.draft.v1`), false);
  assert.deepEqual(h.sent, ['Turn-on', 'Turn-off', 'Turn-on', 'Turn-off']);
});
test('failed persistence never reports completed save', async () => {
  const h = harness(undefined, { account: true });
  await h.page.start();
  h.wx.setStorageSync = () => {
    throw Error('disk full');
  };
  await h.page.finish();
  assert.equal(h.page.data.state, 'review');
  assert.match(h.toasts.at(-1).title, /disk full/);
});
test('recovered account draft requires review without any command send', () => {
  const h = harness(
    {
      id: 'draft',
      source: 'ble',
      mode: 'free',
      shots: 3,
      hits: 2,
      seconds: 9,
      endedAt: Date.now(),
    },
    { account: true },
  );
  assert.equal(h.page.data.state, 'interrupted');
  assert.equal(h.sent.length, 0);
  assert.equal(h.page.data.shots, 3);
});
test('legacy simulated drafts and records never become production training', () => {
  const legacy = {
    id: 'old',
    source: 'demo',
    mode: 'free',
    shots: 90,
    hits: 60,
    seconds: 120,
    endedAt: Date.now(),
  };
  const h = harness(legacy);
  h.storage.set('courtside.records.v1', [legacy]);
  h.page.refresh();
  assert.equal(h.page.data.records.length, 0);
  assert.equal(h.page.data.total.shots, 0);
  assert.equal(h.page.data.state, 'idle');
  assert.equal(h.page.data.shots, 0);
  assert.deepEqual(h.storage.get('courtside.draft.v1'), legacy);
});
test('legacy guest records and draft remain intact but do not enter single-use views', async () => {
  const old = {
    id: 'legacy-ble',
    source: 'ble',
    mode: 'free',
    shots: 4,
    hits: 3,
    seconds: 10,
    endedAt: Date.now(),
    verifiedByUser: true,
  };
  const h = harness(old);
  h.storage.set('courtside.records.v1', [old]);
  h.page.refresh();
  h.page.refreshAccount();
  assert.equal(h.page.data.records.length, 0);
  assert.equal(h.page.data.guestCount, 1);
  assert.equal(h.page.data.state, 'idle');
  await h.page.start();
  h.page.receive({ shots: 2, hits: 1, seconds: 6, mode: 0 });
  h.page.onHide();
  assert.deepEqual(h.storage.get('courtside.draft.v1'), old);
  h.page.onShow();
  await h.page.confirmSave();
  assert.equal(h.page.data.records[0].shots, 2);
  assert.deepEqual(h.storage.get('courtside.records.v1'), [old]);
  h.page.ble.dispose = () => {};
  h.page.onUnload();
  assert.equal(h.storage.has('courtside.records.v1'), true);
});
test('guest result disappears on next training or account switch without cloud requests', async () => {
  const h = harness();
  h.wx.cloud = {
    Cloud: class {
      constructor() {
        throw Error('guest must not connect cloud');
      }
    },
  };
  await h.page.start();
  h.page.receive({ shots: 3, hits: 2, seconds: 7, mode: 0 });
  await h.page.finish();
  assert.equal(h.page.data.records.length, 1);
  assert.equal(h.storage.has('courtside.records.v1'), false);
  await h.page.start();
  assert.equal(h.page.data.records.length, 0);
  h.page.onHide();
  await h.page.discard();
  assert.equal(h.storage.has('courtside.draft.v1'), false);
  h.page.restoreAccountDraft();
  assert.equal(h.page.guestSession, null);
});
test('confirmed guest result clears when leaving the mini program without touching storage', async () => {
  const h = harness();
  await h.page.start();
  h.page.receive({ shots: 3, hits: 2, seconds: 7, mode: 0 });
  await h.page.finish();
  assert.equal(h.page.data.records.length, 1);
  h.page.onHide();
  assert.equal(h.page.data.records.length, 0);
  assert.equal(h.storage.has('courtside.records.v1'), false);
  assert.equal(h.storage.has('courtside.draft.v1'), false);
  h.page.onShow();
  assert.equal(h.page.data.total.sessions, 0);
  assert.equal(h.page.data.shots, 0);
});
test('all WXML event handlers exist and dynamic conditionals use bindings', () => {
  const h = harness();
  const wxml = fs.readFileSync(filename.replace('.js', '.wxml'), 'utf8');
  for (const match of wxml.matchAll(/bind\w+="(\w+)"/g))
    assert.equal(typeof h.page[match[1]], 'function', match[1]);
  for (const match of wxml.matchAll(/(?:wx:if|disabled)="([^"]+)"/g))
    assert.ok(match[1].startsWith('{{'), match[0]);
});
test('native navigation title follows the selected tab', () => {
  const h = harness();
  const titles = [];
  h.wx.setNavigationBarTitle = ({ title }) => titles.push(title);
  for (const id of ['home', 'rank', 'stats', 'profile'])
    h.page.switchTab({ currentTarget: { dataset: { id } } });
  assert.deepEqual(titles, ['首页', '排行榜', '训练数据', '我的']);
  assert.equal(h.sent.length, 0);
});
