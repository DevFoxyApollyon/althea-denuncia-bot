const { InteractionType, PermissionFlagsBits } = require('discord.js');
const Config = require('../models/Config');

const {
  handleDenunciaCommand,
  handleDenunciaPC,
  handleDenunciaMobile,
  handleModalSubmit, 
  handleMyDenunciasButton,    
  handleConsultaModalSubmit,
  atualizarMensagemDenuncia
} = require('../commands/denuncia');

const {
  handleStatusButton,
  handlePunishmentModal,
  handleClaimButton,
  handleAddPlayer,
  handleAddPlayerModal,
  handleLogAceitarButton,
  handleLogRecusarButton
} = require('../Handlers/handlerStatusButton');

const { handleExportButton } = require('../Handlers/exportDenuncia');

const {
  handleCorrigirDenunciaButton,
  handleSalvarCorrigirDenuncia
} = require('./corrigirHandler');

const {
  createChannelsModal1,
  createChannelsModal2,
  createChannelsModal3,
  createRolesModal1,
  createRolesModal2,
  createExemptUsersModal,
  atualizarPainelMensagem,
  atualizarPainelCategoria,
  saveExemptUsers,
  showConfig,
  hasPermission,
  cachePanelConfig,
  getPanelConfig,
  getPanelExemptUsers,
  bloqueioPendentesAtivo
} = require('../commands/painel');

const { handleStatusButtons } = require('../commands/status');
const { handleFeedbackMenu, handleFeedbackModal } = require('../utils/feedback');
const { getCachedConfig, invalidateCache } = require('../utils/performance');
const Denuncia = require('../models/Denuncia');

async function handlePanelModalSubmit(interaction) {
  try {
    await interaction.deferReply({ flags: 64 });
    const fields = interaction.fields;
    let config = await Config.findOne({ guildId: interaction.guild.id });

    if (!config) {
      config = new Config({
        guildId: interaction.guild.id,
        channels: { pc: '', mobile: '', logs: '', log: '', backup: '', armazem: '', registro: '', cloud: '', canalDenuncia: '', analysis: '', topDaily: '' },
        roles: { permitido: '', pc: '', administrador: '', responsavel_admin: '' },
        updatedBy: interaction.user.tag
      });
    }

    switch (interaction.customId) {
      case 'channels_modal_1':
        config.channels.pc = fields.getTextInputValue('pc_channel').trim();
        config.channels.mobile = fields.getTextInputValue('mobile_channel').trim();
        config.channels.logs = fields.getTextInputValue('logs_channel').trim();
        break;
      case 'channels_modal_2':
        config.channels.log = fields.getTextInputValue('log_admin_channel').trim();
        config.channels.backup = fields.getTextInputValue('backup_channel').trim();
        config.channels.armazem = fields.getTextInputValue('armazem_channel').trim();
        config.channels.analysis = fields.getTextInputValue('analysis_channel').trim();
        config.channels.topDaily = fields.getTextInputValue('top_daily_channel').trim();
        break;
      case 'channels_modal_3':
        config.channels.registro = fields.getTextInputValue('registro_channel').trim();
        config.channels.cloud = fields.getTextInputValue('cloud_channel').trim();
        config.channels.canalDenuncia = fields.getTextInputValue('canal_denuncia_channel').trim();
        break;
      case 'roles_modal_1':
        config.roles.permitido = fields.getTextInputValue('permitido_role').trim();
        config.roles.pc = fields.getTextInputValue('pc_role').trim();
        break;
      case 'roles_modal_2':
        config.roles.administrador = fields.getTextInputValue('admin_role').trim();
        config.roles.responsavel_admin = fields.getTextInputValue('resp_admin_role').trim();
        break;
      default:
        return;
    }

    config.lastUpdated = new Date();
    config.updatedBy = interaction.user.tag;
    await config.save();
    cachePanelConfig(interaction.guild.id, config);
    await atualizarPainelMensagem(interaction, config);

    await interaction.editReply({ content: '✅ Configuração salva com sucesso!' });

  } catch (error) {
    console.error('Erro ao processar modal do painel:', error);
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: '❌ Erro ao salvar configurações.' });
    } else {
      await interaction.reply({ content: '❌ Erro ao salvar configurações.', ephemeral: true });
    }
  }
}

async function handleGlobalExemptUsersSubmit(interaction) {
  try {
    if (!await hasPermission(interaction)) {
      return interaction.reply({ content: '❌ Sem permissão.', flags: [64] });
    }

    await interaction.deferReply({ flags: 64 });
    const users = await saveExemptUsers(interaction);
    const config = await Config.findOne({ guildId: interaction.guild.id });
    cachePanelConfig(interaction.guild.id, config);
    await atualizarPainelMensagem(interaction, config);
    await interaction.editReply({
      content: users.length
        ? `✅ Lista global atualizada com **${users.length}** usuário(s) isento(s).`
        : '✅ Lista global de usuários isentos foi esvaziada.'
    });
  } catch (error) {
    console.error('Erro ao salvar usuários isentos:', error);
    const errorMessage = error?.message?.includes('nenhum ID')
      ? error.message
      : '❌ Erro ao salvar usuários isentos. Verifique a conexão com o banco de dados.';
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: errorMessage });
    } else {
      await interaction.reply({ content: errorMessage, flags: [64] });
    }
  }
}

async function handlePanelMenu(interaction) {
  const cachedConfig = getPanelConfig(interaction.guild.id);
  const storedConfig = cachedConfig || await Config.findOne({ guildId: interaction.guild.id }).catch(() => null);
  if (!await hasPermission(interaction, storedConfig)) {
    return interaction.reply({ content: '❌ Sem permissão.', flags: [64] });
  }

  const [selectedOption, ...encodedValues] = interaction.values[0].split('|');
  const encodedConfig = {
    channels: {},
    roles: {}
  };

  if (selectedOption === 'edit_channels_1') {
    [encodedConfig.channels.pc, encodedConfig.channels.mobile, encodedConfig.channels.logs] = encodedValues;
  } else if (selectedOption === 'edit_channels_2') {
    [encodedConfig.channels.log, encodedConfig.channels.backup, encodedConfig.channels.armazem, encodedConfig.channels.analysis, encodedConfig.channels.topDaily] = encodedValues;
  } else if (selectedOption === 'edit_channels_3') {
    [encodedConfig.channels.registro, encodedConfig.channels.cloud, encodedConfig.channels.canalDenuncia] = encodedValues;
  } else if (selectedOption === 'edit_roles_1') {
    [encodedConfig.roles.permitido, encodedConfig.roles.pc] = encodedValues;
  } else if (selectedOption === 'edit_roles_2') {
    [encodedConfig.roles.administrador, encodedConfig.roles.responsavel_admin] = encodedValues;
  }

  const config = storedConfig || cachedConfig || encodedConfig;
  if (storedConfig) cachePanelConfig(interaction.guild.id, storedConfig);

  switch (selectedOption) {
    case 'toggle_maintenance': {
      const manutencaoDenuncia = !Boolean(config?.manutencaoDenuncia);
      await interaction.deferUpdate();
      const configAtualizada = await Config.findOneAndUpdate(
        { guildId: interaction.guild.id },
        { $set: { manutencaoDenuncia, lastUpdated: new Date(), updatedBy: interaction.user.tag } },
        { new: true, upsert: true }
      );
      invalidateCache('config', interaction.guild.id);
      cachePanelConfig(interaction.guild.id, configAtualizada);
      await atualizarMensagemDenuncia(interaction.client, interaction.guild, configAtualizada);
      await atualizarPainelMensagem(interaction, configAtualizada);
      await interaction.followUp({
        content: manutencaoDenuncia
          ? '🛠️ Modo manutenção ativado. Novos envios foram bloqueados.'
          : '✅ Modo manutenção desativado. Os botões foram restaurados.',
        flags: [64]
      }).catch(() => {});
      break;
    }
    case 'toggle_pending_claim_block': {
      const bloquearReivindicacaoComPendentes = !bloqueioPendentesAtivo(config);
      await interaction.deferUpdate();
      const configAtualizada = await Config.findOneAndUpdate(
        { guildId: interaction.guild.id },
        { $set: { bloquearReivindicacaoComPendentes, lastUpdated: new Date(), updatedBy: interaction.user.tag } },
        { new: true, upsert: true }
      );
      invalidateCache('config', interaction.guild.id);
      cachePanelConfig(interaction.guild.id, configAtualizada);
      await atualizarPainelMensagem(interaction, configAtualizada);
      await interaction.followUp({
        content: bloquearReivindicacaoComPendentes
          ? '✅ O bloqueio de reivindicação por pendências anteriores foi ativado neste servidor.'
          : '⚪ O bloqueio de reivindicação por pendências anteriores foi desativado neste servidor.',
        flags: [64]
      }).catch(() => {});
      break;
    }
    case 'view_config': {
      await interaction.deferUpdate();
      const config = await Config.findOne({ guildId: interaction.guild.id });
      cachePanelConfig(interaction.guild.id, config);
      await atualizarPainelMensagem(interaction, config);
      break;
    }
    case 'edit_exempt_users':
      await interaction.showModal(createExemptUsersModal(getPanelExemptUsers(interaction.guild.id)));
      await atualizarPainelCategoria(interaction, selectedOption, config);
      break;
    case 'edit_channels_1':
      await interaction.showModal(createChannelsModal1(config));
      await atualizarPainelCategoria(interaction, selectedOption, config);
      break;
    case 'edit_channels_2':
      await interaction.showModal(createChannelsModal2(config));
      await atualizarPainelCategoria(interaction, selectedOption, config);
      break;
    case 'edit_channels_3':
      await interaction.showModal(createChannelsModal3(config));
      await atualizarPainelCategoria(interaction, selectedOption, config);
      break;
    case 'edit_roles_1':
      await interaction.showModal(createRolesModal1(config));
      await atualizarPainelCategoria(interaction, selectedOption, config);
      break;
    case 'edit_roles_2':
      await interaction.showModal(createRolesModal2(config));
      await atualizarPainelCategoria(interaction, selectedOption, config);
      break;
    default:
      await interaction.reply({ content: '❌ Opção do painel inválida.', flags: [64] });
  }
}

// =========================
// HANDLER PRINCIPAL
// =========================
async function interactionHandler(interaction) {
  try {

    // ======== FEEDBACK SELECT MENU ========
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('feedback:select:')) {
      try {
        await handleFeedbackMenu(interaction);
      } catch (err) {
        console.error('Erro no feedback select:', err);
        if (err?.code === 10062) return;
        if (interaction.replied || interaction.deferred) await interaction.editReply({ content: '❌ Erro ao processar feedback.' }).catch(() => {});
        else await interaction.reply({ content: '❌ Erro ao processar feedback.', flags: [64] }).catch(() => {});
      }
      return;
    }

    // ======== MENU DO PAINEL ========
    if (interaction.isStringSelectMenu() && interaction.customId === 'panel_menu') {
      await handlePanelMenu(interaction);
      return;
    }

    // ======== FEEDBACK MODAL ========
    if (interaction.isModalSubmit() && interaction.customId.startsWith('feedback:modal:')) {
      try {
        await handleFeedbackModal(interaction, Denuncia, getCachedConfig);
      } catch (err) {
        console.error('Erro no feedback modal:', err);
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: '❌ Erro ao enviar feedback.' });
        } else {
          await interaction.reply({ content: '❌ Erro ao enviar feedback.', ephemeral: true });
        }
      }
      return;
    }

    // ======== CORREÇÃO ACEITE ========
    if (interaction.isButton() && (interaction.customId.startsWith('log_aceitar_') || interaction.customId.startsWith('log_recusar_'))) {
      try {
        await interaction.deferReply({ flags: [64] });
      } catch (error) {
        if (error?.code === 10062) return;
        throw error;
      }

      const messageId = interaction.customId.replace(/^log_(?:aceitar|recusar)_/, '');
      const denuncia = await Denuncia.findOne({ messageId, guildId: interaction.guild.id });
      if (!denuncia) return interaction.editReply({ content: '❌ Denúncia não encontrada.' });

      if (interaction.customId.startsWith('log_aceitar_')) {
        await handleLogAceitarButton(interaction, denuncia);
      } else {
        await handleLogRecusarButton(interaction, denuncia);
      }
      return;
    }

    if (interaction.isButton() && interaction.customId === 'corrigir_denuncia_aceita') {
      await handleCorrigirDenunciaButton(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('corrigir_modal_aceite_')) {
      await handleSalvarCorrigirDenuncia(interaction);
      return;
    }

    // ======== BOTÕES ========
    if (interaction.isButton()) {
      if (interaction.customId === 'denuncia_pc') {
        await handleDenunciaPC(interaction);
        return;
      }

      if (interaction.customId === 'denuncia_mobile') {
        await handleDenunciaMobile(interaction);
        return;
      }

      if (interaction.customId === 'minhas_denuncias' || interaction.customId === 'consulta_denuncias_id') {
        await handleMyDenunciasButton(interaction);
        return;
      }

      switch (interaction.customId) {
        case 'reivindicar':
          await handleClaimButton(interaction);
          break;

        case 'finalizar_denuncia':
          await handleExportButton(interaction);
          break;

        case 'aceitar':
        case 'recusar':
        case 'analiser':
          await handleStatusButton(interaction, interaction.customId);
          break;

        case 'add_player':
          await handleAddPlayer(interaction);
          break;

        case 'refresh_status':
        case 'detailed_status':
        case 'status_ping_test':
        case 'status_cache_clear':
        case 'status_toggle_autorefresh':
        case 'status_restart_confirm':
          await handleStatusButtons(interaction);
          break;
      }
    }

    if (interaction.isModalSubmit()) {
      switch (interaction.customId) {
        case 'denuncia_pc_modal':
        case 'denuncia_mobile_modal': {
          const platform = interaction.customId === 'denuncia_pc_modal' ? 'PC' : 'Mobile';
          await handleModalSubmit(interaction, platform);
          break;
        }

        case 'consulta_denuncias_modal':
          await handleConsultaModalSubmit(interaction);
          break;

        case 'punishment_modal':
          await handlePunishmentModal(interaction);
          break;

        case 'add_player_modal':
          await handleAddPlayerModal(interaction);
          break;

        case 'channels_modal_1':
        case 'channels_modal_2':
        case 'channels_modal_3':
        case 'roles_modal_1':
        case 'roles_modal_2':
          await handlePanelModalSubmit(interaction);
          break;

        case 'global_exempt_users_modal':
          await handleGlobalExemptUsersSubmit(interaction);
          break;

      }
    }

  } catch (error) {
    if (error?.code === 10062) return;
    console.error('❌ Erro na interação:', error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Ocorreu um erro.', flags: [64] }).catch(() => {});
    }
  }
}

module.exports = interactionHandler;