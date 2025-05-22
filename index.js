import { Telegraf, Markup } from 'telegraf';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import cron from 'node-cron';

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME;
const GROUP_LINK = process.env.PRIVATE_GROUP_LINK;
const MONGO_URI = process.env.MONGO_URI;

if (!BOT_TOKEN || !CHANNEL_USERNAME || !GROUP_LINK || !MONGO_URI) {
  console.error('Please set BOT_TOKEN, CHANNEL_USERNAME, PRIVATE_GROUP_LINK, and MONGO_URI in .env');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot is running');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Express server listening on port ${PORT}`);
});

const bot = new Telegraf(BOT_TOKEN);
const client = new MongoClient(MONGO_URI);

let users;

async function startDB() {
  await client.connect();
  const db = client.db('marifkon');
  users = db.collection('users');
  await users.createIndex({ id: 1 }, { unique: true });
  console.log('🗄️ Connected to MongoDB');
}

// Migration script: call this once if you have old users without language field
async function migrateUsersAddLanguage() {
  const res = await users.updateMany(
    { language: { $exists: false } },
    { $set: { language: 'uz' } }
  );
  console.log(`🛠️ Migrated ${res.modifiedCount} users with default language "uz"`);
}

// Language messages object
const MESSAGES = {
  uz: {
    choose_lang: 'Tilni tanlang / Choose your language:',
    joined_channel: `Iltimos, davom ettirish uchun kanalga obuna bo'ling:\n\n📢 https://t.me/${CHANNEL_USERNAME}`,
    joined_channel_btn: "📢 Kanalga obuna bo'ling",
    check_sub_button: "✅ Obuna bo'ldim",
    not_subscribed: `❌ Siz hali kanalga obuna bo‘lmadingiz.\n\n📢 https://t.me/${CHANNEL_USERNAME}`,
    help_text: `
🧠 <b>Botdan foydalanish yo‘riqnomasi</b>:

1️⃣ Kanalga obuna bo‘ling: https://t.me/${CHANNEL_USERNAME}
2️⃣ /start buyrug‘ini yuboring va <b>referral havolangizni</b> oling
3️⃣ Referral havolangizni ulashing va <b>3 do‘stingizni</b> taklif qiling
4️⃣ Maxfiy guruhga kirish huquqini oching

💬 /myreferrals - Necha kishi taklif qilganingizni ko‘ring
💬 /language - Tilni o‘zgartiring
`,
    need_more: (n) => `⛔ Guruhga kirish uchun yana ${n} ta do‘stingizni taklif qiling.`,
    referrals_info: (count) => `👥 Sizning takliflaringiz: ${count}`,
    unlocked_access: `✅ Maxfiy guruhga kirish huquqini ochdingiz!\n👉 Guruhga qo'shiling: ${GROUP_LINK}`,
    no_access_yet: `⛔ Sizda hali kirish huquqi yo'q.`,
    congrats_access: `✅ Tabriklaymiz! Maxfiy guruhga kirish huquqi ochildi.\n\n👉 <a href="${GROUP_LINK}">Guruhga qo'shiling</a>`,
    language_changed: `Til muvaffaqiyatli o'zgartirildi!`,
    daily_msg_locked: (name, needed, count) =>
      `🌞 Assalomu alaykum${name ? ', ' + name : ''}!\n\n⏳ Guruhga kirish uchun yana ${needed} ta do'stingizni taklif qiling.\n🎯 Sizning progress: ${count}/3 taklif\n📢 Kanalimizni kuzatib boring: https://t.me/${CHANNEL_USERNAME}\n🔗 Referral havolangizni ulashing!`,
    daily_msg_unlocked: (name) =>
      `🌞 Assalomu alaykum${name ? ', ' + name : ''}!\n\n✅ Siz allaqachon maxfiy guruhga kirish huquqini ochgansiz! 🎉\n📢 Yangiliklarni kanalimizdan kuzatib boring: https://t.me/${CHANNEL_USERNAME}`,
    referral_link_text: (link) => `🔗 Sizning referral havolangiz:\n${link}`,
    photo_caption: `
🔥🔥🔥 <b>Marifkon Jamoasining 3 KUNLIK BEPUL MARAFONI - Faqat O'smirlar Uchun!</b> 🔥🔥🔥

<b>Yoshingiz 12-18 oralig'idami? 3 kunda dasturlash, ingliz tili va matematika ko'nikmalarini oshiring!</b>

📚 Fanlar: Dasturlash • Ingliz tili • Matematika  
👥 Yoshlar: 12-18  
⏱️ Davomiyligi: 3 kun  
⏳ Qo'shilish muddati: 1-iyun, 2025

Telegramda kunlik darslar.

🔗 <b>Sizning referral havolangiz:</b>  
<a href="{link}">{link}</a>
    `,
  },
  en: {
    choose_lang: 'Please choose your language / Tilni tanlang:',
    joined_channel: `Please join our channel first to continue:\n\n📢 https://t.me/${CHANNEL_USERNAME}`,
    joined_channel_btn: '📢 Join Channel',
    check_sub_button: '✅ I Subscribed',
    not_subscribed: `❌ You still haven’t joined the channel.\n\n📢 https://t.me/${CHANNEL_USERNAME}`,
    help_text: `
🧠 <b>How to Use This Bot</b>:

1️⃣ Join our channel: https://t.me/${CHANNEL_USERNAME}
2️⃣ Send /start to get your <b>referral link</b>
3️⃣ Share it and invite <b>3 friends</b>
4️⃣ Unlock private group access with the button

💬 /myreferrals - Check how many you referred
💬 /language - Change language
`,
    need_more: (n) => `⛔ Invite ${n} more friend${n === 1 ? '' : 's'} to unlock the group.`,
    referrals_info: (count) => `👥 Your referrals: ${count}`,
    unlocked_access: `✅ You've unlocked access to the private group!\n👉 Join the group: ${GROUP_LINK}`,
    no_access_yet: `⛔ You don’t have access yet.`,
    congrats_access: `✅ Congratulations! You've unlocked the private group access.\n\n👉 <a href="${GROUP_LINK}">Join Group</a>`,
    language_changed: `Language changed successfully!`,
    daily_msg_locked: (name, needed, count) =>
      `🌞 Hello${name ? ', ' + name : ''}!\n\n⏳ You need ${needed} more referral${needed === 1 ? '' : 's'} to unlock the group.\n🎯 Your progress: ${count}/3 referrals\n📢 Check our channel for updates: https://t.me/${CHANNEL_USERNAME}\n🔗 Keep sharing your referral link!`,
    daily_msg_unlocked: (name) =>
      `🌞 Hello${name ? ', ' + name : ''}!\n\n✅ You've already unlocked access to the private group! 🎉\n📢 Check the channel for updates: https://t.me/${CHANNEL_USERNAME}`,
    referral_link_text: (link) => `🔗 Your referral link:\n${link}`,
    photo_caption: `
🔥🔥🔥 <b>3-DAY FREE MARATHON by Marifkon Team - Just for Teens!</b> 🔥🔥🔥

<b>Are you 12-18 years old? Want to boost your Programming, English, or Math skills in just 3 days?</b>

📚 Subjects: Programming • English • Math  
👥 For Ages: 12-18  
⏱️ Duration: 3 days  
⏳ Deadline to Join: June 1, 2025

Join our free marathon with daily lessons taught in Uzbek + English on Telegram.

🔗 <b>Your Referral Link:</b>  
<a href="{link}">{link}</a>
    `,
  },
};

// Helper to get user language safely
async function getUserLanguage(userId) {
  const user = await users.findOne({ id: userId });
  return user?.language || 'uz';
}

// Add or update user with language default to 'uz' if missing
async function addUser(id, referredBy = null, from = {}, language = 'uz') {
  id = String(id);
  if (referredBy) referredBy = String(referredBy);

  const updateObj = {
    $setOnInsert: {
      id,
      referrals: 0,
      rewarded: false,
      referredBy: referredBy && referredBy !== id ? referredBy : null,
      first_name: from.first_name || null,
      last_name: from.last_name || null,
      username: from.username || null,
      language,
    }
  };

  if (referredBy && referredBy !== id) {
    updateObj.$set = { referredBy };
  }

  await users.updateOne(
    { id },
    updateObj,
    { upsert: true }
  );
}

// Check if user is subscribed to the channel
async function isSubscribed(ctx) {
  try {
    const member = await ctx.telegram.getChatMember('@' + CHANNEL_USERNAME, ctx.from.id);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (err) {
    console.error('❌ Subscription check failed:', err);
    return false;
  }
}

// Refresh referral count and rewarded status
async function refreshReferralStatus(userId) {
  const count = await users.countDocuments({ referredBy: userId });
  const user = await users.findOne({ id: userId });

  if (!user.rewarded && count >= 3) {
    await users.updateOne({ id: userId }, { $set: { rewarded: true } });
  }

  return { referralCount: count, rewarded: user.rewarded || count >= 3 };
}

// Send referral status message with optional promo photo
async function sendReferralMessage(ctx, userId, showPromo = true) {
  const lang = await getUserLanguage(userId);
  const { referralCount, rewarded } = await refreshReferralStatus(userId);

  const username = bot.botInfo.username;
  const myLink = `https://t.me/${username}?start=${userId}`;
  const needed = Math.max(0, 3 - referralCount);

  if (showPromo) {
    const photoPath = path.resolve('./photo.png'); // Make sure the photo.png exists in your project root
    let caption = MESSAGES[lang].photo_caption.replace(/\{link\}/g, myLink);

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
      ]),
    });
  }

  let info = `${MESSAGES[lang].referrals_info(referralCount)}\n\n`;

  if (rewarded) {
    info += MESSAGES[lang].unlocked_access;
  } else {
    info += `${MESSAGES[lang].no_access_yet}\n${MESSAGES[lang].need_more(needed)}`;
  }

  await ctx.reply(info, { parse_mode: 'HTML' });
}

// Send language selection keyboard
async function sendLanguageSelection(ctx) {
  await ctx.reply(
    MESSAGES['uz'].choose_lang, // bilingual prompt is fine
    Markup.inlineKeyboard([
      [Markup.button.callback('🇺🇿 Oʻzbekcha', 'lang_uz')],
      [Markup.button.callback('🇬🇧 English', 'lang_en')]
    ])
  );
}

// Middleware to enforce channel subscription before main commands
bot.use(async (ctx, next) => {
  if (!ctx.from) return;
  const isSub = await isSubscribed(ctx);
  if (!isSub) {
    const lang = await getUserLanguage(String(ctx.from.id));
    return ctx.reply(
      MESSAGES[lang].joined_channel,
      Markup.inlineKeyboard([
        Markup.button.url(MESSAGES[lang].joined_channel_btn, `https://t.me/${CHANNEL_USERNAME}`),
        Markup.button.callback(MESSAGES[lang].check_sub_button, 'check_sub')
      ])
    );
  }
  return next();
});

// Start command
bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  let referredBy = null;

  if (ctx.startPayload) {
    referredBy = ctx.startPayload;
  }

  await addUser(userId, referredBy, ctx.from);

  const lang = await getUserLanguage(userId);
  const username = bot.botInfo.username;
  const referralLink = `https://t.me/${username}?start=${userId}`;

  await ctx.reply(
    `${MESSAGES[lang].help_text}\n\n${MESSAGES[lang].referral_link_text(referralLink)}`,
    { parse_mode: 'HTML' }
  );

  // Show promo photo and referral info
  await sendReferralMessage(ctx, userId, true);
});

// Language command
bot.command('language', async (ctx) => {
  await sendLanguageSelection(ctx);
});

// Language button callbacks
bot.action('lang_uz', async (ctx) => {
  const userId = String(ctx.from.id);
  await users.updateOne({ id: userId }, { $set: { language: 'uz' } });
  await ctx.answerCbQuery('Til o‘zgartirildi');
  await ctx.editMessageText(MESSAGES['uz'].language_changed);
});
bot.action('lang_en', async (ctx) => {
  const userId = String(ctx.from.id);
  await users.updateOne({ id: userId }, { $set: { language: 'en' } });
  await ctx.answerCbQuery('Language changed');
  await ctx.editMessageText(MESSAGES['en'].language_changed);
});

// Check subscription button
bot.action('check_sub', async (ctx) => {
  const isSub = await isSubscribed(ctx);
  const userId = String(ctx.from.id);
  const lang = await getUserLanguage(userId);

  if (isSub) {
    await ctx.answerCbQuery(MESSAGES[lang].congrats_access, { show_alert: true });
    // Send referral info
    await sendReferralMessage(ctx, userId, false);
  } else {
    await ctx.answerCbQuery(MESSAGES[lang].not_subscribed, { show_alert: true });
  }
});

// Referral info command
bot.command('myreferrals', async (ctx) => {
  const userId = String(ctx.from.id);
  const lang = await getUserLanguage(userId);
  const count = await users.countDocuments({ referredBy: userId });
  await ctx.reply(MESSAGES[lang].referrals_info(count));
});

// Reset referrals command
bot.command('resetreferrals', async (ctx) => {
  const userId = String(ctx.from.id);
  const lang = await getUserLanguage(userId);

  await users.updateOne({ id: userId }, { $set: { referrals: 0, rewarded: false } });

  await ctx.reply(lang === 'uz'
    ? '👥 Takliflaringiz qayta o‘rnatildi. Siz yana 3 do‘st taklif qilishingiz kerak.'
    : '👥 Your referrals have been reset. You need to invite 3 friends again.'
  );
});

// Stats command
bot.command('mystats', async (ctx) => {
  const userId = String(ctx.from.id);
  const lang = await getUserLanguage(userId);
  const user = await users.findOne({ id: userId });
  if (!user) return ctx.reply(lang === 'uz' ? 'Foydalanuvchi topilmadi.' : 'User not found.');

  const referralCount = await users.countDocuments({ referredBy: userId });
  const rewarded = user.rewarded || referralCount >= 3;

  const msg = lang === 'uz' 
    ? `👤 Sizning ma'lumotlaringiz:\n\n` +
      `📊 Takliflar soni: ${referralCount}\n` +
      `🔓 Guruhga kirish: ${rewarded ? 'Ha' : 'Yo‘q'}\n` +
      `🗣️ Til: ${user.language === 'uz' ? "O‘zbekcha" : "English"}`
    : `👤 Your stats:\n\n` +
      `📊 Referrals: ${referralCount}\n` +
      `🔓 Group Access: ${rewarded ? 'Yes' : 'No'}\n` +
      `🗣️ Language: ${user.language === 'uz' ? "O‘zbekcha" : "English"}`;

  await ctx.reply(msg);
});

// Leaderboard command
bot.command('leaderboard', async (ctx) => {
  const lang = await getUserLanguage(ctx.from.id);

  const pipeline = [
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
  ];

  const topRefs = await users.aggregate(pipeline).toArray();

  if (!topRefs.length) {
    return ctx.reply(lang === 'uz' ? 'Hozircha taklif qilganlar yo‘q.' : 'No referrals yet.');
  }

  let message = lang === 'uz' ? '🏆 Top 5 taklifchilar:\n\n' : '🏆 Top 5 referrers:\n\n';

  topRefs.forEach((entry, i) => {
    const user = entry.user_info[0];
    const name = user?.first_name || user?.username || 'Unknown';
    message += `${i + 1}. ${name}: ${entry.count}\n`;
  });

  await ctx.reply(message);
});

// Show user's referral link
bot.command('myreferral', async (ctx) => {
  const userId = String(ctx.from.id);
  const lang = await getUserLanguage(userId);
  const username = bot.botInfo.username;
  const link = `https://t.me/${username}?start=${userId}`;

  await ctx.reply(MESSAGES[lang].referral_link_text(link));
});

// Daily reminder message - runs at 9:00 AM server time
cron.schedule('0 9 * * *', async () => {
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
});

// Launch bot
(async () => {
  await startDB();
  // Uncomment if needed:
  // await migrateUsersAddLanguage();
  await bot.launch();
  console.log('🤖 Bot started');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
})();
