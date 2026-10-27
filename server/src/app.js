const express = require('express');
const helmet = require('helmet');
const { randomUUID } = require('node:crypto');
const S = require('./security');
function record(input, now) {
  if (
    !input ||
    !/^[A-Za-z0-9_-]{1,96}$/.test(input.id) ||
    input.source !== 'ble' ||
    !['free', 'time', 'count'].includes(input.mode) ||
    input.verifiedByUser !== true ||
    !['shots', 'hits', 'seconds'].every(
      (k) => Number.isSafeInteger(input[k]) && input[k] >= 0 && input[k] <= 10000000,
    ) ||
    input.hits > input.shots ||
    !Number.isSafeInteger(input.endedAt) ||
    input.endedAt < 1577836800000 ||
    input.endedAt > now + 300000
  )
    S.fail(400, 'RECORD_INVALID', '训练记录格式无效，仅可同步已核对的设备记录');
  return {
    id: input.id,
    source: 'ble',
    mode: input.mode,
    shots: input.shots,
    hits: input.hits,
    seconds: input.seconds,
    endedAt: input.endedAt,
    verifiedByUser: true,
    interrupted: input.interrupted === true,
  };
}
const CONSENT_VERSION = '2026-10-26-account-v3';
function createApp({
  store,
  wechat,
  identityKey,
  phoneEnabled = false,
  usernameEnabled = false,
  now = Date.now,
}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Request-Id', randomUUID());
    next();
  });
  app.use(express.json({ limit: '12kb', strict: true }));
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/readyz', async (_req, res) => {
    await store.ready();
    res.json({ ok: true });
  });
  app.get('/v1/config', (_req, res) =>
    res.json({ phoneEnabled, usernameEnabled, consentVersion: CONSENT_VERSION }),
  );
  const limit = (kind, value, max = 10, windowMs = 900000) =>
    store.limit(S.identity(identityKey, kind, value), max, windowMs);
  function consent(req) {
    if (req.body?.consentVersion !== CONSENT_VERSION)
      S.fail(400, 'CONSENT', '请阅读并同意更新后的账号与数据说明');
  }
  async function issue(res, user, method, expectedPassword) {
    const session = S.createSession(user.id, method, now());
    const current = await store.issue(session.row, expectedPassword);
    res.json({
      token: session.token,
      expiresAt: session.row.expiresAt,
      user: S.publicUser(current),
    });
  }
  app.post('/v1/auth/wechat', async (req, res) => {
    consent(req);
    await limit('wx-global', 'all', 120, 60000);
    const openid = await wechat.login(req.body.code);
    const key = S.identity(identityKey, 'wx', openid);
    await limit('wx-user', key, 30, 3600000);
    const user = await store.wechatUser(key);
    await issue(res, user, 'wechat');
  });
  app.post('/v1/auth/register', async (req, res) => {
    consent(req);
    const { code, phoneCode, password } = req.body;
    if (!S.text(code, 256) || !S.text(phoneCode, 256))
      S.fail(400, 'INPUT', '请通过微信授权身份和手机号');
    if (!S.passwordValid(password))
      S.fail(400, 'PASSWORD_POLICY', '密码需 10–64 位，包含字母和数字且不含空格');
    if (!phoneEnabled) S.fail(403, 'PHONE_DISABLED', '微信手机号能力尚未开通');
    await limit('register-global', 'all', 60, 60000);
    const openid = await wechat.login(code);
    const wechatKey = S.identity(identityKey, 'wx', openid);
    await limit('register-wx', wechatKey, 5, 3600000);
    const phone = await wechat.phone(phoneCode);
    const phoneKey = S.identity(identityKey, 'phone', phone);
    await limit('register-phone', phoneKey, 5, 3600000);
    const hash = await S.hashPassword(password);
    const session = S.createSession(null, 'wechat', now());
    const user = await store.register(
      wechatKey,
      phoneKey,
      `${phone.slice(0, 3)}****${phone.slice(-4)}`,
      hash,
      session.row,
    );
    res.json({ token: session.token, expiresAt: session.row.expiresAt, user: S.publicUser(user) });
  });
  app.post('/v1/auth/password', async (req, res) => {
    consent(req);
    const { phone, password } = req.body;
    if (typeof phone !== 'string' || !/^1[3-9]\d{9}$/.test(phone) || !S.text(password, 64))
      S.fail(400, 'INPUT', '请输入正确手机号和密码');
    await limit('password-global', 'all', 120, 60000);
    const key = S.identity(identityKey, 'phone', phone);
    await limit('password-phone', key);
    const user = await store.byPhone(key);
    const verified = await S.checkPassword(password, user?.passwordHash);
    if (!verified || !user) S.fail(401, 'LOGIN_FAILED', '手机号或密码不正确');
    await issue(res, user, 'password', user.passwordHash);
  });
  function usernameInput(req, registering = false) {
    consent(req);
    if (!usernameEnabled) S.fail(503, 'USERNAME_DISABLED', '账号密码服务尚未开放');
    const { username, password } = req.body;
    if (typeof username !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{5,23}$/.test(username))
      S.fail(400, 'USERNAME_POLICY', '账号名须为 6–24 位字母、数字或下划线，以字母开头');
    if (registering ? !S.passwordValid(password) : !S.text(password, 64))
      S.fail(400, 'PASSWORD_POLICY', '密码需 10–64 位，包含字母和数字且不含空格');
    const normalized = username.toLowerCase();
    return { normalized, key: S.identity(identityKey, 'username', normalized), password };
  }
  app.post('/v1/auth/username/register', async (req, res) => {
    const { normalized, key, password } = usernameInput(req, true);
    await limit('username-register-global', 'all', 60, 60000);
    await limit('username-register-key', key, 5, 3600000);
    const hash = await S.hashPassword(password);
    const session = S.createSession(null, 'username', now());
    const user = await store.usernameRegister(key, normalized, hash, session.row, now());
    res.json({ token: session.token, expiresAt: session.row.expiresAt, user: S.publicUser(user) });
  });
  app.post('/v1/auth/username', async (req, res) => {
    const { key, password } = usernameInput(req);
    await limit('username-login-global', 'all', 120, 60000);
    await limit('username-login-key', key);
    const user = await store.byUsername(key);
    const verified = await S.checkPassword(password, user?.passwordHash);
    if (!verified || !user) S.fail(401, 'LOGIN_FAILED', '账号或密码不正确');
    await issue(res, user, 'username', user.passwordHash);
  });
  app.use('/v1', async (req, _res, next) => {
    const bearer = req.get('Authorization') || '';
    if (!/^Bearer [a-f0-9]{64}$/.test(bearer)) S.fail(401, 'AUTH', '请先登录');
    req.auth = await store.authenticated(S.digest(bearer.slice(7)));
    if (!req.auth) S.fail(401, 'AUTH', '登录已失效，请重新登录');
    await limit('account-api', req.auth.user.id, 200, 60000);
    next();
  });
  function freshWechat(auth) {
    if (auth.session.method !== 'wechat' || now() - auth.session.createdAt > 300000)
      S.fail(403, 'REAUTH', '请重新使用微信登录后操作（5 分钟内有效）');
  }
  function freshIdentity(auth) {
    if (
      !['wechat', 'username'].includes(auth.session.method) ||
      now() - auth.session.createdAt > 300000
    )
      S.fail(403, 'REAUTH', '请在 5 分钟内重新登录微信或账号后操作');
  }
  app.get('/v1/me', (req, res) => res.json({ user: S.publicUser(req.auth.user) }));
  app.post('/v1/auth/logout', async (req, res) => {
    await store.logout(req.auth);
    res.json({ ok: true });
  });
  app.post('/v1/account/phone', async (req, res) => {
    freshWechat(req.auth);
    await limit('bind', req.auth.user.id, 5);
    const phone = await wechat.phone(req.body.code);
    const user = await store.bindPhone(
      req.auth,
      S.identity(identityKey, 'phone', phone),
      `${phone.slice(0, 3)}****${phone.slice(-4)}`,
    );
    res.json({ user: S.publicUser(user) });
  });
  async function setPassword(req, res, reset) {
    const { password, currentPassword } = req.body;
    if (!S.passwordValid(password))
      S.fail(400, 'PASSWORD_POLICY', '密码需 10–64 位，包含字母和数字且不含空格');
    await limit('password-change', req.auth.user.id, 8);
    const user = req.auth.user;
    if (!user.phoneKey && !user.usernameKey)
      S.fail(400, 'IDENTITY_REQUIRED', '请先绑定手机号或注册独立账号');
    if (reset) {
      freshWechat(req.auth);
      const phone = await wechat.phone(req.body.code);
      if (S.identity(identityKey, 'phone', phone) !== user.phoneKey)
        S.fail(403, 'PHONE_MISMATCH', '授权号码与本账号不一致');
    } else if (user.passwordHash) {
      if (
        !S.text(currentPassword, 64) ||
        !(await S.checkPassword(currentPassword, user.passwordHash))
      )
        S.fail(403, 'PASSWORD_WRONG', '原密码不正确');
    } else freshWechat(req.auth);
    const hash = await S.hashPassword(password);
    const session = S.createSession(user.id, req.auth.session.method, now());
    // Rotation must not turn an old WeChat login into a fresh authentication.
    session.row.createdAt = req.auth.session.createdAt;
    const updated = await store.changePassword(req.auth, user.passwordHash, hash, session.row);
    res.json({
      token: session.token,
      expiresAt: session.row.expiresAt,
      user: S.publicUser(updated),
    });
  }
  app.put('/v1/account/password', (req, res) => setPassword(req, res, false));
  app.post('/v1/account/password/reset', (req, res) => setPassword(req, res, true));
  app.patch('/v1/me', async (req, res) => {
    const nickname = req.body.nickname;
    if (
      !S.text(nickname, 16) ||
      nickname.trim() !== nickname ||
      [...nickname].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
    )
      S.fail(400, 'INPUT', '昵称需 1–16 个有效字符');
    res.json({ user: S.publicUser(await store.nickname(req.auth, nickname)) });
  });
  app.get('/v1/records', async (req, res) => {
    const cursor = req.query.cursor;
    let before = null;
    if (cursor !== undefined) {
      if (typeof cursor !== 'string' || !/^\d{13}:[A-Za-z0-9_-]{1,96}$/.test(cursor))
        S.fail(400, 'INPUT', '分页参数无效');
      const [timestamp, id] = cursor.split(':');
      before = { endedAt: Number(timestamp), id };
    }
    const rows = await store.records(req.auth, before, 100);
    const last = rows[rows.length - 1];
    res.json({
      records: rows,
      nextCursor: rows.length === 100 ? `${last.endedAt}:${last.id}` : null,
    });
  });
  app.put('/v1/records/:id', async (req, res) => {
    const row = record(req.body, now());
    if (req.params.id !== row.id) S.fail(400, 'INPUT', '记录编号不一致');
    res.json({ record: await store.putRecord(req.auth, row) });
  });
  app.delete('/v1/records', async (req, res) => {
    if (req.body?.confirm !== 'DELETE_RECORDS') S.fail(400, 'CONFIRM', '请先确认删除范围');
    await store.deleteRecords(req.auth);
    res.json({ ok: true });
  });
  app.delete('/v1/account', async (req, res) => {
    if (req.body?.confirm !== 'DELETE_ACCOUNT') S.fail(400, 'CONFIRM', '请先确认注销账号');
    freshIdentity(req.auth);
    await store.deleteAccount(req.auth);
    res.json({ ok: true });
  });
  app.use((_req, _res, next) => next(new S.ApiError(404, 'NOT_FOUND', '接口不存在')));
  app.use((error, _req, res, _next) => {
    const known = error instanceof S.ApiError;
    const malformed = error.type === 'entity.parse.failed' || error.type === 'entity.too.large';
    res.status(known ? error.status : malformed ? 400 : 503).json({
      error: {
        code: known ? error.code : malformed ? 'INPUT' : 'UNAVAILABLE',
        message: known
          ? error.message
          : malformed
            ? '请求格式或大小不正确'
            : '服务暂不可用，请稍后重试',
      },
    });
    // Never log request bodies, phone, credentials, upstream URLs, or SQL errors.
  });
  return app;
}
module.exports = { createApp, CONSENT_VERSION, record };
