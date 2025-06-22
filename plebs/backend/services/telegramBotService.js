// Complete Telegram Bot Service with Chat Room Integration
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
const { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

class TelegramBotService {
  constructor() {
    // Initialize bot
    this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
    
    // Initialize database connection
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    // Initialize Solana connection
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );
    
    // Security and rate limiting
    this.rateLimiters = new Map();
    this.pendingTransactions = new Map();
    this.walletSessions = new Map();
    this.mnemonicListeners = new Map();
    
    // Chat room integration
    this.websiteUrl = process.env.WEBSITE_URL || 'https://yourwebsite.com';
    this.jwtSecret = process.env.JWT_SECRET || 'your-jwt-secret-key';
    
    // Setup bot commands, handlers, and database
    this.initializeDatabase();
    this.setupCommands();
    this.setupEventHandlers();
  }

  // Initialize database tables
  async initializeDatabase() {
    const client = await this.pool.connect();
    try {
      // Users table
      await client.query(`
        CREATE TABLE IF NOT EXISTS telegram_users (
          id SERIAL PRIMARY KEY,
          telegram_id BIGINT UNIQUE NOT NULL,
          username VARCHAR(255),
          public_key VARCHAR(44) NOT NULL,
          encrypted_mnemonic TEXT NOT NULL,
          encrypted_private_key TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Sessions table for web integration
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          id SERIAL PRIMARY KEY,
          telegram_id BIGINT NOT NULL,
          session_token TEXT NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (telegram_id) REFERENCES telegram_users(telegram_id)
        )
      `);
      
      // Token holdings table for chat room access
      await client.query(`
        CREATE TABLE IF NOT EXISTS token_holdings (
          id SERIAL PRIMARY KEY,
          telegram_id BIGINT NOT NULL,
          token_address VARCHAR(44) NOT NULL,
          balance DECIMAL(20, 9) NOT NULL,
          last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (telegram_id) REFERENCES telegram_users(telegram_id),
          UNIQUE(telegram_id, token_address)
        )
      `);
      
      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Database initialization error:', error);
    } finally {
      client.release();
    }
  }

  // FIXED: Consistent encryption using AES-256-GCM
  encryptSensitiveData(data, userId) {
    try {
      const key = crypto.scryptSync(
        `${userId}:${process.env.ENCRYPTION_SECRET}:${process.env.ADDITIONAL_SALT || 'default'}`, 
        'salt', 
        32
      );
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipherGCM('aes-256-gcm', key);
      cipher.setAAD(Buffer.from(userId.toString()));
      
      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  // FIXED: Matching decryption using AES-256-GCM
  decryptSensitiveData(encryptedData, userId) {
    try {
      const key = crypto.scryptSync(
        `${userId}:${process.env.ENCRYPTION_SECRET}:${process.env.ADDITIONAL_SALT || 'default'}`, 
        'salt', 
        32
      );
      const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
      
      if (!ivHex || !authTagHex || !encrypted) {
        throw new Error('Invalid encrypted data format');
      }
      
      const decipher = crypto.createDecipherGCM('aes-256-gcm', key);
      decipher.setAAD(Buffer.from(userId.toString()));
      decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  // Rate limiting with better error handling
  checkRateLimit(userId, operation) {
    const key = `${userId}:${operation}`;
    const now = Date.now();
    
    if (!this.rateLimiters.has(key)) {
      this.rateLimiters.set(key, { count: 1, resetTime: now + 60000 });
      return { allowed: true, remaining: this.getLimitForOperation(operation) - 1 };
    }
    
    const limiter = this.rateLimiters.get(key);
    if (now > limiter.resetTime) {
      limiter.count = 1;
      limiter.resetTime = now + 60000;
      return { allowed: true, remaining: this.getLimitForOperation(operation) - 1 };
    }
    
    const limit = this.getLimitForOperation(operation);
    if (limiter.count >= limit) {
      const waitTime = Math.ceil((limiter.resetTime - now) / 1000);
      return { allowed: false, waitTime, remaining: 0 };
    }
    
    limiter.count++;
    return { allowed: true, remaining: limit - limiter.count };
  }

  getLimitForOperation(operation) {
    const limits = {
      'wallet_create': 1,
      'backup_request': 3,
      'send_transaction': 10,
      'balance_check': 30,
      'import_wallet': 2,
      'login_request': 10,
      'token_check': 20
    };
    return limits[operation] || 5;
  }

  // Input validation
  validateSolanaAddress(address) {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  validateAmount(amount) {
    const num = parseFloat(amount);
    return !isNaN(num) && num > 0 && num <= 1000000 && num.toString().split('.')[1]?.length <= 9;
  }

  validateMnemonic(mnemonic) {
    return bip39.validateMnemonic(mnemonic.trim());
  }

  // Setup bot commands
  setupCommands() {
    this.bot.setMyCommands([
      { command: 'start', description: 'Start the bot and access chat rooms' },
      { command: 'login', description: 'Login to website chat rooms' },
      { command: 'wallet', description: 'Wallet management - create, view, backup' },
      { command: 'balance', description: 'Check wallet balance' },
      { command: 'tokens', description: 'Check token holdings for chat access' },
      { command: 'send', description: 'Send SOL - /send [amount] [address]' },
      { command: 'backup', description: 'Get wallet backup phrase (DM only)' },
      { command: 'import', description: 'Import wallet from seed phrase' },
      { command: 'help', description: 'Show help information' },
      { command: 'buy', description: 'Buy tokens - /buy' },
      { command: 'sell', description: 'Sell tokens - /sell' },
      { command: 'swap', description: 'Swap tokens - /swap' }
    ]);

    // Command handlers
    this.bot.onText(/\/start/, (msg) => this.handleStart(msg));
    this.bot.onText(/\/login/, (msg) => this.handleLogin(msg));
    this.bot.onText(/\/help/, (msg) => this.handleHelp(msg));
    this.bot.onText(/\/wallet/, (msg) => this.handleWallet(msg));
    this.bot.onText(/\/balance/, (msg) => this.handleBalance(msg));
    this.bot.onText(/\/tokens(?:\s+(\S+))?/, (msg, match) => this.handleTokens(msg, match));
    this.bot.onText(/\/send(?:\s+([0-9.]+)\s+(\S+))?/, (msg, match) => this.handleSend(msg, match));
    this.bot.onText(/\/backup/, (msg) => this.handleBackup(msg));
    this.bot.onText(/\/import/, (msg) => this.handleImportWallet(msg));
    this.bot.onText(/\/buy/, (msg) => this.handleBuy(msg));
    this.bot.onText(/\/sell/, (msg) => this.handleSell(msg));
    this.bot.onText(/\/swap/, (msg) => this.handleSwap(msg));
    this.bot.onText(/\/comment (\S+) ([\s\S]+)/, (msg, match) => this.handleComment(msg, match));
  }

  setupEventHandlers() {
    // Handle callback queries
    this.bot.on('callback_query', (query) => this.handleCallbackQuery(query));
    
    // Handle errors
    this.bot.on('error', (error) => {
      console.error('Bot error:', error);
    });

    // Handle polling errors
    this.bot.on('polling_error', (error) => {
      console.error('Polling error:', error);
    });
  }

  // NEW: Handle login to website chat rooms
  async handleLogin(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
      const rateCheck = this.checkRateLimit(userId, 'login_request');
      if (!rateCheck.allowed) {
        await this.bot.sendMessage(chatId, `⏳ Too many login attempts. Please wait ${rateCheck.waitTime} seconds.`);
        return;
      }

      const userWallet = await this.getUserWallet(userId);
      if (!userWallet) {
        await this.bot.sendMessage(chatId, '❌ You need to create a wallet first. Use /wallet command.', {
          reply_markup: {
            inline_keyboard: [[
              { text: '🔐 Create Wallet', callback_data: 'create_wallet' }
            ]]
          }
        });
        return;
      }

      // Create session token
      const sessionToken = this.generateSessionToken(userId);
      await this.saveUserSession(userId, sessionToken);
      
      // Get user's token holdings for chat room access
      await this.updateTokenHoldings(userId, userWallet.public_key);
      const holdings = await this.getUserTokenHoldings(userId);
      
      const loginUrl = `${this.websiteUrl}/auth/telegram?token=${sessionToken}`;
      
      let message = `🚀 *Login to Chat Rooms*\n\n`;
      message += `📍 Your Wallet: \`${userWallet.public_key}\`\n\n`;
      
      if (holdings.length > 0) {
        message += `🎫 *Your Token Access:*\n`;
        holdings.slice(0, 5).forEach(token => {
          message += `• ${token.token_address.substring(0, 8)}...${token.token_address.substring(-4)}: ${token.balance}\n`;
        });
        if (holdings.length > 5) {
          message += `... and ${holdings.length - 5} more tokens\n`;
        }
        message += `\n✅ Click below to access your token-gated chat rooms!\n`;
      } else {
        message += `❌ *No tokens found*\nYou need to hold tokens to access chat rooms.\n\n`;
        message += `💡 *Tip:* Buy tokens first, then use /tokens to refresh your holdings.\n`;
      }
      
      message += `\n⏰ Session expires in 24 hours`;

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🌐 Open Chat Rooms', url: loginUrl }],
            [
              { text: '🔄 Refresh Tokens', callback_data: 'refresh_tokens' },
              { text: '💰 Check Balance', callback_data: 'wallet_balance' }
            ]
          ]
        }
      });

    } catch (error) {
      console.error('Login handler error:', error);
      await this.bot.sendMessage(chatId, '❌ Error generating login. Please try again.');
    }
  }

  // NEW: Handle token holdings check
  async handleTokens(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const specificToken = match && match[1] ? match[1] : null;
    
    try {
      const rateCheck = this.checkRateLimit(userId, 'token_check');
      if (!rateCheck.allowed) {
        await this.bot.sendMessage(chatId, `⏳ Too many token checks. Please wait ${rateCheck.waitTime} seconds.`);
        return;
      }

      const userWallet = await this.getUserWallet(userId);
      if (!userWallet) {
        await this.bot.sendMessage(chatId, '❌ You need to create a wallet first. Use /wallet command.');
        return;
      }

      const loadingMsg = await this.bot.sendMessage(chatId, '🔍 Checking token holdings...');
      
      // Update token holdings from blockchain
      await this.updateTokenHoldings(userId, userWallet.public_key);
      let holdings = await this.getUserTokenHoldings(userId);
      
      // Filter for specific token if provided
      if (specificToken) {
        if (this.validateSolanaAddress(specificToken)) {
          holdings = holdings.filter(h => h.token_address === specificToken);
        } else {
          await this.bot.editMessageText('❌ Invalid token address provided.', {
            chat_id: chatId,
            message_id: loadingMsg.message_id
          });
          return;
        }
      }

      let message = `🎫 *Token Holdings*\n\n`;
      message += `📍 Wallet: \`${userWallet.public_key}\`\n\n`;
      
      if (holdings.length > 0) {
        message += `*Your Tokens (${holdings.length} total):*\n\n`;
        
        const displayHoldings = specificToken ? holdings : holdings.slice(0, 15);
        displayHoldings.forEach((token, index) => {
          message += `${index + 1}. **Token:** \`${token.token_address}\`\n`;
          message += `   **Balance:** ${token.balance}\n`;
          message += `   **Updated:** ${new Date(token.last_updated).toLocaleString()}\n\n`;
        });
        
        if (!specificToken && holdings.length > 15) {
          message += `... and ${holdings.length - 15} more tokens\n\n`;
          message += `💡 Use \`/tokens [token_address]\` to check a specific token\n\n`;
        }
        
        message += `✅ These tokens give you access to their respective chat rooms!`;
      } else {
        message += `❌ No tokens found in your wallet.\n\n`;
        message += `💡 **To access chat rooms:**\n`;
        message += `1. Buy tokens on a DEX (Jupiter, Raydium, etc.)\n`;
        message += `2. Send tokens to your wallet address\n`;
        message += `3. Use /tokens to refresh your holdings\n`;
        message += `4. Use /login to access token-gated chats`;
      }
      
      message += `\n\n⏱️ Last updated: ${new Date().toLocaleTimeString()}`;

      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Refresh', callback_data: 'refresh_tokens' },
              { text: '🚀 Login to Chats', callback_data: 'login_website' }
            ],
            [
              { text: '💰 Check SOL Balance', callback_data: 'wallet_balance' }
            ]
          ]
        }
      });

    } catch (error) {
      console.error('Token check error:', error);
      await this.bot.editMessageText('❌ Error checking tokens. Please try again.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
  }

  async handleStart(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
      const existingUser = await this.getUserWallet(userId);
      
      if (existingUser) {
        // Existing user - show login option
        const message = `
🚀 *Welcome back to Solana Chat Rooms!*

Your wallet is ready to access token-gated chat rooms.

📍 **Your Wallet:** \`${existingUser.public_key}\`

*Quick Actions:*
• 🌐 Login to chat rooms
• 💰 Check wallet balance  
• 🎫 View token holdings
• 📤 Send transactions

Ready to join the conversation? 💬
        `;

        await this.bot.sendMessage(chatId, message, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🚀 Login to Chat Rooms', callback_data: 'login_website' }
              ],
              [
                { text: '🎫 Check Tokens', callback_data: 'refresh_tokens' },
                { text: '💰 Check Balance', callback_data: 'wallet_balance' }
              ],
              [
                { text: '🔧 Wallet Settings', callback_data: 'wallet_settings' }
              ]
            ]
          }
        });
      } else {
        // New user - show welcome and setup
        const message = `
🎉 *Welcome to Solana Chat Rooms!*

Join exclusive token-gated communities and chat with fellow holders!

*What you can do:*
• 🔐 Create a secure Solana wallet
• 💰 Send and receive SOL & tokens  
• 🎫 Access token-gated chat rooms
• 💬 Chat with other token holders
• 🛡️ Military-grade encryption

*How it works:*
1. Create or import your wallet
2. Hold tokens to unlock chat rooms
3. Use your tokens as keys to exclusive communities

Ready to get started? 🚀
        `;

        await this.bot.sendMessage(chatId, message, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔐 Create New Wallet', callback_data: 'create_wallet' },
                { text: '📥 Import Wallet', callback_data: 'import_wallet' }
              ],
              [
                { text: '❓ How it Works', callback_data: 'show_help' },
                { text: '🔒 Security Info', callback_data: 'security_info' }
              ]
            ]
          }
        });
      }
    } catch (error) {
      console.error('Start command error:', error);
      await this.bot.sendMessage(chatId, '❌ Something went wrong. Please try again.');
    }
  }

  async handleHelp(msg) {
    const chatId = msg.chat.id;
    const message = `
❓ *Solana Chat Rooms Help*

*🏠 Main Features:*
• Token-gated chat rooms
• Secure Solana wallet management
• Send/receive SOL and tokens
• Real-time token balance tracking

*🔧 Commands:*
• \`/start\` - Main menu and login
• \`/login\` - Access website chat rooms  
• \`/wallet\` - Wallet management
• \`/balance\` - Check SOL balance
• \`/tokens\` - View token holdings
• \`/send [amount] [address]\` - Send SOL
• \`/backup\` - Get backup phrase (DM only)
• \`/import\` - Import existing wallet
• \`/buy\` - Buy tokens
• \`/sell\` - Sell tokens
• \`/swap\` - Swap tokens

*🎫 Chat Room Access:*
1. Hold any amount of a token
2. Use /login to generate access link
3. Click link to join token's chat room
4. Chat with other token holders!

*🔒 Security Features:*
• AES-256-GCM encryption
• Rate limiting protection  
• Auto-deleting sensitive messages
• Private key never exposed

*💡 Tips:*
• Always verify addresses before sending
• Keep your backup phrase offline
• Use small amounts for testing
• Check token holdings regularly

Need support? Contact @${process.env.SUPPORT_USERNAME || 'support'}
    `;

    await this.bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🚀 Get Started', callback_data: 'create_wallet' },
            { text: '🌐 Login to Chats', callback_data: 'login_website' }
          ]
        ]
      }
    });
  }

  // Continue with existing wallet methods...
  async handleWallet(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
      const userWallet = await this.getUserWallet(userId);
      
      if (userWallet) {
        await this.showExistingWallet(chatId, userWallet);
      } else {
        await this.showWalletCreationOptions(chatId);
      }
    } catch (error) {
      console.error('Wallet handler error:', error);
      await this.bot.sendMessage(chatId, '❌ Error accessing wallet. Please try again.');
    }
  }

  async showExistingWallet(chatId, userWallet) {
    try {
      const balance = await this.getWalletBalance(userWallet.public_key);
      const message = `
🔐 *Your Solana Wallet*

📍 Address: \`${userWallet.public_key}\`
💰 Balance: ${balance} SOL

⚠️ *Security Reminder:*
• Never share your private key or seed phrase
• Always verify addresses before sending
• Use backup command in private messages only

*Available Actions:*
      `;

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💰 Check Balance', callback_data: 'wallet_balance' },
              { text: '🎫 Check Tokens', callback_data: 'refresh_tokens' }
            ],
            [
              { text: '📤 Send SOL', callback_data: 'wallet_send' },
              { text: '🚀 Login to Chats', callback_data: 'login_website' }
            ],
            [
              { text: '🔄 Refresh', callback_data: 'wallet_refresh' },
              { text: '📋 Copy Address', callback_data: `copy_${userWallet.public_key}` }
            ],
            [
              { text: '🔒 Backup (DM only)', callback_data: 'wallet_backup_warning' }
            ]
          ]
        }
      });
    } catch (error) {
      console.error('Show wallet error:', error);
      throw error;
    }
  }

  async showWalletCreationOptions(chatId) {
    const message = `
🔐 *Create Your Solana Wallet*

You don't have a wallet yet. Choose an option:

⚠️ *Security Notice:*
• Your wallet will be generated securely
• You'll receive a 12-word backup phrase
• Store your backup phrase safely offline
• Never share it with anyone

*Wallet Features:*
• Send/receive SOL and tokens
• Access token-gated chat rooms
• Interact with DeFi protocols
• Store NFTs
• Built-in security features
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
            { text: '❓ Security Info', callback_data: 'security_info' }
          ]
        ]
      }
    });
  }

  // Database helper methods
  async getUserWallet(telegramId) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM telegram_users WHERE telegram_id = $1',
        [telegramId]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  async saveUserWallet(telegramId, walletData) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        INSERT INTO telegram_users (telegram_id, public_key, encrypted_mnemonic, encrypted_private_key)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (telegram_id) 
        DO UPDATE SET 
          public_key = EXCLUDED.public_key,
          encrypted_mnemonic = EXCLUDED.encrypted_mnemonic,
          encrypted_private_key = EXCLUDED.encrypted_private_key,
          last_active = CURRENT_TIMESTAMP
        RETURNING *
      `, [
        telegramId,
        walletData.public_key,
        walletData.encrypted_mnemonic,
        walletData.encrypted_private_key
      ]);
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  // NEW: Session management for website integration
  generateSessionToken(telegramId) {
    return jwt.sign(
      { 
        telegramId, 
        timestamp: Date.now(),
        type: 'telegram_auth'
      },
      this.jwtSecret,
      { expiresIn: '24h' }
    );
  }

  async saveUserSession(telegramId, sessionToken) {
    const client = await this.pool.connect();
    try {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      
      await client.query(`
        INSERT INTO user_sessions (telegram_id, session_token, expires_at)
        VALUES ($1, $2, $3)
      `, [telegramId, sessionToken, expiresAt]);
      
      return sessionToken;
    } finally {
      client.release();
    }
  }

  // NEW: Token holdings management
  async updateTokenHoldings(telegramId, walletAddress) {
    try {
      // Get token accounts from Solana
      const tokenAccounts = await this.connection.getTokenAccountsByOwner(
        new PublicKey(walletAddress),
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );

      const client = await this.pool.connect();
      try {
        // Clear existing holdings
        await client.query(
          'DELETE FROM token_holdings WHERE telegram_id = $1',
          [telegramId]
        );

        // Insert current holdings
        for (const accountInfo of tokenAccounts.value) {
          const tokenBalance = await this.connection.getTokenAccountBalance(accountInfo.pubkey);
          const mintAddress = accountInfo.account.data.parsed.info.mint;
          const balance = tokenBalance.value.uiAmount || 0;
          
          if (balance > 0) {
            await client.query(`
              INSERT INTO token_holdings (telegram_id, token_address, balance)
              VALUES ($1, $2, $3)
            `, [telegramId, mintAddress, balance]);
          }
        }
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error updating token holdings:', error);
      throw error;
    }
  }

  async getUserTokenHoldings(telegramId) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM token_holdings WHERE telegram_id = $1 ORDER BY balance DESC',
        [telegramId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  // Solana helper methods
  async getWalletBalance(publicKey) {
    try {
      const balance = await this.connection.getBalance(new PublicKey(publicKey));
      return (balance / LAMPORTS_PER_SOL).toFixed(4);
    } catch (error) {
      console.error('Balance check error:', error);
      return '0.0000';
    }
  }

  async getTokenBalances(publicKey) {
    try {
      const tokenAccounts = await this.connection.getTokenAccountsByOwner(
        new PublicKey(publicKey),
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );

      const balances = [];
      for (const accountInfo of tokenAccounts.value) {
        const tokenBalance = await this.connection.getTokenAccountBalance(accountInfo.pubkey);
        if (tokenBalance.value.uiAmount && tokenBalance.value.uiAmount > 0) {
          balances.push({
            mint: accountInfo.account.data.parsed.info.mint,
            balance: tokenBalance.value.uiAmount,
            decimals: tokenBalance.value.decimals
          });
        }
      }
      return balances;
    } catch (error) {
      console.error('Token balance error:', error);
      return [];
    }
  }

  // Continue with other existing methods (createWallet, handleBalance, handleSend, etc.)
  async handleBalance(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
      const userWallet = await this.getUserWallet(userId);
      if (!userWallet) {
        await this.bot.sendMessage(chatId, '❌ You need to create a wallet first. Use /wallet command.');
        return;
      }

      const balance = await this.getWalletBalance(userWallet.public_key);
  const message = `
💰 *Wallet Balance*

📍 Address: \`${userWallet.public_key}\`
💰 Balance: ${balance} SOL

*Recent Update:* ${new Date().toLocaleTimeString()}
  `;

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Refresh', callback_data: 'wallet_balance' },
              { text: '🎫 Check Tokens', callback_data: 'refresh_tokens' }
            ],
            [
              { text: '📤 Send SOL', callback_data: 'wallet_send' },
              { text: '🚀 Login to Chats', callback_data: 'login_website' }
            ]
          ]
        }
      });
    } catch (error) {
      console.error('Balance check error:', error);
      await this.bot.sendMessage(chatId, '❌ Error checking balance. Please try again.');
    }
  }

  async handleSend(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
      const userWallet = await this.getUserWallet(userId);
      if (!userWallet) {
        await this.bot.sendMessage(chatId, '❌ You need to create a wallet first. Use /wallet command.');
        return;
      }

      if (!match || !match[1] || !match[2]) {
        await this.bot.sendMessage(chatId, `
📤 *Send SOL*

Usage: \`/send [amount] [address]\`

Example: \`/send 0.1 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM\`

⚠️ *Important:*
• Always double-check the recipient address
• Start with small amounts for testing
• Transaction fees will be deducted
• Transactions are irreversible
        `, { parse_mode: 'Markdown' });
        return;
      }

      const amount = match[1];
      const recipientAddress = match[2];

      // Validate inputs
      if (!this.validateAmount(amount)) {
        await this.bot.sendMessage(chatId, '❌ Invalid amount. Please enter a valid number (max 1,000,000 SOL, max 9 decimals).');
        return;
      }

      if (!this.validateSolanaAddress(recipientAddress)) {
        await this.bot.sendMessage(chatId, '❌ Invalid Solana address. Please check and try again.');
        return;
      }

      // Rate limiting
      const rateCheck = this.checkRateLimit(userId, 'send_transaction');
      if (!rateCheck.allowed) {
        await this.bot.sendMessage(chatId, `⏳ Too many transactions. Please wait ${rateCheck.waitTime} seconds.`);
        return;
      }

      // Check balance
      const balance = parseFloat(await this.getWalletBalance(userWallet.public_key));
      const sendAmount = parseFloat(amount);
      const estimatedFee = 0.000005; // 5000 lamports estimate

      if (balance < sendAmount + estimatedFee) {
        await this.bot.sendMessage(chatId, `❌ Insufficient balance. You have ${balance} SOL, but need ${sendAmount + estimatedFee} SOL (including fees).`);
        return;
      }

      // Show confirmation
      const confirmationMessage = `
🔍 *Transaction Confirmation*

**From:** \`${userWallet.public_key}\`
**To:** \`${recipientAddress}\`
**Amount:** ${sendAmount} SOL
**Network Fee:** ~${estimatedFee} SOL
**Total:** ~${sendAmount + estimatedFee} SOL

⚠️ **Warning:** This transaction cannot be reversed!

Confirm to proceed:
      `;

      const confirmationKeyboard = {
        inline_keyboard: [
          [
            { text: '✅ Confirm Send', callback_data: `confirm_send_${sendAmount}_${recipientAddress}` },
            { text: '❌ Cancel', callback_data: 'cancel_send' }
          ]
        ]
      };

      await this.bot.sendMessage(chatId, confirmationMessage, {
        parse_mode: 'Markdown',
        reply_markup: confirmationKeyboard
      });

    } catch (error) {
      console.error('Send handler error:', error);
      await this.bot.sendMessage(chatId, '❌ Error processing send request. Please try again.');
    }
  }

  async handleBackup(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Only allow in private chats
    if (msg.chat.type !== 'private') {
      await this.bot.sendMessage(chatId, '🔒 Backup commands only work in private messages. Please DM me directly for security.');
      return;
    }

    try {
      const rateCheck = this.checkRateLimit(userId, 'backup_request');
      if (!rateCheck.allowed) {
        await this.bot.sendMessage(chatId, `⏳ Too many backup requests. Please wait ${rateCheck.waitTime} seconds.`);
        return;
      }

      const userWallet = await this.getUserWallet(userId);
      if (!userWallet) {
        await this.bot.sendMessage(chatId, '❌ You need to create a wallet first. Use /wallet command.');
        return;
      }

      const warningMessage = `
🔒 **WALLET BACKUP WARNING**

⚠️ **EXTREME CAUTION REQUIRED** ⚠️

Your backup phrase will be shown in the next message. This phrase gives COMPLETE ACCESS to your wallet and funds.

**Security Rules:**
• Screenshot or write down your backup phrase
• Store it in a secure, offline location
• NEVER share it with anyone
• NEVER enter it on suspicious websites
• Anyone with this phrase can steal your funds

**This message will auto-delete in 5 minutes for security.**

Are you ready to see your backup phrase?
      `;

      await this.bot.sendMessage(chatId, warningMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Show Backup Phrase', callback_data: 'show_backup_phrase' },
              { text: '❌ Cancel', callback_data: 'cancel_backup' }
            ]
          ]
        }
      });

    } catch (error) {
      console.error('Backup handler error:', error);
      await this.bot.sendMessage(chatId, '❌ Error accessing backup. Please try again.');
    }
  }

  async handleImportWallet(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Only allow in private chats
    if (msg.chat.type !== 'private') {
      await this.bot.sendMessage(chatId, '🔒 Import commands only work in private messages. Please DM me directly for security.');
      return;
    }

    try {
      const rateCheck = this.checkRateLimit(userId, 'import_wallet');
      if (!rateCheck.allowed) {
        await this.bot.sendMessage(chatId, `⏳ Too many import attempts. Please wait ${rateCheck.waitTime} seconds.`);
        return;
      }

      const existingWallet = await this.getUserWallet(userId);
      if (existingWallet) {
        await this.bot.sendMessage(chatId, `
⚠️ **You already have a wallet!**

Address: \`${existingWallet.public_key}\`

Importing a new wallet will replace your current one. Make sure you have your current wallet backed up!

**This action cannot be undone.**
        `, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔄 Replace Wallet', callback_data: 'confirm_import_replace' },
                { text: '❌ Cancel', callback_data: 'cancel_import' }
              ],
              [
                { text: '🔒 Backup Current Wallet', callback_data: 'show_backup_phrase' }
              ]
            ]
          }
        });
        return;
      }

      // New user - show import instructions
      const message = `
📥 **Import Existing Wallet**

You can import your existing Solana wallet using your 12 or 24-word seed phrase.

**Instructions:**
1. Have your seed phrase ready
2. Click "Start Import" below
3. Send your seed phrase as a message
4. Your wallet will be imported securely

**Security Notes:**
• Your seed phrase will be encrypted and stored securely
• The original message will be auto-deleted
• Only import in this private chat
• Make sure you trust this seed phrase

Ready to import your wallet?
      `;

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📥 Start Import', callback_data: 'start_import_process' },
              { text: '❌ Cancel', callback_data: 'cancel_import' }
            ],
            [
              { text: '🔐 Create New Instead', callback_data: 'create_wallet' }
            ]
          ]
        }
      });

    } catch (error) {
      console.error('Import handler error:', error);
      await this.bot.sendMessage(chatId, '❌ Error starting import process. Please try again.');
    }
  }

  // Callback query handler
  async handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;
    
    try {
      await this.bot.answerCallbackQuery(query.id);
      
      switch (data) {
        case 'create_wallet':
          await this.createWallet(chatId, userId);
          break;
          
        case 'login_website':
          await this.handleLogin({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'refresh_tokens':
          await this.handleTokens({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'wallet_balance':
          await this.handleBalance({ chat: { id: chatId }, from: { id: userId } });
          break;
          
        case 'wallet_send':
          await this.bot.editMessageText(`
📤 **Send SOL**

Use the command: \`/send [amount] [address]\`

**Example:** \`/send 0.1 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM\`

**Tips:**
• Double-check the recipient address
• Start with small amounts
• Consider network fees (~0.000005 SOL)
          `, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown'
          });
          break;
          
        case 'show_backup_phrase':
          await this.showBackupPhrase(chatId, userId, query.message.message_id);
          break;
          
        case 'start_import_process':
          await this.startImportProcess(chatId, userId);
          break;
          
        case 'security_info':
          await this.showSecurityInfo(chatId, query.message.message_id);
          break;
          
        case 'show_help':
          await this.handleHelp({ chat: { id: chatId } });
          break;
          
        default:
          if (data.startsWith('confirm_send_')) {
            await this.processSendTransaction(chatId, userId, data, query.message.message_id);
          } else if (data.startsWith('copy_')) {
            const address = data.replace('copy_', '');
            await this.bot.answerCallbackQuery(query.id, { 
              text: `Address copied: ${address.substring(0, 20)}...`,
              show_alert: true 
            });
          }
          break;
      }
    } catch (error) {
      console.error('Callback query error:', error);
      await this.bot.answerCallbackQuery(query.id, { text: 'Error occurred. Please try again.' });
    }
  }

  // Create wallet method
  async createWallet(chatId, userId) {
    try {
      const rateCheck = this.checkRateLimit(userId, 'wallet_create');
      if (!rateCheck.allowed) {
        await this.bot.sendMessage(chatId, `⏳ Please wait ${rateCheck.waitTime} seconds before creating a wallet.`);
        return;
      }

      const loadingMsg = await this.bot.sendMessage(chatId, '🔄 Creating your secure wallet...');
      
      // Generate new wallet
      const mnemonic = bip39.generateMnemonic();
      const seed = await bip39.mnemonicToSeed(mnemonic);
      const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
      const keypair = Keypair.fromSeed(derivedSeed);
      
      // Encrypt sensitive data
      const encryptedMnemonic = this.encryptSensitiveData(mnemonic, userId);
      const encryptedPrivateKey = this.encryptSensitiveData(Buffer.from(keypair.secretKey).toString('hex'), userId);
      
      // Save to database
      const walletData = {
        public_key: keypair.publicKey.toString(),
        encrypted_mnemonic: encryptedMnemonic,
        encrypted_private_key: encryptedPrivateKey
      };
      
      await this.saveUserWallet(userId, walletData);
      
      const successMessage = `
✅ **Wallet Created Successfully!**

📍 **Your Address:** \`${keypair.publicKey.toString()}\`
💰 **Balance:** 0.0000 SOL

🔒 **Security Information:**
• Your wallet is encrypted with military-grade security
• Your private keys never leave our secure servers
• Use /backup to get your recovery phrase (DM only)
• Always verify addresses before sending

**Next Steps:**
1. 🔒 Backup your wallet (use /backup in DM)
2. 💰 Add some SOL to your wallet
3. 🎫 Buy tokens to access chat rooms
4. 🚀 Use /login to join communities

Your wallet is ready for the Solana ecosystem! 🚀
      `;

      await this.bot.editMessageText(successMessage, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📋 Copy Address', callback_data: `copy_${keypair.publicKey.toString()}` },
              { text: '💰 Check Balance', callback_data: 'wallet_balance' }
            ],
            [
              { text: '🔒 Backup Wallet (DM)', url: `https://t.me/${process.env.BOT_USERNAME}?start=backup` },
              { text: '🚀 Login to Chats', callback_data: 'login_website' }
            ]
          ]
        }
      });
      
    } catch (error) {
      console.error('Wallet creation error:', error);
      await this.bot.sendMessage(chatId, '❌ Error creating wallet. Please try again.');
    }
  }

  // Additional helper methods
  async showBackupPhrase(chatId, userId, messageId) {
    try {
      const userWallet = await this.getUserWallet(userId);
      if (!userWallet) {
        await this.bot.editMessageText('❌ No wallet found.', {
          chat_id: chatId,
          message_id: messageId
        });
        return;
      }

      const mnemonic = this.decryptSensitiveData(userWallet.encrypted_mnemonic, userId);
      
      const backupMessage = `
🔒 **YOUR WALLET BACKUP PHRASE**

\`${mnemonic}\`

⚠️ **CRITICAL SECURITY WARNING:**
• This phrase gives COMPLETE access to your wallet
• Store it offline and secure
• NEVER share with anyone
• Anyone with this phrase can steal your funds
• Write it down on paper, don't save digitally

**This message will be deleted in 5 minutes for security.**

✅ **Screenshot or write down your phrase now!**
      `;

      const backupMsg = await this.bot.editMessageText(backupMessage, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ I have saved my backup phrase', callback_data: 'backup_confirmed' }]
          ]
        }
      });

      // Auto-delete after 5 minutes
      setTimeout(async () => {
        try {
          await this.bot.deleteMessage(chatId, backupMsg.message_id);
        } catch (deleteError) {
          console.log('Message already deleted or not found');
        }
      }, 5 * 60 * 1000);

    } catch (error) {
      console.error('Show backup error:', error);
      await this.bot.editMessageText('❌ Error accessing backup phrase.', {
        chat_id: chatId,
        message_id: messageId
      });
    }
  }

  async startImportProcess(chatId, userId) {
    try {
      // Set up listener for mnemonic
      this.mnemonicListeners.set(userId, {
        chatId,
        timestamp: Date.now(),
        step: 'awaiting_mnemonic'
      });

      const message = `
📥 **Import Wallet - Step 1**

Please send your 12 or 24-word seed phrase as your next message.

**Format:** Just send the words separated by spaces
**Example:** \`word1 word2 word3 word4 ... word12\`

⚠️ **Security:**
• Your message will be automatically deleted
• The seed phrase will be encrypted immediately
• Only send this in this private chat

**Send your seed phrase now:**
      `;

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Cancel Import', callback_data: 'cancel_import' }]
          ]
        }
      });

      // Set up message listener
      this.bot.on('message', (msg) => this.handleMnemonicInput(msg));

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.mnemonicListeners.has(userId)) {
          this.mnemonicListeners.delete(userId);
          this.bot.sendMessage(chatId, '⏰ Import timeout. Please start over if you want to import your wallet.');
        }
      }, 5 * 60 * 1000);

    } catch (error) {
      console.error('Import process error:', error);
      await this.bot.sendMessage(chatId, '❌ Error starting import process.');
    }
  }

  async handleMnemonicInput(msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    if (!this.mnemonicListeners.has(userId)) return;
    
    const listener = this.mnemonicListeners.get(userId);
    if (listener.chatId !== chatId || listener.step !== 'awaiting_mnemonic') return;

    try {
      const mnemonic = msg.text.trim();
      
      // Delete the user's message immediately for security
      try {
        await this.bot.deleteMessage(chatId, msg.message_id);
      } catch (deleteError) {
        console.log('Could not delete user message');
      }

      // Validate mnemonic
      if (!this.validateMnemonic(mnemonic)) {
        await this.bot.sendMessage(chatId, '❌ Invalid seed phrase. Please check your words and try again.');
        return;
      }

      // Import wallet
      const loadingMsg = await this.bot.sendMessage(chatId, '🔄 Importing your wallet...');
      
      const seed = await bip39.mnemonicToSeed(mnemonic);
      const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
      const keypair = Keypair.fromSeed(derivedSeed);
      
      // Encrypt and save
      const encryptedMnemonic = this.encryptSensitiveData(mnemonic, userId);
      const encryptedPrivateKey = this.encryptSensitiveData(Buffer.from(keypair.secretKey).toString('hex'), userId);
      
      const walletData = {
        public_key: keypair.publicKey.toString(),
        encrypted_mnemonic: encryptedMnemonic,
        encrypted_private_key: encryptedPrivateKey
      };
      
      await this.saveUserWallet(userId, walletData);
      
      // Clean up listener
      this.mnemonicListeners.delete(userId);
      
      const balance = await this.getWalletBalance(keypair.publicKey.toString());
      
      const successMessage = `
✅ **Wallet Imported Successfully!**

📍 **Address:** \`${keypair.publicKey.toString()}\`
💰 **Balance:** ${balance} SOL

🔒 **Your wallet is now secure and ready to use!**

**Available Actions:**
• Check token holdings for chat access
• Send and receive SOL & tokens
• Access token-gated communities
• Manage your DeFi positions

Welcome back to the Solana ecosystem! 🚀
      `;

      await this.bot.editMessageText(successMessage, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🎫 Check Tokens', callback_data: 'refresh_tokens' },
              { text: '💰 Check Balance', callback_data: 'wallet_balance' }
            ],
            [
              { text: '🚀 Login to Chats', callback_data: 'login_website' }
            ]
          ]
        }
      });

    } catch (error) {
      console.error('Mnemonic processing error:', error);
      this.mnemonicListeners.delete(userId);
      await this.bot.sendMessage(chatId, '❌ Error importing wallet. Please try again.');
    }
  }

  async processSendTransaction(chatId, userId, data, messageId) {
    try {
      const parts = data.replace('confirm_send_', '').split('_');
      const amount = parseFloat(parts[0]);
      const recipientAddress = parts.slice(1).join('_');

      const userWallet = await this.getUserWallet(userId);
      if (!userWallet) {
        await this.bot.editMessageText('❌ Wallet not found.', {
          chat_id: chatId,
          message_id: messageId
        });
        return;
      }

      const loadingMsg = await this.bot.editMessageText('🔄 Processing transaction...', {
        chat_id: chatId,
        message_id: messageId
      });

      // Decrypt private key
      const privateKeyHex = this.decryptSensitiveData(userWallet.encrypted_private_key, userId);
      const privateKeyBuffer = Buffer.from(privateKeyHex, 'hex');
      const senderKeypair = Keypair.fromSecretKey(privateKeyBuffer);

      // Create transaction
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: senderKeypair.publicKey,
          toPubkey: new PublicKey(recipientAddress),
          lamports: amount * LAMPORTS_PER_SOL
        })
      );

      // Get recent blockhash
      const { blockhash } = await this.connection.getRecentBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = senderKeypair.publicKey;

      // Sign and send transaction
      transaction.sign(senderKeypair);
      const signature = await this.connection.sendRawTransaction(transaction.serialize());

      // Confirm transaction
      await this.connection.confirmTransaction(signature);

      const successMessage = `
✅ **Transaction Successful!**

**Amount:** ${amount} SOL
**To:** \`${recipientAddress}\`
**Transaction:** \`${signature}\`

**View on Solscan:**
https://solscan.io/tx/${signature}

Your transaction has been confirmed on the Solana blockchain! 🎉
      `;

      await this.bot.editMessageText(successMessage, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔍 View on Solscan', url: `https://solscan.io/tx/${signature}` }
            ],
            [
              { text: '💰 Check Balance', callback_data: 'wallet_balance' },
              { text: '📤 Send More', callback_data: 'wallet_send' }
            ]
          ]
        }
      });

    } catch (error) {
      console.error('Transaction error:', error);
      await this.bot.editMessageText('❌ Transaction failed. Please check your balance and try again.', {
        chat_id: chatId,
        message_id: messageId
      });
    }
  }

  async showSecurityInfo(chatId, messageId) {
    const securityMessage = `
🔒 **Security Information**

**Encryption:**
• AES-256-GCM encryption for all sensitive data
• Your private keys are never stored in plain text
• Each user has unique encryption keys

**Rate Limiting:**
• Protection against spam and abuse
• Different limits for different operations
• Automatic cooldown periods

**Data Protection:**
• Private keys never leave secure servers
• Auto-deletion of sensitive messages
• Secure database with SSL encryption

**Best Practices:**
• Always backup your seed phrase offline
• Verify addresses before sending
• Start with small test transactions
• Never share your backup phrase
• Use strong, unique passwords

**Support:**
Contact @${process.env.SUPPORT_USERNAME || 'support'} for help

Your security is our top priority! 🛡️
    `;

    await this.bot.editMessageText(securityMessage, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔐 Create Wallet', callback_data: 'create_wallet' },
            { text: '📥 Import Wallet', callback_data: 'import_wallet' }
          ]
        ]
      }
    });
  }

  // --- BUY Handler ---
  async handleBuy(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    // Step 1: Ask for token mint
    await this.bot.sendMessage(chatId, '🪙 What token do you want to buy? Please send the token mint address or symbol.');
    // TODO: Continue flow (token, amount, slippage, priority fee, confirm)
  }

  // --- SELL Handler ---
  async handleSell(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    // Step 1: Ask for token to sell
    await this.bot.sendMessage(chatId, '💸 What token do you want to sell? Please send the token mint address or symbol.');
    // TODO: Continue flow: ask amount/% to sell, slippage, priority fee, confirm
  }

  // --- SWAP Handler ---
  async handleSwap(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    // Step 1: Ask for input token
    await this.bot.sendMessage(chatId, '🔄 What token do you want to swap from? Please send the token mint address or symbol.');
    // TODO: Continue flow: ask output token, amount, slippage, priority fee, confirm
  }

  // --- TRADE PROGRESS & PROFIT ---
  async showTradeProgress(chatId, tradeInfo) {
    // tradeInfo: { type, amount, token, txid, status, buyPrice, sellPrice }
    let message = `\n✅ *Trade Complete!*\n`;
    message += `Type: ${tradeInfo.type}\n`;
    message += `Token: ${tradeInfo.token}\n`;
    message += `Amount: ${tradeInfo.amount}\n`;
    message += `Status: ${tradeInfo.status}\n`;
    message += `\n[View on Solscan](https://solscan.io/tx/${tradeInfo.txid})\n`;
    if (tradeInfo.buyPrice && tradeInfo.sellPrice) {
      const profit = ((tradeInfo.sellPrice - tradeInfo.buyPrice) / tradeInfo.buyPrice) * 100;
      message += `\n*Profit/Loss:* ${profit.toFixed(2)}%`;
    }
    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  async handleProfitRefresh(chatId, userId, tokenMint) {
    // Fetch buy/sell history for this token, calculate profit %
    // This is a placeholder; you would fetch from your DB or backend
    const buyPrice = 1.0; // Example
    const currentPrice = 1.2; // Example
    const profit = ((currentPrice - buyPrice) / buyPrice) * 100;
    await this.bot.sendMessage(chatId, `\n📈 *Profit/Loss for ${tokenMint}:* ${profit.toFixed(2)}%\n`, { parse_mode: 'Markdown' });
  }

  // Start the bot
  start() {
    console.log('🚀 Telegram Bot Service started successfully!');
    console.log('🔒 Security features enabled');
    console.log('🌐 Chat room integration ready');
    console.log('💰 Solana wallet management active');
    
    // Health check endpoint
    setInterval(async () => {
      try {
        const info = await this.bot.getMe();
        console.log(`✅ Bot health check passed: @${info.username}`);
      } catch (error) {
        console.error('❌ Bot health check failed:', error);
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  // Cleanup method
  async cleanup() {
    console.log('🧹 Cleaning up bot service...');
    this.bot.stopPolling();
    await this.pool.end();
    console.log('✅ Bot service cleaned up successfully');
  }

  // Helper: Find contract address by token name or ticker
  async findContractAddressByNameOrTicker(query) {
    const client = await this.pool.connect();
    try {
      const res = await client.query(
        'SELECT contract_address FROM tokens WHERE LOWER(name) = LOWER($1) OR LOWER(ticker) = LOWER($1) LIMIT 1',
        [query.trim()]
      );
      return res.rows[0]?.contract_address || null;
    } finally {
      client.release();
    }
  }

  // Enhanced /comment: allow token name or ticker
  async handleComment(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!match || !match[1] || !match[2]) {
      await this.bot.sendMessage(chatId, 'Usage: /comment <contractAddress|tokenName|ticker> <your message>');
      return;
    }
    let contractAddress = match[1];
    const messageText = match[2].trim();
    if (!this.validateSolanaAddress(contractAddress)) {
      // Try to resolve by token name or ticker
      contractAddress = await this.findContractAddressByNameOrTicker(contractAddress);
      if (!contractAddress) {
        await this.bot.sendMessage(chatId, '❌ Invalid contract address, token name, or ticker.');
        return;
      }
    }
    if (!messageText) {
      await this.bot.sendMessage(chatId, '❌ Message cannot be empty.');
      return;
    }
    // Get Telegram username or fallback
    const username = msg.from.username || `tg_${userId}`;
    try {
      // Post to backend API
      const res = await fetch(`${process.env.WEBSITE_URL || 'http://localhost:5000'}/api/chat-rooms/${contractAddress}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, message: messageText, source: 'telegram' })
      });
      if (res.ok) {
        await this.bot.sendMessage(chatId, '✅ Comment posted to chat room!');
      } else {
        const err = await res.json();
        await this.bot.sendMessage(chatId, `❌ Failed to post comment: ${err.error || 'Unknown error'}`);
      }
    } catch (e) {
      await this.bot.sendMessage(chatId, '❌ Error posting comment.');
    }
  }
}

// Export the service
module.exports = TelegramBotService;

// Example usage and startup
if (require.main === module) {
  const bot = new TelegramBotService();
  bot.start();
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down bot service...');
    await bot.cleanup();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down bot service...');
    await bot.cleanup();
    process.exit(0);
  });
}