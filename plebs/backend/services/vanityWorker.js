// vanityWorker.js - Worker thread for vanity address generation
const { parentPort, workerData } = require('worker_threads');
const { Keypair } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');

const { pattern, type, jobId } = workerData;

// Configuration
const PROGRESS_INTERVAL = 1000; // Report progress every 1000 attempts
const MAX_ATTEMPTS = 100000000; // Safety limit (100 million)

// Vanity generation function
async function generateVanityWallet() {
  let attempts = 0;
  let lastProgressReport = 0;
  
  const patternUpper = pattern.toUpperCase();
  
  try {
    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      
      // Generate new wallet
      const mnemonic = bip39.generateMnemonic(128);
      const seed = await bip39.mnemonicToSeed(mnemonic);
      const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
      const keypair = Keypair.fromSeed(derivedSeed);
      const address = keypair.publicKey.toString();
      
      // Check if address matches pattern
      let matches = false;
      
      switch (type) {
        case 'prefix':
          matches = address.toUpperCase().startsWith(patternUpper);
          break;
        case 'suffix':
          matches = address.toUpperCase().endsWith(patternUpper);
          break;
        case 'contains':
          matches = address.toUpperCase().includes(patternUpper);
          break;
        default:
          matches = address.toUpperCase().startsWith(patternUpper);
      }
      
      // Report progress periodically
      if (attempts - lastProgressReport >= PROGRESS_INTERVAL) {
        parentPort.postMessage({
          type: 'progress',
          attempts,
          jobId
        });
        lastProgressReport = attempts;
      }
      
      // If we found a match, return the result
      if (matches) {
        parentPort.postMessage({
          type: 'success',
          result: {
            address,
            publicKey: keypair.publicKey.toString(),
            privateKey: Array.from(keypair.secretKey),
            mnemonic,
            attempts
          },
          jobId
        });
        return;
      }
      
      // Check for termination signal (graceful shutdown)
      if (attempts % 10000 === 0) {
        // Small break to allow termination
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    }
    
    // Max attempts reached
    parentPort.postMessage({
      type: 'error',
      error: `Maximum attempts reached (${MAX_ATTEMPTS.toLocaleString()}) without finding match`,
      jobId
    });
    
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      error: error.message,
      jobId
    });
  }
}

// Start generation
generateVanityWallet();

// Handle termination
process.on('SIGTERM', () => {
  parentPort.postMessage({
    type: 'error',
    error: 'Generation cancelled by user',
    jobId
  });
  process.exit(0);
});