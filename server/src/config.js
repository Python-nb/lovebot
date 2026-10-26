function config(env = process.env) {
  const required = ['WECHAT_APP_ID', 'WECHAT_APP_SECRET', 'IDENTITY_HMAC_KEY'];
  for (const key of required) if (!env[key]) throw new Error(`Missing configuration: ${key}`);
  if (!/^[a-fA-F0-9]{64}$/.test(env.IDENTITY_HMAC_KEY))
    throw new Error('IDENTITY_HMAC_KEY must contain 32 random bytes encoded as hex');
  if (!/^wx[a-f0-9]{16}$/.test(env.WECHAT_APP_ID)) throw new Error('Invalid WECHAT_APP_ID');
  poolConfig(env);
  return {
    appId: env.WECHAT_APP_ID,
    appSecret: env.WECHAT_APP_SECRET,
    identityKey: Buffer.from(env.IDENTITY_HMAC_KEY, 'hex'),
    phoneEnabled: env.WECHAT_PHONE_ENABLED === 'true',
  };
}
function poolConfig(env = process.env) {
  const address = env.MYSQL_ADDRESS || '';
  const match = address.match(/^([^:\s/]+)(?::(\d+))?$/);
  if (!env.MYSQL_HOST && !match)
    throw new Error('Missing configuration: MYSQL_ADDRESS or MYSQL_HOST');
  const host = env.MYSQL_HOST || match[1];
  const port = Number(env.MYSQL_PORT || match?.[2] || 3306);
  const user = env.MYSQL_USER || env.MYSQL_USERNAME;
  if (!/^[^:\s/]+$/.test(host)) throw new Error('Invalid MYSQL_HOST');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid MYSQL_PORT');
  if (!user) throw new Error('Missing configuration: MYSQL_USERNAME or MYSQL_USER');
  if (!env.MYSQL_PASSWORD) throw new Error('Missing configuration: MYSQL_PASSWORD');
  if (
    !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(env.MYSQL_DATABASE || '') ||
    ['mysql', 'sys', 'performance_schema', 'information_schema', 'nodejs_demo'].includes(
      env.MYSQL_DATABASE.toLowerCase(),
    )
  )
    throw new Error('MYSQL_DATABASE must name a dedicated application database');
  return {
    host,
    port,
    user,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    charset: 'utf8mb4',
    connectionLimit: 5,
    queueLimit: 20,
    connectTimeout: 8000,
    supportBigNumbers: true,
    bigNumberStrings: false,
    ssl: env.MYSQL_TLS_CA ? { ca: env.MYSQL_TLS_CA, rejectUnauthorized: true } : undefined,
  };
}
function migrationConfig(env = process.env) {
  const options = poolConfig(env);
  const user = env.MYSQL_MIGRATION_USER,
    password = env.MYSQL_MIGRATION_PASSWORD;
  if (!!user !== !!password)
    throw new Error('Both MYSQL_MIGRATION_USER and MYSQL_MIGRATION_PASSWORD are required');
  for (const key of ['DB_AUTO_MIGRATE', 'DB_CREATE_DATABASE'])
    if (env[key] !== undefined && !['true', 'false'].includes(env[key]))
      throw new Error(`Invalid ${key}`);
  return {
    options: { ...options, ...(user ? { user, password } : {}) },
    createDatabase: env.DB_CREATE_DATABASE === 'true',
  };
}
module.exports = { config, poolConfig, migrationConfig };
