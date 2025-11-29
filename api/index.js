const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

// --- Configuration ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(',');

if (!BOT_TOKEN) throw new Error('BOT_TOKEN is missing!');
if (!MONGODB_URI) throw new Error('MONGODB_URI is missing!');

// --- Database Setup ---
const contentSchema = new mongoose.Schema({
  text: { type: String, required: true },
  addedAt: { type: Date, default: Date.now }
});

const Motivation = mongoose.models.Motivation || mongoose.model('Motivation', contentSchema);

let isConnected = false;
async function connectToDatabase() {
  if (isConnected) return;
  try {
    await mongoose.connect(MONGODB_URI);
    isConnected = true;
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
}

// --- Bot Setup ---
const bot = new Telegraf(BOT_TOKEN);

// 1. መነሻ (Start) - Keyboard Button ይዞ ይመጣል
bot.start(async (ctx) => {
  const firstName = ctx.from.first_name;
  
  await ctx.reply(
    `ሰላም ${firstName}! እንኳን ወደ NoFap ኢትዮጵያ በሰላም መጣህ።\n\n` +
    `ስሜት ሲመጣብህ ወይም ሲጨንቅህ እታች ያለውን "🆘 እርዳኝ (Emergency)" የሚለውን በተን ተጫን።`,
    // እዚህ ጋር ነው ልዩነቱ - Keyboard Button አደረግነው
    Markup.keyboard([
      ['🆘 እርዳኝ (Emergency)'], 
      ['📢 Join Channel']
    ]).resize() // resize() በተኑን መጠነኛ ያደርገዋል
  );
});

// 2. ተጠቃሚው "እርዳኝ" የሚለውን Keyboard ሲጫን (Hears)
// Keyboard Button እንደ ፅሁፍ (Text) ነው የሚላከው፣ ስለዚህ 'action' ሳይሆን 'hears' እንጠቀማለን
bot.hears('🆘 እርዳኝ (Emergency)', async (ctx) => {
  await connectToDatabase();
  
  const count = await Motivation.countDocuments();
  
  if (count === 0) {
    return ctx.reply('ለጊዜው ምንም የተጫነ መልእክት የለም። እባክዎ ቆይተው ይሞክሩ።');
  }

  const random = Math.floor(Math.random() * count);
  const motivation = await Motivation.findOne().skip(random);

  if (motivation) {
    await ctx.reply(
        `💪 **በርታ ወዳጄ!**\n\n${motivation.text}\n\n` +
        `~ NoFap Team`,
        { parse_mode: 'Markdown' }
    );
  }
});

// 3. ቻናል መቀላቀያ በተን ሲጫን
bot.hears('📢 Join Channel', async (ctx) => {
    // እዚህ ጋር የቻናልህን ሊንክ አስገባ
    await ctx.reply('የቴሌግራም ቻናላችንን ይቀላቀሉ 👇\nhttps://t.me/your_channel_link');
});

// --- Admin Panel Logic ---
// አድሚን ፓነል በ Inline Button ቢሆን ይሻላል (ለአጠቃቀም እንዲያምር እና ከዋናው ሜኑ ጋር እንዳይቀላቀል)

const isAdmin = (ctx, next) => {
  const userId = String(ctx.from.id);
  if (ADMIN_IDS.includes(userId)) {
    return next();
  }
};

bot.command('admin', isAdmin, async (ctx) => {
  await ctx.reply(
    '👮‍♂️ **Admin Panel**\n\nምን ማድረግ ይፈልጋሉ?',
    Markup.inlineKeyboard([
      [Markup.button.callback('➕ ፅሁፍ ለመጨመር', 'add_content')],
      [Markup.button.callback('📊 ስታቲስቲክስ', 'view_stats')]
    ])
  );
});

bot.action('add_content', isAdmin, async (ctx) => {
  await ctx.reply(
    'እሺ፣ የምትፈልገውን አነቃቂ ፅሁፍ ወይም ምክር ፅፈህ ላክልኝ።\n(Reply to this message)', 
    { reply_markup: { force_reply: true } }
  );
  await ctx.answerCbQuery();
});

bot.on('text', async (ctx) => {
  // ለመደበኛ "Keyboard" መልእክቶች ምላሽ እንዳይሰጥ እንከላከላለን
  if (ctx.message.text === '🆘 እርዳኝ (Emergency)' || ctx.message.text === '📢 Join Channel') return;

  // የአድሚን Reply Logic
  if (ctx.message.reply_to_message && 
      ctx.message.reply_to_message.text.includes('የምትፈልገውን አነቃቂ ፅሁፍ')) {
    
    if (!ADMIN_IDS.includes(String(ctx.from.id))) return;

    const newText = ctx.message.text;
    
    try {
      await connectToDatabase();
      await Motivation.create({ text: newText });
      await ctx.reply('✅ ፅሁፉ በስኬት ተመዝግቧል! አሁን "እርዳኝ" ሲጫን ሊወጣ ይችላል።');
    } catch (err) {
      console.error(err);
      await ctx.reply('❌ ችግር አጋጥሟል።');
    }
  }
});

bot.action('view_stats', isAdmin, async (ctx) => {
  await connectToDatabase();
  const count = await Motivation.countDocuments();
  await ctx.reply(`📊 በአጠቃላይ **${count}** አነቃቂ ፅሁፎች አሉ።`, { parse_mode: 'Markdown' });
  await ctx.answerCbQuery();
});

// --- Server Handling ---
module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            await bot.handleUpdate(req.body);
            res.status(200).json({ message: 'OK' });
        } else {
            res.status(200).json({ message: 'Bot is active' });
        }
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
