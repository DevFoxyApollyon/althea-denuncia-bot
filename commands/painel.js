// painel.js
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
const { getUsuariosIsentos, salvarUsuariosIsentos, normalizarIds } = require('../utils/usuariosIsentos');
require('dotenv').config();
 
const MESSAGE_TIMEOUT = 5 * 60 * 1000; 
const SUPORTE_BOT_ID = process.env.SUPORTE_BOT_ID;
const panelConfigCache = new Map();
const panelExemptUsersCache = new Map();

function cachePanelConfig(guildId, config) {
  if (!config) {
    panelConfigCache.delete(guildId);
    return;
  }

  panelConfigCache.set(guildId, config);
}

function getPanelConfig(guildId) {
  return panelConfigCache.get(guildId) || null;
}

function cachePanelExemptUsers(guildId, userIds) {
  panelExemptUsersCache.set(guildId, [...userIds]);
}

function getPanelExemptUsers(guildId) {
  return panelExemptUsersCache.get(guildId) || [];
}


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

function getExternalChannelName(channelId) {
  return channelId ? `<#${channelId}> \`${channelId}\`` : '`Não configurado`';
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
  const backup = new TextInputBuilder().setCustomId('backup_channel').setLabel('Canal de Backup').setStyle(TextInputStyle.Short).setRequired(false).setValue(currentConfig?.channels?.backup || '');
  const armazem = new TextInputBuilder().setCustomId('armazem_channel').setLabel('Canal Armazem').setStyle(TextInputStyle.Short).setRequired(false).setValue(currentConfig?.channels?.armazem || '');
  const analysis = new TextInputBuilder().setCustomId('analysis_channel').setLabel('Canal de Análise').setStyle(TextInputStyle.Short).setRequired(false).setValue(currentConfig?.channels?.analysis || '');
  const topDaily = new TextInputBuilder().setCustomId('top_daily_channel').setLabel('Canal do Top Diário').setStyle(TextInputStyle.Short).setRequired(false).setValue(currentConfig?.channels?.topDaily || '');

  return modal.addComponents(
    new ActionRowBuilder().addComponents(logAdmin),
    new ActionRowBuilder().addComponents(backup),
    new ActionRowBuilder().addComponents(armazem),
    new ActionRowBuilder().addComponents(analysis),
    new ActionRowBuilder().addComponents(topDaily)
  );
}

function createChannelsModal3(currentConfig = null) {
  const modal = new ModalBuilder().setCustomId('channels_modal_3').setTitle('Canais Externos');
  const registro = new TextInputBuilder().setCustomId('registro_channel').setLabel('Canal Registro (outro servidor)').setStyle(TextInputStyle.Short).setRequired(false).setValue(currentConfig?.channels?.registro || '');
  const cloud = new TextInputBuilder().setCustomId('cloud_channel').setLabel('Canal Cloud (outro servidor)').setStyle(TextInputStyle.Short).setRequired(false).setValue(currentConfig?.channels?.cloud || '');
  const canalDenuncia = new TextInputBuilder().setCustomId('canal_denuncia_channel').setLabel('Canal fixo de Denúncias').setStyle(TextInputStyle.Short).setRequired(false).setValue(currentConfig?.channels?.canalDenuncia || '');

  return modal.addComponents(
    new ActionRowBuilder().addComponents(registro),
    new ActionRowBuilder().addComponents(cloud),
    new ActionRowBuilder().addComponents(canalDenuncia)
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

function createExemptUsersModal(userIds = []) {
  const modal = new ModalBuilder()
    .setCustomId('global_exempt_users_modal')
    .setTitle('Usuários isentos globalmente');
  const usersInput = new TextInputBuilder()
    .setCustomId('exempt_user_ids')
    .setLabel('IDs Discord separados por vírgula')
    .setPlaceholder('123456789012345678, 987654321098765432')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(4000)
    .setValue(userIds.join(', '));

  return modal.addComponents(new ActionRowBuilder().addComponents(usersInput));
}

async function saveExemptUsers(interaction) {
  const rawIds = interaction.fields.getTextInputValue('exempt_user_ids');
  const normalizedIds = normalizarIds(rawIds);
  if (rawIds.trim() && normalizedIds.length === 0) {
    throw new Error('nenhum ID Discord válido foi informado');
  }

  const config = await salvarUsuariosIsentos(normalizedIds, getCurrentUser(interaction));
  cachePanelExemptUsers(interaction.guild.id, config.usuariosIsentos);
  return config.usuariosIsentos;
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
      $set: {
        'channels.log': logId,
        'channels.backup': fields.getTextInputValue('backup_channel').trim(),
        'channels.armazem': fields.getTextInputValue('armazem_channel').trim(),
        'channels.analysis': analysisId,
        'channels.topDaily': topDailyId
      },
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


function encodePanelOption(baseValue, values = []) {
  return [baseValue, ...values.map(value => value || '')].join('|');
}

async function createPanelSelectMenu(interaction, currentConfig = null) {
  const channels = currentConfig?.channels || {};
  const roles = currentConfig?.roles || {};
  const options = [
    { label: 'Ver configurações', value: 'view_config', description: 'Visualizar o estado atual do servidor', emoji: '📋' },
    { label: 'Usuários isentos', value: 'edit_exempt_users', description: 'Lista global de usuários sem bloqueios', emoji: '🛡️' },
    { label: 'Canais principais', value: encodePanelOption('edit_channels_1', [channels.pc, channels.mobile, channels.logs]), description: 'PC, Mobile e Cadeia Staff', emoji: '📌' },
    { label: 'Canais administrativos', value: encodePanelOption('edit_channels_2', [channels.log, channels.backup, channels.armazem, channels.analysis, channels.topDaily]), description: 'Log, backup, armazém, análise e top diário', emoji: '🛠️' },
    { label: 'Canais externos', value: encodePanelOption('edit_channels_3', [channels.registro, channels.cloud, channels.canalDenuncia]), description: 'Registro, cloud e canal fixo de denúncias', emoji: '🌐' },
    { label: 'Cargos principais', value: encodePanelOption('edit_roles_1', [roles.permitido, roles.pc]), description: 'Cargos Mobile e PC', emoji: '👥' },
    { label: 'Cargos administrativos', value: encodePanelOption('edit_roles_2', [roles.administrador, roles.responsavel_admin]), description: 'Administrador e responsável', emoji: '🧑‍💼' }
  ];

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('panel_menu').setPlaceholder('⚙️ Escolha uma categoria...').addOptions(options)
  );
}

async function handlePainelCommand(message) {
  if (!await hasPermission(message)) return message.reply({ content: '❌ Sem permissão.', flags: [64] });

  const [config, exemptUsers] = await Promise.all([
    Config.findOne({ guildId: message.guild.id }),
    getUsuariosIsentos()
  ]);
  cachePanelConfig(message.guild.id, config);
  cachePanelExemptUsers(message.guild.id, exemptUsers);
  const menu = await createPanelSelectMenu(message, config);

  const embed = new EmbedBuilder()
    .setColor('#2B2D31')
    .setAuthor({ name: `${message.guild.name} • Central de Configuração`, iconURL: message.guild.iconURL() || undefined })
    .setTitle('⚙️ Painel de Configurações')
    .setDescription('Gerencie os canais e cargos usados pelo sistema de denúncias.\nUse o menu abaixo para consultar ou editar os registros salvos.')
    .addFields(
      {
        name: '📌 Canais principais',
        value: [
          `🖥️ **PC** ${getChannelName(message, config?.channels?.pc)}`,
          `📱 **Mobile** ${getChannelName(message, config?.channels?.mobile)}`,
          `🧾 **Cadeia Staff** ${getChannelName(message, config?.channels?.logs)}`
        ].join('\n'),
        inline: false
      },
      {
        name: '🛠️ Canais administrativos',
        value: [
          `📋 **Log Admin** ${getChannelName(message, config?.channels?.log)}`,
          `💾 **Backup** ${getChannelName(message, config?.channels?.backup)}`,
          `🗄️ **Armazem** ${getChannelName(message, config?.channels?.armazem)}`,
          `🌐 **Registro externo** ${getExternalChannelName(config?.channels?.registro)}`,
          `☁️ **Cloud externo** ${getExternalChannelName(config?.channels?.cloud)}`,
          `📣 **Canal de denúncias** ${getExternalChannelName(config?.channels?.canalDenuncia)}`,
          `🔎 **Análise** ${getChannelName(message, config?.channels?.analysis)}`,
          `🏆 **Top Diário** ${getChannelName(message, config?.channels?.topDaily)}`
        ].join('\n'),
        inline: false
      },
      {
        name: '👥 Cargos',
        value: [
          `📱 **Mobile** ${getRoleName(message, config?.roles?.permitido)}`,
          `🖥️ **PC** ${getRoleName(message, config?.roles?.pc)}`,
          `🧑‍💼 **Administrador** ${getRoleName(message, config?.roles?.administrador)}`,
          `🧑‍🔧 **Responsável** ${getRoleName(message, config?.roles?.responsavel_admin)}`
        ].join('\n'),
        inline: false
      },
      {
        name: '🛡️ Isenções globais',
        value: `**${exemptUsers.length}** usuário(s) isento(s) de filtros e restrições em todos os servidores.`,
        inline: false
      },
    )
    .setTimestamp()
    .setFooter({ text: 'Painel temporário • expira em 5 minutos' });

  const reply = await message.reply({ embeds: [embed], components: [menu], flags: [64] });
  setTimeout(() => reply.delete().catch(() => {}), MESSAGE_TIMEOUT);
}

async function showConfig(interaction, currentConfig = null) {
  const config = currentConfig || await Config.findOne({ guildId: interaction.guild.id });
  const respond = interaction.deferred ? interaction.editReply.bind(interaction) : interaction.reply.bind(interaction);
  if (!config) return respond({ content: '⚠️ Configure o servidor primeiro.' });

  const embed = new EmbedBuilder()
    .setColor('#2B2D31')
    .setTitle('📋 Configurações Atuais')
    .addFields(
      { name: '📌 Canais principais', value: [
        `🖥️ **PC** ${getChannelName(interaction, config.channels.pc)}`,
        `📱 **Mobile** ${getChannelName(interaction, config.channels.mobile)}`,
        `🧾 **Cadeia Staff** ${getChannelName(interaction, config.channels.logs)}`
      ].join('\n') },
      { name: '🛠️ Canais administrativos', value: [
        `📋 **Log Admin** ${getChannelName(interaction, config.channels.log)}`,
        `💾 **Backup** ${getChannelName(interaction, config.channels.backup)}`,
        `🗄️ **Armazem** ${getChannelName(interaction, config.channels.armazem)}`,
        `🌐 **Registro externo** ${getExternalChannelName(config.channels.registro)}`,
        `☁️ **Cloud externo** ${getExternalChannelName(config.channels.cloud)}`,
        `📣 **Canal de denúncias** ${getExternalChannelName(config.channels.canalDenuncia)}`,
        `🔎 **Análise** ${getChannelName(interaction, config.channels.analysis)}`,
        `🏆 **Top Diário** ${getChannelName(interaction, config.channels.topDaily)}`
      ].join('\n') },
      { name: '🎖️ Cargos', value: [
        `📱 **Mobile** ${getRoleName(interaction, config.roles.permitido)}`,
        `🖥️ **PC** ${getRoleName(interaction, config.roles.pc)}`,
        `🧑‍💼 **Administrador** ${getRoleName(interaction, config.roles.administrador)}`,
        `🧑‍🔧 **Responsável** ${getRoleName(interaction, config.roles.responsavel_admin)}`
      ].join('\n') },
      { name: '🕒 Auditoria', value: `Última atualização: <t:${Math.floor(new Date(config.lastUpdated || Date.now()).getTime() / 1000)}:R>\nResponsável: **${config.updatedBy || 'Sistema'}**` }
    );

  await respond({ embeds: [embed] });
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
  createChannelsModal3,
  createRolesModal1,
  createRolesModal2,
  createExemptUsersModal,
  saveExemptUsers,
  hasPermission,
  cachePanelConfig,
  getPanelConfig,
  cachePanelExemptUsers,
  getPanelExemptUsers
};