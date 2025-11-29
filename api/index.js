const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

// --- Configuration ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
// ክፍተት (Space) ካለ አጥርቶ የሚቀበል (Trim)
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(',').map(id => id.trim());

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

// 1. መነሻ (Start) - አድሚን ከሆነ ተጨማሪ በተን ያሳያል
bot.start(async (ctx) => {
  const firstName = ctx.from.first_name;
  const userId = String(ctx.from.id);
  const isUserAdmin = ADMIN_IDS.includes(userId);
  
  // መደበኛ በተኖች
  const buttons = [
      ['🆘 እርዳኝ (Emergency)'], 
      ['📢 Join Channel']
  ];

  // አድሚን ከሆነ ብቻ ይህ በተን ይጨመር
  if (isUserAdmin) {
      buttons.push(['🔐 Admin Panel']);
  }

  await ctx.reply(
    `ሰላም ${firstName}! እንኳን ወደ NoFap ኢትዮጵያ በሰላም መጣህ።\n\n` +
    `ስሜት ሲመጣብህ ወይም ሲጨንቅህ እታች ያለውን "🆘 እርዳኝ (Emergency)" የሚለውን በተን ተጫን።`,
    Markup.keyboard(buttons).resize()
  );
});

// 2. ተጠቃሚው "እርዳኝ" ሲል
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

// 3. ቻናል መቀላቀያ
bot.hears('📢 Join Channel', async (ctx) => {
    await ctx.reply('የቴሌግራም ቻናላችንን ይቀላቀሉ 👇\nhttps://t.me/your_channel_link');
});

// --- Admin Panel Logic ---

const isAdmin = (ctx, next) => {
  const userId = String(ctx.from.id);
  if (ADMIN_IDS.includes(userId)) {
    return next();
  } else {
    // አድሚን ካልሆነ ዝም ይበል (ወይም ማስጠንቀቂያ መስጠት ይቻላል)
  }
};

// አድሚን ሜኑን የሚያሳይ Function (Reusable)
async function showAdminMenu(ctx) {
    await ctx.reply(
        '👮‍♂️ **Admin Panel**\n\nምን ማድረግ ይፈልጋሉ?',
        Markup.inlineKeyboard([
          [Markup.button.callback('➕ ፅሁፍ ለመጨመር', 'add_content')],
          [Markup.button.callback('🗑️ ፅሁፍ ለመቀነስ', 'manage_content')],
          [Markup.button.callback('📊 ስታቲስቲክስ', 'view_stats')]
        ])
    );
}

// አድሚኑ በተኑን ሲጫን
bot.hears('🔐 Admin Panel', isAdmin, async (ctx) => {
    await showAdminMenu(ctx);
});

// አድሚኑ /admin ብሎ ሲጽፍ
bot.command('admin', isAdmin, async (ctx) => {
    await showAdminMenu(ctx);
});

// Add Content Logic
bot.action('add_content', isAdmin, async (ctx) => {
  await ctx.reply(
    'እሺ፣ የምትፈልገውን አነቃቂ ፅሁፍ ወይም ምክር ፅፈህ ላክልኝ።\n(Reply to this message)', 
    { reply_markup: { force_reply: true } }
  );
  await ctx.answerCbQuery();
});

// Text Handler for adding content
bot.on('text', async (ctx) => {
  // በተኖችን እንዳይቀበል
  if (['🆘 እርዳኝ (Emergency)', '📢 Join Channel', '🔐 Admin Panel'].includes(ctx.message.text)) return;

  if (ctx.message.reply_to_message && 
      ctx.message.reply_to_message.text.includes('የምትፈልገውን አነቃቂ ፅሁፍ')) {
    
    if (!ADMIN_IDS.includes(String(ctx.from.id))) return;

    try {
      await connectToDatabase();
      await Motivation.create({ text: ctx.message.text });
      await ctx.reply('✅ ፅሁፉ በስኬት ተመዝግቧል!');
    } catch (err) {
      console.error(err);
      await ctx.reply('❌ ችግር አጋጥሟል።');
    }
  }
});

// Delete Logic
bot.action('manage_content', isAdmin, async (ctx) => {
    await connectToDatabase();
    const items = await Motivation.find().sort({ addedAt: -1 }).limit(5);
    
    if (items.length === 0) {
        await ctx.reply('ምንም የተመዘገበ ፅሁፍ የለም።');
        return ctx.answerCbQuery();
    }

    await ctx.reply('👇 ለመቀነስ/ለማጥፋት የሚፈልጉትን ይምረጡ (የቅርብ 5ቱ):');

    for (const item of items) {
        const preview = item.text.length > 50 ? item.text.substring(0, 50) + '...' : item.text;
        
        await ctx.reply(
            `📝 ${preview}`,
            Markup.inlineKeyboard([
                [Markup.button.callback('❌ አጥፋው (Delete)', `delete_${item._id}`)]
            ])
        );
    }
    await ctx.answerCbQuery();
});

// Delete Action
bot.action(/^delete_(.+)$/, isAdmin, async (ctx) => {
    const id = ctx.match[1];
    await connectToDatabase();
    
    try {
        await Motivation.findByIdAndDelete(id);
        await ctx.reply('🗑️ ፅሁፉ በተሳካ ሁኔታ ጠፍቷል።');
    } catch (e) {
        console.error(e);
        await ctx.reply('❌ ማጥፋት አልተቻለም።');
    }
    await ctx.answerCbQuery();
});

// Stats Logic
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
