const express = require('express');
const router = express.Router();
const WalletService = require('../services/walletService');
const { validateSolanaAddress, validateAmount } = require('../middleware/validation');

// Send SOL
router.post('/send', validateSolanaAddress, validateAmount, async (req, res) => {
  const { fromPrivateKey, address, amount } = req.body;
  try {
    const result = await WalletService.sendSOL(fromPrivateKey, address, amount);
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to send SOL' });
  }
});

// Send SPL Token
router.post('/send-token', validateSolanaAddress, validateAmount, async (req, res) => {
  const { fromPrivateKey, address, amount, mint } = req.body;
  try {
    const result = await WalletService.sendSPLToken(fromPrivateKey, address, amount, mint);
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to send SPL token' });
  }
});

// Create SPL Token (mint)
router.post('/create-token', async (req, res) => {
  const { fromPrivateKey, decimals, initialSupply } = req.body;
  try {
    const result = await WalletService.createSPLToken(fromPrivateKey, decimals, initialSupply);
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to create SPL token' });
  }
});

// Get minimum rent-exempt balance for SPL token account
router.get('/rent-exempt/:decimals', async (req, res) => {
  const { decimals } = req.params;
  try {
    const result = await WalletService.getRentExemptBalance(parseInt(decimals));
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch rent-exempt balance' });
  }
});

// Get transaction history
router.get('/history/:publicKey', async (req, res) => {
  const { publicKey } = req.params;
  try {
    const result = await WalletService.getTransactionHistory(publicKey, 20);
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transaction history' });
  }
});

// Swap tokens (Jupiter integration)
router.post('/swap', async (req, res) => {
  const {
    fromPrivateKey,
    userPublicKey,
    inputMint,
    outputMint,
    amount,
    slippageBps,
    prioritizationFeeLamports,
    platformFeeBps,
    platformFeeAccount
  } = req.body;
  try {
    // 1. Get quote
    const quoteResult = await WalletService.getSwapQuote(
      inputMint,
      outputMint,
      amount,
      slippageBps || 50,
      platformFeeBps,
      platformFeeAccount
    );
    if (!quoteResult.success) {
      return res.status(400).json({ error: quoteResult.error });
    }
    // 2. Execute swap
    const swapResult = await WalletService.executeSwap(
      quoteResult.data,
      userPublicKey,
      fromPrivateKey,
      prioritizationFeeLamports
    );
    if (swapResult.success) {
      res.json(swapResult.data);
    } else {
      res.status(400).json({ error: swapResult.error });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to swap tokens' });
  }
});

module.exports = router;

const transactionsRoutes = require('./routes/transactions');
app.use('/api/transactions', transactionsRoutes);
