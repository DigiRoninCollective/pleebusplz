const { 
  Transaction, 
  SystemProgram, 
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  PublicKey,
  ComputeBudgetProgram
} = require('@solana/web3.js');
const { 
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
  getAccount,
  getMint
} = require('@solana/spl-token');
const { getAccountDataSize, ExtensionType, createInitializeMintInstruction } = require('@solana/spl-token-2022');
const { connection, feePayerKeypair, TRANSACTION_CONFIG } = require('../config/solana');

class SolanaService {
  constructor() {
    this.connection = connection;
    this.feePayer = feePayerKeypair;
  }

  // Get account balance
  async getBalance(publicKey) {
    try {
      const balance = await this.connection.getBalance(new PublicKey(publicKey));
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }

  // Get transaction status
  async getTransactionStatus(signature) {
    try {
      const status = await this.connection.getSignatureStatus(signature);
      return {
        confirmed: status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized',
        confirmationStatus: status.value?.confirmationStatus,
        err: status.value?.err,
        slot: status.value?.slot
      };
    } catch (error) {
      throw new Error(`Failed to get transaction status: ${error.message}`);
    }
  }

  // Submit and confirm transaction
  async submitTransaction(transaction, signers = []) {
    try {
      // Add fee payer if not already included
      if (this.feePayer && !signers.includes(this.feePayer)) {
        signers.unshift(this.feePayer);
      }

      // Get recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = this.feePayer.publicKey;

      // Send transaction
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        signers,
        TRANSACTION_CONFIG
      );

      return { signature, success: true };
    } catch (error) {
      console.error('Transaction failed:', error);
      return { signature: null, success: false, error: error.message };
    }
  }

  // Create SPL token
  async createToken(decimals = 9, authority = null) {
    try {
      const mintAuthority = authority || this.feePayer.publicKey;
      const freezeAuthority = authority || this.feePayer.publicKey;

      const mint = await createMint(
        this.connection,
        this.feePayer,
        mintAuthority,
        freezeAuthority,
        decimals
      );

      return {
        mint: mint.toString(),
        decimals,
        authority: mintAuthority.toString()
      };
    } catch (error) {
      throw new Error(`Failed to create token: ${error.message}`);
    }
  }

  // Create SPL token with custom mint
  async createTokenWithCustomMint(mintKeypair, { decimals = 9, authority = null }) {
    try {
      const mintAuthority = authority || this.feePayer.publicKey;
      const freezeAuthority = authority || this.feePayer.publicKey;

      const mint = await createMint(
        this.connection,
        mintKeypair,
        mintAuthority,
        freezeAuthority,
        decimals
      );

      return {
        mint: mint.toString(),
        decimals,
        authority: mintAuthority.toString()
      };
    } catch (error) {
      throw new Error(`Failed to create token with custom mint: ${error.message}`);
    }
  }

  // Create Token-2022 mint with extensions and custom mint address
  async createToken2022WithExtensions(mintKeypair, { decimals = 9, authority = null, extensions = [] }) {
    try {
      const mintAuthority = authority || this.feePayer.publicKey;
      const freezeAuthority = authority || this.feePayer.publicKey;
      // Calculate required mint account size for extensions
      const mintLen = getAccountDataSize(extensions);

      // Create transaction to create and initialize the mint
      const transaction = new Transaction();
      // 1. Create the mint account with correct size
      transaction.add(SystemProgram.createAccount({
        fromPubkey: this.feePayer.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: mintLen,
        lamports: await this.connection.getMinimumBalanceForRentExemption(mintLen),
        programId: TOKEN_PROGRAM_ID, // For Token-2022, use the correct program ID if different
      }));
      // 2. Initialize the mint with extensions
      transaction.add(
        createInitializeMintInstruction(
          mintKeypair.publicKey,
          decimals,
          mintAuthority,
          freezeAuthority,
          TOKEN_PROGRAM_ID // For Token-2022, use the correct program ID if different
        )
      );
      // 3. (Optional) Add extension-specific instructions here if needed

      // Send transaction
      const { signature, success, error } = await this.submitTransaction(transaction, [mintKeypair]);
      if (!success) throw new Error(error);
      return {
        mint: mintKeypair.publicKey.toString(),
        decimals,
        authority: mintAuthority.toString(),
        signature
      };
    } catch (error) {
      throw new Error(`Failed to create Token-2022 mint: ${error.message}`);
    }
  }

  // Get token info
  async getTokenInfo(mintAddress) {
    try {
      const mint = await getMint(this.connection, new PublicKey(mintAddress));
      return {
        mint: mintAddress,
        decimals: mint.decimals,
        supply: mint.supply.toString(),
        mintAuthority: mint.mintAuthority?.toString(),
        freezeAuthority: mint.freezeAuthority?.toString(),
        isInitialized: mint.isInitialized
      };
    } catch (error) {
      throw new Error(`Failed to get token info: ${error.message}`);
    }
  }

  // Get or create associated token account
  async getOrCreateTokenAccount(mint, owner) {
    try {
      const tokenAccount = await getOrCreateAssociatedTokenAccount(
        this.connection,
        this.feePayer,
        new PublicKey(mint),
        new PublicKey(owner)
      );

      return {
        address: tokenAccount.address.toString(),
        mint: tokenAccount.mint.toString(),
        owner: tokenAccount.owner.toString(),
        amount: tokenAccount.amount.toString()
      };
    } catch (error) {
      throw new Error(`Failed to get/create token account: ${error.message}`);
    }
  }

  // Mint tokens
  async mintTokens(mint, destination, amount, authority = null) {
    try {
      const mintAuthority = authority || this.feePayer;
      const destinationPubkey = new PublicKey(destination);
      const mintPubkey = new PublicKey(mint);

      const signature = await mintTo(
        this.connection,
        this.feePayer,
        mintPubkey,
        destinationPubkey,
        mintAuthority,
        amount
      );

      return { signature, success: true };
    } catch (error) {
      throw new Error(`Failed to mint tokens: ${error.message}`);
    }
  }

  // Transfer tokens
  async transferTokens(source, destination, owner, amount) {
    try {
      const signature = await transfer(
        this.connection,
        this.feePayer,
        new PublicKey(source),
        new PublicKey(destination),
        new PublicKey(owner),
        amount
      );

      return { signature, success: true };
    } catch (error) {
      throw new Error(`Failed to transfer tokens: ${error.message}`);
    }
  }

  // Get token account balance
  async getTokenBalance(tokenAccount) {
    try {
      const account = await getAccount(this.connection, new PublicKey(tokenAccount));
      return {
        amount: account.amount.toString(),
        decimals: account.mint.toString(),
        uiAmount: account.amount
      };
    } catch (error) {
      throw new Error(`Failed to get token balance: ${error.message}`);
    }
  }

  // Listen for account changes
  subscribeToAccount(publicKey, callback) {
    try {
      const subscriptionId = this.connection.onAccountChange(
        new PublicKey(publicKey),
        callback,
        'confirmed'
      );
      return subscriptionId;
    } catch (error) {
      throw new Error(`Failed to subscribe to account: ${error.message}`);
    }
  }

  // Remove account subscription
  unsubscribeFromAccount(subscriptionId) {
    try {
      this.connection.removeAccountChangeListener(subscriptionId);
    } catch (error) {
      console.error('Failed to unsubscribe:', error);
    }
  }

  // Get recent transactions for account
  async getAccountTransactions(publicKey, limit = 10) {
    try {
      const signatures = await this.connection.getSignaturesForAddress(
        new PublicKey(publicKey),
        { limit }
      );

      const transactions = await Promise.all(
        signatures.map(async (sig) => {
          const tx = await this.connection.getTransaction(sig.signature);
          return {
            signature: sig.signature,
            slot: sig.slot,
            blockTime: sig.blockTime,
            confirmationStatus: sig.confirmationStatus,
            err: sig.err,
            transaction: tx
          };
        })
      );

      return transactions;
    } catch (error) {
      throw new Error(`Failed to get account transactions: ${error.message}`);
    }
  }

  // Set compute unit price
  async setComputeUnitPrice(transaction, microLamports) {
    try {
      const setComputeUnitPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports,
      });

      transaction.add(setComputeUnitPriceIx);
    } catch (error) {
      throw new Error(`Failed to set compute unit price: ${error.message}`);
    }
  }

  // Create and initialize a Token-2022 token account
  async createToken2022Account({
    accountKeypair,
    mintPublicKey,
    ownerPublicKey
  }) {
    try {
      // Calculate rent-exempt balance for a token account (Token-2022 uses same size as classic SPL)
      const accountSize = 165; // Standard token account size
      const lamports = await this.connection.getMinimumBalanceForRentExemption(accountSize);

      const transaction = new Transaction();
      // 1. Create the token account
      transaction.add(SystemProgram.createAccount({
        fromPubkey: this.feePayer.publicKey,
        newAccountPubkey: accountKeypair.publicKey,
        space: accountSize,
        lamports,
        programId: TOKEN_PROGRAM_ID, // For Token-2022, use the correct program ID if different
      }));
      // 2. Initialize the token account
      transaction.add(
        createInitializeAccountInstruction(
          accountKeypair.publicKey,
          mintPublicKey,
          ownerPublicKey,
          TOKEN_PROGRAM_ID // For Token-2022, use the correct program ID if different
        )
      );
      // Send transaction
      const { signature, success, error } = await this.submitTransaction(transaction, [accountKeypair]);
      if (!success) throw new Error(error);
      return {
        account: accountKeypair.publicKey.toString(),
        mint: mintPublicKey.toString(),
        owner: ownerPublicKey.toString(),
        signature
      };
    } catch (error) {
      throw new Error(`Failed to create Token-2022 token account: ${error.message}`);
    }
  }
}

module.exports = new SolanaService();

const solanaService = require('../services/solanaService');
const { Keypair, PublicKey } = require('@solana/web3.js');

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
}

main().catch(console.error);