#!/usr/bin/env node

/**
 * Telegram Wallet Bot Security Migration Script
 * 
 * This script helps you safely migrate your existing bot to enhanced security
 * Run with: node migration.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

class MigrationHelper {
  constructor() {
    this.backupDir = './migration_backup';
    this.originalFile = './telegramBotService.js';
    this.envFile = './.env';
  }

  async run() {
    console.log('\n🚀 Telegram Wallet Bot Security Migration\n');
    console.log('This script will help you safely upgrade your bot with enhanced security features.\n');

    try {
      await this.step1_CreateBackup();
      await this.step2_CheckEnvironment();
      await this.step3_UpdateCode();
      await this.step4_DatabaseMigration();
      await this.step5_Testing();
      
      console.log('\n✅ Migration completed successfully!');
      console.log('\n📋 Next steps:');
      console.log('1. Test your bot thoroughly');
      console.log('2. Monitor logs for any issues');
      console.log('3. Backup is available in:', this.backupDir);
      
    } catch (error) {
      console.error('\n❌ Migration failed:', error.message);
      console.log('\n🔄 Your original files are safe in:', this.backupDir);
    }

    rl.close();
  }

  async step1_CreateBackup() {
    console.log('📦 Step 1: Creating backup of your existing files...');
    
    // Create backup directory
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir);
    }

    // Backup existing files
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    if (fs.existsSync(this.originalFile)) {
      const backupFile = path.join(this.backupDir, `telegramBotService_${timestamp}.js`);
      fs.copyFileSync(this.originalFile, backupFile);
      console.log('✅ Backed up:', backupFile);
    }

    if (fs.existsSync(this.envFile)) {
      const backupEnv = path.join(this.backupDir, `.env_${timestamp}`);
      fs.copyFileSync(this.envFile, backupEnv);
      console.log('✅ Backed up:', backupEnv);
    }

    await this.waitForUser('\nPress Enter to continue...');
  }

  async step2_CheckEnvironment() {
    console.log('\n🔧 Step 2: Checking environment configuration...');
    
    let envContent = '';
    let needsUpdate = false;

    // Read existing .env or create new
    if (fs.existsSync(this.envFile)) {
      envContent = fs.readFileSync(this.envFile, 'utf8');
      console.log('✅ Found existing .env file');
    } else {
      console.log('📝 Creating new .env file');
      needsUpdate = true;
    }

    // Check required variables
    const requiredVars = [
      'ENCRYPTION_SECRET',
      'ADDITIONAL_SALT',
      'SOLANA_RPC_URL'
    ];

    const missingVars = [];
    requiredVars.forEach(varName => {
      if (!envContent.includes(varName)) {
        missingVars.push(varName);
        needsUpdate = true;
      }
    });

    if (needsUpdate) {
      console.log('\n🔐 Adding missing environment variables...');
      
      let newEnvContent = envContent;
      
      if (missingVars.includes('ENCRYPTION_SECRET')) {
        const encryptionSecret = await this.askUser('Enter your ENCRYPTION_SECRET (or press Enter to generate): ');
        const secret = encryptionSecret || this.generateRandomString(64);
        newEnvContent += `\nENCRYPTION_SECRET=${secret}`;
        console.log('✅ Added ENCRYPTION_SECRET');
      }

      if (missingVars.includes('ADDITIONAL_SALT')) {
        const additionalSalt = this.generateRandomString(32);
        newEnvContent += `\nADDITIONAL_SALT=${additionalSalt}`;
        console.log('✅ Added ADDITIONAL_SALT');
      }

      if (missingVars.includes('SOLANA_RPC_URL')) {
        const rpcUrl = await this.askUser('Enter Solana RPC URL (or press Enter for mainnet): ');
        const url = rpcUrl || 'https://api.mainnet-beta.solana.com';
        newEnvContent += `\nSOLANA_RPC_URL=${url}`;
        console.log('✅ Added SOLANA_RPC_URL');
      }

      // Save updated .env
      fs.writeFileSync(this.envFile, newEnvContent);
      console.log('✅ Environment file updated');
    } else {
      console.log('✅ All required environment variables found');
    }

    await this.waitForUser('\nPress Enter to continue...');
  }

  async step3_UpdateCode() {
    console.log('\n💻 Step 3: Updating your code...');
    
    if (!fs.existsSync(this.originalFile)) {
      throw new Error(`Original file not found: ${this.originalFile}`);
    }

    // Read the original file
    let content = fs.readFileSync(this.originalFile, 'utf8');

    // Add new properties to constructor
    console.log('🔧 Adding new properties to constructor...');
    content = this.addConstructorProperties(content);

    // Replace encryption methods
    console.log('🔐 Upgrading encryption methods...');
    content = this.replaceEncryptionMethods(content);

    // Add rate limiting method
    console.log('⏱️ Adding rate limiting...');
    content = this.addRateLimiting(content);

    // Update wallet creation
    console.log('💼 Enhancing wallet creation...');
    content = this.enhanceWalletCreation(content);

    // Update backup method
    console.log('🔒 Securing backup method...');
    content = this.enhanceBackupMethod(content);

    // Save updated file
    const updatedFile = this.originalFile.replace('.js', '_updated.js');
    fs.writeFileSync(updatedFile, content);
    
    console.log('✅ Updated code saved as:', updatedFile);
    console.log('📝 Review the changes, then rename it to replace your original file');

    await this.waitForUser('\nPress Enter when you\'ve reviewed and renamed the file...');
  }

  async step4_DatabaseMigration() {
    console.log('\n🗄️ Step 4: Database migration (optional)...');
    
    const addLogging = await this.askUser('Do you want to add activity logging? (y/n): ');
    
    if (addLogging.toLowerCase() === 'y') {
      const sqlScript = `
-- Wallet Activity Logging Migration
-- Run this SQL on your PostgreSQL database

CREATE TABLE IF NOT EXISTS wallet_activity_log (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL,
  action VARCHAR(50) NOT NULL,
  details JSONB,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_telegram_id ON wallet_activity_log(telegram_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON wallet_activity_log(timestamp);

-- Optional: Add wallet version column to existing table
ALTER TABLE user_wallets ADD COLUMN IF NOT EXISTS wallet_version VARCHAR(10) DEFAULT '2.0';
ALTER TABLE user_wallets ADD COLUMN IF NOT EXISTS derivation_path VARCHAR(50) DEFAULT "m/44'/501'/0'/0'";

COMMENT ON TABLE wallet_activity_log IS 'Logs wallet activities for security monitoring';
      `;

      const sqlFile = path.join(this.backupDir, 'migration.sql');
      fs.writeFileSync(sqlFile, sqlScript);
      
      console.log('✅ SQL migration script created:', sqlFile);
      console.log('📝 Run this script on your PostgreSQL database');
    } else {
      console.log('⏭️ Skipping database migration');
    }

    await this.waitForUser('\nPress Enter to continue...');
  }

  async step5_Testing() {
    console.log('\n🧪 Step 5: Testing checklist...');
    
    const testItems = [
      'Bot starts without errors',
      'Existing wallets still work',
      'New wallet creation works',
      'Backup phrase retrieval works',
      'Balance checking works',
      'Rate limiting activates after multiple requests',
      'Environment variables are loaded correctly'
    ];

    console.log('\n📋 Please test the following:');
    testItems.forEach((item, index) => {
      console.log(`${index + 1}. ${item}`);
    });

    await this.waitForUser('\nPress Enter when testing is complete...');
  }

  // Helper methods for code transformation
  addConstructorProperties(content) {
    const constructorRegex = /constructor\(\)\s*{/;
    const replacement = `constructor() {
    // ... existing constructor code ...
    
    // Enhanced security properties
    this.rateLimiters = new Map();
    this.pendingTransactions = new Map();
    this.walletSessions = new Map();`;
    
    return content.replace(constructorRegex, replacement);
  }

  replaceEncryptionMethods(content) {
    // Replace encryptMnemonic method
    const encryptMnemonicMethod = `
  encryptMnemonic(mnemonic, userId) {
    const key = crypto.scryptSync(
      userId + process.env.ENCRYPTION_SECRET + (process.env.ADDITIONAL_SALT || 'defaultsalt'), 
      'salt', 
      32
    );
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipherGCM('aes-256-gcm', key);
    cipher.setAAD(Buffer.from(userId.toString()));
    
    let encrypted = cipher.update(mnemonic, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }`;

    // Replace the old method
    content = content.replace(
      /encryptMnemonic\(mnemonic, userId\)\s*{[\s\S]*?^  }/m,
      encryptMnemonicMethod.trim()
    );

    // Similar replacements for other encryption methods...
    // (Implementation would continue with decryptMnemonic, encryptPrivateKey)

    return content;
  }

  addRateLimiting(content) {
    const rateLimitingMethod = `
  // Rate limiting for sensitive operations
  checkRateLimit(userId, operation) {
    const key = \`\${userId}:\${operation}\`;
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
  }`;

    // Add before the last closing brace of the class
    const lastBraceIndex = content.lastIndexOf('}');
    return content.slice(0, lastBraceIndex) + rateLimitingMethod + '\n' + content.slice(lastBraceIndex);
  }

  enhanceWalletCreation(content) {
    // Add rate limiting check to createWallet method
    const walletCreateEnhancement = `
    if (!this.checkRateLimit(userId, 'wallet_create')) {
      await this.bot.sendMessage(chatId, '⏳ Please wait before creating another wallet.');
      return false;
    }

    // Check if user already has a wallet
    const existingWallet = await this.getUserWallet(userId);
    if (existingWallet) {
      await this.bot.sendMessage(chatId, '❌ You already have a wallet. Use /wallet to access it.');
      return false;
    }`;

    // Insert after the try { line in createWallet
    content = content.replace(
      /(async createWallet\(userId, chatId\)\s*{[\s\S]*?try\s*{)/,
      `$1${walletCreateEnhancement}`
    );

    return content;
  }

  enhanceBackupMethod(content) {
    // Add rate limiting to backup method
    const backupEnhancement = `
    if (!this.checkRateLimit(userId, 'backup_request')) {
      await this.bot.sendMessage(chatId, '⏳ Too many backup requests. Please wait 1 minute.');
      return;
    }`;

    // Insert after private chat check
    content = content.replace(
      /(if \(msg\.chat\.type !== 'private'\)\s*{[\s\S]*?return;\s*})/,
      `$1${backupEnhancement}`
    );

    return content;
  }

  // Utility methods
  generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async askUser(question) {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  async waitForUser(message) {
    return new Promise((resolve) => {
      rl.question(message, () => {
        resolve();
      });
    });
  }
}

// Run the migration
if (require.main === module) {
  const migration = new MigrationHelper();
  migration.run().catch(console.error);
}

module.exports = MigrationHelper;