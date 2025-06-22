// scripts/createFeeAccounts.js - Generate fee token accounts for WSOL + USDC
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const {
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
require('dotenv').config();
const fs = require('fs');

const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(process.env.FEE_WALLET_SECRET_PATH)))
);

const TOKENS = {
  WSOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
};

async function createFeeAccounts() {
  for (const [name, mint] of Object.entries(TOKENS)) {
    console.log(`Creating fee account for ${name}...`);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      new PublicKey(mint),
      payer.publicKey
    );
    console.log(`${name} fee account: ${tokenAccount.address.toBase58()}`);
  }
}

createFeeAccounts().catch(console.error);
