const { PublicKey } = require('@solana/web3.js');

// Validate Solana address middleware
function validateSolanaAddress(req, res, next) {
  const { address } = req.body;
  try {
    new PublicKey(address);
    next();
  } catch {
    return res.status(400).json({ error: 'Invalid Solana address' });
  }
}

// Validate amount (SOL or token, positive number, max decimals)
function validateAmount(req, res, next) {
  const { amount } = req.body;
  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0 || num > 1000000 || (num.toString().split('.')[1]?.length > 9)) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  next();
}

module.exports = {
  validateSolanaAddress,
  validateAmount,
};