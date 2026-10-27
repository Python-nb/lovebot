const test = require('node:test');
const assert = require('node:assert/strict');
const { AccountClient, SESSION_KEY, CONSENT_VERSION } = require('../miniprogram/lib/account');
const PageAccount = require('../miniprogram/lib/account-page');
const R = require('../miniprogram/lib/records');
const user = {
  id: '00000000-0000-4000-8000-000000000001',
  nickname: '训练者',
  phoneMasked: '',
  hasPassword: false,
};
const session = (id = user.id) => ({
  token: 'a'.repeat(64),
  expiresAt: Date.now() + 3600000,
  user: { ...user, id },
});
const row = (id) => ({
  id,
  source: 'ble',
  mode: 'free',
  shots: 5,
  hits: 3,
  seconds: 10,
  endedAt: Date.now(),
  verifiedByUser: true,
});
const enabled = { enabled: true, env: 'test-env', service: 'test-service' };
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function fixture(handler = async () => ({ ok: true }), options = enabled) {
  const storage = new Map(),
    calls = [];
  let loginCalls = 0;
  const api = {
    getStorageSync: (key) => structuredClone(storage.get(key)),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key) => storage.delete(key),
    login: (o) => {
      loginCalls++;
      o.success({ code: 'single-use-test-code' });
    },
    cloud: {
      Cloud: class {
        async init() {}
        async callContainer(o) {
          calls.push(o);
          return { statusCode: 200, data: await handler(o) };
        }
      },
    },
  };
  return {
    api,
    storage,
    calls,
    client: new AccountClient(api, options),
    loginCalls: () => loginCalls,
  };
}
test('real WeChat exchange requires consent and backend response before establishing session', async () => {
  const gate = deferred();
  const h = fixture(async () => gate.promise);
  await assert.rejects(h.client.wechatLogin(false), /同意/);
  assert.equal(h.loginCalls(), 0);
  const pending = h.client.wechatLogin(true);
  await new Promise(setImmediate);
  assert.equal(h.client.user, null);
  assert.equal(h.storage.has(SESSION_KEY), false);
  assert.equal(h.calls[0].path, '/v1/auth/wechat');
  assert.equal(h.calls[0].data.code, 'single-use-test-code');
  assert.equal(h.calls[0].data.consentVersion, CONSENT_VERSION);
  gate.resolve(session());
  await pending;
  assert.equal(h.client.user.id, user.id);
  assert.equal(h.calls[0].header.Authorization, undefined);
});
test('disabled configuration, missing WeChat API and invalid login never fake success', async () => {
  const h = fixture(undefined, { enabled: false });
  await assert.rejects(h.client.wechatLogin(true), /尚未开放/);
  assert.equal(h.loginCalls(), 0);
  assert.equal(h.calls.length, 0);
  const bad = fixture(async () => ({ code: 'not-a-session' }));
  await assert.rejects(bad.client.wechatLogin(true), /响应无效/);
  assert.equal(bad.client.active, false);
  const missing = fixture();
  delete missing.api.cloud;
  await assert.rejects(missing.client.wechatLogin(true), /微信版本/);
});
test('dispose before wx.login callback or transport initialization never sends a late login', async () => {
  const h = fixture(async () => session());
  let success;
  h.api.login = (o) => {
    success = o.success;
  };
  const pending = h.client.wechatLogin(true);
  h.client.dispose();
  success({ code: 'late-code' });
  await assert.rejects(pending, /状态已变化/);
  assert.equal(h.calls.length, 0);
  const second = fixture();
  const gate = deferred();
  second.client.transport = () => gate.promise;
  const req = second.client.capabilities();
  second.client.dispose();
  gate.resolve({
    callContainer: () => {
      throw new Error('must not call');
    },
  });
  await assert.rejects(req, /已取消/);
});
test('disposed in-flight login does not persist its response', async () => {
  const gate = deferred(),
    h = fixture(async () => gate.promise);
  const pending = h.client.wechatLogin(true);
  await new Promise(setImmediate);
  h.client.dispose();
  gate.resolve(session());
  await assert.rejects(pending, /结果已忽略/);
  assert.equal(h.storage.has(SESSION_KEY), false);
});
test('malformed transport, uncertain write and storage failure are not retried or acknowledged', async () => {
  const h = fixture();
  h.client.transport = async () => ({ callContainer: async () => ({ data: session() }) });
  await assert.rejects(h.client.wechatLogin(true), /响应无效/);
  let count = 0;
  h.client.transport = async () => ({
    callContainer: async () => {
      count++;
      throw new Error('network');
    },
  });
  await assert.rejects(h.client.wechatLogin(true), /结果可能已生效/);
  assert.equal(count, 1);
  const fail = fixture(async () => session());
  fail.api.setStorageSync = () => {
    throw new Error('disk full');
  };
  await assert.rejects(fail.client.wechatLogin(true), /保存失败/);
  assert.equal(fail.client.user, null);
});
test('password and raw auth responses are never stored in profile or record cache', async () => {
  const h = fixture(async () => ({
    ...session(),
    session_key: 'upstream-only',
    password: 'never-save',
  }));
  await h.client.passwordLogin('13800000000', 'Password12345', true);
  assert.deepEqual(Object.keys(h.storage.get(SESSION_KEY)).sort(), ['expiresAt', 'token', 'user']);
  assert.doesNotMatch(
    JSON.stringify([...h.storage.values()]),
    /Password12345|never-save|upstream-only|13800000000/,
  );
  assert.equal(h.calls[0].data.password, 'Password12345');
});
test('native phone registration exchanges a fresh wx.login code and stores only the business session', async () => {
  const h = fixture(async () => ({
    ...session(),
    user: { ...user, phoneMasked: '138****0000', hasPassword: true },
  }));
  await assert.rejects(h.client.register('native-code', 'Password12345', false), /同意/);
  assert.equal(h.loginCalls(), 0);
  await h.client.register('native-code', 'Password12345', true);
  assert.equal(h.calls[0].path, '/v1/auth/register');
  assert.deepEqual(h.calls[0].data, {
    code: 'single-use-test-code',
    phoneCode: 'native-code',
    password: 'Password12345',
    consentVersion: CONSENT_VERSION,
  });
  assert.doesNotMatch(JSON.stringify([...h.storage.values()]), /native-code|Password12345/);
});
test('independent username registration and login need no WeChat or phone and never cache password', async () => {
  const h = fixture(async () => ({
    ...session(),
    user: { ...user, username: 'courtplayer', hasPassword: true },
  }));
  await assert.rejects(h.client.usernameRegister('CourtPlayer', 'Password12345', false), /同意/);
  await h.client.usernameRegister('CourtPlayer', 'Password12345', true);
  await h.client.usernameLogin('COURTPLAYER', 'Password12345', true);
  assert.equal(h.loginCalls(), 0);
  assert.equal(h.calls[0].path, '/v1/auth/username/register');
  assert.equal(h.calls[1].path, '/v1/auth/username');
  assert.equal(h.client.user.username, 'courtplayer');
  assert.doesNotMatch(JSON.stringify([...h.storage.values()]), /Password12345|COURTPLAYER/);
});
test('guest, accounts and draft keys remain isolated, even through a previously acquired adapter', () => {
  const h = fixture();
  assert.throws(() => h.client.storage(), /游客训练仅限本次使用/);
  R.save(h.api, row('guest'));
  h.client.persist(session());
  const firstKey = h.client.key(),
    firstDraft = h.client.draftKey(),
    adapter = h.client.storage();
  R.save(adapter, row('first'));
  h.client.persist(session('00000000-0000-4000-8000-000000000002'));
  R.save(h.client.storage(), row('second'));
  assert.equal(R.load(adapter)[0].id, 'first');
  assert.equal(R.load(h.client.storage())[0].id, 'second');
  assert.equal(R.load(h.api)[0].id, 'guest');
  assert.notEqual(h.client.draftKey(), firstDraft);
  assert.deepEqual(h.storage.get(firstKey).pending, ['first']);
});
test('import only copies confirmed guest records on explicit action and preserves source', () => {
  const h = fixture();
  h.storage.set(R.KEY, [row('good'), { ...row('unconfirmed'), verifiedByUser: false }]);
  h.client.persist(session());
  assert.equal(h.client.snapshot().rows.length, 0);
  assert.equal(h.client.importGuest(), 1);
  assert.equal(h.client.importGuest(), 0);
  assert.equal(h.storage.get(R.KEY).length, 2);
  assert.deepEqual(h.client.snapshot().pending, ['good']);
});
test('sync only uploads pending rows; remote deletion never reuploads downloaded cache', async () => {
  let records = [row('downloaded')];
  const h = fixture(async (o) =>
    o.method === 'GET' ? { records, nextCursor: null } : { record: o.data },
  );
  h.client.persist(session());
  R.save(h.client.storage(), row('pending'));
  await h.client.sync();
  assert.equal(h.calls.filter((c) => c.method === 'PUT').length, 1);
  assert.deepEqual(h.client.snapshot().pending, []);
  records = [];
  h.calls.length = 0;
  await h.client.sync();
  assert.equal(h.calls.filter((c) => c.method === 'PUT').length, 0);
  assert.equal(h.client.snapshot().rows.length, 0);
});
test('failed upload, malformed page, loop cursor and concurrent local save preserve cache', async () => {
  const h = fixture(async () => ({ records: [{ broken: true }], nextCursor: null }));
  h.client.persist(session());
  R.save(h.client.storage(), row('keep'));
  const saved = structuredClone(h.client.snapshot());
  await assert.rejects(h.client.sync(), /格式异常/);
  assert.deepEqual(h.client.snapshot(), saved);
  h.client.transport = async () => ({
    callContainer: async () => ({ statusCode: 200, data: { records: [], nextCursor: 'loop' } }),
  });
  await assert.rejects(h.client.sync(), /分页异常/);
  assert.deepEqual(h.client.snapshot(), saved);
  h.client.transport = async () => ({
    callContainer: async (o) => {
      if (o.method === 'GET') R.save(h.client.storage(), row('new'));
      return { statusCode: 200, data: { records: [], nextCursor: null } };
    },
  });
  await assert.rejects(h.client.sync(), /发生变化/);
  assert.equal(h.client.snapshot().rows.length, 2);
});
test('revoked session remains account-scoped, denies new writes and can safely log out', async () => {
  const h = fixture();
  h.client.persist(session());
  R.save(h.client.storage(), row('private'));
  const key = h.client.key();
  h.client.transport = async () => ({
    callContainer: async () => ({
      statusCode: 401,
      data: { error: { code: 'AUTH', message: '登录失效' } },
    }),
  });
  await assert.rejects(h.client.verify(), /失效/);
  assert.equal(h.client.active, false);
  assert.equal(h.client.user.id, user.id);
  assert.equal(h.client.key(), key);
  await h.client.logout();
  assert.equal(h.client.user, null);
  assert.equal(h.storage.get(key).rows[0].id, 'private');
});
test('corrupt cache cannot be overwritten by normal record save', () => {
  const h = fixture();
  h.client.persist(session());
  h.storage.set(h.client.key(), { rows: [row('valuable')], pending: ['absent'] });
  assert.throws(() => R.save(h.client.storage(), row('new')), /记录异常/);
  assert.equal(h.storage.get(h.client.key()).rows[0].id, 'valuable');
});
test('cloud deletion requires explicit server acknowledgement before clearing scoped local data', async () => {
  const h = fixture(async () => ({}));
  h.client.persist(session());
  R.save(h.client.storage(), row('keep'));
  await assert.rejects(h.client.deleteCloudRecords(), /未确认/);
  assert.equal(h.client.snapshot().rows.length, 1);
});
function pageFixture() {
  const notifications = [],
    api = fixture().api;
  api.hideToast = () => {};
  const page = {
    data: { ...PageAccount.initial(), state: 'idle', busy: false },
    foreground: true,
    ...PageAccount.methods(api),
    setData(patch) {
      Object.assign(this.data, patch);
    },
    notify: (value) => notifications.push(value),
    updateNumbers() {},
    refresh() {},
    async task(fn) {
      this.data.busy = true;
      try {
        await fn();
      } catch (error) {
        notifications.push(error.message);
      } finally {
        this.data.busy = false;
      }
    },
  };
  return { page, api, notifications };
}
test('account operations are blocked during running/review/busy without any network call', async () => {
  const { page } = pageFixture();
  for (const state of ['running', 'paused', 'interrupted', 'review']) {
    page.data.state = state;
    await page.openAccount();
    assert.equal(page.data.accountSheet, false);
  }
  page.data.state = 'idle';
  page.data.busy = true;
  assert.equal(page.accountIdle(), false);
});
test('password reset native authorization is separate from password entry and code stays memory-only', async () => {
  const { page } = pageFixture();
  page.data.accountView = 'reset';
  page.authorizeResetPhone({ detail: { code: 'verified-test-code' } });
  assert.equal(page.data.resetPhoneReady, true);
  assert.doesNotMatch(JSON.stringify(page.data), /verified-test-code/);
  page.data.newPassword = page.data.confirmPassword = 'Password12345';
  let received;
  page.account = {
    resetPassword: async (...args) => {
      received = args;
    },
  };
  page.refreshAccount = () => {};
  await page.saveAccountPassword();
  assert.deepEqual(received, ['Password12345', 'verified-test-code']);
  assert.equal(page.data.newPassword, '');
  assert.equal(page.resetPhoneCode, null);
});
test('registration from avatar requires consent and native phone authorization without retaining the code', async () => {
  const { page, api, notifications } = pageFixture();
  api.requirePrivacyAuthorize = ({ success }) => success();
  page.data.accountView = 'register';
  page.data.registerMethod = 'wechat';
  page.data.accountSheet = true;
  page.data.phoneEnabled = true;
  page.data.newPassword = page.data.confirmPassword = 'Password12345';
  let received;
  page.account = {
    assertConfigured() {},
    register: async (...args) => {
      received = args;
    },
    get user() {
      return user;
    },
    get active() {
      return true;
    },
    snapshot: () => ({ pending: [] }),
    draftKey: () => 'account-draft',
  };
  await page.registerWithPhone({ detail: { code: 'phone-one-time' } });
  assert.equal(received, undefined);
  assert.match(notifications.at(-1), /同意/);
  page.data.accountAccepted = true;
  page.data.newPassword = page.data.confirmPassword = 'Password12345';
  await page.registerWithPhone({ detail: { code: 'phone-one-time' } });
  assert.deepEqual(received, ['phone-one-time', 'Password12345', true]);
  assert.doesNotMatch(JSON.stringify(page.data), /phone-one-time|Password12345/);
  assert.equal(page.data.accountView, 'security');
});
test('username form registers only on consent and clears credentials after response', async () => {
  const { page, api, notifications } = pageFixture();
  api.requirePrivacyAuthorize = ({ success }) => success();
  Object.assign(page.data, {
    accountView: 'register',
    registerMethod: 'username',
    accountSheet: true,
    usernameEnabled: true,
    usernameInput: 'CourtPlayer',
    newPassword: 'Password12345',
    confirmPassword: 'Password12345',
  });
  const calls = [];
  page.account = {
    assertConfigured() {},
    usernameRegister: async (...args) => calls.push(['register', ...args]),
    get user() {
      return user;
    },
    get active() {
      return true;
    },
    snapshot: () => ({ pending: [] }),
    draftKey: () => 'account-draft',
  };
  await page.submitUsername();
  assert.equal(calls.length, 0);
  assert.match(notifications.at(-1), /同意/);
  page.data.accountAccepted = true;
  await page.submitUsername();
  assert.deepEqual(calls, [['register', 'CourtPlayer', 'Password12345', true]]);
  assert.equal(page.data.accountView, 'security');
  assert.equal(page.data.usernameInput, '');
  assert.equal(page.data.newPassword, '');
});
test('closing/hiding clears every credential input, authorization code and visibility toggle', () => {
  const { page } = pageFixture();
  Object.assign(page.data, {
    phoneInput: '13800000000',
    loginPassword: 'Password12345',
    currentPassword: 'old',
    newPassword: 'new',
    confirmPassword: 'new',
    showPassword: true,
  });
  page.resetPhoneCode = { code: 'secret' };
  page.closeAccount();
  for (const field of [
    'phoneInput',
    'loginPassword',
    'currentPassword',
    'newPassword',
    'confirmPassword',
  ])
    assert.equal(page.data[field], '');
  assert.equal(page.resetPhoneCode, null);
  assert.equal(page.data.showPassword, false);
});
test('switching identity resets old totals and stale telemetry gate but never starts hardware', () => {
  const { page } = pageFixture();
  page.account = { draftKey: () => 'account-draft' };
  Object.assign(page.data, { shots: 100, hits: 80, seconds: 600 });
  page.frameAt = Date.now();
  page.restoreAccountDraft();
  assert.equal(page.data.shots, 0);
  assert.equal(page.data.seconds, 0);
  assert.equal(page.frameAt, 0);
});
