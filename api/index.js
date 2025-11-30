const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

// --- Configuration ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(',').map(id => id.trim());

if (!BOT_TOKEN) throw new Error('BOT_TOKEN is missing!');
if (!MONGODB_URI) throw new Error('MONGODB_URI is missing!');

// --- Database Schemas ---

// 1. Configs
const configSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
});
const Config = mongoose.models.Config || mongoose.model('Config', configSchema);

// 2. User & Session
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  firstName: String,
  streakStart: { type: Date, default: Date.now },
  bestStreak: { type: Number, default: 0 },
  relapseHistory: [{ date: { type: Date, default: Date.now }, reason: String }],
  adminState: { 
      step: { type: String, default: null }, 
      tempData: { type: mongoose.Schema.Types.Mixed, default: {} } 
  }
});
const User = mongoose.models.User || mongoose.model('User', userSchema);

// 3. Channels
const channelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  link: { type: String, required: true }
});
const Channel = mongoose.models.Channel || mongoose.model('Channel', channelSchema);

// 4. Custom Buttons
const customButtonSchema = new mongoose.Schema({
  label: { type: String, required: true, unique: true },
  type: { type: String, enum: ['text', 'photo', 'video', 'voice'], default: 'text' },
  content: { type: String, required: true }, 
  caption: { type: String }
});
const CustomButton = mongoose.models.CustomButton || mongoose.model('CustomButton', customButtonSchema);

// 5. Motivation
const motivationSchema = new mongoose.Schema({
  text: { type: String, required: true },
  addedAt: { type: Date, default: Date.now }
});
const Motivation = mongoose.models.Motivation || mongoose.model('Motivation', motivationSchema);

// --- DB Connection ---
let isConnected = false;
async function connectToDatabase() {
  if (isConnected && mongoose.connection.readyState === 1) return;
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    isConnected = true;
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("MongoDB error:", error);
  }
}

// --- Helper Functions ---
async function setAdminStep(userId, step, data = {}) {
    await User.findOneAndUpdate({ userId }, { adminState: { step, tempData: data } }, { upsert: true });
}
async function getAdminState(userId) {
    const user = await User.findOne({ userId });
    return user ? user.adminState : { step: null, tempData: {} };
}
async function clearAdminStep(userId) {
    await User.findOneAndUpdate({ userId }, { adminState: { step: null, tempData: {} } });
}
async function getConfig(key, def) {
    const doc = await Config.findOne({ key });
    return doc ? doc.value : def;
}

// --- Bot Setup ---
const bot = new Telegraf(BOT_TOKEN);

// Error Handling (ለ Query too old እና ሌሎች Error መከላከያ)
bot.catch((err, ctx) => {
    console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
});

// --- START COMMAND ---
bot.start(async (ctx) => {
  try {
    await connectToDatabase();
    const userId = String(ctx.from.id);
    const firstName = ctx.from.first_name || 'Friend';
    
    await User.findOneAndUpdate({ userId }, { firstName }, { upsert: true });
    if (ADMIN_IDS.includes(userId)) await clearAdminStep(userId);

    const urgeLabel = await getConfig('urge_btn_label', '🆘 እርዳኝ');
    const channelLabel = await getConfig('channel_btn_label', '📢 ቻናሎች');
    const streakLabel = await getConfig('streak_btn_label', '📅 ቀኔን ቁጠር');

    const defaultLayout = [[urgeLabel, streakLabel], [channelLabel]];
    let layoutRaw = await getConfig('keyboard_layout', defaultLayout);
    let layout = (typeof layoutRaw === 'string') ? JSON.parse(layoutRaw) : layoutRaw;

    const customBtns = await CustomButton.find({});
    const existingLabels = layout.flat();
    let tempRow = [];
    customBtns.forEach(btn => {
        if (!existingLabels.includes(btn.label)) {
            tempRow.push(btn.label);
            if (tempRow.length === 2) { layout.push(tempRow); tempRow = []; }
        }
    });
    if (tempRow.length > 0) layout.push(tempRow);

    if (ADMIN_IDS.includes(userId)) layout.push(['🔐 Admin Panel']);

    const welcomeMsg = await getConfig('welcome_msg', `ሰላም ${firstName}! እንኳን በሰላም መጣህ።`);
    await ctx.reply(welcomeMsg, Markup.keyboard(layout).resize());
  } catch (e) {
    console.error(e);
  }
});

// --- TEXT & INPUT HANDLER ---
bot.on(['text', 'photo', 'video', 'voice'], async (ctx) => {
    try {
        await connectToDatabase();
        const userId = String(ctx.from.id);
        const text = ctx.message.text;

        // Admin Wizard Steps
        if (ADMIN_IDS.includes(userId)) {
            const state = await getAdminState(userId);
            if (state && state.step) {
                if (text === '/cancel') {
                    await clearAdminStep(userId);
                    return ctx.reply('❌ ተሰርዟል። ወደ ዋናው ሜኑ ተመለስኩ።');
                }

                if (state.step === 'awaiting_layout') {
                    const lines = text.split('\n').map(l => l.split(',').map(i => i.trim()).filter(x=>x));
                    await Config.findOneAndUpdate({ key: 'keyboard_layout' }, { value: JSON.stringify(lines) }, { upsert: true });
                    await ctx.reply('✅ Layout ተስተካክሏል! /start ይበሉ።');
                    await clearAdminStep(userId); return;
                }
                
                if (state.step === 'awaiting_welcome') {
                    await Config.findOneAndUpdate({ key: 'welcome_msg' }, { value: text }, { upsert: true });
                    await ctx.reply('✅ Start Message ተቀይሯል!');
                    await clearAdminStep(userId); return;
                }
                if (state.step === 'awaiting_urge_name') {
                    await Config.findOneAndUpdate({ key: 'urge_btn_label' }, { value: text }, { upsert: true });
                    await ctx.reply('✅ ስም ተቀይሯል! /start ይበሉ።');
                    await clearAdminStep(userId); return;
                }
                if (state.step === 'awaiting_streak_name') {
                    await Config.findOneAndUpdate({ key: 'streak_btn_label' }, { value: text }, { upsert: true });
                    await ctx.reply('✅ ስም ተቀይሯል! /start ይበሉ።');
                    await clearAdminStep(userId); return;
                }
                if (state.step === 'awaiting_channel_name') {
                    await setAdminStep(userId, 'awaiting_channel_link', { name: text });
                    return ctx.reply('🔗 የቻናሉን ሊንክ ላክ (https://t.me/...):');
                }
                if (state.step === 'awaiting_channel_link') {
                    await Channel.create({ name: state.tempData.name, link: text });
                    await ctx.reply('✅ ቻናል ተጨምሯል!');
                    await clearAdminStep(userId); return;
                }
                if (state.step === 'awaiting_btn_name') {
                    await setAdminStep(userId, 'awaiting_btn_content', { label: text });
                    return ctx.reply('📥 በተኑ ሲነካ ምን ይምጣ? (Text, Photo, Video or Voice ላክ):');
                }
                if (state.step === 'awaiting_btn_content') {
                    let type = 'text', content = '', caption = ctx.message.caption || '';
                    if (ctx.message.voice) { type = 'voice'; content = ctx.message.voice.file_id; }
                    else if (ctx.message.photo) { type = 'photo'; content = ctx.message.photo[ctx.message.photo.length - 1].file_id; }
                    else if (ctx.message.video) { type = 'video'; content = ctx.message.video.file_id; }
                    else if (text) { content = text; }
                    else return ctx.reply('⚠️ እባክዎ ፅሁፍ ወይም ሚዲያ ይላኩ።');

                    await CustomButton.create({ label: state.tempData.label, type, content, caption });
                    await ctx.reply(`✅ በተን "${state.tempData.label}" ተፈጥሯል! /start ይበሉ።`);
                    await clearAdminStep(userId); return;
                }
                if (state.step === 'awaiting_motivation') {
                    await Motivation.create({ text });
                    await ctx.reply('✅ አነቃቂ ፅሁፍ ተጨምሯል።');
                    await clearAdminStep(userId); return;
                }
            }
        }

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
            return ctx.reply('ይቀላቀሉ:', Markup.inlineKeyboard(btns));
        }

        const customBtn = await CustomButton.findOne({ label: text });
        if (customBtn) {
            if (customBtn.type === 'photo') return ctx.replyWithPhoto(customBtn.content, { caption: customBtn.caption });
            if (customBtn.type === 'video') return ctx.replyWithVideo(customBtn.content, { caption: customBtn.caption });
            if (customBtn.type === 'voice') return ctx.replyWithVoice(customBtn.content, { caption: customBtn.caption });
            return ctx.reply(customBtn.content);
        }

    } catch (e) { console.error(e); }
});

// --- STREAK LOGIC ---
async function handleStreak(ctx) {
    try {
        await connectToDatabase(); // የግድ መገናኘት አለበት
        const userId = String(ctx.from.id);
        let user = await User.findOne({ userId });
        if (!user) user = await User.create({ userId, firstName: ctx.from.first_name });

        const diffDays = Math.floor(Math.abs(new Date() - user.streakStart) / (1000 * 60 * 60 * 24));

        await ctx.reply(
            `🔥 **የ ${user.firstName} አቋም**\n📆 Streak: **${diffDays} ቀን**\n🏆 Best: ${user.bestStreak} ቀን`,
            Markup.inlineKeyboard([
                [Markup.button.callback('💔 ወደቅኩ (Relapse)', `relapse_${userId}`)],
                [Markup.button.callback('🏆 ደረጃ (Leaderboard)', `leader_${userId}`)],
                [Markup.button.callback('🔄 Refresh', `refresh_${userId}`)]
            ])
        );
    } catch (e) { console.error(e); }
}

// --- CALLBACK HANDLERS ---
const verifyOwner = (ctx, id) => {
    if (String(ctx.from.id) !== id) {
        ctx.answerCbQuery("⚠️ ይሄ የእርስዎ አይደለም!", { show_alert: true }).catch(() => {});
        return false;
    }
    return true;
};

// Safe Answer Helper
const safeAnswer = async (ctx, text) => {
    try { await ctx.answerCbQuery(text); } catch(e) {}
};

bot.action(/^relapse_(.+)$/, async (ctx) => {
    if (!verifyOwner(ctx, ctx.match[1])) return;
    const uid = ctx.match[1];
    await ctx.editMessageText('ለምን ወደቅክ?', Markup.inlineKeyboard([
        [Markup.button.callback('🥱 መሰላቸት', `rsn_bored_${uid}`)],
        [Markup.button.callback('😰 ጭንቀት', `rsn_stress_${uid}`)],
        [Markup.button.callback('🔥 ስሜት', `rsn_urge_${uid}`)],
        [Markup.button.callback('❌ ሰረዝ', `cancel_${uid}`)]
    ])).catch(() => {});
    await safeAnswer(ctx);
});

bot.action(/^rsn_(.+)_(.+)$/, async (ctx) => {
    const reason = ctx.match[1];
    const uid = ctx.match[2];
    if (!verifyOwner(ctx, uid)) return;

    await connectToDatabase();
    let user = await User.findOne({ userId: uid });
    
    const days = Math.floor(Math.abs(new Date() - user.streakStart) / (1000 * 60 * 60 * 24));
    if (days > user.bestStreak) user.bestStreak = days;
    
    user.streakStart = new Date(); 
    user.relapseHistory.push({ reason });
    await user.save();

    try { await ctx.deleteMessage(); } catch(e) {}
    await ctx.reply('✅ መዝግቤያለሁ። ቀናትህ ወደ 0 ተመልሰዋል። ጠንክር! 💪');
    await safeAnswer(ctx);
});

bot.action(/^refresh_(.+)$/, async (ctx) => {
    if (!verifyOwner(ctx, ctx.match[1])) return;
    try { await ctx.deleteMessage(); } catch(e) {}
    await handleStreak(ctx);
    await safeAnswer(ctx);
});

bot.action(/^cancel_(.+)$/, async (ctx) => {
    if (!verifyOwner(ctx, ctx.match[1])) return;
    try { await ctx.deleteMessage(); } catch(e) {}
    await safeAnswer(ctx, 'ተሰርዟል');
});

bot.action(/^leader_(.+)$/, async (ctx) => {
    await connectToDatabase();
    const tops = await User.find().sort({ streakStart: 1 }).limit(10);
    let msg = '🏆 **Top 10 Leaders**\n\n';
    tops.forEach((u, i) => {
        const d = Math.floor(Math.abs(new Date() - u.streakStart) / (1000 * 60 * 60 * 24));
        msg += `${i+1}. ${u.firstName || 'User'} - ${d} days\n`;
    });
    await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', `refresh_${ctx.match[1]}`)]])}).catch(() => {});
    await safeAnswer(ctx);
});

// --- ADMIN PANEL ---
async function showAdminMenu(ctx) {
    try {
        await connectToDatabase();
        const c = await User.countDocuments();
        await ctx.reply(`⚙️ **Admin Dashboard** (Users: ${c})`, Markup.inlineKeyboard([
            [Markup.button.callback('➕ ፅሁፍ (Motivation)', 'adm_mot'), Markup.button.callback('🔲 Layout', 'adm_lay')],
            [Markup.button.callback('📝 Start Msg', 'adm_wel'), Markup.button.callback('🏷️ Rename', 'adm_ren')],
            [Markup.button.callback('📢 Channels', 'adm_chan'), Markup.button.callback('🔘 Custom Btn', 'adm_cus')]
        ]));
    } catch(e) { console.error(e); }
}

const setStep = async (ctx, step, msg) => {
    try {
        await connectToDatabase(); // FIX: DB Connection added
        const uid = String(ctx.from.id);
        await setAdminStep(uid, step);
        await ctx.reply(msg + '\n(ለመሰረዝ /cancel ይበሉ)');
        await safeAnswer(ctx);
    } catch(e) { console.error(e); }
};

bot.action('adm_mot', (ctx) => setStep(ctx, 'awaiting_motivation', 'አነቃቂ ፅሁፍ ላክ:'));
bot.action('adm_lay', (ctx) => setStep(ctx, 'awaiting_layout', 'Layout ላክ (Comma separated):'));
bot.action('adm_wel', (ctx) => setStep(ctx, 'awaiting_welcome', 'Start Message ላክ:'));
bot.action('adm_ren', async (ctx) => {
    await ctx.reply('የቱ ይቀየር?', Markup.inlineKeyboard([
        [Markup.button.callback('🆘 Emergency', 'ren_urge'), Markup.button.callback('📅 Streak', 'ren_str')]
    ]));
    await safeAnswer(ctx);
});
bot.action('ren_urge', (ctx) => setStep(ctx, 'awaiting_urge_name', 'የ Emergency በተን ስም ላክ:'));
bot.action('ren_str', (ctx) => setStep(ctx, 'awaiting_streak_name', 'የ Streak በተን ስም ላክ:'));

bot.action('adm_chan', async (ctx) => {
    await connectToDatabase(); // FIX
    const ch = await Channel.find({});
    let b = [[Markup.button.callback('➕ Add Channel', 'add_ch')]];
    ch.forEach(x => b.push([Markup.button.callback(`🗑️ ${x.name}`, `del_ch_${x._id}`)]));
    await ctx.editMessageText('Channels:', Markup.inlineKeyboard(b)).catch(() => {});
    await safeAnswer(ctx);
});
bot.action('add_ch', (ctx) => setStep(ctx, 'awaiting_channel_name', 'የቻናሉን ስም ላክ:'));
bot.action(/^del_ch_(.+)$/, async (ctx) => {
    await connectToDatabase();
    await Channel.findByIdAndDelete(ctx.match[1]);
    await ctx.reply('Deleted.'); 
    await safeAnswer(ctx);
});

bot.action('adm_cus', async (ctx) => {
    await connectToDatabase(); // FIX
    const btns = await CustomButton.find({});
    let b = [[Markup.button.callback('➕ Add Custom Btn', 'add_cus')]];
    btns.forEach(x => b.push([Markup.button.callback(`🗑️ ${x.label}`, `del_cus_${x._id}`)]));
    await ctx.editMessageText('Custom Buttons:', Markup.inlineKeyboard(b)).catch(() => {});
    await safeAnswer(ctx);
});
bot.action('add_cus', (ctx) => setStep(ctx, 'awaiting_btn_name', 'የበተኑን ስም ላክ:'));
bot.action(/^del_cus_(.+)$/, async (ctx) => {
    await connectToDatabase();
    await CustomButton.findByIdAndDelete(ctx.match[1]);
    await ctx.reply('Deleted.'); 
    await safeAnswer(ctx);
});

module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            await bot.handleUpdate(req.body);
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error('Error handling update:', error);
        res.status(200).send('OK');
    }
};
