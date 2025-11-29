const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

// --- Configuration ---
// እነዚህን ቁልፎች Vercel Environment Variables ላይ ታስገባለህ
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
// የአድሚኖች ID እዚህ ጋር በኮማ እየለየህ አስገባ (ለምሳሌ: "123456,987654")
// የራስህን ID ለማወቅ በቴሌግራም @userinfobot ተጠቀም
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(',');

if (!BOT_TOKEN) throw new Error('BOT_TOKEN is missing!');
if (!MONGODB_URI) throw new Error('MONGODB_URI is missing!');

// --- Database Setup (MongoDB) ---
// የተጠቃሚዎችን Urge ለማረጋጋት የምንጭናቸው ፅሁፎች መያዣ
const contentSchema = new mongoose.Schema({
  text: { type: String, required: true },
  addedAt: { type: Date, default: Date.now }
});

// "Motivation" የሚባል collection ይፈጥራል
const Motivation = mongoose.models.Motivation || mongoose.model('Motivation', contentSchema);

// ዳታቤዝ ጋር መገናኘት (Cached connection for serverless)
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

// 1. መነሻ (Start) - ለተጠቃሚዎች
bot.start(async (ctx) => {
  const firstName = ctx.from.first_name;
  
  await ctx.reply(
    `ሰላም ${firstName}! እንኳን ወደ NoFap ኢትዮጵያ በሰላም መጣህ።\n\n` +
    `ስሜት ሲመጣብህ ወይም ሲጨንቅህ እታች ያለውን "🆘 እርዳኝ (Emergency)" የሚለውን በተን ተጫን።`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🆘 እርዳኝ (Emergency)', 'get_urge_help')],
      [Markup.button.url('Join Channel', 'https://t.me/your_channel_link')] // ግሩፕህን እዚህ አስገባ
    ])
  );
});

// 2. ተጠቃሚው "እርዳኝ" ሲል (User Action)
bot.action('get_urge_help', async (ctx) => {
  await connectToDatabase();
  
  // ከዳታቤዝ አንድ በዘፈቀደ (Random) ፅሁፍ ማውጣት
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
  // Loading እንዳይሆን እናቆመዋለን
  await ctx.answerCbQuery();
});

// --- Admin Panel Logic ---

// አድሚን መሆኑን ማረጋገጫ (Middleware)
const isAdmin = (ctx, next) => {
  const userId = String(ctx.from.id);
  if (ADMIN_IDS.includes(userId)) {
    return next();
  }
  // አድሚን ካልሆነ ዝም ይበለው ወይም ሌላ መልስ ይስጠው
};

// 3. የአድሚን ዋና ሜኑ (/admin)
bot.command('admin', isAdmin, async (ctx) => {
  await ctx.reply(
    '👮‍♂️ **Admin Panel**\n\nምን ማድረግ ይፈልጋሉ?',
    Markup.inlineKeyboard([
      [Markup.button.callback('➕ ፅሁፍ ለመጨመር', 'add_content')],
      [Markup.button.callback('📊 ስታቲስቲክስ', 'view_stats')]
    ])
  );
});

// 4. ፅሁፍ ለመጨመር (Add Content)
bot.action('add_content', isAdmin, async (ctx) => {
  // ForceReply እንጠቀማለን - አድሚኑ ለዚህ መልእክት Reply እንዲያደርግ
  await ctx.reply(
    'እሺ፣ የምትፈልገውን አነቃቂ ፅሁፍ ወይም ምክር ፅፈህ ላክልኝ።\n(Reply to this message)', 
    { 
      reply_markup: { force_reply: true } 
    }
  );
  await ctx.answerCbQuery();
});

// 5. አድሚኑ የላከውን ፅሁፍ ተቀብሎ መመዝገብ
bot.on('text', async (ctx) => {
  // መልእክቱ Reply ከሆነ እና Reply የተደረገው መልእክት ከላይ ያለው ጥያቄ ከሆነ
  if (ctx.message.reply_to_message && 
      ctx.message.reply_to_message.text.includes('የምትፈልገውን አነቃቂ ፅሁፍ')) {
    
    // አድሚን መሆኑን ድጋሚ ማረጋገጥ (Security)
    if (!ADMIN_IDS.includes(String(ctx.from.id))) return;

    const newText = ctx.message.text;
    
    try {
      await connectToDatabase();
      await Motivation.create({ text: newText });
      await ctx.reply('✅ ፅሁፉ በስኬት ተመዝግቧል! ተጠቃሚዎች አሁን ሊያገኙት ይችላሉ።');
    } catch (err) {
      console.error(err);
      await ctx.reply('❌ ችግር አጋጥሟል። እባክዎ እንደገና ይሞክሩ።');
    }
  }
});

// 6. ስታቲስቲክስ ማየት
bot.action('view_stats', isAdmin, async (ctx) => {
  await connectToDatabase();
  const count = await Motivation.countDocuments();
  await ctx.reply(`📊 በአጠቃላይ **${count}** አነቃቂ ፅሁፎች ዳታቤዝ ውስጥ አሉ።`, { parse_mode: 'Markdown' });
  await ctx.answerCbQuery();
});


// --- Server Handling for Vercel ---
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
