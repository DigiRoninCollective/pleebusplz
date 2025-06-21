const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// Connect to your PostgreSQL DB using DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Health check
app.get('/', (req, res) => res.send('SLERRRFPAD Backend Running'));

// GET all tokens
app.get('/api/tokens', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tokens ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch tokens' });
  }
});

//  POST new token
app.post('/api/tokens', async (req, res) => {
  const { name, ticker, description, image_url } = req.body;

  if (!name || !ticker || !description || !image_url) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO tokens (name, ticker, description, image_url) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, ticker, description, image_url]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create token' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
