import os
import telebot
from telebot import types
from flask import Flask, request

# ከ Vercel Environment Variables ላይ ቶከኑን ያግያል
# ወይም ለሙከራ ከታች ያለውን 'YOUR_TOKEN_HERE' በሚለው መቀየር ትችላለህ
TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', 'YOUR_BOT_TOKEN_HERE')

bot = telebot.TeleBot(TOKEN)
app = Flask(__name__)

# --- ዋናው ኪቦርድ (Main Menu) ---
def main_menu_keyboard():
    markup = types.ReplyKeyboardMarkup(row_width=2, resize_keyboard=True)
    
    # ቁልፎቹን እንፍጠር (ልክ በ screenshot ላይ እንዳለው ዲዛይን)
    btn_sos = types.KeyboardButton("🆘 እርዳኝ (SOS)")
    btn_tips = types.KeyboardButton("🧠 ምክር/ዘዴዎች")
    btn_stories = types.KeyboardButton("💪 የለውጥ ታሪኮች")
    btn_resources = types.KeyboardButton("📚 መርጃዎች")
    btn_ask = types.KeyboardButton("❓ ጥያቄ ለመጠየቅ")
    btn_about = types.KeyboardButton("ℹ️ ስለ ቦቱ")
    
    # ወደ ኪቦርዱ እንጨምራቸው (በሁለት መስመር)
    markup.add(btn_sos, btn_tips, btn_stories, btn_resources, btn_ask, btn_about)
    return markup

# --- Start ትእዛዝ ሲመጣ ---
@bot.message_handler(commands=['start'])
def send_welcome(message):
    welcome_text = (
        f"ሰላም {message.from_user.first_name}! 👋\n\n"
        "ወደ ነጻነት ጉዞ እንኳን በደህና መጡ። "
        "ይህ ቦት ከፖርኖግራፊ ሱስ ለመውጣት በሚያደርጉት ጉዞ አጋዥ እንዲሆን ታስቦ የተዘጋጀ ነው።\n\n"
        "ከታች ካሉት አማራጮች ይምረጡ 👇"
    )
    bot.send_message(message.chat.id, welcome_text, reply_markup=main_menu_keyboard())

# --- የቁልፍ ምላሾች (Button Responses) ---

# 1. እርዳኝ (SOS)
@bot.message_handler(func=lambda message: message.text == "🆘 እርዳኝ (SOS)")
def sos_response(message):
    sos_text = (
        "🚨 **ረጋ በል!** ስሜቱ ጊዜያዊ ነው።\n\n"
        "1. ስልክህን አሁን አስቀምጥና ከክፍሉ ውጣ።\n"
        "2. ቀዝቃዛ ውሃ ፊትህን ታጠብ።\n"
        "3. ለጓደኛህ ወይም ለቤተሰብ ደውል አውራ።\n"
        "4. 10 ጊዜ በጥልቀት ተንፍስ።\n\n"
        "ይህን ስሜት ማሸነፍ ትችላለህ! 💪"
    )
    bot.send_message(message.chat.id, sos_text, parse_mode='Markdown')

# 2. ምክር እና ዘዴዎች
@bot.message_handler(func=lambda message: message.text == "🧠 ምክር/ዘዴዎች")
def tips_response(message):
    tips_text = (
        "✅ **ሱስን ለማሸነፍ የሚረዱ ዘዴዎች፡**\n\n"
        "1. **ቀስቃሽ ነገሮችን አስወግድ:** እንደ TikTok, Instagram ወይም Telegram ቻናሎችን አጽዳ።\n"
        "2. **ጊዜህን ሙላ:** ስፖርት ስራ፣ መጽሐፍ አንብብ።\n"
        "3. **ብቻህን አትሁን:** በር ክፍት አድርገህ ተቀመጥ።"
    )
    bot.send_message(message.chat.id, tips_text)

# 3. የለውጥ ታሪኮች
@bot.message_handler(func=lambda message: message.text == "💪 የለውጥ ታሪኮች")
def stories_response(message):
    # እዚህ ወደፊት ከ Database ወይም ቻናል ማምጣት ይቻላል
    story_text = (
        "አንድ ወጣት እንዲህ ይላል፡\n"
        "'ለ5 ዓመታት በዚህ ሱስ ተይዤ ነበር። ነገር ግን ስልኬን ማታ ወደ መኝታ አለማስገባት ስጀምርና "
        "ለጓደኛዬ ችግሬን ነግሬ እርዳታ ስጠይቅ ቀስ በቀስ ነጻ ወጣሁ።'"
    )
    bot.send_message(message.chat.id, story_text)

# 4. መርጃዎች
@bot.message_handler(func=lambda message: message.text == "📚 መርጃዎች")
def resources_response(message):
    bot.send_message(message.chat.id, "በቅርቡ እዚህ ጋር ጠቃሚ መጽሐፍት እና የድምጽ ፋይሎች ይጫናሉ!")

# 5. ጥያቄ
@bot.message_handler(func=lambda message: message.text == "❓ ጥያቄ ለመጠየቅ")
def ask_response(message):
    bot.send_message(message.chat.id, "ጥያቄ ካለዎት በዚህ አድራሻ ያናግሩን፡ @YourAdminUsername")

# 6. ስለ ቦቱ
@bot.message_handler(func=lambda message: message.text == "ℹ️ ስለ ቦቱ")
def about_response(message):
    bot.send_message(message.chat.id, "ይህ ቦት የተሰራው ወጣቶችን ለመርዳት በጎ ፈቃደኞች ነው።")

# --- Webhook Route for Vercel ---
@app.route('/' + TOKEN, methods=['POST'])
def getMessage():
    json_string = request.get_data().decode('utf-8')
    update = telebot.types.Update.de_json(json_string)
    bot.process_new_updates([update])
    return "!", 200

@app.route("/")
def webhook():
    bot.remove_webhook()
    # Vercel ላይ ያለውን የፕሮጀክትህን URL እዚህ ታስገባለህ
    # ለምሳሌ: https://your-project-name.vercel.app
    # ይህ በራስ ሰራድ (Automatic) እንዲሆን ከተፈለገ ሌላ ዘዴ መጠቀም ይቻላል፣
    # ግን ለቀላልነት እዚህ ጋር URLህን ማስገባት ወይም Browser ላይ Set Webhook ማድረግ ይቻላል።
    return "Bot is running!", 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get('PORT', 5000)))
