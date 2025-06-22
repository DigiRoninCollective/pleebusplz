const solanaService = require('../services/solanaService');
const { Transaction, sendAndConfirmTransaction, Keypair, PublicKey, SystemProgram } = require('@solana/web3.js');
const { createCreateMetadataAccountV3Instruction } = require('@metaplex-foundation/mpl-token-metadata');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');

// Helper to find the PDA for the metadata account
function getMetadataPDA(mint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'),
     new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s').toBuffer(),
     mint.toBuffer()
    ],
    new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
  )[0];
}

// 1. Generate or load a vanity mint keypair
// Replace this with your actual vanity generator logic
const mintKeypair = Keypair.generate();

// 2. Define mint parameters and extensions (example: no extensions)
const mintParams = {
  decimals: 9,
  authority: solanaService.feePayer.publicKey,
  extensions: [] // e.g., [ExtensionType.MetadataPointer] if needed
};

async function main() {
  // 3. Create the Token-2022 mint
  const mintResult = await solanaService.createToken2022WithExtensions(mintKeypair, mintParams);
  console.log('Mint created:', mintResult);

  // 4. Generate a user token account keypair
  const userAccountKeypair = Keypair.generate();
  const userPublicKey = userAccountKeypair.publicKey; // or use an existing user wallet

  // 5. Create the Token-2022 token account for the user
  const accountResult = await solanaService.createToken2022Account({
    accountKeypair: userAccountKeypair,
    mintPublicKey: mintKeypair.publicKey,
    ownerPublicKey: userPublicKey // or another owner
  });
  console.log('Token account created:', accountResult);

  // 6. Mint tokens to the user's account
  const mintAmount = 1_000_000_000; // 1 token with 9 decimals
  const mintTx = await solanaService.mintTokens(
    mintKeypair.publicKey.toString(),
    userAccountKeypair.publicKey.toString(),
    mintAmount,
    mintKeypair // Mint authority
  );
  console.log('Tokens minted:', mintTx);

  // 7. Add Metaplex metadata (raw instruction)
  const metadataPDA = getMetadataPDA(mintKeypair.publicKey);
  const metadataIx = createCreateMetadataAccountV3Instruction({
    metadata: metadataPDA,
    mint: mintKeypair.publicKey,
    mintAuthority: mintKeypair.publicKey,
    payer: solanaService.feePayer.publicKey,
    updateAuthority: mintKeypair.publicKey,
  }, {
    createMetadataAccountArgsV3: {
      data: {
        name: 'MyToken', // Set your token name
        symbol: 'PLEB', // Set your token symbol
        uri: 'https://arweave.net/your-token-metadata.json', // Set your metadata URI
        sellerFeeBasisPoints: 0, // No royalties for fungible tokens
        creators: null,
        collection: null,
        uses: null
      },
      isMutable: true,
      collectionDetails: null
    }
  });

  const tx = new Transaction().add(metadataIx);
  const sig = await sendAndConfirmTransaction(
    solanaService.connection,
    tx,
    [solanaService.feePayer, mintKeypair]
  );
  console.log('Metadata created, tx:', sig);
}

main().catch(console.error);