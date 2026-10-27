const { randomBytes, createHash, createHmac, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => {
  throw new ApiError(status, code, message);
};
const digest = (value) => createHash('sha256').update(value).digest('hex');
const identity = (key, kind, value) =>
  createHmac('sha256', key).update(`${kind}:${value}`).digest('hex');
function passwordValid(password) {
  return (
    typeof password === 'string' &&
    password.length >= 10 &&
    password.length <= 64 &&
    /[A-Za-z]/.test(password) &&
    /[0-9]/.test(password) &&
    !/\s/.test(password)
  );
}
let deriving = 0;
async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  if (deriving >= 4) fail(429, 'BUSY', '请求较多，请稍后重试');
  deriving++;
  try {
    const value = await derive(password, salt, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    return `scrypt$${salt}$${value.toString('hex')}`;
  } finally {
    deriving--;
  }
}
async function checkPassword(password, encoded) {
  const parts = typeof encoded === 'string' ? encoded.split('$') : [];
  const valid =
    parts.length === 3 &&
    parts[0] === 'scrypt' &&
    /^[a-f0-9]{32}$/.test(parts[1]) &&
    /^[a-f0-9]{64}$/.test(parts[2]);
  const expected = valid ? parts[2] : '0'.repeat(64);
  const actual = (await hashPassword(password, valid ? parts[1] : '0'.repeat(32))).split('$')[2];
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex')) && valid;
}
function createSession(userId, method, now = Date.now()) {
  const token = randomBytes(32).toString('hex');
  return {
    token,
    row: { hash: digest(token), userId, method, createdAt: now, expiresAt: now + 7 * 86400000 },
  };
}
function publicUser(user) {
  return {
    id: user.id,
    nickname: user.nickname,
    username: user.username || '',
    phoneMasked: user.phoneMask || '',
    hasPassword: !!user.passwordHash,
  };
}
function text(value, max = 256) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
module.exports = {
  ApiError,
  fail,
  digest,
  identity,
  passwordValid,
  hashPassword,
  checkPassword,
  createSession,
  publicUser,
  text,
};
