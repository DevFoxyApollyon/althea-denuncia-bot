// Mudanças de status da denúncia: analisar, aceitar, recusar e punição.
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { sincronizarBotoes } = require('./botoesStatus');
const Denuncia = require('../../models/Denuncia');
const ModerationAction = require('../../models/ModerationAction');
const { LogManager } = require('../LogManager');
const { getBrasiliaDate, formatTimeBR, getBrasiliaDateTime } = require('../../utils/dateUtils');
const { inserirFeedbackMenu, removerFeedbackMenu } = require('../../utils/feedback');
const { atualizarStatusNaMensagem } = require('../../utils/atualizarStatus');
const { registrarTopicoRestrito } = require('../../utils/restricaoTopicos');
const { getConfig: getCachedConfig } = require('../../utils/configCache');
const {
  safeDefer,
  safeReplyOrEdit,
  statusConfig,
  sendReanaliseNotice,
  manageStatusMessages
} = require('./mensagensStatus');
const { Logger } = require('../../utils/logger');

const log = new Logger({ tag: 'HandlerStatusButton', debug: false });

const { CODIGOS_ESPERADOS: DM_IGNORED_CODES, dmPausada, registrarErroDeDM, avisosExtrasLigados } = require('../../utils/dmSegura');
const _logButtonLocks = new Set();

async function updateDenunciaStatus(denunciaId, {
  status,
  staffId,
  motivoEdicao,
  acusadoId,
  motivoAceite,
  dataPunicao,
  logMessageId,
  analysisMessageId,
  analysisChannelId,
  acusadoUserIds,
  restritoParticipacao,
}) {
  const now = new Date();
  const updateFields = {
    status,
    staffId,
    acusadoId,
    motivoAceite,
    dataPunicao,
    'ultimaEdicao.staffId': staffId,
    'ultimaEdicao.data': now,
    'ultimaEdicao.motivoEdicao': motivoEdicao,
    dataAtualizacao: now,
  };
  if (acusadoUserIds !== undefined) {
    updateFields.acusadoUserIds = acusadoUserIds;
  }
  if (restritoParticipacao !== undefined) {
    updateFields.restritoParticipacao = restritoParticipacao;
  }
  if (logMessageId !== undefined) {
    updateFields.logMessageId = logMessageId;
  }
  if (analysisMessageId !== undefined) {
    updateFields.analysisMessageId = analysisMessageId;
  }
  if (analysisChannelId !== undefined) {
    updateFields.analysisChannelId = analysisChannelId;
  }
  return await Denuncia.findByIdAndUpdate(denunciaId, updateFields, { new: true });
}

async function canModifyReport(interaction, denuncia, config) {
  const isResponsavelAdmin =
    config?.roles?.responsavel_admin &&
    interaction.member.roles.cache.has(config.roles.responsavel_admin);
  if (isResponsavelAdmin) return true;
  if (denuncia.claimedBy === interaction.user.id) return true;
  return false;
}

async function handleStatusButton(interaction, status) {
  try {
    if (!interaction.isRepliable()) return;
    if (!interaction.deferrable && interaction.deferred) return;

    const willOpenModal = status === 'aceitar';
    if (!willOpenModal) {
      await safeDefer(interaction, true);
    }

    const hasPermission = await checkModPermission(interaction, !willOpenModal);
    if (!hasPermission) return;

    const denuncia = await Denuncia.findOneAndUpdate(
      {
        threadId: interaction.channel.id,
        processingLock: { $ne: true },
      },
      { $set: { processingLock: true } },
      { new: true, sort: { createdAt: -1 } }
    );

    if (!denuncia) {
      const exists = await Denuncia.findOne({ threadId: interaction.channel.id });
      if (!exists) {
        await safeReplyOrEdit(interaction, {
          content: '❌ Não foi possível encontrar uma denúncia neste canal.',
          flags: [MessageFlags.Ephemeral],
        });
      } else {
        await safeReplyOrEdit(interaction, {
          content: '⏳ Esta denúncia já está sendo processada. Aguarde um instante.',
          flags: [MessageFlags.Ephemeral],
        });
      }
      return;
    }

    try {
      const config = await getCachedConfig(interaction.guild.id);

      const statusMap = {
        aceitar: 'aceita',
        recusar: 'recusada',
        analiser: 'analise',
        reivindicar: 'reivindicacao',
      };
      const normalizedStatus = statusMap[status] || status;

      const isResponsavelAdmin =
        config?.roles?.responsavel_admin &&
        interaction.member.roles.cache.has(config.roles.responsavel_admin);

      if (denuncia.status === normalizedStatus) {
        if (normalizedStatus === 'analise') {
          await safeReplyOrEdit(interaction, {
            content: '❌ Esta denúncia já está em análise.',
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }

        await safeReplyOrEdit(interaction, {
          content: `❌ Esta denúncia já está ${statusConfig[status]?.message.toLowerCase() || normalizedStatus}.`,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const hasAdminRole =
        config?.roles?.administrador &&
        interaction.member.roles.cache.has(config.roles.administrador);

      if (hasAdminRole && !isResponsavelAdmin) {
        const previousAction = await ModerationAction.findOne({
          moderatorId: interaction.user.id,
          denunciaId: denuncia._id,
          action: { $ne: 'reivindicacao' },
        }).lean();
        if (previousAction) {
          await safeReplyOrEdit(interaction, {
            content: '❌ Administradores só podem interagir uma vez com os botões após reivindicar esta denúncia.',
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }
      }

      const canModify = await canModifyReport(interaction, denuncia, config);
      if (!canModify) {
        await safeReplyOrEdit(interaction, {
          content: '❌ Apenas quem reivindicou a denúncia ou responsáveis admin podem modificá-la.',
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      if (
        (status === 'aceitar' || status === 'recusar') &&
        denuncia.claimedBy !== interaction.user.id &&
        !isResponsavelAdmin
      ) {
        await safeReplyOrEdit(interaction, {
          content: '❌ Apenas quem reivindicou ou responsáveis admin podem aceitar/recusar denúncias.',
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      if (
        status === 'analiser' &&
        denuncia.claimedBy !== interaction.user.id &&
        !isResponsavelAdmin
      ) {
        await safeReplyOrEdit(interaction, {
          content: '❌ Apenas quem reivindicou a denúncia ou responsáveis admin podem colocá-la em análise.',
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const messageUrl = interaction.message.url;
      const logsChannel = config?.channels?.logs
        ? interaction.client.channels.cache.get(config.channels.logs)
        : null;

      if (status === 'analiser') {
        await handleAnalise(interaction, denuncia, config, messageUrl, logsChannel);
      } else if (status === 'aceitar') {
        await handleAceitar(interaction, denuncia, messageUrl);
        return;
      } else if (status === 'recusar') {
        await handleRecusar(interaction, denuncia, config, messageUrl, logsChannel);
      }
    } finally {
      await Denuncia.findByIdAndUpdate(denuncia._id, {
        $set: { processingLock: false },
      }).catch((e) => log.error('Erro ao liberar processingLock', e));
    }
  } catch (error) {
    log.error('Erro ao processar status', error);
    await safeReplyOrEdit(interaction, {
      content: '❌ Ocorreu um erro ao processar o status.',
      flags: [MessageFlags.Ephemeral],
    });
  }
}

async function handleAnalise(interaction, denuncia, config, messageUrl, logsChannel) {
  try {
    await safeDefer(interaction, true);
    await safeReplyOrEdit(interaction, { content: '⏳ Processando...' });

    const { logMessage: discordLogMessage, analysisMessage } = await manageStatusMessages(interaction.channel, 'analise', interaction.user, {
      messageUrl,
      logChannelId: config.channels.logs,
      logsChannel,
      previousStatus: denuncia.status,
      logMessageId: denuncia.logMessageId,
      analysisChannelId: config.channels.analysis,
      analysisMessageId: denuncia.analysisMessageId,
      denuncia,
    });

    await registrarAcaoModerador(interaction.user.id, 'analise', denuncia._id, interaction.guild.id);
    await updateDenunciaStatus(denuncia._id, {
      status: 'analise',
      staffId: interaction.user.id,
      motivoEdicao: 'Em análise',
      logMessageId: discordLogMessage ? discordLogMessage.id : denuncia.logMessageId || null,
      analysisMessageId: analysisMessage ? analysisMessage.id : denuncia.analysisMessageId || null,
      analysisChannelId: config.channels.analysis || null,
    });

    const logManager = new LogManager(interaction.client, config);
    const logEmbed = await logManager.createLogEmbed('analise', interaction.user, interaction.channel.id);

    if (config.channels.log) {
      const logChannel = interaction.client.channels.cache.get(config.channels.log);
      if (logChannel) await logChannel.send({ embeds: [logEmbed] });
    }

    await safeReplyOrEdit(interaction, { content: '🔎 Denúncia marcada como em análise!' });

    try {
      await atualizarStatusNaMensagem(interaction.client, denuncia, 'analise');
    } catch (e) {
      log.warn('Falha ao atualizar status na mensagem principal (analise)', e?.message);
    }
    await sincronizarBotoes(interaction.channel, 'analise', interaction.message);
    return true;
  } catch (error) {
    log.error('Erro ao manejar análise', error);
    await safeReplyOrEdit(interaction, {
      content: '❌ Ocorreu um erro ao marcar a denúncia como em análise.',
      flags: [MessageFlags.Ephemeral],
    });
    return false;
  }
}

async function processarAnaliseAutomatica(client, denuncia, config) {
  const topic = await client.channels.fetch(denuncia.threadId).catch(() => null);
  const guild = client.guilds.cache.get(denuncia.guildId);
  if (!topic || !guild) return false;

  const staff = await client.users.fetch(denuncia.claimedBy).catch(() => null) || {
    id: denuncia.claimedBy,
    tag: denuncia.claimedBy,
    username: denuncia.claimedBy,
    toString: () => `<@${denuncia.claimedBy}>`,
  };
  const logsChannel = config?.channels?.logs
    ? client.channels.cache.get(config.channels.logs)
    : null;
  const proxyInteraction = {
    client,
    guild,
    channel: topic,
    user: staff,
    message: { url: `https://discord.com/channels/${denuncia.guildId}/${denuncia.channelId}/${denuncia.messageId}` },
    deferred: true,
    replied: false,
    isRepliable: () => true,
    deferReply: async () => {},
    editReply: async () => null,
  };

  return handleAnalise(
    proxyInteraction,
    denuncia,
    config,
    proxyInteraction.message.url,
    logsChannel
  );
}

let denunciasMap = new Map();

async function handleAceitar(interaction, denuncia, messageUrl) {
  try {
    denunciasMap.set(interaction.user.id, { denuncia, messageUrl });

    const dataBrasilia = getBrasiliaDate();
    const day = String(dataBrasilia.getDate()).padStart(2, '0');
    const month = String(dataBrasilia.getMonth() + 1).padStart(2, '0');
    const year = dataBrasilia.getFullYear();
    const dataAtual = `${day}/${month}/${year}`;

    const modal = new ModalBuilder().setCustomId('punishment_modal').setTitle('Aplicar Punição');

    const acusadoId = new TextInputBuilder()
      .setCustomId('acusadoId')
      .setLabel('ID do Acusado')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('Digite o ID do acusado');

    const motivo = new TextInputBuilder()
      .setCustomId('motivo')
      .setLabel('Motivo da Punição')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setPlaceholder('Digite o motivo da punição...')
      .setMaxLength(1000);

    const data = new TextInputBuilder()
      .setCustomId('data')
      .setLabel('Data da Punição')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('DD/MM/YYYY')
      .setValue(dataAtual);

    modal.addComponents(
      new ActionRowBuilder().addComponents(acusadoId),
      new ActionRowBuilder().addComponents(motivo),
      new ActionRowBuilder().addComponents(data)
    );

    try {
      await interaction.showModal(modal);
    } catch (error) {
      if (error.code === 'InteractionAlreadyReplied' || error?.code === 10062) {
        denunciasMap.delete(interaction.user.id);
        await Denuncia.findByIdAndUpdate(denuncia._id, {
          $set: { processingLock: false },
        }).catch((e) => log.error('Erro ao liberar processingLock após falha no modal', e));
      }
    }
  } catch (error) {
    log.error('Erro ao manejar aceitação', error);
    await safeReplyOrEdit(interaction, {
      content: '❌ Ocorreu um erro ao aceitar a denúncia.',
      flags: [MessageFlags.Ephemeral],
    });
    await Denuncia.findByIdAndUpdate(denuncia._id, {
      $set: { processingLock: false },
    }).catch((e) => log.error('Erro ao liberar processingLock (handleAceitar catch)', e));
  }
}

async function handleRecusar(interaction, denuncia, config, messageUrl, logsChannel, actionSource = 'botão') {
  try {
    await safeDefer(interaction, true);
    await safeReplyOrEdit(interaction, { content: '⏳ Processando...' });

    if (denuncia.logMessageId && logsChannel) {
      try {
        const existingLogMessage = await logsChannel.messages.fetch(denuncia.logMessageId).catch(() => null);
        if (existingLogMessage) {
          await existingLogMessage.delete().catch((e) => {
            if (e?.code === 10008 || e?.code === 50001) {
              log.debug('Mensagem de log já deletada ou sem acesso');
            } else if (e?.status === 500) {
              log.debug('Servidor Discord temporariamente indisponível, ignorando');
            } else {
              log.warn('Erro ao deletar mensagem de log', e?.message || e);
            }
          });
        }
      } catch (error) {
        if (error?.code !== 10008 && error?.status !== 500) {
          log.warn('Erro ao buscar/deletar mensagem de log', error?.message || error);
        }
      }
    }

    await manageStatusMessages(interaction.channel, 'recusada', interaction.user, {
      messageUrl,
      logChannelId: config.channels.logs,
      logsChannel,
      previousStatus: denuncia.status,
      logMessageId: null,
      analysisChannelId: denuncia.analysisChannelId || config.channels.analysis,
      analysisMessageId: denuncia.analysisMessageId,
      denuncia,
    });
    await removerFeedbackMenu(interaction.client, denuncia._id);

    await Denuncia.updateOne({ _id: denuncia._id }, { $push: { historico: {
      acao: actionSource === 'palavra-chave' ? 'recusa_automatica' : 'recusada',
      staffId: interaction.user.id,
      data: new Date(),
      detalhes: { origem: actionSource }
    } } });

    await registrarAcaoModerador(interaction.user.id, 'recusada', denuncia._id, interaction.guild.id);
    await updateDenunciaStatus(denuncia._id, {
      status: 'recusada',
      staffId: interaction.user.id,
      motivoEdicao: 'Denúncia recusada',
      acusadoId: null,
      motivoAceite: null,
      dataPunicao: null,
      logMessageId: null,
    });

    const logManager = new LogManager(interaction.client, config);
    const logEmbed = await logManager.createLogEmbed('recusada', interaction.user, interaction.channel.id, { actionSource });

    if (config?.channels?.log) {
      const logChannel = interaction.client.channels.cache.get(config.channels.log);
      if (logChannel) await logChannel.send({ embeds: [logEmbed] });
    }

    try {
      const userId = denuncia.criadoPor;
      if (dmPausada()) {
        // O Discord bloqueou as DMs do bot: não insiste.
      } else if (userId && typeof userId === 'string' && userId !== 'null' && userId !== 'undefined') {
        const denunciante = await interaction.client.users.fetch(userId);
        if (denunciante) {
          const denunciaLink =
            messageUrl || `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}`;
          const recusaEmbed = new EmbedBuilder()
            .setColor('#E74C3C')
            .setTitle('❌ Denúncia recusada')
            .setDescription('Sua denúncia foi analisada pela equipe e não foi aprovada.')
            .addFields(
              { name: '🎯 Acusado', value: `\`${denuncia.acusado || 'Não informado'}\``, inline: true },
              { name: '📌 Status', value: 'Recusada', inline: true },
              { name: '🔗 Acessar denúncia', value: `[Abrir tópico](${denunciaLink})`, inline: false },
              { name: 'ℹ️ Próximos passos', value: 'Se você acredita que houve um erro, procure um responsável por denúncias para solicitar uma reanálise.', inline: false }
            )
            .setFooter({ text: 'Sistema de Denúncias • Brasil RolePlay' })
            .setTimestamp();

          await denunciante.send({ embeds: [recusaEmbed] });
        }
      } else {
        log.warn('Não foi possível enviar DM: criadoPor da denúncia é inválido', { userId });
      }
    } catch (dmError) {
      registrarErroDeDM(dmError);
      if (!DM_IGNORED_CODES.includes(dmError?.code)) {
        log.error('Erro ao enviar DM para o denunciante', dmError);
      }
    }

    await safeReplyOrEdit(interaction, {
      content: `${statusConfig.recusar.emoji} Denúncia recusada com sucesso!`,
    });

    await sendReanaliseNotice(interaction.channel);

    try {
      await atualizarStatusNaMensagem(interaction.client, denuncia, 'recusada');
    } catch (e) {
      log.warn('Falha ao atualizar status na mensagem principal (recusada)', e?.message);
    }
    await sincronizarBotoes(interaction.channel, 'recusada', interaction.message);
  } catch (error) {
    log.error('Erro ao manejar recusa', error);
    await safeReplyOrEdit(interaction, {
      content: '❌ Ocorreu um erro ao recusar a denúncia.',
      flags: [MessageFlags.Ephemeral],
    });
  }
}

async function handleRecusarPorMensagem(message, denuncia, config) {
  const interaction = {
    guild: message.guild,
    channel: message.channel,
    client: message.client,
    user: message.author,
    member: message.member,
    message,
    deferred: false,
    replied: false,
    isRepliable: () => true,
    deferReply: async () => { interaction.deferred = true; },
    editReply: async () => null,
    reply: async () => null,
  };

  const logsChannel = config?.channels?.logs
    ? message.guild.channels.cache.get(config.channels.logs)
    : null;

  await handleRecusar(interaction, denuncia, config, message.url, logsChannel, 'palavra-chave');
}

async function validarResponsavelAdminLog(interaction) {
  const config = await getCachedConfig(interaction.guild.id);
  const roleId = config?.roles?.responsavel_admin;
  const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const autorizado = Boolean(roleId && member?.roles?.cache?.has(roleId));

  if (!autorizado) {
    const cargo = roleId ? `<@&${roleId}>` : '`Responsável Admin não configurado`';
    const payload = { content: `❌ Apenas o cargo ${cargo} pode usar estes botões.` };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply({ ...payload, flags: [MessageFlags.Ephemeral] }).catch(() => {});
    }
    return null;
  }

  return config;
}

async function handleLogAceitarButton(interaction, denuncia) {
  const lockKey = interaction.message.id;
  if (_logButtonLocks.has(lockKey)) {
    await interaction.editReply({ content: '⏳ Esta confirmação já está sendo processada.' }).catch(() => {});
    return;
  }
  _logButtonLocks.add(lockKey);

  try {
    const config = await validarResponsavelAdminLog(interaction);
    if (!config) return;

    if (!interaction.message.components?.some((row) => row.components?.length)) {
      await interaction.editReply({ content: 'ℹ️ Esta confirmação já foi processada.' }).catch(() => {});
      return;
    }

    const confirmation = ` ||${getBrasiliaDateTime()}|| por ${interaction.user}`;
    await interaction.message.edit({
      content: `${interaction.message.content}${confirmation}`,
      components: []
    });
    await interaction.editReply({ content: '✅ Cadeia staff aceita' }).catch(() => {});
    setTimeout(() => {
      interaction.deleteReply().catch((error) => {
        if (error?.code !== 10008 && error?.code !== 10062) {
          log.warn('Não foi possível remover a confirmação ephemeral', error?.message);
        }
      });
    }, 5000);
  } catch (error) {
    if (error?.code === 10008) {
      await interaction.editReply({ content: '⚠️ A mensagem de confirmação não existe mais.' }).catch(() => {});
      return;
    }
    log.error('Erro ao confirmar aceite no canal de logs', error);
    await interaction.editReply({ content: '❌ Não foi possível atualizar a confirmação no canal de logs.' }).catch(() => {});
  } finally {
    _logButtonLocks.delete(lockKey);
  }
}

async function handleLogRecusarButton(interaction, denuncia) {
  const config = await validarResponsavelAdminLog(interaction);
  if (!config) return;

  const topic = await interaction.guild.channels.fetch(denuncia.threadId).catch(() => null);
  if (!topic) return interaction.editReply({ content: '❌ Tópico da denúncia não encontrado.' });

  const proxyInteraction = {
    channel: topic,
    user: interaction.user,
    member: interaction.member,
    client: interaction.client,
    guild: interaction.guild,
    message: interaction.message,
    isRepliable: () => true,
    deferred: true,
    replied: false,
    deferReply: async (payload) => {
      if (!interaction.deferred && !interaction.replied) {
        proxyInteraction.deferred = true;
        return interaction.deferReply(payload);
      }
      return null;
    },
    editReply: (payload) => interaction.editReply(payload),
    reply: (payload) => interaction.reply(payload),
  };

  await handleRecusar(
    proxyInteraction,
    denuncia,
    config,
    `https://discord.com/channels/${interaction.guild.id}/${denuncia.channelId}/${denuncia.messageId}`,
    interaction.channel,
    'botão de log'
  );
}

async function handlePunishmentModal(interaction) {
  const denunciaData = denunciasMap.get(interaction.user.id);

  try {
    if (!interaction.isModalSubmit()) return;
    await safeDefer(interaction, true);
    await safeReplyOrEdit(interaction, { content: '⏳ Processando aceitação...' });

    if (!denunciaData) {
      return await safeReplyOrEdit(interaction, {
        content: '❌ Dados da denúncia não encontrados. Tente novamente.',
        flags: [MessageFlags.Ephemeral],
      });
    }
  
    const { denuncia, messageUrl } = denunciaData;
    const acusadoId = interaction.fields.getTextInputValue('acusadoId');
    const motivo = interaction.fields.getTextInputValue('motivo');
    const dataPunicao = interaction.fields.getTextInputValue('data');

    const dateRegex = /^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/;
    if (!dateRegex.test(dataPunicao)) {
      return await safeReplyOrEdit(interaction, {
        content: '❌ Formato de data inválido. Use o formato: DD/MM/YYYY',
        flags: [MessageFlags.Ephemeral],
      });
    }

    const config = await getCachedConfig(interaction.guild.id);
    const logsChannel = config?.channels?.logs
      ? interaction.client.channels.cache.get(config.channels.logs)
      : null;

    const idsAceitos = String(acusadoId).split('+').map((id) => id.trim()).filter(Boolean);
    let acceptedUserIds = [];
    let teveIdAusente = false;

    try {
      const usuariosAceitos = await Promise.all(
        idsAceitos.map(async (id) => {
          const usuarioAceito = await require('../../models/Usuario').findOne({
            guildId: interaction.guild.id,
            conta: id,
          }).sort({ updatedAt: -1 });
          if (!usuarioAceito?.userId) {
            teveIdAusente = true;
            return null;
          }
          return String(usuarioAceito.userId);
        })
      );
      acceptedUserIds = [...new Set(usuariosAceitos.filter(Boolean))];
    } catch (_) {
      teveIdAusente = true;
      acceptedUserIds = [];
    }

    const usuarioAceitoIds = [
      ...(denuncia.acusadoUserIds || []),
      ...acceptedUserIds,
    ].filter(Boolean);
    const restritoParticipacaoAceita = usuarioAceitoIds.length > 0 && !teveIdAusente;

    const logMessage = await manageStatusMessages(interaction.channel, 'aceita', interaction.user, {
      acusadoId,
      motivo,
      dataPunicao,
      messageUrl,
      logChannelId: config?.channels?.logs,
      logsChannel,
      previousStatus: denuncia.status,
      logMessageId: denuncia.logMessageId,
      analysisChannelId: denuncia.analysisChannelId || config?.channels?.analysis,
      analysisMessageId: denuncia.analysisMessageId,
      denuncia,
    });

    await registrarAcaoModerador(interaction.user.id, 'aceita', denuncia._id, interaction.guild.id);

    const acusadoUserIdsFinal = [...new Set(usuarioAceitoIds)];

    await updateDenunciaStatus(denuncia._id, {
      status: 'aceita',
      staffId: interaction.user.id,
      motivoEdicao: motivo,
      acusadoId,
      motivoAceite: motivo,
      dataPunicao,
      logMessageId: logMessage?.logMessage ? logMessage.logMessage.id : denuncia.logMessageId || null,
      acusadoUserIds: acusadoUserIdsFinal,
      restritoParticipacao: restritoParticipacaoAceita,
    });

    registrarTopicoRestrito(denuncia.threadId, denuncia.criadoPor, acusadoUserIdsFinal, restritoParticipacaoAceita);

    const logManager = new LogManager(interaction.client, config);
    const logEmbed = await logManager.createLogEmbed('aceita', interaction.user, interaction.channel.id);

    if (config?.channels?.log) {
      const logChannel = interaction.client.channels.cache.get(config.channels.log);
      if (logChannel) await logChannel.send({ embeds: [logEmbed] });
    }

    try {
      const userId = denuncia.criadoPor;
      if (dmPausada()) {
        // O Discord bloqueou as DMs do bot: não insiste.
      } else if (userId && typeof userId === 'string' && userId !== 'null' && userId !== 'undefined') {
        const denunciante = await interaction.client.users.fetch(userId);
        if (denunciante) {
          const denunciaLink =
            messageUrl || `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}`;
          const aceiteEmbed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('✅ Denúncia aceita')
            .setDescription('Sua denúncia foi analisada e aceita pela equipe.')
            .addFields(
              { name: '🎯 ID do acusado', value: `\`${acusadoId}\``, inline: true },
              { name: '📅 Data da punição', value: `\`${dataPunicao}\``, inline: true },
              { name: '⚖️ Motivo da punição', value: motivo || 'Não informado', inline: false },
              { name: '🔗 Acessar denúncia', value: `[Abrir tópico](${denunciaLink})`, inline: false },
              { name: 'ℹ️ Reanálise', value: 'Caso discorde da decisão, procure um responsável por denúncias para solicitar uma reanálise.', inline: false }
            )
            .setFooter({ text: 'Sistema de Denúncias • Brasil RolePlay' })
            .setTimestamp();

          await denunciante.send({ embeds: [aceiteEmbed] });
        }
      } else {
        log.warn('Não foi possível enviar DM: criadoPor da denúncia é inválido', { userId });
      }
    } catch (dmError) {
      registrarErroDeDM(dmError);
      if (!DM_IGNORED_CODES.includes(dmError?.code)) {
        log.error('Erro ao enviar DM para o denunciante', dmError);
      }
    }

    // O acusado identificado também é avisado por mensagem direta: a menção no
    // canal pode aparecer como "usuário desconhecido" e passar despercebida.
    for (const acusadoUserId of acusadoUserIdsFinal) {
      if (!avisosExtrasLigados() || dmPausada()) break;
      if (!/^\d{15,21}$/.test(String(acusadoUserId)) || acusadoUserId === denuncia.criadoPor) continue;
      try {
        const acusado = await interaction.client.users.fetch(acusadoUserId);
        const denunciaLink = messageUrl || `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}`;
        await acusado.send({
          embeds: [new EmbedBuilder()
            .setColor('#E74C3C')
            .setTitle('⚠️ Você foi punido em uma denúncia')
            .setDescription(`Uma denúncia contra você em **${interaction.guild.name}** foi analisada e aceita pela equipe.`)
            .addFields(
              { name: '🎯 ID da conta', value: `\`${acusadoId}\``, inline: true },
              { name: '📅 Data da punição', value: `\`${dataPunicao}\``, inline: true },
              { name: '⚖️ Motivo da punição', value: motivo || 'Não informado', inline: false },
              { name: '🔗 Acessar denúncia', value: `[Abrir tópico](${denunciaLink})`, inline: false },
              { name: 'ℹ️ Reanálise', value: 'Caso discorde da decisão, procure um responsável por denúncias para solicitar uma reanálise.', inline: false }
            )
            .setFooter({ text: 'Sistema de Denúncias • Brasil RolePlay' })
            .setTimestamp()]
        });
      } catch (dmError) {
        registrarErroDeDM(dmError);
        if (!DM_IGNORED_CODES.includes(dmError?.code)) log.error('Erro ao enviar DM para o acusado', dmError);
      }
    }

    await safeReplyOrEdit(interaction, {
      content: `${statusConfig.aceitar.emoji} Denúncia aceita com sucesso!`,
    });
    await sincronizarBotoes(interaction.channel, 'aceita', interaction.message);

    await sendReanaliseNotice(interaction.channel);

    const updatedDenuncia = await Denuncia.findById(denuncia._id);
    if (updatedDenuncia) {
      await inserirFeedbackMenu(interaction.client, updatedDenuncia, config);
    }

    try {
      await atualizarStatusNaMensagem(interaction.client, denuncia, 'aceita');
    } catch (e) {
      log.warn('Falha ao atualizar status na mensagem principal (aceita)', e?.message);
    }
  } catch (error) {
    log.error(`[${formatTimeBR(getBrasiliaDate())}] Erro ao processar punição`, error);
    await safeReplyOrEdit(interaction, {
      content: '❌ Ocorreu um erro ao processar a punição.',
      flags: [MessageFlags.Ephemeral],
    });
  } finally {
    if (denunciaData?.denuncia?._id) {
      await Denuncia.findByIdAndUpdate(denunciaData.denuncia._id, {
        $set: { processingLock: false },
      }).catch((e) => log.error('Erro ao liberar processingLock (modal finally)', e));
    }
    denunciasMap.delete(interaction.user.id);
  }
}

async function checkModPermission(interaction, isDeferred = false) {
  try {
    const config = await getCachedConfig(interaction.guild.id);
    if (!config) {
      await safeReplyOrEdit(interaction, {
        content: '❌ Configurações do servidor não encontradas.',
        ...(isDeferred ? {} : { flags: [MessageFlags.Ephemeral] }),
      });
      return false;
    }
    if (!config.roles?.administrador && !config.roles?.responsavel_admin) {
      await safeReplyOrEdit(interaction, {
        content: '❌ Cargos de administração não configurados.',
        ...(isDeferred ? {} : { flags: [MessageFlags.Ephemeral] }),
      });
      return false;
    }
    const hasAdminRole =
      config.roles.administrador && interaction.member.roles.cache.has(config.roles.administrador);
    const hasResponsavelRole =
      config.roles.responsavel_admin &&
      interaction.member.roles.cache.has(config.roles.responsavel_admin);
    if (!hasAdminRole && !hasResponsavelRole) {
      await safeReplyOrEdit(interaction, {
        content: '❌ Você precisa ter o cargo de administrador ou responsável admin para realizar esta ação.',
        ...(isDeferred ? {} : { flags: [MessageFlags.Ephemeral] }),
      });
      return false;
    }
    return true;
  } catch (error) {
    log.error('Erro ao verificar permissão', error);
    await safeReplyOrEdit(interaction, {
      content: '❌ Erro ao verificar permissões.',
      ...(isDeferred ? {} : { flags: [MessageFlags.Ephemeral] }),
    });
    return false;
  }
}

async function registrarAcaoModerador(moderadorId, acao, denunciaId, guildId) {
  try {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const actionMap = {
      reivindicar: 'reivindicacao',
      aceitar: 'aceita',
      recusar: 'recusada',
      analiser: 'analise',
      analise: 'analise',
    };
    const mappedAction = actionMap[acao] || acao;
    const novaAcao = new ModerationAction({
      moderatorId: moderadorId,
      action: mappedAction,
      denunciaId: denunciaId,
      guildId: guildId,
      weekOf: weekStart,
      weekNumber: ModerationAction.getCurrentWeekNumber(),
      timestamp: now,
    });
    return await novaAcao.save();
  } catch (error) {
    log.error('Erro ao registrar ação', error);
    log.error('Detalhes do erro', { message: error.message, code: error.code, stack: error.stack });
    throw error;
  }
}

module.exports = {
  handleStatusButton,
  processarAnaliseAutomatica,
  denunciasMap,
  handleRecusarPorMensagem,
  handleLogAceitarButton,
  handleLogRecusarButton,
  handlePunishmentModal,
  checkModPermission,
  registrarAcaoModerador,
};
