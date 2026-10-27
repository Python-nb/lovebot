const config = require('../config/service');
const R = require('./records');
const SESSION_KEY = 'courtside.account.session.v1';
const CONSENT_VERSION = '2026-10-26-account-v3';
function validUser(user) {
  return (
    user &&
    typeof user.id === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(user.id) &&
    typeof user.nickname === 'string' &&
    typeof user.hasPassword === 'boolean' &&
    typeof user.phoneMasked === 'string' &&
    (user.username === undefined || typeof user.username === 'string')
  );
}
function passwordValid(value) {
  return (
    typeof value === 'string' &&
    value.length >= 10 &&
    value.length <= 64 &&
    /[A-Za-z]/.test(value) &&
    /[0-9]/.test(value) &&
    !/\s/.test(value)
  );
}
class AccountClient {
  constructor(api, options = config) {
    this.api = api;
    this.config = options;
    this.generation = 0;
    this.disposed = false;
    this.invalidated = false;
    this.session = null;
    try {
      const value = api.getStorageSync(SESSION_KEY);
      if (
        validUser(value?.user) &&
        /^[a-f0-9]{64}$/.test(value.token) &&
        Number.isFinite(value.expiresAt)
      )
        this.session = value;
    } catch (_) {
      /* No session is safer than accepting corrupt storage. */
    }
  }
  get user() {
    return this.session?.user || null;
  }
  get active() {
    return (
      !this.disposed && !this.invalidated && !!this.session && this.session.expiresAt > Date.now()
    );
  }
  key() {
    return this.user ? `courtside.account.${this.user.id}.records.v1` : null;
  }
  draftKey() {
    return this.user ? `courtside.account.${this.user.id}.draft.v1` : 'courtside.draft.v1';
  }
  snapshot(key = this.key()) {
    const value = this.api.getStorageSync(key);
    if (!value) return { rows: [], pending: [] };
    if (
      !Array.isArray(value.rows) ||
      !value.rows.every(R.valid) ||
      !Array.isArray(value.pending) ||
      !value.pending.every(
        (id) => typeof id === 'string' && value.rows.some((row) => row.id === id),
      )
    )
      throw new Error('账号本机记录异常，请保留缓存并联系运营方');
    return value;
  }
  storage() {
    if (!this.user) throw new Error('游客训练仅限本次使用，不写入训练记录缓存');
    const key = this.key();
    return {
      getStorageSync: () => this.snapshot(key).rows,
      setStorageSync: (_unused, rows) => {
        const previous = this.snapshot(key);
        const old = new Set(previous.rows.map((r) => r.id));
        const pending = [
          ...new Set([
            ...previous.pending.filter((id) => rows.some((r) => r.id === id)),
            ...rows.filter((r) => !old.has(r.id)).map((r) => r.id),
          ]),
        ];
        this.api.setStorageSync(key, { rows, pending });
      },
      removeStorageSync: () => this.api.removeStorageSync(key),
    };
  }
  assertConfigured() {
    if (this.disposed) throw new Error('页面已关闭，本次操作已取消');
    if (!this.config.enabled || !this.config.env || !this.config.service)
      throw new Error('账号服务尚未开放，暂不能登录');
    if (!this.api.cloud || typeof this.api.cloud.Cloud !== 'function')
      throw new Error('请在支持云托管的微信版本中使用');
  }
  async transport() {
    this.assertConfigured();
    if (!this.cloud)
      this.cloud = (async () => {
        const cloud = new this.api.cloud.Cloud({ resourceEnv: this.config.env });
        await cloud.init();
        return cloud;
      })().catch((error) => {
        this.cloud = null;
        throw error;
      });
    return this.cloud;
  }
  async request(path, method = 'GET', data, auth = true) {
    const generation = this.generation;
    const current = this.session;
    if (auth && !this.active) throw new Error('登录已过期，请重新登录；当前账号的本机记录仍保留');
    const cloud = await this.transport();
    if (generation !== this.generation || this.disposed || (auth && current !== this.session))
      throw new Error('账号状态已变化，本次操作已取消');
    let result;
    try {
      result = await cloud.callContainer({
        path: `/v1${path}`,
        method,
        data,
        header: {
          'X-WX-SERVICE': this.config.service,
          'Content-Type': 'application/json',
          ...(auth ? { Authorization: `Bearer ${current.token}` } : {}),
        },
        timeout: path.endsWith('/register') ? 10000 : 1400,
      });
    } catch {
      throw new Error('服务连接未完成，结果可能已生效。请重新登录或同步核对，请勿连续提交');
    }
    if (generation !== this.generation || this.disposed || (auth && current !== this.session))
      throw new Error('账号状态已变化，本次结果已忽略');
    if (
      !result ||
      !Number.isInteger(result.statusCode) ||
      !result.data ||
      typeof result.data !== 'object'
    )
      throw new Error('账号服务响应无效，未更改本机数据');
    if (result.statusCode < 200 || result.statusCode >= 300) {
      if (auth && result.statusCode === 401) this.invalidated = true;
      const error = new Error(result.data?.error?.message || '账号服务暂不可用');
      error.code = result.data?.error?.code;
      throw error;
    }
    return result.data;
  }
  persist(value) {
    if (this.disposed) throw new Error('页面已关闭，本次结果已忽略');
    if (
      !validUser(value?.user) ||
      !/^[a-f0-9]{64}$/.test(value.token) ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= Date.now()
    )
      throw new Error('登录响应无效，未建立登录态');
    value = {
      token: value.token,
      expiresAt: value.expiresAt,
      user: {
        id: value.user.id,
        nickname: value.user.nickname,
        phoneMasked: value.user.phoneMasked,
        hasPassword: value.user.hasPassword,
        username: value.user.username || '',
      },
    };
    try {
      this.api.setStorageSync(SESSION_KEY, value);
    } catch {
      throw new Error('登录态保存失败，请检查本机存储后重新登录');
    }
    this.session = value;
    this.invalidated = false;
    this.generation++;
    return value.user;
  }
  updateUser(user) {
    if (!validUser(user) || user.id !== this.user?.id) throw new Error('账号响应无效');
    const value = { ...this.session, user };
    this.api.setStorageSync(SESSION_KEY, value);
    this.session = value;
    return user;
  }
  async capabilities() {
    return this.request('/config', 'GET', undefined, false);
  }
  async wechatLogin(accepted) {
    this.assertConfigured();
    if (!accepted) throw new Error('请先阅读并同意账号与数据说明');
    if (!this.api.login) throw new Error('请在微信小程序内登录');
    const generation = this.generation;
    const result = await new Promise((resolve, reject) =>
      this.api.login({ success: resolve, fail: () => reject(new Error('微信登录未完成，请重试')) }),
    );
    if (this.disposed || generation !== this.generation)
      throw new Error('账号状态已变化，本次操作已取消');
    if (!result.code) throw new Error('未获得微信登录凭证');
    return this.persist(
      await this.request(
        '/auth/wechat',
        'POST',
        { code: result.code, consentVersion: CONSENT_VERSION },
        false,
      ),
    );
  }
  async passwordLogin(phone, password, accepted) {
    if (!accepted) throw new Error('请先阅读并同意账号与数据说明');
    if (!/^1[3-9]\d{9}$/.test(phone) || !password || password.length > 64)
      throw new Error('请输入正确手机号和密码');
    return this.persist(
      await this.request(
        '/auth/password',
        'POST',
        { phone, password, consentVersion: CONSENT_VERSION },
        false,
      ),
    );
  }
  async register(phoneCode, password, accepted) {
    this.assertConfigured();
    if (!accepted) throw new Error('请先阅读并同意账号与数据说明');
    if (!phoneCode || typeof phoneCode !== 'string') throw new Error('请先通过微信原生授权手机号');
    if (!passwordValid(password)) throw new Error('密码需 10–64 位，包含字母和数字且不含空格');
    if (!this.api.login) throw new Error('请在微信小程序内注册');
    const generation = this.generation;
    const login = await new Promise((resolve, reject) =>
      this.api.login({ success: resolve, fail: () => reject(new Error('微信登录未完成，请重试')) }),
    );
    if (this.disposed || generation !== this.generation)
      throw new Error('账号状态已变化，本次操作已取消');
    if (!login.code) throw new Error('未获得微信登录凭证');
    return this.persist(
      await this.request(
        '/auth/register',
        'POST',
        { code: login.code, phoneCode, password, consentVersion: CONSENT_VERSION },
        false,
      ),
    );
  }
  async usernameRegister(username, password, accepted) {
    if (!accepted) throw new Error('请先阅读并同意账号与数据说明');
    if (!/^[A-Za-z][A-Za-z0-9_]{5,23}$/.test(username))
      throw new Error('账号名须为 6–24 位，以字母开头，可含数字和下划线');
    if (!passwordValid(password)) throw new Error('密码需 10–64 位，包含字母和数字且不含空格');
    return this.persist(
      await this.request(
        '/auth/username/register',
        'POST',
        { username, password, consentVersion: CONSENT_VERSION },
        false,
      ),
    );
  }
  async usernameLogin(username, password, accepted) {
    if (!accepted) throw new Error('请先阅读并同意账号与数据说明');
    if (!/^[A-Za-z][A-Za-z0-9_]{5,23}$/.test(username) || !password || password.length > 64)
      throw new Error('请输入正确账号名和密码');
    return this.persist(
      await this.request(
        '/auth/username',
        'POST',
        { username, password, consentVersion: CONSENT_VERSION },
        false,
      ),
    );
  }
  async bindPhone(code) {
    return this.updateUser((await this.request('/account/phone', 'POST', { code })).user);
  }
  async setPassword(password, currentPassword) {
    if (!passwordValid(password)) throw new Error('密码需 10–64 位，包含字母和数字且不含空格');
    return this.persist(
      await this.request('/account/password', 'PUT', { password, currentPassword }),
    );
  }
  async resetPassword(password, code) {
    if (!passwordValid(password)) throw new Error('密码需 10–64 位，包含字母和数字且不含空格');
    return this.persist(await this.request('/account/password/reset', 'POST', { password, code }));
  }
  async rename(nickname) {
    return this.updateUser((await this.request('/me', 'PATCH', { nickname })).user);
  }
  async verify() {
    return this.updateUser((await this.request('/me')).user);
  }
  importGuest() {
    if (!this.user) throw new Error('请先登录');
    const previous = this.snapshot();
    const existing = new Set(previous.rows.map((r) => r.id));
    const rows = R.load(this.api).filter((r) => r.verifiedByUser === true && !existing.has(r.id));
    this.api.setStorageSync(this.key(), {
      rows: [...previous.rows, ...rows],
      pending: [...new Set([...previous.pending, ...rows.map((r) => r.id)])],
    });
    return rows.length;
  }
  async sync() {
    if (!this.user) throw new Error('请先登录再同步');
    const key = this.key();
    const before = this.snapshot();
    const revision = JSON.stringify(before);
    // Only explicit pending records are uploaded. Downloaded records never resurrect remote deletions.
    for (const id of before.pending) {
      const row = before.rows.find((r) => r.id === id);
      if (row) await this.request(`/records/${encodeURIComponent(id)}`, 'PUT', row);
    }
    let cursor = null,
      rows = [];
    const seen = new Set();
    do {
      const response = await this.request(
        `/records${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      if (!Array.isArray(response.records) || !response.records.every(R.valid))
        throw new Error('云端记录格式异常，本机数据未覆盖');
      rows.push(...response.records);
      const next = response.nextCursor;
      if (
        next !== null &&
        (typeof next !== 'string' || next.length > 160 || seen.has(next) || rows.length > 100000)
      )
        throw new Error('云端分页异常');
      seen.add(next);
      cursor = next;
    } while (cursor !== null);
    const unique = new Map(rows.map((r) => [r.id, r]));
    rows = [...unique.values()].sort((a, b) => b.endedAt - a.endedAt);
    if (JSON.stringify(this.snapshot(key)) !== revision)
      throw new Error('同步期间本机记录发生变化，已保留，请重新同步核对');
    this.api.setStorageSync(key, { rows, pending: [] });
    return rows.length;
  }
  async deleteCloudRecords() {
    const key = this.key();
    if ((await this.request('/records', 'DELETE', { confirm: 'DELETE_RECORDS' })).ok !== true)
      throw new Error('云端删除结果未确认，本机记录保留');
    this.api.removeStorageSync(key);
  }
  async logout() {
    if (this.active) {
      try {
        if ((await this.request('/auth/logout', 'POST', {})).ok !== true)
          throw new Error('退出结果未确认，请重新登录核对');
      } catch (error) {
        if (error.code !== 'AUTH') throw error;
      }
    }
    this.api.removeStorageSync(SESSION_KEY);
    this.session = null;
    this.generation++;
  }
  async deleteAccount() {
    const key = this.key(),
      draftKey = this.draftKey();
    if ((await this.request('/account', 'DELETE', { confirm: 'DELETE_ACCOUNT' })).ok !== true)
      throw new Error('账号注销结果未确认，请重新登录核对');
    this.api.removeStorageSync(key);
    this.api.removeStorageSync(draftKey);
    this.api.removeStorageSync(SESSION_KEY);
    this.session = null;
    this.generation++;
  }
  dispose() {
    this.disposed = true;
    this.generation++;
  }
}
module.exports = { AccountClient, SESSION_KEY, CONSENT_VERSION, passwordValid };
