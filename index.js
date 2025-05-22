import { Telegraf, Markup } from 'telegraf';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import cron from 'node-cron';

dotenv.config();

const {
  BOT_TOKEN,
  CHANNEL_USERNAME,
  PRIVATE_GROUP_LINK: GROUP_LINK,
  MONGO_URI,
  PORT = 3000,
} = process.env;

if (!BOT_TOKEN || !CHANNEL_USERNAME || !GROUP_LINK || !MONGO_URI) {
  console.error('❌ Missing .env values. Check BOT_TOKEN, CHANNEL_USERNAME, PRIVATE_GROUP_LINK, MONGO_URI');
  process.exit(1);
}

const app = express();
app.get('/', (_, res) => res.send('Bot is running'));
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Server on port ${PORT}`));

const bot = new Telegraf(BOT_TOKEN);
const client = new MongoClient(MONGO_URI);
let users;

// ---- INIT DATABASE ---- //
async function startDB() {
  try {
    await client.connect();
    const db = client.db('marifkon');
    users = db.collection('users');
    await users.createIndex({ id: 1 }, { unique: true });
    console.log('🗄️ MongoDB connected');
  } catch (err) {
    console.error('❌ DB connection failed:', err);
    process.exit(1);
  }
}

// ---- USER HELPERS ---- //
async function getUserLanguage(userId) {
  const user = await users.findOne({ id: userId });
  return user?.language || 'uz';
}

async function addUser(id, referredBy = null, from = {}, language = 'uz') {
  id = String(id);
  if (referredBy) referredBy = String(referredBy);
  const updateObj = {
    $setOnInsert: {
      id,
      referrals: 0,
      rewarded: false,
      referredBy: referredBy && referredBy !== id ? referredBy : null,
      first_name: from.first_name ?? null,
      last_name: from.last_name ?? null,
      username: from.username ?? null,
      language,
    },
    ...(referredBy && referredBy !== id ? { $set: { referredBy } } : {}),
  };
  await users.updateOne({ id }, updateObj, { upsert: true });
}

async function isSubscribed(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(`@${CHANNEL_USERNAME}`, ctx.from.id);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (err) {
    console.error('❌ Subscription check failed:', err);
    return false;
  }
}

async function refreshReferralStatus(userId) {
  const count = await users.countDocuments({ referredBy: userId });
  const user = await users.findOne({ id: userId });
  if (!user.rewarded && count >= 3) {
    await users.updateOne({ id: userId }, { $set: { rewarded: true } });
  }
  return { referralCount: count, rewarded: user.rewarded || count >= 3 };
}

// ---- BOT MIDDLEWARE ---- //
bot.use(async (ctx, next) => {
  if (!ctx.from) return;
  const isSub = await isSubscribed(ctx);
  if (!isSub) {
    const lang = await getUserLanguage(String(ctx.from.id));
    return ctx.reply(
      MESSAGES[lang].joined_channel,
      Markup.inlineKeyboard([
        Markup.button.url(MESSAGES[lang].joined_channel_btn, `https://t.me/${CHANNEL_USERNAME}`),
        Markup.button.callback(MESSAGES[lang].check_sub_button, 'check_sub'),
      ])
    );
  }
  return next();
});

// ---- COMMANDS + ACTIONS ---- //
// /start
bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  const referredBy = ctx.startPayload || null;
  await addUser(userId, referredBy, ctx.from);
  const lang = await getUserLanguage(userId);
  const username = bot.botInfo.username;
  const referralLink = `https://t.me/${username}?start=${userId}`;
  await ctx.reply(
    `${MESSAGES[lang].help_text}\n\n${MESSAGES[lang].referral_link_text(referralLink)}`,
    { parse_mode: 'HTML' }
  );
  await sendReferralMessage(ctx, userId);
});

// /language
bot.command('language', sendLanguageSelection);

// Language selection
bot.action('lang_uz', async (ctx) => {
  await users.updateOne({ id: String(ctx.from.id) }, { $set: { language: 'uz' } });
  await ctx.answerCbQuery('Til o‘zgartirildi');
  await ctx.editMessageText(MESSAGES['uz'].language_changed);
});
bot.action('lang_en', async (ctx) => {
  await users.updateOne({ id: String(ctx.from.id) }, { $set: { language: 'en' } });
  await ctx.answerCbQuery('Language changed');
  await ctx.editMessageText(MESSAGES['en'].language_changed);
});

// Referral check
bot.command('myreferrals', async (ctx) => {
  const userId = String(ctx.from.id);
  const lang = await getUserLanguage(userId);
  const count = await users.countDocuments({ referredBy: userId });
  await ctx.reply(MESSAGES[lang].referrals_info(count));
});

// /resetreferrals
bot.command('resetreferrals', async (ctx) => {
  const lang = await getUserLanguage(ctx.from.id);
  await users.updateOne({ id: String(ctx.from.id) }, { $set: { referrals: 0, rewarded: false } });
  await ctx.reply(
    lang === 'uz'
      ? '👥 Takliflaringiz qayta o‘rnatildi. Siz yana 3 do‘st taklif qilishingiz kerak.'
      : '👥 Your referrals have been reset. You need to invite 3 friends again.'
  );
});

// /mystats
bot.command('mystats', async (ctx) => {
  const userId = String(ctx.from.id);
  const lang = await getUserLanguage(userId);
  const user = await users.findOne({ id: userId });
  if (!user) return ctx.reply(lang === 'uz' ? 'Foydalanuvchi topilmadi.' : 'User not found.');
  const count = await users.countDocuments({ referredBy: userId });
  const access = user.rewarded || count >= 3;
  await ctx.reply(
    lang === 'uz'
      ? `👤 Sizning ma'lumotlaringiz:\n\n📊 Takliflar soni: ${count}\n🔓 Guruhga kirish: ${access ? 'Ha' : 'Yo‘q'}\n🗣️ Til: ${user.language === 'uz' ? 'O‘zbekcha' : 'English'}`
      : `👤 Your stats:\n\n📊 Referrals: ${count}\n🔓 Group Access: ${access ? 'Yes' : 'No'}\n🗣️ Language: ${user.language === 'uz' ? 'O‘zbekcha' : 'English'}`
  );
});

// /leaderboard
bot.command('leaderboard', async (ctx) => {
  const lang = await getUserLanguage(ctx.from.id);
  const topRefs = await users.aggregate([
    { $match: { referredBy: { $ne: null } } },
    { $group: { _id: "$referredBy", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "id",
        as: "user_info"
      }
    }
  ]).toArray();

  if (!topRefs.length) {
    return ctx.reply(lang === 'uz' ? 'Hozircha taklif qilganlar yo‘q.' : 'No referrals yet.');
  }

  const message = topRefs.map((entry, i) => {
    const user = entry.user_info[0];
    const name = user?.first_name || user?.username || 'Unknown';
    return `${i + 1}. ${name}: ${entry.count}`;
  }).join('\n');

  await ctx.reply((lang === 'uz' ? '🏆 Top 5 taklifchilar:\n\n' : '🏆 Top 5 referrers:\n\n') + message);
});

// /myreferral
bot.command('myreferral', async (ctx) => {
  const userId = String(ctx.from.id);
  const lang = await getUserLanguage(userId);
  const username = bot.botInfo.username;
  const link = `https://t.me/${username}?start=${userId}`;
  await ctx.reply(MESSAGES[lang].referral_link_text(link));
});

// Callback: check_sub
bot.action('check_sub', async (ctx) => {
  const userId = String(ctx.from.id);
  const lang = await getUserLanguage(userId);
  const isSub = await isSubscribed(ctx);
  if (isSub) {
    await ctx.answerCbQuery(MESSAGES[lang].congrats_access, { show_alert: true });
    await sendReferralMessage(ctx, userId, false);
  } else {
    await ctx.answerCbQuery(MESSAGES[lang].not_subscribed, { show_alert: true });
  }
});

// ---- PROMO REFERRAL MESSAGE ---- //
async function sendReferralMessage(ctx, userId, showPromo = true) {
  const lang = await getUserLanguage(userId);
  const { referralCount, rewarded } = await refreshReferralStatus(userId);
  const username = bot.botInfo.username;
  const myLink = `https://t.me/${username}?start=${userId}`;
  const needed = Math.max(0, 3 - referralCount);

  if (showPromo) {
    const photoPath = path.resolve('./photo.png');
    const caption = MESSAGES[lang].photo_caption.replace(/\{link\}/g, myLink);
    await ctx.replyWithPhoto({ source: photoPath }, {
      caption,
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.url(
            rewarded ? MESSAGES[lang].unlocked_access.split('\n')[0] : MESSAGES[lang].need_more(needed),
            rewarded ? GROUP_LINK : myLink
          )
        ]
      ])
    });
  }

  const info = `${MESSAGES[lang].referrals_info(referralCount)}\n\n` +
    (rewarded
      ? MESSAGES[lang].unlocked_access
      : `${MESSAGES[lang].no_access_yet}\n${MESSAGES[lang].need_more(needed)}`);

  await ctx.reply(info, { parse_mode: 'HTML' });
}

// ---- LANGUAGE KEYBOARD ---- //
async function sendLanguageSelection(ctx) {
  await ctx.reply(
    MESSAGES['uz'].choose_lang,
    Markup.inlineKeyboard([
      [Markup.button.callback('🇺🇿 Oʻzbekcha', 'lang_uz')],
      [Markup.button.callback('🇬🇧 English', 'lang_en')]
    ])
  );
}

// ---- DAILY CRON REMINDER ---- //
cron.schedule('0 10,20 * * *', async () => {
  try {
    const usersList = await users.find().toArray();
    for (const user of usersList) {
      const lang = user.language || 'uz';
      const userId = user.id;
      const referralCount = await users.countDocuments({ referredBy: userId });
      const rewarded = user.rewarded || referralCount >= 3;
      const needed = Math.max(0, 3 - referralCount);

      if (rewarded) {
        await bot.telegram.sendMessage(userId, MESSAGES[lang].daily_msg_unlocked(user.first_name), { parse_mode: 'HTML' });
      } else {
        await bot.telegram.sendMessage(userId, MESSAGES[lang].daily_msg_locked(user.first_name, needed, referralCount), { parse_mode: 'HTML' });
      }
    }
  } catch (error) {
    console.error('❌ Error sending daily messages:', error);
  }
}, {
  timezone: 'Asia/Tashkent'
});


// ---- START BOT ---- //
startDB().then(() => {
  bot.launch().then(() => console.log('🤖 Bot started'));
});
