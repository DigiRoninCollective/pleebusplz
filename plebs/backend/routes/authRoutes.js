// routes/authRoutes.js - Solana Wallet Auth (Nonce + Verify)
const express = require('express');
const bs58 = require('bs58');
const nacl = require('tweetnacl');
const { v4: uuidv4 } = require('uuid');
const solanaAuth = require('../middleware/auth');

const router = express.Router();
const nonces = new Map(); // In-memory for dev only

// GET /auth/nonce/:publicKey
router.get('/nonce/:publicKey', (req, res) => {
  const { publicKey } = req.params;
  const nonce = uuidv4();
  nonces.set(publicKey, nonce);
  res.json({ nonce });
});

// POST /auth/verify
router.post('/verify', (req, res) => {
  const { publicKey, signature } = req.body;
  const message = nonces.get(publicKey);

  if (!message) return res.status(400).json({ error: 'No nonce for this public key' });

  try {
    const verified = nacl.sign.detached.verify(
      Buffer.from(message),
      bs58.decode(signature),
      bs58.decode(publicKey)
    );

    if (!verified) return res.status(401).json({ error: 'Invalid signature' });

    nonces.delete(publicKey); // One-time use
    res.json({ success: true, publicKey });
  } catch (e) {
    res.status(500).json({ error: 'Verification failed' });
  }
});

module.exports = router;
