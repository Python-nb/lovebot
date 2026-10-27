const mysql = require('mysql2/promise');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { migrationConfig } = require('./config');
const { MysqlStore } = require('./store');

const HISTORY = 'courtside_schema_migrations';
const definitions = () =>
  ['001_initial', '002_username_auth'].map((version) => {
    const sql = fs.readFileSync(path.join(__dirname, `../migrations/${version}.sql`), 'utf8');
    return { version, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
function stop(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

// Only checked-in, additive initial DDL is eligible for unattended initialization.
// Future ALTER/data migrations must introduce their own reviewed recovery strategy.
function statements(sql, version = '001_initial') {
  const parts = sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  const accountAlter =
    'ALTER TABLE users MODIFY wechat_key CHAR(64) CHARACTER SET ascii NULL, ADD COLUMN username_key CHAR(64) CHARACTER SET ascii NULL UNIQUE, ADD COLUMN username VARCHAR(32) NULL';
  if (
    !parts.length ||
    parts.some(
      (s) =>
        !/^CREATE TABLE IF NOT EXISTS [a-z_]+\s*\(/.test(s) &&
        !(version === '002_username_auth' && s === accountAlter),
    ) ||
    (version === '002_username_auth' && (parts.length !== 1 || parts[0] !== accountAlter))
  )
    stop('MIGRATION_UNSUPPORTED_SQL');
  return parts;
}

async function runMigrations({
  env = process.env,
  connect = mysql.createConnection,
  migrations = definitions(),
  verify = (db) => new MysqlStore(db).ready(),
  verifyUsername = (db) => new MysqlStore(db).readyUsername(),
} = {}) {
  const { options, createDatabase } = migrationConfig(env);
  const commands = migrations.map((m) => ({ ...m, commands: statements(m.sql, m.version) }));
  const lock = `courtside:migrate:${createHash('sha256').update(options.database).digest('hex').slice(0, 40)}`;
  const connection = { ...options };
  delete connection.connectionLimit;
  delete connection.queueLimit;
  let db,
    locked = false,
    missing = false;
  const applied = [],
    skipped = [],
    deferred = [];
  try {
    try {
      db = await connect(connection);
    } catch (error) {
      if (error.code !== 'ER_BAD_DB_ERROR' || !createDatabase) throw error;
      const serverConnection = { ...connection };
      delete serverConnection.database;
      db = await connect(serverConnection);
      missing = true;
    }
    const [[result]] = await db.execute('SELECT GET_LOCK(?,30) AS acquired', [lock]);
    if (Number(result?.acquired) !== 1) stop('MIGRATION_LOCK_UNAVAILABLE');
    locked = true;
    if (missing) {
      // Identifier was strictly validated; never interpolate credentials or arbitrary SQL.
      await db.query(
        `CREATE DATABASE IF NOT EXISTS \`${options.database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
      await db.query(`USE \`${options.database}\``);
    }
    const [tables] = await db.execute(
      'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=?',
      [options.database],
    );
    if (!tables.some((t) => t.name === HISTORY)) {
      // Do not silently adopt a previous/manual schema, or resume uncertain partial DDL.
      if (tables.length) stop('MIGRATION_BASELINE_REQUIRED');
      await db.query(
        `CREATE TABLE ${HISTORY} (version VARCHAR(64) CHARACTER SET ascii PRIMARY KEY, checksum CHAR(64) CHARACTER SET ascii NOT NULL, status VARCHAR(16) NOT NULL, started_at BIGINT NOT NULL, applied_at BIGINT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );
    }
    const [history] = await db.execute(`SELECT version,checksum,status FROM ${HISTORY}`);
    if (history.some((h) => !commands.some((m) => m.version === h.version)))
      stop('MIGRATION_NEWER_SCHEMA');
    // Validate the whole plan before applying any new DDL.
    for (const previous of history) {
      if (previous.checksum !== commands.find((m) => m.version === previous.version).checksum)
        stop('MIGRATION_CHECKSUM_CHANGED');
      if (previous.status !== 'applied') stop('MIGRATION_REVIEW_REQUIRED');
    }
    for (const migration of commands) {
      if (history.some((h) => h.version === migration.version)) {
        skipped.push(migration.version);
        continue;
      }
      if (migration.version === '002_username_auth' && env.DB_ALLOW_USERNAME_MIGRATION !== 'true') {
        deferred.push(migration.version);
        continue;
      }
      await db.execute(
        `INSERT INTO ${HISTORY}(version,checksum,status,started_at) VALUES(?,?,'running',?)`,
        [migration.version, migration.checksum, Date.now()],
      );
      // MySQL 5.7 DDL auto-commits. Never pretend a transaction can undo CREATE TABLE.
      // A failure leaves 'running', requiring review instead of blindly replaying on restart.
      for (const statement of migration.commands) await db.query(statement);
      await verify(db);
      if (migration.version === '002_username_auth') await verifyUsername(db);
      const [updated] = await db.execute(
        `UPDATE ${HISTORY} SET status='applied',applied_at=? WHERE version=? AND status='running'`,
        [Date.now(), migration.version],
      );
      if (updated.affectedRows !== 1) stop('MIGRATION_REVIEW_REQUIRED');
      applied.push(migration.version);
    }
    await verify(db);
    if (
      history.some((h) => h.version === '002_username_auth') ||
      applied.includes('002_username_auth')
    )
      await verifyUsername(db);
    return deferred.length ? { applied, skipped, deferred } : { applied, skipped };
  } finally {
    if (locked) await db.execute('SELECT RELEASE_LOCK(?)', [lock]).catch(() => {});
    if (db) await db.end();
  }
}
module.exports = { runMigrations, statements };
