import { Telegraf, Markup } from 'telegraf';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';

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

async function isSubscribed(ctx) {
  try {
    const member = await ctx.telegram.getChatMember('@' + CHANNEL_USERNAME, ctx.from.id);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (err) {
    console.error('❌ Subscription check failed:', err);
    return false;
  }
}

async function addUser(id, referredBy = null) {
  id = String(id);
  if (referredBy) referredBy = String(referredBy);

  // Update or insert user atomically
  await users.updateOne(
    { id },
    {
      $setOnInsert: {
        id,
        referrals: 0,
        rewarded: false,
        referredBy: referredBy && referredBy !== id ? referredBy : null
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

  const username = bot.botInfo.username;
  const myLink = `https://t.me/${username}?start=${userId}`;
  const needed = Math.max(0, 3 - referralCount);

  if (showPromo) {
    const photoPath = path.resolve('./photo.png'); // local file path

    const caption = `
🔥🔥🔥 <b>3-DAY FREE MARATHON by Marifkon Team - Just for Teens!</b> 🔥🔥🔥

<b>Are you 12-18 years old? Want to boost your Programming, English, or Math skills in just 3 days?</b>

📚 Subjects: Programming • English • Math
👥 For Ages: 12-18
⏱️ Duration: 3 days
⏳Deadline to Join: June 1, 2025

Join our free marathon with daily lessons taught in Uzbek + English on Telegram.

🔗 <b>Your Referral Link:</b>
<a href="${myLink}">${myLink}</a>
    `;

    await ctx.replyWithPhoto({ source: photoPath }, {
      caption,
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.url(rewarded ? '👉 Join Group' : '👉 Participate', rewarded ? GROUP_LINK : myLink)]
      ]),
    });
  }

  let info = `👥 <b>Your Referrals:</b> ${referralCount}\n`;
  if (!rewarded) {
    info += `🎯 <b>Invite ${needed} more friend${needed === 1 ? '' : 's'} to unlock access!</b>`;
  } else {
    info += `✅ <b>You already have access to the private group!</b>`;
  }

  await ctx.reply(info, { parse_mode: 'HTML' });
}

bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  const refId = ctx.startPayload || null;

  const subscribed = await isSubscribed(ctx);
  if (!subscribed) {
    return ctx.reply(
      `Please join our channel first to continue:\n\n📢 https://t.me/${CHANNEL_USERNAME}`,
      Markup.inlineKeyboard([
        [Markup.button.url('📢 Join Channel', `https://t.me/${CHANNEL_USERNAME}`)],
        [Markup.button.callback('✅ I Subscribed', 'check_subscription')],
      ])
    );
  }

  await addUser(userId, refId);
  await sendReferralMessage(ctx, userId, true);
});

bot.action('check_subscription', async (ctx) => {
  const userId = String(ctx.from.id);
  const subscribed = await isSubscribed(ctx);

  if (!subscribed) {
    return ctx.reply('❌ You still haven’t joined the channel.\n\n📢 https://t.me/' + CHANNEL_USERNAME);
  }

  await addUser(userId);
  await sendReferralMessage(ctx, userId, true);
});

bot.command('myreferrals', async (ctx) => {
  const userId = String(ctx.from.id);
  const user = await users.findOne({ id: userId });
  if (!user) return ctx.reply('❌ You are not registered yet. Send /start');

  const { referralCount, rewarded } = await refreshReferralStatus(userId);
  const needed = Math.max(0, 3 - referralCount);

  let message = `👥 <b>Your Referrals:</b> ${referralCount}\n`;

  if (rewarded) {
    message += `✅ <b>You already have access to the private group!</b>\n\n👉 <a href="${GROUP_LINK}">Click here to join</a>`;
  } else {
    message += `🎯 <b>Invite ${needed} more friend${needed === 1 ? '' : 's'} to unlock access!</b>`;
  }

  await ctx.reply(message, { parse_mode: 'HTML' });
});

bot.command('help', async (ctx) => {
  await ctx.reply(`
🧠 <b>How to Use This Bot</b>:

1️⃣ Join our channel: https://t.me/${CHANNEL_USERNAME}
2️⃣ Send /start to get your <b>referral link</b>
3️⃣ Share it and invite <b>3 friends</b>
4️⃣ Unlock private group access with the button

💬 /myreferrals - Check how many you referred
`, { parse_mode: 'HTML' });
});

bot.action('get_access_link', async (ctx) => {
  const userId = String(ctx.from.id);
  const { referralCount, rewarded } = await refreshReferralStatus(userId);

  if (!rewarded) {
    const needed = 3 - referralCount;
    return ctx.reply(`⛔ You need ${needed} more referral${needed === 1 ? '' : 's'} to access the group.`);
  }

  return ctx.reply(
    `✅ Congratulations! You've unlocked the private group access.\n\n👉 <a href="${GROUP_LINK}">Join Group</a>`,
    { parse_mode: 'HTML' }
  );
});

(async () => {
  try {
    await startDB();
    await bot.launch();
    console.log('🤖 Bot is running with secure referral system!');
  } catch (err) {
    console.error('❌ Failed to start bot:', err);
  }
})();

process.once('SIGINT', () => {
  console.log('Stopping bot...');
  bot.stop('SIGINT');
  client.close();
});
process.once('SIGTERM', () => {
  console.log('Stopping bot...');
  bot.stop('SIGTERM');
  client.close();
});
