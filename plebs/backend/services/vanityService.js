// services/vanityService.js - Main vanity generation service
const { Worker } = require('worker_threads');
const path = require('path');
const crypto = require('crypto');

class VanityService {
    constructor() {
        this.activeJobs = new Map(); // userId -> job info
        this.maxConcurrentJobs = 3;
        this.maxPatternLength = 6; // Reasonable limit for Solana addresses
        this.maxGenerationTime = 30 * 60 * 1000; // 30 minutes max
    }

    // Calculate difficulty estimate for user guidance
    calculateDifficulty(pattern, type) {
        const base58Chars = 58;
        let baseDifficulty;
        
        switch (type) {
            case 'prefix':
            case 'suffix':
                baseDifficulty = Math.pow(base58Chars, pattern.length);
                break;
            case 'contains':
                // Contains is generally easier
                baseDifficulty = Math.pow(base58Chars, pattern.length) / pattern.length;
                break;
            default:
                baseDifficulty = Math.pow(base58Chars, pattern.length);
        }
        
        const estimatedAttempts = Math.round(baseDifficulty * 0.693);
        const estimatedSeconds = estimatedAttempts / 1000; // Assuming 1K attempts/sec
        
        return {
            difficulty: baseDifficulty,
            estimatedAttempts,
            estimatedTime: this.formatTime(estimatedSeconds),
            warningLevel: this.getDifficultyWarning(estimatedSeconds)
        };
    }

    // Get difficulty warning level
    getDifficultyWarning(estimatedSeconds) {
        if (estimatedSeconds < 60) return 'easy';
        if (estimatedSeconds < 300) return 'medium';
        if (estimatedSeconds < 1800) return 'hard';
        return 'extreme';
    }

    // Format time duration
    formatTime(seconds) {
        if (seconds < 60) return `${Math.round(seconds)}s`;
        if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
        if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
        return `${Math.round(seconds / 86400)}d`;
    }

    // Validate vanity pattern
    validatePattern(pattern, type) {
        const errors = [];
        
        if (!pattern || pattern.length === 0) {
            errors.push('❌ Pattern cannot be empty');
            return { valid: false, errors };
        }
        
        if (pattern.length > this.maxPatternLength) {
            errors.push(`❌ Pattern too long (max ${this.maxPatternLength} characters)`);
        }
        
        // Check for invalid Base58 characters
        const validBase58 = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
        if (!validBase58.test(pattern)) {
            errors.push('❌ Pattern contains invalid characters (use Base58: no 0, O, I, l)');
        }
        
        // Check if pattern is reasonable
        const difficulty = this.calculateDifficulty(pattern, type);
        if (difficulty.warningLevel === 'extreme') {
            errors.push(`⚠️ This pattern is extremely difficult and may take ${difficulty.estimatedTime} to find`);
        }
        
        return {
            valid: errors.length === 0,
            errors,
            difficulty
        };
    }

    // Start vanity generation
    async startGeneration(userId, pattern, type, telegramBot) {
        // Check if user already has an active job
        if (this.activeJobs.has(userId)) {
            throw new Error('❌ You already have an active vanity generation running. Use /vanity_cancel to stop it first.');
        }

        // Check concurrent jobs limit
        if (this.activeJobs.size >= this.maxConcurrentJobs) {
            throw new Error('❌ Maximum concurrent vanity generations reached. Please try again later.');
        }

        // Validate pattern
        const validation = this.validatePattern(pattern, type);
        if (!validation.valid) {
            throw new Error(validation.errors.join('\n'));
        }

        // Generate unique job ID
        const jobId = crypto.randomBytes(8).toString('hex');
        
        // Create worker
        const worker = new Worker(path.join(__dirname, 'vanityWorker.js'), {
            workerData: { pattern, type, jobId }
        });

        // Job info
        const jobInfo = {
            jobId,
            userId,
            pattern,
            type,
            worker,
            startTime: Date.now(),
            lastProgress: 0,
            difficulty: validation.difficulty
        };

        // Set up worker event handlers
        worker.on('message', (message) => {
            this.handleWorkerMessage(userId, message, telegramBot);
        });

        worker.on('error', (error) => {
            this.handleWorkerError(userId, error, telegramBot);
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                this.handleWorkerError(userId, new Error(`Worker stopped with exit code ${code}`), telegramBot);
            }
        });

        // Set timeout
        const timeout = setTimeout(() => {
            this.cancelGeneration(userId, 'Generation timed out after 30 minutes', telegramBot);
        }, this.maxGenerationTime);

        jobInfo.timeout = timeout;
        this.activeJobs.set(userId, jobInfo);

        return {
            jobId,
            difficulty: validation.difficulty,
            startMessage: this.getStartMessage(pattern, type, validation.difficulty)
        };
    }

    // Handle worker messages
    handleWorkerMessage(userId, message, telegramBot) {
        const jobInfo = this.activeJobs.get(userId);
        if (!jobInfo) return;

        switch (message.type) {
            case 'progress':
                this.handleProgress(userId, message, telegramBot);
                break;
            case 'success':
                this.handleSuccess(userId, message, telegramBot);
                break;
            case 'error':
                this.handleWorkerError(userId, new Error(message.error), telegramBot);
                break;
        }
    }

    // Handle progress updates
    handleProgress(userId, message, telegramBot) {
        const jobInfo = this.activeJobs.get(userId);
        if (!jobInfo) return;

        const { attempts } = message;
        const elapsed = Date.now() - jobInfo.startTime;
        const attemptsPerSecond = Math.round(attempts / (elapsed / 1000));
        
        // Only send progress updates every 10K attempts to avoid spam
        if (attempts - jobInfo.lastProgress >= 10000) {
            const progressText = `🔍 **Vanity Generation Progress**\n\n` +
                `Pattern: \`${jobInfo.pattern}\` (${jobInfo.type})\n` +
                `Attempts: ${attempts.toLocaleString()}\n` +
                `Speed: ${attemptsPerSecond.toLocaleString()}/sec\n` +
                `Elapsed: ${this.formatTime(elapsed / 1000)}\n\n` +
                `Use /vanity_cancel to stop generation`;

            telegramBot.sendMessage(userId, progressText, { parse_mode: 'Markdown' });
            jobInfo.lastProgress = attempts;
        }
    }

    // Handle successful generation
    handleSuccess(userId, message, telegramBot) {
        const jobInfo = this.activeJobs.get(userId);
        if (!jobInfo) return;

        const { result } = message;
        const elapsed = Date.now() - jobInfo.startTime;

        const successText = `🎉 **Vanity Wallet Generated Successfully!**\n\n` +
            `✨ **Address:** \`${result.address}\`\n` +
            `🎯 **Pattern:** \`${jobInfo.pattern}\` (${jobInfo.type})\n` +
            `🔢 **Attempts:** ${result.attempts.toLocaleString()}\n` +
            `⏱️ **Time:** ${this.formatTime(elapsed / 1000)}\n\n` +
            `Your vanity wallet has been saved securely! 🔐\n` +
            `Use /wallet to manage your wallets.`;

        telegramBot.sendMessage(userId, successText, { parse_mode: 'Markdown' });
        
        // Clean up
        this.cleanupJob(userId);

        // Return result for saving to database
        return {
            address: result.address,
            publicKey: result.publicKey,
            privateKey: result.privateKey,
            mnemonic: result.mnemonic,
            isVanity: true,
            vanityPattern: jobInfo.pattern,
            vanityType: jobInfo.type,
            attempts: result.attempts,
            generationTime: elapsed
        };
    }

    // Handle worker errors
    handleWorkerError(userId, error, telegramBot) {
        const errorText = `❌ **Vanity Generation Failed**\n\n${error.message}`;
        telegramBot.sendMessage(userId, errorText, { parse_mode: 'Markdown' });
        this.cleanupJob(userId);
    }

    // Cancel generation
    cancelGeneration(userId, reason = 'Cancelled by user', telegramBot) {
        const jobInfo = this.activeJobs.get(userId);
        if (!jobInfo) {
            return false;
        }

        // Terminate worker
        jobInfo.worker.terminate();
        
        // Send cancellation message
        const cancelText = `⏹️ **Vanity Generation Cancelled**\n\n${reason}`;
        telegramBot.sendMessage(userId, cancelText, { parse_mode: 'Markdown' });
        
        this.cleanupJob(userId);
        return true;
    }

    // Get generation status
    getStatus(userId) {
        const jobInfo = this.activeJobs.get(userId);
        if (!jobInfo) {
            return null;
        }

        const elapsed = Date.now() - jobInfo.startTime;
        return {
            pattern: jobInfo.pattern,
            type: jobInfo.type,
            elapsed: this.formatTime(elapsed / 1000),
            difficulty: jobInfo.difficulty
        };
    }

    // Clean up job
    cleanupJob(userId) {
        const jobInfo = this.activeJobs.get(userId);
        if (jobInfo) {
            if (jobInfo.timeout) {
                clearTimeout(jobInfo.timeout);
            }
            if (jobInfo.worker) {
                jobInfo.worker.terminate();
            }
            this.activeJobs.delete(userId);
        }
    }

    // Get start message
    getStartMessage(pattern, type, difficulty) {
        const warningEmojis = {
            'easy': '🟢',
            'medium': '🟡', 
            'hard': '🟠',
            'extreme': '🔴'
        };

        return `🎯 **Starting Vanity Generation**\n\n` +
            `Pattern: \`${pattern}\` (${type})\n` +
            `${warningEmojis[difficulty.warningLevel]} Difficulty: ${difficulty.warningLevel.toUpperCase()}\n` +
            `⏱️ Estimated Time: ~${difficulty.estimatedTime}\n` +
            `🔢 Expected Attempts: ~${difficulty.estimatedAttempts.toLocaleString()}\n\n` +
            `Generation started! This may take a while...\n` +
            `Use /vanity_status to check progress or /vanity_cancel to stop.`;
    }

    // Get all active jobs (for admin)
    getAllActiveJobs() {
        const jobs = [];
        for (const [userId, jobInfo] of this.activeJobs) {
            jobs.push({
                userId,
                pattern: jobInfo.pattern,
                type: jobInfo.type,
                elapsed: Date.now() - jobInfo.startTime,
                difficulty: jobInfo.difficulty.warningLevel
            });
        }
        return jobs;
    }
}

module.exports = new VanityService();

// Bot command handlers to add to your main bot file:

/*
// Add these to your telegraphBot.js or main bot file:

// Vanity wallet generation command
bot.onText(/\/vanity(?:\s+(.+))?/, async (msg, match) => {
    const userId = msg.from.id;
    const args = match[1];
    
    try {
        // Check if user is PRO
        const user = await getUserData(userId);
        if (!user.isPro) {
            return bot.sendMessage(userId, 
                "🔒 **Vanity Wallet Generation - PRO Feature**\n\n" +
                "Vanity wallets allow you to create custom addresses with your preferred patterns!\n\n" +
                "Examples:\n" +
                "• `ABC123...` (prefix)\n" +
                "• `...MOON` (suffix)\n" +
                "• Contains `DOGE` anywhere\n\n" +
                "Upgrade to PRO to unlock this feature! 💎",
                { parse_mode: 'Markdown' }
            );
        }

        if (!args) {
            return bot.sendMessage(userId,
                "🎯 **Vanity Wallet Generator**\n\n" +
                "Create custom Solana addresses with your preferred patterns!\n\n" +
                "**Usage:**\n" +
                "`/vanity <pattern> <type>`\n\n" +
                "**Types:**\n" +
                "• `prefix` - Address starts with pattern\n" +
                "• `suffix` - Address ends with pattern\n" +
                "• `contains` - Address contains pattern\n\n" +
                "**Examples:**\n" +
                "`/vanity ABC prefix`\n" +
                "`/vanity MOON suffix`\n" +
                "`/vanity DOGE contains`\n\n" +
                "**Other Commands:**\n" +
                "• `/vanity_status` - Check progress\n" +
                "• `/vanity_cancel` - Cancel generation",
                { parse_mode: 'Markdown' }
            );
        }

        const parts = args.split(' ');
        if (parts.length < 2) {
            return bot.sendMessage(userId, "❌ Please specify both pattern and type.\nExample: `/vanity ABC prefix`", { parse_mode: 'Markdown' });
        }

        const pattern = parts[0];
        const type = parts[1].toLowerCase();

        if (!['prefix', 'suffix', 'contains'].includes(type)) {
            return bot.sendMessage(userId, "❌ Invalid type. Use: `prefix`, `suffix`, or `contains`", { parse_mode: 'Markdown' });
        }

        // Start generation
        const vanityService = require('./services/vanityService');
        const result = await vanityService.startGeneration(userId, pattern, type, bot);
        
        bot.sendMessage(userId, result.startMessage, { parse_mode: 'Markdown' });

    } catch (error) {
        bot.sendMessage(userId, error.message, { parse_mode: 'Markdown' });
    }
});

// Check vanity generation status
bot.onText(/\/vanity_status/, (msg) => {
    const userId = msg.from.id;
    
    const vanityService = require('./services/vanityService');
    const status = vanityService.getStatus(userId);
    
    if (!status) {
        return bot.sendMessage(userId, "❌ No active vanity generation found.");
    }

    const statusText = `📊 **Vanity Generation Status**\n\n` +
        `Pattern: \`${status.pattern}\` (${status.type})\n` +
        `Elapsed: ${status.elapsed}\n` +
        `Difficulty: ${status.difficulty.warningLevel.toUpperCase()}\n\n` +
        `Generation is still running...\n` +
        `Use /vanity_cancel to stop.`;

    bot.sendMessage(userId, statusText, { parse_mode: 'Markdown' });
});

// Cancel vanity generation
bot.onText(/\/vanity_cancel/, (msg) => {
    const userId = msg.from.id;
    
    const vanityService = require('./services/vanityService');
    const cancelled = vanityService.cancelGeneration(userId, 'Cancelled by user', bot);
    
    if (!cancelled) {
        bot.sendMessage(userId, "❌ No active vanity generation to cancel.");
    }
});

*/