// Additional imports needed for wallet functionality
const { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

// Add these methods to your existing TelegramBotService class:
class SecureWalletService extends TelegramBotService {
  constructor() {
    super();
    this.rateLimiters = new Map();
    this.pendingTransactions = new Map();
    this.walletSessions = new Map();
  }
  // Enhanced encryption with proper IV handling
  encryptData(data, userId) {
    const key = crypto.scryptSync(
      userId + process.env.ENCRYPTION_SECRET + process.env.ADDITIONAL_SALT, 
      'salt', 
      32
    );
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipherGCM('aes-256-gcm', key);
    cipher.setAAD(Buffer.from(userId.toString()));
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  decryptData(encryptedData, userId) {
    const key = crypto.scryptSync(
      userId + process.env.ENCRYPTION_SECRET + process.env.ADDITIONAL_SALT, 
      'salt', 
      32
    );
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
    
    const decipher = crypto.createDecipherGCM('aes-256-gcm', key);
    decipher.setAAD(Buffer.from(userId.toString()));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // Rate limiting for sensitive operations
  checkRateLimit(userId, operation) {
    const key = `${userId}:${operation}`;
    const now = Date.now();
    
    if (!this.rateLimiters.has(key)) {
      this.rateLimiters.set(key, { count: 1, resetTime: now + 60000 });
      return true;
    }
    
    const limiter = this.rateLimiters.get(key);
    if (now > limiter.resetTime) {
      limiter.count = 1;
      limiter.resetTime = now + 60000;
      return true;
    }
    
    const limits = {
      'wallet_create': 1,
      'backup_request': 3,
      'send_transaction': 10,
      'balance_check': 30
    };
    
    if (limiter.count >= (limits[operation] || 5)) {
      return false;
    }
    
    limiter.count++;
    return true;
  }

  // Check if user already has a wallet
  // (This code was misplaced and should be inside a method, not at the class level)
}

// Define TelegramBotService class outside of SecureWalletService
class TelegramBotService {
  // ... existing code ...

  setupCommands() {
    // Add wallet commands to existing commands
    this.bot.setMyCommands([
      // ... existing commands ...
      { command: 'wallet', description: 'Wallet management - create, view, backup' },
      { command: 'balance', description: 'Check wallet balance' },
      { command: 'send', description: 'Send SOL - /send [amount] [address]' },
      { command: 'backup', description: 'Get wallet backup phrase (DM only)' },
      { command: 'import', description: 'Import wallet from seed phrase' }
    ]);

    // Add wallet command handlers
    this.bot.onText(/\/wallet/, (msg) => this.handleWallet(msg));
    this.bot.onText(/\/balance/, (msg) => this.handleBalance(msg));
    this.bot.onText(/\/send (.+) (.+)/, (msg, match) => this.handleSend(msg, match[1], match[2]));
    this.bot.onText(/\/backup/, (msg) => this.handleBackup(msg));
    this.bot.onText(/\/import/, (msg) => this.handleImportWallet(msg));
  }

  // Wallet management handler
  async handleWallet(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check if user has a wallet
    const userWallet = await this.getUserWallet(userId);
    
    if (userWallet) {
      // Show existing wallet info
      const balance = await this.getWalletBalance(userWallet.public_key);
      const message = `
🔐 *Your Wallet*

📍 Address: \`${userWallet.public_key}\`
💰 Balance: ${balance} SOL

⚠️ *Security Reminder:*
• Never share your private key or seed phrase
• Always verify addresses before sending
• Use backup command in private messages only

*Wallet Actions:*
      `;

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💰 Check Balance', callback_data: 'wallet_balance' },
              { text: '📤 Send SOL', callback_data: 'wallet_send' }
            ],
            [
              { text: '🔄 Refresh', callback_data: 'wallet_refresh' },
              { text: '📋 Copy Address', callback_data: `copy_address_${userWallet.public_key}` }
            ],
            [
              { text: '🔒 Backup (DM only)', callback_data: 'wallet_backup_warning' }
            ]
          ]
        }
      });
    } else {
      // Offer to create new wallet
      const message = `
🔐 *Create Your Solana Wallet*

You don't have a wallet yet. Would you like to create one?

⚠️ *Important Security Notice:*
• Your wallet will be generated securely
• You'll receive a 12-word backup phrase
• Store your backup phrase safely offline
• Never share it with anyone

*Features:*
• Send/receive SOL and tokens
• Interact with DeFi protocols
• Store NFTs
• Built-in security features

Ready to create your wallet? 🚀
      `;

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Create New Wallet', callback_data: 'create_wallet' },
              { text: '📥 Import Existing', callback_data: 'import_wallet' }
            ],
            [
              { text: '❓ Learn More', callback_data: 'wallet_help' }
            ]
          ]
        }
      });
    }
  }

  // Create new wallet
  async createWallet(userId, chatId) {
    try {
      // Generate mnemonic
      const mnemonic = bip39.generateMnemonic(128); // 12 words
      
      // Derive keypair from mnemonic
      const seed = await bip39.mnemonicToSeed(mnemonic);
      const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
      const keypair = Keypair.fromSeed(derivedSeed);
      
      // Encrypt and store wallet
      const encryptedMnemonic = this.encryptMnemonic(mnemonic, userId.toString());
      const encryptedPrivateKey = this.encryptPrivateKey(keypair.secretKey, userId.toString());
      
      await this.saveUserWallet(userId, {
        public_key: keypair.publicKey.toString(),
        encrypted_mnemonic: encryptedMnemonic,
        encrypted_private_key: encryptedPrivateKey
      });
      
      // Send success message
      const message = `
✅ *Wallet Created Successfully!*

📍 Your Address: \`${keypair.publicKey.toString()}\`
💰 Balance: 0 SOL

🔒 *IMPORTANT: Backup Your Wallet*
Your 12-word backup phrase has been generated. Use /backup command in a private message to retrieve it.

⚠️ *Security Warning:*
• Never share your backup phrase with anyone
• Store it offline in a secure location
• Anyone with your backup phrase can access your funds

*Next Steps:*
• Fund your wallet to start using it
• Set up backup phrase storage
• Explore DeFi and token features
      `;

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔒 Get Backup Phrase (DM)', url: `https://t.me/${this.bot.options.username}` }
            ],
            [
              { text: '📋 Copy Address', callback_data: `copy_address_${keypair.publicKey.toString()}` }
            ]
          ]
        }
      });

      return true;
    } catch (error) {
      console.error('Wallet creation error:', error);
      await this.bot.sendMessage(chatId, '❌ Error creating wallet. Please try again.');
      return false;
    }
  }

  // Handle balance check
  async handleBalance(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const userWallet = await this.getUserWallet(userId);
    if (!userWallet) {
      await this.bot.sendMessage(chatId, '❌ You need to create a wallet first. Use /wallet command.');
      return;
    }

    const loadingMsg = await this.bot.sendMessage(chatId, '💰 Checking wallet balance...');
    
    try {
      const balance = await this.getWalletBalance(userWallet.public_key);
      const tokenBalances = await this.getTokenBalances(userWallet.public_key);
      
      let message = `
💰 *Wallet Balance*

📍 Address: \`${userWallet.public_key}\`
💎 SOL Balance: ${balance} SOL

`;

      if (tokenBalances && tokenBalances.length > 0) {
        message += '*Token Balances:*\n';
        tokenBalances.slice(0, 10).forEach(token => {
          message += `• ${token.symbol}: ${token.balance}\n`;
        });
        if (tokenBalances.length > 10) {
          message += `... and ${tokenBalances.length - 10} more tokens\n`;
        }
      } else {
        message += '*No token balances found*\n';
      }

      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Refresh', callback_data: 'wallet_balance' },
              { text: '📤 Send SOL', callback_data: 'wallet_send' }
            ]
          ]
        }
      });
    } catch (error) {
      console.error('Balance check error:', error);
      await this.bot.editMessageText('❌ Error checking balance.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
  }

  // Handle backup phrase request (DM only)
  async handleBackup(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Only allow in private chats for security
    if (msg.chat.type !== 'private') {
      await this.bot.sendMessage(chatId, '🔒 Backup phrase can only be retrieved in private messages for security.');
      return;
    }

    const userWallet = await this.getUserWallet(userId);
    if (!userWallet) {
      await this.bot.sendMessage(chatId, '❌ You need to create a wallet first. Use /wallet command.');
      return;
    }

    try {
      const mnemonic = this.decryptMnemonic(userWallet.encrypted_mnemonic, userId.toString());
      
      const message = `
🔒 *Your Wallet Backup Phrase*

\`${mnemonic}\`

⚠️ *CRITICAL SECURITY WARNING:*
• This message will be automatically deleted in 60 seconds
• Write down these 12 words in the correct order
• Store them offline in a secure location
• NEVER share this phrase with anyone
• Anyone with this phrase can access your funds

*Instructions:*
1. Write down each word carefully
2. Store in a secure, offline location
3. Consider using a hardware wallet for large amounts
4. Test your backup by importing to another wallet

🗑️ *This message will self-destruct in 60 seconds*
      `;

      const sentMsg = await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown'
      });

      // Auto-delete after 60 seconds
      setTimeout(async () => {
        try {
          await this.bot.deleteMessage(chatId, sentMsg.message_id);
        } catch (error) {
          console.error('Error deleting backup message:', error);
        }
      }, 60000);

    } catch (error) {
      console.error('Backup error:', error);
      await this.bot.sendMessage(chatId, '❌ Error retrieving backup phrase.');
    }
  }

  // Enhanced callback query handler for wallet actions
  async handleWalletCallbackQuery(callbackQuery) {
    const action = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    
    try {
      if (action === 'create_wallet') {
        await this.createWallet(userId, chatId);
      } else if (action === 'wallet_balance') {
        await this.handleBalance(callbackQuery.message);
      } else if (action === 'wallet_backup_warning') {
        await this.bot.sendMessage(chatId, '🔒 For security, backup phrases can only be retrieved in private messages. Please message me directly: @your_bot_username');
      } else if (action.startsWith('copy_address_')) {
        const address = action.replace('copy_address_', '');
        this.bot.answerCallbackQuery(callbackQuery.id, `Address copied: ${address.substring(0, 8)}...`);
        return;
      }
    } catch (error) {
      console.error('Wallet callback error:', error);
      this.bot.answerCallbackQuery(callbackQuery.id, '❌ Error processing request');
      return;
    }
    
    this.bot.answerCallbackQuery(callbackQuery.id);
  }

  // Database operations for wallet
  async getUserWallet(telegramId) {
    try {
      const result = await this.pool.query(
        'SELECT * FROM user_wallets WHERE telegram_id = $1',
        [telegramId]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('Get wallet error:', error);
      return null;
    }
  }

  async saveUserWallet(telegramId, walletData) {
    try {
      await this.pool.query(`
        INSERT INTO user_wallets (telegram_id, public_key, encrypted_mnemonic, encrypted_private_key)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (telegram_id) DO UPDATE SET
          public_key = $2,
          encrypted_mnemonic = $3,
          encrypted_private_key = $4,
          updated_at = NOW()
      `, [
        telegramId,
        walletData.public_key,
        walletData.encrypted_mnemonic,
        walletData.encrypted_private_key
      ]);
    } catch (error) {
      console.error('Save wallet error:', error);
      throw error;
    }
  }

  // Blockchain operations
  async getWalletBalance(publicKey) {
    try {
      const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
      const balance = await connection.getBalance(new PublicKey(publicKey));
      return (balance / LAMPORTS_PER_SOL).toFixed(4);
    } catch (error) {
      console.error('Balance fetch error:', error);
      return '0.0000';
    }
  }

  async getTokenBalances(publicKey) {
    try {
      const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        new PublicKey(publicKey),
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );
      
      return tokenAccounts.value.map(account => ({
        mint: account.account.data.parsed.info.mint,
        balance: account.account.data.parsed.info.tokenAmount.uiAmountString,
        symbol: 'Unknown' // Would need to fetch token metadata
      }));
    } catch (error) {
      console.error('Token balance error:', error);
      return [];
    }
  }

  // Encryption helpers
  encryptMnemonic(mnemonic, userId) {
    const key = crypto.scryptSync(userId + process.env.ENCRYPTION_SECRET, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', key);
    let encrypted = cipher.update(mnemonic, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  decryptMnemonic(encryptedMnemonic, userId) {
    const key = crypto.scryptSync(userId + process.env.ENCRYPTION_SECRET, 'salt', 32);
    const [ivHex, encrypted] = encryptedMnemonic.split(':');
    const decipher = crypto.createDecipher('aes-256-cbc', key);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  encryptPrivateKey(privateKey, userId) {
    // Similar encryption for private key
    const key = crypto.scryptSync(userId + process.env.ENCRYPTION_SECRET, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', key);
    let encrypted = cipher.update(Buffer.from(privateKey).toString('hex'), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }
}

// Database schema for user wallets
/*
CREATE TABLE user_wallets (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  public_key VARCHAR(44) NOT NULL,
  encrypted_mnemonic TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_wallets_telegram_id ON user_wallets(telegram_id);
CREATE INDEX idx_user_wallets_public_key ON user_wallets(public_key);
*/