# bot.py - Start simple!
import telebot

bot = telebot.TeleBot('YOUR_BOT_TOKEN')

@bot.message_handler(commands=['start'])
def start_message(message):
    bot.send_message(message.chat.id, "Hello from your chat room bot!")

@bot.message_handler(func=lambda message: True)
def echo_message(message):
    # Later: send this to your web app
    print(f"Got message: {message.text}")
    bot.reply_to(message, f"Web chat received: {message.text}")

bot.polling()