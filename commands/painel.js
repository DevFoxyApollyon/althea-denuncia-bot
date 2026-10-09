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
const { getConfig } = require('../utils/configCache');
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


async function hasPermission(interaction, currentConfig) {
  const membro = interaction.member;
  const temPermissaoAdmin = membro?.permissions?.has?.(PermissionFlagsBits.Administrator) ?? false;
  const usuarioId = interaction.user?.id || interaction.author?.id;
  const guildId = interaction.guild?.id;

  if (temPermissaoAdmin || (SUPORTE_BOT_ID && usuarioId === SUPORTE_BOT_ID)) return true;
  if (!guildId || !membro?.roles?.cache) return false;

  const config = currentConfig === undefined
    ? getPanelConfig(guildId) || await getConfig(guildId)
    : currentConfig;
  const responsavelAdminId = config?.roles?.responsavel_admin;
  return Boolean(responsavelAdminId && membro.roles.cache.has(responsavelAdminId));
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
  return `<@&${roleId}> \`${roleId}\``;
}


function createChannelsModal1(currentConfig = null) {
  const modal = new ModalBuilder().setCustomId('channels_modal_1').setTitle('Canais principais | Parte 1');
  const pc = new TextInputBuilder()
    .setCustomId('pc_channel').setLabel('ID do canal de denúncias PC')
    .setPlaceholder('Cole aqui o ID numérico do canal PC')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(25)
    .setValue(currentConfig?.channels?.pc || '');
  const mobile = new TextInputBuilder()
    .setCustomId('mobile_channel').setLabel('ID do canal de denúncias Mobile')
    .setPlaceholder('Cole aqui o ID numérico do canal Mobile')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(25)
    .setValue(currentConfig?.channels?.mobile || '');
  const logs = new TextInputBuilder()
    .setCustomId('logs_channel').setLabel('ID da Cadeia Staff')
    .setPlaceholder('Canal onde a equipe acompanha as denúncias')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(25)
    .setValue(currentConfig?.channels?.logs || '');

  return modal.addComponents(
    new ActionRowBuilder().addComponents(pc),
    new ActionRowBuilder().addComponents(mobile),
    new ActionRowBuilder().addComponents(logs)
  );
}

function createChannelsModal2(currentConfig = null) {
  const modal = new ModalBuilder().setCustomId('channels_modal_2').setTitle('Canais administrativos | Parte 2');
  const logAdmin = new TextInputBuilder()
    .setCustomId('log_admin_channel').setLabel('ID do log administrativo')
    .setPlaceholder('Registros de ações e decisões da moderação')
    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(25)
    .setValue(currentConfig?.channels?.log || '');
  const backup = new TextInputBuilder()
    .setCustomId('backup_channel').setLabel('ID do canal de backup')
    .setPlaceholder('Destino adicional para os arquivos arquivados')
    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(25)
    .setValue(currentConfig?.channels?.backup || '');
  const armazem = new TextInputBuilder()
    .setCustomId('armazem_channel').setLabel('ID do armazém de denúncias')
    .setPlaceholder('Canal usado para armazenar cópias')
    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(25)
    .setValue(currentConfig?.channels?.armazem || '');
  const analysis = new TextInputBuilder()
    .setCustomId('analysis_channel').setLabel('ID do canal de análise')
    .setPlaceholder('Canal onde denúncias em análise são publicadas')
    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(25)
    .setValue(currentConfig?.channels?.analysis || '');
  const topDaily = new TextInputBuilder()
    .setCustomId('top_daily_channel').setLabel('ID do canal Top Diário')
    .setPlaceholder('Canal onde o ranking diário será enviado')
    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(25)
    .setValue(currentConfig?.channels?.topDaily || '');

  return modal.addComponents(
    new ActionRowBuilder().addComponents(logAdmin),
    new ActionRowBuilder().addComponents(backup),
    new ActionRowBuilder().addComponents(armazem),
    new ActionRowBuilder().addComponents(analysis),
    new ActionRowBuilder().addComponents(topDaily)
  );
}

function createChannelsModal3(currentConfig = null) {
  const modal = new ModalBuilder().setCustomId('channels_modal_3').setTitle('Canais externos e espelhos');
  const registro = new TextInputBuilder()
    .setCustomId('registro_channel').setLabel('ID do canal externo de registro')
    .setPlaceholder('Canal de registro em outro servidor')
    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(25)
    .setValue(currentConfig?.channels?.registro || '');
  const cloud = new TextInputBuilder()
    .setCustomId('cloud_channel').setLabel('ID do canal Cloud externo')
    .setPlaceholder('Canal principal para arquivamento Cloud')
    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(25)
    .setValue(currentConfig?.channels?.cloud || '');
  const canalDenuncia = new TextInputBuilder()
    .setCustomId('canal_denuncia_channel').setLabel('ID do canal fixo de denúncias')
    .setPlaceholder('Canal central para abrir novas denúncias')
    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(25)
    .setValue(currentConfig?.channels?.canalDenuncia || '');

  return modal.addComponents(
    new ActionRowBuilder().addComponents(registro),
    new ActionRowBuilder().addComponents(cloud),
    new ActionRowBuilder().addComponents(canalDenuncia)
  );
}

function createRolesModal1(currentConfig = null) {
  const modal = new ModalBuilder().setCustomId('roles_modal_1').setTitle('Cargos de acesso | Parte 1');
  const permitido = new TextInputBuilder()
    .setCustomId('permitido_role').setLabel('ID do cargo permitido Mobile')
    .setPlaceholder('Cargo que pode abrir denúncias Mobile')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(25)
    .setValue(currentConfig?.roles?.permitido || '');
  const pc = new TextInputBuilder()
    .setCustomId('pc_role').setLabel('ID do cargo permitido PC')
    .setPlaceholder('Cargo que pode abrir denúncias PC')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(25)
    .setValue(currentConfig?.roles?.pc || '');

  return modal.addComponents(
    new ActionRowBuilder().addComponents(permitido),
    new ActionRowBuilder().addComponents(pc)
  );
}

function createRolesModal2(currentConfig = null) {
  const modal = new ModalBuilder().setCustomId('roles_modal_2').setTitle('Cargos administrativos | Parte 2');
  const admin = new TextInputBuilder()
    .setCustomId('admin_role').setLabel('ID do cargo Administrador')
    .setPlaceholder('Cargo para ações gerais de moderação')
    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(25)
    .setValue(currentConfig?.roles?.administrador || '');
  const resp = new TextInputBuilder()
    .setCustomId('resp_admin_role').setLabel('ID do cargo Responsável Admin')
    .setPlaceholder('Cargo com permissão para finalizar denúncias')
    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(25)
    .setValue(currentConfig?.roles?.responsavel_admin || '');

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
    .setLabel('IDs Discord isentos, separados por vírgula')
    .setPlaceholder('Ex.: 123456789012345678, 987654321098765432')
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

function bloqueioPendentesAtivo(config) {
  return config?.bloquearReivindicacaoComPendentes !== false;
}

function buildPanelEmbed(interaction, config, exemptUsers = []) {
  const maintenance = Boolean(config?.manutencaoDenuncia);
  const bloqueioAtivo = bloqueioPendentesAtivo(config);
  return new EmbedBuilder()
    .setColor(maintenance ? '#F0A500' : '#2B2D31')
    .setTitle('⚙️ Painel de Configurações')
    .setDescription([
      'Gerencie os canais e cargos do sistema de denúncias.',
      '',
      maintenance ? '🛠️ **Status:** denúncias em manutenção' : '🟢 **Status:** denúncias disponíveis'
    ].join('\n'))
    .addFields(
      {
        name: '📌 Canais de entrada',
        value: [
          `🖥️ PC ${getChannelName(interaction, config?.channels?.pc)}`,
          `📱 Mobile ${getChannelName(interaction, config?.channels?.mobile)}`,
          `🧾 Cadeia Staff ${getChannelName(interaction, config?.channels?.logs)}`
        ].join('\n'),
        inline: true
      },
      {
        name: '📦 Armazenamento e logs',
        value: [
          `💾 Backup ${getChannelName(interaction, config?.channels?.backup)}`,
          `🗄️ Armazem ${getChannelName(interaction, config?.channels?.armazem)}`,
          `📋 Log Admin ${getChannelName(interaction, config?.channels?.log)}`
        ].join('\n'),
        inline: true
      },
      {
        name: '🌐 Canais externos',
        value: [
          `Registro ${getExternalChannelName(config?.channels?.registro)}`,
          `Cloud ${getExternalChannelName(config?.channels?.cloud)}`,
          `Canal de denúncias ${getExternalChannelName(config?.channels?.canalDenuncia)}`
        ].join('\n'),
        inline: false
      },
      {
        name: '👥 Cargos',
        value: [
          `📱 Mobile ${getRoleName(interaction, config?.roles?.permitido)}`,
          `🖥️ PC ${getRoleName(interaction, config?.roles?.pc)}`,
          `🧑‍💼 Administrador ${getRoleName(interaction, config?.roles?.administrador)}`,
          `🧑‍🔧 Responsável ${getRoleName(interaction, config?.roles?.responsavel_admin)}`
        ].join('\n'),
        inline: true
      },
      {
        name: '🛡️ Isenções',
        value: `**${exemptUsers.length}** usuário(s) isento(s)`,
        inline: true
      },
      {
        name: '⏳ Pendências anteriores',
        value: bloqueioAtivo ? '🟢 **Bloqueio ativado**' : '⚪ **Bloqueio desativado**',
        inline: true
      }
    )
    .setFooter({ text: 'Selecione uma categoria abaixo para editar' })
    .setTimestamp();
}

async function atualizarPainelMensagem(interaction, config) {
  if (!interaction.message?.edit) return;
  const exemptUsers = getPanelExemptUsers(interaction.guild.id);
  await interaction.message.edit({
    embeds: [buildPanelEmbed(interaction, config, exemptUsers)],
    components: [await createPanelSelectMenu(interaction, config)]
  }).catch(() => {});
}

async function atualizarPainelCategoria(interaction, category, config) {
  if (!interaction.message?.edit) return;
  const exemptUsers = getPanelExemptUsers(interaction.guild.id);
  const titles = {
    edit_exempt_users: ['🛡️ Usuários isentos', `**${exemptUsers.length}** usuário(s) configurado(s)`, 'IDs salvos na lista global de isenções.'],
    edit_channels_1: ['📌 Canais principais', [
      `🖥️ PC: ${getChannelName(interaction, config?.channels?.pc)}`,
      `📱 Mobile: ${getChannelName(interaction, config?.channels?.mobile)}`,
      `🧾 Cadeia Staff: ${getChannelName(interaction, config?.channels?.logs)}`
    ].join('\n'), 'Canais usados para receber as denúncias.'],
    edit_channels_2: ['📦 Canais administrativos', [
      `📋 Log Admin: ${getChannelName(interaction, config?.channels?.log)}`,
      `💾 Backup: ${getChannelName(interaction, config?.channels?.backup)}`,
      `🗄️ Armazem: ${getChannelName(interaction, config?.channels?.armazem)}`,
      `🔎 Análise: ${getChannelName(interaction, config?.channels?.analysis)}`,
      `🏆 Top Diário: ${getChannelName(interaction, config?.channels?.topDaily)}`
    ].join('\n'), 'Canais locais de log, backup e análise.'],
    edit_channels_3: ['🌐 Canais externos', [
      `Registro: ${getExternalChannelName(config?.channels?.registro)}`,
      `Cloud: ${getExternalChannelName(config?.channels?.cloud)}`,
      `Canal de denúncias: ${getExternalChannelName(config?.channels?.canalDenuncia)}`
    ].join('\n'), 'Canais externos usados para espelhamento e arquivamento.'],
    edit_roles_1: ['👥 Cargos principais', [
      `📱 Mobile: ${getRoleName(interaction, config?.roles?.permitido)}`,
      `🖥️ PC: ${getRoleName(interaction, config?.roles?.pc)}`
    ].join('\n'), 'Cargos necessários para abrir cada tipo de denúncia.'],
    edit_roles_2: ['🧑‍💼 Cargos administrativos', [
      `🧑‍💼 Administrador: ${getRoleName(interaction, config?.roles?.administrador)}`,
      `🧑‍🔧 Responsável: ${getRoleName(interaction, config?.roles?.responsavel_admin)}`
    ].join('\n'), 'Cargos usados nas ações administrativas.']
  }[category] || ['⚙️ Configuração', 'Nenhuma categoria selecionada.', ''];

  await interaction.message.edit({
    embeds: [new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle(titles[0])
      .setDescription(`${titles[1]}\n\n${titles[2]}\n\nEdite os dados no formulário que será aberto.`)
      .setFooter({ text: 'Sistema Althea • Painel de configurações' })
      .setTimestamp()],
    components: [await createPanelSelectMenu(interaction, config)]
  }).catch(() => {});
}

async function createPanelSelectMenu(interaction, currentConfig = null) {
  const channels = currentConfig?.channels || {};
  const roles = currentConfig?.roles || {};
  const options = [
    { label: 'Ver configurações', value: 'view_config', description: 'Visualizar o estado atual do servidor', emoji: '📋' },
    { label: 'Usuários isentos', value: 'edit_exempt_users', description: 'Lista global de usuários sem bloqueios', emoji: '🛡️' },
    { label: 'Canais principais', value: 'edit_channels_1', description: 'PC, Mobile e Cadeia Staff', emoji: '📌' },
    { label: 'Canais administrativos', value: 'edit_channels_2', description: 'Log, backup, armazém, análise e top diário', emoji: '🛠️' },
    { label: 'Canais externos', value: 'edit_channels_3', description: 'Registro, cloud e canal fixo de denúncias', emoji: '🌐' },
    { label: 'Manutenção de denúncias', value: 'toggle_maintenance', description: currentConfig?.manutencaoDenuncia ? 'Desativar manutenção' : 'Ativar manutenção', emoji: '🛠️' },
    { label: 'Bloqueio de pendências anteriores', value: 'toggle_pending_claim_block', description: bloqueioPendentesAtivo(currentConfig) ? 'Desativar neste servidor' : 'Ativar neste servidor', emoji: '⏳' },
    { label: 'Cargos principais', value: 'edit_roles_1', description: 'Cargos Mobile e PC', emoji: '👥' },
    { label: 'Cargos administrativos', value: 'edit_roles_2', description: 'Administrador e responsável', emoji: '🧑‍💼' }
  ];

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('panel_menu').setPlaceholder('⚙️ Escolha uma categoria...').addOptions(options)
  );
}

// "message" pode ser a Message do !painel ou a interação do /painel: as duas
// têm guild, member e user/author, que é tudo o que o painel consulta.
async function abrirPainel(message, { negar, enviar }) {
  if (!message?.guild) return;
  if (!await hasPermission(message)) return negar('❌ Sem permissão.');

  try {
    const [config, exemptUsers] = await Promise.all([
      Config.findOne({ guildId: message.guild.id }),
      getUsuariosIsentos()
    ]);
    const usuariosIsentos = Array.isArray(exemptUsers) ? exemptUsers : [];
    cachePanelConfig(message.guild.id, config);
    cachePanelExemptUsers(message.guild.id, usuariosIsentos);
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
        value: `**${usuariosIsentos.length}** usuário(s) isento(s) de filtros e restrições em todos os servidores.`,
        inline: false
      },
      {
        name: '🛠️ Estado do sistema',
        value: config?.manutencaoDenuncia ? '🔴 **Denúncias em manutenção**' : '🟢 **Denúncias disponíveis**',
        inline: false
      },
      {
        name: '⏳ Pendências anteriores',
        value: bloqueioPendentesAtivo(config)
          ? '🟢 **Bloqueio ativado neste servidor**'
          : '⚪ **Bloqueio desativado neste servidor**',
        inline: false
      },
    )
    .setTimestamp()
    .setFooter({ text: 'Painel temporário • expira em 5 minutos' });

    const reply = await enviar({ embeds: [embed], components: [menu] });
    setTimeout(() => reply.delete().catch(() => {}), MESSAGE_TIMEOUT);
  } catch (error) {
    console.error('[Painel] Falha ao montar/enviar painel:', error?.stack || error);
    await negar('❌ Não foi possível abrir o painel. Verifique os logs do bot.').catch(() => {});
  }
}

async function handlePainelCommand(message) {
  return abrirPainel(message, {
    negar: (content) => message.reply({ content }),
    enviar: (payload) => message.reply(payload)
  });
}

// O painel não é efêmero: os menus editam a própria mensagem do painel
// (interaction.message.edit), o que o Discord não permite em mensagens efêmeras.
async function handlePainelSlash(interaction) {
  return abrirPainel(interaction, {
    negar: (content) => (interaction.replied || interaction.deferred
      ? interaction.followUp({ content, flags: [64] })
      : interaction.reply({ content, flags: [64] })),
    enviar: async (payload) => {
      await interaction.reply(payload);
      return interaction.fetchReply();
    }
  });
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
      { name: '🛠️ Estado do sistema', value: config.manutencaoDenuncia ? '🔴 **Denúncias em manutenção**' : '🟢 **Denúncias disponíveis**' },
      { name: '⏳ Pendências anteriores', value: bloqueioPendentesAtivo(config) ? '🟢 **Bloqueio ativado neste servidor**' : '⚪ **Bloqueio desativado neste servidor**' },
      { name: '🕒 Auditoria', value: `Última atualização: <t:${Math.floor(new Date(config.lastUpdated || Date.now()).getTime() / 1000)}:R>\nResponsável: **${config.updatedBy || 'Sistema'}**` }
    );

  await respond({ embeds: [embed] });
}

module.exports = {
  handlePainelCommand,
  handlePainelSlash,
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
  atualizarPainelMensagem,
  atualizarPainelCategoria,
  bloqueioPendentesAtivo,
  cachePanelExemptUsers,
  getPanelExemptUsers
};