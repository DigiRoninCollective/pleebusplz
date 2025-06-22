const express = require('express');
const { Pool } = require('pg');
const http = require('http');
const socketIo = require('socket.io');
const TelegramBotService = require('./services/telegramBotService');
const walletRoutes = require('./routes/walletRoutes');
const fetch = require('node-fetch');
const cors = require('cors');
const winston = require('winston');
const multer = require('multer');
const { NFTStorage, File } = require('nft.storage');
const fs = require('fs');
const path = require('path');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const SolanaService = require('./services/solanaService');
const MetaplexService = require('./services/metaplexService');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 5000;
const authRoutes = require('./routes/authRoutes'); 
app.use(express.json());
app.use(cookieParser());
app.use('/api/wallet', walletRoutes);
app.use('/api/auth', authRoutes);

// Connect to your PostgreSQL DB using DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Create HTTP server and Socket.IO
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Configure properly for production
    methods: ["GET", "POST"]
  }
});

// Initialize Telegram Bot Service
let telegramBot;
if (process.env.TELEGRAM_BOT_TOKEN) {
  telegramBot = new TelegramBotService(process.env.TELEGRAM_BOT_TOKEN, pool, io);
  telegramBot.start();
} else {
  console.warn('⚠️ TELEGRAM_BOT_TOKEN not found. Telegram bot will not start.');
}

// Health check
app.get('/', (req, res) => res.send('SLERRRFPAD Backend Running'));

// Configure CORS for API (allow all in dev, restrict in prod)
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  methods: ['GET', 'POST'],
}));

// Configure Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    // Add file transport if needed
    // new winston.transports.File({ filename: 'server.log' })
  ],
});

// Rate limiting middleware
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
app.use('/api/', apiLimiter);

// --- USER MANAGEMENT ENDPOINTS (ADMIN ONLY) ---

// List/search users (pagination, search by wallet/telegram/username)
app.get('/api/admin/users', adminAuth, async (req, res) => {
  try {
    const { limit = 50, offset = 0, search = '' } = req.query;
    let query = 'SELECT * FROM users';
    const params = [];
    if (search) {
      query += ' WHERE wallet ILIKE $1 OR telegram_id::text ILIKE $1 OR username ILIKE $1';
      params.push(`%${search}%`);
    }
    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);
    const { rows } = await pool.query(query, params);
    res.json({ users: rows });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get user details (activity, tokens, etc)
app.get('/api/admin/users/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  try {
    // Basic user info
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (!userRes.rows.length) return res.status(404).json({ error: 'User not found' });
    const user = userRes.rows[0];
    // Wallet activity
    const activityRes = await pool.query('SELECT * FROM wallet_activity_log WHERE telegram_id = $1 ORDER BY timestamp DESC LIMIT 100', [user.telegram_id]);
    // Tokens created
    const tokensRes = await pool.query('SELECT * FROM tokens WHERE creator_telegram_id = $1 ORDER BY created_at DESC', [user.telegram_id]);
    res.json({ user, activity: activityRes.rows, tokens: tokensRes.rows });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
});

// Ban user
app.post('/api/admin/users/:id/ban', adminAuth, async (req, res) => {
  const { id } = req.params;
  const admin = req.admin?.username || 'unknown';
  try {
    await pool.query('UPDATE users SET banned = TRUE WHERE id = $1', [id]);
    await logAdminAction(pool, admin, 'ban_user', { userId: id });
    res.json({ success: true });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

// Unban user
app.post('/api/admin/users/:id/unban', adminAuth, async (req, res) => {
  const { id } = req.params;
  const admin = req.admin?.username || 'unknown';
  try {
    await pool.query('UPDATE users SET banned = FALSE WHERE id = $1', [id]);
    await logAdminAction(pool, admin, 'unban_user', { userId: id });
    res.json({ success: true });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to unban user' });
  }
});

// Promote user to admin
app.post('/api/admin/users/:id/promote', adminAuth, async (req, res) => {
  const { id } = req.params;
  const admin = req.admin?.username || 'unknown';
  try {
    await pool.query('UPDATE users SET is_admin = TRUE WHERE id = $1', [id]);
    await logAdminAction(pool, admin, 'promote_user', { userId: id });
    res.json({ success: true });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to promote user' });
  }
});

// Demote user from admin
app.post('/api/admin/users/:id/demote', adminAuth, async (req, res) => {
  const { id } = req.params;
  const admin = req.admin?.username || 'unknown';
  try {
    await pool.query('UPDATE users SET is_admin = FALSE WHERE id = $1', [id]);
    await logAdminAction(pool, admin, 'demote_user', { userId: id });
    res.json({ success: true });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to demote user' });
  }
});

// GET all tokens
app.get('/api/tokens', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tokens ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to fetch tokens' });
  }
});

// POST new token
app.post('/api/tokens', [
  body('name').isString().trim().notEmpty(),
  body('ticker').isString().trim().notEmpty(),
  body('description').isString().trim().notEmpty(),
  body('image_url').isURL(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, ticker, description, image_url, contract_address } = req.body;

  if (!name || !ticker || !description || !image_url) {
    return res.status(400).json({ error: 'Name, ticker, description, and image_url are required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO tokens (name, ticker, description, image_url, contract_address) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, ticker, description, image_url, contract_address]
    );
    
    // Create a chat room for this token if contract address is provided
    if (contract_address) {
      await pool.query(
        'INSERT INTO chat_rooms (name, contract_address) VALUES ($1, $2) ON CONFLICT (contract_address) DO NOTHING',
        [`${name} (${ticker})`, contract_address]
      );
    }
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to create token' });
  }
});

// GET token by contract address
app.get('/api/tokens/:contractAddress', async (req, res) => {
  const { contractAddress } = req.params;
  const telegramId = req.user?.telegram_id || null; // If you have user info

  try {
    // Log the search action
    await pool.query(
      'INSERT INTO wallet_activity_log (telegram_id, action, details) VALUES ($1, $2, $3)',
      [telegramId, 'search_contract', { contractAddress }]
    );

    const { rows } = await pool.query('SELECT * FROM tokens WHERE contract_address = $1', [contractAddress]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Token not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to fetch token' });
  }
});

// Chat rooms management
app.get('/api/chat-rooms', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        cr.*,
        COUNT(DISTINCT cm.username) as member_count,
        COUNT(cm.id) as message_count,
        MAX(cm.created_at) as last_message_at
      FROM chat_rooms cr
      LEFT JOIN chat_messages cm ON cr.contract_address = cm.room_id
      GROUP BY cr.id
      ORDER BY last_message_at DESC NULLS LAST, cr.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to fetch chat rooms' });
  }
});

app.post('/api/chat-rooms', async (req, res) => {
  const { name, contract_address } = req.body;
  
  if (!name || !contract_address) {
    return res.status(400).json({ error: 'Name and contract_address are required' });
  }
  
  try {
    const result = await pool.query(
      'INSERT INTO chat_rooms (name, contract_address) VALUES ($1, $2) RETURNING *',
      [name, contract_address]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    // Handle duplicate contract address
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Chat room for this contract address already exists' });
    }
    logger.error(err);
    res.status(500).json({ error: 'Failed to create chat room' });
  }
});

// GET chat room by contract address
app.get('/api/chat-rooms/:contractAddress', async (req, res) => {
  const { contractAddress } = req.params;
  
  try {
    const { rows } = await pool.query(`
      SELECT 
        cr.*,
        COUNT(DISTINCT cm.username) as member_count,
        COUNT(cm.id) as message_count
      FROM chat_rooms cr
      LEFT JOIN chat_messages cm ON cr.contract_address = cm.room_id
      WHERE cr.contract_address = $1
      GROUP BY cr.id
    `, [contractAddress]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Chat room not found' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to fetch chat room' });
  }
});

// GET messages for a specific room
app.get('/api/chat-rooms/:contractAddress/messages', async (req, res) => {
  const { contractAddress } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  
  try {
    const { rows } = await pool.query(
      'SELECT * FROM chat_messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [contractAddress, limit, offset]
    );
    
    res.json(rows.reverse()); // Return in chronological order
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Solana price endpoint
app.get('/api/solana-price/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const response = await fetch(`https://price.jup.ag/v4/price?ids=${token}`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to fetch price data' });
  }
});

// Trending tokens with on-chain metrics (Birdeye integration)
app.get('/api/trending', async (req, res) => {
  try {
    // Get trending tokens from DB (chat activity, etc.)
    const { rows } = await pool.query(`
      SELECT 
        t.*,
        COUNT(DISTINCT cm.username) as chat_members,
        COUNT(cm.id) as message_count,
        MAX(cm.created_at) as last_activity
      FROM tokens t
      LEFT JOIN chat_messages cm ON t.contract_address = cm.room_id
      WHERE t.created_at > NOW() - INTERVAL '30 days'
      GROUP BY t.id
      HAVING COUNT(cm.id) > 0
      ORDER BY 
        COUNT(DISTINCT cm.username) DESC, 
        COUNT(cm.id) DESC,
        MAX(cm.created_at) DESC
      LIMIT 20
    `);
    // For each token, fetch Birdeye stats
    const trending = await Promise.all(rows.map(async (token) => {
      let volume24h = null, priceChange24h = null, liquidity = null;
      try {
        const resp = await fetch(`https://public-api.birdeye.so/public/token/${token.contract_address}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.data) {
            volume24h = data.data.volume_24h;
            priceChange24h = data.data.price_change_24h;
            liquidity = data.data.liquidity;
          }
        }
      } catch (e) { /* ignore errors */ }
      return {
        ...token,
        volume24h,
        priceChange24h,
        liquidity
      };
    }));
    res.json(trending);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to fetch trending tokens' });
  }
});

// File upload configuration
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
  }
});

// Automated IPFS upload endpoint
app.post('/api/upload-metadata', upload.single('logo'), async (req, res) => {
  try {
    const { name, symbol, description } = req.body;
    if (!name || !symbol || !description || !req.file) {
      return res.status(400).json({ error: 'name, symbol, description, and logo image are required' });
    }
    const client = new NFTStorage({ token: process.env.NFT_STORAGE_API_KEY });
    // Upload logo image
    const logoData = fs.readFileSync(req.file.path);
    const logoFile = new File([logoData], req.file.originalname, { type: req.file.mimetype });
    const logoCid = await client.storeBlob(logoFile);
    const imageUrl = `https://ipfs.io/ipfs/${logoCid}`;
    // Build metadata JSON
    const metadata = {
      name,
      symbol,
      decimals: 9,
      image: imageUrl,
      description,
      extensions: {}
    };
    // Upload metadata JSON
    const metadataFile = new File([JSON.stringify(metadata)], `${symbol}-metadata.json`, { type: 'application/json' });
    const metadataCid = await client.storeBlob(metadataFile);
    const metadataUrl = `https://ipfs.io/ipfs/${metadataCid}`;
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    res.json({ metadataUrl, imageUrl });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to upload metadata to IPFS' });
  }
});

// Simple admin authentication middleware
function adminAuth(req, res, next) {
  // Try to get token from cookie first
  const token = req.cookies?.adminToken || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid authorization' });
  }
  try {
    const decoded = jwt.verify(token, process.env.ENCRYPTION_SECRET);
    if (!decoded.isAdmin) {
      return res.status(403).json({ error: 'Forbidden: Admins only' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Helper: Log admin action
function logAdminAction(pool, username, action, details = {}) {
  return pool.query(
    'INSERT INTO admin_activity_log (admin_username, action, details) VALUES ($1, $2, $3)',
    [username, action, details]
  );
}

// Admin login endpoint (for initial setup, use strong password and rotate secret regularly)
app.post('/api/admin/login', [
  body('username').isString().trim().notEmpty(),
  body('password').isString().trim().notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { username, password } = req.body;
  // Replace with your own admin credentials logic
  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    const token = jwt.sign({ username, isAdmin: true }, process.env.ENCRYPTION_SECRET, { expiresIn: '12h' });
    res.cookie('adminToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 12 * 60 * 60 * 1000 // 12 hours
    });
    await logAdminAction(pool, username, 'login', { ip: req.ip });
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

// Add CSV export endpoint for full log export (admin only, logs export action)
app.get('/api/admin/activity-log/export', adminAuth, async (req, res) => {
  try {
    const username = req.admin?.username || 'unknown';
    const { action = '', from = '', to = '' } = req.query;
    let query = 'SELECT * FROM wallet_activity_log';
    const params = [];
    const filters = [];
    if (action) {
      filters.push('action = $' + (params.length + 1));
      params.push(action);
    }
    if (from) {
      filters.push('timestamp >= $' + (params.length + 1));
      params.push(from);
    }
    if (to) {
      filters.push('timestamp <= $' + (params.length + 1));
      params.push(to);
    }
    if (filters.length) {
      query += ' WHERE ' + filters.join(' AND ');
    }
    query += ' ORDER BY timestamp DESC';
    const { rows } = await pool.query(query, params);
    await logAdminAction(pool, username, 'export_csv', { count: rows.length, action, from, to });
    // CSV response
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="wallet_activity_log_export.csv"');
    if (!rows.length) return res.end('');
    const headers = Object.keys(rows[0]);
    res.write(headers.join(',') + '\n');
    for (const row of rows) {
      res.write(headers.map(h => '"' + String(typeof row[h] === 'object' && row[h] !== null ? JSON.stringify(row[h]) : row[h]).replace(/"/g, '""') + '"').join(',') + '\n');
    }
    res.end();
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to export activity logs' });
  }
});

// Launchpad: Create Token-2022 (admin only, with minting fee enforcement)
app.post('/api/launchpad/create-token', adminAuth, [
  body('name').isString().trim().notEmpty(),
  body('symbol').isString().trim().notEmpty(),
  body('description').isString().trim().notEmpty(),
  body('image_url').isURL(),
  body('decimals').optional().isInt({ min: 0, max: 9 }),
  body('attributes').optional().isArray(),
  body('feeSignature').isString().notEmpty(), // Require fee payment signature
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { name, symbol, description, image_url, decimals = 9, attributes = [], feeSignature } = req.body;
  const mintingFeeLamports = Number(process.env.MINTING_FEE_LAMPORTS || 10000000); // 0.01 SOL default
  const feeWalletPubkey = process.env.FEE_WALLET_PUBKEY;
  if (!feeWalletPubkey) {
    return res.status(500).json({ error: 'Fee wallet not configured' });
  }
  // Verify fee payment
  const paid = await verifyFeePayment(feeSignature, mintingFeeLamports, feeWalletPubkey, SolanaService);
  if (!paid) {
    return res.status(402).json({ error: 'Minting fee not paid or invalid signature' });
  }
  try {
    // 1. Mint Token-2022
    const tokenResult = await solanaService.createToken2022WithExtensions(
      solanaService.feePayer, // Use fee payer as mint keypair
      { decimals, authority: solanaService.feePayer.publicKey, extensions: [] }
    );
    const mint = tokenResult.mint;

    // 2. Upload metadata to Arweave/IPFS via Metaplex
    const metadata = {
      name,
      symbol,
      description,
      image: image_url,
      attributes,
    };
    const { uri: metadataUri } = await metaplexService.uploadMetadata(metadata);

    // 3. Create Metaplex metadata account
    await metaplexService.createTokenMetadata({
      mint,
      name,
      symbol,
      description,
      image: image_url,
      external_url: metadataUri,
    });

    // 4. Save to DB
    const result = await pool.query(
      'INSERT INTO tokens (name, ticker, description, image_url, contract_address, metadata_uri, decimals) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [name, symbol, description, image_url, mint, metadataUri, decimals]
    );

    // 5. Optionally create chat room
    await pool.query(
      'INSERT INTO chat_rooms (name, contract_address) VALUES ($1, $2) ON CONFLICT (contract_address) DO NOTHING',
      [`${name} (${symbol})`, mint]
    );

    // 6. Log fee payment
    await pool.query(
      'INSERT INTO fee_payments (signature, payer, amount, token_minted, timestamp) VALUES ($1, $2, $3, $4, NOW())',
      [feeSignature, req.admin?.username || 'unknown', mintingFeeLamports, mint]
    );
    res.status(201).json({
      token: result.rows[0],
      mint,
      metadataUri,
      tx: tokenResult.signature
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to launch token', details: err.message });
  }
});

// Helper: Verify SOL payment to fee wallet
async function verifyFeePayment(signature, expectedAmount, feeWalletPubkey, solanaService) {
  try {
    const tx = await solanaService.connection.getParsedTransaction(signature, { commitment: 'confirmed' });
    if (!tx) return false;
    // Check for payment to fee wallet
    const instructions = tx.transaction.message.instructions;
    for (const ix of instructions) {
      if (ix.parsed && ix.parsed.info && ix.parsed.info.destination === feeWalletPubkey) {
        const amount = Number(ix.parsed.info.lamports || 0);
        if (amount >= expectedAmount) return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

// Admin: Get wallet activity logs (protected)
app.get('/api/admin/activity-log', adminAuth, async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const { rows } = await pool.query(
      'SELECT * FROM wallet_activity_log ORDER BY timestamp DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    res.json({ logs: rows });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to fetch activity logs' });
  }
});

// Admin: Get admin audit logs (protected)
app.get('/api/admin/audit-log', adminAuth, async (req, res) => {
  try {
    const { limit = 20, offset = 0, action = '', username = '' } = req.query;
    let query = 'SELECT * FROM admin_activity_log';
    const params = [];
    const filters = [];
    if (action) {
      filters.push('action = $' + (params.length + 1));
      params.push(action);
    }
    if (username) {
      filters.push('admin_username = $' + (params.length + 1));
      params.push(username);
    }
    if (filters.length) {
      query += ' WHERE ' + filters.join(' AND ');
    }
    query += ' ORDER BY timestamp DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);
    const { rows } = await pool.query(query, params);
    res.json({ logs: rows });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to fetch admin audit logs' });
  }
});

// WebSocket connection handling
io.on('connection', (socket) => {
  logger.info(`User connected: ${socket.id}`);
  
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    logger.info(`User ${socket.id} joined room ${roomId}`);
  });
  
  socket.on('leave-room', (roomId) => {
    socket.leave(roomId);
    logger.info(`User ${socket.id} left room ${roomId}`);
  });
  
  socket.on('chat-message', async (data) => {
    try {
      // Save message to database
      const message = await saveMessage(data);
      
      // Broadcast to all users in the room
      io.to(data.roomId).emit('new-message', {
        ...message,
        source: 'web'
      });
      
      // Optionally notify Telegram bot about new activity
      // telegramBot?.notifyNewMessage(data);
      
    } catch (error) {
      logger.error('Error handling chat message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });
  
  socket.on('disconnect', () => {
    logger.info(`User disconnected: ${socket.id}`);
  });
});

// Helper function for saving messages
async function saveMessage(messageData) {
  try {
    const result = await pool.query(
      'INSERT INTO chat_messages (room_id, username, message, source, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
      [messageData.roomId, messageData.username, messageData.message, messageData.source || 'web']
    );
    return result.rows[0];
  } catch (err) {
    logger.error('Error saving message:', err);
    throw err;
  }
}

// Chart data endpoint (Jupiter + Pump.fun)
app.get('/api/chart/:token', async (req, res) => {
  const { token } = req.params;
  const { interval = '1m', limit = 100 } = req.query;
  try {
    // 1. Try Jupiter Candles API (https://price.jup.ag/docs/api/candles)
    let jupiterData = [];
    try {
      const jupRes = await fetch(`https://price.jup.ag/v6/candles?ids=${token}&interval=${interval}&limit=${limit}`);
      if (jupRes.ok) {
        const jupJson = await jupRes.json();
        if (jupJson[token]) jupiterData = jupJson[token];
      }
    } catch (e) { /* ignore Jupiter errors */ }

    // 2. Try Pump.fun (Pump Swap) API for chart data (https://api.pump.fun/v1/candles/{mint})
    let pumpData = [];
    try {
      const pumpRes = await fetch(`https://api.pump.fun/v1/candles/${token}?interval=${interval}&limit=${limit}`);
      if (pumpRes.ok) {
        const pumpJson = await pumpRes.json();
        if (Array.isArray(pumpJson)) pumpData = pumpJson;
      }
    } catch (e) { /* ignore Pump errors */ }

    // Prefer Jupiter, fallback to Pump.fun
    const chartData = jupiterData.length ? jupiterData : pumpData;
    if (!chartData.length) {
      return res.status(404).json({ error: 'No chart data found for this token.' });
    }
    res.json({ chart: chartData });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to fetch chart data' });
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 WebSocket server ready`);
  if (process.env.TELEGRAM_BOT_TOKEN) {
    console.log('🤖 Telegram bot initialized');
  }
});

// Allow posting a message to a chat room (for Telegram bot and web)
app.post('/api/chat-rooms/:contractAddress/messages', async (req, res) => {
  const { contractAddress } = req.params;
  const { username, message, source = 'web' } = req.body;
  if (!username || !message) {
    return res.status(400).json({ error: 'username and message are required' });
  }
  try {
    // Save message to DB
    const saved = await saveMessage({
      roomId: contractAddress,
      username,
      message,
      source
    });
    // Broadcast to web clients via WebSocket
    io.to(contractAddress).emit('new-message', {
      ...saved,
      source
    });
    res.status(201).json(saved);
  } catch (err) {
    logger.error('Error saving message from API:', err);
    res.status(500).json({ error: 'Failed to post message' });
  }
});