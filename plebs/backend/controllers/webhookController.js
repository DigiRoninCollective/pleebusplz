const { Pool } = require('pg');
const solanaService = require('../services/solanaService');
const metaplexService = require('../services/metaplexService');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

class TokenController {
  // GET /api/tokens - List all tokens
  async getAllTokens(req, res) {
    try {
      const { page = 1, limit = 20, status } = req.query;
      const offset = (page - 1) * limit;
      
      let query = 'SELECT * FROM tokens';
      let params = [];
      
      if (status) {
        query += ' WHERE status = $1';
        params.push(status);
      }
      
      query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
      params.push(limit, offset);

      const { rows } = await pool.query(query, params);
      
      // Get total count
      const countQuery = status ? 
        'SELECT COUNT(*) FROM tokens WHERE status = $1' : 
        'SELECT COUNT(*) FROM tokens';
      const countParams = status ? [status] : [];
      const { rows: countRows } = await pool.query(countQuery, countParams);
      
      res.json({
        tokens: rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countRows[0].count),
          pages: Math.ceil(countRows[0].count / limit)
        }
      });
    } catch (error) {
      console.error('Error fetching tokens:', error);
      res.status(500).json({ error: 'Failed to fetch tokens' });
    }
  }

  // POST /api/tokens - Create token entry (database only)
  async createToken(req, res) {
    const { name, ticker, description, image_url, total_supply, decimals } = req.body;

    if (!name || !ticker || !description) {
      return res.status(400).json({ error: 'Name, ticker, and description are required' });
    }

    try {
      const result = await pool.query(
        `INSERT INTO tokens (name, ticker, description, image_url, total_supply, decimals, status) 
         VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING *`,
        [name, ticker, description, image_url, total_supply || 1000000, decimals || 9]
      );
      
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error creating token:', error);
      res.status(500).json({ error: 'Failed to create token' });
    }
  }

  // POST /api/tokens/deploy - Deploy token to Solana
  async deployToken(req, res) {
    const { tokenId, decimals = 9 } = req.body;

    if (!tokenId) {
      return res.status(400).json({ error: 'Token ID is required' });
    }

    try {
      // Get token from database
      const { rows } = await pool.query('SELECT * FROM tokens WHERE id = $1', [tokenId]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Token not found' });
      }

      const token = rows[0];
      
      if (token.mint_address) {
        return res.status(400).json({ error: 'Token already deployed' });
      }

      // Create SPL token on Solana
      const tokenResult = await solanaService.createToken(decimals);
      
      // Create metadata using Metaplex
      const metadataResult = await metaplexService.createTokenMetadata({
        mint: tokenResult.mint,
        name: token.name,
        symbol: token.ticker,
        description: token.description,
        image: token.image_url
      });

      // Update database with mint address
      const updateResult = await pool.query(
        `UPDATE tokens SET 
         mint_address = $1, 
         deployed_at = NOW(), 
         status = 'deployed',
         decimals = $2,
         metadata_uri = $3
         WHERE id = $4 RETURNING *`,
        [tokenResult.mint, decimals, metadataResult.uri, tokenId]
      );

      res.json({
        token: updateResult.rows[0],
        mintAddress: tokenResult.mint,
        metadataUri: metadataResult.uri,
        transaction: metadataResult.signature
      });
    } catch (error) {
      console.error('Error deploying token:', error);
      
      // Update status to failed
      await pool.query(
        'UPDATE tokens SET status = $1, error_message = $2 WHERE id = $3',
        ['failed', error.message, tokenId]
      );
      
      res.status(500).json({ error: 'Failed to deploy token', details: error.message });
    }
  }

  // GET /api/tokens/:mint/info - Get on-chain token info
  async getTokenInfo(req, res) {
    const { mint } = req.params;
    const telegramId = req.user?.telegram_id || null; // If you have user info, otherwise null

    try {
      // Log the search action
      await pool.query(
        'INSERT INTO wallet_activity_log (telegram_id, action, details) VALUES ($1, $2, $3)',
        [telegramId, 'search_contract', { contractAddress: mint }]
      );

      const tokenInfo = await solanaService.getTokenInfo(mint);
      const metadata = await metaplexService.getTokenMetadata(mint);
      
      res.json({
        ...tokenInfo,
        metadata
      });
    } catch (error) {
      console.error('Error getting token info:', error);
      res.status(500).json({ error: 'Failed to get token info' });
    }
  }

  // POST /api/tokens/:mint/mint - Mint tokens
  async mintTokens(req, res) {
    const { mint } = req.params;
    const { recipient, amount } = req.body;
    const telegramId = req.user?.telegram_id || null;

    if (!recipient || !amount) {
      return res.status(400).json({ error: 'Recipient and amount are required' });
    }

    try {
      // Log the mint action
      await pool.query(
        'INSERT INTO wallet_activity_log (telegram_id, action, details) VALUES ($1, $2, $3)',
        [telegramId, 'mint_tokens', { mint, recipient, amount }]
      );

      // Create or get token account for recipient
      const tokenAccount = await solanaService.getOrCreateTokenAccount(mint, recipient);
      
      // Mint tokens
      const result = await solanaService.mintTokens(
        mint, 
        tokenAccount.address, 
        amount
      );

      if (!result.success) {
        return res.status(500).json({ error: 'Failed to mint tokens' });
      }

      // Log transaction in database
      await pool.query(
        `INSERT INTO transactions (type, mint_address, recipient, amount, signature, status)
         VALUES ('mint', $1, $2, $3, $4, 'confirmed')`,
        [mint, recipient, amount, result.signature]
      );

      res.json({
        signature: result.signature,
        tokenAccount: tokenAccount.address,
        amount,
        recipient
      });
    } catch (error) {
      console.error('Error minting tokens:', error);
      res.status(500).json({ error: 'Failed to mint tokens' });
    }
  }

  // POST /api/tokens/:mint/transfer - Transfer tokens
  async transferTokens(req, res) {
    const { mint } = req.params;
    const { from, to, amount, owner } = req.body;
    const telegramId = req.user?.telegram_id || null;

    if (!from || !to || !amount || !owner) {
      return res.status(400).json({ error: 'From, to, amount, and owner are required' });
    }

    try {
      // Log the transfer action
      await pool.query(
        'INSERT INTO wallet_activity_log (telegram_id, action, details) VALUES ($1, $2, $3)',
        [telegramId, 'transfer_tokens', { mint, from, to, amount }]
      );

      const result = await solanaService.transferTokens(from, to, owner, amount);
      
      if (!result.success) {
        return res.status(500).json({ error: 'Failed to transfer tokens' });
      }

      // Log transaction
      await pool.query(
        `INSERT INTO transactions (type, mint_address, sender, recipient, amount, signature, status)
         VALUES ('transfer', $1, $2, $3, $4, $5, 'confirmed')`,
        [mint, from, to, amount, result.signature]
      );

      res.json({
        signature: result.signature,
        from,
        to,
        amount
      });
    } catch (error) {
      console.error('Error transferring tokens:', error);
      res.status(500).json({ error: 'Failed to transfer tokens' });
    }
  }

  // GET /api/tokens/:mint/holders - Get token holders
  async getTokenHolders(req, res) {
    const { mint } = req.params;
    const { limit = 100 } = req.query;

    try {
      // This would require indexing token accounts
      // For now, return placeholder
      res.json({
        mint,
        holders: [],
        message: 'Token holder indexing not implemented yet'
      });
    } catch (error) {
      console.error('Error getting token holders:', error);
      res.status(500).json({ error: 'Failed to get token holders' });
    }
  }

  // DELETE /api/tokens/:id - Delete token (database only)
  async deleteToken(req, res) {
    const { id } = req.params;

    try {
      const result = await pool.query('DELETE FROM tokens WHERE id = $1 RETURNING *', [id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Token not found' });
      }

      res.json({ message: 'Token deleted successfully' });
    } catch (error) {
      console.error('Error deleting token:', error);
      res.status(500).json({ error: 'Failed to delete token' });
    }
  }
}

module.exports = new TokenController();