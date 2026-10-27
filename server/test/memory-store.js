// Test double only. Production startup always uses MySQL, never this module.
const { randomUUID } = require('node:crypto');
const { fail } = require('../src/security');
class MemoryStore {
  constructor(now = Date.now) {
    this.now = now;
    this.users = new Map();
    this.sessions = new Map();
    this.rows = new Map();
    this.buckets = new Map();
  }
  async ready() {}
  async readyUsername() {}
  async limit(key, max, ms) {
    const bucket = this.buckets.get(key);
    const next =
      !bucket || bucket.until <= this.now()
        ? { count: 1, until: this.now() + ms }
        : { ...bucket, count: bucket.count + 1 };
    this.buckets.set(key, next);
    if (next.count > max) fail(429, 'RATE_LIMIT', '尝试次数过多，请稍后再试');
  }
  async wechatUser(key) {
    let user = [...this.users.values()].find((u) => u.wechatKey === key);
    if (!user) {
      user = {
        id: randomUUID(),
        wechatKey: key,
        phoneKey: null,
        phoneMask: null,
        passwordHash: null,
        nickname: '球场新朋友',
      };
      this.users.set(user.id, user);
    }
    return { ...user };
  }
  async register(wechatKey, phoneKey, mask, passwordHash, session) {
    const existing = [...this.users.values()].find((u) => u.wechatKey === wechatKey);
    if (existing?.passwordHash)
      fail(409, 'ALREADY_REGISTERED', '该微信账号已设置密码，请直接登录或重置密码');
    if (existing?.phoneKey && existing.phoneKey !== phoneKey)
      fail(409, 'PHONE_BOUND', '该微信账号已绑定其他手机号，请联系运营方处理');
    if ([...this.users.values()].some((u) => u.id !== existing?.id && u.phoneKey === phoneKey))
      fail(409, 'REGISTER_CONFLICT', '手机号已绑定其他账号，不会自动合并');
    const user = existing || {
      id: randomUUID(),
      wechatKey,
      nickname: '球场新朋友',
    };
    Object.assign(user, { phoneKey, phoneMask: mask, passwordHash });
    this.users.set(user.id, user);
    for (const [k, s] of this.sessions) if (s.userId === user.id) this.sessions.delete(k);
    session.userId = user.id;
    this.sessions.set(session.hash, { ...session });
    return { ...user };
  }
  async byPhone(key) {
    const u = [...this.users.values()].find((u) => u.phoneKey === key);
    return u && { ...u };
  }
  async usernameRegister(key, username, passwordHash, session) {
    if ([...this.users.values()].some((u) => u.usernameKey === key))
      fail(409, 'USERNAME_IN_USE', '账号名已被使用，请换一个');
    const user = {
      id: randomUUID(),
      wechatKey: null,
      usernameKey: key,
      username,
      phoneKey: null,
      phoneMask: null,
      passwordHash,
      nickname: '球场新朋友',
    };
    this.users.set(user.id, user);
    session.userId = user.id;
    this.sessions.set(session.hash, { ...session });
    return { ...user };
  }
  async byUsername(key) {
    const u = [...this.users.values()].find((row) => row.usernameKey === key);
    return u && { ...u };
  }
  async issue(s, hash) {
    const u = this.users.get(s.userId);
    if (!u || (hash !== undefined && u.passwordHash !== hash))
      fail(401, 'AUTH', '账号状态已变化，请重新登录');
    this.sessions.set(s.hash, { ...s });
    return { ...u };
  }
  async authenticated(hash) {
    const s = this.sessions.get(hash),
      u = s && this.users.get(s.userId);
    return u && s.expiresAt > this.now() ? { user: { ...u }, session: { ...s } } : null;
  }
  check(auth) {
    const u = this.users.get(auth.user.id);
    if (!u || !this.sessions.has(auth.session.hash)) fail(401, 'AUTH', '登录已失效');
    return u;
  }
  async bindPhone(auth, key, mask) {
    const u = this.check(auth);
    if (u.phoneKey && u.phoneKey !== key) fail(409, 'PHONE_BOUND', '本账号已绑定其他号码');
    if ([...this.users.values()].some((x) => x.id !== u.id && x.phoneKey === key))
      fail(409, 'PHONE_IN_USE', '该号码已绑定其他账号，不会自动合并');
    Object.assign(u, { phoneKey: key, phoneMask: mask });
    return { ...u };
  }
  async changePassword(auth, previousHash, nextHash, session) {
    const u = this.check(auth);
    if (u.passwordHash !== previousHash) fail(409, 'ACCOUNT_CHANGED', '密码状态已变化');
    if (!u.phoneKey && !u.usernameKey) fail(400, 'PHONE_REQUIRED', '请先授权绑定手机号');
    u.passwordHash = nextHash;
    for (const [k, s] of this.sessions) if (s.userId === u.id) this.sessions.delete(k);
    this.sessions.set(session.hash, session);
    return { ...u };
  }
  async nickname(auth, nickname) {
    const u = this.check(auth);
    u.nickname = nickname;
    return { ...u };
  }
  async logout(auth) {
    this.sessions.delete(auth.session.hash);
  }
  async records(auth, before, limit) {
    return [...this.rows.entries()]
      .filter(([k]) => k.startsWith(auth.user.id + ':'))
      .map(([, v]) => v)
      .filter(
        (r) =>
          !before ||
          r.endedAt < before.endedAt ||
          (r.endedAt === before.endedAt && r.id > before.id),
      )
      .sort((a, b) => b.endedAt - a.endedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, limit);
  }
  async putRecord(auth, row) {
    this.check(auth);
    const key = `${auth.user.id}:${row.id}`,
      old = this.rows.get(key);
    if (old && JSON.stringify(old) !== JSON.stringify(row))
      fail(409, 'RECORD_CONFLICT', '同编号记录内容不同');
    this.rows.set(key, row);
    return row;
  }
  async deleteRecords(auth) {
    this.check(auth);
    for (const k of this.rows.keys()) if (k.startsWith(auth.user.id + ':')) this.rows.delete(k);
  }
  async deleteAccount(auth) {
    await this.deleteRecords(auth);
    this.users.delete(auth.user.id);
    for (const [k, s] of this.sessions) if (s.userId === auth.user.id) this.sessions.delete(k);
  }
}
module.exports = { MemoryStore };
