CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) CHARACTER SET ascii PRIMARY KEY,
  wechat_key CHAR(64) CHARACTER SET ascii NOT NULL UNIQUE,
  phone_key CHAR(64) CHARACTER SET ascii NULL UNIQUE,
  phone_mask VARCHAR(16) NULL,
  password_hash VARCHAR(160) CHARACTER SET ascii NULL,
  nickname VARCHAR(32) NOT NULL DEFAULT '球场新朋友',
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) CHARACTER SET ascii PRIMARY KEY,
  user_id CHAR(36) CHARACTER SET ascii NOT NULL,
  method VARCHAR(16) NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  INDEX sessions_user(user_id),
  INDEX sessions_expiry(expires_at),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS training_records (
  user_id CHAR(36) CHARACTER SET ascii NOT NULL,
  record_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ended_at BIGINT NOT NULL,
  payload JSON NOT NULL,
  PRIMARY KEY(user_id, record_id),
  INDEX records_user_date(user_id, ended_at),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key CHAR(64) CHARACTER SET ascii PRIMARY KEY,
  hits INT UNSIGNED NOT NULL,
  expires_at BIGINT NOT NULL,
  INDEX limits_expiry(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
