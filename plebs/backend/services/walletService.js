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
const axios = require('axios');
require('dotenv').config();

/**
 * WalletService provides utility methods for interacting with the Solana blockchain,
 * including wallet management, SOL and SPL token transfers, token swaps via Jupiter API,
 * balance queries, transaction history, and secure private key encryption.
 *
 * @class
 *
 * @property {Connection} connection - Solana RPC connection instance.
 * @property {string} jupiterApiUrl - Jupiter API base URL for swaps and quotes.
 * @property {number} platformFeeBps - Platform fee in basis points for swaps.
 * @property {string} platformFeeAccount - SPL token account to receive platform fees.
 *
 * @example
 * const walletService = new WalletService();
 *
 * // Generate a new wallet
 * const wallet = walletService.generateWallet();
 *
 * // Get SOL balance
 * const balance = await walletService.getSOLBalance(wallet.data.publicKey);
 *
 * // Send SOL
 * const tx = await walletService.sendSOL(wallet.data.privateKey, recipientPublicKey, 0.1);
 *
 * // Swap tokens
 * const quote = await walletService.getSwapQuote(inputMint, outputMint, amount);
 * const swapResult = await walletService.executeSwap(quote.data, wallet.data.publicKey, wallet.data.privateKey);
 */
class WalletService {
    constructor() {
        this.connection = new Connection(
            process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
            'confirmed'
        );
        this.jupiterApiUrl = 'https://quote-api.jup.ag/v6';
        this.platformFeeBps = parseInt(process.env.PLATFORM_FEE_BPS || '30'); // 0.3%
        this.platformFeeAccount = process.env.PLATFORM_FEE_ACCOUNT; // SPL token account to receive fee
    }

    async getSwapRoute({ inputMint, outputMint, amount }) {
        const url = `${this.jupiterApiUrl}/swap`; // newer endpoint supports fee

        const params = {
            inputMint,
            outputMint,
            amount,
            slippageBps: 50,
            platformFeeBps: this.platformFeeBps,
            platformFeeAccount: this.platformFeeAccount
        };

        const { data } = await axios.get(`${this.jupiterApiUrl}/quote`, { params });
        return data?.[0];
    }

    async buildAndSendSwapTx(userKeypair, route) {
        const { data } = await axios.post(`${this.jupiterApiUrl}/swap`, {
            route,
            userPublicKey: userKeypair.publicKey.toBase58(),
            wrapUnwrapSOL: true,
            feeAccount: this.platformFeeAccount
        });

        const txBuf = Buffer.from(data.swapTransaction, 'base64');
        const tx = Transaction.from(txBuf);
        tx.partialSign(userKeypair);

        const signature = await this.connection.sendRawTransaction(tx.serialize());
        await this.connection.confirmTransaction(signature);
        return signature;
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
     * @returns {Promise<Object> Transaction result
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
     * Send SPL Token to another wallet
     * @param {string} fromPrivateKey - Sender's private key (base58)
     * @param {string} toPublicKey - Recipient's public key
     * @param {number} amount - Amount of tokens to send (in UI units)
     * @param {string} mint - SPL token mint address
     * @returns {Promise<Object>} Transaction result
     */
    async sendSPLToken(fromPrivateKey, toPublicKey, amount, mint) {
        try {
            const fromKeypair = Keypair.fromSecretKey(bs58.decode(fromPrivateKey));
            const mintPubkey = new PublicKey(mint);
            const toPubkey = new PublicKey(toPublicKey);

            // Get or create associated token accounts
            const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
                this.connection, fromKeypair, mintPubkey, fromKeypair.publicKey
            );
            const toTokenAccount = await getOrCreateAssociatedTokenAccount(
                this.connection, fromKeypair, mintPubkey, toPubkey
            );

            // Get decimals for the mint
            const mintInfo = await this.connection.getParsedAccountInfo(mintPubkey);
            const decimals = mintInfo.value?.data?.parsed?.info?.decimals || 0;
            const amountInSmallestUnit = Math.floor(amount * Math.pow(10, decimals));

            // Create transfer instruction
            const transferIx = createTransferInstruction(
                fromTokenAccount.address,
                toTokenAccount.address,
                fromKeypair.publicKey,
                amountInSmallestUnit,
                [],
                TOKEN_PROGRAM_ID
            );

            const tx = new Transaction().add(transferIx);
            const signature = await sendAndConfirmTransaction(
                this.connection,
                tx,
                [fromKeypair]
            );

            return {
                success: true,
                data: { signature, from: fromTokenAccount.address.toString(), to: toTokenAccount.address.toString(), amount }
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Create a new SPL Token (mint)
     * @param {string} fromPrivateKey - Creator's private key (base58)
     * @param {number} decimals - Number of decimals for the token
     * @param {number} initialSupply - Initial supply (UI units)
     * @returns {Promise<Object>} Mint info
     */
    async createSPLToken(fromPrivateKey, decimals, initialSupply) {
        try {
            const fromKeypair = Keypair.fromSecretKey(bs58.decode(fromPrivateKey));
            const mint = await import('@solana/spl-token').then(spl =>
                spl.createMint(
                    this.connection,
                    fromKeypair,
                    fromKeypair.publicKey,
                    null,
                    decimals
                )
            );
            // Create associated token account for creator
            const tokenAccount = await getOrCreateAssociatedTokenAccount(
                this.connection, fromKeypair, mint, fromKeypair.publicKey
            );
            // Mint initial supply to creator
            if (initialSupply > 0) {
                const amountInSmallestUnit = Math.floor(initialSupply * Math.pow(10, decimals));
                await import('@solana/spl-token').then(spl =>
                    spl.mintTo(
                        this.connection,
                        fromKeypair,
                        mint,
                        tokenAccount.address,
                        fromKeypair.publicKey,
                        amountInSmallestUnit
                    )
                );
            }
            return {
                success: true,
                data: {
                    mint: mint.toString(),
                    tokenAccount: tokenAccount.address.toString(),
                    decimals,
                    initialSupply
                }
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Get minimum rent-exempt balance for SPL token account
     * @param {number} decimals - Number of decimals for the token
     * @returns {Promise<Object>} Rent-exempt balance in lamports
     */
    async getRentExemptBalance(decimals) {
        try {
            const { getMinimumBalanceForRentExemptAccount } = await import('@solana/spl-token');
            const rent = await getMinimumBalanceForRentExemptAccount(this.connection);
            return { success: true, data: { rent } };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Get quote for token swap using Jupiter API
     * @param {string} inputMint - Input token mint address
     * @param {string} outputMint - Output token mint address
     * @param {number} amount - Amount to swap (in token's smallest unit)
     * @param {number} slippageBps - Slippage in basis points (50 = 0.5%)
     * @param {number} [platformFeeBps] - Platform fee in basis points (optional, default from env)
     * @param {string} [platformFeeAccount] - Platform fee account (optional, default from env)
     * @returns {Promise<Object>} Quote information
     */
    async getSwapQuote(inputMint, outputMint, amount, slippageBps = 50, platformFeeBps, platformFeeAccount) {
        try {
            const params = new URLSearchParams({
                inputMint,
                outputMint,
                amount: amount.toString(),
                slippageBps: slippageBps.toString(),
                platformFeeBps: (platformFeeBps || this.platformFeeBps).toString(),
                platformFeeAccount: platformFeeAccount || this.platformFeeAccount
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
     * @param {number} [prioritizationFeeLamports] - User-specified priority fee (optional)
     * @returns {Promise<Object>} Swap transaction result
     */
    async executeSwap(quote, userPublicKey, privateKey, prioritizationFeeLamports = 1000) {
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
                    prioritizationFeeLamports: prioritizationFeeLamports || 1000
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
     * @param {number} [prioritizationFeeLamports] - User-specified priority fee (optional)
     * @param {number} [platformFeeBps] - Platform fee in basis points (optional)
     * @param {string} [platformFeeAccount] - Platform fee account (optional)
     * @returns {Promise<Object>} Purchase result
     */
    async buyTokenWithSOL(tokenMint, solAmount, userPublicKey, privateKey, slippageBps = 100, prioritizationFeeLamports, platformFeeBps, platformFeeAccount) {
        try {
            const SOL_MINT = 'So11111111111111111111111111111111111111112'; // Wrapped SOL
            const amount = Math.floor(solAmount * LAMPORTS_PER_SOL);

            // Get quote
            const quoteResult = await this.getSwapQuote(SOL_MINT, tokenMint, amount, slippageBps, platformFeeBps, platformFeeAccount);
            if (!quoteResult.success) {
                return quoteResult;
            }

            // Execute swap
            const swapResult = await this.executeSwap(quoteResult.data, userPublicKey, privateKey, prioritizationFeeLamports);
            
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
     * @param {number} [prioritizationFeeLamports] - User-specified priority fee (optional)
     * @param {number} [platformFeeBps] - Platform fee in basis points (optional)
     * @param {string} [platformFeeAccount] - Platform fee account (optional)
     * @returns {Promise<Object>} Sale result
     */
    async sellTokenForSOL(tokenMint, tokenAmount, userPublicKey, privateKey, slippageBps = 100, prioritizationFeeLamports, platformFeeBps, platformFeeAccount) {
        try {
            const SOL_MINT = 'So11111111111111111111111111111111111111112';

            // Get quote
            const quoteResult = await this.getSwapQuote(tokenMint, SOL_MINT, tokenAmount, slippageBps, platformFeeBps, platformFeeAccount);
            if (!quoteResult.success) {
                return quoteResult;
            }

            // Execute swap
            const swapResult = await this.executeSwap(quoteResult.data, userPublicKey, privateKey, prioritizationFeeLamports);
            
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
     * Encrypt private key for storage (AES-256-GCM)
     * @param {string} privateKey - Private key to encrypt
     * @param {string} password - Encryption password
     * @returns {string} Encrypted private key (iv:authTag:encrypted)
     */
    encryptPrivateKey(privateKey, password) {
        const algorithm = 'aes-256-gcm';
        const key = crypto.scryptSync(password, 'salt', 32);
        const iv = crypto.randomBytes(12); // 12 bytes for GCM
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        let encrypted = cipher.update(privateKey, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag();
        return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    }

    /**
     * Decrypt private key (AES-256-GCM)
     * @param {string} encryptedKey - Encrypted private key (iv:authTag:encrypted)
     * @param {string} password - Decryption password
     * @returns {string} Decrypted private key
     */
    decryptPrivateKey(encryptedKey, password) {
        const algorithm = 'aes-256-gcm';
        const key = crypto.scryptSync(password, 'salt', 32);
        const [ivHex, authTagHex, encrypted] = encryptedKey.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv(algorithm, key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
}

module.exports = WalletService;