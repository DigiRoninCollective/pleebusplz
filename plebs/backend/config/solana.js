const { Connection, clusterApiUrl, PublicKey, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

// Solana cluster configuration
const CLUSTERS = {
  mainnet: 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  helius: process.env.HELIUS_RPC_URL || 'https://rpc.helius.xyz/?api-key=' + process.env.HELIUS_API_KEY
};

// Current environment
const CLUSTER = process.env.SOLANA_CLUSTER || 'devnet';
const RPC_URL = process.env.SOLANA_RPC_URL || CLUSTERS[CLUSTER];
const WS_URL = process.env.SOLANA_WS_URL || RPC_URL.replace('https', 'wss');

// Initialize connection
const connection = new Connection(RPC_URL, {
  commitment: 'confirmed',
  wsEndpoint: WS_URL
});

// Program IDs
const PROGRAM_IDS = {
  TOKEN_PROGRAM: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  ASSOCIATED_TOKEN_PROGRAM: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  METADATA_PROGRAM: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
  SYSTEM_PROGRAM: '11111111111111111111111111111111',
  RENT_PROGRAM: 'SysvarRent111111111111111111111111111111111',
  LAUNCHPAD_PROGRAM: process.env.PROGRAM_ID || 'YourLaunchpadProgramIdHere'
};

// Fee payer wallet
let feePayerKeypair = null;
if (process.env.WALLET_PRIVATE_KEY) {
  try {
    feePayerKeypair = Keypair.fromSecretKey(bs58.decode(process.env.WALLET_PRIVATE_KEY));
  } catch (error) {
    console.error('Invalid wallet private key:', error.message);
  }
}

// Transaction settings
const TRANSACTION_CONFIG = {
  maxRetries: 3,
  skipPreflight: false,
  preflightCommitment: 'confirmed',
  commitment: 'confirmed'
};

// Rate limiting
const RATE_LIMITS = {
  requestsPerSecond: 10,
  burstLimit: 50
};

module.exports = {
  connection,
  CLUSTERS,
  CLUSTER,
  RPC_URL,
  WS_URL,
  PROGRAM_IDS,
  feePayerKeypair,
  TRANSACTION_CONFIG,
  RATE_LIMITS,
  PublicKey,
  Keypair
};