
-- Wallet Activity Logging Migration
-- Run this SQL on your PostgreSQL database

CREATE TABLE IF NOT EXISTS wallet_activity_log (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL,
  action VARCHAR(50) NOT NULL,
  details JSONB,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_telegram_id ON wallet_activity_log(telegram_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON wallet_activity_log(timestamp);

-- Optional: Add wallet version column to existing table
ALTER TABLE user_wallets ADD COLUMN IF NOT EXISTS wallet_version VARCHAR(10) DEFAULT '2.0';
ALTER TABLE user_wallets ADD COLUMN IF NOT EXISTS derivation_path VARCHAR(50) DEFAULT "m/44'/501'/0'/0'";

COMMENT ON TABLE wallet_activity_log IS 'Logs wallet activities for security monitoring';
      