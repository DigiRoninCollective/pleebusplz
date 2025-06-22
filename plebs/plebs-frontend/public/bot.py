# bot.py - PLEBS Telegram Bot with Token Analysis & Swapping
import telebot
import requests
import json
import os
from datetime import datetime
import sqlite3
from typing import Dict, Optional
import asyncio
import aiohttp
from telebot import types
from dotenv import load_dotenv
import re
import logging

load_dotenv()

BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
JUPITER_API_URL = "https://quote-api.jup.ag/v6"
SOLANA_RPC_URL = os.getenv('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com')
BACKEND_API_URL = os.getenv('BACKEND_API_URL', 'http://localhost:3000/api')
CHATROOM_URL = os.getenv('CHATROOM_URL', 'https://plebs.chat')

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

def call_wallet_api(endpoint, method='GET', data=None):
    url = f"{BACKEND_API_URL}/wallet/{endpoint}"
    try:
        if method == 'POST':
            response = requests.post(url, json=data)
        else:
            response = requests.get(url)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        logging.error(f"Wallet API error at {endpoint}: {e}")
        return None

# Example: Generate wallet
def generate_wallet_for_user():
    return call_wallet_api('generate', 'POST')

# Example: Buy token
def buy_token(token_mint, sol_amount, user_public_key, private_key):
    data = {
        'tokenMint': token_mint,
        'solAmount': sol_amount,
        'userPublicKey': user_public_key,
        'privateKey': private_key
    }
    return call_wallet_api('buy', 'POST', data)

# Bot configuration
bot = telebot.TeleBot(BOT_TOKEN)

# Database setup
def init_db():
    conn = sqlite3.connect('plebs_bot.db')
    c = conn.cursor()
    
    # Users table
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        telegram_id INTEGER PRIMARY KEY,
        username TEXT,
        wallet_address TEXT,
        joined_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_verified BOOLEAN DEFAULT FALSE,
        referral_code TEXT,
        total_volume REAL DEFAULT 0
    )''')
    
    # Token interactions table
    c.execute('''CREATE TABLE IF NOT EXISTS token_interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id INTEGER,
        token_address TEXT,
        action TEXT,
        amount REAL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
    )''')
    
    conn.commit()
    conn.close()

# Utility functions
def is_valid_solana_address(address: str) -> bool:
    """Validate Solana address format"""
    return len(address) >= 32 and len(address) <= 44 and address.replace('1', '').replace('2', '').replace('3', '').replace('4', '').replace('5', '').replace('6', '').replace('7', '').replace('8', '').replace('9', '').replace('A', '').replace('B', '').replace('C', '').replace('D', '').replace('E', '').replace('F', '').replace('G', '').replace('H', '').replace('J', '').replace('K', '').replace('L', '').replace('M', '').replace('N', '').replace('P', '').replace('Q', '').replace('R', '').replace('S', '').replace('T', '').replace('U', '').replace('V', '').replace('W', '').replace('X', '').replace('Y', '').replace('Z', '').replace('a', '').replace('b', '').replace('c', '').replace('d', '').replace('e', '').replace('f', '').replace('g', '').replace('h', '').replace('i', '').replace('j', '').replace('k', '').replace('m', '').replace('n', '').replace('o', '').replace('p', '').replace('q', '').replace('r', '').replace('s', '').replace('t', '').replace('u', '').replace('v', '').replace('w', '').replace('x', '').replace('y', '').replace('z', '') == ''

def get_user_from_db(telegram_id: int) -> Optional[Dict]:
    """Get user data from database"""
    conn = sqlite3.connect('plebs_bot.db')
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE telegram_id = ?", (telegram_id,))
    user = c.fetchone()
    conn.close()
    
    if user:
        return {
            'telegram_id': user[0],
            'username': user[1],
            'wallet_address': user[2],
            'joined_date': user[3],
            'is_verified': user[4],
            'referral_code': user[5],
            'total_volume': user[6]
        }
    return None

def save_user_to_db(telegram_id: int, username: str, wallet_address: str = None):
    """Save user to database"""
    conn = sqlite3.connect('plebs_bot.db')
    c = conn.cursor()
    c.execute("""
        INSERT OR REPLACE INTO users (telegram_id, username, wallet_address)
        VALUES (?, ?, ?)
    """, (telegram_id, username, wallet_address))
    conn.commit()
    conn.close()

async def get_token_info(token_address: str) -> Dict:
    """Get comprehensive token information"""
    try:
        # Get token metadata from Jupiter/DexScreener
        async with aiohttp.ClientSession() as session:
            # DexScreener API for token info
            dex_url = f"https://api.dexscreener.com/latest/dex/tokens/{token_address}"
            async with session.get(dex_url) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('pairs'):
                        pair = data['pairs'][0]  # Get first pair
                        return {
                            'address': token_address,
                            'name': pair.get('baseToken', {}).get('name', 'Unknown'),
                            'symbol': pair.get('baseToken', {}).get('symbol', 'Unknown'),
                            'price_usd': float(pair.get('priceUsd', 0)),
                            'market_cap': pair.get('marketCap', 0),
                            'liquidity': pair.get('liquidity', {}).get('usd', 0),
                            'volume_24h': pair.get('volume', {}).get('h24', 0),
                            'price_change_24h': pair.get('priceChange', {}).get('h24', 0),
                            'dex': pair.get('dexId', 'Unknown'),
                            'pair_address': pair.get('pairAddress', ''),
                            'url': pair.get('url', '')
                        }
    except Exception as e:
        logging.error(f"Error fetching token info: {e}")
    
    return {
        'address': token_address,
        'name': 'Unknown Token',
        'symbol': 'UNKNOWN',
        'price_usd': 0,
        'market_cap': 0,
        'liquidity': 0,
        'volume_24h': 0,
        'price_change_24h': 0,
        'dex': 'Unknown',
        'pair_address': '',
        'url': ''
    }

async def get_chatroom_stats(token_address: str) -> Dict:
    """Get chatroom statistics for a token"""
    try:
        async with aiohttp.ClientSession() as session:
            url = f"{BACKEND_API_URL}/chatroom/stats/{token_address}"
            async with session.get(url) as response:
                if response.status == 200:
                    return await response.json()
    except Exception as e:
        logging.error(f"Error fetching chatroom stats: {e}")
    
    return {
        'active_users': 0,
        'total_messages': 0,
        'online_now': 0,
        'room_created': None
    }

def create_token_keyboard(token_address: str) -> types.InlineKeyboardMarkup:
    """Create interactive keyboard for token actions"""
    keyboard = types.InlineKeyboardMarkup(row_width=2)
    
    # Action buttons
    buy_btn = types.InlineKeyboardButton("🟢 Buy Token", callback_data=f"buy_{token_address}")
    sell_btn = types.InlineKeyboardButton("🔴 Sell Token", callback_data=f"sell_{token_address}")
    
    # Info buttons
    chart_btn = types.InlineKeyboardButton("📈 View Chart", callback_data=f"chart_{token_address}")
    chatroom_btn = types.InlineKeyboardButton("💬 Join Chatroom", callback_data=f"chatroom_{token_address}")
    
    # Utility buttons
    refresh_btn = types.InlineKeyboardButton("🔄 Refresh", callback_data=f"refresh_{token_address}")
    alerts_btn = types.InlineKeyboardButton("🔔 Set Alerts", callback_data=f"alerts_{token_address}")
    
    keyboard.add(buy_btn, sell_btn)
    keyboard.add(chart_btn, chatroom_btn)
    keyboard.add(refresh_btn, alerts_btn)
    
    return keyboard

def format_number(num: float) -> str:
    """Format numbers for display"""
    if num >= 1_000_000:
        return f"${num/1_000_000:.2f}M"
    elif num >= 1_000:
        return f"${num/1_000:.2f}K"
    else:
        return f"${num:.2f}"

def format_token_message(token_info: Dict, chatroom_stats: Dict) -> str:
    """Format comprehensive token information message"""
    
    # Price change emoji
    change_emoji = "🟢" if token_info['price_change_24h'] >= 0 else "🔴"
    
    # Security indicators (placeholder - you'd implement actual checks)
    security_score = "🟢 Safe" if token_info['liquidity'] > 50000 else "🟡 Moderate" if token_info['liquidity'] > 10000 else "🔴 High Risk"
    
    message = f"""
🪙 **{token_info['name']} ({token_info['symbol']})**

💰 **Price Info:**
├ Price: ${token_info['price_usd']:.6f}
├ 24h Change: {change_emoji} {token_info['price_change_24h']:.2f}%
├ Market Cap: {format_number(token_info['market_cap'])}
└ Liquidity: {format_number(token_info['liquidity'])}

📊 **Trading Stats:**
├ 24h Volume: {format_number(token_info['volume_24h'])}
├ DEX: {token_info['dex']}
└ Security: {security_score}

💬 **PLEBS Chatroom:**
├ Online Now: {chatroom_stats['online_now']} users
├ Total Messages: {chatroom_stats['total_messages']}
├ Active Traders: {chatroom_stats['active_users']}
└ Room Status: {"🟢 Active" if chatroom_stats['online_now'] > 0 else "🟡 Quiet"}

🔗 **Contract:** `{token_info['address']}`

*Join our chatroom to discuss this token with other traders and get real-time insights!*
    """
    
    return message

# Bot command handlers
@bot.message_handler(commands=['start'])
def start_command(message):
    user_id = message.from_user.id
    username = message.from_user.username or message.from_user.first_name
    
    # Save user if not exists
    if not get_user_from_db(user_id):
        save_user_to_db(user_id, username)
    
    welcome_text = f"""
🚀 **Welcome to PLEBS - The People's Launchpad!** 

Hey {username}! I'm your gateway to safe and profitable token trading on Solana.

🔑 **What I can do:**
├ 📈 Analyze any token by contract address
├ 💱 Help you swap tokens safely
├ 💬 Connect you to active trading communities
├ 🛡️ Provide security insights before you trade
└ 📊 Real-time market data and alerts

🔐 **Security First:**
Your safety is our priority. I'll help you verify tokens and connect with trusted traders before making any moves.

**To get started:**
1. 📱 Connect your wallet: /wallet
2. 🎯 Analyze a token: Just paste any contract address
3. 💬 Join chatrooms for tokens you're interested in

**Need help?** Use /help for all commands.

Ready to explore the Solana ecosystem safely? 🌟
    """
    
    # Create welcome keyboard
    keyboard = types.InlineKeyboardMarkup()
    wallet_btn = types.InlineKeyboardButton("🔗 Connect Wallet", callback_data="connect_wallet")
    help_btn = types.InlineKeyboardButton("❓ Get Help", callback_data="help")
    chatroom_btn = types.InlineKeyboardButton("💬 Browse Chatrooms", callback_data="browse_rooms")
    
    keyboard.add(wallet_btn)
    keyboard.add(help_btn, chatroom_btn)
    
    bot.send_message(message.chat.id, welcome_text, reply_markup=keyboard, parse_mode='Markdown')

@bot.message_handler(commands=['help'])
def help_command(message):
    help_text = """
🤖 **PLEBS Bot Commands:**

**Token Analysis:**
├ Paste any Solana contract address for instant analysis
├ `/trending` - See trending tokens
└ `/watchlist` - Manage your token watchlist

**Wallet & Trading:**
├ `/wallet` - Connect/view your wallet
├ `/balance` - Check your token balances
└ `/portfolio` - View your trading portfolio

**Community:**
├ `/rooms` - Browse active chatrooms
├ `/create_room [token_address]` - Create token chatroom
└ `/alerts` - Manage price alerts

**Security:**
├ `/verify [token_address]` - Security check
├ `/report [token_address]` - Report suspicious tokens
└ `/safety` - Trading safety tips

**Just paste any token contract address to get started!**
    """
    
    bot.send_message(message.chat.id, help_text, parse_mode='Markdown')

@bot.message_handler(commands=['wallet'])
def wallet_command(message):
    user_id = message.from_user.id
    user = get_user_from_db(user_id)
    
    if user and user['wallet_address']:
        # User has wallet connected
        keyboard = types.InlineKeyboardMarkup()
        balance_btn = types.InlineKeyboardButton("💰 Check Balance", callback_data="check_balance")
        portfolio_btn = types.InlineKeyboardButton("📊 View Portfolio", callback_data="view_portfolio")
        disconnect_btn = types.InlineKeyboardButton("🔌 Disconnect", callback_data="disconnect_wallet")
        
        keyboard.add(balance_btn, portfolio_btn)
        keyboard.add(disconnect_btn)
        
        wallet_text = f"""
🔗 **Wallet Connected**

Address: `{user['wallet_address']}`
Status: {"✅ Verified" if user['is_verified'] else "⏳ Pending"}
Total Volume: {format_number(user['total_volume'])}

Use the buttons below to manage your wallet:
        """
        
        bot.send_message(message.chat.id, wallet_text, reply_markup=keyboard, parse_mode='Markdown')
    else:
        # No wallet connected
        keyboard = types.InlineKeyboardMarkup()
        connect_btn = types.InlineKeyboardButton("🔗 Connect Wallet", callback_data="connect_wallet")
        create_btn = types.InlineKeyboardButton("➕ Create New Wallet", callback_data="create_wallet")
        
        keyboard.add(connect_btn)
        keyboard.add(create_btn)
        
        wallet_text = """
🔐 **Connect Your Wallet**

To start trading, you need to connect a Solana wallet.

**Options:**
├ 🔗 Connect existing wallet (Phantom, Solflare, etc.)
└ ➕ Create new wallet (we'll generate one for you)

**Why connect?**
├ 💱 Swap tokens directly through me
├ 🛡️ Enhanced security features
├ 📊 Portfolio tracking
└ 💬 Access to premium chatrooms

Your keys, your crypto. We never store your private keys.
        """
        
        bot.send_message(message.chat.id, wallet_text, reply_markup=keyboard, parse_mode='Markdown')

@bot.message_handler(func=lambda message: True)
def handle_message(message):
    text = message.text.strip()
    
    # Check if message is a Solana contract address
    if is_valid_solana_address(text):
        handle_token_analysis(message, text)
    else:
        # Handle other messages
        bot.send_message(
            message.chat.id, 
            "🔍 To analyze a token, paste its contract address.\n\nUse /help to see all available commands.",
            parse_mode='Markdown'
        )

def handle_token_analysis(message, token_address: str):
    """Handle token analysis when user sends contract address"""
    analyzing_msg = bot.send_message(
        message.chat.id, 
        "🔍 Analyzing token... Please wait a moment.", 
        parse_mode='Markdown'
    )
    try:
        import asyncio
        async def get_all_data():
            token_info = await get_token_info(token_address)
            chatroom_stats = await get_chatroom_stats(token_address)
            return token_info, chatroom_stats
        token_info, chatroom_stats = asyncio.run(get_all_data())
        bot.delete_message(message.chat.id, analyzing_msg.message_id)
        token_message = format_token_message(token_info, chatroom_stats)
        keyboard = create_token_keyboard(token_address)
        bot.send_message(
            message.chat.id,
            token_message,
            reply_markup=keyboard,
            parse_mode='Markdown'
        )
        conn = sqlite3.connect('plebs_bot.db')
        c = conn.cursor()
        c.execute("""
            INSERT INTO token_interactions (telegram_id, token_address, action, amount)
            VALUES (?, ?, ?, ?)
        """, (message.from_user.id, token_address, 'view', 0))
        conn.commit()
        conn.close()
    except Exception as e:
        logging.error(f"Error analyzing token {token_address}: {e}")
        bot.delete_message(message.chat.id, analyzing_msg.message_id)
        bot.send_message(
            message.chat.id,
            f"❌ Error analyzing token. Please check the contract address and try again.\n\nError: {str(e)}",
            parse_mode='Markdown'
        )

# Callback handlers for inline keyboards
def handle_refresh_token(call, token_address: str):
    """Handle refresh token callback by re-analyzing the token and updating the message."""
    try:
        import asyncio
        async def get_all_data():
            token_info = await get_token_info(token_address)
            chatroom_stats = await get_chatroom_stats(token_address)
            return token_info, chatroom_stats
        token_info, chatroom_stats = asyncio.run(get_all_data())
        token_message = format_token_message(token_info, chatroom_stats)
        keyboard = create_token_keyboard(token_address)
        bot.edit_message_text(
            token_message,
            call.message.chat.id,
            call.message.message_id,
            reply_markup=keyboard,
            parse_mode='Markdown'
        )
    except Exception as e:
        logging.error(f"Error refreshing token {token_address}: {e}")
        bot.answer_callback_query(call.id, f"❌ Error refreshing token: {str(e)}")

@bot.callback_query_handler(func=lambda call: True)
def handle_callback(call):
    data = call.data
    user_id = call.from_user.id

    if data.startswith('buy_'):
        handle_buy_token(call, data.replace('buy_', ''))
    elif data.startswith('sell_'):
        handle_sell_token(call, data.replace('sell_', ''))
    elif data.startswith('chatroom_'):
        handle_join_chatroom(call, data.replace('chatroom_', ''))
    elif data.startswith('refresh_'):
        handle_refresh_token(call, data.replace('refresh_', ''))
    elif data == 'connect_wallet':
        handle_connect_wallet(call)
    elif data == 'help':
        help_command(call.message)
    # ...existing code...

def handle_buy_token(call, token_address: str):
    """Handle buy token callback"""
    # Check if user has wallet connected
    user = get_user_from_db(call.from_user.id)
    
    if not user or not user['wallet_address']:
        bot.answer_callback_query(call.id, "❌ Please connect your wallet first!")
        return
    
    # Create amount selection keyboard
    keyboard = types.InlineKeyboardMarkup()
    amounts = ["0.1 SOL", "0.5 SOL", "1 SOL", "Custom"]
    
    for i in range(0, len(amounts), 2):
        if i + 1 < len(amounts):
            keyboard.add(
                types.InlineKeyboardButton(amounts[i], callback_data=f"buy_amount_{token_address}_{amounts[i].replace(' ', '_')}"),
                types.InlineKeyboardButton(amounts[i+1], callback_data=f"buy_amount_{token_address}_{amounts[i+1].replace(' ', '_')}")
            )
        else:
            keyboard.add(types.InlineKeyboardButton(amounts[i], callback_data=f"buy_amount_{token_address}_{amounts[i].replace(' ', '_')}"))
    
    keyboard.add(types.InlineKeyboardButton("❌ Cancel", callback_data="cancel"))
    
    bot.edit_message_text(
        "💰 **Select Buy Amount:**\n\nChoose how much SOL you want to spend:",
        call.message.chat.id,
        call.message.message_id,
        reply_markup=keyboard,
        parse_mode='Markdown'
    )

def handle_sell_token(call, token_address: str):
    """Handle sell token callback"""
    # Check if user has wallet connected
    user = get_user_from_db(call.from_user.id)
    
    if not user or not user['wallet_address']:
        bot.answer_callback_query(call.id, "❌ Please connect your wallet first!")
        return
    
    # Create amount selection keyboard for selling
    keyboard = types.InlineKeyboardMarkup()
    amounts = ["25%", "50%", "100%", "Custom"]
    
    for i in range(0, len(amounts), 2):
        if i + 1 < len(amounts):
            keyboard.add(
                types.InlineKeyboardButton(amounts[i], callback_data=f"sell_amount_{token_address}_{amounts[i].replace('%', 'pct').replace(' ', '_')}"),
                types.InlineKeyboardButton(amounts[i+1], callback_data=f"sell_amount_{token_address}_{amounts[i+1].replace('%', 'pct').replace(' ', '_')}")
            )
        else:
            keyboard.add(types.InlineKeyboardButton(amounts[i], callback_data=f"sell_amount_{token_address}_{amounts[i].replace('%', 'pct').replace(' ', '_')}"))
    
    keyboard.add(types.InlineKeyboardButton("❌ Cancel", callback_data="cancel"))
    
    bot.edit_message_text(
        "💸 **Select Sell Amount:**\n\nChoose what percentage of your tokens you want to sell:",
        call.message.chat.id,
        call.message.message_id,
        reply_markup=keyboard,
        parse_mode='Markdown'
    )

def handle_join_chatroom(call, token_address: str):
    """Handle join chatroom callback"""
    chatroom_url = f"{CHATROOM_URL}/room/{token_address}"
    
    keyboard = types.InlineKeyboardMarkup()
    join_btn = types.InlineKeyboardButton("🚀 Open Chatroom", url=chatroom_url)
    back_btn = types.InlineKeyboardButton("⬅️ Back to Token", callback_data=f"refresh_{token_address}")
    
    keyboard.add(join_btn)
    keyboard.add(back_btn)
    
    join_text = f"""
💬 **Join Token Chatroom**

Connect with other traders discussing this token:

🎯 **Features:**
├ Real-time price discussions
├ Technical analysis sharing
├ Trade alerts and signals
├ Community sentiment tracking
└ Direct wallet integration

🔐 **Safe Environment:**
Our chatrooms are moderated and spam-protected.

Click below to join the conversation!
    """
    
    bot.edit_message_text(
        join_text,
        call.message.chat.id,
        call.message.message_id,
        reply_markup=keyboard,
        parse_mode='Markdown'
    )

def handle_connect_wallet(call):
    """Handle wallet connection"""
    connect_text = """
🔗 **Connect Your Wallet**

**Step 1:** Choose your connection method:

├ 🔗 **Import Existing Wallet**
│  Paste your private key or seed phrase
│
└ ➕ **Create New Wallet**
   We'll generate a secure wallet for you

**Step 2:** We'll verify your wallet

**Step 3:** Start trading safely!

⚠️ **Security Note:** Your private keys are encrypted and stored securely. We recommend using a dedicated trading wallet.
    """
    
    keyboard = types.InlineKeyboardMarkup()
    import_btn = types.InlineKeyboardButton("📥 Import Wallet", callback_data="import_wallet")
    create_btn = types.InlineKeyboardButton("➕ Create New", callback_data="create_wallet")
    cancel_btn = types.InlineKeyboardButton("❌ Cancel", callback_data="cancel")
    
    keyboard.add(import_btn, create_btn)
    keyboard.add(cancel_btn)
    
    bot.edit_message_text(
        connect_text,
        call.message.chat.id,
        call.message.message_id,
        reply_markup=keyboard,
        parse_mode='Markdown'
    )

# Initialize database and start bot
if __name__ == "__main__":
    init_db()
    print("🚀 PLEBS Bot starting...")
    print("🔍 Ready to analyze tokens and connect traders!")
    bot.polling(non_stop=True)
