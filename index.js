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

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot is running');
});

app.listen(PORT, () => {
  console.log(`🌐 Express server listening on port ${PORT}`);
});

if (!BOT_TOKEN || !CHANNEL_USERNAME || !GROUP_LINK || !MONGO_URI) {
  console.error('Please set BOT_TOKEN, CHANNEL_USERNAME, PRIVATE_GROUP_LINK, and MONGO_URI in .env');
  process.exit(1);
}

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

function getText(lang, key) {
  const messages = {
    lang_prompt: {
      uz: "Iltimos, tilni tanlang:",
      en: "Please choose your language:"
    },
    join_channel: {
      uz: `Iltimos, davom etish uchun kanalga qo‘shiling:\n\n📢 https://t.me/${CHANNEL_USERNAME}`,
      en: `Please join our channel first to continue:\n\n📢 https://t.me/${CHANNEL_USERNAME}`
    },
    not_subscribed: {
      uz: "❌ Siz hali kanalga qo‘shilmadingiz.\n\n📢 https://t.me/" + CHANNEL_USERNAME,
      en: "❌ You still haven’t joined the channel.\n\n📢 https://t.me/" + CHANNEL_USERNAME
    },
    registered: {
      uz: "✅ Siz ro‘yxatdan o‘tdingiz!",
      en: "✅ You have been registered!"
    },
    referrals_needed: {
      uz: (needed) => `⛔ Siz hali kirish huquqiga ega emassiz.\n🎯 Yana ${needed} do‘stni taklif qiling!`,
      en: (needed) => `⛔ You don’t have access yet.\n🎯 Invite ${needed} more friend${needed === 1 ? '' : 's'} to unlock the group!`
    },
    unlocked_group: {
      uz: `✅ Siz maxfiy guruhga kirish huquqini oldingiz!\n👉 <a href="${GROUP_LINK}">Guruhga qo‘shilish</a>`,
      en: `✅ You've unlocked access to the private group!\n👉 <a href="${GROUP_LINK}">Join the Private Group</a>`
    }
  };
  return messages[key][lang];
}

async function isSubscribed(ctx) {
  try {
    const member = await ctx.telegram.getChatMember('@' + CHANNEL_USERNAME, ctx.from.id);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (err) {
    console.error('❌ Subscription check failed:', err);
    return false;
  }
}

async function addUser(id, referredBy = null, from = {}, lang = 'uz') {
  id = String(id);
  if (referredBy) referredBy = String(referredBy);

  await users.updateOne(
    { id },
    {
      $setOnInsert: {
        id,
        referrals: 0,
        rewarded: false,
        referredBy: referredBy && referredBy !== id ? referredBy : null,
        first_name: from.first_name || null,
        last_name: from.last_name || null,
        username: from.username || null,
        lang: lang
      },
      $set: referredBy && referredBy !== id ? { referredBy } : {}
    },
    { upsert: true }
  );
}

async function refreshReferralStatus(userId) {
  const count = await users.countDocuments({ referredBy: userId });
  const user = await users.findOne({ id: userId });

  if (!user.rewarded && count >= 3) {
    await users.updateOne({ id: userId }, { $set: { rewarded: true } });
  }

  return { referralCount: count, rewarded: user.rewarded || count >= 3 };
}

async function sendReferralMessage(ctx, userId, showPromo = true) {
  const { referralCount, rewarded } = await refreshReferralStatus(userId);
  const user = await users.findOne({ id: userId });
  const lang = user?.lang || 'uz';

  const username = bot.botInfo.username;
  const myLink = `https://t.me/${username}?start=${userId}`;
  const needed = Math.max(0, 3 - referralCount);

  if (showPromo) {
    const photoPath = path.resolve('./photo.png');
    const caption = lang === 'uz' ?
      `🔥🔥🔥 <b>Marifkon 3 kunlik BEPUL marafoni!</b> 🔥🔥🔥\n\n12-18 yoshdagi bolalar uchun dasturlash, ingliz tili va matematikani o‘rganing!\n\n📚 Fanlar: Dasturlash • Ingliz tili • Matematika\n⏱️ Davomiylik: 3 kun\n⏳ Oxirgi muddat: 1-iyun, 2025\n\n🔗 <b>Taklif havolangiz:</b>\n<a href="${myLink}">${myLink}</a>`
      :
      `🔥🔥🔥 <b>3-DAY FREE MARATHON by Marifkon!</b> 🔥🔥🔥\n\nFor 12-18 year olds: Boost your Programming, English, or Math!\n\n📚 Subjects: Programming • English • Math\n⏱️ Duration: 3 days\n⏳ Deadline: June 1, 2025\n\n🔗 <b>Your Referral Link:</b>\n<a href="${myLink}">${myLink}</a>`;

    await ctx.replyWithPhoto({ source: photoPath }, {
      caption,
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.url(rewarded ? (lang === 'uz' ? '👉 Guruhga qo‘shilish' : '👉 Join Group') : (lang === 'uz' ? '👉 Ishtirok etish' : '👉 Participate'), rewarded ? GROUP_LINK : myLink)]
      ]),
    });
  }

  let info = `👥 <b>${lang === 'uz' ? 'Sizning takliflaringiz' : 'Your Referrals'}:</b> ${referralCount}\n`;

  if (rewarded) {
    info += getText(lang, 'unlocked_group');
  } else {
    info += getText(lang, 'referrals_needed')(needed);
  }

  await ctx.reply(info, { parse_mode: 'HTML' });
}

bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  const refId = ctx.startPayload || null;

  const user = await users.findOne({ id: userId });
  if (!user) {
    return ctx.reply(getText('uz', 'lang_prompt'), Markup.inlineKeyboard([
      [Markup.button.callback('🇺🇿 O‘zbekcha', 'lang_uz'), Markup.button.callback('🇬🇧 English', 'lang_en')]
    ]));
  }

  const subscribed = await isSubscribed(ctx);
  if (!subscribed) {
    return ctx.reply(getText(user.lang || 'uz', 'join_channel'), Markup.inlineKeyboard([
      [Markup.button.url('📢 Join Channel', `https://t.me/${CHANNEL_USERNAME}`)],
      [Markup.button.callback('✅ I Subscribed', 'check_subscription')],
    ]));
  }

  await addUser(userId, refId, ctx.from, user.lang || 'uz');
  await sendReferralMessage(ctx, userId, true);
});

bot.action(['lang_uz', 'lang_en'], async (ctx) => {
  const lang = ctx.match[0].split('_')[1];
  const userId = String(ctx.from.id);
  const refId = ctx.startPayload || null;

  await addUser(userId, refId, ctx.from, lang);
  await ctx.reply(getText(lang, 'registered'));

  const subscribed = await isSubscribed(ctx);
  if (!subscribed) {
    return ctx.reply(getText(lang, 'join_channel'), Markup.inlineKeyboard([
      [Markup.button.url('📢 Join Channel', `https://t.me/${CHANNEL_USERNAME}`)],
      [Markup.button.callback('✅ I Subscribed', 'check_subscription')],
    ]));
  }

  await sendReferralMessage(ctx, userId, true);
});

bot.command('language', async (ctx) => {
  await ctx.reply('🌐 Choose your language / Tilni tanlang:', Markup.inlineKeyboard([
    [Markup.button.callback('🇺🇿 O‘zbekcha', 'lang_uz'), Markup.button.callback('🇬🇧 English', 'lang_en')]
  ]));
});
