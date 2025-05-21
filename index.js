import { Telegraf, Markup } from 'telegraf';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME;
const GROUP_LINK = process.env.PRIVATE_GROUP_LINK;
const MONGO_URI = process.env.MONGO_URI;

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

  const user = await users.findOne({ id });

  if (!user) {
    await users.insertOne({ id, referrals: 0, rewarded: false, referredBy });
  } else if (!user.referredBy && referredBy && referredBy !== id) {
    await users.updateOne({ id }, { $set: { referredBy } });
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

function getReferralMessage(userId, referralCount, rewarded) {
  const needed = Math.max(0, 3 - referralCount);
  const username = bot.botInfo.username;
  const myLink = `https://t.me/${username}?start=${userId}`;

  let message = `
<b>📣 Invite your friends to join Marifkon Marathon!</b>

🔗 <b>Your Referral Link:</b>
<a href="${myLink}">${myLink}</a>

👥 <b>Referrals:</b> ${referralCount}
🎯 <b>Need ${needed} more to unlock access</b>
  `;

  if (rewarded) {
    message += `\n\n✅ <b>You already have access!</b>`;
  }

  return message;
}

async function sendReferralMessage(ctx, userId) {
  const { referralCount, rewarded } = await refreshReferralStatus(userId);
  const message = getReferralMessage(userId, referralCount, rewarded);

  const buttons = rewarded
    ? [[Markup.button.url('👉 Join Group', GROUP_LINK)]]
    : [[Markup.button.url('👉 Participate', `https://t.me/${bot.botInfo.username}?start=${userId}`)]];

  await ctx.reply(message, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard(buttons),
  });
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
  await sendReferralMessage(ctx, userId);
});

bot.action('check_subscription', async (ctx) => {
  const userId = String(ctx.from.id);
  const subscribed = await isSubscribed(ctx);

  if (!subscribed) {
    return ctx.reply('❌ You still haven’t joined the channel.\n\n📢 https://t.me/' + CHANNEL_USERNAME);
  }

  await addUser(userId);
  await sendReferralMessage(ctx, userId);
});

bot.command('myreferrals', async (ctx) => {
  const userId = String(ctx.from.id);
  const user = await users.findOne({ id: userId });
  if (!user) return ctx.reply('❌ You are not registered yet. Send /start');

  await sendReferralMessage(ctx, userId);
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
