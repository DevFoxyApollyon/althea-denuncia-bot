const { 
  EmbedBuilder, 
  ActionRowBuilder, 
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits
} = require('discord.js');
const Config = require('../models/Config');
require('dotenv').config();

const MESSAGE_TIMEOUT = 5 * 60 * 1000; 
const SUPORTE_BOT_ID = process.env.SUPORTE_BOT_ID;


async function hasPermission(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
         interaction.user.id === SUPORTE_BOT_ID;
}

function getCurrentUser(interaction) {
  return interaction.user?.tag || interaction.member?.user?.tag || 'Sistema';
}

function getChannelName(interaction, channelId) {
  if (!channelId) return '`Não configurado`';
  const channel = interaction.guild.channels.cache.get(channelId);
  return channel ? `<#${channelId}> \`${channelId}\`` : '`Canal não encontrado`';
}

function getRoleName(interaction, roleId) {
  if (!roleId) return '`Não configurado`';
  const role = interaction.guild.roles.cache.get(roleId);
  return role ? `<@&${roleId}> \`${roleId}\`` : '`Cargo não encontrado`';
}


function createChannelsModal1(currentConfig = null) {
  const modal = new ModalBuilder().setCustomId('channels_modal_1').setTitle('Configurar Canais (Parte 1)');
  const pc = new TextInputBuilder().setCustomId('pc_channel').setLabel('Canal PC').setStyle(TextInputStyle.Short).setRequired(true).setValue(currentConfig?.channels?.pc || '');
  const mobile = new TextInputBuilder().setCustomId('mobile_channel').setLabel('Canal Mobile').setStyle(TextInputStyle.Short).setRequired(true).setValue(currentConfig?.channels?.mobile || '');
  const logs = new TextInputBuilder().setCustomId('logs_channel').setLabel('Canal Cadeia Staff').setStyle(TextInputStyle.Short).setRequired(true).setValue(currentConfig?.channels?.logs || '');

  return modal.addComponents(
    new ActionRowBuilder().addComponents(pc),
    new ActionRowBuilder().addComponents(mobile),
    new ActionRowBuilder().addComponents(logs)
  );
}

function createChannelsModal2(currentConfig = null) {
  const modal = new ModalBuilder().setCustomId('channels_modal_2').setTitle('Configurar Canais (Parte 2)');
  const logAdmin = new TextInputBuilder().setCustomId('log_admin_channel').setLabel('Canal de Log Administração').setStyle(TextInputStyle.Short).setRequired(false).setValue(currentConfig?.channels?.log || '');
  const analysis = new TextInputBuilder().setCustomId('analysis_channel').setLabel('Canal de Análise').setStyle(TextInputStyle.Short).setRequired(false).setValue(currentConfig?.channels?.analysis || '');
  const topDaily = new TextInputBuilder().setCustomId('top_daily_channel').setLabel('Canal do Top Diário').setStyle(TextInputStyle.Short).setRequired(false).setValue(currentConfig?.channels?.topDaily || '');

  return modal.addComponents(
    new ActionRowBuilder().addComponents(logAdmin),
    new ActionRowBuilder().addComponents(analysis),
    new ActionRowBuilder().addComponents(topDaily)
  );
}

function createRolesModal1(currentConfig = null) {
  const modal = new ModalBuilder().setCustomId('roles_modal_1').setTitle('Configurar Cargos (Parte 1)');
  const permitido = new TextInputBuilder().setCustomId('permitido_role').setLabel('Cargo Mobile').setStyle(TextInputStyle.Short).setRequired(true).setValue(currentConfig?.roles?.permitido || '');
  const pc = new TextInputBuilder().setCustomId('pc_role').setLabel('Cargo PC').setStyle(TextInputStyle.Short).setRequired(true).setValue(currentConfig?.roles?.pc || '');

  return modal.addComponents(
    new ActionRowBuilder().addComponents(permitido),
    new ActionRowBuilder().addComponents(pc)
  );
}

function createRolesModal2(currentConfig = null) {
  const modal = new ModalBuilder().setCustomId('roles_modal_2').setTitle('Configurar Cargos (Parte 2)');
  const admin = new TextInputBuilder().setCustomId('admin_role').setLabel('Cargo Administrador').setStyle(TextInputStyle.Short).setRequired(false).setValue(currentConfig?.roles?.administrador || '');
  const resp = new TextInputBuilder().setCustomId('resp_admin_role').setLabel('Cargo Responsável Admin').setStyle(TextInputStyle.Short).setRequired(false).setValue(currentConfig?.roles?.responsavel_admin || '');

  return modal.addComponents(
    new ActionRowBuilder().addComponents(admin),
    new ActionRowBuilder().addComponents(resp)
  );
}


async function saveChannels1(interaction) {
  const { fields, guild } = interaction;
  const pcId = fields.getTextInputValue('pc_channel');
  const mobileId = fields.getTextInputValue('mobile_channel');
  const logsId = fields.getTextInputValue('logs_channel');

  if (!guild.channels.cache.has(pcId) || !guild.channels.cache.has(mobileId) || !guild.channels.cache.has(logsId)) {
    return interaction.reply({ content: '❌ Um ou mais IDs de canal não existem neste servidor.', flags: [64] });
  }

  await Config.findOneAndUpdate(
    { guildId: guild.id },
    { 
      $set: { 'channels.pc': pcId, 'channels.mobile': mobileId, 'channels.logs': logsId },
      lastUpdated: new Date(), updatedBy: getCurrentUser(interaction)
    },
    { upsert: true }
  );

  return interaction.reply({ content: '✅ Canais Principais atualizados!', flags: [64] });
}

async function saveChannels2(interaction) {
  const { fields, guild } = interaction;
  const logId = fields.getTextInputValue('log_admin_channel');
  const analysisId = fields.getTextInputValue('analysis_channel');
  const topDailyId = fields.getTextInputValue('top_daily_channel');

  await Config.findOneAndUpdate(
    { guildId: guild.id },
    { 
      $set: { 'channels.log': logId, 'channels.analysis': analysisId, 'channels.topDaily': topDailyId },
      lastUpdated: new Date(), updatedBy: getCurrentUser(interaction)
    },
    { upsert: true }
  );

  return interaction.reply({ content: '✅ Canais Administrativos atualizados!', flags: [64] });
}

async function saveRoles1(interaction) {
  const { fields, guild } = interaction;
  const permitidoId = fields.getTextInputValue('permitido_role');
  const pcId = fields.getTextInputValue('pc_role');

  if (!guild.roles.cache.has(permitidoId) || !guild.roles.cache.has(pcId)) {
    return interaction.reply({ content: '❌ Um ou mais IDs de cargo não existem.', flags: [64] });
  }

  await Config.findOneAndUpdate(
    { guildId: guild.id },
    { 
      $set: { 'roles.permitido': permitidoId, 'roles.pc': pcId },
      lastUpdated: new Date(), updatedBy: getCurrentUser(interaction)
    },
    { upsert: true }
  );

  return interaction.reply({ content: '✅ Cargos Principais atualizados!', flags: [64] });
}

async function saveRoles2(interaction) {
  const { fields, guild } = interaction;
  const adminId = fields.getTextInputValue('admin_role');
  const respId = fields.getTextInputValue('resp_admin_role');

  await Config.findOneAndUpdate(
    { guildId: guild.id },
    { 
      $set: { 'roles.administrador': adminId, 'roles.responsavel_admin': respId },
      lastUpdated: new Date(), updatedBy: getCurrentUser(interaction)
    },
    { upsert: true }
  );

  return interaction.reply({ content: '✅ Cargos Administrativos atualizados!', flags: [64] });
}


async function createPanelSelectMenu(interaction) {
  const options = [
    { label: '📋 Ver Todas as Configurações', value: 'view_config', description: 'Status atual do servidor', emoji: '📋' },
    { label: '📺 Canais Principais', value: 'edit_channels_1', description: 'PC, Mobile e Cadeia Staff', emoji: '🖥️' },
    { label: '📊 Canais Administrativos', value: 'edit_channels_2', description: 'Log Admin, Análise e Top Diário', emoji: '📊' },
    { label: '👥 Cargos Principais', value: 'edit_roles_1', description: 'Cargos Mobile e PC', emoji: '👥' },
    { label: '👑 Cargos Administrativos', value: 'edit_roles_2', description: 'Admin e Responsável Admin', emoji: '👑' }
  ];

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('panel_menu').setPlaceholder('⚙️ Escolha uma categoria...').addOptions(options)
  );
}

async function handlePainelCommand(message) {
  if (!await hasPermission(message)) return message.reply({ content: '🚫 Sem permissão.', flags: [64] });

  const config = await Config.findOne({ guildId: message.guild.id });
  const menu = await createPanelSelectMenu(message);

  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('⚙️ Painel de Configurações')
    .setDescription([
      '**📺 Canais:**',
      `> 🖥️ **PC:** ${getChannelName(message, config?.channels?.pc)}`,
      `> 📱 **Mobile:** ${getChannelName(message, config?.channels?.mobile)}`,
      `> 📝 **Cadeia Staff:** ${getChannelName(message, config?.channels?.logs)}`,
      '',
      '**👥 Cargos:**',
      `> 📱 **Mobile:** ${getRoleName(message, config?.roles?.permitido)}`,
      `> 🖥️ **PC:** ${getRoleName(message, config?.roles?.pc)}`,
      '',
      'Escolha uma opção no menu abaixo para editar.'
    ].join('\n'))
    .setTimestamp()
    .setFooter({ text: 'Esta mensagem expira em 5 minutos.' });

  const reply = await message.reply({ embeds: [embed], components: [menu], flags: [64] });
  setTimeout(() => reply.delete().catch(() => {}), MESSAGE_TIMEOUT);
}

async function showConfig(interaction) {
  const config = await Config.findOne({ guildId: interaction.guild.id });
  if (!config) return interaction.reply({ content: '⚠️ Configure o servidor primeiro.', flags: [64] });

  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('🛠️ Configurações Atuais')
    .addFields(
      { name: '📺 Canais', value: [
        `🖥️ PC: <#${config.channels.pc}>`,
        `📱 Mobile: <#${config.channels.mobile}>`,
        `📝 Cadeia: <#${config.channels.logs}>`,
        `📋 Log Admin: <#${config.channels.log || 'N/A'}>`,
        `🗂️ Análise: <#${config.channels.analysis || 'N/A'}>`,
        `📊 Top Diário: <#${config.channels.topDaily || 'N/A'}>`
      ].join('\n') },
      { name: '🎭 Cargos', value: [
        `📱 Mobile: <@&${config.roles.permitido}>`,
        `🖥️ PC: <@&${config.roles.pc}>`,
        `👑 Admin: <@&${config.roles.administrador || 'N/A'}>`,
        `👤 Resp Admin: <@&${config.roles.responsavel_admin || 'N/A'}>`
      ].join('\n') }
    );

  await interaction.reply({ embeds: [embed], flags: [64] });
}

module.exports = {
  handlePainelCommand,
  showConfig,
  saveChannels1,
  saveChannels2,
  saveRoles1,
  saveRoles2,
  createChannelsModal1,
  createChannelsModal2,
  createRolesModal1,
  createRolesModal2,
  hasPermission
};