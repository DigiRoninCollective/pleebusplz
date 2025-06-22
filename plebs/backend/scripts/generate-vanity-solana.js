const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');
const fs = require('fs');

const SUFFIX = 'PL3b';
let attempts = 0;

while (true) {
  const keypair = Keypair.generate();
  const pubkey = keypair.publicKey.toBase58();
  attempts++;
  if (pubkey.endsWith(SUFFIX)) {
    console.log(`Found after ${attempts} attempts!`);
    console.log('Public Key:', pubkey);
    // Save keypair to fee-wallet.json
    fs.writeFileSync(
      'fee-wallet.json',
      JSON.stringify(Array.from(keypair.secretKey))
    );
    break;
  }
  if (attempts % 10000 === 0) {
    console.log(`Tried ${attempts} keys...`);
  }
}