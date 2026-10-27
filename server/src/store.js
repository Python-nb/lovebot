const { randomUUID } = require('node:crypto');
const { fail } = require('./security');
function mapUser(r) {
  return (
    r && {
      id: r.id,
      wechatKey: r.wechat_key,
      usernameKey: r.username_key,
      username: r.username,
      phoneKey: r.phone_key,
      phoneMask: r.phone_mask,
      passwordHash: r.password_hash,
      nickname: r.nickname,
    }
  );
}
class MysqlStore {
  constructor(pool) {
    this.pool = pool;
  }
  async ready() {
    await this.pool.execute('SELECT id,wechat_key,phone_key,password_hash FROM users LIMIT 0');
    await this.pool.execute('SELECT token_hash,expires_at FROM sessions LIMIT 0');
    await this.pool.execute('SELECT record_id,payload FROM training_records LIMIT 0');
    await this.pool.execute('SELECT bucket_key,hits,expires_at FROM rate_limits LIMIT 0');
  }
  async readyUsername() {
    const [[column]] = await this.pool.execute(
      "SELECT IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='wechat_key'",
    );
    if (column?.nullable !== 'YES') throw new Error('Account migration not applied');
    await this.pool.execute('SELECT username_key,username FROM users LIMIT 0');
  }
  async transaction(fn) {
    const db = await this.pool.getConnection();
    try {
      await db.beginTransaction();
      const result = await fn(db);
      await db.commit();
      return result;
    } catch (e) {
      await db.rollback();
      throw e;
    } finally {
      db.release();
    }
  }
  async limit(key, max, windowMs) {
    const now = Date.now();
    return this.transaction(async (db) => {
      await db.execute('INSERT IGNORE INTO rate_limits(bucket_key,hits,expires_at) VALUES(?,0,?)', [
        key,
        now + windowMs,
      ]);
      const [[r]] = await db.execute(
        'SELECT hits,expires_at FROM rate_limits WHERE bucket_key=? FOR UPDATE',
        [key],
      );
      const hits = Number(r.expires_at) <= now ? 1 : r.hits + 1;
      if (hits > max) fail(429, 'RATE_LIMIT', '尝试次数过多，请稍后再试');
      await db.execute('UPDATE rate_limits SET hits=?,expires_at=? WHERE bucket_key=?', [
        hits,
        Number(r.expires_at) <= now ? now + windowMs : r.expires_at,
        key,
      ]);
    });
  }
  async wechatUser(key) {
    await this.pool.execute(
      'INSERT INTO users(id,wechat_key,created_at) VALUES(?,?,?) ON DUPLICATE KEY UPDATE wechat_key=VALUES(wechat_key)',
      [randomUUID(), key, Date.now()],
    );
    const [[r]] = await this.pool.execute('SELECT * FROM users WHERE wechat_key=?', [key]);
    return mapUser(r);
  }
  async register(wechatKey, phoneKey, mask, passwordHash, session) {
    try {
      return await this.transaction(async (db) => {
        const [[existing]] = await db.execute('SELECT * FROM users WHERE wechat_key=? FOR UPDATE', [
          wechatKey,
        ]);
        if (existing?.password_hash)
          fail(409, 'ALREADY_REGISTERED', '该微信账号已设置密码，请直接登录或重置密码');
        if (existing?.phone_key && existing.phone_key !== phoneKey)
          fail(409, 'PHONE_BOUND', '该微信账号已绑定其他手机号，请联系运营方处理');
        const id = existing?.id || randomUUID();
        if (existing) {
          await db.execute('UPDATE users SET phone_key=?,phone_mask=?,password_hash=? WHERE id=?', [
            phoneKey,
            mask,
            passwordHash,
            id,
          ]);
          await db.execute('DELETE FROM sessions WHERE user_id=?', [id]);
        } else
          await db.execute(
            'INSERT INTO users(id,wechat_key,phone_key,phone_mask,password_hash,created_at) VALUES(?,?,?,?,?,?)',
            [id, wechatKey, phoneKey, mask, passwordHash, Date.now()],
          );
        session.userId = id;
        await this.insertSession(db, session);
        return {
          id,
          wechatKey,
          phoneKey,
          phoneMask: mask,
          passwordHash,
          nickname: existing?.nickname || '球场新朋友',
        };
      });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY')
        fail(409, 'REGISTER_CONFLICT', '手机号已绑定其他账号，或注册状态已变化；不会自动合并');
      throw e;
    }
  }
  async byPhone(key) {
    const [[r]] = await this.pool.execute('SELECT * FROM users WHERE phone_key=?', [key]);
    return mapUser(r);
  }
  async usernameRegister(key, username, passwordHash, session, now) {
    try {
      return await this.transaction(async (db) => {
        const id = randomUUID();
        await db.execute(
          'INSERT INTO users(id,wechat_key,username_key,username,password_hash,created_at) VALUES(?,NULL,?,?,?,?)',
          [id, key, username, passwordHash, now],
        );
        session.userId = id;
        await this.insertSession(db, session);
        return { id, usernameKey: key, username, passwordHash, nickname: '球场新朋友' };
      });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') fail(409, 'USERNAME_IN_USE', '账号名已被使用，请换一个');
      throw e;
    }
  }
  async byUsername(key) {
    const [[row]] = await this.pool.execute('SELECT * FROM users WHERE username_key=?', [key]);
    return mapUser(row);
  }
  async issue(session, expectedPassword) {
    return this.transaction(async (db) => {
      const [[u]] = await db.execute('SELECT * FROM users WHERE id=? FOR UPDATE', [session.userId]);
      if (!u || (expectedPassword !== undefined && expectedPassword !== u.password_hash))
        fail(401, 'AUTH', '账号状态已变化，请重新登录');
      await this.insertSession(db, session);
      return mapUser(u);
    });
  }
  async insertSession(db, s) {
    await db.execute(
      'INSERT INTO sessions(token_hash,user_id,method,created_at,expires_at) VALUES(?,?,?,?,?)',
      [s.hash, s.userId, s.method, s.createdAt, s.expiresAt],
    );
  }
  async authenticated(hash) {
    const [[r]] = await this.pool.execute(
      'SELECT u.*,s.method,s.created_at AS session_at,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',
      [hash, Date.now()],
    );
    return (
      r && {
        user: mapUser(r),
        session: {
          hash,
          method: r.method,
          createdAt: Number(r.session_at),
          expiresAt: Number(r.expires_at),
        },
      }
    );
  }
  async withAuth(auth, fn) {
    return this.transaction(async (db) => {
      const [[u]] = await db.execute('SELECT * FROM users WHERE id=? FOR UPDATE', [auth.user.id]);
      const [[s]] = await db.execute(
        'SELECT token_hash FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?',
        [auth.session.hash, auth.user.id, Date.now()],
      );
      if (!u || !s) fail(401, 'AUTH', '登录已失效，请重新登录');
      return fn(db, mapUser(u));
    });
  }
  async bindPhone(auth, key, mask) {
    try {
      return await this.withAuth(auth, async (db, u) => {
        if (u.phoneKey && u.phoneKey !== key)
          fail(409, 'PHONE_BOUND', '本账号已绑定其他号码，请联系运营方处理');
        await db.execute('UPDATE users SET phone_key=?,phone_mask=? WHERE id=?', [key, mask, u.id]);
        return { ...u, phoneKey: key, phoneMask: mask };
      });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY')
        fail(409, 'PHONE_IN_USE', '该号码已绑定其他账号，不会自动合并');
      throw e;
    }
  }
  async changePassword(auth, previousHash, nextHash, session) {
    return this.withAuth(auth, async (db, u) => {
      if (u.passwordHash !== previousHash)
        fail(409, 'ACCOUNT_CHANGED', '密码状态已变化，请重新操作');
      if (!u.phoneKey && !u.usernameKey)
        fail(400, 'IDENTITY_REQUIRED', '请先绑定手机号或注册独立账号');
      await db.execute('UPDATE users SET password_hash=? WHERE id=?', [nextHash, u.id]);
      await db.execute('DELETE FROM sessions WHERE user_id=?', [u.id]);
      await this.insertSession(db, session);
      return { ...u, passwordHash: nextHash };
    });
  }
  async nickname(auth, nickname) {
    return this.withAuth(auth, async (db, u) => {
      await db.execute('UPDATE users SET nickname=? WHERE id=?', [nickname, u.id]);
      return { ...u, nickname };
    });
  }
  async logout(auth) {
    await this.pool.execute('DELETE FROM sessions WHERE token_hash=?', [auth.session.hash]);
  }
  async records(auth, before, limit) {
    // Keyset pagination does not skip older rows when another device inserts/deletes a page head.
    const [rows] = await this.pool.execute(
      `SELECT payload FROM training_records WHERE user_id=? ${before ? 'AND (ended_at<? OR (ended_at=? AND record_id>?))' : ''} ORDER BY ended_at DESC,record_id ASC LIMIT ?`,
      before
        ? [auth.user.id, before.endedAt, before.endedAt, before.id, limit]
        : [auth.user.id, limit],
    );
    return rows.map((r) => (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload));
  }
  async putRecord(auth, row) {
    return this.withAuth(auth, async (db, u) => {
      const [[old]] = await db.execute(
        'SELECT payload FROM training_records WHERE user_id=? AND record_id=?',
        [u.id, row.id],
      );
      if (old) {
        const value = typeof old.payload === 'string' ? JSON.parse(old.payload) : old.payload;
        if (Object.keys(row).some((k) => row[k] !== value[k]))
          fail(409, 'RECORD_CONFLICT', '同编号记录内容不同，请保留本机记录并联系运营方');
        return value;
      }
      await db.execute(
        'INSERT INTO training_records(user_id,record_id,ended_at,payload) VALUES(?,?,?,?)',
        [u.id, row.id, row.endedAt, JSON.stringify(row)],
      );
      return row;
    });
  }
  async deleteRecords(auth) {
    return this.withAuth(auth, (db, u) =>
      db.execute('DELETE FROM training_records WHERE user_id=?', [u.id]),
    );
  }
  async deleteAccount(auth) {
    return this.withAuth(auth, (db, u) => db.execute('DELETE FROM users WHERE id=?', [u.id]));
  }
  async cleanup() {
    await this.pool.execute('DELETE FROM sessions WHERE expires_at<=? LIMIT 10000', [Date.now()]);
    await this.pool.execute('DELETE FROM rate_limits WHERE expires_at<=? LIMIT 10000', [
      Date.now() - 86400000,
    ]);
  }
}
module.exports = { MysqlStore };
