// SQL contract tests only; these do not execute a MySQL server or claim integration proof.
const test = require('node:test');
const assert = require('node:assert/strict');
const { MysqlStore } = require('../src/store');
const auth = { user: { id: 'owner' }, session: { hash: 'old-session' } };
const dbUser = {
  id: 'owner',
  wechat_key: 'wx-hash',
  phone_key: 'phone-hash',
  phone_mask: '138****0000',
  password_hash: 'old-password-hash',
  nickname: '训练者',
};
function fixture(responses = []) {
  const calls = [];
  const db = {
    async beginTransaction() {
      calls.push(['begin']);
    },
    async commit() {
      calls.push(['commit']);
    },
    async rollback() {
      calls.push(['rollback']);
    },
    release() {
      calls.push(['release']);
    },
    async execute(sql, params) {
      calls.push([sql, params]);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response || [[]];
    },
  };
  const pool = { execute: db.execute, getConnection: async () => db };
  return { store: new MysqlStore(pool), calls };
}
test('schema readiness fails closed on absent schema instead of succeeding on SELECT 1', async () => {
  const { store, calls } = fixture([new Error('missing table')]);
  await assert.rejects(store.ready(), /missing table/);
  assert.match(calls[0][0], /FROM users LIMIT 0/);
  assert.doesNotMatch(calls[0][0], /SELECT 1/);
});
test('transaction rolls back and releases connection on failure', async () => {
  const { store, calls } = fixture();
  await assert.rejects(
    store.transaction(async () => {
      throw new Error('failure');
    }),
    /failure/,
  );
  assert.deepEqual(calls, [['begin'], ['rollback'], ['release']]);
});
test('password rotation locks owner, revalidates session, revokes all sessions and commits replacement', async () => {
  const { store, calls } = fixture([[[dbUser]], [[{ token_hash: 'old-session' }]]]);
  const next = {
    hash: 'new-session',
    userId: 'owner',
    method: 'wechat',
    createdAt: 10,
    expiresAt: 20,
  };
  await store.changePassword(auth, 'old-password-hash', 'new-password-hash', next);
  assert.match(calls[1][0], /WHERE id=\? FOR UPDATE/);
  assert.deepEqual(calls[1][1], ['owner']);
  assert.match(calls[2][0], /token_hash=\? AND user_id=\? AND expires_at>\?/);
  assert.deepEqual(calls[4], ['DELETE FROM sessions WHERE user_id=?', ['owner']]);
  assert.match(calls[5][0], /INSERT INTO sessions/);
  assert.deepEqual(calls.slice(-2), [['commit'], ['release']]);
});
test('revocation detected under lock rolls back before user data mutation', async () => {
  const { store, calls } = fixture([[[dbUser]], [[]]]);
  await assert.rejects(store.deleteAccount(auth), { code: 'AUTH' });
  assert.equal(
    calls.some(([sql]) => sql.startsWith('DELETE')),
    false,
  );
  assert.deepEqual(calls.slice(-2), [['rollback'], ['release']]);
});
test('record pagination scopes owner and uses parameterized stable keyset rather than offset', async () => {
  const { store, calls } = fixture([[[{ payload: '{"id":"record"}' }]]]);
  const rows = await store.records(auth, { endedAt: 1792980000000, id: 'record-before' }, 100);
  assert.deepEqual(rows, [{ id: 'record' }]);
  assert.match(calls[0][0], /WHERE user_id=\? AND \(ended_at<\?/);
  assert.doesNotMatch(calls[0][0], /OFFSET/);
  assert.deepEqual(calls[0][1], ['owner', 1792980000000, 1792980000000, 'record-before', 100]);
});
test('phone uniqueness collision rolls back and returns explicit non-merging conflict', async () => {
  const duplicate = Object.assign(new Error('sql detail'), { code: 'ER_DUP_ENTRY' });
  const { store, calls } = fixture([
    [[{ ...dbUser, phone_key: null }]],
    [[{ token_hash: 'old-session' }]],
    duplicate,
  ]);
  await assert.rejects(store.bindPhone(auth, 'new-phone-key', '139****0000'), {
    code: 'PHONE_IN_USE',
  });
  assert.deepEqual(calls.slice(-2), [['rollback'], ['release']]);
});
test('registration inserts a verified identity, password and session in one transaction', async () => {
  const { store, calls } = fixture([[[]]]);
  const session = { hash: 'new-session', method: 'wechat', createdAt: 10, expiresAt: 20 };
  const user = await store.register('wx-hash', 'phone-hash', '138****0000', 'hash', session);
  assert.equal(user.phoneMask, '138****0000');
  assert.match(calls[1][0], /wechat_key=\? FOR UPDATE/);
  assert.match(calls[2][0], /INSERT INTO users/);
  assert.equal(calls[2][1][0], session.userId);
  assert.match(calls[3][0], /INSERT INTO sessions/);
  assert.deepEqual(calls.slice(-2), [['commit'], ['release']]);
});
test('registration conflict rolls back without creating a session', async () => {
  const { store, calls } = fixture([[[dbUser]]]);
  await assert.rejects(
    store.register('wx-hash', 'phone-hash', '138****0000', 'hash', { hash: 'next' }),
    { code: 'ALREADY_REGISTERED' },
  );
  assert.equal(
    calls.some(([sql]) => sql.startsWith('INSERT INTO sessions')),
    false,
  );
  assert.deepEqual(calls.slice(-2), [['rollback'], ['release']]);
});
test('username readiness requires migrated nullable identity and account columns', async () => {
  const old = fixture([[[{ nullable: 'NO' }]]]);
  await assert.rejects(old.store.readyUsername(), /migration/);
  assert.equal(old.calls.length, 1);
  const current = fixture([[[{ nullable: 'YES' }]], [[]]]);
  await current.store.readyUsername();
  assert.match(current.calls[1][0], /username_key,username FROM users LIMIT 0/);
});
test('username uniqueness collision rolls back without issuing session', async () => {
  const duplicate = Object.assign(new Error('sql detail'), { code: 'ER_DUP_ENTRY' });
  const { store, calls } = fixture([duplicate]);
  await assert.rejects(
    store.usernameRegister('username-key', 'player_1', 'hash', { hash: 'new' }, Date.now()),
    { code: 'USERNAME_IN_USE' },
  );
  assert.equal(
    calls.some(([sql]) => sql.startsWith('INSERT INTO sessions')),
    false,
  );
  assert.deepEqual(calls.slice(-2), [['rollback'], ['release']]);
});
