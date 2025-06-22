// services/walletService.js - Solana Wallet Operations
const { 
    Connection, 
    PublicKey, 
    Keypair, 
    Transaction, 
    SystemProgram,
    LAMPORTS_PER_SOL,
    sendAndConfirmTransaction
} = require('@solana/web3.js');
const { 
    getOrCreateAssociatedTokenAccount,
    createTransferInstruction,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
} = require('@solana/spl-token');
const bs58 = require('bs58');
const crypto = require('crypto');
require('dotenv').config();

class WalletService {
    constructor() {
        this.connection = new Connection(
            process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
            'confirmed'
        );
        this.jupiterApiUrl = 'https://quote-api.jup.ag/v6';
    }

    /**
     * Generate a new Solana keypair
     * @returns {Object} Contains publicKey, privateKey, and mnemonic
     */
    generateWallet() {
        try {
            const keypair = Keypair.generate();
            const publicKey = keypair.publicKey.toString();
            const privateKey = bs58.encode(keypair.secretKey);
            
            // Generate a simple mnemonic representation (for display purposes)
            const mnemonic = this.generateMnemonic(keypair.secretKey);
            
            return {
                success: true,
                data: {
                    publicKey,
                    privateKey,
                    mnemonic,
                    keypair // Keep for internal use
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Import wallet from private key
     * @param {string} privateKey - Base58 encoded private key
     * @returns {Object} Wallet information
     */
    importWalletFromPrivateKey(privateKey) {
        try {
            const secretKey = bs58.decode(privateKey);
            const keypair = Keypair.fromSecretKey(secretKey);
            const publicKey = keypair.publicKey.toString();
            
            return {
                success: true,
                data: {
                    publicKey,
                    privateKey,
                    keypair
                }
            };
        } catch (error) {
            return {
                success: false,
                error: 'Invalid private key format'
            };
        }
    }

    /**
     * Get SOL balance for a wallet
     * @param {string} publicKey - Wallet public key
     * @returns {Promise<Object>} Balance information
     */
    async getSOLBalance(publicKey) {
        try {
            const pubKey = new PublicKey(publicKey);
            const balance = await this.connection.getBalance(pubKey);
            
            return {
                success: true,
                data: {
                    balance: balance / LAMPORTS_PER_SOL,
                    lamports: balance,
                    publicKey
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get all token balances for a wallet
     * @param {string} publicKey - Wallet public key
     * @returns {Promise<Object>} Token balances
     */
    async getTokenBalances(publicKey) {
        try {
            const pubKey = new PublicKey(publicKey);
            const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
                pubKey,
                { programId: TOKEN_PROGRAM_ID }
            );

            const balances = tokenAccounts.value.map(account => {
                const parsedInfo = account.account.data.parsed.info;
                return {
                    mint: parsedInfo.mint,
                    balance: parsedInfo.tokenAmount.uiAmount,
                    decimals: parsedInfo.tokenAmount.decimals,
                    address: account.pubkey.toString()
                };
            }).filter(token => token.balance > 0);

            return {
                success: true,
                data: balances
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Send SOL to another wallet
     * @param {string} fromPrivateKey - Sender's private key
     * @param {string} toPublicKey - Recipient's public key
     * @param {number} amount - Amount in SOL
     * @returns {Promise<Object>} Transaction result
     */
    async sendSOL(fromPrivateKey, toPublicKey, amount) {
        try {
            const fromKeypair = Keypair.fromSecretKey(bs58.decode(fromPrivateKey));
            const toPubKey = new PublicKey(toPublicKey);
            const lamports = amount * LAMPORTS_PER_SOL;

            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: fromKeypair.publicKey,
                    toPubkey: toPubKey,
                    lamports
                })
            );

            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [fromKeypair]
            );

            return {
                success: true,
                data: {
                    signature,
                    amount,
                    from: fromKeypair.publicKey.toString(),
                    to: toPublicKey
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get quote for token swap using Jupiter API
     * @param {string} inputMint - Input token mint address
     * @param {string} outputMint - Output token mint address
     * @param {number} amount - Amount to swap (in token's smallest unit)
     * @param {number} slippageBps - Slippage in basis points (50 = 0.5%)
     * @returns {Promise<Object>} Quote information
     */
    async getSwapQuote(inputMint, outputMint, amount, slippageBps = 50) {
        try {
            const params = new URLSearchParams({
                inputMint,
                outputMint,
                amount: amount.toString(),
                slippageBps: slippageBps.toString()
            });

            const response = await fetch(`${this.jupiterApiUrl}/quote?${params}`);
            const quote = await response.json();

            if (!response.ok) {
                throw new Error(quote.error || 'Failed to get quote');
            }

            return {
                success: true,
                data: quote
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Execute token swap using Jupiter API
     * @param {Object} quote - Quote from getSwapQuote
     * @param {string} userPublicKey - User's wallet public key
     * @param {string} privateKey - User's private key for signing
     * @returns {Promise<Object>} Swap transaction result
     */
    async executeSwap(quote, userPublicKey, privateKey) {
        try {
            // Get swap transaction from Jupiter
            const swapResponse = await fetch(`${this.jupiterApiUrl}/swap`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    quoteResponse: quote,
                    userPublicKey,
                    wrapAndUnwrapSol: true,
                    dynamicComputeUnitLimit: true,
                    prioritizationFeeLamports: 1000
                })
            });

            const swapData = await swapResponse.json();
            
            if (!swapResponse.ok) {
                throw new Error(swapData.error || 'Failed to get swap transaction');
            }

            // Deserialize and sign the transaction
            const swapTransactionBuf = Buffer.from(swapData.swapTransaction, 'base64');
            const transaction = Transaction.from(swapTransactionBuf);
            const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));

            // Sign and send transaction
            transaction.sign(keypair);
            const signature = await this.connection.sendRawTransaction(transaction.serialize());
            
            // Confirm transaction
            await this.connection.confirmTransaction(signature, 'confirmed');

            return {
                success: true,
                data: {
                    signature,
                    inputAmount: quote.inAmount,
                    outputAmount: quote.outAmount,
                    inputMint: quote.inputMint,
                    outputMint: quote.outputMint
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Buy token with SOL (wrapper for executeSwap)
     * @param {string} tokenMint - Token to buy
     * @param {number} solAmount - Amount of SOL to spend
     * @param {string} userPublicKey - User's wallet
     * @param {string} privateKey - User's private key
     * @param {number} slippageBps - Slippage tolerance
     * @returns {Promise<Object>} Purchase result
     */
    async buyTokenWithSOL(tokenMint, solAmount, userPublicKey, privateKey, slippageBps = 100) {
        try {
            const SOL_MINT = 'So11111111111111111111111111111111111111112'; // Wrapped SOL
            const amount = Math.floor(solAmount * LAMPORTS_PER_SOL);

            // Get quote
            const quoteResult = await this.getSwapQuote(SOL_MINT, tokenMint, amount, slippageBps);
            if (!quoteResult.success) {
                return quoteResult;
            }

            // Execute swap
            const swapResult = await this.executeSwap(quoteResult.data, userPublicKey, privateKey);
            
            return {
                success: swapResult.success,
                data: {
                    ...swapResult.data,
                    type: 'buy',
                    solSpent: solAmount,
                    tokenReceived: swapResult.data?.outputAmount || 0
                },
                error: swapResult.error
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Sell token for SOL
     * @param {string} tokenMint - Token to sell
     * @param {number} tokenAmount - Amount of tokens to sell
     * @param {string} userPublicKey - User's wallet
     * @param {string} privateKey - User's private key
     * @param {number} slippageBps - Slippage tolerance
     * @returns {Promise<Object>} Sale result
     */
    async sellTokenForSOL(tokenMint, tokenAmount, userPublicKey, privateKey, slippageBps = 100) {
        try {
            const SOL_MINT = 'So11111111111111111111111111111111111111112';

            // Get quote
            const quoteResult = await this.getSwapQuote(tokenMint, SOL_MINT, tokenAmount, slippageBps);
            if (!quoteResult.success) {
                return quoteResult;
            }

            // Execute swap
            const swapResult = await this.executeSwap(quoteResult.data, userPublicKey, privateKey);
            
            return {
                success: swapResult.success,
                data: {
                    ...swapResult.data,
                    type: 'sell',
                    tokenSold: tokenAmount,
                    solReceived: (swapResult.data?.outputAmount || 0) / LAMPORTS_PER_SOL
                },
                error: swapResult.error
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get transaction history for a wallet
     * @param {string} publicKey - Wallet public key
     * @param {number} limit - Number of transactions to fetch
     * @returns {Promise<Object>} Transaction history
     */
    async getTransactionHistory(publicKey, limit = 10) {
        try {
            const pubKey = new PublicKey(publicKey);
            const signatures = await this.connection.getSignaturesForAddress(pubKey, { limit });
            
            const transactions = await Promise.all(
                signatures.map(async (sig) => {
                    try {
                        const tx = await this.connection.getParsedTransaction(sig.signature);
                        return {
                            signature: sig.signature,
                            blockTime: sig.blockTime,
                            status: sig.err ? 'failed' : 'success',
                            fee: tx?.meta?.fee || 0,
                            slot: sig.slot
                        };
                    } catch (error) {
                        return {
                            signature: sig.signature,
                            blockTime: sig.blockTime,
                            status: 'unknown',
                            error: error.message
                        };
                    }
                })
            );

            return {
                success: true,
                data: transactions
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Validate Solana address
     * @param {string} address - Address to validate
     * @returns {boolean} Is valid address
     */
    isValidAddress(address) {
        try {
            new PublicKey(address);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Generate simple mnemonic for display (not BIP39 compliant)
     * @param {Uint8Array} secretKey - Secret key bytes
     * @returns {string} Simple mnemonic
     */
    generateMnemonic(secretKey) {
        const words = [
            'apple', 'banana', 'cherry', 'dragon', 'elephant', 'forest', 'guitar', 'harmony',
            'island', 'jungle', 'keyboard', 'lemon', 'mountain', 'ocean', 'piano', 'quantum',
            'rainbow', 'sunset', 'thunder', 'universe', 'volcano', 'whisper', 'xylophone', 'yellow', 'zebra'
        ];
        
        const hash = crypto.createHash('sha256').update(secretKey).digest();
        const mnemonic = [];
        
        for (let i = 0; i < 12; i++) {
            const index = hash[i] % words.length;
            mnemonic.push(words[index]);
        }
        
        return mnemonic.join(' ');
    }

    /**
     * Encrypt private key for storage
     * @param {string} privateKey - Private key to encrypt
     * @param {string} password - Encryption password
     * @returns {string} Encrypted private key
     */
    encryptPrivateKey(privateKey, password) {
        const algorithm = 'aes-256-gcm';
        const key = crypto.scryptSync(password, 'salt', 32);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipher(algorithm, key);
        
        let encrypted = cipher.update(privateKey, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        return iv.toString('hex') + ':' + encrypted;
    }

    /**
     * Decrypt private key
     * @param {string} encryptedKey - Encrypted private key
     * @param {string} password - Decryption password
     * @returns {string} Decrypted private key
     */
    decryptPrivateKey(encryptedKey, password) {
        const algorithm = 'aes-256-gcm';
        const key = crypto.scryptSync(password, 'salt', 32);
        const [ivHex, encrypted] = encryptedKey.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipher(algorithm, key);
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    }
}

module.exports = WalletService;