-- Migration: Create fee_payments table for minting fee tracking
CREATE TABLE IF NOT EXISTS fee_payments (
    id SERIAL PRIMARY KEY,
    signature TEXT NOT NULL UNIQUE,
    payer TEXT NOT NULL,
    amount BIGINT NOT NULL,
    token_minted TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);
-- Index for fast lookup by token
CREATE INDEX IF NOT EXISTS idx_fee_payments_token ON fee_payments(token_minted);
