import { Telegraf } from 'telegraf';
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

let users; // MongoDB collection

async function startDB() {
  await client.connect();
  const db = client.db('marifkon');
  users = db.collection('users');
  // Create unique index on id field for faster queries and no duplicates
  await users.createIndex({ id: 1 }, { unique: true });
  console.log('🗄️ Connected to MongoDB');
}

async function isSubscribed(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(CHANNEL_USERNAME, ctx.from.id);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch {
    return false;
  }
}

// Add or update user in DB, increment referral count for referrer
async function addUser(id, referredBy = null) {
  const user = await users.findOne({ id });
  if (!user) {
    await users.insertOne({ id, referrals: 0, rewarded: false, referredBy });
    if (referredBy && referredBy !== id) {
      await users.updateOne({ id: referredBy }, { $inc: { referrals: 1 } });
    }
  }
}

// Get user data from DB
async function getUser(id) {
  return await users.findOne({ id });
}

bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  const refId = ctx.startPayload || null;

  const subscribed = await isSubscribed(ctx);
  if (!subscribed) {
    return ctx.reply(`Please join our channel first:\n👉 ${CHANNEL_USERNAME}`);
  }

  await addUser(userId, refId);

  const user = await getUser(userId);

  const referralCount = user.referrals || 0;
  const needed = Math.max(0, 3 - referralCount);
  const myLink = `https://t.me/${ctx.me}?start=${userId}`;

  let message = `
👋 Welcome to *Marifkon Marathon*!

🔗 Your referral link:
${myLink}

📊 You have invited: *${referralCount}* friend(s).
🎯 Invite *${needed}* more to unlock access to the private group.
`;

  if (referralCount >= 3 && !user.rewarded) {
    await users.updateOne({ id: userId }, { $set: { rewarded: true } });
    message += `\n✅ MashaAllah! You unlocked the lessons group:\n👉 ${GROUP_LINK}`;
  } else if (user.rewarded) {
    message += `\n✅ You already have access:\n👉 ${GROUP_LINK}`;
  }

  await ctx.reply(message, { parse_mode: 'Markdown' });
});

bot.command('myreferrals', async (ctx) => {
  const userId = String(ctx.from.id);
  const user = await getUser(userId);

  if (!user) return ctx.reply('❌ You are not registered yet. Send /start');

  const referralCount = user.referrals || 0;
  const needed = Math.max(0, 3 - referralCount);
  const myLink = `https://t.me/${ctx.me}?start=${userId}`;

  let message = `
🔗 Your referral link:
${myLink}

📊 Invited: *${referralCount}*
🎯 Need *${needed}* more to unlock access
`;

  if (user.rewarded) {
    message += `\n✅ You already have access:\n👉 ${GROUP_LINK}`;
  }

  await ctx.reply(message, { parse_mode: 'Markdown' });
});

// Start bot & connect DB
(async () => {
  try {
    await startDB();
    await bot.launch();
    console.log('🤖 Bot is running with MongoDB referral system!');
  } catch (err) {
    console.error('Failed to start bot:', err);
  }
})();

// Graceful stop
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
