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

// Migration: update old users missing fields (language, referrals, rewarded, referredBy, etc)
async function migrateUsersFillMissing() {
  const cursor = users.find({
    $or: [
      { language: { $exists: false } },
      { first_name: { $exists: false } },
      { last_name: { $exists: false } },
      { username: { $exists: false } },
      { referrals: { $exists: false } },
      { rewarded: { $exists: false } },
      { referredBy: { $exists: false } },
    ],
  });

  let count = 0;
  while (await cursor.hasNext()) {
    const user = await cursor.next();

    await users.updateOne(
      { id: user.id },
      {
        $set: {
          language: user.language || 'uz',
          first_name: user.first_name || null,
          last_name: user.last_name || null,
          username: user.username || null,
          referrals: typeof user.referrals === 'number' ? user.referrals : 0,
          rewarded: typeof user.rewarded === 'boolean' ? user.rewarded : false,
          referredBy:
            user.referredBy && user.referredBy !== user.id ? user.referredBy : null,
        },
      }
    );
    count++;
  }
  console.log(`🛠️ Migration completed: updated ${count} users with missing fields.`);
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

  // Prepare fields to always update
  const updateFields = {
    first_name: from.first_name || null,
    last_name: from.last_name || null,
    username: from.username || null,
    language,
  };

  // Only set referredBy if it exists and is not equal to id
  if (referredBy && referredBy !== id) {
    updateFields.referredBy = referredBy;
  }

  // Upsert user with basic info and referredBy
  await users.updateOne(
    { id },
    {
      $set: updateFields,
      $setOnInsert: {
        id,
        referrals: 0,
        rewarded: false,
      },
    },
    { upsert: true }
  );

  // Now count how many users refer this user
  const referralCount = await users.countDocuments({ referredBy: id });

  // Update referrals count for this user
  await users.updateOne({ id }, { $set: { referrals: referralCount } });
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
      [Markup.button.callback('🇬🇧 English', 'lang_en')],
    ])
  );
}

// Bot commands and handlers

bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  const refId = ctx.startPayload || null;

  // Always create or update user first
  await addUser(userId, refId, ctx.from);

  const user = await users.findOne({ id: userId });

  // Ask for language selection if not set
  if (!user.language) {
    return await sendLanguageSelection(ctx);
  }

  const subscribed = await isSubscribed(ctx);
  if (!subscribed) {
    const lang = user.language || 'uz';
    return ctx.reply(
      MESSAGES[lang].joined_channel,
      Markup.inlineKeyboard([
        [Markup.button.url(MESSAGES[lang].joined_channel_btn, `https://t.me/${CHANNEL_USERNAME}`)],
        [Markup.button.callback(MESSAGES[lang].check_sub_button, 'check_subscription')],
      ])
    );
  }

  // Now show referral progress
  await sendReferralMessage(ctx, userId, true);
});


bot.action('check_subscription', async (ctx) => {
  try {
    const userId = String(ctx.from.id);
    const subscribed = await isSubscribed(ctx);

    const lang = await getUserLanguage(userId);

    if (subscribed) {
      await ctx.answerCbQuery('✅ You are subscribed!');
      await ctx.deleteMessage();
      await sendReferralMessage(ctx, userId, true);
    } else {
      await ctx.answerCbQuery('❌ You are not subscribed yet!');
      await ctx.reply(MESSAGES[lang].not_subscribed);
    }
  } catch (err) {
    console.error('Error in check_subscription action:', err);
    await ctx.answerCbQuery('Error occurred, try again.');
  }
});

bot.command('language', async (ctx) => {
  await sendLanguageSelection(ctx);
});

bot.command('help', async (ctx) => {
  const lang = await getUserLanguage(ctx.from.id);
  await ctx.reply(MESSAGES[lang].help_text, { parse_mode: 'HTML' });
});

bot.command('myreferrals', async (ctx) => {
  const userId = String(ctx.from.id);
  const lang = await getUserLanguage(userId);

  const count = await users.countDocuments({ referredBy: userId });
  await ctx.reply(MESSAGES[lang].referrals_info(count));
});

bot.action(/lang_(uz|en)/, async (ctx) => {
  try {
    const userId = String(ctx.from.id);
    const newLang = ctx.match[1];
    await users.updateOne({ id: userId }, { $set: { language: newLang } }, { upsert: true });
    await ctx.answerCbQuery(`Language changed to ${newLang === 'uz' ? 'O‘zbekcha' : 'English'}`);
    await ctx.deleteMessage();
    await ctx.reply(MESSAGES[newLang].language_changed);
  } catch (err) {
    console.error('Error in language change:', err);
    await ctx.answerCbQuery('Failed to change language.');
  }
});

cron.schedule('0 15 * * *', async () => {
  console.log('⏰ Sending daily messages...');

  const allUsers = await users.find({}).toArray();
  const username = bot.botInfo.username;

  for (const user of allUsers) {
    try {
      const lang = user.language || 'uz';
      const name = user.first_name || '';

      const referralCount = await users.countDocuments({ referredBy: user.id });
      const rewarded = user.rewarded || referralCount >= 3;

      const needed = Math.max(0, 3 - referralCount);
      const myLink = `https://t.me/${username}?start=${user.id}`;

      const message = rewarded
        ? MESSAGES[lang].daily_msg_unlocked(name)
        : MESSAGES[lang].daily_msg_locked(name, needed, referralCount);

      await bot.telegram.sendMessage(user.id, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

    } catch (err) {
      console.error(`❌ Failed to send message to user ${user.id}:`, err.message);
    }
  }

  console.log('✅ Daily messages sent!');
});

cron.schedule('0 5 * * *', async () => {
  console.log('⏰ Sending daily messages...');

  const allUsers = await users.find({}).toArray();
  const username = bot.botInfo.username;

  for (const user of allUsers) {
    try {
      const lang = user.language || 'uz';
      const name = user.first_name || '';

      const referralCount = await users.countDocuments({ referredBy: user.id });
      const rewarded = user.rewarded || referralCount >= 3;

      const needed = Math.max(0, 3 - referralCount);
      const myLink = `https://t.me/${username}?start=${user.id}`;

      const message = rewarded
        ? MESSAGES[lang].daily_msg_unlocked(name)
        : MESSAGES[lang].daily_msg_locked(name, needed, referralCount);

      await bot.telegram.sendMessage(user.id, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

    } catch (err) {
      console.error(`❌ Failed to send message to user ${user.id}:`, err.message);
    }
  }

  console.log('✅ Daily messages sent!');
});



// On any message, ensure user is added with default language and check subscription
bot.on('message', async (ctx) => {
  const userId = String(ctx.from.id);
  const user = await users.findOne({ id: userId });

  if (!user) {
    await addUser(userId, null, ctx.from, 'uz'); // default to Uzbek
  }

  // You can add other handlers or replies here if needed
});

// Start everything
(async () => {
  await startDB();
  
  // await migrateUsersAddLanguage(); // Uncomment if you want to run migration once
  // await migrateUsersFillMissing(); // <-- call migration here before launching bot
  
  bot.launch();
  console.log('🤖 Bot started');
})();

// Enable graceful stop
process.once('SIGINT', () => {
  bot.stop('SIGINT');
  client.close();
});
process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  client.close();
});
