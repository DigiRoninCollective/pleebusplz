const express = require('express');
const { Pool } = require('pg');
const http = require('http');
const socketIo = require('socket.io');
const TelegramBotService = require('./services/telegramBotService');
const walletRoutes = require('./routes/walletRoutes');
const fetch = require('node-fetch');
const cors = require('cors');
const winston = require('winston');
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use('/api/wallet', walletRoutes);

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
  origin: process.env.CORS_ORIGIN || '*',
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
app.post('/api/tokens', async (req, res) => {
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
  
  try {
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

// Get trending tokens
app.get('/api/trending', async (req, res) => {
  try {
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
    res.json(rows);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to fetch trending tokens' });
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

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 WebSocket server ready`);
  if (process.env.TELEGRAM_BOT_TOKEN) {
    console.log('🤖 Telegram bot initialized');
  }
});