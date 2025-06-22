// Automated IPFS upload using NFT.Storage
// Usage: node uploadToIPFS.js <path-to-logo.png> <path-to-token-metadata.json>

const { NFTStorage, File } = require('nft.storage');
const fs = require('fs');
const path = require('path');

// Get your NFT.Storage API key from https://nft.storage/manage
const NFT_STORAGE_API_KEY = process.env.NFT_STORAGE_API_KEY || '<YOUR_NFT_STORAGE_API_KEY>';

async function main() {
  const [,, logoPath, metadataPath] = process.argv;
  if (!logoPath || !metadataPath) {
    console.error('Usage: node uploadToIPFS.js <logo.png> <token-metadata.json>');
    process.exit(1);
  }

  const client = new NFTStorage({ token: NFT_STORAGE_API_KEY });

  // Upload logo image
  const logoData = fs.readFileSync(logoPath);
  const logoFile = new File([logoData], path.basename(logoPath), { type: 'image/png' });
  const logoCid = await client.storeBlob(logoFile);
  console.log('Logo uploaded to IPFS:', `https://ipfs.io/ipfs/${logoCid}`);

  // Update metadata JSON with image link
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  metadata.image = `https://ipfs.io/ipfs/${logoCid}`;

  // Upload metadata JSON
  const metadataFile = new File([JSON.stringify(metadata)], path.basename(metadataPath), { type: 'application/json' });
  const metadataCid = await client.storeBlob(metadataFile);
  console.log('Metadata uploaded to IPFS:', `https://ipfs.io/ipfs/${metadataCid}`);

  // Print final URIs for use in your token
  console.log('\nUse this URI in your on-chain metadata:');
  console.log(`https://ipfs.io/ipfs/${metadataCid}`);
}

main().catch(console.error);
