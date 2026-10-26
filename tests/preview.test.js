// Isolated DOM evaluation, not a browser, no network, no layout claims.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML, DOMParser } = require('linkedom');
const { execFileSync } = require('node:child_process');
execFileSync(process.execPath, [path.join(__dirname, '../scripts/build-preview.js')]);
const html = fs.readFileSync(path.join(__dirname, '../preview/index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
function harness() {
  const { window, document } = parseHTML(html.replace(/<script>[\s\S]*<\/script>/, ''));
  const storage = new Map(),
    intervals = new Map(),
    timeouts = new Map(),
    errors = [];
  let id = 0;
  const localStorage = {
    getItem: (k) => storage.get(k),
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  };
  window.scrollTo = () => {};
  const dialog = document.getElementById('dialog');
  dialog.showModal = () => dialog.setAttribute('open', '');
  dialog.close = () => dialog.removeAttribute('open');
  vm.runInNewContext(script, {
    window,
    document,
    DOMParser,
    localStorage,
    queueMicrotask: (fn) => fn(),
    setInterval: (fn) => {
      intervals.set(++id, fn);
      return id;
    },
    clearInterval: (n) => intervals.delete(n),
    setTimeout: (fn, duration) => {
      timeouts.set(++id, { fn, duration });
      return id;
    },
    clearTimeout: (n) => timeouts.delete(n),
    console: { log: () => {}, error: (...a) => errors.push(a) },
  });
  const click = (selector) => {
    const el = document.querySelector(selector);
    assert.ok(el, selector);
    el.click();
  };
  return { window, document, click, intervals, timeouts, errors, page: window.__courtside.page };
}
const flush = () => new Promise(setImmediate);
test('native template parses and initial preview has actual values, no binding leaks', () => {
  const h = harness();
  const root = h.document.getElementById('root');
  assert.match(root.textContent, /未连接设备/);
  assert.match(root.textContent, /训练数据/);
  assert.match(root.textContent, /0.0%/);
  assert.doesNotMatch(root.textContent, /\{\{|undefined|NaN/);
  assert.equal(h.document.querySelector('.start-button').disabled, false);
  assert.equal(h.errors.length, 0, String(h.errors[0]));
});
test('four tabs show only their own conditional panel', () => {
  const h = harness();
  for (const [id, expected] of [
    ['rank', '个人训练榜'],
    ['stats', '努力的轨迹'],
    ['profile', '爱冠篮'],
    ['home', '训练模式'],
  ]) {
    h.click(`.nav-item[data-id="${id}"]`);
    assert.match(h.document.getElementById('root').textContent, new RegExp(expected));
    assert.equal(h.document.querySelectorAll('.page').length, 1);
  }
  assert.equal(h.errors.length, 0, String(h.errors[0]));
});
test('mode selection and target input update native controller', () => {
  const h = harness();
  h.click('.mode-row[data-id="time"]');
  const input = h.document.querySelector('input[data-field="targetTime"]');
  assert.ok(input);
  input.value = '5';
  input.dispatchEvent(new h.window.Event('input'));
  assert.equal(h.page.data.targetTime, '5');
  assert.equal(h.document.querySelectorAll('.mode-row.selected').length, 1);
  assert.equal(h.errors.length, 0);
});
test('device telemetry, explicit save, rank and chart share real records', async () => {
  const h = harness();
  h.page.ble.ready = true;
  h.page.ble.send = async () => {};
  h.page.receive({ shots: 0, hits: 0, seconds: 0, mode: 0 });
  h.click('.start-button');
  await flush();
  h.click('#dialog-confirm');
  await flush();
  assert.equal(h.page.data.state, 'running');
  h.page.receive({ shots: 2, hits: 1, seconds: 6, mode: 0 });
  h.click('.secondary');
  await flush();
  assert.ok(h.document.getElementById('dialog').hasAttribute('open'));
  h.click('#dialog-confirm');
  await flush();
  assert.equal(h.page.data.state, 'idle');
  assert.equal(h.page.data.records.length, 1);
  h.click('.nav-item[data-id="rank"]');
  assert.equal(h.document.querySelectorAll('.rank-row').length, 1);
  h.click('.nav-item[data-id="stats"]');
  assert.equal(h.document.querySelectorAll('.chart-empty').length, 0);
  assert.ok(h.document.querySelector('.calendar-day.trained'));
  assert.equal(h.errors.length, 0);
});
test('no simulated mode or generated scores in any shipped page', async () => {
  const h = harness();
  for (const tab of ['home', 'rank', 'stats', 'profile']) {
    h.click(`.nav-item[data-id="${tab}"]`);
    assert.doesNotMatch(h.document.getElementById('root').textContent, /演示|模拟|体验版/);
  }
  h.click('.nav-item[data-id="home"]');
  h.click('.start-button');
  await flush();
  assert.equal(h.page.data.state, 'idle');
  assert.equal(h.intervals.size, 0);
  assert.equal(h.page.data.shots, 0);
  const toast = h.document.getElementById('toast');
  assert.match(toast.textContent, /蓝牙未连接.*无法开始训练/);
  assert.equal(toast.style.display, 'block');
  assert.equal(h.document.querySelector('.error-banner'), null);
  assert.equal(h.timeouts.size, 1);
  const timeout = [...h.timeouts.values()][0];
  assert.equal(timeout.duration, 3000);
  timeout.fn();
  assert.equal(toast.style.display, 'none');
  assert.equal(h.timeouts.size, 0);
});
test('preview BLE explicitly refuses hardware, close leaves UI usable', async () => {
  const h = harness();
  h.click('.device-card button');
  await flush();
  assert.ok(h.document.querySelector('.device-sheet'));
  assert.match(h.document.getElementById('toast').textContent, /未完成隐私授权/);
  h.click('.close-button');
  assert.equal(h.document.querySelector('.device-sheet'), null);
  assert.equal(h.page.data.busy, false);
  assert.equal(h.document.getElementById('toast').style.display, 'none');
  assert.equal(h.timeouts.size, 0);
});
test('repeated toast replaces its timer and navigation dismisses it', () => {
  const h = harness();
  h.page.notify('第一条提示');
  const first = [...h.timeouts.keys()][0];
  h.page.notify('第二条提示');
  assert.equal(h.timeouts.size, 1);
  assert.equal(h.timeouts.has(first), false);
  assert.equal(h.document.getElementById('toast').textContent, '第二条提示');
  h.click('.nav-item[data-id="stats"]');
  assert.equal(h.document.getElementById('toast').style.display, 'none');
  assert.equal(h.timeouts.size, 0);
});
test('device action shares capsule styling and connection state has text, pulse and real signal', () => {
  const h = harness();
  assert.ok(h.document.querySelector('.device-connect.capsule-button .capsule-face'));
  assert.equal(h.document.querySelector('.connection-label').textContent, '未连接');
  assert.equal(h.document.querySelector('.connection-dot.is-connected'), null);
  assert.equal(h.document.querySelector('.signal-copy'), null);
  h.page.setData({
    connected: true,
    deviceName: '发球机 V2',
    signalDbm: -62,
    signalLevel: 3,
    signalLabel: '信号良好',
  });
  assert.equal(h.document.querySelector('.device-title').textContent, '发球机 V2');
  assert.equal(h.document.querySelector('.connection-label.is-connected').textContent, '已连接');
  assert.ok(h.document.querySelector('.connection-dot.is-connected'));
  assert.match(h.document.querySelector('.signal-copy').textContent, /信号良好.*-62 dBm/);
  assert.equal(h.document.querySelectorAll('.signal-bars .lit').length, 3);
  h.page.setData({ signalDbm: null, signalLevel: 0, signalLabel: '信号暂不可用' });
  assert.equal(h.document.querySelector('.signal-copy').textContent, '信号暂不可用');
  assert.equal(h.document.querySelectorAll('.signal-bars .lit').length, 0);
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/app.wxss'), 'utf8');
  assert.match(css, /animation:\s*connection-breathe 2\.4s/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(css, /\.device-card \.compact/);
});
test('home and profile use the same device template in every connection state', () => {
  const h = harness();
  for (const connected of [false, true]) {
    h.page.setData({
      connected,
      deviceName: '测试长名称发球机',
      signalDbm: -77,
      signalLevel: 2,
      signalLabel: '信号一般',
    });
    h.click('.nav-item[data-id="home"]');
    const home = h.document.querySelector('.device-card').outerHTML;
    h.click('.nav-item[data-id="profile"]');
    assert.equal(h.document.querySelector('.device-card').outerHTML, home);
    assert.equal(h.document.querySelectorAll('.device-connect').length, 1);
    assert.equal(h.errors.length, 0);
  }
});
test('help has a small visual face with an accessible button and profile uses GPT basketball', () => {
  const h = harness();
  h.click('.nav-item[data-id="rank"]');
  assert.equal(h.document.querySelector('.help-face').textContent, '?');
  assert.equal(
    h.document.querySelector('.help-button').getAttribute('aria-label'),
    '连接和安全帮助',
  );
  h.click('.nav-item[data-id="profile"]');
  assert.match(h.document.querySelector('.manifesto-ball').getAttribute('src'), /^data:image\/png/);
  assert.equal(h.document.querySelector('.small-ball'), null);
  assert.doesNotMatch(h.document.querySelector('.manifesto').textContent, /[<>]/);
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/app.wxss'), 'utf8');
  assert.match(css, /\.help-face\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px/);
  assert.match(css, /\.app-shell \.help-button\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/);
});
test('data explanation is readable, links the official contract and can be dismissed', () => {
  const h = harness();
  h.click('.nav-item[data-id="profile"]');
  h.click('.setting-row:last-child');
  assert.equal(h.document.querySelectorAll('.data-section').length, 7);
  assert.match(h.document.querySelector('.data-sheet').textContent, /正式.*隐私保护指引/);
  h.click('.data-sheet .close-button');
  assert.equal(h.document.querySelector('.data-sheet'), null);
});
test('screen panel reflects data and returns without losing main state', () => {
  const h = harness();
  h.click('.screen-entry');
  assert.ok(h.document.querySelector('.fullscreen-panel'));
  assert.match(h.document.querySelector('.big-rate').textContent, /0.0%/);
  h.click('.screen-top button');
  assert.equal(h.document.querySelector('.fullscreen-panel'), null);
  assert.equal(h.page.data.state, 'idle');
});
test('calendar month navigation and metric selection rerender without errors', () => {
  const h = harness();
  h.click('.nav-item[data-id="stats"]');
  const month = h.page.data.calendarMonth;
  h.click('.calendar-heading button[data-step="-1"]');
  assert.equal(h.page.data.calendarMonth, (month + 11) % 12);
  h.click('.chart-tabs button[data-id="rate"]');
  assert.equal(h.page.data.chartMax, 100);
  assert.equal(h.errors.length, 0);
});
test('compact time capsules keep labels and selection semantics through filter changes', () => {
  const h = harness();
  h.click('.nav-item[data-id="stats"]');
  assert.equal(h.document.querySelectorAll('.range-pill').length, 3);
  h.click('.range-button[data-value="30"]');
  assert.equal(h.page.data.days, 30);
  assert.equal(h.document.querySelectorAll('.range-button.active').length, 1);
  assert.equal(
    h.document.querySelector('.range-button.active').getAttribute('aria-pressed'),
    'true',
  );
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/app.wxss'), 'utf8');
  assert.match(css, /--capsule-height:\s*30px/);
  assert.match(css, /--capsule-hit-height:\s*44px/);
  assert.match(css, /\.capsule-face\s*\{[^}]*align-items:\s*center;[^}]*justify-content:\s*center/);
  assert.match(css, /button\.capsule-button:not\([^}]+height:\s*var\(--capsule-hit-height\)/);
});
test('rank, time, chart and appearance share the same capsule anatomy and selected state', () => {
  const h = harness();
  for (const [tab, groups] of [
    ['rank', 2],
    ['stats', 2],
    ['profile', 1],
  ]) {
    h.click(`.nav-item[data-id="${tab}"]`);
    assert.equal(h.document.querySelectorAll('.capsule-group').length, groups);
    for (const group of h.document.querySelectorAll('.capsule-group')) {
      for (const button of group.querySelectorAll('button')) {
        assert.ok(button.classList.contains('capsule-button'));
        assert.equal(button.querySelectorAll('.capsule-face').length, 1);
        assert.ok(button.getAttribute('aria-pressed') !== null);
      }
      assert.equal(group.querySelectorAll('[aria-pressed="true"]').length, 1);
    }
  }
});
test('chart height binding is finite CSS and empty duration axis is nonzero', () => {
  const h = harness();
  h.click('.nav-item[data-id="stats"]');
  h.click('.chart-tabs button[data-id="seconds"]');
  assert.equal(h.page.data.chartMax, 1);
  for (const bar of h.document.querySelectorAll('.bar'))
    assert.equal(bar.getAttribute('style'), 'height: 0%;');
  assert.equal(h.errors.length, 0);
});
test('appearance choices update all native template roots without changing data', () => {
  const h = harness();
  h.click('.nav-item[data-id="profile"]');
  h.click('.theme-choice[data-id="dark"]');
  assert.ok(h.document.querySelector('.app-shell.theme-dark'));
  h.click('.theme-choice[data-id="light"]');
  assert.ok(h.document.querySelector('.app-shell.theme-light'));
  assert.equal(h.document.querySelectorAll('.theme-choice.active').length, 1);
  assert.equal(h.page.data.records.length, 0);
  assert.equal(h.errors.length, 0);
});
test('shipped preview and native assets are embedded, no CDN or fetch', () => {
  const h = harness();
  for (const img of h.document.querySelectorAll('#root img'))
    assert.match(img.getAttribute('src'), /^data:image\//);
  assert.doesNotMatch(script, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
});
test('mode fields stay beside their mode selectors and lock during training', async () => {
  const h = harness();
  assert.equal(h.document.querySelectorAll('.mode-option').length, 3);
  assert.equal(h.document.querySelectorAll('.mode-option input').length, 2);
  assert.equal(h.document.querySelector('.target-setting'), null);
  h.click('.mode-row[data-id="count"]');
  assert.equal(h.page.data.mode, 'count');
  assert.ok(h.document.querySelector('.mode-option.selected input[data-field="targetCount"]'));
  h.page.ble.ready = true;
  h.page.ble.send = async () => {};
  h.page.receive({ shots: 0, hits: 0, seconds: 0, mode: 0 });
  h.click('.start-button');
  await flush();
  h.click('#dialog-confirm');
  await flush();
  for (const el of h.document.querySelectorAll('.mode-option button,.mode-option input'))
    assert.equal(el.disabled, true);
  assert.equal(h.errors.length, 0);
});
test('preview translates native type selectors without breaking CSS properties', () => {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.session-metrics\s*>\s*div/);
  assert.match(css, /\.metric-number\s*>\s*span/);
  assert.match(css, /text-align:\s*center/);
  assert.match(css, /\.phone\s*\{\s*--bg:/);
  assert.doesNotMatch(css, />view\b|>text\b|(?<![-\w.])page\s*\{/);
});
test('native layout guards v2 button defaults and bottom safe area', () => {
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/app.wxss'), 'utf8');
  assert.match(css, /button:not\(\[size='mini'\]\)/);
  assert.match(css, /\.app-shell \.screen-entry\s*\{[^}]*width:\s*100%/);
  assert.match(css, /\.app-shell \.nav-item\s*\{[^}]*flex:\s*1;[^}]*width:\s*auto/);
  assert.match(css, /padding-bottom:\s*calc\(152rpx \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /@media \(max-width:\s*350px\)/);
});
test('login sheet has unchecked consent, real native phone entry and no browser fake login', async () => {
  const h = harness();
  h.click('.nav-item[data-id="profile"]');
  h.click('.account-entry');
  await flush();
  assert.ok(h.document.querySelector('.account-sheet'));
  assert.equal(h.document.querySelector('.consent-toggle').getAttribute('aria-checked'), 'false');
  assert.equal(h.document.querySelector('.account-primary').disabled, true);
  assert.equal(h.document.querySelector('#login-phone'), null);
  h.click('.account-tabs [data-view="password"]');
  assert.ok(h.document.querySelector('#login-phone'));
  assert.equal(h.document.querySelector('#login-password').type, 'password');
  h.click('.account-text-button');
  assert.equal(h.document.querySelector('#login-password').type, 'text');
  h.click('.consent-toggle');
  h.click('.account-primary');
  await flush();
  assert.equal(h.page.data.accountUser, null);
  assert.match(h.document.getElementById('toast').textContent, /尚未部署/);
  h.click('.account-links button:last-child');
  assert.ok(h.document.querySelector('.data-sheet:not(.account-sheet)'));
  assert.equal(h.errors.length, 0, String(h.errors[0]));
});
test('account security and reset branches are exclusive and credentials clear on hide', () => {
  const h = harness();
  h.page.setData({
    accountSheet: true,
    accountView: 'security',
    accountUser: {
      id: '00000000-0000-4000-8000-000000000001',
      nickname: '验收账号',
      hasPassword: true,
      phoneMasked: '138****0000',
    },
    phoneEnabled: true,
  });
  assert.equal(h.document.querySelector('#login-phone'), null);
  assert.equal(h.document.querySelector('#new-password'), null);
  assert.match(h.document.querySelector('.account-sheet').textContent, /修改登录密码/);
  h.click('[data-view="reset"]');
  assert.equal(h.document.querySelector('#new-password'), null);
  const native = h.document.querySelector('[open-type="getPhoneNumber"]');
  assert.equal(native.getAttribute('bindgetphonenumber'), null);
  assert.match(native.textContent, /先授权/);
  h.page.authorizeResetPhone({ detail: { code: 'native-test-code' } });
  assert.ok(h.document.querySelector('#new-password'));
  assert.equal(h.document.querySelector('[open-type="getPhoneNumber"]'), null);
  h.page.setData({ newPassword: 'Password12345', phoneInput: '13800000000' });
  h.page.onHide();
  assert.equal(h.page.data.newPassword, '');
  assert.equal(h.page.data.phoneInput, '');
  assert.equal(h.page.resetPhoneCode, null);
  assert.equal(h.errors.length, 0, String(h.errors[0]));
});
