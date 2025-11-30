const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

// ============================================================
// 1. CONFIGURATION & SETUP (ማስተካከያዎች)
// ============================================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
// Admin IDs: ክፍተት (Space) ካለ እናጠዳለን፣ በኮማ እንለያለን
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(',').map(id => id.trim());

if (!BOT_TOKEN) throw new Error('BOT_TOKEN is missing!');
if (!MONGODB_URI) throw new Error('MONGODB_URI is missing!');

// ============================================================
// 2. DATABASE SCHEMAS (የመረጃ አቀማመጥ)
// ============================================================

// A. Anti-Duplicate System (ለ 1 ሰዓት የመልእክት ID ይይዛል)
// ግሩፕ ላይ ቦቱ እንዳይደጋግም የሚከላከለው ዋናው ሞተር ይሄ ነው።
const processedUpdateSchema = new mongoose.Schema({
  update_id: { type: Number, required: true, unique: true },
  createdAt: { type: Date, default: Date.now, expires: 3600 } // 1 Hour TTL
});
const ProcessedUpdate = mongoose.models.ProcessedUpdate || mongoose.model('ProcessedUpdate', processedUpdateSchema);

// B. Configs (የቦቱ መቼቶች - Start Msg, Layout...)
const configSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
});
const Config = mongoose.models.Config || mongoose.model('Config', configSchema);

// C. User & Admin Session (ተጠቃሚዎች እና የአድሚን ማስታወሻ)
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  firstName: String,
  // Streak Info
  streakStart: { type: Date, default: Date.now },
  bestStreak: { type: Number, default: 0 },
  relapseHistory: [{ date: { type: Date, default: Date.now }, reason: String }],
  lastActive: { type: Date, default: Date.now },
  // Admin Session (Vercel ቢዘጋም እዚህ እናስታውሳለን - Advanced Logic)
  adminState: { 
      step: { type: String, default: null }, // e.g. 'awaiting_welcome'
      tempData: { type: mongoose.Schema.Types.Mixed, default: {} }
  }
});
const User = mongoose.models.User || mongoose.model('User', userSchema);

// D. Channels (የሚተዋወቁ ቻናሎች)
const channelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  link: { type: String, required: true }
});
const Channel = mongoose.models.Channel || mongoose.model('Channel', channelSchema);

// E. Custom Buttons (Voice, Video, Text, Photo)
const customButtonSchema = new mongoose.Schema({
  label: { type: String, required: true, unique: true },
  type: { type: String, enum: ['text', 'photo', 'video', 'voice'], default: 'text' },
  content: { type: String, required: true }, // File ID or Text
  caption: { type: String }
});
const CustomButton = mongoose.models.CustomButton || mongoose.model('CustomButton', customButtonSchema);

// F. Motivation (አነቃቂ ፅሁፎች)
const motivationSchema = new mongoose.Schema({
  text: { type: String, required: true },
  addedAt: { type: Date, default: Date.now }
});
const Motivation = mongoose.models.Motivation || mongoose.model('Motivation', motivationSchema);

// ============================================================
// 3. OPTIMIZED DB CONNECTION (GLOBAL CACHE)
// ============================================================
// Vercel ላይ ፍጥነት ለመጨመር ይህ ዘዴ ወሳኝ ነው።
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) return cachedDb;

  try {
    const opts = { 
        bufferCommands: false, 
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000 
    };
    cachedDb = await mongoose.connect(MONGODB_URI, opts);
    console.log("🔥 New DB Connection Established");
    return cachedDb;
  } catch (error) {
    console.error("❌ DB Connection Error:", error);
    throw error;
  }
}

// ============================================================
// 4. HELPER FUNCTIONS (ረዳት ኮዶች)
// ============================================================

// የአድሚንን ስቴፕ መዝጋቢ (Advanced Session Management)
async function setAdminStep(userId, step, data = {}) {
    await User.findOneAndUpdate(
        { userId }, 
        { adminState: { step, tempData: data } }, 
        { upsert: true }
    );
}

async function getAdminState(userId) {
    const user = await User.findOne({ userId });
    return user ? user.adminState : { step: null, tempData: {} };
}

async function clearAdminStep(userId) {
    await User.findOneAndUpdate({ userId }, { adminState: { step: null, tempData: {} } });
}

async function getConfig(key, defaultValue) {
    const doc = await Config.findOne({ key });
    return doc ? doc.value : defaultValue;
}

// ============================================================
// 5. BOT LOGIC INITIALIZATION
// ============================================================
const bot = new Telegraf(BOT_TOKEN);

// --- A. START COMMAND ---
bot.start(async (ctx) => {
  // ግሩፕ ውስጥ ከሆነ እና በግል ካልተጠራ (Mention) ዝም ይበል (ግሩፕን ላለማጨናነቅ)
  if (ctx.chat.type !== 'private' && !ctx.message.text.includes(ctx.botInfo.username)) {
      // ግን "Start" ከተባለ በግልም በግሩፕም መመለስ አለበት
      // So we allow basic start logic
  }

  try {
    const userId = String(ctx.from.id);
    const firstName = ctx.from.first_name || 'Friend';
    
    // User Update
    await User.findOneAndUpdate(
        { userId }, 
        { firstName, lastActive: new Date() }, 
        { upsert: true }
    );
    
    // Admin Cleanup
    if (ADMIN_IDS.includes(userId)) await clearAdminStep(userId);

    // Fetch Configs
    const urgeLabel = await getConfig('urge_btn_label', '🆘 እርዳኝ');
    const channelLabel = await getConfig('channel_btn_label', '📢 ቻናሎች');
    const streakLabel = await getConfig('streak_btn_label', '📅 ቀኔን ቁጠር');

    // Build Dynamic Layout
    const defaultLayout = [[urgeLabel, streakLabel], [channelLabel]];
    let layoutRaw = await getConfig('keyboard_layout', defaultLayout);
    let layout = (typeof layoutRaw === 'string') ? JSON.parse(layoutRaw) : layoutRaw;

    // Add Custom Buttons
    const customBtns = await CustomButton.find({});
    const existingLabels = layout.flat();
    let tempRow = [];
    customBtns.forEach(btn => {
        if (!existingLabels.includes(btn.label)) {
            tempRow.push(btn.label);
            if (tempRow.length === 2) { 
                layout.push(tempRow); 
                tempRow = []; 
            }
        }
    });
    if (tempRow.length > 0) layout.push(tempRow);

    // Add Admin Panel (Only for Admins)
    if (ADMIN_IDS.includes(userId)) {
        layout.push(['🔐 Admin Panel']);
    }

    const welcomeMsg = await getConfig('welcome_msg', `ሰላም ${firstName}! እንኳን በሰላም መጣህ።`);
    await ctx.reply(welcomeMsg, Markup.keyboard(layout).resize());
  } catch (e) {
    console.error("Start Error:", e);
  }
});

// --- B. MAIN INPUT HANDLER (The Brain) ---
bot.on(['text', 'photo', 'video', 'voice'], async (ctx) => {
    // አልፎ አልፎ ባዶ Update ከመጣ (Service Message)
    if (!ctx.message) return;

    try {
        const userId = String(ctx.from.id);
        const text = ctx.message.text; 

        // === 1. ADMIN WIZARD CHECK (ADVANCED) ===
        if (ADMIN_IDS.includes(userId)) {
            const state = await getAdminState(userId);
            
            if (state && state.step) {
                // Cancel Command
                if (text === '/cancel') {
                    await clearAdminStep(userId);
                    return ctx.reply('❌ ሂደቱ ተሰርዟል።');
                }

                // -> Layout Setting
                if (state.step === 'awaiting_layout') {
                    if (!text) return ctx.reply('እባክዎ ፅሁፍ ብቻ ይላኩ።');
                    const lines = text.split('\n').map(line => 
                        line.split(',').map(item => item.trim()).filter(i => i !== '')
                    ).filter(row => row.length > 0);
                    
                    await Config.findOneAndUpdate({ key: 'keyboard_layout' }, { value: JSON.stringify(lines) }, { upsert: true });
                    await ctx.reply('✅ Layout ተስተካክሏል! /start ይበሉ።');
                    await clearAdminStep(userId); return;
                }

                // -> Welcome Message
                if (state.step === 'awaiting_welcome') {
                    await Config.findOneAndUpdate({ key: 'welcome_msg' }, { value: text }, { upsert: true });
                    await ctx.reply('✅ Start Message ተቀይሯል!');
                    await clearAdminStep(userId); return;
                }

                // -> Renaming Buttons
                if (state.step === 'awaiting_urge_name') {
                    await Config.findOneAndUpdate({ key: 'urge_btn_label' }, { value: text }, { upsert: true });
                    await ctx.reply('✅ ተቀይሯል! /start ይበሉ።');
                    await clearAdminStep(userId); return;
                }
                if (state.step === 'awaiting_streak_name') {
                    await Config.findOneAndUpdate({ key: 'streak_btn_label' }, { value: text }, { upsert: true });
                    await ctx.reply('✅ ተቀይሯል! /start ይበሉ።');
                    await clearAdminStep(userId); return;
                }

                // -> Adding Channels
                if (state.step === 'awaiting_channel_name') {
                    await setAdminStep(userId, 'awaiting_channel_link', { name: text });
                    return ctx.reply('🔗 አሁን የቻናሉን ሊንክ ይላኩ (https://t.me/...):');
                }
                if (state.step === 'awaiting_channel_link') {
                    await Channel.create({ name: state.tempData.name, link: text });
                    await ctx.reply('✅ ቻናል ተጨምሯል!');
                    await clearAdminStep(userId); return;
                }

                // -> Adding Custom Buttons (with Media Support)
                if (state.step === 'awaiting_btn_name') {
                    await setAdminStep(userId, 'awaiting_btn_content', { label: text });
                    return ctx.reply('📥 አሁን ይዘቱን ይላኩ (ፅሁፍ፣ ፎቶ፣ ቪዲዮ ወይም Voice):');
                }
                if (state.step === 'awaiting_btn_content') {
                    let type = 'text', content = '', caption = ctx.message.caption || '';

                    if (ctx.message.voice) {
                        type = 'voice'; content = ctx.message.voice.file_id;
                    } else if (ctx.message.photo) {
                        type = 'photo'; content = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                    } else if (ctx.message.video) {
                        type = 'video'; content = ctx.message.video.file_id;
                    } else if (text) {
                        content = text;
                    } else {
                        return ctx.reply('⚠️ እባክዎ ትክክለኛ መረጃ ይላኩ።');
                    }
                    
                    try {
                        await CustomButton.create({ label: state.tempData.label, type, content, caption });
                        await ctx.reply(`✅ በተን "${state.tempData.label}" ተፈጥሯል! /start ብለው ያዩት።`);
                    } catch (e) { await ctx.reply('❌ ስህተት፡ ምናልባት ስሙ ተደጋግሞ ይሆናል።'); }
                    await clearAdminStep(userId); return;
                }

                // -> Adding Motivation
                if (state.step === 'awaiting_motivation') {
                    if (!text) return ctx.reply('ፅሁፍ ብቻ ይላኩ።');
                    await Motivation.create({ text });
                    await ctx.reply('✅ አነቃቂ ፅሁፍ ተጨምሯል።');
                    await clearAdminStep(userId); return;
                }
            }
        }

        // === 2. STANDARD INTERACTIONS ===

        // Admin Panel Access
        if (text === '🔐 Admin Panel' && ADMIN_IDS.includes(userId)) {
            return showAdminMenu(ctx);
        }

        const urgeLabel = await getConfig('urge_btn_label', '🆘 እርዳኝ');
        if (text === urgeLabel) {
            const count = await Motivation.countDocuments();
            if (count === 0) return ctx.reply('ለጊዜው መልእክት የለም።');
            const random = Math.floor(Math.random() * count);
            const m = await Motivation.findOne().skip(random);
            return ctx.reply(`💪 **በርታ!**\n\n${m.text}`, { parse_mode: 'Markdown' });
        }

        const streakLabel = await getConfig('streak_btn_label', '📅 ቀኔን ቁጠር');
        if (text === streakLabel) return handleStreak(ctx);

        const channelLabel = await getConfig('channel_btn_label', '📢 ቻናሎች');
        if (text === channelLabel) {
            const channels = await Channel.find({});
            if (channels.length === 0) return ctx.reply('ቻናል የለም።');
            const btns = channels.map(c => [Markup.button.url(c.name, c.link)]);
            return ctx.reply('የሚከተሉትን ቻናሎች ይቀላቀሉ:', Markup.inlineKeyboard(btns));
        }

        // Custom Buttons (Media Handler)
        const customBtn = await CustomButton.findOne({ label: text });
        if (customBtn) {
            if (customBtn.type === 'photo') return ctx.replyWithPhoto(customBtn.content, { caption: customBtn.caption });
            if (customBtn.type === 'video') return ctx.replyWithVideo(customBtn.content, { caption: customBtn.caption });
            if (customBtn.type === 'voice') return ctx.replyWithVoice(customBtn.content, { caption: customBtn.caption });
            return ctx.reply(customBtn.content);
        }

    } catch (e) {
        console.error("Handler Error:", e);
    }
});

// ============================================================
// 6. LOGIC FUNCTIONS (STREAK, RELAPSE, ADMIN)
// ============================================================

async function handleStreak(ctx) {
    const userId = String(ctx.from.id);
    let user = await User.findOne({ userId });
    
    if (!user) user = await User.create({ userId, firstName: ctx.from.first_name });

    const diff = Math.floor(Math.abs(new Date() - user.streakStart) / 86400000); // 1 Day = 86400000ms

    await ctx.reply(
        `🔥 **የ ${user.firstName} አቋም**\n\n` +
        `📆 Streak: **${diff} ቀን**\n` +
        `🏆 Best Streak: ${user.bestStreak} ቀን`,
        Markup.inlineKeyboard([
            [Markup.button.callback('💔 ወደቅኩ (Relapse)', `rel_${userId}`)],
            [Markup.button.callback('🏆 ደረጃ (Leaderboard)', `led_${userId}`)],
            [Markup.button.callback('🔄 Refresh', `ref_${userId}`)]
        ])
    );
}

// INLINE ACTIONS VERIFICATION
const verify = (ctx, id) => {
    if (String(ctx.from.id) !== id) {
        ctx.answerCbQuery("⚠️ ይሄ የእርስዎ አይደለም!", { show_alert: true });
        return false;
    }
    return true;
};

// Relapse Menu
bot.action(/^rel_(.+)$/, async (ctx) => {
    if (!verify(ctx, ctx.match[1])) return;
    await ctx.editMessageText('አይዞህ! ለምን ወደቅክ? (ምክንያቱን ምረጥ)', Markup.inlineKeyboard([
        [Markup.button.callback('🥱 መሰላቸት', `rsn_bored_${ctx.match[1]}`)],
        [Markup.button.callback('😰 ጭንቀት', `rsn_stress_${ctx.match[1]}`)],
        [Markup.button.callback('🔥 ስሜት', `rsn_urge_${ctx.match[1]}`)],
        [Markup.button.callback('❌ ሰረዝ (Cancel)', `can_${ctx.match[1]}`)]
    ]));
});

// Process Relapse
bot.action(/^rsn_(.+)_(.+)$/, async (ctx) => {
    if (!verify(ctx, ctx.match[2])) return;
    const uid = ctx.match[2];
    const reason = ctx.match[1];
    
    let user = await User.findOne({ userId: uid });
    
    // Save Best
    const days = Math.floor(Math.abs(new Date() - user.streakStart) / 86400000);
    if (days > user.bestStreak) user.bestStreak = days;
    
    // Reset
    user.streakStart = new Date();
    user.relapseHistory.push({ reason });
    await user.save();

    // Auto-Delete Menu (Clean Chat)
    try { await ctx.deleteMessage(); } catch(e){}
    
    await ctx.reply('✅ መዝግቤያለሁ። ቀናትህ ወደ 0 ተመልሰዋል። ተስፋ አትቁረጥ! 💪');
    await ctx.answerCbQuery();
});

// Refresh Stats
bot.action(/^ref_(.+)$/, async (ctx) => {
    if (!verify(ctx, ctx.match[1])) return;
    try { await ctx.deleteMessage(); } catch(e){}
    await handleStreak(ctx);
    await ctx.answerCbQuery();
});

// Cancel
bot.action(/^can_(.+)$/, async (ctx) => {
    if (!verify(ctx, ctx.match[1])) return;
    try { await ctx.deleteMessage(); } catch(e){}
    await ctx.answerCbQuery('ተሰርዟል');
});

// Leaderboard
bot.action(/^led_(.+)$/, async (ctx) => {
    const topUsers = await User.find().sort({ streakStart: 1 }).limit(10);
    
    let msg = '🏆 **Top 10 Leaders** 🏆\n\n';
    topUsers.forEach((u, i) => {
        const d = Math.floor(Math.abs(new Date() - u.streakStart) / 86400000);
        msg += `${i+1}. ${u.firstName} — **${d} days**\n`;
    });

    await ctx.editMessageText(msg, { 
        parse_mode: 'Markdown', 
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', `ref_${ctx.match[1]}`)]])
    });
});

// ADMIN PANEL MENU
async function showAdminMenu(ctx) {
    const userCount = await User.countDocuments();
    
    await ctx.reply(
        `⚙️ **Admin Dashboard**\n👥 Users: ${userCount}`,
        Markup.inlineKeyboard([
            [Markup.button.callback('➕ Motivation', 'adm_mot'), Markup.button.callback('🔲 Layout', 'adm_lay')],
            [Markup.button.callback('📝 Start Msg', 'adm_wel'), Markup.button.callback('🏷️ Rename', 'adm_ren')],
            [Markup.button.callback('📢 Channels', 'adm_chan'), Markup.button.callback('🔘 Custom Btn', 'adm_cus')]
        ])
    );
}

// Admin Action Handlers (Setting State)
const ask = (ctx, step, text) => { 
    setAdminStep(String(ctx.from.id), step); 
    ctx.reply(text); 
    ctx.answerCbQuery(); 
};

bot.action('adm_mot', c => ask(c, 'awaiting_motivation', 'አነቃቂ ፅሁፉን ላክ:'));
bot.action('adm_lay', c => ask(c, 'awaiting_layout', 'Layout ላክ (Example: 🆘 Urge, 📅 Streak):'));
bot.action('adm_wel', c => ask(c, 'awaiting_welcome', 'Start Message ላክ:'));
bot.action('adm_ren', c => { c.reply('የቱን?', Markup.inlineKeyboard([[Markup.button.callback('Urge', 'ren_urg'), Markup.button.callback('Streak', 'ren_str')]])); c.answerCbQuery(); });
bot.action('ren_urg', c => ask(c, 'awaiting_urge_name', 'አዲስ ስም ላክ:'));
bot.action('ren_str', c => ask(c, 'awaiting_streak_name', 'አዲስ ስም ላክ:'));

// Manage Channels
bot.action('adm_chan', async (ctx) => {
    const ch = await Channel.find({});
    let b = [[Markup.button.callback('➕ Add Channel', 'add_ch')]];
    ch.forEach(x => b.push([Markup.button.callback(`🗑️ ${x.name}`, `del_ch_${x._id}`)])]);
    await ctx.editMessageText('Channels:', Markup.inlineKeyboard(b));
});
bot.action('add_ch', c => ask(c, 'awaiting_channel_name', 'የቻናሉን ስም ላክ:'));
bot.action(/^del_ch_(.+)$/, async c => { await Channel.findByIdAndDelete(c.match[1]); c.reply('Deleted'); c.answerCbQuery(); });

// Manage Custom Buttons
bot.action('adm_cus', async (ctx) => {
    const b = await CustomButton.find({});
    let btns = [[Markup.button.callback('➕ Add Button', 'add_cus')]];
    b.forEach(x => btns.push([Markup.button.callback(`🗑️ ${x.label}`, `del_cus_${x._id}`)])]);
    await ctx.editMessageText('Custom Buttons:', Markup.inlineKeyboard(btns));
});
bot.action('add_cus', c => ask(c, 'awaiting_btn_name', 'የበተኑን ስም ላክ:'));
bot.action(/^del_cus_(.+)$/, async c => { await CustomButton.findByIdAndDelete(c.match[1]); c.reply('Deleted'); c.answerCbQuery(); });


// ============================================================
// 7. SERVERLESS HANDLER (THE PROTECTOR)
// ============================================================
module.exports = async (req, res) => {
    // 1. Keep-Alive Check
    if (req.method === 'GET') return res.status(200).send('Bot is Active');

    // 2. Main Logic with Protection
    if (req.method === 'POST') {
        const update = req.body;
        const updateId = update.update_id;

        // A. TIMEOUT PROTECTION (4.5s Limit)
        // ቦቱ ከ4.5 ሰከንድ በላይ ከቆየ፣ Vercel Timeout እንዳይሆን እና Telegram እንዳይደግም
        // በግድ እናቋርጠዋለን።
        const botLogic = async () => {
            await connectToDatabase();
            
            // B. DEDUPLICATION (Anti-Double Reply)
            // አንድ አይነት Message ID ሁለቴ ከመጣ፣ ዳታቤዝ Error ይፈጥራል፣ ስራው ይቆማል።
            try { 
                await ProcessedUpdate.create({ update_id: updateId }); 
            } catch (err) {
                if (err.code === 11000) {
                    console.log(`Duplicate Update Ignored: ${updateId}`);
                    return; // Stop here silently
                }
                throw err;
            }

            // C. Process Update
            await bot.handleUpdate(update);
        };

        try {
            // Promise.race = የቱ ይፈጥናል? (ቦቱ ወይስ ሰዓት ቆጣሪው?)
            await Promise.race([
                botLogic(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 4500))
            ]);
        } catch (error) {
            // Timeout ከሆነ Error አንሰጥም፣ ዝም ብለን OK እንላለን
            if (error.message !== 'Timeout') console.error('Bot Logic Error:', error);
        }
    }

    // Always return 200 OK immediately to satisfy Telegram
    res.status(200).send('OK');
};
