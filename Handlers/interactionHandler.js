const { InteractionType, PermissionFlagsBits } = require('discord.js');
const Config = require('../models/Config');

const {
  handleDenunciaCommand,
  handleDenunciaPC,
  handleDenunciaMobile,
  handleModalSubmit, 
  handleMyDenunciasButton,    
  handleConsultaModalSubmit   
} = require('../buttons/denunciaButtons');

const { handleExportButton } = require('../Handlers/exportDenuncia'); 

const {
  handleStatusButton,
  handlePunishmentModal,
  handleAtualizarButton,
  handleDetalheButton,
  handleClaimButton
} = require('../Handlers/handlerStatusButton');

const {
  createChannelsModal1,
  createChannelsModal2,
  createRolesModal1,
  createRolesModal2,
  showConfig
} = require('../commands/painel');

const {
  handleInputIdLogAceite,
  handleModalLogMessageIdCorrecaoAceite,
  handleEditarAceiteModal,
  handleConfirmarCorrecaoAceite,
  handleSalvarCorrecaoAceite,
  handleInputIdDenuncia,
  handleModalIdParaCorrecaoDenuncia,
  handleEditarDenunciaIdButton,
  handleCorrecaoModalIdSubmit
} = require('../commands/correcao');

const { handleStatusButtons } = require('../commands/status');

// Funções auxiliares (necessárias para o funcionamento do painel - Recriada aqui)
async function handlePanelModalSubmit(interaction) {
  try {
    await interaction.deferReply({ flags: 64 });
    const fields = interaction.fields;
    let config = await Config.findOne({ guildId: interaction.guild.id });

    if (!config) {
      config = new Config({
        guildId: interaction.guild.id,
        channels: { pc: '', mobile: '', logs: '', log: '', analysis: '', topDaily: '' },        roles: { permitido: '', pc: '', administrador: '', responsavel_admin: '' },
        templates: { denuncia_aceita: '', denuncia_analise: '', denuncia_recusada: '' },
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

    const messages = {
      'channels_modal_1': '✅ Canais principais atualizados com sucesso!',
      'channels_modal_2': '✅ Canais administrativos atualizados com sucesso!',
      'roles_modal_1': '✅ Cargos principais atualizados com sucesso!',
      'roles_modal_2': '✅ Cargos administrativos atualizados com sucesso!'
    };

    await interaction.editReply({
      content: messages[interaction.customId],
    });

  } catch (error) {
    console.error('Erro ao processar modal do painel:', error);
    await interaction.editReply({
      content: '❌ Erro ao salvar configurações. Tente novamente.',
    });
  }
}


// Função principal de manipulação de interações
async function interactionHandler(interaction) {
  try {
    // ----------------------------------------------------
    // TRATAMENTO DE COMANDOS (SLASh)
    // ----------------------------------------------------
    if (interaction.isCommand()) {
        // Você deve ter um handler para seus comandos aqui
        // return seuCommandHandler(interaction);
    }

    // ======== CORREÇÃO DE ACEITE: fluxos de botões e modais ========
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

    // ======== CORREÇÃO DE DENÚNCIA: fluxos de botões e modais ========
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

    // Handler para o select menu do painel de configuração
    if (interaction.isStringSelectMenu() && interaction.customId === 'panel_menu') {
      const selected = interaction.values[0];
      const config = await Config.findOne({ guildId: interaction.guild.id });

      // Verifica permissões para painel
      const hasAdminRole = config?.roles?.administrador &&
        interaction.member.roles.cache.has(config.roles.administrador);
      const hasResponsavelAdminRole = config?.roles?.responsavel_admin &&
        interaction.member.roles.cache.has(config.roles.responsavel_admin);
      const hasAdministratorPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

      if (!hasAdminRole && !hasResponsavelAdminRole && !hasAdministratorPermission) {
        return interaction.reply({ content: '🚫 Apenas administradores ou responsáveis admin podem acessar o painel.', flags: 64 });
      }

      switch (selected) {
        case 'view_config':
          await showConfig(interaction);
          break;
        case 'edit_channels_1':
          await interaction.showModal(createChannelsModal1(config));
          break;
        case 'edit_channels_2':
          await interaction.showModal(createChannelsModal2(config));
          break;
        case 'edit_roles_1':
          await interaction.showModal(createRolesModal1(config));
          break;
        case 'edit_roles_2':
          await interaction.showModal(createRolesModal2(config));
          break;
          
        default:
          await interaction.reply({ content: '❌ Opção inválida.', flags: 64 });
      }      return;
    }
    // Botões de denúncia PC/Mobile/Consulta ID
    if (interaction.isButton()) {
      if (interaction.customId === 'denuncia_pc') {
        await handleDenunciaPC(interaction);
        return;
      }
      if (interaction.customId === 'denuncia_mobile') {
        await handleDenunciaMobile(interaction);
        return;
      }
      
      // TRATAMENTO DO BOTÃO MINHAS DENÚNCIAS
      // Reconhece tanto o ID antigo ('minhas_denuncias') quanto o ID de transição ('consulta_denuncias_id')
      if (interaction.customId === 'minhas_denuncias' || interaction.customId === 'consulta_denuncias_id') {
        await handleMyDenunciasButton(interaction); // << NOVO: Roteamento para listar denúncias
        return;
      }
      // FIM DO TRATAMENTO DO BOTÃO

      // Switch para outros botões
      switch (interaction.customId) {
        case 'reivindicar':
          await handleClaimButton(interaction);
          break;
        case 'finalizar_denuncia': // << NOVO: Roteamento para Finalizar e Exportar
          await handleExportButton(interaction);
          break;
        case 'aceitar':
        case 'recusar':
        case 'analiser':
          await handleStatusButton(interaction, interaction.customId);
          break;
        case 'atualizar':
          await handleAtualizarButton(interaction);
          break;
        case 'detalhe':
          await handleDetalheButton(interaction);
          break;
        case 'refresh_status':
        case 'detailed_status':
          await handleStatusButtons(interaction);
          break;
        case 'view_config':
          await showConfig(interaction);
          break;
        case 'edit_config': {
          const config = await Config.findOne({ guildId: interaction.guild.id });
          // Usando um modal de exemplo, pois o original 'createConfigModal' não está definido
          await interaction.showModal(createChannelsModal1(config));
          break;
        }
        case 'edit_mod': {
          const modConfig = await Config.findOne({ guildId: interaction.guild.id });
          // Usando um modal de exemplo, pois o original 'createModModal' não está definido
          await interaction.showModal(createRolesModal1(modConfig));
          break;
        }
        case 'download_rank': {
          const attachment = interaction.message.attachments.first();
          if (attachment) {
            await interaction.reply({ content: '📥 Aqui está o ranking completo!', files: [attachment], flags: 64 });
          } else {
            await interaction.reply({ content: '❌ Desculpe, o arquivo do ranking não está mais disponível.', flags: 64 });
          }
          break;
        }
      }
    }

    // Modais do bot
    if (interaction.isModalSubmit()) {
      // Permissão para modais de configuração
      if (interaction.customId === 'config_modal' ||
        interaction.customId === 'admin_modal' ||
        interaction.customId === 'mod_modal') {

        const config = await Config.findOne({ guildId: interaction.guild.id });
        const hasAdminRole = config?.roles?.administrador && interaction.member.roles.cache.has(config.roles.administrador);
        const hasResponsavelAdminRole = config?.roles?.responsavel_admin && interaction.member.roles.cache.has(config.roles.responsavel_admin);
        const hasAdministratorPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        if (!hasAdminRole && !hasResponsavelAdminRole && !hasAdministratorPermission) {
          await interaction.reply({ content: '❌ Apenas administradores ou responsáveis admin podem realizar esta ação.', flags: 64 });
          return;
        }
      }

      switch (interaction.customId) {
        case 'denuncia_pc_modal':
        case 'denuncia_mobile_modal': {
          const platform = interaction.customId === 'denuncia_pc_modal' ? 'PC' : 'Mobile';
          await handleModalSubmit(interaction, platform); // Assume que handleModalSubmit lida com a submissão
          break;
        }
        case 'consulta_denuncias_modal': // TRATAMENTO DO MODAL DE CONSULTA (NOVO)
            await handleConsultaModalSubmit(interaction);
            break;
        case 'config_modal':
        case 'admin_modal':
        case 'mod_modal':
          // Funções de salvamento (saveConfig, saveAdmin, saveMod) não definidas: 
           // Usando handlePanelModalSubmit como fallback para salvar dados do painel.
          await handlePanelModalSubmit(interaction);
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
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Ocorreu um erro ao processar sua solicitação.', flags: 64 });
      } else if (interaction.deferred) {
        await interaction.editReply({ content: '❌ Ocorreu um erro ao processar sua solicitação após o adiamento.', flags: 64 });
      }
    } catch (err) {
      console.error('❌ Erro ao enviar mensagem de erro:', err);
    }
  }
}

// Exporta o handler
module.exports = interactionHandler;