
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionsBitField,
  MessageFlags
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

// ==================== إعدادات البوت ====================

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || "";
const RANKUP_IMAGE_URL = process.env.RANKUP_IMAGE_URL || "";

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ أضف TOKEN و CLIENT_ID في Variables.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction
  ]
});

// ==================== حفظ البيانات ====================

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "levels.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, "{}");
}

let db = {};

try {
  db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch {
  console.error("تعذر قراءة levels.json");
  db = {};
}

function saveDB() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function getGuild(guildId) {
  if (!db[guildId]) {
    db[guildId] = {
      channelId: null,
      users: {}
    };
  }

  if (!db[guildId].users) {
    db[guildId].users = {};
  }

  return db[guildId];
}

function getUser(guildId, userId) {
  const guild = getGuild(guildId);

  if (!guild.users[userId]) {
    guild.users[userId] = {
      xp: 0,
      level: 0
    };
  }

  return guild.users[userId];
}

// المستوى التالي يحتاج XP حسب المعادلة.
function requiredXP(level) {
  return (level + 1) * (level + 1) * 100;
}

function calculateLevel(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100));
}

// ==================== إعلان الترقية ====================

async function announceLevelUp(guild, user, level) {
  const config = getGuild(guild.id);

  if (!config.channelId) return;

  const channel = guild.channels.cache.get(config.channelId);
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0x7C3AED)
    .setTitle("🔮 لفل جديد!")
    .setDescription(
      `مبروك! لقد وصلت إلى لفل جديد\n\n` +
      `**العضو:** ${user}\n\n` +
      `🔮 **اللفل الجديد**\n\n` +
      `# ${level}`
    )
    .setFooter({ text: "Silfer Level" })
    .setTimestamp();

  if (RANKUP_IMAGE_URL) {
    embed.setImage(RANKUP_IMAGE_URL);
  }

  try {
    await channel.send({
      content: `🎉 مبروك ${user}!`,
      embeds: [embed],
      allowedMentions: {
        users: [user.id]
      }
    });
  } catch (error) {
    console.error("تعذر إرسال إعلان الترقية:", error.message);
  }
}

// ==================== إضافة XP ====================

// لكل عضو فترة انتظار مستقلة لكل نوع نشاط.
const cooldowns = new Map();
const MESSAGE_COOLDOWN = 60_000;
const REACTION_COOLDOWN = 30_000;

async function addXP(guild, user, amount, type) {
  if (!guild || !user || user.bot) return;

  const key = `${guild.id}:${user.id}:${type}`;
  const now = Date.now();
  const cooldown = type === "message"
    ? MESSAGE_COOLDOWN
    : REACTION_COOLDOWN;

  const lastTime = cooldowns.get(key) || 0;

  if (now - lastTime < cooldown) return;

  cooldowns.set(key, now);

  const data = getUser(guild.id, user.id);
  const oldLevel = calculateLevel(data.xp);

  data.xp += amount;
  data.level = calculateLevel(data.xp);

  saveDB();

  if (data.level > oldLevel) {
    await announceLevelUp(guild, user, data.level);
  }
}

// ==================== XP من الرسائل ====================

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;
  if (!message.content.trim()) return;
  if (message.content.startsWith("!")) return;

  // من 10 إلى 20 XP لكل رسالة مؤهلة.
  const xp = Math.floor(Math.random() * 11) + 10;

  await addXP(message.guild, message.author, xp, "message");
});

// ==================== XP من التفاعلات ====================

client.on("messageReactionAdd", async (reaction, user) => {
  try {
    if (user.bot) return;

    if (reaction.partial) {
      await reaction.fetch();
    }

    if (reaction.message.partial) {
      await reaction.message.fetch();
    }

    const message = reaction.message;

    if (!message.guild) return;
    if (!message.author || message.author.bot) return;

    // لا يحصل صاحب الرسالة على XP من التفاعل على رسالته.
    if (message.author.id === user.id) return;

    // 5 XP لكل تفاعل مؤهل، مع فترة انتظار.
    await addXP(message.guild, user, 5, "reaction");
  } catch (error) {
    console.error("خطأ في احتساب التفاعل:", error.message);
  }
});

// ==================== أوامر Slash ====================

const commands = [
  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("عرض مستواك أو مستوى عضو")
    .addUserOption(option =>
      option
        .setName("member")
        .setDescription("العضو المطلوب")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("عرض أعلى الأعضاء بالمستويات"),

  new SlashCommandBuilder()
    .setName("setlevelchannel")
    .setDescription("تحديد روم إعلانات الترقية")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("روم إعلانات الترقية")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionsBitField.Flags.Administrator
    )
].map(command => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  if (GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("تم تسجيل الأوامر في السيرفر.");
  } else {
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log("تم تسجيل الأوامر العامة.");
  }
}

// ==================== تنفيذ الأوامر ====================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) {
    return interaction.reply({
      content: "استخدم الأمر داخل السيرفر.",
      flags: MessageFlags.Ephemeral
    });
  }

  const guild = interaction.guild;
  const config = getGuild(guild.id);

  if (interaction.commandName === "setlevelchannel") {
    if (!interaction.memberPermissions?.has(
      PermissionsBitField.Flags.Administrator
    )) {
      return interaction.reply({
        content: "هذا الأمر للإدارة فقط.",
        flags: MessageFlags.Ephemeral
      });
    }

    const channel = interaction.options.getChannel("channel", true);

    if (!channel.isTextBased() || !channel.guild) {
      return interaction.reply({
        content: "اختر رومًا نصيًا داخل السيرفر.",
        flags: MessageFlags.Ephemeral
      });
    }

    config.channelId = channel.id;
    saveDB();

    return interaction.reply({
      content: `✅ تم تعيين ${channel} لإعلانات الترقية.`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.commandName === "rank") {
    const target =
      interaction.options.getUser("member") || interaction.user;

    const data = getUser(guild.id, target.id);
    const level = calculateLevel(data.xp);
    const needed = requiredXP(level);
    const previous = level * level * 100;
    const progress = Math.max(0, data.xp - previous);
    const neededProgress = needed - previous;
    const percent = Math.min(
      100,
      Math.floor(progress / neededProgress * 100)
    );

    const embed = new EmbedBuilder()
      .setColor(0x7C3AED)
      .setTitle("🔮 بطاقة المستوى")
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        `**العضو:** ${target}\n` +
        `**المستوى:** ${level}\n` +
        `**XP:** ${data.xp}\n\n` +
        `**التقدم للمستوى التالي**\n` +
        `${"🟪".repeat(Math.floor(percent / 10))}` +
        `${"⬛".repeat(10 - Math.floor(percent / 10))} ${percent}%\n` +
        `${progress} / ${neededProgress} XP`
      )
      .setFooter({ text: "Silfer Level" })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === "leaderboard") {
    const users = Object.entries(config.users)
      .map(([id, data]) => ({
        id,
        xp: data.xp || 0,
        level: calculateLevel(data.xp || 0)
      }))
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 10);

    if (!users.length) {
      return interaction.reply("لا توجد مستويات مسجلة حتى الآن.");
    }

    const lines = await Promise.all(
      users.map(async (entry, index) => {
        let name = `<@${entry.id}>`;

        try {
          const member = await guild.members.fetch(entry.id);
          name = member.user.username;
        } catch {}

        return `**${index + 1}.** ${name} — لفل **${entry.level}** · ${entry.xp} XP`;
      })
    );

    const embed = new EmbedBuilder()
      .setColor(0x7C3AED)
      .setTitle("🏆 أفضل 10 أعضاء")
      .setDescription(lines.join("\n"))
      .setFooter({ text: "Silfer Level" })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }
});

// ==================== تشغيل البوت ====================

client.once("ready", async () => {
  console.log(`✅ Silfer Level يعمل باسم ${client.user.tag}`);

  client.user.setPresence({
    activities: [{ name: "🔮 Leveling Members" }],
    status: "online"
  });

  try {
    await registerCommands();
  } catch (error) {
    console.error("تعذر تسجيل الأوامر:", error);
  }
});

client.on("error", error => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

client.login(TOKEN);
