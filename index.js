
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
  StringSelectMenuBuilder,
  ActivityType
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// =====================================
// MAIN VOICE SETTINGS
// =====================================

const TOKEN = process.env.TOKEN?.trim();
const CLIENT_ID = process.env.CLIENT_ID?.trim();
const GUILD_ID = process.env.GUILD_ID?.trim() || "";

const COLOR = 0x808080;
const FOOTER = "MAIN VOICE • mian";

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ TOKEN أو CLIENT_ID غير موجود");
  process.exit(1);
}

// =====================================
// DATABASE
// =====================================

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "voice.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function defaultData() {
  return {
    lobbyId: null,
    panelChannelId: null,
    panelMessageId: null,
    rooms: {}
  };
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return defaultData();
    }

    const parsed = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    return {
      ...defaultData(),
      ...parsed,
      rooms:
        parsed.rooms &&
        typeof parsed.rooms === "object" &&
        !Array.isArray(parsed.rooms)
          ? parsed.rooms
          : {}
    };
  } catch (error) {
    console.error("Database error:", error);
    return defaultData();
  }
}

let config = loadData();

function saveData() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(config, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("Database save error:", error);
  }
}

// إصلاح البيانات القديمة
if (!config.rooms || typeof config.rooms !== "object") {
  config.rooms = {};
}

saveData();

// =====================================
// DISCORD CLIENT
// =====================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// =====================================
// EMBEDS
// =====================================

function embed(title, description) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: FOOTER })
    .setTimestamp();
}

function success(message) {
  return {
    embeds: [
      embed("✅ تمت العملية بنجاح", message)
    ],
    ephemeral: true
  };
}

function fail(message) {
  return {
    embeds: [
      embed("❌ تعذر تنفيذ العملية", message)
    ],
    ephemeral: true
  };
}

// =====================================
// HELPERS
// =====================================

function isAdmin(member) {
  return member.permissions.has(
    PermissionsBitField.Flags.Administrator
  );
}

async function fetchMember(guild, userId) {
  return guild.members.fetch(userId);
}

async function getRoom(roomId, guild) {
  if (!config.rooms || !config.rooms[roomId]) {
    return null;
  }

  const channel =
    guild.channels.cache.get(roomId) ||
    await guild.channels.fetch(roomId).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildVoice) {
    delete config.rooms[roomId];
    saveData();
    return null;
  }

  return {
    channel,
    room: config.rooms[roomId]
  };
}

async function checkRoomPermission(interaction, roomId) {
  if (!interaction.guild) return false;

  const result = await getRoom(roomId, interaction.guild);
  if (!result) return false;

  const member = await fetchMember(
    interaction.guild,
    interaction.user.id
  );

  if (isAdmin(member)) return true;

  if (result.room.ownerId !== member.id) {
    return false;
  }

  return member.voice.channelId === roomId;
}

async function sendError(interaction, message) {
  const payload = fail(message);

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload).catch(() => {});
  }

  return interaction.reply(payload).catch(() => {});
}

// =====================================
// MAIN PANEL
// =====================================

function mainEmbed() {
  return embed(
    "🎙️ MAIN VOICE",
    [
      "مرحباً بك في نظام الرومات الصوتية المؤقتة.",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "**طريقة الاستخدام**",
      "① ادخل روم الانتظار.",
      "② سيتم إنشاء روم صوتي لك تلقائياً.",
      "③ افتح لوحة التحكم لإدارة رومك.",
      "━━━━━━━━━━━━━━━━━━",
      "**مميزات النظام**",
      "✏️ تغيير اسم الروم",
      "👥 تحديد عدد الأعضاء",
      "🔒 قفل وفتح الروم",
      "🙈 إخفاء وإظهار الروم",
      "👢 إخراج الأعضاء",
      "👑 نقل الملكية",
      "🗑️ حذف الروم",
      "━━━━━━━━━━━━━━━━━━",
      "اضغط الزر بالأسفل لفتح لوحة التحكم."
    ].join("\n")
  );
}

function mainButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("mainvoice_open")
      .setLabel("لوحة التحكم")
      .setEmoji("🎛️")
      .setStyle(ButtonStyle.Secondary)
  );
}

// =====================================
// ROOM PANEL
// =====================================

function getRoomStatus(channel) {
  const everyone = channel.permissionOverwrites.cache.get(
    channel.guild.id
  );

  return {
    locked: everyone?.deny.has(
      PermissionsBitField.Flags.Connect
    ) || false,

    hidden: everyone?.deny.has(
      PermissionsBitField.Flags.ViewChannel
    ) || false
  };
}

function roomEmbed(channel, room) {
  const status = getRoomStatus(channel);

  const owner =
    channel.guild.members.cache.get(room.ownerId);

  const ownerText = owner
    ? owner.user.username
    : "غير معروف";

  const limit = channel.userLimit === 0
    ? "مفتوح"
    : channel.userLimit;

  return embed(
    "🎛️ MAIN VOICE | التحكم بالروم",
    [
      "━━━━━━━━━━━━━━━━━━",
      `**اسم الروم:** ${channel.name}`,
      `**المالك:** ${ownerText}`,
      `**الأعضاء:** ${channel.members.size}`,
      `**الحد الأقصى:** ${limit}`,
      "━━━━━━━━━━━━━━━━━━",
      `**القفل:** ${status.locked ? "🔒 مقفل" : "🔓 مفتوح"}`,
      `**الظهور:** ${status.hidden ? "🙈 مخفي" : "👁️ ظاهر"}`,
      "━━━━━━━━━━━━━━━━━━",
      "اختر العملية المطلوبة من الأسفل."
    ].join("\n")
  );
}

function roomButtons(roomId, channel) {
  const status = getRoomStatus(channel);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mv_rename:${roomId}`)
      .setLabel("الاسم")
      .setEmoji("✏️")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`mv_limit:${roomId}`)
      .setLabel("العدد")
      .setEmoji("👥")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`mv_lock:${roomId}`)
      .setLabel(status.locked ? "فتح" : "قفل")
      .setEmoji(status.locked ? "🔓" : "🔒")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`mv_hide:${roomId}`)
      .setLabel(status.hidden ? "إظهار" : "إخفاء")
      .setEmoji(status.hidden ? "👁️" : "🙈")
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mv_kick:${roomId}`)
      .setLabel("طرد عضو")
      .setEmoji("👢")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`mv_transfer:${roomId}`)
      .setLabel("نقل الملكية")
      .setEmoji("👑")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`mv_refresh:${roomId}`)
      .setLabel("تحديث")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`mv_delete:${roomId}`)
      .setLabel("حذف")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2];
}

// =====================================
// CREATE TEMPORARY ROOM
// =====================================

async function createRoom(member, lobby) {
  const guild = member.guild;

  // البحث عن روم قديم للعضو
  for (const [roomId, room] of Object.entries(config.rooms)) {
    if (room.ownerId !== member.id) continue;

    const existing = await guild.channels.fetch(roomId).catch(() => null);

    if (existing && existing.type === ChannelType.GuildVoice) {
      await member.voice.setChannel(existing).catch(() => {});
      return;
    }

    delete config.rooms[roomId];
  }

  saveData();

  const options = {
    name: `🎙️ ${member.user.username}`.slice(0, 100),
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

  try {
    await member.voice.setChannel(channel);
  } catch (error) {
    console.error("Move member error:", error);

    delete config.rooms[channel.id];
    saveData();

    await channel.delete().catch(() => {});
  }
}

// =====================================
// DELETE ROOM
// =====================================

async function deleteRoom(channel) {
  delete config.rooms[channel.id];
  saveData();

  await channel.delete().catch(error => {
    console.error("Delete room error:", error);
  });
}

// =====================================
// TRANSFER OWNERSHIP
// =====================================

async function transferOwnership(channel, newOwnerId) {
  const room = config.rooms[channel.id];
  if (!room) return;

  const oldOwnerId = room.ownerId;

  if (oldOwnerId !== newOwnerId) {
    await channel.permissionOverwrites.delete(oldOwnerId).catch(() => {});
  }

  room.ownerId = newOwnerId;
  saveData();

  await channel.permissionOverwrites.edit(newOwnerId, {
    ViewChannel: true,
    Connect: true
  });
}

// =====================================
// SLASH COMMANDS
// =====================================

const commands = [
  new SlashCommandBuilder()
    .setName("voice-lobby")
    .setDescription("تحديد روم الانتظار")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("اختر روم الانتظار")
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
        .setDescription("اختر الروم النصي")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionsBitField.Flags.Administrator
    ),

  new SlashCommandBuilder()
    .setName("voice-status")
    .setDescription("عرض حالة النظام")
    .setDefaultMemberPermissions(
      PermissionsBitField.Flags.Administrator
    )
].map(command => command.toJSON());

// =====================================
// REGISTER COMMANDS
// =====================================

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

// =====================================
// READY
// =====================================

client.once("clientReady", async () => {
  console.log(`✅ ${client.user.tag} is online`);

  client.user.setPresence({
    activities: [
      {
        name: "MAIN VOICE • mian",
        type: ActivityType.Watching
      }
    ],
    status: "online"
  });

  try {
    await registerCommands();
  } catch (error) {
    console.error("Register commands error:", error);
  }

  // تنظيف قاعدة البيانات من الرومات المحذوفة
  for (const roomId of Object.keys(config.rooms)) {
    const channel = await client.channels.fetch(roomId).catch(() => null);

    if (!channel || channel.type !== ChannelType.GuildVoice) {
      delete config.rooms[roomId];
    }
  }

  saveData();

  console.log("🩶 MAIN VOICE READY");
});

// =====================================
// VOICE STATE SYSTEM
// =====================================

client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    // دخول روم الانتظار
    if (
      newState.channelId &&
      newState.channelId === config.lobbyId &&
      oldState.channelId !== newState.channelId
    ) {
      if (newState.member && newState.channel) {
        await createRoom(newState.member, newState.channel);
      }
    }

    // الخروج من روم مؤقت
    const oldChannelId = oldState.channelId;

    if (!oldChannelId || !config.rooms[oldChannelId]) {
      return;
    }

    const channel = oldState.guild.channels.cache.get(oldChannelId);

    if (!channel) {
      delete config.rooms[oldChannelId];
      saveData();
      return;
    }

    // حذف الروم إذا أصبح فارغاً
    if (channel.members.size === 0) {
      await deleteRoom(channel);
      return;
    }

    // نقل الملكية عند خروج المالك
    const room = config.rooms[oldChannelId];

    if (room && oldState.id === room.ownerId) {
      const nextOwner = channel.members.first();

      if (nextOwner) {
        await transferOwnership(channel, nextOwner.id);
      }
    }

  } catch (error) {
    console.error("Voice state error:", error);
  }
});

// =====================================
// INTERACTIONS
// =====================================

client.on("interactionCreate", async interaction => {
  try {
    if (!interaction.guild) return;

    // ---------------------------------
    // SLASH COMMANDS
    // ---------------------------------

    if (interaction.isChatInputCommand()) {

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

        let message = null;

        if (config.panelMessageId) {
          message = await channel.messages.fetch(
            config.panelMessageId
          ).catch(() => null);
        }

        if (message) {
          await message.edit({
            embeds: [mainEmbed()],
            components: [mainButtons()]
          });
        } else {
          message = await channel.send({
            embeds: [mainEmbed()],
            components: [mainButtons()]
          });
        }

        config.panelChannelId = channel.id;
        config.panelMessageId = message.id;
        saveData();

        return interaction.reply(
          success(`تم نشر لوحة التحكم في ${channel}`)
        );
      }

      if (interaction.commandName === "voice-status") {
        const embedStatus = embed(
          "⚙️ MAIN VOICE STATUS",
          [
            `**السيرفر:** mian`,
            `**اسم البوت:** Main Voice`,
            `**روم الانتظار:** ${config.lobbyId ? `<#${config.lobbyId}>` : "غير محدد"}`,
            `**لوحة التحكم:** ${config.panelChannelId ? `<#${config.panelChannelId}>` : "غير محدد"}`,
            `**الرومات النشطة:** ${Object.keys(config.rooms).length}`
          ].join("\n")
        );

        return interaction.reply({
          embeds: [embedStatus],
          ephemeral: true
        });
      }
    }

    // ---------------------------------
    // MAIN PANEL BUTTON
    // ---------------------------------

    if (
      interaction.isButton() &&
      interaction.customId === "mainvoice_open"
    ) {
      const member = await fetchMember(
        interaction.guild,
        interaction.user.id
      );

      const roomId = member.voice.channelId;

      if (!roomId || !config.rooms[roomId]) {
        return interaction.reply(
          fail("ادخل رومك الصوتي المؤقت أولاً.")
        );
      }

      const result = await getRoom(roomId, interaction.guild);

      if (!result) {
        return interaction.reply(fail("الروم غير موجود."));
      }

      const isOwner = result.room.ownerId === member.id;

      if (!isOwner && !isAdmin(member)) {
        return interaction.reply(
          fail("لوحة التحكم مخصصة لمالك الروم أو الإدارة.")
        );
      }

      return interaction.reply({
        embeds: [
          roomEmbed(result.channel, result.room)
        ],
        components: roomButtons(roomId, result.channel),
        ephemeral: true
      });
    }

    // ---------------------------------
    // ROOM BUTTONS
    // ---------------------------------

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("mv_")
    ) {
      const [action, roomId] = interaction.customId.split(":");

      if (!roomId || !await checkRoomPermission(interaction, roomId)) {
        return interaction.reply(
          fail("لا تملك صلاحية التحكم بهذا الروم.")
        );
      }

      const result = await getRoom(roomId, interaction.guild);

      if (!result) {
        return interaction.reply(fail("الروم غير موجود."));
      }

      const { channel, room } = result;

      // تغيير الاسم
      if (action === "mv_rename") {
        const modal = new ModalBuilder()
          .setCustomId(`mv_modal_rename:${roomId}`)
          .setTitle("تغيير اسم الروم");

        const input = new TextInputBuilder()
          .setCustomId("name")
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
      if (action === "mv_limit") {
        const modal = new ModalBuilder()
          .setCustomId(`mv_modal_limit:${roomId}`)
          .setTitle("تحديد عدد الأعضاء");

        const input = new TextInputBuilder()
          .setCustomId("limit")
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
      if (action === "mv_lock") {
        const status = getRoomStatus(channel);

        await channel.permissionOverwrites.edit(
          interaction.guild.id,
          {
            Connect: status.locked ? null : false
          }
        );

        await channel.permissionOverwrites.edit(
          room.ownerId,
          {
            Connect: true,
            ViewChannel: true
          }
        );

        return interaction.update({
          embeds: [roomEmbed(channel, room)],
          components: roomButtons(roomId, channel)
        });
      }

      // إخفاء وإظهار
      if (action === "mv_hide") {
        const status = getRoomStatus(channel);

        await channel.permissionOverwrites.edit(
          interaction.guild.id,
          {
            ViewChannel: status.hidden ? null : false
          }
        );

        await channel.permissionOverwrites.edit(
          room.ownerId,
          {
            ViewChannel: true,
            Connect: true
          }
        );

        return interaction.update({
          embeds: [roomEmbed(channel, room)],
          components: roomButtons(roomId, channel)
        });
      }

      // تحديث اللوحة
      if (action === "mv_refresh") {
        return interaction.update({
          embeds: [roomEmbed(channel, room)],
          components: roomButtons(roomId, channel)
        });
      }

      // طرد عضو
      if (action === "mv_kick") {
        const members = channel.members.filter(
          member => member.id !== room.ownerId
        );

        if (members.size === 0) {
          return interaction.reply(
            fail("لا يوجد أعضاء آخرون داخل الروم.")
          );
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId(`mv_select_kick:${roomId}`)
          .setPlaceholder("اختر العضو الذي تريد طرده")
          .addOptions(
            [...members.values()].slice(0, 25).map(member => ({
              label: member.user.username.slice(0, 100),
              value: member.id
            }))
          );

        return interaction.reply({
          content: "👢 اختر العضو:",
          components: [
            new ActionRowBuilder().addComponents(menu)
          ],
          ephemeral: true
        });
      }

      // نقل الملكية
      if (action === "mv_transfer") {
        const members = channel.members.filter(
          member => member.id !== interaction.user.id
        );

        if (members.size === 0) {
          return interaction.reply(
            fail("لا يوجد عضو آخر داخل الروم.")
          );
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId(`mv_select_transfer:${roomId}`)
          .setPlaceholder("اختر المالك الجديد")
          .addOptions(
            [...members.values()].slice(0, 25).map(member => ({
              label: member.user.username.slice(0, 100),
              value: member.id
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
      if (action === "mv_delete") {
        await interaction.update({
          embeds: [embed("🗑️ حذف الروم", "تم طلب حذف الروم.")],
          components: []
        });

        await deleteRoom(channel);
        return;
      }
    }

    // ---------------------------------
    // SELECT MENUS
    // ---------------------------------

    if (interaction.isStringSelectMenu()) {
      const [action, roomId] = interaction.customId.split(":");

      if (
        !roomId ||
        !await checkRoomPermission(interaction, roomId)
      ) {
        return interaction.reply(
          fail("لا تملك صلاحية التحكم بهذا الروم.")
        );
      }

      const result = await getRoom(roomId, interaction.guild);

      if (!result) {
        return interaction.reply(fail("الروم غير موجود."));
      }

      const { channel, room } = result;
      const selectedId = interaction.values[0];

      if (action === "mv_select_kick") {
        const target = channel.members.get(selectedId);

        if (!target) {
          return interaction.update({
            content: "❌ العضو لم يعد داخل الروم.",
            components: []
          });
        }

        if (selectedId === room.ownerId) {
          return interaction.update({
            content: "❌ لا يمكنك طرد مالك الروم.",
            components: []
          });
        }

        await target.voice.setChannel(null);

        return interaction.update({
          content: `✅ تم إخراج ${target.user.username} من الروم.`,
          components: []
        });
      }

      if (action === "mv_select_transfer") {
        const target = channel.members.get(selectedId);

        if (!target) {
          return interaction.update({
            content: "❌ العضو لم يعد داخل الروم.",
            components: []
          });
        }

        await transferOwnership(channel, selectedId);

        return interaction.update({
          content: `👑 تم نقل الملكية إلى ${target.user.username}.`,
          components: []
        });
      }
    }

    // ---------------------------------
    // MODALS
    // ---------------------------------

    if (interaction.isModalSubmit()) {
      const [action, roomId] = interaction.customId.split(":");

      if (
        action !== "mv_modal_rename" &&
        action !== "mv_modal_limit"
      ) return;

      if (
        !roomId ||
        !await checkRoomPermission(interaction, roomId)
      ) {
        return interaction.reply(
          fail("لا تملك صلاحية تعديل هذا الروم.")
        );
      }

      const result = await getRoom(roomId, interaction.guild);

      if (!result) {
        return interaction.reply(fail("الروم غير موجود."));
      }

      const { channel } = result;

      // حفظ الاسم
      if (action === "mv_modal_rename") {
        const name = interaction.fields
          .getTextInputValue("name")
          .trim();

        if (!name) {
          return interaction.reply(fail("الاسم غير صالح."));
        }

        await channel.setName(name);

        return interaction.reply(
          success(`تم تغيير اسم الروم إلى **${name}**`)
        );
      }

      // حفظ العدد
      if (action === "mv_modal_limit") {
        const value = interaction.fields
          .getTextInputValue("limit")
          .trim();

        if (!/^\d{1,2}$/.test(value)) {
          return interaction.reply(
            fail("اكتب رقماً من 0 إلى 99.")
          );
        }

        const limit = Number(value);

        if (limit > 99) {
          return interaction.reply(
            fail("الحد الأقصى هو 99.")
          );
        }

        await channel.setUserLimit(limit);

        return interaction.reply(
          success(
            limit === 0
              ? "تم فتح العدد بدون حد."
              : `تم تحديد العدد إلى ${limit}.`
          )
        );
      }
    }

  } catch (error) {
    console.error("Interaction error:", error);

    if (interaction.isRepliable()) {
      await sendError(
        interaction,
        "حدث خطأ. تأكد من صلاحيات البوت وحاول مرة أخرى."
      );
    }
  }
});

// =====================================
// ERROR HANDLING
// =====================================

client.on("error", error => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

// =====================================
// LOGIN
// =====================================

client.login(TOKEN).catch(error => {
  console.error("Login failed:", error);
  process.exit(1);
});
