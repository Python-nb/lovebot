const mysql = require('mysql2/promise');
const { createApp } = require('./app');
const { MysqlStore } = require('./store');
const { createWechat } = require('./wechat');
const { config, poolConfig, migrationConfig } = require('./config');
const { runMigrations } = require('./migrations');
let pool;
(async () => {
  const cfg = config();
  migrationConfig();
  if (process.env.DB_AUTO_MIGRATE === 'true') {
    const result = await runMigrations();
    console.log(`Schema ready: applied=${result.applied.length}, skipped=${result.skipped.length}`);
  }
  pool = mysql.createPool(poolConfig());
  const store = new MysqlStore(pool);
  await store.ready();
  const app = createApp({ ...cfg, store, wechat: createWechat(cfg) });
  // This service's cloud health probes target container port 80. An inherited
  // PORT=8080 must not silently move this listener away from those probes.
  const server = app.listen(80, '0.0.0.0', () => console.log('Courtside API ready'));
  const cleanup = setInterval(
    () => store.cleanup().catch(() => console.error('Scheduled cleanup failed')),
    3600000,
  );
  cleanup.unref();
  function stop() {
    clearInterval(cleanup);
    const timer = setTimeout(() => process.exit(1), 10000);
    timer.unref();
    server.close(() =>
      pool.end().finally(() => {
        clearTimeout(timer);
        process.exit(0);
      }),
    );
  }
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
})().catch(async () => {
  if (pool) await pool.end().catch(() => {});
  console.error('Startup failed; check server-only configuration and database readiness');
  process.exitCode = 1;
});
