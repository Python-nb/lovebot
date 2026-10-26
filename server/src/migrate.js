const { runMigrations } = require('./migrations');
(async () => {
  const result = await runMigrations();
  console.log(
    `Schema migration completed: applied=${result.applied.length}, skipped=${result.skipped.length}`,
  );
})().catch(() => {
  console.error(
    'Migration failed; check configuration, permissions and migration history before retrying',
  );
  process.exitCode = 1;
});
