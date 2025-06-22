const { 
  Transaction, 
  SystemProgram, 
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  PublicKey
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
}

module.exports = new SolanaService();