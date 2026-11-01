const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionsBitField,
  PermissionFlagsBits,
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
  MessageFlags
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// ===========================
// إعدادات البوت
// ===========================

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || null;

if (!TOKEN || !CLIENT_ID) {
  console.log("❌ أضف TOKEN و CLIENT_ID في متغيرات الاستضافة");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ===========================
// قاعدة البيانات
// ===========================

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "voice.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2));
}

let db = {};

try {
  db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch {
  db = {};
}

function saveDB() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function getConfig(guildId) {
  if (!db[guildId]) {
    db[guildId] = {
      lobbyId: null,
      panelChannelId: null,
      panelMessageId: null,
      rooms: {}
    };

    saveDB();
  }

  return db[guildId];
}

// ===========================
// أدوات مساعدة
// ===========================

function makeEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0x7C3AED)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "Silfer Voice" })
    .setTimestamp();
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  ) ?? false;
}

function getRoom(interaction) {
  const config = getConfig(interaction.guildId);
  return config.rooms[interaction.channelId] || null;
}

function canControl(interaction, room) {
  return isAdmin(interaction) || room.ownerId === interaction.user.id;
}

function controlPanelEmbed(room) {
  return makeEmbed(
    "🎛️ لوحة التحكم الصوتية",
    [
      `**مالك الروم:** <@${room.ownerId}>`,
      `**حالة الروم:** ${room.locked ? "🔒 مقفل" : "🔓 مفتوح"}`,
      `**الظهور:** ${room.hidden ? "🙈 مخفي" : "👁️ ظاهر"}`,
      "",
      "اختر العملية التي تريد تنفيذها من الأزرار."
    ].join("\n")
  );
}

function controlPanelComponents(room) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("voice_rename")
      .setLabel("تغيير الاسم")
      .setEmoji("✏️")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("voice_limit")
      .setLabel("تحديد العدد")
      .setEmoji("👥")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("voice_lock")
      .setLabel(room.locked ? "فتح الروم" : "قفل الروم")
      .setEmoji(room.locked ? "🔓" : "🔒")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("voice_hide")
      .setLabel(room.hidden ? "إظهار الروم" : "إخفاء الروم")
      .setEmoji(room.hidden ? "👁️" : "🙈")
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("voice_kick")
      .setLabel("طرد عضو")
      .setEmoji("👢")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("voice_transfer")
      .setLabel("نقل الملكية")
      .setEmoji("👑")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("voice_delete")
      .setLabel("حذف الروم")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2];
}

async function showControls(interaction) {
  const room = getRoom(interaction);

  if (!room) {
    return interaction.reply({
      content: "❌ ادخل رومك المؤقت أولًا.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (!canControl(interaction, room)) {
    return interaction.reply({
      content: "❌ لوحة التحكم متاحة لمالك الروم والإدارة فقط.",
      flags: MessageFlags.Ephemeral
    });
  }

  return interaction.reply({
    embeds: [controlPanelEmbed(room)],
    components: controlPanelComponents(room),
    flags: MessageFlags.Ephemeral
  });
}

// ===========================
// تسجيل الأوامر
// ===========================

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
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("voice-panel")
    .setDescription("نشر لوحة التحكم الصوتية")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("اختر الروم النصي")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("voice-status")
    .setDescription("عرض حالة إعدادات البوت")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(command => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  if (GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("✅ تم تسجيل أوامر السيرفر");
  } else {
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log("✅ تم تسجيل الأوامر العامة");
  }
}

// ===========================
// لوحة التحكم النصية
// ===========================

function mainPanel() {
  const embed = makeEmbed(
    "🎙️ Silfer Voice",
    [
      "مرحبًا بك في نظام الرومات الصوتية المؤقتة.",
      "",
      "ادخل روم الانتظار وسيتم إنشاء روم خاص بك تلقائيًا.",
      "",
      "**مميزات الروم:**",
      "✏️ تغيير الاسم",
      "👥 تحديد عدد الأعضاء",
      "🔒 قفل وفتح الروم",
      "🙈 إخفاء وإظهار الروم",
      "👢 طرد عضو",
      "👑 نقل الملكية",
      "🗑️ حذف الروم",
      "",
      "اضغط الزر بالأسفل لفتح لوحة التحكم."
    ].join("\n")
  );

  const button = new ButtonBuilder()
    .setCustomId("voice_manage")
    .setLabel("لوحة التحكم")
    .setEmoji("🎛️")
    .setStyle(ButtonStyle.Primary);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(button)
    ]
  };
}

// ===========================
// إنشاء الرومات المؤقتة
// ===========================

client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const member = newState.member || oldState.member;

    if (!member || member.user.bot) return;

    const guild = member.guild;
    const config = getConfig(guild.id);

    // العضو دخل روم الانتظار
    if (
      newState.channelId &&
      newState.channelId === config.lobbyId &&
      oldState.channelId !== newState.channelId
    ) {
      const lobby = newState.channel;

      if (!lobby) return;

      const roomName = `🔊・${member.displayName}`.slice(0, 100);

      const room = await guild.channels.create({
        name: roomName,
        type: ChannelType.GuildVoice,
        parent: lobby.parentId || null,
        userLimit: 0,
        permissionOverwrites: [
          {
            id: member.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
              PermissionFlagsBits.Stream,
              PermissionFlagsBits.UseVAD
            ]
          }
        ],
        reason: `Temporary room for ${member.user.tag}`
      });

      config.rooms[room.id] = {
        ownerId: member.id,
        locked: false,
        hidden: false
      };

      saveDB();

      try {
        await member.voice.setChannel(room);
      } catch (error) {
        console.log("تعذر نقل العضو للروم:", error.message);

        if (room.members.size === 0) {
          await room.delete().catch(() => {});
          delete config.rooms[room.id];
          saveDB();
        }
      }
    }

    // حذف الروم إذا أصبح فارغًا
    if (oldState.channelId) {
      const oldChannel = oldState.channel;
      const oldRoom = config.rooms[oldState.channelId];

      if (
        oldRoom &&
        oldChannel &&
        oldChannel.members.size === 0
      ) {
        await oldChannel.delete("Temporary room is empty").catch(() => {});
        delete config.rooms[oldState.channelId];
        saveDB();
      }
    }
  } catch (error) {
    console.error("Voice state error:", error);
  }
});

// ===========================
// التفاعلات
// ===========================

client.on("interactionCreate", async interaction => {
  try {
    if (!interaction.guild) return;

    const config = getConfig(interaction.guildId);

    // أوامر السلاش
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "voice-lobby") {
        const channel = interaction.options.getChannel("channel");

        config.lobbyId = channel.id;
        saveDB();

        return interaction.reply({
          content: `✅ تم تحديد روم الانتظار: ${channel}`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.commandName === "voice-panel") {
        const channel = interaction.options.getChannel("channel");

        const sent = await channel.send(mainPanel());

        config.panelChannelId = channel.id;
        config.panelMessageId = sent.id;
        saveDB();

        return interaction.reply({
          content: `✅ تم نشر لوحة التحكم في ${channel}`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.commandName === "voice-status") {
        const lobby = config.lobbyId
          ? `<#${config.lobbyId}>`
          : "غير محدد";

        const panel = config.panelChannelId
          ? `<#${config.panelChannelId}>`
          : "غير محدد";

        const roomCount = Object.keys(config.rooms).length;

        return interaction.reply({
          embeds: [
            makeEmbed(
              "📊 حالة Silfer Voice",
              [
                `**روم الانتظار:** ${lobby}`,
                `**روم اللوحة:** ${panel}`,
                `**عدد الرومات المؤقتة المسجلة:** ${roomCount}`
              ].join("\n")
            )
          ],
          flags: MessageFlags.Ephemeral
        });
      }
    }

    // زر لوحة التحكم الرئيسية
    if (interaction.isButton() && interaction.customId === "voice_manage") {
      return showControls(interaction);
    }

    // أزرار التحكم داخل الروم
    if (interaction.isButton()) {
      const room = getRoom(interaction);

      const controlIds = [
        "voice_rename",
        "voice_limit",
        "voice_lock",
        "voice_hide",
        "voice_kick",
        "voice_transfer",
        "voice_delete"
      ];

      if (!controlIds.includes(interaction.customId)) return;

      if (!room) {
        return interaction.reply({
          content: "❌ أنت لست داخل روم مؤقت مسجل.",
          flags: MessageFlags.Ephemeral
        });
      }

      if (!canControl(interaction, room)) {
        return interaction.reply({
          content: "❌ هذه الخاصية لمالك الروم والإدارة فقط.",
          flags: MessageFlags.Ephemeral
        });
      }

      const channel = interaction.channel;

      // تغيير الاسم
      if (interaction.customId === "voice_rename") {
        const modal = new ModalBuilder()
          .setCustomId("voice_rename_modal")
          .setTitle("تغيير اسم الروم");

        const input = new TextInputBuilder()
          .setCustomId("new_name")
          .setLabel("الاسم الجديد")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100);

        modal.addComponents(
          new ActionRowBuilder().addComponents(input)
        );

        return interaction.showModal(modal);
      }

      // تحديد العدد
      if (interaction.customId === "voice_limit") {
        const modal = new ModalBuilder()
          .setCustomId("voice_limit_modal")
          .setTitle("تحديد عدد الأعضاء");

        const input = new TextInputBuilder()
          .setCustomId("limit")
          .setLabel("اكتب العدد من 0 إلى 99")
          .setPlaceholder("0 = بدون حد")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(2);

        modal.addComponents(
          new ActionRowBuilder().addComponents(input)
        );

        return interaction.showModal(modal);
      }

      // قفل وفتح الروم
      if (interaction.customId === "voice_lock") {
        room.locked = !room.locked;

        await channel.permissionOverwrites.edit(
          interaction.guild.id,
          {
            Connect: room.locked ? false : null
          }
        );

        // ضمان بقاء المالك قادرًا على الدخول
        await channel.permissionOverwrites.edit(
          room.ownerId,
          {
            ViewChannel: true,
            Connect: true
          }
        );

        saveDB();

        return interaction.update({
          embeds: [controlPanelEmbed(room)],
          components: controlPanelComponents(room)
        });
      }

      // إخفاء وإظهار الروم
      if (interaction.customId === "voice_hide") {
        room.hidden = !room.hidden;

        await channel.permissionOverwrites.edit(
          interaction.guild.id,
          {
            ViewChannel: room.hidden ? false : null
          }
        );

        await channel.permissionOverwrites.edit(
          room.ownerId,
          {
            ViewChannel: true,
            Connect: true
          }
        );

        saveDB();

        return interaction.update({
          embeds: [controlPanelEmbed(room)],
          components: controlPanelComponents(room)
        });
      }

      // طرد عضو
      if (interaction.customId === "voice_kick") {
        const members = [...channel.members.values()]
          .filter(member => member.id !== interaction.user.id)
          .slice(0, 25);

        if (!members.length) {
          return interaction.reply({
            content: "❌ لا يوجد أعضاء آخرون في الروم.",
            flags: MessageFlags.Ephemeral
          });
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId("voice_kick_select")
          .setPlaceholder("اختر العضو")
          .addOptions(
            members.map(member => ({
              label: member.user.username.slice(0, 100),
              value: member.id
            }))
          );

        return interaction.reply({
          content: "اختر العضو الذي تريد إخراجه:",
          components: [
            new ActionRowBuilder().addComponents(menu)
          ],
          flags: MessageFlags.Ephemeral
        });
      }

      // نقل الملكية
      if (interaction.customId === "voice_transfer") {
        const members = [...channel.members.values()]
          .filter(member => member.id !== interaction.user.id)
          .slice(0, 25);

        if (!members.length) {
          return interaction.reply({
            content: "❌ لا يوجد عضو آخر في الروم لنقل الملكية إليه.",
            flags: MessageFlags.Ephemeral
          });
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId("voice_transfer_select")
          .setPlaceholder("اختر المالك الجديد")
          .addOptions(
            members.map(member => ({
              label: member.user.username.slice(0, 100),
              value: member.id
            }))
          );

        return interaction.reply({
          content: "👑 اختر العضو الذي تريد نقل الملكية إليه:",
          components: [
            new ActionRowBuilder().addComponents(menu)
          ],
          flags: MessageFlags.Ephemeral
        });
      }

      // حذف الروم
      if (interaction.customId === "voice_delete") {
        await interaction.reply({
          content: "🗑️ تم طلب حذف الروم.",
          flags: MessageFlags.Ephemeral
        });

        delete config.rooms[channel.id];
        saveDB();

        await channel.delete("Room deleted by owner or administrator");
      }
    }

    // النماذج
    if (interaction.isModalSubmit()) {
      const room = getRoom(interaction);

      if (!room) {
        return interaction.reply({
          content: "❌ لم يتم العثور على الروم.",
          flags: MessageFlags.Ephemeral
        });
      }

      if (!canControl(interaction, room)) {
        return interaction.reply({
          content: "❌ لا تملك صلاحية التحكم.",
          flags: MessageFlags.Ephemeral
        });
      }

      // حفظ الاسم
      if (interaction.customId === "voice_rename_modal") {
        const name = interaction.fields
          .getTextInputValue("new_name")
          .trim();

        if (!name) {
          return interaction.reply({
            content: "❌ الاسم غير صالح.",
            flags: MessageFlags.Ephemeral
          });
        }

        await interaction.channel.setName(name);

        return interaction.reply({
          content: `✅ تم تغيير اسم الروم إلى **${name}**`,
          flags: MessageFlags.Ephemeral
        });
      }

      // حفظ العدد
      if (interaction.customId === "voice_limit_modal") {
        const value = interaction.fields
          .getTextInputValue("limit")
          .trim();

        const limit = Number(value);

        if (
          !/^\d+$/.test(value) ||
          limit < 0 ||
          limit > 99
        ) {
          return interaction.reply({
            content: "❌ اكتب رقمًا من 0 إلى 99.",
            flags: MessageFlags.Ephemeral
          });
        }

        await interaction.channel.setUserLimit(limit);

        return interaction.reply({
          content: limit === 0
            ? "✅ تم إزالة حد الأعضاء."
            : `✅ تم تحديد الحد الأقصى إلى ${limit} عضو.`,
          flags: MessageFlags.Ephemeral
        });
      }
    }

    // اختيار عضو للطرد
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "voice_kick_select"
    ) {
      const room = getRoom(interaction);

      if (!room || !canControl(interaction, room)) {
        return interaction.reply({
          content: "❌ لا تملك صلاحية التحكم.",
          flags: MessageFlags.Ephemeral
        });
      }

      const memberId = interaction.values[0];
      const member = await interaction.guild.members
        .fetch(memberId)
        .catch(() => null);

      if (!member || member.voice.channelId !== interaction.channelId) {
        return interaction.reply({
          content: "❌ العضو لم يعد داخل الروم.",
          flags: MessageFlags.Ephemeral
        });
      }

      await member.voice.disconnect("Removed by temporary room owner");

      return interaction.update({
        content: `✅ تم إخراج ${member} من الروم.`,
        components: []
      });
    }

    // اختيار المالك الجديد
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "voice_transfer_select"
    ) {
      const room = getRoom(interaction);

      if (!room || !canControl(interaction, room)) {
        return interaction.reply({
          content: "❌ لا تملك صلاحية التحكم.",
          flags: MessageFlags.Ephemeral
        });
      }

      const newOwnerId = interaction.values[0];
      const newOwner = await interaction.guild.members
        .fetch(newOwnerId)
        .catch(() => null);

      if (
        !newOwner ||
        newOwner.voice.channelId !== interaction.channelId
      ) {
        return interaction.reply({
          content: "❌ العضو لم يعد داخل الروم.",
          flags: MessageFlags.Ephemeral
        });
      }

      room.ownerId = newOwnerId;

      await interaction.channel.permissionOverwrites.edit(
        newOwnerId,
        {
          ViewChannel: true,
          Connect: true,
          Speak: true
        }
      );

      saveDB();

      return interaction.update({
        content: `👑 تم نقل ملكية الروم إلى ${newOwner}.`,
        components: []
      });
    }

  } catch (error) {
    console.error("Interaction error:", error);

    const response = {
      content: "❌ حدث خطأ. تأكد من صلاحيات البوت.",
      flags: MessageFlags.Ephemeral
    };

    if (interaction.deferred) {
      await interaction.editReply(response).catch(() => {});
    } else if (interaction.replied) {
      await interaction.followUp(response).catch(() => {});
    } else {
      await interaction.reply(response).catch(() => {});
    }
  }
});

// ===========================
// تشغيل البوت
// ===========================

client.once("ready", async () => {
  console.log(`✅ ${client.user.tag} is online`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("❌ فشل تسجيل الأوامر:", error);
  }
});

client.login(TOKEN);
