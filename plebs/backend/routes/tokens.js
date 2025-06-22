const express = require('express');
const tokenController = require('../controllers/tokenController');
const { validateToken, validateMint } = require('../middleware/validation');

const router = express.Router();

// GET /api/tokens - List all tokens
router.get('/', tokenController.getAllTokens);

// POST /api/tokens - Create new token entry
router.post('/', validateToken, tokenController.createToken);

// POST /api/tokens/deploy - Deploy token to Solana
router.post('/deploy', tokenController.deployToken);

// GET /api/tokens/:mint/info - Get on-chain token information
router.get('/:mint/info', validateMint, tokenController.getTokenInfo);

// POST /api/tokens/:mint/mint - Mint tokens to recipient
router.post('/:mint/mint', validateMint, tokenController.mintTokens);

// POST /api/tokens/:mint/transfer - Transfer tokens
router.post('/:mint/transfer', validateMint, tokenController.transferTokens);

// GET /api/tokens/:mint/holders - Get token holders
router.get('/:mint/holders', validateMint, tokenController.getTokenHolders);

// DELETE /api/tokens/:id - Delete token from database
router.delete('/:id', tokenController.deleteToken);

module.exports = router;