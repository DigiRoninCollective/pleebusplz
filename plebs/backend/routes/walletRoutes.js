// routes/walletRoutes.js - API endpoints for wallet operations
const express = require('express');
const WalletService = require('../services/walletService');
const router = express.Router();

const walletService = new WalletService();

// Generate new wallet
router.post('/generate', async (req, res) => {
    try {
        const result = walletService.generateWallet();
        
        if (result.success) {
            // Don't send private key in response for security
            res.json({
                success: true,
                data: {
                    publicKey: result.data.publicKey,
                    mnemonic: result.data.mnemonic
                }
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Import wallet
router.post('/import', async (req, res) => {
    try {
        const { privateKey } = req.body;
        
        if (!privateKey) {
            return res.status(400).json({
                success: false,
                error: 'Private key is required'
            });
        }

        const result = walletService.importWalletFromPrivateKey(privateKey);
        
        if (result.success) {
            res.json({
                success: true,
                data: {
                    publicKey: result.data.publicKey
                }
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get SOL balance
router.get('/balance/:publicKey', async (req, res) => {
    try {
        const { publicKey } = req.params;
        const result = await walletService.getSOLBalance(publicKey);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get token balances
router.get('/tokens/:publicKey', async (req, res) => {
    try {
        const { publicKey } = req.params;
        const result = await walletService.getTokenBalances(publicKey);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get swap quote
router.post('/quote', async (req, res) => {
    try {
        const { inputMint, outputMint, amount, slippageBps } = req.body;
        
        const result = await walletService.getSwapQuote(
            inputMint, 
            outputMint, 
            amount, 
            slippageBps || 50
        );
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Buy token with SOL
router.post('/buy', async (req, res) => {
    try {
        const { tokenMint, solAmount, userPublicKey, privateKey, slippageBps } = req.body;
        
        // Validate required fields
        if (!tokenMint || !solAmount || !userPublicKey || !privateKey) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: tokenMint, solAmount, userPublicKey, privateKey'
            });
        }

        const result = await walletService.buyTokenWithSOL(
            tokenMint,
            solAmount,
            userPublicKey,
            privateKey,
            slippageBps || 100
        );
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Sell token for SOL
router.post('/sell', async (req, res) => {
    try {
        const { tokenMint, tokenAmount, userPublicKey, privateKey, slippageBps } = req.body;
        
        // Validate required fields
        if (!tokenMint || !tokenAmount || !userPublicKey || !privateKey) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: tokenMint, tokenAmount, userPublicKey, privateKey'
            });
        }

        const result = await walletService.sellTokenForSOL(
            tokenMint,
            tokenAmount,
            userPublicKey,
            privateKey,
            slippageBps || 100
        );
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Send SOL
router.post('/send', async (req, res) => {
    try {
        const { fromPrivateKey, toPublicKey, amount } = req.body;
        
        if (!fromPrivateKey || !toPublicKey || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: fromPrivateKey, toPublicKey, amount'
            });
        }

        const result = await walletService.sendSOL(fromPrivateKey, toPublicKey, amount);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get transaction history
router.get('/history/:publicKey', async (req, res) => {
    try {
        const { publicKey } = req.params;
        const { limit } = req.query;
        
        const result = await walletService.getTransactionHistory(
            publicKey, 
            limit ? parseInt(limit) : 10
        );
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Validate address
router.get('/validate/:address', (req, res) => {
    try {
        const { address } = req.params;
        const isValid = walletService.isValidAddress(address);
        
        res.json({
            success: true,
            data: {
                address,
                isValid
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;