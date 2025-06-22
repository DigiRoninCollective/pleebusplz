// middleware/auth.js - Solana Wallet Signature Authentication Middleware
const nacl = require('tweetnacl');
const bs58 = require('bs58');

/**
 * Middleware to authenticate Solana wallet via signature verification
 * Expects:
 * - req.body.message: random nonce (or fixed string)
 * - req.body.signature: bs58-encoded signed message
 * - req.body.publicKey: user's wallet address
 */
module.exports = function solanaAuth(req, res, next) {
  const { message, signature, publicKey } = req.body;

  if (!message || !signature || !publicKey) {
    return res.status(400).json({ error: 'Missing authentication fields' });
  }

  try {
    const verified = nacl.sign.detached.verify(
      Buffer.from(message),
      bs58.decode(signature),
      bs58.decode(publicKey)
    );

    if (!verified) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    req.user = { publicKey };
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Signature verification failed' });
  }
};
