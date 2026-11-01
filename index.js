
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// ==============================
// الإعدادات
// ==============================

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || "";

const COLOR = 0x808080;
const FOOTER = "MAIN VOICE • mian";

if (!TOKEN || !CLIENT_ID) {
  console.log("❌ ضع TOKEN و CLIENT_ID في متغيرات الاستضافة");
  process.exit(1);
}

// ==============================
// قاعدة البيانات
// ==============================

const dataFolder = path.join(__dirname, "data");
const dataFile = path.join(dataFolder, "voice.json");

if (!fs.existsSync(dataFolder)) {
  fs.mkdirSync(dataFolder, { recursive: true });
}

if (!fs.existsSync(dataFile)) {
  fs.writeFileSync(
    dataFile,
    JSON.stringify({
      lobbyId: null,
      panelChannelId: null,
      panelMessageId: null,
      rooms: {}
    }, null, 2)
  );
}

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch {
    return {
      lobbyId: null,
      panelChannelId: null,
      panelMessageId: null,
      rooms: {}
    };
  }
}

let config = loadData();

function saveData() {
  fs.writeFileSync(dataFile, JSON.stringify(config, null, 2));
}

// ==============================
// البوت
// ==============================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ==============================
// أدوات مساعدة
// ==============================

function makeEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: FOOTER })
    .setTimestamp();
}

function success(message) {
  return {
    embeds: [makeEmbed("✅ تمت العملية", message)],
    ephemeral: true
  };
}

function error(message) {
  return {
    embeds: [makeEmbed("❌ حدث خطأ", message)],
    ephemeral: true
  };
}

async function getMember(guild, userId) {
  return guild.members.fetch(userId);
}

function isAdmin(member) {
  return member.permissions.has(
    PermissionsBitField.Flags.Administrator
  );
}

async function getRoom(roomId, guild) {
  const room = config.rooms[roomId];

  if (!room) return null;

  const channel =
    guild.channels.cache.get(roomId) ||
    await guild.channels.fetch(roomId).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildVoice) {
    delete config.rooms[roomId];
    saveData();
    return null;
  }

  return { room, channel };
}

async function canManageRoom(interaction, roomId) {
  const guild = interaction.guild;
  if (!guild) return false;

  const member = await getMember(guild, interaction.user.id);
  const result = await getRoom(roomId, guild);

  if (!result) return false;

  const { room, channel } = result;

  const isOwner = room.ownerId === interaction.user.id;
  const admin = isAdmin(member);

  if (!isOwner && !admin) return false;

  if (!admin && member.voice.channelId !== channel.id) {
    return false;
  }

  return true;
}

async function replyError(interaction, message) {
  const payload = error(message);

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

async function updateOwnerPermissions(channel, ownerId) {
  await channel.permissionOverwrites.edit(ownerId, {
    ViewChannel: true,
    Connect: true
  }).catch(() => {});
}

// ==============================
// لوحة التحكم
// ==============================

function mainPanelEmbed() {
  return makeEmbed(
    "🎙️ MAIN VOICE",
    [
      "مرحباً بك في نظام الرومات الصوتية المؤقتة.",
      "",
      "**طريقة الاستخدام:**",
      "1. ادخل روم الانتظار.",
      "2. سيتم إنشاء روم خاص بك تلقائياً.",
      "3. استخدم لوحة التحكم لإدارة رومك.",
      "",
      "**المميزات:**",
      "• إنشاء رومات تلقائية.",
      "• تغيير اسم الروم.",
      "• تحديد عدد الأعضاء.",
      "• قفل وفتح الروم.",
      "• إخفاء وإظهار الروم.",
      "• طرد الأعضاء ونقل الملكية.",
      "• حذف الروم تلقائياً عند خلوه.",
      "",
      "اضغط الزر بالأسفل لفتح لوحة التحكم."
    ].join("\n")
  );
}

function mainPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("voice_manage")
      .setLabel("لوحة التحكم")
      .setEmoji("🎛️")
      .setStyle(ButtonStyle.Secondary)
  );
}

function roomPanelEmbed(channel, room) {
  const locked = channel.permissionOverwrites.cache.get(
    channel.guild.id
  )?.deny.has(PermissionsBitField.Flags.Connect);

  const hidden = channel.permissionOverwrites.cache.get(
    channel.guild.id
  )?.deny.has(PermissionsBitField.Flags.ViewChannel);

  const owner = channel.guild.members.cache.get(room.ownerId);

  const limit = channel.userLimit === 0
    ? "مفتوح"
    : channel.userLimit;

  return makeEmbed(
    "🎛️ لوحة التحكم الصوتية",
    [
      `**اسم الروم:** ${channel.name}`,
      `**المالك:** ${owner ? owner.user.tag : room.ownerId}`,
      `**عدد الموجودين:** ${channel.members.size}`,
      `**الحد الأقصى:** ${limit}`,
      "",
      `**حالة الروم:** ${locked ? "🔒 مقفل" : "🔓 مفتوح"}`,
      `**الظهور:** ${hidden ? "🙈 مخفي" : "👁️ ظاهر"}`,
      "",
      "اختر العملية التي تريد تنفيذها من الأزرار."
    ].join("\n")
  );
}

function roomPanelRows(roomId, channel) {
  const locked = channel.permissionOverwrites.cache.get(
    channel.guild.id
  )?.deny.has(PermissionsBitField.Flags.Connect);

  const hidden = channel.permissionOverwrites.cache.get(
    channel.guild.id
  )?.deny.has(PermissionsBitField.Flags.ViewChannel);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vr_rename:${roomId}`)
      .setLabel("تغيير الاسم")
      .setEmoji("✏️")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`vr_limit:${roomId}`)
      .setLabel("تحديد العدد")
      .setEmoji("👥")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`vr_lock:${roomId}`)
      .setLabel(locked ? "فتح الروم" : "قفل الروم")
      .setEmoji(locked ? "🔓" : "🔒")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`vr_hide:${roomId}`)
      .setLabel(hidden ? "إظهار الروم" : "إخفاء الروم")
      .setEmoji(hidden ? "👁️" : "🙈")
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vr_kick:${roomId}`)
      .setLabel("طرد عضو")
      .setEmoji("👢")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`vr_transfer:${roomId}`)
      .setLabel("نقل الملكية")
      .setEmoji("👑")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`vr_delete:${roomId}`)
      .setLabel("حذف الروم")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2];
}

// ==============================
// إنشاء الروم
// ==============================

async function createRoom(member, lobby) {
  const guild = member.guild;

  // منع إنشاء أكثر من روم للمالك
  const existing = Object.entries(config.rooms).find(
    ([id, room]) => room.ownerId === member.id &&
      guild.channels.cache.has(id)
  );

  if (existing) {
    const existingChannel = guild.channels.cache.get(existing[0]);

    if (existingChannel) {
      await member.voice.setChannel(existingChannel).catch(() => {});
      return;
    }
  }

  const options = {
    name: `🎙️ ${member.user.username}`,
    type: ChannelType.GuildVoice,
    permissionOverwrites: [
      {
        id: guild.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Connect
        ]
      },
      {
        id: member.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Connect
        ]
      }
    ]
  };

  if (lobby.parentId) {
    options.parent = lobby.parentId;
  }

  const channel = await guild.channels.create(options);

  config.rooms[channel.id] = {
    ownerId: member.id,
    createdAt: Date.now()
  };

  saveData();

  await member.voice.setChannel(channel).catch(async () => {
    await channel.delete().catch(() => {});
    delete config.rooms[channel.id];
    saveData();
  });
}

// ==============================
// حذف الروم
// ==============================

async function deleteRoom(channel) {
  delete config.rooms[channel.id];
  saveData();

  await channel.delete().catch(() => {});
}

// ==============================
// تحديث ملكية الروم
// ==============================

async function transferOwner(channel, newOwnerId) {
  const room = config.rooms[channel.id];
  if (!room) return;

  room.ownerId = newOwnerId;
  saveData();

  await updateOwnerPermissions(channel, newOwnerId);
}

// ==============================
// أوامر السلاش
// ==============================

const commands = [
  new SlashCommandBuilder()
    .setName("voice-lobby")
    .setDescription("تحديد روم الانتظار")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("روم الانتظار الصوتي")
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionsBitField.Flags.Administrator
    ),

  new SlashCommandBuilder()
    .setName("voice-panel")
    .setDescription("إنشاء لوحة التحكم")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("الروم النصي للوحة")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionsBitField.Flags.Administrator
    ),

  new SlashCommandBuilder()
    .setName("voice-status")
    .setDescription("عرض إعدادات البوت")
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
  } else {
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
  }

  console.log("✅ تم تسجيل الأوامر");
}

// ==============================
// تشغيل البوت
// ==============================

client.once("ready", async () => {
  console.log(`✅ ${client.user.tag} is online`);

  client.user.setPresence({
    activities: [
      {
        name: "MAIN VOICE • mian",
        type: 3
      }
    ],
    status: "online"
  });

  try {
    await registerCommands();
  } catch (err) {
    console.error("Command registration error:", err);
  }

  // تنظيف الرومات المحذوفة من قاعدة البيانات
  for (const roomId of Object.keys(config.rooms)) {
    const channel = await client.channels.fetch(roomId).catch(() => null);

    if (!channel) {
      delete config.rooms[roomId];
    }
  }

  saveData();
});

// ==============================
// نظام دخول روم الانتظار
// ==============================

client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    if (
      newState.channelId &&
      newState.channelId === config.lobbyId &&
      oldState.channelId !== newState.channelId
    ) {
      const member = newState.member;
      const lobby = newState.channel;

      if (member && lobby) {
        await createRoom(member, lobby);
      }
    }

    // إذا خرج عضو من روم مؤقت
    if (oldState.channelId && config.rooms[oldState.channelId]) {
      const channel = oldState.channel;

      if (!channel) return;

      // حذف الروم إذا أصبح فارغاً
      if (channel.members.size === 0) {
        await deleteRoom(channel);
        return;
      }

      const room = config.rooms[channel.id];

      // نقل الملكية إذا خرج المالك وبقي أعضاء
      if (room && oldState.id === room.ownerId) {
        const nextOwner = channel.members.first();

        if (nextOwner) {
          await transferOwner(channel, nextOwner.id);
        }
      }
    }
  } catch (err) {
    console.error("Voice system error:", err);
  }
});

// ==============================
// التفاعلات
// ==============================

client.on("interactionCreate", async interaction => {
  try {

    // --------------------------
    // أوامر السلاش
    // --------------------------

    if (interaction.isChatInputCommand()) {
      if (!interaction.guild) return;

      if (interaction.commandName === "voice-lobby") {
        const channel = interaction.options.getChannel("channel");

        config.lobbyId = channel.id;
        saveData();

        return interaction.reply(
          success(`تم تحديد روم الانتظار: ${channel}`)
        );
      }

      if (interaction.commandName === "voice-panel") {
        const channel = interaction.options.getChannel("channel");

        config.panelChannelId = channel.id;

        let message = null;

        if (config.panelMessageId) {
          message = await channel.messages.fetch(
            config.panelMessageId
          ).catch(() => null);
        }

        if (message) {
          await message.edit({
            embeds: [mainPanelEmbed()],
            components: [mainPanelRow()]
          });
        } else {
          message = await channel.send({
            embeds: [mainPanelEmbed()],
            components: [mainPanelRow()]
          });
        }

        config.panelMessageId = message.id;
        saveData();

        return interaction.reply(
          success(`تم نشر لوحة التحكم في ${channel}`)
        );
      }

      if (interaction.commandName === "voice-status") {
        const lobby = config.lobbyId
          ? `<#${config.lobbyId}>`
          : "غير محدد";

        const panel = config.panelChannelId
          ? `<#${config.panelChannelId}>`
          : "غير محدد";

        const embed = makeEmbed(
          "⚙️ إعدادات MAIN VOICE",
          [
            `**روم الانتظار:** ${lobby}`,
            `**لوحة التحكم:** ${panel}`,
            `**عدد الرومات المؤقتة:** ${Object.keys(config.rooms).length}`,
            "",
            `**اسم السيرفر:** mian`,
            "**اسم البوت:** Main Voice"
          ].join("\n")
        );

        return interaction.reply({
          embeds: [embed],
          ephemeral: true
        });
      }
    }

    // --------------------------
    // زر لوحة التحكم الرئيسية
    // --------------------------

    if (interaction.isButton() && interaction.customId === "voice_manage") {
      const member = await getMember(
        interaction.guild,
        interaction.user.id
      );

      const roomId = member.voice.channelId;

      if (!roomId || !config.rooms[roomId]) {
        return interaction.reply(
          error("يجب أن تكون داخل رومك الصوتي المؤقت أولاً.")
        );
      }

      const room = await getRoom(roomId, interaction.guild);

      if (!room) {
        return interaction.reply(error("الروم غير موجود."));
      }

      const admin = isAdmin(member);
      const owner = room.room.ownerId === member.id;

      if (!owner && !admin) {
        return interaction.reply(
          error("هذه اللوحة مخصصة لمالك الروم أو الإدارة.")
        );
      }

      return interaction.reply({
        embeds: [roomPanelEmbed(room.channel, room.room)],
        components: roomPanelRows(roomId, room.channel),
        ephemeral: true
      });
    }

    // --------------------------
    // أزرار الرومات
    // --------------------------

    if (interaction.isButton() && interaction.customId.startsWith("vr_")) {
      const [action, roomId] = interaction.customId.split(":");

      if (!await canManageRoom(interaction, roomId)) {
        return interaction.reply(
          error("لا تملك صلاحية التحكم بهذا الروم، أو أنك لست داخله.")
        );
      }

      const result = await getRoom(roomId, interaction.guild);

      if (!result) {
        return interaction.reply(error("الروم غير موجود."));
      }

      const { channel } = result;

      // تغيير الاسم
      if (action === "vr_rename") {
        const modal = new ModalBuilder()
          .setCustomId(`voice_rename:${roomId}`)
          .setTitle("تغيير اسم الروم");

        const input = new TextInputBuilder()
          .setCustomId("room_name")
          .setLabel("الاسم الجديد")
          .setPlaceholder("اكتب اسم الروم")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(90)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(input)
        );

        return interaction.showModal(modal);
      }

      // تحديد العدد
      if (action === "vr_limit") {
        const modal = new ModalBuilder()
          .setCustomId(`voice_limit:${roomId}`)
          .setTitle("تحديد عدد الأعضاء");

        const input = new TextInputBuilder()
          .setCustomId("room_limit")
          .setLabel("العدد من 0 إلى 99")
          .setPlaceholder("0 = بدون حد")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(2)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(input)
        );

        return interaction.showModal(modal);
      }

      // قفل وفتح
      if (action === "vr_lock") {
        const everyone = channel.guild.id;

        const locked = channel.permissionOverwrites.cache.get(everyone)
          ?.deny.has(PermissionsBitField.Flags.Connect);

        await channel.permissionOverwrites.edit(everyone, {
          Connect: locked ? null : false
        });

        await channel.permissionOverwrites.edit(
          result.room.ownerId,
          { Connect: true, ViewChannel: true }
        );

        return interaction.reply(
          success(locked ? "تم فتح الروم للجميع." : "تم قفل الروم.")
        );
      }

      // إخفاء وإظهار
      if (action === "vr_hide") {
        const everyone = channel.guild.id;

        const hidden = channel.permissionOverwrites.cache.get(everyone)
          ?.deny.has(PermissionsBitField.Flags.ViewChannel);

        await channel.permissionOverwrites.edit(everyone, {
          ViewChannel: hidden ? null : false
        });

        await channel.permissionOverwrites.edit(
          result.room.ownerId,
          { ViewChannel: true, Connect: true }
        );

        return interaction.reply(
          success(hidden ? "تم إظهار الروم." : "تم إخفاء الروم.")
        );
      }

      // طرد عضو
      if (action === "vr_kick") {
        const members = channel.members.filter(
          member => member.id !== result.room.ownerId
        );

        if (members.size === 0) {
          return interaction.reply(error("لا يوجد أعضاء لطردهم."));
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId(`voice_kick:${roomId}`)
          .setPlaceholder("اختر العضو")
          .addOptions(
            [...members.values()].slice(0, 25).map(member => ({
              label: member.user.username.slice(0, 100),
              value: member.id,
              description: "إخراج العضو من الروم"
            }))
          );

        return interaction.reply({
          content: "👢 اختر العضو الذي تريد إخراجه:",
          components: [
            new ActionRowBuilder().addComponents(menu)
          ],
          ephemeral: true
        });
      }

      // نقل الملكية
      if (action === "vr_transfer") {
        const members = channel.members.filter(
          member => member.id !== interaction.user.id
        );

        if (members.size === 0) {
          return interaction.reply(
            error("لا يوجد عضو آخر داخل الروم.")
          );
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId(`voice_transfer:${roomId}`)
          .setPlaceholder("اختر المالك الجديد")
          .addOptions(
            [...members.values()].slice(0, 25).map(member => ({
              label: member.user.username.slice(0, 100),
              value: member.id,
              description: "نقل ملكية الروم إليه"
            }))
          );

        return interaction.reply({
          content: "👑 اختر المالك الجديد:",
          components: [
            new ActionRowBuilder().addComponents(menu)
          ],
          ephemeral: true
        });
      }

      // حذف الروم
      if (action === "vr_delete") {
        await interaction.reply(
          success("سيتم حذف الروم الآن.")
        );

        await deleteRoom(channel);
        return;
      }
    }

    // --------------------------
    // القوائم
    // --------------------------

    if (interaction.isStringSelectMenu()) {
      const [action, roomId] = interaction.customId.split(":");

      if (!await canManageRoom(interaction, roomId)) {
        return interaction.reply(
          error("لا تملك صلاحية التحكم بهذا الروم.")
        );
      }

      const result = await getRoom(roomId, interaction.guild);

      if (!result) {
        return interaction.reply(error("الروم غير موجود."));
      }

      const { channel, room } = result;
      const selectedId = interaction.values[0];

      if (action === "voice_kick") {
        const target = channel.members.get(selectedId);

        if (!target) {
          return interaction.reply(
            error("هذا العضو لم يعد داخل الروم.")
          );
        }

        if (selectedId === room.ownerId) {
          return interaction.reply(
            error("لا يمكنك طرد مالك الروم.")
          );
        }

        await target.voice.setChannel(null);

        return interaction.update({
          content: `✅ تم إخراج **${target.user.username}** من الروم.`,
          components: [],
          embeds: []
        });
      }

      if (action === "voice_transfer") {
        const target = channel.members.get(selectedId);

        if (!target) {
          return interaction.reply(
            error("العضو لم يعد داخل الروم.")
          );
        }

        await transferOwner(channel, selectedId);

        return interaction.update({
          content: `👑 تم نقل ملكية الروم إلى **${target.user.username}**.`,
          components: [],
          embeds: []
        });
      }
    }

    // --------------------------
    // النماذج
    // --------------------------

    if (interaction.isModalSubmit()) {
      const [action, roomId] = interaction.customId.split(":");

      if (
        action !== "voice_rename" &&
        action !== "voice_limit"
      ) return;

      if (!await canManageRoom(interaction, roomId)) {
        return interaction.reply(
          error("لا تملك صلاحية تعديل هذا الروم.")
        );
      }

      const result = await getRoom(roomId, interaction.guild);

      if (!result) {
        return interaction.reply(error("الروم غير موجود."));
      }

      const { channel } = result;

      if (action === "voice_rename") {
        const name = interaction.fields.getTextInputValue("room_name").trim();

        if (!name) {
          return interaction.reply(error("اكتب اسماً صحيحاً."));
        }

        await channel.setName(name);

        return interaction.reply(
          success(`تم تغيير اسم الروم إلى **${name}**`)
        );
      }

      if (action === "voice_limit") {
        const value = interaction.fields.getTextInputValue("room_limit").trim();

        if (!/^\d{1,2}$/.test(value)) {
          return interaction.reply(
            error("اكتب رقماً من 0 إلى 99.")
          );
        }

        const limit = Number(value);

        if (limit < 0 || limit > 99) {
          return interaction.reply(
            error("الحد المسموح من 0 إلى 99.")
          );
        }

        await channel.setUserLimit(limit);

        return interaction.reply(
          success(
            limit === 0
              ? "تم جعل عدد الأعضاء مفتوحاً."
              : `تم تحديد عدد الأعضاء إلى ${limit}.`
          )
        );
      }
    }

  } catch (err) {
    console.error("Interaction error:", err);

    if (interaction.isRepliable()) {
      await replyError(
        interaction,
        "حدث خطأ أثناء تنفيذ العملية. تأكد من صلاحيات البوت."
      ).catch(() => {});
    }
  }
});

// ==============================
// تسجيل الدخول
// ==============================

client.login(TOKEN).catch(err => {
  console.error("Login error:", err);
});
