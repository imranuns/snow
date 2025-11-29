const { Telegraf, Markup, session } = require('telegraf');
const mongoose = require('mongoose');

// --- Configuration ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(',').map(id => id.trim());

if (!BOT_TOKEN) throw new Error('BOT_TOKEN is missing!');
if (!MONGODB_URI) throw new Error('MONGODB_URI is missing!');

// --- Database Schemas ---

// 1. መቼቶች (Settings) - Welcome msg, Button names
const configSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true }, // e.g., 'welcome_msg', 'urge_btn_label'
  value: { type: String, required: true }
});
const Config = mongoose.models.Config || mongoose.model('Config', configSchema);

// 2. ቻናሎች (Channels)
const channelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  link: { type: String, required: true }
});
const Channel = mongoose.models.Channel || mongoose.model('Channel', channelSchema);

// 3. የራስህ በተኖች (Custom Buttons)
const customButtonSchema = new mongoose.Schema({
  label: { type: String, required: true, unique: true }, // Button Name
  type: { type: String, enum: ['text', 'photo', 'video'], default: 'text' },
  content: { type: String, required: true }, // Text content or File ID
  caption: { type: String } // For media
});
const CustomButton = mongoose.models.CustomButton || mongoose.model('CustomButton', customButtonSchema);

// 4. Random Motivation (ለ Emergency)
const motivationSchema = new mongoose.Schema({
  text: { type: String, required: true },
  addedAt: { type: Date, default: Date.now }
});
const Motivation = mongoose.models.Motivation || mongoose.model('Motivation', motivationSchema);

// --- DB Connection ---
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

// --- Helper Functions ---
async function getConfig(key, defaultValue) {
    const doc = await Config.findOne({ key });
    return doc ? doc.value : defaultValue;
}

async function setConfig(key, value) {
    await Config.findOneAndUpdate({ key }, { value }, { upsert: true, new: true });
}

// --- Bot Setup ---
const bot = new Telegraf(BOT_TOKEN);
bot.use(session()); // To store temporary admin states

// Middleware to check Admin
const isAdmin = (ctx, next) => {
  const userId = String(ctx.from.id);
  if (ADMIN_IDS.includes(userId)) return next();
};

// 1. START Handler
bot.start(async (ctx) => {
  await connectToDatabase();
  const userId = String(ctx.from.id);
  const isUserAdmin = ADMIN_IDS.includes(userId);

  // Load Configs
  const welcomeMsg = await getConfig('welcome_msg', `ሰላም ${ctx.from.first_name}! እንኳን በሰላም መጣህ።`);
  const urgeLabel = await getConfig('urge_btn_label', '🆘 እርዳኝ (Emergency)');
  const channelLabel = await getConfig('channel_btn_label', '📢 ቻናሎች (Channels)');

  // Load Custom Buttons
  const customBtns = await CustomButton.find({});
  
  // Build Keyboard
  let keyboard = [];
  keyboard.push([urgeLabel, channelLabel]); // መደበኛዎቹን በአንድ መስመር
  
  // Custom Buttons መጨመር (2 per row)
  let tempRow = [];
  customBtns.forEach((btn, index) => {
      tempRow.push(btn.label);
      if (tempRow.length === 2 || index === customBtns.length - 1) {
          keyboard.push(tempRow);
          tempRow = [];
      }
  });

  if (isUserAdmin) keyboard.push(['🔐 Admin Panel']);

  await ctx.reply(welcomeMsg, Markup.keyboard(keyboard).resize());
});

// --- MAIN TEXT HANDLER (Handle All Button Clicks) ---
bot.on('text', async (ctx, next) => {
    // If inside an admin wizard flow, skip this handler
    if (ctx.session && ctx.session.step) return next();

    const text = ctx.message.text;
    await connectToDatabase();

    // 1. Check if Admin Panel
    if (text === '🔐 Admin Panel' && ADMIN_IDS.includes(String(ctx.from.id))) {
        return showAdminMenu(ctx);
    }

    // 2. Check Emergency Button
    const urgeLabel = await getConfig('urge_btn_label', '🆘 እርዳኝ (Emergency)');
    if (text === urgeLabel) {
        const count = await Motivation.countDocuments();
        if (count === 0) return ctx.reply('ለጊዜው መልእክት የለም።');
        const random = Math.floor(Math.random() * count);
        const m = await Motivation.findOne().skip(random);
        return ctx.reply(m.text, { parse_mode: 'Markdown' });
    }

    // 3. Check Channel Button
    const channelLabel = await getConfig('channel_btn_label', '📢 ቻናሎች (Channels)');
    if (text === channelLabel) {
        const channels = await Channel.find({});
        if (channels.length === 0) return ctx.reply('ለጊዜው የተመዘገበ ቻናል የለም።');
        
        // Inline buttons for channels
        const channelBtns = channels.map(c => [Markup.button.url(c.name, c.link)]);
        return ctx.reply('የሚከተሉትን ቻናሎች ይቀላቀሉ:', Markup.inlineKeyboard(channelBtns));
    }

    // 4. Check Custom Buttons
    const customBtn = await CustomButton.findOne({ label: text });
    if (customBtn) {
        if (customBtn.type === 'photo') {
            return ctx.replyWithPhoto(customBtn.content, { caption: customBtn.caption });
        } else if (customBtn.type === 'video') {
            return ctx.replyWithVideo(customBtn.content, { caption: customBtn.caption });
        } else {
            return ctx.reply(customBtn.content);
        }
    }

    // If nothing matches, continue (maybe admin reply flow)
    return next();
});

// --- ADMIN PANEL LOGIC ---

async function showAdminMenu(ctx) {
    await ctx.reply(
        '⚙️ **Admin Dashboard**',
        Markup.inlineKeyboard([
            [Markup.button.callback('📝 Start Message ቀይር', 'set_welcome')],
            [Markup.button.callback('🏷️ በተን ስም ቀይር', 'rename_buttons')],
            [Markup.button.callback('📢 ቻናሎች (Channels)', 'manage_channels')],
            [Markup.button.callback('🔘 Custom Buttons', 'manage_custom_btns')],
            [Markup.button.callback('💪 Motivation Texts', 'manage_motivation')]
        ])
    );
}

// 1. Set Welcome Message
bot.action('set_welcome', isAdmin, async (ctx) => {
    ctx.session = { step: 'awaiting_welcome_msg' };
    await ctx.reply('አዲሱን የ "Start" መልእክት ፅፈህ ላክ:\n(Cancel ለማድረግ /cancel በል)');
    await ctx.answerCbQuery();
});

// 2. Rename Standard Buttons
bot.action('rename_buttons', isAdmin, async (ctx) => {
    await ctx.reply('የቱን በተን ስም መቀየር ትፈልጋለህ?', Markup.inlineKeyboard([
        [Markup.button.callback('🆘 Emergency Button', 'rename_urge')],
        [Markup.button.callback('📢 Channel Button', 'rename_channel')]
    ]));
    await ctx.answerCbQuery();
});
bot.action('rename_urge', isAdmin, async (ctx) => {
    ctx.session = { step: 'awaiting_urge_label' };
    await ctx.reply('የ "Emergency" በተን ምን እንዲባል ትፈልጋለህ? ፅፈህ ላክ:');
    await ctx.answerCbQuery();
});
bot.action('rename_channel', isAdmin, async (ctx) => {
    ctx.session = { step: 'awaiting_channel_label' };
    await ctx.reply('የ "Channel" በተን ምን እንዲባል ትፈልጋለህ? ፅፈህ ላክ:');
    await ctx.answerCbQuery();
});

// 3. Manage Channels
bot.action('manage_channels', isAdmin, async (ctx) => {
    await connectToDatabase();
    const channels = await Channel.find({});
    let buttons = [[Markup.button.callback('➕ ቻናል ጨምር', 'add_channel')]];
    
    channels.forEach(c => {
        buttons.push([Markup.button.callback(`🗑️ Delete ${c.name}`, `del_chan_${c._id}`)]);
    });
    
    await ctx.reply('የቻናሎች ዝርዝር (ለመቀነስ ይጫኑ):', Markup.inlineKeyboard(buttons));
    await ctx.answerCbQuery();
});
bot.action('add_channel', isAdmin, async (ctx) => {
    ctx.session = { step: 'awaiting_channel_name' };
    await ctx.reply('የቻናሉን ስም ፃፍ (Example: NoFap Ethio):');
    await ctx.answerCbQuery();
});
bot.action(/^del_chan_(.+)$/, isAdmin, async (ctx) => {
    await connectToDatabase();
    await Channel.findByIdAndDelete(ctx.match[1]);
    await ctx.reply('ቻናሉ ጠፍቷል።');
    await ctx.answerCbQuery();
});

// 4. Manage Custom Buttons
bot.action('manage_custom_btns', isAdmin, async (ctx) => {
    await connectToDatabase();
    const btns = await CustomButton.find({});
    let buttons = [[Markup.button.callback('➕ አዲስ በተን ፍጠር', 'add_custom_btn')]];
    
    btns.forEach(b => {
        buttons.push([Markup.button.callback(`🗑️ Delete ${b.label}`, `del_btn_${b._id}`)]);
    });
    
    await ctx.reply('የፈጠርካቸው በተኖች (ለመቀነስ ይጫኑ):', Markup.inlineKeyboard(buttons));
    await ctx.answerCbQuery();
});
bot.action('add_custom_btn', isAdmin, async (ctx) => {
    ctx.session = { step: 'awaiting_btn_label' };
    await ctx.reply('የአዲሱ በተን ስም (Label) ምን ይሁን?');
    await ctx.answerCbQuery();
});
bot.action(/^del_btn_(.+)$/, isAdmin, async (ctx) => {
    await connectToDatabase();
    await CustomButton.findByIdAndDelete(ctx.match[1]);
    await ctx.reply('በተኑ ተሰርዟል። ለውጡን ለማየት /start ይበሉ።');
    await ctx.answerCbQuery();
});

// 5. Manage Motivation (Existing logic simplified)
bot.action('manage_motivation', isAdmin, async (ctx) => {
    ctx.session = { step: 'awaiting_motivation' };
    await ctx.reply('ለ Emergency የሚሆነውን አነቃቂ ፅሁፍ ፅፈህ ላክ:');
    await ctx.answerCbQuery();
});


// --- INPUT HANDLER (Wizard Logic) ---
bot.on(['text', 'photo', 'video'], async (ctx) => {
    if (!ctx.session || !ctx.session.step) return; // If not in admin flow, ignore (handled by main handler)
    if (ctx.message.text === '/cancel') {
        ctx.session = null;
        return ctx.reply('Cancelled.');
    }

    const step = ctx.session.step;
    await connectToDatabase();

    // Handle Settings
    if (step === 'awaiting_welcome_msg') {
        await setConfig('welcome_msg', ctx.message.text);
        await ctx.reply('✅ Welcome Message ተቀይሯል! /start ብለው ያረጋግጡ።');
        ctx.session = null;
    } 
    else if (step === 'awaiting_urge_label') {
        await setConfig('urge_btn_label', ctx.message.text);
        await ctx.reply('✅ Emergency በተን ስም ተቀይሯል! /start ብለው ያረጋግጡ።');
        ctx.session = null;
    }
    else if (step === 'awaiting_channel_label') {
        await setConfig('channel_btn_label', ctx.message.text);
        await ctx.reply('✅ Channel በተን ስም ተቀይሯል! /start ብለው ያረጋግጡ።');
        ctx.session = null;
    }

    // Handle Channels
    else if (step === 'awaiting_channel_name') {
        ctx.session.temp_channel_name = ctx.message.text;
        ctx.session.step = 'awaiting_channel_link';
        await ctx.reply('አሁን የቻናሉን ሊንክ ላክ (https://t.me/...):');
    }
    else if (step === 'awaiting_channel_link') {
        await Channel.create({ name: ctx.session.temp_channel_name, link: ctx.message.text });
        await ctx.reply('✅ ቻናሉ ተጨምሯል!');
        ctx.session = null;
    }

    // Handle Custom Buttons
    else if (step === 'awaiting_btn_label') {
        ctx.session.temp_btn_label = ctx.message.text;
        ctx.session.step = 'awaiting_btn_content';
        await ctx.reply('በተኑ ሲነካ ምን ይምጣ? ፅሁፍ፣ ፎቶ ወይም ቪዲዮ አሁን ላክ:');
    }
    else if (step === 'awaiting_btn_content') {
        const label = ctx.session.temp_btn_label;
        let type = 'text';
        let content = '';
        let caption = ctx.message.caption || '';

        if (ctx.message.photo) {
            type = 'photo';
            content = ctx.message.photo[ctx.message.photo.length - 1].file_id; // Get highest quality
        } else if (ctx.message.video) {
            type = 'video';
            content = ctx.message.video.file_id;
        } else if (ctx.message.text) {
            content = ctx.message.text;
        } else {
            return ctx.reply('Please send Text, Photo, or Video.');
        }

        await CustomButton.create({ label, type, content, caption });
        await ctx.reply(`✅ "${label}" የሚል በተን ተፈጥሯል! /start ብለው ያዩት።`);
        ctx.session = null;
    }

    // Handle Motivation
    else if (step === 'awaiting_motivation' && ctx.message.text) {
        await Motivation.create({ text: ctx.message.text });
        await ctx.reply('✅ አነቃቂ ፅሁፍ ተጨምሯል።');
        ctx.session = null;
    }
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
