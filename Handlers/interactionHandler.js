const { InteractionType, PermissionFlagsBits } = require('discord.js');
const Config = require('../models/Config');

const {
  handleDenunciaCommand,
  handleDenunciaPC,
  handleDenunciaMobile,
  handleModalSubmit, 
  handleMyDenunciasButton,    
  handleConsultaModalSubmit,  
  handleDenunciaButtons,
  handleDenunciaModals
} = require('../commands/denuncia');

const {
  handleStatusButton,
  handlePunishmentModal,
  handleClaimButton
} = require('../Handlers/handlerStatusButton');

const { handleExportButton } = require('../Handlers/exportDenuncia');

const {
  handleInputIdDenuncia,
  handleModalIdParaCorrecaoDenuncia,
  handleEditarDenunciaIdButton,
  handleCorrecaoModalIdSubmit,
  handleInputIdLogAceite,
  handleModalLogMessageIdCorrecaoAceite,
  handleEditarAceiteModal,
  handleConfirmarCorrecaoAceite,
  handleSalvarCorrecaoAceite
} = require('../commands/correcao');

const {
  createChannelsModal1,
  createChannelsModal2,
  createRolesModal1,
  createRolesModal2,
  showConfig
} = require('../commands/painel');

const { handleStatusButtons } = require('../commands/status');
const { handleFeedbackMenu, handleFeedbackModal } = require('../utils/feedback');
const { getCachedConfig } = require('../utils/performance');
const Denuncia = require('../models/Denuncia');

async function handlePanelModalSubmit(interaction) {
  try {
    await interaction.deferReply({ flags: 64 });
    const fields = interaction.fields;
    let config = await Config.findOne({ guildId: interaction.guild.id });

    if (!config) {
      config = new Config({
        guildId: interaction.guild.id,
        channels: { pc: '', mobile: '', logs: '', log: '', analysis: '', topDaily: '' },
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
        config.channels.analysis = fields.getTextInputValue('analysis_channel').trim();
        config.channels.topDaily = fields.getTextInputValue('top_daily_channel').trim();
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

// =========================
// HANDLER PRINCIPAL
// =========================
async function interactionHandler(interaction) {
  try {

    // ======== FEEDBACK SELECT MENU ========
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('feedback:select:')) {
      try {
        const denunciaId = interaction.customId.replace('feedback:select:', '');
        const denuncia = await Denuncia.findById(denunciaId);

        if (!denuncia) {
          return interaction.reply({ content: '❌ Denúncia não encontrada.', ephemeral: true });
        }

        await handleFeedbackMenu(interaction, denuncia);
      } catch (err) {
        console.error('Erro no feedback select:', err);
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: '❌ Erro ao processar feedback.' });
        } else {
          await interaction.reply({ content: '❌ Erro ao processar feedback.', ephemeral: true });
        }
      }
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
    if (interaction.isButton() && interaction.customId === 'abrir_input_id_log_aceite') {
      await handleInputIdLogAceite(interaction);
      return;
    }

    if (interaction.type === InteractionType.ModalSubmit && interaction.customId === 'modal_logmessageid_para_correcao_aceite') {
      await handleModalLogMessageIdCorrecaoAceite(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('salvar_correcao_aceite_')) {
      await handleEditarAceiteModal(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('confirmar_correcao_aceite_')) {
      await handleConfirmarCorrecaoAceite(interaction);
      return;
    }

    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('salvar_correcao_aceite_')) {
      await handleSalvarCorrecaoAceite(interaction);
      return;
    }

    // ======== CORREÇÃO DENÚNCIA ========
    if (interaction.isButton() && interaction.customId === 'abrir_input_id_denuncia') {
      await handleInputIdDenuncia(interaction);
      return;
    }

    if (interaction.type === InteractionType.ModalSubmit && interaction.customId === 'modal_id_para_correcao_denuncia') {
      await handleModalIdParaCorrecaoDenuncia(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('editar_denuncia_messageId_')) {
      await handleEditarDenunciaIdButton(interaction);
      return;
    }

    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('correcao_modal_messageId_')) {
      const messageId = interaction.customId.replace('correcao_modal_messageId_', '');
      await handleCorrecaoModalIdSubmit(interaction, messageId);
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

        case 'refresh_status':
        case 'detailed_status':
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

        case 'channels_modal_1':
        case 'channels_modal_2':
        case 'roles_modal_1':
        case 'roles_modal_2':
          await handlePanelModalSubmit(interaction);
          break;
      }
    }

  } catch (error) {
    console.error('❌ Erro na interação:', error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Ocorreu um erro.', ephemeral: true });
    }
  }
}

module.exports = interactionHandler;