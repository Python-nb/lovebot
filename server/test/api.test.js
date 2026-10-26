const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp, CONSENT_VERSION } = require('../src/app');
const { MemoryStore } = require('./memory-store');
const S = require('../src/security');
const { createWechat } = require('../src/wechat');
const { config } = require('../src/config');
const password = 'TestingOnly12345';
const phone = '13800000000';
function fixture(options = {}) {
  let time = Date.now();
  const now = () => time;
  const store = new MemoryStore(now);
  const calls = [];
  const wechat = {
    login: async (code) => {
      calls.push('login');
      if (!['wx-a', 'wx-b'].includes(code)) S.fail(400, 'WECHAT_REJECTED', '微信凭证无效');
      return code;
    },
    phone: async (code) => {
      calls.push('phone');
      if (code !== 'verified-phone') S.fail(400, 'PHONE_INVALID', '授权无效');
      return phone;
    },
  };
  const app = createApp({
    store,
    wechat,
    identityKey: Buffer.alloc(32, 7),
    phoneEnabled: true,
    now,
    ...options,
  });
  const login = async (code = 'wx-a') => {
    const r = await request(app)
      .post('/v1/auth/wechat')
      .send({ code, consentVersion: CONSENT_VERSION });
    assert.equal(r.status, 200);
    return r.body;
  };
  const api = (method, path, session, data) =>
    request(app)[method](path).set('Authorization', `Bearer ${session.token}`).send(data);
  return {
    app,
    store,
    calls,
    login,
    api,
    advance: (ms) => {
      time += ms;
    },
  };
}
async function withPassword(f) {
  const s = await f.login();
  assert.equal(
    (await f.api('post', '/v1/account/phone', s, { code: 'verified-phone' })).status,
    200,
  );
  const changed = await f.api('put', '/v1/account/password', s, { password });
  assert.equal(changed.status, 200);
  return changed.body;
}
const row = {
  id: 'session-test-one',
  source: 'ble',
  mode: 'free',
  shots: 20,
  hits: 12,
  seconds: 60,
  endedAt: 1792980000000,
  verifiedByUser: true,
  interrupted: false,
};
test('keyset pagination retains older records despite head insertion/deletion and validates cursor', async () => {
  const f = fixture(),
    s = await f.login();
  for (let i = 0; i < 105; i++) {
    const value = { ...row, id: `r-${String(i).padStart(3, '0')}`, endedAt: row.endedAt - i };
    f.store.rows.set(`${s.user.id}:${value.id}`, value);
  }
  const first = await f.api('get', '/v1/records', s);
  assert.equal(first.body.records.length, 100);
  assert.ok(first.body.nextCursor);
  f.store.rows.delete(`${s.user.id}:r-000`);
  f.store.rows.set(`${s.user.id}:new-head`, { ...row, id: 'new-head', endedAt: row.endedAt + 1 });
  const next = await f.api(
    'get',
    `/v1/records?cursor=${encodeURIComponent(first.body.nextCursor)}`,
    s,
  );
  assert.equal(next.body.records.length, 5);
  assert.equal(next.body.records[0].id, 'r-100');
  assert.equal(next.body.nextCursor, null);
  assert.equal((await f.api('get', '/v1/records?cursor=invalid', s)).status, 400);
});
test('password rotation does not refresh the original WeChat reauthentication timestamp', async () => {
  const f = fixture(),
    s = await withPassword(f);
  f.advance(300001);
  const changed = await f.api('put', '/v1/account/password', s, {
    currentPassword: password,
    password: 'AnotherPassword123',
  });
  assert.equal(changed.status, 200);
  assert.equal(
    (await f.api('delete', '/v1/account', changed.body, { confirm: 'DELETE_ACCOUNT' })).status,
    403,
  );
});
test('WeChat login creates a real server session and repeated same identity maps to one user', async () => {
  const f = fixture(),
    a = await f.login(),
    b = await f.login();
  assert.equal(a.user.id, b.user.id);
  assert.notEqual(a.token, b.token);
  assert.deepEqual(Object.keys(a.user).sort(), ['hasPassword', 'id', 'nickname', 'phoneMasked']);
  assert.equal((await f.api('get', '/v1/me', a)).body.user.id, a.user.id);
  assert.doesNotMatch(JSON.stringify(a), /session_key|openid|wechatKey|passwordHash/);
});
test('missing consent, fake wx code and spoofed identity headers cannot log in', async () => {
  const f = fixture();
  assert.equal((await request(f.app).post('/v1/auth/wechat').send({ code: 'wx-a' })).status, 400);
  assert.equal(
    (
      await request(f.app)
        .post('/v1/auth/wechat')
        .set('X-WX-OPENID', 'wx-a')
        .send({ code: 'fake', consentVersion: CONSENT_VERSION })
    ).status,
    400,
  );
  assert.equal((await request(f.app).get('/v1/me').set('X-WX-OPENID', 'wx-a')).status, 401);
});
test('phone binding needs a fresh WeChat session and a verified code, never a typed phone', async () => {
  const f = fixture(),
    s = await f.login();
  assert.equal((await f.api('post', '/v1/account/phone', s, { phone })).status, 400);
  f.advance(300001);
  assert.equal(
    (await f.api('post', '/v1/account/phone', s, { code: 'verified-phone' })).status,
    403,
  );
});
test('verified phone binds once; collision never merges two WeChat accounts', async () => {
  const f = fixture(),
    a = await f.login(),
    b = await f.login('wx-b');
  const bound = await f.api('post', '/v1/account/phone', a, { code: 'verified-phone' });
  assert.equal(bound.body.user.phoneMasked, '138****0000');
  const collision = await f.api('post', '/v1/account/phone', b, { code: 'verified-phone' });
  assert.equal(collision.status, 409);
  assert.notEqual(
    (await f.api('get', '/v1/me', a)).body.user.id,
    (await f.api('get', '/v1/me', b)).body.user.id,
  );
});
test('first password requires a phone; validated password supports phone login', async () => {
  const f = fixture(),
    s = await f.login();
  assert.equal((await f.api('put', '/v1/account/password', s, { password })).status, 400);
  const changed = await withPassword(f);
  assert.equal((await f.api('get', '/v1/me', s)).status, 401);
  const r = await request(f.app)
    .post('/v1/auth/password')
    .send({ phone, password, consentVersion: CONSENT_VERSION });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.id, changed.user.id);
  assert.equal(r.body.user.hasPassword, true);
});
test('wrong and unknown phone passwords have same generic error and rate limiting', async () => {
  const f = fixture();
  await withPassword(f);
  const attempt = (p) =>
    request(f.app)
      .post('/v1/auth/password')
      .send({ phone: p, password: 'NotCorrect123', consentVersion: CONSENT_VERSION });
  const a = await attempt(phone),
    b = await attempt('13900000000');
  assert.equal(a.status, 401);
  assert.deepEqual(a.body, b.body);
  for (let i = 0; i < 9; i++) await attempt(phone);
  assert.equal((await attempt(phone)).status, 429);
});
test('changing password checks old password and revokes every old session', async () => {
  const f = fixture(),
    s = await withPassword(f),
    another = await f.login();
  assert.equal((await f.api('put', '/v1/account/password', s, { password: 'short' })).status, 400);
  assert.equal(
    (
      await f.api('put', '/v1/account/password', s, {
        password: 'NextTesting1234',
        currentPassword: 'wrong',
      })
    ).status,
    403,
  );
  const changed = await f.api('put', '/v1/account/password', s, {
    password: 'NextTesting1234',
    currentPassword: password,
  });
  assert.equal(changed.status, 200);
  assert.equal((await f.api('get', '/v1/me', s)).status, 401);
  assert.equal((await f.api('get', '/v1/me', another)).status, 401);
  assert.equal((await f.api('get', '/v1/me', changed.body)).status, 200);
});
test('reset requires recent WeChat authentication plus verified bound phone', async () => {
  const f = fixture();
  await withPassword(f);
  const login = await request(f.app)
    .post('/v1/auth/password')
    .send({ phone, password, consentVersion: CONSENT_VERSION });
  assert.equal(
    (
      await f.api('post', '/v1/account/password/reset', login.body, {
        password: 'NewTesting1234',
        code: 'verified-phone',
      })
    ).status,
    403,
  );
  const s = await f.login();
  assert.equal(
    (
      await f.api('post', '/v1/account/password/reset', s, {
        password: 'NewTesting1234',
        code: 'bad',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.api('post', '/v1/account/password/reset', s, {
        password: 'NewTesting1234',
        code: 'verified-phone',
      })
    ).status,
    200,
  );
});
test('records are owner-scoped, idempotent and immutable for the same user and id', async () => {
  const f = fixture(),
    a = await f.login(),
    b = await f.login('wx-b');
  assert.equal((await f.api('put', '/v1/records/' + row.id, a, row)).status, 200);
  assert.equal((await f.api('put', '/v1/records/' + row.id, a, row)).status, 200);
  assert.equal((await f.api('put', '/v1/records/' + row.id, a, { ...row, hits: 13 })).status, 409);
  assert.equal((await f.api('get', '/v1/records', a)).body.records.length, 1);
  assert.equal((await f.api('get', '/v1/records', b)).body.records.length, 0);
  assert.equal(
    (await f.api('put', '/v1/records/' + row.id, b, { ...row, hits: 2, userId: a.user.id })).status,
    200,
  );
  assert.equal((await f.api('get', '/v1/records', a)).body.records[0].hits, 12);
});
test('record validation rejects simulated, unconfirmed, future, invalid totals and mismatched IDs', async () => {
  const f = fixture(),
    s = await f.login();
  for (const patch of [
    { source: 'simulation' },
    { verifiedByUser: false },
    { hits: 21 },
    { seconds: -1 },
    { endedAt: Date.now() + 3600000 },
    { mode: 'constructor' },
  ])
    assert.equal(
      (await f.api('put', '/v1/records/' + row.id, s, { ...row, ...patch })).status,
      400,
    );
  assert.equal((await f.api('put', '/v1/records/different', s, row)).status, 400);
});
test('delete records is confirmed and cannot delete another account; logout revokes token', async () => {
  const f = fixture(),
    a = await f.login(),
    b = await f.login('wx-b');
  await f.api('put', '/v1/records/' + row.id, a, row);
  await f.api('put', '/v1/records/' + row.id, b, row);
  assert.equal((await f.api('delete', '/v1/records', a, {})).status, 400);
  assert.equal(
    (await f.api('delete', '/v1/records', a, { confirm: 'DELETE_RECORDS', userId: b.user.id }))
      .status,
    200,
  );
  assert.equal((await f.api('get', '/v1/records', b)).body.records.length, 1);
  await f.api('post', '/v1/auth/logout', a, {});
  assert.equal((await f.api('get', '/v1/me', a)).status, 401);
});
test('expired sessions are rejected; account erasure requires recent wx and removes sessions/data', async () => {
  const f = fixture(),
    s = await f.login();
  f.advance(7 * 86400000 + 1);
  assert.equal((await f.api('get', '/v1/me', s)).status, 401);
  const a = await f.login(),
    b = await f.login();
  await f.api('put', '/v1/records/' + row.id, a, row);
  assert.equal(
    (await f.api('delete', '/v1/account', a, { confirm: 'DELETE_ACCOUNT' })).status,
    200,
  );
  assert.equal((await f.api('get', '/v1/me', b)).status, 401);
  const next = await f.login();
  assert.notEqual(next.user.id, a.user.id);
  assert.equal((await f.api('get', '/v1/records', next)).body.records.length, 0);
});
test('service failures and malformed JSON never expose secrets or SQL detail', async () => {
  const f = fixture({
    store: {
      limit: async () => {
        throw new Error('mysql://secret-private-password');
      },
    },
  });
  const result = await request(f.app)
    .post('/v1/auth/wechat')
    .send({ code: 'wx-a', consentVersion: CONSENT_VERSION });
  assert.equal(result.status, 503);
  assert.doesNotMatch(JSON.stringify(result.body), /mysql|secret|password/);
  const malformed = await request(f.app)
    .post('/v1/auth/password')
    .set('Content-Type', 'application/json')
    .send('{no');
  assert.equal(malformed.status, 400);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.ok(result.headers['x-content-type-options']);
});
test('password encoding has unique salts, constant-length verification and policy', async () => {
  const a = await S.hashPassword(password),
    b = await S.hashPassword(password);
  assert.notEqual(a, b);
  assert.ok(await S.checkPassword(password, a));
  assert.equal(await S.checkPassword('wrong', a), false);
  assert.equal(await S.checkPassword(password, null), false);
  for (const p of ['short123', 'onlyletterslong', '123456789012', 'Has spaces123'])
    assert.equal(S.passwordValid(p), false);
});
test('wechat adapter only accepts official upstream data, validates app watermark and hides session key', async () => {
  const calls = [];
  const wechat = createWechat({
    appId: 'test-app',
    appSecret: 'test-only',
    phoneEnabled: true,
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () =>
          url.includes('jscode2session')
            ? { openid: 'official-id', session_key: 'never-return' }
            : url.includes('stable_token')
              ? { access_token: 'test-token', expires_in: 7200 }
              : {
                  phone_info: {
                    purePhoneNumber: phone,
                    countryCode: '86',
                    watermark: { appid: 'test-app', timestamp: Math.floor(Date.now() / 1000) },
                  },
                },
      };
    },
  });
  assert.equal(await wechat.login('one-time-code'), 'official-id');
  assert.equal(await wechat.phone('phone-code'), phone);
  await wechat.phone('phone-code-2');
  assert.equal(calls.filter((c) => c.url.includes('stable_token')).length, 1);
  assert.ok(calls.every((c) => c.url.startsWith('https://api.weixin.qq.com/')));
  const disabled = createWechat({ phoneEnabled: false });
  await assert.rejects(disabled.phone('code'), /尚未开通/);
  const invalid = createWechat({
    appId: 'real',
    phoneEnabled: true,
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        phone_info: { purePhoneNumber: phone, countryCode: '86', watermark: { appid: 'other' } },
        access_token: 't',
        expires_in: 7200,
      }),
    }),
  });
  await assert.rejects(invalid.phone('code'), /手机号/);
});
test('production configuration fails closed, no default secret or in-memory database', () => {
  assert.throws(() => config({}), /Missing configuration/);
});
