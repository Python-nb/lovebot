// Scripted SQL adapter only. No real database, cloud console, or credentials used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runMigrations, statements } = require('../src/migrations');
const { poolConfig, migrationConfig } = require('../src/config');
const env = {
  MYSQL_ADDRESS: 'db.internal:3306',
  MYSQL_USERNAME: 'test-business-user',
  MYSQL_PASSWORD: 'synthetic-test-only',
  MYSQL_DATABASE: 'courtside',
};
const migration = {
  version: '001_test',
  checksum: 'a'.repeat(64),
  sql: 'CREATE TABLE IF NOT EXISTS test_data (id INT);',
};
function fixture(options = {}) {
  const calls = [],
    connections = [];
  const history = options.history || [],
    tables = options.tables || [];
  let available = !options.missing,
    lockHeld = false,
    ended = 0,
    verified = 0;
  const db = {
    async execute(sql, args) {
      calls.push([sql, args]);
      if (sql.includes('GET_LOCK')) {
        lockHeld = options.lock !== false;
        return [[{ acquired: lockHeld ? 1 : 0 }]];
      }
      if (sql.includes('RELEASE_LOCK')) {
        lockHeld = false;
        return [[{ released: 1 }]];
      }
      if (sql.includes('information_schema')) return [tables.map((name) => ({ name }))];
      if (sql.startsWith('SELECT version')) return [history.map((r) => ({ ...r }))];
      if (sql.startsWith('INSERT INTO courtside_schema')) {
        history.push({ version: args[0], checksum: args[1], status: 'running' });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE courtside_schema')) {
        history.find((r) => r.version === args[1]).status = 'applied';
        return [{ affectedRows: 1 }];
      }
      throw new Error('Unexpected test SQL');
    },
    async query(sql) {
      assert.equal(lockHeld, true, 'DDL must hold migration lock');
      calls.push([sql]);
      if (sql.startsWith('CREATE DATABASE')) available = true;
      if (sql.startsWith('CREATE TABLE courtside_schema'))
        tables.push('courtside_schema_migrations');
      if (sql.startsWith('CREATE TABLE IF NOT EXISTS test_data') && options.ddlFailure)
        throw Object.assign(new Error('SQL detail must not be logged'), {
          code: 'ER_TABLEACCESS_DENIED_ERROR',
        });
      return [{}];
    },
    async end() {
      ended++;
    },
  };
  const connect = async (config) => {
    connections.push(config);
    if (config.database && !available)
      throw Object.assign(new Error('missing'), { code: 'ER_BAD_DB_ERROR' });
    return db;
  };
  const run = (extraEnv = {}) =>
    runMigrations({
      env: { ...env, ...extraEnv },
      connect,
      migrations: [migration],
      verify: async () => {
        verified++;
        if (options.verifyFailure) throw new Error('schema invalid');
      },
    });
  return { run, calls, connections, history, ended: () => ended, verified: () => verified };
}
test('cloud-hosting variable aliases are accepted without changing existing keys', () => {
  const cfg = poolConfig(env);
  assert.equal(cfg.host, 'db.internal');
  assert.equal(cfg.port, 3306);
  assert.equal(cfg.user, 'test-business-user');
  assert.equal(poolConfig({ ...env, MYSQL_ADDRESS: 'db.internal:3307' }).port, 3307);
  const explicit = poolConfig({
    ...env,
    MYSQL_HOST: 'explicit.internal',
    MYSQL_PORT: '3308',
    MYSQL_USER: 'explicit-user',
  });
  assert.equal(explicit.host, 'explicit.internal');
  assert.equal(explicit.port, 3308);
  assert.equal(explicit.user, 'explicit-user');
});
test('invalid database, port, missing password and ambiguous migration settings fail closed', () => {
  for (const database of [
    '',
    'nodejs_demo',
    'mysql',
    'courtside`;DROP DATABASE other',
    '../courtside',
  ])
    assert.throws(() => poolConfig({ ...env, MYSQL_DATABASE: database }), /dedicated application/);
  for (const port of ['0', '65536', 'abc', '1.5'])
    assert.throws(() => poolConfig({ ...env, MYSQL_PORT: port }), /MYSQL_PORT/);
  assert.throws(() => poolConfig({ ...env, MYSQL_PASSWORD: '' }), /MYSQL_PASSWORD/);
  assert.throws(() => migrationConfig({ ...env, MYSQL_MIGRATION_USER: 'migration' }), /Both/);
  assert.throws(() => migrationConfig({ ...env, DB_AUTO_MIGRATE: 'yes' }), /Invalid/);
});
test('one-off migration can use a separate DDL account without changing runtime credentials', () => {
  const values = {
    ...env,
    MYSQL_MIGRATION_USER: 'test-ddl-user',
    MYSQL_MIGRATION_PASSWORD: 'synthetic-ddl-only',
  };
  assert.equal(migrationConfig(values).options.user, 'test-ddl-user');
  assert.equal(poolConfig(values).user, 'test-business-user');
});
test('empty schema initializes under a lock and records successful version once', async () => {
  const f = fixture();
  const result = await f.run();
  assert.deepEqual(result, { applied: ['001_test'], skipped: [] });
  assert.equal(f.history[0].status, 'applied');
  assert.equal(f.ended(), 1);
  assert.equal(f.verified(), 2);
  const insertion = f.calls.findIndex(([sql]) => sql.startsWith('INSERT INTO courtside_schema'));
  const ddl = f.calls.findIndex(([sql]) => sql.startsWith('CREATE TABLE IF NOT EXISTS test_data'));
  assert.ok(insertion < ddl);
  const again = await f.run();
  assert.deepEqual(again, { applied: [], skipped: ['001_test'] });
  assert.equal(
    f.calls.filter(([sql]) => sql.startsWith('CREATE TABLE IF NOT EXISTS test_data')).length,
    1,
  );
  assert.equal(f.ended(), 2);
});
test('missing database is not created unless explicitly enabled', async () => {
  const f = fixture({ missing: true });
  await assert.rejects(f.run(), { code: 'ER_BAD_DB_ERROR' });
  assert.equal(f.calls.length, 0);
  assert.equal(f.connections.length, 1);
});
test('explicit bootstrap creates only configured schema and subsequent connections select it', async () => {
  const f = fixture({ missing: true });
  await f.run({ DB_CREATE_DATABASE: 'true' });
  assert.equal(f.connections[1].database, undefined);
  assert.equal(f.calls.filter(([sql]) => sql.startsWith('CREATE DATABASE')).length, 1);
  assert.match(f.calls.find(([sql]) => sql.startsWith('CREATE DATABASE'))[0], /`courtside`/);
  await f.run({ DB_CREATE_DATABASE: 'true' });
  assert.equal(f.calls.filter(([sql]) => sql.startsWith('CREATE DATABASE')).length, 1);
});
test('existing unversioned tables are not silently adopted or modified', async () => {
  const f = fixture({ tables: ['users', 'training_records'] });
  await assert.rejects(f.run(), { code: 'MIGRATION_BASELINE_REQUIRED' });
  assert.equal(
    f.calls.some(([sql]) => sql.startsWith('CREATE')),
    false,
  );
  assert.equal(f.ended(), 1);
});
test('lock contention ends the attempt with no DDL and no blind retry', async () => {
  const f = fixture({ lock: false });
  await assert.rejects(f.run(), { code: 'MIGRATION_LOCK_UNAVAILABLE' });
  assert.equal(f.calls.filter(([sql]) => sql.includes('GET_LOCK')).length, 1);
  assert.equal(
    f.calls.some(([sql]) => sql.startsWith('CREATE')),
    false,
  );
  assert.equal(f.ended(), 1);
});
test('checksum mismatch, incomplete version or newer schema abort before applying SQL', async () => {
  for (const [history, code] of [
    [[{ ...migration, checksum: 'b'.repeat(64), status: 'applied' }], 'MIGRATION_CHECKSUM_CHANGED'],
    [[{ ...migration, status: 'running' }], 'MIGRATION_REVIEW_REQUIRED'],
    [[{ ...migration, version: '999_unknown', status: 'applied' }], 'MIGRATION_NEWER_SCHEMA'],
  ]) {
    const f = fixture({ tables: ['courtside_schema_migrations'], history });
    await assert.rejects(f.run(), { code });
    assert.equal(
      f.calls.some(([sql]) => sql.startsWith('CREATE') || sql.startsWith('INSERT')),
      false,
    );
    assert.equal(f.ended(), 1);
  }
});
test('DDL or validation failure stays incomplete and cannot report applied or replay next time', async () => {
  for (const failure of ['ddlFailure', 'verifyFailure']) {
    const f = fixture({ [failure]: true });
    await assert.rejects(f.run());
    assert.equal(f.history[0].status, 'running');
    assert.equal(
      f.calls.some(([sql]) => sql.startsWith('UPDATE')),
      false,
    );
    await assert.rejects(f.run(), { code: 'MIGRATION_REVIEW_REQUIRED' });
    assert.equal(f.ended(), 2);
  }
});
test('unattended migration only accepts reviewed additive initial statements', () => {
  for (const sql of [
    'DROP TABLE users;',
    'ALTER TABLE users ADD COLUMN x INT;',
    'DELETE FROM users;',
    '',
  ])
    assert.throws(() => statements(sql), { code: 'MIGRATION_UNSUPPORTED_SQL' });
});
test('both image entry points wait for startup initialization before listening and build never connects to DB', () => {
  const start = fs.readFileSync(path.join(__dirname, '../src/start.js'), 'utf8');
  assert.ok(start.indexOf('await runMigrations()') < start.indexOf('app.listen('));
  assert.match(start, /app\.listen\(80, '0\.0\.0\.0'/);
  assert.match(start, /DB_AUTO_MIGRATE === 'true'/);
  for (const file of ['../../Dockerfile', '../Dockerfile']) {
    const docker = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.match(docker, /CMD \["node", "src\/start.js"\]/);
    assert.match(docker, /EXPOSE 80/);
    assert.doesNotMatch(docker, /PORT=8080/);
    assert.doesNotMatch(docker, /RUN .*migrate/);
  }
});
