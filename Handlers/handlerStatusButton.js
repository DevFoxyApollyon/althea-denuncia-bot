// handlerStatusButton.js
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const Denuncia = require('../models/Denuncia');
const Config = require('../models/Config');
const { LogManager } = require('./LogManager');
const ModerationAction = require('../models/ModerationAction');
const { getBrasiliaDate, formatTimeBR } = require('../utils/dateUtils');
const { Logger } = require('../utils/logger');
const { inserirFeedbackMenu } = require('../utils/feedback');
const { atualizarStatusNaMensagem } = require('../utils/atualizarStatus');
const log = new Logger({ tag: 'HandlerStatusButton', debug: false });
const DM_IGNORED_CODES = [50007, 50278];

const CLAIM_COOLDOWN_MS = 10 * 60 * 1000;
const GUILD_COOLDOWN = '817924556358156360';
const _claimCooldowns = new Map();
const _sendOnceLocks = new Set();

async function safeDefer(interaction, ephemeral = true) {
  try {
    if (!interaction?.isRepliable?.()) return false;
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: ephemeral ? [MessageFlags.Ephemeral] : [] });
    }
    return true;
  } catch (e) {
    if (e?.code === 10062) return false;
    return false;
  }
}

async function safeReplyOrEdit(interaction, payload) {
  try {
    if (!interaction?.isRepliable?.()) return null;
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(payload);
    }
    return await interaction.reply(payload);
  } catch (e) {
    if (e?.code === 10062) return null;
    try {
      if (interaction.deferred || interaction.replied) {
        return await interaction.editReply(payload);
      }
    } catch (_) {}
    return null;
  }
}

const STATUS_PATTERNS = [
  'ðŸ”Ž Esta denÃºncia estÃ¡ em anÃ¡lise por',
  'âœ… DenÃºncia aceita por',
  'âŒ DenÃºncia recusada por',
];

const REANALISE_PATTERNS = [
  'ðŸ“Œ **ReanÃ¡lise / Recurso**',
  'ðŸ“Œ ReanÃ¡lise / Recurso',
  'Caso queira uma **reanÃ¡lise**, abra um **ticket** no canal',
  'Caso queira uma reanalise, abra um ticket',
];

function isOurBotStatusMessage(msg) {
  if (!msg?.author?.bot) return false;
  const content = String(msg.content || '');
  return STATUS_PATTERNS.some((p) => content.includes(p));
}

function isOurBotAnaliseMessage(msg) {
  if (!msg?.author?.bot) return false;
  const content = String(msg.content || '');
  return content.includes('ðŸ”Ž Esta denÃºncia estÃ¡ em anÃ¡lise por');
}

function isOurBotAceitaMessage(msg) {
  if (!msg?.author?.bot) return false;
  const content = String(msg.content || '');
  return content.includes('âœ… DenÃºncia aceita por');
}

function isOurBotRecusadaMessage(msg) {
  if (!msg?.author?.bot) return false;
  const content = String(msg.content || '');
  return content.includes('âŒ DenÃºncia recusada por');
}

function isOurBotReanaliseMessage(msg) {
  if (!msg?.author?.bot) return false;
  const content = String(msg.content || '');
  return REANALISE_PATTERNS.some((p) => content.includes(p));
}

async function sendOnce(channel, content) {
  if (!channel?.isTextBased?.()) return null;

  const contentKey = `${channel.id}:${String(content || '').trim().slice(0, 100)}`;

  if (_sendOnceLocks.has(contentKey)) {
    log.debug(`sendOnce bloqueado por lock em memÃ³ria: ${contentKey}`);
    return null;
  }

  _sendOnceLocks.add(contentKey);

  try {
    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (messages) {
      const already = messages.find(
        (m) => m?.author?.bot && String(m.content || '').trim() === String(content || '').trim()
      );
      if (already) {
        log.debug(`Mensagem jÃ¡ existe, reutilizando: ${already.id}`);
        return already;
      }
    }
    return await channel.send(content);
  } catch (e) {
    log.error('Erro ao enviar mensagem:', e?.message);
    return null;
  } finally {
    setTimeout(() => _sendOnceLocks.delete(contentKey), 3000);
  }
}

async function cleanupStatusMessages(targetChannel, cleanupType = 'all') {
  if (!targetChannel?.isTextBased?.()) return;
  try {
    let lastId = null;
    for (let i = 0; i < 2; i++) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;
      const messages = await targetChannel.messages.fetch(options).catch(() => null);
      if (!messages || messages.size === 0) break;
      let toDelete;
      if (cleanupType === 'analise') {
        toDelete = messages.filter((msg) => isOurBotAnaliseMessage(msg));
      } else if (cleanupType === 'aceita') {
        toDelete = messages.filter((msg) => isOurBotAceitaMessage(msg));
      } else if (cleanupType === 'recusada') {
        toDelete = messages.filter((msg) => isOurBotRecusadaMessage(msg));
      } else if (cleanupType === 'reanalise') {
        toDelete = messages.filter((msg) => isOurBotReanaliseMessage(msg));
      } else {
        toDelete = messages.filter((msg) => isOurBotStatusMessage(msg) || isOurBotReanaliseMessage(msg));
      }
      for (const msg of toDelete.values()) {
        try {
          const fetched = await msg.fetch().catch(() => null);
          if (fetched) {
            await fetched.delete().catch((e) => {
              if (e?.code === 10008) {
                log.debug(`Mensagem jÃ¡ deletada: ${msg.id}`);
              } else {
                log.warn('Falha ao deletar mensagem', e?.message || e);
              }
            });
          } else {
            log.debug(`Mensagem nÃ£o encontrada, ignorando: ${msg.id}`);
          }
        } catch (e) {
          if (e?.code === 10008 || e?.code === 50001) {
            log.debug(`Mensagem jÃ¡ deletada ou sem acesso: ${msg.id}`);
          } else {
            log.warn('Erro ao processar deleÃ§Ã£o', e?.message || e);
          }
        }
      }
      lastId = messages.last()?.id;
      if (!lastId) break;
    }
  } catch (error) {
    log.error('Erro ao limpar mensagens', error);
  }
}

const statusConfig = {
  aceitar: { emoji: 'âœ…', message: 'DenÃºncia aceita', color: '#00FF00' },
  recusar: { emoji: 'âŒ', message: 'DenÃºncia recusada', color: '#FF0000' },
  analiser: { emoji: 'ðŸ”Ž', message: 'DenÃºncia em anÃ¡lise', color: '#FFA500' },
  reivindicar: { emoji: 'ðŸ“', message: 'DenÃºncia reivindicada', color: '#1E90FF' },
};

function createStatusMessage(type, user, data = {}) {
  const denunciaData = data.denuncia || {};
  const logUrl = data.logMessage
    ? `https://discord.com/channels/${data.guildId}/${data.logChannelId}/${data.logMessage.id}`
    : data.logMessageId && data.guildId && data.logChannelId
    ? `https://discord.com/channels/${data.guildId}/${data.logChannelId}/${data.logMessageId}`
    : '';
  switch (type) {
    case 'analise':
      return `ðŸ”Ž Esta denÃºncia estÃ¡ em anÃ¡lise por ${user} Acusado: (${denunciaData.acusado || 'NÃ£o informado'}) Motivo: (${denunciaData.motivo || 'NÃ£o informado'}) Link: ${logUrl}`;
    case 'aceita':
      return `âœ… DenÃºncia aceita por ${user} Acusado: (${data.acusadoId}) TomarÃ¡ puniÃ§Ã£o por (${data.motivo}) Data ${data.dataPunicao} Link: ${logUrl}`;
    case 'recusada':
      return `âŒ DenÃºncia recusada por ${user}`;
    default:
      return '';
  }
}

function createLogsMessage(type, user, data = {}) {
  const denunciaData = data.denuncia || {};
  switch (type) {
    case 'analise':
      return `ðŸ”Ž Esta denÃºncia estÃ¡ em anÃ¡lise por ${user} Acusado: (${denunciaData.acusado || 'NÃ£o informado'}) Motivo: (${denunciaData.motivo || 'NÃ£o informado'}) Link: ${data.messageUrl}`;
    case 'aceita':
      return `âž± DenÃºncia aceita Acusado (${data.acusadoId}) tomarÃ¡ puniÃ§Ã£o por (${data.motivo}) Data ${data.dataPunicao} Link: ${data.messageUrl}`;
    case 'recusada':
      return `âŒ DenÃºncia recusada por ${user}`;
    default:
      return '';
  }
}

async function fetchLogMessage(logsChannel, logMessageId) {
  if (!logsChannel || !logMessageId) return null;
  try {
    return await logsChannel.messages.fetch(logMessageId);
  } catch {
    return null;
  }
}

async function sendReanaliseNotice(channel) {
  try {
    if (!channel?.guild) return;
    await cleanupStatusMessages(channel, 'reanalise');
    const ticketChannel = channel.guild.channels.cache.find(
      (c) =>
        c?.isTextBased?.() &&
        typeof c.name === 'string' &&
        c.name.toLowerCase().includes('abrir-ticket')
    );
    const ticketMention = ticketChannel ? `<#${ticketChannel.id}>` : '`abrir-ticket`';
    await sendOnce(
      channel,
      `ðŸ“Œ **ReanÃ¡lise / Recurso**\n` +
        `Caso queira uma **reanÃ¡lise**, abra um **ticket** no canal ${ticketMention}.`
    );
  } catch (e) {
    log.warn('Falha ao enviar aviso de reanÃ¡lise', e);
  }
}

async function manageStatusMessages(channel, newStatus, user, data = {}) {
  let discordLogMessage = null;
  try {
    const logsChannel = data.logsChannel;
    const logMessageId = data.logMessageId;
    if (logsChannel && logMessageId) {
      discordLogMessage = await fetchLogMessage(logsChannel, logMessageId);
    }
    let statusChannel = channel;
    if (data.analysisChannelId && channel.guild) {
      const analysisChannel = await channel.guild.channels.fetch(data.analysisChannelId).catch(() => null);
      if (analysisChannel?.isTextBased?.()) statusChannel = analysisChannel;
    }
    if (newStatus === 'analise') {
      await cleanupStatusMessages(channel, 'aceita');
      await cleanupStatusMessages(channel, 'recusada');
      let newLogMessageId = null;
      if (logsChannel) {
        if (discordLogMessage) {
          await discordLogMessage.edit(createLogsMessage(newStatus, user, { ...data, denuncia: data.denuncia }));
          newLogMessageId = discordLogMessage.id;
        } else {
          discordLogMessage = await logsChannel.send(createLogsMessage(newStatus, user, { ...data, denuncia: data.denuncia }));
          newLogMessageId = discordLogMessage.id;
        }
      }
      const analysisMessageContent =
        `ðŸ”Ž Esta denÃºncia estÃ¡ em anÃ¡lise por ${user} ` +
        `Acusado: (${data.denuncia?.acusado || 'NÃ£o informado'}) ` +
        `Motivo: (${data.denuncia?.motivo || 'NÃ£o informado'}) ` +
        `Link: ${data.messageUrl}`;
      await sendOnce(statusChannel, analysisMessageContent);
      const statusMsgContent = createStatusMessage(newStatus, user, {
        ...data,
        logMessage: discordLogMessage,
        logMessageId: newLogMessageId,
        guildId: channel.guild.id,
        logChannelId: logsChannel ? logsChannel.id : null,
        denuncia: data.denuncia,
      });
      if (channel.id !== statusChannel.id) {
        await sendOnce(channel, statusMsgContent);
      }
      return discordLogMessage;
    }
    if (newStatus === 'aceita') {
      await cleanupStatusMessages(channel, 'recusada');
      await cleanupStatusMessages(channel, 'analise');
      if (logsChannel) {
        const logsContent = createLogsMessage(newStatus, user, data);
        try {
          if (discordLogMessage) {
            await discordLogMessage.edit(logsContent);
          } else {
            discordLogMessage = await logsChannel.send(logsContent);
          }
        } catch (logError) {
          log.error(`[${formatTimeBR(getBrasiliaDate())}] Erro ao enviar/editar mensagem de log`, logError);
        }
      }
      const statusMsgContent = createStatusMessage(newStatus, user, {
        ...data,
        logMessage: discordLogMessage,
        logMessageId: discordLogMessage ? discordLogMessage.id : data.logMessageId,
        guildId: channel.guild.id,
        logChannelId: logsChannel ? logsChannel.id : null,
        denuncia: data.denuncia,
      });
      await sendOnce(channel, statusMsgContent);
      return discordLogMessage;
    }
    if (newStatus === 'recusada') {
      await cleanupStatusMessages(channel, 'aceita');
      await cleanupStatusMessages(channel, 'analise');
      const statusMsgContent = createStatusMessage(newStatus, user, {
        ...data,
        logMessage: discordLogMessage,
        logMessageId: discordLogMessage ? discordLogMessage.id : data.logMessageId,
        guildId: channel.guild.id,
        logChannelId: logsChannel ? logsChannel.id : null,
        denuncia: data.denuncia,
      });
      await sendOnce(channel, statusMsgContent);
      if (discordLogMessage) {
        await discordLogMessage.delete().catch((e) => log.warn('Falha ao deletar mensagem de log', e));
        discordLogMessage = null;
      }
      return null;
    }
  } catch (error) {
    log.error('Erro ao gerenciar mensagens de status', error);
  }
  return discordLogMessage;
}

async function updateDenunciaStatus(denunciaId, {
  status,
  staffId,
  motivoEdicao,
  acusadoId,
  motivoAceite,
  dataPunicao,
  logMessageId,
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
  if (logMessageId !== undefined) {
    updateFields.logMessageId = logMessageId;
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
          content: 'âŒ NÃ£o foi possÃ­vel encontrar uma denÃºncia neste canal.',
          flags: [MessageFlags.Ephemeral],
        });
      } else {
        await safeReplyOrEdit(interaction, {
          content: 'â³ Esta denÃºncia jÃ¡ estÃ¡ sendo processada. Aguarde um instante.',
          flags: [MessageFlags.Ephemeral],
        });
      }
      return;
    }

    try {
      const config = await Config.findOne({ guildId: interaction.guild.id });

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
          const isClaimer = denuncia.claimedBy === interaction.user.id;
          if (!isClaimer && !isResponsavelAdmin) {
            await safeReplyOrEdit(interaction, {
              content: 'âŒ Apenas quem reivindicou ou responsÃ¡veis admin podem colocar em anÃ¡lise.',
              flags: [MessageFlags.Ephemeral],
            });
            return;
          }
        } else {
          await safeReplyOrEdit(interaction, {
            content: `âŒ Esta denÃºncia jÃ¡ estÃ¡ ${statusConfig[status]?.message.toLowerCase() || normalizedStatus}.`,
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }
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
            content: 'âŒ Administradores sÃ³ podem interagir uma vez com os botÃµes apÃ³s reivindicar esta denÃºncia.',
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }
      }

      const canModify = await canModifyReport(interaction, denuncia, config);
      if (!canModify) {
        await safeReplyOrEdit(interaction, {
          content: 'âŒ Apenas quem reivindicou a denÃºncia ou responsÃ¡veis admin podem modificÃ¡-la.',
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
          content: 'âŒ Apenas quem reivindicou ou responsÃ¡veis admin podem aceitar/recusar denÃºncias.',
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
          content: 'âŒ Apenas quem reivindicou a denÃºncia ou responsÃ¡veis admin podem colocÃ¡-la em anÃ¡lise.',
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
      content: 'âŒ Ocorreu um erro ao processar o status.',
      flags: [MessageFlags.Ephemeral],
    });
  }
}

async function handleAnalise(interaction, denuncia, config, messageUrl, logsChannel) {
  try {
    await safeDefer(interaction, true);
    await safeReplyOrEdit(interaction, { content: 'â³ Processando...' });

    const discordLogMessage = await manageStatusMessages(interaction.channel, 'analise', interaction.user, {
      messageUrl,
      logChannelId: config.channels.logs,
      logsChannel,
      previousStatus: denuncia.status,
      logMessageId: denuncia.logMessageId,
      analysisChannelId: config.channels.analysis,
      denuncia,
    });

    await registrarAcaoModerador(interaction.user.id, 'analise', denuncia._id, interaction.guild.id);
    await updateDenunciaStatus(denuncia._id, {
      status: 'analise',
      staffId: interaction.user.id,
      motivoEdicao: 'Em anÃ¡lise',
      logMessageId: discordLogMessage ? discordLogMessage.id : denuncia.logMessageId || null,
    });

    const logManager = new LogManager(interaction.client, config);
    const logEmbed = await logManager.createLogEmbed('analise', interaction.user, interaction.channel.id);

    if (config.channels.log) {
      const logChannel = interaction.client.channels.cache.get(config.channels.log);
      if (logChannel) await logChannel.send({ embeds: [logEmbed] });
    }

    await safeReplyOrEdit(interaction, { content: 'ðŸ”Ž DenÃºncia marcada como em anÃ¡lise!' });

    try {
      await atualizarStatusNaMensagem(interaction.client, denuncia, 'analise');
    } catch (e) {
      log.warn('Falha ao atualizar status na mensagem principal (analise)', e?.message);
    }
  } catch (error) {
    log.error('Erro ao manejar anÃ¡lise', error);
    await safeReplyOrEdit(interaction, {
      content: 'âŒ Ocorreu um erro ao marcar a denÃºncia como em anÃ¡lise.',
      flags: [MessageFlags.Ephemeral],
    });
  }
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

    const modal = new ModalBuilder().setCustomId('punishment_modal').setTitle('Aplicar PuniÃ§Ã£o');

    const acusadoId = new TextInputBuilder()
      .setCustomId('acusadoId')
      .setLabel('ID do Acusado')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('Digite o ID do acusado');

    const motivo = new TextInputBuilder()
      .setCustomId('motivo')
      .setLabel('Motivo da PuniÃ§Ã£o')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setPlaceholder('Digite o motivo da puniÃ§Ã£o...')
      .setMaxLength(1000);

    const data = new TextInputBuilder()
      .setCustomId('data')
      .setLabel('Data da PuniÃ§Ã£o')
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
        }).catch((e) => log.error('Erro ao liberar processingLock apÃ³s falha no modal', e));
      }
    }
  } catch (error) {
    log.error('Erro ao manejar aceitaÃ§Ã£o', error);
    await safeReplyOrEdit(interaction, {
      content: 'âŒ Ocorreu um erro ao aceitar a denÃºncia.',
      flags: [MessageFlags.Ephemeral],
    });
    await Denuncia.findByIdAndUpdate(denuncia._id, {
      $set: { processingLock: false },
    }).catch((e) => log.error('Erro ao liberar processingLock (handleAceitar catch)', e));
  }
}

async function handleRecusar(interaction, denuncia, config, messageUrl, logsChannel) {
  try {
    await safeDefer(interaction, true);
    await safeReplyOrEdit(interaction, { content: 'â³ Processando...' });

    if (denuncia.logMessageId && logsChannel) {
      try {
        const existingLogMessage = await logsChannel.messages.fetch(denuncia.logMessageId).catch(() => null);
        if (existingLogMessage) {
          await existingLogMessage.delete().catch((e) => {
            if (e?.code === 10008 || e?.code === 50001) {
              log.debug('Mensagem de log jÃ¡ deletada ou sem acesso');
            } else if (e?.status === 500) {
              log.debug('Servidor Discord temporariamente indisponÃ­vel, ignorando');
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
      denuncia,
    });

    await registrarAcaoModerador(interaction.user.id, 'recusada', denuncia._id, interaction.guild.id);
    await updateDenunciaStatus(denuncia._id, {
      status: 'recusada',
      staffId: interaction.user.id,
      motivoEdicao: 'DenÃºncia recusada',
      acusadoId: null,
      motivoAceite: null,
      dataPunicao: null,
      logMessageId: null,
    });

    const logManager = new LogManager(interaction.client, config);
    const logEmbed = await logManager.createLogEmbed('recusada', interaction.user, interaction.channel.id);

    if (config?.channels?.log) {
      const logChannel = interaction.client.channels.cache.get(config.channels.log);
      if (logChannel) await logChannel.send({ embeds: [logEmbed] });
    }

    try {
      const userId = denuncia.criadoPor;
      if (userId && typeof userId === 'string' && userId !== 'null' && userId !== 'undefined') {
        const denunciante = await interaction.client.users.fetch(userId);
        if (denunciante) {
          const denunciaLink =
            messageUrl || `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}`;
          await denunciante.send(
            `Sua denÃºncia foi recusada pela equipe.\n` +
              `Link da denÃºncia: ${denunciaLink}\n\n` +
              `Se vocÃª acredita que sua denÃºncia foi analisada de forma errada, procure um responsÃ¡vel por denÃºncias no servidor.\n` +
              `DenÃºncias podem ser reanalisadas por um responsÃ¡vel, caso haja justificativa.`
          );
        }
      } else {
        log.warn('NÃ£o foi possÃ­vel enviar DM: criadoPor da denÃºncia Ã© invÃ¡lido', { userId });
      }
    } catch (dmError) {
      if (!DM_IGNORED_CODES.includes(dmError?.code)) {
        log.error('Erro ao enviar DM para o denunciante', dmError);
      }
    }

    await safeReplyOrEdit(interaction, {
      content: `${statusConfig.recusar.emoji} DenÃºncia recusada com sucesso!`,
    });

    await sendReanaliseNotice(interaction.channel);

    try {
      await atualizarStatusNaMensagem(interaction.client, denuncia, 'recusada');
    } catch (e) {
      log.warn('Falha ao atualizar status na mensagem principal (recusada)', e?.message);
    }
  } catch (error) {
    log.error('Erro ao manejar recusa', error);
    await safeReplyOrEdit(interaction, {
      content: 'âŒ Ocorreu um erro ao recusar a denÃºncia.',
      flags: [MessageFlags.Ephemeral],
    });
  }
}

async function handlePunishmentModal(interaction) {
  const denunciaData = denunciasMap.get(interaction.user.id);

  try {
    if (!interaction.isModalSubmit()) return;
    await safeDefer(interaction, true);
    await safeReplyOrEdit(interaction, { content: 'â³ Processando aceitaÃ§Ã£o...' });

    if (!denunciaData) {
      return await safeReplyOrEdit(interaction, {
        content: 'âŒ Dados da denÃºncia nÃ£o encontrados. Tente novamente.',
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
        content: 'âŒ Formato de data invÃ¡lido. Use o formato: DD/MM/YYYY',
        flags: [MessageFlags.Ephemeral],
      });
    }

    const config = await Config.findOne({ guildId: interaction.guild.id });
    const logsChannel = config?.channels?.logs
      ? interaction.client.channels.cache.get(config.channels.logs)
      : null;

    const logMessage = await manageStatusMessages(interaction.channel, 'aceita', interaction.user, {
      acusadoId,
      motivo,
      dataPunicao,
      messageUrl,
      logChannelId: config?.channels?.logs,
      logsChannel,
      previousStatus: denuncia.status,
      logMessageId: denuncia.logMessageId,
      denuncia,
    });

    await registrarAcaoModerador(interaction.user.id, 'aceita', denuncia._id, interaction.guild.id);
    await updateDenunciaStatus(denuncia._id, {
      status: 'aceita',
      staffId: interaction.user.id,
      motivoEdicao: motivo,
      acusadoId,
      motivoAceite: motivo,
      dataPunicao,
      logMessageId: logMessage ? logMessage.id : denuncia.logMessageId || null,
    });

    const logManager = new LogManager(interaction.client, config);
    const logEmbed = await logManager.createLogEmbed('aceita', interaction.user, interaction.channel.id);

    if (config?.channels?.log) {
      const logChannel = interaction.client.channels.cache.get(config.channels.log);
      if (logChannel) await logChannel.send({ embeds: [logEmbed] });
    }

    try {
      const userId = denuncia.criadoPor;
      if (userId && typeof userId === 'string' && userId !== 'null' && userId !== 'undefined') {
        const denunciante = await interaction.client.users.fetch(userId);
        if (denunciante) {
          const denunciaLink =
            messageUrl || `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}`;
          await denunciante.send(
            `Sua denÃºncia foi aceita pela equipe!\n` +
              `Link da denÃºncia: ${denunciaLink}\n` +
              `ID do acusado: ${acusadoId}\n` +
              `Motivo: ${motivo}\n` +
              `Data da puniÃ§Ã£o: ${dataPunicao}\n\n` +
              `Se vocÃª acredita que sua denÃºncia foi analisada de forma errada, procure um responsÃ¡vel por denÃºncias no servidor.\n` +
              `DenÃºncias podem ser reanalisadas por um responsÃ¡vel, caso haja justificativa.`
          );
        }
      } else {
        log.warn('NÃ£o foi possÃ­vel enviar DM: criadoPor da denÃºncia Ã© invÃ¡lido', { userId });
      }
    } catch (dmError) {
      if (!DM_IGNORED_CODES.includes(dmError?.code)) {
        log.error('Erro ao enviar DM para o denunciante', dmError);
      }
    }

    await safeReplyOrEdit(interaction, {
      content: `${statusConfig.aceitar.emoji} DenÃºncia aceita com sucesso!`,
    });

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
    log.error(`[${formatTimeBR(getBrasiliaDate())}] Erro ao processar puniÃ§Ã£o`, error);
    await safeReplyOrEdit(interaction, {
      content: 'âŒ Ocorreu um erro ao processar a puniÃ§Ã£o.',
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
    const config = await Config.findOne({ guildId: interaction.guild.id });
    if (!config) {
      await safeReplyOrEdit(interaction, {
        content: 'âŒ ConfiguraÃ§Ãµes do servidor nÃ£o encontradas.',
        ...(isDeferred ? {} : { flags: [MessageFlags.Ephemeral] }),
      });
      return false;
    }
    if (!config.roles?.administrador && !config.roles?.responsavel_admin) {
      await safeReplyOrEdit(interaction, {
        content: 'âŒ Cargos de administraÃ§Ã£o nÃ£o configurados.',
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
        content: 'âŒ VocÃª precisa ter o cargo de administrador ou responsÃ¡vel admin para realizar esta aÃ§Ã£o.',
        ...(isDeferred ? {} : { flags: [MessageFlags.Ephemeral] }),
      });
      return false;
    }
    return true;
  } catch (error) {
    log.error('Erro ao verificar permissÃ£o', error);
    await safeReplyOrEdit(interaction, {
      content: 'âŒ Erro ao verificar permissÃµes.',
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
    log.error('Erro ao registrar aÃ§Ã£o', error);
    log.error('Detalhes do erro', { message: error.message, code: error.code, stack: error.stack });
    throw error;
  }
}

async function handleClaimButton(interaction) {
  try {
    if (!interaction.isRepliable()) return;
    await safeDefer(interaction, true);

    const hasPermission = await checkModPermission(interaction, true);
    if (!hasPermission) return;

    const config = await Config.findOne({ guildId: interaction.guild.id });

    const isResponsavelAdmin =
      config?.roles?.responsavel_admin &&
      interaction.member.roles.cache.has(config.roles.responsavel_admin);

    if (!isResponsavelAdmin && interaction.guild?.id === GUILD_COOLDOWN) {
      const lastClaim = _claimCooldowns.get(interaction.user.id);
      if (lastClaim) {
        const elapsed = Date.now() - lastClaim;
        if (elapsed < CLAIM_COOLDOWN_MS) {
          const remaining = Math.ceil((CLAIM_COOLDOWN_MS - elapsed) / 1000);
          const minutes = Math.floor(remaining / 60);
          const seconds = remaining % 60;
          const tempoRestante = minutes > 0
            ? `${minutes}m ${seconds}s`
            : `${seconds}s`;
          await safeReplyOrEdit(interaction, {
            content: `â³ VocÃª precisa aguardar **${tempoRestante}** antes de reivindicar outra denÃºncia.`,
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }
      }
    }

    const denuncia = await Denuncia.findOneAndUpdate(
      {
        threadId: interaction.channel.id,
        $or: [{ claimedBy: null }, { claimedBy: { $exists: false } }],
      },
      {
        $set: {
          claimedBy: interaction.user.id,
          claimedAt: new Date(),
          status: 'reivindicacao',
        },
      },
      { new: true, sort: { createdAt: -1 } }
    );

    if (!denuncia) {
      const exists = await Denuncia.findOne({ threadId: interaction.channel.id });
      if (!exists) {
        await safeReplyOrEdit(interaction, {
          content: 'âŒ NÃ£o foi possÃ­vel encontrar uma denÃºncia neste canal.',
        });
        return;
      }

      const claimedDenuncia = await Denuncia.findOne({ threadId: interaction.channel.id }).sort({ createdAt: -1 });

      if (claimedDenuncia?.claimedBy === interaction.user.id) {
        await safeReplyOrEdit(interaction, { content: 'âŒ VocÃª jÃ¡ reivindicou esta denÃºncia.' });
        return;
      }

      if (!isResponsavelAdmin) {
        const claimer = await interaction.client.users.fetch(claimedDenuncia.claimedBy).catch(() => null);
        await safeReplyOrEdit(interaction, {
          content: `âŒ Esta denÃºncia jÃ¡ foi reivindicada por ${claimer ? claimer.tag : 'outro moderador'}.`,
        });
        return;
      }

      const forcedDenuncia = await Denuncia.findOneAndUpdate(
        { threadId: interaction.channel.id },
        {
          $set: {
            claimedBy: interaction.user.id,
            claimedAt: new Date(),
            status: 'reivindicacao',
          },
        },
        { new: true, sort: { createdAt: -1 } }
      );

      if (!forcedDenuncia) {
        await safeReplyOrEdit(interaction, {
          content: 'âŒ NÃ£o foi possÃ­vel reivindicar a denÃºncia. Tente novamente.',
        });
        return;
      }

      await registrarAcaoModerador(interaction.user.id, 'reivindicar', forcedDenuncia._id, interaction.guild.id);

      const claimMessage = `ðŸ“ O administrador ${interaction.user} reivindicou esta denÃºncia e estarÃ¡ analisando.`;
      await sendOnce(interaction.channel, claimMessage);

      try {
        await interaction.channel.setName(`ðŸ“â”‚${interaction.channel.name.replace(/^(ðŸ“|âŒ|âœ…|ðŸ”Ž)â”‚/, '')}`);
      } catch (error) {
        log.error('Erro ao atualizar nome do canal', error);
      }

      await safeReplyOrEdit(interaction, { content: 'âœ… VocÃª reivindicou esta denÃºncia com sucesso!' });

      try {
        await atualizarStatusNaMensagem(interaction.client, forcedDenuncia, 'reivindicacao');
      } catch (e) {
        log.warn('Falha ao atualizar status na mensagem principal (reivindicacao forcada)', e?.message);
      }

      return;
    }

    if (!isResponsavelAdmin && interaction.guild?.id === GUILD_COOLDOWN) {
      _claimCooldowns.set(interaction.user.id, Date.now());
      setTimeout(() => _claimCooldowns.delete(interaction.user.id), CLAIM_COOLDOWN_MS);
    }

    await registrarAcaoModerador(interaction.user.id, 'reivindicar', denuncia._id, interaction.guild.id);

    const claimMessage = `ðŸ“ O administrador ${interaction.user} reivindicou esta denÃºncia e estarÃ¡ analisando.`;
    await sendOnce(interaction.channel, claimMessage);

    try {
      await interaction.channel.setName(`ðŸ“â”‚${interaction.channel.name.replace(/^(ðŸ“|âŒ|âœ…|ðŸ”Ž)â”‚/, '')}`);
    } catch (error) {
      log.error('Erro ao atualizar nome do canal', error);
    }

    await safeReplyOrEdit(interaction, { content: 'âœ… VocÃª reivindicou esta denÃºncia com sucesso!' });

    try {
      await atualizarStatusNaMensagem(interaction.client, denuncia, 'reivindicacao');
    } catch (e) {
      log.warn('Falha ao atualizar status na mensagem principal (reivindicacao)', e?.message);
    }
  } catch (error) {
    log.error('Erro ao reivindicar denÃºncia', error);
    await safeReplyOrEdit(interaction, {
      content: 'âŒ Ocorreu um erro ao reivindicar a denÃºncia.',
      flags: [MessageFlags.Ephemeral],
    });
  }
}

module.exports = {
  handleStatusButton,
  handlePunishmentModal,
  denunciasMap,
  handleClaimButton,
};