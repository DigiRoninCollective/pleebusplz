CREATE TABLE tokens (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  ticker VARCHAR(20) NOT NULL,
  description TEXT,
  image_url TEXT,
  contract_address VARCHAR(64) UNIQUE NOT NULL,
  metadata_uri TEXT,
  decimals INTEGER DEFAULT 9,
  created_at TIMESTAMP DEFAULT NOW()
);
-- Add to your existing schema.sql
CREATE TABLE chat_rooms (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  telegram_chat_id BIGINT,
  contract_address VARCHAR(64) UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE chat_messages (
  id SERIAL PRIMARY KEY,
  room_id INTEGER REFERENCES chat_rooms(id),
  username VARCHAR(50),
  message TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT NOW(),
  source VARCHAR(20) DEFAULT 'web' -- 'web' or 'telegram'
);

ALTER TABLE chat_messages ADD COLUMN contract_address VARCHAR(64);
-- Or, if you want to use contract_address as the main reference:
-- room_id VARCHAR(64) REFERENCES chat_rooms(contract_address)

/* -- Database schema additions
-- Add vanity columns to user_wallets table
ALTER TABLE user_wallets ADD COLUMN is_vanity BOOLEAN DEFAULT FALSE;
ALTER TABLE user_wallets ADD COLUMN vanity_pattern VARCHAR(10) NULL;
ALTER TABLE user_wallets ADD COLUMN vanity_type VARCHAR(20) NULL;
ALTER TABLE user_wallets ADD COLUMN generation_attempts BIGINT NULL;

-- Add pro membership to users table
ALTER TABLE users ADD COLUMN pro_expires_at TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN pro_tier VARCHAR(20) DEFAULT 'free';

-- Create vanity generations log table
CREATE TABLE vanity_generations (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL,
  pattern VARCHAR(10) NOT NULL,
  type VARCHAR(20) NOT NULL,
  attempts BIGINT DEFAULT 0,
  duration BIGINT NULL, -- milliseconds
  success BOOLEAN DEFAULT FALSE,
  cancel_reason VARCHAR(50) NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_vanity_generations_telegram_id ON vanity_generations(telegram_id);
CREATE INDEX idx_vanity_generations_pattern ON vanity_generations(pattern);
-- Add vanity columns to user_wallets table
ALTER TABLE user_wallets ADD COLUMN is_vanity BOOLEAN DEFAULT FALSE;
ALTER TABLE user_wallets ADD COLUMN vanity_pattern VARCHAR(10) NULL;