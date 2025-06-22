const { Metaplex, keypairIdentity, bundlrStorage } = require('@metaplex-foundation/js');
const { 
  createCreateMetadataAccountV3Instruction,
  PROGRAM_ID: METADATA_PROGRAM_ID,
} = require('@metaplex-foundation/mpl-token-metadata');
const { PublicKey, Transaction } = require('@solana/web3.js');
const { connection, feePayerKeypair } = require('../config/solana');
const solanaService = require('./solanaService');

class MetaplexService {
  constructor() {
    this.connection = connection;
    this.feePayer = feePayerKeypair;
    
    if (this.feePayer) {
      this.metaplex = Metaplex.make(connection)
        .use(keypairIdentity(this.feePayer))
        .use(bundlrStorage({
          address: 'https://devnet.bundlr.network',
          providerUrl: 'https://api.devnet.solana.com',
          timeout: 60000,
        }));
    }
  }

  // Upload metadata to Arweave/IPFS
  async uploadMetadata(metadata) {
    try {
      if (!this.metaplex) {
        throw new Error('Metaplex not initialized - missing fee payer');
      }

      const { uri } = await this.metaplex.nfts().uploadMetadata({
        name: metadata.name,
        symbol: metadata.symbol,
        description: metadata.description,
        image: metadata.image,
        attributes: metadata.attributes || [],
        properties: {
          files: metadata.image ? [{
            uri: metadata.image,
            type: "image/png"
          }] : [],
          category: "image",
        },
        external_url: metadata.external_url || "",
        animation_url: metadata.animation_url || "",
      });

      return { uri };
    } catch (error) {
      throw new Error(`Failed to upload metadata: ${error.message}`);
    }
  }

  // Create token metadata account
  async createTokenMetadata(tokenData) {
    try {
      const { mint, name, symbol, description, image, external_url } = tokenData;
      
      // First upload metadata to Arweave
      const metadata = {
        name,
        symbol,
        description,
        image,
        external_url
      };
      
      const { uri } = await this.uploadMetadata(metadata);

      // Create metadata account
      const mintPubkey = new PublicKey(mint);
      const [metadataPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          METADATA_PROGRAM_ID.toBuffer(),
          mintPubkey.toBuffer(),
        ],
        METADATA_PROGRAM_ID
      );

      // Create the metadata instruction
      const createMetadataInstruction = createCreateMetadataAccountV3Instruction(
        {
          metadata: metadataPDA,
          mint: mintPubkey,
          mintAuthority: this.feePayer.publicKey,
          payer: this.feePayer.publicKey,
          updateAuthority: this.feePayer.publicKey,
        },
        {
          createMetadataAccountArgsV3: {
            data: {
              name: name,
              symbol: symbol,
              uri: uri,
              sellerFeeBasisPoints: 0,
              creators: [{
                address: this.feePayer.publicKey,
                verified: true,
                share: 100,
              }],
              collection: null,
              uses: null,
            },
            isMutable: true,
            collectionDetails: null,
          },
        }
      );

      // Create and send transaction
      const transaction = new Transaction().add(createMetadataInstruction);
      const signature = await this.connection.sendTransaction(transaction, [this.feePayer]);
      
      // Confirm transaction
      await this.connection.confirmTransaction(signature, 'confirmed');

      return {
        signature,
        metadataAddress: metadataPDA.toString(),
        metadataUri: uri
      };
      
    } catch (error) {
      throw new Error(`Failed to create token metadata: ${error.message}`);
    }
  }

  // Create NFT (mint + metadata in one call)
  async createNFT(nftData) {
    try {
      const { name, symbol, description, image, external_url, attributes } = nftData;
      
      if (!this.metaplex) {
        throw new Error('Metaplex not initialized - missing fee payer');
      }

      const { nft } = await this.metaplex.nfts().create({
        name,
        symbol,
        description,
        image,
        external_url,
        attributes: attributes || [],
        sellerFeeBasisPoints: 0,
        creators: [{
          address: this.feePayer.publicKey,
          verified: true,
          share: 100,
        }],
      });

      return {
        mint: nft.address.toString(),
        metadataAddress: nft.metadataAddress.toString(),
        metadataUri: nft.uri,
        name: nft.name,
        symbol: nft.symbol
      };
    } catch (error) {
      throw new Error(`Failed to create NFT: ${error.message}`);
    }
  }

  // Get NFT metadata
  async getNFTMetadata(mintAddress) {
    try {
      if (!this.metaplex) {
        throw new Error('Metaplex not initialized - missing fee payer');
      }

      const mintPubkey = new PublicKey(mintAddress);
      const nft = await this.metaplex.nfts().findByMint({ mintAddress: mintPubkey });
      
      return {
        mint: nft.address.toString(),
        name: nft.name,
        symbol: nft.symbol,
        description: nft.json?.description || '',
        image: nft.json?.image || '',
        attributes: nft.json?.attributes || [],
        uri: nft.uri,
        updateAuthority: nft.updateAuthorityAddress.toString(),
        creators: nft.creators.map(creator => ({
          address: creator.address.toString(),
          verified: creator.verified,
          share: creator.share
        }))
      };
    } catch (error) {
      throw new Error(`Failed to get NFT metadata: ${error.message}`);
    }
  }

  // Update NFT metadata
  async updateNFTMetadata(mintAddress, newMetadata) {
    try {
      if (!this.metaplex) {
        throw new Error('Metaplex not initialized - missing fee payer');
      }

      const mintPubkey = new PublicKey(mintAddress);
      const nft = await this.metaplex.nfts().findByMint({ mintAddress: mintPubkey });
      
      // Upload new metadata
      const { uri } = await this.uploadMetadata(newMetadata);
      
      // Update the NFT
      const { response } = await this.metaplex.nfts().update({
        nftOrSft: nft,
        name: newMetadata.name || nft.name,
        symbol: newMetadata.symbol || nft.symbol,
        uri: uri,
      });

      return {
        signature: response.signature,
        metadataUri: uri
      };
    } catch (error) {
      throw new Error(`Failed to update NFT metadata: ${error.message}`);
    }
  }

  // Upload image to Arweave/IPFS
  async uploadImage(imageBuffer, fileName = 'image.png') {
    try {
      if (!this.metaplex) {
        throw new Error('Metaplex not initialized - missing fee payer');
      }

      const { uri } = await this.metaplex.storage().upload({
        buffer: imageBuffer,
        fileName: fileName,
        contentType: 'image/png',
      });

      return { uri };
    } catch (error) {
      throw new Error(`Failed to upload image: ${error.message}`);
    }
  }

  // Verify NFT creator
  async verifyNFTCreator(mintAddress, creatorAddress) {
    try {
      if (!this.metaplex) {
        throw new Error('Metaplex not initialized - missing fee payer');
      }

      const mintPubkey = new PublicKey(mintAddress);
      const creatorPubkey = new PublicKey(creatorAddress);
      const nft = await this.metaplex.nfts().findByMint({ mintAddress: mintPubkey });
      
      const { response } = await this.metaplex.nfts().verifyCreator({
        nftOrSft: nft,
        creator: creatorPubkey,
      });

      return { signature: response.signature };
    } catch (error) {
      throw new Error(`Failed to verify NFT creator: ${error.message}`);
    }
  }

  // Get all NFTs by owner
  async getNFTsByOwner(ownerAddress) {
    try {
      if (!this.metaplex) {
        throw new Error('Metaplex not initialized - missing fee payer');
      }

      const ownerPubkey = new PublicKey(ownerAddress);
      const nfts = await this.metaplex.nfts().findAllByOwner({ owner: ownerPubkey });
      
      return nfts.map(nft => ({
        mint: nft.address.toString(),
        name: nft.name,
        symbol: nft.symbol,
        uri: nft.uri,
        updateAuthority: nft.updateAuthorityAddress.toString()
      }));
    } catch (error) {
      throw new Error(`Failed to get NFTs by owner: ${error.message}`);
    }
  }
}

module.exports = MetaplexService;